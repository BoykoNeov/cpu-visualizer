---
name: m7-superscalar-engine
description: "M7 steps 2b-5 (engine half): the pairing rules and why width 2 is a real machine, conformance at both widths, the `cycles = G+L+P+M+4` closed form - and the milestone's single most important warning, that INV-8 is a FALSE safety net for an in-order superscalar."
metadata:
  node_type: memory
  type: project
---

**Step 5 was a PROOF, not a build: `packages/trace/src/recorder.ts` is UNTOUCHED.** That is the
claim that could have failed — `follow()` keys on `id`, never on `location`, and
`InstructionSighting.location` was always free-form (its doc cites `"ROB#3"`), so two instructions
sharing a stage resolve to distinct `"EX.0"`/`"EX.1"` sightings for free. A recorder change would
have meant the encoding was WRONG. The acceptance's width-1 clause was already met by
`processor.test.ts`, so the new suite re-proves none of it (M3-step-4 discipline: state what you
deliberately do NOT re-prove).

**Load-bearing M7-step-5 findings:**

- **A slot is NOT a stable lane — now pinned three ways.** An instruction refused for
  `intra-pair-raw` in slot 1 **slides to slot 0** (`IF.1 → ID.1 → ID.0 → EX.0 → MEM.0 → WB.0`); the
  one behind it slides the OTHER way **0 → 1** to pair with the slider; a third slides **while still
  in IF**. Sliding is neither monotone nor one-directional. Also pinned: a slide never re-mints the
  id (INV-4), and the stage FAMILY sequence stays monotone even when the slot doesn't.
- **`sum-loop.s` does NOT slide — assuming it would have been the test-lie.** The natural workhorse
  was dumped FIRST and every instruction keeps its slot for life (`i5: IF.1 → ID.1 → EX.1`). A
  4-instruction program had to be written to provoke a slide. Third landing of the house rule:
  **every expected `location` must be dumped and read, never reasoned.**
- **Provoking found a REAL hole 694 green tests missed.** Aliasing the cache into the snapshot
  (`cache: this.cache`) left the ENTIRE package green — conformance, timing, pairing, and the
  engine's own `does not alias slot arrays` test — while corrupting every recording: the cache is
  **single-buffered and mutated in place**, so a shallow snapshot replays a cold cache as
  **warm-from-the-start** (cycle 0 reported the final run's 2 valid lines). Time-travel is the ONLY
  layer where that is observable. Now pinned by a staircase-not-flat-line assertion + per-cycle
  object identity, and the test was **watched failing under the bug before being kept**.
- **The neighbouring latch `.slice()` is defensive, NOT load-bearing — the M7-4(d) shape again.**
  Deleting all four slices also left 694 tests green, but there that is CORRECT: `step()` allocates
  a fresh `emptyLatches(width)` as `ctx.next` each cycle, so the arrays cannot alias. The engine's
  anti-aliasing test passes on **array identity**, which fresh-rebuild satisfies for free — it never
  covered the cache at all. Slices KEPT, but the doc comment claiming both copies prevented
  "replaying every cycle as the final one" was **false for the latches, true for the cache**, and
  now says which is which. **Two adjacent copies that look identical can have opposite load-bearing
  status — provoke each separately.**

The closed form is
**`cycles = G + L + P + M + 4`** (G = issue-group cycles, L = BLOCKING stalls, P = speculation
penalty, M = misses × penalty). The `+4` is width-invariant (pipeline depth), so width changes only
the ISSUE SCHEDULE; at width 1, `G = N` and `L = S`, so it REDUCES to M3's `N+4+S+P+M` (asserted).
Matrix = 7 programs × 2 widths × 2 fwd × 3 predict × 3 cache, every cell derived, every term
(G/Q/L/P/M/N) asserted separately. **All six provisional step-2b width-2 pins are CONFIRMED — the
warning in memory about them is DISCHARGED.** The derivation was validated by predicting all seven
forwarding-OFF counts (which had NO pin to copy) before running the engine; all seven were right.

**Load-bearing M7-step-4 findings:**

- **`S` splits at width 2 and half of it is FREE.** A slot-**1** refusal leaves slot 0 issuing ⇒ the
  group just ends early and NO cycle is lost. Only a slot-0 refusal costs. `array-sum-twice.s` fires
  50 free refusals; counting `stall` events as "S" over-charges every program. Hence `L`, counted
  DIRECTLY as "stall event fired AND nothing issued" — **never as a residual** (a residual makes the
  closed-form assertion `0 === 0`, green for any engine).
- **`G`/`Q` are NOT prediction-invariant** (the plan didn't predict this). Under `static-taken` a
  betting branch sets `killedRest` ⇒ **every bet from slot 0 with a live mate costs a pair**. Correct
  bet → `Q−1`, G same. WRONG bet → mate is on the correct path, re-issued, and costs a group **iff it
  can't re-pair** (`array-sum`'s `lui t3` can't → G+1; `sum-loop`'s `addi a7` re-pairs with `ecall` →
  free). A bet from slot **1** costs neither (`branch-flavors`, both branches in slot 1).
- **`P` and `M` ARE width-invariant** (so M3's `penaltyOf` carries over unchanged); **`L` is
  prediction- AND cache-invariant** — a miss freezes IF/ID/EX/MEM _together_ so producer→consumer
  distances survive, and the freeze emits **no `stall` event**, so its cycles charge to `M` not `L`.
- **`killedRest`'s slide-suppression is DEAD CODE** — `stageIf` runs after `stageId` and clears
  `next.ifId` on bet/squash anyway. Deleting it left all 680 package tests green. KEPT (ID shouldn't
  silently depend on a sibling undoing its work) but the comment now names IF as the real enforcer,
  and a test pins that. **Same shape as M2 5e: a claim with a rationalization attached.**
- **Two of my own reasoned claims were false, both about SLOTS.** (i) "every taken transfer strands a
  doomed mate" — FALSE, `branch-flavors` has 1 taken transfer and 0 doomed, because its branches
  issue from slot 1 and the fall-through dies in IF without consuming a slot. (ii) "after a bet ID and
  IF are both empty" — half false, IF refills from the REDIRECTED pc immediately, which is exactly why
  a bet costs 1 not 2. **Step 2b's rule generalizes: any claim naming a slot must be WATCHED.**
- **Provoke the provocation.** The net was proven by injecting a spurious pairing refusal → 24
  failures across all 18 `sum-loop` cells while `differential.test.ts` stayed **GREEN** (INV-8's
  blindness, cashed). But the FIRST provocation (refuse a `lui` partner) was a **no-op** — the `la`
  idiom already refuses it for intra-pair RAW. A provocation must be confirmed to BITE.

Plan: `docs/plans/m7-tasks.md`. **User-pinned up front:** extract-then-fork (not sibling import,
not parameterize), **width is an in-model 1↔2 toggle** (not a second model), **full visual layer**,
and **sliding/greedy issue grouping** (a refused younger instruction becomes the OLDER of the next
group, so pairing recovers — the alternative, aligned packets, is cheaper but makes pairing depend
on ADDRESS PARITY, a worse thing to teach).

**Two facts verified before the headline, not assumed** — the lesson being that a headline decision
argued from a line count is not argued at all:

- Sibling-engine imports are LEGAL (generic `packages/engine/**` denies only curriculum+web) but
  **unprecedented** — no model imports a sibling. So reuse had to go DOWN, not sideways.
- Single-issue is **the shape of pipeline `processor.ts`**, not a local assumption: four singleton
  latches + four one-occupant boolean signals (`bet`'s comment literally says "One casualty, not
  two"). That kills "parameterize the pipeline by width" outright.

**The pairing pins are a COORDINATED simplification, not three independent choices** — this is what
makes the milestone tractable. No paired mem-ops ⇒ cache/miss path stays single-lane; no paired
branches ⇒ squash/redirect stays single-lane; no intra-pair RAW ⇒ forwarding never resolves a
within-group dependency. So only **fetch, read ports, ALU, write ports, and the forwarding source
set** genuinely double. That settles the otherwise-easiest-to-botch split: **`memStall` broadcast,
`squash` lane-aware, `stalled` single-lane producer freezing a pair.**

**INV-8 IS A FALSE SAFETY NET HERE — the milestone's single most important warning.** In-order
superscalar retires in order, so `runConformance` passes essentially for free; it would pass with
the pairing logic COMPLETELY WRONG, because pairing changes only _when_ things happen. Timing is
the whole point of the tier and there is **no golden reference for cycle counts**. The real net is
the closed-form timing matrix.

Steps done:

- **0.** `predict.ts` + `cache.ts` moved DOWN into `engine-common` (`git mv`). Pipeline re-exports
  the cache READ surface from its new home so **all ten web files changed zero lines**. Forwarding/
  hazard logic deliberately did NOT move — it is stage-walk-shaped, and sharing it would mean
  parameterizing the very assumption M7 breaks. Caught: `common` was a tsconfig ref of `pipeline`
  but declared **TEST-ONLY**, and is now a production edge (the "production depends only on isa +
  trace" comment would have gone false while every check stayed green).
- **1.** `ProcessorConfig.issueWidth?: number` **optional** (follows `seed`'s precedent, not
  `cache`'s required-with-null — a required field would force a value into every config literal to
  say something none of them mean), but `ProcessorCapabilities.configurableIssueWidth` **required**,
  so adding it is a compile error every model must answer. It caught two stub fixtures immediately.
  Inertness proved in the **whole-trace** form (deep-compare the entire trace array at width 1 vs 2),
  because a TIMING knob leaking would move cycle counts while every architectural result stayed
  correct — exactly what a final-state check cannot see.
- **2a.** `engine/superscalar` at width 1: slot-shaped latches (arrays, index 0 = OLDEST), reverse
  walk iterating slots, `reset()` THROWS on width ≠ 1. **Cycle-identical to M3 across the whole
  corpus × forwarding × prediction × cache matrix, first run, zero numbers adjusted** — and that was
  verified by confirming the `TIMING` table's pinned per-program constants are **byte-identical** to
  `engine-pipeline`'s, i.e. it asserts against M3's hand-derived numbers, not its own output.
  Only `location` is slotted (`"EX.0"`); **event fields stay bare** and a test pins that boundary.

**Recurring lessons this milestone re-earned:**

- **Provoke a guard, don't read it.** Both step 0 and 2a verified an eslint deny list by temporarily
  writing the forbidden import and confirming the failure, then reverting. A config guard never
  fired is a guard whose regex is unproven.
- **The eslint deny lists enumerate models BY NAME in ~8 places** (including a per-model
  cross-isolation block). A new model does NOT inherit them — a `sed` that looks complete can miss
  half. Add the name everywhere AND give the new model its own block.
- **Delegation is safe exactly when the net is mechanical.** Step 2a was handed to a subagent only
  because "must reproduce M3's pinned constants" is checkable without trusting the implementer —
  and the check was then run independently rather than taken on report.

### Step 2b DONE 2026-07-20 (1684 → 1705 tests) — pairing, and width 2 is a real machine

Sliding/greedy issue, the three refusal verdicts (`mem-port` / `branch-slot` / `intra-pair-raw`,
all riding `stall.reason` — a free-form string, so **no new trace event and no schema change**),
intra-pair forwarding, lane-aware `squash`. Width 2 is **strictly faster on all 7 corpus programs**
with identical architectural state (`sum-loop.s` 56→44, `array-sum.s` 51→42, `array-sum-twice.s`
208→178). All three pinned surfaces proven. **The width-1 timing suite was the regression net and
held with ZERO numbers touched** through a rewrite of the issue stage, the IF hand-over and MEM's
freeze rule — which is exactly what step 2a existed to buy.

Findings that generalize:

- **The one real bug was caught by an in-order-retirement assertion, NOT by conformance.** A cache
  miss in `MEM.0` froze only its own slot, so a non-memory instruction paired BEHIND it retired
  ahead of it. Final-state conformance is structurally blind (both retire in the end, answers
  identical); a **strictly-increasing retire-id sequence** across corpus × width × cache sees it in
  one line. The fix is directional — the freeze propagates DOWNWARD in age only.
- **A betting branch needs no fourth pairing rule.** Refusing to pair leaves the same fall-through
  stranded as a _survivor_ that is still wrong-path and still must die — a longer route to the same
  funeral. Let it pair; kill it with the bet. (`Bet` therefore carries a slot, like `Squash`.)
- **`flush.stages` gained `'EX'`; event fields stay BARE — re-decided against an OBSERVED multi-slot
  flush, not inherited.** A halt flush can now name `ID` too. `stages` answers "which stages lost
  someone"; a consumer needing identity has `instructions[]`.
- **Sliding makes a whole new class of test-lie possible: a slot is not a stable lane.** The
  "branch in `EX.1` spares `EX.0`" test was, as first written, exercising a slot-**0** branch — with
  no spacer the branch is refused for an intra-pair RAW and **slides into slot 0**, so it asserted
  the lane-aware case while demonstrating its opposite, **and passed**. Only dumping the trace found
  it. **Any test naming a slot must have been watched, not reasoned about.**
- **A broadcast flag can be an artifact of the narrow machine.** M3's `stalled` boolean was
  DELETED: with sliding issue, "the stage froze" is expressed by which seats ID left occupied, and
  `stageIf`'s three special cases collapse into one hand-over rule that reproduces the width-1 stall
  picture unchanged. `memStall` stays broadcast — a single-ported miss really is a machine property.

**⚠ The width-2 cycle counts in `pairing.test.ts` are PROVISIONAL.** Six of seven were pinned from
the engine's own output, so they catch DRIFT but do not prove correctness — and no other net covers
that gap (width 1 is unaffected by pairing; final state is identical at both widths by
construction). **Step 4 must DERIVE all seven independently, never copy them forward.** Only
`sum-loop.s = 44` is hand-derived so far (loop period 4 from the `d_b + 3` mispredict rule; the
tenth branch falls through so its pair-mate survives; `d_ecall = 40`).

### Step 3 DONE 2026-07-20 (1705 → 1835 tests) — conformance at both widths, and the mute alarm

**36 configs** (2 width × 2 forwarding × 3 predict × 3 cache) × 7 programs = **252 cases**, all
green. (The +130 test delta is the width-2 HALF, 126 cases, plus 4 guards — the width-1 half landed
in 2a. 126 is simultaneously the old total and the new half, which is exactly how the first
write-up of this step came out 2× wrong.) **That green is
worth only "pairing does not corrupt the machine"** — width-invariant final state is what an
in-order superscalar PREDICTS, so this column could not have failed for a timing reason. Step 4 is
still the net.

**The step's actual deliverable was `configLabel`, not the differential**, and the lesson
generalizes past this repo: `configLabel` (`engine/conformance/src/conformance.ts`) didn't know
`issueWidth`, so the 36 configs would have rendered as **18 labels used twice** (2×3×3 names, each
shared by a width-1 and a width-2 case). That is the known M4
collision — but every earlier axis (forwarding, predict, cache) had a _failing column available_ to
make someone read the titles. **Width has none: both columns are green by construction, so a
duplicated-title report is indistinguishable from a correct one, permanently.** Generalize as: _the
severity of a reporting defect is inverse to the failure rate of the thing being reported._ An axis
that never fails is where a naming collision hides best, and it deserves MORE guard, not less.

Second reusable find: **"provoke the guard" needed two silence cases, not one.** Forcing the clause
on must fail a `width`-unset list (pre-M7 suites, where the field is `undefined`) _and_ a list where
width is **set but constant** — because the superscalar suite states `issueWidth: 1` explicitly, so
an implementation blind-by-`undefined` passes the first while still wrongly labelling the second.
Two different mechanisms produce "don't name it"; a guard covering one is not a guard.

Third find, and it is about the WRITE-UP not the code: **every self-check in this step validated the
code and none validated the numbers in the prose**, so a 2× matrix-size error reached the plan, both
memory files and the commit message with the full gate green. In this repo logged counts are
load-bearing (exact test/cycle counts are pinned everywhere, and step 4 reasons off the conformance
matrix's shape), so **treat a number written into a durable record as an assertion that needs its own
check** — recompute it from the factors, or read it off a dump, before committing.
Also: gating on variation + the field being **optional** means pre-M7 suites stay silent _for free_
rather than by a special case — verified by DUMPING their titles (the only 6 `width` hits elsewhere
are pre-existing "store widths" and step-1 inertness tests), not by reasoning.

Next: **step 4** (the real timing matrix — see the ⚠ warning above; DERIVE, don't copy 2b's pins),
then 5 (recorder + `location`), 6–8 (web, datapath, readout+IPC — all needing a BROWSER eyeball).
