# Milestone 10 — The out-of-order lesson track

**Status: PLANNED, 2026-07-23. Not started. Scope PINNED by the user (2026-07-23): "Both, sequenced" —
first an ENGINE step wiring `slowOpLatency` (M9's decided-but-never-implemented "Option B"), THEN the
fullest lesson track covering BOTH latency sources (the slow-op Tomasulo namesake AND the cache-miss
money shot). This is NO LONGER content-only — the step-0 dump proved `slowOpLatency` ships inert and
that out-of-order issue changes nothing without a latency source (see "The dump"). The OoO engine (M9)
and its whole visual layer — the bespoke out-of-order datapath, the `MicroTablePanel` (ROB/RS/rename
tables), the flagship in-order↔out-of-order toggle + ROB-size control — already exist; the sweep needs
a `configurableOutOfOrder` axis to cover the first OoO lesson at full config coverage. Whether a new
corpus program is needed is decided from the dump, not assumed (unlike M8, whose `branch-slot` witness
was known-missing up front).**

Source of truth for scope: `cpu-visualizer-spec.md` §12 (roadmap — OoO is "the north star and the
genuine cliff") and §13 (the curriculum system). The load-bearing constraints are INV-6 (lessons
anchor to trace EVENTS, not cycle numbers), INV-7 (one ISA, one example-program library), INV-5
(lawful simplification — each step authors all three depth tiers), and INV-8 (any new corpus program
is differentially tested on every model). The M9 plan (`docs/plans/m9-tasks.md`) is the model's ground
truth; its line 11 names this milestone explicitly ("the OoO lesson track is a future milestone (M10),
exactly as M8 was the superscalar lesson track after M7").

## Why this milestone, and why now

M9 shipped the out-of-order **engine and its whole visual layer** — renaming, the ROB, reservation
stations, the CDB, wakeup/select issue, the non-blocking load/store unit, the bespoke OoO datapath,
the `MicroTablePanel`, and the flagship in-order↔OoO toggle — but **no lessons**.
`content/lessons/index.json` has four tracks (_The language_, _The machine_, _The cache_, _The wide
machine_) and nothing on out-of-order. Every prior tier that closed with a matching lesson track did
so as its own milestone (M8 closed the superscalar tier this way). So the OoO machine is _observable_
but not _teachable_ — the same gap M8 filled for superscalar.

What is genuinely new here: **this is the FIRST lesson track ever to run on `model: out-of-order`**,
and the first to open a lesson under the OoO config cluster (`outOfOrderIssue` / `robSize` /
`slowOpLatency`). The lesson machinery is proven (M5) and was already swept across models at M8, but
never with this model, and the sweep does not yet have an axis for the OoO knobs (step 0 adds it, the
M7 precedent — see step 0).

## Headline decision — the event multiset is INVARIANT under the toggle; oracles are primary, not the anchors

This is the M10 analogue of M8's "anchor on the refusal `stall`" headline, and it is **inverted**. M8's
teachable superscalar moments each had a dedicated `stall` event with a `reason` string
(`intra-pair-raw` / `mem-port` / `branch-slot`) — three clean, nameable anchors, and the only beat with
_no_ event of its own ("pairing works") was the exception. **For M10, having no event of its own is the
RULE:**

- **The OoO engine emits no `stall` and no `forward` events.** The ROB-full dispatch stall is a bare
  `break` (`out-of-order/src/processor.ts:1112`, no event); the CDB broadcast _is_ the forward, so
  there is no `forward` event (the model's own header: "The CDB broadcasts a result the instant it
  exists — that IS the forwarding path"). Verified by grep across the whole OoO `src`: zero `stall`,
  zero `forward`.
- **The event MULTISET is invariant under `outOfOrderIssue`.** Same program ⇒ the same `alu-op`s, the
  same `mem-read`s, the same `cache-access`es, the same `instr-retire`s fire in _both_ toggle positions.
  Only the **cycle** each lands on, and the **intra-cycle order**, differ. (This is exactly why M9's own
  differential harness is blind to the toggle — INV-8 checks final architectural state, and the toggle
  changes only _when_, not _what_.)

Two consequences that shape every lesson in the track:

1. **No anchor can discriminate the toggle position by itself.** Every pedagogical claim — "the younger
   instruction executed first," "IPC rose," "commit stayed in program order" — must be carried by a
   **by-name narration oracle** that pins the relative event cycles / counterfactual counts, computed
   from the engine at BOTH toggle positions. The anchoring sweep is even blinder here than in M8; plan
   the oracles as the PRIMARY net, not belt-and-suspenders. (M4 step 4's lesson — "51 cycles" shipped
   green over a transport reading 49 — is the standing proof that anchoring is blind to wrong words.)

2. **Anchor by `where` on a program-unique value, never by `nth`.** Under out-of-order issue the "3rd
   `alu-op`" is a _different instruction_ than under in-order issue, so an `nth` anchor drifts across
   toggle positions and across the sweep. Anchor on a value unique to the target instruction (M8's
   `result:19` / `value:55` rule) so the SAME instruction is tracked in both positions, and let the
   oracle assert that its cycle / order _moved_.

**Do NOT revive or add any event** (`issue`, `stall`-for-ROB-full, `rename`, `commit`, …). The house
record is against new events, and the OoO tier is precisely where "the whole story is invisible in the
event stream" will tempt one. M8 step 8 declined the `issue` event _with proof_ (M4 spent 1 schema
field of 5; M6, M7, M8 spent 0). If a beat genuinely cannot be anchored on an existing event, **STOP
and surface it** — that is a real signal, not a licence to invent an event. See "The un-anchorable
beat" below, which is the one place this bites in advance.

## The un-anchorable beat — renaming

Two of the four candidate beats anchor cleanly on existing events + an oracle: out-of-order execution
(a younger op's `alu-op`/`mem-read` lands before an older producer's) and in-order commit
(`instr-retire` in program order while `alu-op` fired out of order). **Renaming has no event and may
not cleanly anchor** — the arch-register → tag mapping lives only in `MachineState.micro` (the rename
table the `MicroTablePanel` draws), and nothing in the event stream names a WAR/WAW that renaming
dissolved. Per the headline's own rule, this is surfaced NOW rather than discovered mid-authoring:

- **Resolution (seeded, confirm against the dump in the renaming step):** anchor the renaming step on
  the SECOND writer's `alu-op` (a program-unique `where`, e.g. the second write to the same arch
  register) — an event that genuinely exists — and let the narration + the rename table in the
  `MicroTablePanel` carry the "same name, two tags, no false wait" point. The oracle pins that the two
  writers both `alu-op` and that the younger did not wait on the older (their cycles under OoO).
- **If even that will not anchor cleanly** (e.g. no corpus program has a clean WAR/WAW independent
  enough to show the payoff), **drop the beat to a 3-lesson track** and say so — do not stretch an
  anchor or add a `rename` event to save it.

## The dump (the design's factual ground) — FIRST PASS RUN 2026-07-23

Ran the width-1 corpus matrix (`{ outOfOrderIssue: false, true } × { cache: off, small, large }`,
forwarding on, predict-not-taken) plus a `slowOpLatency` probe (throwaway
`out-of-order/src/zz-m10-dump.test.ts`, delete before shipping). **Two findings reshape the whole
milestone:**

1. **`slowOpLatency` is INERT — Option B never landed in the engine.** The config field exists and is
   documented "only the out-of-order model reads it," but grep confirms the OoO processor reads only
   `issueWidth` / `branchPrediction` / `cache` / `outOfOrderIssue` / `numMshrs` / `robSize` — NOT
   `slowOpLatency`. The probe proves it empirically: identical cycle count with/without
   `slowOpLatency: 20` on every corpus program. **The M9 plan pinned "Option B on A," but only Option A
   (cache-miss memory-level parallelism) shipped.** So the namesake "a reservation station waits N
   cycles on a slow op while independent work issues around it" beat has NO engine support at
   content-authoring time.

2. **Out-of-order issue moves the cycle count ONLY with cache ON, and ONLY on array-walking programs.**
   With no cache (the RV32I single-cycle-FU floor), every op completes in one cycle, so nothing is ever
   stalled for younger work to slide around — in-order ≡ OoO on all nine programs. The witnesses:

   | program                                         | cache | in-order | OoO | Δ     |
   | ----------------------------------------------- | ----- | -------- | --- | ----- |
   | `array-sum`                                     | large | 71       | 59  | −12   |
   | `array-sum`                                     | small | 71       | 59  | −12   |
   | `array-sum-twice`                               | small | 258      | 201 | −57   |
   | `array-sum-twice`                               | large | 238      | 202 | −36   |
   | _(every other program, every cache-off config)_ |       |          |     | **0** |

   This is exactly the M9 plan's Option-A prediction ("only visible with the cache ON and an
   array-walking program; renaming and the RS wakeup are drawn but rarely _bind_"). **The whole M10
   track therefore lives at one config family: cache on, width 1** — the only place the flagship toggle
   does anything. Flagship candidate: `array-sum` cache-large (71→59, the cleanest single-loop witness).

**Consequence for scope — RESOLVED by the user 2026-07-23 as "Both, sequenced":** the slow-op namesake
lesson cannot be authored without engine work, so M10 now leads with an engine step (step 1 below)
wiring `slowOpLatency`, then authors a track covering BOTH latency sources. Every flagship program /
config / cycle-count / IPC number below is still a **placeholder** for the deeper per-event dumps
(execution order, program-unique `where` anchors) each chosen lesson needs — and the slow-op numbers do
not exist yet at all (the mechanism is unbuilt).

## The dump — SECOND PASS (per-event execution order) RUN 2026-07-23

Re-dumped both flagship candidates with per-event execution order in both toggle positions (throwaway
`out-of-order/src/zz-m10-dump.test.ts`, outputs `M:\claud_projects\temp\m10\dump.txt` +
`dump-step4.txt`). **Flagship PINNED by the user 2026-07-23: `array-sum`, cache large, `outOfOrderIssue`
true (71→59).** Chosen over the slow-op loop for de-risking (already corpus, cache already plumbed, so
step 2 is pure content) and UI coherence (the shipped `IssueOrderToggle` title already frames the
flagship as "with the cache on, watch independent work slide past a stalled load"). The slow-op-loop
flagship variant is recorded as **deferred additional work** (a later session, not this one — same as
the slow-op corpus program step 3 needs).

**The per-event facts (array-sum cache-large), for the flagship + steps 4/5 anchors:**

- **"Work slides ahead" (flagship, step 2).** Under IN-ORDER the head load (`lw` pc=16) misses at c7
  and its `mem-read` lands c17 (10-cycle penalty); everything waits — `addi t0` (pc=24) at c19, `addi
t1` (pc=28) at c20. Under OoO those independent ops slide UNDER the miss: `addi t0` at **c8**, `addi
t1` at **c9**, `bne` at c10 — while the load is still outstanding. Clean program-unique anchors (never
  dead across the sweep, only the cycle moves — consistent with the headline): `alu-op where
result:268435460` (pc=24, the pointer bump to `&arr[1]` = 0x10000004; c19→c8) or the counter `alu-op
where result:4` (pc=28, first decrement 5→4; c20→c9).
- **In-order commit (step 5) — clean on array-sum.** pc=24 (`addi t0`) EXECUTES at c8 but RETIRES at
  c21 (after pc=16 retires c18 and pc=20 retires c20). Execution reordered, commit strictly in program
  order. Anchor on an `instr-retire where` at the head + the oracle that the corresponding `alu-op`
  fired out-of-retirement-order earlier.

**⚠ FINDING that reshapes step 4 — there is NO miss-under-miss anywhere in the corpus at width 1.** The
step-4 re-dump (user chose "re-dump for a real miss-under-miss" 2026-07-23) hunted `array-sum`
cache-small, `array-sum-twice` cache-large AND cache-small, with a concurrent-miss detector. It fired
**zero** times. The misses are ALWAYS ~30 cycles apart (`array-sum`: c7, c37; `array-sum-twice`: c8,
c38, c68, …), far longer than the **10-cycle** `missPenalty`. The reason is structural: the corpus
programs are all **unit-stride** sums over a **16-byte (4-word) line**, so a line misses once then hits
3×, and a full line's worth of loop work (~30 cycles) separates one line's miss from the next's. A
second miss can never begin while the first is still outstanding. **Miss-under-miss would require a
stride ≥ line size (every load a new line) with minimal intervening work — no such corpus program
exists.** Corollary: the M9 `numMshrs` docblock claim ("`array-sum`'s two consecutive independent loads
are the miss-under-miss pair a default of 2 unlocks", `trace/src/processor.ts` ~127) is **FALSE** —
`array-sum`'s loads are never concurrent misses; `numMshrs ≥ 2` is not actually exercised by the
corpus. (A one-line comment correction is worth making; flagged, not yet done.) **Step 4's stated
"miss-under-miss money shot" is therefore not realizable on the shipped corpus — its resolution is an
open decision (see step 4 below).**

## The engine step — wiring `slowOpLatency` (M9's "Option B")

The mechanism has a ready template in the SAME file: the non-blocking load-miss path
(`processor.ts` `missCyclesRemaining` + the `awaitingMem` state). A slow ALU op should behave the same
way a missing load does — occupy its functional unit for N cycles, then broadcast on the CDB — so that
`walkIssuable` (which only offers `state === 'waiting'` entries) lets independent younger ops issue
around it. **Design PINNED with the advisor (2026-07-23):**

- **The divergence comes from the slow op's DEPENDENT, not the slow op.** `walkIssuable` skips an
  already-issued op (`state !== 'waiting'`) in BOTH issue modes; the in-order/OoO fork is only for a
  not-ready `waiting` op (lines 850–853). So a LONE slow op produces zero toggle difference — once it
  issues and goes `executing`, younger ops pass it in both modes. The toggle diverges only on the shape
  **[SLOW → DEP (needs slow's result) → INDEP (ready)]**: in-order stalls INDEP behind the not-ready
  DEP; OoO slides INDEP past it. (This is exactly array-sum's cache win: `lw`→`add a0`→`addi t0`/`addi
t1`.) The purpose-built slow-op program MUST contain all three roles, and the toggle delta MUST be
  confirmed in a dump before the lesson is authored.
- **Issue ONCE, free the issue port, occupy only the (unbounded) FU for N cycles.** If instead the slow
  op holds its issue slot for N cycles it becomes a `waiting`-style wall that stalls BOTH modes → no
  divergence and wrong timing. So: at issue, set `state='executing'` + `fuCyclesRemaining=N` and consume
  the issue slot THIS cycle only; a per-cycle decrement stage counts it down; at 0 the value is queued
  into `pendingBroadcasts` exactly as a single-cycle op's is today (broadcast-wakes-NEXT-cycle unchanged).
- **Fire the `alu-op` event at COMPLETION, not issue** — the `result` field would otherwise assert a
  value that will not exist for N cycles. Mirror the miss path exactly (a missing load's `mem-read`
  fires at the RELEASE cycle, `processor.ts` ~727, not at issue): defer `executeEntry`'s ALU + the
  `alu-op` emit + the broadcast-queue to the completion cycle. **This is WHY the slow op must be a pure
  value-producer — never a branch/load/store/ecall:** deferring `executeEntry` for a transfer or halt
  would defer `ctx.squash`/`ctx.redirect`, corrupting speculation.
- **WHICH op is slow:** `sll` (shift) — the defensible RV32I stand-in for a multi-cycle FU (`mul`/`div`
  need the M extension ⇒ INV-7 violation). No shipped corpus program uses shifts in the
  `[slow→dep→indep]` shape, so a purpose-built program is in scope (M8 step-0 precedent), co-designed
  with the op against a dump.
- **The parity guard is the safety net for the done M9 model.** `slowOpLatency` absent (or N=1) ⇒ every
  FU single-cycle, reproducing today's trace BYTE-FOR-BYTE (M3/M7-parity timing suite stays green, INV-8
  stays blind, M9 untouched). Present ⇒ deterministic N (INV-1). Add: a lifecycle test for the walk
  (`waiting→executing×N→executed→completed`), slow-op cells in `out-of-order/src/timing.test.ts` from the
  closed form, and mutation-check both ways (a mutation ignoring the latency leaves INV-8 green and fails
  timing). The new state ALSO surfaces in `micro` serialization — a win, the op sits visibly in the FU in
  the `MicroTablePanel` — all gated behind `slowOpLatency`-present so default configs stay green. **The "`array-sum` 60→41 live" number in prior session memory is for ONE config
  and is a trap** — it is the M8 "cycle 10 was the wrong config" hazard, and M7 step 8's rule ("an
  observed cycle is only valid for the config it was observed in") applies with full force. No `nth` /
  `where` / counterfactual number is typed from memory; each comes from a fresh dump under the exact
  declared config, re-dumped per lesson.

**The matrix step 0 runs** (throwaway `zz-m10-dump.test.ts`, deleted after; outputs under
`M:\claud_projects\temp\m10\`), width fixed at 1 (see the pinned decision — the textbook-Tomasulo
position, isolating the OoO axis from width):

```
{ outOfOrderIssue: false, true }  ×  { cache: off, small, large }  ×  { slowOpLatency: off, on }
```

over the whole corpus. From it, pick — per beat — the program+config where the OoO win is **largest AND
cleanest to anchor**:

- The M9 plan's money shot is "independent loads race ahead of the trickling reduction" (a cache-on
  array-walk — `array-sum` / `array-sum-twice`). Confirm which program actually shows it and whether it
  anchors cleanly at width 1.
- Option B's `slowOpLatency` (verified shipped — `ProcessorConfig.slowOpLatency`) makes the "an RS
  waits N cycles on a slow op while independent work issues around it" story vivid on _any_ program,
  independent of the cache. It is the natural home for the flagship toggle A/B and de-risks the whole
  milestone's dependence on the cache path. The dump decides whether the flagship rides the cache miss
  or the slow op.
- **Whether a new corpus program is needed is a dump OUTPUT, not an assumption.** M8 knew up front its
  `branch-slot` witness was missing; M10 does not. If a shipped program shows a clean, large OoO win,
  no new `.s` is added (and step 0's INV-8 ripples — `RESULT_ORACLES`, the two timing tables — never
  fire). If none is clean, a small purpose-built program is in scope (M8 step 0 precedent), with the
  full INV-8 ripple that entails.

## Build order (each step testable before the next)

- [ ] **0. The dump + the sweep's OoO axis (infrastructure).** Two deliverables, plus a conditional
      third.
      **(a)** Run the matrix dump above; pin the flagship program+config and each beat's program+config
      in this file (fill "The dump" section). No lesson content yet.
      **(b) Add the `configurableOutOfOrder` axes to `CONFIG_AXES`** — DONE 2026-07-23. Two new axis
      rows in `packages/web/src/lessons.test.ts`, both gated on `caps.configurableOutOfOrder`:
      `outOfOrderIssue` `{ in-order issue → false, out-of-order issue → true }` and `robSize`
      `{ rob 16 → 16, rob 4 → 4 }`, appended after the width axis. The M7 precedent exactly (M7 step 6
      added the `issueWidth` axis the step that made it REACHABLE, not the step that first used it): no
      shipped lesson targets `out-of-order` today, so these contribute nothing until step 2 — which is
      precisely why they go in now. **The `robSize` / `slowOpLatency` decision, RESOLVED by reachability
      (the shell + `useSimulator.ts`, not memory):** - **`robSize` IS a swept axis.** `App.tsx` renders `RobSizeControl` (positions 4 / 16) and
      `useSimulator.ts` holds `setRobSize` / a `robSize` position — a reachable state, so an unswept
      one would be the defect this project keeps finding. The two positions are the shell's own: 16
      (engine default, `config.robSize ?? 16`, so it aliases "absent") and 4 (the window that fills
      and stalls dispatch), default first. - **`slowOpLatency` is NOT swept — held per-lesson.** The reachability rule cuts the OTHER way:
      grep of `App.tsx` AND `useSimulator.ts` found NO control, NO setter, and it is not even threaded
      into the session config the shell records with. **The plan's "they are reachable shell controls
      per M9" parenthetical was optimistic** — `slowOpLatency` shipped config-only and its engine
      consumer only landed at M10 step 1 (this milestone). A slow-op lesson holds it fixed in its own
      config (like the program itself); the timing it drives is the narration oracle's job, and the
      sweep is toggle-blind to it anyway (the headline). - **⚠ Finding for step 3 (the slow-op lesson):** the lesson-OPENING path in `useSimulator.ts`
      (`opening.cache` / `opening.issueWidth` / `opening.outOfOrderIssue` / `opening.robSize`) does
      NOT thread `slowOpLatency` either. So a step-3 lesson declaring `slowOpLatency: N` will silently
      record with it **absent (N=1)** in the BROWSER — the M8-style "shell records the wrong trace,
      every anchoring test green" trap. Step 3 must add `slowOpLatency` to the opening-config plumbing
      (and decide whether the shell needs a control at all, or the lesson pins it invisibly).

      Result: `positionsFor('out-of-order')` = prediction(2) × cache(3) × width(2) × outOfOrderIssue(2)
      × robSize(2) = **48** machines (NOT 96 — `configurableForwarding` is FALSE on the OoO model, the
      CDB is the forward, so there is no forwarding axis). Added the `out-of-order` case to the
      `positionsFor` guard `describe` (count 48 + axis order + endpoints + non-vacuity that both new
      knobs vary + forwarding/`slowOpLatency` absent), mirroring the superscalar case. Full suites green
      (3233 tests, +1), typecheck / lint clean; no behavior change to any other model's sweep (the
      single-cycle/multi-cycle/pipeline-12/superscalar-24 guards are the canary and stayed green).
      **(c) CONDITIONAL — a new corpus program**, only if step 0(a)'s dump shows no shipped program with
      a clean+large OoO win. If added, it widens the shared corpus (INV-7) ⇒ swept by every model ⇒ the
      three M8-step-0 hand-derived additions fire as known loud failures: `conformance.ts`
      `RESULT_ORACLES` (model-independent, hand-computed), `pipeline/src/timing.test.ts` `TIMING` (w1
      shape, from the closed form), `superscalar/src/timing.test.ts` `TIMING` (w1+w2 shape). Plus the
      OoO model has its OWN `timing.test.ts` (`out-of-order/src/timing.test.ts`) — check whether its
      corpus guard fires too. Acceptance for (c): `npm test` green across all models at every config,
      all timing guards satisfied, INV-8 passes for the new program on every model.

- [x] **1. ENGINE — wire `slowOpLatency` (Option B).** DONE & pushed 2026-07-23 (`72c63f3`, 3232
      tests). `rob.ts`: added the `'executing'` RobState + `fuCyclesRemaining` field. `processor.ts`:
      `this.slowOpLatency = config.slowOpLatency ?? 1`; `isSlowOp` (mnemonic `sll`, gated `>= 2`);
      `stageFuAdvance` (before `stageIssueExecute`, mirroring `stageMemAccess`); the deferral in
      `stageIssueExecute` (slow op → `'executing'` + `fuCyclesRemaining = N-1`, `executeEntry` deferred
      to completion). `MicroTablePanel.tsx`: the new state folds to "executing" (the engine change
      forced this view fix — a TS2366 exhaustiveness break, caught by repo-wide typecheck, exactly the
      risk the pre-edit state-site audit flagged). Facts worth carrying forward, NOT re-derivable from
      the diff: - **The straight-line `[slow→dep→indep]` shape shows the reorder but NOT a cycle saving** —
      in-order COMMIT gates the tail regardless of execution order (the indep op that slid ahead still
      commits after the dep, in program order). Confirmed by dump: N=8 straight-line is 21 cycles in
      BOTH toggle positions even though OoO executes the indep add at c9 vs in-order at c16. **The win
      only compounds in a LOOP**, where each iteration's slow op overlaps the next's — mirroring
      exactly why array-sum's cache win is real. So the flagship slow-op program (step 3) MUST be a
      loop: `[slow(loop-invariant inputs, independent across iters) → dep(loop-carried) → indep(counter)]`.
      Dumped loop: N=1 44/44 (parity), N=4 62→47 (−15), N=8 86→53 (−33), `a0=72` in every position.
      **The advisor's `[slow→dep→indep]` shape is necessary but not sufficient — it also needs the
      independent work to COMPOUND (a loop), or in-order commit erases the benefit.** This is the one
      design fact the advisor's analysis under-specified, found empirically. - **`fuCyclesRemaining = N-1` (extra cycles), not N** — a single-cycle op already broadcasts the
      cycle it issues, so latency N means N-1 EXTRA cycles. This is what makes N=1 ≡ absent exactly;
      an off-by-one here (`= N`) would make N=1 slower than the default and break parity. - **N=2 shows delta 0 on the loop, N≥3 wins** — a small latency is hidden for free by the loop's
      other per-iteration work in both modes; only when the latency exceeds what in-order can absorb
      does OoO's overlap pay. A teachable detail for step 3's prose (don't pick N=2 for the flagship). - **Timing:** the OoO side has no closed form (the lifecycle test, not `timing.test.ts`, is its
      net), so slow-op correctness is pinned in the new `slow-op.test.ts` by concrete cycle counts +
      the +7 fire-at-completion gap, not a `TIMING` table cell. `timing.test.ts` stays purely the
      in-order M3/M7-parity net (untouched, green). Mutation-checked: disabling the deferral leaves
      differential/INV-8 **green** and fails **3/4** slow-op tests (parity correctly still passes). - **Still to do within the engine's orbit (fold into step 3):** re-dump the loop program with
      per-event execution order to pick the flagship `where` anchors; consider whether the slow op
      should also surface `fuCyclesRemaining` as a `RobEntryView` field so the `MicroTablePanel` shows
      the FU countdown (advisor's "a win" — currently only the `'executing'` label shows).

- [x] **2. Lesson — the flagship toggle ("Work slides ahead"). DONE & pushed 2026-07-23** (3338 tests).
      `content/lessons/work-slides-ahead.json` — `model: out-of-order`, `issueWidth: 1`,
      `outOfOrderIssue: true`, `robSize: 16`, `forwarding: false` (neutral = `defaultConfig()`, so it does
      not trip the "only names honored knobs" guard despite OoO's `configurableForwarding: false`),
      `branchPrediction: static-not-taken`, cache LARGE. New track **"The out-of-order machine"** appended
      to `index.json` with this one id. Facts worth carrying forward, NOT re-derivable from the diff: - **The pinned anchor value 268435460 is NOT program-unique — switched to the counter `result:4`
      (advisor-confirmed).** Under OoO `alu-op result:268435460` matches BOTH the pc=24 pointer bump
      (c8) AND the next iteration's pc=16 load-address add (c13), so it resolves only via `nth:1` —
      violating the headline's own "anchor by program-unique `where`, never `nth`". The counter's first
      decrement `addi t1,t1,-1` (5→4) produces `alu-op {op:'add', result:4}` exactly ONCE in every
      config (sums are 5/22/18/118/120, bumps are 0x10000000+, bne is 0/1), so it tracks the SAME
      instruction across the toggle. It moves **c9 (OoO) / c20 (in-order)**, under the head load's miss
      (`mem-read value:5` at c17 in BOTH). The middle beat is `result:118` (4th running sum, unique,
      strictly between the counter and the store in every config), the close is `mem-write value:120`. - **The reorder FLIPS trace-order between toggle positions, so the two reordered instructions
      cannot BOTH be steps** (the runner requires non-decreasing anchor order per position). The three
      steps are all FIXED-program-order events — iteration-1 counter (c9/c20) < iteration-4 sum
      (c30/c42) < store — monotonic in ALL 48 sweep positions incl. cache-off/rob-4/width-2. The head
      load's `mem-read` (c17) sits BETWEEN the counter's two positions (c9 OoO, c20 in-order), so it
      CANNOT be a step ordered against the counter — anchor it only inside the oracle, never as a step. - **The oracle is the primary net (headline: the event multiset is toggle-invariant, sweep is
      blind).** Dedicated `describe` in `lessons.test.ts` records the declared machine at both toggle
      positions (`record(outOfOrderIssue)`, forcing the toggle itself like M8's `record(issueWidth)`),
      pins the reorder (counter c9 vs c20, `< mem-read 17` OoO / `> 17` in-order), the critical-path
      beat (118 late in both, chain length set by the cache not the scheduler), and the counterfactual
      (71/59 cycles, IPC 0.48/0.58 computed from 34 retires, closing prose token-checked). Mutation-
      checked: flipping the JSON's `outOfOrderIssue` to false reddens ONLY the opening guard (the
      counterfactual tests force the toggle themselves, correctly). - **`session.test.ts` opening loop extended** to assert `outOfOrderIssue` + `robSize`, arriving with
      `outOfOrderIssue:false, robSize:4` so the flagship (declares true/16) makes a `lessonOpening`
      plumbing leak failable — the M8-step-1 move (the sweep bypasses `lessonOpening` and cannot see
      the opening config; the failure mode is the engine reading `outOfOrderIssue ?? false` and silently
      recording the IN-ORDER trace with every anchoring test green). The opening plumbing itself was
      already wired at M9 step 5 (no change needed). - **Wiring guards updated** (all found by grep before editing): `LESSONS.length` 15→16; both track-
      name arrays (~line 584 + ~line 691); the cache-canonicalization id list (work-slides-ahead is the
      4th cache-declaring lesson); the by-name track-membership test (new track set). `positionsFor
    ('out-of-order')`=48 was already in place from step 0(b). ORIGINAL PLAN TEXT for reference:
      `model: out-of-order`, `issueWidth: 1`, `outOfOrderIssue: true`, **program `array-sum`, config cache
      LARGE (PINNED by the user 2026-07-23, 71→59).** Anchor on `alu-op where result:268435460` (pc=24 pointer bump to `&arr[1]`, c19→c8) or
      the counter `alu-op where result:4` (pc=28, c20→c9) — both program-unique, both never-dead across
      the sweep (only the cycle moves). The oracle pins BOTH toggle positions' cycle counts (71 / 59)
      and that the younger op executed before the older load's `mem-read` (c17). THE crown-jewel lesson,
      the OoO analogue of M3's forwarding
      toggle and M7's width toggle: out-of-order issue lets a younger independent instruction execute
      while an older one waits (on the slow op / a cache miss), so independent work slides ahead and IPC
      rises. Counterfactual: in-order issue stalls everything behind the waiting op. Anchor on a
      program-unique `where` (the younger op's `alu-op`/`mem-read` value); the narration oracle pins BOTH
      positions' cycle counts / IPC (engine at `outOfOrderIssue` false and true) and the relative order
      of the younger vs the older event. **Because the event multiset is toggle-invariant, extend
      `session.test.ts`'s shipped-lesson opening loop to assert the lesson OPENS at
      `outOfOrderIssue: true`** (the M8-step-1 move: the generic sweep bypasses `lessonOpening` and
      cannot see the opening config — the failure mode is the engine reading `outOfOrderIssue ?? false`
      and silently recording the in-order trace with every anchoring test green). Wire the track NOW with
      just this lesson (LESSONS is globbed — a lesson file cannot exist un-wired; the moment it lands the
      `LESSONS.length` / `LESSON_ORDER` / `lessonSections()` / track-name guards fire), so add the new
      track heading to `index.json` with this one id; later lessons append. Grep every track/count guard
      across the web tests before editing.

- [ ] **3. Lesson — the reservation station / slow op ("The reservation station holds").** The Tomasulo
      namesake, now reachable via step 1's `slowOpLatency`: an RS holds an instruction across N execute
      cycles; when the CDB broadcasts the result, its dependents wake and issue. Anchor on the slow op's
      `alu-op` (its result lands N cycles after issue) and a dependent's `alu-op` waking after it. This is
      the beat "Both, sequenced" bought — the classic textbook picture, vivid on the chosen program at
      width 1. Oracle pins the N-cycle gap and that independent younger work issued during it.

- [ ] **4. Lesson — the cache-miss money shot ("Racing ahead of the miss"). RESOLVED 2026-07-23: build
      a new miss-under-miss corpus program (DEFERRED to a later session).** The SECOND-PASS dump proved
      the original premise unrealizable on the shipped corpus — NO miss-under-miss anywhere at width 1
      (misses ~30 cycles apart, the 10-cycle penalty never overlaps; a unit-stride walk over a 4-word
      line structurally cannot produce concurrent misses; the M9 `numMshrs` docblock is wrong). The user
      chose to build a dedicated witness rather than drop the beat. **This is deferred additional work (a
      later session), NOT authored now** — it carries the full INV-8 corpus-widening ripple
      (`conformance.ts` `RESULT_ORACLES`, `pipeline`/`superscalar`/`out-of-order` `timing.test.ts`).
      **Design sketch + the trap to avoid (from the dump analysis — do NOT skip):** miss-under-miss must
      be a **toggle effect**, because step 4 is a toggle lesson whose oracle pins the in-order↔OoO
      counterfactual. A naïve "several independent loads to different lines" program produces
      miss-under-miss in **BOTH** toggle positions — non-blocking loads free the issue port regardless of
      issue order (the same `'executing'`/`awaitingMem` mechanism the slow op uses), so both modes issue
      the second load and both overlap the misses. That demonstrates MSHRs, not `outOfOrderIssue`, and
      the sweep is blind to it (headline). **The second miss must be GATED behind an in-order stall:** the
      working shape is `array-sum`'s own but with **stride = line size (16 B)** so every iteration's `lw`
      is a NEW line (a miss each iteration), and the loop-carried reduction (`add a0,a0,t2`, stuck on the
      missing `t2`) is the stall that the independent pointer bump (`addi t0,t0,16`) slides past ONLY
      under OoO — carrying the next iteration's address forward so its load misses under the current one.
      In-order issue holds the pointer bump behind the waiting `add`, so the next miss cannot start early.
      Confirm the toggle delta AND a genuine concurrent miss in a fresh dump (reuse the throwaway's
      `missReport` concurrent-miss detector) BEFORE authoring. `config`: cache on, `issueWidth: 1`,
      `outOfOrderIssue: true`, `numMshrs` default 2. Anchor on the second load's `mem-read where`
      (program-unique value); oracle pins the counterfactual and that the second `cache-access`/`mem-read`
      overlaps the first miss.

- [ ] **5. Lesson — in-order commit ("Finish early, commit in order").** The ROB's precise-state job:
      instructions COMPLETE out of order (their `alu-op`/`mem-read` land in a non-program order) but
      RETIRE in program order (`instr-retire` events monotone in program order). Anchor on an
      `instr-retire` `where` (program-unique) at the head; the oracle pins that some `alu-op` fired
      out-of-order-of-retirement earlier — the completion/commit order divergence IS the lesson. Rides
      whichever of step 3/4's programs shows the cleanest out-of-order completion. Width 1.

- [ ] **6. Lesson (CONDITIONAL) — renaming ("A new name for a register").** The un-anchorable beat (see
      "The un-anchorable beat") — confirm against the dump before authoring: anchor on the second
      writer's `alu-op`, narration + the rename table carry the WAR/WAW-dissolved point. **If it will not
      anchor cleanly, DROP it** and record why here (no `rename` event invented). Width 1.

- [ ] **7. Wire the track.** Mostly done incrementally by the lesson steps (the glob forces it). What remains:
      the by-name track-membership assertion in `lessons.test.ts`'s "files each lesson under the track
      its SUBJECT belongs to — asserted by name" test (the one net a mis-file slips past — `lessonSections()`
      totality stays green even under a wrong-track filing, because `LESSON_ORDER` derives from the same
      `index.json`), and pinning the track name + teaching order. Acceptance: `lessonSections` returns
      the new track with all its lessons resolved and none under `UNTRACKED_HEADING`; full suites green.

- [ ] **8. Browser pass — the only net that sees this.** Drive the SHIPPED BUNDLE (`vite preview`,
      `--strictPort`, identified by served `<title>`, CDP on a random high debug port, target by URL
      with a throw and no fallback — the [[browser-is-the-only-net]] recipe; do NOT kill Chrome by port,
      identify by title). Rig under `M:\claud_projects\temp\m10-browser\`. Verify: the picker shows the
      new track with its lessons in teaching order; each loads `model=out-of-order` with the
      **out-of-order** toggle pressed (read off the toggle's `aria-pressed`, scoped to the OoO control —
      NOT the first pressed `.seg-btn`, the M8 trap); narration fires at every anchored cycle at the
      current depth tier; the `MicroTablePanel` (ROB/RS/rename tables) renders coherently at each
      anchored step; and the flagship's IPC/cycle numbers read off the live transport MATCH the oracle
      (the toggle discriminator — flip to in-order and watch the same answer with a higher cycle count).
      Fix any prose-vs-picture INV-5 tension IN SCOPE by rewording (content only), as M8 step 6 did with
      "one branch unit" — a datapath/table _drawing_ decision is M9 view code, out of M10's scope.

## Acceptance criteria (mirror the spec §11 shape)

- [ ] The picker shows a new OoO track; each of its lessons loads `model: out-of-order` at
      `issueWidth: 1` with `outOfOrderIssue: true`, and plays through with narration on the correct
      events (INV-6). Confirmed in the browser (step 6).
- [ ] The flagship lesson's cycle-count / IPC counterfactual (in-order vs out-of-order) matches the
      engine at BOTH toggle positions, pinned by a by-name narration oracle — NOT the anchoring sweep,
      which is toggle-blind by construction (the headline).
- [ ] Every anchor uses a program-unique `where`, not `nth` (so it tracks the same instruction across
      the toggle and the sweep).
- [ ] The sweep covers the OoO config cluster: `positionsFor('out-of-order')` enumerates the honored
      OoO positions and every lesson is swept over all of them, anchoring in order with resolvable
      narration in each (INV-6 across configs).
- [ ] The renaming beat either anchors cleanly on an existing event (+ table/narration) or is dropped
      with the reason recorded — no `rename`/`issue`/`commit` event added.
- [ ] If a new corpus program was added: it passes INV-8 on every model, and every timing guard that
      enumerates the corpus (pipeline, superscalar, out-of-order) covers it with hand-derived cells.
- [ ] All suites green; `npm run lint`, `tsc -b`, `npm run build` green. Browser pass clean (any
      prose-vs-picture finding fixed in-scope by rewording).

## How this milestone can lie to itself

- **INV-8 is a false safety net here, twice over.** The OoO engine retires in order, so conformance
  passes even if the whole scheduler is wrong; and it is blind to the toggle entirely (same final
  state either way). It secures a new program's ARCHITECTURAL result; it says nothing about whether the
  lesson's TIMING/ordering claims are true. The narration oracles are the only real net for those.
- **The anchoring sweep is blind to the toggle AND to pedagogy.** A step that fires at the wrong beat,
  or prose quoting the wrong toggle-position's number, passes the sweep — worse than M8, because here
  the SAME events fire in both positions, so even "the anchor fired" proves nothing about which machine
  ran. Every lesson carries a positive narration oracle by name.
- **A remembered cycle is a config-specific fact** — and the "60→41" in prior memory is exactly such a
  carried number. Re-dump under each lesson's exact config before pinning any `nth`/`where`/counterfactual;
  never carry a number across a config boundary (M7 step 8, M8's "how this milestone can lie").
- **Renaming has no witness in the event stream.** The temptation to add a `rename` or `issue` event to
  "make it teachable" is the milestone's characteristic failure. The rule is the same as M8's readout:
  the last chance to prove a new event necessary was the view layer, and it did not.

## Decisions to pin (seeded with recommended answers)

- **Issue width.** `issueWidth: 1` for the whole track — the M9-plan-§120–122 textbook-Tomasulo
  position, isolating the OoO axis from width (width×OoO is explicitly deferred to a later track, no
  rebuild needed). Verify the OoO win stays vivid at width 1 in the dump.
- **Track heading.** Working title _The out-of-order machine_. (Alternatives: _Out of order_, _The
  Tomasulo machine_, _Finishing early_.) Pin during step 5.
- **Lesson order within the track.** Flagship toggle first (the payoff — "work slides ahead"), then
  renaming (why the reorder is legal), then in-order commit (why it is safe / precise), then the RS
  slow-op namesake (the mechanism), if it survives the dump. Ordering is content, declared in
  `index.json`.
- **Flagship program + config.** PINNED 2026-07-23: `array-sum`, cache LARGE, `outOfOrderIssue: true`
  (71→59). The dump weighed it against the slow-op loop and the user chose the cache-miss witness (de-
  risk + UI coherence — see "The dump — SECOND PASS").
- **Slow-op-as-flagship — DEFERRED ADDITIONAL WORK (user, 2026-07-23).** The slow-op loop makes the
  cleanest textbook picture (86→53) but needs a new corpus program (INV-8 ripple) + the `slowOpLatency`
  lesson-opening plumbing; recorded here as work for a LATER session, not this one. The slow-op corpus
  program is needed by step 3 regardless, so this deferral rides step 3's schedule.
- **New corpus program?** A dump output, not an assumption. NONE needed for the flagship (`array-sum` is
  a clean, existing witness). A slow-op program IS needed for step 3 (deferred, above); a miss-under-
  miss program MAY be needed for step 4 (open — see step 4). Each pays the full INV-8 ripple when it
  lands.
- **Do NOT add an `issue` / `stall` / `rename` / `commit` event.** Re-affirmed. Every beat anchors on an
  existing event + a narration oracle, or is dropped.
- **Sweep axis scope.** `configurableOutOfOrder` gates the `outOfOrderIssue` axis (2 positions). Whether
  `robSize` / `slowOpLatency` are swept axes or held per-lesson is decided in step 0 by reachability
  (what the shell exposes as a control).
