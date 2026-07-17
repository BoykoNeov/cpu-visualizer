# Milestone 5 — the ISA track: teaching the LANGUAGE, not the machine

**Status: NOT STARTED (plan only), 2026-07-17. Nothing built. The prerequisite shipped —
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

- [ ] **0. The order spine.** Add `content/lessons/index.json` (ordered ids) and read it in
      `lessons.ts` instead of `localeCompare`. Pin: index ≡ the globbed set in both directions
      (an unlisted lesson fails; a listed-but-missing id fails). Mutation-check by removing an id.
      Do this **first**: it is the only step with machinery, every later step lands into it, and
      it fixes a defect that is live today independent of any new lesson. Acceptance: picker order
      is the authored order; `npm test` green; dropping an id reddens exactly the index test.

- [ ] **1. `first-program` on `add.s`.** The arithmetic/registers intro, and the track's front
      door — the smallest program that computes something (5 + 37 = 42). Anchors: `reg-write` ×2
      (constants arriving), `alu-op` (the add), `reg-write` (42 landing in x5). **Also the honest
      place to teach halting**: `add.s` has no `ecall`, so it halts `pc-out-of-range` — the panel
      says this in prose and here it is a thing you watch. Decide during the step whether that is
      the lesson's closing beat or a reason to reconsider the program's ending (INV-7: changing
      `add.s` changes it for every model and every differential test — do not do it lightly).
      Acceptance: anchors under its declared model; validator green; no new format fields.

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

- [ ] The lesson picker's order is authored, not alphabetical, and the index is exhaustive both ways.
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
