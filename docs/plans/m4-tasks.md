# Milestone 4 — branch prediction (the second toggle on the pipeline)

**Status: STEP 0 DONE, 2026-07-16 (685 → 691 tests). The machine still predicts not-taken —
step 0 is deliberately inert, and its inertness is the proof. `speculativeTarget` is pure,
unwired, and its agreement with EX is pinned over the corpus + mutation-checked four ways.
PENDING: everything that changes behavior (step 1 on), and every browser eyeball. M3 is
complete, which is the precondition: prediction is a feature toggle ON the pipeline (spec
§12.3) and needs the pipeline to exist before it means anything. Scope is prediction ONLY —
caches are the other half of §12.3 and are deliberately a separate milestone (they carry a
prerequisite prediction does not: the spec warns cache behavior only becomes visible with
array-walking programs, so the example library must grow first).**

Source of truth for scope: `cpu-visualizer-spec.md` §12 (roadmap), item 3. The load-bearing
constraints are the architectural invariants (§3) and the trace schema (§5). The pipeline this
builds on is `docs/plans/m3-tasks.md`.

## Why this milestone, and why now

M3 shipped the forwarding toggle and, in doing so, shipped the _pattern_: flip a config, watch
the same program change behavior, and understand the machine through the difference. M4 is that
pattern's second instance — and the one the roadmap names as living on this tier.

**What M3 did not exercise:** M3's toggle changes only `S` (stall cycles) in the pinned closed
form. Speculation was **fixed** — `predict-not-taken`, hardcoded, with `predicted: false`
written as a literal at `packages/engine/pipeline/src/processor.ts:779` and a comment naming
this milestone. The pipeline has never had a config that changes _which instructions get
fetched_. Prediction is the first.

**What is cheap because it is already built.** The seams for this milestone were cut before the
pipeline existed and have been waiting:

- `ProcessorConfig.branchPrediction: 'none' | 'static-taken' | 'static-not-taken'` — already in
  the trace schema, already threaded through `loadSource` → session → every model (M3 step 5
  built that config seam for forwarding; prediction rides it for free).
- `ProcessorCapabilities.configurableBranchPrediction` — already exists, currently `false`, with
  a comment saying it is an M4 toggle. M3 step 5 pinned that a control is gated on its
  capability flag, so the UI wiring is a known move, not a new one.
- The `branch-resolved` event **already carries `predicted` and `actual`**. A misprediction is
  already expressible in the trace; nothing today can produce one.
- **The pipeline map already draws the casualties.** `sum-loop` draws 18 of them. The payoff
  surface is built and pointed at exactly the thing this milestone changes.

**The genuinely new machinery — and it contradicts an M3 decision on purpose.** Predicting
_taken_ is meaningless without a **target**, and the earliest a PC-relative target is computable
is **ID** (at IF the immediate is not yet decoded). So `static-taken` forces two things M3
refused:

1. **ID must classify "this is a control transfer."** M3 declined this explicitly —
   `processor.ts:175`: _"There is deliberately no BRANCHES set: 'is this a control transfer' is
   not a separate classification here, it is whatever the EX switch resolved a `taken` answer
   for."_ That refusal is what made `jal`/`jalr` fall out as ordinary transfers. M4 needs the
   classification back, because a prediction must be made before the answer exists.
2. **A second redirect point.** Today there is one redirect, at EX, and it is a _correction_.
   `static-taken` adds a redirect at ID that is a _bet_. The two coexist: the ID bet steers
   fetch, the EX correction overrides it when the bet was wrong.

This is the milestone's structural cost, and it should be stated up front rather than
discovered: **M4 is where prediction and correction become different events at different
stages.**

### What M4 does not inherit

- **A zero-cycle correct prediction.** Because the bet is placed in ID, one fall-through fetch
  has already happened by the time the redirect lands. A _correctly_ predicted taken branch
  costs **1**, not 0. Getting to 0 requires predicting from the PC alone at IF — a BTB — which
  is a fancier tier and is **explicitly deferred** (see decisions).
- **A dynamic predictor.** Both schemes here are static. 2-bit saturating counters / history
  tables are a later tier; the config type does not name them, and adding them is a schema
  change, not a scope creep this milestone should absorb.
- **Caches.** The other half of §12.3. Separate milestone, and it needs new corpus programs.

## Headline decision — `static-taken` is the MVP, not deferrable fidelity

This is the scope lever, and it is the opposite of the usual "ship the cheap version first."

`static-not-taken` **is the behavior the machine already has**. Making the engine honor it as a
config value is nearly free — and delivers **nothing**: a toggle whose every position produces
today's trace is not a toggle. The entire flagship payoff — the §12 "flip it and watch the same
program change" interaction — lives in `static-taken`, which is also the mode that carries the
whole structural cost (ID classification + the ID redirect).

Therefore: **a not-taken-only MVP is not an MVP of this milestone, it is a rename.** If
`static-taken` is cut, the milestone loses the rationale that made prediction the chosen
direction over caches and over M2's step 5c. It ships whole or it does not ship.

**The thesis, and it is the mirror of M3 step 3.** M3's crown jewel turned out not to be
"forwarding is faster" — step 3 _corrected the milestone's own rhetoric_ by measuring
`call-return.s` at 17 cycles in **both** positions. M4 has the same shape, but stronger, and it
is visible in the corpus **before a line is written**:

| Program         | The branch                        | Direction       | Which scheme wins |
| --------------- | --------------------------------- | --------------- | ----------------- |
| `sum-loop.s`    | `bnez t0, loop` (backward)        | taken 9 of 10   | **static-taken**  |
| `array-sum.s`   | `bnez t1, loop` (backward)        | taken 4 of 5    | **static-taken**  |
| `call-return.s` | `bge a0, a1, done` (a0=17, a1=42) | **never taken** | **not-taken**     |

**No scheme dominates.** That is not a caveat to manage — it is the pedagogy. A predictor is a
_bet_, and the corpus contains a program that punishes each bet. `call-return` is expected to
get **slower** under `static-taken` (its `jal` improves 2→1, but the not-taken `bge` regresses
0→2 and `jalr` cannot be predicted at all) — the same "the toggle is a tradeoff, not an upgrade"
finding M3 had to discover by measurement, available here by reading the source.

**The arithmetic is already confirmed against a pinned number.** M3 pinned `sum-loop` at **18
casualties**. Nine taken branches × two squashed instructions = 18, exactly. The penalty model
below reproduces an independently observed figure, so the accounting is understood before any
code moves.

## Build order (each step testable before the next)

- [x] **0. ID learns what a control transfer is, and where it would go.** ✅ Done (2026-07-16,
      685 → **691 tests**). `predict.ts`: `speculativeTarget(decoded, pc)` + `isPredictable(d)`
      over a `PC_RELATIVE_TRANSFERS` set — the classification M3 deliberately refused
      (`processor.ts:175`), back because **a prediction must be made before the answer exists**.
      Pure, and **called by nothing**: the machine still predicts not-taken, every existing test
      green and **unmoved** (685 + 6 new = 691), which is the strongest available statement that
      this step changed no behavior. Not exported from the package `index.ts` — the M3 step-0
      pattern (`checkProgram`/`conformanceCases` stayed module-local); prediction is the pipeline's
      business, and nothing outside it has a use for the function.

      **The scope shrank while landing, and that was the point.** The plan said the target would be
      "computed and carried" — carrying it in `IdExLatch` would have changed `micro`, hence the
      recorded trace, hence "behavior-free" would have been a false claim. So the latch field was
      **deferred to step 1**, where it is acted on. A pure function nothing calls is *provably*
      inert; a new latch field is only arguably so.

      The deliverable is the **safety property**, pinned before anything rests on it: ID's target
      agrees with EX's `nextPc` for every taken PC-relative transfer in the corpus. It reads like a
      tautology (both spell `pc + imm`) and is not — two units computing one address from different
      inputs at different times is the shape of the classic BTB bug. So it is asserted against the
      **engine's own `branch-resolved` events**, never against a re-derivation of the arithmetic in
      the test, which would agree with a broken predictor for the reason it was broken.

      **Mutation-checked, and the fourth mutation found a real gap rather than confirming a
      belief.** Emptying `PC_RELATIVE_TRANSFERS` leaves the headline claim **vacuously green** and
      fails only the count guard — exactly the M3 step-0 lesson (claims don't imply each other),
      now measured rather than asserted. Adding `jalr` fails 3. Breaking the arithmetic to
      `pc+4+imm` fails the agreement. But **deleting the `>>> 0` failed nothing**: every corpus
      address is small enough that the signed and unsigned readings agree, and the agreement test
      is structurally blind to it because *EX normalizes too* — both routes would be wrong together
      and still match. Fixed by a **direct** test (a backward branch evaluated near zero), not by
      softening the comment that claimed it was covered. **No corpus sweep can prove this one**;
      the milestone's first finding is that the corpus has a blind spot the plan assumed it didn't.

      A second slip, caught by the derivation rather than by the run: the vacuity count was written
      `15` while its own comment derived `9 + 4 + 1`. The fix was **not** to paste the observed 14 —
      that is a snapshot, and "a cycle count copied from a passing run is not a pin" is M3 step 3's
      rule. It is now asserted **per program**, each count read off that program's trip count.

- [ ] **1. The engine honors `config.branchPrediction` — three schemes, three behaviors.**
      `static-taken` acts on step 0's target: an ID redirect (the bet) coexisting with the EX
      redirect (the correction), with `branch-resolved.predicted` finally telling the truth.
      `configurableBranchPrediction` flips to `true`. Whether `none` is a third behavior or an
      alias is pinned below — decide it here, in the open.
      **Two-redirect precedence is the bug this step must pin, not merely describe.** With two
      redirect points, an older branch's EX correction and a younger branch's ID bet can want to
      steer fetch in the **same cycle**. The rule: **EX wins, and the EX squash invalidates the ID
      bet entirely** — the instruction in ID was fetched _after_ the older branch, so it is
      wrong-path and about to be squashed; letting its bet steer fetch would be a wrong-path
      instruction redirecting a machine that has already decided it never runs. Prose is not proof:
      this needs a hand-derived case where a bet and a correction collide.
      Also: conformance's green-first-run (step 2) rests on wrong-path instructions being squashed
      **before MEM** — no speculative stores. The EX-resolved squash already guarantees this, so it
      is inherited; this step must not introduce a path that commits before squash.
      Acceptance: hand-derived unit tests over each scheme, in the M3 step-2 style (the soul
      pinned by hand-derived cases, not by a corpus sweep). Specifically: a correctly-predicted
      taken branch costs 1; a mispredicted branch costs 2; `jalr` costs 2 under every scheme; and
      a bet colliding with a correction resolves to the correction.

- [ ] **2. Conformance across the scheme matrix (INV-8) — prediction is architecturally
      invisible.** M3 step 0 built `runConformance`'s config list for exactly this. The pipeline's
      list grows from 2 configs (forwarding off/on) to the prediction matrix. **This step is
      expected to be green on the first run, and that is its entire point:** speculatively fetched
      instructions must never commit, so a correct predictor cannot move final architectural
      state. It is the cheapest possible proof of the milestone's central safety claim.
      Acceptance: every (config, program) pair matches the golden reference. If this step is _not_
      green first-run, a squashed instruction is committing — a real bug, caught for free.

- [ ] **3. Timing — the closed form generalizes, and `2·T` was a special case.** M3 step 3 pinned
      `cycles = N + 4 + S + 2·T` as a _derivation_. M4 reveals that `2·T` was never general: it
      was the **static-not-taken** instance of a scheme-dependent penalty term.

      > **cycles = N + 4 + S + P**, where `P` is the speculation penalty:
      > `static-not-taken`: `P = 2·T` (M3's term, unchanged) · `none`: `P = 2·B` over **all**
      > resolved transfers, taken or not · `static-taken`: `P = 1·(correctly predicted taken)
      > + 2·(mispredicts) + 2·(jalr)`

      This step must also assert **the thesis**, not just the arithmetic: that `sum-loop` gets
      faster and `call-return` gets **slower** under `static-taken`. A milestone that only
      measured the program its toggle helps would be repeating the rhetoric M3 step 3 had to
      correct.
      Acceptance: per-term assertions (never an opaque total — M3's rule, for M3's reason: a
      compensating pair of errors passes a total and says nothing about which term drifted), each
      scheme mutation-checked. Note `2·T` counts taken *transfers*, not `flush` *events* — M3
      pinned that they come apart (`call-return`'s `ret` kills nothing but still pays), and `P`
      inherits that trap.

- [ ] **4. Web: the second toggle.** The prediction control beside forwarding, gated on
      `capabilities.configurableBranchPrediction` — the move M3 step 5 pinned. This is where the
      config seam either pays off or reveals it was forwarding-shaped; M3 built it as a general
      `ProcessorConfig` at session level, so the expectation is that it pays.
      Acceptance: browser-verified — the same program, three schemes, cycle counts that move on
      the live scrub bar and match step 3's pinned figures.

- [ ] **5. Datapath: drawing the bet and the correction.** The ID redirect is a new path, and it
      is the first path whose _existence_ depends on config (M3 step 6 established config as a
      visibility axis and derived contraction visibility from `contracts` — this is the next user
      of that idea). Note the M2 step-5c tension: this milestone draws an **ID-stage** redirect;
      5c's deferred **ALUOut→PC** redirect remains a separate, still-deferred concern.
      Acceptance: geometry invariants (the M3 step-6 suite), plus the browser eyeball — which has
      caught a real defect in **five consecutive view steps** and should be budgeted for, not
      hoped against.

- [ ] **6. The map: mispredictions become legible.** Casualties are already drawn; this step is
      about whether a _misprediction_ is distinguishable from a _correct-but-costly_ transfer.
      Expected to be small or free — M3 step 7 proved the map is stage-and-lane-parametric and the
      row/column model absorbed lanes and depth at the cost of only the hue key.
      Acceptance: `sum-loop`'s casualties visibly fall under `static-taken`; `call-return`'s
      visibly rise. Hand-built traces where no engine emits the case (M3 step 7's technique).

- [ ] **7. The lesson — "the bet, and what it costs when it's wrong."** M3 step 8 shipped its
      flagship lesson with **zero** new lesson-format fields, zero engine changes, zero renderer
      changes, and it pinned `lessonOpening` (`model` always honored, `config` honored when
      declared) — which is exactly the seam a prediction lesson needs. The M3 lesson's structure
      (steps config-exclusive, and _that is the lesson_) may apply directly.
      Acceptance: the lesson anchors under its declared scheme; the validator (M3 step 8 scoped it
      to each lesson's declared model × every position it honors) covers the new axis **without a
      special case** — if it needs one, the validator's derivation was wrong, not the lesson.

## Acceptance criteria (mirror the spec §11 shape)

- [ ] Final register + memory state **equals** the golden reference for every corpus program under
      **every** (forwarding × prediction) config (INV-8) — the proof that speculation never
      commits.
- [ ] The **same program** runs a **different number of cycles** under each scheme, on the live
      scrub bar, matching the step-3 pinned derivation.
- [ ] **No scheme dominates**, and it is demonstrable: `sum-loop` is fastest under
      `static-taken`; `call-return` is fastest under `static-not-taken`. Both directions asserted.
- [ ] A **misprediction** is followable: the bet, the wrong-path instructions fetched, their
      squash, and the correction — as trace events (INV-3) and on the map.
- [ ] `engine/pipeline` still has **zero** imports from `web`/`curriculum`; prediction is honored
      via `ProcessorConfig` only, with no new back door (INV-2/INV-3).
- [ ] Every lesson still anchors under every config it declares it honors.

## Decisions to pin (fill in as steps land — seeded with the recommended answers)

| Decision                                          | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Pinned answer |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **Is `static-taken` in the MVP?**                 | **Yes — it IS the MVP.** `static-not-taken` alone is a rename of current behavior. See the headline decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | _(open)_      |
| **What does `none` mean?**                        | **Stall-on-branch: the machine that refuses to guess** (bubble until EX resolves, `P = 2·B`). Makes the config's three names three _behaviors_ rather than two, and shares step 0's ID classification, so it is nearly free once that lands. **Caveat:** it differs from `static-not-taken` only on _not-taken_ branches, and the corpus is mostly taken — so its corpus swing is thin and its pedagogy is "pays on every branch," not a big number. The alternative (alias of `static-not-taken`) is defensible: a machine with no predictor naturally just keeps fetching PC+4. | _(open)_      |
| **`jal` vs `jalr` under `static-taken`.**         | **`jal` is predicted (PC-relative, computable in ID); `jalr` always pays the full EX penalty** — its target is `rs1+imm`, a register not reliably available in ID. This asymmetry is _why_ `call-return` regresses, so it is load-bearing for the thesis, not a corner case. Verify the arithmetic against M3's pinned 17-cycle figure.                                                                                                                                                                                                                                           | _(open)_      |
| **Is `predicted: boolean` honest under `none`?**  | **Genuinely open — this is M4's add-or-decline-a-field question** (M3 declined three: `maxTier`, renderer delta 2, `LessonStep.requires`). Under `none`-as-stall _nothing was predicted_, so `predicted: false` ("not predicted taken") would let a lesson keying on `predicted === actual` count every not-taken branch as a correct prediction — a lie about a machine that made no prediction. Options: `boolean \| null`, or `none` reports something defined. **Lean: let step 1 force it** rather than deciding on paper.                                                   | _(open)_      |
| **Does the ID bet need its own trace event?**     | **Probably yes, and this is the schema question of the milestone.** `branch-resolved` is an EX-stage event: the _correction_. The ID bet is a different fact at a different cycle, and the datapath (step 5) must draw the redirect in the cycle it happens. INV-3 forbids the view reaching into the engine for it. But M3's pattern says the field that seems needed often is not — try to build step 5 without it first.                                                                                                                                                       | _(open)_      |
| **Conformance matrix size.**                      | **Full cross product** (2 forwarding × 3 prediction = 6 configs × 5 programs = 30 cases). Cheap, and prediction×forwarding interaction is exactly where a squash-vs-forward bug would hide. Revisit only if runtime bites.                                                                                                                                                                                                                                                                                                                                                        | _(open)_      |
| **BTB / zero-penalty correct prediction.**        | **Explicitly deferred, and say so in the UI's honesty budget.** Predicting from PC alone at IF is what buys a 0-cycle correct prediction; it needs a tagged structure and is a fancier tier. M4's correctly-predicted taken branch costs **1**, and that is a _true_ fact about _this_ machine, not a bug (INV-5: lawful omission, never contradiction).                                                                                                                                                                                                                          | _(open)_      |
| **Dynamic prediction (2-bit counters, history).** | **Out of scope.** The config type names only static schemes; adding dynamic ones is a schema change and its own milestone.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | _(open)_      |
| **Relationship to M2 step 5c.**                   | **Independent; 5c stays deferred.** M4 draws an **ID-stage** redirect for speculation. 5c is about the **multi-cycle** model's ALUOut→PC path and its engine-level `alu-op` emission. Neither blocks the other; do not let step 5 quietly absorb 5c.                                                                                                                                                                                                                                                                                                                              | _(open)_      |
