import type { DecodedInstruction, InstructionFormat } from './types';

/**
 * RV32I decoder seed. Extracts every architectural field and the correctly
 * sign-extended immediate for each format, and names a representative subset of the
 * base integer instructions. Unknown encodings still decode their fields and report
 * `mnemonic: 'unknown'` rather than throwing — the visualizer must be able to display
 * any word the user loads.
 *
 * Field bit positions follow the RISC-V unprivileged spec, Vol. I.
 */

const MASK_5 = 0x1f;

/** Identifies a known instruction by its opcode and (where relevant) function fields. */
interface TableEntry {
  readonly mnemonic: string;
  readonly format: InstructionFormat;
  /** funct3 selector, when the opcode needs it to disambiguate. */
  readonly funct3?: number;
  /** funct7 selector, when the opcode + funct3 still need it (R-type, shifts). */
  readonly funct7?: number;
}

/**
 * A deliberately small but real slice of RV32I, keyed by `opcode` then refined by
 * `funct3`/`funct7`. The full table is build-order step 1 (handoff §11).
 */
const BY_OPCODE: ReadonlyMap<number, readonly TableEntry[]> = new Map([
  [0x37, [{ mnemonic: 'lui', format: 'U' }]],
  [0x17, [{ mnemonic: 'auipc', format: 'U' }]],
  [0x6f, [{ mnemonic: 'jal', format: 'J' }]],
  [0x67, [{ mnemonic: 'jalr', format: 'I', funct3: 0x0 }]],
  [
    0x63,
    [
      { mnemonic: 'beq', format: 'B', funct3: 0x0 },
      { mnemonic: 'bne', format: 'B', funct3: 0x1 },
    ],
  ],
  [0x03, [{ mnemonic: 'lw', format: 'I', funct3: 0x2 }]],
  [0x23, [{ mnemonic: 'sw', format: 'S', funct3: 0x2 }]],
  [0x13, [{ mnemonic: 'addi', format: 'I', funct3: 0x0 }]],
  [
    0x33,
    [
      { mnemonic: 'add', format: 'R', funct3: 0x0, funct7: 0x00 },
      { mnemonic: 'sub', format: 'R', funct3: 0x0, funct7: 0x20 },
    ],
  ],
]);

function lookup(opcode: number, funct3: number, funct7: number): TableEntry | undefined {
  const candidates = BY_OPCODE.get(opcode);
  if (!candidates) return undefined;
  return candidates.find(
    (e) =>
      (e.funct3 === undefined || e.funct3 === funct3) &&
      (e.funct7 === undefined || e.funct7 === funct7),
  );
}

/** Compute the sign-extended immediate for a given format from the raw word. */
function immediateFor(format: InstructionFormat | null, word: number): number {
  // `word | 0` reinterprets the unsigned word as a signed 32-bit value so that `>>`
  // performs an arithmetic (sign-extending) shift.
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
      return signed & 0xfffff000;
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

  const entry = lookup(opcode, funct3, funct7);
  const format = entry?.format ?? null;

  return {
    raw,
    mnemonic: entry?.mnemonic ?? 'unknown',
    format,
    opcode,
    rd,
    rs1,
    rs2,
    funct3,
    funct7,
    imm: immediateFor(format, raw),
  };
}
