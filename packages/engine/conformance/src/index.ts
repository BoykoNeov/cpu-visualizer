/**
 * `@cpu-viz/engine-conformance` — the shared, test-only INV-8 differential harness. Every model
 * proves final-state equivalence to the golden reference through the same {@link runConformance}
 * entry point, over the same example corpus (INV-7). Test-only: nothing ships it; it is consumed
 * by each engine's `differential.test.ts`.
 */

export { runConformance } from './conformance';
