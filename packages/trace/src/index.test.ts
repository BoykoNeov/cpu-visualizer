import { describe, expect, it } from 'vitest';
import { makeRegisters, RV32I_REGISTER_COUNT } from './index';

describe('trace primitives', () => {
  it('allocates a 32-entry register file zeroed out', () => {
    const regs = makeRegisters();
    expect(regs).toHaveLength(RV32I_REGISTER_COUNT);
    expect([...regs].every((v) => v === 0)).toBe(true);
  });
});
