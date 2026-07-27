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
 * {@link DeepPipelineProcessor} (M11 step 1) is a fork of `engine/pipeline`'s stage walk with six
 * latches, enumerated `EX2/MEM → EX1` and `MEM/WB → EX1` forwarding paths, and an interlock that
 * watches BOTH execute stages. The timing matrix that proves the depth is real — rather than a
 * 5-stage wearing seven labels — is step 3, and nothing here is wired into the model picker until
 * step 5. A non-null `cache` config is REFUSED BY NAME until step 6 pins how M6's miss-freeze meets
 * two execute stages.
 *
 * Implements the {@link Processor} interface (handoff §6) over the pure {@link ProgramImage};
 * `toProgramImage` (in `@cpu-viz/engine-common`) adapts an `AssembledProgram` into that image.
 */

export {
  DeepPipelineProcessor,
  DEEP_PIPELINE_CAPABILITIES,
  type Stage,
  type DeepPipelineMicro,
  type FetchLatch,
  type IdEx1Latch,
  type Ex1Ex2Latch,
  type Ex2MemLatch,
  type MemWbLatch,
} from './processor';

/** Stable id of this model within the model family (handoff §2). */
export const DEEP_PIPELINE_MODEL_ID = 'deep-pipeline';
