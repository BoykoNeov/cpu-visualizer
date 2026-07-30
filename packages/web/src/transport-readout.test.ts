/**
 * The transport readout's texts and the width each is held open to.
 *
 * `layout-stability.test.tsx` asserts the RENDER: three spans, same reserves at every cursor, no
 * text overflowing its own. This file is the fold underneath it, and its job is the one thing a
 * single fixture cannot do — sweep the reserve against every text the shell can actually put in
 * those spans, across models, programs, and both follow states, and fail if any of them is wider
 * than what was reserved for it. A reserve that is too small is not a smaller reserve: the span
 * grows past its `min-width` on that one cursor and the slider beside it moves.
 */

import { OutOfOrderProcessor } from '@cpu-viz/engine-out-of-order';
import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { SingleCycleProcessor } from '@cpu-viz/engine-single-cycle';
import { SuperscalarProcessor } from '@cpu-viz/engine-superscalar';
import {
  defaultConfig,
  type CycleTrace,
  type Processor,
  type ProcessorConfig,
} from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import { shownInstruction } from './App';
import { EXAMPLE_PROGRAMS } from './programs';
import { loadSource } from './simulator';
import { chipText, counterText, instructionText, readoutReserve } from './transport-readout';

function record(
  name: string,
  config: ProcessorConfig,
  factory: () => Processor,
): readonly CycleTrace[] {
  const source = EXAMPLE_PROGRAMS.find((p) => p.name === name)!.source;
  const result = loadSource(source, factory, config);
  if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
  result.loaded.recorder.runToEnd();
  return result.loaded.recorder.recorded;
}

describe('counterText names every position the clock can be at', () => {
  it('the pre-run cursor is a word, not a number', () => {
    expect(counterText(-1, 42, false)).toBe('start (pre-run)');
  });

  it('mid-run reads as a fraction of the recorded run', () => {
    expect(counterText(7, 42, false)).toBe('cycle 7 / 42');
  });

  it('the halted end says so, and that is the widest the counter ever gets', () => {
    expect(counterText(42, 42, true)).toBe('cycle 42 / 42 — halted');
    const recorded = record('sum-loop', defaultConfig(), () => new SingleCycleProcessor());
    expect(readoutReserve(recorded, false).counter).toBe(
      counterText(recorded.length - 1, recorded.length - 1, true).length,
    );
  });

  it('with nothing loaded, reserves only what a bar with nothing loaded can draw', () => {
    // Not a hypothetical: the shell renders the transport before a program is recorded. Reserving
    // `cycle 0 / -1 — halted` there would hold 6 characters open for a sentence no cursor can show.
    expect(readoutReserve([], false).counter).toBe('start (pre-run)'.length);
  });
});

describe('chipText appears exactly when one instruction is not the whole story', () => {
  const instance = {
    id: 'i0',
    pc: 0,
    encoding: 0,
    sourceLine: 1,
    decoded: { kind: 'R', op: 'add', rd: 1, rs1: 2, rs2: 3 },
    location: 'MEM',
  } as never;

  it('is empty with one in flight — the qualifier would qualify nothing', () => {
    expect(chipText(instance, 1, false)).toBe('');
  });

  it('is empty with nothing in flight', () => {
    expect(chipText(null, 3, false)).toBe('');
  });

  it('names the stage and the count when several are in flight', () => {
    expect(chipText(instance, 3, false)).toBe('in MEM · 3 in flight');
  });

  it('switches verb when the reader is following one — which is WIDER, so it is reserved', () => {
    expect(chipText(instance, 3, true)).toBe('following MEM · 3 in flight');
    expect(chipText(instance, 3, true).length).toBeGreaterThan(chipText(instance, 3, false).length);
  });
});

// ---------------------------------------------------------------------------------------------
// The sweep. Every model that can put something different in these spans, on a program that
// exercises it: locations run `IF`…`WB`, `IF.0`…`WB.1`, and `ROB#12`; instruction texts run from
// `ecall` to `addi x28, x28, 20`; counts run to the issue width times the depth.
// ---------------------------------------------------------------------------------------------

const SCENARIOS: { name: string; recorded: readonly CycleTrace[] }[] = [
  {
    name: 'single-cycle / sum-loop',
    recorded: record('sum-loop', defaultConfig(), () => new SingleCycleProcessor()),
  },
  {
    name: 'pipeline / array-sum',
    recorded: record(
      'array-sum',
      { ...defaultConfig(), forwarding: true },
      () => new PipelineProcessor(),
    ),
  },
  {
    name: 'superscalar 2-wide / paired-branches',
    recorded: record(
      'paired-branches',
      { ...defaultConfig(), issueWidth: 2, forwarding: true },
      () => new SuperscalarProcessor(),
    ),
  },
  {
    name: 'out-of-order / slow-op-loop',
    recorded: record(
      'slow-op-loop',
      { ...defaultConfig(), issueWidth: 2, outOfOrderIssue: true, robSize: 16 },
      () => new OutOfOrderProcessor(),
    ),
  },
];

describe.each(SCENARIOS)(
  '$name: the reserve covers every text the run can draw',
  ({ recorded }) => {
    const lastCycle = recorded.length - 1;

    it.each([false, true])('...with following=%s, at every cursor', (following) => {
      const reserve = readoutReserve(recorded, following);
      // Cursor −1 first — the pre-run one, where the instruction span is empty and the counter is at
      // its second-widest. A reserve derived from cycle 0 onward would still pass a sweep that skipped
      // it, and it is the cursor every run opens at.
      const cursors = [-1, ...recorded.map((_, i) => i)];
      for (const cursor of cursors) {
        const trace = cursor < 0 ? null : recorded[cursor]!;
        const instructions = trace?.instructions ?? [];
        // Every instruction the reader could be FOLLOWING, not just the default retiring one: the map
        // retargets this readout, so the reserve has to cover whichever cell they clicked.
        const candidates = instructions.length === 0 ? [null] : [...instructions];
        for (const inFlight of candidates) {
          const shown = shownInstruction(instructions, inFlight?.id ?? null);
          expect(counterText(cursor, lastCycle, cursor === lastCycle).length).toBeLessThanOrEqual(
            reserve.counter,
          );
          expect(instructionText(shown).length).toBeLessThanOrEqual(reserve.instruction);
          expect(chipText(shown, instructions.length, following).length).toBeLessThanOrEqual(
            reserve.chip,
          );
        }
      }
    });

    it('reserves nothing for a chip the run never shows, and something for one it does', () => {
      // The floor, per model: an all-zero reserve satisfies "constant at every cursor" trivially, and
      // a chip reserve that is nonzero on a machine that never runs two at once would draw an empty
      // span for the whole run.
      const reserve = readoutReserve(recorded, false);
      const everCrowded = recorded.some((trace) => trace.instructions.length > 1);
      expect(reserve.counter).toBeGreaterThan(0);
      expect(reserve.instruction).toBeGreaterThan(0);
      expect(reserve.chip > 0).toBe(everCrowded);
    });
  },
);

describe('the reserve is bounded, not one class per row', () => {
  it('a long straight-line program reserves exactly what a short one does', () => {
    // The fan-out failure this repo has already shipped once: a derived reserve keyed on each
    // distinct row grew 802 rows / 455KB on an 800-instruction program. This one is three numbers,
    // so the only thing a longer program can move is the digit count of the cycle counter.
    const short = readoutReserve(
      record('add', { ...defaultConfig(), forwarding: true }, () => new PipelineProcessor()),
      false,
    );
    const long = readoutReserve(
      record('array-sum', { ...defaultConfig(), forwarding: true }, () => new PipelineProcessor()),
      false,
    );
    expect(Object.keys(long)).toEqual(Object.keys(short));
    expect(long.counter - short.counter).toBeLessThanOrEqual(2); // two more digits, at most
  });
});
