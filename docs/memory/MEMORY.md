# Project memory — CPU Visualizer

A pedagogical RV32I simulator. **M1–M14 ALL COMPLETE** (spec §12's roadmap finished at M10; M11–M14
came from the don't-foreclose flag), each code-reviewed with every finding fixed. Six models ship,
each with a lesson track. **M15 (the scoreboard, a seventh model) is IN PROGRESS — step 0 of 8 done
2026-08-10; the package exists, no machine is built.**

Work since M14 is **UX/product gaps in the shell** plus one new feature. A survey after M14 found
four UX gaps; **three are done** — keyboard clock control, continuous play, and the sticky transport
bar's per-step jitter (all 2026-07-30; the jitter fix also closed continuous play's sub-880px
residual and moved both caption thresholds). The corpus is **twelve** programs, the library is
**26 lessons**, and the repo runs **11194 tests** (branch prediction by step: 7597 / 7606 / 7830 /
7863 / 9466 / 9493 / 9497 / 11193 after steps 1–8 — and **1633 of that last jump is a stale sweep
axis finally running**, not new assertions), five gates green.

**Open work:** **M15 — the scoreboard (CDC 6600), STEP 0 DONE 2026-08-10; the `/code-review ultra`
gate is discharged, but a ⛔ STOP now blocks step 1 — the pinned two-FU inventory makes WAR
UNREACHABLE and needs a second integer FU, which is the user's call**; URL permalinks; and session
persistence.
**Dynamic branch prediction is ✅ COMPLETE — all steps 0–8, finished 2026-08-09.**

Each entry below links a topic file that holds the detail — read the relevant one before touching
that area. Keep this index to one line per entry; detail belongs in the file, never here.

## Start here

- [Project overview](project-overview.md) — what it is, the spec contract, the stack + package DAG,
  and the index into the milestone logs. **Hub.**
- [The browser is the only net](browser-is-the-only-net.md) — headless tests are
  `renderToStaticMarkup` with no jsdom, so **no test can see a click**; **10 of 11** view steps
  shipped a defect only the browser caught, and it is also the only place an `<App/>` slot gate can
  be tested at all (measured 2026-08-09 at headless 0 / browser 2). **Hub — read before any browser
  pass.**

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
  class reopened 2026-07-30 (the sticky BAR stepping 81.4 ↔ 104.4px — a bar is not a panel) and
  AGAIN 2026-08-09 (the predictor panel's HEADER stepping 33px — a "constant by construction" claim
  is scoped to the rows it was reasoned about, and a panel is not only its rows).** Read before
  touching the transport bar, any caption threshold, anything whose width moves with the cursor, or
  before relocating a two-state string onto its own row.

## Post-M14 work

- [Dynamic branch prediction](dynamic-branch-prediction.md) — **✅ COMPLETE, steps 0–8.** Four models
  bet from a counter table, the panel draws it, and `bet-that-learns` teaches it. The file carries a
  per-step section; its recurring findings are that **INV-8 is a false net on the latch models and a
  real one on the OoO**, that **a break count EXPIRES when the suite grows**, and that **the canonical
  demonstration of a mechanism is usually not the test of it** (five instances, `call-return.s` the
  witness each time). **Read before authoring any lesson whose flip REMOVES a step, before trusting a
  measured cursor pair without its config beside it (37/53 is forwarding OFF, 29/40 is ON), and after
  any break table — step 8's row 9 reddened ZERO because a number the tests derive and never read
  back out of the NARRATION is a comment.** Also read before any view fold over a per-cycle event;
  before adding a corpus program (six pinned sites, not three), a field to any model's `micro`, or a
  knob to a model that speculates; before writing a rig dump (**`defaultConfig()` is not the shell's
  `OPENING_KNOBS`**); and before trusting a cross-model naming agreement or a break row you wrote by
  hand. Reusable sweeps live in `M:\claud_projects\temp\bp-step0|5|6|7|8\`, named in the file.
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
  whose existence conditions match the prose.** Also: a lesson can have NO config-exclusive step —
  and its `CONFIG_AXES` staleness finding recurred on the PREDICTION axis at branch prediction's
  step 8, so read it before trusting any axis-shaped sweep to still enumerate the shell's product.
- [M15 scoreboard — IN PROGRESS](m15-scoreboard-planned.md) — the seventh model, **step 0 of 8 done**.
  Read before any model that needs a latency source (**`slowOpLatency` has no UI control and is
  cluster-gated**) and before trusting INV-8's net status — the corpus has **zero reachable
  WAW/WAR**, so it is a false net here until step 6 and a real one after. **Read the ⛔ STOP first:
  two FUs cannot produce a WAR stall at all** — before pinning any FU inventory, hand-build the
  hazard the model exists to show and check an FU is FREE for the younger instruction. Step 0 also
  adds: a new model package needs **five** lint probe cells, not three (one checked by its MESSAGE,
  not its exit code), and **all four of its declared import edges are unexercised** at step 0.
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
