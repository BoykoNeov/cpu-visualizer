import { describe, expect, it } from 'vitest';
import { SINGLE_CYCLE_MODEL_ID } from './index';

describe('engine-single-cycle', () => {
  it('declares its model-family id', () => {
    expect(SINGLE_CYCLE_MODEL_ID).toBe('single-cycle');
  });
});
