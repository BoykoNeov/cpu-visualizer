import { describe, expect, it } from 'vitest';
import { emptyProgram } from './index';

describe('emptyProgram', () => {
  it('is a valid, empty AssembledProgram', () => {
    const p = emptyProgram();
    expect(p.words).toHaveLength(0);
    expect(p.symbols.size).toBe(0);
    expect(p.sourceMap.size).toBe(0);
    expect(p.data).toEqual([]);
  });
});
