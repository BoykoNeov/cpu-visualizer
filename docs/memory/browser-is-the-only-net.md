---
name: browser-is-the-only-net
description: 'In CPU Visualizer no headless test can see a click (no jsdom, renderToStaticMarkup only) — 9 of 10 view steps shipped a defect only the browser caught. It cannot see a HEIGHT or a COLOR either: a token collision (two CSS vars holding the same literal) is invisible because the layers hand out the var() STRINGS and only CSS resolves them. The hub for browser verification: the claim and the proof, then pointers to the CDP recipe, Chrome cleanup, vacuity traps, and screenshot limits.'
metadata:
  node_type: memory
  type: project
  originSessionId: bef9e8cf-545a-4753-ae64-b5170311505a
  modified: 2026-08-09T17:30:43.360Z
---

**Any view change in CPU Visualizer must be looked at in a real browser before it is called done.**
The headless suite structurally cannot see it: `vitest.config.ts` sets `environment: 'node'`, there
is **no jsdom and no driver installed**, and every web test is `renderToStaticMarkup`. It renders;
it does not click. `App.test.tsx`'s own docblock names this gap, and the record is now **10 of the
last 11 view steps shipped a defect no green suite could see** — the ISA panel made it 9/10 with
**four defects while 80 tests passed**, and the branch-predictor panel made it 10/11 on 2026-08-09
(33px of cursor-driven height jitter, [[panel-jitter-and-height-reserves]], with the whole 9493-test
suite green through it).

⚠ **The browser is also the only place some gates can be tested AT ALL, and that is worth a number
rather than a shrug.** Nothing in this repo renders `<App/>`, so its slot gates (`showPredictor`,
`showCache`, `showMicro`, `showIssue`) are untestable **by position** — a defect recorded as
"reddens 0" for four milestones. Fired in the browser at step 7 of the predictor work: gating the
predictor panel on the scheme instead of on a trace fact is **0 red of 9497 headless, 2 red of 52 in
the browser**. Same shape as [[keyboard-clock-control]]'s 68/68 and [[continuous-play]]'s 47/47 —
**when a decision has no headless net, the browser pass is where you state its cost as a pair.**

⚠ **It cannot see a COLOR either — the third member of the family, found 2026-08-10 (M15 step 5).**
The pipeline map hues a cell by its stage family and falls back to `T.accent` for a family with no
validated phase hue. The scoreboard's `RO` is the first such family any shipped model has ever drawn,
and **`--accent` and `--phase-if` hold the same literal in every theme** (`#3987e5` dark/system,
`#2a78d6` light) — two independently declared tokens in `styles.css` that happen to agree. So `IF`
and `RO` render in an IDENTICAL hue. **No test here can reach that fact**: the fold and the view both
hand out the string `var(--accent)`, which is `!==` the string `var(--phase-if)`; the collision only
exists after CSS resolves both. Measure a color the way you measure a height — off
`getComputedStyle` in a real browser, in **every theme state** (system / light / dark, which are three
states, not two).

⚠ **And it had ALREADY SHIPPED for two milestones on the out-of-order model**, which is the part
that makes it a hub entry rather than a milestone footnote. An OoO `location` is uniformly
`"ROB#tag"`, so that map has exactly two families and **82% of its cells (241 of 295 on `array-sum`)
take the same fallback** — `IF` and `ROB#` in one identical blue, on the surface whose entire job is
telling fetch from in-flight. It survived M9 step 7, the M9+M10 review, and every browser pass since.
**A wall of one color does not look like a bug; it looks like a theme.** That is why nobody caught it
by eye, and why the check to write is a computed-value COMPARISON between two families, not a
screenshot. See [[m15-scoreboard-planned]].

**Why:** measured repeatedly, not assumed — e.g. hardcoding `predictTaken: false` in `App` leaves
**all 775 tests green**; deleting `branchPrediction` from `loadInto` fails nothing. A control can be
pure decoration and the suite will not notice. Structure the component so the suite can at least see
its _content_ (container + a pure body taking `tab`/`query` as props — that is why `ReferenceBody`
exists), then drive the rest for real.

**How to apply — this memory was split on 2026-07-28; the operational detail now lives in four
siblings, all of which have been rewritten here at least once because the earlier advice was
measured WRONG:**

- [[browser-rig-cdp-recipe]] — launching and attaching. Node's global `WebSocket` + headless Chrome
  over CDP, `--port N --strictPort` read back from the log, target by URL with **no fallback**, poll
  for the specific element and **throw**, drive the shipped `vite preview` bundle rather than the dev
  server, and the (sweepable) rig inventory under `M:/claud_projects/temp/`.
- [[browser-rig-chrome-cleanup]] — tearing it down without damage. **Never** `taskkill //IM
chrome.exe` (it closed the user's real Chrome twice); `chrome.kill()` does not kill the browser
  (21, then 66, leftovers survived and the next run inherited the previous page's state); match by
  **command line**, kill each PID, then **re-run the same predicate and count** — a cleanup you did
  not re-count is a claim, not a result.

**START every browser pass by running `M:\claud_projects\temp\rig-sweep.ps1`** (and again at the
end). Not a nicety: end-of-pass teardown is precisely what fails when a rig dies badly, and on
2026-07-30 a `finally`-only teardown was found to have leaked 13 preview servers, 91 Chrome
processes and ~7 GB of profiles across sessions. The script prints four counts and refuses to
report clean without them.

- [[browser-rig-vacuity-traps]] — how a green check measures nothing. Assert the negative state
  first, use the ARIA the component exposes, scope every read to its own `<section>`, read every
  number from a dump, and expect a rig that pinned a scope lever to expire. **In two M11 runs, every
  failure was the rig and not the app.**
- [[browser-rig-screenshot-limits]] — what the image settles and what it cannot. A native `<select>`
  popup is not in the render tree; HTML5 drag-and-drop is not drivable by a synthesized mouse; a
  polyline's bbox is its whole route; `getBBox()` on `<text>` is the advance box.

One layer down on identifying servers and ports: [[never-kill-dev-servers-by-port]].
