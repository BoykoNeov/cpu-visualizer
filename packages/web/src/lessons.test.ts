import { describe, expect, it } from 'vitest';
import {
  activeStepAt,
  anchorLesson,
  anchorOrderViolations,
  narrationFor,
  resolveNarration,
  type AnchoredStep,
  type Lesson,
  type LessonStep,
} from '@cpu-viz/curriculum';
import { MultiCycleProcessor } from '@cpu-viz/engine-multi-cycle';
import type { CycleTrace, TraceEvent } from '@cpu-viz/trace';
import { EXAMPLE_PROGRAMS } from './programs';
import { LESSONS } from './lessons';
import { loadSource } from './simulator';

/**
 * The step-11 acceptance for lessons (INV-6): "the 2–3 lessons play through; annotations fire
 * on the correct events." Because authored lessons are UNTRUSTED JSON (`lessons.ts`), this
 * suite doubles as their validator — it drives the REAL single-cycle engine (the runner's own
 * tests use hand-built fixtures; the DAG forbids importing an engine into `curriculum`) and
 * proves every step anchors, in order, with resolvable narration. It then pins the headline
 * event PAYLOAD of each lesson against the hand-computed oracle, so a silently-wrong anchor
 * (right event type, wrong occurrence) is caught, not just a dead one.
 */

/** Assemble a corpus program and record it to completion — the runner's precondition. */
function recordProgram(programName: string): readonly CycleTrace[] {
  const program = EXAMPLE_PROGRAMS.find((p) => p.name === programName);
  expect(program, `lesson program "${programName}" is not in the corpus`).toBeDefined();
  const result = loadSource(program!.source);
  expect(result.ok, `"${programName}" should assemble`).toBe(true);
  if (!result.ok) throw new Error('unreachable: assembly failed');
  result.loaded.recorder.runToEnd(); // anchor against a COMPLETE recording
  return result.loaded.recorder.recorded;
}

/** As {@link recordProgram}, but driven by the multi-cycle engine (M2 step 5a). */
function recordProgramMultiCycle(programName: string): readonly CycleTrace[] {
  const program = EXAMPLE_PROGRAMS.find((p) => p.name === programName);
  expect(program, `lesson program "${programName}" is not in the corpus`).toBeDefined();
  const result = loadSource(program!.source, () => new MultiCycleProcessor());
  expect(result.ok, `"${programName}" should assemble`).toBe(true);
  if (!result.ok) throw new Error('unreachable: assembly failed');
  result.loaded.recorder.runToEnd();
  return result.loaded.recorder.recorded;
}

/** The trace event a step anchored to (cycle numbers are contiguous from 0). */
function anchoredEvent(trace: readonly CycleTrace[], anchored: AnchoredStep): TraceEvent {
  expect(anchored.cycle, `step ${anchored.index} never fired`).not.toBeNull();
  const cycle = trace.find((c) => c.cycle === anchored.cycle);
  expect(cycle, `no recorded cycle ${anchored.cycle}`).toBeDefined();
  return cycle!.events[anchored.eventIndex!]!;
}

const byId = (id: string): Lesson => {
  const lesson = LESSONS.find((l) => l.id === id);
  if (!lesson) throw new Error(`lesson "${id}" not found — the value oracle is stale`);
  return lesson;
};

const stepLabel = (step: LessonStep): string =>
  `${step.trigger.event}${step.trigger.nth ? ` #${step.trigger.nth}` : ''}`;

describe('authored lessons (INV-6)', () => {
  it('ships the M1 target of 2–3 lessons', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(2);
    expect(LESSONS.length).toBeLessThanOrEqual(3);
  });

  // The validator: every lesson, every step, against the real engine.
  for (const lesson of LESSONS) {
    describe(`${lesson.id} — "${lesson.title}"`, () => {
      it('references a program that exists in the corpus', () => {
        expect(EXAMPLE_PROGRAMS.map((p) => p.name)).toContain(lesson.program);
      });

      it('single-cycle is the only model targeted in M1', () => {
        expect(lesson.model).toBe('single-cycle');
      });

      it('every step anchors to a real event, in order, with narration at the default tier', () => {
        const trace = recordProgram(lesson.program);
        const anchored = anchorLesson(lesson, trace);

        // (1) No dead steps: a mistyped `event` or unsatisfiable `where` would anchor null.
        for (const step of anchored) {
          expect(step.cycle, `"${stepLabel(step.step)}" never fired`).not.toBeNull();
        }
        // (2) Steps anchor in non-decreasing trace order (an authoring check, INV-6).
        expect(anchorOrderViolations(anchored)).toEqual([]);
        // (2b) No two steps anchor to the SAME cycle. The play-through's Prev/Next and step-rail
        //      navigate by cursor, and the cursor addresses a whole cycle — it cannot select
        //      between two events within one cycle. So two steps sharing a cycle are not
        //      independently reachable: clicking the earlier one's dot lands on the later
        //      (max-eventIndex) step, and that earlier step's narration can never be shown. This
        //      only bites if a lesson attaches two narrated steps to two phases of ONE
        //      instruction (single-cycle ⇒ one cycle); guard against it at authoring time rather
        //      than shipping an unreachable step.
        const byCycle = new Map<number, number[]>();
        for (const step of anchored) {
          if (step.cycle === null) continue;
          byCycle.set(step.cycle, [...(byCycle.get(step.cycle) ?? []), step.index]);
        }
        const sameCycle = [...byCycle.entries()].filter(([, idxs]) => idxs.length > 1);
        expect(
          sameCycle,
          `steps share a cycle and can't be reached independently by the cursor: ${JSON.stringify(sameCycle)}`,
        ).toEqual([]);
        // (3) Each step has narration resolvable at the lesson's default tier — catches a
        //     mistyped tier key that would otherwise render blank narration.
        for (const { step } of anchored) {
          expect(
            resolveNarration(step.narration, lesson.depthDefault),
            `"${stepLabel(step)}" has no narration at "${lesson.depthDefault}"`,
          ).toBeDefined();
        }
      });

      it('the play-through query surfaces the right narration as the cursor moves', () => {
        // Close the loop between "steps anchor" and "the runner shows them": exercise
        // activeStepAt / narrationFor (the glue the UI will call) on the real recording.
        const trace = recordProgram(lesson.program);
        const anchored = anchorLesson(lesson, trace);

        // Pre-run (cursor -1): nothing has fired, so no step is active.
        expect(activeStepAt(anchored, -1)).toBeNull();
        expect(narrationFor(anchored, -1, lesson.depthDefault)).toBeUndefined();

        // At the final step's cycle (the greatest anchor — it owns its cycle), the runner
        // surfaces that step's narration at the default tier.
        const last = anchored[anchored.length - 1]!;
        expect(activeStepAt(anchored, last.cycle!)?.index).toBe(last.index);
        expect(narrationFor(anchored, last.cycle!, lesson.depthDefault)).toBe(
          resolveNarration(last.step.narration, lesson.depthDefault),
        );
      });
    });
  }

  // Payload oracles: pin the hand-computed values so a right-type/wrong-occurrence anchor
  // (which still anchors non-null) can't pass. Keyed to the specific authored lessons.
  it('sum-loop-tour: loops on bne and a0 ends at 55', () => {
    const lesson = byId('sum-loop-tour');
    const trace = recordProgram(lesson.program);
    const anchored = anchorLesson(lesson, trace);

    const firstAccumulate = anchoredEvent(trace, anchored[2]!);
    expect(firstAccumulate).toMatchObject({ type: 'reg-write', reg: 10, value: 10 });

    const branch = anchoredEvent(trace, anchored[3]!);
    expect(branch).toMatchObject({ type: 'alu-op', op: 'bne', result: 1 });

    const total = anchoredEvent(trace, anchored[4]!);
    expect(total).toMatchObject({ type: 'reg-write', reg: 10, value: 55 });
  });

  it('array-in-memory: loads a negative element and stores the total 120', () => {
    const lesson = byId('array-in-memory');
    const trace = recordProgram(lesson.program);
    const anchored = anchorLesson(lesson, trace);

    expect(anchoredEvent(trace, anchored[0]!)).toMatchObject({ type: 'mem-read', value: 5 });
    expect(anchoredEvent(trace, anchored[1]!)).toMatchObject({ type: 'mem-read', value: -4 });
    expect(anchoredEvent(trace, anchored[2]!)).toMatchObject({
      type: 'reg-write',
      reg: 10,
      value: 120,
    });
    expect(anchoredEvent(trace, anchored[3]!)).toMatchObject({ type: 'mem-write', value: 120 });
  });

  it('function-call: jal saves ra, bge picks the arg, s0 = 42', () => {
    const lesson = byId('function-call');
    const trace = recordProgram(lesson.program);
    const anchored = anchorLesson(lesson, trace);

    expect(anchoredEvent(trace, anchored[0]!)).toMatchObject({
      type: 'reg-write',
      reg: 10,
      value: 17,
    });
    // ra = PC(jal) + 4. jal is the 3rd instruction word, at 0x8 → ra = 0xC.
    expect(anchoredEvent(trace, anchored[1]!)).toMatchObject({
      type: 'reg-write',
      reg: 1,
      value: 12,
    });
    expect(anchoredEvent(trace, anchored[2]!)).toMatchObject({
      type: 'alu-op',
      op: 'bge',
      result: 0,
    });
    expect(anchoredEvent(trace, anchored[3]!)).toMatchObject({
      type: 'reg-write',
      reg: 8,
      value: 42,
    });
  });
});

/**
 * INV-6 across models (M2 step 5a): "lessons anchor to trace EVENTS, not cycle numbers." The
 * authored lessons target single-cycle, but the whole point of anchoring to events is that the
 * SAME lesson plays against a different microarchitecture unchanged — the multi-cycle engine
 * emits the same events, merely spread across more cycles (a load's `mem-read` and its
 * `reg-write` now land in different phase-cycles instead of one). So switching the model in the
 * picker must NOT strand a lesson: every step still anchors, in order, with resolvable narration,
 * and the play-through query still surfaces it. This is the graceful-degradation guarantee the
 * picker leans on — proven here directly rather than assumed.
 */
describe('authored lessons play against multi-cycle too (INV-6 cross-model)', () => {
  for (const lesson of LESSONS) {
    it(`${lesson.id}: every step still anchors under multi-cycle, in order, with narration`, () => {
      const trace = recordProgramMultiCycle(lesson.program);
      const anchored = anchorLesson(lesson, trace);

      // No step is stranded by the model swap (the crux: events, not cycles).
      for (const step of anchored) {
        expect(
          step.cycle,
          `"${stepLabel(step.step)}" never fired under multi-cycle`,
        ).not.toBeNull();
      }
      // Program-order anchoring survives the phase-spread (events still occur in the same order).
      expect(anchorOrderViolations(anchored)).toEqual([]);
      // Narration still resolves at the default tier.
      for (const { step } of anchored) {
        expect(resolveNarration(step.narration, lesson.depthDefault)).toBeDefined();
      }

      // The play-through query the UI calls still lands on the final step.
      const last = anchored[anchored.length - 1]!;
      expect(activeStepAt(anchored, last.cycle!)?.index).toBe(last.index);
      expect(narrationFor(anchored, last.cycle!, lesson.depthDefault)).toBe(
        resolveNarration(last.step.narration, lesson.depthDefault),
      );
    });
  }
});
