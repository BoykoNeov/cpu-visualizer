import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type TraceEvent } from '@cpu-viz/trace';
import {
  ScoreboardProcessor,
  MEM_LATENCY,
  INT_LATENCY,
  type ScoreboardMicro,
  type ScoreboardStallReason,
} from './processor';

/**
 * **THE NET for M15 (step 3).** The suite the whole milestone is written around.
 *
 * `differential.test.ts` proves this model computes the right ANSWERS on the whole corpus, and its
 * own docblock says that proves almost nothing about scheduling: out-of-order completion reaching
 * the same final architectural state is exactly what INV-8 checks. The milestone's characteristic
 * failure —
 *
 * > *a `scoreboard` package that typechecks, passes INV-8, and is a 5-stage wearing scoreboard
 * > labels*
 *
 * — lives entirely inside that blind spot. Every observable consequence of the scoreboard is
 * TIMING, and this is where it becomes observable.
 *
 * ## The recurrence, derived from the cadence rules and from nothing else
 *
 * `processor.ts`'s header pins four rules (Issue N ⇒ RO N+1, RO N ⇒ EX N+1, EX ends N ⇒ WB N+1,
 * WB N ⇒ that unit issues N+1). Writing `s`/`r`/`e`/`w` for the cycle an instruction issues, reads
 * operands, finishes execution and writes its result, and `L` for its unit's latency
 * ({@link INT_LATENCY} = 1, {@link MEM_LATENCY} = 4):
 *
 * - `r_i = max(s_i + 1, w_p + 1 over every in-flight producer p of a source)` — the shortfall is
 *   charged as `'operand'` stall cycles at `RO`, one event per cycle.
 * - `e_i = r_i + L_i`, and `w_i = e_i + 1` plus any `'war'` hold at `WB`. So
 *
 *   > **`w = s + 1 + O + L + 1 + W`** — `O` operand-stall cycles, `W` war-stall cycles.
 *
 * - `s_i >= s_(i-1) + 1` (Issue is in order, one per cycle, blocking), and additionally
 *   `s_i >= e_t` for an older unresolved transfer `t` (`'control'`), `s_i >= w_u + 1` for the last
 *   occupant `u` of the unit class it needs (`'structural-int'` / `'structural-mem'`), and
 *   `s_i >= w_p + 1` for an in-flight `p` already claiming its destination (`'waw'`).
 *
 * ### ⚠ Lead with this: the TURNAROUND CEILING is the dominant term, and it is not a hazard
 *
 * A unit is held from `s` to `w` inclusive and only frees at that cycle's clock edge, so the next
 * occupant issues at `w + 1`:
 *
 * | unit class | occupancy    | issue-to-issue turnaround |
 * | ---------- | ------------ | ------------------------- |
 * | `INT0/1`   | `s` … `s+3`  | **4 cycles**              |
 * | `MEM`      | `s` … `s+6`  | **7 cycles**              |
 *
 * With **two** integer units that is 2 issues per 4 cycles — **a hard ceiling of 0.5 IPC on
 * integer-only code, with no hazard of any kind present**. Both isolated below. It is the largest
 * single term in every corpus row (`structural-int` runs 32 / 151 / 59 / 29 / 23 on the biggest
 * programs) and it DWARFS the two hazards this milestone exists to show. That is a property of a
 * three-unit machine, not a bug and not a reason to reopen decision 4 — but step 7's view and M16's
 * lesson both have to say it out loud, or a student reads the wall of `structural-int` as the
 * scoreboard's verdict on their program rather than as the size of the machine.
 *
 * ## The closed form
 *
 * Two identities, and they are asserted separately because a single opaque total lets a
 * compensating pair of errors pass:
 *
 * > **1. `s_last = N + D + T + E`** — the ISSUE accounting.
 * >
 * > **2. `cycles = s_last + tail`** — the DRAIN, charged to a NAMED last writer.
 *
 * *Identity 1* counts the `s_last + 1` cycles of `[0, s_last]` by what Issue did in each: it issued
 * (`N` — every issued instruction retires here, since nothing is ever squashed after Issue), or it
 * was blocked with an instruction in `IF` (`D` — exactly one stall event per such cycle), or `IF`
 * was empty. `IF` is empty for the cycle-0 fill, for one redirect cycle per taken transfer `T` (the
 * flush empties the slot and the target is fetched that same cycle), and for `E` — see below. So
 * `s_last + 1 = N + D + 1 + T + E`.
 *
 * *Identity 2* is deliberately NOT a residual. `tail := 1 + max(w) − s_last` would be whatever
 * balances the equation and would constrain nothing, so each row instead names **which instruction
 * is the last to write its result** and derives the tail from that instruction's own recurrence:
 *
 * > `tail = 3 + L + ownStalls − issueOffset`, where `issueOffset = s_last − s_j`.
 *
 * On four of twelve programs the last writer is **not** the last instruction issued — a load or a
 * store still in the memory unit while the `ecall` behind it has already written. That is the
 * milestone's thesis surfacing in the drain, and pinning the writer's identity is what makes it an
 * assertion rather than an arithmetic coincidence.
 *
 * ### ⚠ The term the plan did not have: `E`, the STARVED front end
 *
 * `E` was found by running identity 1 before deriving any table, and it is a step-3 finding rather
 * than a nuisance. `B = 1 + T` assumes every taken transfer has a fetched instruction sitting in
 * `IF` behind it, `'control'`-stalling once per cycle until the transfer resolves. **A transfer at
 * the last word of `.text` has no such victim**: fetch stopped the moment it issued
 * (`fetchStopped()` — `pc + 4` is out of text), so the same cycles pass with `IF` empty and emit no
 * event at all. The stall count cannot see them; the issue accounting can.
 *
 * `call-return.s`'s `ret` is the corpus's only such instruction, and `E = 1` there — the one cycle
 * between its issue and its redirect. It is also the corpus's only taken transfer that emits no
 * `flush` (2 taken transfers, 1 flush), for the same reason and at the same instruction. Isolated
 * below on a three-instruction witness so the term is structural rather than a `call-return` quirk.
 *
 * ### What the cycle count CANNOT see, asserted anyway
 *
 * `docs/memory/cycles-cannot-see-a-lost-forward.md` in its sharpest form on this model. **`RO` is
 * per-unit and non-blocking**, so an `'operand'` stall costs the machine ZERO cycles directly — it
 * enters identity 1 not at all, and the count only through the unit occupancy it extends. `'war'`
 * at `WB` is the same. `array-sum.s` balances both identities exactly while carrying 26 operand
 * stalls, which is the demonstration: delete every one of them from the trace and no number in the
 * closed form moves. So the histogram is keyed by **(pc, reason)** and asserted in full, and each
 * reason's STAGE is asserted with it — which is also the corpus-scale statement of the thesis
 * ("WAW stalls at Issue, WAR stalls at Write-Result").
 *
 * ⚠ **`'war'` is absent from every corpus program**, and {@link WAR_IS_ABSENT} asserts that
 * emptiness explicitly rather than leaving it as a table with no such rows. The one hazard this
 * milestone exists for is invisible on the shipped corpus; **step 6 is what closes the hole**, and
 * the mutation table below is where the consequence is measured rather than argued.
 *
 * ## ⚠ Provenance, stated honestly rather than claimed
 *
 * Every number below was derived by hand from the recurrence above — the per-program derivations
 * beside each row are that derivation, not a commentary on it, and each was carried through
 * cycle by cycle before the row was written. What was **already visible** when they were written:
 * the plan's step-1 baseline table (total cycles and per-reason TOTALS, which
 * `docs/plans/m15-tasks.md` flags as "⚠ NOT the step-3 oracle"), and — because the probe that ran
 * identity 1 printed more than identity 1 needed — the by-pc histograms. So the warrant for this
 * table is the DERIVATION printed beside each number, not the order of operations. `tail`, the
 * last-writer identities, `E`, and every per-iteration coefficient are genuinely new here.
 *
 * ## The recorded MUTATION CHECK — run 2026-08-10, both halves, three suites each
 *
 * Executed as TWO separate mutations, each applied to `processor.ts`, run, and reverted with
 * `git checkout -- packages/engine/scoreboard/src/processor.ts` on a COMMITTED tree (one named
 * file, never a broad path — `docs/memory/m13-width-planned.md`'s destroyed tree). All three
 * suites were run under each stub rather than assumed from prose. **The predictions were written
 * down before the stubs were applied**, and both held:
 *
 * | Stub                                           | `processor.test.ts` | `differential.test.ts` | **this suite**            |
 * | ---------------------------------------------- | ------------------- | ---------------------- | ------------------------- |
 * | **WAW** — `issueBlocker` never returns `'waw'` | 3 of 46 red         | **14/14 GREEN**        | **7 of 20 red**           |
 * | **WAR** — `warBlocked` always returns `false`  | 3 of 46 red         | **14/14 GREEN**        | **20/20 GREEN**           |
 *
 * The WAW row is **6 matrix cells** — exactly the six programs carrying `'waw'` rows
 * (`array-sum`, `strided-sum`, `array-sum-twice`, `byte-loads`, `store-forward`, `nested-loop`) —
 * plus the operand-invisibility test, which reddens only through the `array-sum.s` coda at its end
 * and is not a seventh program. Five of the six are the `la` pseudo-expansion's `lui`/`addi` pair;
 * the sixth is `nested-loop.s`'s `li t1` / `addi t1` reset.
 *
 * **The asymmetry IS the finding, and step 3 only closes half the hole it was written for.** For
 * WAW this suite is a genuine corpus-scale net where INV-8 is a false one. For WAR **nothing at
 * corpus scale nets it at all** — not INV-8, not this file — because no corpus program contains the
 * hazard; its only net anywhere in the repo is `processor.test.ts`'s hand-built witness, and the
 * whole machinery of this file walks past a deleted WAR check without a flicker. That is precisely
 * the gap step 6 exists to close, and per the plan **both mutations must be re-run there**, where a
 * corpus program finally contains a real WAR pair and INV-8 itself is expected to redden.
 *
 * ⚠ Note what the WAW row does NOT say. Under that stub `differential.test.ts` stays green because
 * every corpus WAW pair's younger writer also READS the older one's destination, so it waits on the
 * producer regardless and the architecture survives — timing moves, state does not. Step 6's
 * promoted program must contain a WAW pair whose younger writer does **not** read that register, or
 * INV-8 will not redden there either and the re-run will measure the same thing twice.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

/** Bigger than `array-sum-twice.s`'s 346 by a wide margin; only a runaway bug reaches it. */
const MAX_CYCLES = 800;

/**
 * Where each stall reason is REPORTED. Asserted per program, not just declared: "WAW stalls at
 * Issue and WAR stalls at Write-Result" is the milestone's one-sentence thesis, and this is its
 * corpus-scale form. `'operand'` at `RO` is the third row of the same claim — a scoreboard waits
 * for its operands INSIDE the unit, which is what makes `RO` non-blocking and WAR reachable.
 */
const STAGE_OF: Readonly<Record<ScoreboardStallReason, 'ID' | 'RO' | 'WB'>> = {
  waw: 'ID',
  'structural-int': 'ID',
  'structural-mem': 'ID',
  control: 'ID',
  operand: 'RO',
  war: 'WB',
};

/** The stall histogram in the table's shape: pc → reason → cycles spent stalled at that site. */
type StallSites = Readonly<Record<number, Partial<Record<ScoreboardStallReason, number>>>>;

/** The instruction whose Write-Result is the LAST in the run — often not the last one issued. */
interface LastWriter {
  readonly pc: number;
  /** `s_last − s_j`. Zero when the last writer is also the last instruction issued. */
  readonly issueOffset: number;
  /** Its unit's latency: {@link INT_LATENCY} or {@link MEM_LATENCY}. */
  readonly latency: number;
  /** `'operand'` + `'war'` cycles paid by THAT dynamic instance — the `O + W` of the recurrence. */
  readonly ownStalls: number;
}

interface Timing {
  /** `N` — instructions that RETIRE. Nothing is squashed after Issue, so this is also issues. */
  readonly retires: number;
  /** `T` — control transfers that GO. Each costs exactly one IF-empty redirect cycle. */
  readonly takenTransfers: number;
  /**
   * `E` — cycles Issue idled with an EMPTY `IF` slot for a reason other than the fill or a
   * redirect. Absent means zero, which is the honest default: a starved front end needs a taken
   * transfer at the last word of `.text`, and the corpus has exactly one.
   */
  readonly starved?: number;
  readonly stalls: StallSites;
  readonly lastWriter: LastWriter;
}

/**
 * The table. **Every number is hand-derived from the recurrence in the header**, against the
 * EXPANDED instruction stream — which is where the traps are, since pseudo-ops hide real
 * instructions and real hazards from the `.s` source:
 *
 * - `la rd, sym` is ALWAYS two words, `lui rd, hi` + `addi rd, rd, lo`. Both write `rd`, one
 *   instruction apart, so **every `la` is a WAW pair** — 3 stall cycles at Issue, every time, and
 *   the reason all six `'waw'` rows in this table exist. (The step-0 corpus scan read source
 *   mnemonics and missed all of them; see the plan's step-1 correction.)
 * - `li` is sized by its literal; every `li` here is small, so each is one `addi rd, x0, v`.
 * - `mv` → `addi rd, rs, 0`; `ret` → `jalr x0, x1, 0`; `bnez rs, t` → `bne rs, x0, t`.
 * - TEXT_BASE is 0, so every pc below is `4 × index into the expanded stream`.
 *
 * Two coefficients recur so often they are stated once here rather than in every derivation:
 * **an integer unit turns around in 4 cycles and the memory unit in 7**, and a consumer whose
 * producer writes at `w` reads at `w + 1`.
 */
const TIMING: Readonly<Record<string, Timing>> = {
  /**
   * `addi x1,x0,5 ; addi x2,x0,37 ; add x5,x1,x2` — no `ecall`: it runs off the end of `.text`.
   *
   * **The corpus's smallest statement of the turnaround ceiling, with no hazard in sight.** The
   * first two issue at 1 and 2 into `INT0`/`INT1` and write at 4 and 5. The `add` needs an integer
   * unit and there is none: `INT0` frees at the clock edge of 4, so it stalls at 3 and 4 and
   * issues at 5 — **2 `'structural-int'` cycles on a three-instruction program whose only
   * dependence is already satisfied.** It reads x1 at once and x2 the cycle after `INT1`'s write
   * lands, so `r = 6` with no operand stall at all: `w = 5 + 1 + 1 + 1 = 8`, cycles = 9.
   */
  'add.s': {
    retires: 3,
    takenTransfers: 0,
    stalls: { 8: { 'structural-int': 2 } },
    lastWriter: { pc: 8, issueOffset: 0, latency: INT_LATENCY, ownStalls: 0 },
  },

  /**
   * 4 prologue + 5 per iteration × 5 + 5 epilogue = 34 retires; `bnez` goes 4 times.
   *
   *    0 lui t0        4 addi t0,t0     8 addi t1,x0,5   12 addi a0,x0,0
   *   16 lw t2,0(t0)  20 add a0,a0,t2  24 addi t0,t0,4   28 addi t1,t1,-1  32 bne t1,x0,loop
   *   36 lui t3       40 addi t3,t3    44 sw a0,0(t3)    48 addi a7,x0,10  52 ecall
   *
   * PROLOGUE. `lui`@0 issues 1 and writes 4; the `la`'s `addi`@4 claims the same t0 ⇒ **`'waw'` at
   * 2, 3, 4**, issuing at 5 (writes 8). `li t1`@8 takes the free `INT1` at 6 (writes 9);
   * `li a0`@12 finds both units held ⇒ **`'structural-int'` at 7, 8**, issues 9, writes 12.
   *
   * ITERATION 1 (the odd one — three sites differ from steady state). `lw`@16 takes the idle memory
   * unit at 10, reads t0 immediately (written at 8), and writes at `10+1+4+1 = 16`. `add`@20 is
   * ready to issue at 11 but `li a0`@12 still claims a0 ⇒ **`'waw'` at 11, 12** (the table's only
   * one outside a `la`), issuing at 13; it then waits on the load ⇒ **3 `'operand'`**, where every
   * later iteration waits 5. `addi t0`@24 issues 14 free. `addi t1`@28 finds both integer units
   * held by the `add` (writes 19) and the pointer bump (writes 17) ⇒ **3 `'structural-int'`** at
   * 15–17, issuing 18. `bne`@32 waits only for the `add` ⇒ **1 `'structural-int'`** at 19 against
   * the steady 3, issues 20, and finds t1 still unwritten ⇒ **1 `'operand'`** at 21, the table's
   * only operand stall on a branch. It resolves at 23, so `lui t3`@36 **`'control'`-stalls at 21
   * and 22** — 2, against 1 everywhere else.
   *
   * STEADY STATE (iterations 2–5, period **13**, first measured 24 → 37 → 50 and confirmed
   * unchanged before being multiplied). Per iteration: `add`@20 **5 `'operand'`** (issued the cycle
   * after the load, waiting out all four memory cycles), `addi t1`@28 **3 `'structural-int'`**,
   * `bne`@32 **3 `'structural-int'`** and none operand (t1's write has landed by the time it
   * issues), `lui t3`@36 **1 `'control'`**. The `lw` and the pointer bump never stall: the memory
   * unit turns around in 7 and the iteration is 13 cycles long.
   *
   * Totals: operand 3 + 5×4 = **23** at pc 20; structural-int 3×5 = **15** at pc 28; at pc 32
   * 1 + 3×4 = **13** structural-int and 1 operand; control 2 + 1×4 = **6** at pc 36.
   *
   * EPILOGUE. The 5th `bne` declines at 75, releasing `lui t3`@36 that same cycle (writes 78). The
   * `la`'s second half@40 is blocked twice over — **`'structural-int'` at 76** (the `bne`'s unit is
   * still held), then **`'waw'` at 77 and 78** on t3 — the one row where the reported reason
   * CHANGES at a single pc, which is why this table is keyed by (pc, reason) and not by pc.
   * `sw`@44 issues 80 into the idle memory unit and waits on t3 ⇒ **2 `'operand'`**, so it reads at
   * 83 and writes at **88**. `li a7`@48 issues 81; `ecall`@52 finds both integer units held ⇒
   * **1 `'structural-int'`**, issuing at `s_last = 83` and writing at 86.
   *
   * **So the store outlives the `ecall` behind it**: `tail = 3 + 4 + 2 − 3 = 6`, cycles = 89.
   */
  'array-sum.s': {
    retires: 34,
    takenTransfers: 4,
    stalls: {
      4: { waw: 3 },
      12: { 'structural-int': 2 },
      20: { waw: 2, operand: 23 },
      28: { 'structural-int': 15 },
      32: { 'structural-int': 13, operand: 1 },
      36: { control: 6 },
      40: { 'structural-int': 1, waw: 2 },
      44: { operand: 2 },
      52: { 'structural-int': 1 },
    },
    lastWriter: { pc: 44, issueOffset: 3, latency: MEM_LATENCY, ownStalls: 2 },
  },

  /**
   * `array-sum.s`'s TWIN — byte-for-byte the same instruction stream, differing only in the pointer
   * bump (`addi t0,t0,16` vs `,4`) and the `.data` values. This machine is cache-blind, so **the
   * two rows are ONE data point, not two, and neither cross-checks the other**: a derivation that
   * reproduces `array-sum` reproduces this automatically. Copied verbatim, deliberately, and the
   * identity is asserted as its own test below. The second cross-check comes from the isolated
   * coefficient programs at the bottom of this file, not from another corpus row.
   */
  'strided-sum.s': {
    retires: 34,
    takenTransfers: 4,
    stalls: {
      4: { waw: 3 },
      12: { 'structural-int': 2 },
      20: { waw: 2, operand: 23 },
      28: { 'structural-int': 15 },
      32: { 'structural-int': 13, operand: 1 },
      36: { control: 6 },
      40: { 'structural-int': 1, waw: 2 },
      44: { operand: 2 },
      52: { 'structural-int': 1 },
    },
    lastWriter: { pc: 44, issueOffset: 3, latency: MEM_LATENCY, ownStalls: 2 },
  },

  /**
   * The corpus's NESTED loop: 2 outer passes over a 12-element walk. 2 prologue + 2 × (3 header +
   * 12 × 5 inner + 2 footer) + 2 epilogue = 134 retires; 24 inner iterations; 23 taken transfers.
   *
   *    0 addi a0,x0,0   4 addi t3,x0,2
   *    8 lui t0        12 addi t0,t0    16 addi t1,x0,12
   *   20 lw t2,0(t0)   24 add a0,a0,t2  28 addi t0,t0,4  32 addi t1,t1,-1  36 bne t1,x0,inner
   *   40 addi t3,t3,-1 44 bne t3,x0,outer   48 addi a7,x0,10   52 ecall
   *
   * **A PASS is self-similar with period 168** (`lui t0`@8 issues at 5, then 173), so pass 2 is
   * pass 1 shifted, with one exception: the 2 `'structural-int'` cycles `lui t0`@8 pays in pass 1
   * are gone in pass 2, where the outer branch's redirect has already left a unit free. That
   * exception is the whole reason the pc-8 row reads 2 and not 4.
   *
   * PER PASS. `lui t0`@8 writes at 8; the `la`'s `addi`@12 ⇒ **3 `'waw'`**, issuing 9. `li t1`@16
   * issues 10. Inner iteration 1 is the odd one: `lw`@20 issues 11 and waits one cycle on t0
   * ⇒ **1 `'operand'`** (every later iteration's pointer is long since written), and `add`@24 finds
   * both integer units held ⇒ **1 `'structural-int'`**.
   *
   * INNER STEADY STATE (period **13**, measured at 25 → 38 → 51 before being multiplied; iteration
   * 1 → 2 is 14, the one non-uniform step). Every one of the 24 inner iterations pays the same
   * three sites: `add`@24 **5 `'operand'`** waiting out the load, `addi t1`@32 **3
   * `'structural-int'`**, `bne`@36 **3 `'structural-int'`**, and the fall-through `addi t3`@40
   * **1 `'control'`**. So 120 / 72 / 72 / 24, and the `lw` and pointer bump never stall.
   *
   * PASS FOOTER. The 12th `bne`@36 declines, releasing `addi t3`@40 the same cycle. `bne t3`@44
   * then pays **1 `'structural-int'`** (the inner branch's unit is still held) and **1
   * `'operand'`** (t3's decrement has not landed), and `li a7`@48 **2 `'control'`** behind it —
   * twice per program, once per pass, whether the outer branch goes or declines.
   *
   * EPILOGUE. `li a7`@48 issues at 340 on the outer branch's decline, `ecall`@52 pays **1
   * `'structural-int'`** and issues at `s_last = 342`, writing at 345. Nothing outlives it here:
   * the last `lw` wrote long before. `tail = 4`, cycles = 346.
   */
  'array-sum-twice.s': {
    retires: 134,
    takenTransfers: 23,
    stalls: {
      8: { 'structural-int': 2 },
      12: { waw: 6 },
      20: { operand: 2 },
      24: { 'structural-int': 2, operand: 120 },
      32: { 'structural-int': 72 },
      36: { 'structural-int': 72 },
      40: { control: 24 },
      44: { 'structural-int': 2, operand: 2 },
      48: { control: 4 },
      52: { 'structural-int': 1 },
    },
    lastWriter: { pc: 52, issueOffset: 0, latency: INT_LATENCY, ownStalls: 0 },
  },

  /**
   * 9 retires — one branch of each outcome on the same bits. `blt`@12 goes (signed −1 < 1) and
   * `bltu`@24 does not (unsigned 4294967295 is not < 1), so pc 16 is fetched and flushed.
   *
   *    0 addi t0,x0,-1   4 addi t1,x0,1   8 addi a0,t0,0  12 blt t0,t1,20
   *   16 addi a0,t1,0  ← FLUSHED: N counts 9, not 10
   *   20 addi a1,t0,0  24 bltu t0,t1,32  28 addi a1,t1,0  32 addi a7,x0,10  36 ecall
   *
   * **The clearest place in the corpus to watch the turnaround ceiling alone**: not one dependence
   * here ever stalls anything, and every stall is a unit that has not turned around yet. The two
   * `li`s issue at 1 and 2; `mv a0,t0`@8 ⇒ **2 `'structural-int'`** at 3, 4, issuing 5. `blt`@12
   * issues 6 and resolves at 8, so pc 16 pays **1 `'control'`** at 7 and dies in the flush.
   *
   * `mv a1,t0`@20 issues 9 off the redirect. `bltu`@24 issues 10 and resolves at 12 — declining, so
   * it releases the fall-through the same cycle. That fall-through, `mv a1,t1`@28, therefore pays
   * **1 `'control'`** (at 11) and then **1 `'structural-int'`** (at 12) — **two different reasons
   * at one pc, one cycle apart**, and a demonstration of `issueBlocker`'s reporting order: at cycle
   * 12 the register-result table still claims a1 from `mv a1,t0`, so this is also a live WAW, but
   * no unit exists to put the instruction in and the structural answer is reported first.
   *
   * `li a7`@32 issues 14 and `ecall`@36 pays **2 `'structural-int'`**, issuing at `s_last = 17`.
   * `tail = 4`, cycles = 21.
   */
  'branch-flavors.s': {
    retires: 9,
    takenTransfers: 1,
    stalls: {
      8: { 'structural-int': 2 },
      16: { control: 1 },
      28: { control: 1, 'structural-int': 1 },
      36: { 'structural-int': 2 },
    },
    lastWriter: { pc: 36, issueOffset: 0, latency: INT_LATENCY, ownStalls: 0 },
  },

  /**
   * 6 retires, no branches, two loads — **the corpus's memory-turnaround witness**.
   *
   *    0 lui t0    4 addi t0,t0    8 lb t1,0(t0)    12 lbu t2,0(t0)   16 addi a7,x0,10  20 ecall
   *
   * The `la` pair costs its usual **3 `'waw'`** at pc 4, so t0 is not written until 8. `lb`@8 takes
   * the idle memory unit at 6 and then waits for t0 ⇒ **2 `'operand'`** at 7, 8; it reads at 9 and
   * writes at `9 + 4 + 1 = 14`. `lbu`@12 wants the same single port from cycle 7 and cannot have
   * it until the clock edge of 14 ⇒ **8 `'structural-mem'`**, the longest single-site stall in the
   * corpus and the memory unit's 7-cycle turnaround plus the load's 1 stalled operand cycle it had
   * not yet paid when the second load arrived.
   *
   * `lbu` therefore issues at 15 and writes at **21**, while `li a7`@16 and `ecall`@20 sail past it
   * into the two idle integer units at 16 and `s_last = 17`. **The last writer is the `lbu`, two
   * issues from the end** — `tail = 3 + 4 + 0 − 2 = 5`, cycles = 22.
   */
  'byte-loads.s': {
    retires: 6,
    takenTransfers: 0,
    stalls: {
      4: { waw: 3 },
      8: { operand: 2 },
      12: { 'structural-mem': 8 },
    },
    lastWriter: { pc: 12, issueOffset: 2, latency: MEM_LATENCY, ownStalls: 0 },
  },

  /**
   * 9 dynamic instructions — and **the corpus's one starved front end**, `E = 1`.
   *
   *    0 addi a0,x0,17   4 addi a1,x0,42   8 jal ra,max  12 addi s0,a0,0  16 addi a7,x0,10
   *   20 ecall          24 bge a0,a1,done 28 addi a0,a1,0  32 jalr x0,x1,0  ← last word of .text
   *
   * `jal`@8 pays **2 `'structural-int'`** at 3, 4 (the two `li`s hold both units), issues 5 and
   * resolves at 7, so pc 12 pays **1 `'control'`** at 6 and dies in the flush. `bge`@24 issues 8
   * and declines at 10, releasing `mv a0,a1`@28 that same cycle after **1 `'control'`** at 9.
   * `ret`@32 pays **1 `'structural-int'`** at 11 and issues at 12.
   *
   * **And then nothing happens for a cycle, invisibly.** `ret` is the last word of `.text`, so
   * fetch stopped when it issued and `IF` is empty at cycle 13 — a cycle Issue spends blocked on an
   * unresolved transfer with nobody to charge the `'control'` stall to. The redirect lands at 14
   * (with no `flush` event, since there is no casualty: **2 taken transfers, 1 flush**) and pc 12 is
   * re-fetched there. Without `E = 1` the identity reads `s_last = 18` against the true 19.
   *
   * The return target `mv s0,a0`@12 issues 15, `li a7`@16 at 16, and `ecall`@20 pays **2
   * `'structural-int'`**, issuing at `s_last = 19`. `tail = 4`, cycles = 23.
   */
  'call-return.s': {
    retires: 9,
    takenTransfers: 2,
    starved: 1,
    stalls: {
      8: { 'structural-int': 2 },
      12: { control: 1 },
      20: { 'structural-int': 2 },
      28: { control: 1 },
      32: { 'structural-int': 1 },
    },
    lastWriter: { pc: 20, issueOffset: 0, latency: INT_LATENCY, ownStalls: 0 },
  },

  /**
   * The corpus's RE-ENTERED loop: 4 outer passes over a 6-iteration inner loop. 2 prologue +
   * 4 × (1 guard + 1 header + 6 × 3 inner + 2 footer) + 2 epilogue = 92 retires; 24 inner
   * iterations; 23 taken transfers. Nothing is loaded or stored — **its whole subject is control,
   * and it is the one corpus program with no memory unit in the picture at all.**
   *
   *    0 addi a0,x0,0   4 addi t2,x0,4
   *    8 bne x0,x0,done ← the guard that never fires, once per pass    12 addi t1,x0,6
   *   16 addi t1,t1,-1  20 addi a0,a0,1  24 bne t1,x0,inner
   *   28 addi t2,t2,-1 32 bne t2,x0,outer   36 addi a7,x0,10  40 ecall
   *
   * **A PASS is self-similar with period 53** (the guard@8 issues at 5, then 58, 111, 164), with
   * the same single exception as `array-sum-twice`: the 2 `'structural-int'` cycles the guard pays
   * in pass 1 vanish in passes 2–4, where the outer branch's redirect has left a unit free.
   *
   * PER PASS. The guard@8 issues 5 and declines at 7, so `li t1`@12 pays **1 `'control'`** at 6 and
   * issues at 7 on the decline. Inner iteration 1's `addi t1`@16 is blocked twice over — **1
   * `'structural-int'`** at 8, then **2 `'waw'`** at 9, 10 while `li t1` still claims t1 — the
   * second (pc, reason) pair at one site in this table, and the only WAW in the corpus that is not
   * a `la`.
   *
   * INNER STEADY STATE (period **7**, measured at 11 → 18 → 25 and converged from iteration 1).
   * Only two sites pay: `bne`@24 **2 `'structural-int'`** and the fall-through `addi t2`@28 **1
   * `'control'`**, every one of the 24 iterations ⇒ 48 and 24. `addi a0`@20 never stalls at all —
   * the accumulate is the only instruction in the corpus's hot loops that always finds a free unit,
   * because the branch ahead of it has just released one.
   *
   * PASS FOOTER. The 6th `bne`@24 declines and `addi t2`@28 issues on it; `bne t2`@32 then pays
   * **1 `'structural-int'`** and **1 `'operand'`** (t2's decrement has not landed), and `li a7`@36
   * **2 `'control'`** behind it — once per pass, four times over, whether the outer branch goes or
   * declines.
   *
   * EPILOGUE. `li a7`@36 issues at 216 on the final decline; `ecall`@40 pays **1
   * `'structural-int'`** and issues at `s_last = 218`. `tail = 4`, cycles = 222.
   */
  'nested-loop.s': {
    retires: 92,
    takenTransfers: 23,
    stalls: {
      8: { 'structural-int': 2 },
      12: { control: 4 },
      16: { 'structural-int': 4, waw: 8 },
      24: { 'structural-int': 48 },
      28: { control: 24 },
      32: { 'structural-int': 4, operand: 4 },
      36: { control: 8 },
      40: { 'structural-int': 1 },
    },
    lastWriter: { pc: 40, issueOffset: 0, latency: INT_LATENCY, ownStalls: 0 },
  },

  /**
   * 5 retires, two never-taken branches back to back — **the corpus's cleanest `'control'`
   * witness**, because nothing is ever flushed and no operand is ever waited on.
   *
   *    0 bne x0,x0,done   4 bne x0,x0,done   8 addi a0,x0,42   12 addi a7,x0,10   16 ecall
   *
   * The first branch issues at 1 and resolves at 3. The second therefore pays **1 `'control'`** at
   * 2 and issues at 3 on the decline — a not-taken branch releases the instruction already sitting
   * in `IF` in the very cycle it resolves, with no redirect and no bubble, which is why `T = 0`
   * here and the identity closes on `N + D` alone. The second resolves at 5 and `li a0`@8 repeats
   * the pattern: **1 `'control'`** at 4, issue at 5.
   *
   * After that it is pure turnaround: `li a7`@12 pays **1 `'structural-int'`** and `ecall`@16
   * another, issuing at `s_last = 9`. `tail = 4`, cycles = 13. Every source in this program is x0,
   * so the whole 13 cycles are the machine's own shape and none of the program's.
   */
  'paired-branches.s': {
    retires: 5,
    takenTransfers: 0,
    stalls: {
      4: { control: 1 },
      8: { control: 1 },
      12: { 'structural-int': 1 },
      16: { 'structural-int': 1 },
    },
    lastWriter: { pc: 16, issueOffset: 0, latency: INT_LATENCY, ownStalls: 0 },
  },

  /**
   * 4 prologue + 4 per iteration × 6 + 2 epilogue = 30 retires; `bnez` goes 5 times.
   *
   *    0 addi t1,x0,6   4 addi a0,x0,0   8 addi t5,x0,3  12 addi t6,x0,2
   *   16 sll t3,t5,t6  20 add a0,a0,t3  24 addi t1,t1,-1 28 bne t1,x0,loop
   *   32 addi a7,x0,10 36 ecall
   *
   * ⚠ **The `sll` is an ORDINARY one-cycle op here.** `slowOpLatency` is an out-of-order knob this
   * model ignores entirely (plan decision 4), and RV32I has no multi-cycle arithmetic — so the
   * program written to showcase a long-latency ALU shows the turnaround ceiling instead, and its
   * three stall sites are all units, not latencies.
   *
   * PROLOGUE. The `li`s at 0 and 4 issue at 1, 2; `li t5`@8 pays **2 `'structural-int'`** and
   * issues 5; `li t6`@12 issues 6.
   *
   * STEADY STATE (period **10**, measured at 9 → 19 → 29 and converged from iteration 1). Every one
   * of the 6 iterations pays the same four sites: `add`@20 **2 `'operand'`** waiting for the shift
   * (`sll` issues at S and writes at S+3; the `add` issues at S+1 and would read at S+2), `addi
   * t1`@24 **2 `'structural-int'`**, `bne`@28 **2 `'structural-int'`**, and the fall-through
   * `li a7`@32 **1 `'control'`** ⇒ 12 / 12 / 12 / 6. The `sll`@16 itself stalls only in iteration 1
   * (**2 `'structural-int'`**, while the two `li`s still hold both units); from iteration 2 on the
   * branch's redirect has always freed one for it.
   *
   * EPILOGUE. The 6th `bne` declines at 68 and releases `li a7`@32 that cycle; `ecall`@36 pays
   * **1 `'structural-int'`**, issuing at `s_last = 70`. `tail = 4`, cycles = 74.
   */
  'slow-op-loop.s': {
    retires: 30,
    takenTransfers: 5,
    stalls: {
      8: { 'structural-int': 2 },
      16: { 'structural-int': 2 },
      20: { operand: 12 },
      24: { 'structural-int': 12 },
      28: { 'structural-int': 12 },
      32: { control: 6 },
      36: { 'structural-int': 1 },
    },
    lastWriter: { pc: 36, issueOffset: 0, latency: INT_LATENCY, ownStalls: 0 },
  },

  /**
   * 7 retires, no branches — a store followed by a load of the SAME address.
   *
   *    0 lui t0     4 addi t0,t0    8 addi t1,x0,99   12 sw t1,0(t0)
   *   16 lw a0,0(t0)  20 addi a7,x0,10   24 ecall
   *
   * The `la` pair costs **3 `'waw'`** at pc 4 as always. `li t1`@8 issues 6. `sw`@12 takes the idle
   * memory unit at 7 and waits for BOTH its sources — t0 lands at 8, t1 at 9 ⇒ **2 `'operand'`** —
   * reading at 10 and finishing at 15. `lw`@16 wants the same port from cycle 8 ⇒ **8
   * `'structural-mem'`**, issuing 16 and writing at **22**.
   *
   * `li a7`@20 and `ecall`@24 take the two long-idle integer units at 17 and `s_last = 18`, so
   * **the load outlives them both**: `tail = 3 + 4 + 0 − 2 = 5`, cycles = 23. The store's ordering
   * against the load is structural rather than scheduled — one blocking port, so this model needs
   * none of M9's disambiguation machinery, and the 8 stalled cycles ARE that guarantee.
   */
  'store-forward.s': {
    retires: 7,
    takenTransfers: 0,
    stalls: {
      4: { waw: 3 },
      12: { operand: 2 },
      16: { 'structural-mem': 8 },
    },
    lastWriter: { pc: 16, issueOffset: 2, latency: MEM_LATENCY, ownStalls: 0 },
  },

  /**
   * 2 prologue + 3 per iteration × 10 + 2 epilogue = 34 retires; `bnez` goes 9 times. The hottest
   * loop in the corpus and the simplest steady state in this table.
   *
   *    0 addi a0,x0,0   4 addi t0,x0,10
   *    8 add a0,a0,t0  12 addi t0,t0,-1  16 bne t0,x0,loop
   *   20 addi a7,x0,10 24 ecall
   *
   * The two `li`s issue at 1, 2. `add`@8 pays **2 `'structural-int'`** at 3, 4 and issues 5 — the
   * prologue's only stall, and pure turnaround.
   *
   * STEADY STATE (period **7**, measured at 5 → 12 → 19 and converged from iteration 1 — every
   * iteration of this loop costs exactly the same, prologue included). Two sites: `bne`@16 **2
   * `'structural-int'`** (the `add` and the decrement hold both units) and the fall-through
   * `li a7`@20 **1 `'control'`** ⇒ 20 and 10 over ten iterations. Nothing here ever waits on an
   * operand: each producer's write lands exactly the cycle before its consumer needs it, which is
   * what makes this the cleanest place to read the ceiling — **34 instructions in 80 cycles, and
   * 33 of the 46 non-issue cycles are the machine turning units around.**
   *
   * EPILOGUE. The 10th `bne` declines at 74 and releases `li a7`@20 that cycle; `ecall`@24 pays
   * **1 `'structural-int'`**, issuing at `s_last = 76`. `tail = 4`, cycles = 80.
   */
  'sum-loop.s': {
    retires: 34,
    takenTransfers: 9,
    stalls: {
      8: { 'structural-int': 2 },
      16: { 'structural-int': 20 },
      20: { control: 10 },
      24: { 'structural-int': 1 },
    },
    lastWriter: { pc: 24, issueOffset: 0, latency: INT_LATENCY, ownStalls: 0 },
  },
};

// ---------------------------------------------------------------------------------------------
// Driving and folding. Everything below reads the TRACE — events and `micro` — and never the
// engine's internals (INV-3).
// ---------------------------------------------------------------------------------------------

function asm(source: string): AssembledProgram {
  const { program, errors } = assemble(source);
  if (!program) {
    throw new Error(
      'assembly failed:\n' + errors.map((e) => `  ${e.line}:${e.column} ${e.message}`).join('\n'),
    );
  }
  return program;
}

/** Drive a program to halt under the neutral config, collecting every cycle. */
function drive(source: string, label: string): CycleTrace[] {
  const cpu = new ScoreboardProcessor();
  cpu.reset(toProgramImage(asm(source)), defaultConfig());
  const traces: CycleTrace[] = [];
  while (!cpu.isHalted()) {
    if (traces.length >= MAX_CYCLES) throw new Error(`${label}: exceeded ${MAX_CYCLES} cycles`);
    traces.push(cpu.step());
  }
  return traces;
}

const run = (file: string): CycleTrace[] => drive(readFileSync(PROGRAMS_DIR + file, 'utf8'), file);

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

/** The run's stall histogram in the table's shape: pc → reason → cycles. */
function stallSites(ts: CycleTrace[]): Record<number, Partial<Record<string, number>>> {
  const pcs = pcById(ts);
  const sites: Record<number, Partial<Record<string, number>>> = {};
  for (const stall of eventsOf(ts, 'stall')) {
    const pc = pcs.get(stall.instr);
    if (pc === undefined) throw new Error('a stall names an instruction that was never fetched');
    const row = (sites[pc] ??= {});
    row[stall.reason] = (row[stall.reason] ?? 0) + 1;
  }
  return sites;
}

/** Every issue cycle the run recorded, from the instruction-status table. */
function issueCycles(ts: CycleTrace[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of ts) {
    for (const row of (t.state.micro as ScoreboardMicro).instructions) {
      if (row.issue !== null) out.set(row.instr, row.issue);
    }
  }
  return out;
}

/** `s_last` — the cycle the LAST instruction to issue issued. */
const lastIssue = (ts: CycleTrace[]): number => Math.max(...issueCycles(ts).values());

/** Every instruction whose Write-Result was the last in the run, as `pc` + its issue cycle. */
function lastWriters(ts: CycleTrace[]): { pc: number; issue: number }[] {
  let best = -1;
  let out: { pc: number; issue: number }[] = [];
  for (const t of ts) {
    for (const row of (t.state.micro as ScoreboardMicro).instructions) {
      if (row.writeResult === null) continue;
      if (row.writeResult > best) {
        best = row.writeResult;
        out = [{ pc: row.pc, issue: row.issue ?? -1 }];
      } else if (row.writeResult === best && !out.some((w) => w.issue === row.issue)) {
        out.push({ pc: row.pc, issue: row.issue ?? -1 });
      }
    }
  }
  return out;
}

/** `D` — the stall cycles that BLOCK ISSUE, the only ones the closed form can see. */
function issueStalls(pinned: Timing): number {
  let d = 0;
  for (const row of Object.values(pinned.stalls)) {
    for (const [reason, n] of Object.entries(row)) {
      if (STAGE_OF[reason as ScoreboardStallReason] === 'ID') d += n ?? 0;
    }
  }
  return d;
}

/** Stall cycles charged at one stage across the whole pinned table — `D`'s two counterparts. */
function stallsAtStage(pinned: Timing, stage: 'ID' | 'RO' | 'WB'): number {
  let total = 0;
  for (const row of Object.values(pinned.stalls)) {
    for (const [reason, n] of Object.entries(row)) {
      if (STAGE_OF[reason as ScoreboardStallReason] === stage) total += n ?? 0;
    }
  }
  return total;
}

/** `s_last = N + D + T + E` — identity 1. */
const predictedLastIssue = (p: Timing): number =>
  p.retires + issueStalls(p) + p.takenTransfers + (p.starved ?? 0);

/** `tail = 3 + L + ownStalls − issueOffset` — identity 2, from the NAMED last writer. */
const predictedTail = (w: LastWriter): number => 3 + w.latency + w.ownStalls - w.issueOffset;

const FILES = Object.keys(TIMING);

// ---------------------------------------------------------------------------------------------

describe('the pinned timing table — s_last = N + D + T + E, cycles = s_last + tail', () => {
  it('covers every program in the corpus', () => {
    // The corpus is enumerated from disk by the conformance harness, so a program added at step 6
    // is differentially tested automatically — but it would NOT get a timing entry automatically,
    // and a table that silently stopped covering the corpus is exactly the decay this suite exists
    // to prevent. Fail loudly and make the author derive the new entry by hand.
    const corpus = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.s'));
    expect(corpus.length, 'guard the guard against an empty read').toBeGreaterThan(0);
    expect([...corpus].sort()).toEqual([...FILES].sort());
  });

  it.each(FILES)('%s', (file) => {
    const pinned = TIMING[file]!;
    const ts = run(file);

    // N and T are the PROGRAM. This model honors no config, so there is no axis to vary them
    // across — but asserting them here is still what makes D and the tail attributable: a schedule
    // that "went faster" by losing an instruction or taking a different branch is caught on its own
    // line rather than as a wrong total.
    expect(eventsOf(ts, 'instr-retire'), 'N — instructions that retire').toHaveLength(
      pinned.retires,
    );
    expect(
      eventsOf(ts, 'branch-resolved').filter((e) => e.actual),
      'T — control transfers that go',
    ).toHaveLength(pinned.takenTransfers);

    // Every stall, by site AND by reason. Keyed by (pc, reason) rather than by pc because one site
    // here genuinely reports different reasons on consecutive cycles — `branch-flavors.s`@28 and
    // `array-sum.s`@40 both do — so a pc-keyed histogram would hide a mechanism swap behind a
    // matching total.
    expect(stallSites(ts), 'the stall multiset, by site and reason').toEqual(pinned.stalls);

    // ...and the same events split by the stage that reported them: the corpus-scale form of "WAW
    // stalls at Issue, WAR stalls at Write-Result, operands wait inside the unit".
    for (const stage of ['ID', 'RO', 'WB'] as const) {
      expect(
        eventsOf(ts, 'stall').filter((e) => e.stage === stage),
        `stalls reported at ${stage}`,
      ).toHaveLength(stallsAtStage(pinned, stage));
    }

    // IDENTITY 1 — the issue accounting. Note what is NOT in it: the `'operand'` and `'war'` cycles
    // are excluded by construction, because `RO` is non-blocking and a stall there costs no issue
    // slot. On `array-sum.s` that is 26 stall events the closed form cannot see.
    expect(lastIssue(ts), 's_last = N + D + T + E').toBe(predictedLastIssue(pinned));

    // IDENTITY 2 — the drain, charged to a NAMED instruction rather than to a residual.
    const writers = lastWriters(ts);
    expect(writers, 'exactly one instruction writes last').toHaveLength(1);
    expect(writers[0]!.pc, 'the last writer').toBe(pinned.lastWriter.pc);
    expect(
      lastIssue(ts) - writers[0]!.issue,
      'how many issues before the end the last writer went',
    ).toBe(pinned.lastWriter.issueOffset);

    // ...and only then the closed form.
    expect(ts).toHaveLength(predictedLastIssue(pinned) + predictedTail(pinned.lastWriter));
  });

  it('array-sum.s and strided-sum.s are ONE data point, not two', () => {
    // Byte-for-byte the same instruction stream (only the pointer bump's immediate and the `.data`
    // values differ), and this machine is cache-blind — which is the whole difference the two
    // programs exist to show on the models that have one. So a derivation that reproduces either
    // reproduces the other automatically, and neither cross-checks the other. Asserted so a future
    // reader cannot count the table's twelve rows as twelve independent witnesses.
    const a = run('array-sum.s');
    const b = run('strided-sum.s');
    expect(a).toHaveLength(b.length);
    expect(stallSites(a)).toEqual(stallSites(b));
  });
});

/**
 * ⚠ The hazard this milestone exists for is INVISIBLE on the shipped corpus. Asserted rather than
 * left as a table with no `'war'` rows, because an all-empty result that is documented as empty is
 * a different artifact from a missing one — and because this is the line step 6 flips.
 */
const WAR_IS_ABSENT = "'war' never fires on the shipped corpus — the hole step 6 closes";

describe('what the corpus cannot show', () => {
  it(WAR_IS_ABSENT, () => {
    for (const file of FILES) {
      expect(
        eventsOf(run(file), 'stall').filter((e) => e.reason === 'war'),
        // One line deliberately: a template literal wrapped in the source carries its own
        // indentation into the failure output, exactly when it is hardest to read.
        `${file} — WAR needs a younger writer at WB while an older reader holds an unread copy`,
      ).toEqual([]);
    }
    // The other half of the same sentence: WAW is everywhere, so this suite IS a net for it (the
    // mutation table in the header measures exactly that asymmetry).
    const wawPrograms = FILES.filter((f) =>
      Object.values(TIMING[f]!.stalls).some((row) => (row.waw ?? 0) > 0),
    );
    expect(wawPrograms.sort(), 'the six programs the WAW mutation reddens').toEqual(
      [
        'array-sum-twice.s',
        'array-sum.s',
        'byte-loads.s',
        'nested-loop.s',
        'store-forward.s',
        'strided-sum.s',
      ].sort(),
    );
  });

  it('every WAW in the corpus comes from a `la`, except one', () => {
    // The step-0 corpus scan read source mnemonics and reported zero reachable WAW hazards; the
    // WAW half of that was wrong, because `la rd, sym` assembles to `lui rd` + `addi rd, rd` — two
    // writers to one register, one instruction apart. Pinned here so the provenance of the six
    // `'waw'` rows is a fact rather than a remark: each `la`'s second word stalls exactly 3 cycles,
    // the producer's full integer turnaround minus the issue it already had.
    const laSites: [string, number][] = [
      ['array-sum.s', 4],
      ['strided-sum.s', 4],
      ['array-sum-twice.s', 12],
      ['byte-loads.s', 4],
      ['store-forward.s', 4],
    ];
    for (const [file, pc] of laSites) {
      const perInstance = file === 'array-sum-twice.s' ? 2 : 1; // one `la` per outer pass
      expect(TIMING[file]!.stalls[pc]?.waw, `${file}@${pc}`).toBe(3 * perInstance);
    }
    // The exception, and it is a real WAW rather than a pseudo-op artifact: `nested-loop.s` resets
    // its inner counter with `li t1, 6` and immediately decrements it, so the decrement claims a
    // register the reset has not written yet — 2 cycles, once per pass.
    expect(TIMING['nested-loop.s']!.stalls[16]?.waw).toBe(8);
  });
});

// ---------------------------------------------------------------------------------------------
// The coefficients, isolated on hand-built programs. These are the table's SECOND witness: every
// corpus row shares one derivation, and `array-sum`/`strided-sum` share one program.
// ---------------------------------------------------------------------------------------------

describe("the machine's own shape, with no program in the way", () => {
  it('THE CEILING: two integer units, a 4-cycle turnaround, 0.5 IPC with no hazard at all', () => {
    // Six instructions with distinct destinations, every source x0: no RAW, no WAW, no WAR, no
    // transfer, no memory. Everything below is the machine.
    const source = [
      '.text',
      'addi x1, x0, 1',
      'addi x2, x0, 2',
      'addi x3, x0, 3',
      'addi x4, x0, 4',
      'addi x5, x0, 5',
      'addi x6, x0, 6',
    ].join('\n');
    const ts = drive(source, 'ceiling');

    // Issue goes in PAIRS: two units fill at 1 and 2, and neither frees until the clock edge of 4
    // and 5, so the next pair issues at 5 and 6, the next at 9 and 10.
    expect([...issueCycles(ts).values()]).toEqual([1, 2, 5, 6, 9, 10]);
    // Which makes the stalls the ceiling itself: the first instruction of every pair after the
    // first waits two cycles for a unit, and the second waits none.
    expect(stallSites(ts)).toEqual({
      8: { 'structural-int': 2 },
      16: { 'structural-int': 2 },
    });
    // 6 instructions, 14 cycles. The asymptote is 2 issues per 4 cycles — half an instruction per
    // cycle — on code with nothing wrong with it. Every `'structural-int'` count in the corpus
    // table above is this number, and it is the largest term in all of them.
    expect(ts).toHaveLength(14);
    expect(lastIssue(ts)).toBe(6 + 4 + 0); // N + D + T, with E = 0
  });

  it('the MEMORY unit turns around in 7, and it is one blocking port', () => {
    // The pointer is set up three instructions early so the first load never waits on an operand
    // and the gap between the two loads is nothing but the unit.
    const source = [
      '    .data',
      'v:  .word 11, 22',
      '    .text',
      '    lui  x5, 0x10000',
      '    addi x6, x0, 0',
      '    addi x7, x0, 0',
      '    lw   x1, 0(x5)',
      '    lw   x2, 4(x5)',
    ].join('\n');
    const ts = drive(source, 'mem-turnaround');
    const issues = [...issueCycles(ts).values()];

    expect(issues).toEqual([1, 2, 5, 6, 13]);
    // 6 → 13 is `1 (RO) + 4 (MEM) + 1 (WB) + 1 (the clock edge frees the unit)`, and the second
    // load spends every one of the intervening cycles saying so. Nearly twice the integer unit's 4,
    // which is the whole reason `MEM_LATENCY` was derived rather than picked.
    expect(issues[4]! - issues[3]!).toBe(1 + MEM_LATENCY + 1 + 1);
    expect(stallSites(ts)).toEqual({
      8: { 'structural-int': 2 },
      16: { 'structural-mem': 6 },
    });
    expect(lastIssue(ts)).toBe(5 + 8 + 0);
    // The second load is also the last writer, one issue from the end of a five-instruction
    // program: `tail = 3 + 4 + 0 − 0 = 7`.
    expect(ts).toHaveLength(13 + 7);
  });

  it('E: a transfer at the last word of .text stalls a cycle that NO event records', () => {
    // The starved front end, isolated to three instructions. `jalr` is the last word of `.text`, so
    // fetch stops the moment it issues and the cycle it spends unresolved has no victim in `IF` to
    // charge a `'control'` stall to. `call-return.s` is the corpus's only instance; this is the
    // mechanism without the program around it.
    const source = ['.text', '_start:', 'jal ra, sub', 'ecall', 'sub:', 'jalr x0, ra, 0'].join(
      '\n',
    );
    const ts = drive(source, 'starved');

    expect(eventsOf(ts, 'instr-retire'), 'N').toHaveLength(3);
    expect(
      eventsOf(ts, 'branch-resolved').filter((e) => e.actual),
      'T',
    ).toHaveLength(2);
    // ONE control stall — the `ecall` behind the `jal`. The `jalr` blocks Issue for a cycle too and
    // nothing in the trace says so.
    expect(stallSites(ts)).toEqual({ 4: { control: 1 } });
    // And the second taken transfer emits no `flush` either, for the same reason: the flush
    // contract reports real casualties, and an empty `IF` slot has none.
    expect(eventsOf(ts, 'flush')).toHaveLength(1);

    // The identity fails by exactly one without E, and closes with it. Asserted in both directions
    // so the term cannot be quietly dropped as a fudge.
    expect(lastIssue(ts), 'N + D + T alone under-counts').not.toBe(3 + 1 + 2);
    expect(lastIssue(ts), 'N + D + T + E').toBe(3 + 1 + 2 + 1);
    expect(ts).toHaveLength(7 + predictedTail({ pc: 4, issueOffset: 0, latency: 1, ownStalls: 0 }));
  });

  it('an operand stall costs ZERO issue slots — identity 1 cannot see it at all', () => {
    // `RO` is per-unit and non-blocking (plan decision 2b), so an instruction waiting for a
    // producer holds nothing but its own unit and gives up no issue slot. Two programs differing in
    // ONE register make that concrete: the same five instructions, the same issue schedule, the
    // same N / D / T — and 5 operand stalls against 0.
    const prefix = [
      '    .data',
      'v:  .word 11, 22',
      '    .text',
      '    lui  x5, 0x10000',
      '    addi x6, x0, 0',
      '    addi x7, x0, 0',
      '    lw   x1, 0(x5)',
    ];
    const onTheLoad = [...prefix, '    addi x2, x1, 1'].join('\n');
    const onAnAdd = [...prefix, '    addi x2, x6, 1'].join('\n');

    const waits = drive(onTheLoad, 'operand-waits');
    const free = drive(onAnAdd, 'operand-free');

    // Identical where the closed form looks. The consumer issues at 7 in BOTH runs — the machine
    // never held an issue slot open for the operand it was missing.
    for (const [label, ts] of [
      ['waits', waits],
      ['free', free],
    ] as const) {
      expect([...issueCycles(ts).values()], label).toEqual([1, 2, 5, 6, 7]);
      expect(lastIssue(ts), `${label}: s_last = N + D + T`).toBe(5 + 2 + 0);
    }

    // ...and completely different in the histogram: the load writes at 12, so a consumer that
    // issued at 7 spends 8–12 stalled inside its unit while the rest of the machine carries on.
    expect(stallSites(waits)[16]?.operand, 'waiting on the load').toBe(5);
    expect(stallSites(free)[16]?.operand, 'waiting on nothing').toBeUndefined();

    // Where they DO differ is identity 2, and only there: the waiting consumer becomes the last
    // writer and its own stalls land in the tail (3 + 1 + 5 − 0 = 9), while in the free run the
    // load itself writes last, one issue from the end (3 + 4 + 0 − 1 = 6).
    expect(waits).toHaveLength(7 + 9);
    expect(free).toHaveLength(7 + 6);

    // Asserted once more where it bites: `array-sum.s` balances BOTH identities exactly while
    // carrying 26 operand stalls, not one of which appears in `D`.
    const arraySum = run('array-sum.s');
    expect(
      eventsOf(arraySum, 'stall').filter((e) => e.reason === 'operand'),
      'stall cycles the issue accounting does not contain',
    ).toHaveLength(26);
    expect(lastIssue(arraySum)).toBe(predictedLastIssue(TIMING['array-sum.s']!));
  });
});
