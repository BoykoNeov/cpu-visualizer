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
  /** The cache geometry to record in, or `null` for no D-cache (M6 step 5). */
  cache: ProcessorConfig['cache'];
  /**
   * The issue width to record at (M7 step 6) — 1 or 2. **Always a number here, even though
   * `ProcessorConfig.issueWidth` is optional**: a lesson that declares a config but no width means
   * width 1, which is what the engine itself reads it as (`config.issueWidth ?? 1`). Keeping the
   * opening total rather than optional is what stops "honored WHOLE" from quietly acquiring an
   * exception — see {@link lessonOpening}.
   */
  issueWidth: number;
  /**
   * Whether to record with out-of-order issue (M9 step 5), the flagship toggle. Total here for the
   * same reason as {@link issueWidth}: `ProcessorConfig.outOfOrderIssue` is optional and the engine
   * reads its absence as `false` (`config.outOfOrderIssue ?? false`), so a declared config that omits
   * it MEANS in-order — never "leave the user's position untouched" (the per-knob leak M4 step 4
   * caught). M9 lessons are a future milestone (M10), so no lesson declares it yet; the rule is
   * threaded now so it is right before one does.
   */
  outOfOrderIssue: boolean;
  /**
   * The ROB size to record at (M9 step 5) — the secondary structural lever. Total for the same
   * reason as {@link issueWidth}: `ProcessorConfig.robSize` is optional and the engine reads its
   * absence as 16 (`config.robSize ?? 16`), so a declared config that omits it MEANS 16.
   */
  robSize: number;
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
 * Deep value-equality of two cache geometries (M6 step 7). The cache is the shell's first
 * OBJECT-valued knob, so "is this the same machine" cannot be a `===`: a geometry that arrives
 * JSON-parsed (a lesson's declared `config.cache`) is a fresh object, referentially unequal to the
 * shipped `CACHE_SMALL` / `CACHE_LARGE` constants even when its fields are identical.
 *
 * **Why this exists rather than just deep-comparing everywhere.** The shell's identity contract —
 * "`cache` is always one of the three shipped constants, so a lit toggle position and
 * {@link Simulator.setCache}'s no-op guard are plain `===`" — is worth KEEPING, not abandoning. So
 * a declared geometry is mapped back to its canonical constant at the one boundary a foreign object
 * can enter, when a lesson is loaded (`canonicalCache` in `lessons.ts`). This predicate is the
 * comparison that mapping uses; it mirrors conformance's `cacheEquals` (M6 step 3), which is the
 * differential harness's and lives below the web layer, so re-declaring the three-field compare here
 * is cheaper than importing a test package. Pure and engine-free like the rest of this module.
 */
export function cacheEquals(a: ProcessorConfig['cache'], b: ProcessorConfig['cache']): boolean {
  if (a === null || b === null) return a === b;
  return a.lineSize === b.lineSize && a.numLines === b.numLines && a.missPenalty === b.missPenalty;
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
 *  - **`config` is honored only when DECLARED, and then WHOLE.** The config position is session-
 *    level and persists across model switches (M3 step 5). A lesson with no opinion about the
 *    machine — a single-cycle lesson, since that model ignores every knob — must not silently reset
 *    a position the user chose, so an absent `config` means "leave it alone", not "fall back to the
 *    default". A DECLARED config, though, is honored down to the last knob.
 *
 * **M4 step 4 tried to make this per-knob and the browser said no.** The seductive reading: a
 * lesson is about one knob, so it should declare that one and leave the rest to the user. Applied
 * to `forwarding-bubble` — a lesson about forwarding — it dropped the prediction declaration, and
 * the shell duly parked a user on `static-taken` with the lesson's own closing prose reading "51
 * cycles" above a transport reading 49. A lesson's SUBJECT and the machine its PROSE depends on are
 * different, and only the second decides what to declare. See `Lesson.config` for the full account;
 * the short version is that a lesson is a controlled experiment, `config` names the controls, and
 * you cannot control a variable you did not declare.
 *
 * This is the OPENING position only. The picker and both toggles stay live afterwards, so the
 * cross-model degradation stays reachable, and flipping forwarding mid-lesson — the whole point of
 * `forwarding-bubble` — re-records and re-anchors underneath the lesson (INV-6). Flipping
 * PREDICTION mid-lesson is the same kind of reachable degradation, off the invited path: the steps
 * still anchor (`lessons.test.ts` sweeps all four positions), but a narration that quotes cycle
 * counts is quoting the machine it opened on.
 */
export function lessonOpening(
  lesson: Lesson,
  current: {
    forwarding: boolean;
    branchPrediction: BranchPrediction;
    cache: ProcessorConfig['cache'];
    issueWidth: number;
    outOfOrderIssue: boolean;
    robSize: number;
  },
): LessonOpening {
  // All-or-nothing, spelled as all-or-nothing. A `??` per knob would read like a per-knob rule and
  // behave like this one — the type makes a declared config total — which is the shape that hid the
  // question until a second knob existed. The cache joins as a THIRD knob under the same rule
  // (M6 step 5): a lesson that declares a config controls its cache too, whole; one that declares
  // none leaves whatever the user set — a single-cycle lesson must not silently clear a cache the
  // user is running any more than it clears their forwarding position.
  if (lesson.config === undefined) return { modelId: lesson.model, ...current };
  return {
    modelId: lesson.model,
    forwarding: lesson.config.forwarding,
    branchPrediction: lesson.config.branchPrediction,
    cache: lesson.config.cache,
    // The FOURTH knob (M7 step 6), and the first one the config type makes OPTIONAL — which is
    // exactly why it is spelled out here rather than left off. `issueWidth` follows `seed`'s
    // precedent in `ProcessorConfig` (present only if a model needs it), so a declared config can
    // omit it; omitting it MEANS width 1, the reading the engine itself applies (`?? 1`). Dropping
    // the field instead would make a declared config leave the user's width untouched — a per-knob
    // rule smuggled into an all-or-nothing one, which is precisely the shape M4 step 4 shipped and
    // the browser caught (a lesson's own prose quoting cycle counts from a machine the reader was
    // not on). A superscalar lesson does not exist yet; the rule has to be right before it does.
    issueWidth: lesson.config.issueWidth ?? 1,
    // The M9 knobs (step 5), same all-or-nothing rule and same optional-field reading as `issueWidth`:
    // a declared config that omits them means the engine's own default (`?? false` / `?? 16`), never
    // "leave the user's position untouched". No M9 lesson exists yet (M10); the rule is right first.
    outOfOrderIssue: lesson.config.outOfOrderIssue ?? false,
    robSize: lesson.config.robSize ?? 16,
  };
}
