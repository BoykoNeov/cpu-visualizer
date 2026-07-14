/**
 * The single-cycle datapath view (handoff §11 step 8; §14 "datapath rendering: SVG, hand-authored
 * layout") — a thin wrapper over the shared {@link DatapathDiagram} renderer. This module owns the
 * single-cycle POLICY only: which elements are visible at the depth tier, which are active given
 * {@link activate}'s report, and the within-cycle phase stepper (Fetch→…→Writeback) that
 * progressively reveals the path — the animation "sub-cycle phases" of §5, derived from the trace,
 * not baked into the engine (INV-2). All drawing (shapes, arrows, flow animation, labels, theme)
 * lives in the renderer.
 *
 * DEPTH TIER (step 9, handoff §4): the `tier` prop selects the representational fidelity drawn
 * over the (tier-invariant) geometry. `essentials` shows the bare lit path; `detailed` adds the
 * value on each active wire ({@link showValueLabels}); `expert` adds the mux control-line labels
 * ({@link showControlLabels}). The filter is purely a render concern — {@link activate} always
 * reports the full expert path with values; this wrapper chooses which labels to hand the
 * renderer. (The {@link nodeVisibleAt}/{@link wireVisibleAt} geometry filter is also applied, but
 * no single-cycle node sets `minTier`, so it is a no-op here — it is kept for the pipeline tier.)
 */

import type { DepthTier } from '@cpu-viz/curriculum';
import type { CycleTrace } from '@cpu-viz/trace';
import { useEffect, useMemo, useState } from 'react';
import {
  activate,
  CANVAS,
  NODES,
  nodeVisibleAt,
  PHASE_LABELS,
  PHASES,
  phaseVisibleAt,
  showControlLabels,
  showValueLabels,
  WIRES,
  wireVisibleAt,
  type Phase,
} from './datapath';
import { DatapathDiagram, fmtValue, PhaseChips, type NodeVM, type WireVM } from './DatapathDiagram';
import { PHASE_COLORS } from './theme';

export function Datapath(props: {
  trace: CycleTrace | null;
  cycleKey: number;
  tier: DepthTier;
}): React.JSX.Element {
  const { trace, cycleKey, tier } = props;
  // The phase stepper is view-local: the recorder cursor is per-cycle, so there is no sub-cycle
  // index in the trace. Default to the final phase (whole path visible) and reset on cycle change.
  const [phase, setPhase] = useState<Phase>('WB');
  useEffect(() => setPhase('WB'), [cycleKey]);

  const act = useMemo(() => activate(trace), [trace]);
  const phaseIdx = PHASES.indexOf(phase);
  const labels = showValueLabels(tier);
  const controls = showControlLabels(tier);

  const wires: WireVM[] = WIRES.filter((wire) => wireVisibleAt(wire, tier)).map((wire) => {
    const a = act.wires.get(wire.id);
    const active = a !== undefined && phaseVisibleAt(wire.stage, phase);
    return {
      id: wire.id,
      points: wire.points,
      active,
      // `essentials` omits ALL value labels (showing only some would imply a value with no source).
      label: active && labels && a.value !== undefined ? fmtValue(a.value, a.fmt) : undefined,
    };
  });

  const nodes: NodeVM[] = Array.from(NODES.values())
    .filter((node) => nodeVisibleAt(node, tier))
    .map((node) => ({
      ...node,
      active: act.components.has(node.id) && phaseIdx >= PHASES.indexOf(node.stage),
      // `expert` reveals each mux's control-line label (handoff §4).
      controlLabel: controls ? node.controlLabel : undefined,
    }));

  return (
    <DatapathDiagram
      title="Single-cycle datapath"
      ariaLabel="single-cycle datapath"
      canvas={CANVAS}
      wires={wires}
      nodes={nodes}
      markerPrefix="sc"
      headerRight={
        <PhaseChips
          phases={PHASES}
          labels={PHASE_LABELS}
          colors={PHASE_COLORS}
          active={phase}
          onSelect={setPhase}
          disabled={!trace}
          titleOf={(p) => `Reveal up to ${PHASE_LABELS[p]}`}
        />
      }
    />
  );
}
