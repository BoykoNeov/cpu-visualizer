---
name: m13-width-planned
description: 'M13 (issue width > 2) — the step-0 dump PLANNED but not built: the pairing rules were already width-generic, the dump found a LIVE width-2 hang in shipped code (fixed a9f1b70), and width 4 is where widening stops paying. Both gating decisions pinned. Read before touching engine/superscalar or the lane hues.'
metadata:
  node_type: memory
  type: project
  originSessionId: 694ca14b-8d6d-4835-b4c9-69e79781d7f5
  modified: 2026-07-28T10:37:31.975Z
---

## M13 — the wide machine, widened. **PLANNED 2026-07-28, NOT BUILT.** Steps 0/0b done.

Plan: `docs/plans/m13-tasks.md`. Dumps: `M:\claud_projects\temp\m13-step0\dump.txt` (pre-fix) and
`dump-postfix.txt` (the one to read). Repo 4498 → **4503** tests. See [[project-overview]] for the
index, [[m7-superscalar-engine]] for the machine this generalizes.

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
for ever, so **every caller looping on it HANGS**, including the recorder and the web app.

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
