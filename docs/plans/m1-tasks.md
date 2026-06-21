# Milestone 1 — task checklist

The first vertical slice: prove the entire stack end-to-end on the **single-cycle** model.
Source of truth for scope and acceptance is `cpu-visualizer-spec.md` §11. This file tracks
progress and the small decisions taken along the way.

## Build order (spec §11)

Each step should be testable before the next.

- [x] **0. Scaffold** — monorepo (npm workspaces), TypeScript project references, Vitest,
      ESLint with dependency-boundary rules, Prettier, CI, and a real RV32I decoder seed in
      `isa` proving the toolchain end-to-end.
- [ ] **1. `isa`** — full instruction definitions, field encodings, and decoder (~40 base
      RV32I instructions). _Seed exists: field extraction + sign-extended immediates + a
      representative subset (`addi`, `add`, `sub`, `lw`, `sw`, `beq`, `bne`, `lui`, `jal`, …)._
- [ ] **2. `assembler`** — parse RV32I + labels + `.text`/`.data`/`.word`, common
      pseudo-instructions, good line/column errors; produce `AssembledProgram` (machine code +
      source-map + symbols). _Output contract seeded; parser/encoder TODO._
- [ ] **3. `engine/reference`** — dead-simple golden interpreter (obviously correct).
- [ ] **4. `engine/single-cycle`** — first model behind the `Processor` interface (§6).
- [ ] **5. `trace` driver/recorder** — step forward / back / scrub via recorded snapshots
      (§6). _Trace schema seeded; driver + `Processor` interface TODO (see decisions below)._
- [ ] **6. Differential tests** — reference vs single-cycle final reg+mem state on every
      example program (INV-8).
- [ ] **7. `web` shell** — load a program, drive the engine, show source↔machine-code,
      register, and memory panels. _Decoder-preview placeholder exists._
- [ ] **8. SVG datapath view** — the canonical single-cycle datapath, wired to trace events.
- [ ] **9. Depth-tier rendering** — three tiers on the datapath view (`minTier` on elements;
      narration variants resolved highest ≤ current tier — helper seeded in `curriculum`).
- [ ] **10. `curriculum`** — lesson format + runner + event-anchoring. _Types + narration
      resolver seeded._
- [ ] **11. Author 2–3 lessons** + wire sandbox-fork on edit.

## Acceptance criteria (spec §11)

- [ ] Assembler assembles every example program; known-good encodings round-trip exactly.
- [ ] Single-cycle final reg+mem state equals the golden reference for every program (INV-8).
- [ ] Load → step forward to completion → step back to start → scrub to any cycle; shown
      state always matches the recorded trace.
- [ ] Switching depth tier changes datapath detail and narration without changing engine
      behavior and without violating lawful simplification (INV-5).
- [ ] The 2–3 lessons play through; annotations fire on the correct events (INV-6).
- [ ] Editing the program mid-lesson forks into a sandbox; the sandbox run still animates.
- [ ] `engine` has zero imports from `web`/`curriculum`; the trace schema is the only shared
      type surface (INV-2, INV-3). _Mechanically enforced from day one (ESLint import-boundary
      rule + tsconfig references, verified to fire); re-confirm against the real engine once it
      is built._

## Open decisions (resolve as the relevant step is built)

- **Where do the `Processor` interface and driver/recorder live?** Spec §14 puts the
  driver in `trace`, but `Processor.reset(program, …)` references `AssembledProgram` (from
  `assembler`), and the pure trace schema must depend only on `isa`. Options: (a) let `trace`
  depend on `assembler` and host both; (b) a small `engine-api` package above both. Decide at
  step 4/5. Current scaffold keeps `trace` pure and defers this.
- **Signed/unsigned register representation.** `Int32Array` for GPRs; unsigned compares and
  `sltu`/shifts need care. Pin down in `isa`/reference (step 1/3).
- **Halt / print convention** for example programs — a minimal syscall-like mechanism
  (spec §16). Needed before example programs can signal completion (step 1–3).
- Exact pseudo-instruction set and directive coverage (spec §16) — settle during step 2.
