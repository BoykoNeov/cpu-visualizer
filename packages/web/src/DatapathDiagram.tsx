/**
 * The shared SVG datapath renderer — the TEMPLATE every model's datapath view builds on (see
 * docs/templates/new-model-datapath.md). A model view owns its GEOMETRY (nodes/wires with
 * hand-placed coordinates) and its ACTIVATION (trace → what's lit); this component owns all the
 * DRAWING: component shapes (box / mux / notched adder), wire polylines with direction arrows, the
 * animated flow overlay on active wires, value labels, mux control labels, and the legend. All
 * colors come from the `.dp-*` classes in styles.css, so the diagram follows the light/dark theme
 * with no per-view color code.
 *
 * The props are plain view-models — already filtered for the depth tier and already labelled —
 * because tier filtering and label policy are per-model concerns (single-cycle tiers only its
 * representation; multi-cycle also tiers structure via contraction wires; a future pipeline view
 * will have its own rules). The renderer stays policy-free: it draws exactly what it is handed.
 */

import { hex32 } from './format';

// --- View-model types ------------------------------------------------------------------------

/** How a wire's value renders in its label. */
export type ValueFmt = 'hex' | 'dec';

/** A wire to draw: its polyline (source → sink order — the arrowhead and the flow animation
 *  follow it), whether it is on the active path, and an optional value label. */
export interface WireVM {
  readonly id: string;
  readonly points: readonly (readonly [number, number])[];
  readonly active: boolean;
  /** Pre-formatted label text shown at the wire's midpoint (only drawn when `active`). */
  readonly label?: string;
}

/** A component box to draw. */
export interface NodeVM {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly shape?: 'box' | 'mux' | 'adder';
  readonly active: boolean;
  /** Control-signal annotation above the node (mux control lines, `expert` tier). */
  readonly controlLabel?: string;
}

/** Format a wire value for a label: 32-bit hex for addresses/encodings, signed decimal for data. */
export function fmtValue(value: number, fmt: ValueFmt): string {
  return fmt === 'hex' ? hex32(value) : String(value | 0);
}

// --- Geometry helpers ------------------------------------------------------------------------

/** Points → an SVG polyline `points` string. */
function toPolyline(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

/** Midpoint of a polyline (by segment index) for placing a value label. */
function midOf(points: readonly (readonly [number, number])[]): readonly [number, number] {
  const i = Math.max(0, Math.floor((points.length - 1) / 2));
  const a = points[i]!;
  const b = points[Math.min(points.length - 1, i + 1)]!;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// --- The renderer ----------------------------------------------------------------------------

export function DatapathDiagram(props: {
  /** Panel heading, e.g. "Single-cycle datapath". */
  title: string;
  ariaLabel: string;
  canvas: { readonly width: number; readonly height: number };
  wires: readonly WireVM[];
  nodes: readonly NodeVM[];
  /** Header-right slot for the model's phase stepper / phase track. */
  headerRight?: React.ReactNode;
  /** Marker-id prefix; must be unique per mounted diagram so `url(#…)` refs don't collide. */
  markerPrefix: string;
}): React.JSX.Element {
  const { title, ariaLabel, canvas, wires, nodes, headerRight, markerPrefix } = props;
  const arrowOn = `${markerPrefix}-arrow`;
  const arrowIdle = `${markerPrefix}-arrow-idle`;

  return (
    <section className="panel" style={{ paddingBottom: '0.5rem', marginTop: '1rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '1rem',
          flexWrap: 'wrap',
          marginBottom: '0.4rem',
        }}
      >
        <h2 className="panel-heading" style={{ margin: 0 }}>
          {title}
        </h2>
        {headerRight}
      </div>

      <svg
        viewBox={`0 0 ${canvas.width} ${canvas.height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <marker
            id={arrowOn}
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L6,3 L0,6 Z" style={{ fill: 'var(--accent)' }} />
          </marker>
          <marker
            id={arrowIdle}
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L6,3 L0,6 Z" style={{ fill: 'var(--wire-idle)' }} />
          </marker>
        </defs>

        {/* Wires first, so component boxes sit on top of their endpoints. Active wires get the
            animated dash overlay showing flow direction (suppressed by prefers-reduced-motion). */}
        {wires.map((wire) => (
          <g key={wire.id}>
            <polyline
              points={toPolyline(wire.points)}
              className={wire.active ? 'dp-wire dp-wire--on' : 'dp-wire'}
              markerEnd={`url(#${wire.active ? arrowOn : arrowIdle})`}
            />
            {wire.active ? <polyline points={toPolyline(wire.points)} className="dp-flow" /> : null}
          </g>
        ))}

        {/* Value labels at active wires' midpoints (the wrapper decides which wires carry one). */}
        {wires.map((wire) => {
          if (!wire.active || wire.label === undefined) return null;
          const [mx, my] = midOf(wire.points);
          return (
            <g key={`v-${wire.id}`}>
              <rect
                className="dp-vlabel-box"
                x={mx - wire.label.length * 3.2 - 3}
                y={my - 8}
                width={wire.label.length * 6.4 + 6}
                height={14}
                rx={3}
              />
              <text className="dp-vlabel-text" x={mx} y={my + 2} textAnchor="middle" fontSize={9}>
                {wire.label}
              </text>
            </g>
          );
        })}

        {nodes.map((node) => (
          <NodeShape key={node.id} node={node} />
        ))}
      </svg>

      <div className="dp-legend" aria-hidden="true">
        <span>
          <span className="dp-legend-swatch" /> active path this cycle
        </span>
        <span>
          <span className="dp-legend-swatch dp-legend-swatch--idle" /> idle
        </span>
      </div>
    </section>
  );
}

/** Draw one component as a box / mux / notched adder, with its (optional) control annotation. */
function NodeShape(props: { node: NodeVM }): React.JSX.Element {
  const { node } = props;
  const shapeClass = node.active ? 'dp-node-shape dp-node-shape--on' : 'dp-node-shape';
  const labelClass = node.active ? 'dp-node-label dp-node-label--on' : 'dp-node-label';
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const lines = node.label.split('\n');

  let shape: React.JSX.Element;
  if (node.shape === 'mux') {
    // A tall, narrow trapezoid (wider at the output side is conventional; a simple taper reads fine).
    const { x, y, w, h } = node;
    shape = (
      <polygon
        className={shapeClass}
        points={`${x},${y} ${x + w},${y + w} ${x + w},${y + h - w} ${x},${y + h}`}
      />
    );
  } else if (node.shape === 'adder') {
    // A left-pointing ALU/adder silhouette (P&H style notch on the input side).
    const { x, y, w, h } = node;
    const notch = h * 0.18;
    shape = (
      <polygon
        className={shapeClass}
        points={`${x},${y} ${x + w},${y + h * 0.28} ${x + w},${y + h * 0.72} ${x},${y + h} ${x},${y + h / 2 + notch} ${x + w * 0.22},${y + h / 2} ${x},${y + h / 2 - notch}`}
      />
    );
  } else {
    shape = (
      <rect className={shapeClass} x={node.x} y={node.y} width={node.w} height={node.h} rx={5} />
    );
  }

  return (
    <g>
      {shape}
      {lines.map((line, i) => (
        <text
          key={i}
          className={labelClass}
          x={cx}
          y={cy + 4 + (i - (lines.length - 1) / 2) * 12}
          textAnchor="middle"
          fontSize={node.shape === 'mux' ? 8 : 11}
        >
          {line}
        </text>
      ))}
      {node.controlLabel ? (
        <text
          className={node.active ? 'dp-ctrl-label dp-ctrl-label--on' : 'dp-ctrl-label'}
          x={cx}
          y={node.y - 4}
          textAnchor="middle"
          fontSize={7.5}
        >
          {node.controlLabel}
        </text>
      ) : null}
    </g>
  );
}

/**
 * The shared phase-chip row (IF→WB), colored with the validated per-phase hues from
 * {@link PHASE_COLORS}-style maps. With `onSelect` it is an interactive stepper (single-cycle's
 * progressive reveal); without, a passive track showing which phase the cycle at the cursor is
 * (multi-cycle — scrubbing the timeline walks it). A chip always carries its text label: the hue
 * is a reinforcement, never the sole carrier.
 */
export function PhaseChips<P extends string>(props: {
  phases: readonly P[];
  labels: Readonly<Record<P, string>>;
  colors: Readonly<Record<string, string>>;
  active: P | null;
  onSelect?: (p: P) => void;
  disabled?: boolean;
  /** Tooltip for a chip (defaults to its label). */
  titleOf?: (p: P) => string;
}): React.JSX.Element {
  const { phases, labels, colors, active, onSelect, disabled, titleOf } = props;
  return (
    <div className="seg" style={{ marginLeft: 'auto' }}>
      {phases.map((p) => {
        const on = p === active;
        const cls = on ? 'seg-btn seg-btn--on' : 'seg-btn';
        const style = { '--seg-accent': colors[p] } as React.CSSProperties;
        const title = titleOf ? titleOf(p) : labels[p];
        return onSelect ? (
          <button
            key={p}
            className={cls}
            style={style}
            title={title}
            disabled={disabled}
            onClick={() => onSelect(p)}
          >
            {labels[p]}
          </button>
        ) : (
          <span key={p} className={cls} style={style} title={title}>
            {labels[p]}
          </span>
        );
      })}
    </div>
  );
}
