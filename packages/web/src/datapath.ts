/**
 * The canonical single-cycle RV32I datapath, as pure data (handoff §11 step 8; tech stack §14
 * "hand-author the datapath layout"). This module has two halves, both framework-agnostic and
 * headlessly testable:
 *
 *  1. GEOMETRY — a fixed set of {@link DatapathNode}s (boxes) and {@link DatapathWire}s (the
 *     wires between them) with hand-placed SVG coordinates. This is the textbook single-cycle
 *     diagram; it never changes with the program.
 *  2. ACTIVATION — {@link activate}, a pure function `CycleTrace → DatapathActivation` that says
 *     which components and wires are on the active path THIS cycle, and what value flows on each
 *     wire. The SVG view ({@link Datapath}) renders geometry and lights it with the activation.
 *
 * The activation is derived from the trace only (INV-3): the *topology* comes from the decoded
 * instruction on `InstructionInstance` (so instructions that emit no events — `lui` has no
 * reg-read/alu-op, `jal`/`auipc` compute the target inline — still light a complete path), and
 * the *values* come from the emitted events (reg-read, alu-op, mem-read/write, reg-write) where
 * they exist,
 * falling back to `decoded.imm` / the instruction `pc` for segments no event covers.
 *
 * DEPTH TIERS (build-order step 9, handoff §4). §4 splits explanation depth across three layers;
 * on the single-cycle datapath we tier the **representational fidelity** (layer 2), NOT the
 * structural detail (layer 1):
 *   - `essentials` — the full datapath, but **without wire value labels**: watch the instruction
 *     flow through the stages (the phase stepper is the story).
 *   - `detailed`   — the same structure **plus the value on each active wire**.
 *   - `expert`     — plus each mux's **control-line label** (`ALUSrc`/`MemToReg`).
 * This is lawful by construction (INV-5): every tier shows the SAME wires, so nothing is ever
 * omitted that a higher tier contradicts — each tier only *adds* labels. {@link activate} stays
 * completely tier-oblivious (INV-2); it always emits full state + values, and the renderer merely
 * chooses which labels to draw.
 *
 * Why not tier the *structure* (hide boxes at `essentials`)? On a connected single-cycle datapath
 * every box is on the active path for some common instruction (`alusrc` for every ALU op,
 * `immgen` for imm/load/store, `branchadd` for branches, `add4`/`pcsel` for every fetch), so
 * hiding a box leaves a lit wire dangling into empty space — worse, a *contradiction* ("the ALU
 * produced 5 from one operand"), which INV-5 forbids. Structural hiding pays off only where units
 * are NOT on every instruction's path — the pipeline tier's forwarding mux / hazard unit (§4's
 * worked example). The `minTier` mechanism below is kept and wired through for exactly that; it is
 * simply unused (no node sets it) on single-cycle.
 */

import { DEPTH_TIERS, type DepthTier } from '@cpu-viz/curriculum';
import type { CycleTrace } from '@cpu-viz/trace';

/** The five textbook within-cycle phases. Single-cycle does all of them in one physical tick;
 *  the split is a useful pedagogical fiction (handoff §5) used to sequence the animation. */
export type Phase = 'IF' | 'ID' | 'EX' | 'MEM' | 'WB';
export const PHASES: readonly Phase[] = ['IF', 'ID', 'EX', 'MEM', 'WB'];
export const PHASE_LABELS: Record<Phase, string> = {
  IF: 'Fetch',
  ID: 'Decode',
  EX: 'Execute',
  MEM: 'Memory',
  WB: 'Writeback',
};
const PHASE_INDEX: Record<Phase, number> = { IF: 0, ID: 1, EX: 2, MEM: 3, WB: 4 };
/** True when `phase` is at or before `upTo` in the fetch→writeback order. */
export function phaseVisibleAt(phase: Phase, upTo: Phase): boolean {
  return PHASE_INDEX[phase] <= PHASE_INDEX[upTo];
}

// --- Geometry -----------------------------------------------------------------------------

export const CANVAS = { width: 900, height: 470 } as const;

export interface DatapathNode {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The within-cycle phase this component belongs to (for progressive reveal / dimming). */
  readonly stage: Phase;
  /** Draw as a trapezoid (a mux/adder) rather than a plain box. */
  readonly shape?: 'box' | 'mux' | 'adder';
  /** Lowest depth tier at which this component is drawn (handoff §4). Absent ⇒ `essentials`.
   *  **Unused on single-cycle** (see the module header): every box is on the active path for
   *  some common instruction, so hiding one would dangle a lit wire. Reserved for the pipeline
   *  tier, where forwarding/hazard units genuinely aren't on every instruction's path. */
  readonly minTier?: DepthTier;
  /** The control signal this mux is driven by — shown as an annotation only at `expert` tier. */
  readonly controlLabel?: string;
}

// All boxes are drawn at every tier (no `minTier` set): the single-cycle datapath tiers its
// representation, not its structure (see the module header). `expert` adds each mux's control
// label — the only per-node tier variation here. `pcsel` already carries its identity label at
// every tier, so only the two otherwise-blank muxes (alusrc, wbmux) get a control label.
//
// LAYOUT CONTRACT (checked by the geometry tests): the main dataflow band is centered on y≈280,
// left→right PC → IMem → RegFile → ALUSrc/ALU → DMem → WBmux. Shaped nodes (mux/adder) connect
// ONLY on their vertical edges — muxes take inputs on the left edge and drive their output from the
// right edge; adders take operands on the two left stubs (above/below the notch) and drive the
// output from the right edge. Every wire is orthogonal (H/V segments only) and every endpoint sits
// on a real drawn edge; feedback/select buses ride the clear rails at the very top (y<52) and the
// bottom (y>440). See {@link shapePolygon} for the exact outlines these anchors must land on.
const NODE_LIST: readonly DatapathNode[] = [
  { id: 'pcsel', label: 'PCsrc', x: 24, y: 244, w: 28, h: 72, stage: 'WB', shape: 'mux' },
  { id: 'pc', label: 'PC', x: 76, y: 258, w: 44, h: 44, stage: 'IF' },
  { id: 'add4', label: '+4', x: 132, y: 52, w: 62, h: 46, stage: 'IF', shape: 'adder' },
  { id: 'imem', label: 'Instr\nMemory', x: 150, y: 234, w: 98, h: 92, stage: 'IF' },
  { id: 'regfile', label: 'Registers', x: 312, y: 205, w: 116, h: 150, stage: 'ID' },
  { id: 'immgen', label: 'Imm\nGen', x: 312, y: 384, w: 116, h: 44, stage: 'ID' },
  { id: 'branchadd', label: '+', x: 470, y: 52, w: 62, h: 54, stage: 'EX', shape: 'adder' },
  { id: 'alusrc', label: '', x: 474, y: 279, w: 26, h: 80, stage: 'EX', shape: 'mux', controlLabel: 'ALUSrc' }, // prettier-ignore
  { id: 'alu', label: 'ALU', x: 536, y: 235, w: 92, h: 100, stage: 'EX', shape: 'adder' },
  { id: 'dmem', label: 'Data\nMemory', x: 690, y: 239, w: 98, h: 92, stage: 'MEM' },
  { id: 'wbmux', label: '', x: 836, y: 232, w: 26, h: 140, stage: 'WB', shape: 'mux', controlLabel: 'MemToReg' }, // prettier-ignore
] as const;

export const NODES: ReadonlyMap<string, DatapathNode> = new Map(NODE_LIST.map((n) => [n.id, n]));

type Pt = readonly [number, number];
/** Anchor a point on a node's edge. l/r = side midpoints + `off` along the (vertical) edge; t/b =
 *  top/bottom edge + `off` along the (horizontal) edge; c = center + vertical `off`. For muxes,
 *  l/r land on the vertical edges (valid); for adders use {@link aUp}/{@link aLo} for the left
 *  operand stubs and `r` for the output — never t/b/l (those sit on the slanted outline / notch). */
function at(id: string, side: 'l' | 'r' | 't' | 'b' | 'c', off = 0): Pt {
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
    case 'c':
      return [n.x + n.w / 2, n.y + n.h / 2 + off];
  }
}
/** An adder's upper / lower left operand stub — the vertical edge segments above / below the notch
 *  (fractions match {@link shapePolygon}'s notch at 0.18·h, so the stub mid-points are 0.16 / 0.84). */
function aUp(id: string): Pt {
  const n = NODES.get(id)!;
  return [n.x, n.y + n.h * 0.16];
}
function aLo(id: string): Pt {
  const n = NODES.get(id)!;
  return [n.x, n.y + n.h * 0.84];
}

export interface DatapathWire {
  readonly id: string;
  /** The two node ids this wire physically connects (its polyline runs edge-to-edge between
   *  them). Drives depth-tier visibility: a wire is drawn iff BOTH ends are drawn, so hiding a
   *  box never leaves a dangling wire (unlike the `id`, which is a display name and does NOT
   *  reliably name the endpoints — e.g. `regfile-rs2` actually terminates at `alusrc`). */
  readonly ends: readonly [string, string];
  readonly points: readonly Pt[];
  readonly stage: Phase;
}

const WIRE_LIST: readonly DatapathWire[] = [
  // --- IF: the next-PC mux drives PC; PC fetches the instruction and feeds the +4 adder ---
  { id: 'pcsel-pc', ends: ['pcsel', 'pc'], points: [at('pcsel', 'r'), at('pc', 'l')], stage: 'WB' },
  { id: 'pc-imem', ends: ['pc', 'imem'], points: [at('pc', 'r'), at('imem', 'l')], stage: 'IF' },
  { id: 'pc-add4', ends: ['pc', 'add4'], points: [at('pc', 't', -8), [90, aLo('add4')[1]], aLo('add4')], stage: 'IF' }, // prettier-ignore
  { id: 'add4-pcsel', ends: ['add4', 'pcsel'], points: [at('add4', 'r'), [194, 40], [12, 40], [12, 270], at('pcsel', 'l', -10)], stage: 'IF' }, // prettier-ignore
  // --- ID: the fetched word feeds the register file (selectors) and the immediate generator ---
  { id: 'imem-regfile', ends: ['imem', 'regfile'], points: [at('imem', 'r', -30), at('regfile', 'l', -30)], stage: 'ID' }, // prettier-ignore
  { id: 'imem-immgen', ends: ['imem', 'immgen'], points: [at('imem', 'r', 30), [248, at('immgen', 'l')[1]], at('immgen', 'l')], stage: 'ID' }, // prettier-ignore
  // --- EX: register values + immediate into the ALU (via ALUSrc) and the branch adder ---
  { id: 'regfile-rs1', ends: ['regfile', 'alu'], points: [at('regfile', 'r', -29), aUp('alu')], stage: 'EX' }, // prettier-ignore
  { id: 'regfile-rs2', ends: ['regfile', 'alusrc'], points: [at('regfile', 'r', 20), at('alusrc', 'l', -19)], stage: 'EX' }, // prettier-ignore
  { id: 'imm-alusrc', ends: ['immgen', 'alusrc'], points: [at('immgen', 'r', -8), [448, at('immgen', 'r', -8)[1]], [448, at('alusrc', 'l', 25)[1]], at('alusrc', 'l', 25)], stage: 'EX' }, // prettier-ignore
  { id: 'alusrc-alu', ends: ['alusrc', 'alu'], points: [at('alusrc', 'r'), aLo('alu')], stage: 'EX' }, // prettier-ignore
  { id: 'pc-branchadd', ends: ['pc', 'branchadd'], points: [at('pc', 't', 12), [110, 44], [470, 44], aUp('branchadd')], stage: 'EX' }, // prettier-ignore
  { id: 'imm-branchadd', ends: ['immgen', 'branchadd'], points: [at('immgen', 'r', -18), [462, at('immgen', 'r', -18)[1]], [462, aLo('branchadd')[1]], aLo('branchadd')], stage: 'EX' }, // prettier-ignore
  // --- MEM: ALU result addresses data memory; rs2 supplies store data on the bottom rail ---
  { id: 'alu-dmem', ends: ['alu', 'dmem'], points: [at('alu', 'r'), at('dmem', 'l')], stage: 'MEM' }, // prettier-ignore
  { id: 'rs2-dmem', ends: ['regfile', 'dmem'], points: [at('regfile', 'r', 60), [466, at('regfile', 'r', 60)[1]], [466, 452], [739, 452], at('dmem', 'b')], stage: 'MEM' }, // prettier-ignore
  // --- WB: each writeback source into the mux, then the result back to the register write port ---
  { id: 'alu-wb', ends: ['alu', 'wbmux'], points: [at('alu', 'r', 18), [650, at('alu', 'r', 18)[1]], [650, 400], [824, 400], [824, at('wbmux', 'l', 68)[1]], at('wbmux', 'l', 68)], stage: 'WB' }, // prettier-ignore
  { id: 'dmem-wb', ends: ['dmem', 'wbmux'], points: [at('dmem', 'r'), at('wbmux', 'l', -17)], stage: 'WB' }, // prettier-ignore
  { id: 'imm-wb', ends: ['immgen', 'wbmux'], points: [at('immgen', 'r', 12), [444, at('immgen', 'r', 12)[1]], [444, 446], [828, 446], [828, at('wbmux', 'l', 50)[1]], at('wbmux', 'l', 50)], stage: 'WB' }, // prettier-ignore
  { id: 'pc4-wb', ends: ['add4', 'wbmux'], points: [at('add4', 'r', 8), [210, at('add4', 'r', 8)[1]], [210, 30], [824, 30], [824, at('wbmux', 'l', -30)[1]], at('wbmux', 'l', -30)], stage: 'WB' }, // prettier-ignore
  { id: 'branchadd-wb', ends: ['branchadd', 'wbmux'], points: [at('branchadd', 'r', -8), [544, at('branchadd', 'r', -8)[1]], [544, 34], [816, 34], [816, at('wbmux', 'l', -12)[1]], at('wbmux', 'l', -12)], stage: 'WB' }, // prettier-ignore
  { id: 'wb-regfile', ends: ['wbmux', 'regfile'], points: [at('wbmux', 'r'), [880, at('wbmux', 'r')[1]], [880, 462], [300, 462], [300, at('regfile', 'l', 70)[1]], at('regfile', 'l', 70)], stage: 'WB' }, // prettier-ignore
  // --- PC select: the taken target routes back to the next-PC mux along the top rails ---
  { id: 'branchadd-pcsel', ends: ['branchadd', 'pcsel'], points: [at('branchadd', 'r', 8), [532, 48], [8, 48], [8, 310], at('pcsel', 'l', 30)], stage: 'WB' }, // prettier-ignore
  { id: 'alu-pcsel', ends: ['alu', 'pcsel'], points: [at('alu', 'r', -18), [628, 24], [4, 24], [4, 290], at('pcsel', 'l', 10)], stage: 'WB' }, // prettier-ignore
] as const;

export const WIRES: readonly DatapathWire[] = WIRE_LIST;

/** Wire lookup by id. Activation uses this to light a wire's declared endpoints (`ends`) rather
 *  than re-deriving them from the id string — the id is a display name and does NOT reliably
 *  name the endpoints (e.g. `regfile-rs2` actually terminates at `alusrc`; `imm-wb` at immgen and
 *  wbmux), as {@link DatapathWire.ends} warns. */
const WIRE_BY_ID: ReadonlyMap<string, DatapathWire> = new Map(WIRE_LIST.map((wire) => [wire.id, wire])); // prettier-ignore

// --- Depth tiers (structural detail; handoff §4) -----------------------------------------

/** True when an element requiring `minTier` (absent ⇒ `essentials`) is drawn at `current`. */
export function tierVisible(minTier: DepthTier | undefined, current: DepthTier): boolean {
  return DEPTH_TIERS.indexOf(minTier ?? 'essentials') <= DEPTH_TIERS.indexOf(current);
}

/** Whether a node is drawn at `tier`. */
export function nodeVisibleAt(node: DatapathNode, tier: DepthTier): boolean {
  return tierVisible(node.minTier, tier);
}

/** Whether a wire is drawn at `tier`: iff BOTH endpoint nodes are drawn (INV-5 — hiding a box
 *  hides the wires into it, so no wire ever dangles into empty space). On single-cycle no node
 *  sets `minTier`, so this is always true; it stays wired for the pipeline tier. */
export function wireVisibleAt(wire: DatapathWire, tier: DepthTier): boolean {
  return wire.ends.every((id) => nodeVisibleAt(NODES.get(id)!, tier));
}

// The tiered layer on single-cycle is representational fidelity (handoff §4 layer 2), not
// structure: `essentials` shows the bare lit path, higher tiers add labels. All-or-nothing on the
// value labels — showing only some (e.g. the writeback value) would reintroduce a value with no
// visible source, the very "from nowhere" read that structural hiding fails INV-5 on.

/** Whether active wires carry their value labels at `tier` (everything except `essentials`). */
export function showValueLabels(tier: DepthTier): boolean {
  return tier !== 'essentials';
}

/** Whether muxes show their control-line label at `tier` (`expert` only). */
export function showControlLabels(tier: DepthTier): boolean {
  return tier === 'expert';
}

// --- Activation ---------------------------------------------------------------------------

/** How a value should be rendered on a wire label. */
export type Fmt = 'hex' | 'dec';

export interface WireActivation {
  readonly value?: number;
  readonly fmt: Fmt;
}

export interface DatapathActivation {
  /** Ids of components on the active path this cycle. */
  readonly components: ReadonlySet<string>;
  /** Active wire id → the value flowing on it (if known). */
  readonly wires: ReadonlyMap<string, WireActivation>;
  /** The register the writeback port targets this cycle, or `null`. */
  readonly writtenReg: number | null;
}

const EMPTY: DatapathActivation = {
  components: new Set(),
  wires: new Map(),
  writtenReg: null,
};

const SYSTEM_FENCE = new Set(['ecall', 'ebreak', 'fence']);

/**
 * Derive which datapath components/wires are active this cycle, and the value on each wire.
 * Topology is decode-driven (so `lui`/`jal`/`auipc`, which emit no ALU/reg-read event, still
 * light a complete path); values come from events where present. Returns an empty activation
 * for the pre-run state (no in-flight instruction).
 */
export function activate(trace: CycleTrace | null): DatapathActivation {
  const inst = trace?.instructions[0];
  if (!trace || !inst) return EMPTY;

  const d = inst.decoded;
  const mnem = d.mnemonic;
  const events = trace.events;

  const regReads = events.filter((e) => e.type === 'reg-read');
  const aluOp = events.find((e) => e.type === 'alu-op');
  const memRead = events.find((e) => e.type === 'mem-read');
  const memWrite = events.find((e) => e.type === 'mem-write');
  const regWrite = events.find((e) => e.type === 'reg-write');

  const pc = inst.pc >>> 0;
  const nextPc = trace.state.pc >>> 0;
  const pcPlus4 = (pc + 4) >>> 0;
  const imm = d.imm;
  const target = (pc + imm) >>> 0;

  const isLoad = memRead !== undefined;
  const isStore = memWrite !== undefined;
  const isBranch = d.format === 'B';
  const isJal = mnem === 'jal';
  const isJalr = mnem === 'jalr';
  const isLui = mnem === 'lui';
  const isAuipc = mnem === 'auipc';
  const usesImm = d.format !== 'R' && !SYSTEM_FENCE.has(mnem);

  const components = new Set<string>();
  const wires = new Map<string, WireActivation>();
  const c = (id: string): void => void components.add(id);
  const w = (id: string, value: number | undefined, fmt: Fmt): void => {
    const wire = WIRE_BY_ID.get(id);
    if (!wire) throw new Error(`activate: unknown wire id "${id}"`);
    wires.set(id, { value, fmt });
    // Light the two components the wire physically connects (its declared `ends` — NOT the id
    // string, which does not reliably name them). This keeps activation coherent by construction:
    // a lit wire never runs into a dim box.
    for (const end of wire.ends) c(end);
  };

  // Fetch is unconditional: PC → I-memory, PC → +4, and the selected next-PC returns to PC.
  c('pc');
  c('imem');
  w('pc-imem', pc, 'hex');
  w('pc-add4', pc, 'hex');
  w('add4-pcsel', pcPlus4, 'hex');
  w('pcsel-pc', nextPc, 'hex');
  c('pcsel');

  // Decode: the instruction word reaches the register file (selectors) and the imm generator.
  w('imem-regfile', inst.encoding, 'hex');
  if (usesImm) w('imem-immgen', inst.encoding, 'hex');

  // Register reads (single-cycle emits rs1 first, then rs2 for R/S/B forms).
  const rs1Read = regReads[0];
  const rs2Read = regReads[1];
  if (rs1Read) w('regfile-rs1', rs1Read.value, 'dec');

  // Immediate generation.
  if (usesImm) c('immgen');

  // Execute: whatever an ALU op is emitted for (R/I ALU, load/store addr, branch compare, jalr).
  if (aluOp) {
    c('alu');
    c('alusrc');
    w('alusrc-alu', aluOp.b, 'dec');
    // The ALU's second operand is the immediate for I/load/store/jalr, else the rs2 register.
    if (usesImm && !isBranch) {
      w('imm-alusrc', imm, 'dec');
    } else if (rs2Read) {
      w('regfile-rs2', rs2Read.value, 'dec');
    }
  }

  // Branch / jump target adder (PC + imm); jalr instead targets via the ALU.
  if (isBranch || isJal || isAuipc) {
    c('branchadd');
    w('pc-branchadd', pc, 'hex');
    w('imm-branchadd', imm, 'dec');
  }

  // Memory access.
  if (isLoad) {
    c('dmem');
    w('alu-dmem', memRead.addr, 'hex');
  } else if (isStore) {
    c('dmem');
    w('alu-dmem', memWrite.addr, 'hex');
    w('rs2-dmem', memWrite.value, 'dec');
  }

  // Writeback: pick the source feeding the mux, then drive the register write port.
  let writtenReg: number | null = null;
  if (regWrite) {
    writtenReg = regWrite.reg;
    c('wbmux');
    c('regfile');
    w('wb-regfile', regWrite.value, 'dec');
    if (isLoad) w('dmem-wb', regWrite.value, 'dec');
    else if (isLui) w('imm-wb', imm, 'dec');
    else if (isJal || isJalr) w('pc4-wb', pcPlus4, 'hex');
    else if (isAuipc) w('branchadd-wb', regWrite.value, 'hex');
    else w('alu-wb', regWrite.value, 'dec');
  }

  // PC select: the taken target (branch/jal via the adder, jalr via the ALU) feeds the mux.
  if (isBranch || isJal) w('branchadd-pcsel', target, 'hex');
  else if (isJalr) w('alu-pcsel', nextPc, 'hex');

  return { components, wires, writtenReg };
}
