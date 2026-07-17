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
 * engine it declares and asserts no step is dead — the test IS the validator.
 *
 * Vite parses and inlines these at build time (`eager`); `server.fs.allow` lets the dev server
 * read them from outside this package (see `vite.config.ts`), matching `programs.ts`.
 *
 * ## The order is AUTHORED, and that is the whole of M5 step 0
 *
 * This module used to end `.sort((a, b) => a.id.localeCompare(b.id))`, so the picker offered a
 * beginner `array-in-memory` first — a memory lesson — and `sum-loop-tour`, the natural first
 * lesson, last. **A `localeCompare` is not an opinion about teaching; it is the absence of one,
 * wearing determinism as a disguise.**
 *
 * The ISA reference panel shipped and fixed the same class of defect one surface down this week:
 * its groups inherited `INSTRUCTIONS`' *opcode* order, so "Arithmetic" opened with `addi` above
 * `add` — a true fact about the encoding and a meaningless one to a learner. The lesson transfers
 * exactly, which is why this file changed rather than the picker: **there is no source for
 * pedagogical order, so it must be DECLARED — and declared in content, not computed in the view.**
 * `content/lessons/index.json` is that declaration. This module only reads it.
 */

import type { Lesson } from '@cpu-viz/curriculum';

/**
 * One glob, split by path. `index.json` sits in the lessons' own directory, so the `*.json`
 * pattern picks it up too and would otherwise cast an array of ids to a {@link Lesson} — a
 * step-less lesson, silently in the picker. Partitioning rather than excluding it with a negative
 * pattern keeps the single mechanism `programs.ts` already proves, and it is not merely the
 * tidier of two options: a direct `import` of the order file would need excluding it here anyway,
 * so the partition is what removes the problem rather than moving it.
 */
const modules = import.meta.glob('../../../content/lessons/*.json', {
  import: 'default',
  eager: true,
}) as Record<string, unknown>;

const isOrderFile = (path: string): boolean => path.endsWith('/index.json');

/** The authored teaching order — lesson ids, first-taught first (`content/lessons/index.json`). */
export const LESSON_ORDER: readonly string[] =
  (Object.entries(modules).find(([path]) => isOrderFile(path))?.[1] as string[] | undefined) ?? [];

/**
 * Sort lessons into the authored order.
 *
 * Exported as a PURE function because the sort is the one thing here that can go silently vacuous:
 * a mistake in it does not fail, it re-invents an order and leaves every test green. That is the
 * shape M3 step 0 named when it pulled `checkProgram`/`conformanceCases` out of the conformance
 * harness — extract what could quietly stop meaning anything, so it can be asserted directly
 * against synthetic input rather than only through the shipped content that happens to be right.
 *
 * **The index controls ORDER ONLY: it cannot make a lesson vanish.** An unlisted lesson sorts last
 * rather than being dropped, because dropping is a worse instance of the very failure this step
 * exists to end — content that exists and nobody can reach — and unlike a misplaced lesson, a
 * missing one is invisible in the product. Staying total is this function's job; making the
 * omission loud is the exhaustiveness test's.
 */
export function orderLessons<T extends { id: string }>(
  lessons: readonly T[],
  order: readonly string[],
): T[] {
  // `indexOf` gives -1 for an unlisted lesson, mapped to a finite rank PAST every listed one.
  // Deliberately not `Infinity`: two unlisted lessons would then compare `Infinity - Infinity`,
  // and a NaN comparator is an unspecified order — the exact bug this module is about.
  const rank = (id: string): number => {
    const at = order.indexOf(id);
    return at === -1 ? order.length : at;
  };
  return [...lessons].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

/** The authored lessons, in the order `content/lessons/index.json` teaches them. */
export const LESSONS: readonly Lesson[] = orderLessons(
  Object.entries(modules)
    .filter(([path]) => !isOrderFile(path))
    .map(([, lesson]) => lesson as Lesson),
  LESSON_ORDER,
);
