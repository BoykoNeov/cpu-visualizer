---
name: m15-scoreboard-planned
description: 'M15 — the scoreboard (CDC 6600), the seventh model: STEP 0 DONE 2026-08-10 (package scaffolded, DAG guardrails verified in five directions), no machine built, all decisions pinned, and the /code-review ultra gate DISCHARGED. Read before ANY model that wants a latency source: slowOpLatency is cluster-gated by configurableOutOfOrder AND has no UI control at all, so a model depending on it shows nothing until a lesson exists. Holds the measured finding that the corpus has ZERO reachable WAW/WAR hazards (INV-8 a false net here before step 6, real after), and step 0s finding that a new model package needs FIVE lint probe cells, not three — plus the vitest alias nobody exercises until step 5.'
metadata:
  node_type: memory
  type: project
  originSessionId: 7489daaf-c3b1-4f89-b900-ae6b7dae256a
  modified: 2026-08-10T04:09:35.317Z
---

**Plan: `docs/plans/m15-tasks.md`. Status 2026-08-10: STEP 0 DONE, no machine built, ALL ELEVEN
DECISIONS PINNED.** The user picked "scoreboarding" from a list of candidate architectures, then
pinned the three that were genuinely theirs (the other eight follow from facts measured in the
code): **a new engine package** not a knob on the OoO model; **engine + tables view, steps 0–8**,
lesson track stays M16; and **`/code-review ultra` over `89bb26e..HEAD` runs BEFORE step 0** — a gate
**DISCHARGED 2026-08-10 by the user marking it done** — and that is ALL that is known, so do not
read it as "the shell seam came back clean"; **step 5 still owes that seam its own scrutiny**. The
reason that ordering was chosen is specific: step 5 edits the shared shell seam (`models.ts`,
`engineConfigFor`, `useSimulator`), which a seventh model would otherwise be sitting on top of
unreviewed. **Next: step 1, the model MVP** — build the **2 INT + 1 MEM** machine (see the resolved
STOP below), proved by a hand-built WAW/WAR program inside the test file, not a corpus program; the
corpus one is priced at step 6, after the coefficients are known.

## ✅ RESOLVED STOP — two FUs made WAR UNREACHABLE; the machine is now 2 INT + 1 MEM

**Raised and resolved 2026-08-10, before any engine code.** The user amended decision 4 to **two
integer FUs (1 cycle each, both reporting `EX`) plus one blocking memory FU**. Two consequences for
step 1: the **`structural`** stall reason must say WHICH FU class is exhausted (otherwise a student
reads "structural" while an integer unit sits visibly free), and the FU-status table now has three
rows (`INT0`, `INT1`, `MEM`), so **step 7's view width was priced against the wrong FU count and
must be re-measured, not inherited**.

The derivation, kept because the shape is what transfers:

**The original decision-4 inventory (one integer 1-cycle FU + one blocking memory FU) cannot produce a single
WAR stall**, which would delete half the milestone's subject. Derived on paper by trying to
hand-build step 1's opening WAR program and failing. A WAR stall needs an older instruction parked
at `RO` with a source still unread while a younger one reaches Write-Result on that register. **The
only multi-cycle latency here is the memory FU** — RV32I has no mul/div and integer is pinned at 1
cycle — so anything parked at `RO` waits on a load; that load owns the single memory port and the
waiter owns the only integer FU, so **no FU is left for a younger writer**. It stalls at Issue on
`structural`, in-order blocking Issue stalls everything behind it, the load finishes, the waiter
reads at `RO`, window closed. Witness: `lw x1, 0(x5)` / `add x3, x1, x2` / `lw x2, 0(x6)`.

**Fix, now PINNED: a SECOND integer FU** (2 int + 1 mem) — `lw x1` on mem / `add x3, x1, x2` on int
A parked at `RO` / `addi x2, x0, 5` on int B, one cycle, reaches WB → WAR on `x2`. Historically
honest too (the 6600 had ten FUs, precisely so instructions could get past each other). **It was a
STOP and not a patch because decision 4 is a ⛔ gating row the user pinned at "two FUs to start", and
the count changes every hand-derived coefficient from step 3 on.**

⚠ **The transferable shape: this is the SAME collapse the corpus scan already measured** on
`branch-flavors.s`'s `a1` WAW candidate — "two integer-ALU writers sharing one FU under in-order
issue". A second sighting, not a hypothesis. **Before pinning any FU inventory, hand-build the
hazard the model exists to show and check an FU is actually FREE for the younger instruction.** The
plan already knew this failure mode for `RO` placement and pinned against it; it did not notice the
same mechanism arrives through FU COUNT.

## Step 0 — the scaffold, and its two findings (2026-08-10)

`packages/engine/scoreboard` = `@cpu-viz/engine-scoreboard`, cloned from M11's step-0 commit
(`bfbdfc2`) shape: `index.ts` exports the model id and the thesis docblock only —
`ScoreboardProcessor` is step 1's and `MODEL_DESCRIPTION` step 5's. Ripple = workspaces, root
`tsconfig` references, `vitest.config.ts` alias, `eslint.config.js`, `npm install`. The web trio
(web dep, web `tsconfig` paths, Vite alias) is deliberately step 5's. Repo 11193 → **11194** tests
(one smoke test), 92 → 93 files.

⚠ **A new model package needs FIVE lint probe cells, not the three the plan priced**, and the two
extra ones are where the real failure modes live. Each cell is a temporary file, then `npx eslint`
on it, then delete it (**never a `git checkout` harness** — [[m13-width-planned]]'s destroyed tree).
RED: `trace → new` carrying the **INV-3** message (this is the cell that proves the `...MODELS`
spread edit took — a model missing from that constant lints clean in FOUR lower layers at once,
which is exactly how M9's `engine-out-of-order` was omitted); `sibling → new`; and `new → sibling`
— where **the message TEXT is the whole check**, because the generic `packages/engine/**` rule
denies only `curriculum`/`web`, so without the new self-exclusion block that import lints CLEAN and
an exit code alone cannot tell you which rule fired. GREEN: `new → engine-conformance` (the allowed
edge) and `new → itself` (the `MODELS.filter` self-subtraction, which has its own way to be wrong).

⚠ **The `vitest.config.ts` alias for a new model is UNEXERCISED for five steps.** The package's
smoke test imports `./index` relatively (the `single-cycle` house pattern), so it proves the
`include` glob and the id, not the alias. Steps 1–4 live inside the package and reach outward only
for `assembler`/`conformance`, whose aliases already exist; nothing imports the model **by workspace
name** until step 5 wires the shell. `tsc -b` resolves it by project references — a real check, but
a different route. Don't read a green step 0 as "the alias works".

**Why this model:** M9 built Tomasulo with renaming already in it, so the product shows what
renaming _does_ without ever showing the machine that lacks it. WAW and WAR exist nowhere in the
shipped six models. It is the spec's flagship "same program, different behavior" realized **across
models** rather than across a knob.

**Headline (PINNED): a new package, NOT a `renaming: false` knob on the OoO model.** The knob
is cheaper and lights up an existing datapath, but Tomasulo-minus-renaming still commits in order
through its ROB — a machine that never existed, so INV-5 decides it. See also
[[future-microarchitectures]] for the two axes already discharged, and
[[m11-deep-pipeline-planned]] for the new-model milestone shape this plan copies.

## The two findings worth carrying past this milestone

⚠ **`slowOpLatency` is NOT an available latency source for a new model, for two independent
reasons, and the first is invisible unless you read the shell.** (1) It has **no UI control
anywhere** — `useSimulator.ts:356-361` says "A REF ONLY, no React state, no interface field, no
control"; its only writers are `startLesson` and the free-play loads, which reset it to 1. So a
model whose only latency source is that knob **never reorders in free play** and demonstrates
nothing until a lesson milestone authors one. (2) It is gated by `configurableOutOfOrder`, which by
its own docblock gates the **whole cluster** (`outOfOrderIssue`, `robSize`, `slowOpLatency`) and
which in `App.tsx:387-392` renders the issue-order toggle **and** the ROB-size control — so
honoring it means either offering a ROB size on a machine with no ROB, or splitting a required
capability flag across seven models. **The fix that dodges both: model-intrinsic FU latencies**,
following multi-cycle's "one instruction per stage is this model's definition, not a setting"
(`multi-cycle/src/processor.ts:82`). Ask of any latency knob: _does the shell render a control for
it, and what else does its capability flag turn on?_

⚠ **The corpus has ZERO reachable WAW or WAR hazards — measured, not assumed**
(`M:\claud_projects\temp\m15-corpus-scan\scan.mjs`, 2026-08-10). Static candidates exist and all
collapse: the two WAW candidates are both in `branch-flavors.s`, where the `a0` pair sits on
mutually exclusive branch paths and the `a1` pair is two integer-ALU writers sharing one FU under
in-order issue; the three WAR candidates (`array-sum`, `array-sum-twice`, `strided-sum`) are all
`lw` reads `t0` / `addi` writes `t0`, unreachable because the load's `t0` is ready at Read Operands
so it reads before the `addi` can write. **Consequence: INV-8 is a FALSE net on this model before
step 6 and a REAL one after it** — the opposite direction from M7 and M11, where it is false
throughout. The step-3 mutation check must therefore be **re-run at step 6**.

## The other pinned decisions

**FUs: 2 integer (1 cycle, both `EX`) + 1 blocking memory (multi-cycle, `MEM`)** — amended from two
to three 2026-08-10; see the resolved STOP above.
Stages `IF ID RO EX/MEM WB` — `ID` **is** Issue and `WB` **is** Write-Result, chosen so five of six
stage families carry a validated hue (`PHASE_COLORS` is exactly `IF ID EX MEM WB`, `theme.ts:44-50`);
only `RO` falls back to the neutral accent. **`RO` is per-FU and non-blocking** — shared and
blocking, it makes WAR unreachable and deletes half the subject. No predictor. Stall reasons
`'waw' | 'war' | 'structural' | 'operand'` — **never `'raw'`**, which is pinned repo-wide to mean
"forwarding is off". Refuse `cache` and `issueWidth > 1`; ignore everything else (note
`engineConfigFor` clamps **`cache` only** today, so a second refusing knob is a real extension).

Two falsifiable UNCHANGED criteria, both STOPs: the trace schema needs no edit (`stall.reason` is a
free-form string, `schema.ts:57`) and `pipeline-map.ts` needs no edit.
