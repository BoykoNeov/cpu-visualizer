import type { InstructionDef, InstructionFormat } from './types';

/**
 * Per-format immediate codec. Decode (`extractImmediate`) and encode
 * (`packImmediate`) are kept in one file on purpose: they are exact inverses, and
 * co-locating the bit positions is what keeps a round-trip correct by construction.
 * Field positions follow the RISC-V unprivileged spec, Vol. I.
 */

const MASK_5 = 0x1f;

/** Decode the immediate operand from a raw word, per the instruction's format/kind. */
export function extractImmediate(def: InstructionDef, word: number): number {
  if (def.kind === 'shift') return (word >>> 20) & MASK_5; // shamt, bits[24:20]
  if (def.kind === 'system' || def.kind === 'fence') return 0; // no operand
  return extractForFormat(def.format, word);
}

function extractForFormat(format: InstructionFormat, word: number): number {
  // `word | 0` reinterprets the unsigned word as signed so `>>` sign-extends.
  const signed = word | 0;
  switch (format) {
    case 'I':
      return signed >> 20;
    case 'S':
      return ((signed >> 25) << 5) | ((word >>> 7) & MASK_5);
    case 'B':
      return (
        ((signed >> 31) << 12) | // imm[12]
        (((word >>> 7) & 0x1) << 11) | // imm[11]
        (((word >>> 25) & 0x3f) << 5) | // imm[10:5]
        (((word >>> 8) & 0xf) << 1) // imm[4:1]
      );
    case 'U':
      return signed & 0xfffff000; // imm[31:12], already in place
    case 'J':
      return (
        ((signed >> 31) << 20) | // imm[20]
        (((word >>> 12) & 0xff) << 12) | // imm[19:12]
        (((word >>> 20) & 0x1) << 11) | // imm[11]
        (((word >>> 21) & 0x3ff) << 1) // imm[10:1]
      );
    case 'R':
    default:
      return 0;
  }
}

/**
 * Scatter the immediate operand into its encoded bit positions — the immediate
 * bits only (opcode/rd/funct3/rs1/rs2/funct7 are added by the encoder). For a
 * shift this is the shamt; the funct7 shift-type bits are added by the encoder.
 */
export function packImmediate(def: InstructionDef, imm: number): number {
  if (def.kind === 'shift') return (imm & MASK_5) << 20; // shamt, bits[24:20]
  switch (def.format) {
    case 'I':
      return (imm & 0xfff) << 20;
    case 'S':
      return (((imm >> 5) & 0x7f) << 25) | ((imm & 0x1f) << 7);
    case 'B':
      return (
        (((imm >> 12) & 0x1) << 31) | // imm[12]
        (((imm >> 5) & 0x3f) << 25) | // imm[10:5]
        (((imm >> 1) & 0xf) << 8) | // imm[4:1]
        (((imm >> 11) & 0x1) << 7) // imm[11]
      );
    case 'U':
      return imm & 0xfffff000; // imm[31:12]
    case 'J':
      return (
        (((imm >> 20) & 0x1) << 31) | // imm[20]
        (((imm >> 1) & 0x3ff) << 21) | // imm[10:1]
        (((imm >> 11) & 0x1) << 20) | // imm[11]
        (((imm >> 12) & 0xff) << 12) // imm[19:12]
      );
    case 'R':
    default:
      return 0;
  }
}
