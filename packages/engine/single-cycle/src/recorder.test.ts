import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { TraceRecorder } from '@cpu-viz/trace';
import { SingleCycleProcessor, toProgramImage } from './index';

/**
 * The step-5 acceptance criterion end-to-end: the {@link TraceRecorder} driving the REAL
 * single-cycle engine — "Load → step forward to completion → step back to start → scrub to
 * any cycle; shown state always matches the recorded trace." The recorder's own unit test
 * (in `trace`) pins the navigation logic against a stub; this pins that it works against the
 * real engine's snapshots, halt timing, and INV-4 ids — which neither that test nor the
 * step-6 differential test (reference vs single-cycle final state) exercises.
 */

function asm(source: string): AssembledProgram {
  const { program, errors } = assemble(source);
  if (!program) {
    throw new Error(
      'assembly failed:\n' + errors.map((e) => `  ${e.line}:${e.column} ${e.message}`).join('\n'),
    );
  }
  return program;
}

function recorderFor(source: string): TraceRecorder {
  const rec = new TraceRecorder(new SingleCycleProcessor());
  rec.load(toProgramImage(asm(source)));
  return rec;
}

describe('TraceRecorder × single-cycle: load → run → back → scrub', () => {
  // A register overwritten every cycle: if the engine snapshots aliased the live register
  // file, every recorded cycle would show the FINAL 3. This is the load-bearing time-travel
  // check, now end-to-end through the recorder.
  const overwrite = ['.text', 'addi x1, x0, 1', 'addi x1, x0, 2', 'addi x1, x0, 3', 'ecall'].join(
    '\n',
  );

  it('starts at the pre-run state with the program loaded but not yet run', () => {
    const rec = recorderFor(overwrite);
    expect(rec.cursor).toBe(-1);
    expect(rec.recordedCycles).toBe(0);
    expect(rec.currentState().registers[1]).toBe(0);
    expect(rec.currentState().halted).toBe(false);
  });

  it('runs forward to completion and parks at the final state', () => {
    const rec = recorderFor(overwrite);
    expect(rec.runToEnd()).toBe(4); // three addis + ecall
    expect(rec.atEnd).toBe(true);
    expect(rec.currentState().registers[1]).toBe(3);
    expect(rec.currentState().halted).toBe(true);
  });

  it('steps back to the start; each cycle shows its own recorded value', () => {
    const rec = recorderFor(overwrite);
    rec.runToEnd();
    rec.scrubTo(0);
    expect(rec.currentState().registers[1]).toBe(1);
    rec.scrubTo(1);
    expect(rec.currentState().registers[1]).toBe(2);
    rec.scrubTo(2);
    expect(rec.currentState().registers[1]).toBe(3);
    rec.scrubTo(3);
    expect(rec.currentState().registers[1]).toBe(3); // ecall does not touch x1

    while (rec.stepBack()) {
      /* walk all the way back */
    }
    expect(rec.cursor).toBe(-1);
    expect(rec.currentState().registers[1]).toBe(0);
  });

  it('the shown state IS the recorded trace’s own snapshot at every cursor', () => {
    const rec = recorderFor(overwrite);
    rec.runToEnd();
    for (let i = 0; i < rec.recordedCycles; i++) {
      rec.scrubTo(i);
      expect(rec.currentState()).toBe(rec.current()!.state);
    }
  });

  it('scrubs forward lazily, recording cycles on demand', () => {
    const rec = recorderFor(overwrite);
    expect(rec.recordedCycles).toBe(0);
    rec.scrubTo(2); // jump straight from pre-run to cycle 2
    expect(rec.recordedCycles).toBe(3); // had to record 0,1,2 to get there
    expect(rec.currentState().registers[1]).toBe(3);
  });
});

describe('TraceRecorder × single-cycle: fidelity to a direct engine run', () => {
  it('reaches the same final reg+mem state as driving the engine by hand', () => {
    const source = [
      '.data',
      'slot: .word 0',
      '.text',
      'la   x1, slot',
      'addi x2, x0, 99',
      'sw   x2, 0(x1)',
      'lw   x3, 0(x1)',
      'addi x4, x0, 7',
      'sb   x4, 4(x1)',
      'lbu  x5, 4(x1)',
      'ecall',
    ].join('\n');

    const direct = new SingleCycleProcessor();
    direct.reset(toProgramImage(asm(source)));
    while (!direct.isHalted()) direct.step();
    const expected = direct.getState();

    const rec = recorderFor(source);
    rec.runToEnd();
    const actual = rec.currentState();

    expect([...actual.registers]).toEqual([...expected.registers]);
    for (const addr of expected.memory.definedAddresses()) {
      expect(actual.memory.readWord(addr)).toBe(expected.memory.readWord(addr));
    }
    expect(actual.pc).toBe(expected.pc);
    expect(actual.halted).toBe(true);
  });
});

describe('TraceRecorder × single-cycle: follow a looping instruction (INV-4)', () => {
  it('follows each dynamic id of a re-fetched instruction to its single cycle', () => {
    const rec = recorderFor(
      [
        '.text',
        'addi x1, x0, 0', // sum
        'addi x2, x0, 5', // i
        'loop:',
        'add  x1, x1, x2', // pc = 8, re-fetched each iteration
        'addi x2, x2, -1',
        'bne  x2, x0, loop',
        'ecall',
      ].join('\n'),
    );
    rec.runToEnd();
    expect(rec.currentState().registers[1]).toBe(15); // 5+4+3+2+1

    // Collect each recorded cycle's in-flight instruction by scrubbing the timeline.
    const sightings: { cycle: number; id: string; pc: number }[] = [];
    for (let i = 0; i < rec.recordedCycles; i++) {
      rec.scrubTo(i);
      const inst = rec.current()!.instructions[0]!;
      sightings.push({ cycle: i, id: inst.id, pc: inst.pc });
    }

    const addRuns = sightings.filter((s) => s.pc === 8);
    expect(addRuns).toHaveLength(5); // the loop body executed five times
    expect(new Set(addRuns.map((s) => s.id)).size).toBe(5); // each a fresh stable id (INV-4)

    // Each dynamic id is followable to exactly the one cycle it ran in.
    for (const run of addRuns) {
      expect(rec.follow(run.id)).toEqual([{ cycle: run.cycle, location: 'single-cycle' }]);
    }
  });
});
