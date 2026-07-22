import { runConformance } from '@cpu-viz/engine-conformance';
import { defaultConfig, type CacheConfig, type ProcessorConfig } from '@cpu-viz/trace';
import { CACHE_LARGE, CACHE_SMALL } from '@cpu-viz/engine-common';
import { OutOfOrderProcessor } from './index';

/**
 * INV-8 for the out-of-order model, step 2 — now stated at BOTH issue-order positions
 * (`outOfOrderIssue: false` is step 1a's already-proven floor; `true` is new here).
 *
 * **Read this as a smoke test with one real exception, not as the timing net** (`docs/plans/m9-
 * tasks.md`'s "how this milestone can lie to itself" says so explicitly). In-order commit means
 * final architectural state is deterministic regardless of issue order, so this suite would pass
 * with the SCHEDULER completely wrong — it proves the ISA semantics were copied faithfully (a
 * dropped `>>> 0`, a mis-signed extend) and that reordering/speculation/flush-recovery did not
 * CORRUPT the machine, and nothing about whether the timing is right (step 3's job, and there is no
 * closed form for it).
 *
 * **The one real exception: memory disambiguation.** A load that bypasses an aliasing older store
 * DOES corrupt architectural state, so a differential run genuinely catches that bug class — see
 * `disambiguation-mutation.test.ts` for the proof that the teeth are real (a disambiguation-
 * disabled variant of this model is run through this same reference comparison and shown to
 * diverge). It is a separate file, not a case appended here, because exposing the bug needs a
 * program `checkProgram`'s shared corpus does not have — `store-forward.s` (authored for exactly
 * this bug class at step 1b) turns out NOT to expose it under this engine's structural properties
 * (checked empirically: its adjacent store/load share the single memory port, so oldest-first issue
 * plus matched per-request miss costs on the same line keep the store's deferred write ahead of the
 * load's read even with disambiguation fully disabled). What the shared corpus's `store-forward.s`
 * DOES pin, and what this suite exercises over the full matrix, is the OTHER step-1b mechanism: the
 * store write deferred to commit rather than issued at MEM access.
 *
 * `issueWidth` and `outOfOrderIssue` are BOTH stated explicitly at every position for the same
 * reason the superscalar's suite states width: an axis under test must not be reached by omission,
 * and `outOfOrderIssue` shares width's "invisible collision" risk — both positions are green by
 * construction, so nothing but the title itself would ever surface a matrix that silently stopped
 * varying it.
 */
const SCHEMES = ['none', 'static-not-taken', 'static-taken'] as const;
const CACHES: (CacheConfig | null)[] = [null, CACHE_SMALL, CACHE_LARGE];
const WIDTHS = [1, 2] as const;
const ORDERS = [false, true] as const;

const CONFIGS: ProcessorConfig[] = ORDERS.flatMap((outOfOrderIssue) =>
  WIDTHS.flatMap((issueWidth) =>
    SCHEMES.flatMap((branchPrediction) =>
      CACHES.map((cache) => ({
        ...defaultConfig(),
        forwarding: true,
        branchPrediction,
        cache,
        issueWidth,
        outOfOrderIssue,
      })),
    ),
  ),
);

/**
 * ROB size is deliberately NOT a full cross-product axis (unlike the four above) — the plan's own
 * "timing-blind" framing means it buys near-zero marginal teeth: `robSize` changes only WHEN
 * dispatch stalls, and in-order commit preserves final state at any depth for a correct machine, so
 * crossing it against everything else would double the matrix for no new coverage. The one thing a
 * SMALL ROB exercises that the default (16) never does: `disambiguationClear`'s "the aliasing older
 * store already committed and left the ROB" branch (the load falls through the loop and reads
 * ordinary memory, correct because the store already wrote it) — `robSize: 16` never forces that
 * store out of the ROB before `store-forward.s`'s dependent load even dispatches, `robSize: 1` does
 * (checked in a cycle dump: the store retires the SAME cycle the load dispatches, one cycle before
 * disambiguation would otherwise be structurally moot). One targeted config, not a fifth axis.
 */
const ROB_SIZE_PROBE: ProcessorConfig = {
  ...defaultConfig(),
  forwarding: true,
  branchPrediction: 'none',
  cache: CACHE_SMALL,
  issueWidth: 2,
  outOfOrderIssue: true,
  robSize: 1,
};

runConformance('out-of-order', () => new OutOfOrderProcessor(), [...CONFIGS, ROB_SIZE_PROBE]);
