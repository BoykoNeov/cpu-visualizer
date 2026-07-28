---
name: m13-width-planned
description: 'M13 (issue width > 2) — IN PROGRESS: steps 0/0b/1/2/3/4/5/6/7 done. Step 7 made the DATAPATH a function of the width: geometryFor(w), because N lanes plus a rail band is what sets the height, so a constant canvas would draw width 1 as one lane in a mostly-empty box. Its new segment-through-box litmus found TWO wire routes that had shipped since M7 and were invisible to all 1533 tests AND to M7s browser pass. The refactor MANUFACTURED a vacuous test (a filter over a narrowed set) — caught before writing, fixed by asking the claim of BOTH sets. The M7 refusal fixtures were non-monotone in width (BRANCH_SLOT refuses at 2 and 4 but NOT at 3). The palette record was WRONG: dE 41.3/42.6 does not reproduce (real: 13.0/15.9) and no 4-set can match a 2-set minimum; user pinned keep-lanes-0/1 + green/purple. A break harness using `git checkout --` destroyed the uncommitted tree — COMMIT BEFORE YOU BREAK. Earlier: the guard admits 1..4 (MAX_ISSUE_WIDTH in engine-common), arity->2 nets, the derived width-3/4 timing matrix, conformance at 72 configs, and the recorder/location proofs. INV-8 is a FALSE net here, proven by experiment. Read before touching engine/superscalar, engine/conformance, the datapath or the lane hues.'
metadata:
  node_type: memory
  type: project
  originSessionId: 694ca14b-8d6d-4835-b4c9-69e79781d7f5
  modified: 2026-07-28T15:57:40.048Z
---

## M13 — the wide machine, widened. **IN PROGRESS 2026-07-28.** Steps 0 / 0b / 1 / 2 / 3 / 4 / 5 / 6 / **7** done.

Plan: `docs/plans/m13-tasks.md`. Dumps: `M:\claud_projects\temp\m13-step0\dump.txt` (pre-fix) and
`dump-postfix.txt` (the one to read); step 6's at `M:\claud_projects\temp\m13-step6\`. Repo 4498 →
4504 → 4523 → 5157 → 5558 → 5575 → 6157 → **6171** tests. See [[project-overview]] for the index,
[[m7-superscalar-engine]] for the machine this generalizes, [[m9-out-of-order]] for the model step 6
widened.

### Step 7 SHIPPED `88bbb4d` — **the geometry stopped being a constant, and the new litmus found two M7 defects**

The datapath at N lanes. `MAX_WIDTH = 2` is gone (step 5's silent `EX.2` drop, fixed); `geometryFor(w)`
replaces one drawing with four; the lane tint set is four. In descending order of what each cost:

- **⚠ COMMIT BEFORE YOU BREAK — this cost the entire working tree.** The deliberate-break harness
  restored itself with `git checkout -- packages/web/src/`, which reverted every UNCOMMITTED step-7
  edit (geometry, tests, view, stylesheet). Recovered in full only because every edit was a script or
  a temp file. **A break pass is a destructive operation on the working tree**, and `git checkout`
  cannot tell the break from the work under it. Commit first, then break — the breaks are then free.
- **THE GEOMETRY IS A FUNCTION OF THE WIDTH, and the plan was wrong to call it mechanical.** `LANE_DY`
  being a pitch makes the LANES mechanical, not the DRAWING: N lanes plus an outboard rail band sets
  the height, so **the height IS the width**. A canvas sized for four draws width 1 as one lane at the
  top of a box two-thirds empty with bars spanning three absent lanes — the same "draw hardware the
  machine does not have" the absent-lane rule forbids, one level up. Bars' `h` and rails' `y` are WIRE
  COORDINATES, so wires are width-dependent too; there is no smaller change.
- **⚠ THE REFACTOR MANUFACTURED THE MILESTONE'S SIGNATURE DEFECT — 7th instance, and the first the
  refactor itself creates.** `'lane 1 ABSENT at width 1'` = `NODES.filter(lane === 1)` + an assertion.
  Point it at a per-width geometry: filter EMPTY, loop body never runs, green and measuring nothing.
  Fix = ask the claim of BOTH sets — the full universe (which CONTAINS the lanes it calls hidden) for
  VISIBILITY, `geometryFor(w)` for STRUCTURE. **A refactor that narrows a set narrows every test that
  filters it — audit the filters, not just the call sites.**
- **⚠ A NEW LITMUS (`throughBox`) FOUND TWO ROUTES THAT SHIPPED AT M7 AND WERE INVISIBLE TO EVERYTHING.**
  Nothing checked whether a wire segment runs THROUGH a box it is not connected to: endpoints-on-
  perimeter, collinear-overlap and no-dangling all pass such a wire. Found: `memwb-fwdunit` crossing
  the EX/MEM bar (fixed by an outboard route, which cost a FIFTH rail per lane), and `hazard-pc`
  running the length of the ISSUE box directly above it. **Neither was caught by M7's browser pass** —
  the sharpest evidence yet that a browser pass is not a superset of a geometric litmus. Each break
  reddens **exactly 1 of 1533**.
- **The rail scheme generalises by SPLITTING lanes across the two bands, not by inventing sides.** Top
  `ceil(n/2)` lanes forward on top, the rest below — reproduces M7's assignment at widths 1/2 and keeps
  the file's own y-disjointness argument. What does NOT survive: lanes on the SAME side overlap in y, so
  each needs its own channel (`fwdmuxX` is DERIVED from the channel count, so a wider machine moves the
  hardware instead of overrunning the corridor) **and its own stub on the bar they both leave from** —
  two lanes leaving one offset for different rails run collinearly from bar to nearer rail. Width 2
  could not build that: its two lanes were on opposite sides.
- **⚠ THE REFUSAL FIXTURES WERE NON-MONOTONE IN WIDTH — step 5's trap, third occurrence.** A program
  provokes a refusal only if the conflict lands in ONE group, and group boundaries MOVE with width.
  Measured: M7's `BRANCH_SLOT` emits **NO pairing refusal at width 3** while refusing at 2 and at 4
  (its branches straddle a boundary at exactly 3) — `firstRefusal` would have THROWN. M7's `MEM_PORT`
  hits `intra-pair-raw` a cycle before its own subject at w3/w4, so "the first pairing refusal" stopped
  naming the rule under test (now selected BY REASON). New fixtures are dense; **that they provoke
  their own rule at every width is a TEST**, not a comment.
- **The litmuses were checking a drawing that is never rendered.** Filtering the width-4 geometry to two
  lanes gives a machine `geometryFor(2)` never builds (at w4 lanes 0+1 are both top-side; at w2 lane 1
  is bottom-side). Structural checks moved to `geometryFor(cfg.issueWidth)`; coherence stays on the full
  universe because `activate` is width-oblivious. **Which SET a litmus reads is part of its claim.**
- **A SECOND arity-2 consumer, live since step 6 and missed by step 5's sweep.** `PairingReadoutView`
  did `LANE_COLORS[c.slot as 0 | 1]` → `undefined` at slot 2/3 → `color: undefined`. **A cast silences
  the very check that would catch it**, and neither of step 5's two sweep spellings could match it.
  Third time this milestone: _an arity sweep finds the arities you spelled the way you searched._
- **⚠ THE PALETTE RECORD WAS WRONG AND THE ACCEPTANCE WAS UNACHIEVABLE.** `styles.css`/the plan cited
  "CVD dE 41.3 light / 42.6 dark"; the dataviz validator measures the shipped pair at **13.0 / 15.9**
  and reports nothing near 41. And "at least match the 2-slot dE" can never hold for a 4-set — the
  shipped pair survives into it, so adding hues only LOWERS the worst pair; the sweep puts the dark
  ceiling at ~14.6 even allowing lane 1 to move. Taken to the user with both options measured; pinned:
  keep lanes 0/1, add green + purple. **Light unchanged at 13.0** (free, because the shipped pair was
  already the worst); dark **15.9 → 10.1** vs a target of 8. Two structural notes: **no teal/cyan
  survives at all** (collapses against blue under CVD — which is why the answer is green+purple, not
  the obvious next hues), and the validator scores sub-3:1 as `relief`, NOT `fail`, so `ok === true`
  hid a second relief warning until filtered for explicitly — **a pass/fail API can carry a third
  state.** Generalises: _reproduce a recorded measurement before treating it as an acceptance bar._
- **Eight breaks watched; six isolate to exactly ONE test.** Clamp the slot to 2 → 13 red **and the
  suite SHRINKS 1533 → 1527** (the width-parameterized cases stop existing — a break that DELETES
  tests, so the totals must be compared, not just the failures); stop filtering lanes → 5; constant
  canvas → 1; shared channel → 1; shared stub → 1; M7's crossing route → 1; a tint dropped from ONE
  dark block → 1 (nothing else in the repo can see a drifted dark block); M7's fixture → 2.
- **Handed to step 8, named so it cannot be lost:** `PairingReadoutView`'s caption is a literal
  **"up to 2 instructions may issue together"** — WRONG at widths 3/4 since step 6 shipped the control —
  and `REFUSAL_TEXT`'s "its partner" is pair-shaped. `pairing-readout.ts` itself stays arity-generic.

### Step 6 SHIPPED — **the control gained positions, and so did a SECOND engine**

The ISSUE toggle offers 1/2/3/4. `MAX_ISSUE_WIDTH` moved to `engine-common`; the OUT-OF-ORDER model
is capped at the same bound **and netted at it** (user pinned CAP BOTH over gate-positions-per-model).

- **Two "lawful answers" were NOT symmetric, and the DAG settled it in one query.** `eslint.config.js`
  forbids `engine/out-of-order` importing `engine-superscalar`, so the constant could not stay where
  step 1 put it. It moved to **`engine-common`** — the one production edge both engines declare, the
  exact M7-step-0 precedent (`predict.ts`/`cache.ts` moved down because _a second model needed them_).
  Superscalar RE-EXPORTS it, so all eight importers are untouched. **Check the DAG before weighing
  two options as equals.** Side effect recorded in both files: `engine-conformance` CAN now import
  the bound, so step 4's split is enforced by judgement rather than by a package cycle.
- **The rejected alternative failed for a reusable reason: gating the CONTROL's positions contains
  nothing.** `useSimulator` hands its width to whichever engine is driving and `engineConfigFor`
  clamps only `cache`, so superscalar@w4 → switch model would hand OoO an unbounded width whatever
  the widget offered. **A hazard reachable by a path the control does not sit on is not fixed by
  changing the control.**
- **The dump repriced the step from "own milestone" to "one commit".** OoO × corpus × widths 1..4 ×
  both orders × 3 schemes × 3 caches = **792 cells, 0 mismatches**, run BEFORE the guard was touched;
  and every OoO runner is ALREADY bounded (unlike the superscalar's at step 1), so the liveness
  hazard was **measured absent**. Product finding: **width 4 keeps paying OUT of order where it stops
  paying IN order** — `array-sum` 51→42→36→36 in order vs 51→33→30→**26** out of order. The
  diminishing return that justifies the bound belongs to the IN-ORDER machines, not to the width axis.
- **⚠ THE STEP'S SHARPEST RESULT, and it is an experiment: `this.width = Math.min(width, 2)` —
  an engine running NARROW while reporting the width it was handed — reddens 147 of the 180 new
  TIMING cells and leaves ALL 807 conformance cells green**, including the 396 width-3/4 ones added
  in the same step. That is "INV-8 is a FALSE net here" built rather than warned about.
- **⚠ THE 33 SURVIVORS HAD TO BE ENUMERATED, AND THE FIRST CHARACTERISATION WAS WRONG.** The draft
  docblock called them "the programs cycle-identical at 2/3/4 — `add.s`, `byte-loads.s`,
  `call-return.s` and the like". Measured: `byte-loads` and `call-return` are fully RED. The real set
  is `add.s` w3+w4 (9/9 each), `paired-branches` w3 (6/9, base schemes only), `sum-loop` w3+w4 (3/9
  each) and `slow-op-loop` w3 (3/9) — **the last three surviving under `static-taken` ONLY.** So only
  `add.s` survives for the boring reason; **the other 15 are scheme-specific, and a BETTING scheme
  HIDES a width bug the base scheme exposes.** The intuition runs the other way (betting adds a
  mechanism, so it should expose more) and is wrong. Practical rule: **a wide assertion whose program
  AND scheme fall in that set is a width-2 measurement wearing a width-4 name** — and `N`/`P`/`M` are
  width-invariant, so the TOTAL is the only line carrying the width claim. Generalises past the repo:
  _"which cells survived my break" is a measurement too — enumerate it, don't characterise it from
  memory of the table._
- **The transplant copies TERMS, never totals** (`base.groups`, `base.blocked.on`, `taken.groups`
  from the superscalar's `wide` table); the closed form computes the total. A table of expected
  CYCLE COUNTS read off a passing run is an identity over engine output and looks exactly like a
  derivation — the M7 step 2b trap. Verified in advance: a script computed all 180 cells from those
  terms and matched the dump **180/180**, so the docblock calls the suite a cross-check turned into a
  standing net, not a prediction.
- **The width-2 betting DELTA does not generalise.** At w2 a bet kills its group's single mate
  (`bettingGroupsOn`, a delta); at w ≥ 3 a bet RE-PARTITIONS the tail, which the superscalar's table
  stores ABSOLUTELY. Needed a new field shape + code path, not six more numbers per program.
  **Copying a number whose meaning changed is not a transplant.**
- **⚠ THE SEAM FIXTURE HAD TO CHANGE — step 5's trap, one step later.** The existing seam pins
  `sum-loop` 56→44 and `array-sum` 51→42; across four positions those are 56→44→43→**43** and
  51→42→36→**36**, so both are structurally BLIND to the 3→4 flip. `slow-op-loop` moves at every
  position: **44→35→34→33**. The plan's own acceptance criterion names `array-sum` — fine as a demo,
  useless as a seam. Also: `<` between 3 and 4 is simply FALSE on 9 of 11 programs, so the obvious
  monotone assertion would have to weaken to `<=`, which the identity toggle satisfies too.
- **⚠ THE WIRING GAP IS WORSE AT FOUR POSITIONS, and step 9 must be told where to look.** Clamping
  `loadInto`'s width to 2 leaves **all 1518 web tests green** (re-provoked, not inherited). M7's
  version deleted the field and ran BOTH positions at width 1 — a fully dead toggle an eyeball
  catches at once. The reachable failure now is a clamp: **widths 1 and 2 stay CORRECT, only 3 and 4
  collapse.** A control right where the reader checks it and wrong at the end. Breaking the half that
  IS reachable (`loadSource`) reddens **exactly one test in 1519 — the new one.**
- **`configLabel`'s `?? 1`: measured, and step 6 did NOT make it reachable.** All 4 OoO lesson JSONs
  state `issueWidth`; `session.ts` applies its own `?? 1`; `useSimulator` seeds `useState(1)`. Stays
  handed forward rather than claimed closed. Deliberately did NOT change OoO's `?? 2` engine default
  — that moves pinned recordings.
- **The OoO datapath needed no work, structurally rather than luckily.** Both of step 5's sweep
  spellings came back EMPTY on `datapath-out-of-order.ts`, `OutOfOrderDatapathView.tsx` and
  `MicroTablePanel.tsx`: this model's `location` is uniformly `"ROB#tag"` (tag-keyed) and its FUs are
  drawn as POOLS, not replicated lanes. **A model with no slot in its location encoding has no slot
  arity to get wrong.** Step 5's `MAX_WIDTH = 2` finding is still step 7's, unchanged.
- **The picker's PROSE is now derived too.** `SUPERSCALAR_MODEL_DESCRIPTION` (step 1's deliberate
  debt, "up to two") interpolates `MAX_ISSUE_WIDTH`. It is the one place the number is user-facing,
  and a stale copy there fails silently — **nothing in this repo asserts on a description's wording.**
  Same class: the tooltip was a ternary on `=== 2`, which would have rendered widths 3/4 under width
  1's copy ("never finding a partner"), in a string no test read.

### Step 5 SHIPPED — **the fixture stopped scaling, and the sweep found the view's silent hole**

Recorder + `location` at widths 3/4, and it WAS free: acceptance is `git diff --stat` showing **two
test files, zero engine or recorder lines**. `packages/trace/src/recorder.ts` is untouched.

- **A fixture sized for the old width is a DIFFERENT MEASUREMENT wearing the same name.** M7's
  headline (10 ids / 10 locations / 1 cycle = 5 stages × 2 seats) parameterizes to `5 × width` — but
  `TEN_INDEPENDENT` holds ELEVEN instructions, so at w3 AND w4 it peaks at **11 in flight**, never 15
  or 20; the whole program is in the pipe by cycle 2. A `5 × width` assertion over it is red; a
  `toBeGreaterThan` is green and meaningless. `TWENTY_INDEPENDENT` gives 5/10/15/20 at cycle 4.
  **Dump a fixture's peak before parameterizing anything over it.**
- **SUBSET vs SURJECTIVITY are different claims with different scopes.** "Nothing outside
  `STAGES × [0..w-1]`" is universal; "every slot appears" is program-specific — measured: all 11
  programs at w1/w2, all but `add.s` at w3, and **exactly the three `timing.test.ts`'s `fillsFour`
  names at w4**. Two independent measurements (location set vs. issue-size histogram) on the same
  three names. Asserting surjectivity corpus-wide = a width-4 test measuring width 3.
- **The asymmetry that causes it, and it is the tier's lesson: at w4 TEN programs emit `IF.3`, THREE
  emit `EX.3`.** Fetch is not gated by the pairing rules, issue is by all three.
- **Width ≥ 3 is where a slot can move by MORE THAN ONE in a cycle** — width 2's seats {0,1} cap the
  move at one _whatever the issue logic does_, so the old claim was structurally weaker than it read.
  The existing `SLIDER` builds it at w3 with no new program: `IF.0 → ID.2` while its elders slide
  1→0 and 2→1. Largest jump per width = **[0, 1, 2, 1]** — **w4 is NOT the extreme case** (all four
  fit, the group slides uniformly, nothing jumps).
- **Two breaks, and the value is how cleanly they SEPARATE.** (1) clamp `place()`'s slot to
  `min(s,1)`: **494/2157 red, every one a width-3/4 cell** (468 in `timing`'s wide block, 14 in
  `wide-groups`, 12 new; `timing` keeps 772 green; ZERO failures scoped to width 1 or 2). (2) slice
  the `micro` snapshot to `min(width,2)` with `width` honest: **exactly 3/2157 red** — step 1's shape
  test plus the two new micro-tracking cells, and nothing else in the repo.
  ⚠ **The width-1/2 half had to be re-measured PACKAGE-WIDE.** The first pass ran the JSON reporter
  over only the two edited files, so "every width-1/2 cell green" was an extrapolation from 2 of 8 —
  step 4's _a measurement's glob is part of its claim_, recurring in the step that cites it. **A
  package-wide COUNT is not a package-wide per-test result.**
- **The subset test's own assertion was BLIND, and only the break could teach that.** The clamp emits
  only LEGAL locations, so `legal.has(location)` never fired — what reddened was the **non-vacuity
  clause riding with it**. The docblock had claimed "stays green through it", written before the
  break ran; corrected in place. **A test can be right about what it cannot see and wrong about which
  of its own lines does the work.**
- **⚠ THE SWEEP'S ONE HIT — a width-3 hole in the VIEW that fails silently. It took TWO SPELLINGS.**
  The first pattern (`MAX_WIDTH|LANES\s*=|slot\s*[<>=]+\s*2|\[0,\s*1\]|width\s*===?\s*2`) **could not
  have found step 3's own blocker** — a loop bound `s < 2` over a template string, where the bound is
  named `s`, not `slot`. Second pass (`(<\s*2|<=\s*1)\b`, plus a literal `.1`) over all non-test
  files: no new code — two unrelated `< 2` hits and four `.1` hits that are ALL PROSE (the width-1
  "lane 1 is ABSENT, not dimmed" rule, in `datapath-superscalar.ts` / `App.tsx` /
  `SuperscalarDatapathView.tsx`; pair-shaped, moves with step 7). **Run the second spelling before
  reporting a sweep as empty — the milestone had already paid for this once.**
  The one CODE hit: `web/src/datapath-superscalar.ts` hard-codes `MAX_WIDTH = 2`, `parseLocation` returns `null` for
  slot ≥ 2, so an `EX.2` occupant is **dropped from the occupancy map with no crash and no red
  test**. Handed to **step 7** (named in the plan + in `recorder.test.ts`'s NOT-re-proven list), not
  fixed here. Complement: `pairing-readout.ts` is arity-GENERIC (`ID.${s}` over a `width` param) —
  only its vocabulary is pair-shaped (step 8). False positive to not re-chase: `multi-cycle`'s
  `width === 2` is a store's byte width.
- A LITERAL `it.each` row list is the one thing a derived `WIDTHS` does not protect — it carries a
  completeness assertion against `WIDTHS`. `sum-loop`'s 43/43 are a **cross-check, not a
  prediction**. The four-position toggle test pins that **w4 buys nothing at all** on `sum-loop`.

### Step 4 SHIPPED — **the scoped question was boring; the bug was one axis sideways**

Conformance at 4 widths (superscalar matrix 36 → 72 configs, `WIDTHS` derived from
`MAX_ISSUE_WIDTH`), `FOUR_AXIS` widened, `configLabel` fixed. In order of what they cost:

- **`configLabel` compared RAW and rendered DEFAULTED**, on all three optional knobs. `c.issueWidth
!== first.issueWidth` fires for `undefined` vs. explicit `1`, and both render `width 1` — a
  duplicated title. Exact inverse of the `cacheEquals`/`cacheLabel` invariant **the same file
  declares load-bearing** ("the label renders exactly the fields the equality distinguishes"). Same
  in `outOfOrderIssue` and `robSize`. Fix = default BOTH sides; correct outcome is **silence, not
  two names** (absent and the default are the same machine). Rejected alternative: render
  `width unset` — it MOVES TITLES. Generalises: **when a knob has a default, the varies-test and
  the render must apply it at the same place, or "varies" and "named differently" come apart.**
- **The step's thesis, run as an experiment.** Break: collapse the render to `min(w, 2)`. Result:
  **3 conformance guards red, the superscalar's 797-test matrix ENTIRELY GREEN** (835/838). 72
  configs under 54 titles, widths 3/4 wearing width 2's name, no cell red. That is what "a
  duplicated title is indistinguishable from a correct one" looks like when you actually build it.
- **Title invariance had to be MEASURED — nothing in the repo asserts on `it()` titles**, so a
  `configLabel` edit renaming five other suites leaves the run green and teaches nothing. JSON title
  dumps of all 7 `runConformance` call sites, before/after: 1140 → 1541, **0 removed**, 401 added
  and all confined to the two edited files. **A green run is not evidence of title-invariance.**
- **The DAG decided where each half of the claim lives.** `engine-conformance` is model-agnostic by
  eslint rule and `engine-superscalar` imports it, so importing `MAX_ISSUE_WIDTH` back is a package
  cycle. Harness owns the SHAPE claim (N widths ⇒ N labels, literal); the model's own file owns the
  COMPLETENESS claim (reaches every width the guard admits, derived). Check the DAG before choosing
  a file, not after the lint fails.
- **A fifth unfailable check caught before shipping** (after M12's `Lesson.depthDefault`, step 2's
  string tautology, step 3's dead `taken.doomed`). The new guard's first draft asserted the duplicate
  titles COLLAPSE (`distinct === len/2`) — but under the raw compare both still render `width 1`, so
  it holds in BOTH worlds and can never redden. Replaced by set-equality against a lone neutral
  config's titles. **Ask of every new assertion: what state makes this red?**
- **Handed to step 6, not fixed:** `configLabel` renders `?? 1` — the SUPERSCALAR's default. The OoO
  model defaults absent width to **2**. Unreachable today (every OoO config states its width); a
  shared control makes it reachable. OoO `WIDTHS` deliberately left `[1, 2]`.
- **What 396 green cells buy, said honestly — and a claim walked back in review.** The step-0 dump
  had already measured width-3/4 final state, so this holds it in a suite. That is nearly all of it:
  they buy **nothing** on the mis-copied-ISA-idiom class (width-invariant, already caught) and cannot
  see out-of-order retirement (M7 step 2b ran green through a matrix this exact shape). The draft
  called them "a second bounded-liveness sweep" — **overclaim**: `checkProgram` caps at 100 000 steps,
  but `halt-shadow.test.ts` already sweeps THE SAME CELLS at a **500-cycle** bound. _A weaker bound
  over ground already swept is not an independent net._ Generalises: when claiming a new net, name
  the existing one covering those cells and say which bound is tighter.
- **A consumer outside the measurement glob had to be cleared before "titles unchanged" could
  generalise.** `web/src/lessons.test.ts` mentions `configLabel` and was not in the dump — prose
  only (citing the M4 collision), and structurally incapable of more: `configLabel` is module-private
  and that file imports nothing from `engine-conformance`. **A measurement's glob is part of its
  claim** — enumerate the consumers, don't infer them from where you happened to look.

### Step 3 SHIPPED `ba14b43` — **the ruler measured 2, and no audit could have found it**

The width-3/4 timing matrix, 44 hand-derived cells in `timing.test.ts` (extended IN PLACE — a forked
file would have duplicated `measure`/`run`/`penaltyOf`, two copies of the thing under test).
Derivations at `M:\claud_projects\temp\m13-step3\predictions.md`, written in full BEFORE the run.
**435 of 441 cells green on the first run.** In descending order of what they cost to learn:

- **The blocker was in the SUITE, and it is the generalisable finding.** `issuedPerCycle` looped
  `s < 2` — M7 step 4's arity. Left alone, every group of 3 or 4 reads as at most 2, `G` comes out
  too high, and all 44 cells get fitted to a broken ruler, **permanently green**. Restoring the `2`
  reddens 432 cells while all 764 width-1/2 cells stay green. **Step 1's audit could NOT have found
  it**: that sweep matched literal slot indexing (`idEx[0|1]`), and this arity is a loop bound over a
  TEMPLATE STRING (`` `ID.${s}` ``). So "the mechanical sweep came back empty" was true and did not
  mean what it sounded like. Generalises: **an arity sweep finds the arities you spelled the way you
  searched.** Before trusting any wide measurement, ask what the MEASURING code assumes about width.
  Width now comes from the CALLER, not `micro.width` off the trace — over-scanning empty slots is
  harmless, trusting the engine's own claim would hide an engine that ran narrow while claiming wide.
- **`Q` does not generalise; the ISSUE-SIZE HISTOGRAM does** — and it is the only thing that catches
  the plan's own trap. Capping the issue group at 3 reddens exactly the three programs that fill four
  slots, and **`branch-flavors.s` at width 4 still runs exactly 10 cycles under that break**
  (`slots` 10 vs 11). **No cycle count in this repo can see it.** `G + Q = retires + doomed` becomes
  `Σ k·sizes[k] = retires + doomed`, both sides measured. Only `branch-flavors`, `paired-branches`
  and `slow-op-loop` ever reach a group of 4 — measured and asserted BY NAME, so the other eight
  programs' width-4 cells now say they are width-3 measurements instead of implying otherwise.
- **The six failing cells were ONE number and the engine was right.** `call-return.s` @ w3/w4 × fwd
  OFF × `static-taken`: L = 1, predicted 0. Diagnosed by DUMPING the trace, not by patching the pin.
  Under the base behaviour the `jal`'s two-cycle misprediction penalty is exactly the gap its
  producers need to reach WB, so `bge` never interlocks; **the correct bet deletes that gap** and
  meets both `addi`s still in EX/MEM. The bet buys 2 cycles of flush and hands 1 back. A WIDTH-3
  effect — at w2 the `jal` bets a cycle later, so `w2.blocked` is 0. **Widening moved the bet one
  cycle earlier and exposed an interlock that had never fired anywhere.** Generalises: _a penalty and
  a stall can be covering for each other; removing the penalty reveals the bill._ It was also the
  risk NAMED IN ADVANCE as most likely wrong — naming them beforehand made the post-mortem cheap.
- **Two findings the cycle counts hide.** `paired-branches`'s 9→7→7→6: w3 buys nothing NOT because
  the third slot goes unused — **it fills**. G is 3 at w2 and w3 with different SHAPES (`{1,2,2}` vs
  `{1,3,1}`); the third slot pulls `addi a7` forward and pushes `ecall` into a group of its own.
  And `slow-op-loop`'s single w4 cycle is **entirely a PROLOGUE** — four independent `li`s, one group
  of four, ONCE in six iterations. Mirror image: **`static-taken` SPENDS the width** (a bet ends its
  group), so that program runs 6 at w4 base and 11 under betting — the same 11 it runs at w3.
- **Widening DELETED the corpus's only forwarding-shaped partition change**, so `groups`/`sizes`/
  `doomed` carry no forwarding position at width ≥ 3 (asserted, not assumed). At w2 `array-sum` ran
  G = 25/26 across the toggle because the `lw`'s slot-1 `raw` refusal split a pair; a third slot
  refuses the same `lw` for `intra-pair-raw` whatever the toggle says, and pairing is checked first.
- **State which of your green columns was BLIND.** The w3/w4 fwd-ON/predict-none/no-cache totals were
  already published in the step-0 dump, so those 11 numbers are a cross-check, not a prediction —
  said so in the docblock rather than claiming a clean sweep. Same defect class as `CycleCtx.bet`.
- **⚠ PowerShell `Set-Content` CORRUPTED this file mid-step** — it read UTF-8 as cp1252 and wrote the
  mojibake back, mangling 268 lines plus BOM plus CRLF (`git diff --stat` jumped to 316 deletions).
  Reversible (decode UTF-8 → re-encode through cp1252 → decode UTF-8; script kept at
  `M:\claud_projects\temp\m13-step3\fix-encoding.mjs`), but **never use `Set-Content` on a source
  file in this repo.** Bash `cat`/`perl -0pi` are byte-safe; the Edit tool always is. Also: a large
  `cat << 'EOF'` heredoc TRUNCATED silently mid-content — write to a temp file and `cat` it on.

### Step 2 SHIPPED — the arity > 2 nets, and **the break record is worth more than the tests**

`wide-groups.test.ts`, 19 cases, four provocations, **seven deliberate breaks watched**. The
generalisable results, in order of how much they cost to learn:

- **The step's real finding is about the REPO, not the machine.** Only two of the seven breaks are
  invisible to everything else. Three are caught by exactly ONE existing file —
  `halt-shadow.test.ts`, and only because step 1 derived its `WIDTHS` from `MAX_ISSUE_WIDTH` — and
  **every time it reports a hang or an internal-invariant crash rather than the defect** ("did not
  terminate within 500 cycles"; "halted with instructions still in flight"). So after step 1 the
  repo's entire width-3/4 coverage was a LIVENESS net, which converts arity bugs into crashes
  without naming them. Generalises: _when a net catches your break, ask what it says it caught._
- **The break that hides at width 2 BY CONSTRUCTION is the one to design for.** `issueVerdict`'s
  `for (const older of group)` vs. `group[0]` are the same function at width 2 — when slot 1 is
  judged, the group holds exactly the leader. So no existing test could see the difference, and the
  loop's arity had been read at step 1, never watched. Finding that break is what added a FOURTH
  provocation the plan never scoped. Same shape found the two-slot-capped forwarding scans.
- **One rule, two implementations: `resolveOperand` has TWO descending scans** (EX/MEM then
  MEM/WB), and the obvious program only reaches the first — the writers are still in EX/MEM when
  the consumer resolves, so the second loop never sees three candidates. A second program with a
  whole filler GROUP between them drains the writers to MEM/WB. Capping each loop separately reddens
  only its own cases. **"The forwarding scan is watched" was covering for half a claim.**
- **"The corpus CANNOT show X" is a measurement, not a premise — and one of the three was FALSE.**
  The step was scoped as three things the corpus cannot reach; the single-follower freeze break
  crashes `store-forward.s @ w3/nofwd/none/cache2`. Mirror image of the exit-idiom finding above:
  claims about corpus coverage expire at some width in BOTH directions. Where the claim is still
  needed it is now a sweep (no corpus program co-issues three same-`rd` writers; max observed is 2).
- **The degenerate case is the one the plan asked for, and it was the least informative.** A
  transfer in the LAST slot kills nobody in EX — structurally what a width-2 slot-1 transfer does.
  The informative shapes are the MIDDLE (older survivors AND younger casualties in one stage, which
  width 2 cannot build) and the LEADER (three younger mates to kill, where "everything above me
  dies" and "the slot above me dies" stop being the same sentence). **Ask which slot makes the
  claim differ from its width-2 spelling, not which slot is extreme.**
- **An edit that reads like a bug and provably is not.** `ctx.squash.slot !== slot` looks like it
  would kill a middle-slot transfer's older mates; EX is walked oldest-first, so those slots have
  already executed. Rejected as inert rather than run — but only after checking, and it is recorded
  because the next reader will have the same idea.
- **A tautology got as far as a passing test.** `expect(SAME_RD.match(/addi x1,/g).length).toBe(3)`
  asserts a property of a string literal three lines above it — it can only fail if someone edits
  the literal. In a file whose thesis is that an unfailable green check is worse than none. Replaced
  by the corpus sweep that measures the claim. **Vacuity is not a beginner's mistake; it is what
  "documenting the setup" turns into when nobody asks what would falsify it.**

### Step 1 SHIPPED `3fbda0c` — and it confirmed the dump's headline the hard way

`MAX_ISSUE_WIDTH = 4`, **exported** from `engine/superscalar` so steps 4/6/7 read the bound from the
engine that enforces it instead of re-typing a `4`. Guard shape is the M9+M10 capacity one
(`!Number.isInteger(w) || w < 1 || w > MAX`), because `w < 1` alone is false for both `NaN` and
`1.5` — and a NaN width makes every `s < this.width` body unreachable, i.e. a processor that fetches
nothing and never halts.

- **The audit's CODE half came back empty, and that is the reportable result.** A sweep for literal
  slot indexing (`idEx[0|1]`, `exMem[…]`, `ifSlot[…]`) across all of `packages/` matched **one line,
  in a test, deliberately about slot 0**. There was no arity-2 code anywhere. The step was the guard
  plus ~20 docblocks. **Run the mechanical sweep before believing either "it's all generic" or "this
  will be a rewrite"** — it settles in one query what prose argues about for a page.
- **One docblock was a real defect, not stale phrasing.** `CycleCtx.bet` said the bet's casualty set
  "grows by exactly one seat"; it is up to `width - 1` seats. It survived because **the count never
  reaches the trace** — `flush.stages` names stage FAMILIES, so N dead ID seats and one dead seat
  are both the string `'ID'`. A wrong number that no consumer can observe is exactly the kind that
  outlives its milestone.
- **Names that reach the trace were deliberately NOT fixed.** `'intra-pair-raw'` is a `stall.reason`
  three consumers read (`pairing.test.ts` asserts it, the readout glosses it, curriculum can anchor
  on it) — renaming moves trace bytes for a spelling, and step 1's own acceptance is byte-identity.
  It carries a line saying the name is historical and means intra-GROUP. Same call for
  `SUPERSCALAR_MODEL_DESCRIPTION` ("up to two"): it is the picker's user-facing copy and describes
  what the product OFFERS, not what the guard admits, so it moves in step 6 with the control.
  **Two different rules, one distinction: is this string a contract, a UI promise, or a comment?**
- **The byte-identity acceptance, reported for what it was worth.** 396 whole-trace sets (11 programs
  × widths {1,2} × 18 configs), 22 455 cycles, ~50 MB: 396/396 byte-equal. Two things made it worth
  running at all, and both are reusable: `MachineState.memory` is a `SparseMemory` whose `Map` is
  PRIVATE, so a naive `JSON.stringify` emits `{}` and the compare **passes vacuously on memory
  everywhere** — the serializer must enumerate `definedAddresses()`; and the compare was falsified
  (w1≠w2, fwd≠nofwd, cache≠nocache) before being trusted. But the honest report is that byte-identity
  was CHEAP here: no code outside the guard changed, so nothing could have moved. **Say which of your
  green checks was cheap.**
- **Liveness net widened in the SAME commit as the guard.** Opening the guard makes 3/4 reachable;
  `halt-shadow.test.ts` is the only net in the repo that turns a width-3/4 non-termination into a red
  test rather than a hung suite (every other runner loops `while (!p.isHalted())` unbounded). Its
  `WIDTHS` is now DERIVED from `MAX_ISSUE_WIDTH`, not typed `[1,2,3,4]`, so raising the bound cannot
  leave the widest machine the least tested. **Never open a guard in one commit and net it in the
  next.**
- **⚠ THE SPACER BUYS EXACTLY ONE SLOT — the step's real finding, and it came from the provocation,
  not the plan.** Run against the PRE-`a9f1b70` engine, the widened sweep wedges **72 corpus cells**:
  36 at w3 + 36 at w4, in `array-sum-twice`, `slow-op-loop`, `sum-loop`, in each of the 12 no-bet
  configs per program per width (`static-taken` escapes at every width, exactly as the bet rule
  predicts). At width 2 the corpus's `li a7, 10` exit spacer separates the branch from the `ecall`;
  **at width 3 one issue group swallows all three.** So `a9f1b70` was a HARD PREREQUISITE for opening
  the guard, not a courtesy pre-milestone cleanup — without it, step 1 ships a machine where 3 of 11
  shipped corpus programs hang the web app at width 3. Generalises: **an idiom that makes a whole
  corpus safe is buying a FIXED NUMBER OF SLOTS, and widening spends them** — so "the corpus is safe
  by accident of one idiom" is not a static fact, it has a width at which it expires. Extends
  [[cycles-cannot-see-a-lost-forward]] and the corpus-uniformity blind spot above.
- **Watch every new assertion fail first — twice here, and one of the two mattered.** `?? 1` → `?? 2`
  reddens the default test; latches allocated at `min(width, 2)` while `width` is stored HONESTLY
  reddens the shape test. That second one is the point: `expect(micro.width).toBe(w)` only checks
  that `reset()` remembered its argument, so **assert the machine's SHAPE (`idEx.length` &c.), not
  the guard's verdict.** The absent-`issueWidth` path also had no net at all — the byte-identity
  goldens always passed the field explicitly, so the one config shape every repo literal actually
  uses was the one shape 396 trace sets never exercised.

**The step-0 dump overturned two of the three things this milestone was scoped as. That is the
milestone's first lesson: it cost one measurement pass and it saved the whole plan.**

### 1. The pairing rules were ALREADY width-generic — the memory that said otherwise was wrong

[[future-microarchitectures]] said `intra-pair-raw`/`mem-port`/`branch-slot` are "written for a
pair", so M13 = generalize them. **False, and now corrected there.** That was a description of the
GUARD'S ERROR MESSAGE, not of the code: `stageId` loops `s < this.width`, `issueVerdict` loops
`for (const older of group)` and asks each rule against the whole group, `detectHazard` scans
`this.width` slots, `stageIf`'s hand-over is a seat-filling loop. Widths 3 and 4 run the entire
corpus with correct architectural state and monotone retirement **with the guard as the only thing
changed**. So the engine half is a guard, an audit and a net; the budget belongs to the view.

**Generalises past this repo: a memory that paraphrases an error message can read exactly like a
memory that describes the code.** The tell was available for free — the loops are three lines apart
from the guard.

### 2. The dump found a LIVE DEFECT AT SHIPPED WIDTH 2 — `fix(superscalar)` `a9f1b70`

A halt (`ecall`) in an unresolved branch's shadow raised the **sticky** `haltFetch` at ISSUE. When
the branch resolved taken the halt was wrong-path — squashed — but fetch never restarted. The pipe
drained, `halted` was never raised (only a RETIRING halt raises it), and `isHalted()` stayed false
for ever, so **a bare `while (!p.isHalted())` never returns.** Precisely, because the layers differ:
`Recorder.runToEnd` (`recorder.ts:158`) loops on `isHalted()` but is guarded by
`maxCycles = 1_000_000`, so it THROWS rather than hanging — after accumulating a million cycle
traces, each with a full state snapshot, which is not survivable memory (this investigation's own
first dump run exhausted a 4 GB heap that way and had to cap itself before it could report).
**A guard that turns an infinite hang into an OOM is not a guard that makes the bug benign** — and
saying "it hangs" of a layer that actually throws is the kind of prose defect M7 step 3 named.

- **Reachable at width 2**, not just at the new widths: `bnez` immediately followed by `ecall`.
  From width 2 a halt can issue in the SAME GROUP as an unresolved branch — `ecall` reads no
  register, uses no memory port, is not a transfer, so no pairing rule refuses it. Width 1 is immune
  structurally (`stageId`'s `ctx.squash` early-return always beats it). `static-taken` escapes
  because the bet ends the group.
- **The corpus was safe BY ACCIDENT OF ONE IDIOM, which is why 4498 tests were green.** All eleven
  programs exit with `li a7, 10` sitting between the branch and the `ecall`, and that spacer is the
  only thing keeping the halt out of the branch's group. **Before trusting any corpus-wide sweep,
  ask what all the programs happen to share.** This is the sharpest instance yet of the
  [[cycles-cannot-see-a-lost-forward]] family: the net was wide (11 programs × 36 configs) and blind
  in the same direction at every point.
- **Choosing the fix by what it CANNOT move.** Three candidates; two (end the issue group at any
  unresolved transfer; defer `stopFetch` to retirement) change when fetch stops on runs that already
  work and would have invalidated M7 step 4's timing matrix. The one kept — a branch squash CLEARS
  `haltFetch` — fires only on runs that previously never terminated, so no pinned count can depend
  on it. **Acceptance was "re-run the matrix and assert zero numbers moved", not an argument.**
  Timing (606) and pairing (21) confirmed unmoved.
- **Non-termination was UNOBSERVABLE anywhere in the repo** — every runner loops on `isHalted()`, so
  the failure mode is a hung suite, not a red test. `halt-shadow.test.ts` adds a cycle bound over
  corpus × width × forwarding × prediction × cache to convert a hang into a failure. **That sweep
  PASSED against the broken engine and its docblock says so**: it would not have found this bug. The
  three tests that would were watched failing first ([[m11-m12-review-resolved]]'s method lesson).
- **The CONVERSE needed its own test, and two drafts of it failed against a CORRECT engine.** "Clears
  the flag only on a branch squash" was an argument about slot ordering, so it had to be watched.
  The program needs live code AFTER the `ecall` or the test cannot fail (with the halt last in
  `.text`, fetch stops on the `inText` bound either way — a green check measuring nothing). Then:
  asserting nothing past the halt is fetched is WRONG (the halt's shadow is fetched by design,
  `stopFetch` applying at the clock edge), and asserting nothing past the SHADOW is wrong too (a
  2-wide machine fetches the shadow two at a time). Measured bound: **one fetch GROUP**, `halt +
4 × width`. The config-independent assertion — the dead code never commits — is the one that
  matters. **Reasoning produced the right fix and the wrong test, twice.**

### 3. Width 4 is where widening STOPS paying — and that is the tier's real lesson

Nine of eleven programs are cycle-identical at w3 and w4; only `paired-branches` (7→6) and
`slow-op-loop` (34→33) gain a single cycle. `array-sum` 51→42→36→36. Max group reaches 4 on three
programs, for a cycle or two. The binding rule is `intra-pair-raw` (roughly doubles w2→w4:
`sum-loop` 0→11, `array-sum` 11→18), joined at w4 by `branch-slot` firing where it never did
(`array-sum-twice` 0→24). **So no new corpus program is forced** — the question that would have
required one (can the corpus fill 3 slots?) is answered yes.

### Both gating decisions PINNED (user, 2026-07-28)

- **Widths offered: 1 / 2 / 3 / 4** — as seeded. The case for 4 is the diminishing return itself.
- **Lane hues: EXTEND the set to four validated tints** — this OVERRODE the seed, and the seed was
  wrong in a way worth remembering. It argued "the palette is machine-validated, never invent a
  hue" — but **that rule governs `PHASE_COLORS`, the 5-slot STAGE set. The lane tints are a SECOND
  categorical channel** (`--lane-0`/`--lane-1` in `styles.css`) with its own record: "CVD separation
  dE 41.3 light / 42.6 dark", validated 2026-07-14. A 2-slot set validated at 2 slots carries no
  prohibition on being validated at 4, and M11's stage-family fold is not the precedent (five stage
  hues were fixed for an unrelated reason). **Two validated channels can share the word "palette"
  and not share a single constraint — name which one a rule belongs to before citing it.**
  Extending is therefore re-validation work, not invention; the real constraint on the two new hues
  is **no red and no amber at any slot** (red = danger/flush family, amber = warn wash), which is
  tight once blue and magenta are also spoken for. New tints go in the base block AND both dark
  blocks — `styles.css` asks for identical dark blocks and no headless test can check that.

### What step 7 assumed was mechanical — ANSWERED, and the assumption was half wrong

The note here predicted `LANES = [0, 1]` and the two-sided rail scheme, and both were real. It also
said "everything else is mechanical because `LANE_DY` is a pitch". **That was wrong about the
DRAWING**: the canvas, the bars' height and every rail's y are functions of the lane count, so the
geometry had to become `geometryFor(w)` rather than a constant with a filter. See step 7 above.

### Still unrun, and named as steps rather than cleared

Same-`rd` co-issue (two independent writers in one group — an ascending-slot forwarding scan would
pick the older); the MEM freeze with followers in `MEM.2`/`MEM.3` (M7's one real bug lived exactly
there, and "propagate downward in age only" has never met more than one follower); a transfer in the
last slot of a full group. Corpus retire-monotonicity was clean at all four widths, but that is
corpus-only. **INV-8 stays a FALSE net here** — the closed form `G + L + P + M + 4` is the net, and
width-3/4 cells must be DERIVED, never copied from engine output (the M7 step 2b trap, paid once).
