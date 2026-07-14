/**
 * The multi-cycle datapath view (M2 step 5b) — a thin wrapper over the shared
 * {@link DatapathDiagram} renderer, the counterpart to the single-cycle {@link Datapath} wrapper.
 * This module owns the multi-cycle POLICY only; all drawing lives in the renderer.
 *
 * The defining difference from single-cycle: each multi-cycle `CycleTrace` is exactly ONE phase
 * (`instructions[0].location`). So there is NO view-local phase stepper — scrubbing the timeline
 * IS the phase walk (IF→ID→EX→MEM→WB), and this view simply lights the slice `activate` returns
 * for the cycle at the cursor, showing the current phase as a passive chip track. A component/wire
 * is either active this cycle or idle; there is no within-cycle progressive reveal to gate.
 *
 * DEPTH TIER (handoff §4): the `tier` prop selects BOTH the structure and the representation drawn
 * over the geometry. `essentials` hides the three muxes ({@link nodeVisibleAt}) and draws the
 * contraction wires in their place, with no value labels; `detailed` reveals the muxes, swaps in
 * the through-mux wires, and adds wire values ({@link showValueLabels}); `expert` adds the mux
 * control-line labels ({@link showControlLabels}). {@link activate} is tier-oblivious — it always
 * lights the full expert slice and its contraction; this wrapper chooses what to hand the renderer.
 */

import type { DepthTier } from '@cpu-viz/curriculum';
import type { CycleTrace } from '@cpu-viz/trace';
import { useMemo } from 'react';
import {
  activate,
  CANVAS,
  NODES,
  nodeVisibleAt,
  PHASE_LABELS,
  PHASES,
  showControlLabels,
  showValueLabels,
  WIRES,
  wireVisibleAt,
} from './datapath-multi';
import { DatapathDiagram, fmtValue, PhaseChips, type NodeVM, type WireVM } from './DatapathDiagram';
import { PHASE_COLORS } from './theme';

export function MultiCycleDatapath(props: {
  trace: CycleTrace | null;
  cycleKey: number;
  tier: DepthTier;
}): React.JSX.Element {
  const { trace, tier } = props;
  const act = useMemo(() => activate(trace), [trace]);
  const labels = showValueLabels(tier);
  const controls = showControlLabels(tier);

  const wires: WireVM[] = WIRES.filter((wire) => wireVisibleAt(wire, tier)).map((wire) => {
    const a = act.wires.get(wire.id);
    const active = a !== undefined;
    return {
      id: wire.id,
      points: wire.points,
      active,
      label: active && labels && a.value !== undefined ? fmtValue(a.value, a.fmt) : undefined,
    };
  });

  const nodes: NodeVM[] = Array.from(NODES.values())
    .filter((node) => nodeVisibleAt(node, tier))
    .map((node) => ({
      ...node,
      active: act.components.has(node.id),
      controlLabel: controls ? node.controlLabel : undefined,
    }));

  return (
    <DatapathDiagram
      title="Multi-cycle datapath"
      ariaLabel="multi-cycle datapath"
      canvas={CANVAS}
      wires={wires}
      nodes={nodes}
      markerPrefix="mc"
      headerRight={
        <PhaseChips
          phases={PHASES}
          labels={PHASE_LABELS}
          colors={PHASE_COLORS}
          active={act.phase}
          titleOf={(p) => `${PHASE_LABELS[p]} phase`}
        />
      }
    />
  );
}
