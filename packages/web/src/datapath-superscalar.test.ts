/**
 * **M7 step 7 — the widened datapath. M13 step 7 — the datapath at N lanes.** The standing
 * litmuses (coherence, contraction lawfulness, no-dangling-wires, orthogonality, on-perimeter
 * anchoring, no collinear overlap) sweep a THREE-axis config space: tier × forwarding × prediction
 * × **issue width**, and the width arm now runs to {@link MAX_WIDTH} rather than to two.
 *
 * What this file is really for:
 *
 *  - **"Some lanes lit, some dark" is the tier's money shot**, so it is asserted off a REAL refused
 *    cycle rather than described. Every expected slot here was DUMPED AND READ before it was
 *    written down. That is house policy earned the hard way, and the reason is structural: sliding
 *    issue means **a slot is not a stable lane**, so any claim naming a slot must have been watched.
 *  - **The width axis is proven lawful, not asserted.** Hiding a lane is only honest if the trace
 *    genuinely cannot light it, so that is tested directly over the whole corpus.
 *  - **Replication is proven necessary.** Three units looked shared and are not (`pcarith`, the
 *    MEM→WB bypass, the fetch path); each has a test that fails if they were drawn once.
 *
 * ## Two things M13 changed about how the litmuses are ASKED, and both are the point
 *
 * **1. The geometry became a function of the width, so a litmus over one drawing became a litmus
 * over four.** A structural check now runs over `geometryFor(w).wires` — the drawing that is
 * actually rendered at width `w` — rather than over the full lane universe filtered by `w`. Those
 * two are NOT the same picture, and believing they were is how the first draft of this file passed
 * while checking a drawing no reader ever sees: at width 4 lanes 0 and 1 both forward on the top
 * side, but at width 2 lane 1 forwards on the bottom, so filtering the width-4 drawing down to two
 * lanes yields a machine `geometryFor(2)` never builds.
 *
 * **2. The claims about what is HIDDEN had to move, or they would have evaporated.** "Lane 1 is
 * absent at width 1" used to be `NODES.filter(lane === 1)` + `nodeVisibleAt(..., W1) === false`.
 * Point that at a per-width geometry and the filter returns EMPTY and the loop body never runs — a
 * green test measuring nothing, which is the shape this milestone has now met six times. So the
 * claim is asked twice, of the two sets that can each falsify one half: of the full universe
 * ({@link NODES}, which contains the lanes it says are hidden) for the VISIBILITY rule, and of
 * `geometryFor(w)` for the STRUCTURAL one.
 */

import { DEPTH_TIERS } from '@cpu-viz/curriculum';
import { MAX_ISSUE_WIDTH, SuperscalarProcessor } from '@cpu-viz/engine-superscalar';
import { defaultConfig, type CycleTrace } from '@cpu-viz/trace';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  activate,
  CANVAS,
  geometryFor,
  LANES,
  laneId,
  HEX_LABEL_W,
  IFID_CORRIDOR,
  MAX_WIDTH,
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
  type DatapathNode,
  type DatapathWire,
} from './datapath-superscalar';
import { DatapathDiagram, shapePolygon } from './DatapathDiagram';
import { hex32 } from './format';
import { EXAMPLE_PROGRAMS } from './programs';
import { loadSource } from './simulator';

/** True when `pt` lies (within `eps`) on any edge of node `id`'s drawn outline — hit-tested against
 *  {@link shapePolygon}, the real perimeter, because a bounding-box check would pass points sitting
 *  in a mux/adder's slanted-corner blank space. */
function onPerimeter(
  nodes: ReadonlyMap<string, DatapathNode>,
  pt: readonly [number, number],
  id: string,
  eps = 0.5,
): boolean {
  const n = nodes.get(id)!;
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
/** How far an axis-aligned segment runs through a node box's INTERIOR (0 if it only touches an
 *  edge or clips a corner). The gap no litmus covered before M13: a wire passing straight through
 *  a box it is not connected to is drawn as a line over a rectangle, and every existing check —
 *  endpoints on the perimeter, no collinear overlap, no dangling — is blind to it. It is also the
 *  exact failure mode of an N-lane rail scheme, where a forwarding return that used to leave the
 *  diagram above the bars now has to get past bars spanning four lanes. */
function throughBox(seg: Seg, n: DatapathNode, eps = 0.5): number {
  const [x0, y0, x1, y1] = seg;
  const [lx, hx] = [n.x + eps, n.x + n.w - eps];
  const [ly, hy] = [n.y + eps, n.y + n.h - eps];
  if (Math.abs(y0 - y1) < eps) {
    if (y0 <= ly || y0 >= hy) return 0;
    return Math.max(0, Math.min(Math.max(x0, x1), hx) - Math.max(Math.min(x0, x1), lx));
  }
  if (Math.abs(x0 - x1) < eps) {
    if (x0 <= lx || x0 >= hx) return 0;
    return Math.max(0, Math.min(Math.max(y0, y1), hy) - Math.max(Math.min(y0, y1), ly));
  }
  return 0;
}

/**
 * The machines this diagram can be asked to draw — M3's four, multiplied by the width axis.
 *
 * `WIDTHS` is DERIVED from the engine's bound, never typed, so raising the guard cannot leave the
 * widest machine the least tested (steps 1/3/4/6's standing precedent in this milestone). Width
 * belongs here for the same reason forwarding does: it decides what hardware EXISTS, not how much
 * detail is shown, so every structural litmus has to hold in every position independently.
 */
const WIDTHS: readonly number[] = Array.from({ length: MAX_WIDTH }, (_, i) => i + 1);
const CONFIGS: readonly DatapathConfig[] = WIDTHS.flatMap((issueWidth) => [
  { forwarding: false, predictTaken: false, issueWidth },
  { forwarding: true, predictTaken: false, issueWidth },
  { forwarding: false, predictTaken: true, issueWidth },
  { forwarding: true, predictTaken: true, issueWidth },
]);
const label = (c: DatapathConfig): string =>
  `${c.issueWidth}-wide / forwarding ${c.forwarding ? 'on' : 'off'} / predict ${c.predictTaken ? 'taken' : 'not-taken'}`; // prettier-ignore

/** The positions individual tests name directly, when the subject is one axis at a time. */
const W1: DatapathConfig = { forwarding: true, predictTaken: false, issueWidth: 1 };
const W2: DatapathConfig = { forwarding: true, predictTaken: false, issueWidth: 2 };
const WMAX: DatapathConfig = { forwarding: true, predictTaken: false, issueWidth: MAX_WIDTH };
const W2_BET: DatapathConfig = { forwarding: true, predictTaken: true, issueWidth: 2 };
/** Every width at which pairing is a question at all — the machine has a second candidate. */
const PAIRING_WIDTHS = WIDTHS.filter((w) => w >= 2);
const atWidth = (w: number): DatapathConfig => ({ ...W1, issueWidth: w });

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

/** The first cycle refusing for `reason`. Selecting BY REASON is a M13 correction, not a
 *  convenience: at widths 3 and 4 the old `MEM_PORT` program refuses for `intra-pair-raw` a cycle
 *  BEFORE it reaches its own subject, because a third slot pulls the address setup into the same
 *  group as the store — so "the first pairing refusal" stopped naming the rule under test. */
function firstRefusal(traces: readonly CycleTrace[], reason: string): CycleTrace {
  const t = traces.find((c) => c.events.some((e) => e.type === 'stall' && e.reason === reason));
  if (!t) throw new Error(`no ${reason} refusal in this run — the program did not provoke one`);
  return t;
}

/** Which EX slots are occupied this cycle. */
function exSlots(trace: CycleTrace): Set<number> {
  const s = new Set<number>();
  for (const inst of trace.instructions) {
    const loc = parseLocation(inst.location);
    if (loc?.stage === 'EX') s.add(loc.slot);
  }
  return s;
}

// The three refusal provokers — REWRITTEN at M13 step 7, and the reason is this milestone's own
// recurring trap rather than a preference. A program provokes a refusal only if the conflicting
// instructions land in ONE issue group, and group boundaries MOVE with the width: the M7 fixtures
// were spaced for pairs, so `BRANCH_SLOT`'s two branches straddled a group boundary at width 3 and
// it emitted NO refusal there at all — while still refusing at 2 and at 4. A fixture is not "still
// valid at the new width", it is a different measurement wearing the same name. These are dense
// enough that the conflict cannot fall between groups at any width, and THAT IS ASSERTED below
// rather than assumed.
const MEM_PORT = `  addi x1, x0, 256
  addi x2, x0, 7
  addi x5, x0, 5
  addi x6, x0, 6
  sw x2, 0(x1)
  sw x2, 4(x1)
  sw x2, 8(x1)
  sw x2, 12(x1)`;
const INTRA_PAIR_RAW = `  addi x1, x0, 5
  addi x2, x1, 6
  add x3, x1, x2
  addi x4, x0, 1`;
const BRANCH_SLOT = `  beq x0, x0, a
a:
  beq x0, x0, b
b:
  beq x0, x0, c
c:
  beq x0, x0, d
d:
  addi x3, x0, 3`;
/** Enough independent work to fill EVERY slot of the widest machine — the fixture the "all lanes
 *  lit" claims need, since only three CORPUS programs ever reach a group of four. */
const WIDE_INDEPENDENT = `  addi x1, x0, 1
  addi x2, x0, 2
  addi x3, x0, 3
  addi x4, x0, 4
  addi x5, x0, 5
  addi x6, x0, 6
  addi x7, x0, 7
  addi x8, x0, 8`;

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

  it('lights EVERY lane of the widest machine at once — dumped, and it needed its own program', () => {
    // The width-4 version of the claim above, and it is a separate test because the width-2 fixture
    // cannot make it: three instructions never fill four slots. The group size is ASSERTED rather
    // than implied, which is this milestone's named trap ("a test that passes at width 4 because
    // nothing ever filled four slots"). Dumped first: `WIDE_INDEPENDENT` fills all four at cycle 3.
    const traces = record(WIDE_INDEPENDENT, WMAX);
    const full = traces.find((t) => exSlots(t).size === MAX_WIDTH);
    expect(full, `no cycle filled all ${MAX_WIDTH} EX slots`).toBeDefined();
    const act = activate(full!);
    const instrs = new Set<string>();
    for (const lane of LANES) {
      expect(act.components.has(laneId('alu', lane)), `lane ${lane} dark on a full cycle`).toBe(true); // prettier-ignore
      instrs.add(act.wires.get(laneId('alu-exmem', lane))!.instr);
    }
    // Four lanes, four DIFFERENT instructions — the thing a shared ALU could not draw.
    expect(instrs.size).toBe(MAX_WIDTH);
  });

  it('occupancy is keyed by "<stage>.<slot>" and matches the trace exactly, at EVERY width', () => {
    // The step-5 hole this step closes, cashed at the layer that had it: `parseLocation` bounded
    // the slot at 2, so an `EX.2` occupant was dropped from occupancy with no crash and no red
    // test. Sweeping the widths is what turns that back into a measurement.
    for (const w of WIDTHS) {
      for (const t of record(WIDE_INDEPENDENT, atWidth(w))) {
        expect(new Map(activate(t).occupancy), `width ${w}`).toEqual(locationsOf(t));
      }
    }
  });

  it('parses every slot the ENGINE can emit, and nothing beyond it', () => {
    for (const stage of STAGES) {
      for (let s = 0; s < MAX_WIDTH; s++)
        expect(parseLocation(`${stage}.${s}`), `${stage}.${s}`).toEqual({ stage, slot: s });
      expect(parseLocation(`${stage}.${MAX_WIDTH}`), `${stage}.${MAX_WIDTH}`).toBeNull();
      expect(parseLocation(stage)).toBeNull();
    }
    // The lane union and the engine's bound are one fact, checked rather than kept in step by hand.
    expect(LANES.length).toBe(MAX_ISSUE_WIDTH);
    expect(MAX_WIDTH).toBe(MAX_ISSUE_WIDTH);
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
    // The milestone's headline finding (M13 step 5), cashed at the view layer. An instruction
    // refused in a younger slot SLIDES and finishes elsewhere. The datapath must not care: lane N
    // draws whoever sits in slot N right now, and identity is the follow ring's job.
    for (const w of PAIRING_WIDTHS) {
      const seats = new Map<string, Set<number>>();
      for (const t of record(INTRA_PAIR_RAW, atWidth(w))) {
        for (const [loc, id] of activate(t).occupancy) {
          const slot = parseLocation(loc)!.slot;
          (seats.get(id) ?? seats.set(id, new Set()).get(id)!).add(slot);
        }
      }
      const slider = [...seats.values()].some((s) => s.size > 1);
      expect(slider, `width ${w}: no instruction changed slot`).toBe(true);
    }
  });
});

// =================================================================================================
// The money shot: some lanes lit, some dark — asserted off REAL refused cycles, at EVERY width
// =================================================================================================

describe('the pairing-failure picture — some lanes lit, some dark', () => {
  const cases: readonly [string, string, string][] = [
    ['mem-port', MEM_PORT, 'two memory ops, one data-memory port'],
    ['intra-pair-raw', INTRA_PAIR_RAW, 'one reads what a group-mate writes'],
    ['branch-slot', BRANCH_SLOT, 'two control transfers, one branch unit'],
  ];

  for (const [reason, source, why] of cases) {
    for (const w of PAIRING_WIDTHS) {
      it(`${reason} @ width ${w}: the refusal narrows the machine (${why})`, () => {
        const cfg = atWidth(w);
        const traces = record(source, cfg);
        const refusedCycle = firstRefusal(traces, reason);

        // The refusal is reported to the view (the pairing readout reads exactly this).
        const act = activate(refusedCycle);
        expect(act.refusal?.reason).toBe(reason);
        // ...and the ISSUE unit is the drawn cause. The hazard unit is NOT lit: these two are told
        // apart only by the stall's reason, so a reason leaking from one set to the other would
        // light the wrong box with everything else still green.
        expect(act.components.has('issue'), 'the issue unit is the drawn cause').toBe(true);
        expect(act.components.has('hazard'), 'a pairing refusal is not a hazard').toBe(false);

        // THE PICTURE, and its width-N spelling. At width 2 "one lane lit, one dark" and "not every
        // lane lit" are the same sentence; past two they are not, and the honest claim is the
        // second — a refusal narrows the ISSUE point by at least one slot, it does not empty the
        // machine down to one lane. Verified by reading the trace, not by reasoning about which
        // cycle it lands on.
        const narrowed = traces.find((t) => {
          const s = exSlots(t);
          return s.size > 0 && s.size < w;
        });
        expect(narrowed, `width ${w}: no narrowed EX cycle — the refusal did not narrow anything`).toBeDefined(); // prettier-ignore
        const act2 = activate(narrowed!);
        const live = exSlots(narrowed!);
        for (const lane of LANES) {
          if (lane >= w) continue;
          expect(act2.components.has(laneId('alu', lane)), `lane ${lane}`).toBe(live.has(lane));
        }
        // "Some lanes dark" is a claim about the EXECUTE band, not about the whole diagram — and
        // that distinction is a finding, not a technicality. The first draft of this test asserted
        // that no wire of an idle lane was lit anywhere and FAILED, because a machine that refused
        // a group in ID is still happily fetching a full group behind it. That is the machine
        // working: the refusal narrows the ISSUE point, and the front end keeps running wide.
        for (const [id, a] of act2.wires) {
          if (a.stage === 'EX')
            expect(live.has(a.slot), `EX lane ${a.slot} lit via ${id} on a narrowed cycle`).toBe(true); // prettier-ignore
        }
      });
    }
  }

  it('each provoker still provokes ITS OWN rule at every width — the fixture health check', () => {
    // The assertion the M7 fixtures would have failed, and the reason they were rewritten. It is a
    // test rather than a comment because "this program provokes X" is a MEASUREMENT whose truth
    // moves with the width, exactly as the corpus's exit-idiom spacer did at step 1.
    for (const [reason, source] of cases) {
      for (const w of PAIRING_WIDTHS) {
        const reasons = new Set(
          record(source, atWidth(w)).flatMap(
            (t) =>
            t.events.filter((e) => e.type === 'stall').map((e) => (e.type === 'stall' ? e.reason : '')), // prettier-ignore
          ),
        );
        expect(reasons.has(reason), `${reason} not provoked at width ${w}`).toBe(true);
      }
    }
  });

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
    // the load-bearing part). Pinned here rather than assumed, across every provoker and width.
    for (const src of [MEM_PORT, INTRA_PAIR_RAW, BRANCH_SLOT]) {
      for (const cfg of CONFIGS) {
        for (const t of record(src, cfg)) {
          const stalls = t.events.filter((e) => e.type === 'stall');
          expect(stalls.length, `${stalls.length} stalls in one cycle at ${label(cfg)}`).toBeLessThanOrEqual(1); // prettier-ignore
        }
      }
    }
  });
});

// =================================================================================================
// The width axis — the third visibility axis, its lawfulness, and (M13) its GEOMETRY
// =================================================================================================

describe('issue width is a structural axis (INV-5: absent, never idle)', () => {
  it('every lane beyond the width is ABSENT, and every lane within it is present', () => {
    // Asked of the FULL universe on purpose: `NODES` contains all four lanes, so the filter finds
    // the nodes whose absence is being claimed. Asked of a per-width geometry this loop would run
    // zero times and pass while measuring nothing.
    for (const w of WIDTHS) {
      const cfg = atWidth(w);
      for (const lane of LANES) {
        const laneNodes = [...NODES.values()].filter((n) => n.lane === lane);
        expect(laneNodes.length, `lane ${lane} has replicated hardware`).toBeGreaterThan(4);
        for (const n of laneNodes)
          expect(nodeVisibleAt(n, 'expert', cfg), `${n.id} at width ${w}`).toBe(lane < w);
      }
      // The issue unit is the one width-gated node that is not a lane's copy: pairing is a
      // question about two candidates, and at width 1 there is never a second one.
      expect(nodeVisibleAt(NODES.get('issue')!, 'expert', cfg)).toBe(w >= 2);
    }
  });

  it('GEOMETRY: `geometryFor(w)` builds exactly the lanes that exist, and nothing beyond', () => {
    // The structural half of the same claim, and the one the visibility rule cannot make: a lane
    // that is only filtered out is still drawn into the canvas budget, and the canvas is what the
    // reader sees. This is what reddens if `buildGeometry` stops filtering.
    for (const w of WIDTHS) {
      const g = geometryFor(w);
      const lanes = new Set(
        [...g.nodes.values()].map((n) => n.lane).filter((l) => l !== undefined),
      );
      expect([...lanes].sort(), `width ${w} lanes`).toEqual(LANES.filter((l) => l < w));
      for (const wire of g.wires)
        expect(wire.lane === undefined || wire.lane < w, `${wire.id} at width ${w}`).toBe(true);
      // ...and the shared spine is width-INDEPENDENT: a superscalar grows lanes, not register files.
      for (const id of ['pc', 'imem', 'regfile', 'dmem', 'ifid', 'idex', 'exmem', 'memwb', 'pcmux'])
        expect(g.nodes.get(id)?.lane, `${id} is shared at width ${w}`).toBeUndefined();
      const ids = [...g.nodes.keys()];
      expect(ids.filter((i) => i.startsWith('dmem'))).toEqual(['dmem']);
      expect(ids.filter((i) => i.startsWith('regfile'))).toEqual(['regfile']);
    }
  });

  it('GEOMETRY: the canvas GROWS with the width — the reason it is not a constant', () => {
    // A single canvas sized for four lanes would draw the width-1 machine as one lane at the top of
    // a box two thirds empty, with latch bars spanning three lanes that do not exist. That is not a
    // rendering nicety: it is the same "draw hardware the machine does not have" the absent-lane
    // rule forbids, one level up. Strict growth is what says the canvas tracks the machine.
    const heights = WIDTHS.map((w) => geometryFor(w).canvas.height);
    for (let i = 1; i < heights.length; i++)
      expect(heights[i]!, `width ${i + 1} is no taller than width ${i}`).toBeGreaterThan(heights[i - 1]!); // prettier-ignore
    // The bars span the lane stack rather than a fixed height, which is what makes them grow too.
    for (const w of WIDTHS) {
      const g = geometryFor(w);
      const bars = ['ifid', 'idex', 'exmem', 'memwb'].map((id) => g.nodes.get(id)!);
      const lowest = Math.max(...[...g.nodes.values()].filter((n) => n.lane !== undefined).map((n) => n.y + n.h)); // prettier-ignore
      for (const b of bars) {
        expect(b.y + b.h, `${b.id} at width ${w} stops above the last lane`).toBeGreaterThan(lowest - 200); // prettier-ignore
        expect(b.y + b.h, `${b.id} at width ${w} runs past the canvas`).toBeLessThan(g.canvas.height); // prettier-ignore
      }
    }
    // The exported universe IS the widest machine — the two must not drift apart.
    expect(CANVAS).toEqual(geometryFor(MAX_WIDTH).canvas);
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

  it('LAWFULNESS generalized: no corpus program at width `w` occupies a slot at or beyond `w`', () => {
    // The N-lane spelling of the same permission. Hiding lane 3 at width 3 is honest for exactly
    // the reason hiding lane 1 at width 1 is, and neither is honest by assertion.
    for (const { name, source } of EXAMPLE_PROGRAMS) {
      for (const w of WIDTHS) {
        for (const t of record(source, atWidth(w), false))
          for (const inst of t.instructions)
            expect(parseLocation(inst.location)!.slot, `${name}: ${inst.location} at width ${w}`).toBeLessThan(w); // prettier-ignore
      }
    }
  });

  it('activation is WIDTH-oblivious (INV-2) — it lights the lanes the TRACE has, not the drawn ones', () => {
    // The engine emits full expert state and the view filters; `activate` itself has no width
    // parameter and no special case. The proof is that the same function lights lane-3 wires on a
    // width-4 trace that it would never see at width 1 — and that it can NAME them, which is the
    // half that was broken until this step: a wire id `activate` cannot look up throws.
    const lit = new Set<string>();
    for (const t of record(WIDE_INDEPENDENT, WMAX)) for (const id of activate(t).wires.keys()) lit.add(id); // prettier-ignore
    for (const lane of LANES)
      expect([...lit].some((id) => id.endsWith(`-l${lane}`)), `nothing lit for lane ${lane}`).toBe(true); // prettier-ignore
  });
});

// =================================================================================================
// Replication that LOOKED shared — each one settled by dumping a real trace
// =================================================================================================

describe('what genuinely replicates (dumped, not reasoned)', () => {
  it('`pcarith` replicates: `lui`s co-issue, and none of them emits an `alu-op`', () => {
    // U/J producers get their writeback value from the dedicated pc/immediate adder, and nothing in
    // the pairing rules forbids several of them going together — so one shared adder could not draw
    // the cycle. This is the test that fails if `pcarith` were drawn once.
    const traces = record(`  lui x1, 1\n  lui x2, 2\n  lui x3, 3\n  lui x4, 4\n  auipc x5, 3`, WMAX); // prettier-ignore
    const both = traces.find((t) => {
      const a = activate(t);
      return LANES.every((lane) => a.components.has(laneId('pcarith', lane)));
    });
    expect(both, `no cycle needed all ${MAX_WIDTH} pc/immediate adders`).toBeDefined();
    const act = activate(both!);
    const instrs = new Set(LANES.map((l) => act.wires.get(laneId('idex-pcarith-pc', l))!.instr));
    expect(instrs.size).toBe(MAX_WIDTH);
  });

  it('the MEM→WB bypass replicates: non-memory instructions ride past the memory together', () => {
    const traces = record(WIDE_INDEPENDENT, WMAX);
    const both = traces.find((t) => {
      const a = activate(t);
      return LANES.every((lane) => a.wires.has(laneId('exmem-memwb', lane)));
    });
    expect(both, 'no cycle bypassed the data memory in every slot').toBeDefined();
    const act = activate(both!);
    const instrs = new Set(LANES.map((l) => act.wires.get(laneId('exmem-memwb', l))!.instr));
    expect(instrs.size).toBe(MAX_WIDTH);
  });

  it('fetch replicates: one memory, one address, a GROUP of words out', () => {
    const traces = record(WIDE_INDEPENDENT, WMAX);
    const group = traces.find((t) => {
      const a = activate(t);
      return LANES.every((lane) => a.wires.has(laneId('imem-ifid', lane)));
    });
    expect(group, 'no cycle fetched a full group').toBeDefined();
    const act = activate(group!);
    const instrs = new Set(LANES.map((l) => act.wires.get(laneId('imem-ifid', l))!.instr));
    expect(instrs.size).toBe(MAX_WIDTH);
    // ...but ONE address wire and ONE adder: the group comes from `pc`, `pc + 4`, ...
    const base = group!.instructions.find((i) => i.location === 'IF.0')!.pc;
    expect(act.wires.get('pc-imem')!.value).toBe(base);
    // The adder advances by 4 PER INSTRUCTION FETCHED, so on a full cycle it reaches `pc + 4n` —
    // which is why it is drawn as `+4n` and its label comes from the trace rather than a constant.
    // At width 4 a fixed `+8` would be wrong on most cycles rather than on the interesting ones.
    expect(act.wires.get('addn-pcmux')!.value).toBe(base + 4 * MAX_WIDTH);
  });

  it('the fetch adder reads +4 when only ONE slot was free — the case a fixed `+4n` gets wrong', () => {
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

  it('the data memory does NOT replicate — the mem-port rule keeps MEM single-lane at EVERY width', () => {
    // The converse guard, and it is what the whole single-memory geometry rests on. If two memory
    // ops could ever co-issue, this diagram would be drawing a lie — and "the rule holds at width
    // 2" is not the same measurement as "the rule holds at width 4", where a group is twice as
    // likely to contain two of anything.
    for (const { source } of EXAMPLE_PROGRAMS) {
      for (const w of WIDTHS) {
        for (const t of record(source, atWidth(w), false)) {
          const mem = t.events.filter((e) => e.type === 'mem-read' || e.type === 'mem-write');
          expect(mem.length, `two memory accesses in one cycle at width ${w}`).toBeLessThanOrEqual(1); // prettier-ignore
        }
      }
    }
  });
});

// =================================================================================================
// Forwarding — a change of path, and a SOURCE the trace does not slot
// =================================================================================================

describe('forwarding across the lanes', () => {
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
    // Read against the FULL wire universe, not the drawn geometry — `activate` is width-oblivious
    // by design, so "the wire it lit exists" is a claim about every wire it could ever name.
    const sources = [MEM_PORT, INTRA_PAIR_RAW, BRANCH_SLOT, WIDE_INDEPENDENT, `  addi x1, x0, 64\n  lw x2, 0(x1)\n  add x3, x2, x2`]; // prettier-ignore
    const byId = new Map(WIRES.map((w) => [w.id, w]));
    for (const src of sources) {
      for (const cfg of CONFIGS) {
        for (const t of record(src, cfg)) {
          const act = activate(t);
          for (const [id, a] of act.wires) {
            const wire = byId.get(id);
            expect(wire, `lit wire ${id} is not real geometry`).toBeDefined();
            for (const end of wire!.ends)
              expect(act.components.has(end), `${id} lit into dim ${end}`).toBe(true);
            expect(STAGES).toContain(a.stage);
          }
        }
      }
    }
  });

  it('never lights a wire whose lane the trace does not have, at any width', () => {
    // A wire lit for a lane the machine does not have would be a wire the view has already hidden —
    // the classic "lit but not drawn" incoherence, which vanishes silently instead of failing.
    const byId = new Map(WIRES.map((w) => [w.id, w]));
    for (const w of WIDTHS) {
      for (const t of record(INTRA_PAIR_RAW, atWidth(w))) {
        for (const [id, a] of activate(t).wires) {
          expect(byId.get(id)!.lane ?? 0, `${id} at width ${w}`).toBeLessThan(w);
          expect(a.slot, `${id} slot at width ${w}`).toBeLessThan(w);
        }
      }
    }
  });
});

describe('depth tiers × forwarding × prediction × WIDTH (INV-5)', () => {
  it('the config space is COMPLETE over the widths the engine admits', () => {
    // A literal config list is the one thing a derived `WIDTHS` does not protect (steps 1/3/4/5's
    // standing guard): raising the engine's bound must widen this sweep, not leave it behind.
    expect(WIDTHS).toEqual(Array.from({ length: MAX_ISSUE_WIDTH }, (_, i) => i + 1));
    expect(new Set(CONFIGS.map((c) => c.issueWidth))).toEqual(new Set(WIDTHS));
    expect(CONFIGS.length).toBe(4 * MAX_ISSUE_WIDTH);
  });

  it('tierVisible: an element shows once the selected tier reaches its minTier', () => {
    expect(DEPTH_TIERS.map((t) => tierVisible('expert', t))).toEqual([false, false, true]);
    expect(DEPTH_TIERS.map((t) => tierVisible(undefined, t))).toEqual([true, true, true]);
  });

  it('hides the forwarding structure below expert and reveals it there, in EVERY lane', () => {
    for (const lane of LANES) {
      for (const base of ['fwdunit', 'fwdmuxa', 'fwdmuxb']) {
        const n = NODES.get(laneId(base, lane))!;
        expect(nodeVisibleAt(n, 'detailed', WMAX), `${n.id} shown below expert`).toBe(false);
        expect(nodeVisibleAt(n, 'expert', WMAX), `${n.id} hidden at expert`).toBe(true);
      }
    }
  });

  it('the forwarding network is ABSENT when forwarding is off — even at expert, in every lane', () => {
    for (const lane of LANES) {
      for (const base of ['fwdunit', 'fwdmuxa', 'fwdmuxb']) {
        const n = NODES.get(laneId(base, lane))!;
        expect(nodeVisibleAt(n, 'expert', { ...WMAX, forwarding: false })).toBe(false);
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
        for (const w of geometryFor(cfg.issueWidth).wires) {
          if (!w.contracts) continue;
          const unit = NODES.get(w.contracts)!;
          // The contraction and its unit are mutually exclusive whenever the contraction is
          // otherwise eligible — that exclusivity is what lets them share a routing rail.
          if (nodeVisibleAt(unit, tier, cfg))
            expect(wireVisibleAt(w, tier, cfg), `${w.id} co-visible with ${unit.id}`).toBe(false);
        }
      }
    }
  });

  it('never draws a wire whose endpoint node is hidden (no dangling — PER TIER × PER CONFIG)', () => {
    for (const tier of DEPTH_TIERS) {
      for (const cfg of CONFIGS) {
        const g = geometryFor(cfg.issueWidth);
        const nodes = new Set([...g.nodes.values()].filter((n) => nodeVisibleAt(n, tier, cfg)).map((n) => n.id)); // prettier-ignore
        for (const wire of g.wires) {
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
    // tier CONTRADICTING a higher one. It must hold per lane, independently.
    const touches = (w: DatapathWire, node: string): boolean => w.ends.includes(node);
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
    expect(checked, 'contraction count').toBeGreaterThanOrEqual(7 * MAX_WIDTH);
    // EVERY lane's worth — a lane whose contractions were never authored would pass vacuously, and
    // that is a live risk now that lanes are generated rather than hand-written twice.
    for (const lane of LANES)
      expect(WIRES.some((w) => w.contracts && w.lane === lane), `lane ${lane} contractions`).toBe(true); // prettier-ignore
  });

  it('adds representational detail as the tier climbs (labels only add — lawful, INV-5)', () => {
    expect(DEPTH_TIERS.map(showValueLabels)).toEqual([false, true, true]);
    expect(DEPTH_TIERS.map(showControlLabels)).toEqual([false, false, true]);
  });
});

// =================================================================================================
// Geometry — the automatable slice of visual acceptance, now over FOUR drawings
// =================================================================================================

describe('geometry: node boxes are sane, at every width', () => {
  it('every node box lies within its own canvas', () => {
    for (const w of WIDTHS) {
      const g = geometryFor(w);
      for (const n of g.nodes.values()) {
        expect(n.x >= 0 && n.x + n.w <= g.canvas.width, `${n.id} out of width at ${w}`).toBe(true);
        expect(n.y >= 0 && n.y + n.h <= g.canvas.height, `${n.id} out of height at ${w}`).toBe(
          true,
        );
      }
    }
  });

  it('no two node boxes overlap', () => {
    for (const w of WIDTHS) {
      const nodes = [...geometryFor(w).nodes.values()];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!;
          const b = nodes[j]!;
          const disjoint =
            a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
          expect(disjoint, `${a.id} overlaps ${b.id} at width ${w}`).toBe(true);
        }
      }
    }
  });

  it('the four latch bars divide the five stage bands, in left-to-right pipeline order', () => {
    for (const w of WIDTHS) {
      const g = geometryFor(w);
      const bars = ['ifid', 'idex', 'exmem', 'memwb'].map((id) => g.nodes.get(id)!);
      for (let i = 1; i < bars.length; i++) {
        expect(bars[i - 1]!.x, `${bars[i - 1]!.id} left of ${bars[i]!.id} at ${w}`).toBeLessThan(bars[i]!.x); // prettier-ignore
      }
      const between = (id: string, l: string, r: string): void => {
        const n = g.nodes.get(id)!;
        expect(n.x, `${id} right of ${l} at ${w}`).toBeGreaterThan(g.nodes.get(l)!.x);
        expect(n.x, `${id} left of ${r} at ${w}`).toBeLessThan(g.nodes.get(r)!.x);
      };
      between('imem', 'pc', 'ifid');
      between('regfile', 'ifid', 'idex');
      between('dmem', 'exmem', 'memwb');
      for (const lane of LANES.filter((l) => l < w)) {
        between(laneId('alu', lane), 'idex', 'exmem');
        expect(g.nodes.get(laneId('wbmux', lane))!.x).toBeGreaterThan(g.nodes.get('memwb')!.x);
      }
    }
  });

  it('the lanes are TRANSLATIONS of each other — symmetry is structural, not eyeballed', () => {
    // Lane `n` is lane 0 moved straight down by `n` pitches, in the ID band as well as the EX one.
    // The sign-extender joins that claim at M13: it used to be hand-placed to straddle the register
    // file, which made it the one replicated unit exempt from the symmetry the rest of the file
    // rests on — and an exemption is where an asymmetry hides.
    const g = geometryFor(MAX_WIDTH);
    const pitch = g.nodes.get(laneId('alu', 1))!.y - g.nodes.get(laneId('alu', 0))!.y;
    for (const base of ['fwdunit', 'fwdmuxa', 'fwdmuxb', 'alu', 'pcarith', 'wbmux', 'signext']) {
      const a = g.nodes.get(laneId(base, 0))!;
      for (const lane of LANES) {
        const b = g.nodes.get(laneId(base, lane))!;
        expect(b.x, `${base} x differs at lane ${lane}`).toBe(a.x);
        expect(b.w, `${base} w differs at lane ${lane}`).toBe(a.w);
        expect(b.h, `${base} h differs at lane ${lane}`).toBe(a.h);
        expect(b.y - a.y, `${base} lane ${lane} pitch`).toBe(pitch * lane);
      }
    }
  });

  it('every lane-tinted node carries its lane in its TEXT label (the relief rule)', () => {
    // A lane hue may never be the sole carrier — the set ships one sub-3:1 tint, so this is an
    // obligation rather than a nicety, and it holds for all four slots or for none. A mux has no
    // room for text and carries its lane in its `expert` control label instead, which is checked
    // here rather than trusted, since a mux with neither would be hue-only.
    for (const n of NODES.values()) {
      if (n.lane === undefined) continue;
      const carrier = n.label || n.controlLabel || '';
      expect(carrier, `${n.id} has no text carrier for its lane hue`).not.toBe('');
      expect(carrier.includes(String(n.lane)), `${n.id} label omits its lane`).toBe(true);
    }
  });

  it('the lane hue set covers every lane, in the base block AND both dark blocks', () => {
    // `styles.css` asks for the two dark blocks to be identical and NO headless test could see a
    // tint added to only one of them — which is an invitation to make one see it rather than a
    // reason to trust care. Parsed from the stylesheet, so a hue that exists only in the TSX token
    // reference (or only in light mode) is a failure rather than a silent fallback to nothing.
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const blocks = [
      css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)')),
      css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf(":root[data-theme='dark']")), // prettier-ignore
      css.slice(css.indexOf(":root[data-theme='dark']")),
    ];
    const hues = blocks.map((b) =>
      LANES.map((lane) => new RegExp(`--lane-${lane}:\\s*(#[0-9a-f]{6})`).exec(b)?.[1] ?? null),
    );
    for (const [i, set] of hues.entries()) {
      expect(set.filter(Boolean).length, `block ${i} is missing a lane hue`).toBe(MAX_WIDTH);
      expect(new Set(set).size, `block ${i} reuses a hue across lanes`).toBe(MAX_WIDTH);
    }
    // The two dark blocks are the ones that drift, because only one of them is ever looked at.
    expect(hues[1]).toEqual(hues[2]);
    // ...and dark is a SELECTED set, not an automatic flip of light.
    expect(hues[0]).not.toEqual(hues[1]);
  });
});

describe('geometry: wires are orthogonal, anchored on real edges, and clear of the boxes', () => {
  it('every wire segment is axis-aligned (no diagonals)', () => {
    const eps = 0.01;
    for (const w of WIDTHS) {
      for (const wire of geometryFor(w).wires) {
        for (let i = 1; i < wire.points.length; i++) {
          const [ax, ay] = wire.points[i - 1]!;
          const [bx, by] = wire.points[i]!;
          const axisAligned = Math.abs(ax - bx) < eps || Math.abs(ay - by) < eps;
          expect.soft(axisAligned, `${wire.id} seg ${i} diagonal at width ${w} (${ax},${ay})→(${bx},${by})`).toBe(true); // prettier-ignore
        }
      }
    }
  });

  it('every wire endpoint sits on its node’s drawn edge', () => {
    for (const w of WIDTHS) {
      const g = geometryFor(w);
      for (const wire of g.wires) {
        const first = wire.points[0]!;
        const last = wire.points[wire.points.length - 1]!;
        expect.soft(onPerimeter(g.nodes, first, wire.ends[0]), `${wire.id} start off ${wire.ends[0]} at width ${w}`).toBe(true); // prettier-ignore
        expect.soft(onPerimeter(g.nodes, last, wire.ends[1]), `${wire.id} end off ${wire.ends[1]} at width ${w}`).toBe(true); // prettier-ignore
      }
    }
  });

  it('no wire segment runs THROUGH a box it is not connected to', () => {
    // NEW at M13, and it exists because nothing else in this suite could see it: endpoints are
    // checked against the perimeter, overlaps against other wires, dangling against visibility —
    // and a rail crossing straight through a latch bar passes all three. That crossing is the exact
    // failure mode of an N-lane rail scheme, and running it found TWO routes that had shipped since
    // M7: the forwarding unit's MEM/WB input crossed the EX/MEM bar, and the hazard unit's pc-hold
    // ran the length of the issue box directly above it. Both are rerouted; neither was visible to
    // any test, and neither was caught by M7's browser pass.
    for (const tier of DEPTH_TIERS) {
      for (const cfg of CONFIGS) {
        const g = geometryFor(cfg.issueWidth);
        const boxes = [...g.nodes.values()].filter((n) => nodeVisibleAt(n, tier, cfg));
        for (const wire of g.wires) {
          if (!wireVisibleAt(wire, tier, cfg)) continue;
          for (const seg of segmentsOf(wire.points)) {
            for (const box of boxes) {
              if (wire.ends.includes(box.id)) continue;
              expect.soft(throughBox(seg, box), `${wire.id} runs through ${box.id} at ${tier} ${label(cfg)}`).toBeLessThan(2); // prettier-ignore
            }
          }
        }
      }
    }
  });

  it('no two simultaneously-drawn wires run collinearly on top of each other', () => {
    // A collinear overlap is a permanent "two lines as one", invisible to the eye. Bucketed by all
    // THREE axes: a contraction and its through-mux wire are intentionally collinear (they share a
    // routing rail on purpose) but never co-visible, and neither are a hidden lane's wires.
    //
    // This is also the litmus that catches a CHANNEL COLLISION, which is what the N-lane rail
    // scheme risks: two lanes on the same outboard side climb through the same corridor, and if
    // they were handed the same channel — or the same stub on the bar they both leave from — their
    // runs would coincide. Segments are hoisted out of the inner loop: the check is quadratic in
    // the wire count, and the wire count grew with N.
    for (const tier of DEPTH_TIERS) {
      for (const cfg of CONFIGS) {
        const vis = geometryFor(cfg.issueWidth).wires.filter((w) => wireVisibleAt(w, tier, cfg));
        const segs = vis.map((w) => segmentsOf(w.points));
        for (let i = 0; i < vis.length; i++) {
          for (let j = i + 1; j < vis.length; j++) {
            let worst = 0;
            for (const sa of segs[i]!) for (const sb of segs[j]!) worst = Math.max(worst, collinearOverlap(sa, sb)); // prettier-ignore
            expect.soft(worst, `${vis[i]!.id} overlaps ${vis[j]!.id} at ${tier} ${label(cfg)} for ${worst.toFixed(0)}px`).toBeLessThan(2); // prettier-ignore
          }
        }
      }
    }
  });
});

// =================================================================================================
// The IF/ID corridor — M13 step 9, and the only litmus here whose subject is a LABEL
// =================================================================================================

/**
 * **The defect this closes was found by looking at the picture, and nothing in this file could have
 * seen it.** Every litmus above is about wires and boxes; a value label had no coordinates as far
 * as the suite was concerned. So when `pcmuxX` (which grows with the width, to hold `2n` redirect
 * channels) and `ifidX` (which shrank with it, to hold `2n` channels of its own) squeezed the one
 * corridor between them from **80 → 56 → 32 → 8 units**, against a 70-unit instruction-encoding
 * label, all 6186 tests stayed green — and at widths 3 and 4 every fetched encoding was drawn
 * straddling the IF/ID bar, which is painted over it. `0x01ff1e33` read as `ff…3`.
 *
 * Two halves, because the claim spans two layers and either one alone is satisfiable by a lie:
 *
 *  - **(a) the constant is honest** — {@link HEX_LABEL_W} is checked against what `DatapathDiagram`
 *    ACTUALLY draws, by rendering one and measuring the emitted box. A geometry that reserves room
 *    for a label size the renderer does not use is reserving nothing.
 *  - **(b) the geometry keeps it, at every width** — asked of the drawing that is really rendered,
 *    `geometryFor(w)`, not of the lane universe.
 *
 * The signed overlap that found this is worth naming as a POINTER rather than a verdict: the
 * measurement read −7 at width 2 (legible) and −31 at width 4 (not), so the number ranked the
 * widths while the image decided which of them was broken.
 */
describe('the IF/ID corridor holds an instruction encoding, at every width', () => {
  it('(a) the reserved width matches what the RENDERER actually draws for a 32-bit encoding', () => {
    // `hex32` renders `0x` + eight digits. Ten characters is the widest value label this diagram
    // can emit, and it is emitted on exactly the wires that cross this corridor.
    const text = hex32(0x01ff1e33);
    expect(text).toHaveLength(10);
    const markup = renderToStaticMarkup(
      createElement(DatapathDiagram, {
        title: 't',
        ariaLabel: 'a',
        markerPrefix: 'm',
        canvas: { width: 400, height: 200 },
        nodes: [],
        wires: [
          {
            id: 'w',
            points: [
              [100, 100],
              [300, 100],
            ],
            active: true,
            label: text,
          },
        ],
      }),
    );
    const box = /class="dp-vlabel-box"[^>]*width="([\d.]+)"/.exec(markup);
    expect(box, 'the renderer emitted no value-label box').not.toBeNull();
    const drawn = Number(box![1]);
    expect(
      HEX_LABEL_W,
      `the geometry reserves ${HEX_LABEL_W} for a label the renderer draws at ${drawn}`,
    ).toBeGreaterThanOrEqual(drawn);
  });

  it('(b) at every width, the gap between the instruction memory and the IF/ID bar holds it', () => {
    for (let w = 1; w <= MAX_WIDTH; w++) {
      const g = geometryFor(w);
      const imem = g.nodes.get('imem')!;
      const ifid = g.nodes.get('ifid')!;
      const corridor = ifid.x - (imem.x + imem.w);
      expect(
        corridor,
        `width ${w}: the encoding labels have ${corridor}px between Instr Mem and the IF/ID bar`,
      ).toBeGreaterThanOrEqual(IFID_CORRIDOR);
    }
  });

  it('(d) which widths the fix MOVED — enumerated, because the first draft guessed and was wrong', () => {
    // The draft asserted "widths 1 and 2 were already clear, so they did not move". Width 1 was;
    // width 2 was NOT — its corridor is 56 against a requirement of 78, so the bar slides 22px and
    // the shipped two-wide drawing changes. That is the correct outcome (at width 2 the encoding
    // already overhung the bar by 7px and only got away with it), but it is a fact about the
    // machine, not a convenience: the same class as step 6's 33 survivors and step 3's fillsFour
    // names. **Enumerate what your change moved; do not characterise it from what you hoped.**
    expect([1, 2, 3, 4].map((w) => geometryFor(w).nodes.get('ifid')!.x - (308 - 12 * w))).toEqual([
      0, 22, 46, 70,
    ]);
    // Width 1's zero is for a STATED reason rather than by luck: its corridor was already wide
    // enough. Asserting the reason, not just the zero.
    const g1 = geometryFor(1);
    expect(g1.nodes.get('ifid')!.x - (g1.nodes.get('imem')!.x + g1.nodes.get('imem')!.w)).toBe(80);
  });
});
