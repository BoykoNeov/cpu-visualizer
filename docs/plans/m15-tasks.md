# Milestone 15 — the scoreboard (CDC 6600)

**Status: NOT STARTED, 2026-08-10. Nothing is proven; nothing is built.** Every decision below is
a SEED with a recommendation, not a pin — the decisions table is the review surface, and steps 0+
are blocked on the three decisions marked ⛔ gating. Scope pinned by the user this session: the
**scoreboard model alone**. Its lesson track is a separate later milestone (the M9→M10, M11→M12,
M13→M14 shape).

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

Five stages, chosen so the stage names are honest **and** land on hue families the validated
palette already has (see "no new color token" below):

| Stage | Name              | What happens                                                                  |
| ----- | ----------------- | ----------------------------------------------------------------------------- |
| `IF`  | Fetch             | As every model. One per cycle, in order.                                      |
| `ID`  | **Issue**         | Decode + the two in-order checks: **FU busy** (structural) and **WAW**.       |
| `RO`  | **Read Operands** | Wait until both sources are ready, then read the **architectural regfile**.   |
| `EX`  | Execute           | `1` cycle, or `slowOpLatency` for the designated slow op. Out of order.       |
| `WB`  | **Write Result**  | The **WAR** check: hold until every older instruction has read this register. |

Pinned consequences that make it a scoreboard rather than a relabelled pipeline:

- **Issue is in order and blocking.** An instruction that cannot issue blocks every younger one
  behind it — this is why a scoreboard's window is so much smaller than Tomasulo's, and it is the
  contrast M16's lesson will want.
- **There is no forwarding and no bypass.** Results reach consumers through the register file
  only. `configurableForwarding: false` — this model _ignores_ the knob (the M4 inertness
  contract), and its trace is byte-identical with forwarding on or off. **That invariance is a
  test, not a comment.**
- **`micro` carries the three classic tables** — instruction status, functional-unit status,
  register-result status. The view is those tables; that is the picture every textbook prints.

## Build order (each step testable before the next)

- [ ] **0. Package scaffold + the DAG ripple.** `packages/engine/scoreboard` as
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

- [ ] **1. The model MVP.** `Processor` implementation, the five stages, the three status tables in
      `micro`, INV-4 stable ids across an out-of-order lifetime, and the four stall reasons. Its
      proof is a **hand-built WAW/WAR program inside the test file**, not a corpus program — M11's
      `+6`-constant precedent. Deriving corpus tables before the machine's coefficients are known
      means deriving twice (see step 6). Acceptance: hand-derived unit tests pin a WAW stall at
      Issue and a WAR stall at Write-Result by cycle and by `stall.reason`, and a program whose
      write-backs are provably out of program order.

- [ ] **2. INV-8 differential.** `runConformance('scoreboard', () => new ScoreboardProcessor())`
      over the full corpus × the config matrix this model actually honors. Acceptance: green.
      **State in the docblock that this is a WEAK net here** — see the mutation check at step 3 —
      so a future reader does not mistake it for coverage of the mechanism.

- [ ] **3. THE NET — the timing matrix + a two-part mutation check.** This is the discriminator,
      and the plan leads with it for the reason M11 did: a machine that typechecks, passes INV-8,
      and renders on the map can still be **a 5-stage wearing scoreboard labels**, because
      out-of-order completion reaching the same final architectural state is exactly what INV-8
      checks. So: - a closed-form cycle count over corpus × config, every coefficient **hand-derived from the
      recurrence before it is compared to the engine**; - a **stall-reason histogram** asserted as an event multiset, not as a cycle count —
      `docs/memory/cycles-cannot-see-a-lost-forward.md` is the precedent (a cycles-only identity
      held in every cell while two events silently vanished); - the mutation check run as **two separate mutations, both actually executed** and reverted
      via `git checkout` (commit first — a break harness has destroyed an uncommitted tree here
      before): **stub the WAR check** and **stub the WAW check**. INV-8 must stay GREEN under
      both while the timing matrix and the histogram redden. If INV-8 is the only thing that
      reddens, the net is in the wrong place.
      Acceptance: both mutations produce the predicted pattern; the numbers are recorded in the
      plan, not just in the test.

- [ ] **4. Recorder / time-travel.** Step, scrub, and `follow()` an id through a lifetime whose
      Write-Result is out of program order — the first model where "follow this instruction"
      crosses another instruction that started later and finished earlier. Acceptance: recorder
      tests green; a scrub to any cycle reproduces the recorded state exactly.

- [ ] **5. Web enablement — `models.ts`.** One `ModelChoice` row (`datapath: 'none'` until step 7),
      `MODEL_DESCRIPTION`, picker position, and the capability flags. Two things M11 learned the
      hard way, both of which apply verbatim: - **The churn is FOUR exhaustive `toEqual` lists, not three** — the id list, both `honoring()`
      lists, and the datapath table in `models.test.ts`. Inserting a model mid-array shifts more
      expectations than the id list. - **This model REFUSES knobs, so `engineConfigFor(model, config)` must narrow them.** The
      shell holds forwarding / prediction / cache / width / the OoO cluster at session level and
      hands the whole config to whichever engine drives; `deep-pipeline` was the first engine to
      refuse one and it made a live crash reachable from a click handler. - Ask M11's closing question of this model: **what user-visible prose is gated on a flag it
      turns on?** A tooltip stating another machine's coefficients is an INV-5 violation and only
      a browser can see it.
      Acceptance: the model is drivable end-to-end in `npm run dev`; every refused knob is
      clamped rather than thrown; the pipeline map draws it with no edit to `pipeline-map.ts`.

- [ ] **6. Promote the WAW/WAR program into `content/programs/`.** One corpus, three jobs (INV-7),
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

## The falsifiable UNCHANGED criteria (the INV-3 back door)

Reaching for either of these is a **STOP** and a decision to bring back to review, not a change to
make quietly. Both are predictions this plan is willing to be wrong about in public:

- [ ] **The trace schema needs no edit.** `stall` is `{ reason: string; stage; instr }` — a
      free-form reason, verified 2026-08-10 at `packages/trace/src/schema.ts:57` — so `'waw'` and
      `'war'` need no schema change. `location` is a plain string, so `'RO'` needs none either.
- [ ] **`pipeline-map.ts` needs no edit.** It derives the stage set from the recording and hues by
      stage FAMILY. `stageFamily()` strips a lane suffix and trailing digits, so this model's
      families are `IF`, `ID`, `RO`, `EX`, `WB` — **four of five already carry a validated phase
      hue**, and `RO` renders in the neutral accent by the documented fallback, staying legible by
      its cell text. That is the whole reason the stage names are `ID`/`WB` rather than `IS`/`WR`:
      honest names that also avoid three new families.
- [ ] **No new color token.** A genuinely new categorical color means a new token pair in both
      theme blocks and a re-run of the dataviz palette validator — out of scope here.

## Acceptance criteria (mirror the spec §11 shape)

- [ ] Load the WAW/WAR program on `Scoreboard`, step to completion, step **backward** to the
      start, and scrub to any cycle; the state shown always matches the recorded trace.
- [ ] The same program on `Out-of-order` shows **no** WAW or WAR stall, and on `Scoreboard` shows
      both — the same program, two machines, the renaming lesson visible without a word of prose.
- [ ] For **every** corpus program, final register + memory state equals the golden reference
      (INV-8), at every config this model honors.
- [ ] Two instructions provably write back **out of program order**, and `follow()` tracks each
      across the other.
- [ ] Forwarding on vs. off produces a **byte-identical** trace on this model (the inertness
      contract, asserted).
- [ ] All suites green: `npm test`, `typecheck`, `lint`, `build`, `format:check`.
- [ ] Both falsifiable UNCHANGED criteria paid out, or the STOP was brought back to review.

## Decisions to pin (seeded with recommendations — review is a diff, not a brainstorm)

| #   | Decision                                         | Recommendation (seed)                                                                                                                                                                                                                                                                                             | Pinned answer |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | ⛔ New package vs. `renaming: false` knob on OoO | **New package** — the knob draws a machine that never existed (INV-5); see headline                                                                                                                                                                                                                               | _(open)_      |
| 2   | ⛔ Stage set and names                           | `IF ID RO EX WB`, where ID **is** Issue and WB **is** Write-Result — honest, and only one new hue family                                                                                                                                                                                                          | _(open)_      |
| 3   | ⛔ Does the machine speculate?                   | **No predictor: `branchPrediction` is IGNORED** and a taken branch simply flushes the front end. The CDC 6600 had no dynamic prediction, and adding one puts speculative recovery on a machine with no ROB — the hardest thing in the milestone, for a lesson that is not this milestone's                        | _(open)_      |
| 4   | Functional-unit set                              | **Two FUs: one integer (1 cycle), one "slow" (`slowOpLatency`, default 1)** — the minimum that makes structural + WAW + WAR all reachable. RV32I has no `mul`/`div`, so `slowOpLatency` is the only latency source; it is already in the shared `ProcessorConfig` and `slow-op-loop.s` is already built around it | _(open)_      |
| 5   | Which knobs are REFUSED vs. IGNORED              | **Refuse** `cache` and `issueWidth > 1` (throw at `reset()`, clamp in `engineConfigFor` — the `deep-pipeline` precedent). **Ignore** `forwarding`, `branchPrediction`, `outOfOrderIssue`, `robSize` (the M4/M7 inertness contract, asserted by a byte-identical-trace test)                                       | _(open)_      |
| 6   | Stall reason vocabulary                          | `'waw'`, `'war'`, `'structural'`, `'operand'`. **Not `'raw'`** — that string is pinned repo-wide to mean "forwarding is off" (`pairing-readout.ts`, `lessons.test.ts`), and this machine has no forwarding knob at all                                                                                            | _(open)_      |
| 7   | Load/store handling                              | **A third FU, blocking, single memory port** (no MSHRs, no non-blocking LSU — that is M9's machinery and pulling it in doubles the package)                                                                                                                                                                       | _(open)_      |
| 8   | Picker position                                  | Between `out-of-order` and any future model, i.e. **last**, with a description that names it as the predecessor of the model above it                                                                                                                                                                             | _(open)_      |
| 9   | Does a wire-level datapath ship too?             | **No** — step 7 ships the three tables; the wire diagram is a follow-up if the browser pass says the tables read as a spreadsheet                                                                                                                                                                                 | _(open)_      |
| 10  | Lesson track                                     | **Separate milestone (M16)**, the M9→M10 / M11→M12 / M13→M14 shape                                                                                                                                                                                                                                                | _(open)_      |

## Ordering note (not part of this milestone)

`/code-review ultra` over `89bb26e..HEAD` has never run, and that range is the entire post-M14
body of work — keyboard control, continuous play, the transport-bar jitter fix, and dynamic branch
prediction steps 0–8. Starting a seventh model layers new work on an unreviewed base. It is the
user's call, and it is user-triggered besides, but it belongs before step 0 rather than after
step 8.
