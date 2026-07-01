import type { DecodedInstruction } from '@cpu-viz/isa';

/**
 * Standard RISC-V ABI register names, indexed by number (`x0`..`x31`). A pure display
 * concern that belongs in the view, not a re-export of any engine/assembler contract.
 */
export const ABI_REGISTER_NAMES: readonly string[] = [
  'zero',
  'ra',
  'sp',
  'gp',
  'tp',
  't0',
  't1',
  't2',
  's0',
  's1',
  'a0',
  'a1',
  'a2',
  'a3',
  'a4',
  'a5',
  'a6',
  'a7',
  's2',
  's3',
  's4',
  's5',
  's6',
  's7',
  's8',
  's9',
  's10',
  's11',
  't3',
  't4',
  't5',
  't6',
];

/** Format a 32-bit value as `0x`-prefixed, zero-padded, 8-digit hex (unsigned). */
export function hex32(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
}

/** Render a decoded instruction as a short, human-readable line for display panels. */
export function formatInstruction(d: DecodedInstruction): string {
  switch (d.format) {
    case 'R':
      return `${d.mnemonic} x${d.rd}, x${d.rs1}, x${d.rs2}`;
    case 'I':
      return `${d.mnemonic} x${d.rd}, x${d.rs1}, ${d.imm}`;
    case 'S':
      return `${d.mnemonic} x${d.rs2}, ${d.imm}(x${d.rs1})`;
    case 'B':
      return `${d.mnemonic} x${d.rs1}, x${d.rs2}, ${d.imm}`;
    case 'U':
      return `${d.mnemonic} x${d.rd}, 0x${(d.imm >>> 12).toString(16)}`;
    case 'J':
      return `${d.mnemonic} x${d.rd}, ${d.imm}`;
    case null:
      return `unknown (0x${d.raw.toString(16).padStart(8, '0')})`;
  }
}
