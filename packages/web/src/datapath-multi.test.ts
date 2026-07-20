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
import { shapePolygon } from './DatapathDiagram';
import { loadSource } from './simulator';

/** True when `pt` lies (within `eps`) on any edge of node `id`'s drawn outline (hit-tested against
 *  {@link shapePolygon}, the real perimeter — a bounding-box check would pass points in a mux/adder's
 *  slanted-corner blank space). */
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
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const gx = ax + t * dx - px;
    const gy = ay + t * dy - py;
    if (Math.sqrt(gx * gx + gy * gy) <= eps) return true;
  }
  return false;
}

type Seg = readonly [number, number, number, number];
function segmentsOf(points: readonly (readonly [number, number])[]): Seg[] {
  const segs: Seg[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    segs.push([a[0], a[1], b[0], b[1]]);
  }
  return segs;
}
/** Length two segments run collinearly on top of each other (0 if they only cross / touch). */
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

/** Like {@link phasesOf} but walks the WHOLE program, not just the first instruction — needed to
 *  reach an instruction that only exists after a jump (e.g. the `jalr` in a call/return pair). */
function allPhasesOf(source: string, maxCycles = 200): CycleTrace[] {
  const result = loadSource(`${source}\n`, () => new MultiCycleProcessor());
  if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
  const { recorder } = result.loaded;
  const traces: CycleTrace[] = [];
  // `stepForward()` returns null once the run has halted at the end; `maxCycles` is only a
  // runaway guard so a mis-written test program can't hang the suite.
  for (let i = 0; i < maxCycles; i++) {
    const t = recorder.stepForward();
    if (!t) break;
    traces.push(t);
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

  it('a TAKEN branch redirects PC from the branch adder at EX (5d), not from ALUOut', () => {
    // `beq x0, x0` always takes. EX is the branch's retire phase, so the redirect lands there.
    const traces = phasesOf('  beq x0, x0, ahead\n  nop\nahead:');
    const ex = activate(atPhase(traces, 'EX'));
    expect(ex.components.has('branchadd')).toBe(true);
    expect(ex.wires.has('pc-branchadd')).toBe(true);
    expect(ex.wires.has('signext-branchadd')).toBe(true);
    // The target is pc+imm — the branch is at pc=0 and jumps over one 4-byte `nop`.
    const pc = atPhase(traces, 'EX').instructions[0]!.pc;
    expect(ex.wires.get('branchadd-pc')?.value).toBe((pc + 8) >>> 0);
    // The ALU holds the COMPARE result, so the jumps' redirect wire stays dark.
    expect(ex.wires.has('aluout-pc')).toBe(false);
  });

  it('a NOT-taken branch draws no redirect (the branch adder stays dark)', () => {
    const traces = phasesOf('  bne x0, x0, ahead\n  nop\nahead:');
    const ex = activate(atPhase(traces, 'EX'));
    // The compare still happens — only the redirect is gated on the outcome.
    expect(ex.components.has('alu')).toBe(true);
    expect(ex.components.has('branchadd')).toBe(false);
    expect(ex.wires.has('branchadd-pc')).toBe(false);
    expect(ex.wires.has('pc-branchadd')).toBe(false);
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

  // Step 5c split `jal` across two units, and the split is the whole point of the change: the
  // ALU computes the TARGET (and drives the redirect into PC), while the incrementer supplies the
  // LINK. Both are live in the same WB phase, from different sources.
  it('jal computes its target in the ALU (5c), with PC — not the A latch — as operand A', () => {
    const traces = phasesOf('  jal x1, ahead\n  nop\nahead:');
    expect(traces.map((t) => t.instructions[0]?.location)).toEqual(['IF', 'ID', 'EX', 'WB']);

    const ex = activate(atPhase(traces, 'EX'));
    expect(ex.components.has('alu')).toBe(true);
    expect(ex.components.has('pc')).toBe(true);
    expect(ex.wires.has('pc-alusrca'), 'ALUSrcA selects PC for jal').toBe(true);
    expect(ex.wires.has('alusrca-alu')).toBe(true);
    expect(
      ex.components.has('a'),
      'jal reads no source register, so the A latch must stay dark',
    ).toBe(false);
    expect(ex.wires.has('a-alusrca')).toBe(false);
    // The B operand is the immediate, not the B latch (jal is J-format).
    expect(ex.wires.has('signext-alusrcb')).toBe(true);
    expect(ex.wires.has('b-alusrcb')).toBe(false);
  });

  it('jal writes the link (pc+4) from the incrementer while ALUOut redirects PC (5c)', () => {
    const traces = phasesOf('  jal x1, ahead\n  nop\nahead:');
    const wb = activate(atPhase(traces, 'WB'));
    // The link: incrementer → writeback mux → register file.
    expect(wb.components.has('pcarith')).toBe(true);
    expect(wb.wires.has('pcarith-wbmux')).toBe(true);
    expect(wb.writtenReg).toBe(1);
    // The target: ALUOut → PC. This wire is what step 5c exists to draw.
    expect(wb.wires.has('aluout-pc')).toBe(true);
    expect(wb.components.has('pc')).toBe(true);
  });

  it('jalr redirects PC from ALUOut even when it discards the link (rd = x0)', () => {
    // The redirect must not hide behind a reg-write: `jalr x0, x1, 0` writes no register, so the
    // redirect is the jump's ONLY visible effect in this phase.
    const traces = allPhasesOf('  jal x1, func\n  li a7, 10\n  ecall\nfunc:\n  jalr x0, x1, 0');
    const jalr = traces.filter((t) => t.instructions[0]?.decoded.mnemonic === 'jalr');
    expect(jalr.length, 'the jalr must actually execute').toBeGreaterThan(0);
    const wb = activate(atPhase(jalr, 'WB'));
    expect(wb.writtenReg).toBeNull();
    expect(wb.wires.has('aluout-pc')).toBe(true);
    expect(wb.wires.has('pcarith-wbmux'), 'no link is written, so no incrementer path').toBe(false);
  });

  it('auipc writes its pc+imm from ALUOut (5c moved it off the incrementer)', () => {
    const traces = phasesOf('  auipc x5, 1');
    expect(traces.map((t) => t.instructions[0]?.location)).toEqual(['IF', 'ID', 'EX', 'WB']);
    const wb = activate(atPhase(traces, 'WB'));
    expect(wb.wires.has('aluout-wbmux')).toBe(true);
    // `auipc`'s WRITEBACK no longer comes from the incrementer (that was 5c's move). The
    // incrementer itself IS lit here — 5e draws the sequential next-PC, and auipc's next PC
    // genuinely is pc+4 — so the assertion has to name the writeback path, not the unit.
    expect(wb.wires.has('pcarith-wbmux'), 'auipc no longer links via the incrementer').toBe(false);
    expect(wb.wires.has('aluout-pc'), 'auipc writes a register — it does NOT redirect').toBe(false);
    expect(wb.writtenReg).toBe(5);
  });

  // Step 5e drew the PCSource mux, which forced the driver the diagram had never shown: the
  // SEQUENTIAL next-PC. These pin all three arms of the selector — exactly one lights per retire.
  it('lights the sequential pc+4 through PCSource at retire (5e)', () => {
    const traces = phasesOf('  add x5, x0, x0');
    const wb = activate(atPhase(traces, 'WB'));
    const pc = atPhase(traces, 'WB').instructions[0]!.pc;
    expect(wb.components.has('pcarith')).toBe(true);
    expect(wb.components.has('pcsource')).toBe(true);
    expect(wb.wires.get('pcarith-pcsource')?.value).toBe((pc + 4) >>> 0);
    expect(wb.wires.get('pcsource-pc')?.value).toBe((pc + 4) >>> 0);
    expect(wb.wires.get('pcarith-pc')?.value).toBe((pc + 4) >>> 0); // essentials contraction
    // The other two arms lose.
    expect(wb.wires.has('aluout-pc')).toBe(false);
    expect(wb.wires.has('branchadd-pc')).toBe(false);
  });

  it('retires the sequential path in whichever phase is last (a store retires at MEM)', () => {
    // The rule is "the next-PC wire lights at retire", NOT "at WB" — a store has no WB at all.
    const traces = phasesOf('  sw x0, 4(x0)');
    const mem = activate(atPhase(traces, 'MEM'));
    expect(mem.wires.has('pcsource-pc')).toBe(true);
    // ...and it must not light early: EX is not this store's last phase.
    expect(activate(atPhase(traces, 'EX')).wires.has('pcsource-pc')).toBe(false);
  });

  it('a redirecting instruction does NOT also light the sequential arm', () => {
    // Only one PCSource input may win per retire, or the picture shows PC taking two values.
    const jal = activate(atPhase(phasesOf('  jal x1, ahead\n  nop\nahead:'), 'WB'));
    expect(jal.wires.has('aluout-pcsource')).toBe(true);
    expect(jal.wires.has('pcarith-pcsource'), 'jal redirects — no sequential arm').toBe(false);

    const taken = activate(atPhase(phasesOf('  beq x0, x0, ahead\n  nop\nahead:'), 'EX'));
    expect(taken.wires.has('branchadd-pcsource')).toBe(true);
    expect(taken.wires.has('pcarith-pcsource'), 'taken branch — no sequential arm').toBe(false);

    // A NOT-taken branch retires at EX and DOES fall through to the sequential arm.
    const notTaken = activate(atPhase(phasesOf('  bne x0, x0, ahead\n  nop\nahead:'), 'EX'));
    expect(notTaken.wires.has('pcarith-pcsource')).toBe(true);
    expect(notTaken.wires.has('branchadd-pcsource')).toBe(false);
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
  const MUXES = ['addrmux', 'alusrca', 'alusrcb', 'wbmux', 'pcsource'];
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

describe('geometry: wires are orthogonal and anchored on real edges (visual acceptance)', () => {
  // The automatable slice of the "clean schematic" requirements: every wire segment runs at a right
  // angle, and every endpoint sits on the drawn outline of the node it connects (not blank space).
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

  it('no two simultaneously-drawn wires run collinearly on top of each other (arrows don’t obscure arrows)', () => {
    // A collinear overlap is a permanent "two lines as one", invisible to the eye. Bucket by tier:
    // a contraction wire and its through-mux wire are intentionally collinear but NEVER co-visible,
    // so only compare wires drawn together (`wireVisibleAt`). Crossings / shared endpoints are fine.
    for (const tier of DEPTH_TIERS) {
      const vis = WIRES.filter((w) => wireVisibleAt(w, tier));
      for (let i = 0; i < vis.length; i++) {
        for (let j = i + 1; j < vis.length; j++) {
          const wi = vis[i]!;
          const wj = vis[j]!;
          let worst = 0;
          for (const sa of segmentsOf(wi.points))
            for (const sb of segmentsOf(wj.points))
              worst = Math.max(worst, collinearOverlap(sa, sb));
          expect
            .soft(worst, `${wi.id} overlaps ${wj.id} at ${tier} for ${worst.toFixed(0)}px`)
            .toBeLessThan(2);
        }
      }
    }
  });
});
