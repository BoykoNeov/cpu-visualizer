import { DEPTH_TIERS, type DepthTier } from '@cpu-viz/curriculum';
import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { defaultConfig, type CycleTrace } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import {
  activate,
  CANVAS,
  NODES,
  nodeVisibleAt,
  showControlLabels,
  showValueLabels,
  STAGES,
  tierVisible,
  WIRES,
  wireVisibleAt,
  type DatapathConfig,
  type Stage,
} from './datapath-pipeline';
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

/**
 * The four MACHINES this diagram can be asked to draw — the cross product of the two honored knobs,
 * not of the config's values. M4 step 5 doubled this list: it was the two forwarding positions, and
 * prediction is the second axis. `predictTaken` is a behavior rather than a scheme name because
 * `'none'` and `'static-not-taken'` are one machine, so a third entry would test nothing new (M4
 * step 1) — the same reason the shell's control has two positions for three names.
 */
const CONFIGS: readonly DatapathConfig[] = [
  { forwarding: false, predictTaken: false },
  { forwarding: true, predictTaken: false },
  { forwarding: false, predictTaken: true },
  { forwarding: true, predictTaken: true },
];
const label = (c: DatapathConfig): string =>
  `forwarding ${c.forwarding ? 'on' : 'off'} / predict ${c.predictTaken ? 'taken' : 'not-taken'}`;

/** The three the older tests name directly: this file's subject is usually ONE axis at a time. */
const FWD: DatapathConfig = { forwarding: true, predictTaken: false };
const NOFWD: DatapathConfig = { forwarding: false, predictTaken: false };
const BET: DatapathConfig = { forwarding: true, predictTaken: true };

/** Record a whole run under one machine and return every cycle's trace. Appends a
 *  clean exit so assembly always succeeds. No new fixtures — these are litmus programs for the
 *  VIEW, the same way `datapath-multi.test.ts` writes its own (INV-7 governs the example library
 *  the user runs, not a test's two-line probe). */
function record(source: string, cfg: DatapathConfig): CycleTrace[] {
  const result = loadSource(`${source}\n  li a7, 10\n  ecall\n`, () => new PipelineProcessor(), {
    ...defaultConfig(),
    forwarding: cfg.forwarding,
    branchPrediction: cfg.predictTaken ? 'static-taken' : 'static-not-taken',
  });
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

describe('activation is MULTI-INSTRUCTION (the break from every earlier model)', () => {
  // Six independent `addi`s: no hazards, so the pipe fills cleanly and every stage is occupied by
  // a DIFFERENT instruction — the shape M1 and M2 could not produce at all.
  const FILL = '  addi x1, x0, 1\n  addi x2, x0, 2\n  addi x3, x0, 3\n  addi x4, x0, 4\n  addi x5, x0, 5\n  addi x6, x0, 6'; // prettier-ignore

  it('lights five stages for five DIFFERENT instructions in one cycle', () => {
    const traces = record(FILL, FWD);
    const full = traces.find((t) => t.instructions.length === 5);
    expect(full, 'no cycle with five instructions in flight').toBeDefined();

    const act = activate(full!);
    expect([...act.occupancy.keys()].sort()).toEqual([...STAGES].sort());
    // Five DISTINCT ids — the whole point. One id in two stages would mean the pipe is a fiction.
    expect(new Set(act.occupancy.values()).size).toBe(5);

    // Each stage's own slice is lit, and each lit wire is tagged with THAT stage's occupant.
    const stageOf = (wireId: string): Stage | undefined => act.wires.get(wireId)?.stage;
    expect(stageOf('pc-imem')).toBe('IF');
    expect(stageOf('ifid-regfile')).toBe('ID');
    expect(stageOf('alu-exmem')).toBe('EX');
    expect(stageOf('exmem-memwb')).toBe('MEM');
    expect(stageOf('wbmux-regfile')).toBe('WB');
    for (const [id, a] of act.wires) {
      expect(act.occupancy.get(a.stage), `wire ${id} tagged ${a.stage}/${a.instr}`).toBe(a.instr);
    }
  });

  it('the register file is lit for TWO instructions at once (ID reads while WB writes)', () => {
    // The same-cycle WB→ID rule, seen from the view: one box, two instructions, two stages — which
    // is exactly why component boxes are hue-neutral and only wires carry the stage color.
    const traces = record(FILL, FWD);
    const full = traces.find((t) => t.instructions.length === 5)!;
    const act = activate(full);
    expect(act.components.has('regfile')).toBe(true);
    expect(act.wires.get('ifid-regfile')?.stage).toBe('ID');
    expect(act.wires.get('wbmux-regfile')?.stage).toBe('WB');
    expect(act.wires.get('ifid-regfile')!.instr).not.toBe(act.wires.get('wbmux-regfile')!.instr);
  });

  it('occupancy is read from `instructions[].location`, never from the one-cycle-ahead `micro`', () => {
    // The pinned trap ("Which edge `micro` is snapshotted at"): `state.micro` at cycle i holds the
    // latches as of the CLOCK EDGE — what the stages read at cycle i+1. A datapath sourced from it
    // draws the pipe one cycle ahead of itself, and every other test here would still pass. So this
    // asserts the whole timeline against `location`, the only field that describes THIS cycle.
    for (const cfg of CONFIGS) {
      const traces = record(FILL, cfg);
      for (const t of traces) {
        const act = activate(t);
        expect(Object.fromEntries(act.occupancy), `${label(cfg)} @ cycle ${t.cycle}`).toEqual(
          Object.fromEntries(locationsOf(t)),
        );
      }
    }
  });

  it('is empty for the pre-run state (no in-flight instruction)', () => {
    const a = activate(null);
    expect(a.occupancy.size).toBe(0);
    expect(a.components.size).toBe(0);
    expect(a.wires.size).toBe(0);
    expect(a.writtenReg).toBeNull();
  });
});

describe('forwarding is a change of PATH, not an extra wire', () => {
  // A distance-1 RAW: the `add` needs `x1` while the `addi` producing it is still in EX/MEM.
  const RAW = '  addi x1, x0, 7\n  add x2, x1, x1';

  it('a forward lights the EX/MEM path and DARKENS the register-file path into the same mux', () => {
    const traces = record(RAW, FWD);
    const cycle = traces.find((t) => t.events.some((e) => e.type === 'forward'));
    expect(cycle, 'no forward fired').toBeDefined();
    const act = activate(cycle!);

    // Both operands of `add x2, x1, x1` forward from EX/MEM, so both mux inputs come from there.
    expect(act.wires.has('exmem-fwdmuxa')).toBe(true);
    expect(act.wires.has('exmem-fwdmuxb')).toBe(true);
    // ...and the stale register-file value must NOT also be drawn flowing into the ALU. Lighting
    // both would show the pre-forward value beside the forwarded one — the exact misconception.
    expect(act.wires.has('idex-fwdmuxa'), 'stale register path lit alongside the forward').toBe(false); // prettier-ignore
    expect(act.wires.has('idex-fwdmuxb')).toBe(false);
    // The same holds of the contractions, so the lower tiers tell the same story (INV-5).
    expect(act.wires.has('exmem-alu-a')).toBe(true);
    expect(act.wires.has('idex-alu-a')).toBe(false);
    expect(act.wires.get('exmem-fwdmuxa')?.value).toBe(7);
  });

  it('with no forward, the register-file path IS the lit one', () => {
    // Same program, forwarding off: the ID interlock has already made the latched value current,
    // so the operand genuinely arrives from the register file — and no forward path exists at all.
    const traces = record(RAW, NOFWD);
    const cycle = traces.find((t) =>
      t.events.some((e) => e.type === 'alu-op' && e.op === 'add' && e.a === 7),
    );
    expect(cycle, 'no add executed').toBeDefined();
    const act = activate(cycle!);
    expect(act.wires.has('idex-fwdmuxa')).toBe(true);
    expect(act.wires.has('exmem-fwdmuxa')).toBe(false);
    expect(act.wires.get('idex-fwdmuxa')?.value).toBe(7);
    for (const t of traces) expect(t.events.some((e) => e.type === 'forward')).toBe(false);
  });

  it('the hazard unit lights when — and only when — the interlock actually fires', () => {
    for (const cfg of CONFIGS) {
      const traces = record(RAW, cfg);
      for (const t of traces) {
        const stalled = t.events.some((e) => e.type === 'stall');
        expect(activate(t).components.has('hazard'), `${label(cfg)} @ ${t.cycle}`).toBe(stalled);
      }
    }
  });

  it('the load-use stall — the bubble forwarding cannot remove — lights it in BOTH positions', () => {
    for (const cfg of CONFIGS) {
      const traces = record('  lw x1, 64(x0)\n  add x2, x1, x1', cfg);
      const stalled = traces.filter((t) => t.events.some((e) => e.type === 'stall'));
      expect(stalled.length, `${label(cfg)}: load-use never stalled`).toBeGreaterThan(0);
      for (const t of stalled) {
        const act = activate(t);
        expect(act.components.has('hazard')).toBe(true);
        // Its answer is to HOLD: the PC and the IF/ID latch, which is the repeated `IF IF` cell.
        expect(act.wires.has('hazard-pc')).toBe(true);
        expect(act.wires.has('hazard-ifid')).toBe(true);
      }
    }
  });
});

describe('the branch redirect (drawn from `branch-resolved` — the signal M2 never had)', () => {
  it('a TAKEN pc-relative transfer redirects the pc from the pc adder, labelled with its target', () => {
    const traces = record('  beq x0, x0, ahead\n  addi x1, x0, 1\nahead:\n  addi x2, x0, 2', FWD);
    const cycle = traces.find((t) =>
      t.events.some((e) => e.type === 'branch-resolved' && e.actual),
    );
    expect(cycle).toBeDefined();
    const resolved = cycle!.events.find((e) => e.type === 'branch-resolved')!;
    const act = activate(cycle!);
    expect(act.wires.has('pcarith-pcmux')).toBe(true);
    expect(act.wires.get('pcarith-pcmux')?.value).toBe(
      resolved.type === 'branch-resolved' ? resolved.target : -1,
    );
    expect(act.wires.get('pcarith-pcmux')?.stage).toBe('EX');
    expect(act.wires.has('alu-pcmux'), 'only jalr redirects from the ALU').toBe(false);
  });

  it('a NOT-taken branch resolves but redirects nothing (the +4 already fetched is the answer)', () => {
    const traces = record('  bne x0, x0, ahead\n  addi x1, x0, 1\nahead:\n  addi x2, x0, 2', FWD);
    const cycle = traces.find((t) =>
      t.events.some((e) => e.type === 'branch-resolved' && !e.actual),
    );
    expect(cycle, 'no not-taken resolution').toBeDefined();
    const act = activate(cycle!);
    expect(act.wires.has('pcarith-pcmux')).toBe(false);
    expect(act.wires.has('alu-pcmux')).toBe(false);
  });

  it('`jalr` alone redirects from the ALU — a REGISTER supplies its target', () => {
    const traces = record('  jal x1, fn\nfn:\n  jalr x0, 0(x1)', FWD);
    const cycle = traces.find((t) =>
      t.events.some(
        (e) =>
          e.type === 'branch-resolved' &&
          e.actual &&
          t.instructions.some((i) => i.id === e.instr && i.decoded.mnemonic === 'jalr'),
      ),
    );
    expect(cycle, 'no taken jalr').toBeDefined();
    const act = activate(cycle!);
    expect(act.wires.has('alu-pcmux')).toBe(true);
    expect(act.wires.has('pcarith-pcmux')).toBe(false);
  });
});

describe('the BET and the CORRECTION — two redirects, two stages (M4 step 5)', () => {
  const TAKEN_BRANCH = '  beq x0, x0, ahead\n  addi x1, x0, 1\nahead:\n  addi x2, x0, 2';
  const NEVER_BRANCH = '  bne x0, x0, ahead\n  addi x1, x0, 1\nahead:\n  addi x2, x0, 2';

  const betCycle = (traces: CycleTrace[]): CycleTrace | undefined =>
    traces.find((t) => t.events.some((e) => e.type === 'branch-predicted'));

  it('the bet lights the ID adder and redirects the pc, labelled with the address bet on', () => {
    const traces = record(TAKEN_BRANCH, BET);
    const cycle = betCycle(traces);
    expect(cycle, 'no bet fired').toBeDefined();
    const ev = cycle!.events.find((e) => e.type === 'branch-predicted')!;
    const act = activate(cycle!);

    expect(act.components.has('btarget')).toBe(true);
    expect(act.wires.has('ifid-btarget')).toBe(true);
    expect(act.wires.has('signext-btarget')).toBe(true);
    // The redirect carries the ENGINE's number — the view never re-derives `pc + imm` (INV-3).
    expect(act.wires.get('btarget-pcmux')?.value).toBe(
      ev.type === 'branch-predicted' ? ev.target : -1,
    );
    // Hued as ID's work: the bet is placed by the instruction in DECODE, a stage before the answer
    // exists. That is the whole reason a correct bet costs 1 rather than 2.
    expect(act.wires.get('btarget-pcmux')?.stage).toBe('ID');
    expect(act.wires.get('btarget-pcmux')?.instr).toBe(
      ev.type === 'branch-predicted' ? ev.instr : '',
    );
  });

  /**
   * **The step's headline correctness fix, and it is in code M3 shipped.** `activate` drew the EX
   * redirect on `resolved.actual`, which was RIGHT under predict-not-taken and is a coincidence:
   * a machine that never bets taken can only ever be wrong about a branch that WAS taken. Turn the
   * bet on and the two come apart in both directions. This is the taken half — the bet already
   * steered fetch in ID, so EX has nothing to correct and must draw nothing.
   *
   * Mutation: restore `if (resolved.actual)` and this fails — EX draws a redirect the machine
   * never performed, beside the ID bet that actually did the work. Two redirects for one transfer.
   */
  it('a CORRECT bet leaves EX with nothing to correct — only ID redirects', () => {
    const traces = record(TAKEN_BRANCH, BET);
    const cycle = traces.find((t) =>
      t.events.some((e) => e.type === 'branch-resolved' && e.predicted && e.actual),
    );
    expect(cycle, 'no correctly-predicted taken branch').toBeDefined();
    const act = activate(cycle!);
    expect(act.wires.has('pcarith-pcmux'), 'EX redirected a pc the bet had already steered').toBe(
      false,
    );
    expect(act.wires.has('alu-pcmux')).toBe(false);
  });

  /**
   * The other half, and the one `actual` is silently blind to: a bet on a branch that DECLINES.
   * The machine really does redirect — back to the fall-through it wrongly discarded — so drawing
   * nothing would be the diagram claiming a free branch. This is `call-return.s`'s `bge`, the
   * transfer that makes `static-taken` LOSE, so it is the milestone's thesis on the canvas.
   *
   * Mutation: restore `if (resolved.actual)` and this fails with the redirect simply absent.
   */
  it('a LOST bet redirects from EX to the FALL-THROUGH — the correction `actual` cannot see', () => {
    const traces = record(NEVER_BRANCH, BET);
    const cycle = traces.find((t) =>
      t.events.some((e) => e.type === 'branch-resolved' && e.predicted && !e.actual),
    );
    expect(cycle, 'no lost bet — the program does not test what it claims').toBeDefined();
    const resolved = cycle!.events.find((e) => e.type === 'branch-resolved')!;
    const act = activate(cycle!);
    expect(act.wires.has('pcarith-pcmux'), 'a lost bet corrects, and it must be drawn').toBe(true);
    expect(act.wires.get('pcarith-pcmux')?.value).toBe(
      resolved.type === 'branch-resolved' ? resolved.target : -1,
    );
    // ...and the correction really is the fall-through, not the target: the branch is at pc 0.
    expect(act.wires.get('pcarith-pcmux')?.value).toBe(4);
  });

  /**
   * The reason this needed a trace EVENT rather than the `flush` the milestone expected to reuse.
   * The flush reports CASUALTIES, so a branch with nothing behind it in IF bets — redirecting the
   * pc — and raises none. Drawn from the flush, this diagram would be dark in exactly the cycles
   * the machine was betting, and the pc would jump with no wire to explain it.
   */
  it('draws a bet that killed NOBODY — the flush is the cost, not the action', () => {
    // The `bnez` is the last word in `.text` (this program appends no `ecall`), so the
    // fall-through fetch is out of text on every pass and IF never has anything to lose.
    const result = loadSource(
      'addi x1, x0, 3\nloop:\naddi x1, x1, -1\nbnez x1, loop\n',
      () => new PipelineProcessor(),
      { ...defaultConfig(), branchPrediction: 'static-taken' },
    );
    if (!result.ok) throw new Error('assembly failed');
    const traces: CycleTrace[] = [];
    for (;;) {
      result.loaded.recorder.stepForward();
      const t = result.loaded.recorder.current()!;
      traces.push(t);
      if (t.state.halted || traces.length > 200) break;
    }
    const bets = traces.filter((t) => t.events.some((e) => e.type === 'branch-predicted'));
    expect(bets.length, 'the loop must bet — otherwise this tests nothing').toBe(3);
    for (const t of bets) {
      expect(
        t.events.some((e) => e.type === 'flush'),
        `cycle ${t.cycle}: this bet raised a flush, so it is not the blind case`,
      ).toBe(false);
      // The bet is drawn anyway. This is the assertion the flush could not support.
      expect(activate(t).wires.has('btarget-pcmux'), `cycle ${t.cycle}`).toBe(true);
    }
  });

  it('a machine that predicts NOT-taken never lights the bet path — it takes no action', () => {
    for (const src of [TAKEN_BRANCH, NEVER_BRANCH]) {
      const traces = record(src, FWD); // predictTaken: false
      for (const t of traces) {
        const act = activate(t);
        expect(act.components.has('btarget'), `@${t.cycle}`).toBe(false);
        expect(act.wires.has('btarget-pcmux'), `@${t.cycle}`).toBe(false);
      }
    }
  });
});

describe('activation coherence: every lit wire is a real wire with both endpoints lit', () => {
  it('holds at every cycle of a representative spread, in both configs', () => {
    const byId = new Map(WIRES.map((wire) => [wire.id, wire]));
    const programs = [
      'lw x5, 64(x0)',
      'sw x1, 64(x0)',
      'addi x1, x0, 7\n  add x2, x1, x1',
      'lw x1, 64(x0)\n  add x2, x1, x1',
      'beq x0, x0, ahead\n  addi x1, x0, 1\nahead:',
      'lui x5, 0x12345',
      'auipc x5, 0x1',
      'jal x1, fn\nfn:\n  jalr x0, 0(x1)',
      'addi x1, x0, 3\nloop:\n  addi x1, x1, -1\n  bnez x1, loop',
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

  it('never lights a wire the current tier×config would not draw at all', () => {
    // The other half of coherence, and the one the config axis makes possible: `activate` is
    // config-OBLIVIOUS (INV-2), so with forwarding off it must simply never produce a forward
    // path — rather than produce one the view then has to filter away. If it did, the two would
    // disagree about what happened, and only the view's silence would hide it.
    for (const trace of record('  addi x1, x0, 7\n  add x2, x1, x1', NOFWD)) {
      for (const id of activate(trace).wires.keys()) {
        const wire = WIRES.find((w) => w.id === id)!;
        expect(wire.forwardingOnly ?? false, `${id} lit with forwarding off`).toBe(false);
      }
    }
  });
});

describe('depth tiers × config — two visibility axes (handoff §4, INV-5)', () => {
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
    // The five-stage skeleton is drawn at EVERY tier, in EVERY config — it is the story.
    for (const core of ['pc', 'imem', 'ifid', 'idex', 'exmem', 'memwb', 'regfile', 'alu', 'dmem']) {
      for (const t of DEPTH_TIERS)
        for (const cfg of CONFIGS)
          expect(visibleNodes(t, cfg).has(core), `${core}@${t} ${label(cfg)}`).toBe(true);
    }
  });

  it('the forwarding unit and its muxes are ABSENT when forwarding is off — even at expert', () => {
    // The milestone's config-driven structure, and the reason it is lawful: the trace has no
    // `forward` events in that position, so an idle forwarding network would CONTRADICT it.
    for (const n of FWD_STRUCTURE) {
      expect(visibleNodes('expert', FWD).has(n), `${n} shown at expert+on`).toBe(true);
      expect(visibleNodes('expert', NOFWD).has(n), `${n} absent at expert+off`).toBe(false);
    }
  });

  /**
   * The bet's structure is gated on the PREDICTION axis — the mirror of the forwarding network's
   * rule, and lawful for the mirror reason: a machine predicting not-taken emits no
   * `branch-predicted` events because it performs no action, so an idle bet adder would draw a
   * decision that is never made.
   */
  it('the branch-target adder is ABSENT unless the machine bets — the second config axis', () => {
    for (const cfg of CONFIGS) {
      for (const tier of DEPTH_TIERS) {
        const drawn = visibleNodes(tier, cfg).has('btarget');
        expect(drawn, `btarget @ ${tier} ${label(cfg)}`).toBe(cfg.predictTaken);
        // ...and its wires go with it, so the redirect never dangles out of a hidden adder.
        for (const id of ['ifid-btarget', 'signext-btarget', 'btarget-pcmux'])
          expect(visibleWires(tier, cfg).has(id), `${id} @ ${tier} ${label(cfg)}`).toBe(
            cfg.predictTaken,
          );
      }
    }
  });

  /**
   * ...and it is drawn at EVERY tier once it exists, unlike the forwarding unit. The bet is not an
   * optimization detail the skeleton may omit: with the toggle on it is where the machine's next pc
   * comes from, so hiding it at `essentials` would leave the redirect arriving from nowhere — and
   * there is no mux here to stand a contraction in for.
   */
  it('the bet adder is tier-INDEPENDENT — it is the machine, not a detail', () => {
    for (const tier of DEPTH_TIERS)
      expect(visibleNodes(tier, BET).has('btarget'), `btarget@${tier}`).toBe(true);
    // The two axes really are independent: forwarding off does not hide the bet, and vice versa.
    expect(visibleNodes('expert', { forwarding: false, predictTaken: true }).has('btarget')).toBe(
      true,
    );
    expect(visibleNodes('expert', { forwarding: true, predictTaken: false }).has('fwdunit')).toBe(
      true,
    );
  });

  it('the HAZARD unit is not config-gated — it is live in both positions', () => {
    // Deliberately unlike the forwarding unit: the load-use stall survives forwarding, and the RAW
    // interlock is the whole story without it. Gating it on config would erase the interlock from
    // the exact diagram meant to explain it.
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
          // A contraction is drawn exactly when its unit is not (and its own config gate allows).
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
    // The INV-5 correctness condition (the acceptance gate): a contraction wire `S → T` bypassing
    // unit M must equal the expert path `S → M → T` — there must exist through-wires S→M and M→T.
    // A contraction that routed somewhere the expert path does not would be a lower tier
    // CONTRADICTING a higher one. Through-wires are identified by touching the unit, not by a
    // `minTier` marker: here they are gated by their endpoint, which is the same fact.
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

  it('the four latch bars divide the five stage bands, in left-to-right pipeline order', () => {
    // The layout contract, asserted rather than eyeballed: "5 stages, 4 latches" has to be what the
    // picture literally is, or the diagram is not of this machine.
    const bars = ['ifid', 'idex', 'exmem', 'memwb'].map((id) => NODES.get(id)!);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i - 1]!.x, `${bars[i - 1]!.id} left of ${bars[i]!.id}`).toBeLessThan(bars[i]!.x);
    }
    // Each bar spans the band it divides, so every stage's units sit clearly on one side of it.
    for (const b of bars) expect(b.h, `${b.id} spans the diagram`).toBeGreaterThan(300);
    const between = (id: string, l: string, r: string): void => {
      const n = NODES.get(id)!;
      expect(n.x, `${id} right of ${l}`).toBeGreaterThan(NODES.get(l)!.x);
      expect(n.x, `${id} left of ${r}`).toBeLessThan(NODES.get(r)!.x);
    };
    between('imem', 'pc', 'ifid');
    between('regfile', 'ifid', 'idex');
    between('alu', 'idex', 'exmem');
    between('dmem', 'exmem', 'memwb');
    // WB is the last band — there is no fifth bar to its right, only the bus home to the registers.
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
    // axes: a contraction and its through-mux wire are intentionally collinear but never co-visible,
    // and neither are the forward paths across the two configs. Crossings / shared endpoints are fine.
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
});
