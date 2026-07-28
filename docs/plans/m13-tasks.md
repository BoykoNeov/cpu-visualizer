# Milestone 13 — The wide machine, widened (issue width > 2)

**Status: IN PROGRESS — steps 0, 0b, 1 and 2 DONE 2026-07-28. The guard now admits 1..4 and the
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
- [ ] **3. The timing matrix at widths 3 and 4 — DERIVED, never copied.** `cycles = G + L + P + M +
4`. M7 step 2b shipped six of seven counts pinned from the engine's own output and step 4 had
      to redo them; this step does not repeat that. Predict each new cell from the closed form
      BEFORE running the engine, as M7 step 4 did for its seven forwarding-OFF counts. Acceptance:
      every width-3/4 cell derived and asserted term by term (G, L, P, M separately — `L` counted
      DIRECTLY as "stall fired AND nothing issued", never as a residual, or the assertion is
      `0 === 0`).
- [ ] **4. Conformance and `configLabel` at N widths.** The matrix gains two width columns.
      `configLabel` already knows `issueWidth` (M7 step 3) — verify it does not collide at 3 and 4,
      and remember why that guard exists: **both new columns are green by construction, so a
      duplicated title is indistinguishable from a correct one, permanently.**
- [ ] **5. Recorder and `location` at width ≥ 3.** Expected to be free — `follow()` keys on `id`, and
      `location` is a plain string that already absorbed `"EX.1"`. Prove it rather than assume it,
      and state explicitly what is NOT re-proven.
- [ ] **6. Web enablement — the ISSUE toggle gains positions.** `models.ts`, `session.ts`,
      `useSimulator.ts`, `App.tsx`. Gated by decision **W** below. Import `MAX_ISSUE_WIDTH` rather
      than typing a `4`. **Decide the OUT-OF-ORDER model's bound here, before the control ships.**
      `out-of-order/processor.ts` runs `positiveCapacity('issueWidth', width)` with **no upper
      bound**, and it shares this control: the moment positions 3/4 exist, a user on
      `model: out-of-order` hands that engine a width nothing in the repo tests. Two lawful answers
      — cap it at `MAX_ISSUE_WIDTH` too, or gate the control's positions per model — and the choice
      must be made rather than discovered in the browser pass. **Carries one deliberate debt from
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
      what lets lanes be added without hand-typed endpoints silently detaching. Two things are NOT
      mechanical and need watching: `LANES` is a hard-coded `[0, 1]`, and the forwarding rails are
      built on "lane 0's returns ride the TOP rails, lane 1's the BOTTOM" — an outboard-side scheme
      with exactly two sides, which four lanes do not have.
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
