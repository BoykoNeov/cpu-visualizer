import { describe, expect, it } from 'vitest';
import { REFERENCE_MODEL_ID } from './index';

describe('engine-reference', () => {
  it('declares its model-family id', () => {
    expect(REFERENCE_MODEL_ID).toBe('reference');
  });
});
