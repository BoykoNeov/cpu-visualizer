import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Resolve `@cpu-viz/*` workspace imports to source (mirrors vitest.config.ts). */
const pkg = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // The example programs live at the repo root (`content/programs/*.s`), outside this
  // package. Eager `import.meta.glob` inlines them at build time, but the dev server
  // must also be allowed to read from the repo root.
  server: { fs: { allow: ['../..'] } },
  resolve: {
    alias: {
      '@cpu-viz/isa': pkg('../isa/src/index.ts'),
      '@cpu-viz/trace': pkg('../trace/src/index.ts'),
      '@cpu-viz/assembler': pkg('../assembler/src/index.ts'),
      '@cpu-viz/curriculum': pkg('../curriculum/src/index.ts'),
      '@cpu-viz/engine-common': pkg('../engine/common/src/index.ts'),
      '@cpu-viz/engine-reference': pkg('../engine/reference/src/index.ts'),
      '@cpu-viz/engine-single-cycle': pkg('../engine/single-cycle/src/index.ts'),
      '@cpu-viz/engine-multi-cycle': pkg('../engine/multi-cycle/src/index.ts'),
      // Added M7 step 6, and it was MISSING rather than deliberately absent: without it the dev
      // server resolves the pipeline through the workspace symlink to `dist/index.js`, so the
      // browser ran the last BUILT pipeline instead of the source on disk — a stale `dist` would
      // have quietly shown a picture that no longer matched the code. The comment above already
      // claimed this list mirrors vitest.config.ts; now it does.
      '@cpu-viz/engine-pipeline': pkg('../engine/pipeline/src/index.ts'),
      '@cpu-viz/engine-superscalar': pkg('../engine/superscalar/src/index.ts'),
    },
  },
});
