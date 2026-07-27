# Milestone 11 — the deep pipeline (7-stage)

**Status: IN PROGRESS, 2026-07-27. Steps 0, 1, 2 and 3 — THE NET — are DONE; steps 4–8 open. Scope pinned by the user this session
(deep pipeline ALONE — the wider superscalar is explicitly NOT in this milestone, see
"Why this milestone"). ALL decisions are now PINNED (2026-07-27) — the stage split is
Option A, the ALU is uniformly two cycles, and every control transfer resolves at the end
of EX2. The three that gate code are settled, so steps 0–3 are unblocked.**

Source of truth for scope: `cpu-visualizer-spec.md` §12 (roadmap) — with the honest caveat
that **this milestone is past the end of that roadmap**. Tiers 1–5 are complete (M1–M10);
the deeper pipeline comes from the user's standing don't-foreclose flag, recorded in
`docs/memory/future-microarchitectures.md`. The load-bearing constraints are unchanged: the
architectural invariants (§3) and the trace schema (§5).

## Why this milestone, and why now

The spec's roadmap ended at out-of-order and M10 finished its lesson track. The next
direction is the one the user stated back at M3 and has never been built: **longer/deeper
pipelines — 7-stage, 12-stage, more stages than the five phase hues.**

What the previous milestones did NOT exercise:

- **Every model we ship has at most five stage families.** `stageFamily()` and the pipeline
  map were built stage-parametric at M3 step 7 and have been carrying a hand-built
  seven-stage fixture ever since (`pipeline-map.test.ts:504`, `['IF1','IF2','ID','EX1','EX2',
'MEM','WB']`). That file's own header says the deep stage set is _"still genuinely
  unemitted by anything we ship and remains hand-built only."_ **This milestone's job is to
  make that sentence false** — the same way M7 step 6 made it false for the lane axis.
- **Depth as a COST has never been drawn.** M3 taught that forwarding makes the bubble
  vanish. Nothing in the product yet teaches the other half — that the same forwarding, on a
  deeper machine, _stops being enough_.

Why this tier before the alternatives: the user's flag names two axes (depth and width) and
they are different work. **Depth is a new sibling package; width is generalizing M7's
2-specific pairing rules in place** (`superscalar/processor.ts:513` refuses `issueWidth > 2`
by name, because `intra-pair-raw` / `mem-port` / `branch-slot` are written for a pair). One
machine per milestone is the established shape (M7 = superscalar alone, M9 = out-of-order
alone), so the wider superscalar is deferred to its own milestone. **User pinned "deep
pipeline only" 2026-07-27.**

What is cheap because it is shared: the ISA semantics (mirrored from the golden reference,
as every model does), the assembler, the whole corpus, the recorder, every panel, the
transport, the sandbox, and — the one deliberately pre-paid surface — **the pipeline map,
which must need no change at all** (see the falsifiable criteria below).

What is genuinely new: a stage set larger than the five phase hues, emitted by a real
engine; a **two-cycle execute**, which is the first time a producer's result is not ready
for the very next consumer even with forwarding ON; and a front end deep enough that a
misprediction costs double.

## Headline decision — where the two extra stages go

This is the model's soul, because the stage split IS the pedagogy. Options, layered:

**Option A (PINNED 2026-07-27) — `IF1 IF2 ID EX1 EX2 MEM WB`.** Fetch takes two cycles; the
ALU is pipelined into two halves; memory stays one stage.

- Buys **all** the coefficient growths that make a deep pipeline a deep pipeline:
  - misprediction penalty **2 → 4** — four casualties (EX1, ID, IF2, IF1), which follows
    from the pinned resolve-at-EX2. **The TOTAL is 4 under either prediction setting, but
    it does not arrive as one event when prediction is ON — see step 3.** Treat every
    figure in this section as the seeded expectation step 3 must confirm from the dump.
  - **a correctly predicted taken branch costs 2, not 1.** The bet is placed in ID
    (`pipeline/src/processor.ts:1147`), and in a 7-stage an ID bet kills IF2 _and_ IF1. The
    5-stage's single casualty — "the 1 in _a correctly predicted taken branch costs 1, not
    0_" — becomes two. **Depth taxes you even when the prediction is right**, and that is a
    teaching line, not a wart. (Making it cheap again means a predictor in IF1 — a BTB /
    next-line fetch — which is new mechanism and NOT in this milestone.)
  - load-use penalty **1 → 2** bubbles, and — the sharpest one —
  - **ALU→ALU with forwarding ON goes 0 → 1 bubble.** In the 5-stage, forwarding makes
    back-to-back dependents free. Here it cannot: the producer's result is not finished
    until the end of EX2, and the consumer needs it at the start of its EX1. _This is the
    milestone's thesis in one observation, and it is a flagship §12-style interaction: the
    same program, the same forwarding=ON, one model over — and the bubble M3 made vanish
    comes back._
- **Zero interaction with the cache.** MEM stays a single stage, so M6's variable-latency
  freeze (`missCyclesRemaining` freezing IF/ID/EX, emitting _no_ `stall` event) is not in
  the MVP's path at all. That is the scope lever: the freeze meeting a deeper pipe is real
  work with real bugs, and it is quarantined into step 6.
- It is **exactly the fixture the repo has been carrying since M3**, so the map's depth
  support stops being proven against fiction.

**Option B — split IF and MEM (`IF1 IF2 ID EX MEM1 MEM2 WB`).** The textbook MIPS R4000
shape. Rejected for the MVP: it puts the second memory stage directly on top of the M6
miss-freeze, which INV-8 cannot see, in the very first step. Option A gets the same
load-use growth from the EX split without going near it. (Memory depth is not lost — it is
a candidate for a later milestone, not a deferred step of this one.)

**Option C — a configurable depth knob (5↔7) on `engine/pipeline`.** Rejected, and this is
already pinned: `future-microarchitectures.md` says _"Do NOT generalize step-1 model
internals. `PipelineMicro` stays a concrete four-latch shape; forwarding paths stay
enumerated. A deeper pipeline is a future sibling package, not a retrofit."_ Honoured.

**Pinned: Option A.** The scope lever the reviewer signs off on: **the MVP honors
forwarding and prediction only, with no cache** (steps 1–5); **cache is step 6** (droppable
with proof); **the bespoke datapath is step 7** (sheddable, the M9 precedent where the
sheddable half never had to be shed).

## The net — read this before writing the first test

**INV-8 is a false safety net here, again, and worse than at M7.** An in-order 7-stage
retires in order, so `runConformance` passes even if IF2 and EX2 are pure pass-throughs. Add
M10 step 0's precedent (`slowOpLatency` shipped INERT — a config field with no engine
consumer) and the characteristic failure of this milestone is fully specified:

> **a `deep-pipeline` package that typechecks, passes INV-8, renders on the map, and is a
> 5-stage wearing seven labels.**

The discriminator is the timing matrix, and it must be the **coefficients**, not the
constant. The drain constant moving `N+4 → N+6` is cheap — any drain change produces it. The
load-bearing numbers are the per-misprediction and per-hazard penalties above. Hence:

- **Step 3 is the milestone's real net, and it carries a mutation check** (the M10 step 1
  technique): stub IF2/EX2 to pass-through and confirm **INV-8 stays green while the timing
  matrix reddens**. If INV-8 is the only thing that reddens, the net is in the wrong place
  and the step is not done.
- Every number is **dumped from the real engine first, then hand-derived independently as a
  cross-check** (M10 step 3a's shape: the closed form must equal the empirical dump).
  Dumps go under `M:\claud_projects\temp\m11-*`.

## Build order (each step testable before the next)

- [x] **0. Package scaffold + the new-model DAG ripple.** ✅ DONE 2026-07-27.
      `packages/engine/deep-pipeline` (package.json, tsconfig, `src/index.ts`), the workspace
      entry, `tsconfig.json` project references, and — the one that has burned this repo
      before — **`eslint.config.js`: add `'engine-deep-pipeline'` to the `MODELS` constant AND
      add its own deep-pipeline `files` self-exclusion block** beside the other five. This is
      M9+M10 review finding 7 verbatim (`engine-out-of-order` was omitted from four deny lists
      under the old enumerate-per-block shape).
      Acceptance: `tsc -b` and `npm run lint` green, **and** a temporary import of
      `@cpu-viz/engine-deep-pipeline` from a `packages/trace` file errors with the INV-3
      message (then reverted) — the verification the guardrail memory names.

      **What landed, and the two judgement calls made here so later steps do not re-litigate
      them:**
      - **`vitest.config.ts`'s alias landed in THIS step** (it is the runner for every package,
        not a web concern). The **web trio is deliberately NOT here** — `web/package.json`'s
        dependency, `web/tsconfig.json`'s `paths` and `web/vite.config.ts`'s alias all mean
        "the web app knows this model exists", so they belong to step 5 beside `models.ts`.
      - **`src/index.ts` exports only `DEEP_PIPELINE_MODEL_ID` + the docblock.**
        `MODEL_DESCRIPTION` is forced at step 5 per the decisions table, and
        `DeepPipelineProcessor` is step 1's.
      - Test-only edges (`assembler`, `conformance`) live in `tsconfig.json` references and
        **not** in `package.json` dependencies — the asymmetry every other model has.
      - `npm install` was required: a new `workspaces` entry does not create the
        `node_modules/@cpu-viz/engine-deep-pipeline` symlink or update the lockfile on its own,
        and `tsc -b` resolves through that symlink.
      - **CI does not enumerate packages** (`.github/workflows/ci.yml` runs the root scripts),
        so there is no ripple there — checked, since every prior milestone found a guard its
        plan did not name.

      **The guardrail was verified in BOTH directions, not just the one the plan names** — the
      deny list has two distinct code paths and the plan's probe only exercises one:
      - `packages/trace` importing deep-pipeline → the `...MODELS` **spread** path. Errors with
        _"INV-3: the trace is the contract; it may depend only on isa, never on engines…"_.
      - `packages/engine/pipeline` importing deep-pipeline → the `MODELS.filter` **self-
        subtraction** path.
      - **`packages/engine/deep-pipeline` importing `@cpu-viz/engine-pipeline`** → the one that
        actually guards step 1, because step 1 is a FORK of the 5-stage and that is the import
        someone would reach for. Errors with the cross-model message. Without the new
        self-exclusion block this case would have linted CLEAN, since deep-pipeline would fall
        through to the generic `packages/engine/**` rule, which denies only `curriculum`/`web`.
      All three reverted; `npm test` (4051), `typecheck`, `lint`, `build`, `format:check` green.

- [x] **1. The model MVP — `DeepPipelineProcessor`.** ✅ DONE 2026-07-27. Fork `engine/pipeline/src/processor.ts`
      (the M7 extract-then-fork precedent) to seven stages: `IF1 IF2 ID EX1 EX2 MEM WB`, six
      latches, forwarding + branch-prediction knobs honored, and **a non-null `cache` config
      REFUSED by name — never silently ignored** (step 6 owns it; the superscalar's
      `issueWidth > 2` throw at `processor.ts:513` is the shape to copy, and "refusing rather
      than silently running" is the house rule that keeps an unhonored knob from shipping
      inert). Forwarding paths stay
      ENUMERATED, not generalized. Stable ids (INV-4), `location` emitted as the bare stage
      strings.

      Three consequences of the pinned "EX2 is real, uniformly two cycles" that this step
      must implement deliberately rather than discover:
      - **The forwarding paths become `EX2/MEM → EX1` and `MEM/WB → EX1`, enumerated.**
        Operands are consumed at the start of EX1; nothing forwards INTO EX2. That single
        fact is what produces the ALU→ALU bubble.
      - **The interlock watches TWO execute stages.** Today it checks the instruction in
        EX; here a load sitting in EX2 still has no data, so the stall condition is
        "producer in EX1 **or** EX2". Two explicit checks — not a loop over "any execute
        stage", which is precisely the generalization `future-microarchitectures.md` pins
        against.
      - **The two-cycle EX is UNIFORM across all ALU ops.** Non-uniform execute is a
        variable-latency machine — a much bigger animal that starts colliding with M9's
        `slowOpLatency`. The whole timing matrix rests on uniformity, so it is written here
        rather than assumed.
      Acceptance: hand-derived per-cycle walks for a RAW pair, a load-use pair and a taken
      branch pass as unit tests; `capabilities` exported and matching the shipped constant
      shape; **the `location`s emitted on a real program equal
      `['IF1','IF2','ID','EX1','EX2','MEM','WB']` as an ORDERED comparison against
      `map.stages` (first-seen order), not a set equality** — the fixture at
      `pipeline-map.test.ts:505`. Ordered because first-seen order IS the stage order for a
      single-instruction walk, so it catches a latch wired out of sequence that a set
      comparison would pass. This also pins the map's depth support to the engine's real
      encoding (`stageFamily` strips a trailing `\d+`, so `IF-2` or `IF.1` would silently
      mean something else — `.` is the LANE axis).

      **What landed (18 unit tests, repo 4051 → 4069), and the judgement calls later steps should
      not re-litigate:**

      - **The EX split is `EX1 = the forwarding network, EX2 = everything else`.** EX1 resolves the
        two operands and latches them; EX2 runs the ALU switch, emits `alu-op`, resolves control
        flow and builds EX2/MEM. So **`Ex1Ex2Latch` carries OPERANDS, never a result** — the
        ALU→ALU bubble is enforced by the latch's SHAPE, not by a rule someone could forget: there
        is nothing in that latch to forward. `alu-op` therefore fires in the EX2 cycle, not EX1.
      - **IF1 reads the instruction word; IF2 is the second half of the fetch path and does no new
        work.** The honest-looking alternative (IF1 issues the address, IF2 receives the word) was
        REJECTED: an IF1 occupant would then have no `encoding`, and `InstructionInstance.encoding`
        is not nullable — that is the trace-schema change the falsifiable criteria make a STOP.
        IF2's content is DEPTH itself, and it is documented that way rather than hidden.
      - **The new stall reason is `'ex-latency'`.** Not `'raw'` (pinned repo-wide to mean
        "forwarding is off" — `pairing-readout.ts:121`, `lessons.test.ts:51`) and not `'alu-use'`
        (`lui`/`auipc`/`jal` stall a consumer while emitting no `alu-op`, because the two-cycle
        execute is uniform). `stall.reason` is a free string and `pairing-readout` returns `null`
        for reasons it cannot gloss, so nothing downstream breaks.
      - **The interlock is three checks under forwarding, three without.** ON: load in EX1, load in
        EX2 (`'load-use'`), any other producer in EX1 (`'ex-latency'`). OFF: producer in EX1, EX2
        or MEM (`'raw'`). Enumerated, never a loop over "any execute stage".
      - **The halt squash kills TWO shadows** (IF2 + IF1), where the 5-stage kills one. Pinned by a
        test whose shadow is `sw x1, 0(x0)` — a survivor would corrupt the program's own first word.
      - **The empty-`stages` guard is needed on the BET path too, not just the squash.** Under
        prediction=ON the correction's EX1/ID slots are routinely bubbles left by the earlier bet,
        so the four occupancy checks are the common path, not paranoia. A test walks every flush in
        every program and asserts each named stage has an occupant (step 4's assertion, paid early).
      - **The ordered stage assertion is computed INLINE, not via `buildPipelineMap`** — an engine
        importing `@cpu-viz/web` is the INV-3 deny path step 0 verified. Three lines duplicated
        beats crossing the DAG.
      - `state` is the **POST-EDGE** snapshot (the house convention, shared with the 5-stage): it
        shows the latches as they will present to the NEXT cycle, not the occupancy
        `instructions[]` reports for this one.
      - **The mutation check step 3 will run is now written down in the file header**, because with
        this split it is not a one-line edit: "stub IF2" = collapse the IF1/IF2 latch so IF1 hands
        straight to ID; "stub EX2" = move the switch back into EX1 and let `ex1Ex2` carry the
        finished result.

      **Every PER-HAZARD coefficient was hand-derived from the pinned semantics and matched the
      engine on the first run** (nothing was adjusted to fit): ALU→ALU forwarding-ON **1** bubble,
      load-use **2**, forwarding-OFF RAW **3**, unpredicted taken branch **one flush of width 4**,
      correctly predicted taken **2**, and — the plan's flagged trap, now CONFIRMED rather than
      expected — a mispredicted branch under prediction=ON arrives as **two flush events of width
      2**, totalling 4. The drain constant N+6 is confirmed on the no-`ecall` path.

      **This does NOT pre-verify step 3.** These are isolated hand-built pairs; step 3's assertion
      is the closed form `N + 6 + S + P` over the **full corpus × forwarding × prediction**, where
      hazards interact, loops repeat them, and the flush shapes mix. Step 3 is still the net.

      **A THIRD flush shape exists that the step-3 trap paragraph does not name, and it is not an
      over-report** — pinned by a test here (`JALR_OVER_A_BET`). An unpredictable `jalr` correcting
      one cycle after a younger PREDICTABLE branch bet finds EX1 and IF1 occupied with ID and IF2
      emptied by that bet: **`flush.stages` is `['EX1','IF1']`, not a contiguous run.** So step 3
      must read the misprediction penalty as a TOTAL and never assume a shape, and step 4's
      occupancy assertion is what keeps the distinction honest. `buildPipelineMap` is unaffected —
      it resolves each named stage independently.

      `jal`/`jalr` are covered here too (`CALL_RETURN`), including the flush-that-kills-NOBODY path:
      the `ret` corrects with all four squashable slots already empty, so no event is emitted at all.

      **One thing for step 4 to check BEFORE starting it:** it wants a real-engine case inside
      `pipeline-map.test.ts`, but step 0 deliberately deferred `web/package.json`'s dependency and
      `web/tsconfig.json`'s `paths` to step 5. Vitest will resolve the import (that alias landed at
      step 0) while `npm run typecheck` likely will not — so step 4 may have to move after step 5.

- [x] **2. Differential net: `runConformance(() => new DeepPipelineProcessor())` (INV-8).**
      ✅ DONE 2026-07-27. Full corpus, final architectural state.
      Acceptance: green — **and the step's own docblock states in prose that this proves
      nothing about depth**, naming step 3 as the net that does. (An acceptance line that
      overstates its own coverage is how the inert-package failure ships.)

      **What landed (68 tests, repo 4072 → 4140), green on the first run, and the judgement calls:**
      - **The matrix is 6 configs, not the house 18/36 — because the cache axis is absent BY
        REFUSAL, not by omission**, and the docblock says so in those words. This is the one suite
        where "restoring" the missing axis to match `pipeline`'s (2×3×3) would produce **thrown
        Errors, not red assertions** — a failure that reads as a broken suite rather than as the
        deliberate step-6 scope lever. When step 6 pins the miss-freeze seam, the third axis and the
        throw go away together.
      - **`cache: null` is written EXPLICITLY rather than inherited from `defaultConfig()`.** Every
        other model's matrix can afford to inherit a default it ignores; here the field is
        load-bearing in the NEGATIVE (the processor throws on non-null), so a future change to
        `defaultConfig()`'s default would turn six green cases into six thrown Errors rather than
        into a silent behaviour shift. Verified `defaultConfig()` returns `cache: null` today
        (`trace/src/processor.ts:138`) — the field is named anyway.
      - **The docblock's "what this DOES catch" is the FORK argument, and it is sharper here than
        for a from-scratch model.** Step 1 is a fork = a COPY of the 5-stage's mirrored ISA
        semantics; a dropped `>>> 0`, a `>>` for `>>>`, a missing `imm & 0x1f` is caught here and
        nowhere else, and transcription error is the characteristic failure of how this subject was
        built. Plus the two hazard classes a longer shadow widens: under-stall and speculation leak
        (the flush kills FOUR slots where the 5-stage kills two).
      - All three prediction schemes run even though **`'none'` and `'static-not-taken'` are the
        SAME MACHINE here** (the 5-stage's identity, recorded on `DEEP_PIPELINE_CAPABILITIES`). The
        redundant column is KEPT and the identity documented, so two identical green columns read as
        expected rather than as a bug — and `configLabel` names the two distinctly, so there is no
        title collision to hide behind (the M9+M10 finding-8 class).
      - **No cache-refusal assertion here** — `processor.test.ts`'s "refuses a cache config by name"
        already owns that contract, and duplicating it blurs which file does. Not widened to
        `issueWidth`/`outOfOrderIssue` either: capabilities declare both false, and refuse-vs-ignore
        for those is a step-1 question, not this step's.

      **The guardrail check step 0 had NOT exercised, run here: `deep-pipeline` →
      `@cpu-viz/engine-conformance` LINTS CLEAN, as intended.** Step 0 verified three deny paths but
      only model→model and trace→model; this is the first import of the harness that transitively
      pulls in the **golden reference**, which the deny list names by id. It is allowed because
      ESLint sees direct import specifiers only, and `engine-conformance` is not in
      `[curriculum, web, engine-reference, ...MODELS.filter(≠self)]` — the same edge every other
      model's `differential.test.ts` already has. Confirmed by running lint, not assumed from the
      tsconfig reference being present (finding 7 was precisely a deny-list-SHAPE bug).
      `tsc -b` was run as its own check beside vitest — they resolve the import by different routes
      (project reference vs root alias) and fail for different reasons. Both green.

      **Repo count reconciliation for later steps: the baseline was 4072, not the 4069 the step-1
      notes record** — that figure was taken at step 1's first commit, and the follow-up
      `test(deep-pipeline): cover jal/jalr, and pin a THIRD flush shape` commit added three more.

- [x] **3. THE NET — the timing matrix and its mutation check.** ✅ DONE 2026-07-27. A `timing.test.ts` in the
      house shape (M3/M6/M7 precedent): every corpus program × forwarding × prediction, with
      a closed form `cycles = N + 6 + S + P` whose **S and P coefficients are the deep
      machine's, not the 5-stage's**. Dump from the engine, hand-derive independently,
      cross-check the two.

      **The prerequisite decisions are PINNED (2026-07-27): resolve at the end of EX2, and
      EX2 is a real half-ALU with a uniformly two-cycle execute.** Every coefficient below
      follows from those two and from nothing else. Derive the misprediction penalty from
      the dumped **`flush.stages`** payload rather than by counting stages ahead of EX, and
      derive the ALU→ALU 0→1 from "operand needed at start of EX1, result ready at end of
      EX2" — the enumerated forwarding path step 1 wires, not the diagram.

      **The trap in that payload — expect it, or you will read it as a bug.** The
      misprediction TOTAL is 4 either way. Its SHAPE is expected to depend on prediction as
      below — **but that shape is a PREDICTION, not a derived fact**: it assumes step 1
      keeps the 5-stage's redirect-and-refetch behaviour at the bet, which is step 1's
      implementation choice, not something read out of the existing engine. Confirm the
      shape from the dump; if it differs, the flush contract is the thing to examine, not
      this paragraph.
      - **prediction OFF:** the branch reaches EX2 and kills EX1 + ID + IF2 + IF1 — **one
        flush event, `stages` of width 4.**
      - **prediction ON, taken branch:** ID bets at cycle _t_ and kills IF2 + IF1 (2). By
        the time the branch reaches EX2 at _t+2_, EX1 and ID hold **bubbles left by that
        earlier flush** — there is nobody there to kill — so the correction kills IF2 + IF1
        again. **Two flush events of width 2**, totalling the same 4.

      **Step 1 CONFIRMED both shapes above from the engine — and found a THIRD the paragraph does
      not name.** An unpredictable `jalr` correcting one cycle after a younger predictable branch
      bet emits a NON-CONTIGUOUS `['EX1','IF1']`: the bet emptied ID and IF2 but refilled IF1.
      `flush.stages` is therefore not always a contiguous run of stages.

      So the total is the robust number for the closed form; `flush.stages` widths AND shapes are
      config-dependent and must be read per-setting, never assumed. This is also why step 4's
      occupancy assertion is load-bearing rather than paranoid — see there.

      The numbers printed elsewhere in this plan (ALU→ALU forwarding-ON 0→1, load-use 1→2,
      forwarding-OFF RAW 2→3, misprediction 2→4, correctly-predicted-taken 1→2) are the
      seeded EXPECTATION and nothing more.
      **Hand-derive from the pinned decisions, never from these figures** — otherwise the
      "independent cross-check" is just re-reading the plan's own guess back to itself.
      Acceptance: matrix green from hand-derived cells; **plus the recorded mutation check —
      stubbing IF2/EX2 to pass-through leaves INV-8 green and reddens this suite.** If it
      does not, stop and surface it.

      **What landed (92 tests, repo 4140 → 4232), and the judgement calls later steps should not
      re-litigate:**

      - **The closed form is `cycles = N + 6 + S + P` and it balances in all 66 dumped cells — but
        `S` is stall cycles ON THE RETIRED PATH, not the raw stall count.** All eleven programs'
        stall histograms were hand-derived from the recurrence (required distance: 4 forwarding-OFF,
        3 for a load producer with forwarding ON, 2 for any other) BEFORE being compared to the
        engine, and matched cell-for-cell. The corroboration that fell out afterwards: every `P` is
        exactly **2×** the 5-stage's pinned `P` for the same program × scheme.
      - **THE FINDING — `S` is NOT prediction-invariant, and the 5-stage's ported assertion would
        have been WRONG.** `engine/pipeline`'s P matrix asserts `S — the forwarding toggle, untouched
        by prediction` in every cell. **Depth breaks it.** `call-return.s` at forwarding OFF emits a
        `'raw'` stall at pc 12 (the `jal`'s fall-through) under the not-taken behaviour that does not
        exist under `static-taken`. The mechanism is the pinned resolve point itself: a transfer
        resolves at the end of EX2, so its fall-through gets a whole LIVE cycle in ID — a cycle where
        `ctx.squash` is still null and the interlock really runs — before being killed. The 5-stage
        **cannot** do this: it resolves at `d_b+1`, so its fall-through hits ID in the same cycle as
        the squash and takes `stageId`'s early-return. Under `static-taken` the bet kills the same
        instruction in IF2, two stages before the interlock. **The stall costs zero cycles** (the
        redirect is timed off the branch's own EX2), which is why the closed form is stated over the
        retired path and BOTH histograms are pinned separately — the raw one catches an engine that
        stalls in the wrong places, the retired one balances the count. Bounded by its own test: it
        is the ONLY cell in the corpus where the two disagree.
      - **A FOURTH and FIFTH flush shape, and the shape depends on the FORWARDING toggle too.** The
        same shadow stall leaves EX1 a bubble, so `call-return.s`'s `jal` correction emits
        `['ID','IF2','IF1']` at forwarding OFF and `['EX1','ID','IF2','IF1']` at forwarding ON —
        non-contiguous in the opposite direction from step 1's `['EX1','IF1']`. The corpus also
        yields `['EX1','ID']` (a loop at the end of `.text` whose branch stalls long enough to drain
        the front end) and a width-1 `['IF2']`. Five distinct payloads, pinned as a census.
      - **The 5-stage's `casualties ARE the penalty` identity does NOT port, and the reason is worth
        more than the identity was.** `sum-loop.s` under not-taken kills 18 and pays `P = 36`: the
        deep pipe pays its full 4-cycle penalty even when the front end has already emptied itself.
        Pinned as the negative, WITH the two programs where the two still coincide exactly
        (`array-sum.s`, `paired-branches.s`) so it does not read as a rule in the other direction.
      - **The `+6` constant needed a HAND-BUILT program.** The 5-stage isolates its `+4` on `add.s`;
        that no longer works, because this machine stalls `add.s`'s back-to-back pair even with
        forwarding ON. **The corpus has no dependency-free program left to measure the constant with
        — depth took it away**, which is itself the thesis.
      - The reason-encoding test could not be ported either: forwarding ON now has **two** reasons
        (`'load-use'` AND `'ex-latency'`), where the 5-stage asserts a single-element set.
      - Cross-model numbers (the 5-stage's `S`, `P` and cycle counts) are quoted in PROSE only —
        `eslint.config.js` denies a model importing a sibling model, and that edge should stay denied.

      **THE MUTATION CHECK, run as TWO separate mutations, both halves executed rather than argued**
      (`differential.test.ts` was actually RUN under each stub, not assumed green from the prose in
      two files). Reverted with `git checkout` so the revert is exact rather than retyped:
      - **Stub IF2** (`stageIf1` writes `next.if2Id` directly): **INV-8 green 68/68, timing RED 55 of
        92.** The constant fell to `N+5`, misprediction 4→3, correct bet 2→1.
      - **Stub EX2** (the switch moved into EX1, `ex1Ex2` carrying the finished latch, an
        `EX1/EX2 → EX1` forward added, **and the `'ex-latency'` arm dropped from `detectHazard`** —
        without that last part the bubble survives and the reddening is under-read): **INV-8 green
        68/68, timing RED 58 of 92.** `add.s` at forwarding ON fell 10 → 9 cycles (its `S` 1 → 0),
        `sum-loop.s` 87 → 67, misprediction 4→3.
      - **What the EX2 stub does NOT move, recorded so it is not over-claimed:** load-use stays at 2
        and forwarding-OFF RAW stays at 3. Both are governed by when MEM and WB happen, and a stubbed
        EX2 still OCCUPIES its cycle — seven stages remain. Only the coefficients that depend on
        *when the result is finished* move. Collapsing the stage entirely is a different mutation.

      Dump rig and both mutation dumps under `M:\claud_projects\temp\m11-timing\`.

- [ ] **4. Recorder / time-travel + the map meets a real deep engine.** `follow()`, scrub,
      and back-stepping over the new model (the per-model recorder test every tier has).
      Then the payoff: extend `pipeline-map.test.ts`'s last describe with a **real-engine**
      seven-stage case beside the hand-built one — the M7 step 6 move for the lane axis,
      applied to the depth axis — and update that file's header, which currently asserts the
      deep stage set is unemitted.
      **Also assert here that every stage named in a `flush` event HAS an occupant that
      cycle.** `buildPipelineMap` resolves victims with a singular
      `trace.instructions.find((i) => i.location === stage)`, so a flush naming a stage
      nobody occupies (a drained IF2, say) returns `undefined` and the victim is silently
      unrecorded. That would not be a map bug — it is the signal that the engine's
      `flush.stages` payload OVER-REPORTS, and it is exactly where the "map needs no change"
      criterion could be quietly falsified. Make it fail loudly as an engine bug.
      **This is not paranoia, it guards the common path.** The 5-stage filters casualties
      with two explicit null checks (`pipeline/src/processor.ts:546-547`); the deep engine
      needs FOUR — and under prediction=ON, two of those four slots genuinely _are_ bubbles
      on every correctly-bet branch (step 3's flush-shape note). An engine that pushes stage
      names unconditionally over-reports on the most frequent case, not a rare one.
      Acceptance: a real recording folds to **7 stages / 5 families**; `hasOverlap` true;
      every flushed stage has an occupant; **`pipeline-map.ts` itself is UNCHANGED** (see
      falsifiable criteria).

- [ ] **5. Web enablement.** A `models.ts` entry (id, label, the engine's OWN exported
      `MODEL_DESCRIPTION` constant per the superscalar/OoO precedent, `capabilities`), with
      **`datapath: 'none'`** — the deliberate superscalar/OoO pattern, since a `DatapathKind`
      means "a diagram of this kind EXISTS" and flipping it early makes `models.test.ts`
      assert a diagram nothing drew. Panels, transport, scrub, lessons and the sandbox come
      free via INV-3. Grep for glob-vs-hardcoded guards beyond the named list before calling
      it done — every prior milestone found one its plan did not name.
      **Picker POSITION is part of this step, and it is not free.** `deep-pipeline` goes
      **between `pipeline` and `superscalar`** (teaching order — depth is the next thing
      after the 5-stage, and the picker order is user-visible forever). The ripple is wider
      than the obvious one: `models.test.ts:16` pins the full id list, **and** the
      `honoring()` capability assertions (~lines 74–96) enumerate ids in ARRAY order too, so
      inserting mid-array shifts three or four expectations rather than one. Mechanical, but
      budget for it instead of discovering it.
      Acceptance: the model picker drives it end-to-end, and a **browser pass** confirms the
      map draws seven columns with five hues and the flagship comparison reads live: the same
      program at forwarding=ON on `pipeline` vs `deep-pipeline`, with the reappearing bubble
      visible as a SHAPE (the M3 `walkAt` framing) and the cycle counts differing.
      ([[browser-is-the-only-net]]: no headless test here can see a click.)

- [ ] **6. Cache on the deep pipeline (the third knob) — or DROPPED WITH PROOF.** M6's
      miss-freeze meets a machine with two execute stages: `missCyclesRemaining` freezes
      IF/ID/EX, and which of IF1/IF2/EX1/EX2 freeze — and whether an in-flight EX2 completes
      — is a CHOICE with no external ground truth, exactly like M9 finding F9's
      `fuFreezesDuringMemStall()` seam. Pin the choice with a named seam + parity test rather
      than letting it be implicit. If the dump shows it is purely mechanical, drop it with
      proof and say so (the M10 step-6 precedent).
      Acceptance: the fwd × predict × cache matrix green with hand-derived cells, or a
      written drop with the dump that justifies it.

- [ ] **7. Bespoke datapath (SHEDDABLE).** A `datapath-deep-pipeline.ts` geometry+activation
      module (pure, tested) + view wrapper + render smoke test + browser eyeball, then flip
      `datapath` in `models.ts` and add the union member. Per
      `docs/templates/new-model-datapath.md`. Note the M7 pin: **wire stroke = STAGE, node
      tint = LANE, follow ring = IDENTITY** — and with seven stages the stroke palette must
      colour by stage FAMILY, the same rule the map follows, never by inventing hues.
      Acceptance: browser-verified against a dumped trace at a named cycle.

- [ ] **8. Browser pass over the whole milestone** — the house closing step. Drive the
      SHIPPED `vite preview` bundle (not the dev server) via CDP; rig under
      `M:\claud_projects\temp\m11-browser\`. Identify the target by served `<title>`, never
      by port; `taskkill /PID <pid> /T` to clean up.

## Acceptance criteria (mirror the spec §11 shape)

- [ ] Load `sum-loop.s` on **Deep pipeline**, run to the end, and the pipeline map draws
      **seven stage columns in five hues**, each cell's text naming its exact stage.
- [ ] The same program at **forwarding ON** takes strictly more cycles on `deep-pipeline`
      than on `pipeline`, and the map shows a **repeated EX1 cell** on a back-to-back
      dependent pair that the 5-stage draws with no repeat — forwarding no longer buying a
      free result.
- [~] Flipping **forwarding OFF** and **prediction** on the deep model changes cycle counts
  by the deep machine's coefficients, matching hand-derived numbers. **Proven HEADLESSLY at
  step 3** (66 hand-derived cells, both toggles, every term asserted separately); the LIVE half
  — the same flips read in the browser — is step 5's acceptance and is still owed.
- [ ] Follow an instruction (INV-4) across all seven stages; scrub backwards and forwards
      and the map, registers, memory and source panels all agree at every cursor.
- [x] **INV-8 differential passes on the full corpus** for the new model. ✅ step 2,
      2026-07-27 — 6 configs × 11 programs, green on the first run.
- [x] **The timing matrix reddens when IF2/EX2 are stubbed to pass-through, while INV-8 stays
      green** — the recorded mutation check. ✅ step 3, 2026-07-27. **BOTH halves executed**, as two
      separate mutations: stub IF2 → INV-8 green 68/68, timing RED 55/92; stub EX2 → INV-8 green
      68/68, timing RED 58/92. `differential.test.ts` was RUN under each stub rather than assumed
      green from the prose already sitting in two files.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run format:check`
      all green.

### Two falsifiable "unchanged" criteria (both pre-paid — reaching for either is a STOP)

- [ ] **`packages/web/src/pipeline-map.ts` needs no change.** It was built depth-parametric
      at M3 step 7 and the fold is model-knowledge-free by design.
- [ ] **The trace schema needs no change.** `location` is a plain string precisely to absorb
      this axis (`"IF2"` = depth, `"EX.0"` = lane).

If either is reached for, stop and surface it as a decision rather than editing — that is the
INV-3 back door, and the house precedent is to DECLINE and prove it (M7 declined an `issue`
event, M10 declined a `rename` event, each with a written proof).

## Decisions — ALL PINNED 2026-07-27

The nine seeded rows plus the three the table was missing (uniform EX, where the bet is
placed, picker position) were walked through with the user on 2026-07-27, pros and cons per
row, and pinned as recommended. **The three that gate code —
the stage split, EX2-is-real, and the resolve point — are settled, so steps 0–3 can start.**
The rest are pinned but only _forced_ at the step that consumes them (noted per row).

| Decision                                  | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Pinned answer                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Depth vs width for M11                    | Deep pipeline alone; width is a separate milestone (different work — pairing rules in place, no new package)                                                                                                                                                                                                                                                                                                                                                                                                  | **Deep pipeline alone** (user, 2026-07-27)                              |
| The stage split                           | Option A: `IF1 IF2 ID EX1 EX2 MEM WB` — both coefficient growths, no cache interaction, matches the M3 fixture                                                                                                                                                                                                                                                                                                                                                                                                | **Option A** (user, 2026-07-27) — gates step 1                          |
| Is EX2 a real half-ALU or a latch?        | Real: the result is not available until end of EX2. This is the whole thesis; a "free" EX2 is the inert-package failure                                                                                                                                                                                                                                                                                                                                                                                       | **Real** (user, 2026-07-27) — gates step 1                              |
| Is the two-cycle EX uniform across ops?   | **Yes.** Non-uniform execute is a variable-latency machine — a bigger animal that collides with M9's `slowOpLatency`. The whole timing matrix rests on this, so it is written not assumed                                                                                                                                                                                                                                                                                                                     | **Uniform** (user, 2026-07-27) — gates step 3                           |
| Where a branch resolves                   | End of **EX2**. Not for the clean 2→4 doubling (aesthetic) but structurally: `pipeline/src/processor.ts:784` resolves every branch AND jump at one point, and JALR's target comes out of the ALU, which is now two cycles. Resolve-at-EX1 buys one cycle of penalty in exchange for a SECOND resolve point (two rules) or a dedicated fast adder for JALR. EX2 makes one sentence — _nothing is ready until the end of EX2_ — explain the branch penalty, the ALU→ALU bubble and the load-use penalty at once | **End of EX2** (user, 2026-07-27) — gates step 3                        |
| Where the branch BET is placed            | **ID, unchanged from the 5-stage** ⇒ a correctly predicted taken branch costs 2, not 1. Making it cheap again needs an IF1 BTB — new mechanism, out of scope. Keep the tax; it teaches                                                                                                                                                                                                                                                                                                                        | **ID** (user, 2026-07-27) — gates step 3                                |
| Model id / label                          | `deep-pipeline` / "Deep pipeline"; description exported as the engine's OWN `MODEL_DESCRIPTION` constant, carrying "7-stage" so the picker's "Pipeline" / "Deep pipeline" pair is not mushy                                                                                                                                                                                                                                                                                                                   | **As seeded** (user, 2026-07-27) — forced at step 5                     |
| Picker POSITION in `MODELS`               | Between `pipeline` and `superscalar` (teaching order). Pay the ordered-assertion churn in `models.test.ts` — appending at the end would dodge it but put a 7-stage after out-of-order                                                                                                                                                                                                                                                                                                                         | **After `pipeline`** (user, 2026-07-27) — forced at step 5              |
| Cache support                             | Step 6, behind the MVP; the freeze/EX2 interaction pinned by a named seam + parity test (the M9 F9 shape), or dropped. Step 1 REFUSES a non-null cache config by name so it cannot ship inert either way                                                                                                                                                                                                                                                                                                      | **Step 6, decide after step 3's dump** (user, 2026-07-27)               |
| Bespoke datapath                          | Step 7, sheddable; `datapath: 'none'` until it actually exists (superscalar/OoO precedent)                                                                                                                                                                                                                                                                                                                                                                                                                    | **As seeded** (user, 2026-07-27) — decide when steps 0–5 are behind you |
| A lesson track for the deep pipeline      | NOT in this milestone. M11 = model + view, the M9 shape; the track is its own milestone, the M10 shape. Step 5's acceptance already requires the flagship comparison to read live in the browser — the lesson's content without the lesson                                                                                                                                                                                                                                                                    | **Deferred to its own milestone** (user, 2026-07-27)                    |
| Memory depth (`MEM1`/`MEM2`) / a 12-stage | Not deferred within M11 — a candidate for a LATER milestone. Option A deliberately does not open it                                                                                                                                                                                                                                                                                                                                                                                                           | **Later milestone, not an M11 step** (user, 2026-07-27)                 |
