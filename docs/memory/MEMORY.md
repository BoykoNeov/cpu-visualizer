# Project memory — CPU Visualizer

A pedagogical RV32I simulator. **M1–M14 ALL COMPLETE** (spec §12's roadmap finished at M10; M11–M14
came from the don't-foreclose flag), each code-reviewed with every finding fixed. Six models ship,
each with a lesson track. **NO milestone is in progress.**

Work since M14 is **UX/product gaps in the shell** plus one new feature. A survey after M14 found
four UX gaps; **two are done** — keyboard clock control and continuous play (both 2026-07-30). The
corpus is now **twelve** programs (`nested-loop.s` landed 2026-07-30) and the repo runs **7606
tests** (7597 after branch prediction's step 1, 7606 after step 2), five gates green. A third shell fix landed 2026-07-30: the **sticky transport bar's per-step
jitter** (user-reported), which also closed continuous play's sub-880px residual and moved both
caption thresholds — see [Panel jitter](panel-jitter-and-height-reserves.md). **Open work: dynamic
branch prediction (plan written, STEPS 0, 0b, 1 AND 2 DONE — step 2 on 2026-08-09; the class exists
but nothing constructs it, so still no engine behavior — the only thing in flight), URL permalinks,
session persistence, and
the `/code-review ultra` fan-out over `89bb26e..HEAD`** (user-triggered; the no-arg form bundles the
local branch and needs no PR).

Each entry below links a topic file that holds the detail — read the relevant one before touching
that area. Keep this index to one line per entry; detail belongs in the file, never here.

## Start here

- [Project overview](project-overview.md) — what it is, the spec contract, the stack + package DAG,
  and the index into the milestone logs. **Hub.**
- [The browser is the only net](browser-is-the-only-net.md) — headless tests are
  `renderToStaticMarkup` with no jsdom, so **no test can see a click**; 9 of 10 view steps shipped a
  defect only the browser caught. **Hub — read before any browser pass.**

## Browser rig

- [CDP recipe](browser-rig-cdp-recipe.md) — launch & attach; target by served `<title>`, no fallback.
- [Chrome cleanup](browser-rig-chrome-cleanup.md) — never `taskkill //IM`; match by command line then
  **RE-COUNT**. Run `M:\claud_projects\temp\rig-sweep.ps1` at the START of every pass.
- [Vacuity traps](browser-rig-vacuity-traps.md) — how a green check measures nothing.
- [Screenshot limits](browser-rig-screenshot-limits.md) — what the image can't settle.
- [Never kill dev servers by port](never-kill-dev-servers-by-port.md) — **a port never tells you
  whose server it is**; identify by served `<title>`. Applies to CDP debug ports too.
- [Panel jitter](panel-jitter-and-height-reserves.md) — **no test here can see a HEIGHT** either; the
  reserve idiom, and a fix that passed its own guard while the browser measured no change. **The
  class reopened 2026-07-30: the sticky BAR was stepping 81.4 ↔ 104.4px and the panel sweep never
  looked at it, because a bar is not a panel.** Read before touching the transport bar, any caption
  threshold, or anything whose width moves with the cursor.

## Post-M14 work

- [Dynamic branch prediction](dynamic-branch-prediction.md) — **the only thing in flight.** Steps 0,
  0b, 1 and **2** done (schema + the `BranchPredictor` class; nothing constructs one, so still no
  engine behavior); `nested-loop.s` is in the corpus. Step 2 adds three rules: **an API that accepts
  a richer argument silently answers the questions that argument encodes**; **a getter made
  defensive can dissolve a later step's whole content**; and **the canonical demo sequence is
  usually not the test of the mechanism** — `TTTTNTTTT` does not pin the taken threshold. **Read
  before adding ANY corpus program** (it cost SIX pinned sites, not three), **before adding a field
  to any model's `micro`** (two of its three sites are whole-micro literals passed as ARGUMENTS, and
  one is a COMPONENT), and **before trusting any cross-model naming agreement — "by construction" was
  enforced by nothing and a divergent spelling passed typecheck plus all 7591 tests.** Also: **a
  break harness aimed at a step's headline risk will not find the risk in what the step exported
  ALONGSIDE it** (`predictorIndex` shipped untested); a five-scheme inertness sweep is vacuous
  without its control; and a union is a TYPE so `npm test` cannot see it shrink.
- [Keyboard clock control](keyboard-clock-control.md) — arrows/Home/End, and the **index of the
  four UX gaps** (two still open, with the greps confirming each absent). Read before any interaction
  feature: deleting one `addEventListener` left **68 of 68 headless tests green while the browser
  failed 6**. Also the CDP keyboard traps and the sticky-bar wrap its first pass missed.
- [Continuous play](continuous-play.md) — the ▶/⏸ toggle and its 5-position speed picker. Read
  before any timer, before adding anything to the transport row, and before writing a rig that clicks
  a toggle. Headline: broken 4 ways, headless stayed **47/47 green every time**, and the 4th break is
  invisible to the **browser too** — so the fix is structural and no test pretends otherwise.

## Method lessons that outlived their milestone

- [Cycles cannot see a lost forward](cycles-cannot-see-a-lost-forward.md) — verify engine changes on
  the EVENT MULTISET under adversarial programs: a cycles-only identity held in every cell while two
  `forward` events silently vanished.
- [M13 review resolved](m13-review-resolved.md) — read before trusting a docblock's stated reason,
  writing a range claim, or adding a knob to the shell→engine seam. **A signed overlap is a pointer,
  not a verdict — and here it pointed the WRONG way**; code can be untestable **by POSITION**; and a
  pinned decision with no net is a comment.
- [M14 review resolved](m14-review-resolved.md) — read before trusting a reserve, a docblock's
  coverage claim, a comment that QUOTES prose, or running a break harness on a dirty tree. **Moving
  untestable code somewhere callable does not always close its class.**
- [M11+M12 review resolved](m11-m12-review-resolved.md) — bug classes to check before adding a model,
  a field a view reads, or a config-exclusive lesson. **Run every new test against the BROKEN code
  before trusting it** — one property sweep passed 8/8 on the bug it was written for.
- [M9+M10 review resolved](m9-m10-review-resolved.md) — guardrails for expanding the OoO
  corpus/models/knobs.
- [Splitting an oversized memory](splitting-an-oversized-memory.md) — move bytes verbatim, keep the
  original name as the hub, verify blank-lines-INCLUDED against git. `docs/memory` is a git junction.

## Milestone logs

- [M1 engine + web shell](m1-engine-and-web-shell.md) — through the first datapath.
- [M2 multi-cycle](m2-multi-cycle.md) — incl. steps 5C/5D/5E.
- [Web visual layer](web-visual-layer.md) — theme, palette, `DatapathDiagram`, templates.
- [M3 pipeline](m3-pipeline-engine.md) + [web](m3-pipeline-web.md) — the 5-stage machine.
- [M4 branch prediction + ISA panel](m4-branch-prediction-and-isa-panel.md)
- [M5 ISA lesson track](m5-isa-lesson-track.md)
- [M6 caches](m6-caches-engine.md) + [corpus/web](m6-caches-corpus-and-web.md)
- [M7 superscalar](m7-superscalar-engine.md) + [web](m7-superscalar-web.md) — **INV-8 is a FALSE net
  here.**
- [M9 out-of-order](m9-out-of-order.md) + [M10 lessons](m10-ooo-lesson-track.md)
- [M11 deep pipeline](m11-deep-pipeline-planned.md) — the 7-stage machine, steps 0–5 + every pinned
  decision; read before touching `engine/deep-pipeline`.
  [Cache, datapath, closing pass](m11-deep-pipeline-view-and-cache.md) — steps 6–8.
- [M12 deep-pipeline lessons](m12-deep-pipeline-lessons.md) — the first track whose subject is a
  DELTA against a machine already met. **Read before authoring ANY lesson.**
- [M13 width](m13-width-planned.md) — **read before touching `engine/superscalar`, the width control,
  or the lane hues.** Its signature defect: **a test that keys off a pure fold rather than the
  render**, which recurred 8 times and twice inside the fix written to stop it. ⚠ `Set-Content`
  mojibakes source files here, and **a `git checkout --` break harness destroyed the uncommitted
  tree — commit before you break.**
- [M14 width lessons](m14-width-lessons-step0.md) — the width DELTA track. **Read before authoring a
  width lesson**, and before choosing between a striking event and a safe anchor: **anchor on the one
  whose existence conditions match the prose.** Also: a lesson can have NO config-exclusive step.
- [Future microarchitectures](future-microarchitectures.md) — **DISCHARGED** (depth by M11, width by
  M13). Read for the predictions that held and the one that was FALSE.
- [Condensed log](condensed-milestone-log.md) — M8/M7/M2/M6 compressed findings.

## Preferences

- [Workflow rituals](workflow-rituals.md) — batch-end / "session end" = update memory+docs, commit,
  push.
- [Commit and push preference](feedback_commit_and_push.md) — always commit and push after every
  change, no confirmation needed.
- [Best-practices source](best-practices-source.md) — the guide the user asked to apply, and what was
  adopted/skipped.
