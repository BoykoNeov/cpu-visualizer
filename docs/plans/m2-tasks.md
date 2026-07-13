# Milestone 2 — the multi-cycle model (second microarchitecture)

**Status: PLAN — not started.** This is a decisions document for review, drafted in the same
house style as `m1-tasks.md` (testable-before-next steps + a decisions log + acceptance
criteria mirroring the spec). Nothing here is built yet; the two crux decisions reviewers
should weigh in on are **the multi-cycle fidelity decomposition (§ Headline decision)** and
**the datapath-view scope staging (step 5)**.

Source of truth for scope: `cpu-visualizer-spec.md` §12 (roadmap beyond M1). The load-bearing
constraints remain the architectural invariants (§3) and the trace schema (§5).

## Why this milestone, and why this model first

M1 proved the whole stack end-to-end on the single-cycle model — but it proved it on a model
with **exactly one instruction in flight, one location, one cycle per instruction**. Everything
that makes the *family* interesting (an instruction with a lifetime that spans cycles, a
`location` that advances, per-model `micro` state, varying cycle counts) is unexercised. The
spec's roadmap (§12) is: multi-cycle → 5-stage pipeline (the flagship) → caches/prediction →
superscalar → out-of-order.

**Why not jump straight to the pipeline (the flagship tier)?** The pipeline is where the payoff
is — hazards, forwarding, stalls, flushes — but it stacks *two* new hard things at once:
(a) an instruction whose lifetime spans multiple cycles and multiple locations (the INV-4
"follow this instruction" plumbing, `micro` latches, `location` progression), and (b) hazard
detection between *concurrent* in-flight instructions. Multi-cycle isolates (a) with **still one
instruction in flight at a time** — no hazards by construction, exactly as single-cycle had no
hazards by construction. It is the cheapest possible exercise of the cross-cycle-lifetime
machinery the pipeline needs anyway, *before* the concurrency of hazards piles on top. It also
forces the two "second model lands" refactors the M1 decisions log deferred (below), which the
pipeline would need regardless. So multi-cycle is both a real pedagogical tier (§12.1) and a
de-risking step for the flagship.

**Why it's cheap:** the ISA semantics (ALU ops, sign handling, the `s`/`u` idioms, `imm & 0x1f`,
`>>> 0` at the memory boundary) are identical in every model and are mirrored verbatim from the
golden reference — exactly as single-cycle did (`processor.ts` header). The only genuinely new
code is the **per-cycle sequencing state machine**: instead of doing fetch→…→writeback in one
`step()`, spread those phases across several `step()` calls, advancing `location` and parking
intermediate values in `micro` between cycles.

## Headline decision — how faithful is "multi-cycle"?

This is the model's soul; everything else hangs off it. **Because the trace/INV-8 net checks
only *final architectural state*, any fidelity choice passes INV-8 identically** — a correct
program's registers + memory are model-invariant (spec §9). So this choice is purely about
**pedagogy and the datapath view**, not correctness. It decomposes cleanly into two layers:

- **MVP (the plan's core — recommended):** per-instruction-**class** phase sequences that yield
  **varying cycle counts**, plus `location` progression (`IF`→`ID`→`EX`→`MEM`→`WB`) and `micro`
  latches carried between cycles. Concretely: an R-type takes fewer cycles than a load because
  it **skips the MEM phase**; a store/branch **skips WB**. This is exactly the §12.1 headline
  ("instructions take varying numbers of cycles; still in-order, still one at a time") and it
  delivers the first real multi-cycle INV-4 journey (one instruction visibly walking IF→WB
  across the timeline). The reused ISA idioms mean the arithmetic is *not* re-derived.

- **Full P&H structural fidelity (deferred / optional later phase):** explicitly modeling the
  **shared functional units** — one ALU reused across cycles (PC+4 in one cycle, branch-target
  or the real op in another) and a **single memory port** shared by fetch and load/store. This
  is the deeper textbook lesson ("why does `lw` take 5 cycles? because the ALU and memory are
  time-shared"), but it is **mostly a datapath-view concern**, not a model-core concern — the
  *final state* is unaffected and even the cycle counts can match without literally sharing a JS
  ALU object. Stage it as a later view-side phase (step 5+), not the model core, so the model
  lands and is headlessly provable before the larger SVG work.

Recommendation: **build the MVP as steps 0–4; treat structural-fidelity + datapath as steps 5+
and an explicit scope lever the reviewer signs off on.**

## Build order (each step testable before the next)

Steps 0 and 1 are the two refactors the M1 decisions log explicitly deferred to "when the second
model lands" — they are prerequisites and pay for themselves immediately by shrinking both
engines' tests. Steps 2–4 are the model MVP. Steps 5–6 are the view + browser, staged behind an
explicit scope decision.

- [ ] **0. Extract `toProgramImage` → `@cpu-viz/engine-common`.** Today `toProgramImage` +
      `SINGLE_CYCLE_CAPABILITIES`'s sibling — the `AssembledProgram → ProgramImage` adapter —
      lives in `engine/single-cycle` as a free function (M1 decision: "when the second engine
      lands, hoist `toProgramImage` to a shared spot"). Create a new leaf package
      `packages/engine/common` (`@cpu-viz/engine-common`) depending only on `assembler` + `trace`,
      move `toProgramImage` there, and have **both** engines import it. The reference does **not**
      need it (its diff path never touches the assembler — that's why the adapter was free-standing
      in the first place). Update `eslint.config.js` boundary rules + `tsconfig.json` project
      references + the `web` `tsconfig` paths/Vite aliases to include the new package. Acceptance:
      `npm run typecheck`/`lint`/`test` green; single-cycle's `differential.test.ts` imports
      `toProgramImage` from `@cpu-viz/engine-common`; the DAG (§"Architecture") gains one node,
      `engine-common ← isa, assembler, trace`.

- [ ] **1. Extract the differential harness → test-only `@cpu-viz/engine-conformance`.** The M1
      decisions log (step-6 "Where does the differential test live?") deferred a dedicated
      conformance package as YAGNI "until the second model lands." It has landed. Create
      `packages/engine/conformance` (test-only) depending on `assembler` + `trace` +
      `engine-reference`, and move into it: the corpus enumeration (glob `content/programs/*.s`
      from disk + the empty-corpus discovery guard), `expectEquivalent` (registers + memory-union +
      `pc`/`halted`), and `RESULT_ORACLES` (the hand-computed headline results — **these are
      model-independent corpus facts**, e.g. sum-loop→55, so they belong here, not in a model's
      test). The harness is **parameterized over a `() => Processor` factory** so it imports
      *neither* engine-under-test (no dependency cycle — same reason the reference's diff path
      stays clean). Both engines' `differential.test.ts` then shrink to: import the harness + the
      local processor, call `runConformance(() => new XProcessor())`. This extends single-cycle's
      existing **test-only project-reference-to-reference** precedent (its tsconfig already
      references `../reference` test-only). Acceptance: single-cycle's differential suite passes
      unchanged in behavior through the extracted harness; `npm run typecheck`/`lint`/`test` green.

- [ ] **2. `engine/multi-cycle` — the model MVP.** New package `packages/engine/multi-cycle`
      (`@cpu-viz/engine-multi-cycle`) implementing `Processor`, importing `isa`/`assembler`
      (via `engine-common`)/`trace` — and **nothing from `web`/`curriculum`/another engine's
      production code** (INV-2/INV-3, mechanically enforced). Each `step()` advances the single
      in-flight instruction by **one phase**, emitting a `CycleTrace` whose `instructions[0].location`
      is the current phase (`IF`/`ID`/`EX`/`MEM`/`WB`) and whose `state.micro` carries the
      inter-cycle latches (see decision "micro shape"). The instruction's **`id` is stable for its
      whole IF→WB lifetime** (INV-4) — a fresh id per *dynamic* execution (so a looped instruction
      gets a new id each iteration, as single-cycle does), but the *same* id across the several
      cycles of one execution (unlike single-cycle, where lifetime = one cycle). Events fire in the
      phase they belong to: `instr-fetch` at IF, `reg-read`s at ID, `alu-op` at EX, `mem-*` at MEM,
      `reg-write` at WB, `instr-retire` at the last phase. **Cycle counts vary by class** per the
      table in the decisions log. Halt timing reaches the **same final `pc`/`halted`** as the
      reference — just after more cycles (the last instruction still doesn't advance `pc` on halt;
      off-text-end still folds into the final state). Arithmetic/sign idioms mirrored verbatim from
      the reference (do **not** import the reference at runtime — copy the idioms, as single-cycle
      documents). Unit tests (hand-computed oracles, this engine's own `processor.test.ts`): pin the
      **phase/cycle-count per class** (a load spans 5 cycles IF→WB, an R-type 4 skipping MEM, a
      store 4 skipping WB, a branch 3), the `location` progression, `micro` latch contents at each
      phase, id-stability-across-cycles for one instruction + id-freshness across a loop, and the
      classic sign traps (at least one per unsigned-sensitive op, as single-cycle did). Reuse the
      step-6 methodology: hand oracles here, the differential net (step 3) is the safety cross-check.

- [ ] **3. Differential test multi-cycle ≡ reference (INV-8).** A three-line
      `packages/engine/multi-cycle/src/differential.test.ts` that calls the extracted harness
      (step 1) with `() => new MultiCycleProcessor()`. Asserts the same final-state equivalence
      over the same 5-program corpus (INV-7 — **no new programs**; the corpus is model-invariant).
      This is where "varying cycle counts, identical final state" is *proven*, not asserted.
      Acceptance: every corpus program's final reg+mem+pc+halted equals the reference's; the
      headline oracles (55/120/42/−4/ra) hold; a runaway cap turns an authoring bug into a failure.

- [ ] **4. Time-travel over multi-cycle (recorder integration).** The `TraceRecorder` is
      **model-agnostic** — multi-cycle just emits *more* `CycleTrace`s per instruction, so the
      recorder needs **zero change**. Add a `trace`↔real-multi-cycle **integration** test (mirroring
      single-cycle's step-5 recorder test): load → run to end → step back to start → scrub to any
      cycle, with each cycle's snapshot matching; and the first real INV-4 payoff — **`follow(id)`
      on one instruction returns its `location` at each of its several in-flight cycles** (IF→ID→
      EX→MEM→WB), the "follow this instruction across its journey" feature the spec (§6) promised
      and single-cycle could only trivially exercise (one sighting). Acceptance: recorder reaches
      the same final state as a hand-driven run; a followed instruction's location sequence is the
      expected phase walk.

  > **After step 4 the multi-cycle MODEL is complete and fully proven headlessly** (differential
  > + recorder), with **no browser work and no new SVG**. Steps 5–6 make it *visible* and are the
  > explicit scope lever below.

- [ ] **5. Web: model picker + multi-cycle datapath view.** *(Scope decision — see the "Web scope
      lever" decision. Can ship in two sub-steps or be deferred to its own milestone.)*
  - [ ] **5a. Model picker.** `useSimulator` today hard-wires `SingleCycleProcessor`. Add a model
        selector (single-cycle | multi-cycle) that swaps the `Processor` the recorder wraps; the
        transport, register/memory/source panels, scrub slider, lessons, and sandbox-fork all work
        **unchanged** because they read the trace, not the engine (INV-3). At this sub-step,
        multi-cycle is drivable in-browser with the *existing* panels (registers/memory/source
        animate per cycle) even before its bespoke datapath exists — proving the model end-to-end
        in the UI cheaply. The single-cycle datapath view is shown only for the single-cycle model
        (its geometry is single-cycle-specific).
  - [ ] **5b. Multi-cycle datapath SVG.** A **separate, larger** hand-authored datapath (the
        canonical multi-cycle datapath: shared ALU, single memory, the IR/A/B/ALUOut/MDR latches
        drawn as boxes) wired to the trace, with the same pure-model/SVG-view split as M1's
        `datapath.ts`/`DatapathView.tsx`. **This is where the deferred `minTier` structural-hiding
        mechanism finally earns its keep** (M1 step 9 kept it wired-but-unused for exactly this):
        the multi-cycle datapath *does* have units that aren't on every instruction's path, so
        lower tiers can lawfully hide them (unlike single-cycle, where hiding any box left a
        dangling lit wire). The within-cycle phase stepper M1 built is now **within-cycle *and*
        across-cycles** — one `location` per cycle. Depth tiers (essentials/detailed/expert) apply
        as in M1. Optionally, this is also where the **full structural-fidelity** layer (shared ALU
        reuse across cycles) becomes a visible lesson.

## Acceptance criteria (mirror the spec §11 shape, for multi-cycle)

- [ ] Multi-cycle final register + memory state **equals** the golden reference for **every**
      corpus program (INV-8) — proven by the extracted conformance harness (step 3), same 5
      programs, no new fixtures.
- [ ] Load → step forward to completion → step **backward** to start → **scrub** to any cycle;
      shown state always matches the recorded trace (free via the model-agnostic recorder; proven
      headlessly step 4, and in-browser once step 5a lands).
- [ ] A single instruction is **followable across its multi-cycle lifetime** (IF→ID→EX→MEM→WB),
      its `location` advancing one phase per cycle with a **stable id** (INV-4) — the first real
      "follow this instruction" payoff (step 4).
- [ ] Instructions of different classes take **different numbers of cycles** (load > R-type >
      branch), visible in the trace and (step 5) the timeline — the §12.1 headline.
- [ ] Depth-tier switching changes datapath detail without changing engine behavior and without
      violating lawful simplification (INV-5) — **including** lawful *structural* hiding on the
      multi-cycle datapath (step 5b), the first place `minTier` box-hiding is lawful.
- [ ] `engine/multi-cycle` has **zero imports** from `web`/`curriculum` and from any other engine's
      production code; the trace schema is the only shared type surface (INV-2/INV-3, mechanically
      enforced by the eslint boundary rule + tsconfig references).

## Decisions to pin (fill in as steps land — seeded with the recommended answers)

- **Multi-cycle fidelity — RECOMMENDED: MVP now, structural fidelity later.** See "Headline
  decision." INV-8 is fidelity-agnostic, so this is a pedagogy/view call, not a correctness one.
  The MVP (varying cycle counts via per-class phase-skipping + `location` + `micro`) is the model
  core (steps 2–4); the shared-ALU/single-port structural layer is a datapath-view concern staged
  to step 5b.

- **`micro` / `ModelSpecificState` shape — PROPOSED.** `MachineState.micro` is typed `unknown` in
  the schema (the per-model extension point, §5). Multi-cycle's `micro` carries the inter-cycle
  latches. **Minimum:** the instruction register `IR` (the fetched word, so ID/EX can decode
  without re-fetching) and the current phase. **Fuller (recommended for the datapath lesson):** the
  classic P&H latches `A`, `B` (the two register-read operands), `ALUOut` (the EX result held for
  MEM/WB), and `MDR` (memory data register, the load result held for WB). Decide minimum vs fuller
  when step 2's tests are written; fuller costs little and makes step 5b's boxes real. Whatever the
  shape, it must be an **independent per-cycle snapshot** (same requirement as registers/memory —
  the recorder keeps every cycle; a live-aliased `micro` would show latest-values-everywhere).

- **`location` set — PROPOSED `IF`/`ID`/`EX`/`MEM`/`WB`.** The single in-flight instance's
  `location` string advances one phase per cycle. A class that skips a phase (R-type skips `MEM`;
  store/branch skip `WB`) simply doesn't visit that location. `instr-retire` fires at the last
  phase the instruction visits.

- **Per-class cycle-count table — PROPOSED (canonical P&H), edges TBD-at-build.** Load = 5
  (IF/ID/EX/MEM/WB), R-type = 4 (skip MEM), store = 4 (skip WB), branch = 3 (IF/ID/EX; resolves +
  redirects pc in EX, no MEM/WB). **`jal`/`jalr`/`lui`/`auipc` are deliberately NOT hard-committed
  here** — verify each against the reference's behavior at build time (e.g. does `jal` need an EX
  cycle for the target add? `lui` needs no reg-read/ALU — echo M1's datapath finding that `lui`/
  `jal`/`auipc` emit no reg-read/alu-op). Pin them in this log once step 2's tests confirm the
  emitted phases match the reference's semantics. INV-8 doesn't care about the counts; the *tests*
  pin them so they can't silently drift.

- **`PhasedEvent` ordinal — CONFIRM STILL DEFERRED.** M1 deferred the §5 `PhasedEvent` phase
  ordinal (event *order* already encodes fetch→…→writeback). In multi-cycle the **cycle number
  itself** now separates the phases (each phase is a distinct cycle), so the ordinal is *even less*
  needed than in single-cycle. Confirm the deferral holds at step 2 rather than reviving it; add it
  only if the step-5b animation genuinely consumes it.

- **Web scope lever — PROPOSED: model + differential + existing-panels first (steps 0–5a), bespoke
  datapath second (step 5b).** The model is fully provable headlessly (steps 2–4) with **no** web
  change. The model picker (5a) is a small `useSimulator` change that lights multi-cycle up in the
  *existing* panels. The multi-cycle **datapath SVG** (5b) is a separate, larger diagram and the
  natural place to split the milestone if scope needs trimming — the reviewer should decide whether
  5b is in M2 or its own follow-up. Everything through 5a is in-scope-cheap; 5b is the big view
  investment.

- **What reuses UNCHANGED (kept honest).** The `TraceRecorder`/time-travel (model-agnostic —
  multi-cycle just emits more cycles); the 5-program corpus (INV-7 — no new programs); `isa` and
  `assembler` (untouched); the single-cycle engine (untouched — this is a *new* model beside it,
  not a rewrite); the lesson runner + narration panel + sandbox-fork (all trace-driven, work over
  any model). The M1 architecture bought all of this — that reuse is the whole point (§12).
