# Milestone 16 — The scoreboard lesson track

**Status: steps 0–2 DONE 2026-08-18.** The dump is run and it decided the design; decisions
1–4 are pinned by the user; two of the three lessons ship. **Next: step 3, the WAR lesson and
the reorder at c17** — decision 5 (oracle yes, invitation no) governs its closing beat, and c17
is reserved for it by finding 2.

Source of truth for scope: `cpu-visualizer-spec.md` §13 (the curriculum system). The load-bearing
invariants are INV-6 (lessons anchor to trace EVENTS, never cycle numbers), INV-2 (depth is a
property of the view) and INV-5 (lawful simplification). The track's ground truth is
`docs/plans/m15-tasks.md` (the machine, steps 0–8) and `content/programs/register-reuse.s`, the
corpus program M15 step 6 added for exactly this subject.

## Why this milestone, and why now

Seven models are selectable and six have a lesson track. The scoreboard — M15's seventh, the CDC
6600 — is the only one a learner can select and be handed nothing to do with. M15 deferred the
track by name in its own decision 10 ("this model alone; lesson track is a separate milestone
(M16)"), which is the M9→M10 / M11→M12 / M13→M14 shape run a fourth time.

It also inherits an obligation stated in M15 step 3's own words: **the 0.5-IPC turnaround ceiling
dwarfs both hazards this model exists to show, and "step 7's view and M16's lesson must say it out
loud" or the wall of `structural-int` reads as a verdict on the student's program.** That sentence
is a milestone requirement, not a nicety, and it is why the ceiling is seeded as lesson 1 rather
than as an aside inside a hazard lesson.

## ⚠ THE HEADLINE CONSTRAINT — this model honors NO knob, so there is no flip to ask for

`SCOREBOARD_CAPABILITIES` is `configurableForwarding: false`, `configurableBranchPrediction: false`,
`configurableCache: false`, `configurableIssueWidth: false`, `configurableOutOfOrder: false`
(`packages/engine/scoreboard/src/processor.ts`, pinned by `processor.test.ts:100`). Every prior
microarchitecture track was built around a toggle — M3/M4 forwarding and prediction, M12's
backwards-running forwarding flip, M14's width ask. **M16 has none of that**, and three consequences
follow, all of them structural rather than stylistic:

- **`buildPositions` returns exactly one position, labelled `neutral config`**
  (`packages/web/src/lessons.test.ts:267` — "a model honoring nothing never entered the loop and
  keeps the seed's empty label"). Verified against the two other knob-less models, which the suite
  already asserts by name at `:500-501`.
- **The sweep is therefore a STRONGER net here than anywhere else.** Its rule is "every step fires
  in AT LEAST ONE position"; with one position that is exactly "every step fires." **A
  config-exclusive step cannot exist on this model**, so the M11+M12 review's finding 2 — a step
  silently skipped because the learner is parked at another position, which `deep-bet-pays-double`
  shipped broken — **cannot occur in this track**. The "ask for the flip one step earlier"
  authoring rule has no referent here and must NOT be carried into the acceptance list; carrying it
  would be a checklist item that can never fail.
- **The only contrast channel left is prose about another machine**, which M12 flags as protected by
  NO declaration — a lesson declares one `model`, so a number quoted about a different one is
  unguarded by construction. Every such sentence needs its own oracle line. See "The cross-model
  problem" below, which is the one genuinely new design question in this milestone.

**Do not answer the missing toggle by inviting a model switch.** Every scoreboard stall reason is
emitted by no other model (measured below), so switching guts the rail — and `session.ts` keeps the
picker live during a lesson, so the reader can reach that state. The other machine is prose.

## The dump (the design's factual ground) — RUN 2026-08-18

`M:\claud_projects\temp\m16-step0\` — `probe.config.ts`, `dump.probe.test.ts` (whole corpus ×
7 models; `register-reuse` cycle by cycle with all three status tables; the stall roll keyed by
`(cycle, instr, reason, stage, pc)`; a full anchor table with each event's `nth` and cycle; the
out-of-order-completion scan; corpus-wide stall totals per model; the issue-order A/B) and
`dump2.probe.test.ts` (the renaming A/B, unit occupancy and turnaround, `sum-loop` and `add.s` cycle
by cycle). Outputs `dump.txt` (639 lines), `dump2.txt`, and the same as JSON.

⚠ **The junction rule from M15 applies verbatim**: a config outside the repo cannot resolve `vitest`
without `node_modules` linked beside it, the link is created with `mklink /J` and removed with
`cmd /c rmdir` **after every run** — a recursive delete on PowerShell 5.1 traverses a junction and
deletes straight through into the repo's real `node_modules`.

### What it establishes

`register-reuse` on the scoreboard: **31 cycles, 11 retires, IPC 0.355, 33 stalls** —
`operand` 13, `structural-int` 6, `structural-mem` 5, `waw` 5, `war` 4.

Corpus-wide stall totals per model, which is the vacuity-guard shape M15 step 6 established (silence
must be visible as silence):

| model          | total   | reasons                                                                                       |
| -------------- | ------- | --------------------------------------------------------------------------------------------- |
| single-cycle   | 0       | —                                                                                             |
| multi-cycle    | 0       | —                                                                                             |
| pipeline       | 265     | `raw` 265                                                                                     |
| deep-pipeline  | 414     | `raw` 414                                                                                     |
| superscalar    | 265     | `raw` 265                                                                                     |
| out-of-order   | 0       | —                                                                                             |
| **scoreboard** | **717** | `structural-int` 346, `operand` 209, `control` 98, `waw` 39, `structural-mem` 21, **`war` 4** |

**All four WAR events in the entire product are on `register-reuse`.** That is the milestone's
scarcest fact and the reason the track cannot be authored on any other program.

### The six findings that decide the track

**1. The renaming A/B is REAL, and its answer is small and honest.** Take `register-reuse` and
rename the two false dependences away — give the younger writers fresh destinations, which is what
a renaming machine does in hardware and what a compiler does in software:

| variant               | scoreboard | out-of-order | pipeline |
| --------------------- | ---------- | ------------ | -------- |
| original              | **31**     | 13           | 23       |
| WAR renamed away only | **31**     | 13           | —        |
| WAW renamed away only | **30**     | 13           | —        |
| both renamed away     | **30**     | 13           | 23       |

So: **the two hazards this whole model exists to show are worth ONE cycle out of thirty-one**, and
**the WAR — the rarer one, the only one in the corpus — costs exactly ZERO.** Its four-cycle hold
sits inside a wait the machine was doing anyway. Meanwhile `structural-int` goes **6 → 9** when the
hazards are removed: take the false dependences away and the machine simply re-bottlenecks on units.

That is not a disappointing result, it is the lesson. **The WAR hold buys no speed and all of the
correctness** — without it `a0` lands on 26 instead of 24 (`register-reuse.s`'s own header). A track
that sold these hazards as a performance story would be selling a cycle.

The architectural results the reader cares about are **identical across the edit** — `a0` = 24 and
`a1` = 14 in both — and only the scratch registers differ (`t1`/`t2` keep their old values while
`t4`/`t5` hold the new). That is what makes the edit safe to hand to a reader.

⚠ **This measurement was a NULL RESULT on its first run, and the failure mode generalises.** The
first draft edited the program with `String.replace` over the whole source — and every needle
occurs FIRST inside `register-reuse.s`'s own comment header, which quotes each instruction verbatim.
So it patched prose, left the instructions untouched, and printed 31 = 31 with a byte-identical
stall histogram: **"renaming changes nothing" looked exactly like a finding.** The fix is in
`dump2.probe.test.ts`: skip comment lines, and require each edit to land **exactly once** or throw.
Ask of any source-editing harness: _could this have matched a comment, and would I know?_

**2. The reorder is ONE cycle, and it is cycle 17.** `i5` (the younger WAR `addi`) writes its result
at c17; `i4` (the older `add a0`) at c18. Across the corpus only 5 of 13 programs show out-of-order
completion at all, and on `register-reuse` it is a single cycle — which independently reproduces
M15 step 7's measurement from the view side, arrived at here from the trace side. **Any step about
"finished out of order" must anchor so the cursor lands on c17**, and no second step may share it.

**3. The unit is HELD, and that is an earned callback to `reservation-station-holds`.** Unit
occupancy on `register-reuse`: INT0 busy 23 of 31 cycles (74%), INT1 19 (61%), MEM 14 (45%). The
sharpest cell is `i4`, a one-cycle `add`, which **occupies INT1 from c8 to c17 — ten cycles** —
because with no reservation station it waits for its operand _inside the unit_. The out-of-order
track's `reservation-station-holds` says in as many words that a station lets an instruction "park
there with its ready operands captured and **blocks no one behind it**", and that a slow op "frees
the issue port the cycle it issues." **The scoreboard is the exact counter-case, and the FU-status
table shows it directly.** This is the strongest candidate for an earned order pin — see decisions.

**4. The structural ceiling has a three-instruction demonstration.** `add.s` on the scoreboard: three
instructions, **9 cycles**, and the third stalls `structural-int` at c3 and c4 **with no data hazard
involved at all** — both integer units are simply still occupied by the two one-cycle `addi`s, each
of which holds its unit from issue to write-result. Integer issue-to-issue gaps on INT0 across
`register-reuse` are 5, 4, 8, 8 — **minimum 4**, which is M15's "an integer unit turns around in 4
cycles" measured from the other side.

The loop-scale version is `sum-loop`: **80 cycles, 34 retires, IPC 0.425, and ZERO `operand`, `waw`
or `war` stalls in the entire run** — 23 `structural-int` and 10 `control`. A program where nothing
whatsoever waits on data still runs at 0.425. That is the sentence M15 requires, in a number.

**5. The cross-model cycle count is CONFOUNDED and must never be narrated as a race.** The
scoreboard is never faster than the plain 5-stage pipeline on any corpus program (31 vs 23 here, 89
vs 72 on `array-sum`, equal only on `add`). But `MEM_LATENCY` is 4 on this model against the
pipeline's single-cycle memory, so a cycle-count comparison measures **the latency choice, not the
scheduling discipline**. Any prose that says "out-of-order execution loses to in-order here" is
attributing to scheduling what an intrinsic latency did. The honest cross-model claim is about
**which stalls exist**, and the table above is the evidence for it.

**6. `waw` `nth: 1` is a DECOY — it lands on the benign one.** The first `waw` stall on
`register-reuse` is c5, instruction `i2`: the `la t0, first` expansion's `addi t0, t0` behind its
`lui t0`. Its younger writer READS `t0`, so it waits on the producer regardless and **can never
corrupt architecture** — the program's own header says so. The corrupting WAW is `i8` at c19–c22.
An anchor of `{event: 'stall', where: {reason: 'waw'}, nth: 1}` therefore teaches the wrong one.
This is a trap and a gift: the benign/corrupting pair is on one screen and is worth a step.

## The cross-model problem, and what pins each sentence

This is the one genuinely new design question, and M15 already burned the obvious answer. Its step 6
found that **"the same program on out-of-order shows no WAW or WAR stall" is VACUOUS** — that model
emits no `stall` event of any kind, on any program, so the sentence is equally true of a machine
with renaming and one without. Three non-vacuous pins are available and each is measured above:

- **The renaming A/B** — 31 → 30 on the scoreboard, 13 → 13 on out-of-order, driven through
  `loadSource`, which is the same path `loadEdited` takes on the sandbox fork. This is
  `function-call`'s hand-off ORACLE — the only pin that positively demonstrates _renaming_ rather
  than merely _absence_. ⚠ **It is an oracle, not an invitation.** Handing the same edit to the
  reader fails the M5 payoff rule: one cycle of 31 to count from memory, and zero if they rename
  only the WAR. See decision 5.
- **The corpus-wide stall-total table** — every model's total published so silence reads as silence,
  M15 step 6's own shape, plus the named exception that `war` occurs 4 times in the product and all
  4 are here.
- **Same answer, different schedule** — INV-8 in the reader's hands: all seven models finish
  `register-reuse` with byte-identical architectural registers (`a0` = 24, `a1` = 14, `t1` = 7,
  `t2` = 5) over 11, 43, 23, 29, 23, 13 and 31 cycles.

**A cross-model number that none of these three can pin does not go in the narration.**

## Falsifiable UNCHANGED criteria (state before building; check at the end)

1. **No trace-schema change.** Everything the track needs is already recorded — `stall.reason`
   carries all six reasons, and the three status tables are already in `micro`.
2. **No engine change.** Not one line under `packages/engine/`.
3. **No new corpus program.** `register-reuse.s`, `add.s` and `sum-loop.s` are all in the corpus,
   and M15 step 6 added the first one for this purpose. (INV-7: a new program is a new row in every
   model's pinned timing table.)
4. **No view change.** The three status tables shipped at M15 step 7 and were browser-verified at
   step 8. If a lesson seems to need a view change, that is a finding to surface, not to absorb.
5. **No new `Lesson` field.** M12's rule: dropping an un-anchorable beat is a success; inventing a
   mechanism for it is the only failure.

## Build order (each step testable before the next)

- **Step 0 — the dump. ✅ DONE 2026-08-18.** Findings above.
- **Step 1 — the ceiling lesson. ✅ DONE 2026-08-18** (`69c99c4`, `daacb1f`; repo 11872 → 11887).
  `two-units-one-queue` on `sum-loop`, four steps at cycles 0, 3, 8 and 71, under a new
  **"The scoreboard"** track appended last. Eight named oracle claims, two mutation stubs.
  See "Step 1 as built" below.
- **Step 2 — the WAW lesson. ✅ DONE 2026-08-18** (`7c7f6f8`; repo 11887 → 11904).
  `one-name-two-writers` on `register-reuse`, five steps at cycles 0, 5, 19, 22 and 26. Nine named
  oracle claims, three mutation stubs. ⚠ The seeded framing "blocking every younger instruction
  behind it" was DROPPED as false on screen — fetch is a one-deep slot, so nothing is behind `i8`
  at all; what is visible is that nothing is fetched for four cycles. See "Step 2 as built" below.
- **Step 3 — the WAR lesson**, and the reorder at c17. The only WAR in the product; the only stall
  in the product that fires at the END of an instruction's life; costs zero cycles and buys the
  answer. Carries the `reservation-station-holds` callback from finding 3, and the track's closing beat —
  subject to decision 5, which seeds the rename A/B as an ORACLE ONLY.
- **Step 4 — the track and its order pins.** `index.json`, the exhaustive track-NAME `toEqual` at
  `lessons.test.ts:770`, the `LESSONS.length` count at `:1085`, and the per-model membership set
  beside the `deep-pipeline` one at `:1150`. Every order pin gets the cache track's discriminator
  applied per MENTION (M14 step 4): a pin earns its place only if a prose sentence **lies** when
  reordered. Unexplained is not a lie.
- **Step 5 — the browser pass.** Every lesson reached ONLY through `startLesson`, each started from
  a different model so every assertion is about what the lesson dragged. Read the RENDERED panel,
  not the DOM. [[browser-is-the-only-net]] — 11 of the last 12 view steps shipped a defect only the
  browser caught.

## Step 1 as built — `two-units-one-queue` (2026-08-18)

Four steps, chosen so no two share a cycle: `instr-fetch` #1 (c0), the first `structural-int`
stall (c3), the write of the first partial total (c8), and the write of 55 (c71).

**Two authoring calls worth keeping.**

**The lesson declares NO `config`, and that is asserted rather than left looking like an
omission.** `Lesson.config`'s own docblock allows it — "a config-blind model ignores every knob; a
lesson that omits it has no opinion" — and declaring one here would pin knobs this engine provably
ignores while silently moving the reader's session position on every OTHER model the moment the
lesson opened. The oracle pins the five capability flags beside the omission, so a model that later
gained a knob reddens here instead of quietly leaving this prose describing one position of a
machine the reader can now move.

**Step 2 CONCEDES the thing that would have made it false.** At cycle 3 the loop's `add` lacks a
unit _and_ its operand — `t0` is not written until cycle 5 — and the machine reports
`structural-int` because the issue check asks about units first. A narration claiming "it is not
waiting for data" would have been false with every anchor green. So the expert tier states both and
then says which constraint _binds_, proving it from the run: the `add` issues at 5, the cycle after
a unit frees, and reads `t0` at 6 without waiting. Both halves are pinned.

### The mutation check — and it found a FALSE NET in this milestone's own oracle

Predictions written first. **M-1**: the issue check reports every unit shortage as
`structural-mem`. **M-2′**: `INT_LATENCY` 1 → 2 — a coherent machine, not a broken one.

| oracle claim              | M-1     | M-2′                               |
| ------------------------- | ------- | ---------------------------------- |
| declares knob-blind model | green   | green                              |
| THE THESIS                | **RED** | **RED**                            |
| THE DISCRIMINATOR         | green   | green                              |
| STEP 3 (no gap in rows)   | green   | **RED**                            |
| STEP 2 (the unit binds)   | **RED** | **RED**                            |
| STEP 4 (71 / 80 / period) | green   | **RED**                            |
| OCCUPANCY CEILING         | green   | **GREEN — and it should not have** |
| CROSS-MODEL               | green   | green                              |
| the sweep (validator)     | **RED** | green                              |

Repo-wide: M-1 reddens 6 files / 23 tests; M-2′ reddens 7 files / 64 tests.

⚠ **`OCCUPANCY CEILING` stayed green under a change to the very latency its NAME quotes.** It
asserted that a unit's busy span matches its instruction's row — true by construction of the row,
and therefore true at any latency — plus `expect(2 / 4).toBe(0.5)`, which is arithmetic and
measures nothing at all. **An assertion necessary but not sufficient, passing on broken code while
reading like a guard**: M15 step 7's species, found here by RUNNING the stub rather than by reading
the test. It now measures the turnaround off the recording (the smallest gap between one occupant
of a unit issuing and the next issuing into it), carries a non-vacuity floor on the number of gaps,
and states the ceiling as the comparison the narration makes rather than as a constant over itself.
**Re-run against the FIX, not only against the original** — 5 of 8 red now where it was 4 of 8.

⚠ **A third stub was DISCARDED rather than reported, and the reason generalises.** Freeing the unit
inside Write-Result instead of at the clock edge lets a newly issued instruction be deleted by the
edge that follows, so the machine deadlocks. It reddened ten files and proved only that the tests
run the engine. **A mutation that breaks CORRECTNESS cannot measure a TIMING claim** — and its red
is louder than a good stub's, which is exactly why it is tempting to report.

## Step 2 as built — `one-name-two-writers` (2026-08-18)

Five steps on `register-reuse`, chosen so no two share a cycle and none touches c17 (reserved for
step 3's reorder): the opening fetch (c0), the benign `waw` (c5), the corrupting `waw` (c19), the
release (c22) and the final write of 7 (c26).

**The shape is a CONTRAST, not a mechanism walk.** The run holds five `waw` stall cycles and they
are two different animals: one is the `la t0, first` expansion holding itself up, whose younger
writer READS `t0` and could never have produced a wrong answer; four are the `addi t1, x0, 7` held
at Issue by an older `lw t1` that still owns the name. **In the event stream they are
indistinguishable** — same type, same reason, same stage. The difference is a property of the
decoded instructions, which is why it is the lesson's spine and why it needed an oracle of its own.

**The thesis inverts step 1's.** There the subject was "no unit"; here a unit is FREE and the
instruction still cannot go. `issueBlocker` asks about units before destinations, so a `waw` report
is itself proof the unit test passed — but the claim is pinned on the RECORDING (INT1 idle c18–c22
beside a four-column-blank row, and four cycles in which nothing is fetched at all), never on the
order of the checks in the source. The narration also never names the stage: a stall reported as
`stage: 'ID'` repeats the `IF` cell on screen (M15 step 7), so "watch it move to Issue" would be
false off the picture. It points at the blank row instead.

**Two sentences the first draft got wrong, both caught before the mutation stage.**

⚠ **"Every other `waw` in the corpus is a `la` address expansion" is FALSE, and
`register-reuse.s`'s own header carried the same false claim** (fixed in this commit). `array-sum`
stalls `waw` on an accumulator (`add a0, a0, t2`) behind a load; `nested-loop` on a counter
(`addi t1, t1, -1`). Three shapes, not one — and `packages/engine/scoreboard/src/timing.test.ts`
already knew about the third, so the header contradicted a sibling file written in the same
milestone. What all of them share is the property that actually decides corruption, and it is the
SELF-READ, not the spelling: **35 of the 39 `waw` cycles in the whole library are a writer reading
the name it overwrites, and the 4 in this lesson are the only ones that are not.** That is now both
the narration and the assertion, and it is a stronger claim than the one it replaced. The general
lesson: a claim about SHAPE is a claim about spelling and will rot; find the property the shapes
share and assert that.

⚠ **THREE positional claims about source text were wrong, and NO oracle in this file can see
one.** "The `la t0, first` on line 3" (it is the second instruction, and line 3 of nothing) and
"the `lw t1, 4(t0)` four instructions back" (it is `i6` to the held `i8`'s — two back, and two
source lines back, so no counting convention rescues it) both survived a green suite and a
three-stub mutation table, and the second was in the `detailed` tier, which is the tier the reader
actually sees. The third was the SHAPE claim above. **Counting and position claims about a program
listing are unguarded BY CONSTRUCTION** — an anchor pins a transaction and a stub perturbs a
machine, and neither has any opinion about where a line sits. Read every one of them against the
listing by hand before shipping; that is the only net there is.

### Two order-dependent sentences step 4 must pin

Both satisfy M14's discriminator as it is written — reorder the track and they do not merely go
unexplained, they go FALSE — so they are listed here rather than left to be discovered by a
reorder. This lesson's closing expert tier says "the ceiling **the previous lesson** measured", and
`two-units-one-queue`'s closing says "when you meet this machine's held writes in **the next two
lessons**". A count and a direction, one in each lesson, each false if the track is resequenced.

### The mutation check — three stubs, each with a DECLARED purpose

Predictions written before any stub was applied (`M:\claud_projects\temp\m16-step2\predictions.md`),
against a committed tree.

- **M-1 — the WAW check deleted.** Breaks correctness by design, so per step 1's own finding it
  **cannot measure a timing claim**. It is reported anyway because it is the only stub that can
  measure the CORRECTNESS claim, which is a correctness claim by nature. Result: `t1` ends on **9**,
  exactly as step 5 promises — and `t0` still lands the right address, exactly as step 2's
  counterfactual promises, because the operand check holds the self-reading writer regardless. `a0`
  and `a1` are untouched: the corruption is confined to the one name. (29 cycles, not the rename's
  30 — deleting a check and renaming a register are different interventions, and the narration
  quotes the rename.)
- **M-2 — the check ORDER swapped**, destination before units. A coherent machine: same issue
  decisions, different label. The discriminating stub for THE THESIS, and **not vacuous** — `i2` at
  c3/c4 lacks a unit AND has `x5` claimed, so those two cycles flip to `waw`.
- **M-3 — `MEM_LATENCY` 4 → 2.** A coherent machine. Measures the four-cycle window.

| oracle claim                      | M-1            | M-2       | M-3       |
| --------------------------------- | -------------- | --------- | --------- |
| declares knob-blind model         | green          | green     | green     |
| THE RUN (31 / inventory)          | RED            | RED       | RED       |
| THE SPLIT (5 cycles, 1 + 4)       | RED            | RED       | RED       |
| THE DISTINCTION (self-read)       | RED            | RED       | **green** |
| THE THESIS (unit free, blank row) | RED            | **RED**   | RED       |
| STEP 4 (owner MEM, issues at 23)  | RED            | RED ⚠     | RED       |
| STEP 5 (9 then 7)                 | **RED**        | green     | RED       |
| THE DISCRIMINATOR (`t1` = 7)      | **RED**        | green     | green     |
| SCOPE (35 of 39)                  | RED            | RED       | RED       |
| THE COUNTERFACTUAL (30 not 31)    | RED            | RED       | RED       |
| the sweep (validator)             | RED (no `waw`) | **green** | green     |

Repo-wide: M-1 reddens 7 files / 33 tests; M-2 5 files / 19 tests; M-3 7 files / 46 tests.

**Ten of eleven cells landed as predicted in each column.** The one miss is STEP 4 under M-2
(predicted green, actual RED) ⚠ **and it reddens through the SPLIT's premise, not its own subject**:
the oracle identifies the held instruction as the SECOND `waw` stall, and under the stub the second
`waw` stall is a different instruction (`i2`, which issues at 6). The timing it asserts did not move
at all. That is the correct behaviour and the handle is deliberately kept ordinal, because the
lesson's own anchor is `nth: 2` — if the second `waw` stall is a different instruction, the lesson
is false, whatever the cycles do.

⚠ **The M-2 sweep cell is the headline.** With the reasons relabelled, both `waw` anchors still fire
on distinct cycles and the validator is perfectly happy — while step 3 now points the reader at the
benign expansion and calls it the one that would have corrupted `t1`. **A green sweep proves the
steps fire; it has never been able to prove the prose is true**, and this is that gap exhibited
rather than argued.

**Two things the table is honest about.** `two-units-one-queue`'s whole oracle stays green under
M-3, correctly — `sum-loop` touches no memory, so a memory-latency change is invisible to it; a
green cell there is not coverage. And the mutation table measures the FIXED `SCOPE` test, because
that fix landed before the stubs, not after — the "re-run against the fix" rule was satisfied by
sequencing rather than by a second pass.

## Acceptance criteria

- Every lesson decision 1 pins authored, each listed in `index.json`, each swept
  green by `lessons.test.ts` at the single `neutral config` position — which here means **every
  step fires**, with no at-least-one escape hatch.
- No two steps of any lesson share a cycle (the validator's own message: "steps share a cycle and
  can't be reached independently by the cursor").
- Each lesson's discriminator asserted, not argued: **swap `model` and the narration becomes false.**
- Every cross-model number in narration pinned by one of the three oracles named above, against a
  real recording of the model it names.
- Every number quoted in narration READ from a recording, never computed.
- `depthDefault: 'detailed'` on each, with narration at that tier that differs from `expert` — the
  M12 dead-field guard, in both rot directions.
- No `*` outside a code span in any narration (the existing guard; backticks are the whole markup
  vocabulary).
- Criteria 1–5 above each checked and reported, with the check named — not asserted by silence.
- Mutation-checked: each new oracle line verified RED against the broken thing it claims to catch.
  **Run every new test against the BROKEN code** (M11+M12 review), and do not copy a previous
  mutation table's SHAPE — it silently drops every suite added since (M15 step 6).
- The browser pass drives the shipped bundle, and every acceptance box is closed against the net
  that can actually see it.

## How this milestone can lie to itself

- **A green sweep proves the steps fire, not that the prose is true.** With one config position the
  sweep is stronger than usual at catching a dead step and no better at all at catching a sentence
  that is false about the machine on screen.
- **A cross-model sentence has no declaration protecting it.** M12's trap; M15 step 6 showed the
  obvious oracle for this particular claim is vacuous.
- **A cycle-count comparison between models measures the latency choice.** Finding 5.
- **An `nth` anchor can land on the benign twin.** Finding 6.
- **A stall's `stage` is not a position in the table.** M15 step 7: an Issue stall repeats the `IF`
  cell while its event says `stage: 'ID'`, and a WAR stall repeats the LAST cell. A narration saying
  "watch it move to Issue" is false off the screen.
- **A source-editing harness can match a comment.** Finding 1, measured, on this milestone's own
  first dump run.
- **"Keep it available for a future lesson" is a claim to measure**, not a reason (M15 step 8).

## Decisions to pin (seeded with recommended answers)

| #   | Decision                                       | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Pinned answer                                                                                 |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | **How many lessons, and which subjects**       | **Three: the ceiling, WAW, WAR+reorder.** Matches M12 and M14. A fourth ("finished out of order" as its own lesson) is available but its only cycle is c17, which lesson 3 needs; splitting it costs lesson 3 its payoff. Gates steps 1–3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Three, as seeded** (user, 2026-08-18): the ceiling, WAW, WAR+reorder                        |
| 2   | **The ceiling lesson's program**               | **`sum-loop`** — 80 cycles, IPC 0.425, and **zero `operand`/`waw`/`war` stalls in the whole run**, which is M15's "say the ceiling out loud" requirement stated directly. Alternative: **`add.s`** (3 instructions, 9 cycles) — sharper, but it collides with `deep-drain`, which is _"Three instructions, ten cycles"_ on the SAME program and already asks "where do the extra cycles go?". Not just a title clash: it is the same rhetorical move one track later with a SMALLER number, which a reader will take as "the scoreboard beats the deep pipeline" — finding 5's confound, and `add.s` touches no memory so the comparison is ALMOST fair, which is the trap. Neither program risks the step budget (9 and 80 cycles)                                                                                                       | **`sum-loop`, as seeded** (user, 2026-08-18) — `add.s` rejected on the `deep-drain` collision |
| 3   | **A new track vs extending an existing one**   | **New track**, appended last. A new model is M12's case, not M14's; extending "The out-of-order machine" would file a non-renaming machine under a renaming one. Costs a hard edit to the exhaustive track-NAME `toEqual` and to the picker order, both expected. Name seeded as **"The scoreboard"**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **New track, as seeded** (user, 2026-08-18)                                                   |
| 4   | **Track position**                             | **Last, after "The out-of-order machine"** — and the pin is EARNED rather than assumed, by finding 3: lesson 3's callback ("there is nowhere to park, so it waits in the unit") is not merely unexplained but false in its premise if the reader has not met the reservation station. Historically the scoreboard PRECEDES Tomasulo; M15's own rule appends a predecessor met after its successor **The discriminator is SATISFIED, not merely arguable**: the quoted sentence is a PREMISE the callback depends on, not a decoration, so reordering makes it false rather than unexplained                                                                                                                                                                                                                                               | **Last, after "The out-of-order machine", as seeded** (user, 2026-08-18)                      |
| 5   | **Does the track close with a HAND-OFF**       | **The ORACLE yes, the INVITATION no — and the first seed of this row conflated them.** The rename A/B stays as a headless oracle through `loadSource`, which is what pins the renaming sentence. It must NOT become a "go edit this" step: the payoff is ONE cycle of 31, which the reader would have to COUNT across two runs from memory, in a sandbox where the fork has already DETACHED the lesson — and if they rename only the WAR (the natural single edit, and the very hazard lesson 3 is about) the payoff is **ZERO**. That is an invitation whose headline result is "nothing happened." `function-call`'s hand-off works because `max` returns your number, visibly, in one register. **If a hand-off is wanted anyway, its payoff must be the `war` and `waw` rows VANISHING from the status tables**, never a cycle count | _open_                                                                                        |
| 6   | **Whether the ceiling lesson opens the track** | **Yes.** A reader who meets `structural-int` first as the wall it actually is will not misread the hazard lessons as a verdict on their program — which is M15's stated requirement. The alternative (hazards first, ceiling as the closer) makes the first two lessons quote a cycle total the third then reinterprets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | _open_                                                                                        |
| 7   | Depth tier                                     | **`detailed`**, matching all 26 shipped lessons, with the library-wide `depthDefault` pin making it not a choice a lesson can quietly make differently. Note `resolveNarration` falls back DOWNWARD, so anything written only at `detailed` is invisible to an `expert` reader                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | _open_                                                                                        |
| 8   | A new trace event, field, program or view      | **No** — UNCHANGED criteria 1–5. Predicted, not assumed, and each checked at the close                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | _open_                                                                                        |
