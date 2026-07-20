/**
 * **M7 step 7 — the widened datapath.** The standing litmuses (coherence, contraction lawfulness,
 * no-dangling-wires, orthogonality, on-perimeter anchoring, no collinear overlap) are ported from
 * `datapath-pipeline.test.ts` and now sweep a THREE-axis config space: tier × forwarding ×
 * prediction × **issue width**.
 *
 * What is genuinely new, and what this file is really for:
 *
 *  - **"One lane lit, one dark" is the tier's money shot**, so it is asserted off a REAL refused
 *    cycle rather than described. `sum-loop.s` pairs cleanly and never shows one — the programs
 *    below were written to provoke each of the three refusal verdicts, and every expected slot in
 *    this file was DUMPED AND READ before it was written down. That is house policy earned the hard
 *    way three times over in this milestone (steps 2b(e), 4(e) and 5(b) each caught a test that
 *    passed while demonstrating the opposite of its name), and the reason is structural: sliding
 *    issue means **a slot is not a stable lane**, so any claim naming a slot must have been watched.
 *  - **The width axis is proven lawful, not asserted.** Hiding lane 1 and the issue unit at width 1
 *    is only honest if the trace genuinely cannot light them there, so that is tested directly over
 *    the whole corpus rather than argued in a comment.
 *  - **Replication is proven necessary.** Three units looked shared and are not (`pcarith`, the
 *    MEM→WB bypass, the fetch path); each has a test that fails if they were drawn once.
 */

import { DEPTH_TIERS, type DepthTier } from '@cpu-viz/curriculum';
import { SuperscalarProcessor } from '@cpu-viz/engine-superscalar';
import { defaultConfig, type CycleTrace } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import {
  activate,
  CANVAS,
  LANES,
  laneId,
  NODES,
  nodeVisibleAt,
  PAIRING_REASONS,
  parseLocation,
  showControlLabels,
  showValueLabels,
  STAGES,
  tierVisible,
  WIRES,
  wireVisibleAt,
  type DatapathConfig,
} from './datapath-superscalar';
import { shapePolygon } from './DatapathDiagram';
import { EXAMPLE_PROGRAMS } from './programs';
import { loadSource } from './simulator';

/** True when `pt` lies (within `eps`) on any edge of node `id`'s drawn outline — hit-tested against
 *  {@link shapePolygon}, the real perimeter, because a bounding-box check would pass points sitting
 *  in a mux/adder's slanted-corner blank space. */
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
 * The EIGHT MACHINES this diagram can be asked to draw — M3's four, doubled by the width axis.
 * Width belongs here for the same reason forwarding does: it decides what hardware EXISTS, not how
 * much detail is shown, so every structural litmus has to hold in both positions independently.
 */
const CONFIGS: readonly DatapathConfig[] = [1, 2].flatMap((issueWidth) => [
  { forwarding: false, predictTaken: false, issueWidth },
  { forwarding: true, predictTaken: false, issueWidth },
  { forwarding: false, predictTaken: true, issueWidth },
  { forwarding: true, predictTaken: true, issueWidth },
]);
const label = (c: DatapathConfig): string =>
  `${c.issueWidth}-wide / forwarding ${c.forwarding ? 'on' : 'off'} / predict ${c.predictTaken ? 'taken' : 'not-taken'}`; // prettier-ignore

/** The positions individual tests name directly, when the subject is one axis at a time. */
const W2: DatapathConfig = { forwarding: true, predictTaken: false, issueWidth: 2 };
const W1: DatapathConfig = { forwarding: true, predictTaken: false, issueWidth: 1 };
const W2_NOFWD: DatapathConfig = { forwarding: false, predictTaken: false, issueWidth: 2 };
const W2_BET: DatapathConfig = { forwarding: true, predictTaken: true, issueWidth: 2 };

/** Record a whole run under one machine and return every cycle's trace. Litmus programs for the
 *  VIEW are written inline, exactly as the multi-cycle and pipeline datapath suites do — INV-7
 *  governs the example library the user runs, not a test's two-line probe. */
function record(source: string, cfg: DatapathConfig, appendExit = true): CycleTrace[] {
  const result = loadSource(
    appendExit ? `${source}\n  li a7, 10\n  ecall\n` : source,
    () => new SuperscalarProcessor(),
    {
      ...defaultConfig(),
      forwarding: cfg.forwarding,
      branchPrediction: cfg.predictTaken ? 'static-taken' : 'static-not-taken',
      issueWidth: cfg.issueWidth,
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
    if (t.state.halted || traces.length > 600) break;
  }
  return traces;
}

/** The `location → instruction id` map the trace itself reports (the oracle `activate`'s
 *  `occupancy` must equal — computed here directly, independently of the module under test). */
function locationsOf(trace: CycleTrace): Map<string, string> {
  const m = new Map<string, string>();
  for (const inst of trace.instructions) m.set(inst.location, inst.id);
  return m;
}

/** The first cycle whose events include a `stall` with one of the three PAIRING reasons. */
function firstRefusal(traces: readonly CycleTrace[]): CycleTrace {
  const t = traces.find((c) =>
    c.events.some((e) => e.type === 'stall' && PAIRING_REASONS.has(e.reason)),
  );
  if (!t) throw new Error('no pairing refusal in this run — the program did not provoke one');
  return t;
}

// The three refusal provokers. Each was run and its trace read before anything below was asserted.
const MEM_PORT = `  addi x1, x0, 256
  addi x2, x0, 7
  sw x2, 0(x1)
  sw x2, 4(x1)`;
const INTRA_PAIR_RAW = `  addi x1, x0, 5
  addi x2, x1, 6
  add x3, x1, x2
  addi x4, x0, 1`;
const BRANCH_SLOT = `  addi x1, x0, 1
  addi x2, x0, 2
  beq x0, x0, one
one:
  beq x0, x0, two
two:
  addi x3, x0, 3`;

// =================================================================================================
// Activation is MULTI-INSTRUCTION *and* MULTI-LANE — the break from M3
// =================================================================================================

describe('activation is multi-LANE (the break from the 5-stage pipeline)', () => {
  it('lights TWO instructions in the same stage in the same cycle', () => {
    const traces = record(`  addi x1, x0, 1\n  addi x2, x0, 2\n  addi x3, x0, 3`, W2);
    // Observed, not assumed: cycle 2 of this run holds EX.0=i0 and EX.1=i1 (dumped first).
    const paired = traces.find(
      (t) => t.instructions.some((i) => i.location === 'EX.0') && t.instructions.some((i) => i.location === 'EX.1'), // prettier-ignore
    );
    expect(paired, 'no cycle paired two instructions in EX').toBeDefined();
    const act = activate(paired!);
    // Both lanes' ALUs are on the active path — the picture the whole tier exists for.
    expect(act.components.has(laneId('alu', 0))).toBe(true);
    expect(act.components.has(laneId('alu', 1))).toBe(true);
    // ...and each lane's wires name a DIFFERENT instruction, in the same stage.
    const a0 = act.wires.get(laneId('alu-exmem', 0))!;
    const a1 = act.wires.get(laneId('alu-exmem', 1))!;
    expect(a0.stage).toBe('EX');
    expect(a1.stage).toBe('EX');
    expect(a0.slot).toBe(0);
    expect(a1.slot).toBe(1);
    expect(a0.instr).not.toBe(a1.instr);
  });

  it('occupancy is keyed by "<stage>.<slot>" and matches the trace exactly', () => {
    for (const t of record(`  addi x1, x0, 1\n  addi x2, x0, 2\n  add x3, x1, x2`, W2)) {
      expect(new Map(activate(t).occupancy)).toEqual(locationsOf(t));
    }
  });

  it('reads occupancy from `instructions[].location`, never from the one-cycle-ahead `micro`', () => {
    // The M3 trap, inherited and still silent if got wrong: `state.micro` at cycle i is the
    // END-of-cycle latch state (what the latches present to cycle i+1), so a datapath sourced from
    // it draws the pipe one cycle ahead of itself. Pinned by construction: every occupant this
    // module reports must be present in THIS cycle's `instructions[]`.
    for (const t of record(`  addi x1, x0, 1\n  lw x2, 0(x1)\n  add x3, x1, x2`, W2)) {
      const live = new Set(t.instructions.map((i) => i.id));
      for (const id of activate(t).occupancy.values()) expect(live.has(id)).toBe(true);
    }
  });

  it('is empty for the pre-run state (no in-flight instruction)', () => {
    expect(activate(null).components.size).toBe(0);
    expect(activate(null).occupancy.size).toBe(0);
    expect(activate(null).refusal).toBeNull();
  });

  it('a slot is NOT a stable lane — the datapath draws the seat, and follow keys on the id', () => {
    // The milestone's headline finding (step 5), cashed at the view layer. An instruction refused
    // for `intra-pair-raw` in slot 1 SLIDES to slot 0 and finishes there. The datapath must not
    // care: lane N draws whoever sits in slot N right now, and identity is the follow ring's job.
    const traces = record(INTRA_PAIR_RAW, W2);
    const seats = new Map<string, Set<number>>();
    for (const t of traces) {
      for (const [loc, id] of activate(t).occupancy) {
        const slot = parseLocation(loc)!.slot;
        (seats.get(id) ?? seats.set(id, new Set()).get(id)!).add(slot);
      }
    }
    const slider = [...seats.values()].some((s) => s.size > 1);
    expect(slider, 'no instruction changed slot — this program no longer provokes a slide').toBe(true); // prettier-ignore
  });
});

// =================================================================================================
// The money shot: one lane lit, one dark — asserted off REAL refused cycles
// =================================================================================================

describe('the pairing-failure picture — one lane lit, one dark', () => {
  const cases: readonly [string, string, string][] = [
    ['mem-port', MEM_PORT, 'two memory ops, one data-memory port'],
    ['intra-pair-raw', INTRA_PAIR_RAW, 'the second reads what the first writes'],
    ['branch-slot', BRANCH_SLOT, 'two control transfers, one branch unit'],
  ];

  for (const [reason, source, why] of cases) {
    it(`${reason}: the refused cycle lights lane 0 and leaves lane 1 DARK (${why})`, () => {
      const traces = record(source, W2);
      const refusedCycle = firstRefusal(traces);
      const stall = refusedCycle.events.find((e) => e.type === 'stall')!;
      expect(stall.type === 'stall' && stall.reason).toBe(reason);

      // The refusal is reported to the view (step 8's readout reads exactly this).
      const act = activate(refusedCycle);
      expect(act.refusal).toEqual({ reason, instr: stall.type === 'stall' ? stall.instr : '' });
      // ...and the ISSUE unit is the drawn cause. The hazard unit is NOT lit: these two are told
      // apart only by the stall's reason, so a reason leaking from one set to the other would light
      // the wrong box with everything else still green.
      expect(act.components.has('issue'), 'the issue unit is the drawn cause').toBe(true);
      expect(act.components.has('hazard'), 'a pairing refusal is not a hazard').toBe(false);

      // THE PICTURE. The cycle AFTER the refusal is the single-issue one: the refused instruction
      // went alone. Verified by reading the trace, not by reasoning about which cycle it lands on.
      const solo = traces.find(
        (t) =>
          t.instructions.some((i) => i.location === 'EX.0') &&
          !t.instructions.some((i) => i.location === 'EX.1'),
      );
      expect(solo, 'no single-issue EX cycle — the refusal did not narrow the machine').toBeDefined(); // prettier-ignore
      const soloAct = activate(solo!);
      expect(soloAct.components.has(laneId('alu', 0)), 'lane 0 works').toBe(true);
      expect(soloAct.components.has(laneId('alu', 1)), 'lane 1 is dark').toBe(false);
      // "One lane dark" is a claim about the EXECUTE band, not about the whole diagram — and that
      // distinction is a finding, not a technicality. The first draft of this test asserted no
      // lane-1 wire anywhere was lit and FAILED, because a machine that refused a pair in ID is
      // still happily fetching two instructions into `IF.0`/`IF.1` behind it. That is the machine
      // working: the refusal narrows the ISSUE point, and the front-end keeps running wide. An
      // assertion over the whole diagram would have demanded a picture the engine never draws.
      for (const [id, a] of soloAct.wires) {
        if (a.stage === 'EX') expect(a.slot, `EX lane 1 lit via ${id} on a solo cycle`).toBe(0);
      }
    });
  }

  it('an ORDINARY hazard lights the hazard unit and NOT the issue unit', () => {
    // The mirror of the above, and the reason the two boxes are separate. A load-use bubble is not
    // a pairing failure: it is a question about an older stage, and it exists at width 1 too.
    const traces = record(`  addi x1, x0, 64\n  lw x2, 0(x1)\n  add x3, x2, x2`, W2);
    const hazardCycle = traces.find((t) =>
      t.events.some((e) => e.type === 'stall' && e.reason === 'load-use'),
    );
    expect(hazardCycle, 'no load-use stall provoked').toBeDefined();
    const act = activate(hazardCycle!);
    expect(act.components.has('hazard')).toBe(true);
    expect(act.components.has('issue')).toBe(false);
    expect(act.refusal).toBeNull();
  });

  it('at most ONE stall fires per cycle — a refusal ends the issue group', () => {
    // `activate` reads a SINGLE stall per cycle rather than one per lane. That is only correct
    // because `stageId` breaks out of the group on a refusal (M7 step 4 finding (d): the `break` is
    // the load-bearing part). Pinned here rather than assumed, across every provoker and the corpus.
    const sources = [MEM_PORT, INTRA_PAIR_RAW, BRANCH_SLOT];
    for (const src of sources) {
      for (const cfg of [W2, W2_NOFWD, W2_BET]) {
        for (const t of record(src, cfg)) {
          const stalls = t.events.filter((e) => e.type === 'stall');
          expect(stalls.length, `${stalls.length} stalls in one cycle`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

// =================================================================================================
// The width axis — the third visibility axis, and its lawfulness
// =================================================================================================

describe('issue width is a structural axis (INV-5: absent, never idle)', () => {
  it('lane 1 and the issue unit are ABSENT at width 1, and present at width 2', () => {
    const lane1 = [...NODES.values()].filter((n) => n.lane === 1);
    expect(lane1.length, 'lane 1 has replicated hardware').toBeGreaterThan(4);
    for (const n of lane1) {
      expect(nodeVisibleAt(n, 'expert', W1), `${n.id} drawn at width 1`).toBe(false);
      expect(nodeVisibleAt(n, 'expert', W2), `${n.id} missing at width 2`).toBe(true);
    }
    expect(nodeVisibleAt(NODES.get('issue')!, 'expert', W1)).toBe(false);
    expect(nodeVisibleAt(NODES.get('issue')!, 'essentials', W2)).toBe(true);
  });

  it('the SHARED spine is width-independent — a superscalar grows lanes, not register files', () => {
    // The other half of the claim, and the one that would be easy to over-apply: widening must not
    // quietly duplicate the register file, the data memory or a latch bar.
    for (const id of ['pc', 'imem', 'regfile', 'dmem', 'ifid', 'idex', 'exmem', 'memwb', 'pcmux']) {
      const n = NODES.get(id)!;
      expect(n.lane, `${id} is shared`).toBeUndefined();
      expect(nodeVisibleAt(n, 'essentials', W1), `${id} missing at width 1`).toBe(true);
    }
    // Exactly one data memory and one register file exist, at either width — the mem-port rule
    // is what buys that, and drawing a second would draw hardware the pairing rules forbid.
    const ids = [...NODES.keys()];
    expect(ids.filter((i) => i.startsWith('dmem'))).toEqual(['dmem']);
    expect(ids.filter((i) => i.startsWith('regfile'))).toEqual(['regfile']);
  });

  it('LAWFULNESS: a width-1 trace can never light lane 1 or the issue unit — over the CORPUS', () => {
    // This is the test that earns the right to HIDE them, and it is deliberately run against the
    // real example library rather than a probe. Hiding structure is lawful only when the trace
    // genuinely has nothing to put there (the same rule that lets forwarding-off hide the
    // forwarding network); if a single corpus program at width 1 emitted a `.1` location or a
    // pairing refusal, the honest fix would be to draw an idle lane, not to keep hiding it.
    for (const { name, source } of EXAMPLE_PROGRAMS) {
      for (const cfg of [W1, { ...W1, forwarding: false }, { ...W1, predictTaken: true }]) {
        for (const t of record(source, cfg, false)) {
          for (const inst of t.instructions) {
            expect(parseLocation(inst.location)?.slot, `${name}: ${inst.location} at width 1`).toBe(0); // prettier-ignore
          }
          for (const e of t.events) {
            if (e.type === 'stall')
              expect(PAIRING_REASONS.has(e.reason), `${name}: pairing refusal at width 1`).toBe(false); // prettier-ignore
          }
          const act = activate(t);
          expect(act.refusal, `${name}: refusal reported at width 1`).toBeNull();
          for (const id of act.wires.keys())
            expect(id.endsWith('-l1'), `${name}: ${id} lit at width 1`).toBe(false);
        }
      }
    }
  });

  it('activation is WIDTH-oblivious (INV-2) — it lights lane 1 whenever the trace has one', () => {
    // The engine emits full expert state and the view filters; `activate` itself has no width
    // parameter and no special case. The proof is that the same function, on a width-2 trace,
    // lights lane-1 wires it would never see at width 1.
    const traces = record(`  addi x1, x0, 1\n  addi x2, x0, 2\n  addi x3, x0, 3`, W2);
    const lit = new Set<string>();
    for (const t of traces) for (const id of activate(t).wires.keys()) lit.add(id);
    expect([...lit].some((id) => id.endsWith('-l1'))).toBe(true);
  });
});

// =================================================================================================
// Replication that LOOKED shared — each one settled by dumping a real trace
// =================================================================================================

describe('what genuinely replicates (dumped, not reasoned)', () => {
  it('`pcarith` replicates: two `lui`s pair, and neither emits an `alu-op`', () => {
    // U/J producers get their writeback value from the dedicated pc/immediate adder, and nothing in
    // the pairing rules forbids two of them going together — so one shared adder could not draw the
    // cycle. This is the test that fails if `pcarith` were drawn once.
    const traces = record(`  lui x1, 1\n  lui x2, 2\n  auipc x3, 3`, W2);
    const both = traces.find((t) => {
      const a = activate(t);
      return a.components.has(laneId('pcarith', 0)) && a.components.has(laneId('pcarith', 1));
    });
    expect(both, 'no cycle needed both pc/immediate adders').toBeDefined();
    const act = activate(both!);
    expect(act.wires.get(laneId('idex-pcarith-pc', 0))!.instr).not.toBe(
      act.wires.get(laneId('idex-pcarith-pc', 1))!.instr,
    );
  });

  it('the MEM→WB bypass replicates: two non-memory instructions ride past the memory together', () => {
    const traces = record(`  addi x1, x0, 1\n  addi x2, x0, 2\n  addi x3, x0, 3\n  addi x4, x0, 4`, W2); // prettier-ignore
    const both = traces.find((t) => {
      const a = activate(t);
      return a.wires.has(laneId('exmem-memwb', 0)) && a.wires.has(laneId('exmem-memwb', 1));
    });
    expect(both, 'no cycle bypassed the data memory in both slots').toBeDefined();
    const act = activate(both!);
    expect(act.wires.get(laneId('exmem-memwb', 0))!.instr).not.toBe(
      act.wires.get(laneId('exmem-memwb', 1))!.instr,
    );
  });

  it('fetch replicates: one memory, one address, a PAIR of words out', () => {
    const traces = record(`  addi x1, x0, 1\n  addi x2, x0, 2\n  addi x3, x0, 3`, W2);
    const pair = traces.find((t) => {
      const a = activate(t);
      return a.wires.has(laneId('imem-ifid', 0)) && a.wires.has(laneId('imem-ifid', 1));
    });
    expect(pair, 'no cycle fetched a pair').toBeDefined();
    const act = activate(pair!);
    const w0 = act.wires.get(laneId('imem-ifid', 0))!;
    const w1 = act.wires.get(laneId('imem-ifid', 1))!;
    expect(w0.instr).not.toBe(w1.instr);
    // ...but ONE address wire and ONE adder: the pair comes from `pc` and `pc + 4`.
    expect(act.wires.get('pc-imem')!.value).toBe(
      pair!.instructions.find((i) => i.location === 'IF.0')!.pc,
    );
    // The adder advances by 4 PER INSTRUCTION FETCHED, so on a paired cycle it reaches pc + 8 —
    // which is why it is drawn as `+4n` and its label comes from the trace rather than a constant.
    const base = pair!.instructions.find((i) => i.location === 'IF.0')!.pc;
    expect(act.wires.get('addn-pcmux')!.value).toBe(base + 8);
  });

  it('the fetch adder reads +4 when only ONE slot was free — the case a fixed `+8` gets wrong', () => {
    const found = [MEM_PORT, INTRA_PAIR_RAW, BRANCH_SLOT]
      .flatMap((src) => record(src, W2))
      .find((t) => {
        const a = activate(t);
        return a.wires.has(laneId('imem-ifid', 0)) && !a.wires.has(laneId('imem-ifid', 1));
      });
    expect(found, 'no cycle held a single instruction in IF').toBeDefined();
    const act = activate(found!);
    const base = found!.instructions.find((i) => i.location === 'IF.0')!.pc;
    expect(act.wires.get('addn-pcmux')!.value).toBe(base + 4);
  });

  it('the data memory does NOT replicate — the mem-port rule keeps MEM single-lane', () => {
    // The converse guard. If two memory ops could ever pair, this diagram would be drawing a lie;
    // the rule that forbids it is what lets `dmem` and its wires stay unslotted.
    for (const { source } of EXAMPLE_PROGRAMS) {
      for (const t of record(source, W2, false)) {
        const mem = t.events.filter((e) => e.type === 'mem-read' || e.type === 'mem-write');
        expect(mem.length, 'two memory accesses in one cycle').toBeLessThanOrEqual(1);
      }
    }
  });
});

// =================================================================================================
// Forwarding — a change of path, and a SOURCE the trace does not slot
// =================================================================================================

describe('forwarding at width 2', () => {
  it('a forward lights the latch-BAR path and darkens the register-file path into the same mux', () => {
    const traces = record(`  addi x1, x0, 5\n  addi x2, x0, 6\n  add x3, x1, x2`, W2);
    const fwd = traces.find((t) => t.events.some((e) => e.type === 'forward'));
    expect(fwd, 'no forward provoked').toBeDefined();
    const act = activate(fwd!);
    const ev = fwd!.events.find((e) => e.type === 'forward')!;
    const lane = parseLocation(fwd!.instructions.find((i) => i.id === ev.instr)!.location)!.slot;
    const from = ev.type === 'forward' && ev.from === 'EX/MEM' ? 'exmem' : 'memwb';
    const side = ev.type === 'forward' && ev.to === 'EX.rs1' ? 'a' : 'b';
    expect(act.wires.has(laneId(`${from}-fwdmux${side}`, lane))).toBe(true);
    // The register-file path into that same mux is DARK — forwarding is a change of path.
    expect(act.wires.has(laneId(`idex-fwdmux${side}`, lane))).toBe(false);
  });

  it('the forward SOURCE is the bar, never a slot of it — the trace does not say which', () => {
    // `forward.from` is `'EX/MEM'` / `'MEM/WB'` and carries no slot (M7 pinned event fields BARE).
    // So every forward wire starts at a latch bar, and the geometry has no per-slot forward source.
    // A future edit that "improved" this by slotting the source would be inventing a fact.
    for (const w of WIRES) {
      if (!/^(exmem|memwb)-fwdmux/.test(w.id) && !/^(exmem|memwb)-alu-/.test(w.id)) continue;
      expect(['exmem', 'memwb'], `${w.id} sources a slot`).toContain(w.ends[0]);
    }
  });

  it('each lane forwards for itself — two lanes can forward in the same cycle', () => {
    const traces = record(`  addi x1, x0, 5\n  addi x2, x0, 6\n  add x3, x1, x0\n  add x4, x2, x0`, W2); // prettier-ignore
    const both = traces.find((t) => {
      const a = activate(t);
      return a.components.has(laneId('fwdunit', 0)) && a.components.has(laneId('fwdunit', 1));
    });
    expect(both, 'no cycle used both forwarding units').toBeDefined();
  });
});

// =================================================================================================
// The standing litmuses, over all THREE axes
// =================================================================================================

describe('activation coherence: every lit wire is a real wire with both endpoints lit', () => {
  it('holds at every cycle of a representative spread, in every config', () => {
    const sources = [MEM_PORT, INTRA_PAIR_RAW, BRANCH_SLOT, `  addi x1, x0, 64\n  lw x2, 0(x1)\n  add x3, x2, x2`]; // prettier-ignore
    for (const src of sources) {
      for (const cfg of CONFIGS) {
        for (const t of record(src, cfg)) {
          const act = activate(t);
          for (const [id, a] of act.wires) {
            const wire = WIRES.find((w) => w.id === id);
            expect(wire, `lit wire ${id} is not real geometry`).toBeDefined();
            for (const end of wire!.ends)
              expect(act.components.has(end), `${id} lit into dim ${end}`).toBe(true);
            expect(STAGES).toContain(a.stage);
          }
        }
      }
    }
  });

  it('never lights a wire whose lane the trace does not have', () => {
    // A lane-1 wire lit from a width-1 trace would be a wire the view has already hidden — the
    // classic "lit but not drawn" incoherence, which at width 1 would silently vanish instead.
    for (const t of record(INTRA_PAIR_RAW, W1)) {
      for (const [id, a] of activate(t).wires) {
        const wire = WIRES.find((w) => w.id === id)!;
        expect(wire.lane ?? 0, `${id} is lane ${wire.lane} at width 1`).toBe(0);
        expect(a.slot).toBe(0);
      }
    }
  });
});

describe('depth tiers × forwarding × prediction × WIDTH (INV-5)', () => {
  const visibleNodes = (tier: DepthTier, cfg: DatapathConfig): Set<string> =>
    new Set([...NODES.values()].filter((n) => nodeVisibleAt(n, tier, cfg)).map((n) => n.id));

  it('tierVisible: an element shows once the selected tier reaches its minTier', () => {
    expect(DEPTH_TIERS.map((t) => tierVisible('expert', t))).toEqual([false, false, true]);
    expect(DEPTH_TIERS.map((t) => tierVisible(undefined, t))).toEqual([true, true, true]);
  });

  it('hides the forwarding structure below expert and reveals it there, in BOTH lanes', () => {
    for (const lane of LANES) {
      for (const base of ['fwdunit', 'fwdmuxa', 'fwdmuxb']) {
        const n = NODES.get(laneId(base, lane))!;
        expect(nodeVisibleAt(n, 'detailed', W2), `${n.id} shown below expert`).toBe(false);
        expect(nodeVisibleAt(n, 'expert', W2), `${n.id} hidden at expert`).toBe(true);
      }
    }
  });

  it('the forwarding network is ABSENT when forwarding is off — even at expert, in both lanes', () => {
    for (const lane of LANES) {
      for (const base of ['fwdunit', 'fwdmuxa', 'fwdmuxb']) {
        expect(nodeVisibleAt(NODES.get(laneId(base, lane))!, 'expert', W2_NOFWD)).toBe(false);
      }
    }
  });

  it('the branch-target adder is ABSENT unless the machine bets, and is tier-INDEPENDENT', () => {
    const bt = NODES.get('btarget')!;
    expect(nodeVisibleAt(bt, 'expert', W2)).toBe(false);
    for (const tier of DEPTH_TIERS) expect(nodeVisibleAt(bt, tier, W2_BET)).toBe(true);
  });

  it('the hazard unit is not width- or config-gated — it is live in every position', () => {
    const hz = NODES.get('hazard')!;
    for (const cfg of CONFIGS) expect(nodeVisibleAt(hz, 'expert', cfg)).toBe(true);
  });

  it('swaps contraction wires for through-mux wires, on ALL THREE axes', () => {
    for (const tier of DEPTH_TIERS) {
      for (const cfg of CONFIGS) {
        for (const w of WIRES) {
          if (!w.contracts) continue;
          const unit = NODES.get(w.contracts)!;
          const unitShown = nodeVisibleAt(unit, tier, cfg);
          const wireShown = wireVisibleAt(w, tier, cfg);
          // The contraction and its unit are mutually exclusive whenever the contraction is
          // otherwise eligible — that exclusivity is what lets them share a routing rail.
          if (unitShown) expect(wireShown, `${w.id} co-visible with ${unit.id}`).toBe(false);
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
            expect(nodes.has(end), `wire ${wire.id} shown at ${tier} ${label(cfg)} but ${end} hidden`).toBe(true); // prettier-ignore
          }
        }
      }
    }
  });

  it('each contraction is LAWFUL: it collapses exactly its unit (same source, same sink)', () => {
    // The INV-5 correctness condition: a contraction `S → T` bypassing unit M must equal the expert
    // path `S → M → T`. A contraction routing somewhere the expert path does not would be a lower
    // tier CONTRADICTING a higher one. Now doubled — it must hold per lane, independently.
    const touches = (w: (typeof WIRES)[number], node: string): boolean => w.ends.includes(node);
    let checked = 0;
    for (const w of WIRES) {
      if (!w.contracts) continue;
      checked++;
      const unit = w.contracts;
      const [src, sink] = w.ends;
      const inLeg = WIRES.some((t) => t.id !== w.id && touches(t, src) && touches(t, unit));
      const outLeg = WIRES.some((t) => t.id !== w.id && touches(t, unit) && touches(t, sink));
      expect(inLeg, `${w.id}: no through-wire ${src}→${unit}`).toBe(true);
      expect(outLeg, `${w.id}: no through-wire ${unit}→${sink}`).toBe(true);
    }
    // Both lanes' worth — a lane whose contractions were never authored would pass vacuously.
    expect(checked, 'contraction count').toBeGreaterThanOrEqual(14);
    for (const lane of LANES)
      expect(WIRES.some((w) => w.contracts && w.lane === lane), `lane ${lane} contractions`).toBe(true); // prettier-ignore
  });

  it('adds representational detail as the tier climbs (labels only add — lawful, INV-5)', () => {
    expect(DEPTH_TIERS.map(showValueLabels)).toEqual([false, true, true]);
    expect(DEPTH_TIERS.map(showControlLabels)).toEqual([false, false, true]);
  });
});

// =================================================================================================
// Geometry — the automatable slice of visual acceptance
// =================================================================================================

describe('geometry: node boxes are sane', () => {
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
    const bars = ['ifid', 'idex', 'exmem', 'memwb'].map((id) => NODES.get(id)!);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i - 1]!.x, `${bars[i - 1]!.id} left of ${bars[i]!.id}`).toBeLessThan(bars[i]!.x);
    }
    for (const b of bars) expect(b.h, `${b.id} spans the diagram`).toBeGreaterThan(300);
    const between = (id: string, l: string, r: string): void => {
      const n = NODES.get(id)!;
      expect(n.x, `${id} right of ${l}`).toBeGreaterThan(NODES.get(l)!.x);
      expect(n.x, `${id} left of ${r}`).toBeLessThan(NODES.get(r)!.x);
    };
    between('imem', 'pc', 'ifid');
    between('regfile', 'ifid', 'idex');
    between('dmem', 'exmem', 'memwb');
    for (const lane of LANES) {
      between(laneId('alu', lane), 'idex', 'exmem');
      expect(NODES.get(laneId('wbmux', lane))!.x).toBeGreaterThan(NODES.get('memwb')!.x);
    }
  });

  it('the two lanes are a translation of each other — symmetry is structural, not eyeballed', () => {
    // Lane 1 is lane 0 moved straight down in the EX/WB bands. Asserting it here is what keeps a
    // later hand-tweak to one lane from silently making the picture asymmetric.
    for (const base of ['fwdunit', 'fwdmuxa', 'fwdmuxb', 'alu', 'pcarith', 'wbmux']) {
      const a = NODES.get(laneId(base, 0))!;
      const b = NODES.get(laneId(base, 1))!;
      expect(b.x, `${base} x differs between lanes`).toBe(a.x);
      expect(b.w).toBe(a.w);
      expect(b.h).toBe(a.h);
      expect(b.y - a.y, `${base} lane pitch`).toBe(NODES.get(laneId('alu', 1))!.y - NODES.get(laneId('alu', 0))!.y); // prettier-ignore
    }
  });

  it('every lane-tinted node carries its lane in its TEXT label (the relief rule)', () => {
    // Light magenta is 2.62:1 against the surface, so a lane hue may never be the sole carrier. A
    // mux has no room for text and carries its lane in its `expert` control label instead — which
    // is checked here rather than trusted, since a mux with neither would be hue-only.
    for (const n of NODES.values()) {
      if (n.lane === undefined) continue;
      const carrier = n.label || n.controlLabel || '';
      expect(carrier, `${n.id} has no text carrier for its lane hue`).not.toBe('');
      expect(carrier.includes(String(n.lane)), `${n.id} label omits its lane`).toBe(true);
    }
  });
});

describe('geometry: wires are orthogonal and anchored on real edges', () => {
  it('every wire segment is axis-aligned (no diagonals)', () => {
    const eps = 0.01;
    for (const wire of WIRES) {
      for (let i = 1; i < wire.points.length; i++) {
        const [ax, ay] = wire.points[i - 1]!;
        const [bx, by] = wire.points[i]!;
        const axisAligned = Math.abs(ax - bx) < eps || Math.abs(ay - by) < eps;
        expect.soft(axisAligned, `${wire.id} seg ${i} diagonal (${ax},${ay})→(${bx},${by})`).toBe(true); // prettier-ignore
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
    // A collinear overlap is a permanent "two lines as one", invisible to the eye. Bucketed by all
    // THREE axes: a contraction and its through-mux wire are intentionally collinear (they share a
    // routing rail on purpose) but never co-visible, and neither are lane 1's wires at width 1.
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
            expect.soft(worst, `${wi.id} overlaps ${wj.id} at ${tier} ${label(cfg)} for ${worst.toFixed(0)}px`).toBeLessThan(2); // prettier-ignore
          }
        }
      }
    }
  });
});
