---
name: m5-isa-lesson-track
description: "M5 build log (the ISA lesson track): the order spine, three lessons, and the finding it re-earned every step - a plan's anchor sketch is unbuildable when it asks for more steps than the program has instructions, and halting is STATE, not an event, so it cannot be a step."
metadata:
  node_type: memory
  type: project
---

## M5 — the ISA track: PLANNED, NOT STARTED (`docs/plans/m5-tasks.md`)

**The plan's finding is that the request was bigger than the gap.** Its framing was "arithmetic,
branches, memory, calls" — but the **inventory** (which the advisor insisted on before any
proposal) shows `array-in-memory` already teaches memory, `function-call` already teaches calls,
and `sum-loop-tour` already walks a loop with a backward branch: **the three single-cycle lessons
ARE an intro track**, unsequenced and unnamed. Meanwhile **two corpus programs carry NO lesson**,
and both are already teaching artifacts: **`add.s`** (5+37=42, and the only program with **no
`ecall`** ⇒ halts `pc-out-of-range`, exactly what the panel's new prose describes) and
**`byte-loads.s`**, whose own header says it exists to show _"the classic load-extension trap"_
and which **nothing has ever taught with**. ⇒ the track needs ~**zero** new programs, not four.

Two headline decisions: **the panel owns GRAMMAR, the track owns BEHAVIOUR-OVER-TIME** — forced by
INV-6, not taste ("what `add` does" anchors to a `reg-write`; "`add`'s syntax is `rd, rs1, rs2`"
**has no anchor**, because syntax is not a thing that happens in a cycle). And **a track IS an
order, and today's is an accident**: `lessons.ts` sorts by `id.localeCompare`, so the picker
offers `array-in-memory` first and `sum-loop-tour` last — **the SAME defect the panel shipped and
fixed this week, one surface up and already live in the product**. There is no source for
pedagogical order ⇒ declare it in content (`index.json`, pinned exhaustive both ways). _A
`localeCompare` is not an opinion about teaching; it is the absence of one, wearing determinism as
a disguise._

**M5 STEP 0 DONE 2026-07-17 (895 tests, `ee9331a`): THE ORDER SPINE.** `content/lessons/index.json`
is now the only source of picker order; `lessons.ts` reads it instead of `localeCompare`. Authored:
`sum-loop-tour` → `array-in-memory` → `function-call` → `forwarding-bubble` → `branch-bet` (step 4's
target minus the two unbuilt lessons). Browser-verified on the shipped bundle: "Anatomy of a loop"
leads (was "Walking an array in memory"), five options, promoted lesson opens with its 5-step rail.

**THE ACCEPTANCE LINE WAS BACKWARDS, and MEASURING it is the finding — the plan's own pin was the
weaker half.** It asked "index ≡ set both directions; dropping an id reddens exactly the index
test". Two mutations: drop an id → **three** tests redden (all true consequences); re-author the
index **alphabetically** — exhaustive, self-consistent, and the exact defect step 0 exists to end
→ **the index test stays GREEN**. `LESSONS` is DERIVED FROM the index ⇒ **every index is
self-consistent**, so exhaustiveness pins that the CODE READS the index, never that the INDEX
TEACHES. Following the acceptance literally ships machinery faithfully implementing
`localeCompare`. What catches it: two claims asserted **BY NAME** about the index's CONTENT (first
lesson is `sum-loop-tour`; every language lesson precedes every µarch one) — **pedagogy is not
derivable**, exactly M4 step 7's "which position a step is _meant_ to be dead in". 3rd milestone
running for _a guard whose case list cannot reach the defect is not a guard_. ⇒ **Whenever a plan
says "pin X ≡ Y", ask what a self-consistent X∧Y still gets wrong.**
Two smaller: **the glob would have EATEN the index** (`import.meta.glob('*.json')` sits on the
lessons' own dir ⇒ `index.json` casts to a `Lesson`, ships as a step-less 6th entry) — fixed by ONE
glob partitioned by path, since a direct `import` would need the same exclusion anyway (removes the
problem rather than moving it). And **one existing test passed ONLY because it was alphabetical**:
pipeline-membership read `toEqual(['branch-bet','forwarding-bubble'])`; authored order (M3's
flagship before M4's) reddens it — its own sentence is about MEMBERSHIP, so it now `.sort()`s
first; order is pinned ONCE, against the index. `orderLessons` exported PURE (M3 step 0's shape: a
sort mistake does not fail, it re-invents an order and leaves every test green); unlisted lessons
sort LAST, never dropped — the index controls order, never membership, because a misplaced lesson
is visible and a missing one is not.

## M5 STEP 1 DONE — `first-program` on `add.s` (2026-07-17, 907 tests)

The track's front door ships: `content/lessons/first-program.json`, "The smallest program that
computes something", 3 steps, single-cycle, first in `index.json`. `add.s` UNCHANGED, zero new
format fields, zero engine/renderer change. Browser-verified both themes.

**THE PLAN'S OWN ANCHOR LIST WAS UNBUILDABLE — PIGEONHOLE, and that is the finding.** It asked for
4 anchors (2 constants, the `alu-op`, then 42 landing). `add.s` is 3 instructions; single-cycle runs
one per cycle; the cursor addresses a **CYCLE** and the validator forbids two steps sharing one ⇒
**a single-cycle lesson has AT MOST AS MANY STEPS AS ITS PROGRAM HAS INSTRUCTIONS.** An arithmetic
ceiling, hit in AUTHORING rather than in code. Measured as 2 mutations, the 2nd unpredicted:
single-cycle **collides** (`steps share a cycle...: [[2,[2,3]]]` — the ALU result and its write-back
are one cycle because that is what single-cycle MEANS); pipeline **forwarding-on is OUT OF ORDER**
(`expected [ 2 ] to deeply equal []` — the ALU computes 42 at cycle 4 while `x2=37` is not written
back until cycle 5, so "now the ALU adds" placed between "37 arrives" and "42 lands" is **FALSE** on
a forwarding machine: the add takes 37 from the forwarding network, never from the register file).
Two machines reject one authoring for two unrelated reasons ⇒ a rule, not a workaround. **The
temptation worth naming: the 4th step IS buildable on multi-cycle** (phases spread out) — declining
it is the point, the language track is single-cycle because the machine is not its subject.

**HALTING IS STATE, NOT AN EVENT ⇒ it cannot be a step.** `TraceEvent` has **no `halt` arm**;
`pc-out-of-range` is not an instruction, it is where the PC ends up. Steps anchor to events (INV-6),
so the halt rides on the LAST step's narration. Free here: the halt lands on **the SAME cycle as the
payoff in ALL FOUR machines** (single-cycle 2, multi-cycle 11, pipeline 8/6) ⇒ "the processor stops
right here" is WATCHED, and the transport reads `— halted` beside it. Pinned as STATE
(`{halted:true, pc:12}`); **the `pc` is the load-bearing half** — it says the machine ran off the END
of `.text`, which an `ecall` halt would NOT (it leaves the PC on the `ecall`), so a corpus edit
giving `add.s` an exit would keep a `halted`-only test green while deleting the lesson's subject.
⇒ "reconsider the program's ending" = **NO**: `add.s` is the corpus's ONLY `ecall`-free program, so
its ending is the only place the track can teach halting (and INV-7 would ripple it everywhere).

**THE FRONT DOOR COMPUTES INTO `ra` AND `sp`, AND ONLY THE BROWSER SAYS SO.** `add.s` uses x1/x2/x5,
which the register panel names **`ra`/`sp`/`t0`** ⇒ the track's first lesson narrates "5 goes into
x1" beside a row reading `ra`, and a beginner's first program computes into the return-address and
stack-pointer registers. **No test can see it: the lesson is true, the panel is true, they disagree
only in the reader's head.** `add.s` stays (INV-7) ⇒ fixed with ONE CLAUSE in step 1 (the nicknames
are an ABI convention about how functions agree to share registers, not a hardware rule, and this
program ignores them) — on-topic, since the step's own first sentence is "registers are named
slots", and it lands directly above the panel it explains. Advisor caught that I had SPOTTED this at
the screenshot, said I'd log it, and then didn't — **the thing you notice and defer is the thing you
lose.**

Three smaller: **`addi` emits `alu-op` with `op:"add"`**, not `"addi"` ⇒ the obvious
`{event:'alu-op', where:{op:'add'}}` matches the FIRST `addi`, not the `add` (reg-write triggers
sidestep it). And the eyeball's own trap: **forcing `data-theme` via CDP renders a HALF-DARK page**
that reads exactly like a theme defect and is not one — the shell's inline styles read a React-held
theme object the attribute never touches ⇒ **click the real toggle**. And the **depth dial's buttons
carry the RAW tier id** (`essentials`) — they only READ capitalized via CSS `text-transform`, so a
driver matching the on-screen spelling finds nothing. Both present as product defects; neither is
one. All 3 TIERS then rendered in-browser (not just `detailed`, the only tier the validator
resolves — the other two are authored-but-unproven until something looks). See
[[browser-rig-chrome-cleanup]], whose `taskkill //IM chrome.exe` advice **closed the user's real
browser** and is now corrected (fresh `--user-data-dir` per run is the actual fix for the
stale-profile lock it was working around).

## M5 STEP 2 DONE — `sign-and-zero` on `byte-loads.s` (2026-07-17, 919 tests, `6e876d7`)

The corpus's last orphan finally taught with: "One byte, two answers", `0x80` read as −128 by `lb`
and +128 by `lbu`. Three steps on single-cycle, third in `index.json` (after `sum-loop-tour`; step 4
is still the real sequencing pass). Zero format fields, zero engine change, **zero renderer change —
a decision, not a default.**

**The plan's anchor sketch was unbuildable AGAIN — but NOT for step 1's reason, and the distinction
is the finding.** Step 1 hit a COUNT ceiling (4 steps > 3 instructions). `byte-loads.s` is **six**
instructions, so counting was never binding. The rule that bit is narrower: on single-cycle a load's
`mem-read` and its `reg-write` are **one cycle**, so the raw byte and the extended value cannot be
two steps (measured: `steps share a cycle ... [[2,[1,2]]]`). It bites an authoring the count permits.
The contrast axis collapses from read-vs-write to **`lb`-vs-`lbu`** — the better lesson anyway.

**THE DATAPATH DISAGREES WITH THE TRACE, and only the browser said so.** The two `mem-read` events
are byte-identical (`value: 128` both — the lesson's thesis, now pinned) while `datapath.ts` drives
the Data-Memory output wire from `regWrite.value` (`if (isLoad) w('dmem-wb', regWrite.value, 'dec')`),
so **on screen that block emits −128 for `lb` and 128 for `lbu`**. The draft's "the two memory reads
are identical" was contradicted on the CENTERPIECE view at the DEFAULT tier, every test green.
Relocating the pointer would not have fixed it — the contradiction is visual. **Renderer left alone
on purpose:** the diagram has no extender box, so the Data-Memory block IS the load unit (P&H's
convention); sourcing the wire from `memRead.value` would show 128 into the write-back mux and −128
out of it — a selector that appears to TRANSFORM its input, a worse and always-on lie. The honest fix
(draw the extender) spans three datapath files and is a µarch-view question, not a content one. So
the narration reconciles: it grounds "same byte, same address" in what is **visibly constant** (the
data-memory panel's `0x00000080`, unchanged across all 3 steps; the `0x10000000` arriving at Data
Memory on both loads) and names extension-inside-the-block as why the outputs differ. **`byte-loads.s`
is the ONLY corpus program where `mem-read.value` and `reg-write.value` disagree** (every other load
is an `lw`) — which is why nothing ever had to decide this. The orphan was hiding a VIEW decision.

**THE EXPERT TIER NAMED AN INSTRUCTION THAT IS NOT IN THE PROGRAM, and 919 green tests could not see
it.** The draft said `la` expands to `auipc t0, 0x10000`; the transport directly above disassembles it
as **`lui x5, 0x10000`**. `pseudo.ts`: `la` → `lui`(hi reloc) + `addi`(lo reloc), **absolute, not
PC-relative** — wrong twice in one sentence. Structurally invisible: the step anchors to a `reg-write`,
which is agnostic about WHICH instruction wrote the register, so anchor/value/order/narration-resolves
were all green. **THE RULE: an anchor pins a TRANSACTION, never the sentence wrapped around it** —
anything narration asserts beyond the anchored event (a mnemonic, an expansion, a cycle count, a claim
about another panel) is unguarded by construction. Now pinned via the recording's in-flight list
(`instructions[].decoded.mnemonic`), mutation-checked. Also: `la` emits the pair even when the low 12
bits are zero, unlike `li` (`materialize32` collapses to a bare `lui` when `lo === 0`) — which is why
the reader sees a second write to t0 that changes nothing.

Two smaller finds. **The first eyeball's checks were VACUOUS**: regexes for `-128`/`0x80` over
`document.body.innerText` match the SOURCE panel's own comments (`# t1 = -128 (sign-extended)`) —
green while proving nothing. Reading the real Registers table rows is what verified it (`t1` →
`0xffffff80`/−128 highlighted on its cycle, `t2` → `0x00000080`/128). A check whose case list cannot
reach the defect is not a check — this project's recurring shape, now one layer down in the DRIVER.
And **the transport disassembles to `xN` while the corpus writes ABI names**: the reader sees `lb x6,
0(x5)` above prose saying `t1`. The mirror of step 1's `ra`/`sp` find and much milder (the register
panel lists both spellings side by side), so step 1 bridges it in one clause. See
[[browser-rig-cdp-recipe]], now corrected on the theme trick and the profile-dir advice.

## M5 STEP 3 DONE — `which-is-smaller` on the new `branch-flavors.s` (2026-07-17, 950 tests, `c9d7682`)

The scope question flipped: `call-return` could NOT carry it (its `bge` is already taught by
`function-call`, and taken-vs-not-taken is already taught by `sum-loop-tour`), and the signed/unsigned
trap was **definitionally invisible** on the old corpus — for every operand it ever compared, `blt`
and `bltu` agree. Not untaught: unreachable. That is the bar for a new corpus citizen, now written into
`content/programs/README.md`: **name what the existing corpus makes unreachable, not what a new program
would make nicer.**

**Steps 2 and 3 are a MIRRORED PAIR — the milestone's best finding.** Step 2 is "looks different, is
same" (the datapath shows −128/128 over byte-identical `mem-read`s); step 3 is "looks same, is
different" (`blt`/`bltu` show identical operand wires and decide opposite). Both fixed in narration,
not code, by one argument: **an interpretation never belongs on a wire** — the reading happens inside
the load unit / the comparator, and neither is drawn.

## M5 STEP 4 DONE — tracks + the sequencing pass (2026-07-17, 956 tests, `0aa61a1`)

**THE PLAN'S OWN TARGET ORDER WAS WRONG.** This step was meant to be a no-op on order — steps 1–3 each
inserted their lesson at the slot the plan named, so `index.json` already matched. It matched, and the
shipped track taught **`lb`/`lbu` at position 3 and `lw` at position 5: the exception before the rule.**
Forced by the lessons' own prose, so it became a test: `array-in-memory` step 1 _introduces_ the concept
("`lw t2, 0(t0)` reads a word from data memory into a register") while `sign-and-zero` step 1, two
lessons earlier, already _spends_ addresses, loads and the data-memory panel. Order is now
`first-program → sum-loop-tour → array-in-memory → sign-and-zero → which-is-smaller → function-call`;
the mirrored pair stays adjacent and in its cross-reference direction (`which-is-smaller`'s expert tier
calls back to `lb`/`lbu` — **a callback to a lesson the reader has not had is not a callback**).

**Why three steps missed it, and it is not carelessness:** steps 2 and 3 each wrote "step 4 is still the
real sequencing pass" and parked their lesson at the guessed slot — correctly, because authoring a lesson
reads its program and its anchors and **never reads the other five**. Incremental insertion structurally
cannot see a sequence. The only instrument is a person reading the track top to bottom, which is now the
README's instruction. **An order can be authored, exhaustive, self-consistent and fully pinned — and still
teach the exception before the rule.** Declaring the index only moves the decision to where a human _can_
make it; nothing makes them read it.

**Track is declared content (grouped `index.json`), NOT derived from `model`** — the picker shows the two
groups as `<optgroup>`s. `model` says which µarch a lesson RUNS ON; a track says what it is ABOUT; they
coincide by coincidence (all 6 language lessons are single-cycle). Deriving it would be step 0's
`localeCompare` a third time. Measured: **file `branch-bet` under "The language" → exactly ONE test of 125
reddens**, the by-name one; every structural check stays green (the mis-filing is still self-consistent),
and the retired `model` proxy stays green too (probed directly). Third milestone running for **pedagogy is
not derivable, assert it by name**. Not a `track` field on `Lesson` — pre-declined; one decision, one place.
Order is derived from the tracks by **flattening**, so grouping and order cannot contradict.

**The grouped picker had to RE-EARN step 0's totality rule** — a group-only render silently drops a lesson
in no track, trading a misplaced lesson for an invisible one, the exact trade step 0 refused, reintroduced
by the feature reading the same file. Hence a trailing `Not in a track` heading that renders only when
authoring is wrong.

**Naming: nothing renamed, deliberately.** The two riddle titles ("One byte, two answers", "When -1 is not
less than 1") are the two lessons whose subject IS a trap, so the title promising a surprise tells the truth;
the group heading supplies the frame they lacked. The two track names are the step's naming output.

**A logged claim from step 3 was FALSE:** the program picker does _not_ "open on `add` by alphabetical luck"
— `useSimulator.ts` explicitly prefers `sum-loop` (browser-confirmed on a fresh load). Its _list_ is still
alphabetical and stays so: a lesson picker's order IS the teaching, but the program picker is a **lookup**
surface, where alphabetical is predictable — the ISA panel already settled the same split (editorial order
for groups a learner reads, `sort` by register number for the lookup table). **Step 0's conclusion does not
transfer just because the code rhymes.** The check that found this was vacuous first: it read the picker
_after_ driving a lesson and reported that lesson's own program — a check measuring its own leftover state,
the eyeball's recurring failure mode for the fourth step running.

**NEXT: M5 step 5 — the hand-off the panel cannot make.** The track's closing beat should send the reader to
the editor ("now change the 37 and watch 42 move"). Nothing in the lesson format expresses "go edit"; the plan
says check whether prose alone is enough **before** proposing a field (it probably is). Acceptance: a reader
finishing the track has edited a program, and no field was added.
