/**
 * The DEEP 7-STAGE PIPELINE datapath, as pure data (M11 step 7) — the sixth bespoke geometry, in
 * the same two-halves shape as every sibling (`datapath.ts`, `datapath-multi.ts`,
 * `datapath-pipeline.ts`, `datapath-superscalar.ts`, `datapath-out-of-order.ts`):
 *
 *  1. GEOMETRY — a fixed set of {@link DatapathNode}s and {@link DatapathWire}s with hand-placed SVG
 *     coordinates: `IF1 IF2 ID EX1 EX2 MEM WB`, divided by the SIX inter-stage latch bars that are
 *     what "7 stages, 6 latches" looks like.
 *  2. ACTIVATION — {@link activate}, a pure `CycleTrace → DatapathActivation`.
 *
 * It is a fork of the 5-stage geometry rather than a reuse of it, for the reason every model in this
 * project is: lighting a five-column diagram with a seven-stage trace would draw a machine that
 * contradicts the one being simulated (INV-5). Most of the structure is genuinely the same machine —
 * a Harvard front end, one register file, one ALU, one data memory — and the differences are exactly
 * the two the milestone exists to teach.
 *
 * ## The two structural facts this diagram exists to draw
 *
 * **1. The forwarding muxes sit in EX1 and their output lands on the EX1/EX2 LATCH, not on the ALU.**
 * That is the whole thesis as geometry. In the 5-stage, a forward arrives at the mux in front of the
 * ALU and the dependent instruction computes in the same cycle. Here the operands are resolved in
 * EX1, ride the EX1/EX2 latch, and only meet the ALU in EX2 — so the producer's own result does not
 * exist until IT has left EX2, one cycle after its consumer needed it. **Nothing on this canvas
 * forwards into `ex1ex2` or into EX2**, and that absence is pinned by a test rather than left to
 * vigilance: it is the drawn form of `Ex1Ex2Latch` carrying operands and never a result.
 *
 * **2. The interlock watches TWO execute stages.** The hazard unit takes an input from the ID/EX1
 * latch *and* from the EX1/EX2 latch — who is in EX1, and who is in EX2 — because a load sitting in
 * EX2 still has no datum. Its answer holds THREE things where the 5-stage's holds two: the PC, the
 * IF1/IF2 latch and the IF2/ID latch, which is the `ID ID ID` / `IF2 IF2 IF2` / `IF1 IF1 IF1` triple
 * hold the recorder test pins.
 *
 * **The IF2 band deliberately contains NO unit, and that is the honest picture rather than a gap.**
 * The engine pinned (step 1) that IF1 reads the instruction word and IF2 is the second half of the
 * fetch path doing no new work — the alternative ("IF1 issues the address, IF2 receives the word")
 * was rejected there because an IF1 occupant would then have no `encoding`, and that field is not
 * nullable. So IF2's content is DEPTH ITSELF: one wire crossing one band, carrying a word that is
 * already fetched. Drawing a box there would invent work the trace does not contain.
 *
 * ## What is carried over unchanged from the 5-stage, and why that is the point
 *
 * **Occupancy comes from `instructions[].location`, NEVER from `state.micro`.** `micro` at cycle `i`
 * is the END-of-cycle latch state — what the latches present to cycle `i+1` — so a datapath sourced
 * from it draws the pipe ONE CYCLE AHEAD OF ITSELF. Values likewise come only from THIS cycle's
 * `events`. (The out-of-order datapath is the one sibling that reads `micro`, and only because an
 * out-of-order `location` is uniformly `"ROB#tag"` and names no stage. This model's `location` names
 * a stage, so the parent's trap applies here unchanged.)
 *
 * A consequence worth naming because it looks like an omission and is not: **an operand that was NOT
 * forwarded crosses into `ex1ex2` unlabelled.** Its value was read from the register file while the
 * instruction was in ID, one or more cycles ago, so no event in THIS trace holds it. The wire lights
 * bare rather than borrowing a number that would be stale (INV-5: omit, never contradict) — and,
 * pointedly, rather than reaching for a new trace field to carry it. That was the milestone's named
 * temptation to widen the schema, and it is declined here.
 *
 * ## Hue: seven stages, five colours
 *
 * `PHASE_COLORS` has five validated hues and this machine has seven stages, so a wire is stroked in
 * the hue of its stage's FAMILY (`IF1`/`IF2` → fetch, `EX1`/`EX2` → execute), which is precisely the
 * rule the pipeline MAP already follows via `stageFamily`. No hue is invented; the stage stays
 * individually readable through the diagram's own labels and the map's cell text (the relief rule).
 * The view owns that mapping — {@link WireActivation} carries the exact stage, since the followed-
 * instruction ring keys on identity and the hue must not be the only thing a reader can recover.
 *
 * ## Depth tiers AND config — the same two visibility axes as the 5-stage (INV-5)
 *
 *   - `essentials`/`detailed` — the seven-stage skeleton: PC, the two memories, the register file,
 *     the ALU and the six latch bars, with DIRECT contraction wires standing in for each hidden mux.
 *     `detailed` reveals the writeback mux and adds value labels.
 *   - `expert` — the forwarding unit, both forwarding muxes and the hazard unit appear; the
 *     contraction wires give way to the real through-mux wires, and control-line labels show.
 *
 * Structure also depends on CONFIG: with `forwarding: false` the forwarding unit and its muxes are
 * ABSENT (not dimmed), because the trace genuinely has no `forward` events in that position; with
 * the machine predicting not-taken, the branch-target adder and its redirect are absent, because a
 * machine that takes no action has none to draw. **Contraction visibility is DERIVED** from
 * `contracts` alone — the condition is two-dimensional (tier AND config) and no scalar field can
 * express it. {@link activate} stays tier- and config-oblivious (INV-2); the view filters.
 *
 * Honest simplifications, surfaced rather than hidden: `lui`/`auipc`/`jal` produce their writeback
 * value with no `alu-op`, so a small dedicated `pcarith` adder sources them (the call M1, M2 and M3
 * all made); the forwarding and hazard units drive their muxes through `expert` control LABELS
 * rather than drawn select lines; and the hazard unit's inputs are the two EXECUTE latches, matching
 * the 5-stage's single `idex-hazard` input in spirit — under forwarding OFF the interlock also
 * compares against the instruction in MEM, which this diagram does not draw a third input for, for
 * exactly the reason the parent does not draw a second.
 */

import { DEPTH_TIERS, type DepthTier } from '@cpu-viz/curriculum';
import type { Stage } from '@cpu-viz/engine-deep-pipeline';
import type { CycleTrace, InstructionInstance } from '@cpu-viz/trace';

export type { Stage };

/** The seven stages, oldest-to-youngest left to right — the columns of the diagram. */
export const STAGES: readonly Stage[] = ['IF1', 'IF2', 'ID', 'EX1', 'EX2', 'MEM', 'WB'];

/**
 * The five stage FAMILIES, in pipeline order — the diagram's five hues. `IF1`/`IF2` share the fetch
 * hue and `EX1`/`EX2` the execute one, which is the rule the pipeline map follows (`stageFamily`)
 * and the reason seven columns need no invented colour.
 *
 * **There is deliberately no per-STAGE label map here, where both the 5-stage and the superscalar
 * export one.** Theirs feeds a legend with one entry per stage, which works only while stages and
 * hues are in bijection. Here they are not — a seven-row legend with two pairs of identical swatches
 * would say the opposite of what is true — so the legend keys the FAMILY and the stage stays
 * readable through the latch bars' own text. A `STAGE_LABELS` copied over from the parent would be
 * exported-and-unused, which is also how a test asserting the legend omits `"Fetch 1"` becomes
 * vacuous: nothing could ever have produced that string.
 */
export const FAMILIES: readonly string[] = ['IF', 'ID', 'EX', 'MEM', 'WB'];
export const FAMILY_LABELS: Record<string, string> = {
  IF: 'Fetch',
  ID: 'Decode',
  EX: 'Execute',
  MEM: 'Memory',
  WB: 'Writeback',
};

/** Narrow the trace's `location` string to a {@link Stage}. The deep pipeline always sets one of the
 *  seven for an in-flight instruction; anything else is not ours to draw. */
function asStage(location: string): Stage | null {
  return (STAGES as readonly string[]).includes(location) ? (location as Stage) : null;
}

// --- Geometry -----------------------------------------------------------------------------

// WIDTH IS SET BY THE LABELS, NOT THE BOXES — inherited from the 5-stage, where it was a browser
// eyeball finding, and MORE binding here because there are six tall bars rather than four. The
// shared renderer de-collides a value label by nudging it VERTICALLY off its wire until it clears
// every component box; a label whose x-range overlaps a 360px-tall bar has no clear y to escape to,
// so it parks on the bar and is unreadable. Every gap where a 32-bit hex label lands beside a bar is
// therefore sized to hold it (~80px). Two extra bands (IF2 and the EX split) plus those clearances
// are what make this canvas 320px wider than the 5-stage's, not any box needing room.
export const CANVAS = { width: 1520, height: 540 } as const;

export interface DatapathNode {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Draw as a trapezoid (mux) or notched adder rather than a plain box. */
  readonly shape?: 'box' | 'mux' | 'adder';
  /** Lowest depth tier at which this component is drawn. Absent ⇒ `essentials`. */
  readonly minTier?: DepthTier;
  /** Drawn ONLY when `forwarding` is on: the forwarding unit and its two muxes. The trace has no
   *  `forward` events in the other position, so drawing an idle forwarding network there would
   *  contradict it (INV-5). The hazard unit deliberately does NOT set this — it is live in both,
   *  and on this machine it is live in a THIRD way the 5-stage never had (`ex-latency`). */
  readonly forwardingOnly?: boolean;
  /** Drawn ONLY when the machine bets taken: the branch-target adder and its redirect. */
  readonly predictTakenOnly?: boolean;
  /** The control signal this unit drives — shown only at `expert` tier. */
  readonly controlLabel?: string;
}

// LAYOUT CONTRACT (checked by the geometry tests): seven stage bands, divided by the six latch BARS
// (`if1if2`/`if2id`/`idex1`/`ex1ex2`/`ex2mem`/`memwb`) — tall columns spanning y 70..430. The
// instruction band flows left→right along y≈276 (PC → IMem → [the empty IF2 band] → regfile →
// forwarding muxes → ALU → DMem → writeback mux). The control units ride the clear top band (y<70);
// the forward paths, the writeback bus and the two PC redirects ride the clear bottom rails (y>430),
// each on its own y so no two co-visible wires ever run collinearly. Shaped nodes (mux/adder)
// connect ONLY on their vertical edges (muxes in-left/out-right; adders on the two notch stubs +
// right output). See `shapePolygon` in DatapathDiagram for the outlines these anchors hit.
const NODE_LIST: readonly DatapathNode[] = [
  // --- IF1: the next-pc selector, the PC, its +4 adder, and the instruction memory ---
  { id: 'pcmux', label: '', x: 40, y: 238, w: 18, h: 76, shape: 'mux', controlLabel: 'PCSrc' },
  { id: 'pc', label: 'PC', x: 76, y: 254, w: 40, h: 44 },
  { id: 'add4', label: '+4', x: 146, y: 120, w: 52, h: 44, shape: 'adder' },
  { id: 'imem', label: 'Instr\nMem', x: 146, y: 238, w: 72, h: 76 },
  // --- The six latch bars: the columns that divide the seven stages ---
  { id: 'if1if2', label: 'IF1\n/\nIF2', x: 298, y: 70, w: 16, h: 360 },
  // --- IF2: DELIBERATELY EMPTY. The word is already fetched and is simply in flight for a second
  //     cycle; see the file header on why a box here would invent work the trace does not have. ---
  { id: 'if2id', label: 'IF2\n/\nID', x: 434, y: 70, w: 16, h: 360 },
  // --- ID: register file, sign-extend, the hazard unit, and the branch-target adder ---
  { id: 'hazard', label: 'Hazard\ndetect', x: 490, y: 84, w: 100, h: 44, minTier: 'expert', controlLabel: 'PCWrite / IF1-IF2-Write / IF2-ID-Write' }, // prettier-ignore
  // The BET's adder, exactly where the 5-stage puts it — ID is still the earliest a PC-relative
  // target can be known. What DEPTH changes is the price: by the time ID bets, the front end has
  // fetched TWO fall-through instructions rather than one, which is the "2" in "a correctly
  // predicted taken branch costs 2, not 0" on this machine. No `minTier`: with the toggle on this
  // is where the next pc comes from, so hiding it would leave the redirect arriving from nowhere.
  { id: 'btarget', label: 'Branch\ntarget', x: 490, y: 143, w: 76, h: 52, shape: 'adder', predictTakenOnly: true }, // prettier-ignore
  { id: 'regfile', label: 'Registers', x: 490, y: 214, w: 100, h: 120 },
  { id: 'signext', label: 'Sign\nExtend', x: 490, y: 364, w: 100, h: 40 },
  { id: 'idex1', label: 'ID\n/\nEX1', x: 640, y: 70, w: 16, h: 360 },
  // --- EX1: THE FORWARDING NETWORK, AND NOTHING ELSE. The muxes resolve both operands and hand
  //     them to the EX1/EX2 latch; no ALU lives in this band, which is the geometric form of the
  //     milestone's thesis (see the file header). ---
  { id: 'fwdunit', label: 'Forwarding\nunit', x: 690, y: 104, w: 120, h: 44, minTier: 'expert', forwardingOnly: true }, // prettier-ignore
  { id: 'fwdmuxa', label: '', x: 700, y: 196, w: 18, h: 64, shape: 'mux', minTier: 'expert', forwardingOnly: true, controlLabel: 'ForwardA' }, // prettier-ignore
  { id: 'fwdmuxb', label: '', x: 700, y: 286, w: 18, h: 64, shape: 'mux', minTier: 'expert', forwardingOnly: true, controlLabel: 'ForwardB' }, // prettier-ignore
  { id: 'ex1ex2', label: 'EX1\n/\nEX2', x: 850, y: 70, w: 16, h: 360 },
  // --- EX2: the ALU and the dedicated pc/immediate adder. Every control transfer resolves here. ---
  { id: 'alu', label: 'ALU', x: 900, y: 198, w: 86, h: 124, shape: 'adder' },
  { id: 'pcarith', label: 'PC\narith', x: 900, y: 364, w: 64, h: 46, shape: 'adder' },
  { id: 'ex2mem', label: 'EX2\n/\nMEM', x: 1066, y: 70, w: 16, h: 360 },
  // --- MEM: the data memory (split from the instruction memory — Harvard) ---
  { id: 'dmem', label: 'Data\nMem', x: 1162, y: 222, w: 86, h: 88 },
  { id: 'memwb', label: 'MEM\n/\nWB', x: 1328, y: 70, w: 16, h: 360 },
  // --- WB: the writeback source selector ---
  { id: 'wbmux', label: '', x: 1424, y: 214, w: 18, h: 100, shape: 'mux', minTier: 'detailed', controlLabel: 'MemtoReg' }, // prettier-ignore
] as const;

export const NODES: ReadonlyMap<string, DatapathNode> = new Map(NODE_LIST.map((n) => [n.id, n]));

type Pt = readonly [number, number];

/** Anchor a point on a node's edge. l/r = side midpoints + `off`; t/b = top/bottom edge + `off`
 *  along it. For adders use {@link aUp}/{@link aLo} (left operand stubs) and `r` (output) — never
 *  l/t/b, which land on the notch or the slants. */
function at(id: string, side: 'l' | 'r' | 't' | 'b', off = 0): Pt {
  const n = NODES.get(id)!;
  switch (side) {
    case 'l':
      return [n.x, n.y + n.h / 2 + off];
    case 'r':
      return [n.x + n.w, n.y + n.h / 2 + off];
    case 't':
      return [n.x + n.w / 2 + off, n.y];
    case 'b':
      return [n.x + n.w / 2 + off, n.y + n.h];
  }
}
/** A point on a latch BAR's left/right edge at an absolute `y`. The bars are 360px tall, so
 *  centre-relative offsets would be unreadable; the y is the honest coordinate. */
function bar(id: string, side: 'l' | 'r', y: number): Pt {
  const n = NODES.get(id)!;
  return [side === 'l' ? n.x : n.x + n.w, y];
}
/** An adder's upper / lower left operand stub. `off` slides along that stub's vertical edge. */
function aUp(id: string, off = 0): Pt {
  const n = NODES.get(id)!;
  return [n.x, n.y + n.h * 0.16 + off];
}
function aLo(id: string, off = 0): Pt {
  const n = NODES.get(id)!;
  return [n.x, n.y + n.h * 0.84 + off];
}

export interface DatapathWire {
  readonly id: string;
  /** The two node ids this wire physically connects (edge-to-edge). Drives per-tier/per-config
   *  visibility: a wire is drawn only if both ends are drawn, so hiding a unit never dangles a
   *  wire. The `id` is a display name and does NOT reliably name the endpoints. */
  readonly ends: readonly [string, string];
  readonly points: readonly Pt[];
  /** Lowest tier at which this wire is drawn (absent ⇒ `essentials`). */
  readonly minTier?: DepthTier;
  /** Part of the forwarding network, so drawn only when `forwarding` is on. Needed only where the
   *  endpoints alone would not say so — the forward CONTRACTIONS run latch→latch, and both of those
   *  are drawn in every config. */
  readonly forwardingOnly?: boolean;
  /** Part of the bet path, so drawn only when the machine predicts taken. */
  readonly predictTakenOnly?: boolean;
  /** For a CONTRACTION wire: the unit id it collapses. The `S → T` contraction must equal the
   *  expert path `S → unit → T` (same source, same sink) — the INV-5 lawfulness condition, checked
   *  by test. It is drawn exactly when that unit is NOT (see {@link wireVisibleAt}). */
  readonly contracts?: string;
}

const WIRE_LIST: readonly DatapathWire[] = [
  // --- IF1: the selected pc addresses the instruction memory; the word latches into IF1/IF2 ---
  { id: 'pcmux-pc', ends: ['pcmux', 'pc'], points: [at('pcmux', 'r'), at('pc', 'l')] }, // prettier-ignore
  { id: 'pc-imem', ends: ['pc', 'imem'], points: [at('pc', 'r'), at('imem', 'l')] }, // prettier-ignore
  { id: 'imem-if1if2', ends: ['imem', 'if1if2'], points: [at('imem', 'r'), bar('if1if2', 'l', 276)] }, // prettier-ignore
  { id: 'pc-add4', ends: ['pc', 'add4'], points: [at('pc', 't', -10), [86, aLo('add4')[1]], aLo('add4')] }, // prettier-ignore
  // The sequential next-pc, back around to the selector. Rides the clear top rail (y=36).
  { id: 'add4-pcmux', ends: ['add4', 'pcmux'], points: [at('add4', 'r'), [220, 142], [220, 36], [22, 36], [22, 262], at('pcmux', 'l', -14)] }, // prettier-ignore
  // --- IF2: ONE WIRE, NO UNIT — the second fetch cycle, drawn as what it is. The word crosses the
  //     band and nothing touches it; this is the only band in any model's diagram whose content is
  //     the passage of a cycle rather than a piece of hardware. ---
  { id: 'if1if2-if2id', ends: ['if1if2', 'if2id'], points: [bar('if1if2', 'r', 276), bar('if2id', 'l', 276)] }, // prettier-ignore
  // --- ID: IF2/ID drives the register file, the sign-extender and the hazard unit ---
  { id: 'if2id-regfile', ends: ['if2id', 'regfile'], points: [bar('if2id', 'r', 234), at('regfile', 'l', -40)] }, // prettier-ignore
  { id: 'if2id-signext', ends: ['if2id', 'signext'], points: [bar('if2id', 'r', 384), at('signext', 'l')] }, // prettier-ignore
  { id: 'regfile-idex1-a', ends: ['regfile', 'idex1'], points: [at('regfile', 'r', -16), bar('idex1', 'l', 258)] }, // prettier-ignore
  { id: 'regfile-idex1-b', ends: ['regfile', 'idex1'], points: [at('regfile', 'r', 24), bar('idex1', 'l', 298)] }, // prettier-ignore
  { id: 'signext-idex1', ends: ['signext', 'idex1'], points: [at('signext', 'r'), bar('idex1', 'l', 384)] }, // prettier-ignore
  // The hazard unit. TWO inputs from the execute side rather than the 5-stage's one, because the
  // interlock genuinely watches BOTH execute stages: a producer in EX1 has not computed yet
  // (`ex-latency`) and a LOAD in EX2 still has no datum (`load-use`). Its answer holds THREE
  // things — the PC and BOTH front-end latches — which is the `ID ID ID` / `IF2 IF2 IF2` /
  // `IF1 IF1 IF1` triple hold, where the 5-stage holds two. Outputs ride the clear top rails.
  //
  // **Every wire on this unit leaves or arrives on a SIDE, never the top — and that is a browser
  // finding, not a style preference.** A `controlLabel` is drawn as a single centred `<text>` four
  // pixels above the box, and this unit's label is the longest in the project (it names three held
  // things where the 5-stage names two), so anything stubbed out of the top edge runs underneath it.
  // Routing the three HOLDS out of the left edge is also the better picture: they all travel
  // BACKWARDS to the front end, which is what a hold is.
  { id: 'if2id-hazard', ends: ['if2id', 'hazard'], points: [bar('if2id', 'r', 106), at('hazard', 'l')] }, // prettier-ignore
  { id: 'idex1-hazard', ends: ['idex1', 'hazard'], points: [bar('idex1', 'l', 90), at('hazard', 'r', -16)] }, // prettier-ignore
  { id: 'ex1ex2-hazard', ends: ['ex1ex2', 'hazard'], points: [at('ex1ex2', 't'), [858, 28], [604, 28], [604, 122], at('hazard', 'r', 16)] }, // prettier-ignore
  { id: 'hazard-if2id', ends: ['hazard', 'if2id'], points: [at('hazard', 'l', 14), bar('if2id', 'r', 120)] }, // prettier-ignore
  { id: 'hazard-if1if2', ends: ['hazard', 'if1if2'], points: [at('hazard', 'l', -8), [458, 98], [458, 64], [306, 64], at('if1if2', 't')] }, // prettier-ignore
  { id: 'hazard-pc', ends: ['hazard', 'pc'], points: [at('hazard', 'l', -16), [466, 90], [466, 52], [106, 52], at('pc', 't', 10)] }, // prettier-ignore
  // --- ID: the BET — the early redirect. `pc + imm`, computed in ID and fed back to the same
  //     selector the EX2 corrections use, which makes `pcmux` a four-source mux: the sequential +4,
  //     the ID bet, the EX2 pc-relative correction, and `jalr`'s. ---
  { id: 'if2id-btarget', ends: ['if2id', 'btarget'], points: [bar('if2id', 'r', aUp('btarget')[1]), aUp('btarget')], predictTakenOnly: true }, // prettier-ignore
  { id: 'signext-btarget', ends: ['signext', 'btarget'], points: [at('signext', 'r', -12), [610, 372], [610, 202], [478, 202], [478, aLo('btarget')[1]], aLo('btarget')], predictTakenOnly: true }, // prettier-ignore
  // The bet rides the TOP rail home, where the EX2 corrections ride the bottom ones — the split is
  // the picture, not a routing convenience: the top is where next-pc candidates computed EARLY live
  // (the +4 is already there), the bottom is where late corrections come back. On this machine that
  // gap is a whole stage wider than the 5-stage's, which is the misprediction penalty itself.
  { id: 'btarget-pcmux', ends: ['btarget', 'pcmux'], points: [at('btarget', 'r'), [614, 169], [614, 20], [34, 20], [34, 248], at('pcmux', 'l', -28)], predictTakenOnly: true }, // prettier-ignore
  // --- EX1: the forwarding muxes pick each operand's source, and hand it to the EX1/EX2 LATCH.
  //     Read the sinks: every path in this block ends on `ex1ex2`, never on the ALU. ---
  { id: 'idex1-fwdmuxa', ends: ['idex1', 'fwdmuxa'], points: [bar('idex1', 'r', 228), at('fwdmuxa', 'l')] }, // prettier-ignore
  { id: 'idex1-fwdmuxb', ends: ['idex1', 'fwdmuxb'], points: [bar('idex1', 'r', 318), at('fwdmuxb', 'l')] }, // prettier-ignore
  { id: 'ex2mem-fwdmuxa', ends: ['ex2mem', 'fwdmuxa'], points: [at('ex2mem', 'b', -4), [1070, 444], [684, 444], [684, 250], at('fwdmuxa', 'l', 22)] }, // prettier-ignore
  { id: 'memwb-fwdmuxa', ends: ['memwb', 'fwdmuxa'], points: [at('memwb', 'b', -4), [1332, 456], [680, 456], [680, 206], at('fwdmuxa', 'l', -22)] }, // prettier-ignore
  { id: 'ex2mem-fwdmuxb', ends: ['ex2mem', 'fwdmuxb'], points: [at('ex2mem', 'b', 4), [1078, 438], [688, 438], [688, 340], at('fwdmuxb', 'l', 22)] }, // prettier-ignore
  { id: 'memwb-fwdmuxb', ends: ['memwb', 'fwdmuxb'], points: [at('memwb', 'b', 4), [1340, 462], [692, 462], [692, 296], at('fwdmuxb', 'l', -22)] }, // prettier-ignore
  { id: 'fwdmuxa-ex1ex2', ends: ['fwdmuxa', 'ex1ex2'], points: [at('fwdmuxa', 'r'), bar('ex1ex2', 'l', 228)] }, // prettier-ignore
  { id: 'fwdmuxb-ex1ex2', ends: ['fwdmuxb', 'ex1ex2'], points: [at('fwdmuxb', 'r'), bar('ex1ex2', 'l', 318)] }, // prettier-ignore
  // The forwarding unit compares the EX1 occupant's sources against the two latches ahead of it —
  // EX2/MEM and MEM/WB, one stage further away than the 5-stage's EX/MEM and MEM/WB. Both inputs
  // ride the top rails, because a direct run would cross the EX1/EX2 bar.
  { id: 'idex1-fwdunit', ends: ['idex1', 'fwdunit'], points: [bar('idex1', 'r', 126), at('fwdunit', 'l')] }, // prettier-ignore
  { id: 'ex2mem-fwdunit', ends: ['ex2mem', 'fwdunit'], points: [at('ex2mem', 't'), [1074, 52], [770, 52], at('fwdunit', 't', 20)] }, // prettier-ignore
  { id: 'memwb-fwdunit', ends: ['memwb', 'fwdunit'], points: [at('memwb', 't'), [1336, 36], [730, 36], at('fwdunit', 't', -20)] }, // prettier-ignore
  // The three CONTRACTIONS of each forwarding mux — one per source. Each ends on its own y along
  // the EX1/EX2 bar: all three are co-visible below `expert`, so they must not share a final run.
  { id: 'idex1-ex1ex2-a', ends: ['idex1', 'ex1ex2'], points: [bar('idex1', 'r', 228), bar('ex1ex2', 'l', 228)], contracts: 'fwdmuxa' }, // prettier-ignore
  { id: 'ex2mem-ex1ex2-a', ends: ['ex2mem', 'ex1ex2'], points: [at('ex2mem', 'b', -4), [1070, 444], [820, 444], [820, 216], bar('ex1ex2', 'l', 216)], contracts: 'fwdmuxa', forwardingOnly: true }, // prettier-ignore
  { id: 'memwb-ex1ex2-a', ends: ['memwb', 'ex1ex2'], points: [at('memwb', 'b', -4), [1332, 456], [812, 456], [812, 240], bar('ex1ex2', 'l', 240)], contracts: 'fwdmuxa', forwardingOnly: true }, // prettier-ignore
  { id: 'idex1-ex1ex2-b', ends: ['idex1', 'ex1ex2'], points: [bar('idex1', 'r', 318), bar('ex1ex2', 'l', 318)], contracts: 'fwdmuxb' }, // prettier-ignore
  { id: 'ex2mem-ex1ex2-b', ends: ['ex2mem', 'ex1ex2'], points: [at('ex2mem', 'b', 4), [1078, 438], [828, 438], [828, 306], bar('ex1ex2', 'l', 306)], contracts: 'fwdmuxb', forwardingOnly: true }, // prettier-ignore
  { id: 'memwb-ex1ex2-b', ends: ['memwb', 'ex1ex2'], points: [at('memwb', 'b', 4), [1340, 462], [804, 462], [804, 330], bar('ex1ex2', 'l', 330)], contracts: 'fwdmuxb', forwardingOnly: true }, // prettier-ignore
  // --- EX2: the operands come OFF the EX1/EX2 latch and meet the ALU here, a cycle after they were
  //     resolved. This is where a result first exists, and therefore the earliest a forward can
  //     leave from — which is why the forward sources above are EX2/MEM and MEM/WB. ---
  { id: 'ex1ex2-alu-a', ends: ['ex1ex2', 'alu'], points: [bar('ex1ex2', 'r', aUp('alu')[1]), aUp('alu')] }, // prettier-ignore
  { id: 'ex1ex2-alu-b', ends: ['ex1ex2', 'alu'], points: [bar('ex1ex2', 'r', aLo('alu')[1]), aLo('alu')] }, // prettier-ignore
  { id: 'ex1ex2-pcarith-pc', ends: ['ex1ex2', 'pcarith'], points: [bar('ex1ex2', 'r', aUp('pcarith')[1]), aUp('pcarith')] }, // prettier-ignore
  { id: 'ex1ex2-pcarith-imm', ends: ['ex1ex2', 'pcarith'], points: [bar('ex1ex2', 'r', aLo('pcarith')[1]), aLo('pcarith')] }, // prettier-ignore
  { id: 'alu-ex2mem', ends: ['alu', 'ex2mem'], points: [at('alu', 'r'), bar('ex2mem', 'l', 260)] }, // prettier-ignore
  { id: 'pcarith-ex2mem', ends: ['pcarith', 'ex2mem'], points: [at('pcarith', 'r'), bar('ex2mem', 'l', 387)] }, // prettier-ignore
  // The two BRANCH REDIRECTS, drawn from `branch-resolved`. pc-relative transfers redirect from the
  // pc adder; `jalr` alone redirects from the ALU, because a REGISTER supplies its target. Each
  // rides its own bottom rail back to the selector — a longer run than the 5-stage's, which is the
  // four-cycle penalty drawn to scale.
  { id: 'pcarith-pcmux', ends: ['pcarith', 'pcmux'], points: [at('pcarith', 'r', 8), [1000, 395], [1000, 496], [16, 496], [16, 286], at('pcmux', 'l', 10)] }, // prettier-ignore
  { id: 'alu-pcmux', ends: ['alu', 'pcmux'], points: [at('alu', 'r', 20), [1010, 280], [1010, 484], [30, 484], [30, 300], at('pcmux', 'l', 24)] }, // prettier-ignore
  // --- MEM: EX2/MEM addresses the data memory; the value bypasses it for everything but a load ---
  { id: 'ex2mem-dmem-addr', ends: ['ex2mem', 'dmem'], points: [bar('ex2mem', 'r', 266), at('dmem', 'l')] }, // prettier-ignore
  { id: 'ex2mem-dmem-data', ends: ['ex2mem', 'dmem'], points: [bar('ex2mem', 'r', 300), at('dmem', 'l', 34)] }, // prettier-ignore
  { id: 'dmem-memwb', ends: ['dmem', 'memwb'], points: [at('dmem', 'r'), bar('memwb', 'l', 266)] }, // prettier-ignore
  { id: 'ex2mem-memwb', ends: ['ex2mem', 'memwb'], points: [bar('ex2mem', 'r', 200), bar('memwb', 'l', 200)] }, // prettier-ignore
  // --- WB: MemtoReg picks the load datum or the computed value, back to the write port ---
  { id: 'memwb-wbmux-val', ends: ['memwb', 'wbmux'], points: [bar('memwb', 'r', 240), at('wbmux', 'l', -24)] }, // prettier-ignore
  { id: 'memwb-wbmux-mdr', ends: ['memwb', 'wbmux'], points: [bar('memwb', 'r', 288), at('wbmux', 'l', 24)] }, // prettier-ignore
  { id: 'wbmux-regfile', ends: ['wbmux', 'regfile'], points: [at('wbmux', 'r'), [1476, 264], [1476, 470], [462, 470], [462, 322], at('regfile', 'l', 48)] }, // prettier-ignore
  { id: 'memwb-regfile', ends: ['memwb', 'regfile'], points: [bar('memwb', 'r', 290), [1460, 290], [1460, 470], [470, 470], [470, 310], at('regfile', 'l', 36)], contracts: 'wbmux' }, // prettier-ignore
] as const;

export const WIRES: readonly DatapathWire[] = WIRE_LIST;

const WIRE_BY_ID: ReadonlyMap<string, DatapathWire> = new Map(WIRE_LIST.map((w) => [w.id, w]));

// --- Depth tiers × config ------------------------------------------------------------------

/** True when an element requiring `minTier` (absent ⇒ `essentials`) is drawn at `current`. */
export function tierVisible(minTier: DepthTier | undefined, current: DepthTier): boolean {
  return DEPTH_TIERS.indexOf(minTier ?? 'essentials') <= DEPTH_TIERS.indexOf(current);
}

/**
 * The engine BEHAVIORS the diagram's structure depends on — deliberately not the config's values.
 * `predictTaken` is a behavior rather than a scheme name because `'none'` and `'static-not-taken'`
 * are ONE MACHINE on this model too (the capability docblock says so): a processor with no predictor
 * does not wait, it keeps fetching, and the fall-through IS the not-taken path.
 *
 * The CACHE is deliberately absent, and it is the one knob this model honors that the diagram does
 * not take. A cache is drawn by the cache-grid panel, which gates on a trace fact (INV-3); no
 * sibling datapath draws one either, and a miss changes this machine's TIMING, never its structure.
 *
 * **What a miss DOES change is which stages are doing anything, and the resulting asymmetry is
 * deliberate — see the test that pins it.** While `missCyclesRemaining` freezes the pipe, EX1 stays
 * LIT and EX2 goes DARK. That is not an oversight and not a contradiction: EX1's forwarded operands
 * were resolved on the detection cycle and are genuinely standing on the latch for the whole freeze
 * — M11 step 6a's fix is precisely that they must be — while the ALU really is producing nothing.
 * A held stage that keeps presenting its inputs is the same convention IF1 already uses for an
 * instruction a stall is holding. Contrast the SQUASH case, where the engine explicitly resolved
 * nothing and the operands will never exist: there the wires must go dark, and they do.
 */
export interface DatapathConfig {
  readonly forwarding: boolean;
  readonly predictTaken: boolean;
}

/** Whether a node is drawn, on BOTH axes: deep enough a tier, and on the right side of whichever
 *  config gate it sets — the forwarding network's, or the bet adder's. */
export function nodeVisibleAt(node: DatapathNode, tier: DepthTier, cfg: DatapathConfig): boolean {
  if (!tierVisible(node.minTier, tier)) return false;
  if (node.forwardingOnly && !cfg.forwarding) return false;
  if (node.predictTakenOnly && !cfg.predictTaken) return false;
  return true;
}

/**
 * Whether a wire is drawn at (`tier`, `cfg`): deep enough a tier, on the right side of the config
 * gate, NOT superseded by the unit it contracts, and with both endpoint nodes drawn — so no wire
 * ever dangles into a hidden unit (INV-5).
 *
 * The contraction rule is DERIVED rather than declared: a contraction stands in for its unit exactly
 * when that unit is not drawn, which covers both axes at once without a second hand-maintained field
 * having to agree with this one.
 */
export function wireVisibleAt(wire: DatapathWire, tier: DepthTier, cfg: DatapathConfig): boolean {
  if (!tierVisible(wire.minTier, tier)) return false;
  if (wire.forwardingOnly && !cfg.forwarding) return false;
  if (wire.predictTakenOnly && !cfg.predictTaken) return false;
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

// --- Activation --------------------------------------------------------------------------

/** How a value should be rendered on a wire label. */
export type Fmt = 'hex' | 'dec';

/** A lit wire. A cycle lights wires for up to SEVEN different instructions, so each one says who lit
 *  it and from which stage — the stage picks the hue (via its family) and the id is what the
 *  follow-highlight keys on. */
export interface WireActivation {
  /** The stable id (INV-4) of the instruction whose work this wire is doing. */
  readonly instr: string;
  /** The exact stage that instruction is in — SEVEN possible values. The view maps it to a family
   *  for the hue; it is carried whole so nothing downstream has to invert that mapping. */
  readonly stage: Stage;
  /** The value flowing, when THIS cycle's events know it. Absent is honest — see the file docs on
   *  the un-forwarded operand crossing into `ex1ex2`. */
  readonly value?: number;
  readonly fmt: Fmt;
}

export interface DatapathActivation {
  /** Which instruction occupies each stage this cycle — from `instructions[].location`, the only
   *  source that describes THIS cycle. Up to seven entries. */
  readonly occupancy: ReadonlyMap<Stage, string>;
  /** Ids of components on an active path this cycle. Deliberately a plain set, with no instruction
   *  or stage attached: a component can be busy for TWO instructions at once — the register file is
   *  read by ID and written by WB in the same cycle, and every latch bar is written by the stage on
   *  its left while the stage on its right reads it. There is no single hue such a box could take,
   *  so components stay hue-neutral and the WIRES carry the stage colour. */
  readonly components: ReadonlySet<string>;
  /** Active wire id → who lit it, from where, and with what value. */
  readonly wires: ReadonlyMap<string, WireActivation>;
  /** The register the writeback port targets this cycle, or `null`. */
  readonly writtenReg: number | null;
}

const EMPTY: DatapathActivation = {
  occupancy: new Map(),
  components: new Set(),
  wires: new Map(),
  writtenReg: null,
};

const LOADS = new Set(['lb', 'lh', 'lw', 'lbu', 'lhu']);
const STORES = new Set(['sb', 'sh', 'sw']);
/** The classes whose writeback value comes from the dedicated pc/immediate adder rather than the
 *  ALU — they emit no `alu-op` at all (the engine mirrors the reference's event set). */
const PCARITH_PRODUCERS = new Set(['lui', 'auipc', 'jal', 'jalr']);
/** The I-encoded ops with no register operands at all. */
const NO_OPERANDS = new Set(['ecall', 'ebreak', 'fence']);

/**
 * Which source ports an instruction reads — the EX1 band's structure, and the one place this file
 * mirrors an engine helper (`sourceRegs` in `deep-pipeline/src/processor.ts`).
 *
 * **It has to be derived rather than read off an event, and that is the fork's sharpest trap.** The
 * 5-stage's activation gates its whole forwarding block on `if (aluOp)`, because there the muxes and
 * the ALU are in one stage. Here `alu-op` fires in EX2, a cycle AFTER the muxes do their work — so a
 * copied `if (aluOp)` would light nothing at all in EX1, on the one model whose thesis is that
 * forwarding stops being enough. Worse, it would fail SILENTLY: the coherence litmus passes when
 * nothing is lit. The gate is therefore occupancy plus this predicate.
 *
 * Same shape as the parent's `usesImm` check (format plus the operand-less mnemonics), so no new
 * class of view-side ISA knowledge is introduced — and `datapath-deep-pipeline.test.ts` ties it back
 * to the engine by asserting that every `forward` event's port is one this says is read.
 */
function sourcePorts(d: InstructionInstance['decoded']): { rs1: boolean; rs2: boolean } {
  if (NO_OPERANDS.has(d.mnemonic)) return { rs1: false, rs2: false };
  switch (d.format) {
    case 'R':
    case 'S':
    case 'B':
      return { rs1: true, rs2: true };
    case 'I':
      return { rs1: true, rs2: false };
    default:
      // U (lui/auipc) and J (jal) read no source registers; nor does an unrecognized word.
      return { rs1: false, rs2: false };
  }
}

/**
 * Derive which datapath components/wires are active THIS cycle, for EVERY instruction in flight, and
 * the value on each. Multi-instruction and stage-driven: each stage's occupant comes from
 * `instructions[].location` and its values from this cycle's `events` filtered by that instruction's
 * id — never from `state.micro`, which is a cycle ahead (see the file docs).
 *
 * Both the expert through-mux wires AND their contraction wires are lit, in every config (activation
 * is tier- and config-oblivious, INV-2); the view filters. Returns an empty activation for the
 * pre-run state.
 */
export function activate(trace: CycleTrace | null): DatapathActivation {
  if (!trace) return EMPTY;

  const occupancy = new Map<Stage, string>();
  const byStage = new Map<Stage, InstructionInstance>();
  for (const inst of trace.instructions) {
    const stage = asStage(inst.location);
    // One instruction per stage; first wins, defensively — the engine guarantees it.
    if (stage && !byStage.has(stage)) {
      byStage.set(stage, inst);
      occupancy.set(stage, inst.id);
    }
  }
  if (byStage.size === 0) return EMPTY;

  const components = new Set<string>();
  const wires = new Map<string, WireActivation>();
  let writtenReg: number | null = null;

  const c = (id: string): void => void components.add(id);
  /** Light a wire for `inst`'s work in `stage`, and light both its endpoints — which is what makes
   *  the coherence litmus hold by construction rather than by vigilance. */
  const w = (
    id: string,
    stage: Stage,
    inst: InstructionInstance,
    value: number | undefined,
    fmt: Fmt,
  ): void => {
    const wire = WIRE_BY_ID.get(id);
    if (!wire) throw new Error(`activate: unknown wire id "${id}"`);
    wires.set(id, { instr: inst.id, stage, value, fmt });
    for (const end of wire.ends) c(end);
  };
  /** This cycle's events belonging to one instruction. `flush` carries no `instr` and is excluded. */
  const eventsFor = (inst: InstructionInstance): readonly TaggedEvent[] =>
    trace.events.filter((e): e is TaggedEvent => 'instr' in e && e.instr === inst.id);

  /**
   * The stages a control transfer is killing THIS cycle — the one event that names stages rather
   * than an instruction, and the only place this file reads it.
   *
   * It gates EX1 (see there), and it is needed because gating that stage on OCCUPANCY alone is
   * over-broad in exactly one case: a squashed EX1 occupant is still REPORTED at `EX1` — step 3's
   * sweep asserts precisely that every stage a flush names has an occupant — while `stageEx1`
   * returned early without resolving a single operand. The 5-stage gets this right by accident,
   * since its `if (aluOp)` gate is never satisfied by an instruction that never executed; this fork
   * had to replace that gate (`alu-op` fires a stage later here) and so has to say it out loud.
   */
  const flushedStages = new Set<string>();
  for (const e of trace.events) if (e.type === 'flush') for (const s of e.stages) flushedStages.add(s); // prettier-ignore

  // --- IF1: the selected pc addresses the instruction memory ---------------------------------
  const if1Inst = byStage.get('IF1');
  if (if1Inst) {
    // `inst.pc`/`inst.encoding` rather than the `instr-fetch` event: an instruction HELD in IF1 by a
    // stall was fetched in an earlier cycle and emits no event now, but the pc it presents to the
    // memory is unchanged — which is what a hold IS. Only ONE of these carries the pc as a LABEL,
    // though all three carry it as a value (the parent's browser-eyeball finding: three identical
    // 32-bit hex boxes in the tightest band of the diagram).
    w('pcmux-pc', 'IF1', if1Inst, undefined, 'hex');
    w('pc-imem', 'IF1', if1Inst, if1Inst.pc, 'hex');
    w('imem-if1if2', 'IF1', if1Inst, if1Inst.encoding, 'hex');
    w('pc-add4', 'IF1', if1Inst, undefined, 'hex');
    w('add4-pcmux', 'IF1', if1Inst, (if1Inst.pc + 4) >>> 0, 'hex');
  }

  // --- IF2: the second fetch cycle — occupancy ONLY, because there are no events ---------------
  // The only wire in this family lit with no event behind it whatsoever. The word is labelled from
  // `inst.encoding` (the same source IF1's hold uses) because it is the one honest value here, and
  // the band was sized to hold that label clear of both bars.
  const if2Inst = byStage.get('IF2');
  if (if2Inst) {
    w('if1if2-if2id', 'IF2', if2Inst, if2Inst.encoding, 'hex');
  }

  // --- ID: decode, read the register file, and check for a hazard ----------------------------
  const idInst = byStage.get('ID');
  if (idInst) {
    const d = idInst.decoded;
    const events = eventsFor(idInst);
    // The encoding is labelled at the fetch that produced it and again as it crosses IF2; ID's own
    // answers — the register values and the immediate — are the labels that carry meaning here.
    w('if2id-regfile', 'ID', idInst, undefined, 'hex');
    const usesImm = d.format !== 'R' && !NO_OPERANDS.has(d.mnemonic);
    if (usesImm) {
      w('if2id-signext', 'ID', idInst, undefined, 'hex');
      w('signext-idex1', 'ID', idInst, d.imm, 'dec');
    }
    const regReads = events.filter((e) => e.type === 'reg-read');
    if (regReads[0]) w('regfile-idex1-a', 'ID', idInst, regReads[0].value, 'dec');
    if (regReads[1]) w('regfile-idex1-b', 'ID', idInst, regReads[1].value, 'dec');
    // The hazard unit lights exactly when it FIRED — a `stall` event naming this instruction. It is
    // combinational and always checking, but "lit" means "on the active path this cycle" in every
    // model here, and a permanently-lit interlock would say nothing about when the bubble happens.
    // Every `stall` this engine emits names the ID occupant (the two instructions behind it are
    // BLOCKED, not stalling in their own right), so this is the only stage that lights it.
    if (events.some((e) => e.type === 'stall')) {
      w('if2id-hazard', 'ID', idInst, undefined, 'dec');
      w('idex1-hazard', 'ID', idInst, undefined, 'dec');
      w('ex1ex2-hazard', 'ID', idInst, undefined, 'dec');
      w('hazard-if2id', 'ID', idInst, undefined, 'dec');
      w('hazard-if1if2', 'ID', idInst, undefined, 'dec');
      w('hazard-pc', 'ID', idInst, undefined, 'dec');
    }
    // The BET — drawn from `branch-predicted`, the event that IS the redirect, and never from the
    // `flush` it usually raises alongside. The flush reports CASUALTIES: a branch at the end of
    // `.text` bets with the fetch pointer already out of text, killing nobody and emitting no flush
    // while still steering the pc. Reading the flush would draw the bet's COST and call it the
    // ACTION. Only the REDIRECT is labelled — the immediate is already printed on `signext-idex1`
    // for this very instruction, and `branch-predicted` carries the target, so the view never
    // re-derives `pc + imm` (INV-3/INV-7).
    const bet = events.find((e) => e.type === 'branch-predicted');
    if (bet?.type === 'branch-predicted') {
      c('btarget');
      w('if2id-btarget', 'ID', idInst, undefined, 'hex');
      w('signext-btarget', 'ID', idInst, undefined, 'dec');
      w('btarget-pcmux', 'ID', idInst, bet.target, 'hex');
    }
  }

  // --- EX1: resolve the operands. THE FORWARDING NETWORK, AND NOTHING ELSE -------------------
  // Gated on OCCUPANCY plus {@link sourcePorts}, never on an event: `alu-op` fires a cycle later, in
  // EX2 (see `sourcePorts`). An instruction that reads no register lights nothing here, which is
  // honest — `lui` really does have no operand to resolve — but it still occupies EX1 for a cycle,
  // and the timing suite is where that cycle is pinned.
  //
  // ...**and NOT when this stage is being flushed**, which is the other half of replacing the
  // parent's event gate. A squashed occupant is still reported at `EX1`, but `stageEx1` returned
  // before resolving anything, so lighting its operand paths would draw work the trace says did not
  // happen (INV-5) — on every mispredicted branch, not in some corner. See {@link flushedStages}.
  // A BET is deliberately not covered: it kills only IF2/IF1 and EX1 executes normally under one.
  const ex1Inst = flushedStages.has('EX1') ? undefined : byStage.get('EX1');
  if (ex1Inst) {
    const events = eventsFor(ex1Inst);
    const forwards = events.filter((e) => e.type === 'forward');
    const ports = sourcePorts(ex1Inst.decoded);

    /** Light one operand port's chosen path. Exactly ONE input path lights per port: lighting the
     *  register-file path as well when a forward fires would draw the stale value flowing in beside
     *  the fresh one, which is the precise misconception this tier exists to break — forwarding is a
     *  change of PATH, not an extra wire. */
    const port = (
      to: string,
      muxWire: string,
      exWire: string,
      wbWire: string,
      contraction: string,
      exContraction: string,
      wbContraction: string,
      outWire: string,
    ): void => {
      const fwd = forwards.find((e) => e.type === 'forward' && e.to === to);
      if (fwd && fwd.type === 'forward') {
        // `EX2/MEM` and `MEM/WB` — one stage further from the consumer than the 5-stage's sources,
        // because a result does not exist until an instruction has LEFT EX2.
        const fromEx2Mem = fwd.from === 'EX2/MEM';
        w(fromEx2Mem ? exWire : wbWire, 'EX1', ex1Inst, fwd.value, 'dec');
        w(fromEx2Mem ? exContraction : wbContraction, 'EX1', ex1Inst, fwd.value, 'dec');
        w(outWire, 'EX1', ex1Inst, fwd.value, 'dec');
      } else {
        // The register-file path, and the one place this diagram is deliberately UNLABELLED: the
        // value was read at ID, one or more cycles ago, so no event in this trace holds it. Lit and
        // bare beats a stale number, and beats widening the trace schema to carry it.
        w(muxWire, 'EX1', ex1Inst, undefined, 'dec');
        w(contraction, 'EX1', ex1Inst, undefined, 'dec');
        w(outWire, 'EX1', ex1Inst, undefined, 'dec');
      }
    };
    if (ports.rs1) {
      port('EX1.rs1', 'idex1-fwdmuxa', 'ex2mem-fwdmuxa', 'memwb-fwdmuxa', 'idex1-ex1ex2-a', 'ex2mem-ex1ex2-a', 'memwb-ex1ex2-a', 'fwdmuxa-ex1ex2'); // prettier-ignore
    }
    if (ports.rs2) {
      port('EX1.rs2', 'idex1-fwdmuxb', 'ex2mem-fwdmuxb', 'memwb-fwdmuxb', 'idex1-ex1ex2-b', 'ex2mem-ex1ex2-b', 'memwb-ex1ex2-b', 'fwdmuxb-ex1ex2'); // prettier-ignore
    }
    // The forwarding UNIT is lit by the comparison it made, whether or not it selected a forward —
    // but only when there is something for it to have compared.
    if (ports.rs1 || ports.rs2) {
      c('fwdunit');
      w('idex1-fwdunit', 'EX1', ex1Inst, undefined, 'dec');
      w('ex2mem-fwdunit', 'EX1', ex1Inst, undefined, 'dec');
      w('memwb-fwdunit', 'EX1', ex1Inst, undefined, 'dec');
    }
    c('idex1');
    c('ex1ex2');
  }

  // --- EX2: compute, and resolve control flow ------------------------------------------------
  const ex2Inst = byStage.get('EX2');
  if (ex2Inst) {
    const d = ex2Inst.decoded;
    const events = eventsFor(ex2Inst);
    const aluOp = events.find((e) => e.type === 'alu-op');
    const resolved = events.find((e) => e.type === 'branch-resolved');

    if (aluOp?.type === 'alu-op') {
      c('alu');
      // The operands ride the EX1/EX2 latch, and `alu-op` names both — so unlike the un-forwarded
      // EX1 path, these two wires CAN be labelled honestly from this cycle's own events.
      w('ex1ex2-alu-a', 'EX2', ex2Inst, aluOp.a, 'dec');
      w('ex1ex2-alu-b', 'EX2', ex2Inst, aluOp.b, 'dec');
      const addrLike = LOADS.has(d.mnemonic) || STORES.has(d.mnemonic) || d.mnemonic === 'jalr';
      w('alu-ex2mem', 'EX2', ex2Inst, aluOp.result, addrLike ? 'hex' : 'dec');
    }
    // The dedicated pc/immediate adder: the link value (`jal`/`jalr`), `auipc`'s pc+imm, `lui`'s
    // pass-through, and every pc-relative target. Its INPUTS are labelled from the trace; its output
    // is not — the writeback value is not emitted until WB, cycles later, and inventing it here
    // would mean re-deriving ISA arithmetic in a view (INV-3/INV-7).
    const pcRelTransfer = resolved && resolved.type === 'branch-resolved' && d.mnemonic !== 'jalr';
    if (PCARITH_PRODUCERS.has(d.mnemonic) || pcRelTransfer) {
      c('pcarith');
      w('ex1ex2-pcarith-pc', 'EX2', ex2Inst, ex2Inst.pc, 'hex');
      w('ex1ex2-pcarith-imm', 'EX2', ex2Inst, d.imm, 'dec');
      if (PCARITH_PRODUCERS.has(d.mnemonic)) w('pcarith-ex2mem', 'EX2', ex2Inst, undefined, 'hex');
    }
    // The CORRECTION. EX2 redirects exactly when the prediction was WRONG, which is not the same as
    // "the branch was taken": under `static-taken` a correctly predicted taken branch needs no
    // correction (ID's bet already steered fetch two cycles earlier), and a LOST bet redirects back
    // to the FALL-THROUGH. `actual` comes back as the LABEL condition, which is a different
    // question — a TAKEN correction carries `pc + imm`, precisely the two operands drawn into
    // `pcarith`, so the label is explained by the picture; a lost bet's correction carries `pc + 4`,
    // and labelling that as pcarith's output would draw an adder fed `0` and `8` emitting `4`. So
    // the value is omitted there and the wire lights bare (INV-5: omit, never contradict).
    if (resolved && resolved.type === 'branch-resolved' && resolved.predicted !== resolved.actual) {
      const redirect = d.mnemonic === 'jalr' ? 'alu-pcmux' : 'pcarith-pcmux';
      w(redirect, 'EX2', ex2Inst, resolved.actual ? resolved.target : undefined, 'hex');
    }
    c('ex1ex2');
    c('ex2mem');
  }

  // --- MEM: the data memory (a load or a store); everything else rides past it ---------------
  const memInst = byStage.get('MEM');
  if (memInst) {
    const events = eventsFor(memInst);
    const memRead = events.find((e) => e.type === 'mem-read');
    const memWrite = events.find((e) => e.type === 'mem-write');
    const addr = memRead?.type === 'mem-read' ? memRead.addr : memWrite?.type === 'mem-write' ? memWrite.addr : undefined; // prettier-ignore
    if (memRead || memWrite) {
      c('dmem');
      w('ex2mem-dmem-addr', 'MEM', memInst, addr, 'hex');
    }
    if (memRead?.type === 'mem-read') w('dmem-memwb', 'MEM', memInst, memRead.value, 'hex');
    if (memWrite?.type === 'mem-write')
      w('ex2mem-dmem-data', 'MEM', memInst, memWrite.value, 'dec');
    // Everything that is not a load carries its value straight past the memory. Unlabelled by
    // necessity: it was computed while this instruction was in EX2, a cycle ago, so no event in THIS
    // trace holds it.
    if (!memRead) w('ex2mem-memwb', 'MEM', memInst, undefined, 'dec');
    c('ex2mem');
    c('memwb');
  }

  // --- WB: MemtoReg picks the source feeding the register write port -------------------------
  const wbInst = byStage.get('WB');
  if (wbInst) {
    const events = eventsFor(wbInst);
    const regWrite = events.find((e) => e.type === 'reg-write');
    c('memwb');
    if (regWrite?.type === 'reg-write') {
      writtenReg = regWrite.reg;
      const d = wbInst.decoded;
      const isLoad = LOADS.has(d.mnemonic);
      const ptrLike = isLoad || d.mnemonic === 'jal' || d.mnemonic === 'jalr' || d.mnemonic === 'auipc'; // prettier-ignore
      const fmt: Fmt = ptrLike ? 'hex' : 'dec';
      // Provenance, preserved through the contraction: a load's datum comes off the MDR path, and
      // everything else off the computed-value path. The `essentials` stand-in collapses only the
      // mux — same source (MEM/WB), same sink (the register file).
      w(isLoad ? 'memwb-wbmux-mdr' : 'memwb-wbmux-val', 'WB', wbInst, regWrite.value, fmt);
      w('wbmux-regfile', 'WB', wbInst, regWrite.value, fmt);
      w('memwb-regfile', 'WB', wbInst, regWrite.value, fmt);
    }
  }

  return { occupancy, components, wires, writtenReg };
}

/** The trace events that name an instruction — everything except `flush`, which reports stages. */
type TaggedEvent = Extract<CycleTrace['events'][number], { instr: string }>;
