/**
 * The in-order SUPERSCALAR (roadmap §12, tier 4) — the fourth microarchitecture, and the last
 * in-order thing left. Every model up to and including the cached 5-stage pipeline held a property
 * the code leaned on everywhere: **stage position is identity**. M3 made five instructions overlap;
 * it did not make two of them share a stage. This model does, and naming an occupant therefore
 * takes a stage *and* a slot — which is why `InstructionInstance.location` here is always
 * `"<stage>.<slot>"` (`"EX.0"`, `"EX.1"`), never a bare `"EX"`.
 *
 * Issue width is a CONFIG TOGGLE (`ProcessorConfig.issueWidth`), not a second model: the spec's
 * flagship interaction is flipping a feature and watching the same program change behavior, and
 * width is the most legible instance of it in the product. The 1-wide position is an honest
 * machine, not a duplicate of M3 — it runs the issue logic and simply never finds a pair.
 *
 * **Both widths are real as of step 2b.** Width 1 never pairs, so it reproduces the pipeline's
 * closed form `cycles = N + 4 + S + P + M` over the whole corpus (`timing.test.ts`, whose width-1
 * numbers are M3's, unchanged) — that identity is what PROVES the port faithful. Width 2 runs
 * strictly fewer cycles on all seven corpus programs with byte-identical architectural results,
 * under the derived form `cycles = G + L + P + M + 4` (step 4). `reset()` throws on any width
 * other than 1 or 2 rather than silently running narrow.
 *
 * **The net for this tier is TIMING, not INV-8.** An in-order superscalar retires in order, so
 * `runConformance` passes even with the pairing logic completely wrong — see `timing.test.ts`.
 *
 * Implements the {@link Processor} interface (handoff §6) over the pure {@link ProgramImage};
 * `toProgramImage` (in `@cpu-viz/engine-common`) adapts an `AssembledProgram` into that image.
 */

export {
  SuperscalarProcessor,
  SUPERSCALAR_CAPABILITIES,
  type Stage,
  type SuperscalarMicro,
  type IfIdLatch,
  type IdExLatch,
  type ExMemLatch,
  type MemWbLatch,
} from './processor';

/** Stable id of this model within the model family (handoff §2). */
export const SUPERSCALAR_MODEL_ID = 'superscalar';

export const SUPERSCALAR_MODEL_DESCRIPTION =
  'In-order superscalar — up to two instructions issue per cycle, sharing every pipeline stage.';
