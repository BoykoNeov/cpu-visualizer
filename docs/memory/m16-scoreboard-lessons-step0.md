---
name: m16-scoreboard-lessons-step0
description: "M16 (the scoreboard's LESSON track — the seventh model's, and the last one missing). Step 0 DONE 2026-08-18: the dump is run and the plan written (`docs/plans/m16-tasks.md`), eight decisions seeded and ALL OPEN. THE HEADLINE CONSTRAINT: this model honors NO config knob, so `buildPositions` returns exactly ONE position and there is NO FLIP TO ASK FOR — which makes the sweep a STRONGER net (every step must fire, no at-least-one escape hatch), RETIRES the M11+M12 finding-2 class entirely (a config-exclusive step cannot exist here, so 'ask for the flip one step earlier' is a checklist item that can never fail), and leaves prose about another machine as the ONLY contrast channel. The renaming A/B is REAL but SMALL: renaming both false dependences away moves the scoreboard 31 -> 30 cycles and the WAR ALONE COSTS ZERO (31 -> 31), while `structural-int` climbs 6 -> 9 as the machine re-bottlenecks on units — the hazards buy CORRECTNESS, not speed. That measurement was a NULL RESULT on its first run because `String.replace` over the whole source hit the program's own comment header (which quotes every instruction verbatim), so the harness patched prose and printed 31 = 31: 'renaming changes nothing' looked exactly like a finding. Also measured: the reorder is ONE cycle (c17), reproducing M15 step 7's view-side number from the trace side; `i4` holds an integer unit for TEN cycles to run a one-cycle add (the earned callback to `reservation-station-holds`); `add.s` takes 9 cycles for 3 instructions with no hazard at all and `sum-loop` runs at IPC 0.425 with ZERO data-hazard stalls; a cross-model cycle comparison measures MEM_LATENCY (4 here vs the pipeline's 1), NOT the scheduling discipline; and `waw` nth=1 is a DECOY that lands on the benign `la` pair rather than the corrupting one."
metadata:
  node_type: memory
  type: project
  originSessionId: dda99047-c5bc-452f-b80b-bd2d4f389e81
  modified: 2026-08-18T09:37:22.503Z
---

**Plan: `docs/plans/m16-tasks.md`. Status 2026-08-18: steps 0 and 1 DONE; decisions 1–4 PINNED by
the user (three lessons; `sum-loop` for the ceiling; a NEW track, appended last), 5–8 open.**
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
