/**
 * React binding for the {@link TraceRecorder}. The recorder is imperative and lives in a
 * ref; a bare tick counter forces re-render after each transport action. Its ONLY job is to
 * re-render — every piece of displayed data is read live from `recorder.currentState()` /
 * `recorder.current()` during render, never shadow-copied into React state. That is what
 * makes "shown state always matches the recorded trace at the cursor" hold by construction
 * (acceptance §11).
 */

import type { AssembledProgram, AssemblerError } from '@cpu-viz/assembler';
import { anchorLesson, type AnchoredStep, type Lesson } from '@cpu-viz/curriculum';
import type { CycleTrace, MachineState } from '@cpu-viz/trace';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EXAMPLE_PROGRAMS } from './programs';
import {
  activeLessonOf,
  exampleSession,
  forkToSandbox,
  lessonSession,
  originNameOf,
  type Session,
} from './session';
import { loadSource, type LoadedProgram } from './simulator';

/**
 * Teaching-scale ceiling on how many cycles we record for one program. Well under the
 * recorder's 1M default: a user-edited program (the step-11 sandbox fork) can loop forever,
 * and a frozen tab is worse than a friendly "ran too long" message. The shipped corpus all
 * halts in well under this.
 */
const TEACHING_MAX_CYCLES = 50_000;

/** Everything the UI needs to render and drive the simulation. */
export interface Simulator {
  /**
   * The corpus program backing the current session: the selected example/lesson program, or
   * the program a sandbox forked from. `null` before the first load. (In a sandbox this is the
   * fork origin, not what is running — see {@link loadedSource} for the running source.)
   */
  programName: string | null;
  /** The lesson whose steps are attached, or `null` in free-play / after a sandbox fork (§13). */
  activeLesson: Lesson | null;
  /**
   * The active lesson's steps anchored against the current (complete) recording — the input
   * to the narration panel's play-through (INV-6). `null` in free-play / sandbox (no lesson).
   * Anchored once per (lesson, recording) and re-queried by cursor/tier in the view, so a
   * scrub or depth change re-resolves narration without re-anchoring.
   */
  anchoredSteps: AnchoredStep[] | null;
  /** True when the running program is user-edited (the spec §13 sandbox fork). */
  sandbox: boolean;
  /**
   * Increments each time a fresh corpus program is loaded (`select` / `startLesson`) — but NOT
   * on a sandbox edit. The editor uses it to reseed its draft to the pristine source even when
   * the *same* program is re-selected (leaving a sandbox), which a name-only signal misses.
   */
  loadGen: number;
  /** The assembled program (source-map + words back the source panel), or `null`. */
  program: AssembledProgram | null;
  /** The source text that produced the loaded program — the edited text in a sandbox. `null`
   *  before the first successful load. */
  loadedSource: string | null;
  /** Assembler diagnostics from the last load, or `null` if it assembled cleanly. */
  errors: AssemblerError[] | null;
  /**
   * A runtime message when the program was abandoned mid-run (e.g. it exceeded
   * {@link TEACHING_MAX_CYCLES} without halting), or `null`. Mutually exclusive with
   * {@link errors} — a program either fails to assemble or fails to terminate, never both.
   */
  runtimeError: string | null;

  /** Timeline position: -1 = pre-run ("start"), otherwise the recorded cycle index. */
  cursor: number;
  /** Total cycles recorded (the scrub bar's upper bound is `recordedCycles - 1`). */
  recordedCycles: number;
  /** True when parked on the final cycle of a halted run. */
  atEnd: boolean;
  /** Full architectural state at the cursor, or `null` before any program loads. */
  state: MachineState | null;
  /** The trace at the cursor (events + in-flight instructions), or `null` at pre-run. */
  cycleTrace: CycleTrace | null;

  /** Load an example program by name (free-play); parks the cursor at the pre-run state. */
  select: (name: string) => void;
  /** Start following an authored lesson: load its program and attach its steps. */
  startLesson: (lesson: Lesson) => void;
  /**
   * Fork into a sandbox on the user's edited source (§13): assemble + record the edited
   * program and DETACH any active lesson. Same driver path as {@link select}, so the sandbox
   * run animates identically.
   */
  loadEdited: (source: string) => void;
  stepForward: () => void;
  stepBack: () => void;
  runToEnd: () => void;
  /** Return to the pre-run state (cursor -1). */
  reset: () => void;
  /** Jump the cursor to an arbitrary cycle (clamped by the recorder). */
  scrubTo: (cycle: number) => void;
}

export function useSimulator(): Simulator {
  const loaded = useRef<LoadedProgram | null>(null);
  const [, setTick] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  // Bumped only on a fresh corpus load, so the editor can reseed its draft even on a same-name
  // re-select (see `loadGen` in the interface). A sandbox edit deliberately does NOT bump it —
  // the user's in-progress text must survive a re-record.
  const [loadGen, setLoadGen] = useState(0);
  const [errors, setErrors] = useState<AssemblerError[] | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  // Assemble + record `source`, parking the cursor at the pre-run state. Shared by every entry
  // point (`select` / `startLesson` / `loadEdited`) — the mode differs only in the `session`
  // set beforehand; the driver path is identical, which is why "the sandbox run still animates
  // correctly" (§11 acceptance) holds by construction. On assembler failure or a runaway
  // recording it clears `loaded` and surfaces the matching error channel (the two are mutually
  // exclusive: a program either fails to assemble or fails to terminate, never both).
  const loadInto = useCallback(
    (source: string) => {
      const result = loadSource(source);
      if (!result.ok) {
        loaded.current = null;
        setErrors(result.errors);
        setRuntimeError(null);
        rerender();
        return;
      }
      // Record every cycle up front so the scrub bar is full-length, then park at the
      // pre-run state so the user starts at the beginning (a fixed-length timeline). A
      // user-edited program (sandbox fork) may never halt, so cap the up-front recording:
      // on overflow, discard the (non-halted) recording — keeping it would re-throw on the
      // next scrub-forward — and surface a friendly message in place of the transport.
      const { recorder } = result.loaded;
      try {
        recorder.runToEnd(TEACHING_MAX_CYCLES);
      } catch {
        loaded.current = null;
        setErrors(null);
        setRuntimeError(
          `This program ran for more than ${TEACHING_MAX_CYCLES.toLocaleString()} cycles ` +
            `without finishing — it may loop forever. Edit it so it halts (e.g. reach ` +
            `“li a7, 10; ecall”) and try again.`,
        );
        rerender();
        return;
      }
      recorder.scrubTo(-1, TEACHING_MAX_CYCLES);
      loaded.current = result.loaded;
      setErrors(null);
      setRuntimeError(null);
      rerender();
    },
    [rerender],
  );

  const select = useCallback(
    (name: string) => {
      const example = EXAMPLE_PROGRAMS.find((p) => p.name === name);
      if (!example) return;
      setSession(exampleSession(name));
      setLoadGen((g) => g + 1);
      loadInto(example.source);
    },
    [loadInto],
  );

  const startLesson = useCallback(
    (lesson: Lesson) => {
      const example = EXAMPLE_PROGRAMS.find((p) => p.name === lesson.program);
      if (!example) return; // a lesson referencing a program not in the corpus — ignore (INV-7)
      setSession(lessonSession(lesson));
      setLoadGen((g) => g + 1);
      loadInto(example.source);
    },
    [loadInto],
  );

  const loadEdited = useCallback(
    (source: string) => {
      // The fork (§13): detach any active lesson, then record the edited program. Functional
      // update so the origin is derived from whatever session was current.
      setSession((prev) => forkToSandbox(prev));
      loadInto(source);
    },
    [loadInto],
  );

  // Load a program on mount so the shell is never empty. Prefer `sum-loop` — a short
  // counting loop is the clearest first teaching example; `add` (which sorts first) halts
  // by running off text-end, so its final pc is an out-of-range value that reads as odd.
  useEffect(() => {
    const first = EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop') ?? EXAMPLE_PROGRAMS[0];
    if (first) select(first.name);
  }, [select]);

  const stepForward = useCallback(() => {
    loaded.current?.recorder.stepForward();
    rerender();
  }, [rerender]);
  const stepBack = useCallback(() => {
    loaded.current?.recorder.stepBack();
    rerender();
  }, [rerender]);
  // These only ever replay already-recorded cycles today (`select` records the whole program
  // up front, so the engine is halted), so their guard loops can't fire — but pass the cap
  // anyway to stay correct if recording ever becomes lazy.
  const runToEnd = useCallback(() => {
    loaded.current?.recorder.runToEnd(TEACHING_MAX_CYCLES);
    rerender();
  }, [rerender]);
  const reset = useCallback(() => {
    loaded.current?.recorder.scrubTo(-1, TEACHING_MAX_CYCLES);
    rerender();
  }, [rerender]);
  const scrubTo = useCallback(
    (cycle: number) => {
      loaded.current?.recorder.scrubTo(cycle, TEACHING_MAX_CYCLES);
      rerender();
    },
    [rerender],
  );

  const recorder = loaded.current?.recorder ?? null;
  const activeLesson = activeLessonOf(session);
  // Anchor the active lesson against the COMPLETE recording (INV-6). `loadInto` runs the
  // program to end (or discards it on overflow) before `loaded.current` is set, so by the time
  // a recorder is in hand its `recorded` trace is whole — the runner's precondition. Keyed on
  // (lesson, recorder): a re-select or sandbox edit makes a fresh recorder, so this recomputes;
  // a scrub or depth change does not, and re-queries the cached anchors in the view instead.
  const anchoredSteps = useMemo(
    () => (activeLesson && recorder ? anchorLesson(activeLesson, recorder.recorded) : null),
    [activeLesson, recorder],
  );
  return {
    programName: originNameOf(session),
    activeLesson,
    anchoredSteps,
    sandbox: session?.kind === 'sandbox',
    loadGen,
    program: loaded.current?.program ?? null,
    loadedSource: loaded.current?.source ?? null,
    errors,
    runtimeError,
    cursor: recorder?.cursor ?? -1,
    recordedCycles: recorder?.recordedCycles ?? 0,
    atEnd: recorder?.atEnd ?? false,
    state: recorder ? recorder.currentState() : null,
    cycleTrace: recorder ? recorder.current() : null,
    select,
    startLesson,
    loadEdited,
    stepForward,
    stepBack,
    runToEnd,
    reset,
    scrubTo,
  };
}
