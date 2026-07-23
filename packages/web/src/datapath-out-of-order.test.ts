import { DEPTH_TIERS, type DepthTier } from '@cpu-viz/curriculum';
import { OutOfOrderProcessor } from '@cpu-viz/engine-out-of-order';
import { CACHE_LARGE } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import {
  activate,
  CANVAS,
  NODES,
  nodeVisibleAt,
  showValueLabels,
  WIRES,
  wireVisibleAt,
  type DatapathConfig,
} from './datapath-out-of-order';
import { shapePolygon } from './DatapathDiagram';
import { loadSource } from './simulator';

/**
 * M9 step 7 — the out-of-order datapath's geometry + activation net. Two things are genuinely new
 * here versus the four sibling suites, and both get their own section:
 *  - activation reads `state.micro` (box occupancy) AND `events` (flow), so the coherence litmus is
 *    the real acceptance gate — a lit flow wire must land on a box the micro says is occupied;
 *  - there is NO structural tiering (the ROB/RS/CDB are the tier), so contraction-lawfulness is N/A
 *    and deliberately not ported; the depth dial tiers only the value labels.
 */

/** True when `pt` lies (within `eps`) on any edge of node `id`'s drawn outline. Every OoO box is a
 *  plain rectangle, so this is its four corners — but hit-testing the real perimeter keeps the check
 *  honest against any future shaped node. */
function onPerimeter(pt: readonly [number, number], id: string, eps = 0.5): boolean {
  const poly = shapePolygon(NODES.get(id)!);
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

/** The two MACHINES this diagram draws — the one honored knob (does it bet?). Forwarding and issue
 *  width do not restructure a pool-based OoO diagram, so neither is an axis here. */
const CONFIGS: readonly DatapathConfig[] = [{ predictTaken: false }, { predictTaken: true }];
const label = (c: DatapathConfig): string => `predict ${c.predictTaken ? 'taken' : 'not-taken'}`;
const BET: DatapathConfig = { predictTaken: true };
const NOBET: DatapathConfig = { predictTaken: false };

/** Record a whole out-of-order run under one machine. `outOfOrderIssue: true` + width 2 + a cache
 *  (so loads miss and the money-shot reordering happens); a clean exit is appended so assembly
 *  always succeeds. These are litmus probes for the VIEW (INV-7 governs the example library the user
 *  runs, not a test's two-line probe). */
function record(source: string, cfg: DatapathConfig): CycleTrace[] {
  const result = loadSource(`${source}\n  li a7, 10\n  ecall\n`, () => new OutOfOrderProcessor(), {
    ...defaultConfig(),
    issueWidth: 2,
    outOfOrderIssue: true,
    branchPrediction: cfg.predictTaken ? 'static-taken' : 'static-not-taken',
    cache: CACHE_LARGE,
    robSize: 16,
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

/** A range of loads then a dependent reduction — the money-shot shape (independent loads race a
 *  stuck reduction under a miss). Scratch memory well past `.text`. */
const REDUCE =
  '  addi x5, x0, 256\n  lw x6, 0(x5)\n  add x1, x1, x6\n  lw x7, 4(x5)\n  add x1, x1, x7';

describe('activation folds micro (boxes) and events (flow) into one coherent frame', () => {
  it('is empty for the pre-run / non-OoO state', () => {
    const a = activate(null);
    expect(a.components.size).toBe(0);
    expect(a.wires.size).toBe(0);
  });

  it('lights the ROB whenever anything is in flight, and the RS whenever anything waits', () => {
    // The occupancy → active direction: a box is lit AT LEAST whenever micro says it holds work. The
    // reverse is not an iff — an issue wire (rs-alu / rs-lsu) also lights the RS the cycle an
    // instruction leaves it, which is correct (component set = micro occupancy ∪ lit-wire endpoints).
    for (const t of record(REDUCE, BET)) {
      const micro = t.state.micro as { rob: { state: string }[] };
      const a = activate(t);
      if (micro.rob.length > 0) expect(a.components.has('rob'), `rob@${t.cycle}`).toBe(true);
      if (micro.rob.some((e) => e.state === 'waiting'))
        expect(a.components.has('rs'), `rs@${t.cycle}`).toBe(true);
    }
  });

  it('an `alu-op` result rides the CDB; a load ADDRESS goes to the LSU, not the bus', () => {
    const traces = record(REDUCE, BET);
    // An R/I `add` result: rs-alu + alu-cdb + the fan, all attributed to the same producer.
    const aluCycle = traces.find((t) =>
      t.events.some((e) => e.type === 'alu-op' && e.op === 'add'),
    );
    expect(aluCycle, 'no add executed').toBeDefined();
    const addEv = aluCycle!.events.find((e) => e.type === 'alu-op' && e.op === 'add')!;
    const a = activate(aluCycle!);
    expect(a.wires.get('rs-alu')?.instr).toBe(addEv.type === 'alu-op' ? addEv.instr : '');
    expect(a.wires.has('alu-cdb')).toBe(true);
    expect(a.wires.has('cdb-rs')).toBe(true);
    expect(a.wires.has('cdb-rob')).toBe(true);
    // The lw's address-computing `alu-op` issues to the LSU, and does NOT put a result on the bus.
    const addrCycle = traces.find((t) =>
      t.events.some(
        (e) =>
          e.type === 'alu-op' &&
          t.instructions.some((i) => i.id === e.instr && i.decoded.mnemonic === 'lw'),
      ),
    );
    expect(addrCycle, 'no lw address computed').toBeDefined();
    const b = activate(addrCycle!);
    expect(b.wires.has('rs-lsu')).toBe(true);
  });

  it('a load `mem-read` returns its datum and broadcasts it on the CDB', () => {
    const read = record(REDUCE, BET).find((t) => t.events.some((e) => e.type === 'mem-read'));
    expect(read, 'no load completed').toBeDefined();
    const ev = read!.events.find((e) => e.type === 'mem-read')!;
    const a = activate(read!);
    expect(a.wires.get('lsu-dmem')?.instr).toBe(ev.type === 'mem-read' ? ev.instr : '');
    expect(a.wires.has('dmem-lsu')).toBe(true);
    expect(a.wires.get('lsu-cdb')?.instr).toBe(ev.type === 'mem-read' ? ev.instr : '');
    expect(a.wires.has('cdb-rob')).toBe(true);
  });

  it('the ROB head commits into the register file, labelled with the written value', () => {
    const traces = record(REDUCE, BET);
    const commit = traces.find((t) =>
      t.events.some((e) => e.type === 'instr-retire' && traces.length > 0),
    );
    expect(commit).toBeDefined();
    // A cycle that both retires and reg-writes: the commit wire carries that value.
    const withVal = traces.find(
      (t) =>
        t.events.some((e) => e.type === 'instr-retire') &&
        t.events.some((e) => e.type === 'reg-write'),
    )!;
    const rw = withVal.events.find((e) => e.type === 'reg-write')!;
    const a = activate(withVal);
    expect(a.components.has('regfile')).toBe(true);
    expect(a.wires.has('rob-regfile')).toBe(true);
    expect(a.wires.get('rob-regfile')?.value).toBe(rw.type === 'reg-write' ? rw.value : -1);
  });

  it('a misprediction redirects the pc from the ROB (recovery); a bet redirects from rename', () => {
    // A taken loop under static-taken bets every pass; the FINAL bet is wrong → a recovery redirect.
    const traces = record('  addi x1, x0, 2\nloop:\n  addi x1, x1, -1\n  bnez x1, loop', BET);
    const bet = traces.find((t) => t.events.some((e) => e.type === 'branch-predicted'));
    expect(bet, 'the loop never bet').toBeDefined();
    const betEv = bet!.events.find((e) => e.type === 'branch-predicted')!;
    expect(activate(bet!).wires.get('rename-pc')?.value).toBe(
      betEv.type === 'branch-predicted' ? betEv.target : -1,
    );
    const mispredict = traces.find((t) =>
      t.events.some((e) => e.type === 'branch-resolved' && e.predicted !== e.actual),
    );
    expect(mispredict, 'no misprediction to recover from').toBeDefined();
    expect(activate(mispredict!).wires.has('rob-pc')).toBe(true);
  });

  it('coherence: every lit wire is a real wire with both endpoints lit, over a spread of programs', () => {
    const byId = new Map(WIRES.map((w) => [w.id, w]));
    const programs = [
      REDUCE,
      '  lw x5, 256(x0)',
      '  addi x5, x0, 256\n  sw x5, 8(x5)',
      '  addi x1, x0, 7\n  add x2, x1, x1',
      '  lui x5, 0x12345',
      '  jal x1, fn\nfn:\n  jalr x0, 0(x1)',
      '  addi x1, x0, 3\nloop:\n  addi x1, x1, -1\n  bnez x1, loop',
    ];
    for (const cfg of CONFIGS) {
      for (const src of programs) {
        for (const trace of record(src, cfg)) {
          const a = activate(trace);
          for (const id of a.wires.keys()) {
            const wire = byId.get(id);
            expect(wire, `activated unknown wire "${id}" for \`${src}\``).toBeDefined();
            expect(wire!.skeleton ?? false, `${id} is skeleton but was lit`).toBe(false);
            for (const end of wire!.ends) {
              const msg = `wire ${id} lit but endpoint ${end} is dim for \`${src}\` ${label(cfg)}`;
              expect(a.components.has(end), msg).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe('the follow-ring rides the wires the followed instruction lights (INV-4, composes with the tables)', () => {
  it('rings the producer’s CDB wire while it broadcasts its result', () => {
    const traces = record(REDUCE, BET);
    // A load's mem-read is a clean, single-producer CDB cycle.
    const read = traces.find((t) => t.events.some((e) => e.type === 'mem-read'))!;
    const producer = read.events.find((e) => e.type === 'mem-read')!;
    const id = producer.type === 'mem-read' ? producer.instr : '';
    const a = activate(read);
    // The wrapper rings a wire iff its activation's instr === followed; assert the raw attribution.
    expect(a.wires.get('lsu-cdb')?.instr).toBe(id);
    expect(a.wires.get('cdb-rob')?.instr).toBe(id);
    // A different id is NOT attributed these wires, so following it would ring nothing here.
    expect(a.wires.get('lsu-cdb')?.instr).not.toBe(`${id}-not-a-real-id`);
  });
});

describe('depth tiers × config — representation only (no structural tiering)', () => {
  const visibleNodes = (t: DepthTier, f: DatapathConfig): Set<string> =>
    new Set([...NODES.values()].filter((n) => nodeVisibleAt(n, t, f)).map((n) => n.id));
  const visibleWires = (t: DepthTier, f: DatapathConfig): Set<string> =>
    new Set(WIRES.filter((w) => wireVisibleAt(w, t, f)).map((w) => w.id));

  it('every unit is drawn at every tier and config — the OoO structure is all essential', () => {
    for (const tier of DEPTH_TIERS)
      for (const cfg of CONFIGS)
        for (const n of NODES.keys())
          expect(visibleNodes(tier, cfg).has(n), `${n}@${tier} ${label(cfg)}`).toBe(true);
  });

  it('the bet redirect is ABSENT unless the machine bets — the one config gate', () => {
    for (const tier of DEPTH_TIERS) {
      expect(visibleWires(tier, BET).has('rename-pc'), `bet@${tier}`).toBe(true);
      expect(visibleWires(tier, NOBET).has('rename-pc'), `no-bet@${tier}`).toBe(false);
    }
    // The ROB-based recovery redirect is NOT gated — every machine can mispredict a taken branch.
    for (const cfg of CONFIGS)
      for (const tier of DEPTH_TIERS) expect(visibleWires(tier, cfg).has('rob-pc')).toBe(true);
  });

  it('the depth dial adds value labels only (essentials bare, detailed+ labelled — lawful, INV-5)', () => {
    expect(DEPTH_TIERS.map(showValueLabels)).toEqual([false, true, true]);
  });
});

describe('geometry: the automatable slice of visual acceptance', () => {
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

  it('the structural spine reads left-to-right: PC → fetch → rename → {ROB, RS} → {FU, LSU} → bus', () => {
    const x = (id: string): number => NODES.get(id)!.x;
    expect(x('pc')).toBeLessThan(x('imem'));
    expect(x('imem')).toBeLessThan(x('rename'));
    expect(x('rename')).toBeLessThan(x('rob'));
    expect(x('rename')).toBeLessThan(x('rs'));
    expect(x('rs')).toBeLessThan(x('alu'));
    expect(x('rs')).toBeLessThan(x('lsu'));
    expect(x('alu')).toBeLessThan(x('regfile') + 1); // FU pool and registers share the right band
    expect(x('lsu')).toBeLessThan(x('dmem'));
    // The ROB sits above the RS (commit spine on top, waiting stations in the middle).
    expect(NODES.get('rob')!.y).toBeLessThan(NODES.get('rs')!.y);
    // The CDB is the lowest element — the return bus along the bottom.
    const bottom = (id: string): number => NODES.get(id)!.y;
    for (const n of nodes) if (n.id !== 'cdb') expect(bottom('cdb')).toBeGreaterThan(n.y);
  });

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
