# Superscalar — renderer & visuals plan (forward design, pre-milestone)

**Status: PLAN, 2026-07-14. No milestone assigned yet — the spec roadmap (§12) puts
in-order superscalar at tier 4, after the classic 5-stage pipeline (tier 2/3). This
document designs the _visual layer_ for it now so the pipeline milestone builds the right
primitives instead of ones we'd have to rip out. Companion docs: the generic model recipe
is `docs/templates/new-model-datapath.md`; the milestone-plan skeleton is
`docs/plans/plan-template.md`.**

## Why plan visuals this early

Every visual idiom we have today assumes **at most one instruction owns a stage**:

- The datapath grammar is binary — a wire/box is `--on` (accent blue) or idle. That
  identifies _the_ active path because there is exactly one.
- The phase chips (IF→WB hues) identify _when_ within a cycle, again for one instruction.
- The classic pipeline (one instruction per stage, ≤5 in flight) still works with this
  grammar: **stage position is identity** — "the instruction in EX" is unambiguous, so
  coloring by stage hue suffices.

Superscalar breaks the last property: **two instructions occupy the same stage in the same
cycle**, so stage position no longer identifies an instruction. That forces a second
identity channel (lanes), a second visualization surface (the stage×cycle pipeline map),
and tabular micro-state (issue logic; later the ROB/reservation stations at the OoO tier,
which this plan deliberately keeps one door away from). Planning this now tells us which
pieces the pipeline milestone should already build lane-parametric.

## The three visual surfaces

### 1. The widened datapath (SVG — the existing `DatapathDiagram`)

Superscalar geometry is authored per-model as always (`datapath-superscalar.ts`, per the
playbook): a shared front-end (PC, I-mem fetching a 64-bit pair, issue/pairing logic) and
**two replicated execute lanes** — duplicated register-read ports, ALUs, and (per pinned
issue rules) at most one memory lane. Replication is _just more nodes and wires_; the
renderer needs no concept of "lane", only a way to tint by one.

**Lane tinting rule:** everything on lane 0's path renders in the lane-0 hue, lane 1 in the
lane-1 hue; shared front-end structures stay accent-neutral. An idle lane (single-issue
cycle) renders idle — the picture "one lane lit, one dark" IS the story of a pairing
failure, which is the pedagogical money shot.

### 2. The pipeline map (NEW — the stage×cycle grid, an HTML component)

The classic pipeline diagram: **rows = instructions in program order, columns = cycles,
cells = the stage that instruction occupied that cycle**, colored with the existing
validated phase hues (each cell also carries its stage text — the relief rule already
covers the sub-3:1 light hues). This is the surface where overlap, stalls (repeated cells),
flushes (row cut short), and dual-issue (two rows advancing in lock-step) become _visible
as shapes_.

- Everything it needs is already in the trace: `instructions[].location` per cycle plus
  stable ids (INV-4) — it is a pure fold over the recorded trace, no engine access (INV-3).
- Build it as HTML (a grid of cells reusing `.seg-btn`-style chips), not SVG — it is
  tabular, needs scrolling for long programs, and cells double as click targets for
  follow-an-instruction.
- **Build it at the pipeline milestone**, where one instruction per column keeps it simple;
  superscalar merely lets two rows share a column, which the row/column model absorbs
  with zero API change.

### 3. Micro-structure tables (NEW — `MicroTablePanel`, HTML)

In-order superscalar needs at most a small issue/pairing readout (fetched pair, the pairing
verdict and its reason). The OoO tier later needs real tables (ROB, reservation stations,
rename map). Render these as **HTML tables in panels** (the `panels.tsx` idiom: `.panel`,
mono font, `--highlight` wash on rows touched this cycle), _not_ as SVG boxes-with-text —
HTML wins for tabular data, and rows carry the follow-highlight naturally. Data source:
`state.micro` via the trace (INV-3); the panel is a pure function of the cycle at the
cursor, like every other panel.

## Renderer deltas (`DatapathDiagram` — small, backward-compatible)

1. **Hue override on view-models.** `WireVM`/`NodeVM` grow an optional
   `hue?: string` (a `var(--lane-N)` reference). Implementation: the `.dp-*` classes
   switch from `var(--accent)` to `var(--dp-hue, var(--accent))`, and the renderer sets
   `style={{ '--dp-hue': hue }}` on the element's group when present. Derived tints
   (`--accent-soft`-style fills) become `color-mix(in srgb, var(--dp-hue, var(--accent))
11%, var(--surface))` in the class. Existing views pass no `hue` and render pixel-
   identical — the single-cycle/multi-cycle wrappers don't change.
2. **Per-hue arrow markers.** SVG markers don't inherit stroke color, so the renderer
   declares one `<marker>` per _distinct hue present in the wire VMs_ (plus the existing
   accent/idle pair), keyed `${markerPrefix}-arrow-<n>`. Cheap, contained in `defs`.
3. **Data-driven legend.** The hard-coded active/idle legend becomes a default that views
   can extend with entries (`label` + `hue`), so the superscalar view adds "lane 0 / lane 1"
   swatches — each swatch already sits next to its text label (relief rule).
4. **Follow-highlight.** A `followed?: boolean` on both VMs mapping to a `.dp--follow`
   outline treatment (dashed outer ring in `--ink`, not a hue — it must compose with lane
   tinting and survive CVD). The same visual token appears on pipeline-map cells and
   micro-table rows so "this instruction" reads identically across all three surfaces.

The renderer stays **policy-free**: lane assignment, pairing logic, and tier filtering are
the view's job; the renderer draws what it's handed, exactly as today.

## Color plan — validated, tokens only (no hexes in TSX)

New token pair in **both** theme blocks of `styles.css`:

| Token      | Light                       | Dark      | Role         |
| ---------- | --------------------------- | --------- | ------------ |
| `--lane-0` | `#2a78d6` (alias of accent) | `#3987e5` | issue slot 0 |
| `--lane-1` | `#e87ba4` (magenta, slot 7) | `#d55181` | issue slot 1 |

Machine-validated 2026-07-14 with the dataviz validator against our surfaces
(`#fcfcfb` / `#1a1a19`): **ALL CHECKS PASS both modes** — CVD separation ΔE 41.3 (light) /
42.6 (dark), far above the ≥12 target; one WARN: light magenta is 2.62:1 vs the surface,
so the **relief rule is mandatory — a lane hue never appears without a text label**
(lane badges, legend entries, labeled map cells).

Deliberate non-choices, to keep encodings from colliding:

- **Lanes do not reuse phase hues** beyond blue (which is also plain "accent/active" —
  lane 0 of a single-issue machine is today's picture, which is the right degenerate case).
  Phase hues keep meaning _stage_ (map cells, chips); lane hues mean _issue slot_.
- **No red or amber lanes** — red is the danger/flush family, amber is the warn/highlight
  wash; a lane in either would impersonate a status color.
- Going wider than 2 lanes later means appending categorical slots and **re-running the
  validator on the new set in fixed order** — never inventing a hue.

## Depth tiers (INV-5 — lawful at every level)

- **essentials** — the clean story: a wide machine, two instructions moving together when
  they can, one when they can't. Pipeline map + lane-tinted datapath with all pairing
  machinery hidden (structural tiering: issue-logic muxes/ports behind `minTier` with
  contraction wires, exactly the multi-cycle mechanism).
- **detailed** — _why_ pairing fails: the issue/pairing readout appears, stall chips name
  the reason (dependency, structural — one memory port), and the map shows the resulting
  single-issue columns.
- **expert** — full control: scoreboard/issue-queue contents in `MicroTablePanel`, control
  labels, per-port wires.

Litmus (same as always): nothing essentials shows is contradicted at expert — "two at a
time when possible" only ever gains machinery. Port the coherence and
contraction-lawfulness tests from the existing datapath test suites.

## Trace prerequisites (engine work this plan depends on, kept minimal)

The visuals read the trace only (INV-3). What must exist by the superscalar milestone:

- `instructions[].location` distinguishing lanes (e.g. `"EX.0"` / `"EX.1"` — exact
  encoding is a milestone decision) — feeds the map and lane tinting.
- An **issue/pairing event** (`{ type: 'issue', slot, instr }` plus a
  pairing-refused event carrying the reason) — feeds the detailed-tier narration and the
  readout panel. Structural-hazard stalls reuse the existing `stall` event with a new
  `reason`.
- Engine stays tier-oblivious and emits everything always (INV-2); IPC is _derived by the
  view_ from retire events — not an engine counter.

## What lands when

| Piece                                                       | Milestone                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| Pipeline map component (rows×cycles, phase-hue cells)       | pipeline (M3) — single-issue                                              |
| Follow-an-instruction highlight across all three surfaces   | pipeline (M3)                                                             |
| Renderer deltas 1–4 (hue override, markers, legend, follow) | pipeline (M3), lane-parametric from day one                               |
| Stall/flush visual idioms (repeated cells, cut rows)        | pipeline (M3)                                                             |
| `--lane-*` tokens + widened geometry + pairing readout      | superscalar milestone                                                     |
| IPC stat tile (retired ÷ cycles, view-derived)              | superscalar milestone                                                     |
| ROB / reservation-station / rename tables                   | OoO tier — **not this plan**; `MicroTablePanel` is shaped so they slot in |

## Decisions to pin (seeded)

| Decision                 | Recommendation (seed)                                                                 | Pinned answer |
| ------------------------ | ------------------------------------------------------------------------------------- | ------------- |
| Issue width              | 2 (dual-issue) — the pedagogy is "more than one", not "many"                          | _(open)_      |
| Lane hues                | `--lane-0` = accent blue, `--lane-1` = magenta `#e87ba4`/`#d55181` (validated above)  | _(open)_      |
| Memory ports             | 1 (mem-op pairs never dual-issue) — gives the structural-hazard lesson for free       | _(open)_      |
| `location` lane encoding | `"<stage>.<slot>"` strings — keeps the field a plain string for existing consumers    | _(open)_      |
| Pipeline map tech        | HTML grid (not SVG) — scrollable, cells are follow click-targets                      | _(open)_      |
| Follow-highlight visual  | dashed `--ink` outline ring — hue-free so it composes with lane tint and survives CVD | _(open)_      |
