/**
 * Golden-reference interpreter (handoff §9). Its only job is to be OBVIOUSLY correct:
 * pure fetch / decode / execute, no microarchitecture, no pipeline. Every fancy model is
 * differentially tested against it on final architectural state (INV-8).
 *
 * Scaffold seed: the model identity is fixed here; the interpreter itself is build-order
 * step 3 (handoff §11).
 */

/** Stable id of this model within the model family (handoff §2). */
export const REFERENCE_MODEL_ID = 'reference';

export const REFERENCE_MODEL_DESCRIPTION =
  'Golden-reference interpreter — fetch/decode/execute, no microarchitecture.';
