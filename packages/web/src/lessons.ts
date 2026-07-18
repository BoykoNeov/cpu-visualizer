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
 *
 * ## The TRACK is declared too, for the same reason (M5 step 4)
 *
 * The index groups its ids into tracks — the language, then the machine — and the picker shows
 * them. The tempting alternative was to derive the group from each lesson's `model`: today all six
 * language lessons are `single-cycle` and both µarch flagships are `pipeline`, so the split falls
 * out for free. **That is step 0's defect a third time.** `model` is a declaration about which
 * microarchitecture a lesson RUNS ON; "is this lesson about the language or about the machine" is a
 * claim about its SUBJECT. They coincide in today's library by coincidence, not by law — a language
 * lesson on the pipeline is perfectly lawful, and the day someone authors one, a group derived from
 * `model` files it under "The machine" and stays green. Same shape as `id.localeCompare` and as the
 * panel's opcode order: a view inventing pedagogy from a key whose job is something else.
 *
 * So track is content. Note what it is NOT: a `track` field on the `Lesson` type — that field is
 * pre-declined by the M5 plan's decision 2, and for the reason that applies here, one decision
 * belongs in one place rather than smeared across eight files.
 */

import type { Lesson } from '@cpu-viz/curriculum';
import { CACHE_LARGE, CACHE_SMALL } from '@cpu-viz/engine-pipeline';
import type { CacheConfig } from '@cpu-viz/trace';
import { cacheEquals } from './session';

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

/** One authored track: a picker heading and the lesson ids it teaches, first-taught first. */
export interface LessonTrack {
  /** The heading the picker shows, e.g. `The language`. */
  track: string;
  /** Lesson ids, in teaching order. */
  lessons: readonly string[];
}

/** The authored tracks, in teaching order (`content/lessons/index.json`). */
export const LESSON_TRACKS: readonly LessonTrack[] =
  (Object.entries(modules).find(([path]) => isOrderFile(path))?.[1] as LessonTrack[] | undefined) ??
  [];

/**
 * The authored teaching order — lesson ids, first-taught first.
 *
 * **Derived from the tracks by flattening, and that is the point of the grouped shape.** The order
 * and the grouping are one declaration read two ways, so they cannot contradict each other: there
 * is no way to author a lesson into "The machine" and have it sort among the language lessons. A
 * sibling file listing groups beside a flat order would have needed a third test to pin that the
 * two agree — a decision spread across two files is the shape decision 2 declines.
 */
export const LESSON_ORDER: readonly string[] = LESSON_TRACKS.flatMap((t) => [...t.lessons]);

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

/**
 * The three shipped cache geometries the shell's cache toggle can be in (`null` = off). The toggle
 * lights a position and {@link Simulator.setCache} guards its no-op by plain IDENTITY, both sound
 * only because the shell never holds a cache value that is not one of these. A lesson's declared
 * `config.cache`, though, arrives JSON-parsed — a fresh object equal in FIELDS but not by reference —
 * so it would light no position and misfire the guard (the M6 step-5 caveat pinned at `setCache`).
 */
const SHIPPED_CACHES: readonly (CacheConfig | null)[] = [null, CACHE_SMALL, CACHE_LARGE];

/**
 * Map a lesson's declared cache geometry back to the shipped CONSTANT it equals (M6 step 7's
 * reconcile). This is the "map a declared geometry to its canonical constant on the way in" option
 * the step-5 caveat named, done at the earliest boundary — lesson load — so the shell's identity
 * contract stays TRUE everywhere downstream rather than being swapped for a deep compare at every
 * `===`. A geometry matching no shipped constant is left as-is (it would light no toggle position,
 * which is the honest outcome for a geometry the shell has no control for — `lessons.test.ts` pins
 * that no SHIPPED lesson has one).
 */
function canonicalCache(cache: CacheConfig | null): CacheConfig | null {
  return SHIPPED_CACHES.find((known) => cacheEquals(known, cache)) ?? cache;
}

/** Replace a lesson's declared cache with its canonical constant (see {@link canonicalCache}). */
function canonicalize(lesson: Lesson): Lesson {
  if (lesson.config === undefined) return lesson;
  return { ...lesson, config: { ...lesson.config, cache: canonicalCache(lesson.config.cache) } };
}

/** The authored lessons, in the order `content/lessons/index.json` teaches them. */
export const LESSONS: readonly Lesson[] = orderLessons(
  Object.entries(modules)
    .filter(([path]) => !isOrderFile(path))
    .map(([, lesson]) => canonicalize(lesson as Lesson)),
  LESSON_ORDER,
);

/**
 * The heading an unlisted lesson is shown under — see {@link lessonSections}.
 *
 * It renders only when the index is wrong, which is the whole idea: a heading a reviewer was not
 * expecting is louder than a lesson quietly sitting last.
 */
export const UNTRACKED_HEADING = 'Not in a track';

/**
 * The lessons grouped for the picker: each authored track with its lessons resolved, empty tracks
 * dropped, **plus a trailing group for any lesson the index forgot.**
 *
 * That last clause is the load-bearing one, and it is step 0's totality rule re-earned rather than
 * inherited. `orderLessons` deliberately keeps an unlisted lesson (sorted last) because "content
 * that exists and nobody can reach" is the exact failure the index exists to end. Grouping breaks
 * that guarantee unless it is rebuilt HERE: a picker that renders only the authored tracks drops
 * a lesson belonging to none of them, silently and in the product — trading a misplaced lesson for
 * an invisible one, which is the trade step 0 refused.
 *
 * So the omission is surfaced instead of swallowed, and grouping makes it *louder* than the flat
 * list could: the flat picker showed an unlisted lesson last, indistinguishable from a lesson that
 * was authored to be last. Under a heading it is unmistakable. The suite still fails first — this
 * is the second net, not the first.
 */
export function lessonSections(
  lessons: readonly Lesson[] = LESSONS,
  tracks: readonly LessonTrack[] = LESSON_TRACKS,
): { track: string; lessons: Lesson[] }[] {
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const sections = tracks.map(({ track, lessons: ids }) => ({
    track,
    // An id with no lesson behind it is skipped rather than fabricated, matching `orderLessons`
    // and the ISA panel's `instructionSections`: the suite is where that failure gets named.
    lessons: ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])),
  }));
  const tracked = new Set(tracks.flatMap((t) => [...t.lessons]));
  const untracked = lessons.filter((l) => !tracked.has(l.id));
  return [
    ...sections,
    ...(untracked.length ? [{ track: UNTRACKED_HEADING, lessons: untracked }] : []),
  ].filter((s) => s.lessons.length > 0);
}
