# Milestone 11 — the deep pipeline (7-stage)

**Status: NOT STARTED, 2026-07-27. Nothing built. Scope pinned by the user this session
(deep pipeline ALONE — the wider superscalar is explicitly NOT in this milestone, see
"Why this milestone"). The stage split and the branch-resolve point are SEEDED
recommendations in the decisions table, not yet pinned.**

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

**Option A (recommended) — `IF1 IF2 ID EX1 EX2 MEM WB`.** Fetch takes two cycles; the ALU is
pipelined into two halves; memory stays one stage.

- Buys **both** coefficient growths that make a deep pipeline a deep pipeline:
  - misprediction penalty **2 → 4** (a deeper front end to flush),
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

**Recommendation: Option A.** The scope lever the reviewer signs off on: **the MVP honors
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

- [ ] **0. Package scaffold + the new-model DAG ripple.** `packages/engine/deep-pipeline`
      (package.json, tsconfig, `src/index.ts`), the workspace entry, `tsconfig.json` project
      references, and — the one that has burned this repo before — **`eslint.config.js`: add
      `'engine-deep-pipeline'` to the `MODELS` constant AND add its own deep-pipeline `files`
      self-exclusion block** beside the other five. This is M9+M10 review finding 7 verbatim
      (`engine-out-of-order` was omitted from four deny lists under the old
      enumerate-per-block shape).
      Acceptance: `tsc -b` and `npm run lint` green, **and** a temporary import of
      `@cpu-viz/engine-deep-pipeline` from a `packages/trace` file errors with the INV-3
      message (then reverted) — the verification the guardrail memory names.

- [ ] **1. The model MVP — `DeepPipelineProcessor`.** Fork `engine/pipeline/src/processor.ts`
      (the M7 extract-then-fork precedent) to seven stages: `IF1 IF2 ID EX1 EX2 MEM WB`, six
      latches, forwarding + branch-prediction knobs honored, and **a non-null `cache` config
      REFUSED by name — never silently ignored** (step 6 owns it; the superscalar's
      `issueWidth > 2` throw at `processor.ts:513` is the shape to copy, and "refusing rather
      than silently running" is the house rule that keeps an unhonored knob from shipping
      inert). Forwarding paths stay
      ENUMERATED, not generalized. Stable ids (INV-4), `location` emitted as the bare stage
      strings.
      Acceptance: hand-derived per-cycle walks for a RAW pair, a load-use pair and a taken
      branch pass as unit tests; `capabilities` exported and matching the shipped constant
      shape; **the distinct `location` set emitted on a real program equals
      `['IF1','IF2','ID','EX1','EX2','MEM','WB']` exactly** — the fixture at
      `pipeline-map.test.ts:505`, so the map's depth support is pinned to the engine's real
      encoding (`stageFamily` strips a trailing `\d+`, so `IF-2` or `IF.1` would silently
      mean something else — `.` is the LANE axis).

- [ ] **2. Differential net: `runConformance(() => new DeepPipelineProcessor())` (INV-8).**
      Full corpus, final architectural state.
      Acceptance: green — **and the step's own docblock states in prose that this proves
      nothing about depth**, naming step 3 as the net that does. (An acceptance line that
      overstates its own coverage is how the inert-package failure ships.)

- [ ] **3. THE NET — the timing matrix and its mutation check.** A `timing.test.ts` in the
      house shape (M3/M6/M7 precedent): every corpus program × forwarding × prediction, with
      a closed form `cycles = N + 6 + S + P` whose **S and P coefficients are the deep
      machine's, not the 5-stage's**. Dump from the engine, hand-derive independently,
      cross-check the two. Expected (to be CONFIRMED by the dump, not assumed): ALU→ALU
      forwarding-ON 0→1 bubble, load-use 1→2, forwarding-OFF RAW 2→3, misprediction 2→4.
      Acceptance: matrix green from hand-derived cells; **plus the recorded mutation check —
      stubbing IF2/EX2 to pass-through leaves INV-8 green and reddens this suite.** If it
      does not, stop and surface it.

- [ ] **4. Recorder / time-travel + the map meets a real deep engine.** `follow()`, scrub,
      and back-stepping over the new model (the per-model recorder test every tier has).
      Then the payoff: extend `pipeline-map.test.ts`'s last describe with a **real-engine**
      seven-stage case beside the hand-built one — the M7 step 6 move for the lane axis,
      applied to the depth axis — and update that file's header, which currently asserts the
      deep stage set is unemitted.
      Acceptance: a real recording folds to **7 stages / 5 families**; `hasOverlap` true;
      **`pipeline-map.ts` itself is UNCHANGED** (see falsifiable criteria).

- [ ] **5. Web enablement.** A `models.ts` entry (id, label, the engine's OWN exported
      `MODEL_DESCRIPTION` constant per the superscalar/OoO precedent, `capabilities`), with
      **`datapath: 'none'`** — the deliberate superscalar/OoO pattern, since a `DatapathKind`
      means "a diagram of this kind EXISTS" and flipping it early makes `models.test.ts`
      assert a diagram nothing drew. Panels, transport, scrub, lessons and the sandbox come
      free via INV-3. Grep for glob-vs-hardcoded guards beyond the named list before calling
      it done — every prior milestone found one its plan did not name.
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
- [ ] Flipping **forwarding OFF** and **prediction** on the deep model changes cycle counts
      by the deep machine's coefficients, matching hand-derived numbers.
- [ ] Follow an instruction (INV-4) across all seven stages; scrub backwards and forwards
      and the map, registers, memory and source panels all agree at every cursor.
- [ ] **INV-8 differential passes on the full corpus** for the new model.
- [ ] **The timing matrix reddens when IF2/EX2 are stubbed to pass-through, while INV-8 stays
      green** — the recorded mutation check.
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

## Decisions to pin (fill in as steps land — seeded with the recommended answers)

| Decision                                  | Recommendation (seed)                                                                                                   | Pinned answer                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Depth vs width for M11                    | Deep pipeline alone; width is a separate milestone (different work — pairing rules in place, no new package)            | **Deep pipeline alone** (user, 2026-07-27) |
| The stage split                           | Option A: `IF1 IF2 ID EX1 EX2 MEM WB` — both coefficient growths, no cache interaction, matches the M3 fixture          | _(open)_                                   |
| Where a branch resolves                   | End of **EX2** (the ALU is uniformly two cycles, including the compare) ⇒ misprediction penalty 2→4, a clean doubling   | _(open)_                                   |
| Is EX2 a real half-ALU or a latch?        | Real: the result is not available until end of EX2. This is the whole thesis; a "free" EX2 is the inert-package failure | _(open)_                                   |
| Model id / label                          | `deep-pipeline` / "Deep pipeline"; description exported as the engine's OWN `MODEL_DESCRIPTION` constant                | _(open)_                                   |
| Cache support                             | Step 6, behind the MVP; the freeze/EX2 interaction pinned by a named seam + parity test (the M9 F9 shape), or dropped   | _(open)_                                   |
| Bespoke datapath                          | Step 7, sheddable; `datapath: 'none'` until it actually exists (superscalar/OoO precedent)                              | _(open)_                                   |
| A lesson track for the deep pipeline      | NOT in this milestone. M11 = model + view, the M9 shape; the track is its own milestone, the M10 shape                  | _(open)_                                   |
| Memory depth (`MEM1`/`MEM2`) / a 12-stage | Not deferred within M11 — a candidate for a LATER milestone. Option A deliberately does not open it                     | _(open)_                                   |
