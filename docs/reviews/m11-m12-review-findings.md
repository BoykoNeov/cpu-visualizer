# M11 + M12 code review — findings, all fixed

Source: `/code-review high` over `b391dc1..HEAD` (63 files, ~11.7k insertions), run
2026-07-28. `b391dc1` is the exact HEAD the M9+M10 review looked at, so the range
covers three things: that review's own **fix commits**, M11 (the 7-stage deep
pipeline), and M12 (its lesson track). 5 findings survived verification — 2 MEDIUM,
3 LOW.

Line numbers are as of `582a525` and may drift.

## ✅ RESOLVED — all 5 fixed (2026-07-28)

Each in its own commit with a regression test. The two user-visible ones (2, 5) were
additionally **browser-verified on the shipped bundle** (`vite preview`, rig at
`M:/claud_projects/temp/m11m12-fix-browser/verify.mjs`, 27 checks, all pass). Repo
went 4466 → 4498 tests; typecheck / lint / build / format:check green.

---

### 1. MEDIUM — the superscalar emitted a duplicate `forward` across a miss-freeze

`packages/engine/superscalar/src/processor.ts` · fixed in `c0069e9`

M11 step 6a's miss-freeze fix resolves EX's operands on the miss's **detection**
cycle, so a producer that retires during the freeze is not lost. On the **release**
cycle the freeze is over and EX resolves them again the ordinary way — and this
machine, alone of the three, still has something to match: `stageMem`'s `frozen`
walk re-presents a younger **pair-mate** in `exMem` for the whole freeze including
that cycle. One read of one value, two `forward` events.

The value is identical, so no architectural state was ever wrong. What moved is the
event multiset under a knob the repo documents as a pure timing shadow, and
`nth`-indexed anchors over it.

**Fix:** `IdExLatch.operandsResolved`. The capture marks the operands; EX uses them
as they stand. This is not a rule of this machine's own — the other two engines
already report the forward on the detection cycle and match nothing on release, so
the flag is what makes the wide machine **agree** with them.

**The net, in three parts, because the obvious one is vacuous.** The existing
"exactly once" test forwards from MEM/WB, which `holdInMem` bubbles for the whole
freeze. Measured against the broken machine, all eight cells of a property sweep
over that program **passed**. Only a producer paired _with_ the load survives to be
re-matched. So the file now carries a named EX/MEM-sourced test asserting its own
`from` (a front end that stopped pairing would otherwise make the count 1 and the
test green for the wrong reason), plus a property sweep — no port forwarded twice,
anywhere — over **both** geometries × both widths × four alignments. `engine/pipeline`
and `engine/deep-pipeline` carry the property test too: they pass today for a reason
that was an argument reconstructed by hand (what they hold across a freeze is the
missing memory op, which forwards to nobody), and an argument about today's
forwarding sources is not a guarantee about tomorrow's.

### 2. MEDIUM — `deep-bet-pays-double` never asked for the toggle it needs

`content/lessons/deep-bet-pays-double.json` · fixed in `324879d`

The lesson declares `static-not-taken`; its steps 3 and 4 anchor on
`branch-predicted-taken` / `branch-not-taken`, reasons only a machine that **bets**
can emit. No step asked the learner to flip the control. `runner.ts:96` skips an
unanchored step in silence, so a learner following the lesson as it opens saw three
of five steps, then read "Prediction is on." about a machine configured not to
predict — a false claim about machine state in shipped prose, the same shape as the
tooltip defect M11 step 5 found.

The config-exclusive **shape** is right and is `branch-bet`'s. What was missing is
the thing that makes the shape work, which `branch-bet` does explicitly ("it is worth
seeing before you flip the toggle", in the step _before_). Step 2 now carries that
prompt at all three tiers.

`docs/plans/m12-tasks.md:235` justified the gap with "step 1's prose is what invites
the flip". Step 1 says "Watch what depth does to that price" — it invites watching
depth. Corrected in place: **a plan doc that justifies a gap with a sentence that
isn't there is how the gap survived a browser pass.**

### 3. LOW — a guard that rejects 0 and admits `NaN` is not a guard

`packages/engine/out-of-order/src/processor.ts` · fixed in `c6ff1fe`

The M9+M10 review's finding 6 added `robSize < 1` / `numMshrs < 1` to fail fast on
capacities that livelock, with a test for each. `NaN < 1` is false. `1.5 < 1` is
false. Both shapes walk past the guard into the livelock it exists to prevent —
`robSize: NaN` makes `Rob.hasRoom`'s `length < NaN` false forever — and end at the
recorder's cycle cap and the misleading "non-terminating program?" the guard was
written to replace. `issueWidth` had the identical hole one line above, which the
review did not name.

All three now go through `positiveCapacity` (`Number.isInteger && >= 1`).
`slowOpLatency` is deliberately left unguarded and that is now **asserted** rather
than left to look like an omission: every use sits behind a `>= 2` test, so a bad
value is inert, not stuck.

**Worth noting where this came from:** a fix from the previous review, landed with
tests, still wrong. That is the argument for starting a review range at the last
review's HEAD rather than at the milestone boundary.

### 4. LOW — eight docblocks still said the deep pipeline refuses a cache

`packages/engine/deep-pipeline/**`, `packages/web/**` · fixed in `244fafc`

`stageMem`'s own doc opened "Exactly one cycle, always: this machine has no cache"
directly above the three-way miss / mid-stall / release split in its own body;
`reset`'s said "REFUSE a cache rather than ignore one" above the line that constructs
one. M11 step 6 landed in the same range.

The review named three sites. Grepping the claim found **eight**, splitting usefully:
`models.ts` and one `models.test.ts` comment were already corrected at M11 step 7 —
one explicitly noting it had said the opposite until then — while `differential`,
`recorder`, `timing`, `pipeline-map` and the other `models.test.ts` block still
asserted the refusal in the present tense.

Those five were not deletions. Each justifies writing `cache: null` **explicitly**
rather than inheriting it, on the grounds that an inherited default would throw. That
reason expired; the practice did not, and what replaced it is **stronger**: an
inherited default now runs those suites on a _different machine_ — no throw, no red,
a differential quietly proving something other than what it claims.

### 5. LOW — the cache panel went dark for the deep pipeline's whole freeze

`packages/web/src/cache-grid.ts`, `packages/engine/deep-pipeline/src/processor.ts` ·
fixed in `582a525`

`accessThisCycle` derives the `filling` countdown from `micro.exMem` — the latch name
the four five-stage-shaped machines use. The deep pipeline has two execute stages and
calls it `ex2Mem`, so the read returned `undefined`: `miss` on the detection cycle,
then `idle` for the entire freeze.

That is precisely what the `filling` state exists to prevent, in its own docblock's
words — the panel blanking "at the exact moment the map above it shows `MEM MEM MEM`
and the flagship 'watch it stall on a miss' is happening". M11 step 6 gave this
machine a cache and reintroduced it on a shipped, user-reachable config. **Nothing
threw: a view reading a field a model does not have is silent.**

Ranked LOW by the reviewer and treated as higher here, because it is a regression of
a shipped pedagogical behaviour, not a missing nicety.

**Fix, two halves.** The counter moves from a private processor field onto
`Ex2MemLatch`, mirroring `engine/pipeline`'s `ExMemLatch` — it sat on the processor
under a docblock arguing a per-latch copy bought nothing because "`micro.cache` is
what the view actually reads", which is the claim this finding falsifies. Then
`memOccupant` reads whichever latch the model has: a deliberately narrow model-shaped
read, since only the _name_ differs.

The test drives both engines through one program in a single `it.each`, and the
five-stage row is **not decoration** — the helper can only return `filling` or not, so
a lone deep-pipeline assertion would still pass on the day it stopped deriving
anything for anyone. Verified to discriminate: with the old read restored, the
five-stage row passes and the deep row fails.

---

## What generalizes, beyond these five

- **A property sweep can be vacuous in exactly the direction it is aimed.** Finding 1's
  sweep passed 8/8 on the broken machine until the geometry that keeps a producer alive
  across the freeze was added to the loop. Run a new net against the _broken_ code before
  trusting it — a green new test proves nothing about what it can see.
- **Ask what a docblock's stated REASON would be if it were false today.** Findings 4 and
  5 are the same failure at different severities: a comment justifying a practice, whose
  justification expired when a scope lever moved. In finding 5 the stale reasoning was
  load-bearing enough to cause the bug.
- **A per-model field NAME is an unchecked seam.** Nothing throws when a view reads
  `micro.exMem` on a model that calls it `ex2Mem`. Every new model is a chance to
  silently opt out of a view behaviour.
- **"Known and deliberate" is not a substitute for the mechanism.** Finding 2 was
  documented as intentional — with a justification that named prose which did not exist.
- **Start a review range at the previous review's HEAD.** Finding 3 lived in the M9+M10
  fix commits, which no review had ever looked at.
