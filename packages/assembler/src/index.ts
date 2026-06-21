/**
 * The assembler turns RV32I assembly text into an {@link AssembledProgram} (handoff §8).
 *
 * This is the scaffold seed: it fixes the OUTPUT contract that the engines, golden
 * reference, and source<->machine-code panel depend on. The parser, encoder,
 * pseudo-instruction expansion, and error reporting are build-order step 2 (handoff §11).
 */

export interface AssembledProgram {
  /** The machine code, one 32-bit word per instruction. */
  words: Uint32Array;
  /** Instruction address -> source line, feeding `InstructionInstance.sourceLine`. */
  sourceMap: Map<number, number>;
  /** Label -> address. */
  symbols: Map<string, number>;
  /** Initialized data segments. */
  data: { addr: number; bytes: Uint8Array }[];
}

/** A located assembler diagnostic (handoff §8: "good error messages with line/column"). */
export interface AssemblerError {
  message: string;
  line: number;
  column: number;
}

/** An empty, valid program. Useful as a starting point and a test fixture. */
export function emptyProgram(): AssembledProgram {
  return {
    words: new Uint32Array(0),
    sourceMap: new Map(),
    symbols: new Map(),
    data: [],
  };
}
