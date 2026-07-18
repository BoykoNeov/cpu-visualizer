/**
 * The cache grid (M6 step 6) — the pure half of the D-cache view, in the same two-halves shape as
 * the pipeline map: this module folds `(trace-at-cursor, config)` into a per-line view-model with no
 * React and no color, and {@link CacheGrid} owns the drawing. Being pure is what makes the acceptance
 * — "the grid is derived purely from the trace (INV-3)" — checkable headlessly.
 *
 * **Placement note vs. the plan.** M6 step 6 cited "geometry invariants (the M3 step-6 suite)" for
 * acceptance, which are the SVG datapath's polygon/wire litmuses. A cache is a table of lines — rows
 * of `{valid, tag, block}`, one highlighted — with none of that geometry, so this follows the MAP
 * (step 7) instead: a pure fold + an HTML view + a render smoke test. HTML for the same reasons the
 * map is HTML — tabular, and every line is a potential highlight target — not hand-rolled SVG.
 *
 * **This is a STATE view, not a dataflow view — which is why it reads `micro`, and why that is not
 * the datapath's `micro` trap.** The pipeline datapath draws transient mid-cycle dataflow, so it
 * sources occupancy from `instructions[].location` and never from `state.micro` (which is a cycle
 * ahead). The cache grid instead shows the cache's STATE at the cursor — exactly like the register
 * and memory panels — and state panels show the post-cycle-`i` result. So `micro.cache` at cycle `i`
 * (the end-of-cycle tags, deep-copied per snapshot) is precisely what to draw. Verified against a
 * real trace: on the fresh-miss cycle the `cache-access` event and the post-install `micro.cache`
 * share that cycle, so the touched line reads "now holds block X · MISS", which is the honest picture.
 *
 * **The freeze is drawn, not skipped (the load-bearing decision here).** A miss freezes IF/ID/EX for
 * `missPenalty` cycles, and only the FRESH-arrival cycle emits a `cache-access` event — the ~10
 * penalty cycles that follow emit none. A grid keyed only on the event would light for one cycle and
 * go dark for the rest of the stall, blanking the cache panel at the exact moment the map above it
 * shows `MEM MEM MEM` and the flagship "watch it stall on a miss" is happening. So when no event
 * fires but a penalty is in progress (`micro.exMem.missCyclesRemaining > 0`), the served line is
 * derived from the stalled load's address (`micro.exMem.aluOut`) and shown as `filling`, with the
 * countdown. No new trace field — both facts already ride `micro` (INV-3).
 */

import {
  type CacheLine,
  type CacheState,
  type PipelineMicro,
  blockBase,
  blockBaseOf,
  lineIndex,
} from '@cpu-viz/engine-pipeline';
import type { CacheConfig, CycleTrace } from '@cpu-viz/trace';

/**
 * What is happening to one line THIS cycle. `idle` is the resting state; the other four are the
 * cache's whole vocabulary of events, each drawn with its own treatment AND a text label (the relief
 * rule — hue is never the sole carrier). `hit`/`miss`/`evict` come from the `cache-access` event;
 * `filling` is the derived freeze state that keeps the grid live through the miss penalty.
 */
export type LineState = 'idle' | 'hit' | 'miss' | 'evict' | 'filling';

/** One cache line as the grid draws it — a row. */
export interface CacheLineView {
  /** The set index (0-based); direct-mapped, so also the only line an address can land in. */
  readonly index: number;
  readonly valid: boolean;
  /** The base byte address of the resident block, or `null` when the line is invalid. Reconstructed
   *  from `(index, tag)` via the engine's own inverse — the human "line 0 holds 0x…–0x…". */
  readonly blockBase: number | null;
  /** The raw resident tag (meaningless when `!valid`) — carried for the expert readout. */
  readonly tag: number;
  readonly state: LineState;
  /** On `evict`: the base address of the block kicked out this cycle to make room. */
  readonly evicted?: number;
  /** On `filling`: penalty cycles still owed before the datum lands (the freeze countdown). */
  readonly penaltyLeft?: number;
}

/** The one line touched this cycle — the caption's subject — or `null` on an idle cycle. */
export interface CacheAccessView {
  /** The byte address the memory instruction computed. */
  readonly addr: number;
  /** The line it maps to (direct-mapped). */
  readonly line: number;
  /** The base of the accessed block (line-aligned floor of `addr`). */
  readonly blockBase: number;
  /** `filling` while a miss is being served; otherwise the `cache-access` verdict. */
  readonly state: Exclude<LineState, 'idle'>;
  readonly evicted?: number;
  readonly penaltyLeft?: number;
}

/** The whole grid: a pure fold over the cursor's trace + the configured geometry. */
export interface CacheGridView {
  readonly lineSize: number;
  readonly numLines: number;
  readonly lines: readonly CacheLineView[];
  readonly access: CacheAccessView | null;
}

/** A cold line — the compulsory-miss starting point the grid shows before the run (cursor < 0). */
const COLD: CacheLine = { valid: false, tag: 0 };

/**
 * Fold the cursor's trace + the configured cache geometry into the grid view-model. Pure: same
 * inputs ⇒ same view (INV-3). Returns `null` when no cache is configured (nothing to draw).
 *
 * `config` supplies the geometry (`lineSize`, `numLines`) — `CacheState` carries only the lines'
 * tags, not their size — so it is the source of `numLines` too, which lets the grid draw a COLD
 * cache before the first cycle has been recorded (`trace === null`), rather than only appearing once
 * a snapshot exists.
 */
export function buildCacheGrid(
  trace: CycleTrace | null,
  config: CacheConfig | null,
): CacheGridView | null {
  if (config === null) return null;

  const micro = (trace?.state.micro ?? null) as PipelineMicro | null;
  const cache: CacheState | null = micro?.cache ?? null;
  // Contents from the snapshot when there is one, else a cold cache of the configured size.
  const resident: readonly CacheLine[] =
    cache?.lines ?? Array.from({ length: config.numLines }, () => COLD);

  const access = accessThisCycle(trace, micro, config);

  const lines = resident.map((line, index): CacheLineView => {
    const touched = access?.line === index ? access : null;
    return {
      index,
      valid: line.valid,
      blockBase: line.valid ? blockBaseOf(config, index, line.tag) : null,
      tag: line.tag,
      state: touched?.state ?? 'idle',
      ...(touched?.evicted !== undefined ? { evicted: touched.evicted } : {}),
      ...(touched?.penaltyLeft !== undefined ? { penaltyLeft: touched.penaltyLeft } : {}),
    };
  });

  return { lineSize: config.lineSize, numLines: config.numLines, lines, access };
}

/**
 * The line touched this cycle, and how. The `cache-access` event is authoritative when present (it
 * is the cycle the access actually happened, verdict and all); otherwise a penalty in progress means
 * the load is still waiting in MEM, so the served line is derived from the stalled address and shown
 * `filling`. At most one memory instruction is in MEM per cycle, so at most one `cache-access` fires.
 */
function accessThisCycle(
  trace: CycleTrace | null,
  micro: PipelineMicro | null,
  config: CacheConfig,
): CacheAccessView | null {
  const event = trace?.events.find((e) => e.type === 'cache-access');
  if (event && event.type === 'cache-access') {
    const addr = event.addr >>> 0;
    return {
      addr,
      line: lineIndex(config, addr),
      blockBase: blockBase(config, addr),
      state: event.hit ? 'hit' : event.evicted !== undefined ? 'evict' : 'miss',
      ...(event.evicted !== undefined ? { evicted: event.evicted } : {}),
    };
  }

  const em = micro?.exMem;
  if (em && em.missCyclesRemaining > 0 && em.aluOut !== null) {
    const addr = em.aluOut >>> 0;
    return {
      addr,
      line: lineIndex(config, addr),
      blockBase: blockBase(config, addr),
      state: 'filling',
      penaltyLeft: em.missCyclesRemaining,
    };
  }

  return null;
}
