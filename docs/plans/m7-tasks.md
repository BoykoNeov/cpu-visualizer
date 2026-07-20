# Milestone 7 — in-order superscalar: two instructions per stage

**Status: steps 0–1 COMPLETE, step 2a next. 2026-07-20 (1365 tests).** Shipped and PROVEN
headlessly: `predict.ts`/`cache.ts` moved down into `engine-common` with every existing suite green
and zero assertions touched (step 0), and the `issueWidth` config seam with whole-trace inertness
pinned for all three existing models (step 1). **Nothing is browser-verified yet, because nothing
user-visible exists yet** — the first view step is 6. Scope, the reuse strategy, the width toggle,
the view depth, and the sliding/greedy issue grouping were decided with the user (see "Decisions to
pin"). The visual layer was forward-designed in `docs/plans/superscalar-visuals.md` (2026-07-14) and
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

- [x] **0. Extract `predict.ts` + `cache.ts` into `engine-common`.** ✅ Done (2026-07-20, 1358
      tests — the pre-existing count, unmoved). Both modules moved down a layer with `git mv`,
      behaviour untouched; each gained a relocation note explaining why it was always
      model-independent. `engine-pipeline` re-exports the cache READ surface from its new home, so
      **all ten `web` files that read that surface changed zero lines** — the "render a cache,
      never drive one" boundary survives, because `engine-common` necessarily exports `access`/
      `newCache` (models must drive a cache) but the pipeline still re-exports only the read half.
      The forwarding and hazard logic deliberately did not move: it is stage-walk-shaped, and the
      superscalar walk is a different shape. Two things worth recording. **(a) `common` was
      already a tsconfig reference of `pipeline`, but as a declared TEST-ONLY edge** — it is now a
      production edge, and the comment asserting "production code depends only on isa + trace"
      would have become false while every check stayed green; corrected in place, and
      `@cpu-viz/engine-common` added to `pipeline`'s `package.json`, where it had never been
      declared even though tests already imported it. **(b) The deny list was verified by
      PROVOKING it, not by reading it** — a temporary `import { PipelineProcessor }` in
      `engine-common` was confirmed to fail lint with the INV-citing message, then reverted. A
      config guard that is never fired is a guard whose regex is unproven.
      Acceptance met: 1358 tests green with **zero assertions touched**, `npm run lint`, `tsc -b`,
      and the web `tsc --noEmit` all green.

- [x] **1. The config seam — `issueWidth`.** ✅ Done (2026-07-20, 1358 → 1365 tests).
      `ProcessorConfig.issueWidth?: number` is **optional**, following `seed`'s precedent ("only if
      a model needs it") rather than `cache`'s (required, `null` default) — a required field would
      have forced a value into every config literal in the repo to say something none of them mean.
      `ProcessorCapabilities.configurableIssueWidth` is the opposite: **deliberately required**, so
      adding it is a compile error in every model's capabilities constant. That paid immediately —
      `tsc` caught two stub fixtures (`trace/recorder.test.ts`, `conformance.test.ts`) that a model
      defaulting to `false` would have let slide.
      **The inertness proof is the whole-trace form, not a final-state one.** Each model's suite now
      deep-compares the ENTIRE trace array at width 1 vs width 2 (the pipeline under both forwarding
      settings), because `issueWidth` is a TIMING knob: a leak would move cycle counts and event
      order while leaving every architectural result correct — exactly what a final-state check
      cannot see. The probe program carries a backward branch, a store and a load. **Two exhaustive
      `toEqual` capability tests failed, and that was the design working** — they enumerate the flag
      set on purpose so a new knob cannot be added without each model stating its stance.
      Acceptance met: 1365 tests green, `npm run lint`, `tsc -b`, web `tsc --noEmit` all green.

> **Footgun found in step 0, to be paid in step 2.** The eslint deny lists enumerate models **by
> name**, in three separate places (`engine-common`, `engine-conformance`, `reference`) — flat
> config is last-match-wins per rule id with no array merge, which is why each list is a full
> superset rather than an increment. So a new model does **not** inherit those guards: unless
> `'engine-superscalar'` is added to all three, `engine-common` would be silently free to import
> it, and the conformance harness — whose entire design is to import no engine-under-test — could
> couple itself to the new model with lint still green. Add the name to all three lists in step 2,
> and provoke at least one of them to prove the addition works.

> **What actually widens, and what the pairing pins keep narrow.** The three refusal rules are not
> three independent pedagogical choices — they are a **coordinated simplification** that confines
> the widening, and the whole milestone is tractable because of it. No two memory ops pair ⇒ MEM
> does ≤1 access per cycle ⇒ the cache and its miss-freeze stay **single-lane**. No two branches
> pair ⇒ EX resolves ≤1 transfer per cycle ⇒ `bet`/`squash`/redirect stay **single-lane**. No
> intra-pair RAW ⇒ forwarding never resolves a within-group dependency. So what genuinely doubles
> is a short list: **fetch, the register-read ports, the ALU, the WB write ports, and the
> forwarding source set.** Control and memory are held 1-wide _by the rules_, not by luck.
>
> That settles the per-slot vs broadcast split, which is otherwise the easiest thing to get wrong:
> **`memStall` stays broadcast** (a miss freezes both slots of every younger stage); **`squash`
> becomes lane-aware** (a slot-0 branch kills its slot-1 mate and everything behind, a slot-1
> branch spares the older slot-0); **`stalled`** keeps a single-lane producer but freezes a pair.

- [ ] **2a. `engine/superscalar` at width 1 — the faithful single-issue base.** The whole model
      with slot-shaped latches and the widened reverse walk, but **no pairing logic yet**: the
      issue stage takes one instruction per cycle. This is the milestone's bisection anchor, and it
      gets its own commit. **Its net is timing, not INV-8:** a width-1 superscalar never pairs, so
      it must reproduce M3's closed form `cycles = N + 4 + S + P + M` over the corpus — which
      de-risks "did I faithfully re-implement the pipeline" _before_ pairing can muddy it. Also
      due here: **add `'engine-superscalar'` to all three eslint deny lists** (the step-0 footgun)
      and provoke one to prove it fires. Acceptance: the closed form holds over the corpus at
      width 1, under every forwarding × prediction × cache combination.

- [ ] **2b. Pairing — the model's soul.** The issue logic, the refusal verdicts, intra-pair
      forwarding, and lane-aware `squash`. **Grouping is SLIDING/GREEDY** (pinned below): each
      cycle tries the next two undispatched instructions, and a refused younger instruction
      becomes the _older_ of the next group, so pairing recovers. Three trace-contract surfaces
      get pinned here, each provoked by a hand-written program, not assumed:
      **(i) intra-pair WB order** — older-before-younger for the register apply _and_ for
      `events[]`, so if both slots write the same register the younger wins architecturally by
      being applied last (the same class of surface as M3's pinned "reg-write precedes reg-read");
      **(ii) INV-4 id determinism** — the older instruction of a fetched pair gets the lower `seq`,
      load-bearing for follow-an-instruction; **(iii) intra-pair forwarding priority** — the source
      set is now `exMem[0/1]` and `memWb[0/1]`, and the rule is youngest-source-still-older-than-
      the-consumer. Acceptance: a unit test per refusal reason, all three surfaces pinned, and
      `sum-loop.s` completing at both widths with width 2 strictly faster.

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

| Decision                                             | Recommendation (seed)                                                                                                                                                                                                                                                                                                                        | Pinned answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package strategy                                     | New `engine/superscalar`, preceded by extracting `predict.ts`+`cache.ts` to `engine-common`; forwarding/hazard logic forks                                                                                                                                                                                                                   | **PINNED (user, 2026-07-20)** — extract-then-fork, keeping the zero-sibling-imports precedent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Issue width                                          | 2, with an in-model **1 ↔ 2 toggle** — the pedagogy is "more than one", not "many"; the toggle is the flagship same-program A/B                                                                                                                                                                                                              | **PINNED (user, 2026-07-20)** — toggle, not a second model                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| View scope                                           | Full visual layer (datapath + lane hues + readout + IPC tile)                                                                                                                                                                                                                                                                                | **PINNED (user, 2026-07-20)** — full; affordable because M3 step 7 pre-built the map                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Issue-group alignment                                | **Sliding / greedy** — each cycle tries the next two undispatched instructions; a refused younger one becomes the OLDER of the next group, so pairing recovers                                                                                                                                                                               | **PINNED (user, 2026-07-20).** The alternative, aligned packets, is cheaper (a refused slot is just a bubble and the lockstep walk barely changes) but makes pairing depend on **address parity** — an artifact of where an instruction happens to sit, which is a worse thing to teach than the extra machinery is to build. It also undersells the tier: a superscalar whose pairing never recovers is not the money shot. Cost accepted: an issue pointer + a straggler, and a slot is NOT a stable lane. Does not threaten the visuals — lane = per-cycle issue slot, identity = the id/follow-ring, and the map rows are instructions, so lane is not even a map axis |
| Memory ports                                         | **1** — mem-ops never pair with each other; gives the structural-hazard lesson for free                                                                                                                                                                                                                                                      | _(open — step 2b)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Branch slots                                         | **1, and it may sit in either slot** — a taken branch kills its pair-mate too if that mate is younger. Seeded, but the alternative (branches only in slot 0) is simpler to draw; step 2 decides against the real stage walk                                                                                                                  | _(open — step 2b)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Intra-pair RAW                                       | **Never pairs** — if the second instruction reads what the first writes, it goes alone next cycle. Forwarding cannot fix a same-cycle dependency, so this holds at every forwarding setting, which is itself a teachable fact                                                                                                                | _(open — step 2b)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `location` lane encoding                             | `"<stage>.<slot>"` strings — a plain string, so no trace-schema change; `stageFamily` already folds `"EX.0"`→`EX`                                                                                                                                                                                                                            | _(open — step 5)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A new `issue` trace event?                           | **Decline it, pending proof.** `superscalar-visuals.md` proposed `issue` + a pairing-refused event, but `location` gives the slot free and a refusal is "slot 1 empty + a `stall` with a new `reason`". House record: M4 accepted 1 field of 5, M6 added zero. Force the event only if step 8's readout genuinely cannot be drawn without it | _(open — step 8 is the last chance)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Lane hues                                            | `--lane-0` = accent blue, `--lane-1` = magenta `#e87ba4` light / `#d55181` dark — machine-validated 2026-07-14, CVD ΔE 41.3/42.6                                                                                                                                                                                                             | _(open — step 7; do not re-derive, just adopt)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Default width on load                                | **1** — the machine's own degenerate case, so the first picture matches the pipeline the reader just learned, and the toggle is the reveal                                                                                                                                                                                                   | _(open — step 6)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Is a 1-wide superscalar distinct from M3's pipeline? | **Yes, and it must stay so** — it runs issue logic that never finds a pair. If it turns out cycle-identical to M3 on the whole corpus, say so in the plan rather than hiding it; that is a _finding_, not an embarrassment                                                                                                                   | _(open — step 4 will answer this numerically)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
