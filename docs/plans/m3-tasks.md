# Milestone 3 — the classic 5-stage pipeline (hazards, forwarding, stalls, flushes)

**Status: STEP 0 DONE, 2026-07-16 (440 → 452 tests); the pipeline model itself is not started.
Proven so far: that the seams M3 fills already exist (`ProcessorConfig.forwarding`,
`ProcessorCapabilities.configurableForwarding`, and the `forward`/`stall`/`flush`/
`branch-resolved` events are all declared in the schema today and honored by nobody), and — as of
step 0 — that the conformance harness can now see **both** toggle positions, its non-vacuity
mutation-checked rather than assumed.
**Step 1's decisions were reviewed and pinned 2026-07-16, before any code** — eleven stood as
seeded, the halt rule was rewritten (its seed was false about the corpus), and the missing
intra-cycle ordering decision was added; see the table. Deliberately deferred: configurable
branch prediction and caches (M4 — see the pinned decisions), and M2's step 5c next-PC rework,
which M3 does NOT depend on (see "What M3 does not inherit").**

Source of truth for scope: `cpu-visualizer-spec.md` §12 (roadmap). The load-bearing constraints
are the architectural invariants (§3) and the trace schema (§5). The repeatable per-step recipe
is `docs/templates/new-model-datapath.md`; the view surfaces are pre-designed in
`docs/plans/superscalar-visuals.md` (which assigns several of them to _this_ milestone).

## Why this milestone, and why now

The spec does not hedge about this tier: it is "_the_ high-value tier … A beautifully-done
version of _this tier alone_ is already a strong product" (§12.2). Everything before it was
plumbing that earns its keep here.

**What M1 and M2 did not exercise.** M1 (single-cycle) built the entire project apparatus and
deliberately had no microarchitecture — one instruction, one cycle, no hazards by construction.
M2 (multi-cycle) introduced varying cycle counts, phases, and inter-cycle latches, but kept the
defining simplification: **exactly one instruction is in flight at a time**. Every `CycleTrace`
M2 emits has `instructions.length === 1`.

M3 breaks that, and the break is the whole point:

- **Multiple instructions in flight simultaneously** — `instructions[]` now holds up to five
  entries with distinct `location`s (`IF`/`ID`/`EX`/`MEM`/`WB`) in a single cycle. This is the
  first milestone where the stable-id invariant (INV-4) and "follow this instruction" stop being
  a nice property of a one-at-a-time machine and become the only way to read the trace at all.
- **Instructions interact.** M1 and M2 had no notion of one instruction affecting another. The
  hazard is the first genuinely emergent behavior in the project.
- **Four schema events fire for the first time.** `forward`, `stall`, `flush`, and
  `branch-resolved` have been in `packages/trace/src/schema.ts` since M1, declared and unused,
  waiting for exactly this tier (§5 says so in a comment: "mostly fire from the pipeline tier
  onward").
- **Config changes behavior for the first time.** `ProcessorConfig.forwarding` and
  `ProcessorCapabilities.configurableForwarding` exist today and every model ignores them.
  M3 is the first model whose _trace_ depends on its _config_ — which is the flagship
  interaction the spec names across all tiers (§12): flip the toggle, watch the same program
  change behavior.

**What is cheap because it is shared** (the whole bet of the M1 architecture): ISA semantics are
mirrored verbatim from the golden reference; the transport, register/memory/source panels, scrub
bar, lessons, and sandbox-fork all animate a new model with no changes at all (INV-3); the
conformance harness and its corpus exist (step 0 extends it, does not rebuild it); the
`DatapathDiagram` renderer, `PhaseChips`, theme tokens, and the geometry-invariant test litmuses
all exist from the datapath overhaul.

**What is genuinely new machinery** (name it precisely, so the plan does not pretend this is
another M2): a hazard-detection unit; a forwarding network with a priority rule; control-flow
flush on a resolved branch; a pipeline register file with four latches; halt-with-drain semantics
(new, and a real correctness trap — see step 1); multi-instruction datapath activation (several
wires lit for _different_ instructions in one cycle, a first); and the pipeline map, a new view
surface.

### What M3 does not inherit

M2's deferred **step 5c** (make the multi-cycle next-PC path textbook-canonical by emitting
`alu-op`s for `jal`/`auipc`/`pc+4`) is **not a prerequisite for M3, and M3 does not reopen it.**
M2's datapath had to omit the ALUOut→PC redirect because the engine emits no event for PC
arithmetic, so drawing it would contradict the trace (INV-3/INV-5). The pipeline does not have
that problem: a taken branch emits **`branch-resolved` + `flush`**, which is a real, honest trace
signal the datapath can light the redirect from. M3 therefore draws its branch redirect without
needing 5c — see the pinned decision on extending `branch-resolved` with its `target`.

## Headline decision — the forwarding toggle is the milestone, and it ships in MVP

The one choice everything hangs off. The tempting scope lever is "build the pipeline first, add
the forwarding toggle later." **Reject it.** The spec's flagship experiment _is_ the toggle
(§12.2): "watch a RAW hazard stall without forwarding; turn forwarding on and watch the bubble
vanish." A pipeline that only runs in one config is not a smaller version of this milestone; it
is a different, much weaker one, and the toggle is not bolt-on — whether a hazard resolves by
forward or by stall is the core of the hazard unit, so building for one position and retrofitting
the other means rewriting the thing the model exists to demonstrate.

As always, **INV-8 is fidelity-agnostic** — it compares only final architectural state — so this
is a pedagogy call, not a correctness one. But note the sharp consequence, which the layered
options below are built around:

> **INV-8 cannot see timing at all.** A pipeline that _over_-stalls (say, one that ignores
> `forwarding: true` and interlocks on every RAW) produces **exactly the correct final state**
> and passes the differential suite **silently**. Conformance catches under-forwarding and
> under-stalling (you read a stale register, you get a wrong answer, you get caught); it is
> structurally blind to a model that is merely slow. The forwarding toggle's entire observable
> effect lives in the blind spot.

That is why the toggle cannot lean on conformance, and why **pinned cycle-accurate timing tests
are their own build step (step 3)**, not an acceptance line hanging off step 1. It is the single
easiest thing to under-plan in this milestone.

Layered options:

- **MVP (recommended, and what this plan builds): full data-hazard handling, toggle correct in
  both positions.** Forwarding on: EX/MEM→EX and MEM/WB→EX paths, plus the load-use stall that
  survives forwarding. Forwarding off: interlock in ID until the producer writes back. Control
  hazards: resolve in EX, fixed predict-not-taken, 2-cycle flush. Split I/D memory ports (no
  structural hazard).
- **Deferred to M4:** configurable branch prediction (`branchPrediction` stays honored-`false`,
  `configurableBranchPrediction: false`) and caches. Both are feature toggles _on_ this pipeline,
  per spec §12.3 — they need M3's pipeline to exist before they mean anything, and caches need
  array-walking programs to show anything at all.
- **Not in scope, not negotiable here:** anything out-of-order. The spec is explicit (§12.5): do
  not approach OoO until the in-order experience is completely nailed.

**The scope lever the reviewer signs off on** is not the toggle — it is where the _view_ work
stops. Steps 0–4 complete and fully prove the pipeline model headlessly with no browser work and
no new SVG. Step 5 is a shippable checkpoint on its own (M2 shipped exactly this as "5a"). Steps
6–8 are separable, in this order of value-per-effort: datapath, then map, then the lesson.

## Build order (each step testable before the next)

- [x] **0. Extend the conformance harness to a config matrix.** ✅ Done (2026-07-16, 440 → 452
      tests). `runConformance` grew an optional third parameter — a readonly `ProcessorConfig`
      list defaulting to `[defaultConfig()]` — and runs the corpus once per config. Both
      `differential.test.ts` files are byte-for-byte untouched (the default parameter is what buys
      that) and their suites read exactly as before: the config is named in the `it()` title **only
      when there is more than one**, since labelling a lone neutral config would imply a
      config-blind model cared about it. The per-(config, program) check was extracted out of the
      `it()` body into a throwing `checkProgram(makeProcessor, config, file)` — exported from the
      module but **not** from the package `index.ts`, so models still see only `runConformance` —
      and `runToHalt` now takes the config as a parameter instead of hardcoding `defaultConfig()`.
      Non-vacuity is proven in a new `conformance.test.ts` by a **reference-backed stub**: it
      delegates to the golden reference for its answer (so it is correct by construction) and then
      corrupts one register in a chosen `forwarding` position. Two claims needed proving, by
      different means, because neither implies the other. **First, the check is config-sensitive:**
      `checkProgram` on one stub `not.toThrow()`s under forwarding off and throws an
      `AssertionError` under forwarding on. The passing half is load-bearing, not decoration — it
      is what makes the failing half attributable to the perturbation rather than to an incidental
      error, since a bare `.toThrow()` is satisfied by any crash. That stub is also exactly what
      the pre-matrix harness was **structurally blind** to: it ran only `defaultConfig()`, whose
      `forwarding` is `false` — the position the stub is correct in — so it would have gone green.
      An `it()` pins that rather than leaving it as a comment's claim. **Second, `runConformance`
      hands each config in its list to the model:** proven through the public entry point by an
      **inverted** stub (correct only with forwarding _on_) driven over the whole corpus with
      `[FORWARDING_ON]`. The first claim alone would not catch a loop that iterated configs while
      passing `defaultConfig()` to every check — a matrix running the corpus N times in the same
      position, which is the exact vacuity this step exists to remove and which step 2's
      two-position suite would then pass silently.

      Both guards were **mutation-checked**, not merely observed green: deleting the perturbation
      fails the first claim's test, and reintroducing the pre-step-0 `defaultConfig()` hardcode
      fails all five corpus programs under the second. One more `it()` guards an empty `configs`
      list from skipping the corpus vacuously, mirroring the existing empty-fixture guard. The stub
      is program-agnostic — it rebuilds its input from the `ProgramImage` handed to `reset`, which
      is sound because the reference reads only `words`/`data` and never `symbols` — and that is
      what lets one stub serve both the single-program checks and the whole-corpus suite.

      _Original plan text:_ `runConformance(modelName, makeProcessor)` today calls `runToHalt`,
      which hardcodes `defaultConfig()` and documents
      itself as "config-agnostic on purpose: passes `defaultConfig` so any `Processor` — whatever
      knobs it honors — runs in its neutral mode." That was right for two config-blind models and
      is wrong the moment a model's behavior depends on config: it would prove the pipeline
      correct **only with forwarding off**. Give `runConformance` an optional config list
      (default `[defaultConfig()]`, so the single-cycle, multi-cycle, and reference suites keep
      passing untouched and unchanged); run the corpus once per config, with the config named in
      the `it()` title so a failure says which position broke. `runToHalt` takes the config as a
      parameter. Acceptance: existing suites green with zero edits to their `differential.test.ts`
      files; a deliberately-broken local stub fails under one config and passes under the other,
      proving the matrix is not vacuous.

- [ ] **1. `engine/pipeline` — the model MVP.** New workspace package `@cpu-viz/engine-pipeline`
      implementing `Processor`. Mirror ISA semantics **verbatim from the golden reference** (sign
      idioms, `imm & 0x1f`, `>>> 0` at the memory boundary) — the genuinely new code is only the
      sequencing. Wire the new node into the mechanical DAG in **all four places**:
      `eslint.config.js` boundary rules, root `tsconfig.json` project references,
      `vitest.config.ts` `workspaceAliases`, and the web `tsconfig` `paths`.

      The model's substance:
  - **Five stages, four latches.** `state.micro` carries `IF/ID`, `ID/EX`, `EX/MEM`, `MEM/WB` as
    an exported `PipelineMicro` type (the "fuller" shape, as M2 pinned for its latches — the
    view types against it). `location` is the plain stage name; every in-flight instruction
    keeps its **stable id** for its whole lifetime (INV-4). **Every instruction traverses all
    five stages** — explicitly _unlike_ M2's variable `phasesFor` (3–5 phases, opcode-dependent):
    a `sw` idles through WB and a `lui` idles through MEM rather than skipping them. That
    uniformity is what makes the latch chain a chain; do not reach for `phasesFor` here.
  - **Stages are processed in reverse each cycle** (WB→MEM→EX→ID→IF), so every stage reads the
    latch its upstream neighbour has not yet overwritten this cycle. Two things fall out of this
    that would otherwise need special cases: the same-cycle WB→ID rule below, and the **order of
    `events[]` within a cycle** — WB's `reg-write` precedes ID's `reg-read` in the same cycle's
    list. That ordering is a **trace-contract surface** (INV-3, and INV-6 anchors lessons to it),
    not an implementation detail. M1 and M2 never faced it — one instruction, one stage per
    cycle — so the pipeline is the first model where intra-cycle ordering exists at all.
  - **Hazard detection + forwarding**, per the pinned decisions below: EX/MEM→EX and MEM/WB→EX,
    EX/MEM wins a double match, never forward from/to `x0`, load-use stalls one cycle **even
    with forwarding on**. With `forwarding: false`, no forward paths exist and RAW resolves by
    interlocking in ID.
  - **Control hazard**: resolve in EX, fixed predict-not-taken; a taken branch emits
    `branch-resolved` + `flush` and kills the two younger instructions. **`jalr` resolves in EX
    too**, and its distinction is that a register supplies the **target address**, not merely the
    taken/not-taken decision — a RAW on control flow itself. `call-return.s`'s `ret`
    (= `jalr x0, 0(ra)`) is the instance. **Branches are RAW consumers as well** — they read
    rs1/rs2 to compare — and the corpus proves it: `sum-loop.s`'s `bnez t0, loop` reads the `t0`
    its _immediately preceding_ `addi t0, t0, -1` writes. That is a **distance-1 branch-operand
    RAW, ten times per run, in the hottest loop we ship**, and it is one of the first hazards
    step 3 will measure. Neither case is a special case: both resolve in EX, so the same
    EX-targeted forwarding paths and the same ID interlock cover them.
  - **Halt with drain — the correctness trap.** This is new, it is not cosmetic, and the corpus
    has **two** halt paths, not one. Verified against the corpus, not assumed:
    - **`ecall`** (`sum-loop.s`, `array-sum.s`, `byte-loads.s`, `call-return.s`). The reference
      halts _at_ it. Detected in ID, exactly **one** younger instruction exists (the one in IF)
      and must be squashed — the stages behind it hold _older_ instructions. The shadow is not
      "garbage after `.text`" either: in `call-return.s` the `ecall` at line 16 is followed by
      the real `max:` function (`bge`, `mv a0, a1`, `ret`) — live code that would genuinely
      execute. **The hazard the squash removes is a committed side effect, not a PC redirect.**
      Under the retire-pc rule below a shadow's redirect only ever moves the _microarchitectural_
      fetch pointer and can never reach `MachineState.pc`. What _can_ reach architectural state
      is a shadow **store**: one slot behind `ecall` it sits in MEM the same cycle `ecall` sits
      in WB, so whether it corrupts memory would come down to intra-cycle stage ordering. Squash
      at `ecall`-decode instead of resting architectural state on that accident. It also keeps
      spurious `forward`/`branch-resolved` events from squashed shadows out of the trace, which
      step 3's timing assertions read.
    - **pc-out-of-range** (`add.s` — which has **no `ecall` at all**; it just runs off the end
      of `.text`). The fetch pointer leaves `.text` while three instructions are still in
      flight, so "fetch left text" must **stop fetching, not halt**: halting there truncates the
      run and loses the in-flight results.

    Both fall out of **one** rule, which multi-cycle already implements (see the retire arm of
    `engine/multi-cycle/src/processor.ts`) and which the pipeline copies:

    > **Architectural `pc` is the retiring instruction's `nextPc` — never the fetch pointer.** On
    > retire: if the instruction is an architectural halt (`ecall`), set `halted` and leave `pc`
    > at that instruction's own pc; otherwise `pc = nextPc`, and halt if that lands outside
    > `.text`.

    The fetch pointer therefore stays **microarchitectural** and never surfaces in
    `MachineState.pc`. Fetching stops for two reasons — `ecall` decoded in ID, or the fetch
    pointer leaving `.text` — and either way the pipe drains and halts at the last retire.
    **This is not optional polish:** `expectEquivalent` asserts `model.pc === reference.pc` as a
    deliberate strengthening beyond the INV-8 minimum, and its own comment already names `add.s`
    as where a mismatch surfaces first.

  - It imports `isa`, `assembler` (via `engine-common`'s `toProgramImage`), and `trace` — and
    **nothing** from `web`/`curriculum`/another engine's production code (INV-2/INV-3; the eslint
    DAG enforces this, and if it blocks you, fix the design rather than working around it).

    Acceptance: hand-derived unit tests pin the model's **soul** — the phase/latch plan, each
    forwarding path, the priority rule, the load-use bubble, the flush — not the shared ISA
    arithmetic, which conformance covers. Typecheck + lint green (the DAG wiring is real).

- [ ] **2. Differential: INV-8 under forwarding on AND off.** One call:
      `runConformance('pipeline', () => new PipelineProcessor(), [forwardingOff, forwardingOn])`.
      Both positions must equal the golden reference's final register + memory state on **every**
      corpus program. This is the correctness net, and step 0 is what makes it able to see both
      positions. Acceptance: the full corpus passes twice, once per config; no new fixtures
      (INV-7 — one example library across all models).

- [ ] **3. Pinned timing tests — the net for INV-8's blind spot.** The headline decision explains
      why this is a step and not a footnote: conformance cannot see over-stalling. Author, by
      hand, the same way M2 pinned its per-class cycle-count table:
  - **A pinned cycle-count table** per corpus program × config. The load-bearing assertion is
    not the absolute numbers — it is that **forwarding on is strictly fewer cycles than
    forwarding off**, on a program with real RAW chains, with **identical final state**. That
    single test is the milestone's crown jewel expressed headlessly.
  - **Stall/flush placement**, not just counts: assert _which_ cycle and _which_ stage each
    `stall` names, and that a taken branch's `flush` names exactly the two younger stages. A
    model that stalls the right number of times in the wrong places is wrong.
  - **The load-use bubble survives forwarding on** — the one stall that does not vanish, and
    the pedagogical centerpiece. Assert it is present in _both_ configs.
  - **Forward events are exact**: `from`/`to`/`value` on each path, and the EX/MEM-wins
    assertion on a constructed double-match.

    Acceptance: the table is checked in and every entry is hand-derived (a number copied from
    a failing run is not a pin — it is a snapshot of a bug). Deliberately breaking the priority
    rule or dropping a forward path must fail **these** tests while conformance stays green;
    demonstrate that once, in a comment, so the next reader understands why this step exists.

- [ ] **4. Recorder / time-travel over the pipeline.** Free by construction (the recorder is
      model-agnostic), so this step is a **proof**, not a build: step forward to halt, step back
      to start, scrub to any cycle, state always matches the recording. The new thing worth
      proving: `follow()` an instruction id across **all five stages**, and — the payoff M1/M2
      could not show — that at a given cycle `follow()` resolves five _different_ ids to five
      _different_ locations. Acceptance: headless tests over a real pipeline recording; the
      "follow one instruction while four others are in flight" assertion is explicit.

- [ ] **5. Web: `models.ts` entry + the forwarding toggle control.** _(Shippable checkpoint on
      its own — M2 shipped the analogous "5a".)_ Add one `ModelChoice` (id from the engine's
      `MODEL_ID`, label, description, `make`, `datapath: 'none'` until step 6 lands, which
      renders the placeholder). The picker, transport, panels, scrub, lessons, and sandbox then
      animate the pipeline with **no further changes** (INV-3). The genuinely new UI is the
      **forwarding toggle**: a control gated on `capabilities.configurableForwarding` (so it
      simply does not appear for single-cycle/multi-cycle), which re-loads the current program
      under the new config and parks the cursor at pre-run — the same shape `setModel` already
      uses for the engine-factory ref. Acceptance: non-vacuous tests that the toggle is real
      (same program, both positions, **strictly different recorded cycle counts, identical final
      `a0`** — the crown jewel, now on the live timeline) and that lessons still anchor in order
      across a config swap (INV-6: events, not cycles). Browser-verified via the standing
      `vite preview` + raw-CDP ritual.

- [ ] **6. The pipeline datapath SVG.** A bespoke, hand-authored `datapath-pipeline.ts` +
      `PipelineDatapathView.tsx` in the established two-halves shape (geometry / pure `activate`),
      dispatched by a new `'pipeline'` arm on the `ModelChoice.datapath` discriminator. Lighting
      M2's diagram with a pipeline trace would paint a contradictory picture (INV-5), so this is
      its own geometry — never "reuse the closest diagram". What is new versus M1/M2:
  - **Activation is multi-instruction.** Every prior `activate` lit one instruction's path. This
    one lights five stages for five _different_ instructions in one cycle, so wires must carry
    _which_ instruction lit them (the follow-highlight and the stage tints both read that).
  - **Structural tiering finally has its best case**: the forwarding unit, the forwarding muxes,
    and the hazard-detection unit are genuinely optional structure — `minTier`'d to `expert`,
    with `maxTier`'d **contraction wires** standing in below. Each contraction must be the expert
    path with only the hidden unit collapsed (same source, same sink) — the INV-5 lawfulness
    condition, checked by test, exactly as `datapath-multi.ts` does it.
  - **The forwarding unit is absent when `forwarding: false`** — not dimmed, absent, with the
    contraction wire standing in. Structure now depends on **config** as well as tier, which is a
    first; it is lawful because the trace genuinely has no `forward` events in that config, so
    drawing an idle forwarding network would be the contradiction. (The view already holds the
    config — the user set it — so this is not an engine back door.)
  - **The branch redirect is drawn**, sourced from `branch-resolved` + `flush`. See the pinned
    decision on carrying `target` on that event.

    Acceptance: the two standing litmuses ported — **coherence** (every lit wire resolves to real
    geometry with both endpoints lit; no lit wire into a dim box) and **contraction lawfulness**
    — plus the geometry invariants the overhaul established (axis-aligned, on-perimeter, no
    collinear overlap), per-tier **and per-config** no-dangling, and a browser eyeball in light
    and dark via the `SNAP`-gated harness.

- [ ] **7. The pipeline map (stage × cycle grid).** The new view surface, already designed in
      `docs/plans/superscalar-visuals.md` §2 and assigned there to this milestone — **build it by
      reference to that plan, do not re-derive it**. HTML grid (not SVG): rows are instructions,
      columns are cycles, cells are phase-hued, stalls show as repeated cells and flushes as cut
      rows. Cells are click targets for follow. This is where "instructions overlap in time" stops
      being a claim about the trace and becomes the picture everyone recognizes. Renderer deltas
      1–4 from that plan (hue override, markers, legend, follow) land here, **stage-and-lane-
      parametric from day one** so later milestones widen them instead of rewriting them: the
      **stage set and its hue mapping are derived from the trace**, never a hard-coded 5-element
      list or 5-hue lookup. The map is the one M3 deliverable a future model reuses **as-is** —
      it is a pure fold over `location` (INV-3), so the row×column model absorbs both future
      axes without an API change: **lanes** (two rows share a column — superscalar) and **stage
      count** (a 7- or 12-stage pipeline just has more columns per row). Everything else in M3 is
      per-model by construction — each microarchitecture is its own package with its own `micro`
      type and its own bespoke geometry — so this is the only place the generality is worth
      buying. Acceptance:
      headless tests that the grid is derived purely from the trace (INV-3), that a stall repeats
      a cell and a flush cuts a row, and that the follow-highlight selects one id across all three
      surfaces (map, datapath, source panel).

- [ ] **8. The flagship lesson — "watch the bubble vanish."** The experiment the spec names, made
      guided: load a program with a real RAW chain, run with forwarding off, stop at the **first
      `stall` event**, explain the interlock; flip forwarding on, replay, watch the stall vanish —
      and then stop at the **load-use stall that does not vanish**, which is the point most
      courses fumble. Anchored to **trace events, not cycle numbers** (INV-6) — which is exactly
      what makes one lesson survive both configs. Acceptance: the lesson anchors in order with
      resolvable narration against recordings in **both** configs.

## Acceptance criteria (mirror the spec §11 shape, for the pipeline)

- [ ] Pipeline final register + memory state **equals** the golden reference for **every** corpus
      program, under **both** `forwarding: false` and `forwarding: true` (INV-8) — the same 5
      programs, no new fixtures (INV-7).
- [ ] **The crown jewel:** the _same program_ under forwarding off vs on produces **identical
      final architectural state** and **strictly different cycle counts**, visible on the live
      scrub bar — the spec's flagship interaction (§12), and the one thing conformance
      structurally cannot prove on its own.
- [ ] **The bubble that cannot be forwarded away:** the load-use hazard still stalls one cycle
      with forwarding **on**, and that stall is visible in the trace, the pipeline map, and the
      datapath.
- [ ] Load → step forward to completion → step **backward** to start → **scrub** to any cycle;
      shown state always matches the recorded trace.
- [ ] **Five instructions are in flight and individually followable** in a single cycle: five ids,
      five distinct `location`s, `follow()` tracking any one of them IF→ID→EX→MEM→WB across the
      recording with a stable id (INV-4) — the first tier where this is the only way to read the
      trace.
- [ ] A taken branch emits `branch-resolved` + `flush`, kills exactly two younger instructions,
      and the map shows the cut rows.
- [ ] Depth-tier switching changes datapath detail without changing engine behavior and without
      violating lawful simplification (INV-5) — including the forwarding/hazard units'
      `minTier` structural hiding and their **config-driven** absence, each backed by a lawful
      contraction.
- [ ] Editing the program mid-lesson **forks into a sandbox** (annotations detach) and the sandbox
      run still animates — free via INV-3, but assert it once on this model.
- [ ] `engine/pipeline` has **zero imports** from `web`/`curriculum` and from any other engine's
      production code; the trace schema is the only shared type surface (INV-2/INV-3, mechanically
      enforced).

## Decisions to pin (fill in as steps land — seeded with the recommended answers)

**Step 1's decisions were reviewed and pinned 2026-07-16**, before any code. Eleven stood as
seeded; the halt row was **rewritten** (its seed rested on a premise that is false about the
corpus), the branch row gained `jalr`, and one decision the table was missing entirely
(intra-cycle stage & event order) was added. Rows still `_(open)_` belong to later steps.

| Decision                           | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Pinned answer                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Forwarding toggle in MVP           | **Yes — both positions correct on day one.** It is the milestone's soul; retrofitting means rewriting the hazard unit. See the headline decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **Pinned as seeded**, 2026-07-16.                                                                                                                                                                                                                                                                                                          |
| Register-file same-cycle WB→ID     | **Write in the first half, read in the second** (textbook P&H). Directly decides when a forward is needed at all: a distance-3 RAW needs none.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Pinned as seeded.** Needs no special case — it falls out of the reverse stage order below.                                                                                                                                                                                                                                               |
| Forwarding paths                   | **EX/MEM→EX and MEM/WB→EX.** EX/MEM **wins** a double match (the younger producer is the right one). **Never** forward from or to `x0` (it is hardwired zero, not a value).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **Pinned as seeded.** Enumerated, deliberately — a general "any later latch → EX" rule is a future deeper pipeline's problem, and that is a different package.                                                                                                                                                                             |
| Load-use hazard                    | **Stalls one cycle even with forwarding on** — the data is not ready until MEM. The bubble that cannot be forwarded away; the pedagogical centerpiece.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **Pinned as seeded.**                                                                                                                                                                                                                                                                                                                      |
| RAW with forwarding **off**        | **Interlock in ID** until the producer's WB completes (combined with the same-cycle WB→ID rule above, that is a 2-cycle stall for a distance-1 RAW). Pin the exact number in step 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **Pinned as seeded.**                                                                                                                                                                                                                                                                                                                      |
| Branch resolution stage            | **EX** — a 2-cycle flush, no ID comparator, and more visually dramatic than resolving early. Emit `branch-resolved` + `flush`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Pinned as seeded, extended: `jalr` resolves in EX too** — a register supplies its _target address_, not just the taken/not-taken decision (`call-return.s`'s `ret`). Branches are RAW consumers too (`sum-loop.s`'s `bnez` reads the `t0` the preceding `addi` writes); both are covered by the same EX-targeted forwarding. See step 1. |
| Branch prediction                  | **Fixed predict-not-taken.** `branchPrediction` config stays honored-`false` / `configurableBranchPrediction: false` until **M4** (§12.3 makes it a toggle _on_ this pipeline).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **Pinned as seeded.**                                                                                                                                                                                                                                                                                                                      |
| `branch-resolved` carries `target` | **Extend the event with `target: number`.** The datapath needs the redirect's value to label it; INV-3 says extend the schema rather than open a back door. This is that, exactly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Pinned as seeded.** The event has no `target` field today — a real schema delta, not a no-op.                                                                                                                                                                                                                                            |
| Memory ports                       | **Split I/D** (Harvard, textbook P&H) — no structural hazard. Note this _diverges from M2's single shared memory_, which is why the pipeline gets its own geometry, not a reuse.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **Pinned as seeded.**                                                                                                                                                                                                                                                                                                                      |
| Halt semantics                     | **Architectural `pc` is the retiring instruction's `nextPc` — never the fetch pointer**, copying multi-cycle's retire arm. Fetching stops on `ecall`-in-ID _or_ the fetch pointer leaving `.text`; either way, drain and halt at the last retire, and squash the one younger instruction so no shadow **commits a MEM/WB side effect** (a redirect is harmless under this rule — it only moves the microarchitectural fetch pointer). _(The original seed — "stop fetching at `ecall` decode, drain, halt at its retire" — was **verified false about the corpus**: `add.s` has no `ecall` and halts by running off the end of text, an entirely unhandled second path.)_ | **Pinned as rewritten**, 2026-07-16 — see step 1 for the corpus evidence and why `expectEquivalent`'s `pc` assertion makes this load-bearing.                                                                                                                                                                                              |
| `micro` / `PipelineMicro` shape    | **Fuller** — all four latches (`IF/ID`, `ID/EX`, `EX/MEM`, `MEM/WB`) with their contents, exported for the view to type against. Same call M2 made for its five latches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **Pinned as seeded — concrete four latches, _not_ an N-latch abstraction.** A longer pipeline is a future **sibling package** with its own `micro` type and its own bespoke geometry, so nothing here needs to generalize; only the step-7 map is shared, and it folds over `location`, not `micro`.                                       |
| `location` encoding                | **Plain stage strings** (`"IF"`/`"ID"`/`"EX"`/`"MEM"`/`"WB"`). Superscalar later extends to `"EX.0"`/`"EX.1"` (`superscalar-visuals.md`) — keeping it a plain string is what allows that.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Pinned as seeded.** A plain string already absorbs **both** future axes with no schema change: lanes (`"EX.0"`) and deeper stage sets (`"EX1"`/`"EX2"`).                                                                                                                                                                                 |
| Intra-cycle stage & event order    | **Process stages in reverse each cycle** (WB→MEM→EX→ID→IF), so each stage reads the latch its upstream neighbour has not yet overwritten. This fixes the **order of `events[]` within a cycle** — a trace-contract surface (INV-3/INV-6), not an implementation detail.                                                                                                                                                                                                                                                                                                                                                                                                   | **Pinned**, 2026-07-16 — added in review; the table was missing it entirely. M1/M2 never faced it (one instruction, one stage per cycle), so M3 is the first model where intra-cycle ordering exists.                                                                                                                                      |
| Corpus additions                   | **None needed — verified, not assumed.** `array-sum.s` already holds the textbook load-use pair (`lw t2, 0(t0)` then `add a0, a0, t2`); every program has back-to-back RAW chains and taken branches. INV-7 stays intact.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | _(open)_                                                                                                                                                                                                                                                                                                                                   |
| Datapath tiering lever             | **Structure** — `minTier` the forwarding unit, forwarding muxes, and hazard unit to `expert`, with lawful contraction wires below; plus config-driven absence when forwarding is off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | _(open)_                                                                                                                                                                                                                                                                                                                                   |
| Pipeline map tech                  | **HTML grid, not SVG** — scrollable, cells are follow click-targets (seeded and reasoned in `superscalar-visuals.md`; M3 is where it is pinned for real).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | _(open)_                                                                                                                                                                                                                                                                                                                                   |
| Follow-highlight visual            | **Dashed `--ink` outline ring** — hue-free, so it composes with stage tint and survives CVD (from `superscalar-visuals.md`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | _(open)_                                                                                                                                                                                                                                                                                                                                   |
| M2 step 5c dependency              | **None — M3 neither needs nor reopens it.** The pipeline's redirect is sourced from `branch-resolved` + `flush`, which are honest trace signals; M2's problem does not recur here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | _(open)_                                                                                                                                                                                                                                                                                                                                   |
