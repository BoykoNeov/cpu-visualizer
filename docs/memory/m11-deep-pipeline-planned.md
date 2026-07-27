---
name: m11-deep-pipeline-planned
description: 'M11 (the 7-stage deep pipeline) — STEPS 0+1 DONE (the model MVP runs, every coefficient confirmed), steps 2+ open; the scope the user pinned, the stage split, and why the plan leads with the timing matrix instead of INV-8'
metadata:
  node_type: memory
  type: project
  originSessionId: bc99b34f-e3f6-4309-b7d9-0202a194542a
  modified: 2026-07-27T10:58:49.060Z
---

**The spec's §12 roadmap is FINISHED** — tiers 1–5 (single-cycle → multi-cycle →
5-stage pipeline → caches/prediction → in-order superscalar → out-of-order) are all
built through M10. So "what's next" is no longer answerable from the spec; it comes
from [[future-microarchitectures]].

**M11 = the deep pipeline (7-stage). Planned 2026-07-27; STEPS 0 AND 1 DONE 2026-07-27**
(the package scaffold + DAG ripple, then the model MVP). Steps 2–8 open. Plan:
`docs/plans/m11-tasks.md`, whose per-step entries record what landed and every judgement
call, so later steps don't re-litigate them.

**Step 1 landed the working machine (18 unit tests, repo 4051 → 4069).** The two
judgement calls that shape everything after it:

- **The EX split is `EX1 = the forwarding network, EX2 = everything else`** (ALU switch,
  `alu-op`, control resolution, the EX2/MEM build). So **`Ex1Ex2Latch` carries OPERANDS,
  never a result** — the ALU→ALU bubble is enforced by the latch's SHAPE, not by a rule
  someone could forget, because there is nothing in that latch to forward. `alu-op` fires
  in the EX2 cycle, not EX1.
- **IF1 reads the instruction word; IF2 does no new work.** The honest-looking alternative
  (IF1 issues the address, IF2 receives it) was REJECTED because an IF1 occupant would then
  have no `encoding`, and `InstructionInstance.encoding` is not nullable — that is the
  trace-schema change the falsifiable criteria make a STOP. IF2's content is DEPTH itself.

**Every PER-HAZARD coefficient was hand-derived and matched the engine on the FIRST run** —
including the "two width-2 flushes" shape below, now CONFIRMED rather than expected. **This
does NOT pre-verify step 3**, whose assertion is the closed form `N+6+S+P` over the full
corpus × forwarding × prediction, where hazards interact and loops repeat them; step 3 is
still the net. Step 1 also found a **THIRD flush shape the plan never named**: an
unpredictable `jalr` correcting one cycle after a younger predictable branch's bet emits a
**non-contiguous `['EX1','IF1']`** (the bet emptied ID and IF2 but refilled IF1). So
`flush.stages` is not always a contiguous run — read the misprediction penalty as a TOTAL,
never as a shape. The new stall reason is **`'ex-latency'`**: not `'raw'` (pinned
repo-wide to mean "forwarding is off" — `pairing-readout.ts:121`, `lessons.test.ts:51`)
and not `'alu-use'` (`lui` stalls a consumer while running no ALU, since the two-cycle
execute is uniform). The halt squash kills **TWO** shadows, and the empty-`stages` guard
is needed on the **bet** path as well as the squash. The mutation check step 3 will run is
written into the processor's file header, because with this split it is not a one-line
edit.

**Step 4 has a scheduling hazard to check FIRST:** it wants a real-engine case inside
`packages/web/src/pipeline-map.test.ts`, but step 0 deferred the web trio to step 5.
Vitest resolves it (that alias landed at step 0) while `npm run typecheck` likely will
not — so step 4 may have to move after step 5.

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
- **The misprediction TOTAL of 4 does NOT arrive as one flush event — CONFIRMED at step 1**,
  no longer a prediction. Prediction OFF: one
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
