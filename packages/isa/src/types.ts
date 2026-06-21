/**
 * RV32I instruction shapes. This is the framework-agnostic type surface that the
 * assembler, every engine model, and the golden reference share (handoff §7).
 *
 * NOTE: this is the seed used by the M1 scaffold. The full ~40-instruction table,
 * encoder, and exhaustive decoder are build-order step 1 (handoff §11). What is here
 * already is real and correct for the instructions it covers.
 */

/** The six base RV32I instruction formats. */
export type InstructionFormat = 'R' | 'I' | 'S' | 'B' | 'U' | 'J';

/** A fully decoded instruction word, ready for execution or display. */
export interface DecodedInstruction {
  /** The 32-bit machine word, as an unsigned integer. */
  readonly raw: number;
  /** Assembler mnemonic (e.g. `addi`), or `'unknown'` if not in the table yet. */
  readonly mnemonic: string;
  /** Instruction format, or `null` when the opcode is unrecognized. */
  readonly format: InstructionFormat | null;
  /** opcode, bits [6:0]. */
  readonly opcode: number;
  /** Destination register x0..x31, bits [11:7]. */
  readonly rd: number;
  /** Source register 1, bits [19:15]. */
  readonly rs1: number;
  /** Source register 2, bits [24:20]. */
  readonly rs2: number;
  /** funct3, bits [14:12]. */
  readonly funct3: number;
  /** funct7, bits [31:25]. */
  readonly funct7: number;
  /** Sign-extended immediate appropriate to {@link format}; `0` for R-type. */
  readonly imm: number;
}
