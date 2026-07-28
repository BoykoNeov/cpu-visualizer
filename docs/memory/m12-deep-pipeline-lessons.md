---
name: m12-deep-pipeline-lessons
description: 'M12 (the deep-pipeline LESSON track) — ✅ COMPLETE, all steps 0–5 done 2026-07-28. Three lessons on `deep-pipeline`, the first track whose subject is a DELTA against a machine the learner already met. Its browser pass found `Lesson.depthDefault` dead since M1 — all 22 lessons opened at EXPERT prose.'
metadata:
  node_type: memory
  type: project
  modified: 2026-07-28T03:14:25.585Z
  originSessionId: 13562d59-21e9-43d1-a9a3-5b94f76a361e
---

**M12 IS ✅ COMPLETE (2026-07-28)** — `docs/plans/m12-tasks.md`, all steps 0–5, repo **4466 tests**,
five gates green. The track is FINAL at three lessons: `[deep-bubble-survives, deep-bet-pays-double,
deep-drain]` under a new picker track **"The deeper machine"** (after _The cache_, before _The wide
machine_). It closes the gap M11 left — see [[m11-deep-pipeline-planned]] for the model itself.

## THE HEADLINE FINDING, and it is not about this milestone

**`Lesson.depthDefault` was read by NOTHING.** The shell hardcoded `useState<DepthTier>('expert')`
while all 22 shipped lessons author `detailed` — so **every lesson in the product opened on its
EXPERT paragraph**, the six beginner language tours included. It was the THIRD declared-and-ignored
field on `Lesson` (`startLesson`'s own note records `model` and `config` were that until M3 step 8).

**Invisible to every headless test BY CONSTRUCTION, and that generalizes:** those tests assert
narration RESOLVES at a tier — a question about the LESSON. Which tier the SHELL picks is a question
about the shell, and [[browser-is-the-only-net]] applies. Ask of any declarative content format:
**which of its fields does the app actually read?** A field nothing consumes fails silently forever.
Fixed at the picker (depth is a pure view concern, INV-2 — `useSimulator` owns the machine, not the
presentation) and guarded in both rot directions: every lesson declares a tier the renderer knows AND
has narration at it, plus the declared tier must select DIFFERENT prose from the old hardcoded one (a
fix nobody can see is not a fix).

## The design, and what made it different from M8/M10

- **The track teaches a DELTA against a machine the learner has already seen** — the first one to do
  that. Its discriminator, applied to every beat and asserted not argued: **swap `model` to
  `pipeline` and the narration must become a LIE.** At the same knobs the 5-stage stalls ZERO times
  on the branch that stalls five times here.
- **`ex-latency` is a stall reason NO other model emits** (grep-confirmed) — the exact INVERSION of
  M10, whose headline was that nothing discriminated its toggle. It is **forwarding-ON-only**
  (`'raw'` at OFF), which is lawful under the sweep's rule ("every step must anchor in AT LEAST ONE
  position") and is `forwarding-bubble`'s own shape.
- **The flagship toggle runs BACKWARDS.** Every other flagship opens at the OFF position and invites
  the flip that fixes the machine. `deep-bubble-survives` opens at **`forwarding: true`** and the
  bubble is still there.
- **A lesson declares ONE model**, so cross-model comparison is prose only — and prose quoting
  another model's number is protected by NO declaration. That is the M4-step-4 trap one axis over
  (that one: numbers true only under an undeclared PREDICTION scheme; this one: numbers true only on
  an undeclared MODEL). Both machines are recorded in the oracle and **51 is asserted against a real
  `pipeline` recording**.

## Traps worth carrying forward

- **A flush's `stages` array is NOT the penalty, and the corpus proves it two ways.** `sum-loop`'s
  taken branch names TWO casualties and costs FOUR cycles (the `ex-latency` stall above it left
  bubbles in the other two slots); `array-sum`'s identical four-cycle branch names four. Prose that
  counted the dead would be right on one program and wrong on the other **with every anchor green**.
  Narrate a TOTAL; measure it as a cycle DELTA between config positions, never `stages.length`.
- **The sweep's per-position ORDER check earns its keep.** The bet lesson's closing step first
  anchored on the write of `55` — but `a0` reaches its total in the final iteration BEFORE the loop's
  branch is corrected, so under prediction it ran ahead of the wrong-bet beat. Re-anchored on the
  last retire.
- **The rail shows the steps that ANCHOR, not the steps AUTHORED.** The bet lesson shows 3 of its 5
  at its opening config (config-exclusive steps, `branch-bet`'s shape). Expecting the authored count
  reads as an app defect and is not one — turn it into a positive assertion instead (flip the bet →
  the rail becomes 4, and not the same 3).
- **The un-anchorable beat has a lawful home that is not "invent an event".** `deep-drain`'s subject
  is cycle 8 — a cycle containing NOTHING. It anchors on the retires either side and the prose points
  AT the gap ("scrub back one and look"); both facts that instruction leans on are pinned, because
  neither is derivable from the anchors. M10 dropped renaming for this shape; either outcome is a
  success, **inventing an event is the only failure**.
- **`add.s` has no `ecall`** (it runs off the end of `.text`) but the engine **halts anyway**, so the
  transport's halted marker needs no special case.
- **Name what the tool does NOT model.** `deep-drain`'s expert tier says outright that a deeper pipe
  buys a SHORTER CYCLE and that nothing here models cycle time — otherwise a reader who watches every
  pipelined machine lose on cycle count can only conclude the opposite.

## Method notes

- **Run the dump BEFORE writing the plan, not as its first step.** `M:\claud_projects\temp\m12-dump\`
  — every corpus program × both pipeline models × forwarding × prediction, with stalls by pc, flushes
  by reason+`stages`, forwards by `from→to`, plus per-cycle listings. It decided the design. Every
  number that reaches narration must be READ from a recording, never computed.
- **Read the ordered-assertion tests, do not grep their names.** `lessons.test.ts:572` is an
  exhaustive `toEqual` on track names (any insertion is a hard edit); `:593` is pairwise
  `indexOf('The machine') < indexOf('The cache')` and the chosen position passes it. One of them
  could have rejected the pinned track position.
- **One order pin EARNED, one DECLINED**, by the cache track's own discriminator (a pin earns its
  place only if a prose sentence LIES when reordered): machine-before-deeper-machine is earned (a
  sentence calls this stall "the flagship" there); a sequence test WITHIN the track is declined —
  these three are each a delta against the five-stage, not against their neighbour, and
  `deep-drain`'s only backward glance leaves a term unexplained rather than making a claim false.
  **Unexplained is not a lie.**
- Rig: `M:\claud_projects\temp\m12-browser\s5-lessons.mjs` (51 checks). Reaches every lesson ONLY
  through `startLesson`, starting each from `single-cycle` so every assertion is about what the
  lesson dragged. Caption for the prediction control is **`Predict`** (positions `not taken`/`taken`);
  §0's "known-present control" check must select a model that HAS the control first — `single-cycle`
  honors no knobs, so checking there reports the rig broken when its own premise was wrong.
