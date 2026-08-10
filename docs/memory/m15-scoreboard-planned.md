---
name: m15-scoreboard-planned
description: 'M15 — the scoreboard (CDC 6600), the seventh model: STEPS 0 AND 1 DONE 2026-08-10. The machine exists (IF/Issue/RO/EX|MEM/WB over 2 INT + 1 MEM), runs the whole corpus architecturally equal to the reference, and is proved against four stubs. Read before ANY model that wants a latency source (slowOpLatency is cluster-gated AND has no UI control), before assuming a plan-pinned stall vocabulary survives contact (step 1 forced a fifth reason, control, by INV-8), before defining pc on any out-of-order-completion model (the house rule moves pc BACKWARD here), and before trusting a source-level corpus scan (it missed the la pseudo-expansion, so the ZERO-reachable-WAW claim was half wrong).'
metadata:
  node_type: memory
  type: project
  originSessionId: 7489daaf-c3b1-4f89-b900-ae6b7dae256a
  modified: 2026-08-10T04:55:00.762Z
---

**Plan: `docs/plans/m15-tasks.md`. Status 2026-08-10: STEPS 0 AND 1 DONE — the machine exists and
runs, ALL ELEVEN DECISIONS PINNED (decision 6 amended at step 1).** The user picked "scoreboarding"
from a list of candidate architectures, then
pinned the three that were genuinely theirs (the other eight follow from facts measured in the
code): **a new engine package** not a knob on the OoO model; **engine + tables view, steps 0–8**,
lesson track stays M16; and **`/code-review ultra` over `89bb26e..HEAD` runs BEFORE step 0** — a gate
**DISCHARGED 2026-08-10 by the user marking it done** — and that is ALL that is known, so do not
read it as "the shell seam came back clean"; **step 5 still owes that seam its own scrutiny**. The
reason that ordering was chosen is specific: step 5 edits the shared shell seam (`models.ts`,
`engineConfigFor`, `useSimulator`), which a seventh model would otherwise be sitting on top of
unreviewed. **Next: step 2, the INV-8 differential** — and step 1 already measured what step 3
predicts about it (table below).

## Step 1 — the machine, and the THREE things the plan did not price (2026-08-10)

`packages/engine/scoreboard/src/processor.ts` + a 46-test `processor.test.ts`. Repo **11194 →
11239** tests. Reverse stage walk `WB → EX/MEM → RO → ID → IF`, with **every Write-Result effect
batched to the CLOCK EDGE** — that one deferral is what reproduces the textbook cadence (H&P's
worked example: a unit freed by a write in cycle N issues at N+1, not N) with no "not before cycle
N+1" bookkeeping anywhere else. The other three cadence rules fall straight out of the walk order.

⚠ **1. A plan-pinned stall vocabulary did not survive contact, and the reason generalizes: decision
3 ("no predictor, a taken branch flushes the front end") is UNIMPLEMENTABLE as written.** With `RO`
non-blocking and no ROB, a younger instruction can reach Write-Result while an older branch is still
parked on an operand, and a landed write cannot be taken back. So **Issue must stop at an unresolved
transfer** — forced by INV-8, not chosen — which then makes decision 3's sentence literally true
(with Issue held, the front end IS the `IF` slot). Cost: a **fifth stall reason `'control'`**, plus
splitting `'structural'` into `'structural-int'`/`'structural-mem'`. **The lesson: a "no predictor"
decision on a machine with no recovery structure is a decision about ISSUE, not about the front end
— check what the machine can UNDO before pinning what it may run past.**

⚠ **2. `pc` cannot be "the retiring instruction's `nextPc`" on any out-of-order-completion model.**
Every earlier model uses that rule and it is only well-defined because retirement is in order. Read
that way here, `pc` moves **BACKWARD** mid-run (jumps to 16 at cycle 6, back to 4 at cycle 10) at
every recorded cursor position — while still ending on the right value where INV-8 looks, so the
conformance net cannot see it. Fix: advance `pc` across the completed program-order **prefix** via
an issue-order queue that holds no values and can undo nothing (it is NOT a ROB). **Read this before
defining `pc` on any future model that completes out of order.**

⚠ **3. `MEM_LATENCY = 4` is DERIVED, and the derivation is the transferable part.** `WB = RO + 1 +
L`; a load and the integer ops behind it write at `4+L`, 6, 7. `L=2` **ties** the first (no reorder
at all), `L=3` beats the first by one and **ties** the second — a photo finish on the milestone's
own acceptance criterion, collapsed by an issue skew of two. `L=4` clears every skew the machine can
reach (two INT units ⇒ at most two in flight beside a load). **Pick a latency against the acceptance
program at every REACHABLE skew, not the one you happened to write down.**

### The mutation check, run early — and what it says about INV-8

| Stub          | step-1 unit tests | corpus INV-8 (12)                                                                              |
| ------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| WAR check     | 3 red             | **12/12 GREEN** (confirms step 3's guess)                                                      |
| WAW check     | 3 red             | **12/12 GREEN** (confirms step 3's guess)                                                      |
| control block | 2 red             | **2 RED** — `array-sum-twice`, `nested-loop`                                                   |
| `pc` prefix   | 2 red             | 4 red, but via the DRAIN GUARD, not a pc equality — compound mutation, do not cite as a pc net |

So **INV-8 is already a REAL net for the control mechanism** and stays a false one for WAW/WAR until
step 6. Neither red program needs a load: a branch parked one cycle on the `addi` before it is window
enough. ⚠ **First witness written for the control hole was TOO WEAK** — a plain `addi`/`beq`/`addi`
kept INV-8 green under the stub, because the wrong-path instruction could not find a free integer
unit in time. The witness had to park the branch on a LOAD to open a nine-cycle window. **A stall
event reddening is not the same as a VALUE reddening; write the witness that corrupts.**

### ⚠ The step-0 corpus scan was HALF WRONG — it read source, not the assembled stream

The "zero reachable WAW or WAR hazards" claim below: **the WAR half holds** (zero `'war'` stalls in
the whole corpus). **The WAW half does not** — `'waw'` fires on **6 of 12** programs, because
`la rd, label` expands to `lui rd` / `addi rd, rd`, two writers to one register one instruction
apart. Both claims can be true at once because those pairs produce WAW **stalls** (timing) and never
WAW **corruption** (the younger `addi` also READS the register, so it waits anyway) — which is why
the mutation row above is still green. **Consequence for step 6: the promoted program needs a WAW
pair whose younger writer does NOT read the older one's destination, or INV-8 will not redden.**

Smaller things pinned at step 1: stall **cadence** is a contract (one event per stalled instruction
per stalled cycle — step 3 asserts a multiset); `location` stays in the **stage** vocabulary
(`IF ID RO EX MEM WB`) and never an FU name, or `stageFamily()` mints an `INT` family and the
"`pipeline-map.ts` needs no edit" criterion breaks invisibly; `micro` is snapshotted **after** the
clock edge, so a unit can show `Rj`/`Rk` set in the same cycle its stall says it could not read
(flagged for step 7); the machine is **deadlock-free by construction** (only a unit that has not read
can block a WAR, and a unit waiting on a producer has `R` clear — so it can never block the write it
waits for), guarded anyway by a loud "cycle advanced nothing" throw. The trace-schema UNCHANGED
criterion **paid out**: six stall reasons and a new `location` value, `packages/trace` untouched.

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

⚠ **The corpus has ZERO reachable WAW or WAR hazards — measured, not assumed** — ⚠ **and step 1
MEASURED THE WAW HALF WRONG; see the correction above. WAR holds; WAW fires on 6 of 12 via `la`.**
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
**as built at step 1: `'waw' | 'war' | 'operand' | 'structural-int' | 'structural-mem' |
'control'`** (the plan seeded four; see step 1's finding 1) — **never `'raw'`**, which is pinned
repo-wide to mean "forwarding is off". Refuse `cache` and `issueWidth > 1`; ignore everything else (note
`engineConfigFor` clamps **`cache` only** today, so a second refusing knob is a real extension).

Two falsifiable UNCHANGED criteria, both STOPs: the trace schema needs no edit (`stall.reason` is a
free-form string, `schema.ts:57`) and `pipeline-map.ts` needs no edit.
