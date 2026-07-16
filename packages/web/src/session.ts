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
import type { ProcessorConfig } from '@cpu-viz/trace';

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
  /** The branch-prediction scheme to record in (M4 step 4). */
  branchPrediction: BranchPrediction;
}

/**
 * The branch-prediction scheme, named off the config rather than re-declared — one union, in the
 * schema that owns it. Three names; the pipeline gives them **two behaviors** (`'none'` and
 * `'static-not-taken'` are one machine, M4 step 1), which is why {@link predictsTaken} exists and
 * why the shell's control has two positions rather than three.
 */
export type BranchPrediction = ProcessorConfig['branchPrediction'];

/**
 * Does this scheme bet that a branch is TAKEN? The shell's whole reading of the knob, in one
 * place, because it decides two things that must agree: which position of the control is lit, and
 * whether {@link Simulator.setBranchPrediction} has anything to re-record.
 *
 * **Why a predicate and not value-equality.** `'none'` and `'static-not-taken'` are the same
 * machine, so a control whose "not taken" position is lit for BOTH is telling the truth — but a
 * no-op guard written as `next === current` would not know that, and clicking the already-lit "not
 * taken" button while the config still reads `'none'` (which is what `defaultConfig()` opens on)
 * would re-record a byte-identical trace and dump the cursor back to pre-run. A visible cursor
 * loss from clicking a lit button. The guard is on the BEHAVIOR; so is the highlight.
 *
 * This is a view-local rule about the shell's control, not a re-statement of engine internals
 * (INV-3) — its justification is a measured engine fact, pinned in `simulator.test.ts`: the three
 * schemes produce exactly TWO distinct recordings, so two positions cover the machine. If a
 * dynamic scheme ever joins the union, that test fails and forces the control to grow a position
 * rather than silently classifying the newcomer as "not taken".
 */
export function predictsTaken(scheme: BranchPrediction): boolean {
  return scheme === 'static-taken';
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
 *  - **`config` is honored only when DECLARED, per KNOB.** The config position is session-level and
 *    persists across model switches (M3 step 5). A lesson with no opinion about a knob — single-
 *    cycle ignores them entirely — must not silently reset a position the user chose, so
 *    `undefined` means "leave it alone", not "fall back to the default".
 *
 * **The per-KNOB reading is M4 step 4's, and the type could not express it before** (see
 * `Lesson.config`). While `forwarding` was the only honored knob, "declared a config" and "has an
 * opinion about forwarding" were the same statement, so this function could not tell which rule it
 * was implementing. A second knob separates them: `forwarding-bubble` declares `forwarding: false`
 * as a real decision and has no opinion at all about prediction, so starting it must leave a
 * prediction the user chose exactly where it is. `Partial<ProcessorConfig>` is what lets `??` mean
 * what it reads like — before it, a lesson that declared any config declared every knob, and the
 * fallback below was dead code wearing the look of a rule.
 *
 * This is the OPENING position only. The picker and both toggles stay live afterwards, so the
 * cross-model degradation stays reachable, and flipping forwarding mid-lesson — the whole point of
 * `forwarding-bubble` — re-records and re-anchors underneath the lesson (INV-6).
 */
export function lessonOpening(
  lesson: Lesson,
  current: { forwarding: boolean; branchPrediction: BranchPrediction },
): LessonOpening {
  return {
    modelId: lesson.model,
    forwarding: lesson.config?.forwarding ?? current.forwarding,
    branchPrediction: lesson.config?.branchPrediction ?? current.branchPrediction,
  };
}
