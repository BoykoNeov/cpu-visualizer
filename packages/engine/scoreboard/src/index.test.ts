import { describe, expect, it } from 'vitest';
import { SCOREBOARD_MODEL_ID } from './index';

describe('engine-scoreboard', () => {
  it('declares its model-family id', () => {
    expect(SCOREBOARD_MODEL_ID).toBe('scoreboard');
  });
});
