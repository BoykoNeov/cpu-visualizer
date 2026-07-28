---
name: m2-multi-cycle
description: 'M2 build log: the multi-cycle model (static per-opcode phase sets, 3-5 cycles), the web model picker, the bespoke multi-cycle datapath where minTier STRUCTURAL hiding + contraction wires first earn their keep, and steps 5C/5D/5E that closed its last stated omissions.'
metadata:
  node_type: memory
  type: project
  originSessionId: c09ed410-3ad2-44be-9942-c29fb034a441
  modified: 2026-07-28T07:52:04.368Z
---

\*\*M2 ALL STEPS BUILT (0–5b) & pushed (2026-07-13, 429 tests). Model (0–4) + web model picker (5a)

- bespoke multi-cycle datapath SVG (5b) all done; 5b is implemented + headlessly tested but its
  LAYOUT is not yet browser-verified (this project eyeballs web work via `npm run dev`). One
  deliberate simplification carved out as possible step 5c — see the 5b block below.**
  The **multi-cycle model\*\* (spec §12.1) is implemented and fully proven headlessly;
  `docs/plans/m2-tasks.md` has the live checklist + pinned decisions. What landed:

* **Step 0** — hoisted `toProgramImage` → new leaf **`@cpu-viz/engine-common`** (`← isa, assembler,
trace`); both engines share it; single-cycle production no longer imports the assembler.
* **Step 1** — extracted the INV-8 harness → test-only **`@cpu-viz/engine-conformance`**:
  `runConformance(modelName, () => Processor)` owns the corpus + `expectEquivalent` + the
  model-independent `RESULT_ORACLES`, imports no engine-under-test. Single-cycle's differential
  suite shrank to one call.
* **Step 2** — **`@cpu-viz/engine-multi-cycle`** (`MultiCycleProcessor`, `← isa, trace`). One
  instruction in flight; each `step()` advances ONE phase (IF/ID/EX/MEM/WB) with a stable id
  (INV-4) and per-cycle `micro` latches. **Phase set is STATIC per opcode class** (not runtime):
  IF+ID universal; EX iff main ALU used; MEM iff memory touched; WB iff a reg is written. So
  **load=5, R-type/I-ALU/jalr=4, store=4, branch=3, jal/lui/auipc=3 (no EX — they emit no alu-op,
  echoing M1), ecall/ebreak/fence/unknown=2** — the §12.1 varying-cycle-counts headline. Effect
  plan computed eagerly at fetch but **committed at the natural phase** (mem@MEM, reg@WB,
  pc/halt@retire) so per-cycle snapshots read right; jalr target uses pre-write rs1 (rd==rs1 safe).
  ISA idioms copied VERBATIM from the reference (NOT imported — eslint-enforced). `micro =
{phase, ir, a, b, aluOut, mdr}` (exported `MultiCycleMicro`), independent per-cycle snapshot.
  **38 hand-derived unit tests are the real verification** (differential only checks final state).
* **Step 3** — 3-line differential test via the shared harness: multi-cycle ≡ reference on all 5
  corpus programs (INV-8), proving "varying cycle counts, identical final state."
* **Step 4** — recorder time-travel integration + first REAL INV-4 payoff: `follow(id)` returns a
  load's full IF→ID→EX→MEM→WB walk across its cycles (the model-agnostic `TraceRecorder` needed
  zero change).
* **DAG/eslint:** cross-model isolation rules added (each model imports no other model's production
  code; multi-cycle also may not import the reference). Flat-config gotcha handled throughout:
  last-match-wins per rule id means each specific `files:` override must REPEAT the generic
  curriculum/web guard (superset) — closed a latent gap in the old `reference/**` rule too.

**Step 5a — WEB MODEL PICKER — DONE (2026-07-13, commit `feat(web): model picker`).** A **Model**
`<select>` (single-cycle | multi-cycle) in the header. Mechanism is one substitution (INV-3):
`packages/web/src/models.ts` = the model registry (`{id, label, description, make, hasDatapath}`);
`loadSource(source, makeProcessor = () => new SingleCycleProcessor())` takes an engine factory
(default keeps every one-arg caller — e.g. `simulator.test.ts`/`lessons.test.ts` — working);
`useSimulator` holds `model` in **state** (for rendering) + the factory in a **ref** so `loadInto`
reads it at call time WITHOUT `model` entering `select`'s dep chain (else the mount effect refires
and clobbers the loaded program — the load-bearing React idiom here). `setModel(id)` swaps the ref
and re-loads `loaded.current.source` under the new engine, keeping the session/lesson and parking
the cursor at pre-run (no in-place engine swap in a recorder). The transport/register/memory/source
panels, scrub, lessons, and sandbox-fork all work **unchanged**. The single-cycle SVG datapath is
gated **hard off** for models without `hasDatapath` — lighting its single-cycle geometry with a
multi-cycle trace would draw a CONTRADICTORY picture (INV-5), so multi-cycle shows a placeholder
pointing at 5b (advisor flagged this as correctness, not cosmetics). Two non-vacuous test additions:
`simulator.test.ts` proves the swap is REAL (multi-cycle records strictly MORE cycles than
single-cycle for the same program, both land a0=55, INV-8); `lessons.test.ts` proves **INV-6
cross-model** — every authored lesson still anchors, in order, with resolvable narration, against
the multi-cycle recording (events not cycles ⇒ the model swap strands no step; confirmed it fully
works, not just degrades gracefully). Wiring: engine-multi-cycle added to web `package.json` +
`tsconfig.json` paths + `vite.config.ts` alias (web is `noEmit`+`paths`, no project `references`;
no web eslint allowlist since web is top-of-DAG). Also a small `chore(format)` commit reflowed
`m1-tasks.md` so CI `format:check` is green.

**Step 5b — BESPOKE MULTI-CYCLE DATAPATH SVG — BUILT (2026-07-13, 429 tests; layout browser-verify
pending).** New `packages/web/src/datapath-multi.ts` (pure geometry + phase-driven `activate`) +
`MultiCycleDatapathView.tsx` (SVG), mirroring M1's `datapath.ts`/`DatapathView.tsx` split. 14 nodes:
the **five inter-cycle latches** IR/A/B/ALUOut/MDR drawn as boxes (1:1 with `micro`), the **shared
Memory** (fetch@IF, data@MEM, via an IorD address mux) and **shared ALU**, `regfile`, `signext`, and
a small dedicated `pcarith`. Key differences from single-cycle, all load-bearing:

- **Activation is PHASE-DRIVEN.** Each multi-cycle `CycleTrace` is ONE phase (`instructions[0].location`),
  so `activate` lights only that cycle's slice — values from the phase's events, latch values from
  `state.micro` (cast from `MachineState.micro: unknown`). **No view-local phase stepper** (single-cycle
  had one because all 5 phases happen in one tick); scrubbing the transport IS the phase walk, and a
  read-only phase badge shows the current phase.
- **`minTier` STRUCTURAL hiding finally earns its keep** (M1 kept it wired-but-unused). Three genuine
  selector muxes — `addrmux`(IorD), `alusrcb`(ALUSrc), `wbmux`(MemtoReg) — set `minTier:'detailed'`,
  hidden at `essentials`. To keep the no-dangling litmus, each hidden mux is replaced at essentials by
  a **contraction wire** (e.g. `pc→mem` for `pc→addrmux→mem`). Wires gained `minTier`/`maxTier` RANGES:
  through-mux wires are `minTier:'detailed'`, contraction wires `maxTier:'essentials'` + a `contracts:<mux>`
  tag. `wireVisibleAt` generalizes M1's litmus **per tier** (in-range AND both ends visible at that tier).
  The five latches + shared mem/ALU + `signext` stay drawn at EVERY tier (they ARE the story — advisor
  explicitly endorsed keeping `signext` visible rather than tiering it, which would force a misleading
  `ir→alu` contraction). Representation tiers (values@detailed, control labels@expert) apply as in M1.
- **INV-5 lawfulness gate:** a contraction `S→T` must equal the expert path `S→mux→T` (same source, same
  sink) — checked by a test that finds the two through-wires. This is _the_ acceptance condition.
- **Dispatch:** `ModelChoice.hasDatapath:boolean` → `ModelChoice.datapath:'single-cycle'|'multi-cycle'|'none'`;
  `App` renders `<Datapath>` / `<MultiCycleDatapath>` / placeholder accordingly (placeholder now only backs
  `'none'`).
- **~~DELIBERATE SIMPLIFICATION → possible step 5c~~ — DONE 2026-07-20, see the STEP 5C block at the
  end of this file.** (Was: the datapath does NOT draw the next-PC redirect, because the engine emitted
  no `alu-op` for PC arithmetic and a textbook ALU-based PC path would CONTRADICT the trace.)
- **Tests** (`datapath-multi.test.ts`, 16): per-phase activation for load/branch/store/lui/jal driving the
  REAL `MultiCycleProcessor` via the recorder; per-tier no-dangling; mux-hiding; contraction↔through swap;
  lawful-contraction guard; **node-bounds + no-overlap layout guards** (the only automatable slice of
  visual acceptance — legibility/wire-crossings still need `npm run dev`).

**~~Only remaining M2 loose ends~~ — BOTH CLOSED 2026-07-20 by step 5c** (the 5b layout was
browser-verified in the same session and had no defect).

**STEP 5C — M2's last open item, DONE 2026-07-20 (1352 tests, commit `86382a5`). M2 IS NOW FULLY
COMPLETE with no deferred work.** "Draw the next-PC redirect", which had been deferred since
2026-07-13. Findings worth keeping:

- **"5c" named TWO different jobs, and the fork had to go to the user.** A cheap VIEW-only version
  (draw `pcarith`'s wires + jalr's ALREADY-EXISTING ALUOut→PC — jalr has an EX today, its target is
  in the trace, merely undrawn) vs the ENGINE version the plan doc defined. User picked the engine
  version. **Always surface this fork before editing** — the payoff of the expensive version is a
  view improvement on a layout that had never been browser-verified.
- **INV-7 does NOT block per-model event-stream divergence.** INV-7 is one ISA / one assembler /
  one program library — nothing more. Models are SUPPOSED to differ in events (single-cycle emits
  no stall/flush; the pipeline does). INV-8 pins only final architectural state, so a cycle-count
  change keeps the differential green BY CONSTRUCTION. The m2 plan's "(INV-7)" citation for
  cross-model `alu-op` consistency was a **loose hang** — the real value there was pedagogical
  least-surprise. Don't treat a cited invariant as a gate without re-reading it.
- **The pinned table moved by exactly two rows: `jal` 3→4, `auipc` 3→4** (they gain EX). `lui`
  stays 3 and is now **alone** in the IF/ID/WB class; `jalr` stays 4; branches stay 3. The
  generating rule never changed — what changed is WHICH instructions use the main ALU.
- **The load-bearing line: `pc+4` deliberately does NOT go through the ALU.** A dedicated PC+4
  incrementer supplies the sequential PC and the jump link. P&H's multi-cycle FSM computes `pc+4`
  in the ALU during IF; copying that would add an `alu-op` to EVERY instruction's IF and buy
  nothing. Resolving this ambiguity BEFORE coding is what kept the blast radius at 4 test edits.
- **THE COST NOBODY PREDICTED: the view needed a 4th mux (ALUSrcA).** The multi-cycle datapath had
  only 3 (IorD/ALUSrc/MemtoReg) and the ALU's A operand was hardwired to the A latch. Once the
  trace says the ALU computed `(pc, imm)`, **INV-3 REQUIRES PC to visibly reach the ALU** or the
  picture contradicts the trace — the exact defect 5c set out to fix. So it's forced, not polish
  (and is textbook-canonical). **Generalize: "make the engine emit event X so the view can draw
  it" routinely forces new VIEW structure too — budget for both halves.** `jalr` needed no mux
  (its A operand genuinely is `Reg[rs1]`), which let the redirect wire land and be validated
  independently of the mux.
- Other engine→view knock-ons, all easy to miss: `aluBIsImm` was `format === I|S` and had to gain
  J/U or jal/auipc silently read the **B latch**; `auipc` moved from the `pcarith` branch to the
  `aluout` branch at WB; `pcarith` lost its immediate input and shrank to a pure incrementer.
- **The redirect must sit OUTSIDE the `regWrite` guard.** `jal x0` / `jalr x0` (i.e. `ret`!)
  write no register, and that is exactly when the redirect is the jump's ONLY visible effect.
- **Browser: PASSED CLEAN — only the 2nd view step ever to do so here** (step 5 was the 1st), and
  it also discharged 5b's long-outstanding layout verification. `ret`'s WB lighting the redirect
  as the diagram's sole wire is the single best demonstration of what 5c bought.
- **Browser-driving gotchas (this app):** the page's SOURCE text trips a tool content filter — read
  programs from `content/programs/*.s` on disk instead. Wires carry **no ids in the DOM**; identify
  them by their `points` geometry (the redirect is the only wire on the `y=460` rail). Setting the
  scrub `input[type=range]` via the native value setter **times out CDP and queues up stale
  states**; a plain synchronous `for(...) stepBtn.click()` with NO awaits is reliable.
- **Repeat of a known trap, cost ~1 tool call:** used PowerShell here-string `@'...'@` inside the
  **Bash** tool for a commit message → a literal `@` line at both ends of the message; fixed by
  `--amend --file=- <<'EOF'`. Bash tool = POSIX heredoc, PowerShell tool = here-string.
- **THE NEAR-MISS WORTH REMEMBERING — adding events to a model can silently SHIFT LESSON `nth`
  ANCHORS.** 5c added `alu-op`s to jal/auipc, and INV-6 anchors are `{event, nth}`. An anchor that
  shifts to a **wrong-but-existing** event still passes `lessons.test.ts` (it only fails when an
  anchor finds NOTHING) and is wrong only in the browser — precisely the 9-of-10 defect shape.
  **Ruled out here, and the check is the reusable part:** `grep '"model"' content/lessons/*.json`
  → all 11 lessons are single-cycle (6) or pipeline (5), **ZERO multi-cycle**, so nothing could
  shift. (`function-call`, the jal/jalr lesson, is single-cycle.) **Run this grep any time you add
  or reorder events in ANY model** — and note the standing implication: multi-cycle currently has
  no lesson coverage at all, so its event stream is only ever exercised by Free Play.

**STEP 5D — the taken-branch redirect, DONE 2026-07-20 (1354 tests, commits `56ec9de`/`152a54d`).**
The last stated INV-5 omission on the multi-cycle datapath, closed the same day 5c shipped.
Findings worth keeping:

- **5d was VIEW-ONLY where 5c needed an engine change — and that asymmetry is the lesson.** 5c had
  to change the engine first because the trace carried no `alu-op` for PC arithmetic. 5d needed
  nothing: `inst.pc` and `decoded.imm` were already in the trace, so "draw what the trace says"
  cost only routing. **Before assuming a drawing gap needs an engine change, check whether the
  trace already carries the inputs** — deriving a value from two trace fields is lawful under
  INV-3 (which forbids reading engine INTERNALS, not arithmetic on trace values).
- **The stated-omission discipline paid off, concretely.** The 5c header comment named the missing
  component precisely ("its target is `pc+imm`, not in ALUOut, so it needs a separate branch
  adder"). Closing it was then a contained step, not a re-derivation. **Worth doing again: when
  you omit something lawfully, name the exact missing component, not just the missing behavior.**
- **A shared ALU can't do double duty: a branch's ALU holds the COMPARE result (`taken?1:0`), never
  the target.** That's the whole reason textbook datapaths carry TWO adders. The fix was
  `branchadd` (`pc + imm` from PC + sign-extender) — real hardware, not a drawing convenience.
- **The redirect rule generalized to "the next-PC wire lights at RETIRE"**: WB for the jumps (they
  write a link), **EX for a branch** (its last phase — branches are IF/ID/EX, no MEM/WB).
- **Taken-ness is READ from the trace, not recomputed**: the compare's own `alu-op` result IS the
  condition. Gated inside `if (aluOp)` on `format === 'B' && result === 1`.
- **Drawn at EVERY tier — the structural asymmetry with 5c.** The adder is DATAFLOW, not a
  selector, so it needs no contraction-wire machinery (unlike 5c's 4th mux). Only muxes get the
  minTier/contraction treatment. It did break `DatapathDiagram.test.tsx`'s `<polygon>` count
  (2→3 essentials, 6→7 detailed) — that count is the tripwire for any new mux/adder.
- **THE BINDING LAYOUT CONSTRAINT on this diagram is the 0.5px collinearity test**, not the canvas
  or the box-overlap test. PC's top AND bottom edges were already fully spoken for (pc+4 riser,
  ALUSrcA riser, the `aluout→pc` bottom rail), so the new redirect had to use the only free routes
  left: the **`y=32` top rail and the empty `x=14` left margin**. Bonus, and it reads better: it
  enters PC on the OPPOSITE side from the jumps' redirect, so the two sources look like two
  sources. **Compute rails against existing segments before writing coordinates; then let the test
  confirm rather than eyeballing.**
- **Browser: PASSED CLEAN — the 3rd view step ever to do so here.** Taken `bne` (sum-loop cycle 18):
  PC → branch adder → PC labelled `0x10 + (-8) = 0x08`, `aluout→pc` dark. Loop-exit `bne`
  (cycle 117): compare only, adder dark. The contrast between those two cycles IS the pedagogy.
- **Remaining stated omission shrank to the undrawn PCSource mux** — CLOSED BY 5e, below.
- **Bash tool ≠ PowerShell here-strings.** `git commit -m @'...'@` in the Bash tool leaked a literal
  `@` into the subject line. Bash tool = POSIX heredoc (`-F - <<'EOF'`), PowerShell tool = `@'...'@`.
  (Same trap recorded under 5c, hit again — reach for `-F - <<'EOF'` by default.)

## STEP 5E — the PCSource mux (2026-07-20, 1357 tests). M2 now has NO stated omissions left.

- **THE LESSON: a stated omission that names a missing SELECTOR can quietly understate itself.**
  The 5c/5d header said "PC has three drivers, no PCSource mux drawn". Going to draw the mux
  surfaced that one of the three drivers it named — the **sequential `pcarith → pc`** — had no
  wire either. `pcarith` fed only the writeback mux (the jal/jalr link), so "PC ← PC+4", the
  thing EVERY instruction does, had never been drawn in this diagram. **When closing a
  stated-omission note about a selector, check that every input it would select is itself drawn.**
- **A 2-input mux would have been the same lie in a smaller box.** A selector whose commonest
  input never lights is worse than no selector. Closing the sequential loop was the heart of the
  step, not scope creep.
- **View-only, like 5d** — `pc + 4` derives from the trace's own `pc` (RV32I fixed-width), so
  INV-8 is untouched by construction. Lighting rule = 5d's generalized once more: the sequential
  arm lights **at retire**, which is WB for most, **MEM for a store, EX for a not-taken branch**.
- **The mux could NOT go where the textbook puts it.** PC sits 28px from the canvas edge and a mux
  takes inputs on its left VERTICAL edge, so directly-left leaves no room for three separated feed
  rails (collinearity test, 0.5px eps, is this diagram's binding constraint — same as 5d). It went
  **below-left** of PC at `(90,330,22,100)`, the one spot all three sources reach a left edge on
  separated rails: `pcarith` x=82, `aluout` x=70, `branchadd` x=14. The three essentials
  contractions land on three DIFFERENT PC edges (left mid, left+12, bottom) so they never merge.
- **One test had to be RE-EXPRESSED, not suppressed** — and this is the reusable move. `auipc`
  asserted `pcarith` was dark: a 5c-era proxy for "auipc's writeback comes from ALUOut". 5e breaks
  it _correctly_ (auipc's next PC genuinely is pc+4, so the incrementer IS lit). Fix = assert the
  real intent (`pcarith-wbmux` absent). Special-casing auipc out of the sequential rule would have
  been the lie sneaking back in. **When a new truth breaks an old proxy assertion, re-express the
  assertion's intent; don't carve an exception into the new rule.**
- **THE REAL DEFECT WAS FOUND BY NEITHER TESTS NOR THE BROWSER — but by noticing an UNVERIFIED
  CLAIM in a header comment.** First cut keyed the sequential arm off `instr-retire` alone. But
  the multi-cycle engine pushes `instr-retire` **unconditionally** at the last phase, and on an
  architectural halt (`ecall`/`ebreak`/unknown) it then leaves `pc` PARKED
  (`processor.ts`: `if (cur.plan.halt) { this.halted = true } else { this.pc = cur.plan.nextPc }`).
  So `ecall` would have drawn `PC ← pc+4` while the trace said PC never moved — the view
  CONTRADICTING the engine (INV-5 violation), not the lawful omission it resembles. **And the
  header comment had RATIONALIZED it** ("the machine stops for reasons outside this diagram").
  Fix: key the arm off the trace's committed **`state.pc`**, not a computed `pc + 4` — strictly
  better, it's the real next PC instead of a guess that's merely right for every non-halting case.
  `fence` falls through and lights; `ecall` doesn't and stays dark. **RULE: if a header comment
  asserts behaviour for a case, that case must actually have been OBSERVED — a claim with a
  rationalization attached is the shape a bug hides in.** (The browser had looked only at ecall's
  FETCH, one cycle before its retire — right instruction, wrong cycle.)
- **`instr-retire` ≠ "pc advanced"** on this engine. Any future view keying off retire must check
  `state.pc`, not assume fall-through.
- **Browser: passed clean on all the arms it was pointed at** (2nd view step here after 5c to find
  no LAYOUT defect — but see the halt defect above, which layout verification could not catch).
  Verified all
  three arms + both tiers: `addi` WB shows `pc → pcarith → pcsource → pc` (`0x0 → 0x4`); `jal` WB
  shows link-out-via-MemtoReg AND target `0x18` through PCSource with the sequential arm dark;
  taken `bne` (cycle 18) shows the branch-adder arm → `0x08`; fetch leaves the mux dark;
  essentials collapses all five muxes and gives PC three visually distinct arrows.
- **Also bumped:** `DatapathDiagram.test.tsx` polygon counts (3 adders at essentials; 8 at
  detailed = 3 adders + 5 muxes) and the tier test's `MUXES` list, which had silently been missing
  `alusrca` since 5c — add new muxes to that list or they go untested.

See [[workflow-rituals]] for how batches/sessions end. Deeper µarchs remain a
don't-foreclose flag ([[future-microarchitectures]]).
