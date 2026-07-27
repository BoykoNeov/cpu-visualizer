import { runConformance } from '@cpu-viz/engine-conformance';
import { defaultConfig, type ProcessorConfig } from '@cpu-viz/trace';
import { DeepPipelineProcessor } from './index';

/**
 * INV-8 for the deep pipeline (M11 step 2): final architectural state ≡ the golden reference on
 * every example program, across the full forwarding × prediction cross product.
 *
 * ## What this suite genuinely catches — and it is one thing
 *
 * Step 1 is a **FORK** of `engine/pipeline/src/processor.ts`, and a fork is a COPY. The ISA
 * semantics in `processor.ts` are mirrored from the golden reference and deliberately NOT imported
 * from it (`eslint.config.js` denies both edges by name: a model imports neither a sibling model nor
 * the reference), because INV-8's whole design is that the differential PROVES the copy faithful.
 * A dropped `>>> 0`, a `>>` where the reference has `>>>`, a missing `imm & 0x1f` on a shift, a
 * sign-extension lost in transcription — those are caught **here and nowhere else**. That is a
 * sharper job than the same suite does for a from-scratch model, because transcription errors are
 * the characteristic failure of the way this file's subject was built.
 *
 * It also catches the two hazard bugs a machine with a longer shadow can introduce: an
 * **under-stall** (a consumer reading a register the producer has not written back yet, now with
 * two execute stages and a wider window in which to be wrong) and a **speculation leak** (a
 * wrong-path instruction surviving far enough to store or write back — the flush here kills four
 * slots where the 5-stage kills two, so there is more to get wrong).
 *
 * ## What this suite proves about DEPTH: nothing. Step 3 is the net.
 *
 * Stated in prose because an acceptance line that overstates its own coverage is exactly how the
 * inert-package failure ships (M10 step 0 found `slowOpLatency` shipped INERT — a config field with
 * no engine consumer — behind suites that were all green). **An in-order 7-stage retires in order**,
 * so this matrix would run green with IF2 and EX2 as pure pass-throughs: the milestone's whole
 * characteristic failure — *a `deep-pipeline` package that typechecks, passes INV-8, renders on the
 * map, and is a 5-stage wearing seven labels* — lives entirely inside this suite's blind spot.
 * Every observable consequence of the depth is TIMING: the ALU→ALU bubble that forwarding cannot
 * remove, the two-bubble load-use, the width-4 misprediction total, the drain `N+6`. None of them
 * move a register or a byte.
 *
 * **`timing.test.ts` (step 3) is the net, and it carries the mutation check** that makes the
 * distinction mechanical rather than argued: stubbing IF2/EX2 to pass-through must leave THIS suite
 * green while that one reddens. If INV-8 is the only thing that reddens, the net is in the wrong
 * place.
 *
 * ## Why the matrix is 6 cases and not the house 18
 *
 * The cache axis is absent **BY REFUSAL, not by omission** — do not "restore" it to match the
 * pipeline's (2 × 3 × 3 = 18) or the superscalar's (36). `reset()` THROWS on a non-null `cache`
 * (pinned at `processor.test.ts`'s "refuses a cache config by name"), because M6's miss-freeze holds
 * IF/ID/EX and which of IF1/IF2/EX1/EX2 freeze is an unpinned choice that **M11 step 6** owns.
 * Adding `CACHE_SMALL` here would produce thrown Errors, not red assertions — a failure mode that
 * reads as a broken suite rather than as the deliberate scope lever it is. When step 6 pins the
 * seam, this matrix grows the third axis and the throw goes away together.
 */

/**
 * All three prediction schemes run, though **`'none'` and `'static-not-taken'` are the SAME MACHINE
 * here** — a processor with no predictor does not stop and wait, it keeps fetching the next address,
 * and the fall-through IS the not-taken guess (the same identity the 5-stage has, recorded on
 * `DEEP_PIPELINE_CAPABILITIES`). The redundant column is kept rather than trimmed: it costs one
 * corpus pass, `configLabel` names the two distinctly so there is no title collision to hide behind,
 * and pinning the identity is worth more than the second saved. Two identical green columns here are
 * the expected reading, not a bug.
 */
const SCHEMES = ['none', 'static-not-taken', 'static-taken'] as const;

/**
 * `cache: null` is written EXPLICITLY rather than inherited from `defaultConfig()`. Every other
 * model's matrix can afford to inherit a default it does not care about; this is the one suite in
 * the repo where the field is load-bearing in the negative — the processor REFUSES a non-null cache,
 * so a future change to `defaultConfig()`'s default would turn six green cases into six thrown
 * Errors rather than into a silent behaviour shift. Naming the field makes this matrix say what it
 * means independently of that default.
 */
const CONFIGS: ProcessorConfig[] = [false, true].flatMap((forwarding) =>
  SCHEMES.map((branchPrediction) => ({
    ...defaultConfig(),
    forwarding,
    branchPrediction,
    cache: null,
  })),
);

runConformance('deep-pipeline', () => new DeepPipelineProcessor(), CONFIGS);
