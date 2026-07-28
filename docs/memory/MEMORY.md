# Project memory — CPU Visualizer

A pedagogical RV32I simulator. **M1–M12 all COMPLETE** (spec §12's roadmap finished at
M10; M11/M12 came from the don't-foreclose flag). **M13 (issue width > 2) is IN PROGRESS** —
steps 0/0b/1/2/3/4/5/**6** done; the ISSUE control now offers widths 1/2/3/4, `MAX_ISSUE_WIDTH` lives
in `engine-common` so the **out-of-order model shares the bound and is netted at it**, and the
arity->2 nets, derived width-3/4 timing matrix and recorder/`location` proofs are all in. Next: step 7
(the datapath at N lanes — **step 5 found `datapath-superscalar.ts`'s `MAX_WIDTH = 2` silently
dropping an `EX.2` occupant**, and the lane set extends to four validated tints). Six models ship,
each with a lesson track. Repo **6157 tests**, five gates green.

- [Project overview](project-overview.md) — what it is, the spec contract, the stack +
  package DAG, and the index into the milestone logs. **Hub — start here.** The log was one
  242KB file until 2026-07-28; now one file per milestone, each recallable on its own
  `description`. Read the relevant one before touching that package.
  - [M1 engine + web shell](m1-engine-and-web-shell.md) — through the first datapath.
  - [M2 multi-cycle](m2-multi-cycle.md) — incl. steps 5C/5D/5E.
  - [Web visual layer](web-visual-layer.md) — theme, palette, `DatapathDiagram`, templates.
  - [M3 pipeline](m3-pipeline-engine.md) + [web](m3-pipeline-web.md) — the 5-stage machine.
  - [M4 branch prediction + ISA panel](m4-branch-prediction-and-isa-panel.md)
  - [M5 ISA lesson track](m5-isa-lesson-track.md)
  - [M6 caches](m6-caches-engine.md) + [corpus/web](m6-caches-corpus-and-web.md)
  - [M7 superscalar](m7-superscalar-engine.md) + [web](m7-superscalar-web.md) — **INV-8 is
    a FALSE net here.**
  - [M9 out-of-order](m9-out-of-order.md) + [M10 lessons](m10-ooo-lesson-track.md)
  - [Condensed log](condensed-milestone-log.md) — M8/M7/M2/M6 compressed findings.
- [M11 deep pipeline — plan + engine](m11-deep-pipeline-planned.md) — the 7-stage machine,
  steps 0–5 + every pinned decision. Read before touching `engine/deep-pipeline`.
  - [M11 cache, datapath, closing pass](m11-deep-pipeline-view-and-cache.md) — steps 6–8.
- [M12 deep-pipeline lessons](m12-deep-pipeline-lessons.md) — the "deeper machine" track;
  the first lesson track whose subject is a DELTA against a machine already met. Read
  before authoring ANY lesson: the flush-`stages`-is-not-the-penalty trap, the
  un-anchorable beat's lawful home, and "which fields of a declarative format does the
  app actually read?" (its browser pass found `Lesson.depthDefault` dead since M1).
- [M11+M12 review resolved](m11-m12-review-resolved.md) — **✅ all 5 findings FIXED
  2026-07-28** (4466→4498 tests; 2 browser-verified). Bug classes to check before adding
  a model, a field a view reads, or a config-exclusive lesson. Its sharpest method
  lesson: **run every new test against the BROKEN code before trusting it** — one
  property sweep passed 8/8 on the bug it was written for. Write-up at
  `docs/reviews/m11-m12-review-findings.md`.
- [M9+M10 review resolved](m9-m10-review-resolved.md) — ✅ all 10 findings fixed
  2026-07-24; guardrails for expanding the OoO corpus/models/knobs.
  `docs/reviews/m9-m10-review-findings.md`.
- [The browser is the only net](browser-is-the-only-net.md) — headless tests here are
  `renderToStaticMarkup` with no jsdom, so **no test can see a click**; 9 of 10 view
  steps shipped a defect only the browser caught. **Hub** — read before any browser pass.
  - [CDP recipe](browser-rig-cdp-recipe.md) — launch & attach; target by URL, no fallback.
  - [Chrome cleanup](browser-rig-chrome-cleanup.md) — never `taskkill //IM`; kill the tree by PID.
  - [Vacuity traps](browser-rig-vacuity-traps.md) — how a green check measures nothing.
  - [Screenshot limits](browser-rig-screenshot-limits.md) — what the image can't settle.
- [Never kill dev servers by port](never-kill-dev-servers-by-port.md) — several vite
  projects climb past each other on 5173+; **a port never tells you whose server it is**
  — identify by served `<title>`. Applies to CDP debug ports too.
- [Cycles cannot see a lost forward](cycles-cannot-see-a-lost-forward.md) — verify engine
  changes on the EVENT MULTISET under hand-built adversarial programs: a cycles-only
  identity held in every cell while two `forward` events silently vanished.
- [Future microarchitectures](future-microarchitectures.md) — depth is DELIVERED (M11);
  **WIDTH is the one open axis.** Carries a ⚠ CORRECTION: its claim that the pairing rules
  are pair-shaped was FALSE — it paraphrased the guard's error message, not the code.
  - [M13 width — in progress](m13-width-planned.md) — steps 0/0b/1/2/3/4/5/**6** done. **Step 6
    proved INV-8 is a FALSE net by EXPERIMENT rather than assertion:** an engine running narrow
    (`Math.min(width, 2)`) reddens 147 of the 180 new out-of-order timing cells and **zero of 807
    conformance cells.** It also found that two "lawful answers" were not symmetric (eslint forbids
    OoO importing the superscalar, so the shared bound had to move down to `engine-common`); that
    gating a CONTROL's positions cannot contain a hazard reachable by a model switch; that the old
    seam fixtures (`sum-loop`, `array-sum`) are **structurally blind to the 3→4 flip**; and that the
    `loadInto` wiring gap is now a **HALF-dead toggle** — widths 1/2 correct, 3/4 collapsed, invisible
    to all 1518 web tests, so **step 9 must check the WIDEST position specifically.** `configLabel`'s
    `?? 1` was MEASURED still unreachable and stays handed forward rather than claimed closed. **Step 5's
    finding is in the VIEW, not the engine:** `datapath-superscalar.ts` hard-codes `MAX_WIDTH = 2`, so
    `parseLocation` returns `null` for slot ≥ 2 and an `EX.2` occupant is **dropped from occupancy
    with no crash and no red test** — handed to step 7. Its method lessons: a fixture sized for the
    old width is a DIFFERENT measurement wearing the same name (`TEN_INDEPENDENT` peaks at 11, not
    20, at width 4); SUBSET and SURJECTIVITY of the location set have different scopes; **width ≥ 3
    is where a slot can move by more than one in a cycle, and width 4 is NOT the extreme case**
    ([0,1,2,1]); and the subset test's own assertion was BLIND to the clamp break — only the
    non-vacuity clause riding with it reddened. **Step 4's finding
    is in `engine/conformance`, not the engine:** `configLabel` compared optional knobs RAW and
    rendered them DEFAULTED, so `undefined` vs. explicit `1` printed `width 1` twice — the inverse of
    the injectivity invariant that file itself declares load-bearing. Its proof is an experiment:
    collapsing the render to `min(w, 2)` reddens 3 guards while the **797-test conformance matrix
    stays entirely green**. Also: **nothing in this repo asserts on `it()` titles**, so title
    invariance must be MEASURED (JSON dumps, 0 of 1140 moved) — a green run is not evidence of it.
    Step 3's sharpest
    finding is about MEASUREMENT: the timing suite's ruler looped `s < 2`, so every group of 3 or 4
    would have read as 2 and all 44 derived cells would have been permanently green — and **step 1's
    arity sweep could not have matched it**, because the arity was a loop bound over a template
    string. Also: only 3 of 11 programs ever fill four slots, and a break that caps the group at 3
    leaves `branch-flavors` at exactly 10 cycles — **no cycle count in the repo can see it.**
    ⚠ `Set-Content` mojibaked a source file mid-step; never use it on one here. The rules were
    already width-generic and the audit's code sweep came back EMPTY; **a live width-2 HANG in
    shipped code** (`bnez` then `ecall`; the corpus was safe only by its `li a7, 10` exit spacer
    — fixed `a9f1b70`); width 4 is where widening stops paying. Guard now `MAX_ISSUE_WIDTH = 4`,
    exported. Step 2's `wide-groups.test.ts` watched **7 breaks**, and its finding is about the
    REPO: the only existing net at widths 3/4 is a LIVENESS sweep, so it reports arity bugs as
    hangs and crashes, never as the defect. Both gating decisions pinned. **Read before touching
    `engine/superscalar` or the lane hues** — the lane tints are a SECOND validated channel, not
    `PHASE_COLORS`, and the two share no constraint.
- [Splitting an oversized memory](splitting-an-oversized-memory.md) — move bytes verbatim,
  keep the original name as the hub, verify blank-lines-INCLUDED against git; two splits
  each shipped a defect their own net was blind to. `docs/memory` is a git-tracked junction.
- [Workflow rituals](workflow-rituals.md) — batch-end / "session end" = update
  memory+docs, commit, push.
- [Commit and push preference](feedback_commit_and_push.md) — always commit and push
  after every change, no confirmation needed.
- [Best-practices source](best-practices-source.md) — the guide the user asked to apply,
  and what was adopted/skipped.
