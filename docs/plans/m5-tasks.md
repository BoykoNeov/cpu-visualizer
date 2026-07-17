# Milestone 5 — the ISA track: teaching the LANGUAGE, not the machine

**Status: STEPS 0–1 DONE 2026-07-17 (907 tests) — the order spine is in, the picker's alphabetical
order is gone, and `first-program` is the front door. Steps 2–5 not started. The prerequisite shipped —
the ISA reference panel (`579a244`, 890 tests) — and this plan is the second half of the same
request: "the user has the option to edit the program, but may not know what instructions he can
use; we need lessons and a panel for that."**

Source of truth for scope: `cpu-visualizer-spec.md` §13 (curriculum). The load-bearing
constraints are INV-6 (lessons anchor to trace events), INV-7 (one example-program library) and
INV-5 (lawful simplification).

## Why this milestone, and why now

Every milestone so far taught the **machine**: M1 a single-cycle datapath, M3 the pipeline and
its bubbles, M4 the bet a predictor makes. All five authored lessons are tours of a
microarchitecture. **Nothing has ever taught the language the user is invited to write.** M2 gave
the shell an editor; the editor shipped with no vocabulary, and until last commit the shell never
named a single instruction. That is the gap this milestone closes, and it is the first one whose
subject is the ISA rather than a µarch — which is why it is a track and not a model.

The panel already closed the _reference_ half. This is the _narrative_ half, and the division
between them is the first decision below.

## The inventory — read this before proposing a single lesson

The request's own framing was "arithmetic, branches, memory, calls". **Three of those four are
already built**, and a plan that does not start here ships duplicates:

| Existing lesson     | Program       | Teaches                                            |
| ------------------- | ------------- | -------------------------------------------------- |
| `sum-loop-tour`     | `sum-loop`    | a counting loop, a backward branch, the total (55) |
| `array-in-memory`   | `array-sum`   | `lw`, a negative element, `sw` writing back (120)  |
| `function-call`     | `call-return` | argument setup, `jal` linkage, `ret` (42)          |
| `forwarding-bubble` | `array-sum`   | (µarch — pipeline, not language)                   |
| `branch-bet`        | `call-return` | (µarch — prediction, not language)                 |

So: **memory ✓, calls ✓, loops-and-a-backward-branch ✓.** The three single-cycle lessons above
already _are_ an intro track — unsequenced, unnamed, and not presented as one.

And the corpus has **two programs no lesson touches**:

- **`add.s`** — "the smallest interesting program", 5 + 37 = 42. No lesson. It is also the
  corpus's only program with **no `ecall`**, so it halts `pc-out-of-range` — the exact case the
  new panel's prose describes ("without one it runs off the end of your code and halts there").
- **`byte-loads.s`** — whose own header says it exists to show "the classic load-extension trap"
  (`lb` reads `0x80` back as −128, `lbu` as +128). **It was authored to teach and was never
  taught with.** The panel's `lb`/`lbu` rows now make exactly this claim in prose; this program
  is the same claim as a run.

**The gaps are therefore much smaller than the request implied, and mostly already have
programs.** That is the finding: this milestone is _mostly sequencing and two lessons_, not a
curriculum from scratch.

## Headline decision 1 — the panel owns GRAMMAR, the track owns BEHAVIOUR-OVER-TIME

Steps anchor to trace **events** (INV-6). "What `add` does" anchors fine — it is a `reg-write`
you can watch land. "`add`'s syntax is `rd, rs1, rs2`" **has no anchor**, because syntax is not a
thing that happens in a cycle; it is a property of the text. A lesson step reaching for grammar
is fighting the format _and_ duplicating the panel that already derives it from the assembler.

So the split is forced, not stylistic:

- **Panel** — what exists, what it is spelled like, what it means in one line. Static, derived,
  searchable, click-to-insert.
- **Track** — what it _does when it runs_: a value landing in a register, the same byte read two
  ways, a counter reaching zero.

**Recommendation: no lesson-format change.** M3 and M4 declined five fields between them; the
one field M4 accepted (`branch-predicted`) was accepted because nothing else could source it.
Nothing here needs a field the format lacks — which is the check that this track is really a
content milestone.

## Headline decision 2 — a track IS an order, and today's order is an accident

This is the one piece of real machinery, and the panel just found its twin. `lessons.ts` ends:

```ts
export const LESSONS: readonly Lesson[] = Object.values(modules).sort((a, b) =>
  a.id.localeCompare(b.id),
);
```

The lesson picker is sorted **alphabetically by id**. A beginner opening it today is offered
`array-in-memory` first — a memory lesson — and `sum-loop-tour`, the natural first lesson, last.
Alphabetical order over a pedagogical surface is precisely the defect the reference panel shipped
and fixed this week (its groups inherited `INSTRUCTIONS`' **opcode** order, so "Arithmetic" opened
with `addi` above `add`). Same class, one surface up, and already live in the product.

The lesson there transfers exactly: **there is no source for pedagogical order, so it must be
declared — and declared in content, not computed in the view.** A `localeCompare` is not an
opinion about teaching; it is the absence of one, wearing determinism as a disguise.

Options:

- **(a) An ordered index in `content/lessons/` (recommended)** — e.g. `index.json` listing lesson
  ids in teaching order. Content stays content, the view stops inventing an order, and a lesson
  absent from the index is a review question rather than a silent alphabetical placement.
- (b) An `order: number` field per lesson — spreads one decision across five files and makes
  inserting a lesson an edit to its neighbours. This is the shape the project has declined before.
- (c) Leave alphabetical, rename ids to sort correctly (`01-…`). Encodes order in a key whose job
  is identity, and every anchor/test that names an id churns.

**Recommendation: (a)**, with the validator asserting index ≡ lesson set both directions — the
same exhaustiveness shape the panel's notes now use, for the same reason.

## Build order (each step testable before the next)

- [x] **0. The order spine — DONE 2026-07-17 (895 tests).** `content/lessons/index.json` (ordered
      ids) is now the only source of picker order; `lessons.ts` reads it instead of
      `localeCompare`. Authored order: `sum-loop-tour` → `array-in-memory` → `function-call` →
      `forwarding-bubble` → `branch-bet` — step 4's target order minus the two unbuilt lessons.
      Browser-verified on the shipped bundle: the picker reads "Anatomy of a loop" first (was
      "Walking an array in memory"), five options, and the promoted lesson opens correctly.

      **THE ACCEPTANCE LINE WAS BACKWARDS, AND MEASURING IT IS THE FINDING.** It asked that
      "dropping an id reddens exactly the index test", which treats index ≡ set as the net. Run as
      two mutations, it is the weaker half:

      - Drop an id → **three** tests redden, not one, and all three are true consequences (the
        unlisted lesson sorts last, so a memory lesson leads *and* a language lesson trails the
        µarch ones).
      - Re-author the index into pure alphabetical order — exhaustive, self-consistent, and the
        exact defect this step exists to fix — → the index test stays **GREEN**.

      `LESSONS` is *derived from* the index, so **every index is self-consistent** and the
      exhaustiveness check is structurally blind to a badly-authored order: it pins that the CODE
      reads the index, never that the INDEX teaches. Following the plan's acceptance literally
      would have shipped machinery that faithfully implements `localeCompare`. What catches it is
      the two claims asserted **by name** about the index's content (first lesson is
      `sum-loop-tour`; every language lesson precedes every µarch one) — pedagogy, which is not
      derivable, exactly as M4 step 7 found for "which position a step is *meant* to be dead in".
      This is the "guard whose case list cannot reach the defect is not a guard" shape for the
      third milestone running.

      Two smaller finds. **The glob would have eaten the index**: `import.meta.glob('*.json')` sits
      on the lessons' own directory, so `index.json` would be cast to a `Lesson` and shipped as a
      step-less sixth entry — solved by one glob partitioned by path (a direct `import` would have
      needed the same exclusion anyway, so partitioning removes the problem rather than moving it).
      And **one existing test passed only because it was alphabetical**: `lessons.test.ts`'s
      pipeline-membership assertion read `toEqual(['branch-bet', 'forwarding-bubble'])`, which the
      authored order (M3's flagship before M4's) reddens. Its own sentence is a claim about
      MEMBERSHIP, so it now sorts before comparing — order is pinned exhaustively once, against the
      index, rather than copied into a second file that would redden again at step 4's reorder.

- [x] **1. `first-program` on `add.s` — DONE 2026-07-17 (907 tests).** The track's front door ships:
      `content/lessons/first-program.json`, "The smallest program that computes something", three
      steps on single-cycle, first in `index.json`. `add.s` unchanged, no new format fields, no
      engine or renderer change. Browser-verified on the shipped bundle in both themes: the picker
      opens with it, the rail is three dots, and step 3's transport reads `cycle 2 / 2 — halted`.

      **THIS STEP'S OWN ANCHOR LIST WAS UNBUILDABLE, AND THE PIGEONHOLE IS THE FINDING.** The plan
      above asked for four anchors — two constants, the `alu-op`, then 42 landing. `add.s` is three
      instructions and single-cycle runs one per cycle; the cursor addresses a **cycle** and the
      validator forbids two steps sharing one. So a single-cycle lesson has **at most as many steps
      as its program has instructions**, and the fourth anchor cannot exist. Not a preference — an
      arithmetic ceiling, and the first time this project has hit one in authoring rather than in
      code.

      Measured as two mutations, and the second was not predicted:

      - Single-cycle: the `alu-op` step collides with the payoff — `steps share a cycle and can't be
        reached independently by the cursor: [[2,[2,3]]]`. The ALU result and its write-back are one
        cycle because that is what single-cycle **means**.
      - Pipeline, forwarding **on**: it is also out of ORDER (`expected [ 2 ] to deeply equal []`).
        The ALU computes 42 in cycle 4 while `x2 = 37` is not written back until cycle 5, so a step
        reading "now the ALU adds", sitting between "37 arrives" and "42 lands", is **false** on a
        forwarding machine — the add takes 37 from the forwarding network, never from the register
        file.

      Two machines reject the same authoring for two unrelated reasons, which is what makes it a
      rule rather than a workaround: on single-cycle the add and its write-back are one beat because
      they are one cycle, and saying so is the teaching. The temptation worth naming is that the
      fourth step IS buildable — on multi-cycle, where the phases spread out. Declaring multi-cycle
      to buy a step back would be the tail wagging the dog: the language track is single-cycle
      because the machine is not its subject.

      **Halting: closing beat, and `add.s` keeps its ending.** The plan left this open; the answer is
      forced by the schema. `TraceEvent` has **no `halt` arm** — `halted` is machine STATE, and
      `pc-out-of-range` is not an instruction, it is where the PC ends up. Steps anchor to events
      (INV-6), so the halt cannot be a step; it rides on the last one's narration. That costs
      nothing here, because the halt lands on **the same cycle as the payoff in all four machines**
      (single-cycle 2, multi-cycle 11, pipeline 8/6) — so "the processor stops right here" is
      something the reader watches, and the transport says `— halted` beside it. Pinned as state
      (`{ halted: true, pc: 12 }`) rather than as prose; the `pc` is the load-bearing half, since it
      says the machine ran off the END of `.text`, which an `ecall` halt would not — it leaves the
      PC on the `ecall`. Which is also the answer to "reconsider the program's ending": **no.**
      `add.s` is the corpus's only `ecall`-free program, so giving it an exit would delete the one
      place the track can teach halting, and change every model and differential test (INV-7) to do it.

      **The front door computes into `ra` and `sp`, and only the browser says so.** `add.s` uses
      `x1`, `x2`, `x5` — which the register panel names **`ra`, `sp`, `t0`**, because those are the
      ABI's. So the track's first lesson narrates "5 goes into x1" beside a panel row reading `ra`,
      and a beginner's first program computes into the return-address and stack-pointer registers.
      No test can see this: the lesson is true, the panel is true, and they disagree only in the
      reader's head. `add.s` stays as it is (INV-7, and the same ending argument above), so the fix
      is one clause in step 1 — the nicknames are an ABI **convention** about how functions agree to
      share registers, not a rule the hardware enforces, and this program ignores them. That is
      on-topic rather than scope creep: the step's own first sentence is about registers being named
      slots, and the clause lands directly above the panel it explains.

      Three smaller finds. **`addi` emits `alu-op` with `op: "add"`**, not `"addi"` — so the
      "obvious" `{ event: 'alu-op', where: { op: 'add' } }` trigger matches the FIRST `addi`, not the
      `add`; the reg-write triggers sidestep it entirely. And the browser eyeball's own trap: forcing
      `data-theme` via CDP renders a **half-dark page** that reads exactly like a theme defect and is
      not one — the shell's inline styles read a React-held theme object that the attribute never
      touches. Click the real toggle. (The recipe's `taskkill //IM chrome.exe` also closed the user's
      own browser; a fresh `--user-data-dir` per run is the actual fix for the stale-profile lock it
      was working around.) And the depth dial's buttons carry the **raw** tier id (`essentials`) —
      they only READ capitalized, via CSS `text-transform`, so a driver matching the on-screen
      spelling finds nothing. Both are driver traps that present as product defects; neither was one.

      All three tiers were then rendered in the browser, not just `detailed`: essentials collapses
      to its one-liner, expert swaps to the I-type sign-extension variant, code spans intact and no
      literal asterisks in any of them. (`detailed` is the only tier the validator resolves, so the
      other two are authored-but-unproven until something looks — M1's lesson panel set the
      precedent by toggling to Essentials.)

- [ ] **2. `sign-and-zero` on `byte-loads.s`.** The corpus's orphaned teaching program, finally
      taught with: one byte, `0x80`, read as −128 by `lb` and +128 by `lbu`. Anchors: `mem-read`
      ×2 + the two `reg-write`s that differ. This is the single highest-value lesson in the track
      because it is the one place the ISA is genuinely _counter-intuitive_, and the panel can only
      assert it — a run can show it. Acceptance: both `reg-write`s anchored and their values
      pinned (−128 / +128) by an oracle, not just "the step fires".

- [ ] **3. Branches as a decision (scope question — resolve before building).** `sum-loop-tour`
      already shows a _backward_ branch as a loop. What is missing is a branch as an **if**: taken
      vs not-taken, and signed vs unsigned as a trap. `call-return`'s `bge a0, a1, done` is a
      forward conditional that is **not** taken (17 ≥ 42 is false) — possibly enough, and reusing
      it costs no corpus. A dedicated `branch-flavors.s` would teach `bltu` vs `blt` on a negative
      number (the second classic trap) but adds a permanent corpus citizen every model must run
      (INV-7). **Recommendation: try `call-return` first; only add a program if the lesson cannot
      be told without one, and say so in the step's log.**

- [ ] **4. Sequence + naming pass.** With 0–3 landed, order the whole set: language track first
      (`first-program` → `sum-loop-tour` → `sign-and-zero` → `array-in-memory` → `function-call`),
      µarch lessons after (`forwarding-bubble`, `branch-bet`). Consider whether the picker should
      _show_ the two groups. Acceptance: a reviewer who has never seen the app can pick the top
      lesson and be taught in the intended order.

- [ ] **5. The hand-off the panel cannot make.** The track's closing beat should send the reader
      to the editor — "now change the 37 and watch 42 move". Nothing in the lesson format expresses
      "go edit"; check whether prose alone is enough (it probably is) **before** proposing a field.
      Acceptance: a reader finishing the track has edited a program, and no field was added.

## Acceptance criteria

- [x] The lesson picker's order is authored, not alphabetical, and the index is exhaustive both ways.
      (Step 0. Note the second clause is the weaker one — see the step's log: exhaustiveness cannot
      see an alphabetical index. "Authored, not alphabetical" is carried by named content claims.)
- [ ] `add.s` and `byte-loads.s` — the two orphaned corpus programs — each carry a lesson.
- [ ] **Zero new lesson-format fields, zero engine changes, zero renderer changes.** If any of the
      three is needed, that is the milestone's real finding and belongs in its log — the same bar
      M3 step 8 and M4 step 7 met.
- [ ] Every new lesson anchors under its declared model in every config it honors (the existing
      validator, unchanged and unweakened).
- [ ] Narration obeys the rules the lessons README already states, which exist because each was
      shipped broken once: plain text plus backtick code spans only (no Markdown); a step alive in
      N positions is prose about the experiment, not the run in front of you.
- [ ] **Browser eyeball.** Non-negotiable and stated with the reason: nine of the last ten view
      steps shipped a defect no green suite could see, and the reference panel made it ten of
      eleven (four defects, 80 tests green). A lesson is a view surface.
- [ ] `npm test` / `typecheck` / `lint` green; INV-8 differential unaffected (no engine change).

## Deliberate non-goals

- **No new lesson-format fields** (see above). A `track` field, a `requires` field, and a
  `prerequisite` field are all pre-declined by decision 2: order is content, not schema.
- **No ISA changes.** The 40 instructions are the 40 instructions (INV-7).
- **No "quiz"/assessment concept.** It is a real idea and a different milestone; it would need
  state the trace does not carry, which is the tell.
- Caches (§12.3) and M2's deferred step 5c remain deferred and untouched.
