import { describe, expect, it } from 'vitest';
import { assemble } from '@cpu-viz/assembler';
import { toProgramImage, CACHE_SMALL } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import { OutOfOrderProcessor } from './index';

/**
 * This machine is IMMUNE to the miss-freeze forward loss — pinned rather than assumed.
 *
 * `engine/pipeline` and `engine/superscalar` both had a real bug here
 * (`docs/reviews/m11-miss-freeze-forward-loss.md`, found 2026-07-27): a miss froze the execute
 * stage before it captured its forwarded operands, the producer retired out of MEM/WB during the
 * freeze, and the occupant then executed on its stale pre-forwarding register read. Both are fixed.
 *
 * **This model never had it, and the reason is structural rather than lucky: a ROB entry HOLDS its
 * operand values.** There is no transient forwarding window that a freeze can close — once a value
 * has been broadcast on the CDB into an entry, it is in the entry, and freezing the machine cannot
 * drain it. That is a property worth a test because it is exactly the kind of thing a future change
 * to the in-order branch could quietly give up, and because this model DOES set `ctx.memStall` (M9
 * review finding F9 sits on this same seam: `fuFreezesDuringMemStall`).
 *
 * **Both modes, and the freeze is checked to have HAPPENED.** A green "the answer is right" row
 * proves nothing if the miss never froze anything, so each case also asserts the run costs its full
 * `missPenalty` — the vacuity guard that makes the immunity claim mean something.
 */

/** P writes x10; Q misses; `fillers` independent instructions; then C consumes x10. */
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
${filler}    addi x10, x10, -1    # C — the consumer a freeze could strand
    li   a7, 10
    ecall
`;
}

function run(fillers: number, config: ProcessorConfig): CycleTrace[] {
  const { program, errors } = assemble(src(fillers));
  if (!program) throw new Error(`assembly failed: ${errors.map((e) => e.message).join()}`);
  const p = new OutOfOrderProcessor();
  p.reset(toProgramImage(program), config);
  const traces: CycleTrace[] = [];
  let guard = 0;
  while (!p.isHalted()) {
    if (guard++ >= 200) throw new Error('did not halt within 200 cycles');
    traces.push(p.step());
  }
  return traces;
}

const finalX10 = (ts: CycleTrace[]): number => ts[ts.length - 1]!.state.registers[10]!;

describe('a cache miss cannot eat a forward here — the ROB holds the values', () => {
  for (const outOfOrderIssue of [false, true]) {
    const mode = outOfOrderIssue ? 'out-of-order' : 'in-order';
    it(`${mode}: the cache never moves the answer, at any consumer distance`, () => {
      for (const k of [0, 1, 2, 3]) {
        const base: ProcessorConfig = {
          ...defaultConfig(),
          forwarding: true,
          branchPrediction: 'none',
          outOfOrderIssue,
        };
        const off = run(k, { ...base, cache: null });
        const on = run(k, { ...base, cache: CACHE_SMALL });
        expect(finalX10(off), `k=${k} cache-off`).toBe(2);
        expect(finalX10(on), `k=${k} cache-on`).toBe(2);
        // NOT vacuous: the miss really did cost this run its full penalty.
        expect(on.length - off.length, `k=${k} miss penalty`).toBe(CACHE_SMALL.missPenalty);
      }
    });
  }
});
