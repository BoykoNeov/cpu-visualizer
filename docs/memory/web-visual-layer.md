---
name: web-visual-layer
description: 'The 2026-07-14 visual batches: theme tokens + dark mode as the single source of color truth, the CVD-validated 5-hue IF/ID/EX/MEM/WB phase palette, the shared DatapathDiagram renderer, the datapath schematic overhaul, and the plan / new-model-datapath doc templates.'
metadata:
  node_type: memory
  type: project
---

**VISUAL-LAYER OVERHAUL + FUTURE-PLAN TEMPLATES — DONE & pushed (2026-07-14, 435 tests, 4 commits
`4e6543a..53b1d52`).** "Improve visuals/visualization and bake templates" batch:

- **Theme tokens + dark mode:** `packages/web/src/styles.css` is now the SINGLE source of color truth —
  CSS custom properties (surfaces/ink/accent/status/highlight + per-phase hues), dark set applied under
  BOTH `prefers-color-scheme` and an explicit `data-theme` stamp (`:not([data-theme='light'])` guard so
  the toggle wins both ways; pre-paint stamp script in `index.html`; persisted `cpu-viz-theme` key).
  `theme.ts` = `T.*` var() tokens + `MONO` + `PHASE_COLORS` + toggle helpers; App header gained an
  auto→light→dark `ThemeToggle`. App.tsx/panels.tsx contain ZERO hard-coded hexes now (grep-verified);
  shared `.panel/.panel-heading/.btn/.btn--primary/.seg/.seg-btn` classes replaced repeated inline styles.
- **Phase palette (pedagogical + future pipeline stage colors):** 5 hues for IF/ID/EX/MEM/WB = dataviz
  reference palette slots 1–5, machine-validated with the dataviz skill's `validate_palette.js` for BOTH
  surfaces (light: all pass, aqua/yellow sub-3:1 ⇒ relief rule — chips always text-labeled; dark: CVD
  10.3 floor-band, legal with direct labels). Ordering is the CVD-safety mechanism — don't reorder.
- **Shared `DatapathDiagram.tsx` renderer (the code template):** extracted the ~200 duplicated lines from
  the two datapath views. It owns ALL drawing (box/mux/notched-adder shapes, arrows, **animated dash flow
  overlay on active wires** showing direction — `prefers-reduced-motion` disables, value/control labels,
  legend, theming via `.dp-*` classes); model views are now thin POLICY wrappers mapping
  geometry×activation×tier → `WireVM[]`/`NodeVM[]` (+ unique `markerPrefix`). `PhaseChips<P>` = shared
  phase row: interactive stepper (single-cycle) or passive track (multi-cycle), hue via `--seg-accent`.
  New `DatapathDiagram.test.tsx` (6 tests): headless `renderToStaticMarkup` smoke — active classes light,
  labels gate by tier, control labels expert-only, multi-cycle mux polygons 2@essentials vs 5@detailed.
- **Docs templates:** `docs/plans/plan-template.md` (milestone-plan skeleton distilled from m1/m2 house
  style: status banner, headline decision, testable build order, §11-shaped acceptance, pinned-decisions
  table) and `docs/templates/new-model-datapath.md` (6-step playbook for a new microarchitecture: engine
  package+DAG wiring → conformance+recorder proofs → models.ts entry → pure geometry/activation with tier
  levers + coherence/contraction litmuses → DatapathDiagram wrapper, no-new-colors-in-TSX rule → INV-6
  lesson hooks).
- **Visual polish still to eyeball via `npm run dev`:** the new theme/animation AND the standing 5b
  layout check (they can be done in one pass; dark mode needs the toggle clicked too).

## SUPERSCALAR VISUALS PLAN — written & pushed (2026-07-14, commit 239f87e)

`docs/plans/superscalar-visuals.md` — pre-milestone design for the superscalar (roadmap tier 4) visual
layer, written early so the PIPELINE milestone (M3) builds lane-parametric primitives. Core ideas: three
surfaces (lane-tinted datapath / NEW stage×cycle pipeline map as HTML grid, phase-hue cells / NEW
`MicroTablePanel` HTML tables for micro-state, ROB-ready); 4 small backward-compatible DatapathDiagram
deltas (`hue?` VM override via `--dp-hue` custom prop, per-hue markers, data-driven legend, `followed?`
follow-highlight); lane tokens `--lane-0`=accent blue, `--lane-1`=magenta #e87ba4/#d55181 —
machine-validated both surfaces (ΔE 41+/42+, light magenta 2.62:1 ⇒ relief rule mandatory). Pipeline map +
follow-highlight + renderer deltas land at M3; lane tokens/wide geometry/IPC tile at the superscalar
milestone; ROB/RS/rename explicitly deferred to OoO. Decisions table seeded (dual-issue, 1 mem port,
`"<stage>.<slot>"` location encoding).

## DATAPATH SCHEMATIC OVERHAUL — DONE & pushed (2026-07-14, 441 tests, 3 commits `72a4afe..2c45174`)

User ask: "color different paths in different colors so they're distinguishable; arrows only at
0/90/180/270; arrows start from an element edge (not blank space); labels/arrows don't obscure each
other." Applied to BOTH `datapath.ts` (single-cycle) and `datapath-multi.ts`, via the shared
`DatapathDiagram.tsx` renderer. All four requirements now mechanically guarded by tests, not just eyeball.

- **Color = PHASE** (the one real interpretation fork — surfaced to the user). Each active wire is stroked
  in its within-cycle phase hue (`PHASE_COLORS` IF/ID/EX/MEM/WB), so the five stages read as five
  distinguishable paths and match the phase chips. Single-cycle colors per `wire.stage`; multi-cycle per
  `act.phase` (a whole cycle = one phase = one color). Threaded through stroke, ONE `context-stroke`
  arrowhead marker (inherits each wire's color — Chrome-verified), value-label ink, and a phase color-key
  legend (`legend?: LegendItem[]` prop; the chips only show hue when active, so the datapath needs its own
  key). Per-wire unique colors was rejected — 22 hues can't stay "easily distinguishable" (CVD).
- **Orthogonal + edge-anchored geometry rewrite.** Layout contract (in each file's header): main dataflow
  band on a fixed centerline, shaped nodes connect ONLY on vertical edges — muxes in-left/out-right, adders
  on the two notch stubs (`aUp`/`aLo` helpers) + right output; feedback/select buses ride clear top (y<~60)
  and bottom (y>~440) rails. `shapePolygon` in the renderer is now the SINGLE source of truth for node
  outlines (NodeShape draws from it; tests hit-test endpoints against the REAL perimeter — the old
  bounding-box edge test passed points sitting in a trapezoid's blank corner). All wire ids/`ends`/tier
  machinery (minTier/maxTier/contracts) preserved; multi-cycle contraction-lawfulness still green.
- **Label de-collision** (`layoutLabels`): each value label anchors on its wire's LONGEST segment, clamps
  inside the canvas, and nudges vertically until it clears BOTH earlier labels AND component boxes. Two
  short redundant PC connectors (`pcsel-pc`/`pc-imem`) are left unlabeled (PC addr already on `pc-add4`).
- **Geometry invariants added to both suites:** every segment axis-aligned; every endpoint on the drawn
  perimeter; and (advisor's catch — the decisive one) **no two simultaneously-drawn wires run collinearly
  on top of each other** ("arrows don't obscure arrows" — invisible to eyeball since all wires draw every
  frame; multi-cycle buckets by tier so contraction↔through pairs aren't false-flagged). The last test
  caught one real 20px overlap (the two ALUSrc contractions into the ALU lower stub) — fixed.
- **Verification loop (not committed — local dev tool):** `packages/web/src/_snap.render.test.tsx`
  (gated behind `SNAP=1`) renders the REAL components via `renderToStaticMarkup` → HTML with `styles.css`
  inlined → headless **Chrome** `--screenshot` (Edge absent on this box; Chrome at
  `C:\Program Files\Google\Chrome\Application\chrome.exe`). PS driver `M:\claud_projects\temp\shoot.ps1`.
  Verified light+dark across lw/sw/jal (single-cycle) and every phase IF..WB + jal-WB (multi-cycle).
- **Accepted limitation (told the user):** labels avoid boxes + each other but may cross an unrelated idle
  wire (opaque box briefly occludes a grey line); not fixed because avoiding all non-owned wires risks
  pushing a label ambiguously far from its own wire. Node active-fill stays accent-blue (nodes aren't paths).
- This substantially closes the long-standing "browser-eyeball the datapath layout" loose end for BOTH the
  5b multi-cycle layout and the theme/animation pass — the datapath schematic is now screenshot-verified.
