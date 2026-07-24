# Milestone 10 — The out-of-order lesson track

**Status: COMPLETE, 2026-07-24. ALL steps 0–8 done and pushed; step 6 (renaming) DROPPED with proof.
The OoO track is FINAL at four lessons — `[work-slides-ahead, racing-ahead-of-the-miss,
commit-in-order, reservation-station-holds]`. Step 7 (wire) needed NO code change — it was an audit that
named the test pinning each acceptance item, and DECLINED a full-sequence teaching-order test on the
cache track's own "a pin earns its place only if the prose lies when reordered" discriminator (see step
7). Step 8 (browser) drove the SHIPPED BUNDLE over the whole track — all 33 checks PASS, every screenshot
coherent, one app-wide naming observation that is NOT an M10 defect (see step 8). MILESTONE DONE.
Scope PINNED by the user (2026-07-23): "Both, sequenced" —
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

- **RESOLVED 2026-07-23 — DROPPED with proof (see step 6).** The seeded resolution (anchor on the
  second writer, narration + rename table carry "same name, two tags, no false wait") did NOT survive
  the dump. The structural finding: renaming's payoff is only observable when the OLDER same-register
  writer is stalled by a latency source, and the only two sources (cache miss / slow op) each make
  THEMSELVES the salient cause — so renaming is always the hidden enabler behind a louder cause, never
  the visible star. The one textbook-clean case (`sll t3`, two shifts in flight) is the RS lesson's
  program (off-limits). The array-sum `t2` case that looked anchorable is caused by the issue policy +
  the front-end freeze, NOT renaming (identical in both toggle positions) — a toggle lesson there would
  re-tell the flagship. So the plan's own drop criterion is met with proof; the track is 3 lessons and
  NO `rename` event was invented. Full detail in step 6.

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
      4th cache-declaring lesson); the by-name track-membership test (new track set).
      `positionsFor('out-of-order')` = 48 was already in place from step 0(b). ORIGINAL PLAN TEXT:
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

- [x] **3. Lesson — the reservation station / slow op ("The reservation station holds"). DONE & pushed
      2026-07-23** (3633 tests), as THREE independently-green commits (`8dd1546` corpus+ripple,
      `98ec045` plumbing, `30f68a1` lesson+oracle). The Tomasulo namesake, reachable via step 1's
      `slowOpLatency`. Facts worth carrying forward, NOT re-derivable from the diff: - **NEW corpus program `content/programs/slow-op-loop.s`** — the deferred `[slow→dep→indep]`
      loop (identical instructions to `slow-op.test.ts`'s `LOOP`, so its N=8 86→53 transfers). Under
      DEFAULT config the `sll` is single-cycle ⇒ an ordinary register-only loop, a0=6×12=72, INV-8
      identical on every model. Full ripple, every cell **HAND-DERIVED** (advisor-audited as genuinely
      independent, not engine-blessed): conformance `RESULT_ORACLES` (a0=72,t1=0); pipeline `TIMING`
      (N=30, S_off={16:2,20:12,28:12}, 5 taken/1 not); superscalar `TIMING` w2 (G=21,Q=14,L_off=26,
      doomed=5, betting −5 pairs — the `sll→add` intra-pair RAW makes the shift a single-issue group
      each iteration, the ONE shape difference from `sum-loop`); OoO `PINNED` (copied); superscalar
      `pairing.test.ts` "strictly faster" 44→35. **Cross-check that validated the derivation: width-1
      closed form = 44 = the slow-op test's empirical N=1 parity; all four tables first-run green.** - **`slowOpLatency` lesson-opening plumbing** (`98ec045`): `LessonOpening.slowOpLatency` +
      `lessonOpening` reads `lesson.config.slowOpLatency ?? 1`; `useSimulator` holds it in a **ref
      only** (no state, no interface field, no control — honored by the engine but neither swept nor
      user-adjustable per step 0b), set from the opening in `startLesson`, read by `loadInto`, and
      **reset to 1 in `select`/`loadEdited`** so a lesson's latency can't leak into a picked program
      (the one knob with no toggle to undo it). NOTE (advisor): an undefined-config lesson preserves
      the current latency via `...current` — consistent with every other knob, harmless (those models
      ignore it), NOT a bug to "fix". `session.test.ts`'s opening loop arrives with latency 3 and
      asserts every lesson opens at its declared latency — the ONLY headless net; the ref threading
      itself is browser-only (see step 8). - **Lesson `content/lessons/reservation-station-holds.json`** (`30f68a1`): out-of-order, width 1,
      cache null, `outOfOrderIssue` true, `slowOpLatency` 8, `forwarding` false + `static-not-taken`
      (both neutral → dodge the "only names honored knobs" guard). 3-beat arc, anchors program-unique
      AND latency-invariant (the sweep records at latency 1): counter `add result:5` (avoids the `li`
      values 6/0/3/2/10; c8 OoO vs c15 in-order, `sll` completes c13 both) → 2nd partial `add
result:24` (woken the cycle after the 2nd `sll` broadcasts, c20 OoO vs c27 in-order) → final
      `add result:72` (same answer, 53 vs 86, IPC 0.57/0.35). The `sll result:12` is NOT
      program-unique (repeats each iteration) → oracle-only, never a step. - **⚠ THE net unique to this lesson (advisor-endorsed):** `slowOpLatency` is unswept, so
      `positionsFor` records this lesson at latency 1 in ALL 48 positions — the reorder VANISHES
      (44/44 parity), so the generic sweep CANNOT check anchor order at the latency-8 recording the
      browser plays. The oracle adds an explicit **latency-8 monotonicity + distinct-cycle** check in
      both toggle positions, plus the reorder/wakeup/counterfactual pins (incl. `add24 === sll[1]+1`,
      which pins the CDB-wakeup causally) and token-checks the prose (M4-step-4 net). - **Teaching-order TODO:** RS is currently wedged at track position 2 (after the flagship). The
      plan's pinned order is flagship → renaming → in-order commit → **RS namesake LAST**. When steps
      5/6 land, MOVE `reservation-station-holds` to the end of the OoO track in `index.json` (and
      update the membership guard's expectation — it is a sorted set, so no order change there). - **✅ REF THREADING BROWSER-VERIFIED 2026-07-23 (was "STILL UNTESTED").** No jsdom ⇒ "3633
      green" only proved the CONTENT is right and `lessonOpening` returns 8, NOT that the shell RECORDS
      at latency 8 — so drove the **shipped bundle** (`vite preview`) via CDP. All three ordered
      observations PASS (rig `M:/claud_projects/temp/m10-step8/eyeball.mjs`, screenshots there):
      (1) lesson opens → **53** cycles (scrub-max+1; the ref-threading proof — 44 would mean broken);
      (2) flip issue-order → in-order → **86** (latency SURVIVES the flip, not reset by it);
      (3) free-play `slow-op-loop` on OoO → **44** (a latency-1 figure — `select` reset the ref to 1,
      leak-guard fires). **Readout finding:** the OoO model has **no IPC tile** (that gate needs
      `micro.width`, which OoO omits) — the computed cycle count is the **scrub bar's max**
      (`recordedCycles−1`), NOT the `PairingReadout`. The pipeline map visibly shows the `sll` holding
      its wide ~8-cycle ROB band while the counter/branch issue around it (OoO) vs serialized (in-order).

- [x] **4. Lesson — the cache-miss money shot ("Racing ahead of the miss"). DONE & pushed 2026-07-23**
      (4035 tests), as TWO independently-green commits (`28ba482` corpus+ripple, `f060eeb`
      lesson+oracle). The deferred miss-under-miss program was built and the beat landed. Facts worth
      carrying forward, NOT re-derivable from the diff: - **NEW corpus program `content/programs/strided-sum.s` — `array-sum`'s TWIN.** Byte-for-byte
      the same instruction stream; the ONLY source changes are the pointer bump (`addi t0,t0,16` vs
      `,4`) and distinct `.data` values (7, 20, -3, 50, 6 → a0 = 80, framed as five 16-byte records
      with one summed field each). Stride = one cache LINE, so every load hits a fresh block and
      misses, and the `sw` to `total` misses a sixth block — **6 misses at BOTH sizes** (all
      compulsory, nothing ever re-read, so cache size buys nothing). **This made the whole INV-8
      ripple near-mechanical: every cell is array-sum's own entry with ONLY `misses` changed 2→6**
      (conformance a0=80/t1=0/total=80; pipeline TIMING; superscalar TIMING w2 — the partition is
      dependency-shaped and cache-blind, so groups/pairs/blocked/doomed/betting are IDENTICAL; OoO
      PINNED; pairing `{w1:51, w2:42}` = array-sum's, because that table runs cache-OFF where the
      miss stream is silent). All four tables first-run green. - **⚠ THE cell that was NOT "array-sum + count", caught by the advisor before it was written:
      array-sum's store HITS, this one MISSES, and NO existing test pinned whether the M3/M7 engines
      charge `missPenalty` for a no-write-allocate store miss.** That is the difference between
      `misses {6,6}` (M=60) and `{5,5}` (M=50). Verified by running the pipeline AND superscalar
      (w1+w2) engines directly before committing any cell: cache-off is byte-identical to array-sum
      (72 off / 51 on), and every extra miss is +10 cycles (pipeline on/large 111 = 71+40, off/large
      132 = 92+40; superscalar w2 on/large 102 = 62+40). The store miss IS charged by all three. - **The toggle effect is REAL and the biggest in the collection: 111 → 62 (−49)**, vs the
      flagship's 71 → 59 (−12). Concurrency confirmed by counting `awaitingMem` ROB entries per
      cycle: out of order there are overlapping pairs at [13–16, 20–23, 27–30, 34–37] (max 2 = the
      MSHR count); **in order there is NEVER more than one outstanding miss in the whole run.** The
      trap the plan warned about was avoided exactly as designed — the second miss is GATED behind
      the in-order `memStall` front-end freeze, so the naïve "both positions overlap" failure never
      appeared. - **Lesson `content/lessons/racing-ahead-of-the-miss.json`**, wired at OoO track **position 2**
      (right after the flagship, so the two cache lessons escalate together): the track is now
      `[work-slides-ahead, racing-ahead-of-the-miss, commit-in-order, reservation-station-holds]`.
      3 beats, all anchored on program-unique `where` values in strict PROGRAM order across
      iterations — so **unlike the flagship, no reorder can flip them** and the "two reordered
      instructions cannot both be steps" constraint never binds: `mem-read value:7` (c17 in BOTH
      positions) → `mem-read value:20` (c24 OoO / c35 in-order) → `mem-write value:80` (62 vs 111,
      IPC 0.55 vs 0.31). The miss-under-miss itself is a `cache-access` at c14 vs c25, which lives
      in the ORACLE (its only program-unique field is a raw address). - **THE distinctness the advisor flagged, carried by both prose and oracle.** The flagship hides
      independent ARITHMETIC in ONE miss's shadow and its misses never overlap (step 0's
      no-miss-under-miss finding). This lesson aims the same lever at the ADDRESS chain, so what
      slides into the shadow is another MISS — genuine memory-level parallelism, MSHR-bounded at 2.
      Without that framing the two lessons read as the same lesson twice. - **The oracle proves the overlap TWO independent ways** (the M10 headline makes it the primary
      net): the second miss's cycle against the first's release, AND counting entries genuinely
      co-resident in the load/store unit (`micro.rob` `awaitingMem` — empty in order, contains c14
      out of order). A cycle-ordering argument alone could be satisfied by a re-detected single
      miss; the co-residency count cannot. Plus an **unchanged-penalty** check (release − detect is
      equal in both positions, so the claim is "overlapped", not "shortened" — a faster cache would
      not satisfy it), the counterfactual totals, IPCs computed from retire counts, prose
      token-checks, and a bigger-win-than-the-flagship comparison that pins 71/59 too. - **⚠ This lesson's EXTRA sweep blindness, pinned as a test rather than left as a surprise.**
      Unlike the RS lesson (whose `slowOpLatency` is unswept), `cache` IS a swept axis — so
      `positionsFor` records this lesson at cache-OFF, where the program has **no misses at all**,
      both toggle positions run **51** cycles, and nothing the prose says is true. The anchors still
      resolve in order there (they are program-order-separated), so the sweep stays green over a
      machine the prose does not describe. The oracle fixes the cache at the declared LARGE geometry
      and adds an explicit cache-off `51 === 51` pin. - **No shell wiring was needed:** `EXAMPLE_PROGRAMS` globs `content/programs/*.s`, so
      `strided-sum` appears in the free-play picker automatically, and the lesson-opening path
      already threads `cache`/`outOfOrderIssue`/`robSize` (M9 step 5 + M10 step 2). Mutation-checked:
      perturbing a quoted cycle in the prose reddens the token check.
      ORIGINAL PLAN TEXT: The SECOND-PASS dump proved
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

- [x] **5. Lesson — in-order commit ("Finish early, commit in order"). DONE & pushed 2026-07-23**
      (3739 tests). `content/lessons/commit-in-order.json` — the ROB's precise-state job, taught on the
      SAME array-sum machine as the flagship (cache-large, OoO, width 1) seen through the commit stream
      instead of the execute stream. Facts worth carrying forward, NOT re-derivable from the diff: - **⚠ SCHEMA FINDING (advisor) — the plan's own step-5 anchor plan was NOT achievable.** The plan
      said "anchor on an `instr-retire where` (program-unique)". `instr-retire` carries ONLY
      `{ instr }`, and `instr` is the fetch-order id (`i0`/`i4`/`i7`…, `id: \`i${seq++}\``in
   `processor.ts:1303`) — an `nth`-in-disguise (fetch position), exactly the anchor the M10 headline
    forbids because it drifts across the sweep's speculation. So there is NO program-unique field on
    a retire event. The STEPS anchor on program-unique `alu-op`values like every other OoO lesson;
    the retire-order claim lives in the ORACLE, which reads the id off each event and joins
   `alu-op`→ id →`instr-retire`WITHIN one recorded config (where the id IS stable, INV-4). The
      beat is anchorable — just not on a retire event. This is a real signal surfaced, not worked
      around (the headline's own rule).
  - **⚠ PROGRAM DEVIATION (advisor) — "rides step 3/4's program" was stale.** The plan steered step 5
    onto "whichever of step 3/4's program shows the cleanest completion". Step 4 is DEFERRED, leaving
    only slow-op-loop (step 3's) — but that is the RS lesson's program and RS is pinned LAST, so
    using it here would introduce the slow shift before the lesson that explains it. Used`array-sum` instead: understood cold from the flagship, so step 5 isolates the one new concept (retirement).
    Reusing the flagship trace is fine because the oracle claim (retire order) is genuinely new — the
    flagship's oracle never checks it.
  - **THE framing trap the advisor caught (correctness, not style).** "Retire in program order" is
    true in BOTH toggle positions — the ROB always commits in order, AND in-order issue never
    scrambled execution to begin with (the dependent`add`blocks the independent ops from issuing).
    So the lesson is NOT "OoO retires in order, in-order also retires in order" (which makes the
    toggle look INERT — the exact self-undermining shape the flagship's middle beat once had). It is:
    **OoO SCRAMBLES the finishing order and the ROB puts it back; in-order never produced a scramble
    to fix.** The oracle's discriminator is`aluCycle(inOrder,'add',4)===20 > memRead(inOrder,5)===17` (in-order counter finishes AFTER the load — no scramble) vs`9 < 17`OoO.
  - **The anchors** (program-unique, monotonic in all 48 positions, DIFFERENTIATED from the
    flagship's`4`/`118`/`value:120`per the advisor): iter-2 counter`add result:3`(OoO c16 / in-
    order c28) → iter-3 sum`add result:18`(c22/c34) → iter-5 final sum`add result:120`(c48/c60,
    an`alu-op`so distinct from the flagship's`mem-write value:120`). The dramatic iteration-1
    facts (counter executes c9, retires c22, after load i4's `mem-read` c17 / retire c18) live in the
    NARRATION + oracle, not as steps — the load's c17 sits between the counter's two toggle positions
    (c9 OoO / c20 in-order) so it can never be a step ordered against it (the flagship's constraint).
  - **The oracle is stronger than the flagship's** (`lessons.test.ts`new`describe`): (a) the
    retired-id stream is STRICTLY ASCENDING in BOTH positions (the ROB invariant, parsed from the
    `iN` ids — asserted both ways precisely so the lesson can't claim in-order commit is an OoO
    feature); (b) the execute-early/retire-late pair via the id-join (counter c9 exec < load c17
    exec, but counter c22 retire > load c18 retire); (c) the OoO-only scramble discriminator; plus
    prose token-checks (`cycle 9`/`17`/`22`/`18`, `120`, and `59`/`71`in the expert tier — this
    lesson keeps the cycle-count numbers in the EXPERT tier since its subject is ORDER, not speed).
  - **Teaching-order TODO from step 3 — DONE.** Moved`reservation-station-holds`to the END of the
    OoO track in`index.json`; the track is now `[work-slides-ahead, commit-in-order,
reservation-station-holds]`, matching the pinned order flagship → (renaming) → in-order-commit →
    RS-last (renaming inserts at position 2 if it lands). The membership guard is a SORTED set so no
    order change there; `LESSONS.length` 17→18, the cache-canonicalization id list (commit-in-order
    is the 5th cache-declaring lesson), and the by-name OoO membership set all updated. Wiring guards
    found by grep before editing, as always.

- [x] **6. Lesson (CONDITIONAL) — renaming ("A new name for a register"). DROPPED 2026-07-23, with
      proof — the track is 3 lessons.** Ran a throwaway rename dump (`zz-m10-rename-dump.test.ts`,
      deleted; outputs under `M:\claud_projects\temp\m10-renaming\`) scanning the whole corpus on the OoO
      model at width 1 for "two live ROB entries share the same `rd`" (one arch register, two distinct
      in-flight tags — the renaming payoff), and the array-sum `t2` counterfactual in BOTH toggle
      positions. **The structural finding that meets the plan's own drop criterion ("no corpus program
      has a clean WAR/WAW independent enough to show the payoff") with proof — advisor-endorsed:** - **Renaming's payoff is unobservable without a latency source to stall the OLDER same-register
      writer, and the only two latency sources each make THEMSELVES the salient cause.** At
      single-cycle ALU latency two writes to one register just land a cycle apart — nothing reorders,
      the rename-table change is invisible. To get "younger same-reg writer finishes first" the older
      one must be stalled, and the only stalls are the cache miss (→ array-sum `t2`) and the slow op
      (→ slow-op-loop `t3`). The dump confirms empirically: the ONLY two INDEPENDENT same-register
      reorderings in the entire corpus are array-sum `t2` (cache salient) and slow-op-loop `t3`
      (slow-op salient — AND it is the RS lesson's program, pinned LAST, off-limits per the step-5
      teaching-order finding). Every other two-tag case (`a0`/`t0`/`t1`) is a loop-carried TRUE
      dependency where nothing reorders. So renaming is structurally ALWAYS the hidden enabler behind
      a louder cause, never the visible star. - **There is NO honest toggle counterfactual for renaming.** The array-sum `t2` reorder looks
      anchorable — under OoO `mem-read value:17` (iter-2 `lw t2`, a cache HIT) fires c14, BEFORE
      `mem-read value:5` (iter-1 `lw t2`, the MISS) at c17; under in-order value:5 fires first (c17),
      value:17 later (c25), and `t2` NEVER appears in two live tags at all. **But that reorder is
      caused by the ISSUE POLICY + the front-end freeze, NOT by renaming** (which is ON and identical
      in both toggle positions). Under in-order a miss sets `ctx.memStall`, which freezes BOTH
      `stageDispatch` (`processor.ts:1153`) and `stageIssueExecute` (`:836`) — so the second `lw t2`
      is never even DISPATCHED while the first misses, and the second `t2` tag never exists. Renaming
      isn't "unused" in-order; the front-end freeze prevents the second dispatch entirely. A
      toggle-A/B renaming lesson would therefore just RE-TELL the flagship (work slides under a miss)
      with a load standing in for the counter — the genuinely renaming-specific content (the rename
      table, `t2` in two tags) is NOT a toggle story and has no A/B, only the rename table as a static
      witness. - **Decision:** dropping is a stronger, honest, durable deliverable than a lesson where renaming
      is the least-visible of three simultaneous causes on the third-consecutive array-sum machine.
      **No `rename`/`issue`/`commit` event invented** (the house record holds — the milestone's
      characteristic-failure temptation declined with proof, exactly as M8 step 8 declined `issue`).
      The OoO track stays `[work-slides-ahead, commit-in-order, reservation-station-holds]`; no
      `index.json` change (renaming was never wired). Remaining M10: step 4 (deferred miss-under-miss
      program) → step 7 (wire — already satisfied for these 3) → step 8 (browser).

- [x] **7. Wire the track. DONE 2026-07-23 — VERIFIED, with one test DECLINED on the project's own
      discriminator. No code change was needed.** Every deliverable this step named had already been paid
      for by the lesson steps (the glob forces it — a lesson file cannot exist un-wired), so the work here
      was auditing that each is pinned by a NAMED test rather than assumed, and declining the one addition
      that looked owed. Facts worth carrying forward: - **Every step-7 acceptance item is pinned, and here is which test does it** (checked by reading,
      not by "the suite is green"): the by-name track membership — `lessons.test.ts:669` in "files each
      lesson under the track its SUBJECT belongs to", naming all four ids sorted; the track NAME and its
      position after "The wide machine" — `:584` (the full track-name list) and again at `:706`; totality
      with no `UNTRACKED_HEADING` — `:701` ("the shipped picker groups every lesson and invents no
      heading"), which is this step's stated acceptance verbatim; the full teaching ORDER — `:517`
      ("LESSONS is exactly the index, in the index's order — exhaustive in BOTH directions"). - **⚠ A full-sequence test for the OoO track was DECLINED with reason (advisor-endorsed).** The
      obvious-looking deliverable was a "teaches the OoO track in its authored SEQUENCE" test mirroring
      the cache track's `spatial → temporal → conflict`. **The cache test's own comment states the
      discriminator that forbids it: an order pin earns its place only when a prose sentence LIES if you
      reorder** ("the order is forced by the prose, not by taste, which is what makes it assertable").
      Applied pair-by-pair: flagship→racing DOES lie when reordered (racing's step-2 expert opens "a
      strictly bigger lever than the one the previous lesson showed") — and that pin already exists at
      `:3202`, which incidentally locks flagship=0 and racing=1. commit-in-order and
      reservation-station-holds back-reference NEITHER each other nor anything else: RS's "the reorder
      buffer enforces it by committing in program order" is self-contained prose, true whether or not
      commit-in-order ran first. So `flagship < racing < commit < RS` would assert two orderings that
      only taste forces — the exact anti-pattern the cache comment rejects, and a test that would redden
      on a lawful editorial reorder. **The precedent is direct: M8's four-lesson wide-machine track
      shipped with membership + per-lesson describes and NO full-sequence test.** RS-last stays the
      editorial decision `index.json` already records (step 5 moved it there). - **Also re-verified for the acceptance criteria below:** zero `nth` anchors across all four OoO
      lesson files (`grep -c nth` = 0 in each; every trigger is a program-unique `where`), and the full
      gate is green — **4036 tests**, `typecheck` / `lint` / `format:check` / `build` all clean.
      ORIGINAL PLAN TEXT: Mostly done incrementally by the lesson steps (the glob forces it). What remains:
      the by-name track-membership assertion in `lessons.test.ts`'s "files each lesson under the track
      its SUBJECT belongs to — asserted by name" test (the one net a mis-file slips past — `lessonSections()`
      totality stays green even under a wrong-track filing, because `LESSON_ORDER` derives from the same
      `index.json`), and pinning the track name + teaching order. Acceptance: `lessonSections` returns
      the new track with all its lessons resolved and none under `UNTRACKED_HEADING`; full suites green.

- [x] **8. Browser pass — the only net that sees this. DONE 2026-07-24 — ALL 33 CHECKS PASS, every
      screenshot coherent, no M10 defect found.** Drove the SHIPPED BUNDLE (`npm run build` +
      `vite preview --port 5461 --strictPort`, served title confirmed "CPU Visualizer") via CDP on a
      random high port, targeting by URL with a throw and no fallback, killing only the driver's own
      Chrome tree by PID. Rig: `M:/claud_projects/temp/m10-browser/eyeball.mjs` (adapted from the step-3
      rig); screenshots there. Facts worth carrying forward, NOT re-derivable from the log: - **The picker shows "The out-of-order machine" track with its four lessons in teaching order**
      (read off the OoO `<optgroup>` option order — the native popup isn't in the render tree). - **Every lesson opens on `model=out-of-order` with the OUT-OF-ORDER issue-order button pressed**
      (`aria-pressed` scoped to the exact `out-of-order`/`in-order` button text — the M8 "first pressed
      `.seg-btn`" trap dodged), and **RECORDS at its declared config**: the per-lesson total (scrub
      max+1) reads the OoO value **59 / 62 / 59 / 53**, NEVER the in-order **71 / 111 / 71 / 86** — the
      M8 "shell records the wrong trace, all green" trap ruled out live, including the RS lesson's
      `slowOpLatency:8` ref-threading (53, not the latency-1 44). - **The `commit-in-order` anchor/prose gap handled as designed:** its steps anchor iteration-2+
      (cursor **16 / 22 / 48**) while the detailed prose narrates iteration-1 (cycle 9/17). Matched the
      cursor against the KNOWN anchor cycle, NOT a number scraped from the prose — no false defect. - **Narration read from the VISIBLE `<p>` only.** The panel stacks every step's `<p>` at
      `gridArea 1/1` with only the active one `visibility:visible` (App.tsx:800); a body-text substring
      search would match a hidden ghost. Scoped to the visible `<p>` in the all-`<p>` grid and confirmed
      each step shows THIS step's detailed-tier text. - **MicroTablePanel (ROB + reservation stations + rename map) rendered at every step**, and the
      SCREENSHOTS were read, not just the DOM (the 9/10-defects rule): the flagship shows ROB#4 `lw`
      **executing** (stalled load, HEAD) + ROB#5 `add` **waiting** on `⤺ROB#4` + ROB#7 `addi`
      **completed = 0x4** (counter 5→4); `commit-in-order` shows the **completed-but-not-retired pile**
      (ROB#9–#15 all `completed`, head committing) — the lesson's whole point, live; the RS lesson shows
      `sll` **executing** holding its FU 8 cycles while the counter completes around it. - **Toggle discriminator confirmed live:** flip the flagship to in-order → **59→71**, racing →
      **62→111**, same program (the lesson detaches to "Not started" because the flip re-records and
      resets the cursor — expected, not a defect). - **⚠ ONE observation, NOT a defect, NOT fixed (correctly out of scope):** narration quotes ABI
      register names (`lw t2, 0(t0)`, `sll t3, t5, t6`, `addi t1, t1, -1`) while the disassembler panels
      (transport / pipeline map / ROB) render x-names (`lw x7, 0(x5)`, `sll x28, x30, x31`, `addi x6,
    x6, -1`). This is the **established app-wide convention** — confirmed the shipped M1–M8 lessons
      (`forwarding-bubble`, `cache-spatial`, `two-at-once`) narrate the exact same way (`add a0`, `addi
    t0`, `lw t2`). It is the SAME register under two names (t2 IS x7), NOT the auipc/lui wrong-mnemonic
      class the browser memory warns about, so it does not "lie" and rewording only the four M10 lessons
      would make them INCONSISTENT with every other track. Changing it is a global product decision
      (teach the disassembler ABI names, or narrate x-names everywhere), explicitly out of M10's scope.
      ORIGINAL PLAN TEXT: Drive the SHIPPED BUNDLE (`vite preview`,
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

- [x] The picker shows a new OoO track; each of its lessons loads `model: out-of-order` at
      `issueWidth: 1` with `outOfOrderIssue: true`, and plays through with narration on the correct
      events (INV-6). **CONFIRMED in the browser (step 8): the "The out-of-order machine" track shows all
      four lessons in teaching order; each opens on `out-of-order` with the OoO issue-order button
      pressed and records at its declared config; every step fires its detailed narration at its known
      anchor cycle.**
- [x] The flagship lesson's cycle-count / IPC counterfactual (in-order vs out-of-order) matches the
      engine at BOTH toggle positions, pinned by a by-name narration oracle — NOT the anchoring sweep,
      which is toggle-blind by construction (the headline). **DONE (step 2's oracle, `lessons.test.ts`
      "same answer, fewer cycles: 120 stored either way, 59 vs 71"); every other OoO lesson carries its
      own counterfactual oracle too.**
- [x] Every anchor uses a program-unique `where`, not `nth` (so it tracks the same instruction across
      the toggle and the sweep). **VERIFIED step 7: zero `nth` in all four OoO lesson files.**
- [x] The sweep covers the OoO config cluster: `positionsFor('out-of-order')` enumerates the honored
      OoO positions and every lesson is swept over all of them, anchoring in order with resolvable
      narration in each (INV-6 across configs). **DONE (step 0b, pinned by `lessons.test.ts:443` — 48
      machines, axis order, endpoints, non-vacuity, forwarding/`slowOpLatency` absent).**
- [x] The renaming beat either anchors cleanly on an existing event (+ table/narration) or is dropped
      with the reason recorded — no `rename`/`issue`/`commit` event added. **DROPPED 2026-07-23 with a
      proven structural reason (step 6); no event invented.**
- [x] If a new corpus program was added: it passes INV-8 on every model, and every timing guard that
      enumerates the corpus (pipeline, superscalar, out-of-order) covers it with hand-derived cells.
      **TWO were added — `slow-op-loop.s` (step 3) and `strided-sum.s` (step 4)** — each with the full
      ripple (conformance `RESULT_ORACLES`, pipeline/superscalar/out-of-order timing tables, the
      superscalar pairing headline), every cell hand-derived and first-run green.
- [x] All suites green; `npm run lint`, `tsc -b`, `npm run build` green. Browser pass clean (any
      prose-vs-picture finding fixed in-scope by rewording). **DONE: 4036 tests + typecheck/lint/
      build/format:check green (unchanged — step 8 added no repo code); browser pass all 33 checks PASS,
      screenshots coherent. The one naming finding (ABI vs x-names) was correctly NOT reworded — it is
      an app-wide convention, not an M10-introduced tension (step 8).**

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
