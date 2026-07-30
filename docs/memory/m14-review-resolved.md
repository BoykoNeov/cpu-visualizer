---
name: m14-review-resolved
description: "M14 code review — all 5 findings fixed 2026-07-30 (7125→7132 tests). Read before trusting a reserve, a docblock's coverage claim, a comment that quotes prose, or running a break harness on a dirty tree."
metadata:
  node_type: memory
  type: project
  originSessionId: 77c490d8-3b5b-41ba-976c-4470e1a40a55
  modified: 2026-07-30T12:28:53.934Z
---

**M14's code review is ✅ COMPLETE — all 5 findings fixed 2026-07-30**, write-up at
`docs/reviews/m14-review-findings.md`. A **directed inline pass** over `591f89a..HEAD` (40 commits,
35 files, +4793/−233), not the `/code-review ultra` fan-out: the built-in needs a branch or PR diff
and `main` was clean and 0 ahead of `origin/main`, so it had nothing to review. **A fan-out over
`89bb26e..HEAD` is still open and still worth running** — it would also see these fixes.

Repo **7125 → 7132 tests**, five gates green (build included, run explicitly because the RESOLVED
table claimed it). Fix commits `2c9cb71`, `4d7601d`, `c4c570e`, `3f3bfc4`; doc `f9c398b` + `4b74e1d`.

## The transferable lessons

- **A reserve's `MAX`-ness needs a net of its own, and the obvious assertion is self-referential.**
  `expect(render).toContain(LONGEST_REFUSAL_TEXT)` catches an EMPTY reserve and cannot catch a WRONG
  one — the constant and the assertion move together, so a reducer flipped to keep the SHORTEST
  string passed all of `packages/web` and `tsc`. Assert the property against the SOURCE collection
  instead (every text ≤ the constant, and the constant is one of them). Finding 1.
- **Moving untestable code somewhere callable does not always close the class it belongs to.** M13's
  finding-5 fix moved the config expression out of a `useCallback`; the eight-field COPY stayed, and
  `forwarding: forwardingRef` has exactly the same transposition surface as
  `forwarding: forwardingRef.current`. Something must say which source feeds which field — so the
  fix is to **remove the names**, not relocate them: one `useRef<SessionKnobs>`, a spread with no
  field names, and a rest-destructure (`openingKnobs`) for the lesson path. Finding 2.
- **A same-typed swap is invisible to `tsc` AND to a fixture with repeated values.** Five of the
  eight shell knobs are `number`/`boolean`. The sentinel fixture's four numbers are 3/4/5/6 and its
  booleans differ, _and the test asserts that first_ — a fixture with two equal same-typed knobs
  cannot see the defect it exists for. Related: [browser is the only net](browser-is-the-only-net.md).
- **When a comment quotes content, the quote is a claim about a file — check it.** The cache track's
  order pin justified itself by quoting `cache-conflict` as spending _"the reuse the last lesson made
  free"_. **That sentence is not in the lesson.** It reads well, states the real dependency, and was
  written into a justification rather than read out of the narration. Inverts nothing about
  [M13's](m13-review-resolved.md) "don't trust a docblock's stated reason" — it extends it to prose.
- **A docblock claiming coverage the code lacks is its own defect class**, and three of the
  findings were that: the reserve's stated purpose, `session.ts`'s "watching `engine-config.test.ts`
  name it", and `layout-stability.test.tsx`'s "every cursor … including the pre-run one" over a
  sweep that skipped it (finding 6, added during the fix pass).
- **A probe that measures nothing passes.** The label-on-wire probe returned 0 hits over 477,556 wire
  segments — with the label boxes grown by 50 units. An orthogonal segment has ZERO thickness on one
  axis, so an overlap test demanding positive extent on both axes can never fire. The grow-it-and-
  require-the-count-to-rise check cost one run. See [vacuity traps](browser-rig-vacuity-traps.md).
- **A break harness's target glob is part of its claim.** One mutation read GREEN against
  `layout-stability.test.tsx` and RED against `packages/web` — the guard lived in a third file.
- ⚠ **`git checkout --` in a break harness destroyed this review's own uncommitted refactor** — the
  trap [M13's log](m13-width-planned.md) already records, walked into anyway. Recovered only because
  an earlier `git stash`/`pop` left a dangling commit (`git fsck --dangling`, then
  `git checkout <sha> -- <paths>`). **A harness that reverts files must refuse to start on a dirty
  tree** — one `git status --porcelain` check at the top. And its **SKIP lines were the signal** that
  it had happened; they were read as noise for two mutations.

## Verified sound (don't re-derive)

- **All twelve headline figures in the three M14 lessons, against an oracle written for the review**
  rather than the milestone's own tests: `sum-loop` 56/44/43/43 and IPC 0.61/0.77/0.79/0.79 with
  `intra-pair-raw` 0/0/11/11; `slow-op-loop` 44/35/34/33 with refusals 0/6/13/12; `paired-branches`
  9/7/7/6 with `branch-slot` 0/1/1/1. The retire MAPS carry the two claims cycle totals cannot: one
  instruction moves w2→w3 on `sum-loop` and the w3/w4 maps are IDENTICAL; `paired-branches` moves
  `i3` 6→5 at w3. See [M14](m14-width-lessons-step0.md).
- **`peakDataMemoryRows` reading the LAST cycle is sound**: `SparseMemory` has no delete and no engine
  ever restores a memory snapshot, so defined addresses grow monotonically.
- **Labels overlap wires 19,134 times by design** (opaque boxes drawn over their own wire); the M13
  horizontal escape adds 4%. Not a defect — the measurement that closes the question.

## What this pass did NOT read

Every source file, yes. **No sentence of the three new lessons' narration** — the figures were
verified, the prose around them was not. Also unread: most of `lessons.test.ts`'s +1553,
`session.test.ts`, `pairing-readout.test.ts`, `MicroTablePanel.test.tsx`. A fan-out should send a
reader at the content.
