# Milestone 6 — caches (the third toggle on the pipeline)

**Status: NOT STARTED, 2026-07-18. Nothing proven yet. This plan is the scope contract; every
number in it is a DERIVATION to be confirmed, not a measurement. Deliberately deferred and named:
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

- [ ] **0. Grow the corpus — the array-walking programs (the precondition).** Add the size-straddler
      (working set that crosses realistic cache sizes so cycle count moves when the size flips) and,
      if `array-sum.s` does not already serve, a clean spatial-locality walk. Each with a
      hand-computed `RESULT_ORACLES` entry. `conformance.ts` enumerates `*.s` from disk, so they join
      the INV-8 net automatically. **Acceptance:** every existing model (single-cycle, multi-cycle,
      pipeline × all current configs) runs the new programs green — they are cache-oblivious, so this
      is pure regression; the headline result matches the hand-computed oracle. No cache code yet.

- [ ] **1. `CacheConfig` gets real fields + a pure direct-mapped cache model, called by nothing.**
      Fill `CacheConfig` (`lineSize`, `numLines`, `missPenalty`) and add `cache.ts` in
      `engine/pipeline`: a pure `access(state, addr) → { hit, evicted? }` over a tag/valid array —
      the timing shadow, holding no values. **Fold in the stall-machinery scout** the pipeline needs
      (how a stage freezes upstream latches; whether a multi-cycle hold reuses the load-use
      primitive) so step 2 does not discover it. Pure, deterministic, unit-tested in isolation, and
      **exported to nothing / called by nothing** — the M4-step-0 inertness pattern, so every
      existing test stays green and _unmoved_. **Acceptance:** unit tests drive hit/miss/eviction
      sequences (compulsory → hit → conflict-evict → re-miss) against hand-derived expectations; the
      full suite is green with the same count + N new.

- [ ] **2. The pipeline honors `config.cache` — variable-latency MEM.** MEM consults the D-cache on
      loads/stores; a miss installs the tag (write-through/no-allocate for stores) and **freezes
      IF/ID/EX for `missPenalty` cycles** via a countdown persisted in the MEM latch, releasing at
      zero; emits `cache-access`; cache contents live in `MachineState.micro`. This is the headline
      structural cost from "why now" — the first multi-cycle stage. **Acceptance:** pinned cycle
      counts on the new programs, **derived before the engine is asked** (the `N+4+S+P+M` form from
      step 4); conformance across the config matrix green on the **first run** (architecturally
      invisible by the timing-shadow design). A cache that mis-stalls but never corrupts state would
      still pass conformance — that is the point; timing (step 4) is its net.

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

| Decision                                                         | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                                                                                                 | Pinned answer |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **Cache organization (MVP).**                                    | **Direct-mapped, single-level.** Not the cheap version — the _sharpest_ for conflict misses (same-index addresses evict each other, no replacement-policy ambiguity to explain), so MVP and pedagogically strongest coincide.                                                                                                                                                                                                         | _(open)_      |
| **Value storage — where does the "data" live?**                  | **Nowhere in the cache — timing shadow.** Memory stays sole source of truth; the cache is tags + valid bits consulted only for hit/miss → latency. Makes INV-8 green by construction and removes the write-back merge entirely. This is the headline.                                                                                                                                                                                 | _(open)_      |
| **Write policy.**                                                | **Write-through, no-write-allocate.** Falls out of the timing shadow: a store writes memory (as today) and updates a present tag; a store miss installs nothing. No merge, one rule. Write-back is deferred _and unnecessary_ under this design. Surface as an INV-5 lawful simplification in the UI honesty budget.                                                                                                                  | _(open)_      |
| **Miss penalty — fixed cycles or modeled memory latency?**       | **Fixed `missPenalty` cycles** (a config field). Modeling a memory hierarchy's real latency is the L2 tier's business; a fixed penalty is a true fact about _this_ machine (INV-5: omit detail, never contradict).                                                                                                                                                                                                                    | _(open)_      |
| **I-cache?**                                                     | **No — D-cache only.** An I-cache adds a second `cache-access` stream that muddies the array-walk lesson. Lawful under INV-5 provided no surface claims fetch is cached.                                                                                                                                                                                                                                                              | _(open)_      |
| **`config.seed`.**                                               | **Stays unused this milestone.** Direct-mapped makes no replacement choice, so nothing needs randomness. Pin random-replacement as the _only_ future caller — this closes §73's "seed any randomness" concern for M6 entirely.                                                                                                                                                                                                        | _(open)_      |
| **What does `cache-access.level` read at single level?**         | **`1`** (there is one level: L1). Pin the constant so a future L2 adds `2`, and the view never has to guess whether `0` means "L1" or "no level."                                                                                                                                                                                                                                                                                     | _(open)_      |
| **The new structural machinery — how does a miss stall?**        | **A countdown persisted in the MEM latch/`micro`**, decremented each cycle, freezing IF/ID/EX until zero — the load-use freeze primitive (raise in MEM, read by EX/ID/IF later in the reverse walk) extended from one-shot/one-stage to multi-cycle/multi-stage. Scout the exact hold mechanism in step 1; if it needs new machinery beyond the countdown, that is this milestone's headline cost and belongs stated, not discovered. | _(open)_      |
| **Does the cache need a trace field beyond the existing event?** | **Probably not.** `cache-access` already carries the transaction; standing cache contents live in `micro`; the view derives index/tag from `addr` + config (INV-3). Let step 6 force a field only if the grid genuinely cannot be drawn without one (M4 declined 4 fields, accepted 1).                                                                                                                                               | _(open)_      |
| **How many new corpus programs, and which?**                     | **At least the size-straddler** (working set crossing realistic cache sizes — the flagship's load-bearing program); a clean spatial-locality walk _if_ `array-sum.s` does not already serve. Decide the exact set while authoring, against the README's reachability bar, not on paper. Each gets a `RESULT_ORACLES` entry.                                                                                                           | _(open)_      |
| **Cache-track lesson order.**                                    | **Spatial → temporal → conflict/capacity+flip**, fixed in this plan and reviewed as a sequence — M5's "incremental insertion cannot see a sequence" finding applied before authoring, not after shipping backward.                                                                                                                                                                                                                    | _(open)_      |
| **Set-associativity + replacement policy.**                      | **Out of scope.** A later tier; it is what buys a replacement-policy lesson and the one use of `config.seed`. Adding it is a `CacheConfig` change and its own milestone.                                                                                                                                                                                                                                                              | _(open)_      |
| **Second cache level (L2).**                                     | **Out of scope.** The `level` field anticipates it; modeling a hierarchy is a later tier.                                                                                                                                                                                                                                                                                                                                             | _(open)_      |
| **Relationship to M2 step 5c.**                                  | **Independent; 5c stays deferred.** 5c is the multi-cycle model's ALUOut→PC path. M6 touches the _pipeline_'s MEM stage. Do not let step 2 quietly absorb it.                                                                                                                                                                                                                                                                         | _(open)_      |
