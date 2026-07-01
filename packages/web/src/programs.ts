/**
 * The example-program library, loaded from the real corpus at the repo root
 * (`content/programs/*.s`) — one corpus, three jobs (handoff §9): differential fixture,
 * free-play library, and lesson fixture. Globbing the real `.s` files (rather than
 * duplicating them here) keeps the "one ISA, one example-program library" invariant (INV-7):
 * the web shell runs exactly the programs the differential tests prove.
 *
 * Vite inlines these at build time (`eager`, `?raw`); `server.fs.allow` lets the dev server
 * read them from outside this package (see `vite.config.ts`).
 */

const sources = import.meta.glob('../../../content/programs/*.s', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** One selectable example program: a display name and its assembly source text. */
export interface ExampleProgram {
  /** The file's base name without extension, e.g. `sum-loop`. */
  name: string;
  /** The raw assembly source, shown in the source panel and fed to the assembler. */
  source: string;
}

/** The example programs, sorted by name for a stable picker order. */
export const EXAMPLE_PROGRAMS: readonly ExampleProgram[] = Object.entries(sources)
  .map(([path, source]) => ({
    name: path.replace(/^.*\/([^/]+)\.s$/, '$1'),
    source,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
