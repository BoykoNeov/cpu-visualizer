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
 * STEP 5c reversed this file's central simplification. The engine now routes PC arithmetic through
 * the shared ALU (`jal` computes its target `pc+imm` there, `auipc` its `pc+imm` result), so the
 * datapath draws what the trace actually says:
 *   - an **ALUSrcA** mux selects the ALU's first operand — the `A` latch (`Reg[rs1]`) for ordinary
 *     ops and `jalr`, or **PC** for `jal`/`auipc`. This 4th mux is forced, not decorative: once the
 *     trace carries an `alu-op` over `(pc, imm)`, INV-3 requires PC to visibly reach the ALU.
 *   - the **`aluout → pc` redirect** closes the next-PC loop for `jal` and `jalr` — both genuinely
 *     `PC ← ALUOut`. It lights at WB, where the engine commits pc at retire.
 *   - `pcarith` shrank to what it honestly is: a **PC+4 incrementer**, supplying the sequential PC
 *     and the `jal`/`jalr` link. It no longer takes an immediate input — `auipc` gets its value
 *     from ALUOut now, like any other ALU result.
 *
 * STEP 5d closed the last redirect. A **taken branch** now draws its own: the shared ALU holds the
 * compare result (`taken?1:0`), never the target, so the `aluout → pc` wire physically cannot carry
 * it — the target needs the **branch adder**, a second dedicated adder computing `pc + imm` from
 * the PC and the sign-extender. That is the real hardware, not a drawing convenience: it is exactly
 * why textbook datapaths carry two adders. It lights at **EX**, the branch's retire phase, and only
 * when the branch is TAKEN — generalizing the redirect rule to "the next-PC wire lights at retire",
 * which is WB for the jumps (they write a link) and EX for a branch (its last phase).
 *
 * STEP 5e closed the last stated omission: the **PCSource mux**. 5c and 5d each landed a redirect
 * into PC but left the selector between them undrawn, and the diagram was one driver short of even
 * being able to draw it — the SEQUENTIAL next-PC (`pcarith → pc`) had no wire at all. `pcarith` fed
 * only the writeback mux (the `jal`/`jalr` link); the ordinary "PC ← PC+4" that every instruction
 * performs was invisible. So 5e:
 *   - **closes the sequential loop** — `pc → pcarith → pc` — lighting it at RETIRE for any
 *     instruction that neither jumps nor takes a branch. Like 5d this is view-only: `pc + 4` is
 *     derived from the trace's own `pc` (RV32I is fixed-width), never read out of the engine.
 *   - adds the **`pcsource` mux** with all three drivers on its inputs. Drawing it 2-input would
 *     have been the same lie in a smaller box; a selector whose commonest input never lights is
 *     worse than no selector. It sits below-left of PC — the one place all three sources reach a
 *     left edge on well-separated rails — and is tiered like every other mux: hidden at
 *     `essentials`, where three contraction wires (`pcarith → pc`, `aluout → pc`, `branchadd → pc`)
 *     stand in for it, exactly as `a-alu` stands in for ALUSrcA.
 *
 * Honest simplifications that REMAIN (surfaced, not hidden — INV-5 permits lawful omission, never
 * contradiction): `lui` keeps no ALU path —
 * it is a pure immediate pass-through, and is the only instruction class that skips EX. And the
 * `aluout → pc` label carries `micro.aluOut`, which for
 * `jalr` is `rs1+imm` before the mandatory bit-0 clear — PC actually receives `(rs1+imm) & ~1`.
 * The two differ only for an odd target; the wire is the right wire either way. Finally, a halting
 * `ecall` still lights the sequential `pc+4` at its retire: the incrementer genuinely computes it
 * and the mux genuinely selects it — the machine stops for reasons outside this diagram.
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

// LAYOUT CONTRACT (checked by the geometry tests): the shared-memory band is centered on y≈252
// (PC → IorD mux → Memory → IR/MDR), the register/operand band flows left→right into the shared
// ALU (via ALUSrc), and the ALUOut latch / MemtoReg mux close the loop back to the register write
// port. Shaped nodes (mux/adder) connect ONLY on their vertical edges (muxes in-left/out-right;
// adders on the two notch stubs + right output). Every wire is orthogonal and every endpoint sits
// on a real drawn edge; the IorD/MemtoReg feedback and the writeback fan-in ride the clear top
// (y<70) and bottom (y>420) rails. See {@link shapePolygon} for the outlines these anchors hit.
const NODE_LIST: readonly DatapathNode[] = [
  // Left: PC, the shared memory and its address selector, and the dedicated PC-arithmetic unit.
  { id: 'pc', label: 'PC', x: 28, y: 230, w: 44, h: 44 },
  { id: 'pcarith', label: 'PC\narith', x: 100, y: 120, w: 58, h: 46, shape: 'adder' },
  { id: 'addrmux', label: '', x: 100, y: 215, w: 22, h: 74, shape: 'mux', minTier: 'detailed', controlLabel: 'IorD' }, // prettier-ignore
  { id: 'mem', label: 'Memory', x: 152, y: 206, w: 90, h: 92 },
  // The five inter-cycle latches (the pedagogical payoff — 1:1 with `MachineState.micro`).
  { id: 'ir', label: 'IR', x: 284, y: 196, w: 46, h: 48 },
  { id: 'mdr', label: 'MDR', x: 284, y: 288, w: 46, h: 48 },
  // Register file + sign-extend feed the operand latches.
  { id: 'regfile', label: 'Registers', x: 362, y: 194, w: 104, h: 132 },
  { id: 'signext', label: 'Sign\nExtend', x: 362, y: 356, w: 104, h: 44 },
  { id: 'a', label: 'A', x: 502, y: 222, w: 42, h: 44 },
  { id: 'b', label: 'B', x: 502, y: 290, w: 42, h: 44 },
  // Shared ALU with BOTH operand selectors (5c added ALUSrcA so `jal`/`auipc` can route PC into
  // the ALU), then the ALUOut latch and writeback selector.
  { id: 'alusrca', label: '', x: 566, y: 160, w: 22, h: 76, shape: 'mux', minTier: 'detailed', controlLabel: 'ALUSrcA' }, // prettier-ignore
  { id: 'alusrcb', label: '', x: 566, y: 252, w: 22, h: 92, shape: 'mux', minTier: 'detailed', controlLabel: 'ALUSrcB' }, // prettier-ignore
  { id: 'alu', label: 'ALU', x: 620, y: 228, w: 84, h: 100, shape: 'adder' },
  { id: 'aluout', label: 'ALUOut', x: 742, y: 252, w: 54, h: 52 },
  { id: 'wbmux', label: '', x: 834, y: 216, w: 22, h: 128, shape: 'mux', minTier: 'detailed', controlLabel: 'MemtoReg' }, // prettier-ignore
  // 5d: the second adder. `pc + imm` for a taken branch — the ALU can't supply this, it is busy
  // holding the compare result. Real dataflow, not a selector, so it is drawn at every tier.
  { id: 'branchadd', label: 'Branch\nadd', x: 806, y: 150, w: 58, h: 46, shape: 'adder' },
  // 5e: the next-PC selector. It sits BELOW-LEFT of PC rather than directly left of it — PC is only
  // 28px from the canvas edge, and a mux takes its inputs on its left VERTICAL edge, so a
  // directly-left placement leaves no room for three separated feed rails. Down here the margin is
  // empty and each source gets its own rail (pcarith x=82, aluout x=70, branchadd x=14).
  { id: 'pcsource', label: '', x: 90, y: 330, w: 22, h: 100, shape: 'mux', minTier: 'detailed', controlLabel: 'PCSource' }, // prettier-ignore
] as const;

export const NODES: ReadonlyMap<string, DatapathNode> = new Map(NODE_LIST.map((n) => [n.id, n]));

type Pt = readonly [number, number];
/** Anchor a point on a node's edge. l/r = side midpoints + `off` (valid for boxes and the mux
 *  vertical edges); t/b = top/bottom edge + `off` along it; c = center + vertical `off`. For adders
 *  use {@link aUp}/{@link aLo} (left operand stubs) and `r` (output) — never l/t/b (notch/slants). */
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
/** An adder's upper / lower left operand stub (the vertical edges above / below the notch). */
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
  { id: 'aluout-addrmux', ends: ['aluout', 'addrmux'], points: [at('aluout', 't'), [769, 60], [90, 60], [90, at('addrmux', 'l', -14)[1]], at('addrmux', 'l', -14)], minTier: 'detailed' }, // prettier-ignore
  { id: 'addrmux-mem', ends: ['addrmux', 'mem'], points: [at('addrmux', 'r'), at('mem', 'l')], minTier: 'detailed' }, // prettier-ignore
  { id: 'pc-mem', ends: ['pc', 'mem'], points: [at('pc', 'r'), at('mem', 'l')], maxTier: 'essentials', contracts: 'addrmux' }, // prettier-ignore
  { id: 'aluout-mem', ends: ['aluout', 'mem'], points: [at('aluout', 't'), [769, 58], [197, 58], at('mem', 't')], maxTier: 'essentials', contracts: 'addrmux' }, // prettier-ignore
  { id: 'mem-ir', ends: ['mem', 'ir'], points: [at('mem', 'r', -32), at('ir', 'l')] }, // prettier-ignore
  { id: 'mem-mdr', ends: ['mem', 'mdr'], points: [at('mem', 'r', 45), [242, at('mdr', 'l')[1]], at('mdr', 'l')] }, // prettier-ignore
  // --- Decode: IR selects the registers and drives the sign-extender; reads latch into A / B ---
  { id: 'ir-regfile', ends: ['ir', 'regfile'], points: [at('ir', 'r'), at('regfile', 'l', -40)] }, // prettier-ignore
  { id: 'ir-signext', ends: ['ir', 'signext'], points: [at('ir', 'r', 20), [348, at('ir', 'r', 20)[1]], [348, 344], [390, 344], at('signext', 't', -24)] }, // prettier-ignore
  { id: 'regfile-a', ends: ['regfile', 'a'], points: [at('regfile', 'r', -16), at('a', 'l')] }, // prettier-ignore
  { id: 'regfile-b', ends: ['regfile', 'b'], points: [at('regfile', 'r', 52), at('b', 'l')] }, // prettier-ignore
  // --- Execute: ALUSrcA picks A or PC; ALUSrcB picks B or the immediate ---
  { id: 'a-alusrca', ends: ['a', 'alusrca'], points: [at('a', 'r'), [556, at('a', 'r')[1]], [556, at('alusrca', 'l', 20)[1]], at('alusrca', 'l', 20)], minTier: 'detailed' }, // prettier-ignore
  { id: 'pc-alusrca', ends: ['pc', 'alusrca'], points: [at('pc', 't', 12), [at('pc', 't', 12)[0], 100], [556, 100], [556, at('alusrca', 'l', -20)[1]], at('alusrca', 'l', -20)], minTier: 'detailed' }, // prettier-ignore
  { id: 'alusrca-alu', ends: ['alusrca', 'alu'], points: [at('alusrca', 'r'), [604, at('alusrca', 'r')[1]], [604, aUp('alu')[1]], aUp('alu')], minTier: 'detailed' }, // prettier-ignore
  { id: 'a-alu', ends: ['a', 'alu'], points: [at('a', 'r'), aUp('alu')], maxTier: 'essentials', contracts: 'alusrca' }, // prettier-ignore
  // Enters the ALU's upper stub 8px above `a-alu`'s anchor — same reasoning as `signext-alu`
  // below: both are essentials contractions of ALUSrcA, drawn together, so they must not share
  // the final run into the stub.
  { id: 'pc-alu', ends: ['pc', 'alu'], points: [at('pc', 't', 12), [at('pc', 't', 12)[0], 100], [608, 100], [608, aUp('alu')[1] - 8], [at('alu', 'l')[0], aUp('alu')[1] - 8]], maxTier: 'essentials', contracts: 'alusrca' }, // prettier-ignore
  { id: 'b-alusrcb', ends: ['b', 'alusrcb'], points: [at('b', 'r'), at('alusrcb', 'l', 14)], minTier: 'detailed' }, // prettier-ignore
  { id: 'signext-alusrcb', ends: ['signext', 'alusrcb'], points: [at('signext', 'r', -8), [548, at('signext', 'r', -8)[1]], [548, at('alusrcb', 'l', 32)[1]], at('alusrcb', 'l', 32)], minTier: 'detailed' }, // prettier-ignore
  { id: 'alusrcb-alu', ends: ['alusrcb', 'alu'], points: [at('alusrcb', 'r'), [at('alusrcb', 'r')[0], aLo('alu')[1]], aLo('alu')], minTier: 'detailed' }, // prettier-ignore
  { id: 'b-alu', ends: ['b', 'alu'], points: [at('b', 'r'), aLo('alu')], maxTier: 'essentials', contracts: 'alusrcb' }, // prettier-ignore
  // Enters the ALU's lower stub 8px below `b-alu`'s anchor: both are essentials contractions of the
  // ALUSrc mux and are drawn together (idle), so they must not share the final run into the stub.
  { id: 'signext-alu', ends: ['signext', 'alu'], points: [at('signext', 'r', 8), [600, at('signext', 'r', 8)[1]], [600, aLo('alu')[1] + 8], [at('alu', 'l')[0], aLo('alu')[1] + 8]], maxTier: 'essentials', contracts: 'alusrcb' }, // prettier-ignore
  { id: 'alu-aluout', ends: ['alu', 'aluout'], points: [at('alu', 'r'), at('aluout', 'l')] }, // prettier-ignore
  // --- Memory: ALUOut addresses memory (via IorD); a load fills MDR, a store sends B's datum ---
  { id: 'b-mem', ends: ['b', 'mem'], points: [at('b', 'b'), [523, 438], [197, 438], at('mem', 'b')] }, // prettier-ignore
  // --- Writeback: MemtoReg picks the source (ALUOut / MDR / imm / pcarith) into the write port ---
  { id: 'aluout-wbmux', ends: ['aluout', 'wbmux'], points: [at('aluout', 'r'), at('wbmux', 'l', -2)], minTier: 'detailed' }, // prettier-ignore
  { id: 'mdr-wbmux', ends: ['mdr', 'wbmux'], points: [at('mdr', 'r', 12), [354, at('mdr', 'r', 12)[1]], [354, 424], [824, 424], [824, at('wbmux', 'l', 46)[1]], at('wbmux', 'l', 46)], minTier: 'detailed' }, // prettier-ignore
  { id: 'signext-wbmux', ends: ['signext', 'wbmux'], points: [at('signext', 'r', 20), [812, at('signext', 'r', 20)[1]], [812, at('wbmux', 'l', 20)[1]], at('wbmux', 'l', 20)], minTier: 'detailed' }, // prettier-ignore
  { id: 'pcarith-wbmux', ends: ['pcarith', 'wbmux'], points: [at('pcarith', 'r'), [158, 64], [824, 64], [824, at('wbmux', 'l', -48)[1]], at('wbmux', 'l', -48)], minTier: 'detailed' }, // prettier-ignore
  { id: 'wbmux-regfile', ends: ['wbmux', 'regfile'], points: [at('wbmux', 'r'), [878, at('wbmux', 'r')[1]], [878, 452], [342, 452], [342, at('regfile', 'l', 48)[1]], at('regfile', 'l', 48)], minTier: 'detailed' }, // prettier-ignore
  { id: 'aluout-regfile', ends: ['aluout', 'regfile'], points: [at('aluout', 'b'), [769, 446], [346, 446], [346, at('regfile', 'l', 40)[1]], at('regfile', 'l', 40)], maxTier: 'essentials', contracts: 'wbmux' }, // prettier-ignore
  { id: 'mdr-regfile', ends: ['mdr', 'regfile'], points: [at('mdr', 'b'), [307, 430], [350, 430], [350, at('regfile', 'l', 48)[1]], at('regfile', 'l', 48)], maxTier: 'essentials', contracts: 'wbmux' }, // prettier-ignore
  { id: 'signext-regfile', ends: ['signext', 'regfile'], points: [at('signext', 't'), at('regfile', 'b')], maxTier: 'essentials', contracts: 'wbmux' }, // prettier-ignore
  { id: 'pcarith-regfile', ends: ['pcarith', 'regfile'], points: [at('pcarith', 'r'), [340, 143], [340, at('regfile', 'l', 58)[1]], at('regfile', 'l', 58)], maxTier: 'essentials', contracts: 'wbmux' }, // prettier-ignore
  // --- The PC+4 incrementer's one input. 5c dropped its immediate input: `auipc` gets its
  //     `pc+imm` from the ALU now, so the only value this unit still makes is `pc+4`. ---
  { id: 'pc-pcarith', ends: ['pc', 'pcarith'], points: [at('pc', 't'), [at('pc', 't')[0], aLo('pcarith')[1]], aLo('pcarith')] }, // prettier-ignore
  // --- The taken-branch redirect's two INPUTS (5d): PC and the immediate meet in the branch adder.
  //     Its output is one of the three PCSource drivers below. ---
  { id: 'pc-branchadd', ends: ['pc', 'branchadd'], points: [at('pc', 't', -12), [at('pc', 't', -12)[0], 44], [786, 44], [786, aUp('branchadd')[1]], aUp('branchadd')] }, // prettier-ignore
  { id: 'signext-branchadd', ends: ['signext', 'branchadd'], points: [at('signext', 'r', -14), [800, at('signext', 'r', -14)[1]], [800, aLo('branchadd')[1]], aLo('branchadd')] }, // prettier-ignore
  // --- The next-PC select (5e). THREE drivers reach the PCSource mux, which drives PC:
  //       `pcarith`   — the sequential PC+4, taken by every instruction that neither jumps nor
  //                     branches-taken. 5e drew this one for the first time.
  //       `aluout`    — `jal` / `jalr` (5c), whose ALUOut holds the computed target.
  //       `branchadd` — a TAKEN branch (5d), whose target the busy ALU cannot supply.
  //     Each has an `essentials` CONTRACTION straight into PC (the mux is hidden at that tier), and
  //     the three contractions land on three different PC edges so they never merge into one line.
  { id: 'pcarith-pcsource', ends: ['pcarith', 'pcsource'], points: [at('pcarith', 'r'), [170, at('pcarith', 'r')[1]], [170, 88], [82, 88], [82, at('pcsource', 'l', -20)[1]], at('pcsource', 'l', -20)], minTier: 'detailed' }, // prettier-ignore
  { id: 'aluout-pcsource', ends: ['aluout', 'pcsource'], points: [at('aluout', 'b', -16), [at('aluout', 'b', -16)[0], 460], [70, 460], [70, at('pcsource', 'l', 5)[1]], at('pcsource', 'l', 5)], minTier: 'detailed' }, // prettier-ignore
  { id: 'branchadd-pcsource', ends: ['branchadd', 'pcsource'], points: [at('branchadd', 'r'), [880, at('branchadd', 'r')[1]], [880, 32], [14, 32], [14, at('pcsource', 'l', 30)[1]], at('pcsource', 'l', 30)], minTier: 'detailed' }, // prettier-ignore
  { id: 'pcsource-pc', ends: ['pcsource', 'pc'], points: [at('pcsource', 'r'), [132, at('pcsource', 'r')[1]], [132, 310], [at('pc', 'b')[0], 310], at('pc', 'b')], minTier: 'detailed' }, // prettier-ignore
  // The three contractions. `pcarith → pc` leaves the incrementer 8px above the `pcarith-regfile`
  // contraction's anchor: both are drawn at `essentials`, so they must not share the exit run.
  { id: 'pcarith-pc', ends: ['pcarith', 'pc'], points: [at('pcarith', 'r', -8), [176, at('pcarith', 'r', -8)[1]], [176, 88], [6, 88], [6, at('pc', 'l', 12)[1]], at('pc', 'l', 12)], maxTier: 'essentials', contracts: 'pcsource' }, // prettier-ignore
  { id: 'aluout-pc', ends: ['aluout', 'pc'], points: [at('aluout', 'b', 16), [at('aluout', 'b', 16)[0], 460], [at('pc', 'b')[0], 460], at('pc', 'b')], maxTier: 'essentials', contracts: 'pcsource' }, // prettier-ignore
  { id: 'branchadd-pc', ends: ['branchadd', 'pc'], points: [at('branchadd', 'r'), [880, at('branchadd', 'r')[1]], [880, 32], [14, 32], [14, at('pc', 'l')[1]], at('pc', 'l')], maxTier: 'essentials', contracts: 'pcsource' }, // prettier-ignore
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
  const isBranch = d.format === 'B';
  const usesImm = d.format !== 'R' && mnem !== 'ecall' && mnem !== 'ebreak' && mnem !== 'fence';
  // The ALU's second operand is the immediate for I/S forms (I-ALU, loads, stores, jalr) and — as
  // of 5c — for the PC-arithmetic ops `jal` (J) and `auipc` (U); it is the rs2 register (the B
  // latch) for R-ALU and branches.
  const aluBIsImm = d.format === 'I' || d.format === 'S' || isJal || isAuipc;
  // 5c: ALUSrcA selects PC rather than the A latch for exactly the PC-arithmetic ops. `jalr` is
  // NOT one of them — its ALU op is genuinely `Reg[rs1] + imm`, so it keeps the A latch.
  const aluAIsPc = isJal || isAuipc;

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
      // Execute: (A or PC) + (B or imm) through the shared ALU; the result latches into ALUOut.
      const aluOp = events.find((e) => e.type === 'alu-op');
      if (aluOp) {
        c('alu');
        c('aluout');
        // 5c: `jal`/`auipc` compute `pc + imm`, so ALUSrcA selects PC — NOT the A latch, which
        // these formats never fill (they read no source register).
        if (aluAIsPc) {
          c('pc');
          w('pc-alusrca', pc, 'hex');
          w('alusrca-alu', pc, 'hex');
          w('pc-alu', pc, 'hex'); // essentials contraction of the ALUSrcA mux
        } else {
          c('a');
          w('a-alusrca', aluOp.a, 'dec');
          w('alusrca-alu', aluOp.a, 'dec');
          w('a-alu', aluOp.a, 'dec'); // essentials contraction of the ALUSrcA mux
        }
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
        // 5d: the taken-branch redirect. EX is a branch's LAST phase (no MEM, no WB), so this is
        // where it retires and commits pc — the same "redirect lights at retire" rule that puts
        // the jumps' `aluout → pc` at WB. Taken-ness is read from the trace, not recomputed: the
        // compare's own `alu-op` result IS the condition (1 = taken). A not-taken branch lights
        // nothing here, matching the undrawn sequential path.
        if (isBranch && aluOp.result === 1) {
          c('pc');
          c('signext');
          c('branchadd');
          w('pc-branchadd', pc, 'hex');
          w('signext-branchadd', imm, 'dec');
          // The adder's own output — `pc + imm` from two trace fields, the same inputs the engine
          // used (INV-3: derived from the trace, not read out of the engine).
          const target = (pc + imm) >>> 0;
          w('branchadd-pcsource', target, 'hex'); // through the 5e selector
          w('pcsource-pc', target, 'hex');
          w('branchadd-pc', target, 'hex'); // essentials contraction of PCSource
        }
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
        } else if (isJal || isJalr) {
          // The LINK (pc+4) comes from the incrementer — never from the ALU, whose ALUOut holds
          // this jump's TARGET and is feeding the redirect below in this same phase.
          c('pcarith');
          c('pc');
          w('pc-pcarith', pc, 'hex');
          w('pcarith-wbmux', regWrite.value, 'hex');
          w('pcarith-regfile', regWrite.value, 'hex');
        } else {
          c('aluout');
          w('aluout-wbmux', regWrite.value, fmt);
          w('aluout-regfile', regWrite.value, fmt);
        }
      }
      // 5c: the next-PC redirect. Deliberately OUTSIDE the `regWrite` guard — `jal x0, t` and
      // `jalr x0, …` discard the link but still redirect, and that is exactly when the jump's
      // only visible effect IS this wire.
      if (isJal || isJalr) {
        c('aluout');
        c('pc');
        const target = micro?.aluOut ?? undefined;
        w('aluout-pcsource', target, 'hex'); // through the 5e selector
        w('pcsource-pc', target, 'hex');
        w('aluout-pc', target, 'hex'); // essentials contraction of PCSource
      }
      break;
    }
  }

  // 5e: the SEQUENTIAL next-PC. Outside the phase switch, because which phase retires depends on
  // the instruction class (WB for most, MEM for a store, EX for a branch) — the same "the next-PC
  // wire lights at retire" rule 5c and 5d established, now applied to the third driver. It is the
  // default arm of PCSource: taken by everything that neither jumps nor takes a branch. `pc + 4` is
  // derived from the trace's own `pc` (RV32I is fixed-width), exactly as 5d derived `pc + imm`.
  const takenBranch = isBranch && events.find((e) => e.type === 'alu-op')?.result === 1;
  const retiring = events.some((e) => e.type === 'instr-retire');
  if (retiring && !isJal && !isJalr && !takenBranch) {
    const next = (pc + 4) >>> 0;
    c('pc');
    c('pcarith');
    w('pc-pcarith', pc, 'hex');
    w('pcarith-pcsource', next, 'hex'); // through the 5e selector
    w('pcsource-pc', next, 'hex');
    w('pcarith-pc', next, 'hex'); // essentials contraction of PCSource
  }

  return { phase, components, wires, writtenReg };
}
