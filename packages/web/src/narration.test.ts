import type { AnchoredStep, DepthTier, LessonStep } from '@cpu-viz/curriculum';
import { describe, expect, it } from 'vitest';
import { narrationView } from './narration';

/**
 * The narration panel's view-model (spec §11 "the lessons play through"). The runner's own
 * anchoring/tier logic is proven in `curriculum` (against the real engine in `lessons.test.ts`);
 * this pins only what the panel adds on top — timeline ordering of the anchored steps, the
 * active-step index, and the prev/next scrub targets — with hand-built anchored steps (mirrors
 * `session.test.ts`), so no engine or React is needed.
 */

/** Build an anchored step with per-tier narration; `cycle: null` models a never-fired step. */
function step(
  index: number,
  cycle: number | null,
  eventIndex: number,
  narration: Partial<Record<DepthTier, string>>,
): AnchoredStep {
  const lessonStep: LessonStep = { trigger: { event: 'instr-fetch' }, narration };
  return { step: lessonStep, index, cycle, eventIndex };
}

/** A three-step lesson anchored at cycles 1, 3, 5 (in authoring order). */
const anchored: AnchoredStep[] = [
  step(0, 1, 0, { essentials: 'fetch', detailed: 'the fetch phase' }),
  step(1, 3, 0, { essentials: 'compute', expert: 'the ALU computes' }),
  step(2, 5, 0, { essentials: 'done', detailed: 'the result is written back' }),
];

describe('narrationView — the play-through view-model', () => {
  it('before the first step fires: nothing active, and "next" begins the lesson', () => {
    const v = narrationView(anchored, -1, 'detailed');
    expect(v.activeIndex).toBe(-1);
    expect(v.narration).toBeUndefined();
    expect(v.prevCycle).toBeNull();
    expect(v.nextCycle).toBe(1); // "Next step" jumps to the first step's cycle
    expect(v.steps.map((s) => s.active)).toEqual([false, false, false]);
  });

  it('at a step, surfaces its narration and the neighbouring scrub targets', () => {
    const v = narrationView(anchored, 3, 'expert');
    expect(v.activeIndex).toBe(1);
    expect(v.narration).toBe('the ALU computes'); // step 1's expert variant
    expect(v.prevCycle).toBe(1);
    expect(v.nextCycle).toBe(5);
    expect(v.steps[1]!.active).toBe(true);
  });

  it('a cursor between anchors keeps the earlier step active (INV-6 anchoring)', () => {
    // Cursor 4 is past step 1 (cycle 3) but before step 2 (cycle 5): step 1 still owns it.
    const v = narrationView(anchored, 4, 'essentials');
    expect(v.activeIndex).toBe(1);
    expect(v.narration).toBe('compute');
  });

  it('at the last step, "next" is exhausted but "prev" still walks back', () => {
    const v = narrationView(anchored, 5, 'detailed');
    expect(v.activeIndex).toBe(2);
    expect(v.nextCycle).toBeNull();
    expect(v.prevCycle).toBe(3);
  });

  it('resolves narration at the current tier, falling back lawfully (INV-5)', () => {
    // Step 1 authored only { essentials, expert }. At `detailed` it falls back to essentials;
    // at `expert` it shows the expert variant.
    expect(narrationView(anchored, 3, 'detailed').narration).toBe('compute');
    expect(narrationView(anchored, 3, 'expert').narration).toBe('the ALU computes');
  });

  it('a step with no narration at/below the tier resolves to undefined but stays in the rail', () => {
    // A single step authored only at `expert`, viewed at `essentials`.
    const expertOnly = [step(0, 2, 0, { expert: 'deep detail' })];
    const v = narrationView(expertOnly, 2, 'essentials');
    expect(v.steps).toHaveLength(1);
    expect(v.activeIndex).toBe(0);
    expect(v.narration).toBeUndefined();
  });

  it('drops never-fired steps from the rail without disturbing the rest', () => {
    const withDead = [
      step(0, 1, 0, { essentials: 'a' }),
      step(1, null, 0, { essentials: 'never' }), // unsatisfiable trigger
      step(2, 4, 0, { essentials: 'c' }),
    ];
    const v = narrationView(withDead, 4, 'essentials');
    expect(v.steps.map((s) => s.index)).toEqual([0, 2]); // the dead step is gone
    expect(v.activeIndex).toBe(1); // step index 2 is the 2nd playable step
    expect(v.narration).toBe('c');
  });

  it('orders steps and resolves ties by (cycle, eventIndex), not authoring order', () => {
    // Two steps share cycle 2; the one with the greater eventIndex fires later and wins the tie.
    const sameCycle = [
      step(0, 2, 5, { essentials: 'later-in-cycle' }),
      step(1, 2, 1, { essentials: 'earlier-in-cycle' }),
    ];
    const v = narrationView(sameCycle, 2, 'essentials');
    expect(v.steps.map((s) => s.index)).toEqual([1, 0]); // sorted by eventIndex within the cycle
    expect(v.activeIndex).toBe(1); // the later event (index 0) owns the cursor
    expect(v.narration).toBe('later-in-cycle');
  });
});
