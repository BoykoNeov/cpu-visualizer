/**
 * Single-cycle datapath (handoff §11) — the first microarchitecture, where each
 * instruction completes before the next starts (so there are no hazards). It is the
 * right first model precisely because it has minimal microarchitecture but exercises the
 * full pipeline of project plumbing: ISA -> assembler -> engine -> trace -> driver ->
 * view -> depth-tiering -> curriculum.
 *
 * Scaffold seed: the model identity is fixed here; the datapath semantics behind the
 * Processor interface (handoff §6) are build-order step 4 (handoff §11).
 */

/** Stable id of this model within the model family (handoff §2). */
export const SINGLE_CYCLE_MODEL_ID = 'single-cycle';

export const SINGLE_CYCLE_MODEL_DESCRIPTION =
  'Single-cycle datapath — one instruction enters and completes per cycle.';
