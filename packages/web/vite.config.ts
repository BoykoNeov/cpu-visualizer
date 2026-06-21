import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Resolve `@cpu-viz/*` workspace imports to source (mirrors vitest.config.ts). */
const pkg = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@cpu-viz/isa': pkg('../isa/src/index.ts'),
      '@cpu-viz/trace': pkg('../trace/src/index.ts'),
      '@cpu-viz/assembler': pkg('../assembler/src/index.ts'),
      '@cpu-viz/curriculum': pkg('../curriculum/src/index.ts'),
      '@cpu-viz/engine-reference': pkg('../engine/reference/src/index.ts'),
      '@cpu-viz/engine-single-cycle': pkg('../engine/single-cycle/src/index.ts'),
    },
  },
});
