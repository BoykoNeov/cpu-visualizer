import type { DecodedInstruction } from './types';
import { decodeLookup } from './instructions';
import { extractImmediate } from './immediates';

/**
 * RV32I decoder. Extracts every architectural field, identifies the instruction
 * against the shared {@link INSTRUCTIONS} table, and computes the correctly
 * sign-extended immediate (or shift amount) for its format. Unknown encodings
 * still decode their fields and report `mnemonic: 'unknown'` rather than throwing
 * — the visualizer must be able to display any word the user loads.
 *
 * Field bit positions follow the RISC-V unprivileged spec, Vol. I.
 */

const MASK_5 = 0x1f;

/**
 * Decode a single 32-bit RV32I instruction word.
 *
 * @param word the machine word; the low 32 bits are used.
 */
export function decode(word: number): DecodedInstruction {
  const raw = word >>> 0;
  const opcode = raw & 0x7f;
  const rd = (raw >>> 7) & MASK_5;
  const funct3 = (raw >>> 12) & 0x7;
  const rs1 = (raw >>> 15) & MASK_5;
  const rs2 = (raw >>> 20) & MASK_5;
  const funct7 = (raw >>> 25) & 0x7f;
  const imm12 = (raw >>> 20) & 0xfff; // SYSTEM discriminator: ecall vs ebreak

  const def = decodeLookup(opcode, funct3, funct7, imm12);

  return {
    raw,
    mnemonic: def?.mnemonic ?? 'unknown',
    format: def?.format ?? null,
    opcode,
    rd,
    rs1,
    rs2,
    funct3,
    funct7,
    imm: def ? extractImmediate(def, raw) : 0,
  };
}
