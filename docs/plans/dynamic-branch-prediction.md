# Dynamic branch prediction — the predictor gets a memory

**Status: STEPS 0, 0b, 1, 2 AND 3 DONE — step 3 on 2026-08-09. The PIPELINE now has a real
predictor.** The corpus is
measured (see the step-0 results section), `content/programs/nested-loop.s` is authored, hand-derived
into three timing tables and three shape tables, and committed; the schema carries five scheme names,
`PredictorState`, and a `predictor` field on all four honoring models' `micro`; `BranchPredictor` —
the state machine itself — is written and unit-tested; and the five-stage pipeline **bets from it and
trains it**, with the shell's control grown to four positions. Step 3 reproduced every derived cycle
count in the step-0 and step-0b tables exactly. **Still inert on the other three betting models**
(step 5), and `micro.predictor` is still recorded as `null` everywhere (step 4, deliberately — its
break harness needs something to break). Steps 4–8 remain. Every claim
below about the current code is a grep or a quoted docblock, cited inline; every claim about what a
dynamic predictor will _do_ is a prediction, and the ones worth being wrong about are called out as
step-0 measurements rather than assumed. **Not a milestone** — spec §12's roadmap finished at M10, and M11–M14 discharged the
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

- [x] **1. Schema first: `branchPrediction` gains the variants, and `PredictorState` is defined.** —
      **DONE 2026-07-31; results in the step-1 section below.**
      Extend the union in `packages/trace/src/processor.ts:68`; define `PredictorState`, and add the
      `predictor` field to all four models' `micro` types — **spelled `predictor` verbatim in every
      one** (see step 6 for why this is not a style preference).
      **State the inertness contract in the docblock the way `issueWidth` does** — earlier models
      ignore the field and their traces stay byte-identical — and gate every UI on
      `capabilities.configurableBranchPrediction`, **never on the field's value**.
      ⚠ **This step is FIRST because step 2's class returns `PredictorState`** — the original
      ordering put the consumer before its type and could not have compiled. Acceptance: `tsc -b`
      green; a test pinning that single-cycle and multi-cycle traces are byte-identical across all
      five schemes.

      ⚠ **This step's own text said "add `PredictorState` to the trace types" and that was WRONG
      against the repo's own precedent — corrected below, and the rule is worth stating once.** A
      type handed to `reset()` is CONFIG and belongs in `trace` (`CacheConfig` does). A type carried
      in `MachineState.micro` is a model's own SHAPE and belongs beside the code that produces it
      (`CacheState` does, in `engine/common/src/cache.ts`) — `trace/src/schema.ts` types `micro` as
      `unknown` precisely so `trace` never learns these shapes. `PredictorState` is the second case.
      It went to `packages/engine/common/src/predictor.ts`.

- [x] **2. `engine/common/src/predictor.ts` — the pure, stateful predictor.** — **DONE 2026-08-09;
      results in the step-2 section below.** A class over
      `{ index(pc), predict(pc): boolean, update(pc, actual): void, snapshot(): PredictorState }`,
      with the 1-bit and 2-bit variants as the counter width. No model imports, no trace imports
      beyond types — the same layering `predict.ts` already respects. Sweep the classic sequences
      by hand: `TTTTNTTTT` costs a 2-bit **two** mispredicts (`NTTTTTTTT`) and a 1-bit **three**
      (`NTTTTNTTT`). ⚠ **This plan first wrote one and two — the textbook's WARM-START numbers.**
      Both counters reset not-taken, so the leading `T` is a cold mispredict every scheme pays and
      the delta is carried entirely by the `N`: the 1-bit flips and re-mispredicts the next `T`, the
      2-bit only weakens. Measured, not assumed (step 0's harness). Acceptance: unit tests on the
      state machine alone, green before any processor sees it.

- [x] **3. Wire the pipeline (one model only).** — **DONE 2026-08-09; results in the step-3 section
      below.** Replace the `predictTaken` constant with the
      predictor object at the ID bet site and the EX resolution site. ⚠ **`branch-predicted` fires
      only when the bet is TAKEN** — the schema says so explicitly ("There is no not-taken bet …
      emitting `{ taken: false }` would assert an action the machine did not take"). A dynamic
      predictor predicts not-taken roughly half the time early in a run, so it must stay silent
      there, exactly as `'none'` does. `branch-resolved.predicted` still reports both ways.

      ⚠ **TWO TESTS ARE POSITIONED TO GO RED THE MOMENT THIS STEP LANDS, and that is arrival, not
      regression.** Step 1 classified `'dynamic-*'` as not-taken in `web/src/simulator.test.ts`'s
      `SCHEME_POSITION` **because the engine ignored them**, and the assertion beneath it —
      `record(scheme)` equals the not-taken recording for every name in the union — is the behavior
      tripwire M4 left armed for exactly this. When the pipeline first consults a counter table both
      that assertion and `predictsTaken`'s `boolean` shape stop being true. **Growing the prediction
      control past two positions is part of THIS step**, not a follow-up: a five-name union drawn as
      two positions would silently render a third machine as a second, which is the contradiction
      (INV-5) the two-position control was justified by avoiding in the first place.

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

      ⚠ **Step 0's table is PIPELINE-ONLY and must not be inherited here.** Its derived columns rest
      on a squash shadow that is 1 or 2 deep — the pipeline's shape, and not the superscalar's. That
      model's `timing.test.ts` pins `betting: { groups, pairs }` per position, and `paired-branches.s`
      exists precisely for the `branch-slot` refusal it provokes at width 2 — a program step 0 prices
      at 9 cycles under every dynamic scheme because a cold weakly-not-taken counter happens to be
      right about both of its fall-throughs. **So the superscalar's `betting` counts are RE-DERIVED
      per scheme, never carried over**, and the same goes for the deep pipeline's longer shadow.

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

      ⚠ **"By construction" is now ENFORCED, and at step 1 it was not** — a divergent spelling on
      the deep pipeline passed typecheck and all 7591 tests (step 1's break table, row 5). The guard
      is `web/src/models.test.ts`, "every model that bets spells its predictor field `predictor`",
      which drives all four and asserts the key on every recorded cycle. **Do not weaken it into an
      accessor when this step arrives**: an accessor would make the panel work while letting the
      names drift, which is the state the deep-pipeline cache grid was in for a milestone.
      Acceptance: the fold is derived purely from the trace (INV-3) and is **exercised against a
      recorded trace from each of the four models** — not one — with a render smoke test green on
      each. A fold tested on one trace proves nothing about the other three.

- [ ] **7. Browser pass — and it is the only net for steps 6's wiring.** Per
      `browser-is-the-only-net`: 9 of 10 view steps here shipped a defect only the browser caught.
      Drive all five schemes on `nested-loop.s` (step 0b), watch the table train, and **measure the new
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

| fork                                          | verdict                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Does `jal` consult the counter?**           | **Worth exactly 1 cycle, on M4's own witness — but measured on the corpus's ONLY `jal`,** so this is a single witness, not a range. `call-return.s` is 16 under the seed (jal bypasses the table, always taken) and **17** if `jal` reads a cold weakly-not-taken counter. The verdict does not rest on the sample size: an unconditional jump's answer is known at decode, so consulting a counter is pure noise.              |
| Does `jal` _update_ the counter?              | **Zero** on this corpus — no `jal` shares an index with a conditional branch at 16, 8 or 4 entries.                                                                                                                                                                                                                                                                                                                             |
| Does `jalr` update?                           | **Zero**, same reason.                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Table size (16 / 8 / 4 entries)**           | **Zero — identical cycle counts at all three.** No two branches in this corpus alias, even at 4 entries. "Aliasing is a feature" is **unreachable here**, so the size decision is unconstrained by timing and should be made for _drawability_ alone. ⚠ **FALSIFIED BY STEP 0b** — `nested-loop.s`'s guard and inner branch both land on index 2 at 4 entries, costing `dynamic-2bit` 181 against 171. See the step-0b section. |
| **2-bit reset: weakly (01) vs strongly (00)** | **Moves five programs, and in BOTH directions.** `00` makes 2-bit _worse_ than 1-bit on the four single-entry loops (`array-sum` 72 vs 71, likewise `strided-sum`, `sum-loop`, `slow-op-loop`) and _better_ on `array-sum-twice` (274 vs 275, because the outer `TN` prefers a sticky not-taken start). `01` is the right seed and this is why.                                                                                 |
| 1-bit reset                                   | Not a fork — a 1-bit counter has no "weakly" position.                                                                                                                                                                                                                                                                                                                                                                          |

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

## Step 0b — DONE 2026-07-30. `content/programs/nested-loop.s`

Authored at the recommended size, 4 passes × 6 iterations, register-only. The measured row, against
the eleven that were already there:

| scheme             | `nested-loop.s` [fwd off] | Δ vs `static-taken` | mispredicts |
| ------------------ | ------------------------: | ------------------: | ----------: |
| `static-not-taken` |                       182 |                  −5 |          23 |
| `static-taken`     |                       177 |                   — |           9 |
| `dynamic-1bit`     |                       174 |              **+3** |          10 |
| `dynamic-2bit`     |                       171 |              **+6** |       **7** |

**It is the only program in the corpus whose four schemes come out STRICTLY ORDERED with
`dynamic-2bit` fastest** — 2-bit > 1-bit > `static-taken` > not-taken, no ties anywhere. Three other
programs do beat `static-taken` under a dynamic scheme (`paired-branches` +4, `call-return` +2,
`branch-flavors` +1, per step 0's own delta table), but on every one of them the two dynamic columns
TIE each other, and the win comes from a branch that habitually falls through — which is
`static-not-taken`'s bias, not a counter's memory. This is the only row where the win comes from a
branch that is mostly **taken** and where the second bit is what buys it. And the
1-bit → 2-bit delta is exactly the projected 3 — the three re-entry mispredicts, gone. Corpus-wide,
`dynamic-2bit`'s margin over `static-taken` goes from **1 cycle to 7** (814 → 807 off, 591 → 584 on).
That is still a small number, and it should stay stated: this feature's case is per-program, not
aggregate.

**The guard is what makes the ORDERING textbook, not just the delta legible.** A never-taken
`bne x0, x0` at the head of each pass costs `static-taken` 2 cycles four times over and costs both
dynamic schemes nothing (they start weakly-not-taken and are immediately right), so P runs
46 / 41 / 38 / 35. Without it `static-taken` still won this program and the feature would have
demonstrated hysteresis while losing on the clock.

### Two ordering decisions that were MEASURED — and the constraint is narrower than it first looked

Both drafts tripped the same wire. All three timing tables pin **one stall histogram per forwarding
position for ALL schemes**, so a program whose retired-path stalls move with the prediction scheme
changes their _shape_ rather than adding a row to them. There are exactly two ways to do that, and
neither is "distance-2 is unsafe" — the shipped program's biggest stall site (`{24: 24}`) IS a
distance-2 RAW and is perfectly scheme-invariant:

1. **A RAW that spans a branch.** Its distance depends on what that branch predicted; the 7-stage
   inserts 4 correction cycles for a lost bet. Draft 1 put the guard between `li t1` and its
   consumer, and the 7-stage charged a retired stall under `static-not-taken` that vanished under
   `static-taken`.
2. **A bet that re-times the producer relative to the consumer.** At width 2 a bet from slot 0 kills
   its mate, which re-partitions the groups behind it — so an instruction can change which issue
   GROUP it lands in. Draft 2's `li t1`@12 paired with the guard under `static-not-taken` and was
   killed and re-paired with its own consumer's neighbour under `static-taken`, moving `addi t1`@20
   two cycles. Measured: the 2-wide machine's `L` at **60 under `static-not-taken` and 64 under
   `static-taken`**. The shipped `{24: 24}` site is safe by contrast because `addi t1`@16 and
   `addi a0`@20 pair in _every_ scheme, so `bne`@24 sits consistently one group behind its producer.

So: the guard sits **ahead** of `li t1, 6` (nothing reads across it), and `addi t1, t1, -1` comes
**before** `addi a0, a0, 1`.

**The transferable part is the procedure, not a distance heuristic.** Neither hazard is visible by
reading, and both are cheap to measure: `M:\claud_projects\temp\bp-step0\screen.test.ts` dumps every
stall histogram × scheme × forwarding position × width in one run. Screen a candidate layout there
**before** hand-deriving any table row.

### What it actually cost — six sites, not the three priced above

The three timing rows were the predicted part, and each was hand-derived from its own model's
recurrence and **green on the first run**, superscalar block included. The three that were not
predicted are all _shape_ claims rather than presence checks, and grepping for the completeness
idiom would not have found them:

- `superscalar/src/pairing.test.ts:507` — a second corpus-completeness table (the headline w1/w2 A/B).
- `superscalar/src/processor.test.ts:173,188` — slot-surjectivity **sets** per width, plus a
  hard-coded length. A new program joins or does not join by its per-width issue shape.
- `web/src/pairing-readout.test.ts:552` — the IPC tile's flat-at-widths-3-and-4 enumeration.
- and `superscalar/src/timing.test.ts:2276`, a hard-coded `'eight of eleven'` count with a prose
  message, which stays 8 only by coincidence.

Out-of-order needed nothing, as predicted.

### Two findings the row carries that are about the MACHINES, not the predictor

- **Pairing makes this program's interlock worse, and it still wins.** `L = 64` at width 2 against
  `S = 40` at width 1: once `addi t1@16` and `addi a0@20` issue in the same cycle, `bne@24` is one
  GROUP behind its producer instead of two instructions behind, so its distance-2 interlock costs 2
  cycles a lap instead of 1. Cycles go 182 → 172 regardless.
- **`static-taken`'s sign flips with width** — a 5-cycle win at width 1, a 3-cycle loss at width 2,
  4 at widths 3 and 4 — because every bet ends its issue group. The corpus's clearest case.

### And it falsifies step 0's table-size verdict

At **4 entries the guard (pc 8) and the inner branch (pc 24) collide on index 2**, and
`dynamic-2bit` runs **181 instead of 171** — a 10-cycle loss. Step 0 measured table size as
timing-neutral because nothing in the eleven-program corpus aliased; that is no longer true. The
size decision now has a reason to pin **8 or 16** rather than being drawability alone, and the
corpus has its first aliasing witness — reachable if the table is ever drawn at 4.

## Step 1 — DONE 2026-07-31. The union, `PredictorState`, and four `micro` fields

Five schemes now, three of them behaviors: `packages/trace/src/processor.ts` carries
`'none' | 'static-taken' | 'static-not-taken' | 'dynamic-1bit' | 'dynamic-2bit'`, and
`packages/engine/common/src/predictor.ts` holds `PredictorState`, `PREDICTOR_ENTRIES = 16` and
`predictorIndex(pc)`. **No behavior anywhere** — the four honoring engines still read
`config.branchPrediction === 'static-taken'`, so a `dynamic-*` run is byte-identical to a not-taken
one and `micro.predictor` is `null` on every recorded cycle of every model. Repo 7591 → 7597 tests —
the single-cycle inertness test was STRENGTHENED in place rather than joined by a new one, so every
net addition is a hole this step's own checking found: the cross-model spelling guard, and the five
tests for `predictorIndex`, which shipped untested. Five gates green.

### Where the type went, and the rule that decides it

The step's own text said "add `PredictorState` to the trace types". Wrong, against precedent:
`CacheState` is not in `trace` either. The rule, now written into step 1 above so it is not
re-litigated at step 2 — **a type handed to `reset()` is CONFIG and lives in `trace`; a type carried
in `MachineState.micro` is a model's SHAPE and lives beside the code that produces it**, because
`trace/src/schema.ts` types `micro` as `unknown` precisely so `trace` never learns these shapes.

It is exported from `engine-common` and **deliberately NOT re-exported through the four model
packages**, unlike `CacheState`. That asymmetry is history, not a boundary change: `cache.ts` lived
in `engine-pipeline` first, so the M7 move kept a re-export to spare ten `web` files an import churn.
This surface is new, `web` already imports `engine-common` directly (`MAX_ISSUE_WIDTH`,
`CACHE_SMALL`/`CACHE_LARGE`, `toProgramImage`) and eslint's DAG allows that edge, so four re-exports
would only add four places for the name to drift. The read/drive boundary the cache re-export
protects holds by construction instead — what leaves this module is a shape, a size, and a pure
function of `pc`; there is nothing here to drive, and step 2's mutating class stays package-private
the way `access`/`newCache` are.

### What adding a `micro` field actually costs — three sites, and two of them were invisible

The four `micro` interfaces and their four construction sites were the predicted part. The two that
were not are both **hand-written whole-`micro` object literals**, and neither is findable by grepping
for the field being added:

- `web/src/MicroTablePanel.tsx:133` — **not a test, a component.** `preRunMicro` FABRICATES an
  `OutOfOrderMicro` for cursor −1 (it exists so the panel keeps its height off the start; without it
  every surface below jumped 526px). It now passes `predictor: null` with a ⚠: **step 6 must
  revisit it**, because once a predictor exists the honest pre-run value is the COLD table — every
  counter at its seed — and emphatically not `m.predictor` carried forward, which would show a
  fully-trained table before a single instruction ran. That is step 4's shallow-copy defect arriving
  through the front door of a fabricated snapshot. `robCapacity` is copied because it is a CONFIG
  fact; `rob`/`rename`/`predictor` are RUN facts and each must be emptied to its own zero — which for
  a counter table is a seed, not an absence.
- `engine/pipeline/src/processor.test.ts:187` — a `toEqual` on the whole `micro`. **The only
  assertion in the repo that could see the field arrive**, and the argument for spelling a shape out
  rather than probing fields one at a time: a `micro` that grows a member has to come through it.

A grep for `micro: {` finds the assignments and misses both of these, because in each the literal is
an ARGUMENT. Grep for the model's micro TYPE NAME instead.

### The two tripwires, and why only one was spent

`SCHEME_POSITION` in `web/src/simulator.test.ts` is a `Record<BranchPrediction, …>` M4 armed for
exactly this newcomer, and it went red as a **compile** error the moment the union grew. The two
dynamic names are classified `'not taken'` **because the engine ignores them, not because they are
not-taken machines** — which is the truth about the shipped machine today.

**The assertion beneath it was deliberately left alone.** It is the second, independent tripwire: it
asserts every name in the union records identically to the not-taken recording, so it goes red at
**step 3**, when the pipeline first consults a counter table. Restructuring the test at step 1 would
have spent a tripwire that had not fired yet — the compile check covers step 1, the behavior check
covers step 3, and each fires when it should. Step 3's entry above now names that failure so it reads
as arrival rather than regression, and makes growing the prediction control part of that step.

### The inertness test, and its non-vacuity control

The old assertion was `cycles('static-taken') === cycles('static-not-taken')` — two names, and a
CYCLE COUNT. Both halves were holes, and M4's own rule names the first: two machines agreeing on
timing can still differ in events. It now sweeps **all five names on whole recordings**, on
single-cycle and multi-cycle, deriving the five from `Object.keys(SCHEME_POSITION)` so a sixth scheme
cannot be added unswept.

⚠ **"Every scheme records the same" is exactly the assertion that passes when the harness has
stopped applying the knob at all.** So the test carries its own control: the same helper, handed the
PIPELINE, must separate `static-taken` from `static-not-taken` before the sweep runs. Verified by
mutation rather than assumed — see the break table below.

### Break table — MEASURED, and three rows came out other than predicted

| mutation                                                    | `npm run typecheck`                   | `npm test`                                 |
| ----------------------------------------------------------- | ------------------------------------- | ------------------------------------------ |
| `recordOn` drops the `scheme` from the config it builds     | green                                 | **1 red** — the non-vacuity control only   |
| ...and the non-vacuity control is removed as well           | green                                 | **GREEN, 25/25** — the sweep sees nothing  |
| the UNION loses `'dynamic-2bit'`                            | **1 red** (`SCHEME_POSITION`, TS2353) | **GREEN** — a type is invisible at runtime |
| the RECORD loses its `'dynamic-2bit'` key (union intact)    | red                                   | **1 red** — `ALL_SCHEMES` length           |
| `predictor` renamed `bht` on `DeepPipelineMicro` + its site | **green**                             | **GREEN, 7591/7591**                       |

Four findings, and only the first was predicted:

1. **The five-scheme sweep alone is vacuous.** Row 2 is the one that matters: with the knob never
   applied AND the control removed, all 25 tests pass — including "every scheme records identically",
   which is exactly the assertion a harness that stopped applying the knob would satisfy. The control
   lives in the test BODY rather than a sibling `it` for that reason.
2. **Row 1 does not show "the sweep stayed green" — it shows the `it` ABORTED.** Vitest stops at the
   first failed `expect`, so a control placed first hides whether what follows would have passed.
   Measuring the claim needed row 2 as its own run. A break table written from row 1 alone would have
   recorded the opposite conclusion.
3. **A union is a TYPE, so `npm test` is structurally blind to it shrinking** — the Record literal
   still carries the key at runtime. Only `tsc` sees row 3. The `ALL_SCHEMES` runtime guards are not
   redundant with it: they cover row 4, the complementary mutation, which is what "fixing" that
   compile error by deleting the offending key would actually produce.
4. ⚠ **Row 5 is the gap this step found, and it was open.** The plan's whole step-6 defense is that
   `predictor` agrees across four models _by construction_ — and construction was checked by nothing.
   A divergent spelling on the deep pipeline passed typecheck AND all 7591 tests. The pipeline alone
   was covered, accidentally, by the whole-`micro` `toEqual` in its own suite; the other three had no
   such assertion, and the gap is invisible precisely because nothing READS `micro.predictor` yet —
   the first reader is step 6's panel, by which time the drift would already be shipped. **Closed
   here rather than at step 6**, by a test in `web/src/models.test.ts` that drives every model
   reporting `configurableBranchPrediction` and asserts a `predictor` key on every recorded cycle
   (7591 → 7592). Verified against the broken code first: it fails on `deep-pipeline cycle 0`.

### The gap the break harness did NOT find, and the shape of it

The harness above hunted the field's SPELLING and found a real hole. It never touched the exported
ARITHMETIC, and `predictorIndex` shipped with **no test at all** — the only pure function in
`engine-common` without one, in a package whose two siblings (`predict.ts`, `cache.ts`) are both
pinned.

**Why that is worse than the spelling gap, not smaller.** A wrong spelling blanks a panel; wrong
arithmetic moves numbers that three hand-derived timing tables already assume. Delete the `>>> 2` and
the function becomes `pc % 16` — under which `nested-loop.s`'s guard (pc 8) and inner branch (pc 24)
**both land on index 8 and collide at the PINNED size**, exactly the aliasing this plan measured as
reachable only at 4 entries. `dynamic-2bit` stops being 171. And nothing today can observe it:
`micro.predictor` is null everywhere and the first reader is step 6's panel, so the symptom would
first appear at **step 3** as "the step-0 derived table disagrees with the engine" — sending a future
session to re-derive a table that was correct all along.

`predictor.test.ts` closes it (5 tests; repo 7592 → 7597). Every assertion was verified against a
broken function before being trusted, and the two mutations partition cleanly:

| mutation                        | what went red                                                         |
| ------------------------------- | --------------------------------------------------------------------- |
| `>>> 2` deleted (`pc % 16`)     | **3 of 5** — the two stated rows, consecutive-rows, and the collision |
| `>>>` weakened to `>>` (signed) | **1 of 5** — the address-space range check, and nothing else          |

The second row is why the range check is not padding: a signed shift is invisible to every
corpus-shaped assertion, which is `predict.ts`'s own `>>> 0` finding recurring one file over.

**`pc` is ABSOLUTE and `TEXT_BASE` is `0x0000_0000`**, so an absolute pc equals its offset and this
plan's row numbers ("guard at pc 8 → index 2") are true of the shipped table verbatim. Not a
tautology: a non-zero base rotates every row by `(TEXT_BASE >>> 2) % PREDICTOR_ENTRIES`. Collisions
survive a constant rotation so **no cycle count would move** — but step 6 is checked against those
stated rows, so a future base change moves the picture without moving a number.

**The transferable rule**: a break harness aimed at a step's headline risk will not find the risk in
what the step exported ALONGSIDE it. Both gaps here have the same root — code that nothing reads yet
is code no test is shaped to cover, and "there is no consumer" is exactly when the defect gets
written in.

### Also, from the toolchain

⚠ **The four `snapshotState` docblocks say "the cache is the ONE exception"** — true today, false at
step 4. Each now carries a clause saying so, because THAT docblock (not the field's) is what someone
deciding what to deep-copy reads; `models.test.ts` records this repo's own instance of a stale claim
sitting directly above the assertion contradicting it.

⚠ **`Set-Content` mojibaked the file on the first attempt at row 5** — a two-token rename came back
as 152 insertions / 152 deletions. The M13 memory records this hazard and it is still live: mutate
source here with the editor, never a PowerShell `-replace` round-trip.

## Step 2 — DONE 2026-08-09. `BranchPredictor`, the state machine

Shipped: `BranchPredictor` in `engine/common/src/predictor.ts` — `{ index, predict, update, snapshot }`,
constructed from the scheme, exported through `engine-common/index.ts` and **constructed by nobody**.
Nine tests (7597 → 7606), five gates green. Step 3 wires the pipeline.

### Three shape decisions, each made against a precedent rather than a preference

**A CLASS, not `cache.ts`'s functions-over-a-state-object — and the difference is not taste.**
`access()` threads `config` through every call because a cache's geometry lives in `CacheConfig` and
varies per run. This table's geometry is a module constant and its only variable is the counter
width, so constructing from the scheme derives that width **once** and the four wiring sites (steps 3
and 5) pass `config.branchPrediction` straight through. That matters here specifically:
`m13-width-planned.md` records four-site divergence as this repo's measured failure mode, and a
threshold computed at four call sites is four chances to compute it differently.

**The API stays `predict(pc)` / `update(pc, actual)` and nothing richer, because that is what keeps
three of this plan's open decisions open.** "Does `jal` consult the counter", "do `jal`/`jalr` update
it" and "does a SQUASHED branch update it, on resolve or on commit" are all still `_(open)_` — and
all three are CALL-SITE policy. A constructor taking a decode, or an `update` taking `isConditional`,
would close them by implementation **inside a package forbidden from importing a model**, which is
the wrong place for a question whose answer is "it depends which machine". The two-arg `update` is
precisely what leaves update-on-resolve vs update-on-commit a step-5 decision rather than a step-2
accident.

**`snapshot()` returns the LIVE table, deliberately not a defensive copy.** A copy here would read as
the safer choice and would be wrong twice over: it would make four `micro.predictor` docblocks false
(all say "DEEP-COPY it into every snapshot"), and it would **dissolve step 4** — whose whole content
is putting that copy in each model's `snapshotState()`, next to the cache's, with a break harness.
The general rule is step 1's own ⚠ restated: a decision belongs where the implementer READS it, and
the person deciding what to deep-copy is reading `snapshotState`, not a getter one package down. A
test pins the aliasing so the contract cannot drift out from under step 4.

`DynamicScheme` is `Extract`ed from the trace union with a template literal rather than hand-listed,
so a third dynamic name widens the type, makes `COUNTER_BITS`'s `Record` incomplete and reddens `tsc`
at the one place that must answer "how wide is its counter?" — the `SCHEME_POSITION` tripwire shape.
**That claim was FIRED rather than asserted** (adding `'dynamic-3bit'` to the union gives exactly one
error, `TS2741` on `COUNTER_BITS`), because step 1's headline lesson was a "by construction"
agreement enforced by nothing — and a compile tripwire is invisible to the six runtime mutations
below, so `npm test` could never have found it. ⚠ It is **prefix-conditional**: a scheme spelled
`'bht-3bit'` — the alternative this plan's own decisions table weighed — would not widen the type at
all, and the error would land at the step-3/5 call site instead.
The seed falls out as `takenFrom - 1` in both schemes (0 for 1-bit, 1 for 2-bit), so weakly-not-taken
is one expression rather than a second per-scheme table.

### Break table — MEASURED, six mutations, and the flagship string is NOT a total net

Commit first (risk 5), mutate with the editor (`Set-Content` mojibakes source here), revert with
`git checkout --` between rows. 14 tests in the file.

| #   | Mutation                                     | Reddens                                         |
| --- | -------------------------------------------- | ----------------------------------------------- |
| 1   | Floor clamp dropped (`c - 1`)                | **1** — floor only                              |
| 2   | Ceiling clamp dropped (`c + 1`)              | **2** — ceiling + flagship string               |
| 3   | Threshold forced to 1 (`takenFrom = 1`)      | **3** — cold table, floor, live table           |
| 4   | 2-bit seeded strongly-not-taken (`.fill(0)`) | **3** — cold table, flagship string, live table |
| 5   | `update` re-implements the index (`pc % 16`) | **6** — everything that trains then reads       |
| 6   | `snapshot()` copies defensively              | **1** — the live-table guard only               |

Four rows are worth more than the count:

- ⚠ **Row 3 leaves the flagship string GREEN.** `TTTTNTTTT` under a 2-bit table with the threshold at
  1 still reads `NTTTTTTTT` — so the sequence everyone thinks of as "the" test of a saturating
  counter does **not** pin the taken threshold. The cold-table and floor tests carry that, which is
  the concrete reason the flagship is not allowed to be the only case. Same class as step 1's
  "a five-scheme sweep is vacuous on its own".
- **Row 4 corrected a row written from prediction, again.** It was hand-derived as "cold table only";
  it also reddens the flagship, because a 2-bit counter seeded at 0 mispredicts **twice** before it
  warms (`NNTTT…`), not once. Third consecutive step where a predicted break-table row came out
  wrong — the rule is now simply _run it_.
- **Row 5 does not partition and should not.** A predictor that trains the wrong row is the loud
  failure, and six of fourteen is the right shape for it. What it does prove is that `predict` and
  `update` are welded to the exported `predictorIndex`, which is the coupling step 6's panel rests on.
- **Row 6 is the guard on step 4's premise, and it is non-vacuous** — exactly one test sees a
  defensive `snapshot()`. Without that row, "the recorder owns the copy" would be a comment.

⚠ **One mutation is INVISIBLE and is recorded rather than tested.** Replacing `index()`'s delegation
with an inline `(pc >>> 2) & 15` is value-identical for every uint32 at the pinned 16 entries, so no
assertion in the repo can see it; the delegation is a _reading_ guarantee that only starts paying if
`PREDICTOR_ENTRIES` moves. Stating it beats a test that pretends to cover it — the honest form of
step 1's "a harness aimed at the headline risk misses what shipped alongside it".

## Step 3 — DONE 2026-08-09. The pipeline consults a table, and a boolean stops being enough

Shipped: `betTarget(d, pc)` and an EX training call in `engine/pipeline`, `isConditionalBranch` +
`isDynamicScheme` in `engine-common`, and a **four-position** prediction control in the shell.
7606 → 7828 tests, five gates green. `micro.predictor` is still `null` — step 4.

### The engine, and the three things the call site had to decide

**`betTarget` is the one place any scheme is read**, and it decides in the order that keeps a counter
away from words that have no direction: not a PC-relative transfer ⇒ no bet under any scheme; no
table ⇒ M4's `predictTaken` verbatim; a table ⇒ a conditional branch asks its counter and `jal`
bypasses it. Training is EX's, at resolution, on the branch's OWN pc, conditional branches only.

**Both `jal` decisions are now CLOSED on their measured seeds** (bypass; do not update) and are
spelled by a shared `isConditionalBranch` rather than inline, so steps 5's three sites cannot answer
them three more ways. That predicate is the whole mechanism of a policy the plan's derived tables
were computed under — if a call site and the table disagree, the acceptance numbers fail with no way
to tell which of the two is wrong.

**Resolve-time and commit-time coincide in this model, and that is a FACT rather than a decision.**
An instruction in an older transfer's shadow is flushed from the latches at the clock edge, so it
never reaches EX: a branch that resolves here always retires. The fork the plan holds open for the
OoO core is untouched by this step, and nothing about it can be inferred from this line.

`isDynamicScheme` narrows off `COUNTER_BITS`'s keys rather than a `'dynamic-'` prefix test. A prefix
test would be a second, independent spelling of `DynamicScheme`'s template literal — agreeing "by
construction", which is step 1's headline lesson about agreements enforced by nothing. Keyed off the
`Record`, a third scheme reddens `tsc` and then the predicate already knows it; a prefix test would
have returned `true` for a scheme with no width and built a table of `NaN`.

### The web: four positions for five names, and a defect the split exposed

`predictsTaken(scheme): boolean` split into **`predictionPosition`** (machine identity: the lit
button and the no-op guard) and **`hasTakenBetPath`** (does the machine have the branch-target adder
— the datapath's question, and a dynamic machine's answer is YES). Two functions because they are two
questions; `hasTakenBetPath` derives from the position map rather than a second list of scheme names,
so the shell cannot come to light the "1-bit" button while drawing a machine with no adder.

⚠ **The boolean's residue was a live defect, not a tidiness argument.** `setBranchPrediction`'s no-op
guard read `predictsTaken(next) === predictsTaken(current)`, so switching from "not taken" to
`'dynamic-1bit'` compared `false === false`, **skipped the re-record**, and left the user reading the
old machine's trace under the new scheme's label. The state string moved, so nothing headless could
see it — `browser-is-the-only-net` again, and the same shape as `keyboard-clock-control`'s 68/68.
Break row 9 confirms it: reverting the guard to the boolean reddens **zero** tests.

⚠ **Between step 3 and step 5 two of the four buttons are honored by the PIPELINE ALONE.** The other
three betting models still read `config.branchPrediction === 'static-taken'`, so on them a dynamic
selection re-records a trace identical to not-taken — the button moves, the machine does not. **A
`dynamicBranchPrediction` capability was considered and REJECTED**: it churns six capability literals
and `models.test.ts`'s exact honoring-model list twice, once now and once at step 5, to ship a schema
field whose only content is "step 5 has not happened yet". Instead `simulator.test.ts`'s inertness
test names the three models explicitly, so **step 5 turns it red on arrival** — one test edit, and the
window cannot close unnoticed. Delete that block at step 5; do not widen it.

### Acceptance — and (b) came out exact

**Every cell of the step-0 and step-0b tables reproduced by a real engine**, all 12 programs × 4
schemes × both forwarding positions, including `nested-loop.s`'s 182 / 177 / 174 / 171 and all four
corpus totals (662 / 637 / 637 / 636 off, 479 / 454 / 454 / 453 on, over the original eleven). The
columns were DERIVED before an engine could run one; they needed no correction.

That also discharges the one thing step 0 could only argue: **`S` is scheme-invariant.** The derived
columns were `N + 4 + S + P` with `S` assumed constant across schemes, and a closed form cannot check
its own assumption. `dynamic-predict.test.ts` measures the cycles instead.

(a) INV-8 across the new matrix — `differential.test.ts` goes 30 → 50 cells. (c) the three existing
schemes unchanged corpus-wide — `timing.test.ts` untouched and green, which IS the claim; restating
its columns would be a copy that can only drift. ⚠ The plan's "confirm M4's timing pins cover all
four models" is **step 5's** problem: this step touches only the pipeline, whose pins are complete.

### Break table — MEASURED, eleven mutations, and the headline row was WRONG

Committed first (risk 5), editor not `Set-Content`, `git checkout --` between rows. Full suite each.

| #   | Mutation                                             | Reddens                                 |
| --- | ---------------------------------------------------- | --------------------------------------- |
| 1   | `update` handed the wrong pc (`nextPc`)              | **31** — strings, replays, **6 cycles** |
| 2   | `jal` CONSULTS the table                             | **5** — call-return's strings + cycles  |
| 3   | `jal`/`jalr` UPDATE the table                        | **0**                                   |
| 4   | the bet ignores the predictor (knob unhonored)       | **36** — 35 dynamic-predict + 1 control |
| 5   | `predict` consulted at the TARGET pc                 | **31**                                  |
| 6   | trained on what it PREDICTED, not what happened      | **31**                                  |
| 7   | `isDynamicScheme` tests the prefix, not the `Record` | **0**                                   |
| 8   | the two position maps TRANSPOSED                     | **3** — App render, session, simulator  |
| 9   | the no-op guard reverted to the boolean              | **0**                                   |
| 10  | `predictorIndex` ROTATED by one entry                | **2** — `predictor.test.ts` alone       |
| 11  | `branch-predicted` fires on a not-taken bet          | **6** — across four files               |
| 12  | `hasTakenBetPath` collapses to `static-taken` only   | **1** → **2** — see below               |
| 13  | every button rendered with the 1-bit `title`         | **1** — added with the row              |
| 14  | deep-pipeline starts honoring `dynamic-1bit`         | **1** — the step-5 tripwire, FIRED      |

Six rows are worth more than their count:

- ⚠ **Row 1 falsified the reason `dynamic-predict.test.ts`'s replay was written, and the corrected
  version is the more useful claim.** The prediction was that training the wrong row leaves cycle
  counts intact — rows only interact where branches alias, and this corpus's only aliasing witness
  aliases at 4 entries, not the pinned 16. Measured: **six cycle counts move.** Decoupling the row you
  train from the row you read does not relabel the table, it makes every counter answer for a branch
  that is not the one being predicted, which changes the bets themselves. **Fourth consecutive step
  where a hand-written break row came out wrong. The rule remains: run it.**
- **Row 10 is the wrong-pc mutation that IS invisible — and it is invisible to the replay too.** A
  CONSISTENT shift (predict and update moving together) is a bijection on rows; collisions survive it
  exactly, which is the plan's own `TEXT_BASE` argument, now measured. Nothing in the engine, the
  trace, or the new test file sees it. The **only** net is `predictor.test.ts`'s unit tests on
  `predictorIndex` — the arithmetic that shipped with NO test at step 1. So those tests are not
  redundant with the wiring tests above them; they are the sole net for their own defect class.
- **Taken together, rows 1, 5, 6 and 10 say the replay caught nothing ALONE.** Every mutation it
  reddened, the cycle table reddened too. What it actually buys is **localization** — it names the
  branch and the bet — plus one genuine unique catch: a step-5 copy-paste that changes a policy and
  "fixes" the replay to match keeps it green and still fails the **literal strings**, which is why
  claim 2 is written out rather than replayed. Recorded rather than claimed, because a file asserting
  it is the only net for a defect it does not uniquely catch is worse than one that says what it is.
- **Row 3 is a pinned decision with NO net, and that is now measured rather than assumed.** Making
  jumps update reddens nothing at all — the plan predicted zero TIMING effect (no jump shares an index
  with a conditional branch at 16, 8 or 4 entries) and the truth is broader: no test of any kind sees
  it. It is a pedagogy call, and `isConditionalBranch`'s docblock is the only thing holding it.
- **Row 4 confirms the differential matrix is a FALSE NET here, in its own new cells.** With the knob
  entirely unhonored, **all 50 INV-8 cells stay green** and so does `timing.test.ts`; the only red is
  `dynamic-predict.test.ts` plus the control's four-position test. The matrix was still worth widening
  — it visits wrong paths the static schemes never take, which is where a speculation LEAK would hide —
  but it can say nothing about whether a dynamic scheme is honored at all.
- **Row 8 is why the round trip is a test.** Two hand-maintained map literals are inverses only
  because something says so; transposed, they typecheck, render four correctly-labelled buttons, and
  silently record the wrong machine on two of them. Three tests catch it, and one of them is the
  RENDER-keyed one — `m13-width-planned`'s signature defect is a test keyed off a pure fold instead.

Row 7 is the honest counterpart of step 2's inline-index row: value-identical today, so nothing can
see it. It is a reading guarantee that starts paying when a third scheme arrives, and saying so beats
a test that pretends to cover it.

### Rows 12–14 — added by a review pass AFTER the harness, and one of them found a real hole

The first eleven rows were aimed at the engine and the control. A review of the finished step asked
three questions the harness had not, and the first was a genuine gap:

- ⚠ **Row 12 exposed the repo's signature defect in the new code.** `App.tsx` builds the diagram's
  config as `predictTaken: hasTakenBetPath(sim.branchPrediction)`, and `datapath-pipeline.test.ts`
  sweeps `DatapathConfig` **literals** — so it never traverses that function. Collapsing
  `hasTakenBetPath` back to `scheme === 'static-taken'` reddened exactly **one** test, and it was the
  pure-fold assertion in `session.test.ts`. **Under both dynamic schemes the branch-target adder and
  its three wires would have blanked on the pipeline datapath with nothing to say so** — on the very
  config this feature exists to demonstrate. That is `cache-grid.ts`'s own recorded defect (a panel
  idle on a shipped, user-reachable config for a whole milestone) and `m13-width-planned.md`'s
  signature one (a test keyed off a pure fold rather than the render, eight recurrences). Closed with
  a **render-keyed** case in `App.test.tsx` that starts from a SCHEME and greps the markup; row 12
  now reddens 2. **Generalize: a predicate extracted so two consumers can differ needs a test per
  CONSUMER, and at least one of them must be keyed off the render.**

- **Row 14 turns the step-5 arrival tripwire from a prediction into a measurement**, which is the
  same discipline the eleven rows above were run under. The inertness block's own control proves the
  helper applies the knob; it does not prove the _dynamic_ comparison can fail — step 1's "a control
  placed first hides what follows", in new dress. Making `deep-pipeline` honor `'dynamic-1bit'`
  reddens exactly that block and nothing else, so "step 5 turns this red" is now something the
  harness has seen rather than something this document asserts.

- Row 13 is the cheap one: a `Record<PredictionPosition, string>` catches a MISSING title at compile
  time but not an empty one and not the same title on two positions. ⚠ **The first attempt at this
  row was a bad mutation and reddened 0** — it produced a title that was still distinct, so it tested
  nothing. Re-run as a genuine transposition (every button rendered with the 1-bit title) it reddens
  the new assertion. A break row is only as good as the mutation, and a 0 is worth a second look
  before it is written down as coverage.

## Acceptance criteria

- [ ] Load **`nested-loop.s`** (step 0b), pick **1-bit**, step through, and watch the counter table train —
      then pick **2-bit** on the same program and watch the re-entry mispredict disappear. Same
      program, one knob, visibly different behavior (the §12 flagship interaction).
- [ ] The final register + memory state is **identical under all five schemes** on every corpus
      program (INV-8 across the full matrix).
- [ ] Single-cycle and multi-cycle traces are **byte-identical** across all five schemes (the
      inertness contract).
- [ ] Scrubbing to cycle 0 shows an **untrained** table — the deep-copy holds.
- [ ] All suites green; `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`.

## Decisions to pin (seeded with recommendations, so review is a diff)

| Decision                                             | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Pinned answer |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Predictor state's home                               | `MachineState.micro.predictor`, following `micro.cache` (INV-3; a STATE view may read `micro`). **The TYPE lives in `engine/common/src/predictor.ts`, not in `trace`** — see step 1's correction: config types go in `trace`, `micro` payload types go beside the code that produces them                                                                                                                                                                                                                                                                                                                                                                      | **CLOSED**    |
| Scheme names                                         | **`'dynamic-1bit'` / `'dynamic-2bit'`**, not `'bht-*'` — the first names the pedagogy and reads as the obvious sibling of `'static-taken'`; the second names the implementation. Decide DELIBERATELY: these strings surface in the model picker, and if the URL-permalink work lands they become URL-visible and effectively frozen                                                                                                                                                                                                                                                                                                                            | **CLOSED**    |
| **Does a SQUASHED branch update the predictor?**     | In the OoO model a branch can resolve and then be killed by an older mispredict, so update-on-resolve vs update-on-commit is a real behavioral fork — **invisible to INV-8**, and sitting exactly where step 5's copy-paste pressure peaks, so four models could quietly answer it four ways. Seed: **update-on-resolve** (simpler; the machine learns from what it saw), with commit-time as the realistic alternative. **Pin BEFORE step 5, not during**                                                                                                                                                                                                     | _(open)_      |
| Table size                                           | **16, as a MODULE CONSTANT (`PREDICTOR_ENTRIES`), not a `ProcessorConfig` field.** Step 0b narrowed it to 8-or-16 (only 4 aliases: `nested-loop.s`'s guard at pc 8 and inner branch at pc 24 collide on index 2 there, costing `dynamic-2bit` 181 against 171). **16 breaks the tie because every derived number in the step-0 and step-0b tables was computed at `(pc>>>2)&15`** — so those cycle counts stay usable as step 3's acceptance target with no row re-derived. A config knob was rejected on scope: it is a `trace` schema change dragging every config literal and conformance matrix, to expose a lever whose whole measured range is one cliff | **CLOSED**    |
| Index function's HOME                                | **A standalone pure `predictorIndex(pc)` beside the types, not only a method on step 2's class.** Step 6 must highlight the entry touched this cycle and derives it from `pc` (INV-3), but the mutating class stays package-private to the engines — so the view could never reach a method. This is `cache.ts`'s `lineIndex` boundary exactly: render a table, never drive one                                                                                                                                                                                                                                                                                | **CLOSED**    |
| **Does `jal` consult the counter?**                  | **No — an unconditional jump is simply predicted taken, bypassing the table.** Step 0 priced this fork at **exactly 1 cycle on `call-return.s`** (16 vs 17), i.e. squarely on M4's `+1` witness. Consulting costs a cold mispredict on a branch whose answer is known at decode, which is noise the reader must then be told to ignore. **Pinned at step 3, spelled by `isConditionalBranch` in `engine/common/predict.ts`** so the four wiring sites cannot answer it four ways — the break harness reddens 5 tests when `jal` is made to consult, one of them `call-return.s`'s cycle count                                                                  | **CLOSED**    |
| Does `jal` / `jalr` **update** the counter?          | Seed **no** for both. Measured **zero** effect on this corpus (no `jal`/`jalr` shares an index with a conditional branch at 16, 8 or 4 entries) — so this is a pedagogy call, not a timing one: a table whose rows are all conditional branches reads cleaner. **Pinned NO at step 3** — and the harness confirms the "no timing net" half: making jumps update reddens **ZERO** tests, the only mutation of the eleven that is invisible to the entire suite                                                                                                                                                                                                  | **CLOSED**    |
| Index function                                       | pc bits alone, no tag — a mispredict from aliasing is a true fact about this machine (INV-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | _(open)_      |
| Initial counter state                                | Weakly-not-taken, so a loop's first pass visibly _learns_ rather than starting right. **Step 0 measured the alternative and it is not neutral: strongly-not-taken (`00`) makes the 2-bit predictor SLOWER than the 1-bit on all four single-entry loops** (`array-sum` 72 vs 71, and likewise `strided-sum`, `sum-loop`, `slow-op-loop`) — a demo that would show the "better" predictor losing                                                                                                                                                                                                                                                                | _(open)_      |
| Does `branch-predicted` fire on a not-taken bet?     | **No** — the schema forbids it; a dynamic not-taken prediction is silent, like `'none'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | _(open)_      |
| Does the OoO model share one predictor across lanes? | Yes, one table per machine — a per-lane table is a different (and unrealistic) machine                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | _(open)_      |
| BTB / `jalr` predictability                          | **Out of scope**; `jalr` keeps paying full EX resolution under every scheme                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | _(open)_      |
| Global history / gshare                              | **Out of scope**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | _(open)_      |
| Does the corpus need a new program?                  | **ANSWERED — yes, and it is written.** `content/programs/nested-loop.s`, 4 passes × 6 iterations, landed at step 0b: a 3-cycle 1-bit-vs-2-bit delta, and the only program whose four schemes come out strictly ordered with 2-bit fastest (+6 over `static-taken`, no ties). It cost six sites, not the three this plan priced. See the step-0b section                                                                                                                                                                                                                                                                                                        | **CLOSED**    |

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
