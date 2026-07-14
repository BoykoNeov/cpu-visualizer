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
  /** CSS color for this wire when active (e.g. `var(--phase-ex)`) — its stroke, arrowhead, and
   *  value-label ink. Absent ⇒ the default active accent. Idle wires ignore it (always grey). */
  readonly color?: string;
  /** Where to nudge the value label off the wire so it clears the line: the label is drawn beside
   *  its anchor in this direction. Defaults to `up`. */
  readonly labelSide?: 'up' | 'down' | 'left' | 'right';
}

/** One legend entry: a colored swatch and its meaning. */
export interface LegendItem {
  readonly label: string;
  readonly color: string;
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

/**
 * The drawn perimeter of a component, as a closed list of vertices — the SINGLE source of truth
 * for a node's outline. {@link NodeShape} renders from it (mux/adder) and the geometry tests hit-test
 * wire endpoints against it, so "the wire starts on the shape's edge" is checked against what is
 * actually drawn (a mux/adder has slanted top/bottom edges, so a point at the bounding-box top-mid
 * can sit in blank space — the bounding box is not the outline). A plain box's perimeter is its
 * four corners.
 */
export function shapePolygon(node: {
  x: number;
  y: number;
  w: number;
  h: number;
  shape?: 'box' | 'mux' | 'adder';
}): readonly (readonly [number, number])[] {
  const { x, y, w, h } = node;
  if (node.shape === 'mux') {
    // A tall trapezoid: vertical left/right edges, slanted top/bottom. Inputs/outputs must land on
    // the VERTICAL edges (a point on the slanted top/bottom is only reachable by a diagonal wire).
    return [
      [x, y],
      [x + w, y + w],
      [x + w, y + h - w],
      [x, y + h],
    ];
  }
  if (node.shape === 'adder') {
    // A left-pointing ALU/adder silhouette with a P&H notch on the input side. Vertical segments:
    // the right edge (x+w, between the two slants) and the two left stubs above/below the notch.
    const notch = h * 0.18;
    return [
      [x, y],
      [x + w, y + h * 0.28],
      [x + w, y + h * 0.72],
      [x, y + h],
      [x, y + h / 2 + notch],
      [x + w * 0.22, y + h / 2],
      [x, y + h / 2 - notch],
    ];
  }
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

/** Where to anchor a wire's value label: the midpoint of its LONGEST segment (a clear run, not a
 *  cramped corner), plus that segment's orientation so the label can be nudged off the line. */
function labelAnchor(points: readonly (readonly [number, number])[]): {
  x: number;
  y: number;
  horizontal: boolean;
} {
  let best = 0;
  let bestLen = -1;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  const a = points[best - 1] ?? points[0]!;
  const b = points[best] ?? points[points.length - 1]!;
  return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, horizontal: Math.abs(a[1] - b[1]) < 0.01 };
}

interface PlacedLabel {
  id: string;
  text: string;
  cx: number;
  cy: number;
  halfW: number;
  ink: string;
}

/** Place each active wire's value label off its clearest segment, then resolve label↔label
 *  overlaps by nudging the later one vertically until it clears — so no label ever obscures
 *  another (requirement: labels don't obscure labels). Boxes stay clamped inside the canvas. */
function layoutLabels(
  wires: readonly WireVM[],
  canvas: { readonly width: number; readonly height: number },
): PlacedLabel[] {
  const HALF_H = 8;
  const placed: PlacedLabel[] = [];
  for (const wire of wires) {
    if (!wire.active || wire.label === undefined) continue;
    const anc = labelAnchor(wire.points);
    const side = wire.labelSide ?? (anc.horizontal ? 'up' : 'right');
    const halfW = wire.label.length * 3.2 + 3;
    let cx = anc.x + (side === 'left' ? -(halfW + 3) : side === 'right' ? halfW + 3 : 0);
    let cy = anc.y + (side === 'up' ? -9 : side === 'down' ? 9 : 0);
    cx = Math.min(Math.max(cx, halfW + 1), canvas.width - halfW - 1);
    // Push away from any already-placed label it collides with (try both directions, nearest wins).
    const hits = (y: number): PlacedLabel | undefined =>
      placed.find(
        (p) =>
          Math.abs(p.cx - cx) < p.halfW + halfW + 2 && Math.abs(p.cy - y) < HALF_H + HALF_H + 2,
      );
    if (hits(cy)) {
      for (let step = 1; step <= 24; step++) {
        const up = cy - step * 4;
        const down = cy + step * 4;
        if (up >= 9 && !hits(up)) {
          cy = up;
          break;
        }
        if (down <= canvas.height - 9 && !hits(down)) {
          cy = down;
          break;
        }
      }
    }
    cy = Math.min(Math.max(cy, 9), canvas.height - 9);
    placed.push({
      id: wire.id,
      text: wire.label,
      cx,
      cy,
      halfW,
      ink: wire.color ?? 'var(--accent)',
    });
  }
  return placed;
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
  /** Color key for the legend (one swatch per phase). Absent ⇒ the plain active/idle legend. */
  legend?: readonly LegendItem[];
}): React.JSX.Element {
  const { title, ariaLabel, canvas, wires, nodes, headerRight, markerPrefix, legend } = props;
  // A single arrowhead whose fill inherits each wire's own stroke (`context-stroke`), so one marker
  // serves every phase color AND the idle grey — no per-color marker zoo.
  const arrow = `${markerPrefix}-arrow`;
  const labels = layoutLabels(wires, canvas);

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
            id={arrow}
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            {/* `context-stroke`: the arrowhead takes the referencing wire's stroke color. */}
            <path d="M0,0 L6,3 L0,6 Z" style={{ fill: 'context-stroke' }} />
          </marker>
        </defs>

        {/* Wires first, so component boxes sit on top of their endpoints. An active wire is stroked
            in its phase color and carries the animated flow dash (suppressed by reduced-motion). */}
        {wires.map((wire) => (
          <g key={wire.id}>
            <polyline
              points={toPolyline(wire.points)}
              className={wire.active ? 'dp-wire dp-wire--on' : 'dp-wire'}
              style={wire.active && wire.color ? { stroke: wire.color } : undefined}
              markerEnd={`url(#${arrow})`}
            />
            {wire.active ? <polyline points={toPolyline(wire.points)} className="dp-flow" /> : null}
          </g>
        ))}

        {/* Value labels — each nudged off its wire's clearest segment, clamped inside the canvas,
            and de-collided against earlier labels (see {@link layoutLabels}). Drawn after the wires
            so their opaque box reads cleanly. */}
        {labels.map((lbl) => (
          <g key={`v-${lbl.id}`}>
            <rect
              className="dp-vlabel-box"
              style={{ stroke: lbl.ink }}
              x={lbl.cx - lbl.halfW}
              y={lbl.cy - 8}
              width={lbl.halfW * 2}
              height={14}
              rx={3}
            />
            <text
              className="dp-vlabel-text"
              style={{ fill: lbl.ink }}
              x={lbl.cx}
              y={lbl.cy + 2}
              textAnchor="middle"
              fontSize={9}
            >
              {lbl.text}
            </text>
          </g>
        ))}

        {nodes.map((node) => (
          <NodeShape key={node.id} node={node} />
        ))}
      </svg>

      <div className="dp-legend" aria-hidden="true">
        {legend ? (
          legend.map((item) => (
            <span key={item.label}>
              <span className="dp-legend-swatch" style={{ borderTopColor: item.color }} />{' '}
              {item.label}
            </span>
          ))
        ) : (
          <span>
            <span className="dp-legend-swatch" /> active path this cycle
          </span>
        )}
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
  if (node.shape === 'mux' || node.shape === 'adder') {
    shape = <polygon className={shapeClass} points={toPolyline(shapePolygon(node))} />;
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
