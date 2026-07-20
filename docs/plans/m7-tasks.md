# Milestone 7 — in-order superscalar: two instructions per stage

**Status: steps 0–7 COMPLETE, step 8 (pairing readout + IPC tile) next. 2026-07-20 (2122 tests).**
**The milestone is now BROWSER-VERIFIED through step 7** — the superscalar is selectable, the
width toggle is live, flipping `1-wide → 2-wide` on `sum-loop.s` at forwarding ON moves it
`56 → 44` with the map pairing `IF.0`/`IF.1` in one column, and **the widened datapath draws two
execute lanes that light together on a paired cycle and leave `ALU 1` dark on a refused one**.
Shipped and PROVEN
headlessly: `predict.ts`/`cache.ts` moved down into `engine-common` with every existing suite green
and zero assertions touched (step 0), and the `issueWidth` config seam with whole-trace inertness
pinned for all three existing models (step 1), and the width-1 superscalar base, which reproduces M3’s closed form EXACTLY over the whole corpus × config matrix (step 2a), and **the pairing logic —
sliding/greedy issue, the three refusal verdicts, intra-pair forwarding and lane-aware `squash` —
which makes width 2 strictly faster than width 1 on all 7 corpus programs with identical
architectural results (step 2b), and the INV-8 differential across all 36 configs at both widths,
whose real deliverable was teaching `configLabel` the width axis (step 3), and **the DERIVED width-2
timing matrix — `cycles = G + L + P + M + 4`, every cell of 7 programs × 2 widths × 2 forwarding × 3
prediction × 3 cache derived rather than observed, confirming all six provisional step-2b pins
(step 4)**, and the **time-travel proof — `follow()` and scrub over a dual-issue recording with
`recorder.ts` UNTOUCHED, pinning that a slot is not a stable lane (an instruction slides 1→0, its
neighbour 0→1, a third slides inside IF) and closing a REAL cache-aliasing hole that 694 green
tests had missed (step 5)**, and the **web enablement — the model selectable, the width toggle
riding the config seam as a fourth knob, and the map's lane claim cashed against a real engine
(step 6, the first eyeballed step and the second view step in project history to survive one with
no defect found)**, and the **widened datapath — a shared front-end feeding two replicated execute
lanes, with issue width as a THIRD structural axis, three encoding channels (wire = stage,
box = lane, ring = identity) that required overriding this milestone's own visuals doc, and two
replications that looked shared until a real width-2 trace was dumped (step 7, browser-verified
clean)**.** Step 8 is the remaining
user-visible work. Scope, the reuse strategy, the width toggle,
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

- [x] **2a. `engine/superscalar` at width 1 — the faithful single-issue base.** The whole model
      with slot-shaped latches and the widened reverse walk, but **no pairing logic yet**: the
      issue stage takes one instruction per cycle. This is the milestone's bisection anchor, and it
      gets its own commit. **Its net is timing, not INV-8:** a width-1 superscalar never pairs, so
      it must reproduce M3's closed form `cycles = N + 4 + S + P + M` over the corpus — which
      de-risks "did I faithfully re-implement the pipeline" _before_ pairing can muddy it. Also
      due here: **add `'engine-superscalar'` to all three eslint deny lists** (the step-0 footgun)
      and provoke one to prove it fires. Acceptance: the closed form holds over the corpus at
      width 1, under every forwarding × prediction × cache combination.

      ✅ **Done (2026-07-20, 1365 → 1684 tests, +319).** Slot-shaped latches
      (`ifId`/`idEx`/`exMem`/`memWb` are arrays of length `width`, index 0 = OLDEST in program
      order), the reverse walk iterating slots, and `reset()` **throwing** on any width ≠ 1 — an
      honest "not yet" rather than silently running narrow. Everything observable is mirrored from
      M3: the EX switch's ISA idioms, intra-cycle event order, halt-with-drain, the real-casualties
      flush rule, the bet's single casualty, the MEM three-way cache split, and the
      EX/MEM-beats-MEM/WB forwarding priority.
      **The closed form held on the first run with zero numbers adjusted** — and that was verified
      independently of the implementer: the `TIMING` table's per-program pinned constants
      (`transfers`, `stalls`) are **byte-identical** to `engine-pipeline`'s, so the suite asserts
      against M3's hand-derived numbers rather than this engine's own output, which is the entire
      point of the step. The eslint guard was **provoked, not read** (a temporary
      `@cpu-viz/engine-pipeline` import failed with the INV-citing message, then reverted).
      Two deviations from M3 worth naming. **(a) `Squash` became `{ reason, slot }`** rather than a
      bare string; at width 1 the resolver is always in EX so every ID/IF occupant is younger and
      behaviour is exactly M3's — the field only starts discriminating in 2b, but carrying it now
      is what keeps 2b from being a rewrite. **(b) Only `location` is slotted** (`"EX.0"`); **event
      fields stay bare** (`stall.stage: 'ID'`, `flush.stages: ['ID','IF']`, `forward.to: 'EX.rs1'`),
      and a test pins that boundary — otherwise the slot encoding would have leaked into three
      event types the schema shares with the map, the datapath and the curriculum.
      One bug class was caught by a test rather than by conformance: the micro snapshot `.slice()`s
      its slot arrays instead of aliasing them. Final-state conformance is structurally blind to
      aliasing, so it would have surfaced as a corrupt recording at step 5, far from its cause.
      Acceptance met: 1684 tests green, `lint`, `tsc -b`, web `tsc --noEmit`, `format:check` green.
      **The deny lists were already paid** — the step-0 footgun note was acted on at scaffold time,
      so all three lists plus a dedicated `packages/engine/superscalar/**` block existed before the
      model's first line.

- [x] **2b. Pairing — the model's soul.** The issue logic, the refusal verdicts, intra-pair
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

      ✅ **Done (2026-07-20, 1684 → 1705 tests, +21).** Width 2 is a real machine: the corpus runs
      **strictly fewer cycles at every one of the 7 programs** with byte-identical architectural
      results (`sum-loop.s` 56 → 44, `array-sum.s` 51 → 42, `array-sum-twice.s` 208 → 178). The
      counts are pinned as EXACT numbers in `pairing.test.ts`, not as inequalities — an inequality
      lets the issue logic drift a cycle either way and still pass, which for a timing-only tier is
      no net at all. All three surfaces pinned, one test per refusal reason (`mem-port`,
      `branch-slot`, `intra-pair-raw`, plus `load-use`/`raw` proven still live at width 2).

      **The width-1 timing suite was the net, and it held with zero numbers touched.** Every one of
      M3's 180 transplanted assertions stayed green through a rewrite of the issue stage, the IF
      hand-over and MEM's freeze rule. That is what step 2a was for.

      **Five findings worth carrying.**
      **(a) One real bug, caught by a test conformance is structurally blind to.** A cache miss in
      `MEM.0` froze only its own slot, so a non-memory instruction paired BEHIND it sailed into WB
      and **retired ahead of it** — out-of-order retirement in a machine whose whole premise is
      in-order retirement. Final-state conformance cannot see it (both instructions retire in the
      end, and the answers are identical); it was caught by asserting that the retire-id sequence is
      strictly increasing across the corpus at both widths × cache. The fix is directional: the
      freeze propagates DOWNWARD in age only — an older slot beside a *younger* miss keeps going,
      which is both correct and observable (`MEM.0` retires while `MEM.1` waits out ten cycles).
      **(b) A betting branch needs no fourth pairing rule.** The tempting extra rule is "a branch
      that bets may not pair". It buys nothing: refusing to pair leaves the same fall-through
      stranded in IF/ID as a *survivor* that is still wrong-path and still has to die — a longer
      route to the same funeral. Letting it pair and killing it with the bet is strictly simpler,
      so `Bet` carries a slot and the bet's flush names `ID` when it had a mate.
      **(c) `flush.stages` gained `'EX'`, and event fields stay BARE — re-decided, not inherited.**
      Step 2a deferred "should `stages` name slots once a pair can die together" until one was
      observed. One was: a mispredicting branch in `EX.0` kills its `EX.1` mate. The answer is still
      no — `stages` answers "which stages lost someone", the map and datapath key off stage
      families, and slotting would fork three event types the schema shares with the map, the
      datapath and the curriculum for a distinction all three would fold straight back out. A
      consumer needing the identity of the dead has `instructions[]`. Also new: a **halt** flush can
      now name `ID` (at width 1 the halting instruction WAS ID's only occupant).
      **(d) No new trace event, and the decision can now be closed early.** Refusals ride
      `stall.reason`, which the schema types as a free-form string — so three new reasons cost zero
      schema change. Step 8 remains the last chance to prove an `issue` event is genuinely
      undrawable without.
      **(e) The observe-then-assert rule caught a test passing for the wrong reason.** The "branch
      in `EX.1` spares the older `EX.0`" test was, as first written, exercising a slot-**0** branch:
      without a spacer instruction the branch is refused for an intra-pair RAW and **slides into
      slot 0**, so the test asserted the lane-aware case while demonstrating its opposite — and
      passed. Only dumping the trace and reading it found this. Sliding makes a whole new class of
      test-lies possible, because a slot is not a stable lane: **any test naming a slot must have
      been watched, not reasoned about.**

      One deletion worth recording: **M3's `stalled` broadcast boolean is gone.** With sliding
      issue, "the stage froze" is expressed by which seats ID left occupied in `next.ifId`, and IF
      simply fills the free ones — so the three special cases in `stageIf` (stall / bet / normal)
      collapse into one hand-over rule, and the classic width-1 stall picture falls out of it
      unchanged. `memStall` stays a broadcast flag, because a single-ported miss really is a
      property of the machine rather than of a seat.
      Acceptance met: 1705 tests green, `lint`, `tsc -b`, web `tsc --noEmit`, `format:check` green.

- [x] **3. INV-8 differential net.** `runConformance(() => new SuperscalarProcessor())` across
      the full corpus at **both widths × forwarding × prediction × cache**. Acceptance: green.
      **Read the warning in "How this milestone can lie to itself" before trusting this step.**

      ✅ **Done (2026-07-20, 1705 → 1835 tests, +130).** The matrix is 2 widths × 2 forwarding × 3
      prediction × 3 cache = **36 configs × 7 programs = 252 cases**, all green. The +130 is the
      width-2 DELTA (126 new cases) plus 4 new harness guards — the width-1 half of the matrix was
      already there from 2a, which is why that half of the count appears twice and is easy to
      misread. **The green is worth exactly what the plan said it would be worth and no more:** it
      proves pairing does not CORRUPT the machine, and nothing else. Width-invariance of final state
      is what the design predicts, not evidence it works — step 2b's out-of-order-retirement bug ran
      green through a matrix of this exact shape. Step 4 is still the net.

      **The step's real deliverable was the label, not the differential.** `configLabel` did not know
      `issueWidth`, so the 36 configs would have rendered as **18 labels used twice** (2×3×3 names,
      each shared by a width-1 and a width-2 case) — the M4 collision
      exactly, and this time **with its alarm disconnected**. Every earlier axis had a failing column
      available to make someone read the titles; width does not, since both columns are green by
      construction. A duplicated-title report would have looked indistinguishable from a correct one,
      forever. The clause is gated on variation like its predecessors, and the optional `?: number`
      means every pre-M7 config leaves it `undefined` — so those suites stay silent **for free**
      rather than by a special case, and their titles are byte-identical (verified by dumping them,
      not by reasoning: the only 6 `width` hits across the other models are pre-existing "store
      widths" and step-1 inertness tests).

      **All four guards were provoked in BOTH directions**, which is the house discipline and earned
      its keep here. Stubbing the clause to `false` fails the two distinctness guards; forcing it to
      `true` fails the two silence guards. The second pair is the one that pins against the naive
      implementation, and it needed **two** cases, not one: a `width`-unset list (pre-M7 suites) and
      a list where the width is **set but constant** — because the superscalar suite states
      `issueWidth: 1` explicitly, so an implementation blind-by-`undefined` would pass the first
      guard while still labelling the second. A guard whose case list cannot reach the collision is
      not a guard, one axis further down.
      Acceptance met: 1835 tests green, `lint`, `tsc -b`, web `tsc --noEmit`, `format:check` green.

- [x] **4. Timing matrices — the real correctness net.** Closed-form cycle counts for dual-issue,
      in the shape M6 pinned (`cycles = N + 4 + S + P + M`). Dual-issue adds a pairing term; the
      derivation is this step's actual deliverable, and a number that cannot be derived is a bug
      or a rule that was never pinned. Acceptance: a full matrix of exact cycle counts per
      (program × width × config), each one asserted, none of them "whatever the engine printed."

      ✅ **Done (2026-07-20, 1835 → 2050 tests, +215.)** The closed form is

      > **`cycles = G + L + P + M + 4`** — G = issue-group cycles, L = BLOCKING stalls,
      > P = the speculation penalty, M = misses × penalty.

      **The `+4` is width-invariant** (pipeline depth, not width), so the entire problem reduces to
      deriving the issue schedule. At width 1, `G = N` and `L = S`, so it **reduces to M3's
      `N + 4 + S + P + M`** — asserted, not hand-waved. The matrix is 7 programs × 2 widths × 2
      forwarding × 3 prediction × 3 cache, every cell derived, with each term (`G`, `Q`, `L`, `P`,
      `M`, `N`) asserted **separately** so a failing cell names the term that moved.

      **The headline finding: nothing disagreed.** All six provisional step-2b pins are CONFIRMED.
      That is a real result rather than a non-event, because the route was genuinely independent —
      the derivation was validated by predicting all seven **forwarding-OFF** counts, which had no
      pin to copy, *before* the engine was run, and all seven were right. The pins' warning comment
      in `pairing.test.ts` has been rewritten accordingly.

      **Five findings worth carrying.**
      **(a) `S` splits at width 2, and half of it is FREE.** At width 1 a `stall` event is always one
      lost cycle. At width 2 a refusal in **slot 1** leaves slot 0 issuing, so the group merely ends
      early and nothing is lost. `call-return.s` with forwarding off fires such a refusal and runs at
      exactly the same 14 cycles as with it on. Hence the term is `L` (blocking stalls), counted
      DIRECTLY as "a stall event fired and nothing issued" — **never as a residual**, which would
      have made the closed-form assertion `0 === 0` and passed for any engine. `array-sum-twice.s`
      fires 50 free refusals; a reader who called the stall-event total "S" would over-charge it.
      **(b) `G` and `Q` are NOT prediction-invariant — the plan did not predict this.** Under
      `static-taken` a betting branch sets `killedRest`, so **every bet from slot 0 with a live mate
      costs a pair**. A CORRECT bet kills a mate that was doomed anyway (`Q−1`, G unchanged); a WRONG
      bet kills a mate on the correct path, which is re-issued and costs a group **iff it cannot
      re-pair** — `array-sum.s`'s `lui t3` cannot (intra-pair RAW with `addi t3`) so `G+1`, while
      `sum-loop.s`'s `addi a7` re-pairs with `ecall` and costs nothing. A bet from slot 1 costs
      neither (`branch-flavors.s`, where both branches sit in slot 1). It is encoded as that RULE
      plus deltas, not as a 28-cell table of observations.
      **(c) `P` and `M` ARE width-invariant, and that is why `penaltyOf` carries over unchanged.** A
      mispredict costs 2 and a correct bet 1 at both widths — the reasons are about the redirect's
      clock edge, not about how many instructions travel abreast. `M` is invariant because the
      mem-port rule keeps MEM single-lane, so width cannot reorder the address stream. `L` is
      prediction- AND cache-invariant: a miss freezes IF/ID/EX/MEM *together* so producer-consumer
      distances survive it, and the freeze emits no `stall` event at all, so its cycles are charged
      to `M` and never to `L`. All three asserted rather than assumed.
      **(d) `killedRest`'s slide-suppression is DEAD CODE, found by provoking.** Deleting the flag
      outright left all 680 package tests green: `stageIf` runs after `stageId` in the reverse walk
      and clears every seat of `next.ifId` on a bet or squash regardless. The `break` is load-bearing;
      the flag is not. The code is KEPT (ID should not silently depend on a sibling stage undoing its
      work) but its comment, which claimed the kill outright, now says who really does it — and
      `processor.test.ts` pins IF as the enforcer, so the redundancy cannot quietly become
      load-bearing again. **This is the M2-5e shape exactly: a claim with a rationalization attached.**
      **(e) The observe-then-assert rule caught two of my own claims, both about SLOTS.** First:
      "every taken transfer strands a doomed mate" is FALSE — `branch-flavors.s` has 1 taken transfer
      and 0 doomed mates, because both its branches issue from slot 1 and the fall-through dies in IF
      without ever consuming a slot. Second: "after a bet, ID and IF are both empty" is half false —
      IF is cleared and then *immediately refills from the redirected pc*, which is precisely why a
      bet costs 1 and not 2. Both were reasoned, both were wrong, both were fixed by dumping the
      trace. **Step 2b's warning generalizes: any claim naming a slot must be watched.**

      **What a green here is worth, stated exactly.** Anchored OUTSIDE the engine: the width-1 column
      (M3's numbers), `P` (`penaltyOf`), `M` (the miss table), and **`sum-loop.s = 44`, which this
      plan derived independently before the suite existed** — the one deep external check on the
      pairing concept, and it holds. Internal-consistency only: the width-2 `G`/`Q` for the other six.
      The suite says so in its own header rather than overclaiming.
      **The net was PROVOKED, not trusted.** A spurious extra pairing refusal fails 24 assertions
      across all 18 `sum-loop.s` matrix cells — while `differential.test.ts` stays **green**, cashing
      the plan's warning that INV-8 is a false safety net here. (A first provocation refusing a `lui`
      partner was a no-op, because the `la` idiom already refuses it for intra-pair RAW — a reminder
      that a provocation must be confirmed to bite before it proves anything.)
      Acceptance met: 2050 tests green, `lint`, `tsc -b`, web `tsc --noEmit`, `format:check` green.

- [x] **5. Recorder / time-travel proof + the `location` encoding.** `location` becomes
      `"<stage>.<slot>"` (`"EX.0"` / `"EX.1"`) — a plain string, so **no trace-schema change**.
      Prove `follow()` and scrub over a dual-issue recording. Acceptance: recorder suite green;
      a test pins that a 1-wide superscalar emits `"EX.0"` consistently (never bare `"EX"`).

      ✅ **Done (2026-07-20, 2050 → 2064 tests, +14.)** It is a **PROOF, not a build**:
      `packages/trace/src/recorder.ts` is **untouched** by this milestone. That is the claim that
      could have failed and didn't — `follow()` keys on `id`, never on `location`, and
      `InstructionSighting.location` was always free-form (its own doc cites `"ROB#3"`), so two
      instructions sharing a stage resolve to distinct `"EX.0"`/`"EX.1"` sightings for free. **A
      recorder change here would have meant the `location` encoding was the wrong encoding.**
      The acceptance's width-1 clause was **already met** at the engine layer (`processor.test.ts`
      pins the `.0` spelling and the `IF.0 → … → WB.0` walk), so the new file re-proves none of it
      and says so in its header, following the M3 step-4 discipline.

      **Four findings worth carrying.**
      **(a) The headline: a slot is NOT a stable lane, and it is now pinned three ways.** An
      instruction refused for `intra-pair-raw` in slot 1 **slides to slot 0** and finishes there
      (`IF.1 → ID.1 → ID.0 → EX.0 → MEM.0 → WB.0`); the instruction behind it slides the OTHER way,
      **0 → 1**, to pair with the slider; a third slides **while still in IF**. Sliding is not
      monotone and not one-directional — which is exactly why "lane" is the wrong word for a slot.
      Also pinned: a slide never re-mints the id (INV-4 — the failure mode a seat change makes newly
      plausible), and the stage FAMILY sequence stays monotone even when the slot does not.
      **(b) `sum-loop.s` does NOT slide, and assuming it would have been the test-lie.** The natural
      workhorse was dumped first and every one of its instructions keeps its slot for its whole life
      (`i5: IF.1 → ID.1 → EX.1`). A four-instruction program had to be **written** to provoke a
      slide. This is step 2b finding (e) and step 4 finding (e) landing a third time: **every
      expected `location` in the new suite was dumped and read before it was asserted.**
      **(c) Provoking the net found a REAL hole that 694 green tests did not.** Aliasing the cache
      into the snapshot (`cache: this.cache`) left the **entire package green** — conformance,
      timing, pairing, and the engine's own `does not alias slot arrays` test included — while
      genuinely corrupting every recording: the cache is single-buffered and mutated in place, so a
      shallow snapshot replays a cold cache as **warm-from-the-start** (cycle 0 reported the final
      run's 2 valid lines). Time-travel is the only layer at which that is observable, which is
      precisely what this step exists for. Now pinned by a staircase-not-flat-line assertion plus
      per-cycle object identity, and the test was **watched failing under the bug before being kept**.
      **(d) The neighbouring `.slice()` is defensive, not load-bearing — the M7-4(d) shape again.**
      Deleting the four latch slices left all 694 tests green too, but here that is CORRECT rather
      than a hole: `step()` allocates a fresh `emptyLatches(width)` as `ctx.next` every cycle, so the
      arrays cannot alias. The engine's existing anti-aliasing test passes on **array identity**,
      which the fresh-rebuild discipline satisfies for free — it never covered the cache at all. The
      slices are KEPT (a snapshot should not depend on a caller's allocation discipline) but the
      doc comment, which claimed both copies prevented "replaying every recorded cycle as the final
      one", was **false for the latches and true for the cache** and now says which is which.
      Also fixed in passing: `index.ts`'s header still said "at M7 step 2a only width 1 exists",
      three steps stale — the same class of untrue-header the milestone keeps warning about.
      Acceptance met: 2064 tests green, `lint`, `tsc -b`, web `tsc --noEmit`, `format:check` green.

- [x] **6. Web enablement.** `models.ts` entry + `DatapathKind: 'superscalar'` + the width
      control, gated on `configurableIssueWidth` like every other config control. The map,
      panels, transport, scrub, lessons and sandbox fork come free via INV-3. Acceptance: the
      model is selectable and the **pipeline map shows two rows sharing a column** with zero map
      changes — the claim M3 step 7 made, now cashed against a real engine instead of a hand-built
      trace. **Browser eyeball required.**

      ✅ **Done (2026-07-20, 2064 → 2074 tests, +10). BROWSER-VERIFIED** — the milestone's first
      eyeballed step, and only the **second view step in project history to survive one with no
      defect found** (M5 step 5 was the first). Recorded as a finding rather than a non-event: the
      house prior is 9-of-10 view steps shipping a browser-only defect, so a clean pass is the
      claim that needed evidence, not the one that gets assumed.

      **The acceptance, cashed live.** `sum-loop.s` on the superscalar, forwarding ON, flipping
      `1-wide → 2-wide` **without reloading**: `56 → 44` cycles, the exact numbers step 4 derived.
      The map then shows `IF.0`/`IF.1` in one column, `ID.0`/`ID.1` in the next, `EX.0`/`EX.1` in
      the next — **two rows sharing a column, from a real recording**, which is the M3-step-7 claim
      that had only ever been shown against a hand-built trace. Gating was checked in **both**
      directions: the ISSUE control is present on the superscalar and **absent** on the pipeline
      model, which keeps forwarding/predict/cache. Console clean — no app errors and, specifically,
      no module-resolution failure (the risk `fix(web): resolve engine-pipeline to source` had
      already made real once, and the one thing Vitest cannot rehearse because the dev server
      resolves differently).

      **Four findings worth carrying.**
      **(a) The transport is 0-INDEXED, and it is a live off-by-one trap for exactly this check.**
      `lastCycle = recordedCycles - 1` (`App.tsx:125`), so a 56-cycle run reads **`cycle 55 / 55`**
      and a 44-cycle run reads **`43 / 43`**. Every pinned cycle count in this milestone is a trace
      LENGTH. A verifier comparing the on-screen number to the pinned one sees a one-off mismatch
      and has two bad moves available — report a phantom defect, or "correct" the pinned number and
      silently destroy the step-4 matrix. **Read `X / Y` as `Y + 1` cycles.** This was hit for real
      during the step-6 eyeball and resolved by reading `App.tsx`, not by assuming.
      **(b) The app opens at forwarding OFF, and 56/44 are forwarding-ON numbers.** `W1`/`W2` in
      `pairing.test.ts` both set `forwarding: true`. Flipping only the width from a cold load
      compares the wrong pair of cells, so the flagship A/B **must set forwarding ON first**. The
      out-of-the-box default reads `77 / 77` = 78 cycles — which is itself the derived
      forwarding-OFF width-1 cell (`N + 4 + S + P + M = 34 + 4 + 22 + 18 + 0`), so the browser
      incidentally confirmed a second matrix cell. Both traps in (a) and (b) push the SAME
      direction: the honest number looks wrong at a glance.
      **(c) The `.0` encoding is visible in the shipped UI, and the two spellings coexist.** The
      superscalar map draws `IF.0`/`EX.0` at width 1 while the M3 pipeline map beside it still
      draws bare `IF`/`EX`. That is the encoding decision working as designed — the slot suffix is
      the superscalar's `location`, not a global map change — and it is the first time both have
      been seen in one session rather than argued about.
      **(d) `datapath: 'none'` renders as "Superscalar datapath — coming soon", as intended.** Not
      a defect; step 7 is the deliverable. Worth stating because a missing diagram is precisely the
      shape of thing an eyeball is tempted to log as a bug.

      **Scrub was exercised too, closing the one live interaction the checks above miss.** Dragging
      back to cycle 3 of the width-2 recording redraws the playhead and shows the first pair tracked
      together — `addi x10,x0,0` in `MEM.0` beside `addi x5,x0,10` in `MEM.1`, with the pair behind
      them in `EX.0`/`EX.1` — and the readout says **`7 in flight`**, where width 1 tops out at 5.
      `ecall` sits alone in `IF.0`/`ID.0`, which is the refusal picture step 8's readout will name.
      Step 5 had already proven `follow()`/scrub headlessly, so this confirms rather than discovers;
      it is recorded because "the map renders a paired trace" and "you can scrub back INTO one" are
      different claims and only the first was covered. Also confirmed in passing: **the config
      survives a model round-trip** — switching superscalar → pipeline → superscalar kept forwarding
      ON and the width at 2, and the re-run landed on `43 / 43` again.

- [x] **7. The widened datapath — `datapath-superscalar.ts`.** Shared front-end (PC, I-mem
      fetching a pair, issue logic) + two replicated execute lanes, per the playbook in
      `docs/templates/new-model-datapath.md`. Add `--lane-0` / `--lane-1` to **both** theme
      blocks (values already validated 2026-07-14 — do not re-invent them). **The relief rule is
      mandatory:** light magenta is 2.62:1 against the surface, so a lane hue never appears
      without a text label. Acceptance: geometry/activation unit tests + contraction-lawfulness
      tests ported from the existing datapath suites; the "one lane lit, one dark" pairing-failure
      picture verified. **Browser eyeball required.**

      ✅ **Done (2026-07-20, 2074 → 2122 tests, +48). BROWSER-VERIFIED, no defect found** — the
      third view step in project history to survive an eyeball clean, and the second in a row for
      this milestone. 27 nodes / 89 wires: shared front-end (`pcmux`, `pc`, `+4n`, `imem`, the
      issue and hazard units, one register file), two replicated execute lanes, re-converging on
      ONE data memory and a shared writeback bus.

      **The headline is a plan-vs-shipped-reality conflict, surfaced rather than worked around.**
      `superscalar-visuals.md` (2026-07-14) says "everything on lane 0's path renders in the lane-0
      hue". That document PREDATES M3 step 6 shipping, and by now the wire stroke is spoken for: it
      means STAGE, in the same `PHASE_COLORS` set the pipeline map directly above the diagram uses.
      Obeying the doc would have put two color grammars on one screen — the map saying blue = IF
      while the datapath said blue = lane 0 — and would have made `EX.0` and `EX.1` DIFFERENT
      colors, destroying the one reading this tier exists to produce: *two instructions in EX*.
      **PINNED BY THE USER (2026-07-20): three channels, split by what can honestly carry each —
      wire stroke = STAGE, node tint = LANE, follow ring = IDENTITY.** A shared box stays
      hue-neutral for M3's pinned reason (the register file is read by ID and written by WB in one
      cycle, so it belongs to no single anything); a REPLICATED box does not have that problem,
      which is exactly what makes it the one thing that can carry the lane. Renderer cost: one
      `NodeVM.hue` field — literally delta 1 of the visuals doc, so planned, not invented.

      **Eight findings worth carrying.**
      **(a) Two replications LOOKED shared and are not — both settled by dumping a real width-2
      trace.** `pcarith` replicates: two `lui`s pair happily (neither memory ops, nor transfers, nor
      RAW-dependent) and U/J producers emit no `alu-op` at all, so a cycle really can hold
      `EX.0=lui` and `EX.1=lui`, each needing the dedicated adder at once. The MEM→WB bypass
      replicates: two non-memory instructions in `MEM.0`/`MEM.1` ride past the memory together, and
      one shared wire could only name one of them — the follow-ring would have silently pointed at
      the wrong instruction. **And the converse is pinned too:** `dmem` does NOT replicate, because
      the mem-port rule caps MEM at one access per cycle, asserted over the whole corpus rather than
      assumed. Three units, three different answers, none of them guessable from the diagram.
      **(b) `forward.from` names the LATCH, not the slot — a real trace-contract limit, found by
      dumping.** It is `'EX/MEM'` / `'MEM/WB'` and carries no slot (event fields stay BARE, pinned
      at 2b). So the SOURCE lane of a forward is a fact the trace does not have, and every forward
      wire starts at a latch BAR. Drawing a source slot would be a coin-flip rendered as hardware.
      The SINK lane is known (the consumer's own slot), so the forward wires are lane-tagged at
      their destination end only — and a test pins that no forward wire ever sources a slot, so a
      later "improvement" cannot invent the fact.
      **(c) The "one lane dark" claim is about the EXECUTE band ONLY, and its own test caught the
      over-claim.** The first draft asserted that no lane-1 wire ANYWHERE was lit on a refused
      cycle, and it failed: a machine that refused a pair in ID is still happily fetching two
      instructions into `IF.0`/`IF.1` behind it. That is the machine working — the refusal narrows
      the ISSUE point while the front-end keeps running wide. **Confirmed in the browser**, which is
      the nicer version of the same fact: at the dark-lane cycle, `ALU 1` is fully grey while
      `Sign Extend 1` is lit magenta beside it.
      **(d) The refusal BADGE and the dark lane are one cycle apart, which step 8 must not assume.**
      The refusal fires in ID (deciding the next group) while EX still holds the previously-issued
      pair, so the verdict text appears a cycle BEFORE the picture it explains. Observed live on
      `array-sum-twice.s`: the badge at cycle 2, the solo `ALU 0` at cycle 5. A readout that assumed
      they coincide would narrate the wrong cycle.
      **(e) The fetch adder is `+4n`, not `+8`.** The machine advances four bytes PER INSTRUCTION
      FETCHED, and that count is 1 or 2 depending on how many IF slots were free — so a hard `+8`
      would be wrong on exactly the cycles a refusal makes interesting. The wire carries the real
      number from the trace; a test pins the `+4` case specifically.
      **(f) `issueWidth` is a THIRD structural axis, and its lawfulness is TESTED rather than
      argued.** Hiding lane 1 and the issue unit at width 1 is honest only if the trace genuinely
      cannot light them there, so that is asserted over the whole corpus × three configs: no
      width-1 cycle emits a `.1` location, no width-1 stall carries a pairing reason. If one ever
      did, the honest fix would be to draw an IDLE lane, not to keep hiding it. (The issue unit is
      the arguable one and is documented as such: a width-1 superscalar does run issue logic, but
      this box draws the PAIRING verdict, and with one candidate there is no such question. The
      ordinary hazard check it still runs is drawn by the separate, width-independent `hazard`.)
      **(g) Twelve diagonal-wire failures on the first geometry run, all the same mistake.** Every
      one was a hand-typed endpoint `y` that did not match the node edge it claimed to land on. The
      fix was structural rather than twelve arithmetic corrections: **every coordinate is now
      DERIVED from the node via `at()`/`aUp()`/`aLo()`**, so a node that moves drags its wires with
      it instead of silently detaching. The `ly` lane-pitch local became unused as a result, which
      is the good sign — nothing is positioned by re-deriving the pitch a second time.
      **(h) Label/box overlap was MEASURED in the browser, not eyeballed.** The `expert` tier looked
      crowded around the stacked issue/hazard units, so rather than guess, every rendered
      `.dp-ctrl-label` and `.dp-vlabel-text` bbox was intersected against every node bbox in SVG
      space: **zero overlaps**. The crowding was legal 4px clearance, the renderer's standard. Worth
      recording as a technique — "it looks tight" is exactly the judgement an eyeball is worst at.

      **What the browser cashed, beyond the acceptance.** `sum-loop.s` at forwarding ON flipped
      `1-wide → 2-wide` live: **56 → 44**, and `array-sum-twice.s` **208 → 178** — four pinned
      matrix cells, two of them the step-4 numbers for the straddler program. At the paired cycle,
      `ALU 0` reads `10` and `ALU 1` reads `9`, **byte-identical to the dumped trace** (`i2:add`
      → 10 in `EX.0`, `i3:addi` → 9 in `EX.1`). Node count 26 → 18 across the width flip with no
      lane-1 text anywhere. Legend reads `Fetch · Decode · Execute · Memory · Writeback · Lane 0 ·
      Lane 1 · idle`, every swatch beside its own word (the relief rule, satisfied structurally and
      pinned by a test that every lane-tinted node carries its lane in its own label). Console clean
      — no app errors and, specifically, no module-resolution failure. **The 0-indexed transport
      trap from step 6 bit again and was handled by the note**: `cycle 5 / 177` is a 178-cycle run.
      Acceptance met: 2122 tests green, `lint`, `tsc -b`, web `tsc --noEmit`, `format:check`,
      `npm run build` all green.

- [x] **8. Pairing readout + IPC tile.** The readout names the fetched pair, the verdict, and the
      refusal reason; IPC is **derived by the view** from retire events, never an engine counter
      (INV-2). Acceptance: panel tests + **browser eyeball**; flipping the width toggle on one
      program visibly moves IPC.

      ✅ **Done (2026-07-20, 2122 → 2142 tests, +20).** `pairing-readout.ts` (pure fold) +
      `PairingReadoutView.tsx` (HTML panel), the two-halves shape of the cache grid and the map.
      Browser-verified: `sum-loop.s` at forwarding ON, flipping `1-wide → 2-wide` without reloading
      moves IPC **0.61 (34 ÷ 56) → 0.77 (34 ÷ 44)** live, and on `array-sum.s` cycle 10 the readout
      reads `REFUSED · intra-pair-raw`, `slot 0 lw x7, 0(x5) issued → / slot 1 add x10, x10, x7 held`
      — byte-identical to the offline scan.

      **(a) The obvious rule is a lie, and only a dump could show it.** "A `stall` names the refused
      instruction, so no stall ⇒ they paired" survives every hand-reasoned case and then fails on the
      flagship cache program: `array-sum.s` at width 2 / small cache holds `ID.0=i5, ID.1=i6` frozen
      for cycles 6–14 with **no `stall` event on any of them** (a miss-freeze emits none — the M6
      finding), so the naive readout announces "paired, issuing together" for nine consecutive cycles
      while nothing moves. The deeper defect is structural: that rule requires ENUMERATING every way
      an issue can be blocked (pairing refusal, ordinary hazard, flush, freeze) and being complete,
      and the freeze hole is precisely a missing enumeration case — there is no way to know the list
      is finished. **So the fold reads the RESULT, not the reasons:** `micro.idEx` is exactly who
      issued, so blocked-ness cannot be under-counted and the panel never needs to know WHY in order
      to avoid claiming they went. The reason is looked up separately and is allowed to be `null`.

      **(b) The licensing identity was verified, not reasoned:** `micro.idEx@N` === the `EX.<slot>`
      occupants at N+1, over 3 hand-written refusal programs plus the whole corpus at 2 widths ×
      cache on/off (28 configs, ~1600 cycles), zero mismatches. It is guarded in the suite because
      breaking it would fail **silently** — the panel would report issues that never happened and
      nothing else would notice. This is NOT the datapath's one-cycle-ahead `micro` trap: that trap
      is reading `micro` for CURRENT occupancy, and here being a cycle ahead is the whole point.

      **(c) The browser caught a defect no test in this repo can reach: the panel VANISHED at
      pre-run.** Keying it on the cursor's trace meant `trace === null` at cycle -1 hid the whole
      section — including the IPC tile, which is a whole-recording figure that is perfectly
      meaningful before the first step. A reader who loads a program, flips the width toggle and
      never presses step saw nothing at all. Headless tests here are `renderToStaticMarkup` with no
      jsdom, so **no test can scrub a cursor**; `readPairingPreRun` fixes it and is now guarded in
      both directions (a width-1 recording must report 1, not a hardcoded 2).

      **(d) A test cited a cycle number observed in a DIFFERENT config.** The flush case was first
      written against cycle 18 read off the cache-ON dump, then asserted against a cache-off
      recording — where 18 is an ordinary `load-use` stall. It failed loudly this time; the same slip
      onto a cycle that happened to agree would have passed while demonstrating nothing. **An
      observed cycle number is only valid for the config it was observed in** — the sharpest form yet
      of this milestone's standing observe-then-assert rule.

      **(e) `refused` and `blocked` are deliberately different verdicts.** Refused = the older issued
      and a younger did not, so the machine kept making progress; blocked = nobody moved. Collapsing
      both into one "stalled" chip would erase the tier's own lesson ("pairing failed, but we did not
      stop"). The split falls out of the `micro.idEx` reading for free.

      **(f) The readout does NOT agree with the datapath at the same cursor, and must not be read as
      if it did.** Its subject is the pair in ID; the dark `ALU 1` is that decision's consequence one
      cycle later. The surface that agrees at a shared cursor is the **pipeline map**, where a
      refusal is a visible stagger — browser-confirmed on `array-sum.s`, where the held `add`'s row
      shows two ID cells (`ID.1` then `ID.0`, the slot slide the sliding-issue decision predicts) and
      its `EX` lands one column right of the `lw`'s. The panel says this on the surface rather than
      leaving a reader to discover it as an apparent bug.

      **(g) The depth tier: the readout is NOT tier-gated, and that is a decision, not an omission.**
      `superscalar-visuals.md` places the readout at **detailed** ("the issue/pairing readout
      appears", with essentials hiding "all pairing machinery"). It takes no `tier` prop here, and
      the discriminator is what this app actually does with tiers: `CacheGrid` and `PipelineMap` take
      no `tier` either and show at every tier, while only `SuperscalarDatapath` consumes it (via
      `minTier`/`tierVisible`, for its muxes and control labels). **Panel PRESENCE is not tier-gated
      in this shell; datapath INTERNALS are** — so the doc's sentence is about the pairing machinery
      inside the diagram, which already tiers, not about this panel. Gated on panel-presence like the
      cache grid. INV-5 holds either way: naming "refused — the younger reads what the older writes"
      only ever ADDS to the essentials story ("two go together when they can"), never contradicts it.

      One number worth pinning against future doubt: `array-sum.s` and `sum-loop.s` **both** retire
      34 instructions, which reads like a stale constant and is not — the other corpus programs
      report 134 / 9 / 6 / 9. Checked, because a frozen numerator is exactly what a broken
      view-derived counter looks like.
      Acceptance met: 2142 tests green, `lint`, `tsc -b`, web `tsc --noEmit`, `format:check`,
      `npm run build` green.

## Acceptance criteria (mirror the spec §11 shape)

- [x] Load `sum-loop.s` on the superscalar model at width 1, then flip to width 2 without
      reloading: the pipeline map visibly pairs rows and the cycle count drops.
      ✅ step 6 — browser-verified at forwarding ON: 56 → 44, map pairs `IF.0`/`IF.1`.
- [x] The datapath shows both lanes lit on a paired cycle and **one lane dark** on a refused one.
      ✅ step 7 — browser-verified on `array-sum-twice.s` at width 2: both ALUs lit at the paired
      cycle (values `10`/`9`, matching the dumped trace), `ALU 1` fully grey at the solo cycle. Note
      the refinement the test forced: "one lane dark" is a claim about the EXECUTE band, not the
      whole diagram — the front-end keeps fetching two behind a refusal, and `Sign Extend 1` is
      still lit magenta in that very frame.
- [x] The readout names the refusal reason, and it agrees with what the map's shape shows.
      ✅ step 8 — `array-sum.s` cycle 10 reads `REFUSED · intra-pair-raw`, and the map shows the
      held `add` with two ID cells (`ID.1` then `ID.0`) and its EX one column right of the `lw`'s.
      Note the map is the surface that agrees AT THE CURSOR; the datapath's dark lane is one cycle
      later, and the panel says so itself.
- [x] IPC rises between the two widths, and its value equals retires ÷ cycles computed by hand.
      ✅ step 8 — `sum-loop.s` at forwarding ON: 0.61 (34 ÷ 56) → 0.77 (34 ÷ 44) on a live flip.
      The tile shows the honest cycle COUNT (56), not the 0-indexed last cursor the transport reads
      (55).
- [x] All suites green; `npm run lint`, `tsc -b`, and `npm run build` green.
      ✅ step 8 — 2142 tests.
- [x] INV-8 differential passes on the full corpus at both widths × every config combination.
      ✅ step 3 — 36 configs × 7 programs = 252 cases.
- [x] Every exact cycle count in step 4's matrix is derived from a stated rule, not observed.
      ✅ step 4 — and the rules are cited per cell (the three refusal verdicts, the `d_b + 3`
      mispredict rule, the bet-kills-its-mate rule), never "because `stageId` does X".

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

| Decision                                             | Recommendation (seed)                                                                                                                                                                                                                                                                                                                        | Pinned answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package strategy                                     | New `engine/superscalar`, preceded by extracting `predict.ts`+`cache.ts` to `engine-common`; forwarding/hazard logic forks                                                                                                                                                                                                                   | **PINNED (user, 2026-07-20)** — extract-then-fork, keeping the zero-sibling-imports precedent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Issue width                                          | 2, with an in-model **1 ↔ 2 toggle** — the pedagogy is "more than one", not "many"; the toggle is the flagship same-program A/B                                                                                                                                                                                                              | **PINNED (user, 2026-07-20)** — toggle, not a second model                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| View scope                                           | Full visual layer (datapath + lane hues + readout + IPC tile)                                                                                                                                                                                                                                                                                | **PINNED (user, 2026-07-20)** — full; affordable because M3 step 7 pre-built the map                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Issue-group alignment                                | **Sliding / greedy** — each cycle tries the next two undispatched instructions; a refused younger one becomes the OLDER of the next group, so pairing recovers                                                                                                                                                                               | **PINNED (user, 2026-07-20).** The alternative, aligned packets, is cheaper (a refused slot is just a bubble and the lockstep walk barely changes) but makes pairing depend on **address parity** — an artifact of where an instruction happens to sit, which is a worse thing to teach than the extra machinery is to build. It also undersells the tier: a superscalar whose pairing never recovers is not the money shot. Cost accepted: an issue pointer + a straggler, and a slot is NOT a stable lane. Does not threaten the visuals — lane = per-cycle issue slot, identity = the id/follow-ring, and the map rows are instructions, so lane is not even a map axis                                                                                                                                                                                                             |
| Memory ports                                         | **1** — mem-ops never pair with each other; gives the structural-hazard lesson for free                                                                                                                                                                                                                                                      | **ADOPTED AS SEEDED (step 2b).** Refusal reason `mem-port`, classified by PORT rather than by load/store, so a load beside a store refuses too. It is what keeps MEM, the cache and the miss-freeze single-lane — the rule pays for itself several times over                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Branch slots                                         | **1, and it may sit in either slot** — a taken branch kills its pair-mate too if that mate is younger. Seeded, but the alternative (branches only in slot 0) is simpler to draw; step 2 decides against the real stage walk                                                                                                                  | **ADOPTED AS SEEDED (step 2b), and BOTH directions observed.** Refusal reason `branch-slot`, classified by CLASS not by outcome (a not-taken branch still occupied the unit, and at issue nobody knows the outcome) — so `jal`/`jalr` are in it. A taken `EX.0` transfer kills its `EX.1` mate; a taken `EX.1` transfer **spares** the older `EX.0`, which retires normally. That asymmetry is the entire content of `Squash.slot`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Intra-pair RAW                                       | **Never pairs** — if the second instruction reads what the first writes, it goes alone next cycle. Forwarding cannot fix a same-cycle dependency, so this holds at every forwarding setting, which is itself a teachable fact                                                                                                                | **ADOPTED AS SEEDED (step 2b), and the forwarding-independence is asserted** — reason `intra-pair-raw`, provoked at `forwarding: true` AND `false` in one test. Forwarding moves a value from a LATER stage back to EX, and there is no later stage than "beside me, this very cycle"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `location` lane encoding                             | `"<stage>.<slot>"` strings — a plain string, so no trace-schema change; `stageFamily` already folds `"EX.0"`→`EX`                                                                                                                                                                                                                            | **ADOPTED AS SEEDED (step 2a, PROVEN step 5).** `"<stage>.<slot>"` at BOTH widths — never a bare `"EX"`, even at width 1, so the encoding never depends on a config the view cannot see. Zero trace-schema change and **zero recorder change**: `follow()` keys on `id`, and `InstructionSighting.location` was already free-form, so two occupants of one stage resolve to distinct sightings for free. Only `location` is slotted — `stall.stage`, `flush.stages` and `forward.to` stay BARE (re-decided in 2b, not inherited). Step 5 cashed it over a real dual-issue recording, including the case the encoding exists for: an instruction that **changes slot mid-flight**                                                                                                                                                                                                       |
| A new `issue` trace event?                           | **Decline it, pending proof.** `superscalar-visuals.md` proposed `issue` + a pairing-refused event, but `location` gives the slot free and a refusal is "slot 1 empty + a `stall` with a new `reason`". House record: M4 accepted 1 field of 5, M6 added zero. Force the event only if step 8's readout genuinely cannot be drawn without it | **DECLINED WITH PROOF (step 8).** The readout is drawable with zero schema change, and each element was cashed against a real trace: the PAIR from `location` (`ID.0`/`ID.1`), the REFUSAL REASON from the existing `stall` event, WHO ISSUED from `micro.idEx`, and the FREEZE from the same `missCyclesRemaining` the cache grid reads. Note what the seed got WRONG, though its conclusion was right: it proposed reading a refusal as "slot 1 empty + a `stall`", and that rule is a LIE — a miss-freeze emits no `stall`, so on `array-sum.s` at width 2 with the small cache it reports "paired" for 9 consecutive frozen cycles. The event was declined for a better reason than the one offered. House record holds: M4 +1 field of 5, M6 +0, M7 +0                                                                                                                            |
| Lane hues                                            | `--lane-0` = accent blue, `--lane-1` = magenta `#e87ba4` light / `#d55181` dark — machine-validated 2026-07-14, CVD ΔE 41.3/42.6                                                                                                                                                                                                             | **ADOPTED AS SEEDED (step 7) — the VALUES were not re-derived, but WHAT THEY TINT was re-decided with the user.** The visuals doc gave the lane hue the WIRE STROKE; that stroke already means STAGE in the shipped pipeline datapath and in the pipeline map sitting directly above this one, and re-pointing it would have made `EX.0` and `EX.1` different colors — destroying the "two instructions in EX" reading the tier exists for. **PINNED (user, 2026-07-20): the lane hue tints REPLICATED NODE BOXES only.** Shared boxes stay hue-neutral (M3's pinned reason still holds); `ALU 1` does slot 1's work and nothing else, so it can wear a lane hue without lying. Three channels, three meanings: wire = stage, box = lane, ring = identity. The relief rule is satisfied structurally — a test pins that every lane-tinted node carries its lane number in its own text |
| Default width on load                                | **1** — the machine's own degenerate case, so the first picture matches the pipeline the reader just learned, and the toggle is the reveal                                                                                                                                                                                                   | **ADOPTED AS SEEDED (step 6), and CONFIRMED IN THE BROWSER** — the superscalar opens on `1-wide`, so the first picture a reader meets is the pipeline they already know and the 2-wide flip is the reveal. Note the neighbouring default is NOT so lucky: the app also opens at forwarding **OFF**, and the flagship 56 → 44 A/B is a forwarding-ON pair, so the reveal only lands cleanly once forwarding is on                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Is a 1-wide superscalar distinct from M3's pipeline? | **Yes, and it must stay so** — it runs issue logic that never finds a pair. If it turns out cycle-identical to M3 on the whole corpus, say so in the plan rather than hiding it; that is a _finding_, not an embarrassment                                                                                                                   | **ANSWERED (step 2a, 2026-07-20): NO — it is cycle-identical to M3 across the entire corpus × forwarding × prediction × cache matrix**, hitting every cell of `N + 4 + S + P + M` on the first run with no number adjusted. That is the INTENDED result, not a disappointment: a width-1 machine is the pairing machine at its degenerate limit, and identity is what PROVES the port faithful — a width-1 base that differed from M3 would mean the port had drifted, not that the model was interesting. It is recorded here because the plan promised to say so rather than hide it, and because it settles what the toggle teaches: the 1-wide position says "this is the pipeline you already know", which is exactly the baseline the 2-wide flip has to be measured against.                                                                                                    |
