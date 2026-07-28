---
name: m3-pipeline-engine
description: "M3 steps 0-4 (engine half): the 5-stage pipeline model - hazards, forwarding, stalls, flushes - plus the pinned-TIMING suite that nets INV-8's blind spot (final state can match while timing is wrong) and recorder time-travel."
metadata:
  node_type: memory
  type: project
---

## M3 (5-STAGE PIPELINE) — PLAN pushed 2026-07-16 (8c8c596); **STEPS 0, 1, 2 DONE** (457 -> 501 tests)

`docs/plans/m3-tasks.md`, from `plan-template.md`. CLAUDE.md's "current work plan" pointer now names it
(was still M1). **The pipeline model now EXISTS** (see the steps 1-2 block at the end of this section).
Non-obvious things the planning turned up — these are the reasons the plan is shaped as it is, not
restatements of it:

- **INV-8 is structurally blind to timing** (advisor's decisive catch). Conformance compares only final
  architectural state, so a pipeline that OVER-stalls (e.g. ignores `forwarding:true`, interlocks on
  every RAW) is **correct-by-INV-8 and silently wrong**. Under-forwarding gets caught (stale read ⇒ wrong
  answer); merely-slow does not. The forwarding toggle's whole observable effect lives in that blind spot
  ⇒ hand-derived cycle-accurate timing tests are their OWN build step (3), never an acceptance line on
  the model step. Mirrors how M2 pinned its per-class cycle-count table.
- **Step 0 was forced, not optional — ✅ DONE 2026-07-16 (440 → 457 tests).** `runToHalt` hardcoded
  `defaultConfig()` and self-documented as "config-agnostic on purpose" (right for two config-blind
  models); left alone it would have proven the pipeline correct **only with forwarding off**.
  `runConformance` now takes an optional third arg (readonly `ProcessorConfig[]`, default
  `[defaultConfig()]` ⇒ both existing `differential.test.ts` files byte-for-byte untouched) and runs the
  corpus once per config, labelling the `it()` title only when there's >1. **The transferable lesson is
  about how the harness was made testable:** the two things that could silently go vacuous were extracted
  as directly-assertable units — `checkProgram(makeProcessor, config, file)` (throws; the per-pair check)
  and `conformanceCases(configs)` (pure data; the matrix enumeration) — both exported from the module but
  NOT from `index.ts`, so models still see only `runConformance`. Non-vacuity needed **three** claims by
  three different means, and each one was found by asking "what bug survives the checks I have?":
  (1) a **reference-backed stub** (delegates to the golden reference ⇒ correct by construction, then
  corrupts a register in one `forwarding` position) passes `checkProgram` under off and throws
  `AssertionError` under on — the _passing_ half is load-bearing, it's what makes the failing half
  attributable to the perturbation and not to an incidental crash; (2) an **inverted** stub (correct only
  with forwarding ON) driven through the PUBLIC entry point with `[FORWARDING_ON]` — claim 1 bypasses
  `runConformance`, so it couldn't see a loop that iterated configs while passing `defaultConfig()` to
  every check; (3) `conformanceCases([OFF, ON])` yields 2× the corpus with distinct labels — claims 1
  and 2 both run under ONE config, so neither covers the multi-config path, and a "only ever runs
  `configs[0]`" bug would pass everything and make step 2's two-position suite read as if it proved both.
  **Every guard mutation-checked, not just observed green** (each mutation was applied, the failure
  observed, then reverted). Note the stub is program-agnostic by rebuilding its input from the
  `ProgramImage` given to `reset` — sound because the reference reads only `words`/`data`, never
  `symbols`. Also: a prettier gotcha in the plan docs — an **inline code span broken across lines** makes
  `prettier --write` non-idempotent (it oscillates on the indent), so keep backtick spans on one line.
- **Halt-with-drain is an INV-8 trap — and the plan's FIRST answer was WRONG (corrected 2026-07-16 in the
  step-1 decisions review).** The original pin ("stop fetching at `ecall` decode, drain, halt at retire")
  rested on "in every corpus program `ecall` is LAST, so the shadow is post-`.text` garbage." **Both halves
  are false, verified against the corpus:** `add.s` has **no `ecall` at all** (halts by running off the end
  of `.text` — an entirely unhandled SECOND halt path), and `call-return.s`'s `ecall` shadow is the **real
  `max:` function** (`bge`/`mv a0,a1`/`ret`), not garbage — live code that would genuinely execute. **The
  hazard the ecall squash removes is a COMMITTED SIDE EFFECT, not a PC redirect** (a redirect only moves
  the microarchitectural fetch pointer and can never reach `MachineState.pc` under the retire-pc rule);
  the real risk is a shadow **store**, which sits in MEM the same cycle `ecall` sits in WB — so whether it
  corrupts memory would hinge on intra-cycle stage ordering. Squash at `ecall`-decode instead of resting
  architectural state on that accident. **The
  pinned rule is now one rule copied from multi-cycle's retire arm: architectural `pc` is the RETIRING
  instruction's `nextPc`, never the fetch pointer** (halt ⇒ pc frozen at the halting instruction's own pc;
  else pc = nextPc, halting if that leaves `.text`). Fetch stops for two reasons — `ecall`-in-ID or the
  fetch pointer leaving `.text` — and **stop-fetching ≠ halt** (halting when fetch leaves text truncates
  `add.s`, whose last 3 instructions are still in flight). Load-bearing because `expectEquivalent` asserts
  `model.pc === reference.pc` as a deliberate strengthening beyond INV-8, and its own comment names `add.s`
  as where a mismatch surfaces first.
- **STEP-1 DECISIONS REVIEWED & PINNED 2026-07-16, before any code** (see the `m3-tasks.md` table). Eleven
  stood as seeded; the halt row was rewritten (above); the branch row gained **`jalr` resolves in EX too**
  (a register supplies its TARGET ADDRESS, not just taken/not-taken — `call-return.s`'s `ret`). **NB
  branches are RAW consumers too** (they read rs1/rs2 to compare) — `sum-loop.s`'s `bnez t0, loop` reads
  the `t0` its immediately-preceding `addi t0,t0,-1` writes: a **distance-1 branch-operand RAW, 10× per
  run, in the hottest corpus loop**, and one of the first things step 3's timing tests will measure. Both
  resolve in EX ⇒ same EX-targeted forwarding paths, no special case. And **one decision the table was
  missing entirely** was added: **intra-cycle stage & event order
  — process stages in REVERSE each cycle** (WB→MEM→EX→ID→IF) so each stage reads the latch its upstream
  neighbour hasn't yet overwritten. That makes the same-cycle WB→ID rule need no special case AND fixes the
  order of `events[]` within a cycle — a trace-contract surface (INV-3/INV-6), not an implementation
  detail. M1/M2 never faced it (one instruction, one stage per cycle) ⇒ M3 is the first model where
  intra-cycle ordering exists. Also pinned in step 1: **every instruction traverses all 5 stages** (unlike
  M2's variable opcode-dependent `phasesFor` — a `sw` idles through WB rather than skipping it).
- **M2's step 5c is NOT an M3 prerequisite and M3 doesn't reopen it.** M2's datapath omitted the ALUOut→PC
  redirect because the engine emits no event for PC arithmetic. The pipeline doesn't inherit that: a taken
  branch emits `branch-resolved` + `flush` — honest trace signals the datapath can light the redirect from.
  (Seeded decision: extend `branch-resolved` with `target: number` so the redirect wire can be labelled —
  INV-3 says extend the schema, don't open a back door.)
- **Corpus needs nothing new — verified, not assumed.** `array-sum.s` already holds the textbook load-use
  pair (`lw t2, 0(t0)` then `add a0, a0, t2`); every program has back-to-back RAW chains + taken branches.
  INV-7 intact.
- **Headline decision: the forwarding toggle ships in MVP, both positions correct day one** — it IS the
  spec's flagship interaction (§12.2) and can't be retrofitted (whether a hazard resolves by forward or
  stall is the hazard unit itself). Deferred to M4: configurable branch prediction + caches.
- Seeded pins that fork the hazard logic: same-cycle WB→ID (write 1st half / read 2nd half, P&H);
  EX/MEM→EX + MEM/WB→EX with **EX/MEM winning** a double match, never to/from `x0`; **load-use stalls 1
  cycle even with forwarding ON** (the bubble that can't be forwarded away — the pedagogical centerpiece);
  branch resolved in **EX**, fixed predict-not-taken, 2-cycle flush; **split I/D memory** (diverges from
  M2's single shared memory ⇒ own geometry, no reuse).
- New-for-M3 view work: datapath activation becomes **multi-instruction** (5 stages, 5 different
  instructions, one cycle — a first); forwarding/hazard units are the best-yet `minTier` structural-hiding
  case AND are **absent (not dimmed) when `forwarding:false`** — structure driven by CONFIG as well as
  tier, lawful because the trace genuinely has no `forward` events then. Pipeline map (stage×cycle HTML
  grid) + renderer deltas 1–4 come from `docs/plans/superscalar-visuals.md` by reference — build
  **stage-and-lane-parametric**, don't re-derive. See [[future-microarchitectures]]: the map is the ONLY M3
  deliverable a future deeper pipeline reuses as-is, so it's the only place generality is worth buying —
  everything else stays concrete because each microarchitecture is its own package.

### M3 STEPS 1 + 2 — THE PIPELINE MODEL — DONE & pushed (2026-07-16, 457 -> 501 tests, 5 commits)

`@cpu-viz/engine-pipeline` (`PipelineProcessor`, `<- isa, trace`). Every seeded step-1 decision survived
contact with the code; building it forced **twelve more**, all pinned in the m3-tasks table. What is worth
carrying forward and is NOT re-derivable from the plan or the diff:

- **The one architectural idea: the four latches are DOUBLE-BUFFERED.** Each stage reads `prev` (the
  pre-clock-edge values) and writes a fresh `next`, committed at the end. That is what makes BOTH forward
  paths correct — EX reading `prev.exMem`/`prev.memWb` reads exactly the two inputs of P&H's forwarding
  mux. **Consequence the plan got subtly wrong:** the pinned REVERSE stage walk is _not_ what makes
  forwarding correct (with `prev` reads it holds in any order). It earns its keep for three OTHER things:
  the same-cycle WB->ID read (the register file is the one piece of state that is _not_ double-buffered),
  the intra-cycle `events[]` order, and control-signal propagation (ID stalls -> IF holds; EX flushes ->
  ID/IF squash). Advisor's reframe; worth keeping because the naive worry ("reverse order clobbers MEM/WB
  before EX reads it") is only true under in-place single-buffer mutation.
- **A load's EX/MEM `writeValue` is `null`, and that null IS the load-use hazard.** A load in MEM has only
  its ADDRESS latched. So loads are unforwardable from EX/MEM by CONSTRUCTION rather than by a rule that
  could drift — and a defensive throw asserts the hazard unit and the forwarding network can't disagree.
- **The clock edge extends past the latches — found by hand-deriving a flush, NOT by any test.** The PC
  redirect (EX) and the fetch-stop (ID) must ALSO be staged and applied after the walk. First cut poked
  them mid-walk; since IF runs last it then fetched from the _redirected_ pointer, so a taken branch cut
  ONE row instead of two and an `ecall`'s shadow never existed to squash. **IF must fetch first and be
  squashed after** — the stage does its work every cycle; the flush kills the RESULT.
- **A stall holds the younger instruction IN the IF stage** (the repeated `IF IF` cell of the textbook
  diagram), never re-fetches it — re-fetching would mint a second id for one instruction (INV-4 violation)
  and emit a second `instr-fetch`. This is why the model needs an IF-stage occupant distinct from the
  IF/ID latch: five stages, four latches.
- **`flush` reports REAL CASUALTIES, and one that kills nobody emits no event** (documented in `schema.ts`,
  where consumers look). Reversed on advisor review before shipping: the first cut treated `stages` as
  "the latches the signal is asserted on, occupied or not", which is true of hardware and wrong for this
  trace — `flush` has three readers (datapath, the map's cut rows, and the **curriculum, which triggers on
  a bare `{event:'flush'}`**), and 3 of the 5 corpus programs end with `ecall` as the LAST instruction, so
  that reading would have let a lesson announce a bubble that never happened.
- **MEASURED, not argued — the milestone's thesis.** Mutating the hazard unit to ignore `forwarding:true`
  (an over-stalling pipeline) leaves INV-8 conformance **12/12 GREEN** and fails **10 unit tests**. The
  blind spot is real and total. **But the plan's sibling claim was FALSE and is now corrected:** breaking
  the _priority rule_ does NOT slip past conformance — `array-sum.s [forwarding on]` catches it, because
  **`la t3, total` expands to two instructions that both write `t3`**, immediately consumed by
  `sw a0, 0(t3)`. The corpus has had a double-match litmus all along, hiding inside a pseudo-op.
- **Corpus facts:** `add.s` is **7 cycles forwarding-on vs 9 off** with identical final state — the crown
  jewel is already visible on the SMALLEST corpus program, no new fixtures. And **`TEXT_BASE` is 0**, so
  `lw x2, 0(x0)` reads the program's own first instruction word, not an empty cell (this bit me: a test
  expecting 0 got 147 = `0x93` = `addi x1,x0,0`). Tests needing scratch memory must pick an address past
  the end of text.
- **A fifth DAG wiring point the plan's "all four places" list forgot:** the root `package.json`
  `workspaces` array. eslint + root tsconfig refs + vitest aliases + web tsconfig paths are only four.
- Step 2 was pulled in early (wired from the first compiling skeleton) rather than saved for its own step
  — cheapest gross-sequencing net available, and step 0 had already built it. Advisor's call; it was right.

### M3 STEP 3 — PINNED TIMING (the net for INV-8's blind spot) — DONE & pushed (2026-07-16, 501 -> 542)

`packages/engine/pipeline/src/timing.test.ts`, 41 tests, no engine change, no new fixtures (INV-7).
Commits `2c9e92c` (the suite) + `8fcd7c7` (crown-jewel memory union).

- **The transferable idea: pin a DERIVATION, not numbers.** "Hand-derived" is unachievable by
  cycle-counting a 10-iteration loop, so the pinned RULES were summed into a closed form first, and the
  corpus numbers fall out of it. With `d_i` = the cycle instruction i leaves ID (EX at d+1, WB at d+3;
  halt at the last retire so `cycles = d_last + 4`), the rules ARE the recurrence: `d_i >= d_(i-1)+1`;
  OFF `d_i >= d_p+3` per producer (+3 not +4 — the same-cycle WB->ID rule paying for itself); ON
  `d_i >= d_L+2` for a LOAD producer only; taken transfer `d_target >= d_b+3`. Summed:
  **`cycles = N + 4 + S + 2*T`** (N retires, S stall cycles, T taken transfers). **All 41 passed on the
  first run** — write the derivation down BEFORE the test file (worksheet: `M:\claud_projects\temp\`).
- **The thesis as arithmetic: N and T belong to the PROGRAM, S to the MICROARCHITECTURE** ⇒
  `cycles_off - cycles_on = S_off - S_on` exactly. Assert each term SEPARATELY against the events that
  define it (advisor: a lone total lets a compensating over-S/under-T pair pass and localizes nothing).
- **The pinned table:** add.s 9→7 (N3 T0 S 2/0) | array-sum.s 72→51 (N34 T4 S 26/5) | byte-loads.s 14→10
  (N6 T0 S 4/0) | **call-return.s 17→17 (N9 T2 S 0/0)** | sum-loop.s 78→56 (N34 T9 S 22/0).
- **Forwarding is NOT always faster — `call-return.s` is identical in both positions.** Every RAW in it is
  already separated by a flush gap, which charges the +2 the interlock would have. So the crown jewel is a
  claim about the FOUR RAW-chained programs, not the corpus; asserting it corpus-wide overclaims, and
  weakening to `<=` would pass for a pipeline where forwarding did nothing. Proof it matters: call-return
  is one of the two ON cases that **passes** under the over-stalling mutation.
- **The +2 is per taken TRANSFER, not per `flush` EVENT — they come apart.** `call-return.s`'s `ret` is the
  last word of `.text`: kills nobody, emits no flush (step 2's real-casualties rule), still costs 2 cycles
  (the target can't be fetched till the redirect lands). T=2 but branch-taken flushes=1. A penalty is not
  a casualty.
- **Stalls are NOT uniform per iteration** — so never assume a per-iteration cost, trace one. `sum-loop`
  OFF: iteration 1's `add` stalls 2 and **no later one does** (the taken branch's gap already retired its
  producers); only the `bne` stalls every time. S_off = 2 + 2*10, not 4*10.
- **Derive against the EXPANDED stream** (advisor's catch): `la` is ALWAYS 2 words (`lui`+`addi rd,rd`) = a
  distance-1 RAW invisible in the `.s` source — array-sum has two, byte-loads one. Also: byte-loads has two
  loads and NO load-use (the `lbu` reads the pointer t0, not the `lb`'s t1).
- **Placement is a pc->cycles histogram** (`{8:2, 16:20}`), not a count — count and placement then share
  one source of truth (S is summed from it) and a loop's recurring stall stays ONE hand-checkable entry.
  Keyed by pc, not cycle. This is the honest discharge of the plan's "which cycle": pc + stage + step 1's
  `walk()` shape, which is stronger and less brittle than literal cycle indices.
- **Mutation-checked BOTH ways** (the project's standing discipline): the over-stalling mutation leaves
  conformance **12/12 green** and fails **14 timing tests** — every `[forwarding on]` case, not one
  `[forwarding off]` case, so the failure is exactly attributable; and moving a stall to the wrong pc
  **with the total unchanged at 22** fails too, proving placement is pinned independently of count.
- A guard `it()` asserts the table covers every `.s` on disk: conformance auto-enumerates the corpus, but a
  new program would NOT get a timing entry automatically — fail loudly rather than silently stop covering.

### M3 STEP 4 — RECORDER / TIME-TRAVEL — DONE & pushed (2026-07-16, 542 -> 554, `abf9c4e`)

`packages/engine/pipeline/src/recorder.test.ts`, 12 tests, **zero production changes** ("free by
construction" survived contact — INV-3 paid for itself a third time).

- **The step's real work was SCOPE, not code.** Three of the four things its plan text asked for were
  ALREADY pinned at engine level by step 1 (the five-stage walk, the five-in-flight cycle, the per-cycle
  latch snapshot). Rebuilding them through a recorder wouldn't make them truer. So the file asserts only
  what the RECORDER layer can: the navigation criterion end-to-end, and **`follow()` — the shipped API the
  web calls** (step 1 proves the walk with a test-local `walk()` helper). "The acceptance criteria mention
  it" != "nothing pins it" — worth re-asking on every step.
- **The third blind spot, found by that scope review.** One walk shape was pinned NOWHERE: an instruction
  **held in IF** across a stall (`IF IF IF`, one id). The INV-4 test follows a never-stalling instruction;
  the stall tests follow the CONSUMER (whose repeated cell is `ID`). Nobody followed the instruction stuck
  BEHIND the interlock. Mutating IF to re-fetch mints **3 ids for 1 instruction** — and **conformance is
  12/12 green and every timing test passes**. So: step 3 established INV-8 is blind to TIMING; step 4 adds
  that INV-8 _and_ the timing suite are blind to **instruction IDENTITY** — the thing every downstream view
  is keyed on.
- **`micro` is pinned against the TIMELINE, not per-cycle:** the latches recorded at end of cycle `i` name
  exactly the instructions placed in ID/EX/MEM/WB at cycle `i+1`. Mutation-checked by snapshotting BEFORE
  the edge: exactly the two cross-check cases fail, nothing else — the specificity is the proof.
- **Two porting traps caught before the first run:** the pipelined `overwrite` program commits at cycles
  **4/5/6** (not M2's 3/7/11), and pre-run `micro` is a **non-null object with four null latches** (not
  M2's absent `micro`, so `expect(micro ?? null).toBeNull()` would fail). Never copy a neighbour's numbers.
