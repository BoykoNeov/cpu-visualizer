---
name: m13-review-resolved
description: 'M13 code review — all 5 findings fixed 2026-07-29 (6189→6203 tests). Holds the bug classes to check before trusting a docblock, a range claim, or a config seam — and the session where a signed overlap was graded LOW and the IMAGE overruled it.'
metadata:
  node_type: memory
  type: project
  originSessionId: 9dd1c38f-ce9d-44cb-9964-9bad97d0676f
  modified: 2026-07-29T02:11:18.056Z
---

A **directed inline pass** over `89bb26e..HEAD` (46 commits, 80 files, ~11.3k ins), 2026-07-29.
Not `/code-review high` — that is user-triggered and the model cannot launch it, so this was one
reviewer aimed at what M13's own log said it was most likely to have got wrong. **All 5 findings
FIXED**, each in its own commit with a regression test; repo 6189 → 6203, five gates green.
Write-up at `docs/reviews/m13-review-findings.md`; verified by **21 browser checks on the shipped
bundle**.

Read this before trusting a docblock's stated reason, before writing a range claim, or before
adding a knob to the shell→engine seam. See [[m13-width-planned]] for the milestone itself.

**The five, as bug classes:**

1. **A docblock's justification is not a measurement.** Three sites explained a `?? 1` as "the
   reading the engine itself applies". Two engines read `issueWidth` and they disagree — the
   superscalar `?? 1`, the **out-of-order `?? 2`**, a pinned decision at its own declaration. The
   `1` is right anyway, but for a reason nobody had checked: the shell **always passes a number**,
   so **no engine's absent-width default is reachable through the product at all**.
2. **A range claim that does not say a number can still be false.** `candidates` documented its
   length as "0, 1, or `width`" — true at width 2, false from width 3 (it is **3 on 264 cycles at
   width 4**). Step 8's sweep for "every sentence asserting a COUNT OF TWO" was **structurally
   blind** to it: it does not say two, it says `width`.
3. **A deferral note is a claim, and it ages.** `m13-tasks.md` handed `layoutLabels` forward saying
   step 9's fix "removes the only case that reaches the fallback". Measured: 1–3 distinct labels at
   **every** width, **and on the five-stage datapath M13 never opened**.
4. **A `??` whose left side cannot be nullish**, with a comment naming this line as where the
   resolution happens when it happened a layer up.
5. **Code can be untestable BY POSITION, and no better test fixes that.** `loadInto`'s config was
   an object literal **inside a `useCallback`** — uninvokable without jsdom. Three milestones each
   measured the same hole (M7: 581 tests green with `issueWidth` deleted; M11: 229 with
   `branchPrediction`; M13 step 6: **1518 with `issueWidth` clamped to 2**) and each answered it
   with a browser pass. Five of its eight knobs are OPTIONAL, so dropping one is not even a type
   error. Fixed by MOVING it: `SessionKnobs` + a pure `engineConfigOf`, and `engine-config.test.ts`.

**The method lessons, which outlive the findings:**

- **A SIGNED OVERLAP IS A POINTER, NOT A VERDICT — and it pointed the WRONG WAY this time.**
  Finding 3's pixel half was graded LOW from its number: 16 units of a 70-unit label box, which
  reads exactly like a corner clip. The 5× crop of the shipped bundle showed the EX/MEM bar
  crossing the **middle** of a branch target — `0x0000███c`, three digits of a hex value hidden,
  because **component boxes paint AFTER labels**. The severity was wrong until the image arrived.
  Fixed with a horizontal escape in `layoutLabels`, confined to the path that had already given up
  in `y` (so no currently-clear label can move) and bounded at ±96 units (a label displaced far
  enough to be unambiguous about CLEARANCE becomes ambiguous about OWNERSHIP — step 9's reason for
  deferring it stands). This is the same family as [[browser-is-the-only-net]].
- **Instrument the branch; do not infer from having fixed the case you went looking for.** The
  false note in finding 3 was exactly that inference. Counting the fallback took one `if`.
- **Break the fix in a DIFFERENT place to learn what a net is worth.** Reverting `IFID_CORRIDOR`
  reddens the new label test with **452 buried labels** naming themselves; the milestone recorded
  that same break as "exactly 2 of 1551", and neither of those two named the defect.
- **A pinned decision with no net is a comment.** Changing the OoO engine's `?? 2` to `?? 1` —
  deleting the decision outright — leaves **all 4400 engine tests green**. Nothing below the web
  package exercises the absent case, which is why three comments could assert the engines agreed.
- **Run the new test against the broken code** (inherited from [[m11-m12-review-resolved]], paid
  again): every net here was watched failing, and each failure message names the knob or the label.
- **A non-vacuity clause earns its place on the day you write the test.** `label-collisions`'
  `labels > 0` caught the author's own mangled regex **twice**, from two different escaping slips.
  A sweep for absent things is green on a parse that finds nothing.
- **Four rig defects, all one shape: a rig asserting something it never measured.** Cycle counts
  read with forwarding OFF (70/61/60/59 against pinned forwarding-ON numbers); a **16-USER-UNIT**
  overlap compared against a **10-CSS-PIXEL** threshold on an SVG scaled to fit; the program
  GUESSED (`branch-flavors`, because that sounded like where a branch target lives — it is
  `call-return`, cycle 6); and viewport coordinates mixed into a **page-relative** screenshot clip,
  giving a uniformly black crop that reads exactly like "the datapath did not render". Each was
  fixed by dumping the answer first. See [[browser-rig-screenshot-limits]] for the clip caveat,
  which is written down and was walked into anyway.
- **Review your own review before shipping it.** A reviewer pass found three overstatements in the
  findings doc: finding 1 was scoped to lessons only (checking free play changed its severity),
  finding 3 counted **renders** against a note that speaks of **cases** and called the gap "three
  orders of magnitude", and finding 5 prescribed an edit by line number without scoping it.
- **A measurement's glob is part of its claim** (M13 step 4's rule, which caught this review too):
  the findings doc's candidate-count table omits the prediction axis, under which width 4 also
  reaches 2. The shipped test asserts the full-glob set.
