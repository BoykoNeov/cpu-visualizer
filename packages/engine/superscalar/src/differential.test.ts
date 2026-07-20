import { runConformance } from '@cpu-viz/engine-conformance';
import { defaultConfig, type CacheConfig, type ProcessorConfig } from '@cpu-viz/trace';
import { CACHE_LARGE, CACHE_SMALL } from '@cpu-viz/engine-common';
import { SuperscalarProcessor } from './index';

/**
 * INV-8 for the superscalar at BOTH WIDTHS: final architectural state ≡ the golden reference on
 * every example program, under the full width × forwarding × prediction × cache cross product —
 * the pipeline's matrix with a width axis on top, because at width 1 this is meant to BE that
 * machine and at width 2 it must reach the same answers by a different route.
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
 * The width-2 column is weaker still, and its weakness is structural rather than incidental: width
 * changes only WHEN things happen, so identical final state at both widths is what the design
 * PREDICTS, not evidence it works. Step 2b's genuinely-out-of-order retirement bug — a cache miss
 * in `MEM.0` letting its `MEM.1` mate retire ahead of it — ran green through a matrix exactly this
 * shape; it took a retire-ID-monotonicity assertion to see it. So what width 2 buys here is one
 * thing only: proof that pairing does not CORRUPT the machine. That the answers are right is not in
 * question at either width; whether the cycle counts are is step 4's problem, and step 4 is the
 * real net.
 *
 * The width-1 column is the stronger half and keeps its own job: `timing.test.ts` asserts the
 * pipeline's own pinned cycle counts against this engine, so a faithful port must reproduce them to
 * the cycle.
 */
const SCHEMES = ['none', 'static-not-taken', 'static-taken'] as const;
const CACHES: (CacheConfig | null)[] = [null, CACHE_SMALL, CACHE_LARGE];

/**
 * Both widths are stated EXPLICITLY rather than either being left to the default. Width is the axis
 * this model exists for, and a matrix that reached a position only by omission would silently stop
 * testing it the day the default changed.
 *
 * The width axis is why `configLabel` learned `issueWidth` in this step. Every prior axis had a
 * failing column available to force someone to read the titles; this one does not, since both
 * widths are green by construction. Dropping width from the label leaves 2×3×3 = 18 distinct
 * forwarding/predict/cache names for 36 configs — every one shared by a width-1 and a width-2 case,
 * all passing, with nothing to prompt a second look. So the label gained the axis and
 * `conformance.test.ts` gained a guard in both directions.
 */
const WIDTHS = [1, 2] as const;

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

runConformance('superscalar', () => new SuperscalarProcessor(), CONFIGS);
