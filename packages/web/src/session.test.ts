import type { Lesson } from '@cpu-viz/curriculum';
import { describe, expect, it } from 'vitest';
import {
  activeLessonOf,
  exampleSession,
  forkToSandbox,
  lessonSession,
  originNameOf,
} from './session';

/**
 * The spec §13 fork contract, tested off the UI: when a program is edited mid-lesson the
 * lesson's annotations DETACH and the user drops into a sandbox on the edited program, while
 * the origin is retained so a revert is possible. `useSimulator` is a thin React wrapper over
 * these pure transitions; proving them here means the detach is correct without a jsdom.
 */
const LESSON: Lesson = {
  id: 'sum-loop-tour',
  title: 'A tour of the sum loop',
  program: 'sum-loop',
  model: 'single-cycle',
  depthDefault: 'detailed',
  steps: [{ trigger: { event: 'reg-write', where: { reg: 10 } }, narration: { detailed: '…' } }],
};

describe('session transitions', () => {
  it('example / lesson sessions expose their program and (only lesson) an active lesson', () => {
    const example = exampleSession('sum-loop');
    expect(originNameOf(example)).toBe('sum-loop');
    expect(activeLessonOf(example)).toBeNull();

    const lesson = lessonSession(LESSON);
    expect(originNameOf(lesson)).toBe('sum-loop'); // the lesson's referenced program
    expect(activeLessonOf(lesson)).toBe(LESSON);
  });

  it('forking mid-lesson detaches the lesson but keeps the origin program', () => {
    const forked = forkToSandbox(lessonSession(LESSON));
    expect(forked.kind).toBe('sandbox');
    // The annotations detach — a sandbox has no active lesson…
    expect(activeLessonOf(forked)).toBeNull();
    // …but the lesson is not destroyed: the origin is retained so it can be resumed / reverted.
    expect(originNameOf(forked)).toBe('sum-loop');
  });

  it('forking from free-play retains the example as origin', () => {
    const forked = forkToSandbox(exampleSession('array-sum'));
    expect(forked.kind).toBe('sandbox');
    expect(originNameOf(forked)).toBe('array-sum');
  });

  it('editing a sandbox again keeps the same origin (does not lose the fork point)', () => {
    const once = forkToSandbox(lessonSession(LESSON));
    const twice = forkToSandbox(once);
    expect(twice.kind).toBe('sandbox');
    expect(originNameOf(twice)).toBe('sum-loop');
  });

  it('forking from nothing loaded yields a sandbox with no origin', () => {
    const forked = forkToSandbox(null);
    expect(forked).toEqual({ kind: 'sandbox', origin: null });
  });
});
