/**
 * The assembler turns RV32I assembly text into an {@link AssembledProgram} (handoff §8):
 * machine code + a source-map (address -> source line) + a symbol table, plus
 * initialized `.data`. It parses the full base integer set with labels, the common
 * pseudo-instructions, and `.text`/`.data`/`.word`/`.byte`/`.asciz`/`.globl`, and
 * reports located (line:column) errors.
 *
 * Entry points:
 * - {@link assemble} — source text -> {@link AssembleResult} (program or errors).
 * - {@link emptyProgram} — a valid empty program (fixture / starting point).
 */

export type { AssembledProgram } from './program';
export { emptyProgram, TEXT_BASE, DATA_BASE } from './program';
export { assemble, type AssembleResult } from './assemble';
export type { AssemblerError } from './diagnostics';
