import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import {
  defaultConfig,
  type CycleTrace,
  type ProcessorConfig,
  type TraceEvent,
} from '@cpu-viz/trace';
import { toProgramImage, CACHE_SMALL } from '@cpu-viz/engine-common';
import {
  DeepPipelineProcessor,
  DEEP_PIPELINE_CAPABILITIES,
  type DeepPipelineMicro,
  type Stage,
} from './index';

/**
 * Deep-pipeline engine tests (M11 step 1) — the REAL verification of this model's soul.
 *
 * The INV-8 differential (step 2) proves only final architectural state, which is model-invariant
 * and **blind to timing**: an in-order 7-stage retires in exactly the order the golden reference
 * does even if IF2 and EX2 are pure pass-throughs. So conformance can say nothing at all about
 * DEPTH. The full timing matrix over the corpus is step 3; what is pinned HERE is the per-cycle
 * mechanism it will rest on — the two-stage front end, the two-cycle execute, the enumerated
 * forwarding paths, the interlock that watches both execute stages, and the four-wide flush.
 *
 * **Every expectation is hand-derived from the pinned semantics, never pasted from the engine's own
 * output** (a number copied from a failing run is not a pin — it is a snapshot of a bug). The
 * derivation rule, and the only one used below:
 *
 *   - Instruction *k* of a straight run enters IF1 at cycle *k* and advances one stage per cycle:
 *     `IF1 IF2 ID EX1 EX2 MEM WB`, so it retires at cycle *k+6*.
 *   - A run of N retired instructions therefore takes **N + 6 + S + P** cycles, S = stall cycles,
 *     P = flush casualties.
 *
 * The ISA arithmetic is deliberately NOT re-tested here: it is mirrored verbatim from the golden
 * reference and conformance is what proves the copy faithful.
 */

function asm(source: string): AssembledProgram {
  const { program, errors } = assemble(source);
  if (!program) {
    throw new Error(
      'assembly failed:\n' + errors.map((e) => `  ${e.line}:${e.column} ${e.message}`).join('\n'),
    );
  }
  return program;
}

const OFF: ProcessorConfig = { ...defaultConfig(), forwarding: false };
const ON: ProcessorConfig = { ...defaultConfig(), forwarding: true };
/** Forwarding on, and the one scheme that actually bets (`'none'`/`'static-not-taken'` do not). */
const PREDICT: ProcessorConfig = { ...ON, branchPrediction: 'static-taken' };

function makeProc(source: string, config: ProcessorConfig): DeepPipelineProcessor {
  const p = new DeepPipelineProcessor();
  p.reset(toProgramImage(asm(source)), config);
  return p;
}

/** Drive to halt, collecting every CycleTrace. */
function run(source: string, config: ProcessorConfig, maxCycles = 2000): CycleTrace[] {
  const p = makeProc(source, config);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    if (traces.length >= maxCycles) throw new Error('exceeded maxCycles — runaway loop?');
    traces.push(p.step());
  }
  return traces;
}

const last = (ts: CycleTrace[]): CycleTrace => ts[ts.length - 1]!;
const reg = (t: CycleTrace, i: number): number => t.state.registers[i]!;
const micro = (t: CycleTrace): DeepPipelineMicro => t.state.micro as DeepPipelineMicro;

/** Every event of one type across the whole run, in cycle order. */
function eventsOf<T extends TraceEvent['type']>(
  ts: CycleTrace[],
  type: T,
): Extract<TraceEvent, { type: T }>[] {
  return ts.flatMap((t) =>
    t.events.filter((e): e is Extract<TraceEvent, { type: T }> => e.type === type),
  );
}

/** The id of the instruction at `pc` (the nth instruction fetched, 0-based), from its fetch event. */
function idOfNth(ts: CycleTrace[], n: number): string {
  const f = eventsOf(ts, 'instr-fetch')[n];
  if (!f) throw new Error(`no ${n}th instr-fetch in this run`);
  return f.instr;
}

/** The stage walk of one instruction id: its `location` at every cycle it is in flight. */
function walk(ts: CycleTrace[], id: string): Stage[] {
  return ts.flatMap((t) =>
    t.instructions.filter((i) => i.id === id).map((i) => i.location as Stage),
  );
}

/**
 * Every `location` this run emitted, in FIRST-SEEN order.
 *
 * This is `buildPipelineMap`'s `map.stages`, recomputed here rather than imported: the map lives in
 * `@cpu-viz/web`, and an engine importing the web is the INV-3 deny path the dependency lint fires
 * on (verified in both directions at step 0). The fold is three lines, and duplicating three lines
 * beats crossing the DAG.
 */
function stagesFirstSeen(ts: CycleTrace[]): string[] {
  const seen: string[] = [];
  for (const t of ts) {
    for (const i of t.instructions) if (!seen.includes(i.location)) seen.push(i.location);
  }
  return seen;
}

// ---------------------------------------------------------------------------------------------
// Programs. Explicit instructions rather than `li`/`mv` pseudo-ops everywhere the COUNT is
// load-bearing — and every cycle count below is a count.
// ---------------------------------------------------------------------------------------------

/** A distance-1 ALU→ALU RAW pair: THE case the 5-stage forwards away for free and this one cannot. */
const RAW_PAIR = ['.text', 'addi x1, x0, 5', 'addi x2, x1, 1', 'ecall'].join('\n');

/** Three instructions, NO `ecall`: halts by running off the end of text (the drain path). */
const NO_ECALL = ['.text', 'addi x1, x0, 5', 'addi x2, x0, 37', 'add x5, x1, x2'].join('\n');

/**
 * A data address comfortably past the end of any program here — memory is ONE flat space with text
 * based at 0, so a "spare" address has to be chosen, not assumed.
 */
const SCRATCH = 256;

/**
 * The textbook load-use pair, padded so the ONLY stall in the run is the load-use one. Under
 * forwarding the interlock fires at distance 1 for any producer and distance 1–2 for a load, so
 * every other dependence here is deliberately at distance 2 or more.
 */
const LOAD_USE = [
  '.text',
  `addi x1, x0, ${SCRATCH}`, // i0
  'addi x4, x0, 42', // i1
  'addi x9, x0, 0', // i2 — filler, so the store's operands are both far enough back
  'sw x4, 0(x1)', // i3
  'addi x9, x0, 0', // i4
  'addi x9, x0, 0', // i5
  'lw x2, 0(x1)', // i6
  'add x3, x2, x2', // i7 — load-use: reads what the instruction before it loaded
  'ecall', // i8
].join('\n');

/** An always-taken branch with two live fall-through shadows behind it. */
const TAKEN_BRANCH = [
  '.text',
  'addi x1, x0, 1', // i0
  'beq x0, x0, tgt', // i1 — always taken; reads only x0, so it has no data hazard
  'addi x2, x0, 99', // i2 — shadow
  'addi x3, x0, 98', // i3 — shadow
  'tgt:',
  'addi x4, x0, 7', // the target
  'ecall',
].join('\n');

/** The same shape, but the branch is NEVER taken — a WRONG bet under `static-taken`. */
const NOT_TAKEN_BRANCH = [
  '.text',
  'addi x1, x0, 1', // i0
  'bne x0, x0, tgt', // i1 — never taken (x0 == x0)
  'addi x2, x0, 99', // i2 — the fall-through, which really does execute
  'addi x3, x0, 98', // i3
  'tgt:',
  'addi x4, x0, 7',
  'ecall',
].join('\n');

/** An `ecall` with live code directly behind it — TWO shadows on a machine this deep. */
const HALT_SHADOWS = [
  '.text',
  'addi x1, x0, 1', // i0
  'ecall', // i1
  'sw x1, 0(x0)', // i2 — shadow 1: would CORRUPT text at address 0 if it ever reached MEM
  'addi x2, x0, 9', // i3 — shadow 2: would write x2
].join('\n');

describe('capabilities', () => {
  it('is a pipelined, hazard-bearing model that honors forwarding and prediction', () => {
    expect(DEEP_PIPELINE_CAPABILITIES.model).toBe('deep-pipeline');
    expect(DEEP_PIPELINE_CAPABILITIES.pipelined).toBe(true);
    expect(DEEP_PIPELINE_CAPABILITIES.hasHazards).toBe(true);
    expect(DEEP_PIPELINE_CAPABILITIES.configurableForwarding).toBe(true);
    expect(DEEP_PIPELINE_CAPABILITIES.configurableBranchPrediction).toBe(true);
  });

  /**
   * The three knobs this machine does NOT have, and the one that matters: `configurableCache` is
   * false AND `reset` throws on a cache config. M10 step 0 found `slowOpLatency` shipped INERT — a
   * config field with no engine consumer — so the capability and the behaviour are pinned together
   * here rather than trusting the flag alone.
   */
  it('refuses a cache config by name rather than silently running cache-less', () => {
    expect(DEEP_PIPELINE_CAPABILITIES.configurableCache).toBe(false);
    expect(DEEP_PIPELINE_CAPABILITIES.configurableIssueWidth).toBe(false);
    expect(DEEP_PIPELINE_CAPABILITIES.configurableOutOfOrder).toBe(false);

    const p = new DeepPipelineProcessor();
    expect(() => p.reset(toProgramImage(asm(RAW_PAIR)), { ...ON, cache: CACHE_SMALL })).toThrow(
      /not a knob this machine has yet/,
    );
    // ...and the cache-less config it DOES have still works.
    expect(() => p.reset(toProgramImage(asm(RAW_PAIR)), ON)).not.toThrow();
  });
});

describe('the seven stages', () => {
  /**
   * The step-1 acceptance pin, and an ORDERED comparison rather than a set one: for a run whose
   * first instruction never stalls, first-seen order IS stage order, so this catches a latch wired
   * out of sequence that a set equality would wave through.
   *
   * It also pins the ENCODING, which reaches beyond this package. `pipeline-map.ts`'s `stageFamily`
   * strips a trailing `\d+` for the hue key, so these exact spellings fold to five families;
   * `IF-2` would not fold, and `IF.2` would be read as a LANE (M7's axis), not a depth.
   */
  it('emits exactly IF1 IF2 ID EX1 EX2 MEM WB, in that order', () => {
    const ts = run(NO_ECALL, ON);
    expect(stagesFirstSeen(ts)).toEqual(['IF1', 'IF2', 'ID', 'EX1', 'EX2', 'MEM', 'WB']);

    // Seven stages, five families — the map's rule, recomputed here (see `stagesFirstSeen`).
    const families = [...new Set(stagesFirstSeen(ts).map((s) => s.replace(/\d+$/, '')))];
    expect(families).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);
  });

  /**
   * A hazard-free instruction walks all seven stages exactly once, in order, and keeps ONE id the
   * whole way (INV-4). The first instruction of `NO_ECALL` depends on nothing, so its walk is the
   * bare stage list.
   */
  it('walks one hazard-free instruction through all seven stages under a single id', () => {
    const ts = run(NO_ECALL, ON);
    expect(walk(ts, idOfNth(ts, 0))).toEqual([
      'IF1',
      'IF2',
      'ID',
      'EX1',
      'EX2',
      'MEM',
      'WB',
    ] satisfies Stage[]);
    // One fetch event per instruction — a stall must never re-fetch under a new id.
    expect(eventsOf(ts, 'instr-fetch')).toHaveLength(3);
  });

  /**
   * Halt-with-drain, one stage deeper. `NO_ECALL` has no `ecall` at all: fetch stops because the
   * pointer leaves `.text` while three instructions are still in flight, and the machine must drain
   * rather than truncate. 3 instructions + 6 drain + 1 stall (the `add`'s distance-1 RAW on the
   * `addi` before it) = 10.
   */
  it('drains the pipe when fetch runs off the end of text', () => {
    const ts = run(NO_ECALL, ON);
    expect(ts).toHaveLength(10);
    expect(eventsOf(ts, 'instr-retire')).toHaveLength(3);
    expect(reg(last(ts), 5)).toBe(42);
    expect(last(ts).state.halted).toBe(true);
  });
});

describe('the two-cycle execute — the ALU→ALU bubble forwarding cannot remove', () => {
  /**
   * THE milestone's thesis, as a cycle count. Operands are consumed at the start of EX1 and nothing
   * is finished until the end of EX2, so a producer one instruction ahead is still IN EX2 when its
   * consumer wants to enter EX1. One bubble — where the 5-stage, with the same `forwarding: true`,
   * has none.
   *
   * 3 instructions + 6 drain + 1 stall = 10.
   */
  it('costs the consumer exactly one bubble with forwarding ON', () => {
    const ts = run(RAW_PAIR, ON);
    expect(ts).toHaveLength(10);

    // The repeated ID cell IS the bubble — the shape a reader sees on the pipeline map.
    expect(walk(ts, idOfNth(ts, 1))).toEqual([
      'IF1',
      'IF2',
      'ID',
      'ID',
      'EX1',
      'EX2',
      'MEM',
      'WB',
    ] satisfies Stage[]);
    expect(reg(last(ts), 2)).toBe(6);
  });

  /**
   * The stall's NAME. Not `'raw'` — that is pinned repo-wide to mean "waiting for a register write,
   * forwarding is off" — and not `'alu-use'`, which would lie about `lui`/`auipc`/`jal` (see the
   * uniformity test below). `'ex-latency'` is what is true of all of them: the result is not
   * finished until the end of EX2.
   */
  it('names the stall ex-latency, and only under forwarding', () => {
    const on = eventsOf(run(RAW_PAIR, ON), 'stall');
    expect(on).toHaveLength(1);
    expect(on[0]).toMatchObject({ reason: 'ex-latency', stage: 'ID' });

    // With forwarding off the same pair is an ordinary register-file wait, in the old vocabulary.
    expect(new Set(eventsOf(run(RAW_PAIR, OFF), 'stall').map((e) => e.reason))).toEqual(
      new Set(['raw']),
    );
  });

  /**
   * The consumer takes the `EX2/MEM → EX1` path — one latch further from the producer than the
   * 5-stage's `EX/MEM → EX`, because a result only exists once its instruction has LEFT EX2.
   */
  it('resolves the operand by forwarding out of EX2/MEM into EX1', () => {
    const fwd = eventsOf(run(RAW_PAIR, ON), 'forward');
    expect(fwd).toHaveLength(1);
    expect(fwd[0]).toMatchObject({ from: 'EX2/MEM', to: 'EX1.rs1', value: 5 });
  });

  /**
   * The two-cycle execute is UNIFORM across every op (pinned 2026-07-27), and `lui` is the case
   * that proves it is not secretly "the ALU takes two cycles": `lui` runs no ALU at all — it emits
   * no `alu-op` — and still makes its consumer wait. A non-uniform execute would be a
   * variable-latency machine, which is a different animal and collides with M9's `slowOpLatency`.
   */
  it('applies the two cycles even to ops that run no ALU', () => {
    const ts = run(['.text', 'lui x1, 1', 'addi x2, x1, 0', 'ecall'].join('\n'), ON);
    const producer = idOfNth(ts, 0);
    expect(eventsOf(ts, 'alu-op').some((e) => e.instr === producer)).toBe(false);
    expect(eventsOf(ts, 'stall')).toHaveLength(1);
    expect(ts).toHaveLength(10);
    expect(reg(last(ts), 2)).toBe(1 << 12);
  });

  /**
   * With forwarding OFF the consumer waits in ID for the producer's WB — and there is one more
   * stage between them than in the 5-stage, so the penalty is 3 rather than 2. It is 3 and not 4
   * because WB runs FIRST in the reverse walk, so ID's register read sees a value written back in
   * the very same cycle.
   *
   * 3 instructions + 6 drain + 3 stalls = 12.
   */
  it('costs three stall cycles with forwarding OFF', () => {
    const ts = run(RAW_PAIR, OFF);
    expect(ts).toHaveLength(12);
    expect(eventsOf(ts, 'stall')).toHaveLength(3);
    expect(eventsOf(ts, 'forward')).toHaveLength(0);
    expect(walk(ts, idOfNth(ts, 1))).toEqual([
      'IF1',
      'IF2',
      'ID',
      'ID',
      'ID',
      'ID',
      'EX1',
      'EX2',
      'MEM',
      'WB',
    ] satisfies Stage[]);
    expect(reg(last(ts), 2)).toBe(6);
  });
});

describe('load-use — the interlock watches BOTH execute stages', () => {
  /**
   * A load's datum does not exist until the end of MEM, so the consumer must reach EX1 on the cycle
   * the load reaches WB: two bubbles, where the 5-stage needs one. This is what "the interlock
   * watches two execute stages" buys — the stall fires with the load in EX1 AND again with it in
   * EX2, as two explicit checks rather than a loop over "any execute stage".
   *
   * 9 instructions + 6 drain + 2 stalls = 17.
   */
  it('costs two bubbles with forwarding ON', () => {
    const ts = run(LOAD_USE, ON);
    expect(ts).toHaveLength(17);

    const stalls = eventsOf(ts, 'stall');
    expect(stalls).toHaveLength(2);
    expect(stalls.map((e) => e.reason)).toEqual(['load-use', 'load-use']);

    expect(walk(ts, idOfNth(ts, 7))).toEqual([
      'IF1',
      'IF2',
      'ID',
      'ID',
      'ID',
      'EX1',
      'EX2',
      'MEM',
      'WB',
    ] satisfies Stage[]);
    expect(reg(last(ts), 3)).toBe(84);
  });

  /**
   * The consumer then takes MEM/WB — the load is in WB by the time the consumer reaches EX1, which
   * is exactly what the two bubbles were for. Both ports forward, since it reads x2 twice.
   */
  it('forwards the loaded datum from MEM/WB into EX1', () => {
    const ts = run(LOAD_USE, ON);
    const consumer = idOfNth(ts, 7);
    const fwd = eventsOf(ts, 'forward').filter((e) => e.instr === consumer);
    expect(fwd).toHaveLength(2);
    expect(fwd.map((e) => e.from)).toEqual(['MEM/WB', 'MEM/WB']);
    expect(fwd.map((e) => e.to)).toEqual(['EX1.rs1', 'EX1.rs2']);
    expect(fwd.every((e) => e.value === 42)).toBe(true);
  });
});

describe('control flow — resolve at the end of EX2', () => {
  /**
   * With no prediction, a taken transfer is not known until it leaves EX2, by which point EX1, ID,
   * IF2 and IF1 all hold wrong-path instructions. **One flush event, `stages` of width 4** — double
   * the 5-stage's 2, and the reason the misprediction penalty doubles.
   *
   * 4 retired (two before the branch resolves, then the target and the `ecall`) + 6 drain + 4
   * casualties = 14.
   */
  it('kills four stages on an unpredicted taken branch', () => {
    const ts = run(TAKEN_BRANCH, OFF);
    expect(ts).toHaveLength(14);

    const flushes = eventsOf(ts, 'flush');
    expect(flushes).toHaveLength(1);
    expect(flushes[0]).toEqual({
      type: 'flush',
      reason: 'branch-taken',
      stages: ['EX1', 'ID', 'IF2', 'IF1'],
    });

    // The two shadows really did die: neither x2 nor x3 was ever written.
    expect(reg(last(ts), 2)).toBe(0);
    expect(reg(last(ts), 3)).toBe(0);
    expect(reg(last(ts), 4)).toBe(7);
  });

  /**
   * The flush names REAL CASUALTIES and every named stage is genuinely occupied, which the schema
   * pins and `buildPipelineMap` depends on — it resolves a victim with a singular `find` on
   * `location`, so a named-but-empty stage silently records no victim at all. Checked over every
   * flush in every program here, since the empty-slot case is the COMMON path under prediction.
   */
  it('never names a stage nobody occupies', () => {
    for (const [source, config] of [
      [TAKEN_BRANCH, OFF],
      [TAKEN_BRANCH, PREDICT],
      [NOT_TAKEN_BRANCH, PREDICT],
      [HALT_SHADOWS, ON],
    ] as const) {
      const ts = run(source, config);
      for (const t of ts) {
        const here = new Set(t.instructions.map((i) => i.location));
        for (const e of t.events) {
          if (e.type !== 'flush') continue;
          expect(e.stages.length).toBeGreaterThan(0);
          for (const s of e.stages) expect(here).toContain(s);
        }
      }
    }
  });

  /**
   * **Depth taxes you even when the prediction is RIGHT.** The bet is placed in ID, unchanged from
   * the 5-stage — and on a machine with a two-deep front end an ID bet kills IF2 *and* IF1. So a
   * correctly predicted taken branch costs 2, not 1. (Making it cheap again means a predictor in
   * IF1 — a BTB / next-line fetch — which is new mechanism and deliberately not in this model.)
   *
   * 4 retired + 6 drain + 2 casualties = 12, against the unpredicted run's 14.
   */
  it('still costs two on a CORRECTLY predicted taken branch', () => {
    const ts = run(TAKEN_BRANCH, PREDICT);
    expect(ts).toHaveLength(12);

    expect(eventsOf(ts, 'branch-predicted')).toHaveLength(1);
    const flushes = eventsOf(ts, 'flush');
    expect(flushes).toHaveLength(1);
    expect(flushes[0]).toEqual({
      type: 'flush',
      reason: 'branch-predicted-taken',
      stages: ['IF2', 'IF1'],
    });
    // The bet was right, so EX2 raised no correction.
    expect(eventsOf(ts, 'branch-resolved')[0]).toMatchObject({ predicted: true, actual: true });
  });

  /**
   * The shape M11's plan flags as a trap, confirmed from the engine rather than assumed: under
   * prediction the misprediction TOTAL is still 4, but it does **not arrive as one event**. ID bets
   * at cycle *t* and kills IF2 + IF1; by the time the branch reaches EX2 at *t+2*, EX1 and ID hold
   * the bubbles that earlier flush left, so the correction finds nobody there and kills IF2 + IF1
   * again. **Two flush events of width 2.**
   *
   * The total is therefore the robust number for step 3's closed form; `flush.stages` widths are
   * config-dependent and must be read per-setting.
   */
  it('splits a mispredicted branch into two width-2 flushes under prediction', () => {
    const ts = run(NOT_TAKEN_BRANCH, PREDICT);
    const flushes = eventsOf(ts, 'flush');
    expect(flushes.map((e) => e.stages)).toEqual([
      ['IF2', 'IF1'],
      ['IF2', 'IF1'],
    ]);
    expect(flushes.map((e) => e.reason)).toEqual([
      'branch-predicted-taken',
      // The correction is named for what the machine LEARNED — the bet said taken, the branch
      // declined — so it must NOT be reported as 'branch-taken'.
      'branch-not-taken',
    ]);
    expect(flushes.reduce((n, e) => n + e.stages.length, 0)).toBe(4);

    // The fall-through really did execute, twice over: this branch was never taken.
    expect(reg(last(ts), 2)).toBe(99);
    expect(reg(last(ts), 3)).toBe(98);
  });
});

describe('halt with two shadows', () => {
  /**
   * An `ecall` decoded in ID has occupants in BOTH IF2 and IF1 — the 5-stage's single shadow
   * becomes two. Kill only one and the survivor advances into ID and executes, and the hazard that
   * removes is a committed SIDE EFFECT: the shadow store here would sit in MEM the same cycle the
   * halt sits in WB, making architectural memory depend on intra-cycle stage order. So the shadows
   * are a store into the program's own first word and a register write, and neither may happen.
   */
  it('squashes both instructions behind an ecall', () => {
    const ts = run(HALT_SHADOWS, ON);

    const flushes = eventsOf(ts, 'flush');
    expect(flushes).toHaveLength(1);
    expect(flushes[0]).toEqual({ type: 'flush', reason: 'halt', stages: ['IF2', 'IF1'] });

    // Shadow 1 never reached MEM: word 0 is still the program's own first instruction...
    expect(last(ts).state.memory.readWord(0)).toBe(asm(HALT_SHADOWS).words[0]);
    // ...and shadow 2 never reached WB.
    expect(reg(last(ts), 2)).toBe(0);

    // 2 retired + 6 drain, and the halting instruction's own pc is the final one.
    expect(ts).toHaveLength(8);
    expect(eventsOf(ts, 'instr-retire')).toHaveLength(2);
    expect(last(ts).state.pc).toBe(4);
  });
});

describe('micro — six latches, independently snapshotted', () => {
  /**
   * `MachineState.micro` carries the six inter-stage latches, which is what "7 stages, 6 latches"
   * means concretely, and a stage with no instruction is a `null` BUBBLE. The recorder keeps every
   * cycle, so each snapshot must be genuinely its own — a latch aliased across cycles would replay
   * as latest-values-everywhere, a bug final-state conformance cannot see and only time-travel can.
   */
  it('presents each stage’s occupant and keeps every cycle’s snapshot its own', () => {
    const ts = run(NO_ECALL, ON);

    // `CycleTrace.state` is the POST-EDGE snapshot — the latches as they will PRESENT to the next
    // cycle, not the occupancy `instructions[]` reports for this one (the house convention, shared
    // with the 5-stage). So after cycle 2, with three instructions fetched, the first has left ID
    // and is presented to EX1, the second to ID, the third to IF2. Nothing has reached EX2 yet.
    const m2 = micro(ts[2]!);
    expect(m2.idEx1?.instr).toBe(idOfNth(ts, 0));
    expect(m2.if2Id?.instr).toBe(idOfNth(ts, 1));
    expect(m2.if1If2?.instr).toBe(idOfNth(ts, 2));
    expect(m2.ex1Ex2).toBeNull();
    expect(m2.ex2Mem).toBeNull();
    expect(m2.memWb).toBeNull();

    // EX1/EX2 carries OPERANDS, never a result — the latch shape that makes the ALU→ALU bubble
    // structural instead of a rule someone could forget. `ex2Mem` is the first forwardable one.
    const withEx2 = ts.find((t) => micro(t).ex1Ex2 !== null)!;
    expect(Object.keys(micro(withEx2).ex1Ex2!)).toEqual(
      expect.arrayContaining(['opA', 'opB', 'rd', 'predictedTaken']),
    );
    expect(micro(withEx2).ex1Ex2).not.toHaveProperty('writeValue');

    // Re-read an early cycle after the run finished: it must still show the early state.
    expect(micro(ts[2]!).if2Id?.instr).toBe(idOfNth(ts, 1));
    expect(micro(ts[2]!).ex2Mem).toBeNull();
  });
});
