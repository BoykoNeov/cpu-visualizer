/**
 * The branch history table — **the predictor's memory** (dynamic-branch-prediction, steps 1–2).
 *
 * **Step 1 landed the types and geometry; step 2 added {@link BranchPredictor}, the stateful class.**
 * That ordering was forced rather than stylistic: the class returns a {@link PredictorState}, and the
 * four models' `micro` types name that type, so the type had to exist before either could compile.
 * Both halves follow `predict.ts`'s and `cache.ts`'s own precedent of landing a complete, unwired
 * piece before anything rests on it — **nothing constructs a `BranchPredictor` yet**; step 3 wires
 * the pipeline and step 5 the other three models.
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

import type { ProcessorConfig } from '@cpu-viz/trace';

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
 *
 * **`pc` is ABSOLUTE, and that costs nothing only because `TEXT_BASE` is `0x0000_0000`**
 * (`assembler/src/program.ts`) — so an absolute pc equals its offset from the start of text, and the
 * plan's row numbers ("`nested-loop.s`'s guard at pc 8 lands on index 2") are true of the shipped
 * table verbatim. Worth stating because it need not have been: a non-zero base rotates every row by
 * `(TEXT_BASE >>> 2) % PREDICTOR_ENTRIES`. Collisions survive a constant rotation, so **no cycle
 * count would move** — but step 6's panel is checked against those stated rows, so a future
 * `TEXT_BASE` change moves the picture without moving a single number, which is the hardest kind of
 * drift to notice. `predictor.test.ts` pins the two witnesses.
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
 * ⚠ **Deep-copy this into every `MachineState.micro` snapshot** — `.slice()` the counters, and note
 * that a spread of THIS object is not enough: `{ ...state }` builds a fresh wrapper around the same
 * array, which reads as a copy and aliases anyway. It is single-buffered and mutated in place, so a
 * shallow copy would alias one table across every recorded cycle and time-travel would show the
 * fully-TRAINED predictor at cycle 0 — the exact defect `CacheState`'s own note warns about, and the
 * reason the plan gives the deep copy its own step with a break harness (step 4). **Done on the
 * pipeline at step 4; the other three models copy that shape at step 5.**
 */
export interface PredictorState {
  readonly counters: number[];
}

/**
 * The schemes that actually own a table — the `dynamic-*` half of `ProcessorConfig.branchPrediction`.
 *
 * **Derived from the trace union with a template-literal `Extract` rather than written out**, so it
 * is a tripwire and not a copy. Adding a third dynamic name upstream widens this type, which makes
 * {@link COUNTER_BITS}'s `Record` incomplete and reddens `tsc` at the one place that has to answer
 * "how wide is its counter?". A hand-listed union would silently accept the newcomer and run it as a
 * 1-bit table. Same shape as `SCHEME_POSITION`'s `Record<BranchPrediction, …>` in
 * `web/src/simulator.test.ts`, which is the compile tripwire that fired at step 1.
 *
 * **FIRED, not assumed** — step 1's headline lesson was a "by construction" agreement enforced by
 * nothing, so this one was measured: adding `'dynamic-3bit'` to the union produces exactly one
 * error, `TS2741` on {@link COUNTER_BITS} below, and nothing else.
 *
 * ⚠ **But the tripwire is PREFIX-CONDITIONAL, and the decisions table explicitly contemplated the
 * other spelling.** A scheme named `'bht-3bit'` does not match `` `dynamic-${string}` ``, so this
 * type would not widen and the `Record` would stay complete; the error would instead land at
 * whichever step-3/5 call site hands `config.branchPrediction` to the constructor. Still a compile
 * error, but not the one named here — so a future scheme wants a `dynamic-` prefix, or this type
 * wants rewriting as an explicit union.
 */
export type DynamicScheme = Extract<ProcessorConfig['branchPrediction'], `dynamic-${string}`>;

/**
 * The one thing that differs between the two schemes: **how many bits a counter has.** Everything
 * else below — the seed, the taken threshold, the ceiling — is derived from this number, which is
 * why the class needs no per-scheme branch and why a third width would be a one-row change.
 */
const COUNTER_BITS: Record<DynamicScheme, number> = {
  'dynamic-1bit': 1,
  'dynamic-2bit': 2,
};

/**
 * A counter's whole shape, derived from the scheme in ONE place — the ceiling, the taken threshold,
 * and the cold seed.
 *
 * **Added at step 6, because the panel is the second consumer of arithmetic that had exactly one.**
 * Until now {@link BranchPredictor}'s constructor was the only thing that turned a scheme into a
 * range, so it derived `max` and `takenFrom` inline and nothing else needed them. The step-6 view
 * needs both to say what a row currently BETS and how strongly — and re-deriving `1 << (bits - 1)`
 * in `web` would be the four-site divergence `m13-width-planned.md` records as this repo's measured
 * failure mode, on the one number where being wrong is invisible: a view that mis-reads the
 * threshold draws a row betting taken while the engine bets not-taken, and every cycle count stays
 * right. One function, two callers, no second spelling.
 *
 * ⚠ **This deliberately does NOT replace {@link COUNTER_BITS}'s `Record`.** That literal's
 * incompleteness is the feature's one COMPILE tripwire and it has already fired once, deliberately
 * (step 2: adding `'dynamic-3bit'` to the union produces exactly one error, `TS2741`, here). A
 * refactor that computed the width some other way — a `startsWith`, a parsed digit — would disarm
 * a tripwire that is doing its job.
 */
export interface CounterGeometry {
  /** Counter width in bits: 1 or 2. The one thing that differs between the schemes. */
  readonly bits: number;
  /** The counter's ceiling — `1` for a 1-bit table, `3` for a 2-bit one. */
  readonly max: number;
  /** The lowest value that predicts TAKEN: the top half of the range (`1` for 1-bit, `2` for 2-bit). */
  readonly takenFrom: number;
  /** A cold counter — **weakly not-taken**, which is `takenFrom - 1` in both schemes. See
   *  {@link BranchPredictor}'s constructor for why `0` is not a neutral alternative for 2-bit. */
  readonly seed: number;
}

export function counterGeometry(scheme: DynamicScheme): CounterGeometry {
  const bits = COUNTER_BITS[scheme];
  const takenFrom = 1 << (bits - 1);
  return { bits, max: (1 << bits) - 1, takenFrom, seed: takenFrom - 1 };
}

/**
 * A COLD table — every counter at its seed. The state a machine resets to, and the honest picture
 * of the predictor **before the first cycle has run**.
 *
 * **Exported at step 6 so that three callers cannot answer "what does an untrained table look
 * like?" three ways**: this class's constructor, the step-6 panel's pre-run cursor, and
 * `MicroTablePanel`'s fabricated cursor-−1 micro, which carried a placeholder `predictor: null`
 * from step 1 until step 6 made it reachable. `null` says "this machine has no predictor", which
 * is a different claim from "it has one and has learned nothing" — and the second is what a
 * dynamic scheme at cursor −1 actually means.
 *
 * The corpus makes that continuity checkable rather than merely plausible: **no program on any of
 * the four models trains a counter during cycle 0** (measured at step 6 over 12 programs × 4 models
 * × both schemes), so the pre-run picture this returns is exactly the table the recording's first
 * cycle reports, and stepping off the start moves no counter. `predictor-table.test.ts` pins that
 * against real recordings — if a future program ever resolves a branch in its first cycle, that is
 * where it says so.
 */
export function coldPredictorState(scheme: DynamicScheme): PredictorState {
  return {
    counters: new Array<number>(PREDICTOR_ENTRIES).fill(counterGeometry(scheme).seed),
  };
}

/**
 * Does this scheme own a counter table? The narrowing every wiring site needs before it can
 * construct a {@link BranchPredictor} (step 3 for the pipeline, step 5 for the other three).
 *
 * **It tests membership of {@link COUNTER_BITS} rather than the `'dynamic-'` PREFIX, and that is the
 * whole reason it exists as a function instead of four inline `startsWith` calls.** A prefix test
 * would be a second, independent spelling of {@link DynamicScheme}'s template literal — agreeing with
 * it "by construction", which is precisely the kind of agreement step 1 measured as enforced by
 * nothing (a divergent field name passed typecheck and all 7591 tests). Keyed off the `Record`, the
 * runtime answer and the compile-time type have ONE source: a third dynamic scheme reddens
 * `COUNTER_BITS` at `tsc`, and the moment that error is fixed this predicate already knows the
 * newcomer. A prefix test would instead have silently returned `true` for a scheme with no width
 * defined, and `new BranchPredictor` would have built a table of `NaN` counters.
 *
 * It also repairs half of the prefix-conditionality {@link DynamicScheme} documents: a scheme
 * spelled `'bht-3bit'` still would not widen the TYPE, but it could not slip past this test either.
 */
export function isDynamicScheme(
  scheme: ProcessorConfig['branchPrediction'],
): scheme is DynamicScheme {
  // `Object.hasOwn`, not `in`: the latter walks the prototype chain, so a scheme spelled
  // `'toString'` or `'constructor'` would answer true and hand `new BranchPredictor` a width of
  // `undefined` — the table of `NaN` counters this predicate exists to prevent, arriving by the
  // one route the `Record` keying does not close. Reachable because lesson JSON is cast without
  // runtime validation; `lessons.test.ts` closes the other half by checking the scheme is real.
  return Object.hasOwn(COUNTER_BITS, scheme);
}

/**
 * A pc-indexed table of saturating counters — **the whole dynamic predictor** (step 2).
 *
 * A class rather than `cache.ts`'s functions-over-a-state-object, and the difference is not taste.
 * `access()` threads `config` through every call because a cache's geometry lives in `CacheConfig`
 * and varies per run; this table's geometry is a module constant ({@link PREDICTOR_ENTRIES}) and its
 * only variable is the counter width. Constructing from the scheme derives that width **once**, so
 * the four wiring sites (steps 3 and 5) pass `config.branchPrediction` straight through and none of
 * them re-derives a threshold. That matters here specifically: `m13-width-planned.md` measured
 * four-site divergence as this repo's live failure mode, and a width computed at four call sites is
 * four chances to compute it differently.
 *
 * **The API is deliberately `predict(pc)` / `update(pc, actual)` and nothing richer**, because three
 * decisions in the plan's table are still open and all three are CALL-SITE policy:
 *   - does `jal` consult the counter, or is an unconditional jump simply predicted taken?
 *   - do `jal` / `jalr` **update** it?
 *   - does a SQUASHED branch update it — on resolve, or on commit? (the OoO fork, to pin before step 5)
 *
 * A constructor taking a decode, or an `update` taking `isConditional`, would close all three by
 * implementation — and would close them **inside a package forbidden from importing a model**, which
 * is exactly the wrong place for a question whose answer is "it depends which machine". The two-arg
 * `update` is what keeps update-on-resolve vs update-on-commit a step-5 decision instead of a step-2
 * accident.
 *
 * **Not double-buffered.** {@link update} mutates in place, the same class as the register file,
 * memory and `CacheState` — see {@link snapshot} for whose job the copy is.
 */
export class BranchPredictor {
  /**
   * The live table. Held as a {@link PredictorState} rather than a bare array so {@link snapshot}
   * has a stable object to hand out, exactly as a model holds one `CacheState` for the run.
   */
  private readonly state: PredictorState;

  /** The counter's ceiling: `1` for a 1-bit table, `3` for a 2-bit one. */
  private readonly max: number;

  /**
   * The lowest counter value that predicts TAKEN — the top half of the range, so `1` for 1-bit and
   * `2` for 2-bit. Stated as a threshold rather than as a per-scheme `if` because that is what makes
   * the seed below fall out as one expression instead of a second table.
   */
  private readonly takenFrom: number;

  /**
   * A cold table: every counter **weakly not-taken**, which is `takenFrom - 1` in both schemes (0 for
   * 1-bit — its only not-taken state — and 1 for 2-bit).
   *
   * ⚠ **Seeding 2-bit at `0` instead is not a neutral alternative, and the plan measured it**: at
   * strongly-not-taken the "better" predictor LOSES to the 1-bit on all four single-entry loops
   * (`array-sum` 72 vs 71, likewise `strided-sum` / `sum-loop` / `slow-op-loop`), because a loop
   * entered once never pays back the extra step it takes to warm up. A demo whose headline is "the
   * 2-bit predictor is smarter" cannot ship showing it lose. Weakly-not-taken also buys the animation
   * the lesson wants — a loop's first pass visibly *learns* rather than starting right.
   *
   * **Routed through {@link counterGeometry} and {@link coldPredictorState} as of step 6**, which is
   * a refactor with a purpose rather than tidying: the step-6 panel needs the same threshold and the
   * same cold table, and the alternative was a second derivation of `1 << (bits - 1)` in `web`. The
   * engine and the view now read one function, so a view cannot draw a row betting taken while the
   * engine bets not-taken — a disagreement that would move no cycle count and so would be invisible
   * to everything except a reader looking at both.
   */
  constructor(scheme: DynamicScheme) {
    const geometry = counterGeometry(scheme);
    this.max = geometry.max;
    this.takenFrom = geometry.takenFrom;
    this.state = coldPredictorState(scheme);
  }

  /**
   * Which counter `pc` consults. **Delegates to {@link predictorIndex} and must keep delegating** —
   * the decisions table pinned the standalone function precisely so the step-6 panel can highlight
   * the touched row without reaching into a live predictor (INV-3), and two implementations of one
   * index is how a panel comes to highlight the wrong row while every cycle count stays right.
   *
   * ⚠ **Inlining the arithmetic here would be invisible to every test**, and that is worth stating
   * rather than pretending otherwise: `(pc >>> 2) & 15` and `(pc >>> 2) % 16` are the same value for
   * every uint32 at the pinned size, so the delegation is a *reading* guarantee that only starts
   * paying if {@link PREDICTOR_ENTRIES} ever moves. What tests CAN see is the coupling below — that
   * {@link predict} and {@link update} route through this same index — and `predictor.test.ts` pins
   * that against the exported function rather than against a repeated literal.
   */
  index(pc: number): number {
    return predictorIndex(pc);
  }

  /**
   * The bet: does this branch's counter sit in the taken half of its range?
   *
   * **Read-only — consulting a predictor never trains it.** Training happens at resolution, when the
   * answer exists, which is the whole reason {@link update} is a separate call made from a different
   * stage.
   */
  predict(pc: number): boolean {
    return this.state.counters[predictorIndex(pc)]! >= this.takenFrom;
  }

  /**
   * Train `pc`'s counter on what the branch actually did — up on taken, down on not-taken, and
   * **saturating at both ends**.
   *
   * The clamps are the hysteresis, and they are not symmetric in what they buy. The CEILING is what
   * the flagship sequence exercises (a long run of taken branches parks a 2-bit counter at 3, so the
   * single `N` in `TTTTNTTTT` only weakens it to 2 and the next `T` is still right — the 1-bit
   * table has no such headroom, flips, and mispredicts twice). The FLOOR is invisible to that
   * sequence and to most of the corpus, but a counter allowed to go negative would drift below the
   * table's range and never come back — so it is pinned by its own case rather than by the flagship.
   */
  update(pc: number, actual: boolean): void {
    const i = predictorIndex(pc);
    const c = this.state.counters[i]!;
    this.state.counters[i] = actual ? Math.min(c + 1, this.max) : Math.max(c - 1, 0);
  }

  /**
   * The table, for recording into `MachineState.micro.predictor`.
   *
   * ⚠ **This returns the LIVE, single-buffered state — it is deliberately not a defensive copy, and
   * the deep copy is the RECORDER's job.** That is `micro.cache`'s contract verbatim
   * (`cache.ts`'s `CacheState` note, and the four models' own `micro.predictor` docblocks all say
   * "DEEP-COPY it into every snapshot"), and keeping it that way keeps the decision where an
   * implementer reads it — inside each model's `snapshotState()`, next to the cache's copy — rather
   * than hidden in a getter one package down. Copying here would make four docblocks false and
   * would dissolve the plan's step 4, which exists as its own step *with a break harness* because a
   * shallow snapshot is the defect this design is most likely to ship: every recorded cycle would
   * alias one mutable table, and scrubbing to cycle 0 would show the fully-TRAINED predictor.
   *
   * **Step 4 landed on the pipeline and the contract held** — `snapshotState` there does the
   * `.slice()`, and `dynamic-predict.test.ts` asserts distinctness on the recorded `.counters`. So
   * a caller who wants an independent table copies it; a caller who wants to WATCH the live one
   * (the replay helpers in that file, and the step-5 wiring sites) simply does not.
   */
  snapshot(): PredictorState {
    return this.state;
  }
}
