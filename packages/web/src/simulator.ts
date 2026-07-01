/**
 * The one piece of non-React logic in the web shell: assemble source text and hand the
 * resulting program to a fresh {@link TraceRecorder} driving the single-cycle engine. Kept
 * framework-agnostic so it is unit-testable headlessly (the transport itself is already
 * fully proven in `trace`; this just wires assembler → engine → recorder).
 *
 * The recorder is the SOLE driver of the engine (INV-3): every panel reads architectural
 * state back through `recorder.currentState()` / `recorder.current()`, never from engine
 * internals — that is what makes "shown state always matches the recorded trace" hold by
 * construction.
 */

import { assemble, type AssembledProgram, type AssemblerError } from '@cpu-viz/assembler';
import { SingleCycleProcessor, toProgramImage } from '@cpu-viz/engine-single-cycle';
import { TraceRecorder } from '@cpu-viz/trace';

/** A successfully assembled program, loaded and ready to drive. */
export interface LoadedProgram {
  /** Time-travel driver over the single-cycle engine, positioned at the pre-run state (-1). */
  recorder: TraceRecorder;
  /** The assembled program — its `words` + `sourceMap` back the source↔machine-code panel. */
  program: AssembledProgram;
}

/** Either a loaded program or the located assembler errors that blocked it. */
export type LoadResult =
  | { ok: true; loaded: LoadedProgram }
  | { ok: false; errors: AssemblerError[] };

/**
 * Assemble `source` and, on success, load it into a fresh recorder (cursor at the pre-run
 * state, nothing executed yet). On failure returns the located assembler diagnostics for
 * display. Does not run the program — the caller decides how far to drive it.
 */
export function loadSource(source: string): LoadResult {
  const { program, errors } = assemble(source);
  if (!program) return { ok: false, errors };
  const recorder = new TraceRecorder(new SingleCycleProcessor());
  recorder.load(toProgramImage(program));
  return { ok: true, loaded: { recorder, program } };
}
