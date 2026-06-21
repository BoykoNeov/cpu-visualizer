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

## Decisions

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
- **Where do the `Processor` interface and driver/recorder live? — leaning (c), decide at
  step 4/5.** Spec §14 puts the driver in `trace`, but `Processor.reset(program, …)` references
  `AssembledProgram` (from `assembler`), and the pure trace schema must depend only on `isa`.
  Leaning: define a minimal pure `ProgramImage` (words + data + entry) that the engine consumes,
  and have the driver enrich `pc → sourceLine` afterward — this keeps `trace` pure _and_ lets it
  host the driver. Fallback if `sourceLine` must be engine-filled: (b) a small `engine-api`
  package above both. Avoid (a) `trace`-depends-on-`assembler`.
- **Pseudo-instruction set & directive coverage — direction set, settle in step 2.** Minimal,
  corpus-driven set (the example programs are the test fixtures, §9): pseudos `li`, `mv`,
  `nop`, `j`, `ret`/`jr`, `la`, `beqz`, `bnez` (plus branch swaps as programs need them);
  directives `.text`, `.data`, `.word`, `.byte`, `.asciz`, `.globl`. Round-trip-test `li`
  specifically — the `lui`+`addi` sign-correction `+1` is the classic off-by-one.
