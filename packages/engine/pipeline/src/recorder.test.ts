import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import {
  defaultConfig,
  TraceRecorder,
  type CycleTrace,
  type ProcessorConfig,
} from '@cpu-viz/trace';
import { PipelineProcessor, type PipelineMicro } from './index';

/**
 * Time-travel over the pipeline (M3 step 4). The {@link TraceRecorder} is model-agnostic, so this
 * step is a PROOF, not a build: the recorder needed zero change to drive a model with five
 * instructions in flight. What is proven here is that the claim is actually true — and the payoff
 * M1 and M2 could not show, because both had exactly one instruction in flight by construction.
 *
 * ## What this file deliberately does NOT re-prove
 *
 * `processor.test.ts` already pins, at the engine level and by hand: the clean five-stage walk,
 * the five-in-flight cycle, the stall's repeated ID cell, and that each cycle's `micro` is its own
 * object rather than a live alias. Those are the ENGINE's soul and they are pinned where they
 * belong. Repeating them through a recorder would not make them any truer.
 *
 * What is genuinely new at this layer, and is all this file asserts:
 *
 *  1. **The recorder's navigation over a real pipeline recording** — the step-4 acceptance
 *     criterion verbatim: load → step forward to halt → step back to start → scrub to any cycle,
 *     with the shown state always the recorded cycle's own snapshot. No such test existed for this
 *     model.
 *  2. **`follow()` — the SHIPPED API, the one the web calls** — across all five stages.
 *     `processor.test.ts` proves the stage walk with a test-local `walk()` helper that reads the
 *     traces directly; that pins the ENGINE, not the recorder feature. The headline is the thing a
 *     one-at-a-time machine cannot express at all: at a single cycle, `follow()` resolves five
 *     DIFFERENT ids to five DIFFERENT locations.
 *  3. **The one walk shape nothing pins yet**: an instruction HELD IN IF across a stall. The
 *     existing INV-4 test follows an instruction that never stalls, and the stall tests follow the
 *     CONSUMER (the repeated `ID` cell). Nobody follows the instruction stuck behind it, whose
 *     `IF IF IF` is the other half of the pinned "what a stall does to IF" decision — and whose
 *     failure mode (re-fetch, minting a second id for one instruction) is a direct INV-4 breach.
 *  4. **That the recording's `micro` tracks the TIMELINE** — the time-travel expression of the
 *     latch-immutability decision, across all four latches and a whole corpus recording, rather
 *     than one latch on a three-instruction program.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

const OFF: ProcessorConfig = { ...defaultConfig(), forwarding: false };
const ON: ProcessorConfig = { ...defaultConfig(), forwarding: true };

function asm(source: string): AssembledProgram {
  const { program, errors } = assemble(source);
  if (!program) {
    throw new Error(
      'assembly failed:\n' + errors.map((e) => `  ${e.line}:${e.column} ${e.message}`).join('\n'),
    );
  }
  return program;
}

function recorderFor(source: string, config: ProcessorConfig = ON): TraceRecorder {
  const rec = new TraceRecorder(new PipelineProcessor());
  rec.load(toProgramImage(asm(source)), config);
  return rec;
}

const micro = (t: CycleTrace): PipelineMicro => t.state.micro as PipelineMicro;

/** The id the recording places at `location` in a given cycle, or undefined if that stage is empty. */
function idAt(t: CycleTrace, location: string): string | undefined {
  return t.instructions.find((i) => i.location === location)?.id;
}

/**
 * Six independent instructions (each reads only x0, each writes a different register), so nothing
 * stalls in EITHER config and the pipe fills completely. The `ecall` is the last word of `.text`,
 * so there is no shadow behind it to squash.
 *
 * Hand-derived timeline — instruction `n` is fetched at cycle `n` and retires at cycle `n+4`:
 *
 * ```
 *  cycle:   0    1    2    3    4    5    6    7    8    9   10
 *  i0      IF   ID   EX  MEM   WB
 *  i1           IF   ID   EX  MEM   WB
 *  i2                IF   ID   EX  MEM   WB
 *  i3                     IF   ID   EX  MEM   WB
 *  i4                          IF   ID   EX  MEM   WB
 *  i5                               IF   ID   EX  MEM   WB
 *  i6 ecall                              ID   EX  MEM   WB      <- fetched at 6, decoded at 7
 * ```
 *
 * Cycles 4, 5 and 6 are the full ones. `cycles = N + 4 + S + 2·T` = 7 + 4 + 0 + 0 = 11.
 */
const SIX_INDEPENDENT = [
  '.text',
  'addi x1, x0, 1',
  'addi x2, x0, 2',
  'addi x3, x0, 3',
  'addi x4, x0, 4',
  'addi x5, x0, 5',
  'addi x6, x0, 6',
  'ecall',
].join('\n');

describe('TraceRecorder × pipeline: load → run → back → scrub', () => {
  /**
   * One register overwritten three times, with no RAW between them (each reads x0), so the program
   * stalls in neither config and the scrub math stays pinnable.
   *
   * The load-bearing difference from the M1/M2 version of this test, and the reason the numbers
   * could not be copied across: in a PIPELINE the writes land at WB, one cycle apart, not at the
   * instruction's own cycle. Hand-derived — i0 retires at cycle 4, i1 at 5, i2 at 6, `ecall` at 7:
   *
   * ```
   *  cycle:   0    1    2    3    4    5    6    7
   *  x1:      0    0    0    0    1    2    3    3
   * ```
   *
   * `cycles = N + 4 + S + 2·T` = 4 + 4 + 0 + 0 = 8.
   */
  const overwrite = ['.text', 'addi x1, x0, 1', 'addi x1, x0, 2', 'addi x1, x0, 3', 'ecall'].join(
    '\n',
  );

  it('starts at the pre-run state; the program is loaded but not run', () => {
    const rec = recorderFor(overwrite);
    expect(rec.cursor).toBe(-1);
    expect(rec.recordedCycles).toBe(0);
    expect(rec.currentState().registers[1]).toBe(0);
    expect(rec.currentState().halted).toBe(false);
    // Unlike M2 (whose `micro` is absent entirely until the first cycle), the pipeline always
    // reports its four latches — at pre-run they are simply all empty. Nothing is in flight yet.
    const m = rec.currentState().micro as PipelineMicro;
    expect([m.ifId, m.idEx, m.exMem, m.memWb]).toEqual([null, null, null, null]);
  });

  it('runs forward to completion and parks at the final state', () => {
    const rec = recorderFor(overwrite);
    expect(rec.runToEnd()).toBe(8); // 4 retires + 4 drain cycles; nothing stalls
    expect(rec.atEnd).toBe(true);
    expect(rec.currentState().registers[1]).toBe(3);
    expect(rec.currentState().halted).toBe(true);
  });

  it('scrubs to any cycle; the value shown is that cycle’s own recorded snapshot', () => {
    const rec = recorderFor(overwrite);
    rec.runToEnd();
    // Nothing has retired yet at cycle 3 — the first write lands at WB, in cycle 4.
    expect(rec.scrubTo(3)).toBe(3); // scrubTo returns the cursor
    expect(rec.currentState().registers[1]).toBe(0);
    rec.scrubTo(4);
    expect(rec.currentState().registers[1]).toBe(1);
    rec.scrubTo(5);
    expect(rec.currentState().registers[1]).toBe(2);
    rec.scrubTo(6);
    expect(rec.currentState().registers[1]).toBe(3);
    rec.scrubTo(7);
    expect(rec.currentState().registers[1]).toBe(3); // the ecall does not touch x1

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

  it('scrubs forward lazily, recording cycles on demand', () => {
    const rec = recorderFor(overwrite);
    expect(rec.recordedCycles).toBe(0);
    rec.scrubTo(4); // jump straight from pre-run to the first cycle that retires anything
    expect(rec.recordedCycles).toBe(5); // had to record 0..4 to get there
    expect(rec.currentState().registers[1]).toBe(1);
  });
});

describe('TraceRecorder × pipeline: fidelity to a direct engine run', () => {
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

    const direct = new PipelineProcessor();
    direct.reset(toProgramImage(asm(source)), ON);
    while (!direct.isHalted()) direct.step();
    const expected = direct.getState();

    const rec = recorderFor(source, ON);
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

describe('TraceRecorder × pipeline: five in flight, individually followable (INV-4)', () => {
  it('resolves five different ids to five different locations in one cycle', () => {
    const rec = recorderFor(SIX_INDEPENDENT, ON);
    rec.runToEnd();
    expect(rec.recordedCycles).toBe(11);

    rec.scrubTo(4);
    const inFlight = rec.current()!.instructions;
    expect(inFlight).toHaveLength(5);

    // Read the ids FROM the recording — never hardcode them; `follow()` is what has to resolve
    // them, and an id the test invented would prove nothing about the recorded trace.
    const ids = inFlight.map((i) => i.id);
    expect(new Set(ids).size).toBe(5);

    // The point M1 and M2 could not express: ONE cycle, five ids, five distinct stages. `follow()`
    // is what makes each of them individually legible — without it the cycle is an undifferentiated
    // five-instruction blob, which is why this is the first tier where following is the only way to
    // read the trace at all.
    const located = ids.map((id) => rec.follow(id).find((s) => s.cycle === 4)!.location);
    expect(located).toEqual(['WB', 'MEM', 'EX', 'ID', 'IF']);
    expect(new Set(located).size).toBe(5);
  });

  it('follows ONE instruction across all five stages while four others are in flight', () => {
    const rec = recorderFor(SIX_INDEPENDENT, ON);
    rec.runToEnd();

    // The instruction sitting in EX at cycle 4 — picked from the recording, mid-journey, with two
    // older instructions ahead of it and two younger behind.
    const followed = idAt(rec.recorded[4]!, 'EX')!;

    // Its whole life: one id, five stages, five consecutive cycles (INV-4). This is the "follow
    // this instruction" feature over a model where the instruction genuinely travels.
    expect(rec.follow(followed)).toEqual([
      { cycle: 2, location: 'IF' },
      { cycle: 3, location: 'ID' },
      { cycle: 4, location: 'EX' },
      { cycle: 5, location: 'MEM' },
      { cycle: 6, location: 'WB' },
    ]);

    // ...and the explicit half: at cycle 4 the OTHER four are simultaneously in flight, each
    // somewhere else. Following one instruction does not mean the machine is running one.
    const others = rec.recorded[4]!.instructions.filter((i) => i.id !== followed);
    expect(others).toHaveLength(4);
    expect(others.map((i) => i.location)).toEqual(['WB', 'MEM', 'ID', 'IF']);
    for (const other of others) {
      // Each is a real instruction with its own five-cycle journey, staggered one cycle apart —
      // not a phantom of the followed one.
      expect(rec.follow(other.id).map((s) => s.location)).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);
    }
  });

  it('follows an instruction HELD IN IF across a stall — one id, fetched once', () => {
    // Forwarding off, a distance-1 RAW: the consumer interlocks in ID for two cycles, and the
    // `ecall` behind it has nowhere to go — it is HELD in the IF stage, the `IF IF IF` cell of
    // every textbook diagram.
    //
    // Nothing pins this walk today: the INV-4 test follows an instruction that never stalls, and
    // the stall tests follow the CONSUMER (whose repeated cell is `ID`). This is the other half of
    // the pinned "what a stall does to IF" decision, and the failure mode is precisely an INV-4
    // breach — a re-fetch would mint a SECOND id for one instruction, and `follow()` on either id
    // would then show a walk with a hole in it.
    const rec = recorderFor(['.text', 'addi x1, x0, 9', 'add x2, x1, x0', 'ecall'].join('\n'), OFF);
    rec.runToEnd();
    expect(rec.recordedCycles).toBe(9); // N=3, S=2, T=0 → 3 + 4 + 2

    const ECALL_PC = 8;
    const fetches = rec.recorded.flatMap((t) =>
      t.events.filter((e) => e.type === 'instr-fetch' && e.pc === ECALL_PC),
    );
    // Held, NOT re-fetched. This is the assertion that would fail the moment IF re-fetched the
    // held instruction instead of holding it: one instruction, one fetch, one id, forever.
    expect(fetches).toHaveLength(1);

    const ecallId = idAt(rec.recorded[2]!, 'IF')!;
    expect(rec.follow(ecallId).map((s) => s.location)).toEqual([
      'IF', // fetched at cycle 2, behind a consumer that is about to interlock...
      'IF', // ...and held, twice, because ID is still occupied
      'IF',
      'ID',
      'EX',
      'MEM',
      'WB',
    ]);
  });
});

describe('TraceRecorder × pipeline: a real corpus recording', () => {
  const sumLoop = readFileSync(`${PROGRAMS_DIR}sum-loop.s`, 'utf8');

  it('mints a fresh id per loop iteration and follows each through its own five stages', () => {
    // `sum-loop.s`, forwarding ON: the pinned table gives S_on = 0, so nothing in this program
    // stalls in this position and every retiring instruction gets the clean five-stage walk.
    const rec = recorderFor(sumLoop, ON);
    rec.runToEnd();
    expect(rec.currentState().registers[10]).toBe(55); // a0 = 10+9+...+1

    // The loop body's `add a0, a0, t0` sits at a fixed pc and is re-fetched every iteration.
    const LOOP_ADD_PC = 8;
    const ids: string[] = [];
    for (const t of rec.recorded) {
      for (const i of t.instructions) {
        if (i.pc === LOOP_ADD_PC && !ids.includes(i.id)) ids.push(i.id);
      }
    }
    expect(ids).toHaveLength(10); // ten iterations, ten fresh ids (INV-4)

    for (const id of ids) {
      expect(rec.follow(id).map((s) => s.location)).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);
    }
  });

  it.each([
    ['forwarding off', OFF],
    ['forwarding on', ON],
  ])('the recorded `micro` tracks the timeline, cycle by cycle [%s]', (_label, config) => {
    // The TIME-TRAVEL expression of the latch-immutability decision. `processor.test.ts` pins that
    // each cycle's `micro` is its own object (one latch, three instructions); this pins the
    // stronger and more useful claim, across all four latches and a whole corpus recording with
    // stalls, flushes and a loop in it:
    //
    //   the latch contents recorded at the END of cycle i name exactly the instructions the
    //   recording places in ID/EX/MEM/WB at cycle i+1.
    //
    // That is what a latch aliased across cycles would destroy: every recorded cycle's `micro`
    // would report the FINAL cycle's occupants, and this would fail at the first cycle. Conformance
    // reads only the last cycle and is structurally blind to it — time-travel is where it surfaces.
    //
    // The four latches, and deliberately not IF: IF has no latch behind it (five stages, four
    // latches), so its occupant is fetched, never presented by `micro`.
    const rec = recorderFor(sumLoop, config);
    rec.runToEnd();
    expect(rec.recordedCycles).toBeGreaterThan(50); // a real recording, not a two-cycle toy

    for (let i = 0; i < rec.recordedCycles - 1; i++) {
      const m = micro(rec.recorded[i]!);
      const next = rec.recorded[i + 1]!;
      expect({
        ifId: m.ifId?.instr,
        idEx: m.idEx?.instr,
        exMem: m.exMem?.instr,
        memWb: m.memWb?.instr,
      }).toEqual({
        ifId: idAt(next, 'ID'),
        idEx: idAt(next, 'EX'),
        exMem: idAt(next, 'MEM'),
        memWb: idAt(next, 'WB'),
      });
    }
  });
});
