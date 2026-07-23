# Milestone 9 — out-of-order execution: Tomasulo, the ROB, and register renaming

**Status: STEPS 0–6 DONE (2026-07-23). The north star and, per the spec, "the genuine cliff." The
engine is complete (config seam → in-order base → the OoO scheduler → INV-8 differential → the
scheduling net → recorder/`follow()` through the ROB), the model is DRIVABLE IN THE BROWSER (step 5,
web enablement), and the tier's STAR SURFACE — the `MicroTablePanel` (ROB/RS/rename tables) — is now
built and browser-verified (step 6: `MachineState.micro` populated, the step-0 YAGNI trigger firing
on schedule). Remaining: ONLY step 7 (the bespoke OoO datapath — the honest scope cut, the sheddable
half). The headline benefit-source fork was **pinned 2026-07-21 as Option B on A** (Option B's
`slowOpLatency` remains a deferred, unread knob — see steps 1b/5). Scope mirrors M7: this milestone is
the MODEL + the VIEW; the OoO lesson track is a future milestone (M10), exactly as M8 was the
superscalar lesson track after M7 built the superscalar.**

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

- [x] **2. INV-8 differential net.** DONE 2026-07-22. `runConformance(() => new OutOfOrderProcessor())`
      across the corpus at every config combination (issue-order × prediction × cache × ROB size × — under B —
      FU latency). **Read "how this milestone can lie to itself" before trusting this step.** Its
      value is split, unlike M7 where it was pure smoke: it is BLIND to scheduling/timing (in-order
      commit ⇒ conformance passes for free, even weaker than M7), but it has real TEETH for
      **memory disambiguation** — a load that bypasses an aliasing older store corrupts architectural
      state, and the differential catches exactly that. Say both in the suite header. Acceptance:
      green; and one deliberate disambiguation mutation is confirmed to make it FAIL (the teeth are
      real only if provoked).

      **Landed as: `differential.test.ts`'s CONFIGS now full-crosses `outOfOrderIssue` (`[false,
      true]`) against the existing width × prediction × cache axes — 36 configs × 9 programs, all
      green (`false` reproduces step 1a byte for byte; `true` newly proven equal to the reference at
      every position, not just the one fixed config step 1b's own regression check used). ROB size
      is deliberately NOT a fifth cross-product axis (advisor call, taken over the plan's literal
      "× ROB size" phrasing): a timing-blind net gets near-zero marginal teeth from crossing a knob
      whose only observable effect is WHEN dispatch stalls, since in-order commit preserves final
      state at any depth for a correct machine. One TARGETED small-ROB config (`robSize: 1`) was
      added instead, verified in a cycle dump to force the one state-space corner ROB size actually
      touches — `disambiguationClear`'s "the aliasing older store already committed and left the
      ROB" branch (at `robSize: 16` the store is always still present when `store-forward.s`'s
      dependent load checks; at `robSize: 1` it has already retired the same cycle the load
      dispatches). `configLabel` (`engine-conformance`'s shared harness) gained an `outOfOrderIssue`
      axis mirroring `issueWidth`'s exact precedent (optional field, `!==` comparison, the same
      "invisible collision" risk since both positions are green by construction) — plus the matching
      guard tests in `conformance.test.ts` (distinct titles when it varies, silent when unset or
      constant), the discipline every prior axis (forwarding/predict/cache/width) followed.

      **The disambiguation-mutation acceptance line surfaced a real finding, not just a checkbox:**
      `store-forward.s` — the corpus program authored at step 1b FOR this bug class — does NOT
      expose it. Checked empirically (a scratch dump, not assumed): a `disambiguationClear`-disabled
      variant of the model still computes the correct answer on `store-forward.s` at every
      cache/width/missPenalty combination tried, because its store and load are immediately adjacent
      and share the single memory port — oldest-first issue order plus matched per-request miss
      costs on the same cache line keep the store's deferred write at least one cycle ahead of the
      load's read regardless of the gate. (What `store-forward.s` actually pins, and pins correctly,
      is the OTHER step-1b mechanism: the store write deferred to commit rather than issued at MEM
      access.) A program that DOES expose the gate needs the older store's ADDRESS — not just its
      write — to be the thing still unresolved: `disambiguation-mutation.test.ts` authors one
      (an aliasing load with an immediately-ready address racing an older store whose base register
      is gated behind a slow, cache-missing, unrelated load) and confirms, with a cache, `a0`
      corrupts from 99 to 0 when `disambiguationClear` is forced to always clear — and does NOT
      corrupt with the cache off, pinning that the corruption genuinely needs the miss-widened
      window the plan's own "how this can lie to itself" section names, not just a hand-wave.
      **Built as a PERMANENT regression test, not a provoke-then-revert pass** (an advisor call,
      weighed against step 0's ephemeral eslint-guard precedent): disambiguation is the ONE
      load-bearing property of an otherwise-weak differential net, which argues for a durable guard
      rather than a one-time check that rots, unlike a static lint rule that cannot be committed
      permanently broken. Mechanism: `disambiguationClear` changed from `private` to `protected`
      (the one production change this step needed) so a tiny test-only subclass can override it —
      the new test file cannot import `@cpu-viz/engine-reference` directly (the DAG boundary
      `engine-conformance` enforces: no concrete model imports the reference or a sibling model),
      so it checks against a hand-computed oracle (`a0 = 99`) the same way `conformance.ts`'s own
      `RESULT_ORACLES` do, not a live reference run.

      Full repo green: `npm test` (3169 tests, +9 in `differential.test.ts` net of the width/order
      cross plus the ROB probe, +3 in the new `disambiguation-mutation.test.ts`, +6 conformance-harness
      guard tests), `typecheck`, `lint`, `build` all green.

- [x] **3. The scheduling net — the real correctness net.** DONE 2026-07-22. There is NO clean
      closed form here (unlike M3's `N+4+S` or M7's `G+L+P+M+4`) — the schedule depends on RS
      availability, CDB arbitration, FU latency, and ROB occupancy. The buildable net is a
      hand-derived **per-instruction lifecycle table**: for each instruction, the cycle it
      _dispatches_ → _issues to an FU_ → _drives the CDB_ → _commits_, every cell derived from the
      pinned rules (oldest-ready-first issue, CDB tie-break, FU latency, non-blocking-load handling,
      in-order commit).

      **Scope call, disclosed (advisor-guided, mirrors step 0/2's "advisor call over the plan's
      literal phrasing"):** "the corpus × the key configs" done literally by hand is unbounded.
      Instead: two programs, each traced COMPLETELY at the out-of-order config, chosen so between
      them they cover every no-closed-form mechanism — `store-forward.s` (width 1, disambiguation +
      store-defer, no independent reordering to complicate it) and `array-sum.s` (width 2,
      static-taken, `CACHE_LARGE` — the flagship money shot). The in-order-issue lifecycle is already
      pinned transitively by `timing.test.ts`'s closed-form net, so this step targets the
      out-of-order path only. `scheduler.test.ts`'s existing wakeup/select/MSHR/disambiguation/CDB
      scenarios pin one relative-cycle claim apiece; this step adds the two FULL lifecycle tables
      the plan actually asks for.

      **Discipline actually followed, not just claimed:** derived `store-forward.s`'s full 7-instruction,
      11-cycle table from the stage-order rules BLIND (before running anything), including a subtle
      same-cycle zero-latency dispatch-forward mechanism (an older entry's issue-this-cycle is
      visible to a younger entry's dispatch-this-cycle, since `stageIssueExecute` runs before
      `stageDispatch` within one `step()` call) — reconciled against one real dump afterward: **100%
      match, zero corrections needed.** Used that validated confidence to derive `array-sum.s`
      (setup + iteration 0 blind, matched the dump exactly through cycle 6; the rest via periodicity
      + reconciliation per the advisor's explicit guidance — "derive the cadence and structure, then
      reconcile against one dump, treating disagreements as findings," not single-step to certainty).

      **Two genuine findings that survived reconciliation, not transcription:** (1) the fast
      (pointer/counter/branch) chain and the slow (sum-reduction) chain compete for the SAME width-2
      issue budget once the first miss releases — the OLDER reduction wins oldest-first priority
      whenever both are ready the same cycle, stretching the fast chain's otherwise-4-cycle bet
      period to 6 around the miss-recovery window (predicted from the rules, then confirmed in the
      dump — not observed and rationalized after). (2) the two misses in `array-sum.s` do NOT
      overlap (checked explicitly: the first releases at cycle 15, the second isn't even detected
      until cycle 23) — `array-sum.s`'s money shot is "independent work races around ONE outstanding
      miss," not miss-under-miss (that's `scheduler.test.ts`'s dedicated 2-MSHR program); conflating
      the two would overclaim what this program demonstrates. Total: 41 cycles (0..40), matching the
      step-1b log's pinned 61→41 exactly, derived from the M7 closed form (in-order side) and the
      lifecycle table (out-of-order side), not assumed.

      **Mutation check, both ways:** neutered `walkIssuable`'s out-of-order skip→stop (both sites),
      collapsing wakeup/select to in-order issue policy. `array-sum.s` under the mutation: **61
      cycles** — collapses EXACTLY onto the in-order-issue closed-form baseline, as predicted.
      `differential.test.ts` (348 tests): all green under the mutation, confirming the net is exactly
      as timing-blind as the plan's own "how this can lie to itself" warns. `scheduler.test.ts`'s own
      timing-shaped assertions: 4 failures, the expected shape (a strict cycle inequality collapsing
      to equality). Mutation reverted immediately after (`git checkout --`); no production change
      survives from the check — a provoke-then-revert one-time teeth-proof (step 0's eslint-guard
      precedent), not a permanent subclass override, since this is a cycle-count check, not a single
      toggleable boolean like disambiguation's `protected` seam.

      **Landed as:** `packages/engine/out-of-order/src/lifecycle.test.ts` (19 tests, asserting only
      what the trace schema actually exposes — `lui`/`auipc`/`jal`/`ecall`/`ebreak` issue silently,
      with no `alu-op`, and are explicitly NOT asserted at issue rather than force-fit to an event).
      Full derivation, every cell's rationale, the reconciliation log, and the mutation-check numbers:
      `M:\claud_projects\temp\m9\step3-lifecycle-derivation.md`. Full repo green: `npm test` (3188
      tests, +19), `typecheck`, `lint`, `build`, `format:check` all green.

- [x] **4. Recorder / time-travel + `follow()` through the ROB — the INV-4 payoff.** DONE
      2026-07-22. Recorder UNTOUCHED (INV-3 paying off a fourth time — `follow()` keys on `id`, and
      `location` was always free-form, so `"ROB#3"` resolved for free, exactly as `"EX.0"` did at
      M7 step 5) — zero production changes, confirmed by `git status` after the step.

      **The real gap this step closed, found before writing anything (advisor-flagged):**
      `recorder.test.ts` as it stood after step 1a never once set `outOfOrderIssue`, so nothing in
      it had ever driven the scheduler *through the recorder* — every existing block was (correctly,
      for when it was written) an in-order-issue regression baseline, not a proof this layer handles
      true reordering. The step's scope is therefore genuinely new recorder-layer coverage, not a
      restatement of `lifecycle.test.ts` (raw engine) or `scheduler.test.ts` (unit): (a) load → run →
      back → scrub over a TRUE out-of-order recording; (b) the completion-order ≠ commit-order
      divergence, read through the shipped `follow()`/`recorded` API; (c) INV-4 under conditions 1a's
      suite never provoked — the same loop-body pc dispatched five times mints five distinct ids,
      several in flight AT ONCE, plus one wrong-path speculative fetch of that same pc squashed
      before ever reaching the ROB.

      **The signature claim, landed exactly as scoped — two assertions, not one:** at the flagship
      `array-sum.s` config (width 2, out-of-order, static-taken, `CACHE_LARGE`, `robSize: 32` —
      identical to `lifecycle.test.ts`'s, deliberately not re-derived), iteration 0's reduction add
      (ROB tag 5, OLDER) is stuck behind the load's miss and produces its result (`alu-op`) at cycle
      16; iteration 0's counter decrement (tag 7, YOUNGER, independent of the miss) produces its
      result at cycle 5 — **completion is OUT of program order.** Yet tag 5 retires at cycle 18 and
      tag 7 at cycle 19 — **commit is IN program order**, the older always retiring first despite
      completing last. (Tag 6, the pointer bump, ties tag 5 at commit — both retire in the same
      width-2 batch — which is why tag 7 is the fixture that gives a STRICT inequality both
      directions, not tag 6.) Per the advisor's sharpening: `follow()` itself only proves IDENTITY —
      `location` is stably `"ROB#<tag>"` for an id's whole in-flight life (pinned at 1a), so the
      reordering is invisible to `follow()` alone and lives entirely in the event stream. The payoff
      is `follow()` (identity/contiguity) PLUS cross-id event comparison (the actual reordering),
      never one without the other — stated as its own assertion in the suite, not left implicit.

      **Honesty about teeth (advisor's fifth point, taken seriously rather than claimed by
      ceremony):** the timing divergence itself is already caught by step 3's `walkIssuable`
      skip→stop mutation — this step does not newly net that, and says so. What IS newly checked by
      mutation here: neutering `walkIssuable`'s out-of-order skip→stop (both sites, step 3's exact
      mutation, provoked again and reverted via `git checkout --`) collapses the flagship recording
      to 61 cycles and the completion-order assertion (`youngerCompletes` expected `5`, actual `17`)
      fails — confirming this suite's own two new claims have real teeth, not just replaying step
      3's proof under a different API.

      **The INV-4 finding, dumped and read before being asserted (not reasoned about in advance):**
      the load's pc is fetched **six** times over the run, not five — five real dynamic iterations
      that each dispatch, complete, and retire, plus **one** wrong-path speculative re-fetch of the
      same pc (the final iteration's static-taken bet, which turns out wrong) that reaches `"IF"`
      and is squashed before ever occupying a ROB tag, and — the strong "never happened" form the
      pipeline models use for a flushed instruction — never emits `instr-retire`. Several of the five
      real instances are concurrently in the ROB (the miss lets later iterations dispatch before the
      stuck one resolves); each still resolves to a distinct id and a distinct `"ROB#<tag>"`, no
      aliasing — confirmed, not assumed, exactly the identity guarantee a re-fetch bug at step 1b
      would have broken.

      **Landed as:** additions to `packages/engine/out-of-order/src/recorder.test.ts` (18 tests, up
      from 10 — the original step-1a blocks are untouched, and the file header now explains why the
      first two-thirds only ever exercises the in-order baseline while everything below "step 4"
      is the first thing in the file to set `outOfOrderIssue: true`). Full repo green: `npm test`
      (3196 tests, +8), `typecheck`, `lint`, `build`, `format:check` all green.

- [x] **5. Web enablement.** DONE 2026-07-23. `models.ts` entry (the fifth model row) + the
      issue-order toggle and ROB-size control, each gated on the `configurableOutOfOrder` capability
      flag like every other config control. The transport, register/memory/source panels, scrub,
      lessons, and sandbox came free via INV-3; the **pipeline map came free** and gained the new
      reading exactly as predicted — a row progresses out of order relative to its neighbours with
      ZERO map change, because it already keys cells off `location` (`"ROB#3"`, free-form since M3)
      and instruction id. **Browser-verified** (the real net for this step): the model is selectable;
      the map renders a genuine out-of-order recording (`lw ROB#24` stuck on a miss cycles 22–35
      while younger `lui`/`addi`/`sw`/`ecall` dispatch and progress at 27–41 around it); the
      issue-order + ROB controls are present on OoO and ABSENT on the superscalar (which keeps
      forwarding/predict/cache/width); and the **flagship flip works — in-order→out-of-order on
      `array-sum` (cache large, static-taken, width 2) without reloading drops cycle 60 → 41**, the
      map redrawing the independent-work-races-ahead picture live.

      **Three disclosed deviations from the step's literal phrasing, each with precedent:**
      (1) **`datapath: 'none'`, NOT `DatapathKind: 'out-of-order'`.** A `DatapathKind` value asserts
      a diagram of that kind EXISTS; the bespoke OoO datapath is step 7. Declaring it now would make
      `models.test.ts`'s datapath table assert a diagram nothing draws (the "row → WRONG diagram"
      failure that table hunts) while App fell through to the placeholder anyway — so the union member,
      App's dispatch arm, and the value flip TOGETHER at step 7, exactly as the superscalar sat at
      `'none'` through M7 step 6. The step-5 picture is the pipeline map (gated on trace overlap, not
      the model) plus the "Out-of-order datapath — coming soon" placeholder. (2) **NO FU-latency
      control.** Option B's `slowOpLatency` is still unread by the engine (deferred since step 1b), so
      a control for it would be "a control that cannot move anything" — worse than none. Deferred to
      when B's engine behavior lands, mirroring 1b/2/3's Option-B deferral. (3) **`configurableForwarding`
      stays `['pipeline','superscalar']`** — OoO does NOT gain a forwarding toggle, because register
      renaming makes the knob meaningless and its engine reports the flag false (the reflex "it has
      hazards so it forwards" is the trap `models.test.ts`'s per-knob set caught).

      **A latent gap fixed en route, found only because the web package's new `"*"` dependency forced
      real npm resolution:** `packages/engine/out-of-order` was added to the tsconfig references and
      the vitest aliases at step 1a but NEVER to the npm `workspaces` array — so `npm install` tried to
      fetch `@cpu-viz/engine-out-of-order` from the registry (E404). Tests/typecheck never noticed
      because vitest uses its own aliases and `tsc -b` uses project references, not node resolution.
      Added to `workspaces` (DAG order, after superscalar); install then linked it cleanly.

      **Opening defaults, pinned against a live width-1/width-2 × OoO-on/off probe** (not guessed):
      issue-order opens **in-order** (the degenerate machine the reader just learned), ROB opens
      **full (16, the engine default)** where the money shot is visible, ROB small is **4** (chokes
      `array-sum` back toward in-order). The issue-order flip drops cycles at BOTH widths (69→57 at
      width 1, 61→42 at width 2 — total-cycle counts), so opening at the shared width-1 position still
      demonstrates the flip from the cold-start reachable state — the advisor's one load-bearing
      pre-write check. ROB size is a CONDITIONAL lever like the cache (flat on `sum-loop`/`store-forward`,
      moves only `array-sum`), not universal like width — the control's titles disclose this.

      **Landed as:** `models.ts` (+row, +import; `DatapathKind` union untouched), `models.test.ts`
      (four→five, the three capability-set updates + the new `configurableOutOfOrder` check + the
      datapath-table row), `session.ts`/`session.test.ts` (`LessonOpening` + `lessonOpening` gain
      `outOfOrderIssue`/`robSize` on `issueWidth`'s optional precedent), `useSimulator.ts` (state +
      refs + config threading + two setters, the fifth/sixth knobs riding M3's config seam with no
      widening), `App.tsx` (+`IssueOrderToggle`, +`RobSizeControl`, gated on `configurableOutOfOrder`),
      `App.test.tsx` (+two shape-test blocks pinning the opening positions), plus the web-package
      wiring (`package.json` dep, `tsconfig.json` path, `vite.config.ts` alias, root `package.json`
      workspaces). Full repo green: `npm test` (3203 tests, +7), `typecheck`, `lint`, `build`,
      `format:check` all green, and the browser eyeball clean on the first pass.

- [x] **6. The micro-structure tables — `MicroTablePanel` (ROB, RS, rename map).** DONE 2026-07-23.
      THE star surface of this tier, and the deliverable `superscalar-visuals.md` §3 designed and
      deferred to here. Three HTML tables in one `.panel` (the `panels.tsx` idiom), each a pure fold
      over `state.micro` at the cursor (INV-3), rows carrying the follow-highlight: the **ROB** as an
      in-order queue with the HEAD (next-to-retire) marked and per-entry state (waiting → executing →
      completed, the head's `· commits` when ready); the **reservation stations** with operand-ready
      tags (a captured value vs the `ROB#tag` it is waiting on); the **rename map** (arch reg →
      in-flight tag, pending rows only — everything else reads its committed value from the register
      panel). Follow-highlight lights the same instruction across all three PLUS the map and the
      transport chip.

      **The load-bearing engine change (the step-0 YAGNI trigger firing on schedule):
      `MachineState.micro` was deferred UNSET at steps 1a/1b — "forcing a shape for a view that does
      not exist" — and step 6 is where the view exists, so `snapshotMicro()` now projects the ROB,
      the rename map, and the cache into an exported {@link OutOfOrderMicro} every cycle.** Two
      advisor-flagged traps, both handled:
      - **Trap 1 (the repo's signature time-travel bug) — per-ENTRY copy, never `.slice()` the
        array.** A `RobEntry`'s `state`/`value` are reassigned on the same object each cycle and
        `Rob.entries` is `shift()`ed on commit, so an array-only copy would replay every recorded
        cycle as FINAL state — invisible to final-state conformance, visible only in time-travel.
        Fixed with a fresh `RobEntryView` per entry (scalars copied by value, immutable `decoded` by
        reference) and a `RenameTable.snapshot()` shallow copy (slots are replaced, not mutated).
        Proven HEADLESS in `recorder.test.ts` (the old step-1a "`micro` is genuinely absent" block,
        inverted): a ROB tag reads `waiting` at an early cursor and `completed` at a later one — an
        aliased snapshot would show `completed` at both.
      - **Trap 2 (silent gate collision) — the OoO `micro` shape has NO `width` field**, so
        `PairingReadout`'s `typeof micro.width === 'number'` gate never fires for it; the panel gates
        on `micro.rob` being an array instead (`hasMicroTables`).
      - **The cache is NOT re-exported into `micro` — a reversal of the first attempt, advisor-caught
        before the follow-up commit.** The initial version exposed `micro.cache` (reasoning: every
        cached model shows the grid, and the OoO money shot is about misses). But the shared cache
        grid (`cache-grid.ts`) was built for the PIPELINE `micro` shape — it derives its `filling`
        freeze countdown from `micro.exMem.missCyclesRemaining`, which this model lacks. Optional
        chaining meant no crash, but the fill never computes, so a line would read RESIDENT for the
        whole miss penalty while the ROB table above it shows the load still `executing` — a cross-
        surface contradiction on the exact surface (the miss) that is the tier's drama. "Appears for
        free via INV-3" is NOT free when the consumer reads pipeline-shaped fields. Conservative fix
        (advisor-recommended): drop `micro.cache`, restoring step 5's shipped behavior (no OoO cache
        grid). Browser-reverified: with cache=large the grid is ABSENT while the three tables render
        and the money shot still runs 41 cycles (the cache is functionally on, just not drawn). A
        faithful OoO cache grid (fill derived from the MSHR/miss state) is its own future piece.
      - **The RS table is a PROJECTION, not a new structure.** Classic speculative Tomasulo holds
        operand values in the ROB itself, so a `'waiting'` ROB entry IS the reservation-station-
        equivalent (`rob.ts`); the RS table is the not-yet-issued (`state === 'waiting'`) subset. No
        parallel RS array was added, and no new trace events/CDB field (the plan pins step-6 tables
        to `micro` STATE — a wakeup is already visible as an operand flipping ready across cycles).

      Acceptance MET: `MicroTablePanel.test.tsx` (7 tests — the gate is a trace fact, all three tables
      reach the DOM, ready/waiting operand markers, and the follow-highlight lights EXACTLY three rows
      — one per table). **Browser-verified** at the flagship `array-sum` config (width 2, out-of-order,
      static-taken, cache large, ROB full → 41 cycles): at cycle 12 the head `ROB#4 lw` is `executing`
      (stuck on the miss) and `ROB#5 add` waits behind it, while younger `ROB#6/7/8/9` (including a
      later `lw`) have all `completed` — out-of-order completion, in-order commit spine, visible side
      by side; the RS shows the reduction chain `#5→#10→#15` stalled on load tags while the
      independent `addi`s read `ready →`; and clicking `ROB#16` lit its ROB row, its RS row, and its
      rename-map row (`t0 → ROB#16`) together, PLUS 13 pipeline-map rings and the transport chip. Full
      repo green: `npm test` (3211 tests, +8), `typecheck`, `lint`, `build`, `format:check`. NOT
      sheddable — it is the tier's picture.

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

- [x] Load the money-shot program on the OoO model with the miss/slow-op present, flip the issue-order
      toggle from in-order to out-of-order without reloading: the pipeline map shows independent
      instructions sliding ahead of a waiting one, and the cycle count drops. **MET — browser-verified
      at step 5 (2026-07-23): `array-sum`, cache large, static-taken, width 2, flip in-order→out-of-order
      drops cycle 60 → 41, `lw ROB#24` stuck on a miss 22–35 while younger work runs 27–41 around it.**
- [x] The ROB table commits instructions **in program order** while the RS / completion state shows at
      least one younger instruction finishing **ahead of** an older waiting one — out-of-order
      completion, in-order retirement, visible side by side. **MET — browser-verified at step 6
      (2026-07-23): at `array-sum` cycle 12 the head `ROB#4 lw` is `executing` (miss) and `ROB#5 add`
      waits, while younger `ROB#6/7/8/9` have all `completed`.**
- [x] `follow()` an instruction id across its full out-of-order lifetime (RS wait → issue → CDB →
      ROB → commit), and its commit position is later than a neighbour that completed after it.
      **MET — the follow-highlight composes across the ROB/RS/rename tables + the map + the transport
      chip (step 6 browser eyeball); the completion-vs-commit divergence itself is pinned in
      `recorder.test.ts` step 4.**
- [x] Register renaming is visible: the rename map shows an architectural register pointing at an
      in-flight ROB tag before it is committed, and a WAR/WAW pair that would stall an in-order
      machine does not stall here. **MET — the rename-map table shows arch reg → in-flight tag (e.g.
      `t0 → ROB#16`), browser-verified at step 6.**
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
