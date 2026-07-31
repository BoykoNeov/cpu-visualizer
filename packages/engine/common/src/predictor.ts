/**
 * The branch history table — **the predictor's memory** (dynamic-branch-prediction, step 1).
 *
 * **This file is TYPES AND GEOMETRY ONLY at step 1; the stateful class lands at step 2.** That
 * ordering is forced rather than stylistic: step 2's class returns a {@link PredictorState}, and the
 * four models' `micro` types name that type, so the type must exist before either can compile. What
 * is here is exactly the part with no behavior — the shape the view will render, the table size, and
 * the pure index function — following `predict.ts`'s and `cache.ts`'s own precedent of landing a
 * complete, unwired piece before anything rests on it.
 *
 * **Why this lives in `engine-common` rather than in `trace`, against the plan's own step-1
 * wording.** The rule the repo already follows, made explicit here because the plan got it wrong:
 * a type handed to `reset()` is CONFIG and belongs in `trace` (`CacheConfig` does); a type carried
 * in `MachineState.micro` is a MODEL'S OWN SHAPE and belongs beside the code that produces it
 * (`CacheState` does, at `cache.ts`). `trace/src/schema.ts` types `micro` as `unknown` precisely so
 * `trace` never has to know these shapes. The predictor is the second case, so it sits here — one
 * definition, shared by the four models that will drive it, which is the same reason `predict.ts`
 * and `cache.ts` moved down at M7 step 0.
 *
 * **The headline design — the table holds NOTHING but counters.** No tags, no targets, no history
 * register. That is the scope lever the plan asks a reviewer to sign off on, and it has three
 * consequences worth stating where the type is defined:
 *   - **Aliasing is real and is not a bug.** Two branches whose pcs share an index share a counter
 *     and interfere. That is a true fact about a machine that indexes by pc alone (INV-5: a lawful
 *     simplification may omit detail, never contradict), and the corpus has a witness for it —
 *     `nested-loop.s` collides at 4 entries, costing `dynamic-2bit` 181 cycles against 171.
 *   - **A BTB is a different tier.** Because there are no targets here, `jalr` stays unpredictable
 *     by construction exactly as `predict.ts` describes, under every scheme.
 *   - **The predictor cannot change a program's RESULT**, only when things happen — which is why
 *     INV-8 is green by construction here and, equally, why INV-8 is a FALSE NET for this feature.
 *     Verifying a wiring step means comparing event sequences, not final state.
 */

/**
 * How many counters the table holds. **Pinned at 16, and the reason is that every derived number in
 * the plan's step-0 and step-0b tables was computed at this size** (`index (pc>>>2)&15`) — so the
 * pinned 171 / 174 / 177 / 182 for `nested-loop.s` stay usable as step 3's acceptance target
 * without re-deriving a single row.
 *
 * **A module constant, deliberately NOT a `ProcessorConfig` field.** A config knob would be a
 * `trace` schema change, which drags every config literal in the repo and every conformance matrix
 * — a cost the plan never priced — to expose a lever whose whole measured range is one cliff. Step 0
 * measured 16 / 8 / 4 as timing-IDENTICAL over the original eleven-program corpus (nothing aliased),
 * and step 0b found the corpus's only aliasing witness at **4** entries alone. So 8 and 16 are
 * indistinguishable on this corpus and 4 is the one that would make the flagship demo lose; there is
 * no third position to give a user.
 */
export const PREDICTOR_ENTRIES = 16;

/**
 * Which counter a branch at `pc` consults. **Exported pure, and that is the point of it existing
 * separately from step 2's class**: the step-6 panel must highlight the entry touched this cycle,
 * and it derives that from `pc` + this function rather than by reaching into a live predictor
 * (INV-3). It is the same boundary `cache.ts` draws with `lineIndex` — the view renders a table, it
 * never drives one — and `engine-pipeline`'s `index.ts` documents why an off-by-one in a
 * re-implemented index would silently mis-highlight a row.
 *
 * `>>> 2` drops the two low bits every RV32I pc has as zero (instructions are 4-byte aligned), so
 * consecutive instructions get consecutive entries rather than every fourth one — without it, three
 * quarters of the table would be unreachable. The `%` rather than a mask mirrors `cache.ts`'s
 * `blockOf`: the same value at any power-of-two size, and still correct if {@link
 * PREDICTOR_ENTRIES} is ever something else. At the pinned 16 this is exactly the `(pc>>>2)&15` the
 * plan's measured tables were derived with.
 */
export function predictorIndex(pc: number): number {
  return (pc >>> 2) % PREDICTOR_ENTRIES;
}

/**
 * The predictor's whole state: one saturating counter per entry, `counters.length ===
 * {@link PREDICTOR_ENTRIES}`. A plain mutable array of numbers — the same "not double-buffered"
 * class as the register file, memory, and {@link CacheState}; step 2's class mutates it in place.
 *
 * **The counter's RANGE is the scheme, and is deliberately not stored here.** `'dynamic-1bit'` runs
 * `0..1`, `'dynamic-2bit'` runs `0..3` (seeded at 1 — weakly not-taken; step 0 measured that seeding
 * at 0 instead makes the "better" predictor LOSE to the 1-bit on all four single-entry loops). A
 * view needs the width to label a counter, and it reads it from `config.branchPrediction`, which it
 * already has in hand — exactly as the cache grid takes its geometry from `CacheConfig` while
 * {@link CacheState} carries only the lines. The state carries the mutable part and nothing else.
 *
 * ⚠ **Deep-copy this into every `MachineState.micro` snapshot.** It is single-buffered and mutated
 * in place, so a shallow copy would alias one table across every recorded cycle and time-travel
 * would show the fully-TRAINED predictor at cycle 0 — the exact defect `CacheState`'s own note
 * warns about, and the reason the plan gives the deep copy its own step with a break harness
 * (step 4) rather than a line inside the wiring step.
 */
export interface PredictorState {
  readonly counters: number[];
}
