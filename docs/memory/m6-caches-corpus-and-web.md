---
name: m6-caches-corpus-and-web
description: "M6 steps 3-7: the corpus swept three cache ways, the closed form's miss term, the web cache toggle, the CacheGrid stat view, and the cache lesson track that completed M6."
metadata:
  node_type: memory
  type: project
---

## M6 STEP 3 DONE — the corpus runs its (invisible) cache three ways (2026-07-18, 1087 tests, `<committed>`)

Extended the INV-8 differential to the cache axis and wrote the `configLabel` cache clause the comment reserved.
Three files, no engine change:

- **`differential.test.ts` (pipeline):** `CONFIGS` grew from 2 forwarding × 3 predict (6) to the full **× 3 cache**
  cross product (18 configs → 128 pipeline cases). `cache ∈ {null, CACHE_SMALL, CACHE_LARGE}`, imported from
  `./cache` — legal because the test lives IN the pipeline package (conformance itself cannot import them: it sits
  BELOW pipeline in the DAG, so importing would invert it). **Every cache cell is green BY CONSTRUCTION** — the
  timing shadow holds no values, so cache-off / SMALL / LARGE all agree with the value-less golden reference. This
  turns "INV-8 green by construction" from an _argument_ (M4 argued "speculation never commits") into a _mechanical
  net_: a cache bug LEAKING into state (stale value returned, eviction corrupting a word) is caught HERE and nowhere
  else — the timing suite would see a wrong cycle count, never a wrong answer. `CACHE_SMALL` (2 lines) is the
  load-bearing value: the only config exercising the eviction path. The predict × cache cells are where a miss-stall
  and a branch flush contend for a cycle — where a leak would hide — so the full cross product, not a diagonal.
- **`configLabel` clause (`conformance.ts`):** `cache` is the first OBJECT-valued knob, so "does it vary" is a
  `cacheEquals` **deep compare** (all three geometry fields) not a `!==`, and its rendered value a `cacheLabel`
  canonical string (`cache 2×16B/p10` = numLines×lineSizeB/p missPenalty), not a scalar. **The load-bearing
  invariant across the pair: `cacheLabel` renders EXACTLY the fields `cacheEquals` distinguishes**, so
  `cacheEquals(a,b)===false ⟹ cacheLabel(a)!==cacheLabel(b)`. Why it must hold: two configs differing ONLY in cache
  share their forwarding/predict labels, so the cache label is the ONLY thing left to tell their titles apart — a
  label that collapsed distinct caches to one string could not name which config broke (M4's exact defect, one axis
  down). **Chose Option A (deep-equal all 3 + render all 3) over a "name only the sub-fields that vary" cache render**
  (advisor-confirmed) — the clever version REOPENS the gap: equality would call two configs distinct while the label
  called them the same, and you'd then need a guard that the sub-renderer is itself injective. The mild wart (scalars
  stay silent when constant, but the cache renders constant subfields like `/p10`) is the acceptable price of the
  coupling; resolving it is the trap.
- **Harness suite (`conformance.test.ts`):** added a **THREE-axis** case list (forwarding × predict × cache) so the
  distinctness guard's case list can REACH a cache-label collision — the case list must vary the cache, exactly as
  M4's had to vary prediction (_a guard whose case list can't reach the collision is not a guard_). **Did NOT mutate
  `MULTI_AXIS`** (its "varies TWO knobs" comment + `6 * corpusSize` length assertion stay accurate — the advisor
  flagged repurposing it would make both stale). Plus the **load-bearing silence-when-all-off assertion**: a matrix
  where every config leaves the cache off must not mention it — this is what keeps the single/multi-cycle differential
  suites and the M3/M4 two-knob guards **byte-identical** (they all pass `cache: null`). Inline
  `{lineSize,numLines,missPenalty}` objects there, NOT the pipeline constants (DAG again).
- **No `RESULT_ORACLES` / `checkProgram` change** (cache is architecturally invisible — every cache cell green by
  construction _is_ the net). Pipeline differential count jumped ~3× as expected; nothing asserts the old total.
  Typecheck + lint clean; all green first run.

**M6 STEP 4 DONE** (see MEMORY.md index for the full writeup) — closed form gained its miss term
`cycles = N+4+S+P+M`; the "no size dominates" thesis shipped as signed deltas (straddler +20, punishers 0); the
step-0 punisher needed NO new program (`array-sum.s`, single pass, is it). A bigger cache **weakly** dominates here
(never worse), not the strict two-way bet M4 had.

**M6 STEP 5 DONE** (2026-07-18, 1184 → **1221 tests**, +37) — the web cache toggle. A `CacheToggle` in the shell's
knobs row beside forwarding & prediction, gated on `configurableCache`, riding M3's config seam with **zero
widening** (mirrors the two prior toggles: `useSimulator` `cache` state+ref → `loadInto`; `session.lessonOpening`
honors a declared config's cache as a THIRD whole-or-nothing knob). **The one honest asymmetry: the control has
THREE positions `[off][small][large]`, not two** — off/small/large are three DISTINCT machines (off emits no
`cache-access`; small/large diverge only on a straddling working set), so all three move something and a two-part
on/off+size control would violate _a control that cannot move anything is worse than no control_ (the size half is
inert while off). Value written is always one of three stable constants (`null`/`CACHE_SMALL`/`CACHE_LARGE`), now
**exported from pipeline `index.ts`** so toggle + sweep + timing share ONE geometry ("no widening" is about the
config SEAM, not a ban on exporting constants; a different geometry would de-straddle `array-sum-twice`). **Findings:**
(1) **The advisor-flagged sweep risk did NOT materialize.** Adding a 3-position cache axis to `CONFIG_AXES` (pipeline
sweep 4→12) could have collided two of `forwarding-bubble`'s steps on a cycle (it runs on `array-sum`, which has
loads+misses) — but all 12 green first run, no validator special-case. Structural reason: a miss freeze only ADDS
cycles (collisions come from COMPRESSION, which forwarding-on already survives) AND emits **no `stall` event** (only
`stageId`'s load-use hazard does, `processor.ts:1108`), so the cache is invisible to the `stall reason:raw` trigger
the lesson anchors on. **The discriminating grep (does the freeze push a stall event?) is the check to run before
fearing a sweep collision.** (2) **First view step in the project's history to ship with NO browser-caught defect** —
the pattern from the two prior toggles was mechanical enough that the seam absorbed the third knob with nothing to
discover (the plan's "cheaper than M4" promise, realized). Still eyeballed for real (scrub max 289→339→319 as
off→small→large; control absent on single/multi-cycle; renders as a coherent bar, no wrap). **Zero engine / renderer /
trace-field / lesson-JSON change** (both pipeline lessons already declared `cache: null`). Live scrub-bar figures
pinned through the shell's load path in `simulator.test.ts` (`array-sum-twice` off 290 / small 340 / large 320
fwd-off; punisher `array-sum` small==large; INV-8 identical state; single-cycle inert); `models.test.ts` mirrors the
capability gate (exactly one model honors the cache).

**M6 STEP 6 DONE** (2026-07-18, 1221 → **1236 tests**, +15) — the cache grid VIEW. A `CacheGrid` STATE panel below
the pipeline datapath (above the memory panel it shadows): one row per line showing valid + the block it holds as a
BYTE RANGE (the human form of a huge tag, via re-exported `blockBaseOf`), the line touched this cycle called out
hit/miss/evict/**filling** — each a hue AND a word (relief rule). Two-halves shape like the MAP (not the SVG
datapath): pure fold `buildCacheGrid(trace, config)` (`cache-grid.ts`, 8 tests vs the real engine) + HTML view
(`CacheGridView.tsx`, 7 render tests). **Zero new trace field / engine / renderer change** (the last decision in the
m6 table lands NO). One export change: pipeline `index.ts` re-exports the READ surface (`CacheState`/`CacheLine` +
pure `lineIndex`/`lineTag`/`blockBase`/`blockBaseOf`); `access`/`newCache` stay private — comment rewritten to "read
the cache = public, run it = private". **Four decisions, three advisor-flagged BEFORE any highlight logic:**

- **STATE view, not dataflow — so it reads `micro`, and that is NOT the datapath's `micro` trap.** State panels
  (reg/mem/this) show the post-cycle-`i` result, so `micro.cache`'s post-install tags are exactly right (the datapath
  reads `instructions[].location` instead precisely because it draws transient mid-cycle dataflow). **Pinned against a
  real trace dump before designing:** on the fresh-miss cycle the `cache-access` event and post-install `micro.cache`
  share that cycle. This empirical-first discipline is why steps 5 AND 6 are the ONLY two view steps in project
  history with no browser-caught defect — the trap that bit every datapath step was designed around, not discovered.
- **The freeze is DRAWN (load-bearing).** A miss freezes IF/ID/EX for `missPenalty` cycles; only the fresh-arrival
  cycle emits `cache-access`, the ~10 penalty cycles emit none. Keyed only on the event, the panel would go dark
  mid-stall while the map shows `MEM MEM MEM`. So when `micro.exMem.missCyclesRemaining > 0` with no event, the served
  line is derived from the stalled load's `micro.exMem.aluOut` and shown `filling` + countdown — no new field.
- **HTML following the MAP, not the SVG datapath.** The plan cited "M3 step-6 geometry litmuses" — those are SVG
  polygon/wire tests a table has none of; corrected to the map's fold + render-smoke-test shape (deviation owned).
- **Size flip visible on the structure:** small (2 lines) evicts block 0 on line 0; large (4 lines) gives block 2 its
  own line, eviction gone. Pinned at the view layer + browser-eyeballed both sizes + both themes, no defect. Gated on
  a TRACE fact (`recorded.some(t => micro?.cache != null)`), mirroring the map's `hasOverlap` — panel absent cache-off.

**M6 STEP 7 DONE — M6 IS COMPLETE** (2026-07-18, 1236 → **1337 tests**, +101) — the cache TRACK. Three lessons in a
NEW `The cache` track (after `The machine`), in the order fixed in the plan and reviewed AS a sequence (M5's finding
applied up front), pinned by name in `lessons.test.ts` (`cache-spatial < cache-temporal < cache-conflict`, forced by
the prose: temporal presupposes the line-fill, conflict presupposes the reuse):

- **`cache-spatial`** ("A line, not a word", `array-sum`, LARGE, forwarding on): first touch misses and drags in a
  16-byte line; the next three loads HIT; arr[4] misses at the block boundary; payoff a0=120, "five loads, two misses".
- **`cache-temporal`** ("Come back and it is still there", `array-sum-twice`, LARGE): pass one compulsory-misses three
  lines; pass two revisits arr[0] and HITS (all 12 hit); payoff a0=156. Revisit-hit step is SIZE-EXCLUSIVE (dead small).
- **`cache-conflict`** ("Too small to hold it all", `array-sum-twice`, SMALL): block 2 evicts block 0 in pass one; pass
  two re-misses arr[0]; flip to large ⇒ eviction gone; payoff a0=156, "5 misses small / 3 large", symmetric flip prose.
  Eviction + re-miss steps SIZE-EXCLUSIVE (dead large).
  **Anchors on `cache-access` events (hit/miss/evicted/addr), never cycle numbers (INV-6). That event carries NO `instr`
  field, so oracles pin `addr`/`hit`/`evicted` directly (no pc to pin like the hazard oracles do — the addr IS the
  identity).** Size-exclusive steps ride the sweep's "fires in ≥1 position" licence (branch-bet's shape); all 12 pipeline
  positions green FIRST RUN, no validator special case (the size axis TRIPLES the sweep as prediction doubled forwarding).
- **THE IDENTITY TRAP, reconciled by CANONICALIZING at LOAD (not switching to deep compare):** `canonicalCache`
  (`lessons.ts`) maps a lesson's JSON-declared geometry back to its shipped `CACHE_SMALL`/`CACHE_LARGE` constant when
  `LESSONS` is built, via a new PURE `cacheEquals` (`session.ts`, no engine import — mirrors conformance's). So the
  shell STILL only ever holds one of three constants ⇒ `setCache`'s `===` guard and `CacheToggle`'s `===` lit-detection
  are UNCHANGED (their step-5 caveats rewritten to "reconciled at load"); the deep-compare-everywhere option was
  DECLINED to keep the "always one of three constants" contract TRUE rather than paid-for per comparison. A shipped test
  pins every declared cache is `===` a constant (a future typo'd geometry, lighting no toggle position, reddens).
- **THREE findings tests could NOT catch, all surfaced by discipline/review:** (1) **A STORE emits a `cache-access`
  too** — `array-sum`'s `sw a0, 0(total)` is a 6th access (a hit), ABSENT from `cache.test.ts`'s loads-only verdict list
  — so spatial counts LOADS (5 loads, 2 misses), not accesses (6). Caught by DUMPING the real `cache-access` stream per
  (program × config) before pinning any `nth` — the pin-against-a-real-trace ritual. (2) **A re-miss on a FULL cache is
  badged `EVICT`, not `MISS`** (the re-fetch also evicts — the two blocks thrash); the BROWSER caught the mismatch and
  conflict's step-3 prose now owns the eviction + deepens into thrashing. (3) **A step alive in ALL positions must be
  CONFIG-AGNOSTIC when the lesson invites the flip** (advisor-caught, the recurring "alive in N positions ⇒ true from
  all N" class): conflict's INTRO baked in "holds only two lines", FALSE under the large cache its own payoff invites
  ("flip between small and large") — so large is ON-PATH, not off-path degradation. The tell: the other four intros are
  config-agnostic; only this one wasn't. Fix = frame the experiment ("the cache size is the variable"), let the
  size-EXCLUSIVE eviction/re-miss steps carry the small-only facts. Contrast `cache-temporal`'s "big enough" (also
  all-positions) which is SAFE — it never invites a flip to small, so small is off-path degradation (tolerated, like
  forwarding-bubble's intro on single-cycle). The distinction: does the lesson's own prose steer the reader to the
  other position? If yes, both are on-path.
- **Browser-verified all three lessons (the `claude-in-chrome` driver on a fresh `npm run dev` I owned + killed by
  PID):** the reconcile lights the RIGHT toggle for small AND large (the step-7 trap, closed); the grid's
  MISS/HIT/EVICT/FILLING match the prose; the size-exclusive rail re-forms (conflict drops 4→2 steps on the flip to
  large); the intro reads true under large after the fix; payoffs read a0=120/156 in the register panel. **Third
  lesson-authoring step: the browser + advisor caught narration issues (an EVICT-vs-miss clarity mismatch, an intro
  false-on-the-invited-position), not a shipped correctness bug.** M2 step 5c stays deferred, independent.
- **CAUTION (self-inflicted, recovered):** editing this repo's UTF-8 docs with PowerShell `Get-Content`/`Set-Content`
  round-trips CORRUPTED all multibyte chars (→ — × became mojibake, 179 instances). Use the **Edit tool** for `.md`
  files, never PS Set-Content. Reverted with `git checkout` and redid via Edit.
