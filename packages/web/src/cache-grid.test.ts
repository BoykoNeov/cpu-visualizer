/**
 * The cache grid fold (M6 step 6) — the pure half, pinned against the REAL engine's recording so the
 * view-model is a fact about the trace, not a fixture. Same discipline as `cache.test.ts` one layer
 * down: drive `array-sum-twice.s` (the size-straddler) under `CACHE_SMALL` and read the grid off the
 * cursor's trace. The specific cycles below were confirmed against a full trace dump before this file
 * was written (the M6 method — derive, don't snapshot); they are the cache's whole vocabulary in one
 * run: cold → compulsory miss → the freeze that follows it → a spatial hit → a conflict eviction.
 *
 * `CACHE_SMALL` (2 lines) is the load-bearing config: it is the only one that evicts, because
 * `array-sum-twice.s`'s three blocks overflow it. `CACHE_LARGE` (4 lines) fits them, so the same run
 * never shows an eviction — that difference, at the view layer, is the flagship size experiment.
 */

import { toProgramImage } from '@cpu-viz/engine-common';
import { assemble } from '@cpu-viz/assembler';
import { CACHE_LARGE, CACHE_SMALL, PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { defaultConfig, type CacheConfig, type CycleTrace } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import { buildCacheGrid } from './cache-grid';
import { EXAMPLE_PROGRAMS } from './programs';

/** The blocks `array-sum-twice.s` touches, as byte addresses — data starts at 0x10000000. */
const BLOCK0 = 0x10000000; // arr[0..3]
const BLOCK2 = 0x10000020; // arr[8..11] — aliases line 0 under the 2-line cache (2 mod 2 = 0)

/** Record the straddler to completion under a given cache, forwarding OFF (the dump's config, so the
 *  pinned cycle numbers hold). `recorded[c].cycle === c`, so the array indexes by cycle. */
function record(cache: CacheConfig): readonly CycleTrace[] {
  const prog = EXAMPLE_PROGRAMS.find((p) => p.name === 'array-sum-twice');
  if (!prog) throw new Error('corpus program array-sum-twice not found');
  const p = new PipelineProcessor();
  const { program, errors } = assemble(prog.source);
  if (!program) throw new Error(`assembly failed: ${errors.map((e) => e.message).join()}`);
  p.reset(toProgramImage(program), { ...defaultConfig(), cache });
  const traces: CycleTrace[] = [];
  let guard = 0;
  while (!p.isHalted()) {
    if (guard++ >= 500) throw new Error('runaway');
    traces.push(p.step());
  }
  return traces;
}

describe('buildCacheGrid over the real straddler run (CACHE_SMALL)', () => {
  const traces = record(CACHE_SMALL);
  const at = (cycle: number) => {
    const grid = buildCacheGrid(traces[cycle] ?? null, CACHE_SMALL);
    if (grid === null) throw new Error(`no grid at cycle ${cycle}`);
    return grid;
  };

  it('draws a cold cache before any access, sized from the config', () => {
    // Pre-run: no trace at all, yet the geometry alone lets it draw the empty cache.
    const preRun = buildCacheGrid(null, CACHE_SMALL);
    expect(preRun).not.toBeNull();
    expect(preRun!.numLines).toBe(2);
    expect(preRun!.lines.every((l) => !l.valid && l.blockBase === null && l.state === 'idle')).toBe(
      true,
    );
    expect(preRun!.access).toBeNull();

    // Cycle 0 of the real run is likewise cold — the compulsory-miss starting point.
    expect(at(0).lines.every((l) => !l.valid)).toBe(true);
    expect(at(0).access).toBeNull();
  });

  it('shows the compulsory miss AND the block it just installed on the same cycle (state view)', () => {
    // The `micro`-edge fact: the miss event and the post-install tags share the fresh-arrival cycle,
    // so the touched line reads "now holds block 0 · MISS" — the honest STATE picture, not a dataflow
    // one-cycle-ahead artifact.
    const g = at(11);
    expect(g.access).toEqual({ addr: BLOCK0, line: 0, blockBase: BLOCK0, state: 'miss' });
    expect(g.lines[0]).toMatchObject({ index: 0, valid: true, blockBase: BLOCK0, state: 'miss' });
    expect(g.lines[1]).toMatchObject({ valid: false, state: 'idle' }); // untouched line stays idle
  });

  it('keeps the served line lit through the freeze, counting down — no event, derived from micro', () => {
    // Cycles 12–20 emit NO cache-access; without the freeze derivation the panel would go dark here
    // while the pipeline map shows MEM MEM MEM. The line stays `filling` with the penalty countdown.
    const g = at(12);
    expect(g.access).toEqual({
      addr: BLOCK0,
      line: 0,
      blockBase: BLOCK0,
      state: 'filling',
      penaltyLeft: 9,
    });
    expect(g.lines[0]).toMatchObject({ valid: true, state: 'filling', penaltyLeft: 9 });
    // The tag is already installed (post-install), so the filling line honestly shows what it holds.
    expect(g.lines[0]!.blockBase).toBe(BLOCK0);
  });

  it('shows a spatial-locality hit with no freeze', () => {
    const g = at(32);
    expect(g.access?.state).toBe('hit');
    expect(g.access?.line).toBe(0);
    expect(g.lines[0]).toMatchObject({ state: 'hit', valid: true, blockBase: BLOCK0 });
    expect(g.lines[0]!.penaltyLeft).toBeUndefined(); // a hit never freezes
  });

  it('shows the conflict eviction — the block kicked out, and the one that replaced it', () => {
    const g = at(119);
    expect(g.access).toEqual({
      addr: BLOCK2,
      line: 0,
      blockBase: BLOCK2,
      state: 'evict',
      evicted: BLOCK0, // block 0 was resident on line 0; block 2 aliases it and kicks it out
    });
    // micro.cache shows the NEW resident (block 2), while the caption names what left (block 0).
    expect(g.lines[0]).toMatchObject({
      valid: true,
      blockBase: BLOCK2,
      state: 'evict',
      evicted: BLOCK0,
    });
  });
});

describe('the size flip, at the view layer (the flagship)', () => {
  const verdicts = (cache: CacheConfig): ReadonlySet<string> => {
    const states = new Set<string>();
    for (const t of record(cache)) {
      const a = buildCacheGrid(t, cache)?.access;
      if (a) states.add(a.state);
    }
    return states;
  };

  it('evicts under the small cache but never under the large one', () => {
    const small = verdicts(CACHE_SMALL);
    const large = verdicts(CACHE_LARGE);
    // Both walk the array, so both compulsory-miss and then hit.
    expect(small).toContain('miss');
    expect(small).toContain('hit');
    expect(large).toContain('miss');
    expect(large).toContain('hit');
    // The straddle: only the 2-line cache overflows, so only it evicts. Flip the size, lose the
    // eviction — the size experiment, visible on the structure it happens in.
    expect(small).toContain('evict');
    expect(large).not.toContain('evict');
  });

  it('draws one row per configured line', () => {
    expect(buildCacheGrid(null, CACHE_SMALL)!.lines).toHaveLength(2);
    expect(buildCacheGrid(null, CACHE_LARGE)!.lines).toHaveLength(4);
  });
});

describe('the gate — nothing to draw without a cache', () => {
  it('returns null when no cache is configured, even with a real trace', () => {
    // A cache-off recording carries no `micro.cache`, and the fold refuses to invent a grid.
    const offTraces = (() => {
      const prog = EXAMPLE_PROGRAMS.find((p) => p.name === 'array-sum-twice')!;
      const p = new PipelineProcessor();
      const { program } = assemble(prog.source);
      p.reset(toProgramImage(program!), defaultConfig()); // cache: null
      const traces: CycleTrace[] = [];
      while (!p.isHalted()) traces.push(p.step());
      return traces;
    })();
    // The config drives the null return (it is what the gate keys on); the trace's own micro.cache
    // is also null under cache-off, which is what App's render gate reads.
    expect(buildCacheGrid(offTraces[11] ?? null, null)).toBeNull();
    const micro = offTraces[11]?.state.micro as { cache?: unknown } | undefined;
    expect(micro?.cache ?? null).toBeNull();
  });
});
