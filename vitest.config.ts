import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Resolve every `@cpu-viz/*` workspace import to its TypeScript source so tests (and Vite
 * dev/build, which reuses these aliases) run against `src` directly — no pre-build of
 * library `dist` required. `tsc -b` is what validates the emitted types and the project
 * reference DAG; Vite/Vitest only need the source.
 */
const pkg = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export const workspaceAliases = {
  '@cpu-viz/isa': pkg('./packages/isa/src/index.ts'),
  '@cpu-viz/trace': pkg('./packages/trace/src/index.ts'),
  '@cpu-viz/assembler': pkg('./packages/assembler/src/index.ts'),
  '@cpu-viz/curriculum': pkg('./packages/curriculum/src/index.ts'),
  '@cpu-viz/engine-common': pkg('./packages/engine/common/src/index.ts'),
  '@cpu-viz/engine-conformance': pkg('./packages/engine/conformance/src/index.ts'),
  '@cpu-viz/engine-reference': pkg('./packages/engine/reference/src/index.ts'),
  '@cpu-viz/engine-single-cycle': pkg('./packages/engine/single-cycle/src/index.ts'),
  '@cpu-viz/engine-multi-cycle': pkg('./packages/engine/multi-cycle/src/index.ts'),
  '@cpu-viz/engine-pipeline': pkg('./packages/engine/pipeline/src/index.ts'),
  '@cpu-viz/engine-deep-pipeline': pkg('./packages/engine/deep-pipeline/src/index.ts'),
  '@cpu-viz/engine-superscalar': pkg('./packages/engine/superscalar/src/index.ts'),
  '@cpu-viz/engine-out-of-order': pkg('./packages/engine/out-of-order/src/index.ts'),
  '@cpu-viz/engine-scoreboard': pkg('./packages/engine/scoreboard/src/index.ts'),
};

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    include: ['packages/**/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    /**
     * Vitest's 5 s default is the one non-deterministic thing in an otherwise pure suite, and M13
     * step 8's break pass caught it flaking — on a deliberate break that touched a different
     * PACKAGE entirely, which is a wall-clock red herring in the middle of a measurement.
     *
     * **Re-provoked deliberately rather than left as an inference, and the first reading was wrong
     * in two ways.** Five full runs at the 5 s default: one failed, so the flake rate is ~20%, not a
     * one-off. Its captured error text is `Test timed out in 5000ms.` — so "timeout" is now READ
     * rather than deduced from a duration. And it is not ONE slow test but four, all of them
     * width-4 geometry sweeps: `throughBox` at **17.3 s** against a ~2 s median, the collinearity
     * litmus at 9.0 s, and two `activation coherence` sweeps at 6.3 s and 8.0 s. The first draft of
     * this comment said 6.4 s and named one test; both numbers came from a single observation.
     *
     * 60 s is ~3.5× the worst measured, chosen after that correction — 30 s would have left 1.7×
     * headroom over a value already 8× its own median.
     *
     * Raising it does not weaken the liveness net, which is the objection to check before doing
     * this: non-termination here is caught by CYCLE bounds, not by the clock — `halt-shadow.test.ts`
     * sweeps at 500 cycles and `Recorder.runToEnd` caps at 1 000 000 — so a hung machine still
     * fails as a hung machine. What this removes is only the machine-speed dependence.
     */
    testTimeout: 60_000,
  },
});
