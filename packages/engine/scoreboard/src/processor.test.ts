/**
 * Hand-derived unit tests for the scoreboard (M15 step 1) — **the machine's only net until step 2
 * adds INV-8 and step 3 adds the timing matrix**, and deliberately so: the plan pins that step 1's
 * proof is a hand-built WAW/WAR program INSIDE this file rather than a corpus program, because
 * deriving corpus tables before the machine's coefficients exist means deriving them twice.
 *
 * Every cycle number below was derived on paper from the four cadence rules in `processor.ts`'s
 * header — Issue N ⇒ RO N+1, RO N ⇒ EX N+1, EX ends N ⇒ WB N+1, WB N ⇒ that unit issues N+1 — and
 * `WB = RO + 1 + latency`. They were written down BEFORE the engine was run against them.
 *
 * The four witnesses, and what each would look like if the mechanism it names were missing:
 *
 * | Witness   | If the check were stubbed                                                    |
 * | --------- | ----------------------------------------------------------------------------- |
 * | `WAR`     | the `add` reads x2 = 5 (the younger value) and lands 16 in x3 instead of 14   |
 * | `WAW`     | the `addi` writes x1 = 7 first, the load lands 11 on top, x1 ends 11 not 7    |
 * | `control` | the `addi x2, x0, 99` on the not-taken path writes back and cannot be undone  |
 * | `pc`      | pc jumps to 16 at cycle 6 and back to 4 — it MOVES BACKWARD mid-run           |
 *
 * Each of those is asserted as an architectural VALUE as well as a stall event, so the mutation
 * check at step 3 has something that reddens for a reason a reader can state.
 */

import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import {
  ScoreboardProcessor,
  SCOREBOARD_CAPABILITIES,
  FU_NAMES,
  INT_LATENCY,
  MEM_LATENCY,
  type ScoreboardMicro,
  type ScoreboardStallReason,
} from './processor';

function asm(source: string): AssembledProgram {
  const { program, errors } = assemble(source);
  if (!program) {
    throw new Error(
      'assembly failed:\n' + errors.map((e) => `  ${e.line}:${e.column} ${e.message}`).join('\n'),
    );
  }
  return program;
}

const MAX_CYCLES = 500;

function runAll(source: string, config: ProcessorConfig = defaultConfig()): CycleTrace[] {
  const cpu = new ScoreboardProcessor();
  cpu.reset(toProgramImage(asm(source)), config);
  const traces: CycleTrace[] = [];
  while (!cpu.isHalted()) {
    if (traces.length > MAX_CYCLES) throw new Error('non-terminating program?');
    traces.push(cpu.step());
  }
  return traces;
}

/** Every stall of one reason, as `[cycle, instruction id]` pairs. */
function stallsOf(traces: CycleTrace[], reason: ScoreboardStallReason): [number, string][] {
  const out: [number, string][] = [];
  for (const t of traces) {
    for (const e of t.events) {
      if (e.type === 'stall' && e.reason === reason) out.push([t.cycle, e.instr]);
    }
  }
  return out;
}

/** Every register write, as `[cycle, reg, value, instruction id]` — the write-back ORDER. */
function regWrites(traces: CycleTrace[]): [number, number, number, string][] {
  const out: [number, number, number, string][] = [];
  for (const t of traces) {
    for (const e of t.events) {
      if (e.type === 'reg-write') out.push([t.cycle, e.reg, e.value, e.instr]);
    }
  }
  return out;
}

function finalRegs(traces: CycleTrace[]): Int32Array {
  const last = traces[traces.length - 1];
  if (last === undefined) throw new Error('no cycles');
  return last.state.registers;
}

function microOf(t: CycleTrace): ScoreboardMicro {
  return t.state.micro as ScoreboardMicro;
}

/** `.data` holding two known words at `DATA_BASE`, addressed by `lui x5, 0x10000`. */
const DATA = '    .data\nv:  .word 11, 22\n';

// ---------------------------------------------------------------------------------------------

describe('capabilities', () => {
  it('is a hazard-bearing pipelined model that honors no config knob', () => {
    expect(SCOREBOARD_CAPABILITIES).toEqual({
      model: 'scoreboard',
      pipelined: true,
      hasHazards: true,
      configurableForwarding: false,
      configurableBranchPrediction: false,
      configurableCache: false,
      configurableIssueWidth: false,
      configurableOutOfOrder: false,
    });
  });

  it('has three functional units — two integer and one memory (decision 4, as amended)', () => {
    expect([...FU_NAMES]).toEqual(['INT0', 'INT1', 'MEM']);
  });

  it('pins the intrinsic latencies', () => {
    expect(INT_LATENCY).toBe(1);
    expect(MEM_LATENCY).toBe(4);
  });
});

/**
 * The textbook cadence, on the smallest program that shows every row of it. Hennessy & Patterson's
 * worked example is the oracle for the last row: a unit freed by a Write-Result in cycle N accepts
 * a new instruction at N+1, never at N.
 *
 * ```
 * addi x1, x0, 5     INT0   IF 0  ID 1  RO 2  EX 3  WB 4
 * addi x2, x0, 37    INT1   IF 1  ID 2  RO 3  EX 4  WB 5
 * add  x5, x1, x2    INT0   IF 2  ID 5  RO 6  EX 7  WB 8   <- both units busy at 3 and 4
 * ```
 */
describe('the cadence: one scoreboard step per cycle', () => {
  const SOURCE =
    '    .text\n_start:\n    addi x1, x0, 5\n    addi x2, x0, 37\n    add  x5, x1, x2\n';

  it('walks IF/ID/RO/EX/WB one stage per cycle, with the derived cycle numbers', () => {
    const traces = runAll(SOURCE);
    const where = (id: string): (string | null)[] =>
      traces.map((t) => t.instructions.find((i) => i.id === id)?.location ?? null);

    expect(where('i0')).toEqual(['IF', 'ID', 'RO', 'EX', 'WB', null, null, null, null]);
    expect(where('i1')).toEqual([null, 'IF', 'ID', 'RO', 'EX', 'WB', null, null, null]);
    // `i2` sits in IF while both integer units are busy, then walks.
    expect(where('i2')).toEqual([null, null, 'IF', 'IF', 'IF', 'ID', 'RO', 'EX', 'WB']);
  });

  it('holds a freed unit for a full cycle: WB in N ⇒ that unit issues at N+1, not N', () => {
    const traces = runAll(SOURCE);
    // `i0` writes back (freeing INT0) in cycle 4; `i2` needs an integer unit and issues in 5.
    expect(regWrites(traces).find(([, reg]) => reg === 1)?.[0]).toBe(4);
    expect(stallsOf(traces, 'structural-int')).toEqual([
      [3, 'i2'],
      [4, 'i2'],
    ]);
    expect(traces[5]?.instructions.find((i) => i.id === 'i2')?.location).toBe('ID');
  });

  it('halts by draining, with pc past the end of text (the reference contract)', () => {
    const traces = runAll(SOURCE);
    expect(traces).toHaveLength(9);
    expect(traces[8]?.state.pc).toBe(12);
    expect(traces[8]?.state.halted).toBe(true);
    expect([...finalRegs(traces)].slice(1, 6)).toEqual([5, 37, 0, 0, 42]);
  });
});

/**
 * **WAW — the scoreboard stalls it at ISSUE.** A slow producer of `x1` is still in flight when a
 * younger writer of `x1` reaches Issue, and there is no rename to give the younger one its own
 * copy, so the younger one does not get to start.
 *
 * ```
 * lui  x5, 0x10000   INT0   IF 0  ID 1  RO 2  EX 3           WB 4
 * lw   x1, 0(x5)     MEM    IF 1  ID 2  RO 5  MEM 6..9       WB 10   <- RO waits for x5
 * addi x1, x0, 7     INT0   IF 2  ID 11 RO 12 EX 13          WB 14   <- WAW held it 3..10
 * ```
 *
 * The eight `'waw'` cycles are 3 through 10 inclusive: the claim on `x1` is placed when the load
 * ISSUES (cycle 2) and released at the CLOCK EDGE of its Write-Result (cycle 10), so cycle 10 still
 * sees it — the same one-cycle hold that makes a freed unit unavailable in its own WB cycle.
 */
describe('WAW: two writers to one register, stalled at Issue', () => {
  const SOURCE =
    DATA + '    .text\n_start:\n    lui  x5, 0x10000\n    lw   x1, 0(x5)\n    addi x1, x0, 7\n';

  it('stalls the younger writer at Issue, by cycle and by reason', () => {
    const traces = runAll(SOURCE);
    expect(stallsOf(traces, 'waw')).toEqual([
      [3, 'i2'],
      [4, 'i2'],
      [5, 'i2'],
      [6, 'i2'],
      [7, 'i2'],
      [8, 'i2'],
      [9, 'i2'],
      [10, 'i2'],
    ]);
    expect(traces[11]?.instructions.find((i) => i.id === 'i2')?.location).toBe('ID');
  });

  it('reports the stall at the ID stage — Issue is where a scoreboard catches WAW', () => {
    const traces = runAll(SOURCE);
    const waw = traces.flatMap((t) =>
      t.events.filter((e) => e.type === 'stall' && e.reason === 'waw'),
    );
    expect(waw.every((e) => e.type === 'stall' && e.stage === 'ID')).toBe(true);
  });

  it('the register-result table names the unit holding the claim', () => {
    const traces = runAll(SOURCE);
    // Cycle 5: the load owns x1 (its claim is what the younger `addi` is waiting on).
    expect(microOf(traces[5]!).registerResult[1]).toBe('MEM');
    // ...and it is released at the edge of the load's Write-Result.
    expect(microOf(traces[10]!).registerResult[1]).toBe(null);
  });

  it('x1 ends on the YOUNGER value — stub the check and the load lands on top of it', () => {
    const traces = runAll(SOURCE);
    // Program order is `lw` then `addi`, so the architectural answer is 7. The load's own write
    // (11) happens FIRST in time, at cycle 10, and the WAW stall is the only thing that puts them
    // in that order.
    expect(regWrites(traces)).toEqual([
      [4, 5, 0x10000000, 'i0'],
      [10, 1, 11, 'i1'],
      [14, 1, 7, 'i2'],
    ]);
    expect(finalRegs(traces)[1]).toBe(7);
  });
});

/**
 * **WAR — the scoreboard stalls it at WRITE-RESULT**, the only stall in the whole product that
 * fires at the END of an instruction's life rather than the beginning. This is the plan's own
 * witness program (step 1-PRE), and it is the reason decision 4 grew a second integer unit: the
 * older reader needs one unit while the load owns the memory port, leaving the younger writer the
 * other.
 *
 * ```
 * lui  x5, 0x10000   INT0   IF 0  ID 1  RO 2  EX 3      WB 4
 * addi x2, x0, 3     INT1   IF 1  ID 2  RO 3  EX 4      WB 5
 * lw   x1, 0(x5)     MEM    IF 2  ID 3  RO 5  MEM 6..9  WB 10
 * add  x3, x1, x2    INT0   IF 3  ID 5  RO 11 EX 12     WB 13  <- parks at RO, x2 READ AND UNREAD
 * addi x2, x0, 5     INT1   IF 5  ID 6  RO 7  EX 8      WB 12  <- wants 9; WAR-held 9, 10, 11
 * ```
 *
 * The hold ends the cycle AFTER the older reader actually reads, not the cycle it becomes able to:
 * Write-Result is walked before Read Operands, so at cycle 11 the WAR check still sees `Rk` set.
 */
describe('WAR: a younger writer held at Write-Result until the older reader has read', () => {
  const SOURCE =
    DATA +
    '    .text\n_start:\n' +
    '    lui  x5, 0x10000\n' +
    '    addi x2, x0, 3\n' +
    '    lw   x1, 0(x5)\n' +
    '    add  x3, x1, x2\n' +
    '    addi x2, x0, 5\n';

  it('stalls the younger writer at Write-Result, by cycle and by reason', () => {
    const traces = runAll(SOURCE);
    expect(stallsOf(traces, 'war')).toEqual([
      [9, 'i4'],
      [10, 'i4'],
      [11, 'i4'],
    ]);
  });

  it('reports the stall at the WB stage — the end of an instruction, not its beginning', () => {
    const traces = runAll(SOURCE);
    const war = traces.flatMap((t) =>
      t.events.filter((e) => e.type === 'stall' && e.reason === 'war'),
    );
    expect(war).toHaveLength(3);
    expect(war.every((e) => e.type === 'stall' && e.stage === 'WB')).toBe(true);
  });

  it('the older reader gets the OLD x2 — stub the check and x3 lands on 16 instead of 14', () => {
    const traces = runAll(SOURCE);
    // 11 (loaded) + 3 (the value `addi x2, x0, 3` wrote) = 14. The younger `addi x2, x0, 5` is
    // architecturally AFTER the `add`, so 16 would be a machine that had read the future.
    expect(finalRegs(traces)[3]).toBe(14);
    expect(finalRegs(traces)[2]).toBe(5);
  });

  it('the unit-status table shows exactly the flag the check reads', () => {
    const traces = runAll(SOURCE);
    // At cycle 9 the older `add` is parked at RO with x1 pending and x2 READY BUT UNREAD — `Rk`
    // set on the register the younger `addi` wants to write is the whole WAR condition.
    const int0 = microOf(traces[9]!).units.find((u) => u.name === 'INT0');
    expect(int0?.op).toBe('add');
    expect(int0).toMatchObject({ fj: 1, fk: 2, qj: 'MEM', qk: null, rj: false, rk: true });
    // Once it reads (cycle 11), both flags clear and the younger write goes through at 12.
    expect(microOf(traces[11]!).units.find((u) => u.name === 'INT0')).toMatchObject({
      rj: false,
      rk: false,
    });
  });

  it('a unit waiting FOR a value never blocks that value — which is why WAR cannot deadlock', () => {
    const traces = runAll(SOURCE);
    // The `add` waits on the load for x1 (`Qj = MEM`, `Rj` clear), so the load's own Write-Result
    // at cycle 10 is NOT WAR-blocked even though a live unit names x1 as a source.
    expect(regWrites(traces).find(([, reg]) => reg === 1)).toEqual([10, 1, 11, 'i2']);
  });
});

/**
 * **Out-of-order completion, with nothing to put it back in order.** The plan's acceptance
 * criterion, and the fact that separates this model from every other one in the product: two
 * instructions write back before an older one, and there is no reorder buffer behind them.
 *
 * ```
 * lui  x5, 0x10000   INT0   IF 0  ID 1  RO 2  EX 3      WB 4
 * lw   x1, 0(x5)     MEM    IF 1  ID 2  RO 5  MEM 6..9  WB 10
 * addi x2, x0, 1     INT1   IF 2  ID 3  RO 4  EX 5      WB 6
 * addi x3, x0, 2     INT0   IF 3  ID 5  RO 6  EX 7      WB 8
 * ```
 */
describe('out-of-order write-back', () => {
  const SOURCE =
    DATA +
    '    .text\n_start:\n' +
    '    lui  x5, 0x10000\n' +
    '    lw   x1, 0(x5)\n' +
    '    addi x2, x0, 1\n' +
    '    addi x3, x0, 2\n';

  it('two younger instructions write back before an older load', () => {
    const traces = runAll(SOURCE);
    expect(regWrites(traces)).toEqual([
      [4, 5, 0x10000000, 'i0'],
      [6, 2, 1, 'i2'],
      [8, 3, 2, 'i3'],
      [10, 1, 11, 'i1'], // the OLDEST of the three, and the last to land
    ]);
  });

  it('the margin is two cycles and one cycle — not a photo finish (see MEM_LATENCY)', () => {
    const traces = runAll(SOURCE);
    const at = (id: string): number => regWrites(traces).find(([, , , i]) => i === id)![0];
    expect(at('i1') - at('i2')).toBe(4);
    expect(at('i1') - at('i3')).toBe(2);
  });

  it('retire order follows write-back order — this machine has no in-order commit', () => {
    const traces = runAll(SOURCE);
    const retires = traces.flatMap((t) =>
      t.events.filter((e) => e.type === 'instr-retire').map((e) => (e as { instr: string }).instr),
    );
    expect(retires).toEqual(['i0', 'i2', 'i3', 'i1']);
  });

  /**
   * **The `pc` finding (step 1).** Every earlier model defines architectural `pc` as the retiring
   * instruction's `nextPc`, which is only well-defined because retirement is in order. Read that
   * way here, `pc` would jump to 16 at cycle 6 (the `addi x3`'s successor) and then back to 4 when
   * the older load finally retires — moving BACKWARD mid-run, at every recorded cursor position,
   * while still ending on the right value where INV-8 looks.
   */
  it('pc advances across the completed PREFIX, so it never moves backward', () => {
    const traces = runAll(SOURCE);
    expect(traces.map((t) => t.state.pc)).toEqual([0, 0, 0, 0, 4, 4, 4, 4, 4, 4, 16]);
    for (let i = 1; i < traces.length; i++) {
      expect(traces[i]!.state.pc).toBeGreaterThanOrEqual(traces[i - 1]!.state.pc);
    }
  });
});

/**
 * **Control flow.** Decision 3 pins no predictor, and a machine with no reorder buffer cannot let
 * anything past an unresolved transfer: a write that has landed cannot be taken back. So Issue
 * stops, the front end really is the `IF` slot alone, and the taken branch flushes exactly that.
 *
 * ```
 * addi x1, x0, 1      INT0   IF 0  ID 1  RO 2  EX 3   WB 4
 * beq  x0, x0, target INT1   IF 1  ID 2  RO 3  EX 4   WB 5   <- resolves in 4, redirects fetch
 * addi x2, x0, 99            IF 2  (held at ID by 'control' in 3; flushed in 4)
 * addi x3, x0, 7      INT0   IF 4  ID 5  RO 6  EX 7   WB 8
 * ```
 */
describe('control: Issue stops dead at an unresolved transfer', () => {
  const SOURCE =
    '    .text\n_start:\n' +
    '    addi x1, x0, 1\n' +
    '    beq  x0, x0, target\n' +
    '    addi x2, x0, 99\n' +
    'target:\n' +
    '    addi x3, x0, 7\n';

  it('holds the instruction behind the branch with a control stall', () => {
    const traces = runAll(SOURCE);
    expect(stallsOf(traces, 'control')).toEqual([[3, 'i2']]);
    const control = traces.flatMap((t) =>
      t.events.filter((e) => e.type === 'stall' && e.reason === 'control'),
    );
    expect(control.every((e) => e.type === 'stall' && e.stage === 'ID')).toBe(true);
  });

  it('flushes only IF, and names the instruction it killed', () => {
    const traces = runAll(SOURCE);
    const c4 = traces[4]!;
    expect(c4.events.filter((e) => e.type === 'flush')).toEqual([
      { type: 'flush', reason: 'branch-taken', stages: ['IF'] },
    ]);
    expect(c4.instructions.filter((i) => i.location === 'IF').map((i) => i.id)).toEqual([
      'i2', // the casualty, on the fall-through path
      'i3', // fetched from the target in the same cycle, as in every model
    ]);
  });

  it('the wrong-path instruction never writes — nothing here could take it back', () => {
    const traces = runAll(SOURCE);
    expect(regWrites(traces).map(([, reg]) => reg)).toEqual([1, 3]);
    expect(finalRegs(traces)[2]).toBe(0);
  });

  /**
   * **The witness that makes the block load-bearing rather than tidy**, and it is a different
   * program from the one above on purpose: with the block removed, `SOURCE` still comes out right,
   * because the wrong-path `addi` cannot find a free integer unit before the branch resolves. Only
   * a branch PARKED ON A LOAD opens a window wide enough for a younger instruction to write back
   * inside it — and once it has, there is no reorder buffer to take it back.
   *
   * ```
   * lui  x5, 0x10000   INT0   IF 0  ID 1  RO 2       EX 3       WB 4
   * lw   x1, 0(x5)     MEM    IF 1  ID 2  RO 5       MEM 6..9   WB 10
   * beq  x1, x0, done  INT1   IF 2  ID 3  RO 11      EX 12      <- parked 4..10 on x1
   * addi x4, x0, 99    INT0   IF 3  ID 5  RO 6       EX 7       WB 8   <- WITHOUT the block
   * ```
   *
   * The loaded word is 0, so the branch is taken and `addi x4, x0, 99` is wrong-path — yet it
   * would have written x4 at cycle 8, four cycles before the branch even knew its own answer.
   *
   * **This is a hand-built witness, not a corpus one, and the distinction is measured**: no corpus
   * program has a conditional branch whose source comes from a load, so today's corpus reaches the
   * `'control'` STALL everywhere and this corruption nowhere. Same status as WAR — see the plan's
   * step 6, where a corpus program with a real pair turns INV-8 into a genuine net here.
   */
  it('a branch parked on a load cannot be overtaken — the write would be unrecoverable', () => {
    const traces = runAll(
      '    .data\nz:  .word 0\n    .text\n_start:\n' +
        '    lui  x5, 0x10000\n' +
        '    lw   x1, 0(x5)\n' +
        '    beq  x1, x0, done\n' +
        '    addi x4, x0, 99\n' +
        'done:\n' +
        '    addi x6, x0, 7\n',
    );
    // The branch resolves at cycle 12; every earlier write-back belongs to the two instructions
    // OLDER than it. Nothing on the fall-through path ever reaches Write-Result.
    expect(regWrites(traces)).toEqual([
      [4, 5, 0x10000000, 'i0'],
      [10, 1, 0, 'i1'],
      [16, 6, 7, 'i4'],
    ]);
    expect(finalRegs(traces)[4]).toBe(0);
    // Held from the cycle after the branch issues until the cycle before it resolves. Cycle 12
    // emits no stall: Execute is walked before Issue, so the branch is already resolved by the
    // time Issue looks — and by then the wrong-path instruction it was holding has been flushed.
    expect(stallsOf(traces, 'control').map(([c]) => c)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('records the resolution with no bet — this machine predicts nothing', () => {
    const traces = runAll(SOURCE);
    const resolved = traces.flatMap((t) => t.events.filter((e) => e.type === 'branch-resolved'));
    expect(resolved).toEqual([
      { type: 'branch-resolved', instr: 'i1', predicted: false, actual: true, target: 12 },
    ]);
    expect(traces.flatMap((t) => t.events.filter((e) => e.type === 'branch-predicted'))).toEqual(
      [],
    );
  });

  it('a not-taken branch releases the held instruction with no flush at all', () => {
    const traces = runAll(
      '    .text\n_start:\n    bne  x0, x0, skip\n    addi x2, x0, 5\nskip:\n    addi x3, x0, 7\n',
    );
    expect(traces.flatMap((t) => t.events.filter((e) => e.type === 'flush'))).toEqual([]);
    expect(finalRegs(traces)[2]).toBe(5);
    expect(finalRegs(traces)[3]).toBe(7);
  });
});

/**
 * The single blocking memory unit (decision 7). It is what gives the machine its only multi-cycle
 * latency, and its exhaustion has to be reported as its OWN structural reason — a reader told
 * "structural" while an integer unit sits visibly free in the table has been told something false.
 */
describe('the memory unit: one port, blocking, and named in its own stall reason', () => {
  const SOURCE =
    DATA +
    '    .text\n_start:\n' +
    '    lui  x5, 0x10000\n' +
    '    addi x6, x0, 99\n' +
    '    sw   x6, 0(x5)\n' +
    '    lw   x7, 0(x5)\n';

  it('a second memory instruction stalls on structural-mem, not structural-int', () => {
    const traces = runAll(SOURCE);
    expect(stallsOf(traces, 'structural-mem').map(([c]) => c)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(stallsOf(traces, 'structural-int')).toEqual([]);
  });

  it('memory accesses are strictly ordered, so a load sees the store before it', () => {
    const traces = runAll(SOURCE);
    expect(finalRegs(traces)[7]).toBe(99);
    const mem = traces.flatMap((t) =>
      t.events.filter((e) => e.type === 'mem-write' || e.type === 'mem-read').map((e) => e.type),
    );
    expect(mem).toEqual(['mem-write', 'mem-read']);
  });

  it('a store claims no register, so it takes no WAW check and blocks no WAR', () => {
    const traces = runAll(SOURCE);
    // `sw` occupies MEM for cycles 7..10, yet no register-result entry ever names it.
    for (const t of traces) {
      expect(microOf(t).registerResult.filter((r) => r === 'MEM').length).toBeLessThanOrEqual(1);
    }
    const duringStore = microOf(traces[8]!);
    expect(duringStore.units.find((u) => u.name === 'MEM')).toMatchObject({ op: 'sw', fi: null });
    expect(duringStore.registerResult.every((r) => r === null)).toBe(true);
  });
});

/**
 * `rd === 0` and "writes nothing" coincide, and that identity is load-bearing: an `x0` writer must
 * claim no register-result entry, or two of them in flight would manufacture a WAW stall that INV-8
 * is structurally blind to (it is pure timing) — passing step 2 clean and surfacing only as wrong
 * step-3 coefficients.
 */
describe('x0 and the no-destination instructions claim nothing', () => {
  it('two writers to x0 issue back to back with no WAW stall', () => {
    const traces = runAll('    .text\n_start:\n    addi x0, x0, 1\n    addi x0, x0, 2\n');
    expect(stallsOf(traces, 'waw')).toEqual([]);
    expect(finalRegs(traces)[0]).toBe(0);
    expect(traces.flatMap((t) => t.events.filter((e) => e.type === 'reg-write'))).toEqual([]);
  });

  it('the register-result row for x0 is never claimed', () => {
    const traces = runAll('    .text\n_start:\n    addi x0, x0, 1\n    addi x0, x0, 2\n');
    for (const t of traces) expect(microOf(t).registerResult[0]).toBe(null);
  });
});

/**
 * INV-4: one stable id per DYNAMIC instruction, for its whole lifetime — and here that lifetime
 * crosses another instruction that started later and finished earlier, which is the case step 4's
 * `follow()` exists for.
 */
describe('INV-4: stable ids across an out-of-order lifetime', () => {
  const SOURCE =
    DATA +
    '    .text\n_start:\n' +
    '    lui  x5, 0x10000\n' +
    '    lw   x1, 0(x5)\n' +
    '    addi x2, x0, 1\n' +
    '    addi x3, x0, 2\n';

  it('an id appears in a contiguous run of cycles and never reappears', () => {
    const traces = runAll(SOURCE);
    const seen = new Map<string, number[]>();
    for (const t of traces) {
      for (const i of t.instructions) {
        const cycles = seen.get(i.id) ?? [];
        cycles.push(t.cycle);
        seen.set(i.id, cycles);
      }
    }
    for (const [id, cycles] of seen) {
      const unique = [...new Set(cycles)];
      expect(unique, `${id} appears twice in one cycle`).toEqual(cycles);
      for (let k = 1; k < cycles.length; k++) {
        expect(cycles[k], `${id} has a gap in its lifetime`).toBe(cycles[k - 1]! + 1);
      }
    }
    // The load outlives both instructions that issued after it.
    expect(seen.get('i1')!.at(-1)).toBeGreaterThan(seen.get('i3')!.at(-1)!);
  });

  it('every id maps to exactly one pc and one encoding for its whole life', () => {
    const traces = runAll(SOURCE);
    const pcs = new Map<string, number>();
    for (const t of traces) {
      for (const i of t.instructions) {
        if (pcs.has(i.id)) expect(pcs.get(i.id)).toBe(i.pc);
        else pcs.set(i.id, i.pc);
      }
    }
    expect([...pcs.values()]).toEqual([0, 4, 8, 12]);
  });
});

/**
 * `location` is drawn from the STAGE vocabulary and nothing else. `pipeline-map.ts` hues by stage
 * family, so an `INT0` here would mint a brand-new family and break the plan's falsifiable
 * "`pipeline-map.ts` needs no edit" criterion — silently, since no engine test looks at a hue.
 */
describe('the stage vocabulary (the pipeline-map criterion)', () => {
  it('never reports a functional-unit name as a location', () => {
    const traces = runAll(
      DATA +
        '    .text\n_start:\n    lui  x5, 0x10000\n    lw   x1, 0(x5)\n    addi x2, x0, 1\n    sw   x2, 4(x5)\n    beq  x0, x0, done\ndone:\n    addi x3, x0, 1\n',
    );
    const locations = new Set(traces.flatMap((t) => t.instructions.map((i) => i.location)));
    expect([...locations].sort()).toEqual(['EX', 'ID', 'IF', 'MEM', 'RO', 'WB']);
  });
});

/**
 * The `micro` tables are a fresh snapshot per cycle. The recorder keeps every cycle, so a table
 * aliasing the live scoreboard would read latest-values-everywhere at every cursor position — and
 * no test that inspects only the CURRENT cycle could ever see it.
 */
describe('micro is an independent per-cycle snapshot', () => {
  const SOURCE =
    DATA + '    .text\n_start:\n    lui  x5, 0x10000\n    lw   x1, 0(x5)\n    addi x2, x0, 1\n';

  it('an early cycle still shows an idle memory unit after a later cycle fills it', () => {
    const traces = runAll(SOURCE);
    expect(microOf(traces[0]!).units.find((u) => u.name === 'MEM')?.busy).toBe(false);
    expect(microOf(traces[6]!).units.find((u) => u.name === 'MEM')?.busy).toBe(true);
    // Re-read the first cycle AFTER the whole run: nothing about it may have moved.
    expect(microOf(traces[0]!).units.find((u) => u.name === 'MEM')?.busy).toBe(false);
    expect(microOf(traces[0]!).registerResult.every((r) => r === null)).toBe(true);
  });

  it('no two cycles share a table object', () => {
    const traces = runAll(SOURCE);
    const seen = new Set<unknown>();
    for (const t of traces) {
      const m = microOf(t);
      for (const obj of [m, m.units, m.instructions, m.registerResult, ...m.units]) {
        expect(seen.has(obj)).toBe(false);
        seen.add(obj);
      }
    }
  });

  it('the instruction-status table is bounded to what is in flight', () => {
    const traces = runAll(SOURCE);
    for (const t of traces) {
      expect(microOf(t).instructions.length).toBeLessThanOrEqual(FU_NAMES.length + 1);
    }
    // ...and it carries the four textbook columns for whatever is there.
    const row = microOf(traces[3]!).instructions.find((r) => r.instr === 'i0');
    expect(row).toMatchObject({ unit: 'INT0', issue: 1, readOperands: 2, executeComplete: 3 });
    expect(row?.writeResult).toBe(null);
  });
});

/**
 * The inertness contract (M4 step 0, two milestones on): a model that does not honor a knob must be
 * provably blind to it — a byte-identical whole trace, not a comment. This model honors NONE of
 * them, and `forwarding` is the one that matters most: there is no bypass network here at all, so
 * results reach consumers through the register file and nothing else.
 */
describe('every knob is inert', () => {
  const SOURCE =
    DATA +
    '    .text\n_start:\n' +
    '    lui  x5, 0x10000\n' +
    '    lw   x1, 0(x5)\n' +
    '    addi x2, x0, 1\n' +
    '    add  x3, x1, x2\n' +
    '    beq  x0, x0, done\ndone:\n' +
    '    sw   x3, 4(x5)\n';

  const base = defaultConfig();

  it('forwarding on and off produce the same trace', () => {
    expect(runAll(SOURCE, { ...base, forwarding: true })).toEqual(
      runAll(SOURCE, { ...base, forwarding: false }),
    );
  });

  it('every branch-prediction scheme produces the same trace', () => {
    const schemes = [
      'none',
      'static-taken',
      'static-not-taken',
      'dynamic-1bit',
      'dynamic-2bit',
    ] as const;
    const reference = runAll(SOURCE, { ...base, branchPrediction: schemes[0] });
    for (const branchPrediction of schemes) {
      expect(runAll(SOURCE, { ...base, branchPrediction })).toEqual(reference);
    }
  });

  it('the out-of-order cluster produces the same trace', () => {
    const reference = runAll(SOURCE, base);
    expect(
      runAll(SOURCE, { ...base, outOfOrderIssue: true, robSize: 1, slowOpLatency: 9 }),
    ).toEqual(reference);
    expect(runAll(SOURCE, { ...base, numMshrs: 8, seed: 7 })).toEqual(reference);
  });

  it('INV-1: the same program and config produce an identical trace twice over', () => {
    expect(runAll(SOURCE)).toEqual(runAll(SOURCE));
  });
});

/**
 * The two REFUSED knobs (decision 5), following `deep-pipeline`'s precedent: a knob this machine
 * cannot honor is louder as a throw than as a silent lie. The shell narrows both in
 * `engineConfigFor` at step 5 — and note it clamps `cache` ONLY today, so `issueWidth` is a real
 * extension there rather than an existing path.
 */
describe('the refused knobs fail fast', () => {
  const program = asm('    .text\n_start:\n    addi x1, x0, 1\n');
  const reset = (config: ProcessorConfig): void => {
    new ScoreboardProcessor().reset(toProgramImage(program), config);
  };

  it('refuses a cache', () => {
    expect(() =>
      reset({ ...defaultConfig(), cache: { lineSize: 16, numLines: 4, missPenalty: 10 } }),
    ).toThrow(/scoreboard: this model has no cache/);
  });

  it('refuses an issue width above 1', () => {
    expect(() => reset({ ...defaultConfig(), issueWidth: 2 })).toThrow(/issueWidth 2/);
  });

  it('accepts an explicit width of 1 and an absent one alike', () => {
    expect(() => reset({ ...defaultConfig(), issueWidth: 1 })).not.toThrow();
    expect(() => reset(defaultConfig())).not.toThrow();
  });
});

describe('halting', () => {
  it('stops the front end at ecall and drains what is already in flight', () => {
    const traces = runAll(
      DATA +
        '    .text\n_start:\n    lui  x5, 0x10000\n    lw   x1, 0(x5)\n    li   a7, 10\n    ecall\n    addi x9, x0, 1\n',
    );
    const last = traces[traces.length - 1]!;
    expect(last.state.halted).toBe(true);
    // pc stops ON the ecall (the reference contract), and the instruction after it never runs.
    expect(last.state.pc).toBe(12);
    expect(last.state.registers[9]).toBe(0);
    expect(last.state.registers[1]).toBe(11); // the load, still in flight at the halt, completed
  });

  it('refuses to step once halted', () => {
    const cpu = new ScoreboardProcessor();
    cpu.reset(toProgramImage(asm('    .text\n_start:\n    ecall\n')), defaultConfig());
    while (!cpu.isHalted()) cpu.step();
    expect(() => cpu.step()).toThrow(/halted/);
  });

  it('an empty image is halted from the start', () => {
    const cpu = new ScoreboardProcessor();
    cpu.reset(toProgramImage(asm('    .text\n')), defaultConfig());
    expect(cpu.isHalted()).toBe(true);
  });
});
