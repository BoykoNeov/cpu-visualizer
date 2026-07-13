/**
 * Single-cycle datapath (handoff §11) — the first microarchitecture, where each
 * instruction completes before the next starts (so there are no hazards). It is the
 * right first model precisely because it has minimal microarchitecture but exercises the
 * full pipeline of project plumbing: ISA -> assembler -> engine -> trace -> driver ->
 * view -> depth-tiering -> curriculum.
 *
 * Implements the {@link Processor} interface (handoff §6) over the pure {@link ProgramImage}
 * the trace layer defines; `toProgramImage` (in `@cpu-viz/engine-common`) adapts an
 * `AssembledProgram` into that image.
 */

export { SingleCycleProcessor, SINGLE_CYCLE_CAPABILITIES } from './processor';

/** Stable id of this model within the model family (handoff §2). */
export const SINGLE_CYCLE_MODEL_ID = 'single-cycle';

export const SINGLE_CYCLE_MODEL_DESCRIPTION =
  'Single-cycle datapath — one instruction enters and completes per cycle.';
