# Milestone 4 — branch prediction (the second toggle on the pipeline)

**Status: ✅ M4 IS COMPLETE — ALL STEPS 0–7 DONE, 2026-07-17 (788 → 807 tests). Step 7 shipped the
flagship lesson, `branch-bet` on `call-return`, and the milestone's own thesis paid out one last
time: **zero new lesson-format fields, zero engine changes, zero renderer changes, and the validator
covered the new prediction axis with NO special case** — which was the step's acceptance line, held on
the first run. The program was FORCED on M3's criterion (`call-return` is the only corpus program
carrying one of EACH transfer on a source-visible line: `jal` bets and wins, `bge` bets and loses,
`ret` admits no bet — signed −1 + 2 + 0 = **+1**), so the lesson is the only surface where "no scheme
dominates" is a claim about INSTRUCTIONS rather than a total. Triggers key on `branch-resolved.target`
(architectural) and never on `predicted` (a property of the SCHEME, so it means something different in
each position). **Two findings worth the milestone:** the expected mutation story was WRONG — the
slide fails THREE tests, not one, because this lesson's config-exclusive steps interleave in trace
order and the sweep's order guard catches the overshoot (structure, not vigilance); and the mutation
the sweep genuinely cannot see names the price of the whole design — once "lawfully dead in a
position" is legal, **DEAD and LAWFULLY DEAD stop being distinguishable to any generic rule**, and
nothing derivable closes it, because which position a step is MEANT to be dead in is pedagogy and
pedagogy is not in the trace. **The eyeball found a product defect — the streak resumes at 8**: the
closing step shipped a DIRECTIONAL imperative ("flip it and watch the total move the wrong way") in a
step alive in BOTH positions — true from not-taken, false from taken — with every test green, because
the numbers it quotes are right in both and no guard can see which way the reader is facing. **NEXT:
the milestone is done; caches (§12.3's other half) remain deferred pending array-walking programs, and
M2 step 5c remains deferred and untouched.** Previous status follows.**

**STEPS 0–6 DONE — THE MISPREDICTION IS LEGIBLE, 2026-07-16 (775 → 788 tests). Step 6 put
the two speculative ACTIONS on the map — `?` where the branch bets, `!` where it was wrong — beside
the `✕` that already drew their victims. No schema change, no config, no engine change. It rejected
the obvious design (colour the `✕` by `flush.reason`) for two measured reasons: **a misprediction can
kill nobody** (`call-return`'s `ret` pays 2 cycles and the map drew NOTHING for it, under either
scheme — step 5's "the flush is the COST, the event is the ACTION" one surface up), and **a
`branch-predicted-taken` casualty is not a misprediction** but the toll of a bet, paid even when the
bet is right (9 of `sum-loop`'s 10 are). The finding is a measurement of the CORPUS's blindness: the
rejected design, implemented as a mutation, fails **exactly ONE test** — the hand-built zero-victim
bet — while all 252 others stay green. **PENDING: step 7 (the lesson).** Previous status follows.**

**STEPS 0–5 — the BET IS ON THE CANVAS (685 → 775 tests). Step 5 drew the
ID bet and the EX correction, verified live at `sum-loop` 78 → 71 with `a0 = 55` in both positions
and the bet lighting at cycle 9 carrying `0x8`. It also OVERTURNED the milestone's own seeded
answer: the bet does NOT surface as a `flush` "in the cycle it happens" — the flush reports
CASUALTIES, so a branch last in `.text` bets every pass with nothing to kill (measured: 3 bets, 0
flushes). The flush is the bet's COST; the event is its ACTION. So `branch-predicted` joins the
schema — the FIRST field accepted after four declined, because the four had a correct source
already and this had none. And the headline fix was in code M3 shipped: `activate` drew the EX
redirect on `resolved.actual`, which is predict-not-taken's SPELLING of `predicted !== actual` and
breaks both ways under `static-taken` — step 3's `2·T` trap for the third time. PENDING: steps 6–7.
Previous status follows.**

**STEPS 0–3 — the ENGINE (685 → 746 tests). The engine
honors `branchPrediction`: `static-taken` places an ID bet, EX corrects on misprediction, INV-8
is clean across the full 2×3 matrix (30 cases, green first-run — speculation does not leak), and
the timing is pinned corpus-wide as a DERIVATION. PROVEN headlessly: the payoff (a correct bet
costs 1, not 2), the regression (`call-return` **17 → 18** — slower under `static-taken`, in
both forwarding positions), the `jalr` asymmetry, the bet-vs-correction collision, and the
milestone's thesis as signed per-program deltas (`sum-loop` −7, `array-sum` −2, `call-return`
**+1**). Blind spot re-measured: a pipeline ignoring the knob leaves conformance **32/32 green**
and fails 10 timing + 4 soul tests. PENDING: everything in the browser (steps 4–7) and every
eyeball — which has caught a real defect in five consecutive view steps. The milestone's own
title was corrected once already: three scheme NAMES, only **two behaviors** — `'none'` and
`'static-not-taken'` are one machine, because the fall-through IS the not-taken path. M3 is
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

- [x] **1. The engine honors `config.branchPrediction` — three schemes, TWO behaviors.** ✅ Done
      (2026-07-16, 691 → **699 tests**). The step title was wrong, and correcting it is the
      finding: **`'none'` and `'static-not-taken'` are the same machine.** A processor with no
      predictor does not stop and wait — it keeps fetching the next address, and **the fall-through
      IS the not-taken path**. "No prediction" and "predict not taken" are one policy under two
      names, so the three-valued config collapses honestly to `private predictTaken: boolean`
      rather than to a `switch` with two identical arms. Pinned by whole-trace `toEqual` in both
      forwarding positions — not by cycle count, since two machines agreeing on timing could still
      differ in events.

      **The decision was forced by a fact the plan's seed missed: `'none'` is `defaultConfig()`.**
      The seeded lean (`'none'` = stall-on-branch) would have redefined the DEFAULT pipeline, moving
      every timing number M3 pinned. Measured, not argued: when `branchPrediction` became honored,
      **exactly one test in the whole suite failed — the capabilities assertion** (`false` → `true`).
      Every timing, conformance, recorder, and web test stayed green, which is the coincidence
      claim proven corpus-wide for free. It also dissolves the `predicted: boolean` honesty question
      (see decisions): nobody stalls, so `predicted: false` is never a lie.

      **The central reframe: EX squashes on MISPREDICTION, not on TAKEN.** `if (taken)` was only
      ever predict-not-taken's spelling of `if (predicted !== taken)`. `nextPc` serves as the
      correction for both directions with no branch on which way we were wrong — the schema already
      defines it as "the resolved next pc, whichever way it went". The latch field deferred from
      step 0 landed as **a boolean, not a target**, and step 0 is what bought that: since
      `speculativeTarget` provably equals EX's `nextPc` for every taken PC-relative transfer, "we
      both say taken" already implies "we both mean the same address". `jalr` needs **no special
      case anywhere** — never predictable ⇒ `predictedTaken: false` ⇒ always taken ⇒ always
      mispredicts ⇒ always pays 2. The `call-return` regression is mechanical, not coded.

      **The bet is NOT `ctx.squash`, because it kills a different set** — one casualty, not two. A
      squash means "everything younger than the deciding stage is wrong" (ID+IF); a bet means only
      "the instruction IF just fetched is off the predicted path" — the branch in ID is the thing
      predicting and sails on to EX. That difference IS the payoff: 1 instead of 2. And **a CORRECT
      prediction still emits a flush**: the discarded fall-through is the "1", so emitting only on
      misprediction would make the cost invisible to every casualty-counting consumer and let the
      map draw a free prediction the machine never made.

      **`flush.reason` grew by exactly one word.** `'branch-taken'` was true under M3 (predict-not-
      taken can only be wrong about a branch that WAS taken, so "prediction broke" and "branch was
      taken" were one event). `static-taken` separates them: a bet on a branch that then declines
      corrects with `actual === false`, and reporting `'branch-taken'` there states the opposite of
      what happened to a consumer that prints it. So `'branch-not-taken'` joins, and `'branch-taken'`
      keeps its meaning rather than generalizing to `'branch-mispredicted'` — every EX correction IS
      a misprediction, so that name would say nothing a reader could act on while moving a string
      three suites and the map already pin.

      **The precedence bug turned out to be structural, and is pinned anyway.** EX runs before ID in
      the reverse walk and `stageId` already returns early on `ctx.squash !== null`, so a wrong-path
      branch in ID never bets — the correction always wins, for free. Prose is not proof: the test
      needs a `jalr` (unpredictable ⇒ places no bet ⇒ does NOT empty ID) with a branch behind it,
      the only shape that leaves ID occupied during a correction. Move the bet above that early
      return and it fails with `x4 = 99` — the machine executing code a resolved transfer had ruled
      out. Note the failure is architecturally VISIBLE, so conformance *would* catch it — but the
      corpus has no branch behind a `jalr`, so **the net that would catch it does not contain the
      case that triggers it**.

      Acceptance met: every hand-derived cycle count (9/8 correct-taken, 8/10 mispredict) was right
      **first run**, both derived from `N + 4 + S + P` before the engine was asked.

- [x] **2. Conformance across the scheme matrix (INV-8) — prediction is architecturally
      invisible.** ✅ Done (2026-07-16, 699 → **722 tests**). The pipeline's list is now the full
      cross product (2 forwarding × 3 schemes × 5 programs = **30 cases**), and it was **green on
      the first run, which is the whole point**: speculation is invisible by construction, since
      wrong-path instructions are killed before MEM and so never store and never write back. A red
      cell would not have meant "the predictor is slow" — it would have meant speculation is
      LEAKING.

      **But the step found a real defect the plan never imagined, and only the eyeball caught it:
      the six configs produced only TWO labels.** `configLabel` named `forwarding` alone — with a
      comment promising `branchPrediction` would "join when a model honors them (M4)" — so three
      schemes all reported as `sum-loop.s [forwarding off]` and a failure could not say which one
      broke. **The harness's own distinctness guard never noticed**, because every claim in it was
      parameterized by the two-forwarding list: _a guard whose case list cannot reach the collision
      is not a guard._ That is the exact vacuity shape M3 step 0 wrote this file to prevent,
      reappearing **in the guard rather than in the thing guarded**.

      Fixed by **deriving rather than declaring** (M3 step 6's move, one layer down): `configLabel`
      names exactly the knobs that **vary across the list**. A list varying only forwarding gets
      M3's titles back byte-identical, so nothing moves; a multi-axis list names both; a constant
      knob stays silent, since a label that never changes distinguishes nothing. `cache` joins by
      adding one clause — deliberately **not** written: it is an object, so "does this vary" needs a
      deep compare, and inventing that for a knob no model reads would be guessing at M5's shape.
      The multi-axis list is now a case in the harness's own suite, so the guard can reach what it
      guards.

- [x] **3. Timing — the closed form generalizes, and `2·T` was a special case.** ✅ Done
      (2026-07-16, 722 → **746 tests**). **Every number was right first run** — the whole thesis
      derived before the engine was asked, then confirmed: `sum-loop` −7, `array-sum` −2,
      `call-return` **+1**, `add`/`byte-loads` unmoved.

      **The generalization is smaller and better than the plan predicted.** The plan proposed three
      per-scheme formulas. The truth is ONE rule, per transfer: **2 if mispredicted, 1 if correctly
      predicted taken, 0 if correctly predicted not-taken.** The scheme's only job is to decide
      `predicted`; everything else falls out. `2·T` is then not a formula to replace but a
      *consequence* — under not-taken nothing is ever predicted taken, so every taken transfer
      mispredicts and every declined branch is free. **Nothing M3 pinned was wrong; it was
      *specific*, in a place that read as general.** `T` also stopped being stated: it is now
      derived from the transfer breakdown, so the two cannot drift.

      **The thesis is MEASURED, not asserted, and it is the sharper mirror of M3 step 3.** There,
      the crown jewel had to be corrected: forwarding is not always faster (`call-return` is 17 in
      both positions). Here the same program does not merely fail to improve — it gets **worse**:
      **17 → 18 cycles under `static-taken`, in both forwarding positions.** Its three transfers are
      one of each kind, which makes it the corpus's whole argument in one program: `jal` improves
      (2→1), the never-taken `bge` regresses (0→2), and `ret` (a `jalr`) cannot be predicted by
      anyone and stays at 2. Asserted as a **signed delta per program**, never as an average — the
      average is exactly the claim that would let the loss hide.

      **The blind spot, re-measured for M4.** A pipeline that ignores `branchPrediction` entirely
      leaves **conformance 32/32 GREEN** and fails **10 timing + 4 soul tests** — the same shape M3
      measured for forwarding (12/12 green, 10 unit + 14 timing). Mutation-checked three ways; the
      third found something worth keeping: **killing the bet's `flush` fails exactly ONE test, and
      timing is untouched.** The cycle count does not depend on the event, so the casualty pin is
      its _only_ net. That is why "a correct prediction still emits a flush" had to be a test rather
      than a comment — and why step 6 inherits `18 → 11` as a number rather than inventing one.

      **Unplanned payoff: casualties ARE the penalty**, and not by coincidence — a killed
      instruction is a wasted fetch slot, and a wasted fetch slot is a cycle. `sum-loop` draws 18
      casualties under not-taken and 11 under taken, exactly `P`. The two schemes even reach 11 by
      different routes (9 bets × 1 + a 2-cycle exit mispredict whose correction cuts only IF,
      because the bet had already emptied ID) and still land on the same number.

      _(Original plan text follows.)_ M3 step 3 pinned `cycles = N + 4 + S + 2·T` as a
      _derivation_. M4 reveals that `2·T` was never general: it was the **static-not-taken**
      instance of a scheme-dependent penalty term.

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

- [x] **4. Web: the second toggle — three scheme NAMES, two POSITIONS.** ✅ Done (2026-07-16,
      746 → **764 tests**). The config seam **paid off exactly as predicted**: prediction rides
      `ProcessorConfig` at session level with **no widening at all** — state, ref, `loadInto`, and a
      capability-gated control, every line of it forwarding's shape. That is the boring half.

      **The acceptance line was wrong, for the third time in this milestone.** "Three schemes, cycle
      counts that move under each" is false by construction: `'none'` and `'static-not-taken'` run
      identical traces, so nothing moves three ways. The control therefore has **two positions**, and
      that is the step's headline decision — a three-position control would assert three machines
      exist, contradicting the tier below (INV-5) and breaking the rule the forwarding toggle already
      lives by, *a control that cannot move anything is worse than no control*. `'none'` is
      unreachable from the UI and nothing is lost, because there is no third machine to reach. The
      **completeness** of that claim is what is pinned (every union member records as one of the two
      reachable positions), so a dynamic scheme joining fails a test rather than being silently drawn
      as "not taken". M4's rhetoric has now self-corrected three times: step 1's title, step 3's
      `2·T`, step 4's acceptance.

      **The no-op guard is on BEHAVIOR, not value** — the one thing `'none'` being `defaultConfig()`
      actually costs. Clicking the already-lit "not taken" button at startup differs in STRING while
      agreeing in MACHINE, so value-equality would re-record a byte-identical trace and dump the
      cursor to pre-run: a visible loss from clicking a lit button.

      **`positionsFor` had gone stale the moment step 1 flipped the capability** — it read
      `configurableForwarding` alone while its docblock claimed to derive from capabilities, so the
      lesson sweep silently ran at half coverage and stayed green. Step 2's `configLabel` defect, one
      layer down. Now a cross product over honored knobs (pipeline ⇒ 4 machines), with its own guard,
      because the helper that decides coverage cannot be the one thing without a case list that
      reaches its collisions. **Ownership rule: step 4 is what makes a lesson-under-`static-taken`
      reachable, so step 4 owns sweeping it** — a reachable-but-unverified state is this project's
      signature defect. `forwarding-bubble` anchors in all four, first run.

      **The real finding, and it INVERTS the one this step set out to make (4th field DECLINED).**
      The plan asked whether the seam was "forwarding-shaped". `Lesson.config` looked exactly that:
      a full `ProcessorConfig`, forcing a lesson about forwarding to declare a `branchPrediction` it
      seemed to have no opinion about, while `lessonOpening`'s pinned rule (*honored only when
      DECLARED*) read per-KNOB in its prose and per-CONFIG in its type — indistinguishable while one
      knob existed. So the type was weakened to `Partial`, the JSON subtracted, a per-knob rule
      pinned, and **it shipped a real defect to the browser**: `forwarding-bubble`'s closing prose
      quotes *"72 cycles with forwarding off, 51 with it on"* **as fact**, and those numbers hold
      only under predict-not-taken (`static-taken` runs 70 and 49). Leaving prediction alone parked
      the user in the one machine the lesson lies about — prose reading 51 above a transport reading
      **49**, in one screenshot. Reverted: **whole config, `Partial` declined.** A lesson's SUBJECT
      and the machine its PROSE depends on are different, and only the second decides what to
      declare — M3 step 8's *anchoring is not truth* reaching the config axis, having only ever been
      tested on the model axis. Positively: **a lesson is a controlled experiment; `config` names the
      controls, and you cannot control a variable you did not declare.** Every honored knob is either
      the independent variable the narration invites you to flip or a control that must be pinned;
      "no opinion about a knob" was an invented third category.

      **The eyeball caught it, for the sixth consecutive view step, and nothing else could have.**
      The 4-position sweep was GREEN throughout — it checks that steps ANCHOR, and they do; the file's
      own docblock says it "deliberately CANNOT see the pedagogy". Two more only-visible-in-the-browser
      items came with it: the narration said *"the toggle"* (definite, singular) — a unique referent
      until this step put a second one beside it, now *"the Forwarding toggle"*; and the `72 → 51`
      test hardcoded `defaultConfig()`, pinning the narration's numbers under an **implicit**
      not-taken — the `2·T` trap (*specific, in a place that reads as general*) one layer up from
      where step 3 found it. It now DERIVES its scheme from the lesson's declaration, so prose and
      pin cannot drift (mutation: declare `static-taken` ⇒ `expected 70 to be 72`).

      **Mutation-checked three ways, and the third is the honest measurement: deleting
      `branchPrediction` from `loadInto` fails NOTHING** — the toggle could be pure decoration with
      all 229 web tests green. The hook is React and this project renders statically
      (`renderToStaticMarkup`), so the browser is not a formality here, it is the only net. Verified
      live: gated absent on single/multi-cycle; `sum-loop` **78 → 71** and `call-return` **17 → 18**
      on the live scrub bar (both matching step 3); `a0 = 55` in both positions; the lit-button click
      keeping the cursor at 20; and the lesson pinning BOTH knobs on open.

- [x] **5. Datapath: drawing the bet and the correction.** ✅ Done (2026-07-16, 764 → **775
      tests**). The bet's adder and its redirect are on the canvas, gated on the prediction knob;
      verified live at `sum-loop` **78 → 71** with `a0 = 55` in both positions, the bet lighting at
      **cycle 9** carrying `0x8` while the map marks its casualty ✗ in the same column.

      **The milestone's seeded answer to its own open question was WRONG, and measuring it is the
      step.** The decision table said the pressure was off because "the bet already surfaces as a
      `flush` with `reason: 'branch-predicted-taken'` and `stages: ['IF']`, **in the cycle it
      happens**". It does not. The flush contract reports **real casualties**, so a branch that is
      the last word in `.text` bets — redirecting the pc — with the fetch pointer already out of
      text and nothing to kill. Probed before writing anything: **3 bets, 3 flushes missing, every
      iteration.** Not a corner — it is exactly where a loop lives. **The flush is the bet's COST;
      the event is its ACTION**, and drawing the cost while calling it the action is precisely the
      defect this step also had to fix in EX. So `branch-predicted` joins the schema — the **first
      field this project has accepted after declining four** (`maxTier`, renderer delta 2,
      `LessonStep.requires`, `Partial<config>`). Each of those was declined because a *correct*
      source already existed; here there is none, which is the difference. It resolves the table's
      question by **completing an asymmetry**: EX's action already had an event (`branch-resolved`)
      and ID's had none.

      **Its shape is step 1's finding reaching the schema.** No `taken` field: a machine predicting
      not-taken performs **no action** — it keeps fetching, and the fall-through IS the not-taken
      path — so the event's *existence* is the bet, and `{ taken: false }` would assert something
      that never happened. (`branch-resolved.predicted` still reports `false` there: a REPORT at
      resolution is not an ACTION at the bet.) It carries `target`, which is what lets the view
      label the redirect without re-deriving `pc + imm` (INV-3/INV-7).

      **The headline correctness fix was in code M3 shipped, and no test could have caught it
      before this step.** `activate` drew the EX redirect on `resolved.actual` — right under
      predict-not-taken, and a **coincidence**: a machine that never bets taken can only ever be
      wrong about a branch that WAS taken. `static-taken` breaks it in **both** directions — a
      winning bet would draw a redirect EX never made (ID's bet already steered), and a **losing**
      bet redirects to the **fall-through** and drew nothing at all. That second one is
      `call-return`'s `bge`, i.e. the whole regression, invisible. This is step 3's `2·T` trap one
      layer up: _specific, in a place that read as general_ — the third time this milestone has
      found that exact shape.

      **...and fixing it uncovered the SAME trap one level deeper, in the fix itself — the advisor
      caught it, and the first draft had pinned the contradiction as intended.** M3's single `if`
      was doing **two jobs that only looked like one because they agreed**:

      | question              | condition               |
      | --------------------- | ----------------------- |
      | redirect from EX?     | `predicted !== actual`  |
      | label the wire?       | `actual`                |

      `branch-resolved.target` is documented as the resolved next pc _"whichever way it went"_,
      which reads like a licence to paste it on the wire and is the opposite. The redirect is drawn
      out of `pcarith`, whose operands are **drawn and labelled `pc` and `imm`**. A taken correction
      carries `pc + imm` — explained by the picture. A **lost bet's** correction carries the
      fall-through `pc + 4`, so labelling it drew **an adder fed `0` and `8` emitting `4`**.
      Measured, not feared: `idex-pcarith-pc = 0`, `idex-pcarith-imm = 8`, `pcarith-pcmux = 4`. The
      value is now **omitted** there (INV-5: omit, never contradict) — the same call this file
      already makes for `pcarith-exmem`; the redirect was simply the one place pcarith's output ever
      carried a number, and it got away with it while `target` could only mean `pc + imm`. Nothing
      caught it because geometry tests do not check value semantics, the screenshot that would show
      it had the label below the fold, and **the test asserted `toBe(4)`** — a defect pinned as a
      requirement is worse than an untested one.

      **Config became a THIRD structure axis and forced a small reframe:** geometry cannot be drawn
      from a name that decides nothing, so the diagram takes **behaviors** (`DatapathConfig`), and
      `predictsTaken` collapses three names to two machines once, at the shell's edge. The suite
      now sweeps **4 machines**, not 2. The bet adder is deliberately **not** tier-gated (unlike the
      forwarding unit): with the toggle on it is where the next pc comes from, so hiding it at
      `essentials` would leave the redirect arriving from nowhere, and there is no mux to contract.
      It rides the **top** rail home while the EX corrections ride the bottom ones — early next-pc
      candidates above (the `+4` is already there), late corrections below.

      **Three blind spots measured.** Adding the event failed **nothing** (all 764 green — nothing
      could see a bet); deleting it fails only the 5 tests written for it, **timing untouched**;
      and hardcoding `predictTaken: false` in `App.tsx` leaves **all 775 green**, so the toggle
      could be pure decoration — step 4's finding repeating, and why the browser is the only net.

      **The eyeball caught it for the 7th consecutive view step**, and a non-vacuity guard caught a
      second: at 100×44 the adder rendered as a **flat banner** beside two unmistakable adders — an
      `adder` silhouette needs a near-square aspect or its `0.22·w` notch is a glitch-sized nick.
      And the wrong-path test was **asserting nothing**: nothing in that program CAN bet (the
      `jalr` is unpredictable, the `beq` condemned), so "the wrong-path branch didn't bet" was free.
      The guard to write was not "some bet fired" but **"this very instruction would bet if it were
      real"** — the first draft's guard fails on a *correct* engine. A demo page also printed one
      string on two unrelated wires (the bet's target and IF's `+4` both `0xc`), an accident of the
      program that read as the diagram claiming they were one fact. And the hazard unit moved up
      20px to open the ID band — checking that had not crowded its labels needed a page where it is
      **lit**, and there wasn't one: `pl-focus-loaduse` rendered cycle 3 while the stall fires at
      **2**, so the only page titled "load-use stall" had never shown the stall.

      _(Original plan text follows.)_ The ID redirect is a new path, and it
      is the first path whose _existence_ depends on config (M3 step 6 established config as a
      visibility axis and derived contraction visibility from `contracts` — this is the next user
      of that idea). Note the M2 step-5c tension: this milestone draws an **ID-stage** redirect;
      5c's deferred **ALUOut→PC** redirect remains a separate, still-deferred concern.
      Acceptance: geometry invariants (the M3 step-6 suite), plus the browser eyeball — which has
      caught a real defect in **five consecutive view steps** and should be budgeted for, not
      hoped against.

- [x] **6. The map: mispredictions become legible.** ✅ Done (2026-07-16, 775 → **788 tests**). The
      map marks the two speculative ACTIONS — a `?` on the branch's ID where it BETS, a `!` on its EX
      where it was WRONG — beside the `✕` that already drew their victims. No schema change, no
      config, no engine change, and the fold stayed model-agnostic.

      **The step's real question was "is a misprediction distinguishable from a correct-but-costly
      transfer", and the obvious answer — colour the `✕` by `flush.reason` — is wrong twice over.**
      Both were measured before a line was written, and either alone decides it:

      1. **A misprediction can kill NOBODY.** `call-return`'s `ret` is a `jalr` at the end of
         `.text`: it mispredicts, pays its 2 cycles, and the fetch pointer is already out of text, so
         no casualty exists to colour. **The map drew literally nothing for it, under either scheme**
         — and it is the load-bearing half of the milestone's thesis (*jalr can never be predicted*).
         This is **step 5's finding one surface up**: the flush is the COST, the event is the ACTION.
      2. **A `branch-predicted-taken` casualty is not a misprediction** — it is the toll of a BET,
         paid even when the bet is RIGHT (**9 of `sum-loop`'s 10 are**). Colouring victims by reason
         would teach "red = wrong" while the map's own numbers say otherwise, and would put an
         engine's reason vocabulary in the one module that boasts of carrying no model knowledge.

      So: **mark the branch, leave the `✕` uniform.** Whether a branch was wrong is a fact about the
      branch, resolved a cycle later — it belongs on the branch's own row. The two marks are exactly
      the two redirects the datapath draws (step 5), which keeps both surfaces on one vocabulary; and
      a CORRECT resolution is unmarked for step 1's reason about not-taken — **it is the absence of
      an action**.

      **The headline finding is a MEASUREMENT of the corpus's blindness, and it is the sharpest one
      this milestone has.** The rejected design was implemented as a mutation — infer the bet from
      its casualty's `flush.reason` — and it fails **exactly ONE test in the whole suite**: the
      hand-built zero-victim bet. **All 252 others, the entire shipped corpus, stay green.** The
      wrong design is *indistinguishable from the right one on every program we ship*; only a trace
      literal can tell them apart, because a predictable branch last in `.text` (step 5's "3 bets, 0
      flushes" shape) is not in the corpus. That is M4 step 0's `>>> 0` lesson repeating — *no corpus
      sweep can prove this one* — and it is why the M3-step-7 hand-built technique the acceptance
      line names was load-bearing rather than ceremonial.

      **The acceptance line was thin, for the fourth time in this milestone.** "`call-return`'s
      casualties visibly rise" is true and nearly invisible: **3 → 4**, one extra `✕` among thirteen
      rows, and one of the four is an unrelated `halt` casualty. Worse, **casualties are not the
      penalty here** — step 3's "casualties ARE the penalty" holds for `sum-loop` (18 → 11) but
      `call-return` pays 4 cycles for 2 casualties, exactly the `ret` gap above. What is actually
      pinned instead is the picture that teaches *no scheme dominates*: **the LOST BET** — the corpus's
      only branch that bets and is wrong (`bge`) wears `?` **and** `!` on one row with two rows cut
      beneath, while `jal` turns from a mispredict into a correct guess. Signed per instruction, never
      averaged.

      **Not config-gated, deliberately** — the `!` fires under predict-not-taken too, which is
      `defaultConfig()`, where there are *more* mispredictions (`sum-loop`: 9). A misprediction is a
      misprediction; the map has no config and must not grow one. So this step **changes a surface M3
      already shipped**, and the eyeball covered both schemes for that reason.

      **The eyeball did NOT find a product defect — the streak breaks at 7**, and the honest report is
      that the marks read correctly in both themes at real pixels (quiet grey `?` because a bet is
      routine; loud red `!` because being wrong is the exception). **But the first pass nearly declared
      that having only looked at TOYS** — six-instruction synthetics carrying one mark each — while
      the acceptance is written about `sum-loop` and `call-return`, and this project's own record (M3
      step 7) is that the map's real defects *were visible only at REAL scale*. So `call-return` joined
      the harness as the one corpus map page (18 cycles, 13 rows — it fits whole, which is why
      `sum-loop` did not join it: at 45 rows it is clipped by the map's own scroll container, exactly
      the reason the other pages are deliberately short).

      **That page is the step's most convincing artifact, and it had only ever been asserted
      headlessly: the whole thesis is one picture.** Under `static-taken`, `jal` bets and WINS (`?`,
      no `!`, one `✕` — cost 1); `bge` bets and LOSES (`?` then `!`, two `✕` — cost 2); and `ret`
      mispredicts with **no `✕` at all** (cost 2, zero casualties). That is step 3's signed deltas
      −1 / +2 / 0 = **+1**, drawn. And under not-taken the same page carries the contrast that
      justifies the whole design: **two mispredictions, one killing two instructions and one killing
      nobody**, side by side. `sum-loop` answered the clutter question — ten quiet `?` do not shout,
      and on a STALLED branch (`IF ID ID ID?`) the `?` lands on the LAST ID cell, the cycle the bet is
      actually placed.

      It found two smaller things
      instead: `font-size: 0.62rem` was the CELL's size baked into a class deliberately serving two
      contexts, so the legend's key rendered *smaller than the sentence it sits in* (size moved beside
      `position`, under `.pmap-cell .pmap-mark`); and a probe killed a piece of **dead defensive CSS**
      — the mark opted out of a killed cell's strike-through and fade, but **no row is ever killed AND
      marked** (measured across the corpus × both schemes × both forwarding positions: 100 killed, 66
      marked, **zero** overlap), and it is structural, not accidental: a wrong-path branch in ID never
      bets (step 1) and a flushed instruction dies before EX. Unreachable styling is a claim the case
      is handled, so it was stated rather than defended against.

      _(Original plan text follows.)_ Casualties are already drawn; this step is
      about whether a _misprediction_ is distinguishable from a _correct-but-costly_ transfer.
      Expected to be small or free — M3 step 7 proved the map is stage-and-lane-parametric and the
      row/column model absorbed lanes and depth at the cost of only the hue key.
      Acceptance: `sum-loop`'s casualties visibly fall under `static-taken`; `call-return`'s
      visibly rise. Hand-built traces where no engine emits the case (M3 step 7's technique).

- [x] **7. The lesson — "the bet, and what it costs when it's wrong."** ✅ **DONE** — `branch-bet` on
      `call-return`, and **M4 IS COMPLETE**. 788 → 807 tests.

      **The acceptance line held on the first run, and it is the cleanest payout in the milestone.**
      "The validator covers the new axis **without a special case** — if it needs one, the validator's
      derivation was wrong, not the lesson." It needed none: the lesson dropped in and every sweep went
      green, four positions deep, with **zero** validator changes. The only red in the file was the
      deliberate inventory count (`expected 5 to be 4`). M3 step 8 derived the rule (each lesson under
      its declared model × every position that model honors, alive in ≥1) and M4 step 4 grew it to four
      positions; step 7 only had to author JSON. Zero new lesson-format fields, zero engine changes,
      zero renderer changes — the third milestone running where the thing built to be oblivious was.

      **The program was FORCED, on M3's own criterion.** `call-return` is the only corpus program
      carrying the whole story on source-visible lines, and the pinned transfer triple says so
      outright — `{ takenPredictable: 1, notTaken: 1, takenUnpredictable: 1 }`, one of each kind the
      machine can face, in nine instructions: `jal ra, max` always goes so the bet **wins** (2 → 1);
      `bge a0, a1, done` is `17 >= 42` so it never goes and the bet **loses** (0 → 2); `ret` is a
      `jalr` so **no scheme can bet** (2 either way). Signed: −1 + 2 + 0 = **+1**. The lesson is the
      only surface where step 3's `call-return` regression is a claim about **instructions** rather
      than about a total — the thesis decomposed onto the three lines that produce it.

      **The trigger key is the step's real design decision: `target`, never `predicted`.** `predicted`
      is a property of the SCHEME, so any trigger keyed on it means something different in each
      position — `{ predicted: false, actual: true }` lands on the `jal` under not-taken and on the
      `ret` under `static-taken`. `target` is the branch unit's own answer: architectural, and the
      same in both. **And the two targets on one branch are not interchangeable** — `bge` BETS on
      `0x20` (`done`) and RESOLVES to `0x1C` (its fall-through). One instruction, two events, two
      targets; a step keyed on the wrong one is dead.

      **The mutation prediction was WRONG, and measuring it is the finding.** The expected story was
      M3's — "the sweep stays green, one oracle fails." It does not: the slide fails **three** tests,
      because the sweep's ORDER guard catches it. The reason is a property of *this lesson* rather
      than of the validator — its config-exclusive steps **interleave** in trace order, so a slid step
      overshoots its neighbours. `forwarding-bubble`'s slide stayed in order and was invisible.
      **Structure caught it, not vigilance.**

      **The mutation the sweep genuinely cannot see is sharper, and it names the price of the whole
      config-exclusive design.** Weaken the `ret` step to `nth: 2, { predicted: false, actual: true }`:
      correct under not-taken (the `jal` mispredicts first), and silently **DEAD** under `static-taken`
      (the `jal` is now predicted correctly, so the `ret` becomes the *first* such event) — deleting
      "no scheme can bet on a `ret`" from the rail *precisely where it is the punchline*. Whole sweep
      green; exactly one test fails. So: once "a step may be lawfully dead in a position" is legal
      (M3 step 8 — and this lesson needs it more than that one did), **DEAD and LAWFULLY DEAD stop
      being distinguishable to any generic rule**, and nothing derivable closes it — which position a
      step is *meant* to be dead in is pedagogy, and pedagogy is not in the trace.

      **The eyeball found a product defect — the streak resumes at 8** (it broke at 7 in step 6). The
      closing step shipped **"Flip it and watch the total move the wrong way"**: true read from
      not-taken (17 → 18), **false** read from predict-taken, where flipping goes 18 → 17 and the total
      moves the *right* way. The step fires in BOTH positions, so its prose must be true in both — and
      every test was green, because the numbers it quotes (17, 18) are correct in both and no guard can
      see **which way the reader is facing**. This is M4 step 4's defect one level subtler: not a number
      that is false on the other machine, but a **direction**. `forwarding-bubble` had already solved it
      ("flip back and forth… watch the total stay put while the cycle count moves") and this lesson
      failed to copy it. Fixed symmetrically; **stated in the README rather than guarded**, because
      which way a sentence faces is semantics, and a test pattern-matching imperatives would be a style
      rule wearing a test's clothes (step 6's dead-CSS precedent).

      **Also the sharpest available answer to the `Partial` question step 4 declined.** `call-return` is
      the corpus's `S = 0` program, so this lesson's numbers are true in **both** forwarding positions:
      here is a knob a lesson provably has "no opinion" about — the exact category `Partial` was
      invented to express — and declaring it is *still* right, because **the only thing that knows the
      control is inert is the measurement, not the type**. A control you have verified is inert is
      still a control you pinned.

      Browser-verified end to end: opening from a deliberately wrong position on both knobs, the lesson
      moved both (fwd off → on, predict taken → not-taken, 71 → **17** cycles); flipping Predict → taken
      gives **18** on the live transport and the rail **re-forms 5 → 6 steps**; zero literal asterisks
      and intact code spans on every step in both schemes.

      _(Original plan text follows.)_ M3 step 8 shipped its
      flagship lesson with **zero** new lesson-format fields, zero engine changes, zero renderer
      changes, and it pinned `lessonOpening` (`model` always honored, `config` honored when
      declared) — which is exactly the seam a prediction lesson needs. The M3 lesson's structure
      (steps config-exclusive, and _that is the lesson_) may apply directly.
      Acceptance: the lesson anchors under its declared scheme; the validator (M3 step 8 scoped it
      to each lesson's declared model × every position it honors) covers the new axis **without a
      special case** — if it needs one, the validator's derivation was wrong, not the lesson.

## Acceptance criteria (mirror the spec §11 shape)

- [x] Final register + memory state **equals** the golden reference for every corpus program under
      **every** (forwarding × prediction) config (INV-8) — the proof that speculation never
      commits. ✅ Step 2, green on the first run: the full cross product, 2 forwarding × 3 schemes ×
      5 programs = 30 cases (`differential.test.ts`), and the seeded "revisit if runtime bites"
      never came up. Its own docblock records the corollary that makes the line worth reading twice:
      **conformance says nothing about whether the knob is honored at all** — a pipeline ignoring
      `branchPrediction` passes all 30, because a correct predictor cannot move an architectural
      result. That is the point. This box asserts speculation never LEAKS; `timing.test.ts` is the
      net for whether it happens.
- [x] The **same program** runs a **different number of cycles** under each scheme, on the live
      scrub bar, matching the step-3 pinned derivation. ✅ `sum-loop` **78 → 71**, re-verified live
      in step 5 alongside `a0 = 55` in both positions (speculation never commits, on the scrub bar).
- [x] **No scheme dominates**, and it is demonstrable: `sum-loop` is fastest under
      `static-taken`; `call-return` is fastest under `static-not-taken`. Both directions asserted.
      ✅ Step 3, as signed per-program deltas (−7 / −2 / **+1**), never averaged.
- [x] A **misprediction** is followable: the bet, the wrong-path instructions fetched, their
      squash, and the correction — as trace events (INV-3) and on the map. ✅ **Done.** The TRACE half
      landed in step 5 and needed a schema change the plan thought it could avoid — `branch-predicted`
      (the bet), `flush` (its casualties), `branch-resolved` (the correction); the datapath draws all
      three. **Step 6 completed the map half**, and a lost bet now reads end to end in one picture:
      `?` on the branch's ID, the wrong-path instruction fetched in the next column, its `✕`, and `!`
      on the branch's EX where the correction lands. Its finding was that the map had been drawing the
      COST and not the ACTION, so a penalty with no casualty (`call-return`'s `ret`) was invisible.
- [x] `engine/pipeline` still has **zero** imports from `web`/`curriculum`; prediction is honored
      via `ProcessorConfig` only, with no new back door (INV-2/INV-3). ✅ Mechanically enforced by
      `eslint.config.js`; step 5 added a trace EVENT rather than an accessor, which is the invariant
      working as designed rather than being worked around.
- [x] Every lesson still anchors under every config it declares it honors. ✅ Step 4's 4-machine
      sweep; step 5 changed no lesson and no engine timing, and the sweep stayed green. **Step 7
      added a second pipeline lesson to it and needed no special case** — which was that step's own
      acceptance line, and the sweep's derivation earning its keep for the third milestone running.

## Decisions to pin (fill in as steps land — seeded with the recommended answers)

| Decision                                          | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Pinned answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Is `static-taken` in the MVP?**                 | **Yes — it IS the MVP.** `static-not-taken` alone is a rename of current behavior. See the headline decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **HELD — it is the MVP, and step 1 shipped it.** The seed was right for the reason given: `static-not-taken` turned out to be not merely "a rename" but literally `defaultConfig()`'s existing behavior, so a not-taken-only milestone would have shipped zero behavior change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **What does `none` mean?**                        | **Stall-on-branch: the machine that refuses to guess** (bubble until EX resolves, `P = 2·B`). Makes the config's three names three _behaviors_ rather than two, and shares step 0's ID classification, so it is nearly free once that lands. **Caveat:** it differs from `static-not-taken` only on _not-taken_ branches, and the corpus is mostly taken — so its corpus swing is thin and its pedagogy is "pays on every branch," not a big number. The alternative (alias of `static-not-taken`) is defensible: a machine with no predictor naturally just keeps fetching PC+4. | **REVERSED — `none` ≡ `static-not-taken`, ONE machine.** The seed's lean (stall-on-branch) missed the deciding fact: **`none` is `defaultConfig()`**, so making it a third behavior would silently redefine the default pipeline and move every timing number M3 pinned. The coincidence is a **finding, not a wart**: a machine with no predictor does not wait — it keeps fetching, and **the fall-through IS the not-taken path**. Measured: honoring the knob failed exactly ONE test in the suite (the capabilities flag). Two behaviors, three names.                                                                                                                                                                                                  |
| **`jal` vs `jalr` under `static-taken`.**         | **`jal` is predicted (PC-relative, computable in ID); `jalr` always pays the full EX penalty** — its target is `rs1+imm`, a register not reliably available in ID. This asymmetry is _why_ `call-return` regresses, so it is load-bearing for the thesis, not a corner case. Verify the arithmetic against M3's pinned 17-cycle figure.                                                                                                                                                                                                                                           | **HELD, and it needed NO code.** `jalr` is absent from `PC_RELATIVE_TRANSFERS`, so `predictedTaken` is false, it is always taken, and `predicted !== taken` makes it always mispredict — the full penalty falls out with nothing that mentions `jalr`. The `call-return` regression is mechanical.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Is `predicted: boolean` honest under `none`?**  | **Genuinely open — this is M4's add-or-decline-a-field question** (M3 declined three: `maxTier`, renderer delta 2, `LessonStep.requires`). Under `none`-as-stall _nothing was predicted_, so `predicted: false` ("not predicted taken") would let a lesson keying on `predicted === actual` count every not-taken branch as a correct prediction — a lie about a machine that made no prediction. Options: `boolean \| null`, or `none` reports something defined. **Lean: let step 1 force it** rather than deciding on paper.                                                   | **DISSOLVED by step 1, and step 7 answered the remainder.** The seed's worry rested on `none`-as-stall, which was reversed: no machine ever "made no prediction", because `none` ≡ `static-not-taken` and the fall-through IS the not-taken path. So `predicted: false` is never a lie — it reports a real guess a real machine really made, and `boolean \| null` would have encoded a machine that does not exist. What survived was **pedagogical, not schema**: `predicted: false` still READS to a learner as "made no prediction". Step 7 closes that in prose rather than in the type — _"this machine has exactly one guess and always makes it"_ — the 5th field declined, and the only one declined because a SENTENCE was the right place for it. |
| **Does the ID bet need its own trace event?**     | **Probably yes, and this is the schema question of the milestone.** `branch-resolved` is an EX-stage event: the _correction_. The ID bet is a different fact at a different cycle, and the datapath (step 5) must draw the redirect in the cycle it happens. INV-3 forbids the view reaching into the engine for it. But M3's pattern says the field that seems needed often is not — try to build step 5 without it first.                                                                                                                                                       | **YES — `branch-predicted` added, the 1st field accepted after 4 declined.** The seed was right and its own "pressure is off" note was **false**: the flush does NOT surface the bet in the cycle it happens. The flush reports CASUALTIES, so a branch last in `.text` bets on every pass while IF has nothing to kill — **measured: 3 bets, 0 flushes**. The flush is the bet's COST, the event its ACTION. The 4 declined fields each had a correct source already; this had none. It **completes an asymmetry**: EX's action had an event, ID's had none. No `taken` field (not-taken is the absence of an action — step 1, in the schema); carries `target` so the view never re-derives `pc + imm`.                                                    |
| **Conformance matrix size.**                      | **Full cross product** (2 forwarding × 3 prediction = 6 configs × 5 programs = 30 cases). Cheap, and prediction×forwarding interaction is exactly where a squash-vs-forward bug would hide. Revisit only if runtime bites.                                                                                                                                                                                                                                                                                                                                                        | **HELD — 30 cases, green first run** (step 2). Runtime never bit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **BTB / zero-penalty correct prediction.**        | **Explicitly deferred, and say so in the UI's honesty budget.** Predicting from PC alone at IF is what buys a 0-cycle correct prediction; it needs a tagged structure and is a fancier tier. M4's correctly-predicted taken branch costs **1**, and that is a _true_ fact about _this_ machine, not a bug (INV-5: lawful omission, never contradiction).                                                                                                                                                                                                                          | **HELD — the honesty budget is the toggle's `title`** (step 4): "A correct bet costs 1 cycle (not 0 — that needs a branch-target buffer); a wrong one costs 2. jalr can never be predicted: its target is in a register." The tooltip is where the control's two positions pay for the third name they hide.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **How many positions does the control have?**     | _(not seeded — step 4 found it)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **TWO, and the acceptance line said three.** The positions are the BEHAVIORS, not the names. `'none'` is unreachable from the UI and nothing is lost — there is no third machine. Pinned as a COMPLETENESS claim (every union member records as one of the two reachable positions), so a dynamic scheme fails a test instead of being silently classed "not taken".                                                                                                                                                                                                                                                                                                                                                                                         |
| **Is `Lesson.config` forwarding-shaped?**         | _(not seeded — step 4 asked it, answered wrong, and the browser reversed it)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **NO — whole config, `Partial` DECLINED (the 4th declined field).** It looked forwarding-shaped: the pinned rule is per-KNOB in prose, per-CONFIG in type, indistinguishable with one knob. Weakening it shipped a defect — `forwarding-bubble` quotes "72 → 51" as FACT, true only under not-taken, so leaving prediction alone parked the user where its prose lies. **A lesson is a controlled experiment; `config` names the controls.** Subject ≠ what the prose depends on; only the second decides what to declare. "No opinion about a knob" was invented.                                                                                                                                                                                           |
| **Dynamic prediction (2-bit counters, history).** | **Out of scope.** The config type names only static schemes; adding dynamic ones is a schema change and its own milestone.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | _(open)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Relationship to M2 step 5c.**                   | **Independent; 5c stays deferred.** M4 draws an **ID-stage** redirect for speculation. 5c is about the **multi-cycle** model's ALUOut→PC path and its engine-level `alu-op` emission. Neither blocks the other; do not let step 5 quietly absorb 5c.                                                                                                                                                                                                                                                                                                                              | **HELD — step 5 did not touch 5c.** The bet is an ID-stage redirect on the PIPELINE geometry (`datapath-pipeline.ts`); `datapath-multi.ts` was never opened. The two never met, so the warning cost nothing to honor, and 5c remains deferred exactly as it was.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
