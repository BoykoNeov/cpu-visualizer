import { describe, expect, it } from 'vitest';
import {
  makeRegisters,
  SparseMemory,
  TraceRecorder,
  type CycleTrace,
  type InstructionInstance,
  type MachineState,
  type Processor,
  type ProcessorCapabilities,
  type ProgramImage,
  type TraceEvent,
} from './index';

/**
 * Recorder navigation, isolated from any real engine. The DAG (INV-3) forbids `trace` from
 * importing an engine, so these drive a hand-scripted {@link StubProcessor} — which is the
 * better unit boundary anyway: it pins the cursor/replay/scrub logic and the "replaying
 * backward never re-runs the engine" guarantee precisely, independent of ISA semantics. The
 * recorder wired to the REAL single-cycle engine (the actual acceptance criterion) is an
 * integration test in `engine/single-cycle` (recorder.test.ts there).
 */

const STUB_CAPS: ProcessorCapabilities = {
  model: 'stub',
  pipelined: false,
  hasHazards: false,
  configurableForwarding: false,
  configurableBranchPrediction: false,
  configurableCache: false,
};

/** An empty image — the stub ignores it; `load()` just needs something to pass to `reset()`. */
const EMPTY_IMAGE: ProgramImage = {
  words: new Uint32Array(),
  data: [],
  entry: 0,
  sourceMap: new Map(),
};

/**
 * A processor that simply replays a fixed script of {@link CycleTrace}s. Mirrors the real
 * contract: `getState()` is the pre-run state before any step then each cycle's snapshot;
 * `step()` throws once halted; it halts after emitting the last scripted trace (or from reset
 * if the script is empty). `stepCount` lets tests assert the engine is touched only when
 * stepping forward past what's recorded.
 */
class StubProcessor implements Processor {
  readonly capabilities = STUB_CAPS;
  stepCount = 0;
  private index = -1;
  private halted = true;

  constructor(
    private readonly initial: MachineState,
    private readonly script: CycleTrace[],
  ) {}

  reset(_image: ProgramImage, _config: unknown): void {
    void _image;
    void _config;
    this.index = -1;
    this.halted = this.script.length === 0;
  }

  step(): CycleTrace {
    if (this.halted) throw new Error('stub step() while halted');
    this.stepCount += 1;
    this.index += 1;
    if (this.index >= this.script.length - 1) this.halted = true;
    return this.script[this.index]!;
  }

  getState(): MachineState {
    return this.index < 0 ? this.initial : this.script[this.index]!.state;
  }

  isHalted(): boolean {
    return this.halted;
  }
}

/** Build an independent {@link MachineState} snapshot (fresh registers + memory each time). */
function mkState(opts: {
  pc?: number;
  regs?: Record<number, number>;
  mem?: [addr: number, word: number][];
  halted?: boolean;
}): MachineState {
  const registers = makeRegisters();
  for (const [reg, value] of Object.entries(opts.regs ?? {})) registers[Number(reg)] = value;
  const memory = new SparseMemory();
  for (const [addr, word] of opts.mem ?? []) memory.writeWord(addr, word);
  return { pc: opts.pc ?? 0, registers, memory, halted: opts.halted ?? false };
}

function mkTrace(
  cycle: number,
  state: MachineState,
  instructions: InstructionInstance[] = [],
  events: TraceEvent[] = [],
): CycleTrace {
  return { cycle, state, events, instructions };
}

/** A 3-cycle run where x1 becomes 1, 2, 3 — so each cycle's snapshot is distinguishable. */
function countingRun(): { proc: StubProcessor; rec: TraceRecorder } {
  const initial = mkState({ pc: 0, regs: { 1: 0 } });
  const script = [1, 2, 3].map((v, i) =>
    mkTrace(i, mkState({ pc: (i + 1) * 4, regs: { 1: v }, halted: i === 2 })),
  );
  const proc = new StubProcessor(initial, script);
  const rec = new TraceRecorder(proc);
  rec.load(EMPTY_IMAGE);
  return { proc, rec };
}

describe('TraceRecorder: pre-run position and loading', () => {
  it('lands at the pre-run state (cursor -1) after load, before anything runs', () => {
    const { rec } = countingRun();
    expect(rec.cursor).toBe(-1);
    expect(rec.recordedCycles).toBe(0);
    expect(rec.current()).toBeNull();
    expect(rec.currentState().registers[1]).toBe(0); // initial, not yet stepped
    expect(rec.atEnd).toBe(false);
  });

  it('throws if navigated before load()', () => {
    const rec = new TraceRecorder(new StubProcessor(mkState({}), []));
    expect(() => rec.stepForward()).toThrow(/load\(\)/);
    expect(() => rec.currentState()).toThrow(/load\(\)/);
  });

  it('load() restarts recording from scratch (clears prior traces, returns to pre-run)', () => {
    const { rec } = countingRun();
    rec.runToEnd();
    expect(rec.recordedCycles).toBe(3);
    rec.load(EMPTY_IMAGE);
    expect(rec.recordedCycles).toBe(0);
    expect(rec.cursor).toBe(-1);
  });
});

describe('TraceRecorder: forward recording', () => {
  it('records each new cycle and advances the cursor', () => {
    const { rec } = countingRun();
    const c0 = rec.stepForward();
    expect(c0!.cycle).toBe(0);
    expect(rec.cursor).toBe(0);
    expect(rec.recordedCycles).toBe(1);
    expect(rec.currentState().registers[1]).toBe(1);

    rec.stepForward();
    rec.stepForward();
    expect(rec.cursor).toBe(2);
    expect(rec.currentState().registers[1]).toBe(3);
    expect(rec.atEnd).toBe(true);
  });

  it('stepForward() returns null at a halted end and does not advance', () => {
    const { rec } = countingRun();
    rec.runToEnd();
    expect(rec.cursor).toBe(2);
    expect(rec.stepForward()).toBeNull();
    expect(rec.cursor).toBe(2);
  });

  it('runToEnd() records every cycle and parks the cursor at the last', () => {
    const { rec } = countingRun();
    expect(rec.runToEnd()).toBe(3);
    expect(rec.cursor).toBe(2);
    expect(rec.atEnd).toBe(true);
  });

  it('runToEnd() throws on a non-terminating run past maxCycles', () => {
    // A script that never halts: getState/step keep yielding, halt is never set.
    const endless: CycleTrace[] = Array.from({ length: 50 }, (_, i) =>
      mkTrace(i, mkState({ regs: { 1: i } })),
    );
    const proc = new StubProcessor(mkState({}), endless);
    const rec = new TraceRecorder(proc);
    rec.load(EMPTY_IMAGE);
    expect(() => rec.runToEnd(10)).toThrow(/non-terminating/);
  });

  it('scrubTo() throws when scrubbing forward past maxCycles into a non-terminating run', () => {
    const endless: CycleTrace[] = Array.from({ length: 50 }, (_, i) =>
      mkTrace(i, mkState({ regs: { 1: i } })),
    );
    const proc = new StubProcessor(mkState({}), endless);
    const rec = new TraceRecorder(proc);
    rec.load(EMPTY_IMAGE);
    expect(() => rec.scrubTo(40, 10)).toThrow(/non-terminating/);
  });
});

describe('TraceRecorder: time-travel (back / scrub)', () => {
  it('step back to the start shows each cycle’s own recorded snapshot', () => {
    const { rec } = countingRun();
    rec.runToEnd(); // cursor at 2, x1 = 3
    expect(rec.stepBack()).toBe(true);
    expect(rec.currentState().registers[1]).toBe(2); // cycle 1
    expect(rec.stepBack()).toBe(true);
    expect(rec.currentState().registers[1]).toBe(1); // cycle 0
    expect(rec.stepBack()).toBe(true);
    expect(rec.cursor).toBe(-1);
    expect(rec.currentState().registers[1]).toBe(0); // pre-run
    expect(rec.stepBack()).toBe(false); // already at the start
  });

  it('scrubs to any cycle, recording forward as needed, and clamps out-of-range targets', () => {
    const { rec } = countingRun();
    // Jump straight from pre-run to cycle 2 — the recorder drives the engine forward for us.
    expect(rec.scrubTo(2)).toBe(2);
    expect(rec.recordedCycles).toBe(3);
    expect(rec.currentState().registers[1]).toBe(3);

    expect(rec.scrubTo(0)).toBe(0);
    expect(rec.currentState().registers[1]).toBe(1);

    expect(rec.scrubTo(99)).toBe(2); // past the halted end → clamped to the last cycle
    expect(rec.scrubTo(-5)).toBe(-1); // below the start → clamped to the pre-run state
  });

  it('replaying within the recorded range never re-runs the engine', () => {
    const { proc, rec } = countingRun();
    rec.runToEnd();
    expect(proc.stepCount).toBe(3); // the only three real steps

    // Replaying the SAME recorded trace object proves no re-execution (determinism, INV-1).
    const live = rec.current();
    rec.scrubTo(0);
    rec.stepBack();
    rec.scrubTo(2);
    expect(rec.current()).toBe(live); // reference-identical
    rec.stepForward(); // at the end → null, still no engine call
    expect(proc.stepCount).toBe(3);
  });
});

describe('TraceRecorder: empty program', () => {
  it('is halted at the pre-run state with nothing to step', () => {
    const proc = new StubProcessor(mkState({ halted: true }), []);
    const rec = new TraceRecorder(proc);
    rec.load(EMPTY_IMAGE);
    expect(rec.recordedCycles).toBe(0);
    expect(rec.cursor).toBe(-1);
    expect(rec.atEnd).toBe(true);
    expect(rec.stepForward()).toBeNull();
    expect(rec.currentState().halted).toBe(true);
    expect(rec.follow('anything')).toEqual([]);
  });
});

describe('TraceRecorder: follow-this-instruction (INV-4)', () => {
  it('locates a stable id across every recorded cycle it is in-flight', () => {
    // A pipeline-shaped script so follow() spans multiple cycles: iA in IF then ID; iB after.
    const inst = (id: string, location: string): InstructionInstance => ({
      id,
      pc: 0,
      encoding: 0,
      sourceLine: null,
      decoded: { mnemonic: 'addi' } as InstructionInstance['decoded'],
      location,
    });
    const script = [
      mkTrace(0, mkState({}), [inst('iA', 'IF')]),
      mkTrace(1, mkState({}), [inst('iA', 'ID'), inst('iB', 'IF')]),
      mkTrace(2, mkState({ halted: true }), [inst('iB', 'ID')]),
    ];
    const rec = new TraceRecorder(new StubProcessor(mkState({}), script));
    rec.load(EMPTY_IMAGE);
    rec.runToEnd();

    expect(rec.follow('iA')).toEqual([
      { cycle: 0, location: 'IF' },
      { cycle: 1, location: 'ID' },
    ]);
    expect(rec.follow('iB')).toEqual([
      { cycle: 1, location: 'IF' },
      { cycle: 2, location: 'ID' },
    ]);
    expect(rec.follow('absent')).toEqual([]);
  });
});
