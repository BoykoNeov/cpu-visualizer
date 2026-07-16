# Milestone 3 — the classic 5-stage pipeline (hazards, forwarding, stalls, flushes)

**Status: STEPS 0–7 DONE, 2026-07-16 (440 → 654 tests). The pipeline model exists, is INV-8-clean
under both forwarding positions, its soul is pinned by 32 hand-derived unit tests, its TIMING
is pinned on the whole corpus by a closed-form derivation (step 3) — the net for the one thing
INV-8 structurally cannot see — it is time-travellable, with five instructions in flight and
individually followable (step 4), it RUNS IN THE BROWSER with the forwarding toggle shipped
(step 5): 78 cycles off → 56 on, `a0` = 55 in both, on the live scrub bar — it has its own
DATAPATH (step 6), where five instructions light five stages in five hues at once and the forwarding
network vanishes when the toggle flips — and it now has the PIPELINE MAP (step 7), the textbook
stage×cycle grid, where the overlap finally stops being a claim about the trace and becomes the
staircase everyone recognizes.** Only step 8 (the flagship lesson) remains.

> **The map turned step 3's arithmetic into a picture, which nobody planned.** `sum-loop` draws
> **52 rows in BOTH forwarding positions** (34 retires + 18 flush casualties) while the cell count
> falls 241 → 197. That is `cycles = N + 4 + S + 2·T` rendered: **N and T belong to the program**
> (the same rows, either way), **S to the microarchitecture** (fewer cells). And the 18 casualties
> are legible for the first time — predict-not-taken speculatively fetches `li a7, 10` + `ecall` on
> every one of the nine loop iterations and throws them away every time.
> Proven so far: that the seams M3 fills already existed (`ProcessorConfig.forwarding`,
> `ProcessorCapabilities.configurableForwarding`, and the `forward`/`stall`/`flush`/
> `branch-resolved` events were all declared in the schema and honored by nobody); that the
> conformance harness can see **both** toggle positions (step 0); and now that a real pipeline runs
> the whole corpus to the reference's exact final state in both — **while taking different numbers
> of cycles**, which is the flagship interaction itself.
> **Step 1's decisions were reviewed and pinned 2026-07-16, before any code** — eleven stood as
> seeded, the halt rule was rewritten (its seed was false about the corpus), and the missing
> intra-cycle ordering decision was added. Building it then forced **twelve more** (the trace
> encodings, the clock-edge model, the shape of a stall); all are pinned in the table below.
> Deliberately deferred: configurable branch prediction and caches (M4 — see the pinned decisions),
> and M2's step 5c next-PC rework, which M3 does NOT depend on (see "What M3 does not inherit").

> **The headline claim is no longer a prediction — it is measured.** Mutating the hazard unit to
> ignore `forwarding: true` (an over-stalling pipeline: right answers, wrong timing) leaves INV-8
> conformance **12/12 green** while failing **10 unit tests** — and now, with step 3 landed,
> **14 timing tests on the real corpus**, every one of them an `[forwarding on]` case and not a
> single `[forwarding off]` one. That is the blind spot demonstrated rather than argued, and it is
> why step 3 existed.

> **Step 3's correction to this milestone's own rhetoric.** Forwarding is _not_ always faster:
> `call-return.s` takes **17 cycles in both positions**, because every RAW in it is already
> separated by a flush gap. The crown jewel is a claim about programs with real RAW chains (four of
> the five), not about the corpus — and `call-return.s [forwarding on]` passing under the
> over-stalling mutation is the proof that the distinction is load-bearing rather than pedantic.

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

- [x] **0. Extend the conformance harness to a config matrix.** ✅ Done (2026-07-16, 440 → 457
      tests). `runConformance` grew an optional third parameter — a readonly `ProcessorConfig`
      list defaulting to `[defaultConfig()]` — and runs the corpus once per config. Both
      `differential.test.ts` files are byte-for-byte untouched (the default parameter is what buys
      that) and their per-program titles are unchanged: the config is named in the `it()` title
      **only when there is more than one**, since labelling a lone neutral config would imply a
      config-blind model cared about it. (Each model suite does gain one new guard `it()` — see
      below.) The per-(config, program) check was extracted out of the `it()` body into a throwing
      `checkProgram(makeProcessor, config, file)`, and the matrix enumeration into a pure
      `conformanceCases(configs)` — both exported from the module but **not** from the package
      `index.ts`, so models still see only `runConformance` — and `runToHalt` now takes the config
      as a parameter instead of hardcoding `defaultConfig()`.
      Non-vacuity is proven in a new `conformance.test.ts` by a **reference-backed stub**: it
      delegates to the golden reference for its answer (so it is correct by construction) and then
      corrupts one register in a chosen `forwarding` position. Three claims needed proving, by
      different means, because none implies the others. **First, the check is config-sensitive:**
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
      two-position suite would then pass silently. **Third, a multi-config list really does run the
      corpus once per config, distinctly labelled:** asserted on `conformanceCases`. Both
      stub-driven claims run under exactly _one_ config, and the two model suites' lists are length
      1 by default, so nothing above covers the multi-config path at all — a matrix that iterated
      `configs` but only ever ran `configs[0]` would pass every one of them, and step 2 would then
      prove the pipeline in one position while reading as if it proved both. That is why the
      enumeration is pure data rather than a loop inlined into `describe`.

      All three guards were **mutation-checked**, not merely observed green: deleting the
      perturbation fails the first claim's test; reintroducing the pre-step-0 `defaultConfig()`
      hardcode fails all five corpus programs under the second; and under the third, enumerating
      only `configs[0]` fails the case-count assertion while dropping the title label fails the two
      labelling assertions. One more `it()` guards an empty `configs` list from skipping the corpus
      vacuously, mirroring the existing empty-fixture guard. The stub is program-agnostic — it
      rebuilds its input from the `ProgramImage` handed to `reset`, which is sound because the
      reference reads only `words`/`data` and never `symbols` — and that is what lets one stub
      serve both the single-program checks and the whole-corpus suite.

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

- [x] **1. `engine/pipeline` — the model MVP.** ✅ Done (2026-07-16, 457 → 501 tests).
      `@cpu-viz/engine-pipeline` implements `Processor` in ~600 lines of `processor.ts`, wired into
      the DAG in all four places plus the npm `workspaces` list (a fifth the plan forgot). 32
      hand-derived unit tests pin the soul; 12 conformance cases (step 2) pin the answers.
      **The one architectural idea everything else falls out of: the four latches are
      double-buffered.** Every stage reads `prev` (the latch contents as of the start of the
      cycle — what a real machine's latches present _before_ the clock edge) and writes a fresh
      `next`, committed at the end. That is what makes both forward paths correct, because EX
      reading `prev.exMem`/`prev.memWb` reads exactly the two inputs of P&H's forwarding mux.
      **The reverse walk is therefore NOT what makes forwarding correct** — with `prev` reads it
      would hold in any order. It earns its keep for three other things, each of which would
      otherwise be a special case: (a) the same-cycle WB→ID read, since the register file is the
      one piece of state that is _not_ double-buffered; (b) the intra-cycle `events[]` order; and
      (c) control-signal propagation (ID raises a stall → IF holds; EX raises a flush → ID/IF
      squash), each consumer running later in the walk.
      **A second clock-edge insight the seed missed, found by hand-deriving a flush before
      trusting it:** the PC redirect and the fetch-stop must ALSO be clocked at the edge (staged in
      the cycle context, applied after the walk), not poked mid-walk. Otherwise IF — which runs
      after EX — fetches from the _redirected_ pointer and the taken branch cuts only **one** row
      instead of the two the acceptance criteria demand. IF must fetch first and be squashed
      after: the stage does its work every cycle and the flush kills the _result_. The same
      applies to `ecall`'s shadow, which must still be fetched for the squash to have anything to
      kill. This was a real bug, caught by hand-derivation, not by conformance.
      **Latch immutability is the anti-aliasing discipline**: latch objects are rebuilt each
      cycle and never mutated, so copying the container is enough to give every recorded cycle its
      own `micro`. Conformance is structurally blind to this (it reads only the final cycle) — it
      would surface as latest-values-everywhere in step 4's time-travel. Pinned by a test now.
      **Corpus facts learned, worth carrying into step 3:** `add.s` is **7 cycles with forwarding
      on and 9 with it off** (identical final state) — the crown jewel is already visible on the
      corpus's _smallest_ program, with no new fixtures. And `TEXT_BASE` is **0**, so `lw x2, 0(x0)`
      reads the program's own first instruction word rather than an empty cell; tests that need a
      scratch address must choose one past the end of text.

      _Original plan text:_ New workspace package `@cpu-viz/engine-pipeline`
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

- [x] **2. Differential: INV-8 under forwarding on AND off.** ✅ Done (2026-07-16), and wired from
      the first compiling skeleton rather than saved for last — it is the cheapest gross-sequencing
      net available, and step 0 had already built it. Exactly the one planned call:
      `runConformance('pipeline', () => new PipelineProcessor(), [FORWARDING_OFF, FORWARDING_ON])`
      → 12 cases (5 programs × 2 configs + 2 harness guards), green, no new fixtures (INV-7).
      **Step 0's investment paid off immediately and exactly as designed:** the config labels in
      the `it()` titles are what made the one mutation failure below legible at a glance.

      _Original plan text:_ One call:
      `runConformance('pipeline', () => new PipelineProcessor(), [forwardingOff, forwardingOn])`.
      Both positions must equal the golden reference's final register + memory state on **every**
      corpus program. This is the correctness net, and step 0 is what makes it able to see both
      positions. Acceptance: the full corpus passes twice, once per config; no new fixtures
      (INV-7 — one example library across all models).

- [x] **3. Pinned timing tests — the net for INV-8's blind spot.** ✅ Done (2026-07-16, 501 → 542
      tests). `packages/engine/pipeline/src/timing.test.ts` — 41 tests, no new fixtures (INV-7), no
      engine change.
      **The step's one real idea: the table is a DERIVATION, not a list of numbers.** "Hand-derived"
      was the acceptance bar, and for a 10-iteration loop with stalls and flushes, deriving by
      cycle-counting is both unreliable and unreviewable. So the timing was derived in closed form
      from the pinned rules first, and the corpus numbers fall out of it. Let `d_i` be the cycle
      instruction `i` leaves ID (EX at `d_i+1`, WB at `d_i+3`; the machine halts at the last retire,
      so `cycles = d_last + 4`). The pinned rules ARE the recurrence: `d_i ≥ d_(i-1)+1`; forwarding
      off, `d_i ≥ d_p+3` per producer (+3 not +4 — that is the same-cycle WB→ID rule paying for
      itself); forwarding on, `d_i ≥ d_L+2` for a LOAD producer only; a taken transfer gives
      `d_target ≥ d_b+3`. Summed over a run it collapses to:

      > **cycles = N + 4 + S + 2·T** — N retires, S stall cycles, T taken transfers.

      **The thesis, stated as arithmetic rather than anecdote: N and T belong to the PROGRAM, S to
      the MICROARCHITECTURE.** Forwarding cannot change which instructions run or which branches are
      taken, so `cycles_off − cycles_on = S_off − S_on`, exactly. Each term is asserted separately
      against the events that define it (a lone total lets a compensating over-S/under-T pair
      through and localizes nothing), and the crown jewel is asserted **standing alone**, not
      resting on the formula.

      | program       |  N |  T | S_off | S_on | cycles_off | cycles_on |
      | ------------- | -: | -: | ----: | ---: | ---------: | --------: |
      | add.s         |  3 |  0 |     2 |    0 |          9 |         7 |
      | array-sum.s   | 34 |  4 |    26 |    5 |         72 |        51 |
      | byte-loads.s  |  6 |  0 |     4 |    0 |         14 |        10 |
      | call-return.s |  9 |  2 |     0 |    0 |         17 |        17 |
      | sum-loop.s    | 34 |  9 |    22 |    0 |         78 |        56 |

      Every entry was derived before the file was written and **all 41 passed on the first run** —
      the engine and the closed form agree exactly, including the subtle parts below.
      **Four things the derivation forced, none of which a cycle-count would have surfaced:**
  - **`call-return.s` is the honest counterexample: S = 0 in BOTH positions — forwarding buys it
    nothing, 17 cycles either way.** Every RAW in it is already separated by a flush gap (`bge`
    reads across the `jal`; `mv s0, a0` reads across the `ret`), and the gap charges the +2 the
    interlock would have. So the crown jewel is claimed for the four RAW-chained programs, not for
    the corpus: a suite asserting "on is always faster" would be **overclaiming**, and weakening it
    to `≤` would then pass for a pipeline where forwarding did nothing at all. The mutation run
    below proves the point empirically — `call-return.s [forwarding on]` is one of the two ON cases
    that **passes** under the over-stalling mutation, because it has no stalls to over-count.
  - **The +2 is per taken TRANSFER, not per `flush` EVENT — they come apart in the corpus.**
    `call-return.s`'s `ret` is the last word of `.text`, so nothing is behind it to kill: it emits
    **no flush at all** (step 2's "real casualties" rule) and still costs its two cycles, since the
    target cannot be fetched until the redirect lands. T = 2 but branch-taken flushes = 1; keying
    the penalty off flushes would under-count by 2. A penalty is not a casualty.
  - **Stall counts are not uniform per iteration, so a per-iteration cost cannot be assumed.** In
    `sum-loop.s` off, iteration 1's `add` stalls 2 but **no later iteration's does** — the taken
    branch's 2-cycle gap has already retired its producers. Only the `bne` stalls every time (the
    distance-1 branch-operand RAW, 10×). Hence S_off = 2 + 2×10, not 4×10.
  - **Placement is pinned as a pc→cycles histogram, not a count** (`{ 8: 2, 16: 20 }`), so count and
    placement share one source of truth and S is summed from it rather than stated twice. Keyed by
    pc rather than cycle: a loop's stalls recur at the same static pc, so the entry stays
    hand-checkable where twenty cycle numbers would not be. Mutation-checked: moving a stall from
    pc 8 to pc 12 **with the total unchanged at 22** fails, so "right number, wrong place" is caught.

    **The blind spot, now measured on the corpus rather than argued.** Re-running step 1's mutation
    (the hazard unit ignores `forwarding: true` — an over-stalling pipeline: right answers, wrong
    timing) against both nets: conformance **12/12 green**, timing **14 failures**, and the failures
    are exactly attributable — every `[forwarding on]` case fails, **no** `[forwarding off]` case
    does. That is INV-8's blind spot and this step's reason to exist, in one command.

    A guard `it()` asserts the table covers every `.s` on disk: conformance enumerates the corpus so
    a new program is differentially tested automatically, but it would **not** get a timing entry
    automatically — the table must fail loudly rather than silently stop covering the corpus.
    Deliberately NOT re-derived here (step 1 already pins them on minimal programs): forward
    from/to/value, the priority rule, the load-use bubble. The tedious per-forward derivation across
    10 loop iterations buys nothing.

    _Original plan text:_ The headline decision explains
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
    a failing run is not a pin — it is a snapshot of a bug).

    **Correction, measured during step 1 — do not repeat the seed's claim.** The seed said
    "deliberately breaking the priority rule or dropping a forward path must fail **these** tests
    while conformance stays green". Half of that is **false about this corpus**, and step 1
    mutation-checked it rather than assuming:
    - **Priority inversion (MEM/WB consulted before EX/MEM): conformance DOES catch it** —
      `array-sum.s [forwarding on]` fails. The reason is worth knowing, because it is invisible in
      the `.s` source: `la t3, total` expands to **two instructions that both write `t3`**,
      immediately consumed by `sw a0, 0(t3)`. That is a natural distance-1-and-2 double match, and
      inverting the priority stores the total through a half-built address. The corpus has had a
      double-match litmus all along, hiding inside a pseudo-op.
    - **Over-stalling is the real blind spot, and it is total.** Mutating the hazard unit to ignore
      `forwarding: true` left conformance **12/12 green** and failed **10 unit tests**. THAT is the
      demonstration this step exists for — use it, not the priority rule, as the worked example.
    - Dropping the load-use stall does not silently corrupt: it trips the model's own defensive
      assertion (a load in MEM has no forwardable value), which is the intended failure mode.

- [x] **4. Recorder / time-travel over the pipeline.** ✅ Done (2026-07-16, 542 → 554 tests).
      `packages/engine/pipeline/src/recorder.test.ts` — 12 tests, **zero production changes**, which
      is the step's headline: "free by construction" was a claim, and it survived contact. The
      recorder drives a five-in-flight model with no edit, so INV-3 paid for itself a third time.

      **The step's real work was SCOPE, not code — and the plan overstated what was new here.**
      Three of the four things this step's text asked for were **already pinned at the engine level**
      by step 1's `processor.test.ts`: the clean five-stage walk, the five-in-flight cycle (the same
      six-`addi` program, at the same cycle 4), and the per-cycle latch snapshot. Rebuilding them
      through a recorder would not have made them any truer. So step 4 asserts only what the
      **recorder layer** can: the navigation criterion end-to-end, and `follow()` — the **shipped
      API the web calls**, where `processor.test.ts` proves the walk with a test-local `walk()`
      helper that reads traces directly. That distinction is the whole of this file's reason to
      exist, and it is worth stating because "the acceptance criteria mention it" is not the same as
      "nothing pins it".
  - **The real gap the scope review found, and the third blind spot.** One walk shape was pinned
    **nowhere**: an instruction **held in IF** across a stall (`IF IF IF` under one id). The existing
    INV-4 test follows an instruction that never stalls; the stall tests follow the **consumer**
    (whose repeated cell is `ID`). Nobody followed the instruction stuck _behind_ the interlock — the
    other half of the pinned "what a stall does to IF" decision. Mutating IF to **re-fetch** instead
    of hold mints **three ids for one instruction** (a direct INV-4 breach), and the measured result
    is the finding: **conformance is 12/12 green and every timing test passes.** Right answers, right
    speed, three identities for one instruction. Step 3 established that INV-8 is blind to timing;
    step 4 adds that **INV-8 _and_ the timing suite are both blind to instruction IDENTITY** — the
    thing every downstream view (follow-highlight, the step-7 map's rows) is keyed on. The only other
    failure under that mutation is one incidental `processor.test.ts` case, and incidental is the
    point: it breaks because `idOfNth`'s fetch-indexing gets confused, reporting a misleading reason
    rather than naming the breach. A net that fails for the wrong reason is not a net.
  - **`micro` is pinned against the TIMELINE, not per-cycle.** The time-travel expression of the
    latch-immutability decision, and deliberately stronger than the engine-level version (one latch,
    three instructions): across all four latches and a whole corpus recording with stalls, flushes
    and a loop, **the latch contents recorded at the end of cycle `i` name exactly the instructions
    the recording places in ID/EX/MEM/WB at cycle `i+1`**. Aliasing would report the final cycle's
    occupants everywhere and fail at cycle 0. Mutation-checked by snapshotting **before** the clock
    edge: exactly the two cross-check cases fail (both configs) and nothing else — the specificity
    is the proof it pins the timeline rather than merely touching `micro`. Covers the four latches
    and **not IF**, which has no latch behind it: five stages, four latches, so IF's occupant is
    fetched, never presented by `micro`.
  - **Two traps in porting M2's version, both caught before the first run.** The pipelined
    `overwrite` program commits at cycles **4/5/6** (writes land at WB, one cycle apart), not M2's
    3/7/11 — copying the neighbour's numbers would have pinned a fiction. And the pre-run `micro` is
    a **non-null object with four null latches**, not the absent `micro` M2 asserts, so
    `expect(micro ?? null).toBeNull()` would have failed. Every derived number passed first run.

- [x] **5. Web: `models.ts` entry + the forwarding toggle control.** ✅ Done (2026-07-16, 554 → 587
      tests). The pipeline is drivable in the browser and the milestone's flagship control ships
      with it. Browser-verified via the standing `vite preview` + raw-CDP ritual: **78 cycles off →
      56 on, `a0` = 55 in both**, read off the live scrub bar and the real register panel — the
      same numbers step 3 derived in closed form, now reproduced through the web's own load path.

      **The step's real work was the config SEAM, which the plan did not mention.** `loadSource`
      never passed a `ProcessorConfig` at all — `recorder.load` defaulted it internally. That was
      invisible while every model was config-blind and wrong the moment one was not: the toggle
      would have driven a UI that re-recorded the identical trace. It now takes one (defaulting to
      neutral, so every pre-existing caller is byte-for-byte unchanged) and hands it to
      `recorder.load`. `useSimulator` holds `forwarding` at **session** level in the same
      state-plus-ref shape `setModel` already used, and passes it to **every** model — a
      config-blind engine is unmoved by it (pinned), so the value survives a trip through
      single-cycle and is still set on return (confirmed in the browser). The control is gated on
      `capabilities.configurableForwarding`, sourced from each engine's own exported
      `*_CAPABILITIES` constant now carried on `ModelChoice`, so gating needs no engine instance;
      a test pins each row against `make().capabilities` **by identity**, since a copy-pasted row
      reaching for the right flags from the wrong model is the actual failure mode.

      **Non-vacuity, mutation-checked:** dropping the config on the floor leaves the "identical
      final state" test **green** and fails exactly two — the crown jewel and the lesson-shift
      guard. That is INV-8's blind spot reproduced at the web layer (right answers, wrong speed),
      and the specificity is the proof the suite localizes rather than merely going red.

      **The plan's "no further changes (INV-3)" claim was tested rather than trusted, and this
      time it held.** All three single-cycle-authored lessons anchor under the pipeline in **both**
      positions, first run. The whole risk was one question — does EX emit `alu-op` for branches?
      Two anchors depend on it (`sum-loop-tour`'s `bne`, `function-call`'s `bge`) — and it does.
      Pinned beyond "it anchors": **the toggle changes WHEN a step fires, never WHAT it fires on**
      (anchored event payloads compare equal across configs, `instr` stripped — ids are minted per
      fetch and the two positions fetch a different number of doomed shadows). The non-vacuity
      guard for that is asserted on `sum-loop` and **not** the corpus, because step 3 measured
      `call-return` at 17 cycles in both positions: its anchors do not move at all.
  - **The one thing the eyeball caught that no test would have.** At cycle 4 the pipe holds five
    instructions and the shell showed exactly **one**, unqualified, while the header promised five.
    Not broken — `instructions[0]` is genuinely in flight (lawful omission, INV-5, and it is the
    **retiring** one since the ordering is oldest-first) — but _misleadingly complete_: it reads as
    "a pipeline is just a slow single-cycle", the exact misconception this tier exists to break.
    Fixed with a rule that contains **no model knowledge**: qualify the shown instruction exactly
    when `instructions.length > 1`. Single-cycle and multi-cycle always carry one, so it can never
    appear for them; the pipeline qualifies itself, from the trace alone (INV-3). It turns out to
    _teach_ — scrubbing the fill reads **2 → 3 → 4 → 5 in flight**, one stage per cycle: the pipe
    filling, narrated in the transport, before step 6's datapath or step 7's map exist.
  - **Two findings from pinning that premise** (a first draft asserted a flat "the pipeline reaches
    five" and was **wrong**, which is how both were found):
    **Forwarding does not only make the pipe faster — it is what FILLS it.** A bubble is a `null`
    latch and never appears in `instructions[]`, so an interlocked pipe carries strictly fewer
    _live_ instructions: `sum-loop` tops out at **4** with forwarding off and reaches **5** with it
    on. A second observable of the toggle, independent of cycle count, and visible in the chip.
    Scoped to `sum-loop`, **not** claimed of the corpus — `array-sum` and `call-return` reach five
    in both positions. And `add.s` can never fill five stages in **either** position because it
    holds three instructions: **program-bound, not stall-bound** — two causes for one symptom,
    pinned separately so neither is mistaken for the other.

    _Original plan text:_ _(Shippable checkpoint on
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

- [x] **6. The pipeline datapath SVG.** ✅ Done (2026-07-16, 587 → 621 tests). `datapath-pipeline.ts` + `PipelineDatapathView.tsx`, dispatched by a new `'pipeline'` arm; browser-verified in light
      and dark via the `SNAP` harness + headless Chrome — the pipe filling across all three tiers,
      the toggle in **both** positions, and the branch redirect **lit** (which needed its own page:
      the RAW and fill programs that verified everything else contain no taken branch, so the
      redirect was idle grey in every other view). Every geometry invariant passed **first run**,
      and all three nets below were **mutation-checked** rather than observed green.

      **The step's one architectural shift: activation stopped being single-phase.** M1 lit one
      instruction's whole path; M2 lit its one in-flight instruction's one phase — both could paint
      the lit slice ONE color because both had one instruction. Here a cycle lights five stage slices
      for five different instructions, so `DatapathActivation` drops `phase` entirely and each lit
      WIRE carries `{ instr, stage }`: the stage picks the hue, the id is what step 7's follow keys
      on. Pinned at the render seam, where the pure suite cannot reach: one cycle's markup strokes
      **five distinct `var(--phase-*)` hues at once**.

      **The trap the plan did not name, and the reason to read `location`:** occupancy comes from
      `instructions[].location`, NEVER `state.micro`. Step 4 pinned that `micro` at cycle `i` is the
      END-of-cycle snapshot — the latches cycle `i+1` reads — so a datapath sourced from it draws the
      pipe **one cycle ahead of itself**. Mutation-checked: sourcing ID's occupant from `micro.ifId`
      fails exactly the timeline test and the five-in-flight test. Its honest consequence, which
      looks like an omission and is not: **the values riding the latches between stages are
      unlabelled**, because a load's `aluOut` was computed while it was in EX, a cycle before it sits
      in MEM — no event in the drawn cycle holds it. Lit without a value beats a number that is one
      cycle wrong (INV-5).
  - **Forwarding lights as a change of PATH, not an extra wire.** When a `forward` names `EX.rs1`,
    the ID/EX→mux wire goes DARK — the mux selects one input. Drawing both would show the stale
    register value flowing into the ALU beside the fresh one: the exact misconception this tier
    exists to break, and it would also make one of the two labels a lie. Mutation-checked.
  - **Config is a SECOND visibility axis, and `maxTier` could not express it.** `nodeVisibleAt` /
    `wireVisibleAt` take `(tier, forwarding)`. M2 hand-maintains `maxTier: 'essentials'` _alongside_
    `contracts: 'addrmux'` — two fields that must agree, and a scalar cap cannot say "hidden at
    expert-with-forwarding-off". So contraction visibility is **derived**: a contraction is drawn
    exactly when the unit it contracts is not. `maxTier` is not carried over, and the 2D condition
    falls out for free rather than being spelled twice.
  - **The hazard unit is NOT config-gated** — the one sub-decision that is easy to get backwards.
    It is live in BOTH positions (the load-use stall survives forwarding; the RAW interlock is the
    whole story without it), so gating it on config would erase the interlock from the very diagram
    meant to explain it. Only the forwarding unit, its muxes, and the forward paths gate on config.
  - **Component boxes are hue-NEUTRAL, and that is forced rather than lazy.** The register file is
    read by ID and written by WB in the SAME cycle (the pinned same-cycle WB→ID rule), and every
    latch bar is written by the stage on its left while the stage on its right reads it. There is no
    one stage such a box belongs to. Wires are unambiguous — each lies on one side of one bar — so
    the hue lives on wires. This needed **no renderer change**: `NodeVM` never had a color, which
    turns out to be exactly right.

    **Only the BROWSER EYEBALL caught the layout defect, again — and its cause is worth carrying.**
    Every headless net was green while `detailed` printed the identical 32-bit pc **three times** in
    the tightest band (the pc flows selector→memory→adder; labelling each says nothing new), and the
    encoding labels sat **on top of** the IF/ID bar, unreadable. The cause is structural, not
    cosmetic: the shared renderer de-collides a label by nudging it **vertically** until it clears
    every box, which works everywhere else because the boxes are short — but a **360px latch bar has
    no clear y to escape to**. So **the canvas width is set by the labels, not the boxes**: every gap
    where a hex label lands beside a bar is sized (~80px) to hold it. That is the one thing here a
    reader would "tidy up" and break, so it is commented at `CANVAS`. Fixed both ways — drop the
    redundant labels (the pc once, the encoding once at the fetch that produced it), and widen the
    five bar-adjacent gaps.

    _Original plan text:_ A bespoke, hand-authored `datapath-pipeline.ts` +
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
    decision on carrying `target` on that event. ✅ **Eyeballed lit, not just asserted present** —
    the deliverable unique to this step, and the RAW/fill pages that verified everything else have
    no taken branch in them, so the redirect was idle grey in all of them. On its own page it reads
    as intended: `beq` in EX drives `PC arith` from its two labelled inputs (the pc and the imm),
    and the target runs the full width back along the bottom rail into `PCSrc`, labelled with the
    `branch-resolved.target` itself. The doomed younger instructions light their paths **normally**
    alongside it — deliberate: predict-not-taken genuinely did fetch them, and they die at the clock
    edge. That reads as "the pipe kept fetching and the branch redirected it", not as a
    contradiction; narrating the kill is the step-7 map's job (cut rows), not the datapath's.
    `jalr` redirects from the **ALU** instead, since a register supplies its target.

    Acceptance: the two standing litmuses ported — **coherence** (every lit wire resolves to real
    geometry with both endpoints lit; no lit wire into a dim box) and **contraction lawfulness**
    — plus the geometry invariants the overhaul established (axis-aligned, on-perimeter, no
    collinear overlap), per-tier **and per-config** no-dangling, and a browser eyeball in light
    and dark via the `SNAP`-gated harness.

- [x] **7. The pipeline map (stage × cycle grid).** ✅ Done (2026-07-16, 621 → 654 tests).
      `pipeline-map.ts` (the pure fold) + `PipelineMapView.tsx` (the HTML grid), gated on the trace
      rather than the model. Browser-verified in light and dark via the `SNAP` harness, and — the
      part that mattered — **live on `sum-loop` at real scale** (78 cycles × 52 rows) through the
      `vite preview` + raw-CDP ritual, which is where both of this step's real defects were found.

      **The step's one architectural idea: this is the only M3 deliverable a future model reuses
      as-is, so it carries NO model knowledge — and "parametric" turned out to mean something
      narrower and sharper than the plan implied.** Three things are derived: the stage SET (distinct
      `location`s in first-seen order), the ROW order (`instructions[]` is pinned oldest-first, so
      appending each id on first sight yields fetch order), and the HUE key — which is the stage
      **family** (`stageFamily`), collapsing exactly the two axes M3 pinned `location` to absorb
      (`EX.0` → `EX`, `IF2` → `IF`) and nothing else. But **stage ORDER turned out to be needed
      nowhere**: rows×columns never consults it, only the legend does. The row/column model really
      does absorb both future axes for free, and the generality that had to be bought was just the
      hue key.

      **The parametricity is proven by HAND-BUILT traces, not by our engines** — no model we ship
      emits a lane or a deep stage set, so a test that could only run against our own engine would
      prove the map parametric exactly where it already is. Those cases construct no engine, no
      recorder and no program, which makes them also the sharpest available proof of "derived purely
      from the trace" (INV-3). They drive dual-issue rows sharing a column (six stages, **three**
      hues), a 7-stage walk (seven stages, **five** hues), and a lane-qualified flush that must kill
      `EX.1`'s occupant and not `EX.0`'s.

      **The plan was wrong about the renderer deltas, in a good way: 1–3 were already done, and 2 was
      obsolete.** Delta 1 (hue override) shipped as `WireVM.color` in the datapath overhaul; delta 3
      (data-driven legend) shipped with step 6. Delta 2 — "one `<marker>` per distinct hue, a marker
      zoo" — was never needed: the renderer's arrowhead uses `context-stroke`, so ONE marker serves
      every hue and the idle grey. Only **delta 4 (follow) was real**, and it lands on **wires only**:
      the superscalar plan seeded `followed?: boolean` on _both_ VMs, but step 6 pinned that a
      component box belongs to no single instruction (the regfile is read by ID and written by WB in
      one cycle), so a node counterpart cannot exist — the same reason boxes carry no hue. Step 6's
      decision to carry `instr` on every lit wire is what pays for follow here: with five
      instructions lighting the diagram at once, the id is the only thing that can pick one out.
  - **The seam the plan did not mention (again, one per view step): the RECORDING.** Every panel
    before this is a pure function of the cursor's CYCLE; the map is a grid of instructions × cycles,
    so it needs the run. `useSimulator` had no way to hand it over — `recorded` is new, and the map is
    only the second consumer of a complete recording after `anchorLesson`, holding the same
    precondition for the same reason. A fresh load builds a fresh recorder, so the array identity
    changes per recording, which is what lets the map memoize and what tells the shell a followed id
    belongs to a recording that no longer exists (ids are minted per FETCH, and the two forwarding
    positions do not even fetch the same shadows).
  - **The gate is DERIVED, not declared** — `hasOverlap(recorded)`, the same shape as step 5's
    `instructions.length > 1` rule and with no model knowledge in it. The map exists to show
    instructions overlapping in time, so it appears exactly when they do; single-cycle and
    multi-cycle carry one per cycle by construction, so it never appears for them without anything
    naming them, and a future model gets it free. Verified live: `present: false` on single-cycle.
  - **Follow RETARGETS the transport chip and the source line** (`shownInstruction`), which is what
    makes it mean anything off the map — otherwise "follow" would be a map-local decoration. Pinned
    as a pure function rather than left inline. The acceptance is asserted on ONE cycle with five in
    flight, because the claim is that the three surfaces agree with EACH OTHER: three separate
    fixtures would prove each can draw a ring and nothing about whether they ever point at the same
    instruction. Live: 3 ringed wires of 17 lit, 2 ringed map cells, the source panel on the followed
    line, chip reading `following MEM · 4 in flight`.
  - **The map cross-checks step 3's closed form, which nobody planned.** `sum-loop` renders **52 rows
    in BOTH positions** (34 retires + 18 flush casualties) while the cell count drops 241 → 197. That
    is `cycles = N + 4 + S + 2·T` as a picture: N and T belong to the PROGRAM (same rows), S to the
    microarchitecture (fewer cells). And the 18 casualties are legible for the first time —
    **predict-not-taken speculatively fetches `li a7, 10` + `ecall` on every one of the nine loop
    iterations and kills them every time.** The exit sequence, fetched and thrown away ten times over.
    Step 3 could only count that; the map shows it.

  - **The map needed its own cap, for the same reason `TEACHING_MAX_CYCLES` exists — one layer
    down.** Found in review, after the first commit, and it is the one thing here that no
    corpus-based test could have surfaced. The grid declares explicit tracks, so its layout cost is
    cycles × rows whether the cells are sparse or not. The corpus cannot reach that (`sum-loop`, the
    longest, is 78 cycles) — but the **sandbox** can: `li t0, 500`, a countdown a user types in
    seconds, records **3,007 cycles × 2,001 rows ≈ 6 million grid areas and 2.2 MB of markup**, and
    the engine cap permits **16× more again**. That is the engine cap's own failure mode
    (_"a frozen tab is worse than a friendly 'ran too long' message"_) reintroduced **downstream of
    it**, on a recording it had already judged acceptable. Fixed by PAGING the drawn window
    (`MAX_MAP_CYCLES = 400`), quantized to pages rather than centred on the cursor — a window that
    recentred every scrub would slide the grid under the reader on every step, where a page boundary
    is a thing you can point at. It is a pure function of the cursor (no state), the fold stays whole
    and oblivious (INV-2 — the same split as the datapath: `activate` lights everything, the view
    decides what to draw), and 400 sits far above the entire corpus, so **paging is strictly a
    sandbox affordance and the teaching path is untouched** (pinned by a test that asserts the
    longest corpus program is 78). And it **pages rather than truncates**: a silent cap would read as
    "this is the run" while showing a slice, so the header states the window and the total, and the
    ruler keeps ABSOLUTE cycle numbers so the map cannot disagree with the scrub bar. Measured at the
    worst case the engine cap allows — **48,010 cycles × 32,002 rows: fold 48 ms, render 86 ms,
    303 KB, 400 tracks** — and verified live in the browser on the 3,007-cycle sandbox program
    (`cycles 2400–2799 of 3007 · scrub to page`, still responsive). Mutation-checked: removing the
    cap fails exactly the three paging tests and no corpus one.

    **The BROWSER EYEBALL caught the real defect again — twice, and both only at real scale.** Every
    headless net was green and every SNAP page (short programs, ~10 cycles) looked right.
    **(a) The map was below the fold** — top at 884px of a 902px viewport, pushed there by the 490px
    datapath, so the one picture this tier exists for was off-screen behind the diagram. Moved ABOVE
    the datapath, and the reason is structural rather than taste: **the map is a TIMELINE surface —
    its playhead IS the scrub cursor** — so its natural neighbour is the scrub bar, not the memory
    panel. It costs the other models nothing; they never render it. **(b) "Keep the playhead in view"
    naively means the MINIMUM scroll, which pins it flush against the trailing edge**: technically
    visible, with the cycles you are scrubbing _towards_ permanently off-screen. Re-centre on leaving
    a margin instead. Neither is a thing a test would have asked about.

    _Original plan text:_ The new view surface, already designed in
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

- [x] Pipeline final register + memory state **equals** the golden reference for **every** corpus
      program, under **both** `forwarding: false` and `forwarding: true` (INV-8) — the same 5
      programs, no new fixtures (INV-7). ✅ step 2.
- [x] **The crown jewel:** the _same program_ under forwarding off vs on produces **identical
      final architectural state** and **strictly different cycle counts** — the spec's flagship
      interaction (§12), and the one thing conformance structurally cannot prove on its own.
      ✅ **headlessly** in step 3, on the four RAW-chained corpus programs (add.s 9→7,
      byte-loads.s 14→10, array-sum.s 72→51, sum-loop.s 78→56), each with identical final
      registers/memory/pc. ✅ **on the live scrub bar** in step 5, browser-verified: `sum-loop`
      records 78 cycles with the toggle off and 56 with it on, `a0` = 55 read off the register
      panel in both — the same numbers step 3 derived, through the web's own load path.
- [x] **The bubble that cannot be forwarded away:** the load-use hazard still stalls one cycle
      with forwarding **on**, and that stall is visible in the trace. ✅ step 1 (minimal program)
      and step 3 (`array-sum.s`: exactly one `load-use` stall per iteration, at pc 20, in the
      forwarding-**on** position — the only stall that survives the toggle anywhere in the corpus).
      ✅ **the datapath half** in step 6: the hazard unit lights exactly when the interlock fires —
      asserted in **both** positions, and asserted to light on nothing else (a permanently-lit
      interlock would say nothing about _when_ the bubble happens). ✅ **the pipeline map half** in
      step 7, which is where the bubble stops being an event and becomes a SHAPE: the load-use pair
      walks `IF ID ID EX MEM WB` — the repeated cell — in the forwarding-**on** position, with a
      no-load control walking `IF ID EX MEM WB` beside it so the repeat is attributable to the hazard
      and not to a map that repeats everything.
- [x] Load → step forward to completion → step **backward** to start → **scrub** to any cycle;
      shown state always matches the recorded trace. ✅ step 4, headlessly; ✅ step 5 in the
      browser (scrubbed the pipeline's fill cycle-by-cycle over a `vite preview` build).
- [x] **Five instructions are in flight and individually followable** in a single cycle: five ids,
      five distinct `location`s, `follow()` tracking any one of them IF→ID→EX→MEM→WB across the
      recording with a stable id (INV-4) — the first tier where this is the only way to read the
      trace. ✅ step 4, through the shipped `follow()` API rather than a test-local helper, with the
      "follow one while four others are in flight" assertion explicit — plus the walk nothing pinned
      before it: an instruction **held in IF** across a stall, one id, fetched once.
- [x] A taken branch emits `branch-resolved` + `flush`, kills exactly two younger instructions,
      and the map shows the cut rows. ✅ step 7: the two casualties' rows are cut on the diagonal
      (`['IF','ID']` and `['IF']` — the younger one got one stage less because it was fetched one
      cycle later), neither retires, and the survivors around them are asserted untouched so
      "everything is killed" cannot pass. They read as thrown-away work rather than as rows that
      merely stopped — the cells KEEP their stage hue, because predict-not-taken genuinely did fetch
      and run them, with a struck/dashed treatment and a ✕ where the instruction vanished. Live on
      `sum-loop` this is the finding nobody planned: **the exit sequence (`li a7, 10` + `ecall`) is
      speculatively fetched and killed on every one of the nine loop iterations** — 18 cut rows,
      which is exactly step 3's `T = 9` made visible.
- [x] Depth-tier switching changes datapath detail without changing engine behavior and without
      violating lawful simplification (INV-5) — including the forwarding/hazard units'
      `minTier` structural hiding and their **config-driven** absence, each backed by a lawful
      contraction. ✅ step 6, on both axes (`DEPTH_TIERS` × both forwarding positions): no-dangling
      and contraction-lawfulness are asserted per (tier, config), and `activate` stays oblivious to
      both (INV-2 — it never even emits a forward path in the off position, rather than emitting one
      the view then hides). Browser-verified in light and dark: the forwarding network **vanishes**
      when the toggle flips, and the hazard unit does not.
- [x] Editing the program mid-lesson **forks into a sandbox** (annotations detach) and the sandbox
      run still animates — free via INV-3, but assert it once on this model. ✅ step 5
      (`sandbox.test.ts`): the edited sum-loop detaches the lesson and records to **its own** result
      (15, not the lesson program's 55) on the pipeline, and time-travels. Free was a claim until
      something exercised it — a sandbox is the one entry point whose program is **user text rather
      than a corpus fixture**, and step 5 had just given the load path a new `config` argument that
      every entry point must carry. So the toggle is asserted to reach a sandbox program too
      (strictly fewer cycles, identical registers): a fork that silently dropped the config would
      still animate — just not the machine the user is looking at — and nothing else would catch it.
- [ ] `engine/pipeline` has **zero imports** from `web`/`curriculum` and from any other engine's
      production code; the trace schema is the only shared type surface (INV-2/INV-3, mechanically
      enforced).

## Decisions to pin (fill in as steps land — seeded with the recommended answers)

**Step 1's decisions were reviewed and pinned 2026-07-16**, before any code. Eleven stood as
seeded; the halt row was **rewritten** (its seed rested on a premise that is false about the
corpus), the branch row gained `jalr`, and one decision the table was missing entirely
(intra-cycle stage & event order) was added.

**Then building it (steps 1–2, same day) forced twelve more** — the bottom block below. They are
worth reading as a group, because they say something about what a plan can and cannot know in
advance: the seeded rows are all _architecture_ (which paths exist, where branches resolve, what
`micro` holds), and every one of them survived contact with the code. The twelve added rows are
almost all _trace contract_ (`forward`'s from/to, `flush.stages`' meaning, `instructions[]`
ordering) and _clock discipline_ (what is latched vs. immediate) — the questions you cannot answer
until something has to emit a real event or a real cycle. One of them, "the clock edge", is a bug
the seed's architecture would have shipped: it was caught by hand-deriving a flush, not by any
test that existed at the time.

**Step 5 added three more** (the bottom-but-one block): where the forwarding position lives, how a
view learns a model's config, and what the transport shows when more than one instruction is in
flight. They continue the pattern the twelve started — none is architecture, all three are
_contract_ questions that only exist once something real has to render. The third was found by the
**browser eyeball**, not by a test, which is worth noting on its own: every headless net was green
and the shell was still quietly teaching the wrong thing.

**Step 6 pinned the datapath-tiering row and added one more** (the last block): what a lit datapath
does when a cycle holds five instructions. It continues the pattern exactly — architecture survived
contact (the seeded tiering lever stood), and what building forced was _contract_: which of the two
axes each unit gates on, and the fact that a hue is a property of a WIRE here rather than of the
diagram. And once again the **browser eyeball** found what no test did.

**Step 7 closed the last two open rows (map tech, follow-highlight) and added three more.** Both
seeded rows stood — but the pattern finally inverted: what building forced this time was not
contract but **an audit of the plan's own claims about the work**. The plan asserted four renderer
deltas; the honest count was **one** (two were already built, and one was obsolete rather than
pending). It asked for stage-and-lane parametricity; the honest cost was **the hue key alone**, since
stage ORDER turned out to be needed nowhere. Neither is a decision the seed got wrong — they are
questions the seed did not know it was asking, and both are the kind that only answer themselves once
the code exists. And, for the fourth step running, the **browser eyeball** found what no test did —
twice, and both only at REAL scale, which is the sharper lesson: every SNAP page (short programs) was
fine, and the defects lived on a 78-cycle corpus program.

**No rows remain `_(open)_`.**

| Decision                                      | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Pinned answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forwarding toggle in MVP                      | **Yes — both positions correct on day one.** It is the milestone's soul; retrofitting means rewriting the hazard unit. See the headline decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **Pinned as seeded**, 2026-07-16.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Register-file same-cycle WB→ID                | **Write in the first half, read in the second** (textbook P&H). Directly decides when a forward is needed at all: a distance-3 RAW needs none.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Pinned as seeded.** Needs no special case — it falls out of the reverse stage order below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Forwarding paths                              | **EX/MEM→EX and MEM/WB→EX.** EX/MEM **wins** a double match (the younger producer is the right one). **Never** forward from or to `x0` (it is hardwired zero, not a value).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **Pinned as seeded.** Enumerated, deliberately — a general "any later latch → EX" rule is a future deeper pipeline's problem, and that is a different package.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Load-use hazard                               | **Stalls one cycle even with forwarding on** — the data is not ready until MEM. The bubble that cannot be forwarded away; the pedagogical centerpiece.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **Pinned as seeded.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| RAW with forwarding **off**                   | **Interlock in ID** until the producer's WB completes (combined with the same-cycle WB→ID rule above, that is a 2-cycle stall for a distance-1 RAW). Pin the exact number in step 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **Pinned as seeded.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Branch resolution stage                       | **EX** — a 2-cycle flush, no ID comparator, and more visually dramatic than resolving early. Emit `branch-resolved` + `flush`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Pinned as seeded, extended: `jalr` resolves in EX too** — a register supplies its _target address_, not just the taken/not-taken decision (`call-return.s`'s `ret`). Branches are RAW consumers too (`sum-loop.s`'s `bnez` reads the `t0` the preceding `addi` writes); both are covered by the same EX-targeted forwarding. See step 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Branch prediction                             | **Fixed predict-not-taken.** `branchPrediction` config stays honored-`false` / `configurableBranchPrediction: false` until **M4** (§12.3 makes it a toggle _on_ this pipeline).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **Pinned as seeded.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `branch-resolved` carries `target`            | **Extend the event with `target: number`.** The datapath needs the redirect's value to label it; INV-3 says extend the schema rather than open a back door. This is that, exactly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Pinned as seeded.** The event has no `target` field today — a real schema delta, not a no-op.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Memory ports                                  | **Split I/D** (Harvard, textbook P&H) — no structural hazard. Note this _diverges from M2's single shared memory_, which is why the pipeline gets its own geometry, not a reuse.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **Pinned as seeded.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Halt semantics                                | **Architectural `pc` is the retiring instruction's `nextPc` — never the fetch pointer**, copying multi-cycle's retire arm. Fetching stops on `ecall`-in-ID _or_ the fetch pointer leaving `.text`; either way, drain and halt at the last retire, and squash the one younger instruction so no shadow **commits a MEM/WB side effect** (a redirect is harmless under this rule — it only moves the microarchitectural fetch pointer). _(The original seed — "stop fetching at `ecall` decode, drain, halt at its retire" — was **verified false about the corpus**: `add.s` has no `ecall` and halts by running off the end of text, an entirely unhandled second path.)_ | **Pinned as rewritten**, 2026-07-16 — see step 1 for the corpus evidence and why `expectEquivalent`'s `pc` assertion makes this load-bearing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `micro` / `PipelineMicro` shape               | **Fuller** — all four latches (`IF/ID`, `ID/EX`, `EX/MEM`, `MEM/WB`) with their contents, exported for the view to type against. Same call M2 made for its five latches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **Pinned as seeded — concrete four latches, _not_ an N-latch abstraction.** A longer pipeline is a future **sibling package** with its own `micro` type and its own bespoke geometry, so nothing here needs to generalize; only the step-7 map is shared, and it folds over `location`, not `micro`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `location` encoding                           | **Plain stage strings** (`"IF"`/`"ID"`/`"EX"`/`"MEM"`/`"WB"`). Superscalar later extends to `"EX.0"`/`"EX.1"` (`superscalar-visuals.md`) — keeping it a plain string is what allows that.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Pinned as seeded.** A plain string already absorbs **both** future axes with no schema change: lanes (`"EX.0"`) and deeper stage sets (`"EX1"`/`"EX2"`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Intra-cycle stage & event order               | **Process stages in reverse each cycle** (WB→MEM→EX→ID→IF), so each stage reads the latch its upstream neighbour has not yet overwritten. This fixes the **order of `events[]` within a cycle** — a trace-contract surface (INV-3/INV-6), not an implementation detail.                                                                                                                                                                                                                                                                                                                                                                                                   | **Pinned**, 2026-07-16 — added in review; the table was missing it entirely. M1/M2 never faced it (one instruction, one stage per cycle), so M3 is the first model where intra-cycle ordering exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Corpus additions                              | **None needed — verified, not assumed.** `array-sum.s` already holds the textbook load-use pair (`lw t2, 0(t0)` then `add a0, a0, t2`); every program has back-to-back RAW chains and taken branches. INV-7 stays intact.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Pinned as seeded**, 2026-07-16 — and it proved an understatement. The corpus already holds a **double-match** litmus too (`la` expands to two instructions writing one register, immediately consumed by `sw`), and `add.s` alone shows the toggle as 7 cycles vs 9. Zero fixtures added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Datapath tiering lever                        | **Structure** — `minTier` the forwarding unit, forwarding muxes, and hazard unit to `expert`, with lawful contraction wires below; plus config-driven absence when forwarding is off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Pinned as seeded**, 2026-07-16 (step 6), with two things the seed could not have known. **(a) The hazard unit is tier-gated but NOT config-gated** — it is live in both positions (load-use survives forwarding; the interlock IS the story without it), so only the forwarding unit + its muxes + the forward paths gate on config. **(b) Contraction visibility is DERIVED from `contracts`, not declared** — a contraction is drawn exactly when its unit is not, so M2's parallel `maxTier` field is dropped: the condition here is 2-D (tier AND config) and no scalar cap can express "hidden at expert-with-forwarding-off". `wbmux` tiers at `detailed` (M2's precedent); `pcmux` is drawn at every tier — the plan's lever never asked for it, and drawing the PC selector always costs no contraction wires.                                                                                                                                                                                                                                                                                                                                                            |
| Pipeline map tech                             | **HTML grid, not SVG** — scrollable, cells are follow click-targets (seeded and reasoned in `superscalar-visuals.md`; M3 is where it is pinned for real).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Pinned as seeded**, 2026-07-16 (step 7) — a CSS grid of `.seg-btn`-formula chips. All three reasons held: it is tabular, it scrolls (78 columns × 52 rows on `sum-loop`), and cells are click targets. Two things the seed could not know. **(a) The map's GATE is derived, not declared** — `hasOverlap(recorded)`, the same no-model-knowledge shape as step 5's `instructions.length > 1` rule: the map exists to show instructions overlapping in time, so it appears exactly when they do (verified live: absent on single-cycle). **(b) It needs a seam nothing before it did — the whole RECORDING.** Every prior panel is a pure function of the CURSOR's cycle; the map folds the timeline, so `useSimulator.recorded` is new — only the second consumer of a complete recording after `anchorLesson`, with the same precondition for the same reason.                                                                                                                                                                                                                                                                                                                   |
| Follow-highlight visual                       | **Dashed `--ink` outline ring** — hue-free, so it composes with stage tint and survives CVD (from `superscalar-visuals.md`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **Pinned as seeded**, 2026-07-16 (step 7): one idiom, two rules (`.dp-follow`, a halo _under_ a wire; `.follow-ring`, an outline on a map cell). Hue-free is load-bearing — it must compose with the stage hue the wire/cell already wears. **But the seed was wrong about WHERE it lands: wires only, never nodes.** `superscalar-visuals.md` put `followed?: boolean` on BOTH VMs; step 6 pinned that a component box belongs to no single instruction (the regfile is read by ID and written by WB in the same cycle), so a node counterpart cannot exist — the same reason boxes carry no hue. Two more the seed did not reach: **follow RETARGETS the transport chip and source line** (`shownInstruction`), or it would be map-local decoration; and it **clears on a new recording**, since ids are minted per FETCH and the two forwarding positions do not fetch the same shadows.                                                                                                                                                                                                                                                                                         |
| Which renderer deltas step 7 owed             | _(not in the seed — the plan said "renderer deltas 1–4 land here")_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Pinned**, 2026-07-16 (step 7): **only delta 4.** Delta 1 (hue override) already shipped as `WireVM.color` in the datapath overhaul, and delta 3 (data-driven legend) with step 6 — forward design that actually paid off. **Delta 2 (one `<marker>` per distinct hue) is OBSOLETE rather than done:** the renderer's arrowhead uses `context-stroke`, so ONE marker serves every hue AND the idle grey, and the planned "marker zoo" would have been strictly worse. Recorded because the plan asserted four deltas of work and the honest count was one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| What "stage-and-lane-parametric" costs        | _(not in the seed — it demanded parametricity without saying which part is not free)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Pinned**, 2026-07-16 (step 7): **the HUE KEY, and essentially nothing else.** The stage SET and ROW order fall out of the fold anyway, and **stage ORDER is needed nowhere** — rows×columns never consults it; only the legend lists stages, and first-seen order yields IF→WB for free. So the row/column model really does absorb both future axes with no API change, exactly as `superscalar-visuals.md` claimed. The one thing bought is `stageFamily` (`EX.0`→`EX`, `IF2`→`IF`), so a 7- or 12-stage model reuses the five validated hues instead of inventing any. Proven by **hand-built traces**: no engine we ship emits either axis, so a test against our own engine would prove the map parametric exactly where it already is.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| The map needs its own cap                     | _(not in the seed — it said "scrollable" and stopped there)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **Pinned**, 2026-07-16 (step 7), found in review: **`MAX_MAP_CYCLES = 400`, paging — for the same reason `TEACHING_MAX_CYCLES` exists, one layer down.** The engine cap stops a runaway sandbox program freezing the tab while RECORDING; the map could freeze it while DRAWING a recording that cap had already passed, because the grid declares explicit tracks and costs cycles × rows however sparse the cells are. `li t0, 500` — seconds to type — is 3,007 cycles × 2,001 rows ≈ **6M grid areas / 2.2 MB**, and the cap allows 16× more. Quantized to PAGES, not centred on the cursor (a window that recentred every scrub slides the grid under the reader; a page boundary is a thing you can point at); a pure function of the cursor, with the fold left whole and oblivious (INV-2). 400 is far above the whole corpus (`sum-loop` = 78), so **paging is strictly a sandbox affordance** — pinned by a test. **Pages, never truncates:** the header states the window AND the total, and the ruler keeps ABSOLUTE cycle numbers so the map cannot disagree with the scrub bar. Worst case the engine cap allows (48,010 × 32,002): fold 48 ms, render 86 ms, 303 KB. |
| M2 step 5c dependency                         | **None — M3 neither needs nor reopens it.** The pipeline's redirect is sourced from `branch-resolved` + `flush`, which are honest trace signals; M2's problem does not recur here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Pinned as seeded**, 2026-07-16. Confirmed by construction in step 1: the pipeline's redirect is sourced from `branch-resolved` (now carrying `target`) + `flush`; 5c was never consulted, needed, or reopened.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `forward` from/to encoding                    | _(not in the seed — the schema types both as bare `string`)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **Pinned**, 2026-07-16: `from` names the SOURCE LATCH (`'EX/MEM'` \| `'MEM/WB'`), `to` names the DESTINATION PORT (`'EX.rs1'` \| `'EX.rs2'`), `instr` is the CONSUMER. Per-port, because the two muxes are independent — one instruction can take rs1 from MEM/WB and rs2 from EX/MEM in the same cycle (`add.s` does exactly that). The producer is derivable from `instructions[]`, so naming the latch loses nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `stall` / `flush` reasons                     | _(not in the seed)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Pinned**, 2026-07-16: `stall.reason` is `'load-use'` \| `'raw'`, always with `stage: 'ID'`. `flush.reason` is `'branch-taken'` \| `'halt'`. Note `'load-use'` fires ONLY with forwarding on — with it off the general interlock subsumes it and honestly reports `'raw'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `flush.stages` semantics                      | _(not in the seed)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Pinned**, 2026-07-16 — and **reversed on review before it shipped.** The first cut said `stages` names the latches the flush SIGNAL is asserted on, occupied or not. That is defensible about hardware and wrong about this trace: `flush` is a SHARED surface with three readers (datapath, the map's cut rows, and the curriculum, which triggers on a bare `{ event: 'flush' }`), and an `ecall` at the end of text — **three of the five corpus programs** — would have emitted a flush that killed nothing, letting a lesson announce a bubble that never happened. Pinned instead: **`flush` reports real casualties** (program order, oldest first) and a flush that kills nobody emits **no event**. Documented in `schema.ts`, where consumers actually look — not in one engine's source. This also fixes WHERE it is emitted: at the clock edge, since IF (last in the walk) is the only stage that knows whether it had anything to lose.                                                                                                                                                                                                                             |
| `instructions[]` ordering                     | _(not in the seed)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Pinned**, 2026-07-16: **program order, oldest (nearest retirement) first** — WB→MEM→EX→ID→IF in the steady state. A stable ordering RULE, not a positional one, so it survives the models that come later: with two lanes in EX, "oldest first" is still well defined where "stage order" is not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| What a stall does to IF                       | _(not in the seed)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Pinned**, 2026-07-16: the younger instruction is **held in the IF stage** (the repeated `IF IF` cell of every textbook diagram), not left un-fetched and not re-fetched. Re-fetching would emit a second `instr-fetch` and mint a second id for one instruction — a direct INV-4 violation. This is why the model needs an IF-stage occupant distinct from the IF/ID latch: five stages, four latches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| The clock edge                                | _(not in the seed)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Pinned**, 2026-07-16 — **found by hand-derivation, after a first cut got it wrong.** The PC redirect (EX) and the fetch-stop (ID) are CLOCKED, staged in the cycle context and applied after the walk — exactly like the latches. IF must fetch first and be squashed after. Poking them mid-walk makes IF fetch from the redirected pointer, so a taken branch cuts ONE row instead of two and an `ecall`'s shadow never exists to be squashed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Latch mutability                              | _(not in the seed)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Pinned**, 2026-07-16: latch objects are **immutable and rebuilt every cycle**, so copying the container gives each recorded cycle its own `micro`. This is the same independent-snapshot contract `registers`/`memory` have. Conformance is structurally blind to a violation (it reads only the last cycle); it would surface as latest-values-everywhere in step 4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Bubble representation                         | _(not in the seed)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Pinned**, 2026-07-16: a bubble is a **`null` latch**, not a synthesized nop instruction. Bubbles therefore never appear in `instructions[]` — a stall is legible as a repeated `location`, which is what the step-7 map wants anyway.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `rd = 0` means two things                     | _(not in the seed)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Pinned**, 2026-07-16: the latched `rd` is `0` for BOTH "writes no register" and "writes x0", deliberately — a write to x0 is discarded, so one value says both and every `rd !== 0` test gets "never forward from x0" for free. It is computed from an enumerated `WRITES_RD` set, **never** from `decoded.rd`, whose bits are part of the immediate on an S/B word.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `jal` resolution                              | **Extends the branch row.** Resolve `jal` in EX too, uniform with `jalr`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Pinned**, 2026-07-16 — the gap the seeded table left. "Resolve all control in EX, no ID comparator" already answers it: `jal` emits `branch-resolved` (`actual: true`) + a 2-instruction flush like any taken transfer. There is deliberately no BRANCHES set in the code — "is this a transfer" is just whatever EX resolved a `taken` answer for, which is what makes jal/jalr fall out as ordinary rather than special.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `branch-resolved` on NOT-taken                | _(not in the seed)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Pinned**, 2026-07-16: it fires for **every conditional branch**, taken or not (`target` = the fall-through `pc + 4` when not taken); only a taken one also emits `flush`. More honest about what the branch unit did, and it gives step 3's timing tests and step 8's lesson a resolution event to anchor to on both paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Timing pins are a DERIVATION                  | _(not in the seed — it asked only for "a pinned cycle-count table")_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **Pinned**, 2026-07-16 (step 3): the table states **N, T and a pc→cycles stall histogram** per (program, config), and cycles are asserted as **`N + 4 + S + 2·T`** — a closed form summed from the pinned rules, not a number read off a run. Each term is asserted separately against the events that define it: a lone total lets a compensating over-S/under-T pair pass and localizes nothing. `N` and `T` are config-invariant ⇒ `cycles_off − cycles_on = S_off − S_on` is the whole thesis as arithmetic. Placement lives in the histogram (not a second count) so the two cannot drift; keyed by **pc, not cycle**, so a loop's recurring stall stays one hand-checkable entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Forwarding is not always faster               | _(not in the seed — which implied the crown jewel held generally)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Pinned**, 2026-07-16 (step 3): `call-return.s` is **17 cycles in BOTH positions** (S = 0 either way — every RAW is separated by a flush gap, which charges the +2 the interlock would have). The crown jewel is asserted on the **four RAW-chained programs**, and call-return's equality is asserted as its own `it()`. Weakening the claim to `≤` across the corpus instead would pass for a pipeline where forwarding did nothing — and the mutation run proves it matters: call-return is one of the two ON cases that **passes** under the over-stalling mutation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Which edge `micro` is snapshotted at          | _(not in the seed — the latch rows say what `micro` HOLDS, neither says WHEN it is read)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Pinned**, 2026-07-16 (step 4): `state.micro` is the **END-of-cycle** latch state — committed at the clock edge, i.e. what the latches present to the NEXT cycle. So `micro` at cycle `i` names the instructions `instructions[]` places in **ID/EX/MEM/WB at cycle `i+1`**, while `instructions[]` at cycle `i` reports who occupied each stage DURING cycle `i` (read from the pre-edge latches). The two are one cycle apart, deliberately and unavoidably — and a view that conflates them draws the pipe one cycle ahead of itself. Load-bearing for steps 6–7, which read `micro`. Asserted across a whole corpus recording, and it is what makes latch aliasing visible at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Where the forwarding position lives           | _(not in the seed — it named the control, not the state)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Pinned**, 2026-07-16 (step 5): **session-level, handed to EVERY model**, not per-model state — a config-blind engine is unmoved by it (pinned by test), so one value is correct for all three and it survives a trip through single-cycle (confirmed in the browser). It persists across model switches and defaults to **off**, because the pedagogically right opening move is to watch a RAW hazard stall first, THEN flip it on (§12.2). Only the CONTROL is gated (on `capabilities.configurableForwarding`) — absent, not disabled, where nothing would move.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| How the view learns a model's config          | _(not in the seed)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Pinned**, 2026-07-16 (step 5): `ModelChoice` carries the engine's **own exported `*_CAPABILITIES` constant** — the very object its instances return — so the shell can gate config controls **without instantiating an engine**. Not a back door (INV-3): `capabilities` is part of the `Processor` interface declared in `trace`, and exists precisely to "let the UI light up only the relevant panels". Guarded by a test asserting `make().capabilities` **by identity** (`toBe`), since the real failure mode is a copy-pasted row pairing one model's flags with another's engine — which flag-equality would not catch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| What the transport shows when >1 is in flight | _(not in the seed — every prior model had exactly one)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **Pinned**, 2026-07-16 (step 5) — **found by the browser eyeball, not by a test.** `instructions[0]` is the OLDEST (retiring) instruction, so the shell's chip and source highlight lag the fetch by up to four stages. Lawful omission (INV-5), not contradiction — but _misleadingly complete_, since the header promises five and the display shows one. Pinned: **qualify the shown instruction exactly when `instructions.length > 1`** ("in WB · 5 in flight"), a rule with **no model knowledge** in it — single-cycle/multi-cycle always carry one so it never appears for them; the pipeline qualifies itself from the trace (INV-3). Showing all five remains the step-7 map's job. Second finding: **forwarding also FILLS the pipe** (`sum-loop` carries 4 live off, 5 on — a bubble is a null latch, absent from `instructions[]`); scoped to `sum-loop`, since `array-sum`/`call-return` reach five in both and `add.s` (3 instructions) reaches five in neither.                                                                                                                                                                                                     |
| What a lit datapath does with 5 in flight     | _(not in the seed — every prior model lit ONE instruction's path, so "the lit slice" had one color by construction)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **Pinned**, 2026-07-16 (step 6): the **hue is a property of the WIRE, not the diagram** — each lit wire carries `{ instr, stage }` and is stroked in its stage's hue, so five instructions read left-to-right in one cycle. **Component boxes are hue-NEUTRAL**, and that is forced, not lazy: the register file is read by ID and written by WB in the SAME cycle (the same-cycle WB→ID rule), and every latch bar is written by the stage on its left while the stage on its right reads it — there is no one stage such a box belongs to. Wires are unambiguous (each lies on one side of one bar). Needed **no renderer change**: `NodeVM` never had a color. Corollary, mutation-checked: **a forward DARKENS the register-file path** into its mux — forwarding is a change of path, not an extra wire, or the diagram draws the stale value flowing into the ALU beside the fresh one.                                                                                                                                                                                                                                                                                       |
| Datapath label placement vs. the latch bars   | _(not in the seed — nothing before this had a 360px-tall component)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **Pinned**, 2026-07-16 (step 6) — **found by the browser eyeball; every headless net was green.** The shared renderer de-collides a value label by nudging it **vertically** until it clears every box; that works in M1/M2 because their boxes are short. A **latch bar is 360px tall, so a label overlapping its x-range has no clear y at all** and parks on top of it, unreadable. Pinned: **the canvas width is set by the LABELS, not the boxes** — every gap where a 32-bit hex label lands beside a bar is sized (~80px) to hold it. Plus: label a value **once**, where it is the question — the pc was printed 3× in the tightest band (selector→memory→adder all carry it) and the encoding twice. Commented at `CANVAS`, since "those gaps look too wide" is the exact tidy-up that would break it.                                                                                                                                                                                                                                                                                                                                                                     |
| `ebreak` / unknown words                      | _(not in the seed; the halt row says only `ecall`)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Pinned**, 2026-07-16: identical to `ecall` — one `isArchHalt()` predicate, used by BOTH ID (to stop fetching) and EX (to latch `halt`), so the two can never disagree. Mirrors the reference's `default:` arm: `decode` never throws, so an unknown word must halt loudly rather than silently advance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
