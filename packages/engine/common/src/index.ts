/**
 * `@cpu-viz/engine-common` — helpers shared by every microarchitecture in the engine layer.
 * A leaf beneath the engines in the DAG (`engine-common ← isa, assembler, trace`): the models
 * depend on it, never the reverse. Keep it framework-agnostic and free of any per-model state.
 */

export { toProgramImage } from './program-image';

/**
 * The shared issue-width bound — **moved down here from `engine-superscalar` at M13 step 6**,
 * unchanged in value, for exactly the reason `predict.ts` and `cache.ts` moved down at M7 step 0:
 * a SECOND model needs it, and the models in this repo import no sibling model. See its own
 * docblock for the decision it implements and the one eslint boundary the move relaxed.
 */
export { MAX_ISSUE_WIDTH } from './issue-width';

/**
 * Branch prediction's ID-stage half and the D-cache timing shadow — **moved down here from
 * `engine-pipeline` at M7 step 0**, unchanged in behaviour.
 *
 * They were always model-independent: `predict.ts` is a pure function of `(decode, pc)` and
 * `cache.ts` a pure function of `(config, addr)` plus a tag array it owns. Neither knows what a
 * stage is, which is why neither had to change to move. They lived in the pipeline package only
 * because the pipeline was the sole model with speculation or a cache.
 *
 * M7 (in-order superscalar) makes that accidental. A second model needs both, and this repo's
 * four models import **no sibling model** — they share exactly this package — so the choice was
 * "duplicate ~300 lines" or "move them down". Moving down keeps one definition of what a hit is
 * and what a predictable transfer is, which matters more than usual here: M7's timing matrices
 * are compared against M3's, and two drifting copies of `access()` would make that comparison
 * quietly meaningless.
 *
 * **What deliberately did NOT move: the forwarding and hazard logic.** It is shaped like the
 * stage walk that hosts it (see `engine-pipeline`'s `CycleCtx`), and the superscalar walk is a
 * different shape — sharing it would mean parameterizing a thing whose whole content is the
 * assumption being broken. It forks instead, on purpose.
 *
 * The MUTATING cache surface (`access`, `newCache`) is exported here because models need it;
 * `engine-pipeline` continues to re-export only the READ surface to consumers above it, so the
 * web's "render a cache, never drive one" boundary (M6 step 6) is unchanged.
 */
export { speculativeTarget, isPredictable } from './predict';

export {
  type CacheLine,
  type CacheState,
  type CacheAccess,
  newCache,
  access,
  lineIndex,
  lineTag,
  blockBase,
  blockBaseOf,
  directMapped,
  LINE_SIZE_BYTES,
  CACHE_SMALL,
  CACHE_LARGE,
} from './cache';

/**
 * The branch history table — its shape and geometry (dynamic-branch-prediction step 1) and the
 * stateful `BranchPredictor` the four models will drive (step 2). **Nothing constructs one yet**;
 * step 3 wires the pipeline and step 5 the other three.
 *
 * **Exported from here and NOT re-exported through the four model packages, unlike `CacheState`,**
 * and the asymmetry is history rather than a boundary change. `cache.ts` lived in `engine-pipeline`
 * first, so when it moved down at M7 step 0 the pipeline kept re-exporting its READ surface to
 * spare ten `web` files an import churn. This surface is new, `web` already imports from
 * `@cpu-viz/engine-common` directly (`MAX_ISSUE_WIDTH`, `CACHE_SMALL`/`CACHE_LARGE`,
 * `toProgramImage`) and eslint's DAG allows that edge, so four re-exports would buy nothing and add
 * four places for the name to drift.
 *
 * The read/drive boundary the cache re-export protects is preserved the way `access`/`newCache`
 * already are: the MUTATING surface — `BranchPredictor`, whose `update()` trains a table — leaves
 * this package because the models need it, and stops there. It is never re-exported upward, so the
 * web's "render a table, never drive one" boundary (M6 step 6) holds by the same mechanism. What a
 * view needs is the read half: the `PredictorState` it renders and the pure `predictorIndex` it
 * highlights a row with, which is the `lineIndex` boundary `cache.ts` draws.
 */
export {
  type PredictorState,
  type DynamicScheme,
  BranchPredictor,
  PREDICTOR_ENTRIES,
  predictorIndex,
} from './predictor';
