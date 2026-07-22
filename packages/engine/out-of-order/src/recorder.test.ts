import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import { defaultConfig, TraceRecorder, type ProcessorConfig } from '@cpu-viz/trace';
import { OutOfOrderProcessor } from './index';

/**
 * Time-travel over the out-of-order model (M9 step 1a). Like every earlier model's recorder
 * suite, this is a PROOF, not a build: `packages/trace/src/recorder.ts` is UNTOUCHED. `follow()`
 * keys on `id`, never on `location`, and `InstructionSighting.location`'s own doc already cites
 * `"ROB#3"` as an example — so this model's `location` needed no recorder change either.
 *
 * ## Why this file is SHORTER than the superscalar/pipeline recorder suites
 *
 * Those suites spend most of their length on two things this model does not have:
 *
 *  - **Slot arrays / `micro`.** Step 1a deliberately leaves `MachineState.micro` unset (see
 *    `processor.ts`'s file header) — there is no per-slot latch state to prove doesn't alias
 *    across cycles, and no "a slot is not a stable lane" story to tell, because there is no slot.
 *    An in-flight instruction's `location` is `"ROB#<tag>"` for its ENTIRE dispatch-to-commit
 *    lifetime — the opposite claim from superscalar's, and the one this file pins instead.
 *  - **Pairing/refusal mechanics.** There is no `pairing.test.ts` sibling here — dispatch has no
 *    instruction-mix rule (the file header explains where those rules actually live at 1a).
 *
 * What IS genuinely new at this layer and worth pinning:
 *
 *  1. Recorder navigation (load → run → back → scrub) over a ROB-based engine.
 *  2. `location` is STABLE while in flight — the direct opposite of the superscalar's headline,
 *     and the thing a future step-6 view will rely on to draw one box per in-flight instruction
 *     without it jumping seats.
 *  3. INV-4 over concurrent in-flight instructions at `issueWidth: 2` — distinct tags, distinct
 *     ids, no aliasing.
 *  4. The width toggle, through the shipped API — same architectural answer, fewer cycles.
 *  5. `state.micro` is genuinely absent, not merely unchecked — a schema-shape assertion, since
 *     "no schema change at 1a" is a claim this file can make concrete.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

const W1: ProcessorConfig = { ...defaultConfig(), issueWidth: 1 };
const W2: ProcessorConfig = { ...defaultConfig(), issueWidth: 2 };

function asm(source: string): AssembledProgram {
  const { program, errors } = assemble(source);
  if (!program) {
    throw new Error(
      'assembly failed:\n' + errors.map((e) => `  ${e.line}:${e.column} ${e.message}`).join('\n'),
    );
  }
  return program;
}

function recorderFor(source: string, config: ProcessorConfig = W2): TraceRecorder {
  const rec = new TraceRecorder(new OutOfOrderProcessor());
  rec.load(toProgramImage(asm(source)), config);
  return rec;
}

/**
 * Five independent instructions (each reads only x0, each writes a different register) then
 * `ecall` — nothing stalls, nothing waits on a broadcast, so at `issueWidth: 2` dispatch/issue
 * run flat-out at the ROB's own pace.
 */
const FIVE_INDEPENDENT = [
  '.text',
  ...Array.from({ length: 5 }, (_, n) => `addi x${n + 1}, x0, ${n + 1}`),
  'ecall',
].join('\n');

describe('TraceRecorder × out-of-order: load → run → back → scrub', () => {
  const sumLoop = readFileSync(`${PROGRAMS_DIR}sum-loop.s`, 'utf8');

  it('starts at the pre-run state', () => {
    const rec = recorderFor(sumLoop);
    expect(rec.cursor).toBe(-1);
    expect(rec.recordedCycles).toBe(0);
    expect(rec.currentState().registers[10]).toBe(0);
    expect(rec.currentState().halted).toBe(false);
  });

  it('runs to completion and parks at the final state', () => {
    const rec = recorderFor(sumLoop);
    rec.runToEnd();
    expect(rec.atEnd).toBe(true);
    expect(rec.currentState().registers[10]).toBe(55); // a0 = 10+9+...+1
    expect(rec.currentState().halted).toBe(true);
  });

  it('the shown state IS the recorded trace’s own snapshot at every cursor', () => {
    const rec = recorderFor(sumLoop);
    rec.runToEnd();
    for (let i = 0; i < rec.recordedCycles; i++) {
      rec.scrubTo(i);
      expect(rec.currentState()).toBe(rec.current()!.state);
    }
  });

  it('scrubs forward lazily, recording cycles on demand', () => {
    const rec = recorderFor(FIVE_INDEPENDENT);
    expect(rec.recordedCycles).toBe(0);
    rec.scrubTo(2);
    expect(rec.recordedCycles).toBe(3); // had to record 0..2 to get there
  });

  it('walks all the way back to the pre-run state', () => {
    const rec = recorderFor(FIVE_INDEPENDENT);
    rec.runToEnd();
    while (rec.stepBack()) {
      /* walk back to the pre-run state */
    }
    expect(rec.cursor).toBe(-1);
    expect(rec.currentState().registers[1]).toBe(0);
  });

  it('reaches the same final state as driving the engine by hand', () => {
    const direct = new OutOfOrderProcessor();
    direct.reset(toProgramImage(asm(sumLoop)), W2);
    while (!direct.isHalted()) direct.step();
    const expected = direct.getState();

    const rec = recorderFor(sumLoop, W2);
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

describe('TraceRecorder × out-of-order: `location` is STABLE while in flight', () => {
  it('an instruction’s location never changes across its dispatch-to-commit lifetime', () => {
    // The direct opposite of the superscalar's "a slot is not a stable lane": there are no seats
    // to change here, only a ROB slot the instruction owns for its whole in-flight life.
    const rec = recorderFor(FIVE_INDEPENDENT, W2);
    rec.runToEnd();

    const ids: string[] = [];
    for (const t of rec.recorded) {
      for (const i of t.instructions) if (!ids.includes(i.id)) ids.push(i.id);
    }
    expect(ids).toHaveLength(6); // 5 addi + ecall

    for (const id of ids) {
      const sightings = rec.follow(id);
      expect(sightings.length).toBeGreaterThan(0);

      // At most ONE `"IF"` sighting (the cycle it was fetched but not yet dispatched), and every
      // sighting after that is the SAME `"ROB#<tag>"` — never a second, different tag.
      const robLocations = sightings.filter((s) => s.location !== 'IF').map((s) => s.location);
      expect(new Set(robLocations).size).toBeLessThanOrEqual(1);

      // Every sighting is contiguous cycle-over-cycle — no gaps in the walk.
      const cycles = sightings.map((s) => s.cycle);
      expect(cycles).toEqual(Array.from({ length: cycles.length }, (_, n) => cycles[0]! + n));
    }
  });

  it('resolves several concurrently in-flight ids to distinct ROB tags (INV-4)', () => {
    const rec = recorderFor(FIVE_INDEPENDENT, W2);
    rec.runToEnd();

    // Somewhere mid-run, several of these should be simultaneously in the ROB (dispatched, not
    // yet committed) — read the cycle from the recording rather than assuming which one.
    const midCycle = rec.recorded.find(
      (t) => t.instructions.filter((i) => i.location.startsWith('ROB#')).length >= 3,
    );
    expect(midCycle).toBeDefined();

    const inRob = midCycle!.instructions.filter((i) => i.location.startsWith('ROB#'));
    const ids = inRob.map((i) => i.id);
    const locations = inRob.map((i) => i.location);
    expect(new Set(ids).size).toBe(ids.length); // distinct ids
    expect(new Set(locations).size).toBe(locations.length); // distinct tags — no aliasing
  });
});

describe('TraceRecorder × out-of-order: no `micro` state at step 1a', () => {
  it('never exposes micro state through the recording', () => {
    // The plan's explicit YAGNI call: the ROB/rename map are real private engine state, but
    // nothing consumes them through the trace yet, so `MachineState.micro` stays unset — a
    // schema-shape claim this test makes concrete rather than merely unchecked.
    const rec = recorderFor(readFileSync(`${PROGRAMS_DIR}sum-loop.s`, 'utf8'), W2);
    rec.runToEnd();
    expect(rec.currentState().micro).toBeUndefined();
    for (const t of rec.recorded) {
      expect(t.state.micro).toBeUndefined();
    }
  });
});

describe('TraceRecorder × out-of-order: the width toggle, through the shipped API', () => {
  const sumLoop = readFileSync(`${PROGRAMS_DIR}sum-loop.s`, 'utf8');

  it('same program, same answers, fewer cycles at width 2', () => {
    const narrow = recorderFor(sumLoop, W1);
    const wide = recorderFor(sumLoop, W2);
    narrow.runToEnd();
    wide.runToEnd();

    expect([...wide.currentState().registers]).toEqual([...narrow.currentState().registers]);
    expect(wide.recordedCycles).toBeLessThan(narrow.recordedCycles);
  });
});
