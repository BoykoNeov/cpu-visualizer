import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import { OutOfOrderProcessor } from './index';

/**
 * **M10 step 1 — the `slowOpLatency` net.** The designated slow op (`sll`) occupies its functional
 * unit for `slowOpLatency` cycles before broadcasting; independent younger work issues around it
 * (the `'executing'` state frees the issue port). INV-8 is blind to this — final state is identical
 * in every position — so this file, not the differential suite, is the net. Uses inline scratch
 * programs (engine tests routinely do; INV-7's one-corpus rule governs LESSONS, not unit fixtures).
 *
 * The four things pinned here, each a KNOWN failure of a plausible bug:
 *  - PARITY: `slowOpLatency` absent ≡ `1` ≡ every FU single-cycle — byte-for-byte, or the done M9
 *    model changed. (A `>=` boundary bug that deferred at N=1 fails this.)
 *  - FIRE AT COMPLETION: the slow `sll`'s `alu-op` lands N-1 cycles LATER than at N=1 — emitting it
 *    at issue (asserting a result that does not exist yet) fails this.
 *  - ISSUE PORT FREED: an independent younger op executes WHILE the slow op is still in its FU — a
 *    "hold the issue slot for N cycles" bug (which would stall both modes) fails this.
 *  - TOGGLE DIVERGENCE + CORRECTNESS: on a loop, out-of-order issue finishes in fewer cycles than
 *    in-order for a large-enough latency, with the SAME architectural result (INV-8).
 */

function asm(src: string): AssembledProgram {
  const { program, errors } = assemble(src);
  if (!program) throw new Error('assembly failed: ' + errors.map((e) => e.message).join('; '));
  return program;
}

function run(program: AssembledProgram, config: ProcessorConfig, maxCycles = 400): CycleTrace[] {
  const p = new OutOfOrderProcessor();
  p.reset(toProgramImage(program), config);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    if (traces.length >= maxCycles) throw new Error('exceeded maxCycles — runaway loop?');
    traces.push(p.step());
  }
  return traces;
}

const base = (over: Partial<ProcessorConfig>): ProcessorConfig => ({
  ...defaultConfig(),
  issueWidth: 1,
  branchPrediction: 'static-not-taken',
  cache: null,
  ...over,
});

/** All events flattened with their cycle, for order assertions. */
function events(ts: CycleTrace[]): { cycle: number; e: CycleTrace['events'][number] }[] {
  return ts.flatMap((t) => t.events.map((e) => ({ cycle: t.cycle, e })));
}

/** The cycle a matching `alu-op` (by op + result) first fires, or -1. */
function aluCycle(ts: CycleTrace[], op: string, result: number): number {
  for (const { cycle, e } of events(ts)) {
    if (e.type === 'alu-op' && e.op === op && e.result === result) return cycle;
  }
  return -1;
}

function finalReg(ts: CycleTrace[], reg: number): number {
  let v = 0;
  for (const { e } of events(ts)) {
    if (e.type === 'reg-write' && e.reg === reg) v = e.value;
  }
  return v;
}

// A straight-line [slow -> dep -> indep] program: the slow `sll` produces t0, `add t3` depends on
// it, `add t5` is independent. Small and deterministic — used for the fire-at-completion and
// issue-port-freed facts (the ones that hold even when the total does not move).
const STRAIGHT = asm(`
_start:
    li   t1, 1
    li   t2, 4
    li   t4, 10
    li   t6, 20
    li   a0, 30
    sll  t0, t1, t2     # SLOW: t0 = 1 << 4 = 16
    add  t3, t0, t4     # DEP: t3 = 16 + 10 = 26  (needs the slow result)
    add  t5, t6, a0     # INDEP: t5 = 20 + 30 = 50 (ready, independent of t0)
    li   a7, 10
    ecall
`);

// A loop whose slow op is independent across iterations (loop-invariant inputs), whose `add` is
// loop-carried (the DEP), and whose counter work is INDEP — the shape where out-of-order issue
// actually shrinks the cycle count (in-order commit erases the win in straight-line code).
const LOOP = asm(`
_start:
    li   t1, 6          # counter
    li   a0, 0          # accumulator
    li   t5, 3          # slow-op input   (loop-invariant)
    li   t6, 2          # slow-op shift   (loop-invariant)
loop:
    sll  t3, t5, t6     # SLOW: t3 = 3 << 2 = 12
    add  a0, a0, t3     # DEP: a0 += 12   (loop-carried)
    addi t1, t1, -1     # INDEP: count--
    bnez t1, loop
    li   a7, 10
    ecall
`);

describe('slowOpLatency — the parity guard', () => {
  it('absent ≡ latency 1 ≡ single-cycle FU, byte-for-byte (both toggle positions)', () => {
    for (const ooo of [false, true]) {
      const absent = run(STRAIGHT, base({ outOfOrderIssue: ooo }));
      const one = run(STRAIGHT, base({ outOfOrderIssue: ooo, slowOpLatency: 1 }));
      expect(JSON.stringify(one)).toBe(JSON.stringify(absent));
    }
  });
});

describe('slowOpLatency — the mechanism', () => {
  it('the slow op fires its alu-op at COMPLETION, N-1 cycles later than single-cycle', () => {
    const one = run(STRAIGHT, base({ outOfOrderIssue: true, slowOpLatency: 1 }));
    const slow = run(STRAIGHT, base({ outOfOrderIssue: true, slowOpLatency: 8 }));
    const sllOne = aluCycle(one, 'sll', 16);
    const sllSlow = aluCycle(slow, 'sll', 16);
    expect(sllOne).toBeGreaterThanOrEqual(0);
    expect(sllSlow).toBe(sllOne + 7); // latency 8 = 7 extra FU cycles
  });

  it('frees the issue port: the independent op executes while the slow op is still in its FU', () => {
    const slow = run(STRAIGHT, base({ outOfOrderIssue: true, slowOpLatency: 8 }));
    const indep = aluCycle(slow, 'add', 50); // t5 = 20 + 30, independent of the slow t0
    const sllDone = aluCycle(slow, 'sll', 16); // slow op completes
    expect(indep).toBeGreaterThanOrEqual(0);
    expect(indep).toBeLessThan(sllDone); // slid ahead of the still-executing slow op
  });

  it('out-of-order issue shrinks the loop while keeping the same answer (INV-8)', () => {
    for (const N of [1, 4, 8]) {
      const io = run(LOOP, base({ outOfOrderIssue: false, slowOpLatency: N }));
      const oo = run(LOOP, base({ outOfOrderIssue: true, slowOpLatency: N }));
      expect(finalReg(oo, 10)).toBe(72); // 6 iterations × (3 << 2) = 6 × 12
      expect(finalReg(io, 10)).toBe(72);
      if (N === 1) expect(oo.length).toBe(io.length); // no latency ⇒ nothing to reorder around
      if (N === 8) expect(oo.length).toBeLessThan(io.length); // the toggle payoff
    }
  });
});
