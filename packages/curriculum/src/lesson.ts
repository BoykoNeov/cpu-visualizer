import type { ProcessorConfig, TraceEvent } from '@cpu-viz/trace';

/**
 * The curriculum / lesson FORMAT (handoff §13). Lessons are declarative DATA the engine
 * does not compile against — this is what makes the simulator a platform with content on
 * top, and (eventually) lets users author lessons without recompiling. Annotations anchor
 * to trace EVENTS, not absolute cycle numbers (INV-6), so a lesson survives small program
 * edits. The runner that resolves these triggers against a recorded trace lives in
 * `./runner`.
 */

/** Axis B — explanation depth (handoff §4). Independent of the microarchitecture tier. */
export type DepthTier = 'essentials' | 'detailed' | 'expert';

/** Ordered from least to most detail; the renderer shows the highest variant <= current. */
export const DEPTH_TIERS: readonly DepthTier[] = ['essentials', 'detailed', 'expert'];

/**
 * What a lesson step anchors to (INV-6): an event TYPE, optionally the nth occurrence, and
 * an optional declarative payload filter. `where` is a plain data object (NOT a function
 * predicate) precisely because lessons must stay declarative/serializable — "the first
 * `reg-write` to register 10" is `{ event: 'reg-write', where: { reg: 10 } }`. Matching is
 * shallow equality against the event payload; a key absent on the event never matches (so
 * `where` naturally scopes to events of the named `type`).
 */
export interface LessonTrigger {
  event: TraceEvent['type'];
  /** Fire on the nth matching event (1-based); defaults to the first. */
  nth?: number;
  /** Shallow-equality filter on the event payload; every key must match. */
  where?: Record<string, number | string | boolean>;
}

/** A lesson step, anchored to an event rather than a cycle number (INV-6). */
export interface LessonStep {
  trigger: LessonTrigger;
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
  /**
   * Feature toggles the lesson runs under (forwarding, prediction, cache, …). Optional
   * because the single-cycle model ignores config; a consumer falls back to
   * `defaultConfig()` when absent.
   */
  config?: ProcessorConfig;
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
