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

// Imported (not only re-exported below) because {@link SUPERSCALAR_MODEL_DESCRIPTION} DERIVES the
// picker's user-facing number from it — an `export ... from` re-export creates no local binding.
import { MAX_ISSUE_WIDTH } from '@cpu-viz/engine-common';

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
 * **The debt step 1 named, paid here (M13 step 6).** It read "up to two" through M7–M12 and step 1
 * deliberately left it alone, because this string is shown in the model picker and describes WHAT
 * THE PRODUCT OFFERS, not what the guard admits — the control still had two positions, and widening
 * the copy first would have promised a machine no user could reach. The control gained its
 * positions in this step, so the sentence moves with it and not before.
 *
 * **Derived from `MAX_ISSUE_WIDTH`, not re-typed**, which is the whole reason step 1 exported a
 * constant. It is the same rule the guard message and the web control follow, applied to the one
 * place in the product where the number is USER-FACING PROSE: raising the bound must not be able to
 * leave the picker describing a narrower machine than the toggle offers. That failure would be
 * silent — no test in this repo asserts on a description's wording, by design (M13 step 4's finding
 * that nothing here asserts on `it()` titles is the same shape).
 *
 * The wording says "up to", and that is load-bearing rather than hedging: step 0's dump measured
 * nine of eleven corpus programs cycle-identical at widths 3 and 4. The ceiling is real; the rate
 * almost never reaches it, and the picker should not imply otherwise before the reader has run
 * anything.
 */
export const SUPERSCALAR_MODEL_DESCRIPTION =
  `In-order superscalar — up to ${MAX_ISSUE_WIDTH} instructions issue per cycle, ` +
  'sharing every pipeline stage.';
