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
  '@cpu-viz/engine-reference': pkg('./packages/engine/reference/src/index.ts'),
  '@cpu-viz/engine-single-cycle': pkg('./packages/engine/single-cycle/src/index.ts'),
};

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    include: ['packages/**/src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
