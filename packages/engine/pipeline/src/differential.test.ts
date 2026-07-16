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

const FORWARDING_OFF: ProcessorConfig = { ...defaultConfig(), forwarding: false };
const FORWARDING_ON: ProcessorConfig = { ...defaultConfig(), forwarding: true };

runConformance('pipeline', () => new PipelineProcessor(), [FORWARDING_OFF, FORWARDING_ON]);
