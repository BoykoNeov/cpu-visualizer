---
name: m14-width-lessons-step0
description: "M14 (the width DELTA lesson track — new lessons in the existing 'The wide machine' track, teaching widths 3/4 against the width-2 machine the learner already met). SCOPED, NOT STARTED as of 2026-07-29: step 0's dump is run and one shipped defect found and fixed. Read before authoring any width lesson, and before trusting `lessons.test.ts`'s sweep as a net for a config-exclusive step."
metadata:
  node_type: memory
  type: project
  modified: 2026-07-29T04:01:20.827Z
  originSessionId: 65f78fd8-0a6b-4187-a611-6595cf485bd4
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
  it the flagship: four independent `li`s form one group of four ONCE in six iterations, the loop
  body is byte-identical at w3/w4, so the gain is **1 cycle, not 6**.
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
- **`sum-loop`'s IPC is the sharpest honest number**: `two-at-once` already tells the learner 0.77 at
  w2 against 0.61 at w1. At w4 it is 34/43 = **0.79**. Doubling the width again moves IPC by 0.02 —
  which is precisely what decision W chose width 4 to teach, told on a number they already read.

## Not yet decided (content calls, deliberately left to the user)

Which subjects ship, how many lessons, and their order. See [[m12-deep-pipeline-lessons]] for the
delta-track precedent and the authoring traps that apply unchanged.
