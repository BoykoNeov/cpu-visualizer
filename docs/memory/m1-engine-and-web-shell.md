---
name: m1-engine-and-web-shell
description: 'M1 build log (steps 0-11): the headless engine path isa -> assembler -> reference -> single-cycle -> trace recorder, the first React shell + SVG datapath, depth tiers (tier the REPRESENTATION, not the structure), the curriculum lesson format and event anchoring, and the sandbox fork-on-edit.'
metadata:
  node_type: memory
  type: project
---

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
