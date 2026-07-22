import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { CACHE_LARGE, toProgramImage } from '@cpu-viz/engine-common';
import {
  defaultConfig,
  TraceRecorder,
  type CycleTrace,
  type ProcessorConfig,
} from '@cpu-viz/trace';
import { OutOfOrderProcessor } from './index';

/**
 * Time-travel over the out-of-order model. The first two-thirds of this file (through "the width
 * toggle") is M9 step 1a's original suite, unchanged; the sections below "step 4" are new. Like
 * every earlier model's recorder suite, the whole file is a PROOF, not a build:
 * `packages/trace/src/recorder.ts` is UNTOUCHED. `follow()` keys on `id`, never on `location`, and
 * `InstructionSighting.location`'s own doc already cites `"ROB#3"` as an example — so this model's
 * `location` needed no recorder change either.
 *
 * ## Why this file is SHORTER than the superscalar/pipeline recorder suites
 *
 * Those suites spend most of their length on two things this model does not have:
 *
 *  - **Slot arrays / `micro`.** `MachineState.micro` stays unset all the way through step 4 (see
 *    `rob.ts`'s file header) — there is no per-slot latch state to prove doesn't alias across
 *    cycles, and no "a slot is not a stable lane" story to tell, because there is no slot. An
 *    in-flight instruction's `location` is `"ROB#<tag>"` for its ENTIRE dispatch-to-commit
 *    lifetime — the opposite claim from superscalar's, and the one this file pins instead.
 *  - **Pairing/refusal mechanics.** There is no `pairing.test.ts` sibling here — dispatch has no
 *    instruction-mix rule (the file header explains where those rules actually live at 1a).
 *
 * What IS genuinely new at this layer and worth pinning (1a):
 *
 *  1. Recorder navigation (load → run → back → scrub) over a ROB-based engine.
 *  2. `location` is STABLE while in flight — the direct opposite of the superscalar's headline,
 *     and the thing a future step-6 view will rely on to draw one box per in-flight instruction
 *     without it jumping seats.
 *  3. INV-4 over concurrent in-flight instructions at `issueWidth: 2` — distinct tags, distinct
 *     ids, no aliasing.
 *  4. The width toggle, through the shipped API — same architectural answer, fewer cycles.
 *  5. `state.micro` is genuinely absent, not merely unchecked — a schema-shape assertion, since
 *     "no schema change at 1a" is a claim this file can make concrete.
 *
 * ## Step 4 — what none of the above ever exercised
 *
 * Every block above runs at the DEFAULT `outOfOrderIssue` (unset ⇒ false) — so as of step 3, this
 * file had never once driven the OoO scheduler itself *through the recorder*; it only proved the
 * recorder against 1a's in-order-issue baseline. Step 4 closes that gap and adds the one claim
 * that is genuinely new at THIS tier and belongs at the recorder layer, not `lifecycle.test.ts`'s
 * (raw-engine) or `scheduler.test.ts`'s (unit) layers:
 *
 *  6. Recorder navigation over a TRUE out-of-order recording (`outOfOrderIssue: true`) — the same
 *     load → run → back → scrub claim as (1), now over a scheduler that actually reorders.
 *  7. **Completion order ≠ commit order, read through the shipped `follow()`/`recorded` API.**
 *     `alu-op`/`mem-read`/`branch-resolved` (a result computed and broadcast) can fire for a
 *     YOUNGER instruction before an OLDER one; `instr-retire` (commit) never can — the ROB drains
 *     strictly oldest-first by construction. `follow()` itself only proves IDENTITY (a stable
 *     `"ROB#<tag>"` the whole time, per (2)) — the reordering lives entirely in the event stream,
 *     so this is `follow()` plus cross-id event comparison, not `follow()` alone.
 *  8. INV-4 under conditions 1a's own suite never provoked: the SAME static pc dispatched several
 *     times (a hot loop body) mints a fresh id every dynamic instance, several of which are
 *     in-flight AT ONCE (distinct ids, distinct ROB tags, no aliasing) — and one wrong-path
 *     speculative fetch of that same pc is squashed before ever reaching the ROB, and never
 *     retires. This is what "the recorder correctly represents true reordering and speculation",
 *     not just "the recorder still starts/stops/scrubs", concretely means.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

const W1: ProcessorConfig = { ...defaultConfig(), issueWidth: 1 };
const W2: ProcessorConfig = { ...defaultConfig(), issueWidth: 2 };

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
  const rec = new TraceRecorder(new OutOfOrderProcessor());
  rec.load(toProgramImage(asm(source)), config);
  return rec;
}

/**
 * Five independent instructions (each reads only x0, each writes a different register) then
 * `ecall` — nothing stalls, nothing waits on a broadcast, so at `issueWidth: 2` dispatch/issue
 * run flat-out at the ROB's own pace.
 */
const FIVE_INDEPENDENT = [
  '.text',
  ...Array.from({ length: 5 }, (_, n) => `addi x${n + 1}, x0, ${n + 1}`),
  'ecall',
].join('\n');

describe('TraceRecorder × out-of-order: load → run → back → scrub', () => {
  const sumLoop = readFileSync(`${PROGRAMS_DIR}sum-loop.s`, 'utf8');

  it('starts at the pre-run state', () => {
    const rec = recorderFor(sumLoop);
    expect(rec.cursor).toBe(-1);
    expect(rec.recordedCycles).toBe(0);
    expect(rec.currentState().registers[10]).toBe(0);
    expect(rec.currentState().halted).toBe(false);
  });

  it('runs to completion and parks at the final state', () => {
    const rec = recorderFor(sumLoop);
    rec.runToEnd();
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

  it('scrubs forward lazily, recording cycles on demand', () => {
    const rec = recorderFor(FIVE_INDEPENDENT);
    expect(rec.recordedCycles).toBe(0);
    rec.scrubTo(2);
    expect(rec.recordedCycles).toBe(3); // had to record 0..2 to get there
  });

  it('walks all the way back to the pre-run state', () => {
    const rec = recorderFor(FIVE_INDEPENDENT);
    rec.runToEnd();
    while (rec.stepBack()) {
      /* walk back to the pre-run state */
    }
    expect(rec.cursor).toBe(-1);
    expect(rec.currentState().registers[1]).toBe(0);
  });

  it('reaches the same final state as driving the engine by hand', () => {
    const direct = new OutOfOrderProcessor();
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

describe('TraceRecorder × out-of-order: `location` is STABLE while in flight', () => {
  it('an instruction’s location never changes across its dispatch-to-commit lifetime', () => {
    // The direct opposite of the superscalar's "a slot is not a stable lane": there are no seats
    // to change here, only a ROB slot the instruction owns for its whole in-flight life.
    const rec = recorderFor(FIVE_INDEPENDENT, W2);
    rec.runToEnd();

    const ids: string[] = [];
    for (const t of rec.recorded) {
      for (const i of t.instructions) if (!ids.includes(i.id)) ids.push(i.id);
    }
    expect(ids).toHaveLength(6); // 5 addi + ecall

    for (const id of ids) {
      const sightings = rec.follow(id);
      expect(sightings.length).toBeGreaterThan(0);

      // At most ONE `"IF"` sighting (the cycle it was fetched but not yet dispatched), and every
      // sighting after that is the SAME `"ROB#<tag>"` — never a second, different tag.
      const robLocations = sightings.filter((s) => s.location !== 'IF').map((s) => s.location);
      expect(new Set(robLocations).size).toBeLessThanOrEqual(1);

      // Every sighting is contiguous cycle-over-cycle — no gaps in the walk.
      const cycles = sightings.map((s) => s.cycle);
      expect(cycles).toEqual(Array.from({ length: cycles.length }, (_, n) => cycles[0]! + n));
    }
  });

  it('resolves several concurrently in-flight ids to distinct ROB tags (INV-4)', () => {
    const rec = recorderFor(FIVE_INDEPENDENT, W2);
    rec.runToEnd();

    // Somewhere mid-run, several of these should be simultaneously in the ROB (dispatched, not
    // yet committed) — read the cycle from the recording rather than assuming which one.
    const midCycle = rec.recorded.find(
      (t) => t.instructions.filter((i) => i.location.startsWith('ROB#')).length >= 3,
    );
    expect(midCycle).toBeDefined();

    const inRob = midCycle!.instructions.filter((i) => i.location.startsWith('ROB#'));
    const ids = inRob.map((i) => i.id);
    const locations = inRob.map((i) => i.location);
    expect(new Set(ids).size).toBe(ids.length); // distinct ids
    expect(new Set(locations).size).toBe(locations.length); // distinct tags — no aliasing
  });
});

describe('TraceRecorder × out-of-order: no `micro` state at step 1a', () => {
  it('never exposes micro state through the recording', () => {
    // The plan's explicit YAGNI call: the ROB/rename map are real private engine state, but
    // nothing consumes them through the trace yet, so `MachineState.micro` stays unset — a
    // schema-shape claim this test makes concrete rather than merely unchecked.
    const rec = recorderFor(readFileSync(`${PROGRAMS_DIR}sum-loop.s`, 'utf8'), W2);
    rec.runToEnd();
    expect(rec.currentState().micro).toBeUndefined();
    for (const t of rec.recorded) {
      expect(t.state.micro).toBeUndefined();
    }
  });
});

describe('TraceRecorder × out-of-order: the width toggle, through the shipped API', () => {
  const sumLoop = readFileSync(`${PROGRAMS_DIR}sum-loop.s`, 'utf8');

  it('same program, same answers, fewer cycles at width 2', () => {
    const narrow = recorderFor(sumLoop, W1);
    const wide = recorderFor(sumLoop, W2);
    narrow.runToEnd();
    wide.runToEnd();

    expect([...wide.currentState().registers]).toEqual([...narrow.currentState().registers]);
    expect(wide.recordedCycles).toBeLessThan(narrow.recordedCycles);
  });
});

// ===============================================================================================
// M9 STEP 4 — everything below drives the scheduler with `outOfOrderIssue: true`, which nothing
// above this line ever does. See the file header's "Step 4" section for what's genuinely new.
// ===============================================================================================

/**
 * The identical flagship config `lifecycle.test.ts` uses (width 2, out-of-order, static-taken,
 * `CACHE_LARGE`, `robSize: 32`) — deliberately not re-derived. Every cycle number asserted below
 * (18, 19, 41, …) is valid ONLY at this exact config; the file's own standing lesson (`array-sum.s`
 * bit a prior step for exactly this reason — see the M9 log) is not to let it drift.
 */
const OOO_ARRAY_SUM: ProcessorConfig = {
  ...defaultConfig(),
  issueWidth: 2,
  outOfOrderIssue: true,
  branchPrediction: 'static-taken',
  cache: CACHE_LARGE,
  robSize: 32,
};

/** The cycle a `type`-matching event with `instr === id` first fires, or `undefined`. */
function eventCycle(
  rec: TraceRecorder,
  type: CycleTrace['events'][number]['type'],
  id: string,
): number | undefined {
  for (const t of rec.recorded) {
    for (const e of t.events) {
      if (e.type === type && 'instr' in e && e.instr === id) return t.cycle;
    }
  }
  return undefined;
}

/**
 * The id that ever occupies ROB tag `tag` — dispatch is always in program order regardless of
 * `outOfOrderIssue`, so ROB tag number is a stable, index-like handle into a specific dynamic
 * instruction (mirrors `lifecycle.test.ts`'s own `idAtRobTag`, sourced from `rec.recorded` instead
 * of a raw trace array, since this file's whole point is going through the recorder).
 */
function idAtRobTag(rec: TraceRecorder, tag: number): string {
  const want = `ROB#${tag}`;
  for (const t of rec.recorded) {
    for (const inst of t.instructions) if (inst.location === want) return inst.id;
  }
  throw new Error(`no instruction ever occupied ${want}`);
}

/** The pc of a sighted id — read from the recording, never assumed. */
function pcOf(rec: TraceRecorder, id: string): number {
  for (const t of rec.recorded) {
    const inst = t.instructions.find((i) => i.id === id);
    if (inst) return inst.pc;
  }
  throw new Error(`id ${id} was never sighted`);
}

describe('TraceRecorder × out-of-order: TRUE out-of-order navigation', () => {
  const arraySum = readFileSync(`${PROGRAMS_DIR}array-sum.s`, 'utf8');

  it('runs the flagship OoO recording to completion — 41 cycles (fixture, pinned by lifecycle.test.ts)', () => {
    const rec = recorderFor(arraySum, OOO_ARRAY_SUM);
    expect(rec.cursor).toBe(-1);
    expect(rec.runToEnd()).toBe(41);
    expect(rec.atEnd).toBe(true);
    expect(rec.currentState().registers[10]).toBe(120);
    expect(rec.currentState().halted).toBe(true);
  });

  it('the shown state IS the recorded trace’s own snapshot at every cursor, over a reordering scheduler', () => {
    const rec = recorderFor(arraySum, OOO_ARRAY_SUM);
    rec.runToEnd();
    for (let i = 0; i < rec.recordedCycles; i++) {
      rec.scrubTo(i);
      expect(rec.currentState()).toBe(rec.current()!.state);
    }
  });

  it('scrubs forward lazily into a still-mid-miss cycle, then walks all the way back to pre-run', () => {
    const rec = recorderFor(arraySum, OOO_ARRAY_SUM);
    expect(rec.recordedCycles).toBe(0);
    rec.scrubTo(10); // mid-miss (detected@5, releases@15) — forces recording 0..10, no further
    expect(rec.recordedCycles).toBe(11);

    while (rec.stepBack()) {
      /* walk back to the pre-run state */
    }
    expect(rec.cursor).toBe(-1);
    expect(rec.currentState().registers[10]).toBe(0);
  });

  it('reaches the same final state as driving the engine by hand', () => {
    const direct = new OutOfOrderProcessor();
    direct.reset(toProgramImage(asm(arraySum)), OOO_ARRAY_SUM);
    while (!direct.isHalted()) direct.step();
    const expected = direct.getState();

    const rec = recorderFor(arraySum, OOO_ARRAY_SUM);
    rec.runToEnd();
    const actual = rec.currentState();

    expect([...actual.registers]).toEqual([...expected.registers]);
    for (const addr of expected.memory.definedAddresses()) {
      expect(actual.memory.readWord(addr)).toBe(expected.memory.readWord(addr));
    }
    expect(actual.halted).toBe(true);
  });
});

describe('TraceRecorder × out-of-order: completion order ≠ commit order (the step-4 payoff)', () => {
  const rec = recorderFor(readFileSync(`${PROGRAMS_DIR}array-sum.s`, 'utf8'), OOO_ARRAY_SUM);
  rec.runToEnd();

  // Fixtures already pinned by `lifecycle.test.ts` at this exact config, re-read here through the
  // recorder rather than re-derived: iteration 0's reduction add (ROB tag 5, the OLDER of this
  // pair) is stuck behind the load's 10-cycle miss and doesn't produce its result until cycle 16;
  // iteration 0's counter decrement (tag 7, YOUNGER) is independent of the miss and produces its
  // result at cycle 5 — eleven cycles before the older instruction it will still commit behind.
  const olderStuck = idAtRobTag(rec, 5); // `add a0,a0,t2`
  const youngerFree = idAtRobTag(rec, 7); // `addi t1,t1,-1`

  it('completion is OUT of program order: the younger instruction produces its result first', () => {
    const olderCompletes = eventCycle(rec, 'alu-op', olderStuck);
    const youngerCompletes = eventCycle(rec, 'alu-op', youngerFree);
    expect(olderCompletes).toBe(16);
    expect(youngerCompletes).toBe(5);
    expect(youngerCompletes!).toBeLessThan(olderCompletes!);
  });

  it('commit is IN program order: the older instruction retires first, despite completing last', () => {
    const olderRetires = eventCycle(rec, 'instr-retire', olderStuck);
    const youngerRetires = eventCycle(rec, 'instr-retire', youngerFree);
    expect(olderRetires).toBe(18);
    expect(youngerRetires).toBe(19);
    expect(youngerRetires!).toBeGreaterThan(olderRetires!);
  });

  it('follow() shows both as ordinary, contiguous, single-tag lifetimes — the divergence lives only in the event stream', () => {
    // The reordering above is invisible to `location` alone: a ROB tag is stable for an
    // instruction's whole in-flight life (pinned at 1a), so `follow()` proves IDENTITY, not the
    // reordering — the payoff above is `follow()` PLUS cross-id event comparison, not `follow()`
    // alone. Confirmed here rather than assumed.
    for (const [id, tag] of [
      [olderStuck, 5],
      [youngerFree, 7],
    ] as const) {
      const sightings = rec.follow(id);
      expect(sightings.length).toBeGreaterThan(0);

      const robLocations = sightings.filter((s) => s.location !== 'IF').map((s) => s.location);
      expect(new Set(robLocations)).toEqual(new Set([`ROB#${tag}`]));

      const cycles = sightings.map((s) => s.cycle);
      expect(cycles).toEqual(Array.from({ length: cycles.length }, (_, n) => cycles[0]! + n));
    }
  });
});

describe('TraceRecorder × out-of-order: INV-4 under true reordering and speculation', () => {
  it('a hot loop-body pc mints a fresh id every dynamic instance — several in flight at once, one squashed before ever reaching the ROB', () => {
    const rec = recorderFor(readFileSync(`${PROGRAMS_DIR}array-sum.s`, 'utf8'), OOO_ARRAY_SUM);
    rec.runToEnd();

    // The load's pc, read from the recording (tag 4 — see lifecycle.test.ts's setup/iteration
    // layout) — never hardcode an id string, `follow()`/`recorded` is what has to resolve it.
    const loadPc = pcOf(rec, idAtRobTag(rec, 4));

    const idsAtPc = new Set<string>();
    for (const t of rec.recorded) {
      for (const inst of t.instructions) if (inst.pc === loadPc) idsAtPc.add(inst.id);
    }
    // 5 real dynamic iterations + one speculative fetch of the SAME pc that the final iteration's
    // misprediction discards before it ever dispatches — dumped and read, not assumed.
    expect(idsAtPc.size).toBe(6);

    const reachedRob = [...idsAtPc].filter((id) =>
      rec.follow(id).some((s) => s.location.startsWith('ROB#')),
    );
    const ifOnly = [...idsAtPc].filter((id) => !reachedRob.includes(id));
    expect(reachedRob).toHaveLength(5);
    expect(ifOnly).toHaveLength(1);

    // Every real dynamic instance commits; the squashed one never does — the strong "never
    // happened" form the pipeline models use for a flushed instruction.
    for (const id of reachedRob) expect(eventCycle(rec, 'instr-retire', id)).toBeDefined();
    expect(eventCycle(rec, 'instr-retire', ifOnly[0]!)).toBeUndefined();

    // Several of the five real instances are in the ROB AT THE SAME TIME (the miss lets later
    // iterations dispatch before the stuck one resolves) — INV-4's promise is that concurrent
    // in-flight instances of the SAME static pc still keep distinct ids and distinct ROB tags,
    // never aliasing. Confirmed, not assumed: this is exactly the "not sheddable" identity claim
    // wrong-path re-fetching would have broken back at step 1b.
    const tags = reachedRob.map(
      (id) => rec.follow(id).find((s) => s.location.startsWith('ROB#'))!.location,
    );
    expect(new Set(tags).size).toBe(tags.length);
  });
});
