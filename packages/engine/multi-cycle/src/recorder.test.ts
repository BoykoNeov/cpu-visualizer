import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { TraceRecorder } from '@cpu-viz/trace';
import { toProgramImage } from '@cpu-viz/engine-common';
import { MultiCycleProcessor } from './index';

/**
 * Time-travel over multi-cycle (m2 step 4). The {@link TraceRecorder} is model-agnostic —
 * multi-cycle just emits MORE `CycleTrace`s per instruction, so the recorder needs zero change;
 * this pins that it works against the real engine's per-cycle snapshots and halt timing.
 *
 * It also lands the first REAL INV-4 payoff: `follow(id)` on ONE instruction returns its
 * `location` at each of its several in-flight cycles (IF→ID→EX→MEM→WB) — the "follow this
 * instruction across its journey" feature (spec §6) that single-cycle could only exercise
 * trivially (one sighting per id).
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
  const rec = new TraceRecorder(new MultiCycleProcessor());
  rec.load(toProgramImage(asm(source)));
  return rec;
}

describe('TraceRecorder × multi-cycle: load → run → back → scrub', () => {
  // Three addis overwriting x1; each commits at its WB cycle (cycles 3, 7, 11). If the engine
  // aliased the live register file, every recorded cycle would show the final 3.
  const overwrite = ['.text', 'addi x1, x0, 1', 'addi x1, x0, 2', 'addi x1, x0, 3', 'ecall'].join(
    '\n',
  );

  it('starts at the pre-run state; the program is loaded but not run', () => {
    const rec = recorderFor(overwrite);
    expect(rec.cursor).toBe(-1);
    expect(rec.recordedCycles).toBe(0);
    expect(rec.currentState().registers[1]).toBe(0);
    expect(rec.currentState().halted).toBe(false);
    expect(rec.currentState().micro ?? null).toBeNull(); // nothing in flight yet
  });

  it('runs forward to completion and parks at the final state', () => {
    const rec = recorderFor(overwrite);
    expect(rec.runToEnd()).toBe(3 * 4 + 2); // three addis (4 cycles) + ecall (2)
    expect(rec.atEnd).toBe(true);
    expect(rec.currentState().registers[1]).toBe(3);
    expect(rec.currentState().halted).toBe(true);
  });

  it('scrubs to any cycle; the value shown is that cycle’s own recorded snapshot', () => {
    const rec = recorderFor(overwrite);
    rec.runToEnd();
    expect(rec.scrubTo(3)).toBe(3); // scrubTo returns the cursor; cycle 3 = addi#1 WB
    expect(rec.currentState().registers[1]).toBe(1);
    rec.scrubTo(7);
    expect(rec.currentState().registers[1]).toBe(2);
    rec.scrubTo(11);
    expect(rec.currentState().registers[1]).toBe(3);

    while (rec.stepBack()) {
      /* walk back to the pre-run state */
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
});

describe('TraceRecorder × multi-cycle: fidelity to a direct engine run', () => {
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

    const direct = new MultiCycleProcessor();
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

describe('TraceRecorder × multi-cycle: follow one instruction across its lifetime (INV-4)', () => {
  it('follows a load through its full IF→ID→EX→MEM→WB phase walk', () => {
    const rec = recorderFor(
      ['.data', 'v: .word 0x2a', '.text', 'la x1, v', 'lw x2, 0(x1)', 'ecall'].join('\n'),
    );
    rec.runToEnd();
    expect(rec.currentState().registers[2]).toBe(0x2a);

    // Find the load's (single) dynamic id from the recording.
    const lwId = rec.recorded.find((t) => t.instructions[0]!.decoded.mnemonic === 'lw')!
      .instructions[0]!.id;

    const sightings = rec.follow(lwId);
    expect(sightings.map((s) => s.location)).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);
    // One phase per cycle, consecutive — a real journey across the timeline.
    const cycles = sightings.map((s) => s.cycle);
    expect(cycles).toEqual([
      cycles[0]!,
      cycles[0]! + 1,
      cycles[0]! + 2,
      cycles[0]! + 3,
      cycles[0]! + 4,
    ]);
  });

  it('follows each dynamic id of a looped instruction through its own 4-cycle walk', () => {
    const rec = recorderFor(
      [
        '.text',
        'addi x1, x0, 0',
        'addi x2, x0, 5',
        'loop:',
        'add  x1, x1, x2', // pc = 8, re-fetched each iteration
        'addi x2, x2, -1',
        'bne  x2, x0, loop',
        'ecall',
      ].join('\n'),
    );
    rec.runToEnd();
    expect(rec.currentState().registers[1]).toBe(15);

    // The distinct ids seen at pc = 8, in first-appearance order.
    const idsAtAdd: string[] = [];
    for (const t of rec.recorded) {
      const inst = t.instructions[0]!;
      if (inst.pc === 8 && !idsAtAdd.includes(inst.id)) idsAtAdd.push(inst.id);
    }
    expect(idsAtAdd).toHaveLength(5); // five iterations, five fresh ids

    for (const id of idsAtAdd) {
      expect(rec.follow(id).map((s) => s.location)).toEqual(['IF', 'ID', 'EX', 'WB']);
    }
  });
});
