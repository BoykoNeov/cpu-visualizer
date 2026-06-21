import type { DecodedInstruction } from '@cpu-viz/isa';

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
