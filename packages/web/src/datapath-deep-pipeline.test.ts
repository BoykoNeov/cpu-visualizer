import { DEPTH_TIERS, type DepthTier } from '@cpu-viz/curriculum';
import { DeepPipelineProcessor } from '@cpu-viz/engine-deep-pipeline';
import { CACHE_SMALL } from '@cpu-viz/engine-pipeline';
import { defaultConfig, type CycleTrace } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import {
  activate,
  CANVAS,
  FAMILIES,
  NODES,
  nodeVisibleAt,
  showControlLabels,
  showValueLabels,
  STAGES,
  tierVisible,
  WIRES,
  wireVisibleAt,
  type DatapathConfig,
} from './datapath-deep-pipeline';
import { shapePolygon } from './DatapathDiagram';
import { stageFamily } from './pipeline-map';
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
/** Length of the collinear overlap between two axis-aligned segments (0 if they merely cross). */
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

/** The four MACHINES this diagram can be asked to draw — the cross product of the two knobs it
 *  takes, not of the config's values. `predictTaken` is a behavior rather than a scheme name because
 *  `'none'` and `'static-not-taken'` are one machine here too. The CACHE is honored by this engine
 *  (step 6) but changes no structure, so it is not an axis of this file — see `DatapathConfig`. */
const CONFIGS: readonly DatapathConfig[] = [
  { forwarding: false, predictTaken: false },
  { forwarding: true, predictTaken: false },
  { forwarding: false, predictTaken: true },
  { forwarding: true, predictTaken: true },
];
const label = (c: DatapathConfig): string =>
  `forwarding ${c.forwarding ? 'on' : 'off'} / predict ${c.predictTaken ? 'taken' : 'not-taken'}`;

const FWD: DatapathConfig = { forwarding: true, predictTaken: false };
const NOFWD: DatapathConfig = { forwarding: false, predictTaken: false };
const BET: DatapathConfig = { forwarding: true, predictTaken: true };

/** Record a whole run under one machine and return every cycle's trace. Appends a clean exit so
 *  assembly always succeeds. No new fixtures — these are litmus programs for the VIEW, the same way
 *  every sibling datapath test writes its own (INV-7 governs the example library the user runs). */
function record(source: string, cfg: DatapathConfig): CycleTrace[] {
  const result = loadSource(
    `${source}\n  li a7, 10\n  ecall\n`,
    () => new DeepPipelineProcessor(),
    {
      ...defaultConfig(),
      forwarding: cfg.forwarding,
      branchPrediction: cfg.predictTaken ? 'static-taken' : 'static-not-taken',
    },
  );
  if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
  const { recorder } = result.loaded;
  const traces: CycleTrace[] = [];
  for (;;) {
    recorder.stepForward();
    const t = recorder.current();
    if (!t) throw new Error('no trace');
    traces.push(t);
    if (t.state.halted || traces.length > 400) break;
  }
  return traces;
}

/** The stage → instruction-id map the trace itself reports for a cycle (the oracle `activate`'s
 *  `occupancy` must equal — computed here from `location` directly, independently of the module). */
function locationsOf(trace: CycleTrace): Map<string, string> {
  const m = new Map<string, string>();
  for (const inst of trace.instructions) m.set(inst.location, inst.id);
  return m;
}

/** Seven independent instructions: after seven cycles every stage holds a different one. */
const FULL_PIPE = [
  '  addi x1, x0, 1',
  '  addi x2, x0, 2',
  '  addi x3, x0, 3',
  '  addi x4, x0, 4',
  '  addi x5, x0, 5',
  '  addi x6, x0, 6',
  '  addi x7, x0, 7',
].join('\n');

/** The milestone's thesis program: a producer and its immediate consumer, which the 5-stage runs
 *  back-to-back with forwarding on and this machine cannot. */
const ALU_PAIR = '  addi x1, x0, 7\n  add x2, x1, x1';

describe('activation is MULTI-INSTRUCTION across SEVEN stages', () => {
  it('lights seven stages for seven DIFFERENT instructions in one cycle', () => {
    const traces = record(FULL_PIPE, FWD);
    const full = traces.find((t) => activate(t).occupancy.size === 7);
    expect(full, 'no cycle held all seven stages').toBeDefined();
    const a = activate(full!);
    // Seven stages, seven DISTINCT instructions — the thing a five-column diagram cannot draw.
    expect([...a.occupancy.keys()].sort()).toEqual([...STAGES].sort());
    expect(new Set(a.occupancy.values()).size).toBe(7);
    expect(a.occupancy).toEqual(new Map(locationsOf(full!)));
  });

  it('the register file is lit for TWO instructions at once (ID reads while WB writes)', () => {
    const traces = record(FULL_PIPE, FWD);
    const both = traces.find((t) => {
      const l = locationsOf(t);
      return l.has('ID') && l.has('WB');
    });
    expect(both).toBeDefined();
    expect(activate(both!).components.has('regfile')).toBe(true);
  });

  it('occupancy is read from `instructions[].location`, never from the one-cycle-ahead `micro`', () => {
    // The trap the 5-stage pinned, and it survives the fork unchanged: `micro` at cycle i is the
    // END-of-cycle latch state. A datapath sourced from it draws the pipe one cycle ahead of itself.
    for (const trace of record(ALU_PAIR, FWD)) {
      expect(activate(trace).occupancy).toEqual(new Map(locationsOf(trace)));
    }
  });

  it('is empty for the pre-run state (no in-flight instruction)', () => {
    const a = activate(null);
    expect(a.occupancy.size).toBe(0);
    expect(a.wires.size).toBe(0);
    expect(a.components.size).toBe(0);
    expect(a.writtenReg).toBeNull();
  });
});

describe('EX1 is the forwarding network and it fires a cycle BEFORE the ALU does', () => {
  /**
   * The fork's sharpest trap, pinned as a test rather than a comment. The 5-stage gates its whole
   * forwarding block on `if (aluOp)` because there the muxes and the ALU share a stage. Here
   * `alu-op` fires in EX2 — so a copied gate lights NOTHING in EX1, and the coherence litmus passes
   * happily because nothing lit cannot dangle. This asserts the positive: a real forward, in a cycle
   * whose EX1 occupant emits no `alu-op` at all.
   */
  it('lights a forward path in a cycle where the forwarding instruction has NO `alu-op`', () => {
    const traces = record(ALU_PAIR, FWD);
    const cycle = traces.find((t) => {
      const ex1 = t.instructions.find((i) => i.location === 'EX1');
      if (!ex1) return false;
      return t.events.some((e) => e.type === 'forward' && e.instr === ex1.id);
    });
    expect(cycle, 'no cycle forwarded into EX1').toBeDefined();
    const ex1 = cycle!.instructions.find((i) => i.location === 'EX1')!;
    // The load-bearing half: the forwarding instruction has not reached the ALU yet.
    expect(cycle!.events.some((e) => e.type === 'alu-op' && e.instr === ex1.id)).toBe(false);
    const a = activate(cycle!);
    // The forward really is drawn — both operand ports of `add x2, x1, x1` come off EX2/MEM.
    expect(a.wires.has('ex2mem-fwdmuxa')).toBe(true);
    expect(a.wires.has('ex2mem-fwdmuxb')).toBe(true);
    // ...and the register-file path into the same mux is DARK: forwarding is a change of PATH.
    expect(a.wires.has('idex1-fwdmuxa')).toBe(false);
    expect(a.wires.has('idex1-fwdmuxb')).toBe(false);
    // Every lit wire in this block belongs to the EX1 occupant, in stage EX1.
    for (const id of ['ex2mem-fwdmuxa', 'ex2mem-fwdmuxb', 'fwdmuxa-ex1ex2', 'fwdmuxb-ex1ex2']) {
      expect(a.wires.get(id)?.instr, id).toBe(ex1.id);
      expect(a.wires.get(id)?.stage, id).toBe('EX1');
    }
  });

  it('with no forward, the register-file path IS the lit one — and it is deliberately UNLABELLED', () => {
    // The one place this diagram omits a value on purpose: the operand was read at ID, cycles ago,
    // so no event in THIS trace holds it. Lit and bare beats a stale number — and beats widening the
    // trace schema to carry it, which is the milestone's named STOP.
    const traces = record(FULL_PIPE, FWD);
    const cycle = traces.find((t) => {
      const ex1 = t.instructions.find((i) => i.location === 'EX1');
      if (!ex1 || ex1.decoded.mnemonic !== 'addi') return false;
      return !t.events.some((e) => e.type === 'forward' && e.instr === ex1.id);
    });
    expect(cycle).toBeDefined();
    const a = activate(cycle!);
    expect(a.wires.has('idex1-fwdmuxa')).toBe(true);
    expect(a.wires.get('idex1-fwdmuxa')?.value).toBeUndefined();
    expect(a.wires.get('fwdmuxa-ex1ex2')?.value).toBeUndefined();
    expect(a.wires.has('ex2mem-fwdmuxa')).toBe(false);
    expect(a.wires.has('memwb-fwdmuxa')).toBe(false);
  });

  it('a SQUASHED EX1 occupant lights nothing — it is reported there, but it never executed', () => {
    /**
     * The over-broad half of replacing the parent's event gate, and it is on a FREQUENT path: every
     * mispredicted branch. A flush names EX1 exactly when `stageEx1` returned early without
     * resolving an operand — yet the victim is still reported at `EX1` (step 3's sweep asserts that
     * every stage a flush names has an occupant). Gating on occupancy alone therefore drew the
     * operand paths for an instruction that did no work and is about to die.
     *
     * The 5-stage gets this right by accident: its `if (aluOp)` gate is never satisfied by an
     * instruction that never executed. This fork had to replace that gate, so it has to say it.
     *
     * `call-return.s` at forwarding ON is the sharp case — its squashed EX1 occupant is an `addi`,
     * which READS a register. `array-sum`'s happens to be a `lui`, which reads none, so it would
     * have looked clean while the bug was live.
     */
    let checked = 0;
    for (const cfg of CONFIGS) {
      for (const src of [
        'jal x1, fn\nfn:\n  addi x2, x0, 1\n  jalr x0, 0(x1)',
        ALU_PAIR,
        FULL_PIPE,
      ]) {
        // prettier-ignore
        for (const trace of record(src, cfg)) {
          const flush = trace.events.find((e) => e.type === 'flush' && e.stages.includes('EX1'));
          if (!flush) continue;
          const ex1 = trace.instructions.find((i) => i.location === 'EX1');
          expect(ex1, 'a flush named EX1 with nobody there — an over-reporting payload').toBeDefined(); // prettier-ignore
          // The engine's own claim: a squashed EX1 occupant emits no events whatsoever.
          expect(trace.events.some((e) => 'instr' in e && e.instr === ex1!.id)).toBe(false);
          const lit = [...activate(trace).wires.values()].filter((w) => w.stage === 'EX1');
          expect(lit, `${src} ${label(cfg)}: squashed EX1 occupant lit ${lit.length} wires`).toEqual([]); // prettier-ignore
          checked++;
        }
      }
    }
    // Non-vacuous: this really does happen, and often.
    expect(checked, 'no squashed-EX1 cycle in the corpus — the test proved nothing').toBeGreaterThan(3); // prettier-ignore
  });

  it('...and the gate is keyed on the STAGE, not on "a flush happened" — a bet never names EX1', () => {
    /**
     * The precision of the gate, in the other direction. `ctx.bet` kills only IF2 and IF1;
     * `stageEx1` runs normally under one. A gate keyed off "is there any flush this cycle" would
     * blank the execute stage on every correctly predicted taken branch.
     *
     * **Asserted as the PAYLOAD property rather than by finding a lit EX1 on a bet cycle, and the
     * reason is a structural fact worth recording: in this corpus a bet cycle NEVER has a
     * register-reading EX1 occupant.** The interlock stalls a branch in ID *before* the bet is
     * placed (`stageId` returns on the stall path), so by the time the bet happens its producer has
     * moved on and EX1 holds the bubble that stall left. Sweeping three programs × both forwarding
     * positions found zero such cycles — so a "the wires stay lit" assertion would have been
     * vacuous, and the honest claim is about the flush payload the gate actually reads.
     */
    let bets = 0;
    for (const cfg of [BET, { forwarding: false, predictTaken: true }]) {
      for (const src of ['addi x1, x0, 3\nloop:\n  addi x1, x1, -1\n  bnez x1, loop', FULL_PIPE]) {
        for (const trace of record(src, cfg)) {
          for (const e of trace.events) {
            if (e.type !== 'flush' || e.reason !== 'branch-predicted-taken') continue;
            expect([...e.stages].sort(), 'a bet killed an execute stage').toEqual(
              [...e.stages].filter((s) => s === 'IF1' || s === 'IF2').sort(),
            );
            bets++;
          }
        }
      }
    }
    expect(bets, 'no bet was placed — the test proved nothing').toBeGreaterThan(0);
  });

  it('lights exactly the operand ports the instruction reads — and every `forward` names one', () => {
    // Ties the view's mirrored `sourcePorts` back to the engine: an R/S/B word resolves two ports,
    // an I word one, and `lui`/`jal` none. If the engine ever forwarded to a port this file thinks
    // is unread, the wire would light for an operand that does not exist.
    const ports = new Map<string, string>([
      ['EX1.rs1', 'fwdmuxa-ex1ex2'],
      ['EX1.rs2', 'fwdmuxb-ex1ex2'],
    ]);
    for (const cfg of [FWD, BET]) {
      for (const trace of record(
        '  jal x1, fn\nfn:\n  lui x5, 0x1\n  add x6, x5, x5\n  sw x6, 64(x0)',
        cfg,
      )) {
        // prettier-ignore
        const a = activate(trace);
        for (const e of trace.events) {
          if (e.type !== 'forward') continue;
          const out = ports.get(e.to);
          expect(out, `forward to unknown port ${e.to}`).toBeDefined();
          expect(a.wires.has(out!), `${e.to} forwarded but ${out!} dark`).toBe(true);
        }
        // `lui` reads nothing, so in its EX1 cycle no operand path lights at all.
        const ex1 = trace.instructions.find((i) => i.location === 'EX1');
        if (ex1?.decoded.mnemonic === 'lui') {
          expect(a.wires.has('fwdmuxa-ex1ex2')).toBe(false);
          expect(a.wires.has('fwdmuxb-ex1ex2')).toBe(false);
        }
      }
    }
  });
});

describe('a cache miss FREEZES the pipe — EX1 holds its operands, EX2 produces nothing', () => {
  /**
   * The one place this model's third knob reaches the diagram, asserted rather than left to look
   * like an oversight. During a freeze EX1 stays LIT while EX2 goes DARK, and the asymmetry is the
   * honest picture on both halves:
   *
   *   - EX1's forwarded operands were resolved on the DETECTION cycle and are genuinely standing on
   *     the latch for the whole freeze (M11 step 6a's fix is precisely that they must be), so
   *     lighting them is the same "a held stage keeps presenting its inputs" convention IF1 already
   *     uses for an instruction a stall is holding;
   *   - the ALU really is producing nothing, and there is no `alu-op` to label its output with.
   *
   * Contrast the SQUASH case above, where the engine resolved nothing and the operands will never
   * exist — there the wires must go dark, and the gate makes them.
   */
  it('holds EX1 lit and EX2 dark for the whole freeze', () => {
    const result = loadSource(
      `${'  lbu x5, 0(x0)\n  addi x6, x0, 1\n  lbu x7, 64(x0)\n  addi x8, x0, 2'}\n  li a7, 10\n  ecall\n`,
      () => new DeepPipelineProcessor(),
      { ...defaultConfig(), forwarding: true, branchPrediction: 'static-not-taken', cache: CACHE_SMALL }, // prettier-ignore
    );
    if (!result.ok) throw new Error('assembly failed');
    const { recorder } = result.loaded;
    const traces: CycleTrace[] = [];
    for (;;) {
      recorder.stepForward();
      const t = recorder.current()!;
      traces.push(t);
      if (t.state.halted || traces.length > 300) break;
    }
    let frozen = 0;
    const memAt = (t: CycleTrace | undefined): string | null =>
      t?.instructions.find((x) => x.location === 'MEM')?.id ?? null;
    for (let i = 1; i < traces.length - 1; i++) {
      const t = traces[i]!;
      const mem = t.instructions.find((x) => x.location === 'MEM');
      // MEM holding the same occupant on BOTH sides is the freeze proper. Requiring the NEXT cycle
      // too is what excludes the RELEASE cycle — there MEM still holds the same load while the whole
      // machine runs again, so EX2 legitimately executes and an `alu-op` legitimately fires. The
      // first draft of this test called that frozen and failed against correct behaviour.
      if (!mem || memAt(traces[i - 1]) !== mem.id || memAt(traces[i + 1]) !== mem.id) continue;
      const ex1 = t.instructions.find((x) => x.location === 'EX1');
      const ex2 = t.instructions.find((x) => x.location === 'EX2');
      if (!ex1 || !ex2) continue;
      const wires = [...activate(t).wires.values()];
      const lit = (s: string) => wires.filter((w) => w.stage === s).length;
      // The whole machine is frozen, so no event names anyone but the memory.
      expect(t.events.some((e) => e.type === 'alu-op')).toBe(false);
      expect(lit('EX2'), 'the ALU drew work during a freeze').toBe(0);
      if (sourcePortsOf(ex1)) {
        expect(lit('EX1'), 'EX1 dropped operands it is still holding').toBeGreaterThan(0);
      }
      frozen++;
    }
    expect(frozen, 'no frozen cycle with both execute stages occupied').toBeGreaterThan(0);
  });
});

/** Does this instruction read a register — the same question `sourcePorts` answers internally. */
function sourcePortsOf(inst: { decoded: { format: string | null; mnemonic: string } }): boolean {
  if (['ecall', 'ebreak', 'fence'].includes(inst.decoded.mnemonic)) return false;
  return ['R', 'S', 'B', 'I'].includes(inst.decoded.format ?? '');
}

describe('THE BUBBLE, AS GEOMETRY: nothing forwards into EX2', () => {
  /**
   * The milestone's thesis made falsifiable in the view. `Ex1Ex2Latch` carries OPERANDS and never a
   * result, so the engine physically cannot forward into EX2 — and someone adding a convenient
   * `ex2mem → alu` bypass to "fix" a dim wire would be drawing a path the machine does not have.
   * No coherence or lawfulness litmus catches that; this does.
   */
  it('the ALU and the pc adder are fed by the EX1/EX2 latch and by NOTHING else', () => {
    const inbound = (unit: string): string[] =>
      WIRES.filter((w) => w.ends[1] === unit).map((w) => w.ends[0]);
    expect(inbound('alu')).toEqual(['ex1ex2', 'ex1ex2']);
    expect(inbound('pcarith')).toEqual(['ex1ex2', 'ex1ex2']);
    // Stated as a sweep as well, because the two assertions above would still pass if someone added
    // a bypass under a new node id. `alu-ex2mem` / `pcarith-ex2mem` are OUTPUTS (the sink is the
    // latch), which is why this reads sinks and not "touches".
    for (const w of WIRES) {
      if (w.ends[1] !== 'alu' && w.ends[1] !== 'pcarith') continue;
      expect(w.ends[0], `${w.id} feeds an EX2 unit from outside the EX1/EX2 latch`).toBe('ex1ex2');
    }
  });

  it('every forward path lands on an EX1 mux — the sinks say so, in every config', () => {
    // The forward CONTRACTIONS end on the `ex1ex2` bar because that is where the mux they collapse
    // sends its output; what must never appear is a forward whose sink is an EX2 unit.
    const forwardSources = ['ex2mem', 'memwb'];
    for (const w of WIRES) {
      if (!forwardSources.includes(w.ends[0])) continue;
      if (w.ends[1] === 'wbmux' || w.ends[1] === 'regfile' || w.ends[1] === 'dmem') continue;
      expect(['fwdmuxa', 'fwdmuxb', 'fwdunit', 'ex1ex2', 'memwb'], `${w.id}`).toContain(w.ends[1]);
    }
  });

  it('no wire lit for the EX2 occupant is sourced from a later latch', () => {
    for (const cfg of CONFIGS) {
      for (const trace of record(ALU_PAIR, cfg)) {
        for (const [id, act] of activate(trace).wires) {
          if (act.stage !== 'EX2') continue;
          const w = WIRES.find((x) => x.id === id)!;
          expect(['ex2mem', 'memwb'].includes(w.ends[0]), `${id} feeds EX2 from ahead`).toBe(false);
        }
      }
    }
  });
});

describe('the interlock watches TWO execute stages and holds THREE things', () => {
  it('a stall lights both execute inputs and all three holds', () => {
    const traces = record(ALU_PAIR, FWD);
    const stalling = traces.find((t) => t.events.some((e) => e.type === 'stall'));
    expect(stalling, 'the ALU pair did not stall with forwarding ON').toBeDefined();
    const a = activate(stalling!);
    for (const id of ['if2id-hazard', 'idex1-hazard', 'ex1ex2-hazard']) {
      expect(a.wires.has(id), `input ${id}`).toBe(true);
    }
    // Three holds, where the 5-stage has two: the PC and BOTH front-end latches.
    for (const id of ['hazard-pc', 'hazard-if1if2', 'hazard-if2id']) {
      expect(a.wires.has(id), `hold ${id}`).toBe(true);
    }
    expect(a.components.has('hazard')).toBe(true);
  });

  it('the stall that forwarding CANNOT remove still lights it — load-use, in both positions', () => {
    for (const cfg of [FWD, NOFWD]) {
      const traces = record('  lw x1, 64(x0)\n  add x2, x1, x1', cfg);
      const stalling = traces.filter((t) => t.events.some((e) => e.type === 'stall'));
      expect(stalling.length, `no stall ${label(cfg)}`).toBeGreaterThan(0);
      for (const t of stalling) expect(activate(t).components.has('hazard')).toBe(true);
    }
  });

  it('the hazard unit is dark when the interlock did not fire', () => {
    // Combinational and always checking, but "lit" means "on the active path this cycle" in every
    // model here; a permanently-lit interlock would say nothing about when the bubble happens.
    for (const trace of record(FULL_PIPE, FWD)) {
      if (trace.events.some((e) => e.type === 'stall')) continue;
      expect(activate(trace).components.has('hazard')).toBe(false);
    }
  });

  it('the stall is drawn for the ID occupant — the two behind it are blocked, not stalling', () => {
    const traces = record(ALU_PAIR, FWD);
    const stalling = traces.find((t) => t.events.some((e) => e.type === 'stall'))!;
    const id = stalling.instructions.find((i) => i.location === 'ID')!;
    for (const w of ['hazard-pc', 'hazard-if1if2', 'hazard-if2id']) {
      expect(activate(stalling).wires.get(w)?.instr, w).toBe(id.id);
      expect(activate(stalling).wires.get(w)?.stage, w).toBe('ID');
    }
  });
});

describe('IF2 — the band whose content is a cycle, not a unit', () => {
  it('lights exactly one wire, from occupancy alone, with no event behind it', () => {
    const traces = record(FULL_PIPE, FWD);
    const cycle = traces.find((t) => locationsOf(t).has('IF2'))!;
    const if2 = cycle.instructions.find((i) => i.location === 'IF2')!;
    const a = activate(cycle);
    const mine = [...a.wires.entries()].filter(([, act]) => act.stage === 'IF2');
    expect(mine.map(([id]) => id)).toEqual(['if1if2-if2id']);
    expect(mine[0]![1].instr).toBe(if2.id);
    // The label is the fetched word, from `inst.encoding` — the one honest value here, and the same
    // source IF1 uses for an instruction a stall is HOLDING (which emits no event either).
    expect(mine[0]![1].value).toBe(if2.encoding);
    // There is genuinely no event in this trace naming this instruction this cycle.
    expect(cycle.events.some((e) => 'instr' in e && e.instr === if2.id)).toBe(false);
  });

  it('no component sits in the IF2 band — the diagram draws depth, not invented hardware', () => {
    const left = NODES.get('if1if2')!;
    const right = NODES.get('if2id')!;
    for (const n of NODES.values()) {
      if (n.id === 'if1if2' || n.id === 'if2id') continue;
      const inside = n.x >= left.x + left.w && n.x + n.w <= right.x;
      expect(inside, `${n.id} sits inside the IF2 band`).toBe(false);
    }
  });
});

describe('seven stages, five hues (the `stageFamily` rule, never an invented colour)', () => {
  it('every stage folds to one of the five validated families', () => {
    expect(STAGES.map(stageFamily)).toEqual(['IF', 'IF', 'ID', 'EX', 'EX', 'MEM', 'WB']);
    expect([...new Set(STAGES.map(stageFamily))]).toEqual([...FAMILIES]);
  });

  it('a full cycle lights seven stages but only five distinct hue keys', () => {
    const traces = record(FULL_PIPE, FWD);
    const full = traces.find((t) => activate(t).occupancy.size === 7)!;
    const a = activate(full);
    const stages = new Set([...a.wires.values()].map((x) => x.stage));
    const families = new Set([...stages].map(stageFamily));
    // Not every stage necessarily lights a wire in an arbitrary cycle, but the fold must never
    // produce a sixth key — that is what would silently need a new colour.
    expect(families.size).toBeLessThanOrEqual(5);
    for (const f of families) expect(FAMILIES).toContain(f);
    expect(stages.size).toBeGreaterThan(families.size);
  });
});

describe('the branch redirects — the BET in ID, the CORRECTION in EX2', () => {
  it('a TAKEN pc-relative transfer redirects the pc from the pc adder, labelled with its target', () => {
    const traces = record('  beq x0, x0, ahead\n  addi x1, x0, 1\nahead:', NOFWD);
    const resolving = traces.find((t) => t.events.some((e) => e.type === 'branch-resolved'))!;
    const a = activate(resolving);
    expect(a.wires.has('pcarith-pcmux')).toBe(true);
    expect(a.wires.get('pcarith-pcmux')?.stage).toBe('EX2');
    expect(a.components.has('pcarith')).toBe(true);
  });

  it('`jalr` alone redirects from the ALU — a REGISTER supplies its target', () => {
    const traces = record('  jal x1, fn\nfn:\n  jalr x0, 0(x1)', NOFWD);
    const jalrResolve = traces.find((t) =>
      t.events.some(
        (e) =>
          e.type === 'branch-resolved' &&
          t.instructions.find((i) => i.id === e.instr)?.decoded.mnemonic === 'jalr',
      ),
    )!;
    const a = activate(jalrResolve);
    expect(a.wires.has('alu-pcmux')).toBe(true);
    expect(a.wires.has('pcarith-pcmux')).toBe(false);
  });

  it('the bet lights the ID adder and redirects the pc, labelled with the address bet on', () => {
    const traces = record('  addi x1, x0, 3\nloop:\n  addi x1, x1, -1\n  bnez x1, loop', BET);
    const betting = traces.find((t) => t.events.some((e) => e.type === 'branch-predicted'))!;
    const bet = betting.events.find((e) => e.type === 'branch-predicted')!;
    const a = activate(betting);
    expect(a.components.has('btarget')).toBe(true);
    expect(a.wires.get('btarget-pcmux')?.value).toBe(bet.type === 'branch-predicted' ? bet.target : -1); // prettier-ignore
    expect(a.wires.get('btarget-pcmux')?.stage).toBe('ID');
  });

  it('a machine that predicts NOT-taken never lights the bet path — it takes no action', () => {
    for (const trace of record(
      '  addi x1, x0, 3\nloop:\n  addi x1, x1, -1\n  bnez x1, loop',
      NOFWD,
    )) {
      // prettier-ignore
      const a = activate(trace);
      for (const id of ['if2id-btarget', 'signext-btarget', 'btarget-pcmux'])
        expect(a.wires.has(id), id).toBe(false);
    }
  });
});

describe('activation coherence: every lit wire is a real wire with both endpoints lit', () => {
  it('holds at every cycle of a representative spread, in every config', () => {
    const byId = new Map(WIRES.map((wire) => [wire.id, wire]));
    const programs = [
      'lw x5, 64(x0)',
      'sw x1, 64(x0)',
      ALU_PAIR,
      'lw x1, 64(x0)\n  add x2, x1, x1',
      'beq x0, x0, ahead\n  addi x1, x0, 1\nahead:',
      'lui x5, 0x12345',
      'auipc x5, 0x1',
      'jal x1, fn\nfn:\n  jalr x0, 0(x1)',
      'addi x1, x0, 3\nloop:\n  addi x1, x1, -1\n  bnez x1, loop',
      FULL_PIPE,
    ];
    for (const cfg of CONFIGS) {
      for (const src of programs) {
        for (const trace of record(src, cfg)) {
          const a = activate(trace);
          for (const id of a.wires.keys()) {
            const wire = byId.get(id);
            expect(wire, `activated unknown wire "${id}" for \`${src}\``).toBeDefined();
            for (const end of wire!.ends) {
              const msg = `wire ${id} lit but endpoint ${end} is dim for \`${src}\` ${label(cfg)}`;
              expect(a.components.has(end), msg).toBe(true);
            }
          }
        }
      }
    }
  });

  it('never lights a forward-network wire with forwarding off', () => {
    // `activate` is config-OBLIVIOUS (INV-2), so with forwarding off it must simply never produce a
    // forward path — rather than produce one the view then has to filter away.
    for (const trace of record(ALU_PAIR, NOFWD)) {
      for (const id of activate(trace).wires.keys()) {
        const wire = WIRES.find((w) => w.id === id)!;
        expect(wire.forwardingOnly ?? false, `${id} lit with forwarding off`).toBe(false);
      }
    }
  });
});

describe('depth tiers × config — two visibility axes (INV-5)', () => {
  const FWD_STRUCTURE = ['fwdunit', 'fwdmuxa', 'fwdmuxb'];
  const visibleNodes = (t: DepthTier, f: DatapathConfig): Set<string> =>
    new Set([...NODES.values()].filter((n) => nodeVisibleAt(n, t, f)).map((n) => n.id));
  const visibleWires = (t: DepthTier, f: DatapathConfig): Set<string> =>
    new Set(WIRES.filter((w) => wireVisibleAt(w, t, f)).map((w) => w.id));

  it('tierVisible: an element shows once the selected tier reaches its minTier', () => {
    expect(tierVisible(undefined, 'essentials')).toBe(true);
    expect(tierVisible('expert', 'detailed')).toBe(false);
    expect(tierVisible('expert', 'expert')).toBe(true);
  });

  it('hides the forwarding + hazard structure below expert, and reveals it there', () => {
    for (const cfg of CONFIGS) {
      for (const t of ['essentials', 'detailed'] as const) {
        for (const n of [...FWD_STRUCTURE, 'hazard'])
          expect(visibleNodes(t, cfg).has(n), `${n}@${t} ${label(cfg)}`).toBe(false);
      }
    }
    // The seven-stage skeleton — INCLUDING all six bars — is drawn at every tier, in every config.
    const core = ['pc', 'imem', 'if1if2', 'if2id', 'idex1', 'ex1ex2', 'ex2mem', 'memwb', 'regfile', 'alu', 'dmem']; // prettier-ignore
    for (const id of core) {
      for (const t of DEPTH_TIERS)
        for (const cfg of CONFIGS)
          expect(visibleNodes(t, cfg).has(id), `${id}@${t} ${label(cfg)}`).toBe(true);
    }
  });

  it('the forwarding unit and its muxes are ABSENT when forwarding is off — even at expert', () => {
    for (const n of FWD_STRUCTURE) {
      expect(visibleNodes('expert', FWD).has(n), `${n} shown at expert+on`).toBe(true);
      expect(visibleNodes('expert', NOFWD).has(n), `${n} absent at expert+off`).toBe(false);
    }
  });

  it('the branch-target adder is ABSENT unless the machine bets — the second config axis', () => {
    for (const cfg of CONFIGS) {
      for (const tier of DEPTH_TIERS) {
        expect(visibleNodes(tier, cfg).has('btarget'), `btarget @ ${tier} ${label(cfg)}`).toBe(
          cfg.predictTaken,
        );
        for (const id of ['if2id-btarget', 'signext-btarget', 'btarget-pcmux'])
          expect(visibleWires(tier, cfg).has(id), `${id} @ ${tier} ${label(cfg)}`).toBe(
            cfg.predictTaken,
          );
      }
    }
  });

  it('the bet adder is tier-INDEPENDENT — it is the machine, not a detail', () => {
    for (const tier of DEPTH_TIERS)
      expect(visibleNodes(tier, BET).has('btarget'), `btarget@${tier}`).toBe(true);
    expect(visibleNodes('expert', { forwarding: false, predictTaken: true }).has('btarget')).toBe(
      true,
    );
    expect(visibleNodes('expert', { forwarding: true, predictTaken: false }).has('fwdunit')).toBe(
      true,
    );
  });

  it('the HAZARD unit is not config-gated — it is live in both positions', () => {
    // On this machine it is live in a THIRD way the 5-stage never had: `ex-latency`, the stall a
    // producer causes simply by not having finished. Gating it on forwarding would erase the
    // interlock from the exact diagram meant to explain it.
    for (const cfg of CONFIGS) expect(visibleNodes('expert', cfg).has('hazard')).toBe(true);
  });

  it('swaps contraction wires for through-mux wires, on BOTH axes', () => {
    const contractions = WIRES.filter((w) => w.contracts);
    expect(contractions.length).toBeGreaterThan(0);
    for (const w of contractions) {
      for (const tier of DEPTH_TIERS) {
        for (const cfg of CONFIGS) {
          const unitDrawn = nodeVisibleAt(NODES.get(w.contracts!)!, tier, cfg);
          const gated =
            ((w.forwardingOnly ?? false) && !cfg.forwarding) ||
            ((w.predictTakenOnly ?? false) && !cfg.predictTaken);
          expect(
            visibleWires(tier, cfg).has(w.id),
            `${w.id} @ ${tier} ${label(cfg)} (unit ${w.contracts} drawn=${unitDrawn})`,
          ).toBe(!unitDrawn && !gated);
        }
      }
    }
  });

  it('never draws a wire whose endpoint node is hidden (no dangling — PER TIER × PER CONFIG)', () => {
    for (const tier of DEPTH_TIERS) {
      for (const cfg of CONFIGS) {
        const nodes = visibleNodes(tier, cfg);
        for (const wire of WIRES) {
          if (!wireVisibleAt(wire, tier, cfg)) continue;
          for (const end of wire.ends) {
            const msg = `wire ${wire.id} shown at ${tier} ${label(cfg)} but ${end} hidden`;
            expect(nodes.has(end), msg).toBe(true);
          }
        }
      }
    }
  });

  it('each contraction is LAWFUL: it collapses exactly its unit (same source, same sink)', () => {
    // The INV-5 correctness condition: a contraction `S → T` bypassing unit M must equal the expert
    // path `S → M → T`. **The sinks moved in this fork** — the forwarding muxes now output onto the
    // EX1/EX2 LATCH rather than onto the ALU, so a contraction copied from the 5-stage would end in
    // the wrong place and this is what catches it.
    const touches = (w: (typeof WIRES)[number], node: string): boolean => w.ends.includes(node);
    for (const w of WIRES) {
      if (!w.contracts) continue;
      const unit = w.contracts;
      const [src, sink] = w.ends;
      const inLeg = WIRES.some((t) => t.id !== w.id && touches(t, src) && touches(t, unit));
      const outLeg = WIRES.some((t) => t.id !== w.id && touches(t, unit) && touches(t, sink));
      expect(inLeg, `${w.id}: no through-wire ${src}→${unit}`).toBe(true);
      expect(outLeg, `${w.id}: no through-wire ${unit}→${sink}`).toBe(true);
    }
    // ...and specifically: every forwarding-mux contraction sinks on the EX1/EX2 latch.
    for (const w of WIRES) {
      if (w.contracts !== 'fwdmuxa' && w.contracts !== 'fwdmuxb') continue;
      expect(w.ends[1], `${w.id} sinks somewhere other than the EX1/EX2 latch`).toBe('ex1ex2');
    }
  });

  it('adds representational detail as the tier climbs (labels only add — lawful, INV-5)', () => {
    expect(DEPTH_TIERS.map(showValueLabels)).toEqual([false, true, true]);
    expect(DEPTH_TIERS.map(showControlLabels)).toEqual([false, false, true]);
  });
});

describe('geometry: node boxes are sane (the automatable slice of visual acceptance)', () => {
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

  it('the SIX latch bars divide the SEVEN stage bands, in left-to-right pipeline order', () => {
    // "7 stages, 6 latches" has to be what the picture literally is, or the diagram is not of this
    // machine — and this is the fixture the milestone existed to stop being hand-built.
    const bars = ['if1if2', 'if2id', 'idex1', 'ex1ex2', 'ex2mem', 'memwb'].map((id) => NODES.get(id)!); // prettier-ignore
    expect(bars.length).toBe(STAGES.length - 1);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i - 1]!.x, `${bars[i - 1]!.id} left of ${bars[i]!.id}`).toBeLessThan(bars[i]!.x);
    }
    for (const b of bars) expect(b.h, `${b.id} spans the diagram`).toBeGreaterThan(300);
    const between = (id: string, l: string, r: string): void => {
      const n = NODES.get(id)!;
      expect(n.x, `${id} right of ${l}`).toBeGreaterThan(NODES.get(l)!.x);
      expect(n.x, `${id} left of ${r}`).toBeLessThan(NODES.get(r)!.x);
    };
    between('imem', 'pc', 'if1if2');
    between('regfile', 'if2id', 'idex1');
    // The EX split drawn as coordinates: the muxes are in EX1, the ALU is in EX2, and the EX1/EX2
    // bar is BETWEEN them. This is the geometric form of "the operands wait a cycle".
    between('fwdmuxa', 'idex1', 'ex1ex2');
    between('fwdmuxb', 'idex1', 'ex1ex2');
    between('alu', 'ex1ex2', 'ex2mem');
    between('dmem', 'ex2mem', 'memwb');
    expect(NODES.get('wbmux')!.x).toBeGreaterThan(NODES.get('memwb')!.x);
  });
});

describe('geometry: wires are orthogonal and anchored on real edges (visual acceptance)', () => {
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

  it('no two simultaneously-drawn wires run collinearly on top of each other', () => {
    // A collinear overlap is a permanent "two lines as one", invisible to the eye. Bucket by BOTH
    // axes: a contraction and its through-mux wire are intentionally collinear but never co-visible.
    // SIX tall bars make this harder than it was at five, which is why it is asserted per-config.
    for (const tier of DEPTH_TIERS) {
      for (const cfg of CONFIGS) {
        const vis = WIRES.filter((w) => wireVisibleAt(w, tier, cfg));
        for (let i = 0; i < vis.length; i++) {
          for (let j = i + 1; j < vis.length; j++) {
            const wi = vis[i]!;
            const wj = vis[j]!;
            let worst = 0;
            for (const sa of segmentsOf(wi.points))
              for (const sb of segmentsOf(wj.points))
                worst = Math.max(worst, collinearOverlap(sa, sb));
            expect
              .soft(
                worst,
                `${wi.id} overlaps ${wj.id} at ${tier} ${label(cfg)} for ${worst.toFixed(0)}px`,
              )
              .toBeLessThan(2);
          }
        }
      }
    }
  });

  it('no wire touches the TOP edge of a unit that carries a control label', () => {
    // A BROWSER FINDING (step 7), turned into a rule. `DatapathDiagram` draws a `controlLabel` as a
    // single centred `<text>` four pixels above the box — it does not wrap and it is not de-collided
    // against wires. This model's hazard label is the longest in the project (it names THREE held
    // things where the 5-stage names two), so the two hold stubs originally leaving the top edge ran
    // underneath it. The three holds now leave the LEFT edge, which is also the truer picture: they
    // all travel backwards to the front end. Stated as a rule so the next unit to gain a label does
    // not rediscover it in a screenshot.
    const labelled = [...NODES.values()].filter((n) => n.controlLabel);
    expect(labelled.map((n) => n.id).sort()).toEqual(['fwdmuxa', 'fwdmuxb', 'hazard', 'pcmux', 'wbmux']); // prettier-ignore
    for (const n of labelled) {
      for (const wire of WIRES) {
        for (const [i, end] of wire.ends.entries()) {
          if (end !== n.id) continue;
          const [px, py] = i === 0 ? wire.points[0]! : wire.points[wire.points.length - 1]!;
          const onTop = Math.abs(py - n.y) < 0.01 && px > n.x - 0.01 && px < n.x + n.w + 0.01;
          expect(onTop, `${wire.id} anchors on ${n.id}'s top edge, under its control label`).toBe(false); // prettier-ignore
        }
      }
    }
  });

  it('no wire runs THROUGH a latch bar it does not terminate on', () => {
    // New here, because six bars leave far less clear space than four: a horizontal run that crosses
    // a 360px-tall bar draws a value teleporting past a latch, which is the one thing a pipeline
    // diagram must never show. Vertical runs above/below the bars are how the control rails escape.
    const bars = ['if1if2', 'if2id', 'idex1', 'ex1ex2', 'ex2mem', 'memwb'].map((id) => NODES.get(id)!); // prettier-ignore
    for (const wire of WIRES) {
      for (const [ax, ay, bx, by] of segmentsOf(wire.points)) {
        if (Math.abs(ay - by) > 0.01) continue; // vertical: it can only cross a bar's band, not it
        const lo = Math.min(ax, bx);
        const hi = Math.max(ax, bx);
        for (const bar of bars) {
          if (wire.ends.includes(bar.id)) continue; // terminating on it is the point
          const crossesX = lo < bar.x + bar.w - 0.01 && hi > bar.x + 0.01;
          const crossesY = ay > bar.y + 0.01 && ay < bar.y + bar.h - 0.01;
          expect(crossesX && crossesY, `${wire.id} runs through the ${bar.id} bar`).toBe(false);
        }
      }
    }
  });
});
