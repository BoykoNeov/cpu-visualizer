# Milestone 5 — the ISA track: teaching the LANGUAGE, not the machine

**Status: STEPS 0–3 DONE 2026-07-17 (950 tests) — the order spine is in, the picker's alphabetical
order is gone, `first-program` is the front door, `sign-and-zero` teaches the load-extension trap on
the corpus's last orphan, and `which-is-smaller` teaches the same law in the comparator (the one step
that needed a new corpus program, and the argument for it is the measurement in its log). Steps 4–5
not started. The prerequisite shipped —
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

- [x] **2. `sign-and-zero` on `byte-loads.s` — DONE 2026-07-17 (919 tests).** The corpus's orphaned
      teaching program, finally taught with: `content/lessons/sign-and-zero.json`, "One byte, two
      answers", three steps on single-cycle, third in `index.json` (after `sum-loop-tour`, before
      `array-in-memory` — step 4's target order; step 4 is still the real sequencing pass). No new
      format fields, no engine change, **no renderer change** — the last of those was a decision, not
      a default, and is the finding below. Browser-verified on the shipped bundle in both themes.

      **THIS STEP'S ANCHOR LIST WAS ALSO UNBUILDABLE — AND FOR A DIFFERENT REASON THAN STEP 1'S.**
      The plan asked for `mem-read` ×2 + the two `reg-write`s. Measured as a mutation, adding the
      `mem-read` step gives `steps share a cycle and can't be reached independently by the cursor:
      [[2,[1,2]]]`. Worth stating precisely, because "the pigeonhole again" is the wrong diagnosis:
      step 1 hit a **count** ceiling (four steps over a three-instruction program), and `byte-loads.s`
      is **six** instructions, so counting was never binding here. The rule that bit is narrower — on
      single-cycle a load's `mem-read` and its `reg-write` are **one cycle**, so the raw byte and the
      extended value cannot be two steps. It bites an authoring the count permits, which is what makes
      it a second finding rather than a repeat.

      The collapse is a gift: the contrast axis moves from read-vs-write to **`lb`-vs-`lbu`**, which is
      the lesson the program's header always claimed, and the reader loses nothing — the cursor sits on
      a whole cycle, so the step showing −128 shows the load that produced it.

      **THE DATAPATH DISAGREES WITH THE TRACE, AND ONLY THE BROWSER SAID SO.** The trace's two
      `mem-read` events are byte-identical (`{addr: 0x10000000, value: 128}` for both `lb` and `lbu`) —
      the lesson's whole thesis, and now pinned by its oracle. But `datapath.ts` drives the
      Data-Memory output wire from `regWrite.value`, not `memRead.value` (`if (isLoad) w('dmem-wb',
      regWrite.value, 'dec')`), so **on screen that block emits −128 for `lb` and 128 for `lbu`**. The
      first draft's narration said "the two memory reads are identical" and told the reader to "watch
      what memory hands back: `0x80`" — contradicted on the centerpiece view, at the **default** tier,
      with every test green. Exactly the class the eyeball exists for, and note that relocating the
      pointer would NOT have fixed it: the contradiction is visual, so it had to be reconciled, not
      dodged.

      **The renderer was left alone, and that is a decision with a reason.** The diagram has no
      extender box, so the Data-Memory block **is** the load unit (Patterson & Hennessy's convention)
      and its output is legitimately the instruction's answer. Sourcing that wire from `memRead.value`
      would show 128 into the write-back mux and −128 out of it — a selector that appears to TRANSFORM
      its input, which is a worse lie and an always-on one, for every load in the corpus. The honest
      fix is to DRAW the extender, which is a real change across three datapath files
      (`datapath.ts`, `-multi`, `-pipeline`) and a µarch-view question rather than a content one. So
      the narration reconciles the surfaces: it grounds "same byte, same address" in the two things
      that are visibly constant — the data-memory panel's `0x00000080` (unchanged across all three
      steps) and the `0x10000000` arriving at Data Memory on both loads, both browser-verified — and
      then names the extension-inside-the-block as the reason the outputs differ. The contradiction
      becomes the actual lesson: *where* extension happens.

      **`byte-loads.s` is the only corpus program where `mem-read.value` and `reg-write.value` disagree
      at all** — every other load is an `lw`, so the two are equal and the wire's source is invisible.
      That is why nothing ever had to decide this, and why only a lesson on this program could surface
      it. The orphan was hiding a view decision, not just a lesson.

      **THE EXPERT TIER NAMED THE WRONG INSTRUCTION, AND 919 GREEN TESTS COULD NOT SEE IT.** The
      draft said `la` expands to `auipc t0, 0x10000` + `addi`; the transport, directly above the
      lesson panel, disassembles that very instruction as **`lui x5, 0x10000`**. `pseudo.ts` settles
      it — `la` lowers to `lui` (hi reloc) + `addi` (lo reloc), absolute rather than PC-relative — so
      the draft was wrong twice in one sentence (the mnemonic, and "PC-relative"). Nothing could
      catch it: the step anchors to a `reg-write`, which is agnostic about WHICH instruction wrote
      the register, so the anchor, the value, the order and the narration-resolves checks were all
      green over prose naming an instruction that is not in the program. The eyeball is what saw it,
      by reading the screenshot rather than the DOM.

      Now pinned: the oracle resolves the anchored instruction's mnemonic through the recording's own
      in-flight list and asserts `lui` (mutation-checked — asserting `auipc` fails with `expected
      'lui' to be 'auipc'`). Worth noting what the pin costs and buys: a lesson's narration can name
      any fact about the machine, and only the facts it names get pinned. This one is pinned because
      the browser caught it, which is the honest description of every narration oracle in this file.
      Also learned in passing, and now in the expert tier: `la` emits the `lui`+`addi` pair even when
      the low 12 bits are zero, unlike `li` (whose `materialize32` collapses to a bare `lui` when
      `lo === 0`) — which is exactly why the reader sees a second write to t0 that changes nothing.

      Two smaller finds. **The first eyeball's checks were vacuous and the second caught it**: regexes
      for `-128`/`0x80` over `document.body.innerText` match the SOURCE panel's own comments
      (`# t1 = -128 (sign-extended)`), so they were green while proving nothing. Reading the real
      Registers table rows instead (`t1` → `0xffffff80`/−128 highlighted on its cycle, `t2` →
      `0x00000080`/128 on the next) is what actually verified the claim — a check whose case list
      cannot reach the defect is not a check, one layer down from where the project keeps finding it.
      And **the transport disassembles to `xN` while the source writes ABI names**: the reader sees
      `lb x6, 0(x5)` directly above prose saying `t1`. The mirror of step 1's `ra`/`sp` mismatch and
      much milder — both spellings are on screen at once, since the register panel lists them side by
      side — so step 1 bridges them in one clause rather than picking a side.

      Both the essentials and expert tiers were rendered in the browser too, not just `detailed`
      (which is the only tier the validator resolves), and dark was reached with the REAL toggle —
      step 1's note that forcing `data-theme` via CDP renders a fake half-dark page still holds.

- [x] **3. Branches as a decision — DONE 2026-07-17 (950 tests).** `content/lessons/which-is-smaller.json`,
      "When -1 is not less than 1", four steps on single-cycle, fourth in `index.json` (right after
      `sign-and-zero` — same law, second surface; step 4 is still the real sequencing pass). It ships
      with a new corpus program, `branch-flavors.s`, and **zero new lesson-format fields, zero engine
      changes, zero renderer changes**. Browser-verified on the shipped bundle, all three tiers, both
      themes, dark via the real toggle.

      **THE SCOPE QUESTION FLIPPED THE RECOMMENDATION, AND THE MEASUREMENT IS THE FINDING.** The plan
      said try `call-return` first and only add a program if the lesson cannot be told without one.
      Tried, and it cannot — for three reasons, none of them preference:

      - **`call-return`'s branch is already taught.** `function-call`'s third step anchors
        `{event: 'alu-op', where: {op: 'bge'}}` and already narrates "17 is not >= 42, so the branch
        is not taken and the function falls through". A lesson there is a near-verbatim duplicate.
      - **Taken-vs-not-taken is already taught too**, and not where the plan looked: `sum-loop-tour`'s
        step 4 says "while it is non-zero the branch is taken" and step 5 says "the counter has reached
        zero, so the branch falls through". Both sides, already shipped. So the plan's framing of the
        gap was **already closed**, and the only non-duplicative content left in step 3 is the OTHER
        half of its own sentence — the signed/unsigned trap.
      - **And that half was _definitionally invisible_ on the old corpus.** It held exactly three
        conditional branches — `bnez` twice (against zero) and one `bge` on 17 vs 42 — spelling two
        mnemonics. **For every operand the corpus ever compared, `blt` and `bltu` return the same
        answer.** Four of RV32I's six branches (`beq`, `blt`, `bltu`, `bgeu`) executed nowhere in the
        product, while the ISA panel asserted in prose what each one means. Not untaught: unreachable.

      That is the bar to clear before adding a corpus citizen, and it is now written into
      `content/programs/README.md`: **name what the existing corpus makes unreachable, not what a new
      program would make nicer.** Adding one turned out to be cheap by design — `conformance.ts` reads
      the corpus from disk, so `branch-flavors.s` joined the INV-8 net across every model and config
      automatically, and all four models agreed on it first run (they already unit-test
      `branchTaken('bltu', -1, 1) === false` in isolation; nothing had ever run it as a program).

      **THE HEADLINE: THIS IS THE MIRROR OF STEP 2, NOT A REPEAT OF IT.** Step 2 is "looks different,
      is same" — the datapath shows the Data-Memory block emitting −128 then 128 while the trace's two
      `mem-read`s are byte-identical, so the narration must prove SAMENESS. Step 3 is the exact
      opposite. Browser-measured on the shipped bundle, the ALU's operand wires at the two branches are
      **`["-1","1","1","8"]` and `["-1","1","1","8"]` — identical** — and the machine decides opposite.
      "Looks same, is different", so the narration must prove DIFFERENCE, and the only evidence on
      screen is the mnemonic.

      Step 3 is the cleaner case, because **nothing here disagrees**: trace (`a: -1`), the
      `regfile-rs1` wire, the register panel (`0xffffffff` / `-1`) and the verdict are all consistent.
      There is no debatable view choice to defend — the datapath is simply correct.

      **And nothing is lost, which is where the first draft of this log was wrong.** -1 and 4294967295
      are the same 32 bits; the engines record operands in signed int32 spelling throughout (`alu` does
      `a: a | 0` in all three tracing models) and `>>> 0` recovers the unsigned reading at will. The
      honest statement is **"there is no wire to show it on"**: the unsigned reading is applied _inside
      the comparator_, exactly as sign-extension is applied _inside the load unit_, and the datapath
      draws neither as a box — the same structural gap, found from the other side. The only wire that
      could carry 4294967295 is `regfile-rs1`, sourced from `reg-read` — the register file's own output
      — and a register file that re-spelled its contents by the signedness of whoever was reading would
      **appear to transform its output**. That is step 2's argument for leaving `dmem-wb` alone, arrived
      at backwards. **Two steps, two directions, one law: an interpretation never belongs on a wire.**

      (A curiosity that explains why the "obvious fix" looks available and is not: `u(rs1)` in the
      engines' `bltu`/`bgeu` arms does not survive `| 0` into the recorded operand, so
      `alu('bltu', u(..), ..)` and `alu('bltu', s(..), ..)` emit the same event. Harmless — the bits are
      the bits — and deliberately left alone.)

      **Both halves mutation-checked, and the first number is the interesting one.** Dropping the `| 0`
      reddens **exactly one test out of 121** — this lesson's oracle — so the operand convention was
      **entirely unguarded** until now; the oracle is now a deliberate tripwire that drags the next
      person back to the lesson before the datapath starts spelling registers per reader. And claiming
      the `bltu` was taken (`result: 1` in its `where`) reddens **six** tests across single-cycle,
      multi-cycle and both pipeline positions — `result` in a `where` pins control flow on every model
      at once, not just the declared one.

      **THREE NARRATION DEFECTS, ALL FOUND BY LOOKING, NONE VISIBLE TO 950 GREEN TESTS.**

      - **The unsigned guess reads `-1` on the panel.** `mv a1, t0` seeds the unsigned side with
        `0xffffffff`, which the register panel prints as **-1** — so calling that guess "-1" invites the
        reader's signed intuition (−1 < 1, so why is it corrected?) and the step reads false off the
        screen. The unsigned half is narrated in unsigned terms throughout: the guess is 4294967295, it
        is not less than 1, the fall-through fixes it. Note the two branches also run in **opposite
        directions** — signed taken and skipping its correction, unsigned not-taken and running it — so
        no single sentence describes "the branch".
      - **Narration named a lesson by its `id`.** The expert tier said "the same law `sign-and-zero`
        shows on loads"; the picker shows **titles**, so a reader would scan for "sign-and-zero" and
        find only "One byte, two answers". A new instance of step 2's rule — an id is a key for
        `index.json` and the suite, never a thing the reader has seen. Now points at `lb`/`lbu`, the
        instructions, instead: **cross-reference through the machine two lessons share, not through the
        library's filenames.**
      - **"the machine runs the line its twin skipped"** was literally false: the `blt` skips
        `mv a0, t1` at pc16, while the `bltu` falls into `mv a1, t1` at pc28. Mirror lines, not the same
        line — now says so.

      **The eyeball's own checks went vacuous twice more, in both directions.** Reading narration as
      "the longest paragraph on screen" grabbed the TOOLBAR, because essentials narration is short — the
      exact shape of step 2's `-128`-matched-a-source-comment find, and green while proving nothing. A
      second try anchored on `/^LESSON/` and matched the toolbar CHIP, printing the title four times. But
      the mirror error is real too: the FIRST wire check compared **whole** wire lists and reported "not
      identical", a false alarm — the pc/encoding/target wires must differ, since these are different
      instructions at different addresses. A check can be too broad as easily as too narrow; what settled
      it was isolating the operands and then **reading the screenshot**.

      **An exhaustiveness guard did its job, and the derivation held.** `timing.test.ts` pins a
      cycle-count table for every corpus program and reddened the moment the program landed — by design
      ("a cycle count copied from a passing run is not a pin"). Hand-derived from the recurrence: N = 9,
      S_off = 1 (only `mv a0, t0` at pc8, needing `d0+3` against a baseline of 3), S_on = 0 (no loads),
      T = 1, flushes 1/0; 16 cycles off, 15 on. Every number matched the engine first try. It also makes
      `branch-flavors.s` the corpus's **second** program that a taken-bet makes slower (P: 2 → 3, so −1)
      — and a neater statement of M4's thesis than `call-return` manages, because it needs only two
      branches to do it, differing by one letter and betting in opposite directions.

      Two smaller notes. **The dev server would not render** (`#root` empty, no exception, Vite
      connected — the cross-talk symptom the browser memory describes); the shipped-bundle path that
      steps 1 and 2 used works, and is the precedent to keep. And **out of scope but logged**:
      `EXAMPLE_PROGRAMS` in `programs.ts` still ends `.sort((a, b) => a.name.localeCompare(b.name))` —
      step 0's defect one surface up, still live. It opens on `add` today by alphabetical luck, which is
      exactly the kind of accident step 0 said a picker should not run on. A candidate for step 4.

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
- [x] `add.s` and `byte-loads.s` — the two orphaned corpus programs — each carry a lesson.
      (Steps 1 and 2. The second orphan turned out to be hiding a VIEW decision as well as a missing
      lesson — see step 2's log: it is the only program where the datapath's Data-Memory output wire
      and the trace's `mem-read` can disagree.)
- [x] **Zero new lesson-format fields, zero engine changes, zero renderer changes.** Held through step
      3, which is where it was most tempting: `bltu`'s operands are recorded through `u()` and then
      re-signed by `alu`'s `a: a | 0`, so "just drop the `| 0`" presents itself as a one-character fix.
      It is not one — see step 3's log. The bits are not lost (`>>> 0` recovers them); there is simply
      **no wire to show the unsigned reading on**, because the reading happens inside the comparator,
      and the only candidate wire leaves the register file, which cannot re-spell its own output
      without appearing to transform it. That is step 2's `dmem-wb` argument reached from the opposite
      direction, and the pair is the milestone's best finding: **an interpretation never belongs on a
      wire.** (One corpus program was added — a different bar, met in step 3's log.)
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
