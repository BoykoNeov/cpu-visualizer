/**
 * What the shell is currently showing, as a tagged union — the single source of truth for the
 * three modes the user can be in. Kept as pure data (no React, no engine) so the fork
 * transition (the spec §13 "edits fork into a sandbox") is unit-testable headlessly, the way
 * the rest of the platform/content split keeps its logic testable off the UI.
 *
 *  - `example`  free-play on a corpus program; no lesson attached (§13 free-play = program +
 *               model + config, no lesson steps).
 *  - `lesson`   following an authored lesson; its event-anchored steps are "attached".
 *  - `sandbox`  a user-edited program; no lesson — annotations have DETACHED (§13). `origin`
 *               records the program the edit forked from so the editor can offer a revert.
 */

import type { Lesson } from '@cpu-viz/curriculum';

export type Session =
  | { kind: 'example'; programName: string }
  | { kind: 'lesson'; programName: string; lesson: Lesson }
  | { kind: 'sandbox'; origin: string | null };

/** Free-play on a corpus program by name. */
export function exampleSession(programName: string): Session {
  return { kind: 'example', programName };
}

/** Follow an authored lesson (loads its referenced program; the steps are attached). */
export function lessonSession(lesson: Lesson): Session {
  return { kind: 'lesson', programName: lesson.program, lesson };
}

/**
 * Fork the current session into a sandbox on a program edit (§13). The lesson's
 * event-anchored annotations DETACH — a sandbox has no lesson — but the lesson is not
 * destroyed; it can be resumed by re-selecting it on the original program. `origin` carries
 * the program the edit forked from (a lesson's program, an example's name, or a prior
 * sandbox's origin) so the editor can offer "revert to original".
 */
export function forkToSandbox(prev: Session | null): Session {
  const origin = prev === null ? null : prev.kind === 'sandbox' ? prev.origin : prev.programName;
  return { kind: 'sandbox', origin };
}

/** The lesson whose steps are attached, or `null` in free-play / sandbox (detached). */
export function activeLessonOf(session: Session | null): Lesson | null {
  return session?.kind === 'lesson' ? session.lesson : null;
}

/**
 * The corpus program name backing the session: the selected program in example/lesson mode, or
 * the program a sandbox forked from. Used for the editor's revert baseline and the picker's
 * highlight. `null` before the first load, or for a sandbox with no known origin.
 */
export function originNameOf(session: Session | null): string | null {
  if (session === null) return null;
  return session.kind === 'sandbox' ? session.origin : session.programName;
}
