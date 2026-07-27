---
name: m11-deep-pipeline-planned
description: 'M11 (the 7-stage deep pipeline) — STEP 0 DONE (package scaffolded), steps 1+ open; the scope the user pinned, the stage split, and why the plan leads with the timing matrix instead of INV-8'
metadata:
  node_type: memory
  type: project
  originSessionId: bc99b34f-e3f6-4309-b7d9-0202a194542a
  modified: 2026-07-27T10:23:13.516Z
---

**The spec's §12 roadmap is FINISHED** — tiers 1–5 (single-cycle → multi-cycle →
5-stage pipeline → caches/prediction → in-order superscalar → out-of-order) are all
built through M10. So "what's next" is no longer answerable from the spec; it comes
from [[future-microarchitectures]].

**M11 = the deep pipeline (7-stage). Planned 2026-07-27; STEP 0 DONE 2026-07-27** (the
package scaffold + DAG ripple). Steps 1–8 open. Plan: `docs/plans/m11-tasks.md`, whose
step-0 entry records what landed and the two judgement calls, so later steps don't
re-litigate them.

**Step 0's reusable finding — the eslint guardrail has THREE code paths, and the plan
only named one.** `deny()` is consumed two ways: lower layers spread `...MODELS`, each
model's own block subtracts itself with `MODELS.filter`. The probe the plan asks for
(`packages/trace` importing the new model) exercises only the spread. The one that
actually matters for M11 is **the new package importing `@cpu-viz/engine-pipeline`** —
step 1 is a FORK of the 5-stage, so that is the import someone reaches for. Without the
new self-exclusion block it lints CLEAN, because the package falls through to the generic
`packages/engine/**` rule which denies only `curriculum`/`web`. Verify a new model in all
three directions, not one. Also: a new `workspaces` entry needs **`npm install`** (no
symlink, no lockfile update otherwise, and `tsc -b` resolves through that symlink), and
the **web trio** (web `package.json` dep, `tsconfig` `paths`, Vite alias) is step 5's, not
step 0's — only `vitest.config.ts`'s alias belongs to the scaffold.

**Scope the user pinned:** the deep pipeline **ALONE**. The wider superscalar is a
separate later milestone — widening is _not_ a new package, it is generalizing M7's
2-specific pairing rules in place (`superscalar/processor.ts` refuses `issueWidth > 2`
by name, because `intra-pair-raw` / `mem-port` / `branch-slot` are written for a pair).
One machine per milestone is the house shape (M7 = superscalar alone, M9 = OoO alone).

**ALL DECISIONS PINNED 2026-07-27** (the user was walked through every open row with pros
and cons and took the recommendations). Three gate code, and they are one coherent rule:
**Option A stage split; EX2 is a REAL half-ALU, uniformly two cycles for every ALU op; every
control transfer resolves at the END of EX2.** One sentence — _nothing is ready until the end
of EX2_ — then explains the branch penalty, the ALU→ALU bubble and the load-use penalty at
once. The resolve point was decided on JALR, not aesthetics: `pipeline/src/processor.ts:784`
resolves every branch AND jump at ONE point, and JALR's target comes out of the now-2-cycle
ALU, so resolve-at-EX1 would need a second resolve point or a dedicated fast adder.

**Two things the plan was MISSING, found while preparing that walkthrough:**

- **The bet is placed in ID** (`pipeline/src/processor.ts:1147`), so in a 7-stage it kills
  IF2 _and_ IF1 ⇒ **a correctly predicted taken branch costs 2, not 1.** Depth taxes you even
  when the prediction is right — kept deliberately as a teaching line (making it cheap again
  means an IF1 BTB, new mechanism, out of scope).
- **The misprediction TOTAL of 4 is expected NOT to arrive as one flush event** (a
  prediction, not a derived fact — it assumes the deep engine keeps the 5-stage's
  redirect-and-refetch at the bet, which is step 1's choice; confirm from the dump).
  Prediction OFF: one
  flush of width 4 (EX1+ID+IF2+IF1). Prediction ON: the ID bet kills IF2+IF1, and by the time
  the branch reaches EX2 the EX1/ID slots hold that flush's own bubbles — so the correction
  kills IF2+IF1 again: **two events of width 2.** Step 3 derives the penalty from
  `flush.stages`, so expect this or misread it as a bug. It is also why step 4's
  "every flushed stage has an occupant" assertion guards the COMMON path: the 5-stage filters
  casualties with two null checks (`processor.ts:546-547`), the deep engine needs four, and
  two of the four are genuinely empty on every correctly-bet branch.

Also pinned: `deep-pipeline` / "Deep pipeline", inserted **between `pipeline` and
`superscalar`** — the ordered `honoring()` assertions in `models.test.ts` (~74-96) enumerate
ids in array order, so that insert shifts three or four expectations, not just line 16's list.
Cache stays step 6 (decide after step 3's dump; step 1 REFUSES a non-null cache config by
name so it cannot ship inert), datapath stays sheddable step 7, and the lesson track is its
own later milestone (M9→M10 shape).

**The stage split, now pinned: `IF1 IF2 ID EX1 EX2 MEM WB`** — which is
_exactly_ the seven-stage fixture `packages/web/src/pipeline-map.test.ts` has carried
since M3, in a file whose header still calls the deep stage set "genuinely unemitted by
anything we ship". Making that sentence false is the milestone's job (the M7 step-6 move,
applied to the depth axis instead of the lane axis). The split buys misprediction penalty
2→4, load-use 1→2, and the thesis: **ALU→ALU with forwarding ON goes 0→1 bubble — the
bubble M3's flagship made vanish comes back.** MEM stays a single stage on purpose, so
the MVP never touches M6's miss-freeze (that interaction is quarantined into step 6).

**Why the plan leads with the NET and not INV-8 — the reusable part.** An in-order
7-stage **retires in order**, so `runConformance` passes even if IF2/EX2 are pure
pass-throughs. Combined with M10 step 0's precedent (`slowOpLatency` shipped INERT), the
characteristic failure is fully specified: _a package that typechecks, passes INV-8,
renders on the map, and is a 5-stage wearing seven labels._ Therefore:

- the discriminator is the timing matrix's **coefficients**, never the drain constant
  (`N+4 → N+6` is cheap — any drain change produces it);
- step 3 carries a **pass-through mutation check** — stub IF2/EX2 and INV-8 must stay
  green while timing reddens (if INV-8 is the only thing that reddens, the net is in the
  wrong place);
- two **falsifiable UNCHANGED criteria** guard the INV-3 back door: `pipeline-map.ts`
  needs no edit and the trace schema needs no edit (`location` is a plain string
  precisely to absorb `"IF2"` depth and `"EX.0"` lanes). Reaching for either is a STOP.

Adding a model also has its own ripple, distinct from a corpus ripple — see
[[m9-m10-review-resolved]] for the `eslint.config.js` `MODELS` guardrail (review finding 7) and how to verify it.
