import { describe, expect, it } from 'vitest';
import { decode } from './decoder';
import { encode } from './encoder';
import { INSTRUCTIONS } from './instructions';
import type { InstructionFields } from './types';

/**
 * Hand-verified (assembly, machine-code) oracles. These are computed against the
 * RISC-V spec bit layouts, NOT against our own encoder — so they catch a
 * systematic bit-position error that a self-consistent encode→decode round-trip
 * would happily reproduce in both directions. The tricky encodings (shift-imm,
 * negative branch/jump offsets, ecall/ebreak) are deliberately included.
 */
const ORACLES: { asm: string; mnemonic: string; fields: InstructionFields; hex: number }[] = [
  { asm: 'addi x1, x0, 5', mnemonic: 'addi', fields: { rd: 1, rs1: 0, imm: 5 }, hex: 0x00500093 },
  { asm: 'addi x1, x0, -1', mnemonic: 'addi', fields: { rd: 1, rs1: 0, imm: -1 }, hex: 0xfff00093 },
  { asm: 'add x3, x1, x2', mnemonic: 'add', fields: { rd: 3, rs1: 1, rs2: 2 }, hex: 0x002081b3 },
  { asm: 'sub x3, x1, x2', mnemonic: 'sub', fields: { rd: 3, rs1: 1, rs2: 2 }, hex: 0x402081b3 },
  { asm: 'lw x5, 8(x6)', mnemonic: 'lw', fields: { rd: 5, rs1: 6, imm: 8 }, hex: 0x00832283 },
  { asm: 'sw x5, 12(x6)', mnemonic: 'sw', fields: { rs1: 6, rs2: 5, imm: 12 }, hex: 0x00532623 },
  { asm: 'beq x1, x2, 8', mnemonic: 'beq', fields: { rs1: 1, rs2: 2, imm: 8 }, hex: 0x00208463 },
  // Negative branch offset — exercises imm[12]/imm[11] sign bits.
  { asm: 'beq x1, x2, -4', mnemonic: 'beq', fields: { rs1: 1, rs2: 2, imm: -4 }, hex: 0xfe208ee3 },
  { asm: 'lui x1, 0x12345', mnemonic: 'lui', fields: { rd: 1, imm: 0x12345000 }, hex: 0x123450b7 },
  { asm: 'jal x0, 8', mnemonic: 'jal', fields: { rd: 0, imm: 8 }, hex: 0x0080006f },
  // Negative jump offset — exercises the scrambled J-immediate bit order.
  { asm: 'jal x1, -4', mnemonic: 'jal', fields: { rd: 1, imm: -4 }, hex: 0xffdff0ef },
  // Shift-immediates: imm is the shamt, and srai's funct7 (0x20) must survive.
  { asm: 'slli x5, x6, 3', mnemonic: 'slli', fields: { rd: 5, rs1: 6, imm: 3 }, hex: 0x00331293 },
  { asm: 'srai x5, x6, 3', mnemonic: 'srai', fields: { rd: 5, rs1: 6, imm: 3 }, hex: 0x40335293 },
  // SYSTEM — fixed words, disambiguated by imm[11:0].
  { asm: 'ecall', mnemonic: 'ecall', fields: {}, hex: 0x00000073 },
  { asm: 'ebreak', mnemonic: 'ebreak', fields: {}, hex: 0x00100073 },
];

describe('encode against hand-verified oracles', () => {
  for (const o of ORACLES) {
    it(`encodes ${o.asm}`, () => {
      expect(encode(o.mnemonic, o.fields) >>> 0).toBe(o.hex >>> 0);
    });
  }
});

describe('decode against hand-verified oracles', () => {
  for (const o of ORACLES) {
    it(`decodes ${o.asm}`, () => {
      const d = decode(o.hex);
      expect(d.mnemonic).toBe(o.mnemonic);
      if (o.fields.rd !== undefined) expect(d.rd).toBe(o.fields.rd);
      if (o.fields.rs1 !== undefined) expect(d.rs1).toBe(o.fields.rs1);
      if (o.fields.rs2 !== undefined) expect(d.rs2).toBe(o.fields.rs2);
      if (o.fields.imm !== undefined) expect(d.imm).toBe(o.fields.imm);
    });
  }
});

describe('decode gotchas the field-only seed could not handle', () => {
  it('reads a shift amount, not a sign-extended immediate, for srai', () => {
    // The bug this guards: decoding srai as plain I-type folds funct7 into the
    // immediate (0x40335293 would read as imm 1027 instead of shamt 3).
    const d = decode(0x40335293);
    expect(d.mnemonic).toBe('srai');
    expect(d.imm).toBe(3);
  });

  it('distinguishes srli from srai by funct7 (shared funct3 0x5)', () => {
    expect(decode(0x00335293).mnemonic).toBe('srli'); // funct7 0x00
    expect(decode(0x40335293).mnemonic).toBe('srai'); // funct7 0x20
  });

  it('distinguishes ecall from ebreak by imm[11:0] (identical opcode/funct3/funct7)', () => {
    expect(decode(0x00000073).mnemonic).toBe('ecall');
    expect(decode(0x00100073).mnemonic).toBe('ebreak');
  });

  it('decodes fence', () => {
    expect(decode(0x0ff0000f).mnemonic).toBe('fence');
  });
});

/**
 * Representative operands per format, chosen to exercise sign bits and the full
 * shamt range. Used to assert encode and decode are exact inverses across every
 * instruction in the table — round-trip correct by construction.
 */
function sampleFields(format: string, kind: string | undefined): InstructionFields {
  if (kind === 'system' || kind === 'fence') return {}; // operand-less, fixed word
  if (kind === 'shift') return { rd: 5, rs1: 6, imm: 31 }; // 31 exercises all 5 shamt bits
  switch (format) {
    case 'R':
      return { rd: 5, rs1: 6, rs2: 7 };
    case 'I':
      return { rd: 5, rs1: 6, imm: -3 };
    case 'S':
      return { rs1: 6, rs2: 7, imm: -3 };
    case 'B':
      return { rs1: 6, rs2: 7, imm: -8 };
    case 'U':
      return { rd: 5, imm: 0x12345000 };
    case 'J':
      return { rd: 5, imm: -16 };
    default:
      return {};
  }
}

describe('encode/decode round-trip over the whole table', () => {
  for (const def of INSTRUCTIONS) {
    it(`round-trips ${def.mnemonic}`, () => {
      const fields = sampleFields(def.format, def.kind);
      const d = decode(encode(def.mnemonic, fields));
      expect(d.mnemonic).toBe(def.mnemonic);
      if (fields.rd !== undefined) expect(d.rd).toBe(fields.rd);
      if (fields.rs1 !== undefined) expect(d.rs1).toBe(fields.rs1);
      if (fields.rs2 !== undefined) expect(d.rs2).toBe(fields.rs2);
      if (fields.imm !== undefined) expect(d.imm).toBe(fields.imm);
    });
  }
});

/**
 * Immediate-boundary round-trips. "Round-trip exactly" is an M1 acceptance
 * criterion, so we exercise each format's extreme immediates — full negative/
 * positive reach, and U-type with bit 31 set — not just a mid-range sample. `imm`
 * is written in the same signed convention `decode` reports (e.g. a U-type upper
 * value with bit 31 set reads back as a negative 32-bit value).
 */
describe('encode/decode round-trip at immediate boundaries', () => {
  const cases: { mnemonic: string; fields: InstructionFields }[] = [
    { mnemonic: 'addi', fields: { rd: 1, rs1: 2, imm: 2047 } }, // I max +
    { mnemonic: 'addi', fields: { rd: 1, rs1: 2, imm: -2048 } }, // I min −
    { mnemonic: 'sw', fields: { rs1: 2, rs2: 3, imm: 2047 } },
    { mnemonic: 'sw', fields: { rs1: 2, rs2: 3, imm: -2048 } },
    { mnemonic: 'beq', fields: { rs1: 2, rs2: 3, imm: 4094 } }, // B max even reach
    { mnemonic: 'beq', fields: { rs1: 2, rs2: 3, imm: -4096 } }, // B min reach
    { mnemonic: 'jal', fields: { rd: 1, imm: 1048574 } }, // J max even reach
    { mnemonic: 'jal', fields: { rd: 1, imm: -1048576 } }, // J min reach
    { mnemonic: 'lui', fields: { rd: 1, imm: 0x7ffff000 } }, // U, bit 31 clear
    { mnemonic: 'lui', fields: { rd: 1, imm: -4096 } }, // U = 0xfffff000, bit 31 set
    { mnemonic: 'slli', fields: { rd: 1, rs1: 2, imm: 31 } }, // shamt all bits
    { mnemonic: 'slli', fields: { rd: 1, rs1: 2, imm: 0 } }, // shamt zero
  ];
  for (const c of cases) {
    it(`round-trips ${c.mnemonic} imm=${c.fields.imm}`, () => {
      const d = decode(encode(c.mnemonic, c.fields));
      expect(d.mnemonic).toBe(c.mnemonic);
      expect(d.imm).toBe(c.fields.imm);
      if (c.fields.rd !== undefined) expect(d.rd).toBe(c.fields.rd);
      if (c.fields.rs1 !== undefined) expect(d.rs1).toBe(c.fields.rs1);
      if (c.fields.rs2 !== undefined) expect(d.rs2).toBe(c.fields.rs2);
    });
  }
});

describe('table integrity', () => {
  it('covers the 40 base RV32I integer instructions', () => {
    expect(INSTRUCTIONS).toHaveLength(40);
    expect(new Set(INSTRUCTIONS.map((d) => d.mnemonic)).size).toBe(40);
  });
});
