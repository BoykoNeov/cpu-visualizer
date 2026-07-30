import type { Lesson } from '@cpu-viz/curriculum';
import { CACHE_SMALL } from '@cpu-viz/engine-pipeline';
import { SuperscalarProcessor } from '@cpu-viz/engine-superscalar';
import { OutOfOrderProcessor } from '@cpu-viz/engine-out-of-order';
import { defaultConfig, type Processor, type ProcessorConfig } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import { LESSONS } from './lessons';
import { EXAMPLE_PROGRAMS } from './programs';
import { loadSource } from './simulator';
import {
  activeLessonOf,
  exampleSession,
  forkToSandbox,
  lessonOpening,
  lessonSession,
  OPENING_KNOBS,
  openingKnobs,
  originNameOf,
  predictsTaken,
  type BranchPrediction,
  type LessonOpening,
  type SessionKnobs,
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
    issueWidth = 1,
    outOfOrderIssue = false,
    robSize = 16,
    slowOpLatency = 1,
    numMshrs = 2,
  ): {
    forwarding: boolean;
    branchPrediction: BranchPrediction;
    cache: ProcessorConfig['cache'];
    issueWidth: number;
    outOfOrderIssue: boolean;
    robSize: number;
    slowOpLatency: number;
    numMshrs: number;
  } => ({
    forwarding,
    branchPrediction,
    cache,
    issueWidth,
    outOfOrderIssue,
    robSize,
    slowOpLatency,
    numMshrs,
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
      issueWidth: 1,
      outOfOrderIssue: false,
      robSize: 16,
      slowOpLatency: 1,
      numMshrs: 2,
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
    // The width is the FOURTH knob under the same rule (M7 step 6), and the trap is sharper here
    // than for the other three: `ProcessorConfig.issueWidth` is OPTIONAL, so `defaultConfig()`
    // leaves it undefined and the shell supplies the 1 — meaning a naive fallback would not even
    // look like a fallback, it would look like the field simply not being carried. A reader at
    // width 2 must still be at width 2.
    expect(defaultConfig().issueWidth).toBeUndefined(); // there is no default to fall back TO
    expect(lessonOpening(LESSON, arrivingWith(false, 'none', null, 2)).issueWidth).toBe(2);
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
      // The user arrived with ALL FOUR knobs against the lesson — including a cache the declared
      // config (default, `cache: null`) must switch back off, and a width-2 machine it must return
      // to 1.
      arrivingWith(true, 'static-taken', CACHE_SMALL, 2),
    );
    expect(opening.forwarding, 'the subject knob is pinned').toBe(false);
    expect(opening.branchPrediction, 'the CONTROL knob is pinned too').toBe('static-not-taken');
    expect(
      opening.cache,
      'the cache is a control knob too — reset to the declared null',
    ).toBeNull();
    // The width is where "honored WHOLE" is most easily lost, because the declared config here does
    // not MENTION `issueWidth` — it is optional, so a config can be total and still omit it. Omitting
    // it means width 1 (the engine's own `?? 1`), NOT "leave the user where they were": that second
    // reading is the per-knob rule M4 step 4 shipped and the browser caught, and it would park a
    // reader of a 1-wide lesson on a 2-wide machine whose cycle counts contradict the prose.
    expect(
      opening.issueWidth,
      'an omitted width in a DECLARED config means 1, not "leave it alone"',
    ).toBe(1);
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
    // reset off `static-taken`, and the one lesson that declares forwarding is reset off ON. Arrival
    // width stays at the default 1 (see `arrivingWith`), so the first superscalar lesson (M8 step 1,
    // which declares `issueWidth: 2`) makes the width line failable: a plumbing bug that leaked the
    // arrival width would open it at 1, and its whole narration — "44 vs 56", "IPC 0.77 vs 0.61" —
    // is a lie the moment the reader is on a 1-wide machine (the milestone's headline failure mode:
    // the engine's `issueWidth ?? 1` default reads 56/56 with every anchoring test still green).
    //
    // Arriving with the OoO cluster set AWAY from the flagship's declaration too (M10 step 2): issue
    // IN-order and ROB 4, so the first `out-of-order` lesson — which declares `outOfOrderIssue: true`
    // and `robSize: 16` — makes both OoO lines failable. This is the milestone's headline failure
    // mode made concrete: the engine reads a missing `outOfOrderIssue` as `false`, so a plumbing leak
    // would open the flagship on the IN-ORDER machine while every anchoring test stays green (the
    // event multiset is toggle-invariant), and the whole lesson — "cycle 9 vs 20", "59 vs 71" — is a
    // lie the reader is not looking at.
    for (const lesson of LESSONS) {
      const opening = lessonOpening(
        lesson,
        arrivingWith(true, 'static-taken', CACHE_SMALL, 1, false, 4, 3, 1),
      );
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
      // The width knob, the one that has never carried a shipped lesson until M8. `issueWidth` is
      // OPTIONAL on a declared config, so an omitted width means 1 (the engine's own `?? 1`); a
      // declared 2 must survive the opening whole, exactly like the other three knobs.
      expect(opening.issueWidth, `${lesson.id} opens at its declared width`).toBe(
        lesson.config.issueWidth ?? 1,
      );
      // The M9/M10 OoO cluster (step 2), same OPTIONAL-field reading as `issueWidth`: an omitted knob
      // means the engine's own default (`?? false` / `?? 16`), and a declared value must survive the
      // opening whole. Failable because the arrival above sets both away from the flagship's config.
      expect(opening.outOfOrderIssue, `${lesson.id} opens in its declared issue order`).toBe(
        lesson.config.outOfOrderIssue ?? false,
      );
      expect(opening.robSize, `${lesson.id} opens at its declared ROB size`).toBe(
        lesson.config.robSize ?? 16,
      );
      // The M10 slow-op knob (step 3), same OPTIONAL-field reading: an omitted latency means 1 (the
      // engine's `?? 1`), a declared one must survive whole. Failable because the arrival above sets
      // it to 3 — a value no lesson declares — so a lessonOpening that leaked the arrival instead of
      // reading the lesson would redden here. This is the ONLY headless net on the slow-op plumbing:
      // the useSimulator threading itself (ref set/read/reset) is browser-only ([[browser-is-the-only-net]]),
      // so a slow-op lesson silently recording at latency 1 in the shell is a step-8 must-verify.
      expect(opening.slowOpLatency, `${lesson.id} opens at its declared slow-op latency`).toBe(
        lesson.config.slowOpLatency ?? 1,
      );
      // The MSHR knob (M9's `numMshrs`), the SECOND uncontrolled knob, same OPTIONAL-field reading:
      // omitted means 2 (the engine's `?? 2`). Failable because the arrival above sets it to 1 — a
      // value no lesson declares. Before this fix `LessonOpening` didn't carry `numMshrs` at all, so
      // a lesson declaring it recorded silently at the default (M9+M10 review finding 5).
      expect(opening.numMshrs, `${lesson.id} opens at its declared MSHR count`).toBe(
        lesson.config.numMshrs ?? 2,
      );
    }
  });

  /**
   * The two UNCONTROLLED knobs (`slowOpLatency`, `numMshrs`) reset to their defaults even for a
   * CONFIG-LESS lesson, while every CONTROLLED knob persists (M9+M10 review finding 3). This is the
   * one place the config-less rule is NOT "leave everything the user set alone": a knob with no shell
   * control can only hold a non-default value that leaked from a PRIOR lesson, so carrying it into a
   * config-less lesson would silently record at a latency/MSHR count the reader never chose and
   * nothing on screen explains. Two-sided on purpose — the reset AND the persistence both matter.
   */
  it('a config-less lesson resets the uncontrolled knobs but leaves the controlled ones alone', () => {
    // Arrive as if a prior lesson (the RS lesson) left latency 8 and MSHRs 1 in the refs, while the
    // user independently set forwarding on, a small cache, width 2, out-of-order, ROB 4.
    const opening = lessonOpening(
      LESSON, // the config-less pipeline lesson
      arrivingWith(true, 'static-taken', CACHE_SMALL, 2, true, 4, 8, 1),
    );
    // The uncontrolled pair is forced back to the engine defaults — the leak is closed.
    expect(opening.slowOpLatency, 'slow-op latency resets to 1 (no control to persist it)').toBe(1);
    expect(opening.numMshrs, 'MSHR count resets to 2 (no control to persist it)').toBe(2);
    // Every CONTROLLED knob is left exactly where the user had it — a config-less lesson has no
    // opinion about the machine, and these all have shell controls the user can see.
    expect(opening.forwarding, 'forwarding persists').toBe(true);
    expect(opening.branchPrediction, 'prediction persists').toBe('static-taken');
    expect(opening.cache, 'cache persists').toBe(CACHE_SMALL);
    expect(opening.issueWidth, 'issue width persists').toBe(2);
    expect(opening.outOfOrderIssue, 'issue order persists').toBe(true);
    expect(opening.robSize, 'ROB size persists').toBe(4);
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

/**
 * **M13 review, finding 1 — the divergence three sites papered over, pinned so it cannot be
 * re-justified by assertion.**
 *
 * `LessonOpening.issueWidth`, `lessonOpening`'s inline comment and (before the review) `App.tsx`
 * all explained a `?? 1` as "the reading the engine itself applies". Two engines read
 * `ProcessorConfig.issueWidth`, and they do not agree: the superscalar defaults an absent width to
 * 1, the out-of-order core to 2 — deliberately, at its own `private width = 2`.
 *
 * These pin the divergence itself rather than the prose about it. They are deliberately
 * BEHAVIORAL: the out-of-order micro carries no `width` field to read back, and asserting on a
 * recorded schedule is the stronger claim anyway — it is the default's EFFECT, which is what the
 * comments were making promises about.
 *
 * The reason this is a guard and not a fix: correcting either engine's default would move pinned
 * recordings across the conformance matrix and the M9/M10 lesson set, and the divergence is
 * unreachable through the product (see the third test). So the honest move is to make the two
 * numbers loud rather than to quietly pick one.
 *
 * **And these are the ONLY things in the repo that can see either number.** Measured while writing
 * them: changing the out-of-order core's `?? 2` to `?? 1` — deleting the pinned decision outright —
 * leaves **all 4400 engine tests green**, because every engine suite states `issueWidth` explicitly
 * and never exercises the absent case. A decision documented at its own declaration, on a knob two
 * models read, with no net under it anywhere below the web package. That is the real reason the
 * three comments could go on asserting the engines agreed for two milestones: nothing would have
 * contradicted them if they had been right either.
 */
describe('the two engines that read issueWidth default it differently (M13 review finding 1)', () => {
  const cyclesOf = (make: () => Processor, config: ProcessorConfig, program: string): number => {
    const example = EXAMPLE_PROGRAMS.find((p) => p.name === program);
    if (!example) throw new Error(`no such example: ${program}`);
    const r = loadSource(example.source, make, config);
    if (!r.ok) throw new Error('assembly failed');
    r.loaded.recorder.runToEnd();
    return r.loaded.recorder.recorded.length;
  };

  /** A config with `issueWidth` genuinely ABSENT — the state the two `?? N`s disagree about. */
  const absent = (): ProcessorConfig => {
    const c: ProcessorConfig = { ...defaultConfig(), forwarding: true };
    delete (c as { issueWidth?: number }).issueWidth;
    return c;
  };
  const at = (w: number): ProcessorConfig => ({ ...absent(), issueWidth: w });

  it('the superscalar reads an absent width as 1', () => {
    const make = (): Processor => new SuperscalarProcessor();
    const [w1, w2] = [cyclesOf(make, at(1), 'sum-loop'), cyclesOf(make, at(2), 'sum-loop')];
    // Non-vacuity FIRST: if the two explicit widths ran the same schedule, "absent matches 1" would
    // be satisfied by an engine that ignored the knob entirely, and this whole file would measure
    // nothing. Same failure shape as the identity toggle `simulator.test.ts` records.
    expect(w1, 'the two widths run the same schedule — the test below is vacuous').not.toBe(w2);
    expect(cyclesOf(make, absent(), 'sum-loop')).toBe(w1);
  });

  it('...and the out-of-order core reads it as 2 — the fact the shell claimed did not exist', () => {
    const make = (): Processor => new OutOfOrderProcessor();
    const [w1, w2] = [cyclesOf(make, at(1), 'array-sum'), cyclesOf(make, at(2), 'array-sum')];
    expect(w1, 'the two widths run the same schedule — the test below is vacuous').not.toBe(w2);
    expect(cyclesOf(make, absent(), 'array-sum')).toBe(w2);
  });

  it('no lesson can reach the divergence — every width-honoring lesson declares its width', () => {
    // The measurement that makes `?? 1` safe today. It is a fact about the CORPUS, so it expires
    // the moment a lesson is added; asserting it here is what turns "we checked once" into a gate.
    // Widths are read off `Lesson.config`, which is the only thing `lessonOpening` looks at.
    const WIDTH_HONORING = new Set(['superscalar', 'out-of-order']);
    const offenders = LESSONS.filter(
      (l) => WIDTH_HONORING.has(l.model) && l.config !== undefined && l.config.issueWidth === undefined, // prettier-ignore
    ).map((l) => l.id);
    expect(offenders, 'a lesson would silently take the shell default over its model’s').toEqual(
      [],
    );
    // ...and non-vacuously: there ARE such lessons to check.
    expect(LESSONS.filter((l) => WIDTH_HONORING.has(l.model)).length).toBeGreaterThan(0);
  });
});

describe('the shell holds its knobs with no field names to transpose (M14 review finding 2)', () => {
  /**
   * Eight values no two of which are equal — the whole trick, and the reason this fixture is spelled
   * out rather than borrowed from `MOVED` in `engine-config.test.ts`.
   *
   * The defect this file is here for is a TRANSPOSITION: `robSize` read off the slow-op ref,
   * `numMshrs` off the MSHR one. A fixture that gave two same-typed knobs the same value could not
   * see it — the swap would produce an identical object. So the three unconstrained numbers are 3, 4
   * and 5, all distinct, and the two booleans differ from each other.
   */
  const SENTINELS: LessonOpening = {
    modelId: 'superscalar',
    forwarding: true,
    branchPrediction: 'static-taken',
    cache: CACHE_SMALL,
    issueWidth: 3,
    outOfOrderIssue: false,
    robSize: 4,
    slowOpLatency: 5,
    numMshrs: 6,
  };

  it('the fixture really is transposition-sensitive — no two numeric knobs agree', () => {
    // The non-vacuity clause, and it comes first because the whole point of the fixture is that a
    // swap changes the answer. `forwarding`/`outOfOrderIssue` are the boolean pair and must differ
    // too, or swapping THOSE would also be invisible.
    const numbers = [SENTINELS.issueWidth, SENTINELS.robSize, SENTINELS.slowOpLatency, SENTINELS.numMshrs]; // prettier-ignore
    expect(new Set(numbers).size, 'two numeric knobs share a value — a swap would be invisible').toBe(numbers.length); // prettier-ignore
    expect(SENTINELS.forwarding, 'the two booleans agree — a swap would be invisible').not.toBe(
      SENTINELS.outOfOrderIssue,
    );
  });

  it('openingKnobs carries every knob to its OWN field, and drops only the model id', () => {
    const knobs: SessionKnobs = openingKnobs(SENTINELS);
    expect(knobs).toEqual({
      forwarding: true,
      branchPrediction: 'static-taken',
      cache: CACHE_SMALL,
      issueWidth: 3,
      outOfOrderIssue: false,
      robSize: 4,
      slowOpLatency: 5,
      numMshrs: 6,
    });
    // ...and the model id is GONE, not merely unread: `knobs` is spread into a `ProcessorConfig`, so
    // a stray `modelId` would ride into the engine's config object.
    expect(Object.keys(knobs)).not.toContain('modelId');
  });

  it('LessonOpening is exactly SessionKnobs plus modelId — the property the rest-destructure rides on', () => {
    // `openingKnobs` names no field, which is what makes a transposition impossible; the price is
    // that it is only CORRECT while the two types line up. This is that assumption, asserted: split
    // them and this reddens instead of a knob silently vanishing from every lesson opening.
    expect(Object.keys(SENTINELS).sort()).toEqual(
      ['modelId', ...Object.keys(OPENING_KNOBS)].sort(),
    );
  });

  it('OPENING_KNOBS is the machine a lesson-less shell opens on, and the reset target', () => {
    // Pinned by name rather than by shape: these eight values are what a reader sees before touching
    // anything, and `select` / `loadEdited` reset the two uncontrolled knobs to them. A drift here is
    // a different opening machine for every reader, which no test that only checks self-consistency
    // would notice.
    expect(OPENING_KNOBS).toEqual({
      forwarding: false,
      branchPrediction: defaultConfig().branchPrediction,
      cache: defaultConfig().cache,
      issueWidth: 1,
      outOfOrderIssue: false,
      robSize: 16,
      slowOpLatency: 1,
      numMshrs: 2,
    });
    // The two that are NOT `defaultConfig()`'s, and why — both are optional on `ProcessorConfig`, so
    // the default leaves them undefined and "undefined" is not a position a control can be lit in.
    expect(defaultConfig().issueWidth).toBeUndefined();
    expect(defaultConfig().outOfOrderIssue).toBeUndefined();
  });

  it('a config-less lesson keeps the six CONTROLLED knobs and resets the two that have no control', () => {
    // The round trip both shell paths now share, and the asymmetry inside it is the point: a lesson
    // declaring no config leaves the user's six controlled knobs exactly where they were, and resets
    // `slowOpLatency`/`numMshrs` to `OPENING_KNOBS` — because those two have no control, so a value a
    // previous lesson declared would have no way back. That is `lessonOpening`'s own rule; what is new
    // is that one ref makes the free-play machine and the lesson machine the same object's contents,
    // where eight refs and two copies of the literal could disagree with nothing failing.
    const lesson = { id: 'x', title: 'x', program: 'sum-loop', model: 'superscalar', steps: [] } as unknown as Lesson; // prettier-ignore
    const knobs = openingKnobs(SENTINELS);
    expect(openingKnobs(lessonOpening(lesson, knobs))).toEqual({
      ...knobs,
      slowOpLatency: OPENING_KNOBS.slowOpLatency,
      numMshrs: OPENING_KNOBS.numMshrs,
    });
    // Non-vacuity: the sentinels really did differ from the reset target, or "reset" is unmeasured.
    expect(knobs.slowOpLatency).not.toBe(OPENING_KNOBS.slowOpLatency);
    expect(knobs.numMshrs).not.toBe(OPENING_KNOBS.numMshrs);
  });
});
