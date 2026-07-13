import { runConformance } from '@cpu-viz/engine-conformance';
import { SingleCycleProcessor } from './index';

/**
 * INV-8 for single-cycle: final architectural state ≡ the golden reference on every example
 * program. All the machinery — corpus enumeration, the equality contract, the hand-computed
 * headline oracles — lives in the shared, model-independent {@link runConformance} harness
 * (`@cpu-viz/engine-conformance`); this file only names the model and supplies its factory.
 */
runConformance('single-cycle', () => new SingleCycleProcessor());
