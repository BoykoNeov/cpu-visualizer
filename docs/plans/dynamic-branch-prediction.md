# Dynamic branch prediction — the predictor gets a memory

**Status: NOT STARTED, 2026-07-30.** Nothing is built. Every claim below about the current code is
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
  stateful class. Schemes: add `'bht-1bit'` and `'bht-2bit'` to the union. The 1-bit variant is not
  filler: **the 1-bit-vs-2-bit delta on a doubly-entered loop is the entire lesson**, and without
  both positions the reader has nothing to A/B.
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

## The multiplier nobody should discover in step 3

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

- [ ] **0. Measure the corpus BEFORE designing anything.** Two facts this plan rests on and does
      not know: **(a)** which corpus program distinguishes 1-bit from 2-bit. The distinction only
      appears on a loop **entered twice** — a 1-bit predictor mispredicts on exit _and_ again on
      re-entry, a 2-bit absorbs the second. `sum-loop.s` runs its loop once, so it very likely
      shows **no difference at all**; `array-sum-twice.s` ("the repeat pass re-reads the same
      addresses", `conformance.ts:119`) is the candidate. **(b)** the signed per-program delta of
      each scheme against `static-taken`, the way M4 pinned `sum-loop −7, array-sum −2, call-return
    +1`. Acceptance: a committed table of (program × scheme) cycle counts, **with at least one
      program where 1-bit and 2-bit differ**. If no such program exists, the corpus needs a new
      one and that becomes step 0b — a doubly-entered loop, authored before any engine work.

- [ ] **1. `engine/common/src/predictor.ts` — the pure, stateful predictor.** A class over
      `{ index(pc), predict(pc): boolean, update(pc, actual): void, snapshot(): PredictorState }`,
      with the 1-bit and 2-bit variants as the counter width. No model imports, no trace imports
      beyond types — the same layering `predict.ts` already respects. Sweep the classic sequences
      by hand: `TTTTNTTTT` must cost a 2-bit **one** mispredict and a 1-bit **two**. Acceptance:
      unit tests on the state machine alone, green before any processor sees it.

- [ ] **2. Schema: `branchPrediction` gains the variants, and `micro.predictor` is pinned.** Extend
      the union in `packages/trace/src/processor.ts:68`; add `PredictorState` to the trace types.
      **State the inertness contract in the docblock the way `issueWidth` does** — earlier models
      ignore the field and their traces stay byte-identical — and gate every UI on
      `capabilities.configurableBranchPrediction`, **never on the field's value**. Acceptance:
      `tsc -b` green; a test pinning that single-cycle and multi-cycle traces are byte-identical
      across all five schemes.

- [ ] **3. Wire the pipeline (one model only).** Replace the `predictTaken` constant with the
      predictor object at the ID bet site and the EX resolution site. ⚠ **`branch-predicted` fires
      only when the bet is TAKEN** — the schema says so explicitly ("There is no not-taken bet …
      emitting `{ taken: false }` would assert an action the machine did not take"). A dynamic
      predictor predicts not-taken roughly half the time early in a run, so it must stay silent
      there, exactly as `'none'` does. `branch-resolved.predicted` still reports both ways.
      Acceptance: INV-8 differential green on the full corpus across the **new** scheme × forwarding
      matrix; the step-0 table's predicted cycle counts reproduced.

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
      the branch that owns it, with the entry touched this cycle highlighted. Acceptance: the fold
      is derived purely from the trace (INV-3), tested headlessly; render smoke test green.

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

| Decision                                             | Recommendation (seed)                                                                                                                            | Pinned answer |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Predictor state's home                               | `MachineState.micro.predictor`, following `micro.cache` (INV-3; a STATE view may read `micro`)                                                   | _(open)_      |
| Scheme names                                         | `'bht-1bit'` / `'bht-2bit'` added to the union; existing three untouched                                                                         | _(open)_      |
| Table size                                           | Fixed small (8 or 16 entries) — big enough to teach, small enough to draw; **aliasing between branches is a feature**, not a defect to size away | _(open)_      |
| Index function                                       | pc bits alone, no tag — a mispredict from aliasing is a true fact about this machine (INV-5)                                                     | _(open)_      |
| Initial counter state                                | Weakly-not-taken, so a loop's first pass visibly _learns_ rather than starting right                                                             | _(open)_      |
| Does `branch-predicted` fire on a not-taken bet?     | **No** — the schema forbids it; a dynamic not-taken prediction is silent, like `'none'`                                                          | _(open)_      |
| Does the OoO model share one predictor across lanes? | Yes, one table per machine — a per-lane table is a different (and unrealistic) machine                                                           | _(open)_      |
| BTB / `jalr` predictability                          | **Out of scope**; `jalr` keeps paying full EX resolution under every scheme                                                                      | _(open)_      |
| Global history / gshare                              | **Out of scope**                                                                                                                                 | _(open)_      |
| Does the corpus need a new program?                  | Decided by step 0's measurement, not here                                                                                                        | _(open)_      |

## Risks, stated before they bite

1. **INV-1 (determinism) and INV-8 should both be untouched** — the table is a pure function of the
   program's own branch history, and INV-8 compares final architectural state, which no predictor
   can change. **Verify this in step 3 rather than asserting it**; if either moves, the design is
   wrong, not the invariant.
2. **The shallow-copy defect** (step 4) is the likeliest thing to ship silently. It is the reason
   step 4 exists as its own step with a break harness rather than a line inside step 3.
3. **The four-model multiplier** (step 5) is where copy-paste pressure peaks. `m13-width-planned.md`
   records what that costs here: five of eight knobs share a type with a sibling, so a transposition
   is green on both the suite and `tsc`.
4. **A test keyed off a pure fold rather than the render** is this repo's signature defect — it
   recurred 8 times in M13 and twice inside the fix written to stop it. Step 6's smoke test must
   assert against the rendered output, not re-run the fold.
5. ⚠ **Commit before running any break harness.** `m13-width-planned.md` records a
   `git checkout --` harness that destroyed an uncommitted tree.
