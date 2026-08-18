---
name: m16-scoreboard-lessons-step0
description: "M16 (the scoreboard's LESSON track — the seventh model's, and the last one missing). STEPS 0-4 DONE 2026-08-18: the dump decided the design, ALL THREE LESSONS SHIP (the ceiling, WAW, WAR) and the track's ORDER PINS are in; next is step 5, the browser pass — the last step. Step 4's carry-forward findings: TWO of its own conclusions were WRONG and are corrected in place — the COUNT 'pin' fires when NO SENTENCE LIES (append a fourth lesson AFTER the third and 'the next two lessons' stays true, so it was relabelled a CANARY; an assertion can be arithmetically independent of every other and still not guard the sentence it is filed under, and only READING the prose against the perturbation can tell the two apart), and the mention enumeration that called itself exhaustive was a KEYWORD REGEX blind to two of seven mentions (a reference that names no lesson — 'This is sum-loop again', 'the single-cycle machine this loop was first shown on' — has none of the stock phrases; re-run over TITLES, model names and history verbs instead). Both survived a green suite AND a seven-run perturbation harness. Also: three of the cross-references needed ADJACENCY rather than precedence BECAUSE TWO LESSONS SHARE A PROGRAM (a toBeLessThan is green over the one reorder that matters — ask what else could occupy the slot the sentence names); the nearest precedent's guard was the INVERSE of the claim (the OoO pin's toBeGreaterThan(0) asserts 'not first', this one asserts 'IS first'); and a pin can be UN-ISOLATABLE at the current size of the thing it guards and still be the only one that catches the defect once it grows (pin 3: in a three-lesson track any three of the four intra-track pins imply the fourth, so PERTURB THE SIZE as well as the order — but note the count pin FAILED this same test and was demoted). Also: vitest stops a test at its FIRST failed assertion, so a per-run red set is 'which fires first', not 'which are false'. THE HEADLINE CONSTRAINT: this model honors NO config knob, so buildPositions returns exactly ONE position and there is NO FLIP TO ASK FOR — which makes the sweep a STRONGER net (every step must fire) and RETIRES the M11+M12 finding-2 class entirely. But across three lessons the sweep has now been measured BOTH WAYS and neither is about meaning: step 2 found it GREEN while every sentence in the lesson was false, and step 3 found it RED — by ACCIDENT OF ANCHOR ORDER, because the stub pushed one step past another. A green sweep proves nothing about the prose and a red one is not evidence it can read. The recurring defect class in this track is the UNGUARDED SENTENCE: step 2 shipped three false ones and step 3 five more, all caught by hand, none reachable by any oracle or stub — a position claim that INVERTED the hazard (the young writer comes AFTER the older reader, so "in between" describes a read-after-write); a register spelling quoted from the wrong table (the instruction and functional-unit tables print x7, ONLY the register-result table says t2 — a real product wart, reported not fixed); a sentence contradicted by the on-screen caption because micro is snapshotted after the clock edge; and a claim about the PICTURE that is unreachable off micro because the row it points at has already retired (assert it through buildScoreboardTables, the fold that draws it); and a CORPUS claim composed out of a PROGRAM claim (two true numbers in one sentence do not license a third). Step 3 also found the SURVIVING TWIN of step 2's positional claim still in register-reuse.s's header, and an occupancy assertion in its OWN new oracle that was necessary but not sufficient — step 1's OCCUPANCY CEILING species, same organ, and NO stub ever exercised it. The renaming A/B is REAL but SMALL: both hazards renamed away move the scoreboard 31 -> 30 cycles and the WAR ALONE COSTS ZERO — the head start is absorbed one instruction downstream, where the next integer op takes its unit at 17 instead of 18 and then waits for a load until 23 EITHER WAY. The hazards buy CORRECTNESS, not speed: without the WAR hold a0 lands on 26 (measured by stub), and moving the young write above its reader makes a0 = 26 on all seven models (measured by source edit — and a line SWAP needs its own adjacency guard, since the replace-once harness does not transfer). That A/B was a NULL RESULT on its first run because String.replace over the whole source hit the program's own comment header, which quotes every instruction verbatim. Also measured: war fires FOUR times in the entire product (13 programs x 7 models) and all four are one instruction on register-reuse; war@WB is the ONLY (reason, stage) pair in the product outside the front of the walk; the reorder is ONE cycle (c17); i4 holds an integer unit for TEN cycles to run a one-cycle add (the earned reservation-station callback, kept at the DETAILED tier because resolveNarration falls back downward); and a cross-model cycle comparison measures MEM_LATENCY, not the scheduling discipline."
metadata:
  node_type: memory
  type: project
  originSessionId: dda99047-c5bc-452f-b80b-bd2d4f389e81
  modified: 2026-08-18T09:37:22.503Z
---

**Plan: `docs/plans/m16-tasks.md`. Status 2026-08-18: steps 0–4 DONE — ALL THREE LESSONS SHIP and
the track's order pins are in. Decisions 1–4 PINNED by the user (three lessons; `sum-loop` for the
ceiling; a NEW track, appended last), 5 applied as seeded (the rename A/B is an ORACLE, never an
invitation), 6–8 open. Next is step 5, the browser pass — the last step.**
The dump lives at `M:\claud_projects\temp\m16-step0\` (`dump.txt` 639 lines + `dump2.txt`, both
with JSON twins). It was run BEFORE the plan, which is this repo's method for a lesson track
([[m12-deep-pipeline-lessons]]), and it decided the design. Read it before authoring any step.
The machine itself is [[m15-scoreboard-planned]].

## ⚠ THE HEADLINE — a track with no toggle, and what that RETIRES

`SCOREBOARD_CAPABILITIES` has all five `configurable*` flags **false**, so `buildPositions`
(`lessons.test.ts:267`) returns exactly one position, `neutral config`. Three consequences, all
structural:

- **The sweep is a STRONGER net here than anywhere else.** "Every step fires in at least one
  position" collapses to "every step fires." **A config-exclusive step cannot exist**, so the
  [[m11-m12-review-resolved]] finding-2 class — a step silently skipped because the learner is
  parked elsewhere, which `deep-bet-pays-double` shipped broken — **cannot occur in this track.**
- **So "ask for the flip in the step before" must NOT go in the acceptance list.** It has no
  referent, and a checklist item that can never fail is the "pinned decision with no net" defect.
- **Prose about another machine is the ONLY contrast channel left**, and M12 flags that as
  protected by NO declaration. Worse, M15 step 6 already measured the obvious oracle for it as
  VACUOUS ("out-of-order shows no WAW/WAR stall" is true of every machine — that model emits no
  `stall` of any kind). Three non-vacuous pins are available: the renaming A/B, the corpus-wide
  stall-total table, and INV-8's same-answer-different-schedule.

**Do not answer the missing toggle by inviting a model switch.** Every scoreboard stall reason is
emitted by no other model, so a switch guts the rail, and the picker stays live during a lesson.

## The measurements that decide the track

⚠ **THE RENAMING A/B IS REAL BUT SMALL, AND THE WAR COSTS NOTHING.** Renaming the two false
dependences away (fresh destinations for the younger writers):

| variant               | scoreboard | out-of-order | pipeline |
| --------------------- | ---------- | ------------ | -------- |
| original              | **31**     | 13           | 23       |
| WAR renamed away only | **31**     | 13           | —        |
| WAW renamed away only | **30**     | 13           | —        |
| both renamed away     | **30**     | 13           | 23       |

The two hazards the model exists to show are worth **ONE cycle of 31**, and the WAR — the only one
in the entire corpus — costs **ZERO**: its four-cycle hold sits inside a wait the machine was doing
anyway. `structural-int` climbs **6 → 9** when they are removed, because the machine simply
re-bottlenecks on units. **The hazards buy correctness, not speed** (without the WAR hold `a0`
lands on 26 instead of 24), and a track that sold them as a performance story would be selling a
cycle. The results the reader cares about (`a0` = 24, `a1` = 14) are identical across the edit and
only the scratch registers differ.

⚠ **That makes the A/B a good ORACLE and a BAD INVITATION, and the first draft of the plan
conflated them.** Handing the edit to a reader fails M5's payoff rule: one cycle out of 31, to be
COUNTED across two runs from memory, in a sandbox where the fork has already DETACHED the lesson —
and if they rename only the WAR (the natural single edit) the payoff is **zero**. `function-call`'s
hand-off works because `max` returns your number, visibly, in one register. Keep the oracle; if a
hand-off is wanted, its payoff must be the `war`/`waw` rows VANISHING from the tables.

⚠ **THAT MEASUREMENT WAS A NULL RESULT ON ITS FIRST RUN, AND THE FAILURE MODE GENERALISES.** The
first harness edited the program with `String.replace` over the whole source — and every needle
occurs FIRST inside `register-reuse.s`'s own comment header, which quotes each instruction
verbatim. So it patched prose, left the instructions untouched, and printed 31 = 31 with a
byte-identical stall histogram: **"renaming changes nothing" looked exactly like a finding.** Ask
of any source-editing harness: _could this have matched a comment, and would I know?_ The fix:
skip comment lines, and require each edit to land **exactly once** or throw.

Other measurements, each already in the plan:

- **The reorder is ONE cycle — c17.** `i5` (younger) writes at c17, `i4` (older) at c18. Only 5 of
  13 corpus programs show out-of-order completion at all. This reproduces M15 step 7's number from
  the TRACE side, having been measured there from the VIEW side.
- **`i4` holds INT1 from c8 to c17 — ten cycles for a one-cycle `add`** — because with no
  reservation station it waits for its operand INSIDE the unit. `reservation-station-holds` says in
  as many words that a station lets an instruction "park there … and blocks no one behind it." The
  scoreboard is the exact counter-case, visible in the FU-status table. **This is the earned order
  pin** (a premise that is false, not merely unexplained, if the reader has not met that lesson).
- **The ceiling's demonstration is `sum-loop`** — 80 cycles, **IPC 0.425 with ZERO
  `operand`/`waw`/`war` stalls in the whole run** — which is M15's "say the ceiling out loud"
  requirement in a number. ⚠ **`add.s` is sharper and is the wrong choice**: 3 instructions in
  **9 cycles** with no data hazard at all, but `deep-drain` is _"Three instructions, ten cycles"_ on
  that same program and already asks "where do the extra cycles go?" — the same rhetorical move one
  track later with a SMALLER number, which a reader takes as "the scoreboard beats the deep
  pipeline." `add.s` touches no memory, so the comparison is ALMOST fair, and that is the trap.
- ⚠ **A cross-model cycle comparison measures `MEM_LATENCY`, not the scheduling discipline.** The
  scoreboard is never faster than the 5-stage pipeline on any corpus program (31 vs 23 here), but
  its memory unit is intrinsically 4 cycles against the pipeline's 1. Prose saying "out-of-order
  execution loses here" attributes to scheduling what a latency choice did.
- ⚠ **`waw` `nth: 1` is a DECOY.** The first `waw` stall on `register-reuse` is c5 on the `la`
  expansion's benign pair (its younger writer READS the register, so it can never corrupt); the
  corrupting one is `i8` at c19–c22. Same species as the anchor traps in [[m14-width-lessons-step0]].
- **Corpus-wide stall totals** (the vacuity-guard shape): 0 / 0 / 265 `raw` / 414 `raw` / 265 `raw`
  / 0 / **717** across the seven models. **All four WAR events in the product are on
  `register-reuse`** — the scarcest fact in the milestone, and why no other program can carry the track.

## The seeded shape (all open)

Three lessons — the ceiling, WAW, WAR+reorder — in a NEW track appended last, closing with the
rename edit as a hand-off. Steps 1–3 author them, step 4 pins the track and its order, step 5 is
the browser pass ([[browser-is-the-only-net]]). Five falsifiable UNCHANGED criteria: no schema, no
engine, no corpus, no view, no new `Lesson` field.

## Step 1 SHIPPED — `two-units-one-queue` (`69c99c4` + `daacb1f`, repo 11872 → 11887)

`sum-loop` on the scoreboard, four steps at cycles 0, 3, 8, 71, under a new **"The scoreboard"**
track appended after the out-of-order one. Five gates green.

**The lesson declares NO `config`, and the oracle asserts the omission.** Lawful by
`Lesson.config`'s own docblock ("a config-blind model ignores every knob; a lesson that omits it
has no opinion") — and declaring one would pin knobs this engine provably ignores while silently
moving the reader's session position on every OTHER model the moment the lesson opened. The five
capability flags are pinned beside it, so a model that later gains a knob reddens here.

**Step 2 CONCEDES the thing that would have made it false.** At cycle 3 the loop's `add` lacks a
unit AND its operand (`t0` is not written until 5), and the machine says `structural-int` because
the issue check asks about units first. "It is not waiting for data" would have been false with
every anchor green. The expert tier states both and then proves which BINDS: the `add` issues at 5,
the cycle after a unit frees, and reads `t0` at 6 without waiting.

### ⚠ THE MUTATION CHECK FOUND A FALSE NET IN THIS MILESTONE'S OWN ORACLE

Two stubs, predictions first. **M-1** (every unit shortage reported as `structural-mem`) reddens
the thesis, step 2, and the SWEEP — the sweep because step 2 anchors on `reason: 'structural-int'`
and can no longer find it. **M-2′** (`INT_LATENCY` 1 → 2, a coherent machine rather than a broken
one) reddens 5 of 8. Repo-wide: M-1 6 files / 23 tests, M-2′ 7 files / 64 tests.

**`OCCUPANCY CEILING` stayed GREEN under a change to the very latency its NAME quotes.** It asserted
that a unit's busy span matches its instruction's row — true by CONSTRUCTION of the row, hence true
at any latency — plus `expect(2 / 4).toBe(0.5)`, which is arithmetic and measures nothing at all.
**An assertion necessary but not sufficient, passing on broken code while reading like a guard**:
[[m15-scoreboard-planned]] step 7's species, found here by RUNNING the stub rather than by reading
the test. Fixed to measure the turnaround off the recording, with a non-vacuity floor, and **re-run
against the FIX** — 5 of 8 now, where the original scored 4.

⚠ **A third stub was DISCARDED, and the reason generalises: a mutation that breaks CORRECTNESS
cannot measure a TIMING claim.** Freeing the unit inside Write-Result instead of at the clock edge
lets a newly issued instruction be deleted by the edge that follows, so the machine deadlocks. It
reddened ten files and proved only that the tests run the engine — and its red is LOUDER than a
good stub's, which is exactly what makes it tempting to report as coverage.

## Step 2 — `one-name-two-writers`, the WAW lesson (DONE 2026-08-18, `7c7f6f8`, 11887 → 11904)

`register-reuse`, five steps at c0, c5, c19, c22, c26. Nine named oracle claims, three stubs.

**The subject is a CONTRAST the event stream cannot show.** The run holds five `waw` stall cycles
and they are two different things — one benign (`la t0, first`'s expansion holding itself up, whose
younger writer READS `t0`) and four corrupting (`addi t1, x0, 7` held at Issue by an older `lw t1`).
Same type, same reason, same stage. **The difference is a property of the DECODED instructions**, so
it needed an oracle of its own and no amount of anchor-checking could have reached it.

### ⚠ Three sentences that were FALSE, and the shape they share

**1. "Every other `waw` in the corpus is a `la` address expansion" — FALSE, and
`content/programs/register-reuse.s`'s own header carried the same claim** (fixed at this step).
`array-sum` stalls on an accumulator (`add a0, a0, t2`); `nested-loop` on a counter. Three shapes,
not one — and `packages/engine/scoreboard/src/timing.test.ts` already knew about the third, so the
header contradicted a sibling file from its own milestone. **A claim about SHAPE is a claim about
spelling and will rot. Find the property the shapes SHARE and assert that**: here the self-read,
which is what actually decides corruption. The replacement is stronger and countable — **35 of the
39 `waw` cycles in the whole library are a writer reading the name it overwrites, and the 4 in this
lesson are the only ones that are not.**

**2. "Blocking every younger instruction behind it" (the plan's own seeded framing) — false on
screen.** Fetch is a ONE-DEEP slot, so nothing is behind the held instruction at all. What is
visible is that **nothing is fetched for four cycles**. Narrate the picture, not the queue you
imagined.

**3. TWO positional claims were wrong — "the `la t0, first` on line 3" (it is the second
instruction) and "the `lw t1, 4(t0)` four instructions back" (it is two back, and two source lines
back, so no counting convention rescues it).** The second was in the `detailed` tier, the one the
reader actually sees, and it survived a green suite AND a three-stub mutation table. **Counting and
position claims about a program listing are unguarded BY CONSTRUCTION**: an anchor pins a
transaction, a stub perturbs a machine, and neither has any opinion about where a line sits. Read
every one against the listing by hand before shipping — that is the only net there is.

### The mutation check — three stubs, each with a DECLARED purpose

**Stating the purpose is the method, not a formality**, because step 1 established that a
correctness-breaking stub cannot measure a timing claim. **M-1** (WAW check deleted) breaks
correctness by design and is reported ONLY for the correctness claim it can measure: `t1` ends on
**9** as step 5 promises, `t0` still lands the right address as step 2's counterfactual promises
(the operand check holds a self-reading writer regardless), `a0`/`a1` untouched. **M-2** (check
ORDER swapped, destination before units) is the coherent discriminator for the thesis. **M-3**
(`MEM_LATENCY` 4 → 2) measures the four-cycle window. Repo-wide: 7/33, 5/19, 7/46 files/tests.
Ten of eleven cells per column landed as predicted.

⚠ **The M-2 sweep cell is the headline: GREEN, while every sentence in the lesson is false.** With
the reasons relabelled, both `waw` anchors still fire on distinct cycles and the validator is
happy — while the lesson now points the reader at the benign expansion and calls it the one that
would have corrupted `t1`. **A green sweep proves the steps fire; it has never been able to prove
the prose is true.** That gap is now exhibited rather than argued.

⚠ **One misprediction, and its reason is worth keeping: `STEP 4` reddened under M-2 through the
SPLIT's PREMISE, not its own subject** — the oracle identifies the held instruction as the SECOND
`waw` stall, and under the stub that is a different instruction. The timing it asserts never moved.
The ordinal handle is kept deliberately, because the lesson's anchor is `nth: 2`: if the second
`waw` stall is a different instruction, the lesson is false whatever the cycles do.

⚠ **A green cell is not always coverage.** `two-units-one-queue`'s whole oracle stays green under
M-3, correctly — `sum-loop` touches no memory. Say so, rather than counting it.

### Two order-dependent sentences step 4 must pin

Both satisfy M14's discriminator — reorder the track and they go FALSE, not merely unexplained.
`one-name-two-writers`'s closing expert tier says "the ceiling **the previous lesson** measured";
`two-units-one-queue`'s closing says "when you meet this machine's held writes in **the next two
lessons**". A count and a direction, one in each lesson. Listed now so a reorder does not discover
them.

## Step 3 — `finished-and-told-to-wait`, the WAR lesson (DONE 2026-08-18, 11904 → 11920)

`register-reuse`, five steps at c0, c13, c16, c17, c18. Eight oracle claims, three stubs. The
track is now COMPLETE as content; step 4 pins its order and step 5 is the browser pass.

**Two oracle claims are counts over the WHOLE PRODUCT, not over the recording**, because the prose
is. `war` fires **4 times in the entire library** (13 programs × 7 models) and all four are one
instruction here. And the `(reason, stage)` product over the same 91 recordings is
`control@ID`, `operand@RO`, `raw@ID`, `structural-int@ID`, `structural-mem@ID`, `waw@ID`,
**`war@WB`** — so "the only stall the simulator reports at the END of an instruction's life" is
measured, not asserted. Config-independent backing: there are exactly SIX `type: 'stall'` emission
sites in the product and exactly one names a stage other than `ID`/`RO`.

### ⚠ FIVE sentences were false before any stub ran

**1. "In between them sits `addi t2, x0, 5`" INVERTED THE HAZARD.** The young writer comes AFTER
the older reader — that is the whole hazard — and "in between" describes a read-after-write. It
would have made the lesson a picture of the wrong dependence, with every anchor green. This is
step 2's finding-3 net (read every position claim against the listing BY HAND) catching one on the
first draft, which is the strongest evidence yet that the net is not optional.

**2. ⚠ THE THREE STATUS TABLES DO NOT SPELL REGISTERS THE SAME WAY.** `formatInstruction` and
`regCell` both print `x7`; only the register-result table uses `ABI_REGISTER_NAMES` and says `t2`.
So "INT1's row shows `Fk` as `t2`" is FALSE on screen, and "find `addi t2, x0, 5` in the
instruction status table" points at a row reading `addi x7, x0, 5`. **A real product wart, REPORTED
and not absorbed** (UNCHANGED criterion 4 forbids the view change) — and note the shape:
`one-name-two-writers`'s prose is correct only because it happened to quote the one table that uses
names. Any lesson naming a register and a table must check which of the two vocabularies that table
speaks.

**3. The caption CONTRADICTS the prose at the release cycle.** The fourth `war` stall still fires
at c16, so the caption says "an older instruction has not yet READ" — while `micro`, snapshotted
after the clock edge, already shows Read Operands 16 and both `R` flags cleared. Both true, one
cycle apart ([[m15-scoreboard-planned]] step 7). The draft said the hold was over. The shipped step
concedes both halves and names the offset — `two-units-one-queue` step 2's concession move on a new
axis (there: which of two constraints binds; here: which of two SURFACES is a cycle ahead).

**4. "18 above 17" is UNREACHABLE off `micro`.** At c18 `micro` no longer rows the younger
instruction at all (it retired at c17), so the out-of-order write-result column is a property of
`buildScoreboardTables`'s ACCUMULATION. A test written off `micro` would have been vacuous or
impossible. **Assert a claim about the PICTURE through the fold that draws it.**

**5. "would flash for one cycle ON ONE PROGRAM" — A CORPUS CLAIM COMPOSED OUT OF A PROGRAM
CLAIM.** `scoreboard-tables.ts`'s docblock says out-of-order completion is "zero on seven of the
thirteen and one on `register-reuse.s`" — which leaves FIVE nonzero programs it never enumerates.
The dump lists six, 43 cycles in all. The draft read the SEVEN and the ONE and made "one program"
out of them. **Two true numbers in one sentence do not license a third.** Scoped to this program in
the shipped tier. Found only on the closing review pass, after the mutation table was done.

### Three corrections the mutation check could not have produced

⚠ **An occupancy assertion that was NECESSARY BUT NOT SUFFICIENT** — step 1's `OCCUPANCY CEILING`
species recurring inside this milestone's own new oracle, on the SAME organ (unit occupancy). It
filtered on `u.busy` alone, proving "INT1 was busy ten cycles" under a message reading "INT1 HOLDS
THE ADD ten cycles"; two occupants in succession satisfy the weaker form while the sentence goes
false. Now keyed on the occupant. **It was never independently exercised by any stub** — the test
reddened earlier in its own body every time — which is exactly how this species survives.

⚠ **A closing sentence that was QUOTED BUT NOT PINNED**: "both hazards together are worth one
cycle" is NOT derivable from the two single-hazard runs (31 and 30 say nothing about whether the
savings compose). The both-renamed variant is now recorded beside them.

⚠ **`register-reuse.s`'s header still said "the `la` on line 3"** — the surviving twin of the
positional claim step 2 fixed in the LESSON, in the file both hazard lessons are built on. Fixing a
false sentence in one place is not fixing the class.

### The mutation check — and the sweep finding is step 2's headline RUN BACKWARDS

Three stubs, purposes declared. **M-1** (`warBlocked` returns false) breaks correctness and is
reported only for the correctness claim it can measure: **`a0` ends on 26**, exactly as step 5
promises. **M-2** (release the hold when the older reader is DONE rather than when it has READ) is
the coherent discriminator for step 3's thesis — the young write moves c17 → c19, `war` 4 → 6, and
**the out-of-order inversion vanishes entirely**, while `a0` stays 24. **M-3** (`MEM_LATENCY`
4 → 2) measures the window: `war` 4 → 2, anchors collapse to 0/13/14/15/16.

A FOURTH stub, **M-4**, was added after the table was read, because reading it showed `THE THESIS`
had no stub on its own subject: emit the WAR stall with `stage: 'ID'` instead of `'WB'` — same
machine, same schedule, different report. It reddens **exactly two cells**, and they are the two
that make a claim about the reported stage. **That narrowness is the shape to want**: a wide red
field proves the tests run the engine (step 1's discarded deadlock stub); a narrow one proves a
sentence. **Adding a stub because a finished table exposed a gap is the check working.**

Repo-wide: M-1 9 files / 29 tests, M-2 7 / 31, M-3 7 / 52, **M-4 7 / 10**. Nine of ten cells per
column as predicted (M-1 10/10); M-4 has no prediction row by construction.

⚠ **THE SWEEP CAUGHT M-2 — BY ACCIDENT OF ORDER, AND THAT IS THE FINDING.** Step 2 exhibited a
green validator over a lesson whose every sentence was false. Here the validator reddens — because
holding two cycles longer pushes step 4's anchor (c19) PAST step 5's (c18), tripping the
anchor-ORDER half. It has no more opinion about the prose than before. **A green sweep proves
nothing about meaning, and a red one is not evidence it can read.** Note which half fires: under
M-1 `anchor in order` stayed GREEN (it skips null anchors) and the sweep failed through `every step
fires`; under M-2 the reverse. Two halves, two different accidents, neither about truth.

⚠ **`THE THESIS` under M-1 reddens through its PREMISE** — with no `war` events the product simply
loses a key, which says nothing about whether `war` is the only late stall. Marked, not counted.

⚠ **A recorded QUESTION beats a guessed cell.** The predictions asked whether the inversion belongs
to the two instructions' relative timing or to the memory latency, instead of forecasting. Answer:
the SHAPE survives under M-3 (still exactly one inversion) and the CYCLE moves 17 → 15. A test
asserting only "exactly one inversion" would have stayed green under a stub that moved every cycle
number the narration prints.

### The payoff the track closes on, measured

Renaming the WAR away leaves the run at **31 cycles — unchanged** (33 stall cycles become 30). The
reason none of it becomes speed is one instruction downstream: the next integer operation takes its
unit at 17 instead of 18 and then waits for a load until 23 EITHER WAY. **The head start is
absorbed by something the rename never touched.** A second counterfactual ships beside it and is a
different claim: moving the young write above the reader makes `a0` come out **26 on all seven
models**, a fact about the PROGRAM. ⚠ **A line SWAP needs its own guard — step 2's replace-once
harness does not transfer**, because both needles appear verbatim in the header and a swap of the
wrong pair still assembles. The oracle requires exactly one code line each and asserts adjacency.

### Three order-dependent sentences step 4 must pin

Each goes FALSE on a reorder, not merely unexplained. Step 1 `detailed`: "You met `register-reuse`
in the last lesson, where a young write was stopped before it could start." Step 2 `detailed`: the
`reservation-station-holds` callback — decision 4's EARNED pin, and **deliberately at `detailed`,
because `resolveNarration` falls back DOWNWARD and a pin asserting at that tier cannot see an
expert-only sentence.** Step 5 `expert`: "the dominant cost here is structural … which is what the
first lesson measured."

## Step 4 — the track's order pins (DONE 2026-08-18, `8f10fe1`, 11920 → 11922)

Three new tests in `lessons.test.ts` (3669 → 3672), two membership sets added to existing ones,
**no prose touched**. Five gates green. Full write-up: the plan's "Step 4 as built".

⚠ **TWO of this step's own conclusions were wrong when first written**, and both survived a green
suite AND a seven-run perturbation harness. They are corrected in place below rather than rewritten
away, because the way they were found is the transferable part: **reading the sentence against the
perturbation, instead of reading the failure output.**

**Three of the four artefacts the plan's build-order line named were ALREADY correct** — steps 1–3
each carried their own `index.json` entry, the exhaustive track-NAME `toEqual` (in BOTH places that
list the seven names) and the `LESSONS.length` 29 as they shipped. Only the per-model membership set
was missing. Recorded explicitly, because **silence cannot distinguish "done" from "forgot"**.

**SEVEN mentions found, five pinned across three tests, two rejected.** With no flip to ask for,
each lesson leans on its neighbours for the contrast a config knob supplies elsewhere, which is why
this track has so many. #1 `finished-and-told-to-wait` step 5 expert "what the first lesson
measured" (POSITION: index 0); #2 `one-name-two-writers` step 5 expert "the ceiling the previous
lesson measured" (ADJACENCY); #3 `finished-and-told-to-wait` step 1 detailed "You met
`register-reuse` in the last lesson" (ADJACENCY); #4 `two-units-one-queue` step 4 detailed "in the
next two lessons" (**guarded by #2 and #3 — see the correction below**); #5 `finished-and-told-to-
wait` step 2 detailed, the "The reservation station holds" comparison (CROSS-TRACK, OoO before
scoreboard, asserted at `detailed` because `resolveNarration` falls back DOWNWARD); #6 and #7
`two-units-one-queue` step 1 detailed "This is `sum-loop` again" and step 4 expert "the single-cycle
machine this loop was first shown on" (CROSS-TRACK, the language track first — and #7 also pins
WHICH MACHINE, since three intervening lessons run `sum-loop` and none is single-cycle).

REJECTED: the essentials-tier "The same program again" (a restatement #3 already implies) and
"Compare the other hazard, whose rename is worth a single cycle" (a fact about the machine, equally
true unread).

### The findings worth carrying past this step

- ⚠ **ADJACENCY, not precedence, for three of the five — and the reason is a shared PROGRAM.**
  `register-reuse` is the program of BOTH the second and third lessons, so "You met `register-reuse`
  in the last lesson" survives every reorder EXCEPT the one that slides the first lesson between
  them. A `toBeLessThan` cannot see that move. **Before writing an order pin, ask what ELSE could
  occupy the slot the sentence names** — when two lessons share a program, a title, or a hazard, the
  weaker comparison is green over the one reorder that matters.
- ⚠ **The nearest precedent's guard can be the INVERSE of the claim.** The OoO track's order pin
  guards its `indexOf` with `toBeGreaterThan(0)` — which asserts "not first". Pin #1 asserts "IS
  first". Copying the guard because it is the neighbouring shape would have inverted the claim while
  looking careful. (`toBe(0)` needs no guard: a renamed id gives −1, which is not 0.)
- ⚠ **THE COUNT "PIN" FIRED WHEN NOTHING LIED, and that correction is the step's sharpest finding.**
  It asserted "exactly two lessons follow the first" beside the sentence "when you meet this
  machine's held writes in the next two lessons". Append a fourth lesson AFTER the third and **the
  sentence stays true** while the assertion reddens — a pin firing when no prose lies, which inverts
  the rule the step is built on. What falsifies the sentence is a lesson INSERTED between the three,
  and the two adjacency pins already catch that. Relabelled as a CANARY (the `depthDefault` framing
  in the same file), carrying the message a reader should act on. **The transferable trap: an
  assertion can be arithmetically independent of every other one in the test and still not be the
  guard of the sentence it is filed under. Independence is not need.** Only reading the prose
  against the perturbation separates them — a green suite cannot, and neither can a red one.
- ⚠ **A pin can be un-isolatable at the CURRENT size of the thing it guards and still be the only
  pin that catches the defect once it grows** — but check WHICH of your pins that is. In a
  THREE-lesson track the intra-track pins are not independent (any three imply the fourth), so no
  reorder can isolate #3 while #1 and #2 stay green; P5 lengthens the track and shows it fires. That
  is the legitimate instance. The count pin looked like the same argument and was not.
- ⚠ **A mention enumeration built from a KEYWORD REGEX is not exhaustive, however careful the
  keyword list.** "last lesson | previous lesson | first lesson | …" cannot see a reference that
  names no lesson, and this track had two: "This is `sum-loop` again" and "the single-cycle machine
  this loop was FIRST shown on". Re-run for **the lesson TITLES, the model names, and history verbs**
  (`met|saw|shown|showed|watched|remember|already|earlier`) — that sweep also found the two
  rejections the first had missed. **A completeness claim ("they name each other five times") is
  only as strong as the sweep that produced it, and a regex over stock phrases is the weakest one.**
- ⚠ **#7 pins a MACHINE, not only an order.** "The machine this loop was first shown on" is
  single-cycle; three lessons between the two also run `sum-loop` and none of them is. Promote any
  of those past `sum-loop-tour` and the sentence names the wrong machine **while every ordering
  comparison stays true** — which is exactly what P7 measured.
- ⚠ **Vitest stops a test at its FIRST failed assertion**, so a perturbation falsifying two mentions
  in one test reports only the earlier one. A per-run red set is "which fires first", not "which are
  false" — counting coverage from failure output alone silently overstates it.
- **The reverse grep is one command and belongs in every track's order step.** Steps 1–3 each
  checked their own lesson's OUTBOUND references; `grep -l` over all 29 lesson JSONs for the track's
  ids and titles rules out the inbound direction. (Clean here — nothing forward-references M16.)

### The harness (P1–P5, predictions written first)

`M:\claud_projects\temp\m16-step4\` — `predictions.md` (with the post-advisor addendum),
`perturb.py`, `P*.log`. Each perturbation applied ALONE to `index.json` against a committed tree and
reverted with `git checkout --`, `git status --porcelain` checked after each. P3 (whole track moved
above the OoO one) reddened the cross-track pin ALONE of the new tests, proving #5 distinct. P5 (a
fourth id inserted mid-track) exists only because #3 cannot be isolated at length three.

**P7 (the deeper-machine track promoted to FIRST) is the load-bearing run** — it reddens on a claim
no ordering comparison can express: `sum-loop-tour` still precedes the lesson that quotes it, every
order assertion is still true, and the sentence is false anyway. **P4 was written up as
load-bearing and it is not** (see the count correction above).

⚠ **P6 and P7 each reddened TWO tests that were not predicted.** Moving a track to an EXTREME
position trips rules keyed to the library's ENDS rather than to relative order (`LESSONS[0]` in
both, machine-before-deeper-machine in P7). Not defects — but **a predicted red set for an
extreme-position move must include the position-sensitive rules that already exist**, or the
prediction misses on collateral every time and the misses train you to ignore them.

⚠ **Vitest stops a test at its FIRST failed assertion**, so a per-run red set is "which fires
first", not "which are false" — P1's #3 is genuinely false and invisible in the output.
