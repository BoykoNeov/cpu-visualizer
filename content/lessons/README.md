# Lessons

Authored lesson data (spec §13). Lessons are **declarative content** the engine does not
compile against — this is the platform/content split that makes the simulator a platform
with lessons layered on top.

A lesson references a program + a model + a config + an ordered set of steps. Each step is
anchored to a **trace event**, not an absolute cycle number (INV-6), so the lesson survives
small program edits. Narration carries per-depth-tier variants (lawful simplification,
INV-5).

The lesson types are seeded in `packages/curriculum`. The runner and event-anchoring matcher
are Milestone 1 step 10; the first authored lessons are step 11 (`docs/plans/m1-tasks.md`).

## Format

Each lesson is a JSON file matching the `Lesson` type (`@cpu-viz/curriculum`): a `program`
(referenced by its `content/programs/*.s` base name, INV-7), a `model`, a `depthDefault`, and
an ordered list of `steps`. Each step's `trigger` anchors to a trace **event type** with an
optional `nth` occurrence and a declarative `where` payload filter (shallow equality — plain
data, not a predicate, so lessons stay serializable). `narration` carries per-tier variants.

These files are **untrusted at compile time** — a mistyped `event`, `where`, or tier key fails
silently. That type-safety is bought back by `packages/web/src/lessons.test.ts`, which anchors
every lesson against the real engine **it declares** and asserts no step is dead.

### `index.json` is the teaching ORDER **and the TRACKS**, and both are content

`index.json` lists **tracks**, each a picker heading plus its lesson ids, first-taught first:

```json
[
  { "track": "The language", "lessons": ["first-program", "..."] },
  { "track": "The machine", "lessons": ["forwarding-bubble", "branch-bet"] }
]
```

It is the **only** source of the order and the grouping the picker offers, and it lives here rather
than in the view because there is no source for pedagogical order — it has to be declared by
whoever is doing the teaching.

The order is **derived from the tracks by flattening** (`lessons.ts`), which is the point of the
grouped shape rather than a flat list beside a group map: order and grouping are one declaration
read two ways, so they cannot contradict each other, and no third test is needed to pin that they
agree.

**Track is not derived from `model`, and that was the M5 step 4 decision.** All six language lessons
happen to be `single-cycle` and both µarch flagships `pipeline`, so the split looks free. It is a
coincidence, not a law: `model` says which microarchitecture a lesson RUNS ON, a track says what it
is ABOUT, and a language lesson taught on the pipeline is perfectly lawful. Deriving the group from
`model` would file that lesson under "The machine" and stay green — `id.localeCompare` again, one
surface up. (Nor is it a `track` field on the lesson: same decision, one place.)

Until M5 step 0 `lessons.ts` ended `.sort((a, b) => a.id.localeCompare(b.id))`, so a beginner was
offered `array-in-memory` first — a memory lesson — and `sum-loop-tour`, the natural first lesson,
last. **A `localeCompare` is not an opinion about teaching; it is the absence of one, wearing
determinism as a disguise.** (The ISA reference panel shipped and fixed the same shape one surface
down: its groups inherited the ISA table's _opcode_ order, so "Arithmetic" opened with `addi` above
`add`.)

To add a lesson: drop the JSON in this directory **and** add its id to a track here. The two are
checked against each other in both directions, so an unlisted lesson fails the suite rather than
being quietly placed. Order-only, though — `lessons.ts` sorts by this file and never filters by it,
so a missing id cannot make a lesson vanish from the product, only misplace it at the end. The
grouped picker re-earns that: a lesson in no track is shown under a **`Not in a track`** heading
rather than dropped, because a picker that renders only the authored tracks would trade a misplaced
lesson for an invisible one.

**What the exhaustiveness check cannot see, measured:** re-author this file into pure alphabetical
order and the index/lesson-set test stays **green** — the code faithfully reads the index, and the
picker ships the exact defect step 0 existed to fix. `LESSONS` follows the index, so _every_ index
is self-consistent, and no derivable rule can rank one order above another. Step 4 measured the
same blindness for tracks: file `branch-bet` under "The language" and **exactly one test of 125
reddens** — the by-name one. Every structural check stays green, and so does the `model` proxy the
old test used, because the mis-filing is still self-consistent.

So what catches it is the handful of named claims in `lessons.test.ts` that assert this file's
**content** is sane. Those are pedagogy, and pedagogy is not derivable — the same reason M4 step 7
had to assert by name which position a step is _meant_ to be dead in:

- the first lesson is `first-program`, and `sum-loop-tour` precedes `array-in-memory`;
- the tracks are `The language` then `The machine`, and the machine track is exactly
  `forwarding-bubble` + `branch-bet`;
- **`array-in-memory` precedes `sign-and-zero`** — the rule before the exception (below);
- `sign-and-zero` and `which-is-smaller` stay adjacent, in that order.

Order claims are **kept rather than retargeted** when a lesson moves: "a loop before an array" and
"an add before a loop" are separate opinions, and the first is still the one that was live-wrong in
the shipped product.

### The order teaches the RULE before the EXCEPTION

M5 step 4's sequencing pass found the track teaching `lb`/`lbu` (position 3) before `lw` (position 5) — the load trap before the load. Steps 2 and 3 had each parked their lesson at the slot the plan
guessed, both writing "step 4 is still the real sequencing pass"; nobody had read the six as a
sequence until step 4 did.

The fix is forced by the lessons' own prose rather than by taste, which is why it is assertable:
`array-in-memory`'s first step **introduces** the concept ("`lw t2, 0(t0)` reads a word from data
memory into a register"), while `sign-and-zero`'s first step already **spends** addresses, loads
and the data-memory panel ("Before you can load a byte you need its address"). One lesson defines
what the other assumes. Likewise `which-is-smaller`'s expert tier calls back to "the same law `lb`
and `lbu` show on loads", so it must follow `sign-and-zero` — a callback to a lesson the reader has
not had is not a callback.

**When you add a lesson, read the whole track top to bottom, not just its own slot.** That is the
only check that can see this class, and the suite is downstream of it.

### `model` and `config` are honored, not decorative

Starting a lesson switches the shell to the lesson's `model` and, when the lesson declares one,
its `config` (see `lessonOpening` in `packages/web/src/session.ts`). A lesson's _anchors_ survive
a model swap (INV-6), but its _narration_ is prose written about one machine — `sum-loop-tour`
says its add is "written back to a0 in the same cycle", which is only true on single-cycle. So a
lesson opens on the model it was written for. `config` is applied **only when present**: the
forwarding position is session-level and persists, so omitting it means "no opinion", not "reset
to the default".

### Narration is plain text plus ONE construct

Backtick-delimited `code spans` are the entire markup vocabulary — `renderNarration` (App.tsx)
splits on backticks and nothing else. **This is not Markdown.** `**bold**`, `*italic*` and bullet
`*`s reach the reader as literal asterisks; a `\n` collapses to a space, as in any HTML. Carry
emphasis in the sentence instead of in punctuation. A guard in `lessons.test.ts` fails any lesson
whose narration contains a `*` outside a code span — it exists because the flagship lesson shipped
`**not**` to the browser, and every test was green, since they all assert narration _resolves_
rather than _renders_.

### A step alive in two positions must read true from BOTH — including its imperatives

The mirror of the rule below, and the subtler half. A step that is _not_ config-exclusive fires on
every machine the lesson honors, so its narration is prose about all of them at once. Numbers are the
obvious trap (M4 step 4: "51 cycles" over a transport reading 49), but **directions are the one that
survives review**, because a sentence can be true, checkable, and still wrong from where the reader is
sitting. `branch-bet`'s closing step shipped "Flip it and watch the total move the wrong way" — true
read from predict-not-taken (17 → 18), false read from predict-taken, where flipping goes 18 → 17 and
the total moves the right way. Every test was green: the numbers it quotes are correct in both, and no
guard can see which way the reader is facing.

Write the comparison symmetrically instead — `forwarding-bubble` already had it right ("flip the
toggle back and forth and watch the total stay put while the cycle count moves"), and `branch-bet` now
does ("the 42 never budges, and the count sits one cycle higher on the side that bets"). A both-
positions step should name the sides, never say "flip it and watch X happen".

The same root cause has a quieter second form: **presupposing what the reader has just seen**. The
same closing step also said "add up what the bet actually did here" — read on predict-not-taken, where
the lesson opens and where a reader who never flips stays, **no bet was placed at all**, and the map
correctly shows no `?` to prove it. Every comparison in the sentence was true; only its premise was
wrong. The tell is the tense: a both-positions step is describing **all** the machines at once, so it
wants the present comparative ("betting wins a cycle on `jal`, loses two on `bge`") over the past
reportive ("the bet won a cycle here"). The rule in one line: **a step alive in N positions is prose
about the experiment, not about the run in front of you.**

This is stated rather than guarded, deliberately: which way a sentence faces is semantics, and a test
that pattern-matched imperatives would be a style rule wearing a test's clothes. It is here because it
is the third time a lesson's closing narration went wrong in a way only the browser could see.

### A step may be lawfully dead in a config

A lesson's steps need not all fire. `forwarding-bubble` is _about_ a stall that disappears when a
toggle flips, and the trace vocabulary is config-exclusive (`stall.reason: 'raw'` only with
forwarding off; `'load-use'` and `forward` only with it on), so some of its steps must be absent in
each position — that is the lesson, not a bug. The runner skips null anchors and the panel drops
never-fired steps, so the rail simply re-forms when the user flips the toggle. The validator's rule
is therefore "every step fires in **at least one** position the declared model honors" — which for a
config-blind model is exactly "every step fires".

**Known limitation — degradation is graceful in one direction only.** The model picker stays live
during a lesson, deliberately: switching models mid-lesson is worth being able to do, and for the
three single-cycle lessons it works (they anchor to architectural events every model emits). It does
**not** hold in reverse. Switching `forwarding-bubble` down to single-cycle leaves only its first and
last steps alive — that machine emits no `stall` and no `forward` — and the surviving intro narration
("Five instructions share the pipeline…") is then plainly false about what is on screen. This is not
gated: it takes a deliberate downgrade to reach, and a picker that locked itself during a lesson
would be a worse trade than a lesson that reads oddly if you insist. Noted because "the lesson still
anchors" is exactly the reassurance that hides it — see `lessonOpening`: anchoring is not truth.

### On single-cycle, the STEP BUDGET is the instruction count

Not a style note — an arithmetic ceiling, and M5 step 1 hit it on its first lesson. Single-cycle
runs one instruction per cycle, the play-through cursor addresses a **cycle**, and the validator
forbids two steps sharing one (they would not be independently reachable). So a single-cycle lesson
has **at most as many steps as its program has instructions**. `add.s` is three instructions, so
`first-program` is three steps, and the M5 plan's own four-anchor sketch — which gave the `add` its
own beat, separate from the `42` landing — is unbuildable by pigeonhole rather than by preference.

Measured, both halves, because the second was not predicted:

- On single-cycle the fourth anchor collides: `steps share a cycle and can't be reached
independently by the cursor: [[2,[2,3]]]`. The ALU result and its write-back are the same cycle,
  which is not an accident of this program — it is what single-cycle **means**.
- On the pipeline with forwarding **on** it is also out of ORDER (`expected [ 2 ] to deeply equal
[]`): the ALU computes 42 in cycle 4, while `x2 = 37` is not written back until cycle 5. A step
  reading "now the ALU adds", placed between "37 arrives" and "42 lands", is therefore **false** on
  a forwarding machine — the add takes 37 from the forwarding network, not from the register file.

Two machines reject the same authoring for two unrelated reasons, which is the argument for the
rule rather than for the fix: on single-cycle the add and its write-back are one beat because they
are one cycle, and saying so IS the teaching.

### On single-cycle a load's READ and its EXTENSION are one beat — and the view says so louder

The step-budget note above is about a COUNT. This is the narrower rule beside it, and M5 step 2 hit it
on a program the count left plenty of room for: `byte-loads.s` is six instructions, and its lesson
still could not be authored the way the plan sketched it. A load's `mem-read` and its `reg-write` land
in the **same cycle** on single-cycle, so "the raw byte comes out" and "the extended value lands"
cannot be two steps — the cursor addresses a cycle. Measured, because the plan asked for exactly that
authoring: adding the `mem-read` step gives `steps share a cycle and can't be reached independently by
the cursor: [[2,[1,2]]]`.

That is a gift rather than a loss. The contrast axis moves from read-vs-write to **`lb`-vs-`lbu`** —
the lesson the program's own header always claimed — and the reader loses nothing, because the cursor
sits on a whole cycle and the step showing −128 shows the load that produced it.

**But the datapath does not agree with the trace here, and only the browser said so.** `datapath.ts`
drives the Data-Memory output wire from `regWrite.value`, not `memRead.value` (`if (isLoad)
w('dmem-wb', regWrite.value, 'dec')`). So the trace's two `mem-read` events are byte-identical
(`value: 128` both) while the diagram shows that block emitting **−128** for `lb` and **128** for
`lbu`. A narration claiming "the two memory reads are identical" is therefore contradicted on the
centerpiece view, at the default tier — every test green, and the thesis undercut on screen.

The renderer was left alone, deliberately: the diagram has no extender box, so the Data-Memory block
**is** the load unit (the Patterson & Hennessy convention) and its output is the instruction's answer.
Sourcing that wire from `memRead.value` would show 128 into the write-back mux and −128 out of it — a
selector that appears to TRANSFORM its input, which is a worse lie and an always-on one. So the
narration reconciles the surfaces instead: it grounds "same byte, same address" in the two things that
are visibly constant (the data-memory panel's `0x00000080`, unchanged across all three steps, and the
`0x10000000` arriving at Data Memory on both loads) and then names the extension-inside-the-block as
the reason the outputs differ. The contradiction becomes the actual lesson — _where_ extension happens.

### "Looks different, is same" has a mirror: "looks same, is different"

M5 step 3's finding, and it is the note above turned inside out — worth reading directly after it,
because the pair is the point.

`sign-and-zero` shows the datapath emitting **−128 then 128** while the trace's two `mem-read`s are
byte-identical: the view looks different where the machine is the same, and the narration's job is to
prove sameness (the constant `0x00000080`, the shared `0x10000000`). `which-is-smaller` is the exact
opposite. Its two branch compares record **identical operands** — `{op: 'blt', a: -1, b: 1, result:
1}` and `{op: 'bltu', a: -1, b: 1, result: 0}` — so trace, wires and register panel all agree, and the
reader watches one comparison get answered two ways with **nothing on screen to explain it**. Here the
narration's job is to prove _difference_, and the only evidence it has is the mnemonic.

**Nothing is broken, and nothing is lost.** −1 and 4294967295 are the same 32 bits; the engines record
operands in their signed int32 spelling throughout (`alu` does `a: a | 0` in all three tracing
models), and `>>> 0` recovers the unsigned reading whenever anyone wants it. So this is not the trace
failing to carry something.

**There is simply no wire to show it on.** The unsigned reading is applied _inside the comparator_,
exactly as sign-extension is applied _inside the load unit_, and the datapath draws neither as a box —
the same structural gap, found from the opposite direction. The only wire that could carry 4294967295
is `regfile-rs1`, sourced from `reg-read`, i.e. the register file's own output; a register file that
re-spelled its contents according to the signedness of whoever was reading would **appear to transform
its output**. That is precisely the argument step 2 used to leave `dmem-wb` alone. Two steps, two
directions, one law: **an interpretation never belongs on a wire.** Hence zero engine and zero
renderer changes, again.

Two authoring consequences, both load-bearing:

- **Never claim the reader can see 4294967295** — it appears nowhere. The lesson grounds itself in the
  `0xffffffff` the register panel visibly shows, and supplies the unsigned reading in prose. The panel
  itself is an instance of the lesson: it prints `-1` beside those bits because it had to pick a
  spelling, and it picked signed.
- **Narrate an unsigned comparison in unsigned terms throughout.** `branch-flavors.s` seeds its
  unsigned guess with `mv a1, t0`, which the panel shows as **-1**; calling that guess "-1" invites the
  reader's signed intuition (−1 < 1 — so why is it corrected?) and the step reads false off the screen.
  The guess is 4294967295, which is not less than 1, so the fall-through fixes it. Note the two
  branches also run in **opposite directions** — the signed one is taken and skips its correction, the
  unsigned one is not taken and runs it — so there is no single sentence that describes "the branch".

The oracle pins the collision itself (identical `a`/`b`, differing `result`) as a deliberate tripwire:
drop the `| 0` and it reddens, which drags the next person back to this note before the datapath starts
spelling registers differently per reader. Measured, both ways — dropping the `| 0` reddens **only**
this test out of 121, so the operand convention was entirely unguarded until this lesson; and claiming
the `bltu` was taken reddens **six** tests across single-cycle, multi-cycle and both pipeline
positions, because `result` in a `where` pins control flow on every model at once.

### Narration may name an instruction the anchor cannot see

M5 step 2's sharpest find, and the cheapest mistake to make. Its expert tier said `la` expands to
`auipc t0, 0x10000`; the transport, directly above the lesson panel, disassembles that instruction as
**`lui x5, 0x10000`**. (`la` lowers to `lui` + `addi` — see `pseudo.ts` — so the draft was wrong twice
in one sentence: the mnemonic, and "PC-relative".) **919 tests were green**, and structurally had to
be: the step anchors to a `reg-write`, which is agnostic about WHICH instruction wrote the register.
Anchor, value, order, narration-resolves — all correct, over prose naming an instruction that is not
in the program.

**The same rule bites when narration names a LESSON, and M5 step 3 shipped that draft too.** Its expert
tier read "the same law `sign-and-zero` shows on loads" — an **id**, and the picker shows **titles**, so
a reader who went looking would scan the list for "sign-and-zero" and find only "One byte, two answers".
Caught by the browser, again, and by reading the rendered panel rather than the DOM. An id is a key for
`index.json` and the test suite; it is not a thing the reader has ever seen. The fix was to point at
`lb`/`lbu` — the instructions, which the reader HAS seen — rather than at the lesson wrapped around them.
Cross-references between lessons are best made through the machine they share, not through the library's
filenames.

The rule: an anchor pins a **transaction**, never the sentence wrapped around it. Anything narration
asserts beyond the anchored event — a mnemonic, an expansion, a cycle count, a claim about another
panel — is unguarded by construction, and gets a line in the oracle only if someone thinks to write
one. `sign-and-zero`'s oracle now resolves the anchored instruction's mnemonic through the recording's
in-flight list and asserts `lui`, mutation-checked. That is the pattern to copy when a step names
something the event does not carry.

(Two facts worth keeping, both learned here: `la` emits the `lui`+`addi` pair even when the low 12
bits are zero — unlike `li`, whose `materialize32` collapses to a bare `lui` when `lo === 0` — which
is why the reader sees a second write to t0 that changes nothing. And the transport disassembles to
`xN` while the corpus writes ABI names, so a lesson saying "t1" sits above a line reading `lb x6,
0(x5)`; the register panel lists both spellings side by side, which is what makes one bridging clause
enough.)

`byte-loads.s` is the **only** corpus program where `mem-read.value` and `reg-write.value` disagree at
all; every other load is an `lw`. That is why nothing ever had to decide this, and why only a lesson on
this program could surface it.

### Narration may promise a RUN the corpus does not contain

M5 step 5's finding, and one step beyond the note above. That note is about narration naming an
INSTRUCTION the anchor cannot see; this is narration describing a **program that does not exist**.

`function-call`'s closing step hands the reader to the editor with a concrete experiment: make the
17 bigger than 42 and `max` returns your number, because the `bge` is taken instead and `mv a0, a1`
never runs. **No anchor can ever reach that claim** — the step anchors the `reg-write` of 42, which
is the UN-edited run, and every other oracle in `lessons.test.ts` drives `EXAMPLE_PROGRAMS`. It is
the first narration in the library whose subject is a run the READER has to make.

So it is pinned by replaying the reader's edit through `loadSource`, which is the same path
`loadEdited` takes on the fork (`useSimulator`) — the reader's edit, not a simulation of it. Each
clause the sentence makes is asserted on its own (`s0` = 99; the `bge`'s `result` flips 0 → 1; no
`reg-write` of 42 into `a0`, which is `mv a0, a1` not running). Mutation-checked: a number **below**
42 reddens exactly this test.

**Pin the sentence, not the coincidence.** 99 keeps `li` a single word (it fits the 12-bit
immediate), so the pcs happen to survive the edit — but the reader is invited to type ANY number
above 42, and a big one expands `li` to `lui`+`addi` and shifts every pc by 4. The narration
promises nothing about addresses, so the oracle asserts nothing about them either.

### An invitation to EDIT is one-way in the moment, and the direction is a claim

Two rules for a hand-off step, both from M5 step 5.

**It must read complete BEFORE it is obeyed.** Running an edit forks into a sandbox and DETACHES the
lesson (`session.ts`), so the narration vanishes the instant the reader acts on it. Write a single
imperative-plus-payoff ("change the 17 to a number above 42 and run it — `max` returns your number"),
never "do X, then watch for Y next". That is also why a hand-off belongs on a track's LAST step:
nothing downstream is lost. Same constraint that put the halt on `first-program`'s last step, reached
from the other end.

**Do not re-explain the fork.** The shell already says it at both moments that matter — the
ProgramEditor's blurb sits directly above the Run button ("any active lesson detaches"), and the
ModeChip afterwards reads "lesson annotations detached. Pick the lesson again to resume it". Narration
repeating it would duplicate the shell at a worse moment and end a graduation beat on a loss. This is
also the argument against a lesson-format field for "go edit": the channel already exists.

**And check the direction against the PAGE, not the DOM.** The natural sentence is "the Edit program
panel **below**", and it is false: `ProgramEditor` renders at `App.tsx:265`, `NarrationPanel` at
`:293`, so the editor is **above** the lesson panel (measured on the shipped bundle: button top 199,
panel top 325). This is the "directions are the one that survives review" note above in its SPATIAL
form — that note is about config positions, this is about pixels, and both are sentences that are
true, checkable, and wrong from where the reader is sitting. The editor is also collapsed by default,
so naming it is load-bearing rather than decorative: "go edit" with no pointer is a dead end.

### The halt is STATE, not an event — so it cannot be a step

`TraceEvent` has no `halt` arm (`schema.ts`), and `pc-out-of-range` is not an instruction the
machine executes — it is where the PC ends up. A lesson step anchors to an event (INV-6), so
"and here it stops" has nothing to anchor to and must ride on the narration of the step that
happens to be last.

That is a constraint, and on `add.s` it is free: the halt lands on **the same cycle as the payoff**
in all four machines (single-cycle 2, multi-cycle 11, pipeline 8 / 6). So `first-program`'s closing
step is the `reg-write` of 42, and the transport beside it reads `— halted` at that very cycle —
browser-verified, because that is the only place the claim can be checked against what the reader
sees. `lessons.test.ts` pins it as state (`{ halted: true, pc: 12 }`), and the `pc` is the
load-bearing half: it says the machine ran off the END of `.text`, which an `ecall` halt would not
do — it would leave the PC on the `ecall`.

## Authored lessons

Listed in `index.json`'s teaching order — the language track first, then the µarch flagships.

- **`first-program`** — the track's front door (`add`), and the smallest program that computes
  anything: 5 arrives in a register, 37 arrives in another, `add` makes 42. Three instructions,
  three cycles, three steps (see the step-budget note above). It is also the only place the corpus
  can teach **halting**, because `add.s` is its only program with no `ecall` — so it runs off the
  end of `.text` and stops, which the closing step's narration names and the transport corroborates.
  That is why `add.s` keeps its ending (INV-7: changing it changes it for every model and every
  differential test, and would delete this lesson's last beat).

  It is also the only lesson whose registers ignore the ABI: `add.s` computes in `x1`, `x2`, `x5`,
  which the register panel names **`ra`, `sp`, `t0`** — so the track's first lesson narrates "5 goes
  into x1" beside a row reading `ra`, and a beginner's first program computes into the
  return-address and stack-pointer registers. Nothing can test that: the lesson is true, the panel
  is true, and they disagree only in the reader's head. Step 1 names the mismatch in one clause
  (the nicknames are a convention, not a hardware rule) rather than editing the corpus.

- **`sum-loop-tour`** — anatomy of a counting loop (`sum-loop`): fetch → loop body → backward
  branch → the final total (55).
- **`array-in-memory`** — walking an array in `.data` (`array-sum`): the first `lw`, a negative
  element, the summed total (120), and the `sw` that writes it back. **It comes before
  `sign-and-zero` because it is where a load is introduced at all** — "reads a word from data memory
  into a register" — and the byte-load trap is an exception to a rule the reader has to have met
  first. M5 step 4 moved it here from position 5; see the rule-before-exception note above.
- **`sign-and-zero`** — one byte, two answers (`byte-loads`): `0x80` read as −128 by `lb` and +128 by
  `lbu`. The corpus's orphaned teaching program — its header always said it existed to show "the
  classic load-extension trap", and until M5 step 2 nothing taught with it. Three steps: the address,
  then each load. It is the one place the ISA is genuinely counter-intuitive rather than merely
  unfamiliar, and the one place the panel can only assert what a run can show. See the two notes above
  for why it is three steps and not the plan's four, and why its narration points at the data-memory
  panel rather than at the Data-Memory block's output wire.

  It is also the mirror of `first-program`'s ABI mismatch: this program writes `t0`/`t1`/`t2` in
  source, and the disassembly beside the transport writes `x5`/`x6`/`x7`. Both spellings are on
  screen at once (the register panel lists them side by side), so step 1 bridges them in one clause
  rather than picking a side.

- **`which-is-smaller`** — "When -1 is not less than 1" (`branch-flavors`): `min(t0, t1)` computed
  twice over the same bits, once with `blt` and once with `bltu`, and the two answers disagree
  (a0 = -1, a1 = 1). Placed directly after `sign-and-zero` because it is **the same law one surface
  over, and the sharper half**: `lb`/`lbu` disagree about a byte arriving from memory, which leaves a
  reader free to conclude the load settled the question; `blt`/`bltu` disagree about a word already
  sitting in a register, which shows it never did. Signedness is a property of the instruction, and a
  register's contents carry none for a later instruction to inherit.

  It is also the one lesson whose subject is **invisible on screen** — see the mirror note above. The
  two branches show identical operands and decide opposite, and the only on-screen difference is the
  `u`. Its program is the corpus's first branch whose signed and unsigned readings differ at all, and
  its first use of any branch but `bne`/`bge` — which is why M5 step 3 had to add a program rather
  than reuse `call-return` (whose `bge` `function-call` already both anchors and narrates).

- **`function-call`** — call/return linkage (`call-return`): argument setup, `jal` saving the
  return address, the in-function compare, and the result saved after `ret`. Last in the track: it is
  the only lesson that needs a **convention** rather than only instructions.

  Being last, it carries the track's **hand-off** (M5 step 5): its closing step sends the reader to
  the editor to make the 17 bigger than 42 and watch `max` return their number. Placed here rather
  than at the front door — where the plan's own example sentence ("change the 37 and watch 42 move")
  pointed, since 37 is `add.s`'s number — because a beginner three instructions in **cannot read the
  result of their own edit**, while a reader who has just watched `bge a0, a1` fall through can see
  exactly why raising the 17 flips it. Note "the track" here is **the language track**, which ends
  here; the picker ends at `branch-bet`, and "go write some assembly" is not how a branch-prediction
  lesson should close. See the two hand-off notes above for why it is prose rather than a field, and
  why its promise needed an oracle of its own.

The lessons above are **`The language`** track, and they target **single-cycle** (M1) and anchor only
to architectural events, so they play against any model unchanged (INV-6). That coincidence — every
language lesson being single-cycle — is exactly what the track must NOT be derived from; see the
`index.json` note above.

The two below are **`The machine`** track: their subject is a µarch rather than the ISA.

- **`forwarding-bubble`** — the flagship experiment (M3, spec §12.2), on the **pipeline**, opening
  with **forwarding off**. `array-sum` is the only corpus program that can carry it: it holds both
  halves of the story on source-visible lines. `add a0, a0, t2` and `bnez t1, loop` both stall
  without forwarding; turn it on and the branch's bubble **vanishes** while the add's **survives**
  (one cycle instead of two, renamed `load-use`) — because a load's value is not ready any earlier,
  which is the point most courses fumble. Flip the toggle mid-lesson and the rail's middle two steps
  swap.

- **`branch-bet`** — "the bet, and what it costs when it's wrong" (M4, the second pipeline flagship),
  on `call-return`, opening on **predict-not-taken** — the baseline, so the bet reads as an idea
  rather than as the way things are. `call-return` is the only corpus program that can carry it, and
  for the same reason `array-sum` was the only one that could carry `forwarding-bubble`: it holds one
  of **each** kind of transfer on a source-visible line. `jal ra, max` is PC-relative and always goes,
  so the bet **wins** (2 cycles → 1); `bge a0, a1, done` is `17 >= 42`, so it never goes and the bet
  **loses** (0 → 2); `ret` is a `jalr` whose target lives in a register, so **no scheme can bet at
  all** (2 either way). Signed, that is −1 + 2 + 0 = **+1**: flipping to `static-taken` makes this
  program _slower_, 17 → 18, which is the milestone's thesis — no scheme dominates. Flip the toggle
  mid-lesson and the rail re-forms from five steps to six, four of them different.
