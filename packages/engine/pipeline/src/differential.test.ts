import { runConformance } from '@cpu-viz/engine-conformance';
import { defaultConfig, type ProcessorConfig } from '@cpu-viz/trace';
import { PipelineProcessor } from './index';

/**
 * INV-8 for the pipeline: final architectural state ≡ the golden reference on every example
 * program, under BOTH forwarding positions. This is the first model where running the corpus once
 * would not be enough — the pipeline's behavior genuinely depends on its config, so a single
 * neutral run would prove it correct with forwarding off and say nothing at all about the other
 * position. M3 step 0 is what taught the harness to see both.
 *
 * Note what this net can and cannot catch, because it is the whole reason step 3 exists:
 * conformance is **blind to timing**. It compares only final state, so it catches under-forwarding
 * and under-stalling (read a stale register, get a wrong answer, get caught) but a pipeline that
 * merely OVER-stalls — one that ignored `forwarding: true` and interlocked on every RAW — would
 * produce exactly the right answer and pass this suite silently. The forwarding toggle's entire
 * observable effect lives in that blind spot.
 */

/**
 * M4 extends this to the full cross product: 2 forwarding positions × 3 prediction schemes × 5
 * programs = 30 cases. The cost is trivial and the interaction is exactly where a bug would hide —
 * a squash and a forward reaching for the same cycle.
 *
 * **This matrix is expected to be green the moment prediction is honored, and that is its entire
 * point.** Speculation is architecturally invisible BY CONSTRUCTION: wrong-path instructions are
 * killed before MEM, so they never store and never write back, and a machine that guesses well and
 * a machine that guesses badly must agree on every register and every byte. The scheme changes only
 * WHEN the right answer arrives, never WHAT it is. So a red cell here would not mean "the predictor
 * is slow" — it would mean speculation is LEAKING, which is the one bug prediction could introduce
 * that the timing suite could never see.
 *
 * The corollary is the same blind spot M3 step 3 was built for, one level worse: since a correct
 * predictor cannot move these numbers, **conformance says nothing whatever about whether
 * `branchPrediction` is honored at all.** A pipeline that ignored the knob entirely passes all 30.
 * The toggle's whole observable effect is timing, and `timing.test.ts` is the net for it.
 */
const SCHEMES = ['none', 'static-not-taken', 'static-taken'] as const;
const CONFIGS: ProcessorConfig[] = [false, true].flatMap((forwarding) =>
  SCHEMES.map((branchPrediction) => ({ ...defaultConfig(), forwarding, branchPrediction })),
);

runConformance('pipeline', () => new PipelineProcessor(), CONFIGS);
