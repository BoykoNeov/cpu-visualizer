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
   * The feature toggles the lesson has an OPINION about (forwarding, prediction, cache, …). Every
   * knob is optional, and absent means "leave it as the user set it" — not "use the default".
   *
   * **`Partial`, and that is load-bearing (M4 step 4).** This was a full `ProcessorConfig` while
   * `forwarding` was the only knob any model honored, and the two readings were indistinguishable:
   * a lesson that declared a config declared *the* knob, so "declared a config" and "has an opinion
   * about forwarding" were the same statement. The rule `lessonOpening` pins — *config is honored
   * only when DECLARED, because a lesson with no opinion must not silently reset a position the
   * user chose* — was therefore always per-KNOB in its prose and per-CONFIG in its type, and
   * nothing could tell.
   *
   * A second honored knob separates them. `forwarding-bubble` is about stalls and has no opinion
   * whatsoever about branch prediction, but a required field forced it to state one anyway
   * (`"branchPrediction": "none"` — boilerplate, never a decision). That leaves only two behaviors,
   * and the pinned rule calls both bugs: honor it and starting a forwarding lesson silently resets
   * a prediction the user picked; ignore it and the field is declared-and-honored-by-nobody, the
   * exact M1-era defect step 8 fixed. `Partial` makes "declared" mean per-knob, which is what the
   * rule always said — so the fix is a type weakening plus a subtraction from the JSON, not a new
   * field.
   */
  config?: Partial<ProcessorConfig>;
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
