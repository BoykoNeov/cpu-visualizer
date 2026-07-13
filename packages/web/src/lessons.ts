/**
 * The authored lesson library, loaded from the real content root
 * (`content/lessons/*.json`) — the platform/content split (spec §13): lessons are declarative
 * DATA the engine does not compile against. Globbing the real JSON (rather than duplicating it
 * here) keeps the "one example-program library" invariant (INV-7): the lessons the web shell
 * plays are the same files the curriculum runner is tested against.
 *
 * These are UNTRUSTED at compile time (JSON, cast to {@link Lesson}); a typo in an `event`,
 * `where`, or tier key would fail silently at run time. That type-safety is bought back by the
 * real-engine integration test (`lessons.test.ts`), which anchors every lesson against the
 * single-cycle engine and asserts no step is dead — the test IS the validator.
 *
 * Vite parses and inlines these at build time (`eager`); `server.fs.allow` lets the dev server
 * read them from outside this package (see `vite.config.ts`), matching `programs.ts`.
 */

import type { Lesson } from '@cpu-viz/curriculum';

const modules = import.meta.glob('../../../content/lessons/*.json', {
  import: 'default',
  eager: true,
}) as Record<string, Lesson>;

/** The authored lessons, sorted by id for a stable order. */
export const LESSONS: readonly Lesson[] = Object.values(modules).sort((a, b) =>
  a.id.localeCompare(b.id),
);
