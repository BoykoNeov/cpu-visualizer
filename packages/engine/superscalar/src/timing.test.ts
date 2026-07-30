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
import { MAX_ISSUE_WIDTH, SuperscalarProcessor } from './index';

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

/**
 * **The width-2 terms — step 4's deliverable.** Every number here is hand-derived from the pinned
 * pairing rules by the method in the WIDTH 2 header below, never read off the engine.
 *
 * `G`, `Q` and `L` are stated under the BASE prediction behaviour (`'none'` /
 * `'static-not-taken'` — one machine). `betting` carries the `'static-taken'` DELTAS, because they
 * are the output of a single rule rather than seven independent facts.
 */
interface Width2 {
  /** `G` — issue-group cycles: cycles in which ID dispatched at least one instruction. */
  readonly groups: Readonly<Record<Position, number>>;
  /** `Q` — pairs: cycles in which ID dispatched TWO. `G + Q` is the number of slots consumed. */
  readonly pairs: Readonly<Record<Position, number>>;
  /**
   * `L` — BLOCKING stall cycles: a slot-0 refusal, where nothing issued at all. This is what `S`
   * becomes at width 2, and the two are not the same thing — see the header's split.
   */
  readonly blocked: Readonly<Record<Position, number>>;
  /**
   * Instructions that consumed an issue slot and never retired — the mate stranded beside a taken
   * transfer. NOT simply `T(transfers)`: see the test that pins why.
   */
  readonly doomed: Readonly<Record<Position, number>>;
  /** The `'static-taken'` deltas on `groups` / `pairs`, from the bet-kills-its-mate rule. */
  readonly betting: Readonly<Record<Position, { readonly groups: number; readonly pairs: number }>>;
}

/**
 * **One width-3/4 schedule, under one prediction behaviour — M13 step 3's deliverable.**
 *
 * Two things about the SHAPE, both of them measurements rather than conveniences:
 *
 * 1. **`groups`, `sizes` and `doomed` carry NO forwarding position**, because at width ≥ 3 the
 *    forwarding toggle never moves the partition — asserted below, not assumed. At width 2 it did:
 *    `array-sum.s` runs G = 25 / Q = 13 with forwarding on and G = 26 / Q = 12 with it off, because
 *    the `lw@16`'s slot-1 refusal for `raw` split a pair. A third slot MASKS that: the same `lw` is
 *    refused for `intra-pair-raw` against `addi t0@4` whatever the toggle says, and a pairing rule
 *    is checked BEFORE the ordinary hazard. **Widening deleted the corpus's only forwarding-shaped
 *    partition change**, which is a fact about this machine worth having a field shape state.
 * 2. **`sizes` is a HISTOGRAM, not a `pairs` count.** `Q` does not generalize. This is the term that
 *    answers the plan's "a width-4 assertion that does not first CHECK the group size it claims to
 *    exercise is measuring width 3" — and on this corpus it says so out loud: `array-sum.s`,
 *    `array-sum-twice.s` and `sum-loop.s` never reach a group of 4 at width 4 at all.
 */
interface WideCell {
  /** `G` — issue-group cycles. */
  readonly groups: number;
  /** `sizes[k]` = cycles that dispatched exactly `k`. Absent keys are zero. */
  readonly sizes: Readonly<Record<number, number>>;
  /** Instructions that consumed an issue slot and never retired. `Σ k·sizes[k] = retires + doomed`. */
  readonly doomed: number;
  /** `L` — the ONE term the forwarding toggle still moves at width ≥ 3. */
  readonly blocked: Readonly<Record<Position, number>>;
}

/** A program's schedule at one width, under both prediction behaviours. */
interface WideSchedule {
  /** `'none'` / `'static-not-taken'` — one machine. */
  readonly base: WideCell;
  /**
   * `'static-taken'`. Stated ABSOLUTELY rather than as a delta off `base`, unlike the width-2
   * `betting` field: at width ≥ 3 a bet re-partitions the tail rather than shaving one pair off it,
   * so a `{groups, pairs}` delta cannot express what changes. The deltas are still worth reading —
   * they are recorded in each program's docblock — but the assertion is against the absolute cell.
   */
  readonly taken: WideCell;
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
  /** The width-2 schedule. `N` and `S` above are the width-1 schedule; these replace them. */
  readonly w2: Width2;
  /**
   * The width-3 and width-4 schedules, keyed by width — M13 step 3. Keyed rather than named `w3`/
   * `w4` so {@link WIDE_WIDTHS} can be derived from `MAX_ISSUE_WIDTH` and the table checked for
   * completeness mechanically: raising the engine's bound must not be able to leave the widest
   * machine unpinned in silence (step 1's `halt-shadow.test.ts` precedent).
   */
  readonly wide: Readonly<Record<number, WideSchedule>>;
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
    /**
     * WIDTH 2. `(addi x1, addi x2)` pair — the second reads only x0, so no intra-pair RAW. `add`
     * follows alone. G = 2, Q = 1.
     * ON:  nothing blocks. L = 0 ⇒ cycles = 2 + 0 + 0 + 0 + 4 = **6**.
     * OFF: `add` reads x1 AND x2, both written by the pair at d = 1, so it interlocks until their
     *      WB: `d ≥ 1 + 3 = 4`. Two cycles blocked ⇒ cycles = 2 + 2 + 4 = **8**.
     * The teachable half: pairing bought 1 cycle with forwarding on and 1 with it off (9 → 8) —
     * the interlock eats most of what the second issue slot won.
     */
    w2: {
      groups: { off: 2, on: 2 },
      pairs: { off: 1, on: 1 },
      blocked: { off: 2, on: 0 },
      doomed: { off: 0, on: 0 },
      betting: { off: { groups: 0, pairs: 0 }, on: { groups: 0, pairs: 0 } }, // no transfers
    },
    /**
     * WIDTHS 3 AND 4 — identical to width 2 in every cell, and the reason is a DEPENDENCY rather
     * than a structural rule. `add@8` reads BOTH registers the group in front of it writes, so
     * `intra-pair-raw` refuses it from `{addi x1, addi x2}` at every width; a third and fourth slot
     * are offered the only instruction left and must refuse it. `{addi x1, addi x2}` / `{add}`.
     * G = 2, sizes {1: 1, 2: 1}, slots = 3 = 3 retires + 0 doomed. L = 0 on, 2 off (the interlock
     * holds `add` in slot 0 until both producers reach WB). cycles = 2 + L + 0 + 0 + 4.
     * No transfers, so `taken` is `base`.
     */
    wide: {
      3: {
        base: { groups: 2, sizes: { 1: 1, 2: 1 }, doomed: 0, blocked: { off: 2, on: 0 } },
        taken: { groups: 2, sizes: { 1: 1, 2: 1 }, doomed: 0, blocked: { off: 2, on: 0 } },
      },
      4: {
        base: { groups: 2, sizes: { 1: 1, 2: 1 }, doomed: 0, blocked: { off: 2, on: 0 } },
        taken: { groups: 2, sizes: { 1: 1, 2: 1 }, doomed: 0, blocked: { off: 2, on: 0 } },
      },
    },
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
    /**
     * WIDTH 2, ON. The partition, refusal by refusal:
     *   1 {lui@0}                — `addi@4` reads t0 the lui writes: INTRA-PAIR RAW.
     *   2 {addi@4, addi t1@8}    — pair.
     *   3 {addi a0@12, lw@16}    — pair (only one uses the mem port).
     *   4 ·                      — BLOCKED: `add@20` needs the lw's t2, one cycle away (load-use).
     *   5 {add@20, addi t0@24}
     *   6 {addi t1@28}           — `bne@32` reads the t1 it writes: INTRA-PAIR RAW.
     *   7 {bne@32, lui t3@36}    — pair; bne taken, so the lui is a doomed mate.
     * The loop period is 7 (d_lw 3 → 10 → 17 → 24 → 31): 4 groups + 1 blocked + 2 penalty. Five
     * iterations, four taken; the fifth bne falls through so its lui t3 mate SURVIVES at d = 35.
     * Epilogue: 36 {addi t3@40} (`sw` reads the t3 it writes), 37 {sw@44, addi a7@48}, 38 {ecall}.
     *   G = 6 + 4×4 + 3 = 25, Q = 13, L = 5 (one load-use per iteration).
     *   cycles = 25 + 5 + 8 + 0 + 4 = **42**.
     * OFF: the interlock costs the pair `(addi a0@12, lw@16)` — `lw` reads t0 written at d = 4 and
     *      must wait to 7, so it is refused for `raw` and issues alone. That is the one place in the
     *      corpus where the FORWARDING toggle changes the PARTITION: G = 26, Q = 12. L = 27
     *      (2 for the `la` addi, 1 for the lw's own slot-0 wait, then per iteration 2 for the `add`
     *      and 2 for the `bne`, plus 4 in the epilogue). cycles = 26 + 27 + 8 + 4 = **65**.
     * BETTING: 4 correct bets each kill a mate that was doomed anyway (Q −4, G unchanged). The 5th
     *      bne bets WRONG, so its lui t3 mate is on the correct path and must be re-issued — and it
     *      cannot re-pair, because `addi t3@40` reads the t3 it writes (INTRA-PAIR RAW). That costs
     *      a group: G +1, Q −1. Totals: G +1, Q −5.
     */
    w2: {
      groups: { off: 26, on: 25 },
      pairs: { off: 12, on: 13 },
      blocked: { off: 27, on: 5 },
      doomed: { off: 4, on: 4 },
      betting: { off: { groups: 1, pairs: -5 }, on: { groups: 1, pairs: -5 } },
    },
    /**
     * WIDTHS 3 AND 4 — **the fourth slot is offered eleven times and refused eleven times.**
     * Loop period 6 at BOTH widths, and the partition is byte-identical between them:
     *   `{lw@16}`                          — `add@20` reads the t2 it loads ⇒ intra-group RAW
     *   ·                                  — BLOCKED: load-use, the bubble no forward removes
     *   `{add@20, addi t0@24, addi t1@28}` — three abreast
     *   `{bne@32, lui t3@36}`              — `addi t3@40` reads the t3 the lui writes ⇒ intra RAW
     * Prologue `{lui@0}` / `{addi t0@4, addi t1@8, addi a0@12}`; five iterations, four taken (the
     * fifth `bne` falls through so its `lui t3` mate SURVIVES); epilogue `{addi t3@40}` /
     * `{sw@44, addi a7@48, ecall@52}`.
     *   G = 2 + 5×3 + 2 = 19, sizes {1: 7, 2: 5, 3: 7}, slots = 38 = 34 + 4 doomed.
     *   ON:  L = 5 (one load-use per iteration) ⇒ cycles = 19 + 5 + 8 + 0 + 4 = **36**.
     *   OFF: period stretches to 9 (4 blocked per iteration). L = 2 (the `la` addi) + 2 (the first
     *        `lw`'s own slot-0 wait) + 5×4 (each iteration's `add` and `bne`) + 2 + 2 (the
     *        epilogue's `addi t3` and `sw`) = **28**. That is ONE more than width 2's 27, and the
     *        extra cycle is the first `lw`'s wait: at width 2 it blocks once, at width 3 twice,
     *        because all three of its producers issued in a single group and so reach WB together.
     *        cycles = 19 + 28 + 8 + 0 + 4 = **59**.
     * At WIDTH 4 the ID stage holds four instructions on every group-forming cycle and the fourth is
     * refused every time — `lw@16` behind `addi t0@4`, `bne@32` behind `addi t1@28`, `sw@44` behind
     * `addi t3@40`, all `intra-pair-raw`. **Max group size is 3.** So "w3 = w4" here is not the
     * fourth slot going unoffered; it is the fourth slot being refused by the one rule the tier
     * exists to teach, and the histogram is what says which.
     * BETTING: the `bne` bets from slot 0, so `killedRest` kills `lui t3@36` in ID — period 6 → 5,
     *   doomed 4 → 0. The epilogue then costs an extra group after the fifth bne mispredicts:
     *   `{lui t3}` / `{addi t3}` / `{sw, addi a7, ecall}`, a three-deep dependent chain the extra
     *   slots cannot compress. G = 2 + 15 + 3 = 20 (delta **+1**), sizes {1: 13, 3: 7}, slots = 34.
     */
    wide: {
      3: {
        base: { groups: 19, sizes: { 1: 7, 2: 5, 3: 7 }, doomed: 4, blocked: { off: 28, on: 5 } },
        taken: { groups: 20, sizes: { 1: 13, 3: 7 }, doomed: 0, blocked: { off: 28, on: 5 } },
      },
      4: {
        base: { groups: 19, sizes: { 1: 7, 2: 5, 3: 7 }, doomed: 4, blocked: { off: 28, on: 5 } },
        taken: { groups: 20, sizes: { 1: 13, 3: 7 }, doomed: 0, blocked: { off: 28, on: 5 } },
      },
    },
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
    /**
     * WIDTH 2. The inner loop is `array-sum.s`'s, so it keeps that program's period exactly —
     * 7 cycles ON, 10 OFF. Per pass, ON:
     *   {addi a0@0, addi t3@4} | {lui@8} | {addi t0@12, addi t1@16}   — 3 groups (2 in pass 2:
     *   the outer target is `lui@8`, so the first group belongs to the prologue only)
     *   then 12 inner iterations of 4 groups + 1 blocked + 2 penalty, the 12th falling through so
     *   its `addi t3@40` mate survives, then {bne@44, addi a7@48}.
     *   Pass period = 129 (pass-1 lui at d = 2, pass-2 lui at d = 131). Pass 2's outer bne falls
     *   through at d = 257, its `addi a7@48` mate survives, `ecall` issues at 258.
     *   cycles = 258 + 4 = ... at width 2 ON the same walk gives d_last = 174 ⇒ **178**.
     *   G = 104, Q = 53, L = 24 (one load-use per inner iteration × 24).
     *   Cross-check on Q: G + Q = 157 slots consumed, of which 134 retire — the other 23 are the
     *   doomed mates of the 23 taken transfers, one each. That is an independent route to Q.
     * OFF: the partition is UNCHANGED here (unlike `array-sum.s`, the lw's slot-1 refusal is
     *      already an intra-pair RAW against `add@24`, so the interlock has nothing left to break):
     *      G = 104, Q = 53. L = 108 = 2 passes × 54. cycles = 104 + 108 + 46 + 4 = **262**.
     * BETTING: 23 correct bets (Q −23). Three WRONG bets: the two inner-loop exits (one per pass)
     *      kill `addi t3@40`, which cannot re-pair because `bne@44` reads the t3 it writes — G +1
     *      and Q −1 each. The outer-loop exit kills `addi a7@48`, which CAN re-pair with `ecall`,
     *      so it costs nothing. Totals: G +2, Q −25.
     */
    w2: {
      groups: { off: 104, on: 104 },
      pairs: { off: 53, on: 53 },
      blocked: { off: 108, on: 24 },
      doomed: { off: 23, on: 23 },
      betting: { off: { groups: 2, pairs: -25 }, on: { groups: 2, pairs: -25 } },
    },
    /**
     * WIDTHS 3 AND 4 — the inner loop is `array-sum.s`'s, so it keeps that program's period
     * exactly: 6 ON, 9 OFF, at both widths. The one genuinely new refusal is structural:
     *   `{bne@36, addi t3@40}` — `bne@44` is a SECOND TRANSFER ⇒ **BRANCH-SLOT**, refused in slot 2.
     * It fires 24 times, once per inner iteration, **and it fires at width 3 as well as width 4** —
     * the dump reports the refusal histogram at w2 and w4 only, so "0 → 24" is a w2→w4 comparison
     * and says nothing about w3. It is a free refusal (`bne@36` issued), so it costs no cycle.
     * The two passes PARTITION DIFFERENTLY, which is the thing to read twice: pass 1's `lui t0@8` is
     * pulled into the prologue group `{addi a0@0, addi t3@4, lui t0@8}`, while pass 2's is the outer
     * branch's TARGET and therefore leads a group of its own — `{lui t0@8}` / `{addi t0@12,
     * addi t1@16}`. Same group COUNT, different sizes, and only the histogram can see it.
     *   G = 2 (pass-1 header) + 2 (pass-2 header) + 24×3 + 2 (footers) = 78,
     *   sizes {1: 25, 2: 26, 3: 27}, slots = 158 = 134 + 24 doomed (22 taken inner `bne` × 1 mate,
     *   plus pass 1's taken outer `bne` × 2 mates — `addi a7@48` AND `ecall@52`, since the halt
     *   co-issues with the unresolved branch: exactly `a9f1b70`'s case, three times over).
     *   ON: L = 24 ⇒ cycles = 78 + 24 + 46 + 0 + 4 = **152**.
     *   OFF: L = 108 ⇒ cycles = 78 + 108 + 46 + 0 + 4 = **236**.
     * **Max group size 3 — the corpus's longest program never fills the fourth slot.**
     * BETTING: both `bne` flavours bet from slot 0 and kill what is behind them; inner period 6 → 5,
     *   doomed 24 → 0, and each pass's footer splits into `{addi t3@40}` / `{bne@44}` (intra-group
     *   RAW, then a bet) plus a final `{addi a7, ecall}` once pass 2's outer bne mispredicts.
     *   G = 81 (delta **+3**, against +2 at width 2), sizes {1: 53, 2: 3, 3: 25}, slots = 134.
     */
    wide: {
      3: {
        base: {
          groups: 78,
          sizes: { 1: 25, 2: 26, 3: 27 },
          doomed: 24,
          blocked: { off: 108, on: 24 },
        },
        taken: {
          groups: 81,
          sizes: { 1: 53, 2: 3, 3: 25 },
          doomed: 0,
          blocked: { off: 108, on: 24 },
        },
      },
      4: {
        base: {
          groups: 78,
          sizes: { 1: 25, 2: 26, 3: 27 },
          doomed: 24,
          blocked: { off: 108, on: 24 },
        },
        taken: {
          groups: 81,
          sizes: { 1: 53, 2: 3, 3: 25 },
          doomed: 0,
          blocked: { off: 108, on: 24 },
        },
      },
    },
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
    /**
     * WIDTH 2, ON. Every group is a pair, and both branches sit in slot 1 — which is why this is
     * the program that exercises the lane-aware squash without ever exercising bet-kills-mate.
     *   1 {addi t0@0, addi t1@4} | 2 {addi a0@8, blt@12} — blt TAKEN, mispredicts (2 lost) —
     *   5 {addi a1@20, bltu@24}  — bltu NOT taken, free — 6 {addi a1@28, addi a7@32} | 7 {ecall}
     *   G = 5, Q = 4, L = 0 ⇒ cycles = 5 + 0 + 2 + 0 + 4 = **11**.
     * OFF: `addi a0@8` reads the t0 written at d = 1 and must wait to 4, blocking cycles 2–3. The
     *      partition is unchanged (it is refused in SLOT 0, which delays without splitting a pair).
     *      L = 2 ⇒ cycles = 5 + 2 + 2 + 4 = **13**.
     * BETTING: both branches are the YOUNGER member of their pair, so killing "everything behind
     *      them in the group" kills nobody — G and Q are both unmoved. The bltu's wrong bet does
     *      kill the fall-through in IF, but it is re-fetched and re-pairs identically. This is the
     *      corpus's proof that the bet-kills-its-mate rule is about SLOT, not about branches.
     */
    w2: {
      groups: { off: 5, on: 5 },
      pairs: { off: 4, on: 4 },
      blocked: { off: 2, on: 0 },
      doomed: { off: 0, on: 0 },
      betting: { off: { groups: 0, pairs: 0 }, on: { groups: 0, pairs: 0 } },
    },
    /**
     * WIDTHS 3 AND 4 — **the program where `doomed` starts moving with the width.** `blt@12` issues
     * in SLOT 1 of its group at every width ≥ 2, and a taken transfer in slot `k` strands up to
     * `width − 1 − k` mates. So the group behind it grows and every new occupant dies in EX:
     *   w2 `{mv a0, blt}` ⇒ 0 doomed · w3 `{mv a0, blt, mv a0@16}` ⇒ 1 · w4 adds `mv a1@20` ⇒ 2.
     * This is the one corpus program that separates "the group got wider" from "the machine got
     * faster": both widths run 10 cycles, and the wider one issues MORE instructions to do it.
     *   w3: `{addi t0, addi t1}` / `{mv a0@8, blt@12, mv a0@16}` / (2 lost) /
     *       `{mv a1@20, bltu@24, mv a1@28}` / `{addi a7@32, ecall@36}`.
     *       G = 4, sizes {2: 2, 3: 2}, slots = 10 = 9 + 1 doomed.
     *   w4: `{addi t0, addi t1}` / `{mv a0, blt, mv a0@16, mv a1@20}` / (2 lost) /
     *       `{mv a1@20, bltu, mv a1@28, addi a7@32}` / `{ecall@36}`.
     *       G = 4, sizes {1: 1, 2: 1, 4: 2}, slots = 11 = 9 + 2 doomed. **A group of FOUR, twice —
     *       and it buys nothing**, because each four's extra occupant is either doomed or merely
     *       pulled one group earlier.
     *   L = 0 ON, 2 OFF (`mv a0@8` waits on `addi t0@0`'s write-back). P = 2.
     *   cycles = 4 + L + 2 + 0 + 4 ⇒ **10** ON, **12** OFF, at both widths.
     * BETTING: the bet ends the group (`killedRest`), so the shadow dies in ID BEFORE it consumes an
     *   issue slot — **doomed collapses to 0 at every width** and `slots` becomes exactly `retires`.
     *   `{addi t0, addi t1}` / `{mv a0, blt}` (correct bet) / `{mv a1@20, bltu}` (WRONG bet) /
     *   `{mv a1@28, addi a7, ecall}`. G = 4 (delta **+0**), sizes {2: 3, 3: 1}, slots = 9.
     *   P = 1·1 + 2·1 = 3 ⇒ cycles = **11** ON, **13** OFF. The second program after
     *   `paired-branches.s` where betting is a net LOSS at these widths, and here it loses even
     *   though the bet is RIGHT: the correct prediction costs a group it cannot earn back.
     */
    wide: {
      3: {
        base: { groups: 4, sizes: { 2: 2, 3: 2 }, doomed: 1, blocked: { off: 2, on: 0 } },
        taken: { groups: 4, sizes: { 2: 3, 3: 1 }, doomed: 0, blocked: { off: 2, on: 0 } },
      },
      4: {
        base: { groups: 4, sizes: { 1: 1, 2: 1, 4: 2 }, doomed: 2, blocked: { off: 2, on: 0 } },
        taken: { groups: 4, sizes: { 2: 3, 3: 1 }, doomed: 0, blocked: { off: 2, on: 0 } },
      },
    },
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
    /**
     * WIDTH 2 — the program where pairing almost never fires, and each refusal is a DIFFERENT rule.
     * That makes it the corpus's structural-hazard exhibit:
     *   1 {lui@0}          — `addi@4` reads the t0 it writes:        INTRA-PAIR RAW
     *   2 {addi@4}         — `lb@8` reads the t0 it writes:          INTRA-PAIR RAW
     *   3 {lb@8}           — `lbu@12` also wants the data port:      MEM-PORT
     *   4 {lbu@12, addi a7@16} — pair at last: only one memory op.
     *   5 {ecall@20}
     *   G = 5, Q = 1, L = 0 ⇒ cycles = 5 + 0 + 0 + 0 + 4 = **9**, against 10 at width 1.
     * Three refusals, one pair, and the whole gain is a single cycle — the honest picture of what a
     * second issue slot buys on dependent straight-line code.
     * OFF: the interlock adds 2 + 2 blocked cycles (the `la` addi, then the `lb` behind it) but
     *      splits no pair, since every refusal above is already a PAIRING rule and those do not
     *      consult the forwarding setting. L = 4 ⇒ cycles = 5 + 4 + 4 = **13**.
     */
    w2: {
      groups: { off: 5, on: 5 },
      pairs: { off: 1, on: 1 },
      blocked: { off: 4, on: 0 },
      doomed: { off: 0, on: 0 },
      betting: { off: { groups: 0, pairs: 0 }, on: { groups: 0, pairs: 0 } }, // no transfers
    },
    /**
     * WIDTHS 3 AND 4 — the three refusals are a CHAIN the extra slots cannot break, and each link
     * is a different rule: `intra-pair-raw`, `intra-pair-raw`, `mem-port`, in that order. So slots
     * 2 and 3 stay empty for three groups running and the entire gain is in the tail:
     *   `{lui@0}` / `{addi t0@4}` / `{lb@8}` / `{lbu@12, addi a7@16, ecall@20}`.
     *   G = 4, sizes {1: 3, 3: 1}, slots = 6 = 6 retires + 0 doomed. L = 0 ON, 4 OFF.
     *   cycles = 4 + L + 0 + 0 + 4 ⇒ **8** ON, **12** OFF (against 13 at width 2), both widths.
     * The tail group is 3 at width 4 as well — `ecall` is the last word of `.text`, so there is no
     * fourth instruction in existence to fetch. **A width-4 assertion here is measuring width 3**,
     * and the histogram is the only thing that says so; the equal cycle counts do not.
     * No transfers, so `taken` is `base`.
     */
    wide: {
      3: {
        base: { groups: 4, sizes: { 1: 3, 3: 1 }, doomed: 0, blocked: { off: 4, on: 0 } },
        taken: { groups: 4, sizes: { 1: 3, 3: 1 }, doomed: 0, blocked: { off: 4, on: 0 } },
      },
      4: {
        base: { groups: 4, sizes: { 1: 3, 3: 1 }, doomed: 0, blocked: { off: 4, on: 0 } },
        taken: { groups: 4, sizes: { 1: 3, 3: 1 }, doomed: 0, blocked: { off: 4, on: 0 } },
      },
    },
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
    /**
     * WIDTH 2, ON:
     *   1 {addi a0@0, addi a1@4} | 2 {jal@8, addi s0@12} — jal taken, the mate is doomed (2 lost) —
     *   5 {bge@24, addi a0@28}   — bge NOT taken, free —
     *   6 {jalr@32}              — alone: it is the LAST word of `.text`, so there is no mate to
     *                              fetch, let alone to pair with. Taken, unpredictable (2 lost) —
     *   9 {addi s0@12, addi a7@16} | 10 {ecall@20}
     *   G = 6, Q = 4, L = 0 ⇒ cycles = 6 + 0 + 4 + 0 + 4 = **14**.
     * OFF: `addi s0@12` reads the a0 written at d = 1 and must wait to 4, so it is refused from
     *      SLOT 1 for `raw` and the jal issues alone — Q = 3. But the refusal is FREE: the jal
     *      issued, so no cycle was lost, and the mate was doomed anyway. L = 0, G = 6, and the
     *      count is **14 in both positions** — this program's width-1 property ("forwarding is not
     *      free money") survives the widening, for a different reason at each width.
     *      It is also the corpus's clearest example of the width-2 split: a `stall` event fired and
     *      cost nothing.
     * BETTING: the jal bets correctly and kills its doomed mate ⇒ Q −1 with forwarding ON; with it
     *      OFF that mate had already been refused, so there is no pair left to lose ⇒ Q −0. The bge
     *      bets WRONG, killing `addi a0@28` — but that one re-pairs with `jalr@32` (one transfer
     *      between them, no shared register), so it costs neither a group nor a pair.
     */
    w2: {
      groups: { off: 6, on: 6 },
      pairs: { off: 3, on: 4 },
      blocked: { off: 0, on: 0 },
      doomed: { off: 0, on: 1 },
      betting: { off: { groups: 0, pairs: 0 }, on: { groups: 0, pairs: -1 } },
    },
    /**
     * WIDTHS 3 AND 4 — the same four groups at both, and **12 cycles in BOTH forwarding positions**:
     *   `{addi a0@0, addi a1@4, jal@8}` / (2 lost) / `{bge@24, mv a0@28}` (`jalr@32` is a second
     *   transfer ⇒ BRANCH-SLOT) / `{jalr@32}` / (2 lost) / `{mv s0@12, addi a7@16, ecall@20}`.
     *   G = 4, sizes {1: 1, 2: 1, 3: 2}, slots = 9 = 9 retires + **0 doomed**, L = 0, P = 4.
     *   cycles = 4 + 0 + 4 + 0 + 4 = **12**.
     * Three things worth stating, because each is a different mechanism reaching the same number:
     *   1. **`doomed` is 0 at every width, and for a NEW reason at width 4.** At w2 the `jal`'s
     *      would-be mate sat behind a group boundary; at w3 the `jal` is the last slot of its group;
     *      at w4 `mv s0@12` DOES sit behind it in ID and is refused for `intra-pair-raw`, because
     *      `addi a0@0` in the same group writes the `a0` that `mv s0, a0` reads. **The fall-through
     *      is spared by a dependency, not by geometry** — the one place in the corpus where a
     *      pairing rule accidentally protects an instruction from being stranded.
     *   2. `jalr@32` is refused for `branch-slot` at every width ≥ 2: it is adjacent to `bge@24`, and
     *      the single branch unit splits them however many slots exist.
     *   3. **"Forwarding is not free money" survives its third widening**, with a different reason at
     *      each: at w1 every RAW was already separated by a flush gap, at w2 the one refusal was free,
     *      and here the refusals are all pairing rules, which do not consult the toggle.
     * BETTING: `{addi a0, addi a1, jal}` (bet, correct) / `{bge}` (bet, WRONG — `killedRest` kills
     *   `mv a0@28` and `jalr@32` in ID) / `{mv a0@28, jalr@32}` / `{mv s0, addi a7, ecall}`.
     *   G = 4 (delta **+0**), sizes {1: 1, 2: 1, 3: 2}, slots = 9. P = 5 ⇒ cycles = **13** ON.
     *   The 12 → 13 regression M3 pinned at width 1 survives at 3 and 4 with forwarding ON.
     * **⚠ AND WITH FORWARDING OFF IT IS 14, NOT 13 — `L` = 1, and this cell is the one number in
     *   the whole step the hand-derivation got WRONG.** It was predicted 0 and measured 1; the
     *   engine is right and the reasoning was missing a stage. Read off the trace:
     *     base:  c1 `{addi a0, addi a1, jal}` · c2 jal TAKEN ⇒ squash · c3 idle · c4 `{bge, mv a0}`
     *     taken: c1 `{…, jal}` bets · c2 idle · c3 **STALL(raw)** · c4 `{bge}` bets
     *   Under the base behaviour the `jal`'s two-cycle MISPREDICTION PENALTY is exactly the gap the
     *   producers need to reach WB, so `bge` — which reads the `a0`/`a1` those two `addi`s write —
     *   never interlocks. The correct bet DELETES that gap, ID runs a cycle earlier, and it meets
     *   `addi a0`/`addi a1` still standing in EX/MEM. **So the bet buys 2 cycles of flush and
     *   immediately hands 1 back as a stall the flush had been hiding.**
     *   It is a WIDTH-3 effect, not a general one: at width 2 the `jal` sits in the second group
     *   (`{addi a0, addi a1}` / `{jal, mv s0}`), so it bets a cycle later and the producers are a
     *   stage further along — `w2.blocked` is 0 in both positions. **Widening the machine moved the
     *   bet one cycle earlier and exposed an interlock that had never fired.** The generalisable
     *   shape: a penalty and a stall can be covering for each other, and removing the penalty is
     *   what reveals the bill — which is why `L` had to be derived per width per SCHEME and not
     *   carried over, and why the prediction that carried it over is the one that failed.
     */
    wide: {
      3: {
        base: { groups: 4, sizes: { 1: 1, 2: 1, 3: 2 }, doomed: 0, blocked: { off: 0, on: 0 } },
        // ⚠ off: 1, not 0 — the correct bet exposes an interlock the flush gap was covering.
        taken: { groups: 4, sizes: { 1: 1, 2: 1, 3: 2 }, doomed: 0, blocked: { off: 1, on: 0 } },
      },
      4: {
        base: { groups: 4, sizes: { 1: 1, 2: 1, 3: 2 }, doomed: 0, blocked: { off: 0, on: 0 } },
        // ⚠ off: 1, not 0 — the correct bet exposes an interlock the flush gap was covering.
        taken: { groups: 4, sizes: { 1: 1, 2: 1, 3: 2 }, doomed: 0, blocked: { off: 1, on: 0 } },
      },
    },
  },

  /**
   * 5 retires, two never-taken branches back to back (M8 step 0) — the corpus's ONLY witness of the
   * `branch-slot` refusal, which is the whole reason this program was added.
   *    0 bne x0,x0,done   4 bne x0,x0,done   8 addi a0,x0,42   12 addi a7,x0,10   16 ecall
   * `done` = 12, never reached (both branches DECLINE: 0 != 0 is false). Every source is x0, so no
   * RAW ⇒ S = 0 both positions.
   *
   * OFF/ON, NOT-TAKEN (width 1): d = 1,2,3,4,5 → cycles = 5 + 4 = 9. STATIC-TAKEN: both branches
   * bet taken and both mispredict ⇒ P = 2·notTaken(2) = 4, cycles = 13.
   */
  'paired-branches.s': {
    retires: 5,
    // Two `bne x0, x0` — both DECLINE, neither a `jalr`. P: not-taken 0; taken 2·2 = 4.
    transfers: { takenPredictable: 0, notTaken: 2, takenUnpredictable: 0 },
    flushes: { branchTaken: 0, halt: 0 }, // nothing taken; `ecall` is the last word — no halt flush
    stalls: { off: {}, on: {} },
    misses: { small: 0, large: 0 }, // no loads or stores
    /**
     * WIDTH 2 — the `branch-slot` exhibit. The two `bne` are instructions 0 and 1, so they land in
     * ONE fetch group; the machine has a single branch unit, so the younger is refused for
     * `branch-slot`:
     *   1 {bne@0}            — `bne@4` is a second transfer ⇒ BRANCH-SLOT refusal (in SLOT 1, FREE).
     *   2 {bne@4, addi a0@8} — pair (only one of the two is a transfer).
     *   3 {addi a7@12, ecall@16} — pair.
     *   G = 3, Q = 2, L = 0 ⇒ cycles = 3 + 0 + 0 + 0 + 4 = **7**, against 9 at width 1.
     * The refusal is the slot-1 kind, so it costs nothing (L = 0) — it is exactly the free-refusal
     * the `S ≠ L` suite counts. OFF is IDENTICAL: no source but x0, so the interlock never fires and
     * the partition is unchanged. G = 3, Q = 2, L = 0 in both positions; doomed = 0 (nothing taken).
     * BETTING: under `static-taken` BOTH branches bet taken and BOTH mispredict, and each bet sets
     *   `killedRest` — squashing its would-be mate BEFORE the branch-slot rule can refuse it. So no
     *   branch pairs AND no branch is refused; each issues SOLO, its wrong-path mate re-fetched:
     *     {bne@0} | {bne@4} | {addi a0@8, addi a7@12} | {ecall@16} — G = 4, Q = 1.
     *   The second branch, which paired with `addi a0` under not-taken, now goes alone (−1 pair), and
     *   the tail re-packs so `ecall` gets its own trailing group (+1 group). Delta: G +1, Q −1, both
     *   positions. L stays 0 (betting REMOVED the only refusal), so P alone moves it:
     *   cycles = 4 + 0 + 4 + 0 + 4 = **12**.
     */
    w2: {
      groups: { off: 3, on: 3 },
      pairs: { off: 2, on: 2 },
      blocked: { off: 0, on: 0 },
      doomed: { off: 0, on: 0 },
      betting: { off: { groups: 1, pairs: -1 }, on: { groups: 1, pairs: -1 } },
    },
    /**
     * WIDTHS 3 AND 4 — **the flagged anomaly, 9 → 7 → 7 → 6, and it resolves into something better
     * than an arithmetic explanation.** Every source is x0, so L = 0 and the partition is identical
     * at both forwarding positions, at every width; P = 0 under the base behaviour. So `cycles =
     * G + 4` exactly, and the whole shape is a claim about the PARTITION.
     *   w3: `{bne@0}` / `{bne@4, addi a0@8, addi a7@12}` / `{ecall@16}` — G = 3, sizes {1: 2, 3: 1}.
     *   w4: `{bne@0}` / `{bne@4, addi a0@8, addi a7@12, ecall@16}`     — G = 2, sizes {1: 1, 4: 1}.
     *   slots = 5 = 5 retires + 0 doomed at both. cycles = **7** at w3, **6** at w4.
     * **THE FINDING.** w3 buys nothing over w2 — and NOT because the third slot goes unused. It
     * fills. G is 3 at both w2 and w3, but the partitions are different shapes: `{1, 2, 2}` against
     * `{1, 3, 1}`. The third slot pulls `addi a7@12` forward into the middle group and thereby
     * **pushes `ecall@16` out of the tail group into one of its own.** The widening moved work
     * between groups without reducing their number. A bare `G` comparison cannot see that, and the
     * cycle count reports it as "width 3 bought nothing" — true, and completely uninformative.
     * **The histogram is what shows the machine got wider and the schedule had nowhere to put it.**
     * The `branch-slot` refusal at slot 1 survives every width: two adjacent transfers can never
     * co-issue however many slots exist, so instruction 0 is alone in its group at w1/2/3/4 alike.
     * BETTING: both branches bet taken and both mispredict; each bet ends its group.
     *   w3: `{bne@0}` / (2) / `{bne@4}` / (2) / `{addi a0, addi a7, ecall}` — G = 3, delta **+0**.
     *   w4: the same three groups — G = 3, delta **+1** (the tail can no longer be one group of
     *       four, because the bets broke the stream into pieces that re-pack as 1 + 1 + 3).
     *   P = 2·2 = 4 ⇒ cycles = **11 at BOTH widths**. So the single cycle width 4 buys exists ONLY
     *   under the base behaviour: **the bet fragments the stream into groups too short to use the
     *   fourth slot**, and a scheme sold as a speedup is also what spends the width.
     */
    wide: {
      3: {
        base: { groups: 3, sizes: { 1: 2, 3: 1 }, doomed: 0, blocked: { off: 0, on: 0 } },
        taken: { groups: 3, sizes: { 1: 2, 3: 1 }, doomed: 0, blocked: { off: 0, on: 0 } },
      },
      4: {
        base: { groups: 2, sizes: { 1: 1, 4: 1 }, doomed: 0, blocked: { off: 0, on: 0 } },
        taken: { groups: 3, sizes: { 1: 2, 3: 1 }, doomed: 0, blocked: { off: 0, on: 0 } },
      },
    },
  },

  /**
   * 7 retires, no branches (M9 step 1b — a store immediately followed by a dependent load of the
   * SAME address, added for out-of-order memory disambiguation; this superscalar retires strictly
   * in order so the pairing/port rules below are the whole story, no disambiguation needed here).
   *    0 lui t0     4 addi t0,t0    8 addi t1,x0,99   12 sw t1,0(t0)
   *   16 lw a0,0(t0) 20 addi a7,x0,10  24 ecall
   *
   * WIDTH 2, both positions (the pairing partition itself does not depend on forwarding — only
   * WHICH cycles are free vs. blocked refusals does, exactly as `byte-loads.s`):
   *   1 {lui@0}                  — `addi t0@4` reads the t0 it writes: INTRA-PAIR RAW.
   *   2 {addi t0@4, addi t1@8}   — pair: `addi t1` reads only x0, no RAW on t0, neither is mem/branch.
   *   3 {sw@12}                  — `lw@16` also wants the data port: MEM-PORT (free refusal once sw
   *                                 issues; see below for why it costs 2 BLOCKED cycles under OFF).
   *   4 {lw@16, addi a7@20}      — pair: only one memory op, `addi a7` reads only x0.
   *   5 {ecall@24}               — alone, nothing left to pair with.
   *   G = 5, Q = 2, L = 0 ⇒ cycles = 5 + 0 + 0 + 0 + 4 = **9**.
   * OFF: the interlock adds 4 blocked cycles the pairing partition above does not touch — `sw@12`
   *      must wait for `addi t1@8`'s WB (2 cycles) before it can even be READ, and it is the whole
   *      group (slot 0), so both are BLOCKED, not free; `lw@16`'s own mem-port refusal stays free
   *      once `sw` finally issues (the same free-vs-blocked split `byte-loads.s` shows). L = 4 ⇒
   *      cycles = 5 + 4 + 0 + 0 + 4 = **13**.
   * No transfers ⇒ doomed and betting are all zero in both positions.
   */
  'store-forward.s': {
    retires: 7,
    transfers: { takenPredictable: 0, notTaken: 0, takenUnpredictable: 0 },
    flushes: { branchTaken: 0, halt: 0 }, // `ecall` is the last word of text — nothing behind it
    stalls: { off: { 4: 2, 12: 2 }, on: {} },
    // `sw` misses (no-write-allocate) and `lw` to the SAME never-before-touched address then
    // compulsory-misses too (and installs). 2 misses at both sizes.
    misses: { small: 2, large: 2 },
    w2: {
      groups: { off: 5, on: 5 },
      pairs: { off: 2, on: 2 },
      blocked: { off: 4, on: 0 },
      doomed: { off: 0, on: 0 },
      betting: { off: { groups: 0, pairs: 0 }, on: { groups: 0, pairs: 0 } }, // no transfers
    },
    /**
     * WIDTHS 3 AND 4 — identical at both, and the tail is again three instructions long:
     *   `{lui@0}` / `{addi t0@4, addi t1@8}` (`sw@12` reads BOTH ⇒ intra-group RAW) / `{sw@12}`
     *   (`lw@16` ⇒ mem-port) / `{lw@16, addi a7@20, ecall@24}`.
     *   G = 4, sizes {1: 2, 2: 1, 3: 1}, slots = 7 = 7 retires + 0 doomed. L = 0 ON, 4 OFF.
     *   cycles = **8** ON, **12** OFF (against 13 at width 2), at both widths.
     * Note this is the program whose `w3/nofwd/none/cache2` cell crashed the deliberately-broken
     * engine in step 2(b) — it is the corpus's multi-follower MEM freeze. The freeze emits no
     * `stall`, so its cycles are attributed to `M` and never to `L`, which is what keeps the L
     * column above cache-invariant. No transfers, so `taken` is `base`.
     */
    wide: {
      3: {
        base: { groups: 4, sizes: { 1: 2, 2: 1, 3: 1 }, doomed: 0, blocked: { off: 4, on: 0 } },
        taken: { groups: 4, sizes: { 1: 2, 2: 1, 3: 1 }, doomed: 0, blocked: { off: 4, on: 0 } },
      },
      4: {
        base: { groups: 4, sizes: { 1: 2, 2: 1, 3: 1 }, doomed: 0, blocked: { off: 4, on: 0 } },
        taken: { groups: 4, sizes: { 1: 2, 2: 1, 3: 1 }, doomed: 0, blocked: { off: 4, on: 0 } },
      },
    },
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
    /**
     * WIDTH 2 — the flagship A/B, and the one width-2 number the PLAN derived independently before
     * this step existed. Reproduced here from the rules rather than copied from it.
     *   1 {addi a0@0, addi t0@4}
     *   2 {add@8, addi t0@12}   — pair: `add` writes a0, `addi` reads t0. No intra-pair RAW.
     *   3 {bne@16, addi a7@20}  — pair: only one of the two is a transfer.
     *     bne taken, mispredicts ⇒ the target leaves ID at d_b + 3. **LOOP PERIOD = 4**:
     *     d_body = 4k + 2, d_bne = 4k + 3, k = 0..9.
     *   The tenth bne (d = 39) falls through, so its `addi a7@20` mate SURVIVES rather than being
     *   squashed, and `ecall` issues at d = 40. cycles = 40 + 4 = **44**.
     *   G = 1 + 10 + 10 + 1 = 22, Q = 21 (every group but `{ecall}` is a pair), L = 0.
     *   Check: 22 + 0 + 18 + 0 + 4 = 44 ✓, and it agrees with the plan's independent derivation.
     * OFF: the interlock splits no pair — both refusals are in slot 0 — but stretches the period
     *      from 4 to 6 (`add` waits 2 for the prologue, `bne` waits 2 for the `addi t0` ahead of
     *      it, every iteration). L = 4 + 9×2 = 22 ⇒ cycles = 22 + 22 + 18 + 4 = **66**.
     * BETTING: 9 correct bets kill 9 doomed mates ⇒ Q −9. The tenth bets WRONG and kills a LIVE
     *      `addi a7@20`, which is re-issued and re-pairs with `ecall` — so the group count is
     *      unmoved and the lost pair is handed straight back. Totals: G +0, Q −9.
     */
    w2: {
      groups: { off: 22, on: 22 },
      pairs: { off: 21, on: 21 },
      blocked: { off: 22, on: 0 },
      doomed: { off: 9, on: 9 },
      betting: { off: { groups: 0, pairs: -9 }, on: { groups: 0, pairs: -9 } },
    },
    /**
     * WIDTHS 3 AND 4 — **the loop the extra slots cannot help, and the fourth slot is never filled
     * at all.** The body is cut in two by a dependency no width can cross: `bne@16` reads the `t0`
     * that `addi t0@12` immediately in front of it writes, so `intra-pair-raw` refuses it from the
     * body group at w2, w3 and w4 alike. Two groups per iteration at EVERY width:
     *   `{add@8, addi t0@12}`               — `bne@16` refused, intra-group RAW
     *   `{bne@16, addi a7@20, ecall@24}`    — the halt CO-ISSUES with the unresolved branch, which
     *                                         is `a9f1b70`'s case reached nine times a run
     * Loop period 4 (2 groups + 2 penalty). Iteration 10 falls through.
     *   G = 1 + 2×10 = 21, sizes {2: 11, 3: 10}, slots = 52 = 34 + **18 doomed** (9 taken × the TWO
     *   mates stranded beside the branch — a count width 2 cannot produce, where it is 9 × 1).
     *   ON: L = 0 ⇒ cycles = 21 + 0 + 18 + 0 + 4 = **43**.
     *   OFF: L = 22 (2 for the prologue's `add`, 2 per iteration for the `bne`) ⇒ **65**.
     * The tail group is 3 at width 4 too — `ecall` is the last word of `.text`. **`sizes` has no
     * key 4 at width 4**, which is the dump's "nine of eleven are identical at 3 and 4" in its
     * purest form (nine of TWELVE since `nested-loop.s` landed — it is not one of the nine), and
     * the histogram proves it where the equal cycle counts merely suggest it.
     * BETTING: the `bne` bets from slot 0, so `killedRest` kills `addi a7` and `ecall` in ID — the
     *   bne group collapses 3 → 1 and **doomed goes 18 → 0**. The period drops 4 → 3, but the
     *   epilogue now needs a group of its own after the tenth bne mispredicts.
     *   G = 1 + 20 + 1 = 22, delta **+1** — against +0 at width 2, where `addi a7` re-paired with
     *   `ecall` and handed the group straight back. sizes {1: 10, 2: 12}, slots = 34.
     *   cycles ON = 22 + 0 + 11 + 0 + 4 = **37**; OFF = 22 + 22 + 11 + 0 + 4 = **59**.
     */
    wide: {
      3: {
        base: { groups: 21, sizes: { 2: 11, 3: 10 }, doomed: 18, blocked: { off: 22, on: 0 } },
        taken: { groups: 22, sizes: { 1: 10, 2: 12 }, doomed: 0, blocked: { off: 22, on: 0 } },
      },
      4: {
        base: { groups: 21, sizes: { 2: 11, 3: 10 }, doomed: 18, blocked: { off: 22, on: 0 } },
        taken: { groups: 22, sizes: { 1: 10, 2: 12 }, doomed: 0, blocked: { off: 22, on: 0 } },
      },
    },
  },

  /**
   * 4 prologue + 4 per iteration × 6 + 2 epilogue = 30 retires; `bnez` taken 5 times (M10 step 3 —
   * the slow-op witness; the `sll` is a single-cycle ALU op here). Same width-1 schedule as `sum-loop`
   * with a four-instruction body.
   *    0 addi t1,x0,6   4 addi a0,x0,0   8 addi t5,x0,3  12 addi t6,x0,2
   *   16 sll t3,t5,t6  20 add a0,a0,t3  24 addi t1,t1,-1 28 bne t1,x0,loop
   *   32 addi a7,x0,10 36 ecall
   *
   * WIDTH 2 — the one place this program's shape departs from `sum-loop`. The body's HEAD carries an
   * intra-pair RAW `sum-loop` does not have: `add@20` reads t3 from `sll@16` right in front of it, so
   * that pair is refused and the `sll` issues ALONE in slot 0 — every iteration, not just the first.
   *   1 {addi t1@0, addi a0@4}    2 {addi t5@8, addi t6@12}   — prologue, two clean pairs
   *   3 {sll@16}                  — REFUSED: `add@20` needs t3, so the shift issues single
   *   4 {add@20, addi t1@24}      — pair: `add` writes a0, `addi` reads t1, no intra-pair RAW
   *   5 {bne@28, addi a7@32}      — pair: `bne` taken, mispredicts ⇒ the fall-through `addi a7@32`
   *                                 mate is squashed (doomed) and fetch redirects to `sll@16`.
   *   Iterations 1–5 repeat groups 3–5 (each a single + two pairs, one mate doomed). Iteration 6's
   *   `bne` falls through, so its `addi a7@32` mate SURVIVES; then {ecall@36} issues alone.
   *   G = 2 (prologue) + 5×3 + 3 (iter 6) + 1 (ecall) = 21. Q = 2 + 5×2 + 2 = 14 (the seven singles
   *   are the six `sll`s and the lone `ecall`). L = 0. Check: 21 + 0 + 10 + 0 + 4 = 35 ✓.
   * OFF: the interlock splits no pair — every refusal is in slot 0 (the `sll` reads t5/t6, the `add`
   *      reads t3, the `bne` reads t1) — but blocks the whole group. Iteration 1's `sll` blocks 2
   *      (prologue t5/t6), every `add` blocks 2 (t3), every `bne` blocks 2 (t1): L = 2 + 6×2 + 6×2 =
   *      26 ⇒ cycles = 21 + 26 + 10 + 4 = 61.
   * BETTING: 5 correct taken bets each steer fetch to `sll@16` a cycle early, so the doomed
   *      `addi a7@32` mate is never fetched — each {bne, mate} pair becomes a {bne} single: Q −5,
   *      groups unmoved. The sixth bets WRONG (predicted taken, falls through) and kills the LIVE
   *      `addi a7@32`, which is re-issued after the redirect and re-pairs with `ecall` — group count
   *      unmoved, the lost pair handed straight back. Totals: G +0, Q −5.
   */
  'slow-op-loop.s': {
    retires: 30,
    transfers: { takenPredictable: 5, notTaken: 1, takenUnpredictable: 0 },
    flushes: { branchTaken: 5, halt: 0 },
    stalls: { off: { 16: 2, 20: 12, 28: 12 }, on: {} },
    misses: { small: 0, large: 0 }, // register-only shift-accumulate loop
    w2: {
      groups: { off: 21, on: 21 },
      pairs: { off: 14, on: 14 },
      blocked: { off: 26, on: 0 },
      doomed: { off: 5, on: 5 },
      betting: { off: { groups: 0, pairs: -5 }, on: { groups: 0, pairs: -5 } },
    },
    /**
     * WIDTHS 3 AND 4 — **one of only two programs that gain anything at width 4, and the gain is
     * entirely a PROLOGUE effect.** The body has two intra-group RAWs in series (`add@20` reads the
     * t3 `sll@16` writes; `bne@28` reads the t1 `addi t1@24` writes), so it is three groups per
     * iteration at every width ≥ 2 and the loop period is 5 at BOTH w3 and w4:
     *   `{sll@16}` / `{add@20, addi t1@24}` / `{bne@28, addi a7@32, ecall@36}`.
     * What differs is the prologue's four independent `li`s:
     *   w3: `{addi t1@0, addi a0@4, addi t5@8}` / `{addi t6@12}` — TWO groups.
     *       G = 2 + 3×6 = 20, sizes {1: 7, 2: 6, 3: 7}.
     *   w4: `{addi t1@0, addi a0@4, addi t5@8, addi t6@12}`      — ONE group of four.
     *       G = 1 + 3×6 = 19, sizes {1: 6, 2: 6, 3: 6, 4: 1}.
     *   slots = 40 = 30 + 10 doomed (5 taken × 2 mates) at both. L = 0 ON, 26 OFF at both.
     *   cycles ON = **34** at w3 and **33** at w4; OFF = **60** and **59**.
     * **THE FINDING.** The loop body runs six times and is byte-identical at both widths; the size-4
     * group occurs exactly ONCE in the whole run. That is precisely why the gain is 1 cycle and not
     * 6, and it is the cleanest statement of the width axis's honest lesson: **the fourth slot pays
     * only where the code has four independent instructions in a row, and real loop bodies do not.**
     * A test that read the cycle delta alone would report "width 4 is 3% faster" and hide where.
     * BETTING: the `bne` bets from slot 0 and kills `addi a7`/`ecall` in ID — the bne group goes
     *   3 → 1, doomed 10 → 0, period 5 → 4, and the epilogue costs a group after the sixth bne
     *   mispredicts. G = 21 at w3 (sizes {1: 13, 2: 7, 3: 1}) and 20 at w4 (sizes {1: 12, 2: 7,
     *   4: 1}), slots = 30. Delta **+1** at both widths, against +0 at width 2.
     *   cycles ON = **32** / **31**; OFF = **58** / **57**.
     */
    wide: {
      3: {
        base: { groups: 20, sizes: { 1: 7, 2: 6, 3: 7 }, doomed: 10, blocked: { off: 26, on: 0 } },
        taken: {
          groups: 21,
          sizes: { 1: 13, 2: 7, 3: 1 },
          doomed: 0,
          blocked: { off: 26, on: 0 },
        },
      },
      4: {
        base: {
          groups: 19,
          sizes: { 1: 6, 2: 6, 3: 6, 4: 1 },
          doomed: 10,
          blocked: { off: 26, on: 0 },
        },
        taken: {
          groups: 20,
          sizes: { 1: 12, 2: 7, 4: 1 },
          doomed: 0,
          blocked: { off: 26, on: 0 },
        },
      },
    },
  },

  /**
   * `array-sum`'s TWIN (M10 step 4). Byte-for-byte the same instruction stream — only the pointer
   * bump immediate (`addi t0,t0,16` vs `,4`) and the `.data` values differ, neither of which touches
   * the pairing partition or any stall. So every field EXCEPT `misses` is copied from `array-sum`
   * verbatim, including the whole width-2 derivation below; only the miss stream changes.
   *    0 lui t0        4 addi t0,t0     8 addi t1,x0,5    12 addi a0,x0,0
   *   16 lw t2,0(t0)  20 add a0,a0,t2  24 addi t0,t0,16   28 addi t1,t1,-1   32 bne t1,x0,loop
   *   36 lui t3       40 addi t3,t3    44 sw a0,0(t3)     48 addi a7,x0,10    52 ecall
   *
   * OFF: S = 26 (`la` addi@4 = 2; per iter `add`@20 = 2 and `bne`@32 = 2, ×5 = 20; epilogue `la`
   *      addi@40 = 2 and `sw`@44 = 2). ON: only the load-use survives ⇒ S = 5.
   *
   * WIDTH 2 — identical to `array-sum` (the partition is dependency-shaped, cache-blind):
   *   1 {lui@0}                — `addi@4` reads t0 the lui writes: INTRA-PAIR RAW.
   *   2 {addi@4, addi t1@8}    3 {addi a0@12, lw@16}   4 · (BLOCKED: `add@20` needs the lw's t2)
   *   5 {add@20, addi t0@24}   6 {addi t1@28}          7 {bne@32, lui t3@36}  (bne taken ⇒ lui doomed)
   *   Period 7 = 4 groups + 1 blocked + 2 penalty; five iterations, four taken; the fifth bne falls
   *   through so its lui t3 mate SURVIVES. Epilogue: 36 {addi t3@40}, 37 {sw@44, addi a7@48},
   *   38 {ecall}. G = 6 + 4×4 + 3 = 25, Q = 13, L = 5. cycles(on,off-cache) = 25 + 5 + 8 + 0 + 4 = 42.
   * OFF: the interlock refuses `(addi a0@12, lw@16)` (the lw waits on t0@4) so the lw issues alone —
   *      the one place forwarding moves the PARTITION: G = 26, Q = 12, L = 27. cycles = 26+27+8+4 = 65.
   * BETTING: 4 correct bets kill mates doomed anyway (Q −4); the 5th bets wrong so its lui t3 mate is
   *      re-issued and cannot re-pair (`addi t3@40` reads the t3 it writes) ⇒ G +1, Q −1. Totals G +1, Q −5.
   */
  'strided-sum.s': {
    retires: 34,
    transfers: { takenPredictable: 4, notTaken: 1, takenUnpredictable: 0 },
    flushes: { branchTaken: 4, halt: 0 },
    stalls: { off: { 4: 2, 20: 10, 32: 10, 40: 2, 44: 2 }, on: { 20: 5 } },
    // The MISS-STREAM: stride = one line ⇒ each of the five `lw`s misses a fresh block, and the `sw`
    // to `total` misses a sixth. Nothing is re-read ⇒ every miss compulsory ⇒ 6 at BOTH sizes.
    misses: { small: 6, large: 6 },
    w2: {
      groups: { off: 26, on: 25 },
      pairs: { off: 12, on: 13 },
      blocked: { off: 27, on: 5 },
      doomed: { off: 4, on: 4 },
      betting: { off: { groups: 1, pairs: -5 }, on: { groups: 1, pairs: -5 } },
    },
    /**
     * WIDTHS 3 AND 4 — **a COPY of `array-sum.s`, and the copy is argued rather than assumed.** The
     * two programs are byte-for-byte the same instruction stream; the only differences are the
     * pointer bump immediate (`,16` against `,4`) and the `.data` values. Neither appears in any
     * pairing rule, any hazard test, or any transfer outcome — an immediate is not a register and a
     * datum is not an address the issue logic can see. So every G, every histogram, every L and
     * every doomed count is identical to `array-sum.s` at both widths and both positions, and only
     * `misses` differs (6 at both sizes against 2), which is a separate term.
     * This is the one `wide` entry in the table that is a copy; it is spelled out because a copy
     * whose justification is left implicit is indistinguishable from a number nobody derived.
     */
    wide: {
      3: {
        base: { groups: 19, sizes: { 1: 7, 2: 5, 3: 7 }, doomed: 4, blocked: { off: 28, on: 5 } },
        taken: { groups: 20, sizes: { 1: 13, 3: 7 }, doomed: 0, blocked: { off: 28, on: 5 } },
      },
      4: {
        base: { groups: 19, sizes: { 1: 7, 2: 5, 3: 7 }, doomed: 4, blocked: { off: 28, on: 5 } },
        taken: { groups: 20, sizes: { 1: 13, 3: 7 }, doomed: 0, blocked: { off: 28, on: 5 } },
      },
    },
  },

  /**
   * The corpus's RE-ENTERED loop — 4 outer passes over a 6-iteration inner loop, written for the
   * dynamic-branch-prediction plan (step 0b). 2 prologue + 4 × (2 header + 6 × 3 inner + 2 footer)
   * + 2 epilogue = 92 retires; 24 inner iterations, no memory touched at all.
   *    0 addi a0,x0,0   4 addi t2,x0,4
   *    8 bne x0,x0,done ← the guard that never fires, once per pass   12 addi t1,x0,6
   *   16 addi t1,t1,-1  20 addi a0,a0,1  24 bne t1,x0,inner
   *   28 addi t2,t2,-1 32 bne t2,x0,outer   36 addi a7,x0,10  40 ecall
   *
   * OFF: `addi t1`@16 on the `li t1` right before it ⇒ 2, first iteration of each pass only, ×4 = 8.
   *      `bne`@24 reads that same `addi t1` two ahead of it — the DISTANCE-2 branch-operand RAW ⇒ 1,
   *      every iteration, ×24 = 24. Outer `bne`@32 has no such gap ⇒ 2, ×4 = 8. S = 40.
   * ON:  no loads anywhere ⇒ S = 0.
   *
   * ⚠ **PROVENANCE — this row is weaker than the header's claim, and says so.** The file's header
   * promises every number was hand-derived before being compared to the engine. Every cell below
   * WAS hand-derived, group by group from the pinned pairing rules — but not BLIND: the program's
   * layout had to be screened against a trace dump first, because two of its candidate layouts made
   * the stall histogram move with the prediction scheme (see the `.s` docblock), which this table's
   * one-histogram-per-position shape cannot express. So the dump was read before the derivation,
   * and a derivation that agrees with a number already seen is a weaker check than one that
   * predicts it. The derivation is still independent in the way that matters — it walks the
   * partition rather than reading `G` off the trace — and it did catch its own arithmetic twice.
   */
  'nested-loop.s': {
    retires: 92,
    // `bne t1`@24 goes 5 times per pass and declines on the 6th (20 taken, 4 declined); `bne t2`@32
    // goes 3 times and declines once; `bne x0,x0`@8 NEVER goes, once per pass. No `jalr`.
    // P: not-taken 2·23 = 46; taken 23·1 + 9·2 = 41.
    transfers: { takenPredictable: 23, notTaken: 9, takenUnpredictable: 0 },
    flushes: { branchTaken: 23, halt: 0 },
    stalls: { off: { 16: 8, 24: 24, 32: 8 }, on: {} },
    misses: { small: 0, large: 0 }, // register-only counter
    /**
     * WIDTH 2 — **the program where pairing makes the interlock WORSE, and still wins.** The
     * partition is the same in both positions, which no other program in the table manages:
     *   1 {addi a0@0, addi t2@4}
     *   2 {bne@8, addi t1@12}    — one transfer, and the guard declines: nothing is killed.
     *   3 {addi t1@16, addi a0@20}  — `bne@24` reads the t1 @16 writes: INTRA-PAIR RAW.
     *   4 {bne@24, addi t2@28}   — taken, mispredicts ⇒ the target leaves ID at d_b + 3, and @28 is
     *                              stranded. **INNER PERIOD = 4** (2 groups + 2 penalty).
     *   The sixth `bne` declines, so @28 survives and the footer is {bne@32, addi a7@36} — taken on
     *   passes 1–3 (stranding @36), declining on pass 4 so `ecall` gets a group of its own.
     *   G = 1 + 4×14 + 1 = **58**, Q = 57 (every group but `{ecall}` is a pair).
     *   doomed = 20 (@28) + 3 (@36) = 23, and G + Q = 115 = 92 + 23 ✓.
     *   ON: L = 0 ⇒ cycles = 58 + 0 + 46 + 0 + 4 = **108**, against 142 at width 1.
     * OFF: the partition does NOT change — but `L = 64` where the width-1 machine's `S` is only 40,
     *      and the extra 24 are the whole point. @16 and @20 now issue in the SAME cycle, so
     *      `bne@24` is one GROUP behind its producer rather than two instructions behind, and its
     *      distance-2 interlock costs 2 cycles a lap instead of 1. **Pairing tightened the
     *      interlock.** It still wins: 58 + 64 + 46 + 4 = **172** against 182.
     * BETTING: the guard @8 bets from slot 0 and is WRONG every pass — it kills @12, which re-issues
     *      alone (its consumer @16 cannot pair with it) and pushes @16/@20 into a group of their
     *      own: G +2, Q −1 per pass before the loop is even reached. Inside the loop each of the 24
     *      `bne@24` bets kills @28, collapsing the tail group to a single: Q −6 per pass. The three
     *      correct footer bets kill @36; pass 4's wrong one hands @36 back, re-paired with `ecall`.
     *      Totals: **G +8, Q −31** ⇒ cycles ON = 66 + 0 + 41 + 4 = **111**. Betting is a LOSS at
     *      width 2 here (111 against 108) where it was a win at width 1 (137 against 142) — the
     *      corpus's clearest case of a scheme whose sign flips with width.
     */
    w2: {
      groups: { off: 58, on: 58 },
      pairs: { off: 57, on: 57 },
      blocked: { off: 64, on: 0 },
      doomed: { off: 23, on: 23 },
      betting: { off: { groups: 8, pairs: -31 }, on: { groups: 8, pairs: -31 } },
    },
    /**
     * WIDTHS 3 AND 4 — the extra slots buy 1 cycle and 2, and the histogram says exactly why.
     * The inner loop is cut in two at EVERY width by a dependency no width can cross: `bne@24`
     * reads the t1 that `addi t1@16` writes, so `intra-pair-raw` refuses it from the body group,
     * and `bne@32` behind it is refused for `branch-slot`. Two groups a lap, for ever.
     *   W3 base: prologue {@0,@4,@8} = 3 — the guard rides along, and it declines. Then {@12} alone
     *     (@16 reads the t1 it writes), then per iteration {@16,@20} and {@24,@28}, then the footer
     *     {@32,@36,@40} — the halt CO-ISSUING with an unresolved branch, three times fatally.
     *     Passes 2–4 enter AT @8, so their header is {@8,@12} rather than a 3 and a 1.
     *     G = 15 + 3×14 = **57**, sizes {1: 1, 2: 51, 3: 5}, slots = 118 = 92 + **26 doomed** (20 ×
     *     @28, plus 3 × the TWO mates @36/@40 stranded beside the outer branch).
     *     ON: cycles = 57 + 0 + 46 + 0 + 4 = **107**.
     *   W4 base: the prologue takes {@0,@4,@8,@12} — **the corpus's only group of four that is not
     *     a tail**, and this program's sole reason to appear in the fills-four list. Everything else
     *     is width 3's shape. G = **56**, sizes {2: 51, 3: 4, 4: 1} ⇒ cycles = **106**.
     *   BETTING, and it is the SAME cell at both widths: the guard bets from slot 2 of the width-3
     *     prologue and so kills nothing, but from slot 2 of the width-4 one it kills @12 — which is
     *     why the group of four disappears the moment betting is on, and why width 4's `taken` cell
     *     is identical to width 3's. Every later group is cut to a single by a bet or an intra-pair
     *     refusal. G = **65**, sizes {1: 39, 2: 25, 3: 1}, doomed **0**, cycles ON = **110**.
     *     So at widths 3 and 4 the taken scheme loses by 3 and 4 — the same sign flip as width 2.
     * `blocked` is 64 in every one of these cells, base and betting alike, exactly as at width 2:
     * the extra slots re-partition the groups but never move a producer relative to its consumer.
     */
    wide: {
      3: {
        base: { groups: 57, sizes: { 1: 1, 2: 51, 3: 5 }, doomed: 26, blocked: { off: 64, on: 0 } },
        taken: {
          groups: 65,
          sizes: { 1: 39, 2: 25, 3: 1 },
          doomed: 0,
          blocked: { off: 64, on: 0 },
        },
      },
      4: {
        base: { groups: 56, sizes: { 2: 51, 3: 4, 4: 1 }, doomed: 26, blocked: { off: 64, on: 0 } },
        taken: {
          groups: 65,
          sizes: { 1: 39, 2: 25, 3: 1 },
          doomed: 0,
          blocked: { off: 64, on: 0 },
        },
      },
    },
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

// =================================================================================================
// WIDTH 2 — the derived timing matrix (M7 step 4)
// =================================================================================================

/**
 * **THE net for the whole milestone.** Everything above proves the width-1 machine is M3's. Nothing
 * above says anything about pairing, because a width-1 superscalar never pairs — and `differential`
 * says nothing either, because an in-order superscalar retires in order, so final architectural
 * state is identical at both widths BY CONSTRUCTION. Timing is the entire content of this tier, and
 * there is no golden reference for it. A consistent one-bubble bug in the issue logic is invisible
 * to every other suite in the package. This is where it is caught, or nowhere.
 *
 * ## The closed form
 *
 * `cycles = d_last + 4` is WIDTH-INVARIANT — the `+4` is pipeline depth (the leading fetch cycle
 * plus the EX/MEM/WB drain), not a function of how many instructions travel abreast. So width
 * changes exactly one thing: **when each instruction leaves ID**. Every cycle up to `d_last` is
 * either an issue cycle or a lost one, which gives
 *
 * > **cycles = G + L + P + M + 4**
 * >
 * > G = issue-group cycles (ID dispatched ≥ 1), L = blocking stalls, P = the speculation penalty,
 * > M = misses × missPenalty.
 *
 * At width 1, `G = N` (one instruction per group) and `L = S` (every stall costs a cycle), so this
 * **reduces to M3's `N + 4 + S + P + M`** — asserted below rather than asserted by hand-waving.
 *
 * ## The one genuinely new fact: `S` splits, and half of it is free
 *
 * At width 1 a `stall` event is always one lost cycle. At width 2 it is not. A refusal in SLOT 1
 * leaves slot 0 issuing, so the group merely ends early and **nothing is lost** — `call-return.s`
 * with forwarding off fires such a refusal and runs at exactly the same 14 cycles as with it on.
 * Only a SLOT-0 refusal costs a cycle. That is why the term is `L` (blocking stalls) and not `S`,
 * and it is measured here as "a stall event fired AND nothing issued", never as a residual.
 *
 * ## Which terms move with which axis, and why
 *
 * - **`P` is width-invariant**, so `penaltyOf` carries over unchanged. A mispredict still costs 2:
 *   the redirect is clocked at the end of EX either way. A correct bet still costs 1: the branch
 *   kills what is behind it, so ID has nothing the next cycle whatever the width.
 * - **`M` is width-invariant**: the mem-port rule keeps MEM single-lane, so the address stream and
 *   therefore the miss count are exactly the width-1 ones.
 * - **`L` is prediction- and cache-invariant.** A miss freezes IF/ID/EX/MEM *together*, so the
 *   distance between a waiting consumer and its producer is preserved across the freeze; and the
 *   freeze emits no `stall` event at all (it returns before hazard detection), so its cycles are
 *   attributed to `M` and never to `L`. Only FORWARDING moves `L`.
 * - **`G` and `Q` move with forwarding and with betting** — see below. This was NOT predicted by
 *   the plan, and is the step's finding.
 *
 * ## The bet-kills-its-mate rule (why `'static-taken'` needs its own column)
 *
 * A branch that bets sets `killedRest`: everything behind it in the forming group dies unissued.
 * So **every bet placed from slot 0 with a live mate costs a pair**, and:
 *
 * - a CORRECT bet kills a mate that was doomed anyway ⇒ `Q −1`, `G` unchanged;
 * - a WRONG bet kills a mate on the CORRECT path, which is re-fetched and re-issued ⇒ `Q −1`, and
 *   `G +1` **iff that mate cannot re-pair with its new neighbour**. Whether it can is decided by
 *   the ordinary pinned pairing rules: `array-sum.s`'s `lui t3` cannot (its neighbour reads the t3
 *   it writes — intra-pair RAW), so it costs a group; `sum-loop.s`'s `addi a7` re-pairs with
 *   `ecall` and costs nothing.
 * - a bet placed from SLOT 1 has nothing behind it in the group and costs neither
 *   (`branch-flavors.s`, where both branches sit in slot 1).
 *
 * ## What a green here is worth, stated exactly
 *
 * Anchored OUTSIDE this engine: the width-1 column (M3's hand-derived numbers), `P` (`penaltyOf`),
 * `M` (the miss table), and **`sum-loop.s = 44`, which the PLAN derived independently before this
 * suite existed** — the one deep external check on the pairing concept itself, and it holds.
 * Internal-consistency only: the width-2 `G`/`Q` for the other six programs. Those were derived
 * from the pinned rules by the loop-period method above, and the derivation was validated by
 * predicting all seven FORWARDING-OFF counts — which had no pin to copy — before running the
 * engine. That proves the hand-model faithfully describes the machine; it is not independent proof
 * the machine is right, and this suite does not claim to be.
 *
 * **Finding: no derived number disagreed with a step-2b pin.** All six provisional width-2 counts
 * are confirmed, by a route (loop periods + the pinned pairing rules) genuinely distinct from the
 * engine output they were copied from. A disagreement was possible, not mandatory.
 */

/** The width-2 positions, mirroring `CONFIG` above. Width is stated, never left to the default. */
const CONFIG_W2: Record<Position, ProcessorConfig> = {
  off: { ...OFF, issueWidth: 2 },
  on: { ...ON, issueWidth: 2 },
};

/**
 * The issue schedule, read off `location`: how many instructions moved `ID.*` → `EX.*` in each
 * cycle. This is the only observable that distinguishes a group from a pair, and it is what makes
 * every width-2 term measurable independently instead of by subtraction.
 *
 * **`width` is a PARAMETER as of M13 step 3, and the `2` it replaced was this suite's own vacuity
 * trap.** The loop bound was `s < 2` from M7 step 4 — correct while two slots were all there were,
 * and silently wrong the moment the guard opened: every group of 3 or 4 would have read as at most
 * 2, so `G` would come out too high, the histogram would report width-2 shapes for ever, and every
 * width-3/4 cell derived against it would have been fitted to a broken measurement. Note what would
 * NOT have caught it: step 1's audit swept for literal slot indexing (`idEx[0|1]`, `exMem[…]`) and
 * came back empty — this arity is a loop bound over a TEMPLATE STRING, which that sweep cannot
 * match. It was watched failing (one width-3 cell, `2` restored ⇒ red) before any number below was
 * trusted.
 *
 * The width is the one the CALLER asked for, deliberately not `micro.width` read back off the
 * trace. The two differ only if the engine ran narrower than it claimed — and in that case scanning
 * the requested width over-scans empty slots (harmless), while trusting the engine's own claim
 * would under-scan and hide exactly that bug.
 */
function issuedPerCycle(ts: CycleTrace[], width: number): number[] {
  const counts: number[] = [];
  for (let c = 0; c < ts.length - 1; c++) {
    let n = 0;
    for (let s = 0; s < width; s++) {
      const inId = ts[c]!.instructions.find((i) => i.location === `ID.${s}`);
      if (
        inId &&
        ts[c + 1]!.instructions.some((i) => i.id === inId.id && i.location.startsWith('EX.'))
      ) {
        n++;
      }
    }
    counts.push(n);
  }
  return counts;
}

/** What one run's issue schedule looks like, term by term. See {@link measure}. */
interface Measured {
  /** `G` — issue-group cycles: cycles in which ID dispatched at least one instruction. */
  readonly G: number;
  /** `Q` — cycles that issued exactly TWO. The width-2 spelling of `sizes[2]`, kept by name. */
  readonly Q: number;
  /** `L` — blocking stalls: a stall fired AND nothing issued. */
  readonly L: number;
  /** A stall fired and something issued anyway — the refusal that costs no cycle. */
  readonly freeRefusals: number;
  /**
   * The ISSUE-SIZE HISTOGRAM, `sizes[k]` = cycles that dispatched exactly `k`, `k = 0..width`. This
   * is what `Q` becomes at width > 2, and it is the term that answers the plan's "a width-4
   * assertion that does not first CHECK the group size it claims to exercise is measuring width 3".
   */
  readonly sizes: readonly number[];
  /** `Σ k · sizes[k]` — issue slots actually consumed. Feeds the accounting identity. */
  readonly slots: number;
}

/**
 * The measured terms. `L` is counted DIRECTLY — "a stall event fired and nothing issued" — and
 * never as `cycles − G − P − M − 4`. A residual would make the closed-form assertion below
 * `0 === 0`, which passes for any engine whatsoever; that is the one mistake this suite cannot
 * afford to make, since it is the milestone's only real net.
 */
function measure(ts: CycleTrace[], width: number): Measured {
  const issued = issuedPerCycle(ts, width);
  const sizes = new Array<number>(width + 1).fill(0);
  let G = 0;
  let L = 0;
  let freeRefusals = 0;
  issued.forEach((n, c) => {
    const stalled = ts[c]!.events.some((e) => e.type === 'stall');
    sizes[n] = (sizes[n] ?? 0) + 1;
    if (n > 0) G++;
    if (stalled && n === 0) L++;
    if (stalled && n > 0) freeRefusals++;
  });
  const slots = sizes.reduce((sum, count, k) => sum + k * count, 0);
  return { G, Q: sizes[2] ?? 0, L, freeRefusals, sizes, slots };
}

/** `G` and `Q` under a scheme, applying the bet-kills-its-mate deltas. */
const groupsUnder = (p: Timing, pos: Position, scheme: Scheme): number =>
  p.w2.groups[pos] + (scheme === 'static-taken' ? p.w2.betting[pos].groups : 0);
const pairsUnder = (p: Timing, pos: Position, scheme: Scheme): number =>
  p.w2.pairs[pos] + (scheme === 'static-taken' ? p.w2.betting[pos].pairs : 0);

describe('width 2 — the derived schedule (G, Q, L), against the base prediction behaviour', () => {
  it.each(CASES)('$file [forwarding $position]', ({ file, position }) => {
    const pinned = TIMING[file]!;
    const m = measure(run(file, CONFIG_W2[position]), 2);

    // Each term separately, so a failure names which one moved. A single opaque total would let a
    // compensating pair of errors — one group too many, one blocked cycle too few — pass silently.
    expect(m.G, 'G — issue-group cycles').toBe(pinned.w2.groups[position]);
    expect(m.Q, 'Q — cycles that issued TWO').toBe(pinned.w2.pairs[position]);
    expect(m.L, 'L — blocking stalls (slot 0 refused, nothing issued)').toBe(
      pinned.w2.blocked[position],
    );

    // ...and the closed form, from the pinned terms rather than the measured ones — otherwise this
    // line would be an identity rather than a claim.
    const P = penaltyOf(pinned.transfers, 'static-not-taken');
    expect(run(file, CONFIG_W2[position])).toHaveLength(
      pinned.w2.groups[position] + pinned.w2.blocked[position] + P + 0 + 4,
    );
  });

  it.each(CASES)('$file [forwarding $position]: G + Q = retires + doomed', ({ file, position }) => {
    // An INDEPENDENT route to Q: every group consumes one slot plus one more if it paired, and
    // every instruction that consumes a slot either retires or is a DOOMED mate — issued beside a
    // taken transfer and squashed in EX. Both sides are measured from the trace, so this closes the
    // accounting without using G or Q's pinned values at all.
    const pinned = TIMING[file]!;
    const ts = run(file, CONFIG_W2[position]);
    const m = measure(ts, 2);

    const retired = new Set(eventsOf(ts, 'instr-retire').map((e) => e.instr));
    const issuedIds = new Set(
      ts.flatMap((t) =>
        t.instructions.filter((i) => i.location.startsWith('EX.')).map((i) => i.id),
      ),
    );
    const doomed = [...issuedIds].filter((id) => !retired.has(id)).length;

    expect(retired.size, 'N').toBe(pinned.retires);
    expect(doomed, 'doomed mates').toBe(pinned.w2.doomed[position]);
    expect(m.G + m.Q, 'slots consumed').toBe(pinned.retires + doomed);
  });

  /**
   * **A taken transfer does NOT always strand a doomed mate**, and the two ways it can fail to are
   * both live in this corpus. Pinned as a table rather than as `T(transfers)` because the first
   * draft of this check assumed the simple rule and `branch-flavors.s` falsified it — the same trap
   * step 2b recorded, where a claim naming a SLOT was reasoned about instead of watched.
   *
   * - **The transfer issued in SLOT 1.** Its group had already closed behind it, so the
   *   fall-through was still in IF and died there, never consuming a slot. Both of
   *   `branch-flavors.s`'s branches do this — hence 0 doomed mates despite 1 taken transfer.
   * - **The transfer is the last word of `.text`.** Nothing was fetched behind it to strand:
   *   `call-return.s`'s `ret`. With forwarding OFF that program loses its other one too, because
   *   the `jal`'s would-be mate is refused for `raw` and never issues — so the doomed count is a
   *   FORWARDING-dependent 1 → 0, which is why the field is keyed by position.
   */
  it('doomed mates are pinned per position, not derived from the taken-transfer count', () => {
    // The two programs where `doomed` and `T` come apart — asserted explicitly so that a future
    // simplification back to `T(transfers)` fails loudly here rather than silently elsewhere.
    expect(TIMING['branch-flavors.s']!.w2.doomed.on, 'both branches sit in slot 1').toBe(0);
    expect(T(TIMING['branch-flavors.s']!.transfers), '...yet a transfer IS taken').toBe(1);
    expect(TIMING['call-return.s']!.w2.doomed.on).toBe(1);
    expect(TIMING['call-return.s']!.w2.doomed.off, 'the jal’s mate is refused for raw').toBe(0);
    expect(T(TIMING['call-return.s']!.transfers), 'two taken transfers, at most one mate').toBe(2);
  });
});

describe('the form GENERALIZES M3 — at width 1 it is N + 4 + S + P + M', () => {
  it.each(CASES)('$file [forwarding $position]: G = N and L = S', ({ file, position }) => {
    // The claim that makes `G + L + P + M + 4` a generalization rather than a second, unrelated
    // formula. At width 1 every group holds exactly one instruction, so G counts instructions; and
    // every stall refuses slot 0, so no refusal is ever free.
    const pinned = TIMING[file]!;
    const m = measure(run(file, CONFIG[position]), 1);
    expect(m.Q, 'a width-1 machine never pairs').toBe(0);
    expect(m.G, 'G = N').toBe(pinned.retires);
    expect(m.L, 'L = S').toBe(total(pinned.stalls[position]));
    expect(m.freeRefusals, 'at width 1 a refusal is never free').toBe(0);
  });
});

describe('a slot-1 refusal is FREE — the fact that makes S ≠ L', () => {
  it('call-return.s runs 14 cycles with forwarding off DESPITE firing a stall', () => {
    // The cleanest instance in the corpus. With forwarding off, `addi s0@12` is refused from slot 1
    // for `raw` — a real `stall` event — and the program still takes exactly as long as with
    // forwarding on, because the jal beside it issued anyway.
    const off = run('call-return.s', CONFIG_W2.off);
    const on = run('call-return.s', CONFIG_W2.on);
    expect(measure(off, 2).freeRefusals, 'the refusal really fired').toBeGreaterThan(0);
    expect(measure(off, 2).L, '...and cost nothing').toBe(0);
    expect(off).toHaveLength(14);
    expect(on).toHaveLength(14);
  });

  it('every program fires more stall EVENTS than it loses cycles, once pairing is on', () => {
    // The corpus-wide form of the same fact. A reader who counted `stall` events at width 2 and
    // called the total "S" would over-charge every one of these programs.
    const withRefusals = Object.keys(TIMING).filter(
      (file) => measure(run(file, CONFIG_W2.on), 2).freeRefusals > 0,
    );
    // Not a vacuous filter: pairing refusals are the model's soul and most of the corpus has them.
    expect(withRefusals.length).toBeGreaterThan(2);
    for (const file of withRefusals) {
      const ts = run(file, CONFIG_W2.on);
      const m = measure(ts, 2);
      expect(eventsOf(ts, 'stall').length, `${file}: events`).toBe(m.L + m.freeRefusals);
      expect(m.L, `${file}: lost < fired`).toBeLessThan(eventsOf(ts, 'stall').length);
    }
  });
});

/** The full width-2 matrix: 7 programs × 2 forwarding × 3 prediction × 3 cache = 126 cells. */
const W2_MATRIX = Object.keys(TIMING).flatMap((file) =>
  (['off', 'on'] as const).flatMap((position) =>
    (['none', 'static-not-taken', 'static-taken'] as const).flatMap((scheme) =>
      (['off', 'small', 'large'] as const).map((cache) => ({ file, position, scheme, cache })),
    ),
  ),
);

describe('the full width-2 matrix — every cycle count derived, none observed', () => {
  it.each(W2_MATRIX)(
    '$file [forwarding $position, predict $scheme, cache $cache]',
    ({ file, position, scheme, cache }) => {
      const pinned = TIMING[file]!;
      // `'none'` and `'static-not-taken'` are one machine — a processor with no predictor keeps
      // fetching, and the fall-through IS the not-taken path. The table states one column for both.
      const behaviour: Scheme = scheme === 'static-taken' ? 'static-taken' : 'static-not-taken';
      const config = withCache({ ...CONFIG_W2[position], branchPrediction: scheme }, CACHE[cache]);
      const ts = run(file, config);
      const m = measure(ts, 2);

      const G = groupsUnder(pinned, position, behaviour);
      const Q = pairsUnder(pinned, position, behaviour);
      const L = pinned.w2.blocked[position];
      const P = penaltyOf(pinned.transfers, behaviour);
      const M = missesAt(pinned, cache) * MISS_PENALTY;

      // Every term measured against its own pin BEFORE the total, so the cell attributes its own
      // failure. This is the discipline the width-1 matrices use and the reason they are readable.
      expect(m.G, 'G').toBe(G);
      expect(m.Q, 'Q').toBe(Q);
      expect(m.L, 'L — untouched by prediction and by the cache').toBe(L);
      expect(penaltyFromEvents(ts), 'P — priced from the engine’s own outcomes').toBe(P);
      expect(missCount(ts) * MISS_PENALTY, 'M').toBe(M);
      // N is still the program: no toggle on any of the three axes may change what retires.
      expect(eventsOf(ts, 'instr-retire'), 'N').toHaveLength(pinned.retires);

      expect(ts, 'cycles = G + L + P + M + 4').toHaveLength(G + L + P + M + 4);
    },
  );
});

describe('P and M are width-invariant — asserted, not assumed', () => {
  it.each(MATRIX)(
    '$file [forwarding $position, predict $scheme]: same P at both widths',
    ({ file, position, scheme }) => {
      // The claim that lets `penaltyOf` — M3's function, unchanged — price the width-2 matrix. A
      // mispredict costs 2 and a correct bet 1 at BOTH widths, for reasons that are about the
      // redirect's clock edge rather than about how many instructions travel abreast.
      const w1 = run(file, withScheme(CONFIG[position], scheme));
      const w2 = run(file, withScheme(CONFIG_W2[position], scheme));
      expect(penaltyFromEvents(w2)).toBe(penaltyFromEvents(w1));
      expect(penaltyFromEvents(w2)).toBe(penaltyOf(TIMING[file]!.transfers, scheme));
    },
  );

  it.each(Object.keys(TIMING))('%s: the same misses at both widths, at every size', (file) => {
    // The mem-port rule keeps MEM single-lane, so width cannot reorder or coalesce the address
    // stream. If this ever fails, two memory ops paired and the cache stopped being single-lane.
    for (const cache of ['small', 'large'] as const) {
      const w1 = run(file, withCache(ON, CACHE[cache]));
      const w2 = run(file, withCache(CONFIG_W2.on, CACHE[cache]));
      expect(missCount(w2), `${file} [${cache}]`).toBe(missCount(w1));
      expect(missCount(w2)).toBe(TIMING[file]!.misses[cache]);
    }
  });
});

describe('the crown jewel, width edition — the same program, the same answer, fewer cycles', () => {
  it.each(Object.keys(TIMING))(
    '%s: width 2 is strictly faster, and by a DERIVED amount',
    (file) => {
      // Asserted as an exact delta rather than an inequality: `toBeLessThan` would pass for a machine
      // that paired once by accident, which is precisely the degenerate success this tier must rule
      // out. The delta is `(N − G) + (S − L)` — pairing plus the refusals that stopped costing.
      const pinned = TIMING[file]!;
      for (const position of ['off', 'on'] as const) {
        const w1 = run(file, CONFIG[position]);
        const w2 = run(file, CONFIG_W2[position]);
        const derived =
          pinned.retires -
          pinned.w2.groups[position] +
          (total(pinned.stalls[position]) - pinned.w2.blocked[position]);
        expect(w1.length - w2.length, `${file} [forwarding ${position}]`).toBe(derived);
        // ...and the answers are untouched, which is the half INV-8 already covers.
        expect(w2[w2.length - 1]!.state.registers).toEqual(w1[w1.length - 1]!.state.registers);
      }
    },
  );

  it('but width 2 is NOT strictly faster in every CONFIG — call-return.s ties with fwd off', () => {
    // The honest counterexample, in the shape M3 used for forwarding. `call-return.s` gains 3
    // cycles from pairing with forwarding on and 3 with it off — but `add.s` with forwarding off
    // gains only 1, because the interlock immediately spends what the second slot won. A suite that
    // claimed "width 2 always wins big" would be overclaiming.
    expect(run('add.s', OFF).length - run('add.s', CONFIG_W2.off).length).toBe(1);
    expect(run('add.s', ON).length - run('add.s', CONFIG_W2.on).length).toBe(1);
    // The straddler, by contrast, buys 30 cycles at width 2 with forwarding on.
    expect(
      run('array-sum-twice.s', ON).length - run('array-sum-twice.s', CONFIG_W2.on).length,
    ).toBe(30);
  });
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

// =================================================================================================
// WIDTHS 3 AND 4 — the derived timing matrix (M13 step 3)
// =================================================================================================

/**
 * **The width-3/4 matrix, and what a green here is and is not worth.**
 *
 * The closed form is unchanged — `cycles = G + L + P + M + 4` — because nothing in its derivation
 * mentioned an arity: the `+4` is pipeline depth, `P` is about the redirect's clock edge, and `M` is
 * about a single-ported MEM. Width moves exactly one thing, **when each instruction leaves ID**, so
 * the whole of this step is `G`, the issue-size histogram, `L` and `doomed`.
 *
 * ## The measurement bug this step had to fix first
 *
 * `issuedPerCycle` looped `s < 2`. Every group of 3 or 4 would have read as at most 2, `G` would
 * have come out too high, and every number below would have been fitted to a broken ruler. It is
 * now a parameter, it was watched failing with the `2` restored, and the whole width-2 matrix above
 * passes unchanged through the parameterized version — see that function's docblock. Note what
 * would NOT have caught it: step 1's audit swept for literal slot indexing and came back empty,
 * because this arity was a loop bound over a template string.
 *
 * ## The derivation discipline, and the honest limit of the blind claim
 *
 * M7 step 2b shipped six of seven counts pinned from the engine's own output and step 4 had to redo
 * them. This step does not repeat that: every cell was hand-derived from the pinned issue rules by
 * tracing the group partition and the loop period, written down in full, and only then run.
 *
 * **But say exactly which column was blind.** The w3/w4 cycle TOTALS at forwarding-ON /
 * predict-none / no-cache are published in `docs/plans/m13-tasks.md`'s step-0 dump table, so those
 * eleven numbers are a CROSS-CHECK and not a prediction, and claiming otherwise would be the same
 * defect class as the `CycleCtx.bet` miscount this milestone already recorded. Genuinely blind: the
 * entire term decomposition at both widths (`G`, `sizes`, `L`, `doomed`), every forwarding-OFF
 * count, every `static-taken` count, and both cache columns — 44 pinned cells against 11 published
 * totals.
 *
 * ## What the histogram buys that a cycle count cannot
 *
 * Three of the plan's self-deception traps are answerable only from `sizes`:
 *
 * - **"A test that passes at width 4 because nothing ever filled four slots."** **Eight of the
 *   eleven corpus programs never reach a group of 4 at width 4** — measured, not enumerated by
 *   hand. Their width-4 cells are honestly width-3 measurements and now SAY so.
 * - **`paired-branches.s`'s 7 → 7.** G is 3 at w2 and w3 with different shapes (`{1,2,2}` against
 *   `{1,3,1}`) — the third slot filled and pushed `ecall` into a group of its own.
 * - **`branch-flavors.s` at width 4.** Two groups of FOUR, identical cycle count, and one MORE
 *   instruction issued (`slots` 10 → 11) because the extra occupants are doomed mates.
 */

/**
 * The widths this suite pins beyond the pair, DERIVED from the engine's own bound rather than typed
 * `[3, 4]` — step 1's `halt-shadow.test.ts` precedent. Raising `MAX_ISSUE_WIDTH` must not be able to
 * leave the widest machine the least tested; here it makes the completeness test below go red.
 */
const WIDE_WIDTHS = Array.from({ length: MAX_ISSUE_WIDTH - 2 }, (_, i) => i + 3);

const configAt = (width: number, position: Position): ProcessorConfig => ({
  ...CONFIG[position],
  issueWidth: width,
});

/** The cell a (width, scheme) pair selects. `'none'` and `'static-not-taken'` are one machine. */
const cellOf = (pinned: Timing, width: number, scheme: Scheme): WideCell =>
  scheme === 'static-taken' ? pinned.wide[width]!.taken : pinned.wide[width]!.base;

/**
 * The table's sparse histogram as a dense array over the GROUP sizes `k = 1..width`, and
 * {@link groupSizes} is its counterpart on the measured side.
 *
 * **Index 0 is deliberately excluded, and the first draft of this comparison included it.** It went
 * red on every wide cell at once, which is the good outcome: `measure`'s `sizes[0]` counts cycles in
 * which NOTHING issued — blocked cycles, penalty cycles, the empty cycle after a bet — so comparing
 * it here would have made the "issue-size histogram" pin depend on `L` and `P`, terms this table
 * already asserts separately. A histogram of group sizes has no entry for "no group".
 */
const denseSizes = (sizes: Readonly<Record<number, number>>, width: number): number[] =>
  Array.from({ length: width }, (_, k) => sizes[k + 1] ?? 0);

/** The measured group-size histogram over `k = 1..width` — {@link denseSizes}'s counterpart. */
const groupSizes = (m: Measured): number[] => m.sizes.slice(1);

/** Every (program, width, forwarding) triple the wide table pins. */
const WIDE_CASES = Object.keys(TIMING).flatMap((file) =>
  WIDE_WIDTHS.flatMap((width) =>
    (['off', 'on'] as const).map((position) => ({ file, width, position })),
  ),
);

describe('widths 3 and 4 — the derived schedule (G, the histogram, L, doomed)', () => {
  it('the table pins every width the engine admits', () => {
    // A guard against the decay mode step 1 named: `MAX_ISSUE_WIDTH` is the engine's, and raising it
    // without deriving new cells would otherwise leave the widest machine silently unpinned. It also
    // guards the guard — an empty `WIDE_WIDTHS` would make every `it.each` below vacuous.
    expect(WIDE_WIDTHS).toEqual([3, 4]);
    for (const file of Object.keys(TIMING)) {
      expect(Object.keys(TIMING[file]!.wide).map(Number).sort(), file).toEqual(WIDE_WIDTHS);
    }
  });

  it.each(WIDE_CASES)('$file [width $width, forwarding $position]', ({ file, width, position }) => {
    const pinned = TIMING[file]!;
    const cell = pinned.wide[width]!.base;
    const ts = run(file, configAt(width, position));
    const m = measure(ts, width);

    // Each term against its own pin BEFORE the total, so a failed cell names which term moved. A
    // single opaque cycle count would let a compensating pair of errors — one group too many, one
    // blocked cycle too few — pass and tell you nothing.
    expect(m.G, 'G — issue-group cycles').toBe(cell.groups);
    expect(groupSizes(m), 'the issue-size histogram').toEqual(denseSizes(cell.sizes, width));
    expect(m.L, 'L — blocking stalls (slot 0 refused, nothing issued)').toBe(
      cell.blocked[position],
    );

    // ...and the closed form from the PINNED terms, never the measured ones, or this line would be
    // an identity rather than a claim.
    const P = penaltyOf(pinned.transfers, 'static-not-taken');
    expect(ts, 'cycles = G + L + P + M + 4').toHaveLength(
      cell.groups + cell.blocked[position] + P + 0 + 4,
    );
  });

  it.each(
    WIDE_CASES.flatMap(({ file, width, position }) =>
      SCHEMES.map((scheme) => ({ file, width, position, scheme })),
    ),
  )(
    '$file [width $width, forwarding $position, predict $scheme]: Σ k·sizes[k] = retires + doomed',
    ({ file, width, position, scheme }) => {
      // The independent route to the histogram: every group consumes one slot per occupant, and
      // every instruction that consumes one either retires or is a DOOMED mate — issued beside a
      // taken transfer and squashed in EX. Both sides are measured from the trace, so this closes
      // the accounting without using the pinned `groups` or `sizes` at all. It is the width-2
      // `G + Q = retires + doomed` identity, generalized.
      //
      // It is NOT redundant with the histogram assertion above, and the difference is the point:
      // `doomed` here is an INSTRUCTION-IDENTITY count (entered `EX.*`, never emitted
      // `instr-retire`) while `m.slots` is CYCLE-DERIVED (`Σ k·sizes[k]`). Two different readings
      // of the trace have to agree.
      //
      // **It runs under BOTH prediction behaviours, and the first draft ran only the base one** —
      // which left `wide[3].taken.doomed` and `wide[4].taken.doomed` pinned for all eleven programs
      // and read by nothing, while the docblocks above made load-bearing claims about exactly those
      // numbers ("doomed 18 → 0", "doomed 24 → 0"). That is `Lesson.depthDefault` and step 2's
      // string tautology in the file whose thesis is that an unfailable green is worse than none.
      // Betting is precisely where the mechanism changes — the mate dies in ID instead of being
      // stranded in EX — so it is the column that most needed the cross-check, not the one to skip.
      const pinned = TIMING[file]!;
      const ts = run(file, withScheme(configAt(width, position), scheme));
      const m = measure(ts, width);

      const retired = new Set(eventsOf(ts, 'instr-retire').map((e) => e.instr));
      const issuedIds = new Set(
        ts.flatMap((t) =>
          t.instructions.filter((i) => i.location.startsWith('EX.')).map((i) => i.id),
        ),
      );
      const doomed = [...issuedIds].filter((id) => !retired.has(id)).length;

      expect(retired.size, 'N').toBe(pinned.retires);
      expect(doomed, 'doomed mates').toBe(cellOf(pinned, width, scheme).doomed);
      expect(m.slots, 'issue slots consumed').toBe(pinned.retires + doomed);
    },
  );

  it('the forwarding toggle never moves the partition at width ≥ 3 — and did at width 2', () => {
    // Asserted rather than assumed, because the width-2 table's `groups`/`pairs` ARE keyed by
    // position and this step's `WideCell` deliberately is not. The reason the keying could be
    // dropped is a real finding: at width 2 the only forwarding-shaped partition change in the
    // corpus is `array-sum.s`/`strided-sum.s`, where the `lw@16` is refused from slot 1 for `raw`
    // and splits a pair. A THIRD SLOT MASKS IT — the same `lw` is refused for `intra-pair-raw`
    // against `addi t0@4` whatever the toggle says, and pairing rules are checked BEFORE the
    // ordinary hazard. So widening deleted the corpus's one forwarding-dependent partition.
    expect(TIMING['array-sum.s']!.w2.groups.off, 'width 2: the toggle DOES move G').not.toBe(
      TIMING['array-sum.s']!.w2.groups.on,
    );
    for (const file of Object.keys(TIMING)) {
      for (const width of WIDE_WIDTHS) {
        const off = measure(run(file, configAt(width, 'off')), width);
        const on = measure(run(file, configAt(width, 'on')), width);
        expect(off.G, `${file} @ w${width}: G`).toBe(on.G);
        expect(groupSizes(off), `${file} @ w${width}: histogram`).toEqual(groupSizes(on));
      }
    }
  });
});

/** The full wide matrix: 11 programs × 2 widths × 2 forwarding × 3 prediction × 3 cache. */
const WIDE_MATRIX = WIDE_CASES.flatMap(({ file, width, position }) =>
  (['none', 'static-not-taken', 'static-taken'] as const).flatMap((scheme) =>
    (['off', 'small', 'large'] as const).map((cache) => ({ file, width, position, scheme, cache })),
  ),
);

describe('the full width-3/4 matrix — every cycle count derived, none copied', () => {
  it.each(WIDE_MATRIX)(
    '$file [width $width, forwarding $position, predict $scheme, cache $cache]',
    ({ file, width, position, scheme, cache }) => {
      const pinned = TIMING[file]!;
      const behaviour: Scheme = scheme === 'static-taken' ? 'static-taken' : 'static-not-taken';
      const cell = cellOf(pinned, width, behaviour);
      const config = withCache(
        { ...configAt(width, position), branchPrediction: scheme },
        CACHE[cache],
      );
      const ts = run(file, config);
      const m = measure(ts, width);

      const P = penaltyOf(pinned.transfers, behaviour);
      const M = missesAt(pinned, cache) * MISS_PENALTY;

      expect(m.G, 'G').toBe(cell.groups);
      expect(groupSizes(m), 'the issue-size histogram').toEqual(denseSizes(cell.sizes, width));
      expect(m.L, 'L — untouched by prediction and by the cache').toBe(cell.blocked[position]);
      expect(penaltyFromEvents(ts), 'P — priced from the engine’s own outcomes').toBe(P);
      expect(missCount(ts) * MISS_PENALTY, 'M').toBe(M);
      // N is still the program: no toggle on any of the four axes may change what retires.
      expect(eventsOf(ts, 'instr-retire'), 'N').toHaveLength(pinned.retires);

      expect(ts, 'cycles = G + L + P + M + 4').toHaveLength(
        cell.groups + cell.blocked[position] + P + M + 4,
      );
    },
  );
});

describe('P and M stay width-invariant at 3 and 4 — asserted, not argued', () => {
  // The claim that lets `penaltyOf` and the miss table price the wide matrix unchanged. The
  // ARGUMENTS are good (a mispredict costs 2 because the redirect is clocked at the end of EX
  // whatever the width; the mem-port rule keeps MEM single-lane so the address stream cannot move),
  // but the width-2 versions of these tests exist precisely because an argument is not a net, and
  // extending them costs one loop.
  const P_CASES = Object.keys(TIMING).flatMap((file) =>
    WIDE_WIDTHS.flatMap((width) =>
      (['off', 'on'] as const).flatMap((position) =>
        SCHEMES.map((scheme) => ({ file, width, position, scheme })),
      ),
    ),
  );

  it.each(P_CASES)(
    '$file [width $width, forwarding $position, predict $scheme]: same P as width 1',
    ({ file, width, position, scheme }) => {
      const w1 = run(file, withScheme(CONFIG[position], scheme));
      const wide = run(file, withScheme(configAt(width, position), scheme));
      expect(penaltyFromEvents(wide), 'P').toBe(penaltyFromEvents(w1));
      expect(penaltyFromEvents(wide)).toBe(penaltyOf(TIMING[file]!.transfers, scheme));
    },
  );

  it.each(Object.keys(TIMING))('%s: the same misses at widths 3 and 4, at every size', (file) => {
    for (const cache of ['small', 'large'] as const) {
      for (const width of WIDE_WIDTHS) {
        const wide = run(file, withCache(configAt(width, 'on'), CACHE[cache]));
        expect(missCount(wide), `${file} [w${width}, ${cache}]`).toBe(TIMING[file]!.misses[cache]);
      }
    }
  });
});

describe('what the histogram says that the cycle counts cannot', () => {
  /**
   * The plan's sharpest self-deception trap, made into an assertion: *"a test that passes at width 4
   * because nothing ever filled four slots is measuring width 3."* Rather than argue the corpus
   * does fill four slots, MEASURE which programs do — and name the ones that never do. Every one of
   * their width-4 cells above is honestly a width-3 measurement, and this is where that is stated.
   */
  it('names exactly which programs ever fill four slots — EIGHT of twelve never do', () => {
    const groupsOfFour = (file: string): number =>
      measure(run(file, configAt(4, 'on')), 4).sizes[4] ?? 0;
    const fillsFour = Object.keys(TIMING).filter((file) => groupsOfFour(file) > 0);

    // Measured from the traces, then compared to the names — never read off the table, which would
    // re-bless whatever the table says.
    expect([...fillsFour].sort()).toEqual(
      // The first three fill four in their TAIL — the drain group, where `ecall` rides along behind
      // whatever is left. `nested-loop.s` is the one that does it at the HEAD: its prologue is four
      // independent instructions ending in the pass guard, so the four is a real dispatch rather
      // than a program running out. It joined at step 0b and kept the complement at eight.
      ['branch-flavors.s', 'nested-loop.s', 'paired-branches.s', 'slow-op-loop.s'].sort(),
    );
    // ...and the complement, stated as a count rather than a hand-picked subset. The first draft of
    // this half read `TIMING[file].wide[4].base.sizes[4]` and asserted `undefined` — a property of
    // the literal three hundred lines above it, which no engine change could ever falsify. It is
    // the same shape step 2 caught and replaced, and it survived to a passing test twice now.
    expect(Object.keys(TIMING).length - fillsFour.length, 'eight of twelve').toBe(8);
    for (const file of Object.keys(TIMING).filter((f) => !fillsFour.includes(f))) {
      expect(groupsOfFour(file), `${file} never reaches a group of 4`).toBe(0);
    }
  });

  it('paired-branches.s: w2 and w3 run 7 cycles with DIFFERENT partitions', () => {
    // The flagged 9 → 7 → 7 → 6 anomaly, accounted term by term. G is 3 at both widths and the
    // shapes differ: the third slot fills and pushes `ecall` out of the tail group into its own.
    // "Width 3 bought nothing" is true and uninformative; this is the informative form.
    const w2 = measure(run('paired-branches.s', CONFIG_W2.on), 2);
    const w3 = measure(run('paired-branches.s', configAt(3, 'on')), 3);
    const w4 = measure(run('paired-branches.s', configAt(4, 'on')), 4);
    expect(w2.G, 'w2: {1, 2, 2}').toBe(3);
    expect(w3.G, 'w3: {1, 3, 1} — same G, wider groups, one MORE group boundary in the tail').toBe(
      3,
    );
    expect(w2.sizes.slice(1), 'w2 histogram').toEqual([1, 2]);
    expect(w3.sizes.slice(1), 'w3 histogram — the third slot really did fill').toEqual([2, 0, 1]);
    expect(w4.G, 'w4: the whole tail in one group of four').toBe(2);
    expect(w4.sizes[4], '...and it IS a four').toBe(1);
    // The cycle counts the histogram explains.
    expect(run('paired-branches.s', CONFIG_W2.on)).toHaveLength(7);
    expect(run('paired-branches.s', configAt(3, 'on'))).toHaveLength(7);
    expect(run('paired-branches.s', configAt(4, 'on'))).toHaveLength(6);
  });

  it('branch-flavors.s: width 4 issues MORE instructions for the same 10 cycles', () => {
    // A taken transfer in slot `k` strands up to `width − 1 − k` mates, and `blt@12` sits in slot 1
    // at every width ≥ 2. So the group behind it grows, every new occupant dies in EX, and the cycle
    // count does not move at all. `toHaveLength` alone would call this "width 4 changed nothing".
    const w2 = measure(run('branch-flavors.s', CONFIG_W2.on), 2);
    const w3 = measure(run('branch-flavors.s', configAt(3, 'on')), 3);
    const w4 = measure(run('branch-flavors.s', configAt(4, 'on')), 4);
    expect([w2.slots, w3.slots, w4.slots], 'issue slots consumed').toEqual([9, 10, 11]);
    expect(run('branch-flavors.s', configAt(3, 'on'))).toHaveLength(10);
    expect(run('branch-flavors.s', configAt(4, 'on'))).toHaveLength(10);
  });

  it('slow-op-loop.s: the ONE cycle width 4 buys is a prologue, not a loop', () => {
    // One of only two programs that gain anything at width 4, and the size-4 group happens exactly
    // ONCE in a run of six iterations — the four independent `li`s of the prologue. The loop body is
    // byte-identical at both widths. That is why the gain is 1 cycle and not 6, and it is the width
    // axis's honest lesson: the fourth slot pays where four independent instructions sit in a row,
    // and real loop bodies do not.
    const w3 = measure(run('slow-op-loop.s', configAt(3, 'on')), 3);
    const w4 = measure(run('slow-op-loop.s', configAt(4, 'on')), 4);
    expect(w4.sizes[4], 'exactly one group of four in the whole run').toBe(1);
    expect(w4.G, 'and it saves exactly one group').toBe(w3.G - 1);
    expect(w3.slots, 'the same instructions issue either way').toBe(w4.slots);
    expect(run('slow-op-loop.s', configAt(3, 'on'))).toHaveLength(34);
    expect(run('slow-op-loop.s', configAt(4, 'on'))).toHaveLength(33);
  });

  it('static-taken SPENDS the width — paired-branches gives its w4 cycle back', () => {
    // The step's second finding, and one no cycle-count-only matrix would surface: a bet ends its
    // group (`killedRest`), so betting fragments the instruction stream into pieces too short to
    // fill four slots. `paired-branches.s` runs 6 cycles at width 4 under the base behaviour and 11
    // under `static-taken` — the same 11 it runs at width 3. The width buys nothing once the
    // predictor is on.
    const taken = (width: number): number =>
      run('paired-branches.s', withScheme(configAt(width, 'on'), 'static-taken')).length;
    expect(taken(3), 'w3 under static-taken').toBe(11);
    expect(taken(4), 'w4 under static-taken — no better than w3').toBe(11);
    expect(run('paired-branches.s', configAt(4, 'on')), 'w4 under the base behaviour').toHaveLength(
      6,
    );
    // ...and the mechanism, so the number is attributable: the bet deletes the group of four.
    const betting = measure(
      run('paired-branches.s', withScheme(configAt(4, 'on'), 'static-taken')),
      4,
    );
    expect(betting.sizes[4], 'no group of four survives the bet').toBe(0);
  });
});
