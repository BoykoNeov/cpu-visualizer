import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import {
  defaultConfig,
  type CycleTrace,
  type ProcessorConfig,
  type TraceEvent,
} from '@cpu-viz/trace';
import { DeepPipelineProcessor } from './index';

/**
 * **THE NET for M11 (step 3).** The suite the whole milestone is written around.
 *
 * `differential.test.ts` proves this model computes the right ANSWERS on the whole corpus, and its
 * own docblock says in prose that this proves NOTHING about depth: an in-order 7-stage retires in
 * order, so INV-8 runs green with IF2 and EX2 as pure pass-throughs. The milestone's characteristic
 * failure —
 *
 * > *a `deep-pipeline` package that typechecks, passes INV-8, renders on the map, and is a 5-stage
 * > wearing seven labels*
 *
 * — lives entirely inside that blind spot. Every observable consequence of the depth is TIMING.
 * This file is where it becomes observable, and the discriminator is deliberately the
 * **coefficients**, not the constant: `N+4 → N+6` is cheap (any drain change produces it), while the
 * per-hazard and per-misprediction penalties are what a real second execute cycle and a real second
 * fetch cycle actually buy. The recorded MUTATION CHECK at the bottom of this header is the
 * mechanical form of that claim.
 *
 * `processor.test.ts` pins each coefficient in isolation on hand-built pairs (ALU→ALU 1, load-use 2,
 * forwarding-OFF RAW 3, misprediction 4, correct taken bet 2). None of that is repeated here. What
 * is new at this scale is the CORPUS: hazards that interact, loops that repeat them, flush shapes
 * that mix, and a closed form that has to balance in all sixty-six cells.
 *
 * ## The closed form, derived from the pinned decisions and from nothing else
 *
 * The two pinned decisions (2026-07-27) are *every control transfer resolves at the end of EX2* and
 * *the two-cycle execute is real and uniform*. Let `d_i` be the cycle instruction `i` leaves ID.
 * It is then in EX1 at `d_i+1`, EX2 at `d_i+2`, MEM at `d_i+3`, WB at `d_i+4`; the machine halts at
 * the last retire, so `cycles = d_last + 5`, and the first instruction leaves ID at `d = 2` (IF1,
 * IF2, ID). The pinned rules give the recurrence:
 *
 * - baseline (the pipe advances): `d_i >= d_(i-1) + 1`
 * - **forwarding OFF** — the register file is the only path and the consumer waits in ID for the
 *   producer's WB: `d_c >= d_p + 4`. It is +4 rather than +5 because of the same-cycle WB→ID rule.
 * - **forwarding ON, non-load producer** — the result is finished at the end of EX2 (`d_p+2`) and is
 *   forwardable out of EX2/MEM while the producer is in MEM (`d_p+3`); the consumer takes operands
 *   at the start of ITS EX1 (`d_c+1`). So `d_c+1 >= d_p+3`, i.e. **`d_c >= d_p + 2`**. A distance-1
 *   pair therefore costs **one bubble that forwarding cannot remove** — the milestone's thesis, and
 *   the term the 5-stage's formula does not have at all.
 * - **forwarding ON, LOAD producer** — the datum exists at the end of MEM (`d_p+3`), forwardable out
 *   of MEM/WB at `d_p+4`: `d_c+1 >= d_p+4`, i.e. `d_c >= d_p + 3` — **two** bubbles at distance 1.
 * - a resolved transfer costs **4 if mispredicted** (EX1, ID, IF2 and IF1 are all younger than the
 *   resolve point), **2 if correctly predicted taken** (ID's bet kills the two fall-throughs the
 *   two-deep front end had already fetched), **0 if correctly predicted not-taken**.
 *
 * Summing the recurrence over a run collapses to one closed form:
 *
 * > **cycles = N + 6 + S + P**
 * >
 * > N = instructions that RETIRE, S = stall cycles ON THE RETIRED PATH, P = the speculation penalty.
 *
 * Each term is asserted SEPARATELY below. A single opaque total lets a compensating pair of errors
 * (over-count S, under-count P) pass and says nothing about which term drifted.
 *
 * **Every number in this file was hand-derived from the recurrence above before being compared to
 * the engine**, and the plan's own seeded figures were deliberately not used as the derivation — a
 * cross-check that reads the plan's guess back to itself is not a cross-check. The corroboration
 * that fell out afterwards: every `P` here is exactly **2×** the 5-stage's pinned `P` for the same
 * program and scheme, which is what "the penalty doubles" means at corpus scale. Cross-model numbers
 * stay in prose — `eslint.config.js` denies a model importing a sibling model, so `engine-pipeline`
 * is not importable here and never should be.
 *
 * ## What this file found that the plan did not predict — S is NOT prediction-invariant
 *
 * The 5-stage's timing suite asserts `S — the forwarding toggle, untouched by prediction` in every
 * cell of its P matrix. **That assertion does not port**, and the reason is depth itself. See
 * {@link SHADOW} and the `S is not prediction-invariant` describe: `call-return.s` at forwarding OFF
 * emits a `'raw'` stall under the not-taken behaviour that vanishes under `static-taken`, on an
 * instruction that **never retires**. The cycle count is identical either way, which is why the
 * closed form is stated over the RETIRED path and both histograms are pinned separately.
 *
 * ## The recorded MUTATION CHECK — run 2026-07-27, both halves
 *
 * Executed as TWO separate mutations rather than one combined edit, because a combined edit cannot
 * say which stage was carrying the reddening. Both halves of the acceptance were run, not argued:
 * `differential.test.ts` was executed under each stub, not assumed green from this file's prose.
 *
 * 1. **Stub IF2** — `stageIf1` writes `ctx.next.if2Id` directly, collapsing the IF1/IF2 latch so the
 *    front end is one deep again. Result: **`differential.test.ts` green, 68/68**; this suite **RED,
 *    55 of 92**. The constant fell to `N+5`, the misprediction penalty to 3 and the correct-bet
 *    penalty to 1 — the front end is where two of the four casualties lived.
 * 2. **Stub EX2** — the `stageEx2` switch moved back into `stageEx1`, `ex1Ex2` carrying the finished
 *    `Ex2MemLatch`, EX2 a pass-through, an `EX1/EX2 → EX1` forward added, **and the `'ex-latency'`
 *    arm dropped from `detectHazard`** — without that last part the ALU→ALU bubble survives the stub
 *    and the reddening is under-read. Result: **`differential.test.ts` green, 68/68**; this suite
 *    **RED, 58 of 92**. `add.s` at forwarding ON fell from 10 cycles to 9 (its `S` from 1 to 0 — the
 *    bubble gone), `sum-loop.s` from 87 to 67, and the misprediction penalty from 4 to 3.
 *
 * **What that second stub does NOT move is worth recording, because it is where a careless reading
 * of the mutation would over-claim.** The load-use penalty stays at 2 and the forwarding-OFF RAW
 * stays at 3: both are governed by when MEM and WB happen, and a stubbed EX2 still OCCUPIES its
 * cycle — seven stages remain. Only the two coefficients that depend on *when the result is
 * finished* move. Collapsing the stage entirely is a different mutation and a different machine.
 *
 * Both stubs are exactly what `processor.ts`'s header describes, and both were reverted with
 * `git checkout` so the revert is exact rather than retyped. The asymmetry is the point: **INV-8
 * could not see either mutation, and this file saw both.**
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

/**
 * `cache: null` is written EXPLICITLY rather than inherited, for the reason `differential.test.ts`
 * spells out. Note that reason CHANGED at M11 step 6 while the practice stayed: the machine used to
 * refuse a non-null cache by name, and now honors it — so an inherited default would no longer
 * throw here, it would silently add `misses × missPenalty` to every closed-form cell below.
 */
const base = (): ProcessorConfig => ({ ...defaultConfig(), cache: null });

const OFF: ProcessorConfig = { ...base(), forwarding: false };
const ON: ProcessorConfig = { ...base(), forwarding: true };

/** The two forwarding positions, as the table keys them. */
type Position = 'off' | 'on';
const CONFIG: Record<Position, ProcessorConfig> = { off: OFF, on: ON };

/**
 * The two prediction BEHAVIORS. There are three config values, but `'none'` and
 * `'static-not-taken'` are one machine — a processor with no predictor keeps fetching, and the
 * fall-through IS the not-taken path (the identity `DEEP_PIPELINE_CAPABILITIES` records, inherited
 * from the 5-stage). The equivalence is pinned on whole traces by its own test below rather than
 * assumed; running a third identical column through the matrix would prove nothing this file is
 * about.
 */
type Scheme = 'static-not-taken' | 'static-taken';
const SCHEMES: readonly Scheme[] = ['static-not-taken', 'static-taken'];
const withScheme = (
  config: ProcessorConfig,
  branchPrediction: Scheme | 'none',
): ProcessorConfig => ({
  ...config,
  branchPrediction,
});

/**
 * Where stalls land: the pc of the stalling instruction → how many cycles it spent stalled, summed
 * across the run. A histogram rather than a bare count, because a model that stalls the right NUMBER
 * of times in the wrong PLACES is wrong; keyed by pc rather than by cycle because a loop's stalls
 * recur at the same static pc every iteration, so `{ [PC]: 20 }` is hand-checkable in a way twenty
 * cycle numbers are not. `S` is derived by summing this, never stated twice.
 */
type StallSites = Readonly<Record<number, number>>;

/**
 * How a program's control transfers break down. Every field is a property of the PROGRAM —
 * config-invariant, exactly like `retires` — because no scheme can change which branches are taken.
 * What a scheme changes is only the PRICE of each kind, which is why `P` factors through this.
 */
interface Transfers {
  /** Taken AND PC-relative: the ones ID can bet on and win. A correct bet costs 2 on this machine. */
  readonly takenPredictable: number;
  /** Conditional branches that DECLINED. Free under not-taken; a lost bet (4) under taken. */
  readonly notTaken: number;
  /** Taken but unpredictable — `jalr`, whose target is a register. Mispredicts under EVERY scheme. */
  readonly takenUnpredictable: number;
}

interface Timing {
  /** Instructions that RETIRE — a property of the program. Config-invariant. */
  readonly retires: number;
  readonly transfers: Transfers;
  /**
   * The stalls that COST CYCLES: the histogram over instructions that go on to retire. This is the
   * `S` of the closed form. One entry per forwarding position serves all schemes — but that is an
   * empirical property of this corpus rather than a structural one, and the matrix cell that asserts
   * it says so along with the counterexample shape that would break it.
   */
  readonly stalls: Readonly<Record<Position, StallSites>>;
  /**
   * Stalls on instructions that are later SQUASHED — see {@link SHADOW}. Present on exactly one
   * corpus program, and only under a scheme that does not bet. Absent means "none", which is the
   * honest default: a stall that costs nothing is a rarity, not a fixture.
   */
  readonly shadowStalls?: Readonly<Record<Position, StallSites>>;
  /**
   * `flush` events with `reason: 'halt'`. The one flush count that is invariant across BOTH toggles,
   * because it depends only on whether live code sits behind the program's `ecall`. The taken-branch
   * flush COUNT is deliberately not tabulated: on this machine its shape and even its arity depend
   * on both toggles — see the flush-shape describe, where that is pinned as the finding it is.
   */
  readonly haltFlushes: number;
}

/** `T` — taken control transfers, derived. Stating it beside its own parts would invite drift. */
const T = (t: Transfers): number => t.takenPredictable + t.takenUnpredictable;

/**
 * **`P` — the speculation penalty, at twice the 5-stage's coefficients.**
 *
 * Derived from the pinned resolve point and nowhere else: a transfer that resolves at the end of EX2
 * has FOUR younger stages (EX1, ID, IF2, IF1), and a bet placed in ID on a two-deep front end has
 * TWO (IF2, IF1). So:
 *
 * > every resolved transfer costs **4 if mispredicted**, **2 if correctly predicted taken**, and
 * > **0 if correctly predicted not-taken**.
 *
 * The scheme's only job is to decide `predicted`, and everything else falls out:
 *
 * - `static-not-taken` (≡ `none`): nothing is ever predicted taken ⇒ every taken transfer
 *   mispredicts (4·T) and every declined branch is free.
 * - `static-taken`: predictable taken ⇒ correct bet (2); declined ⇒ lost bet (4); `jalr` ⇒ cannot be
 *   bet on, and it always goes ⇒ mispredict (4).
 *
 * **Depth taxes you even when the prediction is right** — that is the `2·takenPredictable` term, and
 * it is a teaching line rather than a wart. Making it cheap again means a predictor in IF1 (a BTB /
 * next-line fetch), which is new mechanism and deliberately not in this model.
 */
function penaltyOf(t: Transfers, scheme: Scheme): number {
  if (scheme === 'static-taken') {
    return 2 * t.takenPredictable + 4 * t.notTaken + 4 * t.takenUnpredictable;
  }
  return 4 * T(t);
}

/**
 * The table. Every number is hand-derived from the recurrence in the header, against the EXPANDED
 * instruction stream — which is where the traps are, since pseudo-ops hide real instructions and
 * real hazards from the `.s` source:
 *
 * - `la rd, sym` is ALWAYS two words, `lui rd, hi` + `addi rd, rd, lo` — the addi reads what the lui
 *   just wrote, so every `la` is a distance-1 RAW. On THIS machine that costs 3 with forwarding off
 *   and — the new part — **1 even with forwarding on**, because `lui` runs no ALU and still takes
 *   both execute cycles (the uniform two-cycle execute, pinned 2026-07-27).
 * - `li` is sized by its literal; every `li` in this corpus is small, so each is a single
 *   `addi rd, x0, v` with no internal hazard.
 * - `mv` → `addi rd, rs, 0`; `ret` → `jalr x0, x1, 0`; `bnez rs, t` → `bne rs, x0, t`.
 * - TEXT_BASE is 0, so the pcs below are just `4 × index into the expanded stream`.
 *
 * The per-program derivations state the DISTANCE of each hazard (instructions between producer and
 * consumer, inclusive of the consumer's own slot) and read the stall off the required distance: 4
 * with forwarding off, 3 for a load producer with it on, 2 for any other producer with it on. A
 * distance already at or beyond the requirement costs nothing, which is why the gap a taken branch
 * leaves behind so often absorbs a hazard that would otherwise stall.
 */
const TIMING: Readonly<Record<string, Timing>> = {
  /**
   * `addi x1,x0,5 ; addi x2,x0,37 ; add x5,x1,x2` — no ecall: it runs off the end of `.text` with
   * six instructions' worth of pipe still to drain.
   *
   * **The corpus's smallest statement of the thesis.** The `add` is a distance-1 dependent on the
   * second `addi` (and distance-2 on the first).
   * - OFF: required 4, distance 1 ⇒ **3** stalls. `cycles = 3 + 6 + 3 = 12`.
   * - ON: required 2, distance 1 ⇒ **1** stall — forwarding does NOT make it free. The 5-stage runs
   *   this program at `S = 0` with forwarding on; here the bubble is back, and it is `'ex-latency'`.
   *   `cycles = 3 + 6 + 1 = 10`.
   */
  'add.s': {
    retires: 3,
    // No control transfers at all: P = 0 under every scheme, which makes this program the control
    // for the whole prediction axis — a toggle must not move a program with nothing to predict.
    transfers: { takenPredictable: 0, notTaken: 0, takenUnpredictable: 0 },
    stalls: { off: { 8: 3 }, on: { 8: 1 } },
    haltFlushes: 0,
  },

  /**
   * 4 prologue + 5 per iteration × 5 + 5 epilogue = 34 retires. `bnez` is taken 4 times (the 5th
   * finds t1 == 0 and falls through). The corpus's richest timing program: the textbook load-use
   * pair AND two `la`s.
   *
   *    0 lui t0        4 addi t0,t0     8 addi t1,x0,5    12 addi a0,x0,0
   *   16 lw t2,0(t0)  20 add a0,a0,t2  24 addi t0,t0,4    28 addi t1,t1,-1   32 bne t1,x0,loop
   *   36 lui t3       40 addi t3,t3,20 44 sw a0,0(t3)     48 addi a7,x0,10   52 ecall
   *
   * OFF (required 4): the `la` addi at 4 is distance 1 ⇒ 3. The FIRST `lw` at 16 reads t0 from that
   *   addi at distance 3 ⇒ 1 — once only, since every later iteration arrives across the branch's
   *   4-cycle gap. Per iteration: `add`@20 on the `lw` at distance 1 ⇒ 3, and `bne`@32 on
   *   `addi t1`@28 at distance 1 ⇒ 3; ×5 = 30. Epilogue: the second `la` addi at 40 ⇒ 3, and `sw`@44
   *   reads t3 from it at distance 1 ⇒ 3. S = 3+1+30+3+3 = **40**.
   * ON: `la` addi@4 (non-load, distance 1) ⇒ 1; `lw`@16 now needs only 2 and has 3 ⇒ free;
   *   `add`@20 on a LOAD at distance 1 ⇒ 2 ×5 = 10; `bne`@32 ⇒ 1 ×5 = 5; `addi t3`@40 ⇒ 1;
   *   `sw`@44 ⇒ 1. S = **18**.
   */
  'array-sum.s': {
    retires: 34,
    // `bnez t1, loop` is PC-relative and goes 4 times (t1 = 4…1), then declines on the 5th. No
    // `jalr`. P: not-taken 4·4 = 16; taken 2·4 + 4·1 = 12.
    transfers: { takenPredictable: 4, notTaken: 1, takenUnpredictable: 0 },
    stalls: {
      off: { 4: 3, 16: 1, 20: 15, 32: 15, 40: 3, 44: 3 },
      on: { 4: 1, 20: 10, 32: 5, 40: 1, 44: 1 },
    },
    haltFlushes: 0,
  },

  /**
   * The corpus's NESTED loop: an outer loop of 2 passes over an inner 12-element walk. 2 prologue +
   * 2 × (3 header + 12 × 5 inner + 2 footer) + 2 epilogue = 134 retires; 24 inner iterations.
   *
   *    0 addi a0,x0,0   4 addi t3,x0,2   8 lui t0        12 addi t0,t0    16 addi t1,x0,12
   *   20 lw t2,0(t0)   24 add a0,a0,t2  28 addi t0,t0,4  32 addi t1,t1,-1  36 bne t1,x0,inner
   *   40 addi t3,t3,-1 44 bne t3,x0,outer  48 addi a7,x0,10  52 ecall
   *
   * OFF: `la` addi@12 distance 1 ⇒ 3, ×2 passes = 6. The FIRST `lw`@20 of each pass reads t0 from it
   *   at distance 2 (only `li t1` between) ⇒ 2, ×2 = 4 — the distance-2 hazard `array-sum` does not
   *   have, and one the 5-stage does not charge at all. Per inner iteration `add`@24 ⇒ 3 and
   *   `bne`@36 ⇒ 3, ×24 = 144. Outer `bne`@44 on `addi t3`@40 at distance 1 ⇒ 3, ×2 = 6.
   *   S = 6+4+144+6 = **160**.
   * ON: `la` addi@12 ⇒ 1 ×2 = 2; `lw`@20 at distance 2 now meets its requirement ⇒ free; `add`@24 on
   *   a LOAD ⇒ 2 ×24 = 48; `bne`@36 ⇒ 1 ×24 = 24; outer `bne`@44 ⇒ 1 ×2 = 2. S = **76**.
   */
  'array-sum-twice.s': {
    retires: 134,
    // The inner `bne t1` goes 11 times per pass then declines — 22 taken, 2 declined; the outer
    // `bne t3` goes once and declines once. P: not-taken 4·23 = 92; taken 2·23 + 4·3 = 58.
    transfers: { takenPredictable: 23, notTaken: 3, takenUnpredictable: 0 },
    stalls: { off: { 12: 6, 20: 4, 24: 72, 36: 72, 44: 6 }, on: { 12: 2, 24: 48, 36: 24, 44: 2 } },
    haltFlushes: 0,
  },

  /**
   * 9 retires. One branch of EACH outcome on the same operands: `blt`@12 is taken (signed -1 < 1)
   * and `bltu`@24 is not (unsigned 4294967295 is not < 1).
   *    0 addi t0,x0,-1   4 addi t1,x0,1   8 addi a0,t0,0   12 blt t0,t1,20
   *   16 addi a0,t1,0  ← FLUSHED by the taken `blt`; N counts 9, not 10
   *   20 addi a1,t0,0  24 bltu t0,t1,32  28 addi a1,t1,0  32 addi a7,x0,10  36 ecall
   *
   * OFF: `mv a0,t0`@8 reads t0 from @0 at distance 2 ⇒ 2. The `blt`@12 then reads t0 (distance 3 + 2
   *   stalls = 5) and t1 (distance 2 + 2 = 4) ⇒ both met, free. Everything later is far. S = **2**.
   * ON: distance 2 already meets the requirement of 2 ⇒ **0**, and this is the corpus's one place
   *   where a distance-2 pair shows the requirement is 2 and not 3.
   */
  'branch-flavors.s': {
    retires: 9,
    // `blt` goes (a bet ID wins); `bltu` is the same comparison read unsigned and NEVER goes (a
    // taken-bet is wrong). P: not-taken 4·1 = 4; taken 2·1 + 4·1 = 6 — so this program, like
    // `call-return.s`, is SLOWER under static-taken.
    transfers: { takenPredictable: 1, notTaken: 1, takenUnpredictable: 0 },
    stalls: { off: { 8: 2 }, on: {} },
    haltFlushes: 0,
  },

  /**
   * 6 retires, no branches at all.
   *    0 lui t0    4 addi t0,t0    8 lb t1,0(t0)    12 lbu t2,0(t0)    16 addi a7,x0,10   20 ecall
   *
   * OFF: `la` addi@4 distance 1 ⇒ 3; `lb`@8 reads t0 from it at distance 1 ⇒ 3; `lbu`@12 reads the
   *   same t0 at distance 2 + the 3 stalls in between = 5 ⇒ free. S = **6**.
   * ON: @4 ⇒ 1 and @8 ⇒ 1 — both distance-1 on a NON-load producer, so both are `'ex-latency'`.
   *   S = **2**. The program has two loads and NO load-use hazard: `lbu` reads t0, the pointer, not
   *   the t1 that `lb` loaded. The rule keys off source registers, not off "a load is nearby".
   */
  'byte-loads.s': {
    retires: 6,
    transfers: { takenPredictable: 0, notTaken: 0, takenUnpredictable: 0 },
    stalls: { off: { 4: 3, 8: 3 }, on: { 4: 1, 8: 1 } },
    haltFlushes: 0,
  },

  /**
   * 9 dynamic instructions: `jal` and `ret` are taken; `bge a0,a1,done` is NOT (17 >= 42 is false).
   *    0 addi a0,x0,17   4 addi a1,x0,42   8 jal ra,max   12 addi s0,a0,0   16 addi a7,x0,10
   *   20 ecall          24 bge a0,a1,done  28 addi a0,a1,0  32 jalr x0,x1,0
   *
   * **S = 0 on the retired path in BOTH positions, so forwarding buys nothing here** — every RAW is
   * already separated by a flush gap, and on this machine those gaps are twice as wide as the
   * 5-stage's. `bge`@24 reads the two `addi`s from before the `jal` across a 4-cycle correction;
   * `mv s0,a0`@12 reads a0 across the `ret`'s. Both jumps hand their consumer more than the
   * interlock would have charged.
   *
   * It is also the only corpus program with live code behind its `ecall` (the real `max:` function),
   * hence the one halt flush in the corpus — and the only one whose `ret` sits at the last word of
   * text, hence a taken transfer that flushes nobody while still costing its 4.
   *
   * And it is the program that carries {@link SHADOW}: the `jal`'s fall-through at pc 12 gets a
   * whole live cycle in ID before the correction reaches it, and stalls there for nothing.
   */
  'call-return.s': {
    retires: 9,
    // Three transfers, one of each kind: `jal max` always goes (a bet ID wins); `bge a0,a1,done` is
    // 17 >= 42 and NEVER goes (a taken-bet is wrong); `ret` is a `jalr`, which no scheme can bet on.
    // P: not-taken 4·2 = 8; taken 2·1 + 4·1 + 4·1 = 10 — the bet costs TWO cycles here.
    transfers: { takenPredictable: 1, notTaken: 1, takenUnpredictable: 1 },
    stalls: { off: {}, on: {} },
    // pc 12 is `addi s0,a0,0`, the jal's fall-through: it reads a0 from `addi a0,x0,17`@0 at
    // distance 3, which needs 4 with forwarding off and 2 with it on. So it stalls once — and is
    // squashed the next cycle, having cost the machine nothing.
    shadowStalls: { off: { 12: 1 }, on: {} },
    haltFlushes: 1,
  },

  /**
   * 5 retires, two never-taken branches back to back.
   *    0 bne x0,x0,done   4 bne x0,x0,done   8 addi a0,x0,42   12 addi a7,x0,10   16 ecall
   * Every source is x0, so there is no RAW anywhere and forwarding buys nothing: S = 0 in both
   * positions. The corpus's sharpest "a bet on a branch that never goes is pure loss": under
   * `static-taken` both branches bet and both mispredict, `P = 4·2 = 8` against 0 — an 11-cycle
   * program becoming a 19-cycle one.
   */
  'paired-branches.s': {
    retires: 5,
    transfers: { takenPredictable: 0, notTaken: 2, takenUnpredictable: 0 },
    stalls: { off: {}, on: {} },
    haltFlushes: 0,
  },

  /**
   * 4 prologue + 4 per iteration × 6 + 2 epilogue = 30 retires; `bnez` taken 5 times (i = 5…1).
   *    0 addi t1,x0,6   4 addi a0,x0,0   8 addi t5,x0,3  12 addi t6,x0,2
   *   16 sll t3,t5,t6  20 add a0,a0,t3  24 addi t1,t1,-1 28 bne t1,x0,loop
   *   32 addi a7,x0,10 36 ecall
   *
   * OFF: `sll`@16 reads t6 from @12 at distance 1 ⇒ 3, first iteration only (t5/t6 are
   *   loop-invariant and long retired afterwards). `add`@20 on the `sll` at distance 1 ⇒ 3 ×6 = 18;
   *   `bne`@28 on `addi t1`@24 at distance 1 ⇒ 3 ×6 = 18. S = **39**.
   * ON: the same three sites at 1 apiece ⇒ 1 + 6 + 6 = **13**. Note the `sll` is an ordinary ALU op
   *   here — M9's `slowOpLatency` is an out-of-order knob and this machine's execute is UNIFORM.
   */
  'slow-op-loop.s': {
    retires: 30,
    transfers: { takenPredictable: 5, notTaken: 1, takenUnpredictable: 0 },
    stalls: { off: { 16: 3, 20: 18, 28: 18 }, on: { 16: 1, 20: 6, 28: 6 } },
    haltFlushes: 0,
  },

  /**
   * 7 retires, no branches — a store immediately followed by a dependent load of the SAME address.
   *    0 lui t0     4 addi t0,t0    8 addi t1,x0,99   12 sw t1,0(t0)
   *   16 lw a0,0(t0) 20 addi a7,x0,10  24 ecall
   *
   * OFF: `la` addi@4 ⇒ 3. `sw`@12 reads t1 from @8 at distance 1 ⇒ 3, and t0 from @4 at distance 2
   *   ⇒ 2; the larger wins ⇒ 3. `lw`@16 reads t0 at distance 3 + those 3 stalls = 6 ⇒ free.
   *   S = **6**.
   * ON: @4 ⇒ 1; `sw`@12 ⇒ 1 (t1 at distance 1; t0 at distance 2 is already met). S = **2**. Every
   *   RAW here is on a NON-load producer, so the load-use rule never fires — the `lw`'s own datum is
   *   read by nobody.
   */
  'store-forward.s': {
    retires: 7,
    transfers: { takenPredictable: 0, notTaken: 0, takenUnpredictable: 0 },
    stalls: { off: { 4: 3, 12: 3 }, on: { 4: 1, 12: 1 } },
    haltFlushes: 0,
  },

  /**
   * `array-sum`'s TWIN: byte-for-byte the same instruction stream and hazards — the only source
   * difference is the pointer bump (`addi t0,t0,16` vs `,4`) and distinct `.data` values, neither of
   * which touches timing. So every field is copied from `array-sum` verbatim; the difference that
   * makes the program exist is a CACHE fact, and this machine has no cache (M11 step 6).
   */
  'strided-sum.s': {
    retires: 34,
    transfers: { takenPredictable: 4, notTaken: 1, takenUnpredictable: 0 },
    stalls: {
      off: { 4: 3, 16: 1, 20: 15, 32: 15, 40: 3, 44: 3 },
      on: { 4: 1, 20: 10, 32: 5, 40: 1, 44: 1 },
    },
    haltFlushes: 0,
  },

  /**
   * 2 prologue + 3 per iteration × 10 + 2 epilogue = 34 retires; `bnez` taken 9 times.
   *    0 addi a0,x0,0   4 addi t0,x0,10
   *    8 add a0,a0,t0  12 addi t0,t0,-1  16 bne t0,x0,loop
   *   20 addi a7,x0,10 24 ecall
   *
   * OFF: iteration 1's `add`@8 reads t0 from `li t0`@4 at distance 1 ⇒ 3, but no LATER iteration's
   *   does: it then reads t0 from `addi t0`@12 across the branch's stall AND its 4-cycle penalty.
   *   That asymmetry is why a per-iteration cost must be traced rather than assumed uniform. The
   *   `bne`@16 reads `addi t0`@12 at distance 1 ⇒ 3, EVERY iteration ×10 = 30. S = **33**.
   * ON: the same two sites at 1 apiece ⇒ 1 + 10 = **11**. The hottest loop in the corpus, and with
   *   forwarding ON it still stalls once per iteration — where the 5-stage runs it at S = 0.
   */
  'sum-loop.s': {
    retires: 34,
    transfers: { takenPredictable: 9, notTaken: 1, takenUnpredictable: 0 },
    stalls: { off: { 8: 3, 16: 30 }, on: { 8: 1, 16: 10 } },
    haltFlushes: 0,
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

/** Drive a program to halt under `config`, collecting every cycle. */
function drive(source: string, config: ProcessorConfig, label: string): CycleTrace[] {
  const p = new DeepPipelineProcessor();
  p.reset(toProgramImage(asm(source)), config);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    // The largest entry in the table is under 400 cycles; this only fires on a runaway bug.
    if (traces.length >= 800) throw new Error(`${label}: exceeded 800 cycles — runaway loop?`);
    traces.push(p.step());
  }
  return traces;
}

/** Drive one CORPUS program to halt under `config`. */
const run = (file: string, config: ProcessorConfig): CycleTrace[] =>
  drive(readFileSync(PROGRAMS_DIR + file, 'utf8'), config, file);

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

/**
 * The run's stall histogram in the table's shape. `retiredOnly` selects the `S` of the closed
 * form — stalls charged to instructions that survive to retire. The other half is
 * {@link SHADOW}: a squashed instruction can stall, and that stall costs the machine nothing.
 */
function stallSites(ts: CycleTrace[], retiredOnly: boolean): Record<number, number> {
  const pcs = pcById(ts);
  const retired = new Set(eventsOf(ts, 'instr-retire').map((e) => e.instr));
  const sites: Record<number, number> = {};
  for (const stall of eventsOf(ts, 'stall')) {
    const pc = pcs.get(stall.instr);
    if (pc === undefined) throw new Error('stall names an instruction that was never fetched');
    if (retiredOnly && !retired.has(stall.instr)) continue;
    sites[pc] = (sites[pc] ?? 0) + 1;
  }
  return sites;
}

const total = (sites: StallSites): number => Object.values(sites).reduce((sum, n) => sum + n, 0);

/** The raw histogram the table predicts: the cycle-costing stalls, plus any shadow stalls. */
function expectedRawSites(pinned: Timing, position: Position, scheme: Scheme): StallSites {
  // A scheme that BETS kills the fall-through in IF2, two stages before it could reach the interlock
  // — so the shadow stall exists only where nothing was bet.
  const shadow = scheme === 'static-taken' ? {} : (pinned.shadowStalls?.[position] ?? {});
  const merged: Record<number, number> = { ...pinned.stalls[position] };
  for (const [pc, n] of Object.entries(shadow)) merged[Number(pc)] = (merged[Number(pc)] ?? 0) + n;
  return merged;
}

/**
 * `P` as the ENGINE actually paid it: each resolved transfer priced by what it predicted and what
 * happened. Independent of {@link penaltyOf}, which prices the same transfers from the hand-derived
 * table — two routes to one number, so a disagreement localizes to the transfer whose prediction
 * outcome differs from what the table claims.
 */
const penaltyFromEvents = (ts: CycleTrace[]): number =>
  eventsOf(ts, 'branch-resolved').reduce(
    (sum, e) => sum + (e.predicted !== e.actual ? 4 : e.predicted ? 2 : 0),
    0,
  );

const takenTransfers = (ts: CycleTrace[]): number =>
  eventsOf(ts, 'branch-resolved').filter((e) => e.actual).length;

/** Every (program, position, scheme) cell the table pins — 11 × 2 × 2. */
const MATRIX = Object.keys(TIMING).flatMap((file) =>
  (['off', 'on'] as const).flatMap((position) =>
    SCHEMES.map((scheme) => ({ file, position, scheme })),
  ),
);

describe('the pinned cycle-count table — cycles = N + 6 + S + P', () => {
  it('covers every program in the corpus', () => {
    // The corpus is enumerated from disk by the conformance harness, so a program added later is
    // differentially tested automatically — but it would NOT get a timing entry automatically, and a
    // table that silently stopped covering the corpus is exactly the decay this suite exists to
    // prevent. Fail loudly and make the author derive the new entry by hand.
    const corpus = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.s'));
    expect(corpus.length).toBeGreaterThan(0); // ...and guard the guard against an empty read
    expect([...corpus].sort()).toEqual(Object.keys(TIMING).sort());
  });

  it.each(MATRIX)('$file [forwarding $position, predict $scheme]', ({ file, position, scheme }) => {
    const pinned = TIMING[file]!;
    const ts = run(file, withScheme(CONFIG[position], scheme));
    const sites = pinned.stalls[position];

    // N and the transfer structure are the PROGRAM: no config can change which instructions run or
    // which branches are taken. Asserting it in every cell is what makes S and P attributable — a
    // toggle that "sped things up" by skipping an instruction is caught here, not in the total.
    expect(eventsOf(ts, 'instr-retire'), 'N — the program, not the config').toHaveLength(
      pinned.retires,
    );
    expect(takenTransfers(ts), 'T — the program, not the config').toBe(T(pinned.transfers));

    // S, and every stall's PLACE at once. This is the RETIRED-path histogram — the stalls that cost
    // cycles. One histogram per forwarding position covers all schemes, but **that is a fact about
    // THIS CORPUS, not a structural invariant**, and deliberately not labelled with the 5-stage's
    // "untouched by prediction" wording: the describe below spends itself disproving exactly that
    // sentence for the raw histogram, and the retired path is only better off by luck.
    //
    // The counterexample shape to watch for, since it is one corpus program away: a DECLINING branch
    // costs 0 under not-taken and 4 under static-taken, so a consumer just after such a branch that
    // reads a producer just before it sits at distance 2 in one scheme and distance 6 in the other —
    // 2 stall cycles with forwarding off, or none. Every declining branch in this corpus is followed
    // by an instruction reading `x0` or a long-retired producer, so nothing trips it today. When
    // something does, THIS cell reddens, and the fix is a per-scheme column in the table — not a
    // hunt for an engine bug.
    expect(stallSites(ts, true), 'S — the stalls that cost cycles').toEqual(sites);
    expect(stallSites(ts, false), 'every stall the engine emitted, shadows included').toEqual(
      expectedRawSites(pinned, position, scheme),
    );

    // P, by two independent routes. The pinned route derives it from the transfer breakdown; the
    // measured route applies the per-transfer rule to the engine's OWN prediction outcomes. If the
    // engine mispredicted something the table says it should have called right, these disagree —
    // which no cycle count could tell you, since the two errors would cancel in the total.
    const P = penaltyOf(pinned.transfers, scheme);
    expect(penaltyFromEvents(ts), 'P — each transfer priced by what the engine predicted').toBe(P);

    // ...and only then the closed form.
    expect(ts).toHaveLength(pinned.retires + 6 + total(sites) + P);
  });

  it("'none' and 'static-not-taken' are the SAME MACHINE, cycle for cycle", () => {
    // The identity `DEEP_PIPELINE_CAPABILITIES` claims, pinned on whole traces rather than assumed —
    // and the reason the matrix above runs two schemes and not three. A processor with no predictor
    // does not stop and wait: it keeps fetching, and the fall-through IS the not-taken guess.
    for (const file of Object.keys(TIMING)) {
      for (const position of ['off', 'on'] as const) {
        const none = run(file, withScheme(CONFIG[position], 'none'));
        const nt = run(file, withScheme(CONFIG[position], 'static-not-taken'));
        expect(none.length, `${file} [${position}]`).toBe(nt.length);
        expect(none.map((t) => t.events)).toEqual(nt.map((t) => t.events));
      }
    }
  });
});

describe("the formula's constant terms, isolated", () => {
  it('+6: the fill and drain, on a program that is nothing but fill and drain', () => {
    // Three INDEPENDENT instructions and no `ecall`: the machine runs off the end of `.text` with
    // six cycles of pipe left to empty, so with N=3, S=0, P=0 the whole count IS the constant.
    //
    // Hand-built rather than borrowed from the corpus, and that is itself the milestone in one
    // observation: the 5-stage isolates its +4 on `add.s`, which no longer works here because THIS
    // machine stalls `add.s`'s back-to-back pair even with forwarding on. The corpus has no
    // dependency-free program left to measure the constant with — depth took it away.
    const source = ['.text', 'addi x1, x0, 1', 'addi x2, x0, 2', 'addi x3, x0, 3'].join('\n');
    for (const position of ['off', 'on'] as const) {
      const ts = drive(source, CONFIG[position], 'drain');
      expect(eventsOf(ts, 'stall'), `[forwarding ${position}]`).toEqual([]);
      expect(takenTransfers(ts)).toBe(0);
      expect(ts, 'N + 6, with nothing else in the sum').toHaveLength(3 + 6);
      // The drain is real: fetching stops six cycles before the machine does, where the 5-stage's
      // stops four. Two extra stages, two extra cycles of tail.
      expect(eventsOf(ts, 'instr-fetch')).toHaveLength(3);
      expect(eventsOf(ts, 'instr-retire')).toHaveLength(3);
      const fetchCycles = ts
        .filter((t) => t.events.some((e) => e.type === 'instr-fetch'))
        .map((t) => t.cycle);
      expect(
        ts.length - 1 - fetchCycles[fetchCycles.length - 1]!,
        'cycles of pure drain after the last fetch',
      ).toBe(6);
    }
  });

  it('+4 per mispredicted transfer, isolated from every stall', () => {
    // One taken branch, no RAW anywhere, so the penalty is the only thing separating the count from
    // N+6 — in BOTH forwarding positions, since with nothing to forward the toggle cannot move it.
    // Four instructions are fetched behind the branch and all four die.
    const source = [
      '.text',
      'addi x1, x0, 0',
      'beq x0, x0, target', // always taken, and reads only x0 — never a dependency
      'addi x2, x0, 111', // shadow
      'addi x3, x0, 222', // shadow
      'addi x4, x0, 333', // shadow
      'addi x5, x0, 444', // shadow
      'target:',
      'ecall',
    ].join('\n');
    for (const position of ['off', 'on'] as const) {
      const ts = drive(source, CONFIG[position], 'mispredict');
      expect(eventsOf(ts, 'stall')).toEqual([]);
      expect(eventsOf(ts, 'instr-retire')).toHaveLength(3);
      expect(takenTransfers(ts)).toBe(1);
      expect(ts, 'P = 4·T under the not-taken behaviour').toHaveLength(3 + 6 + 0 + 4 * 1);
      // ...and the four cycles really are four dead instructions, not a constant someone tuned.
      const flush = eventsOf(ts, 'flush').find((e) => e.reason === 'branch-taken')!;
      expect(flush.stages).toEqual(['EX1', 'ID', 'IF2', 'IF1']);
    }
  });

  it('charges the +4 even when the flush kills nobody — a penalty is not a casualty', () => {
    // `call-return.s`'s `ret` is the last word of `.text`, so nothing was fetched behind it: it emits
    // NO flush event (the pinned "a flush reports real casualties" rule) and still costs four cycles,
    // because the target cannot be fetched until the redirect lands at the clock edge. This is why
    // the formula's T counts taken TRANSFERS and not `flush` events — here there are 2 of the former
    // and 1 of the latter, and using flushes would under-count P by 4.
    const ts = run('call-return.s', withScheme(ON, 'static-not-taken'));
    expect(takenTransfers(ts)).toBe(2);
    expect(eventsOf(ts, 'flush').filter((e) => e.reason === 'branch-taken')).toHaveLength(1);
    expect(ts, 'the count only balances with T = 2').toHaveLength(9 + 6 + 0 + 4 * 2);
  });
});

/**
 * **THE THESIS: forwarding is no longer enough.**
 *
 * M3 taught that forwarding makes the bubble vanish. This is the other half, measured on the real
 * corpus: the same forwarding, one model over, and the bubble comes back. Asserted WITHOUT reference
 * to the closed form — even if every derived constant above were wrong, this is still the
 * milestone's claim.
 *
 * The comparison to the 5-stage is stated in PROSE and not in code on purpose: `eslint.config.js`
 * denies a model importing a sibling model (INV-3's DAG), so `PipelineProcessor` is not importable
 * here. The numbers quoted are `engine/pipeline/src/timing.test.ts`'s own pinned entries.
 */
describe('the flagship — the ALU→ALU bubble forwarding cannot remove', () => {
  it('add.s still stalls with forwarding ON, and the reason names why', () => {
    // The 5-stage's table pins `add.s` at `stalls: { off: { 8: 2 }, on: {} }` — forwarding buys the
    // back-to-back dependent completely. Here it cannot: the producer's result is not finished until
    // the end of EX2, and the consumer needs it at the start of its EX1.
    const ts = run('add.s', ON);
    const stalls = eventsOf(ts, 'stall');
    expect(stalls, 'one bubble, not zero').toHaveLength(1);
    expect(stalls[0]!.reason, "not 'raw' (that means forwarding is off) and not 'alu-use'").toBe(
      'ex-latency',
    );
    expect(stalls[0]!.stage).toBe('ID');
    // And the forward that eventually resolves it comes out of EX2/MEM — one stage further from the
    // consumer than the 5-stage's EX/MEM, which is the whole mechanism in one event.
    expect(eventsOf(ts, 'forward').map((e) => e.from)).toContain('EX2/MEM');
  });

  it('is the common case, not a fixture: 8 of the 11 corpus programs stall with forwarding ON', () => {
    // A single hand-built witness could be a special case. This is the claim at corpus scale — and
    // the three exceptions are named, because "all of them" would be the overclaim.
    const withExLatency = Object.keys(TIMING).filter((file) =>
      eventsOf(run(file, ON), 'stall').some((e) => e.reason === 'ex-latency'),
    );
    expect(withExLatency).toEqual([
      'add.s',
      'array-sum.s',
      'array-sum-twice.s',
      'byte-loads.s',
      'slow-op-loop.s',
      'store-forward.s',
      'strided-sum.s',
      'sum-loop.s',
    ]);
    // The three that do not: `branch-flavors.s`'s only RAW is at distance 2 (already met);
    // `call-return.s`'s are all across flush gaps; `paired-branches.s` reads nothing but x0.
    expect(
      Object.keys(TIMING).filter((f) => !withExLatency.includes(f)),
      'programs with no distance-1 ALU pair on the retired path',
    ).toEqual(['branch-flavors.s', 'call-return.s', 'paired-branches.s']);
  });

  it('reports the right reason in each position — three reasons, not the 5-stage’s two', () => {
    // The pinned reason encoding. With forwarding OFF the general interlock subsumes every case and
    // honestly reports 'raw'. With it ON the machine has TWO distinct un-forwardable hazards, where
    // the 5-stage has one: the load's datum (`load-use`, 2 bubbles) and — new here — the producer's
    // own second execute cycle (`ex-latency`, 1 bubble). A suite that expected a single reason set
    // under forwarding, as the 5-stage's does, would be asserting the 5-stage's machine.
    for (const file of Object.keys(TIMING)) {
      const pinned = TIMING[file]!;
      expect(
        new Set(eventsOf(run(file, OFF), 'stall').map((e) => e.reason)),
        `${file} [off]`,
      ).toEqual(
        // `call-return.s`'s only forwarding-OFF stall is a SHADOW one — squashed, never retired —
        // so the reason set is non-empty while the retired-path histogram is not.
        total(expectedRawSites(pinned, 'off', 'static-not-taken')) > 0
          ? new Set(['raw'])
          : new Set(),
      );
      const on = new Set(eventsOf(run(file, ON), 'stall').map((e) => e.reason));
      expect(
        [...on].every((r) => r === 'load-use' || r === 'ex-latency'),
        `${file} [on]`,
      ).toBe(true);
      expect(on.size > 0, `${file} [on] has stalls iff the table says so`).toBe(
        total(pinned.stalls.on) > 0,
      );
    }
  });
});

describe('N and T are the program; S is the microarchitecture', () => {
  // The thesis stated as an invariant rather than an anecdote. Forwarding is a claim about HOW
  // operands reach the ALU — it cannot change which instructions run or which branches are taken. If
  // either ever differs across configs, the toggle has broken something architectural and the timing
  // numbers are the least of it.
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
      // `cycles = N + 6 + S + P` with N and P config-invariant across the forwarding axis collapses to
      // this subtraction. It is the sharpest statement of what the toggle does: it buys back stall
      // cycles and nothing else — including on the programs where that number is 0.
      const pinned = TIMING[file]!;
      const off = run(file, OFF);
      const on = run(file, ON);
      expect(off.length - on.length).toBe(total(pinned.stalls.off) - total(pinned.stalls.on));
    },
  );
});

/**
 * **The finding this step did not expect: `S` is NOT prediction-invariant, and the plan's ported
 * assertion would have been wrong.**
 *
 * `engine/pipeline`'s timing suite asserts, in every cell of its P matrix, that the stall histogram
 * is *"the forwarding toggle, untouched by prediction"*. On the 5-stage that is structural: a
 * transfer resolves at the end of EX, so its fall-through reaches ID in the very cycle the squash
 * lands, and `stageId`'s squash early-return fires before the interlock can run.
 *
 * **Depth breaks it.** Here a transfer resolves at the end of EX2, one stage later, so the
 * fall-through gets a whole LIVE cycle in ID first — a cycle in which `ctx.squash` is still null,
 * the hazard unit really runs, and a real `stall` event is emitted for an instruction that is about
 * to be killed. Under `static-taken` the same instruction is killed in IF2 by ID's bet, two stages
 * before it could ever reach the interlock, and the stall simply does not exist.
 *
 * The cost of that stall is **zero cycles**, and that is not a coincidence: the redirect is timed off
 * the BRANCH's own EX2, so whether a doomed instruction behind it held ID for an extra cycle cannot
 * move anything. Which is why the closed form is stated over the retired path, and why both
 * histograms are pinned separately — the raw one is what catches an engine that stalls in the wrong
 * places, and the retired one is what balances the cycle count.
 */
const SHADOW = { file: 'call-return.s', pc: 12 } as const;

describe('S is not prediction-invariant — a squashed instruction can stall for free', () => {
  it('call-return.s [forwarding off] stalls a doomed instruction under not-taken, and not under taken', () => {
    const notTaken = run(SHADOW.file, withScheme(OFF, 'static-not-taken'));
    const taken = run(SHADOW.file, withScheme(OFF, 'static-taken'));

    // The raw histograms genuinely differ — the ported assertion would fail right here.
    expect(stallSites(notTaken, false)).toEqual({ [SHADOW.pc]: 1 });
    expect(stallSites(taken, false)).toEqual({});
    // ...while the retired-path histograms agree, in both schemes and both positions.
    expect(stallSites(notTaken, true)).toEqual({});
    expect(stallSites(taken, true)).toEqual({});
  });

  it('the stalling instruction never retires, and the stall costs nothing', () => {
    const ts = run(SHADOW.file, withScheme(OFF, 'static-not-taken'));
    const pcs = pcById(ts);
    const retired = new Set(eventsOf(ts, 'instr-retire').map((e) => e.instr));
    const stall = eventsOf(ts, 'stall')[0]!;

    expect(pcs.get(stall.instr), 'the jal’s fall-through').toBe(SHADOW.pc);
    expect(retired.has(stall.instr), 'it is squashed by the jal’s correction').toBe(false);
    // The closed form over the RAW histogram would over-predict by exactly this one stall...
    expect(9 + 6 + 1 + 8, 'N + 6 + S_raw + P — one cycle too many').toBe(ts.length + 1);
    // ...and over the retired path it is exact.
    expect(9 + 6 + 0 + 8, 'N + 6 + S_retired + P').toBe(ts.length);
  });

  it('leaves EX1 a bubble, so the correction flushes THREE stages and not four', () => {
    // The visible consequence, and a flush shape neither the plan nor step 1 named: because the
    // doomed instruction held ID for an extra cycle, nothing advanced into EX1 behind it. The
    // correction then names ID, IF2 and IF1 — a NON-CONTIGUOUS payload in the other direction from
    // step 1's `['EX1','IF1']`.
    const off = eventsOf(run(SHADOW.file, withScheme(OFF, 'static-not-taken')), 'flush');
    expect(off.find((e) => e.reason === 'branch-taken')!.stages).toEqual(['ID', 'IF2', 'IF1']);
    // With forwarding ON the same instruction does not stall (distance 3 meets a requirement of 2),
    // so EX1 is occupied and the very same branch flushes all four. **The flush shape depends on the
    // FORWARDING toggle**, which is the sharpest possible statement of "never assume a shape".
    const on = eventsOf(run(SHADOW.file, withScheme(ON, 'static-not-taken')), 'flush');
    expect(on.find((e) => e.reason === 'branch-taken')!.stages).toEqual([
      'EX1',
      'ID',
      'IF2',
      'IF1',
    ]);
  });

  it('is the ONLY cell in the corpus where the two histograms disagree', () => {
    // Bounding the finding. If a second one appears, it is either a new corpus program or an engine
    // change, and either way it deserves its own derivation rather than a quietly widened table.
    const disagreeing = MATRIX.filter(({ file, position, scheme }) => {
      const ts = run(file, withScheme(CONFIG[position], scheme));
      return JSON.stringify(stallSites(ts, false)) !== JSON.stringify(stallSites(ts, true));
    });
    expect(disagreeing).toEqual([
      { file: 'call-return.s', position: 'off', scheme: 'static-not-taken' },
    ]);
  });
});

/**
 * **Flush shapes: read the penalty as a TOTAL, never as a shape.**
 *
 * The plan seeded two expected shapes (one width-4 event under prediction OFF, two width-2 events
 * under prediction ON); step 1 confirmed both and found a third (`['EX1','IF1']`, a `jalr`
 * correcting over a younger bet). The corpus adds two more. The lesson is not "there are five" — it
 * is that `flush.stages` is a report of who was actually THERE, and both toggles move that.
 */
describe('flush shapes across the corpus', () => {
  const shapesOf = (ts: CycleTrace[]): string[] =>
    eventsOf(ts, 'flush').map((e) => e.stages.join('+'));

  it('the corpus produces FIVE distinct payloads, and none of them is the penalty', () => {
    const shapes = new Set(
      MATRIX.flatMap(({ file, position, scheme }) =>
        shapesOf(run(file, withScheme(CONFIG[position], scheme))),
      ),
    );
    expect([...shapes].sort()).toEqual([
      // A correction that found the front end already drained by the branch's OWN stall — the
      // loop-at-the-end-of-text shape (`sum-loop.s`, `slow-op-loop.s`).
      'EX1+ID',
      // The textbook unpredicted taken branch: all four squashable stages occupied.
      'EX1+ID+IF2+IF1',
      // {@link SHADOW}: a stalled shadow left EX1 empty.
      'ID+IF2+IF1',
      // A correction with the fetch pointer already past the end of text (`call-return.s`'s `bge`
      // betting on a target that IS the last word).
      'IF2',
      // A bet, and a correction over a bet: the two-deep front end, and nothing older.
      'IF2+IF1',
    ]);
  });

  it('every stage a flush names really has an occupant that cycle', () => {
    // The over-report guard, corpus-wide. `buildPipelineMap` resolves a victim with a singular
    // `trace.instructions.find((i) => i.location === stage)`, so a flush naming a drained stage
    // returns `undefined` and the victim is silently unrecorded — which would not be a map bug but
    // an ENGINE bug, and exactly where "the map needs no change" could be quietly falsified. Step 1
    // pins this on hand-built programs and M11 step 4 owns the map-side half; this is the corpus.
    for (const { file, position, scheme } of MATRIX) {
      const ts = run(file, withScheme(CONFIG[position], scheme));
      for (const cycle of ts) {
        for (const flush of cycle.events.filter((e) => e.type === 'flush')) {
          expect(
            flush.stages.length,
            `${file}: an empty flush should not be emitted`,
          ).toBeGreaterThan(0);
          for (const stage of flush.stages) {
            expect(
              cycle.instructions.some((i) => i.location === stage),
              `${file} [${position}, ${scheme}] cycle ${cycle.cycle}: flush names an empty ${stage}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('casualties are NOT the penalty here — the 5-stage identity does not port', () => {
    // M3/M4 could pin `casualties === P` for `sum-loop.s` (18 rows, then 11). On this machine that
    // identity is FALSE, and the reason is worth more than the identity was: the deep pipe pays its
    // full 4-cycle penalty even when the front end has already emptied itself. `sum-loop`'s branch
    // stalls in ID every iteration, and its loop sits at the end of `.text`, so by the time the
    // branch resolves IF2 and IF1 hold nothing — 2 casualties, 4 cycles.
    const casualties = (file: string, scheme: Scheme): number =>
      eventsOf(run(file, withScheme(ON, scheme)), 'flush')
        .filter((e) => e.reason !== 'halt')
        .reduce((sum, e) => sum + e.stages.length, 0);

    expect(casualties('sum-loop.s', 'static-not-taken'), '9 taken × 2 survivors killed').toBe(18);
    expect(penaltyOf(TIMING['sum-loop.s']!.transfers, 'static-not-taken'), 'but P is').toBe(36);
    expect(casualties('slow-op-loop.s', 'static-not-taken')).toBe(10);
    expect(penaltyOf(TIMING['slow-op-loop.s']!.transfers, 'static-not-taken')).toBe(20);

    // It is not that the two are always unequal — that would be just as wrong a rule. Where the
    // front end IS full at the resolve point, they coincide exactly.
    expect(casualties('array-sum.s', 'static-not-taken'), '4 taken × 4 casualties').toBe(16);
    expect(penaltyOf(TIMING['array-sum.s']!.transfers, 'static-not-taken')).toBe(16);
    expect(casualties('paired-branches.s', 'static-taken'), '2 bets + 2 corrections × 2').toBe(8);
    expect(penaltyOf(TIMING['paired-branches.s']!.transfers, 'static-taken')).toBe(8);
  });

  it('emits exactly one halt flush, on the one program with live code behind its ecall', () => {
    for (const { file, position, scheme } of MATRIX) {
      const ts = run(file, withScheme(CONFIG[position], scheme));
      expect(
        eventsOf(ts, 'flush').filter((e) => e.reason === 'halt'),
        `${file} [${position}, ${scheme}]`,
      ).toHaveLength(TIMING[file]!.haltFlushes);
    }
  });
});

describe('the crown jewel — the same program, the same answer, fewer cycles', () => {
  // The spec's flagship §12 interaction on the real corpus, asserted WITHOUT reference to the closed
  // form. It is also precisely the claim INV-8 structurally cannot make, since it compares only the
  // left-hand side of "same answer".
  const RAW_CHAINED = ['add.s', 'array-sum.s', 'byte-loads.s', 'store-forward.s', 'sum-loop.s'];

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
      // The UNION of both runs' touched addresses, not just one side's: a word that only ONE position
      // wrote is precisely the asymmetry worth catching.
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

  it('does NOT claim forwarding is free money — two corpus programs are identical in both', () => {
    // The honest counterexamples, and the reason the list above is a list rather than the corpus.
    // A suite that asserted "on is faster" everywhere would have to be weakened to `<=`, which would
    // then pass for a pipeline where forwarding did nothing at all.
    expect(run('call-return.s', ON), 'every RAW already sits behind a flush gap').toHaveLength(
      run('call-return.s', OFF).length,
    );
    expect(run('paired-branches.s', ON), 'every source is x0').toHaveLength(
      run('paired-branches.s', OFF).length,
    );
  });

  it('but it buys back LESS than on the 5-stage, because one bubble survives forwarding', () => {
    // The subtler half of the thesis, and the number that distinguishes this machine from a 5-stage
    // wearing seven labels. `engine/pipeline` pins `sum-loop.s` at S_off = 22 and S_on = 0 — the
    // toggle buys back 22 cycles, all of them. Here it is 33 → 11: the toggle buys back the same 22,
    // and eleven stall cycles simply cannot be bought.
    const pinned = TIMING['sum-loop.s']!;
    expect(total(pinned.stalls.off) - total(pinned.stalls.on), 'the same 22 the 5-stage buys').toBe(
      22,
    );
    expect(total(pinned.stalls.on), 'the residue forwarding cannot reach').toBe(11);
    expect(run('sum-loop.s', ON).length - run('sum-loop.s', OFF).length).toBe(-22);
  });
});

describe('P — the speculation penalty, at twice the 5-stage’s coefficients', () => {
  /**
   * **No scheme dominates.** A predictor is a BET, and the corpus contains programs that punish each
   * way of betting. Asserted as a signed delta per program rather than as "prediction is faster on
   * average", because the average is exactly the claim that would let the losses hide.
   *
   * Every delta here is exactly **twice** the 5-stage's, which is the corpus-scale form of "the
   * penalty doubles": the 5-stage pins `sum-loop +7`, `array-sum +2`, `call-return −1`.
   */
  it.each(['off', 'on'] as const)(
    'no scheme dominates [forwarding %s] — sum-loop wins, three programs LOSE',
    (position) => {
      const cyclesOf = (file: string, scheme: Scheme): number =>
        run(file, withScheme(CONFIG[position], scheme)).length;
      const delta = (file: string): number =>
        cyclesOf(file, 'static-not-taken') - cyclesOf(file, 'static-taken');

      // Positive = static-taken is faster. Each equals its `P_nt − P_t` exactly, because N and S are
      // invariant across the prediction axis — the subtraction IS the toggle's whole effect.
      expect(delta('sum-loop.s'), 'P 36 → 22: nine correct bets, 2 apiece').toBe(14);
      expect(delta('array-sum.s'), 'P 16 → 12: four correct bets').toBe(4);
      expect(delta('array-sum-twice.s'), 'P 92 → 58: twenty-three correct bets').toBe(34);
      // The bets that lose. `paired-branches.s` is the extreme: two branches that never go, both bet
      // wrong, and a 4-cycle correction apiece on an 11-cycle program.
      expect(delta('call-return.s'), 'P 8 → 10: the jalr cannot be bet on').toBe(-2);
      expect(
        delta('branch-flavors.s'),
        'P 4 → 6: two branches, one letter apart, opposite bets',
      ).toBe(-2);
      expect(delta('paired-branches.s'), 'P 0 → 8: pure loss').toBe(-8);
      // Programs with nothing to predict must not move at all — the controls.
      expect(delta('add.s'), 'no transfers ⇒ no penalty ⇒ no effect').toBe(0);
      expect(delta('byte-loads.s'), 'straight-line').toBe(0);
      expect(delta('store-forward.s'), 'straight-line').toBe(0);
    },
  );

  it('a correctly predicted taken branch still costs 2 — depth taxes you when you are RIGHT', () => {
    // The coefficient that makes this machine's prediction story different in kind, not just in
    // degree. On the 5-stage a won bet costs 1; here the front end is two deep and an ID bet kills
    // both of its slots. `sum-loop.s` under static-taken wins every one of its nine bets and still
    // pays 18 of its 22 penalty cycles for them.
    const ts = run('sum-loop.s', withScheme(ON, 'static-taken'));
    const resolved = eventsOf(ts, 'branch-resolved');
    const correctTaken = resolved.filter((e) => e.predicted && e.actual);
    expect(correctTaken, 'nine bets, all won').toHaveLength(9);
    expect(correctTaken.length * 2, 'and they still cost 2 apiece').toBe(18);
    // Each one flushes exactly the two fall-throughs the two-deep front end had already fetched.
    const bets = eventsOf(ts, 'flush').filter((e) => e.reason === 'branch-predicted-taken');
    expect(bets).toHaveLength(10); // nine won + the tenth, whose branch declines
    for (const bet of bets) expect(bet.stages).toEqual(['IF2', 'IF1']);
    expect(penaltyFromEvents(ts)).toBe(22);
  });
});
