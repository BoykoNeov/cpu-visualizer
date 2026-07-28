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
};

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    include: ['packages/**/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    /**
     * Vitest's 5 s default is the one non-deterministic thing in an otherwise pure suite, and M13
     * step 8's break pass caught it flaking: `datapath-superscalar.test.ts`'s `throughBox` litmus
     * runs ~2 s alone and was measured at **6.4 s under a loaded full run**, failing as a TIMEOUT
     * on a deliberate break that touched a different package entirely. A wall-clock red herring in
     * the middle of a break measurement is worse than a slow test.
     *
     * Raising it does not weaken the liveness net, which is the objection to check before doing
     * this: non-termination here is caught by CYCLE bounds, not by the clock — `halt-shadow.test.ts`
     * sweeps at 500 cycles and `Recorder.runToEnd` caps at 1 000 000 — so a hung machine still
     * fails as a hung machine. What this removes is only the machine-speed dependence.
     */
    testTimeout: 30_000,
  },
});
