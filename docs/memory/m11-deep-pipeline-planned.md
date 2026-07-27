---
name: m11-deep-pipeline-planned
description: 'M11 (the 7-stage deep pipeline) — STEPS 0–7 DONE, only step 8 (shipped-bundle browser pass) remains. Step 6 found a CORRECTNESS BUG in shipped pipeline+superscalar (a miss-freeze ate a forward), fixed family-wide as 6a, then shipped the deep cache. Step 7 drew the bespoke datapath — the bubble as GEOMETRY — and paid out the second falsifiable UNCHANGED criterion (the trace schema)'
metadata:
  node_type: memory
  type: project
  originSessionId: bc99b34f-e3f6-4309-b7d9-0202a194542a
  modified: 2026-07-27T18:48:45.014Z
---

**STEP 7 (2026-07-27) — THE BESPOKE DATAPATH. Sheddable in the plan, never shed in practice (the
M9 precedent held). Repo 4310 → 4359 tests.**

`packages/web/src/datapath-deep-pipeline.ts` + `DeepPipelineDatapathView.tsx`, forked from the
5-stage. **The geometry IS the argument, in one sentence: the forwarding muxes sit in EX1 and
their output lands on the EX1/EX2 LATCH, never on the ALU.** Read the sinks and the bubble is
structural — a forward physically cannot reach the instruction that needs it this cycle. That is
why `'pipeline'` could not be reused (five columns, ALU immediately behind the muxes ⇒ the one
thing this tier teaches is the one thing that diagram cannot draw, INV-5).

**THE TRAP THAT FAILS SILENTLY, and the one thing to carry into any future datapath fork: the
5-stage gates its entire forwarding block on `if (aluOp)`.** Here `alu-op` fires in EX2, a cycle
AFTER the muxes work — so a copied gate lights **nothing** in EX1, and **the coherence litmus
still passes**, because nothing lit cannot dangle into a dim box. Gate EX1 on OCCUPANCY plus a
mirrored `sourcePorts`, and pin it with a test asserting a real forward drawn in a cycle whose
EX1 occupant emits no `alu-op`. Read the engine's event literals before copying any of them
(`to: 'EX1.rs1'`, `from: 'EX2/MEM'` / `'MEM/WB'`) — a copied string that never matches produces
exactly this failure with no error.

Other step-7 findings worth keeping:

- **A `controlLabel` is a single centred `<text>` 4px above its box — no wrapping, no
  de-collision against wires.** This model's hazard label names THREE held things, so the hold
  stubs leaving the top edge ran under it. Rerouted all three holds out of the LEFT edge (also
  the truer picture: a hold travels backwards to the front end) and pinned the general rule —
  **no wire may anchor on the top edge of a node carrying a control label.** A browser finding.
- **Seven stages take five hues by stage FAMILY** (`stageFamily`, the map's own rule). Indexing
  `PHASE_COLORS` by the raw stage returns `undefined` for four of seven and silently falls back
  to the default stroke. Legend keys the HUES (five entries), not the stages.
- **THE SECOND FALSIFIABLE "UNCHANGED" CRITERION PAID OUT: the trace schema.** The temptation was
  reached exactly where the plan predicted — a non-forwarded operand crossing into the EX1/EX2
  latch has no event this cycle (read at ID, cycles ago) — and DECLINED: the wire lights BARE.
- **A browser rig can "fail" against a correct app, and both ways happened here.** (a) Comparing
  the raw tier-OBLIVIOUS `activate()` set (INV-2 lights every contraction alongside its
  through-mux wire) against the tier-FILTERED canvas — dump the view-filtered set, and make the
  inverse a check. (b) Guessed thresholds: ">40 wires" failed at 34, which was exactly right for
  the state the shell opens in. **Read every expected number from the dump, never guess one.**
  44 checks, all pass; ground truth = `array-sum` cycle 8 at forwarding ON (fullest pipe that
  also forwards into EX1 and stalls in ID), matched wire-for-wire by `points` geometry, since a
  wire carries no id in the DOM.

**STEP 6 (2026-07-27) DID NOT GO AS PLANNED, AND THE DETOUR WAS THE VALUABLE PART.**

The step's question was "implement the cache on the 7-stage, or DROP IT WITH PROOF". Probing it
found a **correctness bug in SHIPPED code** — `engine/pipeline` (M6) and `engine/superscalar`
(M7): **a cache miss froze the execute stage BEFORE it captured its forwarded operands**, the
producer retired out of MEM/WB during the freeze, and on release the occupant executed on its
stale pre-forwarding register read. A cache — documented repo-wide as a timing shadow that "holds
tags, never values" — **changed the answer**. Observed: a wrong register value, a wrong load
address with the wrong line evicted, and a non-terminating program. Unreachable by the 11-program
corpus; trivially reachable from the app's sandbox. Full write-up:
`docs/reviews/m11-miss-freeze-forward-loss.md`. The method that caught it is its own memory:
[[cycles-cannot-see-a-lost-forward]].

- **Step 6a (user-scoped "fix the family first")** — the freeze now holds the **ADVANCE, not the
  WORK**: EX resolves its operands and latches them back onto `a`/`b`, so the release cycle's own
  `resolveOperand` finds no producer and returns them. **No new latch field**, so nothing in the
  trace or recorder shape moves. `ctx.memStallStarted` (capture on the DETECTION cycle ONLY) is
  SEMANTIC, not an optimization — a later frozen cycle reads a draining source set, and on the
  superscalar an unconditional capture re-emits a `forward` every frozen cycle off the pair-mate
  deliberately frozen in EX/MEM. **Zero churn on 4265 existing tests**; regression nets in all
  three cache-honoring packages, each verified to fail without its fix. `out-of-order` was never
  affected — a ROB entry HOLDS its operand values, so there is no forwarding window to close — and
  now pins that as a property.
- **Then step 6 SHIPPED the cache** (user chose ship-with-proportionate-tests over the plan's own
  "mechanical ⇒ drop" criterion, because dropping would leave `deep-pipeline` as the only PIPELINED
  model without a cache and keep `engineConfigFor`'s clamp alive forever for one model).
  **BOTH halves of the seam the plan feared turned out FORCED**: which stages freeze is
  back-pressure (MEM owns `next.ex2Mem`, so EX2 cannot advance and the block propagates up), and
  whether an in-flight EX2 completes has **no consequence either way** (its operands are already on
  the `Ex1Ex2` latch and nothing forwards INTO it). The one that was NOT free is **EX1**, which the
  plan never named.
- **The model's own headline, and the boundary of its thesis: DEPTH TAXES FETCH AND EXECUTE, NOT
  MEMORY.** A miss costs `missPenalty` here exactly as on the 5-stage — the freeze stops the whole
  machine however long it is — and the miss SEQUENCE is identical to the 5-stage's, because no
  wrong-path instruction ever reaches MEM on either. That is why `cache.test.ts` is ~200 cells
  smaller than the house shape: a third axis through the differential (68→204) and the timing matrix
  would add cells that **cannot fail independently** of ones already asserted.
- **A real user-visible consequence, accepted and pinned rather than fixed:** the pipeline map pages
  at 400 cycles, and `PipelineMapView.test.tsx` claimed "the teaching path never sees paging" while
  measuring only the 5-stage (290). `array-sum-twice` on the deep machine is **392** (8 cycles of
  headroom, before step 6) and **442/422** with a cache. So that claim is true through M7 and FALSE
  for `deep-pipeline` + cache. The test now measures per MODEL.
- **KNOWN LIMITATION, not a step-6 bug:** the cache grid's `filling` countdown reads
  `micro.exMem.missCyclesRemaining`, a 5-stage-only field NAME — the superscalar's `exMem` is a
  slotted array — so that path has **only ever fired for `engine/pipeline`**. Verdicts still render
  (they come from the `cache-access` EVENT). Fixing it means making the grid model-agnostic, which
  would fix superscalar and OoO too.
- **Browser pass: 24 checks, ALL PASS, no defect.** Live: 392 → 442 → 422 on the deep machine and
  340 on `pipeline` (= `cache.ts`'s own 290 + 5×10 headroom note, read from the running app). Step 8
  still owes the SHIPPED-bundle sweep.

**The spec's §12 roadmap is FINISHED** — tiers 1–5 (single-cycle → multi-cycle →
5-stage pipeline → caches/prediction → in-order superscalar → out-of-order) are all
built through M10. So "what's next" is no longer answerable from the spec; it comes
from [[future-microarchitectures]].

**M11 = the deep pipeline (7-stage). Planned 2026-07-27; STEPS 0, 1, 2, 3, 4 AND 5 DONE 2026-07-27**
(the package scaffold + DAG ripple, the model MVP, the INV-8 differential, **THE NET**, the
recorder + map payoff, and web enablement). **The model is now DRIVABLE in the browser. Step 6 —
cache on the deep pipeline, or DROPPED WITH PROOF — is next**; steps 6–8 open.
Plan: `docs/plans/m11-tasks.md`, whose per-step entries record what landed and every judgement
call, so later steps don't re-litigate them. Repo now **4265 tests**; typecheck/lint/build/
format:check green.

**STEP 5 (14 tests, repo 4251 → 4265) — the `models.ts` row, and it made a LIVE CRASH REACHABLE.**

- **THE BUG CLASS, and it generalizes: the shell holds forwarding, prediction, the cache, issue
  width and the OoO cluster at SESSION level and hands the whole config to whichever engine drives.**
  Safe for five models, because a knob a model does not honor is a knob it **IGNORES**.
  `deep-pipeline` is the **first shipped engine that REFUSES one** — `reset()` throws on a non-null
  cache (step 6's scope lever) — so `pipeline` with the cache on → pick `Deep pipeline` threw out of
  a click handler. Fixed by **`engineConfigFor(model, config)` in `web/src/models.ts`**, which
  narrows the session config to the knobs a model claims. **Clamping rather than surfacing an error
  is FORCED, not taste: the cache CONTROL is gated on the same capability flag, so on this model it
  is not rendered — an error would leave the user with no control to leave the state by.** It clamps
  the value PASSED, never the session's own, so leaving the model restores the geometry.
  **`cache` ONLY** — extending it to the other four would be four judgement calls each able to move
  an existing model's recording. A second refusing knob belongs beside it, with the argument written out.
- **`useSimulator` now holds the whole `ModelChoice` in ONE ref**, not just `.make`: the load path
  needs capabilities too, and two refs assigned at three sites each (init / `setModel` /
  `startLesson`) is how the LESSON path stays broken while the picker path looks fixed.
- **The churn was FOUR exhaustive `toEqual` lists, not the three the plan named** — the id list, the
  two `honoring()` lists, **and the DATAPATH table** (`models.test.ts:110`, `['deep-pipeline','none']`
  mid-array). All reddened, so none could ship silently.
- **THE BROWSER FOUND ONE DEFECT AND IT WAS PROSE — the class only a browser sees.** The prediction
  tooltip said _"a correct bet costs 1 cycle; a wrong one costs 2"_ (and forwarding named the
  load-use bubble as the sole exception): true of the 5-stage, which was the only model rendering
  these controls, and FALSE here where the bet costs **2** and the misprediction **4**. A view
  stating a number the machine on screen contradicts is **INV-5**, not simplification — and the
  coefficients changing with depth is the milestone's thesis, so the control teaching it cannot lie
  about it. Reworded to name the **MECHANISM** (the bet is placed in ID, so it costs whatever the
  front end has fetched; a wrong one costs the front end twice — a relation true on BOTH machines:
  1/2 there, 2/4 here). **NOT threaded through `ModelChoice` or the trace** — the plan's STOP. The
  issue-width/issue-order tooltips DO name the 5-stage but are gated on flags this model sets false.
  **Ask this of every future model: what user-visible prose is gated on a flag it turns on?**
- **The vite-alias first-move is DISCHARGED with an honest negative.** The alias resolves to SOURCE
  and a live edit to `processor.ts` reaches the running app on reload with no rebuild — the
  stale-`dist` failure is excluded EMPIRICALLY. What does not happen is HMR without a reload:
  engine packages sit outside the vite root so the watcher never fires — **identical for
  `engine/pipeline`**, hence pre-existing repo-wide, not this package's doing. Only a comparison
  against an old package could establish that.
- **Browser rigs live at `M:\claud_projects\temp\m11-browser\`**: `eyeball.mjs` (22 checks, all
  pass), `hmr-check.mjs` (source-liveness on both engines), `follow-scrub.mjs` (INV-4 follow +
  scrub). They drive the **DEV server** — deliberately, since source-liveness is a dev-server
  question; **step 8 still owes the shipped-bundle pass.** Cold dev-server first paint is **~18s**,
  so a readiness poll needs a minute, not ten seconds. Every hand-derived number read live: `add`
  **7 on `pipeline` vs 10 here** with the repeated **ID**, **12** at forwarding OFF, `array-sum`
  **74 → 70** on the prediction flip, **seven rows in one cycle column**, and the cache round trip.
- Four of the six §11 acceptance boxes are now ticked (the two remaining are the whole-repo green
  gate and the trace-schema UNCHANGED criterion, which step 7 is the last risk to).

**STEP 4 (19 tests, repo 4232 → 4251) — `deep-pipeline/src/recorder.test.ts` + a new last describe
in `packages/web/src/pipeline-map.test.ts`.** It did NOT have to move after step 5: **the web trio
(web `package.json` dep, `tsconfig` `paths`, Vite alias) landed HERE**, because step 4's acceptance
lives in `packages/web`, `models.test.ts:16` pins the id list literally so there was zero churn, and
the three are checked by DIFFERENT gates (vitest→root alias, typecheck→`paths`, build→vite alias) —
splitting them is how one gets forgotten. Step 5 still owns the `models.ts` row, `MODEL_DESCRIPTION`,
picker position and the `honoring()` churn.

- **PAID OUT the first falsifiable UNCHANGED criterion: `pipeline-map.ts` absorbed a real
  seven-stage recording untouched**, and the M3-era fixture at `pipeline-map.test.ts:505` is now
  reproduced character-for-character by the engine. The file's "the deep stage set is genuinely
  unemitted" sentence is false, and **BOTH copies of it were corrected** (header ~line 21 AND the
  mid-file note ~455) — that file's own M7-era warning is that a stale unreachability comment is how
  a case stops being checked.
- **THE CORRECTION — acceptance criterion 2 named the WRONG STAGE and is fixed in the plan.** It said
  a back-to-back dependent pair shows a **repeated EX1 cell**. It does not: the interlock lives in ID
  and re-presents its occupant onto the latch it arrived on (`stall.stage: 'ID'`), so `add.s`'s pair
  walks **`IF1 IF2 ID ID EX1 EX2 MEM WB`** — a repeated **ID**, each execute stage visited exactly
  once. **Step 5's browser pass must look at the ID column.** (`add.s`: 7 cycles on `pipeline`, 10
  here.)
- **"Seven in flight" is pinned WITH an honest negative, because the reflex claim is false for 2 of
  11 programs.** `array-sum` holds 7 vs the 5-stage's 5, but `byte-loads` (load-use chain) and
  `paired-branches` (mostly flushes) hold exactly **5 on BOTH** — occupancy is set by hazards, not by
  stage count, so `deep > five` is NOT asserted corpus-wide. **`sum-loop` peaks at 6, not 7** — use
  `array-sum` if the browser pass wants seven occupied columns.
- **The map-side flush assertion is stated FALSIFIABLY**: stage names flushed === rows marked killed,
  swept over corpus × forwarding × prediction. `buildPipelineMap` resolves a victim with a singular
  `find`, so an over-reporting payload records NOTHING — a per-stage "did this resolve?" phrasing
  cannot see that. Engine side stays step 3's.
- **The recorder test's new claim is the STALL SHAPE:** one interlock holds THREE cells at once —
  `ID×4`, `IF2×4`, `IF1×4` — where the 5-stage holds two. The `IF2` one is a SECOND place the INV-4
  re-fetch breach could happen that the 5-stage never exercised. `sum-loop`'s per-iteration walk is
  asserted with repeats COLLAPSED (S_on ≠ 0 here, unlike the 5-stage), guarded by "exactly one of the
  ten walks exceeds seven cycles" so the collapse can't hide a non-stalling engine. `micro` covers
  **six of seven** stages (six latches); IF1 is the one with no latch behind it.

**STEP 3 — THE NET (92 tests, repo 4140 → 4232, `deep-pipeline/src/timing.test.ts`).** The
closed form is **`cycles = N + 6 + S + P`** and it balances in all 66 cells — but **`S` is
stall cycles ON THE RETIRED PATH, not the raw stall count.** All eleven programs' histograms
were hand-derived from the recurrence (required distance **4** forwarding-OFF, **3** for a LOAD
producer with forwarding ON, **2** for any other) before being compared to the engine, and
matched cell-for-cell; every `P` then came out at exactly **2×** the 5-stage's pinned `P`, which
is the corroboration, never the derivation.

- **THE FINDING — `S` is NOT prediction-invariant, so the 5-stage's ported assertion would have
  been WRONG.** `engine/pipeline`'s P matrix asserts `S — untouched by prediction` in every cell.
  **Depth breaks it**, and the mechanism is the pinned resolve point: a transfer resolves at the
  end of EX2, so its fall-through gets a whole LIVE cycle in ID (where `ctx.squash` is still null
  and the interlock really runs) before being killed. `call-return.s` fwd-OFF emits a `'raw'`
  stall at pc 12 under the not-taken behaviour that does NOT exist under `static-taken` (the bet
  kills that instruction in IF2, two stages before the interlock). **The 5-stage CANNOT do this**
  — it resolves a stage earlier, so its fall-through hits ID in the same cycle as the squash and
  takes `stageId`'s early-return. The stall **costs zero cycles** (the redirect is timed off the
  branch's own EX2), hence: closed form over the retired path, BOTH histograms pinned separately
  (raw catches an engine stalling in the wrong places; retired balances the count), and the
  divergence bounded by its own test as the ONLY such cell in the corpus.
- **Flush shapes: FIVE distinct payloads in the corpus, and the shape depends on the FORWARDING
  toggle too** — that same shadow stall leaves EX1 a bubble, so one branch emits `['ID','IF2',
'IF1']` at fwd-OFF and `['EX1','ID','IF2','IF1']` at fwd-ON. Also `['EX1','ID']` (a loop at the
  end of `.text` whose branch stalls long enough to drain the front end) and a width-1 `['IF2']`,
  plus step 1's `['EX1','IF1']`. **Read the penalty as a TOTAL; never assume a shape.**
- **The 5-stage's `casualties ARE the penalty` identity does NOT port** — `sum-loop.s` kills 18
  and pays `P = 36`: the deep pipe pays its full 4-cycle penalty even when the front end has
  already emptied itself. Pinned as the negative WITH the two programs where the two still
  coincide, so it doesn't read as a rule the other way.
- **The `+6` constant needed a HAND-BUILT program.** The 5-stage isolates `+4` on `add.s`; that
  no longer works because this machine stalls `add.s`'s back-to-back pair even with forwarding ON.
  **The corpus has no dependency-free program left — depth took it away**, which is the thesis.
- The reason-encoding test couldn't be ported either: fwd-ON now has **two** reasons
  (`'load-use'` AND `'ex-latency'`) where the 5-stage asserts a single-element set.
- Cross-model numbers stay in **prose** — eslint denies model→model imports and that edge stays denied.

**THE MUTATION CHECK — run as TWO separate mutations, BOTH halves executed** (differential
actually RUN under each stub, not assumed green from prose sitting in two files), reverted with
`git checkout` so the revert is exact:

- **Stub IF2** → INV-8 green 68/68, timing **RED 55/92**; constant `N+5`, mispredict 4→3, bet 2→1.
- **Stub EX2** (switch into EX1, `ex1Ex2` carrying the finished latch, an `EX1/EX2 → EX1` forward
  added, **and the `'ex-latency'` arm DROPPED from `detectHazard`** — without that last part the
  bubble survives and the reddening is under-read) → INV-8 green 68/68, timing **RED 58/92**;
  `add.s` fwd-ON 10 → 9 cycles, `sum-loop.s` 87 → 67, mispredict 4→3.
- **What the EX2 stub does NOT move, so it isn't over-claimed:** load-use stays 2 and fwd-OFF RAW
  stays 3 — both are governed by when MEM/WB happen, and a stubbed EX2 still OCCUPIES its cycle
  (seven stages remain). Only the coefficients that depend on _when the result is finished_ move.

**Step 2 (INV-8, 68 tests, repo 4072 → 4140, green on the first run) — three reusable bits:**

- **The matrix is 6 configs (forwarding × prediction), not the house 18/36, because the cache
  axis is absent BY REFUSAL not omission.** "Restoring" it to match `pipeline`'s matrix
  produces **thrown Errors, not red assertions** — a failure that reads as a broken suite
  rather than as the step-6 scope lever. The docblock says this in those words.
- **`cache: null` is written EXPLICITLY, not inherited from `defaultConfig()`** — the one
  suite in the repo where the field is load-bearing in the NEGATIVE, so a change to that
  default would turn six green cases into six throws rather than a silent behaviour shift.
- **The step-0 guardrail path that had NOT been exercised: `deep-pipeline` →
  `@cpu-viz/engine-conformance` lints CLEAN**, as intended. It is the first import that
  transitively pulls in the **golden reference** (which the deny list names by id), and it is
  allowed because ESLint sees direct specifiers only. Confirmed by RUNNING lint, not assumed
  from the tsconfig reference — finding 7 was a deny-list-SHAPE bug. `tsc -b` was run as its
  own check beside vitest: they resolve the import by different routes (project reference vs
  root alias) and fail for different reasons.

**Repo-count correction for later steps: the pre-step-2 baseline was 4072, not the 4069 below**
— that figure was taken at step 1's first commit, and its follow-up `jal`/`jalr` test commit
added three more.

**Step 1 landed the working machine (18 unit tests, repo 4051 → 4069).** The two
judgement calls that shape everything after it:

- **The EX split is `EX1 = the forwarding network, EX2 = everything else`** (ALU switch,
  `alu-op`, control resolution, the EX2/MEM build). So **`Ex1Ex2Latch` carries OPERANDS,
  never a result** — the ALU→ALU bubble is enforced by the latch's SHAPE, not by a rule
  someone could forget, because there is nothing in that latch to forward. `alu-op` fires
  in the EX2 cycle, not EX1.
- **IF1 reads the instruction word; IF2 does no new work.** The honest-looking alternative
  (IF1 issues the address, IF2 receives it) was REJECTED because an IF1 occupant would then
  have no `encoding`, and `InstructionInstance.encoding` is not nullable — that is the
  trace-schema change the falsifiable criteria make a STOP. IF2's content is DEPTH itself.

**Every PER-HAZARD coefficient was hand-derived and matched the engine on the FIRST run** —
including the "two width-2 flushes" shape below, now CONFIRMED rather than expected. **This
does NOT pre-verify step 3**, whose assertion is the closed form `N+6+S+P` over the full
corpus × forwarding × prediction, where hazards interact and loops repeat them; step 3 is
still the net. Step 1 also found a **THIRD flush shape the plan never named**: an
unpredictable `jalr` correcting one cycle after a younger predictable branch's bet emits a
**non-contiguous `['EX1','IF1']`** (the bet emptied ID and IF2 but refilled IF1). So
`flush.stages` is not always a contiguous run — read the misprediction penalty as a TOTAL,
never as a shape. The new stall reason is **`'ex-latency'`**: not `'raw'` (pinned
repo-wide to mean "forwarding is off" — `pairing-readout.ts:121`, `lessons.test.ts:51`)
and not `'alu-use'` (`lui` stalls a consumer while running no ALU, since the two-cycle
execute is uniform). The halt squash kills **TWO** shadows, and the empty-`stages` guard
is needed on the **bet** path as well as the squash. The mutation check step 3 will run is
written into the processor's file header, because with this split it is not a one-line
edit.

**Step 1's flagged scheduling hazard is RESOLVED** (it wanted a real-engine case in
`packages/web/src/pipeline-map.test.ts` while step 0 had deferred the web trio to step 5):
step 4 took the trio and did not have to move. See the step-4 block above.

**Step 0's reusable finding — the eslint guardrail has THREE code paths, and the plan
only named one.** `deny()` is consumed two ways: lower layers spread `...MODELS`, each
model's own block subtracts itself with `MODELS.filter`. The probe the plan asks for
(`packages/trace` importing the new model) exercises only the spread. The one that
actually matters for M11 is **the new package importing `@cpu-viz/engine-pipeline`** —
step 1 is a FORK of the 5-stage, so that is the import someone reaches for. Without the
new self-exclusion block it lints CLEAN, because the package falls through to the generic
`packages/engine/**` rule which denies only `curriculum`/`web`. Verify a new model in all
three directions, not one. Also: a new `workspaces` entry needs **`npm install`** (no
symlink, no lockfile update otherwise, and `tsc -b` resolves through that symlink), and
the **web trio** (web `package.json` dep, `tsconfig` `paths`, Vite alias) is step 5's, not
step 0's — only `vitest.config.ts`'s alias belongs to the scaffold.

**Scope the user pinned:** the deep pipeline **ALONE**. The wider superscalar is a
separate later milestone — widening is _not_ a new package, it is generalizing M7's
2-specific pairing rules in place (`superscalar/processor.ts` refuses `issueWidth > 2`
by name, because `intra-pair-raw` / `mem-port` / `branch-slot` are written for a pair).
One machine per milestone is the house shape (M7 = superscalar alone, M9 = OoO alone).

**ALL DECISIONS PINNED 2026-07-27** (the user was walked through every open row with pros
and cons and took the recommendations). Three gate code, and they are one coherent rule:
**Option A stage split; EX2 is a REAL half-ALU, uniformly two cycles for every ALU op; every
control transfer resolves at the END of EX2.** One sentence — _nothing is ready until the end
of EX2_ — then explains the branch penalty, the ALU→ALU bubble and the load-use penalty at
once. The resolve point was decided on JALR, not aesthetics: `pipeline/src/processor.ts:784`
resolves every branch AND jump at ONE point, and JALR's target comes out of the now-2-cycle
ALU, so resolve-at-EX1 would need a second resolve point or a dedicated fast adder.

**Two things the plan was MISSING, found while preparing that walkthrough:**

- **The bet is placed in ID** (`pipeline/src/processor.ts:1147`), so in a 7-stage it kills
  IF2 _and_ IF1 ⇒ **a correctly predicted taken branch costs 2, not 1.** Depth taxes you even
  when the prediction is right — kept deliberately as a teaching line (making it cheap again
  means an IF1 BTB, new mechanism, out of scope).
- **The misprediction TOTAL of 4 does NOT arrive as one flush event — CONFIRMED at step 1**,
  no longer a prediction. Prediction OFF: one
  flush of width 4 (EX1+ID+IF2+IF1). Prediction ON: the ID bet kills IF2+IF1, and by the time
  the branch reaches EX2 the EX1/ID slots hold that flush's own bubbles — so the correction
  kills IF2+IF1 again: **two events of width 2.** Step 3 derives the penalty from
  `flush.stages`, so expect this or misread it as a bug. It is also why step 4's
  "every flushed stage has an occupant" assertion guards the COMMON path: the 5-stage filters
  casualties with two null checks (`processor.ts:546-547`), the deep engine needs four, and
  two of the four are genuinely empty on every correctly-bet branch.

Also pinned: `deep-pipeline` / "Deep pipeline", inserted **between `pipeline` and
`superscalar`** — the ordered `honoring()` assertions in `models.test.ts` (~74-96) enumerate
ids in array order, so that insert shifts three or four expectations, not just line 16's list.
Cache stays step 6 (decide after step 3's dump; step 1 REFUSES a non-null cache config by
name so it cannot ship inert), datapath stays sheddable step 7, and the lesson track is its
own later milestone (M9→M10 shape).

**The stage split, now pinned: `IF1 IF2 ID EX1 EX2 MEM WB`** — which is
_exactly_ the seven-stage fixture `packages/web/src/pipeline-map.test.ts` has carried
since M3, in a file whose header still calls the deep stage set "genuinely unemitted by
anything we ship". Making that sentence false is the milestone's job (the M7 step-6 move,
applied to the depth axis instead of the lane axis). The split buys misprediction penalty
2→4, load-use 1→2, and the thesis: **ALU→ALU with forwarding ON goes 0→1 bubble — the
bubble M3's flagship made vanish comes back.** MEM stays a single stage on purpose, so
the MVP never touches M6's miss-freeze (that interaction is quarantined into step 6).

**Why the plan leads with the NET and not INV-8 — the reusable part.** An in-order
7-stage **retires in order**, so `runConformance` passes even if IF2/EX2 are pure
pass-throughs. Combined with M10 step 0's precedent (`slowOpLatency` shipped INERT), the
characteristic failure is fully specified: _a package that typechecks, passes INV-8,
renders on the map, and is a 5-stage wearing seven labels._ Therefore:

- the discriminator is the timing matrix's **coefficients**, never the drain constant
  (`N+4 → N+6` is cheap — any drain change produces it);
- step 3 carries a **pass-through mutation check** — stub IF2/EX2 and INV-8 must stay
  green while timing reddens (if INV-8 is the only thing that reddens, the net is in the
  wrong place);
- two **falsifiable UNCHANGED criteria** guard the INV-3 back door: `pipeline-map.ts`
  needs no edit and the trace schema needs no edit (`location` is a plain string
  precisely to absorb `"IF2"` depth and `"EX.0"` lanes). Reaching for either is a STOP.
  **BOTH ARE NOW PAID OUT — `pipeline-map.ts` at step 4, the trace schema at step 7.**
  Two close calls, each settled by declining rather than widening: an IF1 occupant with no
  `encoding` (rejected that stage split instead) and a datapath wire wanting a latched operand's
  value (lit it bare instead).

Adding a model also has its own ripple, distinct from a corpus ripple — see
[[m9-m10-review-resolved]] for the `eslint.config.js` `MODELS` guardrail (review finding 7) and how to verify it.
