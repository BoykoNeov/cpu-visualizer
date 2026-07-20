import { runConformance } from '@cpu-viz/engine-conformance';
import { defaultConfig, type CacheConfig, type ProcessorConfig } from '@cpu-viz/trace';
import { CACHE_LARGE, CACHE_SMALL } from '@cpu-viz/engine-common';
import { SuperscalarProcessor } from './index';

/**
 * INV-8 for the superscalar at WIDTH 1: final architectural state ≡ the golden reference on every
 * example program, under the full forwarding × prediction × cache cross product — exactly the
 * matrix the pipeline runs, because at width 1 this is meant to BE that machine.
 *
 * **Read this as a smoke test, not as the net.** The plan says so up front, and it is worth
 * restating where the assertions live: in-order superscalar retires in order, so final state is
 * deterministic and this suite would pass with the timing completely wrong — it would pass with
 * pairing logic that never pairs, or that pairs everything. What it CAN catch is the one bug class
 * that would otherwise be invisible: a mis-copied ISA idiom. The ISA semantics in `processor.ts`
 * are mirrored from the golden reference and deliberately NOT imported from it (models import no
 * sibling model, and INV-8's whole design is that the differential PROVES the copy faithful). A
 * dropped `>>> 0`, a `>>` where the reference has `>>>`, a missing `imm & 0x1f` — those are caught
 * here and nowhere else.
 *
 * The real net for step 2a is `timing.test.ts`, which asserts the pipeline's own pinned cycle
 * counts against this engine: a faithful port must reproduce them to the cycle.
 */
const SCHEMES = ['none', 'static-not-taken', 'static-taken'] as const;
const CACHES: (CacheConfig | null)[] = [null, CACHE_SMALL, CACHE_LARGE];

/**
 * `issueWidth: 1` is stated EXPLICITLY rather than left to the default. It is the axis this model
 * exists for, and a matrix that reached width 1 only by omission would silently stop testing it the
 * day the default changed. Step 3 adds the width-2 column here; until step 2b it would throw.
 */
const CONFIGS: ProcessorConfig[] = [false, true].flatMap((forwarding) =>
  SCHEMES.flatMap((branchPrediction) =>
    CACHES.map((cache) => ({
      ...defaultConfig(),
      forwarding,
      branchPrediction,
      cache,
      issueWidth: 1,
    })),
  ),
);

runConformance('superscalar [width 1]', () => new SuperscalarProcessor(), CONFIGS);
