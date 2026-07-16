import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { defaultConfig } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import { LESSONS } from './lessons';
import { activeLessonOf, forkToSandbox, lessonSession, type Session } from './session';
import { loadSource } from './simulator';

/**
 * The spec §13 sandbox fork, exercised end-to-end against the REAL single-cycle engine — the
 * acceptance criterion "editing the program mid-lesson forks into a sandbox and the sandbox run
 * still animates correctly" (§11). `session.test.ts` proves the detach as pure data; this proves
 * the other half: an EDITED program actually assembles, records, and time-travels through the
 * same recorder the corpus programs use (which is exactly what `useSimulator.loadEdited` does —
 * `forkToSandbox` then the shared `loadInto` = `loadSource` + `runToEnd` + `scrubTo`). No jsdom,
 * per the step-7 precedent: the React wiring is thin over this proven path.
 */

/** The lesson's original program (55) with the loop bound edited from 10 to 5 → sums 1..5 = 15. */
const EDITED_SUM_LOOP = `
    .text
_start:
    li   a0, 0           # running total
    li   t0, 5           # i, counting down from 5 (was 10 in the lesson)
loop:
    add  a0, a0, t0
    addi t0, t0, -1
    bnez t0, loop
    li   a7, 10
    ecall
`;

const TEACHING_CAP = 50_000;

describe('sandbox fork (real single-cycle engine)', () => {
  it('an edit mid-lesson detaches the lesson yet the edited program records and animates', () => {
    // Start mid-lesson on the sum-loop tour (its program computes 55).
    const lesson = LESSONS.find((l) => l.program === 'sum-loop');
    expect(lesson, 'a sum-loop lesson should exist in the corpus').toBeDefined();
    let session: Session | null = lessonSession(lesson!);
    expect(activeLessonOf(session)).toBe(lesson);

    // Editing forks: the lesson's annotations detach (§13).
    session = forkToSandbox(session);
    expect(session.kind).toBe('sandbox');
    expect(activeLessonOf(session)).toBeNull();

    // The edited program runs through the same recorder path and lands on ITS result (15, not
    // the lesson's 55) — proving the fork animates the edited program, not the original.
    const result = loadSource(EDITED_SUM_LOOP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { recorder } = result.loaded;
    expect(recorder.cursor).toBe(-1); // pre-run, loaded
    recorder.runToEnd(TEACHING_CAP);
    expect(recorder.currentState().registers[10]).toBe(15);

    // It time-travels like any recorded run: many cycles, and scrub/back land on the trace.
    expect(recorder.recordedCycles).toBeGreaterThan(5);
    recorder.scrubTo(0, TEACHING_CAP);
    expect(recorder.cursor).toBe(0);
    expect(recorder.currentState().registers[10]).toBe(0); // total not yet accumulated at cycle 0
  });

  it('an infinite-loop edit trips the teaching cap instead of hanging the tab', () => {
    // A user can type a non-terminating program; the runaway guard must throw, not spin forever.
    const result = loadSource('loop:\n    j loop\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => result.loaded.recorder.runToEnd(TEACHING_CAP)).toThrow();
  });
});

/**
 * The same fork, on the pipeline — the M3 acceptance box "editing mid-lesson forks into a sandbox
 * and the sandbox run still animates: free via INV-3, but **assert it once on this model**".
 *
 * Free is a claim, not a fact, until something exercises it: a sandbox is the one entry point that
 * does NOT come from the corpus, so it is the only path where the program is user text rather than
 * a fixture — and step 5 gave the load path a new `config` argument that every entry point must
 * carry. `useSimulator.loadEdited` and `select` share one `loadInto`, so the config reaches an
 * edited program by construction; this is what makes "by construction" checkable. Asserted in BOTH
 * positions, because a sandbox fork that silently dropped the toggle would still animate — just
 * not the machine the user is looking at.
 */
describe('sandbox fork on the pipeline (M3 acceptance: assert it once on this model)', () => {
  const forked = (): Session =>
    forkToSandbox(lessonSession(LESSONS.find((l) => l.program === 'sum-loop')!));

  const runEdited = (forwarding: boolean) => {
    const result = loadSource(EDITED_SUM_LOOP, () => new PipelineProcessor(), {
      ...defaultConfig(),
      forwarding,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable: the edited program should assemble');
    result.loaded.recorder.runToEnd(TEACHING_CAP);
    return result.loaded.recorder;
  };

  it('an edit mid-lesson detaches the lesson and the edited program animates on the pipeline', () => {
    const session = forked();
    expect(session.kind).toBe('sandbox');
    expect(activeLessonOf(session)).toBeNull();

    const recorder = runEdited(false);
    // ITS result (1+2+3+4+5 = 15), not the lesson program's 55 — the fork animates the edit.
    expect(recorder.currentState().registers[10]).toBe(15);
    // ...and it time-travels like any recorded run.
    recorder.scrubTo(0, TEACHING_CAP);
    expect(recorder.cursor).toBe(0);
    expect(recorder.currentState().registers[10]).toBe(0);
  });

  it('the forwarding toggle reaches a SANDBOX program too, not just the corpus', () => {
    const off = runEdited(false);
    const on = runEdited(true);
    // The crown jewel on user-authored code: strictly fewer cycles, identical result. A sandbox
    // that dropped the config would show equal counts here and nowhere else.
    expect(on.recordedCycles).toBeLessThan(off.recordedCycles);
    expect(on.currentState().registers[10]).toBe(15);
    expect([...on.currentState().registers]).toEqual([...off.currentState().registers]);
  });
});
