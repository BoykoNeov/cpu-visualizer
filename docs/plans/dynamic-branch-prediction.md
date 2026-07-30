# Dynamic branch prediction — the predictor gets a memory

**Status: STEP 0 DONE, 2026-07-30 — no code written yet.** The corpus is measured (see the step-0
results section); steps 1–8 are untouched. Every claim below about the current code is
a grep or a quoted docblock, cited inline; every claim about what a dynamic predictor will _do_ is
a prediction, and the ones worth being wrong about are called out as step-0 measurements rather
than assumed. **Not a milestone** — spec §12's roadmap finished at M10, and M11–M14 discharged the
don't-foreclose flag. This is a feature, in the same class as `keyboard-transport.md` and
`continuous-play.md`.

Source of truth for scope: `cpu-visualizer-spec.md` §12.3 (caches & branch prediction as _feature
toggles_) and §16, which left "branch-prediction scheme menu … defer to the cache/prediction tier"
as an **open question**. M4 answered it conservatively and the answer was never revisited. The
load-bearing constraints are the architectural invariants (§3) and the trace schema (§5).

## Why this, and why now

M4 shipped `branchPrediction: 'none' | 'static-taken' | 'static-not-taken'` — and its own plan
records that this is **three names, two behaviors**: `'none'` and `'static-not-taken'` are one
machine, because the fall-through _is_ the not-taken path. So the shipped menu contains exactly
**two** predictors, both of which are constants. `packages/engine/pipeline/src/processor.ts:468`
is the whole of it:

```ts
this.predictTaken = config.branchPrediction === 'static-taken';
```

A field set once at `reset()` and never written again. **The machine has no memory of how the
branch behaved last time**, which is the one idea every course spends a lecture on and this
simulator cannot currently show.

`packages/engine/common/src/predict.ts:43` already names the successor as future work in its own
words — a BTB "predicting from the pc alone" is "**a deferred tier**." This plan is that tier's
first half.

**Why it beats the alternatives** (the survey is in the session that produced this file):

- **Cache realism** (associativity, replacement, write-back — all deferred per
  `packages/engine/common/src/cache.ts:36-38`, "none is a field here") is of equal pedagogical
  value and ranks second **on scope only**: it is a `CacheConfig` _shape_ change, so every config
  literal, the conformance corpus and the differential matrix move with it. This is a new variant
  of an existing union plus state. A knob, not a schema edit.
- **A 12-stage pipeline** is cheap — M11's predictions all held, the pipeline map needed no change,
  `location` absorbs a longer stage set as a plain string — but it repeats M11's qualitative lesson
  quantitatively. Not a peer candidate.
- **Store-to-load forwarding / memory disambiguation** is the genuine remaining depth in the OoO
  model, and belongs after this.
- **VLIW is foreclosed by INV-7** (one ISA, one assembler — bundles need an ISA change) and
  **multi-core is an explicit §10 non-goal.** Both closed, not deferred.

**What is genuinely new machinery**, named precisely: a per-branch table of state that **mutates as
the program runs**, is read before the answer exists, and is written when the answer arrives. Every
other knob in `ProcessorConfig` is inert data handed to `reset()`. This is the first one that is a
_component with state_, and that is exactly why it is worth building — it is the app's strongest
visual idiom (a table changing under the reader's eye, like the cache grid) applied to the one
mechanism that currently has no visual at all.

## Headline decision — where the predictor's state lives, and who owns it

Three layered options. INV-8 checks only **final architectural state**, and a predictor cannot
change a program's result (it changes _when_ things happen, never _what_), so all three are equally
"correct" — the choice is pedagogy plus how much of the repo moves.

- **MVP — a 2-bit saturating BHT, indexed by pc, in `engine/common`.** One shared, tested,
  stateful class. Schemes: two new variants on the union (**named in the decisions table** — the
  seed is `'dynamic-1bit'` / `'dynamic-2bit'`; do not hardcode `'bht-*'` anywhere before that row is
  pinned). The 1-bit variant is not filler: **the 1-bit-vs-2-bit delta on a doubly-entered loop is
  the entire lesson**, and without both positions the reader has nothing to A/B.
- **Deferred fidelity 1 — a BTB**, so `jalr` becomes predictable. Today `jalr` is unpredictable
  _by construction_ (`predict.ts` excludes it from `PC_RELATIVE_TRANSFERS` because its target is
  `rs1 + imm` and does not exist until EX). This is a real second tier, not a polish pass: it
  changes which instructions can bet at all, and `call-return.s`'s `ret` is the corpus's standing
  witness.
- **Deferred fidelity 2 — global history / gshare**, correlating predictors. Highest ceiling,
  lowest marginal clarity per unit of work. Not in scope.

**Recommendation: build the MVP, both variants, and stop.** The scope lever a reviewer signs off on
is _the table is indexed by pc alone and holds nothing but a counter_ — no tags, no targets, no
history register.

**Where the state rides is already decided by precedent, and it is not a new top-level trace
field.** INV-3 says the view reads the trace, never engine internals; the cache solved exactly this
by riding `MachineState.micro`, and `cache-grid.ts`'s header states the rule for why a _state_ view
may read `micro` where a _dataflow_ view may not:

> This is a STATE view, not a dataflow view — which is why it reads `micro` … The cache grid shows
> the cache's STATE at the cursor — exactly like the register and memory panels — and state panels
> show the post-cycle-`i` result.

A BHT is the same kind of object. **So: `micro.predictor`, following `micro.cache`.**

⚠ **And it inherits the cache's one hazard verbatim.** `pipeline/src/processor.ts:1311` —

> The latch objects are immutable and rebuilt each cycle, so copying the container is enough … **The
> cache is the ONE exception: it is single-buffered and mutated in place … so it must be
> DEEP-COPIED here or every recorded snapshot would alias the final (fully warmed) state.**

The predictor is single-buffered and mutated in place for the same reason the cache is. **A shallow
copy makes every recorded cycle show the fully-trained table**, and time-travel silently shows the
end state at cycle 0. This is a named step below, with a break harness, because it is the defect
this design is most likely to ship.

## The multiplier nobody should discover mid-build (it bites at steps 5 AND 6)

`configurableBranchPrediction: true` on **four** models — `pipeline:220`, `deep-pipeline:313`,
`superscalar:255`, `out-of-order:98`. Each sets its own `predictTaken` boolean at reset and consults
it at its own bet site. A new scheme is therefore **four wiring sites**, not one, and the shared
`engine/common/predict.ts` today exports only two _pure_ functions (`speculativeTarget`,
`isPredictable`) — no state, nothing to inherit.

The design answer is to make the shared thing carry the state so the four sites shrink to _ask and
tell_: `predictor.predict(pc)` before, `predictor.update(pc, actual)` at resolution. If a model's
diff is larger than that, the abstraction is in the wrong place — surface it rather than copying
logic four times.

## Build order (each step testable before the next)

- [x] **0. Measure the corpus BEFORE designing anything.** — **DONE 2026-07-30; results below.** Two facts this plan rests on and does
      not know: **(a)** which corpus program distinguishes 1-bit from 2-bit. The distinction only
      appears on a loop **entered twice** — a 1-bit predictor mispredicts on exit _and_ again on
      re-entry, a 2-bit absorbs the second. `sum-loop.s` runs its loop once, so it very likely
      shows **no difference at all**; `array-sum-twice.s` ("the repeat pass re-reads the same
      addresses", `conformance.ts:119`) is the candidate. **(b)** the signed per-program delta of
      each scheme against `static-taken`, the way M4 pinned `sum-loop −7, array-sum −2, call-return
+1`. Acceptance: a committed table of (program × scheme) cycle counts, **with at least one
      program where 1-bit and 2-bit differ**. If no such program exists, the corpus needs a new
      one and that becomes step 0b — a doubly-entered loop, authored before any engine work.

- [ ] **1. Schema first: `branchPrediction` gains the variants, and `PredictorState` is defined.**
      Extend the union in `packages/trace/src/processor.ts:68`; add `PredictorState` to the trace
      types, and add the `predictor` field to all four models' `micro` types — **spelled
      `predictor` verbatim in every one** (see step 6 for why this is not a style preference).
      **State the inertness contract in the docblock the way `issueWidth` does** — earlier models
      ignore the field and their traces stay byte-identical — and gate every UI on
      `capabilities.configurableBranchPrediction`, **never on the field's value**.
      ⚠ **This step is FIRST because step 2's class returns `PredictorState`** — the original
      ordering put the consumer before its type and could not have compiled. Acceptance: `tsc -b`
      green; a test pinning that single-cycle and multi-cycle traces are byte-identical across all
      five schemes.

- [ ] **2. `engine/common/src/predictor.ts` — the pure, stateful predictor.** A class over
      `{ index(pc), predict(pc): boolean, update(pc, actual): void, snapshot(): PredictorState }`,
      with the 1-bit and 2-bit variants as the counter width. No model imports, no trace imports
      beyond types — the same layering `predict.ts` already respects. Sweep the classic sequences
      by hand: `TTTTNTTTT` costs a 2-bit **two** mispredicts (`NTTTTTTTT`) and a 1-bit **three**
      (`NTTTTNTTT`). ⚠ **This plan first wrote one and two — the textbook's WARM-START numbers.**
      Both counters reset not-taken, so the leading `T` is a cold mispredict every scheme pays and
      the delta is carried entirely by the `N`: the 1-bit flips and re-mispredicts the next `T`, the
      2-bit only weakens. Measured, not assumed (step 0's harness). Acceptance: unit tests on the
      state machine alone, green before any processor sees it.

- [ ] **3. Wire the pipeline (one model only).** Replace the `predictTaken` constant with the
      predictor object at the ID bet site and the EX resolution site. ⚠ **`branch-predicted` fires
      only when the bet is TAKEN** — the schema says so explicitly ("There is no not-taken bet …
      emitting `{ taken: false }` would assert an action the machine did not take"). A dynamic
      predictor predicts not-taken roughly half the time early in a run, so it must stay silent
      there, exactly as `'none'` does. `branch-resolved.predicted` still reports both ways.

      ⚠ **INV-8 CANNOT SEE THE REGRESSION THIS STEP RISKS.** It compares final architectural state
      only — `cycles-cannot-see-a-lost-forward` records a cycles-only identity holding in every cell
      while two `forward` events vanished, and `m7-superscalar-engine` records INV-8 as a **FALSE
      net** outright. This step rewrites the bet site that `'static-taken'` already uses, so a
      refactor that shifts an *existing* scheme's timing leaves INV-8 green and only M4's timing
      pins stand between that and shipping. Acceptance is therefore three lines, not one:
      **(a)** INV-8 green across the new scheme × forwarding matrix; **(b)** the step-0 table's
      predicted cycle counts reproduced; **(c)** **the existing three schemes' per-program cycle
      counts unchanged corpus-wide** — and before relying on (c), confirm M4's timing pins actually
      cover all four models rather than the pipeline alone. If they cover only the pipeline, widening
      them is part of this step, not step 5.

- [ ] **4. The deep-copy step, with its own break harness.** Add `predictor` to `snapshotState()`
      deep-copied, per the `micro.cache` precedent above. **Then break it on purpose**: make the
      copy shallow and record what stays green. The prediction is that _most of the suite passes_ —
      final state is unchanged, cycle counts are unchanged, and only a test that reads the table at
      an early cursor can see it. Acceptance: a committed break-table row, and at least one test
      that **fails** under the shallow copy.

- [ ] **5. The other three models.** `deep-pipeline`, `superscalar`, `out-of-order`. Each should be
      an ask-and-tell diff (see the multiplier section). Acceptance: INV-8 green per model across
      the full scheme matrix; the superscalar's per-lane bets and the OoO's speculation depth
      unchanged in shape.

- [ ] **6. The view — a predictor panel, following `CacheGridView`.** A pure fold
      (`predictor-table.ts`) plus an HTML view plus a render smoke test, exactly the two-halves
      shape `cache-grid.ts` documents. Rows = table entries, each showing its counter position and
      the branch that owns it, with the entry touched this cycle highlighted.

      ⚠ **The four-model multiplier applies HERE TOO, and the precedent file records this exact
      defect against itself.** `cache-grid.ts`'s own header:

      > And it is read through `memOccupant`, because the latch's NAME is per-model. The deep
      > pipeline calls it `ex2Mem`; a hard-coded `micro.exMem` silently returns undefined there, so
      > from M11 step 6 … until the M11+M12 review, this panel went idle for the whole freeze on the
      > deep pipeline — reintroducing, on a shipped and user-reachable config, exactly the blanking
      > the paragraph above exists to prevent.

      That defect survived a milestone **and shipped to users** before a review caught it. A panel
      reading `micro.predictor` across four models has the identical shape. Two defenses, and the
      first is why step 1 mandates the spelling: unlike the latch case this is a **new** field, so
      the names can be made to agree **by construction** rather than reconciled by an accessor.
      Acceptance: the fold is derived purely from the trace (INV-3) and is **exercised against a
      recorded trace from each of the four models** — not one — with a render smoke test green on
      each. A fold tested on one trace proves nothing about the other three.

- [ ] **7. Browser pass — and it is the only net for steps 6's wiring.** Per
      `browser-is-the-only-net`: 9 of 10 view steps here shipped a defect only the browser caught.
      Drive all five schemes on the step-0 program, watch the table train, and **measure the new
      panel at a stated narrow viewport in the app's most crowded state** (the wrap defect that
      keyboard control shipped was invisible at 1400px on the default model). Acceptance: a
      numbered check list with counts, in the style of `continuous-play.md`.

- [ ] **8. A lesson.** The M4 flagship is `branch-bet` on `call-return`; this one's subject is a
      **delta against a machine already met** — the M12 shape. Read `m12-deep-pipeline-lessons.md`
      before authoring. Anchor on trace events, never cycle numbers (INV-6), and **anchor on the
      event whose existence conditions match the prose** (the M14 rule). Acceptance: the lesson
      plays through; annotations fire on the correct events.

## Step 0 — MEASURED (2026-07-30)

Harness: `M:\claud_projects\temp\bp-step0\` (a scratch vitest suite; the table below is the
deliverable, the harness is not committed). **Pipeline model only, cache off** — deep-pipeline's
shadow is longer, superscalar bets per lane, out-of-order has speculation depth, so nothing here is
a four-model claim. Step 5 measures those.

**How four schemes were priced without building any of them.** A program's per-branch outcome
sequence is **scheme-invariant** — prediction changes _when_ things happen, never _what_ — so one
run yields the raw material for every scheme. `pipeline/src/timing.test.ts:205` already pins the
price of a resolved transfer (**2 if mispredicted, 1 if correctly predicted taken, 0 if correctly
predicted not-taken**), and that rule is per-INSTANCE, so it prices a dynamic scheme as readily as a
static one. Four things were checked rather than assumed, each its own test:

1. The outcome **sequence** (not the count) is byte-identical across `none` / `static-not-taken` /
   `static-taken`, both forwarding positions. `cycles-cannot-see-a-lost-forward` is the record of a
   count agreeing while the sequence did not.
2. The offline predictor reproduces the engine **per instance** — the ordered `predicted` sequence,
   event for event — on the two schemes that have ground truth in `branch-resolved.predicted`. So
   the same code is trusted where no oracle exists. **Broken on purpose** (`static-taken` made to
   predict not-taken) and this test is the one that fails; the closed-form test does not, because it
   reads the trace's own `predicted`.
3. `cycles = N + 4 + S + P` reproduces both measured schemes **exactly**, all 11 programs × both
   forwarding positions.
4. **The S-invariance the derived columns rest on.** Two supporting measurements: the stall
   histogram is identical **per site** across the two static schemes, and **no squashed instruction
   ever emits a stall**. A dynamic scheme's shadow at each branch instance is pointwise one of the
   two depths (1 or 2) those static runs already produce at that same site, so a non-uniform shadow
   cannot move S. That is an **argument, not a pin** — step 3's acceptance (b) is where it becomes
   one.

### (b) The table — cycles per (program × scheme), forwarding off

Derived columns use the seed policy: **16 entries, index `(pc>>>2)&15`, 2-bit reset weakly-not-taken,
`jal` always predicted taken without consulting the table.** `static-*` are MEASURED; `dynamic-*` are
DERIVED.

| program           |   N |   S | not-taken | static-taken |   1-bit |   2-bit | mispredicts nt/st/1/2 |
| ----------------- | --: | --: | --------: | -----------: | ------: | ------: | --------------------- |
| add.s             |   3 |   2 |         9 |            9 |       9 |       9 | 0/0/0/0               |
| array-sum-twice.s | 134 | 106 |       290 |          273 |     276 |     275 | 23/3/6/5              |
| array-sum.s       |  34 |  26 |        72 |           70 |      71 |      71 | 4/1/2/2               |
| branch-flavors.s  |   9 |   1 |        16 |           17 |      16 |      16 | 1/1/1/1               |
| byte-loads.s      |   6 |   4 |        14 |           14 |      14 |      14 | 0/0/0/0               |
| call-return.s     |   9 |   0 |        17 |           18 |      16 |      16 | 2/2/1/1               |
| paired-branches.s |   5 |   0 |         9 |           13 |       9 |       9 | 0/2/0/0               |
| slow-op-loop.s    |  30 |  26 |        70 |           67 |      68 |      68 | 5/1/2/2               |
| store-forward.s   |   7 |   4 |        15 |           15 |      15 |      15 | 0/0/0/0               |
| strided-sum.s     |  34 |  26 |        72 |           70 |      71 |      71 | 4/1/2/2               |
| sum-loop.s        |  34 |  22 |        78 |           71 |      72 |      72 | 9/1/2/2               |
| **corpus total**  |     |     |   **662** |      **637** | **637** | **636** |                       |

Forwarding on moves only `S` (and so every cycle count) by a constant per program; the per-scheme
_deltas_ are identical, which is the S-invariance above restated. Corpus totals on: 479 / 454 / 454
/ 453.

Signed delta against `static-taken` (**+ = the scheme is faster**), the M4-style pin M4 wrote as
`sum-loop −7, array-sum −2, call-return +1`:

| program           | not-taken | 1-bit | 2-bit |
| ----------------- | --------: | ----: | ----: |
| array-sum-twice.s |       −17 |    −3 |    −2 |
| sum-loop.s        |        −7 |    −1 |    −1 |
| slow-op-loop.s    |        −3 |    −1 |    −1 |
| array-sum.s       |        −2 |    −1 |    −1 |
| strided-sum.s     |        −2 |    −1 |    −1 |
| branch-flavors.s  |        +1 |    +1 |    +1 |
| call-return.s     |        +1 |    +2 |    +2 |
| paired-branches.s |        +4 |    +4 |    +4 |

### (a) Which program distinguishes 1-bit from 2-bit — and the answer is thin

**Exactly one: `array-sum-twice.s`, by exactly 1 cycle** (276 vs 275). The plan's hypothesis was
right in both halves: `sum-loop.s` shows **no** difference (its loop is entered once), and
`array-sum-twice` is the candidate — its inner `bne` at pc 36 runs `TTTTTTTTTTTN TTTTTTTTTTTN`, and
the second pass's re-entry is exactly the mispredict a 2-bit absorbs and a 1-bit pays.

**The delta is `m − 1` cycles for `m` outer passes**, confirmed against synthetic sequences:
2 passes → 1, 4 → 3, 6 → 5, 8 → 7. The inner loop's LENGTH does not matter; only the number of
re-entries does. The outer branch contributes nothing (a `TN` sequence costs both widths 2).

### The finding the plan did not predict, and it is the load-bearing one

**Over the whole corpus, `dynamic-2bit` beats `static-taken` by ONE cycle: 636 vs 637.** `1-bit` ties
it exactly. Dynamic prediction, on this corpus, is worth approximately nothing — and the reason is
structural, not a fluke of sizing: every loop here is entered **once**, so a warm `static-taken`
predictor is already right on every iteration, and the dynamic schemes pay a cold-start mispredict
they never earn back. They win only where a branch is habitually **not** taken (`paired-branches`
+4, `call-return` +2, `branch-flavors` +1) — which is `static-not-taken`'s territory, not a dynamic
predictor's thesis.

So the corpus cannot show what this feature is for, and the flagship acceptance ("watch the
re-entry mispredict disappear") is currently one absorbed mispredict on pass 2 of 2, worth 1 cycle
in 276. **Step 0b is warranted on LEGIBILITY, not on existence** — the plan's own trigger ("if no
such program exists") does not fire, so this is a scope call, seeded below.

### Design forks priced — three of them move a number, three do not

| fork                                          | verdict                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Does `jal` consult the counter?**           | **Worth exactly 1 cycle, on M4's own witness.** `call-return.s` is 16 under the seed (jal bypasses the table, always taken) and **17** if `jal` reads a cold weakly-not-taken counter. This is the fork the advisor predicted would land on the +1 pin, and it does.                                                                            |
| Does `jal` _update_ the counter?              | **Zero** on this corpus — no `jal` shares an index with a conditional branch at 16, 8 or 4 entries.                                                                                                                                                                                                                                             |
| Does `jalr` update?                           | **Zero**, same reason.                                                                                                                                                                                                                                                                                                                          |
| **Table size (16 / 8 / 4 entries)**           | **Zero — identical cycle counts at all three.** No two branches in this corpus alias, even at 4 entries. "Aliasing is a feature" is **unreachable here**, so the size decision is unconstrained by timing and should be made for _drawability_ alone.                                                                                           |
| **2-bit reset: weakly (01) vs strongly (00)** | **Moves five programs, and in BOTH directions.** `00` makes 2-bit _worse_ than 1-bit on the four single-entry loops (`array-sum` 72 vs 71, likewise `strided-sum`, `sum-loop`, `slow-op-loop`) and _better_ on `array-sum-twice` (274 vs 275, because the outer `TN` prefers a sticky not-taken start). `01` is the right seed and this is why. |
| 1-bit reset                                   | Not a fork — a 1-bit counter has no "weakly" position.                                                                                                                                                                                                                                                                                          |

### What step 0b would actually cost — the plan under-priced it

A new `.s` joins every model's INV-8 matrix for free (`conformance.ts` enumerates from disk), but
**three hand-derived timing tables assert corpus-completeness and go red the moment the file lands**:
`pipeline/src/timing.test.ts:629`, `deep-pipeline/src/timing.test.ts:586`,
`superscalar/src/timing.test.ts:1207` — each `expect([...corpus].sort()).toEqual(Object.keys(TIMING).sort())`.
Each needs a hand-derived row: retires, the transfer breakdown, stall sites per forwarding position,
and cache misses at both geometries (pinned as a verdict _sequence_ in the model's `cache.test.ts`,
not a bare total). The superscalar's row is the heavy one — it carries a `w2` block and a per-width
schedule for widths 1–4. Out-of-order does **not** assert completeness (its `PINNED` covers 10 of 11
today, `store-forward.s` absent), so it costs nothing.

**Recommendation: author it, sized 4 passes × 6 iterations** — a 3-cycle 1-bit-vs-2-bit delta and
three visible re-entry mispredicts under 1-bit against zero under 2-bit, which is the thing the
reader is supposed to watch disappear. Six passes would give 5, at no extra table cost. But it is a
real scope addition (three hand-derived rows), so it is flagged here rather than decided.

## Acceptance criteria

- [ ] Load the step-0 program, pick **1-bit**, step through, and watch the counter table train —
      then pick **2-bit** on the same program and watch the re-entry mispredict disappear. Same
      program, one knob, visibly different behavior (the §12 flagship interaction).
- [ ] The final register + memory state is **identical under all five schemes** on every corpus
      program (INV-8 across the full matrix).
- [ ] Single-cycle and multi-cycle traces are **byte-identical** across all five schemes (the
      inertness contract).
- [ ] Scrubbing to cycle 0 shows an **untrained** table — the deep-copy holds.
- [ ] All suites green; `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`.

## Decisions to pin (seeded with recommendations, so review is a diff)

| Decision                                             | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                                                                                                                      | Pinned answer |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Predictor state's home                               | `MachineState.micro.predictor`, following `micro.cache` (INV-3; a STATE view may read `micro`)                                                                                                                                                                                                                                                                                                                                                             | _(open)_      |
| Scheme names                                         | **`'dynamic-1bit'` / `'dynamic-2bit'`**, not `'bht-*'` — the first names the pedagogy and reads as the obvious sibling of `'static-taken'`; the second names the implementation. Decide DELIBERATELY: these strings surface in the model picker, and if the URL-permalink work lands they become URL-visible and effectively frozen                                                                                                                        | _(open)_      |
| **Does a SQUASHED branch update the predictor?**     | In the OoO model a branch can resolve and then be killed by an older mispredict, so update-on-resolve vs update-on-commit is a real behavioral fork — **invisible to INV-8**, and sitting exactly where step 5's copy-paste pressure peaks, so four models could quietly answer it four ways. Seed: **update-on-resolve** (simpler; the machine learns from what it saw), with commit-time as the realistic alternative. **Pin BEFORE step 5, not during** | _(open)_      |
| Table size                                           | Fixed small (8 or 16 entries) — big enough to teach, small enough to draw. **Step 0 measured this as timing-NEUTRAL: 16, 8 and 4 entries give identical cycle counts corpus-wide, because no two branches alias even at 4.** So "aliasing is a feature" is a claim nothing in the corpus can exhibit, and the choice is drawability alone                                                                                                                  | _(open)_      |
| **Does `jal` consult the counter?**                  | **No — an unconditional jump is simply predicted taken, bypassing the table.** Step 0 priced this fork at **exactly 1 cycle on `call-return.s`** (16 vs 17), i.e. squarely on M4's `+1` witness. Consulting costs a cold mispredict on a branch whose answer is known at decode, which is noise the reader must then be told to ignore                                                                                                                     | _(open)_      |
| Does `jal` / `jalr` **update** the counter?          | Seed **no** for both. Measured **zero** effect on this corpus (no `jal`/`jalr` shares an index with a conditional branch at 16, 8 or 4 entries) — so this is a pedagogy call, not a timing one: a table whose rows are all conditional branches reads cleaner                                                                                                                                                                                              | _(open)_      |
| Index function                                       | pc bits alone, no tag — a mispredict from aliasing is a true fact about this machine (INV-5)                                                                                                                                                                                                                                                                                                                                                               | _(open)_      |
| Initial counter state                                | Weakly-not-taken, so a loop's first pass visibly _learns_ rather than starting right. **Step 0 measured the alternative and it is not neutral: strongly-not-taken (`00`) makes the 2-bit predictor SLOWER than the 1-bit on all four single-entry loops** (`array-sum` 72 vs 71, and likewise `strided-sum`, `sum-loop`, `slow-op-loop`) — a demo that would show the "better" predictor losing                                                            | _(open)_      |
| Does `branch-predicted` fire on a not-taken bet?     | **No** — the schema forbids it; a dynamic not-taken prediction is silent, like `'none'`                                                                                                                                                                                                                                                                                                                                                                    | _(open)_      |
| Does the OoO model share one predictor across lanes? | Yes, one table per machine — a per-lane table is a different (and unrealistic) machine                                                                                                                                                                                                                                                                                                                                                                     | _(open)_      |
| BTB / `jalr` predictability                          | **Out of scope**; `jalr` keeps paying full EX resolution under every scheme                                                                                                                                                                                                                                                                                                                                                                                | _(open)_      |
| Global history / gshare                              | **Out of scope**                                                                                                                                                                                                                                                                                                                                                                                                                                           | _(open)_      |
| Does the corpus need a new program?                  | **Measured: not to satisfy step 0's literal trigger — `array-sum-twice.s` does distinguish the two widths — but the delta is 1 cycle in 276, and dynamic prediction beats `static-taken` by 1 cycle across the ENTIRE corpus. Recommend authoring one (4 passes × 6 iterations ⇒ a 3-cycle delta), priced at three hand-derived timing rows.** See the step-0 results section                                                                              | _(open)_      |

## Risks, stated before they bite

1. **INV-1 (determinism) and INV-8 should both be untouched** — the table is a pure function of the
   program's own branch history, and INV-8 compares final architectural state, which no predictor
   can change. **Verify this in step 3 rather than asserting it**; if either moves, the design is
   wrong, not the invariant.
2. **The shallow-copy defect** (step 4) is the likeliest thing to ship silently. It is the reason
   step 4 exists as its own step with a break harness rather than a line inside step 3.
3. **The four-model multiplier bites TWICE — at step 5 and again at step 6.** Step 5 is where
   copy-paste pressure peaks: `m13-width-planned.md` records that five of eight knobs share a type
   with a sibling, so a transposition is green on both the suite and `tsc`. Step 6 is the subtler
   one, and the mistake this plan made in its own first draft: **the multiplier was carried into the
   engine steps and dropped at the view.** `cache-grid.ts` documents that exact defect against
   itself, shipped and user-reachable for a whole milestone. A fold tested against one model's trace
   proves nothing about the other three.
4. **A test keyed off a pure fold rather than the render** is this repo's signature defect — it
   recurred 8 times in M13 and twice inside the fix written to stop it. Step 6's smoke test must
   assert against the rendered output, not re-run the fold.
5. ⚠ **Commit before running any break harness.** `m13-width-planned.md` records a
   `git checkout --` harness that destroyed an uncommitted tree.
