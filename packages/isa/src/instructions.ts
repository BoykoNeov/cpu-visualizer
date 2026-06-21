import type { InstructionDef } from './types';

/**
 * The base RV32I integer instruction set (handoff §7). This is the single source
 * of truth: {@link decode} reads it through {@link decodeLookup} (keyed by opcode,
 * then refined by funct3/funct7/imm12), and {@link encode} reads it through
 * {@link defForMnemonic}. The shared {@link InstructionDef} means the two can never
 * disagree about an opcode the way two hand-maintained tables would.
 *
 * Scope notes: `fence` is decoded as a no-op (we model no memory ordering); the
 * Zifencei (`fence.i`) and Zicsr (CSR) extensions are deliberately out of scope for
 * a pedagogical single-cycle core. That leaves exactly the 40 base integer ops.
 */
export const INSTRUCTIONS: readonly InstructionDef[] = [
  // --- U-type ---
  { mnemonic: 'lui', format: 'U', opcode: 0x37 },
  { mnemonic: 'auipc', format: 'U', opcode: 0x17 },

  // --- J-type ---
  { mnemonic: 'jal', format: 'J', opcode: 0x6f },

  // --- I-type jump ---
  { mnemonic: 'jalr', format: 'I', opcode: 0x67, funct3: 0x0 },

  // --- B-type branches ---
  { mnemonic: 'beq', format: 'B', opcode: 0x63, funct3: 0x0 },
  { mnemonic: 'bne', format: 'B', opcode: 0x63, funct3: 0x1 },
  { mnemonic: 'blt', format: 'B', opcode: 0x63, funct3: 0x4 },
  { mnemonic: 'bge', format: 'B', opcode: 0x63, funct3: 0x5 },
  { mnemonic: 'bltu', format: 'B', opcode: 0x63, funct3: 0x6 },
  { mnemonic: 'bgeu', format: 'B', opcode: 0x63, funct3: 0x7 },

  // --- I-type loads ---
  { mnemonic: 'lb', format: 'I', opcode: 0x03, funct3: 0x0 },
  { mnemonic: 'lh', format: 'I', opcode: 0x03, funct3: 0x1 },
  { mnemonic: 'lw', format: 'I', opcode: 0x03, funct3: 0x2 },
  { mnemonic: 'lbu', format: 'I', opcode: 0x03, funct3: 0x4 },
  { mnemonic: 'lhu', format: 'I', opcode: 0x03, funct3: 0x5 },

  // --- S-type stores ---
  { mnemonic: 'sb', format: 'S', opcode: 0x23, funct3: 0x0 },
  { mnemonic: 'sh', format: 'S', opcode: 0x23, funct3: 0x1 },
  { mnemonic: 'sw', format: 'S', opcode: 0x23, funct3: 0x2 },

  // --- I-type ALU immediates ---
  { mnemonic: 'addi', format: 'I', opcode: 0x13, funct3: 0x0 },
  { mnemonic: 'slti', format: 'I', opcode: 0x13, funct3: 0x2 },
  { mnemonic: 'sltiu', format: 'I', opcode: 0x13, funct3: 0x3 },
  { mnemonic: 'xori', format: 'I', opcode: 0x13, funct3: 0x4 },
  { mnemonic: 'ori', format: 'I', opcode: 0x13, funct3: 0x6 },
  { mnemonic: 'andi', format: 'I', opcode: 0x13, funct3: 0x7 },
  // Shift-immediates: shamt is bits[24:20] (NOT a sign-extended immediate), and
  // funct7 selects logical vs. arithmetic. funct3=0x5 is shared by srli/srai.
  { mnemonic: 'slli', format: 'I', opcode: 0x13, funct3: 0x1, funct7: 0x00, kind: 'shift' },
  { mnemonic: 'srli', format: 'I', opcode: 0x13, funct3: 0x5, funct7: 0x00, kind: 'shift' },
  { mnemonic: 'srai', format: 'I', opcode: 0x13, funct3: 0x5, funct7: 0x20, kind: 'shift' },

  // --- R-type ---
  { mnemonic: 'add', format: 'R', opcode: 0x33, funct3: 0x0, funct7: 0x00 },
  { mnemonic: 'sub', format: 'R', opcode: 0x33, funct3: 0x0, funct7: 0x20 },
  { mnemonic: 'sll', format: 'R', opcode: 0x33, funct3: 0x1, funct7: 0x00 },
  { mnemonic: 'slt', format: 'R', opcode: 0x33, funct3: 0x2, funct7: 0x00 },
  { mnemonic: 'sltu', format: 'R', opcode: 0x33, funct3: 0x3, funct7: 0x00 },
  { mnemonic: 'xor', format: 'R', opcode: 0x33, funct3: 0x4, funct7: 0x00 },
  { mnemonic: 'srl', format: 'R', opcode: 0x33, funct3: 0x5, funct7: 0x00 },
  { mnemonic: 'sra', format: 'R', opcode: 0x33, funct3: 0x5, funct7: 0x20 },
  { mnemonic: 'or', format: 'R', opcode: 0x33, funct3: 0x6, funct7: 0x00 },
  { mnemonic: 'and', format: 'R', opcode: 0x33, funct3: 0x7, funct7: 0x00 },

  // --- MISC-MEM (modeled as a no-op) ---
  { mnemonic: 'fence', format: 'I', opcode: 0x0f, funct3: 0x0, kind: 'fence', word: 0x0ff0000f },

  // --- SYSTEM (no register operands; disambiguated by imm[11:0]) ---
  {
    mnemonic: 'ecall',
    format: 'I',
    opcode: 0x73,
    funct3: 0x0,
    imm12: 0x000,
    kind: 'system',
    word: 0x00000073,
  },
  {
    mnemonic: 'ebreak',
    format: 'I',
    opcode: 0x73,
    funct3: 0x0,
    imm12: 0x001,
    kind: 'system',
    word: 0x00100073,
  },
];

const byOpcode = new Map<number, InstructionDef[]>();
for (const def of INSTRUCTIONS) {
  const list = byOpcode.get(def.opcode);
  if (list) list.push(def);
  else byOpcode.set(def.opcode, [def]);
}

const byMnemonic = new Map<string, InstructionDef>(INSTRUCTIONS.map((def) => [def.mnemonic, def]));

/**
 * Find the instruction for a decoded set of selector fields. A selector that is
 * `undefined` on the descriptor is not checked (e.g. plain ALU-immediates ignore
 * funct7, since those bits are part of their immediate).
 */
export function decodeLookup(
  opcode: number,
  funct3: number,
  funct7: number,
  imm12: number,
): InstructionDef | undefined {
  const candidates = byOpcode.get(opcode);
  if (!candidates) return undefined;
  return candidates.find(
    (def) =>
      (def.funct3 === undefined || def.funct3 === funct3) &&
      (def.funct7 === undefined || def.funct7 === funct7) &&
      (def.imm12 === undefined || def.imm12 === imm12),
  );
}

/** Look up an instruction descriptor by assembler mnemonic, for encoding. */
export function defForMnemonic(mnemonic: string): InstructionDef | undefined {
  return byMnemonic.get(mnemonic);
}
