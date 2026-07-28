---
name: project-overview
description: 'CPU Visualizer at a glance: what it is, the spec contract, the repo, the stack and the package DAG - plus the INDEX into the per-milestone build logs (M1-M10), which were split out of this file on 2026-07-28.'
metadata:
  node_type: memory
  type: project
  originSessionId: c09ed410-3ad2-44be-9942-c29fb034a441
  modified: 2026-07-28T07:44:35.442Z
---

**CPU Visualizer** — a pedagogical RISC-V (RV32I) processor simulator. Load/run programs
and watch how a CPU works across a family of microarchitectures (single-cycle → … →
out-of-order), along two orthogonal axes: microarchitecture tier and explanation depth
(`essentials`/`detailed`/`expert`). The product is pedagogical clarity, not realism.

- **Design contract:** `cpu-visualizer-spec.md` in the repo root. Load-bearing: the
  architectural invariants (§3, INV-1..INV-8) and the trace schema (§5). Surface conflicts
  with these rather than working around them.
- **Repo:** https://github.com/BoykoNeov/cpu-visualizer (public, **BNCL-1.0** non-commercial —
  switched from MIT). Working dir: `M:\claud_projects\CPU Visualizer`. Default branch `main`;
  commits go straight to `main` and are pushed immediately ([[feedback_commit_and_push]]).
  CI = GitHub Actions (lint/format/typecheck/test/build).
- **Stack:** TS monorepo on **npm workspaces** (not pnpm — see [[best-practices-source]]),
  Vite + React (web), Vitest. Packages: isa, assembler, trace, curriculum,
  engine/common (shared `toProgramImage`), engine/conformance (test-only INV-8 harness),
  engine/reference, web — and the **six shipped models**: engine/single-cycle,
  engine/multi-cycle, engine/pipeline, engine/superscalar, engine/out-of-order,
  engine/deep-pipeline. Dependency DAG enforced by
  ESLint import-boundary rule + tsconfig project references (incl. cross-model isolation).

## The milestone build log — split across these files (2026-07-28)

This file was a single 242 KB memory, which is past the size any recall can usefully return.
The step-by-step log now lives one milestone per file; each is independently recallable by its
own `description`. Read the relevant one before touching that package.

- [[m1-engine-and-web-shell]] — M1: the whole headless engine path, the first React shell, the
  SVG datapath, depth tiers, the lesson format, the sandbox fork.
- [[m2-multi-cycle]] — M2: the multi-cycle model, the model picker, the bespoke datapath where
  `minTier` structural hiding earns its keep, and steps 5C/5D/5E.
- [[web-visual-layer]] — the 2026-07-14 theme/palette/`DatapathDiagram` batches and the doc
  templates every later model followed.
- [[m3-pipeline-engine]] / [[m3-pipeline-web]] — M3, the 5-stage pipeline: hazards + pinned
  TIMING (engine), then the panel, the datapath, the map and the lesson (web).
- [[m4-branch-prediction-and-isa-panel]] — M4 branch prediction, plus the ISA reference panel.
- [[m5-isa-lesson-track]] — M5, the ISA lesson track and its unbuildable-anchor findings.
- [[m6-caches-engine]] / [[m6-caches-corpus-and-web]] — M6, caches as the third pipeline
  toggle: timing shadow + variable-latency MEM, then the sweep, toggle, grid and track.
- [[m7-superscalar-engine]] / [[m7-superscalar-web]] — M7, in-order superscalar: pairing and
  the INV-8-is-a-false-net warning, then the width control, widened datapath and IPC tile.
- [[m9-out-of-order]] — M9, Tomasulo/ROB/renaming, model and view.
- [[m10-ooo-lesson-track]] — M10, the OoO lesson track.
- [[condensed-milestone-log]] — the compressed M8/M7/M2/M6 findings that used to sit on the
  MEMORY.md index line.

M11 (the 7-stage deep pipeline) and M12 (its lesson track) were never in this file — they live
in [[m11-deep-pipeline-planned]] and [[m12-deep-pipeline-lessons]].
