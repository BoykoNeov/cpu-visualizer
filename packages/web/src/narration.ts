/**
 * Pure view-model for the lesson narration panel — the visible "play-through" of an authored
 * lesson (spec §11 acceptance). Given a lesson's anchored steps, the timeline cursor, and the
 * depth tier, it decides which step is playing, what text to show, and where the prev/next-step
 * controls should scrub to.
 *
 * Kept framework-agnostic and headlessly testable (mirrors `session.ts`) so App is a thin
 * renderer over the returned shape. The load-bearing logic — which step is active at a cursor
 * (INV-6) and the tier fallback (INV-5) — is delegated to the curriculum runner
 * (`activeStepAt` / `resolveNarration`); this only adds the panel's timeline ordering and the
 * prev/next navigation over the anchored steps.
 */

import {
  activeStepAt,
  resolveNarration,
  type AnchoredStep,
  type DepthTier,
} from '@cpu-viz/curriculum';

/** One playable (anchored) step, resolved for display at the current depth tier. */
export interface StepView {
  /** The step's authoring index in `lesson.steps` — a stable React key. */
  index: number;
  /** The recorded cycle this step anchors to (the scrub target when the row is clicked). */
  cycle: number;
  /** Narration at the current tier, or `undefined` if the step authored none at/below it. */
  narration: string | undefined;
  /** True when this is the step active at the cursor. */
  active: boolean;
}

/** Everything the narration panel needs to render at a given cursor + tier. */
export interface NarrationView {
  /** The anchored steps in timeline order; steps that never fired are dropped. */
  steps: StepView[];
  /** Index into {@link steps} of the active step, or -1 before the first step fires. */
  activeIndex: number;
  /** The active step's narration at the current tier, or `undefined` when none is active. */
  narration: string | undefined;
  /** Scrub target for the "previous step" control, or `null` at/before the first step. */
  prevCycle: number | null;
  /** Scrub target for the "next step" control, or `null` once the last step is active. */
  nextCycle: number | null;
}

/** Build the narration panel's view-model. Pure — safe to call on every render. */
export function narrationView(
  anchored: readonly AnchoredStep[],
  cursor: number,
  tier: DepthTier,
): NarrationView {
  // Drop never-fired steps and order the rest along the timeline. Two steps can share a cycle,
  // so order by the same (cycle, eventIndex) key the runner resolves the active step by — the
  // panel's rail then matches whichever step `activeStepAt` picks.
  const playable = anchored
    .filter((s): s is AnchoredStep & { cycle: number; eventIndex: number } => s.cycle !== null)
    .slice()
    .sort((a, b) => a.cycle - b.cycle || a.eventIndex - b.eventIndex);

  const active = activeStepAt(anchored, cursor);
  const activeIndex = active ? playable.findIndex((s) => s.index === active.index) : -1;

  const steps: StepView[] = playable.map((s, i) => ({
    index: s.index,
    cycle: s.cycle,
    narration: resolveNarration(s.step.narration, tier),
    active: i === activeIndex,
  }));

  // "Next" before the first step begins the lesson (jump to step 0); otherwise it advances to
  // the step after the active one. "Prev" steps back to the one before it (null at the start).
  const nextIndex = activeIndex + 1;
  return {
    steps,
    activeIndex,
    narration: activeIndex >= 0 ? steps[activeIndex]!.narration : undefined,
    prevCycle: activeIndex > 0 ? steps[activeIndex - 1]!.cycle : null,
    nextCycle: nextIndex < steps.length ? steps[nextIndex]!.cycle : null,
  };
}
