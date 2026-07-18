import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import {
  defaultConfig,
  type CacheConfig,
  type CycleTrace,
  type ProcessorConfig,
} from '@cpu-viz/trace';
import { PipelineProcessor, type PipelineMicro } from './index';
import { CACHE_LARGE, CACHE_SMALL, directMapped } from './cache';

/**
 * M6 step 2 — the pipeline honors `config.cache`: the machine's FIRST variable-latency stage.
 *
 * Step 1 proved the timing shadow in isolation: fed the real engine's cache-off address stream, the
 * pure `access` model produces a pinned hit/miss/evict sequence (5 misses on 2 lines, 3 on 4). It
 * wired the model to NOTHING. This step wires it into MEM — a miss now HOLDS the instruction and
 * freezes IF/ID/EX for `missPenalty` cycles via the `missCyclesRemaining` countdown persisted in the
 * ExMem latch — and this file is the wiring's net. Four things, in the order they build on each other:
 *
 *  1. **The wiring bridge.** The REAL cache, driven by the REAL engine, emits exactly the
 *     `cache-access` verdict SEQUENCE step 1 pinned against the replayed stream. Step 1 said "the
 *     model, given this address stream, produces these verdicts"; step 2 says "the engine's own cache
 *     produces them" — closing the loop the timing shadow's cache-invariance let step 1 open.
 *  2. **The mechanism**, on a minimal program with a short penalty so the countdown is hand-legible:
 *     one miss holds its load in MEM, ticks `missCyclesRemaining` down, freezes the front of the
 *     pipe, and fires its memory access + `cache-access` EXACTLY ONCE (never re-firing while frozen).
 *  3. **The pinned cycle counts**, derived BEFORE the engine is asked (step 2's stated acceptance),
 *     as the closed form's new `+M` term: `cycles = N + 4 + S + P + M`, `M = misses × missPenalty`.
 *     Every number below is a COMPOSITION of two already-pinned facts — the cache-off cycle count
 *     (`timing.test.ts`) and the miss count (`cache.test.ts`) — times `missPenalty`. Nothing is read
 *     off a passing run (`timing.test.ts`'s standing rule).
 *  4. **INV-8, locally.** A cache changes latency, never state — so the same program under no cache
 *     and under the small cache retires to the byte-identical architectural result (`a0 = 156`). The
 *     full config-matrix conformance is step 3; this is the spot-check that the timing shadow leaks
 *     no value into the answer.
 *
 * Plus the recorder's deep-copy obligation (the cache is single-buffered, mutated in place): an early
 * snapshot must show a COLD cache while a late one shows a WARM one — the aliasing bug the note at the
 * head of `CacheState` warns about would make every recorded cycle show the final warm state.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

/** Assemble a corpus program by name, or throw with the assembler's diagnostics. */
function asmFile(file: string): ReturnType<typeof toProgramImage> {
  const { program, errors } = assemble(readFileSync(PROGRAMS_DIR + file, 'utf8'));
  if (!program) throw new Error(`${file}: assembly failed: ${errors.map((e) => e.message).join()}`);
  return toProgramImage(program);
}

/** Drive a program image to halt under `config`, collecting every cycle. */
function run(image: ReturnType<typeof toProgramImage>, config: ProcessorConfig): CycleTrace[] {
  const p = new PipelineProcessor();
  p.reset(image, config);
  const traces: CycleTrace[] = [];
  let guard = 0;
  while (!p.isHalted()) {
    if (guard++ >= 500) throw new Error('exceeded 500 cycles — runaway loop?');
    traces.push(p.step());
  }
  return traces;
}

const micro = (t: CycleTrace): PipelineMicro => t.state.micro as PipelineMicro;

const withCache = (base: ProcessorConfig, cache: CacheConfig | null): ProcessorConfig => ({
  ...base,
  cache,
});

/**
 * One emitted `cache-access` as the same compact token `cache.test.ts` replays the pure model into —
 * `H` / `M` / `M!<hex>` — so the two files' sequences are literally comparable. This is the bridge:
 * step 1's array is the MODEL's verdicts; the array this builds is the ENGINE's.
 */
function accessTokens(ts: CycleTrace[]): string[] {
  const tokens: string[] = [];
  for (const t of ts) {
    for (const e of t.events) {
      if (e.type === 'cache-access') {
        expect(e.level, 'single level reads 1').toBe(1);
        tokens.push(e.hit ? 'H' : e.evicted === undefined ? 'M' : `M!${e.evicted.toString(16)}`);
      }
    }
  }
  return tokens;
}

// -------------------------------------------------------------------------------------------------
// 1. The wiring bridge — the real engine's cache emits step 1's pinned sequence.
// -------------------------------------------------------------------------------------------------

describe('the engine cache emits step 1’s pinned verdict sequence (the wiring bridge)', () => {
  const image = asmFile('array-sum-twice.s');
  // Forwarding on or off cannot change which addresses are loaded (INV-8), so the verdict sequence is
  // forwarding-invariant; drive it forwarding-on, the default the corpus timing runs under.
  const base: ProcessorConfig = { ...defaultConfig(), forwarding: true };

  it('4 lines: fits — 3 compulsory misses, then an all-hit second pass', () => {
    // The exact array `cache.test.ts` replayed the pure model into — now produced by the ENGINE.
    // prettier-ignore
    expect(accessTokens(run(image, withCache(base, CACHE_LARGE)))).toEqual([
      'M','H','H','H', 'M','H','H','H', 'M','H','H','H',
      'H','H','H','H', 'H','H','H','H', 'H','H','H','H',
    ]);
  });

  it('2 lines: overflows — a conflict evict in pass 1, two re-misses in pass 2 (5 total)', () => {
    // prettier-ignore
    expect(accessTokens(run(image, withCache(base, CACHE_SMALL)))).toEqual([
      'M','H','H','H', 'M','H','H','H', 'M!10000000','H','H','H',
      'M!10000020','H','H','H', 'H','H','H','H', 'M!10000000','H','H','H',
    ]);
  });

  it('no cache configured emits no cache-access at all — cache-off is inert', () => {
    expect(accessTokens(run(image, withCache(base, null)))).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// 2. The mechanism — one miss, watched cycle by cycle with a short, legible penalty.
// -------------------------------------------------------------------------------------------------

describe('a miss holds MEM, freezes the front, and fires exactly once', () => {
  // A minimal straight-line program: load one word (a compulsory miss), then three independent adds
  // to occupy IF/ID/EX while the load is stalled in MEM. `la` expands to lui+addi; the `lw` is the
  // only memory access, so exactly one cache-access is expected.
  const SOURCE = [
    '.text',
    'la t0, val', //  0: lui t0, hi ; 4: addi t0, t0, lo
    'lw t1, 0(t0)', //  8: the one load — a compulsory MISS
    'addi t2, x0, 1', // 12
    'addi t3, x0, 2', // 16
    'addi t4, x0, 3', // 20
    'ecall', //         24
    '.data',
    'val: .word 99',
  ].join('\n');

  const PENALTY = 3; // short on purpose: the countdown 3→2→1 is hand-checkable
  const image = (): ReturnType<typeof toProgramImage> => {
    const { program, errors } = assemble(SOURCE);
    if (!program) throw new Error(`assembly failed: ${errors.map((e) => e.message).join()}`);
    return toProgramImage(program);
  };
  const ts = run(
    image(),
    withCache({ ...defaultConfig(), forwarding: true }, directMapped(2, PENALTY)),
  );

  /** The location of a given instruction id in a given cycle, or undefined if not in flight. */
  const locationOf = (t: CycleTrace, id: string): string | undefined =>
    t.instructions.find((i) => i.id === id)?.location;

  it('consults the cache exactly once for the one load — a frozen cycle does NOT re-consult', () => {
    // The decisive guard: were the cache re-consulted each frozen cycle, the now-installed line would
    // spuriously HIT and the event stream would carry a miss followed by hits. Exactly one event,
    // and it is the miss.
    const accesses = ts.flatMap((t) => t.events.filter((e) => e.type === 'cache-access'));
    expect(accesses).toHaveLength(1);
    expect(accesses[0]).toMatchObject({ level: 1, hit: false });
  });

  it('performs the memory read exactly once, on release — not once per frozen cycle', () => {
    const reads = ts.flatMap((t) => t.events.filter((e) => e.type === 'mem-read'));
    expect(reads).toHaveLength(1);
  });

  it('ticks missCyclesRemaining down 3 → 2 → 1 while frozen, then releases', () => {
    // The persisted countdown, snapshot by snapshot. The positive values across the whole run are
    // exactly one descent from the penalty to 1 — a single miss, held `PENALTY` cycles.
    const countdown = ts.map((t) => micro(t).exMem?.missCyclesRemaining ?? 0).filter((n) => n > 0);
    expect(countdown).toEqual([3, 2, 1]);
  });

  it('freezes the front of the pipe: MEM holds the load and EX holds its occupant while stalled', () => {
    // The load is the instruction its unique mem-read names (cache-access carries an addr, not an id).
    const memRead = ts.flatMap((t) => t.events.filter((e) => e.type === 'mem-read'))[0]!;

    // The cycles where the load sits in MEM: the freeze (PENALTY) + the productive release = 4.
    const memCycles = ts.filter((t) => locationOf(t, memRead.instr) === 'MEM');
    expect(memCycles, 'load held in MEM for penalty + release cycles').toHaveLength(PENALTY + 1);

    // During the FROZEN cycles (all but the last MEM cycle), whatever is in EX does not move on — a
    // structural stall holds EX, not just IF. Collect the EX occupant across the frozen span; it must
    // be a single, unchanging instruction (the front of the pipe is frozen, so nothing advances).
    const frozen = memCycles.slice(0, PENALTY);
    const exOccupants = new Set(
      frozen.map((t) => t.instructions.find((i) => i.location === 'EX')?.id).filter(Boolean),
    );
    expect(exOccupants.size, 'EX occupant is frozen, unchanging, across the whole stall').toBe(1);
  });
});

// -------------------------------------------------------------------------------------------------
// 3. The pinned cycle counts — the +M term, derived before the engine is asked.
// -------------------------------------------------------------------------------------------------

describe('cycles = N + 4 + S + P + M — the miss term, composed from already-pinned facts', () => {
  const image = asmFile('array-sum-twice.s');
  const OFF: ProcessorConfig = { ...defaultConfig(), forwarding: false };
  const ON: ProcessorConfig = { ...defaultConfig(), forwarding: true };
  const MISS_PENALTY = 10; // CACHE_SMALL / CACHE_LARGE default (see cache.ts)

  // The two inputs, each pinned in another file and NOT re-derived here:
  //   cache-off cycles (timing.test.ts): OFF = N+4+S+P = 134+4+106+46 = 290; ON = 134+4+24+46 = 208.
  //   misses     (cache.test.ts):        SMALL = 5,  LARGE = 3.
  // The step-2 claim is that the cache adds `misses × missPenalty` and nothing else — additive
  // because a miss freezes the whole front of the pipe, so its penalty cycles overlap no other stall.
  const CACHE_OFF_CYCLES = { off: 290, on: 208 } as const;
  const MISSES = { small: 5, large: 3 } as const;

  it.each([
    { pos: 'off', cache: 'small', geom: CACHE_SMALL, expected: 340 },
    { pos: 'off', cache: 'large', geom: CACHE_LARGE, expected: 320 },
    { pos: 'on', cache: 'small', geom: CACHE_SMALL, expected: 258 },
    { pos: 'on', cache: 'large', geom: CACHE_LARGE, expected: 238 },
  ] as const)(
    'forwarding $pos, $cache cache: $expected cycles',
    ({ pos, cache, geom, expected }) => {
      // Re-derive the pin in-place from its two pinned parts, so the literal above cannot drift from its
      // own justification: base + misses×penalty must equal the asserted total.
      const derived = CACHE_OFF_CYCLES[pos] + MISSES[cache] * MISS_PENALTY;
      expect(derived, 'the pin equals base + misses×penalty').toBe(expected);

      const base = pos === 'off' ? OFF : ON;
      const ts = run(image, withCache(base, geom));
      expect(ts).toHaveLength(expected);
    },
  );

  it('the whole cache cost is misses × penalty, exactly — cache-off is the base', () => {
    // The subtraction form of the same claim, config-invariant like the crown jewel: turning the
    // cache on adds precisely the miss penalty, no more (no absorbed stalls, no lost cycles).
    for (const pos of ['off', 'on'] as const) {
      const base = pos === 'off' ? OFF : ON;
      const off = run(image, withCache(base, null)).length;
      expect(off, 'cache-off matches the pinned base').toBe(CACHE_OFF_CYCLES[pos]);
      for (const [cache, geom] of [
        ['small', CACHE_SMALL],
        ['large', CACHE_LARGE],
      ] as const) {
        const on = run(image, withCache(base, geom)).length;
        expect(on - off, `${pos}/${cache}: added cost is misses×penalty`).toBe(
          MISSES[cache] * MISS_PENALTY,
        );
      }
    }
  });
});

// -------------------------------------------------------------------------------------------------
// 4. INV-8 locally, and the recorder's deep-copy obligation.
// -------------------------------------------------------------------------------------------------

describe('the cache changes latency, never state (INV-8 spot-check)', () => {
  const image = asmFile('array-sum-twice.s');
  const ON: ProcessorConfig = { ...defaultConfig(), forwarding: true };

  it('same program, same answer, cache-off vs the small cache — a0 = 156', () => {
    const off = run(image, withCache(ON, null));
    const small = run(image, withCache(ON, CACHE_SMALL));
    const finalOff = off[off.length - 1]!.state;
    const finalSmall = small[small.length - 1]!.state;

    // The timing shadow leaks no value into the architectural result: byte-identical registers and pc.
    expect([...finalSmall.registers]).toEqual([...finalOff.registers]);
    expect(finalSmall.pc).toBe(finalOff.pc);
    expect(finalSmall.halted).toBe(finalOff.halted);
    // ...and the oracle itself: 2 × (1 + … + 12) = 156 in a0 (x10), the outer counter t3 (x28) at 0.
    expect(finalSmall.registers[10]).toBe(156);
    expect(finalSmall.registers[28]).toBe(0);
    // The small cache took strictly longer despite the identical answer — latency, not correctness.
    expect(small.length).toBeGreaterThan(off.length);
  });
});

describe('the recorder deep-copies the single-buffered cache into each snapshot', () => {
  const image = asmFile('array-sum-twice.s');
  const ON: ProcessorConfig = { ...defaultConfig(), forwarding: true };

  it('an early snapshot is cold while a late one is warm — no aliasing to the final state', () => {
    const ts = run(image, withCache(ON, CACHE_SMALL));

    // Cycle 0: nothing has reached MEM, so the cache is untouched — every line invalid. Were the
    // recorder to share one mutable cache across cycles (the aliasing bug the CacheState note warns
    // about), this snapshot would already show the final warm state and the assertion would fail.
    const first = micro(ts[0]!).cache;
    expect(first, 'cycle 0 carries a cache snapshot').not.toBeNull();
    expect(
      first!.lines.every((l) => !l.valid),
      'the earliest cache is all-invalid (cold)',
    ).toBe(true);

    // The final snapshot: the walk has installed lines, so at least one is valid (warm).
    const last = micro(ts[ts.length - 1]!).cache;
    expect(
      last!.lines.some((l) => l.valid),
      'the final cache is warm',
    ).toBe(true);

    // And decisively: the two snapshots are DISTINCT objects with distinct contents — proof the copy
    // is deep, not a shared reference that would read identically at both ends.
    expect(first!.lines).not.toEqual(last!.lines);
  });
});
