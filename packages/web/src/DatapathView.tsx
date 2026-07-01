/**
 * The SVG single-cycle datapath view (handoff §11 step 8; §14 "datapath rendering: SVG,
 * hand-authored layout"). It renders the fixed geometry from {@link datapath} and lights the
 * components/wires that {@link activate} reports for the current cycle, labelling active wires
 * with the value flowing on them. A within-cycle phase stepper (Fetch→…→Writeback) progressively
 * reveals the path — the animation "sub-cycle phases" of §5, derived from the trace, not baked
 * into the engine (INV-2). Depth tiers are a later step (9); this view is tier-oblivious.
 */

import type { CycleTrace } from '@cpu-viz/trace';
import { useEffect, useMemo, useState } from 'react';
import {
  activate,
  CANVAS,
  NODES,
  PHASE_LABELS,
  PHASES,
  phaseVisibleAt,
  WIRES,
  type DatapathNode,
  type Fmt,
  type Phase,
} from './datapath';
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

export function Datapath(props: { trace: CycleTrace | null; cycleKey: number }): React.JSX.Element {
  const { trace, cycleKey } = props;
  // The phase stepper is view-local: the recorder cursor is per-cycle, so there is no sub-cycle
  // index in the trace. Default to the final phase (whole path visible) and reset on cycle change.
  const [phase, setPhase] = useState<Phase>('WB');
  useEffect(() => setPhase('WB'), [cycleKey]);

  const act = useMemo(() => activate(trace), [trace]);
  const phaseIdx = PHASES.indexOf(phase);

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
          Single-cycle datapath
        </h2>
        <PhaseStepper phase={phase} setPhase={setPhase} disabled={!trace} />
      </div>
      <svg
        viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="single-cycle datapath"
      >
        <defs>
          <marker
            id="arrow"
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
            id="arrow-idle"
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
          const a = act.wires.get(wire.id);
          const on = a !== undefined && phaseVisibleAt(wire.stage, phase);
          return (
            <polyline
              key={wire.id}
              points={polyline(wire.points)}
              fill="none"
              stroke={on ? ACTIVE : IDLE}
              strokeWidth={on ? 2.4 : 1.3}
              markerEnd={on ? 'url(#arrow)' : 'url(#arrow-idle)'}
            />
          );
        })}

        {/* Value labels on active wires. */}
        {WIRES.map((wire) => {
          const a = act.wires.get(wire.id);
          if (!a || a.value === undefined || !phaseVisibleAt(wire.stage, phase)) return null;
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

        {/* Components. */}
        {Array.from(NODES.values()).map((node) => (
          <NodeShape
            key={node.id}
            node={node}
            active={act.components.has(node.id) && phaseIdx >= PHASES.indexOf(node.stage)}
          />
        ))}
      </svg>
    </section>
  );
}

/** Draw one component as a box / mux / adder, highlighted when active this cycle. */
function NodeShape(props: { node: DatapathNode; active: boolean }): React.JSX.Element {
  const { node, active } = props;
  const stroke = active ? ACTIVE : IDLE;
  const fill = active ? ACTIVE_FILL : IDLE_FILL;
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const lines = node.label.split('\n');

  let shape: React.JSX.Element;
  if (node.shape === 'mux') {
    // A tall, narrow trapezoid (wider at the output side is conventional; a simple taper reads fine).
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
    // A left-pointing ALU/adder silhouette (P&H style notch on the input side).
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
    </g>
  );
}

/** Buttons that reveal the datapath progressively through the five within-cycle phases. */
function PhaseStepper(props: {
  phase: Phase;
  setPhase: (p: Phase) => void;
  disabled: boolean;
}): React.JSX.Element {
  const { phase, setPhase, disabled } = props;
  return (
    <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', flexWrap: 'wrap' }}>
      {PHASES.map((p) => {
        const on = p === phase;
        return (
          <button
            key={p}
            onClick={() => setPhase(p)}
            disabled={disabled}
            title={`Reveal up to ${PHASE_LABELS[p]}`}
            style={{
              fontSize: '0.72rem',
              padding: '0.15rem 0.45rem',
              borderRadius: 5,
              border: `1px solid ${on ? ACTIVE : '#ccc'}`,
              background: on ? ACTIVE : '#f7f7f9',
              color: on ? '#fff' : '#555',
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            {PHASE_LABELS[p]}
          </button>
        );
      })}
    </div>
  );
}
