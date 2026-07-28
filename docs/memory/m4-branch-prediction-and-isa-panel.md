---
name: m4-branch-prediction-and-isa-panel
description: "M4 build log: branch prediction (the user's fork choice after M3) - engine steps 0-3, the flagship lesson that completed it - plus the ISA reference panel, the first surface in the app about the LANGUAGE rather than the machine."
metadata:
  node_type: memory
  type: project
---

## M4 — STEPS 0–3 DONE, THE ENGINE IS COMPLETE (2026-07-16, `475a611..27f0ce2`, 685 → **746 tests**)

The fork after M3 was put to the user: M4-prediction / M4-caches / M2's deferred 5c. **User chose
branch prediction first.** Caches split into their own milestone — §12 warns cache behavior only
shows with array-walking programs, so caches carry a corpus prerequisite prediction does not.
**Next: steps 4–7 (web toggle → datapath → map → lesson), all browser work.**

### What building forced (the plan's own predictions, scored)

- **The step-1 title was WRONG, and correcting it is the finding: three scheme NAMES, two
  BEHAVIORS.** `'none'` ≡ `'static-not-taken'` — a processor with no predictor doesn't wait, it
  keeps fetching, and **the fall-through IS the not-taken path**. The plan seeded the opposite
  (stall-on-branch); it missed that **`'none'` is `defaultConfig()`**, so a third behavior would
  have silently redefined the default pipeline and moved every M3 timing pin. **Measured:**
  honoring the knob failed **exactly one test in the whole suite** (the capabilities flag). Also
  dissolved the `predicted:boolean` honesty question — nobody stalls, so `false` is never a lie.
  Two seeded decisions resolved together, one reversed.
- **The central reframe: EX squashes on MISPREDICTION, not on TAKEN.** `if (taken)` was only ever
  predict-not-taken's spelling of `if (predicted !== taken)`. `nextPc` corrects both directions
  with no branch on which way we were wrong.
- **Step 0's proof bought a smaller field.** The latch carries `predictedTaken: boolean`, not a
  target — since `speculativeTarget` provably equals EX's `nextPc`, "we both say taken" implies
  "we both mean the same address". **`jalr` needed no special case anywhere**: never predictable ⇒
  always mispredicts ⇒ the `call-return` regression is mechanical, not coded.
- **The bet is NOT `ctx.squash`** — it kills ONE (the fall-through), a squash kills TWO (ID+IF).
  That difference IS the payoff. And **a CORRECT prediction still emits a flush** (the discarded
  fall-through is the "1"); mutation proved the casualty pin is its **only** net — killing the
  event fails 1 test and leaves timing untouched.
- **`flush.reason` grew by exactly one word** (`'branch-not-taken'`), because under static-taken a
  correction can fire on a branch that was NOT taken and `'branch-taken'` would state the opposite.
- **The precedence bug was structural** (EX runs before ID; `stageId` already early-returns on
  squash) but pinned anyway — reachable only via a `jalr` (places no bet ⇒ ID stays occupied) with
  a branch behind it. **The net that would catch it doesn't contain the case that triggers it**:
  conformance _would_ see `x4=99`, but the corpus has no branch behind a `jalr`.
- **`2·T` was never a rule — it was the static-not-taken INSTANCE.** The general form is ONE
  per-transfer rule (**2 mispredicted / 1 correct-taken / 0 correct-not-taken**); the scheme only
  decides `predicted`. Smaller than the plan's three formulas. Nothing M3 pinned was wrong — it was
  _specific, in a place that read as general_.
- **The thesis is MEASURED and it's the sharper mirror of M3 step 3.** There, forwarding turned out
  not-always-faster (`call-return` 17 both). Here the same program gets **WORSE: 17 → 18** under
  static-taken (its three transfers are one of each kind — `jal` 2→1, never-taken `bge` 0→2, `ret`
  unpredictable stays 2). Asserted as **signed per-program deltas** (−7 / −2 / **+1**), never an
  average — the average is what would let the loss hide. **Every number right first run.**
- **Blind spot re-measured:** a pipeline ignoring `branchPrediction` leaves conformance **32/32
  green**, fails 10 timing + 4 soul tests. Same shape as M3's forwarding measurement.
- **Casualties ARE the penalty** (a killed instruction = a wasted fetch slot = a cycle): `sum-loop`
  18 → **11**, exactly `P`. Step 6 inherits the number instead of inventing it.
- **Two defects only the eyeball caught, both in the harness, not the engine.** (1) Six configs
  produced **two labels** — `configLabel` named `forwarding` alone, so three schemes all read
  `[forwarding off]`; **the harness's own distinctness guard never noticed because every claim in
  it was handed the two-forwarding list** — _a guard whose case list cannot reach the collision is
  not a guard_, the exact M3-step-0 vacuity reappearing **in the guard rather than the guarded**.
  Fixed by **deriving** (name the knobs that VARY) so M3's titles return byte-identical. (2) Step
  0's `>>> 0` is **invisible to the corpus** — deleting it failed nothing, because every corpus
  address is small AND the agreement test is blind since **EX normalizes too** (both wrong
  together, still matching). Fixed with a direct case, not by softening the comment.

### The plan's other non-obvious calls (still standing)

- **`static-taken` IS the MVP** — the inverse of ship-cheap-first. Confirmed harder than seeded:
  `static-not-taken` isn't merely "a rename", it's literally `defaultConfig()`'s existing behavior.
- **M4 forces back what M3 declined** (4th time): predicting _taken_ needs a **target**, earliest
  computable in **ID** ⇒ restore the classification `processor.ts:175` refused + a **second
  redirect point** (ID _bet_ vs EX _correction_) ⇒ a correct prediction costs **1, not 0** (0 needs
  a BTB → deferred).
- The penalty model **reproduced a pinned number before any code**: 18 casualties = 9 taken × 2.
- Prediction is **INV-8-invisible** ⇒ conformance green first-run _is_ the safety proof.
- Still open: whether the **ID bet needs its own trace event** (pressure is off — it already
  surfaces as `flush{reason:'branch-predicted-taken', stages:['IF']}`; step 5 should try to draw
  from that + `branch-resolved.predicted` first).

### Original plan rationale

- **`static-taken` IS the MVP** — the inverse of ship-the-cheap-version-first. `static-not-taken` is
  the behavior the machine already has, so honoring it as config is a **rename, not a toggle**; the
  entire flagship payoff lives in the one mode that also carries the whole structural cost. A
  not-taken-only MVP would forfeit the rationale that picked prediction over caches and 5c.
- **M4 forces back what M3 declined** (the recurring beat, 4th time): predicting _taken_ needs a
  **target**, the earliest a PC-relative target exists is **ID** ⇒ M4 must restore the branch
  classification `processor.ts:175` deliberately refused, and add a **second redirect point** — the
  ID _bet_ alongside the EX _correction_. Consequence: a correctly-predicted taken branch costs
  **1, not 0** (one fall-through fetch already happened); 0 needs a BTB ⇒ explicitly deferred.
- **The thesis was readable in the corpus before writing a line**, and it mirrors M3 step 3's
  self-correction: `sum-loop`/`array-sum` favor taken (backward loop branches), but `call-return`'s
  `bge a0,a1` is **17 >= 42 = never taken** ⇒ favors not-taken. **No scheme dominates** — a
  predictor is a _bet_ and the corpus punishes each one. `call-return` is predicted to get
  **slower** under static-taken (`jal` 2→1, but `bge` 0→2 and `jalr` unpredictable stays 2).
- **The penalty model already reproduced a pinned number before any code**: M3's pinned **18
  casualties** on `sum-loop` = 9 taken × 2 squashed, exactly.
- **M3's closed form generalizes rather than breaks**: `cycles = N + 4 + S + 2·T` — the `2·T` was
  never general, it was the **static-not-taken instance** of a scheme-dependent penalty `P`.
- Prediction is **INV-8-invisible** (squashed paths never commit) ⇒ conformance is expected green
  first-run and _that is its point_; only the timing suite + the map can see it. Same shape as M3
  step 3.
- Seeded-but-open: what **`none`** means (lean stall-on-branch, but its corpus contrast is thin);
  whether **`predicted: boolean` is honest** under `none` (M4's add-or-decline-a-field question);
  whether the **ID bet needs its own trace event** (M3's pattern says try to build the datapath
  without it first).

## M4 STEP 7 — THE FLAGSHIP LESSON; **M4 IS COMPLETE** (2026-07-17, `680435a..37353e1`, 788 → **807 tests**)

`branch-bet` on `call-return` — "the bet, and what it costs when it's wrong". The last step of M4.

- **The acceptance line held on the FIRST RUN, and it is the milestone's cleanest payout.** "The
  validator covers the new axis **without a special case** — if it needs one, the validator's
  derivation was wrong, not the lesson." It needed none. Zero new lesson-format fields, zero engine
  changes, zero renderer changes; the only red was the deliberate inventory count. M3 step 8 derived
  the rule, M4 step 4 grew it to four positions, step 7 only authored JSON.
- **The program was FORCED**, on M3's own criterion — `call-return` is the only corpus program
  carrying the whole story on source-visible lines, and the pinned transfer triple says so outright:
  `jal` **wins** (2→1), `bge` (`17 >= 42`) **loses** (0→2), `ret` (a `jalr`) **admits no bet** (2
  either way). Signed −1 + 2 + 0 = **+1** ⇒ the lesson is the only surface where "no scheme
  dominates" is a claim about **instructions** rather than a total.
- **Key on `target`, never on `predicted`** — `predicted` is a property of the SCHEME, so a trigger
  using it means something different in each position. And the **two targets on one branch are not
  interchangeable**: `bge` bets on `0x20`, resolves to `0x1C`.
- **The mutation prediction was WRONG, and measuring it is the finding.** The slide fails **three**
  tests, not one — the sweep's ORDER guard catches it, because this lesson's config-exclusive steps
  **interleave** in trace order. Structure caught it, not vigilance.
- **The mutation the sweep genuinely cannot see names the price of the design.** `nth: 2, {predicted,
actual}` on the `ret` step is right under not-taken and **silently dead** under taken — deleting the
  punchline exactly where it lands. Whole sweep green; one test fails. Once "lawfully dead" is legal,
  **DEAD and LAWFULLY DEAD stop being distinguishable to any generic rule**, and nothing derivable
  closes it: which position a step is _meant_ to be dead in is pedagogy, and pedagogy is not in the trace.
- **The eyeball found a product defect — the streak resumes at 8.** The closing step shipped a
  **directional** imperative in a step alive in BOTH positions. Not a false number (step 4's defect) —
  a **direction**. Nothing sees which way the reader is facing. Fixed symmetrically; **stated in the
  README, not guarded**.
- **The advisor caught the same root cause's quieter form, in the same step**: "add up what the bet
  actually did here" **presupposes** a bet — and on not-taken, where the lesson opens, none was placed
  (the map shows no `?` to prove it). Every comparison true; only the premise wrong. **The tell is
  tense** — a step alive in N positions is prose about the **experiment**, not the run in front of you
  ⇒ present comparative, never past reportive. Honest gap: the eyeball rendered only the **detailed**
  tier; essentials/expert have never been on screen (low-risk — the asterisk guard covers all three and
  `renderNarration` is tier-agnostic — but it is the one reachable surface no screenshot has).

## The ISA reference panel — the first surface about the LANGUAGE (2026-07-17, `cb9edd1..976c9c8`, 807 → 889 tests)

Driven by the user: _"the user has the option to edit the program, but may not know what
instructions he can use — we need lessons and a panel for that."_ The editor has existed since M2
and **the shell had never named a single instruction**. User chose **both** deliverables: the
panel teaches (no new lesson JSON) **and** an ISA lesson track as a milestone ⇒ panel BUILT,
track PLANNED (`docs/plans/m5-tasks.md`, NOT STARTED).

- **The whole design question was WHERE each claim comes from**, since a reference that lies is
  worse than none. Split by what already has an authority: **which** things exist is derived
  (`INSTRUCTIONS`; the assembler's own tables); **what the grammar is** is derived for real
  instructions; **what it means** is the one genuinely new artifact — no source in this repo
  carries learner prose. Declared in `web`, never `isa` (prose in the encoder is the
  view-in-the-engine mistake INV-2/INV-3 forbid) — and the DAG forces it too: **`web` is the only
  package that can see both `isa` and `assembler`**, so the choice was made by the architecture.
- **`handlerFor` now dispatches through a new `syntaxClassOf`** ⇒ the class that DOCUMENTS an
  instruction and the one that PARSES it are one lookup; the panel cannot describe a form the
  assembler rejects. `format` ≠ syntax — `operands.ts` said so in its own header since M1. `jalr`
  really does accept **four** forms. `handleDirective` became a **record** so `DIRECTIVES` is
  derived from the dispatch: a list that cannot disagree with the code beats one a test must
  remember to check.
- **The drift the design feared had ALREADY SHIPPED, twice**: `format.ts` kept `LOAD_MNEMONICS` +
  `NO_OPERAND_MNEMONICS`, hand-copies of `I_LOAD`/`NO_OPERANDS`, and `formatInstruction`
  re-derives operand shape from `format` independently of the parser. Not fixed (not a
  prerequisite — a panel-side lie is impossible either way); `ABI_REGISTER_NAMES` **is** now
  pinned against the assembler's map.
- **The net that buys the prose: every example is ASSEMBLED, and instruction examples DECODED BACK
  to the mnemonic whose row they sit on.** Mutation-checked both ways: an example that assembles
  fine but decodes as a sibling (`lb` under `lbu`) fails **exactly one** test; dropping a note
  fails exactly two. The prose describes **THIS simulator, not the spec**: `ecall` halts
  unconditionally whatever `a7` holds (the corpus's `li a7, 10` is cosmetic here) and `fence` does
  nothing — **that `ecall` ends a program is the single most useful fact a learner needs and
  appeared NOWHERE in the UI**.
- **THE EYEBALL FOUND FOUR WITH 80 TESTS GREEN — the streak reaches 9 of 10 view steps.** Three
  were claims: (1) _"All 58 things this simulator accepts"_ sat above a tab bar whose 4th tab is
  **Registers**, not in the 58 — **a total is only honest over a set whose boundary the reader can
  see**; four tabs are four sets. (2) **Arithmetic opened with `addi` above `add`** — groups are
  pedagogical but their ORDER was inherited from `INSTRUCTIONS`, which sorts by **opcode**
  (0x13 < 0x33): true about the encoding, meaningless to a learner. **There is no source for
  pedagogical order, so the notes' key order IS it** — membership stays derived. (3) `fp` listed
  above `s0` (alias first, its role pointing at a row below it) — caused by an alphabetical
  tiebreak, **fixed by DELETING it**: `registers.ts` declares the canonical name first and a
  stable sort inherits that. (4) a stray space before a comma from a JSX line break; the `📖` also
  went (astral ⇒ tofu; the shell's glyphs `✎ ↩ ▶ ⏮ ◐` are all BMP).
- **Order was nobody's assertion until it was wrong** — now pinned (`add` before `addi`, `s0`
  before `fp`).
- **The advisor caught a dead export that a passing test disguised**: `STARTER_PROGRAM` had a
  green test ("the starter program assembles") and **no caller** — the editor's draft is always
  seeded from the corpus, so there is no empty state. **A test over an unreferenced export is
  green when the string parses, not when anything renders it** — the vacuity trap wearing a
  coverage badge. Deleted.
- **Browser method note:** the repo has **no jsdom / no driver** (`environment: 'node'`, tests are
  `renderToStaticMarkup` — `App.test.tsx`'s docblock names this gap). So the panel was split into
  a container + a pure `ReferenceBody(tab, query)` — every tab a static render — and the click
  wiring was driven over **CDP with Node's global WebSocket + headless Chrome** (script at
  `M:/claud_projects/temp/isa-ref-eyeball.mjs`). Verified insert-at-caret really inserts: caret at
  0 → text at 0, caret to 19 (exactly the inserted length), rest byte-identical. **Vite's port is
  a preference, not a promise** (5173–5182 were all taken by other projects; 5183 served OUR app
  while its HMR cross-talked with a Twofish project) ⇒ always `--port N --strictPort`, and **poll
  for readiness, never sleep**.
