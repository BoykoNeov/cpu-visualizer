/**
 * The canonical MULTI-CYCLE RV32I datapath, as pure data (M2 step 5b). This is the "separate,
 * larger" hand-authored datapath the plan calls for — the shared ALU, the single shared Memory,
 * and the five inter-cycle latches (IR / A / B / ALUOut / MDR) drawn as boxes — with the same
 * pure-model / SVG-view split as M1's `datapath.ts` / `DatapathView.tsx`.
 *
 * Two halves, both framework-agnostic and headlessly testable:
 *
 *  1. GEOMETRY — a fixed set of {@link DatapathNode}s and {@link DatapathWire}s with hand-placed
 *     SVG coordinates. The textbook multi-cycle diagram; it never changes with the program.
 *  2. ACTIVATION — {@link activate}, a pure `CycleTrace → DatapathActivation`. Unlike single-cycle
 *     (whose one `step()` lights the WHOLE fetch→writeback path), each multi-cycle `CycleTrace` is
 *     exactly ONE phase (`instructions[0].location`). So activation is PHASE-DRIVEN: it lights only
 *     the slice of the datapath active THIS cycle, reading the current phase's events for values
 *     and `state.micro` for the latch contents carried between cycles. Scrubbing cycles *is* the
 *     phase walk (IF→ID→EX→MEM→WB) — there is no view-local phase stepper (that was single-cycle's,
 *     where all five phases happen in one tick).
 *
 * Everything is derived from the trace only (INV-3): the phase comes from `location`, the values
 * from the emitted events (`instr-fetch`/`reg-read`/`alu-op`/`mem-read`/`mem-write`/`reg-write`),
 * the latch snapshots from `state.micro`. No engine internals are read.
 *
 * DEPTH TIERS (handoff §4) — this is where the deferred `minTier` **structural** hiding finally
 * earns its keep. Single-cycle could only tier *representation* (labels), because every box was on
 * the active path for some common instruction, so hiding one dangled a lit wire. The multi-cycle
 * datapath genuinely has SELECTORS that aren't fundamental to the dataflow story — the three muxes
 * (`addrmux`/IorD, `alusrcb`/ALUSrcB, `wbmux`/MemtoReg). So:
 *   - `essentials` — the clean dataflow skeleton: the five latches, the shared memory and ALU, and
 *     DIRECT "contraction" wires that collapse each hidden mux (e.g. `pc → mem` in place of
 *     `pc → addrmux → mem`). No mux boxes, no value labels.
 *   - `detailed`   — the muxes appear; the contraction wires give way to the real through-mux
 *     wires; active wires gain value labels.
 *   - `expert`     — plus each mux's control-line label (IorD / ALUSrc / MemtoReg).
 *
 * The contraction wires are the load-bearing INV-5 correctness condition: each is a *contraction*
 * of the expert path — same source, same sink, collapsing only the hidden selector, NEVER an
 * alternative routing. A lower tier therefore omits detail but can never contradict a higher one.
 * {@link wireVisibleAt} generalizes M1's no-dangling litmus PER TIER: a wire is drawn iff it is in
 * its tier range AND both endpoints are drawn at that tier. {@link activate} stays tier-oblivious
 * (INV-2): it always lights the full expert slice AND its contraction; the renderer filters.
 *
 * Honest simplifications (surfaced, not hidden — INV-5 permits lawful omission, never
 * contradiction): our multi-cycle engine computes PC-relative values (pc+4, branch/jump targets)
 * DIRECTLY, not by re-using the shared ALU (it emits no `alu-op` for them — jal/lui/auipc skip EX
 * entirely). So this datapath does NOT reuse the ALU for next-PC arithmetic, and it does not draw
 * the next-PC redirect feedback (the transport / register panels already show `pc` advancing). The
 * link/upper-immediate writeback values (jal/jalr `pc+4`, auipc `pc+imm`) come from a small
 * dedicated `pcarith` unit, exactly as single-cycle sourced them from its `add4`/`branchadd`
 * adders — so no register is ever written "from nowhere".
 */

import { DEPTH_TIERS, type DepthTier } from '@cpu-viz/curriculum';
import type { MultiCycleMicro, Phase } from '@cpu-viz/engine-multi-cycle';
import type { CycleTrace } from '@cpu-viz/trace';

export type { Phase };
export const PHASES: readonly Phase[] = ['IF', 'ID', 'EX', 'MEM', 'WB'];
export const PHASE_LABELS: Record<Phase, string> = {
  IF: 'Fetch',
  ID: 'Decode',
  EX: 'Execute',
  MEM: 'Memory',
  WB: 'Writeback',
};

/** Narrow the trace's `location` string to a {@link Phase} (defensively — the engine always sets
 *  one of the five for an in-flight instruction). */
function asPhase(location: string): Phase | null {
  return (PHASES as readonly string[]).includes(location) ? (location as Phase) : null;
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
  /** Draw as a trapezoid (mux) or notched adder rather than a plain box. */
  readonly shape?: 'box' | 'mux' | 'adder';
  /** Lowest depth tier at which this component is drawn (handoff §4). Absent ⇒ `essentials`.
   *  On multi-cycle the three muxes set `minTier: 'detailed'` — hidden at `essentials`, where the
   *  contraction wires stand in for them (this is the structural tiering single-cycle couldn't do). */
  readonly minTier?: DepthTier;
  /** The control signal this mux is driven by — shown only at `expert` tier. */
  readonly controlLabel?: string;
}

const NODE_LIST: readonly DatapathNode[] = [
  // Left: PC, the shared memory and its address selector, and the dedicated PC-arithmetic unit.
  { id: 'pc', label: 'PC', x: 24, y: 214, w: 44, h: 48 },
  { id: 'pcarith', label: 'PC\narith', x: 24, y: 128, w: 58, h: 44, shape: 'adder' },
  { id: 'addrmux', label: '', x: 100, y: 214, w: 22, h: 76, shape: 'mux', minTier: 'detailed', controlLabel: 'IorD' }, // prettier-ignore
  { id: 'mem', label: 'Memory', x: 150, y: 210, w: 90, h: 92 },
  // The five inter-cycle latches (the pedagogical payoff — 1:1 with `MachineState.micro`).
  { id: 'ir', label: 'IR', x: 274, y: 158, w: 46, h: 52 },
  { id: 'mdr', label: 'MDR', x: 274, y: 300, w: 46, h: 52 },
  // Register file + sign-extend feed the operand latches.
  { id: 'regfile', label: 'Registers', x: 356, y: 196, w: 106, h: 124 },
  { id: 'signext', label: 'Sign\nExtend', x: 356, y: 360, w: 106, h: 42 },
  { id: 'a', label: 'A', x: 492, y: 196, w: 42, h: 48 },
  { id: 'b', label: 'B', x: 492, y: 272, w: 42, h: 48 },
  // Shared ALU with its second-operand selector, then the ALUOut latch and writeback selector.
  { id: 'alusrcb', label: '', x: 560, y: 258, w: 22, h: 92, shape: 'mux', minTier: 'detailed', controlLabel: 'ALUSrc' }, // prettier-ignore
  { id: 'alu', label: 'ALU', x: 616, y: 210, w: 84, h: 104, shape: 'adder' },
  { id: 'aluout', label: 'ALUOut', x: 736, y: 226, w: 52, h: 54 },
  { id: 'wbmux', label: '', x: 824, y: 196, w: 22, h: 124, shape: 'mux', minTier: 'detailed', controlLabel: 'MemtoReg' }, // prettier-ignore
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

export interface DatapathWire {
  readonly id: string;
  /** The two node ids this wire physically connects (edge-to-edge). Drives per-tier visibility:
   *  a wire is drawn iff both ends are drawn at the current tier, so hiding a mux never dangles a
   *  wire. The `id` is a display name and does NOT reliably name the endpoints. */
  readonly ends: readonly [string, string];
  readonly points: readonly Pt[];
  /** Lowest tier at which this wire is drawn (absent ⇒ `essentials`). The through-mux wires set
   *  `'detailed'`; they only appear once their mux does. */
  readonly minTier?: DepthTier;
  /** Highest tier at which this wire is drawn (absent ⇒ `expert`). The CONTRACTION wires set
   *  `'essentials'`: they stand in for a hidden mux and must vanish once the real mux appears. */
  readonly maxTier?: DepthTier;
  /** For a contraction wire: the mux id it collapses. The `S → T` contraction must equal the
   *  expert path `S → mux → T` (same source, same sink) — the INV-5 lawfulness condition, checked
   *  by test. Absent on non-contraction wires. */
  readonly contracts?: string;
}

const WIRE_LIST: readonly DatapathWire[] = [
  // --- Fetch: PC addresses the shared memory (via the IorD mux); the word latches into IR ---
  { id: 'pc-addrmux', ends: ['pc', 'addrmux'], points: [at('pc', 'r'), at('addrmux', 'l')], minTier: 'detailed' }, // prettier-ignore
  { id: 'aluout-addrmux', ends: ['aluout', 'addrmux'], points: [at('aluout', 't'), [762, 58], [111, 58], at('addrmux', 't')], minTier: 'detailed' }, // prettier-ignore
  { id: 'addrmux-mem', ends: ['addrmux', 'mem'], points: [at('addrmux', 'r'), at('mem', 'l')], minTier: 'detailed' }, // prettier-ignore
  { id: 'pc-mem', ends: ['pc', 'mem'], points: [at('pc', 'r'), at('mem', 'l')], maxTier: 'essentials', contracts: 'addrmux' }, // prettier-ignore
  { id: 'aluout-mem', ends: ['aluout', 'mem'], points: [at('aluout', 't'), [762, 60], [195, 60], at('mem', 't')], maxTier: 'essentials', contracts: 'addrmux' }, // prettier-ignore
  { id: 'mem-ir', ends: ['mem', 'ir'], points: elbowH(at('mem', 'r', -30), at('ir', 'l'), 257) }, // prettier-ignore
  { id: 'mem-mdr', ends: ['mem', 'mdr'], points: elbowH(at('mem', 'r', 30), at('mdr', 'l'), 257) }, // prettier-ignore
  // --- Decode: IR selects the registers and drives the sign-extender; reads latch into A / B ---
  { id: 'ir-regfile', ends: ['ir', 'regfile'], points: elbowH(at('ir', 'r'), at('regfile', 'l', -28), 338) }, // prettier-ignore
  { id: 'ir-signext', ends: ['ir', 'signext'], points: [at('ir', 'b'), [297, 344], [409, 344], at('signext', 't')] }, // prettier-ignore
  { id: 'regfile-a', ends: ['regfile', 'a'], points: elbowH(at('regfile', 'r', -28), at('a', 'l'), 477) }, // prettier-ignore
  { id: 'regfile-b', ends: ['regfile', 'b'], points: elbowH(at('regfile', 'r', 28), at('b', 'l'), 477) }, // prettier-ignore
  // --- Execute: A goes straight to the ALU; B or the immediate is chosen by ALUSrc ---
  { id: 'a-alu', ends: ['a', 'alu'], points: [at('a', 'r'), at('alu', 'l', -22)] }, // prettier-ignore
  { id: 'b-alusrcb', ends: ['b', 'alusrcb'], points: [at('b', 'r'), at('alusrcb', 'l')], minTier: 'detailed' }, // prettier-ignore
  { id: 'signext-alusrcb', ends: ['signext', 'alusrcb'], points: [at('signext', 'r'), [540, 381], [540, 350], at('alusrcb', 'b')], minTier: 'detailed' }, // prettier-ignore
  { id: 'alusrcb-alu', ends: ['alusrcb', 'alu'], points: [at('alusrcb', 'r'), at('alu', 'l', 22)], minTier: 'detailed' }, // prettier-ignore
  { id: 'b-alu', ends: ['b', 'alu'], points: [at('b', 'r'), at('alu', 'l', 22)], maxTier: 'essentials', contracts: 'alusrcb' }, // prettier-ignore
  { id: 'signext-alu', ends: ['signext', 'alu'], points: [at('signext', 'r'), [600, 381], [600, 292], at('alu', 'l', 22)], maxTier: 'essentials', contracts: 'alusrcb' }, // prettier-ignore
  { id: 'alu-aluout', ends: ['alu', 'aluout'], points: [at('alu', 'r'), at('aluout', 'l')] }, // prettier-ignore
  // --- Memory: ALUOut addresses memory (via IorD); a load fills MDR, a store sends B's datum ---
  { id: 'b-mem', ends: ['b', 'mem'], points: [at('b', 'b'), [513, 438], [195, 438], at('mem', 'b')] }, // prettier-ignore
  // --- Writeback: MemtoReg picks the source (ALUOut / MDR / imm / pcarith) into the write port ---
  { id: 'aluout-wbmux', ends: ['aluout', 'wbmux'], points: [at('aluout', 'r'), at('wbmux', 'l')], minTier: 'detailed' }, // prettier-ignore
  { id: 'mdr-wbmux', ends: ['mdr', 'wbmux'], points: [at('mdr', 'r'), [340, 420], [835, 420], at('wbmux', 'b')], minTier: 'detailed' }, // prettier-ignore
  { id: 'signext-wbmux', ends: ['signext', 'wbmux'], points: [at('signext', 'r'), [810, 381], [810, 318], at('wbmux', 'l', 60)], minTier: 'detailed' }, // prettier-ignore
  { id: 'pcarith-wbmux', ends: ['pcarith', 'wbmux'], points: [at('pcarith', 'r'), [835, 150], at('wbmux', 't')], minTier: 'detailed' }, // prettier-ignore
  { id: 'wbmux-regfile', ends: ['wbmux', 'regfile'], points: [at('wbmux', 'b'), [835, 452], [409, 452], at('regfile', 'b')], minTier: 'detailed' }, // prettier-ignore
  { id: 'aluout-regfile', ends: ['aluout', 'regfile'], points: [at('aluout', 'b'), [762, 452], [409, 452], at('regfile', 'b')], maxTier: 'essentials', contracts: 'wbmux' }, // prettier-ignore
  { id: 'mdr-regfile', ends: ['mdr', 'regfile'], points: [at('mdr', 'b'), [297, 430], [409, 430], at('regfile', 'b')], maxTier: 'essentials', contracts: 'wbmux' }, // prettier-ignore
  { id: 'signext-regfile', ends: ['signext', 'regfile'], points: [at('signext', 't'), at('regfile', 'b')], maxTier: 'essentials', contracts: 'wbmux' }, // prettier-ignore
  { id: 'pcarith-regfile', ends: ['pcarith', 'regfile'], points: [at('pcarith', 'b'), [53, 452], [409, 452], at('regfile', 'b')], maxTier: 'essentials', contracts: 'wbmux' }, // prettier-ignore
  // --- PC-arithmetic unit inputs (link = pc+4, jal/auipc target = pc+imm) ---
  { id: 'pc-pcarith', ends: ['pc', 'pcarith'], points: [at('pc', 't'), at('pcarith', 'b')] }, // prettier-ignore
  { id: 'signext-pcarith', ends: ['signext', 'pcarith'], points: [at('signext', 'l'), [340, 438], [16, 438], at('pcarith', 'l')] }, // prettier-ignore
] as const;

export const WIRES: readonly DatapathWire[] = WIRE_LIST;

const WIRE_BY_ID: ReadonlyMap<string, DatapathWire> = new Map(WIRE_LIST.map((wire) => [wire.id, wire])); // prettier-ignore

// --- Depth tiers -------------------------------------------------------------------------

/** True when an element requiring `minTier` (absent ⇒ `essentials`) is drawn at `current`. */
export function tierVisible(minTier: DepthTier | undefined, current: DepthTier): boolean {
  return DEPTH_TIERS.indexOf(minTier ?? 'essentials') <= DEPTH_TIERS.indexOf(current);
}

/** Whether a node is drawn at `tier` (the three muxes are hidden below `detailed`). */
export function nodeVisibleAt(node: DatapathNode, tier: DepthTier): boolean {
  return tierVisible(node.minTier, tier);
}

/** Whether a wire is drawn at `tier`: inside its [minTier, maxTier] range AND with both endpoint
 *  nodes drawn at that tier (INV-5 — no wire ever dangles into a hidden mux). The maxTier cap is
 *  what retires a contraction wire once its real mux appears at `detailed`. */
export function wireVisibleAt(wire: DatapathWire, tier: DepthTier): boolean {
  if (!tierVisible(wire.minTier, tier)) return false;
  if (wire.maxTier && DEPTH_TIERS.indexOf(tier) > DEPTH_TIERS.indexOf(wire.maxTier)) return false;
  return wire.ends.every((id) => nodeVisibleAt(NODES.get(id)!, tier));
}

/** Whether active wires carry their value labels at `tier` (everything except `essentials`). */
export function showValueLabels(tier: DepthTier): boolean {
  return tier !== 'essentials';
}

/** Whether muxes show their control-line label at `tier` (`expert` only). */
export function showControlLabels(tier: DepthTier): boolean {
  return tier === 'expert';
}

// --- Activation --------------------------------------------------------------------------

/** How a value should be rendered on a wire label. */
export type Fmt = 'hex' | 'dec';

export interface WireActivation {
  readonly value?: number;
  readonly fmt: Fmt;
}

export interface DatapathActivation {
  /** The phase this cycle is executing (from `instructions[0].location`), or null pre-run. */
  readonly phase: Phase | null;
  /** Ids of components on the active path this cycle. */
  readonly components: ReadonlySet<string>;
  /** Active wire id → the value flowing on it (if known). */
  readonly wires: ReadonlyMap<string, WireActivation>;
  /** The register the writeback port targets this cycle, or `null`. */
  readonly writtenReg: number | null;
}

const EMPTY: DatapathActivation = {
  phase: null,
  components: new Set(),
  wires: new Map(),
  writtenReg: null,
};

/**
 * Derive which datapath components/wires are active THIS cycle (= this phase), and the value on
 * each. Phase-driven: `instructions[0].location` selects the slice; values come from the current
 * phase's events, latch snapshots from `state.micro`. Both the expert through-mux wires AND their
 * `essentials` contraction wires are lit (activation is tier-oblivious, INV-2); the view filters.
 * Returns an empty activation for the pre-run state (no in-flight instruction).
 */
export function activate(trace: CycleTrace | null): DatapathActivation {
  const inst = trace?.instructions[0];
  if (!trace || !inst) return EMPTY;
  const phase = asPhase(inst.location);
  if (!phase) return EMPTY;

  const d = inst.decoded;
  const mnem = d.mnemonic;
  const events = trace.events;
  const micro = (trace.state.micro ?? null) as MultiCycleMicro | null;
  const pc = inst.pc >>> 0;
  const imm = d.imm;

  const isLoad =
    mnem === 'lb' || mnem === 'lh' || mnem === 'lw' || mnem === 'lbu' || mnem === 'lhu';
  const isStore = mnem === 'sb' || mnem === 'sh' || mnem === 'sw';
  const isJalr = mnem === 'jalr';
  const isJal = mnem === 'jal';
  const isLui = mnem === 'lui';
  const isAuipc = mnem === 'auipc';
  const usesImm = d.format !== 'R' && mnem !== 'ecall' && mnem !== 'ebreak' && mnem !== 'fence';
  // The ALU's second operand is the immediate for I/S forms (I-ALU, loads, stores, jalr); it is
  // the rs2 register (the B latch) for R-ALU and branches.
  const aluBIsImm = d.format === 'I' || d.format === 'S';

  const components = new Set<string>();
  const wires = new Map<string, WireActivation>();
  const c = (id: string): void => void components.add(id);
  const w = (id: string, value: number | undefined, fmt: Fmt): void => {
    const wire = WIRE_BY_ID.get(id);
    if (!wire) throw new Error(`activate: unknown wire id "${id}"`);
    wires.set(id, { value, fmt });
    for (const end of wire.ends) c(end);
  };

  let writtenReg: number | null = null;

  switch (phase) {
    case 'IF': {
      // Fetch: PC → (IorD mux) → Memory, the fetched word into IR.
      c('pc');
      c('mem');
      c('ir');
      w('pc-addrmux', pc, 'hex');
      w('addrmux-mem', pc, 'hex');
      w('pc-mem', pc, 'hex'); // essentials contraction of the IorD mux
      w('mem-ir', inst.encoding, 'hex');
      break;
    }
    case 'ID': {
      // Decode / register read: IR drives the register file and the sign-extender; the reads
      // latch into A / B.
      c('ir');
      c('regfile');
      w('ir-regfile', inst.encoding, 'hex');
      if (usesImm) {
        c('signext');
        w('ir-signext', inst.encoding, 'hex');
      }
      const regReads = events.filter((e) => e.type === 'reg-read');
      const rs1Read = regReads[0];
      const rs2Read = regReads[1];
      if (rs1Read) w('regfile-a', micro?.a ?? rs1Read.value, 'dec');
      if (rs2Read) w('regfile-b', micro?.b ?? rs2Read.value, 'dec');
      break;
    }
    case 'EX': {
      // Execute: A + (B or imm) through the shared ALU; the result latches into ALUOut.
      const aluOp = events.find((e) => e.type === 'alu-op');
      if (aluOp) {
        c('alu');
        c('aluout');
        c('a');
        w('a-alu', aluOp.a, 'dec');
        if (aluBIsImm) {
          c('signext');
          w('signext-alusrcb', imm, 'dec');
          w('alusrcb-alu', imm, 'dec');
          w('signext-alu', imm, 'dec'); // essentials contraction of the ALUSrc mux
        } else {
          c('b');
          w('b-alusrcb', aluOp.b, 'dec');
          w('alusrcb-alu', aluOp.b, 'dec');
          w('b-alu', aluOp.b, 'dec'); // essentials contraction of the ALUSrc mux
        }
        const addrLike = isLoad || isStore || isJalr;
        w('alu-aluout', micro?.aluOut ?? aluOp.result, addrLike ? 'hex' : 'dec');
      }
      break;
    }
    case 'MEM': {
      // Memory: ALUOut (the effective address) → (IorD mux) → Memory; a load fills MDR, a store
      // drives the datum from the B latch.
      const memRead = events.find((e) => e.type === 'mem-read');
      const memWrite = events.find((e) => e.type === 'mem-write');
      const addr = memRead?.addr ?? memWrite?.addr;
      c('aluout');
      c('mem');
      w('aluout-addrmux', addr, 'hex');
      w('addrmux-mem', addr, 'hex');
      w('aluout-mem', addr, 'hex'); // essentials contraction of the IorD mux
      if (memRead) {
        c('mdr');
        w('mem-mdr', memRead.value, 'hex');
      }
      if (memWrite) {
        c('b');
        w('b-mem', memWrite.value, 'dec');
      }
      break;
    }
    case 'WB': {
      // Writeback: the MemtoReg mux picks the source feeding the register write port.
      const regWrite = events.find((e) => e.type === 'reg-write');
      if (regWrite) {
        writtenReg = regWrite.reg;
        c('wbmux');
        c('regfile');
        const ptrLike = isLoad || isJal || isJalr || isAuipc;
        const fmt: Fmt = ptrLike ? 'hex' : 'dec';
        w('wbmux-regfile', regWrite.value, fmt);
        if (isLoad) {
          c('mdr');
          w('mdr-wbmux', regWrite.value, fmt);
          w('mdr-regfile', regWrite.value, fmt); // essentials contraction of MemtoReg
        } else if (isLui) {
          c('signext');
          w('signext-wbmux', imm, 'dec');
          w('signext-regfile', imm, 'dec');
        } else if (isJal || isJalr || isAuipc) {
          c('pcarith');
          c('pc');
          w('pc-pcarith', pc, 'hex');
          if (isAuipc) {
            c('signext');
            w('signext-pcarith', imm, 'dec');
          }
          w('pcarith-wbmux', regWrite.value, 'hex');
          w('pcarith-regfile', regWrite.value, 'hex');
        } else {
          c('aluout');
          w('aluout-wbmux', regWrite.value, fmt);
          w('aluout-regfile', regWrite.value, fmt);
        }
      }
      break;
    }
  }

  return { phase, components, wires, writtenReg };
}
