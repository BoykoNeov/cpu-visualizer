/**
 * Branch prediction — the ID-stage half (M4 step 0).
 *
 * **Relocated to `engine-common` at M7 step 0, behaviour unchanged.** It was written for the
 * pipeline but never depended on one: the two functions below read a decode and a pc, and nothing
 * else. Superscalar needs the same claim from the same rules, and models here import no sibling
 * model, so the definition moved down rather than being copied. Its tests stayed in
 * `engine-pipeline` (`predict.test.ts`) — they sweep the corpus through a REAL `PipelineProcessor`
 * to prove ID's target agrees with EX's, which is a claim about a model and cannot live in a
 * package forbidden from importing one. The history below is the pipeline's; read `processor.ts`
 * there for the EX side it mirrors.
 *
 * **Why this file exists at all**, given M3's explicit refusal. `processor.ts` says, of the EX
 * stage: _"There is deliberately no BRANCHES set: 'is this a control transfer' is not a separate
 * classification here, it is whatever the EX switch resolved a `taken` answer for."_ That refusal
 * was right for M3 and is what made `jal`/`jalr` fall out as ordinary transfers rather than
 * special cases.
 *
 * M4 cannot keep it. A **prediction must be made before the answer exists** — that is what makes
 * it a prediction — so something upstream of EX has to say "this word is a control transfer, and
 * if it goes, it goes *there*", using only what ID has: the decoded word and its own pc. The
 * classification comes back not because M3 was wrong but because speculation needs a claim where
 * M3 needed only an answer.
 *
 * **Nothing calls this yet, and that is step 0's point.** The function is pure and unwired; the
 * machine still predicts not-taken. What step 0 buys is the *safety property* the ID redirect will
 * rest on, pinned before anything rests on it: that this stage's target, computed from a decode,
 * agrees with the one EX computes from the real execution. Two units computing one address by
 * different routes is a correctness hazard (it is how a real BTB goes wrong), so the agreement is
 * asserted over the whole corpus in `predict.test.ts` rather than assumed from the fact that both
 * spell `pc + imm`.
 */

import type { DecodedInstruction } from '@cpu-viz/isa';

/**
 * The control transfers whose target is **PC-relative** — `pc + imm`, needing no register — and
 * which are therefore predictable from a decode alone.
 *
 * `jalr` is the deliberate omission, and the whole reason this is a set rather than "is it a
 * transfer". Its target is `rs1 + imm`: a REGISTER supplies it, so the address does not exist
 * until EX has forwarded the operand. An ID-stage predictor cannot know where a `jalr` goes
 * without becoming a different machine (a BTB predicting from the pc alone — a deferred tier), so
 * `jalr` is unpredictable **by construction here**, and pays the full EX-resolution penalty under
 * every scheme.
 *
 * That asymmetry is not a corner case to tidy away later: it is load-bearing for the milestone's
 * thesis. `call-return.s` is expected to get SLOWER under predict-taken precisely because its
 * `jal` improves while its `ret` (a `jalr`) cannot.
 */
const CONDITIONAL_BRANCHES: ReadonlySet<string> = new Set([
  // PC-relative target, direction unknown until EX compares. **The only words a dynamic counter
  // table has anything to say about** — see {@link isConditionalBranch}.
  'beq',
  'bne',
  'blt',
  'bge',
  'bltu',
  'bgeu',
]);

const PC_RELATIVE_TRANSFERS: ReadonlySet<string> = new Set([
  // Unconditional, and always taken — so a taken-predictor is always RIGHT about `jal`.
  'jal',
  // ...plus every conditional branch, DERIVED rather than re-listed: a mnemonic added to the set
  // above must not have to be remembered here too, or the two sets drift and a new branch becomes
  // conditional-for-the-counter while staying unpredictable-for-the-bet.
  ...CONDITIONAL_BRANCHES,
]);

/**
 * Where `d` would go **if it is taken**, computed from the decode and pc alone — or `null` if that
 * question has no ID-answerable meaning (not a transfer, or a `jalr`, whose target needs a
 * register).
 *
 * A non-null answer is exactly "ID could place a bet on this word". It says nothing about whether
 * the transfer IS taken: for a conditional branch only EX knows, and that gap between "where it
 * would go" and "whether it goes" is the thing being predicted.
 *
 * Mirrors EX's arithmetic deliberately, including the `>>> 0`: EX computes `(ie.pc + imm) >>> 0`.
 *
 * **The `>>> 0` is invisible to the corpus, and that is worth knowing rather than discovering.**
 * Deleting it leaves every corpus-driven test green: all corpus addresses are small and every
 * backward branch lands well above zero, so `pc + imm` never leaves the range where the signed and
 * unsigned readings agree. The agreement test cannot see it either — EX normalizes too, so both
 * routes would be wrong together and still match. It is therefore pinned by a DIRECT case in
 * `predict.test.ts` (a backward branch evaluated near zero), not by the sweep. Measured by
 * mutation, not assumed.
 */
export function speculativeTarget(d: DecodedInstruction, pc: number): number | null {
  if (!PC_RELATIVE_TRANSFERS.has(d.mnemonic)) return null;
  return (pc + d.imm) >>> 0;
}

/**
 * Is `d` a transfer whose direction and target ID can bet on? A thin alias of
 * `speculativeTarget(...) !== null`, named for the question call sites actually ask, so the
 * scheme logic in step 1 reads as intent rather than as a null check.
 */
export function isPredictable(d: DecodedInstruction): boolean {
  return PC_RELATIVE_TRANSFERS.has(d.mnemonic);
}

/**
 * Is `d` a **conditional** branch — a transfer whose DIRECTION is genuinely in question?
 *
 * The narrower sibling of {@link isPredictable}, and it exists for one reason: a dynamic counter
 * table is a memory of directions, and only these words have a direction to remember. It separates
 * `jal` from the six branches, which {@link isPredictable} deliberately does not (there, both are
 * "ID can compute where this goes").
 *
 * **This is the predicate that spells the dynamic-branch-prediction plan's two `jal` decisions**,
 * both pinned CLOSED at step 3 on measured seeds:
 *   - **`jal` does not CONSULT the table** — it is unconditionally taken, so a counter can only be
 *     wrong about it. Priced at exactly 1 cycle on `call-return.s` (16 bypassing, 17 consulting a
 *     cold weakly-not-taken counter), landing squarely on M4's own `+1` witness.
 *   - **`jal` and `jalr` do not UPDATE it** — measured at zero effect on this corpus (no jump shares
 *     an index with a conditional branch at 16, 8 or 4 entries), so it is a pedagogy call rather
 *     than a timing one: a table whose every row is a conditional branch reads cleaner.
 *
 * ⚠ **Both policies are CALL-SITE policy and this predicate is the whole of their mechanism.** Step
 * 2 kept `BranchPredictor`'s API at `predict(pc)` / `update(pc, actual)` precisely so these
 * questions stayed open for the models to answer — a constructor taking a decode would have closed
 * them inside a package forbidden from importing a model. So the four wiring sites (steps 3 and 5)
 * each gate on this, and the plan's derived cycle tables were computed under exactly this policy:
 * if a call site and the table disagree, the acceptance numbers fail with no way to tell which of
 * the two is wrong.
 *
 * `jalr` is absent here for the same reason it is absent from {@link speculativeTarget}'s set — its
 * target lives in a register — but note the two absences are different facts: `jalr` is
 * unpredictable, `jal` is perfectly predictable and simply has nothing to learn.
 */
export function isConditionalBranch(d: DecodedInstruction): boolean {
  return CONDITIONAL_BRANCHES.has(d.mnemonic);
}
