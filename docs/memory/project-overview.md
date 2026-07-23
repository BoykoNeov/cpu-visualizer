---
name: ''
metadata:
  node_type: memory
  originSessionId: a815d42f-90e2-43a9-a50b-4b0639ffaef7
  modified: 2026-07-23T03:28:17.919Z
---

**CPU Visualizer** — a pedagogical RISC-V (RV32I) processor simulator. Load/run programs
and watch how a CPU works across a family of microarchitectures (single-cycle → … →
out-of-order), along two orthogonal axes: microarchitecture tier and explanation depth
(`essentials`/`detailed`/`expert`). The product is pedagogical clarity, not realism.

- **Design contract:** `cpu-visualizer-spec.md` in the repo root. Load-bearing: the
  architectural invariants (§3, INV-1..INV-8) and the trace schema (§5). Surface conflicts
  with these rather than working around them.
- **Repo:** https://github.com/BoykoNeov/cpu-visualizer (public, **BNCL-1.0** non-commercial —
  switched from MIT). Working dir: `M:\claud_projects\CPU Visualizer`. Default branch `main`;
  commits go straight to `main` and are pushed immediately ([[feedback_commit_and_push]]).
  CI = GitHub Actions (lint/format/typecheck/test/build).
- **Stack:** TS monorepo on **npm workspaces** (not pnpm — see [[best-practices-source]]),
  Vite + React (web), Vitest. Packages: isa, assembler, trace, curriculum,
  engine/common (shared `toProgramImage`), engine/conformance (test-only INV-8 harness),
  engine/reference, engine/single-cycle, engine/multi-cycle, web. Dependency DAG enforced by
  ESLint import-boundary rule + tsconfig project references (incl. cross-model isolation).
- **Status as of 2026-07-01:** Milestone 1 **steps 0–10 complete and green (322 tests).** The
  whole headless engine path is done: `isa` (40-op decoder+encoder, round-trip by construction)
  → `assembler` (two-pass, pseudos + `.text`/`.data`, **memory map** `TEXT_BASE=0x0` /
  `DATA_BASE=0x1000_0000`, INV-7) → `engine/reference` (golden interpreter, hand-oracle tested)
  → `engine/single-cycle` (first `Processor`, emits `CycleTrace`, independent per-cycle snapshots)
  → `trace` `TraceRecorder` (forward/back/scrub cursor over recorded snapshots; never re-runs the
  engine) → **step 6 differential tests** (single-cycle ≡ reference final reg+mem on every
  `content/programs/*.s`, INV-8, hand-computed oracles; corpus = **five** programs) → **step 7
  `web` shell** (React + `useSimulator`: recorder in a ref + tick-counter re-render; all panels
  read `recorder.currentState()`/`current()` live so scrub always matches the trace; source↔code
  / registers / data-memory panels — memory filtered to `>= DATA_BASE`; corpus loaded via
  `import.meta.glob` of the real `.s` files, INV-7) → **step 8 SVG datapath view**
  (`packages/web/src/datapath.ts` = pure geometry + `activate(CycleTrace)`; `DatapathView.tsx` =
  SVG that lights the active path and labels wires with live values; **decode-driven topology,
  event-driven values** so `lui`/`jal`/`auipc` still light a full path; within-cycle phase stepper
  Fetch→…→Writeback derived from event order — **no `PhasedEvent` schema change**, the step-5
  deferral held) → **step 9 depth-tier rendering** (three tiers on the datapath, axis B / §4).
  **Key lesson: on single-cycle we tier the _representation_ (§4 layer 2), NOT the structure.**
  The first cut hid boxes at lower tiers, but headless-Chrome screenshots of the lit path exposed
  an INV-5 **contradiction** — every box is on the active path for some instruction, so hiding one
  dangles a lit wire (`lui`: value at the writeback mux from nowhere; `addi`: "ALU made 5 from one
  operand"). Rejected box-hiding; the tiered layer is now labels over tier-invariant geometry:
  essentials = bare lit path (no value labels), detailed = + wire value labels, expert = + mux
  control labels (`ALUSrc`/`MemToReg`). Lawful by construction (each tier only ADDS). `activate`
  stays tier-oblivious (INV-2); `showValueLabels`/`showControlLabels` are pure policy helpers. The
  `minTier: DepthTier` mechanism (from `curriculum`) + `ends:[a,b]` on wires (display `id` does NOT
  name endpoints — `regfile-rs2`→`alusrc`) are kept but **unused on single-cycle** — reserved for
  the pipeline tier (forwarding/hazard units aren't on every path). `DepthDial` in the header,
  default `detailed`. Then **step 10 `curriculum`** (lesson format + runner + event-anchoring, INV-6):
  `lesson.ts` = declarative FORMAT (`LessonTrigger` = `event`+`nth?`+`where?`; `Lesson` gained
  `config?`), `runner.ts` = the anchoring RUNNER, `index.ts` a barrel. `where` is a **declarative
  shallow-equality object** (serializable DATA, NOT a function predicate — §13); absent key →
  `undefined`, no throw. Anchoring is the STATIC step (`anchorLesson`→`AnchoredStep[]` with
  `{cycle,eventIndex}|null`); tier is a LIVE dial so narration is a separate PURE query
  (`narrationFor`→`resolveNarration`, no re-anchor; no stateful class, memo-friendly). `activeStepAt`
  resolves by **`(cycle,eventIndex)` position not authoring order** (same-cycle: later event wins) and
  **skips unanchored steps**. Non-monotonic anchors = authoring bug: query path graceful, dev-time
  `anchorOrderViolations` flags them. PRECONDITION (doc'd): anchor a COMPLETE recording (recorder is
  lazy; `runToEnd()` first). Tested with **hand-built `CycleTrace[]` fixtures** (DAG forbids importing
  an engine — one fixture mirrors real single-cycle event order); **real-engine integration test
  waits for step 11**. `curriculum` still depends only on `@cpu-viz/trace` (no new dep). Key resolved
  decisions: Int32 canonical GPRs; `ecall`/a7=10 halt (print deferred); `Processor`+`ProgramImage`
  live in **`trace`** (`toProgramImage` adapter in single-cycle); `SparseMemory` hoisted to `trace`.
  **Step 11 IN PROGRESS (2026-07-13):** the **runaway-guard** sub-task is DONE (325 tests) — the
  recorder's `maxCycles` cap on `runToEnd`/`scrubTo` was wired into the web: `useSimulator` threads a
  50k `TEACHING_MAX_CYCLES` through `select`'s up-front `runToEnd` (+ exposed `runToEnd`/`scrubTo`),
  catches the overflow throw (only `select` can throw today), discards the non-halted recording, and
  surfaces a new `runtimeError` channel (mutually exclusive with assembler `errors`) rendered as a
  `NoticeBox`. The **author 2–3 lessons** sub-task is also DONE (2026-07-13, 338 tests): three
  declarative-JSON lessons in `content/lessons/` (`sum-loop-tour`, `array-in-memory`, `function-call`),
  each referencing a corpus program by base name (INV-7, mirrors `content/programs/*.s`), single-cycle,
  `depthDefault: detailed`, 4–5 event-anchored steps with per-tier narration. Anchors are the exact
  events `processor.ts` emits (final total = `reg-write reg:10 nth:11`; loop-back = `alu-op op:'bne'`;
  negative element = `mem-read where:{value:-4}` — safe because `SparseMemory.readWord` returns signed
  int32; `jal` linkage = `reg-write reg:1`). Lessons are UNTRUSTED JSON (typos fail silently), so the
  **promised step-11 real-engine integration test landed** in `web` (`packages/web/src/lessons.test.ts`):
  drives the REAL single-cycle engine (curriculum's own tests use hand fixtures; DAG forbids an engine
  dep) and asserts every step anchors non-null + in order (`anchorOrderViolations` empty) + narration
  resolves at `depthDefault` + program exists, plus per-lesson payload oracles (55/120/42, −4, ra=12).
  Web loads them via `lessons.ts` (globs `content/lessons/*.json`, mirrors `programs.ts`). Needed one
  small `trace` addition: **`TraceRecorder.recorded`** — a read-only getter for the full `CycleTrace[]`
  (the runner anchors against a complete recording; the recorder previously exposed only the cursor's
  cycle). The **sandbox-fork-on-edit** sub-task is also DONE (2026-07-13, 348 tests): the spec §13 fork
  modeled as a **pure tagged-union `Session`** (`packages/web/src/session.ts`: `example`|`lesson`|`sandbox`
  - `exampleSession`/`lessonSession`/`forkToSandbox`), so "annotations detach" is unit-tested off the UI
    (`session.test.ts` — `forkToSandbox` clears the active lesson but keeps `origin` for resume/revert).
    `useSimulator` swapped `programName` state for a `Session`; the old `select` body became a shared
    `loadInto(source)` and `select`/`startLesson`/`loadEdited` differ ONLY in the session set first — so the
    sandbox drives the SAME recorder path as any corpus program (why "still animates" holds by construction,
    INV-3). Added `activeLesson`/`sandbox`/`loadedSource` (source panel shows the LOADED program so a
    sandbox's source↔code stays consistent) + a `loadGen` token (bumped on select/startLesson, NOT on edits)
    so the editor reseeds on same-program re-select yet preserves an in-progress edit. `App` gained an
    editable-source panel (explicit **Run edit**, never on-keystroke), a **Lesson** picker, and a
    **ModeChip** (Free play/Lesson/Sandbox); the editor stays reachable on assembler errors. Proven
    headlessly vs the REAL engine (`sandbox.test.ts`: a mid-lesson edit detaches yet the edited sum-loop
    records to its own result 15 + time-travels; an infinite-loop edit trips the teaching cap).
    (Sandbox verification caveat, since resolved for the app generally: the interactive click-through was
    not captured against the Vite **dev** server — HMR socket never idles — but a **`vite preview`** static
    build DOES settle for headless-Chrome CDP, which is how the narration panel below was browser-verified.)
    Finally the **UI narration panel** sub-task is DONE (2026-07-13, 356 tests) — **Milestone 1 is complete.**
    A blue lesson card sits between the transport and the datapath, shown only while a lesson is attached: it
    surfaces the step active at the cursor with narration resolved at the current depth tier (INV-5), a
    clickable numbered step rail, and Prev/Next-step controls that **scrub the timeline** (so advancing a step
    animates datapath+registers+source in lockstep). `useSimulator` exposes `anchoredSteps` (memoized
    `anchorLesson` against the recorder's COMPLETE `recorded` trace); a scrub/tier change RE-QUERIES the
    cached anchors, never re-anchors. The panel's view-model is a pure headless-tested helper
    (`packages/web/src/narration.ts` + `narration.test.ts`, 8 tests, hand-built `AnchoredStep` fixtures like
    `session.ts`): `narrationView(anchored, cursor, tier)` delegates active-step/tier logic to the runner
    (`activeStepAt`/`resolveNarration`) and adds only timeline ordering (`(cycle,eventIndex)` tie-break) +
    prev/next scrub targets; never-fired steps drop from the rail. Backtick names render as inline `<code>`.
    This ALSO closed the narration half of the depth-tier acceptance (§4 axis B). **Browser-verified** via a
    raw-CDP driver (Node 24 global `WebSocket`, no puppeteer) over `vite preview`: selected the lesson,
    clicked Next to "Step 3 of 5", screenshotted the coherent panel+datapath, then toggled to Essentials and
    saw the narration collapse to its one-line variant. Live checklist with full per-step notes + decisions:
    `docs/plans/m1-tasks.md`.

\*\*M2 ALL STEPS BUILT (0–5b) & pushed (2026-07-13, 429 tests). Model (0–4) + web model picker (5a)

- bespoke multi-cycle datapath SVG (5b) all done; 5b is implemented + headlessly tested but its
  LAYOUT is not yet browser-verified (this project eyeballs web work via `npm run dev`). One
  deliberate simplification carved out as possible step 5c — see the 5b block below.**
  The **multi-cycle model\*\* (spec §12.1) is implemented and fully proven headlessly;
  `docs/plans/m2-tasks.md` has the live checklist + pinned decisions. What landed:

* **Step 0** — hoisted `toProgramImage` → new leaf **`@cpu-viz/engine-common`** (`← isa, assembler,
trace`); both engines share it; single-cycle production no longer imports the assembler.
* **Step 1** — extracted the INV-8 harness → test-only **`@cpu-viz/engine-conformance`**:
  `runConformance(modelName, () => Processor)` owns the corpus + `expectEquivalent` + the
  model-independent `RESULT_ORACLES`, imports no engine-under-test. Single-cycle's differential
  suite shrank to one call.
* **Step 2** — **`@cpu-viz/engine-multi-cycle`** (`MultiCycleProcessor`, `← isa, trace`). One
  instruction in flight; each `step()` advances ONE phase (IF/ID/EX/MEM/WB) with a stable id
  (INV-4) and per-cycle `micro` latches. **Phase set is STATIC per opcode class** (not runtime):
  IF+ID universal; EX iff main ALU used; MEM iff memory touched; WB iff a reg is written. So
  **load=5, R-type/I-ALU/jalr=4, store=4, branch=3, jal/lui/auipc=3 (no EX — they emit no alu-op,
  echoing M1), ecall/ebreak/fence/unknown=2** — the §12.1 varying-cycle-counts headline. Effect
  plan computed eagerly at fetch but **committed at the natural phase** (mem@MEM, reg@WB,
  pc/halt@retire) so per-cycle snapshots read right; jalr target uses pre-write rs1 (rd==rs1 safe).
  ISA idioms copied VERBATIM from the reference (NOT imported — eslint-enforced). `micro =
{phase, ir, a, b, aluOut, mdr}` (exported `MultiCycleMicro`), independent per-cycle snapshot.
  **38 hand-derived unit tests are the real verification** (differential only checks final state).
* **Step 3** — 3-line differential test via the shared harness: multi-cycle ≡ reference on all 5
  corpus programs (INV-8), proving "varying cycle counts, identical final state."
* **Step 4** — recorder time-travel integration + first REAL INV-4 payoff: `follow(id)` returns a
  load's full IF→ID→EX→MEM→WB walk across its cycles (the model-agnostic `TraceRecorder` needed
  zero change).
* **DAG/eslint:** cross-model isolation rules added (each model imports no other model's production
  code; multi-cycle also may not import the reference). Flat-config gotcha handled throughout:
  last-match-wins per rule id means each specific `files:` override must REPEAT the generic
  curriculum/web guard (superset) — closed a latent gap in the old `reference/**` rule too.

**Step 5a — WEB MODEL PICKER — DONE (2026-07-13, commit `feat(web): model picker`).** A **Model**
`<select>` (single-cycle | multi-cycle) in the header. Mechanism is one substitution (INV-3):
`packages/web/src/models.ts` = the model registry (`{id, label, description, make, hasDatapath}`);
`loadSource(source, makeProcessor = () => new SingleCycleProcessor())` takes an engine factory
(default keeps every one-arg caller — e.g. `simulator.test.ts`/`lessons.test.ts` — working);
`useSimulator` holds `model` in **state** (for rendering) + the factory in a **ref** so `loadInto`
reads it at call time WITHOUT `model` entering `select`'s dep chain (else the mount effect refires
and clobbers the loaded program — the load-bearing React idiom here). `setModel(id)` swaps the ref
and re-loads `loaded.current.source` under the new engine, keeping the session/lesson and parking
the cursor at pre-run (no in-place engine swap in a recorder). The transport/register/memory/source
panels, scrub, lessons, and sandbox-fork all work **unchanged**. The single-cycle SVG datapath is
gated **hard off** for models without `hasDatapath` — lighting its single-cycle geometry with a
multi-cycle trace would draw a CONTRADICTORY picture (INV-5), so multi-cycle shows a placeholder
pointing at 5b (advisor flagged this as correctness, not cosmetics). Two non-vacuous test additions:
`simulator.test.ts` proves the swap is REAL (multi-cycle records strictly MORE cycles than
single-cycle for the same program, both land a0=55, INV-8); `lessons.test.ts` proves **INV-6
cross-model** — every authored lesson still anchors, in order, with resolvable narration, against
the multi-cycle recording (events not cycles ⇒ the model swap strands no step; confirmed it fully
works, not just degrades gracefully). Wiring: engine-multi-cycle added to web `package.json` +
`tsconfig.json` paths + `vite.config.ts` alias (web is `noEmit`+`paths`, no project `references`;
no web eslint allowlist since web is top-of-DAG). Also a small `chore(format)` commit reflowed
`m1-tasks.md` so CI `format:check` is green.

**Step 5b — BESPOKE MULTI-CYCLE DATAPATH SVG — BUILT (2026-07-13, 429 tests; layout browser-verify
pending).** New `packages/web/src/datapath-multi.ts` (pure geometry + phase-driven `activate`) +
`MultiCycleDatapathView.tsx` (SVG), mirroring M1's `datapath.ts`/`DatapathView.tsx` split. 14 nodes:
the **five inter-cycle latches** IR/A/B/ALUOut/MDR drawn as boxes (1:1 with `micro`), the **shared
Memory** (fetch@IF, data@MEM, via an IorD address mux) and **shared ALU**, `regfile`, `signext`, and
a small dedicated `pcarith`. Key differences from single-cycle, all load-bearing:

- **Activation is PHASE-DRIVEN.** Each multi-cycle `CycleTrace` is ONE phase (`instructions[0].location`),
  so `activate` lights only that cycle's slice — values from the phase's events, latch values from
  `state.micro` (cast from `MachineState.micro: unknown`). **No view-local phase stepper** (single-cycle
  had one because all 5 phases happen in one tick); scrubbing the transport IS the phase walk, and a
  read-only phase badge shows the current phase.
- **`minTier` STRUCTURAL hiding finally earns its keep** (M1 kept it wired-but-unused). Three genuine
  selector muxes — `addrmux`(IorD), `alusrcb`(ALUSrc), `wbmux`(MemtoReg) — set `minTier:'detailed'`,
  hidden at `essentials`. To keep the no-dangling litmus, each hidden mux is replaced at essentials by
  a **contraction wire** (e.g. `pc→mem` for `pc→addrmux→mem`). Wires gained `minTier`/`maxTier` RANGES:
  through-mux wires are `minTier:'detailed'`, contraction wires `maxTier:'essentials'` + a `contracts:<mux>`
  tag. `wireVisibleAt` generalizes M1's litmus **per tier** (in-range AND both ends visible at that tier).
  The five latches + shared mem/ALU + `signext` stay drawn at EVERY tier (they ARE the story — advisor
  explicitly endorsed keeping `signext` visible rather than tiering it, which would force a misleading
  `ir→alu` contraction). Representation tiers (values@detailed, control labels@expert) apply as in M1.
- **INV-5 lawfulness gate:** a contraction `S→T` must equal the expert path `S→mux→T` (same source, same
  sink) — checked by a test that finds the two through-wires. This is _the_ acceptance condition.
- **Dispatch:** `ModelChoice.hasDatapath:boolean` → `ModelChoice.datapath:'single-cycle'|'multi-cycle'|'none'`;
  `App` renders `<Datapath>` / `<MultiCycleDatapath>` / placeholder accordingly (placeholder now only backs
  `'none'`).
- **~~DELIBERATE SIMPLIFICATION → possible step 5c~~ — DONE 2026-07-20, see the STEP 5C block at the
  end of this file.** (Was: the datapath does NOT draw the next-PC redirect, because the engine emitted
  no `alu-op` for PC arithmetic and a textbook ALU-based PC path would CONTRADICT the trace.)
- **Tests** (`datapath-multi.test.ts`, 16): per-phase activation for load/branch/store/lui/jal driving the
  REAL `MultiCycleProcessor` via the recorder; per-tier no-dangling; mux-hiding; contraction↔through swap;
  lawful-contraction guard; **node-bounds + no-overlap layout guards** (the only automatable slice of
  visual acceptance — legibility/wire-crossings still need `npm run dev`).

**~~Only remaining M2 loose ends~~ — BOTH CLOSED 2026-07-20 by step 5c** (the 5b layout was
browser-verified in the same session and had no defect).

**VISUAL-LAYER OVERHAUL + FUTURE-PLAN TEMPLATES — DONE & pushed (2026-07-14, 435 tests, 4 commits
`4e6543a..53b1d52`).** "Improve visuals/visualization and bake templates" batch:

- **Theme tokens + dark mode:** `packages/web/src/styles.css` is now the SINGLE source of color truth —
  CSS custom properties (surfaces/ink/accent/status/highlight + per-phase hues), dark set applied under
  BOTH `prefers-color-scheme` and an explicit `data-theme` stamp (`:not([data-theme='light'])` guard so
  the toggle wins both ways; pre-paint stamp script in `index.html`; persisted `cpu-viz-theme` key).
  `theme.ts` = `T.*` var() tokens + `MONO` + `PHASE_COLORS` + toggle helpers; App header gained an
  auto→light→dark `ThemeToggle`. App.tsx/panels.tsx contain ZERO hard-coded hexes now (grep-verified);
  shared `.panel/.panel-heading/.btn/.btn--primary/.seg/.seg-btn` classes replaced repeated inline styles.
- **Phase palette (pedagogical + future pipeline stage colors):** 5 hues for IF/ID/EX/MEM/WB = dataviz
  reference palette slots 1–5, machine-validated with the dataviz skill's `validate_palette.js` for BOTH
  surfaces (light: all pass, aqua/yellow sub-3:1 ⇒ relief rule — chips always text-labeled; dark: CVD
  10.3 floor-band, legal with direct labels). Ordering is the CVD-safety mechanism — don't reorder.
- **Shared `DatapathDiagram.tsx` renderer (the code template):** extracted the ~200 duplicated lines from
  the two datapath views. It owns ALL drawing (box/mux/notched-adder shapes, arrows, **animated dash flow
  overlay on active wires** showing direction — `prefers-reduced-motion` disables, value/control labels,
  legend, theming via `.dp-*` classes); model views are now thin POLICY wrappers mapping
  geometry×activation×tier → `WireVM[]`/`NodeVM[]` (+ unique `markerPrefix`). `PhaseChips<P>` = shared
  phase row: interactive stepper (single-cycle) or passive track (multi-cycle), hue via `--seg-accent`.
  New `DatapathDiagram.test.tsx` (6 tests): headless `renderToStaticMarkup` smoke — active classes light,
  labels gate by tier, control labels expert-only, multi-cycle mux polygons 2@essentials vs 5@detailed.
- **Docs templates:** `docs/plans/plan-template.md` (milestone-plan skeleton distilled from m1/m2 house
  style: status banner, headline decision, testable build order, §11-shaped acceptance, pinned-decisions
  table) and `docs/templates/new-model-datapath.md` (6-step playbook for a new microarchitecture: engine
  package+DAG wiring → conformance+recorder proofs → models.ts entry → pure geometry/activation with tier
  levers + coherence/contraction litmuses → DatapathDiagram wrapper, no-new-colors-in-TSX rule → INV-6
  lesson hooks).
- **Visual polish still to eyeball via `npm run dev`:** the new theme/animation AND the standing 5b
  layout check (they can be done in one pass; dark mode needs the toggle clicked too).

## SUPERSCALAR VISUALS PLAN — written & pushed (2026-07-14, commit 239f87e)

`docs/plans/superscalar-visuals.md` — pre-milestone design for the superscalar (roadmap tier 4) visual
layer, written early so the PIPELINE milestone (M3) builds lane-parametric primitives. Core ideas: three
surfaces (lane-tinted datapath / NEW stage×cycle pipeline map as HTML grid, phase-hue cells / NEW
`MicroTablePanel` HTML tables for micro-state, ROB-ready); 4 small backward-compatible DatapathDiagram
deltas (`hue?` VM override via `--dp-hue` custom prop, per-hue markers, data-driven legend, `followed?`
follow-highlight); lane tokens `--lane-0`=accent blue, `--lane-1`=magenta #e87ba4/#d55181 —
machine-validated both surfaces (ΔE 41+/42+, light magenta 2.62:1 ⇒ relief rule mandatory). Pipeline map +
follow-highlight + renderer deltas land at M3; lane tokens/wide geometry/IPC tile at the superscalar
milestone; ROB/RS/rename explicitly deferred to OoO. Decisions table seeded (dual-issue, 1 mem port,
`"<stage>.<slot>"` location encoding).

## DATAPATH SCHEMATIC OVERHAUL — DONE & pushed (2026-07-14, 441 tests, 3 commits `72a4afe..2c45174`)

User ask: "color different paths in different colors so they're distinguishable; arrows only at
0/90/180/270; arrows start from an element edge (not blank space); labels/arrows don't obscure each
other." Applied to BOTH `datapath.ts` (single-cycle) and `datapath-multi.ts`, via the shared
`DatapathDiagram.tsx` renderer. All four requirements now mechanically guarded by tests, not just eyeball.

- **Color = PHASE** (the one real interpretation fork — surfaced to the user). Each active wire is stroked
  in its within-cycle phase hue (`PHASE_COLORS` IF/ID/EX/MEM/WB), so the five stages read as five
  distinguishable paths and match the phase chips. Single-cycle colors per `wire.stage`; multi-cycle per
  `act.phase` (a whole cycle = one phase = one color). Threaded through stroke, ONE `context-stroke`
  arrowhead marker (inherits each wire's color — Chrome-verified), value-label ink, and a phase color-key
  legend (`legend?: LegendItem[]` prop; the chips only show hue when active, so the datapath needs its own
  key). Per-wire unique colors was rejected — 22 hues can't stay "easily distinguishable" (CVD).
- **Orthogonal + edge-anchored geometry rewrite.** Layout contract (in each file's header): main dataflow
  band on a fixed centerline, shaped nodes connect ONLY on vertical edges — muxes in-left/out-right, adders
  on the two notch stubs (`aUp`/`aLo` helpers) + right output; feedback/select buses ride clear top (y<~60)
  and bottom (y>~440) rails. `shapePolygon` in the renderer is now the SINGLE source of truth for node
  outlines (NodeShape draws from it; tests hit-test endpoints against the REAL perimeter — the old
  bounding-box edge test passed points sitting in a trapezoid's blank corner). All wire ids/`ends`/tier
  machinery (minTier/maxTier/contracts) preserved; multi-cycle contraction-lawfulness still green.
- **Label de-collision** (`layoutLabels`): each value label anchors on its wire's LONGEST segment, clamps
  inside the canvas, and nudges vertically until it clears BOTH earlier labels AND component boxes. Two
  short redundant PC connectors (`pcsel-pc`/`pc-imem`) are left unlabeled (PC addr already on `pc-add4`).
- **Geometry invariants added to both suites:** every segment axis-aligned; every endpoint on the drawn
  perimeter; and (advisor's catch — the decisive one) **no two simultaneously-drawn wires run collinearly
  on top of each other** ("arrows don't obscure arrows" — invisible to eyeball since all wires draw every
  frame; multi-cycle buckets by tier so contraction↔through pairs aren't false-flagged). The last test
  caught one real 20px overlap (the two ALUSrc contractions into the ALU lower stub) — fixed.
- **Verification loop (not committed — local dev tool):** `packages/web/src/_snap.render.test.tsx`
  (gated behind `SNAP=1`) renders the REAL components via `renderToStaticMarkup` → HTML with `styles.css`
  inlined → headless **Chrome** `--screenshot` (Edge absent on this box; Chrome at
  `C:\Program Files\Google\Chrome\Application\chrome.exe`). PS driver `M:\claud_projects\temp\shoot.ps1`.
  Verified light+dark across lw/sw/jal (single-cycle) and every phase IF..WB + jal-WB (multi-cycle).
- **Accepted limitation (told the user):** labels avoid boxes + each other but may cross an unrelated idle
  wire (opaque box briefly occludes a grey line); not fixed because avoiding all non-owned wires risks
  pushing a label ambiguously far from its own wire. Node active-fill stays accent-blue (nodes aren't paths).
- This substantially closes the long-standing "browser-eyeball the datapath layout" loose end for BOTH the
  5b multi-cycle layout and the theme/animation pass — the datapath schematic is now screenshot-verified.

## M3 (5-STAGE PIPELINE) — PLAN pushed 2026-07-16 (8c8c596); **STEPS 0, 1, 2 DONE** (457 -> 501 tests)

`docs/plans/m3-tasks.md`, from `plan-template.md`. CLAUDE.md's "current work plan" pointer now names it
(was still M1). **The pipeline model now EXISTS** (see the steps 1-2 block at the end of this section).
Non-obvious things the planning turned up — these are the reasons the plan is shaped as it is, not
restatements of it:

- **INV-8 is structurally blind to timing** (advisor's decisive catch). Conformance compares only final
  architectural state, so a pipeline that OVER-stalls (e.g. ignores `forwarding:true`, interlocks on
  every RAW) is **correct-by-INV-8 and silently wrong**. Under-forwarding gets caught (stale read ⇒ wrong
  answer); merely-slow does not. The forwarding toggle's whole observable effect lives in that blind spot
  ⇒ hand-derived cycle-accurate timing tests are their OWN build step (3), never an acceptance line on
  the model step. Mirrors how M2 pinned its per-class cycle-count table.
- **Step 0 was forced, not optional — ✅ DONE 2026-07-16 (440 → 457 tests).** `runToHalt` hardcoded
  `defaultConfig()` and self-documented as "config-agnostic on purpose" (right for two config-blind
  models); left alone it would have proven the pipeline correct **only with forwarding off**.
  `runConformance` now takes an optional third arg (readonly `ProcessorConfig[]`, default
  `[defaultConfig()]` ⇒ both existing `differential.test.ts` files byte-for-byte untouched) and runs the
  corpus once per config, labelling the `it()` title only when there's >1. **The transferable lesson is
  about how the harness was made testable:** the two things that could silently go vacuous were extracted
  as directly-assertable units — `checkProgram(makeProcessor, config, file)` (throws; the per-pair check)
  and `conformanceCases(configs)` (pure data; the matrix enumeration) — both exported from the module but
  NOT from `index.ts`, so models still see only `runConformance`. Non-vacuity needed **three** claims by
  three different means, and each one was found by asking "what bug survives the checks I have?":
  (1) a **reference-backed stub** (delegates to the golden reference ⇒ correct by construction, then
  corrupts a register in one `forwarding` position) passes `checkProgram` under off and throws
  `AssertionError` under on — the _passing_ half is load-bearing, it's what makes the failing half
  attributable to the perturbation and not to an incidental crash; (2) an **inverted** stub (correct only
  with forwarding ON) driven through the PUBLIC entry point with `[FORWARDING_ON]` — claim 1 bypasses
  `runConformance`, so it couldn't see a loop that iterated configs while passing `defaultConfig()` to
  every check; (3) `conformanceCases([OFF, ON])` yields 2× the corpus with distinct labels — claims 1
  and 2 both run under ONE config, so neither covers the multi-config path, and a "only ever runs
  `configs[0]`" bug would pass everything and make step 2's two-position suite read as if it proved both.
  **Every guard mutation-checked, not just observed green** (each mutation was applied, the failure
  observed, then reverted). Note the stub is program-agnostic by rebuilding its input from the
  `ProgramImage` given to `reset` — sound because the reference reads only `words`/`data`, never
  `symbols`. Also: a prettier gotcha in the plan docs — an **inline code span broken across lines** makes
  `prettier --write` non-idempotent (it oscillates on the indent), so keep backtick spans on one line.
- **Halt-with-drain is an INV-8 trap — and the plan's FIRST answer was WRONG (corrected 2026-07-16 in the
  step-1 decisions review).** The original pin ("stop fetching at `ecall` decode, drain, halt at retire")
  rested on "in every corpus program `ecall` is LAST, so the shadow is post-`.text` garbage." **Both halves
  are false, verified against the corpus:** `add.s` has **no `ecall` at all** (halts by running off the end
  of `.text` — an entirely unhandled SECOND halt path), and `call-return.s`'s `ecall` shadow is the **real
  `max:` function** (`bge`/`mv a0,a1`/`ret`), not garbage — live code that would genuinely execute. **The
  hazard the ecall squash removes is a COMMITTED SIDE EFFECT, not a PC redirect** (a redirect only moves
  the microarchitectural fetch pointer and can never reach `MachineState.pc` under the retire-pc rule);
  the real risk is a shadow **store**, which sits in MEM the same cycle `ecall` sits in WB — so whether it
  corrupts memory would hinge on intra-cycle stage ordering. Squash at `ecall`-decode instead of resting
  architectural state on that accident. **The
  pinned rule is now one rule copied from multi-cycle's retire arm: architectural `pc` is the RETIRING
  instruction's `nextPc`, never the fetch pointer** (halt ⇒ pc frozen at the halting instruction's own pc;
  else pc = nextPc, halting if that leaves `.text`). Fetch stops for two reasons — `ecall`-in-ID or the
  fetch pointer leaving `.text` — and **stop-fetching ≠ halt** (halting when fetch leaves text truncates
  `add.s`, whose last 3 instructions are still in flight). Load-bearing because `expectEquivalent` asserts
  `model.pc === reference.pc` as a deliberate strengthening beyond INV-8, and its own comment names `add.s`
  as where a mismatch surfaces first.
- **STEP-1 DECISIONS REVIEWED & PINNED 2026-07-16, before any code** (see the `m3-tasks.md` table). Eleven
  stood as seeded; the halt row was rewritten (above); the branch row gained **`jalr` resolves in EX too**
  (a register supplies its TARGET ADDRESS, not just taken/not-taken — `call-return.s`'s `ret`). **NB
  branches are RAW consumers too** (they read rs1/rs2 to compare) — `sum-loop.s`'s `bnez t0, loop` reads
  the `t0` its immediately-preceding `addi t0,t0,-1` writes: a **distance-1 branch-operand RAW, 10× per
  run, in the hottest corpus loop**, and one of the first things step 3's timing tests will measure. Both
  resolve in EX ⇒ same EX-targeted forwarding paths, no special case. And **one decision the table was
  missing entirely** was added: **intra-cycle stage & event order
  — process stages in REVERSE each cycle** (WB→MEM→EX→ID→IF) so each stage reads the latch its upstream
  neighbour hasn't yet overwritten. That makes the same-cycle WB→ID rule need no special case AND fixes the
  order of `events[]` within a cycle — a trace-contract surface (INV-3/INV-6), not an implementation
  detail. M1/M2 never faced it (one instruction, one stage per cycle) ⇒ M3 is the first model where
  intra-cycle ordering exists. Also pinned in step 1: **every instruction traverses all 5 stages** (unlike
  M2's variable opcode-dependent `phasesFor` — a `sw` idles through WB rather than skipping it).
- **M2's step 5c is NOT an M3 prerequisite and M3 doesn't reopen it.** M2's datapath omitted the ALUOut→PC
  redirect because the engine emits no event for PC arithmetic. The pipeline doesn't inherit that: a taken
  branch emits `branch-resolved` + `flush` — honest trace signals the datapath can light the redirect from.
  (Seeded decision: extend `branch-resolved` with `target: number` so the redirect wire can be labelled —
  INV-3 says extend the schema, don't open a back door.)
- **Corpus needs nothing new — verified, not assumed.** `array-sum.s` already holds the textbook load-use
  pair (`lw t2, 0(t0)` then `add a0, a0, t2`); every program has back-to-back RAW chains + taken branches.
  INV-7 intact.
- **Headline decision: the forwarding toggle ships in MVP, both positions correct day one** — it IS the
  spec's flagship interaction (§12.2) and can't be retrofitted (whether a hazard resolves by forward or
  stall is the hazard unit itself). Deferred to M4: configurable branch prediction + caches.
- Seeded pins that fork the hazard logic: same-cycle WB→ID (write 1st half / read 2nd half, P&H);
  EX/MEM→EX + MEM/WB→EX with **EX/MEM winning** a double match, never to/from `x0`; **load-use stalls 1
  cycle even with forwarding ON** (the bubble that can't be forwarded away — the pedagogical centerpiece);
  branch resolved in **EX**, fixed predict-not-taken, 2-cycle flush; **split I/D memory** (diverges from
  M2's single shared memory ⇒ own geometry, no reuse).
- New-for-M3 view work: datapath activation becomes **multi-instruction** (5 stages, 5 different
  instructions, one cycle — a first); forwarding/hazard units are the best-yet `minTier` structural-hiding
  case AND are **absent (not dimmed) when `forwarding:false`** — structure driven by CONFIG as well as
  tier, lawful because the trace genuinely has no `forward` events then. Pipeline map (stage×cycle HTML
  grid) + renderer deltas 1–4 come from `docs/plans/superscalar-visuals.md` by reference — build
  **stage-and-lane-parametric**, don't re-derive. See [[future-microarchitectures]]: the map is the ONLY M3
  deliverable a future deeper pipeline reuses as-is, so it's the only place generality is worth buying —
  everything else stays concrete because each microarchitecture is its own package.

### M3 STEPS 1 + 2 — THE PIPELINE MODEL — DONE & pushed (2026-07-16, 457 -> 501 tests, 5 commits)

`@cpu-viz/engine-pipeline` (`PipelineProcessor`, `<- isa, trace`). Every seeded step-1 decision survived
contact with the code; building it forced **twelve more**, all pinned in the m3-tasks table. What is worth
carrying forward and is NOT re-derivable from the plan or the diff:

- **The one architectural idea: the four latches are DOUBLE-BUFFERED.** Each stage reads `prev` (the
  pre-clock-edge values) and writes a fresh `next`, committed at the end. That is what makes BOTH forward
  paths correct — EX reading `prev.exMem`/`prev.memWb` reads exactly the two inputs of P&H's forwarding
  mux. **Consequence the plan got subtly wrong:** the pinned REVERSE stage walk is _not_ what makes
  forwarding correct (with `prev` reads it holds in any order). It earns its keep for three OTHER things:
  the same-cycle WB->ID read (the register file is the one piece of state that is _not_ double-buffered),
  the intra-cycle `events[]` order, and control-signal propagation (ID stalls -> IF holds; EX flushes ->
  ID/IF squash). Advisor's reframe; worth keeping because the naive worry ("reverse order clobbers MEM/WB
  before EX reads it") is only true under in-place single-buffer mutation.
- **A load's EX/MEM `writeValue` is `null`, and that null IS the load-use hazard.** A load in MEM has only
  its ADDRESS latched. So loads are unforwardable from EX/MEM by CONSTRUCTION rather than by a rule that
  could drift — and a defensive throw asserts the hazard unit and the forwarding network can't disagree.
- **The clock edge extends past the latches — found by hand-deriving a flush, NOT by any test.** The PC
  redirect (EX) and the fetch-stop (ID) must ALSO be staged and applied after the walk. First cut poked
  them mid-walk; since IF runs last it then fetched from the _redirected_ pointer, so a taken branch cut
  ONE row instead of two and an `ecall`'s shadow never existed to squash. **IF must fetch first and be
  squashed after** — the stage does its work every cycle; the flush kills the RESULT.
- **A stall holds the younger instruction IN the IF stage** (the repeated `IF IF` cell of the textbook
  diagram), never re-fetches it — re-fetching would mint a second id for one instruction (INV-4 violation)
  and emit a second `instr-fetch`. This is why the model needs an IF-stage occupant distinct from the
  IF/ID latch: five stages, four latches.
- **`flush` reports REAL CASUALTIES, and one that kills nobody emits no event** (documented in `schema.ts`,
  where consumers look). Reversed on advisor review before shipping: the first cut treated `stages` as
  "the latches the signal is asserted on, occupied or not", which is true of hardware and wrong for this
  trace — `flush` has three readers (datapath, the map's cut rows, and the **curriculum, which triggers on
  a bare `{event:'flush'}`**), and 3 of the 5 corpus programs end with `ecall` as the LAST instruction, so
  that reading would have let a lesson announce a bubble that never happened.
- **MEASURED, not argued — the milestone's thesis.** Mutating the hazard unit to ignore `forwarding:true`
  (an over-stalling pipeline) leaves INV-8 conformance **12/12 GREEN** and fails **10 unit tests**. The
  blind spot is real and total. **But the plan's sibling claim was FALSE and is now corrected:** breaking
  the _priority rule_ does NOT slip past conformance — `array-sum.s [forwarding on]` catches it, because
  **`la t3, total` expands to two instructions that both write `t3`**, immediately consumed by
  `sw a0, 0(t3)`. The corpus has had a double-match litmus all along, hiding inside a pseudo-op.
- **Corpus facts:** `add.s` is **7 cycles forwarding-on vs 9 off** with identical final state — the crown
  jewel is already visible on the SMALLEST corpus program, no new fixtures. And **`TEXT_BASE` is 0**, so
  `lw x2, 0(x0)` reads the program's own first instruction word, not an empty cell (this bit me: a test
  expecting 0 got 147 = `0x93` = `addi x1,x0,0`). Tests needing scratch memory must pick an address past
  the end of text.
- **A fifth DAG wiring point the plan's "all four places" list forgot:** the root `package.json`
  `workspaces` array. eslint + root tsconfig refs + vitest aliases + web tsconfig paths are only four.
- Step 2 was pulled in early (wired from the first compiling skeleton) rather than saved for its own step
  — cheapest gross-sequencing net available, and step 0 had already built it. Advisor's call; it was right.

### M3 STEP 3 — PINNED TIMING (the net for INV-8's blind spot) — DONE & pushed (2026-07-16, 501 -> 542)

`packages/engine/pipeline/src/timing.test.ts`, 41 tests, no engine change, no new fixtures (INV-7).
Commits `2c9e92c` (the suite) + `8fcd7c7` (crown-jewel memory union).

- **The transferable idea: pin a DERIVATION, not numbers.** "Hand-derived" is unachievable by
  cycle-counting a 10-iteration loop, so the pinned RULES were summed into a closed form first, and the
  corpus numbers fall out of it. With `d_i` = the cycle instruction i leaves ID (EX at d+1, WB at d+3;
  halt at the last retire so `cycles = d_last + 4`), the rules ARE the recurrence: `d_i >= d_(i-1)+1`;
  OFF `d_i >= d_p+3` per producer (+3 not +4 — the same-cycle WB->ID rule paying for itself); ON
  `d_i >= d_L+2` for a LOAD producer only; taken transfer `d_target >= d_b+3`. Summed:
  **`cycles = N + 4 + S + 2*T`** (N retires, S stall cycles, T taken transfers). **All 41 passed on the
  first run** — write the derivation down BEFORE the test file (worksheet: `M:\claud_projects\temp\`).
- **The thesis as arithmetic: N and T belong to the PROGRAM, S to the MICROARCHITECTURE** ⇒
  `cycles_off - cycles_on = S_off - S_on` exactly. Assert each term SEPARATELY against the events that
  define it (advisor: a lone total lets a compensating over-S/under-T pair pass and localizes nothing).
- **The pinned table:** add.s 9→7 (N3 T0 S 2/0) | array-sum.s 72→51 (N34 T4 S 26/5) | byte-loads.s 14→10
  (N6 T0 S 4/0) | **call-return.s 17→17 (N9 T2 S 0/0)** | sum-loop.s 78→56 (N34 T9 S 22/0).
- **Forwarding is NOT always faster — `call-return.s` is identical in both positions.** Every RAW in it is
  already separated by a flush gap, which charges the +2 the interlock would have. So the crown jewel is a
  claim about the FOUR RAW-chained programs, not the corpus; asserting it corpus-wide overclaims, and
  weakening to `<=` would pass for a pipeline where forwarding did nothing. Proof it matters: call-return
  is one of the two ON cases that **passes** under the over-stalling mutation.
- **The +2 is per taken TRANSFER, not per `flush` EVENT — they come apart.** `call-return.s`'s `ret` is the
  last word of `.text`: kills nobody, emits no flush (step 2's real-casualties rule), still costs 2 cycles
  (the target can't be fetched till the redirect lands). T=2 but branch-taken flushes=1. A penalty is not
  a casualty.
- **Stalls are NOT uniform per iteration** — so never assume a per-iteration cost, trace one. `sum-loop`
  OFF: iteration 1's `add` stalls 2 and **no later one does** (the taken branch's gap already retired its
  producers); only the `bne` stalls every time. S_off = 2 + 2*10, not 4*10.
- **Derive against the EXPANDED stream** (advisor's catch): `la` is ALWAYS 2 words (`lui`+`addi rd,rd`) = a
  distance-1 RAW invisible in the `.s` source — array-sum has two, byte-loads one. Also: byte-loads has two
  loads and NO load-use (the `lbu` reads the pointer t0, not the `lb`'s t1).
- **Placement is a pc->cycles histogram** (`{8:2, 16:20}`), not a count — count and placement then share
  one source of truth (S is summed from it) and a loop's recurring stall stays ONE hand-checkable entry.
  Keyed by pc, not cycle. This is the honest discharge of the plan's "which cycle": pc + stage + step 1's
  `walk()` shape, which is stronger and less brittle than literal cycle indices.
- **Mutation-checked BOTH ways** (the project's standing discipline): the over-stalling mutation leaves
  conformance **12/12 green** and fails **14 timing tests** — every `[forwarding on]` case, not one
  `[forwarding off]` case, so the failure is exactly attributable; and moving a stall to the wrong pc
  **with the total unchanged at 22** fails too, proving placement is pinned independently of count.
- A guard `it()` asserts the table covers every `.s` on disk: conformance auto-enumerates the corpus, but a
  new program would NOT get a timing entry automatically — fail loudly rather than silently stop covering.

### M3 STEP 4 — RECORDER / TIME-TRAVEL — DONE & pushed (2026-07-16, 542 -> 554, `abf9c4e`)

`packages/engine/pipeline/src/recorder.test.ts`, 12 tests, **zero production changes** ("free by
construction" survived contact — INV-3 paid for itself a third time).

- **The step's real work was SCOPE, not code.** Three of the four things its plan text asked for were
  ALREADY pinned at engine level by step 1 (the five-stage walk, the five-in-flight cycle, the per-cycle
  latch snapshot). Rebuilding them through a recorder wouldn't make them truer. So the file asserts only
  what the RECORDER layer can: the navigation criterion end-to-end, and **`follow()` — the shipped API the
  web calls** (step 1 proves the walk with a test-local `walk()` helper). "The acceptance criteria mention
  it" != "nothing pins it" — worth re-asking on every step.
- **The third blind spot, found by that scope review.** One walk shape was pinned NOWHERE: an instruction
  **held in IF** across a stall (`IF IF IF`, one id). The INV-4 test follows a never-stalling instruction;
  the stall tests follow the CONSUMER (whose repeated cell is `ID`). Nobody followed the instruction stuck
  BEHIND the interlock. Mutating IF to re-fetch mints **3 ids for 1 instruction** — and **conformance is
  12/12 green and every timing test passes**. So: step 3 established INV-8 is blind to TIMING; step 4 adds
  that INV-8 _and_ the timing suite are blind to **instruction IDENTITY** — the thing every downstream view
  is keyed on.
- **`micro` is pinned against the TIMELINE, not per-cycle:** the latches recorded at end of cycle `i` name
  exactly the instructions placed in ID/EX/MEM/WB at cycle `i+1`. Mutation-checked by snapshotting BEFORE
  the edge: exactly the two cross-check cases fail, nothing else — the specificity is the proof.
- **Two porting traps caught before the first run:** the pipelined `overwrite` program commits at cycles
  **4/5/6** (not M2's 3/7/11), and pre-run `micro` is a **non-null object with four null latches** (not
  M2's absent `micro`, so `expect(micro ?? null).toBeNull()` would fail). Never copy a neighbour's numbers.

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

## M4 — STEPS 0–3 DONE, THE ENGINE IS COMPLETE (2026-07-16, `475a611..27f0ce2`, 685 → **746 tests**)

The fork after M3 was put to the user: M4-prediction / M4-caches / M2's deferred 5c. **User chose
branch prediction first.** Caches split into their own milestone — §12 warns cache behavior only
shows with array-walking programs, so caches carry a corpus prerequisite prediction does not.
**Next: steps 4–7 (web toggle → datapath → map → lesson), all browser work.**

### What building forced (the plan's own predictions, scored)

- **The step-1 title was WRONG, and correcting it is the finding: three scheme NAMES, two
  BEHAVIORS.** `'none'` ≡ `'static-not-taken'` — a processor with no predictor doesn't wait, it
  keeps fetching, and **the fall-through IS the not-taken path**. The plan seeded the opposite
  (stall-on-branch); it missed that **`'none'` is `defaultConfig()`**, so a third behavior would
  have silently redefined the default pipeline and moved every M3 timing pin. **Measured:**
  honoring the knob failed **exactly one test in the whole suite** (the capabilities flag). Also
  dissolved the `predicted:boolean` honesty question — nobody stalls, so `false` is never a lie.
  Two seeded decisions resolved together, one reversed.
- **The central reframe: EX squashes on MISPREDICTION, not on TAKEN.** `if (taken)` was only ever
  predict-not-taken's spelling of `if (predicted !== taken)`. `nextPc` corrects both directions
  with no branch on which way we were wrong.
- **Step 0's proof bought a smaller field.** The latch carries `predictedTaken: boolean`, not a
  target — since `speculativeTarget` provably equals EX's `nextPc`, "we both say taken" implies
  "we both mean the same address". **`jalr` needed no special case anywhere**: never predictable ⇒
  always mispredicts ⇒ the `call-return` regression is mechanical, not coded.
- **The bet is NOT `ctx.squash`** — it kills ONE (the fall-through), a squash kills TWO (ID+IF).
  That difference IS the payoff. And **a CORRECT prediction still emits a flush** (the discarded
  fall-through is the "1"); mutation proved the casualty pin is its **only** net — killing the
  event fails 1 test and leaves timing untouched.
- **`flush.reason` grew by exactly one word** (`'branch-not-taken'`), because under static-taken a
  correction can fire on a branch that was NOT taken and `'branch-taken'` would state the opposite.
- **The precedence bug was structural** (EX runs before ID; `stageId` already early-returns on
  squash) but pinned anyway — reachable only via a `jalr` (places no bet ⇒ ID stays occupied) with
  a branch behind it. **The net that would catch it doesn't contain the case that triggers it**:
  conformance _would_ see `x4=99`, but the corpus has no branch behind a `jalr`.
- **`2·T` was never a rule — it was the static-not-taken INSTANCE.** The general form is ONE
  per-transfer rule (**2 mispredicted / 1 correct-taken / 0 correct-not-taken**); the scheme only
  decides `predicted`. Smaller than the plan's three formulas. Nothing M3 pinned was wrong — it was
  _specific, in a place that read as general_.
- **The thesis is MEASURED and it's the sharper mirror of M3 step 3.** There, forwarding turned out
  not-always-faster (`call-return` 17 both). Here the same program gets **WORSE: 17 → 18** under
  static-taken (its three transfers are one of each kind — `jal` 2→1, never-taken `bge` 0→2, `ret`
  unpredictable stays 2). Asserted as **signed per-program deltas** (−7 / −2 / **+1**), never an
  average — the average is what would let the loss hide. **Every number right first run.**
- **Blind spot re-measured:** a pipeline ignoring `branchPrediction` leaves conformance **32/32
  green**, fails 10 timing + 4 soul tests. Same shape as M3's forwarding measurement.
- **Casualties ARE the penalty** (a killed instruction = a wasted fetch slot = a cycle): `sum-loop`
  18 → **11**, exactly `P`. Step 6 inherits the number instead of inventing it.
- **Two defects only the eyeball caught, both in the harness, not the engine.** (1) Six configs
  produced **two labels** — `configLabel` named `forwarding` alone, so three schemes all read
  `[forwarding off]`; **the harness's own distinctness guard never noticed because every claim in
  it was handed the two-forwarding list** — _a guard whose case list cannot reach the collision is
  not a guard_, the exact M3-step-0 vacuity reappearing **in the guard rather than the guarded**.
  Fixed by **deriving** (name the knobs that VARY) so M3's titles return byte-identical. (2) Step
  0's `>>> 0` is **invisible to the corpus** — deleting it failed nothing, because every corpus
  address is small AND the agreement test is blind since **EX normalizes too** (both wrong
  together, still matching). Fixed with a direct case, not by softening the comment.

### The plan's other non-obvious calls (still standing)

- **`static-taken` IS the MVP** — the inverse of ship-cheap-first. Confirmed harder than seeded:
  `static-not-taken` isn't merely "a rename", it's literally `defaultConfig()`'s existing behavior.
- **M4 forces back what M3 declined** (4th time): predicting _taken_ needs a **target**, earliest
  computable in **ID** ⇒ restore the classification `processor.ts:175` refused + a **second
  redirect point** (ID _bet_ vs EX _correction_) ⇒ a correct prediction costs **1, not 0** (0 needs
  a BTB → deferred).
- The penalty model **reproduced a pinned number before any code**: 18 casualties = 9 taken × 2.
- Prediction is **INV-8-invisible** ⇒ conformance green first-run _is_ the safety proof.
- Still open: whether the **ID bet needs its own trace event** (pressure is off — it already
  surfaces as `flush{reason:'branch-predicted-taken', stages:['IF']}`; step 5 should try to draw
  from that + `branch-resolved.predicted` first).

### Original plan rationale

- **`static-taken` IS the MVP** — the inverse of ship-the-cheap-version-first. `static-not-taken` is
  the behavior the machine already has, so honoring it as config is a **rename, not a toggle**; the
  entire flagship payoff lives in the one mode that also carries the whole structural cost. A
  not-taken-only MVP would forfeit the rationale that picked prediction over caches and 5c.
- **M4 forces back what M3 declined** (the recurring beat, 4th time): predicting _taken_ needs a
  **target**, the earliest a PC-relative target exists is **ID** ⇒ M4 must restore the branch
  classification `processor.ts:175` deliberately refused, and add a **second redirect point** — the
  ID _bet_ alongside the EX _correction_. Consequence: a correctly-predicted taken branch costs
  **1, not 0** (one fall-through fetch already happened); 0 needs a BTB ⇒ explicitly deferred.
- **The thesis was readable in the corpus before writing a line**, and it mirrors M3 step 3's
  self-correction: `sum-loop`/`array-sum` favor taken (backward loop branches), but `call-return`'s
  `bge a0,a1` is **17 >= 42 = never taken** ⇒ favors not-taken. **No scheme dominates** — a
  predictor is a _bet_ and the corpus punishes each one. `call-return` is predicted to get
  **slower** under static-taken (`jal` 2→1, but `bge` 0→2 and `jalr` unpredictable stays 2).
- **The penalty model already reproduced a pinned number before any code**: M3's pinned **18
  casualties** on `sum-loop` = 9 taken × 2 squashed, exactly.
- **M3's closed form generalizes rather than breaks**: `cycles = N + 4 + S + 2·T` — the `2·T` was
  never general, it was the **static-not-taken instance** of a scheme-dependent penalty `P`.
- Prediction is **INV-8-invisible** (squashed paths never commit) ⇒ conformance is expected green
  first-run and _that is its point_; only the timing suite + the map can see it. Same shape as M3
  step 3.
- Seeded-but-open: what **`none`** means (lean stall-on-branch, but its corpus contrast is thin);
  whether **`predicted: boolean` is honest** under `none` (M4's add-or-decline-a-field question);
  whether the **ID bet needs its own trace event** (M3's pattern says try to build the datapath
  without it first).

## M4 STEP 7 — THE FLAGSHIP LESSON; **M4 IS COMPLETE** (2026-07-17, `680435a..37353e1`, 788 → **807 tests**)

`branch-bet` on `call-return` — "the bet, and what it costs when it's wrong". The last step of M4.

- **The acceptance line held on the FIRST RUN, and it is the milestone's cleanest payout.** "The
  validator covers the new axis **without a special case** — if it needs one, the validator's
  derivation was wrong, not the lesson." It needed none. Zero new lesson-format fields, zero engine
  changes, zero renderer changes; the only red was the deliberate inventory count. M3 step 8 derived
  the rule, M4 step 4 grew it to four positions, step 7 only authored JSON.
- **The program was FORCED**, on M3's own criterion — `call-return` is the only corpus program
  carrying the whole story on source-visible lines, and the pinned transfer triple says so outright:
  `jal` **wins** (2→1), `bge` (`17 >= 42`) **loses** (0→2), `ret` (a `jalr`) **admits no bet** (2
  either way). Signed −1 + 2 + 0 = **+1** ⇒ the lesson is the only surface where "no scheme
  dominates" is a claim about **instructions** rather than a total.
- **Key on `target`, never on `predicted`** — `predicted` is a property of the SCHEME, so a trigger
  using it means something different in each position. And the **two targets on one branch are not
  interchangeable**: `bge` bets on `0x20`, resolves to `0x1C`.
- **The mutation prediction was WRONG, and measuring it is the finding.** The slide fails **three**
  tests, not one — the sweep's ORDER guard catches it, because this lesson's config-exclusive steps
  **interleave** in trace order. Structure caught it, not vigilance.
- **The mutation the sweep genuinely cannot see names the price of the design.** `nth: 2, {predicted,
actual}` on the `ret` step is right under not-taken and **silently dead** under taken — deleting the
  punchline exactly where it lands. Whole sweep green; one test fails. Once "lawfully dead" is legal,
  **DEAD and LAWFULLY DEAD stop being distinguishable to any generic rule**, and nothing derivable
  closes it: which position a step is _meant_ to be dead in is pedagogy, and pedagogy is not in the trace.
- **The eyeball found a product defect — the streak resumes at 8.** The closing step shipped a
  **directional** imperative in a step alive in BOTH positions. Not a false number (step 4's defect) —
  a **direction**. Nothing sees which way the reader is facing. Fixed symmetrically; **stated in the
  README, not guarded**.
- **The advisor caught the same root cause's quieter form, in the same step**: "add up what the bet
  actually did here" **presupposes** a bet — and on not-taken, where the lesson opens, none was placed
  (the map shows no `?` to prove it). Every comparison true; only the premise wrong. **The tell is
  tense** — a step alive in N positions is prose about the **experiment**, not the run in front of you
  ⇒ present comparative, never past reportive. Honest gap: the eyeball rendered only the **detailed**
  tier; essentials/expert have never been on screen (low-risk — the asterisk guard covers all three and
  `renderNarration` is tier-agnostic — but it is the one reachable surface no screenshot has).

## The ISA reference panel — the first surface about the LANGUAGE (2026-07-17, `cb9edd1..976c9c8`, 807 → 889 tests)

Driven by the user: _"the user has the option to edit the program, but may not know what
instructions he can use — we need lessons and a panel for that."_ The editor has existed since M2
and **the shell had never named a single instruction**. User chose **both** deliverables: the
panel teaches (no new lesson JSON) **and** an ISA lesson track as a milestone ⇒ panel BUILT,
track PLANNED (`docs/plans/m5-tasks.md`, NOT STARTED).

- **The whole design question was WHERE each claim comes from**, since a reference that lies is
  worse than none. Split by what already has an authority: **which** things exist is derived
  (`INSTRUCTIONS`; the assembler's own tables); **what the grammar is** is derived for real
  instructions; **what it means** is the one genuinely new artifact — no source in this repo
  carries learner prose. Declared in `web`, never `isa` (prose in the encoder is the
  view-in-the-engine mistake INV-2/INV-3 forbid) — and the DAG forces it too: **`web` is the only
  package that can see both `isa` and `assembler`**, so the choice was made by the architecture.
- **`handlerFor` now dispatches through a new `syntaxClassOf`** ⇒ the class that DOCUMENTS an
  instruction and the one that PARSES it are one lookup; the panel cannot describe a form the
  assembler rejects. `format` ≠ syntax — `operands.ts` said so in its own header since M1. `jalr`
  really does accept **four** forms. `handleDirective` became a **record** so `DIRECTIVES` is
  derived from the dispatch: a list that cannot disagree with the code beats one a test must
  remember to check.
- **The drift the design feared had ALREADY SHIPPED, twice**: `format.ts` kept `LOAD_MNEMONICS` +
  `NO_OPERAND_MNEMONICS`, hand-copies of `I_LOAD`/`NO_OPERANDS`, and `formatInstruction`
  re-derives operand shape from `format` independently of the parser. Not fixed (not a
  prerequisite — a panel-side lie is impossible either way); `ABI_REGISTER_NAMES` **is** now
  pinned against the assembler's map.
- **The net that buys the prose: every example is ASSEMBLED, and instruction examples DECODED BACK
  to the mnemonic whose row they sit on.** Mutation-checked both ways: an example that assembles
  fine but decodes as a sibling (`lb` under `lbu`) fails **exactly one** test; dropping a note
  fails exactly two. The prose describes **THIS simulator, not the spec**: `ecall` halts
  unconditionally whatever `a7` holds (the corpus's `li a7, 10` is cosmetic here) and `fence` does
  nothing — **that `ecall` ends a program is the single most useful fact a learner needs and
  appeared NOWHERE in the UI**.
- **THE EYEBALL FOUND FOUR WITH 80 TESTS GREEN — the streak reaches 9 of 10 view steps.** Three
  were claims: (1) _"All 58 things this simulator accepts"_ sat above a tab bar whose 4th tab is
  **Registers**, not in the 58 — **a total is only honest over a set whose boundary the reader can
  see**; four tabs are four sets. (2) **Arithmetic opened with `addi` above `add`** — groups are
  pedagogical but their ORDER was inherited from `INSTRUCTIONS`, which sorts by **opcode**
  (0x13 < 0x33): true about the encoding, meaningless to a learner. **There is no source for
  pedagogical order, so the notes' key order IS it** — membership stays derived. (3) `fp` listed
  above `s0` (alias first, its role pointing at a row below it) — caused by an alphabetical
  tiebreak, **fixed by DELETING it**: `registers.ts` declares the canonical name first and a
  stable sort inherits that. (4) a stray space before a comma from a JSX line break; the `📖` also
  went (astral ⇒ tofu; the shell's glyphs `✎ ↩ ▶ ⏮ ◐` are all BMP).
- **Order was nobody's assertion until it was wrong** — now pinned (`add` before `addi`, `s0`
  before `fp`).
- **The advisor caught a dead export that a passing test disguised**: `STARTER_PROGRAM` had a
  green test ("the starter program assembles") and **no caller** — the editor's draft is always
  seeded from the corpus, so there is no empty state. **A test over an unreferenced export is
  green when the string parses, not when anything renders it** — the vacuity trap wearing a
  coverage badge. Deleted.
- **Browser method note:** the repo has **no jsdom / no driver** (`environment: 'node'`, tests are
  `renderToStaticMarkup` — `App.test.tsx`'s docblock names this gap). So the panel was split into
  a container + a pure `ReferenceBody(tab, query)` — every tab a static render — and the click
  wiring was driven over **CDP with Node's global WebSocket + headless Chrome** (script at
  `M:/claud_projects/temp/isa-ref-eyeball.mjs`). Verified insert-at-caret really inserts: caret at
  0 → text at 0, caret to 19 (exactly the inserted length), rest byte-identical. **Vite's port is
  a preference, not a promise** (5173–5182 were all taken by other projects; 5183 served OUR app
  while its HMR cross-talked with a Twofish project) ⇒ always `--port N --strictPort`, and **poll
  for readiness, never sleep**.

## M5 — the ISA track: PLANNED, NOT STARTED (`docs/plans/m5-tasks.md`)

**The plan's finding is that the request was bigger than the gap.** Its framing was "arithmetic,
branches, memory, calls" — but the **inventory** (which the advisor insisted on before any
proposal) shows `array-in-memory` already teaches memory, `function-call` already teaches calls,
and `sum-loop-tour` already walks a loop with a backward branch: **the three single-cycle lessons
ARE an intro track**, unsequenced and unnamed. Meanwhile **two corpus programs carry NO lesson**,
and both are already teaching artifacts: **`add.s`** (5+37=42, and the only program with **no
`ecall`** ⇒ halts `pc-out-of-range`, exactly what the panel's new prose describes) and
**`byte-loads.s`**, whose own header says it exists to show _"the classic load-extension trap"_
and which **nothing has ever taught with**. ⇒ the track needs ~**zero** new programs, not four.

Two headline decisions: **the panel owns GRAMMAR, the track owns BEHAVIOUR-OVER-TIME** — forced by
INV-6, not taste ("what `add` does" anchors to a `reg-write`; "`add`'s syntax is `rd, rs1, rs2`"
**has no anchor**, because syntax is not a thing that happens in a cycle). And **a track IS an
order, and today's is an accident**: `lessons.ts` sorts by `id.localeCompare`, so the picker
offers `array-in-memory` first and `sum-loop-tour` last — **the SAME defect the panel shipped and
fixed this week, one surface up and already live in the product**. There is no source for
pedagogical order ⇒ declare it in content (`index.json`, pinned exhaustive both ways). _A
`localeCompare` is not an opinion about teaching; it is the absence of one, wearing determinism as
a disguise._

**M5 STEP 0 DONE 2026-07-17 (895 tests, `ee9331a`): THE ORDER SPINE.** `content/lessons/index.json`
is now the only source of picker order; `lessons.ts` reads it instead of `localeCompare`. Authored:
`sum-loop-tour` → `array-in-memory` → `function-call` → `forwarding-bubble` → `branch-bet` (step 4's
target minus the two unbuilt lessons). Browser-verified on the shipped bundle: "Anatomy of a loop"
leads (was "Walking an array in memory"), five options, promoted lesson opens with its 5-step rail.

**THE ACCEPTANCE LINE WAS BACKWARDS, and MEASURING it is the finding — the plan's own pin was the
weaker half.** It asked "index ≡ set both directions; dropping an id reddens exactly the index
test". Two mutations: drop an id → **three** tests redden (all true consequences); re-author the
index **alphabetically** — exhaustive, self-consistent, and the exact defect step 0 exists to end
→ **the index test stays GREEN**. `LESSONS` is DERIVED FROM the index ⇒ **every index is
self-consistent**, so exhaustiveness pins that the CODE READS the index, never that the INDEX
TEACHES. Following the acceptance literally ships machinery faithfully implementing
`localeCompare`. What catches it: two claims asserted **BY NAME** about the index's CONTENT (first
lesson is `sum-loop-tour`; every language lesson precedes every µarch one) — **pedagogy is not
derivable**, exactly M4 step 7's "which position a step is _meant_ to be dead in". 3rd milestone
running for _a guard whose case list cannot reach the defect is not a guard_. ⇒ **Whenever a plan
says "pin X ≡ Y", ask what a self-consistent X∧Y still gets wrong.**
Two smaller: **the glob would have EATEN the index** (`import.meta.glob('*.json')` sits on the
lessons' own dir ⇒ `index.json` casts to a `Lesson`, ships as a step-less 6th entry) — fixed by ONE
glob partitioned by path, since a direct `import` would need the same exclusion anyway (removes the
problem rather than moving it). And **one existing test passed ONLY because it was alphabetical**:
pipeline-membership read `toEqual(['branch-bet','forwarding-bubble'])`; authored order (M3's
flagship before M4's) reddens it — its own sentence is about MEMBERSHIP, so it now `.sort()`s
first; order is pinned ONCE, against the index. `orderLessons` exported PURE (M3 step 0's shape: a
sort mistake does not fail, it re-invents an order and leaves every test green); unlisted lessons
sort LAST, never dropped — the index controls order, never membership, because a misplaced lesson
is visible and a missing one is not.

## M5 STEP 1 DONE — `first-program` on `add.s` (2026-07-17, 907 tests)

The track's front door ships: `content/lessons/first-program.json`, "The smallest program that
computes something", 3 steps, single-cycle, first in `index.json`. `add.s` UNCHANGED, zero new
format fields, zero engine/renderer change. Browser-verified both themes.

**THE PLAN'S OWN ANCHOR LIST WAS UNBUILDABLE — PIGEONHOLE, and that is the finding.** It asked for
4 anchors (2 constants, the `alu-op`, then 42 landing). `add.s` is 3 instructions; single-cycle runs
one per cycle; the cursor addresses a **CYCLE** and the validator forbids two steps sharing one ⇒
**a single-cycle lesson has AT MOST AS MANY STEPS AS ITS PROGRAM HAS INSTRUCTIONS.** An arithmetic
ceiling, hit in AUTHORING rather than in code. Measured as 2 mutations, the 2nd unpredicted:
single-cycle **collides** (`steps share a cycle...: [[2,[2,3]]]` — the ALU result and its write-back
are one cycle because that is what single-cycle MEANS); pipeline **forwarding-on is OUT OF ORDER**
(`expected [ 2 ] to deeply equal []` — the ALU computes 42 at cycle 4 while `x2=37` is not written
back until cycle 5, so "now the ALU adds" placed between "37 arrives" and "42 lands" is **FALSE** on
a forwarding machine: the add takes 37 from the forwarding network, never from the register file).
Two machines reject one authoring for two unrelated reasons ⇒ a rule, not a workaround. **The
temptation worth naming: the 4th step IS buildable on multi-cycle** (phases spread out) — declining
it is the point, the language track is single-cycle because the machine is not its subject.

**HALTING IS STATE, NOT AN EVENT ⇒ it cannot be a step.** `TraceEvent` has **no `halt` arm**;
`pc-out-of-range` is not an instruction, it is where the PC ends up. Steps anchor to events (INV-6),
so the halt rides on the LAST step's narration. Free here: the halt lands on **the SAME cycle as the
payoff in ALL FOUR machines** (single-cycle 2, multi-cycle 11, pipeline 8/6) ⇒ "the processor stops
right here" is WATCHED, and the transport reads `— halted` beside it. Pinned as STATE
(`{halted:true, pc:12}`); **the `pc` is the load-bearing half** — it says the machine ran off the END
of `.text`, which an `ecall` halt would NOT (it leaves the PC on the `ecall`), so a corpus edit
giving `add.s` an exit would keep a `halted`-only test green while deleting the lesson's subject.
⇒ "reconsider the program's ending" = **NO**: `add.s` is the corpus's ONLY `ecall`-free program, so
its ending is the only place the track can teach halting (and INV-7 would ripple it everywhere).

**THE FRONT DOOR COMPUTES INTO `ra` AND `sp`, AND ONLY THE BROWSER SAYS SO.** `add.s` uses x1/x2/x5,
which the register panel names **`ra`/`sp`/`t0`** ⇒ the track's first lesson narrates "5 goes into
x1" beside a row reading `ra`, and a beginner's first program computes into the return-address and
stack-pointer registers. **No test can see it: the lesson is true, the panel is true, they disagree
only in the reader's head.** `add.s` stays (INV-7) ⇒ fixed with ONE CLAUSE in step 1 (the nicknames
are an ABI convention about how functions agree to share registers, not a hardware rule, and this
program ignores them) — on-topic, since the step's own first sentence is "registers are named
slots", and it lands directly above the panel it explains. Advisor caught that I had SPOTTED this at
the screenshot, said I'd log it, and then didn't — **the thing you notice and defer is the thing you
lose.**

Three smaller: **`addi` emits `alu-op` with `op:"add"`**, not `"addi"` ⇒ the obvious
`{event:'alu-op', where:{op:'add'}}` matches the FIRST `addi`, not the `add` (reg-write triggers
sidestep it). And the eyeball's own trap: **forcing `data-theme` via CDP renders a HALF-DARK page**
that reads exactly like a theme defect and is not one — the shell's inline styles read a React-held
theme object the attribute never touches ⇒ **click the real toggle**. And the **depth dial's buttons
carry the RAW tier id** (`essentials`) — they only READ capitalized via CSS `text-transform`, so a
driver matching the on-screen spelling finds nothing. Both present as product defects; neither is
one. All 3 TIERS then rendered in-browser (not just `detailed`, the only tier the validator
resolves — the other two are authored-but-unproven until something looks). See
[[browser-is-the-only-net]], whose `taskkill //IM chrome.exe` advice **closed the user's real
browser** and is now corrected (fresh `--user-data-dir` per run is the actual fix for the
stale-profile lock it was working around).

## M5 STEP 2 DONE — `sign-and-zero` on `byte-loads.s` (2026-07-17, 919 tests, `6e876d7`)

The corpus's last orphan finally taught with: "One byte, two answers", `0x80` read as −128 by `lb`
and +128 by `lbu`. Three steps on single-cycle, third in `index.json` (after `sum-loop-tour`; step 4
is still the real sequencing pass). Zero format fields, zero engine change, **zero renderer change —
a decision, not a default.**

**The plan's anchor sketch was unbuildable AGAIN — but NOT for step 1's reason, and the distinction
is the finding.** Step 1 hit a COUNT ceiling (4 steps > 3 instructions). `byte-loads.s` is **six**
instructions, so counting was never binding. The rule that bit is narrower: on single-cycle a load's
`mem-read` and its `reg-write` are **one cycle**, so the raw byte and the extended value cannot be
two steps (measured: `steps share a cycle ... [[2,[1,2]]]`). It bites an authoring the count permits.
The contrast axis collapses from read-vs-write to **`lb`-vs-`lbu`** — the better lesson anyway.

**THE DATAPATH DISAGREES WITH THE TRACE, and only the browser said so.** The two `mem-read` events
are byte-identical (`value: 128` both — the lesson's thesis, now pinned) while `datapath.ts` drives
the Data-Memory output wire from `regWrite.value` (`if (isLoad) w('dmem-wb', regWrite.value, 'dec')`),
so **on screen that block emits −128 for `lb` and 128 for `lbu`**. The draft's "the two memory reads
are identical" was contradicted on the CENTERPIECE view at the DEFAULT tier, every test green.
Relocating the pointer would not have fixed it — the contradiction is visual. **Renderer left alone
on purpose:** the diagram has no extender box, so the Data-Memory block IS the load unit (P&H's
convention); sourcing the wire from `memRead.value` would show 128 into the write-back mux and −128
out of it — a selector that appears to TRANSFORM its input, a worse and always-on lie. The honest fix
(draw the extender) spans three datapath files and is a µarch-view question, not a content one. So
the narration reconciles: it grounds "same byte, same address" in what is **visibly constant** (the
data-memory panel's `0x00000080`, unchanged across all 3 steps; the `0x10000000` arriving at Data
Memory on both loads) and names extension-inside-the-block as why the outputs differ. **`byte-loads.s`
is the ONLY corpus program where `mem-read.value` and `reg-write.value` disagree** (every other load
is an `lw`) — which is why nothing ever had to decide this. The orphan was hiding a VIEW decision.

**THE EXPERT TIER NAMED AN INSTRUCTION THAT IS NOT IN THE PROGRAM, and 919 green tests could not see
it.** The draft said `la` expands to `auipc t0, 0x10000`; the transport directly above disassembles it
as **`lui x5, 0x10000`**. `pseudo.ts`: `la` → `lui`(hi reloc) + `addi`(lo reloc), **absolute, not
PC-relative** — wrong twice in one sentence. Structurally invisible: the step anchors to a `reg-write`,
which is agnostic about WHICH instruction wrote the register, so anchor/value/order/narration-resolves
were all green. **THE RULE: an anchor pins a TRANSACTION, never the sentence wrapped around it** —
anything narration asserts beyond the anchored event (a mnemonic, an expansion, a cycle count, a claim
about another panel) is unguarded by construction. Now pinned via the recording's in-flight list
(`instructions[].decoded.mnemonic`), mutation-checked. Also: `la` emits the pair even when the low 12
bits are zero, unlike `li` (`materialize32` collapses to a bare `lui` when `lo === 0`) — which is why
the reader sees a second write to t0 that changes nothing.

Two smaller finds. **The first eyeball's checks were VACUOUS**: regexes for `-128`/`0x80` over
`document.body.innerText` match the SOURCE panel's own comments (`# t1 = -128 (sign-extended)`) —
green while proving nothing. Reading the real Registers table rows is what verified it (`t1` →
`0xffffff80`/−128 highlighted on its cycle, `t2` → `0x00000080`/128). A check whose case list cannot
reach the defect is not a check — this project's recurring shape, now one layer down in the DRIVER.
And **the transport disassembles to `xN` while the corpus writes ABI names**: the reader sees `lb x6,
0(x5)` above prose saying `t1`. The mirror of step 1's `ra`/`sp` find and much milder (the register
panel lists both spellings side by side), so step 1 bridges it in one clause. See
[[browser-is-the-only-net]], now corrected on the theme trick and the profile-dir advice.

## M5 STEP 3 DONE — `which-is-smaller` on the new `branch-flavors.s` (2026-07-17, 950 tests, `c9d7682`)

The scope question flipped: `call-return` could NOT carry it (its `bge` is already taught by
`function-call`, and taken-vs-not-taken is already taught by `sum-loop-tour`), and the signed/unsigned
trap was **definitionally invisible** on the old corpus — for every operand it ever compared, `blt`
and `bltu` agree. Not untaught: unreachable. That is the bar for a new corpus citizen, now written into
`content/programs/README.md`: **name what the existing corpus makes unreachable, not what a new program
would make nicer.**

**Steps 2 and 3 are a MIRRORED PAIR — the milestone's best finding.** Step 2 is "looks different, is
same" (the datapath shows −128/128 over byte-identical `mem-read`s); step 3 is "looks same, is
different" (`blt`/`bltu` show identical operand wires and decide opposite). Both fixed in narration,
not code, by one argument: **an interpretation never belongs on a wire** — the reading happens inside
the load unit / the comparator, and neither is drawn.

## M5 STEP 4 DONE — tracks + the sequencing pass (2026-07-17, 956 tests, `0aa61a1`)

**THE PLAN'S OWN TARGET ORDER WAS WRONG.** This step was meant to be a no-op on order — steps 1–3 each
inserted their lesson at the slot the plan named, so `index.json` already matched. It matched, and the
shipped track taught **`lb`/`lbu` at position 3 and `lw` at position 5: the exception before the rule.**
Forced by the lessons' own prose, so it became a test: `array-in-memory` step 1 _introduces_ the concept
("`lw t2, 0(t0)` reads a word from data memory into a register") while `sign-and-zero` step 1, two
lessons earlier, already _spends_ addresses, loads and the data-memory panel. Order is now
`first-program → sum-loop-tour → array-in-memory → sign-and-zero → which-is-smaller → function-call`;
the mirrored pair stays adjacent and in its cross-reference direction (`which-is-smaller`'s expert tier
calls back to `lb`/`lbu` — **a callback to a lesson the reader has not had is not a callback**).

**Why three steps missed it, and it is not carelessness:** steps 2 and 3 each wrote "step 4 is still the
real sequencing pass" and parked their lesson at the guessed slot — correctly, because authoring a lesson
reads its program and its anchors and **never reads the other five**. Incremental insertion structurally
cannot see a sequence. The only instrument is a person reading the track top to bottom, which is now the
README's instruction. **An order can be authored, exhaustive, self-consistent and fully pinned — and still
teach the exception before the rule.** Declaring the index only moves the decision to where a human _can_
make it; nothing makes them read it.

**Track is declared content (grouped `index.json`), NOT derived from `model`** — the picker shows the two
groups as `<optgroup>`s. `model` says which µarch a lesson RUNS ON; a track says what it is ABOUT; they
coincide by coincidence (all 6 language lessons are single-cycle). Deriving it would be step 0's
`localeCompare` a third time. Measured: **file `branch-bet` under "The language" → exactly ONE test of 125
reddens**, the by-name one; every structural check stays green (the mis-filing is still self-consistent),
and the retired `model` proxy stays green too (probed directly). Third milestone running for **pedagogy is
not derivable, assert it by name**. Not a `track` field on `Lesson` — pre-declined; one decision, one place.
Order is derived from the tracks by **flattening**, so grouping and order cannot contradict.

**The grouped picker had to RE-EARN step 0's totality rule** — a group-only render silently drops a lesson
in no track, trading a misplaced lesson for an invisible one, the exact trade step 0 refused, reintroduced
by the feature reading the same file. Hence a trailing `Not in a track` heading that renders only when
authoring is wrong.

**Naming: nothing renamed, deliberately.** The two riddle titles ("One byte, two answers", "When -1 is not
less than 1") are the two lessons whose subject IS a trap, so the title promising a surprise tells the truth;
the group heading supplies the frame they lacked. The two track names are the step's naming output.

**A logged claim from step 3 was FALSE:** the program picker does _not_ "open on `add` by alphabetical luck"
— `useSimulator.ts` explicitly prefers `sum-loop` (browser-confirmed on a fresh load). Its _list_ is still
alphabetical and stays so: a lesson picker's order IS the teaching, but the program picker is a **lookup**
surface, where alphabetical is predictable — the ISA panel already settled the same split (editorial order
for groups a learner reads, `sort` by register number for the lookup table). **Step 0's conclusion does not
transfer just because the code rhymes.** The check that found this was vacuous first: it read the picker
_after_ driving a lesson and reported that lesson's own program — a check measuring its own leftover state,
the eyeball's recurring failure mode for the fourth step running.

**NEXT: M5 step 5 — the hand-off the panel cannot make.** The track's closing beat should send the reader to
the editor ("now change the 37 and watch 42 move"). Nothing in the lesson format expresses "go edit"; the plan
says check whether prose alone is enough **before** proposing a field (it probably is). Acceptance: a reader
finishing the track has edited a program, and no field was added.

## M6 (CACHES — the third pipeline toggle) — PLAN pushed, **STEP 0 DONE** (2026-07-18, 967 -> 976 tests)

`docs/plans/m6-tasks.md` (headline: the cache is a **timing shadow**, holds no values ⇒ INV-8 green by
construction; direct-mapped, D-cache only, write-through/no-allocate, `missPenalty` fixed cycles). Step 0 is
the ONE milestone the spec gates on new corpus programs (§12.3), so it grows the library before any cache code.

**Step 0 — grow the corpus.** Added exactly one program, `content/programs/array-sum-twice.s`: an outer loop
of 2 passes over a 12-word inner walk, summing 2·(1+…+12) = 156 (a0=x10; outer counter t3=x28 lands 0). The
second pass resets the pointer and re-reads the same 12 addresses = **temporal reuse**, the cache-relevant
fact a single pass cannot exhibit. No cache code; pure regression, green across every model × config.

- **`array-sum.s` already serves as the clean spatial-locality walk** (16-byte line ⇒ its 5 words are one
  full line + one partial; `arr[0]` misses then `arr[1..3]` hit, the `total` store lands in the second line),
  so NO second program was authored — the README's reachability bar ("name what the corpus makes
  **unreachable**, not what a new program makes **nicer**"), applied. The README gained `array-sum-twice` as
  its second worked example, mirroring `branch-flavors`.
- **The locality-PUNISHER ("a bigger cache buys nothing") is DEFERRED to step 4 as a STRIDE, not a program.**
  §12.3/step 4 allow "a program **or a stride**"; a no-revisit stride over this array already has no reuse for
  any cache to capture. Authoring a program now = paper-design before the cache exists to test it (the M5
  failure this plan cites). Left as an open step-4 item, not dropped.
- **THE REUSABLE FINDING #1: an array program's size is CO-DESIGNED with the cache geometry, and step 0
  COMMITS the array.** The straddle only exists relative to (line size, small #lines, large #lines).
  `array-sum-twice`'s 12-word working set = 3 lines against a 16-byte line, and straddles a **2↔4 line** flip:
  fits the 4-line (repeat pass all hits, confirmed by a scratch direct-mapped model), overflows the 2-line
  (repeat pass re-misses). **Step 1's `CacheConfig` defaults MUST honor 16-byte line / 2↔4 lines or the
  straddle breaks** — pinned in the m6 decisions table AND the `.s` header AND the README, made that prominent
  on the advisor's flag that this cross-step coupling is the one thing a future session could silently violate.
- **THE REUSABLE FINDING #2: corpus program size is BOUNDED by two caps every M6 array program inherits.** The
  pipeline timing suite's `run()` throws at **500 cycles**, and `PipelineMapView` pages at **400 cycles**. A
  24-word ×2 walk is 254 retires / ~554 cycles — over BOTH. 12 words is 290 off / 208 on — under both, and is
  now the **longest program the corpus ships** (its 290 displaced sum-loop's 78 as the `PipelineMapView` "fits
  without paging" witness; paging stays a sandbox-only affordance). This is why the array is 12 words, not 24.
- **Step 0's tests are BLIND to the reuse property** (INV-8 equality is cache-oblivious — a buggy no-reuse walk
  would pass green), so it was hand-verified. But the oracle `a0=156` INDIRECTLY pins it: both passes must sum
  arr[0..11], and no other `.data` region sums to 78 (advisor's catch — better-guarded than the general worry).
- The `TIMING` entry (`timing.test.ts`) was **hand-derived from the pinned recurrence, not snapshotted** — the
  corpus's first NESTED loop. N=134, T=23, S_off=106 / S_on=24, P=2·23=46. One stall array-sum never had: the
  first `lw` of each pass is **distance-2** from the `la` (only `li t1` between) ⇒ interlocks 1 cycle
  forwarding-off, where array-sum's distance-3 `lw` is free. All matrix cases (both forwarding × both predict
  schemes) green first run. Files touched: the `.s`, `conformance.ts` oracle, `timing.test.ts` entry,
  `PipelineMapView.test.tsx` witness + describe-comment, README, m6 plan. No engine, no renderer, no new field.

### M6 STEP 1 — THE TIMING SHADOW (pure, called by nothing) — DONE (2026-07-18, 976 -> 985)

`CacheConfig` filled in `trace` (`lineSize`/`numLines`/`missPenalty`, all readonly) + `engine/pipeline/src/cache.ts`:
a pure timing shadow (`CacheLine = {valid, tag}`, **NO value field** — memory stays sole truth ⇒ INV-8 green by
construction), `access(state, config, addr, allocate) → {hit, evicted?}` MUTATING single-buffered state; decode
helpers `lineIndex`/`lineTag`/`blockBase` (for step 6's view, INV-3); geometry pinned as `LINE_SIZE_BYTES=16` +
`directMapped(numLines, missPenalty=10)` + `CACHE_SMALL`(2 lines)/`CACHE_LARGE`(4 lines). **Imported by its own test
only, not `index.ts`** (M4-step-0 inertness). Deliverable `cache.test.ts` (9 tests, all green first run) CLOSES step
0's hand-only co-design claim MECHANICALLY: drives the REAL cache-off engine over `array-sum-twice.s`, harvests the 24
`mem-read` addresses (`length===24` + `slice(12)===slice(0,12)` = the temporal reuse), replays both configs, asserts
the FULL hit/miss/evict verdict SEQUENCE (5 misses/3 evicts on 2-line vs 3/0 on 4-line — never an opaque total).
Non-circular _because_ the timing shadow makes the address stream cache-invariant. Findings: `evicted` = evicted
block's **base byte address**; `allocate` (load→true, store→false = no-write-allocate) is a pure MECHANISM knob, the
policy NAME lives at step 2's MEM call site. **Stall-machinery scout at the foot of `cache.ts`:** the load-use stall
is a ONE-SHOT boolean (recomputed each cycle) that CANNOT express a multi-cycle hold — a miss needs a persistent
`missCyclesRemaining` countdown in the ExMem latch, reusing the reverse-walk signal shape but FREEZING IF/ID/EX.

### M6 STEP 2 — THE PIPELINE HONORS `config.cache` (variable-latency MEM) — DONE (2026-07-18, 985 -> 999)

The machine's **first variable-latency stage.** `processor.ts`: `stageMem` splits three ways — **mid-stall**
(decrement `missCyclesRemaining`, do NOT re-consult: a second `access` would spuriously hit), **fresh-arrival miss**
(consult once via `consultCache`, install tag, hold), **hit/no-cache/release** (the cache-less MEM, unchanged). A
miss raises `ctx.memStall`; `holdInMem` re-presents the occupant in `next.exMem` with the countdown and leaves
`next.memWb` null (the WB bubble); EX/ID/IF read `memStall` later in the reverse walk and FREEZE their occupants.
The new primitive is `ExMemLatch.missCyclesRemaining` (0 at rest, set to `missPenalty` on detection, ticked down,
rides double-buffering into `micro`); `PipelineMicro` gained `cache: CacheState|null` **deep-copied per snapshot**
(single-buffered, like memory). `configurableCache` flipped `true`. **Zero new trace-schema fields** — `cache-access`
already existed; the only additions are engine-internal `micro`/latch shape.

- **Deliverable `cache-stall.test.ts` (14 tests, all green first run), four layers:** (1) **wiring bridge** — the
  REAL engine's cache emits the EXACT `cache-access` token sequence step 1 pinned against the replayed model stream
  (closes step 1's cache-invariance loop; step 1 = "model given this stream", step 2 = "the engine's own cache").
  (2) **mechanism** on a minimal program at penalty 3: one miss holds MEM for penalty+1 cycles, ticks 3→2→1, freezes
  EX, fires `access`/`mem-read` EXACTLY ONCE. (3) **pinned cycle counts** — the `+M` term (`M = misses×missPenalty`)
  as a COMPOSITION of two already-pinned facts (cache-off cycles from `timing.test.ts`, miss counts from
  `cache.test.ts`), never a snapshot: OFF null 290 → SMALL **340** (the plan author's own committed `290+5×10`,
  reproduced deliberately — the strongest wiring evidence) / LARGE 320; ON null 208 → SMALL 258 / LARGE 238, plus the
  subtraction form `on−off = misses×penalty`. (4) **INV-8 locally** (cache-off vs SMALL byte-identical, a0=156) + the
  recorder **deep-copy witness** (cycle-0 cache all-invalid, final warm, distinct objects).
- **Additivity is EXACT and structural, not arithmetic luck** (advisor-confirmed): 10 frozen + 1 productive release =
  11 MEM cycles = `1 + missPenalty`; the load-use bubble is decided in EX one cycle before the miss is detected in
  MEM, so bubble + freeze compose SEQUENTIALLY; and this corpus's loads sit structurally clear of every branch resolve.
  So each miss adds exactly `missPenalty`, no overlap. (Holds _for this corpus_ — all step 2 claims.)
- **Two pre-existing whole-object `toEqual`s in `processor.test.ts` broke and were fixed as EXPECTED step-2 changes,
  not worked around:** `configurableCache` now `true`, and the `micro` snapshot literal gained `cache: null` (cache-off).
- **Scope discipline:** full config-matrix conformance is **step 3** (the `configLabel` cache clause); the per-term
  `N+4+S+P+M` decomposition + "no size dominates" signed deltas is **step 4** — deliberately NOT built here.

## M6 STEP 3 DONE — the corpus runs its (invisible) cache three ways (2026-07-18, 1087 tests, `<committed>`)

Extended the INV-8 differential to the cache axis and wrote the `configLabel` cache clause the comment reserved.
Three files, no engine change:

- **`differential.test.ts` (pipeline):** `CONFIGS` grew from 2 forwarding × 3 predict (6) to the full **× 3 cache**
  cross product (18 configs → 128 pipeline cases). `cache ∈ {null, CACHE_SMALL, CACHE_LARGE}`, imported from
  `./cache` — legal because the test lives IN the pipeline package (conformance itself cannot import them: it sits
  BELOW pipeline in the DAG, so importing would invert it). **Every cache cell is green BY CONSTRUCTION** — the
  timing shadow holds no values, so cache-off / SMALL / LARGE all agree with the value-less golden reference. This
  turns "INV-8 green by construction" from an _argument_ (M4 argued "speculation never commits") into a _mechanical
  net_: a cache bug LEAKING into state (stale value returned, eviction corrupting a word) is caught HERE and nowhere
  else — the timing suite would see a wrong cycle count, never a wrong answer. `CACHE_SMALL` (2 lines) is the
  load-bearing value: the only config exercising the eviction path. The predict × cache cells are where a miss-stall
  and a branch flush contend for a cycle — where a leak would hide — so the full cross product, not a diagonal.
- **`configLabel` clause (`conformance.ts`):** `cache` is the first OBJECT-valued knob, so "does it vary" is a
  `cacheEquals` **deep compare** (all three geometry fields) not a `!==`, and its rendered value a `cacheLabel`
  canonical string (`cache 2×16B/p10` = numLines×lineSizeB/p missPenalty), not a scalar. **The load-bearing
  invariant across the pair: `cacheLabel` renders EXACTLY the fields `cacheEquals` distinguishes**, so
  `cacheEquals(a,b)===false ⟹ cacheLabel(a)!==cacheLabel(b)`. Why it must hold: two configs differing ONLY in cache
  share their forwarding/predict labels, so the cache label is the ONLY thing left to tell their titles apart — a
  label that collapsed distinct caches to one string could not name which config broke (M4's exact defect, one axis
  down). **Chose Option A (deep-equal all 3 + render all 3) over a "name only the sub-fields that vary" cache render**
  (advisor-confirmed) — the clever version REOPENS the gap: equality would call two configs distinct while the label
  called them the same, and you'd then need a guard that the sub-renderer is itself injective. The mild wart (scalars
  stay silent when constant, but the cache renders constant subfields like `/p10`) is the acceptable price of the
  coupling; resolving it is the trap.
- **Harness suite (`conformance.test.ts`):** added a **THREE-axis** case list (forwarding × predict × cache) so the
  distinctness guard's case list can REACH a cache-label collision — the case list must vary the cache, exactly as
  M4's had to vary prediction (_a guard whose case list can't reach the collision is not a guard_). **Did NOT mutate
  `MULTI_AXIS`** (its "varies TWO knobs" comment + `6 * corpusSize` length assertion stay accurate — the advisor
  flagged repurposing it would make both stale). Plus the **load-bearing silence-when-all-off assertion**: a matrix
  where every config leaves the cache off must not mention it — this is what keeps the single/multi-cycle differential
  suites and the M3/M4 two-knob guards **byte-identical** (they all pass `cache: null`). Inline
  `{lineSize,numLines,missPenalty}` objects there, NOT the pipeline constants (DAG again).
- **No `RESULT_ORACLES` / `checkProgram` change** (cache is architecturally invisible — every cache cell green by
  construction _is_ the net). Pipeline differential count jumped ~3× as expected; nothing asserts the old total.
  Typecheck + lint clean; all green first run.

**M6 STEP 4 DONE** (see MEMORY.md index for the full writeup) — closed form gained its miss term
`cycles = N+4+S+P+M`; the "no size dominates" thesis shipped as signed deltas (straddler +20, punishers 0); the
step-0 punisher needed NO new program (`array-sum.s`, single pass, is it). A bigger cache **weakly** dominates here
(never worse), not the strict two-way bet M4 had.

**M6 STEP 5 DONE** (2026-07-18, 1184 → **1221 tests**, +37) — the web cache toggle. A `CacheToggle` in the shell's
knobs row beside forwarding & prediction, gated on `configurableCache`, riding M3's config seam with **zero
widening** (mirrors the two prior toggles: `useSimulator` `cache` state+ref → `loadInto`; `session.lessonOpening`
honors a declared config's cache as a THIRD whole-or-nothing knob). **The one honest asymmetry: the control has
THREE positions `[off][small][large]`, not two** — off/small/large are three DISTINCT machines (off emits no
`cache-access`; small/large diverge only on a straddling working set), so all three move something and a two-part
on/off+size control would violate _a control that cannot move anything is worse than no control_ (the size half is
inert while off). Value written is always one of three stable constants (`null`/`CACHE_SMALL`/`CACHE_LARGE`), now
**exported from pipeline `index.ts`** so toggle + sweep + timing share ONE geometry ("no widening" is about the
config SEAM, not a ban on exporting constants; a different geometry would de-straddle `array-sum-twice`). **Findings:**
(1) **The advisor-flagged sweep risk did NOT materialize.** Adding a 3-position cache axis to `CONFIG_AXES` (pipeline
sweep 4→12) could have collided two of `forwarding-bubble`'s steps on a cycle (it runs on `array-sum`, which has
loads+misses) — but all 12 green first run, no validator special-case. Structural reason: a miss freeze only ADDS
cycles (collisions come from COMPRESSION, which forwarding-on already survives) AND emits **no `stall` event** (only
`stageId`'s load-use hazard does, `processor.ts:1108`), so the cache is invisible to the `stall reason:raw` trigger
the lesson anchors on. **The discriminating grep (does the freeze push a stall event?) is the check to run before
fearing a sweep collision.** (2) **First view step in the project's history to ship with NO browser-caught defect** —
the pattern from the two prior toggles was mechanical enough that the seam absorbed the third knob with nothing to
discover (the plan's "cheaper than M4" promise, realized). Still eyeballed for real (scrub max 289→339→319 as
off→small→large; control absent on single/multi-cycle; renders as a coherent bar, no wrap). **Zero engine / renderer /
trace-field / lesson-JSON change** (both pipeline lessons already declared `cache: null`). Live scrub-bar figures
pinned through the shell's load path in `simulator.test.ts` (`array-sum-twice` off 290 / small 340 / large 320
fwd-off; punisher `array-sum` small==large; INV-8 identical state; single-cycle inert); `models.test.ts` mirrors the
capability gate (exactly one model honors the cache).

**M6 STEP 6 DONE** (2026-07-18, 1221 → **1236 tests**, +15) — the cache grid VIEW. A `CacheGrid` STATE panel below
the pipeline datapath (above the memory panel it shadows): one row per line showing valid + the block it holds as a
BYTE RANGE (the human form of a huge tag, via re-exported `blockBaseOf`), the line touched this cycle called out
hit/miss/evict/**filling** — each a hue AND a word (relief rule). Two-halves shape like the MAP (not the SVG
datapath): pure fold `buildCacheGrid(trace, config)` (`cache-grid.ts`, 8 tests vs the real engine) + HTML view
(`CacheGridView.tsx`, 7 render tests). **Zero new trace field / engine / renderer change** (the last decision in the
m6 table lands NO). One export change: pipeline `index.ts` re-exports the READ surface (`CacheState`/`CacheLine` +
pure `lineIndex`/`lineTag`/`blockBase`/`blockBaseOf`); `access`/`newCache` stay private — comment rewritten to "read
the cache = public, run it = private". **Four decisions, three advisor-flagged BEFORE any highlight logic:**

- **STATE view, not dataflow — so it reads `micro`, and that is NOT the datapath's `micro` trap.** State panels
  (reg/mem/this) show the post-cycle-`i` result, so `micro.cache`'s post-install tags are exactly right (the datapath
  reads `instructions[].location` instead precisely because it draws transient mid-cycle dataflow). **Pinned against a
  real trace dump before designing:** on the fresh-miss cycle the `cache-access` event and post-install `micro.cache`
  share that cycle. This empirical-first discipline is why steps 5 AND 6 are the ONLY two view steps in project
  history with no browser-caught defect — the trap that bit every datapath step was designed around, not discovered.
- **The freeze is DRAWN (load-bearing).** A miss freezes IF/ID/EX for `missPenalty` cycles; only the fresh-arrival
  cycle emits `cache-access`, the ~10 penalty cycles emit none. Keyed only on the event, the panel would go dark
  mid-stall while the map shows `MEM MEM MEM`. So when `micro.exMem.missCyclesRemaining > 0` with no event, the served
  line is derived from the stalled load's `micro.exMem.aluOut` and shown `filling` + countdown — no new field.
- **HTML following the MAP, not the SVG datapath.** The plan cited "M3 step-6 geometry litmuses" — those are SVG
  polygon/wire tests a table has none of; corrected to the map's fold + render-smoke-test shape (deviation owned).
- **Size flip visible on the structure:** small (2 lines) evicts block 0 on line 0; large (4 lines) gives block 2 its
  own line, eviction gone. Pinned at the view layer + browser-eyeballed both sizes + both themes, no defect. Gated on
  a TRACE fact (`recorded.some(t => micro?.cache != null)`), mirroring the map's `hasOverlap` — panel absent cache-off.

**M6 STEP 7 DONE — M6 IS COMPLETE** (2026-07-18, 1236 → **1337 tests**, +101) — the cache TRACK. Three lessons in a
NEW `The cache` track (after `The machine`), in the order fixed in the plan and reviewed AS a sequence (M5's finding
applied up front), pinned by name in `lessons.test.ts` (`cache-spatial < cache-temporal < cache-conflict`, forced by
the prose: temporal presupposes the line-fill, conflict presupposes the reuse):

- **`cache-spatial`** ("A line, not a word", `array-sum`, LARGE, forwarding on): first touch misses and drags in a
  16-byte line; the next three loads HIT; arr[4] misses at the block boundary; payoff a0=120, "five loads, two misses".
- **`cache-temporal`** ("Come back and it is still there", `array-sum-twice`, LARGE): pass one compulsory-misses three
  lines; pass two revisits arr[0] and HITS (all 12 hit); payoff a0=156. Revisit-hit step is SIZE-EXCLUSIVE (dead small).
- **`cache-conflict`** ("Too small to hold it all", `array-sum-twice`, SMALL): block 2 evicts block 0 in pass one; pass
  two re-misses arr[0]; flip to large ⇒ eviction gone; payoff a0=156, "5 misses small / 3 large", symmetric flip prose.
  Eviction + re-miss steps SIZE-EXCLUSIVE (dead large).
  **Anchors on `cache-access` events (hit/miss/evicted/addr), never cycle numbers (INV-6). That event carries NO `instr`
  field, so oracles pin `addr`/`hit`/`evicted` directly (no pc to pin like the hazard oracles do — the addr IS the
  identity).** Size-exclusive steps ride the sweep's "fires in ≥1 position" licence (branch-bet's shape); all 12 pipeline
  positions green FIRST RUN, no validator special case (the size axis TRIPLES the sweep as prediction doubled forwarding).
- **THE IDENTITY TRAP, reconciled by CANONICALIZING at LOAD (not switching to deep compare):** `canonicalCache`
  (`lessons.ts`) maps a lesson's JSON-declared geometry back to its shipped `CACHE_SMALL`/`CACHE_LARGE` constant when
  `LESSONS` is built, via a new PURE `cacheEquals` (`session.ts`, no engine import — mirrors conformance's). So the
  shell STILL only ever holds one of three constants ⇒ `setCache`'s `===` guard and `CacheToggle`'s `===` lit-detection
  are UNCHANGED (their step-5 caveats rewritten to "reconciled at load"); the deep-compare-everywhere option was
  DECLINED to keep the "always one of three constants" contract TRUE rather than paid-for per comparison. A shipped test
  pins every declared cache is `===` a constant (a future typo'd geometry, lighting no toggle position, reddens).
- **THREE findings tests could NOT catch, all surfaced by discipline/review:** (1) **A STORE emits a `cache-access`
  too** — `array-sum`'s `sw a0, 0(total)` is a 6th access (a hit), ABSENT from `cache.test.ts`'s loads-only verdict list
  — so spatial counts LOADS (5 loads, 2 misses), not accesses (6). Caught by DUMPING the real `cache-access` stream per
  (program × config) before pinning any `nth` — the pin-against-a-real-trace ritual. (2) **A re-miss on a FULL cache is
  badged `EVICT`, not `MISS`** (the re-fetch also evicts — the two blocks thrash); the BROWSER caught the mismatch and
  conflict's step-3 prose now owns the eviction + deepens into thrashing. (3) **A step alive in ALL positions must be
  CONFIG-AGNOSTIC when the lesson invites the flip** (advisor-caught, the recurring "alive in N positions ⇒ true from
  all N" class): conflict's INTRO baked in "holds only two lines", FALSE under the large cache its own payoff invites
  ("flip between small and large") — so large is ON-PATH, not off-path degradation. The tell: the other four intros are
  config-agnostic; only this one wasn't. Fix = frame the experiment ("the cache size is the variable"), let the
  size-EXCLUSIVE eviction/re-miss steps carry the small-only facts. Contrast `cache-temporal`'s "big enough" (also
  all-positions) which is SAFE — it never invites a flip to small, so small is off-path degradation (tolerated, like
  forwarding-bubble's intro on single-cycle). The distinction: does the lesson's own prose steer the reader to the
  other position? If yes, both are on-path.
- **Browser-verified all three lessons (the `claude-in-chrome` driver on a fresh `npm run dev` I owned + killed by
  PID):** the reconcile lights the RIGHT toggle for small AND large (the step-7 trap, closed); the grid's
  MISS/HIT/EVICT/FILLING match the prose; the size-exclusive rail re-forms (conflict drops 4→2 steps on the flip to
  large); the intro reads true under large after the fix; payoffs read a0=120/156 in the register panel. **Third
  lesson-authoring step: the browser + advisor caught narration issues (an EVICT-vs-miss clarity mismatch, an intro
  false-on-the-invited-position), not a shipped correctness bug.** M2 step 5c stays deferred, independent.
- **CAUTION (self-inflicted, recovered):** editing this repo's UTF-8 docs with PowerShell `Get-Content`/`Set-Content`
  round-trips CORRUPTED all multibyte chars (→ — × became mojibake, 179 instances). Use the **Edit tool** for `.md`
  files, never PS Set-Content. Reverted with `git checkout` and redid via Edit.

**STEP 5C — M2's last open item, DONE 2026-07-20 (1352 tests, commit `86382a5`). M2 IS NOW FULLY
COMPLETE with no deferred work.** "Draw the next-PC redirect", which had been deferred since
2026-07-13. Findings worth keeping:

- **"5c" named TWO different jobs, and the fork had to go to the user.** A cheap VIEW-only version
  (draw `pcarith`'s wires + jalr's ALREADY-EXISTING ALUOut→PC — jalr has an EX today, its target is
  in the trace, merely undrawn) vs the ENGINE version the plan doc defined. User picked the engine
  version. **Always surface this fork before editing** — the payoff of the expensive version is a
  view improvement on a layout that had never been browser-verified.
- **INV-7 does NOT block per-model event-stream divergence.** INV-7 is one ISA / one assembler /
  one program library — nothing more. Models are SUPPOSED to differ in events (single-cycle emits
  no stall/flush; the pipeline does). INV-8 pins only final architectural state, so a cycle-count
  change keeps the differential green BY CONSTRUCTION. The m2 plan's "(INV-7)" citation for
  cross-model `alu-op` consistency was a **loose hang** — the real value there was pedagogical
  least-surprise. Don't treat a cited invariant as a gate without re-reading it.
- **The pinned table moved by exactly two rows: `jal` 3→4, `auipc` 3→4** (they gain EX). `lui`
  stays 3 and is now **alone** in the IF/ID/WB class; `jalr` stays 4; branches stay 3. The
  generating rule never changed — what changed is WHICH instructions use the main ALU.
- **The load-bearing line: `pc+4` deliberately does NOT go through the ALU.** A dedicated PC+4
  incrementer supplies the sequential PC and the jump link. P&H's multi-cycle FSM computes `pc+4`
  in the ALU during IF; copying that would add an `alu-op` to EVERY instruction's IF and buy
  nothing. Resolving this ambiguity BEFORE coding is what kept the blast radius at 4 test edits.
- **THE COST NOBODY PREDICTED: the view needed a 4th mux (ALUSrcA).** The multi-cycle datapath had
  only 3 (IorD/ALUSrc/MemtoReg) and the ALU's A operand was hardwired to the A latch. Once the
  trace says the ALU computed `(pc, imm)`, **INV-3 REQUIRES PC to visibly reach the ALU** or the
  picture contradicts the trace — the exact defect 5c set out to fix. So it's forced, not polish
  (and is textbook-canonical). **Generalize: "make the engine emit event X so the view can draw
  it" routinely forces new VIEW structure too — budget for both halves.** `jalr` needed no mux
  (its A operand genuinely is `Reg[rs1]`), which let the redirect wire land and be validated
  independently of the mux.
- Other engine→view knock-ons, all easy to miss: `aluBIsImm` was `format === I|S` and had to gain
  J/U or jal/auipc silently read the **B latch**; `auipc` moved from the `pcarith` branch to the
  `aluout` branch at WB; `pcarith` lost its immediate input and shrank to a pure incrementer.
- **The redirect must sit OUTSIDE the `regWrite` guard.** `jal x0` / `jalr x0` (i.e. `ret`!)
  write no register, and that is exactly when the redirect is the jump's ONLY visible effect.
- **Browser: PASSED CLEAN — only the 2nd view step ever to do so here** (step 5 was the 1st), and
  it also discharged 5b's long-outstanding layout verification. `ret`'s WB lighting the redirect
  as the diagram's sole wire is the single best demonstration of what 5c bought.
- **Browser-driving gotchas (this app):** the page's SOURCE text trips a tool content filter — read
  programs from `content/programs/*.s` on disk instead. Wires carry **no ids in the DOM**; identify
  them by their `points` geometry (the redirect is the only wire on the `y=460` rail). Setting the
  scrub `input[type=range]` via the native value setter **times out CDP and queues up stale
  states**; a plain synchronous `for(...) stepBtn.click()` with NO awaits is reliable.
- **Repeat of a known trap, cost ~1 tool call:** used PowerShell here-string `@'...'@` inside the
  **Bash** tool for a commit message → a literal `@` line at both ends of the message; fixed by
  `--amend --file=- <<'EOF'`. Bash tool = POSIX heredoc, PowerShell tool = here-string.
- **THE NEAR-MISS WORTH REMEMBERING — adding events to a model can silently SHIFT LESSON `nth`
  ANCHORS.** 5c added `alu-op`s to jal/auipc, and INV-6 anchors are `{event, nth}`. An anchor that
  shifts to a **wrong-but-existing** event still passes `lessons.test.ts` (it only fails when an
  anchor finds NOTHING) and is wrong only in the browser — precisely the 9-of-10 defect shape.
  **Ruled out here, and the check is the reusable part:** `grep '"model"' content/lessons/*.json`
  → all 11 lessons are single-cycle (6) or pipeline (5), **ZERO multi-cycle**, so nothing could
  shift. (`function-call`, the jal/jalr lesson, is single-cycle.) **Run this grep any time you add
  or reorder events in ANY model** — and note the standing implication: multi-cycle currently has
  no lesson coverage at all, so its event stream is only ever exercised by Free Play.

**STEP 5D — the taken-branch redirect, DONE 2026-07-20 (1354 tests, commits `56ec9de`/`152a54d`).**
The last stated INV-5 omission on the multi-cycle datapath, closed the same day 5c shipped.
Findings worth keeping:

- **5d was VIEW-ONLY where 5c needed an engine change — and that asymmetry is the lesson.** 5c had
  to change the engine first because the trace carried no `alu-op` for PC arithmetic. 5d needed
  nothing: `inst.pc` and `decoded.imm` were already in the trace, so "draw what the trace says"
  cost only routing. **Before assuming a drawing gap needs an engine change, check whether the
  trace already carries the inputs** — deriving a value from two trace fields is lawful under
  INV-3 (which forbids reading engine INTERNALS, not arithmetic on trace values).
- **The stated-omission discipline paid off, concretely.** The 5c header comment named the missing
  component precisely ("its target is `pc+imm`, not in ALUOut, so it needs a separate branch
  adder"). Closing it was then a contained step, not a re-derivation. **Worth doing again: when
  you omit something lawfully, name the exact missing component, not just the missing behavior.**
- **A shared ALU can't do double duty: a branch's ALU holds the COMPARE result (`taken?1:0`), never
  the target.** That's the whole reason textbook datapaths carry TWO adders. The fix was
  `branchadd` (`pc + imm` from PC + sign-extender) — real hardware, not a drawing convenience.
- **The redirect rule generalized to "the next-PC wire lights at RETIRE"**: WB for the jumps (they
  write a link), **EX for a branch** (its last phase — branches are IF/ID/EX, no MEM/WB).
- **Taken-ness is READ from the trace, not recomputed**: the compare's own `alu-op` result IS the
  condition. Gated inside `if (aluOp)` on `format === 'B' && result === 1`.
- **Drawn at EVERY tier — the structural asymmetry with 5c.** The adder is DATAFLOW, not a
  selector, so it needs no contraction-wire machinery (unlike 5c's 4th mux). Only muxes get the
  minTier/contraction treatment. It did break `DatapathDiagram.test.tsx`'s `<polygon>` count
  (2→3 essentials, 6→7 detailed) — that count is the tripwire for any new mux/adder.
- **THE BINDING LAYOUT CONSTRAINT on this diagram is the 0.5px collinearity test**, not the canvas
  or the box-overlap test. PC's top AND bottom edges were already fully spoken for (pc+4 riser,
  ALUSrcA riser, the `aluout→pc` bottom rail), so the new redirect had to use the only free routes
  left: the **`y=32` top rail and the empty `x=14` left margin**. Bonus, and it reads better: it
  enters PC on the OPPOSITE side from the jumps' redirect, so the two sources look like two
  sources. **Compute rails against existing segments before writing coordinates; then let the test
  confirm rather than eyeballing.**
- **Browser: PASSED CLEAN — the 3rd view step ever to do so here.** Taken `bne` (sum-loop cycle 18):
  PC → branch adder → PC labelled `0x10 + (-8) = 0x08`, `aluout→pc` dark. Loop-exit `bne`
  (cycle 117): compare only, adder dark. The contrast between those two cycles IS the pedagogy.
- **Remaining stated omission shrank to the undrawn PCSource mux** — CLOSED BY 5e, below.
- **Bash tool ≠ PowerShell here-strings.** `git commit -m @'...'@` in the Bash tool leaked a literal
  `@` into the subject line. Bash tool = POSIX heredoc (`-F - <<'EOF'`), PowerShell tool = `@'...'@`.
  (Same trap recorded under 5c, hit again — reach for `-F - <<'EOF'` by default.)

## STEP 5E — the PCSource mux (2026-07-20, 1357 tests). M2 now has NO stated omissions left.

- **THE LESSON: a stated omission that names a missing SELECTOR can quietly understate itself.**
  The 5c/5d header said "PC has three drivers, no PCSource mux drawn". Going to draw the mux
  surfaced that one of the three drivers it named — the **sequential `pcarith → pc`** — had no
  wire either. `pcarith` fed only the writeback mux (the jal/jalr link), so "PC ← PC+4", the
  thing EVERY instruction does, had never been drawn in this diagram. **When closing a
  stated-omission note about a selector, check that every input it would select is itself drawn.**
- **A 2-input mux would have been the same lie in a smaller box.** A selector whose commonest
  input never lights is worse than no selector. Closing the sequential loop was the heart of the
  step, not scope creep.
- **View-only, like 5d** — `pc + 4` derives from the trace's own `pc` (RV32I fixed-width), so
  INV-8 is untouched by construction. Lighting rule = 5d's generalized once more: the sequential
  arm lights **at retire**, which is WB for most, **MEM for a store, EX for a not-taken branch**.
- **The mux could NOT go where the textbook puts it.** PC sits 28px from the canvas edge and a mux
  takes inputs on its left VERTICAL edge, so directly-left leaves no room for three separated feed
  rails (collinearity test, 0.5px eps, is this diagram's binding constraint — same as 5d). It went
  **below-left** of PC at `(90,330,22,100)`, the one spot all three sources reach a left edge on
  separated rails: `pcarith` x=82, `aluout` x=70, `branchadd` x=14. The three essentials
  contractions land on three DIFFERENT PC edges (left mid, left+12, bottom) so they never merge.
- **One test had to be RE-EXPRESSED, not suppressed** — and this is the reusable move. `auipc`
  asserted `pcarith` was dark: a 5c-era proxy for "auipc's writeback comes from ALUOut". 5e breaks
  it _correctly_ (auipc's next PC genuinely is pc+4, so the incrementer IS lit). Fix = assert the
  real intent (`pcarith-wbmux` absent). Special-casing auipc out of the sequential rule would have
  been the lie sneaking back in. **When a new truth breaks an old proxy assertion, re-express the
  assertion's intent; don't carve an exception into the new rule.**
- **THE REAL DEFECT WAS FOUND BY NEITHER TESTS NOR THE BROWSER — but by noticing an UNVERIFIED
  CLAIM in a header comment.** First cut keyed the sequential arm off `instr-retire` alone. But
  the multi-cycle engine pushes `instr-retire` **unconditionally** at the last phase, and on an
  architectural halt (`ecall`/`ebreak`/unknown) it then leaves `pc` PARKED
  (`processor.ts`: `if (cur.plan.halt) { this.halted = true } else { this.pc = cur.plan.nextPc }`).
  So `ecall` would have drawn `PC ← pc+4` while the trace said PC never moved — the view
  CONTRADICTING the engine (INV-5 violation), not the lawful omission it resembles. **And the
  header comment had RATIONALIZED it** ("the machine stops for reasons outside this diagram").
  Fix: key the arm off the trace's committed **`state.pc`**, not a computed `pc + 4` — strictly
  better, it's the real next PC instead of a guess that's merely right for every non-halting case.
  `fence` falls through and lights; `ecall` doesn't and stays dark. **RULE: if a header comment
  asserts behaviour for a case, that case must actually have been OBSERVED — a claim with a
  rationalization attached is the shape a bug hides in.** (The browser had looked only at ecall's
  FETCH, one cycle before its retire — right instruction, wrong cycle.)
- **`instr-retire` ≠ "pc advanced"** on this engine. Any future view keying off retire must check
  `state.pc`, not assume fall-through.
- **Browser: passed clean on all the arms it was pointed at** (2nd view step here after 5c to find
  no LAYOUT defect — but see the halt defect above, which layout verification could not catch).
  Verified all
  three arms + both tiers: `addi` WB shows `pc → pcarith → pcsource → pc` (`0x0 → 0x4`); `jal` WB
  shows link-out-via-MemtoReg AND target `0x18` through PCSource with the sequential arm dark;
  taken `bne` (cycle 18) shows the branch-adder arm → `0x08`; fetch leaves the mux dark;
  essentials collapses all five muxes and gives PC three visually distinct arrows.
- **Also bumped:** `DatapathDiagram.test.tsx` polygon counts (3 adders at essentials; 8 at
  detailed = 3 adders + 5 muxes) and the tier test's `MUXES` list, which had silently been missing
  `alusrca` since 5c — add new muxes to that list or they go untested.

See [[workflow-rituals]] for how batches/sessions end. Deeper µarchs remain a
don't-foreclose flag ([[future-microarchitectures]]).

## M7 — in-order superscalar (roadmap tier 4). ✅ COMPLETE: steps 0–8 DONE 2026-07-20 (2142 tests)

**M7 IS COMPLETE. Every step and every acceptance box is ticked, and the decisions table has NO
open rows left.**

**Load-bearing M7-step-8 findings (the pairing readout + IPC tile):**

- **THE OBVIOUS RULE IS A LIE, AND ONLY A DUMP COULD SHOW IT.** "A `stall` event names the refused
  instruction, so no stall ⇒ they paired" survives every hand-reasoned case, then fails on the
  flagship cache program: `array-sum.s` at width 2 / small cache holds `ID.0=i5, ID.1=i6` frozen
  cycles 6–14 with **NO `stall` event on any of them** (a miss-freeze emits none — the M6 finding).
  The naive readout announces "paired, issuing together" for nine straight cycles while nothing
  moves. Note the M7 plan's own seed proposed exactly this rule — the event was declined for a
  BETTER reason than the one offered.
- **THE GENERAL LESSON, worth more than the bug: reading the RESULT beats enumerating the REASONS.**
  The naive rule needs a COMPLETE list of every way an issue can be blocked (pairing refusal,
  ordinary hazard, flush, miss-freeze) and there is no way to know the list is finished — the freeze
  hole is exactly a missing enumeration case. `micro.idEx` IS who issued, so blocked-ness cannot be
  under-counted and the panel never has to know WHY in order to avoid claiming they went. Reach for
  this shape whenever a view must decide "did X happen" from event absence.
- **The licensing identity, verified not reasoned: `micro.idEx@N` === the `EX.<slot>` occupants at
  N+1** — 3 hand-written refusal programs + the whole corpus at 2 widths × cache on/off (28 configs,
  ~1600 cycles), zero mismatches. GUARDED in the suite because breaking it fails **silently**. This
  is NOT the datapath's one-cycle-ahead `micro` trap: that trap is reading `micro` for CURRENT
  occupancy; here being a cycle ahead is the entire point.
- **The browser caught the defect again (10th of 11 view steps): THE PANEL VANISHED AT PRE-RUN.**
  Keying it on the cursor's trace meant `trace === null` at cycle -1 hid the whole section —
  including the IPC tile, a whole-recording figure that is meaningful before the first step. Load a
  program, flip the width toggle, never press step ⇒ see nothing. **No test here can scrub a
  cursor** (`renderToStaticMarkup`, no jsdom). Fixed by `readPairingPreRun`.
- **AN OBSERVED CYCLE NUMBER IS ONLY VALID FOR THE CONFIG IT WAS OBSERVED IN.** The flush test first
  cited cycle 18 read off the cache-ON dump and asserted it against a cache-OFF recording, where 18
  is an ordinary `load-use` stall. It failed loudly; the same slip onto a cycle that happened to
  agree would have passed while demonstrating nothing. Sharpest form yet of observe-then-assert.
- **`refused` ≠ `blocked`, deliberately.** Refused = the older issued and a younger did not (the
  machine kept progressing); blocked = nobody moved. One "stalled" chip would erase the tier's own
  lesson. The split falls out of the `micro.idEx` reading for free.
- **The readout does NOT agree with the datapath at the same cursor and must not be read as if it
  did** — its subject is the pair in ID; the dark `ALU 1` is one cycle later. The surface that agrees
  AT THE CURSOR is the **pipeline map** (a refusal = a visible stagger + the slot slide). The panel
  states this on itself rather than letting a reader find it as an apparent bug.
- Browser-verified: `sum-loop.s` forwarding ON, `1-wide → 2-wide` without reloading ⇒ IPC
  **0.61 (34 ÷ 56) → 0.77 (34 ÷ 44)**; `array-sum.s` c10 reads `REFUSED · intra-pair-raw`, slot 0
  `lw` issued / slot 1 `add` held. The tile shows the honest cycle COUNT (56), not the 0-indexed
  cursor (55). `array-sum.s` and `sum-loop.s` both retiring **34** is a real coincidence, not a
  stale constant (others read 134/9/6/9) — checked, because a frozen numerator is what a broken
  view-derived counter looks like.
- **The `issue` trace event is DECLINED WITH PROOF** — pair from `location`, reason from the existing
  `stall`, who-issued from `micro.idEx`, freeze from `missCyclesRemaining`. Zero schema change.
  House record holds: M4 +1 field of 5, M6 +0, M7 +0.

**STEP 7 (the widened datapath) IS DONE AND BROWSER-VERIFIED, no defect found.** `datapath-superscalar.ts` + `SuperscalarDatapathView.tsx`:
27 nodes / 89 wires, a shared front-end (pcmux, PC, `+4n`, imem, the issue and hazard units, ONE
register file) feeding **two replicated execute lanes**, re-converging on ONE data memory and a
shared writeback bus. +48 tests.

**Load-bearing M7-step-7 findings:**

- **THE HUE CHANNEL: `superscalar-visuals.md` was OVERRIDDEN, with the user asked first.** That doc
  (2026-07-14) gives the lane hue the WIRE STROKE — but it predates M3 step 6 shipping, and the
  stroke now means STAGE, in the same `PHASE_COLORS` set **the pipeline map directly above the
  diagram** uses. Obeying it would have said blue = IF on one surface and blue = lane 0 on the
  other, and made `EX.0`/`EX.1` DIFFERENT colors — destroying the "two instructions in EX" reading
  the whole tier exists for. **PINNED BY USER: three channels — wire stroke = STAGE, node tint =
  LANE, follow ring = IDENTITY.** Only REPLICATED boxes are tinted; shared boxes stay hue-neutral
  for M3's pinned reason (the regfile is read by ID and written by WB in one cycle, so it belongs
  to no single anything), while `ALU 1` does slot 1's work and nothing else. Cost: one
  `NodeVM.hue` field = delta 1 of the visuals doc. **Generalisable: a forward-design doc written
  before the surface it shares a screen with can be silently stale — check what channel is already
  spent before spending it again.** The doc now carries a SUPERSEDED note; its other five seeded
  decisions all shipped as written.
- **Three units, three different replication answers, NONE guessable — all settled by dumping a
  real width-2 trace.** (1) `pcarith` REPLICATES: two `lui`s pair happily (not memory ops, not
  transfers, not RAW-dependent) and U/J producers emit **no `alu-op` at all**, so a cycle really
  holds `EX.0=lui` + `EX.1=lui`, both needing the dedicated adder. (2) The MEM→WB bypass
  REPLICATES: two non-memory instructions bypass together, and one shared wire could name only one
  of them — **the follow-ring would have pointed at the wrong instruction**. (3) `dmem` does NOT
  replicate (mem-port rule), pinned corpus-wide as a converse guard.
- **`forward.from` names the LATCH, not the slot — a real trace-contract limit.** It is `'EX/MEM'`
  / `'MEM/WB'` (event fields stay BARE, pinned 2b), so **the SOURCE lane of a forward is a fact the
  trace does not carry**. Every forward wire starts at a latch BAR; drawing a source slot would be
  a coin-flip rendered as hardware. Sink lane IS known (the consumer's slot). A test pins that no
  forward wire ever sources a slot, so a later "improvement" cannot invent it.
- **"One lane dark" is a claim about the EXECUTE BAND ONLY — its own test caught the over-claim.**
  The first draft asserted no lane-1 wire ANYWHERE was lit on a refused cycle and FAILED: a machine
  that refused a pair in ID is still fetching two into `IF.0`/`IF.1` behind it. That is the machine
  working — the refusal narrows the ISSUE point, the front-end keeps running wide. Browser-confirmed
  in one frame: `ALU 1` fully grey while `Sign Extend 1` is lit magenta beside it.
- **The refusal BADGE and the dark lane are ONE CYCLE APART — step 8 must not assume they coincide.**
  The refusal fires in ID (deciding the next group) while EX still holds the previous pair. Observed
  on `array-sum-twice.s`: badge at cycle 2, solo `ALU 0` at cycle 5.
- **`issueWidth` is a THIRD structural axis, and hiding is TESTED not argued.** At width 1 lane 1
  AND the issue unit are ABSENT (not dimmed). Lawfulness asserted over the whole corpus × 3 configs:
  no width-1 cycle emits a `.1` location, no width-1 stall carries a pairing reason. If one ever
  did, the honest fix is to draw an IDLE lane, not to keep hiding it. (The issue unit is the
  arguable one: a width-1 superscalar DOES run issue logic, but this box draws the PAIRING verdict
  and with one candidate there is no such question. The ordinary hazard check is the separate,
  width-independent `hazard` unit.)
- **The fetch adder is `+4n`, not `+8`** — the machine advances 4 bytes PER INSTRUCTION FETCHED, and
  that count is 1 or 2 depending on free slots, so a hard `+8` is wrong on exactly the cycles a
  refusal makes interesting. A test pins the `+4` case.
- **12 diagonal-wire failures on the first geometry run, all the same mistake, fixed
  STRUCTURALLY.** Every one was a hand-typed endpoint `y` not matching the node edge it claimed.
  Fix: **every coordinate is DERIVED from the node via `at()`/`aUp()`/`aLo()`**, so a node that
  moves drags its wires instead of silently detaching. The lane-pitch local became unused as a
  result — that is the good sign.
- **Label/box overlap was MEASURED in the browser, not eyeballed.** `expert` tier looked crowded
  around the stacked issue/hazard units; rather than guess, every rendered `.dp-ctrl-label` /
  `.dp-vlabel-text` bbox was intersected against every node bbox in SVG space → **zero overlaps**
  (it was legal 4px clearance, the renderer's standard). **Reusable technique — "it looks tight" is
  exactly the judgement an eyeball is worst at.**
- **Browser numbers cashed:** `sum-loop.s` 56 → 44 live, `array-sum-twice.s` **208 → 178** live
  (four pinned matrix cells). At the paired cycle `ALU 0` = `10` and `ALU 1` = `9`, **byte-identical
  to the dumped trace**. Nodes 26 → 18 across the width flip, no lane-1 text anywhere. Legend:
  `Fetch·Decode·Execute·Memory·Writeback·Lane 0·Lane 1·idle`. Console clean. **The 0-indexed
  transport trap bit again** (`cycle 5 / 177` = 178 cycles) and was handled by the step-6 note.
- **Browser-tooling gotcha (new):** the claude-in-chrome `zoom` action PINS the screenshot capture
  size for the rest of the session, and `resize_window` silently fails to restore it (`window
.resizeTo` worked once then stopped). Screenshot timeouts on this page persist — pause ~8s and
  re-shoot, never re-click. Driving React `<select>`/toggles via `element.click()` and the native
  value-setter + `dispatchEvent(new Event('change',{bubbles:true}))` is far more reliable here than
  clicking coordinates.

**Step 6 (web enablement) — also browser-verified.** The superscalar is selectable, the ISSUE
`1-wide`/`2-wide` toggle is live, and the milestone finally has a picture.

**Step 6's acceptance, cashed live: `sum-loop.s`, forwarding ON, flipping `1-wide → 2-wide`
WITHOUT reloading moves `56 → 44`** — the exact step-4 derived counts — and the map then draws
`IF.0`/`IF.1` in one column, `ID.0`/`ID.1` in the next, `EX.0`/`EX.1` in the next: **M3 step 7's
lane claim cashed against a REAL engine** instead of a hand-built trace. This eyeball was
load-bearing rather than ceremonial: the seam test was already provoked and found weak — deleting
`issueWidth` from `loadInto`'s config leaves all 581 web tests green, because the field is OPTIONAL
and the engine's `?? 1` just runs both toggle positions at width 1. **A dead toggle reads 56/56;
only the number moving tells them apart.** Gating verified in BOTH directions (ISSUE present on the
superscalar, ABSENT on the pipeline). Console clean — in particular no module-resolution failure,
the risk `fix(web): resolve engine-pipeline to source` had already made real once and the one thing
Vitest cannot rehearse (the dev server resolves differently).

**Step 6 is the SECOND view step in project history to survive a browser pass with NO defect
found** (M5 step 5 was the first), against the 9-of-10 house prior in [[browser-is-the-only-net]].

**Two traps that both push the SAME direction — the honest number looks WRONG at a glance. Read
these before any future browser check of a cycle count:**

- **The transport is 0-INDEXED.** `lastCycle = recordedCycles - 1` (`App.tsx:125`), so a 56-cycle
  run reads **`cycle 55 / 55`** and a 44-cycle run reads **`43 / 43`**. Every pinned count in M7 is
  a trace LENGTH. **Read `X / Y` as `Y + 1` cycles.** A verifier who compares the on-screen number
  to the pinned one sees an off-by-one and has two bad moves available: report a phantom defect, or
  "correct" the pinned number and silently destroy the step-4 matrix.
- **The app opens at forwarding OFF, but 56/44 are forwarding-ON numbers** (`W1`/`W2` in
  `pairing.test.ts` both set `forwarding: true`). Flipping only the width from a cold load compares
  the wrong pair of cells. The default reads **78** cycles — itself the derived forwarding-OFF
  width-1 cell (`34 + 4 + 22 + 18 + 0`), so the browser confirmed a second matrix cell in passing.

**Scrub was exercised over a paired recording** (back to cycle 3: the first pair tracked together in
`MEM.0`/`MEM.1`, the pair behind it in `EX.0`/`EX.1`, readout **`7 in flight`** vs width 1's max of
5, and `ecall` alone in `IF.0`/`ID.0` — the refusal picture step 8 will name). Step 5 had proven
scrub headlessly, so this confirms rather than discovers — but "the map RENDERS a paired trace" and
"you can scrub back INTO one" are different claims. Also: **the config survives a model round-trip**
(superscalar → pipeline → superscalar kept forwarding ON and width 2).

Also from step 6: `datapath: 'none'` renders "Superscalar datapath — coming soon" **by design**
(step 7 is the deliverable) — a missing diagram is exactly the shape an eyeball wants to log as a
bug. And the `.0` encoding is visible in the shipped UI while the M3 pipeline map beside it still
draws bare `IF`/`EX` — both spellings seen in one session rather than argued about.

**Driving this app in the browser:** `npm run dev` climbed to **port 5182** (5173–5181 all taken by
other projects — see [[never-kill-dev-servers-by-port]]); identify by the served title
"CPU Visualizer". CDP `Page.captureScreenshot` and `Input.dispatchMouseEvent` **time out
frequently** on this page (the pipeline map is a large DOM) — the action usually LANDS anyway, so
re-screenshot after a ~6s pause rather than re-clicking, and prefer the lighter `find` /
`read_page` over screenshots to read a value. GIF recording makes the timeouts much worse.

**Step 5 was a PROOF, not a build: `packages/trace/src/recorder.ts` is UNTOUCHED.** That is the
claim that could have failed — `follow()` keys on `id`, never on `location`, and
`InstructionSighting.location` was always free-form (its doc cites `"ROB#3"`), so two instructions
sharing a stage resolve to distinct `"EX.0"`/`"EX.1"` sightings for free. A recorder change would
have meant the encoding was WRONG. The acceptance's width-1 clause was already met by
`processor.test.ts`, so the new suite re-proves none of it (M3-step-4 discipline: state what you
deliberately do NOT re-prove).

**Load-bearing M7-step-5 findings:**

- **A slot is NOT a stable lane — now pinned three ways.** An instruction refused for
  `intra-pair-raw` in slot 1 **slides to slot 0** (`IF.1 → ID.1 → ID.0 → EX.0 → MEM.0 → WB.0`); the
  one behind it slides the OTHER way **0 → 1** to pair with the slider; a third slides **while still
  in IF**. Sliding is neither monotone nor one-directional. Also pinned: a slide never re-mints the
  id (INV-4), and the stage FAMILY sequence stays monotone even when the slot doesn't.
- **`sum-loop.s` does NOT slide — assuming it would have been the test-lie.** The natural workhorse
  was dumped FIRST and every instruction keeps its slot for life (`i5: IF.1 → ID.1 → EX.1`). A
  4-instruction program had to be written to provoke a slide. Third landing of the house rule:
  **every expected `location` must be dumped and read, never reasoned.**
- **Provoking found a REAL hole 694 green tests missed.** Aliasing the cache into the snapshot
  (`cache: this.cache`) left the ENTIRE package green — conformance, timing, pairing, and the
  engine's own `does not alias slot arrays` test — while corrupting every recording: the cache is
  **single-buffered and mutated in place**, so a shallow snapshot replays a cold cache as
  **warm-from-the-start** (cycle 0 reported the final run's 2 valid lines). Time-travel is the ONLY
  layer where that is observable. Now pinned by a staircase-not-flat-line assertion + per-cycle
  object identity, and the test was **watched failing under the bug before being kept**.
- **The neighbouring latch `.slice()` is defensive, NOT load-bearing — the M7-4(d) shape again.**
  Deleting all four slices also left 694 tests green, but there that is CORRECT: `step()` allocates
  a fresh `emptyLatches(width)` as `ctx.next` each cycle, so the arrays cannot alias. The engine's
  anti-aliasing test passes on **array identity**, which fresh-rebuild satisfies for free — it never
  covered the cache at all. Slices KEPT, but the doc comment claiming both copies prevented
  "replaying every cycle as the final one" was **false for the latches, true for the cache**, and
  now says which is which. **Two adjacent copies that look identical can have opposite load-bearing
  status — provoke each separately.**

The closed form is
**`cycles = G + L + P + M + 4`** (G = issue-group cycles, L = BLOCKING stalls, P = speculation
penalty, M = misses × penalty). The `+4` is width-invariant (pipeline depth), so width changes only
the ISSUE SCHEDULE; at width 1, `G = N` and `L = S`, so it REDUCES to M3's `N+4+S+P+M` (asserted).
Matrix = 7 programs × 2 widths × 2 fwd × 3 predict × 3 cache, every cell derived, every term
(G/Q/L/P/M/N) asserted separately. **All six provisional step-2b width-2 pins are CONFIRMED — the
warning in memory about them is DISCHARGED.** The derivation was validated by predicting all seven
forwarding-OFF counts (which had NO pin to copy) before running the engine; all seven were right.

**Load-bearing M7-step-4 findings:**

- **`S` splits at width 2 and half of it is FREE.** A slot-**1** refusal leaves slot 0 issuing ⇒ the
  group just ends early and NO cycle is lost. Only a slot-0 refusal costs. `array-sum-twice.s` fires
  50 free refusals; counting `stall` events as "S" over-charges every program. Hence `L`, counted
  DIRECTLY as "stall event fired AND nothing issued" — **never as a residual** (a residual makes the
  closed-form assertion `0 === 0`, green for any engine).
- **`G`/`Q` are NOT prediction-invariant** (the plan didn't predict this). Under `static-taken` a
  betting branch sets `killedRest` ⇒ **every bet from slot 0 with a live mate costs a pair**. Correct
  bet → `Q−1`, G same. WRONG bet → mate is on the correct path, re-issued, and costs a group **iff it
  can't re-pair** (`array-sum`'s `lui t3` can't → G+1; `sum-loop`'s `addi a7` re-pairs with `ecall` →
  free). A bet from slot **1** costs neither (`branch-flavors`, both branches in slot 1).
- **`P` and `M` ARE width-invariant** (so M3's `penaltyOf` carries over unchanged); **`L` is
  prediction- AND cache-invariant** — a miss freezes IF/ID/EX/MEM _together_ so producer→consumer
  distances survive, and the freeze emits **no `stall` event**, so its cycles charge to `M` not `L`.
- **`killedRest`'s slide-suppression is DEAD CODE** — `stageIf` runs after `stageId` and clears
  `next.ifId` on bet/squash anyway. Deleting it left all 680 package tests green. KEPT (ID shouldn't
  silently depend on a sibling undoing its work) but the comment now names IF as the real enforcer,
  and a test pins that. **Same shape as M2 5e: a claim with a rationalization attached.**
- **Two of my own reasoned claims were false, both about SLOTS.** (i) "every taken transfer strands a
  doomed mate" — FALSE, `branch-flavors` has 1 taken transfer and 0 doomed, because its branches
  issue from slot 1 and the fall-through dies in IF without consuming a slot. (ii) "after a bet ID and
  IF are both empty" — half false, IF refills from the REDIRECTED pc immediately, which is exactly why
  a bet costs 1 not 2. **Step 2b's rule generalizes: any claim naming a slot must be WATCHED.**
- **Provoke the provocation.** The net was proven by injecting a spurious pairing refusal → 24
  failures across all 18 `sum-loop` cells while `differential.test.ts` stayed **GREEN** (INV-8's
  blindness, cashed). But the FIRST provocation (refuse a `lui` partner) was a **no-op** — the `la`
  idiom already refuses it for intra-pair RAW. A provocation must be confirmed to BITE.

Plan: `docs/plans/m7-tasks.md`. **User-pinned up front:** extract-then-fork (not sibling import,
not parameterize), **width is an in-model 1↔2 toggle** (not a second model), **full visual layer**,
and **sliding/greedy issue grouping** (a refused younger instruction becomes the OLDER of the next
group, so pairing recovers — the alternative, aligned packets, is cheaper but makes pairing depend
on ADDRESS PARITY, a worse thing to teach).

**Two facts verified before the headline, not assumed** — the lesson being that a headline decision
argued from a line count is not argued at all:

- Sibling-engine imports are LEGAL (generic `packages/engine/**` denies only curriculum+web) but
  **unprecedented** — no model imports a sibling. So reuse had to go DOWN, not sideways.
- Single-issue is **the shape of pipeline `processor.ts`**, not a local assumption: four singleton
  latches + four one-occupant boolean signals (`bet`'s comment literally says "One casualty, not
  two"). That kills "parameterize the pipeline by width" outright.

**The pairing pins are a COORDINATED simplification, not three independent choices** — this is what
makes the milestone tractable. No paired mem-ops ⇒ cache/miss path stays single-lane; no paired
branches ⇒ squash/redirect stays single-lane; no intra-pair RAW ⇒ forwarding never resolves a
within-group dependency. So only **fetch, read ports, ALU, write ports, and the forwarding source
set** genuinely double. That settles the otherwise-easiest-to-botch split: **`memStall` broadcast,
`squash` lane-aware, `stalled` single-lane producer freezing a pair.**

**INV-8 IS A FALSE SAFETY NET HERE — the milestone's single most important warning.** In-order
superscalar retires in order, so `runConformance` passes essentially for free; it would pass with
the pairing logic COMPLETELY WRONG, because pairing changes only _when_ things happen. Timing is
the whole point of the tier and there is **no golden reference for cycle counts**. The real net is
the closed-form timing matrix.

Steps done:

- **0.** `predict.ts` + `cache.ts` moved DOWN into `engine-common` (`git mv`). Pipeline re-exports
  the cache READ surface from its new home so **all ten web files changed zero lines**. Forwarding/
  hazard logic deliberately did NOT move — it is stage-walk-shaped, and sharing it would mean
  parameterizing the very assumption M7 breaks. Caught: `common` was a tsconfig ref of `pipeline`
  but declared **TEST-ONLY**, and is now a production edge (the "production depends only on isa +
  trace" comment would have gone false while every check stayed green).
- **1.** `ProcessorConfig.issueWidth?: number` **optional** (follows `seed`'s precedent, not
  `cache`'s required-with-null — a required field would force a value into every config literal to
  say something none of them mean), but `ProcessorCapabilities.configurableIssueWidth` **required**,
  so adding it is a compile error every model must answer. It caught two stub fixtures immediately.
  Inertness proved in the **whole-trace** form (deep-compare the entire trace array at width 1 vs 2),
  because a TIMING knob leaking would move cycle counts while every architectural result stayed
  correct — exactly what a final-state check cannot see.
- **2a.** `engine/superscalar` at width 1: slot-shaped latches (arrays, index 0 = OLDEST), reverse
  walk iterating slots, `reset()` THROWS on width ≠ 1. **Cycle-identical to M3 across the whole
  corpus × forwarding × prediction × cache matrix, first run, zero numbers adjusted** — and that was
  verified by confirming the `TIMING` table's pinned per-program constants are **byte-identical** to
  `engine-pipeline`'s, i.e. it asserts against M3's hand-derived numbers, not its own output.
  Only `location` is slotted (`"EX.0"`); **event fields stay bare** and a test pins that boundary.

**Recurring lessons this milestone re-earned:**

- **Provoke a guard, don't read it.** Both step 0 and 2a verified an eslint deny list by temporarily
  writing the forbidden import and confirming the failure, then reverting. A config guard never
  fired is a guard whose regex is unproven.
- **The eslint deny lists enumerate models BY NAME in ~8 places** (including a per-model
  cross-isolation block). A new model does NOT inherit them — a `sed` that looks complete can miss
  half. Add the name everywhere AND give the new model its own block.
- **Delegation is safe exactly when the net is mechanical.** Step 2a was handed to a subagent only
  because "must reproduce M3's pinned constants" is checkable without trusting the implementer —
  and the check was then run independently rather than taken on report.

### Step 2b DONE 2026-07-20 (1684 → 1705 tests) — pairing, and width 2 is a real machine

Sliding/greedy issue, the three refusal verdicts (`mem-port` / `branch-slot` / `intra-pair-raw`,
all riding `stall.reason` — a free-form string, so **no new trace event and no schema change**),
intra-pair forwarding, lane-aware `squash`. Width 2 is **strictly faster on all 7 corpus programs**
with identical architectural state (`sum-loop.s` 56→44, `array-sum.s` 51→42, `array-sum-twice.s`
208→178). All three pinned surfaces proven. **The width-1 timing suite was the regression net and
held with ZERO numbers touched** through a rewrite of the issue stage, the IF hand-over and MEM's
freeze rule — which is exactly what step 2a existed to buy.

Findings that generalize:

- **The one real bug was caught by an in-order-retirement assertion, NOT by conformance.** A cache
  miss in `MEM.0` froze only its own slot, so a non-memory instruction paired BEHIND it retired
  ahead of it. Final-state conformance is structurally blind (both retire in the end, answers
  identical); a **strictly-increasing retire-id sequence** across corpus × width × cache sees it in
  one line. The fix is directional — the freeze propagates DOWNWARD in age only.
- **A betting branch needs no fourth pairing rule.** Refusing to pair leaves the same fall-through
  stranded as a _survivor_ that is still wrong-path and still must die — a longer route to the same
  funeral. Let it pair; kill it with the bet. (`Bet` therefore carries a slot, like `Squash`.)
- **`flush.stages` gained `'EX'`; event fields stay BARE — re-decided against an OBSERVED multi-slot
  flush, not inherited.** A halt flush can now name `ID` too. `stages` answers "which stages lost
  someone"; a consumer needing identity has `instructions[]`.
- **Sliding makes a whole new class of test-lie possible: a slot is not a stable lane.** The
  "branch in `EX.1` spares `EX.0`" test was, as first written, exercising a slot-**0** branch — with
  no spacer the branch is refused for an intra-pair RAW and **slides into slot 0**, so it asserted
  the lane-aware case while demonstrating its opposite, **and passed**. Only dumping the trace found
  it. **Any test naming a slot must have been watched, not reasoned about.**
- **A broadcast flag can be an artifact of the narrow machine.** M3's `stalled` boolean was
  DELETED: with sliding issue, "the stage froze" is expressed by which seats ID left occupied, and
  `stageIf`'s three special cases collapse into one hand-over rule that reproduces the width-1 stall
  picture unchanged. `memStall` stays broadcast — a single-ported miss really is a machine property.

**⚠ The width-2 cycle counts in `pairing.test.ts` are PROVISIONAL.** Six of seven were pinned from
the engine's own output, so they catch DRIFT but do not prove correctness — and no other net covers
that gap (width 1 is unaffected by pairing; final state is identical at both widths by
construction). **Step 4 must DERIVE all seven independently, never copy them forward.** Only
`sum-loop.s = 44` is hand-derived so far (loop period 4 from the `d_b + 3` mispredict rule; the
tenth branch falls through so its pair-mate survives; `d_ecall = 40`).

### Step 3 DONE 2026-07-20 (1705 → 1835 tests) — conformance at both widths, and the mute alarm

**36 configs** (2 width × 2 forwarding × 3 predict × 3 cache) × 7 programs = **252 cases**, all
green. (The +130 test delta is the width-2 HALF, 126 cases, plus 4 guards — the width-1 half landed
in 2a. 126 is simultaneously the old total and the new half, which is exactly how the first
write-up of this step came out 2× wrong.) **That green is
worth only "pairing does not corrupt the machine"** — width-invariant final state is what an
in-order superscalar PREDICTS, so this column could not have failed for a timing reason. Step 4 is
still the net.

**The step's actual deliverable was `configLabel`, not the differential**, and the lesson
generalizes past this repo: `configLabel` (`engine/conformance/src/conformance.ts`) didn't know
`issueWidth`, so the 36 configs would have rendered as **18 labels used twice** (2×3×3 names, each
shared by a width-1 and a width-2 case). That is the known M4
collision — but every earlier axis (forwarding, predict, cache) had a _failing column available_ to
make someone read the titles. **Width has none: both columns are green by construction, so a
duplicated-title report is indistinguishable from a correct one, permanently.** Generalize as: _the
severity of a reporting defect is inverse to the failure rate of the thing being reported._ An axis
that never fails is where a naming collision hides best, and it deserves MORE guard, not less.

Second reusable find: **"provoke the guard" needed two silence cases, not one.** Forcing the clause
on must fail a `width`-unset list (pre-M7 suites, where the field is `undefined`) _and_ a list where
width is **set but constant** — because the superscalar suite states `issueWidth: 1` explicitly, so
an implementation blind-by-`undefined` passes the first while still wrongly labelling the second.
Two different mechanisms produce "don't name it"; a guard covering one is not a guard.

Third find, and it is about the WRITE-UP not the code: **every self-check in this step validated the
code and none validated the numbers in the prose**, so a 2× matrix-size error reached the plan, both
memory files and the commit message with the full gate green. In this repo logged counts are
load-bearing (exact test/cycle counts are pinned everywhere, and step 4 reasons off the conformance
matrix's shape), so **treat a number written into a durable record as an assertion that needs its own
check** — recompute it from the factors, or read it off a dump, before committing.
Also: gating on variation + the field being **optional** means pre-M7 suites stay silent _for free_
rather than by a special case — verified by DUMPING their titles (the only 6 `width` hits elsewhere
are pre-existing "store widths" and step-1 inertness tests), not by reasoning.

Next: **step 4** (the real timing matrix — see the ⚠ warning above; DERIVE, don't copy 2b's pins),
then 5 (recorder + `location`), 6–8 (web, datapath, readout+IPC — all needing a BROWSER eyeball).

## M9 — out-of-order execution (Tomasulo/ROB/renaming), relocated from the MEMORY.md index 2026-07-22

The north-star tier (roadmap §12.5); scope = model + view (`docs/plans/m9-tasks.md`, pinned
2026-07-21, `188cfe9`). Per-step detail lives in the plan doc; this is the condensed cross-step log.

**Step 0 (2026-07-21, `ed95e58`, 2511 tests) — CONFIG-ONLY, zero trace events.** YAGNI held: no
view/engine exists yet, so nothing forces `rename`/`dispatch`/`issue`/`cdb-broadcast`/`commit` into
the schema. `ProcessorConfig` gained optional `outOfOrderIssue`/`robSize`/`slowOpLatency`;
`ProcessorCapabilities` gained REQUIRED `configurableOutOfOrder` (compile-errored the 4 model
constants + 2 stub fixtures, the M7-step-1 mechanism). Whole-trace inertness proven per-model
(final-state inertness can't see a config field that reorders events while leaving the answer
correct). Corpus decision (static analysis, `temp/m9/step0-corpus-analysis.md`): money shot =
`array-sum.s` (ROB≥6 reaches the miss-independent next `lw`), MSHR default 2 confirmed, no
`sw`→dependent-`lw` alias in the corpus so `store-forward.s` is warranted but authored at 1b.

**Step 1a (2026-07-22, in-order-issue OoO base, width-parametric) — the ROB/rename/Tomasulo-skeleton
core held to strict in-order issue.** Reproduces M3's pipeline closed form at `issueWidth:1` and
M7's superscalar closed form at `issueWidth:2` cycle-for-cycle over corpus × prediction × cache
(`timing.test.ts`, 145 tests); full repo 2823 tests. 8 bugs fixed en route (full list in the plan
doc); sharpest two: branch-prediction bets fired at DISPATCH one cycle too early whenever the branch
itself had to wait on a broadcast — fixed by a new `stageBet` pass one cycle ahead of issue,
mirroring `stageIssueExecute`'s resource-contest walk; and `ctx.memStall` was set unconditionally on
a miss's RELEASE cycle too, over-freezing the front end by one cycle. **Disclosed deviation:**
dispatch also blocks on an unresolved predictable-transfer bet (`hasUnresolvedBet`), not just ROB
capacity/width — flagged as a 1b touch-point, not re-litigated. Pins going into 1b: benefit source =
Option B on A (non-blocking cache-miss MLP as the floor + a configurable FU-latency knob, deferred);
issue width = build the OoO+superscalar machine ONCE, width-parametric (`issueWidth`, default 2);
renaming = classic speculative Tomasulo, built PRF-forward-compatible via three seams (opaque `Tag`
type, ROB ordering separated from payload, one operand-read + one commit choke point).

**Step 1b (2026-07-22, the scheduler itself — wakeup/select, non-blocking LSU, disambiguation, CDB
arbitration).** The load-bearing structural call (advisor-vetted before writing code): gate the
ENTIRE new machine behind `ProcessorConfig.outOfOrderIssue`, so `false` reproduces 1a byte-for-byte
(`timing.test.ts` is the free regression net) — and it's also why the money shot works, since the
in-order branch still blocks on a miss. Money shot: `array-sum.s`, cache on, static-taken — **61
in-order → 41 out-of-order cycles**, byte-identical final state. Mechanisms: `stageIssueExecute`/
`stageBet` unified into one shared generator `walkIssuable` (in-order STOPS at the first not-ready
entry, out-of-order SKIPS it); the CDB has exactly `width` ports, oldest-`seq`-wins, losers carry
over one cycle; MSHRs (`numMshrs`, default 2) gate concurrent misses per-entry; disambiguation is
stall-until-the-aliasing-store-commits (no forwarding), which requires stores to defer their actual
write to commit (not MEM access) since out-of-order issue lets a store's address+data be computed
speculatively past a still-unresolved older branch. New corpus program `store-forward.s` (a store
immediately followed by a dependent load of the same address) needed hand-derived timing-table
entries in every model's `timing.test.ts`/`pairing.test.ts` (a corpus addition is never free — see
`content/programs/README.md`). **One real correctness bug found, not anticipated:** `haltFetch` was
a STICKY flag, safe in 1a's strict in-order issue but broken once `ecall` (which reads no registers,
so is always ready) could issue wrong-path behind an unresolved branch — fixed by re-deriving
`haltFetch` from the ROB's own post-flush contents. Option B (`slowOpLatency`) deliberately NOT
built — stays inert, deferred pending a corpus-driven pick. Acceptance: money shot + one unit test
per new mechanism (`scheduler.test.ts`, 7 tests) + `store-forward.s`'s disambiguation pin, plus one
check beyond the literal list (advisor): `outOfOrderIssue` true vs false byte-identical over the
WHOLE corpus at one fixed config — `true == reference` transitively, since `false` already is. Full
repo: 2991 tests.

**Step 2 (2026-07-22, the INV-8 differential net) — `differential.test.ts` now full-crosses
`outOfOrderIssue` against width × prediction × cache (36 configs × 9 programs, all green); ROB size
gets one TARGETED small config (`robSize: 1`) rather than a fifth cross-product axis (advisor call
against the plan's literal "× ROB size" phrasing — a timing-blind net gets near-zero marginal teeth
from a knob whose only effect is WHEN dispatch stalls; the one thing a small ROB actually touches is
`disambiguationClear`'s "the aliasing store already committed and left the ROB" branch, verified in
a cycle dump). `configLabel` (the shared `engine-conformance` harness) gained an `outOfOrderIssue`
axis mirroring `issueWidth`'s exact precedent, plus matching guard tests in `conformance.test.ts`.
**Real finding, not just a checkbox: `store-forward.s` (authored at 1b FOR this bug class) does NOT
expose it** — checked empirically, a disambiguation-disabled variant still computes the correct
answer on it at every config tried, because its adjacent store/load share the single memory port and
oldest-first issue plus matched per-request miss costs on the same line keep the store's write ahead
of the load's read regardless of the gate. (What `store-forward.s` actually pins is the OTHER
step-1b mechanism: the deferred-to-commit write.) A program that DOES expose the gate needs the
older store's ADDRESS — not just its write — unresolved: `disambiguation-mutation.test.ts` authors
one (an aliasing load ready immediately, racing an older store whose base register is gated behind a
slow, cache-missing, unrelated load) and confirms `a0` corrupts 99→0 when `disambiguationClear` is
forced to always clear, WITH a cache, and does NOT corrupt with the cache off — pinning that the
corruption genuinely needs the miss-widened window the plan's own "how this can lie to itself"
section names. **Built as a PERMANENT regression test, not provoke-then-revert\*\* (advisor call,
weighed against step 0's ephemeral eslint-guard precedent — disambiguation is the one load-bearing
property of an otherwise-weak net, unlike a static lint rule that can't be committed permanently
broken). Mechanism: `disambiguationClear` changed `private`→`protected` (the one production change
this step needed) for a tiny test-only subclass to override; the test can't import
`@cpu-viz/engine-reference` directly (the DAG boundary `engine-conformance` enforces), so it checks
against a hand-computed oracle the same way `conformance.ts`'s own `RESULT_ORACLES` do. Full repo:
3169 tests, typecheck, lint, build all green.

**Step 3 (2026-07-22, the per-instruction lifecycle table) — scope disclosed (advisor-guided): two
programs traced COMPLETELY at the OoO config rather than the full corpus × configs literally (that's
unbounded by hand) — `store-forward.s` (width 1, disambiguation/store-defer) and `array-sum.s` (width
2, static-taken, `CACHE_LARGE`, the flagship). Discipline actually followed: derived `store-forward.s`'s
full 7-instr/11-cycle table BLIND from the stage-order rules before running anything (including a
subtle same-cycle zero-latency dispatch-forward — an entry's issue-this-cycle is visible to a
younger entry's dispatch-this-cycle, since issue runs before dispatch within one `step()` call) — 100%
match against a real dump, zero corrections. Used that validated confidence on `array-sum.s`: derived
setup+iteration 0 blind (matched through cycle 6), then periodicity + reconciliation for the rest, per
the advisor's explicit "derive structure, reconcile against ONE dump, treat disagreements as findings
— don't single-step to certainty." **Two real findings, not transcription:** (1) the fast
(pointer/counter/branch) chain and the slow (sum-reduction) chain compete for the SAME width-2 issue
budget once the first miss releases — the OLDER reduction wins oldest-first priority when both are
ready the same cycle, stretching the fast chain's 4-cycle bet period to 6 around the miss-recovery
window (predicted from the rules, THEN confirmed in the dump). (2) the two misses do NOT overlap
(first releases@15, second not even detected until@23) — `array-sum.s`'s money shot is "independent
work races around ONE miss," not miss-under-miss (that's `scheduler.test.ts`'s dedicated 2-MSHR
program) — conflating them would overclaim. Total 41 cycles (0..40), matching the step-1b log's
pinned 61→41 exactly. **Mutation check, both ways:\*\* neutered `walkIssuable`'s OoO skip→stop —
`array-sum.s` collapses to EXACTLY 61 cycles (the in-order closed-form baseline); `differential.test.ts`
(348 tests) stays all green; `scheduler.test.ts`'s own timing assertions get 4 expected-shape
failures. Reverted immediately (provoke-then-revert, step-0's precedent — a cycle-count check, not a
toggleable boolean like step 2's `protected` seam). Landed as
`packages/engine/out-of-order/src/lifecycle.test.ts` (19 tests, asserting only what the trace schema
exposes — `lui`/`auipc`/`jal`/`ecall` issue silently and are explicitly NOT asserted at issue rather
than force-fit). Full derivation: `temp/m9/step3-lifecycle-derivation.md`. Full repo: 3188 tests,
typecheck, lint, build, format:check all green.

**Step 4 (2026-07-22, recorder/`follow()` through the ROB, the INV-4 payoff) — DONE, zero
production changes.** The real gap (found before coding, advisor-flagged): every block in
`recorder.test.ts` since step 1a never set `outOfOrderIssue`, so nothing there had ever driven the
scheduler THROUGH THE RECORDER — it was an in-order baseline only. Added: (a) load→run→back→scrub
over a TRUE OoO recording; (b) **completion order ≠ commit order**, read through the shipped
`follow()`/`recorded` API — at the flagship `array-sum.s` config (identical to step 3's: width2/
OoO/static-taken/`CACHE_LARGE`/robSize32), the OLDER stuck reduction add (ROB tag5) completes
(`alu-op`) at cycle16 while the YOUNGER independent counter decrement (tag7) completes at cycle5 —
**out of program order** — yet tag5 retires@18 before tag7@19 — **in program order**, a strict
inequality both directions (tag6 ties tag5 at commit, so tag7 not tag6 is the clean fixture).
**`follow()` proves only IDENTITY** (`location` stays `"ROB#<tag>"` the whole in-flight life, per
1a) — the reordering is invisible to `follow()` alone and lives entirely in the event stream, so
the payoff is follow() + cross-id event comparison together, stated as its own assertion, not
implied. (c) INV-4 under conditions 1a never provoked: the load's pc is fetched **six** times, not
five — 5 real dynamic iterations (several concurrently in-ROB, each a distinct id/tag, no
aliasing) + **1** wrong-path speculative re-fetch (final iteration's wrong static-taken bet)
squashed at `"IF"` before ever getting a ROB tag, never retiring — dumped and read, not assumed.
**Honesty about teeth (advisor's explicit ask):** the timing divergence itself is already caught by
step 3's `walkIssuable` mutation — this step doesn't newly net that and says so; what IS newly
checked is that step 3's exact mutation (provoked again, reverted via `git checkout --`) also fails
THIS suite's two new claims (61-cycle collapse; completion-cycle assertion breaks), proving they
have independent teeth rather than just replaying step 3 under a different API. Landed as additions
to `recorder.test.ts` (18 tests, up from 10; 1a's blocks untouched). Full repo: **3196 tests**,
typecheck, lint, build, format:check all green.

**Step 5 (2026-07-23, web enablement) — DONE, BROWSER-VERIFIED CLEAN on the first pass** (the rare
view step with no defect, like M5 step 5). The OoO model is now the fifth `models.ts` row and
drivable in the browser; the flagship in-order↔out-of-order toggle + the ROB-size control are gated
on `configurableOutOfOrder` and ride M3's config seam as the 5th/6th knobs with **zero widening**
(exact `issueWidth` precedent: optional `ProcessorConfig` fields, `outOfOrderIssue ?? false` /
`robSize ?? 16`, threaded through `useSimulator` state/refs/config/setters + `LessonOpening`/
`lessonOpening`). **Browser proof of the flagship acceptance:** `array-sum`, cache large,
static-taken, width 2 — flipping in-order→out-of-order WITHOUT reloading drops **cycle 60 → 41**
live, and the pipeline map (free via INV-3 — it already keys cells off the free-form `location`, so
`"ROB#3"` resolved for free exactly as `"EX.0"` did at M7 step 5) redraws the picture: `lw ROB#24`
stuck on a miss cycles 22–35 while younger `lui`/`addi`/`sw`/`ecall` dispatch and run 27–41 around
it, each loop-body instance a distinct ROB tag (INV-4). The issue-order + ROB controls are ABSENT on
the superscalar (confirmed in-browser — it keeps forwarding/predict/cache/width), and forwarding is
ABSENT on OoO (`configurableForwarding: false` — renaming makes it meaningless; the reflex "hazards
⇒ forwards" is the trap `models.test.ts`'s per-knob set catches).

**Three disclosed deviations from the step's literal phrasing, each with precedent** (all recorded in
`m9-tasks.md` step 5): (1) **`datapath: 'none'`, NOT `DatapathKind: 'out-of-order'`** — a
`DatapathKind` value asserts a diagram EXISTS; the bespoke OoO datapath is step 7. The union member +
App's dispatch arm + the value flip land TOGETHER at step 7 (superscalar sat at `'none'` through M7
step 6). Step 5's picture is the map + an "Out-of-order datapath — coming soon" placeholder. (2) **NO
FU-latency control** — Option B's `slowOpLatency` is still unread by the engine, so a control would
be "a control that cannot move anything." (3) **forwarding stays `['pipeline','superscalar']`.**

**The one real find — a LATENT step-1a gap, surfaced only because the web package's new `"*"`
dependency forced real npm resolution:** `packages/engine/out-of-order` was added to the tsconfig
references and vitest aliases at step 1a but NEVER to the npm `workspaces` array, so `npm install`
tried to fetch `@cpu-viz/engine-out-of-order` from the registry (E404). Tests/typecheck never noticed
(vitest uses its own aliases; `tsc -b` uses project references — neither hits node resolution). Fixed
by adding it to `workspaces` (DAG order). **Reusable: a new engine package needs FOUR wirings, not
three — tsconfig references, vitest alias, AND the npm `workspaces` array; the first two are exercised
by tests immediately, the third only when something declares a real `"*"` dep on it.**

**Opening defaults pinned against a live width-1/width-2 × OoO-on/off probe (not guessed):**
issue-order opens **in-order** (degenerate = the machine just learned), ROB opens **full (16)** where
the money shot shows, ROB small is **4** (chokes `array-sum` back toward in-order). The flip drops
cycles at BOTH widths (69→57 at w1, 61→42 at w2), so opening at the shared width-1 position still
demonstrates it from cold start — the advisor's one load-bearing pre-write check. **ROB size is a
CONDITIONAL lever like the cache** (flat on `sum-loop`/`store-forward`, moves only `array-sum`), not
universal like width — its titles disclose this. Full repo: **3203 tests** (+7: +4 App shape tests,

- models/session updates), typecheck, lint, build, format:check all green.

**Step 6 (2026-07-23, the `MicroTablePanel` — ROB/RS/rename tables) — DONE, BROWSER-VERIFIED CLEAN on
the first pass** (the SECOND OoO view step in a row with no defect, after step 5). The tier's star
surface, the deliverable `superscalar-visuals.md` §3 designed and deferred to here — three HTML tables
in one `.panel`, each a pure fold over `state.micro` (INV-3), rows carrying the follow-highlight: the
ROB (head marked ▶, states waiting→executing→completed, head's `· commits`), the reservation stations
(operand = captured value vs `⤺ ROB#tag`), the rename map (arch reg → in-flight tag, pending rows
only). **The load-bearing engine change: `MachineState.micro` — deferred UNSET at 1a/1b ("a shape for
a view that does not exist") — is now populated by `snapshotMicro()`, the step-0 YAGNI trigger firing
exactly on schedule.** Files: new `packages/engine/out-of-order/src/micro.ts` (the exported
`OutOfOrderMicro`/`RobEntryView`/`OperandView`/`RenameSlotView`, all plain value objects — no opaque
`Tag` leaks, tags read back to plain numbers via `tagNumber` IN the engine so the view compares only
numbers, PRF seam intact); `snapshotMicro()` in `processor.ts`; `RenameTable.snapshot()` + `Rob.maxSize`
getter; new web `MicroTablePanel.tsx` + `.test.tsx`; App slot gated on `hasMicroTables` (a trace fact,
`micro.rob` is an array), placed high (the OoO datapath is still the step-7 placeholder). **Two
advisor-flagged traps, both handled: (1) TRAP 1, the repo's signature time-travel bug — the ROB
snapshot must copy PER-ENTRY (a fresh `RobEntryView` per entry, scalars by value, immutable `decoded`
by reference), NEVER `.slice()` the array, because `RobEntry.state`/`.value` are mutated in place and
`Rob.entries` is `shift()`ed on commit, so an array-only copy replays every recorded cycle as FINAL
state — invisible to final-state conformance, caught only by reading a snapshot at an EARLIER cursor;
proven HEADLESS in `recorder.test.ts` (the old "micro is genuinely absent" step-1a block, INVERTED: a
tag reads `waiting` early and `completed` later). (2) TRAP 2, silent gate collision — the OoO micro
shape has NO `width` field, so `PairingReadout`'s `typeof micro.width==='number'` gate never fires for
it; the panel gates on `micro.rob` instead.** **The cache is NOT re-exported into `micro` (a reversal,
advisor-caught before the follow-up commit): the first version exposed `micro.cache`, but the shared
`cache-grid.ts` was built for the PIPELINE shape — it derives its `filling` countdown from
`micro.exMem.missCyclesRemaining`, which OoO lacks. Optional chaining → no crash, but the fill never
computes, so a line reads RESIDENT for the whole miss penalty while the ROB table above shows the load
`executing` — a cross-surface contradiction on the exact surface (the miss) that is the tier's drama.
REUSABLE: "appears for free via INV-3" is NOT free when the consumer reads fields of a DIFFERENT
model's `micro` shape — check what the newly-activated surface actually consumes. Conservative fix:
dropped `micro.cache`, restoring step 5's no-OoO-cache-grid behavior (browser-reverified: grid absent,
tables render, 41 cycles hold).** The RS table is a PROJECTION not a new structure —
classic speculative Tomasulo holds operand values in the ROB, so a `'waiting'` ROB entry IS the
RS-equivalent (`rob.ts`); no parallel RS array, no new trace events, no CDB field (step-6 tables fold
over `micro` STATE per the plan; a wakeup is already visible as an operand flipping ready). **Browser
proof at the flagship config (`array-sum`, width 2, out-of-order, static-taken, cache large, ROB full
→ 41 cycles):** at cycle 12 the head `ROB#4 lw` is `executing` (stuck on the miss) and `ROB#5 add`
(reduction) `waits` behind it, while younger `ROB#6/7/8/9` (incl. a later `lw`) have all `completed` —
out-of-order completion, in-order commit spine, side by side; the RS shows the reduction chain
`#5→#10→#15` stalled on load tags while independent `addi`s read `ready →`; and clicking `ROB#16` lit
EXACTLY three rows (its ROB row, RS row, rename-map row `t0 → ROB#16`) PLUS 13 pipeline-map rings PLUS
the transport chip "following ROB#16" — the cross-surface follow composition, the click-only defect
class, clean. Full repo: **3211 tests** (+8: +7 `MicroTablePanel.test.tsx`, +1 net `recorder.test.ts`),
typecheck, lint, build, format:check all green.

**Step 7 (2026-07-23, the bespoke OoO datapath — the sheddable half that never had to be shed) — DONE,
BROWSER-VERIFIED CLEAN on the first pass. M9 IS COMPLETE.** New `datapath-out-of-order.ts` +
`OutOfOrderDatapathView.tsx` + `.test.ts` (17), the fifth hand-authored geometry: PC → instr mem →
decode/rename dispatching into the ROB + reservation stations, which issue to a functional-unit pool
and a load/store unit whose results ride the **Common Data Bus** back to the RS and ROB, with the ROB
head committing in order into the register file. `models.ts` flipped `out-of-order` `'none'` → its own
kind (union member + App dispatch arm + `models.test.ts` datapath-table row, all three together — the
superscalar precedent, the table reddening the reminder). **THE ONE LOAD-BEARING CALL (advisor-vetted
before any geometry): this is the ONLY datapath whose `activate` folds `state.micro` (box occupancy)
AND `events` (flow).** An OoO `location` is uniformly `"ROB#tag"` — no structural stage, so box
occupancy (ROB/RS) reads the SAME `micro` the step-6 tables read at this cursor (the superscalar's
"NEVER `micro`" warning does NOT apply — its `micro` is latch state a cycle ahead; the OoO ROB snapshot
IS the cursor's own state). **Coherence of that micro+events pairing was DUMPED and read on `array-sum`
around the first miss BEFORE writing geometry** (throwaway colocated test): at cycle 16 the events
(`alu add` R/I result, `alu add` on a `lw` = an ADDRESS, `retire`) and the ROB states tell one story.
Three dump-driven code facts: (1) a load's `alu-op` is an ADDRESS → LSU, a branch's is a COMPARE → no
CDB result; only an R/I `alu-op` or a load's `mem-read` is a bus RESULT (the superscalar's
LOADS/STORES/BRANCHES split); (2) `retire(id)` names an entry ALREADY gone from `micro` — the commit
wire draws the departing instruction, coherent as "it has retired"; (3) the **CDB is TWO-PHASE** (`rob.ts`
`wake()`: producer writes its ROB entry at cycle i, waiters capture at i+1) → drawn wholly at the
PRODUCE cycle, attributed to the producer, asserting no cycle-precise wakeup (that's step 3's job).
**Three advisor calls that changed the build:** (a) do NOT build a prev-cycle-diff — events
self-describe issue/commit/flush/fetch; only DISPATCH lacks a single-cycle signal, and an IF-driven
dispatch wire would mislight exactly when a full ROB should show it CHOKING (the ROB-size lever), so
`rename→ROB`/`rename→RS` are static SKELETON (never lit; `activate` throws if asked to light one), the
targeted seq-diff fallback never needed (browser-clean); (b) phase-hue stands on its own grammar, NOT
"matches the map" (the map rows by `location`, not phase columns); (c) coherence litmus only —
contraction-lawfulness is N/A (no structural tiering) and deliberately NOT force-fit. **Structural, not
per-lane: ROB/RS/FU are POOLS** (a shared `alu-op` can't be attributed to one of two physical ALUs), so
issue width restructures the CADENCE (tables/map), not this diagram — ONE visibility axis of substance
(representation tier: values@detailed+), the one config gate the predictor's bet redirect (`rename→PC`,
absent when not betting); the ROB-based recovery redirect (`rob→PC`) is ungated. Channels reuse M7 step
7: **wire = region hue** (fetch/decode/execute/memory/broadcast + a redirect accent), **box = shared
pool (hue-neutral)**, **follow-ring = identity on the lit wires** (WireVM.followed; no NodeVM ring, boxes
are pools). **Browser-verified by reading the LIVE SVG, not just eyeballing** (flagship array-sum,
width 2, OoO, static-taken, cache large → 41 cyc): at cycle 16 EXACTLY 8 wires light with FOUR distinct
region hues (`pc-imem` blue → `imem-rename` green → `rs-alu`/`rs-lsu` amber, an R/I add AND a lw address
together → `alu-cdb`/`cdb-rs`/`cdb-rob`/`rob-regfile` purple), matching the dump cell-for-cell;
following ROB#5 rings its full path across FOUR datapath wires (`rs-alu`→`alu-cdb`→`cdb-rs`+`cdb-rob`)
AND lights its ROB table row — the click-only cross-surface follow composition; essentials tier drops
all value labels (0 vs 6 at detailed); `rob-pc` recovery redirect lights at cycle 5 (the dump's FLUSH);
the bet `rename-pc` wire is drawn under predict-taken, absent otherwise; OoO config controls present,
forwarding control absent (renaming makes it meaningless). Two real geometry bugs caught by the
litmuses while authoring: a duplicate `alu-cdb` endpoint and a `cdb-rob`/`rename-rs` collinear overlap.
Gotcha: the renderer's wire follow-ring class is `dp-follow` (single dash), the TABLES' is `dp--follow`
(double) — don't confuse them when reading the DOM. Full repo: **3228 tests** (+17), typecheck, lint,
build, format:check all green.

## Condensed milestone log (relocated from the MEMORY.md index, 2026-07-20)

These are the compressed cross-step findings that used to sit on the MEMORY.md index line. Verbatim; the per-step detail also lives in each `docs/plans/m*-tasks.md`.

**M8 (the superscalar LESSON track, `docs/plans/m8-tasks.md`) IS ✅ COMPLETE — steps 0–6 DONE 2026-07-20 (2503 tests), every acceptance box ticked. Shipped: the `paired-branches` corpus program + the four-lesson "The wide machine" track (`two-at-once`, `pair-that-cant`, `one-door`, `one-branch-unit`) — the FIRST lessons ever on `model: superscalar` at `issueWidth: 2`. NO engine/trace change; content + one `.s`. **Step 6 (browser pass — the only net that sees a superscalar lesson load) was clean on every mechanical check** (picker shows the 4th track with its 4 lessons in teaching order; all four load `model=superscalar` with the **2-wide** toggle pressed — the `issueWidth ?? 1` fall-to-1 ruled out by reading `aria-pressed` scoped to the `-wide` buttons, NOT the first pressed `.seg-btn` which is forwarding's "on"; readout names all three refusal reasons; `two-at-once` shows PAIRED with the IPC tile reading **44 cyc / width 2**, the discriminator a width-1 fall would read 56). **It CONFIRMED-and-FIXED step 4's branch-unit flag — the milestone's one real finding, and a REUSABLE INV-5 pattern: a lesson's central NOUN must be DRAWN, not just NAMED.** The datapath replicates BOTH `ALU 0/1` and `PC arith 0/1` per lane (`laneNodes()` in `datapath-superscalar.ts`) and draws ONE shared `Data Mem` — so `one-door`'s "one door" IS drawn (single Data-Mem box) but `one-branch-unit`'s "one branch unit" was NOT: branch work (compare in ALU, target in PC-arith) is doubled, and the only singular next-PC resource is the shared `pcmux`/PCSrc ("caps EX at ONE resolved transfer per cycle... both lanes steer, at most one ever does" — its own node comment). A learner reading "both need the one branch unit" saw two ALUs they'd just watched pair two adds in `two-at-once` (the expert tier sharpened it: "left the branch unit single" as distinct from "the two execute lanes"). **NB "one branch unit" is the SHIPPED M7 badge** (`REFUSAL_TEXT` in `SuperscalarDatapathView.tsx`, gloss in `pairing-readout.ts`), so the lesson was faithful to the product; the mismatch is an M7 *drawing* decision, and drawing a branch box is view code — OUT of M8's content+browser scope. **User chose the in-scope prose fix (advisor-vetted): reword `one-branch-unit` step 1 to KEEP "one branch unit" as the name** (step 2 references "a second branch unit" — dropping it would dangle) **but GROUND it in what's drawn** — the two execute lanes give two ALUs + two address adders "so doing the comparison is not what is scarce; what is scarce is the resolving," the single next-PC commit, one control transfer resolved per cycle. **Leads with "resolve" NOT "redirect the PC"** (both branches are not-taken — neither steers the PC; each still occupies the one resolution slot to be *determined* not-taken), preserving the load-bearing "before either has been resolved" clause + `branch-resolved` anchor. Confirmed in the browser: backticks render as inline `<code>`, prose now names the very boxes drawn below it. The `one-branch-unit` oracle pins only the closing "42" substring (untouched); the reworded step-1 prose carries NO pinned substring, so no oracle change. **Step 5 (wire the track) was mostly done incrementally by steps 1–4** (step 1 added the `'The wide machine'` heading + order guards because `LESSONS` is globbed; 2–4 appended). Its one genuine remainder: the **by-name track-membership assertion** — `lessonSections()` totality stays green even under a mis-file because `LESSON_ORDER` derives from the same `index.json`, so only naming the set (`toEqual(['one-branch-unit','one-door','pair-that-cant','two-at-once'])`, beside the machine/cache blocks) catches it. **Step 4 (2503 tests) shipped `one-branch-unit.json`, the wide machine's FOURTH beat, its SECOND structural refusal, and the ONE refusal the rest of the corpus can't reach** (`paired-branches` from step 0, same config as steps 1–3 at `issueWidth:2` → w2=7/w1=9; 2 steps: the refusal `{stall, where:{reason:'branch-slot'}}` — UNIQUE so NO `nth` → c1 younger `bne`@pc4 held because elder `bne`@pc0 beside it holds the one branch unit, then `reg-write reg:10 value:42`→c5, `a0=42` by falling through). **THE DESIGN COMPLETES THE TRILOGY: `intra-pair-raw` refuses for what the younger NEEDS (data); `mem-port` AND `branch-slot` refuse for what it IS (memory op / control transfer) — decided by CLASS at issue.** `branch-slot` is the SHARPEST of the three (its unique teaching point, absent from step 3): **the pair is refused BEFORE either branch resolves** — both not-taken, NEITHER flushes, yet the refusal fires a full cycle before either `branch-resolved` lands (c2 elder, c3 younger); the machine can't know the outcomes yet and doesn't need to. **Two clean-anchor facts SIMPLER than steps 2/3: (1) the trace emits EXACTLY ONE stall** (no `la` pseudo-op — the program has none, no data hazard, nothing to slip onto) so no `nth`, and the oracle PINS that uniqueness (a corpus edit adding a 2nd stall reddens rather than silently shifting the anchor); **(2) the closing CANNOT copy one-door's shape** (which anchored the refused LOAD's OWN writeback) — a branch has no result of its own, so the payoff anchors on the architectural `a0=42` the fall-through computes (advisor-flagged). Oracle mirrors one-door's structural signature with `branch-resolved` in place of `mem-read` (both refused younger pc4 AND its ID.0 partner pc0 drive one → contended unit is the single BRANCH UNIT), plus a dedicated "refused before either resolves" oracle (the sign-and-zero shape — thesis lives in narration, pinned against the recording). Width-EXCLUSIVE (dead at w1). NO cycle counts in prose (like steps 2/3). **Wiring was the pure APPEND case: only `LESSONS.length` (14→15) fired** (`LESSON_ORDER` toEqual auto-derives from `index.json`, no track-NAME guard since no track added); also updated the shipped-lessons docblock prose (three→four superscalar lessons, first→two structural refusals). `session.test.ts`'s all-lessons opening loop covered it automatically. **Browser (step 6) flag — RESOLVED (see the M8-COMPLETE header above): the datapath draws two ALUs + two PC-arith adders per lane and no distinct branch box, so the "one branch unit" framing was reworded to ground it in the single next-PC commit (the one thing actually singular in the picture), keeping the shipped-badge name.** Step 3 (2445 tests) shipped `one-door.json`, the wide machine's THIRD beat and its FIRST STRUCTURAL refusal** (`byte-loads`, same config as steps 1/2 at `issueWidth:2` → w2=9/w1=10; 2 steps: the refusal `{stall, where:{reason:'mem-port'}}` — UNIQUE so NO `nth` → c3 `lbu t2,0(t0)`@pc12 held because `lb t1,0(t0)`@pc8 beside it holds the one data-memory port, then `reg-write reg:7 value:128`→c7, the REFUSED lbu's OWN result landing). **THE DESIGN'S SPINE IS THE CONTRAST WITH STEP 2: `intra-pair-raw` refuses a pair for what the younger NEEDS (data); `mem-port` refuses for what it IS (a memory op) — decided by CLASS at issue, before any address forms.** The two loads are MAXIMALLY INDEPENDENT (same address, different dest regs, no shared result) yet still refused — the pure structural hazard, held for structure not data. **THE REUSABLE FINDING (advisor-flagged): pinning `reason==='mem-port'` IS the proof of independence** — byte-loads@w2 emits THREE stalls (2 `intra-pair-raw` from the `la` pseudo-op + the reader's 1st load reading la's `t0`, then the 1 `mem-port`), and a DATA refusal would have fired FIRST if the two loads weren't independent; so the reason string ALONE both rules out the anchor-slip AND certifies "structural" — no separate no-dependency assertion is needed. The oracle adds the SIGNATURE the reason can't carry: both the refused younger AND its ID.0 partner (read straight from `instructions[]` on the refusal cycle — there is NO `at()` helper in `lessons.test.ts` like `pairing.test.ts`'s) drive a `mem-read`, proving the contended unit is the PORT (the one thing width did NOT replicate). Width-EXCLUSIVE (dead at w1: one load per cycle, no contention). NO cycle counts in prose (10→9 undersells a dependency-bound program; the payoff is the structural RULE, not speed); the closing pins both byte results -128/+128 at both widths, "width is not a correctness knob" made concrete. **Wiring was the pure APPEND case (step 5's note "steps 2–4 only APPEND their id"): only `LESSONS.length` (13→14) fired — `LESSON_ORDER` toEqual auto-derives from `index.json`, and NO track-NAME guard fired since no track was added** (contrast step 1, which added the track and rippled to every track-list guard). `session.test.ts`'s all-lessons opening loop covered the new lesson automatically (asserts `issueWidth===2`). Browser pass deferred to step 6. Step 2 (2388 tests) shipped `pair-that-cant.json`, the wide machine's SECOND beat and the track's FIRST refusal** (`array-sum`, same config as step 1 at `issueWidth: 2` → w2=42/w1=51; 2 steps: the refusal `{stall, where:{reason:'intra-pair-raw'}, nth:2}`→c6 `bnez t1,loop`@pc32 held for the `t1` that `addi t1,t1,-1`@pc28 beside it is computing, then `mem-write value:120`→c39 close). **THE REUSABLE TECHNIQUE (advisor-flagged, belongs beside the M6/M7 "dump the real stream before pinning `nth`" lessons, one level up): when a plan says "anchor the FIRST X," VERIFY WHAT THE FIRST X ACTUALLY IS.** The plan said "anchor the FIRST `intra-pair-raw`, cycle 1" — but cycle 1 is the `addi` half of the `la t0,arr` PSEUDO-OP (reading the `t0` its `lui` neighbour just wrote), an instruction the reader never typed and the EXACT trap `forwarding-bubble`'s oracle was written to catch. The plan author corrected the ADJACENT config-drift trap ("not cycle 10") and walked right past the pseudo-op one. `nth:2` skips it to the first SOURCE-LINE dependent pair. **The tempting alternative (steady-state `add a0,a0,t2`) is WORSE: refused TWICE on adjacent cycles (`intra-pair-raw` then `load-use`, because its partner is a LOAD), so a reader scrubbing sees the reason FLIP;** `bnez`/`addi` is a single clean refusal, partner a plain ALU op, once per pass. Branch-ness is INCIDENTAL — the refusal is DATA (needs `t1`); the one-branch-unit structural hazard (`branch-slot`) is reserved for step 4. Oracle pins reason + pc32 + `cycle>1` (skips the la trap) + WIDTH-EXCLUSIVE (dead at w1: no pair ⇒ no refusal, like `forwarding-bubble`'s config-exclusive steps) + closing 120/34-retires at both widths. NO cycle counts in prose (payoff is the dependency, not speed), so unlike step 1 nothing more to pin. `session.test.ts`'s all-lessons opening loop covered the new lesson automatically (asserts `issueWidth===2`). Browser pass deferred to step 6. **Step 1 (2331 tests) shipped `two-at-once.json`, the FIRST lesson ever on `model: superscalar` at `issueWidth: 2`** (sum-loop; 3 anchors re-dumped under THIS config: `instr-fetch nth:2`→c0 opening pair, `alu-op op:add result:19`→c7 mid-loop paired EX, `reg-write reg:10 value:55`→c41 close; anchors chosen arithmetic-fixed so they fire in all 24 sweep positions). **Two forced deviations from the plan's 1-vs-5 split, both routine (advisor-confirmed): (1)** `LESSONS` is GLOBBED so a lesson `.json` can't exist un-wired — the moment it lands, every glob-vs-hardcoded guard fires (`LESSONS.length`, `LESSON_ORDER` toEqual, `lessonSections()` track lists ×2, `LESSON_TRACKS` order). Same ripple as step 0's `.s`, one layer up. So the **"The wide machine"** track (working title, pinned step 5) went into `index.json` NOW with just `two-at-once`; grep EVERY track/count guard before editing. **(2) The generic sweep BYPASSES `lessonOpening`, so it cannot see whether the lesson opens at width 2** — the milestone's headline failure mode (engine `issueWidth ?? 1` reads 56/56 with every anchoring test green). Extended `session.test.ts`'s shipped-lesson opening loop to assert `issueWidth` (failable: arrival width stays 1, lesson declares 2). **The by-name oracle proves the two things the sweep is BLIND to: the PAIR** (exactly two `instr-fetch` on c0, two `alu-op` on the mid-loop cycle — the no-shared-cycle guard checks steps don't collide, NEVER that a cycle holds two lanes) **and the COUNTERFACTUAL numbers DERIVED from the engine** at w1/w2 (56/44 cycles, IPC computed from 34 retires → 0.61/0.77, then asserted present in the closing prose, the M4-step-4 net). Browser pass deferred to step 6. **Step 0 DONE (2275 tests): the `branch-slot` corpus program `paired-branches.s`** (two adjacent `bne x0,x0,done`, both never-taken so NO flush, `a0=42`, `ecall` last word — the corpus's ONLY witness of the third refusal reason). Designed against a fresh per-config dump (`temp\m8\bs.txt` + a throwaway dump test, deleted), NOT eyeballed. Two reusable finds: **(1) adding one corpus `.s` rippled to a FOURTH hard-coded table the plan did NOT name** — `pairing.test.ts`'s `EXPECTED` w1/w2 headline A/B (needs `{w1:9,w2:7}`); its own corpus-guard `expect(files).toEqual(Object.keys(EXPECTED))` failed loudly, exactly as designed. The three the plan DID name: conformance `RESULT_ORACLES`, pipeline `TIMING` (w1), superscalar `TIMING` (w1+w2). So: **before declaring a corpus-widening done, grep for every readdir/glob-vs-hardcoded-list guard, not just the planned ones.\*\* **(2) The only non-obvious cell was superscalar w2 `betting` (static-taken) — DUMPED not guessed** (advisor-flagged): both branches bet taken and both mispredict, and each bet's `killedRest` squashes its would-be mate BEFORE the `branch-slot` rule can refuse it, so **under betting NO branch pairs AND NO branch is refused** — each issues solo (G 3→4, Q 2→1; `betting {groups:+1,pairs:−1}` both positions). Crucially **L stays 0 in every scheme** (betting REMOVED the only refusal), which is what lets `W2_MATRIX`'s scheme-blind `L = blocked[pos]` still balance (`4+0+4+0+4 = 12`); had static-taken introduced any blocking stall, no `betting` value could have balanced it and step 0 would have had to STOP-and-surface. w1 = 9 (not-taken) / 13 (static-taken, two lost bets); w2 not-taken = **7** (the `branch-slot` refusal is the FREE slot-1 kind, L=0), strictly faster than w1. **M7 (in-order superscalar, roadmap tier 4) IS ✅ COMPLETE — steps 0–8 DONE 2026-07-20 (2142 tests), every acceptance box ticked and NO open decision rows.** Step 8's headline is a REUSABLE TECHNIQUE, not a local fix: when a view must decide "did X happen" and the tempting rule keys on event ABSENCE, **read the RESULT instead of enumerating the REASONS** — "no `stall` ⇒ they paired" needs a COMPLETE list of every way an issue can block, and the miss-freeze (which emits no `stall`) makes it announce "paired" for 9 consecutive FROZEN cycles on the flagship cache program; `micro.idEx` simply IS who issued, so blocked-ness cannot be under-counted. Licensed by a dumped identity (**`micro.idEx@N` === `EX.<slot>`@N+1**, 28 configs / ~1600 cycles) that is GUARDED because breaking it fails SILENTLY. Also from step 8: **an observed cycle number is only valid for the CONFIG it was observed in** (a flush test cited a cache-ON cycle against a cache-OFF run and failed loudly — the same slip onto an agreeing cycle would have passed while proving nothing); the browser caught its usual defect (**the panel VANISHED at pre-run**, `trace === null` at cycle -1 hiding the IPC tile — no test here can scrub a cursor); **`refused` ≠ `blocked`** is a deliberate split (the older still issued vs. nobody moved); the readout does NOT agree with the datapath at the same cursor (its subject is ID; the dark lane is one cycle later — **the pipeline map is the surface that agrees**); and the **`issue` trace event is DECLINED WITH PROOF** (M4 +1 field, M6 +0, M7 +0). Step 7 (the widened datapath) is DONE AND BROWSER-VERIFIED CLEAN: two replicated execute lanes, both lit on a paired cycle (`ALU 0`=10, `ALU 1`=9, byte-identical to the dumped trace) and `ALU 1` fully dark on a refused one; `sum-loop.s` 56→44 and `array-sum-twice.s` 208→178 live. **Its headline is that `superscalar-visuals.md` had to be OVERRIDDEN (user asked first): that doc gives the lane hue the WIRE STROKE, but it predates M3 step 6 and the stroke now means STAGE — in the same palette the pipeline map directly ABOVE the diagram uses, so obeying it would have said blue=IF on one surface and blue=lane 0 on the other and made `EX.0`/`EX.1` different colors. PINNED: wire stroke=STAGE, node tint=LANE (replicated boxes only), follow ring=IDENTITY.** Also: three units needed three different replication answers and NONE was guessable — `pcarith` replicates (two `lui`s pair and emit no `alu-op`), the MEM→WB bypass replicates (else the follow-ring points at the wrong instruction), `dmem` does NOT (mem-port rule); **`forward.from` names the LATCH not the slot, so a forward's SOURCE lane is a fact the trace does not carry**; "one lane dark" is a claim about the EXECUTE BAND only (the front-end keeps fetching two behind a refusal) and its own test caught that over-claim; the refusal BADGE and the dark lane are ONE CYCLE APART; and 12 diagonal-wire failures were fixed structurally by deriving every coordinate from the node rather than typing y's. New reusable technique: **measure label/box overlap programmatically in the browser via `getBBox()` — "it looks tight" is what an eyeball is worst at** (it was legal 4px clearance). New tooling gotcha: the chrome `zoom` action PINS screenshot capture size for the session and resize can't restore it. Step 6 (web enablement) is DONE AND BROWSER-VERIFIED: `sum-loop.s` at forwarding ON, flipping `1-wide → 2-wide` WITHOUT reloading, moves `56 → 44` and the map draws `IF.0`/`IF.1` in one column — M3 step 7's lane claim cashed against a REAL engine. That eyeball was load-bearing, not ceremonial: deleting `issueWidth` from `loadInto`'s config leaves all 581 web tests green (the field is OPTIONAL, so `?? 1` runs both toggle positions at width 1) — a dead toggle reads 56/56 and ONLY the number moving tells them apart. Second view step ever to survive a browser pass with no defect. **TWO TRAPS, both making the honest number look wrong: the transport is 0-INDEXED (`lastCycle = recordedCycles - 1`), so 56 cycles reads `cycle 55 / 55` — read `X / Y` as `Y + 1`, and NEVER "correct" a pinned count to match the screen; and the app opens at forwarding OFF while 56/44 are forwarding-ON numbers (the OFF default reads 78, itself a derived matrix cell).** Also: `npm run dev` climbed to port 5182, and CDP screenshot/click TIME OUT often on this page though the action still lands — pause ~6s and re-read rather than re-clicking. Step 5 was a PROOF not a build (`recorder.ts` UNTOUCHED — `follow()` keys on `id`, so slots come free); it pinned that **a slot is NOT a stable lane** (an instruction slides 1→0, its neighbour 0→1, a third slides inside IF — and `sum-loop.s` does NOT slide, so a 4-instruction program had to be written to provoke one), and it found a REAL cache-aliasing hole that 694 green tests missed (the cache is single-buffered and mutated in place ⇒ a shallow snapshot replays cold-as-warm; the adjacent latch `.slice()` is by contrast dead-defensive — **two adjacent copies can have opposite load-bearing status, so provoke each separately**). Width 2 is a real machine: strictly faster on all 7 corpus programs, sum-loop 56→44. ✅ The PROVISIONAL warning is DISCHARGED — step 4 re-derived all seven width-2 counts from the pinned rules via `cycles = G + L + P + M + 4` and NONE moved. Key step-4 facts: at width 2 a slot-1 refusal is FREE (so `S` splits into blocking `L` + free refusals); `G`/`Q` are NOT prediction-invariant (a betting branch kills its pair-mate); `P`/`M` ARE width-invariant; `killedRest` is dead code (`stageIf` is the real enforcer).** User-pinned: extract-then-fork, width as an in-model 1↔2 toggle, full visual layer, sliding/greedy issue grouping. **Read the M7 section before touching it — its single most important warning is that INV-8 is a FALSE SAFETY NET here** (in-order superscalar retires in order, so conformance passes even with the pairing logic completely wrong; timing is the whole point and has no golden reference). **M2 steps 5c, 5d AND 5e DONE 2026-07-20 (1357 tests) — M2 has NO deferred work and NO stated omissions left, full stop. 5c drew the next-PC redirect (cost a 4th mux, ALUSrcA, the plan hadn't predicted); 5d drew the TAKEN-BRANCH redirect via a second adder (`branchadd`, `pc+imm`); 5e drew the PCSource mux — and surfaced that the note understated itself, because the SEQUENTIAL `pcarith→pc` driver it named had no wire at all ("PC ← PC+4" had never been drawn). Key reusable lessons: a stated omission naming a missing SELECTOR must be checked against whether every input it selects is drawn; when a new truth breaks an old proxy assertion, re-express the assertion's intent rather than carving an exception into the new rule; **`instr-retire` does NOT mean "pc advanced"** (a halting `ecall` retires with pc PARKED — key next-PC views off `state.pc`); and **if a header comment asserts behaviour for a case, that case must have been OBSERVED — a claim with a rationalization attached is the shape a bug hides in** (5e's only real defect was caught this way, by neither tests nor the browser).\*\* **Status: M1–M6 COMPLETE** (single-cycle → multi-cycle → 5-stage pipeline w/ forwarding + branch-prediction toggles → the ISA lesson track → **caches, the third pipeline toggle**), plus the **ISA reference panel**. **M6 COMPLETE — STEPS 0–7 DONE** (2026-07-18, **1337 tests**): the size-straddler corpus program `array-sum-twice.s`; a pure **timing-shadow** cache (tags+valid, no values, so INV-8 is green by construction); the pipeline's **first variable-latency stage** (a miss freezes IF/ID/EX for `missPenalty` cycles via `missCyclesRemaining`); the full **fwd × predict × cache** conformance + timing matrices (closed form `cycles = N+4+S+P+M`); the web `[off][small][large]` toggle riding the config seam with zero widening; the CACHE GRID VIEW (STATE panel, `cache-grid.ts` fold + `CacheGridView.tsx`); and **step 7's CACHE TRACK** — three lessons in a new `The cache` track (`cache-spatial` → `cache-temporal` → `cache-conflict`), order fixed in the plan + pinned by name, anchored to `cache-access` events (INV-6). M2 step 5c is DONE (2026-07-20) — no longer deferred. **Recurring lessons and every step's findings live in the file — read it for any non-trivial cache/lesson work.** A few load-bearing M6 finds: the cache is 3 machines (off/small/large) not 2, so the toggle earns 3 positions honestly; a miss-freeze emits **no `stall` event**, so the cache is invisible to lesson stall-anchors AND the grid derives its `filling` countdown from `micro.exMem.missCyclesRemaining` (draw the freeze, don't skip it); **the cache grid is a STATE view** (reads `micro`, post-install — NOT the datapath's one-cycle-ahead `micro` trap); the pipeline `index.ts` re-exports the cache READ surface (`CacheState`/`CacheLine` + pure `lineIndex`/`lineTag`/`blockBase`/`blockBaseOf`) while `access`/`newCache` stay private; a bigger cache **weakly** dominates (size only pays where there's reuse — `array-sum.s` buys nothing, `array-sum-twice.s` the straddler buys +20). **Step-7 finds:** the identity trap was reconciled by **canonicalizing a declared geometry to its shipped constant at LOAD** (`canonicalCache` in `lessons.ts` + pure `cacheEquals` in `session.ts`), keeping the shell's "cache is always one of three constants" `===` contract TRUE everywhere (setCache/CacheToggle unchanged) rather than deep-comparing at every `===`; **a STORE emits a `cache-access` too** (`array-sum`'s `sw` is a 6th access, a hit — count LOADS not accesses; dump the real event stream per (program×config) before pinning `nth`); a **re-miss on a full cache is badged EVICT not MISS** (the re-fetch also evicts — the two blocks thrash), caught by the browser; and **never edit this repo's UTF-8 `.md` with PowerShell `Set-Content`** — it corrupts → — × into mojibake; use the Edit tool.
