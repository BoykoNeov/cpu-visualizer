---
name: dynamic-branch-prediction
description: "The CPU Visualizer's dynamic-branch-prediction feature (plan docs/plans/dynamic-branch-prediction.md, STEP 0 DONE 2026-07-30, no code written). Its headline measurement: over the WHOLE 11-program corpus a 2-bit BHT beats static-taken by ONE cycle, so the corpus cannot demonstrate what the feature is for. Also the reusable method — how to price an unbuilt config knob offline, with no engine change."
metadata:
  node_type: memory
  type: project
  originSessionId: 6ec4b2ad-1f1a-45e6-8d48-6e4215353ac0
  modified: 2026-07-30T16:28:49.790Z
---

**Plan: `docs/plans/dynamic-branch-prediction.md`. Step 0 complete 2026-07-30; steps 1–8 untouched,
no code written.** A 1-bit/2-bit saturating BHT riding `micro.predictor` (following `micro.cache`),
wired into the four `configurableBranchPrediction` models. Not a milestone — a feature, like
[[keyboard-clock-control]] and [[continuous-play]]. The full measured table lives in the plan; only
what a future session would otherwise re-derive is here.

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

**Over the whole corpus `dynamic-2bit` beats `static-taken` by ONE cycle — 636 vs 637 — and 1-bit
ties it exactly.** Not a sizing fluke: **every loop in the corpus is entered once**, so a warm
`static-taken` is already right on every iteration and the dynamic schemes only ever pay their cold
start. They win only where a branch habitually falls through (`paired-branches` +4, `call-return`
+2), which is `static-not-taken`'s territory, not a dynamic predictor's thesis.

Consequences a future session should not re-derive:

- **`array-sum-twice.s` is the ONLY program distinguishing 1-bit from 2-bit, by 1 cycle in 276.**
  The delta is exactly **`m − 1` for `m` outer passes**; the inner loop's LENGTH is irrelevant, and
  the outer branch contributes nothing. So 4 passes ⇒ 3, 6 ⇒ 5. The flagship A/B needs a purpose-
  built program to be legible.
- ⚠ **Authoring one corpus program costs THREE hand-derived timing rows, not one file.**
  `pipeline/src/timing.test.ts:629`, `deep-pipeline:586` and `superscalar:1207` each assert
  `corpus == Object.keys(TIMING)` and go red the moment a `.s` lands; superscalar's row carries a
  `w2` block and a per-width schedule for widths 1–4. Out-of-order does NOT assert completeness (its
  `PINNED` covers 10 of 11 — `store-forward.s` is absent), so it costs nothing. The plan's original
  "author a program" line under-priced this by a lot.
- **Table size is timing-NEUTRAL at 16, 8 and 4 entries** — nothing in this corpus aliases even at 4. So the plan's "aliasing between branches is a feature" is a claim the corpus cannot exhibit,
  and the size choice is drawability alone.
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
