import { decode } from '@cpu-viz/isa';
import { describe, expect, it } from 'vitest';
import { formatInstruction } from './format';

// Exercises the web -> isa wiring (Vite alias resolution) against real encodings.
describe('formatInstruction', () => {
  it('formats an I-type addi', () => {
    expect(formatInstruction(decode(0x00500093))).toBe('addi x1, x0, 5');
  });

  it('formats an R-type add', () => {
    expect(formatInstruction(decode(0x002081b3))).toBe('add x3, x1, x2');
  });

  it('formats an unknown encoding with its raw word', () => {
    expect(formatInstruction(decode(0x00000000))).toBe('unknown (0x00000000)');
  });
});
