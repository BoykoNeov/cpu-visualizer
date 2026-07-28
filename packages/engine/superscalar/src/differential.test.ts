import { describe, expect, it } from 'vitest';
import { runConformance } from '@cpu-viz/engine-conformance';
import { defaultConfig, type CacheConfig, type ProcessorConfig } from '@cpu-viz/trace';
import { CACHE_LARGE, CACHE_SMALL } from '@cpu-viz/engine-common';
import { MAX_ISSUE_WIDTH, SuperscalarProcessor } from './index';

/**
 * INV-8 for the superscalar at EVERY WIDTH THE GUARD ADMITS: final architectural state ≡ the golden
 * reference on every example program, under the full width × forwarding × prediction × cache cross
 * product — the pipeline's matrix with a width axis on top, because at width 1 this is meant to BE
 * that machine and at every width above it must reach the same answers by a different route.
 *
 * **Read this as a smoke test, not as the net, and read the width columns as less than that.** The
 * plan says so up front, and it is worth restating where the assertions live: in-order superscalar
 * retires in order, so final state is deterministic and this suite would pass with the timing
 * completely wrong — it would pass with pairing logic that never pairs, or that pairs everything.
 * What it CAN catch is the one bug class that would otherwise be invisible: a mis-copied ISA idiom.
 * The ISA semantics in `processor.ts` are mirrored from the golden reference and deliberately NOT
 * imported from it (models import no sibling model, and INV-8's whole design is that the
 * differential PROVES the copy faithful). A dropped `>>> 0`, a `>>` where the reference has `>>>`,
 * a missing `imm & 0x1f` — those are caught here and nowhere else.
 *
 * Every column above width 1 is weaker still, and the weakness is structural rather than
 * incidental: width changes only WHEN things happen, so identical final state at every width is
 * what the design PREDICTS, not evidence it works. M7 step 2b's genuinely-out-of-order retirement
 * bug — a cache miss in `MEM.0` letting its `MEM.1` mate retire ahead of it — ran green through a
 * matrix exactly this shape; it took a retire-ID-monotonicity assertion to see it. So what the wide
 * columns buy here is one thing only: proof that grouping does not CORRUPT the machine. That the
 * answers are right is not in question at any width; whether the cycle counts are is `timing.test.ts`'s
 * problem, and that is the real net.
 *
 * **What M13 step 4 added, stated for what it is worth.** Widths 3 and 4 join the cross product, so
 * the matrix goes 36 → 72 configs. The step-0 dump had already MEASURED final-state agreement at
 * those widths, but measuring it in a temp script and holding it in a suite are different things,
 * and nothing in the repo held it. These columns are worth two things and no more: that pin, and a
 * second bounded-liveness sweep over the corpus at the widths `a9f1b70` made safe (`checkProgram`
 * caps at 100 000 steps and throws, where a bare `while (!isHalted())` would hang). They buy
 * NOTHING on the mis-copied-ISA-idiom class the width-1 column is here for — that bug is
 * width-invariant, so it is already caught, and 396 more green cells do not catch it harder.
 *
 * The width-1 column is the stronger half and keeps its own job: `timing.test.ts` asserts the
 * pipeline's own pinned cycle counts against this engine, so a faithful port must reproduce them to
 * the cycle.
 */
const SCHEMES = ['none', 'static-not-taken', 'static-taken'] as const;
const CACHES: (CacheConfig | null)[] = [null, CACHE_SMALL, CACHE_LARGE];

/**
 * Every width is stated EXPLICITLY rather than any being left to the default. Width is the axis this
 * model exists for, and a matrix that reached a position only by omission would silently stop
 * testing it the day the default changed.
 *
 * The width axis is why `configLabel` learned `issueWidth` (M7 step 3). Every prior axis had a
 * failing column available to force someone to read the titles; this one does not, since every width
 * is green by construction. Dropping width from the label leaves 2×3×3 = 18 distinct
 * forwarding/predict/cache names for all 72 configs — each shared by four cases, one per width, all
 * passing, with nothing to prompt a second look. So the label gained the axis and
 * `conformance.test.ts` gained a guard in both directions.
 *
 * **DERIVED from `MAX_ISSUE_WIDTH`, not typed `[1, 2, 3, 4]`** — step 1's `halt-shadow.test.ts`
 * precedent and step 3's `WIDE_WIDTHS` one. Raising the engine's bound must not be able to leave the
 * widest machine the least tested, and a typed literal makes that failure silent: the suite stays
 * green, just narrower than the guard it is meant to cover.
 */
const WIDTHS: readonly number[] = Array.from({ length: MAX_ISSUE_WIDTH }, (_, i) => i + 1);

const CONFIGS: ProcessorConfig[] = WIDTHS.flatMap((issueWidth) =>
  [false, true].flatMap((forwarding) =>
    SCHEMES.flatMap((branchPrediction) =>
      CACHES.map((cache) => ({
        ...defaultConfig(),
        forwarding,
        branchPrediction,
        cache,
        issueWidth,
      })),
    ),
  ),
);

/**
 * The completeness guard for the derivation above (M13 step 4). `runConformance` registers one
 * `it()` per (config, program) and asserts the matrix is non-empty — but "non-empty" is a long way
 * from "reaches every width the engine admits", and the difference is invisible in a report where
 * every cell is green whatever the widths were.
 *
 * This is the half of the width claim that CANNOT live in `conformance.test.ts`: that package is
 * model-agnostic by eslint rule and sits below every model in the DAG, so it cannot import
 * `MAX_ISSUE_WIDTH` without inverting the graph. It owns the shape claim (N distinct widths ⇒ N
 * distinct labels); this file owns the completeness one, because only here is the constant legal.
 */
describe('the width axis covers every width the engine admits', () => {
  it('sweeps 1..MAX_ISSUE_WIDTH with no gaps, so raising the bound cannot silently narrow the matrix', () => {
    expect([...WIDTHS]).toEqual(Array.from({ length: MAX_ISSUE_WIDTH }, (_, i) => i + 1));
    // Stated separately from the equality above so a broken derivation names WHICH end it lost —
    // an off-by-one that drops width 1 and one that drops MAX read alike in a set comparison.
    expect(Math.min(...WIDTHS)).toBe(1);
    expect(Math.max(...WIDTHS)).toBe(MAX_ISSUE_WIDTH);
  });

  it('crosses the width axis against every other axis, not just the widest or the narrowest', () => {
    expect(CONFIGS).toHaveLength(MAX_ISSUE_WIDTH * 2 * SCHEMES.length * CACHES.length);
    // The cross-product claim the length alone cannot make: each width appears under the SAME
    // number of other-axis positions. A matrix that widened only its forwarding-on half would have
    // the right total for the wrong reason.
    for (const w of WIDTHS) {
      expect(CONFIGS.filter((c) => c.issueWidth === w)).toHaveLength(
        2 * SCHEMES.length * CACHES.length,
      );
    }
  });

  /**
   * And the engine's own agreement, so the bound this file derives from is the bound that is
   * ENFORCED rather than merely exported. `reset` throws outside `1..MAX_ISSUE_WIDTH`
   * (`processor.ts`'s capacity guard), which is what makes a matrix past the bound an authoring
   * error rather than an untested column. Watched failing by moving the guard's bound to
   * `MAX_ISSUE_WIDTH - 1` while the constant stayed 4 — the one edit that can separate them.
   */
  it('hands the engine only widths it accepts', () => {
    const empty = {
      words: new Uint32Array(0),
      data: [],
      entry: 0,
      sourceMap: new Map<number, number>(),
    };
    for (const config of CONFIGS) {
      expect(() => new SuperscalarProcessor().reset(empty, config)).not.toThrow();
    }
  });
});

runConformance('superscalar', () => new SuperscalarProcessor(), CONFIGS);
