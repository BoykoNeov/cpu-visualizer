// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Encode the package dependency DAG (handoff §14, INV-2/INV-3/INV-7) as lint errors.
 *
 * The trace schema is the ONLY shared surface between the engine and the rest of the
 * system. These rules make "engine has zero imports from web/curriculum" a mechanical
 * guarantee rather than a review discipline. The `@typescript-eslint` variant is used
 * (not the core rule) so it also catches `import type` boundary violations.
 *
 * @param {string[]} names workspace package suffixes (after `@cpu-viz/`) to forbid
 * @param {string} message explanation surfaced when the rule fires
 */
function deny(names, message) {
  return {
    'no-restricted-imports': 'off',
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        patterns: names.map((n) => ({
          group: [`@cpu-viz/${n}`, `@cpu-viz/${n}/*`],
          message,
        })),
      },
    ],
  };
}

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-tsc/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // --- Dependency boundaries (the DAG) ---
  {
    files: ['packages/isa/**/*.ts'],
    rules: deny(
      ['trace', 'assembler', 'curriculum', 'engine-reference', 'engine-single-cycle', 'web'],
      'INV-7: isa is the lowest layer and imports no other workspace package.',
    ),
  },
  {
    files: ['packages/trace/**/*.ts'],
    rules: deny(
      ['assembler', 'curriculum', 'engine-reference', 'engine-single-cycle', 'web'],
      'INV-3: the trace is the contract; it may depend only on isa, never on engines, curriculum, or web.',
    ),
  },
  {
    files: ['packages/assembler/**/*.ts'],
    rules: deny(
      ['trace', 'curriculum', 'engine-reference', 'engine-single-cycle', 'web'],
      'The assembler depends only on isa.',
    ),
  },
  {
    files: ['packages/engine/**/*.ts'],
    rules: deny(
      ['curriculum', 'web'],
      'INV-2/INV-3: engines are oblivious to rendering and curriculum; they communicate only through the trace.',
    ),
  },
  {
    // The golden reference must stay model-agnostic: it may not depend on a specific engine model.
    // (The reverse — single-cycle importing the reference for its INV-8 differential test — is
    // allowed, so this is scoped to `reference/**`, not all of `engine/**`.)
    files: ['packages/engine/reference/**/*.ts'],
    rules: deny(
      ['engine-single-cycle'],
      'INV-8: the golden reference is model-agnostic; it never depends on a specific engine model.',
    ),
  },
  {
    files: ['packages/curriculum/**/*.ts'],
    rules: deny(
      ['assembler', 'engine-reference', 'engine-single-cycle', 'web'],
      'INV-3: curriculum reads the trace, never engine internals or the web app.',
    ),
  },
);
