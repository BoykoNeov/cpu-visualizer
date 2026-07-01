/**
 * `@cpu-viz/curriculum` — the lesson platform layer (handoff §13). Lessons are declarative
 * DATA (`./lesson`); the runner (`./runner`) anchors their event-triggers against a recorded
 * `CycleTrace[]` (INV-6) and answers "which step / narration is active at this cursor and
 * depth tier?". Framework-agnostic: depends only on `@cpu-viz/trace`, never an engine or the
 * web app.
 */

export {
  DEPTH_TIERS,
  resolveNarration,
  type DepthTier,
  type LessonTrigger,
  type LessonStep,
  type Lesson,
} from './lesson';
export {
  anchorTrigger,
  anchorLesson,
  activeStepAt,
  narrationFor,
  anchorOrderViolations,
  type AnchoredStep,
} from './runner';
