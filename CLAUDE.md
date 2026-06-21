# CPU Visualizer — agent guide

A pedagogical RISC-V (RV32I) processor simulator. Load and run programs and watch how a
CPU works across a family of microarchitectures. The product is **pedagogical clarity**,
not simulation realism.

**The design contract is `cpu-visualizer-spec.md`.** Read it before non-trivial work. The
two load-bearing parts are the architectural invariants (§3) and the trace schema (§5).
Current work plan: `docs/plans/m1-tasks.md` (Milestone 1).

## Hard constraints (from spec §3 — surface conflicts, don't work around them)

- **The engine is pure & deterministic** (INV-1): same program + config ⇒ identical trace.
  No wall-clock, no ambient randomness (seed any needed randomness via config).
- **The engine is oblivious to rendering and depth tiers** (INV-2). It always emits full,
  expert-complete state. Depth is a property of the **view** and **curriculum** only.
- **The trace is the only contract** (INV-3). Views/curriculum read the trace; they never
  reach into engine internals. Need something? Add it to the trace schema — not a back door.
- **Every in-flight instruction has a stable id** for its whole lifetime (INV-4).
- **Lawful simplification** (INV-5): a lower depth tier may omit detail but must never
  contradict a higher tier.
- **Lessons anchor to trace events, not cycle numbers** (INV-6).
- **One ISA, one assembler, one example-program library** across all models (INV-7).
- **Every model is differentially tested against the golden reference** on final
  architectural state (INV-8).

## Architecture & dependency DAG

Monorepo (npm workspaces). Packages, lowest layer first:

```
isa  ←  trace, assembler
trace  ←  curriculum
isa, assembler, trace  ←  engine/reference, engine/single-cycle
all of the above  ←  web
```

The DAG is **mechanically enforced** — don't fight it, fix the design if it blocks you:

- `eslint.config.js` forbids cross-layer imports (e.g. anything importing `@cpu-viz/web`,
  or an engine importing `@cpu-viz/curriculum`). The error message cites the invariant.
- `tsconfig.json` project references mirror the same DAG.
- Everything except `web` is framework-agnostic and headlessly testable.

## Commands

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm test`          | Run all Vitest suites (headless).                    |
| `npm run typecheck` | `tsc -b` for libraries + `tsc --noEmit` for the web. |
| `npm run lint`      | ESLint, including the dependency-boundary rules.     |
| `npm run build`     | Build libraries (tsc) then the web app (Vite).       |
| `npm run dev`       | Vite dev server for the web app.                     |
| `npm run format`    | Prettier write (`format:check` to verify in CI).     |

## Conventions

- **TypeScript everywhere**, `strict` + `noUncheckedIndexedAccess`. ESM only.
- **Relative imports are extensionless** (`./decoder`, not `./decoder.js`) — resolution is
  Bundler-mode and must stay consistent across tsc / Vite / Vitest.
- Workspace imports use the package name (`@cpu-viz/isa`); Vite/Vitest aliases and the web
  `tsconfig` `paths` resolve these to **source**, so no library pre-build is needed to run
  tests or the dev server. `tsc -b` validates emitted types and the reference DAG.
- Tests are colocated as `*.test.ts` next to the code.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Each commit should
  build and pass tests.

## Things that are easy to get wrong here

- Don't add depth-tier logic to the engine — it belongs in the view/curriculum (INV-2).
- Don't add engine accessors for the view — extend the trace schema instead (INV-3).
- `x0` is hardwired to 0; immediates are sign-extended per format — verify against the
  golden reference, not by eyeballing.
- The single-cycle model has no hazards by construction; forwarding/stall/flush events
  start at the pipeline tier.
