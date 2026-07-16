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
      [
        'trace',
        'assembler',
        'curriculum',
        'engine-common',
        'engine-conformance',
        'engine-reference',
        'engine-single-cycle',
        'engine-multi-cycle',
        'engine-pipeline',
        'web',
      ],
      'INV-7: isa is the lowest layer and imports no other workspace package.',
    ),
  },
  {
    files: ['packages/trace/**/*.ts'],
    rules: deny(
      [
        'assembler',
        'curriculum',
        'engine-common',
        'engine-conformance',
        'engine-reference',
        'engine-single-cycle',
        'engine-multi-cycle',
        'engine-pipeline',
        'web',
      ],
      'INV-3: the trace is the contract; it may depend only on isa, never on engines, curriculum, or web.',
    ),
  },
  {
    files: ['packages/assembler/**/*.ts'],
    rules: deny(
      [
        'trace',
        'curriculum',
        'engine-common',
        'engine-conformance',
        'engine-reference',
        'engine-single-cycle',
        'engine-multi-cycle',
        'engine-pipeline',
        'web',
      ],
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
    // engine-common is a leaf shared by every model, so it must not depend on any engine model
    // (that would be a cycle). This deny list is a SUPERSET of the generic `packages/engine/**`
    // rule above: flat config is last-match-wins PER RULE ID with no array merge, so this object
    // fully replaces the generic one for these files — the curriculum/web entries must be repeated
    // here or engine-common would silently lose that guard.
    files: ['packages/engine/common/**/*.ts'],
    rules: deny(
      [
        'curriculum',
        'web',
        'engine-reference',
        'engine-single-cycle',
        'engine-multi-cycle',
        'engine-pipeline',
      ],
      'engine-common is a leaf shared by the engines (engine-common ← isa, assembler, trace); it depends on no engine model, curriculum, or web.',
    ),
  },
  {
    // The conformance harness (test-only) is parameterized over a Processor factory precisely so
    // it never imports an engine-under-test — coupling it to one model would defeat the design.
    // It MAY import the golden reference + engine-common. Superset of the generic engine rule
    // (same last-match-wins reason as engine-common), so curriculum/web are repeated here.
    files: ['packages/engine/conformance/**/*.ts'],
    rules: deny(
      ['curriculum', 'web', 'engine-single-cycle', 'engine-multi-cycle', 'engine-pipeline'],
      'engine-conformance is model-agnostic: it drives any model through an injected () => Processor factory, so it imports no engine-under-test.',
    ),
  },
  {
    // The golden reference must stay model-agnostic: it may not depend on a specific engine model.
    // (The reverse — single-cycle importing the reference for its INV-8 differential test — is
    // allowed, so this is scoped to `reference/**`, not all of `engine/**`.) Superset of the
    // generic engine rule for the same last-match-wins reason as engine-common above.
    files: ['packages/engine/reference/**/*.ts'],
    rules: deny(
      ['curriculum', 'web', 'engine-single-cycle', 'engine-multi-cycle', 'engine-pipeline'],
      'INV-8: the golden reference is model-agnostic; it never depends on a specific engine model (nor on curriculum/web).',
    ),
  },
  {
    // Cross-model isolation: each concrete model imports NO other model's production code — the
    // trace schema is their only shared surface (INV-2/INV-3). Supersets of the generic engine
    // rule (last-match-wins), so curriculum/web are repeated. Multi-cycle additionally may not
    // import the golden reference: it mirrors the ISA idioms verbatim rather than importing them
    // (INV-8 proves the copy is faithful); its differential test reaches the reference only
    // transitively through the model-agnostic conformance harness.
    files: ['packages/engine/single-cycle/**/*.ts'],
    rules: deny(
      ['curriculum', 'web', 'engine-multi-cycle', 'engine-pipeline'],
      'A concrete model never imports another model’s production code; the trace schema is the only shared surface.',
    ),
  },
  {
    files: ['packages/engine/multi-cycle/**/*.ts'],
    rules: deny(
      ['curriculum', 'web', 'engine-single-cycle', 'engine-pipeline', 'engine-reference'],
      'A concrete model never imports another model’s production code, and multi-cycle copies the ISA idioms rather than importing the reference (INV-8).',
    ),
  },
  {
    files: ['packages/engine/pipeline/**/*.ts'],
    rules: deny(
      ['curriculum', 'web', 'engine-single-cycle', 'engine-multi-cycle', 'engine-reference'],
      'A concrete model never imports another model’s production code, and the pipeline copies the ISA idioms rather than importing the reference (INV-8).',
    ),
  },
  {
    files: ['packages/curriculum/**/*.ts'],
    rules: deny(
      [
        'assembler',
        'engine-common',
        'engine-conformance',
        'engine-reference',
        'engine-single-cycle',
        'engine-multi-cycle',
        'engine-pipeline',
        'web',
      ],
      'INV-3: curriculum reads the trace, never engine internals or the web app.',
    ),
  },
);
