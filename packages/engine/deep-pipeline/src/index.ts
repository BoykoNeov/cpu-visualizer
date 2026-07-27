/**
 * The deep in-order pipeline RV32I core (M11) — the sixth microarchitecture, and the first with
 * more stage columns than there are phase hues: `IF1 IF2 ID EX1 EX2 MEM WB`.
 *
 * The thesis is DEPTH AS A COST. The 5-stage taught that forwarding makes the bubble vanish; here
 * the same forwarding stops being enough, because a producer's result is not finished until the end
 * of EX2 while its consumer needs it at the start of EX1. Fetch is two cycles and every control
 * transfer resolves at the end of EX2, so the front end is deep enough that a misprediction costs
 * double — and a correctly predicted taken branch still costs two, since the bet is placed in ID
 * and an ID bet kills IF2 *and* IF1.
 *
 * This file is the package scaffold (`docs/plans/m11-tasks.md` step 0). {@link DeepPipelineProcessor}
 * — a fork of `engine/pipeline`'s stage walk with six latches, enumerated `EX2/MEM → EX1` and
 * `MEM/WB → EX1` forwarding paths, and an interlock that watches BOTH execute stages — lands in
 * step 1, and the timing matrix that proves the depth is real (rather than a 5-stage wearing seven
 * labels) is step 3. Nothing here is wired into the model picker until step 5.
 */

/** Stable id of this model within the model family (handoff §2). */
export const DEEP_PIPELINE_MODEL_ID = 'deep-pipeline';
