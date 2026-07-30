---
name: m14-width-lessons-step0
description: "M14 (the width DELTA lesson track — new lessons in the existing 'The wide machine' track, teaching widths 3/4 against the width-2 machine the learner already met). IN PROGRESS as of 2026-07-30: steps 0–4 done, all three lessons authored (`where-widening-stops`, `four-in-a-row`, `width-moved-the-work`) and the track's order pinned; only step 5 (the browser pass) is open. Read before authoring any width lesson, before trusting `lessons.test.ts`'s sweep as a net for a config-exclusive step, before choosing between a striking event and a safe anchor, before writing a number into prose a reader can see at more than one config, before assuming a lesson HAS a config-exclusive step to hang its ask on, and before adding or trusting a lesson-ORDER pin (an `indexOf` one is vacuous under a rename)."
metadata:
  node_type: memory
  type: project
  modified: 2026-07-30T02:58:15.488Z
  originSessionId: b34af334-e8a5-4166-b2fa-2bd6ee320a8a
---

M13 delivered widths 1/2/3/4 but deferred the lesson track by name ("the existing 'The wide machine'
track would gain a delta lesson, which is the M12 shape and its own milestone"). M14 is that
milestone. The four shipped wide lessons — `two-at-once`, `pair-that-cant`, `one-door`,
`one-branch-unit` — all declare `issueWidth: 2`, so their pair-shaped prose is LAWFUL, not a
contradiction with M13's group-shaped readout. The gap is that nothing teaches 3 or 4.

Step 0's dump: `M:\claud_projects\temp\m14-step0\dump.txt` (six programs × w2/w3/w4, at the config
the shipped lessons declare). Cycles/histograms/refusals were NOT re-derived — M13 step 0 measured
them and `timing.test.ts` pins them. This dump adds the only thing missing: per-cycle events WITH
PAYLOADS plus the width discriminator on the event multiset.

## The shipped defect step 0 found — ALREADY FIXED AND PUSHED (`458b4ce`)

**`lessons.test.ts`'s `CONFIG_AXES` width axis sat at a literal `[1-wide, 2-wide]`** while M13 raised
the product to four, so the four wide lessons were swept at HALF the widths the shell offers. It is
the **third instance of the shape that axis was added early to prevent**, and its own docblock says
so. No content was broken — every lesson assertion passes at 3 and 4; what was missing was the
RUNNING of them: **1022 assertions before, 1598 after** in that file; repo **6203 → 6779**.

Fixed by DERIVING the positions from `MAX_ISSUE_WIDTH` (M13 step 3's precedent for this exact
staleness class). Count pins take the half-derived shape `datapath-superscalar.test.ts` already uses
(`12 * MAX_ISSUE_WIDTH`): **derive only the term that went stale, keep the ones that never moved
literal, because a fully derived count is vacuous.**

## ⚠ The fix made the sweep a WEAKER net for the lessons M14 will write

The sweep's rule is "every step anchors in AT LEAST ONE position." With four width positions in the
product, a **width-exclusive step anchors at its own width and the sweep goes green** — while a
learner parked at w2 sees a silently-skipped step and prose about a machine they are not running.
That is [[m11-m12-review-resolved]]'s finding 2 one axis over, and it is **structurally invisible to
`lessons.test.ts`**. So M14 must carry, explicitly:

- the authoring rule — **the step BEFORE the first width-exclusive step asks for the flip, in prose**
  (`branch-bet`'s shape; `deep-bet-pays-double` is the counter-example that shipped broken);
- a **browser pass driving the real ISSUE control**. `useSimulator`'s anchor memo is keyed
  `(activeLesson, recorder)` and a config change mints a fresh recorder — but that is an INFERENCE
  about the width knob specifically, not a measurement. [[browser-is-the-only-net]].

## Pinned by precedent, not re-litigated

- **Declare `issueWidth: 2`, ask the learner to flip** — spec §12's flagship interaction, and the
  existing four lessons park the learner at exactly w2. Declaring w4 and quoting w2 numbers in prose
  is protected by NO declaration (the M4-step-4 / M12 cross-model trap).
- **Extend "The wide machine" rather than add a track** — same model, different knob. Extending
  touches neither `lessons.test.ts`'s exhaustive `toEqual` on track NAMES nor its pairwise order
  check; a new track makes both a hard edit.

## What the dump measured (read these before choosing subjects)

- **`'none'` ≡ `'static-not-taken'` is now MEASURED, not inferred** — byte-identical traces on all
  18 program×width combinations. So M13's dump (which swept `'none'`) describes the lesson config,
  and its cycle counts reproduce exactly. Two independent sources agree: `CONFIG_AXES`'s own
  docblock says "the positions are the BEHAVIORS, not the names."
- **`paired-branches` has an IDENTICAL EVENT MULTISET at w2, w3 and w4** — yet runs 7, 7, 6. The
  `branch-slot` refusal is width-INVARIANT (one branch unit is one at any width); the entire delta
  is WHEN instructions group and retire. **This is [[cycles-cannot-see-a-lost-forward]] running in
  REVERSE — here the events cannot see a WON cycle**, so for this subject the anchored CYCLE is the
  evidence and the multiset is blind. A step anchored on the last retire still works (c6 → c5); the
  DISCRIMINATOR just cannot be run on the multiset. Same for `byte-loads`.
- **`slow-op-loop` has genuinely w4-EXCLUSIVE events** — `forward{from=MEM/WB,to=EX.rs1,value=0,
instr=i5}` and `reg-read{reg=6,value=0,instr=i6}` both go 0 → 0 → 1. It is the only candidate with
  an anchorable w4-only beat, which (with step 3 calling it "the width axis's honest lesson") makes
  it the flagship: four independent `li`s form one group of four ONCE in six iterations, so the gain
  is **1 cycle, not 6**. ⚠ This bullet originally added "the loop body is byte-identical at w3/w4" —
  **step 2 measured that FALSE** as an event claim (a wider machine fetches wider, so the fetch
  stream differs every cycle). What is identical is the loop's GROUP SHAPE. See step 2 below.
  ⚠ Step 2 also found the `reg-read{reg=6,value=0}` named here is a **decoy as an anchor** — alive in
  45 of 48 config positions, on a different instruction.
- **`sum-loop` gains 11 `intra-pair-raw` stalls at w3** (0 → 1 → 1 each, so the delta is w2→**w3**,
  not w2→w4). ⚠ **A refusal count is NOT a penalty** — its `groupHist(w4)` is `{"0":22,"2":11,"3":10}`
  with no 1s and no 4s, so those refusals CAP groups at 2–3 rather than splitting a pair at a cycle
  each: eleven of them bought one cycle (44→43→43). Prose that counts refusals is right at w2 and
  wrong at w4 **with every anchor green** — the "a flush's `stages` array is not the penalty" trap
  one axis over. Narrate the TOTAL; measure the cycle DELTA between width positions.
- **`branch-flavors`' huge multiset delta is mostly instruction-ID RENUMBERING** (i8→i10 at the same
  pc and encoding, because a different number of instructions get squashed). Do not read it as
  behavioural change.
- **Only `branch-flavors`, `paired-branches`, `slow-op-loop` ever fill four slots** (measured and
  asserted by name in M13 step 3). Any beat about THE FOURTH SLOT must use one of those three —
  `sum-loop` never takes four and is disqualified from that subject.
- **`sum-loop`'s IPC is the sharpest honest number, and getting it slightly wrong is instructive.**
  `two-at-once` already tells the learner 0.77 at w2 against 0.61 at w1. **34 instructions retire at
  every width** (measured — not carried over from that prose, and not free, since `branch-flavors`
  renumbers wholesale across widths) over 44 → 43 → 43 cycles. So it is 0.7727 at w2 and **0.7907 at
  w3 — and the identical 0.7907 at w4.** The third slot buys 0.02 IPC; **the fourth buys this
  program nothing at all**, which is exactly what decision W chose width 4 to teach.
  ⚠ The first draft of this memory and of `m14-tasks.md` both said "at w4 it is 0.79, doubling the
  width again moves IPC by 0.02" — **arithmetically true and pedagogically backwards**, because it
  credits the fourth slot with the third slot's gain. Generalises past this milestone: **a figure
  quoted at ONE width cannot show where the gain stopped, and where it stopped is the whole subject.
  Always put the neighbouring width beside it.** It also fixes a discriminator: narration true at w3
  is equally true at w4, so lesson 1 can only ever discriminate against w2.

## Step 1 SHIPPED — `where-widening-stops` (`58ff293`, repo 6779 → 6887)

"Where widening stops paying": `sum-loop`, four steps, appended to "The wide machine" at position 5.
Declares w2, asks the learner to flip ISSUE to 3. Three findings worth carrying:

- **The cycle total is the WEAK form of a width claim; the retire-cycle MAP is the strong one.**
  44 → 43 → 43 says one cycle moved somewhere. Measured per instruction, **33 of the 34 retire on the
  identical cycle at w2 and w3** and the lone mover is the `ecall` — because at w3 the closing `bne`,
  `li a7, 10` and `ecall` form ONE issue group where w2's is full after two (confirmed on
  `state.micro.idEx`: `[i49 i50]`+`[i51 -]` against `[i49 i50 i51]`). The loop is untouched — every
  `branch-resolved` lands on the same cycle at all three widths. And **w3 ≡ w4 as a retire map, id
  for id**, which is "the fourth buys nothing" as data rather than an equal total two runs could
  share by coincidence. Generalises: **diff the maps, not the totals.**
- **`resolveNarration` falls back DOWNWARD, so an ask written only at `detailed` is invisible to an
  `expert` reader.** The config-flip request must be in EVERY authored tier of the asking step.
  Stripping it from `expert` alone reddens exactly one assertion and nothing else in 1705 sees it —
  and no browser pass at the default tier would either. This sharpens
  [[m11-m12-review-resolved]]'s finding 2, which only said "the step before, in prose".
- **A step that is LIVE at more than one config needs its numbers ATTRIBUTED, and `toContain` cannot
  check that.** The closing step fires at every width, so a bare "43 cycles" reads as a claim about
  the run in front of a reader who may be at 44 — the `forwarding-bubble` "51 over a transport
  reading 49" defect, arriving where **declaring harder cannot fix it**, because the lesson's subject
  IS the other position. The guard is `statesNumberBeside(text, width, value)`: the number within 70
  chars AFTER the width word. "two wide it takes 44, three wide 43" passes; "44 cycles, down to 43"
  fails; a token check passes both.

Method notes: **`nth` was measured across all 48 superscalar positions, not reasoned** — nth 3
anchors before the previous step everywhere (an order violation), nth 4 is the first that clears it.
The break harness then showed the pc pin beside it is **not** the sole net (nth 1 and nth 2 are both
caught first by the sweep's order check), so its comment says so rather than overclaiming. Adding a
lesson file touches **three** places or the suite reddens: `index.json`, the by-name track-membership
`toEqual`, and `LESSONS.length`.

## Step 2 SHIPPED — `four-in-a-row` (`2720e62`, repo 6887 → 6996)

"Four in a row": `slow-op-loop`, five steps, position 6. Declares w2, asks the learner to flip ISSUE
to **4**. The `static-taken` mirror was NOT taken (no step earned it; the beat belongs to
`paired-branches`, which is step 3's program). Six things worth carrying:

- **Write a width lesson on issue-group MEMBERSHIP, not on cycles and not on events.** Every sentence
  of this lesson is a claim about which instructions share a group; `groupPcs` (ID/EX occupancy read
  out as pcs) is the only channel that sees one. Pinning the whole sequence at all three widths made
  ONE assertion the evidence for six sentences:
  `w2 [t1 a0][t5 t6] 6×([sll][add addi][bnez a7]) [ecall]` = 21 groups; `w3 [t1 a0 t5][t6] 6×(…a7
ecall)` = 20; `w4 [t1 a0 t5 t6] 6×(…)` = 19. Cycles 35/34/33, and **cycles = groups + 14 at every
  width**, so "one group removed, one cycle saved" is arithmetic rather than two totals coinciding.
- ⚠ **The plan's "the loop body is byte-identical at w3 and w4" was FALSE as an event claim** — a
  wider machine fetches wider, so the fetch stream differs every cycle. Identical is the loop's GROUP
  SHAPE (three groups a pass at w2/w3/w4) and its retire spacing. Same class as M13's "a
  measurement's glob is part of its claim": name the channel the invariance holds on.
- **Three wide takes the same TWO prologue groups as two wide** (three heads, then the fourth alone
  with two slots idle, plus a refusal the widest machine lacks). So this is **the library's only ask a
  learner can HALF-SATISFY** — flipping to 3 leaves the width-exclusive step as silent as never
  flipping. The ask names the number and the oracle asserts `liveAt(3) === liveAt(2)`.
- **The gain's signature is a UNIFORM SHIFT, not a speedup**: 27 of 30 instructions retire exactly one
  cycle earlier at w4 than w3, the other three unmoved. The machine started sooner; it did not run
  faster. That is what stops a reader generalising the prologue's group of four to the loop.
- ⚠ **When the striking event and the safe anchor differ, anchor on the one whose existence conditions
  match the prose.** The vivid fact is the register file answering **0** for a counter that says 6 —
  but `reg-read{reg:6,value:0}` is alive in **45 of 48** positions, and with forwarding OFF it is the
  FINAL `bnez` (~c55), so a step anchored there narrates the prologue while pointing at the last
  branch. Anchored the REPAIR instead (`forward{MEM/WB→EX.rs1, value 6}`, alive in exactly **9 of
  48**), which cannot exist with forwarding off — **the prose is protected by the step's own anchor
  rather than by an author remembering.**
- ⚠ **Refusals here are not even MONOTONIC**: 6 → 13 → 12 against 35 → 34 → 33, so the fastest machine
  is neither the least- nor the most-refused. Step 1's version only had them rising with the speedup.
- ⚠ **An advisor caught an off-by-one the plan's own step text would have shipped**: "the wider
  machine's extra loop slot holds work the flush throws away" is true on **five of six passes** — on
  the sixth the branch falls through and those two instructions are the program's exit, in the group
  the closing step walks past. Measured per pass, NOT off `flush.stages` (which does shift
  `EX,ID`→`EX` here and is a casualty list, not a cost).

Method notes: the six helpers step 1 left as `describe`-locals were **hoisted to module scope first,
unchanged, as a separate mechanical move** — a claim measured differently in two lessons is two
claims; `retireCycles` became `retireCycleById` because `deep-drain` has its own returning a list.
**8 breaks run, 8 reddened the intended test** — the load-bearing ones: a de-attributed closing
sentence (identical tokens, only `statesNumberBeside` sees it), `nth: 1` (reddens the dedicated test
AND the generic sweep's order check in the 9 live positions), and mutating `groupPcs` to drop each
group's last member. The two M14 lessons have **OPPOSITE discriminators** (w4 is not one for lesson
1; w3 is one for lesson 2) and both oracles say so, because a later "strengthening" pass will want to
flatten them.

## Step 3 SHIPPED — `width-moved-the-work` (`50c50db`+`56ac7cf`, repo 6996 → 7105)

"The width that moved the work": `paired-branches`, five steps, position 7. Declares w2, and the ask
is **TWO-STAGE** — flip to 3, then to 4. **The CONDITIONAL resolved to SHIP**: no new event, no new
field, no new program, no engine change. Five things worth carrying:

- **A lesson can have NO config-exclusive step, and that INVERTS where the ask's protection comes
  from.** The identical multiset means every step anchors at every width, so the exclusive-step
  search both siblings hang their ask on (`exclusive === [2]`) returns `[]` here. Good for the
  reader — the runner can never silently skip a step — and bad for the net: **strip the ask and
  nothing anchoring, ordering or sweeping notices.** Pin it POSITIONALLY, by literal step index, at
  all three tiers, and assert the live-step sets at w2/w3/w4 are EQUAL so nobody later "strengthens"
  the lesson by inventing an exclusive step.
- **With the multiset identical, the discriminator is the lesson's own ANCHOR VECTOR** — and the
  strong form is not "the vectors differ" but **each flip moves exactly ONE anchor, and a different
  one**: `[0,1,2,4,6]` at w2, `[0,1,2,3,6]` at w3, `[0,1,2,3,5]` at w4. Retire maps say the same on
  the other channel: `i3: 6→5` at w3 with the run **exactly as long**, then `i4: 6→5` at w4.
- ⚠ **The refusal trap's third and sharpest face: the count is FLAT while the clock falls.**
  `branch-slot` is 0, 1, 1, 1 against 9, 7, 7, 6 cycles, so **the machine WITH the refusal is faster
  than the one without**. Step 1's rose with the speedup, step 2's was non-monotonic; this one cannot
  be read as a cost at either end. `branch-slot` cannot climb with width at all — the hardware it
  names was never replicated.
- ⚠ **The plan's own decision-table REASON was falsified by measurement.** The row said w4 "because
  7 → 7 → 6, so w3 is not a discriminator for it either." w3 **is** one — on the retire map, the
  group shape (`{1,2,2}` → `{1,3,1}`) and the anchored cycle. It is not one on the CYCLE TOTAL, which
  is this milestone's own "totals are the weak form" trap **appearing inside its own decision table**.
  Generalises: a pinned decision's REASON goes stale the same way its answer does, and step 1's
  finding is the thing that falsifies it. Hence the two-stage ask — a reader who jumps to 4 never
  sees the third slot fill, which is the lesson's subject.
- ⚠ **Reject a config mirror on a MECHANISM, not on burden.** Under `static-taken` this program runs
  13, 12, 11, 11 — the THIRD slot pays and the fourth does not, **exactly inverting** the not-taken
  9, 7, 7, 6. Striking, and unauthorable: `stall{branch-slot}` anchors null in all 24 static-taken
  positions (a bet redirects fetch before the two transfers are ever candidates together), so asking
  the reader to flip PREDICTION kills step 2 in silence. The draft reason ("it doubles the ask
  burden") would not have held. Same finding as [[m11-m12-review-resolved]] #2.

Method notes: **10 breaks run, 10 reddened the intended test.** The load-bearing one is the advisor's:
moving the declared `issueWidth` to 3 had **a single net** until both ask targets were DERIVED
(one notch wider than the declaration; `MAX_ISSUE_WIDTH`) — now two. An advisor also caught a
sentence one draft from shipping: "the group behind the younger branch holds three instructions" is
true at w3 and **false at w4** (it holds four) while `li a7` executes at cycle 3 in both, so the
anchor is identical and green either way — step 1's attribution trap arriving on a GROUP claim
instead of a cycle count. **Attribution is the WHOLE protection here**, a first: with no
width-exclusive step, no anchor keeps any prose off the wrong machine, so `statesNumberBeside` runs
over every figure in every step. Step 2 deliberately reuses `one-branch-unit`'s anchor (nothing pins
cross-lesson anchor uniqueness) — there the refusal is introduced, here re-read as width-invariant.

A closing advisor pass found three unmeasured prose claims and one **unsatisfiable future
acceptance**, all fixed (4 more breaks, 4 reddened): the closing step's punchline is the
CO-VARIANCE of two arrays pinned independently, so `cycles − groups === [4,4,4,4]` is now asserted
(the sibling's `idle === [14,14,14]` on a program with no flush shadow); the opening tier's only
FETCH claim had no pin, since every other pin reads ID/EX occupancy and it names instructions rather
than digits so `statesNumberBeside` could not reach it; and the crux step's bare "7 cycles" is the
step that SENDS the reader to width 4 (where it is 6), so it is now scoped and attribution-checked.
**Generalises: the step most likely to be misread is the one that asks for the flip, not the one
after it.**

## Step 4 SHIPPED — the order pin (`16b596c`, repo 7106 → 7107)

Wiring was already done; the live work was the WITHIN-track order pin. 4 breaks, 4 intended results
(3 reddened, 1 deliberately green). Four things worth carrying:

- **Apply the "does a sentence LIE when reordered" discriminator per REFERENCE, not per track.** The
  wide lessons name each other **seven** times and only **four** are claims about what the reader has
  already done. "Compare \"The pair that can't\", where the same event…" is an INVITATION — true
  whether or not that lesson was read — so `pair-that-cant`'s position stays UNPINNED; and
  `width-moved-the-work`'s expert "\"Four in a row\" goes 6, 13, 12" is a fact about another lesson's
  numbers, so that link is pinned on step 2's `detailed` tier instead (past tense, and it does lie).
  `one-door` is named by nothing and earns nothing. The rejected candidates go IN the comment — that
  record is what keeps the pin defensible under its own rule.
- ⚠ **`indexOf` makes an order pin VACUOUS under a rename — measured, not reasoned.** It returns -1,
  and -1 is less than every real index. Rename `two-at-once` in the index with the guard removed and
  the pin is **green on an id that no longer exists**. `toBeGreaterThanOrEqual(0)` (the OoO pin's
  shape) is load-bearing here; the cache track's pin above it still has the hole. It is NOT the sole
  net for a rename though — 3 other tests catch one — so the comment says so.
- **The order pin IS the sole net for a REORDER — the opposite of step 1's `nth` result.** Swapping
  two ids reddens exactly 1 test of 7107; deleting a referring sentence reddens exactly 1. Nothing
  else in the suite sees either, which is why the sentence is asserted BESIDE the index.
- **The pinned chain is broader than the decision row asked about**: `two-at-once` <
  `where-widening-stops` < `four-in-a-row` < `width-moved-the-work`, plus `one-branch-unit` <
  `width-moved-the-work`. Two of the four earned links reach back into the M8 four, so "the order of
  the three" was never answerable among the three. And the unpinned positions are a KNOWN hole:
  shuffling the four M8 beats among themselves leaves all 1926 tests in the file green.
- Method: "the track-name `toEqual` and the pairwise pins are untouched" is a claim about what steps
  1–3 DID, and reading the current file cannot settle it — checked on `git diff 458b4ce~1..HEAD`
  hunk offsets.

## What is left

⚠ **Step 5's stated acceptance is UNSATISFIABLE for lesson 3, and the plan now says so** — "the
rail's count changes across the flip and the surviving steps are not the same set" cannot hold for a
lesson with no width-exclusive step. Its substitute is stricter, not weaker: **the dots MOVE and the
count does not** (crux c4→c3 on the flip to 3, closing c6→c5 on the flip to 4, five dots throughout).
Written down BEFORE the browser pass, because relaxing an acceptance mid-run is how
`deep-bet-pays-double` justified a gap with prose that did not exist.

**Only step 5** — the browser pass driving the real ISSUE control. [[browser-is-the-only-net]], and
the only net that can see a learner who never flips.
