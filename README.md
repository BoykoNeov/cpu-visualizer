# CPU Visualizer

A pedagogical **RISC-V (RV32I)** processor simulator: load and run programs and watch how a
CPU actually works — data movement, hazards, forwarding, caches, branch prediction — across
a family of microarchitectures, from a single-cycle datapath up to an out-of-order
superscalar core.

The real product is **pedagogical clarity**, not simulation realism. A curious beginner and
an expert should both get value from the same tool, traveling along two independent axes:

- **Microarchitecture tier** — which machine is running (single-cycle → … → out-of-order).
- **Explanation depth** — how much detail is revealed (`essentials` → `detailed` → `expert`).

> **Status: Milestone 1 in progress.** The single-cycle model runs end to end — assemble a
> program, then step / scrub / run it through a live SVG datapath with switchable explanation
> depth while registers and memory update. Authored lessons and the sandbox fork are the
> remaining M1 work — see [`docs/plans/m1-tasks.md`](docs/plans/m1-tasks.md). The full design is
> in [`cpu-visualizer-spec.md`](cpu-visualizer-spec.md).

## Repository layout

```
packages/
  isa/                 RV32I definitions, encodings, decoder        (framework-agnostic)
  assembler/           assembly → AssembledProgram                  (framework-agnostic)
  trace/               CycleTrace types (THE contract) + driver     (framework-agnostic)
  curriculum/          lesson format, runner, event-anchoring       (framework-agnostic)
  engine/
    reference/         golden interpreter                           (framework-agnostic)
    single-cycle/      first microarchitecture model                (framework-agnostic)
  web/                 React app, SVG datapath views, depth tiers   (depends on all above)
content/
  programs/            example .s files (free-play + lesson fixtures + tests)
  lessons/             authored lesson data
```

Everything except `web` is framework-agnostic and headlessly testable. The dependency DAG
is enforced by ESLint and TypeScript project references.

## Getting started

Requires **Node ≥ 20** (the repo targets Node 24; see `.nvmrc`).

```bash
npm install        # install workspace dependencies
npm run dev        # start the web app (Vite)
npm test           # run all unit tests (headless)
npm run typecheck  # typecheck libraries + web
npm run lint       # lint, including dependency-boundary rules
npm run build      # build libraries + web app
```

## Contributing

This project favors small, well-scoped changes that keep the build and tests green.
See [`CLAUDE.md`](CLAUDE.md) for conventions and the architectural invariants that must
hold at every milestone.

## License

[Boyko Non-Commercial License v1.0 (BNCL-1.0)](LICENSE) © 2026 Boyko Neov
