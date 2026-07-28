# Milestone 13 — The wide machine, widened (issue width > 2)

**Status: IN PROGRESS — steps 0, 0b, 1, 2, 3, 4 and 5 DONE 2026-07-28. The guard now admits 1..4 and the
engine half of the milestone is essentially finished, exactly as the dump predicted: step 1 changed
the guard and roughly twenty docblocks, and NOTHING else. Step 0's findings are below; they
overturned two of the three things this milestone was expected to be. The pre-milestone defect it
uncovered is ALREADY FIXED AND PUSHED (`a9f1b70`, repo 4498 → 4502 tests) — it was live in shipped
code at width 2 and did not belong inside an unpinned milestone. The two GATING decisions are PINNED
(user, 2026-07-28): the UI offers widths 1/2/3/4, and the lane hue set EXTENDS to four validated
tints. The second overrode its seed, and the seed was wrong for a reason worth keeping — see
_Decision H_ at the bottom. A third row — the maximum width the guard admits — was answered by
implication and is now implemented; the rest are open and none of them gates step 2.**

Source of truth for scope: `cpu-visualizer-spec.md` §12.4 (the superscalar tier) and the
architectural invariants (§3). The model's ground truth is `docs/plans/m7-tasks.md`, whose pairing
rules this milestone generalizes **in place** rather than forking.

## Why this milestone, and why now

`future-microarchitectures.md` recorded a two-axis don't-foreclose flag from 2026-07-16: deeper
pipelines and a wider machine. **M11 delivered the depth half** (the 7-stage), and its log closes
with the other axis still open: `superscalar/processor.ts` refuses `issueWidth > 2` **by name**, so
the shipped product's widest machine is two. Width is the last axis in that flag, and after it the
roadmap's original §12 list plus both don't-foreclose items are all delivered.

What is genuinely new: **nothing about the machine, and that is the finding.** See below.

---

## The dump (the design's factual ground) — RUN 2026-07-28

`M:\claud_projects\temp\m13-step0\dump.txt` (pre-fix) and `dump-postfix.txt` (post-fix, the one to
read). Every corpus program × widths {1,2,3,4} × three representative configs: total cycles, the
issue-group size histogram from `micro.idEx`, max group size, retire-id monotonicity, final register
state, and the refusal-reason histogram. The guard was temporarily widened to run it and reverted
after; the working tree is clean.

### Cycles, forwarding ON / predict none / no cache

| program         |  w1 |  w2 |  w3 |  w4 | w3→w4 | max group |
| --------------- | --: | --: | --: | --: | ----: | --------: |
| add             |   7 |   6 |   6 |   6 |     — |         2 |
| array-sum       |  51 |  42 |  36 |  36 |     — |         3 |
| array-sum-twice | 208 | 178 | 152 | 152 |     — |         3 |
| branch-flavors  |  15 |  11 |  10 |  10 |     — |         4 |
| byte-loads      |  10 |   9 |   8 |   8 |     — |         3 |
| call-return     |  17 |  14 |  12 |  12 |     — |         3 |
| paired-branches |   9 |   7 |   7 |   6 | **1** |         4 |
| slow-op-loop    |  44 |  35 |  34 |  33 | **1** |         4 |
| store-forward   |  11 |   9 |   8 |   8 |     — |         3 |
| strided-sum     |  51 |  42 |  36 |  36 |     — |         3 |
| sum-loop        |  56 |  44 |  43 |  43 |     — |         3 |

Final architectural state is identical across all four widths on every program and every config, and
retire-id order is strictly increasing everywhere. The other two config columns agree in shape.

### What the dump established — three findings, two of which overturn the plan this milestone had

**1. The issue logic is ALREADY width-generic. There is no "generalize the pairing rules" work.**
The memory's "the rules are written for a pair" was a description of the guard's error MESSAGE, not
of the code. `stageId` loops `s < this.width`; `issueVerdict` loops `for (const older of group)` and
asks each rule against the whole group; `detectHazard` scans `this.width` slots of both older stages;
`stageIf`'s hand-over is a seat-filling loop with no arity in it. Widths 3 and 4 produce correct
architectural state on the entire corpus **with the guard as the only thing changed**. So the engine
half of this milestone is a guard, an audit, and a net — not a rewrite. **Budget moves to the view
and to the adversarial nets accordingly.**

**2. The dump found a LIVE DEFECT in shipped code, and it was not a width-3 defect.** A halt
(`ecall`) in an unresolved branch's shadow raised the sticky `haltFetch` at issue; when the branch
resolved taken, the halt was wrong-path, but fetch never restarted — the pipe drained, `halted` was
never raised, and every caller looping on `isHalted()` hung, including the web app. **Reachable at
shipped width 2**: `bnez` immediately followed by `ecall`. The corpus was safe only by accident of
its exit idiom (`li a7, 10` sits between the branch and the `ecall` in all eleven programs), which is
why 4498 tests were green. Fixed in `a9f1b70` ahead of this milestone, with the fix chosen as the one
of three candidates that cannot move a pinned cycle count; `timing` (606) and `pairing` (21) confirmed
unmoved. **The general lesson for the table below: the corpus's uniformity is itself a blind spot,
and every program in it shares an exit idiom.**

**3. Width 4 is where widening stops paying, and the corpus can show it.** Nine of eleven programs
are cycle-identical at w3 and w4; only `paired-branches` (7→6) and `slow-op-loop` (34→33) gain, one
cycle each. Max group size reaches 4 on just three programs and only for a cycle or two. The binding
constraint is `intra-pair-raw` (it roughly doubles from w2 to w4 — `sum-loop` 0 → 11, `array-sum`
11 → 18), joined at w4 by `branch-slot` appearing where it never fired at w2 (`array-sum-twice` 0 →
24). **This is a pedagogical asset, not a disappointment** — "the fourth slot is mostly empty, and
here is which rule keeps it empty" is the honest lesson of the width axis, and it is the argument for
offering 4 in the UI rather than against it. It is seeded as such below.

---

## Headline decision — N-wide IN PLACE, with the three pairing rules unchanged in kind

One data-memory port, one branch unit, no intra-group RAW — per GROUP, not per pair. Finding 1 says
the code already reads them that way. **Relaxing any of them (multiple memory ports, a second branch
unit, intra-group forwarding) is a different milestone** and would un-confine the widening exactly as
M7's log warns: those three rules are what keep the doubling down to fetch, register-read ports, the
ALU, the write ports and the forwarding source set. The wedge is evidence FOR this scope, not
against it — it was a missing UNDO, not a missing fourth rule.

## Build order (each step testable before the next)

- [x] **0. The dump.** ✅ DONE 2026-07-28 — above.
- [x] **0b. The halt-shadow fix.** ✅ DONE 2026-07-28, `a9f1b70`. Pre-milestone: a live width-2
      defect does not wait for a milestone the user has not pinned.
- [x] **1. The guard, and the width-genericity audit.** ✅ DONE 2026-07-28 (repo 4503 → 4504 tests).
      `MAX_ISSUE_WIDTH = 4` is now **exported from the superscalar package**, so steps 4/6/7 read the
      bound from the engine that enforces it instead of re-typing a `4` in `models.ts`/`App.tsx`.
      The guard is `!Number.isInteger(w) || w < 1 || w > MAX_ISSUE_WIDTH` — the M9+M10 review's
      capacity shape, because `w < 1` alone is false for both `NaN` and `1.5`, and a NaN width makes
      every `s < this.width` body unreachable (a processor that fetches nothing and never halts).
      **The audit's code half came back EMPTY, and that is the finding worth recording:** a sweep
      for literal slot indexing (`idEx[0|1]`, `exMem[…]`, `ifSlot[…]`, …) across all of `packages/`
      matched exactly one line, in a test, deliberately about slot 0. So there was no arity-2 CODE
      to fix — only prose. What did get fixed was ~20 docblocks and comments, and one of them was a
      real defect rather than a stale phrasing: `CycleCtx.bet` claimed the bet's casualty set "grows
      by exactly one seat", which is `width - 1` seats. It never reached the trace (`flush.stages`
      names stage families, so N dead ID seats and one are both the string `'ID'`), which is exactly
      why it survived. `'intra-pair-raw'` is **deliberately not renamed** — it is a trace field three
      consumers read, so a rename moves bytes for a spelling; it now carries a line saying the name
      is historical and means intra-GROUP, and step 8 owns the rename if it ever happens.
      **Acceptance MET, and stated with what it does and does not prove.** 396 whole-trace sets
      (11 programs × widths {1,2} × 18 configs: forwarding × 3 predictions × {no cache, small,
      large}), 22 455 cycles, ~50 MB of serialized trace: **396/396 byte-equal** pre vs post.
      Non-vacuity was checked first — `MachineState.memory` is a `SparseMemory` whose `Map` is
      private, so a naive `JSON.stringify` emits `{}` and the compare would silently pass on memory
      everywhere; the serializer enumerates `definedAddresses()`, and the goldens carry `array-sum`'s
      `a0 = 120` and its 20 data words. The compare was falsified too (w1≠w2, fwd≠nofwd,
      cache≠nocache on the same program), so it can see a machine change. But byte-identity here is
      CHEAP information, and saying so is the honest report: since the audit changed no code outside
      the guard, nothing could have moved. `timing` (606), `pairing` (21), `differential` (398) pass
      with zero numbers touched. Harness: temp-only, deleted after the compare; goldens under
      `M:\claud_projects\temp\m13-step1\{pre,post}\`.
      **One thing borrowed from step 2, on purpose:** opening the guard makes 3/4 REACHABLE, and
      `halt-shadow.test.ts`'s bounded sweep is the only net in the repo that converts a width-3/4
      non-termination into a red test rather than a hung suite (every other runner loops
      `while (!p.isHalted())` unbounded). Its `WIDTHS` is now derived from `MAX_ISSUE_WIDTH`, not
      typed `[1, 2, 3, 4]`, so raising the bound cannot leave the widest machine the least tested.
      Corpus × 4 widths × forwarding × prediction × cache all terminate.
      **And that borrowed net immediately paid, with the step's real finding.** Run against the
      PRE-`a9f1b70` engine, the widened sweep wedges **72 corpus cells** — 36 at width 3, 36 at
      width 4, in `array-sum-twice.s`, `slow-op-loop.s` and `sum-loop.s`, in each of the 12 no-bet
      configs per program per width (`static-taken` escapes at every width, exactly as the bet rule
      predicts). The reason is exact: **the `li a7, 10` spacer buys precisely ONE slot of
      protection**; at width 3 a single issue group swallows branch, spacer and `ecall` together.
      So `a9f1b70` was a HARD PREREQUISITE for opening the guard, not a courtesy cleanup — without
      it this step would have shipped a machine on which three of eleven shipped corpus programs
      hang the web app at width 3. Generalizes past this repo: **an idiom that makes a whole corpus
      safe is buying a fixed number of slots, and widening spends them.** It also corrected the
      wedge test's own prose, which said "width 2" where it meant "width ≥ 2" and called its cell
      "the only position of the six" — a claim about the GUARD wearing the clothes of a claim about
      the machine, i.e. the same defect class as the `CycleCtx.bet` miscount, in the file that now
      sweeps four widths.
      Both new assertions were **watched failing against deliberately broken engines** before being
      kept (the M11+M12 method lesson): `?? 1` → `?? 2` reddens the default test; latches allocated
      at `min(width, 2)` while `width` is stored honestly reddens the shape test — and that is
      precisely the bug the obvious `expect(micro.width).toBe(w)` cannot see, since it only checks
      that `reset()` remembered its argument.
- [x] **2. The adversarial engine nets — what the corpus does not show, and one thing it turns out
      it does.** ✅ DONE 2026-07-28 (repo 4504 → 4523 tests), 19 cases in
      `packages/engine/superscalar/src/wide-groups.test.ts`.
      The scoped heading for this step was "the THREE things the corpus CANNOT show", and **the measurement falsified it for (b)** — see below; the sentence is
      corrected here rather than left standing, which is the `CycleCtx.bet` lesson applied to the
      file that records the contradiction.
      **Four provocations, not three.** The fourth came from asking what break would be invisible at
      width 2 _by construction_: (d) **the pairing rules asked of a NON-LEADER older group member.**
      `issueVerdict`'s `for (const older of group)` and a single check against `group[0]` are the
      SAME FUNCTION at width 2 — when slot 1 is judged the group holds exactly the leader — so every
      existing test in the package is blind to the difference. Three programs, one per rule, each
      packed (by dumping) so the conflicting member sits at ID slot 1 or 2 while the leader is
      innocent. `intra-pair-raw` is the sharpest: breaking it is a WRONG ANSWER (`x8` ends 1 instead
      of 10), where the two structural rules only cost a port.
      **(a) Same-`rd` co-issue — and it needed TWO programs, not one.** Three writers of x1 co-issue
      (nothing refuses it: no RAW between them) and the consumer must forward the youngest. But
      `resolveOperand` has TWO descending scans, and the obvious program only reaches the first:
      with the writers in EX/MEM the MEM/WB loop never sees more than one candidate, so its arity
      was left in exactly the state step 1 left the other one in — read, not watched. A second
      program puts a whole filler GROUP between writers and consumer so they drain to MEM/WB.
      Capping each loop at two slots reddens only its own cases, which is what proves they are two
      provocations.
      **(b) The MEM freeze with more than one follower — and the corpus DOES build it.** Widths 3/4
      hold 2 and 3 followers behind a missing load (width 2 holds exactly one, pinned here as the
      reason the geometry needs width ≥ 3). Retire-id monotonicity is the assertion. The break —
      hold only the FIRST follower — also reddens `halt-shadow.test.ts`, where the cell
      `store-forward.s @ w3/nofwd/none/cache2` throws _"halted at cycle 21 with instructions still
      in flight"_. So this hole is corpus-reachable at width 3, and the heading was wrong about it.
      **(c) A transfer in a non-zero slot of a full group — the last slot is the DEGENERATE end.**
      A slot-3 transfer kills nobody in EX, which is structurally what a width-2 slot-1 transfer
      does; it is kept because the plan names it, but two shapes carry the information. The MIDDLE
      slot has both older survivors AND younger casualties in one stage — a state width 2 cannot
      build (pinned by a test that shows the same program at width 2 producing only one side). The
      LEADING slot has three younger mates to kill, where width 2 has one; "everything above me
      dies" and "the slot above me dies" are the same sentence at width 2 and different ones here.
      Both bet spellings are covered too: a bet from the middle kills one ID seat of three, a bet
      from the last slot kills none and `stages` is `['IF']` alone.
      **Acceptance MET — seven breaks watched, and the record is the step's real finding.** Two are
      invisible to the rest of the repo (the two capped scans: 4519 and 4521 green, only this file
      red). Three are caught by exactly ONE existing file, `halt-shadow.test.ts`, and only because
      step 1 derived its `WIDTHS` from `MAX_ISSUE_WIDTH` — **and every time it reports a hang or an
      internal-invariant crash rather than the defect.** So the repo's width-3/4 coverage after step
      1 was a liveness net that converts arity bugs into crashes without naming them; three of these
      four sections exist to give those crashes a diagnosis. Every width-1/2 suite stayed green
      under all seven, which is the measurement that says this file reaches ground they cannot.
      Two further notes worth keeping: an eighth candidate break was **rejected as provably inert**
      (`ctx.squash.slot !== slot` looks like it would kill a middle-slot transfer's older mates, but
      EX is walked oldest-first, so those slots have already executed) — an edit that reads like a
      bug and cannot be one; and the first version of one assertion was a **tautology over a string
      literal** (`SAME_RD.match(/addi x1,/g).length === 3`), replaced by a corpus sweep that measures
      the claim it was pretending to make. Every geometry in the file was DUMPED AND READ before its
      assertion was written, and the freeze program's first draft reached the right shape only by
      accident of the slide — its load was refused from slot 2 and slid to lead the next group.
- [x] **3. The timing matrix at widths 3 and 4 — DERIVED, never copied.** ✅ DONE 2026-07-28 (repo
      4523 → **5113** tests), all in `timing.test.ts` — extended IN PLACE rather than forked, so
      `measure`/`issuedPerCycle`/`run`/`penaltyOf` keep one owner. Derivations in
      `M:\claud_projects\temp\m13-step3\predictions.md`, written in full BEFORE the engine ran.
      **The blocker was in the SUITE, not the engine, and it was this step's vacuity trap.**
      `issuedPerCycle` looped `s < 2` (M7 step 4's arity). Left alone, every group of 3 or 4 would
      have read as at most 2, `G` would have come out too high, and all 44 derived cells would have
      been fitted to a broken ruler — permanently green. **Step 1's audit could not have found it:**
      that sweep matched literal slot indexing (`idEx[0|1]`, `exMem[…]`), and this arity is a loop
      bound over a TEMPLATE STRING. Now a parameter, taking the width the CALLER asked for rather
      than `micro.width` off the trace — the two differ only if the engine ran narrow while claiming
      wide, and over-scanning empty slots is harmless where trusting the engine's own claim would
      hide exactly that bug.
      **`Q` does not generalize; the ISSUE-SIZE HISTOGRAM does.** `sizes[k]` = cycles that dispatched
      exactly `k`, and `G + Q = retires + doomed` becomes `Σ k·sizes[k] = retires + doomed`, both
      sides measured from the trace. That is what answers this plan's own trap about width-4
      assertions measuring width 3 — and on this corpus it answers it out loud: **only
      `branch-flavors.s`, `paired-branches.s` and `slow-op-loop.s` ever fill four slots**, measured
      and asserted by name, so the other eight programs' width-4 cells now SAY they are width-3
      measurements instead of implying otherwise.
      **Acceptance MET, and the blind claim stated honestly.** The w3/w4 totals at forwarding-ON /
      predict-none / no-cache are published in the step-0 dump table above, so those eleven numbers
      are a CROSS-CHECK, not a prediction; claiming otherwise would be the `CycleCtx.bet` defect
      class again. Genuinely blind: the entire term decomposition at both widths, every
      forwarding-OFF count, every `static-taken` count, both cache columns. **435 of 441 wide cells
      green on the first run WITH A CORRECT COMPARISON** — and that qualifier is doing real work, so
      it is stated rather than rounded away. The literal first run was 441 red, on a spec error in
      the assertion and not in a single derived number: `measure` indexes `sizes[0]` (cycles in which
      nothing issued at all) and the comparison included it, which would have made the "issue-size
      histogram" pin depend on `L` and `P`, terms the same test already asserts separately. A
      histogram of group sizes has no entry for "no group". It went red on every wide cell at once,
      which is the good failure mode.
      **The six that failed are ONE number, and the engine was right.** `call-return.s` @ {w3, w4} ×
      OFF × `static-taken`: predicted `L = 0`, measured 1. Diagnosed by DUMPING the trace rather than
      patching the pin: under the base behaviour the `jal`'s two-cycle misprediction penalty is
      exactly the gap its producers need to reach WB, so `bge` never interlocks; **the correct bet
      deletes that gap**, ID runs a cycle earlier, and meets both `addi`s still standing in EX/MEM.
      The bet buys 2 cycles of flush and hands 1 straight back. It is a WIDTH-3 effect — at width 2
      the `jal` sits in the second group and bets a cycle later, which is why `w2.blocked` is 0 in
      both positions. **Widening the machine moved the bet one cycle earlier and exposed an interlock
      that had never fired anywhere in the repo.** Generalises: _a penalty and a stall can be
      covering for each other, and removing the penalty is what reveals the bill._ It was also the
      risk NAMED IN ADVANCE as most likely to be wrong (#4, the forwarding-OFF `L` values); the other
      three named risks were all predicted correctly, including `array-sum-twice`'s `branch-slot`
      firing 24 times at w3 as well as w4, which this plan's own prose had implied was w4-only.
      **Three breaks watched, and the second is the step's real evidence.** Restoring `s < 2` reddens
      **432** cells while all 764 width-1/2 cells stay green. Capping the issue group at 3 reddens
      **55** — exactly the three programs that fill four slots — and `branch-flavors.s` at width 4
      still runs **exactly 10 cycles** under it: `issue slots consumed: expected [9, 10, 10] to
deeply equal [9, 10, 11]`. **No cycle count in the repo can see that break**; only the
      histogram and the accounting identity catch it, which is the whole case for pinning a
      histogram instead of a `pairs` count.
      **Two findings about the machine that the cycle counts hide, both now asserted:**
      _(i)_ `paired-branches.s`'s 9 → 7 → 7 → 6 resolves into something better than arithmetic. w3
      buys nothing NOT because the third slot goes unused — it fills. G is 3 at w2 and w3 with
      different shapes (`{1,2,2}` against `{1,3,1}`): the third slot pulls `addi a7` forward and
      thereby pushes `ecall` out of the tail group into one of its own. **The widening moved work
      between groups without reducing their number.** w4 is where the tail finally fits in one group.
      _(ii)_ `slow-op-loop.s`'s single w4 cycle is **entirely a PROLOGUE effect** — four independent
      `li`s, one group of four, ONCE in a run of six iterations; the loop body is byte-identical at
      both widths. That is why the gain is 1 cycle and not 6, and it is the width axis's honest
      lesson: _the fourth slot pays where four independent instructions sit in a row, and real loop
      bodies do not._ Its mirror: **`static-taken` SPENDS the width** — a bet ends its group, so
      `paired-branches.s` runs 6 at w4 under the base behaviour and 11 under betting, the same 11 it
      runs at w3.
      **And one structural finding the field shape now records:** `groups`/`sizes`/`doomed` are NOT
      keyed by forwarding position at width ≥ 3, because the toggle never moves the partition there —
      asserted, not assumed. At width 2 it did: `array-sum.s` runs G = 25/26 across the toggle
      because the `lw@16`'s slot-1 `raw` refusal splits a pair. **A third slot MASKS it** — the same
      `lw` is refused for `intra-pair-raw` whatever the toggle says, and pairing rules are checked
      first. Widening deleted the corpus's only forwarding-shaped partition change.
      `WIDE_WIDTHS` is DERIVED from `MAX_ISSUE_WIDTH` with a completeness test per program, so
      raising the bound cannot leave the widest machine unpinned in silence (step 1's precedent).
      **A review pass then found a DEAD PINNED FIELD in the step's own output**, which is the third
      time this milestone has caught that shape (after M12's `Lesson.depthDefault` and step 2's
      string tautology): the accounting test ran the base behaviour only, so `wide[3].taken.doomed`
      and `wide[4].taken.doomed` were pinned for all eleven programs and **read by nothing** — while
      the docblocks made load-bearing claims about exactly those numbers ("doomed 18 → 0", "doomed
      24 → 0"). It now runs across both behaviours and selects with `cellOf`; inverting one
      `taken.doomed` reddens 2 cells where it previously reddened 0. The same pass found the
      `fillsFour` complement asserting `TIMING[...].sizes[4] === undefined` — a property of a literal
      three hundred lines above it that no engine change could falsify — now measured, and stated as
      **eight of eleven** rather than a hand-picked four. And one wrong number in prose (`array-sum`'s
      OFF `L` derivation carried a visible false start and called a difference of one "two"), which is
      the `CycleCtx.bet` class in the step that cites it. Repo 5113 → **5157** tests.
      **All five gates run** — test, typecheck, lint, format, and `build`.
- [x] **4. Conformance and `configLabel` at N widths.** ✅ DONE 2026-07-28 (repo 5157 → **5558**
      tests). The superscalar matrix goes 36 → **72 configs** (`WIDTHS` now DERIVED from
      `MAX_ISSUE_WIDTH`, step 1/3's precedent), `conformance.test.ts`'s `FOUR_AXIS` guard goes from
      two widths to four, and `configLabel` gained a fix the step went looking for a different bug
      and found instead.
      **The scoped question has a boring answer, and saying so is the point.** `width ${w}` is
      injective over distinct integers, so there is **no collision at 3 and 4** — there was never
      going to be. What the step is worth is that the claim is now MECHANICAL rather than eyeballed,
      on the one axis where eyeballing is all anyone would ever do.
      **The hole that does exist is not about width 3 or 4 — it is `undefined` vs. the default.**
      Every optional knob was compared RAW (`c.issueWidth !== first.issueWidth`) and rendered
      DEFAULTED (`?? 1`). So a list holding an unset config beside an explicit `issueWidth: 1` calls
      them distinct, fires the clause, and prints `width 1` **twice** — the exact inverse of the
      `cacheEquals`/`cacheLabel` invariant this same file declares load-bearing ("the label renders
      exactly the fields the equality distinguishes"), sitting on the one axis with no failing column
      to expose it. Same shape in `outOfOrderIssue` (`undefined`/`false` both render `in-order`) and
      `robSize` (`undefined`/`16` both render `rob 16`) — and `robSize` was the closest to being
      reached, since the OoO cross-product leaves it unset and only `ROB_SIZE_PROBE` states one. All
      three now default BOTH sides. The correct outcome is **silence, not two names**: absent and the
      explicit default are the same machine. The rejected alternative — render absent as
      `width unset` — was rejected because it MOVES TITLES (it would rename every out-of-order case).
      **The break record, and the second break is the step's whole thesis measured.** Four watched:
      (1) revert the defaulted compare → the new guard reddens alone, message `add.s [width 1]`, the
      duplicate title printed in the failure; (2) **collapse the render to `min(w, 2)` → three
      conformance guards redden and the superscalar's 797-test matrix stays ENTIRELY GREEN** (835 of
      838 passing, every failure in the guard file). That is step 4's own warning as an experiment:
      72 configs running under 54 distinct titles, widths 3 and 4 wearing width 2's name, and not one
      cell red. Nothing but the guard can see it. (3) cap `WIDTHS` at 2 → both completeness
      assertions redden and NAME which end was lost (`[1,2]` vs `[1,2,3,4]`; 36 vs 72) while all 396
      surviving cells stay green; (4) move the engine's guard to `MAX_ISSUE_WIDTH - 1` while the
      constant stays 4 → the guard/constant cross-check reddens, the only edit that can separate them.
      **Title invariance MEASURED, not argued** — the constraint that would otherwise have been
      invisible, since nothing in this repo asserts on pre-existing `it()` titles, so a `configLabel`
      edit that renamed five other suites would leave the run green and teach nothing. Full JSON title
      dumps of all seven `runConformance` call sites plus the harness's own suite, before and after:
      1140 → 1541, **0 removed**, 401 added and all 401 confined to the two edited files, all 1541
      distinct. The five other differential suites read byte-identically.
      **What the 396 new cells buy, stated for what it is worth — and one claim walked back.** The
      step-0 dump had MEASURED final-state agreement at widths 3/4, but measuring in a temp script
      and holding it in a suite are different things and nothing in the repo held it. That pin is
      the honest answer, and very nearly the whole of it. They buy **nothing** on the
      mis-copied-ISA-idiom class the width-1 column exists for — that bug is width-invariant, so it
      was already caught, and 396 more green cells do not catch it harder. They cannot see
      out-of-order retirement: M7 step 2b's bug ran green through a matrix of exactly this shape.
      And the first draft of this entry called them **"a second bounded-liveness sweep"**, which is
      an overclaim: `checkProgram` does cap at 100 000 steps and throw, but `halt-shadow.test.ts`
      already sweeps these same cells under a **500-cycle** bound. A weaker bound over ground already
      swept is not an independent net. Corrected here rather than left standing, because "say which
      of your green checks was cheap" is this milestone's own rule and the failure mode it names is
      exactly a number stated more confidently than what it measures.
      **One consumer checked before the invariance claim was allowed to generalise.** The title dump
      covered the seven `runConformance` call sites; `packages/web/src/lessons.test.ts` also mentions
      `configLabel` and sat outside that glob. It turns out to be prose only — two citations of the
      M4 collision as precedent — and it cannot be otherwise: `configLabel` is module-private (the
      package exports only `runConformance`) and that file imports nothing from
      `engine-conformance`. So the claim is "titles unchanged across every consumer", checked rather
      than assumed.
      **The DAG decided where each half of the claim lives.** `engine-conformance` is model-agnostic
      by eslint rule and sits below every model, and `engine-superscalar` imports it — so importing
      `MAX_ISSUE_WIDTH` back would be a package cycle. The harness file therefore owns the SHAPE claim
      (N distinct widths ⇒ N distinct labels, widths literal) and the superscalar's own file owns the
      COMPLETENESS claim (the matrix reaches every width the guard admits, derived). Checked before
      writing rather than discovered by a lint failure.
      **A fifth unfailable check caught before it shipped** — after M12's `Lesson.depthDefault`, step
      2's string tautology, and step 3's dead `taken.doomed` pin. The absent-vs-default guard's first
      draft asserted the duplicate titles COLLAPSE (`distinct === cases.length / 2`) — but under the
      raw compare both configs still render `width 1`, so that count holds identically in both worlds
      and could never redden. Replaced by set-equality against the titles a lone neutral config
      produces, which does. **In the file whose subject is unfailable green checks.**
      **One finding handed to step 6 rather than fixed here:** `configLabel` renders `?? 1`, which is
      the SUPERSCALAR's default — `ProcessorConfig.issueWidth`'s own docblock records that the
      out-of-order model defaults absent width to **2**. In a model-agnostic harness that is a label
      naming a width the machine did not run. Unreachable today (every OoO config states its width),
      and deliberately left: step 6 is where a shared control makes it reachable. OoO `WIDTHS` stays
      `[1, 2]` for the same reason — that is step 6's pinned decision, not step 4's to pre-empt.
- [x] **5. Recorder and `location` at width ≥ 3.** ✅ DONE 2026-07-28 (repo 5558 → **5575** tests).
      It WAS free, and the acceptance is `git diff --stat`: **two test files, zero engine or recorder
      lines.** `packages/trace/src/recorder.ts` is untouched — `TraceRecorder` has no width awareness
      anywhere in it, `follow()` keys on `id`, `InstructionSighting.location` is a plain string. The
      split follows the boundary `recorder.test.ts` already declares: the encoding's set claims went
      into `processor.test.ts`, navigation / `follow()` / micro-tracking into `recorder.test.ts`,
      both extended IN PLACE. Dumps at `M:\claud_projects\temp\m13-step5\dump.txt`.
      **When a step is a proof, the failure mode is not a red test — it is a GREEN one that measures
      width 2.** Everything below exists because of that, and the fixture was the first casualty.
      **`TEN_INDEPENDENT` stops scaling at width 2, and no amount of care in the assertion would
      have fixed it.** M7's headline was "ten ids, ten distinct locations, one cycle" = 5 stages × 2
      seats. The width-4 analogue is 20 — and that fixture holds ELEVEN instructions, so at widths 3
      and 4 it peaks at **11 in flight, not 15 or 20**: the whole program is in the pipe at once by
      cycle 2. A parameterized `5 × width` assertion over it would have been red, and a
      `toBeGreaterThan` would have been green and meaningless. `TWENTY_INDEPENDENT` (20 independent
      `addi`s) makes the peak exactly **5 / 10 / 15 / 20 at cycle 4** at widths 1/2/3/4 — the one
      fixture in the file whose peak moves with the width at all. Generalises: **a fixture sized for
      the old width is not "still valid at the new one", it is a different measurement wearing the
      same name** — dump its peak before parameterizing anything over it.
      **SUBSET and SURJECTIVITY are different claims with different scopes, and conflating them is
      this step's version of the plan's named lie.** "No location outside `STAGES × [0..w-1]`" holds
      on every program at every width. "Every slot index appears" does NOT: measured, the surjective
      set is all eleven programs at w1 and w2, **all but `add.s` at w3, and exactly
      `branch-flavors` / `paired-branches` / `slow-op-loop` at w4** — the same three names
      `timing.test.ts`'s `fillsFour` reaches from an issue-size histogram. Two independent
      measurements landing on the same three is the cross-check worth having; asserting surjectivity
      corpus-wide would have been a width-4 test measuring width 3.
      **And the asymmetry that CAUSES it is the width axis's own lesson, now pinned: at width 4 TEN
      programs emit `IF.3` and THREE emit `EX.3`.** Fetch is not gated by the pairing rules —
      `stageIf` fills every seat it can reach — while issue is gated by all three, so the last seat
      is fetched into routinely and issued from almost never. That gap is "the fourth slot is mostly
      empty, and here is which rule keeps it empty", measured at the trace layer instead of argued.
      **A genuinely new geometry at width ≥ 3: a slot can move by MORE THAN ONE in a single cycle.**
      The width-2 spelling of "a slot is not a stable lane" is structurally weaker than it reads —
      with seats {0, 1} the only possible move is by one, whatever the issue logic does. The existing
      four-instruction `SLIDER` fixture builds the real thing at width 3 with no new program:
      `IF.0 → ID.2`, a jump of two, while its two elders slide 1→0 and 2→1 in the same cycle — three
      seats moving at once, in two directions. Measured across all widths the largest jump is
      **[0, 1, 2, 1]**, and the `1` at the end is the point: **width 4 is NOT the extreme case** (all
      four fit, so the group slides down uniformly and nothing jumps). Step 2's "ask which slot makes
      the claim differ from its width-2 spelling, not which is extreme", arriving from the other side.
      **Two breaks watched, and the interesting result is how CLEANLY they separate.**
      _(1) Clamp the emitted slot to `min(s, 1)` in `place()`_ — step 4's `min(w, 2)` experiment one
      layer down, a machine running wide and reporting narrow: **494 of 2157 package tests red, and
      every one of them a width-3/4 cell.** Every new width-3/4 cell reddens.
      The width-1/2 half of that sentence is **measured per-test across the whole package**, not
      inferred from the count — a first pass ran the JSON reporter over only the two edited files and
      would have shipped "every width-1/2 cell green" as an extrapolation from 2 of 8 files, which is
      step 4's own "a measurement's glob is part of its claim" recurring in the step that cites it.
      Measured: the 494 are `timing.test.ts`'s `widths 3 and 4 — the derived schedule` block (468),
      `wide-groups.test.ts` in its entirety (14, a file whose whole subject is arity > 2), and the 12
      new cells here. `timing.test.ts` keeps **772 green**; `pairing`, `differential`, `halt-shadow`,
      `miss-freeze-forward` and every width-1 pin in `processor.test.ts` are untouched. **Zero**
      failing tests are scoped to width 1 or 2; the only failure that names width 2 at all is
      `paired-branches.s: w2 and w3 run 7 cycles with DIFFERENT partitions`, which spans widths by
      construction.
      _(2) Slice the `micro` snapshot to `min(width, 2)` while `width` is stored honestly_ — the
      mirror, honest locations over a narrow recording: **exactly 3 of 2157 red** — step 1's shape
      test plus the two new micro-tracking cells at w3/w4, and nothing else in the repo. So those two
      cells are the only time-travel net for that hole, which is what step 2a's aliasing finding
      predicted one width earlier.
      **The subset test's own assertion turned out to be blind, and the break is how that was
      learned rather than argued.** Under break (1) the clamp emits only LEGAL locations, so the
      `legal.has(location)` loop never fires — what reddened was the **non-vacuity clause riding with
      it** (`some program reaches ID.${w-1}`). The docblock had claimed the test "stays green through
      it"; that was written before the break ran and is now corrected in place. **A test can be right
      about what it cannot see and still wrong about which of its own lines does the work.**
      **The mechanical sweep for arity-2 `location` consumers, run before believing "it's free" —
      one hit, and it is not step 5's.** It took **two spellings**, and the second was run only
      because step 3's own finding condemns the first: that blocker was a loop bound `s < 2` over a
      TEMPLATE STRING, and this step's opening pattern
      (`MAX_WIDTH|LANES\s*=|slot\s*[<>=]+\s*2|\[0,\s*1\]|width\s*===?\s*2`) could not have matched
      it — `slot\s*[<>=]+\s*2` does not match a bound named `s`. **An arity sweep finds the arities
      you spelled the way you searched, and the milestone had already paid for that once.** The
      second pass (`(<\s*2|<=\s*1)\b`, and separately a literal `.1`) over every non-test file in
      `packages/` came back with no new code: two `< 2` hits, both unrelated (a `6 * 12` comment and
      the OoO `slowOpLatency` docblock), and four `.1` hits that are **all prose** — the width-1
      "lane 1 is ABSENT, not dimmed" rule, restated in `datapath-superscalar.ts`, `App.tsx` and
      `SuperscalarDatapathView.tsx`. That prose is pair-shaped and moves with step 7 (at width 3 the
      hiding rule is "no `.2` occupant"), but it is documentation, not a defect.
      The one CODE hit: `packages/web/src/datapath-superscalar.ts` hard-codes
      `MAX_WIDTH = 2`; `parseLocation` returns `null` for any slot ≥ 2, so an `EX.2` occupant is
      **silently dropped from the datapath's occupancy map — no crash, no red test.** Recorded in the
      step-7 entry below and in `recorder.test.ts`'s NOT-re-proven list, deliberately not fixed here.
      `pairing-readout.ts` is arity-GENERIC (it reads `ID.${s}` over a `width` parameter); only its
      VOCABULARY is pair-shaped, which is step 8's. One false positive worth naming so the next sweep
      does not re-chase it: `multi-cycle/processor.ts`'s `width === 2` is a store's byte width.
      **Honesty notes.** `sum-loop`'s 43 and 43 are a **CROSS-CHECK, not a prediction** — both are in
      the step-0 dump table above and derived by `timing.test.ts`; they appear here as fixtures the
      way 56 and 44 always have. The widened `it.each` row list is a LITERAL (a config per row), which
      is the one thing a derived `WIDTHS` does not protect, so it carries a completeness assertion
      against `WIDTHS` — steps 1/3/4's guard, for the same reason. And the four-position toggle test
      pins that **width 4 buys nothing at all on `sum-loop`**: the diminishing return is the pinned
      product claim, not a disappointment to round away.
- [ ] **6. Web enablement — the ISSUE toggle gains positions.** `models.ts`, `session.ts`,
      `useSimulator.ts`, `App.tsx`. Gated by decision **W** below. Import `MAX_ISSUE_WIDTH` rather
      than typing a `4`. **Decide the OUT-OF-ORDER model's bound here, before the control ships.**
      `out-of-order/processor.ts` runs `positiveCapacity('issueWidth', width)` with **no upper
      bound**, and it shares this control: the moment positions 3/4 exist, a user on
      `model: out-of-order` hands that engine a width nothing in the repo tests. Two lawful answers
      — cap it at `MAX_ISSUE_WIDTH` too, or gate the control's positions per model — and the choice
      must be made rather than discovered in the browser pass. **Step 4 adds a third input to that
      decision, and it is a live inconsistency rather than a preference:** `configLabel` renders an
      absent width as `width 1`, which is the SUPERSCALAR's default — the out-of-order model defaults
      absent width to **2** (`ProcessorConfig.issueWidth`'s docblock says so). Today no OoO config
      leaves the field unset, so the label never lies; a shared control that can produce one is
      exactly what makes it reachable. Whatever is decided about the bound, the model-agnostic
      harness cannot keep rendering one model's default for all of them. **Step 4 also left the OoO
      differential's `WIDTHS` at `[1, 2]` on purpose** — widening it is this step's call, not step
      4's, and it should follow the bound decision rather than precede it. **Carries one deliberate debt from
      step 1:** `SUPERSCALAR_MODEL_DESCRIPTION`
      still reads "up to two instructions issue per cycle" and was left alone on purpose — it is the
      model picker's user-facing copy and describes what the product OFFERS, not what the guard
      admits, so widening it before the control would have promised a machine nobody could reach. It
      moves here, with the control. Note the M7 seam finding: deleting
      `issueWidth` from `loadInto`'s config left all web tests green because the field is optional
      and the engine's `?? 1` runs every position at width 1 — **a dead toggle reads the same number
      twice**, so the seam test must be a MOVING number.
- [ ] **7. The datapath at N lanes.** Decision **H** is PINNED: the lane set extends to four
      validated tints (`--lane-2`, `--lane-3` join `--lane-0`/`--lane-1`, in the base block and BOTH
      dark blocks — `styles.css` says "keep the two blocks identical" and a tint added to only one
      is a defect no headless test can see). The palette acceptance is spelled out under _Decision
      H_ below; it is re-validation work, not a color choice. The geometry itself is mechanical:
      `LANE_DY` is already a pitch and lane `n`'s block top is already `EX_TOP + n * LANE_DY`, and
      M7 step 7 derives every coordinate from its node via `at()`/`aUp()`/`aLo()` — which is exactly
      what lets lanes be added without hand-typed endpoints silently detaching. **Three** things are
      NOT mechanical and need watching: `LANES` is a hard-coded `[0, 1]`; the forwarding rails are
      built on "lane 0's returns ride the TOP rails, lane 1's the BOTTOM" — an outboard-side scheme
      with exactly two sides, which four lanes do not have; and **the third was found by step 5's
      sweep and is the one that fails silently.** `datapath-superscalar.ts` hard-codes
      `MAX_WIDTH = 2`, and `parseLocation` returns `null` for any slot ≥ 2 — so at width 3 an `EX.2`
      occupant is **dropped from the occupancy map with no crash and no red test**, and `byStage`
      allocates its slot array at `MAX_WIDTH` besides. The trace is already correct here (step 5
      proved it); the consumer is not. `MAX_WIDTH` should become `MAX_ISSUE_WIDTH` imported from the
      engine, not a second `4`. The complement, also measured by that sweep: `pairing-readout.ts` is
      arity-generic (it reads `ID.${s}` over a `width` parameter) and needs no geometry work — only
      the step-8 vocabulary pass.
- [ ] **8. The pairing readout and IPC at N lanes.** The panel's vocabulary is pair-shaped in the
      PROSE (`refused`/`blocked` are fine; "the pair in ID" is not). Keep the M7 step 8 rule that
      earned it: **read the RESULT (`micro.idEx`), never enumerate the REASONS** — the naive
      "no `stall` event ⇒ they issued together" rule is a lie a miss-freeze tells.
- [ ] **9. The browser pass.** Non-negotiable — `browser-is-the-only-net`: 9 of 10 view steps in
      project history shipped a defect only the browser caught, and no test here can see a click.

## Acceptance criteria

- [ ] `array-sum.s` at forwarding ON, flipping ISSUE across its positions **without reloading**,
      moves 51 → 42 → 36 live, matching the derived matrix.
- [ ] The datapath draws N execute lanes with the shared front end and single memory port intact;
      lane hiding at narrower widths stays TESTED, not argued (M7's rule: if a narrow width ever
      emits a `.N` location, the honest fix is an idle lane, not more hiding).
- [ ] All five gates green; INV-8 differential passes at every offered width.
- [ ] Widths 1 and 2 are byte-identical to their pre-milestone traces.

## How this milestone can lie to itself

- **The green that means nothing.** INV-8 is a FALSE net here and M7's log says so in capitals: an
  in-order machine retires in order, so final state is width-invariant **by construction**. The
  conformance matrix would pass with the issue logic completely wrong. The closed form is the net.
- **A test that passes at width 4 because nothing ever filled four slots.** Nine of eleven corpus
  programs never reach a group of 4. A width-4 assertion that does not first CHECK the group size it
  claims to exercise is measuring width 3. This is the `sum-loop`-does-not-slide lesson at the next
  width: **every expected group size must be dumped and read, never reasoned.**
- **A slot is not a stable lane, and at width 4 there are more ways to slide.** M7 pinned that
  sliding is neither monotone nor one-directional at width 2. Any test naming a slot must have been
  watched.
- **Assuming the corpus's shape is the language's shape.** Finding 2 is exactly this: eleven
  programs, one exit idiom, one hidden hang. Before trusting any corpus-wide sweep in this
  milestone, ask what all eleven programs happen to share.
- **...and its mirror image, which step 2 walked into: assuming the corpus CANNOT reach something.**
  Step 2 was scoped as "the three things the corpus cannot show" and one of the three was wrong —
  `store-forward.s` builds the multi-follower freeze at width 3, and the broken engine crashes on
  it. "No corpus program does X" is a measurement too, and it has a width at which it expires
  exactly as the exit-idiom spacer did. Where this milestone still needs the claim, it is now
  measured (§(a)'s corpus sweep for three same-`rd` co-issuers) rather than asserted in prose.
- **Copying width-3/4 counts out of the engine.** The M7 step 2b trap, already paid for once.
- **Explaining away `paired-branches`.** It runs 9 → 7 → 7 → **6**: flat from w2 to w3, then a gain
  at w4. That is an odd shape for a monotone-issue machine — a width the group never fills buying
  nothing, and the next one buying a cycle — and step 3 must account for it TERM BY TERM. If the
  closed form cannot, that is a finding about the machine, not an arithmetic slip to round away. It
  is the only program in the corpus with this shape, which is exactly why it is the one to check.

## Decisions to pin (seeded with recommended answers)

| Decision                              | Recommendation (seed)                                                                                                                                                                                                                                                                                                       | Pinned answer                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **W** — which widths the UI offers    | **1 / 2 / 3 / 4.** The honest case for 4 is not speed — it is that 4 is where widening visibly STOPS paying (9 of 11 programs identical to w3), and that is the width axis's real lesson. Offering 1/2/3 hides the diminishing return that makes the tier worth teaching. Gates steps 1, 6, 7                               | **As seeded — 1 / 2 / 3 / 4** (user, 2026-07-28)                        |
| **H** — the lane hue channel at N > 2 | Seeded as "tint lanes 0/1, neutral beyond" on the grounds that inventing hues is barred. **That seed was WRONG about which rule applies, and the correction is recorded here rather than quietly dropped** — see the note below the table. Gates step 7                                                                     | **EXTEND THE LANE SET TO 4 VALIDATED TINTS** (user, 2026-07-28)         |
| Scope of the pairing rules            | **Unchanged in kind** — one mem port, one branch unit, no intra-group RAW, per group. Relaxing any is a different milestone (see Headline decision)                                                                                                                                                                         | _open_                                                                  |
| A new corpus program                  | **No.** The dump answers the question that would have forced one: the existing corpus reaches groups of 3 and 4 and shows the diminishing return. An addition pays the full INV-8 ripple across six models (M12's finding). The adversarial programs in step 2 are hand-built INSIDE their test files, not corpus additions | _open_                                                                  |
| A new trace event / field             | **No** — predicted, not assumed. `location` already absorbs `"EX.3"` as a plain string, `stall.reason` is free-form, and `micro.idEx` is arity-generic. House record: M4 +1 field of 5, M6 +0, M7 +0, M11 +0                                                                                                                | _open_                                                                  |
| A lesson track for the wider machine  | **Not in this milestone.** M7/M8 and M11/M12 both split model+view from track; the existing "The wide machine" track would gain a delta lesson, which is the M12 shape and its own milestone                                                                                                                                | _open_                                                                  |
| Maximum width the guard admits        | **4**, matching the UI. A guard that admits more than the product offers is untested surface; the error message should name the reason, as today's does                                                                                                                                                                     | **4 — follows W; IMPLEMENTED step 1** as the exported `MAX_ISSUE_WIDTH` |

### Decision H — the correction the seed needed

The seed argued from "the 5-hue palette is machine-validated; never invent a hue." **That rule is
about `PHASE_COLORS`, the 5-slot STAGE set, and it does not govern the lane channel.** The lane
tints are a second, separate categorical set — `--lane-0` / `--lane-1` in `styles.css`, deliberately
NOT phase hues, with their own validation record: _"Machine-validated 2026-07-14 against both
surfaces — CVD separation dE 41.3 light / 42.6 dark."_ A 2-slot set that was validated at 2 slots
carries no prohibition on being validated at 4. M11's stage-family trick is not the relevant
precedent either: it existed because seven stages had to fold into a set that was fixed at five for
a different reason. Nothing fixes the lane set at two.

So extending it is lawful, and the work it creates is **re-validation, not invention**. Step 7's
palette acceptance, from the constraints the existing block already states:

- **CVD separation across all four tints**, on both surfaces, at least matching the recorded 2-slot
  dE — and measured, not eyeballed (the M7 step 7 precedent: "it looks tight" is exactly the
  judgement an eyeball is worst at, so the overlap check was run in SVG space instead).
- **No red and no amber**, at any slot — red is the danger/flush family and amber the warn wash, so
  a lane in either would impersonate a status. This is the real constraint on the two new hues, and
  it is tighter than it sounds once blue and magenta are also spoken for.
- **Lane 0 keeps aliasing the accent** — a single-issue machine's lane 0 is today's picture, and
  that is the right degenerate case.
- **The RELIEF RULE survives**: the existing set already ships one WARN (light magenta at 2.62:1
  against the surface), which is why a lane hue never appears without a text label and every
  lane-tinted node carries its lane number. Four tints must not add a second such warning, and the
  label rule stays pinned by test whatever the contrast comes out at.
