/**
 * The IN-ORDER SUPERSCALAR datapath (M7 step 7; widened to N lanes at M13 step 7) — the fourth
 * bespoke geometry, in the same two-halves shape as `datapath.ts` (M1), `datapath-multi.ts` (M2)
 * and `datapath-pipeline.ts` (M3):
 *
 *  1. GEOMETRY — {@link DatapathNode}s / {@link DatapathWire}s with DERIVED SVG coordinates: a
 *     SHARED front-end (next-pc selector, PC, the instruction memory fetching a GROUP, the
 *     issue/pairing unit, one register file) feeding **N replicated execute lanes**, which then
 *     re-converge on a SINGLE data memory and a shared writeback bus. Built per width by
 *     {@link geometryFor}, because the lane count is what sets the height.
 *  2. ACTIVATION — {@link activate}, a pure `CycleTrace → DatapathActivation`.
 *
 * ## What is new here, and what is deliberately NOT
 *
 * M3 broke "one instruction per diagram"; this breaks **"one instruction per stage."** A cycle can
 * light `5 × width` stage slices for that many different instructions, so a lit wire has to say
 * which instruction, which stage, AND which issue SLOT lit it.
 *
 * **What actually widens is a short list, and the pinned pairing rules are why.** The three refusal
 * verdicts are a coordinated simplification, not three independent tastes: no two memory ops
 * co-issue ⇒ MEM does ≤1 access per cycle, so the data memory stays SINGLE; no two transfers
 * co-issue ⇒ EX resolves ≤1 control transfer per cycle, so the redirect stays SINGLE. What
 * replicates is exactly: fetch, the register-read ports, the sign-extenders, the forwarding
 * network, the ALUs, the dedicated pc/immediate adders, and the writeback write ports. The geometry
 * says so literally — every node carrying a `lane` is one of those, and everything else is drawn
 * once. The register file is the sharpest case and it did NOT replicate at M13: it grew PORTS. Its
 * edge carries `2n` reads and `n` writes, spread rather than hand-placed, which is what let the box
 * stay one box at four lanes.
 *
 * Two of those replications were settled by DUMPING A REAL TRACE, not by reasoning, because both
 * looked shared at first glance and are not:
 *   - **`pcarith` replicates.** `lui`s co-issue happily (they are neither memory ops, nor transfers,
 *     nor RAW-dependent), and U/J-format producers emit no `alu-op` at all — so a cycle really can
 *     hold four `lui`s, each needing the dedicated pc/immediate adder at once.
 *   - **The MEM→WB bypass replicates.** Non-memory instructions in several `MEM.n` slots all carry
 *     their value straight past the data memory in the same cycle. One shared wire could only name
 *     one of them, and the follow-ring would silently point at the wrong instruction.
 *
 * ## The three encoding channels — and why the wire stroke is NOT the lane
 *
 * `superscalar-visuals.md` (2026-07-14) proposed lane-tinting the wires. That document predates
 * M3 step 6 shipping, and by now the wire stroke is SPOKEN FOR: it means STAGE, in the same
 * validated `PHASE_COLORS` set the pipeline map directly above the diagram uses. Re-pointing it at
 * "lane" would put two color grammars on one screen — the map saying blue = IF while the datapath
 * says blue = lane 0 — and would make `EX.0` and `EX.1` DIFFERENT colors, destroying the one
 * reading this whole tier exists to produce: *several instructions in EX at once.*
 *
 * So the three channels are split by what can honestly carry each (user-pinned, 2026-07-20):
 *   - **wire stroke = STAGE** (`PHASE_COLORS`), exactly as M3.
 *   - **node tint = LANE** (`--lane-0` … `--lane-3`). M3 keeps boxes hue-neutral because a box is
 *     SHARED — the register file is read by ID and written by WB in one cycle — and that reason
 *     still holds for every shared box here, which is why only `lane`-carrying nodes are tinted.
 *     `ALU 1` does slot 1's work and nothing else, so it can wear a lane hue without lying.
 *   - **follow ring = IDENTITY** (a hue-free dashed halo), composing with both.
 * The relief rule is mandatory and satisfied structurally: the set ships one tint below 3:1 against
 * its surface, so every lane-tinted node carries its lane in its TEXT label (`ALU 1`, `Sign
 * Extend 3`), and the legend swatches sit beside the words "Lane 0" … "Lane 3".
 *
 * ## THREE visibility axes (M3 had two), and the third one is not like the others
 *
 * `tier` and `forwarding`/`predictTaken` behave exactly as in M3: they REMOVE interior detail from
 * a drawing whose outline does not move, so they can be filters over a fixed geometry. **`issueWidth`
 * cannot be**, and that is the M13 finding. It follows the same LAW — with `issueWidth: n` the
 * trace never emits a `.n` location, no pairing refusal can fire at width 1, and the machine
 * genuinely has no further lane, so the lanes past it are **ABSENT, not dimmed** (drawing an idle
 * ALU would contradict the trace, INV-5). But an absent lane also takes its height with it: the
 * latch bars span the lane stack and the rail bands sit outside it, so the CANVAS is a function of
 * the width and the geometry is built per width rather than filtered. That is what makes the width
 * toggle *restructure* the picture, which is the flagship A/B this tier exists for.
 *
 * The issue unit hiding at width 1 deserves its own line, because it is the one that looks
 * arguable: a 1-wide superscalar is an honest machine that DOES run issue logic (that is the pinned
 * answer to "is width 1 distinct from M3"). But this box draws the PAIRING verdict specifically —
 * "may these go together" — and with one candidate there is no such question, which is why the
 * three pairing reasons cannot appear at width 1. That claim is not asserted here on reasoning; the
 * test suite proves it over the whole corpus (`no pairing refusal is possible at width 1`). The
 * ORDINARY hazard check that width 1 still runs is drawn by the separate `hazard` unit, which is
 * width-independent — exactly as M3's is.
 *
 * ## Occupancy comes from `instructions[].location`, NEVER from `state.micro`
 *
 * Inherited verbatim from M3, and the trap is unchanged: `micro` at cycle `i` is the END-of-cycle
 * latch state, so a datapath sourced from it draws the pipe ONE CYCLE AHEAD OF ITSELF. Values
 * likewise come only from THIS cycle's `events`. Nothing here reads `micro` at all. The same
 * consequence follows: values riding a latch BETWEEN stages are mostly unlabelled, because they
 * were emitted a cycle earlier and are not in this trace — those wires light bare rather than
 * borrow a number that would be one cycle wrong (INV-5: omit, never contradict).
 *
 * One superscalar-specific sharpening of that rule: `forward.from` names only the LATCH
 * (`'EX/MEM'` / `'MEM/WB'`) and **not which slot of it** the value came from. So every forward is
 * drawn from the latch BAR — the source lane is a fact the trace does not carry, and inventing one
 * would be a coin-flip drawn as hardware. The SINK lane is known (it is the consumer's own slot),
 * which is why the forward wires are lane-tagged at their destination end only.
 */

import { DEPTH_TIERS, type DepthTier } from '@cpu-viz/curriculum';
import { MAX_ISSUE_WIDTH, type Stage } from '@cpu-viz/engine-superscalar';
import type { CycleTrace, InstructionInstance } from '@cpu-viz/trace';

export type { Stage };

/** The five stages, oldest-to-youngest left to right — the columns of the diagram. */
export const STAGES: readonly Stage[] = ['IF', 'ID', 'EX', 'MEM', 'WB'];
export const STAGE_LABELS: Record<Stage, string> = {
  IF: 'Fetch',
  ID: 'Decode',
  EX: 'Execute',
  MEM: 'Memory',
  WB: 'Writeback',
};

/**
 * An issue slot — the lane a replicated unit belongs to. Index 0 is the OLDEST in program order.
 * This names every lane the geometry CAN draw; how many it DOES draw is {@link geometryFor}'s
 * argument. The union is pinned to {@link MAX_WIDTH} by test rather than by comment.
 */
export type Lane = 0 | 1 | 2 | 3;
export const LANES: readonly Lane[] = [0, 1, 2, 3];
/**
 * The widest machine this geometry draws — the ENGINE's bound, imported rather than re-typed.
 * Until M13 step 7 this was a local `2`, and `parseLocation` returned `null` for every slot beyond
 * it: at width 3 an `EX.2` occupant was dropped from the occupancy map with no crash and no red
 * test (found by step 5's sweep, fixed here). A view that clamps a slot the trace can emit is not
 * simplifying — it is disagreeing with the trace, which no depth tier is allowed to do (INV-5).
 */
export const MAX_WIDTH = MAX_ISSUE_WIDTH;

/**
 * Split a superscalar `location` into its stage and issue slot. This model's locations are ALWAYS
 * `"<stage>.<slot>"` — never a bare `"EX"`, even at width 1 (pinned at M7 step 2a, proven over a
 * real recording at step 5), so a bare stage name is not ours to draw and returns `null`.
 *
 * The slot bound is the ENGINE's maximum, not the drawn width. Bounding it by the drawn width
 * would re-create the step-5 hole one level up: a trace recorded wide and viewed narrow would lose
 * occupants silently instead of showing a mismatch.
 */
export function parseLocation(location: string): { stage: Stage; slot: number } | null {
  const dot = location.indexOf('.');
  if (dot < 0) return null;
  const stage = location.slice(0, dot);
  const slot = Number(location.slice(dot + 1));
  if (!(STAGES as readonly string[]).includes(stage)) return null;
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_WIDTH) return null;
  return { stage: stage as Stage, slot };
}

/** The wire/node id for lane `n`'s copy of a replicated element (`'alu'` → `'alu-l1'`). */
export function laneId(base: string, lane: number): string {
  return `${base}-l${lane}`;
}

// --- Geometry -----------------------------------------------------------------------------
//
// WIDTH IS SET BY THE LABELS, HEIGHT BY THE LANES — and at M13 step 7 both became FUNCTIONS OF THE
// ISSUE WIDTH rather than constants. The first half is M3's finding, inherited: the shared renderer
// de-collides a value label by nudging it VERTICALLY, which fails beside a latch bar (a tall bar
// leaves a label no clear y to escape to), so every gap where a 32-bit hex label lands beside a bar
// is sized to hold it. The second half is this model's, and it is why the geometry could not stay a
// constant: N execute lanes plus the shared spine BETWEEN them, plus a rail band for each lane's
// forwarding returns, is what sets the height — so the height IS the width. A single geometry sized
// for four lanes would draw a width-1 machine as one lane at the top of a canvas two thirds empty,
// and the latch bars would span three lanes that do not exist. The bars' height and the rails' y are
// wire coordinates, so the wires are width-dependent too; there is no smaller change that works.
//
// THE RAIL SCHEME, AND THE ONE PREMISE IT RESTS ON. Until M13 lane 0's forwarding returns rode the
// band ABOVE the diagram and lane 1's the band BELOW — an outboard-side scheme with exactly two
// sides, which four lanes do not have. The generalization keeps the two bands and splits the lanes
// between them: the TOP half of the lanes forward on the top side, the BOTTOM half on the bottom.
// That is `ceil(n/2)` on top, which reproduces the old assignment exactly at widths 1 and 2, and it
// preserves the file's original safety argument rather than replacing it — the vertical channels
// between the ID/EX bar and the forwarding muxes are REUSED by the two sides, which is sound only
// because a top-side lane's runs and a bottom-side lane's runs are disjoint in y. Lanes on the SAME
// side do overlap in y, so each of them needs its own channel: the channel count is
// `4 * ceil(n/2)`, not 4, and the corridor is widened to hold them by pushing the execute cluster
// right (`fwdmuxX` is derived FROM the channel count, so the two can never disagree).
const LANE_DY = 310;
/** A lane block's own height — its forwarding unit's top to its pc/immediate adder's bottom. */
const LANE_H = 260;
/** A lane's sign-extender sits this far below its block top, in the shared ID band. */
const SEXT_DY = 114;
const ALU_W = 84;
/** The instruction memory's width — named because the IF/ID corridor below is derived from its
 *  right edge, so the two must move together. */
const IMEM_W = 76;
/**
 * How much clear horizontal room the IF/ID corridor must hold, and it is arithmetic rather than
 * taste: the widest value label anchored in that corridor is a fetched instruction's ENCODING,
 * `hex32` renders exactly 10 characters, and `layoutLabels` sizes a label box at
 * `text.length * 3.2 + 3` either side of its anchor. `layoutLabels` also counts a label as
 * colliding with a component box within 2 units of its edge, so the corridor must clear that margin
 * at both ends — and the label needs it at both of its own ends too.
 *
 * **M13 step 9 found this by looking at the picture.** `pcmuxX` grows with the width (the left
 * margin holds `2n` redirect channels) and `ifidX` shrank with it (the ID band holds `2n` channels
 * of its own), so the one corridor between them was squeezed from BOTH sides: 80 → 56 → 32 → **8**
 * units against a 70-unit label. At widths 3 and 4 all of the fetched encodings were drawn
 * straddling the IF/ID bar, which is painted over them — `0x01ff1e33` read as `ff…3`. Every
 * headless test passed, because a label's coordinates were never compared to anything.
 *
 * This is step 7's own rule arriving one column to the left: `fwdmuxX` is derived from the number
 * of channels its corridor must hold, so a wider machine MOVES THE HARDWARE instead of overrunning
 * the corridor. The execute side got that treatment at step 7; the front end did not, because
 * nothing there is a channel COUNT — it is a label, and a label is not part of the geometry until
 * something says how wide it is.
 */
export const HEX_LABEL_W = 2 * (10 * 3.2 + 3);
export const IFID_CORRIDOR = HEX_LABEL_W + 4 * 2;

/** How many lanes forward on each outboard side. Reproduces M7's assignment at widths 1 and 2. */
function sideSplit(width: number): { top: number; bottom: number } {
  const top = Math.ceil(width / 2);
  return { top, bottom: width - top };
}

/** `count` anchors spread evenly across a node edge, as offsets from that edge's midpoint. The
 *  register file is the only node that needs this: it is the one shared box whose PORT COUNT grows
 *  with the width (two read ports and one write port per lane), while the box itself must not. */
function spread(count: number, i: number, span: number): number {
  return count <= 1 ? 0 : (i - (count - 1) / 2) * (span / count);
}

export interface DatapathNode {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Draw as a trapezoid (mux) or notched adder rather than a plain box. */
  readonly shape?: 'box' | 'mux' | 'adder';
  /**
   * The execute lane this unit belongs to — set ONLY on genuinely replicated hardware. Two things
   * follow, and they are the reason this one field carries the whole lane story:
   *   - VISIBILITY: lane `n` exists only at `issueWidth > n`, so lane 1 is absent at width 1.
   *   - TINT: the view paints the box in `--lane-<n>`. A shared box (the register file, the data
   *     memory, every latch bar) has no lane and stays hue-neutral — not for tidiness but because
   *     it genuinely belongs to no single instruction, which is M3's pinned reason for hue-neutral
   *     boxes and still holds here.
   */
  readonly lane?: Lane;
  /** Lowest depth tier at which this component is drawn. Absent ⇒ `essentials`. */
  readonly minTier?: DepthTier;
  /** Drawn ONLY when `forwarding` is on — the forwarding units and their muxes (as M3). */
  readonly forwardingOnly?: boolean;
  /** Drawn ONLY when the machine bets taken — the branch-target adder and its redirect (as M3). */
  readonly predictTakenOnly?: boolean;
  /**
   * Lowest `issueWidth` at which this unit is drawn. Absent ⇒ 1 (always). Set to 2 on the ISSUE
   * unit, which is the one width-gated node that is not simply "another lane's copy": pairing is a
   * question about two or more candidates, and at width 1 there is never a second one — so the
   * trace cannot carry a pairing refusal there, and a unit that could never light would be drawing
   * a decision the machine never makes. A `lane` implies its own minimum (`lane + 1`) and needs no
   * duplicate.
   */
  readonly minWidth?: number;
  /** The control signal this unit drives — shown only at `expert` tier. */
  readonly controlLabel?: string;
}

/** The narrowest machine that draws `node` — from its explicit `minWidth` and its lane, whichever
 *  is stricter. Lane `n` needs width `n + 1` by definition, so the two never have to agree by hand.
 *
 *  This survives the move to per-width geometry ON PURPOSE. `geometryFor(w)` already omits every
 *  lane at or beyond `w`, so for a lane node this check is redundant — but it is the only thing
 *  that gates the ISSUE unit, and keeping it means the "absent, never idle" claim can still be
 *  asked of the full lane universe ({@link NODES}) rather than only of a geometry that has already
 *  answered it by construction. A claim you can only test against a set that cannot falsify it is
 *  not a tested claim. */
function requiredWidth(el: { lane?: Lane; minWidth?: number }): number {
  return Math.max(el.minWidth ?? 1, (el.lane ?? 0) + 1);
}

export interface DatapathWire {
  readonly id: string;
  /** The two node ids this wire physically connects (edge-to-edge). Drives visibility: a wire is
   *  drawn only if both ends are, so hiding a unit never dangles a wire. The `id` is a display name
   *  and does NOT reliably name the endpoints. */
  readonly ends: readonly [string, string];
  readonly points: readonly Pt[];
  /** The issue slot whose work this wire carries. Set on every replicated wire — including ones
   *  whose ENDPOINTS are both shared (the `imem → IF/ID` fetch wires, the `EX/MEM → MEM/WB`
   *  bypasses), which is exactly why this cannot be derived from `ends`. */
  readonly lane?: Lane;
  readonly minTier?: DepthTier;
  readonly forwardingOnly?: boolean;
  readonly predictTakenOnly?: boolean;
  /** Lowest `issueWidth` at which this wire is drawn (absent ⇒ 1; a `lane` implies `lane + 1`). */
  readonly minWidth?: number;
  /** For a CONTRACTION wire: the unit id it collapses. The `S → T` contraction must equal the
   *  expert path `S → unit → T` (same source, same sink) — the INV-5 lawfulness condition, checked
   *  by test. It is drawn exactly when that unit is NOT (see {@link wireVisibleAt}). */
  readonly contracts?: string;
}

type Pt = readonly [number, number];

/** One machine's drawn geometry: the canvas it needs, its nodes and its wires. */
export interface Geometry {
  readonly canvas: { readonly width: number; readonly height: number };
  readonly nodes: ReadonlyMap<string, DatapathNode>;
  readonly wires: readonly DatapathWire[];
}

/**
 * Every derived coordinate for an `n`-lane machine, in one place and in dependency order.
 *
 * The chain is the point: nothing below is a hand-typed endpoint. `fwdmuxX` comes from how many
 * forwarding channels the corridor must hold, `aluX` from how many contraction channels sit past
 * the muxes, and the whole execute cluster and canvas width follow from `aluX`. So widening the
 * machine cannot silently overrun a corridor — the corridor moves the hardware instead.
 */
function layout(n: number) {
  const { top: topLanes, bottom: botLanes } = sideSplit(n);

  // --- the two outboard rail bands -----------------------------------------------------------
  // Four control rails, then four forwarding rails for each lane that forwards on the top side.
  const bet = 18, seq = 32, issuePc = 46, hazardPc = 60; // prettier-ignore
  // FIVE rails per lane, not four. The fifth carries the MEM/WB -> forwarding-unit comparison,
  // which until M13 ran STRAIGHT THROUGH the EX/MEM latch bar: the unit sits left of that bar and
  // its source right of it, and a bar spans every lane, so the only route that does not cross a box
  // is outboard. That crossing shipped at M7 and no litmus in the suite could see it.
  const topFwd = Array.from({ length: 5 * topLanes }, (_, k) => 74 + 8 * k);
  const barTop = 74 + 40 * topLanes + 6;
  const exTop = barTop + 6;
  const laneTop = (lane: number): number => exTop + lane * LANE_DY;
  const spineY = barTop + 268;
  const btargetY = barTop + 344;
  // The bars span whatever the machine is TALLEST at - the lane stack once there are two lanes, but
  // the ID column at width 1, where four boxes stacked in one band reach further down than a single
  // execute lane does. Deriving this from the lane stack alone left the width-1 bars ending ABOVE
  // the bet adder's own input, so a wire anchored on the bar hung in space.
  const stackBottom = Math.max(laneTop(n - 1) + LANE_H, btargetY + 54, spineY + 46);
  const barH = stackBottom + 12 - barTop;

  const bandStart = barTop + barH + 12;
  const botFwd = Array.from({ length: 5 * botLanes }, (_, k) => bandStart + 8 * k);
  const redirectStart = bandStart + 40 * botLanes;
  // Two pc redirects per lane (its pc adder and its ALU), then one writeback bus per lane.
  const redirect = Array.from({ length: 2 * n }, (_, k) => redirectStart + 8 * k);
  const wbStart = redirectStart + 16 * n + 10;
  const wb = Array.from({ length: n }, (_, k) => wbStart + 12 * k);

  // --- the vertical corridors, left to right -------------------------------------------------
  // The left margin carries one channel per pc redirect. The sequential-pc and bet returns REUSE
  // the first two: they descend from the top rails to an anchor above the selector's midpoint,
  // while a redirect climbs from the bottom rails to an anchor below it, so the two never share a
  // stretch of y. That reuse is what keeps the margin from having to hold `2n + 2` channels.
  const leftCh = Array.from({ length: 2 * n }, (_, k) => 4 + 6 * k);
  const pcmuxX = 10 + 12 * n;
  const pcX = pcmuxX + 36;
  const imemX = pcmuxX + 118;
  const seqCh = imemX + 78;

  // The ID band's channels: one bet-immediate run and one writeback bus per lane, in the gap
  // between the IF/ID bar and the ID column. The BAR moves left as the machine widens, to hold
  // those `2n` channels without moving the ID band's own boxes off where the reader learned them.
  //
  // ...but the bar moving left is what starved the corridor on its OTHER side, so the whole ID
  // column and everything right of it now slides by `idShift` — the shortfall, if any, between the
  // room {@link IFID_CORRIDOR} needs and the room those two independently-derived x's left it. At
  // widths 1 and 2 the pre-M13 relation already cleared it and the shift is ZERO, so those two
  // drawings are untouched by this; at widths 3 and 4 the hardware moves rather than the labels
  // being drawn under a latch bar. The five bases below were five independent literals, which is
  // precisely why a squeeze between two of them could go unnoticed — they are one chain now.
  const ifidFloor = 308 - 12 * n;
  const idShift = Math.max(0, imemX + IMEM_W + IFID_CORRIDOR - ifidFloor);
  const ifidX = ifidFloor + idShift;
  const idCh = Array.from({ length: 2 * n }, (_, k) => 330 + idShift - 12 * n + 6 * k);
  const idX = 330 + idShift;

  // Between the register file and the ID/EX bar: two read-port channels per lane, one bet-corner
  // channel per lane, and one return for the bet adder's own output.
  const midCh = Array.from({ length: 3 * n + 2 }, (_, k) => 448 + idShift + 5 * k);
  const idexX = 520 + idShift;
  const portCh = (lane: number, port: number): number => midCh[2 * lane + port]!;
  const cornerX = (lane: number): number => midCh[2 * n + lane]!;
  const betCh = midCh[3 * n]!;
  // The hazard unit's pc-hold climbs on the RIGHT, not straight up out of its own top edge. The
  // issue unit sits directly above it in the same column and over the same x range, so the old
  // route ran the length of that box - a second M7 crossing the new litmus found. Nothing sits
  // between the register file and the ID/EX bar above the file, so the climb is clear there.
  const ctrlCh = midCh[3 * n + 1]!;

  // Between the ID/EX bar and the execute cluster: four forwarding channels per top-side lane
  // (reused by the bottom side, y-disjointly), then four contraction channels per top-side lane.
  // A contraction and a through-mux wire are never co-visible, so those two families may overlap
  // each other's x freely — but never within a family.
  const fwdCh = Array.from({ length: 5 * topLanes }, (_, k) => 542 + idShift + 8 * k);
  const fwdmuxX = fwdCh[fwdCh.length - 1]! + 14;
  const conCh = Array.from({ length: 4 * topLanes }, (_, k) => fwdmuxX + 20 + 6 * k);
  const muxOutCh = fwdmuxX + 30;
  const aluX = conCh[conCh.length - 1]! + 6;
  const fwdunitX = fwdmuxX + 10;
  const aluR = aluX + ALU_W;
  const fwdunitW = aluR - fwdunitX;
  const fwdunitCh = aluR + 4;
  // The pc-adder redirects take the first `n` channels right of the execute cluster and the ALU
  // redirects the next `n`, so a wider machine never folds one family into the other.
  const pcarithCh = (lane: number): number => aluR + 8 + 6 * lane;
  const aluCh = (lane: number): number => aluR + 8 + 6 * n + 6 * lane;

  const exmemX = aluX + 160;
  const dmemX = exmemX + 78;
  const memwbX = exmemX + 256;
  const wbmuxX = memwbX + 110;
  const width = wbmuxX + 150;
  const wbCh = (lane: number): number => width - 100 + 12 * lane;
  const wbConCh = (lane: number): number => width - 112 + 12 * lane;

  // --- the shared spine's y, and the ID column's ----------------------------------------------
  const issueY = barTop;
  const hazardY = barTop + 58;
  const regfileY = barTop + 188;
  const sextY = (lane: number): number => laneTop(lane) + SEXT_DY;
  /** The y a lane's bet-immediate run turns left on, below the bet adder and above every lane's
   *  sign-extender — the one horizontal band in the ID column that is clear at every width. */
  const cornerY = (lane: number): number => btargetY + 60 + 6 * lane;
  /** The selector's left edge carries the sequential pc, the bet, and both redirects per lane. */
  const pcmuxH = 12 * (2 * n + 2) + 4;
  const pcmuxOff = (k: number): number => -6 * (2 * n + 1) + 12 * k;

  const height = wb[wb.length - 1]! + 32;

  return {
    n,
    topLanes,
    botLanes,
    rail: { bet, seq, issuePc, hazardPc, topFwd, botFwd, redirect, wb },
    laneTop,
    barTop,
    barH,
    exTop,
    spineY,
    leftCh,
    pcmuxX,
    pcX,
    imemX,
    seqCh,
    idCh,
    ifidX,
    idX,
    idexX,
    idShift,
    portCh,
    cornerX,
    betCh,
    ctrlCh,
    cornerY,
    fwdCh,
    conCh,
    muxOutCh,
    fwdmuxX,
    fwdunitX,
    fwdunitW,
    fwdunitCh,
    aluX,
    aluR,
    pcarithCh,
    aluCh,
    exmemX,
    dmemX,
    memwbX,
    wbmuxX,
    wbCh,
    wbConCh,
    issueY,
    hazardY,
    regfileY,
    btargetY,
    sextY,
    pcmuxH,
    pcmuxOff,
    canvas: { width, height },
  };
}
type Layout = ReturnType<typeof layout>;

/** Which outboard band a lane's forwarding returns ride, and which five rails of it. */
function fwdRails(L: Layout, lane: number): { side: 't' | 'b'; rails: number[] } {
  const onTop = lane < L.topLanes;
  const band = onTop ? L.rail.topFwd : L.rail.botFwd;
  const base = 5 * (onTop ? lane : lane - L.topLanes);
  return { side: onTop ? 't' : 'b', rails: band.slice(base, base + 5) };
}

// LAYOUT CONTRACT (checked by the geometry tests): five stage bands divided by four latch BARS,
// exactly as M3 — the bars are SHARED and undoubled, because a latch bar already holds every slot
// (`SuperscalarMicro`'s latches are arrays; the bar is the array, not one element of it). Between
// them the canvas is banded HORIZONTALLY: the execute lanes stacked on a fixed pitch, with the
// shared spine (PC/instruction memory, register file, data memory) running through at its own y.
// Control units ride the clear top band; each lane's forwarding returns ride its side's rail band;
// the writeback buses and the pc redirects ride the lowest rails, each on its own y.
function sharedNodes(L: Layout): DatapathNode[] {
  return [
    // --- IF (shared): the next-pc selector, the PC, the group-fetch adder, the instruction memory
    // The selector's source count is the honest one for this machine: the sequential next pc, the
    // ID bet, and a pc-relative or `jalr` correction from EVERY lane. That last family is why there
    // are `2n` redirects and not two — the branch-slot rule caps EX at ONE resolved transfer per
    // cycle, but it does NOT say which lane it sits in (observed: a `jal` issuing from slot 1
    // beside an `auipc` in slot 0), so every lane must be able to steer and at most one ever does.
    { id: 'pcmux', label: '', x: L.pcmuxX, y: L.spineY - L.pcmuxH / 2, w: 18, h: L.pcmuxH, shape: 'mux', controlLabel: 'PCSrc' }, // prettier-ignore
    { id: 'pc', label: 'PC', x: L.pcX, y: L.spineY - 22, w: 40, h: 44 },
    // "+4n", not "+4": this machine advances the fetch pointer by four bytes PER INSTRUCTION
    // FETCHED, and that count runs from 1 to the issue width depending on how many IF slots were
    // free — so a hard "+8" would be wrong on exactly the cycles a stall makes interesting, and at
    // width 4 it would be wrong most of the time. The wire out of it carries the real number from
    // the trace, which is where a reader gets the actual value.
    { id: 'addn', label: '+4n', x: L.imemX, y: L.spineY - 132, w: 58, h: 48, shape: 'adder' },
    { id: 'imem', label: 'Instr\nMem', x: L.imemX, y: L.spineY - 40, w: IMEM_W, h: 80 },
    { id: 'ifid', label: 'IF\n/\nID', x: L.ifidX, y: L.barTop, w: 16, h: L.barH },
    // --- ID (shared): issue/pairing, hazard detection, the register file, the bet adder ---------
    // THE MODEL'S SOUL, drawn. It answers "may these go together?" and its refusal reason is what
    // the pairing readout names. No `minTier`: like the bet adder and unlike the forwarding unit,
    // this is not an optimization detail the skeleton may omit — it is the machine.
    { id: 'issue', label: 'Issue\n/ pair', x: L.idX, y: L.issueY, w: 112, h: 44, minWidth: 2, controlLabel: 'IssueSlots' }, // prettier-ignore
    { id: 'hazard', label: 'Hazard\ndetect', x: L.idX, y: L.hazardY, w: 112, h: 44, minTier: 'expert', controlLabel: 'PCWrite / IF-ID-Write' }, // prettier-ignore
    // ONE register file, with `2n` read ports and `n` write ports. The box is shared and
    // hue-neutral (it is read by every lane's ID and written by every lane's WB in the same cycle);
    // the PORTS are the wires, and those are lane-tagged. That is the honest split — a superscalar
    // does not grow a second register file, however wide it gets. Its EDGE is what has to carry the
    // widening, which is why the anchors are spread rather than hand-placed.
    { id: 'regfile', label: 'Registers', x: L.idX, y: L.regfileY, w: 112, h: 140 },
    // The BET's adder — single by the branch-slot rule (EX resolves at most one transfer a cycle),
    // but fed from EVERY lane's sign-extender, since the betting branch may sit in any slot.
    // Proportioned near-square so the P&H notch reads as an adder (M4 step 5's browser finding).
    { id: 'btarget', label: 'Branch\ntarget', x: L.idX, y: L.btargetY, w: 80, h: 54, shape: 'adder', predictTakenOnly: true }, // prettier-ignore
    { id: 'idex', label: 'ID\n/\nEX', x: L.idexX, y: L.barTop, w: 16, h: L.barH },
    { id: 'exmem', label: 'EX\n/\nMEM', x: L.exmemX, y: L.barTop, w: 16, h: L.barH },
    // --- MEM (shared, and single by RULE): one data memory, one port --------------------------
    // The mem-port refusal is what keeps this box single, and it pays for itself several times
    // over: one memory means one cache, one miss-freeze and one address stream, so nothing about
    // width can reorder memory. Drawing a second data memory would draw hardware the rules forbid.
    { id: 'dmem', label: 'Data\nMem', x: L.dmemX, y: L.spineY - 46, w: 92, h: 92 },
    { id: 'memwb', label: 'MEM\n/\nWB', x: L.memwbX, y: L.barTop, w: 16, h: L.barH },
  ];
}

/** Lane `n`'s replicated hardware. Everything in the EX band sits on a fixed pitch (`LANE_DY`);
 *  the sign-extender sits in the shared ID band, on the same pitch, which is what lets the
 *  translation litmus cover the ID band too rather than exempting it as a hand-placed exception. */
function laneNodes(L: Layout, lane: Lane): DatapathNode[] {
  const ly = L.laneTop(lane);
  const s = String(lane);
  return [
    { id: laneId('signext', lane), label: `Sign\nExtend ${s}`, x: L.idX, y: L.sextY(lane), w: 100, h: 38, lane }, // prettier-ignore
    { id: laneId('fwdunit', lane), label: `Forwarding\nunit ${s}`, x: L.fwdunitX, y: ly, w: L.fwdunitW, h: 38, lane, minTier: 'expert', forwardingOnly: true }, // prettier-ignore
    { id: laneId('fwdmuxa', lane), label: '', x: L.fwdmuxX, y: ly + 58, w: 18, h: 56, shape: 'mux', lane, minTier: 'expert', forwardingOnly: true, controlLabel: `ForwardA${s}` }, // prettier-ignore
    { id: laneId('fwdmuxb', lane), label: '', x: L.fwdmuxX, y: ly + 126, w: 18, h: 56, shape: 'mux', lane, minTier: 'expert', forwardingOnly: true, controlLabel: `ForwardB${s}` }, // prettier-ignore
    { id: laneId('alu', lane), label: `ALU ${s}`, x: L.aluX, y: ly + 54, w: ALU_W, h: 132, shape: 'adder', lane }, // prettier-ignore
    // The dedicated pc/immediate adder, REPLICATED — settled by dumping a trace, not by reasoning:
    // two `lui`s co-issue, and U/J producers emit no `alu-op`, so EVERY lane can need it at once.
    { id: laneId('pcarith', lane), label: `PC\narith ${s}`, x: L.aluX, y: ly + 212, w: 68, h: 48, shape: 'adder', lane }, // prettier-ignore
    { id: laneId('wbmux', lane), label: '', x: L.wbmuxX, y: ly + 64, w: 18, h: 100, shape: 'mux', lane, minTier: 'detailed', controlLabel: `MemtoReg${s}` }, // prettier-ignore
  ];
}

/** Anchor helpers, bound to ONE geometry's node map. They were module-level constants until M13;
 *  binding them to a map is what lets four differently-sized machines share one derivation. */
function anchors(nodes: ReadonlyMap<string, DatapathNode>) {
  /** Anchor a point on a node's edge. l/r = side midpoints + `off`; t/b = top/bottom edge + `off`
   *  along it. For adders use `aUp`/`aLo` (left operand stubs) and `r` (output). */
  const at = (id: string, side: 'l' | 'r' | 't' | 'b', off = 0): Pt => {
    const nd = nodes.get(id)!;
    switch (side) {
      case 'l':
        return [nd.x, nd.y + nd.h / 2 + off];
      case 'r':
        return [nd.x + nd.w, nd.y + nd.h / 2 + off];
      case 't':
        return [nd.x + nd.w / 2 + off, nd.y];
      case 'b':
        return [nd.x + nd.w / 2 + off, nd.y + nd.h];
    }
  };
  /** A point on a latch BAR's left/right edge at an absolute `y`. The bars span the whole lane
   *  stack, so centre-relative offsets would be unreadable; the y is the honest coordinate. */
  const bar = (id: string, side: 'l' | 'r', y: number): Pt => {
    const nd = nodes.get(id)!;
    return [side === 'l' ? nd.x : nd.x + nd.w, y];
  };
  /** An adder's upper / lower left operand stub; `off` slides along that stub's vertical edge. */
  const aUp = (id: string, off = 0): Pt => {
    const nd = nodes.get(id)!;
    return [nd.x, nd.y + nd.h * 0.16 + off];
  };
  const aLo = (id: string, off = 0): Pt => {
    const nd = nodes.get(id)!;
    return [nd.x, nd.y + nd.h * 0.84 + off];
  };
  const upY = (id: string, off = 0): number => aUp(id, off)[1];
  const loY = (id: string, off = 0): number => aLo(id, off)[1];
  return { at, bar, aUp, aLo, upY, loY };
}

function sharedWires(L: Layout, A: ReturnType<typeof anchors>): DatapathWire[] {
  const { at, bar, aUp, aLo, upY } = A;
  return [
    // --- IF: the selected pc addresses the instruction memory ---------------------------------
    { id: 'pcmux-pc', ends: ['pcmux', 'pc'], points: [at('pcmux', 'r'), at('pc', 'l')] }, // prettier-ignore
    { id: 'pc-imem', ends: ['pc', 'imem'], points: [at('pc', 'r'), at('imem', 'l')] }, // prettier-ignore
    { id: 'pc-addn', ends: ['pc', 'addn'], points: [at('pc', 't', -10), [L.pcX + 10, A.loY('addn')], aLo('addn')] }, // prettier-ignore
    { id: 'addn-pcmux', ends: ['addn', 'pcmux'], points: [at('addn', 'r'), [L.seqCh, at('addn', 'r')[1]], [L.seqCh, L.rail.seq], [L.leftCh[0]!, L.rail.seq], [L.leftCh[0]!, L.spineY + L.pcmuxOff(0)], at('pcmux', 'l', L.pcmuxOff(0))] }, // prettier-ignore
    // --- ID: the ISSUE unit — the pairing verdict, and the machine's soul ----------------------
    // It reads the fetch group out of IF/ID and answers by holding the ones it refused, which is
    // what a refusal LOOKS like: the refused instructions sit in ID for a second cycle and lead
    // the next group. Width-2-and-up only (see the node's `minWidth`).
    { id: 'ifid-issue', ends: ['ifid', 'issue'], points: [bar('ifid', 'r', at('issue', 'l')[1]), at('issue', 'l')], minWidth: 2 }, // prettier-ignore
    { id: 'issue-ifid', ends: ['issue', 'ifid'], points: [at('issue', 'l', 14), bar('ifid', 'r', at('issue', 'l', 14)[1])], minWidth: 2 }, // prettier-ignore
    { id: 'issue-pc', ends: ['issue', 'pc'], points: [at('issue', 't', -20), [at('issue', 't', -20)[0], L.rail.issuePc], [at('pc', 't', 10)[0], L.rail.issuePc], at('pc', 't', 10)], minWidth: 2 }, // prettier-ignore
    // --- ID: the hazard unit — width-INDEPENDENT, because a RAW against an older stage is the
    // same question however many instructions travel abreast. It scans every SLOT of the two older
    // stages, which at width 1 is M3's pair of singleton tests.
    { id: 'ifid-hazard', ends: ['ifid', 'hazard'], points: [bar('ifid', 'r', at('hazard', 'l')[1]), at('hazard', 'l')] }, // prettier-ignore
    { id: 'idex-hazard', ends: ['idex', 'hazard'], points: [bar('idex', 'l', at('hazard', 'r', -16)[1]), at('hazard', 'r', -16)] }, // prettier-ignore
    { id: 'hazard-ifid', ends: ['hazard', 'ifid'], points: [at('hazard', 'l', 14), bar('ifid', 'r', at('hazard', 'l', 14)[1])] }, // prettier-ignore
    { id: 'hazard-pc', ends: ['hazard', 'pc'], points: [at('hazard', 'r', -4), [L.ctrlCh, at('hazard', 'r', -4)[1]], [L.ctrlCh, L.rail.hazardPc], [at('pc', 't', 18)[0], L.rail.hazardPc], at('pc', 't', 18)] }, // prettier-ignore
    // --- ID: the BET — single by the branch-slot rule, fed from any lane's sign-extender --------
    { id: 'ifid-btarget', ends: ['ifid', 'btarget'], points: [bar('ifid', 'r', upY('btarget')), aUp('btarget')], predictTakenOnly: true }, // prettier-ignore
    { id: 'btarget-pcmux', ends: ['btarget', 'pcmux'], points: [at('btarget', 'r'), [L.betCh, at('btarget', 'r')[1]], [L.betCh, L.rail.bet], [L.leftCh[1]!, L.rail.bet], [L.leftCh[1]!, L.spineY + L.pcmuxOff(1)], at('pcmux', 'l', L.pcmuxOff(1))], predictTakenOnly: true }, // prettier-ignore
    // --- MEM: EX/MEM addresses the ONE data memory; a load's datum returns to MEM/WB -----------
    // Shared and unslotted, and that is the mem-port rule paying out: at most one instruction per
    // cycle can be here, so there is nothing to disambiguate. Whichever lane's instruction it is
    // lights these wires, and the follow-ring resolves it by id.
    { id: 'exmem-dmem-addr', ends: ['exmem', 'dmem'], points: [bar('exmem', 'r', L.spineY - 20), at('dmem', 'l', -20)] }, // prettier-ignore
    { id: 'exmem-dmem-data', ends: ['exmem', 'dmem'], points: [bar('exmem', 'r', L.spineY + 20), at('dmem', 'l', 20)] }, // prettier-ignore
    { id: 'dmem-memwb', ends: ['dmem', 'memwb'], points: [at('dmem', 'r'), bar('memwb', 'l', L.spineY)] }, // prettier-ignore
  ];
}

/** Lane `lane`'s replicated wiring. */
function laneWires(L: Layout, A: ReturnType<typeof anchors>, lane: Lane): DatapathWire[] {
  const { at, bar, aUp, aLo, upY, loY } = A;
  // Every coordinate below is derived from the NODES this lane already placed (via `at`/`aUp`/
  // `aLo`), never from the lane pitch again — so a node that moves drags its wires with it instead
  // of silently detaching, which is the failure the "endpoint sits on its node's drawn edge" litmus
  // exists to catch and the reason the first draft of this file failed it twelve times.
  const Lx = (base: string): string => laneId(base, lane);
  const n = L.n;
  const { side, rails } = fwdRails(L, lane);
  const [r0, r1, r2, r3, r4] = [rails[0]!, rails[1]!, rails[2]!, rails[3]!, rails[4]!];
  // A lane's four channels within its side's block. The two sides REUSE these x values, which is
  // sound only because a top-side lane's runs and a bottom-side lane's never overlap in y.
  const onSide = side === 't' ? lane : lane - L.topLanes;
  const base = 5 * onSide;
  const conBase = 4 * onSide;
  // Where this lane's returns LEAVE the latch bar's outboard edge. Per-lane, and that is a M13
  // finding rather than tidiness: until four lanes existed the two lanes sat on opposite sides of
  // the diagram, so both could leave at the same offset and never meet. Two lanes sharing a side
  // leave from the same edge and climb to DIFFERENT rails - so with one offset their stubs run
  // collinearly from the bar to the nearer rail, which is two wires drawn as one. Three families
  // now (the `a` operand, the `b` operand, and the forwarding unit's own MEM/WB comparison), so the
  // offsets are spread across the bar's 16px rather than picked.
  const perSide = Math.max(L.topLanes, 1);
  const stubOf = (family: number): number =>
    perSide * 3 <= 1 ? 0 : -7 + (14 * (3 * onSide + family)) / (perSide * 3 - 1);
  const stubA = stubOf(0);
  const stubB = stubOf(1);
  const stubC = stubOf(2);
  const [ch0, ch1, ch2, ch3, ch4] = [L.fwdCh[base]!, L.fwdCh[base + 1]!, L.fwdCh[base + 2]!, L.fwdCh[base + 3]!, L.fwdCh[base + 4]!]; // prettier-ignore
  const [con0, con1, con2, con3] = [L.conCh[conBase]!, L.conCh[conBase + 1]!, L.conCh[conBase + 2]!, L.conCh[conBase + 3]!]; // prettier-ignore
  const fwdmuxa = Lx('fwdmuxa');
  const fwdmuxb = Lx('fwdmuxb');
  const alu = Lx('alu');
  const pcarith = Lx('pcarith');
  const wbmux = Lx('wbmux');
  const signext = Lx('signext');
  // Register-file read ports climb (top side) or drop (bottom side) out of the shared file into the
  // lane's own band, each on its own channel so no two ports ever share a vertical run.
  const portY = (port: number): number => L.laneTop(lane) + 90 + 20 * port;
  const readOff = (port: number): number => spread(2 * n, 2 * lane + port, 120);
  const reqOff = spread(2 * n, lane, 120);
  const writeOff = spread(2 * n, n + lane, 120);
  const regWriteY = at('regfile', 'l', writeOff)[1];
  // Each lane's bet-immediate lands on its own point along the adder's lower stub, so `n` runs
  // arrive at `n` places rather than stacking on one.
  const betOff = (lane - (n - 1) / 2) * 5;

  return [
    // --- IF: the fetched group, one word per slot --------------------------------------------
    // `n` wires out of ONE instruction memory: a superscalar fetches a group from consecutive
    // addresses in a cycle. Both endpoints are shared nodes, which is precisely why the LANE has to
    // be declared on the wire — `ends` cannot say which word of the group this is.
    { id: Lx('imem-ifid'), ends: ['imem', 'ifid'], points: [at('imem', 'r', spread(n, lane, 56)), bar('ifid', 'l', L.spineY + spread(n, lane, 56))], lane }, // prettier-ignore

    // --- ID: this lane's decode — register reads and its own sign-extender --------------------
    { id: Lx('ifid-regfile'), ends: ['ifid', 'regfile'], points: [bar('ifid', 'r', at('regfile', 'l', reqOff)[1]), at('regfile', 'l', reqOff)], lane }, // prettier-ignore
    { id: Lx('ifid-signext'), ends: ['ifid', signext], points: [bar('ifid', 'r', at(signext, 'l')[1]), at(signext, 'l')], lane }, // prettier-ignore
    { id: Lx('signext-idex'), ends: [signext, 'idex'], points: [at(signext, 'r'), bar('idex', 'l', at(signext, 'r')[1])], lane }, // prettier-ignore
    { id: Lx('regfile-idex-a'), ends: ['regfile', 'idex'], points: [at('regfile', 'r', readOff(0)), [L.portCh(lane, 0), at('regfile', 'r', readOff(0))[1]], [L.portCh(lane, 0), portY(0)], bar('idex', 'l', portY(0))], lane }, // prettier-ignore
    { id: Lx('regfile-idex-b'), ends: ['regfile', 'idex'], points: [at('regfile', 'r', readOff(1)), [L.portCh(lane, 1), at('regfile', 'r', readOff(1))[1]], [L.portCh(lane, 1), portY(1)], bar('idex', 'l', portY(1))], lane }, // prettier-ignore
    // Any lane's immediate can feed the single bet adder — the betting branch may sit in any slot
    // (observed, not assumed: `branch-flavors.s` bets from slot 1 throughout). At most one is ever
    // lit, because the branch-slot rule caps the cycle at one transfer.
    { id: Lx('signext-btarget'), ends: [signext, 'btarget'], points: [at(signext, 'r', -12), [L.cornerX(lane), at(signext, 'r', -12)[1]], [L.cornerX(lane), L.cornerY(lane)], [L.idCh[lane]!, L.cornerY(lane)], [L.idCh[lane]!, loY('btarget', betOff)], aLo('btarget', betOff)], lane, predictTakenOnly: true }, // prettier-ignore

    // --- EX: this lane's forwarding network, ALU and pc/immediate adder -----------------------
    { id: Lx('idex-fwdmuxa'), ends: ['idex', fwdmuxa], points: [bar('idex', 'r', at(fwdmuxa, 'l')[1]), at(fwdmuxa, 'l')], lane }, // prettier-ignore
    { id: Lx('idex-fwdmuxb'), ends: ['idex', fwdmuxb], points: [bar('idex', 'r', at(fwdmuxb, 'l')[1]), at(fwdmuxb, 'l')], lane }, // prettier-ignore
    { id: Lx('exmem-fwdmuxa'), ends: ['exmem', fwdmuxa], points: [at('exmem', side, stubA), [at('exmem', side, stubA)[0], r0], [ch0, r0], [ch0, at(fwdmuxa, 'l', 22)[1]], at(fwdmuxa, 'l', 22)], lane }, // prettier-ignore
    { id: Lx('memwb-fwdmuxa'), ends: ['memwb', fwdmuxa], points: [at('memwb', side, stubA), [at('memwb', side, stubA)[0], r1], [ch1, r1], [ch1, at(fwdmuxa, 'l', -22)[1]], at(fwdmuxa, 'l', -22)], lane }, // prettier-ignore
    { id: Lx('exmem-fwdmuxb'), ends: ['exmem', fwdmuxb], points: [at('exmem', side, stubB), [at('exmem', side, stubB)[0], r2], [ch2, r2], [ch2, at(fwdmuxb, 'l', 22)[1]], at(fwdmuxb, 'l', 22)], lane }, // prettier-ignore
    { id: Lx('memwb-fwdmuxb'), ends: ['memwb', fwdmuxb], points: [at('memwb', side, stubB), [at('memwb', side, stubB)[0], r3], [ch3, r3], [ch3, at(fwdmuxb, 'l', -22)[1]], at(fwdmuxb, 'l', -22)], lane }, // prettier-ignore
    { id: Lx('fwdmuxa-alu'), ends: [fwdmuxa, alu], points: [at(fwdmuxa, 'r'), [L.muxOutCh, at(fwdmuxa, 'r')[1]], [L.muxOutCh, upY(alu)], aUp(alu)], lane }, // prettier-ignore
    { id: Lx('fwdmuxb-alu'), ends: [fwdmuxb, alu], points: [at(fwdmuxb, 'r'), [L.muxOutCh, at(fwdmuxb, 'r')[1]], [L.muxOutCh, loY(alu)], aLo(alu)], lane }, // prettier-ignore
    // The forwarding unit compares this lane's sources against EVERY slot of the two latches ahead
    // of it — the source set is what genuinely grows with the width, and the unit is per-lane
    // because each lane asks the question about its own operands.
    { id: Lx('idex-fwdunit'), ends: ['idex', Lx('fwdunit')], points: [bar('idex', 'r', at(Lx('fwdunit'), 'l')[1]), at(Lx('fwdunit'), 'l')], lane }, // prettier-ignore
    { id: Lx('exmem-fwdunit'), ends: ['exmem', Lx('fwdunit')], points: [bar('exmem', 'l', at(Lx('fwdunit'), 'r')[1]), at(Lx('fwdunit'), 'r')], lane }, // prettier-ignore
    { id: Lx('memwb-fwdunit'), ends: ['memwb', Lx('fwdunit')], points: [at('memwb', side, stubC), [at('memwb', side, stubC)[0], r4], [ch4, r4], [ch4, at(Lx('fwdunit'), 'l', 10)[1]], at(Lx('fwdunit'), 'l', 10)], lane }, // prettier-ignore
    // The three CONTRACTIONS per operand port — one per source, sharing their through-wire's rail
    // because the two are never co-visible. Each lands on its own y along the ALU's operand stub.
    { id: Lx('idex-alu-a'), ends: ['idex', alu], points: [bar('idex', 'r', upY(alu)), aUp(alu)], lane, contracts: fwdmuxa }, // prettier-ignore
    { id: Lx('exmem-alu-a'), ends: ['exmem', alu], points: [at('exmem', side, stubA), [at('exmem', side, stubA)[0], r0], [con0, r0], [con0, upY(alu, -12)], aUp(alu, -12)], lane, contracts: fwdmuxa, forwardingOnly: true }, // prettier-ignore
    { id: Lx('memwb-alu-a'), ends: ['memwb', alu], points: [at('memwb', side, stubA), [at('memwb', side, stubA)[0], r1], [con1, r1], [con1, upY(alu, 12)], aUp(alu, 12)], lane, contracts: fwdmuxa, forwardingOnly: true }, // prettier-ignore
    { id: Lx('idex-alu-b'), ends: ['idex', alu], points: [bar('idex', 'r', loY(alu)), aLo(alu)], lane, contracts: fwdmuxb }, // prettier-ignore
    { id: Lx('exmem-alu-b'), ends: ['exmem', alu], points: [at('exmem', side, stubB), [at('exmem', side, stubB)[0], r2], [con2, r2], [con2, loY(alu, -12)], aLo(alu, -12)], lane, contracts: fwdmuxb, forwardingOnly: true }, // prettier-ignore
    { id: Lx('memwb-alu-b'), ends: ['memwb', alu], points: [at('memwb', side, stubB), [at('memwb', side, stubB)[0], r3], [con3, r3], [con3, loY(alu, 12)], aLo(alu, 12)], lane, contracts: fwdmuxb, forwardingOnly: true }, // prettier-ignore
    { id: Lx('alu-exmem'), ends: [alu, 'exmem'], points: [at(alu, 'r'), bar('exmem', 'l', at(alu, 'r')[1])], lane }, // prettier-ignore
    { id: Lx('idex-pcarith-pc'), ends: ['idex', pcarith], points: [bar('idex', 'r', upY(pcarith)), aUp(pcarith)], lane }, // prettier-ignore
    { id: Lx('idex-pcarith-imm'), ends: ['idex', pcarith], points: [bar('idex', 'r', loY(pcarith)), aLo(pcarith)], lane }, // prettier-ignore
    { id: Lx('pcarith-exmem'), ends: [pcarith, 'exmem'], points: [at(pcarith, 'r'), bar('exmem', 'l', at(pcarith, 'r')[1])], lane }, // prettier-ignore
    // The two EX corrections, per lane. A pc-relative transfer redirects from this lane's pc adder;
    // `jalr` alone from its ALU, because a REGISTER supplies the target. At most one of the `2n` is
    // ever lit — the branch-slot rule — but which lane it is is not knowable from the geometry.
    { id: Lx('pcarith-pcmux'), ends: [pcarith, 'pcmux'], points: [at(pcarith, 'r', 8), [L.pcarithCh(lane), at(pcarith, 'r', 8)[1]], [L.pcarithCh(lane), L.rail.redirect[lane]!], [L.leftCh[lane]!, L.rail.redirect[lane]!], [L.leftCh[lane]!, L.spineY + L.pcmuxOff(2 + lane)], at('pcmux', 'l', L.pcmuxOff(2 + lane))], lane }, // prettier-ignore
    { id: Lx('alu-pcmux'), ends: [alu, 'pcmux'], points: [at(alu, 'r', 20), [L.aluCh(lane), at(alu, 'r', 20)[1]], [L.aluCh(lane), L.rail.redirect[n + lane]!], [L.leftCh[n + lane]!, L.rail.redirect[n + lane]!], [L.leftCh[n + lane]!, L.spineY + L.pcmuxOff(2 + n + lane)], at('pcmux', 'l', L.pcmuxOff(2 + n + lane))], lane }, // prettier-ignore

    // --- MEM: everything that is not a load rides PAST the memory, one bypass per slot ---------
    // Replicated after dumping a trace: two non-memory instructions really do sit in `MEM.0`/`MEM.1`
    // and bypass together. Unlabelled by necessity — the value was computed while the instruction
    // was in EX a cycle ago, so no event in THIS trace holds it.
    { id: Lx('exmem-memwb'), ends: ['exmem', 'memwb'], points: [bar('exmem', 'r', L.laneTop(lane) + 82), bar('memwb', 'l', L.laneTop(lane) + 82)], lane }, // prettier-ignore

    // --- WB: this lane's write port, and the bus home to the shared register file --------------
    { id: Lx('memwb-wbmux-val'), ends: ['memwb', wbmux], points: [bar('memwb', 'r', at(wbmux, 'l', -24)[1]), at(wbmux, 'l', -24)], lane }, // prettier-ignore
    { id: Lx('memwb-wbmux-mdr'), ends: ['memwb', wbmux], points: [bar('memwb', 'r', at(wbmux, 'l', 24)[1]), at(wbmux, 'l', 24)], lane }, // prettier-ignore
    { id: Lx('wbmux-regfile'), ends: [wbmux, 'regfile'], points: [at(wbmux, 'r'), [L.wbCh(lane), at(wbmux, 'r')[1]], [L.wbCh(lane), L.rail.wb[lane]!], [L.idCh[n + lane]!, L.rail.wb[lane]!], [L.idCh[n + lane]!, regWriteY], at('regfile', 'l', writeOff)], lane }, // prettier-ignore
    { id: Lx('memwb-regfile'), ends: ['memwb', 'regfile'], points: [bar('memwb', 'r', at(wbmux, 'l', 24)[1]), [L.wbConCh(lane), at(wbmux, 'l', 24)[1]], [L.wbConCh(lane), L.rail.wb[lane]!], [L.idCh[n + lane]!, L.rail.wb[lane]!], [L.idCh[n + lane]!, regWriteY], at('regfile', 'l', writeOff)], lane, contracts: wbmux }, // prettier-ignore
  ];
}

/** Build the geometry for an `n`-lane machine. */
function buildGeometry(n: number): Geometry {
  const L = layout(n);
  const lanes = LANES.filter((lane) => lane < n);
  const nodeList = [...sharedNodes(L), ...lanes.flatMap((lane) => laneNodes(L, lane))];
  const nodes = new Map(nodeList.map((nd) => [nd.id, nd]));
  const A = anchors(nodes);
  const wires = [...sharedWires(L, A), ...lanes.flatMap((lane) => laneWires(L, A, lane))];
  return { canvas: L.canvas, nodes, wires };
}

const GEOMETRIES = new Map<number, Geometry>();

/**
 * The geometry of an `issueWidth`-lane machine — memoized, since there are only
 * {@link MAX_WIDTH} of them and each is a pure function of its width.
 *
 * Width is the one visibility axis that changes the CANVAS, which is why it is a parameter here
 * rather than a filter in {@link nodeVisibleAt}. Tier, forwarding and prediction only ever REMOVE
 * interior detail, so they can be filtered out of a fixed drawing; lanes change how tall the
 * machine is, and a fixed drawing would have to be sized for the widest — leaving a width-1
 * machine as one lane at the top of a canvas that is mostly empty, with latch bars spanning three
 * lanes it does not have.
 */
export function geometryFor(issueWidth: number): Geometry {
  const n = Math.max(1, Math.min(MAX_WIDTH, Math.trunc(issueWidth)));
  let g = GEOMETRIES.get(n);
  if (!g) {
    g = buildGeometry(n);
    GEOMETRIES.set(n, g);
  }
  return g;
}

/**
 * The FULL lane universe — the widest machine's geometry. Two different jobs need it, and neither
 * is "what to draw":
 *   - {@link activate} is width-oblivious (INV-2) and lights wires for whatever the trace holds, so
 *     the wire id it looks up must exist at every width or it throws.
 *   - the "absent, never idle" litmus has to be asked of a set that CONTAINS the lanes it claims
 *     are hidden. Asking it of `geometryFor(1)` would be vacuous — the filter would return nothing
 *     and the loop body would never run.
 */
export const CANVAS = geometryFor(MAX_WIDTH).canvas;
export const NODES: ReadonlyMap<string, DatapathNode> = geometryFor(MAX_WIDTH).nodes;
export const WIRES: readonly DatapathWire[] = geometryFor(MAX_WIDTH).wires;

const WIRE_BY_ID: ReadonlyMap<string, DatapathWire> = new Map(WIRES.map((w) => [w.id, w]));

// --- Depth tiers × config -------------------------------------------------------------------

/** True when an element requiring `minTier` (absent ⇒ `essentials`) is drawn at `current`. */
export function tierVisible(minTier: DepthTier | undefined, current: DepthTier): boolean {
  return DEPTH_TIERS.indexOf(minTier ?? 'essentials') <= DEPTH_TIERS.indexOf(current);
}

/**
 * The engine BEHAVIORS the diagram's structure depends on — deliberately not the config's values.
 *
 * `forwarding` and `issueWidth` are already behaviors, so they pass through. `predictTaken` is
 * where the difference bites: `ProcessorConfig.branchPrediction` has three NAMES and the machine has
 * two BEHAVIORS (`'none'` and `'static-not-taken'` are one machine — a processor with no predictor
 * does not wait, it keeps fetching, and the fall-through IS the not-taken path). Geometry cannot be
 * drawn from a name that does not decide anything, so the shell collapses that knob once, at its
 * edge, and hands the diagram the fact: does this machine bet?
 */
export interface DatapathConfig {
  readonly forwarding: boolean;
  readonly predictTaken: boolean;
  /** 1 to {@link MAX_WIDTH} — the third structural axis, and the only one that adds hardware rather
   *  than removing detail. `ProcessorConfig.issueWidth` is optional (`?: number`) for every pre-M7
   *  model, so the shell resolves it to 1 before it reaches here. */
  readonly issueWidth: number;
}

/** Whether a node is drawn, on ALL THREE axes: deep enough a tier, on the right side of whichever
 *  config gate it sets, and inside a machine wide enough to contain it. */
export function nodeVisibleAt(node: DatapathNode, tier: DepthTier, cfg: DatapathConfig): boolean {
  if (!tierVisible(node.minTier, tier)) return false;
  if (node.forwardingOnly && !cfg.forwarding) return false;
  if (node.predictTakenOnly && !cfg.predictTaken) return false;
  if (requiredWidth(node) > cfg.issueWidth) return false;
  return true;
}

/**
 * Whether a wire is drawn at (`tier`, `cfg`): deep enough a tier, on the right side of every config
 * gate, NOT superseded by the unit it contracts, and with both endpoint nodes drawn — so no wire
 * ever dangles into a hidden unit (INV-5).
 *
 * The contraction rule is the load-bearing one and it is DERIVED rather than declared: a
 * contraction stands in for its unit exactly when that unit is not drawn. That now covers THREE
 * axes at once without a second hand-maintained field having to agree with this one.
 *
 * The endpoint lookup goes through the FULL node universe rather than the drawn geometry, so this
 * answers the same question whether it is asked of `geometryFor(w)`'s wires or of all of them.
 */
export function wireVisibleAt(wire: DatapathWire, tier: DepthTier, cfg: DatapathConfig): boolean {
  if (!tierVisible(wire.minTier, tier)) return false;
  if (wire.forwardingOnly && !cfg.forwarding) return false;
  if (wire.predictTakenOnly && !cfg.predictTaken) return false;
  if (requiredWidth(wire) > cfg.issueWidth) return false;
  if (wire.contracts && nodeVisibleAt(NODES.get(wire.contracts)!, tier, cfg)) return false;
  return wire.ends.every((id) => nodeVisibleAt(NODES.get(id)!, tier, cfg));
}

/** Whether active wires carry their value labels at `tier` (everything except `essentials`). */
export function showValueLabels(tier: DepthTier): boolean {
  return tier !== 'essentials';
}

/** Whether units show their control-line label at `tier` (`expert` only). */
export function showControlLabels(tier: DepthTier): boolean {
  return tier === 'expert';
}

// --- Activation -------------------------------------------------------------------------------

/** How a value should be rendered on a wire label. */
export type Fmt = 'hex' | 'dec';

/** A lit wire. A cycle lights wires for up to TEN different instructions, so each one says who lit
 *  it, from which stage (the hue), and in which issue slot (the lane it was drawn for). */
export interface WireActivation {
  /** The stable id (INV-4) of the instruction whose work this wire is doing. */
  readonly instr: string;
  /** The stage that instruction is in — which is what picks the wire's hue. */
  readonly stage: Stage;
  /** The issue slot that instruction occupies this cycle. Equal to the wire's `lane` for every
   *  replicated wire; on a SHARED wire it names whichever slot's instruction happens to be using
   *  the shared unit (the one data memory, the one bet adder). */
  readonly slot: number;
  /** The value flowing, when THIS cycle's events know it. Absent is honest: a value riding a latch
   *  between stages was emitted in an earlier cycle and is not in this trace (see the file docs). */
  readonly value?: number;
  readonly fmt: Fmt;
}

/** The pairing verdict this cycle, when the issue unit refused someone. */
export interface Refusal {
  /** `mem-port` / `branch-slot` / `intra-pair-raw` — the three pairing reasons. */
  readonly reason: string;
  /** The instruction that was refused, and so leads the next issue group. */
  readonly instr: string;
}

export interface DatapathActivation {
  /** Which instruction occupies each `"<stage>.<slot>"` this cycle — from `instructions[].location`,
   *  the only source that describes THIS cycle (see the file docs on `micro`). Up to ten entries. */
  readonly occupancy: ReadonlyMap<string, string>;
  /** Ids of components on an active path this cycle. Deliberately a plain set, with no instruction
   *  attached: a component can be busy for TWO instructions at once — the register file is read by
   *  both lanes' ID and written by both lanes' WB in one cycle, and every latch bar is written by
   *  the stage on its left while the stage on its right reads it. The WIRES carry the attribution. */
  readonly components: ReadonlySet<string>;
  /** Active wire id → who lit it, from where, in which slot, and with what value. */
  readonly wires: ReadonlyMap<string, WireActivation>;
  /** The registers the writeback ports target this cycle — up to one per lane. */
  readonly writtenRegs: readonly number[];
  /** The pairing refusal this cycle, or `null`. Step 8's readout names this; the datapath uses it
   *  to light the issue unit, which is the drawn CAUSE of the "one lane lit, one dark" picture. */
  readonly refusal: Refusal | null;
}

const EMPTY: DatapathActivation = {
  occupancy: new Map(),
  components: new Set(),
  wires: new Map(),
  writtenRegs: [],
  refusal: null,
};

const LOADS = new Set(['lb', 'lh', 'lw', 'lbu', 'lhu']);
const STORES = new Set(['sb', 'sh', 'sw']);
/** The classes whose writeback value comes from the dedicated pc/immediate adder rather than the
 *  ALU — they emit no `alu-op` at all (the engine mirrors the reference's event set). */
const PCARITH_PRODUCERS = new Set(['lui', 'auipc', 'jal', 'jalr']);
/**
 * The three PAIRING refusals, which the issue unit answers — as distinct from `load-use` / `raw`,
 * which are the ordinary older-stage hazards the separate hazard unit answers. Both ride
 * `stall.reason` (the schema types it as a free-form string, so the three cost no schema change),
 * and this set is the only thing that tells the two units apart. It matches `issueVerdict`'s three
 * pairing rules exactly; a reason missing here would silently light the hazard unit instead.
 */
export const PAIRING_REASONS: ReadonlySet<string> = new Set([
  'mem-port',
  'branch-slot',
  'intra-pair-raw',
]);

/**
 * Derive which datapath components/wires are active THIS cycle, for EVERY instruction in flight,
 * and the value on each. Multi-instruction AND multi-lane: each `"<stage>.<slot>"`'s occupant comes
 * from `instructions[].location` and its values from this cycle's `events` filtered by that
 * instruction's id — never from `state.micro`, which is a cycle ahead (see the file docs).
 *
 * Both the expert through-mux wires AND their contraction wires are lit, at every width and in
 * every config (activation is tier-, config- and WIDTH-oblivious, INV-2); the view filters. A
 * width-1 trace simply never has a `.1` occupant, so lane 1 lights nothing of its own accord —
 * which is why the width axis needs no special case here. Returns an empty activation for the
 * pre-run state.
 */
export function activate(trace: CycleTrace | null): DatapathActivation {
  if (!trace) return EMPTY;

  const occupancy = new Map<string, string>();
  /** `stage → slot → occupant`. */
  const byStage = new Map<Stage, (InstructionInstance | undefined)[]>();
  for (const inst of trace.instructions) {
    const loc = parseLocation(inst.location);
    if (!loc) continue;
    const slots = byStage.get(loc.stage) ?? new Array<InstructionInstance | undefined>(MAX_WIDTH);
    // One instruction per (stage, slot); first wins, defensively — the engine guarantees it.
    if (slots[loc.slot] === undefined) {
      slots[loc.slot] = inst;
      occupancy.set(inst.location, inst.id);
    }
    byStage.set(loc.stage, slots);
  }
  if (byStage.size === 0) return EMPTY;

  const components = new Set<string>();
  const wires = new Map<string, WireActivation>();
  const writtenRegs: number[] = [];

  const occupant = (stage: Stage, slot: number): InstructionInstance | undefined =>
    byStage.get(stage)?.[slot];

  const c = (id: string): void => void components.add(id);
  /** Light a wire for `inst`'s work in `stage`/`slot`, and (as every model here does) light both
   *  its endpoints — which is what makes the coherence litmus hold by construction rather than by
   *  vigilance. */
  const w = (
    id: string,
    stage: Stage,
    slot: number,
    inst: InstructionInstance,
    value: number | undefined,
    fmt: Fmt,
  ): void => {
    const wire = WIRE_BY_ID.get(id);
    if (!wire) throw new Error(`activate: unknown wire id "${id}"`);
    wires.set(id, { instr: inst.id, stage, slot, value, fmt });
    for (const end of wire.ends) c(end);
  };
  /** This cycle's events belonging to one instruction. `flush` carries no `instr` and is excluded. */
  const eventsFor = (inst: InstructionInstance): readonly TaggedEvent[] =>
    trace.events.filter((e): e is TaggedEvent => 'instr' in e && e.instr === inst.id);

  // --- IF: one pc addresses the memory; WIDTH consecutive words come back --------------------
  // The address is the OLDEST occupant's pc — the group is fetched from `pc`, `pc + 4`, … so there
  // is one address and the rest are implied by it. `inst.pc`/`inst.encoding` rather than the
  // `instr-fetch` event: an instruction HELD in IF by a refusal was fetched in an earlier cycle and
  // emits no event now, but the pc it presents is unchanged — which is what a hold IS.
  const ifSlots = byStage.get('IF') ?? [];
  const ifOldest = ifSlots.find((i) => i !== undefined);
  if (ifOldest) {
    // Only the memory's address wire carries the pc as a LABEL, though all three carry it as a
    // value: labelling each printed the identical 32-bit hex three times in the tightest band of
    // the diagram (M3's browser finding, inherited).
    w('pcmux-pc', 'IF', 0, ifOldest, undefined, 'hex');
    w('pc-imem', 'IF', 0, ifOldest, ifOldest.pc, 'hex');
    w('pc-addn', 'IF', 0, ifOldest, undefined, 'hex');
    // The sequential next pc — `+4` PER INSTRUCTION FETCHED, so it is derived from the YOUNGEST
    // occupant's pc rather than a constant. This is the one place the label would be wrong if the
    // adder were drawn as a fixed `+8`: on a cycle where only one slot was free, the machine really
    // did advance by 4.
    let last = ifOldest.pc;
    for (const inst of ifSlots) if (inst) last = Math.max(last, inst.pc);
    w('addn-pcmux', 'IF', 0, ifOldest, (last + 4) >>> 0, 'hex');
    // One fetch wire per slot — the group, drawn one word per lane.
    for (const lane of LANES) {
      const inst = ifSlots[lane];
      if (inst) w(laneId('imem-ifid', lane), 'IF', lane, inst, inst.encoding, 'hex');
    }
  }

  // --- ID: decode every candidate, read 2 × width register ports, issue or refuse -------------
  // The ISSUE unit and the HAZARD unit are told apart by the stall's REASON, which is the only
  // thing that distinguishes them in the trace — and it is enough, because `issueVerdict` checks
  // the three pairing rules and `detectHazard` the two ordinary ones, with no overlap between the
  // reason sets. At most ONE stall fires per cycle (a refusal ends the issue group), so this is a
  // single verdict rather than a per-lane one; the test suite pins that rather than assuming it.
  const stall = trace.events.find((e) => e.type === 'stall');
  let refusal: Refusal | null = null;
  if (stall?.type === 'stall') {
    const refused = trace.instructions.find((i) => i.id === stall.instr);
    const refusedSlot = refused ? (parseLocation(refused.location)?.slot ?? 0) : 0;
    if (refused) {
      if (PAIRING_REASONS.has(stall.reason)) {
        // The pairing verdict — the drawn CAUSE of a single-issue cycle. Lit only when it actually
        // refused someone: it is combinational and always deciding, but "lit" means "on the active
        // path this cycle" in every model here, and a permanently-lit issue unit would say nothing
        // about WHEN pairing fails, which is the entire pedagogical point of the box.
        refusal = { reason: stall.reason, instr: stall.instr };
        c('issue');
        w('ifid-issue', 'ID', refusedSlot, refused, undefined, 'dec');
        w('issue-ifid', 'ID', refusedSlot, refused, undefined, 'dec');
        w('issue-pc', 'ID', refusedSlot, refused, undefined, 'dec');
      } else {
        // An ordinary older-stage hazard — `load-use` with forwarding on, `raw` with it off. Its
        // answer is to hold the PC and the IF/ID latch: the repeated `IF IF` of the textbook.
        c('hazard');
        w('ifid-hazard', 'ID', refusedSlot, refused, undefined, 'dec');
        w('idex-hazard', 'ID', refusedSlot, refused, undefined, 'dec');
        w('hazard-ifid', 'ID', refusedSlot, refused, undefined, 'dec');
        w('hazard-pc', 'ID', refusedSlot, refused, undefined, 'dec');
      }
    }
  }

  for (const lane of LANES) {
    const idInst = occupant('ID', lane);
    if (!idInst) continue;
    const d = idInst.decoded;
    const events = eventsFor(idInst);
    // The encoding is labelled once, at the fetch that produced it — re-printing it on ID's input
    // wires says nothing new (decoding is what ID DOES to it) and costs 32-bit hex boxes beside the
    // IF/ID bar, where there is no clear y for them to escape to.
    w(laneId('ifid-regfile', lane), 'ID', lane, idInst, undefined, 'hex');
    const usesImm =
      d.format !== 'R' && d.mnemonic !== 'ecall' && d.mnemonic !== 'ebreak' && d.mnemonic !== 'fence'; // prettier-ignore
    if (usesImm) {
      w(laneId('ifid-signext', lane), 'ID', lane, idInst, undefined, 'hex');
      w(laneId('signext-idex', lane), 'ID', lane, idInst, d.imm, 'dec');
    }
    const regReads = events.filter((e) => e.type === 'reg-read');
    if (regReads[0])
      w(laneId('regfile-idex-a', lane), 'ID', lane, idInst, regReads[0].value, 'dec');
    if (regReads[1])
      w(laneId('regfile-idex-b', lane), 'ID', lane, idInst, regReads[1].value, 'dec');
    // The BET — drawn from `branch-predicted`, the event that IS the redirect, and never from the
    // `flush` it usually raises alongside: a branch at the end of `.text` bets on every pass with
    // the fetch pointer already out of text, killing nobody and emitting no flush while still
    // steering the pc. Reading the flush would draw the bet's COST and call it the ACTION.
    const bet = events.find((e) => e.type === 'branch-predicted');
    if (bet?.type === 'branch-predicted') {
      c('btarget');
      w('ifid-btarget', 'ID', lane, idInst, undefined, 'hex');
      w(laneId('signext-btarget', lane), 'ID', lane, idInst, undefined, 'dec');
      // Only the REDIRECT is labelled, and it is the one value the trace can honestly supply: the
      // immediate is already printed on this lane's `signext-idex`, and re-deriving `pc + imm` in a
      // view would put ISA arithmetic in the renderer (INV-3/INV-7).
      w('btarget-pcmux', 'ID', lane, idInst, bet.target, 'hex');
    }
  }

  // --- EX: two lanes forward, compute, and resolve at most ONE control transfer ---------------
  for (const lane of LANES) {
    const exInst = occupant('EX', lane);
    if (!exInst) continue;
    const d = exInst.decoded;
    const events = eventsFor(exInst);
    const aluOp = events.find((e) => e.type === 'alu-op');
    const forwards = events.filter((e) => e.type === 'forward');
    const resolved = events.find((e) => e.type === 'branch-resolved');
    const alu = laneId('alu', lane);
    const pcarith = laneId('pcarith', lane);

    if (aluOp?.type === 'alu-op') {
      c(alu);
      // Each operand's source is picked by its forwarding mux — so exactly ONE input path lights
      // per port. Lighting the register-file path as well when a forward fires would draw the stale
      // value flowing into the ALU beside the fresh one, which is the precise misconception this
      // tier exists to break: forwarding is a change of PATH, not an extra wire.
      //
      // The SOURCE is the latch BAR, never a slot of it: `forward.from` is `'EX/MEM'` / `'MEM/WB'`
      // and the trace does not say which slot the value came out of. Drawing a slot would be a
      // coin-flip rendered as hardware.
      const port = (to: string, side: 'a' | 'b', value: number): void => {
        const muxWire = laneId(`idex-fwdmux${side}`, lane);
        const contraction = laneId(`idex-alu-${side}`, lane);
        const fwd = forwards.find((e) => e.type === 'forward' && e.to === to);
        if (fwd?.type === 'forward') {
          const from = fwd.from === 'EX/MEM' ? 'exmem' : 'memwb';
          w(laneId(`${from}-fwdmux${side}`, lane), 'EX', lane, exInst, fwd.value, 'dec');
          w(laneId(`${from}-alu-${side}`, lane), 'EX', lane, exInst, fwd.value, 'dec');
        } else {
          w(muxWire, 'EX', lane, exInst, value, 'dec');
          w(contraction, 'EX', lane, exInst, value, 'dec');
        }
        w(laneId(`fwdmux${side}-alu`, lane), 'EX', lane, exInst, value, 'dec');
      };
      // `to` is BARE (`'EX.rs1'`, not `'EX.0.rs1'`) — the slot encoding was deliberately confined to
      // `location` (pinned M7 step 2a, re-decided at 2b), so the consumer is identified by `instr`.
      port('EX.rs1', 'a', aluOp.a);
      port('EX.rs2', 'b', aluOp.b);

      const addrLike = LOADS.has(d.mnemonic) || STORES.has(d.mnemonic) || d.mnemonic === 'jalr';
      w(laneId('alu-exmem', lane), 'EX', lane, exInst, aluOp.result, addrLike ? 'hex' : 'dec');
    }
    // The forwarding UNIT is lit by the comparison it made, whether or not it selected a forward —
    // but only when there is something in this lane for it to have compared.
    if (aluOp || forwards.length > 0) {
      c(laneId('fwdunit', lane));
      w(laneId('idex-fwdunit', lane), 'EX', lane, exInst, undefined, 'dec');
      w(laneId('exmem-fwdunit', lane), 'EX', lane, exInst, undefined, 'dec');
      w(laneId('memwb-fwdunit', lane), 'EX', lane, exInst, undefined, 'dec');
    }
    // The dedicated pc/immediate adder: the link value (`jal`/`jalr`), `auipc`'s pc+imm, `lui`'s
    // pass-through, and every pc-relative target. Its INPUTS are labelled from the trace; its
    // output is not — the writeback value is not emitted until WB, cycles later, and inventing it
    // here would mean re-deriving ISA arithmetic in a view (INV-3/INV-7).
    const pcRelTransfer = resolved?.type === 'branch-resolved' && d.mnemonic !== 'jalr';
    if (PCARITH_PRODUCERS.has(d.mnemonic) || pcRelTransfer) {
      c(pcarith);
      w(laneId('idex-pcarith-pc', lane), 'EX', lane, exInst, exInst.pc, 'hex');
      w(laneId('idex-pcarith-imm', lane), 'EX', lane, exInst, d.imm, 'dec');
      if (PCARITH_PRODUCERS.has(d.mnemonic))
        w(laneId('pcarith-exmem', lane), 'EX', lane, exInst, undefined, 'hex');
    }
    // The EX CORRECTION. It fires exactly when the prediction was WRONG, which is NOT the same as
    // "the branch was taken": a correctly predicted taken branch redirects nothing (ID's bet
    // already steered fetch a cycle earlier), and a LOST bet redirects back to the fall-through.
    //
    // `actual` comes back as the LABEL condition, which is a different question — a TAKEN
    // correction carries `pc + imm`, precisely the two operands drawn into this lane's pc adder, so
    // the label is explained by the picture. A lost bet's correction carries `pc + 4`, and
    // labelling THAT as the adder's output would draw an adder fed `0` and `8` emitting `4` on the
    // canvas. So it lights bare there (INV-5: omit, never contradict).
    if (resolved?.type === 'branch-resolved' && resolved.predicted !== resolved.actual) {
      const redirect = d.mnemonic === 'jalr' ? laneId('alu-pcmux', lane) : laneId('pcarith-pcmux', lane); // prettier-ignore
      w(redirect, 'EX', lane, exInst, resolved.actual ? resolved.target : undefined, 'hex');
    }
    c('idex');
    c('exmem');
  }

  // --- MEM: ONE data memory (the mem-port rule), but two bypass paths -------------------------
  for (const lane of LANES) {
    const memInst = occupant('MEM', lane);
    if (!memInst) continue;
    const events = eventsFor(memInst);
    const memRead = events.find((e) => e.type === 'mem-read');
    const memWrite = events.find((e) => e.type === 'mem-write');
    const addr =
      memRead?.type === 'mem-read'
        ? memRead.addr
        : memWrite?.type === 'mem-write'
          ? memWrite.addr
          : undefined;
    if (memRead || memWrite) {
      c('dmem');
      w('exmem-dmem-addr', 'MEM', lane, memInst, addr, 'hex');
    }
    if (memRead?.type === 'mem-read') w('dmem-memwb', 'MEM', lane, memInst, memRead.value, 'hex');
    if (memWrite?.type === 'mem-write')
      w('exmem-dmem-data', 'MEM', lane, memInst, memWrite.value, 'dec');
    // Everything that is not a load carries its value straight past the memory, on its OWN slot's
    // bypass — two of them can be lit at once, which is why this wire is replicated.
    if (!memRead) w(laneId('exmem-memwb', lane), 'MEM', lane, memInst, undefined, 'dec');
    c('exmem');
    c('memwb');
  }

  // --- WB: two write ports into the one register file ----------------------------------------
  for (const lane of LANES) {
    const wbInst = occupant('WB', lane);
    if (!wbInst) continue;
    const events = eventsFor(wbInst);
    const regWrite = events.find((e) => e.type === 'reg-write');
    c('memwb');
    if (regWrite?.type === 'reg-write') {
      writtenRegs.push(regWrite.reg);
      const d = wbInst.decoded;
      const isLoad = LOADS.has(d.mnemonic);
      const ptrLike = isLoad || d.mnemonic === 'jal' || d.mnemonic === 'jalr' || d.mnemonic === 'auipc'; // prettier-ignore
      const fmt: Fmt = ptrLike ? 'hex' : 'dec';
      // Provenance, preserved through the contraction: a load's datum comes off the MDR path and
      // everything else off the computed-value path. The `essentials` stand-in collapses only the
      // mux — same source (MEM/WB), same sink (the register file).
      w(laneId(isLoad ? 'memwb-wbmux-mdr' : 'memwb-wbmux-val', lane), 'WB', lane, wbInst, regWrite.value, fmt); // prettier-ignore
      w(laneId('wbmux-regfile', lane), 'WB', lane, wbInst, regWrite.value, fmt);
      w(laneId('memwb-regfile', lane), 'WB', lane, wbInst, regWrite.value, fmt);
    }
  }

  return { occupancy, components, wires, writtenRegs, refusal };
}

/** The trace events that name an instruction — everything except `flush`, which reports stages. */
type TaggedEvent = Extract<CycleTrace['events'][number], { instr: string }>;
