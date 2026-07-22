/**
 * The out-of-order RV32I core (roadmap §12.5, M9) — the fifth microarchitecture, and the first
 * whose architectural effect happens out of program order. `docs/plans/m9-tasks.md` step 1a: the
 * faithful base — renaming, the ROB, and in-order commit are real; issue is still strictly in
 * program order. Step 1b adds the wakeup/select scheduler on top.
 *
 * Implements the {@link Processor} interface (handoff §6) over the pure {@link ProgramImage};
 * `toProgramImage` (in `@cpu-viz/engine-common`) adapts an `AssembledProgram` into that image.
 */

export { OutOfOrderProcessor, OUT_OF_ORDER_CAPABILITIES } from './processor';
export { Rob, type RobEntry, type RobState } from './rob';
export { RenameTable } from './rename';
export { type Tag, type OperandSource, type RenameSlot } from './types';

/** Stable id of this model within the model family (handoff §2). */
export const OUT_OF_ORDER_MODEL_ID = 'out-of-order';

export const OUT_OF_ORDER_MODEL_DESCRIPTION =
  'Out-of-order (Tomasulo) — register renaming, a reorder buffer, and in-order commit over ' +
  'out-of-order completion. Step 1a: issue is still strictly in program order.';
