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
 * machine, not a duplicate of M3 — it runs the issue logic and simply never finds a partner.
 *
 * **Every width is real.** Width 1 never pairs, so it reproduces the pipeline's closed form
 * `cycles = N + 4 + S + P + M` over the whole corpus (`timing.test.ts`, whose width-1 numbers are
 * M3's, unchanged) — that identity is what PROVES the port faithful. Width 2 runs strictly fewer
 * cycles on every corpus program with byte-identical architectural results, under the derived form
 * `cycles = G + L + P + M + 4` (M7 step 4). Widths 3 and 4 joined the toggle at M13 step 1, which
 * widened the GUARD and nothing else — the issue logic was already group-shaped rather than
 * pair-shaped, and the milestone's dump established that by running the corpus at 3 and 4 before a
 * line was written. `reset()` throws on anything that is not a whole number in
 * `1..MAX_ISSUE_WIDTH` rather than silently running narrow.
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
  MAX_ISSUE_WIDTH,
  type Stage,
  type SuperscalarMicro,
  type IfIdLatch,
  type IdExLatch,
  type ExMemLatch,
  type MemWbLatch,
} from './processor';

/** Stable id of this model within the model family (handoff §2). */
export const SUPERSCALAR_MODEL_ID = 'superscalar';

/**
 * **Deliberately still says "two", and M13 step 1 left it alone.** This string is shown in the
 * model picker, and it describes WHAT THE PRODUCT OFFERS, not what the guard admits: the width
 * control still has two positions until step 6 enables 3 and 4. Widening it here would make the
 * picker promise a machine no user can reach. It moves in step 6, with the control.
 */
export const SUPERSCALAR_MODEL_DESCRIPTION =
  'In-order superscalar — up to two instructions issue per cycle, sharing every pipeline stage.';
