/**
 * The lesson RUNNER — event-anchoring (handoff §13, INV-6). Given a lesson and a recorded
 * trace, it resolves each event-anchored {@link LessonStep} to the concrete cycle its
 * trigger fired, then answers "which step is active at the cursor?" and "what narration do
 * I show at this depth tier?".
 *
 * Design (per review): anchoring is the expensive STATIC step, so it runs once
 * ({@link anchorLesson}); the depth tier is a LIVE dial, so narration resolution is a
 * separate PURE query ({@link narrationFor}). A tier change re-resolves narration without
 * re-anchoring. No stateful class — plain data + pure functions, framework-agnostic
 * (depends only on `@cpu-viz/trace`), so `web` can memoize the anchor and re-query on every
 * tier/cursor change.
 *
 * PRECONDITION: anchor against a COMPLETE recording. The {@link TraceRecorder} records
 * lazily (only at the high-water mark), so a partial `CycleTrace[]` would silently fail to
 * anchor later steps — call `recorder.runToEnd()` (and read `recorder`'s full trace) before
 * anchoring.
 */

import type { CycleTrace, TraceEvent } from '@cpu-viz/trace';
import {
  resolveNarration,
  type DepthTier,
  type Lesson,
  type LessonStep,
  type LessonTrigger,
} from './lesson';

/** A {@link LessonStep} resolved against a concrete recorded trace. */
export interface AnchoredStep {
  step: LessonStep;
  /** The step's position in `lesson.steps` (authoring order). */
  index: number;
  /** The recorded cycle the trigger fired, or `null` if it never fired in the trace. */
  cycle: number | null;
  /** Index within that cycle's `events` of the matching event, or `null` if unanchored. */
  eventIndex: number | null;
}

/** Does one event satisfy a trigger's type + declarative `where` filter? */
function eventMatches(event: TraceEvent, trigger: LessonTrigger): boolean {
  if (event.type !== trigger.event) return false;
  if (trigger.where === undefined) return true;
  const payload = event as Record<string, unknown>;
  for (const key of Object.keys(trigger.where)) {
    // A key absent on this event reads as `undefined` and fails to match — no throw.
    if (payload[key] !== trigger.where[key]) return false;
  }
  return true;
}

/**
 * Find where a trigger fires in a recorded trace (INV-6): scan cycles in order, then events
 * within each cycle, counting matches; return the `nth` (default 1st) as its `cycle` (the
 * trace's own cycle number, which the cursor indexes by) and `eventIndex`. `null` if it
 * never fires.
 */
export function anchorTrigger(
  trigger: LessonTrigger,
  trace: readonly CycleTrace[],
): { cycle: number; eventIndex: number } | null {
  const target = trigger.nth ?? 1;
  let count = 0;
  for (const cycleTrace of trace) {
    for (let eventIndex = 0; eventIndex < cycleTrace.events.length; eventIndex++) {
      if (eventMatches(cycleTrace.events[eventIndex]!, trigger)) {
        count += 1;
        if (count === target) return { cycle: cycleTrace.cycle, eventIndex };
      }
    }
  }
  return null;
}

/** Anchor every step of a lesson against a (complete) recording — the static step. */
export function anchorLesson(lesson: Lesson, trace: readonly CycleTrace[]): AnchoredStep[] {
  return lesson.steps.map((step, index) => {
    const hit = anchorTrigger(step.trigger, trace);
    return { step, index, cycle: hit?.cycle ?? null, eventIndex: hit?.eventIndex ?? null };
  });
}

/**
 * The step active at a cursor `cycle`: the anchored step with the greatest
 * `(cycle, eventIndex)` at or before the cursor. Resolves by ANCHOR POSITION, not authoring
 * order, so narration always matches the cycle on screen even if two steps share a cycle.
 * Steps that never anchored (`cycle: null`) are skipped — they can't own the active slot.
 * Returns `null` before the first step's cycle.
 */
export function activeStepAt(
  anchored: readonly AnchoredStep[],
  cycle: number,
): AnchoredStep | null {
  let best: AnchoredStep | null = null;
  for (const candidate of anchored) {
    if (candidate.cycle === null || candidate.cycle > cycle) continue;
    if (
      best === null ||
      candidate.cycle > best.cycle! ||
      (candidate.cycle === best.cycle! && candidate.eventIndex! > best.eventIndex!)
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * The narration to show at a cursor `cycle` and depth `tier`: the active step's highest
 * authored variant at or below the tier (delegates the tier fallback to
 * {@link resolveNarration}, INV-5). `undefined` when no step is active or the active step
 * authored nothing at/below the tier.
 */
export function narrationFor(
  anchored: readonly AnchoredStep[],
  cycle: number,
  tier: DepthTier,
): string | undefined {
  const active = activeStepAt(anchored, cycle);
  return active ? resolveNarration(active.step.narration, tier) : undefined;
}

/**
 * DEV-TIME authoring check: the indices of anchored steps whose `(cycle, eventIndex)` goes
 * BACKWARD relative to a preceding anchored step. Steps normally anchor in non-decreasing
 * order; a violation is an authoring mistake (a trigger that fires earlier than the step
 * before it), not a runner bug — {@link activeStepAt} still resolves gracefully by anchor
 * position. Unanchored (`null`) steps are ignored. Intended for lesson-authoring validation,
 * never the query path.
 */
export function anchorOrderViolations(anchored: readonly AnchoredStep[]): number[] {
  const violations: number[] = [];
  let prevCycle = -Infinity;
  let prevEventIndex = -Infinity;
  for (const candidate of anchored) {
    if (candidate.cycle === null) continue;
    if (
      candidate.cycle < prevCycle ||
      (candidate.cycle === prevCycle && candidate.eventIndex! < prevEventIndex)
    ) {
      violations.push(candidate.index);
    } else {
      prevCycle = candidate.cycle;
      prevEventIndex = candidate.eventIndex!;
    }
  }
  return violations;
}
