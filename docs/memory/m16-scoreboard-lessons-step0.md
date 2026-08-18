---
name: m16-scoreboard-lessons-step0
description: "M16 (the scoreboard's LESSON track — the seventh model's, and the last one missing). Step 0 DONE 2026-08-18: the dump is run and the plan written (`docs/plans/m16-tasks.md`), eight decisions seeded and ALL OPEN. THE HEADLINE CONSTRAINT: this model honors NO config knob, so `buildPositions` returns exactly ONE position and there is NO FLIP TO ASK FOR — which makes the sweep a STRONGER net (every step must fire, no at-least-one escape hatch), RETIRES the M11+M12 finding-2 class entirely (a config-exclusive step cannot exist here, so 'ask for the flip one step earlier' is a checklist item that can never fail), and leaves prose about another machine as the ONLY contrast channel. The renaming A/B is REAL but SMALL: renaming both false dependences away moves the scoreboard 31 -> 30 cycles and the WAR ALONE COSTS ZERO (31 -> 31), while `structural-int` climbs 6 -> 9 as the machine re-bottlenecks on units — the hazards buy CORRECTNESS, not speed. That measurement was a NULL RESULT on its first run because `String.replace` over the whole source hit the program's own comment header (which quotes every instruction verbatim), so the harness patched prose and printed 31 = 31: 'renaming changes nothing' looked exactly like a finding. Also measured: the reorder is ONE cycle (c17), reproducing M15 step 7's view-side number from the trace side; `i4` holds an integer unit for TEN cycles to run a one-cycle add (the earned callback to `reservation-station-holds`); `add.s` takes 9 cycles for 3 instructions with no hazard at all and `sum-loop` runs at IPC 0.425 with ZERO data-hazard stalls; a cross-model cycle comparison measures MEM_LATENCY (4 here vs the pipeline's 1), NOT the scheduling discipline; and `waw` nth=1 is a DECOY that lands on the benign `la` pair rather than the corrupting one."
metadata:
  node_type: memory
  type: project
  originSessionId: dda99047-c5bc-452f-b80b-bd2d4f389e81
  modified: 2026-08-18T09:37:22.503Z
---

**Plan: `docs/plans/m16-tasks.md`. Status 2026-08-18: step 0 DONE, all eight decisions OPEN.**
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
only the scratch registers differ — which is what makes it safe to hand to a reader as a
`function-call`-shaped hand-off.

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
- **The ceiling has a three-instruction demonstration**: `add.s` runs 3 instructions in **9 cycles**
  with NO data hazard — the third stalls `structural-int` because both integer units are still
  occupied. Loop-scale version: `sum-loop`, 80 cycles, **IPC 0.425 with ZERO `operand`/`waw`/`war`
  stalls in the whole run.** M15's "say the ceiling out loud" requirement, in a number.
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
