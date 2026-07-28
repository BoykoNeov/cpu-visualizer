---
name: m3-pipeline-web
description: 'M3 steps 5-8 (web half): the pipeline panel + forwarding toggle, the pipeline datapath SVG, the pipeline map and the below-the-fold defect only REAL scale exposed, and the flagship pipeline lesson that completed M3.'
metadata:
  node_type: memory
  type: project
---

### M3 STEP 5 — WEB: PIPELINE + THE FORWARDING TOGGLE — DONE & pushed (2026-07-16, 554 -> 587)

Commits `849ae6f` (the step) + `92410f2` (the eyeball fix) + `d51eb1a` (docs). Browser-verified via the
standing `vite preview` + raw-CDP ritual (driver: `M:\claud_projects\temp\m3-5-drive.mjs` — reusable).
**78 cycles off -> 56 on, a0=55 in both**, off the live scrub bar: step 3's derived numbers reproduced
through the web's own load path.

- **The step's real work was the config SEAM, which the plan never mentioned.** `loadSource` never passed a
  `ProcessorConfig` at all — `recorder.load` defaulted it internally. Invisible while every model was
  config-blind; wrong the moment one wasn't (the toggle would have re-recorded the identical trace). It now
  takes one, defaulting to neutral so every pre-existing caller is untouched.
- **Forwarding lives at SESSION level and is handed to EVERY model** (not per-model state): a config-blind
  engine is unmoved by it (pinned by test), so one value is correct for all three and survives a trip
  through single-cycle. Persists across model switches; **defaults OFF** (watch the stall first, THEN flip).
  Same state+ref shape `setModel` already used — the ref is what keeps `loadInto` out of the dep chain.
- **`ModelChoice` now carries the engine's own exported `*_CAPABILITIES` constant** so the shell can gate
  config controls WITHOUT instantiating an engine. Not an INV-3 back door: `capabilities` is part of the
  `Processor` interface in `trace` and exists to "let the UI light up only the relevant panels". Guarded by
  `expect(m.make().capabilities).toBe(m.capabilities)` — **identity, not equality**, because the real
  failure mode is a copy-pasted row pairing one model's flags with another's engine.
- **Mutation-checked:** dropping the config on the floor leaves "identical final state" **green** and fails
  exactly the crown jewel + the lesson-shift guard. INV-8's blind spot reproduced at the web layer.
- **The plan's "no further changes (INV-3)" claim held this time** — tested, not trusted. All three
  single-cycle lessons anchor under the pipeline in BOTH positions, first run. The whole risk was one
  question the advisor isolated up front: **does EX emit `alu-op` for branches?** (two anchors depend on it
  — `sum-loop-tour`'s `bne`, `function-call`'s `bge`). It does. Also pinned: **the toggle changes WHEN a
  step fires, never WHAT it fires on** (anchored payloads compare equal across configs, `instr` stripped —
  ids are per-fetch and the positions fetch different numbers of doomed shadows). Non-vacuity for that is
  asserted on `sum-loop`, NOT the corpus — step 3 measured `call-return` at 17 both ways, so its anchors
  don't move at all.
- **`TraceEvent` has no universal `instr` field** — `flush` (casualties live in `stages`) and `cache-access`
  lack it, so you cannot destructure `instr` off the union. Caught by tsc.
- **THE LESSON OF THIS STEP: only the browser eyeball caught the real defect.** Every headless net was
  green while the shell quietly taught the wrong thing — at cycle 4 the pipe holds five instructions and it
  showed exactly ONE, unqualified, under a header promising five. `instructions[0]` is oldest-first = the
  RETIRING instruction, so the chip and source highlight lag the fetch by up to four stages. Lawful
  omission (INV-5), not contradiction — but _misleadingly complete_: it reads as "a pipeline is just a slow
  single-cycle", the exact misconception the tier exists to break. **Fix: qualify the shown instruction
  exactly when `instructions.length > 1`** ("in WB · 5 in flight") — a rule with NO model knowledge in it
  (single-cycle/multi-cycle always carry one so it never appears; the pipeline qualifies itself from the
  trace, INV-3). It turned out to TEACH: scrubbing the fill reads **2 -> 3 -> 4 -> 5 in flight**, one stage
  per cycle — the pipe filling, narrated, before step 6/7 exist.
- **Forwarding doesn't only make the pipe faster — it FILLS it.** A bubble is a `null` latch and never
  appears in `instructions[]`, so an interlocked pipe carries strictly fewer LIVE instructions: `sum-loop`
  tops out at **4** off, **5** on. A second observable of the toggle, independent of cycle count. Scoped to
  `sum-loop` (array-sum/call-return reach 5 in both; `add.s` reaches 5 in NEITHER — only 3 instructions
  exist, so that's **program-bound, not stall-bound**: two causes for one symptom, pinned separately). Found
  because a first draft asserted a flat "the pipeline reaches five" and was wrong — measure, don't assume.
- Two vacuous browser checks nearly shipped in the CDP driver and are worth watching for: reading `a0` from
  `body.innerText` matched the LESSON PROSE (compare prose to prose ⇒ trivially equal), and the
  lesson-config-flip check was a no-op because **forwarding persists across model switches by design**, so
  it was already ON when the lesson attached. Read values from the owning panel's DOM, and reset state
  explicitly before asserting a transition.

### M3 STEP 6 — THE PIPELINE DATAPATH SVG — DONE & pushed (2026-07-16, 587 -> 621, `8f773dd`)

`packages/web/src/datapath-pipeline.ts` (geometry + pure `activate`) + `PipelineDatapathView.tsx`, third
bespoke geometry, `'pipeline'` arm on the `datapath` discriminator. Every geometry invariant passed FIRST
RUN; all three nets mutation-checked. Browser-verified light+dark via the `SNAP` harness + headless Chrome.

- **The architectural shift: activation stopped being single-phase.** M1 lit one instruction's whole path;
  M2 lit its one in-flight instruction's ONE phase — both could paint the lit slice one color _because both
  had one instruction_. Five stage slices for five different instructions ⇒ `DatapathActivation` DROPS
  `phase`; each lit **WIRE** carries `{instr, stage}` — the stage picks the hue, the id is what step 7's
  follow keys on. **The hue is a property of the WIRE, not the diagram.**
- **Component boxes are hue-NEUTRAL, and that is FORCED, not lazy** (the decision the plan never pinned):
  the register file is read by ID and written by WB in the SAME cycle (the same-cycle WB→ID rule), and every
  latch bar is written by the stage on its left while the stage on its right reads it — **there is no one
  stage such a box belongs to**. Wires are unambiguous (each lies on one side of one bar). Needed **zero
  renderer change**: `NodeVM` never had a color, which turns out to be exactly right.
- **The `micro` trap, now the datapath's rule:** occupancy reads `instructions[].location`, NEVER
  `state.micro` (step 4 pinned micro@i = the latches cycle i+1 reads ⇒ sourcing from it draws the pipe **one
  cycle ahead of itself**, and it would pass a naive test). Mutation-checked. **Its honest consequence:
  values riding the latches BETWEEN stages are unlabelled** — a load's `aluOut` was computed while it was in
  EX, a cycle before it sits in MEM, so NO event in the drawn cycle holds it. The view only ever gets ONE
  trace, so this is unfixable, not lazy: lit-without-a-value beats a number one cycle wrong (INV-5).
- **A forward DARKENS the register-file path into its mux** — forwarding is a change of PATH, not an extra
  wire. Lighting both would draw the stale value flowing into the ALU beside the fresh one (the exact
  misconception the tier exists to break) and make one of the two labels a lie. Mutation-checked.
- **Config is a SECOND visibility axis; `maxTier` can't express it.** `node/wireVisibleAt(tier, forwarding)`.
  M2 hand-maintains `maxTier:'essentials'` _alongside_ `contracts:'addrmux'` — two fields that must agree,
  and no scalar cap says "hidden at expert-with-forwarding-off". So **contraction visibility is DERIVED: a
  contraction is drawn exactly when the unit it contracts is not.** `maxTier` dropped entirely; the 2-D
  condition falls out free. Through-wires need no `minTier` either (their mux endpoint already gates them).
- **The hazard unit is NOT config-gated** — easy to get backwards. It is live in BOTH positions (load-use
  survives forwarding; the interlock IS the story without it), so gating it on config would erase the
  interlock from the very diagram meant to explain it. Only fwdunit + its muxes + forward paths gate.
- **A mux with 3 sources needs 3 contractions** (the plan's "same source, same sink" gate says so, and it's
  what M2 already does with its 4-source wbmux) — so each fwd mux gets idex/exmem/memwb→alu, each ending on
  its OWN y along the ALU's operand stub (all three co-visible below expert ⇒ must not share a final run).
- **THE EYEBALL FINDING (again — every headless net was green): the canvas WIDTH is set by the LABELS, not
  the boxes.** The shared renderer de-collides a value label by nudging it **vertically** until it clears
  every box — fine in M1/M2 because their boxes are short, but **a 360px latch bar leaves NO clear y**, so
  hex labels parked on top of it, unreadable. Every gap where a 32-bit hex label lands beside a bar must be
  ~80px (canvas 1200 wide). Commented at `CANVAS` because "those gaps look too wide" is the exact tidy-up
  that would break it. Second half of the fix: **label a value ONCE, where it is the question** — the pc was
  printed 3× in the tightest band (selector→memory→adder all carry it) and the encoding twice (IF + ID).
- **`pcmux` is drawn at EVERY tier** — the pinned lever is only fwd/hazard units, and an always-drawn PC
  selector costs zero contraction wires (vs 3 long feedback wires if tiered). `wbmux` tiers at `detailed`
  (M2's precedent), 1 contraction. Polygon counts pin the structure: 4 essentials / 5 detailed / 7 expert+on
  / **5 expert+off**.
- **Derivation slip the geometry test caught:** `at(bar,'b',4)` anchors at _bar-centre+4_, not _x+4_ — I
  routed four drops 4px off and got diagonals. The axis-aligned invariant is what found it; trust it over
  hand-arithmetic.

### M3 STEP 7 — THE PIPELINE MAP — DONE & pushed (2026-07-16, 621 -> 658, `dd12afe` + paging follow-up)

`packages/web/src/pipeline-map.ts` (pure fold) + `PipelineMapView.tsx` (HTML grid), the established
two-halves shape. Rows = instructions, columns = cycles, cells = the stage occupied that cycle. Every net
mutation-checked; browser-verified via SNAP (light+dark) AND live on `sum-loop` at real scale.

- **The plan OVERSTATED the work, and that is the reusable finding: audit a plan's claims about effort,
  not just its decisions.** It said "renderer deltas 1–4 land here". Honest count: **one**. Delta 1 (hue
  override) already shipped as `WireVM.color`; delta 3 (data-driven legend) shipped with step 6 — forward
  design that actually paid. **Delta 2 (one `<marker>` per hue) is OBSOLETE, not pending** — the arrowhead
  uses `context-stroke`, so ONE marker serves every hue; the planned "marker zoo" would have been worse.
- **"Stage-and-lane-parametric" cost only the HUE KEY.** The stage SET and ROW order fall out of the fold
  anyway, and **stage ORDER is needed NOWHERE** — rows×columns never consults it; only the legend lists
  stages, and first-seen order yields IF→WB free. So the row/column model really does absorb both future
  axes with no API change (as [[future-microarchitectures]] and superscalar-visuals claimed). The one thing
  bought: `stageFamily` (`EX.0`→`EX`, `IF2`→`IF`), so a 7/12-stage model reuses the five validated hues.
- **Parametricity is provable ONLY by hand-built traces** — no engine we ship emits a lane or a deep stage
  set, so a test against our own engine proves the map parametric exactly where it already is. Those cases
  build no engine/recorder/program at all, which makes them also the sharpest proof of "derived purely from
  the trace" (INV-3). Same trick as step 0's stub. (Six stages→3 hues; 7 stages→5 hues; a lane-qualified
  flush must kill `EX.1`'s occupant, not `EX.0`'s — the one place the lane encoding could silently misfire.)
- **Follow lands on WIRES ONLY — the seeded plan was wrong.** superscalar-visuals put `followed?` on BOTH
  VMs; step 6's pinned decision (a box belongs to no single instruction) makes a node counterpart
  impossible — same reason boxes carry no hue. Step 6's `{instr, stage}` per wire is what pays for follow.
- **Follow must RETARGET the transport chip + source line** (`shownInstruction`), or it is map-local
  decoration. And it **clears on a new recording** (ids are per-fetch; the two forwarding positions don't
  fetch the same shadows). Acceptance asserted on ONE cycle with five in flight — the claim is that the
  three surfaces agree with EACH OTHER; three fixtures would prove each can draw a ring and nothing more.
- **The seam, one per view step again: the RECORDING.** Every panel before this is a pure function of the
  CURSOR's cycle; the map folds the whole timeline ⇒ `useSimulator.recorded` is new (2nd consumer of a
  complete recording after `anchorLesson`). The map's GATE is derived too — `hasOverlap`, no model
  knowledge, same shape as step 5's `instructions.length > 1` (verified live: absent on single-cycle).
- **THE MAP CROSS-CHECKS STEP 3's CLOSED FORM, unplanned:** `sum-loop` draws **52 rows in BOTH positions**
  (34 retires + 18 flush casualties) while cells fall 241→197. That IS `cycles = N + 4 + S + 2·T` as a
  picture — N/T are the program (same rows), S the microarchitecture (fewer cells). And the 18 casualties
  are finally legible: **predict-not-taken speculatively fetches `li a7,10` + `ecall` on every one of the 9
  loop iterations and kills them every time.** Step 3 could only count that.
- **EYEBALL FINDING #1 (4th step running), and only at REAL scale:** the map sat **below the fold** (top at
  884px of a 902px viewport) behind the 490px datapath. Moved ABOVE it — structural, not taste: **the map is
  a TIMELINE surface, its playhead IS the scrub cursor**, so it belongs beside the scrub bar. Costs the
  other models nothing (they never render it).
- **EYEBALL FINDING #2: "keep the playhead in view" naively means the MINIMUM scroll**, which pins it flush
  against the trailing edge — technically visible, with the cycles you are scrubbing _towards_ off-screen.
  Re-centre on leaving a margin. Also: set `scrollLeft/Top` directly, NEVER `scrollIntoView` (it scrolls the
  PAGE too).
- **THE ADVISOR'S CATCH — the map needed its OWN cap, for the same reason `TEACHING_MAX_CYCLES` exists, one
  layer down.** No corpus test could see it: the corpus is ≤78 cycles, but the **sandbox** records up to
  50k. The grid declares explicit tracks ⇒ layout costs cycles × rows however sparse the cells. `li t0,500`
  — seconds to type — is **3007 cycles × 2001 rows ≈ 6M grid areas / 2.2MB markup**, and the cap allows 16×
  more: the engine cap's own failure mode ("a frozen tab is worse than a friendly message") reintroduced
  DOWNSTREAM of it, on a recording it had already passed. Fixed by PAGING (`MAX_MAP_CYCLES = 400`),
  **quantized to pages, not centred on the cursor** (a window recentring every scrub slides the grid under
  the reader; a page boundary is a thing you can point at); a pure function of the cursor, fold left whole
  and oblivious (INV-2 — same split as the datapath). 400 >> the whole corpus ⇒ paging is strictly a sandbox
  affordance, pinned by a test. **Pages, never truncates:** header states window AND total, ruler keeps
  ABSOLUTE cycle numbers so the map can't disagree with the scrub bar. Worst case the engine cap allows
  (48,010 × 32,002): fold 48ms, render 86ms, 303KB, 400 tracks. **The generalizable lesson: when you add a
  surface downstream of a cap, ask what the cap still lets through.**

### M3 step 8 — THE FLAGSHIP LESSON, and M3 is COMPLETE (658 → 685 tests, 2026-07-16)

`content/lessons/forwarding-bubble.json` — "Watch the bubble vanish". **Zero new lesson-format fields, zero
engine changes, zero renderer changes: the flagship deliverable of the milestone is a JSON file.** That is
the milestone's own thesis paying out — everything M3 built to be oblivious turned out to be oblivious.

- **The one real idea: the lesson's steps are CONFIG-EXCLUSIVE, and that IS the lesson.** The pinned
  vocabulary settles it before authoring: `stall.reason:'raw'` fires only forwarding-OFF, `'load-use'` and
  `forward` only ON. So a lesson about a stall that disappears **must** have steps dead in one position —
  there is no honest authoring of the experiment where every step fires in both. Reads like a format gap;
  isn't: `narrationView` already drops never-fired steps, `activeStepAt` already skips null anchors ⇒ the
  flip works **FREE**, the rail's middle two beats **swap**. Only the VALIDATOR was broken. A
  `LessonStep.requires` field was designed and **REJECTED BEFORE BEING WRITTEN** (3rd field M3 declined,
  after `maxTier` and delta 2) — `model`+`config` already said it.
- **The acceptance line was CORRECTED before authoring:** "anchors in both configs" read literally forbids
  the lesson it asks for. Means per-config: _in each position, the steps that apply anchor in order._
- **The program was FORCED, not chosen.** `array-sum` is the only corpus program whose load-use stall
  survives forwarding, and it carries both halves on **source-visible** lines (deliberately NOT the `la`
  pseudo-op's hidden RAW — a learner sees one instruction there):
  `add a0,a0,t2` (pc 20): raw×2 → **load-use×1 + forward** = the bubble that SHRINKS (10 stall cycles → 5);
  `bnez t1,loop` (pc 32): raw×2 → **forward, 0 stalls** = the bubble that VANISHES.
- **THE SEAM (4th view step running to have one): `startLesson` ignored `lesson.model` AND `lesson.config`**
  — declared-and-honored-by-nobody since M1, same shape as `ProcessorConfig.forwarding` pre-M3. Pinned as
  pure **`lessonOpening`** in `session.ts`. **The asymmetry is the finding: `model` ALWAYS honored;
  `config` only when DECLARED** (position is session-level and persists ⇒ `undefined` = "no opinion", NOT
  "use default" — and `defaultConfig().forwarding===false`, so a naive fallback looks right in the common
  case and clobbers exactly the user who turned it ON).
- **Honoring `model` fixed a bug that outlived M2, and reframes the cross-model suite: ANCHORING IS NOT
  TRUTH.** A lesson's anchors survive a model swap (INV-6, pinned since M2); its NARRATION doesn't —
  `sum-loop-tour` says its add is "written back to a0 in the same cycle", **false on both other models**.
  No anchoring test can see that. The suite proved the anchors port and was read as the lesson porting.
- **Validator SCOPED, not weakened — DERIVED not declared:** drive each lesson under its **declared** model,
  across every position that model **honors** (`capabilities.configurableForwarding` — the shell's own
  toggle gate ⇒ suite and UI can't disagree); every step alive in **≥1**; order + shared-cycle guard **per
  recording**. Degenerates with no special case: 1 position ⇒ "≥1" IS the old strict rule; 2 ⇒
  config-exclusivity lawful, typo (dead in BOTH) still fails.
- **The sweep structurally can't see WHICH hazard a step points at (array-sum stalls at 3 pcs) ⇒ pedagogy
  asserted by PC**, resolved via the recording's own `instr-fetch` (ids are per-fetch, meaningless across
  recordings). **That is what makes `nth` reviewable** — `nth:3` becomes a claim about _which hazard_.
  Mutation = the one a reasonable author hits first (`nth:3`→`1`, sliding onto the `la`): **sweep fully
  green, one oracle fails `expected 4 to be 20`.**
- **5th STEP RUNNING THE BROWSER EYEBALL CAUGHT WHAT NO TEST DID:** the flagship lesson rendered `**not**`
  as four **literal asterisks**. **Narration is plain text + exactly ONE construct — the backtick code
  span** — a rule living nowhere but in the 4 lines of `renderNarration` that split on backticks. The
  structural gap: **every test asserted narration RESOLVES (a string comes back at the tier); none asserted
  it RENDERS.** Fixed by **SUBTRACTION, not by teaching the renderer Markdown** — 3 lessons prove the
  vocabulary sufficient ⇒ the 4th was the outlier in _style_, not need; enriching for one lesson splits the
  library into two formatting tiers = inconsistency, not richness. The rewrite is better prose anyway:
  "the bubble that does **not** vanish" → **"Here is the stall that survives forwarding"**. _Structural
  emphasis beats bold; load-bearing meaning must not rest on `<strong>`._ Guard is narrow: strip code
  spans, forbid `*`. A stray `\n` merely collapses to a space ⇒ NOT flagged — **pin what breaks, not what
  one author would have done differently.**
