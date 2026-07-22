# Milestone 9 — out-of-order execution: Tomasulo, the ROB, and register renaming

**Status: NOT STARTED, 2026-07-21. The north star and, per the spec, "the genuine cliff." Nothing
built yet. This document is the plan; the headline benefit-source fork (below) — the one decision that
reshapes the model — was **pinned 2026-07-21 as Option B on A**, clearing the gate on step 1a. Scope mirrors M7:
this milestone is the MODEL + the VIEW; the OoO lesson track is a future milestone (M10), exactly as
M8 was the superscalar lesson track after M7 built the superscalar.**

Source of truth for scope: `cpu-visualizer-spec.md` §12 (roadmap, tier 5). The load-bearing
constraints are the architectural invariants (§3) and the trace schema (§5). The spec is explicit
that this tier must not be approached "until the in-order experience is completely nailed" — M1–M8
are what "completely" meant, and they are done.

## Why this milestone, and why now

M1–M8 exhausted the **in-order** family, up to and including two instructions abreast. Every model
so far shares a property the code and the views lean on everywhere: **an instruction's architectural
effect happens in program order** — the machine may overlap, pair, stall, flush, and miss, but it
never _completes_ work out of order, and it never _starts_ a younger instruction's execution ahead
of an older one that is merely waiting. Superscalar (M7) broke "one instruction per stage"; it did
not break in-order issue or in-order completion.

Out-of-order breaks both, and it is the last tier on the roadmap. This is where the two invariants
that have quietly earned their keep for eight milestones finally pay their headline dividend:

- **INV-4 (stable instruction id)** — the spec names OoO as the place "follow this instruction" pays
  off most, "where instructions complete out of order and retire in order." Following one id as it
  jumps RS → FU → CDB → ROB → commit, out of order, is the tier's signature interaction.
- **INV-3 (the trace is the only contract)** — the view stops being "light the active datapath" and
  becomes "render the ROB, the reservation stations, and the rename map as tables." That surface was
  designed for, and explicitly deferred to, this milestone (`superscalar-visuals.md` §3, the
  `MicroTablePanel`).

**What is genuinely new machinery**, named precisely:

- **Register renaming.** Architectural regs → tags (ROB entries, classic speculative Tomasulo). This
  is the first model whose `MachineState.registers` is a _committed_ view that lags the machine's
  real, renamed working set. WAR/WAW hazards vanish by construction — a thing no prior model modeled
  because in-order issue never exposed them.
- **The reorder buffer (ROB).** In-order commit over out-of-order completion — the structure that
  gives precise architectural state and speculation recovery. It is also the spine of the view.
- **Reservation stations + wakeup/select + the common data bus (CDB).** Instructions wait on operand
  tags, issue to a functional unit when ready, and broadcast their result on the CDB to wake waiters.
  No prior model has anything shaped like a wakeup/select loop.
- **A non-blocking load/store unit.** This is the single hardest correctness surface, and the one
  place "reuse the M6 cache" is a trap — see the headline. A miss must NOT freeze the machine (the
  opposite of M6/M7), which means a load queue, outstanding-miss handling (MSHRs), and **memory
  disambiguation** (a load must not bypass an older store to the same address).

**What is cheap because it is shared:** the ISA semantics (mirrored verbatim from the golden
reference as always), the assembler, the whole example-program corpus (INV-7), every existing panel
and the transport and the pipeline map (INV-3), the cache _lookup_ structure (M6, now in
`engine-common`), and the branch predictor (M4, now in `engine-common`).

## Headline decision — where does OoO's OBSERVABLE benefit come from?

This is the decision everything hangs off, and it is subtler here than at any prior tier, because of
one ISA fact: **RV32I base has no multi-cycle arithmetic** (no `mul`/`div`, no FP). Every ALU op is
one cycle. Classic Tomasulo teaching gets its drama from a slow multiply that lets independent later
instructions execute around it — and that instruction does not exist in our ISA.

So the tier is pedagogically EMPTY unless there is a long-latency event with independent work behind
it. There is exactly one candidate: **the cache miss** (M6). Both plausible benefit sources collapse
onto it:

- **Register renaming** removes WAR/WAW false dependencies — but with all-1-cycle FUs and in-order
  _completion_ elsewhere, a false dependency never actually stalls anything visible. Renaming is
  correct and worth _drawing_, but it is not the money shot on its own.
- **Out-of-order issue** only buys hiding the occasional 1-cycle load-use bubble — invisible drama.

The dramatic benefit therefore REQUIRES a long-latency op with reachable independent work. The money
shot was hand-traced on the corpus before this plan was seeded (`array-sum.s`, 2026-07-21) and it is
REAL: under an outstanding miss on `lw t2, 0(t0)`, the serial sum reduction (`add a0,a0,t2`) is
stuck, but the pointer bump / counter / branch run ahead, and **the next iteration's `lw` is
independent of the first** (its address is the already-computed pointer), so the loads race ahead of
the trickling reduction. That needs (a) non-blocking loads, (b) an ROB window that reaches the next
`lw` (~5–6 entries), and (c) — for the _dramatic_ miss-under-miss version — ≥2 outstanding misses.

**PINNED (2026-07-21): Option B on A** — build the non-blocking cache-miss path (A) as the honest
floor, and _also_ expose a configurable FU-latency knob (B). Both stories are then on the table: the
physically-real "independent loads race ahead under a miss" and the crisp namesake "an RS waits N
cycles on a slow op while independent work issues around it." The knob is the small increment over A
(A already forces the hard part — non-blocking memory + disambiguation); it buys the namesake lesson
outright and a fallback if the cache path fights us. The two forked options, for the record:

- **Option A — cache-miss memory-level parallelism only.** No latency change to the ISA; the miss is
  the sole latency source. Most conservative (least new machinery), maximally honest to RV32I, and
  reuses M6. Its whole weight rests on the money-shot premise above holding on the corpus — which it
  does, but it means the tier's payoff is only visible with the cache ON and an array-walking
  program. Renaming and the RS wakeup are drawn but rarely _bind_.
- **Option B — a configurable functional-unit latency knob.** A config field (e.g. a
  `slowOpLatency` / per-FU latency), NOT an ISA change — programs run byte-for-byte unchanged
  (INV-7 intact) and the latency is part of the config so determinism holds (INV-1). This makes the
  classic "a reservation station waits N cycles on a slow op while independent work issues around it"
  story vivid on _any_ program, independent of the cache, and is far more faithful to the tier's
  namesake (Tomasulo). Cost: a genuinely new engine concept (variable FU latency + the RS holding an
  instruction across multiple execute cycles) and one more thing to draw.

**Recommendation (a lean, not a pin): B, layered on A.** A is the honest floor and reuses the cache;
B is what makes the tier _teach_ rather than merely _not-corrupt_. B is also the natural home for the
flagship same-program A/B (below) and de-risks the entire milestone's dependence on the cache path.
But this reshaped the model, so it was the user's to pin — **pinned Option B on A, 2026-07-21.**

**The flagship same-program interaction — an in-order ↔ out-of-order ISSUE toggle.** Falls straight
out of the step-1 bisection (1a = in-order-issue base; 1b = the OoO scheduler). The degenerate
position (in-order issue) is the machine the reader just learned; flipping to out-of-order issue on a
program with a miss (or a slow op, under B) shows independent work sliding ahead and IPC rising — the
same-program-flip the spec calls "where understanding clicks," in the M7 width-toggle pattern. Seed
this as the flagship; **ROB size is a secondary lever** (a small ROB fills and stalls dispatch — a
visible structural limit), worth a config field but not the headline.

**Issue width — superscalar OoO, built ONCE, width-parametric (`issueWidth`, default 2).** PINNED
2026-07-21: build the real machine (out-of-order _and_ superscalar), not a scalar OoO core we would
later rebuild. Width and out-of-order are orthogonal axes; holding one and flipping the other stays
the clean same-program A/B. Because width is a config knob (M7's `issueWidth` precedent), **scalar OoO
comes free at `issueWidth: 1`** — the clean textbook-Tomasulo teaching position, available as config,
not a second build. The flagship in-order↔OoO toggle (below) holds width _fixed_; a future lesson
milestone can teach the two axes separately without any rebuild. The added weight is real and named at
step 1b (wide commit, multi-completion CDB arbitration, wide dispatch/flush).

**Package strategy — a NEW `packages/engine/out-of-order`, extract-then-fork (the M7 precedent).**
OoO is not a toggle on the superscalar: ROB + RS + rename + CDB is a different machine, not a wider
stage walk (the superscalar _width_ rides along as a config axis, but the scheduler itself is new). Reuse goes DOWN into `engine-common` (cache and predict already live there), never
sideways (the zero-sibling-imports precedent holds). If any genuinely model-independent logic
surfaces, extract it at step 0; otherwise step 0 is schema + config, not a refactor.

**Scope lever, and it INVERTS M7's.** For M7 the honest cut was "shed the readout, never the
datapath — a model with no picture is not a tier." For OoO the _tables_ (ROB / RS / rename map) ARE
the picture — they are the tier's star surface and are non-negotiable. The **bespoke SVG datapath**
(step 7) is the sheddable half here: a CDB-and-reservation-stations schematic is lovely but
secondary to watching the ROB commit in order while execution completes out of order. If the
milestone must lose weight, it loses step 7, not step 6.

## Build order (each step testable before the next)

- [x] **0. Trace-schema extension + config seam + the corpus decision.** This is the first milestone
      that genuinely ADDS trace events and materially enriches `micro` — the house record (M4 +1
      field of 5, M6 +0, M7 +0) breaks here, correctly, because OoO's transactions do not exist in
      the current taxonomy. Seed the minimum set and let the real views (steps 6–7) force the final
      shape (force an event only if a view cannot be drawn without it — the standing discipline):
      candidate events `rename` (arch reg → tag), `dispatch` (into RS + ROB), `issue` (RS → FU, the
      wakeup/select result), `cdb-broadcast` (result on the bus, wakes waiters), and `commit` (ROB
      head retires — may just be the existing `instr-retire`). `location` gains `"ROB#k"` /
      `"RS#j"` (the spec's own §5 example is `"ROB#3"` — a plain string, so like M7's `"EX.0"` it may
      need no schema-type change). `MachineState.micro` gains the ROB array, the RS array, the rename
      map, and the CDB — a per-model shape exported for the view to type against.
      Config seam: the OoO capability flag(s), the pinned issue-order toggle, ROB size, and — **iff
      Option B is pinned** — the FU-latency knob. Follow `issueWidth`'s precedent: optional config
      fields (so no existing config literal must state a value it does not mean) but REQUIRED
      capability flags (so adding one is a compile error in every model's capabilities constant —
      that is what caught two stub fixtures at M7 step 1). Prove inertness the WHOLE-TRACE way, not
      final-state: a new config field is a leak risk that moves event order while leaving results
      correct — exactly what a final-state check cannot see.
      Add `'engine-out-of-order'` to all THREE eslint deny lists (`engine-common`,
      `engine-conformance`, `reference`) — flat config is last-match-wins with no array merge, so a
      new model inherits no guard (the M7 step-0 footgun) — and PROVOKE at least one to prove it
      fires, then revert.
      **The corpus decision (do this against a fresh dump, as M8 did its branch-slot program):**
      `array-sum.s` carries the money shot, but confirm the window actually reaches the next `lw`,
      and decide whether a NEW tiny program is warranted for (i) a bigger independent-work window
      that makes ROB size visibly pay off, and (ii) **a store→load alias** to exercise memory
      disambiguation — the corpus today has no store followed by a dependent load to the same
      address (`array-sum`'s `sw total` aliases nothing the loads read), and disambiguation is the
      one OoO bug INV-8 can actually catch (see "how this can lie to itself"). INV-7 stays intact:
      any new program runs on every model unchanged.
      Acceptance: schema + config additions compile; whole-trace inertness holds for all five
      existing models under the new config fields; the eslint guard was provoked and reverted; the
      corpus decision recorded with the dump that settled it.

      **Landed 2026-07-21.** It came out to **config seam only — zero trace events, and zero
      `schema.ts` edits.** YAGNI's trigger ("a view cannot be drawn without it") *cannot fire* with
      no view and no engine yet: the step-6 tables fold over `micro` **state**, not events, so
      `rename` / `dispatch` / `issue` / `cdb-broadcast` stay speculative and `commit` may just reuse
      `instr-retire` — none is forced now. `location` already carries `"ROB#3"` (free-form) and
      `micro` is already `unknown`, so `schema.ts` needed nothing. "schema + config additions
      compile" is satisfied by the **config** additions in `trace/src/processor.ts` (that file IS the
      trace layer): `ProcessorConfig` gained optional `outOfOrderIssue` / `robSize` / `slowOpLatency`
      (the Option-B FU-latency knob, following `issueWidth`'s optional precedent), and
      `ProcessorCapabilities` gained the REQUIRED `configurableOutOfOrder`. That required flag
      compile-errored the 4 model constants **and two stub fixtures** (`trace/recorder.test.ts`,
      `conformance/conformance.test.ts`) — the M7-step-1 mechanism firing exactly as intended. All 4
      models + both stubs set it `false`. `numMshrs` was deliberately NOT added: the step-0 config
      sentence omits it, and miss-under-miss (its only consumer) is built at 1b, where the default-2
      is confirmed against a real dump. **Inertness** is proven per-model in each of the four
      `processor.test.ts` files (mirroring the `issueWidth (M7 step 1)` block): full `CycleTrace[]`
      byte-identical between `defaultConfig` and `defaultConfig` + aggressive non-defaults
      (`outOfOrderIssue: true, robSize: 4, slowOpLatency: 20`) — the leak test a final-state check
      cannot do. (The acceptance says "all five existing models"; inertness covers the **4
      `Processor` models** — single/multi/pipeline/superscalar. The golden reference is config-blind
      — its `run()` takes `RunOptions`, not `ProcessorConfig` — so it has no config to be inert
      under; 4 is the complete testable set, not a gap.) **eslint:** `engine-out-of-order` added to the three superset deny lists
      (engine-common / conformance / reference — the M7 footgun); provoked on the reference (a bare
      `import '@cpu-viz/engine-out-of-order'` → the INV-8 boundary error, lint-only since the package
      does not exist) and reverted. The per-model reciprocal entries and the new OoO per-model block
      land with the package at step 1a ("wire the new node into the DAG, all four places").
      **Corpus decision** recorded in `M:\claud_projects\temp\m9\step0-corpus-analysis.md` (a static
      disassembly, since there is no OoO engine to dump): `array-sum.s` carries the money shot (ROB
      ≥6 reaches the miss-independent next `lw`); MSHR default 2 confirmed (the two consecutive
      independent loads are the miss-under-miss pair that width-2 unlocks); the corpus has **no**
      `sw`→dependent-`lw` alias, so a new tiny `store-forward.s` IS warranted for disambiguation — but
      authored at **1b** (where the LSU exists to exercise it), not now; no bigger-window ROB-size
      program needed (`array-sum.s` already fills a small ROB). See the two settled rows below.

- [x] **1a. `engine/out-of-order` at IN-ORDER ISSUE — the faithful base.** DONE 2026-07-22. The
      full front-end, register renaming, the ROB, and in-order commit, but **issue is in program
      order** (dispatch to RS/ROB in order, and issue to FUs strictly oldest-first with no
      reordering). This is the milestone's bisection anchor and gets its own commit. **Its net is
      timing, not INV-8:** an in-order-issue OoO core must reproduce the timing baseline over the
      corpus × config — and because the model is **width-parametric** (`issueWidth`, default 2),
      that baseline is **M7's superscalar timing at width 2 and M3's pipeline timing at width 1**
      (the "× config" covers both) — which de-risks "did I faithfully build the front-end, rename,
      ROB, and commit" BEFORE out-of-order scheduling can muddy it, exactly as M7 step 2a reproduced
      M3's closed form before pairing. INV-4 ids run fetch → commit; the ROB is populated and drains
      in order. eslint deny-list additions landed with the package. **Acceptance MET:** the in-order
      timing baseline holds over the corpus under every branch-prediction × cache × width
      combination (`timing.test.ts`, 145 tests); INV-8 differential green (`differential.test.ts`,
      146 tests, weak but a floor); unit + recorder suites green (11 + 10 tests). Full repo
      `npm test`/`typecheck`/`lint`/`build` all green.

      **Bugs found and fixed en route** (all via test-driven debugging against the M3/M7 timing
      baseline, not reasoned about in advance): (1) a same-cycle zero-latency forward through the
      rename map; (2) rename-map corruption when a younger same-cycle dispatch clobbers an older
      instruction's already-decided source (fixed by capturing operands ONCE at dispatch, never
      re-derived at issue); (3) `ecall` confirmed as a sticky halt at dispatch instead of issue,
      causing a wrong-path shadow to hang the machine; (4) a stale `prevMapping` snapshot on flush
      when the referenced producer had legitimately committed in the meantime; (5) a missing
      "MEM pass-through" cycle for non-memory instructions (added the `'executed'` ROB state); (6)
      branch-prediction bets fired at DISPATCH time, one cycle too early whenever the branch itself
      had to wait on a broadcast (`array-sum.s`'s `bne t1,x0,loop`) — fixed by moving the bet to a
      new `stageBet` pass that mirrors `stageIssueExecute`'s own resource-contest walk one cycle
      ahead, so it also correctly handles a transfer co-issuing with an older ready instruction at
      width > 1 (`branch-flavors.s`); (7) `ctx.memStall` was set unconditionally on a cache miss's
      RELEASE cycle too, freezing the front end one cycle longer than M3's own `holdInMem` (which is
      only ever called while still holding); (8) two bugs in `timing.test.ts` itself, not the
      engine — `width2Total` was missing M7's own `+ 4`, and `call-return.s`'s pinned
      `bettingGroupsOn` was transcribed from M7's `pairs` delta instead of its `groups` delta
      (verified against a live run of the actual superscalar engine, not just arithmetic).

      **A genuine, disclosed deviation from the approved plan:** dispatch is NOT bounded only by
      ROB capacity and width, as the plan's architecture section states. A predictable transfer,
      once dispatched, blocks dispatch of anything younger until it is bet on (`stageDispatch`'s
      `hasUnresolvedBet` check) — otherwise decoupled dispatch would keep pulling fall-through
      instructions into the ROB while the branch's own operand is still pending, and unlike a normal
      wrong-path squash, those would never be caught if the eventual bet happens to match the actual
      outcome. This is a genuine THIRD dispatch bound, coupled to branch prediction specifically —
      the kind of thing the plan's architecture was explicitly designed to let 1b avoid reworking.
      **Flagged as a 1b touch-point, not re-litigated now:** it is correct and covered by the timing
      suite, but 1b's own dispatch/issue design should account for it rather than being surprised by
      it. `M:\claud_projects\temp\m9\step1a-timing-derivation.md` is now STALE relative to what was
      actually built — it never anticipated late-bet gating, the release-cycle `memStall` fix, or
      width > 1 co-issue betting; treat it as a historical pre-check, not a spec of the final design.

- [x] **1b. The out-of-order scheduler — the model's soul.** DONE 2026-07-22. Reservation stations
      with operand-tag tracking; wakeup/select (a ready instruction issues to a free FU, ties broken
      **oldest-first** for determinism — INV-1, no seed needed); the CDB with deterministic
      arbitration (oldest result wins a contested broadcast); speculation past branches with
      **ROB-based recovery** (mispredict flushes the ROB tail and the rename map back to the branch,
      precise state); and the **non-blocking load/store unit** — outstanding-miss handling (MSHRs,
      `numMshrs`, default 2), and **memory disambiguation** (a load checks older, still-in-flight
      stores and does not bypass an aliasing one). Option B (the slow-op knob) is **NOT built at this
      step** — `slowOpLatency` stays an unread config field, deferred past 1b as the advisor
      recommended (build A — the honest cache-miss floor — first; B's op-to-slow needs a real
      program to pick against, which doesn't exist without an OoO engine to dump). This is where the
      core beats 1a: under a miss, independent instructions issue and complete around the waiting
      one, while commit stays in order.

      **The load-bearing structural call, made before any code (per the advisor, and matching the
      instinct going in): gate the ENTIRE new machine on `ProcessorConfig.outOfOrderIssue`, so
      `false` reproduces 1a byte-for-byte** — `timing.test.ts` never sets the flag, so it is the
      regression net for free, and it is also *why the money shot works*: the in-order branch still
      blocks on a miss, so flipping the flag is what makes independent work visibly race ahead.
      Every new mechanism below lives behind that one boolean; the in-order code path is completely
      unchanged from 1a (only `stageBet`/`stageIssueExecute` were refactored to share one walk — see
      below — a behavior-preserving dedup, not a policy change).

      **Built, in the sequence the advisor laid out, each watched in a dump before the next:**
      (a) wired the flag as a pure gate, confirmed `timing.test.ts` (290 cases) still green with zero
      new logic. (b) out-of-order issue: `stageIssueExecute`'s old duplicate-of-`stageBet` walk was
      replaced by one shared generator, `walkIssuable` — in-order mode STOPS at the first
      not-ready/resource-blocked entry (1a's policy, unchanged), out-of-order mode SKIPS it and keeps
      scanning; `stageBet` now calls the same generator instead of hand-mirroring it, which is what
      1a's own bug #6 said to fix once issue could reorder. (c) the non-blocking LSU: each
      `RobEntry` gained `mshrGranted`; a newly DETECTED miss grants an MSHR slot immediately if one
      is free (costing the SAME one detect cycle 1a's single-miss case costs) or queues
      (`missCyclesRemaining` frozen) until one frees; a miss never sets `ctx.memStall`, so nothing
      unrelated freezes. Got the money shot first, before touching disambiguation, per the advisor:
      `array-sum.s`, cache on, static-taken, ran strictly fewer cycles out-of-order than in-order
      with identical final registers and memory — the exact count moved slightly across the
      remaining sub-steps (see the final pinned number below) but the inequality held from this
      checkpoint on. (d) disambiguation + store-defer-to-commit, together (they need
      each other: deferring writes to commit is what makes disambiguation's "wait for the aliasing
      store" answer correct, since memory only gains the true value once that store retires). A load
      in `'awaitingMem'` may not access memory while any OLDER store still in the ROB has an unknown
      address (must wait) or a matching one (must wait for THAT store to commit — no forwarding path,
      the advisor's simpler recommendation over store→load forwarding). Stores now write memory (and
      emit `mem-write`) at `stageCommit`, never at MEM access — required once out-of-order issue can
      let a store's address+data be computed speculatively past a still-unresolved older branch;
      writing early would make a later-discovered misprediction unable to take it back. Authored
      `content/programs/store-forward.s` (a store immediately followed by a dependent load of the
      SAME address) — the corpus's first `sw`→aliasing-`lw`, and the one case where the deferred
      write's window is actually visible: a naive engine would read the stale pre-store value.
      (e) CDB arbitration: the CDB has exactly `width` ports (mirrors issue width — the simplest
      defensible geometry); out-of-order mode sorts this cycle's completions plus any carried-over
      losers by `RobEntry.seq` (never by `Tag` — the PRF-forward-compat seam explicitly forbids
      arithmetic/ordering on a tag), takes the oldest `width` as winners, and defers the rest to
      compete again next cycle. In-order mode applies every completion unconditionally, unlimited,
      exactly 1a's behaviour — a real port limit there would desync it from M3/M7, since more than
      `width` completions CAN occur in one 1a cycle (two ALU pass-throughs plus an unrelated load's
      miss-release) with no port limit in the latch models either. Losing arbitration delays only
      when WAITERS see the value; the producer's own commit is untouched, since commit reads
      `RobEntry.value` directly, never via broadcast.

      **A genuine correctness bug found via the flush-recovery test, not reasoned about in
      advance — the sharpest finding of the step.** 1a's `haltFetch` is a STICKY flag: once an
      `ecall`/`ebreak`/invalid-instruction sets it, nothing ever un-sets it, because 1a's strict
      in-order issue makes that safe — a halt can only be CONFIRMED once every older entry has
      already issued, so a halting instruction is never itself wrong-path. Out-of-order issue breaks
      that guarantee: `ecall` reads no registers (`sourceRegs` returns nulls), so it is ALWAYS ready
      and can issue the moment it dispatches — including on the fall-through fetched behind an
      older, still-unresolved branch. If that branch later mispredicts, `flushAfter` correctly
      removes the wrong-path `ecall` from the ROB, but the sticky `haltFetch` it had already set has
      no other trigger to clear — fetch stayed frozen forever, even after the redirect to the correct
      path (a real infinite loop, caught by the flush-recovery test timing out at `maxCycles`, not by
      an assertion). Fixed by re-deriving `haltFetch` from the ROB's own post-flush contents
      (`!this.rob.all().some(e => e.halt)`) after every flush: a genuine right-path halt is never
      itself removed by the flush that discovers it (it IS the squash source, so `flushAfter`'s
      `seq > squashSeq` test spares it), so this can only ever clear a STALE, wrong-path halt — a
      no-op in blocking (1a) mode, where the scenario is structurally impossible.

      **Acceptance MET.** Money shot: `array-sum.s` strictly fewer cycles out-of-order than in-order
      (61 → 41, final pinned numbers, verified against the actual test run — not the phase-c
      checkpoint value above, which shifted slightly once disambiguation/store-defer and CDB
      arbitration landed), byte-identical final registers and memory (`scheduler.test.ts`). One test per new
      mechanism, each derived from a watched dump: wakeup/select (an independent instruction issues
      strictly before a load-stuck consumer, out-of-order only — co-issues with it, never ahead of
      it, in-order); the non-blocking LSU (2 MSHRs strictly faster than 1 on two independent misses,
      same final state — a direct, config-driven proof rather than a hand-timed one); memory
      disambiguation (`store-forward.s`, a0 = 99 never the stale 0); CDB arbitration (two loads
      completing the same cycle — forced via `missPenalty: 1` — the older's consumer wakes one cycle
      after completion, the younger's one cycle after THAT); ROB flush-recovery under out-of-order
      completion (a wrong-path instruction that finished before its own branch resolved is still
      squashed, and never appears in any `reg-write` event — the strong form of "never happened");
      renaming under out-of-order completion (a fast younger WAW write beats a slow older one in
      final state, proven by first showing the younger really does execute first). **Plus one check
      beyond the literal list, flagged by the advisor as the biggest remaining blind spot**: every
      test above targets ONE hand-built or corpus scenario, so a scheduler bug corrupting results on
      some OTHER program would pass unnoticed. `outOfOrderIssue: true` vs `false` computes
      byte-identical final registers and memory over the WHOLE corpus at one fixed config
      (static-taken, `CACHE_LARGE`, width 2) — a regression net, not step 2's exhaustive matrix, but
      since `false` is already proven equal to the golden reference, this gives `true == reference`
      transitively across every program without waiting for step 2. Green on all 9 (including the
      new `store-forward.s`). Full repo `npm test` (2991 tests: +17 in `scheduler.test.ts`, +18 from
      the new corpus program across every other model's suites), `typecheck`, `lint`, `build` all
      green.

      **Scope note:** the acceptance list does not name Option B, and it was not built — the
      `slowOpLatency` config field stays inert (unread), exactly as it has been since step 0. This is
      a disclosed deferral, not a gap: the advisor's sequencing put A (the cache-miss floor) first
      because it is the harder, load-bearing half, and B's own pin says its op choice should be
      "corpus-driven... picked once there's something to pick against" — i.e. once step 3's
      per-instruction lifecycle table or a future lesson program motivates a specific choice. Step 2
      (INV-8 differential) and step 3 (the scheduling net) are next; `differential.test.ts` still
      only exercises `outOfOrderIssue: false` (1a) — the `true` side's differential net, across
      issue-order × prediction × cache × ROB size, is step 2's job, not retrofitted here.

- [ ] **2. INV-8 differential net.** `runConformance(() => new OutOfOrderProcessor())` across the
      corpus at every config combination (issue-order × prediction × cache × ROB size × — under B —
      FU latency). **Read "how this milestone can lie to itself" before trusting this step.** Its
      value is split, unlike M7 where it was pure smoke: it is BLIND to scheduling/timing (in-order
      commit ⇒ conformance passes for free, even weaker than M7), but it has real TEETH for
      **memory disambiguation** — a load that bypasses an aliasing older store corrupts architectural
      state, and the differential catches exactly that. Say both in the suite header. Acceptance:
      green; and one deliberate disambiguation mutation is confirmed to make it FAIL (the teeth are
      real only if provoked).

- [ ] **3. The scheduling net — the real correctness net.** There is NO clean closed form here
      (unlike M3's `N+4+S` or M7's `G+L+P+M+4`) — the schedule depends on RS availability, CDB
      arbitration, FU latency, and ROB occupancy. The buildable net is a hand-derived **per-instruction
      lifecycle table**: for each instruction, the cycle it _dispatches_ → _issues to an FU_ →
      _drives the CDB_ → _commits_, every cell derived from the pinned rules (oldest-ready-first
      issue, CDB tie-break, FU latency, non-blocking-load handling, in-order commit). This is M3's
      pc→cycle histogram and M7's assert-each-term-separately generalized to a per-instruction
      lifecycle. Write the derivation on a worksheet (`M:\claud_projects\temp\`) BEFORE the test
      file; a cell that cannot be derived is a bug or an unpinned rule. Assert each stage-cell so a
      failing cell names the instruction AND the stage that moved. Mutation-check BOTH ways
      (over-serializing the scheduler must fail timing while leaving conformance green; the whole
      point of the tier). Acceptance: a full per-instruction lifecycle table for the corpus × the
      key configs, every cell derived and asserted, none "whatever the engine printed."

- [ ] **4. Recorder / time-travel + `follow()` through the ROB — the INV-4 payoff.** Prove the
      recorder is UNTOUCHED (INV-3 paying off a fourth time — `follow()` keys on `id`, and
      `location` was always free-form, so `"ROB#3"` resolves for free, exactly as `"EX.0"` did at M7
      step 5). The signature claim to pin: follow one instruction id as it moves out of order — into
      an RS, waiting; issuing to an FU after a younger neighbour has already issued; broadcasting on
      the CDB; sitting in the ROB completed-but-not-committed; and finally committing in program
      order. Pin that completion order ≠ commit order on a program where they demonstrably differ
      (the money-shot loop: a later independent load completes before an earlier stuck `add`, yet
      commits after it). Acceptance: recorder suite green with zero production changes; the
      out-of-order-complete / in-order-commit divergence pinned on a real recording.

- [ ] **5. Web enablement.** `models.ts` entry + `DatapathKind: 'out-of-order'` + the issue-order
      toggle and ROB-size control (and the FU-latency control under B), each gated on the matching
      capability flag like every other config control. The transport, register/memory/source panels,
      scrub, lessons, and sandbox come free via INV-3. The **pipeline map also comes free** and gains
      a new reading: a row (an instruction) now progresses out of order relative to its neighbours —
      the map already keys cells off `location` and instruction id, so out-of-order stage
      progression renders with zero map change (the same "it just absorbs it" the map has delivered
      since M3 step 7). Acceptance: the model is selectable; the map renders an out-of-order
      recording; the issue-order toggle is present on OoO and absent on the in-order models.
      **Browser eyeball required.**

- [ ] **6. The micro-structure tables — `MicroTablePanel` (ROB, RS, rename map).** THE star surface
      of this tier, and the deliverable `superscalar-visuals.md` §3 designed and deferred to here.
      Render as HTML tables in panels (the `panels.tsx` idiom — `.panel`, mono font, `--highlight`
      wash on rows touched this cycle, follow-ring composing across surfaces), NOT SVG boxes — HTML
      wins for tabular data and rows carry the follow-highlight naturally. Three tables, each a pure
      fold over the trace at the cursor (INV-3): the **ROB** as an in-order queue with head/tail and
      per-entry state (waiting / executing / completed / committing); the **reservation stations**
      with operand-ready tags (a value present vs a tag it is waiting on); the **rename map**
      (architectural reg → ROB tag, or "committed"). Follow-highlight lights the same instruction
      across all three plus the map. Acceptance: panel fold tests (`renderToStaticMarkup` smoke:
      occupancy, ready/waiting states, follow-highlight); **browser eyeball** — watch the ROB commit
      in order while an RS shows a younger instruction completed ahead of an older one. This step is
      NOT sheddable — it is the tier's picture.

- [ ] **7. The bespoke OoO datapath — `datapath-out-of-order.ts`.** The schematic: front-end → rename
      → RS clusters → FUs → CDB → ROB → commit, per the `new-model-datapath.md` playbook (pure
      geometry + activation, thin `DatapathDiagram` wrapper, no new colors in TSX). The CDB is the
      interesting new wire — one bus, many listeners — and the follow-ring is how "this instruction's
      result" reads on it. Reuse the lane-hue channel decision from M7 step 7 (wire = stage, box =
      unit, ring = identity) rather than re-deriving it. **This is the honest scope cut** (see the
      headline's inverted lever): if the milestone must shed weight, it sheds THIS, not step 6.
      Acceptance: geometry/activation unit tests + coherence/contraction litmuses ported from the
      existing datapath suites; **browser eyeball**.

## Acceptance criteria (mirror the spec §11 shape)

- [ ] Load the money-shot program on the OoO model with the miss/slow-op present, flip the issue-order
      toggle from in-order to out-of-order without reloading: the pipeline map shows independent
      instructions sliding ahead of a waiting one, and the cycle count drops.
- [ ] The ROB table commits instructions **in program order** while the RS / completion state shows at
      least one younger instruction finishing **ahead of** an older waiting one — out-of-order
      completion, in-order retirement, visible side by side.
- [ ] `follow()` an instruction id across its full out-of-order lifetime (RS wait → issue → CDB →
      ROB → commit), and its commit position is later than a neighbour that completed after it.
- [ ] Register renaming is visible: the rename map shows an architectural register pointing at an
      in-flight ROB tag before it is committed, and a WAR/WAW pair that would stall an in-order
      machine does not stall here.
- [ ] INV-8 differential passes on the full corpus at every config combination, AND a deliberate
      memory-disambiguation bug is confirmed to break it (the one place the differential has teeth).
- [ ] Every cycle count asserted in the step-3 lifecycle table is derived from a stated rule, not
      observed; over-serializing the scheduler fails timing while leaving the differential green.
- [ ] All suites green; `npm run lint`, `tsc -b`, `npm run build` green; the two view steps
      browser-verified.

## How this milestone can lie to itself

Recorded up front because the traps here are structural and worse than any prior tier's.

**INV-8 is a WEAKER safety net than at M7, with one real exception.** OoO retires in order through the
ROB, so final architectural state is deterministic and `runConformance` passes essentially for free —
it would pass with the _entire scheduler wrong_, because scheduling changes only _when_ things happen.
Timing is the whole point of the tier, and there is no golden reference for cycle counts. Step 3 is
the real net. **The exception, and it is worth its own step-2 assertion:** a **memory-ordering** bug —
a load that bypasses an aliasing older store — DOES corrupt architectural state, so the differential
genuinely catches disambiguation errors. That is the one place a green differential means more than
"we didn't corrupt the machine," and it only means it if the corpus (or a new step-0 program)
actually contains a store→load alias to exercise.

**"Reuse the M6 cache" hides a rewrite, and it is the hardest surface.** The cache LOOKUP structure
reuses; the miss HANDLING is the opposite of everything built so far. M6/M7 FREEZE on a miss ("a miss
freezes both slots," and it emits no `stall`). OoO's entire premise is that a miss does NOT freeze —
independent work must proceed. So the load/store unit (load queue, non-blocking/MSHR miss handling,
and memory disambiguation) is genuinely new code, not a reuse, and it is where correctness is
hardest. Do not let the word "reuse" paper over it in any step.

**A slot/tag/cycle asserted without being watched is where the bug hides.** M7's "a slot is not a
stable lane" generalizes and worsens: an instruction's ROB index, its RS occupancy, its completion
cycle, and its commit cycle are four independent moving parts, and out-of-order scheduling makes far
more unobserved case-combinations than any prior milestone. Observe (dump the trace), THEN assert —
for every cycle number and every structure occupant.

**The browser is the only net for steps 5–7.** This repo's headless tests are `renderToStaticMarkup`
with no jsdom — no test can see a click, a scrub, or a cursor. 9 of 10 view steps in project history
shipped a defect only the browser caught. Each view step's acceptance line says "browser eyeball" and
means it — and with three linked tables plus a datapath plus the map, the follow-highlight
composition across surfaces is exactly the kind of thing only a click reveals.

## Decisions to pin (fill in as steps land — seeded with recommended answers)

| Decision                          | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                                                                         | Pinned answer                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Benefit source (the headline)** | **Option B layered on A** — cache-miss MLP as the honest floor, plus a configurable FU-latency knob so classic Tomasulo's "RS waits on a slow op" story is vivid independent of the cache and de-risks the whole tier's dependence on the cache path. A is the conservative floor.                                                                                                                            | **PINNED 2026-07-21 (user).** Gate on step 1a cleared.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Issue width                       | **Superscalar OoO, width-parametric via `issueWidth`** (M7's config field), **default 2**. Build the machine ONCE; scalar OoO is free at `issueWidth: 1` (the clean textbook-Tomasulo teaching position, available as config, not a second build). Width and out-of-order stay orthogonal axes                                                                                                                | **PINNED 2026-07-21 (user).** "Build the machine once" — a future lesson can teach the axes separately                                                                                                                                                                                                                                                                                                                                                     |
| Package strategy                  | New `engine/out-of-order`, extract-then-fork; reuse goes down into `engine-common`, never sideways (zero-sibling-imports precedent)                                                                                                                                                                                                                                                                           | **PINNED 2026-07-21 (user).**                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Renaming style                    | **Classic speculative Tomasulo** — RS hold operand values/tags, register status via ROB tags, ROB holds in-flight values + drives in-order commit + precise state + speculation recovery. The textbook the spec names; avoids a separate physical register file. **Built PRF-forward-compatible** (see the design note below the table) so a future PRF-style tier is a localized backend swap, NOT a rewrite | **PINNED 2026-07-21 (user), with PRF-forward-compat seams.**                                                                                                                                                                                                                                                                                                                                                                                               |
| Flagship interaction              | In-order ↔ out-of-order **issue toggle** at **fixed width** (falls out of the 1a/1b bisection); degenerate position = the in-order machine just learned; same-program flip in the M7 width-toggle pattern                                                                                                                                                                                                     | **PINNED 2026-07-21 (user).**                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Secondary lever                   | **ROB size** (small ROB fills, dispatch stalls — a visible structural limit). A config field, not the headline                                                                                                                                                                                                                                                                                                | **PINNED 2026-07-21 (user).**                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Issue / CDB determinism           | **Oldest-ready-first** for wakeup/select and CDB arbitration — deterministic, no seed needed (INV-1)                                                                                                                                                                                                                                                                                                          | **PINNED 2026-07-21 (user).**                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Outstanding misses (MSHRs)        | Config field, **default 2** (miss-under-miss enables the dramatic MLP money shot). Shape pinned; exact default confirmed against the step-0 dump                                                                                                                                                                                                                                                              | **PINNED 2026-07-21 (user): config field, default 2.** _Step-0 static analysis CONFIRMED 2 — `array-sum.s`'s two consecutive independent loads are the miss-under-miss pair that width-2 unlocks. The `numMshrs` field is added at 1b (its only consumer), not step 0._                                                                                                                                                                                    |
| New trace events                  | Add the minimum: `rename`, `dispatch`, `issue`, `cdb-broadcast`, `commit` (or reuse `instr-retire`). Force each only if a step-6/7 view cannot be drawn without it. House record breaks here — correctly                                                                                                                                                                                                      | _Already decided (YAGNI): the discipline IS the answer. Not reopened; force each at build time._                                                                                                                                                                                                                                                                                                                                                           |
| `location` encoding               | `"ROB#k"` / `"RS#j"` plain strings (the spec's own §5 example) — like `"EX.0"`, likely no schema-type change, zero recorder change                                                                                                                                                                                                                                                                            | **PINNED 2026-07-21 (user).**                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Corpus additions                  | Decide at step 0 against a fresh dump: possibly (i) a bigger-window program to make ROB size pay off, (ii) a store→load-alias program for disambiguation (the corpus lacks one today). INV-7 intact                                                                                                                                                                                                           | **SETTLED 2026-07-21 (step-0 static analysis).** (i) NO — `array-sum.s` already fills a small ROB (5-instr loop), so ROB-size stalls are visible without a new program. (ii) YES — corpus has no `sw`→dependent-`lw` alias; author `store-forward.s` (a `sw`, an independent op, a dependent `lw` to the same address) **at step 1b**, where the LSU exists to exercise it. Money shot stays `array-sum.s`. Worksheet: `temp/m9/step0-corpus-analysis.md`. |
| View scope                        | Full: ROB/RS/rename tables (non-sheddable — the tier's picture) + bespoke datapath (the honest cut if weight must be shed). Inverts M7's "never cut the datapath"                                                                                                                                                                                                                                             | **PINNED 2026-07-21 (user): intent pinned — tables non-sheddable, datapath is the sacrificial buffer.**                                                                                                                                                                                                                                                                                                                                                    |
| Lessons                           | **Out of scope for M9** — a future M10, mirroring M7 (model+view) → M8 (lesson track)                                                                                                                                                                                                                                                                                                                         | **PINNED 2026-07-21 (user).**                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Design note — building Tomasulo PRF-forward-compatible (pinned 2026-07-21)

Classic speculative Tomasulo (ROB-holds-values) is what M9 builds. A future PRF-style tier (physical
register file + rename map + free list; values in the PRF, not the ROB) should be a **localized
backend swap, not a rewrite.** That is achievable for free because most of the machine is
rename-style-agnostic by construction — and the small part that differs sits behind three seams that
are just good design, so there is **no speculative-abstraction tax** paid now (honoring the standing
"don't-foreclose but NOT build-for-it-now" flag: seams yes, a full abstract PRF interface **no**).

**Rename-style-agnostic and reused as-is (≈80%):** the front-end (fetch/decode/predict/program image,
`engine-common`), the **non-blocking LSU + memory disambiguation** (entirely orthogonal to rename
style), the cache, the FU-latency knob, the **CDB plumbing**, the ROB's **ordering** logic
(allocate → in-order commit → flush-to-a-point), the flush/recovery mechanism, and the generic
key/value **table view components** (a future PRF table is another instance of the same component).

**The irreducible delta (≈20%, the "rename backend"):** (1) where result values live — ROB entries
vs. the PRF; (2) what the rename map points at — a ROB tag vs. a physical-reg id + a free list;
(3) operand delivery timing — an RS _captures the value_ off the CDB at dispatch vs. holds a _tag_
and _reads the PRF at issue_; (4) commit action — write the ARF vs. free the _old_ physical register.

**The three cheap seams to build now** so that delta is a swap, not a hunt:

1. **Keep `Tag` an opaque named type** — never hardcode "tag == ROB index" across the scheduler. In
   classic Tomasulo the tag _happens_ to equal the ROB index; in PRF it is a separate namespace. A
   named type lets wakeup/select compare tags without assuming they index the ROB.
2. **Separate the ROB's _ordering_ from its _payload_** — the in-order queue (head/tail, allocate,
   commit-in-order, flush) knows nothing about values; the value-or-old-mapping is a payload the
   rename backend owns. Swapping backends never touches the ordering code.
3. **One operand-read choke point and one commit choke point** — every operand read and every commit
   goes through a single function, so "capture-at-dispatch vs. read-at-issue" and "write-ARF vs.
   free-phys-reg" collapse to swapping _those_ functions.

**Honest limit:** "minimal work later" = one module (the rename backend) reimplemented against a
stable interface, plus a new PRF+free-list view table — NOT literally zero (the dispatch-capture vs.
issue-read timing is a genuine behavioral difference). Everything around it survives untouched.
