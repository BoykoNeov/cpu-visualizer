import type { InstructionFields } from './types';
import { defForMnemonic } from './instructions';
import { packImmediate } from './immediates';

/**
 * RV32I encoder — the inverse of {@link decode}, driven by the same
 * {@link INSTRUCTIONS} table. Given a mnemonic and operand fields, produce the
 * 32-bit machine word. The codec masks its inputs and is total; operand range
 * validation and good error messages are the assembler's responsibility (§8).
 *
 * @throws if `mnemonic` is not a known RV32I instruction.
 */

const MASK_5 = 0x1f;

export function encode(mnemonic: string, fields: InstructionFields = {}): number {
  const def = defForMnemonic(mnemonic);
  if (!def) throw new Error(`unknown instruction mnemonic: ${mnemonic}`);

  // Operand-less instructions (fence/ecall/ebreak) have a fixed canonical word.
  if (def.word !== undefined) return def.word >>> 0;

  const rd = (fields.rd ?? 0) & MASK_5;
  const rs1 = (fields.rs1 ?? 0) & MASK_5;
  const rs2 = (fields.rs2 ?? 0) & MASK_5;
  const imm = fields.imm ?? 0;

  let word = (def.opcode & 0x7f) | ((def.funct3 ?? 0) << 12);

  switch (def.format) {
    case 'R':
      word |= (rd << 7) | (rs1 << 15) | (rs2 << 20) | ((def.funct7 ?? 0) << 25);
      break;
    case 'I':
      word |= (rd << 7) | (rs1 << 15) | packImmediate(def, imm);
      if (def.kind === 'shift') word |= (def.funct7 ?? 0) << 25;
      break;
    case 'S':
      word |= (rs1 << 15) | (rs2 << 20) | packImmediate(def, imm);
      break;
    case 'B':
      word |= (rs1 << 15) | (rs2 << 20) | packImmediate(def, imm);
      break;
    case 'U':
      word |= (rd << 7) | packImmediate(def, imm);
      break;
    case 'J':
      word |= (rd << 7) | packImmediate(def, imm);
      break;
  }
  return word >>> 0;
}
