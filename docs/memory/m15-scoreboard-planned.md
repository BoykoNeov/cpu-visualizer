---
name: m15-scoreboard-planned
description: 'M15 — the scoreboard (CDC 6600), the seventh model: PLANNED ONLY as of 2026-08-10, nothing built, ALL decisions pinned, and step 0 is BLOCKED on the user-triggered /code-review ultra pass over 89bb26e..HEAD. Read before starting it, and read it before ANY model that wants a latency source: slowOpLatency is cluster-gated by configurableOutOfOrder AND has no UI control at all, so a model depending on it shows nothing until a lesson exists. Also holds the measured finding that the corpus has ZERO reachable WAW/WAR hazards, which is what makes INV-8 a false net here before step 6 and a real one after.'
metadata:
  node_type: memory
  type: project
  originSessionId: 7489daaf-c3b1-4f89-b900-ae6b7dae256a
  modified: 2026-08-10T02:46:25.623Z
---

**Plan: `docs/plans/m15-tasks.md`. Status 2026-08-10: NOT STARTED, nothing built, but ALL ELEVEN
DECISIONS PINNED.** The user picked "scoreboarding" from a list of candidate architectures, then
pinned the three that were genuinely theirs (the other eight follow from facts measured in the
code): **a new engine package** not a knob on the OoO model; **engine + tables view, steps 0–8**,
lesson track stays M16; and **`/code-review ultra` over `89bb26e..HEAD` runs BEFORE step 0** — so
**step 0 is BLOCKED on a review only the user can trigger.** The reason that ordering was chosen
is specific: step 5 edits the shared shell seam (`models.ts`, `engineConfigFor`, `useSimulator`),
which a seventh model would otherwise be sitting on top of unreviewed.

**Why this model:** M9 built Tomasulo with renaming already in it, so the product shows what
renaming _does_ without ever showing the machine that lacks it. WAW and WAR exist nowhere in the
shipped six models. It is the spec's flagship "same program, different behavior" realized **across
models** rather than across a knob.

**Headline (seeded, open): a new package, NOT a `renaming: false` knob on the OoO model.** The knob
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

## Other decisions seeded in the plan (all open)

Stages `IF ID RO EX/MEM WB` — `ID` **is** Issue and `WB` **is** Write-Result, chosen so five of six
stage families carry a validated hue (`PHASE_COLORS` is exactly `IF ID EX MEM WB`, `theme.ts:44-50`);
only `RO` falls back to the neutral accent. **`RO` is per-FU and non-blocking** — shared and
blocking, it makes WAR unreachable and deletes half the subject. No predictor. Stall reasons
`'waw' | 'war' | 'structural' | 'operand'` — **never `'raw'`**, which is pinned repo-wide to mean
"forwarding is off". Refuse `cache` and `issueWidth > 1`; ignore everything else (note
`engineConfigFor` clamps **`cache` only** today, so a second refusing knob is a real extension).

Two falsifiable UNCHANGED criteria, both STOPs: the trace schema needs no edit (`stall.reason` is a
free-form string, `schema.ts:57`) and `pipeline-map.ts` needs no edit.
