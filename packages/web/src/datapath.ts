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
 * Each node/wire carries an optional `minTier` — reserved for build-order step 9 (depth-tier
 * rendering). No tier logic lives here yet; the view stays tier-oblivious (INV-2).
 */

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
  /** Reserved for step-9 depth tiers; unused today. */
  readonly minTier?: number;
}

const NODE_LIST: readonly DatapathNode[] = [
  { id: 'pcsel', label: 'PCsrc', x: 30, y: 150, w: 26, h: 70, stage: 'WB', shape: 'mux' },
  { id: 'pc', label: 'PC', x: 20, y: 258, w: 46, h: 44, stage: 'IF' },
  { id: 'add4', label: '+4', x: 118, y: 48, w: 66, h: 46, stage: 'IF', shape: 'adder' },
  { id: 'imem', label: 'Instr\nMemory', x: 112, y: 256, w: 98, h: 88, stage: 'IF' },
  { id: 'regfile', label: 'Registers', x: 286, y: 214, w: 116, h: 132, stage: 'ID' },
  { id: 'immgen', label: 'Imm\nGen', x: 286, y: 378, w: 116, h: 48, stage: 'ID' },
  { id: 'branchadd', label: '+', x: 452, y: 66, w: 66, h: 52, stage: 'EX', shape: 'adder' },
  { id: 'alusrc', label: '', x: 448, y: 256, w: 26, h: 78, stage: 'EX', shape: 'mux' },
  { id: 'alu', label: 'ALU', x: 512, y: 236, w: 88, h: 100, stage: 'EX', shape: 'adder' },
  { id: 'dmem', label: 'Data\nMemory', x: 652, y: 256, w: 98, h: 88, stage: 'MEM' },
  { id: 'wbmux', label: '', x: 812, y: 256, w: 26, h: 78, stage: 'WB', shape: 'mux' },
] as const;

export const NODES: ReadonlyMap<string, DatapathNode> = new Map(NODE_LIST.map((n) => [n.id, n]));

/** Anchor a point on a node's edge: l/r/t/b = side midpoints, c = center. */
type Side = 'l' | 'r' | 't' | 'b' | 'c';
type Pt = readonly [number, number];
function at(id: string, side: Side, dy = 0): Pt {
  const n = NODES.get(id)!;
  switch (side) {
    case 'l':
      return [n.x, n.y + n.h / 2 + dy];
    case 'r':
      return [n.x + n.w, n.y + n.h / 2 + dy];
    case 't':
      return [n.x + n.w / 2, n.y];
    case 'b':
      return [n.x + n.w / 2, n.y + n.h];
    case 'c':
      return [n.x + n.w / 2, n.y + n.h / 2 + dy];
  }
}
/** Route from `a` to `b` with a single vertical segment at x = `midx` (a horizontal-first elbow). */
function elbowH(a: Pt, b: Pt, midx: number): Pt[] {
  return [a, [midx, a[1]], [midx, b[1]], b];
}
/** Route from `a` to `b` with a single horizontal segment at y = `midy` (a vertical-first elbow). */
function elbowV(a: Pt, b: Pt, midy: number): Pt[] {
  return [a, [a[0], midy], [b[0], midy], b];
}

export interface DatapathWire {
  readonly id: string;
  readonly points: readonly Pt[];
  readonly stage: Phase;
  readonly minTier?: number;
}

const WIRE_LIST: readonly DatapathWire[] = [
  // --- IF: PC drives instruction fetch and the +4 adder ---
  { id: 'pc-imem', points: [at('pc', 'r'), at('imem', 'l')], stage: 'IF' },
  { id: 'pc-add4', points: elbowH(at('pc', 'r', -12), at('add4', 'l'), 92), stage: 'IF' },
  { id: 'add4-pcsel', points: elbowH(at('add4', 'l'), at('pcsel', 't'), 78), stage: 'IF' },
  { id: 'pcsel-pc', points: [at('pcsel', 'b'), at('pc', 't')], stage: 'WB' },
  // --- ID: the fetched word feeds the register file and the immediate generator ---
  {
    id: 'imem-regfile',
    points: elbowH(at('imem', 'r'), at('regfile', 'l', -34), 250),
    stage: 'ID',
  },
  { id: 'imem-immgen', points: elbowH(at('imem', 'r'), at('immgen', 'l'), 250), stage: 'ID' },
  // --- EX: register values + immediate into the ALU / branch adder ---
  { id: 'regfile-rs1', points: [at('regfile', 'r', -34), at('alu', 'l', -20)], stage: 'EX' },
  {
    id: 'regfile-rs2',
    points: elbowH(at('regfile', 'r', 20), at('alusrc', 't'), 430),
    stage: 'EX',
  },
  { id: 'imm-alusrc', points: elbowH(at('immgen', 'r'), at('alusrc', 'b'), 424), stage: 'EX' },
  { id: 'alusrc-alu', points: [at('alusrc', 'r'), at('alu', 'l', 20)], stage: 'EX' },
  {
    id: 'pc-branchadd',
    points: elbowH(at('pc', 'r', -12), at('branchadd', 'l', -12), 92),
    stage: 'EX',
  },
  {
    id: 'imm-branchadd',
    points: elbowH(at('immgen', 'r'), at('branchadd', 'l', 12), 438),
    stage: 'EX',
  },
  // --- MEM: ALU result addresses data memory; rs2 supplies store data ---
  { id: 'alu-dmem', points: [at('alu', 'r'), at('dmem', 'l')], stage: 'MEM' },
  { id: 'rs2-dmem', points: elbowV(at('regfile', 'r', 34), at('dmem', 'b'), 360), stage: 'MEM' },
  // --- WB: writeback source into the mux, then back to the register write port ---
  { id: 'alu-wb', points: elbowH(at('alu', 'r', 34), at('wbmux', 'b'), 626), stage: 'WB' },
  { id: 'dmem-wb', points: [at('dmem', 'r'), at('wbmux', 't')], stage: 'WB' },
  { id: 'imm-wb', points: elbowV(at('immgen', 'b'), at('wbmux', 'b'), 448), stage: 'WB' },
  { id: 'pc4-wb', points: elbowV(at('add4', 'r'), at('wbmux', 't'), 30), stage: 'WB' },
  { id: 'branchadd-wb', points: elbowV(at('branchadd', 'r'), at('wbmux', 't'), 42), stage: 'WB' },
  { id: 'wb-regfile', points: elbowV(at('wbmux', 'b'), at('regfile', 'b'), 456), stage: 'WB' },
  // --- PC select: the taken target routes back to the next-PC mux ---
  {
    id: 'branchadd-pcsel',
    points: elbowV(at('branchadd', 't'), at('pcsel', 'l'), 30),
    stage: 'WB',
  },
  { id: 'alu-pcsel', points: elbowV(at('alu', 't'), at('pcsel', 'l'), 18), stage: 'WB' },
] as const;

export const WIRES: readonly DatapathWire[] = WIRE_LIST;

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
    wires.set(id, { value, fmt });
    // Light the components the wire touches (its two logical endpoints, by convention id `a-b`).
    for (const part of id.split('-')) if (NODES.has(part)) c(part);
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
