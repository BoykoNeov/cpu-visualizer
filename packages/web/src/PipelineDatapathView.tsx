/**
 * The pipeline datapath view (M3 step 6) — a thin wrapper over the shared {@link DatapathDiagram}
 * renderer, the third sibling of the single-cycle {@link Datapath} and {@link MultiCycleDatapath}
 * wrappers. This module owns the pipeline POLICY only; all drawing lives in the renderer.
 *
 * The defining difference from both predecessors: a cycle lights up to FIVE stage slices for FIVE
 * DIFFERENT instructions at once. So there is no single "current phase" to hue the diagram with —
 * single-cycle lit one instruction's whole path, multi-cycle lit its one in-flight instruction's
 * one phase, and each could paint the lit slice in one color. Here the hue is per-WIRE: each lit
 * wire is stroked in the hue of the stage whose work it is doing, so IF→WB read left-to-right
 * across the diagram simultaneously, in the same validated palette the chips and the multi-cycle
 * view use. Component boxes stay hue-NEUTRAL, which is not a shortcut but the only coherent
 * choice: the register file is read by ID and written by WB in the SAME cycle (the pinned
 * same-cycle WB→ID rule), and every latch bar is written by the stage on its left while the stage
 * on its right reads it — there is no one stage such a box belongs to.
 *
 * TWO VISIBILITY AXES (a first — M1/M2 had only the tier):
 *   - `tier` selects structure and representation, as before: `essentials` draws the five-stage
 *     skeleton with contraction wires standing in for the hidden muxes and no value labels;
 *     `detailed` reveals the writeback mux and adds values; `expert` adds the forwarding unit, both
 *     forwarding muxes, the hazard unit, and the control-line labels.
 *   - `config` — the user's engine settings, as BEHAVIORS — decides what EXISTS at all. With
 *     forwarding off the unit and its muxes are absent (not dimmed), because the trace genuinely
 *     has no `forward` events in that position and an idle forwarding network would contradict it.
 *     With prediction on (M4 step 5) the branch-target adder and its redirect appear, for the mirror
 *     reason: a machine that predicts not-taken takes no action to draw.
 *
 * {@link activate} is oblivious to both (INV-2): it always lights the full expert path and its
 * contractions, in either config. This wrapper chooses what to hand the renderer.
 */

import type { DepthTier } from '@cpu-viz/curriculum';
import type { CycleTrace } from '@cpu-viz/trace';
import { useMemo } from 'react';
import {
  activate,
  CANVAS,
  NODES,
  nodeVisibleAt,
  showControlLabels,
  showValueLabels,
  STAGE_LABELS,
  STAGES,
  WIRES,
  wireVisibleAt,
  type DatapathConfig,
} from './datapath-pipeline';
import { DatapathDiagram, fmtValue, type NodeVM, type WireVM } from './DatapathDiagram';
import { PHASE_COLORS, T } from './theme';

export function PipelineDatapath(props: {
  trace: CycleTrace | null;
  cycleKey: number;
  tier: DepthTier;
  /**
   * The engine BEHAVIORS the trace was recorded under — the second visibility axis. Behaviors
   * rather than config values: `branchPrediction` has three names and two machines, and the
   * diagram can only draw a machine (see {@link DatapathConfig}).
   */
  config: DatapathConfig;
  /**
   * The followed instruction's stable id (M3 step 7), or `null`. This is the payoff of step 6's
   * decision to carry `instr` on every lit wire: with five instructions lighting the diagram at
   * once, the id is the only thing that can pick one out of the tangle — the hue says which STAGE a
   * wire is doing, never which instruction.
   */
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
      // The hue is the STAGE's, not the diagram's: five instructions, five colors, one cycle.
      color: a ? PHASE_COLORS[a.stage] : undefined,
      label: a && labels && a.value !== undefined ? fmtValue(a.value, a.fmt) : undefined,
      // Ring the followed instruction's own work. Only WIRES can carry this: a component box is
      // shared (the register file is read by ID and written by WB in one cycle), which is the
      // same reason it carries no hue — so there is deliberately no node counterpart.
      followed: a !== undefined && followed !== null && a.instr === followed,
    };
  });

  const nodes: NodeVM[] = Array.from(NODES.values())
    .filter((node) => nodeVisibleAt(node, tier, config))
    .map((node) => ({
      ...node,
      active: act.components.has(node.id),
      controlLabel: controls ? node.controlLabel : undefined,
    }));

  const legend = STAGES.map((s) => ({
    label: STAGE_LABELS[s],
    color: PHASE_COLORS[s] ?? T.accent,
  }));

  return (
    <DatapathDiagram
      title="Pipeline datapath"
      ariaLabel="5-stage pipeline datapath"
      canvas={CANVAS}
      wires={wires}
      nodes={nodes}
      markerPrefix="pl"
      legend={legend}
    />
  );
}
