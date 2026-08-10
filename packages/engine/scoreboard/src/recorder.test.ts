import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import {
  defaultConfig,
  TraceRecorder,
  type CycleTrace,
  type ProcessorConfig,
} from '@cpu-viz/trace';
import { ScoreboardProcessor, type ScoreboardMicro } from './index';

/**
 * Time-travel over the scoreboard (M15 step 4). Like every earlier model's recorder suite this is a
 * **PROOF, not a build**: `packages/trace/src/recorder.ts` is UNTOUCHED, and so is `processor.ts` —
 * which is also how step 3's "what step 4 must not break" note is discharged. Nothing here narrows
 * what a cycle retains, so `timing.test.ts`'s two identities (which read `micro.instructions`) keep
 * reading the same tables; the one line that pins that retention explicitly is at the end of the
 * scrub block, not a section of its own.
 *
 * ## What this file deliberately does NOT re-prove
 *
 * `processor.test.ts` already pins, by hand and against stubbed code, the things a recorder would
 * only re-read through a cursor: the architectural **`pc` timeline** and its monotonicity (the
 * step-1 finding — `pc` advances across the completed program-order PREFIX, never "whoever wrote
 * last"), that each cycle's **`micro` is its own object** and an early cycle still shows an idle
 * memory unit after a later one fills it, and that an **id appears in a contiguous run of cycles and
 * never reappears** (INV-4). `timing.test.ts` owns every cycle COUNT in the corpus. Driving any of
 * them through a recorder would not make them truer.
 *
 * Aliasing is worth one sentence on why it is cheap here rather than a block: `snapshotMicro`
 * value-copies everything it emits — fresh row literals and `[...this.result]` — so this model has
 * no in-place-mutated view object of the kind M9's ROB entries are, and no `.slice()` trap to spring.
 *
 * ## What IS new at this layer
 *
 *  1. **Recorder navigation over a recording that completes out of order** — the step-4 acceptance
 *     criterion verbatim: load → run to halt → step back to the start → scrub to any cycle, with
 *     the shown state always that cycle's own recorded snapshot.
 *  2. **`follow()` — the SHIPPED API, the one the web calls — across CROSSING lifetimes.** The
 *     plan's acceptance criterion 4 was half met at step 1 (the out-of-order write-back is asserted
 *     by cycle there); `follow()` is the recorder's, so the other half is here. This is the first
 *     model in the product where a followed instruction's walk is *strictly contained inside*
 *     another instruction's walk — started later, finished earlier — with nothing to put them back
 *     in order.
 *  3. **The three walk SHAPES a scoreboard draws**, which is what step 7's view has to render and
 *     what no sibling model's recording expresses:
 *     - an **Issue stall repeats the `IF` cell while the stall EVENT says `stage: 'ID'`**. Every
 *       latch machine in the product puts a stalled instruction *in* the stage that stalled it;
 *       here Issue is a transition, not a latch, so the instruction never leaves `ifSlot` and
 *       `location` and `stall.stage` legitimately disagree. A view that highlights `stall.stage`
 *       will light a cell the instruction is not in.
 *     - a **WAR stall repeats `WB` — the LAST cell.** Every other stall anywhere in this product
 *       repeats an early cell, because every other stall fires at the beginning of an instruction's
 *       life. This is the one that fires at the end.
 *     - an **operand stall repeats `RO`**, and costs no issue slot (`RO` is per-FU and
 *       non-blocking), which is why `timing.test.ts` cannot see it in either identity.
 *  4. **A flush cycle carries TWO ids at `location: 'IF'`, and `micro` gives a row to only one of
 *     them.** The casualty and the target fetched in its place are both `'IF'` in
 *     `trace.instructions` (pinned at the raw layer in `processor.test.ts`), but `snapshotMicro`
 *     rows only `this.ifSlot` — never `ctx.flushed`. So the two tables a view draws from disagree
 *     about who is in the machine that cycle, deliberately: the casualty is a casualty, not an
 *     occupant. Pinned here so step 7 does not "fix" one to match the other. Through `follow()` the
 *     same fact reads as: the flushed id is sighted only at `IF` and never retires.
 *  5. **The pre-run cursor (-1) over this model's `micro`** — `emptyMicro()`: three idle unit rows,
 *     no instruction rows, 32 unclaimed registers. Reachable only through `load()`, so no earlier
 *     test could have covered it.
 *
 * ## Configuration
 *
 * ONE config, and it is `defaultConfig()` itself — this model honors no knob (step 2's finding, and
 * the reason its differential matrix is one column too). `cache: null` is not written explicitly
 * the way `deep-pipeline`'s recorder suite writes it: there it guards a knob the model HONORS, here
 * the default is already the only value `reset()` will accept, and every other knob is inert.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

function asm(source: string): AssembledProgram {
  const { program, errors } = assemble(source);
  if (!program) {
    throw new Error(
      'assembly failed:\n' + errors.map((e) => `  ${e.line}:${e.column} ${e.message}`).join('\n'),
    );
  }
  return program;
}

function recorderFor(source: string, config: ProcessorConfig = defaultConfig()): TraceRecorder {
  const rec = new TraceRecorder(new ScoreboardProcessor());
  rec.load(toProgramImage(asm(source)), config);
  return rec;
}

const micro = (t: CycleTrace): ScoreboardMicro => t.state.micro as ScoreboardMicro;

/** The followed walk as a bare location sequence — the shape, with every stall cell still in it. */
function walk(rec: TraceRecorder, id: string): string[] {
  return rec.follow(id).map((s) => s.location);
}

/** A walk with consecutive repeats collapsed — the STAGE SEQUENCE, stalls factored out. */
function collapsed(locations: readonly string[]): string[] {
  return locations.filter((loc, i) => loc !== locations[i - 1]);
}

/** Every id the recording ever sights, in first-sighting order. */
function allIds(rec: TraceRecorder): string[] {
  const ids: string[] = [];
  for (const t of rec.recorded) {
    for (const i of t.instructions) if (!ids.includes(i.id)) ids.push(i.id);
  }
  return ids;
}

/** `.data` holding two known words at `DATA_BASE`, addressed by `lui x5, 0x10000`. */
const DATA = '    .data\nv:  .word 11, 22\n';

/**
 * The out-of-order write-back witness, **re-used verbatim from `processor.test.ts`'s
 * "out-of-order write-back" block rather than re-derived** — its cycle numbers are already pinned
 * there and reproducing the derivation would give the same table two owners.
 *
 * ```
 * lui  x5, 0x10000   INT0   IF 0  ID 1  RO 2      EX 3      WB 4
 * lw   x1, 0(x5)     MEM    IF 1  ID 2  RO 3..5   MEM 6..9  WB 10
 * addi x2, x0, 1     INT1   IF 2  ID 3  RO 4      EX 5      WB 6
 * addi x3, x0, 2     INT0   IF 3  ID 5  RO 6      EX 7      WB 8
 * ```
 *
 * The load holds `RO` for three cycles waiting on `x5`, and the fourth instruction is held one
 * cycle at Issue because both integer units are busy — neither is a new claim, but both are
 * load-bearing for the walks below.
 */
const OOO_WITNESS =
  DATA +
  '    .text\n_start:\n' +
  '    lui  x5, 0x10000\n' +
  '    lw   x1, 0(x5)\n' +
  '    addi x2, x0, 1\n' +
  '    addi x3, x0, 2\n';

/**
 * The WAR witness, likewise re-used verbatim from `processor.test.ts` — and it is the one program
 * that draws all three of this model's stall shapes at once, which is why the walk-shape block
 * below uses it rather than three separate toys.
 *
 * ```
 * lui  x5, 0x10000   INT0   IF 0     ID 1  RO 2      EX 3      WB 4
 * addi x2, x0, 3     INT1   IF 1     ID 2  RO 3      EX 4      WB 5
 * lw   x1, 0(x5)     MEM    IF 2     ID 3  RO 4..5   MEM 6..9  WB 10
 * add  x3, x1, x2    INT0   IF 3..4  ID 5  RO 6..11  EX 12     WB 13
 * addi x2, x0, 5     INT1   IF 5     ID 6  RO 7      EX 8      WB 9..12
 * ```
 */
const WAR_WITNESS =
  DATA +
  '    .text\n_start:\n' +
  '    lui  x5, 0x10000\n' +
  '    addi x2, x0, 3\n' +
  '    lw   x1, 0(x5)\n' +
  '    add  x3, x1, x2\n' +
  '    addi x2, x0, 5\n';

/** The control witness — a taken branch, one casualty in `IF`, one target fetched in its place. */
const CONTROL_WITNESS =
  '    .text\n_start:\n' +
  '    addi x1, x0, 1\n' +
  '    beq  x0, x0, target\n' +
  '    addi x2, x0, 99\n' +
  'target:\n' +
  '    addi x3, x0, 7\n';

describe('TraceRecorder × scoreboard: load → run → back → scrub', () => {
  it('starts at the pre-run state, with all three units idle and no register claimed', () => {
    const rec = recorderFor(OOO_WITNESS);
    expect(rec.cursor).toBe(-1);
    expect(rec.recordedCycles).toBe(0);
    expect(rec.currentState().registers[1]).toBe(0);
    expect(rec.currentState().halted).toBe(false);

    // `emptyMicro()` — reachable only through `load()`, so nothing before step 4 covered it. The
    // three tables exist from the first frame, which is what lets step 7's view draw a stable
    // layout instead of appearing when the first instruction issues.
    const m = rec.currentState().micro as ScoreboardMicro;
    expect(m.instructions).toEqual([]);
    expect(m.units.map((u) => [u.name, u.busy])).toEqual([
      ['INT0', false],
      ['INT1', false],
      ['MEM', false],
    ]);
    expect(m.registerResult).toHaveLength(32);
    expect(m.registerResult.every((r) => r === null)).toBe(true);
  });

  it('runs forward to completion and parks at the final state', () => {
    const rec = recorderFor(OOO_WITNESS);
    // Eleven cycles, ending on the load's write-back at 10 — the timeline in the docblock above.
    // The program has no `ecall`: it halts by DRAINING, with `pc` past the end of text.
    expect(rec.runToEnd()).toBe(11);
    expect(rec.atEnd).toBe(true);
    expect(rec.currentState().registers[1]).toBe(11); // the loaded word
    expect(rec.currentState().registers[3]).toBe(2);
    expect(rec.currentState().pc).toBe(16);
    expect(rec.currentState().halted).toBe(true);
  });

  it('the shown state IS the recorded trace’s own snapshot at every cursor', () => {
    const rec = recorderFor(OOO_WITNESS);
    rec.runToEnd();
    for (let i = 0; i < rec.recordedCycles; i++) {
      rec.scrubTo(i);
      expect(rec.currentState()).toBe(rec.current()!.state);
    }
  });

  it('scrubs to any cycle; the value shown is that cycle’s own recorded snapshot', () => {
    const rec = recorderFor(OOO_WITNESS);
    rec.runToEnd();
    // x2 and x3 are written by the two YOUNGER instructions, at 6 and 8; x1 by the older load, at
    // 10. Scrubbing between them is what makes the reordering visible as state rather than as an
    // event: at cycle 8 the machine has already written both younger destinations and not the
    // older one — a picture no in-order model in this product can produce.
    expect(rec.scrubTo(5)).toBe(5); // scrubTo returns the cursor
    expect([...rec.currentState().registers.slice(1, 4)]).toEqual([0, 0, 0]);
    rec.scrubTo(6);
    expect([...rec.currentState().registers.slice(1, 4)]).toEqual([0, 1, 0]);
    rec.scrubTo(8);
    expect([...rec.currentState().registers.slice(1, 4)]).toEqual([0, 1, 2]);
    rec.scrubTo(10);
    expect([...rec.currentState().registers.slice(1, 4)]).toEqual([11, 1, 2]);
  });

  it('scrubs forward lazily, recording cycles on demand', () => {
    const rec = recorderFor(OOO_WITNESS);
    expect(rec.recordedCycles).toBe(0);
    rec.scrubTo(6); // the first cycle a YOUNGER instruction has overtaken the load
    expect(rec.recordedCycles).toBe(7); // had to record 0..6 to get there
    expect(rec.currentState().registers[2]).toBe(1);
  });

  it('walks all the way back to the pre-run state', () => {
    const rec = recorderFor(OOO_WITNESS);
    rec.runToEnd();
    while (rec.stepBack()) {
      /* walk back to the pre-run state */
    }
    expect(rec.cursor).toBe(-1);
    expect(rec.currentState().registers[1]).toBe(0);
    expect(rec.currentState().halted).toBe(false);
  });

  it('reaches the same final state as driving the engine by hand', () => {
    const direct = new ScoreboardProcessor();
    direct.reset(toProgramImage(asm(WAR_WITNESS)), defaultConfig());
    while (!direct.isHalted()) direct.step();
    const expected = direct.getState();

    const rec = recorderFor(WAR_WITNESS);
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

describe('TraceRecorder × scoreboard: follow() across CROSSING lifetimes', () => {
  // The plan's acceptance criterion 4, whose second half step 1 explicitly deferred here: "two
  // instructions provably write back out of program order, and `follow()` tracks each across the
  // other". Step 1 owns the write-back cycles; this owns the tracking.

  it('follows all four instructions through their own out-of-order walks', () => {
    const rec = recorderFor(OOO_WITNESS);
    rec.runToEnd();
    const ids = allIds(rec);
    expect(ids).toEqual(['i0', 'i1', 'i2', 'i3']);

    // Read straight off the docblock's table. The load's three `RO` cells are it waiting for `x5`;
    // the last instruction's two `IF` cells are it held at Issue with both integer units busy.
    expect(rec.follow('i0')).toEqual([
      { cycle: 0, location: 'IF' },
      { cycle: 1, location: 'ID' },
      { cycle: 2, location: 'RO' },
      { cycle: 3, location: 'EX' },
      { cycle: 4, location: 'WB' },
    ]);
    expect(walk(rec, 'i1')).toEqual([
      'IF',
      'ID',
      'RO',
      'RO',
      'RO',
      'MEM',
      'MEM',
      'MEM',
      'MEM',
      'WB',
    ]);
    expect(walk(rec, 'i2')).toEqual(['IF', 'ID', 'RO', 'EX', 'WB']);
    expect(walk(rec, 'i3')).toEqual(['IF', 'IF', 'ID', 'RO', 'EX', 'WB']);
  });

  it('two younger lifetimes live entirely INSIDE the older load’s — started later, finished earlier', () => {
    const rec = recorderFor(OOO_WITNESS);
    rec.runToEnd();

    const span = (id: string): [number, number] => {
      const s = rec.follow(id);
      return [s[0]!.cycle, s[s.length - 1]!.cycle];
    };
    const [loadFrom, loadTo] = span('i1');
    expect([loadFrom, loadTo]).toEqual([1, 10]);

    // Strict containment, both ends, for both younger instructions. This is the shape the product
    // has never had before: `follow()` on the older instruction and `follow()` on the younger one
    // overlap for the younger one's WHOLE life, and the younger one is finished first.
    for (const younger of ['i2', 'i3']) {
      const [from, to] = span(younger);
      expect(from).toBeGreaterThan(loadFrom);
      expect(to).toBeLessThan(loadTo);
    }
  });

  it('completion order is the REVERSE of program order, and there is nothing to put it back', () => {
    const rec = recorderFor(OOO_WITNESS);
    rec.runToEnd();

    // The last cell of each walk is its Write-Result. Read through `follow()` rather than through
    // the event stream, because `follow()` is what the web calls and what step 7 draws.
    const writeCycle = (id: string): number => {
      const s = rec.follow(id);
      const last = s[s.length - 1]!;
      expect(last.location).toBe('WB');
      return last.cycle;
    };
    expect(['i0', 'i1', 'i2', 'i3'].map(writeCycle)).toEqual([4, 10, 6, 8]);

    // `instr-retire` follows write-back exactly — the distinction from M9, stated as an assertion:
    // there is no reorder buffer here, so retirement IS write-back and cannot be reordered back
    // into program order. On the out-of-order model these two lists disagree; here they cannot.
    const retires = rec.recorded.flatMap((t) =>
      t.events.filter((e) => e.type === 'instr-retire').map((e) => e.instr),
    );
    expect(retires).toEqual(['i0', 'i2', 'i3', 'i1']);
  });
});

describe('TraceRecorder × scoreboard: the walk shapes step 7 has to draw', () => {
  // One program, all three stall shapes — see WAR_WITNESS's docblock for the derivation.

  it('an Issue stall repeats the IF cell, while the stall EVENT says stage ID', () => {
    const rec = recorderFor(WAR_WITNESS);
    rec.runToEnd();

    // `add x3, x1, x2` is fetched at 3 and cannot issue at 4 — both integer units are busy — so it
    // is still sitting in the fetch slot. Issue is a transition on this machine, not a latch: there
    // is no `ID` cell to hold it in.
    expect(walk(rec, 'i3').slice(0, 3)).toEqual(['IF', 'IF', 'ID']);

    // ...and the disagreement, stated outright so a view author meets it here rather than in the
    // browser: the SAME cycle's stall event names stage `ID`, a cell the instruction is not in.
    const stall = rec.recorded[4]!.events.find((e) => e.type === 'stall' && e.instr === 'i3');
    expect(stall).toMatchObject({ reason: 'structural-int', stage: 'ID' });
    expect(rec.follow('i3').find((s) => s.cycle === 4)!.location).toBe('IF');
  });

  it('a WAR stall repeats WB — the only stall in the product that holds the LAST cell', () => {
    const rec = recorderFor(WAR_WITNESS);
    rec.runToEnd();

    // `addi x2, x0, 5` finishes executing at 8 and is then held at Write-Result for three cycles,
    // because the older `add` still holds an unread copy of x2. Its walk ENDS in a run of repeats
    // instead of beginning with one: four `WB` cells, the last of which is the write that lands.
    expect(walk(rec, 'i4')).toEqual(['IF', 'ID', 'RO', 'EX', 'WB', 'WB', 'WB', 'WB']);
    const held = rec.follow('i4').filter((s) => s.location === 'WB');
    expect(held.map((s) => s.cycle)).toEqual([9, 10, 11, 12]);

    // The first three of those cells carry a `war` stall and the fourth carries the write, so the
    // repeat is the stall rather than an artefact of how the cycle is snapshotted.
    for (const cycle of [9, 10, 11]) {
      expect(rec.recorded[cycle]!.events).toContainEqual({
        type: 'stall',
        reason: 'war',
        stage: 'WB',
        instr: 'i4',
      });
    }
    expect(rec.recorded[12]!.events).toContainEqual({
      type: 'reg-write',
      reg: 2,
      value: 5,
      instr: 'i4',
    });
  });

  it('an operand stall repeats RO, and the instruction behind it sails past', () => {
    const rec = recorderFor(WAR_WITNESS);
    rec.runToEnd();

    // `add x3, x1, x2` waits six cycles at Read Operands for the load's x1. `RO` is per-FU and
    // non-blocking, which is exactly why this is a walk-shape claim and not a timing one: the
    // younger `addi x2, x0, 5` runs its ENTIRE life up to Write-Result inside that window — which
    // is what makes WAR reachable at all on this machine, and is what the WAR check then stops.
    expect(walk(rec, 'i3')).toEqual([
      'IF',
      'IF',
      'ID',
      'RO',
      'RO',
      'RO',
      'RO',
      'RO',
      'RO',
      'EX',
      'WB',
    ]);
    const parked = rec.follow('i3').filter((s) => s.location === 'RO');
    expect(parked.map((s) => s.cycle)).toEqual([6, 7, 8, 9, 10, 11]);

    // Issue, Read Operands, Execute and its FIRST Write-Result cell all land inside cycles 6..11 —
    // the exact span the older instruction spends parked. Note the younger one is FETCHED at 5,
    // one cycle before the older one enters `RO`: the containment is of its post-Issue life, not
    // of its whole walk, and the two are one cycle apart here.
    const younger = rec.follow('i4');
    const inside = younger.filter((s) => s.location !== 'IF');
    expect(inside.map((s) => s.cycle)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    for (const s of inside.slice(0, 4)) {
      expect(s.cycle).toBeGreaterThanOrEqual(parked[0]!.cycle);
      expect(s.cycle).toBeLessThanOrEqual(parked[parked.length - 1]!.cycle);
    }
    // And the release is causal, not coincidental: the older instruction reads at 11, so the
    // younger one's write lands at 12 — the cycle after, never the cycle of.
    expect(younger[younger.length - 1]!.cycle).toBe(parked[parked.length - 1]!.cycle + 1);
  });

  it('every instruction that issues shows exactly ONE ID cell — Issue is one cycle, always', () => {
    // True of every recording, not just this one: an instruction reaches a functional unit in the
    // cycle it issues and never returns to Issue. The corpus form is in the sum-loop block below,
    // where flushed instructions make the count 0 for some ids and 1 for the rest.
    const rec = recorderFor(WAR_WITNESS);
    rec.runToEnd();
    for (const id of allIds(rec)) {
      expect(walk(rec, id).filter((l) => l === 'ID')).toHaveLength(1);
    }
  });
});

describe('TraceRecorder × scoreboard: the flush casualty, through both tables', () => {
  it('a flush cycle sights TWO ids at IF, and micro rows only the survivor', () => {
    const rec = recorderFor(CONTROL_WITNESS);
    rec.runToEnd();

    // The branch resolves in cycle 4: `executeSlot` moves the fall-through instruction out of the
    // fetch slot into the cycle's casualty field and redirects, and `stageFetch` — walked after
    // Execute — fills the now-empty slot from the target in the SAME cycle.
    const atIf = rec.recorded[4]!.instructions.filter((i) => i.location === 'IF');
    expect(atIf.map((i) => i.id)).toEqual(['i2', 'i3']);

    // The two tables a view draws from disagree here, deliberately: `micro.instructions` rows the
    // fetch slot's occupant only, because the casualty is a casualty and not an occupant of the
    // machine. Pinned so step 7 does not quietly "fix" one to match the other.
    const rowsAtIf = micro(rec.recorded[4]!).instructions.filter((r) => r.issue === null);
    expect(rowsAtIf.map((r) => r.instr)).toEqual(['i3']);
  });

  it('follow() sights the casualty only at IF, and it never retires', () => {
    const rec = recorderFor(CONTROL_WITNESS);
    rec.runToEnd();

    // The strong "never happened" form: two sightings, both `IF` (fetched at 2, held at 3 by the
    // `control` stall, killed at 4 — the cycle it is last seen), no unit, no write, no retire.
    expect(rec.follow('i2')).toEqual([
      { cycle: 2, location: 'IF' },
      { cycle: 3, location: 'IF' },
      { cycle: 4, location: 'IF' },
    ]);
    const retires = rec.recorded.flatMap((t) =>
      t.events.filter((e) => e.type === 'instr-retire').map((e) => e.instr),
    );
    expect(retires).not.toContain('i2');
    expect(rec.currentState().registers[2]).toBe(0);

    // Its successor at the branch target is a different instruction with a full life of its own —
    // the casualty is not simply the same id re-fetched (INV-4, in the one place it could break).
    expect(collapsed(walk(rec, 'i3'))).toEqual(['IF', 'ID', 'RO', 'EX', 'WB']);
  });
});

describe('TraceRecorder × scoreboard: scrubbing the instruction-status table', () => {
  it('one row’s writeResult column fills in across cursors, never showing final state early', () => {
    const rec = recorderFor(OOO_WITNESS);
    rec.runToEnd();

    // What a view's scrub actually does: read ONE instruction's row at three cursors. The load
    // writes at cycle 10, so its row must read `null` at every earlier cursor. A table that
    // aliased the live scoreboard would answer 10 at all three.
    const rowAt = (cycle: number): number | null | undefined => {
      rec.scrubTo(cycle);
      const m = rec.currentState().micro as ScoreboardMicro;
      return m.instructions.find((r) => r.instr === 'i1')?.writeResult;
    };
    expect([rowAt(4), rowAt(9), rowAt(10)]).toEqual([null, null, 10]);

    // The same claim on the unit table and the register-result table, which the other two thirds of
    // step 7's view draw: the memory unit is busy while the load is in it and idle once it has
    // written, and `x1`'s claim is held by `MEM` and then released.
    rec.scrubTo(7);
    const mid = rec.currentState().micro as ScoreboardMicro;
    expect(mid.units.find((u) => u.name === 'MEM')).toMatchObject({ busy: true, op: 'lw', fi: 1 });
    expect(mid.registerResult[1]).toBe('MEM');
    rec.scrubTo(10);
    const end = rec.currentState().micro as ScoreboardMicro;
    expect(end.units.find((u) => u.name === 'MEM')?.busy).toBe(false);
    expect(end.registerResult[1]).toBe(null);
  });

  it('every cycle keeps the row of whoever wrote its result THAT cycle (timing.test.ts’s dependency)', () => {
    // Step 3's two identities read `micro.instructions` — `s_last` from the `issue` column and the
    // last writer from `writeResult` — and they are computable only because a row stays visible in
    // the cycle it completes. Stated here, at the layer that could narrow it, as one assertion
    // rather than a section: narrowing the retention reddens both files, and this is the one that
    // says why.
    const rec = recorderFor(WAR_WITNESS);
    rec.runToEnd();
    for (const t of rec.recorded) {
      for (const e of t.events) {
        if (e.type !== 'instr-retire') continue;
        const row = micro(t).instructions.find((r) => r.instr === e.instr);
        expect(row?.writeResult).toBe(t.cycle);
      }
    }
  });
});

describe('TraceRecorder × scoreboard: a real corpus recording', () => {
  const sumLoop = readFileSync(`${PROGRAMS_DIR}sum-loop.s`, 'utf8');

  it('mints a fresh id per loop iteration and follows each through its own walk', () => {
    const rec = recorderFor(sumLoop);
    rec.runToEnd();
    expect(rec.currentState().registers[10]).toBe(55); // a0 = 10+9+...+1

    // The loop body's `add a0, a0, t0` sits at a fixed pc and is re-fetched every iteration.
    const LOOP_ADD_PC = 8;
    const ids: string[] = [];
    for (const t of rec.recorded) {
      for (const i of t.instructions) {
        if (i.pc === LOOP_ADD_PC && !ids.includes(i.id)) ids.push(i.id);
      }
    }
    expect(ids).toHaveLength(10); // ten iterations, ten fresh ids (INV-4)

    // Asserted with consecutive repeats COLLAPSED — `timing.test.ts` owns the count of those
    // repeats, this owns the shape: every dynamic instance visits Issue, Read Operands, Execute and
    // Write-Result in that order and never revisits one it has left.
    for (const id of ids) {
      expect(collapsed(walk(rec, id))).toEqual(['IF', 'ID', 'RO', 'EX', 'WB']);
    }
    // ...and a repeat really is in there, so the collapse is doing work rather than hiding a
    // machine that never stalls — but it is in EXACTLY ONE of the ten walks, and the asymmetry is
    // worth stating because it is easy to assume the opposite. Iteration 1's `add` is fetched into
    // a machine still holding both `li`s, so it is held at Issue for two cycles on `structural-int`
    // (a seven-cell walk). Every later iteration's `add` is fetched only after a taken `bnez`,
    // which — Issue having been held since that branch issued — hands it a nearly drained machine
    // whose operands are long since written. So the stall belongs to the loop's ENTRY, not to its
    // body, and the steady state is a clean five.
    const stalled = ids.filter((id) => walk(rec, id).length > 5);
    expect(stalled).toHaveLength(1);
    expect(stalled[0]).toBe(ids[0]);
    expect(walk(rec, ids[0]!)).toEqual(['IF', 'IF', 'IF', 'ID', 'RO', 'EX', 'WB']);
  });

  it('over the whole recording, an id has exactly one ID cell — or none at all, and then never retires', () => {
    const rec = recorderFor(sumLoop);
    rec.runToEnd();
    const retired = new Set(
      rec.recorded.flatMap((t) =>
        t.events.filter((e) => e.type === 'instr-retire').map((e) => e.instr),
      ),
    );

    const issuedOnce: string[] = [];
    const neverIssued: string[] = [];
    for (const id of allIds(rec)) {
      const idCells = walk(rec, id).filter((l) => l === 'ID').length;
      expect(idCells).toBeLessThanOrEqual(1);
      (idCells === 1 ? issuedOnce : neverIssued).push(id);
    }

    // Every instruction that issued retired — there is no reorder buffer to discard one — and every
    // one that never issued was a flush casualty, sighted at `IF` and nowhere else.
    for (const id of issuedOnce) expect(retired.has(id)).toBe(true);
    expect(neverIssued.length).toBeGreaterThan(0); // ten taken backward branches, ten casualties
    for (const id of neverIssued) {
      expect(retired.has(id)).toBe(false);
      expect(new Set(walk(rec, id))).toEqual(new Set(['IF']));
    }
  });
});
