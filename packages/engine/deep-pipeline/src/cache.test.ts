import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble } from '@cpu-viz/assembler';
import { toProgramImage, CACHE_SMALL, CACHE_LARGE, directMapped } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import { DeepPipelineProcessor, type DeepPipelineMicro } from './index';

/**
 * M11 step 6 — the deep pipeline honors `config.cache`. The **third** knob, and the one the plan
 * held back behind the MVP because M6's variable-latency freeze meets a machine with two execute
 * stages and a two-deep front end.
 *
 * ## Why this file is SMALL, deliberately, where the 5-stage's cache work is two files
 *
 * The plan's step-6 acceptance offered "the fwd × predict × cache matrix green with hand-derived
 * cells, or a written drop with the dump that justifies it". The dump came back saying something
 * neither branch anticipated: **the cache axis on this machine is purely ADDITIVE, and its miss
 * sequence is identical to the 5-stage's.** Over the corpus × forwarding × prediction × two cache
 * geometries — 132 cells, plus five hand-built adversarial programs aimed at the freeze — every
 * run satisfied `cycles = cycles_cacheless + misses × missPenalty`, with an event multiset
 * invariant modulo time-displacement and byte-identical architectural state.
 *
 * So a third axis through `differential.test.ts` (68 → 204) and through `timing.test.ts`'s matrix
 * would have added ~200 cells that **cannot fail independently of cells already asserted**: their
 * every term is determined by a cycle count this repo already pins and a miss count the address
 * stream already fixes. This repo's standing rule is that a pin earns its place only when
 * something could lie without it (the M10 cache-track rule, and M10 step 7's declined
 * teaching-order test). What CAN lie is enumerated below, and that is exactly what is here.
 *
 * ## What is asserted, and what each one would catch
 *
 *  1. **The verdict SEQUENCE**, against the same literals `engine/pipeline`'s cache suite pins for
 *     the same program and geometry. This is the load-bearing one: it says the deep machine's
 *     address stream IS the 5-stage's, which is what makes the additivity claim non-trivial.
 *  2. **The `+M` identity**, swept over the corpus × both toggles. An identity rather than a table
 *     of cycle counts — the counts are already pinned cache-off in `timing.test.ts`, and restating
 *     them times three would be transcription, not verification.
 *  3. **The freeze MECHANICS** on a short penalty: which stages hold, that `access` fires exactly
 *     once, and that the datum arrives on the release cycle.
 *  4. **The step-6a forward-loss regression**, this machine's own — see `stageEx1`.
 *  5. **INV-8 locally**: a cache moves cycles and never the answer.
 *  6. **The recorder's deep-copy obligation** — the single-buffered-cache aliasing bug, which only
 *     time-travel can see.
 *
 * ## The cross-model claim, in prose because the DAG forbids the import
 *
 * `eslint.config.js` denies a model importing a sibling model, so this file cannot compare itself
 * to `PipelineProcessor` directly (`timing.test.ts` quotes the 5-stage's numbers in prose for the
 * same reason). The sequences in test 1 are therefore pinned as literals here AND independently in
 * `packages/engine/pipeline/src/cache-stall.test.ts`; if depth ever changed the address stream,
 * the two files would disagree and this one would go red on its own.
 *
 * **Why they must agree, derived rather than observed:** the D-cache sees exactly the memory
 * accesses that REACH MEM, in program order. On both machines every control transfer resolves
 * before any younger instruction can get past the execute stages — the 5-stage kills ID and IF, the
 * deep machine kills EX1/ID/IF2/IF1 — so **no wrong-path instruction ever reaches MEM on either**,
 * and the streams are both just "the retired memory ops, in order". Depth changes WHEN each access
 * happens, never WHICH.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

function asmFile(file: string): ReturnType<typeof toProgramImage> {
  const { program, errors } = assemble(readFileSync(PROGRAMS_DIR + file, 'utf8'));
  if (!program) throw new Error(`${file}: assembly failed: ${errors.map((e) => e.message).join()}`);
  return toProgramImage(program);
}

function run(image: ReturnType<typeof toProgramImage>, config: ProcessorConfig): CycleTrace[] {
  const p = new DeepPipelineProcessor();
  p.reset(image, config);
  const traces: CycleTrace[] = [];
  let guard = 0;
  while (!p.isHalted()) {
    if (guard++ >= 800) throw new Error('exceeded 800 cycles — runaway loop?');
    traces.push(p.step());
  }
  return traces;
}

const micro = (t: CycleTrace): DeepPipelineMicro => t.state.micro as DeepPipelineMicro;

const cfg = (over: Partial<ProcessorConfig>): ProcessorConfig => ({
  ...defaultConfig(),
  cache: null,
  ...over,
});

/** One emitted `cache-access` as the compact token the 5-stage's suite uses: `H` / `M` / `M!<hex>`. */
function accessTokens(ts: CycleTrace[]): string[] {
  const tokens: string[] = [];
  for (const t of ts) {
    for (const e of t.events) {
      if (e.type === 'cache-access') {
        tokens.push(e.hit ? 'H' : e.evicted === undefined ? 'M' : `M!${e.evicted.toString(16)}`);
      }
    }
  }
  return tokens;
}

const PROGRAMS = [
  'add.s',
  'array-sum.s',
  'array-sum-twice.s',
  'branch-flavors.s',
  'byte-loads.s',
  'call-return.s',
  'paired-branches.s',
  'slow-op-loop.s',
  'store-forward.s',
  'strided-sum.s',
  'sum-loop.s',
] as const;

describe('the verdict sequence is the 5-stage’s — depth changes WHEN, never WHICH', () => {
  const image = asmFile('array-sum-twice.s');

  // The flagship straddle: three blocks, so a 4-line cache holds them across the repeat pass and a
  // 2-line cache thrashes. Both literals are the ones `engine/pipeline`'s cache-stall suite pins.
  it('array-sum-twice at the LARGE cache: cold misses, then an all-hit repeat pass', () => {
    // prettier-ignore
    expect(accessTokens(run(image, cfg({ forwarding: true, cache: CACHE_LARGE })))).toEqual([
      'M','H','H','H', 'M','H','H','H', 'M','H','H','H',
      'H','H','H','H', 'H','H','H','H', 'H','H','H','H',
    ]);
  });

  it('array-sum-twice at the SMALL cache: the same stream, now with conflict misses', () => {
    // prettier-ignore
    expect(accessTokens(run(image, cfg({ forwarding: true, cache: CACHE_SMALL })))).toEqual([
      'M','H','H','H', 'M','H','H','H', 'M!10000000','H','H','H',
      'M!10000020','H','H','H', 'H','H','H','H', 'M!10000000','H','H','H',
    ]);
  });

  it('emits nothing at all with no cache — the inertness contract', () => {
    expect(accessTokens(run(image, cfg({ forwarding: true })))).toEqual([]);
  });

  /**
   * And the stream does not depend on the two knobs that CAN move the machine's timing. This is the
   * "no wrong-path instruction reaches MEM" claim made falsifiable: a speculation leak would show up
   * here as an extra access under one prediction scheme, and nowhere else in the suite.
   */
  it('is invariant under forwarding and prediction — no speculative access ever reaches MEM', () => {
    const truth = accessTokens(run(image, cfg({ forwarding: true, cache: CACHE_SMALL })));
    for (const forwarding of [false, true]) {
      for (const branchPrediction of ['none', 'static-not-taken', 'static-taken'] as const) {
        expect(
          accessTokens(run(image, cfg({ forwarding, branchPrediction, cache: CACHE_SMALL }))),
          `forwarding=${forwarding} ${branchPrediction}`,
        ).toEqual(truth);
      }
    }
  });
});

describe('the cache axis is purely additive: cycles = cacheless + misses × missPenalty', () => {
  /**
   * The whole corpus × both forwarding positions × both geometries, as an IDENTITY rather than a
   * table. The cache-off counts are already hand-derived and pinned cell-by-cell in
   * `timing.test.ts`; restating them times three would be transcription. What this adds is the one
   * claim those cannot make — that the third axis contributes `missPenalty` per miss and nothing
   * else, which is the finding that kept this file small.
   *
   * `M` is computed from the emitted verdicts, so a machine that stalled on hits, stalled twice on
   * one miss, or served a penalty it never announced fails here.
   */
  it.each(PROGRAMS)('%s', (file) => {
    const image = asmFile(file);
    let sawAMiss = false;
    for (const forwarding of [false, true]) {
      for (const cache of [CACHE_SMALL, CACHE_LARGE]) {
        const baseline = run(image, cfg({ forwarding }));
        const cached = run(image, cfg({ forwarding, cache }));
        const misses = accessTokens(cached).filter((t) => t !== 'H').length;
        expect(cached.length, `${file} fwd=${forwarding} lines=${cache.numLines}`).toBe(
          baseline.length + misses * cache.missPenalty,
        );
        if (misses > 0) sawAMiss = true;
      }
    }
    // Not vacuous for the programs that touch memory — `add.s` and the pure-branch programs
    // legitimately have none, and are here to pin that a cache costs a memory-free program NOTHING.
    const MEMORY_FREE = [
      'add.s',
      'branch-flavors.s',
      'call-return.s',
      'paired-branches.s',
      'slow-op-loop.s',
      'sum-loop.s',
    ];
    expect(sawAMiss, `${file} produced no misses`).toBe(!MEMORY_FREE.includes(file));
  });
});

describe('the freeze mechanics — five stages hold, and the cache is consulted ONCE', () => {
  // A short penalty so the countdown is hand-legible, and one line so the second access conflicts.
  const TINY = directMapped(1, 3);
  const IMAGE = asmFile('array-sum.s');

  it('holds the missing instruction in MEM and freezes everything younger', () => {
    const traces = run(IMAGE, cfg({ forwarding: true, cache: TINY }));
    const missAt = traces.findIndex((t) =>
      t.events.some((e) => e.type === 'cache-access' && !e.hit),
    );
    expect(missAt).toBeGreaterThanOrEqual(0);

    const at = (i: number): DeepPipelineMicro => micro(traces[i]!);
    const held = at(missAt).ex2Mem;
    expect(held).not.toBeNull();

    // The three frozen cycles after detection: MEM re-presents the SAME instruction, the five
    // younger latches are unchanged, and WB is a bubble because nothing can retire out of MEM.
    for (let i = missAt; i < missAt + TINY.missPenalty; i++) {
      const m = at(i);
      expect(m.ex2Mem?.instr, `cycle ${i}: MEM occupant`).toBe(held!.instr);
      expect(m.memWb, `cycle ${i}: WB bubble`).toBeNull();
      expect(m.ex1Ex2?.instr, `cycle ${i}: EX2 frozen`).toBe(at(missAt).ex1Ex2?.instr);
      expect(m.idEx1?.instr, `cycle ${i}: EX1 frozen`).toBe(at(missAt).idEx1?.instr);
      expect(m.if2Id?.instr, `cycle ${i}: ID frozen`).toBe(at(missAt).if2Id?.instr);
      expect(m.if1If2?.instr, `cycle ${i}: IF2 frozen`).toBe(at(missAt).if1If2?.instr);
    }
    // …and on the release cycle it finally advances.
    expect(at(missAt + TINY.missPenalty).memWb?.instr).toBe(held!.instr);
  });

  it('consults the cache once per access and defers the memory read to the release cycle', () => {
    const traces = run(IMAGE, cfg({ forwarding: true, cache: TINY }));
    // One `cache-access` per memory instruction — never one per frozen cycle. Re-consulting mid
    // hold would also be silently WRONG, not just noisy: the tag was installed on detection, so the
    // second look would spuriously hit.
    const memoryOps = traces.flatMap((t) =>
      t.events.filter((e) => e.type === 'mem-read' || e.type === 'mem-write'),
    ).length;
    expect(accessTokens(traces).length).toBe(memoryOps);

    // The datum arrives on the RELEASE cycle, not the detection cycle: no `mem-read` shares a cycle
    // with a missing `cache-access`.
    for (const t of traces) {
      const missed = t.events.some((e) => e.type === 'cache-access' && !e.hit);
      if (missed) expect(t.events.some((e) => e.type === 'mem-read')).toBe(false);
    }
  });
});

describe('a miss must not eat a forward (the M11 step 6a regression, this machine’s own)', () => {
  /**
   * The bug `docs/reviews/m11-miss-freeze-forward-loss.md` records, which this engine's step-6
   * graft would have inherited verbatim from the 5-stage: a producer P, a missing memory op Q, then
   * a consumer C of P, positioned so C is in EX1 needing the `MEM/WB → EX1` forward on exactly the
   * cycle Q detects its miss. P retires during the freeze and its latch drains, so an EX1 that has
   * not captured by then executes on the stale pre-forwarding read from ID.
   *
   * No corpus program contains the geometry — which is why the whole 132-cell dump was clean while
   * the 5-stage was broken — so it is hand-built, and the consumer distance is SWEPT because the
   * alignment that breaks is a function of the machine's depth.
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
${filler}    addi x10, x10, -1    # C — reads x10 stale in ID; needs the forward in EX1
    li   a7, 10
    ecall
`;
  }

  function finalX10(fillers: number, config: ProcessorConfig): number {
    const { program, errors } = assemble(src(fillers));
    if (!program) throw new Error(errors.map((e) => e.message).join());
    const traces = run(toProgramImage(program), config);
    return traces[traces.length - 1]!.state.registers[10]!;
  }

  it.each([0, 1, 2, 3])('consumer %i behind the load: the cache never moves the answer', (k) => {
    for (const forwarding of [false, true]) {
      const truth = finalX10(k, cfg({ forwarding }));
      expect(truth, `k=${k} fwd=${forwarding} cache-off`).toBe(2); // 3 − 1
      expect(finalX10(k, cfg({ forwarding, cache: CACHE_SMALL })), `k=${k} fwd=${forwarding}`).toBe(
        truth,
      );
    }
  });
});

describe('INV-8 locally, and the recorder’s deep-copy obligation', () => {
  it('a cache changes latency and never the architectural answer', () => {
    // The full-corpus differential runs cache-less by construction (`differential.test.ts` explains
    // why); this is the spot-check that the timing shadow leaks no value into the result.
    for (const file of ['array-sum-twice.s', 'byte-loads.s', 'strided-sum.s', 'store-forward.s']) {
      const image = asmFile(file);
      const truth = run(image, cfg({ forwarding: true }));
      const last = (ts: CycleTrace[]): CycleTrace => ts[ts.length - 1]!;
      for (const cache of [CACHE_SMALL, CACHE_LARGE]) {
        const cached = last(run(image, cfg({ forwarding: true, cache })));
        expect(cached.state.registers, `${file} lines=${cache.numLines}`).toEqual(
          last(truth).state.registers,
        );
        expect(cached.state.pc, `${file} pc`).toBe(last(truth).state.pc);
      }
    }
  });

  it('records a COLD cache early and a WARM one late — the aliasing bug time-travel would show', () => {
    // `CacheState` is single-buffered and mutated in place, so a shallow copy in `snapshotState`
    // would make every recorded cycle show the FINAL warm cache. Final-state conformance cannot see
    // that; only a comparison of two cycles of the same run can.
    const traces = run(asmFile('array-sum.s'), cfg({ forwarding: true, cache: CACHE_SMALL }));
    const valid = (t: CycleTrace): number =>
      (micro(t).cache?.lines ?? []).filter((l) => l.valid).length;

    expect(valid(traces[0]!), 'cycle 0 is cold').toBe(0);
    expect(valid(traces[traces.length - 1]!), 'the last cycle is warm').toBeGreaterThan(0);
    // And null all the way through when no cache is configured — not an empty object.
    for (const t of run(asmFile('array-sum.s'), cfg({ forwarding: true }))) {
      expect(micro(t).cache).toBeNull();
    }
  });
});
