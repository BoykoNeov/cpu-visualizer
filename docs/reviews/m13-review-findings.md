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

## ✅ RESOLVED — all 5 fixed, 2026-07-29

Each in its own commit with a regression test. Repo **6189 → 6203 tests**; typecheck /
lint / build / format:check green.

| #   | fix                                                       | commit                |
| --- | --------------------------------------------------------- | --------------------- |
| 1   | the `?? 1` is the shell's rule, not the engines'          | `b169997`             |
| 2   | the note corrected, the buried-label net, **and the fix** | `62368a8` + `e629a96` |
| 3   | candidates fill the whole range `0..width`                | `2427990`             |
| 4   | a defaulting operator whose left side cannot be nullish   | `4004ab2`             |
| 5   | the shell→engine seam moved out of the hook               | `46b4494`             |

**Finding 2 changed severity when the image arrived, which is the headline of the fix
pass.** It was graded LOW from its number — a 16-unit overlap of a 70-unit label box,
which reads exactly like a corner clip. A 5× crop of the shipped bundle showed the EX/MEM
bar crossing the **middle** of the branch target, rendering `0x0000000c` as `0x0000███c`.
Component boxes paint after labels, so the bar hides three digits of a hex value a reader
cannot then recover. `layoutLabels` now has a horizontal escape, confined to the path that
had already given up in `y` so no currently-clear label can move, and bounded at ±96 units
because step 9's reason for deferring it stands: a label displaced far enough to be
unambiguous about clearance becomes ambiguous about ownership.

### The browser pass — 21 checks, on the shipped `vite preview` bundle

Recorded here rather than by pointer: the rig lived under `M:/claud_projects/temp/`, which
is sweepable, and naming a mechanism that is not there would be this review's own finding 2.

- **§1 anti-vacuity** (5) — our title; the page is the BUILT bundle (`/assets/index-*.js`,
  no `/src/main.tsx`); the built CSS loaded (1 sheet, 74 rules); a known-present control
  resolves; and the model is selected FIRST, since the ISSUE control renders only under
  `capabilities.configurableIssueWidth`.
- **§2 finding 5's other half** (5) — the half no headless test can reach. Forwarding is set
  ON and read back, the scheme confirmed as the base one, then all four ISSUE positions are
  clicked: `slow-op-loop` re-records **44 / 35 / 34 / 33**. The extracted builder is reached
  by the real control, at the widest position specifically.
- **§3 finding 2** (4) — no label is buried anywhere in the width-4 recording, and the
  formerly-buried one is photographed whole at the cursor it was buried on.
- **§4 finding 3** (4) — candidate rows reach sizes `{0, 3, 4}` at width 4, a co-issue gloss
  names 3, and nothing on screen says "both" or "the younger".
- **§5 finding 1** (3) — a session at width 1 is overridden by a superscalar lesson's declared
  width after `sessionKnobs()` replaced the two hand-written literals.
- **§6** — no console errors or exceptions across the pass.

**Four rig defects surfaced, all one shape: a rig asserting something it never measured.**
It read cycle counts with forwarding OFF and reported 70/61/60/59 against pinned
forwarding-ON numbers; it compared a 16-USER-UNIT overlap against a 10-CSS-PIXEL threshold
on an SVG scaled to fit; it guessed `branch-flavors` for the program because that sounded
like where a branch target lives (it is `call-return`, cycle 6); and it mixed viewport
coordinates into a page-relative screenshot clip, producing a uniformly black crop that
reads exactly like "the datapath did not render". Each was fixed by dumping the answer
first — which is step 9's own lesson, paid for again.

## What this pass did NOT cover, stated so it is not mistaken for a clean bill

- **The finding pass had no browser phase** — the 21 checks above are a FIX-verification
  pass, aimed at the five findings. They are not a sweep of M13's view work, and a defect
  outside their aim would not have been seen.
- **The engine's width logic was read, not fuzzed.** `issueVerdict`, `detectHazard`,
  `stageId`'s slide and the out-of-order dispatch loop are all genuinely group-shaped rather
  than pair-shaped; the milestone's claim on that point survives reading. No new adversarial
  program was built against them.
- **The palette re-validation was read, not re-measured.** The four-tint record in
  `styles.css` is unusually honest — it reports the figure that got worse — and was taken at
  its word.
- **One measurement in this document is under-globbed, and it is finding 3's table.** Those
  counts come from a sweep without the prediction axis. Under the full config sweep
  `configsAt` uses, width 4 also reaches a candidate count of **2** — so the table understates
  the range rather than overstating it, and the shipped test asserts the full-glob set. The
  step-4 rule ("a measurement's glob is part of its claim") caught this review too.

---

## 1. LOW — three sites justify a default width with a claim that is false for one of the two engines that read it

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

**The lesson path cannot reach it.** Every lesson that declares a config for a
width-honoring model states its width: all four superscalar lessons (`two-at-once`,
`one-door`, `one-branch-unit`, `pair-that-cant`) and all four out-of-order ones
(`work-slides-ahead`, `commit-in-order`, `reservation-station-holds`,
`racing-ahead-of-the-miss`). Every other lesson is on a width-blind model.

**Nor can free play — and that is the sharper half of this finding, checked because
enumerating the lesson corpus alone would have been the narrower question.** `useSimulator`
seeds `useState(1)` and `loadInto` passes `issueWidth: issueWidthRef.current` — always a
number, never absent. `models.ts` deliberately does not clamp width (its M13 step 6 docblock
argues at length that it need not). So **the out-of-order engine's `?? 2` never fires through
the product at all**: selecting that model in free play runs it 1-wide, and the ISSUE control
correctly reads `1-wide` while it does. The reader is not misled — the control and the machine
agree — which is why this is LOW rather than the M12-finding-2 shape it first resembles.

What the check actually establishes is narrower and cleaner than "a latent wrong default":
**the out-of-order model's documented default of 2 is reachable only from engine tests and the
conformance harness, never from the app.** So the divergence between `?? 1` and `?? 2` exists
entirely between two defaults the product never exercises — and the cost is not a wrong
machine but a false explanation sitting in three places, each of which reads as if it had been
checked against the engines.

**It is the SAME root divergence as the handed-past `configLabel ?? 1`** in
`engine/conformance` — one fact ("what is a model's default width?") with two answers, and now
three sites asserting the wrong one. Both `?? 1`s have been measured unreachable twice and
rediscovered anyway, which is the argument for fixing the root (one owner for a model's default
width, or an absent width made impossible) rather than the sites.

---

## 2. LOW — the `layoutLabels` deferral note says nothing reaches the fallback; labels reach it at every width, and on a datapath M13 never touched

`docs/plans/m13-tasks.md` ("Handed PAST M13") · `packages/web/src/DatapathDiagram.tsx:214–229`

> **⚠ THE SEVERITY BELOW IS SUPERSEDED — see the resolved section above.** The "why this is LOW"
> paragraph reasons from the overlap NUMBER and concludes with "none of the above has been looked at
> in a browser". It was looked at, and the verdict flipped: the crop showed the EX/MEM bar through
> the middle of a hex value, not a corner clip. The wrong reasoning is left standing beside its
> correction on purpose — it is the more useful record, because the number really does read like a
> corner clip and the next reviewer will meet one that does too.

The open work item is recorded like this:

> `layoutLabels` has no horizontal escape. Its de-collide loop searches only in `y` (±160 in
> 4-unit steps) and, when that fails, places the label anyway — on the box. **Step 9's
> corridor fix removes the only case in this repo that reaches the fallback**, but the
> fallback is still there and it is silent.

**Measured, by instrumenting the fallback branch and sweeping the corpus** (11 programs ×
{forwarding on, off} × {no cache, `CACHE_SMALL`} × all 3 depth tiers, every recorded cycle):

**The unit matters, and the two columns are not the same claim.** The note speaks of _cases_ —
labels that reach the fallback. The sweep re-renders each of those once per
(program × forwarding × cache × tier × cycle), so the render column is FREQUENCY, not a count
of distinct problems. Leading with it would overstate the finding by conflating two units,
which is the failure mode this review is nominally about.

| datapath                            | distinct labels reaching it | renders | landing on a box |
| ----------------------------------- | --------------------------- | ------- | ---------------- |
| superscalar, width 1                | **1**                       | 160     | all              |
| superscalar, width 2                | **3**                       | 364     | all              |
| superscalar, width 3                | **2**                       | 296     | all              |
| superscalar, width 4                | **3**                       | 300     | all              |
| **pipeline (M3, untouched by M13)** | **1**                       | 288     | all              |

So the note's "the only case" is not zero-after-the-fix; it is one to three labels at every
width, on every program that touches memory, plus one on the five-stage datapath M13 never
opened. It is a long-standing property of the shared renderer, not something step 9's fix
created or removed.

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
premise that says zero when the answer is nonzero at every width, and would be hunting a
residue of step 9's corridor rather than a condition that has been shipping since M3. Correct
the note; decide the rendering question with an image.

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

**The diagnosis is what this pass earned; the prescription is not.** What is established is
that the literal's POSITION — inside a hook — is what makes the seam unreachable, and that no
amount of test-writing fixes that from outside. Moving it somewhere a headless test can call
is the shape of a fix, and it is deliberately left unscoped here: this review did not check
what else reads those refs, nor whether `engineConfigFor`'s narrowing composes with an
extracted builder. Whoever takes it should scope it first.

The current code is correct, and its documentation of its own blindness is unusually good —
each of the three measurements above is written down beside the thing it cannot see. The point
is only that the repo has now paid for the same measurement three times and answered it with a
browser pass three times.

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
