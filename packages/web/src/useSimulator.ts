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

/** Everything the UI needs to render and drive the simulation. */
export interface Simulator {
  /** Name of the selected example program, or `null` before the first load. */
  programName: string | null;
  /** The assembled program (source-map + words back the source panel), or `null`. */
  program: AssembledProgram | null;
  /** Assembler diagnostics from the last load, or `null` if it assembled cleanly. */
  errors: AssemblerError[] | null;

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
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  const select = useCallback(
    (name: string) => {
      const example = EXAMPLE_PROGRAMS.find((p) => p.name === name);
      if (!example) return;
      setProgramName(name);
      const result = loadSource(example.source);
      if (!result.ok) {
        loaded.current = null;
        setErrors(result.errors);
        rerender();
        return;
      }
      // Record every cycle up front so the scrub bar is full-length, then park at the
      // pre-run state so the user starts at the beginning (a fixed-length timeline).
      const { recorder } = result.loaded;
      recorder.runToEnd();
      recorder.scrubTo(-1);
      loaded.current = result.loaded;
      setErrors(null);
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
  const runToEnd = useCallback(() => {
    loaded.current?.recorder.runToEnd();
    rerender();
  }, [rerender]);
  const reset = useCallback(() => {
    loaded.current?.recorder.scrubTo(-1);
    rerender();
  }, [rerender]);
  const scrubTo = useCallback(
    (cycle: number) => {
      loaded.current?.recorder.scrubTo(cycle);
      rerender();
    },
    [rerender],
  );

  const recorder = loaded.current?.recorder ?? null;
  return {
    programName,
    program: loaded.current?.program ?? null,
    errors,
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
