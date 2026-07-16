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

/** The microarchitecture + config position a lesson should OPEN in. */
export interface LessonOpening {
  /** The model id to drive the lesson under — the one it was authored against. */
  modelId: string;
  /** The forwarding position to record in. */
  forwarding: boolean;
}

/**
 * What starting a lesson does to the shell's model + config (M3 step 8). Extracted here as pure
 * data — no React, no engine — for the same reason the rest of this module is: `useSimulator` is a
 * thin imperative wrapper, and this is a real decision that deserves a test rather than an inline
 * `if` inside a hook.
 *
 * `Lesson.model` and `Lesson.config` were both declared-and-ignored until M3 step 8: `startLesson`
 * loaded a lesson's program under whatever the picker happened to be set to. That was harmless
 * while every lesson targeted single-cycle and anchored to purely architectural events, and it is
 * wrong the moment a lesson is ABOUT a microarchitecture — `forwarding-bubble`'s subject is stalls,
 * and single-cycle has none, so all but its first and last step would be dead on arrival.
 *
 * Two rules, and the asymmetry between them is the point:
 *
 *  - **`model` is always honored.** It is a required field and a lesson's narration is prose
 *    written about one machine. `sum-loop-tour` says its add is "written back to a0 in the same
 *    cycle" — true on single-cycle, false on multi-cycle and false on the pipeline. A lesson's
 *    ANCHORS survive a model swap (INV-6, and `lessons.test.ts` proves it); its WORDS do not.
 *    Anchoring is not truth, so a lesson opens on the model it was written for.
 *  - **`config` is honored only when DECLARED.** The forwarding position is session-level and
 *    persists across model switches (M3 step 5). A lesson with no opinion about forwarding —
 *    single-cycle ignores the knob entirely — must not silently reset a position the user chose,
 *    so `undefined` means "leave it alone", not "fall back to the default".
 *
 * This is the OPENING position only. The picker and the toggle stay live afterwards, so the
 * cross-model degradation stays reachable, and flipping forwarding mid-lesson — the whole point of
 * `forwarding-bubble` — re-records and re-anchors underneath the lesson (INV-6).
 */
export function lessonOpening(lesson: Lesson, current: { forwarding: boolean }): LessonOpening {
  return {
    modelId: lesson.model,
    forwarding: lesson.config?.forwarding ?? current.forwarding,
  };
}
