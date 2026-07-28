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
 * capture ran unconditionally. `CycleCtx.memStallStarted` is what holds it to the frozen cycles.
 *
 * **3. And `memStallStarted` alone was NOT enough — the M11+M12 review's finding.** The pair-mate is
 * re-presented on the RELEASE cycle too, where the freeze is over and EX resolves its operands the
 * ordinary way: one read of one value, two `forward` events. `IdExLatch.operandsResolved` is what
 * closes it, and it is what makes this machine agree with the other two rather than a rule of its
 * own. The two engines that hold only the missing memory op across a freeze were never exposed —
 * it forwards to nobody — but they now carry the same property test, because that immunity is an
 * argument about today's forwarding sources rather than a guarantee about tomorrow's.
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

/**
 * The same three roles, but P is the load's PAIR-MATE rather than the instruction before it — so P
 * rides EX/MEM BESIDE the miss and is re-presented there for the whole freeze, instead of draining
 * out through MEM/WB. This is the geometry only a machine of width ≥ 2 has, and the one the M11+M12
 * review found emitting a duplicate `forward`.
 */
function pairedSrc(fillers: number): string {
  const filler = Array.from(
    { length: fillers },
    (_, i) => `    addi x${20 + i}, x0, ${i + 1}\n`,
  ).join('');
  return `    .text
    .globl _start
_start:
    li   x9, 64
    lw   x5, 0(x9)       # Q — cold MISS       \\ issued as one pair, so P sits in EX/MEM
    addi x6, x0, 7       # P — writes x6       / beside the miss for the whole freeze
${filler}    addi x10, x6, -5     # C — reads x6 off that frozen latch
    li   a7, 10
    ecall
`;
}

function runSrc(asm: string, config: ProcessorConfig): CycleTrace[] {
  const { program, errors } = assemble(asm);
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

const run = (fillers: number, config: ProcessorConfig): CycleTrace[] =>
  runSrc(src(fillers), config);

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

  /**
   * The claim as a PROPERTY — no port forwarded twice, anywhere in the run — over both widths ×
   * all four alignments × BOTH geometries. `engine/pipeline` and `engine/deep-pipeline` carry the
   * same test, where it passes for a reason that is currently an argument rather than a pin.
   *
   * **Both geometries, because `src` alone is measurably vacuous here.** Run against the broken
   * machine, all eight `src` cells passed: its consumer forwards from MEM/WB, which `holdInMem`
   * bubbles for the whole freeze, so the release cycle finds nothing to re-match. Only `pairedSrc`
   * keeps a producer alive across the freeze, and only it went red. A sweep that looks thorough and
   * cannot fail is worse than no sweep, so the geometry that actually discriminates is in the loop.
   */
  for (const width of [1, 2]) {
    for (const [name, build] of [
      ['MEM/WB source', src],
      ['EX/MEM source', pairedSrc],
    ] as const) {
      it.each([0, 1, 2, 3])(
        `width ${width}, ${name}: consumer %i — no port forwarded twice`,
        (k) => {
          const perPort = new Map<string, number>();
          for (const t of runSrc(build(k), cfg(width, { cache: CACHE_SMALL }))) {
            for (const e of t.events) {
              if (e.type !== 'forward') continue;
              const key = `${e.instr}→${e.to}`;
              perPort.set(key, (perPort.get(key) ?? 0) + 1);
            }
          }
          // Non-vacuity FIRST: a run that forwards nothing satisfies the claim below for free.
          expect(
            perPort.size,
            `w=${width} k=${k}: the geometry must actually forward`,
          ).toBeGreaterThan(0);
          expect(
            [...perPort.entries()].filter(([, n]) => n > 1),
            `w=${width} k=${k}`,
          ).toEqual([]);
        },
      );
    }
  }

  /**
   * The same claim named at its SOURCE, which is what the property sweep above cannot say.
   *
   * `holdInMem` bubbles MEM/WB for the whole freeze, so a producer that drains through it is gone
   * by the release cycle. The **EX/MEM** source is the one this machine keeps alive: `stageMem`'s
   * `frozen` walk re-presents an older pair-mate there for the whole freeze INCLUDING the release
   * cycle, so a consumer reading it matched on the detection cycle (the capture) AND again on
   * release (the ordinary resolve) — the same value, twice.
   *
   * Hence the setup assertion below. If the front end stops pairing the load with its producer, the
   * consumer falls back to a MEM/WB forward and every count here silently becomes 1 — a test that
   * passes for the wrong reason. `from` is what keeps it honest.
   */
  it('emits an EX/MEM-sourced forward exactly once across the freeze', () => {
    // C is the oldest of the group after the pair, and therefore sits in EX on the detection cycle.
    const traces = runSrc(pairedSrc(0), cfg(2, { cache: CACHE_SMALL }));

    const consumerPc = 12; // li x9 / lw / addi x6 / C
    let consumer: string | undefined;
    for (const t of traces) {
      for (const e of t.events) {
        if (e.type === 'instr-fetch' && e.pc === consumerPc) consumer ??= e.instr;
      }
    }
    expect(consumer).toBeDefined();

    const sources: string[] = [];
    for (const t of traces) {
      for (const e of t.events) {
        if (e.type === 'forward' && e.instr === consumer) sources.push(e.from);
      }
    }
    // The setup, not the claim: this must be the EX/MEM path, or the count proves nothing.
    expect(sources).toEqual(['EX/MEM']);
    expect(traces[traces.length - 1]!.state.registers[10]).toBe(2); // 7 − 5, the answer
  });
});
