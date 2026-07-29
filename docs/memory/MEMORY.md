# Project memory — CPU Visualizer

A pedagogical RV32I simulator. **M1–M13 ALL COMPLETE** (spec §12's roadmap finished at M10;
M11/M12/M13 came from the don't-foreclose flag). M13 delivered issue width > 2: the ISSUE control
offers widths 1/2/3/4, `MAX_ISSUE_WIDTH` lives in `engine-common` so the **out-of-order model
shares the bound and is netted at it**, the **datapath draws N lanes** (its geometry became a
FUNCTION of the width — `geometryFor`), and the **pairing readout speaks in GROUPS rather than
pairs**, its count glosses DERIVED and its vocabulary pinned as a property. Six models ship, each
with a lesson track. Repo **6203 tests**, five gates green. **M13 has now been code-reviewed and all
5 findings are fixed** ([M13 review resolved](m13-review-resolved.md), 2026-07-29). **No milestone is
in progress** — see [Future microarchitectures](future-microarchitectures.md) for what is open.

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
- [Future microarchitectures](future-microarchitectures.md) — **DISCHARGED**: depth delivered by
  M11, width by M13, so nothing here is open work. Read it for the predictions that held and the
  one that was FALSE — its claim that the pairing rules are pair-shaped paraphrased the guard's
  ERROR MESSAGE, not the code.
  - [M13 width — COMPLETE](m13-width-planned.md) — all ten steps, step by step, with every finding
    and pinned decision. **Read before touching `engine/superscalar`, the width control, or the lane
    hues** (the lane tints are a SECOND validated channel, not `PHASE_COLORS` — they share no
    constraint). Its transferable ones: the milestone's signature defect is **a test that keys off a
    pure fold rather than the render**, which recurred 8 times and twice inside the fix written to
    stop it; **a measurement's glob is part of its claim**; **INV-8 is a FALSE net for width** (proved
    by experiment — 147 of 180 timing cells vs **0 of 807** conformance); ⚠ `Set-Content` mojibakes
    source files here, and **a break harness using `git checkout --` destroyed the uncommitted tree —
    commit before you break.**
- [M13 review resolved](m13-review-resolved.md) — **✅ all 5 findings FIXED 2026-07-29**
  (6189→6203 tests; 21 browser checks on the shipped bundle). Read before trusting a docblock's
  stated reason, writing a range claim, or adding a knob to the shell→engine seam. Its sharpest
  lesson **inverts** one this repo already had: a signed overlap is a pointer, not a verdict — and
  here it pointed the **WRONG way**. A 16-of-70-unit overlap was graded LOW as a corner clip; the
  5× crop showed the EX/MEM bar through the **middle** of a hex value. Also: code can be
  untestable **by POSITION** (a config literal inside a `useCallback` — three milestones each
  measured the same hole and each answered it with a browser pass), and **a pinned decision with
  no net is a comment** (deleting the OoO default-width decision leaves all 4400 engine tests
  green).
- [Splitting an oversized memory](splitting-an-oversized-memory.md) — move bytes verbatim,
  keep the original name as the hub, verify blank-lines-INCLUDED against git; two splits
  each shipped a defect their own net was blind to. `docs/memory` is a git-tracked junction.
- [Workflow rituals](workflow-rituals.md) — batch-end / "session end" = update
  memory+docs, commit, push.
- [Commit and push preference](feedback_commit_and_push.md) — always commit and push
  after every change, no confirmation needed.
- [Best-practices source](best-practices-source.md) — the guide the user asked to apply,
  and what was adopted/skipped.
