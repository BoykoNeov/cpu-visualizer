import { describe, expect, it } from 'vitest';
import { DEPTH_TIERS, resolveNarration } from './lesson';

describe('resolveNarration (lawful simplification, INV-5)', () => {
  it('lists three depth tiers in increasing detail', () => {
    expect(DEPTH_TIERS).toEqual(['essentials', 'detailed', 'expert']);
  });

  it('shows the highest authored variant at or below the current tier', () => {
    const narration = { essentials: 'simple', expert: 'detailed' };
    expect(resolveNarration(narration, 'essentials')).toBe('simple');
    // `detailed` has no own variant -> falls back to `essentials`, never to `expert`.
    expect(resolveNarration(narration, 'detailed')).toBe('simple');
    expect(resolveNarration(narration, 'expert')).toBe('detailed');
  });

  it('returns undefined when nothing is authored at or below the tier', () => {
    expect(resolveNarration({ expert: 'x' }, 'essentials')).toBeUndefined();
  });
});
