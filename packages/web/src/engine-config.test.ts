/**
 * **The shell→engine seam — M13 review, finding 5.**
 *
 * This file exists because of where a piece of code used to live rather than because of anything it
 * did. `useSimulator.loadInto` built the engine's {@link ProcessorConfig} from an eight-field object
 * literal **inside a `useCallback`**, and a hook body cannot be invoked without jsdom, which this
 * repo deliberately does not have. So the one line where every session knob crosses into the engine
 * was unreachable from every headless test in the repo — not under-tested, *unreachable*.
 *
 * Three milestones each discovered that independently and each answered it with a browser pass:
 *
 * | milestone   | provocation                                    | web tests still green |
 * | ----------- | ---------------------------------------------- | --------------------- |
 * | M7 step 6   | delete `issueWidth` from the literal            | 581                   |
 * | M11 step 5  | delete `branchPrediction` from the literal      | 229                   |
 * | M13 step 6  | clamp `issueWidth` to `min(w, 2)` in the literal | 1518                 |
 *
 * The last one is the sharpest, and it is why this stopped being a curiosity: a clamp is CORRECT at
 * widths 1 and 2 and silently collapses 3 and 4. A control that is right where the reader checks it
 * and wrong at the end is not something an eyeball reliably catches either.
 *
 * **Five of the eight knobs are optional on `ProcessorConfig`** (`issueWidth`, `outOfOrderIssue`,
 * `robSize`, `slowOpLatency`, and `cache`'s absence), so dropping one is not even a type error —
 * only `forwarding`, `branchPrediction` and `cache` redden `tsc`. That asymmetry is exactly why the
 * hole was worst for the knobs the last three milestones added.
 *
 * The fix was to move the expression, not to write a cleverer test: {@link engineConfigOf} is a pure
 * function of {@link SessionKnobs}, so the seam is now ordinary code that ordinary tests can call.
 * What is left for the browser is the half that is genuinely React — that the CONTROL writes the ref
 * — and that is a much smaller claim than "does any of this reach the engine at all".
 */

import { defaultConfig, type ProcessorConfig } from '@cpu-viz/trace';
import { CACHE_LARGE, CACHE_SMALL } from '@cpu-viz/engine-common';
import { describe, expect, it } from 'vitest';
import { MODELS, engineConfigOf, modelById } from './models';
import type { SessionKnobs } from './session';

/**
 * A session position with every knob moved OFF its default, which is the whole trick: a config
 * builder that silently dropped a knob would return the default for it, so a fixture that shared any
 * value with `defaultConfig()` could not tell "carried" from "lost" on that field.
 *
 * Each value is checked against the default below rather than chosen by eye — the fixture's own
 * correctness is the thing this file most depends on, and "I picked something different" is exactly
 * the kind of claim that rots when a default moves.
 */
const MOVED: SessionKnobs = {
  forwarding: true,
  branchPrediction: 'static-taken',
  cache: CACHE_LARGE,
  issueWidth: 3,
  outOfOrderIssue: true,
  robSize: 4,
  slowOpLatency: 7,
  numMshrs: 5,
};

/** Every knob, by name — the enumeration the test is FOR. A knob added to `SessionKnobs` and not to
 *  this list would leave the new field unswept, so the exhaustiveness check below is what keeps this
 *  list honest rather than decorative. */
const KNOBS = [
  'forwarding',
  'branchPrediction',
  'cache',
  'issueWidth',
  'outOfOrderIssue',
  'robSize',
  'slowOpLatency',
  'numMshrs',
] as const satisfies readonly (keyof SessionKnobs)[];

describe('every session knob reaches the engine config, by name', () => {
  it('the fixture actually moves every knob off its default — else this file measures nothing', () => {
    // The non-vacuity clause, and it comes first because everything below rides on it. `issueWidth`,
    // `outOfOrderIssue`, `robSize`, `slowOpLatency` and `numMshrs` are all absent from
    // `defaultConfig()` (they are optional), so for those "different from the default" means
    // "defined at all" — which is still exactly the distinction a dropped field would collapse.
    const base = defaultConfig();
    for (const knob of KNOBS) {
      expect(MOVED[knob], `${knob} is at its default — a dropped ${knob} would look carried`).not.toEqual(base[knob]); // prettier-ignore
    }
  });

  it('KNOBS is exhaustive over SessionKnobs — a ninth knob cannot ride in unswept', () => {
    // `MOVED` is typed `SessionKnobs`, so its keys ARE the interface's keys. Comparing the swept
    // list against them is what turns "we listed eight things" into "we listed all of them".
    expect([...KNOBS].sort()).toEqual(Object.keys(MOVED).sort());
  });

  /**
   * The claim itself, asked of the model that honors the most: the out-of-order core reads all eight.
   *
   * Asked per knob rather than with one `toEqual` on the whole object, deliberately. A whole-object
   * comparison reddens once with a diff a reader has to scan; this names the lost knob in the failure
   * message, which is the difference between "the config is wrong" and "`numMshrs` did not arrive".
   */
  it('a model that honors a knob is handed the session value, not the default', () => {
    const cfg = engineConfigOf(modelById('out-of-order'), MOVED);
    for (const knob of KNOBS) {
      expect(cfg[knob], `${knob} did not reach the engine config`).toEqual(MOVED[knob]);
    }
  });

  it('...and the fields no control owns still come from defaultConfig()', () => {
    // The other half of `engineConfigOf`'s two steps. `seed` has no shell control, so it must arrive
    // from the spread rather than be dropped — an engine handed a config with no `seed` is a
    // different machine from one handed the default (INV-1's determinism rides on it).
    const cfg = engineConfigOf(modelById('out-of-order'), MOVED);
    expect(cfg.seed).toEqual(defaultConfig().seed);
  });
});

describe('the model narrowing, which is the one thing the seam is allowed to change', () => {
  it('a model that refuses a cache is handed null, whatever the session holds', () => {
    // M11 step 5's clamp, now reachable from a test. The five-stage pipeline has no D-cache before
    // M6's models; `configurableCache` is the flag that says so.
    for (const model of MODELS) {
      const cfg = engineConfigOf(model, { ...MOVED, cache: CACHE_SMALL });
      if (model.capabilities.configurableCache) {
        expect(cfg.cache, `${model.id} should keep the session cache`).toEqual(CACHE_SMALL);
      } else {
        expect(cfg.cache, `${model.id} refuses a cache and must be handed null`).toBeNull();
      }
    }
  });

  it('non-vacuously — the corpus of models really does contain both kinds', () => {
    // Without this the sweep above passes on a MODELS list that is all one kind, which is the shape
    // of vacuity this repo has shipped twice. Stated as both halves, so losing either is red.
    const refusing = MODELS.filter((m) => !m.capabilities.configurableCache);
    const accepting = MODELS.filter((m) => m.capabilities.configurableCache);
    expect(refusing.length, 'no model refuses a cache — the clamp is untested').toBeGreaterThan(0);
    expect(accepting.length, 'no model accepts a cache — the pass-through is untested').toBeGreaterThan(0); // prettier-ignore
  });

  /**
   * **The width clamp — M15 step 5, and the model that forced it is the scoreboard.** Its `reset()`
   * throws on any `issueWidth` other than 1, so this is the M11 crash reproduced on a second knob:
   * the width toggle renders only where `configurableIssueWidth` is true, so a reader can set the
   * superscalar to 4-wide, pick Scoreboard, and land on a model whose control for that knob is no
   * longer on screen to unset.
   *
   * The predicate is the capability FLAG rather than the model id, which means the clamp also
   * reaches the four models that merely IGNORE a width. That is safe only because they cannot see
   * the value — re-measured at M15 rather than inherited from M13: `pipeline`, `deep-pipeline`,
   * `single-cycle` and `multi-cycle` do not mention `issueWidth` anywhere in their `processor.ts`.
   * ⚠ **A green suite is not that warrant** — the timing suites drive engines directly and never
   * cross this seam, so they stay green either way.
   */
  it('a model that does not honor a width is handed 1, whatever the session holds', () => {
    for (const model of MODELS) {
      const cfg = engineConfigOf(model, MOVED);
      if (model.capabilities.configurableIssueWidth) {
        expect(cfg.issueWidth, `${model.id} should keep the session width`).toBe(MOVED.issueWidth);
      } else {
        expect(cfg.issueWidth, `${model.id} does not honor a width and must be handed 1`).toBe(1);
      }
    }
  });

  it('non-vacuously — the corpus of models really does contain both kinds of width model', () => {
    // The same both-halves guard the cache sweep above carries, for the same reason: without it the
    // sweep passes on a MODELS list that is all one kind.
    const blind = MODELS.filter((m) => !m.capabilities.configurableIssueWidth);
    const honoring = MODELS.filter((m) => m.capabilities.configurableIssueWidth);
    expect(blind.length, 'no model refuses a width — the clamp is untested').toBeGreaterThan(0);
    expect(honoring.length, 'no model honors a width — the pass-through is untested').toBeGreaterThan(0); // prettier-ignore
  });

  it('narrowing NEVER touches a knob other than the cache and the width', () => {
    // The clamp's scope, pinned. `engineConfigFor` is the one place the shell is allowed to overrule
    // the user, and it is allowed to do it to exactly two fields — `models.ts` says so in prose and
    // this is that sentence as arithmetic. A future clamp added there has to come here and say which
    // knob it moved.
    //
    // ⚠ **The `issueWidth` skip is CONDITIONAL on the flag, and a blanket `continue` would delete a
    // net.** Skipping the field outright would permit a width clamp on the superscalar and the
    // out-of-order core — which is verbatim the M13 step 6 defect (`min(width, 2)`: correct at 1 and
    // 2, silently collapsing 3 and 4) one layer above where that milestone fixed it. The positive
    // half of that claim lives in the test directly above, and the sweep over every width the
    // control offers lives at the bottom of this file.
    for (const model of MODELS) {
      const cfg = engineConfigOf(model, MOVED);
      for (const knob of KNOBS) {
        if (knob === 'cache') continue;
        if (knob === 'issueWidth' && !model.capabilities.configurableIssueWidth) continue;
        expect(cfg[knob], `${model.id} altered ${knob}`).toEqual(MOVED[knob]);
      }
    }
  });
});

describe('the seam carries a width the engine will actually run at', () => {
  /**
   * The M13 step 6 provocation, turned into a standing net: this is the assertion that reddens on
   * `min(width, 2)`, the half-dead toggle that was correct at widths 1 and 2 and collapsed 3 and 4.
   *
   * It sweeps every width the control offers rather than checking one, because that clamp is
   * INVISIBLE at the positions a reader checks first — which is the whole reason it survived to be
   * handed to a browser pass.
   */
  it('every width the control offers arrives intact — the half-dead-toggle net', () => {
    const model = modelById('superscalar');
    for (const issueWidth of [1, 2, 3, 4]) {
      const cfg: ProcessorConfig = engineConfigOf(model, { ...MOVED, issueWidth });
      expect(cfg.issueWidth, `width ${issueWidth} did not survive the seam`).toBe(issueWidth);
    }
  });
});
