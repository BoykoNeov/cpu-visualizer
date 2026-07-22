import { runConformance } from '@cpu-viz/engine-conformance';
import { defaultConfig, type CacheConfig, type ProcessorConfig } from '@cpu-viz/trace';
import { CACHE_LARGE, CACHE_SMALL } from '@cpu-viz/engine-common';
import { OutOfOrderProcessor } from './index';

/**
 * INV-8 for the in-order-issue base (step 1a) — the floor the plan itself calls "weak, but a
 * floor": in-order commit means final architectural state is deterministic here even with the
 * scheduler completely wrong, so this suite proves the ISA semantics were copied faithfully (a
 * dropped `>>> 0`, a mis-signed extend) and nothing more. Real teeth — catching a memory-
 * disambiguation bug — arrive at step 2 once the non-blocking LSU exists to have one.
 *
 * `issueWidth` is stated explicitly at both 1 and 2 for the same reason the superscalar's suite
 * states it: the axis under test must not be reached by omission.
 */
const SCHEMES = ['none', 'static-not-taken', 'static-taken'] as const;
const CACHES: (CacheConfig | null)[] = [null, CACHE_SMALL, CACHE_LARGE];
const WIDTHS = [1, 2] as const;

const CONFIGS: ProcessorConfig[] = WIDTHS.flatMap((issueWidth) =>
  SCHEMES.flatMap((branchPrediction) =>
    CACHES.map((cache) => ({
      ...defaultConfig(),
      forwarding: true,
      branchPrediction,
      cache,
      issueWidth,
    })),
  ),
);

runConformance('out-of-order (step 1a, in-order issue)', () => new OutOfOrderProcessor(), CONFIGS);
