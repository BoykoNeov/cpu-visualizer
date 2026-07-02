/**
 * The driver/recorder — time-travel over a {@link Processor} (handoff §6). It wraps an
 * engine and keeps an array of every {@link CycleTrace} emitted; because each trace already
 * carries a full, independent state snapshot (INV-1 determinism makes per-cycle state cheap),
 * reversibility comes for free and the engine never needs to step backward:
 *
 * - "Current cycle" is just a cursor into the recorded array.
 * - Step **back** / **scrub** = move the cursor and read the snapshot already at that index —
 *   this NEVER re-runs the engine (replaying a recorded cycle returns the same frozen trace).
 * - Step **forward beyond what's recorded** = call `engine.step()` once and append.
 *
 * The engine's internal state always sits at the high-water mark (the last recorded cycle);
 * the cursor is an independent view index in `[-1, recordedCycles - 1]`, where **-1 is the
 * pre-run state** (the program loaded but nothing executed). No delta/keyframe cleverness —
 * snapshot everything (§6).
 *
 * Lives in `trace`, alongside the schema and the {@link Processor} interface, so it can drive
 * ANY model without `trace` depending on an engine (which would invert the DAG, INV-3).
 */

import {
  defaultConfig,
  type ProcessorConfig,
  type ProgramImage,
  type Processor,
} from './processor';
import type { CycleTrace, MachineState } from './schema';

/** Where a followed instruction was, and when — one entry per recorded cycle it appears in. */
export interface InstructionSighting {
  /** The recorded cycle number (also the cursor index). */
  cycle: number;
  /** The instruction's `location` that cycle (`"single-cycle"`, `"IF"`, `"ROB#3"`, …). */
  location: string;
}

/**
 * Records every cycle a {@link Processor} emits and exposes scrubbable, reversible navigation
 * over the recording. Owns the program lifecycle: call {@link load} to (re)start, then drive
 * with {@link stepForward} / {@link stepBack} / {@link scrubTo} / {@link runToEnd}.
 *
 * The recorder must be the SOLE driver of the wrapped processor's `step()`; calling `step()`
 * on the engine directly would desync the recording.
 */
export class TraceRecorder {
  private readonly traces: CycleTrace[] = [];
  /** Snapshot of the pre-run state (cursor -1); `null` until {@link load} is called. */
  private initial: MachineState | null = null;
  /** -1 = pre-run state; i >= 0 = positioned at `traces[i]`. */
  private cursorIndex = -1;

  constructor(private readonly processor: Processor) {}

  /**
   * Reset the wrapped processor with a fresh program and begin recording from scratch. The
   * cursor lands at -1 (the pre-run state: program loaded, nothing executed yet). Snapshots
   * the reset state via `getState()`, which the {@link Processor} contract guarantees is
   * independent of the live engine.
   */
  load(image: ProgramImage, config: ProcessorConfig = defaultConfig()): void {
    this.processor.reset(image, config);
    this.traces.length = 0;
    this.initial = this.processor.getState();
    this.cursorIndex = -1;
  }

  /** Number of cycles recorded so far (the engine's high-water mark). */
  get recordedCycles(): number {
    return this.traces.length;
  }

  /** Current timeline position: -1 = the pre-run state, otherwise the recorded cycle index. */
  get cursor(): number {
    return this.cursorIndex;
  }

  /** True when no further forward progress is possible: at the last cycle and the run halted. */
  get atEnd(): boolean {
    return this.processor.isHalted() && this.cursorIndex === this.traces.length - 1;
  }

  /** The {@link CycleTrace} at the cursor, or `null` at the pre-run position. */
  current(): CycleTrace | null {
    return this.cursorIndex < 0 ? null : this.traces[this.cursorIndex]!;
  }

  /** Full architectural state at the cursor (the pre-run snapshot when the cursor is -1). */
  currentState(): MachineState {
    if (this.cursorIndex < 0) return this.requireLoaded();
    return this.traces[this.cursorIndex]!.state;
  }

  /**
   * Advance one cycle. Replays the next already-recorded cycle if there is one (no engine
   * call); otherwise drives the engine one step and records it. Returns the trace now at the
   * cursor, or `null` if the run has already halted at the end (never throws — unlike the
   * raw `Processor.step()`).
   */
  stepForward(): CycleTrace | null {
    this.requireLoaded();
    if (this.cursorIndex < this.traces.length - 1) {
      // Replay a recorded cycle: pure cursor move, returns the same frozen trace.
      this.cursorIndex += 1;
      return this.traces[this.cursorIndex]!;
    }
    // At the high-water mark: only here may we touch the engine.
    if (this.processor.isHalted()) return null;
    const trace = this.processor.step();
    this.traces.push(trace);
    this.cursorIndex = this.traces.length - 1;
    return trace;
  }

  /** Move back one cycle. Returns `false` if already at the pre-run position (-1). */
  stepBack(): boolean {
    this.requireLoaded();
    if (this.cursorIndex < 0) return false;
    this.cursorIndex -= 1;
    return true;
  }

  /**
   * Move the cursor to `cycle`, recording forward as needed. Clamped to `[-1, last
   * recordable cycle]`: `-1` returns to the pre-run state; a target past the end of a halted
   * run stops at the final cycle. Returns the resulting cursor. Like {@link runToEnd},
   * `maxCycles` guards against a runaway program when scrubbing forward into unrecorded cycles
   * (e.g. the step-11 sandbox fork of a user-edited program) — exceeding it throws.
   */
  scrubTo(cycle: number, maxCycles = 1_000_000): number {
    this.requireLoaded();
    while (cycle > this.traces.length - 1 && !this.processor.isHalted()) {
      if (this.traces.length >= maxCycles) {
        throw new Error(`scrubTo exceeded ${maxCycles} cycles — non-terminating program?`);
      }
      this.traces.push(this.processor.step());
    }
    const lastIndex = this.traces.length - 1;
    this.cursorIndex = cycle < -1 ? -1 : cycle > lastIndex ? lastIndex : cycle;
    return this.cursorIndex;
  }

  /**
   * Step forward until the run halts, recording every remaining cycle, and park the cursor
   * at the last cycle. Returns the total number of cycles recorded. `maxCycles` guards
   * against a runaway program (a non-terminating loop) — exceeding it throws.
   */
  runToEnd(maxCycles = 1_000_000): number {
    this.requireLoaded();
    while (!this.processor.isHalted()) {
      if (this.traces.length >= maxCycles) {
        throw new Error(`runToEnd exceeded ${maxCycles} cycles — non-terminating program?`);
      }
      this.traces.push(this.processor.step());
    }
    this.cursorIndex = this.traces.length - 1;
    return this.traces.length;
  }

  /**
   * "Follow this instruction" (handoff §6, INV-4): every recorded cycle in which the
   * instruction `id` is in-flight, with its `location` that cycle. For single-cycle each id
   * appears once; for pipelined models it traces the instruction's journey across stages.
   * Scans only what has been recorded.
   */
  follow(id: string): InstructionSighting[] {
    const sightings: InstructionSighting[] = [];
    for (const trace of this.traces) {
      const inst = trace.instructions.find((i) => i.id === id);
      if (inst) sightings.push({ cycle: trace.cycle, location: inst.location });
    }
    return sightings;
  }

  /** Guard: every navigation/query requires a prior {@link load}. Returns the initial state. */
  private requireLoaded(): MachineState {
    if (this.initial === null) {
      throw new Error('TraceRecorder: call load() before navigating the timeline');
    }
    return this.initial;
  }
}
