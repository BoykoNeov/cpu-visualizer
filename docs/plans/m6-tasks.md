# Milestone 6 — caches (the third toggle on the pipeline)

**Status: STEPS 0–2 DONE, 2026-07-18 (999 tests). The corpus straddler ships, the pure timing-shadow
model is proven against the real engine's address stream, and the pipeline now HONORS `config.cache`:
a miss freezes IF/ID/EX for `missPenalty` cycles via the `missCyclesRemaining` countdown — the machine's
first variable-latency stage. Cache-off runs are byte-identical to M4. Remaining: the config-matrix
conformance clause (step 3), the per-term timing suite + "no size dominates" thesis (step 4), the web
toggle (step 5), the cache grid view (step 6), and the lesson track (step 7).
Remaining numbers in this plan are DERIVATIONS to be confirmed, not measurements. Deliberately deferred and named:
set-associativity + a replacement policy (the only future user of `config.seed`), a second level
(the `cache-access.level` field already anticipates it), an I-cache, and write-back. The one
milestone the spec itself gates on new corpus programs (§12.3) — so step 0 grows the library before
any cache code is written.**

Source of truth for scope: `cpu-visualizer-spec.md` §12 (roadmap), item 3 — the **caches** half of
§12.3. M4 shipped the other half (branch prediction). The load-bearing constraints are the
architectural invariants (§3) and the trace schema (§5). The pipeline this builds on is
`docs/plans/m3-tasks.md`; the toggle pattern it repeats is `docs/plans/m4-tasks.md`.

## Why this milestone, and why now

M4 shipped the second config toggle on the pipeline and, with M3, established the flagship
interaction: flip a knob, watch the _same program_ change behavior, understand the machine through
the difference. Caches are the third and final toggle §12.3 names, and the last feature of the
in-order tier before the superscalar cliff (§12.4).

**What is cheap because the seams were cut years ago — and one is cheaper than M4's.** Caches
inherit the seam M4 had to _build_ for itself:

- `ProcessorConfig.cache: CacheConfig | null` — already threaded through `loadSource` → session →
  every model (M3 step 5's config seam; prediction rode it, caches ride it too).
- `ProcessorCapabilities.configurableCache` — already exists, currently `false` on every model,
  with a doc comment naming this tier. M3 step 5 pinned that a control is gated on its capability
  flag, so the UI wiring is a known move.
- **The `cache-access` event already exists in the schema** (`trace/schema.ts:120`:
  `{ type: 'cache-access'; level; addr; hit; evicted? }`), emitted by nothing today. This is the
  exact thing M4 discovered it was missing and had to add (`branch-predicted`). Caches start where
  M4 ended: the transaction is already expressible; nothing produces it yet.
- `configLabel` (conformance) already carries a comment reserving the `cache` clause — "deliberately
  not written yet… it is an object, so it would need a deep compare." This milestone writes that one
  clause; the shape of the work is known, not discovered.

**The genuinely new machinery — name it up front, the way M4 named the ID redirect.** A cache miss
makes the MEM stage take longer. The M3/M4 pipeline **has no variable-latency stage**: every stage
is one cycle, and its only stall (the load-use bubble) is a _one-shot_ decided in **ID**, holding
**IF** for **one** cycle, re-evaluated fresh each tick (`processor.ts`: ID raises `stalled`, IF
holds, `ctx.next.idEx = null`). A miss-stall is the same freeze primitive with three differences,
and each is the structural cost:

1. **It triggers in MEM, not ID.** The reverse walk is WB→MEM→EX→ID→IF, so a hold raised in MEM is
   read by EX/ID/IF _later in the same walk_ — the identical producer-before-consumer pattern the
   load-use stall already uses. This part is free.
2. **It holds IF/ID/EX, not just IF.** A structural stall freezes _everything upstream_ of the
   stalled stage, not one latch.
3. **It lasts `missPenalty` cycles, not one.** The current `stalled` boolean cannot express a
   multi-cycle hold — it is recomputed every tick. A miss needs a **countdown that persists in
   state** (a `missCyclesRemaining` in the MEM latch / `micro`), decremented each cycle, releasing
   the freeze at zero.

**M6 is where a pipeline stage first takes a variable number of cycles, driven by DATA (the
address's hit/miss) rather than by the instruction mix.** That is the sentence step 2 must not
discover; it belongs here.

**And the one prerequisite no other milestone had: the corpus must grow first.** §12.3 says it
outright — "cache behavior only becomes visible with programs that loop over arrays; toy programs
won't stress it." This is the only tier gated on new example programs, which is why it was deferred
behind M4 rather than sequenced beside it.

### What M6 does not inherit / does not attempt

- **A replacement policy.** Direct-mapped has no choice to make: each address maps to exactly one
  line. So **`config.seed` stays unused** — the whole of §73's "seed any randomness" concern is out
  of scope, and random replacement is pinned as its _only_ future caller (see decisions).
- **Set-associativity.** Deferred fidelity. Direct-mapped is not the cheap version — it is the
  _sharpest_ for conflict misses (two addresses with the same index bit evict each other, with no
  LRU ambiguity to explain), so it is both MVP and pedagogically strongest (see headline).
- **A second level.** The `cache-access.level` field is already there for an L2; at single level it
  reads a fixed `1` (see decisions — pin the constant, don't leave it ambiguous).
- **An I-cache.** Instruction fetch stays uncached. An I-cache emits a _second_ `cache-access`
  stream that muddies the array-walk lesson; omitting it is lawful under INV-5 **as long as no
  surface claims fetch is cached**. D-cache only.
- **Write-back.** See the headline — the timing-shadow design makes write-back not merely deferred
  but _unnecessary to model_ for correctness.

## Headline decision — the cache is a TIMING SHADOW, not a store of values

This is the scope lever and the design's spine. **Memory stays the sole source of truth.** The
engine reads and writes real memory exactly as it does today; the cache is a _parallel_ structure of
tags + valid bits, consulted only to answer one question — _did this address hit?_ — which decides
_latency_. **No value ever lives in the cache's keeping.**

Three things fall out of that single decision, and they are why it is the headline:

- **INV-8 is green BY CONSTRUCTION, not by proof.** A cache that holds no values cannot change an
  architectural result. Like prediction, the cache is architecturally invisible; unlike prediction,
  we do not even have to _argue_ it (M4 argued "speculation never commits"). The differential net is
  green the first run because there is nothing for the cache to get wrong about state. The entire
  payoff is **timing + the view**.
- **The write-back trap never opens.** With a value-holding write-back cache you must prove
  cache+memory merge correctly at `getState()`. With a timing shadow there is nothing to merge —
  `getState()` reads memory, which was always current. So write policy collapses to _"when do tags
  get installed / invalidated,"_ and **write-through, no-write-allocate is the MVP for that reason**,
  not for brevity: a store writes memory (as today) and updates the tag if present, a store miss
  installs nothing. One rule, no merge.
- **The model is tiny and pure.** `access(addr) → { hit, evicted? }` over a direct-mapped tag array
  is a dozen lines, fully deterministic, unit-testable with no engine.

**MVP fidelity:** direct-mapped, single-level, D-cache only, write-through/no-allocate,
`missPenalty` a fixed cycle count. **Deferred fidelity:** associativity + replacement, a second
level, an I-cache, write-back. **The scope lever the reviewer signs off on is `associativity = 1`
and `levels = 1`.** Everything the milestone teaches — compulsory / capacity / conflict misses,
spatial and temporal locality, and the flagship "flip the cache size and watch the same program get
slower" — is reachable at that fidelity. Associativity buys a replacement-policy lesson that is a
_later_ tier's job.

## The corpus precondition, stated as the README's bar

The editorial bar (`content/programs/README.md`) is "name what the existing corpus makes
**unreachable**, not what a new program would make **nicer**." For caches, here is what the corpus
cannot say today, measured against `array-sum.s` (its only array walk — 5 words, one pass):

- **No eviction.** One pass, never revisited; the `evicted` field never fires.
- **No temporal reuse.** No address is read twice, so no "second visit hits."
- **No conflict.** No two live addresses share an index.
- **No size-sensitivity — the load-bearing gap.** 5 contiguous words is all-hits-after-compulsory at
  _any_ sane cache size, so **flipping the cache size changes nothing about it**. It cannot carry
  the flagship interaction. The program §12.3 actually gates on is one whose **working set straddles
  realistic cache sizes**, so the _same source_ runs a different cycle count when you flip the size.

So step 0 grows the corpus. The **load-bearing** program is the size-straddler; the clean
spatial-locality walk is secondary (and `array-sum.s` may nearly serve as it already). Exact set is
decided while authoring (M4's discipline — the corpus argument is made against reachability, not
niceness), but each new program earns its permanent-citizen seat by naming a cache lesson
unreachable without it, and each gets a hand-computed `RESULT_ORACLES` entry (INV-8's root of
trust). **Note the new pinning surface:** timing pins are now per-`(program × cache-config)`, each
needing hand-counted hits/misses — materially more than prediction's per-program deltas.

## Build order (each step testable before the next)

- [x] **0. Grow the corpus — the array-walking programs (the precondition). DONE 2026-07-18.** Added
      **one** program, `array-sum-twice.s`: an outer loop of 2 passes over a 12-element inner walk, so
      the second pass re-reads the same 12 addresses (temporal reuse), summing 2·(1+…+12) = 156.
      `array-sum.s` **already serves** as the clean spatial-locality walk (with a 16-byte line its 5
      words are one full line + one partial, so `arr[0]` misses then `arr[1..3]` hit and the `total`
      store lands in the second line), so no new spatial program was authored — the README's
      reachability bar, not niceness. RESULT_ORACLES entry: a0 = 156, t3 = 0. `conformance.ts`
      enumerated it from disk automatically and it is green across every model × config.
      **Three findings the tests could NOT catch, verified by hand (INV-8 equality is
      cache-oblivious — a no-reuse walk would pass green):** 1. **Array size is co-designed with the cache geometry, and step 0 commits the array.** A
      12-word working set straddles a 16-byte-line cache flipped **2 lines ↔ 4 lines**: 3 lines
      fit the 4-line (repeat pass all hits) but overflow the 2-line (repeat pass re-misses). This
      is the geometry step 1's `CacheConfig` defaults must not de-straddle — pinned as the seed
      decision below. 2. **The 500-cycle timing-suite cap (and the map's 400-cycle page cap) bound the array size.**
      A 24-word ×2 walk is 254 retires / ~554 cycles — over both caps. 12 words (290 off / 208 on)
      stays under both; the map's paging stays a sandbox-only affordance (its "longest shipped
      program" witness moved from sum-loop's 78 to this program's 290, still < 400). 3. **The corpus's first NESTED loop, hand-derived, not snapshotted.** Its `TIMING` entry is
      derived from the pinned recurrence — including one stall array-sum never had: the first `lw`
      of each pass is distance-2 from the `la` (only `li t1` between), so it interlocks 1 cycle
      forwarding-off where array-sum's distance-3 `lw` is free.
      **The locality-punisher ("a bigger cache buys nothing") is DEFERRED to step 4** — §12.3/step 4
      allow "a program **or a stride**", and a no-revisit stride over this program's own array already
      has no reuse for any cache to capture, so it likely needs no new program at all. Authoring one
      now would be authoring-on-paper (the exact M5 failure this plan cites) before the cache exists
      to test it against. Left as an open step-4 item, not silently dropped.

- [x] **1. `CacheConfig` gets real fields + a pure direct-mapped cache model, called by nothing.
      DONE 2026-07-18 (976 → 985 tests, +9).** Filled `CacheConfig` in `trace` (`lineSize`, `numLines`,
      `missPenalty`, all `readonly`) and added `packages/engine/pipeline/src/cache.ts`: a pure timing
      shadow holding tags + valid bits only. `access(state, config, addr, allocate) → { hit, evicted? }`
      MUTATES the state (single-buffered, like memory/regfile), installing the tag on an allocating
      miss; exported decode helpers `lineIndex` / `lineTag` / `blockBase` (for step 6's view, INV-3);
      the flagship geometry pinned as `LINE_SIZE_BYTES = 16` + `directMapped(numLines, missPenalty=10)` + `CACHE_SMALL` (2 lines) / `CACHE_LARGE` (4 lines). **Imported only by its own test — not in
      `index.ts`** (the M4-step-0 inertness pattern; every existing test stays green and unmoved).
      **The deliverable is `cache.test.ts`, which closes the co-design claim step 0 could only check by
      hand:** it drives the REAL cache-off `PipelineProcessor` over `array-sum-twice.s`, collects the 24
      `mem-read` addresses in order (guarding `length === 24` and `slice(12) === slice(0,12)` = the
      temporal reuse itself, both facts about the PROGRAM), then replays that engine stream through both
      configs and asserts the FULL hit/miss/evict verdict sequence — 5 misses (2-line, 3 evictions) vs 3
      (4-line, none) — from which the flip falls out (never an opaque total, M3 step 3's rule). Legit and
      non-circular because the timing shadow means the address stream is cache-invariant. Plus the named
      acceptance sequence (compulsory → hit → conflict-evict → re-miss) and no-write-allocate as direct
      unit tests. **All 9 passed first run** — hand-derivation in `M:\claud_projects\temp` matched.
      Findings: (1) `evicted` = the evicted block's **base byte address** (access knows the old tag at
      eviction, so returning it is the right layering) and `allocate` (load→true, store→false =
      no-write-allocate) is a pure MECHANISM knob — the policy NAME lives at step 2's MEM call site.
      (2) **The stall-machinery scout, grounded in `processor.ts` (not restated from prose), is a block
      comment at the foot of `cache.ts`:** the load-use stall is a ONE-SHOT boolean (`ctx.stalled`,
      recomputed fresh each cycle from `prev`; ID sets `next.idEx = null` + `next.ifId = fd`, IF re-presents
      its held slot). A miss-stall REUSES the reverse-walk signal-propagation shape but CANNOT reuse the
      boolean — it needs a **countdown persisted in state** (`missCyclesRemaining` in the ExMem latch /
      `micro`, decremented to zero), because a one-shot boolean literally cannot remember "3 cycles into a
      penalty"; and it FREEZES IF/ID/EX (bubbling WB) rather than inserting one bubble. That persistent
      counter is the milestone's genuinely-new primitive; the freeze wiring is the old one extended
      one-shot→multi-cycle, one-stage→multi-stage.

- [x] **2. The pipeline honors `config.cache` — variable-latency MEM. DONE 2026-07-18 (985 → 999
      tests, +14).** MEM now consults the D-cache (`consultCache`), a miss installs the tag
      (write-through/no-allocate for stores) and **freezes IF/ID/EX for `missPenalty` cycles** via the
      new `missCyclesRemaining` countdown on the ExMem latch, releasing at zero; emits one
      `cache-access {level:1, …}`; cache contents ride `MachineState.micro` (deep-copied per snapshot,
      since the cache is single-buffered). `configurableCache` flipped to `true`. **The MEM cycle
      splits three ways** (`stageMem`): mid-stall (decrement, do NOT re-consult — a second `access`
      would spuriously hit), fresh-arrival miss (consult once, then hold), and hit/no-cache/release
      (the cache-less MEM, unchanged). The freeze is the load-use signal shape extended
      one-shot→multi-cycle and one-stage→multi-stage: MEM raises `ctx.memStall`, EX/ID/IF read it later
      in the reverse walk and hold their occupants, WB gets the bubble. **Deliverable:
      `cache-stall.test.ts`** (14 tests, all green first run) — four layers: (1) **the wiring bridge**,
      the REAL engine's cache emits the EXACT `cache-access` verdict sequence step 1 pinned against the
      replayed model stream (closing step 1's cache-invariance loop); (2) **the mechanism** on a
      minimal program with penalty 3 — one miss holds MEM for penalty+1 cycles, ticks the countdown
      3→2→1, freezes EX, and fires `access`/`mem-read` EXACTLY ONCE; (3) **the pinned cycle counts**,
      the `+M` term (`M = misses × missPenalty`) as a COMPOSITION of two already-pinned facts —
      cache-off cycles (`timing.test.ts`) and miss counts (`cache.test.ts`) — never a snapshot: OFF
      null 290 → SMALL **340** (the plan author's own committed `290 + 5×10`, reproduced) / LARGE 320;
      ON null 208 → SMALL 258 / LARGE 238, plus the subtraction form (`on − off = misses×penalty`
      exactly); (4) **INV-8 locally** (cache-off vs SMALL byte-identical, `a0=156`) and the recorder
      **deep-copy witness** (cycle-0 cache all-invalid, final warm). **Additivity is exact and
      structural, not arithmetic luck:** 10 frozen + 1 productive release = 11 MEM cycles (one plus
      the penalty), and this corpus's loads sit structurally clear of every branch resolve, while the
      load-use bubble (decided in EX one cycle before the miss is detected in MEM) composes
      sequentially with the freeze. Full config-matrix conformance is **step 3**; the per-term timing
      decomposition + "no size dominates" is **step 4** — deliberately NOT built here. **Zero new trace
      fields.**

- [ ] **3. Conformance matrix + the `configLabel` cache clause.** Extend the differential list to the
      cache axis and write the deep-compare clause `configLabel` reserved. **Acceptance:** matrix
      green; a cache-on and cache-off config produce _distinct_ labels (so a red cell names which
      config broke); the multi-axis list is a case in the label helper's own suite, so its guard can
      reach the collision it guards (M4 step 2's rule — a guard whose case list can't reach the
      collision is not a guard).

- [ ] **4. Timing — the closed form gains a miss term, and bigger is not always better.**
      `cycles = N + 4 + S + P + M`, where `M = Σ (misses × missPenalty)`, derived per program from a
      hand-counted miss/hit breakdown (never a total copied from a passing run — M3 step 3's rule).
      Assert the **flagship thesis**, not just arithmetic: the size-straddler runs a _different cycle
      count under two cache sizes_, and there is a program (or a stride) where a bigger cache buys
      **nothing** — a cache is a bet on locality, and the corpus must contain a program that punishes
      it, exactly as M4's corpus punishes each prediction scheme. **Acceptance:** per-term assertions
      (never an opaque total — a compensating pair of errors passes a total and says nothing);
      each mutation-checked; the "no size dominates" claim asserted as signed per-program deltas.

- [ ] **5. Web: the third toggle.** A cache control (size / on-off), capability-gated on
      `configurableCache`, riding the config seam with no widening — forwarding's and prediction's
      shape. Grow the lesson sweep's config cross-product to the cache axis (M4 step 4's
      `positionsFor` — the helper that decides coverage must itself have a case list reaching its new
      collisions). **Acceptance:** gated absent on single/multi-cycle; the same program's cycle count
      changes on the **live scrub bar** when the size flips (the browser is this project's only net
      for view/wiring — a config the engine ignores can pass every headless web test); every lesson
      still anchors under every config it declares.

- [ ] **6. The cache view — the grid.** A bespoke cache diagram: a column of lines/sets showing
      tag/valid, the accessed line highlighted, hit/miss/evict distinguished. Pure geometry +
      activation module (tested), a wrapper view, a render smoke test, and the browser eyeball.
      **Keep the add-or-decline-a-field thread open:** cache contents are in `micro`, the view
      derives index/tag from `addr` + config (INV-3), and the `cache-access` transaction already
      exists — so likely **no new field**; let this step force one only if it must (M4 declined 4,
      accepted 1). **Note the cost-reducer:** the pipeline map already renders an instruction
      lingering in a stage across cycles (the `IF ID ID ID` stall shape), so multi-cycle MEM
      occupancy on the map probably falls out of existing machinery — the genuinely new drawing is
      the grid. **Acceptance:** geometry invariants (the M3 step-6 suite); browser eyeball, budgeted
      for a defect — view steps in this project have surfaced one nearly every time.

- [ ] **7. The cache track — a SEQUENCE fixed here, not discovered.** Author the lessons in a pinned
      pedagogical order — **spatial locality** (a line brings in neighbors: first touch misses, the
      next few hit) → **temporal locality** (revisit and hit) → **conflict/capacity + the flip** (the
      size-straddler under two sizes; watch the same program get slower). Anchored to `cache-access`
      events, never cycle numbers (INV-6 — "the first `cache-access` with `hit: false`"). **This step
      heeds M5's sharpest finding directly:** M5's track shipped in the _wrong_ order because
      authoring a lesson never reads the other five and incremental insertion cannot see a sequence.
      So the order is fixed in this plan before a lesson is written, and reviewed _as a sequence_.
      **Acceptance:** each lesson anchors under its declared cache config; the validator covers the
      cache axis **without a special case** — if it needs one, the validator's derivation was wrong,
      not the lesson (M3/M4's standing bar).

## Acceptance criteria (mirror the spec §11 shape)

- [ ] Final register + memory state **equals** the golden reference for every corpus program under
      **every** (forwarding × prediction × cache) config (INV-8) — green by construction, because the
      cache holds no values (the timing-shadow design). A cache that stalls wrongly but corrupts no
      state still passes this; timing is its net.
- [ ] The **same program** runs a **different number of cycles** under two cache sizes, on the live
      scrub bar, matching the step-4 pinned derivation.
- [ ] **No cache size dominates:** a program where a bigger cache pays off, and one (or a stride)
      where it buys nothing — both demonstrable, asserted as signed deltas, never averaged.
- [ ] A **miss** is followable: the access, the hit/miss verdict, any eviction, and the MEM stall it
      causes — as `cache-access` + `stall` trace events (INV-3) and on the cache grid + pipeline map.
- [ ] `engine/pipeline` still has **zero** imports from `web`/`curriculum`; the cache is honored via
      `ProcessorConfig` only, with no new back door — cache contents reach the view through `micro`
      in the trace, not through an accessor (INV-2/INV-3).
- [ ] Every lesson still anchors under every config it declares it honors, including the new cache
      axis, with no special case in the validator.

## Decisions to pin (fill in as steps land — seeded with the recommended answers)

| Decision                                                         | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                                                                                                 | Pinned answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cache organization (MVP).**                                    | **Direct-mapped, single-level.** Not the cheap version — the _sharpest_ for conflict misses (same-index addresses evict each other, no replacement-policy ambiguity to explain), so MVP and pedagogically strongest coincide.                                                                                                                                                                                                         | **PINNED (step 1).** Direct-mapped, single-level. `numLines` is also the number of sets; `lineIndex = (addr / lineSize) mod numLines`, exactly one line per address, no replacement choice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Value storage — where does the "data" live?**                  | **Nowhere in the cache — timing shadow.** Memory stays sole source of truth; the cache is tags + valid bits consulted only for hit/miss → latency. Makes INV-8 green by construction and removes the write-back merge entirely. This is the headline.                                                                                                                                                                                 | **PINNED (step 1).** `CacheLine = { valid, tag }`; **no value field.** `access` returns only `{ hit, evicted? }`. INV-8 green by construction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Write policy.**                                                | **Write-through, no-write-allocate.** Falls out of the timing shadow: a store writes memory (as today) and updates a present tag; a store miss installs nothing. No merge, one rule. Write-back is deferred _and unnecessary_ under this design. Surface as an INV-5 lawful simplification in the UI honesty budget.                                                                                                                  | **PINNED (step 1).** Write-through, no-write-allocate, expressed as `access`'s `allocate` MECHANISM knob (load→true, store→false); the policy NAME lives at step 2's MEM call site. A store hit changes no tag; a store miss installs nothing (tested).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Miss penalty — fixed cycles or modeled memory latency?**       | **Fixed `missPenalty` cycles** (a config field). Modeling a memory hierarchy's real latency is the L2 tier's business; a fixed penalty is a true fact about _this_ machine (INV-5: omit detail, never contradict).                                                                                                                                                                                                                    | **PINNED (step 1).** Fixed `CacheConfig.missPenalty`; a hit costs 1 MEM cycle, a miss `1 + missPenalty`. Default 10 (keeps `array-sum-twice` 290 + 5×10 = 340 under both the 400 map / 500 timing caps); **step 4 owns the final value.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **I-cache?**                                                     | **No — D-cache only.** An I-cache adds a second `cache-access` stream that muddies the array-walk lesson. Lawful under INV-5 provided no surface claims fetch is cached.                                                                                                                                                                                                                                                              | _(open)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **`config.seed`.**                                               | **Stays unused this milestone.** Direct-mapped makes no replacement choice, so nothing needs randomness. Pin random-replacement as the _only_ future caller — this closes §73's "seed any randomness" concern for M6 entirely.                                                                                                                                                                                                        | _(open)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **What does `cache-access.level` read at single level?**         | **`1`** (there is one level: L1). Pin the constant so a future L2 adds `2`, and the view never has to guess whether `0` means "L1" or "no level."                                                                                                                                                                                                                                                                                     | _(open)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **The new structural machinery — how does a miss stall?**        | **A countdown persisted in the MEM latch/`micro`**, decremented each cycle, freezing IF/ID/EX until zero — the load-use freeze primitive (raise in MEM, read by EX/ID/IF later in the reverse walk) extended from one-shot/one-stage to multi-cycle/multi-stage. Scout the exact hold mechanism in step 1; if it needs new machinery beyond the countdown, that is this milestone's headline cost and belongs stated, not discovered. | **PINNED (step 2), exactly as scouted.** `ExMemLatch.missCyclesRemaining` (0 at rest) is set to `missPenalty` by `stageMem`'s `holdInMem` on a fresh miss and decremented each cycle; while it (or a fresh miss) is live, MEM raises `ctx.memStall`, EX/ID/IF read it later in the reverse walk and hold their occupants (WB bubbles). The counter rides the immutable, per-cycle-rebuilt latch, so each `micro` snapshot shows it ticking. `stageMem` splits three ways (mid-stall / fresh-miss / hit-or-release) so `access` and the memory op each fire EXACTLY ONCE per memory instruction, not once per frozen cycle. Additivity is structural: 10 frozen + 1 release = `1 + missPenalty` MEM cycles, sequential with (never overlapping) the load-use bubble and every branch resolve. |
| **Does the cache need a trace field beyond the existing event?** | **Probably not.** `cache-access` already carries the transaction; standing cache contents live in `micro`; the view derives index/tag from `addr` + config (INV-3). Let step 6 force a field only if the grid genuinely cannot be drawn without one (M4 declined 4 fields, accepted 1).                                                                                                                                               | **NO NEW TRACE FIELD (step 2).** The `cache-access` event carried the whole transaction unchanged; the only additions are engine-internal `micro` shape (`PipelineMicro.cache: CacheState \| null`) and a latch field (`ExMemLatch.missCyclesRemaining`), neither a trace-schema field. Step 6 (the grid) is the last chance to force one — still expected not to.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **How many new corpus programs, and which?**                     | **At least the size-straddler** (working set crossing realistic cache sizes — the flagship's load-bearing program); a clean spatial-locality walk _if_ `array-sum.s` does not already serve. Decide the exact set while authoring, against the README's reachability bar, not on paper. Each gets a `RESULT_ORACLES` entry.                                                                                                           | **ONE: `array-sum-twice.s`** (the 12-word x2 walk = the size-straddler). `array-sum.s` serves as the spatial walk, so no second program; the punisher is a step-4 stride, not a step-0 program. **Geometry it commits: 16-byte line, flip 2 <-> 4 lines — step 1's `CacheConfig` defaults must honor this or the straddle breaks.** Size also bounded by the 500-cycle timing cap + 400-cycle map page cap (why 12 words, not 24).                                                                                                                                                                                                                                                                                                                                                           |
| **Cache-track lesson order.**                                    | **Spatial → temporal → conflict/capacity+flip**, fixed in this plan and reviewed as a sequence — M5's "incremental insertion cannot see a sequence" finding applied before authoring, not after shipping backward.                                                                                                                                                                                                                    | _(open)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Set-associativity + replacement policy.**                      | **Out of scope.** A later tier; it is what buys a replacement-policy lesson and the one use of `config.seed`. Adding it is a `CacheConfig` change and its own milestone.                                                                                                                                                                                                                                                              | _(open)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Second cache level (L2).**                                     | **Out of scope.** The `level` field anticipates it; modeling a hierarchy is a later tier.                                                                                                                                                                                                                                                                                                                                             | _(open)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Relationship to M2 step 5c.**                                  | **Independent; 5c stays deferred.** 5c is the multi-cycle model's ALUOut→PC path. M6 touches the _pipeline_'s MEM stage. Do not let step 2 quietly absorb it.                                                                                                                                                                                                                                                                         | _(open)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
