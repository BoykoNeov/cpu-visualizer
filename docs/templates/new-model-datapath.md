# Playbook — adding a microarchitecture model and its datapath view

The repeatable recipe M1 (single-cycle) and M2 (multi-cycle) followed, written down so the
pipeline tier and beyond plug into existing seams instead of re-inventing them. Milestone
planning itself has its own skeleton: `docs/plans/plan-template.md`.

The one-sentence version: **a model is an engine package proven by conformance, one entry in
`models.ts`, and a pure geometry+activation module rendered by the shared `DatapathDiagram`.**
Everything else (transport, panels, scrub, lessons, sandbox) works against any model unchanged,
because it reads only the trace (INV-3).

## 1. Engine package — `packages/engine/<model>`

- New workspace package `@cpu-viz/engine-<model>` implementing `Processor` from `@cpu-viz/trace`.
  It may import `isa`, `assembler` (via `engine-common`'s `toProgramImage`), `trace` — and
  **nothing from `web`/`curriculum`/another engine's production code** (INV-2/INV-3; the eslint
  DAG enforces this mechanically — if it blocks you, fix the design, don't work around it).
- Mirror ISA semantics **verbatim from the golden reference** (sign idioms, `imm & 0x1f`,
  `>>> 0` at the memory boundary) — the genuinely new code is only the model's sequencing.
- Every in-flight instruction keeps a **stable `id` for its whole lifetime** (INV-4); park
  inter-cycle state in `state.micro` (a per-model shape, exported for the view to type against).
- Wire the new node into the mechanical DAG, all four places: `eslint.config.js` boundary rules,
  root `tsconfig.json` project references, `vitest.config.ts` `workspaceAliases`, and the web
  `tsconfig` `paths`.

## 2. Prove it — conformance + recorder

- `differential.test.ts` is one call: `runConformance('<model>', () => new XProcessor())`
  (`@cpu-viz/engine-conformance` owns the corpus, `expectEquivalent`, and the result oracles).
  This is INV-8: final architectural state ≡ the golden reference on every corpus program.
- Hand-derived unit tests pin the model's _soul_ — the thing that distinguishes it (phase plan,
  hazard/stall behavior, latch contents), not the shared ISA arithmetic.
- Prove time-travel: step/scrub via `TraceRecorder`, and `follow()` an instruction id through
  its multi-cycle lifetime where applicable.

## 3. Light it up in the browser — `models.ts`

Add one `ModelChoice` entry (id from the engine's `MODEL_ID`, label, description, `make`,
and its `datapath` kind — `'none'` until step 4 lands, which renders the placeholder). The
picker, transport, register/memory/source panels, lessons and sandbox all animate the new model
with **no further changes** (INV-3). This is a shippable checkpoint on its own (M2 shipped it
as "step 5a").

## 4. The bespoke datapath — geometry + activation (pure data, headlessly tested)

Each model gets its **own hand-authored geometry** — lighting one model's diagram with another
model's trace paints a contradictory picture (INV-5 violation), so `models.ts` dispatches on the
`datapath` discriminator, never "reuses the closest diagram".

Author `datapath-<model>.ts` in the two-halves shape of `datapath.ts` / `datapath-multi.ts`:

- **GEOMETRY** — fixed `NODES` / `WIRES` with hand-placed SVG coordinates (the `at`/`elbow`
  helpers). Wires declare their true endpoints in `ends` (ids are display names only).
- **ACTIVATION** — a pure `activate(trace) → { components, wires, … }`, derived from the trace
  only: topology from the decoded instruction, values from events, latches from `state.micro`.
  It is **tier-oblivious** (INV-2): always emit the full expert path.
- **DEPTH TIERS** — decide which of the two levers this model tiers:
  - _representation_ (labels only — single-cycle's choice, forced when every box is on some
    common instruction's path), and/or
  - _structure_ (`minTier` on genuinely-optional units — muxes, forwarding/hazard units — with
    `maxTier`'d **contraction wires** standing in below; each contraction must be the expert
    path with only the hidden selector collapsed, same source and sink — the INV-5 lawfulness
    condition, checked by test).
- Port the two standing test litmuses: **coherence** (every lit wire resolves to real geometry
  with both endpoints lit — no lit wire into a dim box) and, if structurally tiered,
  **contraction lawfulness**.

## 5. The view — a thin wrapper over the shared renderer

`<Model>DatapathView.tsx` owns _policy only_ (what is visible/active at the tier, plus any
view-local interaction like single-cycle's phase stepper) and hands plain view-models to
`DatapathDiagram`, which owns all _drawing_: shapes, arrows, the animated flow overlay, value
labels, control labels, legend, and theming. Concretely:

- Map geometry × activation × tier → `WireVM[]` / `NodeVM[]`; pass a unique `markerPrefix`.
- Phase/stage chips come from `PhaseChips` with `PHASE_COLORS` (`theme.ts`) — the same validated
  hue per phase in every model, and the natural stage colors for the pipeline view's columns.
  A chip always carries its text label; hue is never the sole carrier.
- **No new colors in TSX.** Everything comes from the `.dp-*` classes and tokens in `styles.css`
  (that is what makes light/dark work for free). A genuinely new color means a new token pair in
  both theme blocks — and if it's categorical, a re-run of the dataviz palette validator against
  both surfaces before it ships.
- Add render smoke tests next to `DatapathDiagram.test.tsx`'s (renderToStaticMarkup: active
  classes light up, labels gate by tier, structural hiding counts). Layout aesthetics remain an
  `npm run dev` eyeball — say so in the milestone status until done.

## 6. Curriculum hooks

Lessons anchor to **trace events, never cycle numbers** (INV-6) — multi-cycle already made
"cycle 3" meaningless, and pipeline overlap will again. Narration text resolves per depth tier
(INV-5: lower tiers omit, never contradict).
