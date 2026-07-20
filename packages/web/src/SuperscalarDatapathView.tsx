/**
 * The superscalar datapath view (M7 step 7) — a thin wrapper over the shared {@link DatapathDiagram}
 * renderer, the fourth sibling of the single-cycle, multi-cycle and pipeline wrappers. This module
 * owns POLICY only; all drawing lives in the renderer.
 *
 * The defining difference from M3: a cycle lights up to TEN stage slices for TEN different
 * instructions — two per stage. That is one identity channel more than the pipeline needed, so this
 * is the first view in the project to spend all three at once:
 *
 *   - **wire stroke = STAGE** (`PHASE_COLORS`), exactly as the pipeline view and the pipeline map.
 *     Two EX-hued clusters side by side is precisely the reading this tier exists to produce:
 *     *two instructions in EX*. Hue-ing wires by lane instead would have made `EX.0` and `EX.1`
 *     different colors and destroyed it — see `datapath-superscalar.ts` for the full argument and
 *     why it overrides `superscalar-visuals.md`'s original proposal.
 *   - **node tint = ISSUE LANE** (`--lane-0` / `--lane-1`), on replicated boxes ONLY. A shared box
 *     stays hue-neutral for M3's pinned reason (the register file is read by ID and written by WB
 *     in one cycle, so it belongs to no single anything); a replicated box does not have that
 *     problem, which is exactly what makes it the one thing that can carry the lane.
 *   - **follow ring = IDENTITY**, hue-free, composing with both.
 *
 * THREE VISIBILITY AXES (M3 had two):
 *   - `tier` selects structure and representation, as before.
 *   - `forwarding` / `predictTaken` decide what EXISTS, as before.
 *   - **`issueWidth`** decides how many lanes exist. At width 1 the second lane and the issue unit
 *     are ABSENT, not dimmed — the trace has no `.1` occupant and no pairing refusal to put there,
 *     so drawing an idle lane would contradict it (INV-5). This is what makes the width toggle
 *     visibly restructure the diagram, which is the flagship 1↔2 A/B of the whole milestone.
 *
 * {@link activate} is oblivious to all three (INV-2): it always lights the full expert path and its
 * contractions, at either width. This wrapper chooses what to hand the renderer.
 */

import type { DepthTier } from '@cpu-viz/curriculum';
import type { CycleTrace } from '@cpu-viz/trace';
import { useMemo } from 'react';
import {
  activate,
  CANVAS,
  LANES,
  NODES,
  nodeVisibleAt,
  showControlLabels,
  showValueLabels,
  STAGE_LABELS,
  STAGES,
  WIRES,
  wireVisibleAt,
  type DatapathConfig,
  type Lane,
} from './datapath-superscalar';
import { DatapathDiagram, fmtValue, type LegendItem, type NodeVM, type WireVM } from './DatapathDiagram'; // prettier-ignore
import { PHASE_COLORS, T } from './theme';

/** The lane hues, as token references — never a hex in TSX (that is what makes light/dark free). */
export const LANE_COLORS: Readonly<Record<Lane, string>> = { 0: 'var(--lane-0)', 1: 'var(--lane-1)' }; // prettier-ignore

/** How a pairing refusal reads in the legend caption — the three verdicts, in plain words. The
 *  full readout is step 8's job; this is the one-line version the diagram can carry today, and it
 *  exists because "why is that lane dark?" is the question the picture provokes. */
export const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  'mem-port': 'refused: one data-memory port',
  'branch-slot': 'refused: one branch unit',
  'intra-pair-raw': 'refused: it reads what its partner writes',
};

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

  const wires: WireVM[] = WIRES.filter((wire) => wireVisibleAt(wire, tier, config)).map((wire) => {
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

  const nodes: NodeVM[] = Array.from(NODES.values())
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
      canvas={CANVAS}
      wires={wires}
      nodes={nodes}
      markerPrefix="ss"
      legend={legend}
      headerRight={
        refusalText ? (
          <span className="dp-verdict" title={`Issue refusal: ${act.refusal!.reason}`}>
            {refusalText}
          </span>
        ) : undefined
      }
    />
  );
}
