import { describe, expect, it } from 'vitest';
import { assemble } from '@cpu-viz/assembler';
import { toProgramImage, CACHE_SMALL } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import { SuperscalarProcessor } from './index';

/**
 * A miss-freeze must not eat a forward — this machine's half of the regression net for the bug in
 * `docs/reviews/m11-miss-freeze-forward-loss.md` (found 2026-07-27 by M11 step 6's probe). The
 * mechanism and the fix are identical to `engine/pipeline`'s, and that file's header states them;
 * what is worth writing down HERE is the two things width changes.
 *
 * **1. The broken ALIGNMENT is width-dependent, so the sweep is the test.** With a producer P, a
 * missing memory op Q and a consumer C, the distance at which C lands in EX on the miss's detection
 * cycle is a function of how the front end packed the groups. Measured before the fix: **width 1
 * breaks at k = 0, width 2 breaks at k = 1 and k = 2 — and width 2 is CLEAN at k = 0.** So a
 * single-alignment test at the 5-stage's k would have passed here against a fully broken machine,
 * and "this program was fine at width 2" proved nothing until the distance was slid. Both widths ×
 * four distances are swept for that reason.
 *
 * **2. Capturing on the DETECTION cycle only is load-bearing here in a way it is not at width 1.**
 * This machine deliberately freezes an older pair-mate in EX/MEM beside a younger slot's miss
 * (`stageMem`'s `frozen` walk), and that latch is re-presented for the WHOLE freeze — so an
 * occupant depending on it would re-match, and re-emit a `forward`, on every frozen cycle if the
 * capture ran unconditionally. `CycleCtx.memStallStarted` is what makes it exactly once.
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
${filler}    addi x10, x10, -1    # C — reads x10 stale in ID; needs the MEM/WB forward in EX
    li   a7, 10
    ecall
`;
}

function run(fillers: number, config: ProcessorConfig): CycleTrace[] {
  const { program, errors } = assemble(src(fillers));
  if (!program) throw new Error(`assembly failed: ${errors.map((e) => e.message).join()}`);
  const p = new SuperscalarProcessor();
  p.reset(toProgramImage(program), config);
  const traces: CycleTrace[] = [];
  let guard = 0;
  while (!p.isHalted()) {
    // Tight on purpose: one symptom of the bug was a counter that consumed the stale value and
    // never converged, so "did not terminate" must fail rather than hang.
    if (guard++ >= 200) throw new Error('did not halt within 200 cycles');
    traces.push(p.step());
  }
  return traces;
}

const cfg = (width: number, over: Partial<ProcessorConfig>): ProcessorConfig => ({
  ...defaultConfig(),
  forwarding: true,
  branchPrediction: 'none',
  issueWidth: width,
  ...over,
});

const finalX10 = (ts: CycleTrace[]): number => ts[ts.length - 1]!.state.registers[10]!;

describe('a cache miss must not eat a forward', () => {
  for (const width of [1, 2]) {
    for (const k of [0, 1, 2, 3]) {
      it(`width ${width}: same answer with and without the cache (consumer ${k} behind the load)`, () => {
        const truth = finalX10(run(k, cfg(width, { cache: null })));
        expect(truth).toBe(2); // 3 − 1, and the cache-off machine is the INV-8-verified reference
        expect(finalX10(run(k, cfg(width, { cache: CACHE_SMALL })))).toBe(truth);
      });
    }

    it(`width ${width}: the freeze still costs its full miss penalty`, () => {
      // A "fix" that quietly stopped freezing would satisfy every assertion above and destroy the
      // M6 lesson, so the penalty is pinned separately from the answer.
      const off = run(1, cfg(width, { cache: null })).length;
      const on = run(1, cfg(width, { cache: CACHE_SMALL })).length;
      expect(on - off).toBe(CACHE_SMALL.missPenalty);
    });

    it(`width ${width}: forwarding OFF is untouched, as it always was`, () => {
      // The ID interlock holds C until P has written back, so no forward is needed and the freeze
      // has nothing to lose. Pinned so the fix is known not to have moved the safe path.
      for (const k of [0, 1, 2, 3]) {
        const truth = finalX10(run(k, cfg(width, { forwarding: false, cache: null })));
        expect(truth).toBe(2);
        expect(finalX10(run(k, cfg(width, { forwarding: false, cache: CACHE_SMALL })))).toBe(truth);
      }
    });
  }

  it('emits the consumer’s forward exactly once, never once per frozen cycle', () => {
    // The pair-mate this machine freezes in EX/MEM persists across the whole freeze, so an
    // unconditional capture would re-emit every cycle. k = 1 at width 2 is a broken-before
    // alignment, so this runs on the path the fix actually changed.
    const traces = run(1, cfg(2, { cache: CACHE_SMALL }));
    const consumerPc = 16; // li x9 / li x10 / lw / filler / C
    let consumer: string | undefined;
    for (const t of traces) {
      for (const e of t.events) {
        if (e.type === 'instr-fetch' && e.pc === consumerPc) consumer ??= e.instr;
      }
    }
    expect(consumer).toBeDefined();

    const forwards = traces.flatMap((t) =>
      t.events.filter((e) => e.type === 'forward' && e.instr === consumer),
    );
    // One per SOURCE PORT at most, and never a per-frozen-cycle repeat: the consumer reads x10 on
    // both ports (`addi x10, x10, -1` reads rs1 only), so this is exactly one.
    expect(forwards.length).toBe(1);
  });
});
