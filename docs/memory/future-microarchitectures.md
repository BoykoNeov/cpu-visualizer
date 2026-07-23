---
name: future-microarchitectures
description: "User wants longer (deeper) pipelines and a superscalar CPU visualized in future milestones — a don't-foreclose constraint on M3 design"
metadata:
  node_type: memory
  type: project
  originSessionId: 459fcb2c-a51a-49c7-8465-fb9b8cf51a03
---

Stated 2026-07-16: beyond M3's classic 5-stage pipeline, the user wants **longer/deeper
pipelines** (7-stage, 12-stage — more stages than the five phase hues) and a **superscalar
CPU** visualized in future milestones.

**Why:** It's a _don't-foreclose_ flag, not a build-for-it-now order. It constrains which M3
shapes are cheap now and expensive later — but far less than it first appears, because each
microarchitecture is its own package with its own `micro` type and its own bespoke datapath
geometry (M3 step 6 pins that geometry is never reused across models). A deeper pipeline is a
future _sibling_ package, not a retrofit of `engine/pipeline`.

**How to apply:**

- **Do NOT generalize step-1 model internals.** `PipelineMicro` stays a concrete four-latch
  shape (not an N-latch abstraction); forwarding paths stay enumerated (EX/MEM→EX, MEM/WB→EX,
  not "any later latch → EX"). Pinned this way deliberately in `docs/plans/m3-tasks.md`
  (decisions table) — see [[project-overview]] for milestone status.
- **The pipeline map (M3 step 7) is the one shared surface** a deeper pipeline reuses as-is —
  it's a pure fold over `instructions[].location` (INV-3). It must be **stage-and-lane-
  parametric**: stage set and hue mapping derived from the trace, never a hard-coded 5-element
  list or 5-hue lookup. Lanes = the superscalar axis; stage count = the deep-pipeline axis; the
  row×column model absorbs both with no API change.
- **`location` as a plain string already absorbs both axes** with no schema change: `"EX.0"`
  (lane) and `"EX1"`/`"EX2"` (deeper stage set).
- **More stages than hues → hue by stage _family_** (fetch/decode/execute/memory/writeback),
  with the cell text giving the exact stage. Never invent a hue; the 5-hue palette is
  machine-validated. Written up in `docs/plans/superscalar-visuals.md` (color plan section).
- Superscalar visuals are already pre-designed in `docs/plans/superscalar-visuals.md` — build
  by reference to it, don't re-derive.
