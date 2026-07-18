import type { Lesson } from '@cpu-viz/curriculum';
import { CACHE_SMALL } from '@cpu-viz/engine-pipeline';
import { defaultConfig, type ProcessorConfig } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import { LESSONS } from './lessons';
import {
  activeLessonOf,
  exampleSession,
  forkToSandbox,
  lessonOpening,
  lessonSession,
  originNameOf,
  predictsTaken,
  type BranchPrediction,
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

  /** A session position to arrive at the lesson with. */
  const arrivingWith = (
    forwarding: boolean,
    branchPrediction: BranchPrediction = 'none',
    cache: ProcessorConfig['cache'] = null,
  ): {
    forwarding: boolean;
    branchPrediction: BranchPrediction;
    cache: ProcessorConfig['cache'];
  } => ({
    forwarding,
    branchPrediction,
    cache,
  });

  it('honors the declared model — a lesson is prose about ONE machine, not just anchors', () => {
    // The picker is on single-cycle; the lesson was authored against the pipeline.
    expect(lessonOpening(pipelineLesson(), arrivingWith(false)).modelId).toBe('pipeline');
  });

  it('honors a declared config, so the flagship lesson opens with forwarding OFF', () => {
    // Even though the user arrived with forwarding ON: the experiment only reads as an experiment
    // if the machine is seen to stall BEFORE the fix is shown (§12.2), so a lesson that declares
    // its opening position wins over the session's.
    const opening = lessonOpening(
      pipelineLesson({ ...defaultConfig(), forwarding: false }),
      arrivingWith(true),
    );
    expect(opening).toEqual({
      modelId: 'pipeline',
      forwarding: false,
      branchPrediction: 'none',
      cache: null,
    });
  });

  it('leaves forwarding ALONE when the lesson declares no config', () => {
    // The asymmetry, and the one that is easy to get wrong: `config` is optional, and "absent"
    // means the lesson has no opinion — NOT "fall back to the default". The position is
    // session-level and persists across model switches (M3 step 5), so a single-cycle lesson —
    // which ignores the knob entirely — must not silently reset a position the user chose.
    // `defaultConfig().forwarding` is false, so a naive fallback would look correct in the common
    // case and quietly clobber exactly the user who had turned it on.
    expect(defaultConfig().forwarding).toBe(false); // the value a naive fallback would force
    expect(lessonOpening(LESSON, arrivingWith(true)).forwarding).toBe(true);
    expect(lessonOpening(LESSON, arrivingWith(false)).forwarding).toBe(false);
    // The cache is the third knob under the same rule (M6 step 5): a no-config lesson must not
    // clear a cache the user is running. `defaultConfig().cache` is `null`, so a naive fallback
    // would silently switch off exactly the user who had turned a cache on.
    expect(defaultConfig().cache).toBeNull(); // the value a naive fallback would force
    expect(lessonOpening(LESSON, arrivingWith(false, 'none', CACHE_SMALL)).cache).toBe(CACHE_SMALL);
  });

  /**
   * A DECLARED config is honored WHOLE — every knob, including the ones the lesson is not about.
   * The test M4 step 4 wrote the inverse of first, and the inverse shipped a real defect to the
   * browser before being reverted.
   *
   * The seductive reading was per-knob: `forwarding-bubble` is a lesson about forwarding, so it
   * should pin forwarding and leave prediction to the user. What that misses is that the lesson's
   * closing narration quotes "72 cycles with forwarding off, 51 with it on" AS FACT, and those
   * numbers hold only under predict-not-taken (`static-taken` runs the same program in 70 and 49).
   * Leaving prediction alone therefore parks the user in a machine the lesson lies about — seen in
   * the browser as prose reading 51 above a transport reading 49.
   *
   * So a lesson pins every honored knob, because it is a controlled experiment and the knobs it is
   * NOT about are exactly the controls. Arriving on `static-taken` must not survive.
   */
  it('a declared config resets EVERY knob, including ones the lesson is not about', () => {
    const opening = lessonOpening(
      pipelineLesson({
        ...defaultConfig(),
        forwarding: false,
        branchPrediction: 'static-not-taken',
      }),
      // The user arrived with ALL THREE knobs against the lesson — including a cache the declared
      // config (default, `cache: null`) must switch back off.
      arrivingWith(true, 'static-taken', CACHE_SMALL),
    );
    expect(opening.forwarding, 'the subject knob is pinned').toBe(false);
    expect(opening.branchPrediction, 'the CONTROL knob is pinned too').toBe('static-not-taken');
    expect(
      opening.cache,
      'the cache is a control knob too — reset to the declared null',
    ).toBeNull();
  });

  it('honors a declared prediction scheme — the field is live the moment a lesson uses it', () => {
    // `model`/`config` were declared-and-honored-by-nobody from M1 until M3 step 8. This pins that
    // prediction did not inherit that fate: it is honored on arrival, not "when M4 step 7 needs it".
    const opening = lessonOpening(
      pipelineLesson({ ...defaultConfig(), branchPrediction: 'static-taken' }),
      arrivingWith(true, 'none'),
    );
    expect(opening.branchPrediction).toBe('static-taken');
  });

  it('opens every SHIPPED lesson on a model that exists, in a position it can teach in', () => {
    // Against the real authored library rather than fixtures — these are untrusted JSON, and the
    // opening is the one thing about them no anchoring test can check (an anchor proves an event
    // fired; it cannot prove the user is looking at the machine the words describe).
    //
    // Arriving on the position each shipped lesson would be WRONG in, so "honored" is a claim the
    // sweep can fail rather than one it can coincide with: every lesson that declares a config is
    // reset off `static-taken`, and the one lesson that declares forwarding is reset off ON.
    for (const lesson of LESSONS) {
      const opening = lessonOpening(lesson, arrivingWith(true, 'static-taken', CACHE_SMALL));
      expect(opening.modelId, `${lesson.id} opens on a model`).toBe(lesson.model);
      if (lesson.config === undefined) continue;
      expect(opening.forwarding, `${lesson.id} opens in its declared forwarding position`).toBe(
        lesson.config.forwarding,
      );
      expect(opening.branchPrediction, `${lesson.id} opens in its declared scheme`).toBe(
        lesson.config.branchPrediction,
      );
      // Arriving on a cache the lesson does not declare, so "honored" is failable: both shipped
      // pipeline lessons declare `cache: null`, so a leaked session cache would redden here.
      expect(opening.cache, `${lesson.id} opens in its declared cache`).toBe(lesson.config.cache);
    }
  });
});

/**
 * The shell's whole reading of a three-named, two-behaviored knob (M4 step 4). The claim that
 * makes two positions COMPLETE — that the three schemes are two machines — is an engine fact and
 * is measured in `simulator.test.ts`; these pin the mapping the control and its no-op guard share.
 */
describe('predictsTaken — three scheme names, two behaviors', () => {
  it('only static-taken bets', () => {
    expect(predictsTaken('static-taken')).toBe(true);
    expect(predictsTaken('static-not-taken')).toBe(false);
  });

  it("'none' reads as not-taken: a machine with no predictor keeps fetching", () => {
    // M4 step 1's finding, and the reason the control can have two positions without lying: "no
    // prediction" and "predict not taken" are one policy under two names, because the fall-through
    // IS the not-taken path. So the "not taken" button is lit for BOTH — including at startup,
    // where `defaultConfig()` is what the shell opens on.
    expect(predictsTaken('none')).toBe(false);
    expect(predictsTaken(defaultConfig().branchPrediction)).toBe(false);
  });
});
