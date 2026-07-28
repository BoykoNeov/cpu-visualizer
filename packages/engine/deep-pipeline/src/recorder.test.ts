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
import { DeepPipelineProcessor, type DeepPipelineMicro } from './index';

/**
 * Time-travel over the deep pipeline (M11 step 4). The {@link TraceRecorder} is model-agnostic, so
 * this is a PROOF, not a build: the recorder needed zero change to drive a model with SEVEN
 * instructions in flight. The 5-stage's version of this file made the same claim at five; what is
 * new is that the recorder has now been driven past the depth every shipped model had in common.
 *
 * ## What this file deliberately does NOT re-prove
 *
 * `processor.test.ts` pins the engine's soul by hand — the clean seven-stage walk, the ALU→ALU
 * bubble, the two-cycle load-use interlock, all five flush shapes, and that each cycle's `micro` is
 * its own object. `timing.test.ts` pins every cycle count in the corpus. Neither is repeated here;
 * driving them through a recorder would not make them any truer.
 *
 * What is genuinely new at this layer, and is all this file asserts:
 *
 *  1. **The recorder's navigation over a real deep recording** — the step-4 acceptance criterion
 *     verbatim: load → step forward to halt → step back to start → scrub to any cycle, with the
 *     shown state always the recorded cycle's own snapshot.
 *  2. **`follow()` — the SHIPPED API, the one the web calls — across all SEVEN stages.** The
 *     headline is the one a five-stage recording cannot express: at a single cycle, `follow()`
 *     resolves seven DIFFERENT ids to seven DIFFERENT locations. `IF1` and `IF2` are two of them,
 *     and `EX1`/`EX2` are two more — so an API that keyed an instruction by its stage FAMILY rather
 *     than its exact `location` would collapse seven into five right here.
 *  3. **The stall shape that only a deep front end has: THREE held cells at once.** The 5-stage's
 *     stall repeats two cells (`ID` and `IF`); this machine repeats `ID`, `IF2` **and** `IF1`,
 *     because there are two fetch stages behind the interlock. The failure mode is the same INV-4
 *     breach the 5-stage's test guards — a re-fetch would mint a second id for one instruction —
 *     but there are now two distinct places it could happen, and only one of them (`IF1`) is the
 *     one the 5-stage ever exercised.
 *  4. **That the recording's `micro` tracks the TIMELINE across all SIX latches.** Seven stages,
 *     six latches, so this pins six of the seven stages against the recording — where the 5-stage's
 *     equivalent pins four of five. IF1 is the one stage with no latch behind it: its occupant is
 *     fetched, never presented by `micro`.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

// `cache: null` is written EXPLICITLY rather than inherited, the step-2 pin. It meant "this machine
// REFUSES a non-null cache, so an inherited default would throw rather than redden"; since M11 step
// 6 honors the cache it means something stronger — an inherited default would put every assertion
// below on a DIFFERENT machine, with cycle counts that are lawful for it and wrong for this file.
const OFF: ProcessorConfig = { ...defaultConfig(), forwarding: false, cache: null };
const ON: ProcessorConfig = { ...defaultConfig(), forwarding: true, cache: null };

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
  const rec = new TraceRecorder(new DeepPipelineProcessor());
  rec.load(toProgramImage(asm(source)), config);
  return rec;
}

const micro = (t: CycleTrace): DeepPipelineMicro => t.state.micro as DeepPipelineMicro;

/** The id the recording places at `location` in a given cycle, or undefined if that stage is empty. */
function idAt(t: CycleTrace, location: string): string | undefined {
  return t.instructions.find((i) => i.location === location)?.id;
}

/** A followed walk with consecutive repeats collapsed — the STAGE SEQUENCE, stalls factored out. */
function collapsed(walk: readonly string[]): string[] {
  return walk.filter((loc, i) => loc !== walk[i - 1]);
}

const SEVEN_STAGES = ['IF1', 'IF2', 'ID', 'EX1', 'EX2', 'MEM', 'WB'];

/**
 * SEVEN independent instructions (each reads only x0, each writes a different register), so nothing
 * stalls in EITHER config and the pipe fills completely. Seven, not the 5-stage's six: it takes one
 * per stage to fill a seven-stage machine, and the `ecall` cannot be one of them (it squashes
 * everything younger at ID). It is the last word of `.text`, so the fetch pointer is already out of
 * text when it decodes and there is no shadow to squash — no flush, no penalty.
 *
 * Hand-derived timeline — instruction `n` is fetched at cycle `n` and retires at cycle `n+6`:
 *
 * ```
 *  cycle:   0    1    2    3    4    5    6    7    8    9   10   11   12   13
 *  i0     IF1  IF2   ID  EX1  EX2  MEM   WB
 *  i1          IF1  IF2   ID  EX1  EX2  MEM   WB
 *  i2               IF1  IF2   ID  EX1  EX2  MEM   WB
 *  i3                    IF1  IF2   ID  EX1  EX2  MEM   WB
 *  i4                         IF1  IF2   ID  EX1  EX2  MEM   WB
 *  i5                              IF1  IF2   ID  EX1  EX2  MEM   WB
 *  i6                                   IF1  IF2   ID  EX1  EX2  MEM   WB
 *  i7 ecall                                  IF1  IF2   ID  EX1  EX2  MEM   WB
 * ```
 *
 * Cycles 6 and 7 are the full ones — seven in flight, which is two more than any model before this
 * one could hold. `cycles = N + 6 + S + P` = 8 + 6 + 0 + 0 = 14.
 */
const SEVEN_INDEPENDENT = [
  '.text',
  'addi x1, x0, 1',
  'addi x2, x0, 2',
  'addi x3, x0, 3',
  'addi x4, x0, 4',
  'addi x5, x0, 5',
  'addi x6, x0, 6',
  'addi x7, x0, 7',
  'ecall',
].join('\n');

describe('TraceRecorder × deep pipeline: load → run → back → scrub', () => {
  /**
   * One register overwritten three times, with no RAW between them (each reads x0), so the program
   * stalls in neither config and the scrub math stays pinnable.
   *
   * The load-bearing difference from the 5-stage's version of this test, and the reason its numbers
   * could not be copied across: the writes still land at WB one cycle apart, but WB is now two
   * stages further from fetch, so every one of them lands two cycles LATER. Hand-derived — i0
   * retires at cycle 6, i1 at 7, i2 at 8, `ecall` at 9:
   *
   * ```
   *  cycle:   0    1    2    3    4    5    6    7    8    9
   *  x1:      0    0    0    0    0    0    1    2    3    3
   * ```
   *
   * `cycles = N + 6 + S + P` = 4 + 6 + 0 + 0 = 10.
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
    // The deep pipeline always reports its SIX latches — at pre-run they are simply all empty.
    const m = rec.currentState().micro as DeepPipelineMicro;
    expect([m.if1If2, m.if2Id, m.idEx1, m.ex1Ex2, m.ex2Mem, m.memWb]).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('runs forward to completion and parks at the final state', () => {
    const rec = recorderFor(overwrite);
    expect(rec.runToEnd()).toBe(10); // 4 retires + 6 drain cycles; nothing stalls
    expect(rec.atEnd).toBe(true);
    expect(rec.currentState().registers[1]).toBe(3);
    expect(rec.currentState().halted).toBe(true);
  });

  it('scrubs to any cycle; the value shown is that cycle’s own recorded snapshot', () => {
    const rec = recorderFor(overwrite);
    rec.runToEnd();
    // Nothing has retired yet at cycle 5 — the first write lands at WB, in cycle 6. On the 5-stage
    // the same program has already written twice by then; the extra two cycles ARE the depth.
    expect(rec.scrubTo(5)).toBe(5); // scrubTo returns the cursor
    expect(rec.currentState().registers[1]).toBe(0);
    rec.scrubTo(6);
    expect(rec.currentState().registers[1]).toBe(1);
    rec.scrubTo(7);
    expect(rec.currentState().registers[1]).toBe(2);
    rec.scrubTo(8);
    expect(rec.currentState().registers[1]).toBe(3);
    rec.scrubTo(9);
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
    rec.scrubTo(6); // jump straight from pre-run to the first cycle that retires anything
    expect(rec.recordedCycles).toBe(7); // had to record 0..6 to get there
    expect(rec.currentState().registers[1]).toBe(1);
  });
});

describe('TraceRecorder × deep pipeline: fidelity to a direct engine run', () => {
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

    const direct = new DeepPipelineProcessor();
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

describe('TraceRecorder × deep pipeline: SEVEN in flight, individually followable (INV-4)', () => {
  it('resolves seven different ids to seven different locations in one cycle', () => {
    const rec = recorderFor(SEVEN_INDEPENDENT, ON);
    rec.runToEnd();
    expect(rec.recordedCycles).toBe(14);

    rec.scrubTo(6);
    const inFlight = rec.current()!.instructions;
    expect(inFlight).toHaveLength(7);

    // Read the ids FROM the recording — never hardcode them; `follow()` is what has to resolve
    // them, and an id the test invented would prove nothing about the recorded trace.
    const ids = inFlight.map((i) => i.id);
    expect(new Set(ids).size).toBe(7);

    // The point no shallower model can express: ONE cycle, seven ids, seven distinct stages. Note
    // that `IF1`/`IF2` and `EX1`/`EX2` are two pairs sharing a stage FAMILY — a `follow()` that
    // resolved to families rather than exact locations would report five here, and the two extra
    // instructions would become invisible at exactly the cycle the machine is fullest.
    const located = ids.map((id) => rec.follow(id).find((s) => s.cycle === 6)!.location);
    expect(located).toEqual(['WB', 'MEM', 'EX2', 'EX1', 'ID', 'IF2', 'IF1']);
    expect(new Set(located).size).toBe(7);
  });

  it('follows ONE instruction across all seven stages while six others are in flight', () => {
    const rec = recorderFor(SEVEN_INDEPENDENT, ON);
    rec.runToEnd();

    // The instruction sitting in EX1 at cycle 6 — picked from the recording, mid-journey, with
    // three older instructions ahead of it and three younger behind.
    const followed = idAt(rec.recorded[6]!, 'EX1')!;

    // Its whole life: one id, seven stages, seven consecutive cycles (INV-4).
    expect(rec.follow(followed)).toEqual([
      { cycle: 3, location: 'IF1' },
      { cycle: 4, location: 'IF2' },
      { cycle: 5, location: 'ID' },
      { cycle: 6, location: 'EX1' },
      { cycle: 7, location: 'EX2' },
      { cycle: 8, location: 'MEM' },
      { cycle: 9, location: 'WB' },
    ]);

    // ...and the explicit half: at cycle 6 the OTHER six are simultaneously in flight, each
    // somewhere else. Following one instruction does not mean the machine is running one.
    const others = rec.recorded[6]!.instructions.filter((i) => i.id !== followed);
    expect(others).toHaveLength(6);
    expect(others.map((i) => i.location)).toEqual(['WB', 'MEM', 'EX2', 'ID', 'IF2', 'IF1']);
    for (const other of others) {
      // Each is a real instruction with its own seven-cycle journey, staggered one cycle apart —
      // not a phantom of the followed one.
      expect(rec.follow(other.id).map((s) => s.location)).toEqual(SEVEN_STAGES);
    }
  });

  /**
   * The stall picture a two-deep front end draws, and the shape the 5-stage's recorder test could
   * not reach: ONE interlock, THREE simultaneously held cells.
   *
   * Forwarding off, a distance-1 RAW, and two more independent instructions behind it so both fetch
   * stages have an occupant to hold. Hand-derived (a forwarding-OFF RAW is a 3-cycle stall; the
   * consumer waits in ID until the producer's WB, which runs first in the walk):
   *
   * ```
   *  cycle:      0    1    2    3    4    5    6    7    8    9   10   11   12   13
   *  i0 addi   IF1  IF2   ID  EX1  EX2  MEM   WB
   *  i1 add         IF1  IF2   ID   ID   ID   ID  EX1  EX2  MEM   WB
   *  i2 addi             IF1  IF2  IF2  IF2  IF2   ID  EX1  EX2  MEM   WB
   *  i3 addi                  IF1  IF1  IF1  IF1  IF2   ID  EX1  EX2  MEM   WB
   *  i4 ecall                                 IF1  IF2   ID  EX1  EX2  MEM   WB
   * ```
   *
   * `cycles = N + 6 + S + P` = 5 + 6 + 3 + 0 = 14. The `ecall` is fetched at cycle 7, the first
   * cycle IF1 is free again, and decodes at 9 with both fetch stages behind it already empty — so
   * its halt squash kills nobody and emits no flush.
   */
  it('holds ID, IF2 and IF1 at once across a stall — three repeated cells, one fetch each', () => {
    const rec = recorderFor(
      [
        '.text',
        'addi x1, x0, 9', // i0 — the producer
        'add  x2, x1, x0', // i1 — interlocks in ID for three cycles
        'addi x3, x0, 1', // i2 — held in IF2 behind it
        'addi x4, x0, 2', // i3 — held in IF1 behind that
        'ecall', // i4
      ].join('\n'),
      OFF,
    );
    rec.runToEnd();
    expect(rec.recordedCycles).toBe(14);

    // One instruction, one fetch, one id, forever — for EVERY instruction, not just the one being
    // followed. This is the assertion that would fail the moment a held stage re-fetched its
    // occupant instead of holding it: five instructions, five `instr-fetch` events, and the ids
    // they carry are exactly the ids the recording ever places anywhere.
    const fetches = rec.recorded.flatMap((t) => t.events.filter((e) => e.type === 'instr-fetch'));
    expect(fetches.map((e) => (e.type === 'instr-fetch' ? e.pc : -1))).toEqual([0, 4, 8, 12, 16]);
    const everSeen = new Set(rec.recorded.flatMap((t) => t.instructions.map((i) => i.id)));
    expect(everSeen.size).toBe(5);

    // The three held walks. `ID ID ID ID` is the 5-stage's shape one stage over; `IF2 IF2 IF2 IF2`
    // is the cell that only exists because the front end is two deep, and `IF1 IF1 IF1 IF1` is the
    // one the 5-stage does pin — all three from a SINGLE interlock, which is the picture.
    const walkOf = (cycle: number, location: string): string[] =>
      rec.follow(idAt(rec.recorded[cycle]!, location)!).map((s) => s.location);

    expect(walkOf(3, 'ID')).toEqual([
      'IF1',
      'IF2',
      'ID', // reaches ID at cycle 3 and interlocks: the producer is in EX1...
      'ID', // ...then EX2...
      'ID', // ...then MEM. Only the producer's WB (which runs first in the walk) releases it.
      'ID',
      'EX1',
      'EX2',
      'MEM',
      'WB',
    ]);
    expect(walkOf(3, 'IF2')).toEqual([
      'IF1',
      'IF2', // arrives in IF2 at cycle 3 and is held there while ID is occupied
      'IF2',
      'IF2',
      'IF2',
      'ID',
      'EX1',
      'EX2',
      'MEM',
      'WB',
    ]);
    expect(walkOf(3, 'IF1')).toEqual([
      'IF1', // fetched at cycle 3 and held in IF1 — never re-fetched (INV-4)
      'IF1',
      'IF1',
      'IF1',
      'IF2',
      'ID',
      'EX1',
      'EX2',
      'MEM',
      'WB',
    ]);

    // All three are held by ONE interlock: the three `stall` events name the same instruction, and
    // it is the one in ID. The two behind it never stall in their own right — they are simply
    // blocked, which is why their repeated cells carry no `stall` event of their own.
    const stalls = rec.recorded.flatMap((t) => t.events.filter((e) => e.type === 'stall'));
    expect(stalls).toHaveLength(3);
    const consumer = idAt(rec.recorded[3]!, 'ID')!;
    for (const s of stalls) {
      expect(s.type === 'stall' && s.instr).toBe(consumer);
      expect(s.type === 'stall' && s.stage).toBe('ID');
    }
  });
});

describe('TraceRecorder × deep pipeline: a real corpus recording', () => {
  const sumLoop = readFileSync(`${PROGRAMS_DIR}sum-loop.s`, 'utf8');

  it('mints a fresh id per loop iteration and follows each through its own seven stages', () => {
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

    // Asserted with consecutive repeats COLLAPSED, which is where this parts company with the
    // 5-stage's version of the same test. There, `sum-loop` at forwarding ON has S = 0 and every
    // walk is literally five stages long. Here it is not: the first iteration's `add` depends on
    // `li t0, 10` at distance 1, and forwarding cannot buy that back — the ALU→ALU bubble is the
    // whole model. So the claim is the SEQUENCE (every instruction visits all seven stages, in
    // order, and never revisits one it has left), with the stall's repeated cell factored out.
    // `timing.test.ts` owns the count of those repeats; this owns the shape.
    for (const id of ids) {
      expect(collapsed(rec.follow(id).map((s) => s.location))).toEqual(SEVEN_STAGES);
    }
    // ...and the stall really is in there, so the collapse is doing work rather than hiding an
    // engine that never stalls: exactly one of the ten walks is longer than seven cycles.
    expect(ids.filter((id) => rec.follow(id).length > 7)).toHaveLength(1);
  });

  it.each([
    ['forwarding off', OFF],
    ['forwarding on', ON],
  ])('the recorded `micro` tracks the timeline, cycle by cycle [%s]', (_label, config) => {
    // The TIME-TRAVEL expression of the latch-immutability decision. `processor.test.ts` pins that
    // each cycle's `micro` is its own object (one latch, a three-instruction program); this pins the
    // stronger and more useful claim, across all SIX latches and a whole corpus recording with
    // stalls, flushes and a loop in it:
    //
    //   the latch contents recorded at the END of cycle i name exactly the instructions the
    //   recording places in IF2/ID/EX1/EX2/MEM/WB at cycle i+1.
    //
    // That is what a latch aliased across cycles would destroy: every recorded cycle's `micro`
    // would report the FINAL cycle's occupants, and this would fail at the first cycle. Conformance
    // reads only the last cycle and is structurally blind to it — time-travel is where it surfaces.
    //
    // Six latches for seven stages, so this covers every stage but IF1 — which has no latch behind
    // it and whose occupant is fetched rather than presented. The 5-stage's equivalent covers four
    // of five; the extra depth is extra coverage here, not a gap.
    const rec = recorderFor(sumLoop, config);
    rec.runToEnd();
    expect(rec.recordedCycles).toBeGreaterThan(50); // a real recording, not a two-cycle toy

    for (let i = 0; i < rec.recordedCycles - 1; i++) {
      const m = micro(rec.recorded[i]!);
      const next = rec.recorded[i + 1]!;
      expect({
        if1If2: m.if1If2?.instr,
        if2Id: m.if2Id?.instr,
        idEx1: m.idEx1?.instr,
        ex1Ex2: m.ex1Ex2?.instr,
        ex2Mem: m.ex2Mem?.instr,
        memWb: m.memWb?.instr,
      }).toEqual({
        if1If2: idAt(next, 'IF2'),
        if2Id: idAt(next, 'ID'),
        idEx1: idAt(next, 'EX1'),
        ex1Ex2: idAt(next, 'EX2'),
        ex2Mem: idAt(next, 'MEM'),
        memWb: idAt(next, 'WB'),
      });
    }
  });
});
