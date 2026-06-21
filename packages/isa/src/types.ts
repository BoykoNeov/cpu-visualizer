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

/**
 * Encoding handling beyond the six base formats. These instructions are I-type
 * *encoded* but carry their operand differently:
 * - `shift` — the "immediate" is a 5-bit shift amount in bits[24:20], and funct7
 *   (bits[31:25]) selects logical vs. arithmetic (`slli`/`srli`/`srai`).
 * - `system` — `ecall`/`ebreak`, disambiguated by imm[11:0]; no register operands.
 * - `fence` — `fence`; modeled as a no-op here (no memory ordering to simulate).
 */
export type InstructionKind = 'shift' | 'system' | 'fence';

/**
 * One declarative instruction descriptor. This single table drives BOTH the
 * by-opcode decode index and the by-mnemonic encode index, plus the per-format
 * immediate codec — so a round-trip is correct by construction rather than by
 * relying on tests to catch decode/encode table drift (handoff §7, §11).
 */
export interface InstructionDef {
  readonly mnemonic: string;
  /** Public RISC-V base format. Shift/system/fence are all I-type *encoded*. */
  readonly format: InstructionFormat;
  /** opcode, bits[6:0]. */
  readonly opcode: number;
  /** funct3 selector, bits[14:12], when the opcode needs it to disambiguate. */
  readonly funct3?: number;
  /** funct7 selector, bits[31:25]: R-type ops and the shift-immediate variants. */
  readonly funct7?: number;
  /** imm[11:0] discriminator — separates SYSTEM `ecall` (0x000) from `ebreak` (0x001). */
  readonly imm12?: number;
  /** Special codec handling; absent for the plain six-format instructions. */
  readonly kind?: InstructionKind;
  /** Canonical 32-bit word for operand-less instructions (`fence`/`ecall`/`ebreak`). */
  readonly word?: number;
}

/**
 * Operand fields the assembler supplies to {@link encode}. Omitted fields default
 * to 0. `imm` carries the format-appropriate value (a sign-extended immediate, a
 * U-type upper value already shifted into place, or a shift amount). Range/validity
 * checking is the assembler's job (handoff §8); the codec here just masks and packs.
 */
export interface InstructionFields {
  readonly rd?: number;
  readonly rs1?: number;
  readonly rs2?: number;
  readonly imm?: number;
}
