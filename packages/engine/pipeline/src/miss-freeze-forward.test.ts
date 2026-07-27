import { describe, expect, it } from 'vitest';
import { assemble } from '@cpu-viz/assembler';
import { toProgramImage, CACHE_SMALL } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import { PipelineProcessor } from './index';

/**
 * A miss-freeze must not eat a forward — the regression net for the bug written up in
 * `docs/reviews/m11-miss-freeze-forward-loss.md` (found 2026-07-27 by M11 step 6's probe).
 *
 * **The bug.** A miss froze EX *before* it captured its forwarded operands. The producer sitting in
 * MEM/WB on the detection cycle retired during the freeze and its latch drained, so by the release
 * cycle the value existed nowhere the forwarding network could see — and the occupant executed on
 * the stale, PRE-forwarding register read it had latched in ID. A cache, documented repo-wide as a
 * timing shadow that "holds tags, never values", therefore changed the ANSWER.
 *
 * **Why this file exists rather than a corpus program.** The bug needs three instructions adjacent
 * — a producer P, a memory op Q that MISSES, then a consumer C of P — positioned so that C is in EX
 * needing the `MEM/WB → EX` forward on exactly the cycle Q detects its miss. No program in the
 * eleven-program corpus contains that geometry, which is why every differential and timing suite
 * was green while the machine was wrong. It is trivially reachable from the app's sandbox, so the
 * net has to be a hand-built geometry rather than a corpus sweep.
 *
 * **What each test is for**, since a single "x10 is right" assertion would pass again the moment
 * someone re-broke it in a different way:
 *
 *  1. The architectural answer, against the cache-off run of the same program — the INV-8 shape,
 *     locally: a cache may move cycles and must never move state.
 *  2. The forward EVENT, because the value could also be got right by accident (a re-read of a
 *     register file that happens to be correct by then). The fix is specifically that the forward
 *     still happens; assert it fires exactly ONCE, and on the detection cycle.
 *  3. The freeze still costing its full `missPenalty` — a "fix" that quietly stopped freezing would
 *     satisfy (1) and (2) and destroy the M6 lesson.
 *  4. Forwarding OFF, which was never broken (the ID interlock waits for writeback, so no forward
 *     is needed) — pinned so the fix is known not to have changed the safe path.
 */

/**
 * P writes x10; Q misses; then C consumes x10. `fillers` slides C across the pipeline's geometry:
 * the coincidence lands at a different distance on a different machine, so the parameter is what
 * makes this program a net rather than one lucky alignment.
 */
function src(fillers: number): string {
  const filler = Array.from(
    { length: fillers },
    (_, i) => `    addi x${20 + i}, x0, ${i + 1}\n`,
  ).join('');
  return `    .text
    .globl _start
_start:
    li   x9, 64
    li   x10, 3          # P — writes x10
    lw   x5, 0(x9)       # Q — cold MISS
${filler}    addi x10, x10, -1    # C — reads x10 stale in ID; needs the MEM/WB forward in EX
    li   a7, 10
    ecall
`;
}

function run(fillers: number, config: ProcessorConfig): CycleTrace[] {
  const { program, errors } = assemble(src(fillers));
  if (!program) throw new Error(`assembly failed: ${errors.map((e) => e.message).join()}`);
  const p = new PipelineProcessor();
  p.reset(toProgramImage(program), config);
  const traces: CycleTrace[] = [];
  let guard = 0;
  while (!p.isHalted()) {
    // A tight cap on purpose: one symptom of the bug was a loop counter that consumed the stale
    // value and never reached zero, so "did not terminate" has to fail rather than hang.
    if (guard++ >= 200) throw new Error('did not halt within 200 cycles');
    traces.push(p.step());
  }
  return traces;
}

const cfg = (over: Partial<ProcessorConfig>): ProcessorConfig => ({
  ...defaultConfig(),
  forwarding: true,
  branchPrediction: 'none',
  ...over,
});

const finalX10 = (ts: CycleTrace[]): number => ts[ts.length - 1]!.state.registers[10]!;

describe('a cache miss must not eat a forward', () => {
  // Swept rather than pinned at one distance: the fix must hold wherever the consumer sits, and at
  // most one of these alignments is the one that was actually broken on this machine.
  for (const k of [0, 1, 2, 3]) {
    it(`computes the same answer with and without the cache (consumer ${k} behind the load)`, () => {
      const truth = finalX10(run(k, cfg({ cache: null })));
      expect(truth).toBe(2); // 3 − 1, and the cache-off machine is the INV-8-verified reference
      expect(finalX10(run(k, cfg({ cache: CACHE_SMALL })))).toBe(truth);
    });
  }

  it('emits the forward exactly once, on the cycle the miss is DETECTED', () => {
    // k = 0 is the alignment that was broken on this machine: C reaches EX on the detection cycle.
    const traces = run(0, cfg({ cache: CACHE_SMALL }));
    // Scoped to the CONSUMER's own id. The load two ahead of it legitimately forwards its base
    // register on an earlier cycle, so an unscoped filter would be counting somebody else's event.
    const consumerPc = 12; // li x9 / li x10 / lw / C, at k = 0
    let consumer: string | undefined;
    for (const t of traces) {
      for (const e of t.events) {
        if (e.type === 'instr-fetch' && e.pc === consumerPc) consumer ??= e.instr;
      }
    }
    expect(consumer).toBeDefined();
    const forwardCycles = traces
      .filter((t) => t.events.some((e) => e.type === 'forward' && e.instr === consumer))
      .map((t) => t.cycle);
    const missCycle = traces.find((t) =>
      t.events.some((e) => e.type === 'cache-access' && !e.hit),
    )?.cycle;

    expect(missCycle).toBeDefined();
    // Exactly one — not zero (the bug: the capture never happened) and not one per frozen cycle
    // (the naive fix: re-resolving every cycle re-emits, and reads a draining source set).
    expect(forwardCycles).toEqual([missCycle]);
  });

  it('still pays the full miss penalty — the freeze is not what was wrong', () => {
    const off = run(0, cfg({ cache: null })).length;
    const on = run(0, cfg({ cache: CACHE_SMALL })).length;
    expect(on - off).toBe(CACHE_SMALL.missPenalty);
  });

  it('leaves the forwarding-OFF path untouched, which was never broken', () => {
    // With no forwarding the ID interlock holds C until P has written back, so C never needs a
    // forward and the freeze has nothing to lose. Pinned so the fix is known not to have moved it.
    for (const k of [0, 1, 2, 3]) {
      const truth = finalX10(run(k, cfg({ forwarding: false, cache: null })));
      expect(truth).toBe(2);
      expect(finalX10(run(k, cfg({ forwarding: false, cache: CACHE_SMALL })))).toBe(truth);
    }
  });
});
