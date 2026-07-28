---
name: future-microarchitectures
description: "User wants longer (deeper) pipelines and a superscalar CPU visualized in future milestones — a don't-foreclose constraint on M3 design. DEPTH IS DELIVERED (M11, the 7-stage); WIDTH is now IN PROGRESS as M13 — its guard opened to widths 1..4 on 2026-07-28, so BOTH axes of the flag are now under construction. This file's claim that the pairing rules are pair-shaped was FALSE and is corrected below"
metadata:
  node_type: memory
  type: project
  originSessionId: 459fcb2c-a51a-49c7-8465-fb9b8cf51a03
  modified: 2026-07-28T10:25:55.053Z
---

Stated 2026-07-16: beyond M3's classic 5-stage pipeline, the user wants **longer/deeper
pipelines** (7-stage, 12-stage — more stages than the five phase hues) and a **superscalar
CPU** visualized in future milestones.

**STATUS 2026-07-27 — the DEPTH half is DELIVERED and the flag now points at one axis only.**
M11 shipped `engine/deep-pipeline` (a 7-stage `IF1 IF2 ID EX1 EX2 MEM WB` with its timing matrix,
cache, recorder, web enablement and bespoke datapath) — see [[m11-deep-pipeline-planned]]. Every
prediction in this file held: the map needed **no change at all**, the trace schema needed none,
`location` absorbed `"IF1"`/`"EX2"` as a plain string, and the hues went by stage FAMILY. **What remained open was WIDTH — and as of 2026-07-28 it is IN PROGRESS, not merely planned.** M13
step 1 opened the superscalar guard to `MAX_ISSUE_WIDTH = 4`; the engine half is essentially done
and the view half (steps 6-9) is where the budget went. See [[m13-width-planned]] before doing any
of it. **This paragraph is the second thing in this file to go stale, after the correction below —
which is the point: a status line in a memory ages faster than the lesson beside it.**

**⚠ CORRECTION 2026-07-28. This file used to say `superscalar/processor.ts` refuses `issueWidth > 2`
BY NAME "because `intra-pair-raw` / `mem-port` / `branch-slot` are written for a pair". The second
half was FALSE.** The rules are already group-generic (`issueVerdict` loops
`for (const older of group)`; `stageId`/`detectHazard` loop `s < this.width`), and widths 3 and 4 run
the whole corpus correctly with the guard as the only thing changed. What that sentence actually
paraphrased was the guard's ERROR MESSAGE. **A memory that restates an error message can read
exactly like a memory that describes the code** — and the tell was three lines away. M13 is
therefore a guard + an audit + nets on the engine side, with the real work in the view.

Deeper still (`MEM1`/`MEM2`, a 12-stage) is a candidate for a later milestone, not a deferred step
of M11.

**Why:** It's a _don't-foreclose_ flag, not a build-for-it-now order. It constrains which M3
shapes are cheap now and expensive later — but far less than it first appears, because each
microarchitecture is its own package with its own `micro` type and its own bespoke datapath
geometry (M3 step 6 pins that geometry is never reused across models). A deeper pipeline is a
future _sibling_ package, not a retrofit of `engine/pipeline`.

**How to apply:**

- **Do NOT generalize step-1 model internals.** `PipelineMicro` stays a concrete four-latch
  shape (not an N-latch abstraction); forwarding paths stay enumerated (EX/MEM→EX, MEM/WB→EX,
  not "any later latch → EX"). Pinned this way deliberately in `docs/plans/m3-tasks.md`
  (decisions table) — see [[m3-pipeline-engine]] for that milestone's log, or
  [[project-overview]] for the index over all of them.
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
