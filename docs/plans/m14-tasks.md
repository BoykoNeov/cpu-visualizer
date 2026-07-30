# Milestone 14 — The width delta lesson track

**Status: IN PROGRESS — steps 0, 1, 2 and 3 DONE (`458b4ce`, `58ff293` 2026-07-29; `2720e62`,
`50c50db`+`56ac7cf` 2026-07-30). Step 1 shipped `where-widening-stops`, the thesis; step 2 shipped
`four-in-a-row`, the flagship; step 3 shipped `width-moved-the-work`, the CONDITIONAL — which
resolved to SHIP, with no new event, field, program or engine change. All three subjects are
authored. **Steps 4 and 5 remain**, and step 4 is now a VERIFICATION step rather than a wiring one:
each lesson wired its own id as it landed, so the picker already shows seven. Original step-0 note
follows.**

**Step 0 DONE 2026-07-29. The dump is run
(`M:\claud_projects\temp\m14-step0\dump.txt`) and the pre-milestone defect it uncovered is ALREADY
FIXED AND PUSHED (`458b4ce`, repo 6203 → 6779 tests): `lessons.test.ts` was sweeping the four shipped
wide-machine lessons at two of the four widths the shell offers. That was live in shipped code and
did not belong inside an unpinned milestone — M13 step 0b's precedent. The three SUBJECTS are pinned
(user, 2026-07-29): all three ship, matching M12's track size. Everything else in the decisions table
is open, and none of it gates step 1.**

Source of truth for scope: `cpu-visualizer-spec.md` §13 (the curriculum system) and §12.4 (the
superscalar tier). The load-bearing invariants are INV-6 (lessons anchor to trace EVENTS, never cycle
numbers) and INV-2 (depth is a property of the view, not the engine). The track's ground truth is
`docs/plans/m7-tasks.md` (the machine) and `docs/plans/m13-tasks.md` step 3 (its behaviour at widths
3 and 4, already derived and pinned in `timing.test.ts`).

## Why this milestone, and why now

M13 raised the product's widest machine from two to four and deferred the teaching by name: _"the
existing 'The wide machine' track would gain a delta lesson, which is the M12 shape and its own
milestone."_ This is that milestone. The four shipped wide lessons — `two-at-once`, `pair-that-cant`,
`one-door`, `one-branch-unit` — all declare `issueWidth: 2`, so their pair-shaped prose is **lawful,
not a contradiction** with M13's group-shaped readout. The gap is that **nothing in the library
teaches 3 or 4**, and width 4 was chosen (decision W) precisely because it is where widening visibly
STOPS paying. The tier ships a control the curriculum never explains.

This is the second delta track, after M12's. What is genuinely new: M12's delta was against a
different MODEL (`pipeline` → `deep-pipeline`), so a lesson's `model` declaration protected every
comparison. **Here the delta is against a different KNOB on the same model**, which is a weaker
declaration and a stronger interaction — spec §12's flagship "same program, flip the toggle, watch
it change."

## The dump (the design's factual ground) — RUN 2026-07-29

`M:\claud_projects\temp\m14-step0\dump.txt`. Six programs × {w2, w3, w4} at the config all four
shipped lessons declare (forwarding on, `static-not-taken`, no cache).

**Deliberately NOT re-derived:** cycles, issue-group histograms and refusal counts. M13 step 0
measured them and `timing.test.ts` pins them; re-deriving would be the M7 step 2b trap (copying
counts out of the engine). This dump adds the one thing no existing artifact holds — **per-cycle
events WITH PAYLOADS**, so an author can read a `where` clause straight off a line, plus the width
discriminator computed on the **event multiset** rather than on cycle counts
(`cycles-cannot-see-a-lost-forward`).

### What it establishes

- **`'none'` ≡ `'static-not-taken'` is MEASURED, not inferred** — byte-identical traces on all 18
  program×width combinations. So M13's dump (which swept `'none'`) does describe the lesson config,
  and its cycle counts reproduce here exactly. Two independent sources agree: `CONFIG_AXES`'s own
  docblock already says "the positions are the BEHAVIORS, not the names." Stated because the
  alternative was to trust a docblock's reason, which the M13 review named as its own trap.
- **Cycle totals at the lesson config**: `sum-loop` 44 → 43 → 43, `slow-op-loop` 35 → 34 → 33,
  `paired-branches` 7 → 7 → 6, `array-sum` 42 → 36 → 36, `branch-flavors` 11 → 10 → 10,
  `byte-loads` 9 → 8 → 8.
- **`sum-loop` retires 34 instructions at ALL THREE widths** (measured from the dump, not carried
  over from `two-at-once`'s prose). That is what makes an IPC comparison across widths
  apples-to-apples, and it is not free: finding 4 shows `branch-flavors` renumbering its
  instructions wholesale across widths, so a differing retire count is a real possibility that has
  to be checked per program rather than assumed.

### The four findings that decide the track

1. **`paired-branches` has an IDENTICAL EVENT MULTISET at w2, w3 and w4** — every event type, every
   payload, every count — while running 7, 7, 6. The `branch-slot` refusal is **width-invariant**
   (one branch unit is one branch unit at any width); the entire delta is WHEN instructions group
   and retire. This is `cycles-cannot-see-a-lost-forward` **running in reverse: the events cannot see
   a WON cycle.** `byte-loads` is the same shape. See the dedicated section below.
2. **`slow-op-loop` is the only candidate with genuinely w4-EXCLUSIVE events** —
   `forward{from=MEM/WB,to=EX.rs1,value=0,instr=i5}` and `reg-read{reg=6,value=0,instr=i6}` both go
   0 → 0 → 1. With M13 step 3 calling its behaviour "the width axis's honest lesson" in those words,
   it is the flagship.
3. **A refusal count is NOT a penalty, and this is the milestone's signature trap.** `sum-loop` gains
   eleven `intra-pair-raw` stalls — but at **w3**, not w4 (each goes 0 → 1 → 1) — and its
   `groupHist(w4)` is `{"0":22,"2":11,"3":10}`, with no 1s and no 4s. Those refusals **cap groups at
   2–3 instead of 4**; they do not split a pair at a cycle each the way `pair-that-cant` narrates at
   w2. Eleven of them bought ONE cycle. Prose that counts refusals is right at w2 and wrong at w4
   **with every anchor green** — "a flush's `stages` array is not the penalty" (M12) one axis over.
4. **`branch-flavors`' enormous multiset delta is mostly instruction-ID RENUMBERING** — `i8` → `i10`
   at the same pc and the same encoding, because a different number of instructions get squashed. A
   multiset diff is not self-interpreting; read the pc, not the id.

## Headline decision — the lessons declare width 2 and ASK for the flip

The subject is a difference BETWEEN widths, and a lesson declares ONE `issueWidth`. Two shapes were
available and the choice is not close:

- **Declare w4, quote w2 in prose.** Rejected. A number true only under an undeclared width is
  protected by NO declaration — the M4-step-4 trap (numbers true only under an undeclared prediction
  scheme) and M12's cross-model mirror (true only on an undeclared model), a third time.
- **Declare w2, ask the learner to flip ISSUE.** ✅ **Chosen.** It is spec §12's flagship interaction
  in its purest form, the existing four lessons park the learner at exactly w2 so the track continues
  from where it left them, and `branch-bet` / `deep-bet-pays-double` already establish the
  config-exclusive shape.

**The price, and it is paid explicitly in every step.** M11+M12 review finding 2 is a hard authoring
rule: **a lesson with config-exclusive steps must ASK for the config change, in the step BEFORE the
first step that needs it.** `runner.ts` skips an unanchored step in SILENCE and the rail quietly
reports the smaller count. `deep-bet-pays-double` shipped broken on exactly this and its plan
recorded the gap as "known and deliberate", justified by prose that did not exist.

## ⚠ The net got WEAKER the day before this milestone, and step 0 is what did it

Step 0's own fix (`458b4ce`) widened `lessons.test.ts`'s sweep from 2 width positions to 4. That is
correct and it found nothing broken — but it changes what the suite PROVES for the lessons M14 is
about to write. The sweep's rule is _"every step anchors in AT LEAST ONE position."_ With four width
positions in the product:

> A width-exclusive step anchors at its own width position and **the sweep goes green** — while a
> learner who never touches the ISSUE control sees a silently-skipped step and prose about a machine
> they are not running.

**This is structurally invisible to `lessons.test.ts`, and no amount of widening fixes it** — a
broader sweep makes it MORE likely to pass, not less. It is caught by exactly two things, both of
which every lesson step below must carry:

- the authoring rule above (the prior step asks for the flip, in prose a reader actually sees), and
- **a browser pass driving the real ISSUE control** (step 5). `useSimulator`'s anchor memo is keyed
  `(activeLesson, recorder)` and a config change mints a fresh recorder — but that is an INFERENCE
  about the width knob specifically, read off a `useMemo` dependency list, not a measurement.
  `browser-is-the-only-net`.

## The un-anchorable delta — `paired-branches`, where the events cannot see a won cycle

M12 met a beat with no event (`deep-drain`'s cycle 8, a cycle containing nothing) and gave it a
lawful home: anchor on the retires either side, point the prose AT the gap, pin every fact the
narration leans on. **M14's third lesson is the harder version of that shape.** Here the events are
not absent — they are IDENTICAL across all three widths. A step still anchors (the last retire sits
at c6 at w2 and w3, c5 at w4), so the lesson is authorable; what fails is the **discriminator**.

M13 step 3 already accounted for the shape term by term, and the lesson should be written off that
account rather than re-deriving it: w3 buys nothing **not because the third slot goes unused — it
fills.** G is 3 at both w2 and w3 with different shapes (`{1,2,2}` against `{1,3,1}`): the third slot
pulls `addi a7` forward and thereby pushes `ecall` out of the tail group into one of its own. **The
widening moved work between groups without reducing their number.** w4 is where the tail finally
fits in one group.

**So this lesson's UNCHANGED criterion cannot be "the event multiset differs" — it must be stated on
the anchored CYCLE**, and it must say so out loud rather than quietly using a weaker check. That
inverts this repo's standing rule (verify on the multiset, not on cycles) for one lesson only, which
is exactly why it is written down here instead of discovered in step 3.

## Falsifiable UNCHANGED criteria (state before building; check at the end)

1. **No new trace event or field.** `stall.reason` already carries all three refusals, `location`
   absorbs `"EX.3"`, and the group shape is on `state.micro.idEx`. House record: M4 +1 field of 5,
   M6 +0, M7 +0, M11 +0, M13 +0.
2. **No engine change of any kind.** M14 is content plus one track-order edit.
3. **No new corpus program.** The three subjects use `sum-loop`, `slow-op-loop` and
   `paired-branches`, all already in the corpus — and an addition pays the full INV-8 ripple across
   six models (M12's finding).
4. **No new lesson-format field.** If a step wants one, that is a finding about the format, not a
   licence — and `Lesson.depthDefault` was dead for eleven milestones, so the bar is: name which
   code READS it.
5. **`content/lessons/index.json` gains three ids in an existing track and no new track.**

## Build order (each step testable before the next)

- [x] **0. The dump, and the shipped defect it found. ✅ DONE 2026-07-29**, `458b4ce`. Above. The
      fix derives `CONFIG_AXES`' width positions from `MAX_ISSUE_WIDTH` (M13 step 3's precedent for
      this staleness class) and takes the half-derived count shape `datapath-superscalar.test.ts`
      already uses (`12 * MAX_ISSUE_WIDTH`) — deriving only the term that went stale, because a
      fully derived count is vacuous. Both pins run against broken code: re-pinning the axis to a
      literal short list reddens both counts (24 vs 48, 48 vs 96); making the labels vary while the
      config does not reddens the width-set check plus two lesson-content steps, since a 1-wide
      machine emits no pairing refusal at all. Repo 6203 → **6779**; all five gates green.

- [x] **1. Lesson — the third slot barely pays, and the fourth pays NOTHING (the thesis). ✅ DONE
      2026-07-29**, `58ff293` — `where-widening-stops`, "Where widening stops paying", four steps,
      appended to "The wide machine". Repo 6779 → **6887**; all five gates green. What the step
      found, beyond what the plan predicted:
      **The gain is ONE INSTRUCTION, and it is the last one.** The cycle totals (44 → 43 → 43) are
      the weak form of the thesis. Measured on the retire-cycle MAP, 33 of the 34 instructions
      retire on the identical cycle at w2 and w3, and the lone mover is `i51`, the `ecall`
      (43 → 42) — because at w3 the closing `bne`, the `li a7, 10` and the `ecall` form ONE issue
      group where w2's group is full after two. Confirmed on `state.micro.idEx`, not inferred:
      w2's tail is `[i49 i50]` then `[i51 -]`, w3's is `[i49 i50 i51]`. The loop is untouched — every
      `branch-resolved` lands on the identical cycle at w2, w3 AND w4, and 22 cycles issue nothing
      at all in all three. **w3 and w4 produce the SAME retire map id for id**, which is the "fourth
      buys nothing" half as data rather than as an equal total two runs could share by coincidence.
      **The group histogram is the channel that can see the cap.** `{0:22, 2:11, 3:10}` at w3 and
      **byte-identical at w4** — this program never forms a group of four even with four slots. No
      event can see that (a refused fourth member and a group that simply had three emit the same
      events), so finding 3's "refusals cap the group" is pinned on `idEx` occupancy.
      **The ask must be at EVERY tier, and that is a new rule.** `resolveNarration` falls back
      DOWNWARD, so a reader sitting at `expert` is shown the expert paragraph alone — an ask written
      only into `detailed` is one they never see. The oracle asserts all three tiers of the ask step
      name the control and the width; stripping it from `expert` alone reddens exactly one test and
      nothing else in 1705 sees it.
      **The closing step is live at every width, so `toContain` on its numbers is not enough.**
      `statesNumberBeside` checks each figure sits within 70 characters AFTER the width it belongs
      to — "two wide it takes 44, three wide 43" passes, "44 cycles, down to 43" fails, and a
      `toContain` cannot tell them apart. That is the M4-step-4 trap arriving on the width axis, and
      it is the one thing here a declaration cannot fix, because the lesson's subject IS the other
      position.
      ⚠ **`nth: 4` is measured, not reasoned.** Picked by recording `sum-loop` at all 48 superscalar
      positions and reading where each occurrence lands: nth 3 anchors BEFORE the previous step in
      every position (an order violation), nth 4 is the first that clears it everywhere. The break
      harness then showed the pc pin beside it is NOT the sole net for a slip — `nth: 1` and `nth: 2`
      are both caught first by the sweep's order check — so its comment says so.
      The original plan text for this step follows.

- [x] **1 (as planned). The thesis lesson.**
      `sum-loop`, the program `two-at-once` already used, so the learner returns to a machine and a
      NUMBER they have met: that lesson tells them 0.77 IPC at w2 against 0.61 at w1.
      **The flip is to width 3, and the arithmetic is the whole lesson — state it exactly.** 34
      retires at every width over 44 → 43 → 43 cycles gives 0.7727 at w2 and **0.7907 at w3 — and
      the identical 0.7907 at w4**, because w3 and w4 are the same 43 cycles. So the third slot buys
      0.02 IPC and **the fourth buys this program literally nothing.** That is not a caveat to the
      thesis, it IS the thesis, and it is decision W's stated reason for offering width 4 at all.
      ⚠ An earlier draft of this plan said "at w4 it is 0.79, doubling the width again moves IPC by
      0.02" — arithmetically true and pedagogically backwards, since it credits the fourth slot with
      the third slot's gain. **The corrected form is the one to author from.** It also fixes the
      discriminator: narration about w4 would be equally true at w3, so lesson 1's discriminator can
      only ever be against w2, and the step's acceptance says exactly that.
      ⚠ The eleven new refusals are the **explanation**, not a cost to be counted (finding 3): they
      cap groups at 2–3, and prose that tallies them is wrong at w4 with every anchor green.
      Narrate the TOTAL; measure the cycle DELTA between width positions.
      Acceptance: steps anchor in order at both width positions; the flip is REQUESTED in the step
      before the first width-exclusive one; the sweep is green; setting `issueWidth` back to 2
      makes the narration false (recorded, not argued) — and the file records that w4 is NOT a
      discriminator for this lesson, so nobody later "strengthens" it into one.

- [x] **2. Lesson — four in a row (the flagship). ✅ DONE 2026-07-30**, `2720e62` —
      `four-in-a-row`, "Four in a row", five steps, appended to "The wide machine" at position 6.
      Repo 6887 → **6996**; all five gates green; **8 breaks run, 8 reddened the intended test**.
      The `static-taken` mirror was NOT taken (decision below closed): the lesson earned its five
      steps on the width axis alone, and a second config axis would double the ask-for-the-flip
      burden for a beat that belongs to lesson 3's subject.
      What the step found, beyond what the plan predicted:
      **Write it on issue-group MEMBERSHIP, not on cycles and not on events.** Every sentence in
      this lesson is a claim about which instructions share a group, and `groupPcs` (ID/EX
      occupancy, by pc) is the only channel that can see one. The whole sequence is pinned
      exhaustively at all three widths, and that ONE assertion is the evidence for six separate
      sentences:
      `w2 [t1 a0][t5 t6] 6×([sll][add addi][bnez a7]) [ecall]` — 21 groups;
      `w3 [t1 a0 t5][t6] 6×([sll][add addi][bnez a7 ecall])` — 20;
      `w4 [t1 a0 t5 t6] 6×([sll][add addi][bnez a7 ecall])` — 19.
      ⚠ **The plan's "the loop body is byte-identical at w3 and w4" is FALSE as an event claim** —
      a wider machine fetches wider, so the fetch stream differs every cycle. What is identical is
      the loop's GROUP SHAPE (three groups a pass at w2, w3 and w4 alike) and its retire spacing.
      The corrected claim is the stronger one, and it is the one asserted.
      **Three wide takes the same TWO prologue groups as two wide** — three heads then the fourth
      alone with two slots idle, plus a refusal (the `sll` offered to that leftover group) that the
      widest machine does not have. That is why the ask is for **4 and not 3**, and it is invisible
      in the cycle total. Which makes this **the library's only ask a learner can half-satisfy**:
      flipping to 3 leaves the width-exclusive step as silent as never flipping at all, so the ask
      names the number and the oracle asserts `liveAt(3) === liveAt(2)`.
      **The run is its group count plus fourteen idle cycles, at every width** (21+14=35, 20+14=34,
      19+14=33 — cycle 0, two per taken branch, three draining). So "one group removed, one cycle
      saved" is arithmetic, not a coincidence of totals: the third slot buys the ENDING, the fourth
      buys the BEGINNING, and neither comes out of the loop, which is 30 of the 35 cycles.
      **The gain's signature is a UNIFORM SHIFT, not a speedup.** 27 of the 30 instructions retire
      exactly one cycle earlier at w4 than w3 and the other three do not move — the machine started
      sooner, it did not run faster. No cycle total can express that, and it is what stops a reader
      generalising the group of four to the loop.
      ⚠ **THE DECOY, and it is the natural choice.** The vivid fact is the register file answering
      **0** for a counter that says 6 — but `reg-read{reg:6,value:0}` is alive in **45 of the 48
      positions**, and with forwarding OFF it is the FINAL `bnez` (pc 28, ~c55) where the counter
      legitimately reaches zero. A step anchored there narrates the prologue while pointing at the
      last branch. The anchor used is the REPAIR instead — `forward{MEM/WB→EX.rs1, value 6}`, alive
      in exactly **9 of 48** — which cannot exist with forwarding off, so **the prose is protected
      by the step's own anchor rather than by an author remembering.** Generalises: when the
      striking event and the safe anchor differ, anchor on the one whose existence conditions match
      the prose's.
      ⚠ **The refusals here are not even MONOTONIC**: 6 → 13 → 12 against 35 → 34 → 33 cycles, so
      the fastest machine is neither the least- nor the most-refused. Finding 3 with no reading of
      the count as a cost left standing.
      ⚠ **The advisor caught an off-by-one this plan's own step text would have shipped.** "The
      wider machine's extra loop slot holds work the flush throws away" is true on **five of the six
      passes** — on the sixth the branch falls through and those same two instructions are the
      program's exit, in the very group the closing step walks past. Measured per pass, and
      deliberately NOT off `flush.stages` (which does shift `EX,ID`→`EX` across this width change
      and is a casualty list, not a cost — M12's trap).
      `nth: 2` on the loop step is measured: `nth: 1` anchors before the step above it in exactly
      the nine positions where that step lives, and nowhere else.
      Method note: the six helpers `where-widening-stops` had as locals were **hoisted to module
      scope first, unchanged, in the same commit but as a separate mechanical move** — a claim
      measured differently in two lessons is two claims. `retireCycles` became `retireCycleById`
      because `deep-drain` has its own `retireCycles` returning a list rather than a map.
      The original plan text for this step follows.

- [x] **2 (as planned). The flagship.** `slow-op-loop`, the only subject with
      w4-exclusive anchors (finding 2), and M13 step 3's own "honest lesson": four independent `li`s
      form **one group of four exactly ONCE in six iterations**, the loop body is byte-identical at
      w3 and w4, so the gain is **1 cycle and not 6**. The beat is a prologue effect and the lesson
      must say so — a reader who sees "a group of four!" and generalises to the loop has learned the
      opposite of the truth.
      Its ready-made mirror, if a step wants it: **`static-taken` SPENDS the width** — a bet ends its
      group, so `paired-branches` runs 6 at w4 under the base behaviour and 11 under betting, the
      same 11 it runs at w3. That is a second config axis in one lesson; take it only if a step
      earns it, and it inherits the same ask-for-the-flip rule.
      Acceptance: as step 1, plus at least one step anchors on an event that exists ONLY at w4
      (named explicitly in the step, from the dump).

- [x] **3. Lesson (CONDITIONAL) — the width that moved the work. ✅ DONE 2026-07-30**, `50c50db` +
      `56ac7cf` — `width-moved-the-work`, "The width that moved the work", five steps, appended to
      "The wide machine" at position 7. Repo 6996 → **7105**; all five gates green; **10 breaks run,
      10 reddened the intended test**. **The CONDITIONAL resolved to SHIP**: no new event, no new
      field, no new corpus program, no engine change — UNCHANGED criteria 1–5 all intact, so this is
      the success case rather than a waiver.
      What the step found, beyond what the plan predicted:
      **No step in this lesson is width-exclusive, and that inverts where the ask's protection
      comes from.** The identical multiset means every step anchors at every width, so the
      exclusive-step search both siblings hang their ask on (`exclusive === [2]`) returns `[]` here.
      Good for the reader — `runner.ts` can never silently skip a step in this lesson — and bad for
      the net: **strip the ask and nothing anchoring, ordering or sweeping notices.** It is pinned
      positionally, by literal step index, at all three tiers, and the equality `liveAt(2) ===
  liveAt(3) === liveAt(4)` is asserted so nobody later "strengthens" the lesson by inventing an
      exclusive step. Break-harnessed: deleting the ask from `expert` alone reddens exactly one test.
      **The ask is TWO-STAGE (3, then 4), and the decision table's stated REASON was falsified.**
      The row said w4 "because 7 → 7 → 6, so w3 is not a discriminator for it either." Measured, w3
      _is_ a discriminator — on the retire map (`i3: 6 -> 5`), on the group shape (`{1,2,2}` →
      `{1,3,1}`), and on the lesson's own anchored cycle (c4 → c3). It is not one on the **cycle
      total** alone, which is this milestone's own "cycle totals are the weak form" trap appearing
      inside its own decision table. The pinned ANSWER stands (the lesson ends at 4); the reason is
      corrected in the row, and the two-stage ask is its consequence — a reader who jumps straight
      to 4 never sees the third slot fill, which is the beat the lesson exists for.
      **Each flip moves exactly ONE of the lesson's anchors, and a different one.** `[0,1,2,4,6]` at
      w2, `[0,1,2,3,6]` at w3, `[0,1,2,3,5]` at w4. That is the discriminator the un-anchorable
      section demanded, in its strongest available form: not "the vectors differ" but "each widening
      is visible in exactly one place, and the two places are not the same place."
      **The w1 fact is the milestone's signature trap in its sharpest face yet.** The `branch-slot`
      count is 0, 1, 1, 1 against 9, 7, 7, 6 cycles — **the machine WITH the refusal is faster than
      the one without**, and above one slot the count is flat while the clock keeps falling. Step 1
      found a count that rises with the speedup, step 2 one that is not even monotonic; this one
      cannot be read as a cost at either end. `branch-slot` cannot climb with width the way
      `intra-pair-raw` does, because the hardware it names was never replicated.
      **The one event the width control ever touches on this program is that refusal**, and it
      appears going from 1 wide to 2 and never changes again — which is also the NON-VACUITY of the
      two empty-multiset assertions beside it. Without it, `multisetDiff` could be a function
      returning `[]`.
      ⚠ **The `static-taken` mirror was measured and REJECTED on a MECHANISM, not on taste.** Under
      betting this program runs 13, 12, 11, 11 — so the THIRD slot buys the cycle and the fourth
      buys nothing, **exactly inverting** the not-taken 9, 7, 7, 6. A beautiful fact, and
      unauthorable here: `stall{branch-slot}` anchors null in all 24 static-taken positions (a bet
      redirects fetch before the two transfers are ever candidates together), so a lesson asking the
      reader to flip PREDICTION is a lesson whose step 2 silently vanishes when they do. That is
      M11+M12 review finding 2 exactly, and `deep-bet-pays-double` already shipped it once. The
      earlier draft reason — "it doubles the ask burden" — was weaker and would not have held.
      ⚠ **The advisor caught a false sentence one draft before it shipped.** The crux step's
      "the group behind the younger branch holds three instructions" is true at w3 and **false at
      w4, where it holds four** — while `li a7` executes at cycle 3 in both, so the anchor is
      identical and green either way. This is `where-widening-stops`' attribution trap arriving on
      a GROUP claim instead of a cycle count. Every group-membership sentence now names its width,
      and the expert tier states the general form the measurement supports: **the group the younger
      branch leads is exactly as wide as the machine** (2, 3, 4 at widths 2, 3, 4).
      Attribution is the **whole** protection here, for the first time: its siblings each had a
      width-exclusive step whose anchor kept its prose off the wrong machine, and this lesson has
      none — so `statesNumberBeside` runs over every figure in every step that quotes one.
      Step 2 deliberately reuses `one-branch-unit`'s anchor (nothing in the suite pins cross-lesson
      anchor uniqueness): there the refusal is introduced, here it is re-read as width-invariant.
      The original plan text for this step follows.

- [x] **3 (as planned). The conditional.** `paired-branches`. Write it off
      M13 step 3's term-by-term account, not by re-deriving. **Its discriminator is on the anchored
      CYCLE, not the event multiset** (see the un-anchorable section) — state that in the lesson's
      own test rather than silently using a weaker check. CONDITIONAL in M12's sense: if the beat
      cannot be made to read honestly without inventing an event, **dropping it is a success and
      inventing one is the only failure**.
      Acceptance: as step 1, with the discriminator stated on the cycle and the reason recorded.

- [ ] **4. Wire the track.** Three ids appended to `"The wide machine"` in
      `content/lessons/index.json`. **Read the ordered-assertion tests, do not grep their names**
      (M12's method note): `lessons.test.ts` holds an exhaustive `toEqual` on track NAMES and a
      pairwise order check — extending an existing track should touch neither, and if it does, that
      is a finding. Decide the WITHIN-track order by the cache track's discriminator: **a sequence
      pin earns its place only if a prose sentence LIES when reordered.**
      Acceptance: the picker shows seven lessons under "The wide machine"; the track-name and
      pairwise pins are untouched; any order pin added is justified by a named sentence.

- [ ] **5. Browser pass — the only net that sees this.** The step the headline decision's price is
      paid in. Drive each new lesson through `startLesson` on the **shipped bundle**, starting from
      a different model so every assertion is about what the lesson dragged, then **flip ISSUE with
      the real control** and assert the rail re-anchors and the step count changes. Read
      `browser-rig-cdp-recipe`, `browser-rig-chrome-cleanup` (never `taskkill //IM`),
      `browser-rig-vacuity-traps` and `never-kill-dev-servers-by-port` first.
      ⚠ §0 must select a model that HAS the width control before checking a known-present control —
      M12's rig reported itself broken when its own premise was wrong.
      Acceptance: every new lesson opens at its declared width and depth; the flip re-anchors; the
      rail's count changes across the flip and the surviving steps are not the same set.

## Acceptance criteria (mirror the spec §11 shape)

- [ ] "The wide machine" track shows seven lessons; the three new ones open on the superscalar at
      `issueWidth: 2` and at their declared depth tier.
- [ ] Each new lesson's steps anchor in order, in at least one config position, with narration
      resolvable at all three tiers.
- [ ] Every cycle count and IPC figure in narration is pinned by an oracle against a recording at
      the lesson's own config — none computed in prose.
- [ ] Each lesson's width discriminator is recorded: setting `issueWidth` back to 2 makes its
      narration false. For lesson 3 the discriminator is on the anchored CYCLE, and the file says so.
- [ ] Every config-exclusive step is REQUESTED by the step before it, in prose.
- [ ] All five gates green (`test`, `typecheck`, `lint`, `format:check`, `build`).
- [ ] The browser pass drove `startLesson` and the real ISSUE control on the shipped bundle.
- [ ] The five UNCHANGED criteria above all held, or the exception is written up.

## How this milestone can lie to itself

- **Counting refusals.** Finding 3, and it is the signature defect: a count that is a penalty at w2
  and a group cap at w4, green either way.
- **Crediting a slot with the gain the slot below it made.** This plan shipped that error in its own
  first draft (step 1's ⚠) — "at w4 it is 0.79" is TRUE and reads as though the fourth slot bought
  something, when w3 and w4 are the same 43 cycles. **Every width claim needs the neighbouring width
  beside it**, because a figure quoted at one width alone cannot show where the gain stopped, and
  where the gain stops is what this whole track exists to teach.
- **Trusting the widened sweep.** Step 0's own fix made "every step anchors somewhere" a weaker
  guarantee for exactly this track's shape. Green there is not evidence a learner sees the step.
- **Reading a multiset diff as behaviour.** `branch-flavors` renumbers instruction ids wholesale
  across widths (finding 4). Read the pc and the encoding.
- **Generalising the prologue.** `slow-op-loop`'s group of four happens once, in the prologue, in a
  six-iteration run. A lesson that shows it without saying so teaches that width 4 pays in loops.
- **Assuming the corpus's shape is the language's shape** — M13's finding, unchanged. Three subjects
  from eleven programs is a sample, and "no corpus program does X" is a measurement with an
  expiry date.
- **Quoting `two-at-once`'s 0.77 without re-recording it.** It is a number in another lesson's prose,
  authored at a different milestone. Read it from a recording or do not use it.

## Decisions to pin (seeded with recommended answers)

| Decision                                        | Recommendation (seed)                                                                                                                                                                                                                                                                                                              | Pinned answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Which subjects ship**                         | All three — `sum-loop` (the thesis), `slow-op-loop` (the flagship), `paired-branches` (the conditional). Matches M12's track size. Gates steps 1–3                                                                                                                                                                                 | **All three** (user, 2026-07-29)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **The declared width, and who flips**           | Declare `issueWidth: 2` and ask the learner to flip — see the Headline decision. Gates every step                                                                                                                                                                                                                                  | **As seeded** (headline; reopen to change)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **A new track vs extending "The wide machine"** | **Extend.** Same model, different knob; extending touches neither the exhaustive track-NAME `toEqual` nor the pairwise order pin, while a new track makes both a hard edit. M12 minted a track because its delta was a different MODEL                                                                                             | **Extend** — pinned by the argument here, because step 4 and its acceptance already assume it. A step written against an `_open_` row is the "pinned decision with no net is a comment" defect inverted: an answer with no decision. Reopen deliberately if the picker gets crowded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Which width each lesson flips TO**            | **Per-subject, from the dump, not a house rule.** `sum-loop` → **w3** (its 0.02 IPC gain is entirely w2→w3; w4 is the same 43 cycles and is NOT a discriminator for it); `slow-op-loop` → **w4** (the only w4-exclusive anchors in the corpus); `paired-branches` → **w4** (7 → 7 → 6, so w3 is not a discriminator for it either) | **As seeded for the ANSWER; the third row's REASON was FALSIFIED at step 3.** `paired-branches` ends at w4 — but not because w3 is not a discriminator. It IS one, on the retire map (`i3: 6 -> 5`), on the group shape (`{1,2,2}` → `{1,3,1}`) and on the lesson's own anchored cycle (c4 → c3); it is not one on the CYCLE TOTAL alone, which is this plan's own "cycle totals are the weak form" trap appearing inside its own decision table. So the ask is TWO-STAGE (3, then 4) — a reader who jumps straight to 4 never sees the third slot fill, and that is the lesson's subject. Any change needs a new recording, not an edit                                                                                                                                                         |
| Within-track order of the three                 | Thesis → flagship → conditional, appended after `one-branch-unit`. Pin a sequence test ONLY if a prose sentence lies when reordered (the cache track's discriminator)                                                                                                                                                              | _open_ — gates step 4, and step 3 supplied the sentence that decides it. The track now reads `where-widening-stops` (5), `four-in-a-row` (6), `width-moved-the-work` (7). The third names BOTH siblings in prose and leans on them — its step 3 says the extra slots there competed with "a mispredict shadow" and "a dependence chain", its crux contrasts a slot that FILLS against the idle hardware of lesson 1, and its closing cites lesson 2's two width-4-only forwards as the counter-example. Reordered, those are forward references to lessons the reader has not met. Step 4 decides whether that earns a pin                                                                                                                                                                       |
| The `static-taken`-spends-the-width mirror      | **Available, not required.** A second config axis inside one lesson doubles the ask-for-the-flip burden; take it only if a step earns it                                                                                                                                                                                           | **NOT taken** (step 2, 2026-07-30; CLOSED at step 3 on a stronger reason). Step 2: no step earned it, and the beat's subject — a bet ending its group — belongs to `paired-branches`. Step 3 owned that program and rejected it on a MECHANISM rather than on burden: under betting the run is 13, 12, 11, 11, so the THIRD slot pays and the fourth does not, **exactly inverting** the not-taken 9, 7, 7, 6 — a beautiful fact, and unauthorable, because `stall{branch-slot}` anchors null in all 24 static-taken positions (a bet redirects fetch before the two transfers are ever candidates together). A lesson asking the reader to flip PREDICTION is a lesson whose step 2 silently vanishes when they do: M11+M12 review finding 2, which `deep-bet-pays-double` already shipped once |
| A new trace event or field                      | **No** — predicted, not assumed (UNCHANGED criterion 1). If lesson 3 seems to need one, the answer is M12's: dropping the beat is a success, inventing an event is the only failure                                                                                                                                                | **NO — and lesson 3 is the case that tested it.** Its subject is invisible to the event stream by construction (identical multiset at w2/w3/w4), which is exactly the shape that tempts an invention. It was authored on `state.micro.idEx` and the anchored cycle instead. Criteria 1–5 all held                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Depth tier each lesson declares                 | `detailed`, matching all 22 shipped lessons — and it is now actually READ (M12's headline fix). Assert the declared tier selects different prose from `expert`, or the fix is invisible again                                                                                                                                      | **`detailed`** (step 1, and the library-wide `new Set([...depthDefault])` pin makes it not a choice a lesson can quietly make differently). Step 1 found the sharper consequence: because `resolveNarration` falls back DOWNWARD, an ASK written only at `detailed` is invisible to an `expert` reader — so the ask goes in every authored tier                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
