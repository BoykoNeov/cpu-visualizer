/**
 * The superscalar datapath view (M7 step 7) — a thin wrapper over the shared {@link DatapathDiagram}
 * renderer, the fourth sibling of the single-cycle, multi-cycle and pipeline wrappers. This module
 * owns POLICY only; all drawing lives in the renderer.
 *
 * The defining difference from M3: a cycle lights up to `5 × width` stage slices for that many
 * different instructions. That is one identity channel more than the pipeline needed, so this is
 * the first view in the project to spend all three at once:
 *
 *   - **wire stroke = STAGE** (`PHASE_COLORS`), exactly as the pipeline view and the pipeline map.
 *     Several EX-hued clusters stacked is precisely the reading this tier exists to produce:
 *     *N instructions in EX*. Hue-ing wires by lane instead would have made `EX.0` and `EX.1`
 *     different colors and destroyed it — see `datapath-superscalar.ts` for the full argument and
 *     why it overrides `superscalar-visuals.md`'s original proposal.
 *   - **node tint = ISSUE LANE** (`--lane-0` … `--lane-3`), on replicated boxes ONLY. A shared box
 *     stays hue-neutral for M3's pinned reason (the register file is read by ID and written by WB
 *     in one cycle, so it belongs to no single anything); a replicated box does not have that
 *     problem, which is exactly what makes it the one thing that can carry the lane.
 *   - **follow ring = IDENTITY**, hue-free, composing with both.
 *
 * THREE VISIBILITY AXES (M3 had two), and only two of them are filters:
 *   - `tier` selects structure and representation, as before.
 *   - `forwarding` / `predictTaken` decide what EXISTS inside a fixed outline, as before.
 *   - **`issueWidth`** decides how many lanes exist, and therefore how TALL the machine is. Lanes
 *     past the width are ABSENT, not dimmed — the trace has no occupant and no refusal to put
 *     there, so drawing an idle lane would contradict it (INV-5) — and their height goes with them,
 *     which is why this axis selects a whole geometry (`geometryFor`) rather than filtering one.
 *     This is what makes the width toggle visibly restructure the diagram, and at M13 it does so
 *     across four positions rather than two.
 *
 * {@link activate} is oblivious to all three (INV-2): it always lights the full expert path and its
 * contractions, at every width. This wrapper chooses what to hand the renderer.
 */

import type { DepthTier } from '@cpu-viz/curriculum';
import type { CycleTrace } from '@cpu-viz/trace';
import { useMemo } from 'react';
import {
  activate,
  geometryFor,
  LANES,
  nodeVisibleAt,
  showControlLabels,
  showValueLabels,
  STAGE_LABELS,
  STAGES,
  wireVisibleAt,
  type DatapathConfig,
  type Lane,
} from './datapath-superscalar';
import { DatapathDiagram, fmtValue, type LegendItem, type NodeVM, type WireVM } from './DatapathDiagram'; // prettier-ignore
import { PHASE_COLORS, T } from './theme';

/**
 * The lane hues, as token references — never a hex in TSX (that is what makes light/dark free).
 *
 * FOUR tints since M13 step 7, and the extension was RE-VALIDATION rather than invention: the lane
 * channel is a second categorical set, separate from `PHASE_COLORS`, so nothing fixed it at two.
 * Lanes 2 and 3 are green and purple, chosen by sweeping the legal hue space rather than by eye —
 * no red and no amber at any slot (red is the danger/flush family, amber the warn wash, so a lane
 * in either would impersonate a status), and no tint below 3:1 against its own surface, since the
 * set already ships one relief WARN and a second would be a new obligation rather than a colour
 * choice. The measured cost is on the record in `styles.css`, including where it is a LOSS.
 */
export const LANE_COLORS: Readonly<Record<Lane, string>> = { 0: 'var(--lane-0)', 1: 'var(--lane-1)', 2: 'var(--lane-2)', 3: 'var(--lane-3)' }; // prettier-ignore

/** How a pairing refusal reads in the diagram's header — the three verdicts, in plain words. This is
 *  the one-line version the picture can carry; `pairing-readout.ts` owns the full sentence. It exists
 *  because "why is that lane dark?" is the question the picture provokes.
 *
 *  `intra-pair-raw` said "it reads what its PARTNER writes" until M13 step 8. A partner is one other
 *  instruction, and from width 3 the writer is one of up to three elders in the group — so the line
 *  named a relation the machine does not have. It now says what the readout says, in fewer words. */
export const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  'mem-port': 'refused: one data-memory port',
  'branch-slot': 'refused: one branch unit',
  'intra-pair-raw': 'refused: it reads what an older group-mate writes',
};

/**
 * The widest thing the verdict chip can say — what the header reserves on a cycle that refused
 * nobody, so the panel is the same height at every cursor.
 *
 * DERIVED from {@link REFUSAL_TEXT} rather than typed: a fourth refusal reason with a longer sentence
 * must widen the reserve by existing, or the header would go back to changing height on precisely the
 * cycle the new reason fires. Longest by character count, which is the right proxy at one font: the
 * chip is a single line and every glyph in these strings comes from the same face.
 */
export const LONGEST_REFUSAL_TEXT: string = Object.values(REFUSAL_TEXT).reduce(
  (longest, text) => (text.length > longest.length ? text : longest),
  '',
);

export function SuperscalarDatapath(props: {
  trace: CycleTrace | null;
  cycleKey: number;
  tier: DepthTier;
  /** The engine BEHAVIORS the trace was recorded under — the second and third visibility axes. */
  config: DatapathConfig;
  /** The followed instruction's stable id (INV-4), or `null`. With up to ten instructions lighting
   *  the diagram at once, the id is the only thing that can pick one out: the stage hue says which
   *  STAGE a wire is doing and the lane tint says which SLOT, but neither says WHICH INSTRUCTION —
   *  and a slot is not a stable lane, so the seat cannot stand in for identity. */
  followed?: string | null;
}): React.JSX.Element {
  const { trace, tier, config, followed = null } = props;
  const act = useMemo(() => activate(trace), [trace]);
  const labels = showValueLabels(tier);
  const controls = showControlLabels(tier);
  // The WIDTH picks a whole geometry, where the other two axes only filter one. `activate` still
  // lights the full lane universe (INV-2); this is where the machine's own size is chosen.
  const geom = useMemo(() => geometryFor(config.issueWidth), [config.issueWidth]);

  const wires: WireVM[] = geom.wires
    .filter((wire) => wireVisibleAt(wire, tier, config))
    .map((wire) => {
      const a = act.wires.get(wire.id);
      return {
        id: wire.id,
        points: wire.points,
        active: a !== undefined,
        // The hue is the STAGE's, not the lane's: ten instructions, five colors, one cycle.
        color: a ? PHASE_COLORS[a.stage] : undefined,
        label: a && labels && a.value !== undefined ? fmtValue(a.value, a.fmt) : undefined,
        // Ring the followed instruction's own work. Only WIRES can carry this — a component box is
        // shared (the register file is read and written in one cycle), which is the same reason a
        // shared box carries no hue.
        followed: a !== undefined && followed !== null && a.instr === followed,
      };
    });

  const nodes: NodeVM[] = Array.from(geom.nodes.values())
    .filter((node) => nodeVisibleAt(node, tier, config))
    .map((node) => ({
      ...node,
      active: act.components.has(node.id),
      // Only REPLICATED units carry a lane, so only they are tinted. The renderer applies it to the
      // active state alone, which is what keeps "one lane lit, one dark" readable.
      hue: node.lane === undefined ? undefined : LANE_COLORS[node.lane],
      controlLabel: controls ? node.controlLabel : undefined,
    }));

  // Stage swatches, then a lane swatch per lane the machine actually has. Every swatch sits beside
  // its own word, which is the relief rule the light magenta makes mandatory rather than optional.
  const legend: LegendItem[] = [
    ...STAGES.map((s) => ({ label: STAGE_LABELS[s], color: PHASE_COLORS[s] ?? T.accent })),
    ...LANES.filter((lane) => lane < config.issueWidth).map((lane) => ({
      label: `Lane ${lane}`,
      color: LANE_COLORS[lane],
    })),
  ];

  // The pairing verdict, named where the picture raises the question. It appears only when the
  // issue unit actually refused someone this cycle — the same condition that lights the box.
  const refusalText = act.refusal ? REFUSAL_TEXT[act.refusal.reason] : undefined;

  return (
    <DatapathDiagram
      title={`Superscalar datapath — ${config.issueWidth}-wide`}
      ariaLabel={`In-order superscalar datapath, ${config.issueWidth} instructions per cycle`}
      canvas={geom.canvas}
      wires={wires}
      nodes={nodes}
      markerPrefix="ss"
      legend={legend}
      headerRight={
        /* ALWAYS rendered, and merely hidden on a cycle that refused nobody — the header is a flex
           row, and a chip that carries a border and 0.78rem text is taller than the `panel-heading`
           beside it, so drawing it conditionally grew the whole datapath panel by 4.2px on exactly
           the cycles a reader is studying (measured in the shipped bundle at 1400px and at 980px,
           2026-07-30). Small, but it lands on top of the issue readout's own jump directly below and
           moves every panel under both.

           The hidden state carries {@link LONGEST_REFUSAL_TEXT} rather than an empty string: the
           reserve has to be the height of the WIDEST thing this chip can say, or the header would
           still change height on the day one refusal reason wraps and another does not. Same
           mechanism as the pipeline map's follow readout — `visibility: hidden` holds the layout open
           and takes the placeholder out of the accessibility tree, so nothing reads out a refusal
           that did not happen. */
        <span
          className="dp-verdict"
          style={refusalText ? undefined : { visibility: 'hidden' }}
          title={act.refusal ? `Issue refusal: ${act.refusal.reason}` : undefined}
        >
          {refusalText ?? LONGEST_REFUSAL_TEXT}
        </span>
      }
    />
  );
}
