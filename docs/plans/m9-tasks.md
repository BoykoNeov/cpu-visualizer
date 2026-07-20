# Milestone 9 — out-of-order execution: Tomasulo, the ROB, and register renaming

**Status: NOT STARTED, 2026-07-21. The north star and, per the spec, "the genuine cliff." Nothing
built yet. This document is the plan; the headline benefit-source fork (below) is the one decision
that must be pinned WITH the user before step 1a, because it reshapes the model. Scope mirrors M7:
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

**The one open fork, to pin WITH the user (deliberately NOT seeded unilaterally):**

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
But this reshapes the model, so it is the user's to pin. **Do not start step 1a until it is pinned.**

**The flagship same-program interaction — an in-order ↔ out-of-order ISSUE toggle.** Falls straight
out of the step-1 bisection (1a = in-order-issue base; 1b = the OoO scheduler). The degenerate
position (in-order issue) is the machine the reader just learned; flipping to out-of-order issue on a
program with a miss (or a slow op, under B) shows independent work sliding ahead and IPC rising — the
same-program-flip the spec calls "where understanding clicks," in the M7 width-toggle pattern. Seed
this as the flagship; **ROB size is a secondary lever** (a small ROB fills and stalls dispatch — a
visible structural limit), worth a config field but not the headline.

**Package strategy — a NEW `packages/engine/out-of-order`, extract-then-fork (the M7 precedent).**
OoO is not a toggle on the superscalar: ROB + RS + rename + CDB is a different machine, not a wider
stage walk. Reuse goes DOWN into `engine-common` (cache and predict already live there), never
sideways (the zero-sibling-imports precedent holds). If any genuinely model-independent logic
surfaces, extract it at step 0; otherwise step 0 is schema + config, not a refactor.

**Scope lever, and it INVERTS M7's.** For M7 the honest cut was "shed the readout, never the
datapath — a model with no picture is not a tier." For OoO the _tables_ (ROB / RS / rename map) ARE
the picture — they are the tier's star surface and are non-negotiable. The **bespoke SVG datapath**
(step 7) is the sheddable half here: a CDB-and-reservation-stations schematic is lovely but
secondary to watching the ROB commit in order while execution completes out of order. If the
milestone must lose weight, it loses step 7, not step 6.

## Build order (each step testable before the next)

- [ ] **0. Trace-schema extension + config seam + the corpus decision.** This is the first milestone
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

- [ ] **1a. `engine/out-of-order` at IN-ORDER ISSUE — the faithful base.** The full front-end,
      register renaming, the ROB, and in-order commit, but **issue is in program order** (dispatch
      to RS/ROB in order, and issue to FUs strictly oldest-first with no reordering). This is the
      milestone's bisection anchor and gets its own commit. **Its net is timing, not INV-8:** an
      in-order-issue OoO core must reproduce the superscalar/pipeline timing baseline over the corpus
      × config — which de-risks "did I faithfully build the front-end, rename, ROB, and commit" BEFORE
      out-of-order scheduling can muddy it, exactly as M7 step 2a reproduced M3's closed form before
      pairing. INV-4 ids run fetch → commit; the ROB is populated and drains in order. Also due here
      if not at step 0: the eslint deny-list additions. Acceptance: the in-order timing baseline
      holds over the corpus under every config combination; INV-8 differential green (weak, but a
      floor).

- [ ] **1b. The out-of-order scheduler — the model's soul.** Reservation stations with operand-tag
      tracking; wakeup/select (a ready instruction issues to a free FU, ties broken **oldest-first**
      for determinism — INV-1, no seed needed); the CDB with deterministic arbitration (oldest
      result wins a contested broadcast); speculation past branches with **ROB-based recovery**
      (mispredict flushes the ROB tail and the rename map back to the branch, precise state); and the
      **non-blocking load/store unit** — a load queue, outstanding-miss handling (MSHRs, count is a
      config or a pinned constant), and **memory disambiguation** (a load checks the store queue /
      older stores and does not bypass an aliasing older store). Under Option B, the RS also holds an
      instruction across its multi-cycle execute. This is where the core beats 1a: under a miss (or a
      slow op), independent instructions issue and complete around the waiting one, while commit
      stays in order. **Every claim that names a specific cycle or a specific RS/ROB slot must be
      WATCHED in a dump, not reasoned about** — the M7 lesson (a slot is not a stable lane) is
      sharper here, where an instruction's ROB entry, RS occupancy, and completion order are all
      independent moving parts. Acceptance: strictly fewer cycles than 1a on the money-shot
      program(s) with byte-identical architectural results; a unit test per new mechanism (rename,
      wakeup/select, CDB arbitration, non-blocking load, disambiguation, ROB flush-recovery);
      disambiguation correctness pinned by a store→load-alias program.

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

| Decision                          | Recommendation (seed)                                                                                                                                                                                                                                                                                                    | Pinned answer                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| **Benefit source (the headline)** | **NOT SEEDED — user's to pin.** Lean: **Option B layered on A** — cache-miss MLP as the honest floor, plus a configurable FU-latency knob so classic Tomasulo's "RS waits on a slow op" story is vivid independent of the cache and de-risks the whole tier's dependence on the cache path. A is the conservative floor. | _(open — pin before step 1a)_ |
| Package strategy                  | New `engine/out-of-order`, extract-then-fork; reuse goes down into `engine-common`, never sideways (zero-sibling-imports precedent)                                                                                                                                                                                      | _(open)_                      |
| Renaming style                    | **Classic speculative Tomasulo** — RS hold operand values/tags, register status via ROB tags, ROB for in-order commit + precise state + speculation recovery. The textbook the spec names; avoids a separate physical register file                                                                                      | _(open)_                      |
| Flagship interaction              | In-order ↔ out-of-order **issue toggle** (falls out of the 1a/1b bisection); degenerate position = the in-order machine just learned; same-program flip in the M7 width-toggle pattern                                                                                                                                   | _(open)_                      |
| Secondary lever                   | **ROB size** (small ROB fills, dispatch stalls — a visible structural limit). A config field, not the headline                                                                                                                                                                                                           | _(open)_                      |
| Issue / CDB determinism           | **Oldest-ready-first** for wakeup/select and CDB arbitration — deterministic, no seed needed (INV-1)                                                                                                                                                                                                                     | _(open)_                      |
| Outstanding misses (MSHRs)        | Start at **2** (miss-under-miss enables the dramatic MLP money shot); make it a pinned constant or a config field. Finalize against the step-0 dump                                                                                                                                                                      | _(open)_                      |
| New trace events                  | Add the minimum: `rename`, `dispatch`, `issue`, `cdb-broadcast`, `commit` (or reuse `instr-retire`). Force each only if a step-6/7 view cannot be drawn without it. House record breaks here — correctly                                                                                                                 | _(open)_                      |
| `location` encoding               | `"ROB#k"` / `"RS#j"` plain strings (the spec's own §5 example) — like `"EX.0"`, likely no schema-type change, zero recorder change                                                                                                                                                                                       | _(open)_                      |
| Corpus additions                  | Decide at step 0 against a fresh dump: possibly (i) a bigger-window program to make ROB size pay off, (ii) a store→load-alias program for disambiguation (the corpus lacks one today). INV-7 intact                                                                                                                      | _(open)_                      |
| View scope                        | Full: ROB/RS/rename tables (non-sheddable — the tier's picture) + bespoke datapath (the honest cut if weight must be shed). Inverts M7's "never cut the datapath"                                                                                                                                                        | _(open)_                      |
| Lessons                           | **Out of scope for M9** — a future M10, mirroring M7 (model+view) → M8 (lesson track)                                                                                                                                                                                                                                    | _(open)_                      |
