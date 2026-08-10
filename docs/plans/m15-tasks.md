# Milestone 15 — the scoreboard (CDC 6600)

**Status: STEPS 1–5 DONE, 2026-08-10 — the machine exists, runs the whole corpus, is pinned against
the golden reference, its SCHEDULE is pinned too, it is drivable through the recorder, and it is now
SELECTABLE IN THE BROWSER.**
`ScoreboardProcessor`
walks `IF ID RO EX|MEM WB` over two integer units and one blocking memory unit, with the three
classic status tables in `micro`; 46 hand-derived tests, all four of its mechanisms proved against
stubbed code. Step 1 also found **three things this plan did not price** — see "Step 1, as built".
Step 2 added the INV-8 differential at a deliberately **one-config** matrix and re-measured the
control mutation against it. Step 3 added the timing matrix — two identities, a `(pc, reason)`
histogram, four isolated coefficient programs, and the two-part mutation check, whose **asymmetry
is the headline: the matrix is a real net for WAW and NOTHING at corpus scale nets WAR**. Step 4
added the recorder suite — a proof, not a build — closing acceptance criterion 4 with `follow()`
over **strictly nested** lifetimes, and turning up the finding step 7 most needs: **the two tables a
view draws from disagree on a flush cycle, and an Issue stall repeats `IF` while its event says
`stage: 'ID'`**. Step 5 put it in the picker (last, decision 8), gave `engineConfigFor` its **second
clamp** — the function is PROTECTION again, since this model refuses a width and its control vanishes
with it — and paid out the `pipeline-map.ts` UNCHANGED criterion on the shipped bundle, 36/36. It
also turned up a **STOP for step 7: the `RO` fallback hue is byte-identical to `IF`'s**, a collision
no test in this repo can see. Step 6 promoted `register-reuse.s` and **flipped INV-8 from a false
net into a real one on BOTH hazards** — the milestone's own prediction, paid out by re-running step
3's two mutations. It also found the second acceptance line VACUOUS as written: the out-of-order core
emits no `stall` event of any kind, so "shows no WAW stall" there is true of any machine at all.
Next is step 7 (the three status tables). The `/code-review ultra` gate is
discharged (see Ordering), and the one STOP step 0 raised — two FUs cannot produce a WAR stall — was
resolved the same day by the user amending decision 4 to **2 integer + 1 memory** (step 1-PRE). The user chose the architecture ("scoreboarding", from a list
of candidates), then pinned the three that were genuinely theirs: **a new engine package** (not a
knob on the out-of-order model), **engine + tables view, steps 0–8** (lesson track stays M16), and
**the `/code-review ultra` pass over `89bb26e..HEAD` runs BEFORE step 0**. The other eight rows
follow from facts measured in the code and are pinned with them.

Source of truth for scope: `cpu-visualizer-spec.md` §12 (roadmap) — with the honest caveat that
**this milestone is past the end of that roadmap**, as M11 and M13 were. Tiers 1–5 are complete
(M1–M10), depth was delivered by M11 and width by M13, which discharged the standing
don't-foreclose flag (`docs/memory/future-microarchitectures.md`). This milestone comes from a
fresh direction chosen 2026-08-10. The load-bearing constraints are unchanged: the architectural
invariants (§3) and the trace schema (§5).

## Why this milestone, and why now

**What the shipped family cannot teach: why register renaming exists.** M9 built Tomasulo with
renaming already in it, so the product shows what renaming _does_ without ever showing the machine
that lacks it. The scoreboard is the textbook step immediately before Tomasulo, and its entire
subject is the pair of hazards renaming deletes:

- **WAW** — two instructions write the same register, the older one is slow, so the younger must
  not land first. The scoreboard stalls it at **Issue**.
- **WAR** — a younger instruction wants to overwrite a register an older one has not yet read. The
  scoreboard stalls it at **Write-Result**, which is the only stall in the whole product that
  happens at the _end_ of an instruction's life rather than the beginning.

Neither hazard exists anywhere in the shipped six models. Every in-order machine reads its
operands in program order, and the out-of-order machine renames both away — so `forward` / `stall`
/ `flush` have never had to say `waw` or `war`. This is also the spec's flagship interaction
(§12, "the same program changes behavior") realized **across models** instead of across a knob:
run the same program on `out-of-order` and on `scoreboard` and watch the stalls that renaming
buys you.

**What is cheap because it is shared:** ISA semantics (mirrored verbatim from the golden
reference, as every model does), the assembler, the whole corpus, the recorder, the transport,
every panel, the sandbox, the lesson runner — and **the pipeline map, which must need no change at
all** (see the falsifiable UNCHANGED criteria).

**What is genuinely new:** out-of-order **completion** without a reorder buffer (the first model
here that writes back out of program order and has no structure to put it back), a stall that
fires at the end of an instruction's life, and the three status tables that _are_ the scoreboard's
canonical picture.

**The honest cost, stated up front so it is not discovered at step 7.** M3 step 6 pins that
datapath geometry is never reused across models, and ESLint denies model→model imports, so this
milestone gets **no code reuse from `engine/out-of-order`** (whose `processor.ts` is 75 KB) and
owes its own view. As M13's log put it, the engine side of a model milestone is "a guard + an
audit + nets"; the real work is in the view. Price this as a view-and-curriculum milestone
wearing an engine costume.

## Headline decision — a new package, not a `renaming: false` knob ⛔ gating

The tempting cheap path is a knob on the existing out-of-order model: `renaming?: boolean`, off
means operands come from the architectural register file, so WAR and WAW must stall. It would cost
a fraction of a new package and it would light up the existing OoO datapath for free.

**Recommendation: reject it, and build `packages/engine/scoreboard`.** The reasons are
pedagogical, and INV-5 is the one that decides it:

- **Tomasulo-minus-renaming is a machine that never existed.** A scoreboard has no reorder buffer
  and no common data bus; results go to the register file, out of order, with no in-order commit
  behind them. An OoO model with renaming switched off would still commit in order through its
  ROB — drawing WAR/WAW stalls on a machine that structurally cannot need them the way the CDC
  6600 did. That is a lower tier **contradicting** a higher one, not simplifying it (INV-5).
- **The hazards live in the stages, not in a flag.** "WAW stalls at Issue, WAR stalls at
  Write-Result" is the lesson. On a knob it becomes "two extra stall reasons appear somewhere in
  the scheduler", which is exactly the shape a student cannot draw.
- **One machine per milestone is the house shape** (M7 superscalar alone, M9 OoO alone, M11 deep
  pipeline alone).

The scope lever, if the reviewer wants the milestone smaller: **ship steps 0–5 (a drivable model
with the pipeline map as its only picture) and defer the bespoke view to its own milestone.** That
is a real checkpoint — M2 shipped exactly it as "step 5a" — and it is where this plan's risk
concentrates.

### The machine, precisely ⛔ gating

Stage names chosen so they are honest **and** land on hue families the validated palette already
has (`PHASE_COLORS` keys are exactly `IF ID EX MEM WB` — read at `theme.ts:44-50`, not inferred):

| Stage      | Name              | What happens                                                                                                    |
| ---------- | ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `IF`       | Fetch             | As every model. One per cycle, in order.                                                                        |
| `ID`       | **Issue**         | Decode + the two in-order checks: **FU busy** (structural) and **WAW**.                                         |
| `RO`       | **Read Operands** | **Inside the FU, not a shared stage** — see below. Reads the architectural regfile once both sources are ready. |
| `EX`/`MEM` | Execute           | In one of the **two** integer FUs (`EX`) or the memory FU (`MEM`). Out of order.                                |
| `WB`       | **Write Result**  | The **WAR** check: hold until every older instruction has read this register.                                   |

Pinned consequences that make it a scoreboard rather than a relabelled pipeline:

- **⚠ `RO` is PER-FU and non-blocking; only Issue is shared and blocking.** An instruction leaves
  Issue _into its functional unit_ and waits there for its operands. This is not a detail: **if
  `RO` were a shared in-order stage, WAR would be unreachable** — a younger instruction could never
  reach Write-Result while an older one still had unread operands, and the milestone's second
  hazard would not exist. Step 1's acceptance line depends on this row.
- **Issue is in order and blocking.** An instruction that cannot issue blocks every younger one
  behind it — this is why a scoreboard's window is so much smaller than Tomasulo's, and it is the
  contrast M16's lesson will want.
- **FU latencies are MODEL-INTRINSIC, not a config knob** — the CDC 6600 was a heterogeneous-FU
  machine (add 2, multiply 10, divide 40), and the multi-cycle model's precedent is that its
  per-instruction cycle counts are "this model's definition, not a setting"
  (`multi-cycle/src/processor.ts:82`). This is what makes the whole milestone reachable in free
  play: `slowOpLatency` has **no UI control anywhere** (`useSimulator.ts:356-361` — "A REF ONLY,
  no React state, no interface field, no control"), its only writers are `startLesson` and the
  free-play loads which reset it to 1, so a model whose only latency source was that knob would be
  a machine that never reorders until M16 authors a lesson for it.
- **There is no forwarding and no bypass.** Results reach consumers through the register file
  only. `configurableForwarding: false` — this model _ignores_ the knob (the M4 inertness
  contract), and its trace is byte-identical with forwarding on or off. **That invariance is a
  test, not a comment.**
- **`micro` carries the three classic tables** — instruction status, functional-unit status,
  register-result status. The view is those tables; that is the picture every textbook prints.

## Build order (each step testable before the next)

- [x] **0. Package scaffold + the DAG ripple — ✅ DONE 2026-08-10.** `packages/engine/scoreboard` as
      `@cpu-viz/engine-scoreboard`, wired into all four mechanical places (`eslint.config.js`
      boundary rules **including its own self-exclusion block**, root `tsconfig.json` references,
      `vitest.config.ts` `workspaceAliases`, and `npm install` for the workspace symlink). Per
      M11's step-0 finding, verify the guardrail in **three directions**, not one: a lower layer
      importing the new model, the new model importing another engine (`@cpu-viz/engine-out-of-order`
      is the one someone will reach for), and the new model importing `@cpu-viz/engine-conformance`
      (must lint CLEAN — it is the allowed edge that transitively pulls in the golden reference).
      The web trio (web `package.json` dep, web `tsconfig` `paths`, Vite alias) is **not** here; it
      lands with whichever step first has acceptance inside `packages/web`. Acceptance: `npm run
lint` red on the two denied directions and green on the allowed one, verified by RUNNING it;
      `tsc -b` green as its own check beside vitest (they resolve imports by different routes).
      **Result: done — see "Step 0, as built" below.**

- [x] **⛔ 1-PRE. STOP — decision 4's FU inventory made WAR unreachable. ✅ RESOLVED 2026-08-10: the
      user amended decision 4 to 2 integer + 1 memory.** Raised before any engine code was written.
      Derived on paper 2026-08-10, after step 0, by trying to hand-build
      the WAR program step 1 is supposed to open with — and failing. **Two FUs are not enough**, and
      the reason is the same structural one the plan already pins as milestone-killing for a shared
      `RO`; it just arrives through FU _count_ instead of `RO` placement.

      The argument: a WAR stall needs an older instruction parked at `RO` with one source still
      unread, while a younger one reaches Write-Result on that register. **The only multi-cycle
      latency in this machine is the memory FU** — RV32I has no mul/div, and decision 4 pins integer
      at 1 cycle — so anything parked at `RO` is waiting on a load. That load owns the single memory
      port (decision 7), and the waiting instruction owns the only integer FU, so **no FU is left for
      any younger writer**: it stalls at Issue on `structural`, and in-order blocking Issue stalls
      everything behind it. The load then completes, the waiting instruction reads its operand at
      `RO`, and the window closes untouched. Worked example — `lw x1, 0(x5)` / `add x3, x1, x2` /
      `lw x2, 0(x6)`: the third instruction never issues in time. Note this is the same collapse the
      corpus scan already measured on `branch-flavors.s`'s `a1` WAW candidate ("two integer-ALU
      writers sharing one FU under in-order issue"), so it is a second sighting, not a hypothesis.

      **The fix that follows: a SECOND integer FU** (2 int + 1 mem). `lw x1, 0(x5)` on mem /
      `add x3, x1, x2` on int A, parked at `RO` with `x2` unread / `addi x2, x0, 5` on int B,
      operands ready, one cycle, reaches Write-Result → **WAR on `x2`**. This is also the
      historically honest direction: the CDC 6600 had ten functional units precisely so instructions
      could get past each other. It costs decision 4 one row and step 3's coefficients one term.

      Why this was a STOP and not a patch: decision 4 is a ⛔ gating row the user pinned, and its
      stated basis was "two FUs to start". Changing the count changes the machine's whole timing
      shape, which every hand-derived number from step 3 onward is built on. **The user pinned the
      second integer FU on 2026-08-10**; decision 4's row now reads 2 integer + 1 memory, and step 1
      builds that machine.

      ⚠ **Two consequences to carry into step 1.** The **structural** stall reason now has to say
      _which_ FU class is exhausted, or a student sees "structural" on a machine that visibly has a
      free integer unit. And the three status tables get a fourth row — instruction status, FU status
      (now `INT0`, `INT1`, `MEM`), register-result status — so the step-7 view's width claim was
      priced against the wrong FU count and should be re-measured, not inherited.

- [x] **1. The model MVP — ✅ DONE 2026-08-10.** `Processor` implementation, the stages above, the
      three status tables in `micro`, INV-4 stable ids across an out-of-order lifetime, the intrinsic
      FU latencies, and the stall reasons. Its proof is a **hand-built WAW/WAR program inside the test
      file**, not a corpus program — M11's `+6`-constant precedent. Deriving corpus tables before the
      machine's coefficients are known means deriving twice (see step 6). Acceptance: hand-derived
      unit tests pin a WAW stall at Issue and a WAR stall at Write-Result by cycle and by
      `stall.reason`, and a program whose write-backs are provably out of program order.
      **Result: met — see "Step 1, as built" below.**

- [x] **2. INV-8 differential — ✅ DONE 2026-08-10.** One `runConformance` call with a
      `ScoreboardProcessor` factory, over the full corpus × the config matrix this model actually
      honors. Acceptance: green. **State in the docblock that this is a WEAK net here** — see the
      mutation check at step 3 — so a future reader does not mistake it for coverage of the
      mechanism. **Result: met — see "Step 2, as built" below.**

- [x] **3. THE NET — the timing matrix + a two-part mutation check. ✅ DONE 2026-08-10.** This is the discriminator,
      and the plan leads with it for the reason M11 did: a machine that typechecks, passes INV-8,
      and renders on the map can still be **a 5-stage wearing scoreboard labels**, because
      out-of-order completion reaching the same final architectural state is exactly what INV-8
      checks. So: a closed-form cycle count over corpus × config with every coefficient
      **hand-derived from the recurrence before it is compared to the engine**; a **stall-reason
      histogram** asserted as an event multiset rather than a cycle count
      (`docs/memory/cycles-cannot-see-a-lost-forward.md` is the precedent — a cycles-only identity
      held in every cell while two events silently vanished); and the mutation check run as **two
      separate mutations, both actually executed** and reverted via `git checkout` (commit first —
      a break harness has destroyed an uncommitted tree here before): **stub the WAR check** and
      **stub the WAW check**.

      ⚠ **The prediction that INV-8 stays GREEN under both stubs is scoped to TODAY'S corpus, and
      step 6 flips it.** Stubbing either check corrupts architectural state _given a program that
      contains such a pair_ — so this claim is only true while the corpus has none. Measured
      2026-08-10 (`M:\claud_projects\temp\m15-corpus-scan\scan.mjs`): **zero reachable WAW or WAR
      hazards across all twelve programs.** The two static WAW candidates are both in
      `branch-flavors.s`, where the `a0` pair sits on mutually exclusive branch paths (dead) and
      the `a1` pair is two integer-ALU writers that share one FU under in-order issue (no
      reorder); the three WAR candidates (`array-sum`, `array-sum-twice`, `strided-sum`) are all
      `lw` reads `t0` / `addi` writes `t0`, unreachable because the load's `t0` is ready at Read
      Operands so it reads before the `addi` can write. **After step 6 lands a program with a real
      pair, INV-8 becomes a genuine net on this model** — unusual here, where M7's and M11's logs
      both call it a false net — so **re-run both mutations at step 6**, where INV-8 reddening is
      the strongest available evidence. Acceptance: both mutations produce the predicted pattern at
      step 3 AND at step 6; the numbers are recorded in the plan, not just in the test.
      **Result: met — see "Step 3, as built" below. The step-3 half of that prediction HELD for both
      stubs; the step-6 re-run is still owed.**

- [x] **4. Recorder / time-travel — ✅ DONE 2026-08-10.** Step, scrub, and `follow()` an id through a
      lifetime whose Write-Result is out of program order — the first model where "follow this
      instruction" crosses another instruction that started later and finished earlier. Acceptance:
      recorder tests green; a scrub to any cycle reproduces the recorded state exactly.
      **Result: met — see "Step 4, as built" below.**

- [x] **5. Web enablement — `models.ts`. ✅ DONE 2026-08-10.** One `ModelChoice` row (`datapath: 'none'` until step 7),
      `MODEL_DESCRIPTION`, picker position, and the capability flags. Two things M11 learned the
      hard way, both of which apply verbatim. **The churn is FOUR exhaustive `toEqual` lists, not
      three** — the id list, both `honoring()` lists, and the datapath table in `models.test.ts`;
      inserting a model mid-array shifts more expectations than the id list. And **this model
      REFUSES knobs, so `engineConfigFor(model, config)` must narrow them**: the shell holds
      forwarding / prediction / cache / width / the OoO cluster at session level and hands the
      whole config to whichever engine drives, and `deep-pipeline` was the first engine to refuse
      one — which made a live crash reachable from a click handler. Note `engineConfigFor` clamps
      **`cache` only** today, so a second refusing knob is a real extension with its own argument
      to write out. Ask M11's closing question of this model: **what user-visible prose is gated on
      a flag it turns on?** A tooltip stating another machine's coefficients is an INV-5 violation
      and only a browser can see it.
      Acceptance: the model is drivable end-to-end in `npm run dev`; every refused knob is
      clamped rather than thrown; the pipeline map draws it with no edit to `pipeline-map.ts`.
      **Result: met — see "Step 5, as built" below. Acceptance was taken on the SHIPPED `vite
preview` bundle rather than the dev server, which is strictly stronger evidence (only preview
      excludes a stale/absent `dist`), 36/36 checks green.**

- [x] **6. Promote the WAW/WAR program into `content/programs/` — ✅ DONE 2026-08-10.** One corpus, three jobs (INV-7),
      so the demonstration must be a real corpus program and not a test fixture — but it is priced
      here, after the machine exists. **Land the `.s` and run the FULL suite first: the failure
      list IS the scope.** The branch-prediction log measured **six** pinned sites moving where the
      plan priced three, and the three nobody predicts are shape claims invisible to a grep
      (`superscalar/pairing.test.ts`'s second completeness table, `superscalar/processor.test.ts`'s
      slot-surjectivity sets, `web/pairing-readout.test.ts`'s IPC enumeration, plus a hard-coded
      `'eight of eleven'` in prose). Screen the candidate layout with a dump script under
      `M:\claud_projects\temp\` **before** hand-deriving any table row. Acceptance: full suite
      green with every moved table re-derived by hand, and the program's WAW/WAR stalls visible on
      `scoreboard` while it stays architecturally identical on all six other models (INV-7/INV-8).
      **Result: met — see "Step 6, as built" below. ⚠ With one scope caveat stated rather than
      implied: the four out-of-order `dynamic-predict` cells are MEASURED, not derived, on that
      file's own documented method.**

- [ ] **7. The bespoke view — the three status tables.** Unlike every previous model, this one's
      canonical picture is **not** a wire-and-box datapath: it is the scoreboard's three tables
      evolving cycle by cycle. Build it in the two-halves shape (a pure fold over the trace +
      `micro`, tested headlessly; a thin React view that owns drawing only). Whether a wire-level
      datapath _also_ ships is a decision below, seeded "not in this milestone". Acceptance: the
      pure fold has its own tests; render smoke tests via `renderToStaticMarkup`; no new color
      token (see the falsifiable criteria).

- [ ] **8. Browser pass over the SHIPPED bundle.** `vite preview`, not the dev server. Read every
      hand-derived number live. Per `docs/memory/browser-is-the-only-net.md`, this is where the
      milestone's real defects are — 10 of 11 view steps in this repo shipped a defect only the
      browser caught. Sweep Chrome with `M:\claud_projects\temp\rig-sweep.ps1` at the START of the
      pass. Acceptance: a written check list, every check passing, with the panel measured at a
      STATED narrow viewport in the app's most crowded state (`panel-jitter-and-height-reserves.md`).
      ⚠ **Re-measure the map's LEGEND ROW rather than inheriting the five-family measurement.** This
      model draws **six** legend chips (`IF ID RO EX WB MEM`), a new maximum in the product — every
      prior model draws five or fewer, and the out-of-order draws two. The legend is a horizontal row
      inside the map panel, so it is precisely the width-moves-with-the-content case that memory is
      about. Step 5's pass ran at **1600×1400 only** and made no width claim.

## Step 0, as built (2026-08-10)

`packages/engine/scoreboard` = `@cpu-viz/engine-scoreboard`, on M11's step-0 shape (`bfbdfc2`):
`src/index.ts` exports the model id and the thesis docblock and nothing else — `ScoreboardProcessor`
is step 1's and `MODEL_DESCRIPTION` step 5's. The ripple landed in all four mechanical places plus
`npm install`; the web trio is deliberately absent until step 5.

**Five probe cells, not the three this plan priced** — each written as a temporary file, run through
`npx eslint`, then deleted (no `git checkout` harness, per M13's destroyed-tree finding). The two
extra ones are where the real failure modes live:

| Probe                             | Expected | Observed                                              |
| --------------------------------- | -------- | ----------------------------------------------------- |
| `trace → scoreboard`              | RED      | RED, with the **INV-3** message                       |
| `out-of-order → scoreboard`       | RED      | RED, with **out-of-order's** message                  |
| `scoreboard → out-of-order`       | RED      | RED, with **the scoreboard's own** message            |
| `scoreboard → engine-conformance` | CLEAN    | CLEAN (exit 0)                                        |
| `scoreboard → scoreboard`         | CLEAN    | CLEAN (exit 0) — the `MODELS.filter` self-subtraction |

Row 1 is the cell that proves the `...MODELS` spread edit took: a model missing from that constant
lints clean in **four lower layers at once**, which is exactly how M9's `engine-out-of-order` was
omitted. Row 3 is checked by its **message TEXT, not its exit code** — the generic
`packages/engine/**` rule denies only `curriculum`/`web`, so without the new self-exclusion block
that import lints CLEAN, and an exit code alone cannot tell you which rule fired.

⚠ **What step 0 does NOT prove: any of the four declared import edges — all four are declared and
ZERO are exercised.** The package imports nothing yet, and the two GREEN eslint probes are pattern
matches, not resolution checks, so they say nothing about resolvability either. `tsc -b` builds the
referenced projects but never resolves an import across those edges.

| Edge                                        | First exercised by |
| ------------------------------------------- | ------------------ |
| `../common` (`toProgramImage`)              | step 1             |
| `../../assembler` (drives the unit tests)   | step 1             |
| `../conformance` (the INV-8 harness)        | step 2             |
| `vitest` alias `@cpu-viz/engine-scoreboard` | step 5             |

The alias is the one that stays cold longest, and it cannot be closed earlier: the only importer
that would not violate the DAG is `web`, which is step 5. **Don't chase it with a self-import by
package name** — that resolves through `exports` to `dist` under tsc while vitest resolves to
source, so it buys a route mismatch and a non-house idiom to close a gap this note already carries.
The package's smoke test imports `./index` relatively (the `single-cycle` house pattern), so what it
proves is vitest's `include` glob and the model id. Do not read a green step 0 as "the wiring works".

Gates: `npm test` **11193 passed / 1 skipped = 11194 total** (11193 → 11194, 92 → 93 files — the one
new smoke test), `tsc -b` green, `npm run lint` clean, `npm run build` green, `format:check` clean.

## Step 1, as built (2026-08-10)

`packages/engine/scoreboard/src/processor.ts` (~900 lines with its docblocks) + a 46-test
`processor.test.ts`. Repo **11194 → 11239** tests, 93 → 94 files; `tsc -b`, `lint`, `build`,
`format:check` all green. The machine runs all twelve corpus programs to a halt and is
architecturally equal to the golden reference on every one (measured — step 2 formalizes it).

### The three things this plan did not price

**1. ⚠ Issue must STOP at an unresolved control transfer, and that is forced by INV-8, not chosen.**
Decision 3 pins no predictor and says a taken branch "simply flushes the front end". With `RO`
non-blocking (decision 2b) and no reorder buffer, nothing otherwise stops a younger instruction
reaching Write-Result while an older branch is still parked on an operand — and a landed write
cannot be taken back. So Issue holds, which makes decision 3's sentence literally true: with Issue
held, the front end IS the `IF` slot and nothing else.

**This is REACHED, not merely reachable, and by the corpus** — stubbing the block reddens INV-8 on
**`array-sum-twice.s` and `nested-loop.s`**, neither of which needs a load: a branch parked one cycle
on the `addi` immediately before it is window enough for the fall-through instruction to take the
other integer unit and write back. So **INV-8 is a REAL net for THIS mechanism from step 2 on**,
unlike the WAW/WAR mechanisms it is blind to (below). The test file also carries the hand-built
load-parked witness, which opens a nine-cycle window instead of a one-cycle one.

**Cost: a fifth stall reason, `'control'`, amending decision 6** (a non-gating row). The
alternatives were reusing `'structural'` — which claims a unit is exhausted when none is, beside a
table that visibly shows one free — or emitting nothing, which leaves the machine stopped with
nothing in the trace to say why. `'raw'` remains untouchable (pinned repo-wide to "forwarding is
off"). Same amendment splits `'structural'` into **`'structural-int'` / `'structural-mem'`**, which
decision 4's own amendment note had already asked for.

**2. ⚠ Architectural `pc` cannot be "the retiring instruction's `nextPc`" here.** Every earlier model
uses that rule and it is only well-defined because retirement is in order — which is exactly what
this model breaks. Read that way, `pc` moves **BACKWARD** mid-run: on the out-of-order witness it
would jump to 16 at cycle 6 and back to 4 at cycle 10, at every recorded cursor position, while
still ending on the right value where INV-8 looks. `pc` advances across the completed program-order
**prefix** instead, via an issue-order queue that holds no values and can undo nothing (it is not a
ROB). ⚠ The isolated evidence for this rule is the step-1 unit test, NOT INV-8: the "whoever
completed last" mutation also perturbs the drain path, so the 4 corpus programs it reddens
(`array-sum`, `strided-sum`, `byte-loads`, `store-forward`) trip the **drain guard**, not a `pc`
equality. Do not cite them as a pc net.

**3. `MEM_LATENCY = 4`, derived rather than picked.** With `WB = RO + 1 + L`, a load and the
independent integer ops issued behind it write back at `4 + L`, 6 and 7. `L = 2` **ties** the load
with the first (no reorder at all); `L = 3` beats the first by one and ties the second — a
one-cycle photo finish on the milestone's own acceptance criterion, collapsed by an issue skew of
two. `L = 4` clears both, by 2 and by 1, and two integer units is exactly how many can be in flight
beside a load, so it is clear of every REACHABLE skew rather than of the one that was measured.
Step 3 hand-derives every coefficient from this constant.

### The mutation check, run early (step 3 still owes its own)

Four stubs, each applied to `processor.ts`, run, and reverted (never a `git checkout` harness —
[[m13-width-planned]]'s destroyed tree; the tree was committed first regardless).

| Stub          | step-1 unit tests | corpus INV-8 (12 programs)                 |
| ------------- | ----------------- | ------------------------------------------ |
| WAR check     | 3 red             | **12/12 GREEN**                            |
| WAW check     | 3 red             | **12/12 GREEN**                            |
| control block | 2 red             | **2 RED** (array-sum-twice, nested-loop)   |
| `pc` prefix   | 2 red             | 4 red — but via the DRAIN GUARD, see above |

**Rows 1 and 2 confirm the plan's step-3 prediction ahead of time**: INV-8 is a false net for WAW
and WAR on today's corpus, and step 6 is what turns it into a real one. Row 3 is the finding: it is
already a real net for the control mechanism.

### ⚠ The corpus DOES have reachable WAW hazards — the step-0 scan missed the pseudo-instructions

`docs/memory/m15-scoreboard-planned.md` records "zero reachable WAW or WAR hazards", measured at
step 0. **The WAR half holds** (zero `'war'` stalls anywhere in the corpus). **The WAW half does
not**: `'waw'` stalls fire on **6 of 12** programs, because `la rd, label` expands to
`lui rd, …` / `addi rd, rd, …` — two writers to one register, one instruction apart. The scan read
source mnemonics, not the assembled stream.

The distinction that keeps both claims true at once: those pairs produce WAW **stalls** (timing) but
never WAW **corruption** (architecture), because the younger `addi` also READS the register and so
waits on the producer regardless. That is why row 2 of the table above is still green. The step-6
program must therefore contain a WAW pair whose younger writer does **not** read the older one's
destination, or it will not turn INV-8 red.

### Measured corpus baseline — ⚠ NOT the step-3 oracle

Recorded so accidental drift is visible, and flagged because step 3's whole method is to hand-derive
from the recurrence FIRST and compare afterwards. **Do not read a number out of this table into a
derivation.** Neutral config, `MEM_LATENCY = 4`:

| program             | cycles | stall reasons observed                             |
| ------------------- | ------ | -------------------------------------------------- |
| `add.s`             | 9      | structural-int 2                                   |
| `array-sum.s`       | 89     | control 6, operand 26, structural-int 32, waw 7    |
| `array-sum-twice.s` | 346    | control 28, operand 124, structural-int 151, waw 6 |
| `branch-flavors.s`  | 21     | control 2, structural-int 5                        |
| `byte-loads.s`      | 22     | operand 2, structural-mem 8, waw 3                 |
| `call-return.s`     | 23     | control 2, structural-int 5                        |
| `nested-loop.s`     | 222    | control 36, operand 4, structural-int 59, waw 8    |
| `paired-branches.s` | 13     | control 2, structural-int 2                        |
| `slow-op-loop.s`    | 74     | control 6, operand 12, structural-int 29           |
| `store-forward.s`   | 23     | operand 2, structural-mem 8, waw 3                 |
| `strided-sum.s`     | 89     | control 6, operand 26, structural-int 32, waw 7    |
| `sum-loop.s`        | 80     | control 10, structural-int 23                      |

`'war'` is **absent from every row** — the one hazard this milestone exists for is invisible on the
shipped corpus, which is precisely what step 6 is for. ⚠ `array-sum.s` and `strided-sum.s` agree at 89
not by luck but **by construction** (same instruction shape; this model is cache-blind, so the 4-byte and
16-byte strides are the same machine): a derivation that reproduces 89 for one reproduces it for the
other automatically. **They are ONE data point, not two, and neither cross-checks the other** — step 3
must find its second witness elsewhere.

### Smaller things worth carrying

- **Stall CADENCE is a contract**: exactly one `stall` event per stalled instruction per stalled
  cycle. Step 3 asserts a multiset, so the count is load-bearing, not an implementation detail.
- **`location` stays in the STAGE vocabulary** (`IF ID RO EX MEM WB`), never `INT0`/`INT1`. An FU
  name there would mint a new `stageFamily` and silently break the "`pipeline-map.ts` needs no edit"
  criterion below — no engine test looks at a hue. Pinned by a test that enumerates the location set.
- **`micro` is snapshotted AFTER the clock edge**, like `state.registers`. Consequence a view author
  must know: a unit can show `Rj`/`Rk` set in the same cycle its stall event says it could not read —
  both true, one cycle apart. Flagged for step 7.
- **The machine is deadlock-free by construction, and the argument is short**: only a unit that has
  NOT read its operands can block a WAR, and a unit waiting on a producer has `R` clear for that
  operand — so a unit can never block the very write it waits for. A `WAR`-blocked write is only ever
  blocked by an OLDER unit, and the oldest unit in the machine always advances. A loud
  "cycle advanced nothing" throw guards it anyway, since determinism makes one stuck cycle infinite.
- **`add.s`-style drain**: `pc` past the end of `.text` and `halted` both match the reference, and a
  guard throws if the machine ever reports halted with instructions still in flight.

## Step 2, as built (2026-08-10)

`packages/engine/scoreboard/src/differential.test.ts` — `runConformance` and a docblock, nothing
else. **+14 tests** (12 corpus cases + the harness's two vacuity guards), repo **11239 → 11253**,
**94 → 95 test files — both totals INCLUDING the one skipped file**, which is not this step's and
is on the same basis as step 1's "93 → 94". `test`, `typecheck`, `lint`, `format:check` all green.

**The matrix is ONE config, and the docblock gives two reasons that fail differently** so a later
reader cannot "restore" an axis: every knob this model ignores is INERT — pinned in
`processor.test.ts` as a **byte-identical trace** at every position, so an extra column would be
green by arithmetic identity, which is exactly the false coverage `m7-superscalar-engine` and the
`deep-pipeline`/`out-of-order` differentials warn about — and the two it refuses (`cache`,
`issueWidth > 1`) **throw** rather than redden, so those axes would read as a broken suite instead of
as the scope lever they are. Unlike `deep-pipeline`'s cache refusal, no later step lifts either.
⚠ Do **not** add an explicit `issueWidth: 1` beside the absent one to make the axis visible:
`configLabel` defaults both sides before comparing, so the two fold, no label is emitted, and the
matrix gains twelve duplicate `it()` titles.

**This is the first step that exercises the `@cpu-viz/engine-conformance` import edge at all** —
step 0 recorded all four of the package's declared edges as unexercised. It matters which gate
proves it: `npm test` resolves the workspace name through `vitest.config.ts`'s aliases, while
`tsc -b` resolves it through the root project references and the workspace symlink. A green vitest
run with a missing declaration is the way this step would report done with a gate red. Both were
run; the scoreboard's wiring already matched `deep-pipeline`'s byte for byte (test-only edges live
in `tsconfig.json` `references`, **not** in `package.json` — the repo-wide convention).

### The control mutation, re-run against the real suite

Step 1's early table already stubbed the `'control'` block against an ad-hoc harness and got 2 red.
Re-running it here **confirms the same two programs** (`nested-loop.s`, `array-sum-twice.s`, ten
green). Two things behind that count are new, and both went into the docblock because either would
be misread from the number alone:

- **Both failures arrive on the harness's `MAX_STEPS` cap, not on a state comparison.** The
  surviving wrong-path instruction is a _loop counter's decrement_, so the corrupted machine never
  finishes rather than finishing wrong. Probed on `nested-loop.s`: `addi t2, t2, -1` (pc 28, the
  OUTER pass counter) retires after **every** taken iteration of the INNER branch at pc 24; `t2`
  reaches −16 and keeps falling, so `bne t2, x0, outer` never terminates. "INV-8 red" here does not
  mean "registers differ".
- **The ten green cells are a WINDOW measurement, not an absence of wrong-path writes.** With the
  hold removed the window is one or two instructions deep, bounded by the stage walk (`stageExecute`
  runs before `stageIssue`, so the redirect empties `IF` before Issue is asked). The second slot
  exists only when the branch itself stalls a cycle at `RO` — and **measured over all twelve
  programs, exactly four have a branch that stalls there at all** (`nested-loop` 4 cycles,
  `array-sum-twice` 2, `array-sum` 1, `strided-sum` 1) **and none stalls for more than ONE cycle**.
  Which two programs redden is decided by _what the survivor writes_, not by whether one exists:
  `array-sum` and `strided-sum` stall a branch at `RO` too and stay green, and in `sum-loop.s` the
  lone survivor is `li a7, 10`, which writes the value the program was going to write anyway.

⚠ **Those four numbers are BRANCH-only `RO` stalls and are NOT the `operand` column of the baseline
table above** — a step-3 author must not read one for the other. They coincide on exactly one row,
and it is the confusable one: `nested-loop.s` shows `operand 4` and has 4 branch `RO` stalls, so
every operand stall in that program happens to be a branch. **That identity is a coincidence and
breaks everywhere else** — `array-sum` is operand 26 against 1 branch stall, `array-sum-twice` 124
against 2, `strided-sum` 26 against 1. The baseline table counts operand stalls by ALL instructions;
this measurement counts only transfers, because only a transfer's `RO` stall widens the wrong-path
window.

Two claims were deliberately left structural rather than measured, and the docblock says so: the ISA
transcription (ESLint denies the reference import by name, so the differential is the only net on the
copy — the claim `deep-pipeline` and `out-of-order` both make without a mutation), and the `pc`
prefix rule (at halt the retire queue is drained by construction, so "completed prefix" and "whoever
wrote last" **coincide on the final `pc`** — which is why step 1's `pc` mutation reddened through the
drain guard instead).

## Step 3, as built (2026-08-10)

`packages/engine/scoreboard/src/timing.test.ts`. **+20 tests** (12 matrix cells + the corpus
guard + the twin identity + 2 corpus-absence claims + 4 isolated-coefficient programs), repo
**11253 → 11273**, 95 → 96 test files. `test`, `typecheck`, `lint`, `build`, `format:check` all
green. Every hand-derived number balanced on the FIRST run of the suite.

### The closed form is TWO identities, and `tail` is not a residual

> **1. `s_last = N + D + T + E`** — the issue accounting.
> **2. `cycles = s_last + tail`, `tail = 3 + L + ownStalls − issueOffset`** — the drain, charged to
> a **named** last writer.

The first draft made `tail := 1 + max(w) − s_last`, which is definitionally whatever balances the
equation and constrains nothing. Fixing it meant hand-deriving **which instruction writes last**,
and that turned out to be a finding rather than bookkeeping: **on 4 of 12 programs the last writer
is NOT the last instruction issued** (`array-sum`/`strided-sum`'s `sw`, `byte-loads`'s `lbu`,
`store-forward`'s `lw` — each still in the memory unit while the `ecall` behind it has already
written). That is out-of-order completion showing up in the drain, and pinning the writer's
identity is what makes the tail an assertion instead of arithmetic.

### ⚠ The term the plan did not have: `E`, the STARVED front end

Found by running identity 1 across all twelve programs **before deriving any table** — which is the
transferable part of the method, since a missing accounting term would have been inherited by every
one of twelve hand-derived rows. `B = 1 + T` (one IF-empty redirect cycle per taken transfer, plus
the cycle-0 fill) is wrong on exactly one program: **`call-return.s`, off by 1.**

**A taken transfer at the LAST WORD of `.text` has no victim to charge its `'control'` stalls to.**
Fetch stopped the moment it issued (`pc + 4` is out of text), so the cycles Issue spends blocked
pass with `IF` empty and emit **no event at all** — the same cycles, moved out of the stall
histogram and into a term nothing records. `ret` is the corpus's only such instruction, `E = 1`,
and it is also why that program shows **2 taken transfers against 1 `flush`**. Isolated on a
three-instruction witness (`jal` / `ecall` / `jalr`) so the term is structural rather than a
`call-return` quirk. **Generalizes: an accounting identity that closes on 11 of 12 programs has
found a mechanism, not a rounding error.**

### ⚠ The dominant term is not a hazard — the TURNAROUND CEILING

A unit is held from `s` to `w` inclusive and frees only at that cycle's clock edge, so the next
occupant issues at `w + 1`: **an integer unit turns around in 4 cycles, the memory unit in 7.** Two
integer units ⇒ **a hard ceiling of 0.5 IPC on integer-only code with no hazard of any kind
present** (isolated: six independent `addi`s issue at 1, 2, 5, 6, 9, 10 — 6 instructions, 14
cycles). It is the largest term in every corpus row — `structural-int` runs 32 / 151 / 59 / 29 / 23
on the biggest programs — and **it dwarfs the two hazards this milestone exists to show**. Not a
bug and explicitly **not** a reason to reopen decision 4, but **step 7's view and M16's lesson must
both say it out loud**, or a student reads the wall of `structural-int` as the scoreboard's verdict
on their program rather than as the size of the machine.

### The mutation check — predictions written down first, both held

Two separate mutations, each applied to `processor.ts`, all **three** suites run under each, and
reverted with `git checkout -- packages/engine/scoreboard/src/processor.ts` (one named file, on a
committed tree — the reconciliation of this plan's "revert via `git checkout`" with
`m13-width-planned`'s destroyed tree: the destroyed tree was a BROAD checkout over uncommitted work).

| Stub                                           | `processor.test.ts` | `differential.test.ts` | `timing.test.ts` |
| ---------------------------------------------- | ------------------- | ---------------------- | ---------------- |
| **WAW** — `issueBlocker` never returns `'waw'` | 3 of 46 red         | **14/14 GREEN**        | **7 of 20 red**  |
| **WAR** — `warBlocked` always returns `false`  | 3 of 46 red         | **14/14 GREEN**        | **20/20 GREEN**  |

The WAW row is **6 matrix cells** — exactly the six programs carrying `'waw'` rows (`array-sum`,
`strided-sum`, `array-sum-twice`, `byte-loads`, `store-forward`, `nested-loop`) — plus the
operand-invisibility test, which reddens only through its `array-sum.s` coda and is not a seventh
program.

⚠ **The asymmetry IS the finding, and step 3 closes only HALF the hole it was written for.** For
WAW this suite is a genuine corpus-scale net where INV-8 is a false one. For WAR **nothing at
corpus scale nets it at all** — not INV-8, not this file — because no corpus program contains the
hazard: the whole timing matrix walks past a deleted WAR check without a flicker, and its only net
anywhere in the repo is `processor.test.ts`'s hand-built witness. Step 6 is what changes that.

⚠ **And note what the green WAW differential does NOT say.** It stays green because every corpus
WAW pair's younger writer also READS the older one's destination, so it waits on the producer
regardless — timing moves, architecture does not. **Step 6's promoted program needs a WAW pair
whose younger writer does not read that register**, or INV-8 will not redden at the re-run either
and the two measurements will say the same thing twice.

### ⚠ What step 4 must not break

**Both identities read `micro.instructions`** — `s_last` from the `issue` column, the last writer
from `writeResult` — and they are computable only because `inFlightThisCycle` keeps a row visible in
the cycle it completes (`doneCycle === this.cycle`). Step 4 is the recorder, and its acceptance is
"a scrub to any cycle reproduces the recorded state exactly": **if it ever narrows what a cycle
retains, this suite goes red for a reason that has nothing to do with the schedule.** That is the
confusing debugging session to avoid, and the reason the folds read the table rather than counting
events (no event states an issue cycle, so there is no cheaper route that stays inside INV-3).

### Smaller things worth carrying

- **The histogram is keyed by (pc, reason), not by pc.** Six reasons here against `deep-pipeline`'s
  two, and **two sites genuinely swap reason on consecutive cycles**: `branch-flavors.s`@28
  (`control` then `structural-int`) and `array-sum.s`@40 (`structural-int` then `waw`). A pc-keyed
  histogram would hide a mechanism swap behind a matching total. Each reason's **stage** is asserted
  with it, which is the corpus-scale form of "WAW stalls at Issue, WAR stalls at Write-Result".
- **`'operand'` costs ZERO issue slots** — `RO` is non-blocking, so it appears in neither identity's
  `D`; it reaches the cycle count only through the `ownStalls` term of whichever instruction writes
  last. Isolated on two programs differing in ONE register: same issue schedule `[1,2,5,6,7]`, same
  `N`/`D`/`T`, 5 operand stalls against 0, tails of 9 and 6. `array-sum.s` balances both identities
  exactly while carrying **26** operand stalls the closed form cannot see.
- **Loops converge fast, but not always at iteration 1** — derived at iterations 1, 2 and 3 and
  checked before multiplying. `sum-loop` (period 7) and `slow-op-loop` (period 10) and
  `nested-loop`'s inner loop (period 7) converge from iteration 1; **`array-sum` and
  `array-sum-twice` do not** — iteration 1 → 2 is 14 and every later step is 13, and iteration 1
  also pays a different `operand` count at the accumulate (3 vs 5) because a WAW stall delayed its
  issue. Assuming uniformity would have been wrong by 4 stall cycles on two programs.
- ⚠ **`array-sum.s` and `strided-sum.s` are ONE data point**, asserted as its own test (identical
  cycle count and identical histogram). The second cross-check comes from the four isolated
  coefficient programs, not from another corpus row.
- **Provenance is stated honestly in the docblock rather than claimed.** The plan's step-1 baseline
  table (totals) was already read, and the by-pc histograms were visible too, because the probe that
  ran identity 1 printed more than identity 1 needed. So the table's warrant is the **derivation
  printed beside each number**, not the order of operations — and `tail`, the last-writer
  identities, `E`, and every per-iteration coefficient are genuinely new. **Print only what the
  question needs; a probe that over-reports contaminates the step it was meant to unblock.**

## Step 4, as built (2026-08-10)

`packages/engine/scoreboard/src/recorder.test.ts`. **+20 tests**, repo **11273 → 11293 passing**,
96 → 97 test files. All five gates green. A **PROOF, not a build**: `packages/trace/src/recorder.ts`
is untouched and so is `processor.ts` — which is also how step 3's "what step 4 must not break" note
is discharged, with the retention itself pinned as one assertion rather than a section.

⚠ **The repo test count in this plan and in `docs/memory` was off by one in its own terms.** Step 2
pins that both totals "INCLUDE the one skipped file", but the recorded **11273** is the PASSED
count; including the skip it was **11274**. Measured directly — the new file was moved out of the
tree and the suite re-run — rather than inferred from arithmetic, because the +20 did not land where
it should have. **When a delta misses by one, measure the baseline; do not reconcile it on paper.**

### What the file deliberately does not re-prove

`processor.test.ts` already pins the `pc` prefix timeline and its monotonicity, per-cycle `micro`
independence, and id contiguity — all against stubbed code; `timing.test.ts` owns every cycle count.
Reading any of them back through a cursor adds nothing. Aliasing needed no block either:
`snapshotMicro` value-copies everything it emits (fresh row literals, `[...this.result]`), so this
model has no in-place-mutated view object of the kind M9's ROB entries are.

### ⚠ The two tables a view draws from DISAGREE, and it is deliberate

A flush cycle sights **two ids at `location: 'IF'`** — `executeSlot` moves the casualty into
`ctx.flushed` and `stageFetch`, walked after Execute, fills the emptied slot from the target in the
**same cycle**. But `snapshotMicro` rows only `this.ifSlot`, never `ctx.flushed`. So
`trace.instructions` reports two and `micro.instructions` reports one, for the same cycle. The
casualty is a casualty, not an occupant of the machine — **pinned here so step 7 does not quietly
"fix" one table to match the other.**

### ⚠ Two walk shapes step 7 must render, and neither has a sibling in the product

- **An Issue stall repeats the `IF` cell while the stall EVENT says `stage: 'ID'`.** Every latch
  machine here puts a stalled instruction _in_ the stage that stalled it. Issue is a **transition**
  on this machine, not a latch: the instruction never leaves `ifSlot`, so `location` and
  `stall.stage` legitimately disagree. **A view that highlights `stall.stage` will light a cell the
  instruction is not in.**
- **A WAR stall repeats `WB` — the LAST cell.** Every other stall in the whole product repeats an
  early cell, because every other stall fires at the beginning of an instruction's life. The WAR
  witness's younger writer reads `IF ID RO EX WB WB WB WB`: a walk that ENDS in its stall.

The WAR witness draws all three of this model's stall shapes at once (`structural-int` at Issue
repeating `IF`, `operand` repeating `RO`, `war` repeating `WB`), which is why the block uses it
rather than three toys. Both witnesses are **re-used verbatim from `processor.test.ts`** rather than
re-derived — reproducing a pinned table would give it two owners.

### The mutation check — the stubs that test THIS file, not step 3's

Step 3 already spent the WAW and WAR stubs. The mutations that actually net a recorder suite are the
two that change what a cycle REPORTS. Predictions were written down first; both applied to
`processor.ts` on a committed tree and reverted with `git checkout --` on that one named file.

| Stub                                               | `processor.test.ts` | `differential.test.ts` | `timing.test.ts` | `recorder.test.ts` |
| -------------------------------------------------- | ------------------- | ---------------------- | ---------------- | ------------------ |
| narrow `inFlightThisCycle`'s `doneCycle` retention | 2 of 46 red         | **14/14 GREEN**        | **12 of 20 red** | **9 of 20 red**    |
| drop the `ctx.flushed` push                        | 1 of 46 red         | **14/14 GREEN**        | **20/20 GREEN**  | **2 of 20 red**    |

Two things the table says that the counts alone do not:

- **INV-8 is blind to BOTH.** Retention and the casualty are reporting concerns; the architectural
  state is identical either way. So the conformance differential is a false net here for a third
  reason, on top of the two step 2 recorded.
- **The casualty push has exactly TWO nets in the entire repo** — `processor.test.ts`'s one
  hand-derived cycle and this file. Not INV-8, not the timing matrix. ⚠ **Repo scope here is
  MEASURED, not inferred**: the first run of this mutation covered `packages/engine/scoreboard/src`
  only, which is five files and cannot support a repo claim. Re-run over the FULL suite —
  **3 red out of 11294, in exactly those 2 files.** A package-scoped run never licenses a
  repo-scoped sentence.

⚠ **What the mutation table does NOT cover: the navigation block itself.** Both stubs live in
`processor.ts`, and neither perturbs the seven `load → run → back → scrub` tests — which are the
step-4 acceptance criterion verbatim. They passed on the first run and have no broken-code check
behind them, because the only mutation that would redden them lives in
`packages/trace/src/recorder.ts`, the file this step's whole claim is that it does not touch. Stated
rather than left for the table to imply: **the navigation spine is proof by construction (the
recorder is model-agnostic and already netted by six sibling suites), not by mutation.**

⚠ **A prediction that was WRONG, and it is the transferable part.** Mutation B was predicted to
redden **three** recorder tests, the third being the corpus claim "flushed instructions exist and
never retire". It stayed **GREEN** — because dropping the casualty push does **not** remove the
casualty from the recording, it **truncates its walk by one cycle**: the instruction was already
sighted at `IF` in the cycles it sat there _before_ the flush. So a test shaped "a casualty exists
and never retires" is a **false net for the casualty push**; only a test that names the exact
sighting CYCLES catches it, which is why the `follow()` assertion is a `toEqual` over three
`{cycle, location}` pairs and not a set membership. **Same family as step 2's finding that the ten
green control cells were a WINDOW measurement rather than an absence.**

### Smaller things worth carrying

- ⚠ **The loop stall belongs to the loop's ENTRY, not its body.** Predicted that "most" of
  `sum-loop`'s ten dynamic `add a0, a0, t0` walks would exceed five cells; **exactly one does** —
  iteration 1's, held two cycles at Issue on `structural-int` while both `li`s still occupy the
  integer units. Every later iteration's `add` is fetched only after a taken `bnez`, which — Issue
  having been held since that branch issued — hands it a nearly drained machine with both operands
  long since written. **The steady state is a clean five.** Asserted as `toHaveLength(1)` plus the
  identity of which one, so the claim is the mechanism rather than a threshold.
- **ONE config, and it is `defaultConfig()` itself.** `cache: null` is deliberately NOT written
  explicitly the way `deep-pipeline`'s recorder suite writes it: there it guards a knob that model
  HONORS, here the default is already the only value `reset()` accepts and every other knob is
  inert (step 2's one-column finding, at the recorder layer).
- **The pre-run cursor (-1) over `emptyMicro()`** — three idle unit rows, no instruction rows, 32
  unclaimed registers — is reachable only through `load()`, so no earlier test could have covered
  it. It matters for step 7: the three tables exist from the first frame, so the view can draw a
  stable layout instead of materializing when the first instruction issues.
- **`instr-retire` follows write-back exactly**, asserted as a list. On M9 those two orders
  disagree; here they cannot, and that impossibility IS the distinction from a reorder buffer.

## Step 5, as built (2026-08-10)

`models.ts` + the web trio + `SCOREBOARD_MODEL_DESCRIPTION`. Repo **11293 → 11303** passing
(11294 → 11304 including the one skipped file), 97 files unchanged — the new claims went into
existing suites rather than a new file, so the map's render claims keep ONE owner. Five gates green.
Browser pass: **36/36 on the shipped `vite preview` bundle.**

The row sits **last** (decision 8) with `datapath: 'none'`, and the picker order argument is worth
keeping because it looks like it contradicts M11's. The deep pipeline was INSERTED mid-array rather
than appended, deliberately, and this one is appended — the difference is what the row is FOR. A
step along the road the reader is walking belongs in its place on the road; a PREDECESSOR met after
its successor only reads as one if the successor is already behind you. The description carries that
framing ("the out-of-order machine before register renaming"), which is why decision 8 pinned
position and wording together.

### The description says two things it must not, and both would contradict the engine

It does **not** say "out-of-order issue". Issue here is in order and BLOCKING, and stops dead at an
unresolved transfer — step 1's `'control'` finding, forced by INV-8. Only COMPLETION reorders. The
out-of-order row sits directly above and honors an `outOfOrderIssue` toggle, so a blurred line makes
the two rows read as one claim. And it does not promise dramatic reordering: step 3 measured the
dominant term as the **0.5-IPC turnaround ceiling**, not a hazard, so most corpus cycles are
`structural-int`. The superscalar's "up to" hedge exists for exactly this failure.

### ⚠ `engineConfigFor` is PROTECTION again, and the predicate is the flag — not the model id

M11 step 6 implemented the deep pipeline's cache, and from then until today no shipped engine refused
anything, so the function was normalization only. The scoreboard refuses `issueWidth != 1` by name.
**The crash path is a click sequence**: set the superscalar 4-wide, pick Scoreboard, and the width
control is GONE (it renders only under `configurableIssueWidth`) — so the reader cannot unset the
value that throws. Verbatim the M11 step-5 crash on a new knob, and the same argument forces
clamping over an error message: a refused knob is precisely one whose control has been taken away.

The predicate is `configurableIssueWidth`, not `model.id === 'scoreboard'`, because
`ProcessorCapabilities` has no "refuses" bit distinct from an "ignores" bit and the shell gates
everything else on flags. That means the clamp also reaches the four width-BLIND models.

⚠ **That extension was re-measured rather than inherited from M13, and the warrant is a grep, not a
green suite.** `pipeline`, `deep-pipeline`, `single-cycle` and `multi-cycle` do not mention
`issueWidth` anywhere in their `processor.ts`. **The suite would have stayed green either way** —
the timing suites drive engines directly and never cross this seam. Clamp value is **1, not
`undefined`**: the shell holds a POSITION (`session.ts` opens at 1, `useSimulator` always passes a
number), and the engines' own `?? 1` already agrees with it.

⚠ **The `issueWidth` skip in `engine-config.test.ts`'s scope test is CONDITIONAL on the flag.** The
obvious blanket `continue` deletes a net: it would then permit a width clamp on the superscalar and
the out-of-order core, which is verbatim the M13 step 6 half-dead toggle (`min(w, 2)` — right at
widths 1 and 2, silently wrong at 3 and 4) one layer above where M13 fixed it.

### The mutation check — two stubs, predictions written first, both held

| Stub                                               | repo-wide result                                              |
| -------------------------------------------------- | ------------------------------------------------------------- |
| drop the `issueWidth` clamp from `engineConfigFor` | **3 red of 11304**, in exactly 2 files                        |
| `?? T.accent` → another hue in `PipelineMapView`   | **1 red of 11304** — the sole net in the repo is written here |

⚠ **What the table covers, stated because step 4's own lesson is that a table without a scope
sentence implies the whole suite was exercised.** Both stubs are **reporting-side**: they change what
a config carries or what a cell is colored. Neither perturbs the picker row's `id`/`label`/`make`
pairing (netted instead by `models.test.ts`'s per-model `toBe` identity sweep) and neither touches
**the description wording, which is uncovered BY DESIGN** — nothing in this repo asserts on a
description's prose, per the superscalar's own note, so the browser pass reading it back against the
engine constant is the only check there is.

The first stub reddens the refuses-a-width load, the clamp-scope `toEqual`, and the handed-1 sweep;
the identity test and the conditional-skip test stayed **green**, as predicted. ⚠ **The second is the
finding: the map's documented neutral fallback had NO net anywhere in the repo until today.** Every
shipped model's stage families all carry a validated `PHASE_COLORS` hue, so `RO` is the first family
any model has ever drawn without one — the fallback was documented, reachable in principle, and
exercised by nothing.

### ⚠ THE HUE FINDING — the `RO` fallback COLLIDES with `IF`, and it is a browser-only fact

Decision 2's stated payoff is "five of six families carry a validated hue; only `RO` falls back to
the neutral accent, staying legible by its cell TEXT". The first half is true. **The second half is
not neutral: `--accent` and `--phase-if` hold the SAME literal in every theme** — `#3987e5` in dark
and system, `#2a78d6` in light (measured over the live `documentElement` in all three theme states,
`M:/claud_projects/temp/m15-step5/hue-probe.mjs`). They are two independently declared tokens in
`styles.css` that happen to agree, not an alias, so nothing links them and nothing would catch a
future divergence either.

So on the map, `IF` and `RO` are drawn in an **identical** hue. The relief rule holds — both cells
carry their own text, so nothing is unreadable — but the map's hue premise ("one cycle reads as N
instructions in N colors") is false for two of six families on this model, and `RO` is not a rare
cell here: `array-sum` draws **60** of them, the second-largest family after `IF`. The screenshot is
a wall of one blue.

⚠ **No test in this repo can see this**, and that is the transferable part. The fold and the view
both hand out the STRING `var(--accent)`, which is `!==` the string `var(--phase-if)`; the collision
exists only after CSS resolves both. This joins "no test here can see a click" and "no test here can
see a HEIGHT" — **no test here can see a COLOR either.**

⚠⚠ **AND IT IS NOT THIS MILESTONE'S BUG — it has SHIPPED on the out-of-order model since M9.**
Measured after the finding, because "is the scoreboard the only model that hits the fallback?" is
exactly the question a fix has to answer first. Per model, over `array-sum`, counting cells whose
family has no `PHASE_COLORS` entry:

| model         | families             | no-hue families | no-hue cells         |
| ------------- | -------------------- | --------------- | -------------------- |
| pipeline      | `IF ID EX MEM WB`    | —               | 0 of 234 (0%)        |
| deep-pipeline | `IF ID EX MEM WB`    | —               | 0 of 398 (0%)        |
| superscalar   | `IF ID EX MEM WB`    | —               | 0 of 234 (0%)        |
| out-of-order  | `IF ROB#`            | `ROB#`          | **241 of 295 (82%)** |
| scoreboard    | `IF ID RO EX WB MEM` | `RO`            | 60 of 267 (22%)      |

An OoO `location` is uniformly `"ROB#tag"`, so `stageFamily()` yields exactly two families and **82%
of that map is the fallback**. Confirmed live in the browser: `IF` and `ROB#` both resolve to
`rgb(57, 135, 229)`, and `s5-4-ooo-hue-collision.png` is a solid wall of one blue with two identical
legend chips. **On that map the collision is worse than here** — `IF` vs `ROB#` is the
fetch-versus-in-flight distinction, i.e. the whole point of the surface — and it has shipped through
M9 step 7, the M9+M10 review, and every browser pass since. Nobody looked at the fallback because no
model before this one made you ask.

**RESOLVED 2026-08-10 — the user chose option 3.** The option set was three, not two, and the
third is the one this plan did not have when the finding was written:

1. **A sixth validated phase hue.** Trips the "no new color token" criterion above and needs the
   dataviz palette validator re-run. The expensive one.
2. **Leave it.** Defensible on the relief rule alone (every cell carries its own text), and it is
   what has shipped for two milestones. But it leaves the map's own docblock false where it says a
   hueless family "renders in the neutral accent rather than being guessed at".
3. ✅ **CHOSEN — re-point the fallback at a genuinely neutral EXISTING token**, `T.ink3`
   (`--ink-3`), a warm gray that is `#898781` in _all three_ theme blocks and already the color of
   the control captions. It introduces **no new categorical color**, so it does not touch the pinned
   criterion and needs no palette re-validation — gray is the ABSENCE of a categorical assignment
   rather than another category. It makes the docblock's word "neutral" true (`--accent` is the
   _interactive / brand_ accent, which is why it equals `--phase-if`; that is by design and would
   keep tracking it as the theme evolves), and it says "this family has no hue" deliberately instead
   of by collision.

**As built.** `PipelineMapView`'s new `NO_HUE` constant (one definition, used by both the cells and
the legend — a swatch that disagreed with its cells would be worse than no legend), plus the
`.pmap-cell` CSS default and the two docblocks that claimed "neutral". **This fixes the out-of-order
model as a side effect**, which is the point: that map now draws blue `IF` against gray `ROB#nn` and
its fetch-versus-in-flight distinction is visible for the first time since M9.

⚠ **The regression test had to be rewritten after it failed to fail.** The first draft compared
`--ink-3`'s values against the phase values straight out of `styles.css` — a real check, but it
asserts about a TOKEN, so re-pointing the view back at `T.accent` left it **green** (measured, not
reasoned). The fix: read the fallback **off the rendered markup** (`--cell-hue` on an `RO` cell),
resolve THAT token against the stylesheet, then compare literals. It now reddens on both failure
modes — a re-point, and a future theme edit that makes the fallback collide. **Read the value the
view emits, never the value you expect it to.**

**Verified in the browser, 26/26, because the chosen option's cost is a repaint of a shipped model**
(`M:/claud_projects/temp/m15-step5/hue-verify.mjs`, both themes × both affected models): `IF` and the
hueless family now resolve differently everywhere; the five validated hues are untouched; and the
gray is legible as a cell, measured as contrast rather than eyeballed — **border 3.50:1 (light) and
4.85:1 (dark)** against the panel, clearing the 3:1 non-text floor, with cell TEXT at 14.38:1 and
12.44:1. ⚠ Two more rig bugs on the way, both the same lesson a third time: `color-mix()` resolves to
Chrome's `color(srgb 0.91 ...)` form with 0..1 components, so a naive `\d+` parse yields NaN (and,
worse, treating those floats as 0..255 would have produced a plausible WRONG ratio); and an OoO
cell's text is `ROB#38` while its FAMILY is `ROB#`, so an equality match reports a missing cell
against a map that is drawing fine.

### Smaller things worth carrying

The web trio landed in ONE edit (package dep + tsconfig `paths` + Vite alias), per M11's note that
the three are checked by different gates and splitting them is how one gets forgotten. This is also
the first thing to resolve the scoreboard **by workspace name** — step 0 flagged that its
`vitest.config.ts` alias would sit unexercised for five steps, and it did.

⚠ **Three rig failures on the first run, and all three were the RIG.** The control captions are
written capitalized and uppercased by CSS, so a selector matching the on-screen spelling finds
nothing (the depth-dial trap, one control over); the map legend carries a static mark key as a
sibling span, so an unfiltered read reports a seventh "family"; and the register row is four `<td>`s,
so `textContent` runs them together as `a0x100x0000003755` and a `\b55\b` match fails against an app
that is RIGHT. All three are failure modes the rig memories already name. **Fix the rig and re-run —
do not explain a failure away**; the fixed run is the evidence.

The absences are the product on this model, so §0b of the pass asserts each of the four knob controls
IS present on the superscalar before §3 asserts it is gone on the scoreboard, and the 4-wide
superscalar recording is confirmed at **59 cycles** (a clamped 1-wide would read 72) so the crash
path is entered from a genuinely 4-wide position rather than a nominal one.

## Step 6, as built (2026-08-10)

`content/programs/register-reuse.s` + **eleven files of moved tables** + a cross-model test in
`models.test.ts`. Repo **11303 → 11772 passing** (11304 → 11773 including the one skipped file),
97 test files unchanged. Five gates green. The program is confirmed **in the shipped `dist` bundle**,
source text and all — `programs.ts` globs the corpus with `import.meta.glob(..., eager)`, so INV-7's
free-play job is discharged by construction rather than by a picker edit, and the grep says so.

### The four-run screening gate, and the candidate it killed

The plan says screen with a dump script before deriving any row. That gate was run as **FOUR** runs,
not one, because a stall event reddening is not a VALUE reddening (step 1's lesson): clean histogram,
golden-reference oracle, **WAW-stubbed ≠ reference**, **WAR-stubbed ≠ reference**. The plan spells
the corrupting requirement out for WAW only; **it applies equally to WAR**, and without it the step-6
re-run would have measured the same thing twice — verbatim step 3's own headline failure.

⚠ **The first candidate passed on WAR and FAILED on WAW, and the reason generalizes.** It put both
hazards on one load (`lw t3` / `add a0,t3,t2` / `addi t2` / `addi t1`). The WAR stall fired; the WAW
never did. **A WAR pair occupies BOTH integer units for the entire window in which its load's
register claim is live** — the victim is parked at `RO` in one unit and the younger writer is
WAR-held at `WB` in the other — so a WAW writer aimed at that same load cannot reach Issue until
three cycles after the claim is released. It reported `structural-int` where the whole point was
`waw`. **The two hazards need two SEPARATE slow producers**, which is why the shipped program has two
loads. This is the THIRD sighting of the same structural collapse (the step-0 scan's `a1` WAW
candidate under one FU; step 1-PRE's FU count; now this) — at three it is a rule rather than an
anecdote: **on this machine, hand-build the hazard and check a unit is actually FREE for the younger
instruction.**

The shipped program keeps the load's value LIVE (a consumer sits between the load and the
overwrite), so the WAW pair is a register-pressure story rather than a dead load — and it carries
**both flavours of WAW** for contrast: the benign `la` at 8, whose younger writer reads what it
overwrites, and the corrupting pair at 32, whose younger writer does not.

### The ripple: 12 failing tests in 11 files, and 4 of them are shape claims

The plan priced "the failure list IS the scope", and the branch-prediction log's warning that the
sites nobody predicts are shape claims invisible to a grep. Both held. Four of the twelve were:

| Site                               | The claim that moved                                      |
| ---------------------------------- | --------------------------------------------------------- |
| `deep-pipeline/timing.test.ts:813` | "9 of the 12 corpus programs stall with forwarding ON"    |
| `superscalar/processor.test.ts` ×2 | the width-4 surjectivity set, and `11 programs vs 4`      |
| `web/pairing-readout.test.ts:555`  | the IPC flat-set COMPLEMENT (3 → 4 pay for a fourth slot) |

⚠ **Two historical cohorts had to be maintained rather than recomputed.** Both 5-stage-family
`dynamic-predict` suites pin "the ELEVEN programs that predate `nested-loop.s`" — a cohort defined by
a SENTENCE, not by arithmetic. The right edit excludes the new program from it by meaning (and names
it in the list, because a cohort maintained by silence stops being a cohort), then updates the
full-corpus totals. Reading the eleven-totals as "whatever eleven files there are" would have
silently changed what the finding says.

### Every timing row hand-derived, and the four that are not

**Thirteen rows across four models, each derived from that model's own recurrence before the suite
was run, and every one balanced on the FIRST run** — the 5-stage's `N+4+S+P`, the deep pipeline's
`N+6+S+P` with its two coefficients, the superscalar's greedy partition at widths 1–4, and the
scoreboard's twin identities. The derived/measured split is stated rather than implied, because step
4's own lesson is that a table without a scope sentence implies the whole thing was exercised:

- **DERIVED**: `pipeline`, `deep-pipeline`, `superscalar` (incl. `w2`, `wide[3]`, `wide[4]`),
  `scoreboard`, all three in-order `dynamic-predict` rows, `pairing.test.ts`'s `EXPECTED`, and the
  web IPC complement.
- **MEASURED**: the four out-of-order `dynamic-predict` cells (17 / 13 / 12). That file documents
  `W2_INORDER`/`W2_OOO` as MEASURED in as many words ("No derivation reaches these") and derives
  `W1` from a measured baseline, so measuring is that table's own method. What IS derived there is
  the claim that all four scheme columns are EQUAL (no transfer ⇒ P = 0) — and that equality was
  measured per-scheme rather than written once and copied across.

⚠ **The strongest derivation in the batch is the width-4 group of four**, because three independent
consequences fell out of it and all three held: the issue-size histogram in `superscalar/timing`, the
location-set surjectivity in `superscalar/processor.test.ts`, and the web IPC flat-set complement.
This program's tail is four independent instructions precisely because the WAW pair it exists for
needs no dependence between them — so the hazard the program was written to show is also what makes
it one of five corpus programs that ever fills the fourth slot.

⚠ **A scoreboard finding anyone deriving a stall histogram will get wrong once**: `issueBlocker` asks
about UNITS before DESTINATIONS, so a WAW pair under structural pressure reports `structural-int`
first and `waw` only for the cycles a unit was actually free. This program's `la` shows **2 + 1**
where every other `la` in the corpus shows a bare **3**.

### ⚠ THE FLIP — INV-8 is now a REAL net for both hazards

The plan's step-3 acceptance owed a re-run of both mutations here, with predictions written first.
Done, over the whole repo (never a package-scoped run — step 4's rule):

| Stub    | `processor.test` | **`differential.test` (INV-8)** | `timing.test` | `recorder.test` | repo-wide                |
| ------- | ---------------- | ------------------------------- | ------------- | --------------- | ------------------------ |
| **WAW** | 3 of 46 red      | **1 of 15 RED** (was 14/14)     | 8 of 21 red   | 20/20 green     | 12 red of 11770, 3 files |
| **WAR** | 3 of 46 red      | **1 of 15 RED** (was 14/14)     | 2 of 21 red   | **2 of 20 red** | 8 red of 11770, 4 files  |

Both differential cells INVERTED. That is the milestone's own prediction paying out, and it is the
opposite direction from M7's and M11's logs, where INV-8 is a false net throughout.

⚠ **One prediction was INCOMPLETE, and the failure mode is the transferable part.** The step-6
prediction table was written with THREE columns because step 3's has three — but `recorder.test.ts`
landed at step 4. Every number predicted held; the gap was **scope**. **Copying a mutation table's
shape silently drops any suite added since it was written**, and the dropped column carried a real
result: the WAR stub reddens the recorder suite and the WAW stub does not, because only WAR changes a
walk shape that file pins.

### ⚠ The second acceptance line was VACUOUS as written

"The same program on `Out-of-order` shows **no** WAW or WAR stall, and on `Scoreboard` shows both."
Measured across all seven models: **the out-of-order core emits NO `stall` event of any kind** —
there is no `type: 'stall'` anywhere in its `processor.ts`. So the first half is equally true of a
machine with renaming, one without it, and one that does not run. `single-cycle` and `multi-cycle`
are silent too.

Split into the parts that ARE falsifiable, in `models.test.ts` — **the web layer because it is the
only one allowed to hold it**, since ESLint denies model→model imports and the picker is the one
place all seven exist side by side:

1. all seven models compute the same answers (a0 = 24 is the WAR answer, t1 = 7 the WAW one);
2. exactly one model's trace can NAME either hazard, `waw` 5 and `war` 4;
3. **a vacuity guard publishing each model's TOTAL stall count** (0 / 0 / 8 / 12 / 8 / **0** / 33),
   so a reader can tell which absences are evidence and which are silence. Every non-zero total is a
   number hand-derived in that model's own timing table, not a snapshot.

The guard is written to be falsified **by the fix**: if the out-of-order core ever emits stalls it
goes red and claim 2 becomes a real cross-model claim for the first time. All three were verified
**RED against a stubbed WAR check** before being kept.

### Smaller things worth carrying

- **`W2_OOO` 12 against `W2_INORDER` 13** — this is one of the few corpus programs where the
  ISSUE-ORDER toggle moves a program with **no branch in it at all**. Its two load-use chains are
  what reordering has to work with. A lesson author looking for a renaming/reordering A/B that does
  not depend on prediction should start here.
- **`WAR_IS_ABSENT` was flipped, not deleted.** The emptiness of the other twelve is still asserted
  beside the one exception, because "WAR is rare" and "WAR is broken" produce the same all-empty
  table and only a NAMED exception tells them apart. Its `war` cycles are asserted by STAGE rather
  than by count, so a WAR firing in the wrong place could not keep the total.
- **Screening happened from a temp path**, never from `content/programs/`. Once the file is in the
  corpus `readdirSync` picks it up and every failure is ambiguous between "my program is wrong" and
  "a pinned table moved". Rig at `M:/claud_projects/temp/m15-step6/`.
- The corpus README's editorial bar ("name what the existing corpus makes UNREACHABLE, not what a
  new program would make nicer") is met in the file's own header, with the measurement: zero `'war'`
  stalls across twelve programs, and every existing `'waw'` a `la` expansion that cannot corrupt.

## The falsifiable UNCHANGED criteria (the INV-3 back door)

Reaching for either of these is a **STOP** and a decision to bring back to review, not a change to
make quietly. Both are predictions this plan is willing to be wrong about in public:

- [x] **The trace schema needs no edit — ✅ PAID OUT at step 1.** `stall` is
      `{ reason: string; stage; instr }` — a free-form reason, verified 2026-08-10 at
      `packages/trace/src/schema.ts:57` — so `'waw'` and `'war'` need no schema change, and neither
      did the two reasons step 1 added on top of them (`'control'`, and the `'structural-*'` split).
      `location` is a plain string, so `'RO'` needed none either. **The whole model was built with
      `packages/trace` untouched**, which is the criterion.
- [x] **`pipeline-map.ts` needs no edit — ✅ PAID OUT at step 5**, and it paid out in the strong
      form: the shared fold and the shared view draw this model with **`packages/web/src/pipeline-map.ts`
      and `PipelineMapView.tsx` both untouched**, verified headlessly (six families derived from
      `array-sum`, five from `sum-loop` — the non-vacuity a hard-coded list fails) and in the
      browser (60 `RO` cells, legend in first-seen order). ⚠ **But read the step-5 hue finding
      below before step 7 quotes "only `RO` falls back to the neutral accent" as a good outcome —
      that fallback COLLIDES with `IF`.** Step 1 had bought half of this: the engine provably emits
      only `IF ID RO EX MEM WB` as `location` (a test enumerates
      the set), so no FU name can leak into `stageFamily()`. The other half needed a renderer. It
      derives the stage set from the recording and hues by
      stage FAMILY. `stageFamily()` strips a lane suffix and trailing digits, so this model's
      families are `IF`, `ID`, `RO`, `EX`, `MEM`, `WB` — and `PHASE_COLORS` holds exactly
      `IF ID EX MEM WB` (read at `theme.ts:44-50`), so **five of six already carry a validated
      phase hue**. Only `RO` renders in the neutral accent, by the documented fallback, staying
      legible by its cell text. That is the whole reason the stage names are `ID`/`WB` rather than
      `IS`/`WR`, and why the memory FU reports `MEM`: honest names that also avoid four new
      families.
- [~] **No new color token.** A genuinely new categorical color means a new token pair in both
  theme blocks and a re-run of the dataviz palette validator — out of scope here. **Holding as
  of step 5, and it was TESTED rather than merely respected**: the hue finding above is exactly
  the pressure this criterion exists to resist, and the fix took an EXISTING token (`--ink-3`)
  instead of minting a sixth hue. No token was added, no value changed, and the palette
  validator did not need re-running, because gray is the absence of a categorical assignment
  rather than another category. Stays open (`~`) until step 7, which is the step that actually
  draws something new.

## Acceptance criteria (mirror the spec §11 shape)

- [x] **Load the WAW/WAR program on `Scoreboard`, step to completion, step backward to the start,
      and scrub to any cycle ✅ (step 4 + step 6).** Step 4 proved the navigation (run to halt, walk back
      to the pre-run cursor, scrub to every cycle with `currentState()` identical to that cycle's own
      recorded snapshot) on step 1's **in-file** witnesses; the criterion named "the WAW/WAR program",
      which step 6 promoted as `register-reuse.s` and which the same model-agnostic recorder drives.
- [~] **The same program on `Out-of-order` shows no WAW or WAR stall, and on `Scoreboard` shows
  both.** ⚠ **The first half is VACUOUS as written and cannot be ticked** — measured at step 6,
  the out-of-order core emits **no `stall` event of any kind**, so that sentence is equally true
  of a machine with renaming and one without. What replaced it in `models.test.ts` is the pair of
  claims that ARE falsifiable, plus a guard publishing every model's total stall count so the
  silence is visible as silence. The scoreboard half is met outright: `waw` 5 and `war` 4.
- [x] **For every corpus program, final register + memory state equals the golden reference (INV-8),
      at every config this model honors ✅ (step 2, re-run at step 6).** Thirteen programs now, and
      since step 6 it is a **REAL** net rather than a weak one: stubbing either hazard check reddens
      it on `register-reuse.s`.
- [x] **Two instructions provably write back out of program order, and `follow()` tracks each
      across the other ✅ (step 1 + step 4).** Step 1 asserted the write-back by cycle (margins of 4
      and 2 on `lw` / `addi` / `addi`) with the ids proved stable and contiguous across it. Step 4
      closed the `follow()` half, and in the strong form: both younger instructions' walks are
      **strictly contained** inside the older load's — started later, finished earlier — with the
      containment asserted at both ends.
- [x] **Forwarding on vs. off produces a byte-identical trace ✅ (step 1)** — and so does every
      branch-prediction scheme and the whole out-of-order cluster. This machine has no bypass network
      at all, so the inertness contract is asserted as whole-trace equality, not a comment.
- [~] All suites green: `npm test`, `typecheck`, `lint`, `build`, `format:check`. **Green at every
  step so far (11772 passing / 1 skipped at step 6); stays open until step 8.**
- [ ] Both falsifiable UNCHANGED criteria paid out, or the STOP was brought back to review.

## Decisions to pin (seeded with recommendations — review is a diff, not a brainstorm)

| #   | Decision                                         | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Pinned answer                                                                                                                                                               |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ⛔ New package vs. `renaming: false` knob on OoO | **New package** — the knob draws a machine that never existed (INV-5); see headline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **PINNED 2026-08-10: new package.**                                                                                                                                         |
| 2   | ⛔ Stage set and names                           | `IF ID RO EX/MEM WB`, where ID **is** Issue and WB **is** Write-Result — honest, and only `RO` is a new hue family                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **PINNED 2026-08-10** (follows from the plan; user pinned the build shape).                                                                                                 |
| 2b  | ⛔ Is `RO` shared or per-FU?                     | **Per-FU and non-blocking**; only Issue is shared and in-order. A shared blocking `RO` makes **WAR unreachable** and deletes half the milestone's subject                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **PINNED 2026-08-10** — forced by correctness, not taste.                                                                                                                   |
| 3   | ⛔ Does the machine speculate?                   | **No predictor: `branchPrediction` is IGNORED** and a taken branch simply flushes the front end. The CDC 6600 had no dynamic prediction, and adding one puts speculative recovery on a machine with no ROB — the hardest thing in the milestone, for a lesson that is not this milestone's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **PINNED 2026-08-10: no predictor.**                                                                                                                                        |
| 4   | ⛔ Where latency comes from                      | **Model-intrinsic heterogeneous FU latencies, NOT `slowOpLatency`.** **THREE FUs: TWO integer (1 cycle each, both report `EX`) and one memory (multi-cycle, reports `MEM`).** ⚠ Amended 2026-08-10 after step 0 — the original "two FUs to start" makes WAR **unreachable**, since the only multi-cycle latency is the memory FU, so anything parked at `RO` waits on a load that owns the single memory port while the waiter owns the only integer FU, leaving no FU for a younger writer (see step 1-PRE for the derivation and the witness program). ⚠ `slowOpLatency` is gated by `configurableOutOfOrder`, which also gates the issue-order toggle and the ROB-size control (`App.tsx:387-392`) — so honoring it means either offering a ROB size on a machine with no ROB, or splitting a capability flag across seven models. And it has **no UI control at all** (`useSimulator.ts:356-361`), reset to 1 on every free-play load, so a model depending on it shows nothing until M16 authors a lesson. Intrinsic latency dodges all of it, follows multi-cycle's precedent, and needs no capability flag | **PINNED 2026-08-10: intrinsic latencies** — forced by the shell finding. **FU count AMENDED 2026-08-10 by the user to 2 integer + 1 memory** — forced by WAR reachability. |
| 5   | Which knobs are REFUSED vs. IGNORED              | **Refuse** `cache` and `issueWidth > 1` (throw at `reset()`, clamp in `engineConfigFor` — the `deep-pipeline` precedent; note it clamps `cache` only today). **Ignore** `forwarding`, `branchPrediction`, `outOfOrderIssue`, `robSize`, `slowOpLatency` (the M4/M7 inertness contract, asserted by a byte-identical-trace test). Capability flags: `configurableOutOfOrder: false` is then honest, since none of the cluster is honored                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **PINNED 2026-08-10.**                                                                                                                                                      |
| 6   | Stall reason vocabulary                          | **PINNED 2026-08-10; AMENDED at step 1 to SIX reasons** — `'waw'`, `'war'`, `'operand'`, **`'structural-int'`**, **`'structural-mem'`**, **`'control'`**. The structural split is decision 4's own amendment note cashed in: unsplit, it reads false beside a table that visibly shows a free unit. `'control'` is FORCED by INV-8, not chosen — Issue cannot pass an unresolved transfer on a machine with no ROB, and stubbing the block reddens INV-8 on two corpus programs. `'raw'` still untouchable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 7   | Load/store handling                              | **The memory FU of decision 4 — blocking, single memory port**, reporting `location: 'MEM'` for every cycle it occupies (no MSHRs, no non-blocking LSU — that is M9's machinery and pulling it in doubles the package). Its multi-cycle latency is what makes WAW/WAR reachable on ordinary programs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **PINNED 2026-08-10.**                                                                                                                                                      |
| 8   | Picker position                                  | Between `out-of-order` and any future model, i.e. **last**, with a description that names it as the predecessor of the model above it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **PINNED 2026-08-10: last.**                                                                                                                                                |
| 9   | Does a wire-level datapath ship too?             | **No** — step 7 ships the three tables; the wire diagram is a follow-up if the browser pass says the tables read as a spreadsheet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **PINNED 2026-08-10: no wire diagram** in this milestone.                                                                                                                   |
| 10  | Scope: this model alone? Lesson track?           | **This model alone; lesson track is a separate milestone (M16)** — the M9→M10 / M11→M12 / M13→M14 shape. The user picked the architecture, not the scope, so this row is genuinely open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **PINNED 2026-08-10 by the user: engine + tables view (steps 0-8); lesson track is M16.**                                                                                   |

## Ordering — the ultra review ran first ✅ DISCHARGED

**✅ DISCHARGED 2026-08-10 — the user marked the gate done. Step 0 is unblocked.**

⚠ **That is all this session knows.** Whether the review ran clean, ran with findings the user
resolved, or was waived was not stated here — so do NOT read this line as "the shell seam came back
clean". **Step 5 still owes the shell seam its own scrutiny**, since buying that risk down is the
entire reason the gate existed.

The gate as originally pinned: **step 0 does not start until `/code-review ultra` over
`89bb26e..HEAD` has run and its findings are resolved** (user pinned 2026-08-10). That range was
176 commits across 138 files — the entire post-M14 body of work: keyboard
control, continuous play, the transport-bar jitter fix, and dynamic branch prediction steps 0–8 —
and it had never had a deep pass. The specific risk this ordering bought down: this milestone's
step 5 edits the shared shell seam (`models.ts`, `engineConfigFor`, `useSimulator`), so a finding
there is one a seventh model would already be sitting on top of. The review is **user-triggered
and billed** — it cannot be launched from inside a session, which is why it was a gate rather than
a step.
