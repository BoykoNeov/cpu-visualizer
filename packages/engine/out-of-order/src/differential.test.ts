import { runConformance } from '@cpu-viz/engine-conformance';
import { defaultConfig, type CacheConfig, type ProcessorConfig } from '@cpu-viz/trace';
import { CACHE_LARGE, CACHE_SMALL, MAX_ISSUE_WIDTH } from '@cpu-viz/engine-common';
import { describe, expect, it } from 'vitest';
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
/**
 * ⚠ **The two dynamic schemes joined at the dynamic-branch-prediction plan's step 5, and green
 * cells here are NOT evidence this model honors them.** Speculation is architecturally invisible by
 * construction, so a machine that ignored `'dynamic-1bit'` entirely passes every cell — measured on
 * the 5-stage at step 3, where the knob was left unhonored on purpose and all 50 cells stayed green.
 * `m7-superscalar-engine` records INV-8 as a FALSE net outright. What the extra columns buy is
 * coverage of paths the static schemes never take: a dynamic scheme mispredicts in BOTH directions
 * on the same branch within one run, which on THIS model means the squash/restore machinery —
 * `flushAfter`, the rename replay, the deferred-broadcast filter — runs on interleavings the static
 * schemes never produce. That is where a speculation LEAK would hide, and it is the reason to widen
 * a matrix that cannot answer the honoring question at all.
 */
const SCHEMES = [
  'none',
  'static-not-taken',
  'static-taken',
  'dynamic-1bit',
  'dynamic-2bit',
] as const;
const CACHES: (CacheConfig | null)[] = [null, CACHE_SMALL, CACHE_LARGE];

/**
 * **DERIVED from `MAX_ISSUE_WIDTH`, not typed `[1, 2, 3, 4]`** — M13 step 6 widened this from
 * `[1, 2]`, and the derivation is what step 1 established on the superscalar: raising the engine's
 * bound must not be able to leave the widest machine the least tested, in silence. The completeness
 * assertion below is the guard on the derivation itself.
 *
 * **Step 4 deliberately left this at `[1, 2]`** and handed the widening here, because it follows
 * the BOUND decision rather than preceding it — and the bound is what step 6 pinned (this model is
 * capped at `MAX_ISSUE_WIDTH` too, rather than the shared UI control being gated per model).
 *
 * ## What these 396 new cells buy, said honestly
 *
 * **Nearly nothing on their own, and the milestone's own log says why in capitals: INV-8 is a FALSE
 * NET on a machine that commits in order.** Final architectural state is width-invariant here by
 * construction, so this matrix would pass with the scheduler completely wrong — that is the M7 step
 * 2b trap, which ran green through a matrix this exact shape. `timing.test.ts`'s widened transplant
 * is the net; this is the smoke test.
 *
 * They are not worthless, and the exception is the one this file's header already names: **memory
 * disambiguation**. A load that bypasses an aliasing older store DOES corrupt architectural state,
 * and widths 3/4 put more independent work in flight for it to bypass — which is the one bug class
 * where extra width buys extra teeth rather than extra green.
 *
 * Their other honest value is that they were CHEAP and they were run BEFORE the guard opened: step
 * 6's dump swept exactly these cells (plus a 3000-cycle liveness bound) and reported 792/792
 * terminating and reference-equal, so this suite is holding a measurement that already existed
 * rather than making a prediction. **Say which of your green checks was cheap** — this one was.
 */
const WIDTHS: readonly number[] = Array.from({ length: MAX_ISSUE_WIDTH }, (_, i) => i + 1);
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

/**
 * The COMPLETENESS half of the width claim, in this model's own file (M13 step 6).
 *
 * The split is step 4's, and the reason it survives the constant's move is worth stating: the
 * harness (`engine-conformance`) owns the SHAPE claim — N distinct widths produce N distinct
 * `it()` titles — and it must stay model-agnostic, so it cannot know what any one model's bound
 * is. **That used to be enforced by a package cycle** (importing `MAX_ISSUE_WIDTH` from the
 * superscalar into the harness inverted the graph); after step 6 moved the constant into
 * `engine-common`, which the harness already imports from, only judgement enforces it. Recorded
 * here and in `engine-common/src/issue-width.ts` rather than left to be rediscovered.
 *
 * What would falsify this: someone raising `MAX_ISSUE_WIDTH` to 5 and leaving `WIDTHS` behind — the
 * matrix would silently stop reaching the widest machine the guard admits, which is exactly the
 * decay mode the derivation above exists to prevent.
 *
 * **Watched, and the measurement is the argument.** Hard-coding `WIDTHS` back to `[1, 2]` takes the
 * file from 807 cells to 411 — **396 conformance cells simply STOP EXISTING** — and the only two
 * that go RED are the two here. All 409 others pass. That is what "a narrower matrix is invisible
 * to the matrix itself" looks like when you build it: a suite cannot notice the cases it no longer
 * enumerates, so the guard has to live outside the enumeration.
 */
describe('the matrix reaches every width the guard admits (M13 step 6)', () => {
  it('sweeps 1..MAX_ISSUE_WIDTH with no gaps', () => {
    expect([...WIDTHS]).toEqual(Array.from({ length: MAX_ISSUE_WIDTH }, (_, i) => i + 1));
  });

  it('crosses width against every other axis, so widening cannot narrow the product', () => {
    // ORDERS × WIDTHS × SCHEMES × CACHES — stated as a product rather than a literal count so
    // raising any single axis is caught here rather than in a stale number.
    expect(CONFIGS).toHaveLength(ORDERS.length * MAX_ISSUE_WIDTH * SCHEMES.length * CACHES.length);
  });
});

runConformance('out-of-order', () => new OutOfOrderProcessor(), [...CONFIGS, ROB_SIZE_PROBE]);
