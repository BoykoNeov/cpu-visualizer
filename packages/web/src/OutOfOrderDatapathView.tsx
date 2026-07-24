/**
 * The out-of-order datapath view (M9 step 7) — a thin wrapper over the shared {@link DatapathDiagram}
 * renderer, the fifth sibling of the single-cycle {@link Datapath}, multi-cycle, pipeline and
 * superscalar wrappers. This module owns the out-of-order POLICY only; all drawing lives in the
 * renderer.
 *
 * The defining difference from the four predecessors: activation reads `state.micro` (box occupancy)
 * AND this cycle's `events` (flow), because an out-of-order `location` is uniformly `"ROB#tag"` and
 * carries no stage to source occupancy from — see `datapath-out-of-order.ts`'s header. What this
 * wrapper owns is unchanged from the pattern: it maps geometry × activation × tier → view-models and
 * hands them to the renderer.
 *
 * Hue is per-WIRE (the region's phase colour), exactly as the pipeline/superscalar views, so the
 * diagram reads left-to-right in the same validated palette as the map above it; boxes stay
 * hue-neutral because every one is a shared pool (the ROB, the RS, the FU pool all serve many
 * instructions at once — M3's pinned reason for hue-neutral boxes). The follow-ring rides the wires
 * the followed instruction lights this cycle, composing with the ROB/RS/rename table rows the same
 * click lights (step 6).
 *
 * ONE visibility axis of substance — the depth tier's REPRESENTATION (values at `detailed`+). The
 * structure is all essential, so nothing is hidden structurally; the single config gate is the
 * predictor's bet redirect, absent when the machine does not bet.
 */

import type { DepthTier } from '@cpu-viz/curriculum';
import type { CycleTrace } from '@cpu-viz/trace';
import { useMemo } from 'react';
import {
  activate,
  CANVAS,
  NODES,
  nodeVisibleAt,
  REGION_PHASE,
  showValueLabels,
  WIRES,
  wireVisibleAt,
  type DatapathConfig,
  type Region,
} from './datapath-out-of-order';
import { DatapathDiagram, fmtValue, type NodeVM, type WireVM } from './DatapathDiagram';
import { PHASE_COLORS, T } from './theme';

/** The redirect region rides the accent rather than a phase hue — it is a control action, not a
 *  dataflow stage, so it deliberately sits outside the five-phase palette. */
const REDIRECT_COLOR = T.accent;

function regionColor(region: Region): string {
  return region === 'redirect' ? REDIRECT_COLOR : (PHASE_COLORS[REGION_PHASE[region]] ?? T.accent);
}

/** The legend: the five regions in flow order, plus the redirect. */
const LEGEND: readonly { label: string; color: string }[] = [
  { label: 'Fetch', color: regionColor('fetch') },
  { label: 'Decode / rename', color: regionColor('decode') },
  { label: 'Issue / execute', color: regionColor('execute') },
  { label: 'Memory', color: regionColor('memory') },
  { label: 'Broadcast / commit', color: regionColor('broadcast') },
  { label: 'Redirect', color: regionColor('redirect') },
];

export function OutOfOrderDatapath(props: {
  trace: CycleTrace | null;
  cycleKey: number;
  tier: DepthTier;
  /** The engine behaviour the diagram's structure depends on — just the predictor here. */
  config: DatapathConfig;
  /** The followed instruction's stable id (INV-4), or `null` — rings the wires it lights this cycle,
   *  the same identity the ROB/RS/rename table rows carry. */
  followed?: string | null;
}): React.JSX.Element {
  const { trace, tier, config, followed = null } = props;
  // `followed` participates: on a double retire, `activate` attributes the single commit wire to the
  // followed instruction (see its doc), so the memo must re-run when the followed id changes.
  const act = useMemo(() => activate(trace, followed), [trace, followed]);
  const labels = showValueLabels(tier);

  const wires: WireVM[] = WIRES.filter((wire) => wireVisibleAt(wire, tier, config)).map((wire) => {
    const a = act.wires.get(wire.id);
    return {
      id: wire.id,
      points: wire.points,
      active: a !== undefined,
      // The hue is the REGION's, not the diagram's — one palette across the whole family.
      color: a ? regionColor(a.region) : undefined,
      label: a && labels && a.value !== undefined ? fmtValue(a.value, a.fmt) : undefined,
      // Ring the followed instruction's own work. Only WIRES carry this (a pool box belongs to no
      // single instruction, the renderer's pinned reason there is no node counterpart).
      followed: a !== undefined && followed !== null && a.instr === followed,
    };
  });

  const nodes: NodeVM[] = Array.from(NODES.values())
    .filter((node) => nodeVisibleAt(node, tier, config))
    .map((node) => ({
      ...node,
      active: act.components.has(node.id),
    }));

  return (
    <DatapathDiagram
      title="Out-of-order datapath"
      ariaLabel="out-of-order (Tomasulo) datapath: reorder buffer, reservation stations, common data bus"
      canvas={CANVAS}
      wires={wires}
      nodes={nodes}
      markerPrefix="ooo"
      legend={LEGEND.map((l) => ({ ...l }))}
    />
  );
}
