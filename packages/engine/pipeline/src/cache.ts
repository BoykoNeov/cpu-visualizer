/**
 * The D-cache — a **timing shadow** (M6 step 1), pure and called by nothing yet.
 *
 * **Why this file exists now, wired to nothing.** This is the M4-step-0 inertness pattern
 * (`predict.ts`): the model is complete, pure, and unit-tested in isolation, but the pipeline does
 * not consult it until step 2, so every existing test stays green and *unmoved*. What step 1 buys
 * is the same thing step 0 bought prediction — the load-bearing property pinned *before* anything
 * rests on it. There, it was "ID's target agrees with EX's". Here, it is the **straddle**: that the
 * corpus's `array-sum-twice.s` really does produce an address stream a 2-line cache misses more
 * often than a 4-line one (5 vs 3), the co-designed fact step 0 could only check by hand because
 * INV-8 is cache-oblivious. `cache.test.ts` closes that mechanically against the real engine.
 *
 * **The headline design — the cache holds NO values.** Memory stays the sole source of truth. This
 * structure is tags + valid bits only, consulted to answer one question — *did this address hit?* —
 * which decides *latency* and nothing else. Three consequences, and they are why the milestone is
 * cheap:
 *   - INV-8 is green **by construction**: a value-less cache cannot change an architectural result,
 *     so the differential net needs no argument (unlike prediction, which had to argue "speculation
 *     never commits").
 *   - **No write-back merge ever exists.** `getState()` reads memory, which was always current, so
 *     there is nothing to reconcile. Write policy collapses to *"when do tags get installed"* — see
 *     {@link access}'s `allocate`.
 *   - The model is a dozen lines and fully deterministic (INV-1).
 *
 * **Fidelity (MVP, pinned in `docs/plans/m6-tasks.md`):** direct-mapped, single-level, D-cache
 * only, write-through / no-write-allocate, fixed {@link CacheConfig.missPenalty}. Associativity +
 * replacement, an L2, an I-cache, and write-back are deferred — none is a field here.
 */

import type { CacheConfig } from '@cpu-viz/trace';

/**
 * One direct-mapped line: is anything resident, and if so, whose. **No data** — the timing shadow
 * holds identity, not values (see the module header). `tag` is meaningless when `!valid`.
 */
export interface CacheLine {
  valid: boolean;
  tag: number;
}

/**
 * The cache's whole state: one line per set (direct-mapped ⇒ `lines.length === config.numLines`).
 * A plain mutable array of {@link CacheLine} — this is the class the project's memory calls "not
 * double-buffered", the same as the register file and memory. {@link access} mutates it in place.
 *
 * **Note for step 2:** because it is single-buffered, the recorder must DEEP-COPY this into each
 * per-cycle `MachineState.micro` snapshot (exactly as it already deep-copies memory), or time-travel
 * would alias one mutable cache across every cycle.
 */
export interface CacheState {
  readonly lines: CacheLine[];
}

/** The verdict of one access — the timing shadow's entire output. */
export interface CacheAccess {
  /** Was the addressed line resident with a matching tag? Hit ⇒ ordinary MEM cost; miss ⇒ penalty. */
  readonly hit: boolean;
  /**
   * On an allocating miss that REPLACED a resident line, the base byte address of the block that was
   * evicted — a concrete "the data at 0x… was kicked out" for the view and the `cache-access.evicted`
   * trace field. Absent on a hit, on a compulsory miss (the line was invalid — nothing to evict), and
   * on a non-allocating miss (a no-write-allocate store touches no line; see {@link access}).
   */
  readonly evicted?: number;
}

/** A fresh, cold cache: every line invalid. The compulsory-miss starting point. */
export function newCache(config: CacheConfig): CacheState {
  return {
    lines: Array.from({ length: config.numLines }, () => ({ valid: false, tag: 0 })),
  };
}

// --- Address decode -------------------------------------------------------------------------------
//
// A byte address splits into three fields, exactly the textbook direct-mapped layout. For a
// power-of-two geometry these are contiguous bit-fields — offset (low `log2(lineSize)` bits), index
// (next `log2(numLines)` bits), tag (the rest) — but the arithmetic below (floor-div / mod) is the
// same value for any positive geometry and needs no power-of-two precondition to be correct. These
// are exported pure so step 6's view can derive index/tag from `addr` + config WITHOUT reaching into
// the engine (INV-3), the way the pipeline datapath derives its wires from the decode.

/** The block (line-sized chunk of memory) an address falls in — its number, not its byte address. */
function blockOf(config: CacheConfig, addr: number): number {
  return Math.floor(addr / config.lineSize);
}

/** Which line (set) an address maps to. Direct-mapped: exactly one, no choice. */
export function lineIndex(config: CacheConfig, addr: number): number {
  return blockOf(config, addr) % config.numLines;
}

/** The tag identifying an address's block within its line — what a valid line must match to hit. */
export function lineTag(config: CacheConfig, addr: number): number {
  return Math.floor(blockOf(config, addr) / config.numLines);
}

/** The base byte address of the block containing `addr` (the line-aligned floor). */
export function blockBase(config: CacheConfig, addr: number): number {
  return blockOf(config, addr) * config.lineSize;
}

/**
 * Reconstruct a block's base byte address from its (index, tag) — the inverse of the decode above.
 * Used internally for the `evicted` field and, from step 6, EXPORTED (via `index.ts`) so the grid
 * view can turn a resident line's `(index, tag)` into the human range it holds ("line 0 · 0x…–0x…").
 * A line's `tag` is a huge number on its own; the base address is the pedagogically meaningful thing.
 */
export function blockBaseOf(config: CacheConfig, index: number, tag: number): number {
  return (tag * config.numLines + index) * config.lineSize;
}

/**
 * Consult the cache for `addr`, MUTATING `state`, and return the hit/miss verdict.
 *
 * `allocate` is the write-policy knob, kept as a pure mechanism here so the *policy* name lives at
 * step 2's MEM call site: a LOAD passes `allocate = true` (a load miss brings its line in), a STORE
 * passes `allocate = false` — that is **no-write-allocate**, a store that misses installs nothing.
 * (A store that HITS also changes no tag; write-through already wrote memory, and the line stays
 * resident.) So a tag is installed on exactly one path: an allocating miss.
 *
 * Eviction is the act of replacing a *different* resident block, so `evicted` is set only when an
 * allocating miss overwrites a valid line whose tag differs. A compulsory miss (invalid line) evicts
 * nothing; a non-allocating miss touches no line at all.
 */
export function access(
  state: CacheState,
  config: CacheConfig,
  addr: number,
  allocate: boolean,
): CacheAccess {
  const index = lineIndex(config, addr);
  const tag = lineTag(config, addr);
  const line = state.lines[index]!;

  if (line.valid && line.tag === tag) return { hit: true };

  // Miss. Under no-write-allocate (a store), leave the cache exactly as it was — no install, so no
  // eviction either. The store still went to memory upstream; the cache simply did not learn it.
  if (!allocate) return { hit: false };

  // Allocating miss: install this block, reporting an eviction only if a *different* block was here.
  const evicted = line.valid && line.tag !== tag ? blockBaseOf(config, index, line.tag) : undefined;
  line.valid = true;
  line.tag = tag;
  return evicted === undefined ? { hit: false } : { hit: false, evicted };
}

// --- The flagship geometry (co-designed with the corpus) -----------------------------------------
//
// `array-sum-twice.s`'s 12-word working set was SIZED against this exact geometry (step 0 committed
// it; the `.s` header and the m6 decisions table pin it): a 16-byte line flipped 2 ↔ 4 lines. Three
// blocks (12 words / 4-per-line) FIT the 4-line cache — the repeat pass finds every line resident and
// all-hits — but OVERFLOW the 2-line one, where block 2 aliases block 0 (2 mod 2 = 0) and evicts it,
// so the repeat pass re-misses. That is the straddle the flagship experiment rides, reproduced from
// the real engine's address stream in `cache.test.ts`. These constants ARE that experiment's single
// source of truth; step 4 (timing) and step 5 (the web toggle) read them rather than re-deriving.

/** The line size the corpus array was sized against. Changing it de-straddles the experiment. */
export const LINE_SIZE_BYTES = 16;

/**
 * A default fixed miss penalty. Modest on purpose: `array-sum-twice.s` is ~290 cycles forwarding-off
 * with no cache, and its worst case (small cache) adds 5 misses, so 290 + 5×10 = 340 stays under both
 * the pipeline timing suite's 500-cycle cap and the pipeline map's 400-cycle page cap. Step 4 owns
 * the final value; it is a knob, not a law.
 */
const DEFAULT_MISS_PENALTY = 10;

/** Build a direct-mapped config over the shipped {@link LINE_SIZE_BYTES} line. */
export function directMapped(numLines: number, missPenalty = DEFAULT_MISS_PENALTY): CacheConfig {
  return { lineSize: LINE_SIZE_BYTES, numLines, missPenalty };
}

/** The small side of the flip: 2 lines. `array-sum-twice.s`'s 3 blocks overflow it ⇒ conflict misses. */
export const CACHE_SMALL = directMapped(2);

/** The large side of the flip: 4 lines. The same 3 blocks fit ⇒ the repeat pass all-hits. */
export const CACHE_LARGE = directMapped(4);

/* =================================================================================================
 * STEP 2 SCOUT — how a miss stalls the pipeline (the plan's open structural question, grounded in
 * `processor.ts` rather than restated from prose). The answer step 2 does not have to discover:
 *
 * The load-use stall (the ONLY stall today) is a ONE-SHOT boolean. `detectHazard` recomputes it
 * fresh every cycle from `ctx.prev` latches; `stageId` raises `ctx.stalled`, sets `ctx.next.idEx =
 * null` (a bubble slides into EX) and `ctx.next.ifId = fd` (the instruction stays in ID); `stageIf`
 * reads `ctx.stalled` LATER in the reverse walk (WB→MEM→EX→ID→IF) and re-presents its held `ifSlot`
 * rather than re-fetching (which would mint a second id — INV-4). So the freeze is: raise a signal
 * in one stage, read it downstream in the same reverse walk, hold the upstream latch.
 *
 * A miss-stall REUSES that signal-propagation shape but CANNOT reuse the one-shot boolean, and this
 * is the milestone's genuinely new machinery — three differences, each a real cost:
 *
 *   1. It triggers in MEM, not ID. Harmless: MEM runs before EX/ID/IF in the reverse walk, so a hold
 *      raised there is already visible to every younger stage this same cycle. Free, like load-use.
 *   2. It freezes IF/ID/EX (everything upstream of MEM), not just IF/ID — a structural stall holds
 *      the whole front of the pipe. And it FREEZES rather than bubbles: MEM keeps re-presenting the
 *      same waiting instruction, IF/ID/EX hold their occupants, and WB (downstream of MEM) is the one
 *      that gets the bubble, because nothing can retire out of MEM until the miss resolves.
 *   3. It lasts `missPenalty` cycles, not one. The one-shot boolean is recomputed every tick, so it
 *      literally cannot remember "I am 3 cycles into a penalty". A miss needs a COUNTDOWN PERSISTED
 *      IN STATE — a `missCyclesRemaining` in the ExMem latch / `micro`, decremented each cycle,
 *      releasing the freeze at zero. That persistent counter is the new primitive; the freeze wiring
 *      is the old one extended one-shot→multi-cycle and one-stage→multi-stage.
 *
 * Exact per-cycle latch bookkeeping (which latch holds vs. bubbles on the release cycle) is step 2's
 * to pin against hand-derived cycle counts; the shape above is what step 1 owes it.
 * ============================================================================================== */
