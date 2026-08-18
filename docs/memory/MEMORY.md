# Project memory — CPU Visualizer

A pedagogical RV32I simulator. **M1–M15 ALL COMPLETE** (spec §12's roadmap finished at M10; M11–M15
came from the don't-foreclose flag), each code-reviewed with every finding fixed. **SEVEN models are
selectable**; six have a lesson track, the scoreboard's is M16. Work since M14 is UX/product gaps in the shell plus one new feature: of
the four UX gaps a post-M14 survey found, **three are done** (keyboard clock control, continuous
play, the sticky transport bar's jitter — all 2026-07-30). The corpus is **thirteen** programs, the
library is **29 lessons**, the repo runs **11920 passing tests** (11921 counting the one skipped
file), five gates green.

**Open work:** URL permalinks; session persistence; **M16 — the scoreboard's lesson track (steps 0–3 DONE
2026-08-18: dump run, plan written, decisions 1–4 pinned and 5 applied, ALL THREE LESSONS SHIPPED; next is
step 4, the track's order pins, then the browser pass)**.
**M15 is ✅ COMPLETE (all nine steps, 2026-08-10)** — the seventh model, its corpus program, and its
canonical picture, closed by a browser pass that found two defects 11 872 green tests could not see. **Dynamic branch prediction is ✅ COMPLETE (steps 0–8, 2026-08-09).**

Each entry below links a topic file that holds the detail — read the relevant one before touching
that area. **Keep this index to one line per entry; detail belongs in the file, never here.**

## Start here

- [Project overview](project-overview.md) — the spec contract, stack + package DAG, milestone index. **Hub.**
- [The browser is the only net](browser-is-the-only-net.md) — headless is `renderToStaticMarkup` with
  no jsdom, so **no test can see a click — nor a HEIGHT, nor a COLOR**; **11 of the last 12 view steps
  shipped a defect only the browser caught**, the newest a guard that was **green because it asserted
  the broken thing**. Also: **re-run a measurement against the FIX** — a metric can stop measuring
  anything the moment the defect is gone. **Hub — read before any browser pass.**

## Browser rig

- [CDP recipe](browser-rig-cdp-recipe.md) — launch & attach; target by served `<title>`, no fallback.
- [Chrome cleanup](browser-rig-chrome-cleanup.md) — never `taskkill //IM`; match by command line then
  **RE-COUNT**. Run `M:\claud_projects\temp\rig-sweep.ps1` at the START of every pass. ⚠ **The temp
  root is shared with other sessions, so the sweep can match a rig that is not yours and never
  report clean — the broad predicate is for FINDING, never for KILLING.**
- [Vacuity traps](browser-rig-vacuity-traps.md) — how a green check measures nothing.
- [Screenshot limits](browser-rig-screenshot-limits.md) — what the image can't settle.
- [Never kill dev servers by port](never-kill-dev-servers-by-port.md) — **a port never tells you whose
  server it is**; identify by served `<title>`. Applies to CDP debug ports too.
- [Panel jitter](panel-jitter-and-height-reserves.md) — **no test here can see a HEIGHT** either.
  Reopened twice (a bar is not a panel; a panel is not only its rows). Read before touching the
  transport bar, any caption threshold, or anything whose width moves with the cursor.

## Post-M14 work

- [Dynamic branch prediction](dynamic-branch-prediction.md) — **✅ COMPLETE, steps 0–8**, with a
  per-step section. Read before authoring a lesson whose flip REMOVES a step, before trusting a
  measured cursor pair without its config, before adding a corpus program or a `micro` field, before
  writing a rig dump, and after any break table. Headlines: **INV-8 is a false net on the latch
  models and real on the OoO**; **a break count EXPIRES when the suite grows**; **the canonical
  demonstration of a mechanism is usually not the test of it** (5 instances).
- [Keyboard clock control](keyboard-clock-control.md) — arrows/Home/End, and the **index of the four
  UX gaps** (two still open). Deleting one `addEventListener` left 68/68 headless green while the
  browser failed 6. Read before any interaction feature.
- [Continuous play](continuous-play.md) — the ▶/⏸ toggle and speed picker. Broken 4 ways with
  headless **47/47 green every time**, and the 4th break is invisible to the browser too. Read before
  any timer, before adding to the transport row, before a rig that clicks a toggle.

## Method lessons that outlived their milestone

- [Cycles cannot see a lost forward](cycles-cannot-see-a-lost-forward.md) — verify engine changes on
  the EVENT MULTISET: a cycles-only identity held everywhere while two `forward` events vanished.
- [M13 review resolved](m13-review-resolved.md) — read before trusting a docblock's stated reason,
  writing a range claim, or adding a shell→engine knob. **A signed overlap is a pointer, not a
  verdict**; code can be untestable **by POSITION**; a pinned decision with no net is a comment.
- [M14 review resolved](m14-review-resolved.md) — read before trusting a reserve, a coverage claim, a
  comment that QUOTES prose, or a break harness on a dirty tree.
- [M11+M12 review resolved](m11-m12-review-resolved.md) — bug classes to check before adding a model,
  a field a view reads, or a config-exclusive lesson. **Run every new test against the BROKEN code.**
- [M9+M10 review resolved](m9-m10-review-resolved.md) — guardrails for expanding OoO corpus/models/knobs.
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
- [M7 superscalar](m7-superscalar-engine.md) + [web](m7-superscalar-web.md) — **INV-8 is a FALSE net here.**
- [M9 out-of-order](m9-out-of-order.md) + [M10 lessons](m10-ooo-lesson-track.md)
- [M11 deep pipeline](m11-deep-pipeline-planned.md) (steps 0–5 + every pinned decision) +
  [cache, datapath, closing pass](m11-deep-pipeline-view-and-cache.md) (6–8) — read before touching
  `engine/deep-pipeline`.
- [M12 deep-pipeline lessons](m12-deep-pipeline-lessons.md) — the first track whose subject is a DELTA
  against a machine already met. **Read before authoring ANY lesson.**
- [M13 width](m13-width-planned.md) — **read before touching `engine/superscalar`, the width control,
  or the lane hues.** Signature defect: **a test that keys off a pure fold rather than the render**
  (8 recurrences). ⚠ `Set-Content` mojibakes source here, and a broad `git checkout --` break harness
  destroyed the uncommitted tree — **commit before you break**.
- [M14 width lessons](m14-width-lessons-step0.md) — the width DELTA track. **Read before authoring a
  width lesson**, and before choosing between a striking event and a safe anchor: **anchor on the one
  whose existence conditions match the prose.** Its `CONFIG_AXES` staleness finding recurred on the
  PREDICTION axis — read before trusting any axis-shaped sweep to enumerate the shell's product.
- [M15 scoreboard — ✅ COMPLETE](m15-scoreboard-planned.md) — the seventh model, **all nine steps
  (0–8) done**, with a per-step section. ⚠ **Step 8's three findings outlive the milestone: pinning
  a moving string to ONE LINE does not stop it being cursor-dependent, it makes it HIDE (and the
  guard was green because it asserted that very `nowrap`); "keep it reachable for a future model"
  is a claim to MEASURE (the placeholder was reachable on one model in one state, and it was the
  false promise the previous step had removed); and a rig metric can stop measuring anything the
  moment you fix the defect.** ⚠ **Step 7's two findings outlive the milestone: a view may
  need to ACCUMULATE what `micro` bounds (the engine's cap is about the recorder, not the picture —
  the live window shows this model's reorder on ONE cycle of thirteen programs), and the mutation
  check caught TWO tests green under the stubs they exist to catch — one of them the single trap an
  earlier step wrote down for this one, and one whose table MATCHED ITS PREDICTION EXACTLY while
  hiding a vacuous per-item loop.** ⚠ **The map's no-hue fallback was BYTE-IDENTICAL to `IF`'s and
  had shipped on the out-of-order model since M9 (82% of that map) — FIXED at step 5 by re-pointing
  at `--ink-3`; its regression test failed to fail on the first draft.** Read before touching
  `engineConfigFor` (protection again; gate on the FLAG, and a green suite is not the warrant),
  before a blanket knob skip in `engine-config.test.ts`, before choosing a picker position, **and
  before touching the step-7 view** (on a flush cycle the
  two tables a view draws from DISAGREE by design; an Issue stall repeats `IF` while its event says
  `stage: 'ID'`; a WAR stall repeats the LAST cell), before predicting what a recorder mutation
  reddens (**dropping the casualty push truncates a walk, it does not delete the casualty**), before
  trusting a recorded test-count delta (**measure the baseline when a delta misses by one**), before
  writing any closed-form timing table (run the
  accounting identity over the whole corpus BEFORE deriving rows — it found a missing term twelve
  hand-derived rows would have inherited; and never let the drain term be a residual), before quoting
  a mutation result as coverage (**step 6 flipped this: INV-8 now nets BOTH**), before
  assuming a hazard is a model's dominant cost (**a 0.5-IPC turnaround ceiling dwarfs both hazards
  here**), **before any mutation RE-run (copying a table's SHAPE drops every suite added since)**,
  **before asserting the ABSENCE of a stall reason on any model (the OoO emits none at all — a
  vacuous acceptance line)**, **before hand-building a hazard here (a WAR pair eats BOTH integer
  units, so two hazards need two SEPARATE slow producers)**, before maintaining a HISTORICAL test
  cohort, before keying a stall histogram by pc alone, before pinning an FU inventory, before any
  model needing a latency source (**`slowOpLatency` is cluster-gated and has no UI control**), before
  defining `pc` on any out-of-order-completion model, before sizing a differential matrix for a model
  that honors no knob, and before reading a red INV-8 cell as a state mismatch.
- [M16 scoreboard lessons](m16-scoreboard-lessons-step0.md) — the seventh model's track (steps 0–3 done,
  **all three lessons shipped**), and **the first with NO TOGGLE TO FLIP**: the sweep gets STRONGER and the
  M11+M12 finding-2 class retires outright — but it has now been measured GREEN over a lesson whose every
  sentence was false (step 2) and RED **by accident of anchor order** (step 3), so **neither colour is
  evidence it can read prose**. The track's recurring defect is the UNGUARDED SENTENCE: **seven false ones
  across two lessons, every one caught by hand** — including one that **INVERTED the hazard** and one that
  **quoted the wrong table's register spelling** (the instruction and unit tables print `x7`; only the
  register-result table says `t2` — reported as a product wart, not fixed). **Read before authoring any scoreboard lesson.** The renaming A/B is real but small (31 → 30,
  and the WAR alone costs ZERO) — and it was a NULL RESULT on its first run because the edit harness
  patched the program's COMMENT HEADER, which quotes every instruction verbatim. Step 1's mutation
  check found a **FALSE NET in its own oracle** — and discarded a stub that DEADLOCKED the machine,
  because a mutation that breaks correctness cannot measure a timing claim. **Step 2 shipped the WAW
  lesson and found THREE false sentences before the stubs ran** — one of them also wrong in
  `register-reuse.s`'s own header (**a claim about SHAPE is a claim about spelling; assert the
  property the shapes SHARE**), one false ON SCREEN because fetch is one-deep, one a source-line
  position. Its check-order stub left **the sweep GREEN while every sentence in the lesson was
  false** — the clearest exhibit yet that anchoring is not truth.
- [Future microarchitectures](future-microarchitectures.md) — **DISCHARGED** (depth by M11, width by
  M13). Read for the predictions that held and the one that was FALSE.
- [Condensed log](condensed-milestone-log.md) — M8/M7/M2/M6 compressed findings.

## Preferences

- [Workflow rituals](workflow-rituals.md) — batch-end / "session end" = update memory+docs, commit, push.
- [Commit and push preference](feedback_commit_and_push.md) — always commit and push after every
  change, no confirmation needed.
- [Best-practices source](best-practices-source.md) — the guide the user asked to apply, and what was
  adopted/skipped.
