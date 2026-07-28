---
name: m13-width-planned
description: 'M13 (issue width > 2) — IN PROGRESS: steps 0/0b/1 done, the guard now admits 1..4 (MAX_ISSUE_WIDTH). The pairing rules were already width-generic; the dump found a LIVE width-2 hang in shipped code (fixed a9f1b70); width 4 is where widening stops paying. Both gating decisions pinned. Read before touching engine/superscalar or the lane hues.'
metadata:
  node_type: memory
  type: project
  originSessionId: 694ca14b-8d6d-4835-b4c9-69e79781d7f5
  modified: 2026-07-28T11:17:08.863Z
---

## M13 — the wide machine, widened. **IN PROGRESS 2026-07-28.** Steps 0 / 0b / **1** done.

Plan: `docs/plans/m13-tasks.md`. Dumps: `M:\claud_projects\temp\m13-step0\dump.txt` (pre-fix) and
`dump-postfix.txt` (the one to read). Repo 4498 → 4503 → **4504** tests. See [[project-overview]] for
the index, [[m7-superscalar-engine]] for the machine this generalizes.

### Step 1 SHIPPED `3fbda0c` — and it confirmed the dump's headline the hard way

`MAX_ISSUE_WIDTH = 4`, **exported** from `engine/superscalar` so steps 4/6/7 read the bound from the
engine that enforces it instead of re-typing a `4`. Guard shape is the M9+M10 capacity one
(`!Number.isInteger(w) || w < 1 || w > MAX`), because `w < 1` alone is false for both `NaN` and
`1.5` — and a NaN width makes every `s < this.width` body unreachable, i.e. a processor that fetches
nothing and never halts.

- **The audit's CODE half came back empty, and that is the reportable result.** A sweep for literal
  slot indexing (`idEx[0|1]`, `exMem[…]`, `ifSlot[…]`) across all of `packages/` matched **one line,
  in a test, deliberately about slot 0**. There was no arity-2 code anywhere. The step was the guard
  plus ~20 docblocks. **Run the mechanical sweep before believing either "it's all generic" or "this
  will be a rewrite"** — it settles in one query what prose argues about for a page.
- **One docblock was a real defect, not stale phrasing.** `CycleCtx.bet` said the bet's casualty set
  "grows by exactly one seat"; it is up to `width - 1` seats. It survived because **the count never
  reaches the trace** — `flush.stages` names stage FAMILIES, so N dead ID seats and one dead seat
  are both the string `'ID'`. A wrong number that no consumer can observe is exactly the kind that
  outlives its milestone.
- **Names that reach the trace were deliberately NOT fixed.** `'intra-pair-raw'` is a `stall.reason`
  three consumers read (`pairing.test.ts` asserts it, the readout glosses it, curriculum can anchor
  on it) — renaming moves trace bytes for a spelling, and step 1's own acceptance is byte-identity.
  It carries a line saying the name is historical and means intra-GROUP. Same call for
  `SUPERSCALAR_MODEL_DESCRIPTION` ("up to two"): it is the picker's user-facing copy and describes
  what the product OFFERS, not what the guard admits, so it moves in step 6 with the control.
  **Two different rules, one distinction: is this string a contract, a UI promise, or a comment?**
- **The byte-identity acceptance, reported for what it was worth.** 396 whole-trace sets (11 programs
  × widths {1,2} × 18 configs), 22 455 cycles, ~50 MB: 396/396 byte-equal. Two things made it worth
  running at all, and both are reusable: `MachineState.memory` is a `SparseMemory` whose `Map` is
  PRIVATE, so a naive `JSON.stringify` emits `{}` and the compare **passes vacuously on memory
  everywhere** — the serializer must enumerate `definedAddresses()`; and the compare was falsified
  (w1≠w2, fwd≠nofwd, cache≠nocache) before being trusted. But the honest report is that byte-identity
  was CHEAP here: no code outside the guard changed, so nothing could have moved. **Say which of your
  green checks was cheap.**
- **Liveness net widened in the SAME commit as the guard.** Opening the guard makes 3/4 reachable;
  `halt-shadow.test.ts` is the only net in the repo that turns a width-3/4 non-termination into a red
  test rather than a hung suite (every other runner loops `while (!p.isHalted())` unbounded). Its
  `WIDTHS` is now DERIVED from `MAX_ISSUE_WIDTH`, not typed `[1,2,3,4]`, so raising the bound cannot
  leave the widest machine the least tested. **Never open a guard in one commit and net it in the
  next.**
- **⚠ THE SPACER BUYS EXACTLY ONE SLOT — the step's real finding, and it came from the provocation,
  not the plan.** Run against the PRE-`a9f1b70` engine, the widened sweep wedges **72 corpus cells**:
  36 at w3 + 36 at w4, in `array-sum-twice`, `slow-op-loop`, `sum-loop`, in each of the 12 no-bet
  configs per program per width (`static-taken` escapes at every width, exactly as the bet rule
  predicts). At width 2 the corpus's `li a7, 10` exit spacer separates the branch from the `ecall`;
  **at width 3 one issue group swallows all three.** So `a9f1b70` was a HARD PREREQUISITE for opening
  the guard, not a courtesy pre-milestone cleanup — without it, step 1 ships a machine where 3 of 11
  shipped corpus programs hang the web app at width 3. Generalises: **an idiom that makes a whole
  corpus safe is buying a FIXED NUMBER OF SLOTS, and widening spends them** — so "the corpus is safe
  by accident of one idiom" is not a static fact, it has a width at which it expires. Extends
  [[cycles-cannot-see-a-lost-forward]] and the corpus-uniformity blind spot above.
- **Watch every new assertion fail first — twice here, and one of the two mattered.** `?? 1` → `?? 2`
  reddens the default test; latches allocated at `min(width, 2)` while `width` is stored HONESTLY
  reddens the shape test. That second one is the point: `expect(micro.width).toBe(w)` only checks
  that `reset()` remembered its argument, so **assert the machine's SHAPE (`idEx.length` &c.), not
  the guard's verdict.** The absent-`issueWidth` path also had no net at all — the byte-identity
  goldens always passed the field explicitly, so the one config shape every repo literal actually
  uses was the one shape 396 trace sets never exercised.

**The step-0 dump overturned two of the three things this milestone was scoped as. That is the
milestone's first lesson: it cost one measurement pass and it saved the whole plan.**

### 1. The pairing rules were ALREADY width-generic — the memory that said otherwise was wrong

[[future-microarchitectures]] said `intra-pair-raw`/`mem-port`/`branch-slot` are "written for a
pair", so M13 = generalize them. **False, and now corrected there.** That was a description of the
GUARD'S ERROR MESSAGE, not of the code: `stageId` loops `s < this.width`, `issueVerdict` loops
`for (const older of group)` and asks each rule against the whole group, `detectHazard` scans
`this.width` slots, `stageIf`'s hand-over is a seat-filling loop. Widths 3 and 4 run the entire
corpus with correct architectural state and monotone retirement **with the guard as the only thing
changed**. So the engine half is a guard, an audit and a net; the budget belongs to the view.

**Generalises past this repo: a memory that paraphrases an error message can read exactly like a
memory that describes the code.** The tell was available for free — the loops are three lines apart
from the guard.

### 2. The dump found a LIVE DEFECT AT SHIPPED WIDTH 2 — `fix(superscalar)` `a9f1b70`

A halt (`ecall`) in an unresolved branch's shadow raised the **sticky** `haltFetch` at ISSUE. When
the branch resolved taken the halt was wrong-path — squashed — but fetch never restarted. The pipe
drained, `halted` was never raised (only a RETIRING halt raises it), and `isHalted()` stayed false
for ever, so **a bare `while (!p.isHalted())` never returns.** Precisely, because the layers differ:
`Recorder.runToEnd` (`recorder.ts:158`) loops on `isHalted()` but is guarded by
`maxCycles = 1_000_000`, so it THROWS rather than hanging — after accumulating a million cycle
traces, each with a full state snapshot, which is not survivable memory (this investigation's own
first dump run exhausted a 4 GB heap that way and had to cap itself before it could report).
**A guard that turns an infinite hang into an OOM is not a guard that makes the bug benign** — and
saying "it hangs" of a layer that actually throws is the kind of prose defect M7 step 3 named.

- **Reachable at width 2**, not just at the new widths: `bnez` immediately followed by `ecall`.
  From width 2 a halt can issue in the SAME GROUP as an unresolved branch — `ecall` reads no
  register, uses no memory port, is not a transfer, so no pairing rule refuses it. Width 1 is immune
  structurally (`stageId`'s `ctx.squash` early-return always beats it). `static-taken` escapes
  because the bet ends the group.
- **The corpus was safe BY ACCIDENT OF ONE IDIOM, which is why 4498 tests were green.** All eleven
  programs exit with `li a7, 10` sitting between the branch and the `ecall`, and that spacer is the
  only thing keeping the halt out of the branch's group. **Before trusting any corpus-wide sweep,
  ask what all the programs happen to share.** This is the sharpest instance yet of the
  [[cycles-cannot-see-a-lost-forward]] family: the net was wide (11 programs × 36 configs) and blind
  in the same direction at every point.
- **Choosing the fix by what it CANNOT move.** Three candidates; two (end the issue group at any
  unresolved transfer; defer `stopFetch` to retirement) change when fetch stops on runs that already
  work and would have invalidated M7 step 4's timing matrix. The one kept — a branch squash CLEARS
  `haltFetch` — fires only on runs that previously never terminated, so no pinned count can depend
  on it. **Acceptance was "re-run the matrix and assert zero numbers moved", not an argument.**
  Timing (606) and pairing (21) confirmed unmoved.
- **Non-termination was UNOBSERVABLE anywhere in the repo** — every runner loops on `isHalted()`, so
  the failure mode is a hung suite, not a red test. `halt-shadow.test.ts` adds a cycle bound over
  corpus × width × forwarding × prediction × cache to convert a hang into a failure. **That sweep
  PASSED against the broken engine and its docblock says so**: it would not have found this bug. The
  three tests that would were watched failing first ([[m11-m12-review-resolved]]'s method lesson).
- **The CONVERSE needed its own test, and two drafts of it failed against a CORRECT engine.** "Clears
  the flag only on a branch squash" was an argument about slot ordering, so it had to be watched.
  The program needs live code AFTER the `ecall` or the test cannot fail (with the halt last in
  `.text`, fetch stops on the `inText` bound either way — a green check measuring nothing). Then:
  asserting nothing past the halt is fetched is WRONG (the halt's shadow is fetched by design,
  `stopFetch` applying at the clock edge), and asserting nothing past the SHADOW is wrong too (a
  2-wide machine fetches the shadow two at a time). Measured bound: **one fetch GROUP**, `halt +
4 × width`. The config-independent assertion — the dead code never commits — is the one that
  matters. **Reasoning produced the right fix and the wrong test, twice.**

### 3. Width 4 is where widening STOPS paying — and that is the tier's real lesson

Nine of eleven programs are cycle-identical at w3 and w4; only `paired-branches` (7→6) and
`slow-op-loop` (34→33) gain a single cycle. `array-sum` 51→42→36→36. Max group reaches 4 on three
programs, for a cycle or two. The binding rule is `intra-pair-raw` (roughly doubles w2→w4:
`sum-loop` 0→11, `array-sum` 11→18), joined at w4 by `branch-slot` firing where it never did
(`array-sum-twice` 0→24). **So no new corpus program is forced** — the question that would have
required one (can the corpus fill 3 slots?) is answered yes.

### Both gating decisions PINNED (user, 2026-07-28)

- **Widths offered: 1 / 2 / 3 / 4** — as seeded. The case for 4 is the diminishing return itself.
- **Lane hues: EXTEND the set to four validated tints** — this OVERRODE the seed, and the seed was
  wrong in a way worth remembering. It argued "the palette is machine-validated, never invent a
  hue" — but **that rule governs `PHASE_COLORS`, the 5-slot STAGE set. The lane tints are a SECOND
  categorical channel** (`--lane-0`/`--lane-1` in `styles.css`) with its own record: "CVD separation
  dE 41.3 light / 42.6 dark", validated 2026-07-14. A 2-slot set validated at 2 slots carries no
  prohibition on being validated at 4, and M11's stage-family fold is not the precedent (five stage
  hues were fixed for an unrelated reason). **Two validated channels can share the word "palette"
  and not share a single constraint — name which one a rule belongs to before citing it.**
  Extending is therefore re-validation work, not invention; the real constraint on the two new hues
  is **no red and no amber at any slot** (red = danger/flush family, amber = warn wash), which is
  tight once blue and magenta are also spoken for. New tints go in the base block AND both dark
  blocks — `styles.css` asks for identical dark blocks and no headless test can check that.

### What step 7 must not assume is mechanical

`LANES` is a hard-coded `[0, 1]`, and the forwarding rails ride "lane 0's returns on the TOP rails,
lane 1's on the BOTTOM" — an outboard-side scheme with exactly **two** sides, which four lanes do
not have. Everything else is: `LANE_DY` is already a pitch, and M7 step 7 derives every coordinate
from its node via `at()`/`aUp()`/`aLo()` (see [[m7-superscalar-web]]), so lanes can be added without
hand-typed endpoints detaching.

### Still unrun, and named as steps rather than cleared

Same-`rd` co-issue (two independent writers in one group — an ascending-slot forwarding scan would
pick the older); the MEM freeze with followers in `MEM.2`/`MEM.3` (M7's one real bug lived exactly
there, and "propagate downward in age only" has never met more than one follower); a transfer in the
last slot of a full group. Corpus retire-monotonicity was clean at all four widths, but that is
corpus-only. **INV-8 stays a FALSE net here** — the closed form `G + L + P + M + 4` is the net, and
width-3/4 cells must be DERIVED, never copied from engine output (the M7 step 2b trap, paid once).
