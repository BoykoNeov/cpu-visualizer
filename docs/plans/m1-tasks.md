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

- [~] Assembler assembles every example program; known-good encodings round-trip exactly.
  _Assembler done: `add.s` assembles; oracle encodings + `li` round-trip pinned. Re-confirm
  as more example programs land alongside the engines._
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
  package above both. Avoid (a) `trace`-depends-on-`assembler`. _Step 3 update: `engine/reference`
  consumed `AssembledProgram` **directly** (it only touches `words` + `data`), deferring the
  `ProgramImage` abstraction to step 4/5 as planned — the later migration is a cheap, local change._
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
