import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { CACHE_SMALL, toProgramImage } from '@cpu-viz/engine-common';
import {
  defaultConfig,
  TraceRecorder,
  type CycleTrace,
  type ProcessorConfig,
} from '@cpu-viz/trace';
import { SuperscalarProcessor, type SuperscalarMicro } from './index';

/**
 * Time-travel over the superscalar (M7 step 5). Like M3 step 4, this is a **PROOF, not a build**:
 * `packages/trace/src/recorder.ts` is UNTOUCHED by this milestone. That is the claim worth stating
 * plainly, because it is the one that could have failed — `follow()` keys on `id`, never on
 * `location`, and `InstructionSighting.location` was always a free-form string (its own doc cites
 * `"ROB#3"`). So two instructions sharing a stage in one cycle resolve to distinct `"EX.0"` /
 * `"EX.1"` sightings for free. If this file had required a recorder change, the `location` encoding
 * would have been the wrong encoding.
 *
 * ## What this file deliberately does NOT re-prove
 *
 * - **The `"<stage>.<slot>"` encoding itself** — `processor.test.ts` pins it at the engine layer:
 *   that a 1-wide superscalar emits `"EX.0"` and never a bare `"EX"`, that the set of emitted
 *   locations is exactly the five stages at slot 0, and the `IF.0 → ID.0 → EX.0 → MEM.0 → WB.0`
 *   walk. That is the step-5 acceptance clause and it is already met where it belongs.
 * - **The refusal verdicts** (`mem-port`, `branch-slot`, `intra-pair-raw`) — `pairing.test.ts`.
 * - **Cycle counts as a closed form** — `timing.test.ts`. The two counts pinned here are pinned
 *   *by* those suites; they appear as fixtures, not as new claims.
 *
 * What is genuinely new at THIS layer, and all this file asserts:
 *
 *  1. **Recorder navigation over a dual-issue recording** — load → run → back → scrub, the step-5
 *     acceptance criterion verbatim, over a model that retires two instructions in a cycle.
 *  2. **TEN ids, ten distinct locations, one cycle.** M3's headline was five; this is the number
 *     that only exists once slots are part of a location. `follow()` is the only way to read such
 *     a cycle at all.
 *  3. **A slot is NOT a stable lane** — the milestone's most under-pinned fact, and the direct
 *     consequence of the pinned sliding/greedy issue rule. An instruction fetched into slot 1 can
 *     be refused and slide to slot 0; another slides 0 → 1; a third slides while still in IF. Every
 *     expected `location` below was DUMPED and read, never reasoned (the house rule from step 2b
 *     finding (e) and step 4 finding (e), which is at its sharpest here).
 *  4. **INV-4 survives a slide** — the failure mode is a re-fetch minting a second id for one
 *     instruction, which a slide makes newly plausible because the instruction changes seat.
 *  5. **The recorded `micro` SLOT ARRAYS track the timeline.** Step 2a caught the engine aliasing
 *     these arrays with a test rather than with conformance; this is the time-travel expression of
 *     that fix, per slot, over a whole corpus recording.
 *  6. **The width toggle, through the shipped API** — the product's flagship A/B, asserted the way
 *     a user experiences it: same program, same answers, fewer cycles.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

const W1: ProcessorConfig = { ...defaultConfig(), forwarding: true, issueWidth: 1 };
const W2: ProcessorConfig = { ...defaultConfig(), forwarding: true, issueWidth: 2 };

function asm(source: string): AssembledProgram {
  const { program, errors } = assemble(source);
  if (!program) {
    throw new Error(
      'assembly failed:\n' + errors.map((e) => `  ${e.line}:${e.column} ${e.message}`).join('\n'),
    );
  }
  return program;
}

function recorderFor(source: string, config: ProcessorConfig = W2): TraceRecorder {
  const rec = new TraceRecorder(new SuperscalarProcessor());
  rec.load(toProgramImage(asm(source)), config);
  return rec;
}

const micro = (t: CycleTrace): SuperscalarMicro => t.state.micro as SuperscalarMicro;

/** The id the recording places at `location` in a cycle, or undefined if that slot is empty. */
function idAt(t: CycleTrace, location: string): string | undefined {
  return t.instructions.find((i) => i.location === location)?.id;
}

/**
 * Ten independent instructions (each reads only x0, each writes a different register) then `ecall`,
 * so nothing stalls and nothing refuses: five pairs issue back to back and the pipe fills to its
 * absolute maximum. OBSERVED timeline at width 2 — pairs are fetched together and travel together,
 * so cycle 4 has all five stages doubly occupied:
 *
 * ```
 *  cycle:      0     1     2     3     4     5     6     7     8     9
 *  i0,i1      IF    ID    EX   MEM    WB
 *  i2,i3            IF    ID    EX   MEM    WB
 *  i4,i5                  IF    ID    EX   MEM    WB
 *  i6,i7                        IF    ID    EX   MEM    WB
 *  i8,i9                              IF    ID    EX   MEM    WB
 *  i10 ecall                                IF    ID    EX   MEM    WB
 * ```
 */
const TEN_INDEPENDENT = [
  '.text',
  ...Array.from({ length: 10 }, (_, n) => `addi x${n + 1}, x0, ${n + 1}`),
  'ecall',
].join('\n');

/**
 * The minimal slide. `addi x2, x1, 5` reads what `addi x1, x0, 1` writes, so the fetched pair is
 * refused for `intra-pair-raw` and the younger instruction becomes the OLDER of the next group —
 * the pinned sliding/greedy rule, in four instructions.
 */
const SLIDER = ['.text', 'addi x1, x0, 1', 'addi x2, x1, 5', 'addi x3, x0, 3', 'ecall'].join('\n');

describe('TraceRecorder × superscalar: load → run → back → scrub', () => {
  const sumLoop = readFileSync(`${PROGRAMS_DIR}sum-loop.s`, 'utf8');

  it('starts at the pre-run state; the latches are slot arrays of the configured width', () => {
    const rec = recorderFor(sumLoop);
    expect(rec.cursor).toBe(-1);
    expect(rec.recordedCycles).toBe(0);
    expect(rec.currentState().registers[10]).toBe(0);
    expect(rec.currentState().halted).toBe(false);

    // The shape difference from every earlier model, visible before a single cycle runs: the four
    // latches are ARRAYS, two seats wide, all empty.
    const m = rec.currentState().micro as SuperscalarMicro;
    expect(m.width).toBe(2);
    expect([m.ifId, m.idEx, m.exMem, m.memWb]).toEqual([
      [null, null],
      [null, null],
      [null, null],
      [null, null],
    ]);
  });

  it('runs a dual-issue recording to completion and parks at the final state', () => {
    const rec = recorderFor(sumLoop);
    expect(rec.runToEnd()).toBe(44); // pinned by pairing.test.ts / timing.test.ts, not new here
    expect(rec.atEnd).toBe(true);
    expect(rec.currentState().registers[10]).toBe(55); // a0 = 10+9+...+1
    expect(rec.currentState().halted).toBe(true);
  });

  it('the shown state IS the recorded trace’s own snapshot at every cursor', () => {
    const rec = recorderFor(sumLoop);
    rec.runToEnd();
    for (let i = 0; i < rec.recordedCycles; i++) {
      rec.scrubTo(i);
      expect(rec.currentState()).toBe(rec.current()!.state);
    }
  });

  it('scrubs to a cycle where TWO instructions retire together, then walks back to pre-run', () => {
    // The navigation claim with a dual-issue edge on it: at width 1 a cycle retires at most one
    // instruction, so "scrub to the cycle where the answer changed" always names one write. Here a
    // single cursor position can hold two.
    const rec = recorderFor(TEN_INDEPENDENT);
    rec.runToEnd();

    rec.scrubTo(3); // i0/i1 are in MEM — neither has written back yet
    expect(rec.currentState().registers[1]).toBe(0);
    expect(rec.currentState().registers[2]).toBe(0);

    rec.scrubTo(4); // ...and one cycle later BOTH have retired, in the same cycle
    expect(rec.currentState().registers[1]).toBe(1);
    expect(rec.currentState().registers[2]).toBe(2);
    const retires = rec.current()!.events.filter((e) => e.type === 'instr-retire');
    expect(retires).toHaveLength(2);

    while (rec.stepBack()) {
      /* walk back to the pre-run state */
    }
    expect(rec.cursor).toBe(-1);
    expect(rec.currentState().registers[1]).toBe(0);
  });

  it('scrubs forward lazily, recording cycles on demand', () => {
    const rec = recorderFor(TEN_INDEPENDENT);
    expect(rec.recordedCycles).toBe(0);
    rec.scrubTo(4);
    expect(rec.recordedCycles).toBe(5); // had to record 0..4 to get there
    expect(rec.currentState().registers[1]).toBe(1);
  });

  it('reaches the same final state as driving the engine by hand', () => {
    const direct = new SuperscalarProcessor();
    direct.reset(toProgramImage(asm(sumLoop)), W2);
    while (!direct.isHalted()) direct.step();
    const expected = direct.getState();

    const rec = recorderFor(sumLoop, W2);
    rec.runToEnd();
    const actual = rec.currentState();

    expect([...actual.registers]).toEqual([...expected.registers]);
    for (const addr of expected.memory.definedAddresses()) {
      expect(actual.memory.readWord(addr)).toBe(expected.memory.readWord(addr));
    }
    expect(actual.pc).toBe(expected.pc);
    expect(actual.halted).toBe(true);
  });
});

describe('TraceRecorder × superscalar: TEN in flight, individually followable (INV-4)', () => {
  it('resolves ten different ids to ten different locations in one cycle', () => {
    const rec = recorderFor(TEN_INDEPENDENT);
    rec.runToEnd();
    expect(rec.recordedCycles).toBe(10);

    rec.scrubTo(4);
    const inFlight = rec.current()!.instructions;

    // The number M3 could not reach. Five stages, two seats each, every seat full.
    expect(inFlight).toHaveLength(10);

    // Read the ids FROM the recording — never hardcode them; `follow()` is what has to resolve
    // them, and an id the test invented would prove nothing about the recorded trace.
    const ids = inFlight.map((i) => i.id);
    expect(new Set(ids).size).toBe(10);

    const located = ids.map((id) => rec.follow(id).find((s) => s.cycle === 4)!.location);
    expect(located).toEqual([
      'WB.0',
      'WB.1',
      'MEM.0',
      'MEM.1',
      'EX.0',
      'EX.1',
      'ID.0',
      'ID.1',
      'IF.0',
      'IF.1',
    ]);
    expect(new Set(located).size).toBe(10);
  });

  it('follows a slot-1 instruction across all five stages while nine others are in flight', () => {
    const rec = recorderFor(TEN_INDEPENDENT);
    rec.runToEnd();

    // The instruction in EX's SECOND seat at cycle 4 — the occupant no earlier model has.
    const followed = idAt(rec.recorded[4]!, 'EX.1')!;
    expect(rec.follow(followed)).toEqual([
      { cycle: 2, location: 'IF.1' },
      { cycle: 3, location: 'ID.1' },
      { cycle: 4, location: 'EX.1' },
      { cycle: 5, location: 'MEM.1' },
      { cycle: 6, location: 'WB.1' },
    ]);

    // Its pair-mate travels beside it the whole way — same cycles, the other seat.
    const mate = idAt(rec.recorded[4]!, 'EX.0')!;
    expect(mate).not.toBe(followed);
    expect(rec.follow(mate)).toEqual([
      { cycle: 2, location: 'IF.0' },
      { cycle: 3, location: 'ID.0' },
      { cycle: 4, location: 'EX.0' },
      { cycle: 5, location: 'MEM.0' },
      { cycle: 6, location: 'WB.0' },
    ]);
  });
});

describe('TraceRecorder × superscalar: a slot is NOT a stable lane', () => {
  /**
   * The consequence of the pinned sliding/greedy issue rule, and the thing `follow()` exists to
   * make legible. Every walk below was dumped from a real recording and read before it was
   * asserted — the milestone has caught two reasoned-about slot claims already, both false.
   *
   * OBSERVED, at width 2 with forwarding on (7 cycles):
   *
   * ```
   *  cycle:      0       1       2       3       4       5       6
   *  i0        IF.0    ID.0    EX.0    MEM.0   WB.0
   *  i1        IF.1    ID.1    ID.0    EX.0    MEM.0   WB.0          <- refused, slides 1 -> 0
   *  i2                IF.0    ID.1    EX.1    MEM.1   WB.1          <- slides 0 -> 1
   *  i3                IF.1    IF.0    ID.0    EX.0    MEM.0   WB.0  <- slides while still in IF
   * ```
   */
  it('an instruction refused in slot 1 slides to slot 0 and finishes there', () => {
    const rec = recorderFor(SLIDER);
    rec.runToEnd();
    expect(rec.recordedCycles).toBe(7);

    // The refusal that causes the slide, read from the recording rather than assumed.
    const reasons = rec.recorded[1]!.events.flatMap((e) => (e.type === 'stall' ? [e.reason] : []));
    expect(reasons).toEqual(['intra-pair-raw']);

    const younger = idAt(rec.recorded[0]!, 'IF.1')!;
    expect(rec.follow(younger)).toEqual([
      { cycle: 0, location: 'IF.1' }, // fetched as the YOUNGER of a pair...
      { cycle: 1, location: 'ID.1' }, // ...refused: it reads what its pair-mate writes...
      { cycle: 2, location: 'ID.0' }, // ...and slides down to become the OLDER of the next group
      { cycle: 3, location: 'EX.0' },
      { cycle: 4, location: 'MEM.0' },
      { cycle: 5, location: 'WB.0' },
    ]);

    // The slide is not one-directional, which is exactly why "lane" is the wrong word for a slot:
    // the instruction behind it moves the OTHER way, 0 -> 1, to pair with the slider.
    const promoted = idAt(rec.recorded[1]!, 'IF.0')!;
    expect(rec.follow(promoted)).toEqual([
      { cycle: 1, location: 'IF.0' },
      { cycle: 2, location: 'ID.1' },
      { cycle: 3, location: 'EX.1' },
      { cycle: 4, location: 'MEM.1' },
      { cycle: 5, location: 'WB.1' },
    ]);

    // ...and a third slides while still in IF, never having reached ID at all.
    const inIf = idAt(rec.recorded[1]!, 'IF.1')!;
    expect(rec.follow(inIf).map((s) => s.location)).toEqual([
      'IF.1',
      'IF.0',
      'ID.0',
      'EX.0',
      'MEM.0',
      'WB.0',
    ]);

    // The architectural payoff is unchanged by any of it — x2 read the forwarded 1, not a stale 0.
    expect(rec.currentState().registers[1]).toBe(1);
    expect(rec.currentState().registers[2]).toBe(6);
    expect(rec.currentState().registers[3]).toBe(3);
  });

  it('a slide does not re-mint the id — one instruction, one fetch, one walk (INV-4)', () => {
    // The failure mode a slide makes newly plausible: re-fetching an instruction that changed seat
    // would mint a SECOND id for it, and `follow()` on either id would then show a walk with a hole
    // in it. Every pc in this program is fetched exactly once.
    const rec = recorderFor(SLIDER);
    rec.runToEnd();

    const fetchedPcs = rec.recorded.flatMap((t) =>
      t.events.flatMap((e) => (e.type === 'instr-fetch' ? [e.pc] : [])),
    );
    expect(fetchedPcs).toHaveLength(4);
    expect(new Set(fetchedPcs).size).toBe(4);

    // Every id ever seen has a CONTIGUOUS walk — no gaps, one cycle apart — even the three that
    // changed seat mid-flight.
    const ids: string[] = [];
    for (const t of rec.recorded) {
      for (const i of t.instructions) if (!ids.includes(i.id)) ids.push(i.id);
    }
    expect(ids).toHaveLength(4); // four instructions, four ids — not five
    for (const id of ids) {
      const cycles = rec.follow(id).map((s) => s.cycle);
      expect(cycles).toEqual(
        Array.from({ length: cycles.length }, (_, n) => (cycles[0] as number) + n),
      );
      // ...and the stage FAMILY sequence is monotone even when the slot is not: an instruction may
      // change seat, but it never travels backward through the pipe.
      const families = rec.follow(id).map((s) => s.location.split('.')[0]!);
      const order = ['IF', 'ID', 'EX', 'MEM', 'WB'];
      const ranks = families.map((f) => order.indexOf(f));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });
});

describe('TraceRecorder × superscalar: the recorded `micro` tracks the timeline, per slot', () => {
  const sumLoop = readFileSync(`${PROGRAMS_DIR}sum-loop.s`, 'utf8');

  it.each([
    ['width 1', W1, 56],
    ['width 2', W2, 44],
  ])('latch slot arrays name next cycle’s occupants [%s]', (_label, config, expected) => {
    // The time-travel expression of step 2a's aliasing fix, one axis wider than M3's version: the
    // latch contents recorded at the END of cycle i name exactly the instructions the recording
    // places in ID/EX/MEM/WB at cycle i+1 — SLOT BY SLOT.
    //
    // Step 2a caught the engine aliasing these arrays instead of `.slice()`ing them, and named the
    // consequence precisely: final-state conformance is structurally blind to aliasing, so it would
    // have surfaced as a corrupt RECORDING, far from its cause. This is the test at the layer where
    // that corruption would actually appear — every recorded cycle's `micro` would otherwise report
    // the FINAL cycle's occupants, and this would fail at cycle 0.
    const rec = recorderFor(sumLoop, config);
    rec.runToEnd();
    expect(rec.recordedCycles).toBe(expected);

    const width = config.issueWidth!;
    for (let i = 0; i < rec.recordedCycles - 1; i++) {
      const m = micro(rec.recorded[i]!);
      const next = rec.recorded[i + 1]!;
      expect(m.width).toBe(width);
      for (let s = 0; s < width; s++) {
        expect({
          ifId: m.ifId[s]?.instr,
          idEx: m.idEx[s]?.instr,
          exMem: m.exMem[s]?.instr,
          memWb: m.memWb[s]?.instr,
        }).toEqual({
          ifId: idAt(next, `ID.${s}`),
          idEx: idAt(next, `EX.${s}`),
          exMem: idAt(next, `MEM.${s}`),
          memWb: idAt(next, `WB.${s}`),
        });
      }
    }
  });
});

describe('TraceRecorder × superscalar: the recorded cache is a per-cycle snapshot', () => {
  /**
   * **This test was written because a provocation found a hole, not to confirm a passing one.**
   * Aliasing the cache into the snapshot (`cache: this.cache`) left all 694 tests in this package
   * GREEN — conformance, timing, pairing and the engine's own anti-aliasing test included. And it
   * is a genuine bug, not a stylistic one: unlike the four latches, which are rebuilt fresh every
   * cycle (`emptyLatches`) and therefore cannot alias, the cache is **single-buffered and mutated
   * in place** by `access()`. A shallow snapshot makes every recorded cycle share the FINAL cache,
   * so scrubbing back replays the machine as warm-from-the-start — cycle 0 shows lines it has not
   * fetched yet. Time-travel is the only layer at which that is observable.
   *
   * The engine's `does not alias slot arrays across cycles` test does not cover this: it asserts
   * ARRAY IDENTITY on `idEx`, which the fresh-rebuild discipline satisfies for free.
   */
  const arraySum = readFileSync(`${PROGRAMS_DIR}array-sum.s`, 'utf8');

  it('a cold cache stays cold when you scrub back to cycle 0', () => {
    const rec = recorderFor(arraySum, { ...W2, cache: CACHE_SMALL });
    rec.runToEnd();

    const validAt = (i: number): number =>
      (micro(rec.recorded[i]!).cache?.lines ?? []).filter((l) => l.valid).length;

    const first = validAt(0);
    const last = validAt(rec.recordedCycles - 1);

    // The cache warms up over the run — the recording must show that happening, not show the end
    // state everywhere. Under aliasing `first` equals `last` and this is the assertion that fails.
    expect(first).toBe(0);
    expect(last).toBeGreaterThan(0);

    // ...and it warms MONOTONICALLY: a line, once valid, never goes back to invalid in this model
    // (eviction replaces a line's tag, it does not clear its valid bit). A recording that replayed
    // one shared object would report a flat line here instead of a staircase.
    let prev = 0;
    for (let i = 0; i < rec.recordedCycles; i++) {
      const v = validAt(i);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }

    // The structural half: every cycle's cache is its OWN object, as are its lines. Identity is
    // what makes the counts above trustworthy rather than coincidental.
    const caches = rec.recorded.map((t) => micro(t).cache);
    expect(new Set(caches).size).toBe(rec.recordedCycles);
    const firstLines = micro(rec.recorded[0]!).cache!.lines;
    const lastLines = micro(rec.recorded[rec.recordedCycles - 1]!).cache!.lines;
    expect(firstLines[0]).not.toBe(lastLines[0]);
  });
});

describe('TraceRecorder × superscalar: the width toggle, through the shipped API', () => {
  const sumLoop = readFileSync(`${PROGRAMS_DIR}sum-loop.s`, 'utf8');

  it('same program, same answers, fewer cycles — and slot 1 is what does it', () => {
    // The product's flagship A/B (spec §12 / the pinned width decision), asserted the way a user
    // experiences it rather than as an engine-internal count: load the same source twice, flip one
    // config field, and compare the two RECORDINGS.
    const narrow = recorderFor(sumLoop, W1);
    const wide = recorderFor(sumLoop, W2);
    narrow.runToEnd();
    wide.runToEnd();

    expect([...wide.currentState().registers]).toEqual([...narrow.currentState().registers]);
    expect(wide.recordedCycles).toBeLessThan(narrow.recordedCycles);
    expect([narrow.recordedCycles, wide.recordedCycles]).toEqual([56, 44]);

    // ...and the mechanism is visible in the recording, not merely in the total: the narrow run
    // never fills a second seat anywhere, ever, while the wide one does so constantly. This is the
    // "1-wide is an honest machine that simply never finds a pair" claim, cashed at the trace layer.
    const usedSlot1 = (rec: TraceRecorder): number =>
      rec.recorded.filter((t) => t.instructions.some((i) => i.location.endsWith('.1'))).length;
    expect(usedSlot1(narrow)).toBe(0);
    expect(usedSlot1(wide)).toBeGreaterThan(20);

    // Every location the narrow run emits is a slot-0 one — the encoding does not change with the
    // width, which is what lets a view read both recordings with one spelling.
    const narrowLocations = new Set(
      narrow.recorded.flatMap((t) => t.instructions.map((i) => i.location)),
    );
    expect([...narrowLocations].every((l) => l.endsWith('.0'))).toBe(true);
  });
});
