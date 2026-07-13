/**
 * React binding for the {@link TraceRecorder}. The recorder is imperative and lives in a
 * ref; a bare tick counter forces re-render after each transport action. Its ONLY job is to
 * re-render — every piece of displayed data is read live from `recorder.currentState()` /
 * `recorder.current()` during render, never shadow-copied into React state. That is what
 * makes "shown state always matches the recorded trace at the cursor" hold by construction
 * (acceptance §11).
 */

import type { AssembledProgram, AssemblerError } from '@cpu-viz/assembler';
import type { CycleTrace, MachineState } from '@cpu-viz/trace';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EXAMPLE_PROGRAMS } from './programs';
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
  /** Name of the selected example program, or `null` before the first load. */
  programName: string | null;
  /** The assembled program (source-map + words back the source panel), or `null`. */
  program: AssembledProgram | null;
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

  /** Load an example program by name; parks the cursor at the pre-run state. */
  select: (name: string) => void;
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
  const [programName, setProgramName] = useState<string | null>(null);
  const [errors, setErrors] = useState<AssemblerError[] | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  const select = useCallback(
    (name: string) => {
      const example = EXAMPLE_PROGRAMS.find((p) => p.name === name);
      if (!example) return;
      setProgramName(name);
      const result = loadSource(example.source);
      if (!result.ok) {
        // Assembler failure clears any prior runtime error — the two channels never coexist.
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
  return {
    programName,
    program: loaded.current?.program ?? null,
    errors,
    runtimeError,
    cursor: recorder?.cursor ?? -1,
    recordedCycles: recorder?.recordedCycles ?? 0,
    atEnd: recorder?.atEnd ?? false,
    state: recorder ? recorder.currentState() : null,
    cycleTrace: recorder ? recorder.current() : null,
    select,
    stepForward,
    stepBack,
    runToEnd,
    reset,
    scrubTo,
  };
}
