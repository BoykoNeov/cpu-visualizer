/**
 * The deep 7-stage pipeline datapath view (M11 step 7) — a thin wrapper over the shared
 * {@link DatapathDiagram} renderer, the sixth sibling of the single-cycle, multi-cycle, pipeline,
 * superscalar and out-of-order wrappers. This module owns POLICY only; all drawing lives in the
 * renderer.
 *
 * **The one thing this wrapper does that no sibling does: it maps SEVEN stages onto FIVE hues.**
 * `PHASE_COLORS` holds the five validated phase colours, and this machine has seven stages — so a
 * wire is stroked in the hue of its stage's FAMILY via {@link stageFamily}, the same function the
 * pipeline MAP uses for the same reason. `IF1`/`IF2` share the fetch hue and `EX1`/`EX2` the execute
 * one. That is the rule `superscalar-visuals.md` pins for going past five: **never invent a hue** —
 * the extra stages stay individually readable through their labels (the relief rule), here the latch
 * bars' own text and the map's cell text.
 *
 * Indexing `PHASE_COLORS` by the raw stage would return `undefined` for four of the seven and quietly
 * fall back to the renderer's default stroke, so the "seven stages, five hues" claim would fail while
 * everything still rendered. `datapath-deep-pipeline.test.ts` and this file's render smoke tests pin
 * the count of DISTINCT colours rather than trusting the mapping.
 *
 * The LEGEND therefore has five entries, not seven: it is a key to the hues, and a seven-row legend
 * with two pairs of identical swatches would say the opposite of what is true.
 *
 * TWO VISIBILITY AXES, exactly as the 5-stage:
 *   - `tier` — `essentials` draws the seven-stage skeleton with contraction wires standing in for
 *     the hidden muxes and no value labels; `detailed` reveals the writeback mux and adds values;
 *     `expert` adds the forwarding unit, both forwarding muxes, the hazard unit, and control labels.
 *   - `config` — the user's engine settings as BEHAVIORS. With forwarding off the unit and its muxes
 *     are absent (not dimmed); with prediction betting taken, the branch-target adder and its
 *     redirect appear.
 *
 * `activate` is oblivious to both (INV-2): it always lights the full expert path and its
 * contractions. This wrapper chooses what to hand the renderer.
 */

import type { DepthTier } from '@cpu-viz/curriculum';
import type { CycleTrace } from '@cpu-viz/trace';
import { useMemo } from 'react';
import {
  activate,
  CANVAS,
  FAMILIES,
  FAMILY_LABELS,
  NODES,
  nodeVisibleAt,
  showControlLabels,
  showValueLabels,
  WIRES,
  wireVisibleAt,
  type DatapathConfig,
} from './datapath-deep-pipeline';
import { DatapathDiagram, fmtValue, type NodeVM, type WireVM } from './DatapathDiagram';
import { stageFamily } from './pipeline-map';
import { PHASE_COLORS, T } from './theme';

export function DeepPipelineDatapath(props: {
  trace: CycleTrace | null;
  cycleKey: number;
  tier: DepthTier;
  /** The engine BEHAVIORS the trace was recorded under — the second visibility axis. */
  config: DatapathConfig;
  /**
   * The followed instruction's stable id (INV-4), or `null`. With SEVEN instructions lighting the
   * diagram at once, the id is the only thing that can pick one out of the tangle — and here more
   * so than on the 5-stage, since two pairs of stages now share a hue.
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
      // The hue is the stage FAMILY's — seven stages, five colours (see the file docs).
      color: a ? PHASE_COLORS[stageFamily(a.stage)] : undefined,
      label: a && labels && a.value !== undefined ? fmtValue(a.value, a.fmt) : undefined,
      // Ring the followed instruction's own work. Only WIRES carry this: a component box is shared
      // (the register file is read by ID and written by WB in one cycle), which is the same reason
      // it carries no hue — so there is deliberately no node counterpart.
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

  const legend = FAMILIES.map((f) => ({
    label: FAMILY_LABELS[f] ?? f,
    color: PHASE_COLORS[f] ?? T.accent,
  }));

  return (
    <DatapathDiagram
      title="Deep pipeline datapath"
      ariaLabel="7-stage deep pipeline datapath"
      canvas={CANVAS}
      wires={wires}
      nodes={nodes}
      markerPrefix="dp7"
      legend={legend}
    />
  );
}
