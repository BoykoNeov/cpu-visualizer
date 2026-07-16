/**
 * Branch prediction — the ID-stage half (M4 step 0).
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
const PC_RELATIVE_TRANSFERS: ReadonlySet<string> = new Set([
  // Unconditional, and always taken — so a taken-predictor is always RIGHT about `jal`.
  'jal',
  // Conditional: PC-relative target, direction unknown until EX compares.
  'beq',
  'bne',
  'blt',
  'bge',
  'bltu',
  'bgeu',
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
