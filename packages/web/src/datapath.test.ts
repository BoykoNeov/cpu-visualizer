import { DEPTH_TIERS, type DepthTier } from '@cpu-viz/curriculum';
import type { CycleTrace } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import {
  activate,
  NODES,
  nodeVisibleAt,
  phaseVisibleAt,
  showControlLabels,
  showValueLabels,
  tierVisible,
  WIRES,
  wireVisibleAt,
} from './datapath';
import { shapePolygon } from './DatapathDiagram';
import { loadSource } from './simulator';

/** True when `pt` lies (within `eps`) on any edge of node `id`'s drawn outline. Shared by the
 *  edge-anchor tests: hit-tests against {@link shapePolygon}, the real perimeter, so a point in a
 *  mux/adder's slanted-corner blank space fails (a bounding-box check would wrongly pass it). */
function onPerimeter(pt: readonly [number, number], id: string, eps = 0.5): boolean {
  const n = NODES.get(id)!;
  const poly = shapePolygon(n);
  const [px, py] = pt;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]!;
    const [bx, by] = poly[(i + 1) % poly.length]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Project pt onto the segment, clamp to [0,1], measure the gap.
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const gx = ax + t * dx - px;
    const gy = ay + t * dy - py;
    if (Math.sqrt(gx * gx + gy * gy) <= eps) return true;
  }
  return false;
}

type Seg = readonly [number, number, number, number]; // x0,y0,x1,y1
/** The axis-aligned segments of a wire's polyline. */
function segmentsOf(points: readonly (readonly [number, number])[]): Seg[] {
  const segs: Seg[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    segs.push([a[0], a[1], b[0], b[1]]);
  }
  return segs;
}
/** Length by which two segments run ON TOP of each other (collinear + overlapping) — 0 if they
 *  merely cross, touch at a point, or are apart. This is the mechanical form of "an arrow must not
 *  obscure another arrow": two wires stacked on the same rail read as one line. */
function collinearOverlap(a: Seg, b: Seg, eps = 0.5): number {
  const [ax0, ay0, ax1, ay1] = a;
  const [bx0, by0, bx1, by1] = b;
  const aH = Math.abs(ay0 - ay1) < eps;
  const bH = Math.abs(by0 - by1) < eps;
  const aV = Math.abs(ax0 - ax1) < eps;
  const bV = Math.abs(bx0 - bx1) < eps;
  if (aH && bH && Math.abs(ay0 - by0) < eps) {
    const lo = Math.max(Math.min(ax0, ax1), Math.min(bx0, bx1));
    const hi = Math.min(Math.max(ax0, ax1), Math.max(bx0, bx1));
    return Math.max(0, hi - lo);
  }
  if (aV && bV && Math.abs(ax0 - bx0) < eps) {
    const lo = Math.max(Math.min(ay0, ay1), Math.min(by0, by1));
    const hi = Math.min(Math.max(ay0, ay1), Math.max(by0, by1));
    return Math.max(0, hi - lo);
  }
  return 0;
}

/**
 * The datapath activation is the one headlessly-testable seam of the SVG view (the geometry
 * and the rendering itself are checked by eye via `npm run dev`, as in step 7). We drive the
 * REAL single-cycle engine through the recorder and assert that {@link activate} lights the
 * right components/wires for three instructions chosen to expose the gaps an event-only
 * mapping would miss:
 *   - a LOAD   — full fetch→writeback path through data memory,
 *   - a BRANCH — no memory, no writeback, but the PC-select path is live,
 *   - `lui`    — emits NO reg-read and NO alu-op, yet must still show imm → writeback.
 */

/** Assemble `source`, run its first instruction, and return that cycle's trace. */
function firstCycle(source: string): CycleTrace {
  const result = loadSource(`${source}\n  li a7, 10\n  ecall\n`);
  if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
  const { recorder } = result.loaded;
  recorder.stepForward();
  const trace = recorder.current();
  if (!trace) throw new Error('no trace at cycle 0');
  return trace;
}

describe('datapath geometry', () => {
  it('activation coherence: every lit wire is a real wire with both endpoints lit', () => {
    // The real guard the old id-prefix check only pretended to be. For a representative spread of
    // instructions, every wire the activation lights must (a) resolve to a wire in the geometry —
    // catching a typo'd id in a `w()` call, which would otherwise set a bogus key — and (b) have
    // BOTH declared `ends` on the lit component set, so no lit wire ever runs into a dim box.
    const byId = new Map(WIRES.map((wire) => [wire.id, wire]));
    const programs = [
      'lw x5, 0(x0)', // load: full IF→WB through data memory
      'sw x0, 4(x0)', // store: rs2→memory, no writeback
      'beq x0, x0, ahead\n  nop\nahead:', // branch: PC-select path, no mem/WB
      'lui x5, 0x12345', // U-type: no reg-read, no alu-op — imm→WB
      'add x5, x0, x0', // R-type: reg→ALU→WB
      'jal x1, ahead\n  nop\nahead:', // jump-and-link: target adder + pc+4 writeback
    ];
    for (const src of programs) {
      const a = activate(firstCycle(src));
      for (const id of a.wires.keys()) {
        const wire = byId.get(id);
        expect(wire, `activated unknown wire "${id}" for \`${src}\``).toBeDefined();
        for (const end of wire!.ends) {
          const msg = `wire ${id} lit but endpoint ${end} is dim for \`${src}\``;
          expect(a.components.has(end), msg).toBe(true);
        }
      }
    }
    // Sanity: the canonical components are all present in the geometry.
    for (const id of ['pc', 'imem', 'regfile', 'immgen', 'alu', 'dmem', 'wbmux', 'branchadd']) {
      expect(NODES.has(id), `missing node ${id}`).toBe(true);
    }
  });
});

describe('depth tiers (representational fidelity; handoff §4, INV-5)', () => {
  const visibleNodes = (t: DepthTier): Set<string> =>
    new Set([...NODES.values()].filter((n) => nodeVisibleAt(n, t)).map((n) => n.id));
  const visibleWires = (t: DepthTier): Set<string> =>
    new Set(WIRES.filter((wire) => wireVisibleAt(wire, t)).map((wire) => wire.id));

  it('tierVisible: an element shows once the selected tier reaches its minTier', () => {
    expect(tierVisible(undefined, 'essentials')).toBe(true); // absent ⇒ essentials, always on
    expect(tierVisible('detailed', 'essentials')).toBe(false); // not yet
    expect(tierVisible('detailed', 'detailed')).toBe(true);
    expect(tierVisible('detailed', 'expert')).toBe(true); // higher tier keeps lower detail
  });

  it('draws the SAME structure at every tier (single-cycle tiers representation, not structure)', () => {
    // Every box is on the active path for some common instruction, so hiding one would dangle a
    // lit wire (a "value from nowhere" — an INV-5 contradiction). So no node sets `minTier` and
    // the full geometry is drawn at all three tiers; the tiered detail is labels, not boxes.
    for (const tier of DEPTH_TIERS) {
      expect(visibleNodes(tier).size).toBe(NODES.size);
      expect(visibleWires(tier).size).toBe(WIRES.length);
    }
  });

  it('adds representational detail as the tier climbs (labels only add — lawful, INV-5)', () => {
    // essentials: bare lit path. detailed: + wire value labels. expert: + mux control labels.
    // Monotone: a higher tier only ever GAINS labels, never contradicts a lower one.
    expect(DEPTH_TIERS.map(showValueLabels)).toEqual([false, true, true]);
    expect(DEPTH_TIERS.map(showControlLabels)).toEqual([false, false, true]);
  });

  it('never draws a wire whose endpoint node is hidden (no dangling wires — INV-5)', () => {
    for (const tier of DEPTH_TIERS) {
      const nodes = visibleNodes(tier);
      for (const wire of WIRES) {
        if (!wireVisibleAt(wire, tier)) continue;
        for (const end of wire.ends) {
          expect(nodes.has(end), `wire ${wire.id} shown at ${tier} but ${end} hidden`).toBe(true);
        }
      }
    }
  });

  it("each wire's polyline actually runs edge-to-edge between its declared `ends`", () => {
    // The `ends` are load-bearing (they drive tier visibility); guard them against drifting away
    // from the geometry by checking the first/last point lies on the named node's DRAWN outline —
    // not merely inside its bounding box. A mux/adder has slanted edges, so a point at the box's
    // top-mid can sit in blank space; hit-test against the real perimeter (see {@link shapePolygon}).
    for (const wire of WIRES) {
      const first = wire.points[0]!;
      const last = wire.points[wire.points.length - 1]!;
      expect(onPerimeter(first, wire.ends[0]), `${wire.id} start off ${wire.ends[0]}'s edge`).toBe(true); // prettier-ignore
      expect(onPerimeter(last, wire.ends[1]), `${wire.id} end off ${wire.ends[1]}'s edge`).toBe(
        true,
      );
    }
  });
});

describe('geometry: wires are orthogonal and anchored on real edges (visual acceptance)', () => {
  // The automatable slice of the "clean schematic" requirements: every wire segment runs at a right
  // angle (0/90/180/270°), and every wire endpoint sits on the drawn outline of the node it claims
  // to connect (not in blank space). Label de-confliction and crossing aesthetics remain a
  // `npm run dev` / screenshot eyeball.
  it('every wire segment is axis-aligned (no diagonals)', () => {
    const eps = 0.01;
    for (const wire of WIRES) {
      for (let i = 1; i < wire.points.length; i++) {
        const [ax, ay] = wire.points[i - 1]!;
        const [bx, by] = wire.points[i]!;
        const axisAligned = Math.abs(ax - bx) < eps || Math.abs(ay - by) < eps;
        expect
          .soft(axisAligned, `${wire.id} seg ${i} diagonal (${ax},${ay})→(${bx},${by})`)
          .toBe(true);
      }
    }
  });

  it('every wire endpoint sits on its node’s drawn edge', () => {
    for (const wire of WIRES) {
      const first = wire.points[0]!;
      const last = wire.points[wire.points.length - 1]!;
      expect.soft(onPerimeter(first, wire.ends[0]), `${wire.id} start off ${wire.ends[0]}`).toBe(true); // prettier-ignore
      expect.soft(onPerimeter(last, wire.ends[1]), `${wire.id} end off ${wire.ends[1]}`).toBe(true);
    }
  });

  it('no two wires run collinearly on top of each other (arrows don’t obscure arrows)', () => {
    // All wires are drawn every frame (active colored, the rest idle), so a collinear overlap is a
    // permanent "two lines masquerading as one" — invisible to the eye. Perpendicular crossings and
    // shared endpoints are fine; only a positive run of shared line is flagged. (Single-cycle draws
    // every wire at every tier, so one bucket suffices.)
    for (let i = 0; i < WIRES.length; i++) {
      for (let j = i + 1; j < WIRES.length; j++) {
        const wi = WIRES[i]!;
        const wj = WIRES[j]!;
        let worst = 0;
        for (const sa of segmentsOf(wi.points))
          for (const sb of segmentsOf(wj.points)) worst = Math.max(worst, collinearOverlap(sa, sb));
        expect.soft(worst, `${wi.id} overlaps ${wj.id} for ${worst.toFixed(0)}px`).toBeLessThan(2);
      }
    }
  });
});

describe('phaseVisibleAt (within-cycle progressive reveal)', () => {
  it('reveals a stage only once the stepper has reached it', () => {
    // Earlier-or-equal phases are visible; later ones are hidden until the stepper advances.
    expect(phaseVisibleAt('IF', 'EX')).toBe(true);
    expect(phaseVisibleAt('EX', 'EX')).toBe(true);
    expect(phaseVisibleAt('WB', 'ID')).toBe(false); // writeback stays hidden at Decode
    expect(phaseVisibleAt('MEM', 'EX')).toBe(false); // memory hidden until we reach it
    expect(phaseVisibleAt('WB', 'WB')).toBe(true); // full path at the final phase
  });
});

describe('activate', () => {
  it('is empty for the pre-run state (no in-flight instruction)', () => {
    const a = activate(null);
    expect(a.components.size).toBe(0);
    expect(a.wires.size).toBe(0);
    expect(a.writtenReg).toBeNull();
  });

  it('lights the full path for a load (IF→WB through data memory)', () => {
    const a = activate(firstCycle('  lw x5, 0(x0)'));
    // Address calc, memory read, and writeback of the loaded value into x5.
    for (const id of ['pc', 'imem', 'regfile', 'immgen', 'alu', 'dmem', 'wbmux']) {
      expect(a.components.has(id), `load should light ${id}`).toBe(true);
    }
    expect(a.wires.has('alu-dmem')).toBe(true); // effective address to memory
    expect(a.wires.has('dmem-wb')).toBe(true); // loaded datum to the writeback mux
    expect(a.wires.has('wb-regfile')).toBe(true);
    expect(a.writtenReg).toBe(5);
  });

  it('lights the PC-select path for a taken branch, with no memory or writeback', () => {
    const a = activate(firstCycle('  beq x0, x0, ahead\n  nop\nahead:'));
    expect(a.components.has('alu')).toBe(true); // the comparison
    expect(a.components.has('branchadd')).toBe(true); // target = pc + imm
    expect(a.components.has('pcsel')).toBe(true);
    expect(a.wires.has('branchadd-pcsel')).toBe(true);
    // A branch neither touches data memory nor writes a register.
    expect(a.components.has('dmem')).toBe(false);
    expect(a.wires.has('wb-regfile')).toBe(false);
    expect(a.writtenReg).toBeNull();
  });

  it('lights the store data path (rs2→memory) with no writeback', () => {
    const a = activate(firstCycle('  sw x0, 4(x0)'));
    expect(a.components.has('alu')).toBe(true); // effective-address calc
    expect(a.components.has('dmem')).toBe(true);
    expect(a.wires.has('alu-dmem')).toBe(true); // address into memory
    expect(a.wires.has('rs2-dmem')).toBe(true); // the datum being stored
    // A store retires without touching the register file.
    expect(a.wires.has('wb-regfile')).toBe(false);
    expect(a.writtenReg).toBeNull();
  });

  it('lights imm→writeback for lui, which emits no reg-read and no alu-op', () => {
    const a = activate(firstCycle('  lui x5, 0x12345'));
    expect(a.components.has('immgen')).toBe(true);
    expect(a.components.has('wbmux')).toBe(true);
    expect(a.wires.has('imm-wb')).toBe(true); // the immediate is the writeback source
    // The ALU and data memory are idle for lui — event-only wiring would leave x5 unfed.
    expect(a.components.has('alu')).toBe(false);
    expect(a.components.has('dmem')).toBe(false);
    expect(a.wires.has('wb-regfile')).toBe(true);
    expect(a.writtenReg).toBe(5);
  });
});
