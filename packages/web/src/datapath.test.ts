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
import { loadSource } from './simulator';

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
    // The `ends` are load-bearing (they drive tier visibility); guard them against drifting
    // away from the geometry by checking the first/last point lies on each named node's box.
    const eps = 0.5;
    const onNode = (pt: readonly [number, number], id: string): boolean => {
      const n = NODES.get(id)!;
      return (
        pt[0] >= n.x - eps &&
        pt[0] <= n.x + n.w + eps &&
        pt[1] >= n.y - eps &&
        pt[1] <= n.y + n.h + eps
      );
    };
    for (const wire of WIRES) {
      const first = wire.points[0]!;
      const last = wire.points[wire.points.length - 1]!;
      expect(onNode(first, wire.ends[0]), `${wire.id} start not on ${wire.ends[0]}`).toBe(true);
      expect(onNode(last, wire.ends[1]), `${wire.id} end not on ${wire.ends[1]}`).toBe(true);
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
