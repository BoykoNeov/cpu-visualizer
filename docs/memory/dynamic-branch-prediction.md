---
name: dynamic-branch-prediction
description: "The CPU Visualizer's dynamic-branch-prediction feature (plan docs/plans/dynamic-branch-prediction.md, STEPS 0 AND 0b DONE 2026-07-30, no engine code written). Read before adding ANY corpus program: nested-loop.s cost SIX pinned sites, not the three the plan priced, and its layout had to be redesigned twice for a rule — a dependence must be distance-1 within a basic block or its stall cost changes with the prediction scheme. Also the reusable method for pricing an unbuilt config knob offline."
metadata:
  node_type: memory
  type: project
  originSessionId: 6ec4b2ad-1f1a-45e6-8d48-6e4215353ac0
  modified: 2026-07-30T17:09:22.569Z
---

**Plan: `docs/plans/dynamic-branch-prediction.md`. Steps 0 AND 0b complete 2026-07-30; steps 1–8
untouched, no ENGINE code written.** A 1-bit/2-bit saturating BHT riding `micro.predictor` (following
`micro.cache`), wired into the four `configurableBranchPrediction` models. Not a milestone — a
feature, like [[keyboard-clock-control]] and [[continuous-play]]. The full measured table lives in
the plan; only what a future session would otherwise re-derive is here.

## Step 0b — `content/programs/nested-loop.s`, and what adding a corpus program REALLY costs

4 outer passes × a 6-iteration inner loop, register-only, plus a never-taken `bne x0, x0` guard at
the head of each pass. Measured (fwd off): **182 / 177 / 174 / 171** for not-taken / taken / 1-bit /
2-bit — the **only program in the corpus where a dynamic scheme beats `static-taken`** (+6), and the
1→2-bit delta is the projected 3. Corpus-wide the 2-bit margin went from 1 cycle to 7. The guard is
what makes the ORDERING textbook: without it `static-taken` still won and the feature would have
demonstrated hysteresis while losing on the clock.

⚠ **The design rule that cost two redraws, and it generalizes to any future corpus program:**

> **A register dependence must be distance-1 from a producer in the same basic block, or its stall
> cost is not the same under every prediction scheme.**

A RAW reaching **across a branch** is re-timed by that branch's prediction (the 7-stage inserts 4
correction cycles for a lost bet). A **distance-2** RAW is re-timed by the 2-wide machine, which
re-partitions its issue groups around a bet that kills its mate. Either produces a stall that exists
under one scheme and vanishes under another **on an instruction that RETIRES** — and all three
timing tables pin ONE stall histogram per forwarding position for ALL schemes, so such a program
changes their SHAPE rather than adding a row. Draft 1 put the guard after `li t1`; draft 2 put the
accumulate before the decrement and measured the superscalar's `L` at **60 under `static-not-taken`
vs 64 under `static-taken`**. Screen for this with a scratch harness BEFORE hand-deriving anything —
`M:\claud_projects\temp\bp-step0\screen.test.ts` dumps every histogram × scheme × width in one run.

⚠ **SIX pinned sites moved, not the three the plan priced.** The three timing rows were the easy
part and each was green on the first hand-derivation. The three nobody predicts are SHAPE claims,
invisible to a grep for the completeness idiom:

- `superscalar/src/pairing.test.ts:507` — a SECOND corpus-completeness table (the headline w1/w2 A/B)
- `superscalar/src/processor.test.ts:173,188` — slot-surjectivity SETS per width + a hard-coded
  length; a program joins by its per-width issue shape, which cannot be guessed
- `web/src/pairing-readout.test.ts:552` — the IPC tile's flat-at-widths-3-and-4 enumeration
- plus `superscalar/src/timing.test.ts:2276`, a hard-coded `'eight of eleven'` with a prose message

Out-of-order needed nothing (its `PINNED` never asserted completeness). **Land the `.s` and run the
FULL suite first** — the failure list is the scope, and deriving one table before knowing it means
deriving twice.

Two machine facts the new row carries: **pairing makes this program's interlock WORSE** (w2 `L`=64
against w1 `S`=40, because the paired producer puts the branch one GROUP back instead of two
instructions back) and it still wins 172 vs 182; and **`static-taken`'s sign FLIPS with width** —
+5 at width 1, −3 at width 2, −4 at 3 and 4 — because every bet ends its issue group.

## The method — pricing a scheme that does not exist yet, with no engine change

Reusable whenever a new config knob changes only TIMING. Two properties made it work, and both are
worth checking before trying it again:

- **The underlying event sequence is knob-invariant.** A program's per-branch outcome sequence is
  the same under every predictor, because prediction changes _when_ things happen, never _what_. So
  ONE run per program yields the raw material for every scheme.
- **The trace already carries a per-INSTANCE cost rule.** `pipeline/src/timing.test.ts:205` pins
  every resolved transfer at **2 if mispredicted, 1 if correctly predicted taken, 0 if correctly
  predicted not-taken**, and `cycles = N + 4 + S + P`. Because that rule is per-instance rather than
  per-scheme, it prices a scheme nobody has built.

**The validation that makes the derived columns trustworthy: replay the two schemes that DO exist
and compare the ordered `predicted` sequence event-for-event against `branch-resolved.predicted`** —
not the totals. Then the same simulator is trusted where no oracle exists. Broken on purpose
(`static-taken` made to predict not-taken): that test failed, the closed-form test did NOT, because
it reads the trace's own `predicted` rather than the simulator's. Same shape as
[[cycles-cannot-see-a-lost-forward]].

Scratch harness: `M:\claud_projects\temp\bp-step0\` — a vitest config OUTSIDE the repo, importing
`workspaceAliases` from the project's `vitest.config.ts` by absolute path, with
`root: <project>` + `server.fs.allow`. Worked first try; use it for any future headless measurement
that must not land in the project tree.

## The finding that should change the plan's shape

**Over the ORIGINAL eleven-program corpus `dynamic-2bit` beat `static-taken` by ONE cycle, and 1-bit
tied it exactly.** Not a sizing fluke: **every loop there was entered once**, so a warm
`static-taken` is already right on every iteration and the dynamic schemes only ever pay their cold
start. They won only where a branch habitually falls through (`paired-branches` +4, `call-return`
+2), which is `static-not-taken`'s territory, not a dynamic predictor's thesis. **Step 0b's
`nested-loop.s` is the whole of the current margin** — it alone contributes +6, taking the corpus
total from 1 cycle to 7 (814 → 807 fwd-off, 591 → 584 fwd-on). The aggregate case for this feature
is still small; the per-program case is what to teach from.

Consequences a future session should not re-derive:

- **`array-sum-twice.s` was the ONLY program distinguishing 1-bit from 2-bit, by 1 cycle in 276**
  (until `nested-loop.s`). The delta is exactly **`m − 1` for `m` outer passes**; the inner loop's
  LENGTH is irrelevant, and the outer branch contributes nothing. So 4 passes ⇒ 3, 6 ⇒ 5.
- **Table size WAS timing-neutral at 16, 8 and 4 — step 0b falsified that.** `nested-loop.s`'s guard
  (pc 8) and inner branch (pc 24) both index 2 at **4 entries**, costing `dynamic-2bit` 181 against 171. The corpus now has its first aliasing witness, reachable only at 4 — which finally gives the
  "pin 8 or 16" decision a reason beyond drawability.
- **The `jal` fork costs exactly 1 cycle and lands on M4's own witness.** `call-return.s` is 16 when
  `jal` bypasses the table (always predicted taken) and 17 when it consults a cold counter — against
  M4's pinned `+1`. Seed: bypass.
- **2-bit reset `00` would make the "better" predictor LOSE** on all four single-entry loops
  (`array-sum` 72 vs the 1-bit's 71, likewise `strided-sum`/`sum-loop`/`slow-op-loop`). `01`
  (weakly-not-taken) is the seed for that reason, not just for the learning animation.

## The plan's own claim that was wrong

It stated `TTTTNTTTT` costs a 2-bit **one** mispredict and a 1-bit **two** — the textbook's
WARM-START numbers. Both counters reset not-taken, so the leading `T` is a cold mispredict every
scheme pays: measured **2** (`NTTTTTTTT`) and **3** (`NTTTTNTTT`). These are step 2's unit fixtures,
so the error would have been copied into the tests written to pin them.

## Still to settle before step 5

`m13-review-resolved`-style hazard: **does a SQUASHED branch update the predictor?** In the OoO
model a branch can resolve and then be killed by an older mispredict, so update-on-resolve vs
update-on-commit is a real behavioral fork, **invisible to INV-8**, sitting exactly where step 5's
copy-paste pressure across four models peaks. Pin it before step 5, not during.
