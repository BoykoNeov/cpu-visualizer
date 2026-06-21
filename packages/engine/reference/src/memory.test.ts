import { describe, expect, it } from 'vitest';
import { SparseMemory } from './memory';

describe('SparseMemory', () => {
  it('reads never-written addresses as 0', () => {
    const m = new SparseMemory();
    expect(m.readByte(0x1000)).toBe(0);
    expect(m.readHalf(0x1000)).toBe(0);
    expect(m.readWord(0x1000)).toBe(0);
  });

  it('round-trips a word little-endian', () => {
    const m = new SparseMemory();
    m.writeWord(0x2000, 0x12345678);
    expect(m.readByte(0x2000)).toBe(0x78);
    expect(m.readByte(0x2001)).toBe(0x56);
    expect(m.readByte(0x2002)).toBe(0x34);
    expect(m.readByte(0x2003)).toBe(0x12);
    expect(m.readWord(0x2000) >>> 0).toBe(0x12345678);
  });

  it('returns words as signed int32 (high bit set)', () => {
    const m = new SparseMemory();
    m.writeWord(0x3000, 0x80000000);
    expect(m.readWord(0x3000)).toBe(-2147483648);
    expect(m.readWord(0x3000) >>> 0).toBe(0x80000000);
  });

  it('round-trips a halfword little-endian, zero-extended', () => {
    const m = new SparseMemory();
    m.writeHalf(0x4000, 0x8001);
    expect(m.readByte(0x4000)).toBe(0x01);
    expect(m.readByte(0x4001)).toBe(0x80);
    expect(m.readHalf(0x4000)).toBe(0x8001); // 0..0xffff, no sign extension here
  });

  it('masks stored bytes to 8 bits', () => {
    const m = new SparseMemory();
    m.writeByte(0x5000, 0x1ff);
    expect(m.readByte(0x5000)).toBe(0xff);
  });

  it('loadBytes places a segment verbatim', () => {
    const m = new SparseMemory();
    m.loadBytes(0x6000, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(m.readWord(0x6000) >>> 0).toBe(0xefbeadde); // little-endian assembly
  });

  it('reports word-aligned defined addresses, ascending', () => {
    const m = new SparseMemory();
    m.writeByte(0x1003, 1); // within the 0x1000 word
    m.writeByte(0x1000, 1);
    m.writeWord(0x1004, 0);
    expect(m.definedAddresses()).toEqual([0x1000, 0x1004]);
  });
});
