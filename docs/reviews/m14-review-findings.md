# M14 code review — findings

Source: a **directed inline pass** over `591f89a..HEAD` (40 commits, 35 files, +4793/−233), run
2026-07-30. Not the concurrent finder fan-out — `/code-review ultra` needs a branch or PR diff to
point at, and `main` was clean and 0 commits ahead of `origin/main`, so the built-in had nothing to
review. M13's own note applies unchanged: **a later fan-out over this range is not redundant with
this pass.**

**Line numbers are as of `d930202`, the reviewed HEAD** — not post-fix. (M13 established stating
which; keeping it.)

## Why the range starts at `591f89a`

`591f89a` is M13's reviewed HEAD, so starting here pulls M13's **five fix commits** (`b169997` and
its four siblings) inside a review for the first time. Starting at the M14 boundary instead would
have left them outside every review that has ever run — verbatim the mistake M11+M12's method note
warns about, and the same reason M13's own range started before ITS predecessor's fixes.

Note the coverage limit this inherits: M13's pass self-describes as **narrower** than the M9+M10 and
M11+M12 passes, so this range's first ~6 commits have now been seen by two narrow passes rather than
one broad one. `89bb26e..HEAD` remains the range a fan-out should take.

## What the range is

35 files, of which **9 are prose** (`docs/memory/*`, `docs/plans/*`, `docs/reviews/*`). The real
surface is 20 files in `packages/web` plus 4 lesson JSONs. **No engine, trace, curriculum or
assembler file changed at all** — M14's UNCHANGED criteria 1–4 hold by absence, re-checked here as a
git range rather than from the plan's word.

Two bodies of work sit in it: **M13's five review fixes** (findings 1–5, mostly the shell→engine
seam) and **M14 proper** (three width-delta lessons, the wide-track order pin, and — outside the
milestone — the step-jitter class: five panel height reserves).

## What this pass did NOT read — the surface limit, stated like M13 stated its range limit

Read closely: every source file in the range, `layout-stability.test.tsx` and
`label-collisions.test.tsx` in full, and the order-pin region of `lessons.test.ts`.

**Not read:** `engine-config.test.ts` (+168) beyond its fixture and enumeration clauses,
`session.test.ts` (+84), `pairing-readout.test.ts` (+40), `MicroTablePanel.test.tsx` (+29),
`DatapathDiagram.test.tsx` (+20 beyond the verdict-chip test), and most of `lessons.test.ts`'s
**+1553** — the three per-lesson suites are the bulk of the milestone's own net and were sampled, not
swept.

And the one that matters most for a lesson milestone: **no sentence of the three new lessons'
narration was read.** Every FIGURE in them was verified against an oracle written for this review
(below), which is a strong check on the numbers and no check at all on the prose around them — whether
a claim is attributed to the right width, whether a cross-reference names the right lesson, whether a
sentence teaches the thing the measurement shows. A fan-out should send a reader at the content.

## ✅ RESOLVED — all 5 fixed, 2026-07-30

Each with a regression test run against the broken code FIRST. Repo **7125 → 7132 tests**; all five
gates green (`test`, `typecheck`, `lint`, `format:check`, `build`).

| #   | fix                                                             | commit    |
| --- | --------------------------------------------------------------- | --------- |
| 1   | the reserve's maximality asserted without naming the constant   | `2c9cb71` |
| 2   | one ref for the session's knobs — no field name mapped twice    | `4d7601d` |
| 3   | the ghost class's widest member, measured off the render        | `c4c570e` |
| 4   | the pre-run ROB capacity                                        | `c4c570e` |
| 6   | the pre-run cursor the data-memory sweep skipped                | `c4c570e` |
| 5   | the cache track's order pin asserts the sentences that force it | `3f3bfc4` |

**Finding 2 was fixed by removing the names, not by moving them.** The advisor's suggested shape —
lift the ref read into a pure function over `{current}` holders — buys nothing here, because
`forwarding: forwardingRef` has exactly the same transposition surface as
`forwarding: forwardingRef.current`; something must still say which source feeds which field. So the
eight refs became **one** `useRef<SessionKnobs>`: `sessionKnobs()` is a spread with no field names in
it, and `startLesson` takes a lesson's whole opening through `openingKnobs`, a rest-destructure. Five
of the six mutations that were green now redden.

**The residual, stated rather than closed:** hardcoding a value in `select`'s reset (inside a
`useCallback`) is still green on tests and `tsc`. That surface shrank from eight name mappings to two
lines reading a named constant, and it is browser-only for the same structural reason it always was.
An earlier run of the harness reported this one RED — measured on a tree where `session.ts` had
already been reverted, so `tsc` was failing for an unrelated reason. The honest result is green.

**Finding 6** was added during the fix pass, from an observation this review first graded as harmless
and the advisor correctly re-graded: it is the same class as findings 1 and 2 — a docblock claiming
coverage the code does not have.

## Findings

### 1. The verdict chip's reserve is never checked to be the WIDEST thing it can say — MED

`SuperscalarDatapathView.tsx:89` derives `LONGEST_REFUSAL_TEXT` by folding `REFUSAL_TEXT` for the
longest string, and its docblock states the purpose precisely: _"a fourth refusal reason with a
longer sentence must widen the reserve by existing, or the header would go back to changing height on
precisely the cycle the new reason fires."_

That property has no net. **Measured:** flipping the reducer to keep the SHORTEST string leaves the
entire `packages/web` suite green, and `npm run typecheck` green.

The one guard that mentions the constant is `DatapathDiagram.test.tsx:331`:

```ts
expect(paired).toContain(LONGEST_REFUSAL_TEXT);
```

which is **self-referential** — it asserts the render contains whatever the constant currently is, so
the constant and the assertion move together. It does catch the reserve going EMPTY (that mutation is
red), which is why the hole is easy to miss: the guard is real for one failure mode and blind to the
other.

Fix shape: assert the maximality independently of the constant, e.g. that every value in
`REFUSAL_TEXT` has `length <= LONGEST_REFUSAL_TEXT.length` and that the constant is one of them.
Cheap, and it is the assertion the docblock already claims exists.

### 2. The seam is testable; the ref wiring that feeds it is not — and the docblock says otherwise — MED

M13 finding 5 moved the config expression out of `loadInto`'s `useCallback` into
`models.engineConfigOf`, which was right and is well covered (`engine-config.test.ts` reddens on
both a clamped `issueWidth` and a dropped `slowOpLatency`). But the literal that reads the eight refs
is still hook-bound: `useSimulator.ts:392`, `const sessionKnobs = useCallback(...)`.

**Measured** — each mutation, whole `packages/web` suite AND `tsc --noEmit`, both green:

| mutation in `sessionKnobs()`                                   | tests | typecheck |
| -------------------------------------------------------------- | ----- | --------- |
| `robSize` ← `slowOpLatencyRef`, `slowOpLatency` ← `robSizeRef` | green | green     |
| `numMshrs: numMshrsRef.current` → `numMshrs: 2`                | green | green     |
| `issueWidth: issueWidthRef.current` → `issueWidth: 2`          | green | green     |

The third is **verbatim the M13 step 6 defect** — a width clamped to 2, right at widths 1 and 2 and
silently wrong at 3 and 4 — relocated one layer up by the fix that was written to make it visible.
Five of the eight knobs are `number` or `boolean`, so a swap between same-typed knobs is not a type
error either.

`session.ts:73` overstates what was closed: _"Adding a knob here now means adding it to ONE literal
and watching `engine-config.test.ts` name it."_ `engine-config.test.ts` cannot see WHICH ref a knob
is read from; it only sees the object it is handed.

Fix shape, in order of cost: (a) correct the docblock to say what is and is not reachable — the hole
moved, it did not close; (b) lift the ref read into a pure function over a plain
`Record<keyof SessionKnobs, {current: unknown}>` so a headless test can hand it eight distinct
sentinel values and assert each lands on its own field. (b) is the same move finding 5 made, applied
one layer further out, and it is the only form that makes a same-typed swap visible.

### 3. The ghost class representative's selection rule has no net — LOW-MED

`PairingReadoutView.tsx:210` keeps, per shape class, the member whose widest single candidate is
widest (`widestRow`, line 233) — the thing that decides whether a row wraps, and therefore the thing
standing between the class bound and an under-reserved panel.

**Measured:** replacing the rule with "keep the first member seen" (`if (kept === undefined)`) leaves
the whole web suite green. The bound itself IS guarded (`layout-stability.test.tsx` pins 200- vs
800-instruction row counts equal and < 60, and that guard reddens when the ghosts are removed) — what
is unguarded is which member of a class survives.

Worth noting the arithmetic behind the docblock's honest "this is a proxy": within a class all rows
are ≤ the kept member's widest, but total LINES is a sum, so a member with n rows just over the wrap
point can exceed a kept member with one long row and n−1 short ones. That is the acknowledged trade,
not a finding. The finding is that the selection rule can be deleted in silence.

### 4. The pre-run ROB caption is unguarded — LOW

`MicroTablePanel.tsx:133`, `preRunMicro`, copies `robCapacity` off the recording so the pre-run
header reads `0/16 in flight`. **Measured:** returning `robCapacity: 0` leaves everything green and
the panel then says `0/0 in flight` for a 16-entry buffer.

No layout consequence — the three `min-height`s come from `microReserves(recording)`, which is
independent of `micro` — so this is a wrong-fact gap, not a return of the 526px jump. The
layout-stability guard for this panel is otherwise real: removing `preRunMicro` reddens four tests.

### 5. The cache track's order pin asserts the order but not the prose that forces it — LOW

`lessons.test.ts:793-798` pins `cache-spatial < cache-temporal < cache-conflict` with bare
`LESSON_ORDER.indexOf` comparisons. Both of the project's other order pins do more: the
deeper-machine pin (line 764) asserts the sentence that lies when reordered, and M14's new wide-track
pin (line 839, `says(...)`) asserts one per link, at the tier it occupies — for the stated reason that
otherwise "deleting the reference leaves the ordering rule standing on nothing."

Two concrete consequences: deleting `cache-temporal`'s _"exactly as the last lesson showed"_ leaves
the pin green; and renaming `cache-spatial` makes the first assertion **vacuously** green (`-1 < 1`).
The wide-track test's comment at line 832 already names this hole in the cache pin and declines to fix
it.

Low because the rename is caught elsewhere (the exhaustive index test and the by-name track test both
redden), and because nothing is currently wrong. It is the one place the project's own standard for
order pins is not met.

**A second, smaller thing fell out of fixing it.** The pin's comment justifies itself by quoting
`cache-conflict` as spending _"the reuse the last lesson made free"_ — **that sentence is not in the
lesson.** It reads well and states the real pedagogical dependency, and it was written into a
justification rather than read out of the narration: the M13 review's "do not trust a docblock's stated
reason", this time inside a comment about prose. The sentences that ARE there and do lie when
reordered are `cache-conflict` step 0's _"This is the last lesson's program, unchanged"_ and step 2's
_"which hit on the larger cache"_ — both now asserted. Worth carrying forward as a habit: **when a
comment quotes content, the quote is a claim about a file, and cheap to check.**

## What was verified and found sound

Recorded so the next pass need not redo it.

- **All twelve headline figures in the three new lessons, against an oracle written for this review**
  (not the milestone's own tests): `sum-loop` 56/44/43/43 cycles and IPC 0.61/0.77/0.79/0.79 with
  `intra-pair-raw` 0/0/11/11; `slow-op-loop` 44/35/34/33 with refusals 0/6/13/12 (non-monotonic, as
  the lesson says); `paired-branches` 9/7/7/6 with `branch-slot` 0/1/1/1. The retire MAPS confirm the
  two claims cycle totals cannot support: exactly one instruction moves w2→w3 on `sum-loop`
  (last retire 43 → 42) and the w3 and w4 maps are **identical**; `paired-branches` moves `i3` 6 → 5
  at w3, which is the two-stage ask's whole justification.
- **`peakDataMemoryRows` reading the LAST cycle is sound, not an optimization to distrust.**
  `SparseMemory` has no delete and no engine ever restores a memory snapshot (checked all six
  processors: memory is constructed at `load` and never reassigned), so the defined-address set is
  monotone and the final count is the peak by construction. Reading `recording[0]` instead reddens.
- **The label-collisions net is real.** Deleting the horizontal escape reddens it (M13 finding 2
  cannot regress silently). Its own claim that reverting `IFID_CORRIDOR` reddens with 452 buried
  labels was not re-checked.
- **Four of the five height reserves redden when broken**: the memory panel's ghost rows, the idle
  cache chip's content AND its mono face (separately), `preRunMicro`'s presence, and the issue
  readout's ghosts.
- **Labels drawn on wires are not a new problem.** 19,134 label-box/wire-segment overlaps exist
  across the corpus × widths 1–4 × two tiers WITHOUT the horizontal escape (labels are opaque and
  drawn over their own wire by design); the escape adds 850, a 4% change to an intended phenomenon.
  Not a finding — recorded because the escape is the first placement motion that can cross a wire,
  so this is the measurement that closes the question.

## Method note for the next pass

**A probe that measures nothing passes.** This review's first label-on-wire probe returned 0 hits
across 477,556 wire segments — with the label boxes artificially grown by 50 units. The bug was that
an orthogonal segment has ZERO thickness on one axis, so an overlap test demanding a positive extent
on both axes can never fire. The vacuity check (grow the boxes and require the count to rise) is what
caught it, and it cost one run.

**A break harness's target glob is part of its claim.** Mutating the verdict chip's reserve to empty
looked GREEN against `layout-stability.test.tsx` and is RED against `packages/web` — the guard lives
in `DatapathDiagram.test.tsx`. Every mutation in findings 1–4 was therefore re-run against the whole
web suite, and finding 2's against `tsc` as well (its first run reported a false `tsc` red that was
this review's own probe file failing to typecheck).

**`git checkout --` in a break harness destroyed this review's own uncommitted work — the trap this
repo already had written down, walked into anyway.** M13's log says "commit before you break". The
finding-2 refactor was mid-flight, uncommitted, when the harness restored `session.ts` and
`useSimulator.ts` from HEAD between mutations; three of its six mutations then reported SKIP (their
anchors had vanished with the reverted file) and one reported a red that was really the revert. It was
recoverable only because an earlier `git stash`/`pop` had left a dangling commit
(`git fsck --dangling`, then `git checkout <sha> -- <paths>`).

The rule that actually prevents it: **a harness that reverts files may only run against a committed
tree, and it should refuse to start otherwise** — one `git status --porcelain` check at the top,
listing the paths it intends to touch. A second, cheaper habit: when a harness prints SKIP, stop and
find out why. SKIP was the signal here and it was read as noise for two mutations.
