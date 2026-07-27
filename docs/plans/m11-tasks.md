# Milestone 11 — the deep pipeline (7-stage)

**Status: ✅ COMPLETE, 2026-07-27. All steps 0–8 are DONE and every acceptance criterion is
ticked.** The deep pipeline ships as a sixth model: a seven-stage engine (`IF1 IF2 ID EX1 EX2 MEM
WB`), its timing matrix, its recorder, its web enablement, its cache, and its own datapath — with
both falsifiable "unchanged" criteria PAID OUT (`pipeline-map.ts` untouched at step 4; the trace
schema untouched at step 7, where the temptation was reached and declined). **Step 8 drove the
SHIPPED `vite preview` bundle over the whole milestone: 76 checks, all pass, no defect** — which
also excludes the stale-`dist` build failure that step 5 could only exclude for the dev server.
The milestone's three view defects were all found by a browser and by nothing else: PROSE at step
5 (a tooltip stating the 5-stage's coefficients), a control LABEL colliding with its own wire stubs
at step 7, and — the one that was not a view defect at all — step 6a's correctness bug in the
shipped 5-stage and superscalar, where a cache miss could change the ANSWER.

**Historical status note (superseded, kept for the trail): Steps 0, 1, 2, 3 — THE NET — 4 and 5 are DONE; steps 6–8 open.
The deep pipeline is now DRIVABLE in the browser, and step 5's browser pass read every hand-derived
number live. It also found the one defect of the milestone so far, and it was PROSE: two config
tooltips stated the 5-stage's coefficients on a machine whose coefficients are double.
Step 4 also carried the web trio (dependency, tsconfig `paths`, vite alias) that step 0 had deferred,
and PAID OUT the first falsifiable "unchanged" criterion: `pipeline-map.ts` absorbed a real
seven-stage recording untouched. Scope pinned by the user this session
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

      **The authority for this machine's timing is `timing.test.ts`'s `TIMING` table, NOT a dump
      file.** The step-3 dump rig was scratch and has been deleted, and the baseline dump was
      deliberately deleted with it rather than left lying in `M:\claud_projects\temp\m11-timing\`:
      the last thing that rig wrote was MUTATION-2 output (a stubbed EX2 — `add.s` at 9 cycles,
      `sum-loop.s` at 67), so a file called `dump.txt` sitting there would read as the real machine
      to whoever opens it at step 6. Only `dump-mutation2-stubEX2.txt` survives, named for what it
      is. Every number in the `TIMING` table is hand-derived AND asserted, which no dump ever was —
      **step 6's "decide after step 3's dump" means that table.**

- [x] **4. Recorder / time-travel + the map meets a real deep engine.** ✅ DONE 2026-07-27. `follow()`, scrub,
      and back-stepping over the new model (the per-model recorder test every tier has).
      Then the payoff: extend `pipeline-map.test.ts`'s last describe with a **real-engine**
      seven-stage case beside the hand-built one — the M7 step 6 move for the lane axis,
      applied to the depth axis — and update that file's header, which currently asserts the
      deep stage set is unemitted.
      **The engine-side half of the flush-occupancy assertion LANDED AT STEP 3** — `timing.test.ts`'s
      `every stage a flush names really has an occupant that cycle` sweeps the whole corpus × both
      toggles. **Step 4 owns only the `buildPipelineMap` side**: that the map actually RECORDS a
      victim for each named stage. The paragraph below is why it is load-bearing on both sides; do
      not re-derive the engine sweep.

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

      **What landed (19 tests, repo 4232 → 4251), and the judgement calls later steps should not
      re-litigate:**

      - **The web trio moved into THIS step, and step 1's flagged question is resolved: step 4 did
        NOT have to move after step 5.** `web/package.json`'s dependency, `web/tsconfig.json`'s
        `paths` and `web/vite.config.ts`'s alias all landed together, because step 4's own acceptance
        lives in `packages/web` and none of the three is user-visible without a `models.ts` row
        (`models.test.ts:16` pins the id list literally, so there was zero test churn). They are
        checked by DIFFERENT gates — vitest resolves through the root alias, `npm run typecheck`
        through `paths`, `npm run build` through the vite alias — which is precisely why splitting
        them is how one gets forgotten, the failure the M7 comment in `vite.config.ts` records.
        **Step 5 still owns the `models.ts` row, `MODEL_DESCRIPTION`, picker position and the
        `honoring()` churn** — nothing of step 5's content was consumed here.
      - **THE ACCEPTANCE CRITERION NAMED THE WRONG STAGE, and it is corrected above.** Criterion 2
        said the map shows a **repeated EX1 cell** on a back-to-back dependent pair. It does not:
        `stageId` re-presents its occupant onto the latch it arrived on (`stall.stage: 'ID'`), so
        `add.s`'s dependent pair walks `IF1 IF2 ID ID EX1 EX2 MEM WB` — a repeated **ID**, with each
        execute stage visited exactly once. Hand-derived, then confirmed. **Step 5's browser pass
        must look at the ID column, not EX1.**
      - **The map-side flush assertion is stated FALSIFIABLY**: the number of stage names the
        recording flushes equals the number of rows the map marks killed, swept over the corpus ×
        forwarding × prediction (four positions, all non-vacuous). `buildPipelineMap` resolves a
        victim with a singular `find`, so an over-reporting payload silently records NOTHING — which
        a per-stage "did this one resolve?" phrasing cannot see. The engine side stays step 3's.
      - **"Seven in flight" is pinned WITH its honest negative, because the reflex claim is false for
        two of the eleven programs.** `array-sum` holds 7 on the deep machine against the 5-stage's
        5; but `byte-loads` (a chain of load-use pairs) and `paired-branches` (mostly flushes) hold
        exactly **5 on BOTH**. Occupancy is set by the program's hazards, not by the stage count, so
        `deep.maxInFlight > five.maxInFlight` is NOT asserted corpus-wide — the same shape as step
        3's finding that the 5-stage's "casualties ARE the penalty" identity does not port.
        `sum-loop` also never fills the pipe (it peaks at 6), which is why the stages/families
        fixture test does not assert occupancy at all.
      - **The recorder test's new claim is the STALL SHAPE, not the walk.** One interlock holds
        THREE cells at once — `ID ID ID ID`, `IF2 IF2 IF2 IF2` and `IF1 IF1 IF1 IF1` — where the
        5-stage holds two. The middle one exists only because the front end is two deep, and it is a
        SECOND place the INV-4 re-fetch breach could happen that the 5-stage never exercised. Pinned
        with the fetch census (five instructions, five `instr-fetch` events, five ids ever seen) and
        with the three `stall` events all naming the ONE instruction in ID — the two behind it are
        blocked, not stalling in their own right.
      - **`sum-loop`'s per-iteration walk is asserted with consecutive repeats COLLAPSED**, which is
        where the recorder test parts company with the 5-stage's. There `S_on = 0` and every walk is
        literally five cycles; here the first iteration's `add` pays the ALU→ALU bubble, so the claim
        is the SEQUENCE (all seven stages, in order, never revisited) and `timing.test.ts` keeps the
        count. Guarded by "exactly one of the ten walks is longer than seven cycles", so the collapse
        cannot hide an engine that never stalls.
      - **`micro` covers SIX of the seven stages** (six latches), where the 5-stage's equivalent
        covers four of five. IF1 is the one stage with no latch behind it.
      - **Both stale "the deep stage set is unemitted" comments were corrected, not just the header
        one** — the file's own M7-era note says a comment asserting a case is unreachable is how the
        case stops being checked, and leaving the mid-file copy would have been that bug again in the
        same file.
      - Everything hand-derived before running. The recorder suite was green on the first run; the
        map suite needed two corrections, both mine and both mechanical — `hasOverlap` takes the
        RECORDING rather than the map, and `sum-loop`'s `maxInFlight` is 6, which is what turned up
        the occupancy negative above.

- [x] **5. Web enablement.** ✅ DONE 2026-07-27. A `models.ts` entry (id, label, the engine's OWN exported
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
      **Two things step 4 pinned that this step must use rather than re-derive:** the bubble is
      a **repeated `ID` cell, NOT EX1** (the acceptance criterion was corrected — look at the
      right column), and `add.s` is the sharpest program for it (7 cycles on `pipeline` vs 10
      here, walk `IF ID EX MEM WB` vs `IF1 IF2 ID ID EX1 EX2 MEM WB`). Also note `sum-loop`
      peaks at **6** in flight, not 7 — `array-sum` is the program that genuinely fills the
      pipe, if the browser pass wants to show seven occupied columns at once.
      **The web trio (dependency, `paths`, vite alias) is ALREADY DONE — it landed at step 4.**
      What is left here is the `models.ts` row, `MODEL_DESCRIPTION`, the picker position and
      the `models.test.ts` ordered-assertion churn. Two first-moves for this step: - **The vite alias is still untested in the direction the M7 comment warns about.** Step
      4's `npm run build` proves it parses, but nothing in the shipped bundle imports
      `@cpu-viz/engine-deep-pipeline` yet — there is no `models.ts` row. So the "dev server
      silently resolves through the workspace symlink to a stale `dist`" failure has not been
      excluded. Once the row exists, confirm the dev server picks up a source edit to
      `deep-pipeline/src/processor.ts` with no rebuild. Costs nothing then; invisible now. - **The `honoring()` churn is TWO list edits plus line 16, and the interesting one is the
      list it does NOT join.** `deep-pipeline` declares `configurableForwarding` and
      `configurableBranchPrediction` true, so it inserts into both of those (between
      `pipeline` and `superscalar`); `configurableCache`, `configurableIssueWidth` and
      `configurableOutOfOrder` are all false, so those three lists are untouched. A reader
      will ask why the model that honors forwarding and prediction is missing from the cache
      list — **leave a one-line comment there pointing at step 6's refusal**, in the same
      spirit as the OoO row's "DELIBERATELY does NOT join forwarding" note, so it reads as
      the scope lever it is rather than as an omission.

      **What landed (14 tests, repo 4251 → 4265), and the judgement calls later steps should not
      re-litigate:**

      - **THE ROW MADE A LIVE CRASH REACHABLE, and the fix lands with it.** The shell holds the cache
        geometry at SESSION level and hands the whole config to whichever engine drives — safe for
        five models, because a knob a model does not honor is a knob it IGNORES. **`deep-pipeline` is
        the first shipped engine that REFUSES one** (step 1's cache guard), so `pipeline` with the
        cache on → pick `Deep pipeline` threw out of a click handler. `engineConfigFor` (in
        `models.ts`) narrows the session config to the knobs a model claims. **Clamping rather than
        surfacing the error is FORCED, not a preference: the cache CONTROL is gated on the same flag,
        so on this model it is not rendered — an error message would leave the user in a state with
        no control to leave it by.** The session's own value is untouched, so leaving the model
        restores it (browser-verified: pipeline small → deep → pipeline, still lit at small, 71
        cycles again).
      - **Only `cache` is clamped, and that is the whole scope.** Extending it to the other four
        knobs would be four more judgement calls, each able to move an existing model's recording,
        and every model's counts are pinned in a timing suite. The other knobs are IGNORED — which is
        what makes ignoring them safe, and step 5 is what makes two of them REACHABLE (superscalar
        2-wide → deep hands it `issueWidth: 2`), so the deep suite now pins `issueWidth` and the OoO
        cluster as whole-trace inert in both forwarding positions. Step 2 had left that "a step-1
        question"; this is the step that had to answer it.
      - **`useSimulator` now holds the whole `ModelChoice` in one ref**, not just `.make`: the load
        path needs the active model's capabilities too, and two refs assigned at three sites each
        (init / `setModel` / `startLesson`) is how the lesson path stays broken while the picker path
        looks fixed. Same reasoning as step 1's `Ex1Ex2Latch` carrying operands — one object rather
        than a rule someone could forget.
      - **The churn was FOUR exhaustive lists, not the three the note above predicted:** the id list,
        the two `honoring()` lists — and **the DATAPATH table** (`models.test.ts:110`), which needed
        `['deep-pipeline', 'none']` inserted mid-array. It reddened, so it could not ship silently,
        but budget it.
      - **The clamp is pinned HEADLESSLY, because no test here can see a click** — both directions,
        the scope of the narrowing, the session value surviving, **that the UNCLAMPED config really
        does throw** (without that, the clamp assertions would keep passing against an engine that
        had gone back to ignoring the knob), and every model in `MODELS` loading with the cache on.
      - **THE BROWSER FOUND ONE DEFECT, and it is the class the browser exists for: PROSE.** The
        prediction tooltip said _"a correct bet costs 1 cycle; a wrong one costs 2"_ and the
        forwarding tooltip named the load-use bubble as the only exception. True of the 5-stage —
        which was the only model rendering these controls — and FALSE here, where the bet costs 2 and
        the misprediction 4. A view stating a number the machine on screen contradicts is INV-5, not
        simplification. Reworded to name the MECHANISM (the bet is placed in ID, so it costs whatever
        the front end has fetched; a wrong one costs the front end twice), which is true on both and
        is the better lesson. **Deliberately NOT threading coefficients through `ModelChoice` or the
        trace** — the plan's STOP. The issue-width and issue-order tooltips DO name the 5-stage but
        are gated on flags this model sets false, so they never render (swept, not assumed).
      - **The vite-alias first-move is DISCHARGED, with an honest negative.** The alias resolves to
        SOURCE (the served `models.ts` imports `/@fs/…/deep-pipeline/src/index.ts`) and a live edit to
        `processor.ts` reaches the running app on reload with no rebuild — so the stale-`dist` failure
        the M7 comment records is excluded EMPIRICALLY. What does NOT happen is HMR without a reload:
        engine packages sit outside the vite root, so the watcher never fires. **Identical for
        `engine/pipeline`**, driven since M3 — pre-existing repo-wide behaviour, not something this
        package introduced. Rig: `M:\claud_projects\temp\m11-browser\hmr-check.mjs`, which runs the
        same experiment on both engines because "is the NEW package special?" is only answerable by
        comparison.
      - The browser pass (`M:\claud_projects\temp\m11-browser\eyeball.mjs`, 22 checks, ALL PASS)
        drove the DEV server rather than `vite preview` — deliberately, since the source-liveness
        question is a dev-server question. **Step 8 still owes the shipped-bundle pass.** Every
        hand-derived number read live: `add` 7 on `pipeline` vs **10** here with the repeated **ID**
        cell (not EX1), 12 at forwarding OFF, `array-sum` 74 → **70** on the prediction flip, and
        **seven rows occupied in one cycle column**. Cold dev-server first paint is ~18s, so the
        readiness poll needs a minute, not ten seconds.

- [x] **6a. THE FAMILY'S FREEZE SEMANTICS WERE WRONG — fix first.** ✅ DONE 2026-07-27. Not a planned
      step: step 6's probe found a **correctness bug in shipped `engine/pipeline` (M6) and
      `engine/superscalar` (M7)**. A miss froze the execute stage BEFORE it captured its forwarded
      operands; the producer in MEM/WB retired during the freeze and its latch drained, so on release
      the occupant executed on its stale PRE-forwarding register read. **A cache — documented
      repo-wide as a timing shadow that "holds tags, never values" — changed the ANSWER.** Observed:
      a wrong register value (`x10 = −1` for `2`), a wrong load address with the wrong line evicted,
      and a non-terminating program. Unreachable by the corpus, trivially reachable from the sandbox.
      Full write-up, repro and blast radius: `docs/reviews/m11-miss-freeze-forward-loss.md`.

      **Why this blocked step 6 rather than sitting beside it:** with wrong freeze semantics the step
      could neither ship (it would ship the same hole) nor be dropped with proof (the proof would
      rest on a broken baseline). **User scoped it "fix the family first", 2026-07-27.**

      What landed, and the bits later steps should not re-derive:
      - The freeze holds the **ADVANCE, not the WORK**: EX resolves its operands and latches them
        back onto `a`/`b`, so the release cycle's own `resolveOperand` finds no producer and returns
        exactly those. **No new latch field**, so nothing in the trace or recorder shape moves.
      - **`ctx.memStallStarted` (capture on the DETECTION cycle only) is SEMANTIC, not an
        optimization** — the one thing the first spike got wrong. The occupant must execute on the
        values it would have seen had the miss never happened, and a later frozen cycle reads a
        *draining* source set. It also stops the superscalar's deliberately-frozen pair-mate in
        EX/MEM from re-matching and re-emitting a `forward` every frozen cycle.
      - **The broken ALIGNMENT is width-dependent, so each net SWEEPS the consumer distance.**
        `pipeline` and `superscalar` w=1 break at k=0; **w=2 is CLEAN at k=0** and breaks at k=1/k=2
        — a single-alignment test would have passed against a fully broken machine.
      - `out-of-order` was never affected (a ROB entry HOLDS its operand values, so there is no
        forwarding window a freeze can close) and now pins that as a property, with a miss-penalty
        assertion so the green is not vacuous.
      - Both nets were verified to FAIL without their fix (`git stash` the engine, run, pop).
      - **Zero churn on the pre-existing 4265 tests** — no instruction's advance moves, so every
        pinned `TIMING` table, lesson anchor and recorder assertion stands. Repo **4265 → 4287**.
      - **METHOD, and the reason this was nearly missed:** the probe's 132 corpus cells were
        IDENTICAL on cycles, event multiset, architectural state and cache tokens. The bug surfaced
        only under five hand-built ADVERSARIAL programs — and on one of them **the cycle count
        matched exactly while two `forward` events vanished.** The identity
        `cycles_cache = cycles_nocache + misses × missPenalty` held in EVERY cell, including the
        broken ones. **Checking cycles alone would have declared the cache mechanical and been
        wrong.** Any re-verification keeps the adversarial-plus-multiset shape.

- [x] **6. Cache on the deep pipeline (the third knob) — SHIPPED, not dropped.** ✅ DONE 2026-07-27. M6's
      miss-freeze meets a machine with two execute stages: `missCyclesRemaining` freezes
      IF/ID/EX, and which of IF1/IF2/EX1/EX2 freeze — and whether an in-flight EX2 completes
      — was framed here as a CHOICE with no external ground truth, exactly like M9 finding F9's
      `fuFreezesDuringMemStall()` seam. **STEP 6a PROVED THAT FRAMING WRONG, and the correction
      is the useful part: freezing a stage that has not yet captured its forwarded operands is
      not a choice, it is INCORRECT — and the golden reference is exactly the external ground
      truth this paragraph said did not exist.** So the seam is real but its answer is FORCED,
      and part of it is already decided: **EX1 must capture on the detection cycle, with the
      storage on the held `idEx1`** (it cannot use `ex1Ex2` — EX2's own frozen occupant holds
      that latch). What is left genuinely open is the rest: is the cache otherwise a purely
      additive `+M` term on this machine, or does depth move something?
      Acceptance: the fwd × predict × cache matrix green with hand-derived cells, or a
      written drop with the dump that justifies it — **and the dump must be the event multiset
      under adversarial programs, never cycles alone** (step 6a's method finding).

      **What landed (23 tests, repo 4287 → 4310), and the judgement calls step 7 should not
      re-litigate:**

      - **THE DUMP SAID "MECHANICAL", WHICH THE PLAN READ AS "⇒ DROP" — and the user pinned SHIP
        with proportionate tests instead, 2026-07-27.** The evidence: over the corpus × forwarding ×
        prediction × two geometries (132 cells) plus the five adversarial programs, every run
        satisfied `cycles = cycles_cacheless + misses × missPenalty`, with an invariant event
        multiset and byte-identical state. Dropping would have left `deep-pipeline` as the ONLY
        pipelined model without a cache and kept `engineConfigFor`'s clamp alive forever for one
        model; the engine work was already written and validated. **Mechanical made shipping cheap
        and safe — it was never an argument for not doing it.**
      - **BOTH HALVES OF THE PLAN'S SEAM TURNED OUT FORCED, in opposite ways.** *Which stages
        freeze* is back-pressure: MEM owns `next.ex2Mem`, so EX2 cannot advance, and the block
        propagates up — all five younger stages hold, no choice to make. *Does an in-flight EX2
        complete* has **no consequence either way** — EX2's operands are already on the `Ex1Ex2`
        latch and nothing forwards INTO it, so there is nothing to trade off. **The one that was
        NOT free is EX1**, which the plan never named — and getting it wrong was step 6a's bug.
      - **The headline for the model: DEPTH TAXES FETCH AND EXECUTE, NOT MEMORY.** A miss costs
        `missPenalty` here exactly as on the 5-stage, because the freeze stops the whole machine
        however long it is. That is worth stating out loud in the one model whose entire thesis is
        that depth taxes you — it is the boundary of the thesis, and it is the reason the test file
        is small.
      - **`cache.test.ts` is ~200 cells smaller than the house shape ON PURPOSE.** A third axis
        through `differential.test.ts` (68 → 204) and through the timing matrix would add cells that
        **cannot fail independently** of ones already asserted: every term is fixed by a cycle count
        `timing.test.ts` already pins and a miss count the address stream already fixes. The repo's
        standing rule (a pin earns its place only when something could lie without it) says
        enumerate what CAN lie, which is what the file does — and its header states the argument so
        the gap does not read as an omission.
      - **The load-bearing assertion is the VERDICT SEQUENCE**, pinned as the same literals
        `engine/pipeline`'s cache suite pins for the same program and geometry, and independently
        derived: the D-cache sees the accesses that REACH MEM in program order, and on both machines
        no wrong-path instruction ever gets past the execute stages — so the streams are both just
        "the retired memory ops, in order". **Cross-model comparison is PROSE + duplicated literals,
        never an import** (eslint denies model→model; step 3's precedent). It is also asserted
        invariant under forwarding × all three prediction schemes, which is where a speculation leak
        would show up and nowhere else.
      - **The recorder's deep-copy obligation came with the knob**: `CacheState` is single-buffered
        and mutated in place, so `micro.cache` is DEEP-COPIED per snapshot. Pinned by a cold-early /
        warm-late comparison — final-state conformance cannot see that bug, only time-travel can.
      - **The step-5 question was asked again and it paid: "what user-visible prose is gated on a
        flag this model turns on?"** The cache tooltips' NUMBERS were safe (they interpolate the
        geometry constants, and the miss penalty is exactly the coefficient depth does not change —
        the opposite of the prediction tooltips, which had to be reworded at step 5 because a bet
        costs 1 on the 5-stage and 2 here). One sentence was not: _"This is the pipeline as M4 left
        it"_ in the cache-off title. Reworded, and the docblock now says why these titles may state
        numbers where the prediction ones may not.
      - **THE BROWSER PASS: 24 checks, ALL PASS, no defect** (`M:\claud_projects\temp\m11-browser\cache-eyeball.mjs`,
        built on step 5's rig). Every hand-derived number read live: `array-sum-twice` on the deep
        machine at the shell's opening forwarding=OFF reads **392 → 442 (small) → 422 (large)**, and
        `pipeline` reads **340** — which is `cache.ts`'s own headroom note (290 + 5×10) confirmed from
        the running app. **It is a DEV-SERVER pass of what step 6 changed, NOT a substitute for step
        8's shipped-bundle sweep**, which still owes the whole milestone.
        - **The negative was asserted FIRST** (the step-5 rig lesson): `single-cycle` has no cache
          control, so `__seg('Cache')` returning null is known to mean something before it is used to
          claim the deep pipeline HAS one.
        - **Step 5's round-trip assertions were INVERTED by this step and had to be rewritten, not
          re-run.** Step 5 pinned "pipeline(cache small) → Deep pipeline shows NO cache control and
          the value is clamped away". Now the cache CARRIES OVER and is HONORED (442), and returning
          to `pipeline` still finds 340. A browser rig that pins a scope lever expires when the lever
          moves — worth expecting at step 8.
        - The three cache tooltips were read live and swept for the step-5 prose class. They are
          clean, and for a reason worth keeping: their numbers interpolate the geometry constants,
          and **the miss penalty is the one coefficient depth does not change**.
        - Every model loads with the cache lit (134/530/340/442/340/258) — the sweep that would catch
          a model refusing a knob the shell hands it.
      - **A KNOWN LIMITATION, recorded so it does not read as a step-6 bug: the cache grid's
        `filling` countdown does not render on this model.** `cache-grid.ts:154` reads
        `micro.exMem.missCyclesRemaining` — a 5-stage-only field NAME. The superscalar's `exMem` is a
        slotted ARRAY and the out-of-order core has no such latch, so **that path has only ever fired
        for `engine/pipeline`**; deep-pipeline joins three models in not having it. The panel itself
        renders correctly and the hit/miss/evict verdicts (which come from the `cache-access` EVENT,
        not from `micro`) are right. Fixing it properly means making the grid model-agnostic, which
        would fix superscalar and OoO too — a view change, not this step's, and not this model's bug.
      - **`engineConfigFor` KEPT, but it is no longer protection.** It was added at step 5 because
        this engine THREW on a cache; step 6 removed the throw, so nothing refuses anything and the
        clamp is now NORMALIZATION. Its test that pinned "the unclamped config really does throw"
        could not be preserved — asserting a throw now would be asserting a bug — so it was rewritten
        to the weaker true claim (the clamped model would have ignored one anyway, same cycles same
        answer), with the history written out for the next engine that refuses a knob. The clamp's
        exemplar moved to `single-cycle`, which has no memory-latency notion at all, rather than to
        the next model about to change.

- [x] **7. Bespoke datapath (SHEDDABLE — and, like M9's, never shed).** ✅ DONE 2026-07-27.
      A `datapath-deep-pipeline.ts` geometry+activation
      module (pure, tested) + view wrapper + render smoke test + browser eyeball, then flip
      `datapath` in `models.ts` and add the union member. Per
      `docs/templates/new-model-datapath.md`. Note the M7 pin: **wire stroke = STAGE, node
      tint = LANE, follow ring = IDENTITY** — and with seven stages the stroke palette must
      colour by stage FAMILY, the same rule the map follows, never by inventing hues.
      Acceptance: browser-verified against a dumped trace at a named cycle.

      **What landed (47 tests, repo 4310 → 4357; 4359 after the browser's finding), and the
      judgement calls a later milestone should not re-litigate:**

      - **THE GEOMETRY IS THE ARGUMENT, and it is one sentence: the forwarding muxes sit in EX1 and
        their output lands on the EX1/EX2 LATCH, never on the ALU.** Read the sinks and the bubble is
        structural — a forward physically cannot reach the instruction that needs it this cycle. The
        5-stage's diagram cannot say this, which is why `'pipeline'` was not reused: it draws five
        columns with the ALU immediately behind the muxes, so the ONE thing this tier teaches is the
        one thing that diagram cannot draw. Pinned by a test that sweeps every wire whose SINK is an
        EX2 unit and requires its source to be `ex1ex2` (the first draft of that test read "touches"
        instead of "sinks" and flagged the ALU's own OUTPUT — the assertion was wrong, not the
        geometry).
      - **THE FORK'S SHARPEST TRAP, and it fails SILENTLY: the parent gates its whole forwarding
        block on `if (aluOp)`.** That works at five stages because the muxes and the ALU share one.
        Here `alu-op` fires in EX2, a cycle AFTER the muxes do their work, so a copied gate lights
        **nothing** in EX1 — on the one model whose thesis is that forwarding stops being enough —
        and **the coherence litmus passes**, because nothing lit cannot dangle into a dim box. EX1 is
        therefore gated on OCCUPANCY plus a mirrored `sourcePorts`, and the test that earns its place
        asserts a real forward drawn in a cycle whose EX1 occupant emits no `alu-op` at all. The
        engine's literals were read before copying, not assumed: `to: 'EX1.rs1'` / `'EX1.rs2'`,
        `from: 'EX2/MEM'` / `'MEM/WB'`.
      - **...AND THE OCCUPANCY GATE IS OVER-BROAD BY ITSELF — the other half, found by review after
        the first commit and fixed before the step closed.** Replacing an EVENT gate with an
        OCCUPANCY gate swaps one error for its mirror: **a SQUASHED EX1 occupant is still reported at
        `EX1`** (step 3's sweep asserts exactly that — every stage a flush names has an occupant)
        while `stageEx1` returned early without resolving a single operand. So the diagram drew the
        forwarding network for an instruction that did no work and is about to die — **on every
        mispredicted branch, not in a corner**. The 5-stage gets this right by ACCIDENT: its
        `if (aluOp)` gate is never satisfied by an instruction that never executed. The gate is now
        occupancy **minus `flushedStages`**, read off the one event that names stages rather than an
        instruction. Two details worth keeping: it is scoped to **EX1 only** (ID and IF1 also light
        for squashed occupants, but the parent does that too — pre-existing house behaviour, not this
        step's to change), and it is keyed on the **STAGE**, not on "a flush happened", because a BET
        kills only IF2/IF1 and EX1 executes normally under one. `array-sum` looked clean while the bug
        was live because its squashed EX1 occupant is a `lui`, which reads no registers;
        `call-return` at forwarding ON is the sharp case.
      - **The mirror-image question — what a CACHE FREEZE draws — was asked and answered as a
        deliberate asymmetry, not a defect.** During a freeze **EX1 stays LIT and EX2 goes DARK**
        (160 corpus cycles have both execute stages occupied while frozen). Both halves are honest,
        and the distinction from the squash is the whole point: EX1's forwarded operands were
        resolved on the DETECTION cycle and are genuinely standing on the latch for the whole freeze
        — step 6a's fix is precisely that they must be — so lighting them is the same "a held stage
        keeps presenting its inputs" convention IF1 already uses; the ALU meanwhile really is
        producing nothing. A squashed occupant's operands, by contrast, were never resolved and will
        never exist. Pinned by a test, with the freeze detected as "MEM holds the same occupant on
        BOTH sides" — requiring the NEXT cycle too is what excludes the RELEASE cycle, where MEM
        still holds the same load while the machine runs again and an `alu-op` legitimately fires
        (the first draft called that frozen and failed against correct behaviour).
      - **The contraction SINKS moved, which is the genuinely new geometry rather than reflow.** In
        the parent a forwarding-mux contraction runs `latch → ALU`; here it must run
        `latch → ex1ex2`, because that is where the mux it collapses sends its output. The lawfulness
        litmus (same source, same sink as the expert path) is what catches a copied one, and the file
        adds the specific form: every `fwdmuxa`/`fwdmuxb` contraction sinks on `ex1ex2`.
      - **IF2 contains NO unit, and that is the honest picture rather than a gap.** Step 1 pinned
        that IF1 reads the word and IF2 does no new work, so a box there would invent work the trace
        does not contain. Its one wire is the only one in this family lit with **no event behind it
        at all** — occupancy only, labelled from `inst.encoding`, which is the same source the parent
        uses for an instruction a stall is HOLDING.
      - **The trace-schema STOP was reached and DECLINED, exactly where the plan predicted.** A
        non-forwarded operand crossing into `ex1ex2` has no event this cycle — its value was read at
        ID, cycles ago. The wire lights BARE. No field, no event, no back door. So **both falsifiable
        "unchanged" criteria now hold through the whole milestone.**
      - **Seven stages take five hues by stage FAMILY** (`stageFamily`, imported from `pipeline-map`
        — reading it changes nothing). Indexing `PHASE_COLORS` by the raw stage would leave four of
        seven `undefined` and fall back to the renderer's default stroke: everything would still
        render and the no-invented-hues rule would fail silently. The LEGEND therefore has five
        entries, not seven — a key to the hues, where two pairs of identical swatches would say the
        opposite of what is true.
      - **The interlock's picture: TWO execute inputs, THREE holds** (the PC and both front-end
        latches — step 4's `ID ID ID` / `IF2 IF2 IF2` / `IF1 IF1 IF1` triple). Under forwarding OFF
        the engine also compares against the instruction in MEM; that third input is NOT drawn, for
        exactly the reason the parent does not draw a second, and the file says so rather than
        leaving the gap to read as an oversight.
      - **THE BROWSER FOUND ONE REAL LAYOUT DEFECT, and it generalizes: a `controlLabel` is a single
        centred `<text>` four pixels above its box — it does not wrap and it is not de-collided
        against wires.** This unit's label names THREE held things where the 5-stage's names two, so
        the hold stubs leaving the top edge ran underneath it. Fixed by routing all three holds out
        of the LEFT edge (and the EX2 input to the right), which is also the truer picture — every
        hold travels backwards to the front end. Turned into a rule so the next labelled unit does
        not rediscover it in a screenshot: **no wire may anchor on the top edge of a node that
        carries a control label.**
      - **THE BROWSER PASS: 44 checks, ALL PASS** (`M:\claud_projects\temp\m11-browser\datapath-eyeball.mjs`,
        built on step 5/6's rig; close-ups via `dp-zoom.mjs`). It is not a vibes pass — the acceptance
        line's "dumped trace at a named cycle" is **`array-sum` cycle 8 at forwarding ON**, dumped
        from the pure `activate()` BEFORE the browser ran: the fullest possible pipe (seven stages,
        seven instructions) that is ALSO forwarding into EX1 and ALSO stalling in ID. Every lit wire
        is matched live **by its `points` geometry** (a wire carries no id in the DOM, and the
        geometry is the honest key anyway), and every hue by the `--phase-*` variable in its own
        inline style.
        - **The rig's first run "failed" against a CORRECT app, twice, and both are worth keeping.**
          (a) It compared the raw `activate()` set — which is tier-OBLIVIOUS (INV-2) and lights every
          contraction alongside the through-mux wire it stands in for — against the tier-FILTERED
          canvas: 26 vs 24, the two extras being exactly the contractions of `fwdmuxa` and `wbmux`,
          both visible at expert. The dump now emits the view-filtered set, and the inverse became a
          CHECK (those two are absent from the canvas, not dim). (b) It guessed ">40 wires" for the
          opening state and got 34 — which is precisely `expert|fwd:false|bet:false` in the dumped
          count table. Both thresholds are now read from the dump, never guessed.
        - The NEGATIVE was asserted first (the step-5 rig lesson): single-cycle and `pipeline` are
          read through the same selector and must return their OWN `aria-label`s, so "the datapath
          selector found something" is known to mean something before it is trusted.
        - Also read live: the placeholder is gone, all seven stage names are on the canvas, the map
          agrees that seven rows occupy that cycle column, forwarding OFF removes the two mux
          polygons (7 → 5) while the hazard unit survives, the follow ring reaches the datapath and
          rings SOME wires but not all (2 of 24), and the tier dial gates values and control labels.
      - **No per-STAGE label map is exported, where both the 5-stage and the superscalar have one.**
        Theirs feeds a legend with one entry per stage, which works only while stages and hues are in
        bijection; here they are not. A copied `STAGE_LABELS` shipped in the first commit
        exported-and-unused, and it made one smoke assertion (the legend omits `"Fetch 1"`) vacuous —
        nothing could ever have produced that string. Both removed.
      - **The dump generator is PARKED, not deleted** — `M:\claud_projects\temp\m11-browser\dump-generator.test.ts`,
        with the copy-in/run/delete recipe in its header. `datapath-eyeball.mjs` reads the JSON it
        writes and compares by geometry, so it fails loudly whenever a coordinate moves (it did,
        after the hazard reroute). Step 8 will need it.
      - **`_snap.render.test.tsx` was checked and deliberately NOT extended** — it is a `RUN`-gated
        dev screenshot harness, not a test, and it enumerates no model list. The four exhaustive
        lists that DID need editing were the `DatapathKind` union, App's dispatch arm, the
        `models.ts` row and `models.test.ts`'s datapath table; the table reddening is what makes the
        set impossible to half-do.
      - **A stale comment was corrected in passing**: `models.test.ts` still said the deep pipeline
        was "MISSING from this one on purpose" directly above the assertion that lists it in the
        cache-honoring set (step 6 shipped that knob). A comment asserting a case is impossible while
        the code beneath says otherwise is the bug class this repo's own notes name.

- [x] **8. Browser pass over the whole milestone** — the house closing step. ✅ DONE 2026-07-27. Drive the
      SHIPPED `vite preview` bundle (not the dev server) via CDP; rig under
      `M:\claud_projects\temp\m11-browser\`. Identify the target by served `<title>`, never
      by port; `taskkill /PID <pid> /T` to clean up.

      **THE PASS: 76 checks, ALL PASS, NO DEFECT** (`M:\claud_projects\temp\m11-browser\step8-preview.mjs`,
      one consolidated rig; close-up + label geometry via `s8-crop.mjs`). Repo **4361 tests**;
      `npm test`, `typecheck`, `lint`, `build`, `format:check` all green.

      **What this step could see that steps 5–7 could not, which is the whole reason it exists.**
      Every earlier pass drove the DEV server, where `@cpu-viz/engine-deep-pipeline` resolves through
      the vite alias to SOURCE. `vite preview` serves what `vite build` emitted. So this is the only
      pass that excludes **the build resolving the workspace symlink to a stale or absent `dist`** —
      the failure the M7 comment in `vite.config.ts` records, and which step 5 excluded *for dev only
      and said so*. It is excluded for the shipped path now: every hand-derived number reads correct
      off the built bundle, and the served page is confirmed to be the built one by its
      `/assets/index-*.js` script tag rather than a `/src/main.tsx` module graph.

      - **§0 IS LOAD-BEARING, AND IT IS NOT CEREMONY: without it every negative below it is vacuous.**
        This rig — like all four before it — finds controls by an uppercase caption through
        `getComputedStyle`, and wires by `.dp-wire--on`. **If the built CSS 404s or a class is hashed
        by a production transform, every `__seg()` returns `null` and every ABSENCE check passes** —
        which reads as "the control is missing", not "the rig is broken". So §0 asserts, before
        anything else: the page is the BUILT bundle, the CSS actually loaded (1 sheet / 74 rules), a
        **known-present** control is found, and the class-keyed selectors resolve on minified CSS.
        This is the step-5 negative-first lesson generalized from one selector to the rig's whole
        machinery, and a preview pass is exactly where it earns its place.
      - **Every number the milestone hand-derived, read live off the shipped bundle**: the picker in
        teaching order with `"Deep pipeline"` and a description naming 7-stage; `add` at forwarding ON
        **7 on `pipeline` vs 10 here** with the walk `IF1 IF2 ID ID EX1 EX2 MEM WB` — **the repeat on
        ID, not EX1** (step 4's correction) — and **12** at forwarding OFF; `array-sum` **74 → 70** on
        the prediction flip; seven distinct stage labels, a DERIVED five-family legend, five cell hues
        with IF1/IF2 and EX1/EX2 pairing; **seven rows in one cycle column**; the datapath dump
        comparison at **array-sum cycle 8** (24 wires matched by `points` geometry, nothing extra, the
        two contractions ABSENT not dim, every hue its stage FAMILY's, five hues over seven stages);
        polygons **7 → 5** at forwarding OFF with the hazard unit surviving; the follow ring covering
        the seven distinct stages and reaching the datapath (2 of 24 lit); scrub to the last cycle
        (`a0` = 120) and home to pre-run (`a0` = 0) with the follow surviving; the cache at
        **392 / 442 / 422** against `pipeline`'s **340**; all six models loading; console clean.
      - **TWO RIG "FAILURES" AGAINST A CORRECT APP — the house rate holds, and both generalize.**
        (a) The transport reads `cycle 73 / 73  — halted` and the check wanted the bare prefix. The
        halted marker is the app telling the truth; the fix asserts the prefix AND the marker, so the
        marker became a CLAIM rather than noise stripped to make a rig pass.
        (b) The label-collision probe compared a text's `getBoundingClientRect()` against each
        polyline's — and reported three collisions on a diagram that is visibly clean at 5×.
        **A polyline's bounding box is the box of its whole ROUTE**: an L-shaped wire running far in
        both axes has a bbox covering everything between its ends, so bbox-vs-bbox over-reports wildly
        on precisely the routes this family is made of. Rewritten to walk each polyline SEGMENT in SVG
        user units.
      - **STEP 7'S LAYOUT RULE NOW HAS A GENERAL CHECK, and it holds — with one measured near-miss
        worth writing down rather than fixing.** Sweeping all five italic control labels for minimum
        clearance to any wire segment: `PCSrc` 16.3, `ForwardA` 12.6, `ForwardB` 8.1, `MemtoReg` 27.3
        units — and the hazard label `PCWrite / IF1-IF2-Write / IF2-ID-Write` at **−0.09**. A 22× crop
        settles it: **the ink is clear**, because Chrome's `getBBox()` on a `<text>` is the ADVANCE
        box, not the ink box — it includes the trailing side bearing, which on an italic label runs
        most of a unit past the last visible pixel. **So a clearance between 0 and about −1.5 means
        "abuts, ink clear" and must be settled by pixels, never by the number**; the rig reports a
        signed clearance instead of a boolean for exactly that reason. Not fixed, deliberately: step
        7's rule (no wire anchors on the TOP edge of a node carrying a control label) is honoured —
        the wire passes vertically to reach the box's RIGHT edge — and moving geometry at the
        milestone's close would buy no visible pixel while invalidating the geometry pins the datapath
        rig compares against.
      - **The expired-rig hazard was predicted at step 6 and confirmed here.** `eyeball.mjs` §6 pins
        "no cache control on the deep pipeline / clamped away / 74 cycles" — all three inverted by
        step 6. The checks were PORTED, not the file, and §8 now pins the inverse (the cache carries
        over and is HONORED at 442, with `pipeline` back at 340 on return). Twice in one milestone a
        browser rig that pinned a SCOPE LEVER expired when the lever moved; a closing pass should
        expect to rewrite, not re-run.
      - **The dump was REGENERATED from the current engine before the browser ran** (step 7's
        squashed-EX1 activation fix landed after the original dump). Byte-identical: `array-sum`
        cycle 8 is unmoved, because its squashed EX1 occupant is a `lui`, which reads no registers —
        the same reason step 7 records for why that program looked clean while the bug was live. The
        parked generator's copy-in / run / **delete** recipe matters: the web build runs
        `tsc --noEmit`, so a stray `zz-dump.test.ts` left in `packages/web/src` fails the build,
        `npm test`, `lint` and `format:check` — the four gates this step had to leave green.
      - Cleanup by identity, never by port or image name: **60 leftover Chromes** swept by matching
        `--user-data-dir` in `CommandLine`, and the preview server killed by its two PIDs read out of
        their command lines. Preview was started with an explicit `--port 4199 --strictPort` and still
        confirmed by served `<title>` before anything was trusted.

## Acceptance criteria (mirror the spec §11 shape)

- [x] Load `sum-loop.s` on **Deep pipeline**, run to the end, and the pipeline map draws
      **seven stage columns in five hues**, each cell's text naming its exact stage.
      **The HEADLESS half is done at step 4** (`pipeline-map.test.ts` folds a real `sum-loop`
      recording to the ordered `['IF1','IF2','ID','EX1','EX2','MEM','WB']` and five families,
      with the 5-stage as the control); ✅ the LIVE half at step 5, 2026-07-27 — the browser reads
      seven distinct cell labels, a DERIVED five-swatch legend (`IF ID EX MEM WB`) and five distinct
      `--cell-hue` values, with `IF1`/`IF2` sharing the fetch hue and `EX1`/`EX2` the execute one.
- [x] The same program at **forwarding ON** takes strictly more cycles on `deep-pipeline`
      than on `pipeline`, and the map shows a **repeated ID cell** on a back-to-back
      dependent pair that the 5-stage draws with no repeat — forwarding no longer buying a
      free result. **CORRECTED at step 4: this criterion said "repeated EX1 cell" and that was
      wrong.** The interlock lives in ID and re-presents its occupant onto the latch it arrived
      on (`stall.stage: 'ID'`), so the consumer waits where it was decoded and reaches each
      execute stage exactly once. `add.s`'s dependent pair walks `IF1 IF2 ID ID EX1 EX2 MEM WB`
      here against `IF ID EX MEM WB` on the 5-stage — **look at the ID column in the browser,
      not EX1.** The headless half is pinned at step 4 (shape AND cycles, 7 vs 10). ✅ the LIVE half
      at step 5, 2026-07-27 — the same `add` at forwarding ON reads **7 cycles on `pipeline`** with
      the walk `IF ID EX MEM WB` and **10 here** with `IF1 IF2 ID ID EX1 EX2 MEM WB`, the repeat
      landing on ID exactly as step 4 corrected it to.
- [x] Flipping **forwarding OFF** and **prediction** on the deep model changes cycle counts
      by the deep machine's coefficients, matching hand-derived numbers. **The HEADLESS half is done
      at step 3** (66 hand-derived cells, both toggles, every term asserted separately); ✅ the LIVE
      half at step 5, 2026-07-27 — `add` 10 → **12** on forwarding OFF (S 1 → 3) and `array-sum`
      74 → **70** on the prediction flip (P 16 → 12), both straight off the `TIMING` table.
- [x] Follow an instruction (INV-4) across all seven stages; scrub backwards and forwards
      and the map, registers, memory and source panels all agree at every cursor.
      **The HEADLESS half is done at step 4** — `recorder.test.ts` follows one instruction
      through all seven stages while six others are in flight, resolves seven ids to seven
      locations in one cycle, and walks the cursor forward, back to pre-run and to any cycle
      with the shown state always that cycle's own snapshot. ✅ the LIVE half at step 5,
      2026-07-27 (`M:\claud_projects\temp\m11-browser\follow-scrub.mjs`): clicking a map cell
      follows that instruction — the readout names it, every cell of its row wears the follow ring,
      and the DISTINCT stages ringed are the seven in order — while the click also seeks to that
      cell's cycle. Scrubbing to 0/12/40/last and home to pre-run keeps the transport text, the map
      playhead column and the register panel agreeing (`a0` = 120 at the end, 0 at pre-run), and the
      follow survives the scrub. **The claim is the DISTINCT stages, not a cell count** — at the
      shell's opening forwarding=OFF that `lw` interlocks, so its row is EIGHT cells over SEVEN
      stages, and asserting a count would be asserting the absence of a stall.
- [x] **INV-8 differential passes on the full corpus** for the new model. ✅ step 2,
      2026-07-27 — 6 configs × 11 programs, green on the first run.
- [x] **The timing matrix reddens when IF2/EX2 are stubbed to pass-through, while INV-8 stays
      green** — the recorded mutation check. ✅ step 3, 2026-07-27. **BOTH halves executed**, as two
      separate mutations: stub IF2 → INV-8 green 68/68, timing RED 55/92; stub EX2 → INV-8 green
      68/68, timing RED 58/92. `differential.test.ts` was RUN under each stub rather than assumed
      green from the prose already sitting in two files.
- [x] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run format:check`
      all green. ✅ step 8, 2026-07-27 — **4361 tests** (73 files passed, 1 `RUN`-gated snapshot
      harness skipped), all five gates green on the same tree the preview pass drove.

### Two falsifiable "unchanged" criteria (both pre-paid — reaching for either is a STOP)

- [x] **`packages/web/src/pipeline-map.ts` needs no change.** ✅ PAID OUT at step 4,
      2026-07-27. It was built depth-parametric at M3 step 7 and the fold is
      model-knowledge-free by design — and a real seven-stage recording now folds through it
      with the file untouched (`git diff` over step 4 shows `pipeline-map.test.ts` and the web
      trio, never `pipeline-map.ts`). The M3-era fixture at `pipeline-map.test.ts:505` is
      reproduced character-for-character by the engine. **Steps 5–7 must keep it unchanged.**
- [x] **The trace schema needs no change.** ✅ PAID OUT at step 7, 2026-07-27. `location` is a plain
      string precisely to absorb this axis (`"IF2"` = depth, `"EX.0"` = lane). Held through step 4 —
      the engine, the recorder, `follow()` and the map fold all ran on the shipped schema, and the
      one place step 1 came close (an IF1 occupant with no `encoding`) was settled by REJECTING that
      stage split rather than widening the type. **Step 7 was the remaining place that could reach
      for it, and it DID reach the temptation and decline it**: a non-forwarded operand crossing into
      the EX1/EX2 latch has no event in the cycle being drawn (it was read from the register file at
      ID, cycles earlier), so the obvious fix is a field or an event carrying the latched operand.
      The wire lights BARE instead — the same call the parent already makes for every latch-riding
      value (INV-5: omit, never contradict). Nothing in `packages/trace` changed in this milestone.

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
