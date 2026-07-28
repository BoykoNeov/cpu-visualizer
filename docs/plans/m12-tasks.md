# Milestone 12 — The deep-pipeline lesson track

**Status: COMPLETE, 2026-07-28. All steps 0–5 done and pushed. The track is FINAL at three lessons —
`[deep-bubble-survives, deep-bet-pays-double, deep-drain]` — and step 3's conditional landed on the
AUTHOR side rather than the drop side, with no trace event invented. Repo 4466 tests, all five gates
green. The browser pass drove the SHIPPED BUNDLE through `startLesson` (51 checks, ALL PASS) and
found ONE defect, which was not this milestone's: `Lesson.depthDefault` was read by nothing, so all
22 shipped lessons opened on their EXPERT paragraph. Fixed (see step 5). Every decision in the table
at the bottom is PINNED AS SEEDED (user, 2026-07-28), including the two the dump answered: no engine
step, no new corpus program. All five falsifiable UNCHANGED criteria HELD.**

Source of truth for scope: `cpu-visualizer-spec.md` §13 (the curriculum system). The load-bearing
constraints are INV-6 (lessons anchor to trace EVENTS, not cycle numbers), INV-5 (lawful
simplification — every step authors its depth tiers), INV-7 (one corpus), and INV-8 (any new corpus
program is differentially tested on every model). The model's ground truth is `docs/plans/m11-tasks.md`,
whose decisions table names this milestone explicitly: _"A lesson track for the deep pipeline — NOT in
this milestone. M11 = model + view, the M9 shape; the track is its own milestone, the M10 shape."_

## Why this milestone, and why now

M11 shipped the 7-stage **engine and its whole visual layer** — the two-cycle execute, the forwarding
network that sits in EX1 and cannot reach the instruction that needs it, the five flush shapes, the
bespoke `deep-pipeline` datapath that draws the bubble as geometry, the pipeline map absorbing a real
seven-stage recording — but **no lessons**. `content/lessons/index.json` has five tracks (_The
language_, _The machine_, _The cache_, _The wide machine_, _The out-of-order machine_) and nothing on
the deep pipeline. Every prior tier that closed with a matching track did so as its own milestone (M8
closed superscalar, M10 closed out-of-order). So the deep machine is _observable_ but not _teachable_.

What is genuinely new here: **this is the first lesson track ever to run on `model: deep-pipeline`**,
and the first track whose entire subject is a **delta against a machine the learner has already seen**.
The three tracks before it each taught a mechanism the learner had never met (a cache, a second lane, a
ROB). This one teaches that a mechanism they already understand — forwarding — **stops being enough**.
That is M11's own thesis, and it currently has no words attached to it anywhere in the product.

What is cheap because it is shared: the lesson machinery (M5), the runner, the narration tiers, the
picker's track grouping, the sweep, the corpus, and — the prediction this milestone will try to falsify
— **the config sweep's axis list**, which needs no new axis for the first time since M7 (see
_Falsifiable UNCHANGED criteria_).

---

## The dump (the design's factual ground) — RUN 2026-07-28

`M:\claud_projects\temp\m12-dump\dump.txt`. Every corpus program × {`pipeline`, `deep-pipeline`} ×
forwarding {off,on} × prediction {not-taken, taken}, cache null: total cycles, the stall histogram by
`reason` **and by pc**, every `flush` with its reason literal and `stages` array, every `forward` by
`from→to`. Plus per-cycle event listings for `add`, `array-sum`, `sum-loop` on the deep machine at
forwarding ON. **Every number that reaches narration must be read out of this file, not computed** —
that is the `lesson.ts` config docblock's own lesson (72/51 is true only under predict-not-taken; the
same lesson reads 70/49 under static-taken, and the browser caught prose reading 51 above a transport
reading 49).

### What it establishes (cycles; `pipeline` → `deep-pipeline`)

| program           | fwd OFF / not-taken | fwd ON / not-taken | fwd ON / taken |
| ----------------- | ------------------- | ------------------ | -------------- |
| `add`             | 9 → **12**          | 7 → **10**         | 7 → **10**     |
| `array-sum`       | 72 → **96**         | 51 → **74**        | 49 → **70**    |
| `sum-loop`        | 78 → **109**        | 56 → **87**        | 49 → **73**    |
| `paired-branches` | 9 → **11**          | 9 → **11**         | 13 → **19**    |
| `byte-loads`      | 14 → **18**         | 10 → **14**        | 10 → **14**    |

### The four findings that decide the track

1. **`ex-latency` exists and no other model emits it.** Confirmed by grep (only
   `deep-pipeline/src/processor.ts`) and by recording: `add` at forwarding ON stalls once with
   `reason: 'ex-latency'` where the 5-stage stalls **zero** times. `array-sum` at forwarding ON:
   `{ex-latency: 8, load-use: 10}` here vs `{load-use: 5}` there. **This is the anchor the whole
   milestone hangs on, and it is the exact inversion of M10** (whose headline was that _nothing_
   discriminated its toggle).

   It is also **forwarding-ON-only**: `detectHazard` returns `'ex-latency'` at forwarding ON
   (`processor.ts:1349`) and `'raw'` for the same dependency at forwarding OFF (`:1353`). That is
   lawful under the sweep's rule — _"every step must anchor in AT LEAST ONE position"_
   (`lessons.test.ts:60`) — and is precisely `forwarding-bubble`'s own shape, which is a lesson some
   of whose steps MUST be dead in one position.

2. **The load-use penalty doubles, silently.** `array-sum` fwd ON: 5 loads, **5** stall cycles on the
   5-stage, **10** here. Same event, same reason string, twice the cost. A lesson that re-explains
   _what_ a load-use hazard is duplicates `forwarding-bubble`; the only non-duplicate angle is the
   **delta**.

3. **A flush's `stages` array is NOT the penalty, and the corpus proves it two ways.** `array-sum` at
   prediction OFF: `branch-taken [EX1,ID,IF2,IF1]` — four casualties, four cycles. `sum-loop` at
   prediction OFF: `branch-taken [EX1,ID]` — **two** casualties, and the branch still costs four,
   because the other two slots already held bubbles the `ex-latency` stalls put there. M11 found five
   distinct flush shapes including a non-contiguous `['EX1','IF1']`. **Narration states the penalty as
   a TOTAL and never counts the dead.** Under prediction ON the shape is `[IF2,IF1]` everywhere — the
   bet is placed in ID, so a correct bet still costs 2.

   The flush reason literals, in full: `branch-taken`, `branch-predicted-taken`, `branch-not-taken`.

4. **No inert knob.** Unlike M10 step 0 — which found `slowOpLatency` shipping dead and turned a
   content milestone into an engine one — every knob the deep pipeline declares moves the recording:
   forwarding (every program), prediction (every program with a transfer), cache (M11 step 6, shipped
   with the freeze). **Seeded conclusion: M12 is content-only.** Step 0 re-states this falsifiably.

---

## Headline decision — the track teaches the DELTA, and the flagship toggle runs BACKWARDS

Every other track's flagship is _"flip this knob and watch the machine get better."_
`forwarding-bubble` opens at `forwarding: false` and invites you to turn it ON to watch the bubble
vanish. **This track's thesis lesson opens at `forwarding: true` and the bubble is still there.**
That inversion is the money shot and it must be the DECLARED config, not an accident of authoring.

Two constraints follow, and both are pinnable decisions rather than taste:

- **A lesson declares exactly one model.** There is no in-lesson A/B across models — `Lesson.model` is
  a single id and the shell opens one machine. So the 5-stage comparison is delivered in **prose and
  by track order only** ("the same program you watched run 51 cycles on the five-stage runs 74 here").
  Do not design a comparison the shell cannot show. The corollary is a real risk: prose that names the
  other machine is prose no test can catch drifting — hence the oracle rule in step 0.
- **Every lesson must be FALSE on the 5-stage.** The one-line discriminator for whether a beat earns a
  place in this track: change the lesson's `model` to `pipeline` and its narration must become a lie.
  A beat that would read identically there belongs to `forwarding-bubble`, not here.

---

## The un-anchorable beat — depth as a cost when nothing goes wrong

M10 had renaming; this milestone's analogue is **the drain**. `cycles = N + 6` — the pipe is six cycles
longer than its work, and `add` shows it nakedly: 3 instructions, 10 cycles, and **cycle 8 contains no
events at all**. It is the purest statement of "depth costs even when nothing goes wrong."

**No event fires for it.** There is no `drain` event, no `pipe-empty`, nothing; the fact is visible only
as a cycle count, as the map's tail, and as an empty cycle in the trace. The temptation is exactly M10's
— invent an event so the beat can be anchored — and the answer is the same: **do not add an event to the
trace schema to make a lesson author's life easier** (INV-3 says extend the schema when the _view_ needs
a fact; it does not say invent a fact to hang prose on).

So the beat has two lawful homes, decided at step 3, not now:

- Ride an existing event: anchor on the LAST `instr-retire` and narrate the tail behind it ("the machine
  ran for six cycles after the last instruction was fetched").
- Drop it with proof, M10 step 6's shape — a written argument that the beat has no anchor and that the
  cycle counter already teaches it.

**Either outcome is a success; inventing an event is the only failure.**

---

## Falsifiable UNCHANGED criteria — ALL FIVE HELD (verified 2026-07-28)

**Outcome first, so the list below reads as a set of predictions that were kept rather than a wish.**
No trace event, no `reason`, no schema field was added (criterion 1) — and the temptation reached
exactly where the plan predicted, at the drain beat, where the answer was to anchor on a neighbouring
event and let the prose point at the gap. `lessons.ts` was not touched (2). `CONFIG_AXES` gained no
axis (3) — the first track since M7 to add none, and now asserted as an EQUALITY with the pipeline's
twelve machines rather than as a copy of them. The `Lesson` type gained no field (4) — though one
existing field, `depthDefault`, turned out to have been dead since M1 and is now wired (step 5); that
is the opposite of adding one. No corpus program was added (5), so no INV-8 ripple was paid.

M11's two paid out (the pipeline map and the trace schema both needed no change, and the temptation
reached exactly where predicted). These are M12's, written so they can be caught lying:

1. **The trace schema and the deep-pipeline engine need no change.** No new event, no new `reason`, no
   new field. If a lesson needs one, the lesson is wrong — say so and drop the beat.
2. **`packages/web/src/lessons.ts` needs no change.** The track is content: `content/lessons/*.json`
   plus a group in `content/lessons/index.json`. The module only reads them.
3. **`CONFIG_AXES` in `lessons.test.ts` needs no new axis** — the first track since M7 that adds none.
   The deep pipeline honors forwarding × prediction × cache, all three already swept, so
   `positionsFor(deep-pipeline)` is 12 machines the day the first lesson exists.
4. **The `Lesson` type needs no new field.** In particular not a `track` field (pre-declined by M5
   decision 2) and not a `comparedTo` — the cross-model comparison is prose.
5. **No new corpus program.** The dump says `add`, `array-sum`, `sum-loop` and `paired-branches` cover
   every seeded beat. An addition would pay the full INV-8 ripple across six models; if one turns out
   to be needed, that is a finding worth recording, not a quiet commit.

---

## Build order (each step testable before the next)

- [x] **0. The dump, recorded — and the two "is this content-only?" claims stated falsifiably. DONE
      2026-07-28.** The `positionsFor` case landed as an **EQUALITY with the pipeline's twelve labels**
      rather than a spelled-out copy, because sameness is the claim being made (criterion 3): the deep
      pipeline honors forwarding × prediction × cache and nothing else, so its machine list is the
      5-stage's label for label, and a knob it honored alone — the `MEM1`/`MEM2` or 12-stage machines
      M11's decisions table left open — is exactly what would redden it. Length pinned alongside so the
      equality cannot pass on two empty lists. The two claims stand as the dump left them: **no engine
      step** and **no new corpus program**. The original text of the step follows. The
      dump is already run (above); this step lands it in the plan as the milestone log and pins the two
      claims it decides: **no engine step** (no inert knob — every declared capability moves the
      recording) and **no new corpus program**. Also the cheap coverage assertion the first lesson makes
      reachable: a `positionsFor` case for `deep-pipeline` (12 machines: forwarding × prediction ×
      cache), mirroring the pipeline case — the M7-step-6 / M10-step-0 pattern of adding the assertion
      at the step that makes the axis reachable rather than the step that invents it. **The narration
      oracle rule is fixed here, before any prose exists:** every cycle count that appears in narration
      is asserted in `lessons.test.ts` against a recording made at the lesson's own declared config,
      and every claim about the 5-stage that appears in deep-pipeline prose is asserted against a
      `pipeline` recording of the same program. Acceptance: `positionsFor` case green; the two claims
      written with the evidence that would falsify them.

- [x] **1. Lesson — "The bubble forwarding cannot close" (the thesis). DONE 2026-07-28**, sweep green
      in all 12 positions on the FIRST run, and every number in its prose came out of the dump rather
      than out of arithmetic. Authored as seeded on `array-sum` at `forwarding: true`. Its oracle
      carries a weight no other lesson's does: the closing prose quotes **51**, a fact about a model
      the lesson does not open and which no declaration protects — the M4-step-4 trap one axis over
      (that one was numbers true only under an undeclared PREDICTION scheme; this is numbers true only
      on an undeclared MODEL) — so both machines are recorded and 51 is asserted against a real
      `pipeline` recording. The track's discriminator is asserted rather than argued: at the same knobs
      the 5-stage stalls **zero** times on the branch that stalls five times here, and `ex-latency` is
      not merely absent from that recording, it is unreachable on that model. ORIGINAL TEXT:** `ex-latency` on the declared
      config `forwarding: true`. Seeded program `array-sum` (see decisions) so the delta is literal
      against `forwarding-bubble`'s own 51. Beats: the pipe fills seven deep; the `bne`/`addi` pair
      that `forwarding-bubble` taught losing its stall **still stalls here\*\*, anchored
      `{event:'stall', where:{reason:'ex-latency'}}`; the `forward` from `EX2/MEM` arriving a cycle
      late (`add`'s c6 shows both forwards landing the cycle after the stall); and the closing
      count — 74 here against 51 there, both at forwarding ON. Acceptance: sweep green across all 12
      positions; a narration oracle pinning 74 (and 51 from a `pipeline` recording); the
      "false-on-the-5-stage" discriminator applied and recorded.

- [x] **2. Lesson — "The bet that pays double". DONE 2026-07-28.** `sum-loop`, prediction as the
      variable: 87 → 73 here against 56 → 49 there, exactly half. **The sweep's per-position order
      check earned its keep**: the closing step first anchored on the write of 55, and `a0` reaches its
      total in the final iteration BEFORE the loop's branch is corrected — so under prediction it ran
      ahead of the wrong-bet beat. Re-anchored on the last retire. The lesson is written around the
      trap the dump found and it is IN the corpus, not hypothetical: this program's taken branch names
      TWO casualties and costs FOUR cycles (the `ex-latency` stall above it left bubbles in the other
      two slots) while `array-sum`'s identical four-cycle branch names four — so prose that counted the
      dead would be right on one program and wrong on another with every anchor green. ORIGINAL TEXT:** The doubled speculation penalty, with prediction as
      the independent variable. Anchored on `flush`. **The penalty is narrated as a TOTAL** — never as a
      count of the dead, because `sum-loop`'s `[EX1,ID]` names two casualties for a four-cycle branch.
      Beats: a taken branch costs 4 (was 2); a correct bet still costs 2 because the bet is placed in
      ID and the correction lands at end of EX2; and the flip — the deep machine gains twice as much
      from prediction as the 5-stage (`sum-loop` 87→73 vs 56→49). **The title tracks the program and
      they must not come apart:** on `sum-loop` the bets are RIGHT (the loop is taken 9 of 10, so
      prediction ON emits `branch-predicted-taken`×10 and the story is what a correct bet SAVES). The
      wrong-bet story is `paired-branches`, the one program prediction makes worse — 11 → **19\*\* here
      against 13 → 9 there. Both are lawful lessons; they are not the same lesson, and the seeded one
      is the good bet because a 2× gain restates the depth thesis. Acceptance: as step 1, plus an
      explicit assertion that the narrated penalty matches the recording's cycle delta rather than
      `stages.length`.

- [x] **3. Lesson (CONDITIONAL) — "Three instructions, ten cycles". AUTHORED 2026-07-28, not
      dropped.** The un-anchorable beat found a lawful home: it anchors on the retires either side of
      the gap and the prose points AT it ("scrub back one and look at cycle 8"), and both facts that
      instruction leans on are pinned because neither is derivable from the anchors — the empty cycle
      is real, and it sits BETWEEN the anchors. **No trace event was invented, which was the only way
      this step could have failed.** What it teaches that the other two cannot: this is the machine on
      its best behaviour and it still costs three cycles more than the 5-stage; latency and throughput
      come apart cleanly (first retire two cycles later, second retire one cycle after the first on
      both). Its expert tier names what the simulator does NOT model — a deeper pipe buys a shorter
      cycle, and nothing here has a notion of cycle time — because a reader who is never told that can
      only conclude the opposite. **The `add.s`-has-no-`ecall` flag resolved in favour of authoring:
      the engine halts anyway (`halted === true`), so the transport's marker means the same thing here
      and the browser pass needed no special case.** ORIGINAL TEXT:** The `+6` drain, on
      `add` (3 instructions, 10 cycles, one literally empty cycle). Decide between the two lawful homes
      in the un-anchorable-beat section above. **`add` has no `ecall`\*\* — M11's timing docblock says so
      outright ("it runs off the end of `.text`"), and the dump confirms it still records to 10 cycles.
      That is a step-3 decision, not a step-5 surprise: if the beat lands on `add`, check in the browser
      what the transport reads when a program ends without halting, because step 5's halted-marker rule
      (M11's "assert the prefix AND the marker") assumed an `ecall` program and does not transfer. If it
      does not terminate legibly, the vehicle becomes `array-sum`'s tail instead. Acceptance: either a
      lesson that anchors on a real event with the drain in its prose, or a written drop with the same
      rigor as M10 step 6 — and in neither case a new trace event.

- [x] **4. Wire the track. DONE 2026-07-28.** `"The deeper machine"`, after _The cache_ and before
      _The wide machine_, as pinned. Membership pinned BY NAME, where the pull to derive it from
      `model` is at its strongest — `deep-pipeline` is the only model these three run on and no other
      lesson runs on it — and that coincidence is exactly the one M5 step 4 refused: a cache lesson
      authored on the deep pipeline (its cache is configurable since M11 step 6) would be filed here by
      a derived rule and would be wrong. **One order claim EARNED, one DECLINED, both by the cache
      track's own discriminator (a pin earns its place only if a prose sentence LIES when reordered).**
      Earned: the machine track before the deeper machine — `deep-bubble-survives` says in a sentence
      that this stall "was the flagship" there, which read first is false, not merely unexplained; the
      narration making it true is asserted beside the position, so deleting the reference takes the
      test with it. Declined: a sequence test WITHIN the track — these three do not chain the way the
      cache track's do, each being a delta against the five-stage rather than against its neighbour.
      The two teaching-order tests were READ, not grepped, and they are differently shaped: `:572` is an
      exhaustive `toEqual` (any position is a hard edit), `:593` is pairwise and the seeded position
      passes it. ORIGINAL TEXT:** `content/lessons/index.json` gains the group, seeded **"The deeper
      machine"** placed after *The cache* and before *The wide machine* (mirrors the picker's model
      order: pipeline → deep-pipeline → superscalar → out-of-order). **Name the churn up front, the way
      M11 named `models.test.ts`'s — and READ, not grepped, because one of them could have rejected
      the seeded position:** this is an INSERTION into an ordered structure, so it hits
      `lessons.test.ts:517` ("LESSONS is exactly the index, in the index's order — exhaustive in BOTH
      directions"), `:624` ("files each lesson under the track its SUBJECT belongs to — asserted by
      name"), `:718` (the exhaustive shipped-lesson list), and the two teaching-order tests, **which
      are differently shaped**: `:572` is an exhaustive `toEqual` on the whole track-name list, so any
      position is a hard edit of that assertion; `:593` is the pairwise
      `indexOf('The machine') < indexOf('The cache')`, which the seeded position **passes** (checked
      2026-07-28 — a track order shaped as "machine-axis tracks precede feature tracks" would have
      rejected it). A new sequence test earns its place **only if a prose sentence lies when the track
      is reordered\*\* (the cache track's own discriminator, which M10 step 7 used to decline one).
      Acceptance: full suite green; the picker shows six tracks in the authored order.

- [x] **5. Browser pass — the only net that sees this. DONE 2026-07-28 — 51 checks, ALL PASS, and
      it found the milestone's one defect.** Rig: `M:/claud_projects/temp/m12-browser/s5-lessons.mjs`,
      driving the BUILT bundle under `vite preview`, reaching every lesson ONLY through `startLesson`
      (never the model picker) and starting each from `single-cycle` so every assertion is about what
      the lesson dragged. **THE DEFECT, and it is not this milestone's: `Lesson.depthDefault` was read
      by nothing.** The shell hardcoded `useState<DepthTier>('expert')` while all 22 shipped lessons
      author `detailed`, so every lesson in the product opened on its EXPERT paragraph — the six
      language tours included. It is the THIRD declared-and-ignored field on `Lesson` (`startLesson`'s
      own note records `model` and `config` were that until M3 step 8) and it is **invisible to every
      headless test by construction**: those assert narration RESOLVES at a tier, a question about the
      lesson; which tier the SHELL picks is a question about the shell, and no test here can see a
      click. Fixed at the picker (depth is a pure view concern, INV-2), guarded headlessly in both
      directions it can rot, and re-driven on a fresh build to confirm the `detailed` register renders.
      **Four rig-not-app failures before that, all four the rig:** §0's "known-present control" was
      checked on `single-cycle`, which honors no knobs and shows no Forwarding control at all (a
      premise that was wrong, reported as the rig being broken); the caption is `Predict`, not
      `Prediction`; and the rail shows the steps that ANCHOR, not the steps AUTHORED — the bet lesson
      shows three of its five at its opening config, which is the app telling the truth about
      config-exclusive steps, now turned into a positive assertion (flip the bet, the rail becomes
      four and they are not the same three). ORIGINAL TEXT:** Drive the
      **shipped bundle** (`vite preview`) through every lesson in the new track via CDP. M11 step 8's
      preconditions are acceptance criteria here, not advice: confirm the built bundle by its
      `/assets/index-*.js` script tag; assert built-bundle + CSS-loaded + a **known-present** control
      before any absence check below it means anything (a production class transform makes a rig
      vacuous in one direction only); assert the transport's halted marker as well as its prefix. Then
      the milestone-specific checks: each lesson opens on `deep-pipeline` with **forwarding ON\*\*
      (`aria-pressed`, scoped — not the first `.seg-btn`), records at the pinned cycle count from the
      dump, the narration rail advances, and the toggle discriminator moves the count the prose says it
      moves. Acceptance: every check passes or every failure is triaged as rig-vs-app in writing.

---

## Acceptance criteria (mirror the spec §11 shape)

- [x] The picker shows a sixth track and its lessons open on the deep pipeline at the declared config.
- [x] Each lesson's steps anchor in order, in at least one config position, with narration at all
      authored tiers, across all 12 swept machines.
- [x] Every cycle count in narration is pinned by an oracle against a recording at the lesson's own
      declared config — including every number quoted about the 5-stage.
- [x] Switching each lesson's `model` to `pipeline` would make its narration false (recorded per
      lesson, as an argument; not necessarily as a test).
- [x] `npm test`, `typecheck`, `lint`, `build`, `format:check` all green (4466 tests).
- [x] The browser pass drove `startLesson`, not the picker, on the shipped bundle.

---

## How this milestone can lie to itself

- **The sweep goes green while the words lie.** M4 step 4's measured failure: four positions, every
  step anchoring in order, and the shell shipping "51 cycles" over a transport reading 49. Anchoring
  survives a config change; prose does not. Oracles are the only net for the words.
- **A lesson that would read identically on the 5-stage.** The whole track is a delta; a beat that is
  true on both machines is content that belongs to `forwarding-bubble`.
- **Counting the dead instead of the cycles.** `sum-loop`'s two-name flush for a four-cycle branch is
  the trap, and it is in the corpus, not hypothetical.
- **Quoting a number from the timing table instead of a recording.** The table is per-config arithmetic
  in a docblock; the lesson is a machine at one pinned config. Read the dump.
- **A browser pass that drives the picker.** M11's 76 checks never clicked `startLesson` — the very
  path its `useSimulator` refactor existed to fix. For a lesson milestone that is not a gap, it is the
  whole subject.

---

## Decisions to pin (seeded with recommended answers) — ALL PINNED 2026-07-28

| Decision                            | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                     | Pinned answer                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Track size                          | **Three lessons + one conditional**: thesis (`ex-latency`), the doubled bet, and the drain (conditional). M8 shipped 4, M10 shipped 4 with one dropped — gates step 1                                                                                                                                                                                     | **As seeded** (user, 2026-07-28) |
| L1's program                        | **`array-sum`** — it is `forwarding-bubble`'s own program, so "51 there, 74 here" is a literal comparison of one program rather than an analogy. Alternative `add` is minimal and shows the bubble in 10 cycles but supports thin prose — gates step 1                                                                                                    | **As seeded** (user, 2026-07-28) |
| L1's declared config                | **`forwarding: true`, `static-not-taken`, `cache: null`** — the inversion IS the lesson; opening at forwarding OFF would make it a second `forwarding-bubble` — gates step 1                                                                                                                                                                              | **As seeded** (user, 2026-07-28) |
| The load-use delta (1→2 cycles)     | **A beat inside L1, not its own lesson** — same program, same config, and a standalone lesson would re-teach what `forwarding-bubble` already teaches — gates step 1                                                                                                                                                                                      | **As seeded** (user, 2026-07-28) |
| L2's program / independent variable | **`sum-loop` with prediction as the variable** (87→73 here vs 56→49 there — the deep machine gains twice as much), and the title says GOOD bet because on `sum-loop` the bets are right. Alternative `paired-branches` (11→19 here, 13→9 there) is the WRONG-bet story and needs the other title — gates step 2                                           | **As seeded** (user, 2026-07-28) |
| Lesson ids                          | **`deep-bubble-survives`, `deep-bet-pays-double`, `deep-drain`** (the third only if step 3 authors rather than drops). Pinned now rather than at authoring time: `content/lessons/index.json` names them and `lessons.test.ts:517` asserts index and library agree exhaustively in BOTH directions, so a later rename is a four-place edit — gates step 1 | **As seeded** (user, 2026-07-28) |
| The drain beat                      | **Ride the last `instr-retire`, or drop with proof** — never a new trace event — gates step 3                                                                                                                                                                                                                                                             | **As seeded** (user, 2026-07-28) |
| Track name and position             | **"The deeper machine"**, after _The cache_, before _The wide machine_ (mirrors the picker's model order; symmetric with "The wide machine") — gates step 4                                                                                                                                                                                               | **As seeded** (user, 2026-07-28) |
| An engine step                      | **No** — the dump found no inert knob, unlike M10. Stated falsifiably at step 0                                                                                                                                                                                                                                                                           | **As seeded** (user, 2026-07-28) |
| A new corpus program                | **No** — the dump shows the existing corpus covers every seeded beat; an addition pays the full INV-8 ripple across six models                                                                                                                                                                                                                            | **As seeded** (user, 2026-07-28) |
| `highlight` on lesson steps         | **Do not start using it.** The field exists on `LessonStep` and **zero shipped lessons use it**; the deep datapath is the most tempting place to start, and starting here would make this track the only consumer of an untested path — gates step 1                                                                                                      | **As seeded** (user, 2026-07-28) |
