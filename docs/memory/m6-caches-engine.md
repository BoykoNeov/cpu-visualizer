---
name: m6-caches-engine
description: 'M6 steps 0-2: the cache as the third pipeline toggle - the corpus prerequisite (`array-sum-twice.s`), the pure timing shadow that is called by nothing, and the pipeline honoring `config.cache` as a variable-latency MEM.'
metadata:
  node_type: memory
  type: project
---

## M6 (CACHES — the third pipeline toggle) — PLAN pushed, **STEP 0 DONE** (2026-07-18, 967 -> 976 tests)

`docs/plans/m6-tasks.md` (headline: the cache is a **timing shadow**, holds no values ⇒ INV-8 green by
construction; direct-mapped, D-cache only, write-through/no-allocate, `missPenalty` fixed cycles). Step 0 is
the ONE milestone the spec gates on new corpus programs (§12.3), so it grows the library before any cache code.

**Step 0 — grow the corpus.** Added exactly one program, `content/programs/array-sum-twice.s`: an outer loop
of 2 passes over a 12-word inner walk, summing 2·(1+…+12) = 156 (a0=x10; outer counter t3=x28 lands 0). The
second pass resets the pointer and re-reads the same 12 addresses = **temporal reuse**, the cache-relevant
fact a single pass cannot exhibit. No cache code; pure regression, green across every model × config.

- **`array-sum.s` already serves as the clean spatial-locality walk** (16-byte line ⇒ its 5 words are one
  full line + one partial; `arr[0]` misses then `arr[1..3]` hit, the `total` store lands in the second line),
  so NO second program was authored — the README's reachability bar ("name what the corpus makes
  **unreachable**, not what a new program makes **nicer**"), applied. The README gained `array-sum-twice` as
  its second worked example, mirroring `branch-flavors`.
- **The locality-PUNISHER ("a bigger cache buys nothing") is DEFERRED to step 4 as a STRIDE, not a program.**
  §12.3/step 4 allow "a program **or a stride**"; a no-revisit stride over this array already has no reuse for
  any cache to capture. Authoring a program now = paper-design before the cache exists to test it (the M5
  failure this plan cites). Left as an open step-4 item, not dropped.
- **THE REUSABLE FINDING #1: an array program's size is CO-DESIGNED with the cache geometry, and step 0
  COMMITS the array.** The straddle only exists relative to (line size, small #lines, large #lines).
  `array-sum-twice`'s 12-word working set = 3 lines against a 16-byte line, and straddles a **2↔4 line** flip:
  fits the 4-line (repeat pass all hits, confirmed by a scratch direct-mapped model), overflows the 2-line
  (repeat pass re-misses). **Step 1's `CacheConfig` defaults MUST honor 16-byte line / 2↔4 lines or the
  straddle breaks** — pinned in the m6 decisions table AND the `.s` header AND the README, made that prominent
  on the advisor's flag that this cross-step coupling is the one thing a future session could silently violate.
- **THE REUSABLE FINDING #2: corpus program size is BOUNDED by two caps every M6 array program inherits.** The
  pipeline timing suite's `run()` throws at **500 cycles**, and `PipelineMapView` pages at **400 cycles**. A
  24-word ×2 walk is 254 retires / ~554 cycles — over BOTH. 12 words is 290 off / 208 on — under both, and is
  now the **longest program the corpus ships** (its 290 displaced sum-loop's 78 as the `PipelineMapView` "fits
  without paging" witness; paging stays a sandbox-only affordance). This is why the array is 12 words, not 24.
- **Step 0's tests are BLIND to the reuse property** (INV-8 equality is cache-oblivious — a buggy no-reuse walk
  would pass green), so it was hand-verified. But the oracle `a0=156` INDIRECTLY pins it: both passes must sum
  arr[0..11], and no other `.data` region sums to 78 (advisor's catch — better-guarded than the general worry).
- The `TIMING` entry (`timing.test.ts`) was **hand-derived from the pinned recurrence, not snapshotted** — the
  corpus's first NESTED loop. N=134, T=23, S_off=106 / S_on=24, P=2·23=46. One stall array-sum never had: the
  first `lw` of each pass is **distance-2** from the `la` (only `li t1` between) ⇒ interlocks 1 cycle
  forwarding-off, where array-sum's distance-3 `lw` is free. All matrix cases (both forwarding × both predict
  schemes) green first run. Files touched: the `.s`, `conformance.ts` oracle, `timing.test.ts` entry,
  `PipelineMapView.test.tsx` witness + describe-comment, README, m6 plan. No engine, no renderer, no new field.

### M6 STEP 1 — THE TIMING SHADOW (pure, called by nothing) — DONE (2026-07-18, 976 -> 985)

`CacheConfig` filled in `trace` (`lineSize`/`numLines`/`missPenalty`, all readonly) + `engine/pipeline/src/cache.ts`:
a pure timing shadow (`CacheLine = {valid, tag}`, **NO value field** — memory stays sole truth ⇒ INV-8 green by
construction), `access(state, config, addr, allocate) → {hit, evicted?}` MUTATING single-buffered state; decode
helpers `lineIndex`/`lineTag`/`blockBase` (for step 6's view, INV-3); geometry pinned as `LINE_SIZE_BYTES=16` +
`directMapped(numLines, missPenalty=10)` + `CACHE_SMALL`(2 lines)/`CACHE_LARGE`(4 lines). **Imported by its own test
only, not `index.ts`** (M4-step-0 inertness). Deliverable `cache.test.ts` (9 tests, all green first run) CLOSES step
0's hand-only co-design claim MECHANICALLY: drives the REAL cache-off engine over `array-sum-twice.s`, harvests the 24
`mem-read` addresses (`length===24` + `slice(12)===slice(0,12)` = the temporal reuse), replays both configs, asserts
the FULL hit/miss/evict verdict SEQUENCE (5 misses/3 evicts on 2-line vs 3/0 on 4-line — never an opaque total).
Non-circular _because_ the timing shadow makes the address stream cache-invariant. Findings: `evicted` = evicted
block's **base byte address**; `allocate` (load→true, store→false = no-write-allocate) is a pure MECHANISM knob, the
policy NAME lives at step 2's MEM call site. **Stall-machinery scout at the foot of `cache.ts`:** the load-use stall
is a ONE-SHOT boolean (recomputed each cycle) that CANNOT express a multi-cycle hold — a miss needs a persistent
`missCyclesRemaining` countdown in the ExMem latch, reusing the reverse-walk signal shape but FREEZING IF/ID/EX.

### M6 STEP 2 — THE PIPELINE HONORS `config.cache` (variable-latency MEM) — DONE (2026-07-18, 985 -> 999)

The machine's **first variable-latency stage.** `processor.ts`: `stageMem` splits three ways — **mid-stall**
(decrement `missCyclesRemaining`, do NOT re-consult: a second `access` would spuriously hit), **fresh-arrival miss**
(consult once via `consultCache`, install tag, hold), **hit/no-cache/release** (the cache-less MEM, unchanged). A
miss raises `ctx.memStall`; `holdInMem` re-presents the occupant in `next.exMem` with the countdown and leaves
`next.memWb` null (the WB bubble); EX/ID/IF read `memStall` later in the reverse walk and FREEZE their occupants.
The new primitive is `ExMemLatch.missCyclesRemaining` (0 at rest, set to `missPenalty` on detection, ticked down,
rides double-buffering into `micro`); `PipelineMicro` gained `cache: CacheState|null` **deep-copied per snapshot**
(single-buffered, like memory). `configurableCache` flipped `true`. **Zero new trace-schema fields** — `cache-access`
already existed; the only additions are engine-internal `micro`/latch shape.

- **Deliverable `cache-stall.test.ts` (14 tests, all green first run), four layers:** (1) **wiring bridge** — the
  REAL engine's cache emits the EXACT `cache-access` token sequence step 1 pinned against the replayed model stream
  (closes step 1's cache-invariance loop; step 1 = "model given this stream", step 2 = "the engine's own cache").
  (2) **mechanism** on a minimal program at penalty 3: one miss holds MEM for penalty+1 cycles, ticks 3→2→1, freezes
  EX, fires `access`/`mem-read` EXACTLY ONCE. (3) **pinned cycle counts** — the `+M` term (`M = misses×missPenalty`)
  as a COMPOSITION of two already-pinned facts (cache-off cycles from `timing.test.ts`, miss counts from
  `cache.test.ts`), never a snapshot: OFF null 290 → SMALL **340** (the plan author's own committed `290+5×10`,
  reproduced deliberately — the strongest wiring evidence) / LARGE 320; ON null 208 → SMALL 258 / LARGE 238, plus the
  subtraction form `on−off = misses×penalty`. (4) **INV-8 locally** (cache-off vs SMALL byte-identical, a0=156) + the
  recorder **deep-copy witness** (cycle-0 cache all-invalid, final warm, distinct objects).
- **Additivity is EXACT and structural, not arithmetic luck** (advisor-confirmed): 10 frozen + 1 productive release =
  11 MEM cycles = `1 + missPenalty`; the load-use bubble is decided in EX one cycle before the miss is detected in
  MEM, so bubble + freeze compose SEQUENTIALLY; and this corpus's loads sit structurally clear of every branch resolve.
  So each miss adds exactly `missPenalty`, no overlap. (Holds _for this corpus_ — all step 2 claims.)
- **Two pre-existing whole-object `toEqual`s in `processor.test.ts` broke and were fixed as EXPECTED step-2 changes,
  not worked around:** `configurableCache` now `true`, and the `micro` snapshot literal gained `cache: null` (cache-off).
- **Scope discipline:** full config-matrix conformance is **step 3** (the `configLabel` cache clause); the per-term
  `N+4+S+P+M` decomposition + "no size dominates" signed deltas is **step 4** — deliberately NOT built here.
