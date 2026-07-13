import { runConformance } from '@cpu-viz/engine-conformance';
import { MultiCycleProcessor } from './index';

/**
 * INV-8 for multi-cycle: final architectural state ≡ the golden reference on every example
 * program. This is where "varying cycle counts, identical final state" is PROVEN, not asserted —
 * multi-cycle emits several `CycleTrace`s per instruction, yet ends every corpus program in the
 * reference's exact register + memory + pc/halted state. The shared, model-independent
 * {@link runConformance} harness (`@cpu-viz/engine-conformance`) owns the corpus, the equality
 * contract, and the headline oracles; this file only names the model and supplies its factory.
 */
runConformance('multi-cycle', () => new MultiCycleProcessor());
