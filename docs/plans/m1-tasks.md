# Milestone 1 — task checklist

The first vertical slice: prove the entire stack end-to-end on the **single-cycle** model.
Source of truth for scope and acceptance is `cpu-visualizer-spec.md` §11. This file tracks
progress and the small decisions taken along the way.

## Build order (spec §11)

Each step should be testable before the next.

- [x] **0. Scaffold** — monorepo (npm workspaces), TypeScript project references, Vitest,
      ESLint with dependency-boundary rules, Prettier, CI, and a real RV32I decoder seed in
      `isa` proving the toolchain end-to-end.
- [x] **1. `isa`** — full instruction definitions, field encodings, decoder **and encoder**
      (40 base RV32I integer instructions). One declarative table (`instructions.ts`) is the
      single source of truth for **encoding** — it drives both the by-opcode decode index and
      the by-mnemonic encode index, plus a co-located per-format immediate codec
      (`immediates.ts`), so decode/encode can't drift and "round-trip exactly" holds by
      construction. `fence` decodes as a no-op; `ecall`/`ebreak` decoded (split on imm[11:0]);
      Zicsr/`fence.i` deliberately out of scope. Tested: hand-verified `(asm, hex)` oracles
      (both directions), the shift/SYSTEM gotchas, and whole-table + boundary round-trips
      (97 tests green). NOTE: `format` is an **encoding** class, not an assembly-**syntax**
      class — step 2 layers operand syntax (`lw rd,imm(rs1)` vs `addi rd,rs1,imm`, `jalr`
      forms) on top.
- [x] **2. `assembler`** — DONE (2026-06-21). Two-pass driver (layout+symbols, then
      resolve+encode) over a small hand tokenizer with 1-based `line:column` diagnostics.
      Parses the full base integer set, `x0..x31` **and** ABI register names, labels,
      pseudo-instructions (`li`, `mv`, `nop`, `j`, `jr`, `ret`, `la`, `beqz`, `bnez`), and
      `.text`/`.data`/`.word`/`.byte`/`.asciz`/`.globl`. An **operand-syntax** layer sits on
      top of the ISA encoding `format` (the step-1 NOTE): `lw rd,imm(rs1)`, `sw rs2,imm(rs1)`,
      the `jalr` forms, and `lui`'s pre-shifted immediate. `li`/`la` share a `hiLo` 32-bit
      materialization; the `lui`+`addi` +1 sign-correction is pinned by a decode-and-sum
      round-trip test. `assemble()` returns `{ program | null, errors[] }` and collects
      multiple located errors. Single-instruction encodings are checked against the same
      hand-verified oracle hexes as `isa`'s `codec.test.ts`; the real `content/programs/add.s`
      is assembled from disk as a fixture. 62 tests green.
- [x] **3. `engine/reference`** — DONE (2026-06-21). Dead-simple golden interpreter:
      pure fetch/decode/execute over all 40 RV32I instructions, no microarchitecture, no
      `CycleTrace`. `run(program, {maxSteps?}) → { state, steps, haltReason }`, returning a
      trace `MachineState` (reuses `makeRegisters`/`MemoryView`) so the step-6 differential
      comparison is uniform across engines. **One flat sparse byte-memory** holds text + data
      (fetch/load/store share one path) — windowing to a text/data/stack view is the _view's_
      job, not the engine's (INV-2/INV-3), so `definedAddresses()` legitimately includes text.
      `decode`'s `'unknown'` is trapped (halts loudly, never silently advances); off-end is
      `pc-out-of-range`; `ecall`/`ebreak` halt; `fence` is a no-op. Tests are **hand-computed
      oracles** (the reference is the root of trust — it can't be diff-tested against anything),
      built with the real assembler, covering the sign traps (`sltiu` vs `slti`, `srl`/`sra`
      and `srli`/`srai` on a high bit, `lb`/`lh` sign-extension, `.word`→`lw` endianness, a
      backward branch, all six branch variants incl. the `bltu`/`bgeu` unsigned trap, the
      bitwise ops, `jal`/`jalr` call/return). 31 tests green (239 total).
- [x] **4. `engine/single-cycle`** — DONE (2026-06-21). First model behind the `Processor`
      interface (§6). Per `step()` it fetches/decodes/executes/retires exactly one instruction
      (no hazards by construction) and emits a `CycleTrace`: one `InstructionInstance`
      (`location: "single-cycle"`, stable id `i${seq}` — a fresh id per **dynamic** execution,
      so a looped instruction gets a new id each iteration, INV-4) plus an ordered event stream
      (`instr-fetch` → `reg-read`s → `alu-op` → `mem-*` → `reg-write` → `instr-retire`; every
      `event.instr` equals the instance id). **State is an independent per-cycle snapshot**
      (`registers.slice()` + `SparseMemory.snapshot()`) — the load-bearing requirement for
      step-5 time-travel (pinned by a test that overwrites a reg/mem cell across cycles and
      asserts each recorded trace keeps ITS value). Halt timing mirrors the reference so final
      state will match the reference (the INV-8 _equivalence_ is formally proven in step 6):
      `ecall`/`ebreak`/unknown halt without advancing pc; running off text-end folds into the
      last cycle with `pc` = the out-of-range value; empty image is halted at reset; `step()`
      after halt throws. The ALU/sign idioms (`s`/`u`, `imm & 0x1f`, `>>> 0` at the memory
      boundary) are mirrored **verbatim** from the reference — those are ISA semantics, identical
      in every model; what is independently implemented (and what the step-6 diff therefore
      validates) is the per-cycle plumbing + events. Oracles are hand-computed (this engine does
      NOT import the reference — see `toProgramImage` note); coverage was brought up to the
      reference's — **all 40 base ops + `fence`/`ecall`/`ebreak` are each directly executed**
      (the register-form ALU set, all six branches, every load/store width, `auipc`) so no
      instruction rests on the step-6 net + the thin example corpus alone. Also pins the trace
      shape, the snapshot contract, the classic sign traps, loop-id freshness, and call/return.
      28 tests green (268 total).
- [x] **5. `trace` driver/recorder** — DONE (2026-06-30). `TraceRecorder`
      (`packages/trace/src/recorder.ts`) wraps any `Processor` and keeps the full
      `CycleTrace[]`; navigation is a cursor in `[-1, recordedCycles-1]` where **-1 is the
      pre-run state** (program loaded, nothing executed — captured via `getState()`).
      `stepBack`/`scrubTo` move the cursor and read the snapshot already there — they **never
      re-run the engine** (a unit test pins reference-identical replay + an unchanged `step()`
      count); `stepForward`/`scrubTo`/`runToEnd` past the high-water mark are the ONLY paths that
      call `engine.step()` and append. `stepForward` returns `null` at a halted end instead of
      throwing (unlike raw `step()`); `load(image, config?)` owns the reset+record lifecycle so a
      new program restarts cleanly. `follow(id)` is the §6 "follow this instruction" (INV-4):
      every recorded cycle an id is in-flight plus its `location` (one sighting in single-cycle;
      generalizes to a pipeline's IF→…→WB). Strengthened the `Processor.getState()` doc to
      **require an independent snapshot** (the pre-run capture relies on it; single-cycle already
      complied). Tested two ways: a `trace` unit suite drives a hand-scripted **stub** `Processor`
      (the DAG forbids importing an engine here) to pin the cursor/replay/scrub/clamp logic; an
      `engine/single-cycle` **integration** suite drives the REAL engine through the recorder for
      the actual acceptance flow (load → run → back → scrub with per-cycle snapshots matching;
      recorder reaches the same final reg+mem as a hand-driven run; each loop id follows to its
      one cycle). 19 new tests (287 total). DEFERRED (unchanged): the §5 `PhasedEvent` phase
      ordinal — event **order** already encodes fetch→decode→execute→mem→writeback, so add the
      explicit ordinal only when step 8's within-cycle animation actually consumes it, not before.\_
- [x] **6. Differential tests** — DONE (2026-06-30). The INV-8 net:
      `packages/engine/single-cycle/src/differential.test.ts` enumerates every `.s` in
      `content/programs/` **from disk** and, per program, runs BOTH the golden reference
      (`run`) and the single-cycle engine to a halt — driving the **raw `Processor`**, not the
      recorder, so step-6 (engine equivalence) stays isolated from step-5 (the recorder, already
      integration-tested). It then asserts equal final state: all 32 registers + every memory
      word either engine touched (**union** of both `definedAddresses()`), plus `pc`/`halted` as
      a strengthening that pins step-4's "halt timing mirrors the reference" claim. Equality
      alone isn't correctness — two engines could share a bug, and these programs double as lesson
      fixtures — so each authored program also carries a **hand-computed headline-result oracle**
      asserted against the reference (the root of trust); the equality check then carries that
      guarantee to single-cycle (mirrors the reference's own hand-oracle methodology). Grew the
      corpus from `add.s` alone to **five** (one corpus, three jobs — §9): `sum-loop` (counting
      loop / backward branch → 55), `array-sum` (`.data` walk, `lw`/`sw`, a negative word → 120),
      `call-return` (`jal`/`ret` linkage, `max(17,42)` → 42), `byte-loads` (`lb`/`lbu`
      sign-vs-zero trap → -128 / 128). `add.s` is the **pc-out-of-range canary** — the only
      program that halts by running off text-end, not via `ecall`, where a halt-timing mismatch
      would surface first. A discovery guard fails if the corpus globs empty (no vacuous pass);
      a `MAX_STEPS` cap turns a runaway authoring bug into a failure, not a hang. 6 new tests
      (293 total).
- [x] **7. `web` shell** — DONE (2026-07-01). Replaced the decoder-preview scaffold with a
      real shell that drives the single-cycle engine through the **`TraceRecorder`** (never the
      engine directly — INV-3). `useSimulator` (`packages/web/src/useSimulator.ts`) holds the
      recorder in a ref and uses a bare tick counter to re-render; **every panel reads live from
      `recorder.currentState()` / `recorder.current()`** — no register/memory state is ever
      shadow-copied into React, which is what makes "shown state always matches the recorded
      trace" hold by construction. Transport = reset / back / step / run + a scrub slider
      (`min=-1` "start (pre-run)" … `max=recordedCycles-1`); `select` runs the program to end up
      front (fixed-length scrub bar) then parks the cursor at -1. Three panels
      (`panels.tsx`): source↔machine-code (inverts `sourceMap` to show each line's word(s),
      highlights the in-flight line), registers (all 32 GPRs, ABI+`xN`+hex+signed, current-cycle
      writes highlighted), and **data memory** — filtered to `addr >= DATA_BASE` because the flat
      model's `definedAddresses()` legitimately includes text (windowing is the view's job,
      INV-2/3; the instruction words already show in the source panel). Programs come from the
      **real corpus** via `import.meta.glob('…/content/programs/*.s', {query:'?raw',eager:true})`
      (INV-7 — no duplication; `server.fs.allow:['../..']` lets the dev server read the repo
      root). The one non-React unit (`simulator.ts`: assemble → `toProgramImage` → `recorder.load`)
      is headlessly tested (`simulator.test.ts`: a corpus program runs to its hand-known result;
      bad source yields located errors; the glob discovers the whole corpus) — the transport
      itself is already fully proven in `trace`, so no jsdom was added. 3 new tests (296 total).
      Verified end-to-end via `npm run build` (glob inlined) and `npm run dev` (raw `.s` served,
      HTTP 200).
- [x] **8. SVG datapath view** — DONE (2026-07-01). The canonical single-cycle RV32I datapath,
      hand-authored in SVG (§14) and wired to the trace. Split into a pure, headlessly-testable
      model (`packages/web/src/datapath.ts`) — fixed **geometry** (nodes/wires with hand-placed
      coords) plus `activate(CycleTrace) → { components, wires, writtenReg }` — and the SVG view
      (`DatapathView.tsx`) that lights the model and labels active wires with the value flowing on
      them. The activation is **decode-driven for topology, event-driven for values** (INV-3): the
      active path comes from `InstructionInstance.decoded` (so `lui`/`jal`/`auipc`, which emit no
      reg-read/alu-op, still light a complete imm→writeback / target-adder path — the trap an
      event-only mapping falls into), while wire values come from the emitted events
      (reg-read/alu-op/mem-\*/reg-write) with fallback to `decoded.imm` / instruction `pc` for
      segments no event covers. **Within-cycle phase sequencing** (Fetch→Decode→Execute→Memory→
      Writeback) is a view-local stepper that progressively reveals the path — derived from event
      order, NOT a schema `PhasedEvent` ordinal (the step-5 deferral holds: order already encodes
      the phases, so no engine/trace change was needed, INV-2). Each node/wire carries an unused
      `minTier` field reserved for step 9; no tier logic yet (the view stays tier-oblivious). The
      derivation is unit-tested (`datapath.test.ts`, 5 tests) against the REAL engine on three
      gap-exposing instructions — a **load** (full IF→WB through memory), a **branch** (PC-select
      live, no memory/writeback), and **`lui`** (no reg-read/alu-op, imm→writeback) — plus a
      geometry sanity check; the visual half was eyeballed via headless-Chrome screenshots of the
      load/store/branch/pre-run states (as step 7 was). 5 new tests (301 total). `npm run build` + `dev` verified.
- [x] **9. Depth-tier rendering** — DONE (2026-07-01). Three depth tiers (`essentials → detailed
→ expert`, axis B / §4) on the datapath view. **Key finding: on single-cycle we tier the
      _representational fidelity_ (§4 layer 2), NOT the structural detail (layer 1).** The first
      cut hid boxes at lower tiers (`immgen`/`alusrc`/`branchadd` promoted to `detailed`), but
      headless-Chrome screenshots of the _lit path_ exposed an INV-5 **contradiction**: on a
      connected single-cycle datapath every box is on the active path for some common instruction
      (`alusrc` for every ALU op, `immgen` for imm/load/store, `add4`/`pcsel` for every fetch), so
      hiding one leaves a lit wire dangling — `lui` showed a value arriving at the writeback mux
      from nowhere, `addi` showed "the ALU made 5 from one operand." That is a wrong model a
      learner must _unlearn_, not a lawful abstraction. So structural box-hiding was abandoned for
      this datapath and the tiered layer became labels over the (tier-invariant) geometry:
      **essentials** = the bare lit path (no wire value labels — the phase stepper is the story);
      **detailed** = + the value on each active wire; **expert** = + each mux's control-line label
      (`ALUSrc`/`MemToReg`, via a `controlLabel` field). Lawful **by construction**: every tier
      draws the same wires, each tier only _adds_ labels — nothing is ever omitted that a higher
      tier contradicts (the INV-5 litmus). `activate` stays completely tier-oblivious (INV-2); it
      always emits full state + values and the renderer chooses which labels to draw
      (`showValueLabels`/`showControlLabels`, pure policy helpers). Value labels are all-or-nothing
      at essentials — showing _some_ would reintroduce a value with no visible source. Kept from
      the first cut: the `minTier: DepthTier` mechanism (imported from `curriculum`, the single
      source of tier order) + `tierVisible`/`nodeVisibleAt`/`wireVisibleAt` are wired through but
      **unused on single-cycle** (no node sets `minTier`) — reserved for the pipeline tier, where
      §4's own forwarding example (essentials arrow → expert mux + hazard unit) makes structural
      hiding meaningful because those units _aren't_ on every instruction's path. Also kept: each
      wire's explicit `ends: [a, b]` (the two node ids it physically connects; the display `id`
      does NOT reliably name them — `regfile-rs2` terminates at `alusrc`) and the endpoint-driven
      wire-visibility rule. A `DepthDial` in the web header (defaulting to `detailed`) drives it;
      the **narration** half of the depth axis ships via the already-seeded `resolveNarration`
      (curriculum) and is exercised when lessons land (step 11). Tests (`datapath.test.ts`, +7 →
      12): `tierVisible` + `showValueLabels`/`showControlLabels` semantics, structure is
      **tier-invariant** (all boxes/wires at every tier), a **no-dangling-wire** coherence check,
      and an **`ends` drift guard** (each wire's first/last point lies on its named node's box).
      The visual half — essentials reads as a true-but-spare diagram with no orphaned values,
      detailed adds numbers, expert adds control lines — was verified via headless-Chrome
      screenshots across all three tiers on `lui`/`addi`/`lw` (the gap-exposing instructions).
      `web` gained `@cpu-viz/curriculum` as a declared dependency (Vite alias + tsconfig path
      already existed). 308 tests green. `npm run build` verified.
- [x] **10. `curriculum`** — lesson format + runner + event-anchoring. DONE (2026-07-01).
      Split the seed `index.ts` into `lesson.ts` (the declarative FORMAT) + `runner.ts` (the
      event-anchoring RUNNER), with `index.ts` a barrel. **Format:** added a first-class
      `LessonTrigger` (`event` + `nth?` + `where?`) and a `config?: ProcessorConfig` on `Lesson`
      (spec §13; optional — single-cycle ignores config, consumers fall back to `defaultConfig()`).
      `where` is a **declarative shallow-equality object** (`Record<string, number|string|boolean>`),
      NOT a function predicate — lessons must stay serializable DATA the engine doesn't compile
      against (§13), so "the first `reg-write` to reg 10" is `{ event:'reg-write', where:{reg:10} }`;
      a key absent on the event reads `undefined` and simply fails to match (no throw), naturally
      scoping `where` to its event type. **Runner (INV-6):** anchoring is the expensive STATIC step
      (`anchorLesson` → `AnchoredStep[]`, each carrying `{cycle, eventIndex}` or `null`); the depth
      tier is a LIVE dial, so narration is a separate PURE query (`narrationFor`, delegating the
      tier fallback to the existing `resolveNarration`, INV-5) — a tier change re-resolves without
      re-anchoring (no stateful class; memo-friendly for web). `activeStepAt` resolves by
      **`(anchorCycle, eventIndex)` position, not authoring order** (two steps can share a cycle; the
      later-firing event wins) and **skips unanchored (`null`) steps** so a never-firing trigger
      can't swallow the active slot. Non-monotonic anchors are an **authoring** bug, not a runner
      bug: the query path stays graceful, and a dev-time `anchorOrderViolations` flags steps that
      anchor backward (for lesson-authoring validation, never the query path). **PRECONDITION** (in
      the runner doc): anchor against a COMPLETE recording — the recorder records lazily at the
      high-water mark, so callers `runToEnd()` first (web's `select` already does). Framework-agnostic:
      depends only on `@cpu-viz/trace` (no new dep; `ProcessorConfig`/`CycleTrace`/`TraceEvent` all
      from there) — the DAG (`curriculum ← trace` only) is unchanged. Tested (`runner.test.ts`, 14 +
      the 3 moved narration tests = 17) with **hand-built `CycleTrace[]` fixtures** — the DAG forbids
      importing an engine here (same pattern `trace` used with a stub `Processor`); one fixture
      mirrors the REAL single-cycle event order (fetch → reg-read(s) → alu-op → mem-\* → reg-write →
      retire) so anchoring is validated against real shape, not an invented one. Covers nth-across-
      cycles, `where` match/absent-key/mismatch, unanchored→null, same-cycle tie-break by eventIndex,
      skip-unanchored, narration tier fallback + undefined-when-nothing-active, and the order-violation
      check. A **real-engine integration test lands in `web` at step 11** when actual lessons exist.
      322 tests green.
- [x] **11. Author 2–3 lessons** + wire sandbox-fork on edit + UI narration panel.
  - [x] **Author 2–3 lessons.** DONE (2026-07-13). Three lessons authored as declarative JSON in
        `content/lessons/` (`sum-loop-tour`, `array-in-memory`, `function-call` — parallel to
        `content/programs/*.s`, the platform/content split §13; `program` references a corpus program
        by base name, INV-7). Each is single-cycle, `depthDefault: detailed`, with 4–5 event-anchored
        steps carrying per-tier narration (essentials/detailed/expert, INV-5). Anchors are the exact
        events the engine emits (verified against `processor.ts`): e.g. sum-loop's final total is
        `reg-write reg:10 nth:11 → 55`, the loop-back is `alu-op op:'bne'`; array-sum's negative element
        is `mem-read where:{value:-4}` (safe: `readWord` returns signed int32); function-call's linkage
        is `reg-write reg:1` (ra, written only by `jal`) → 12. Lessons are UNTRUSTED JSON (a mistyped
        `event`/`where`/tier key fails silently), so the type-safety is bought back by a **real-engine
        integration test** — the plan's promised step-11 test lands in `web`
        (`packages/web/src/lessons.test.ts`): it drives the REAL single-cycle engine (the runner's own
        tests use hand-built fixtures; the DAG forbids importing an engine into `curriculum`), and per
        lesson asserts (1) every step anchors non-null, (2) `anchorOrderViolations` is empty, (3)
        narration resolves at `depthDefault`, (4) the program resolves in the corpus, plus per-lesson
        **payload oracles** (55 / 120 / 42, the −4 load, ra=12) so a right-type/wrong-occurrence anchor
        can't pass. Web loads them via `lessons.ts` (globs `content/lessons/*.json`, mirrors
        `programs.ts`). Needed one small `trace` addition: `TraceRecorder.recorded` (a read-only
        getter for the full `CycleTrace[]`) — the runner anchors against a complete recording but the
        recorder previously exposed only the cursor's cycle. 13 new tests (338 total). `npm run build` + typecheck + lint verified.
  - [x] **Wire sandbox-fork on edit.** DONE (2026-07-13). The spec §13 fork: editing the program
        mid-lesson detaches the lesson's annotations and drops into free-play on the edited program,
        while the lesson survives (re-selectable on the original). Modeled as a **pure tagged-union
        `Session`** (`packages/web/src/session.ts`: `example` | `lesson` | `sandbox`) with the three
        transitions (`exampleSession` / `lessonSession` / `forkToSandbox`) as pure functions — so the
        detach is unit-testable off the UI (`session.test.ts`, 5 tests): `forkToSandbox` clears the
        active lesson (`activeLessonOf → null`) but retains the `origin` program (resume/revert
        target). `useSimulator` swapped its `programName` state for a `Session`; the old `select`
        body was extracted to a shared `loadInto(source)` (assemble → record with the teaching cap →
        park at pre-run), and `select` / `startLesson` / `loadEdited` differ ONLY in the `session`
        they set first — so **the sandbox drives the exact same recorder path as any corpus program**,
        which is why "the sandbox run still animates" holds by construction (INV-3; nothing new
        touches the engine/trace). New exposed surface: `activeLesson`, `sandbox`, `loadedSource` (the
        source panel now shows the *loaded* program, not the origin — required so a sandbox's
        source↔machine-code stays consistent), and a `loadGen` token (bumped on `select`/`startLesson`
        but NOT on edits) so the editor reseeds its draft even on a same-program re-select while
        preserving an in-progress edit across a re-record. `App` gained an editable-source panel
        (explicit **Run edit** — never on-keystroke, so a half-typed loop can't trip the runaway
        guard mid-edit), a **Lesson** picker (starts/stops following a lesson), and a **ModeChip**
        (Free play / Lesson / Sandbox) — the minimal visible surface that makes mid-lesson → edit →
        fork legible. The editor stays reachable when an edit fails to assemble (`showEditor =
        editorOpen || errors`) so the user can fix + re-run. Proven headlessly against the REAL engine
        (`sandbox.test.ts`, 2 tests: a mid-lesson edit detaches the lesson yet the edited sum-loop
        records to its OWN result 15 and time-travels; an infinite-loop edit trips the teaching cap).
        348 tests green; `npm run build` + typecheck + lint green. **Verification caveat:** the
        interactive browser click-through was NOT captured — headless-Chrome `--screenshot` cannot
        settle against the Vite dev server's HMR socket in this environment (`--virtual-time-budget`
        never idles); it rests on the build + `tsc --noEmit` + the headless engine tests, per the
        step-7 "no jsdom, eyeball the React layer" precedent. (Now closed by the **UI narration
        panel** bullet below — the last piece before Milestone 1 closes.)
  - [x] **UI narration panel.** DONE (2026-07-13). The visible play-through of an authored lesson
        (INV-6): a blue lesson card between the transport and the datapath, shown only while a
        lesson is attached. It surfaces the step active at the cursor with its narration resolved at
        the current depth tier (INV-5), a clickable numbered step rail (past filled / active bright /
        future hollow), and Prev/Next-step controls that **scrub the timeline** — so advancing a step
        animates the datapath, registers, and source in lockstep. Anchoring is done ONCE per
        `(lesson, recording)` — `useSimulator` exposes `anchoredSteps` (memoized `anchorLesson`
        against the recorder's COMPLETE `recorded` trace, whole because `loadInto` runs the program
        to end before `loaded.current` is set) — and a scrub or depth change re-**queries** the cached
        anchors, never re-anchors. The panel's view-model is a pure, headlessly-tested helper
        (`packages/web/src/narration.ts` + `narration.test.ts`, 8 tests, hand-built `AnchoredStep`
        fixtures — mirrors `session.ts`): `narrationView(anchored, cursor, tier)` delegates the
        active-step/tier logic to the runner (`activeStepAt`/`resolveNarration`) and adds only the
        panel's timeline ordering (by `(cycle, eventIndex)`, tie-break included) + prev/next scrub
        targets; a `null`-anchored (never-fired) step drops from the rail. Narration text renders
        `backtick` register/instruction names as inline `<code>` (no markdown dep). This ALSO closes
        the narration half of the depth-tier acceptance (§4 axis B): the panel is the visible surface
        where changing the depth dial re-resolves the lesson narration. **Verified end-to-end in a
        real headless browser** (unlike the sandbox bullet's dev-server caveat): a CDP driver over a
        **`vite preview`** static build (no HMR socket, so it settles) selected the lesson, clicked
        Next step to reach "Step 3 of 5", and screenshotted the panel — the accumulate narration, the
        lit ALU path at that cycle, `a0`=10 in the registers, and the highlighted source line all
        coherent — then toggled the dial to Essentials and captured the narration collapse to its
        one-line variant (proving tier re-resolution in place). 356 tests green; typecheck + lint +
        build green. **Milestone 1 is complete.**
  - [x] **Runaway-guard the sandbox path.** DONE (2026-07-13). The recorder side already carried a
        `maxCycles` cap on `runToEnd`/`scrubTo` (both default 1M, tested in `recorder.test.ts`); this
        wired the **web** side. `useSimulator` now threads a teaching-scale `TEACHING_MAX_CYCLES =
50_000` through all three engine-advancing call sites (`select`'s up-front `runToEnd`, plus the
        exposed `runToEnd`/`scrubTo` — harmless on the replay-only ones today, future-proofs a lazy
        recorder). The live throw site is only `select()` (it records the whole program up front); its
        `runToEnd` is wrapped in try/catch — on overflow it **discards** the non-halted recording
        (`loaded.current = null` — keeping it would re-throw on the next scrub-forward) and sets a new
        `runtimeError` channel. `runtimeError` and the assembler `errors` are **mutually exclusive**:
        every one of the four transitions (assemble-fail / overflow / success) clears the other. App
        renders a `NoticeBox` ("Program did not finish") in place of the transport, mirroring
        `ErrorBox`. Verified end-to-end with a throwaway probe: an infinite `j loop` assembles then
        throws `non-terminating` at the cap via the REAL single-cycle engine, while a terminating
        program doesn't; the React catch is eyeballed (no jsdom, per the step-7 precedent). 325 tests
        green (no new headless test — the cap throw is already covered in `recorder.test.ts`).

## Acceptance criteria (spec §11)

- [x] Assembler assembles every example program; known-good encodings round-trip exactly.
      _All five corpus programs assemble from disk (the step-6 differential test assembles each
      before running it); oracle encodings + `li` round-trip pinned in `isa`/`assembler`._
- [x] Single-cycle final reg+mem state equals the golden reference for every program (INV-8).
      _Proven headlessly by `differential.test.ts` over the five-program corpus (step 6),
      registers + memory + `pc`/`halted`; new programs dropped into `content/programs/` are
      covered automatically._
- [x] Load → step forward to completion → step back to start → scrub to any cycle; shown
      state always matches the recorded trace. _Headlessly proven by `TraceRecorder` (step 5);
      the visual half is now live in the step-7 web shell — the transport + scrub slider drive the
      recorder and all three panels render `recorder.currentState()`/`current()` at the cursor, so
      forward/back/scrub always show the recorded state. (Datapath animation of the scrub is step 8.)_
- [x] Switching depth tier changes datapath detail and narration without changing engine
  behavior and without violating lawful simplification (INV-5). _View half DONE (step 9): the
  depth dial changes the datapath's representational detail — essentials shows the bare lit path,
  detailed adds wire value labels, expert adds mux control labels — each tier only ADDS (lawful by
  construction, screenshot-verified on lui/addi/lw); `activate`/the engine are untouched (INV-2).
  Structural box-hiding was tried and rejected here: every box is on the active path, so hiding one
  contradicts (value-from-nowhere) — it's reserved for the pipeline tier. Narration half DONE (step
  11): the lesson narration panel resolves each step's text at the current tier via
  `resolveNarration` (INV-5) — screenshot-verified that toggling the dial from Detailed to Essentials
  collapses the same active step to its concise variant in place, with no re-anchoring and the engine
  untouched._
- [x] The 2–3 lessons play through; annotations fire on the correct events (INV-6). _Anchoring
  DONE (step 11): three authored lessons in `content/lessons/`, each anchored against the REAL
  single-cycle engine by `packages/web/src/lessons.test.ts` — every step fires on the correct event,
  in order, with tier-resolvable narration, and the headline payloads (55 / 120 / 42, the −4 load,
  ra) are pinned. Visible play-through DONE (step 11): the lesson narration panel drives
  `activeStepAt`/`narrationView` off the cursor, so scrubbing (or the Prev/Next-step controls) walks
  the anchored steps with the datapath/registers/source in lockstep — screenshot-verified in a real
  headless browser at "Step 3 of 5" of the sum-loop tour._
- [~] Editing the program mid-lesson forks into a sandbox; the sandbox run still animates.
  _Mechanism DONE (step 11): an editable-source panel forks on **Run edit** into a sandbox —
  `useSimulator.loadEdited` detaches any active lesson (`forkToSandbox`, spec §13) and records the
  edited program through the SAME recorder path the corpus programs use, so it animates by
  construction (the render path is the screenshot-verified step-7–9 datapath/panels). Proven
  headlessly against the REAL engine (`sandbox.test.ts`: fork detaches the lesson, the edited
  sum-loop records to its own result 15 and time-travels, an infinite-loop edit trips the teaching
  cap) and the detach as pure data (`session.test.ts`). NOT browser-verified: the interactive
  click-through (Run edit → chip flips to "Sandbox" → visible animation) was eyeballed only via the
  successful `vite build` + `tsc --noEmit` — a headless-Chrome `--screenshot` could not capture the
  live dev server in this environment (`--virtual-time-budget` never settles against Vite's HMR
  socket). Consistent with the step-7 "eyeball the React layer, no jsdom" precedent._
- [~] `engine` has zero imports from `web`/`curriculum`; the trace schema is the only shared
  type surface (INV-2, INV-3). _Mechanically enforced (ESLint import-boundary rule + tsconfig
  references, verified to fire). Re-confirmed against the **real** single-cycle engine (step
  4): it imports only `isa`/`assembler`/`trace`, communicates purely via `CycleTrace`, and is
  oblivious to depth tiers. Final box waits on the `web`/`curriculum` consumers existing._

## Decisions

- **Where does the differential test live? — RESOLVED (2026-06-30, step 6).** In
  **`engine/single-cycle`** (`differential.test.ts`), importing `run` from `engine/reference`.
  The reference never imports an engine (its diff path stays clean — that is exactly why
  `toProgramImage` is a free-standing function); the model-under-test owns its INV-8 test and
  imports the **reference, the root of trust**. This is the first **test-only** project
  reference: single-cycle's `tsconfig` `references` gained `../reference` (commented as
  test-only), while production single-cycle code still imports only isa/assembler/trace, so
  `npm run typecheck` (`tsc -b`) resolves the test import without inverting the DAG, and the
  ESLint engine-boundary rule (which only forbids `curriculum`/`web`) is satisfied. A dedicated
  conformance package was considered and **rejected as YAGNI**: M1 has one model, and the
  decisions log already defers the shared-harness extraction to when the **second** model lands
  (alongside hoisting `toProgramImage`). When that happens, lift the corpus enumeration + the
  equality/oracle helpers there so each model differentially tests against the reference.
- **Example-program corpus — RESOLVED (2026-06-30, step 6).** Five programs in
  `content/programs/`: `add.s` (seed) + `sum-loop`, `array-sum`, `call-return`, `byte-loads`.
  Chosen to be **integration-flavored** (loops, `.data` + load/store, call/return, the
  sign-extension trap) rather than re-covering the 40 base ops — step 4 already executes every
  op directly; the corpus exercises programs end-to-end. They use only the shipped pseudo set
  (no branch-swap `ble`/`bgt`, which aren't implemented yet) and end in `li a7,10; ecall` except
  `add.s`. Each is one corpus serving three jobs (§9): differential fixture, free-play library,
  and (later) lesson fixture.
- **Signed/unsigned register representation — RESOLVED (2026-06-21).** `Int32Array` is the
  canonical GPR representation (matches the §5 trace schema; `.slice()` is a cheap snapshot for
  the step-5 recorder). This is an _execution_ concern that lives in `engine/reference` and
  `single-cycle`, **not** in `isa` — the decoder/encoder stay representation-agnostic. The ~6
  unsigned-sensitive ops (`sltu`/`sltiu`, `srl`/`srli`, `bltu`/`bgeu`) read via centralized
  `asU32`/`asS32` helpers; normalize effective addresses with `>>> 0` at the memory interface.
  INV-8 differential testing is the backstop. _(Engine work; tracked for steps 3–4.)_
- **Halt / print convention — RESOLVED (2026-06-21).** `ecall` with the RARS exit convention
  (`a7=10`) is the canonical halt; `ecall`/`ebreak` are decoded now (base RV32I). Print is
  **deferred** — differential testing compares reg+mem, not stdout, so it's off the M1 critical
  path; when added it goes under the same `ecall` mechanism (output via a trace event / state
  field, per INV-3). Keep the syscall table frozen-tiny (§10). _(Engine work; steps 3–4.)_
- **Where do the `Processor` interface and driver/recorder live? — RESOLVED (2026-06-21, step 4):
  leaning (c).** `Processor`, `ProcessorConfig`, `ProcessorCapabilities`, and a pure
  `ProgramImage` now live in **`trace`** (`packages/trace/src/processor.ts`). `ProgramImage` =
  `{ words; data; entry; sourceMap }` — pure data, NO `assembler` type — so `trace` stays
  `isa`-only and the step-5 driver can wrap any `Processor` without inverting the DAG.
  Refinement over the original leaning: `sourceMap` is folded **into** `ProgramImage` so the
  **engine fills `InstructionInstance.sourceLine` itself** (the map is engine _input_, not a
  back-door accessor → INV-3 holds), which is cleaner than "driver enriches afterward" and
  needs no `engine-api` package (fallback (b) not taken). The `AssembledProgram → ProgramImage`
  adapter is `toProgramImage()`, a standalone free function exported from `engine/single-cycle`
  (it touches both `assembler` + `trace`; kept free-standing so the reference's step-6 diff
  path never imports an engine). When the second engine lands, hoist `toProgramImage` to a
  shared spot.
- **`SparseMemory` hoisted to `trace` — RESOLVED (2026-06-21, step 4).** The concrete
  byte-addressed `MemoryView` moved from `engine/reference` into `packages/trace/src/memory.ts`
  (it implements a `trace` type and has no other deps) and gained `snapshot()` (deep-copies the
  byte map). Both engines now construct it from `trace`, and the step-5 driver will use the same
  class to restore per-cycle memory snapshots. The reference's behavior is unchanged; its
  `SparseMemory` re-export was dropped (no external consumer — import from `@cpu-viz/trace`).
- **Reference memory model — RESOLVED (2026-06-21, step 3).** One **flat sparse byte-addressed
  memory** holds both the instruction words (loaded little-endian at `TEXT_BASE`) and `.data`;
  fetch, load, and store share a single path. Windowing this to a text/data/stack view is the
  **view's** job (INV-2/INV-3 — the engine emits full, expert-complete state), so the engine does
  **not** exclude text from memory and `definedAddresses()` legitimately reports text addresses; a
  consumer wanting only data filters by region. This is the simplest "obviously correct" model
  (§9). The single-cycle engine (step 4) should mirror it so the INV-8 memory comparison lines up.
- **Pseudo-instruction set & directive coverage — RESOLVED (2026-06-21, step 2).** Shipped the
  minimal corpus-driven set: pseudos `li`, `mv`, `nop`, `j`, `jr`, `ret`, `la`, `beqz`, `bnez`;
  directives `.text`, `.data`, `.word`, `.byte`, `.asciz` (+ `.string`/`.asciiz` aliases),
  `.globl` (+ `.global`). The `lui`+`addi` `+1` sign-correction is round-trip-tested across the
  signed-12 boundary and full 32-bit range. Branch-swap pseudos (`bgt`, `ble`, …) are not yet
  needed by the corpus — add when a program requires one (the syntax/expansion seams are in place).
- **Memory map — RESOLVED (2026-06-21, step 2); CROSS-PACKAGE CONTRACT (INV-7).** `.text`
  assembles upward from **`TEXT_BASE = 0x0000_0000`**, `.data` from **`DATA_BASE = 0x1000_0000`**
  (exported from `@cpu-viz/assembler`). **Execution entry is `TEXT_BASE`** (PC starts at the first
  word of `words`); `.globl _start` is parsed but does not yet pick an entry (M1 has no relocation
  of the entry point). Symbols are absolute addresses in this map; branch/jump offsets are
  `target − pc`; `la`/`li` of a data address need the full `lui`+`addi` because the bases are far
  apart (which is the pedagogical point). **The reference and single-cycle engines (steps 3–4)
  must load text/data at these bases and begin at `TEXT_BASE`** — when they consume a
  `ProgramImage` (decision (c) above), thread these constants through, don't re-pick them.
- **Section discipline & alignment — RESOLVED (2026-06-21, step 2).** Instructions are only legal
  in `.text` and data directives only in `.data` (each emits to a clean stream — `words` vs `data`
  — matching the `AssembledProgram` split; a data directive in `.text` is a located error). Data is
  emitted **contiguously with no auto-alignment** (there is no `.align` in scope, so a label always
  binds before the next byte with no padding ambiguity); a `.word` after an odd number of `.byte`s
  is intentionally unaligned. Revisit only if an engine needs aligned loads or `.align` lands.
