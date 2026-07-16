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
import { toProgramImage } from '@cpu-viz/engine-common';
import { SingleCycleProcessor } from '@cpu-viz/engine-single-cycle';
import { defaultConfig, TraceRecorder, type Processor, type ProcessorConfig } from '@cpu-viz/trace';

/** A successfully assembled program, loaded and ready to drive. */
export interface LoadedProgram {
  /** Time-travel driver over the chosen engine, positioned at the pre-run state (-1). */
  recorder: TraceRecorder;
  /** The assembled program — its `words` + `sourceMap` back the source↔machine-code panel. */
  program: AssembledProgram;
  /**
   * The exact source text that produced this program. Retained so the source panel shows the
   * program actually loaded and running — which, for a sandbox fork, is the user's edited
   * text, not the pristine corpus source it forked from.
   */
  source: string;
}

/** Either a loaded program or the located assembler errors that blocked it. */
export type LoadResult =
  | { ok: true; loaded: LoadedProgram }
  | { ok: false; errors: AssemblerError[] };

/**
 * Assemble `source` and, on success, load it into a fresh recorder driving `makeProcessor()`
 * under `config` (cursor at the pre-run state, nothing executed yet). On failure returns the
 * located assembler diagnostics for display. Does not run the program — the caller decides how
 * far to drive it.
 *
 * `makeProcessor` defaults to the single-cycle engine so every existing caller (and the headless
 * test) keeps its one-argument behaviour; the model picker passes the selected model's factory.
 * The recorder is model-agnostic (INV-3), so swapping the engine is the ONLY change needed to
 * drive a different microarchitecture.
 *
 * `config` defaults to the neutral {@link defaultConfig} — which is what the recorder already
 * applied implicitly before M3 step 5, so passing it explicitly changes nothing for the two
 * config-blind models. The pipeline is the first model whose TRACE depends on its CONFIG
 * (`forwarding` genuinely changes the machine), so this parameter is what makes the forwarding
 * toggle real rather than decorative: same program, same engine, different recording.
 */
export function loadSource(
  source: string,
  makeProcessor: () => Processor = () => new SingleCycleProcessor(),
  config: ProcessorConfig = defaultConfig(),
): LoadResult {
  const { program, errors } = assemble(source);
  if (!program) return { ok: false, errors };
  const recorder = new TraceRecorder(makeProcessor());
  recorder.load(toProgramImage(program), config);
  return { ok: true, loaded: { recorder, program, source } };
}
