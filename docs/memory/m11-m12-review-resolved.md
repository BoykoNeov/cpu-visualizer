---
name: m11-m12-review-resolved
description: 'M11+M12 code review — all 5 findings fixed 2026-07-28; holds the bug-class guardrails for adding a model, a view field, or a config-exclusive lesson.'
metadata:
  node_type: memory
  type: project
  originSessionId: b644c234-7252-4e02-ab6e-5621fc38117a
  modified: 2026-07-28T07:07:43.822Z
---

`/code-review high b391dc1..HEAD` (2026-07-28, 63 files ~11.7k ins) over the M9+M10
**fix commits** + M11 + M12. **All 5 findings FIXED** — repo 4466 → 4498 tests, all
five gates green, ranked write-up at `docs/reviews/m11-m12-review-findings.md`.
Findings 2 and 5 browser-verified on the SHIPPED bundle (27 checks, rig at
`M:/claud_projects/temp/m11m12-fix-browser/verify.mjs`).

Read this before adding a model, adding a field a view reads, or authoring a lesson
with config-exclusive steps.

**The five, as bug classes:**

1. **A freeze that captures on detection must not re-resolve on release.** The
   superscalar emitted a DUPLICATE `forward` — it holds a younger pair-mate in
   `exMem` for the whole freeze including the release cycle, where the other two
   engines hold only the missing memory op (which forwards to nobody). Fixed with
   `IdExLatch.operandsResolved`. Same value, so no state was wrong — what moved was
   the event multiset under a knob documented as a pure timing shadow.
2. **A lesson with config-exclusive steps must ASK for the config change**, in the
   step before the first one that needs it (`branch-bet`'s shape). `runner.ts` skips
   an unanchored step in SILENCE, so `deep-bet-pays-double` showed 3 of 5 steps and
   then asserted "Prediction is on." on a machine that wasn't.
3. **`x < 1` is not a positivity guard** — `NaN < 1` and `1.5 < 1` are both false.
   Use `Number.isInteger(x) && x >= 1`. This was the M9+M10 review's OWN fix, landed
   with tests, still wrong.
4. **Eight docblocks still said the deep pipeline refuses a cache**, which M11 step 6
   made false in the same range — including `stageMem`'s, directly above its own
   miss/stall/release split.
5. **A view reading a per-model field NAME fails silently.** `cache-grid` read
   `micro.exMem`; the deep pipeline calls it `ex2Mem`, so the cache panel went IDLE
   for that machine's whole freeze — reintroducing the exact blanking the `filling`
   state exists to prevent, on a shipped config, with nothing thrown.

**The method lessons, which outlive the findings:**

- **A property sweep can be vacuous in the direction it is aimed.** Finding 1's sweep
  passed 8/8 against the BROKEN machine until the geometry that keeps a producer alive
  across the freeze was added to the loop. **Run every new net against the broken code
  before trusting it** — a green new test proves nothing about what it can see. Same
  family as the one-directional vacuity in [[browser-is-the-only-net]].
- **Ask what a docblock's stated REASON would be if it were false today.** Findings 4
  and 5 are one failure at two severities: a comment justifying a practice, whose
  justification expired when a scope lever moved. In 5 the stale reasoning was
  load-bearing enough to CAUSE the bug — the counter sat on the processor because
  "`micro.cache` is what the view actually reads", which was never true of `filling`.
- **"Known and deliberate" is not a substitute for the mechanism.** Finding 2 was
  documented as intentional in `m12-tasks.md`, with a justification that named prose
  which did not exist ("step 1's prose is what invites the flip" — step 1 invites
  watching depth).
- **Start a review range at the previous review's HEAD, not the milestone boundary.**
  Finding 3 lived in the M9+M10 fix commits, which no review had ever seen.
- **Positive controls are structural, not decoration.** Finding 5's test drives the
  five-stage AND the deep pipeline in one `it.each`: the helper can only return
  `filling` or not, so a lone deep assertion would pass on the day it stopped working
  for everyone.
