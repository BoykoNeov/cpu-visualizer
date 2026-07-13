/**
 * The SVG multi-cycle datapath view (M2 step 5b) — the counterpart to M1's single-cycle
 * {@link Datapath}. It renders the fixed geometry from {@link datapath-multi} and lights the
 * components/wires that {@link activate} reports for the current cycle.
 *
 * The defining difference from single-cycle: each multi-cycle `CycleTrace` is exactly ONE phase
 * (`instructions[0].location`). So there is NO view-local phase stepper — scrubbing the timeline
 * IS the phase walk (IF→ID→EX→MEM→WB), and this view simply lights the slice `activate` returns
 * for the cycle at the cursor, showing the current phase as a badge. A component/wire is either
 * active this cycle or idle; there is no within-cycle progressive reveal to gate.
 *
 * DEPTH TIER (handoff §4): the `tier` prop selects BOTH the structure and the representation drawn
 * over the geometry. `essentials` hides the three muxes ({@link nodeVisibleAt}) and draws the
 * contraction wires in their place, with no value labels; `detailed` reveals the muxes, swaps in
 * the through-mux wires, and adds wire values ({@link showValueLabels}); `expert` adds the mux
 * control-line labels ({@link showControlLabels}). {@link activate} is tier-oblivious — it always
 * lights the full expert slice and its contraction; this view chooses what to draw.
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
  type DatapathNode,
  type Fmt,
} from './datapath-multi';
import { hex32 } from './format';

const ACTIVE = '#1e6fe0';
const ACTIVE_FILL = '#eaf2fe';
const IDLE = '#c8ccd4';
const IDLE_FILL = '#fbfbfc';
const TEXT = '#333';

function fmtValue(value: number, fmt: Fmt): string {
  return fmt === 'hex' ? hex32(value) : String(value | 0);
}

/** Points → an SVG polyline `points` string. */
function polyline(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

/** Midpoint of a polyline (by segment index) for placing a value label. */
function midOf(points: readonly (readonly [number, number])[]): readonly [number, number] {
  const i = Math.max(0, Math.floor((points.length - 1) / 2));
  const a = points[i]!;
  const b = points[Math.min(points.length - 1, i + 1)]!;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export function MultiCycleDatapath(props: {
  trace: CycleTrace | null;
  cycleKey: number;
  tier: DepthTier;
}): React.JSX.Element {
  const { trace, tier } = props;
  const act = useMemo(() => activate(trace), [trace]);

  return (
    <section
      style={{
        border: '1px solid #d0d0d8',
        borderRadius: 8,
        padding: '0.75rem 1rem 0.5rem',
        background: '#fff',
        marginTop: '1rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '1rem',
          flexWrap: 'wrap',
          marginBottom: '0.4rem',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: '0.8rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: '#555',
          }}
        >
          Multi-cycle datapath
        </h2>
        <PhaseTrack phase={act.phase} />
      </div>
      <svg
        viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="multi-cycle datapath"
      >
        <defs>
          <marker
            id="mc-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill={ACTIVE} />
          </marker>
          <marker
            id="mc-arrow-idle"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill={IDLE} />
          </marker>
        </defs>

        {/* Wires first, so component boxes sit on top of their endpoints. */}
        {WIRES.map((wire) => {
          if (!wireVisibleAt(wire, tier)) return null;
          const on = act.wires.has(wire.id);
          return (
            <polyline
              key={wire.id}
              points={polyline(wire.points)}
              fill="none"
              stroke={on ? ACTIVE : IDLE}
              strokeWidth={on ? 2.4 : 1.3}
              markerEnd={on ? 'url(#mc-arrow)' : 'url(#mc-arrow-idle)'}
            />
          );
        })}

        {/* Value labels on active wires — a `detailed`+ representational detail (handoff §4). */}
        {showValueLabels(tier) &&
          WIRES.map((wire) => {
            if (!wireVisibleAt(wire, tier)) return null;
            const a = act.wires.get(wire.id);
            if (!a || a.value === undefined) return null;
            const [mx, my] = midOf(wire.points);
            const text = fmtValue(a.value, a.fmt);
            return (
              <g key={`v-${wire.id}`}>
                <rect
                  x={mx - text.length * 3.2 - 3}
                  y={my - 8}
                  width={text.length * 6.4 + 6}
                  height={14}
                  rx={3}
                  fill="#fff"
                  stroke={ACTIVE}
                  strokeWidth={0.6}
                  opacity={0.95}
                />
                <text
                  x={mx}
                  y={my + 2}
                  textAnchor="middle"
                  fontSize={9}
                  fontFamily="ui-monospace, monospace"
                  fill={ACTIVE}
                >
                  {text}
                </text>
              </g>
            );
          })}

        {/* Components. `expert` also reveals each mux's control-line label (handoff §4). */}
        {Array.from(NODES.values())
          .filter((node) => nodeVisibleAt(node, tier))
          .map((node) => (
            <NodeShape
              key={node.id}
              node={node}
              active={act.components.has(node.id)}
              showControl={showControlLabels(tier)}
            />
          ))}
      </svg>
    </section>
  );
}

/** Draw one component as a box / mux / adder, highlighted when active this cycle. At `expert`
 *  tier (`showControl`) a mux also gets its control-line label (e.g. "IorD"). */
function NodeShape(props: {
  node: DatapathNode;
  active: boolean;
  showControl: boolean;
}): React.JSX.Element {
  const { node, active, showControl } = props;
  const stroke = active ? ACTIVE : IDLE;
  const fill = active ? ACTIVE_FILL : IDLE_FILL;
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const lines = node.label.split('\n');

  let shape: React.JSX.Element;
  if (node.shape === 'mux') {
    const { x, y, w, h } = node;
    shape = (
      <polygon
        points={`${x},${y} ${x + w},${y + w} ${x + w},${y + h - w} ${x},${y + h}`}
        fill={fill}
        stroke={stroke}
        strokeWidth={active ? 2 : 1.2}
      />
    );
  } else if (node.shape === 'adder') {
    const { x, y, w, h } = node;
    const notch = h * 0.18;
    shape = (
      <polygon
        points={`${x},${y} ${x + w},${y + h * 0.28} ${x + w},${y + h * 0.72} ${x},${y + h} ${x},${y + h / 2 + notch} ${x + w * 0.22},${y + h / 2} ${x},${y + h / 2 - notch}`}
        fill={fill}
        stroke={stroke}
        strokeWidth={active ? 2 : 1.2}
      />
    );
  } else {
    shape = (
      <rect
        x={node.x}
        y={node.y}
        width={node.w}
        height={node.h}
        rx={5}
        fill={fill}
        stroke={stroke}
        strokeWidth={active ? 2 : 1.2}
      />
    );
  }

  return (
    <g>
      {shape}
      {lines.map((line, i) => (
        <text
          key={i}
          x={cx}
          y={cy + 4 + (i - (lines.length - 1) / 2) * 12}
          textAnchor="middle"
          fontSize={node.shape === 'mux' ? 8 : 11}
          fontWeight={600}
          fill={active ? ACTIVE : TEXT}
        >
          {line}
        </text>
      ))}
      {showControl && node.controlLabel ? (
        <text
          x={cx}
          y={node.y - 4}
          textAnchor="middle"
          fontSize={7.5}
          fontStyle="italic"
          fill={active ? ACTIVE : '#8a8f99'}
        >
          {node.controlLabel}
        </text>
      ) : null}
    </g>
  );
}

/** The five within-instruction phases, with the current one (from the trace) highlighted. Unlike
 *  single-cycle's stepper these are NOT buttons — the phase is a property of the cycle at the
 *  cursor, so scrubbing the transport walks them. */
function PhaseTrack(props: { phase: string | null }): React.JSX.Element {
  const { phase } = props;
  return (
    <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', flexWrap: 'wrap' }}>
      {PHASES.map((p) => {
        const on = p === phase;
        return (
          <span
            key={p}
            title={`${PHASE_LABELS[p]} phase`}
            style={{
              fontSize: '0.72rem',
              padding: '0.15rem 0.45rem',
              borderRadius: 5,
              border: `1px solid ${on ? ACTIVE : '#ddd'}`,
              background: on ? ACTIVE : '#f7f7f9',
              color: on ? '#fff' : '#999',
              fontWeight: on ? 600 : 400,
            }}
          >
            {PHASE_LABELS[p]}
          </span>
        );
      })}
    </div>
  );
}
