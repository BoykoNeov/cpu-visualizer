/**
 * The classic 5-stage pipeline (roadmap §12.2) — the third microarchitecture, and the tier the
 * spec does not hedge about: "_the_ high-value tier … A beautifully-done version of _this tier
 * alone_ is already a strong product."
 *
 * Up to five instructions are in flight at once (IF/ID/EX/MEM/WB), each keeping its stable id
 * (INV-4) for its whole lifetime — the first model where following one instruction is the only
 * way to read the trace at all. Instructions INTERACT here, which nothing before this could do:
 * a RAW hazard resolves by forwarding or by stalling depending on `ProcessorConfig.forwarding`,
 * making this the first model whose TRACE depends on its CONFIG.
 *
 * Implements the {@link Processor} interface (handoff §6) over the pure {@link ProgramImage};
 * `toProgramImage` (in `@cpu-viz/engine-common`) adapts an `AssembledProgram` into that image.
 */

export {
  PipelineProcessor,
  PIPELINE_CAPABILITIES,
  type Stage,
  type PipelineMicro,
  type IfIdLatch,
  type IdExLatch,
  type ExMemLatch,
  type MemWbLatch,
} from './processor';

/**
 * The flagship cache geometry, re-exported for the web toggle (M6 step 5) and any other consumer
 * above this package in the DAG. These are the SAME constants the timing suite (step 4) and the
 * conformance differential (step 3) pin against — the straddle experiment's single source of truth
 * (see `cache.ts`). The web control MUST build its `CacheConfig` from these rather than re-deriving
 * a geometry, or the small↔large flip could de-straddle `array-sum-twice.s` and the live scrub bar
 * would stop matching step 4's 340↔320.
 *
 * **The definitions moved to `@cpu-viz/engine-common` at M7 step 0** (superscalar needs the same
 * cache, and models import no sibling model). They are re-exported from here UNCHANGED so every
 * consumer above this package keeps its existing import — the ten `web` files that read this
 * surface did not move a line.
 */
export { CACHE_SMALL, CACHE_LARGE, LINE_SIZE_BYTES } from '@cpu-viz/engine-common';

/**
 * The cache grid view's decode toolkit (M6 step 6). The line here is between READING the cache and
 * RUNNING it: the SHAPE of what `micro.cache` carries (`CacheState`/`CacheLine`) is trace data, and
 * the address decode (`lineIndex`/`lineTag`/`blockBase`/`blockBaseOf`) is a set of PURE functions of
 * `(config, addr)` — neither consults the live cache, so both are safe to expose (INV-3: the grid
 * derives its picture from `micro` + the trace, never from the engine). The MUTATING machinery —
 * `access`, `newCache` — stays package-private; nothing above this package may drive a cache, only
 * render one. Importing the decode rather than reimplementing it keeps the view's geometry exactly
 * the engine's — an off-by-one in `lineIndex` would silently mis-highlight a line.
 *
 * That boundary SURVIVES the M7 step 0 move intact. `engine-common` necessarily exports `access`
 * and `newCache` too (models must be able to drive a cache), but this package still re-exports
 * only the read surface, so "nothing above the engines may drive a cache" remains true of the
 * import path the web actually uses.
 */
export {
  type CacheState,
  type CacheLine,
  lineIndex,
  lineTag,
  blockBase,
  blockBaseOf,
} from '@cpu-viz/engine-common';

/** Stable id of this model within the model family (handoff §2). */
export const PIPELINE_MODEL_ID = 'pipeline';

export const PIPELINE_MODEL_DESCRIPTION =
  'Classic 5-stage pipeline — five instructions in flight, with forwarding, stalls, and flushes.';
