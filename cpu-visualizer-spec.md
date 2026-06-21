# CPU Visualizer — Development Handoff Specification

_A pedagogical processor simulator: load and run RISC-V programs and watch how a CPU
actually works — data movement, hazards, forwarding, caches, branch prediction — across
a family of microarchitectures from a single-cycle datapath up to an out-of-order
superscalar core._

---

## How to use this document

This is the design contract for the project, written for both the developer and the
Claude Code agent doing the implementation. It captures **what to build, in what order,
and — critically — why**, because the "why" is what keeps a thousand small implementation
decisions aligned with the design.

Two things in here are load-bearing and should be treated as hard constraints rather than
suggestions: the **architectural invariants** (§3) and the **trace schema** (§5). Almost
everything else hangs off those two. If a proposed change would violate an invariant, stop
and surface it rather than working around it.

Development starts at **Milestone 1** (§11). Earlier sections are the context needed to
build M1 correctly and to avoid painting later milestones into a corner.

---

## 1. What this is, and what it is not

**It is** a tool whose real product is _pedagogical clarity_, not simulation realism. The
state being simulated is tiny by CPU standards (a few dozen registers, a modest memory, a
handful of buffers). The hard part is not the simulation — it is making the simulation
_teach_.

**It is not** a gate-level or cycle-accurate-to-real-silicon simulator. We deliberately
model an idealized, textbook-style machine. Fidelity to a real chip is a non-goal where it
costs clarity (see §10, Non-goals).

The audience is **hobbyists and self-learners with no upper skill ceiling** — a curious
beginner and an expert should both get value from the same tool, by traveling along two
independent difficulty axes (§4).

---

## 2. Core product concepts

Three concepts recur throughout and are worth fixing in vocabulary now:

- **The model family.** We build several _distinct_ microarchitectures, not one
  configurable machine that morphs from a microcontroller into a superscalar core. These
  have fundamentally different execution semantics — "where is this instruction right now?"
  has a different answer in a single-cycle datapath, an in-order pipeline, and an
  out-of-order core. They are unified not by shared internals but by a **shared ISA and a
  shared library of example programs**: the headline experience is "watch this exact loop
  run on five different processors."

- **The two axes** (§4): _microarchitecture tier_ (which machine) and _explanation depth_
  (how much detail is revealed). These are **orthogonal** and must stay orthogonal in both
  the UI and the code.

- **The platform/content split.** The simulator is a _platform_; lessons and example
  programs are _content_ authored as data on top of it. This mirrors the engine/view split
  and is what lets lessons be added (eventually by users) without recompiling.

---

## 3. Architectural invariants (do not violate)

These are the constraints that, if quietly broken, poison the project. They should hold at
every milestone.

- **INV-1 — The engine is pure and deterministic.** Same program + same config ⇒ identical
  trace, every run. No wall-clock time, no ambient randomness. If a future model needs
  randomness (e.g. a randomized cache replacement policy), it must be explicitly seeded and
  the seed is part of the config.

- **INV-2 — The engine is oblivious to rendering and to depth tiers.** It always emits
  full-fidelity, expert-complete state and events. It never knows what tier the user is
  viewing. Depth is purely a property of _rendering and narration_.

- **INV-3 — The trace is the only contract.** Views and curriculum read the trace; they
  never reach into engine internals. If a view needs something, that something becomes part
  of the trace schema (§5) — it does not become a back-door accessor into the engine.

- **INV-4 — Every in-flight instruction has a stable ID** for its entire lifetime, from
  fetch to retire. This is what makes "follow this instruction through the pipeline / the
  reorder buffer" possible, and what lets the UI track one instruction across cycles.

- **INV-5 — Lawful simplification: a lower depth tier may _omit_ detail but must never
  _contradict_ a higher tier.** The test: when a learner climbs a tier, prior understanding
  must be _refined_, never _unlearned_. (Example in §4.) This is an authoring/review
  discipline, not something the type system enforces — but it is non-negotiable.

- **INV-6 — Lesson annotations anchor to trace _events_, not to absolute cycle numbers.**
  "When the first load-use hazard occurs, pause and explain" — not "at cycle 7." This keeps
  lessons valid across small program edits and across model variations.

- **INV-7 — All models share one ISA, one assembler, one example-program library.** A new
  microarchitecture must run the existing programs unchanged.

- **INV-8 — Every model is differentially tested against the golden reference** (§9) on
  final architectural state. A subtly wrong forwarding path teaches something false; this is
  the defense against that.

---

## 4. The two axes (and how depth tiering works without becoming a maintenance hell)

The word "tier" means two different things; keep them named apart in code and UI.

**Axis A — Microarchitecture tier** (which machine is running):

> single-cycle → multi-cycle → classic 5-stage pipeline → +caches & branch prediction →
> in-order superscalar → out-of-order (Tomasulo / ROB / register renaming)

**Axis B — Explanation depth** (how much is revealed about whatever machine is running):

> `essentials` → `detailed` → `expert`

These are independent. A beginner should be able to look at the out-of-order core at
`essentials` depth and see a clean story; an expert should be able to look at the trivial
single-cycle datapath at `expert` depth and see every control line. The product is a
**matrix of (model × depth)**; most learners travel roughly diagonally, but because the axes
are independent, **never bake depth assumptions into a model or model assumptions into the
depth system.** Two separate dials in the UI; two separate concerns in the code.

**How depth tiering is implemented — "compute everything, reveal progressively":**

The engine always produces full, expert-complete state and trace (INV-2). Depth is applied
downstream, and it splits across three layers:

1. **Structural detail** — how many components the datapath _view_ draws (a clean box vs.
   one exposing every mux, the hazard-detection unit, control lines). Lives in the **view**.
2. **Representational fidelity** — whether a phenomenon is shown abstractly or
   mechanistically. Also lives in the **view**.
3. **Explanatory depth** — the prose. Lives in the **curriculum/annotation** layer.

Two disciplines keep this survivable:

- **Fix the tier count at three.** Resist a continuous slider or N levels — every tier
  multiplies authoring burden. Three well-crafted tiers beat seven mediocre ones.
- **Lawful simplification (INV-5).** The canonical worked example is **forwarding**: at
  `essentials` depth, draw an arrow showing the value skipping ahead to the next instruction
  (true, just abstract); at `expert` depth, reveal the forwarding mux, its select line, and
  the hazard unit that drives it. The beginner's mental model survives intact — it only
  gains machinery.

**Suggested mechanism (refine during implementation):** view elements carry a `minTier`; the
renderer shows elements whose `minTier ≤` current tier. Annotations carry up to three text
variants and the renderer shows the highest available variant `≤` the current tier.

---

## 5. The trace schema — the linchpin

This is the contract every view and every lesson hangs off (INV-3). Design it carefully; it
is the thing most expensive to get wrong. The principle: **emit not just state, but the
_transactions_ that happened this cycle** — a value was forwarded, a stall was inserted, the
pipeline was flushed, the cache missed. Those transactions are the hooks the curriculum binds
to (INV-6) and the things the animation layer brings to life.

The following are **illustrative TypeScript sketches to anchor implementation, not frozen
APIs.** Expect to refine field names and event payloads as real views consume them. What
should _not_ change is the shape: per-cycle full state + an ordered list of typed events,
with stable instruction IDs throughout.

```ts
// One tick of the machine. The engine returns this from step().
interface CycleTrace {
  cycle: number; // monotonic, starts at 0
  state: MachineState; // FULL snapshot AFTER this cycle (enables time-travel)
  events: TraceEvent[]; // ordered transactions that happened DURING this cycle
  instructions: InstructionInstance[]; // every in-flight instruction this cycle
}

interface MachineState {
  pc: number;
  registers: Int32Array; // 32 GPRs for RV32I; x0 hardwired to 0
  memory: MemoryView; // sparse / region-based; see note below
  halted: boolean;
  micro?: ModelSpecificState; // pipeline latches, ROB, reservation stations, etc.
}

// Each in-flight instruction, tracked by stable id (INV-4) for its whole lifetime.
interface InstructionInstance {
  id: string; // stable across cycles
  pc: number;
  encoding: number; // the 32-bit machine word
  sourceLine: number | null; // maps back to the assembly the user wrote
  decoded: DecodedInstruction; // opcode, operands, immediate, etc.
  location: string; // where it is NOW: "single-cycle" | "IF" | "ID" | ... | "ROB#3"
}

// Events are a discriminated union on `type`. Non-exhaustive starter taxonomy:
type TraceEvent =
  | { type: 'reg-read'; reg: number; value: number; instr: string }
  | { type: 'reg-write'; reg: number; value: number; instr: string }
  | { type: 'alu-op'; op: string; a: number; b: number; result: number; instr: string }
  | { type: 'mem-read'; addr: number; value: number; instr: string }
  | { type: 'mem-write'; addr: number; value: number; instr: string }
  | { type: 'instr-fetch'; instr: string; pc: number; encoding: number }
  | { type: 'instr-retire'; instr: string }
  // --- the pedagogically important ones (mostly fire from the pipeline tier onward) ---
  | { type: 'forward'; from: string; to: string; value: number; instr: string }
  | { type: 'stall'; reason: string; stage: string; instr: string }
  | { type: 'flush'; reason: string; stages: string[] }
  | { type: 'branch-resolved'; instr: string; predicted: boolean; actual: boolean }
  | { type: 'cache-access'; level: number; addr: number; hit: boolean; evicted?: number };

// OPTIONAL but recommended: a phase ordinal so the UI can sequence the reveal WITHIN a
// single cycle (fetch → decode → execute → memory → writeback) even though physically it
// is one tick. The sub-cycle phases are a useful pedagogical fiction.
interface PhasedEvent {
  phase: number; /* ...event fields */
}
```

Notes:

- **Memory representation.** Do not snapshot all of address space every cycle. Use a sparse
  map or a small set of defined regions (text, data, stack). The view shows a windowed/diffed
  view of memory, not the whole thing.
- **`ModelSpecificState`** is where each microarchitecture parks its extra structures
  (pipeline latch contents `IF/ID`, `ID/EX`, `EX/MEM`, `MEM/WB`; later the ROB, reservation
  stations, rename table). The base `MachineState` (PC + registers + memory) is common; this
  is the per-model extension.
- For the **single-cycle** model (M1), the trace is simple: one instruction enters and
  completes per cycle, and `events` is just that instruction's read / ALU / mem / write
  transactions. But the schema is already shaped to carry the pipeline tier, so it won't need
  redesigning.

---

## 6. The engine interface and time-travel

Each microarchitecture implements one interface, so the UI is model-agnostic and new tiers
slot in over time without front-end rewrites:

```ts
interface Processor {
  reset(program: AssembledProgram, config: ProcessorConfig): void;
  step(): CycleTrace; // advance exactly one cycle; return what happened
  getState(): MachineState; // current full state
  isHalted(): boolean;
  readonly capabilities: ProcessorCapabilities; // which views/features this model supports
}

interface ProcessorConfig {
  forwarding: boolean; // pipeline tier+; irrelevant to single-cycle
  branchPrediction: 'none' | 'static-taken' | 'static-not-taken' /* | ... */;
  cache: CacheConfig | null;
  seed?: number; // only if a model needs determined randomness
}
```

**Reversibility comes for free — exploit it; most simulators lack it.** Because per-cycle
state is tiny (INV-1 guarantees determinism), do **not** build stepping-backward into the
engine. Instead, a thin **driver/recorder** wraps the engine and keeps an array of every
`CycleTrace` emitted (each already contains a full state snapshot):

- "Current cycle" is just an index into that array.
- Step **back** / **scrub** = move the index and restore the snapshot at that position.
- Step **forward** beyond what's recorded = call `engine.step()` and append.

This gives free time-travel and a scrubbable timeline. For learning, going _backward_ and
jumping straight to "the cycle where the hazard occurred" is gold. Do **not** bother with
delta/keyframe cleverness initially — snapshot everything.

This driver is also where the "**follow this instruction**" feature lives: given a stable
instruction id (INV-4), it can locate that instruction's `location` in each recorded trace
and let the UI track its whole journey.

---

## 7. ISA: RISC-V RV32I

Use **RISC-V RV32I**. Rationale: clean and orthogonal; free and well-documented; what new
courses actually teach (it is displacing MIPS, including in Patterson & Hennessy); and the
fixed 32-bit instruction width makes fetch/decode trivial to visualize. The base integer set
is roughly 40 instructions — tractable.

The ISA layer is **shared infrastructure**: instruction definitions, field encodings, and a
decoder, all framework-agnostic and used by the assembler, every engine model, and the
golden reference.

---

## 8. The assembler (don't under-scope it; don't gate learning on it)

"Load / edit and execute" implies a real RV32I assembler, which is easy to under-scope.
Requirements:

- Parse RV32I assembly: the base integer instructions, labels, and basic directives
  (`.text`, `.data`, `.word`, etc.).
- Support common **pseudo-instructions** (`li`, `mv`, `j`, `nop`, …). These are
  pedagogically valuable — show how they expand into real instructions.
- **Good error messages** with line/column.
- Produce: machine code (32-bit words), a **source-map** (instruction address ↔ source line,
  feeding `InstructionInstance.sourceLine`), and a symbol table.

```ts
interface AssembledProgram {
  words: Uint32Array; // the machine code
  sourceMap: Map<number, number>; // address -> source line
  symbols: Map<string, number>; // label -> address
  data: { addr: number; bytes: Uint8Array }[]; // initialized data segments
}
```

**Free teaching win:** display the assembled machine code next to the source, so learners
_see_ the encoding and how fetch/decode pull it apart.

**Crucial framing:** the subject is the _CPU_, not assembly programming. A beginner must not
have to write a line of assembly to start watching a pipeline work. Ship a library of
well-commented example programs as the default entry point (these double as test fixtures,
§9). Writing your own program is a step _up_, not the gate in.

---

## 9. Correctness strategy: golden reference + differential testing

Correctness is the failure mode that quietly invalidates everything — a wrong forwarding path
teaches a falsehood. Defense:

1. **Write a dead-simple golden-reference interpreter first** — pure fetch / decode /
   execute, no microarchitecture, no pipeline. Its only job is to be obviously correct.
2. **Differential testing:** for every example program, each fancy model's _final
   architectural state_ (registers + memory) must equal the reference's. Microarchitecture
   changes timing and internal movement, never the final result of a correct program.
3. **The example programs are the test fixtures.** Every demo program is also a correctness
   test. (And they are the free-play library, §12, and the lesson fixtures, §13 — one corpus,
   three jobs.)

Keep all of this headless and unit-testable, with no UI in the loop.

---

## 10. Non-goals (the realism trap — decide what you will _not_ model)

Real CPUs have endless rabbit holes that mostly _subtract_ from teaching clarity. Explicitly
out of scope, at least initially:

- Virtual memory, TLBs, MMUs, page tables.
- Interrupts, exceptions beyond what a teaching example needs, privilege modes.
- Hardware prefetchers and other "realistic but confusing" optimizations.
- Cycle-accuracy or microarchitectural fidelity to any real shipping chip.
- OS, syscalls beyond a minimal halt / print convention for examples.
- Multi-core / coherence (revisit only far down the line, if ever).

When in doubt, prefer the idealized textbook machine over the realistic one.

---

## 11. Milestone 1 — the first vertical slice

**Goal:** prove the entire stack — ISA → assembler → engine → trace → driver → view →
depth-tiering → curriculum — end-to-end on the _simplest_ microarchitecture, before a second
model exists. (In a single-cycle datapath each instruction completes before the next starts,
so there are no hazards — that is exactly why it is the right first model: minimal
microarchitecture, full pipeline of _project plumbing_.)

### Scope

- RV32I **assembler**: full base integer set + common pseudo-instructions + `.data`/`.word`
  - labels, with source-map and decent errors.
- **Golden-reference interpreter** (§9).
- **Single-cycle processor model** implementing the full datapath semantics, behind the
  `Processor` interface (§6).
- **Trace recording + driver**: step forward, step backward, scrub to any cycle (§6).
- **One datapath view** — the canonical single-cycle RISC-V datapath — rendered in SVG, with
  the **three depth tiers** working on it.
- **Within-cycle phase sequencing** of the animation (fetch → decode → execute → memory →
  writeback), driven by trace events.
- Supporting panels: **source ↔ machine-code**, **register file**, **memory**.
- **2–3 authored lessons** in the declarative lesson format (§13), with event-anchored
  annotations.
- A **small library of example programs** (also the test fixtures).

### Suggested build order (each step testable before the next)

1. `isa` — instruction definitions, encodings, decoder.
2. `assembler` — produce `AssembledProgram`; unit-test encodings.
3. `engine/reference` — golden interpreter.
4. `engine/single-cycle` — first model behind `Processor`.
5. `trace` types + **driver/recorder** with forward/back/scrub.
6. **Differential tests**: reference vs single-cycle on all example programs.
7. `web` shell — load a program, drive the engine, show panels.
8. SVG **datapath view** wired to trace events.
9. **Depth-tier** rendering on the datapath view (3 tiers).
10. `curriculum` — lesson format + runner + event-anchoring.
11. Author the **2–3 lessons**; wire sandbox-fork on edit.

### Acceptance criteria

- [ ] Assembler correctly assembles every example program; a handful of known-good encodings
      round-trip exactly.
- [ ] For **every** example program, single-cycle final register + memory state **equals**
      the golden-reference final state (INV-8).
- [ ] User can load an example, step forward to completion, step **backward** to the start,
      and **scrub** to any cycle; the state shown always matches the recorded trace at that
      cycle.
- [ ] Switching depth tier changes datapath detail and narration **without changing engine
      behavior** and without violating lawful simplification — nothing shown at a lower tier
      contradicts a higher tier (INV-5).
- [ ] The 2–3 lessons play through: annotations fire on the **correct events** (INV-6).
- [ ] Editing the program mid-lesson **forks into a sandbox** (lesson annotations detach), and
      the sandbox run still animates correctly.
- [ ] The `engine` package has **zero imports** from `web` or `curriculum`; the trace schema is
      the only shared type surface between engine and the rest (INV-2, INV-3).

---

## 12. Roadmap beyond M1

Each tier reuses the same ISA, assembler, example programs, and trace/driver/view plumbing —
that reuse is the whole point of the M1 architecture.

1. **Multi-cycle** model — introduces the idea that instructions take varying numbers of
   cycles; still in-order, still one at a time.
2. **Classic 5-stage pipeline** — _the_ high-value tier. This is where hazards, forwarding,
   stalls, and flushes live. The `forward` / `stall` / `flush` / `branch-resolved` events
   from §5 finally fire for real. The flagship experiments live here: "watch a RAW hazard
   stall without forwarding; turn forwarding on and watch the bubble vanish." A
   beautifully-done version of _this tier alone_ is already a strong product.
3. **Caches & branch prediction** — feature toggles on the pipeline. Note: cache behavior only
   becomes visible with programs that **loop over arrays**; toy programs won't stress it, so
   the example library needs array-walking programs to make hits/misses/evictions show.
4. **In-order superscalar** — multiple instructions per stage.
5. **Out-of-order (Tomasulo / ROB / register renaming)** — the north star and the genuine
   cliff. Getting renaming, the reorder buffer, and reservation stations both _correct_ and
   _clearly visualizable_ is a major undertaking on its own. Do **not** approach it until the
   in-order experience is completely nailed. The stable-instruction-id design (INV-4) and the
   "follow this instruction" feature pay off most here, where instructions complete out of
   order and retire in order.

The **flagship interaction across all tiers** is flipping forwarding / prediction / caching on
and off and watching the _same program_ change behavior. That is where understanding clicks.

---

## 13. The curriculum / lesson system

Lessons are **declarative data the engine does not compile against** (§2, platform/content
split). This makes the simulator a platform with content on top, and eventually lets users
author lessons without recompiling.

A lesson is, roughly:

```ts
interface Lesson {
  id: string;
  title: string;
  program: string;               // the assembly to load (or a reference into /programs)
  model: string;                 // which microarchitecture
  config: ProcessorConfig;       // feature toggles (forwarding on/off, etc.)
  depthDefault: DepthTier;
  steps: LessonStep[];
}

interface LessonStep {
  // Anchored to an EVENT, not a cycle number (INV-6):
  trigger: { event: TraceEvent['type']; nth?: number; where?: /* predicate on payload */ };
  // Narration, with per-depth-tier variants (lawful simplification, INV-5):
  narration: Partial<Record<DepthTier, string>>;
  highlight?: string[];          // view elements / instruction ids to emphasize
}
```

Anchoring annotations to **events** (e.g. "the first `stall` event", "the first `cache-access`
with `hit: false`") rather than absolute cycles is what keeps a lesson valid when the user
tweaks the program, and lets one authored experiment work across program variations. This is
the concrete payoff of emitting _transactions_ in the trace (§5).

### Programs, configs, lessons, and the sandbox (your decisions, encoded)

- **Example programs serve in both roles:** they are lesson fixtures _and_ a free-play library
  loadable into any model at any depth outside the guided track. (They are also the §9 test
  fixtures.) Model the relationship as: a _program_ is independent data; a _lesson_ references
  a program + a config + a model + an ordered set of event-anchored steps. Free-play = a
  program + a model + a config with no lesson steps attached.
- **Edits fork into a sandbox.** When a user is mid-lesson and edits the program, the lesson's
  event-anchored annotations **detach** and the user drops into free-play on the edited
  program (same model/config, no guided steps). The lesson is not destroyed — it can be
  resumed on the original program. (Event-anchoring makes re-attaching to an edited run
  _technically_ possible, but the chosen UX is to fork, not to re-anchor.)

---

## 14. Tech stack

- **Language:** TypeScript across the whole repo. One language end-to-end makes iteration with
  Claude Code dramatically easier and lets the engine, assembler, trace, and curriculum be
  unit-tested headlessly.
- **UI:** React.
- **Datapath rendering:** **SVG**. Values bind naturally to elements, and wires/arrows animate
  cleanly — ideal for datapath diagrams. **Hand-author the datapath layouts** rather than
  auto-generating them; procedural circuit layout is a rabbit hole and the canonical diagrams
  are fixed anyway. (When building the UI, consult frontend-design guidance for visual
  direction — the datapath is the product's face.)
- **A WASM core (Rust/Go)** only earns its keep if you later want performance or stronger
  correctness guarantees; teaching-scale does not demand it. Defer.

### Suggested repository layout (monorepo)

```
/packages
  /isa            — RV32I definitions, encodings, decoder        (framework-agnostic)
  /assembler      — assembly → AssembledProgram                  (framework-agnostic)
  /engine
    /reference    — golden interpreter                           (framework-agnostic)
    /single-cycle — first model                                  (framework-agnostic)
  /trace          — CycleTrace types (THE contract) + driver/recorder
  /curriculum     — lesson format types, runner, event-anchoring (framework-agnostic)
  /web            — React app, SVG views, depth-tier renderer     (depends on all above)
/content
  /programs       — example .s files   (free-play library + lesson fixtures + tests)
  /lessons        — authored lesson data
```

Everything except `web` is framework-agnostic and headlessly testable. `web` depends on the
rest; the rest never depend on `web` (INV-2, INV-3).

---

## 15. Prior art to study

- **Ripes** — a graphical RISC-V simulator with pipeline and cache visualization. The closest
  existing thing; study it both for inspiration and to decide deliberately how this project
  differs (the depth-tiering matrix and the guided-lesson platform are the obvious
  differentiators).
- **MARS / SPIM** — MIPS assembler/simulators; reference points for the assembler UX.
- **EduMIPS64** — educational MIPS pipeline simulator.
- **Logisim** — gate-level; a _different_ goal, but useful as a contrast for what we are
  deliberately _not_ doing.

---

## 16. Open questions to revisit (not blockers for M1)

- Exact pseudo-instruction set and directive coverage for the assembler.
- Halt / print convention for example programs (a minimal syscall-like mechanism).
- Precise mechanism for tagging view elements with `minTier` and resolving narration variants
  — pin down once the first real datapath view is consuming it.
- Whether multi-cycle (tier 2) is worth building as its own model or folded as a stepping
  stone — decide after the 5-stage pipeline design is sketched.
- Branch-prediction scheme menu and cache-config surface — defer to the cache/prediction tier.

---

_End of handoff specification. Start at §11. Treat §3 (invariants) and §5 (trace schema) as
hard constraints; surface any conflict rather than working around it._
