import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import { OutOfOrderProcessor } from './index';

/**
 * The chosen semantics for an in-flight slow FU op during a BLOCKING cache miss in the IN-ORDER
 * branch: it FREEZES with the rest of the front end (M3/M7 "occupant holds in EX during a MEM
 * stall"), rather than counting down and completing mid-freeze (M9+M10 review finding 9). The
 * pipeline family has no multi-cycle FU, so there is no external ground truth — this pins the
 * deliberate choice.
 *
 * The window: at `issueWidth: 2` a slow `sll` and a younger `lw` issue together; the next cycle the
 * `lw` detects a compulsory cache miss and raises `ctx.memStall`, freezing the machine for
 * `missPenalty` cycles while the `sll` sits `executing`. `fuFreezesDuringMemStall()` (the real,
 * production behaviour) holds its FU countdown through the freeze; a mutation restoring the pre-fix
 * "advance anyway" behaviour lets it finish earlier — a pure TIMING divergence (final state is
 * identical, since in-order commit fixes architectural state regardless of FU cadence).
 */
class FuAdvancesDuringMissProcessor extends OutOfOrderProcessor {
  protected override fuFreezesDuringMemStall(): boolean {
    return false; // the pre-fix behaviour: the FU counts down even while a blocking miss freezes the front end
  }
}

// `sll` (register shift) is the slow op; `lw` misses on a compulsory access. They issue together at
// width 2, so the sll is mid-flight when the miss freezes the machine.
const SRC = [
  '.data',
  'datum: .word 7',
  '.text',
  '_start:',
  'la   t0, datum',
  'li   t1, 3',
  'sll  t2, t1, t1', // slow op — issues, enters the FU
  'lw   t3, 0(t0)', // compulsory cache miss — freezes the in-order front end while the sll executes
  'add  a0, t2, t3', // consumes both, so the run length reflects when the sll actually completed
  'li   a7, 10',
  'ecall',
].join('\n');

function asm(): AssembledProgram {
  const { program, errors } = assemble(SRC);
  if (!program) {
    throw new Error(
      'assembly failed:\n' + errors.map((e) => `  ${e.line}: ${e.message}`).join('\n'),
    );
  }
  return program;
}

const IN_ORDER: ProcessorConfig = {
  ...defaultConfig(),
  forwarding: true,
  issueWidth: 2,
  outOfOrderIssue: false,
  cache: { lineSize: 16, numLines: 4, missPenalty: 8 },
  slowOpLatency: 8,
};

function run(processor: OutOfOrderProcessor, config: ProcessorConfig): CycleTrace[] {
  processor.reset(toProgramImage(asm()), config);
  const traces: CycleTrace[] = [];
  let steps = 0;
  while (!processor.isHalted()) {
    if (steps++ > 2000) throw new Error('runaway: did not halt');
    traces.push(processor.step());
  }
  return traces;
}

function finalRegs(traces: CycleTrace[]): readonly number[] {
  return traces[traces.length - 1]!.state.registers;
}

describe('in-order branch: a slow FU op freezes during a blocking cache miss', () => {
  it('holds the FU through the freeze — strictly more cycles than advancing through it would take', () => {
    const gated = run(new OutOfOrderProcessor(), IN_ORDER);
    const advancing = run(new FuAdvancesDuringMissProcessor(), IN_ORDER);
    // The freeze delays the sll's completion, so the real machine runs longer — the behaviour is
    // load-bearing, not a no-op dressed up as a choice.
    expect(gated.length).toBeGreaterThan(advancing.length);
  });

  it('is timing-only: final architectural state is identical either way', () => {
    const gated = run(new OutOfOrderProcessor(), IN_ORDER);
    const advancing = run(new FuAdvancesDuringMissProcessor(), IN_ORDER);
    expect(finalRegs(gated)).toEqual(finalRegs(advancing));
  });

  it('is a no-op for out-of-order mode: memStall is never set, so the gate never fires', () => {
    const ooo: ProcessorConfig = { ...IN_ORDER, outOfOrderIssue: true };
    const gated = run(new OutOfOrderProcessor(), ooo);
    const advancing = run(new FuAdvancesDuringMissProcessor(), ooo);
    // No blocking miss in the non-blocking LSU, so the seam is unreachable — byte-identical traces.
    expect(gated).toEqual(advancing);
  });
});
