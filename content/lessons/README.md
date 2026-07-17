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

### `index.json` is the teaching ORDER, and it is content

`index.json` lists lesson ids, first-taught first. It is the **only** source of the order the
picker offers, and it lives here rather than in the view because there is no source for
pedagogical order — it has to be declared by whoever is doing the teaching.

Until M5 step 0 `lessons.ts` ended `.sort((a, b) => a.id.localeCompare(b.id))`, so a beginner was
offered `array-in-memory` first — a memory lesson — and `sum-loop-tour`, the natural first lesson,
last. **A `localeCompare` is not an opinion about teaching; it is the absence of one, wearing
determinism as a disguise.** (The ISA reference panel shipped and fixed the same shape one surface
down: its groups inherited the ISA table's _opcode_ order, so "Arithmetic" opened with `addi` above
`add`.)

To add a lesson: drop the JSON in this directory **and** add its id here. The two are checked
against each other in both directions, so an unlisted lesson fails the suite rather than being
quietly placed. Order-only, though — `lessons.ts` sorts by this file and never filters by it, so a
missing id cannot make a lesson vanish from the product, only misplace it at the end.

**What the exhaustiveness check cannot see, measured:** re-author this file into pure alphabetical
order and the index/lesson-set test stays **green** — the code faithfully reads the index, and the
picker ships the exact defect step 0 existed to fix. `LESSONS` follows the index, so _every_ index
is self-consistent, and no derivable rule can rank one order above another. What catches it is the
handful of named claims in `lessons.test.ts` that assert this file's **content** is sane — the
first lesson is `first-program`, `sum-loop-tour` still precedes `array-in-memory`, and every
language lesson precedes every µarch one. Those are pedagogy, and pedagogy is not derivable — the
same reason M4 step 7 had to assert by name which position a step is _meant_ to be dead in.

Both order claims are kept rather than the older one being retargeted when M5 step 1 moved the front
door: "a loop before an array" and "an add before a loop" are separate opinions, and the first is
still the one that was live-wrong in the shipped product.

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

### Narration may name an instruction the anchor cannot see

M5 step 2's sharpest find, and the cheapest mistake to make. Its expert tier said `la` expands to
`auipc t0, 0x10000`; the transport, directly above the lesson panel, disassembles that instruction as
**`lui x5, 0x10000`**. (`la` lowers to `lui` + `addi` — see `pseudo.ts` — so the draft was wrong twice
in one sentence: the mnemonic, and "PC-relative".) **919 tests were green**, and structurally had to
be: the step anchors to a `reg-write`, which is agnostic about WHICH instruction wrote the register.
Anchor, value, order, narration-resolves — all correct, over prose naming an instruction that is not
in the program.

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

- **`array-in-memory`** — walking an array in `.data` (`array-sum`): the first `lw`, a negative
  element, the summed total (120), and the `sw` that writes it back.
- **`function-call`** — call/return linkage (`call-return`): argument setup, `jal` saving the
  return address, the in-function compare, and the result saved after `ret`.

The three above target **single-cycle** (M1) and anchor only to architectural events, so they play
against any model unchanged (INV-6).

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
