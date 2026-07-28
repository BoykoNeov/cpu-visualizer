/**
 * The widest machine any WIDE model admits — one number, one owner, shared by every engine that
 * honors {@link ProcessorConfig.issueWidth}.
 *
 * ## Why it lives here and not in `engine-superscalar` (M13 step 6)
 *
 * It was declared in `engine/superscalar/src/processor.ts` at M13 step 1, deliberately: "the web's
 * width control and the conformance matrix read the bound from the engine that ENFORCES it rather
 * than re-typing a `4`". That reasoning was right and it survives the move — what changed is how
 * many engines enforce it.
 *
 * Step 6 pinned (user, 2026-07-28) that the OUT-OF-ORDER model is capped at the same bound rather
 * than gating the shared UI control per model. That decision cannot be implemented where the
 * constant used to live: `eslint.config.js` forbids `engine/out-of-order` from importing
 * `engine-superscalar` ("a concrete model never imports another model's production code"), and the
 * two lawful ways past that rule are both worse than moving it down — a second literal `4` in the
 * out-of-order guard (two owners for one bound, which is what step 1 exported the constant to
 * prevent) or hoisting it into `trace` (a schema layer, which a product-offering number is not).
 *
 * `engine-common` is the one production edge BOTH engines already declare, and it is where this
 * repo has put exactly this shape of thing before: `predict.ts` and `cache.ts` moved down here at
 * M7 step 0 for the same reason, the second model needing them. The precedent's own argument
 * applies verbatim — *two drifting copies of a constant M3/M7/M9 timing matrices are compared
 * against would make that comparison quietly meaningless.*
 *
 * ## Why 4, and why a bound exists at all
 *
 * 4 is exactly what the product offers, and a guard that admits more than the product offers is
 * untested surface: widths 5+ have no derived timing cell, no dumped group-size histogram, and no
 * adversarial net. 4 is also where the corpus shows widening STOP paying on the in-order machines —
 * nine of eleven programs are cycle-identical at 3 and 4 — so it is the last width with anything
 * left to teach. Raising it is a MEASUREMENT, not an edit.
 *
 * **The out-of-order model is the one place that last sentence reads differently, and it is worth
 * knowing before anyone raises this number.** Step 6's dump (corpus × widths 1..4 × both issue
 * orders × 3 schemes × 3 cache geometries = 792 cells, 0 mismatches) found that out-of-order issue
 * keeps paying at width 4 where in-order stops: `array-sum.s` runs 51 → 42 → 36 → 36 in order and
 * 51 → 33 → 30 → 26 out of order, and `array-sum-twice.s` 208 → 132 → 127 → 104. So the diminishing
 * return that justifies the bound is a property of the IN-ORDER models, not of the width axis.
 *
 * ## The one boundary this move relaxed, recorded rather than left to be discovered
 *
 * `engine-conformance` already imports `toProgramImage` from here, so after this move it CAN import
 * this constant — and M13 step 4 deliberately split its width claim in two (the harness owns "N
 * widths ⇒ N labels", the model's own file owns "reaches every width the guard admits") **because
 * importing the bound into `engine-conformance` was a package cycle**. That cycle is gone; the
 * split is not. It stays because the reason it is correct outlives the reason it was forced:
 * `engine-conformance` is model-agnostic by eslint rule, and a model-agnostic harness that knows
 * one model family's bound is asserting something it cannot see. Only judgement enforces that now,
 * which is why it is written down here.
 */
export const MAX_ISSUE_WIDTH = 4;
