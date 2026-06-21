/**
 * The assembler's OUTPUT contract (handoff §8). The engines, golden reference, and
 * the source<->machine-code panel all depend on this shape; keep it stable.
 */

export interface AssembledProgram {
  /** The machine code, one 32-bit word per instruction, in address order. */
  words: Uint32Array;
  /** Instruction address -> source line, feeding `InstructionInstance.sourceLine`. */
  sourceMap: Map<number, number>;
  /** Label -> address (absolute, in the §"memory map" below). */
  symbols: Map<string, number>;
  /** Initialized data segments. */
  data: { addr: number; bytes: Uint8Array }[];
}

/**
 * Memory map (a cross-package contract — INV-7; mirrored in `docs/plans/m1-tasks.md`).
 * The reference and single-cycle engines must place text/data at these bases and
 * begin execution at {@link TEXT_BASE}. `.text` assembles upward from `TEXT_BASE`,
 * `.data` from `DATA_BASE`; they are far enough apart that `la`/`li` need the full
 * `lui`+`addi` materialization for data addresses (which is the point pedagogically).
 */
export const TEXT_BASE = 0x0000_0000;
export const DATA_BASE = 0x1000_0000;

/** An empty, valid program. Useful as a starting point and a test fixture. */
export function emptyProgram(): AssembledProgram {
  return {
    words: new Uint32Array(0),
    sourceMap: new Map(),
    symbols: new Map(),
    data: [],
  };
}
