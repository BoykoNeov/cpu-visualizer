import { describe, expect, it } from 'vitest';
import { decode } from './decoder';

describe('decode', () => {
  it('decodes an I-type addi with a positive immediate', () => {
    // addi x1, x0, 5  ->  0x00500093
    const d = decode(0x00500093);
    expect(d.mnemonic).toBe('addi');
    expect(d.format).toBe('I');
    expect(d.rd).toBe(1);
    expect(d.rs1).toBe(0);
    expect(d.imm).toBe(5);
  });

  it('sign-extends a negative I-type immediate', () => {
    // addi x1, x0, -1  ->  0xFFF00093
    const d = decode(0xfff00093);
    expect(d.mnemonic).toBe('addi');
    expect(d.imm).toBe(-1);
  });

  it('decodes an R-type add (no immediate)', () => {
    // add x3, x1, x2  ->  0x002081B3
    const d = decode(0x002081b3);
    expect(d.mnemonic).toBe('add');
    expect(d.format).toBe('R');
    expect(d.rd).toBe(3);
    expect(d.rs1).toBe(1);
    expect(d.rs2).toBe(2);
    expect(d.imm).toBe(0);
  });

  it('distinguishes sub from add via funct7', () => {
    // sub x3, x1, x2  ->  0x402081B3
    const d = decode(0x402081b3);
    expect(d.mnemonic).toBe('sub');
    expect(d.funct7).toBe(0x20);
  });

  it('decodes a load (I-type) with byte offset', () => {
    // lw x5, 8(x6)  ->  0x00832283
    const d = decode(0x00832283);
    expect(d.mnemonic).toBe('lw');
    expect(d.rd).toBe(5);
    expect(d.rs1).toBe(6);
    expect(d.imm).toBe(8);
  });

  it('decodes a store (S-type) immediate', () => {
    // sw x5, 12(x6)  ->  0x00532623
    const d = decode(0x00532623);
    expect(d.mnemonic).toBe('sw');
    expect(d.format).toBe('S');
    expect(d.rs1).toBe(6);
    expect(d.rs2).toBe(5);
    expect(d.imm).toBe(12);
  });

  it('decodes a B-type branch immediate', () => {
    // beq x1, x2, 8  ->  0x00208463
    const d = decode(0x00208463);
    expect(d.mnemonic).toBe('beq');
    expect(d.format).toBe('B');
    expect(d.imm).toBe(8);
  });

  it('decodes a U-type upper immediate', () => {
    // lui x1, 0x12345  ->  0x123450B7
    const d = decode(0x123450b7);
    expect(d.mnemonic).toBe('lui');
    expect(d.format).toBe('U');
    expect(d.rd).toBe(1);
    expect(d.imm).toBe(0x12345000);
  });

  it('decodes a J-type jump immediate', () => {
    // jal x0, 8  ->  0x0080006F
    const d = decode(0x0080006f);
    expect(d.mnemonic).toBe('jal');
    expect(d.format).toBe('J');
    expect(d.imm).toBe(8);
  });

  it('reports unknown encodings without throwing', () => {
    const d = decode(0x00000000);
    expect(d.mnemonic).toBe('unknown');
    expect(d.format).toBeNull();
  });
});
