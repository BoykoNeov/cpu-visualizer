/**
 * Multi-cycle datapath (roadmap §12.1) — the second microarchitecture. One instruction is in
 * flight at a time (so, like single-cycle, no hazards), but its lifetime spans several cycles:
 * it walks IF→ID→EX→MEM→WB, one phase per `step()`, with a stable id (INV-4) and per-cycle
 * `micro` latches. Different instruction classes take different numbers of cycles (a load 5, an
 * R-type 4, a branch 3) — the §12.1 "varying cycle counts" headline.
 *
 * Implements the {@link Processor} interface (handoff §6) over the pure {@link ProgramImage};
 * `toProgramImage` (in `@cpu-viz/engine-common`) adapts an `AssembledProgram` into that image.
 */

export {
  MultiCycleProcessor,
  MULTI_CYCLE_CAPABILITIES,
  type Phase,
  type MultiCycleMicro,
} from './processor';

/** Stable id of this model within the model family (handoff §2). */
export const MULTI_CYCLE_MODEL_ID = 'multi-cycle';

export const MULTI_CYCLE_MODEL_DESCRIPTION =
  'Multi-cycle datapath — one instruction in flight, its phases spread across cycles.';
