import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage, CACHE_LARGE, CACHE_SMALL } from '@cpu-viz/engine-common';
import {
  defaultConfig,
  type CacheConfig,
  type CycleTrace,
  type ProcessorConfig,
  type TraceEvent,
} from '@cpu-viz/trace';
import { SuperscalarProcessor } from './index';

/**
 * **THE net for M7 step 2a — the closed form, transplanted from M3.**
 *
 * `differential.test.ts` proves this model computes the right ANSWERS on the whole corpus. It
 * cannot prove it computes them at the right SPEED, and for an in-order superscalar that gap is
 * total: retirement is in order, so final architectural state is deterministic and conformance
 * would pass with the microarchitecture completely wrong. Timing is the entire point of this tier,
 * and there is no golden reference for cycle counts.
 *
 * So the net at width 1 is this: **a superscalar that never pairs must be the 5-stage pipeline.**
 * Every number below is COPIED VERBATIM from `packages/engine/pipeline/src/timing.test.ts` — the
 * table, the derivations, the matrices, the crown-jewel deltas — and asserted against THIS engine.
 * That is what makes the suite a proof of a faithful port rather than a proof of self-consistency:
 * a number taken from this engine's own output would re-bless whatever it did, bug and all, whereas
 * a number taken from M3 fails the moment the port drifts. **If a cell here disagrees, the port is
 * wrong; the number is not.**
 *
 * The derivations are M3's and are reproduced so a failure still names the term that moved:
 *
 * Let `d_i` be the cycle instruction `i` leaves ID. It is then in EX at `d_i+1`, MEM at `d_i+2`,
 * WB at `d_i+3`; the machine halts at the last retire, so `cycles = d_last + 4`.
 *
 * - baseline (the pipe advances): `d_i >= d_(i-1) + 1`
 * - forwarding OFF (interlock in ID until the producer's WB): `d_i >= d_p + 3` for each producer
 *   `p` of a source register — +3 rather than +4 because of the same-cycle WB→ID rule.
 * - forwarding ON: only a LOAD producer stalls its consumer (`d_i >= d_L + 2`) — the load-use
 *   bubble. Every other RAW is covered by a forward.
 * - a MISPREDICTED transfer `b`: the redirect is clocked at the end of b's EX, so the target is
 *   fetched at `d_b+2` and leaves ID at `d_b+3` — a +2 penalty over the `d_b+1` baseline.
 * - a CORRECTLY PREDICTED taken transfer: ID steers fetch at `d_b`, a cycle earlier than EX could,
 *   so only the one already-fetched fall-through is lost — **+1**, not +2.
 * - a MISS: MEM holds `missPenalty` extra cycles, freezing IF/ID/EX.
 *
 * Summing the recurrence over a whole run collapses to one closed form:
 *
 * > **cycles = N + 4 + S + P + M**
 * >
 * > N = instructions that RETIRE, S = total stall cycles, P = the speculation penalty,
 * > M = misses × missPenalty.
 *
 * Each term is asserted SEPARATELY, because a single opaque total lets a compensating pair of
 * errors (over-count S, under-count P) pass and tells you nothing about where it broke.
 *
 * **The one deliberate difference from M3, and the only edits made to the ported file:**
 * `InstructionInstance.location` is `"<stage>.<slot>"` here, so the two assertions that read a
 * location compare against `'ID.0'` / `stage + '.0'` rather than the bare stage name (width is 1,
 * so the slot is always 0). Every EVENT field — `stall.stage`, `flush.stages`, `forward.to` — is
 * byte-identical to M3's and is asserted unchanged. `processor.test.ts` pins that boundary.
 *
 * **The finding this suite records.** The plan asks openly whether a 1-wide superscalar is
 * cycle-distinct from M3's pipeline, and says to state the answer rather than hide it: it is NOT.
 * Every cell below is M3's number, met exactly. That is the intended result at step 2a — the width-1
 * position is the pairing machine at its degenerate limit, and a difference here would have been a
 * bug in the port, not a feature of the tier.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

/**
 * `issueWidth: 1` is stated explicitly, not left to the default: it is the axis under test, and a
 * suite that reached width 1 by omission would silently stop testing it the day the default moved.
 */
const OFF: ProcessorConfig = { ...defaultConfig(), forwarding: false, issueWidth: 1 };
const ON: ProcessorConfig = { ...defaultConfig(), forwarding: true, issueWidth: 1 };

/** The two positions, as the table keys them. */
type Position = 'off' | 'on';
const CONFIG: Record<Position, ProcessorConfig> = { off: OFF, on: ON };

/**
 * The two prediction BEHAVIORS. There are three config values, but `'none'` and
 * `'static-not-taken'` are one machine — a processor with no predictor keeps fetching, and the
 * fall-through IS the not-taken path.
 */
type Scheme = 'static-not-taken' | 'static-taken';
const SCHEMES: readonly Scheme[] = ['static-not-taken', 'static-taken'];
const withScheme = (config: ProcessorConfig, branchPrediction: Scheme): ProcessorConfig => ({
  ...config,
  branchPrediction,
});

/**
 * The three cache positions. `off` is the cache-less machine; `small` (2 lines) and `large` (4
 * lines) are the flagship straddle's two sizes, sharing the same 16-byte line and the default
 * `missPenalty` 10.
 */
type CacheSize = 'off' | 'small' | 'large';
const CACHE: Record<CacheSize, CacheConfig | null> = {
  off: null,
  small: CACHE_SMALL,
  large: CACHE_LARGE,
};
const MISS_PENALTY = 10; // CACHE_SMALL / CACHE_LARGE default (engine-common's cache.ts).
const withCache = (config: ProcessorConfig, cache: CacheConfig | null): ProcessorConfig => ({
  ...config,
  cache,
});

/** The pinned miss count at a given size — `off` has none (no cache ⇒ no access). */
const missesAt = (pinned: Timing, cache: CacheSize): number =>
  cache === 'off' ? 0 : pinned.misses[cache];

/** `M`'s raw material as the ENGINE served it: `cache-access` events whose verdict is a miss. */
const missCount = (ts: CycleTrace[]): number =>
  eventsOf(ts, 'cache-access').filter((e) => !e.hit).length;

/**
 * Where stalls land: the pc of the stalling instruction → how many cycles it spent stalled, summed
 * across the whole run. A histogram rather than a bare count, because a model that stalls the right
 * NUMBER of times in the wrong PLACES is wrong. Keyed by pc (not by cycle) deliberately: a loop's
 * stalls recur at the same static pc every iteration.
 */
type StallSites = Readonly<Record<number, number>>;

/** How a program's control transfers break down. Every field is a property of the PROGRAM. */
interface Transfers {
  /** Taken AND PC-relative: the ones ID can bet on and win. A correct bet costs 1. */
  readonly takenPredictable: number;
  /** Conditional branches that DECLINED. Free under not-taken; a lost bet (2) under taken. */
  readonly notTaken: number;
  /** Taken but unpredictable — `jalr`, whose target is a register. Mispredicts under EVERY scheme. */
  readonly takenUnpredictable: number;
}

interface Timing {
  /** Instructions that RETIRE — a property of the program. Config-invariant. */
  readonly retires: number;
  readonly transfers: Transfers;
  /** `flush` events that name real casualties. NOT the same as `T` — see the header. */
  readonly flushes: { readonly branchTaken: number; readonly halt: number };
  /** The only term the FORWARDING toggle moves. */
  readonly stalls: Readonly<Record<Position, StallSites>>;
  /** Misses served under each cache geometry — the `M` term, `M = misses × missPenalty`. */
  readonly misses: { readonly small: number; readonly large: number };
}

/** `T` — taken control transfers, derived. Stating it beside its own parts would invite drift. */
const T = (t: Transfers): number => t.takenPredictable + t.takenUnpredictable;

/**
 * **`P` — the speculation penalty.** The rule is per TRANSFER, and it makes both schemes one
 * formula rather than two:
 *
 * > every resolved transfer costs **2 if mispredicted**, **1 if correctly predicted taken**, and
 * > **0 if correctly predicted not-taken**.
 *
 * A mispredict costs 2 because the target cannot be fetched until EX's redirect lands at the clock
 * edge, by which time two fetch slots are gone. A correct taken bet costs 1 because ID places it
 * one cycle earlier. A correct not-taken "prediction" costs nothing — the machine was already
 * fetching the right instructions.
 */
function penaltyOf(t: Transfers, scheme: Scheme): number {
  if (scheme === 'static-taken') {
    return 1 * t.takenPredictable + 2 * t.notTaken + 2 * t.takenUnpredictable;
  }
  return 2 * T(t);
}

/**
 * The table — M3's, verbatim. Every number is hand-derived from the recurrence above against the
 * EXPANDED instruction stream, which is where the traps are, since pseudo-ops hide real
 * instructions and real hazards from the `.s` source:
 *
 * - `la rd, sym` is ALWAYS two words, `lui rd, hi` + `addi rd, rd, lo` — the addi reads what the
 *   lui just wrote, so every `la` is a distance-1 RAW that stalls two cycles with forwarding off.
 * - `li` is sized by its literal; every `li` in this corpus is small, so each is a single
 *   `addi rd, x0, v` with no internal hazard.
 * - `mv` → `addi rd, rs, 0`; `ret` → `jalr x0, x1, 0`; `bnez rs, t` → `bne rs, x0, t`.
 * - TEXT_BASE is 0, so the pcs below are just `4 × index into the expanded stream`.
 */
const TIMING: Readonly<Record<string, Timing>> = {
  /**
   * `addi x1,x0,5 ; addi x2,x0,37 ; add x5,x1,x2` — no ecall: it halts by running off the end of
   * `.text` with three instructions still in flight. The one program whose tail is a pure DRAIN.
   *
   * OFF: d = 1, 2, 5 — the `add` waits for x2's write-back, so 2 stalls. cycles = 5 + 4 = 9.
   * ON:  d = 1, 2, 3 — both operands forwarded, nothing stalls. cycles = 3 + 4 = 7.
   */
  'add.s': {
    retires: 3,
    // No control transfers at all: P = 0 under every scheme — the control for the whole table.
    transfers: { takenPredictable: 0, notTaken: 0, takenUnpredictable: 0 },
    flushes: { branchTaken: 0, halt: 0 },
    stalls: { off: { 8: 2 }, on: {} },
    // No memory ops ⇒ no cache access ⇒ M = 0 at every size.
    misses: { small: 0, large: 0 },
  },

  /**
   * 4 prologue + 5 per iteration × 5 + 5 epilogue = 34 retires. `bnez` is taken 4 times.
   *
   * Expanded, with pcs:
   *    0 lui t0        4 addi t0,t0     8 addi t1,x0,5    12 addi a0,x0,0
   *   16 lw t2,0(t0)  20 add a0,a0,t2  24 addi t0,t0,4    28 addi t1,t1,-1   32 bne t1,x0,loop
   *   36 lui t3       40 addi t3,t3,20 44 sw a0,0(t3)     48 addi a7,x0,10   52 ecall
   *
   * OFF: the `la` addi at 4 stalls 2. Per iteration: `add` at 20 waits on the `lw` (2), `bne` at 32
   *      waits on the `addi t1` right before it (2) — 4/iteration × 5 = 20. Epilogue: the second
   *      `la` addi at 40 stalls 2, and `sw` at 44 waits on it (2). S = 2 + 20 + 4 = 26.
   * ON:  only the load-use survives: `add` at 20, one cycle, once per iteration. S = 5.
   */
  'array-sum.s': {
    retires: 34,
    transfers: { takenPredictable: 4, notTaken: 1, takenUnpredictable: 0 },
    flushes: { branchTaken: 4, halt: 0 },
    stalls: { off: { 4: 2, 20: 10, 32: 10, 40: 2, 44: 2 }, on: { 20: 5 } },
    // The LOCALITY-PUNISHER. One pass over 5 words: block 0 = arr[0..3] (arr[0] misses, arr[1..3]
    // hit), block 1 = arr[4] (a second compulsory miss); the `sw` lands in resident block 1 and
    // hits. Every block touched once ⇒ no reuse for a bigger cache to capture — 2 misses at BOTH.
    misses: { small: 2, large: 2 },
  },

  /**
   * The corpus's first NESTED loop: an outer loop of 2 passes over an inner 12-element walk. 2
   * prologue + 2 × (3 header + 12 × 5 inner + 2 footer) + 2 epilogue = 134 retires.
   *
   * Expanded, with pcs:
   *    0 addi a0,x0,0   4 addi t3,x0,2   8 lui t0        12 addi t0,t0    16 addi t1,x0,12
   *   20 lw t2,0(t0)   24 add a0,a0,t2  28 addi t0,t0,4  32 addi t1,t1,-1  36 bne t1,x0,inner
   *   40 addi t3,t3,-1 44 bne t3,x0,outer  48 addi a7,x0,10  52 ecall
   *
   * OFF: per inner iteration the `add` at 24 waits on the `lw` (2) and the `bne` at 36 waits on the
   *      `addi t1` before it (2) — 4 × 24 = 96. The `la` addi at 12 stalls 2 per pass. The outer
   *      `bne` at 44 waits on the `addi t3` before it (2) per pass. And the NESTED shape adds one
   *      array-sum never had: the FIRST `lw` of each pass at 20 reads t0 from the `la` two ahead of
   *      it — a distance-2 RAW that stalls 1, once per pass. S = 96 + 4 + 2 + 4 = 106.
   * ON:  only the load-use survives — `add` at 24, every inner iteration. S = 24.
   */
  'array-sum-twice.s': {
    retires: 134,
    transfers: { takenPredictable: 23, notTaken: 3, takenUnpredictable: 0 },
    flushes: { branchTaken: 23, halt: 0 }, // every taken branch has live code behind it
    stalls: { off: { 12: 4, 20: 2, 24: 48, 36: 48, 44: 4 }, on: { 24: 24 } },
    // The SIZE-STRADDLER — 3 blocks the 4-line cache fits and the 2-line overflows. Pass 1 is 3
    // compulsory misses either way; pass 2 all-hits under 4 lines but re-misses blocks 0 and 2
    // under 2. 5 misses small, 3 large — the flip.
    misses: { small: 5, large: 3 },
  },

  /**
   * 9 retires. One branch of EACH outcome on the same operands: `blt` at 12 is taken (signed
   * -1 < 1) and `bltu` at 24 is not (unsigned 4294967295 is not < 1).
   *    0 addi t0,x0,-1   4 addi t1,x0,1   8 addi a0,t0,0   12 blt t0,t1,20
   *   16 addi a0,t1,0  ← FLUSHED by the taken `blt` (N counts 9, not 10).
   *   20 addi a1,t0,0  24 bltu t0,t1,32  28 addi a1,t1,0  32 addi a7,x0,10  36 ecall
   *
   * OFF: d = 1, 2, 4, 5 | 8, 9, 10, 11, 12 → cycles = 12 + 4 = 16. Only `mv a0, t0` at 8
   *      interlocks, for ONE cycle. S = 1.
   * ON:  no loads anywhere ⇒ S = 0. cycles = 9 + 4 + 0 + 2 = 15.
   */
  'branch-flavors.s': {
    retires: 9,
    // The two branches differ by a single letter and bet in opposite directions, so no static
    // scheme can be right about both. P: not-taken 2·1 = 2; taken 1·1 + 2·1 = 3.
    transfers: { takenPredictable: 1, notTaken: 1, takenUnpredictable: 0 },
    flushes: { branchTaken: 1, halt: 0 }, // `ecall` is the last word of text — nothing behind it
    stalls: { off: { 8: 1 }, on: {} },
    misses: { small: 0, large: 0 }, // register-only
  },

  /**
   * 6 retires, no branches at all.
   *    0 lui t0    4 addi t0,t0    8 lb t1,0(t0)    12 lbu t2,0(t0)    16 addi a7,x0,10   20 ecall
   *
   * OFF: the `la` addi at 4 stalls 2; `lb` at 8 reads t0 one behind it (2). S = 4.
   * ON:  ZERO — two loads and no load-use hazard: `lbu` reads t0, the pointer, NOT the t1 that `lb`
   *      just loaded. The load-use rule keys off source registers, not off "a load is nearby".
   */
  'byte-loads.s': {
    retires: 6,
    transfers: { takenPredictable: 0, notTaken: 0, takenUnpredictable: 0 },
    flushes: { branchTaken: 0, halt: 0 },
    stalls: { off: { 4: 2, 8: 2 }, on: {} },
    // Two loads at the SAME address ⇒ one block: the `lb` compulsory-misses, the `lbu` hits.
    misses: { small: 1, large: 1 },
  },

  /**
   * 9 dynamic instructions: `jal` and `ret` are taken; `bge a0,a1,done` is NOT (17 >= 42 is false).
   *    0 addi a0,x0,17   4 addi a1,x0,42   8 jal ra,max   12 addi s0,a0,0   16 addi a7,x0,10
   *   20 ecall          24 bge a0,a1,done 28 addi a0,a1,0 32 jalr x0,x1,0
   *
   * **The honest counterexample: S = 0 in BOTH positions**, so forwarding buys nothing here — every
   * RAW is already separated by a flush gap. It is also the only corpus program with live code
   * behind its `ecall`, hence the one halt flush, and the only one whose `ret` sits at the last word
   * of text, hence a taken transfer that flushes nobody.
   */
  'call-return.s': {
    retires: 9,
    // Three transfers, one of each kind. P: not-taken 4; taken 5 — the bet costs a cycle here.
    misses: { small: 0, large: 0 },
    transfers: { takenPredictable: 1, notTaken: 1, takenUnpredictable: 1 },
    flushes: { branchTaken: 1, halt: 1 }, // jal flushes; ret has nothing behind it to kill
    stalls: { off: {}, on: {} },
  },

  /**
   * 2 prologue + 3 per iteration × 10 + 2 epilogue = 34 retires. `bnez` is taken 9 times.
   *    0 addi a0,x0,0   4 addi t0,x0,10
   *    8 add a0,a0,t0  12 addi t0,t0,-1  16 bne t0,x0,loop
   *   20 addi a7,x0,10 24 ecall
   *
   * OFF: iteration 1's `add` at 8 stalls 2, but no LATER iteration's does — the taken branch's
   *      2-cycle gap has already retired its producers. The `bne` at 16 stalls 2 EVERY iteration.
   *      S = 2 + 2 × 10 = 22.
   * ON:  no loads anywhere ⇒ S = 0.
   */
  'sum-loop.s': {
    retires: 34,
    transfers: { takenPredictable: 9, notTaken: 1, takenUnpredictable: 0 },
    flushes: { branchTaken: 9, halt: 0 },
    stalls: { off: { 8: 2, 16: 20 }, on: {} },
    misses: { small: 0, large: 0 }, // register-only accumulator
  },
};

function asm(source: string): AssembledProgram {
  const { program, errors } = assemble(source);
  if (!program) {
    throw new Error(
      'assembly failed:\n' + errors.map((e) => `  ${e.line}:${e.column} ${e.message}`).join('\n'),
    );
  }
  return program;
}

/** Drive one corpus program to halt under `config`, collecting every cycle. */
function run(file: string, config: ProcessorConfig): CycleTrace[] {
  const p = new SuperscalarProcessor();
  p.reset(toProgramImage(asm(readFileSync(PROGRAMS_DIR + file, 'utf8'))), config);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    // Every entry in the table is under 500 cycles; this only ever fires on a runaway bug.
    if (traces.length >= 500) throw new Error(`${file}: exceeded 500 cycles — runaway loop?`);
    traces.push(p.step());
  }
  return traces;
}

function eventsOf<T extends TraceEvent['type']>(
  ts: CycleTrace[],
  type: T,
): Extract<TraceEvent, { type: T }>[] {
  return ts.flatMap((t) =>
    t.events.filter((e): e is Extract<TraceEvent, { type: T }> => e.type === type),
  );
}

/** id → pc, from the fetch events — the only place an id and its address are stated together. */
function pcById(ts: CycleTrace[]): Map<string, number> {
  return new Map(eventsOf(ts, 'instr-fetch').map((e) => [e.instr, e.pc]));
}

/** The run's actual stall histogram, in the same shape the table states. */
function stallSites(ts: CycleTrace[]): Record<number, number> {
  const pcs = pcById(ts);
  const sites: Record<number, number> = {};
  for (const stall of eventsOf(ts, 'stall')) {
    const pc = pcs.get(stall.instr);
    if (pc === undefined) throw new Error(`stall names an instruction that was never fetched`);
    sites[pc] = (sites[pc] ?? 0) + 1;
  }
  return sites;
}

const total = (sites: StallSites): number => Object.values(sites).reduce((sum, n) => sum + n, 0);

/**
 * `P` as the ENGINE actually paid it: each resolved transfer priced by what it predicted and what
 * happened. Independent of {@link penaltyOf}, which prices the same transfers from the hand-derived
 * table — two routes to one number.
 */
const penaltyFromEvents = (ts: CycleTrace[]): number =>
  eventsOf(ts, 'branch-resolved').reduce(
    (sum, e) => sum + (e.predicted !== e.actual ? 2 : e.predicted ? 1 : 0),
    0,
  );

const takenTransfers = (ts: CycleTrace[]): number =>
  eventsOf(ts, 'branch-resolved').filter((e) => e.actual).length;

/** Every (program, position) pair the table pins. */
const CASES = Object.keys(TIMING).flatMap((file) =>
  (['off', 'on'] as const).map((position) => ({ file, position })),
);

describe('the pinned cycle-count table (M3’s numbers, met at width 1)', () => {
  it('covers every program in the corpus', () => {
    // The corpus is enumerated from disk by the conformance harness, so a program added later is
    // differentially tested automatically — but it would NOT get a timing entry automatically, and
    // a table that silently stopped covering the corpus is exactly the kind of decay this suite
    // exists to prevent. Fail loudly instead, and make the author derive the new entry by hand.
    const corpus = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.s'));
    expect(corpus.length).toBeGreaterThan(0); // ...and guard the guard against an empty read
    expect([...corpus].sort()).toEqual(Object.keys(TIMING).sort());
  });

  it.each(CASES)('$file [forwarding $position]', ({ file, position }) => {
    const pinned = TIMING[file]!;
    const ts = run(file, CONFIG[position]);
    const sites = pinned.stalls[position];

    expect(eventsOf(ts, 'instr-retire'), 'N — retired instructions').toHaveLength(pinned.retires);
    expect(takenTransfers(ts), 'T — taken control transfers').toBe(T(pinned.transfers));
    expect(stallSites(ts), 'S — where the stalls land').toEqual(sites);

    const P = penaltyOf(pinned.transfers, 'static-not-taken');
    expect(P, "the not-taken scheme's P is exactly M3's 2·T").toBe(2 * T(pinned.transfers));
    expect(ts).toHaveLength(pinned.retires + 4 + total(sites) + P);
  });
});

describe("the formula's constant terms, isolated", () => {
  it('+4: the fill and drain, on the one program that ends in a pure drain', () => {
    // `add.s` has no `ecall` — it runs off the end of `.text` with three instructions still in
    // flight, so its tail is the drain and nothing else. If halting truncated the run instead of
    // draining, this is where it shows.
    const ts = run('add.s', ON);
    expect(eventsOf(ts, 'stall')).toEqual([]);
    expect(takenTransfers(ts)).toBe(0);
    expect(ts).toHaveLength(3 + 4);
    // The drain is real: fetching stops three cycles before the machine does.
    expect(eventsOf(ts, 'instr-fetch')).toHaveLength(3);
    expect(eventsOf(ts, 'instr-retire')).toHaveLength(3);
  });

  it('+2 per taken transfer, isolated from every stall', () => {
    // A program with exactly one taken branch and no RAW anywhere, so the penalty is the only thing
    // separating it from N+4 — in BOTH configs, since with nothing to forward the toggle cannot
    // move it.
    const source = [
      '.text',
      'addi x1, x0, 0',
      'beq x0, x0, target', // always taken, and reads only x0 — never a dependency
      'addi x2, x0, 111', // shadow
      'addi x3, x0, 222', // shadow
      'target:',
      'ecall',
    ].join('\n');
    for (const config of [OFF, ON]) {
      const p = new SuperscalarProcessor();
      p.reset(toProgramImage(asm(source)), config);
      const ts: CycleTrace[] = [];
      while (!p.isHalted()) ts.push(p.step());

      expect(eventsOf(ts, 'stall')).toEqual([]);
      expect(eventsOf(ts, 'instr-retire')).toHaveLength(3);
      expect(takenTransfers(ts)).toBe(1);
      expect(ts).toHaveLength(3 + 4 + 0 + 2 * 1); // P = 2·T: the not-taken scheme, mispredicting
    }
  });

  it('charges the +2 even when the flush kills nobody — a penalty is not a casualty', () => {
    // `call-return.s`'s `ret` is the last word of `.text`, so nothing was fetched behind it: it
    // emits NO flush event (the pinned "a flush reports real casualties" rule) and still costs two
    // cycles. This is why the formula's T counts taken TRANSFERS and not `flush` events — on this
    // program there are 2 of the former and 1 of the latter.
    const ts = run('call-return.s', ON);
    expect(takenTransfers(ts)).toBe(2);
    expect(eventsOf(ts, 'flush').filter((e) => e.reason === 'branch-taken')).toHaveLength(1);
    expect(ts).toHaveLength(9 + 4 + 0 + 2 * 2);
  });
});

describe('N and T are the program; S is the microarchitecture', () => {
  // Forwarding is a claim about HOW operands reach the ALU — it cannot change which instructions
  // run or which branches are taken. If either of these ever differs across configs, the toggle has
  // broken something architectural and the timing numbers are the least of it.
  it.each(Object.keys(TIMING))(
    '%s retires the same instructions and takes the same branches',
    (file) => {
      const off = run(file, OFF);
      const on = run(file, ON);

      expect(eventsOf(on, 'instr-retire')).toHaveLength(eventsOf(off, 'instr-retire').length);
      expect(takenTransfers(on)).toBe(takenTransfers(off));
      // Stronger than the counts: the same instructions retire in the same ORDER, at the same pcs.
      const retiredPcs = (ts: CycleTrace[]): number[] => {
        const pcs = pcById(ts);
        return eventsOf(ts, 'instr-retire').map((e) => pcs.get(e.instr)!);
      };
      expect(retiredPcs(on)).toEqual(retiredPcs(off));
    },
  );

  it.each(Object.keys(TIMING))(
    '%s: the whole cycle difference is stall cycles, exactly',
    (file) => {
      // `cycles = N + 4 + S + 2·T` with N and T config-invariant collapses to this subtraction. Note
      // it holds for `call-return.s` too, where both sides are 0.
      const pinned = TIMING[file]!;
      const off = run(file, OFF);
      const on = run(file, ON);
      expect(off.length - on.length).toBe(total(pinned.stalls.off) - total(pinned.stalls.on));
    },
  );
});

describe('the crown jewel — the same program, the same answer, fewer cycles', () => {
  // The spec's flagship interaction (§12), asserted WITHOUT reference to the formula above: even if
  // every derived constant were wrong, this comparison would still be the claim. It is also
  // precisely the claim INV-8 structurally cannot make.
  const RAW_CHAINED = ['add.s', 'array-sum.s', 'byte-loads.s', 'sum-loop.s'];

  it.each(RAW_CHAINED)(
    '%s: strictly fewer cycles with forwarding on, identical final state',
    (file) => {
      const off = run(file, OFF);
      const on = run(file, ON);
      const finalOff = off[off.length - 1]!.state;
      const finalOn = on[on.length - 1]!.state;

      expect(on.length).toBeLessThan(off.length);
      expect([...finalOn.registers]).toEqual([...finalOff.registers]);
      expect(finalOn.pc).toBe(finalOff.pc);
      expect(finalOn.halted).toBe(finalOff.halted);
      // The UNION of both runs' touched addresses, not just one side's: a word that only ONE
      // position wrote is precisely the asymmetry worth catching.
      for (const addr of new Set([
        ...finalOff.memory.definedAddresses(),
        ...finalOn.memory.definedAddresses(),
      ])) {
        expect(finalOn.memory.readWord(addr), `memory word at 0x${addr.toString(16)}`).toBe(
          finalOff.memory.readWord(addr),
        );
      }
    },
  );

  it('does NOT claim forwarding is free money — call-return.s is identical in both', () => {
    // Every RAW in `call-return.s` is already separated by a flush gap, so the interlock never has
    // anything to charge for. A suite that asserted "on is faster" across the whole corpus would be
    // overclaiming, and would have to be weakened to `<=` — which would then pass for a machine
    // where forwarding did nothing at all.
    expect(run('call-return.s', ON)).toHaveLength(run('call-return.s', OFF).length);
  });
});

describe('stall and flush placement across the corpus', () => {
  it('every stall interlocks in ID, and names a real in-flight instruction', () => {
    for (const { file, position } of CASES) {
      const ts = run(file, CONFIG[position]);
      const pcs = pcById(ts);
      for (const stall of eventsOf(ts, 'stall')) {
        // The EVENT field is the bare stage name, exactly as M3 emits it — only `location` is
        // slotted. That split is what keeps `stall.stage` a stable cross-model surface.
        expect(stall.stage, `${file} [${position}]`).toBe('ID');
        expect(pcs.has(stall.instr)).toBe(true);
        // ...and it really is in ID that cycle, not merely labelled so. `location` IS slotted, and
        // at width 1 the slot is always 0 — the deliberate difference from M3.
        const cycle = ts.find((t) => t.events.includes(stall))!;
        expect(cycle.instructions.find((i) => i.id === stall.instr)?.location).toBe('ID.0');
      }
    }
  });

  it("reports 'load-use' only with forwarding on — with it off, the interlock says 'raw'", () => {
    // With forwarding off the general interlock subsumes the load-use case and honestly reports
    // what it did: it interlocked on a RAW, like it does for every other hazard.
    for (const file of Object.keys(TIMING)) {
      expect(new Set(eventsOf(run(file, OFF), 'stall').map((e) => e.reason))).toEqual(
        total(TIMING[file]!.stalls.off) > 0 ? new Set(['raw']) : new Set(),
      );
      expect(new Set(eventsOf(run(file, ON), 'stall').map((e) => e.reason))).toEqual(
        total(TIMING[file]!.stalls.on) > 0 ? new Set(['load-use']) : new Set(),
      );
    }
  });

  it.each(CASES)(
    '$file [forwarding $position]: flushes name exactly their casualties',
    ({ file, position }) => {
      const pinned = TIMING[file]!;
      const ts = run(file, CONFIG[position]);
      const flushes = eventsOf(ts, 'flush');

      // Flushes are architectural: the same branches are taken and the same shadow sits behind the
      // same `ecall` whatever the forwarding config, so this table has no per-position column.
      expect(flushes.filter((e) => e.reason === 'branch-taken')).toHaveLength(
        pinned.flushes.branchTaken,
      );
      expect(flushes.filter((e) => e.reason === 'halt')).toHaveLength(pinned.flushes.halt);

      for (const flush of flushes) {
        // A taken branch resolves in EX and kills the two younger instructions behind it — one in
        // ID, one in IF. An architectural halt is detected a stage earlier, in ID, so it has exactly
        // one younger instruction to kill. `stages` carries BARE stage names, identical to M3's.
        expect(flush.stages).toEqual(flush.reason === 'branch-taken' ? ['ID', 'IF'] : ['IF']);

        // ...and the casualties are REAL, which is the whole content of the pinned rule: the trace
        // says an instruction died in each named stage, so the map has that many rows to cut and a
        // lesson triggering on a bare `{ event: 'flush' }` never announces a bubble that didn't
        // happen. The comparison joins the two encodings — a bare `stages` entry against a slotted
        // `location` — which at width 1 means slot 0.
        const cycle = ts.find((t) => t.events.includes(flush))!;
        for (const stage of flush.stages) {
          expect(cycle.instructions.some((i) => i.location === `${stage}.0`)).toBe(true);
        }
      }
    },
  );
});

/**
 * `P` — the speculation penalty, corpus-wide, across both schemes. Nothing here is a snapshot:
 * every `P` comes from {@link penaltyOf} applied to the program's hand-derived transfer breakdown,
 * and the cycle count is the closed form.
 */
const MATRIX = Object.keys(TIMING).flatMap((file) =>
  (['off', 'on'] as const).flatMap((position) =>
    SCHEMES.map((scheme) => ({ file, position, scheme })),
  ),
);

describe('P — the speculation penalty', () => {
  it.each(MATRIX)('$file [forwarding $position, predict $scheme]', ({ file, position, scheme }) => {
    const pinned = TIMING[file]!;
    const ts = run(file, withScheme(CONFIG[position], scheme));
    const sites = pinned.stalls[position];

    // N and the transfer structure are the PROGRAM: no scheme can change them. Asserting it in
    // every cell is what makes the P column attributable.
    expect(eventsOf(ts, 'instr-retire'), 'N — the program, not the config').toHaveLength(
      pinned.retires,
    );
    expect(takenTransfers(ts), 'T — the program, not the config').toBe(T(pinned.transfers));
    // S is the FORWARDING toggle's term and must not move with the scheme.
    expect(stallSites(ts), 'S — the forwarding toggle, untouched by prediction').toEqual(sites);

    // P, by two independent routes. The pinned route derives it from the transfer breakdown; the
    // measured route applies the per-transfer rule to the engine's OWN prediction outcomes.
    const P = penaltyOf(pinned.transfers, scheme);
    expect(penaltyFromEvents(ts), 'P — each transfer priced by what the engine predicted').toBe(P);

    expect(ts).toHaveLength(pinned.retires + 4 + total(sites) + P);
  });

  /**
   * **No scheme dominates** — asserted as a signed delta per program rather than as "prediction is
   * faster on average", because the average is exactly the claim that would let the loss hide.
   *
   * - `sum-loop.s` — a backward loop branch taken 9 of 10. `P: 18 → 11`, a **7-cycle win**.
   * - `array-sum.s` — same shape, 4 of 5. `P: 8 → 6`, a **2-cycle win**.
   * - `call-return.s` — `bge a0, a1` is `17 >= 42`: it never goes. `P: 4 → 5`, a **1-cycle LOSS**.
   */
  it.each(['off', 'on'] as const)(
    'no scheme dominates [forwarding %s] — sum-loop wins, call-return LOSES',
    (position) => {
      const cyclesOf = (file: string, scheme: Scheme): number =>
        run(file, withScheme(CONFIG[position], scheme)).length;
      const delta = (file: string): number =>
        cyclesOf(file, 'static-not-taken') - cyclesOf(file, 'static-taken');

      // Positive = static-taken is faster. Each equals its `P_nt − P_t` exactly, because N and S
      // are config-invariant — the subtraction IS the toggle's whole effect.
      expect(delta('sum-loop.s'), 'P 18 → 11: nine correct bets').toBe(7);
      expect(delta('array-sum.s'), 'P 8 → 6: four correct bets').toBe(2);
      expect(delta('call-return.s'), 'P 4 → 5: the bet that loses — NEGATIVE').toBe(-1);
      // A program with nothing to predict must not move at all.
      expect(delta('add.s'), 'no transfers ⇒ no penalty ⇒ no effect').toBe(0);
      expect(delta('byte-loads.s'), 'straight-line').toBe(0);
    },
  );

  /**
   * The regression in absolute numbers, so it cannot be read as noise. M3 pinned `call-return.s` at
   * **17 cycles in both forwarding positions** and **18** under `static-taken` — the one corpus
   * program made slower by a toggle sold as an optimization. A width-1 superscalar must hit both.
   */
  it('call-return.s: 17 cycles under not-taken, 18 under taken — a toggle is a tradeoff', () => {
    for (const position of ['off', 'on'] as const) {
      const nt = run('call-return.s', withScheme(CONFIG[position], 'static-not-taken'));
      const t = run('call-return.s', withScheme(CONFIG[position], 'static-taken'));
      expect(nt, `[forwarding ${position}] N=9, S=0, P=2·2`).toHaveLength(17);
      expect(t, `[forwarding ${position}] N=9, S=0, P=1+2+2`).toHaveLength(18);
    }
  });

  /**
   * Casualties ARE the penalty, and it is not a coincidence: a killed instruction is a wasted fetch
   * slot, and a wasted fetch slot is a cycle. M3 draws 18 casualty rows for `sum-loop` under
   * not-taken and 11 once the bet is on.
   */
  it('casualties ARE the penalty — sum-loop draws 18 rows, then 11', () => {
    const casualties = (scheme: Scheme): number =>
      eventsOf(run('sum-loop.s', withScheme(ON, scheme)), 'flush')
        .filter((e) => e.reason !== 'halt')
        .reduce((sum, e) => sum + e.stages.length, 0);

    const pinned = TIMING['sum-loop.s']!.transfers;
    expect(casualties('static-not-taken'), "9 taken × 2 squashed — M3's pinned 18").toBe(18);
    expect(casualties('static-taken'), '9 bets × 1, plus the exit mispredict').toBe(11);
    expect(casualties('static-not-taken')).toBe(penaltyOf(pinned, 'static-not-taken'));
    expect(casualties('static-taken')).toBe(penaltyOf(pinned, 'static-taken'));
  });
});

/**
 * `M` — the miss term. A configured cache makes MEM variable-latency, so the count grows by
 * `M = misses × missPenalty`. `M` is orthogonal to BOTH other config terms: a cache is a timing
 * shadow that holds no values, so it cannot change which instructions run (`N`), where they
 * interlock (`S`), or what they predict (`P`).
 */
const CACHE_MATRIX = Object.keys(TIMING).flatMap((file) =>
  (['off', 'on'] as const).flatMap((position) =>
    SCHEMES.flatMap((scheme) =>
      (['off', 'small', 'large'] as const).map((cache) => ({ file, position, scheme, cache })),
    ),
  ),
);

describe('M — the miss term (cycles = N + 4 + S + P + M)', () => {
  it.each(CACHE_MATRIX)(
    '$file [forwarding $position, predict $scheme, cache $cache]',
    ({ file, position, scheme, cache }) => {
      const pinned = TIMING[file]!;
      const ts = run(file, withCache(withScheme(CONFIG[position], scheme), CACHE[cache]));
      const sites = pinned.stalls[position];

      // N, S, T, P are the cache-oblivious terms — NONE of them may move when the cache axis is
      // added. Re-asserting all four in every cache cell is what makes `M` attributable.
      expect(eventsOf(ts, 'instr-retire'), 'N — the cache cannot change it').toHaveLength(
        pinned.retires,
      );
      expect(takenTransfers(ts), 'T — the cache cannot change it').toBe(T(pinned.transfers));
      expect(stallSites(ts), 'S — the forwarding toggle, untouched by the cache').toEqual(sites);
      const P = penaltyOf(pinned.transfers, scheme);
      expect(penaltyFromEvents(ts), 'P — the prediction toggle, untouched by the cache').toBe(P);

      // `M`, by two independent routes — the discipline `P` uses.
      const misses = missesAt(pinned, cache);
      expect(missCount(ts), 'M — misses the engine actually served').toBe(misses);
      const M = misses * MISS_PENALTY;
      // `off` must emit no cache-access at all — the cache-off machine is byte-identical to M3/M4.
      if (cache === 'off') expect(eventsOf(ts, 'cache-access'), 'cache-off is inert').toEqual([]);

      expect(ts).toHaveLength(pinned.retires + 4 + total(sites) + P + M);
    },
  );
});

describe('the crown jewel, cache edition — the same program, the same answer, more cycles', () => {
  //   delta = cycles(small cache) − cycles(large cache);  POSITIVE = the bigger cache buys cycles.
  const FW_SCHEME = (['off', 'on'] as const).flatMap((position) =>
    SCHEMES.map((scheme) => ({ position, scheme })),
  );

  it.each(FW_SCHEME)(
    'no size dominates [forwarding $position, predict $scheme]',
    ({ position, scheme }) => {
      const base = withScheme(CONFIG[position], scheme);
      const delta = (file: string): number =>
        run(file, withCache(base, CACHE_SMALL)).length -
        run(file, withCache(base, CACHE_LARGE)).length;

      // The STRADDLER wins: 3 blocks the 4-line fits and the 2-line overflows — 2 fewer misses ×
      // penalty 10 = 20 cycles the bigger cache buys back.
      expect(delta('array-sum-twice.s'), 'the straddler: bigger cache buys back 2 misses').toBe(20);
      // The PUNISHER buys nothing: array-sum walks its array ONCE, so every block is
      // compulsory-missed exactly once at ANY size — no reuse for capacity to capture.
      expect(delta('array-sum.s'), 'no revisit ⇒ no reuse ⇒ size buys nothing').toBe(0);
      expect(delta('byte-loads.s'), 'one block ⇒ size buys nothing').toBe(0);
      // Programs with nothing to cache cannot move at all — the controls.
      expect(delta('add.s'), 'no memory ⇒ no miss ⇒ no effect').toBe(0);
      expect(delta('sum-loop.s'), 'register-only accumulator').toBe(0);
      expect(delta('branch-flavors.s'), 'register-only').toBe(0);
      expect(delta('call-return.s'), 'no loads or stores').toBe(0);
    },
  );
});

describe('M is orthogonal to both other axes — the size-delta is the program, not the config', () => {
  // `M` depends only on the address stream, which no toggle can move, so a program's cache
  // size-delta is a single constant across the ENTIRE forwarding × prediction matrix.
  it.each(Object.keys(TIMING))(
    '%s: one small−large delta across all four forwarding×scheme cells',
    (file) => {
      const deltas = (['off', 'on'] as const).flatMap((position) =>
        SCHEMES.map((scheme) => {
          const base = withScheme(CONFIG[position], scheme);
          return (
            run(file, withCache(base, CACHE_SMALL)).length -
            run(file, withCache(base, CACHE_LARGE)).length
          );
        }),
      );
      expect(new Set(deltas).size, 'one delta whatever the other two toggles do').toBe(1);
      const pinned = TIMING[file]!;
      expect(deltas[0], 'delta = (misses_small − misses_large) × penalty').toBe(
        (pinned.misses.small - pinned.misses.large) * MISS_PENALTY,
      );
    },
  );
});
