---
name: panel-jitter-and-height-reserves
description: "The CPU Visualizer's step-jitter class and how it was closed (2026-07-30): five panels resized as the cursor moved, the biggest because a panel VANISHED at cursor -1; the fix idiom is a DERIVED reserve (ghost stack / hidden placeholder), never a min-height constant; and the sharpest lesson — a headless structural proxy can be perfectly stable and be a proxy for the WRONG thing, which only the browser caught."
metadata:
  node_type: memory
  type: project
  originSessionId: 1159b994-75bd-457b-95ff-85fe2ac2c2bf
  modified: 2026-07-30T18:07:57.440Z
---

Stepping the clock resized five panels, and since the shell is a vertical stack each one shoved every
surface below it up or down the page. Found and closed 2026-07-30 by measuring the shipped `vite
preview` bundle at every cursor of a run (rig: `M:/claud_projects/temp/jitter/jitter-sweep.mjs`,
which walks model × program × knobs and reports per-panel `dH`/`dTop`; `cache-probe.mjs` drills into
one panel's children). Guards live in `packages/web/src/layout-stability.test.tsx`.

**The measured offenders, biggest first** — worth knowing because the ranking was not the intuition:

| panel                   | swing                   | cause                                                    |
| ----------------------- | ----------------------- | -------------------------------------------------------- |
| out-of-order structures | **526.6px**             | the panel returned `null` at cursor −1                   |
| issue readout           | 99.5px (124.9 at 980px) | candidate rows 0..width, plus a conditional refusal note |
| superscalar datapath    | 4.2px                   | the `.dp-verdict` chip drawn only on a refusal           |
| cache grid              | 1.2px                   | the idle state chip had no line box                      |
| data memory             | 0 on all 11 programs    | only a SANDBOX store to a fresh address grows it         |

**A panel that VANISHES reserves nothing, and that dwarfs every reserve inside it.** `MicroTablePanel`
already reserved all three of its tables to their peaks — and still moved half a screen, because
`oooMicro(null)` folded the whole panel away pre-run. Check the pre-run cursor FIRST when hunting
this; the in-run reserves are the smaller half. The fix keeps the gate a trace fact (a pipeline
recording still folds away) — same shape as `readPairingPreRun`, which had already solved exactly
this hole for the issue readout and was the template nobody had generalised.

**The house fix idiom is a DERIVED reserve, and this repo had already argued it twice** (the narration
stack in `App.tsx`, the map's follow readout): stack every shape in one grid cell with
`visibility: hidden` on the ghosts, so the reserved height is the tallest REAL shape at the current
window width with the current fonts. Not a `min-height` constant. This is not fussiness — the issue
readout's swing measured 99.5px at 1400px and 124.9px at 980px because the verdict line wraps at one
width and not the other, so any pixel constant would have been wrong at one of them. `visibility`
(not `display: none`) is the mechanism, and it removes ghosts from the a11y tree on the way.

**⚠ THE SHARPEST ONE: a structural proxy can be perfectly stable and be a proxy for the WRONG THING.**
The cache grid's 1.2px was first blamed on the caption's two font sizes (0.75 vs 0.78rem in a
baseline-aligned flex row — entirely plausible). The fix shipped, a guard written for it passed, and
the re-measurement showed the panel still swinging 143.2→144.4px: the header is **21px in both
states and always was**. The headless net cannot see a height, so it agreed with a fix that changed
nothing. Only the browser closed it. Corollary for [[browser-is-the-only-net]]: re-measure after the
fix, not just before — a green guard is not evidence the defect moved.

**And fixing HALF a line box made it worse than the defect.** The real cause was an idle chip rendered
`<span … />` — no content, so no line box: 5.19px against a lit chip's 18.19px. Adding a non-breaking
space took it to **20.19px against 18.19px** — a 2px swing where there had been 1.2px, now with the
idle row as the tall one — because the idle branch inherited the body's sans face while the lit branch
carried `MONO` inline. A line box is decided by content AND font AND size together. The chip is now
ONE element branching only on hue and word, because a ternary between two invites the next author to
match two of the three.

**Guard design under "no test here can see a height"** (this is the constraint, not a gap): assert a
structural proxy that DETERMINES the height, counted on the rendered markup, at every cursor including
−1. Two rules, both from this repo's own scar tissue — **count on the RENDER, never on the fold** (a
fold agrees with itself while the component renders something else), and **assert the FLOOR, not only
the equality**, since "the same at every cursor" is what a panel drawing nothing satisfies most
easily. Where a fold appears it is only the EXPECTED value. All seven guards were verified by
reverting each fix and confirming its own guard reddened (`break.mjs`) — commit before breaking.

**A reserve is only free if it is BOUNDED.** The ghost stack first keyed on every distinct instruction
tuple — exact, and one class per candidate row: 35 rows / 24KB on the corpus, **802 rows / 455KB for
one panel** on a straight-line 800-instruction program, re-rendered every step. Same failure
`MAX_MAP_CYCLES` exists for, same trigger (something a sandbox user types in a minute). Key on what
decides the LINE COUNT instead — (verdict, reason, candidate count, issued count) — and within a class
keep the member whose widest single row is widest, since a row wraps on its own length. 800
instructions then render 6 rows, identical to 200. **When you add a derived reserve, measure its
fan-out on a synthetic worst case, not on the corpus.**

**The LESSON path is a separate net and neither the picker sweep nor any headless test covers it.**
The narration panel sits ABOVE the whole stack, so anything it did would move every surface at once —
and `App.tsx` renders it conditionally. It is safe (`narrationView` always returns an object, so the
condition is a lesson property and not a cursor one) and both the first and last lesson measure a
single narration height across every cursor — but that was measured, not assumed, and only after a
reviewer pointed out the sweep drove Model+Program and left `Lesson: — none —` alone. The omission
[[browser-rig-vacuity-traps]] already records against four consecutive passes.

**⚠ A HEIGHT RESERVE MANUFACTURES NEW DECOYS FOR EVERY DOCUMENT-WIDE RIG SELECTOR** (found three days
later, M14 step 5). The idiom above — a hidden/placeholder element stacked at `gridArea: '1 / 1'` — is
exactly the shape M12's narration reader keyed on (`the visible <p> at grid cell 1/1`), and the Data
memory panel's new "no data memory written" placeholder is VISIBLE on every program that writes no
data. A rig that was correct on 2026-07-27 reported `MULTIPLE:2` on all thirteen lesson walks, and it
was the rig every time. When you add a reserve, ask which existing selectors its new element answers
to; when you write one, scope to the section's own `aria-label`. Recorded in
[[browser-rig-vacuity-traps]] as its own trap class.

**⚠ THE CLASS WAS NOT CLOSED: THE STICKY BAR ITSELF WAS STILL DOING IT, and the user found it, not
the sweep** (2026-07-30, fixed). The sweep above measures PANELS; `.transport--sticky` is not one,
and it was the worst offender left — **81.4px ↔ 104.4px depending on the cursor**, on every surface
at once, at 1500/1400/1300/1240/1200/920/900/880/840px. Three cursor-dependent texts sat in its
`flexWrap` control row (`start (pre-run)` 132px ↔ `cycle 58 / 58 — halted` 193px; the instruction
span, absent pre-run; the `in WB.0 · 3 in flight` chip, absent when one is in flight): the row wanted
**888 … 1218px** over one run against a **constant 1168px** — `main` is capped at `maxWidth: 1200`,
so every viewport ≥1200px is ONE layout and sweeping wider widths measures the same thing repeatedly.

- **A fixed threshold plus a moving content width is the same defect as a moving threshold.**
  `styles.css` argued in prose that state could not reintroduce jitter because every media threshold
  is a viewport width. True, and irrelevant: the content crossing them was the variable. **A
  comment's reasoning can be valid about the thing it names and silent about the thing that bites.**
- **The fix was to move the cursor-dependent text out of the wrapping row** (onto the scrub row,
  which never sets `flex-wrap`), not to reserve inside it. Reserving there was measured and REJECTED:
  it makes every cursor as wide as the peak, so the crowded models would have wrapped at ALL cursors
  instead of some — stable and stably worse. Ask what the reserve costs at the peak before choosing it.
- **`ch` is an exact reserve when the span is mono, and it beats a ghost here** — verified rather than
  assumed (8.795 / 7.476 / 7.04 px per char, identical for `—`, `·`, `(`, `#`). A ghost carrying
  `cycle 99 / 99` inside that bar would answer to the rig selectors that read it, the decoy class
  below.
- **The move gave 400px back and invalidated two measured thresholds** (1199 → 789, 899 → 499): the
  play-word rule had been firing 300px above the state it was measured for. Re-measure every
  threshold whose row you touch — and read the boundary from BOTH sides: 490px still wrapped, so the
  rule engages at 499, not at 489 where "one line to 500px" naively pointed.
- Guards: reserves read back out of the render at every cursor, plus the fold swept over four models
  × both follow states. Six mutations verified red (`temp/jitter2/break.mjs`). **None of them can see
  WHERE the readout is mounted** — put it back in the wrapping row and all of them pass. Rigs:
  `temp/jitter2/{transport-sweep,budget-probe,threshold-probe,verify-thresholds,narrow-probe}.mjs`.

**Scope: cursor-driven change only.** A width flip, the depth dial and picking a lesson are deliberate
acts and a panel may resize on them — the line the narration panel's own comment already drew. Also
measured and deliberately not fixed: the pipeline map's row count changes between PAGES on runs over
400 cycles, which no shipped program reaches.

See [[browser-is-the-only-net]], [[browser-rig-vacuity-traps]], [[browser-rig-cdp-recipe]].
