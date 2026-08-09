---
name: dynamic-branch-prediction
description: 'The CPU Visualizer dynamic-branch-prediction feature (plan docs/plans/dynamic-branch-prediction.md, STEPS 0 THROUGH 6 DONE - step 6 on 2026-08-09; the predictor panel ships, all four betting models bet from a live counter table, train it at resolve and record it deep-copied. Steps 7-8 remain: the browser pass, a lesson). Read before step 7, before writing any view fold over a per-cycle event (COUNT the events before choosing between a scalar and a list - a saturating counter means a diff-keyed highlight goes dark for exactly the branches that have been LEARNT), before deep-copying anything into a micro snapshot (a wrapper spread is exactly as broken as no copy - all four models reddened exactly 20), before adding a knob to a model that speculates, before writing a cross-model test, and before trusting a break row you wrote by hand. Headlines: INV-8 is a FALSE net on the three latch models and a REAL one on the out-of-order core (180 dynamic-only cells caught wrong-path instructions COMMITTING); a break-table count EXPIRES when the suite grows; depth and width argue for a counter for OPPOSITE reasons; the never-bets identity is a theorem on the superscalar and FALSE on the OoO; two call sites of one predicate need TWO tests and call-return.s is the only witness - AGAIN; App slot gates are untestable BY POSITION; and the cross-model test written to close a gap swept the wrong program and caught nothing. Also the reusable method for pricing an unbuilt config knob offline, and exactly where it stops working.'
metadata:
  node_type: memory
  type: project
  originSessionId: 6ec4b2ad-1f1a-45e6-8d48-6e4215353ac0
  modified: 2026-08-09T15:58:03.703Z
---

**Plan: `docs/plans/dynamic-branch-prediction.md`. Steps 0 through 6 complete — step 6 on 2026-08-09.
ALL FOUR betting models bet from a live counter table, train it at resolve, record it deep-copied,
and the panel DRAWS it.** A 1-bit/2-bit
saturating BHT riding `micro.predictor` (following `micro.cache`), wired into the four
`configurableBranchPrediction` models. Not a milestone — a feature, like [[keyboard-clock-control]]
and [[continuous-play]]. **Steps 7–8 remain: the browser pass, the lesson.** The
full measured tables live in the plan; only what a future session would otherwise re-derive is here.
Repo at 9492 tests.

## Step 6 — the panel, and the shape that had to be counted before it was typed (2026-08-09)

Shipped: `web/src/predictor-table.ts` (pure fold) + `PredictorTableView.tsx` (HTML half) + two test
files + CSS + an App slot, plus `counterGeometry`/`coldPredictorState` in `engine-common`. 9466 →
9492, five gates. Two commits: the panel, then the break harness's closures.

⚠ **The blocking question was the fold's SHAPE, and copying the neighbour would have been wrong.**
`CacheAccessView` is a scalar `access | null` and its docblock _justifies_ that with a model fact (at
most one memory instruction in MEM). **There is no equivalent fact for branch resolution** — so it
was counted before the type was written: over **672 runs / 31,140 cycles** (every model × width ×
issue mode × forwarding × dynamic scheme × program), max conditional `branch-resolved` per cycle is
**1**, from 4,984 conditional events. The fold still uses a **LIST**, because on the superscalar the 1
is structural (`issueVerdict`'s one branch unit) but on the OoO it follows from `stageDispatch`'s
freeze behind an un-bet transfer — a **correctness** mechanism a future knob could satisfy
differently. A scalar would then silently DROP the second train (the `memOccupant` shape). **A list
costs one word and removes the assumption instead of documenting it.** ⚠ The first sweep ran in 327ms
and reported max 1 with no counters; a sweep that fast is exactly the shape that measures nothing —
add run/cycle/event totals before believing any of them.

⚠ **464 trains leave the counter UNMOVED, so a diff-keyed highlight is disqualified by measurement.**
A saturating counter trained in the direction it is already parked at moves nothing, so a panel that
lights "the row that changed" goes dark for exactly the branches that have been **LEARNT** — the ones
the lesson is about. `branch-resolved` is the only honest source. Break row 3 confirms (reddens 2).
Before/after values are read from `recording.find(t => t.cycle === trace.cycle - 1)`, never by
inverting the update (wrong at the ceiling), and they live on the ENTRY not the train — with two
trains on one row no per-train intermediate value exists in the trace at all.

**The consult is deliberately NOT drawn, and the reason is INV-5.** A row is read at the bet and
written at the resolve; only the write is drawable, because `branch-predicted` fires **only on a
taken bet**. Lighting "consulted" rows would light ~half of them and teach that the predictor is
consulted only when it says taken — a lower tier CONTRADICTING a higher one, not a lawful
simplification. `branch-resolved.predicted` reports both directions and the fold carries it.

**Gate on a TRACE fact (`hasPredictorTable`), never on the scheme** — the shell's `branchPrediction`
knob persists across model switches, so a dynamic scheme can be held while viewing a machine that has
no predictor. Related: App passes the raw scheme to the panel, **not** `hasTakenBetPath`, which
collapses both dynamic schemes onto `'static-taken'` — precisely the distinction this panel draws.

⚠ **Break row 1 is the FIFTH instance of this feature's recurring finding, and it arrived inside the
file that names it.** `isConditionalBranch` has two call sites in the fold — owners and trains — and
only owners had a test, because every training assertion ran on `nested-loop.s`, which has **no `jal`
and no `jalr`**. A view lighting a row for an unconditional jump would have shipped in silence.
**Two call sites of one predicate need two tests, and `call-return.s` is the witness — again.**

⚠ **Break row 9 reddens 0 and is NOT closed: an App slot gate is untestable BY POSITION.** Nothing in
the repo renders `<App/>`, and the same is true of `showCache`/`showMicro`/`showIssue`, shipped that
way for four milestones. The predicate is tested; its use at the call site is not. Recorded rather
than faked — [[m13-review-resolved]]'s "a pinned decision with no net is a comment", whose honest
extension here is "and sometimes the net cannot be written where the decision lives".

**Other measured rows.** 10 mutations: 1→0 (closed to 1), 2→3, 3→2, 4→1, **5→5** (`predictorIndex`
rotated inside the fold — includes the render-keyed case, which is what makes a wrong ROW LIT
visible), 6→2, 7→0 (closed on a **synthetic** trace — the one deliberate fixture in this suite,
because no real recording can tell the wide id→pc join from the narrow one: all four models keep a
resolver listed on its resolve cycle), 8→0 (closed by EXPORTING `preRunMicro` so its fabricated cold
table is a claim rather than a comment), 10→2. Also: **zero rows have more than one owner at 16
entries** across all twelve programs, so the aliasing render path is drawn but UNREACHED and labelled
like `cache-grid.test.ts`'s unreachable store-miss state; and **no program trains during cycle 0**,
which is what makes the pre-run cold table continuous with frame 0.

**`preRunMicro` fixed, as the step's own text demanded.** `predictor: null` claimed "this machine has
no predictor" about one that has merely learnt nothing. Now `coldPredictorState(scheme)` — the same
function the engine's constructor uses, so engine and both panel paths are one value with one
definition. ⚠ Adding `scheme` as a **required** prop was itself a compile tripwire that found all four
call sites; a default would have hidden them.

⚠ **A render-keyed test must DERIVE its cycle, not reach for the last one.** "strongly/weakly only at
2 bits" asserted on `recorded.at(-1)` and failed: `nested-loop.s`'s last cycle holds no strongly-taken
counter, because both loops exit at the end and weaken 3→2. Third instance of **"the canonical
demonstration of a mechanism is usually not the test of it."** Fixed by finding a cycle where
`counter === table.max`.

⚠ **Two toolchain hazards, both recurrences.** `git checkout -- .` between break rows wiped three
finished-but-uncommitted closures — the identical loss [[m13-width-planned]] records. **The rule is
not "commit before you break", it is "commit before EVERY row", because the loop body contains the
revert.** And driving mutations from a node script is right, but **patch strings must go through the
editor or a file, never a bash heredoc** — backtick expansion silently mangled a docblock full of
`` `code` `` spans while still printing "ok".

**Step 7 is not optional and this step measured none of it.** No browser, no jsdom, no layout: the
chip reserves, the pip meter's width, sixteen rows at a narrow viewport, and the follow-highlight
composing with the map and datapath are all unmeasured. The fixed-16-row design removes one jitter
class by construction (constant height, so no [[panel-jitter-and-height-reserves]] reserve machinery)
and touches none of the others. See [[browser-is-the-only-net]].

## Step 5 — the other three models, and the claim that inverted (2026-08-09)

Three commits, one per model, each with its own `dynamic-predict.test.ts` and its own break table.
7863 → 9466 tests, five gates green throughout.

⚠ **INV-8 is a FALSE net on the three latch models and a REAL one on the out-of-order core.** Three
earlier steps measured "with the knob entirely unhonored every cell stays green" and this document
generalized it to the feature. Wrong: on the OoO the predictor's wiring touches **speculation
containment**, not just timing. Leaving that model's three STRUCTURAL guards on `predictTaken` — the
careless spelling, since one boolean used to answer both "has a bet path" and "bets taken" — reddens
**213** tests including **180 differential cells, every one a `dynamic-*` cell**: without the freeze,
fall-through instructions enter the ROB behind a branch later bet taken, and where the bet matches
the outcome nothing removes them, so **wrong-path instructions COMMIT**. Had that matrix not been
widened to five schemes, an architectural correctness bug ships in silence. Green cells still say
nothing about whether a scheme is HONORED — that half stands.

⚠ **A break-table count is a measurement against a SUITE and it EXPIRES.** Step 3 measured
"`jal`/`jalr` update the table" at ZERO and this plan called it "a pinned decision with no net";
re-fired at step 5 it reddens **3 on every wired model**, because step 4's per-cycle recorded-table
sweep replays training under `isConditionalBranch` and `call-return.s` disagrees. Second row here to
go stale that way (the index rotation went 2 → 3). **A step that adds a sweep should re-fire the rows
that sweep now covers.**

⚠ **Depth and width argue for a counter for OPPOSITE reasons** — the two sentences step 8's lesson
should be built on. **Depth** doubles a wrong bet (4/2/0 against the 5-stage's 2/1/0), so corpus-wide
`dynamic-2bit` beats `static-taken` by **14** cycles on the deep pipeline against the 5-stage's 7,
and `dynamic-1bit` — which merely TIED over the original eleven — wins outright. **Width** makes every
bet cost a pair: at width 2 `static-taken` LOSES on `nested-loop.s` (175 vs not-taken's 172) and the
dynamic schemes are the only winners (168/165), because they decline the bets they would lose and
keep the pairs (`Q` = 57 / 26 / 35 / 32). The 5-stage has neither, which is why its aggregate case
looks thin.

**The derivation method, and exactly where it stops.** `cycles(scheme) = cycles(not-taken) −
P(not-taken) + P(scheme)`, `P` summed per INSTANCE — **validated first by reproducing the MEASURED
`static-taken` column** before any dynamic cell is believed. Exact on the deep pipeline (12 programs ×
both positions) and at WIDTH 1 on the other two. **It is false at width ≥ 2**: a bet ends its issue
group, so it re-partitions the schedule rather than merely paying a penalty. Wide cells are measured
and labelled, carried by three other things: the closed form `cycles = G + L + P + 4` balances; the
bet STRING is width-invariant (asserted — this is what pins the POLICY where cycle counts cannot);
and a program that never bets records identically to `static-not-taken`.

⚠ **That last identity is a THEOREM on the superscalar and FALSE on the OoO** — the feature's first
inexact acceptance. `paired-branches.s` bets `NN`, emits no `branch-predicted` at all, and still
costs **8 against not-taken's 7** at widths 2 and 4. The dispatch freeze is a CORRECTNESS requirement
for any machine that MIGHT bet taken, and the core does not consult the counter until the branch is
about to issue — so **a dynamic scheme pays for HAVING a bet path even where it declines to use
one.** Pinned with its exact witness and cost, plus the four never-bets programs that are free.

**The squashed-branch fork: pinned at update-on-RESOLVE, and the corpus cannot pose it.** Measured
over 1536 runs (every program × width × issue mode × forwarding × scheme): **no branch ever resolves
and is then killed** — dispatch freezes behind an un-bet transfer, so a younger branch never gets far
enough ahead. That is also **why every bet string transfers from the other three models unchanged.**
Pinned as an arrival tripwire with its own non-vacuity control (two transfers DO overlap in the ROB).
⚠ **The fork is still not net-free: training at COMMIT reddens 21.** The set of branches that train
is identical; what moves is the **LATENCY**. The plan asked "does a squashed branch train?" — the
observable content here is "how late does a surviving one?". No ROB shape change was needed: issue
clears `'waiting'` before dispatch re-checks, so the freeze self-lifts.

⚠ **The per-lane table is a pinned decision with NO net, and the WHY is the useful part.** A real
per-lane predictor on the superscalar reddens **0**. Per-lane tables can differ only for a branch
that issues from more than one SLOT, and there is exactly one in the corpus — `nested-loop.s`'s guard
at pc 8, at widths 3–4 — which is `bne x0, x0`, **never taken**, so its counter sits at the floor in
every table that could hold it. **The corpus has a lane-alternating branch and it is the one branch
whose counter never moves.** Closed with a test pinning both halves, so a TAKEN alternating branch
turns it red. ⚠ Its first draft pooled slots ACROSS widths and reported three branches — **alternation
is a property of one RUN**; a sweep that pools runs answers a different question than its name.

⚠ **The cross-model test written to close a gap swept the wrong program and caught NOTHING.** "All
four models make the same bets" is the only claim no per-package file can make (four literals each
agreeing with themselves ≠ the four agreeing with each other). Swept on `nested-loop.s` alone — the
program authored to make the feature legible — a real divergence (deep pipeline made to let `jal`
consult the table) left all 32 tests green, because **that program has no `jal` and no `jalr`**.
`call-return.s` is the only witness. **Fourth instance of "the canonical demonstration of a mechanism
is not the test of it"**, this time inside the test written to close the gap it names.

**Other measured rows worth carrying.** The aliasing snapshot reddens exactly **20 on all four
models** — a wrapper spread is still exactly as broken as no copy. The engine-level policy mutations
scale with the suite (knob unhonored 35/47/42, wrong pc 48/59/54). And the step-3 arrival tripwire in
`simulator.test.ts` worked exactly as designed: RED before each model's wiring, its list shrank by
one per commit, and it was **deleted** when empty rather than left as a loop asserting nothing.

**Where each claim lives.** Per-model `dynamic-predict.test.ts`, all four in ONE shape. ⚠ The
reviewer's instinct — "put the aliasing pin next to the cache's" — does not survive contact: the
superscalar pins the cache's in `recorder.test.ts`, the deep pipeline in `cache.test.ts`. "Next to
the cache" is two shapes, not one.

⚠ **A test file wide enough to be worth writing is wide enough to need its inner loop looked at.**
The superscalar's took **72 seconds against the whole repo's 22** — the width axis multiplies every
sweep by four and `issuedPerCycle` was quadratic over re-run cells. Memoized runs plus one index
pass: 1.6s.

**The scratch tooling, at `M:\claud_projects\temp\bp-step5\`** (same config shape as `bp-step0`: a
vitest config OUTSIDE the repo importing `workspaceAliases` by absolute path, with `root: <project>`
and `server.fs.allow`). Three pieces are reusable and would otherwise be rebuilt:

- **`derive*.test.ts`** — derive a scheme's column from the STATIC runs alone, and validate the price
  rule against the measured `static-taken` column before believing any derived cell. This is the
  whole method; it works per model and stops at width ≥ 2.
- **`squash.test.ts`** — the resolved-then-killed sweep (a `branch-resolved` whose instr never
  retires), plus the ROB-overlap probe that keeps it from being vacuous. Run this before assuming
  anything about speculation on the OoO.
- **`lanes.test.ts`** — per-RUN slot occupancy per static pc. The probe that turned "the per-lane
  table has no net" into a reason.

⚠ **One residual, verified inert and owned by step 6 — CLOSED at step 6**: `MicroTablePanel.tsx`'s `preRunMicro`
fabricates an `OutOfOrderMicro` with `predictor: null`, and the honest pre-run value is the COLD
table. Nothing in `web` reads `micro.predictor`'s value today (grepped), so it is latent — but step 5
made the OoO record a real table, so step 6's first act makes it reachable. Flagged in the plan's
step-6 entry, which is what step 6's author reads.

## Step 4 — the deep copy, and the step whose whole content was its own net (2026-08-09)

Shipped: one line in `engine/pipeline`'s `snapshotState()` (`.slice()` the counters) plus a
`describe` in `dynamic-predict.test.ts`. 7830 → 7863, five gates.

⚠ **Landing the recording reddened ZERO of 7830 tests.** The plan predicted "most of the suite
passes — only a test that reads the table at an early cursor sees it"; there was no such test,
because nothing reads `micro.predictor` until step 6. So `null` recorded while a live table trained
was an **INV-2 understatement no test could see arrive or leave**. Third instance of the same root
(step 1's `predictorIndex`, step 3's datapath seam): **code with no consumer yet is code no test is
shaped to cover — write the net WITH the field, not with the reader.**

⚠ **`{ ...snapshot() }` is exactly as broken as no copy at all — measured, rows 1 and 2 redden the
IDENTICAL 20 tests.** A spread builds a fresh `PredictorState` around the same array, so it reads as
a fix and passes an identity check on the OBJECT. **Assert distinctness on `.counters`, never on the
wrapper.** `PredictorState` holds one mutable thing, so `.slice()` IS the deep copy.

⚠ **The non-vacuity control had to be `'dynamic-2bit'`, and the obvious choice asserts nothing.**
Under `'dynamic-1bit'`, `nested-loop.s` — the program authored to make this feature legible —
finishes holding **exactly the cold table**: each of its three branches' last outcome is not-taken
and a 1-bit counter remembers nothing earlier. Step 2's `TTTTNTTTT` lesson again: **the canonical
demonstration of a mechanism is usually not the test of it.** Pinned by its own `it`.

**The claim structure worth copying at step 5.** Cycle-0-is-COLD is the net (the shallow copy fails
it); last-cycle-is-TRAINED **passes under the defect** and is labelled a control, not coverage;
cold ≠ trained is what stops both being trivial (three corpus programs have no control transfer).
Plus a per-cycle replay — the table at cycle `i` is trained through cycle `i`, since `micro` is
post-cycle — which row 5 (snapshot taken at cycle START) shows is the **sole** net for snapshot
TIMING and invisible to everything else.

⚠ **Eight of that sweep's 24 cases assert nothing, and only the break harness found it** — the three
branchless programs, plus `call-return`/`paired-branches` under 1-bit, whose counters never leave the
floor. Rows 1, 2 and 5 each reddened exactly the other 16, which is where the guard's number came
from. Break rows: 0 / **20** / **20** / 29 (`predictor: null`) / 4 (empty table under a static scheme
— incl. the whole-`micro` `toEqual`, earning its keep a THIRD time and first on a VALUE) / **16**.
Note 29 > 20: **the count is not a severity ordering** — the aliasing defect is the one that would
have shipped and it reddens fewer tests than simply not recording.

⚠ **A break-table count read from ONE run has an unstated variance.** Row 4 reported 5 failures once
and 4 on two re-runs of the identical tree, with the summary never naming the fifth. The engine is
deterministic (INV-1), so it is a harness timeout — `label-collisions.test.tsx` ran 22.9s and 12.8s
on two passes of the same tree. Re-run any row whose count surprises you.

⚠ **A coverage claim went into a docblock UNFIRED, in the step that was being careful about exactly
that — caught by review, then measured.** The claim: `TRAINED_2BIT_NESTED` names rows 2, 6 and 8, so
unlike the replay (which routes through `predictorIndex` and agrees with a rotated index perfectly)
the literal should see the CONSISTENT shift. Fired as break row 6: rotating the index reddens **3**,
the two index unit tests plus this literal. **So step 3's "the sole net for the rotation is
`predictor.test.ts`" is superseded — it was sole only until step 4's literal joined it.** The claim
was true and was still unfired prose in two documents. Same fix step 2 applied to the `DynamicScheme`
compile tripwire: run it.

⚠ **The test that catches the rotation is the one labelled a CONTROL.** "The last cycle is trained"
passes under the shallow copy — not coverage for that class — and is the ONLY thing in the repo
besides `predictor.test.ts` that sees a rotated index. **A test can be vacuous for the class it was
written for and load-bearing for another**, so label what a test fails to cover, never "this one is
just a control".

**For step 5:** the repo's existing home for a deep-copy claim is each model's `recorder.test.ts` —
the superscalar's own docblock says the cache's aliasing is pinned there because "time-travel is the
only layer at which it is observable at all". The predictor's went into `dynamic-predict.test.ts`
instead, which is non-vacuous but is a second home. Put the other three models' versions in ONE
shape, whichever it is — that seam is exactly where [[m13-width-planned]]'s four-site divergence
pressure lands.

**Three docblocks said "the cache is the ONE exception" and only one was about the pipeline.**
deep-pipeline's and superscalar's were re-anchored from step 4 to **step 5**; out-of-order's already
said 5. Also corrected: `PipelineMicro.predictor`, `MicroTablePanel.preRunMicro` (its literal is an
`OutOfOrderMicro`, so the `null` is still true — the PREMISE sentence went stale, not the value),
`processor.test.ts:187`, and `predictor.ts`'s two forward references.

## Step 3 — the wiring, and what the break harness said about the test written FOR it (2026-08-09)

Shipped: `betTarget(d, pc)` + an EX training call in `engine/pipeline`, `isConditionalBranch` and
`isDynamicScheme` in `engine-common`, a four-position prediction control. 7606 → 7830, five gates.

⚠ **Acceptance (b) came out EXACT.** Every derived cell of the step-0/0b tables — 12 programs × 4
schemes × both forwarding positions — reproduced by the real engine with no correction, including
`nested-loop.s` 182/177/174/171 and all four corpus totals. So the offline pricing method is
validated end to end, and step 5 can trust the same method for the other three models' tables. It
also discharges step 0's one ARGUMENT: `S` really is scheme-invariant.

⚠ **The headline lesson is about a TEST, not the engine. A replay test written to be the UNIQUE net
for `update` handed the wrong pc caught NOTHING alone.** The reasoning was that training the wrong
row leaves cycle counts intact (rows interact only where branches alias, and this corpus's only
witness aliases at 4 entries, not the pinned 16). Measured: `update(nextPc)` reddens 31 tests
including **six cycle counts** — decoupling the row you train from the row you read changes the bets
themselves. Across eleven mutations the replay never fired without the cycle table firing too. What
it buys is **localization**, plus one real catch: a step-5 copy-paste that changes a policy and
"fixes" the replay to match keeps it green and still fails the **literal pinned strings**, which is
why those are written out rather than replayed. **Generalize: before claiming a test is the only net
for a defect class, break that class and see who else goes red.**

⚠ **The wrong-pc mutation that IS invisible is the CONSISTENT shift** — `predictorIndex` rotated by
one entry, predict and update moving together. A rotation is a bijection on rows, so collisions
survive exactly (the plan's `TEXT_BASE` argument, now measured): engine, trace and replay all see
nothing. **The sole net was `predictor.test.ts`'s unit tests on `predictorIndex`** — the arithmetic
that shipped with NO test at step 1. Those tests are not redundant with the wiring tests above them;
they cover a class nothing else reaches. ⚠ **Superseded at step 4**, which re-ran this row: the
literal recorded table joined them, so the row is now 3 rather than 2 — see step 4's break row 6.

⚠ **A shell predicate serving more than one question hides a defect in the question it answers
worst.** `predictsTaken(scheme): boolean` served three: the lit button, the re-record no-op guard,
and the datapath's "draw the branch-target adder". The moment the engine honored a counter table it
was wrong for the first two — `setBranchPrediction`'s guard compared `false === false` for "not
taken" vs `'dynamic-1bit'`, **skipped the re-record**, and showed the old machine's trace under the
new label. The state string moved, so nothing headless could see it ([[browser-is-the-only-net]],
same shape as [[keyboard-clock-control]]'s 68/68). Break row 9: reverting the guard reddens **zero**
tests. Split into `predictionPosition` (machine identity) and `hasTakenBetPath` (does the hardware
exist — a dynamic machine's answer is YES), the second DERIVED from the first so two lists cannot
drift.

**A temporary capability flag was the wrong fix, and the reasoning transfers.** Between steps 3 and 5
two of four buttons are honored by the pipeline alone, so on three models they move the button and
not the machine. A `dynamicBranchPrediction` capability would churn six capability literals and
`models.test.ts`'s exact honoring-model list **twice** — now and at step 5 — for a field whose only
content is "step 5 hasn't happened yet". Instead the existing inertness test NAMES the three models,
so **step 5 turns it red on arrival**. One test edit. Generalize: when a gap is a scheduling WINDOW
rather than a design flaw, encode it as an arrival tripwire, not as schema.

**Two more measured rows worth carrying.** `jal`/`jalr` updating the table reddens **zero** tests of
any kind — a pinned decision with no net whatsoever, held only by `isConditionalBranch`'s docblock
(the plan predicted zero TIMING effect; the truth is broader). And with the knob **entirely
unhonored**, all 50 INV-8 cells stay green and `timing.test.ts` too — the widened differential matrix
is a false net for "is this scheme honored at all", exactly as [[m7-superscalar-engine]] records.

⚠ **A predicate extracted so two consumers can DIFFER needs a test per CONSUMER, and one of them
must be keyed off the RENDER.** `hasTakenBetPath` was split out for the datapath, and the only thing
covering it was a fold assertion in `session.test.ts` — `datapath-pipeline.test.ts` sweeps
`DatapathConfig` LITERALS, so it never traverses the function at all. Collapsing it back to
`scheme === 'static-taken'` reddened exactly ONE test, and under both dynamic schemes the
branch-target adder and its three wires would have blanked on the pipeline datapath with nothing to
say so — on the very config the feature ships for. This is [[m11-deep-pipeline-view-and-cache]]'s
cache-grid blanking and [[m13-width-planned]]'s fold-not-render defect, together, in new code. Closed
with a render-keyed case in `App.test.tsx` that starts from a SCHEME and greps the markup. **The
first eleven break rows all missed it because they were aimed at the engine and the control** — the
same "a harness aimed at the headline risk misses what shipped alongside it" as step 1.

**Two more rows the same review pass added.** Making `deep-pipeline` honor `'dynamic-1bit'` reddens
exactly the inertness block and nothing else — so "step 5 turns this red" is MEASURED, not asserted;
an arrival tripwire deserves the same discipline as any other row. And ⚠ **a break row that reddens 0
is worth a second look before it is written down as coverage**: the title-distinctness row's first
mutation produced a title that was still distinct, so it tested nothing and read as a gap.

Both `jal` decisions are now CLOSED (bypass the table; do not update it), spelled by a shared
`isConditionalBranch` so step 5's three sites cannot answer them three more ways. Resolve-time and
commit-time coincide in the 5-stage machine as a FACT (a squashed instruction never reaches EX), so
the OoO fork is still genuinely open — pin it before step 5.

## Step 2 — `BranchPredictor`, and what its API shape is protecting (2026-08-09)

Shipped: `{ index, predict, update, snapshot }` in `engine/common/src/predictor.ts`, constructed from
the scheme. 7597 → 7606, five gates green. Three shape decisions, each with a reason that will be
re-asked at steps 3–6:

- **A CLASS here even though `cache.ts` next door is functions-over-a-state-object.** `access()`
  threads `config` because a cache's geometry varies per run; this table's geometry is a module
  constant and its only variable is counter width. Constructing from the scheme derives the width
  ONCE, so the four wiring sites pass `config.branchPrediction` through and none re-derives a
  threshold — the [[m13-width-planned]] four-site-divergence failure mode, designed out.
- **The API is `predict(pc)` / `update(pc, actual)` and nothing richer, and that is load-bearing.**
  Three of the plan's open decisions (does `jal` consult; do `jal`/`jalr` update; does a SQUASHED
  branch update, on resolve or commit) are all CALL-SITE policy. A constructor taking a decode would
  close them by implementation **inside a package forbidden from importing a model**. Generalize: an
  API that accepts a richer argument silently answers the questions that argument encodes.
- **`snapshot()` returns the LIVE table on purpose.** A defensive copy reads as safer and is wrong
  twice: four `micro.predictor` docblocks say "DEEP-COPY it into every snapshot", and copying here
  **dissolves step 4**, whose whole content is that copy plus a break harness. Step 1's ⚠ restated —
  a decision belongs where the implementer READS it, and that is `snapshotState`, not a getter one
  package down. A test pins the aliasing so the contract can't drift out from under step 4.

⚠ **The flagship sequence is NOT a total net, measured.** `TTTTNTTTT` under a 2-bit table with the
taken threshold forced to 1 still reads `NTTTTTTTT` — so the sequence everyone reaches for does not
pin the threshold at all. The cold-table and floor cases carry it. Same class as step 1's vacuous
five-scheme sweep: **the canonical demonstration of a mechanism is usually not the test of it.**
Related: assert the prediction STRING, never the mispredict COUNT — a wrong seed and a wrong
threshold can both leave the count unchanged.

⚠ **Third consecutive step where a break-table row predicted by hand came out wrong.** Here: "2-bit
seeded at 0 reddens the cold-table test only" — it also reddens the flagship, because a counter
seeded strongly-not-taken mispredicts **twice** before warming (`NNTTT…`), not once. The rule is now
just _run it_; a predicted row is a hypothesis.

⚠ **One mutation is invisible and was RECORDED rather than tested**: inlining `index()`'s delegation
as `(pc>>>2)&15` is value-identical at 16 entries, so nothing can see it — it only starts mattering
if `PREDICTOR_ENTRIES` moves. Saying so beats a test that pretends to cover it.

⚠ **A COMPILE tripwire is invisible to a runtime break harness, and step 2 nearly shipped one
asserted-not-fired** — the same "by construction" failure as step 1. `DynamicScheme` is
`Extract<…, `dynamic-${string}`>` so a third scheme reddens `COUNTER_BITS`'s `Record`; the six
mutations below could never have tested that, because `npm test` does not run `tsc`. Fired
deliberately: `'dynamic-3bit'` gives exactly one error, `TS2741` on `COUNTER_BITS`. ⚠ It is
**prefix-conditional** — a `'bht-3bit'` spelling would not widen the type at all.

⚠ **`web` CAN import `BranchPredictor`, `access` and `newCache` — the "render, never drive" boundary
is convention, not a rule.** Only `curriculum` is mechanically denied `engine-common` (`eslint.config.js`,
the INV-3 rule); `web`'s edge to `engine-common` is allowed, which is the same fact that made the four
model re-exports unnecessary. An index.ts docblock claimed the boundary "holds by the same mechanism"
as the cache's — it doesn't. [[m13-review-resolved]]'s "a pinned decision with no net is a comment".

Six mutations run (floor / ceiling / threshold / seed / re-implemented index / defensive snapshot);
the table with counts is in the plan. The defensive-`snapshot()` row reddens **exactly one** test, so
the step-4 premise guard is non-vacuous. `git checkout --` between rows, editor not `Set-Content`,
tree committed first.

## Step 1 — the schema, and the three things it taught (2026-07-31)

Shipped: the union grew `'dynamic-1bit'`/`'dynamic-2bit'`; `engine/common/src/predictor.ts` holds
`PredictorState`, `PREDICTOR_ENTRIES = 16`, `predictorIndex(pc)`; all four honoring models' `micro`
carry `predictor`, **null on every cycle**. Repo 7591 → 7597, five gates green. Decisions now CLOSED
in the plan's table: scheme names, state's home, table size (16 — chosen because every derived number
in the step-0/0b tables used `(pc>>>2)&15`, so step 3's acceptance needs no row re-derived), and the
index function's home.

⚠ **The plan's own step-1 text was WRONG and the rule is worth carrying.** It said "add
`PredictorState` to the trace types". Precedent says otherwise: **a type handed to `reset()` is
CONFIG and lives in `trace` (`CacheConfig`); a type carried in `MachineState.micro` is a model's
SHAPE and lives beside the code that produces it (`CacheState`)** — `trace/src/schema.ts` types
`micro` as `unknown` precisely so `trace` never learns these shapes. Also: `CacheState`'s re-export
through the four model packages is HISTORY (it moved down at M7 and ten web files were spared churn),
not a boundary — `web` already imports `engine-common` directly and eslint allows it, so a new
surface needs no re-exports.

⚠ **Adding a field to a `micro` type costs THREE sites and a grep finds only one.** The interfaces +
construction sites are predicted. The other two are **whole-`micro` object literals passed as
ARGUMENTS**, so `grep "micro: {"` misses both: `engine/pipeline/src/processor.test.ts`'s `toEqual`
(the only assertion in the repo that could see the field arrive) and — not a test — a **component**,
`web/src/MicroTablePanel.tsx`'s `preRunMicro`, which FABRICATES a micro for cursor −1. Grep the
model's micro TYPE NAME instead. The fabricated one carries a live hazard for step 6: the honest
pre-run value of a counter table is the COLD table, not `null` and not the trained one carried
forward — `robCapacity` is a CONFIG fact so it copies, `rob`/`rename`/`predictor` are RUN facts and
each must be emptied to its own zero.

⚠ **"The names agree BY CONSTRUCTION" was enforced by nothing — measured, not suspected.** Renaming
`predictor` → `bht` on `DeepPipelineMicro` (interface + site together, exactly what a step-5
copy-paste produces) left typecheck clean and **all 7591 tests green**. Only the pipeline was
covered, accidentally, by its whole-micro `toEqual`. The gap is invisible because **nothing READS
the field yet** — the first reader is step 6's panel, by which time drift ships. Closed early: a
`web/src/models.test.ts` test drives every model reporting `configurableBranchPrediction` and asserts
the key on every recorded cycle. **Generalize this**: a field added to N models "so they agree" has
no net until something reads all N; add the reader-shaped test with the field, not with the reader.

Three more break-harness findings, each of which corrected a row written from prediction:

- **A five-scheme "every scheme records identically" sweep is VACUOUS on its own.** With the knob
  never applied and the control removed: 25/25 green. Same shape as [[browser-is-the-only-net]]'s
  measurements. The control (the same helper, handed a model that HONORS the knob, must separate two
  schemes) belongs in the test BODY, not a sibling `it`.
- **A control placed first hides what follows** — vitest aborts an `it` at the first failed `expect`,
  so "the control failed" does NOT show the sweep would have passed. That needs its own run. A break
  table written from the one run records the opposite conclusion.
- **A union is a TYPE, so `npm test` is structurally blind to it shrinking** (the `Record` literal
  still carries the key at runtime). Only `tsc` sees it. A runtime `ALL_SCHEMES` length/contains
  guard is NOT redundant — it covers the complementary mutation, the key deleted from the Record,
  which is what "fixing" that compile error actually produces.

Two tripwires M4 left armed both fired correctly and **only one was spent**: `SCHEME_POSITION`'s
`Record<BranchPrediction,…>` is the COMPILE tripwire (fired at step 1; the dynamic names are
classified not-taken _because the engine ignores them_), and the `toEqual(notTaken)` beneath it is
the BEHAVIOR tripwire that fires at **step 3**. Restructuring at step 1 would have spent a tripwire
that had not fired. Step 3's entry now names that failure so it reads as arrival, and makes growing
the prediction control part of that step.

⚠ **The gap the break harness did NOT find, and it is the transferable one.** The harness hunted the
field's SPELLING. It never touched the ARITHMETIC the same step exported: `predictorIndex` shipped
with **no test**, the only pure function in `engine-common` without one. Worse than the spelling gap,
because a wrong spelling blanks a panel while wrong arithmetic moves numbers three hand-derived
timing tables assume — delete the `>>> 2` and it becomes `pc % 16`, under which `nested-loop.s`'s
guard (pc 8) and inner branch (pc 24) **collide at the PINNED 16**, the aliasing measured as
reachable only at 4. `dynamic-2bit` stops being 171, and the symptom would first appear at step 3 as
"the step-0 table was wrong". Closed: `predictor.test.ts`, 5 tests (7592 → 7597), each verified
against a broken function. The two mutations partition cleanly — deleting `>>> 2` reddens 3 of 5;
weakening `>>>` to a signed `>>` reddens **only** the address-space range check, which is
`predict.ts`'s own `>>> 0` finding one file over. **Rule: a harness aimed at a step's headline risk
will not find the risk in what the step exported ALONGSIDE it. "There is no consumer yet" is exactly
when untested code gets written in — it is the same root as the spelling gap above.**

`TEXT_BASE` is `0x0000_0000`, so an absolute pc equals its offset and the plan's stated rows ("pc 8 →
index 2") are true of the shipped table verbatim. Not a tautology: a non-zero base rotates every row
by `(TEXT_BASE >>> 2) % PREDICTOR_ENTRIES`, and since collisions survive a constant rotation, **no
cycle count would move** — step 6's picture would drift with nothing numeric to notice it by.

⚠ **A docblock's claim goes stale where the DECISION is read, not where the field is declared.** The
four `snapshotState` docblocks say "the cache is the ONE exception" (to deep-copying); that is what a
step-4 implementer reads, and the ⚠ had been put on the `micro` FIELD instead. Both now carry it.
Same class as [[m14-review-resolved]]'s stale-docblock findings.

⚠ `Set-Content -replace` mojibaked a source file again on the first break attempt — a two-token
rename came back as 152 insertions / 152 deletions. The [[m13-width-planned]] hazard is still live;
mutate source with the editor. Separately: **PowerShell here-strings break on commit messages
containing quotes** — three commits this session failed with `pathspec ... did not match`. Write the
message to a file under `M:\claud_projects\temp` and use `git commit -F`.

## Step 0b — `content/programs/nested-loop.s`, and what adding a corpus program REALLY costs

4 outer passes × a 6-iteration inner loop, register-only, plus a never-taken `bne x0, x0` guard at
the head of each pass. Measured (fwd off): **182 / 177 / 174 / 171** for not-taken / taken / 1-bit /
2-bit — the only program whose four schemes come out **strictly ordered with 2-bit fastest**, no ties
(+6 over `static-taken`), and the 1→2-bit delta is the projected 3. ⚠ It is NOT "the only program
where a dynamic scheme beats `static-taken`" — `paired-branches` +4, `call-return` +2 and
`branch-flavors` +1 all do, but on those the two dynamic columns TIE and the win comes from a branch
that falls through, which is `static-not-taken`'s bias rather than a counter's memory. The guard is
what makes the ordering textbook: without it `static-taken` still won and the feature would have
demonstrated hysteresis while losing on the clock.

⚠ **The layout constraint that cost two redraws — and it is NOT a distance rule.** The shipped
program's biggest stall site is a distance-2 RAW and is perfectly scheme-invariant. All three timing
tables pin ONE stall histogram per forwarding position for ALL schemes, so a retired-path stall that
moves with the scheme changes their SHAPE rather than adding a row. Exactly two things do that:

1. **A RAW that SPANS a branch** — its distance depends on what that branch predicted, and the
   7-stage inserts 4 correction cycles for a lost bet. Draft 1 put the guard between `li t1` and its
   consumer.
2. **A bet that RE-TIMES a producer against its consumer** — at width 2 a bet from slot 0 kills its
   mate and re-partitions the groups behind it, so an instruction can change which issue GROUP it
   lands in. Draft 2's `li t1` paired with the guard under `static-not-taken` and was killed and
   re-paired under `static-taken`: superscalar `L` **60 vs 64**. The surviving distance-2 site is
   safe because its two predecessors pair in every scheme, so the branch is consistently one group
   behind.

**The transferable part is the procedure, not a heuristic — neither hazard is visible by reading.**
`M:\claud_projects\temp\bp-step0\screen.test.ts` dumps every stall histogram × scheme × forwarding
position × width in one run. Screen a candidate layout there BEFORE hand-deriving any table row.

⚠ **SIX pinned sites moved, not the three the plan priced.** The three timing rows were the easy
part and each was green on the first hand-derivation. The three nobody predicts are SHAPE claims,
invisible to a grep for the completeness idiom:

- `superscalar/src/pairing.test.ts:507` — a SECOND corpus-completeness table (the headline w1/w2 A/B)
- `superscalar/src/processor.test.ts:173,188` — slot-surjectivity SETS per width + a hard-coded
  length; a program joins by its per-width issue shape, which cannot be guessed
- `web/src/pairing-readout.test.ts:552` — the IPC tile's flat-at-widths-3-and-4 enumeration
- plus `superscalar/src/timing.test.ts:2276`, a hard-coded `'eight of eleven'` with a prose message

Out-of-order needed nothing (its `PINNED` never asserted completeness). **Land the `.s` and run the
FULL suite first** — the failure list is the scope, and deriving one table before knowing it means
deriving twice.

Two machine facts the new row carries: **pairing makes this program's interlock WORSE** (w2 `L`=64
against w1 `S`=40, because the paired producer puts the branch one GROUP back instead of two
instructions back) and it still wins 172 vs 182; and **`static-taken`'s sign FLIPS with width** —
+5 at width 1, −3 at width 2, −4 at 3 and 4 — because every bet ends its issue group.

## The method — pricing a scheme that does not exist yet, with no engine change

Reusable whenever a new config knob changes only TIMING. Two properties made it work, and both are
worth checking before trying it again:

- **The underlying event sequence is knob-invariant.** A program's per-branch outcome sequence is
  the same under every predictor, because prediction changes _when_ things happen, never _what_. So
  ONE run per program yields the raw material for every scheme.
- **The trace already carries a per-INSTANCE cost rule.** `pipeline/src/timing.test.ts:205` pins
  every resolved transfer at **2 if mispredicted, 1 if correctly predicted taken, 0 if correctly
  predicted not-taken**, and `cycles = N + 4 + S + P`. Because that rule is per-instance rather than
  per-scheme, it prices a scheme nobody has built.

**The validation that makes the derived columns trustworthy: replay the two schemes that DO exist
and compare the ordered `predicted` sequence event-for-event against `branch-resolved.predicted`** —
not the totals. Then the same simulator is trusted where no oracle exists. Broken on purpose
(`static-taken` made to predict not-taken): that test failed, the closed-form test did NOT, because
it reads the trace's own `predicted` rather than the simulator's. Same shape as
[[cycles-cannot-see-a-lost-forward]].

Scratch harness: `M:\claud_projects\temp\bp-step0\` — a vitest config OUTSIDE the repo, importing
`workspaceAliases` from the project's `vitest.config.ts` by absolute path, with
`root: <project>` + `server.fs.allow`. Worked first try; use it for any future headless measurement
that must not land in the project tree.

## The finding that should change the plan's shape

**Over the ORIGINAL eleven-program corpus `dynamic-2bit` beat `static-taken` by ONE cycle, and 1-bit
tied it exactly.** Not a sizing fluke: **every loop there was entered once**, so a warm
`static-taken` is already right on every iteration and the dynamic schemes only ever pay their cold
start. They won only where a branch habitually falls through (`paired-branches` +4, `call-return`
+2), which is `static-not-taken`'s territory, not a dynamic predictor's thesis. **Step 0b's
`nested-loop.s` is the whole of the current margin** — it alone contributes +6, taking the corpus
total from 1 cycle to 7 (814 → 807 fwd-off, 591 → 584 fwd-on). The aggregate case for this feature
is still small; the per-program case is what to teach from.

Consequences a future session should not re-derive:

- **`array-sum-twice.s` was the ONLY program distinguishing 1-bit from 2-bit, by 1 cycle in 276**
  (until `nested-loop.s`). The delta is exactly **`m − 1` for `m` outer passes**; the inner loop's
  LENGTH is irrelevant, and the outer branch contributes nothing. So 4 passes ⇒ 3, 6 ⇒ 5.
- **Table size WAS timing-neutral at 16, 8 and 4 — step 0b falsified that.** `nested-loop.s`'s guard
  (pc 8) and inner branch (pc 24) both index 2 at **4 entries**, costing `dynamic-2bit` 181 against 171. The corpus now has its first aliasing witness, reachable only at 4 — which finally gives the
  "pin 8 or 16" decision a reason beyond drawability.
- **The `jal` fork costs exactly 1 cycle and lands on M4's own witness.** `call-return.s` is 16 when
  `jal` bypasses the table (always predicted taken) and 17 when it consults a cold counter — against
  M4's pinned `+1`. Seed: bypass.
- **2-bit reset `00` would make the "better" predictor LOSE** on all four single-entry loops
  (`array-sum` 72 vs the 1-bit's 71, likewise `strided-sum`/`sum-loop`/`slow-op-loop`). `01`
  (weakly-not-taken) is the seed for that reason, not just for the learning animation.

## The plan's own claim that was wrong

It stated `TTTTNTTTT` costs a 2-bit **one** mispredict and a 1-bit **two** — the textbook's
WARM-START numbers. Both counters reset not-taken, so the leading `T` is a cold mispredict every
scheme pays: measured **2** (`NTTTTTTTT`) and **3** (`NTTTTNTTT`). These are step 2's unit fixtures,
so the error would have been copied into the tests written to pin them.

## Still to settle before step 5

`m13-review-resolved`-style hazard: **does a SQUASHED branch update the predictor?** In the OoO
model a branch can resolve and then be killed by an older mispredict, so update-on-resolve vs
update-on-commit is a real behavioral fork, **invisible to INV-8**, sitting exactly where step 5's
copy-paste pressure across four models peaks. Pin it before step 5, not during.
