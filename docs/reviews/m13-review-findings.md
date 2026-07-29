# M13 code review — findings

Source: a **directed inline pass** over `89bb26e..HEAD` (46 commits, 80 files, ~11.3k
insertions), run 2026-07-29. Not `/code-review high` — the built-in's concurrent finder
fan-out was not available to this session, so this is one reviewer aimed at what the
milestone's own log says it is most likely to have got wrong. Read that limitation into the
coverage: this pass is narrower than the M9+M10 and M11+M12 reviews, and a later fan-out
over the same range is not redundant with it.

**Line numbers are as of `591f89a`, the reviewed HEAD** — not post-fix. The two prior
reviews used different conventions for this line (M9+M10 quoted its reviewed HEAD, M11+M12
quoted its last fix commit); this one states which it is so the next review need not guess.

## Why the range starts at `89bb26e`

`89bb26e` is the last commit before the M11+M12 review's five fix commits (`c0069e9`,
`c6ff1fe`, `244fafc`, `324879d`, `582a525`). Starting at `1ec4144` — the commit that records
that review — would have put those five outside every review that has ever run, which is
verbatim the mistake M11+M12's own method note warns about: _"Start a review range at the
previous review's HEAD, not the milestone boundary. Finding 3 lived in the M9+M10 fix
commits, which no review had ever seen."_

## What this pass did NOT cover, stated so it is not mistaken for a clean bill

- **No browser pass.** M13 is mostly view work and this repo's standing lesson is that the
  browser is the only net for it. Nothing below was checked on the shipped bundle.
- **The engine's width logic was read, not fuzzed.** `issueVerdict`, `detectHazard`,
  `stageId`'s slide and the out-of-order dispatch loop are all genuinely group-shaped rather
  than pair-shaped; the milestone's claim on that point survives reading. No new adversarial
  program was built against them.
- **The palette re-validation was read, not re-measured.** The four-tint record in
  `styles.css` is unusually honest — it reports the figure that got worse — and was taken at
  its word.

---

## 1. MEDIUM — a lesson's absent `issueWidth` is normalized to 1 on a reason that is false for the out-of-order engine

`packages/web/src/session.ts:255` (and its docblock at `:69–76`, and the comment at `:247–254`)

`lessonOpening` writes:

```ts
issueWidth: lesson.config.issueWidth ?? 1,
```

and justifies the `1` in three separate places as the engine's own reading — the docblock
says _"a lesson that declares a config but no width means width 1, **which is what the engine
itself reads it as** (`config.issueWidth ?? 1`)"_, and the inline comment repeats it:
_"omitting it MEANS width 1, the reading the engine itself applies (`?? 1`)"_.

**Two engines read `issueWidth`, and they do not agree.**

| engine                                     | absent `issueWidth` reads as |
| ------------------------------------------ | ---------------------------- |
| `engine/superscalar/src/processor.ts:598`  | `?? 1`                       |
| `engine/out-of-order/src/processor.ts:334` | **`?? 2`**                   |

The out-of-order model's default of 2 is deliberate and labelled as a pinned decision at its
own declaration (`private width = 2; // OoO's own default is 2, unlike the superscalar's 1`).
So the sentence justifying the shell's `?? 1` is false for one of the exactly two models the
field applies to — and it is the shell's rule, not the engine's, that would actually fire,
because `loadInto` passes the normalized number explicitly.

**Not reachable today, and measured rather than assumed.** Every lesson that declares a
config for a width-honoring model states its width: all four superscalar lessons
(`two-at-once`, `one-door`, `one-branch-unit`, `pair-that-cant`) and all four out-of-order
ones (`work-slides-ahead`, `commit-in-order`, `reservation-station-holds`,
`racing-ahead-of-the-miss`). Every other lesson is on a width-blind model.

**What it costs if it is ever reached**, which is why this is MEDIUM and not LOW: an
out-of-order lesson that declares a config and omits the width would open on a **1-wide**
machine while the model's own default is 2 — with the width control showing `1-wide`, and
with the lesson's pinned cycle counts recorded against a machine the reader is not on. That
is M12's finding 2 exactly (`deep-bet-pays-double` asserting "Prediction is on." on a machine
where it wasn't), one knob over. The three deep-pipeline lessons already ship with
`config=NO-WIDTH`, so the shape "declared config, omitted width" is not hypothetical in this
corpus — only its combination with an out-of-order model is.

**Note this is the SAME root divergence as the handed-past `configLabel ?? 1`** in
`engine/conformance` — one fact ("what is a model's default width?") with two answers and now
three sites asserting the wrong one. That argues for fixing the root (a per-model default the
shell and the harness both read) over patching site by site; the two `?? 1`s have now each
been measured unreachable twice and rediscovered anyway.

---

## 2. LOW — the `layoutLabels` deferral note's stated reason is false by ~1000×

`docs/plans/m13-tasks.md` ("Handed PAST M13") · `packages/web/src/DatapathDiagram.tsx:214–229`

The open work item is recorded like this:

> `layoutLabels` has no horizontal escape. Its de-collide loop searches only in `y` (±160 in
> 4-unit steps) and, when that fails, places the label anyway — on the box. **Step 9's
> corridor fix removes the only case in this repo that reaches the fallback**, but the
> fallback is still there and it is silent.

**Measured, by instrumenting the fallback branch and sweeping the corpus** (11 programs ×
{forwarding on, off} × {no cache, `CACHE_SMALL`} × all 3 depth tiers, every recorded cycle):

| datapath                            | fallbacks reached | all landing on a box? |
| ----------------------------------- | ----------------- | --------------------- |
| superscalar, width 1                | 160               | yes (1 distinct)      |
| superscalar, width 2                | 364               | yes (3 distinct)      |
| superscalar, width 3                | 296               | yes (2 distinct)      |
| superscalar, width 4                | 300               | yes (3 distinct)      |
| **pipeline (M3, untouched by M13)** | **288**           | yes (1 distinct)      |

So the fallback is not an unreached edge; it is the ordinary outcome for a handful of labels,
at **every** width including 1 and 2, and on a datapath M13 never opened. It is a
long-standing property of the shared renderer, not something step 9's fix created or removed.

**Why this is LOW and not MEDIUM — the measurement that argues the other way, kept rather
than dropped.** The overlap is small in every dominant case: `exmem-dmem-addr` encroaches
**4 units of a 70-unit label** onto `exmem` (160 renders/width), `regfile-idex-a-l1` **5 of
64** onto `idex` (136), `idex-fwdmuxa-l1` **6 of 64**, and the pipeline's
`regfile-idex-a` **12 of 64**. The worst is `alu-pcmux-l0` at **16 of 70**, on 4 renders at
width 4 only. Step 9's actual defect was a 70-unit label in an 8-unit corridor — a different
order of thing. Per this repo's own rule, a signed overlap is a pointer and not a verdict:
**none of the above has been looked at in a browser**, and that is what would settle whether
any of it is visible.

**The finding is the note, not the pixels.** Whoever picks that item up would start from a
premise that is wrong by three orders of magnitude, and would be looking for a case that
step 9 supposedly left behind rather than for a condition that has been shipping since M3.
Correct the note; decide the rendering question with an image.

---

## 3. LOW — a candidate-count claim that became false when the control opened past 2

`packages/web/src/pairing-readout.ts:116`

```ts
/** The ID occupants, oldest first. Length 0 (idle), 1, or `width`. */
readonly candidates: readonly IssueCandidate[];
```

**Measured** over the corpus × widths 1–4 × {forwarding on, off} × {no cache, `CACHE_SMALL`}:

| width | observed `candidates.length`               |
| ----- | ------------------------------------------ |
| 1     | 0 (×372), 1 (×2230)                        |
| 2     | 0 (×412), 1 (×144), 2 (×1732)              |
| 3     | 0 (×512), 1 (×16), **2 (×4)**, 3 (×1576)   |
| 4     | 0 (×512), 1 (×16), **3 (×264)**, 4 (×1308) |

At width 4 the group holds three instructions on **264 cycles** — a shipping width, on corpus
programs. The claim was true at width 2, where `width` and "2" coincide, and it went false
the moment step 6 opened widths 3 and 4.

It survived step 8's sweep — which rewrote _"every sentence asserting a COUNT OF TWO"_ —
for an instructive reason: **it does not say "two", it says `width`**, so a sweep aimed at
pair-shaped vocabulary could not see it. The same reason `PAIR_SHAPED` in
`PairingReadoutView.test.tsx` cannot see it.

Doc-only: nothing reads the claim. The verdict fold and both derived glosses
(`${r.candidates.length} instructions issued together`, `${went} of ${r.candidates.length}`)
compute from the array directly, and `RefusalNote` derives its plural the same way — which is
precisely step 8's "make it arithmetic so a test can watch it" call working as intended.

---

## 4. TRIVIAL — a third dead `?? 1`, in the shell

`packages/web/src/App.tsx:503`

```ts
issueWidth: sim.issueWidth ?? 1,
```

`Simulator.issueWidth` is declared `issueWidth: number` (`useSimulator.ts:119`) and seeded
`useState(1)`, so the `??` cannot fire. The comment above it — _"`issueWidth` is optional on
`ProcessorConfig` … so the shell resolves the absent case to 1 right here"_ — describes a case
that cannot arrive at this line: the resolution already happened, at the `Simulator` boundary.

Listed because it is the third instance of one pattern (with `configLabel`'s and
`session.ts`'s), and because the pattern is what finding 1 is about.

---

## 5. MEDIUM (test architecture, not a defect) — the `loadInto` seam is untestable by construction, and need not be

`packages/web/src/useSimulator.ts:383–403`

Three milestones have now independently measured the same hole and written it down:

- **M7 step 6** — deleting `issueWidth` from `loadInto`'s config left all 581 web tests green.
- **M11 step 5** — the same for `branchPrediction` (all 229 green at the time).
- **M13 step 6** — re-provoked, not inherited: clamping `issueWidth` to 2 in `loadInto`'s
  config left **all 1518 web tests green**, so widths 3 and 4 collapsed onto 2 with nothing
  headless noticing.

The cause is structural rather than a coverage gap. The config is an **object literal inside
a `useCallback`** — a React hook, uninvokable without jsdom, which this repo deliberately does
not have. And **five of the eight knobs it assembles are optional on `ProcessorConfig`**
(`issueWidth`, `outOfOrderIssue`, `robSize`, `slowOpLatency`, `cache`'s absence), so dropping
one is not even a type error; only the three required fields redden `tsc`.

The repo's answer so far has been a browser pass every milestone, which works and which found
real defects — but it pays the cost again each time, and M13 step 6's note ends by handing the
widest position to step 9 precisely because nothing else could hold it.

**The literal does not have to live in the hook.** Lifting lines 393–402 into a pure exported
function over the eight ref values would make the seam assertable headlessly — "every session
knob reaches the engine config, by name" becomes one table-driven test — and would retire the
defect class rather than re-measuring it. The hook keeps calling it; nothing about the
rendering path changes. This is offered as the shape of a fix, not as a defect: the current
code is correct, and its documentation of its own blindness is unusually good.

---

## What was checked and found sound

Recorded because a review that lists only what it found reads as if it looked everywhere.

- **The engine's width generalization.** `issueVerdict` asks each of the three pairing rules
  against `for (const older of group)`; `detectHazard` scans `s < this.width` over both older
  stages; `stageId`'s slide compacts by `s - issued`. Nothing is arity-2. The milestone's
  claim that M13 was "a guard, not a rewrite" holds up under reading, and the correction it
  made to the older memory (which had paraphrased the guard's error message as if it described
  the code) is itself correct.
- **`MAX_ISSUE_WIDTH`'s move to `engine-common`.** The docblock argues from the eslint rule
  that forced it and names the two rejected alternatives. The precedent it cites (`predict.ts`
  and `cache.ts` moving down at M7 step 0 for the same reason) checks out.
- **The step-8 vacuity fix works.** `surfacesAt` renders and stores HTML per verdict/reason,
  and the clause that makes it a net (`toContain('aria-label="Issue and pairing"')`) asserts
  on the render, not the fold. The bug it was written against — a coverage assertion staying
  green on a panel broken to return `null` — cannot recur in this shape.
- **`activate` is width-oblivious (INV-2)** and reads occupancy from `location`, never from
  `micro`; `pairing-readout.ts` reads `micro` and says at length why the one-cycle-ahead trap
  does not apply to it. The two are consistent, and the identity licensing the second
  (`micro.idEx@N === EX@N+1`) is now swept at all four widths — which, as step 8 noted, it
  never had been.
- **The four-tint palette record.** It reports the number that regressed (dark worst-pair
  CVD dE 15.9 → 10.1), states that the old recorded figure did not reproduce, and states that
  the original acceptance criterion was unachievable for any 4-set. That is the right way to
  land a trade.
