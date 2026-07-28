# Project memory — CPU Visualizer

A pedagogical RV32I simulator. **M1–M12 all COMPLETE** (spec §12's roadmap finished at
M10; M11/M12 came from the don't-foreclose flag). Six models ship, each with a lesson
track. Repo **4498 tests**, five gates green.

- [Project overview](project-overview.md) — what it is, the stack, and the FULL
  step-by-step milestone log (M1–M10, incl. the condensed M2/M6/M7/M8 section). Read the
  relevant milestone's section before touching that package.
- [M11 deep pipeline](m11-deep-pipeline-planned.md) — the 7-stage machine, steps 0–8,
  every finding and trap. Read before touching `engine/deep-pipeline` or its datapath.
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
- [Future microarchitectures](future-microarchitectures.md) — depth is DELIVERED (M11).
  **WIDTH is the one open axis**: `superscalar/processor.ts` still refuses
  `issueWidth > 2` by name, so that milestone generalizes pairing rules IN PLACE.
- [Workflow rituals](workflow-rituals.md) — batch-end / "session end" = update
  memory+docs, commit, push.
- [Commit and push preference](feedback_commit_and_push.md) — always commit and push
  after every change, no confirmation needed.
- [Best-practices source](best-practices-source.md) — the guide the user asked to apply,
  and what was adopted/skipped.
