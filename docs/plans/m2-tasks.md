# Milestone 2 — the multi-cycle model (second microarchitecture)

**Status: M2 COMPLETE — steps 0–4 (model), 5a (model picker), 5b (datapath SVG), 5c
(the next-PC redirect), 5d (the taken-branch redirect) and 5e (the PCSource mux) all shipped.
5e landed 2026-07-20 and closed the last stated omission; the milestone has no deferred work
and no stated omissions left.**

**Step 5e (2026-07-20) — the PCSource mux, and the driver nobody had noticed was missing.**
5c and 5d each landed a redirect into PC and each left the same note in the header: PC has three
drivers with no selector drawn between them. Going to draw that selector surfaced the real gap —
**the diagram was one driver short of being able to draw it.** The SEQUENTIAL next-PC had no wire
at all: `pcarith` fed only the writeback mux (the `jal`/`jalr` link), so the ordinary
"PC ← PC+4" that every instruction performs was invisible. The stated omission was therefore
understating itself; a 2-input mux would have been the same lie in a smaller box, and a selector
whose commonest input never lights is worse than no selector.

So 5e closed the sequential loop (`pc → pcarith → pc`) and added `pcsource` with all three arms.
**View-only, like 5d** — the value is the trace's own committed `state.pc`, never read out of the
engine, so INV-8 is untouched by construction. The lighting rule is 5d's, generalized once more:
the sequential arm lights **at retire** for any instruction that neither jumps, takes a branch,
nor halts — which is WB for most, **MEM for a store, EX for a not-taken branch** (and never for a
halting `ecall`; see the defect below, which is what forced the "nor halts" clause).

**The layout cost the plan had not predicted:** the mux could not go where the textbook puts it.
PC sits 28px from the canvas edge and a mux takes its inputs on its left _vertical_ edge, so a
directly-left placement leaves no room for three separated feed rails — and the collinearity test
(0.5px epsilon) is this diagram's binding constraint, exactly as in 5d. It went **below-left** of
PC instead, the one place all three sources reach a left edge on well-separated rails
(`pcarith` x=82, `aluout` x=70, `branchadd` x=14). The three `essentials` contractions land on
three different PC edges so they never merge into one line.

**One test had to be re-expressed, not suppressed.** `auipc` asserted `pcarith` was dark — a
5c-era proxy for "auipc's writeback comes from ALUOut, not the incrementer". With 5e that fails,
and correctly: auipc's next PC genuinely _is_ pc+4, so the incrementer IS lit. The assertion now
names the writeback path (`pcarith-wbmux`). Special-casing auipc out of the sequential rule would
have been the lie sneaking back in.

**Browser-verified** on `call-return` and `sum-loop`, all three arms plus both tiers: the `addi`
WB lights `pc → pcarith → pcsource → pc` with `0x0 → 0x4` (the first time the diagram has ever
shown PC+4); the `jal` WB lights the link out through MemtoReg _and_ the target `0x18` through
PCSource while the sequential arm stays dark; the taken `bne` at cycle 18 lights the branch adder
arm to `0x08`; fetch cycles leave the mux dark; and `essentials` collapses all five muxes, giving
PC three distinct, visually separate incoming arrows.

**The one real defect in 5e was found by neither the tests nor the browser, but by noticing an
unverified claim.** The first cut keyed the sequential arm off `instr-retire` alone. But the engine
pushes `instr-retire` **unconditionally** at an instruction's last phase, and on an architectural
halt (`ecall`/`ebreak`/an unknown word) it then deliberately leaves `pc` parked
(`processor.ts` — `if (cur.plan.halt) { this.halted = true } else { this.pc = cur.plan.nextPc }`).
So a halting `ecall` would have lit `PC ← pc+4` while the trace said PC never moved — the view
**contradicting** the engine, which is precisely what INV-5 forbids, not the lawful omission it
looks like. Worse, the header comment had _rationalized_ it ("the machine stops for reasons outside
this diagram") — a wrong picture with a justification attached.

It surfaced because the header asserted ecall behaviour that had never actually been observed: the
only ecall cycle looked at in the browser was its **fetch** (mux dark), one cycle before the retire.
The fix keys the arm off the trace's **committed `state.pc`** instead of a computed `pc + 4` —
strictly better, because it is the real next PC rather than a guess that happens to be right for
every non-halting case. `fence` falls through and correctly lights; `ecall` does not and correctly
stays dark. Pinned by test, then watched at cycle 123 (`— halted ecall`): the whole next-PC path
is dark. 1358 tests green.

**Rule this earns: if a header comment asserts behaviour for a case, that case must have been
observed — a claim with a rationalization attached is the shape a bug hides in.**

**Step 5d (2026-07-20) — the taken-branch redirect, view-only.** The mirror image of 5c: where 5c
had to change the ENGINE before the view could tell the truth, 5d needed no engine change at all,
because the trace already carried everything. A branch's target is `pc+imm` and the shared ALU
holds the compare result (`taken?1:0`), so `aluout→pc` physically cannot carry it — the fix was
the second adder real hardware has. Added `branchadd` (`pc + imm`, from PC and the sign-extender),
returning to PC along the free `y=32` rail and the empty `x=14` left margin, deliberately the
opposite side of PC from the jumps' bottom rail so the two redirects read as two sources rather
than one wire. It lights at **EX** — a branch's retire phase — which generalizes the rule to
_"the next-PC wire lights at retire"_: WB for the jumps (they write a link), EX for a branch (its
last phase). Taken-ness is **read from the trace**, not recomputed: the compare's own `alu-op`
result IS the condition. The target is derived from two trace fields (`inst.pc`, `decoded.imm`) —
lawful under INV-3, which forbids reading engine internals, not deriving from trace values.
Drawn at **every tier**: it is dataflow, not a selector, so it needs no contraction machinery —
the one structural asymmetry with 5c's mux. **Browser-verified** on `sum-loop`: the taken `bne` at
cycle 18 lights PC → branch adder → PC with `0x10 + (-8) = 0x08`, while `aluout→pc` stays dark;
the loop-exit `bne` at cycle 117 lights the compare and nothing else. 1354 tests green; the engine
was not touched, so INV-8 is untouched by construction.

**Cost this step charged that the plan had not predicted: none** — 5c's surprise was the 4th mux;
5d's geometry fit the existing canvas with no new node type, no tier machinery, and no
re-layout. The one thing that took real work was routing: the collinearity test (0.5px epsilon)
is the binding constraint on this diagram, and the two free rails (`y=32`, `x=14`) were the
only clean way in and out of a PC box whose top and bottom edges were already fully spoken for.

**Step 5c (2026-07-20) — the next-PC redirect, engine-first.** The redirect could not be drawn
while the engine computed PC-relative values directly and emitted no `alu-op` for them, so 5c
changed the engine and let the view follow the trace: `jal`/`auipc` now compute `pc+imm` in the
shared ALU and gain an EX phase (3 cycles → 4), while `pc+4` stays on a dedicated incrementer.
The view then drew the `aluout→pc` redirect for `jal`/`jalr` — which **forced a 4th mux**
(ALUSrcA), the one cost this step charged that its own plan had not predicted (recorded in the
cycle-table decision below). `lui` is now the only class that skips EX. **Browser-verified** on
`call-return`: the jal's WB lights the link (`pcarith→wbmux→regfile`) and the redirect
(`aluout→pc`) simultaneously, and `ret` (`jalr x0`) lights the redirect as its ONLY wire —
a phase that drew nothing at all before 5c. Essentials still collapses all four muxes to their
contractions. 1352 tests green; INV-8 untouched by construction.

**Step 5b's browser verification, outstanding since 2026-07-13, is now also discharged** — 5c's
session drove the real multi-cycle datapath and found no layout defect. That makes 5c only the
second view step in this project to survive the browser clean.
The multi-cycle model is implemented and fully proven headlessly — the INV-8 differential net
(multi-cycle ≡ golden reference on every corpus program) and the recorder time-travel /
`follow()` phase-walk both pass, alongside 38 hand-derived unit tests pinning the model's soul
(phase plan, event→phase mapping, `micro` latches, INV-4 id lifetime, the sign traps). No
browser change yet. The remaining decision is **whether step 5b (the bespoke multi-cycle
datapath SVG) is in M2 or a follow-up** — step 5a (model picker) lights the model up in the
existing panels cheaply. Drafted in `m1-tasks.md`'s house style; the fidelity decomposition
(§ Headline decision) is settled as the recommended **MVP** and its per-class table is now
pinned (see Decisions).

Source of truth for scope: `cpu-visualizer-spec.md` §12 (roadmap beyond M1). The load-bearing
constraints remain the architectural invariants (§3) and the trace schema (§5).

## Why this milestone, and why this model first

M1 proved the whole stack end-to-end on the single-cycle model — but it proved it on a model
with **exactly one instruction in flight, one location, one cycle per instruction**. Everything
that makes the _family_ interesting (an instruction with a lifetime that spans cycles, a
`location` that advances, per-model `micro` state, varying cycle counts) is unexercised. The
spec's roadmap (§12) is: multi-cycle → 5-stage pipeline (the flagship) → caches/prediction →
superscalar → out-of-order.

**Why not jump straight to the pipeline (the flagship tier)?** The pipeline is where the payoff
is — hazards, forwarding, stalls, flushes — but it stacks _two_ new hard things at once:
(a) an instruction whose lifetime spans multiple cycles and multiple locations (the INV-4
"follow this instruction" plumbing, `micro` latches, `location` progression), and (b) hazard
detection between _concurrent_ in-flight instructions. Multi-cycle isolates (a) with **still one
instruction in flight at a time** — no hazards by construction, exactly as single-cycle had no
hazards by construction. It is the cheapest possible exercise of the cross-cycle-lifetime
machinery the pipeline needs anyway, _before_ the concurrency of hazards piles on top. It also
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
only _final architectural state_, any fidelity choice passes INV-8 identically** — a correct
program's registers + memory are model-invariant (spec §9). So this choice is purely about
**pedagogy and the datapath view**, not correctness. It decomposes cleanly into two layers:

- **MVP (the plan's core — recommended):** per-instruction-**class** phase sequences that yield
  **varying cycle counts**, plus `location` progression (`IF`→`ID`→`EX`→`MEM`→`WB`) and `micro`
  latches carried between cycles. Concretely: an R-type takes fewer cycles than a load because
  it **skips the MEM phase**; a store/branch **skips WB**. This is exactly the §12.1 headline
  ("instructions take varying numbers of cycles; still in-order, still one at a time") and it
  delivers the first real multi-cycle INV-4 journey (one instruction visibly walking IF→WB
  across the timeline). The reused ISA idioms mean the arithmetic is _not_ re-derived.

- **Full P&H structural fidelity (deferred / optional later phase):** explicitly modeling the
  **shared functional units** — one ALU reused across cycles (PC+4 in one cycle, branch-target
  or the real op in another) and a **single memory port** shared by fetch and load/store. This
  is the deeper textbook lesson ("why does `lw` take 5 cycles? because the ALU and memory are
  time-shared"), but it is **mostly a datapath-view concern**, not a model-core concern — the
  _final state_ is unaffected and even the cycle counts can match without literally sharing a JS
  ALU object. Stage it as a later view-side phase (step 5+), not the model core, so the model
  lands and is headlessly provable before the larger SVG work.

Recommendation: **build the MVP as steps 0–4; treat structural-fidelity + datapath as steps 5+
and an explicit scope lever the reviewer signs off on.**

## Build order (each step testable before the next)

Steps 0 and 1 are the two refactors the M1 decisions log explicitly deferred to "when the second
model lands" — they are prerequisites and pay for themselves immediately by shrinking both
engines' tests. Steps 2–4 are the model MVP. Steps 5–6 are the view + browser, staged behind an
explicit scope decision.

- [x] **0. Extract `toProgramImage` → `@cpu-viz/engine-common`.** ✅ Done. Both engines share the
      one adapter; single-cycle production code no longer imports the assembler (it consumed only
      the pure image). The eslint DAG expanded with a superset rule for `engine/common/**` (and
      closed a latent last-match-wins gap in the `reference/**` rule). Today `toProgramImage` +
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

- [x] **1. Extract the differential harness → test-only `@cpu-viz/engine-conformance`.** ✅ Done.
      `runConformance(modelName, () => Processor)` owns the corpus, `expectEquivalent`, and the
      model-independent `RESULT_ORACLES`; it drives any model via `defaultConfig()` and imports no
      engine-under-test. Single-cycle's differential suite shrank to one call. The M1
      decisions log (step-6 "Where does the differential test live?") deferred a dedicated
      conformance package as YAGNI "until the second model lands." It has landed. Create
      `packages/engine/conformance` (test-only) depending on `assembler` + `trace` +
      `engine-reference`, and move into it: the corpus enumeration (glob `content/programs/*.s`
      from disk + the empty-corpus discovery guard), `expectEquivalent` (registers + memory-union +
      `pc`/`halted`), and `RESULT_ORACLES` (the hand-computed headline results — **these are
      model-independent corpus facts**, e.g. sum-loop→55, so they belong here, not in a model's
      test). The harness is **parameterized over a `() => Processor` factory** so it imports
      _neither_ engine-under-test (no dependency cycle — same reason the reference's diff path
      stays clean). Both engines' `differential.test.ts` then shrink to: import the harness + the
      local processor, call `runConformance(() => new XProcessor())`. This extends single-cycle's
      existing **test-only project-reference-to-reference** precedent (its tsconfig already
      references `../reference` test-only). Acceptance: single-cycle's differential suite passes
      unchanged in behavior through the extracted harness; `npm run typecheck`/`lint`/`test` green.

- [x] **2. `engine/multi-cycle` — the model MVP.** ✅ Done (38 hand-derived unit tests). New package `packages/engine/multi-cycle`
      (`@cpu-viz/engine-multi-cycle`) implementing `Processor`, importing `isa`/`assembler`
      (via `engine-common`)/`trace` — and **nothing from `web`/`curriculum`/another engine's
      production code** (INV-2/INV-3, mechanically enforced). Each `step()` advances the single
      in-flight instruction by **one phase**, emitting a `CycleTrace` whose `instructions[0].location`
      is the current phase (`IF`/`ID`/`EX`/`MEM`/`WB`) and whose `state.micro` carries the
      inter-cycle latches (see decision "micro shape"). The instruction's **`id` is stable for its
      whole IF→WB lifetime** (INV-4) — a fresh id per _dynamic_ execution (so a looped instruction
      gets a new id each iteration, as single-cycle does), but the _same_ id across the several
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

- [x] **3. Differential test multi-cycle ≡ reference (INV-8).** ✅ Done. A three-line
      `packages/engine/multi-cycle/src/differential.test.ts` that calls the extracted harness
      (step 1) with `() => new MultiCycleProcessor()`. Asserts the same final-state equivalence
      over the same 5-program corpus (INV-7 — **no new programs**; the corpus is model-invariant).
      This is where "varying cycle counts, identical final state" is _proven_, not asserted.
      Acceptance: every corpus program's final reg+mem+pc+halted equals the reference's; the
      headline oracles (55/120/42/−4/ra) hold; a runaway cap turns an authoring bug into a failure.

- [x] **4. Time-travel over multi-cycle (recorder integration).** ✅ Done. The `TraceRecorder` is
      **model-agnostic** — multi-cycle just emits _more_ `CycleTrace`s per instruction, so the
      recorder needs **zero change**. Add a `trace`↔real-multi-cycle **integration** test (mirroring
      single-cycle's step-5 recorder test): load → run to end → step back to start → scrub to any
      cycle, with each cycle's snapshot matching; and the first real INV-4 payoff — **`follow(id)`
      on one instruction returns its `location` at each of its several in-flight cycles** (IF→ID→
      EX→MEM→WB), the "follow this instruction across its journey" feature the spec (§6) promised
      and single-cycle could only trivially exercise (one sighting). Acceptance: recorder reaches
      the same final state as a hand-driven run; a followed instruction's location sequence is the
      expected phase walk.

  > **After step 4 the multi-cycle MODEL is complete and fully proven headlessly** (differential
  >
  > - recorder), with **no browser work and no new SVG**. Steps 5–6 make it _visible_ and are the
  >   explicit scope lever below.

- [ ] **5. Web: model picker + multi-cycle datapath view.** _(Scope decision — see the "Web scope
      lever" decision. Shipping in two sub-steps: **5a done**, 5b deferred to its own follow-up.)_
  - [x] **5a. Model picker.** ✅ Done. `models.ts` is the model registry (`{id, label, description,
make, hasDatapath}`); `loadSource(source, makeProcessor = single-cycle)` takes an engine
        factory (default keeps every one-arg caller working); `useSimulator` holds the selected
        `model` in state and the factory in a **ref** so `loadInto` reads it at call time without
        `model` entering `select`'s dep chain (which would re-fire the mount effect and clobber the
        program). `setModel(id)` swaps the ref and re-loads the current source under the new engine,
        keeping the session/lesson and parking the cursor at pre-run. The header has a **Model**
        `<select>`; the transport, register/memory/source panels, scrub slider, lessons, and
        sandbox-fork all work **unchanged** (INV-3). The single-cycle SVG datapath is gated hard off
        for models without `hasDatapath` — lighting its single-cycle geometry with a multi-cycle
        trace would draw a **contradictory** picture (INV-5), so multi-cycle shows a placeholder
        pointing at 5b instead. New non-vacuous tests: `simulator.test.ts` proves the swap is real
        (multi-cycle records strictly **more** cycles than single-cycle for the same program, both
        land on a0 = 55, INV-8); `lessons.test.ts` proves **INV-6 cross-model** — every authored
        lesson still anchors, in order, with resolvable narration, against the multi-cycle recording
        (events, not cycles: the lesson swap does not strand a step). Full gate green (413 tests).
        **Browser-verified** (M1's `vite preview` + raw-CDP ritual): switching Model→multi-cycle grew
        the `sum-loop` timeline from last-cycle 33 to 123 on the live scrub bar, the datapath gated
        off to the placeholder and back, and an attached lesson stayed attached + re-anchored across
        the switch (INV-6 made visible).
  - [x] **5b. Multi-cycle datapath SVG.** ✅ Built (browser verification of the layout pending).
        A **separate, larger** hand-authored datapath (`datapath-multi.ts` + `MultiCycleDatapathView.tsx`):
        the shared ALU, the single shared Memory, and the five inter-cycle latches (IR/A/B/ALUOut/MDR)
        drawn as boxes, wired to the trace with the same pure-model/SVG-view split as M1's
        `datapath.ts`/`DatapathView.tsx`. Dispatched by a new `ModelChoice.datapath` discriminator
        (`'single-cycle' | 'multi-cycle' | 'none'`) replacing the old `hasDatapath` boolean; the
        placeholder now only backs `'none'`. - **`minTier` structural hiding finally earns its keep** (M1 step 9 kept it wired-but-unused
        for exactly this). Three genuine selectors — `addrmux` (IorD), `alusrcb` (ALUSrc),
        `wbmux` (MemtoReg) — are hidden at `essentials`; **contraction wires** (e.g. `pc → mem` in
        place of `pc → addrmux → mem`) stand in for each hidden mux. A contraction is a lawful
        collapse of the expert path (same source, same sink) — the INV-5 correctness condition,
        checked by a test. `wireVisibleAt` generalizes M1's no-dangling litmus **per tier** via
        wire `minTier`/`maxTier` ranges. The five latches + shared mem/ALU stay drawn at every tier. - **Activation is PHASE-DRIVEN**: each multi-cycle `CycleTrace` is one phase
        (`instructions[0].location`), so `activate` lights only that cycle's slice (values from the
        phase's events, latch snapshots from `state.micro`). No view-local phase stepper — scrubbing
        the transport IS the phase walk. Depth tiers (essentials/detailed/expert) apply as in M1
        (representation on top of the new structural layer). - **Deliberate simplification (candidate step 5c):** our engine computes PC-relative values
        (pc+4, targets) directly and emits **no `alu-op`** for them (jal/lui/auipc skip EX), and it
        commits PC at retire with no event. So the datapath does **not** reuse the ALU for next-PC
        arithmetic and does **not** draw the ALUOut→PC redirect — drawing a textbook ALU-based PC
        path would _contradict_ the trace (INV-3/INV-5), which is worse than omitting it. jal/jalr
        `pc+4` and auipc `pc+imm` writebacks come from a small dedicated `pcarith` unit (as
        single-cycle sourced them from `add4`/`branchadd`), so no register is written "from
        nowhere". Making the PC path textbook-canonical is an **engine-level** change (jal/auipc/pc+4
        would emit alu-ops, adding EX phases and changing the pinned cycle-count table + step-4
        tests) — hence a 5c follow-up, not view polish.

## Acceptance criteria (mirror the spec §11 shape, for multi-cycle)

- [x] Multi-cycle final register + memory state **equals** the golden reference for **every**
      corpus program (INV-8) — proven by the extracted conformance harness (step 3), same 5
      programs, no new fixtures.
- [x] Load → step forward to completion → step **backward** to start → **scrub** to any cycle;
      shown state always matches the recorded trace (free via the model-agnostic recorder; proven
      headlessly step 4, and **in-browser once step 5a landed** — the `vite preview` + raw-CDP drive
      switched Model→multi-cycle and drove the transport on the live panels).
- [x] A single instruction is **followable across its multi-cycle lifetime** (IF→ID→EX→MEM→WB),
      its `location` advancing one phase per cycle with a **stable id** (INV-4) — the first real
      "follow this instruction" payoff (step 4).
- [x] Instructions of different classes take **different numbers of cycles** (load > R-type >
      branch), visible in the trace and (step 5a) the timeline — the §12.1 headline. Browser-verified:
      `sum-loop` records **34 cycles on single-cycle vs 124 on multi-cycle** (last-cycle 33 → 123),
      the same swap `simulator.test.ts` proves headlessly, now visible on the scrub bar.
- [x] Depth-tier switching changes datapath detail without changing engine behavior and without
      violating lawful simplification (INV-5) — **including** lawful _structural_ hiding on the
      multi-cycle datapath (step 5b), the first place `minTier` box-hiding is lawful. Proven
      headlessly by `datapath-multi.test.ts`: per-tier no-dangling, mux-hiding at essentials,
      contraction↔through-wire swap, and the lawful-contraction (same source/sink) guard. _(Layout
      legibility still to be browser-verified via `npm run dev`.)_
- [x] `engine/multi-cycle` has **zero imports** from `web`/`curriculum` and from any other engine's
      production code; the trace schema is the only shared type surface (INV-2/INV-3, mechanically
      enforced by the eslint boundary rule + tsconfig references).

## Decisions to pin (fill in as steps land — seeded with the recommended answers)

- **Multi-cycle fidelity — DECIDED: MVP built (steps 0–4) + datapath structural layer (5b).**
  INV-8 is fidelity-agnostic, so this was a pedagogy/view call, not a correctness one. The MVP
  (varying cycle counts via per-class phase-skipping + `location` + `micro`) is the model core.
  Step 5b then landed the shared-ALU / single-memory / five-latch **structural** datapath as a
  pure view concern (`datapath-multi.ts`), with `minTier` box-hiding of the three muxes.

- **Multi-cycle next-PC path — RESOLVED BY STEP 5c (2026-07-20): the engine change was taken.**
  PC arithmetic now routes through the main ALU (`jal`/`auipc` gain an EX phase; see the revised
  cycle table above), so the datapath can draw the ALUOut→PC redirect without contradicting the
  trace. **On INV-7:** this was checked, not assumed. INV-7 is one ISA / one assembler / one
  program library — 5c touches none of them. It changes one model's _event stream_, which models
  are supposed to differ in (single-cycle emits no stall/flush events; the pipeline does), and
  INV-8 pins only final architectural state, so the differential stays green by construction. The
  original text below cited INV-7 for cross-model `alu-op` consistency; that citation was a loose
  hang — the real value there was pedagogical least-surprise, not the invariant. Preserved as the
  pre-5c record:

  > **DECIDED: omitted from the datapath; textbook version is a possible step 5c (engine-level).**
  > The 5b datapath does not draw the ALUOut→PC redirect / next-PC select.
  > This is forced by INV-3/INV-5, not laziness: the engine emits **no `alu-op`** for PC arithmetic
  > (jal/lui/auipc skip EX; pc+4 is computed directly) and commits PC at retire with **no event**, so
  > a textbook ALU-based PC path would _contradict_ the trace. Visible cost: for `jalr` the ALU target
  > in ALUOut has no drawn consumer (the link comes from the dedicated `pcarith` unit); a taken branch
  > shows the compare but not the redirect. Making it canonical means changing the **engine** (emit
  > alu-ops for jal/auipc/pc+4 → extra EX phases → the pinned cycle-count table and step-4 tests move),
  > so it is a follow-up milestone, not view polish. `pcarith` keeps every writeback sourced today
  > (no register written "from nowhere", INV-5).

- **`micro` / `ModelSpecificState` shape — DECIDED: fuller.** `MultiCycleMicro =
{ phase, ir, a, b, aluOut, mdr }` (exported from `@cpu-viz/engine-multi-cycle`). `ir` latched at
  IF; `a`/`b` = `Reg[rs1]`/`Reg[rs2]` at ID; `aluOut` at EX; `mdr` (raw load datum) at MEM. Each
  field is `number | null` (`null` = not latched this instruction — e.g. `aluOut` stays null for
  `lui`, which has no EX). It is an **independent per-cycle snapshot** (a fresh literal each cycle),
  proven by a snapshot-independence unit test. `getState()` before the first step carries `micro:
null` (nothing in flight). The fuller shape makes step 5b's latch boxes real at no real cost.

- **`location` set — DECIDED `IF`/`ID`/`EX`/`MEM`/`WB`** (exported `Phase` type). The single
  in-flight instance's `location` advances one phase per cycle; a class that skips a phase simply
  doesn't visit it. `instr-retire` fires at the last phase the instruction visits.

- **Per-class cycle-count table — PINNED (unit-tested, so it can't silently drift). REVISED BY
  STEP 5c** — the `jal` / `auipc` rows moved; every other row is untouched:
  | class | phases | cycles |
  |---|---|---|
  | load (`lb/lh/lw/lbu/lhu`) | IF ID EX MEM WB | 5 |
  | R-type + I-ALU | IF ID EX WB | 4 |
  | `jalr` | IF ID EX WB | 4 |
  | `jal` **(5c: was 3)** | IF ID EX WB | **4** |
  | `auipc` **(5c: was 3)** | IF ID EX WB | **4** |
  | store (`sb/sh/sw`) | IF ID EX MEM | 4 |
  | branch (`beq…bgeu`) | IF ID EX | 3 |
  | `lui` | IF ID WB | 3 |
  | `ecall` / `ebreak` / `fence` / unknown | IF ID | 2 |

  The rule that generates the table is unchanged: **IF+ID universal; then EX iff the main ALU is
  used (emits `alu-op`), MEM iff data memory is touched, WB iff a register is written** — a static
  function of the opcode, never of runtime values (so `addi x0,…` and a not-taken branch keep their
  class's count). What 5c changed is not the rule but **which instructions use the main ALU**: PC
  arithmetic now routes through it, so `jal` (target `pc+imm`) and `auipc` (`pc+imm`) gain an EX.
  INV-8 doesn't care about the counts; the tests pin them.

  **The line 5c draws, and it is the load-bearing one: the ALU computes jump/branch _targets_;
  `pc+4` never goes through the ALU.** A dedicated **PC+4 incrementer** supplies the sequential PC
  and the jump link — a real unit in every textbook datapath, so keeping it is not a fudge (unlike
  the pre-5c catch-all `pcarith`, which it replaces by shrinking to that one honest job). This is
  what stops 5c from adding an IF-phase `alu-op` to _every_ instruction (the P&H multi-cycle FSM
  computes `pc+4` in the ALU during IF; we deliberately do not — it would pollute every
  instruction's event stream to buy nothing the incrementer doesn't already show honestly).

  Consequences pinned with it: **`lui` stays 3** and is now alone in the IF/ID/WB class — it is a
  pure immediate pass-through with no PC arithmetic to route. **`jalr` stays 4** — it already had
  its EX (`rs1+imm`); 5c gives that ALUOut a drawn consumer rather than a second `alu-op` (its link
  comes from the incrementer). **Branches stay 3** — EX is the compare, not the target.

  **The taken-branch redirect was UNDRAWN after 5c — a lawful INV-5 omission, stated not hidden;
  CLOSED BY STEP 5d (2026-07-20).** A branch's target is `pc+imm`, which is not in ALUOut (ALUOut
  holds the _compare_ result), so the `aluout→pc` redirect cannot carry it; drawing it needs a
  separate branch adder node, which 5c did not add. 5d added exactly that — see the 5d record at
  the top of this file. The stated-omission discipline paid off here: the note named the missing
  component precisely enough that closing it was a contained step, not a re-derivation.

  **The PCSource mux was UNDRAWN after 5d — the last stated omission; CLOSED BY STEP 5e
  (2026-07-20).** With three redirects converging on PC and no selector between them, the diagram
  showed the winning source lit and the losers dark — lawful (a lower tier may omit a selector) but
  incomplete. 5e drew it. Worth recording how the discipline behaved differently this time: the
  note was _precise but understated_. It said "no PCSource mux drawn"; it did not notice that one
  of the three drivers it named — the sequential `pcarith → pc` — **had no wire either**. Drawing
  the selector is what surfaced that. Lesson for future stated omissions: a note that names a
  missing _selector_ should also be checked against whether every input it would select is itself
  drawn, or the note quietly understates the gap.

  **Cost 5c actually charged, recorded because it was NOT in the plan that was approved:** the
  multi-cycle datapath grows from **three muxes to four** — routing `pc` into the ALU for
  `jal`/`auipc` forces an **ALUSrcA** mux (PC vs the A latch). This is not optional polish: once
  the trace says the ALU computed `pc+imm`, INV-3 requires the datapath to show PC reaching the
  ALU, or the picture contradicts the trace — the exact defect 5c set out to fix. It is also
  textbook-canonical (P&H's multi-cycle datapath has precisely this mux). `jalr` needed no mux —
  its ALU A operand genuinely is `Reg[rs1]` — so the redirect wire was landed on `jalr` first and
  validated independently of the mux.

  Accepted, consciously (see the INV-7 note in the 5c decision below): this makes multi-cycle the
  **only** model routing `jal`/`auipc` through the ALU — single-cycle and the M3 pipeline keep
  their dedicated adders. That is a per-model microarchitectural choice, which is what having
  several models is for; it is not an ISA divergence.

- **`PhasedEvent` ordinal — CONFIRMED STILL DEFERRED.** Not revived. In multi-cycle the **cycle
  number itself** separates the phases (each phase is its own cycle) and event _order within a
  cycle_ encodes the rest, so the ordinal is even less needed than in single-cycle. Add it only if
  the step-5b animation genuinely consumes it.

- **Web scope lever — PROPOSED: model + differential + existing-panels first (steps 0–5a), bespoke
  datapath second (step 5b).** The model is fully provable headlessly (steps 2–4) with **no** web
  change. The model picker (5a) is a small `useSimulator` change that lights multi-cycle up in the
  _existing_ panels. The multi-cycle **datapath SVG** (5b) is a separate, larger diagram and the
  natural place to split the milestone if scope needs trimming — the reviewer should decide whether
  5b is in M2 or its own follow-up. Everything through 5a is in-scope-cheap; 5b is the big view
  investment.

- **What reuses UNCHANGED (kept honest).** The `TraceRecorder`/time-travel (model-agnostic —
  multi-cycle just emits more cycles); the 5-program corpus (INV-7 — no new programs); `isa` and
  `assembler` (untouched); the single-cycle engine (untouched — this is a _new_ model beside it,
  not a rewrite); the lesson runner + narration panel + sandbox-fork (all trace-driven, work over
  any model). The M1 architecture bought all of this — that reuse is the whole point (§12).
