import type { Lesson } from '@cpu-viz/curriculum';
import { defaultConfig } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import { LESSONS } from './lessons';
import {
  activeLessonOf,
  exampleSession,
  forkToSandbox,
  lessonOpening,
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

/**
 * What starting a lesson does to the shell's model + config (M3 step 8) — the seam `startLesson`
 * had all along and nobody had noticed, because until now every lesson was authored against the
 * default model and had no opinion about config, so ignoring both fields was indistinguishable
 * from honoring them. `forwarding-bubble` is the first lesson for which it is not.
 */
describe('a lesson opens on the model + config it declares', () => {
  const pipelineLesson = (config?: Lesson['config']): Lesson => ({
    ...LESSON,
    id: 'forwarding-bubble',
    model: 'pipeline',
    ...(config === undefined ? {} : { config }),
  });

  it('honors the declared model — a lesson is prose about ONE machine, not just anchors', () => {
    // The picker is on single-cycle; the lesson was authored against the pipeline.
    expect(lessonOpening(pipelineLesson(), { forwarding: false }).modelId).toBe('pipeline');
  });

  it('honors a declared config, so the flagship lesson opens with forwarding OFF', () => {
    // Even though the user arrived with forwarding ON: the experiment only reads as an experiment
    // if the machine is seen to stall BEFORE the fix is shown (§12.2), so a lesson that declares
    // its opening position wins over the session's.
    const opening = lessonOpening(pipelineLesson({ ...defaultConfig(), forwarding: false }), {
      forwarding: true,
    });
    expect(opening).toEqual({ modelId: 'pipeline', forwarding: false });
  });

  it('leaves forwarding ALONE when the lesson declares no config', () => {
    // The asymmetry, and the one that is easy to get wrong: `config` is optional, and "absent"
    // means the lesson has no opinion — NOT "fall back to the default". The position is
    // session-level and persists across model switches (M3 step 5), so a single-cycle lesson —
    // which ignores the knob entirely — must not silently reset a position the user chose.
    // `defaultConfig().forwarding` is false, so a naive fallback would look correct in the common
    // case and quietly clobber exactly the user who had turned it on.
    expect(defaultConfig().forwarding).toBe(false); // the value a naive fallback would force
    expect(lessonOpening(LESSON, { forwarding: true }).forwarding).toBe(true);
    expect(lessonOpening(LESSON, { forwarding: false }).forwarding).toBe(false);
  });

  it('opens every SHIPPED lesson on a model that exists, in a position it can teach in', () => {
    // Against the real authored library rather than fixtures — these are untrusted JSON, and the
    // opening is the one thing about them no anchoring test can check (an anchor proves an event
    // fired; it cannot prove the user is looking at the machine the words describe).
    for (const lesson of LESSONS) {
      const opening = lessonOpening(lesson, { forwarding: false });
      expect(opening.modelId, `${lesson.id} opens on a model`).toBe(lesson.model);
      if (lesson.config) expect(opening.forwarding).toBe(lesson.config.forwarding);
    }
  });
});
