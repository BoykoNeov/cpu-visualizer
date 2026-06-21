import type { TraceEvent } from '@cpu-viz/trace';

/**
 * The curriculum / lesson system (handoff §13). Lessons are declarative DATA the engine
 * does not compile against — this is what makes the simulator a platform with content on
 * top. Annotations anchor to trace EVENTS, not absolute cycle numbers (INV-6), so a
 * lesson survives small program edits.
 *
 * These are scaffold seeds; the runner and event-anchoring matcher are build-order
 * step 10 (handoff §11).
 */

/** Axis B — explanation depth (handoff §4). Independent of the microarchitecture tier. */
export type DepthTier = 'essentials' | 'detailed' | 'expert';

/** Ordered from least to most detail; the renderer shows the highest variant <= current. */
export const DEPTH_TIERS: readonly DepthTier[] = ['essentials', 'detailed', 'expert'];

/** A lesson step, anchored to an event rather than a cycle number (INV-6). */
export interface LessonStep {
  trigger: {
    event: TraceEvent['type'];
    /** Fire on the nth matching event (1-based); defaults to the first. */
    nth?: number;
  };
  /** Narration with per-depth-tier variants (lawful simplification, INV-5). */
  narration: Partial<Record<DepthTier, string>>;
  /** View elements / instruction ids to emphasize. */
  highlight?: string[];
}

/** A guided lesson = a program + a model + a config + an ordered set of steps (handoff §13). */
export interface Lesson {
  id: string;
  title: string;
  /** The assembly to load, or a reference into /content/programs. */
  program: string;
  /** Which microarchitecture (model family id, handoff §2). */
  model: string;
  depthDefault: DepthTier;
  steps: LessonStep[];
}

/** Resolve the narration to show: the highest authored variant at or below `tier`. */
export function resolveNarration(
  narration: Partial<Record<DepthTier, string>>,
  tier: DepthTier,
): string | undefined {
  const maxIndex = DEPTH_TIERS.indexOf(tier);
  for (let i = maxIndex; i >= 0; i--) {
    const variant = narration[DEPTH_TIERS[i]!];
    if (variant !== undefined) return variant;
  }
  return undefined;
}
