/**
 * The classic 5-STAGE PIPELINE datapath, as pure data (M3 step 6) — the third bespoke geometry,
 * in the same two-halves shape as `datapath.ts` (M1) and `datapath-multi.ts` (M2):
 *
 *  1. GEOMETRY — a fixed set of {@link DatapathNode}s and {@link DatapathWire}s with hand-placed
 *     SVG coordinates: the textbook P&H pipelined datapath. Split I/D memories (Harvard — no
 *     structural hazard, unlike M2's single shared memory), the four inter-stage LATCH BARS drawn
 *     as the tall columns that divide the five stage bands, the forwarding network, and the
 *     hazard-detection unit.
 *  2. ACTIVATION — {@link activate}, a pure `CycleTrace → DatapathActivation`.
 *
 * This is its own geometry rather than a reuse, and the reason is INV-5 rather than taste: M2's
 * diagram draws ONE shared memory and ONE instruction in flight, so lighting it with a pipeline
 * trace would paint a picture that contradicts the machine.
 *
 * ## What is new here, and the one idea the rest falls out of
 *
 * **Activation is MULTI-INSTRUCTION.** Every previous model's `activate` lit one instruction's
 * path: single-cycle lit the whole fetch→writeback run of its one instruction, multi-cycle lit the
 * one phase slice its one in-flight instruction was in. This one lights up to FIVE stage slices for
 * five DIFFERENT instructions in the same cycle. So a lit wire must say WHICH instruction lit it
 * and WHICH stage it belongs to — {@link WireActivation} carries both — because the stage decides
 * the hue and the id is what a follow-highlight keys on (M3 step 7).
 *
 * **Occupancy comes from `instructions[].location`, NEVER from `state.micro`.** This is the trap
 * the milestone pinned in its decision table ("Which edge `micro` is snapshotted at") and it is
 * silent if you get it wrong: `state.micro` at cycle `i` is the END-of-cycle latch state — what the
 * latches present to cycle `i+1` — while `instructions[]` at cycle `i` reports who occupied each
 * stage DURING cycle `i`. A datapath sourced from `micro` draws the pipe ONE CYCLE AHEAD OF
 * ITSELF. Values likewise come only from THIS cycle's `events`. Nothing here reads `micro` at all.
 *
 * A consequence worth naming, because it looks like an omission and is not: the values riding the
 * latches BETWEEN stages are mostly unlabelled. A load's `aluOut` was computed while it was in EX,
 * one cycle before it sits in MEM, so at the cycle we are drawing it is not in the trace anywhere —
 * only the current cycle's events are. Those wires light without a value rather than borrow a
 * number that would be one cycle wrong (INV-5: omit, never contradict).
 *
 * ## Depth tiers AND config — two visibility axes (INV-5)
 *
 * The pipeline is where structural tiering finally has its best case. The forwarding unit, the two
 * forwarding muxes, and the hazard-detection unit are genuinely optional structure:
 *   - `essentials`/`detailed` — the clean five-stage skeleton: PC, the two memories, the register
 *     file, the ALU, and the four latch bars, with DIRECT contraction wires standing in for each
 *     hidden mux. `detailed` reveals the writeback mux and adds value labels.
 *   - `expert` — the forwarding unit, both forwarding muxes and the hazard unit appear; the
 *     contraction wires give way to the real through-mux wires, and control-line labels show.
 *
 * **And structure depends on CONFIG as well as tier, which is a first for this project.** With
 * `forwarding: false` the forwarding unit and its muxes are ABSENT — not dimmed, absent — along
 * with the forward paths themselves. That is lawful precisely because the trace genuinely has no
 * `forward` events in that position: drawing an idle forwarding network would be the contradiction.
 * The view already holds the config (the user set it), so this is not an engine back door.
 *
 * The hazard unit is deliberately NOT config-gated: it is live in BOTH positions (the load-use
 * stall survives forwarding; the RAW interlock is the whole story without it), so it gates on tier
 * alone. Only the forwarding unit, its muxes, and the forward paths gate on config.
 *
 * **Contraction visibility is DERIVED, not declared.** A contraction wire stands in for its unit
 * exactly when that unit is hidden — so `contracts` alone drives it (see {@link wireVisibleAt}),
 * and M2's parallel `maxTier` field is not carried over. That is not a tidy-up: the condition here
 * is two-dimensional (tier AND config), which no scalar `maxTier` can express, and deriving it
 * makes "the contraction appears exactly when its unit does not" structurally true rather than a
 * coincidence of two hand-maintained fields. {@link activate} stays tier- AND config-oblivious
 * (INV-2): it always lights the full expert path AND its contraction; the view filters.
 *
 * Honest simplifications (surfaced, not hidden): `lui`/`auipc`/`jal` produce their writeback value
 * with no `alu-op` (the engine mirrors the reference's event set), so — exactly as M1 and M2 did —
 * a small dedicated `pcarith` unit sources them, and no register is ever written "from nowhere".
 * The forwarding unit and hazard unit drive their muxes through the `expert` control LABELS rather
 * than drawn select lines, which is the convention M2 established for its three muxes.
 */

import { DEPTH_TIERS, type DepthTier } from '@cpu-viz/curriculum';
import type { Stage } from '@cpu-viz/engine-pipeline';
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

/** Narrow the trace's `location` string to a {@link Stage}. The pipeline always sets one of the
 *  five for an in-flight instruction; anything else is not ours to draw. */
function asStage(location: string): Stage | null {
  return (STAGES as readonly string[]).includes(location) ? (location as Stage) : null;
}

// --- Geometry -----------------------------------------------------------------------------

// WIDTH IS SET BY THE LABELS, NOT THE BOXES — a browser eyeball finding, and the one thing about
// this geometry that a reader would otherwise "tidy up" and break. The shared renderer de-collides
// a value label by nudging it VERTICALLY off its wire until it clears every component box. That
// works everywhere else in the project because the boxes are short. Here the four latch bars are
// 360px tall: a label that overlaps a bar's x-range has NO clear y to escape to, so it parks on top
// of the bar and is unreadable. Every gap where a 32-bit hex label lands beside a bar is therefore
// sized to hold it (~80px), which is what makes this canvas wide rather than any box needing room.
export const CANVAS = { width: 1200, height: 520 } as const;

export interface DatapathNode {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Draw as a trapezoid (mux) or notched adder rather than a plain box. */
  readonly shape?: 'box' | 'mux' | 'adder';
  /** Lowest depth tier at which this component is drawn. Absent ⇒ `essentials`. The forwarding
   *  unit, both forwarding muxes and the hazard unit set `'expert'` — the structural tiering this
   *  tier finally has a real case for. */
  readonly minTier?: DepthTier;
  /** Drawn ONLY when `forwarding` is on: the forwarding unit and its two muxes. The trace has no
   *  `forward` events in the other position, so drawing an idle forwarding network there would
   *  contradict it (INV-5). The hazard unit deliberately does NOT set this — it is live in both. */
  readonly forwardingOnly?: boolean;
  /** The control signal this unit drives — shown only at `expert` tier. */
  readonly controlLabel?: string;
}

// LAYOUT CONTRACT (checked by the geometry tests): five stage bands, divided by the four latch
// BARS (`ifid`/`idex`/`exmem`/`memwb`) — tall columns spanning y 70..430, which is what "5 stages,
// 4 latches" looks like. The instruction band flows left→right along y≈276 (PC → IMem → regfile →
// ALU → DMem → writeback mux). The control units ride the clear top band (y<150); the forward
// paths, the writeback bus and the two PC redirects ride the clear bottom rails (y>430), each on
// its own y so no two co-visible wires ever run collinearly. Shaped nodes (mux/adder) connect ONLY
// on their vertical edges (muxes in-left/out-right; adders on the two notch stubs + right output).
// See {@link shapePolygon} in DatapathDiagram for the outlines these anchors hit.
const NODE_LIST: readonly DatapathNode[] = [
  // --- IF: the next-pc selector, the PC, its +4 adder, and the instruction memory ---
  { id: 'pcmux', label: '', x: 40, y: 238, w: 18, h: 76, shape: 'mux', controlLabel: 'PCSrc' },
  { id: 'pc', label: 'PC', x: 76, y: 254, w: 40, h: 44 },
  { id: 'add4', label: '+4', x: 146, y: 120, w: 52, h: 44, shape: 'adder' },
  { id: 'imem', label: 'Instr\nMem', x: 146, y: 238, w: 72, h: 76 },
  // --- The four latch bars: the columns that divide the five stages ---
  { id: 'ifid', label: 'IF\n/\nID', x: 298, y: 70, w: 16, h: 360 },
  // --- ID: register file, sign-extend, and the hazard-detection unit ---
  { id: 'hazard', label: 'Hazard\ndetect', x: 354, y: 104, w: 100, h: 44, minTier: 'expert', controlLabel: 'PCWrite / IF-ID-Write' }, // prettier-ignore
  { id: 'regfile', label: 'Registers', x: 354, y: 214, w: 100, h: 120 },
  { id: 'signext', label: 'Sign\nExtend', x: 354, y: 364, w: 100, h: 40 },
  { id: 'idex', label: 'ID\n/\nEX', x: 494, y: 70, w: 16, h: 360 },
  // --- EX: the forwarding network, the ALU, and the dedicated pc/immediate adder ---
  { id: 'fwdunit', label: 'Forwarding\nunit', x: 522, y: 104, w: 120, h: 44, minTier: 'expert', forwardingOnly: true }, // prettier-ignore
  { id: 'fwdmuxa', label: '', x: 534, y: 196, w: 18, h: 64, shape: 'mux', minTier: 'expert', forwardingOnly: true, controlLabel: 'ForwardA' }, // prettier-ignore
  { id: 'fwdmuxb', label: '', x: 534, y: 286, w: 18, h: 64, shape: 'mux', minTier: 'expert', forwardingOnly: true, controlLabel: 'ForwardB' }, // prettier-ignore
  { id: 'alu', label: 'ALU', x: 598, y: 198, w: 86, h: 124, shape: 'adder' },
  { id: 'pcarith', label: 'PC\narith', x: 598, y: 364, w: 64, h: 46, shape: 'adder' },
  { id: 'exmem', label: 'EX\n/\nMEM', x: 764, y: 70, w: 16, h: 360 },
  // --- MEM: the data memory (split from the instruction memory — Harvard) ---
  { id: 'dmem', label: 'Data\nMem', x: 860, y: 222, w: 86, h: 88 },
  { id: 'memwb', label: 'MEM\n/\nWB', x: 1026, y: 70, w: 16, h: 360 },
  // --- WB: the writeback source selector ---
  { id: 'wbmux', label: '', x: 1122, y: 214, w: 18, h: 100, shape: 'mux', minTier: 'detailed', controlLabel: 'MemtoReg' }, // prettier-ignore
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
 *  centre-relative offsets (`at(id,'l',-140)`) would be unreadable; the y is the honest coordinate. */
function bar(id: string, side: 'l' | 'r', y: number): Pt {
  const n = NODES.get(id)!;
  return [side === 'l' ? n.x : n.x + n.w, y];
}
/** An adder's upper / lower left operand stub. `off` slides along that stub's vertical edge — the
 *  ALU's stubs each take three co-visible contraction wires (latch / EX-MEM / MEM-WB), which must
 *  not share a final run into one point. */
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
  /** Lowest tier at which this wire is drawn (absent ⇒ `essentials`). Rarely needed — a
   *  through-mux wire is already gated by its mux endpoint. */
  readonly minTier?: DepthTier;
  /** Part of the forwarding network, so drawn only when `forwarding` is on. Needed only where the
   *  endpoints alone would not say so — the forward CONTRACTIONS run latch→ALU, and both of those
   *  are drawn in every config. */
  readonly forwardingOnly?: boolean;
  /** For a CONTRACTION wire: the unit id it collapses. The `S → T` contraction must equal the
   *  expert path `S → unit → T` (same source, same sink) — the INV-5 lawfulness condition, checked
   *  by test. It is drawn exactly when that unit is NOT (see {@link wireVisibleAt}), so its
   *  visibility needs no second, hand-maintained field. Absent on non-contraction wires. */
  readonly contracts?: string;
}

const WIRE_LIST: readonly DatapathWire[] = [
  // --- IF: the selected pc addresses the instruction memory; the word latches into IF/ID ---
  { id: 'pcmux-pc', ends: ['pcmux', 'pc'], points: [at('pcmux', 'r'), at('pc', 'l')] }, // prettier-ignore
  { id: 'pc-imem', ends: ['pc', 'imem'], points: [at('pc', 'r'), at('imem', 'l')] }, // prettier-ignore
  { id: 'imem-ifid', ends: ['imem', 'ifid'], points: [at('imem', 'r'), bar('ifid', 'l', 276)] }, // prettier-ignore
  { id: 'pc-add4', ends: ['pc', 'add4'], points: [at('pc', 't', -10), [86, aLo('add4')[1]], aLo('add4')] }, // prettier-ignore
  // The sequential next-pc, back around to the selector. Rides the clear top rail (y=40).
  { id: 'add4-pcmux', ends: ['add4', 'pcmux'], points: [at('add4', 'r'), [220, 142], [220, 40], [22, 40], [22, 262], at('pcmux', 'l', -14)] }, // prettier-ignore
  // --- ID: IF/ID drives the register file, the sign-extender and the hazard unit ---
  { id: 'ifid-regfile', ends: ['ifid', 'regfile'], points: [bar('ifid', 'r', 234), at('regfile', 'l', -40)] }, // prettier-ignore
  { id: 'ifid-signext', ends: ['ifid', 'signext'], points: [bar('ifid', 'r', 384), at('signext', 'l')] }, // prettier-ignore
  { id: 'regfile-idex-a', ends: ['regfile', 'idex'], points: [at('regfile', 'r', -16), bar('idex', 'l', 258)] }, // prettier-ignore
  { id: 'regfile-idex-b', ends: ['regfile', 'idex'], points: [at('regfile', 'r', 24), bar('idex', 'l', 298)] }, // prettier-ignore
  { id: 'signext-idex', ends: ['signext', 'idex'], points: [at('signext', 'r'), bar('idex', 'l', 384)] }, // prettier-ignore
  // The hazard unit: reads the decoding instruction's sources and the executing one's destination,
  // and answers by HOLDING the PC and the IF/ID latch (the repeated `IF IF` of every textbook
  // diagram). Its two outputs ride the top rail (y=56), clear of the latch bars.
  { id: 'ifid-hazard', ends: ['ifid', 'hazard'], points: [bar('ifid', 'r', 126), at('hazard', 'l')] }, // prettier-ignore
  { id: 'idex-hazard', ends: ['idex', 'hazard'], points: [bar('idex', 'l', 110), at('hazard', 'r', -16)] }, // prettier-ignore
  { id: 'hazard-ifid', ends: ['hazard', 'ifid'], points: [at('hazard', 'l', 14), bar('ifid', 'r', 140)] }, // prettier-ignore
  { id: 'hazard-pc', ends: ['hazard', 'pc'], points: [at('hazard', 't'), [404, 56], [106, 56], at('pc', 't', 10)] }, // prettier-ignore
  // --- EX: the forwarding muxes pick each operand's source, then the ALU ---
  { id: 'idex-fwdmuxa', ends: ['idex', 'fwdmuxa'], points: [bar('idex', 'r', 228), at('fwdmuxa', 'l')] }, // prettier-ignore
  { id: 'idex-fwdmuxb', ends: ['idex', 'fwdmuxb'], points: [bar('idex', 'r', 318), at('fwdmuxb', 'l')] }, // prettier-ignore
  { id: 'exmem-fwdmuxa', ends: ['exmem', 'fwdmuxa'], points: [at('exmem', 'b', -4), [768, 444], [518, 444], [518, 250], at('fwdmuxa', 'l', 22)] }, // prettier-ignore
  { id: 'memwb-fwdmuxa', ends: ['memwb', 'fwdmuxa'], points: [at('memwb', 'b', -4), [1030, 456], [514, 456], [514, 206], at('fwdmuxa', 'l', -22)] }, // prettier-ignore
  { id: 'exmem-fwdmuxb', ends: ['exmem', 'fwdmuxb'], points: [at('exmem', 'b', 4), [776, 438], [522, 438], [522, 340], at('fwdmuxb', 'l', 22)] }, // prettier-ignore
  { id: 'memwb-fwdmuxb', ends: ['memwb', 'fwdmuxb'], points: [at('memwb', 'b', 4), [1038, 462], [526, 462], [526, 296], at('fwdmuxb', 'l', -22)] }, // prettier-ignore
  { id: 'fwdmuxa-alu', ends: ['fwdmuxa', 'alu'], points: [at('fwdmuxa', 'r'), [576, 228], [576, aUp('alu')[1]], aUp('alu')] }, // prettier-ignore
  { id: 'fwdmuxb-alu', ends: ['fwdmuxb', 'alu'], points: [at('fwdmuxb', 'r'), [576, 318], [576, aLo('alu')[1]], aLo('alu')] }, // prettier-ignore
  // The forwarding unit compares the executing instruction's sources against the two latches ahead
  // of it; like M2's muxes, it drives its selectors through the `expert` control labels.
  { id: 'idex-fwdunit', ends: ['idex', 'fwdunit'], points: [bar('idex', 'r', 126), at('fwdunit', 'l')] }, // prettier-ignore
  { id: 'exmem-fwdunit', ends: ['exmem', 'fwdunit'], points: [bar('exmem', 'l', 126), at('fwdunit', 'r')] }, // prettier-ignore
  { id: 'memwb-fwdunit', ends: ['memwb', 'fwdunit'], points: [at('memwb', 't'), [1034, 56], [602, 56], at('fwdunit', 't', 20)] }, // prettier-ignore
  // The three CONTRACTIONS of each forwarding mux — one per source, exactly as M2 contracts its
  // 4-source writeback mux. Each ends on its own y along the ALU's operand stub: all three are
  // co-visible below `expert`, so they must not share a final run into one point.
  { id: 'idex-alu-a', ends: ['idex', 'alu'], points: [bar('idex', 'r', aUp('alu')[1]), aUp('alu')], contracts: 'fwdmuxa' }, // prettier-ignore
  { id: 'exmem-alu-a', ends: ['exmem', 'alu'], points: [at('exmem', 'b', -4), [768, 444], [590, 444], [590, 206], aUp('alu', -11.84)], contracts: 'fwdmuxa', forwardingOnly: true }, // prettier-ignore
  { id: 'memwb-alu-a', ends: ['memwb', 'alu'], points: [at('memwb', 'b', -4), [1030, 456], [582, 456], [582, 230], aUp('alu', 12.16)], contracts: 'fwdmuxa', forwardingOnly: true }, // prettier-ignore
  { id: 'idex-alu-b', ends: ['idex', 'alu'], points: [bar('idex', 'r', aLo('alu')[1]), aLo('alu')], contracts: 'fwdmuxb' }, // prettier-ignore
  { id: 'exmem-alu-b', ends: ['exmem', 'alu'], points: [at('exmem', 'b', 4), [776, 438], [574, 438], [574, 290], aLo('alu', -12.16)], contracts: 'fwdmuxb', forwardingOnly: true }, // prettier-ignore
  { id: 'memwb-alu-b', ends: ['memwb', 'alu'], points: [at('memwb', 'b', 4), [1038, 462], [566, 462], [566, 314], aLo('alu', 11.84)], contracts: 'fwdmuxb', forwardingOnly: true }, // prettier-ignore
  // The dedicated pc/immediate adder — `lui`/`auipc`/`jal` emit no `alu-op`, so their writeback
  // value needs an honest source (the same call M1 and M2 made). It also computes pc-relative
  // branch and jump targets.
  { id: 'idex-pcarith-pc', ends: ['idex', 'pcarith'], points: [bar('idex', 'r', aUp('pcarith')[1]), aUp('pcarith')] }, // prettier-ignore
  { id: 'idex-pcarith-imm', ends: ['idex', 'pcarith'], points: [bar('idex', 'r', aLo('pcarith')[1]), aLo('pcarith')] }, // prettier-ignore
  { id: 'alu-exmem', ends: ['alu', 'exmem'], points: [at('alu', 'r'), bar('exmem', 'l', 260)] }, // prettier-ignore
  { id: 'pcarith-exmem', ends: ['pcarith', 'exmem'], points: [at('pcarith', 'r'), bar('exmem', 'l', 387)] }, // prettier-ignore
  // The two BRANCH REDIRECTS, drawn from `branch-resolved` — the honest trace signal M2's datapath
  // did not have (which is why it omitted its redirect, and why M3 does not inherit M2's step 5c).
  // pc-relative transfers redirect from the pc adder; `jalr` alone redirects from the ALU, because
  // a REGISTER supplies its target. Each rides its own bottom rail back to the selector.
  { id: 'pcarith-pcmux', ends: ['pcarith', 'pcmux'], points: [at('pcarith', 'r', 8), [678, 395], [678, 496], [16, 496], [16, 286], at('pcmux', 'l', 10)] }, // prettier-ignore
  { id: 'alu-pcmux', ends: ['alu', 'pcmux'], points: [at('alu', 'r', 20), [696, 280], [696, 484], [30, 484], [30, 300], at('pcmux', 'l', 24)] }, // prettier-ignore
  // --- MEM: EX/MEM addresses the data memory; the value bypasses it for everything but a load ---
  { id: 'exmem-dmem-addr', ends: ['exmem', 'dmem'], points: [bar('exmem', 'r', 266), at('dmem', 'l')] }, // prettier-ignore
  { id: 'exmem-dmem-data', ends: ['exmem', 'dmem'], points: [bar('exmem', 'r', 300), at('dmem', 'l', 34)] }, // prettier-ignore
  { id: 'dmem-memwb', ends: ['dmem', 'memwb'], points: [at('dmem', 'r'), bar('memwb', 'l', 266)] }, // prettier-ignore
  { id: 'exmem-memwb', ends: ['exmem', 'memwb'], points: [bar('exmem', 'r', 200), bar('memwb', 'l', 200)] }, // prettier-ignore
  // --- WB: MemtoReg picks the load datum or the computed value, back to the write port ---
  { id: 'memwb-wbmux-val', ends: ['memwb', 'wbmux'], points: [bar('memwb', 'r', 240), at('wbmux', 'l', -24)] }, // prettier-ignore
  { id: 'memwb-wbmux-mdr', ends: ['memwb', 'wbmux'], points: [bar('memwb', 'r', 288), at('wbmux', 'l', 24)] }, // prettier-ignore
  { id: 'wbmux-regfile', ends: ['wbmux', 'regfile'], points: [at('wbmux', 'r'), [1168, 264], [1168, 470], [338, 470], [338, 322], at('regfile', 'l', 48)] }, // prettier-ignore
  { id: 'memwb-regfile', ends: ['memwb', 'regfile'], points: [bar('memwb', 'r', 290), [1152, 290], [1152, 470], [330, 470], [330, 310], at('regfile', 'l', 36)], contracts: 'wbmux' }, // prettier-ignore
] as const;

export const WIRES: readonly DatapathWire[] = WIRE_LIST;

const WIRE_BY_ID: ReadonlyMap<string, DatapathWire> = new Map(WIRE_LIST.map((w) => [w.id, w]));

// --- Depth tiers × config ------------------------------------------------------------------

/** True when an element requiring `minTier` (absent ⇒ `essentials`) is drawn at `current`. */
export function tierVisible(minTier: DepthTier | undefined, current: DepthTier): boolean {
  return DEPTH_TIERS.indexOf(minTier ?? 'essentials') <= DEPTH_TIERS.indexOf(current);
}

/** Whether a node is drawn, on BOTH axes: deep enough a tier, and — for the forwarding unit and
 *  its muxes only — the forwarding position that makes it real. */
export function nodeVisibleAt(node: DatapathNode, tier: DepthTier, forwarding: boolean): boolean {
  return tierVisible(node.minTier, tier) && (!node.forwardingOnly || forwarding);
}

/**
 * Whether a wire is drawn at (`tier`, `forwarding`): deep enough a tier, on the right side of the
 * config gate, NOT superseded by the unit it contracts, and with both endpoint nodes drawn — so no
 * wire ever dangles into a hidden unit (INV-5).
 *
 * The contraction rule is the load-bearing one and it is DERIVED rather than declared: a
 * contraction stands in for its unit exactly when that unit is not drawn. That covers both axes at
 * once — the forwarding muxes vanish below `expert` AND when forwarding is off, and the contraction
 * appears in both cases without a second field having to agree with this one.
 */
export function wireVisibleAt(wire: DatapathWire, tier: DepthTier, forwarding: boolean): boolean {
  if (!tierVisible(wire.minTier, tier)) return false;
  if (wire.forwardingOnly && !forwarding) return false;
  if (wire.contracts && nodeVisibleAt(NODES.get(wire.contracts)!, tier, forwarding)) return false;
  return wire.ends.every((id) => nodeVisibleAt(NODES.get(id)!, tier, forwarding));
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

/** A lit wire. Unlike every earlier model, a cycle lights wires for up to FIVE different
 *  instructions, so each one says who lit it and from which stage. */
export interface WireActivation {
  /** The stable id (INV-4) of the instruction whose work this wire is doing. */
  readonly instr: string;
  /** The stage that instruction is in — which is what picks the wire's hue. */
  readonly stage: Stage;
  /** The value flowing, when THIS cycle's events know it. Absent is honest: a value riding a latch
   *  between stages was emitted in an earlier cycle and is not in this trace (see the file docs). */
  readonly value?: number;
  readonly fmt: Fmt;
}

export interface DatapathActivation {
  /** Which instruction occupies each stage this cycle — from `instructions[].location`, the only
   *  source that describes THIS cycle (see the file docs on `micro`). Up to five entries. */
  readonly occupancy: ReadonlyMap<Stage, string>;
  /** Ids of components on an active path this cycle. Deliberately a plain set, with no instruction
   *  or stage attached: a component can be busy for TWO instructions at once — the register file is
   *  read by ID and written by WB in the same cycle (the pinned same-cycle WB→ID rule), and every
   *  latch bar is written by the stage on its left while the stage on its right reads it. There is
   *  no single hue such a box could take, so components stay hue-neutral and the WIRES carry the
   *  stage color. Wires are unambiguous: each lies on exactly one side of one bar. */
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

/**
 * Derive which datapath components/wires are active THIS cycle, for EVERY instruction in flight,
 * and the value on each. Multi-instruction and stage-driven: each stage's occupant comes from
 * `instructions[].location` and its values from this cycle's `events` filtered by that
 * instruction's id — never from `state.micro`, which is a cycle ahead (see the file docs).
 *
 * Both the expert through-mux wires AND their contraction wires are lit, in every config
 * (activation is tier- and config-oblivious, INV-2); the view filters. Returns an empty activation
 * for the pre-run state.
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
  /** Light a wire for `inst`'s work in `stage`, and (as M1/M2 do) light both its endpoints — which
   *  is what makes the coherence litmus hold by construction rather than by vigilance. */
  const w = (
    id: string,
    stage: Stage,
    inst: InstructionInstance,
    value: number | undefined,
    fmt: Fmt,
  ): void => {
    // prettier-ignore
    const wire = WIRE_BY_ID.get(id);
    if (!wire) throw new Error(`activate: unknown wire id "${id}"`);
    wires.set(id, { instr: inst.id, stage, value, fmt });
    for (const end of wire.ends) c(end);
  };
  /** This cycle's events belonging to one instruction. `flush` carries no `instr` and is excluded. */
  const eventsFor = (inst: InstructionInstance): readonly TaggedEvent[] =>
    trace.events.filter((e): e is TaggedEvent => 'instr' in e && e.instr === inst.id);

  // --- IF: the selected pc addresses the instruction memory ---------------------------------
  const ifInst = byStage.get('IF');
  if (ifInst) {
    // `inst.pc`/`inst.encoding` rather than the `instr-fetch` event: an instruction HELD in IF by a
    // stall was fetched in an earlier cycle and emits no event now (the pinned "what a stall does
    // to IF"), but the pc it presents to the memory is unchanged — which is what a hold IS.
    // Only ONE of these carries the pc as a LABEL, though all three carry it as a value. The pc
    // flows out of the selector, into the memory, and into the adder — labelling each printed the
    // identical 32-bit hex string three times in the tightest band of the diagram, which the
    // browser eyeball caught as a stack of near-identical boxes. Label the wire whose value is the
    // question ("which address is being fetched?"), and let the other two just be lit.
    w('pcmux-pc', 'IF', ifInst, undefined, 'hex');
    w('pc-imem', 'IF', ifInst, ifInst.pc, 'hex');
    w('imem-ifid', 'IF', ifInst, ifInst.encoding, 'hex');
    w('pc-add4', 'IF', ifInst, undefined, 'hex');
    w('add4-pcmux', 'IF', ifInst, (ifInst.pc + 4) >>> 0, 'hex');
  }

  // --- ID: decode, read the register file, and check for a hazard ----------------------------
  const idInst = byStage.get('ID');
  if (idInst) {
    const d = idInst.decoded;
    const events = eventsFor(idInst);
    // The encoding is labelled once, at the fetch that produced it. Re-printing it on ID's two
    // input wires said nothing new (decoding is what ID DOES to it) and cost two more 32-bit hex
    // boxes beside the IF/ID bar, where there is no clear y for them to escape to. ID's own
    // answers — the register values and the immediate — are the labels that carry the meaning.
    w('ifid-regfile', 'ID', idInst, undefined, 'hex');
    const usesImm =
      d.format !== 'R' && d.mnemonic !== 'ecall' && d.mnemonic !== 'ebreak' && d.mnemonic !== 'fence'; // prettier-ignore
    if (usesImm) {
      w('ifid-signext', 'ID', idInst, undefined, 'hex');
      w('signext-idex', 'ID', idInst, d.imm, 'dec');
    }
    const regReads = events.filter((e) => e.type === 'reg-read');
    if (regReads[0]) w('regfile-idex-a', 'ID', idInst, regReads[0].value, 'dec');
    if (regReads[1]) w('regfile-idex-b', 'ID', idInst, regReads[1].value, 'dec');
    // The hazard unit lights exactly when it FIRED — a `stall` event naming this instruction. It is
    // combinational and always checking, but "lit" means "on the active path this cycle" in every
    // model here, and a permanently-lit interlock would say nothing about when the bubble happens.
    // Its answer is to hold the PC and the IF/ID latch: the repeated `IF IF` cell of the textbook.
    if (events.some((e) => e.type === 'stall')) {
      w('ifid-hazard', 'ID', idInst, undefined, 'dec');
      w('idex-hazard', 'ID', idInst, undefined, 'dec');
      w('hazard-ifid', 'ID', idInst, undefined, 'dec');
      w('hazard-pc', 'ID', idInst, undefined, 'dec');
    }
  }

  // --- EX: forward, compute, resolve control flow --------------------------------------------
  const exInst = byStage.get('EX');
  if (exInst) {
    const d = exInst.decoded;
    const events = eventsFor(exInst);
    const aluOp = events.find((e) => e.type === 'alu-op');
    const forwards = events.filter((e) => e.type === 'forward');
    const resolved = events.find((e) => e.type === 'branch-resolved');

    if (aluOp) {
      c('alu');
      // Each operand's source is picked by its forwarding mux — so exactly ONE input path lights
      // per port. Lighting the register-file path as well when a forward fires would draw the
      // stale value flowing into the ALU beside the fresh one, which is the precise misconception
      // this tier exists to break: forwarding is a change of PATH, not an extra wire.
      const port = (
        to: string,
        muxWire: string,
        exWire: string,
        wbWire: string,
        contraction: string,
        exContraction: string,
        wbContraction: string,
        value: number,
      ): void => {
        const fwd = forwards.find((e) => e.type === 'forward' && e.to === to);
        if (fwd && fwd.type === 'forward') {
          const fromExMem = fwd.from === 'EX/MEM';
          w(fromExMem ? exWire : wbWire, 'EX', exInst, fwd.value, 'dec');
          w(fromExMem ? exContraction : wbContraction, 'EX', exInst, fwd.value, 'dec');
        } else {
          w(muxWire, 'EX', exInst, value, 'dec');
          w(contraction, 'EX', exInst, value, 'dec');
        }
        w(muxWire.startsWith('idex-fwdmuxa') ? 'fwdmuxa-alu' : 'fwdmuxb-alu', 'EX', exInst, value, 'dec'); // prettier-ignore
      };
      port('EX.rs1', 'idex-fwdmuxa', 'exmem-fwdmuxa', 'memwb-fwdmuxa', 'idex-alu-a', 'exmem-alu-a', 'memwb-alu-a', aluOp.a); // prettier-ignore
      port('EX.rs2', 'idex-fwdmuxb', 'exmem-fwdmuxb', 'memwb-fwdmuxb', 'idex-alu-b', 'exmem-alu-b', 'memwb-alu-b', aluOp.b); // prettier-ignore

      const addrLike = LOADS.has(d.mnemonic) || STORES.has(d.mnemonic) || d.mnemonic === 'jalr';
      w('alu-exmem', 'EX', exInst, aluOp.result, addrLike ? 'hex' : 'dec');
    }
    // The forwarding UNIT is lit by the comparison it made, whether or not it selected a forward —
    // but only when there is something in EX for it to have compared, i.e. alongside the muxes.
    if (aluOp || forwards.length > 0) {
      c('fwdunit');
      w('idex-fwdunit', 'EX', exInst, undefined, 'dec');
      w('exmem-fwdunit', 'EX', exInst, undefined, 'dec');
      w('memwb-fwdunit', 'EX', exInst, undefined, 'dec');
    }
    // The dedicated pc/immediate adder: the link value (`jal`/`jalr`), `auipc`'s pc+imm, `lui`'s
    // pass-through, and every pc-relative target. Its INPUTS are labelled from the trace; its
    // output is not — the writeback value is not emitted until WB, cycles later, and inventing it
    // here would mean re-deriving ISA arithmetic in a view (INV-3/INV-7).
    const pcRelTransfer = resolved && resolved.type === 'branch-resolved' && d.mnemonic !== 'jalr';
    if (PCARITH_PRODUCERS.has(d.mnemonic) || pcRelTransfer) {
      c('pcarith');
      w('idex-pcarith-pc', 'EX', exInst, exInst.pc, 'hex');
      w('idex-pcarith-imm', 'EX', exInst, d.imm, 'dec');
      if (PCARITH_PRODUCERS.has(d.mnemonic)) w('pcarith-exmem', 'EX', exInst, undefined, 'hex');
    }
    // The BRANCH REDIRECT — the picture M2's datapath could not honestly draw. Only a TAKEN
    // transfer redirects; a not-taken branch still resolves (and still emits `branch-resolved`),
    // but the sequential +4 the pipe already fetched is the answer, so nothing is redirected.
    if (resolved && resolved.type === 'branch-resolved' && resolved.actual) {
      const redirect = d.mnemonic === 'jalr' ? 'alu-pcmux' : 'pcarith-pcmux';
      w(redirect, 'EX', exInst, resolved.target, 'hex');
    }
    c('idex');
    c('exmem');
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
      w('exmem-dmem-addr', 'MEM', memInst, addr, 'hex');
    }
    if (memRead?.type === 'mem-read') w('dmem-memwb', 'MEM', memInst, memRead.value, 'hex');
    if (memWrite?.type === 'mem-write') w('exmem-dmem-data', 'MEM', memInst, memWrite.value, 'dec');
    // Everything that is not a load carries its value straight past the memory. Unlabelled by
    // necessity: it was computed while this instruction was in EX, a cycle ago, so no event in THIS
    // trace holds it (see the file docs — this is the `micro` trap's honest consequence).
    if (!memRead) w('exmem-memwb', 'MEM', memInst, undefined, 'dec');
    c('exmem');
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
