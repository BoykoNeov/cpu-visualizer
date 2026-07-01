import { describe, expect, it } from 'vitest';
import {
  makeRegisters,
  type CycleTrace,
  type MachineState,
  type MemoryView,
  type TraceEvent,
} from '@cpu-viz/trace';
import {
  activeStepAt,
  anchorLesson,
  anchorOrderViolations,
  anchorTrigger,
  narrationFor,
  type AnchoredStep,
} from './runner';
import type { Lesson } from './lesson';

// A trivial empty memory — anchoring only reads `cycle` + `events`, never state.
const EMPTY_MEMORY: MemoryView = {
  readWord: () => 0,
  definedAddresses: () => [],
};

/** Build a CycleTrace carrying just the fields anchoring cares about (cycle + events). */
function cyc(cycle: number, events: TraceEvent[]): CycleTrace {
  const state: MachineState = {
    pc: 0,
    registers: makeRegisters(),
    memory: EMPTY_MEMORY,
    halted: false,
  };
  return { cycle, state, events, instructions: [] };
}

/**
 * A hand-built recording mirroring the REAL single-cycle event order
 * (instr-fetch → reg-read(s) → alu-op → mem-* → reg-write → instr-retire, per step 4):
 *   cycle 0  addi a0, x0, 5      — no memory
 *   cycle 1  sw   a0, 0(sp)      — two reg-reads, a store, no reg-write
 *   cycle 2  lw   a1, 0(sp)      — a load then a reg-write
 */
const RECORDING: CycleTrace[] = [
  cyc(0, [
    { type: 'instr-fetch', instr: 'i0', pc: 0, encoding: 0x00500513 },
    { type: 'reg-read', reg: 0, value: 0, instr: 'i0' },
    { type: 'alu-op', op: 'add', a: 0, b: 5, result: 5, instr: 'i0' },
    { type: 'reg-write', reg: 10, value: 5, instr: 'i0' },
    { type: 'instr-retire', instr: 'i0' },
  ]),
  cyc(1, [
    { type: 'instr-fetch', instr: 'i1', pc: 4, encoding: 0x00a12023 },
    { type: 'reg-read', reg: 2, value: 0x1000, instr: 'i1' },
    { type: 'reg-read', reg: 10, value: 5, instr: 'i1' },
    { type: 'alu-op', op: 'add', a: 0x1000, b: 0, result: 0x1000, instr: 'i1' },
    { type: 'mem-write', addr: 0x1000, value: 5, instr: 'i1' },
    { type: 'instr-retire', instr: 'i1' },
  ]),
  cyc(2, [
    { type: 'instr-fetch', instr: 'i2', pc: 8, encoding: 0x00012583 },
    { type: 'reg-read', reg: 2, value: 0x1000, instr: 'i2' },
    { type: 'alu-op', op: 'add', a: 0x1000, b: 0, result: 0x1000, instr: 'i2' },
    { type: 'mem-read', addr: 0x1000, value: 5, instr: 'i2' },
    { type: 'reg-write', reg: 11, value: 5, instr: 'i2' },
    { type: 'instr-retire', instr: 'i2' },
  ]),
];

describe('anchorTrigger (event-anchoring, INV-6)', () => {
  it('anchors the first matching event to its cycle + event index', () => {
    // First reg-write is i0 -> a0, at cycle 0, event index 3.
    expect(anchorTrigger({ event: 'reg-write' }, RECORDING)).toEqual({ cycle: 0, eventIndex: 3 });
  });

  it('honors nth across cycles', () => {
    // reg-writes: cycle 0 (a0) is #1, cycle 2 (a1) is #2.
    expect(anchorTrigger({ event: 'reg-write', nth: 2 }, RECORDING)).toEqual({
      cycle: 2,
      eventIndex: 4,
    });
  });

  it('filters by a declarative `where` payload match', () => {
    // The write to register 10 is the first reg-write; the write to 11 is in cycle 2.
    expect(anchorTrigger({ event: 'reg-write', where: { reg: 11 } }, RECORDING)).toEqual({
      cycle: 2,
      eventIndex: 4,
    });
    // A reg-read of register 10 first happens in cycle 1 (i1's second read).
    expect(anchorTrigger({ event: 'reg-read', where: { reg: 10 } }, RECORDING)).toEqual({
      cycle: 1,
      eventIndex: 2,
    });
  });

  it('returns null when the event never fires or nth exceeds the count', () => {
    expect(anchorTrigger({ event: 'stall' }, RECORDING)).toBeNull();
    expect(anchorTrigger({ event: 'reg-write', nth: 3 }, RECORDING)).toBeNull();
    // `where` on a key absent from the event type never matches (no throw).
    expect(anchorTrigger({ event: 'instr-retire', where: { reg: 10 } }, RECORDING)).toBeNull();
    // A matching type but non-matching value.
    expect(anchorTrigger({ event: 'reg-write', where: { reg: 99 } }, RECORDING)).toBeNull();
  });
});

/** A lesson whose three steps anchor at cycles 0, 1, 2 respectively. */
const LESSON: Lesson = {
  id: 'test',
  title: 'test',
  program: 'inline',
  model: 'single-cycle',
  depthDefault: 'detailed',
  steps: [
    {
      trigger: { event: 'reg-write', where: { reg: 10 } },
      narration: { essentials: 'a0 gets 5', expert: 'x10 <- ALU result 5' },
    },
    { trigger: { event: 'mem-write' }, narration: { detailed: 'the store lands in memory' } },
    { trigger: { event: 'mem-read' }, narration: { essentials: 'read it back' } },
  ],
};

describe('anchorLesson', () => {
  it('anchors every step, leaving unmatched triggers null', () => {
    const withMiss: Lesson = {
      ...LESSON,
      steps: [...LESSON.steps, { trigger: { event: 'flush' }, narration: { essentials: 'never' } }],
    };
    const anchored = anchorLesson(withMiss, RECORDING);
    expect(anchored.map((s) => s.cycle)).toEqual([0, 1, 2, null]);
    expect(anchored.map((s) => s.index)).toEqual([0, 1, 2, 3]);
    expect(anchored[3]!.eventIndex).toBeNull();
  });
});

describe('activeStepAt', () => {
  const anchored = anchorLesson(LESSON, RECORDING);

  it('returns null before the first step anchors', () => {
    expect(activeStepAt(anchored, -1)).toBeNull();
  });

  it('holds the current step until the next one anchors', () => {
    expect(activeStepAt(anchored, 0)?.index).toBe(0);
    expect(activeStepAt(anchored, 1)?.index).toBe(1);
    expect(activeStepAt(anchored, 2)?.index).toBe(2);
    // Past the last anchor, the last step stays active.
    expect(activeStepAt(anchored, 99)?.index).toBe(2);
  });

  it('resolves two steps sharing a cycle by event index, not authoring order', () => {
    // Both anchor in cycle 0; the reg-write (eventIndex 3) is later than the reg-read (1).
    const sameCycle: AnchoredStep[] = [
      { step: LESSON.steps[2]!, index: 0, cycle: 0, eventIndex: 3 },
      { step: LESSON.steps[0]!, index: 1, cycle: 0, eventIndex: 1 },
    ];
    // The later-firing event (eventIndex 3) wins even though it's index 0 in the list.
    expect(activeStepAt(sameCycle, 0)?.index).toBe(0);
  });

  it('skips steps that never anchored', () => {
    const withMiss = anchorLesson(
      { ...LESSON, steps: [{ trigger: { event: 'flush' }, narration: {} }, ...LESSON.steps] },
      RECORDING,
    );
    // The unanchored flush step (index 0) must not swallow the active slot at cycle 0.
    expect(activeStepAt(withMiss, 0)?.index).toBe(1);
  });
});

describe('narrationFor', () => {
  const anchored = anchorLesson(LESSON, RECORDING);

  it('resolves the active step narration at the given tier (INV-5 fallback)', () => {
    // Step 0 authored essentials + expert; `detailed` falls back to essentials.
    expect(narrationFor(anchored, 0, 'essentials')).toBe('a0 gets 5');
    expect(narrationFor(anchored, 0, 'detailed')).toBe('a0 gets 5');
    expect(narrationFor(anchored, 0, 'expert')).toBe('x10 <- ALU result 5');
  });

  it('is undefined with no active step, or when nothing is authored at/below the tier', () => {
    expect(narrationFor(anchored, -1, 'expert')).toBeUndefined();
    // Step 1 authored only `detailed`; at essentials there is no variant at/below.
    expect(narrationFor(anchored, 1, 'essentials')).toBeUndefined();
  });
});

describe('anchorOrderViolations (dev-time authoring check)', () => {
  it('is empty when steps anchor in non-decreasing order', () => {
    expect(anchorOrderViolations(anchorLesson(LESSON, RECORDING))).toEqual([]);
  });

  it('flags a step whose trigger fires before the preceding step', () => {
    // Author the mem-read step (cycle 2) BEFORE the mem-write step (cycle 1).
    const outOfOrder: Lesson = {
      ...LESSON,
      steps: [
        { trigger: { event: 'reg-write', where: { reg: 10 } }, narration: {} }, // cycle 0
        { trigger: { event: 'mem-read' }, narration: {} }, // cycle 2
        { trigger: { event: 'mem-write' }, narration: {} }, // cycle 1  <- backward
      ],
    };
    expect(anchorOrderViolations(anchorLesson(outOfOrder, RECORDING))).toEqual([2]);
  });

  it('ignores unanchored steps rather than treating them as a violation', () => {
    const withMiss: Lesson = {
      ...LESSON,
      steps: [
        { trigger: { event: 'reg-write', where: { reg: 10 } }, narration: {} }, // cycle 0
        { trigger: { event: 'flush' }, narration: {} }, // null
        { trigger: { event: 'mem-read' }, narration: {} }, // cycle 2
      ],
    };
    expect(anchorOrderViolations(anchorLesson(withMiss, RECORDING))).toEqual([]);
  });
});
