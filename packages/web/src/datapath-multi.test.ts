import { DEPTH_TIERS, type DepthTier } from '@cpu-viz/curriculum';
import { MultiCycleProcessor } from '@cpu-viz/engine-multi-cycle';
import type { CycleTrace } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import {
  activate,
  CANVAS,
  NODES,
  nodeVisibleAt,
  showControlLabels,
  showValueLabels,
  tierVisible,
  WIRES,
  wireVisibleAt,
  type Phase,
} from './datapath-multi';
import { loadSource } from './simulator';

/**
 * The multi-cycle datapath activation is the headlessly-testable seam of the SVG view (the layout
 * and rendering are checked by eye via `npm run dev`). We drive the REAL {@link MultiCycleProcessor}
 * through the recorder and assert that {@link activate} lights the right slice at EACH PHASE of an
 * instruction — the multi-cycle story that single-cycle's whole-instruction activation couldn't
 * exercise. We also pin the structural depth tiers: the contraction wires that stand in for hidden
 * muxes at `essentials`, and the per-tier no-dangling / lawful-contraction guarantees (INV-5).
 */

/** Assemble `source`, run the FIRST instruction through all its phases, and return the per-cycle
 *  traces (one per phase: IF, ID, …). Appends a clean exit so assembly always succeeds. */
function phasesOf(source: string): CycleTrace[] {
  const result = loadSource(`${source}\n  li a7, 10\n  ecall\n`, () => new MultiCycleProcessor());
  if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
  const { recorder } = result.loaded;
  const traces: CycleTrace[] = [];
  // The first instruction owns cycles until its `instr-retire`; collect exactly those cycles.
  for (;;) {
    recorder.stepForward();
    const t = recorder.current();
    if (!t) throw new Error('no trace');
    traces.push(t);
    if (t.events.some((e) => e.type === 'instr-retire')) break;
  }
  return traces;
}

/** The single cycle whose in-flight instruction is at `phase` (each phase is one cycle here). */
function atPhase(traces: CycleTrace[], phase: Phase): CycleTrace {
  const t = traces.find((tr) => tr.instructions[0]?.location === phase);
  if (!t) throw new Error(`no cycle at phase ${phase}`);
  return t;
}

describe('multi-cycle activation is phase-driven (one CycleTrace = one phase)', () => {
  it('walks a load IF→ID→EX→MEM→WB, lighting only the current phase each cycle', () => {
    const traces = phasesOf('  lw x5, 0(x0)');
    expect(traces.map((t) => t.instructions[0]?.location)).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);

    // IF: PC addresses the shared memory; the word latches into IR. Nothing downstream is lit.
    const iff = activate(atPhase(traces, 'IF'));
    expect(iff.phase).toBe('IF');
    for (const id of ['pc', 'mem', 'ir'])
      expect(iff.components.has(id), `IF lights ${id}`).toBe(true);
    expect(iff.components.has('alu'), 'ALU idle during fetch').toBe(false);
    expect(iff.components.has('regfile'), 'regfile idle during fetch').toBe(false);

    // ID: IR drives the register file; rs1 latches into A.
    const id = activate(atPhase(traces, 'ID'));
    expect(id.components.has('regfile')).toBe(true);
    expect(id.components.has('a')).toBe(true);
    expect(id.wires.has('regfile-a')).toBe(true);
    expect(id.components.has('mem'), 'memory idle during decode').toBe(false);

    // EX: the shared ALU computes the effective address (rs1 + imm) into ALUOut.
    const ex = activate(atPhase(traces, 'EX'));
    expect(ex.components.has('alu')).toBe(true);
    expect(ex.components.has('aluout')).toBe(true);
    expect(ex.wires.has('alu-aluout')).toBe(true);
    expect(ex.components.has('mdr'), 'MDR not filled until MEM').toBe(false);

    // MEM: ALUOut addresses the shared memory again; the datum latches into MDR.
    const mem = activate(atPhase(traces, 'MEM'));
    expect(mem.components.has('mem')).toBe(true);
    expect(mem.components.has('mdr')).toBe(true);
    expect(mem.wires.has('mem-mdr')).toBe(true);
    expect(mem.wires.has('aluout-mem')).toBe(true); // essentials contraction of the IorD mux
    expect(mem.wires.has('aluout-addrmux')).toBe(true); // the through-mux path (detailed+)

    // WB: MemtoReg selects MDR → the register write port. x5 is written.
    const wb = activate(atPhase(traces, 'WB'));
    expect(wb.components.has('wbmux')).toBe(true);
    expect(wb.components.has('mdr')).toBe(true);
    expect(wb.wires.has('mdr-wbmux')).toBe(true);
    expect(wb.wires.has('wbmux-regfile')).toBe(true);
    expect(wb.writtenReg).toBe(5);
  });

  it('a branch is IF→ID→EX (no MEM, no WB): the ALU compares, nothing is written', () => {
    const traces = phasesOf('  beq x0, x0, ahead\n  nop\nahead:');
    expect(traces.map((t) => t.instructions[0]?.location)).toEqual(['IF', 'ID', 'EX']);
    const ex = activate(atPhase(traces, 'EX'));
    expect(ex.components.has('alu')).toBe(true);
    // A branch compares two registers: the B latch feeds the ALU (not the immediate).
    expect(ex.wires.has('b-alusrcb')).toBe(true);
    expect(ex.components.has('b')).toBe(true);
    expect(ex.writtenReg).toBeNull();
  });

  it('a store is IF→ID→EX→MEM (no WB): the B latch supplies the datum at MEM', () => {
    const traces = phasesOf('  sw x0, 4(x0)');
    expect(traces.map((t) => t.instructions[0]?.location)).toEqual(['IF', 'ID', 'EX', 'MEM']);
    // EX computes the address from the immediate (rs1 + imm), not from B.
    const ex = activate(atPhase(traces, 'EX'));
    expect(ex.wires.has('signext-alusrcb')).toBe(true);
    // MEM writes: ALUOut is the address, the B latch is the store datum.
    const mem = activate(atPhase(traces, 'MEM'));
    expect(mem.components.has('mem')).toBe(true);
    expect(mem.components.has('b')).toBe(true);
    expect(mem.wires.has('b-mem')).toBe(true);
    expect(mem.wires.has('aluout-addrmux')).toBe(true);
    // A store never reaches writeback.
    expect(traces.some((t) => t.instructions[0]?.location === 'WB')).toBe(false);
  });

  it('lui is IF→ID→WB (no EX): the immediate is the writeback source', () => {
    const traces = phasesOf('  lui x5, 0x12345');
    expect(traces.map((t) => t.instructions[0]?.location)).toEqual(['IF', 'ID', 'WB']);
    const wb = activate(atPhase(traces, 'WB'));
    expect(wb.components.has('signext')).toBe(true);
    expect(wb.components.has('wbmux')).toBe(true);
    expect(wb.wires.has('signext-wbmux')).toBe(true); // imm → writeback (no ALU, no MDR)
    expect(wb.components.has('alu')).toBe(false);
    expect(wb.components.has('mdr')).toBe(false);
    expect(wb.writtenReg).toBe(5);
  });

  it('jal writes the link (pc+4) from the dedicated PC-arithmetic unit, not the ALU', () => {
    const traces = phasesOf('  jal x1, ahead\n  nop\nahead:');
    expect(traces.map((t) => t.instructions[0]?.location)).toEqual(['IF', 'ID', 'WB']);
    const wb = activate(atPhase(traces, 'WB'));
    expect(wb.components.has('pcarith')).toBe(true);
    expect(wb.wires.has('pcarith-wbmux')).toBe(true);
    expect(wb.components.has('alu'), 'jal emits no alu-op — the ALU stays idle').toBe(false);
    expect(wb.writtenReg).toBe(1);
  });

  it('is empty for the pre-run state (no in-flight instruction)', () => {
    const a = activate(null);
    expect(a.phase).toBeNull();
    expect(a.components.size).toBe(0);
    expect(a.wires.size).toBe(0);
    expect(a.writtenReg).toBeNull();
  });
});

describe('activation coherence: every lit wire is a real wire with both endpoints lit', () => {
  it('holds at each phase for a representative spread of instructions', () => {
    const byId = new Map(WIRES.map((wire) => [wire.id, wire]));
    const programs = [
      'lw x5, 0(x0)',
      'sw x0, 4(x0)',
      'beq x0, x0, ahead\n  nop\nahead:',
      'lui x5, 0x12345',
      'add x5, x0, x0',
      'jal x1, ahead\n  nop\nahead:',
      'auipc x5, 0x1',
    ];
    for (const src of programs) {
      for (const trace of phasesOf(src)) {
        const a = activate(trace);
        for (const id of a.wires.keys()) {
          const wire = byId.get(id);
          expect(wire, `activated unknown wire "${id}" for \`${src}\``).toBeDefined();
          for (const end of wire!.ends) {
            const msg = `wire ${id} lit but endpoint ${end} is dim for \`${src}\``;
            expect(a.components.has(end), msg).toBe(true);
          }
        }
      }
    }
    for (const id of ['pc', 'mem', 'ir', 'mdr', 'regfile', 'a', 'b', 'alu', 'aluout', 'wbmux']) {
      expect(NODES.has(id), `missing node ${id}`).toBe(true);
    }
  });
});

describe('depth tiers (structural detail; handoff §4, INV-5)', () => {
  const MUXES = ['addrmux', 'alusrcb', 'wbmux'];
  const visibleNodes = (t: DepthTier): Set<string> =>
    new Set([...NODES.values()].filter((n) => nodeVisibleAt(n, t)).map((n) => n.id));
  const visibleWires = (t: DepthTier): Set<string> =>
    new Set(WIRES.filter((wire) => wireVisibleAt(wire, t)).map((wire) => wire.id));

  it('tierVisible: an element shows once the selected tier reaches its minTier', () => {
    expect(tierVisible(undefined, 'essentials')).toBe(true);
    expect(tierVisible('detailed', 'essentials')).toBe(false);
    expect(tierVisible('detailed', 'detailed')).toBe(true);
    expect(tierVisible('detailed', 'expert')).toBe(true);
  });

  it('hides the three muxes at essentials and reveals them at detailed+ (structural tiering)', () => {
    for (const m of MUXES) expect(visibleNodes('essentials').has(m), `${m} hidden`).toBe(false);
    for (const m of MUXES) {
      expect(visibleNodes('detailed').has(m), `${m} shown at detailed`).toBe(true);
      expect(visibleNodes('expert').has(m), `${m} shown at expert`).toBe(true);
    }
    // The five latches and the shared units are drawn at EVERY tier — they are the story.
    for (const core of ['ir', 'a', 'b', 'aluout', 'mdr', 'mem', 'alu']) {
      for (const t of DEPTH_TIERS) expect(visibleNodes(t).has(core), `${core}@${t}`).toBe(true);
    }
  });

  it('swaps contraction wires (essentials) for through-mux wires (detailed+)', () => {
    // Each contraction wire appears ONLY at essentials; the through-mux wires appear detailed+.
    const contractions = WIRES.filter((w) => w.contracts);
    expect(contractions.length).toBeGreaterThan(0);
    for (const w of contractions) {
      expect(visibleWires('essentials').has(w.id), `${w.id} shown at essentials`).toBe(true);
      expect(visibleWires('detailed').has(w.id), `${w.id} hidden at detailed`).toBe(false);
      expect(visibleWires('expert').has(w.id), `${w.id} hidden at expert`).toBe(false);
    }
    const through = WIRES.filter((w) => w.minTier === 'detailed');
    for (const w of through) {
      expect(visibleWires('essentials').has(w.id), `${w.id} hidden at essentials`).toBe(false);
      expect(visibleWires('detailed').has(w.id), `${w.id} shown at detailed`).toBe(true);
    }
  });

  it('never draws a wire whose endpoint node is hidden (no dangling wires, PER TIER — INV-5)', () => {
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

  it('each contraction is LAWFUL: it collapses exactly its mux (same source, same sink)', () => {
    // The INV-5 correctness condition (the acceptance gate): a contraction wire `S → T` bypassing
    // mux M must equal the expert path `S → M → T` — there must exist through-wires S→M and M→T.
    // A contraction that routed somewhere the expert path does not would be a lower tier
    // CONTRADICTING a higher one.
    const touches = (w: (typeof WIRES)[number], node: string): boolean => w.ends.includes(node);
    for (const w of WIRES) {
      if (!w.contracts) continue;
      const mux = w.contracts;
      const [src, sink] = w.ends;
      const inLeg = WIRES.some(
        (t) => t.minTier === 'detailed' && touches(t, src) && touches(t, mux),
      );
      const outLeg = WIRES.some((t) => t.minTier === 'detailed' && touches(t, mux) && touches(t, sink)); // prettier-ignore
      expect(inLeg, `${w.id}: no through-wire ${src}→${mux}`).toBe(true);
      expect(outLeg, `${w.id}: no through-wire ${mux}→${sink}`).toBe(true);
    }
  });

  it('adds representational detail as the tier climbs (labels only add — lawful, INV-5)', () => {
    expect(DEPTH_TIERS.map(showValueLabels)).toEqual([false, true, true]);
    expect(DEPTH_TIERS.map(showControlLabels)).toEqual([false, false, true]);
  });
});

describe('geometry: node boxes are sane (the automatable slice of visual acceptance)', () => {
  // This does NOT replace browser verification of the layout (legibility, wire crossings, label
  // collisions are eyeballed via `npm run dev`). It only catches the failures a headless test can:
  // a box placed off-canvas or two boxes stacked on top of each other.
  const nodes = [...NODES.values()];

  it('every node box lies within the canvas', () => {
    for (const n of nodes) {
      expect(n.x >= 0 && n.x + n.w <= CANVAS.width, `${n.id} out of width`).toBe(true);
      expect(n.y >= 0 && n.y + n.h <= CANVAS.height, `${n.id} out of height`).toBe(true);
    }
  });

  it('no two node boxes overlap', () => {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const disjoint =
          a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(disjoint, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
  });
});

describe("geometry: each wire's polyline runs edge-to-edge between its declared `ends`", () => {
  it('first/last point lies on the named node box', () => {
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
