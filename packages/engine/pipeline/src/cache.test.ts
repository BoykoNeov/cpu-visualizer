import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import { defaultConfig, type CacheConfig, type CycleTrace } from '@cpu-viz/trace';
import { PipelineProcessor } from './index';
import {
  access,
  blockBase,
  CACHE_LARGE,
  CACHE_SMALL,
  directMapped,
  lineIndex,
  lineTag,
  newCache,
  type CacheAccess,
} from './cache';

/**
 * M6 step 1 — the timing shadow, pinned before anything rests on it.
 *
 * Step 1 wires NOTHING: `access` is pure and unreferenced by the machine. So this file is the step's
 * entire deliverable (as `predict.test.ts` was M4 step 0's), and its headline job is narrow: prove
 * the **straddle** — that `array-sum-twice.s` really produces an address stream a 2-line cache misses
 * MORE often than a 4-line one (5 vs 3). That is the co-designed fact step 0 could only verify by
 * hand, because INV-8 is cache-oblivious: a no-reuse walk passes conformance green, so nothing
 * mechanical pinned "the second pass could hit". This is the first chance to close it.
 *
 * **Why this is not circular.** The addresses come from the ENGINE — a real cache-off run's
 * `mem-read` events, a fact about the PROGRAM. The verdicts come from the MODEL UNDER TEST — the
 * engine has no cache. They are checked against a hand-derivation written before the code. The
 * address stream is legitimately the stream a cache would see precisely BECAUSE the cache is a timing
 * shadow: it holds no values, so it cannot change which addresses the loads compute (INV-8 is green
 * by construction), so a cache-less run's stream is the stream. The `length === 24` guard is the
 * non-vacuity check — 2 passes × 12 loads — and `slice(12) === slice(0,12)` pins the temporal reuse
 * itself: the second pass really re-reads the first pass's addresses.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

/** Every data-memory read address the real (cache-off) engine issues, in order. */
function memReadAddrs(file: string): number[] {
  const { program, errors } = assemble(readFileSync(PROGRAMS_DIR + file, 'utf8'));
  if (!program) throw new Error(`${file}: assembly failed: ${errors.map((e) => e.message).join()}`);
  const p = new PipelineProcessor();
  p.reset(toProgramImage(program), defaultConfig());
  const addrs: number[] = [];
  let guard = 0;
  while (!p.isHalted()) {
    if (guard++ >= 500) throw new Error(`${file}: exceeded 500 cycles — runaway loop?`);
    const t: CycleTrace = p.step();
    for (const e of t.events) if (e.type === 'mem-read') addrs.push(e.addr >>> 0);
  }
  return addrs;
}

/**
 * One access as a compact hand-checkable token: `H` (hit), `M` (compulsory / non-evicting miss), or
 * `M!<hex>` (miss that evicted the block based at 0x<hex>). Asserting the full SEQUENCE of these —
 * not a miss TOTAL — is M3 step 3's rule: a lone total lets a compensating over/under pair pass and
 * localizes nothing. The 5 and the 3 fall OUT of the sequence; they are not the assertion.
 */
function token(a: CacheAccess): string {
  if (a.hit) return 'H';
  return a.evicted === undefined ? 'M' : `M!${a.evicted.toString(16)}`;
}

/** Replay an address stream through a fresh cache; every access is a load (allocate = true). */
function replay(config: CacheConfig, addrs: readonly number[]): string[] {
  const state = newCache(config);
  return addrs.map((addr) => token(access(state, config, addr, true)));
}

describe('array-sum-twice straddles the cache size — the flagship, from the real engine', () => {
  const addrs = memReadAddrs('array-sum-twice.s');

  it('issues the reuse stream: 24 loads, the second pass re-reading the first', () => {
    // 2 passes × 12-word inner walk. This guard IS the non-vacuity check for everything below.
    expect(addrs).toHaveLength(24);
    // Temporal reuse, stated as a property of the ENGINE's stream: pass 2 re-reads pass 1 verbatim.
    expect(addrs.slice(12)).toEqual(addrs.slice(0, 12));
    // Anchor the base so the eviction hexes below are attributable to real addresses (DATA_BASE).
    expect(addrs[0]).toBe(0x10000000);
  });

  /**
   * The 4-line cache FITS the working set (3 blocks ≤ 4 lines): 3 compulsory misses in pass 1, then
   * the repeat pass finds every line resident and all-hits. 3 misses, no eviction ever.
   */
  it('4 lines: fits — 3 compulsory misses, then an all-hit second pass', () => {
    // prettier-ignore
    expect(replay(CACHE_LARGE, addrs)).toEqual([
      'M','H','H','H', 'M','H','H','H', 'M','H','H','H',   // pass 1: one miss per block
      'H','H','H','H', 'H','H','H','H', 'H','H','H','H',   // pass 2: all resident
    ]);
  });

  /**
   * The 2-line cache OVERFLOWS it (3 blocks > 2 lines): block 2 aliases block 0 (2 mod 2 = 0) and
   * evicts it late in pass 1, so pass 2 finds blocks 0 and 2 gone and re-misses each. 5 misses, 3
   * evictions — the same source, slower, because the size no longer covers the reuse.
   */
  it('2 lines: overflows — a conflict evict in pass 1, two re-misses in pass 2 (5 total)', () => {
    // prettier-ignore
    expect(replay(CACHE_SMALL, addrs)).toEqual([
      'M','H','H','H', 'M','H','H','H', 'M!10000000','H','H','H',       // pass 1: block2 evicts block0
      'M!10000020','H','H','H', 'H','H','H','H', 'M!10000000','H','H','H', // pass 2: block0 & block2 re-miss
    ]);
  });

  /** The thesis as one number, derived FROM the sequences above — bigger cache, fewer misses. */
  it('the flip is real: a bigger cache buys 2 fewer misses on the same program', () => {
    const misses = (config: CacheConfig): number =>
      replay(config, addrs).filter((t) => t !== 'H').length;
    expect(misses(CACHE_SMALL)).toBe(5);
    expect(misses(CACHE_LARGE)).toBe(3);
  });
});

/**
 * The straddle's FLIP SIDE — the corpus's no-reuse walks, and the locality-PUNISHER step 0 deferred
 * to step 4. `array-sum.s` and `byte-loads.s` each touch every block EXACTLY ONCE (no revisit), so
 * every miss is compulsory and a bigger cache captures nothing extra: the verdict sequence — and
 * therefore the miss count — is IDENTICAL at 2 and 4 lines. This is why no new program or stride was
 * needed for "a bigger cache buys nothing" (step 0's open item): `array-sum.s` already IS it. It and
 * `array-sum-twice.s` are a matched pair, differing ONLY in whether the walk repeats — spatial
 * locality lives in the LINE (the 3 hits after each block's first touch, both programs), while
 * temporal locality is what SIZE buys, and a single pass has none. The verdict sequences are pinned
 * here (M3 step 3's "assert the sequence, not the total" rule); `timing.test.ts` composes their miss
 * counts into the `+M` cycle term.
 */
describe('the no-reuse walks miss identically at any size — a bigger cache buys nothing', () => {
  it('array-sum.s: one miss per block, both sizes (5 loads, 2 misses)', () => {
    // Loads only. The `sw a0, 0(t3)` to `total` lands in block 1, resident from the `arr[4]` load, so
    // it HITS and installs no miss — a fact the timing suite's engine-level miss count confirms end
    // to end; here we pin the load walk that carries the reuse story.
    const addrs = memReadAddrs('array-sum.s');
    expect(addrs).toHaveLength(5);
    expect(addrs[0]).toBe(0x10000000); // arr @ DATA_BASE, so block 0 = arr[0..3], block 1 = arr[4]
    // prettier-ignore
    const seq = ['M', 'H', 'H', 'H', 'M']; // block 0 miss + 3 spatial hits, then block 1 miss
    expect(replay(CACHE_SMALL, addrs)).toEqual(seq);
    expect(replay(CACHE_LARGE, addrs)).toEqual(seq);
  });

  it('byte-loads.s: the same byte twice, one block, both sizes (1 miss)', () => {
    // `lb` then `lbu`, both `0(t0)` — one address, one block: compulsory miss then a hit on the
    // resident line. No size can change a single-block program.
    const addrs = memReadAddrs('byte-loads.s');
    expect(addrs).toHaveLength(2);
    expect(replay(CACHE_SMALL, addrs)).toEqual(['M', 'H']);
    expect(replay(CACHE_LARGE, addrs)).toEqual(['M', 'H']);
  });
});

describe('access — the direct-mapped mechanism', () => {
  const cfg = directMapped(2); // 16-byte line, 2 lines, so blocks 0 and 2 collide on line 0.

  /** The plan's named acceptance sequence: compulsory → hit → conflict-evict → re-miss. */
  it('compulsory → hit → conflict-evict → re-miss', () => {
    const s = newCache(cfg);
    // Block 0 (addr 0x00), line 0: cold ⇒ compulsory miss, nothing to evict.
    expect(access(s, cfg, 0x00, true)).toEqual({ hit: false });
    // Same block, one word in ⇒ hit, no mutation of identity.
    expect(access(s, cfg, 0x04, true)).toEqual({ hit: true });
    // Block 2 (addr 0x20) also maps to line 0 (2 mod 2) ⇒ conflict miss, evicts block 0 (base 0).
    expect(access(s, cfg, 0x20, true)).toEqual({ hit: false, evicted: 0x00 });
    // Block 0 again ⇒ it is gone; re-miss, evicting block 2 (base 0x20) in turn.
    expect(access(s, cfg, 0x00, true)).toEqual({ hit: false, evicted: 0x20 });
  });

  it('a cold cache is all-invalid, and a hit mutates nothing', () => {
    const s = newCache(cfg);
    expect(s.lines).toEqual([
      { valid: false, tag: 0 },
      { valid: false, tag: 0 },
    ]);
    access(s, cfg, 0x00, true); // install block 0 on line 0
    const before = JSON.stringify(s);
    expect(access(s, cfg, 0x08, true)).toEqual({ hit: true }); // same block ⇒ hit
    expect(JSON.stringify(s)).toBe(before); // a hit changes no tag/valid bit
  });

  /**
   * No-write-allocate (a store, `allocate = false`): a miss installs NOTHING, so the very next
   * access to the same block is STILL a compulsory miss. This is the write policy the timing shadow
   * makes trivial — the store already wrote memory; the cache simply did not learn the line.
   */
  it('no-write-allocate: a store miss installs nothing', () => {
    const s = newCache(cfg);
    expect(access(s, cfg, 0x00, false)).toEqual({ hit: false }); // store miss: no install
    expect(s.lines[0]).toEqual({ valid: false, tag: 0 }); // line stayed cold
    expect(access(s, cfg, 0x00, true)).toEqual({ hit: false }); // ⇒ next load still compulsory-misses
  });

  /**
   * A store that HITS also changes nothing (write-through already wrote memory), and — the load-
   * bearing half — leaves the line resident, so it can still be found and later evicted normally.
   */
  it('a store hit leaves the resident line in place', () => {
    const s = newCache(cfg);
    access(s, cfg, 0x00, true); // load installs block 0
    expect(access(s, cfg, 0x04, false)).toEqual({ hit: true }); // store hit
    expect(access(s, cfg, 0x20, true)).toEqual({ hit: false, evicted: 0x00 }); // block 0 was still there
  });
});

describe('address decode — the fields the view derives (INV-3)', () => {
  const cfg = directMapped(4); // 16-byte line, 4 lines.

  it('splits an address into block-base / index / tag', () => {
    // Two addresses in the same 16-byte block share base, index, and tag.
    expect(blockBase(cfg, 0x00)).toBe(0x00);
    expect(blockBase(cfg, 0x0f)).toBe(0x00);
    expect(lineIndex(cfg, 0x00)).toBe(0);
    expect(lineIndex(cfg, 0x0f)).toBe(0);
    expect(lineTag(cfg, 0x00)).toBe(0);

    // Block 1 (addr 16): next line, same tag band.
    expect(blockBase(cfg, 0x10)).toBe(0x10);
    expect(lineIndex(cfg, 0x10)).toBe(1);
    expect(lineTag(cfg, 0x10)).toBe(0);

    // Block 4 (addr 64) wraps the 4-line index back to 0 and increments the tag.
    expect(lineIndex(cfg, 0x40)).toBe(0);
    expect(lineTag(cfg, 0x40)).toBe(1);
  });
});
