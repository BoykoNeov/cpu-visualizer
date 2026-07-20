# Milestone 7 — in-order superscalar: two instructions per stage

**Status: NOT STARTED, 2026-07-20.** Nothing shipped. Scope, the reuse strategy, the width
toggle, and the view depth were decided with the user before drafting (see "Decisions to pin").
The visual layer was forward-designed in `docs/plans/superscalar-visuals.md` (2026-07-14) and
M3 step 7 already built most of it — read both before starting.

Source of truth for scope: `cpu-visualizer-spec.md` §12 (roadmap, tier 4). The load-bearing
constraints are the architectural invariants (§3) and the trace schema (§5).

## Why this milestone, and why now

M1–M6 exhausted the **one-instruction-per-stage** family. Every model so far, from single-cycle
to the cached pipeline, holds a property the code leans on everywhere: **stage position is
identity** — "the instruction in EX" names exactly one instruction. M3 made five instructions
overlap; it did not make two of them share a stage.

Superscalar breaks that property, and it is the last in-order thing left. The spec is explicit
that out-of-order (tier 5) must not be approached "until the in-order experience is completely
nailed" — this milestone is what "completely" means. It also pays the first installment on the
`future-microarchitectures` note (deeper pipelines + superscalar), whose only standing demand is
that the pipeline map stay stage-and-lane-parametric — which M3 step 7 already proved with
hand-built traces.

**What is genuinely new machinery**, named precisely:

- **Slot-shaped latches.** `Latches` (`processor.ts:316`) is four nullable _singletons_; each
  becomes an array of `width` slots. This is why the pipeline cannot be parameterized by width
  in place — see the headline.
- **Per-slot hazard signals.** Every `CycleCtx` signal (`stalled`, `memStall`, `squash`, `bet`)
  is today a boolean meaning "the stage's one occupant." Some stay broadcast (a squash kills
  every younger slot); others go per-slot. Getting that split right IS the milestone.
- **Pairing / issue logic.** Brand new: a verdict per cycle on whether the fetched pair may go
  together, and if not, why. No prior model has anything shaped like it.
- **Intra-pair forwarding and intra-pair hazards.** Two instructions in the same stage can
  depend on each other. M3's forwarding walks _older stages_; it has no concept of "the other
  instruction beside me right now."

**What is cheap because it is shared:** ISA semantics (mirrored from the golden reference as
always), the assembler, the whole example-program corpus (INV-7), every panel and the transport
(INV-3), and — after step 0 — the prediction and cache logic.

## Headline decision — a NEW model package, with width as an in-model toggle

Two facts gate this, both verified before drafting rather than assumed:

1. **Sibling-engine imports are legal but unprecedented.** The generic `packages/engine/**` rule
   (`eslint.config.js:104`) denies only `curriculum` and `web`; only `engine-common`,
   `engine-conformance`, and `reference` carry supersets denying sibling models. So
   `engine-superscalar` _could_ import `engine-pipeline` — but **no model imports a sibling
   today.** All four share exactly one thing, `engine-common`.
2. **Single-issue is not a local assumption at issue — it is the shape of `processor.ts`.**
   Four singleton latches, one `Fetched`, and four boolean signals whose comments state the
   one-occupant assumption outright (`bet`: "One casualty, not two"). Widening rewrites the
   stage walk, not a corner of it.

Fact 2 kills "parameterize the pipeline by width." Fact 1 says reuse must go _down_ into
`engine-common`, not _sideways_. So:

**A new `packages/engine/superscalar` package, preceded by a step-0 extraction of `predict.ts`
and `cache.ts` into `engine-common`.** The stage logic forks (it must); the ~300 lines that are
genuinely model-independent stop being duplicated. This keeps the zero-sibling-imports precedent
intact and front-loads the refactor exactly where the plan template wants it.

**Width is a config toggle (1 ↔ 2), not a second model.** The spec's flagship interaction across
all tiers is flipping a feature and watching the _same program_ change behavior. Issue width is
the most legible instance of that in the whole product: load `sum-loop.s`, run it 1-wide, flip to
2-wide, watch rows pair up in the map and IPC rise. The 1-wide position is an **honest machine,
not a duplicate of M3** — it has issue logic that simply never finds a pair, which is precisely
the "pairing failure" picture at its limit. (Same reasoning M6 used to give the cache three
positions rather than two: a toggle position must be a real machine.)

**Scope lever:** the full visual layer ships (widened datapath, lane hues, pairing readout, IPC
tile). This is affordable only because M3 step 7 pre-built the expensive half — the pipeline map
is already lane-parametric (`stageFamily`, `"EX.0"`-shaped locations, proven by hand-built
traces), follow-highlight already composes with a hue, and renderer deltas 1 and 3 already
shipped. **Do not re-plan those.** If the milestone must shed weight, the honest cut is step 8
(readout + IPC tile), never step 7 (the datapath) — a model with no picture is not a tier.

## Build order (each step testable before the next)

- [ ] **0. Extract `predict.ts` + `cache.ts` into `engine-common`.** The refactor this milestone
      finally justifies. Move both modules (85 + 209 lines) down a layer; `engine-pipeline`
      re-exports its public cache READ surface exactly as it does today so no downstream import
      changes. Nothing else moves — the forwarding and hazard logic is stage-walk-shaped and
      stays in the pipeline. Acceptance: every existing suite green **unchanged** (not
      re-baselined), `npm run lint` green, `tsc -b` green, and `engine-common`'s deny list still
      forbids every model.

- [ ] **1. The config seam — `issueWidth`.** Add `ProcessorConfig.issueWidth?: number` (absent /
      `1` = today's machines) and `ProcessorCapabilities.configurableIssueWidth`. **Inertness
      contract, as M4 step 0 pinned it:** every existing model ignores the field and its trace
      stays byte-identical. Acceptance: all four models' suites green with zero diffs; a test
      asserts single-cycle/multi-cycle/pipeline traces are identical with `issueWidth` set to 1
      and to 2 (they honor neither).

- [ ] **2. `engine/superscalar` — the model MVP.** `SuperscalarProcessor`, slot-shaped latches,
      the reverse stage walk widened, INV-4 ids minted per fetched instruction (two per cycle
      when fetching a pair). Pairing rules per the pinned seeds below. Must run correctly at
      `issueWidth: 1` first — that is the cheapest bisection point in the milestone. Acceptance:
      unit tests over the pairing verdict (each refusal reason provoked by a hand-written
      program), plus `sum-loop.s` running to completion at both widths.

- [ ] **3. INV-8 differential net.** `runConformance(() => new SuperscalarProcessor())` across
      the full corpus at **both widths × forwarding × prediction × cache**. Acceptance: green.
      **Read the warning in "How this milestone can lie to itself" before trusting this step.**

- [ ] **4. Timing matrices — the real correctness net.** Closed-form cycle counts for dual-issue,
      in the shape M6 pinned (`cycles = N + 4 + S + P + M`). Dual-issue adds a pairing term; the
      derivation is this step's actual deliverable, and a number that cannot be derived is a bug
      or a rule that was never pinned. Acceptance: a full matrix of exact cycle counts per
      (program × width × config), each one asserted, none of them "whatever the engine printed."

- [ ] **5. Recorder / time-travel proof + the `location` encoding.** `location` becomes
      `"<stage>.<slot>"` (`"EX.0"` / `"EX.1"`) — a plain string, so **no trace-schema change**.
      Prove `follow()` and scrub over a dual-issue recording. Acceptance: recorder suite green;
      a test pins that a 1-wide superscalar emits `"EX.0"` consistently (never bare `"EX"`).

- [ ] **6. Web enablement.** `models.ts` entry + `DatapathKind: 'superscalar'` + the width
      control, gated on `configurableIssueWidth` like every other config control. The map,
      panels, transport, scrub, lessons and sandbox fork come free via INV-3. Acceptance: the
      model is selectable and the **pipeline map shows two rows sharing a column** with zero map
      changes — the claim M3 step 7 made, now cashed against a real engine instead of a hand-built
      trace. **Browser eyeball required.**

- [ ] **7. The widened datapath — `datapath-superscalar.ts`.** Shared front-end (PC, I-mem
      fetching a pair, issue logic) + two replicated execute lanes, per the playbook in
      `docs/templates/new-model-datapath.md`. Add `--lane-0` / `--lane-1` to **both** theme
      blocks (values already validated 2026-07-14 — do not re-invent them). **The relief rule is
      mandatory:** light magenta is 2.62:1 against the surface, so a lane hue never appears
      without a text label. Acceptance: geometry/activation unit tests + contraction-lawfulness
      tests ported from the existing datapath suites; the "one lane lit, one dark" pairing-failure
      picture verified. **Browser eyeball required.**

- [ ] **8. Pairing readout + IPC tile.** The readout names the fetched pair, the verdict, and the
      refusal reason; IPC is **derived by the view** from retire events, never an engine counter
      (INV-2). Acceptance: panel tests + **browser eyeball**; flipping the width toggle on one
      program visibly moves IPC.

## Acceptance criteria (mirror the spec §11 shape)

- [ ] Load `sum-loop.s` on the superscalar model at width 1, then flip to width 2 without
      reloading: the pipeline map visibly pairs rows and the cycle count drops.
- [ ] The datapath shows both lanes lit on a paired cycle and **one lane dark** on a refused one.
- [ ] The readout names the refusal reason, and it agrees with what the map's shape shows.
- [ ] IPC rises between the two widths, and its value equals retires ÷ cycles computed by hand.
- [ ] All suites green; `npm run lint`, `tsc -b`, and `npm run build` green.
- [ ] INV-8 differential passes on the full corpus at both widths × every config combination.
- [ ] Every exact cycle count in step 4's matrix is derived from a stated rule, not observed.

## How this milestone can lie to itself

Recorded up front because the trap is structural, not a matter of care.

**INV-8 is a false safety net here.** In-order superscalar retires in order, so final
architectural state is deterministic and `runConformance` passes essentially for free — it would
pass with the pairing logic _completely wrong_, because pairing changes only _when_ things
happen. Timing is the entire point of this tier, and there is **no golden reference for cycle
counts**. Step 4 is therefore the real net; step 3 is a smoke test wearing a net's clothes. Treat
a green differential as evidence of nothing but "we didn't corrupt the machine."

**The browser is the only net for steps 6–8.** This repo's headless tests are
`renderToStaticMarkup` with no jsdom — **no test can see a click.** 9 of 10 view steps in project
history shipped a defect only the browser caught. Each view step's acceptance line says "browser
eyeball" and means it.

**A header comment asserting behaviour for a case you never observed is where a bug hides**
(M2 step 5e's only real defect, caught by neither tests nor the browser — only by auditing a
claim that had a rationalization attached). With `width × forwarding × prediction × cache` this
milestone has more unobserved case-combinations than any before it. Observe, then assert.

## Decisions to pin (seeded with recommended answers)

| Decision                                             | Recommendation (seed)                                                                                                                                                                                                                                                                                                                        | Pinned answer                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Package strategy                                     | New `engine/superscalar`, preceded by extracting `predict.ts`+`cache.ts` to `engine-common`; forwarding/hazard logic forks                                                                                                                                                                                                                   | **PINNED (user, 2026-07-20)** — extract-then-fork, keeping the zero-sibling-imports precedent |
| Issue width                                          | 2, with an in-model **1 ↔ 2 toggle** — the pedagogy is "more than one", not "many"; the toggle is the flagship same-program A/B                                                                                                                                                                                                              | **PINNED (user, 2026-07-20)** — toggle, not a second model                                    |
| View scope                                           | Full visual layer (datapath + lane hues + readout + IPC tile)                                                                                                                                                                                                                                                                                | **PINNED (user, 2026-07-20)** — full; affordable because M3 step 7 pre-built the map          |
| Memory ports                                         | **1** — mem-ops never pair with each other; gives the structural-hazard lesson for free                                                                                                                                                                                                                                                      | _(open — step 2)_                                                                             |
| Branch slots                                         | **1, and it may sit in either slot** — a taken branch kills its pair-mate too if that mate is younger. Seeded, but the alternative (branches only in slot 0) is simpler to draw; step 2 decides against the real stage walk                                                                                                                  | _(open — step 2)_                                                                             |
| Intra-pair RAW                                       | **Never pairs** — if the second instruction reads what the first writes, it goes alone next cycle. Forwarding cannot fix a same-cycle dependency, so this holds at every forwarding setting, which is itself a teachable fact                                                                                                                | _(open — step 2)_                                                                             |
| `location` lane encoding                             | `"<stage>.<slot>"` strings — a plain string, so no trace-schema change; `stageFamily` already folds `"EX.0"`→`EX`                                                                                                                                                                                                                            | _(open — step 5)_                                                                             |
| A new `issue` trace event?                           | **Decline it, pending proof.** `superscalar-visuals.md` proposed `issue` + a pairing-refused event, but `location` gives the slot free and a refusal is "slot 1 empty + a `stall` with a new `reason`". House record: M4 accepted 1 field of 5, M6 added zero. Force the event only if step 8's readout genuinely cannot be drawn without it | _(open — step 8 is the last chance)_                                                          |
| Lane hues                                            | `--lane-0` = accent blue, `--lane-1` = magenta `#e87ba4` light / `#d55181` dark — machine-validated 2026-07-14, CVD ΔE 41.3/42.6                                                                                                                                                                                                             | _(open — step 7; do not re-derive, just adopt)_                                               |
| Default width on load                                | **1** — the machine's own degenerate case, so the first picture matches the pipeline the reader just learned, and the toggle is the reveal                                                                                                                                                                                                   | _(open — step 6)_                                                                             |
| Is a 1-wide superscalar distinct from M3's pipeline? | **Yes, and it must stay so** — it runs issue logic that never finds a pair. If it turns out cycle-identical to M3 on the whole corpus, say so in the plan rather than hiding it; that is a _finding_, not an embarrassment                                                                                                                   | _(open — step 4 will answer this numerically)_                                                |
