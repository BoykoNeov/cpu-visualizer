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

/** Stable id of this model within the model family (handoff §2). */
export const PIPELINE_MODEL_ID = 'pipeline';

export const PIPELINE_MODEL_DESCRIPTION =
  'Classic 5-stage pipeline — five instructions in flight, with forwarding, stalls, and flushes.';
