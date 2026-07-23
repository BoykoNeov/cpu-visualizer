import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import {
  defaultConfig,
  type CacheConfig,
  type CycleTrace,
  type ProcessorConfig,
  type TraceEvent,
} from '@cpu-viz/trace';
import { PipelineProcessor } from './index';
import { CACHE_LARGE, CACHE_SMALL } from '@cpu-viz/engine-common';

/**
 * The pinned timing table — the net for INV-8's blind spot (M3 step 3).
 *
 * `differential.test.ts` proves this model computes the right ANSWERS, on the whole corpus, in
 * both forwarding positions. It cannot prove it computes them at the right SPEED: it compares
 * only final architectural state, so a pipeline that ignored `forwarding: true` and interlocked
 * on every RAW would produce byte-identical results and pass silently. That is not a hypothetical
 * — it was measured during step 1: mutating the hazard unit that way left conformance 12/12 green
 * and failed 10 unit tests. The forwarding toggle's ENTIRE observable effect lives in that blind
 * spot, so the toggle needs a net of its own. This is it.
 *
 * `processor.test.ts` pins the model's soul on minimal hand-built programs (each forwarding path's
 * from/to/value, the priority rule, the load-use bubble, the flush, halt-with-drain). It is
 * deliberately not repeated here. What is new at this scale is TIMING ON THE REAL CORPUS: how many
 * cycles each program takes in each position, and exactly where every stall lands.
 *
 * ## How the numbers were derived (and why they are pins, not snapshots)
 *
 * A cycle count copied from a passing run is not a pin — it is a snapshot of whatever the engine
 * did, bug and all, and it will happily re-bless a regression as the new truth. So every entry
 * below is derived from the PINNED RULES, in `docs/plans/m3-tasks.md`, without reference to the
 * engine's output.
 *
 * Let `d_i` be the cycle instruction `i` leaves ID. It is then in EX at `d_i+1`, MEM at `d_i+2`,
 * WB at `d_i+3`; the machine halts at the last retire, so `cycles = d_last + 4`. The pinned rules
 * give the recurrence directly:
 *
 * - baseline (the pipe advances): `d_i >= d_(i-1) + 1`
 * - forwarding OFF (interlock in ID until the producer's WB): `d_i >= d_p + 3` for each producer
 *   `p` of a source register. It is +3 rather than +4 because of the same-cycle WB→ID rule — the
 *   consumer may leave ID in the very cycle the producer writes back.
 * - forwarding ON: only a LOAD producer stalls its consumer (`d_i >= d_L + 2`) — the load-use
 *   bubble. Every other RAW is covered by a forward.
 * - a MISPREDICTED transfer `b`: the redirect is clocked at the end of b's EX (`d_b+1`), so the
 *   target is fetched at `d_b+2` and leaves ID at `d_b+3` — a +2 penalty over the `d_b+1` baseline.
 * - a CORRECTLY PREDICTED taken transfer (M4): ID steers fetch at `d_b`, a cycle earlier than EX
 *   could, so only the one already-fetched fall-through is lost — **+1**, not +2.
 *
 * Summing the recurrence over a whole run collapses to one closed form:
 *
 * > **cycles = N + 4 + S + P**
 * >
 * > N = instructions that RETIRE, S = total stall cycles, P = the speculation penalty.
 *
 * That is what makes this a table of derivations rather than a table of magic numbers, and it is
 * why each term is asserted SEPARATELY below: a single opaque total lets a compensating pair of
 * errors (over-count S, under-count P) pass, and tells you nothing about where it broke.
 *
 * **M4 corrected this file's own formula, and the correction is the milestone.** M3 pinned
 * `cycles = N + 4 + S + 2·T` and read `2·T` as a rule about taken transfers. It was not a rule: it
 * was the **static-not-taken instance** of a scheme-dependent term, true only of a machine that can
 * never be right about a taken branch. See {@link penaltyOf} for the general form. M3's formula is
 * recovered exactly when the scheme is not-taken, so nothing it pinned was wrong — it was
 * *specific*, in a place that read as general.
 *
 * **The thesis, stated in the formula.** N and the TRANSFER STRUCTURE belong to the PROGRAM; S to
 * the forwarding toggle; P to the prediction toggle. No config can change which instructions run or
 * which branches are taken, so:
 *
 * > `cycles_off − cycles_on = S_off − S_on` and `cycles_notTaken − cycles_taken = P_nt − P_t`
 *
 * — each toggle's whole effect is one subtraction, and the two are orthogonal (different stages,
 * different questions: when operands are ready vs. where to fetch). Both are asserted on their own
 * below rather than resting on the formula being right. And **neither subtraction is always
 * positive**: M3 measured `call-return.s` at 17 cycles in BOTH forwarding positions, and M4 finds
 * the sharper version — `call-return.s` is *slower* under `static-taken`. A toggle is a tradeoff.
 *
 * **Careful — the penalty is per TRANSFER, not per `flush` EVENT.** They come apart in the corpus:
 * `call-return.s`'s `ret` is the last word of `.text`, so nothing is behind it to kill. It emits no
 * `flush` at all (the pinned "a flush reports real casualties" rule) and still costs its two
 * cycles: the target cannot be fetched until the redirect lands either way. A penalty is not a
 * casualty.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

const OFF: ProcessorConfig = { ...defaultConfig(), forwarding: false };
const ON: ProcessorConfig = { ...defaultConfig(), forwarding: true };

/** The two positions, as the table keys them. */
type Position = 'off' | 'on';
const CONFIG: Record<Position, ProcessorConfig> = { off: OFF, on: ON };

/**
 * The two prediction BEHAVIORS (M4). There are three config values, but `'none'` and
 * `'static-not-taken'` are one machine — a processor with no predictor keeps fetching, and the
 * fall-through IS the not-taken path. `processor.test.ts` pins that equivalence on whole traces;
 * repeating `'none'` here would add five identical runs and prove nothing this file is about.
 *
 * `OFF`/`ON` above are `defaultConfig()`-derived, i.e. `'none'` — so every M3 assertion in this
 * file was already testing the not-taken behavior, and still is.
 */
type Scheme = 'static-not-taken' | 'static-taken';
const SCHEMES: readonly Scheme[] = ['static-not-taken', 'static-taken'];
const withScheme = (config: ProcessorConfig, branchPrediction: Scheme): ProcessorConfig => ({
  ...config,
  branchPrediction,
});

/**
 * The three cache positions (M6). `off` is the M3/M4 machine unchanged; `small` (2 lines) and
 * `large` (4 lines) are the flagship straddle's two sizes, sharing the same 16-byte line and the
 * default `missPenalty` 10 (`cache.ts`). Every cache-off assertion above is the `off` position,
 * unmoved — the cache is a third, orthogonal toggle, not a rewrite.
 */
type CacheSize = 'off' | 'small' | 'large';
const CACHE: Record<CacheSize, CacheConfig | null> = {
  off: null,
  small: CACHE_SMALL,
  large: CACHE_LARGE,
};
const MISS_PENALTY = 10; // CACHE_SMALL / CACHE_LARGE default (cache.ts); step 4 owns the final value.
const withCache = (config: ProcessorConfig, cache: CacheConfig | null): ProcessorConfig => ({
  ...config,
  cache,
});

/** The pinned miss count at a given size — `off` has none (no cache ⇒ no access). */
const missesAt = (pinned: Timing, cache: CacheSize): number =>
  cache === 'off' ? 0 : pinned.misses[cache];

/**
 * `M`'s raw material as the ENGINE served it: `cache-access` events whose verdict is a miss. The
 * measured route to `M`, the way {@link penaltyFromEvents} is the measured route to `P` — checked
 * against the hand-derived {@link Timing.misses} so a disagreement names the access that drifted.
 */
const missCount = (ts: CycleTrace[]): number =>
  eventsOf(ts, 'cache-access').filter((e) => !e.hit).length;

/**
 * Where stalls land: the pc of the stalling instruction → how many cycles it spent stalled,
 * summed across the whole run. A histogram rather than a bare count, because a model that stalls
 * the right NUMBER of times in the wrong PLACES is wrong, and because it keeps count and
 * placement from drifting apart — S is derived by summing this, never stated twice.
 *
 * Keyed by pc (not by cycle) deliberately: a loop's stalls recur at the same static pc every
 * iteration, so `{ [PC]: 20 }` says "this instruction, twice per iteration, ten iterations" —
 * legible and hand-checkable in a way that twenty cycle numbers are not.
 */
type StallSites = Readonly<Record<number, number>>;

/**
 * How a program's control transfers break down (M4). Every field is a property of the PROGRAM —
 * config-invariant, exactly like `retires` — because no scheme can change which branches are taken.
 * What a scheme changes is only the PRICE of each kind, which is why `P` factors through this.
 */
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
  /**
   * The transfer breakdown. M3 stated a bare `takenTransfers: number` here; M4 needs the KINDS,
   * because a scheme prices them differently — and `T` is now DERIVED from this rather than stated
   * beside it, so the two can never drift apart.
   */
  readonly transfers: Transfers;
  /** `flush` events that name real casualties. NOT the same as `T` — see the header. */
  readonly flushes: { readonly branchTaken: number; readonly halt: number };
  /** The only term the FORWARDING toggle moves. */
  readonly stalls: Readonly<Record<Position, StallSites>>;
  /**
   * Misses served under each cache geometry (M6) — the `M` term, `M = misses × missPenalty`. A
   * property of `(program × cache)` and of NOTHING else: the address stream is INV-8 cache-oblivious,
   * so neither forwarding nor prediction can move it (unlike `stalls`, which the forwarding toggle
   * owns). `off` is implicit — no cache configured ⇒ no miss. Each value is hand-derived from the
   * program's block structure and pinned as a verdict SEQUENCE in `cache.test.ts` (never a bare
   * total); the `+M` cycle counts below rest on those.
   */
  readonly misses: { readonly small: number; readonly large: number };
}

/** `T` — taken control transfers, derived. Stating it beside its own parts would invite drift. */
const T = (t: Transfers): number => t.takenPredictable + t.takenUnpredictable;

/**
 * **`P` — the speculation penalty, and the reason M3's closed form needed generalizing.**
 *
 * M3 pinned `cycles = N + 4 + S + 2·T` and called `2·T` a rule. It was not: it was the
 * *static-not-taken instance* of a scheme-dependent term. The general rule is per TRANSFER, and it
 * makes both schemes one formula rather than two:
 *
 * > every resolved transfer costs **2 if mispredicted**, **1 if correctly predicted taken**, and
 * > **0 if correctly predicted not-taken**.
 *
 * A mispredict costs 2 because the target cannot be fetched until EX's redirect lands at the clock
 * edge, by which time two fetch slots are gone. A correct taken bet costs 1 because ID places it
 * one cycle earlier — one slot, not two. A correct not-taken "prediction" costs nothing because
 * the machine was already fetching the right instructions; it never had to change its mind.
 *
 * The scheme's only job is to decide `predicted`, and everything else falls out:
 *
 * - `static-not-taken` (≡ `none`): nothing is ever predicted taken ⇒ every taken transfer
 *   mispredicts (2·T) and every declined branch is free. **That is M3's `2·T`, recovered.**
 * - `static-taken`: predictable taken ⇒ correct bet (1); declined ⇒ lost bet (2); `jalr` ⇒ can't
 *   bet, and it always goes ⇒ mispredict (2).
 */
function penaltyOf(t: Transfers, scheme: Scheme): number {
  if (scheme === 'static-taken') {
    return 1 * t.takenPredictable + 2 * t.notTaken + 2 * t.takenUnpredictable;
  }
  return 2 * T(t);
}

/**
 * The table. Every number is hand-derived from the recurrence above, against the EXPANDED
 * instruction stream — which is where the traps are, since pseudo-ops hide real instructions and
 * real hazards from the `.s` source:
 *
 * - `la rd, sym` is ALWAYS two words, `lui rd, hi` + `addi rd, rd, lo` — the addi reads what the
 *   lui just wrote, so every `la` is a distance-1 RAW that stalls two cycles with forwarding off.
 *   Invisible in the source; `array-sum.s` has two of them and `byte-loads.s` one.
 * - `li` is sized by its literal; every `li` in this corpus is small, so each is a single
 *   `addi rd, x0, v` with no internal hazard.
 * - `mv` → `addi rd, rs, 0`; `ret` → `jalr x0, x1, 0`; `bnez rs, t` → `bne rs, x0, t`.
 * - TEXT_BASE is 0, so the pcs below are just `4 × index into the expanded stream`.
 */
const TIMING: Readonly<Record<string, Timing>> = {
  /**
   * `addi x1,x0,5 ; addi x2,x0,37 ; add x5,x1,x2` — no ecall: it halts by running off the end of
   * `.text` with three instructions still in flight. The one program whose tail is a pure DRAIN,
   * which is what makes it the place to confirm the formula's +4.
   *
   * OFF: d = 1, 2, 5 — the `add` waits for x2's write-back (producer at d=2 → WB at 5), so 2
   *      stalls. cycles = 5 + 4 = 9.
   * ON:  d = 1, 2, 3 — both operands forwarded, nothing stalls. cycles = 3 + 4 = 7.
   */
  'add.s': {
    retires: 3,
    // No control transfers at all: P = 0 under every scheme, which is what makes this program the
    // control for the whole M4 table — a prediction toggle must not move a program with nothing to
    // predict.
    transfers: { takenPredictable: 0, notTaken: 0, takenUnpredictable: 0 },
    flushes: { branchTaken: 0, halt: 0 },
    stalls: { off: { 8: 2 }, on: {} },
    // No memory ops ⇒ no cache access ⇒ M = 0 at every size. A control for the whole cache table:
    // flipping the cache must not move a program with nothing to cache, exactly as prediction must
    // not move a program with nothing to predict.
    misses: { small: 0, large: 0 },
  },

  /**
   * 4 prologue + 5 per iteration × 5 + 5 epilogue = 34 retires. `bnez` is taken 4 times (the 5th
   * finds t1 == 0 and falls through). The corpus's richest timing program: it has the textbook
   * load-use pair AND two `la`s.
   *
   * Expanded, with pcs:
   *    0 lui t0        4 addi t0,t0     8 addi t1,x0,5    12 addi a0,x0,0
   *   16 lw t2,0(t0)  20 add a0,a0,t2  24 addi t0,t0,4    28 addi t1,t1,-1   32 bne t1,x0,loop
   *   36 lui t3       40 addi t3,t3,20 44 sw a0,0(t3)     48 addi a7,x0,10   52 ecall
   *
   * OFF: the `la` addi at 4 stalls 2. Per iteration: `add` at 20 waits on the `lw` (2), `bne` at
   *      32 waits on the `addi t1` right before it (2) — the `lw` at 16 and both `addi`s never
   *      stall, their producers are long retired. 4/iteration × 5 = 20. Epilogue: the second `la`
   *      addi at 40 stalls 2, and `sw` at 44 waits on it (2). S = 2 + 20 + 4 = 26.
   *      Steady-state period = 11 = N_iter(5) + S_iter(4) + 2·T(1).
   * ON:  only the load-use survives: `add` at 20, one cycle, once per iteration. S = 5.
   *      Period = 8 = 5 + 1 + 2.
   */
  'array-sum.s': {
    retires: 34,
    // `bnez t1, loop` is PC-relative and goes 4 times (t1 = 4…1), then declines on the 5th (t1 = 0).
    // No `jalr`. P: not-taken 2·4 = 8; taken 4·1 + 1·2 = 6.
    transfers: { takenPredictable: 4, notTaken: 1, takenUnpredictable: 0 },
    flushes: { branchTaken: 4, halt: 0 },
    stalls: { off: { 4: 2, 20: 10, 32: 10, 40: 2, 44: 2 }, on: { 20: 5 } },
    // The LOCALITY-PUNISHER (step 4's "a bigger cache buys nothing"). One pass over 5 words: block 0
    // = arr[0..3] (the `arr[0]` load misses, arr[1..3] hit — spatial locality), block 1 = arr[4]
    // (a second compulsory miss); the `sw` to `total` lands in the resident block 1 and hits. Every
    // block is touched exactly once, so there is NO reuse for a bigger cache to capture — 2 misses at
    // BOTH sizes. Same block structure as `array-sum-twice`, minus the repeat that would reward size.
    misses: { small: 2, large: 2 },
  },

  /**
   * The corpus's first NESTED loop: an outer loop of 2 passes over an inner 12-element walk, so
   * the second pass re-reads the same addresses (the temporal-reuse fact this program exists for —
   * architecturally invisible here, its net is M6's cache timing). 2 prologue + 2 × (3 header +
   * 12 × 5 inner + 2 footer) + 2 epilogue = 134 retires. `outer` = pc 8, `inner` = pc 20.
   *
   * Expanded, with pcs:
   *    0 addi a0,x0,0   4 addi t3,x0,2   8 lui t0        12 addi t0,t0    16 addi t1,x0,12
   *   20 lw t2,0(t0)   24 add a0,a0,t2  28 addi t0,t0,4  32 addi t1,t1,-1  36 bne t1,x0,inner
   *   40 addi t3,t3,-1 44 bne t3,x0,outer  48 addi a7,x0,10  52 ecall
   *
   * OFF: per inner iteration the `add` at 24 waits on the `lw` (2) and the `bne` at 36 waits on the
   *      `addi t1` right before it (2) — 4 × 24 iterations = 96. The `la` addi at 12 stalls 2 per
   *      pass (2). The outer `bne` at 44 waits on the `addi t3` before it (2) per pass. And the
   *      NESTED shape adds one array-sum never had: the FIRST `lw` of each pass at 20 reads t0 from
   *      the `la` two ahead of it (only `li t1` between) — a distance-2 RAW that stalls 1, once per
   *      pass. Every later `lw` gets t0 from the `addi t0` at 28 across the taken-branch gap and is
   *      free. S = 96 + 2·2(la) + 2·1(first lw) + 2·2(outer bne) = 106. Inner steady period = 11 =
   *      N_iter(5) + S_iter(4) + 2·T(1), exactly array-sum's inner.
   * ON:  only the load-use survives — `add` at 24, one cycle, every inner iteration. S = 24.
   */
  'array-sum-twice.s': {
    retires: 134,
    // Two `bnez`: the inner `bne t1` is PC-relative and goes 11 times per pass (t1 = 12…1) then
    // declines (t1 = 0) — 22 taken, 2 declined across both passes; the outer `bne t3` goes once
    // (t3 = 1) and declines once (t3 = 0). No `jalr`. P: not-taken 2·23 = 46; taken 23·1 + 3·2 = 29.
    transfers: { takenPredictable: 23, notTaken: 3, takenUnpredictable: 0 },
    flushes: { branchTaken: 23, halt: 0 }, // every taken branch has live code behind it; ecall is last
    stalls: { off: { 12: 4, 20: 2, 24: 48, 36: 48, 44: 4 }, on: { 24: 24 } },
    // The SIZE-STRADDLER, this milestone's flagship — 3 blocks the 4-line cache fits and the 2-line
    // overflows. Pinned as full verdict SEQUENCES in `cache.test.ts`: pass 1 is 3 compulsory misses
    // either way; pass 2 all-hits under 4 lines but re-misses blocks 0 and 2 under 2 lines (block 2
    // aliases block 0 on line 0 and evicts it late in pass 1). 5 misses small, 3 large — the flip.
    misses: { small: 5, large: 3 },
  },

  /**
   * 9 retires. The corpus's only program with one branch of EACH outcome on the same operands:
   * `blt` at 12 is taken (signed -1 < 1) and `bltu` at 24 is not (unsigned 4294967295 is not < 1).
   *    0 addi t0,x0,-1   4 addi t1,x0,1   8 addi a0,t0,0   12 blt t0,t1,20
   *   16 addi a0,t1,0  ← FLUSHED: the taken `blt` kills it, so it is the corpus's clearest case of
   *                      an instruction that is fetched and never retires (N counts 9, not 10).
   *   20 addi a1,t0,0  24 bltu t0,t1,32  28 addi a1,t1,0  32 addi a7,x0,10  36 ecall
   *
   * OFF: d = 1, 2, 4, 5 | 8, 9, 10, 11, 12 → cycles = 12 + 4 = 16. Only `mv a0, t0` at 8 interlocks,
   *      and only for ONE cycle: it reads t0 from the `li` two ahead of it (d=1), so it needs d≥4
   *      against a baseline of 3. Every later reader of t0/t1 is far enough back to be free — the
   *      `blt` at 12 wants d≥5 and the baseline already gives it 5. S = 1.
   *      Note the `blt`'s +2 does NOT appear here: the mispredict pushes d(20) from 6 to 8, but that
   *      is P's term, not the interlock's, and the engine emits no stall for it.
   * ON:  no loads anywhere ⇒ S = 0. cycles = 9 + 4 + 0 + 2 = 15.
   */
  'branch-flavors.s': {
    retires: 9,
    // **The second program that punishes a taken-bet, and it needs only two branches to do it.**
    // `blt` is PC-relative and goes (a bet ID wins, 2 → 1); `bltu` is the same comparison read
    // unsigned and NEVER goes (predict-not-taken is right; a taken-bet is wrong, 0 → 2). No `jalr`.
    // P: not-taken 2·1 = 2; taken 1·1 + 2·1 = 3 — so this program, like `call-return.s`, is one
    // cycle SLOWER under static-taken. Which is a neater statement of M4's thesis than the corpus
    // had: the two branches here differ by a single letter and bet in opposite directions, so no
    // static scheme can be right about both. Pinned by the MATRIX below rather than restated.
    transfers: { takenPredictable: 1, notTaken: 1, takenUnpredictable: 0 },
    flushes: { branchTaken: 1, halt: 0 }, // `ecall` is the last word of text — nothing behind it
    stalls: { off: { 8: 1 }, on: {} },
    // No loads or stores (`mv`/`blt`/`bltu` touch registers only) ⇒ M = 0 at every size.
    misses: { small: 0, large: 0 },
  },

  /**
   * 6 retires, no branches at all.
   *    0 lui t0    4 addi t0,t0    8 lb t1,0(t0)    12 lbu t2,0(t0)    16 addi a7,x0,10   20 ecall
   *
   * OFF: the `la` addi at 4 stalls 2; `lb` at 8 reads t0 one behind it (2). S = 4.
   * ON:  ZERO — and the interesting part is why. This program has two loads and no load-use
   *      hazard: `lbu` reads t0, the pointer, NOT the t1 that `lb` just loaded. The load-use rule
   *      keys off the source registers, not off "a load is nearby".
   */
  'byte-loads.s': {
    retires: 6,
    // Straight-line: `la` + two loads + `ecall`. No transfers ⇒ P = 0 under every scheme.
    transfers: { takenPredictable: 0, notTaken: 0, takenUnpredictable: 0 },
    flushes: { branchTaken: 0, halt: 0 },
    stalls: { off: { 4: 2, 8: 2 }, on: {} },
    // Two loads at the SAME address (`0(t0)` twice) ⇒ one block: the `lb` compulsory-misses, the
    // `lbu` hits the resident line. One miss at BOTH sizes — a single-block program is size-immune.
    misses: { small: 1, large: 1 },
  },

  /**
   * 9 dynamic instructions: `jal` and `ret` are taken; `bge a0,a1,done` is NOT (17 >= 42 is false)
   * so `mv a0, a1` really executes.
   *    0 addi a0,x0,17   4 addi a1,x0,42   8 jal ra,max   12 addi s0,a0,0   16 addi a7,x0,10
   *   20 ecall          24 bge a0,a1,done 28 addi a0,a1,0 32 jalr x0,x1,0
   *
   * **The honest counterexample: S = 0 in BOTH positions, so forwarding buys nothing here.**
   * Every RAW in this program is already separated by a flush gap — `bge` reads the two `addi`s
   * from before the `jal`, and `mv s0, a0` reads across the `ret`. Both jumps hand their consumer
   * the +2 the interlock would have charged anyway:
   *    d = 1, 2, 3(jal) | 6(bge) 7(mv a0) 8(ret) | 11(mv s0) 12 13(ecall) → cycles = 17, both.
   * This is why the crown jewel is claimed for programs with real RAW chains, not for every
   * program: a milestone that quietly asserted "on is always faster" would be overclaiming.
   *
   * It is also the only corpus program with live code behind its `ecall` (the real `max:`
   * function), hence the one halt flush in the corpus — and the only one whose `ret` sits at the
   * last word of text, hence a taken transfer that flushes nobody.
   */
  'call-return.s': {
    retires: 9,
    // **The program that punishes a taken-bet, and the milestone's thesis in one row.** Three
    // transfers, one of each kind: `jal max` is PC-relative and always goes (a bet ID wins);
    // `bge a0, a1, done` is 17 >= 42 — it NEVER goes, so predict-not-taken is right and a taken-bet
    // is wrong; `ret` is a `jalr`, whose target is a register ID has not read, so no scheme can bet
    // on it and it mispredicts always.
    //
    // P: not-taken 2·(1+1) = 4; taken 1·1 + 2·1 + 2·1 = 5. **The bet costs a cycle here** — the one
    // corpus program that gets SLOWER under static-taken.
    misses: { small: 0, large: 0 }, // no loads or stores ⇒ M = 0 at every size
    transfers: { takenPredictable: 1, notTaken: 1, takenUnpredictable: 1 },
    flushes: { branchTaken: 1, halt: 1 }, // jal flushes; ret has nothing behind it to kill
    stalls: { off: {}, on: {} },
  },

  /**
   * 5 retires, two never-taken branches back to back (M8 step 0). Its whole reason to exist is
   * WIDTH 2 — see the superscalar table, where it is the corpus's only `branch-slot` witness — but
   * at width 1 it is an ordinary straight-line run:
   *    0 bne x0,x0,done   4 bne x0,x0,done   8 addi a0,x0,42   12 addi a7,x0,10   16 ecall
   * `done` = 12, never reached by a taken branch. Every source is x0, so there is no RAW anywhere
   * and forwarding buys nothing: S = 0 in both positions.
   *
   * NOT-TAKEN: d = 1,2,3,4,5 → cycles = 5 + 4 = 9 (both off and on); P = 2·T = 0.
   * STATIC-TAKEN: both branches bet taken and both MISPREDICT (x0 == x0), so each costs 2 —
   *   P = 2·notTaken(2) = 4 ⇒ cycles = 5 + 4 + 0 + 4 = 13. The corpus's sharpest "a bet on a branch
   *   that never goes is pure loss": two branches, both bet wrong, pinned by the MATRIX below.
   */
  'paired-branches.s': {
    retires: 5,
    // Two `bne x0, x0` — both DECLINE (0 != 0 is false), neither is a `jalr`. P: not-taken 2·0 = 0;
    // taken 2·2 = 4 (two lost bets).
    transfers: { takenPredictable: 0, notTaken: 2, takenUnpredictable: 0 },
    flushes: { branchTaken: 0, halt: 0 }, // nothing taken; `ecall` is the last word — no halt flush
    stalls: { off: {}, on: {} },
    misses: { small: 0, large: 0 }, // no loads or stores ⇒ M = 0 at every size
  },

  /**
   * 7 retires, no branches (M9 step 1b — a store immediately followed by a dependent load of the
   * SAME address, added for out-of-order memory disambiguation; this pipeline is strictly in-order
   * so the store's MEM stage always precedes the load's, and it needs no special handling here).
   *    0 lui t0     4 addi t0,t0    8 addi t1,x0,99   12 sw t1,0(t0)
   *   16 lw a0,0(t0) 20 addi a7,x0,10  24 ecall
   *
   * OFF: the `la` addi at 4 stalls 2 (RAW on t0, distance 1). `sw` at 12 stalls 2: it reads t1 from
   *      the `addi` right before it (distance 1). `lw` at 16 reads t0 from the `la`'s addi, but that
   *      producer is 3 instructions back — already retired far enough, no stall. S = 4.
   * ON:  every RAW here is on a non-load producer (the `la`'s addi, `sw`'s own `addi t1`), so
   *      forwarding covers all of them and the load-use rule never triggers (`lw`'s own consumer —
   *      there is none; nothing after it reads a0). S = 0.
   */
  'store-forward.s': {
    retires: 7,
    transfers: { takenPredictable: 0, notTaken: 0, takenUnpredictable: 0 },
    flushes: { branchTaken: 0, halt: 0 }, // `ecall` is the last word of text — nothing behind it
    stalls: { off: { 4: 2, 12: 2 }, on: {} },
    // `sw` misses (no-write-allocate — a store miss installs nothing, cache.ts) and `lw` to the
    // SAME never-before-touched address then compulsory-misses too (and installs). 2 misses at
    // both sizes: one address, one line, unaffected by cache geometry.
    misses: { small: 2, large: 2 },
  },

  /**
   * 2 prologue + 3 per iteration × 10 + 2 epilogue = 34 retires. `bnez` is taken 9 times.
   *    0 addi a0,x0,0   4 addi t0,x0,10
   *    8 add a0,a0,t0  12 addi t0,t0,-1  16 bne t0,x0,loop
   *   20 addi a7,x0,10 24 ecall
   *
   * OFF: iteration 1's `add` at 8 stalls 2 (waiting on the `li t0` immediately before it), but no
   *      LATER iteration's does — the taken branch's 2-cycle gap has already retired its
   *      producers by the time it reaches ID. That asymmetry is exactly why a per-iteration cost
   *      must be traced, not assumed uniform. The `bne` at 16 stalls 2 EVERY iteration: it reads
   *      the `addi t0` one instruction ahead of it. This is the distance-1 branch-operand RAW, ten
   *      times over, in the hottest loop the corpus ships.
   *      S = 2 (the first `add`) + 2 × 10 (every `bne`) = 22.
   *      Steady-state period = 7 = N_iter(3) + S_iter(2) + 2·T(1).
   * ON:  no loads anywhere ⇒ S = 0. Period = 5 = 3 + 2·1.
   */
  'sum-loop.s': {
    retires: 34,
    // `bnez t0, loop` goes 9 times (t0 = 9…1) and declines on the 10th. P: not-taken 2·9 = 18 —
    // which is exactly the 18 casualties M3's pipeline map draws; taken 9·1 + 1·2 = 11.
    transfers: { takenPredictable: 9, notTaken: 1, takenUnpredictable: 0 },
    flushes: { branchTaken: 9, halt: 0 },
    stalls: { off: { 8: 2, 16: 20 }, on: {} },
    // A register-only accumulator: no loads or stores ⇒ M = 0 at every size.
    misses: { small: 0, large: 0 },
  },

  /**
   * 4 prologue + 4 per iteration × 6 + 2 epilogue = 30 retires. `bnez` is taken 5 times (i = 5…1)
   * and declines on the 6th (M10 step 3 — the slow-op witness; under this pipeline the `sll` is an
   * ordinary single-cycle ALU op, so this reads exactly like `sum-loop` with a wider body).
   *    0 addi t1,x0,6   4 addi a0,x0,0   8 addi t5,x0,3  12 addi t6,x0,2
   *   16 sll t3,t5,t6  20 add a0,a0,t3  24 addi t1,t1,-1 28 bne t1,x0,loop
   *   32 addi a7,x0,10 36 ecall
   *
   * OFF: iteration 1's `sll` at 16 stalls 2 — it reads t6 from the `li` at 12 immediately before it
   *      (distance-1 RAW) — but no LATER iteration's does, because t5/t6 are loop-invariant and
   *      long retired by the time the loop comes round (the same first-iteration-only asymmetry
   *      `sum-loop`'s first `add` shows). The `add` at 20 stalls 2 EVERY iteration (it reads t3 from
   *      the `sll` one instruction ahead), and the `bne` at 28 stalls 2 EVERY iteration (it reads
   *      t1 from the `addi t1` one ahead) — the same distance-1 operand RAW `sum-loop`'s branch has,
   *      now with the load-carried `add` beside it. S = 2 + 2×6 + 2×6 = 26.
   * ON:  no loads anywhere ⇒ every RAW is on a non-load producer, forwarding covers all of them,
   *      the load-use rule never triggers ⇒ S = 0.
   */
  'slow-op-loop.s': {
    retires: 30,
    // `bnez t1, loop` goes 5 times (t1 = 5…1) and declines on the 6th. Direct conditional branch, so
    // all five taken transfers are predictable; nothing indirect.
    transfers: { takenPredictable: 5, notTaken: 1, takenUnpredictable: 0 },
    flushes: { branchTaken: 5, halt: 0 }, // every taken branch has the fall-through live behind it; ecall is last
    stalls: { off: { 16: 2, 20: 12, 28: 12 }, on: {} },
    // A register-only shift-accumulate loop: no loads or stores ⇒ M = 0 at every size.
    misses: { small: 0, large: 0 },
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
  const p = new PipelineProcessor();
  p.reset(toProgramImage(asm(readFileSync(PROGRAMS_DIR + file, 'utf8'))), config);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    // Every entry in the table is under 80 cycles; this only ever fires on a runaway bug.
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
 * table — two routes to one number, so a disagreement localizes to the transfer whose prediction
 * outcome differs from what the table claims.
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

describe('the pinned cycle-count table', () => {
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

    // Each term of `cycles = N + 4 + S + P` is asserted on its own, against the events that
    // define it. Checking only the total would let a compensating pair of errors through, and
    // would say nothing about WHICH term drifted when it failed.
    expect(eventsOf(ts, 'instr-retire'), 'N — retired instructions').toHaveLength(pinned.retires);
    expect(takenTransfers(ts), 'T — taken control transfers').toBe(T(pinned.transfers));
    // S, and every stall's PLACE at once: a model that stalls the right number of times at the
    // wrong instructions is wrong, and this catches it without naming a single cycle number.
    expect(stallSites(ts), 'S — where the stalls land').toEqual(sites);

    // ...and only then the closed form itself. `CONFIG[position]` is `defaultConfig()`-derived,
    // i.e. `'none'` — the not-taken behavior — so P here is M3's `2·T`, now spelled as the instance
    // of the general rule that it always was.
    const P = penaltyOf(pinned.transfers, 'static-not-taken');
    expect(P, "the not-taken scheme's P is exactly M3's 2·T").toBe(2 * T(pinned.transfers));
    expect(ts).toHaveLength(pinned.retires + 4 + total(sites) + P);
  });
});

describe("the formula's constant terms, isolated", () => {
  it('+4: the fill and drain, on the one program that ends in a pure drain', () => {
    // `add.s` has no `ecall` — it runs off the end of `.text` with three instructions still in
    // flight, so its tail is the drain and nothing else. With N=3, S=0, T=0 the whole count IS the
    // constant: 3 + 4. If halting truncated the run instead of draining, this is where it shows.
    const ts = run('add.s', ON);
    expect(eventsOf(ts, 'stall')).toEqual([]);
    expect(takenTransfers(ts)).toBe(0);
    expect(ts).toHaveLength(3 + 4);
    // The drain is real: fetching stops three cycles before the machine does.
    expect(eventsOf(ts, 'instr-fetch')).toHaveLength(3);
    expect(eventsOf(ts, 'instr-retire')).toHaveLength(3);
  });

  it('+2 per taken transfer, isolated from every stall', () => {
    // A program with exactly one taken branch and no RAW anywhere, so the penalty is the only
    // thing separating it from N+4 — in BOTH configs, since with nothing to forward the toggle
    // cannot move it. Four instructions retire: the two `addi`s, the branch, and the ecall; the
    // two shadows are flushed and never retire.
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
      const p = new PipelineProcessor();
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
    // cycles, because the target cannot be fetched until the redirect lands at the clock edge.
    // This is why the formula's T counts taken TRANSFERS and not `flush` events — on this program
    // there are 2 of the former and 1 of the latter, and using flushes would under-count by 2.
    const ts = run('call-return.s', ON);
    expect(takenTransfers(ts)).toBe(2);
    expect(eventsOf(ts, 'flush').filter((e) => e.reason === 'branch-taken')).toHaveLength(1);
    // The count only balances with T=2. Were the penalty charged per flush, this would be 15.
    expect(ts).toHaveLength(9 + 4 + 0 + 2 * 2);
  });
});

describe('N and T are the program; S is the microarchitecture', () => {
  // The thesis, stated as an invariant rather than an anecdote. Forwarding is a claim about HOW
  // operands reach the ALU — it cannot change which instructions run or which branches are taken.
  // If either of these ever differs across configs, the toggle has broken something architectural
  // and the timing numbers are the least of it.
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
      // `cycles = N + 4 + S + 2·T` with N and T config-invariant collapses to this subtraction. It
      // is the sharpest statement of what the toggle does: it buys back stall cycles and nothing
      // else. Note this holds for `call-return.s` too, where both sides are 0.
      const pinned = TIMING[file]!;
      const off = run(file, OFF);
      const on = run(file, ON);
      expect(off.length - on.length).toBe(total(pinned.stalls.off) - total(pinned.stalls.on));
    },
  );
});

describe('the crown jewel — the same program, the same answer, fewer cycles', () => {
  // The spec's flagship interaction (§12), on the real corpus rather than a hand-built fixture,
  // and asserted WITHOUT reference to the formula above: even if every derived constant were
  // wrong, this comparison would still be the milestone's claim. It is also precisely the claim
  // INV-8 structurally cannot make, since it compares only the left-hand side of "same answer".
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
      // position wrote is precisely the asymmetry worth catching, and iterating a single side's
      // addresses would look right while missing it entirely. Conformance checks both against the
      // reference, but this test is the crown jewel and is meant to stand on its own.
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
    // The honest counterexample, and the reason the list above is a list rather than the corpus.
    // Every RAW in `call-return.s` is already separated by a flush gap, so the interlock never has
    // anything to charge for: forwarding on saves exactly zero cycles. A suite that asserted "on
    // is faster" across the whole corpus would be overclaiming, and would have to be weakened to
    // `<=` — which would then pass for a pipeline where forwarding did nothing at all.
    expect(run('call-return.s', ON)).toHaveLength(run('call-return.s', OFF).length);
  });
});

describe('stall and flush placement across the corpus', () => {
  it('every stall interlocks in ID, and names a real in-flight instruction', () => {
    for (const { file, position } of CASES) {
      const ts = run(file, CONFIG[position]);
      const pcs = pcById(ts);
      for (const stall of eventsOf(ts, 'stall')) {
        expect(stall.stage, `${file} [${position}]`).toBe('ID');
        expect(pcs.has(stall.instr)).toBe(true);
        // ...and it really is in ID that cycle, not merely labelled so.
        const cycle = ts.find((t) => t.events.includes(stall))!;
        expect(cycle.instructions.find((i) => i.id === stall.instr)?.location).toBe('ID');
      }
    }
  });

  it("reports 'load-use' only with forwarding on — with it off, the interlock says 'raw'", () => {
    // The pinned reason encoding. With forwarding off the general interlock subsumes the load-use
    // case and honestly reports what it did: it interlocked on a RAW, like it does for every other
    // hazard. Claiming 'load-use' there would tell a lesson the bubble was the un-forwardable one
    // when it was really just the interlock doing its ordinary job.
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
        // one younger instruction to kill.
        expect(flush.stages).toEqual(flush.reason === 'branch-taken' ? ['ID', 'IF'] : ['IF']);

        // ...and the casualties are REAL, which is the whole content of the pinned rule: the trace
        // says an instruction died in each named stage, so the map has that many rows to cut and a
        // lesson triggering on a bare `{ event: 'flush' }` never announces a bubble that didn't
        // happen. Four of the six corpus programs end with `ecall` as their last word and emit no
        // halt flush at all for exactly this reason.
        const cycle = ts.find((t) => t.events.includes(flush))!;
        for (const stage of flush.stages) {
          expect(cycle.instructions.some((i) => i.location === stage)).toBe(true);
        }
      }
    },
  );
});

/**
 * M4 step 3 — the speculation penalty, corpus-wide.
 *
 * Everything above pins the machine under the not-taken behavior (`CONFIG[position]` is
 * `defaultConfig()`-derived), which is all M3 had. This is the other half: `static-taken`, where
 * `P` finally differs from `2·T` and the prediction toggle becomes observable at all.
 *
 * Nothing here is a snapshot. Every `P` comes from {@link penaltyOf} applied to the program's
 * hand-derived transfer breakdown, and the cycle count is the closed form — so a failure names the
 * term that drifted rather than a number that moved.
 */
const MATRIX = Object.keys(TIMING).flatMap((file) =>
  (['off', 'on'] as const).flatMap((position) =>
    SCHEMES.map((scheme) => ({ file, position, scheme })),
  ),
);

describe('P — the speculation penalty (the term 2·T was hiding)', () => {
  it.each(MATRIX)('$file [forwarding $position, predict $scheme]', ({ file, position, scheme }) => {
    const pinned = TIMING[file]!;
    const ts = run(file, withScheme(CONFIG[position], scheme));
    const sites = pinned.stalls[position];

    // N and the transfer structure are the PROGRAM: no scheme can change them. Asserting it in
    // every cell is what makes the P column attributable — a scheme that "sped things up" by
    // skipping an instruction or taking a different branch is caught here, not in the total.
    expect(eventsOf(ts, 'instr-retire'), 'N — the program, not the config').toHaveLength(
      pinned.retires,
    );
    expect(takenTransfers(ts), 'T — the program, not the config').toBe(T(pinned.transfers));
    // S is the FORWARDING toggle's term and must not move with the scheme (different stages,
    // different questions). Step 1 pinned that orthogonality on a hand-built case; this is it
    // corpus-wide, and it is what lets the closed form have two independent config terms at all.
    expect(stallSites(ts), 'S — the forwarding toggle, untouched by prediction').toEqual(sites);

    // P, by two independent routes. The pinned route derives it from the transfer breakdown; the
    // measured route applies the per-transfer rule to the engine's OWN prediction outcomes. If the
    // engine mispredicted something the table says it should have called right, these disagree —
    // which no cycle count could tell you, since the two errors would cancel in the total.
    const P = penaltyOf(pinned.transfers, scheme);
    expect(penaltyFromEvents(ts), 'P — each transfer priced by what the engine predicted').toBe(P);

    // ...and only then the closed form.
    expect(ts).toHaveLength(pinned.retires + 4 + total(sites) + P);
  });

  /**
   * **THE THESIS: no scheme dominates.** The milestone's whole pedagogical claim, measured rather
   * than asserted — and the sharper mirror of what M3 step 3 had to discover about forwarding,
   * where `call-return.s` turned out to be 17 cycles in BOTH positions.
   *
   * Here the same program does not merely fail to improve; it gets **worse**. A predictor is a BET,
   * and the corpus contains a program that punishes each way of betting:
   *
   * - `sum-loop.s` — a backward loop branch taken 9 of 10. `P: 18 → 11`, a **7-cycle win**.
   * - `array-sum.s` — same shape, 4 of 5. `P: 8 → 6`, a **2-cycle win**.
   * - `call-return.s` — `bge a0, a1` is `17 >= 42`: it never goes. `P: 4 → 5`, a **1-cycle LOSS**.
   *
   * Asserted as a signed delta per program rather than as "prediction is faster on average",
   * because the average is exactly the claim that would let the loss hide.
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
   * **17 cycles in both forwarding positions** — the program where every RAW already sits behind a
   * flush gap, so `S = 0` and forwarding buys nothing. Under `static-taken` it is **18**: the one
   * corpus program made slower by a toggle sold as an optimization.
   *
   * Its three transfers are one of each kind, which is why it is the corpus's whole argument in a
   * single program: `jal` improves (2 → 1), the never-taken `bge` regresses (0 → 2), and `ret` (a
   * `jalr`) cannot be predicted by anyone and stays at 2.
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
   * slot, and a wasted fetch slot is a cycle. This is the bridge to the pipeline map — M3 draws 18
   * casualty rows for `sum-loop`, and the map must show 11 once the bet is on. Pinning it here
   * means step 6 inherits a number instead of inventing one.
   *
   * Note this holds even though the two schemes reach it differently: not-taken pays 9 flushes of 2
   * casualties each, while taken pays 9 flushes of 1 (the bets) plus a 2-casualty correction at the
   * loop exit... except the exit's bet has already emptied ID, so that correction cuts only IF. The
   * arithmetic still lands on 11 because the exit's bet contributed a casualty of its own.
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
 * M6 step 4 — the closed form gains its fifth and last in-order term, and the flagship cache thesis.
 *
 * Everything above pins the pipeline cache-OFF: `cycles = N + 4 + S + P`. A configured cache makes
 * the MEM stage variable-latency — a miss holds it `missPenalty` cycles — so the count grows by one
 * more term:
 *
 * > **cycles = N + 4 + S + P + M**,  where **M = misses × missPenalty**.
 *
 * `M` is the third config term, and the cleanest of the three. `S` belongs to the forwarding toggle,
 * `P` to the prediction toggle, and `M` to the cache toggle — and where `P` shares the cycle count
 * with `S`, `M` is orthogonal to BOTH: a cache is a timing shadow that holds no values, so it cannot
 * change which instructions run (`N`), where they interlock (`S`), or what they predict (`P`). It can
 * only add miss cycles. So a program's whole cache effect is one number per size, invariant across
 * the entire forwarding × prediction matrix — pinned as such below.
 *
 * **Additivity is structural, not arithmetic luck** (the claim `cache-stall.test.ts` proved for the
 * straddler, here corpus-wide): a miss freezes the whole front of the pipe for `missPenalty` cycles,
 * and this corpus's loads sit clear of every branch resolve, so a miss stall overlaps no load-use
 * bubble (decided in EX one cycle before the miss is seen in MEM) and no speculation penalty. The
 * `expect(...).toHaveLength(N + 4 + S + P + M)` cell is the net that confirms it.
 *
 * Nothing here is a snapshot. `M` comes from {@link Timing.misses} — hand-derived from each program's
 * block structure and pinned as verdict SEQUENCES in `cache.test.ts` — times the penalty, and is
 * cross-checked against the engine's own miss verdicts.
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
      // added, because a timing shadow changes latency and nothing else. Re-asserting all four in
      // every cache cell is what makes `M` attributable: a cache that "helped" by dropping a stall,
      // a retire, or a mispredict is caught right here, not swallowed by a total that still balances.
      expect(eventsOf(ts, 'instr-retire'), 'N — the cache cannot change it').toHaveLength(
        pinned.retires,
      );
      expect(takenTransfers(ts), 'T — the cache cannot change it').toBe(T(pinned.transfers));
      expect(stallSites(ts), 'S — the forwarding toggle, untouched by the cache').toEqual(sites);
      const P = penaltyOf(pinned.transfers, scheme);
      expect(penaltyFromEvents(ts), 'P — the prediction toggle, untouched by the cache').toBe(P);

      // `M`, by two independent routes — the discipline `P` uses. The pinned route: the hand-counted
      // miss breakdown. The measured route: the engine's own miss verdicts. If the engine missed on
      // an access the derivation calls a hit (or vice versa) they disagree, localizing the fault to
      // that access — which no cycle total could, since a compensating over/under pair balances it.
      const misses = missesAt(pinned, cache);
      expect(missCount(ts), 'M — misses the engine actually served').toBe(misses);
      const M = misses * MISS_PENALTY;
      // `off` must emit no cache-access at all — the cache-off machine is byte-identical to M3/M4.
      if (cache === 'off') expect(eventsOf(ts, 'cache-access'), 'cache-off is inert').toEqual([]);

      // ...and only then the closed form, all five terms.
      expect(ts).toHaveLength(pinned.retires + 4 + total(sites) + P + M);
    },
  );
});

describe('the crown jewel, cache edition — the same program, the same answer, more cycles', () => {
  // The spec's flagship §12 interaction on the cache axis: the SAME source running a DIFFERENT cycle
  // count under two cache sizes — and, the sharper half, a program where it does NOT. Asserted as
  // signed per-program deltas rather than an average, because the average is exactly the claim that
  // would let "buys nothing" hide (the mirror of M4's "no scheme dominates", where an average would
  // have hidden call-return's regression). Stated WITHOUT reference to the formula above: even were
  // every derived term wrong, this comparison is still the milestone's claim.
  //
  //   delta = cycles(small cache) − cycles(large cache);  POSITIVE = the bigger cache buys back cycles.
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

      // The STRADDLER wins: 3 blocks the 4-line fits and the 2-line overflows, so its repeat pass hits
      // large and re-misses small — 2 fewer misses × penalty 10 = 20 cycles the bigger cache buys back.
      expect(delta('array-sum-twice.s'), 'the straddler: bigger cache buys back 2 misses').toBe(20);
      // The PUNISHER buys nothing, and it is the whole "a cache is a bet on locality" point: array-sum
      // walks its array ONCE, so every block is compulsory-missed exactly once at ANY size — there is
      // no reuse for capacity to capture. It and the straddler are the same program bar the repeat.
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
  // The `M`-term's version of "N and T are the program; S is the microarchitecture". `M` depends
  // only on the address stream, which no toggle can move, so a program's cache size-delta is a single
  // constant across the ENTIRE forwarding × prediction matrix — a sharper orthogonality than `P` had
  // (P shares the cycle count with S). If flipping forwarding or the predictor ever changed a cache
  // delta, the cache would be leaking into a stage it has no business touching.
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
      // Every cell agrees: the delta is a property of the program's locality, full stop.
      expect(new Set(deltas).size, 'one delta whatever the other two toggles do').toBe(1);
      // ...and it equals the pinned miss difference × penalty — the delta IS `(M_small − M_large)`.
      const pinned = TIMING[file]!;
      expect(deltas[0], 'delta = (misses_small − misses_large) × penalty').toBe(
        (pinned.misses.small - pinned.misses.large) * MISS_PENALTY,
      );
    },
  );
});
