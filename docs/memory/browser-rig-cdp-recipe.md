---
name: browser-rig-cdp-recipe
description: "How to actually launch and attach a CPU Visualizer browser rig: Node global WebSocket + headless Chrome over CDP, --strictPort on a read-back port, target by URL with NO fallback (a fallback attached to a stranger's tab), poll for the specific element and throw, and prefer the shipped `vite preview` bundle — the dev server's first paint is ~18s cold and has no HMR for engine packages."
metadata:
  node_type: memory
  type: project
  originSessionId: 573123f6-87e0-4ded-b6e3-f2357201c7ae
  modified: 2026-07-28T07:20:23.326Z
---

The launch/attach mechanics for driving the real app, split out of [[browser-is-the-only-net]] (which
holds the _why_). Teardown lives in [[browser-rig-chrome-cleanup]]; the ways a rig lies to you live in
[[browser-rig-vacuity-traps]].

**The recipe that works** (rig scripts kept under `M:/claud_projects/temp/` — see the inventory at
the bottom, and note that **temp is sweepable**, so every technique below is stated so it survives
those files' absence; adapt them rather than rebuilding):

- Drive via **CDP**: Node 24's **global `WebSocket`** + `chrome.exe --headless=new
--remote-debugging-port=N`, then `Runtime.evaluate` to click and read, `Page.captureScreenshot`
  to look. No puppeteer/playwright needed or installed.
- **Vite's port is a preference, not a promise.** Ports 5173–5182 were all held by _other_ projects;
  5183 served OUR app while its HMR client cross-talked with an unrelated Twofish dev server, and
  `#root` stayed empty. Always `npm run dev --workspace @cpu-viz/web -- --port N --strictPort`, and
  read the port from the log rather than assuming.
- **Poll for readiness; never `sleep` a fixed time.** Wait on `#root.innerHTML.length > 1000`, then
  on the specific element. A fixed sleep produced a blank screenshot and a silent `false` from every
  click — which looks exactly like a product defect and is not.
- **Fresh `--user-data-dir` per run, and select the target by URL.** This memory used to say "reuse a
  profile" because a new profile's welcome tab wins `list.find(t => t.type === 'page')`. The welcome
  tab is real; reusing the profile was the wrong fix (it re-introduces stale-profile locks). Filter on
  the app instead — `list.find(t => t.type === 'page' && t.url.includes('localhost:<PORT>'))` — and
  the welcome tab stops mattering.
- **Poll for the SPECIFIC element, not `#root.innerHTML.length`.** Measured 2026-07-17: the length
  check goes green before the toolbar mounts, so the very next `querySelector('label')` returns
  undefined and the script dies with a `Cannot read properties of undefined` that reads like a product
  defect. Poll for the thing you are about to click, and **throw** if it never arrives — a poll whose
  failure falls through to the next line is worse than no poll.
- **A DEBUG PORT NO MORE TELLS YOU WHOSE CHROME IT IS THAN A DEV PORT TELLS YOU WHOSE APP** (M5 step
  5 — [[never-kill-dev-servers-by-port]] one layer down). Port 9333 was already taken, so
  `fetch(:9333/json/list)` returned a **stranger's** targets and the drive attached to the user's
  **"Physical Synthesis — viewer"** tab. The URL filter this memory already recommends is right, but
  it was defeated by its own **fallback**: `find(t => t.type === 'page' && t.url.includes(PORT))`
  followed by a retry loop that degraded to `find(t => t.type === 'page')`. **The fallback IS the
  bug** — demand your own URL and throw if it never appears. Use a random high port
  (`9400 + rand(500)`), and keep `document.title` as the first assertion of every run: it is what
  caught this.
- Assert clicks landed (throw on miss) and check **both themes** — but **click the real toggle**
  (`button[aria-label^="Theme:"]`, which cycles auto → light → dark). This memory used to recommend
  `setAttribute('data-theme','dark')`; that renders a **half-dark page** that reads exactly like a
  theme defect and is not one, because the shell's inline styles read a React-held theme object the
  attribute never touches. Read the label back _after_ React re-renders, not in the same expression.
- **Depth-dial buttons carry the RAW tier id** (`essentials`), capitalized only by CSS
  `text-transform` — a driver matching the on-screen spelling finds nothing.
- The shell opens at **expert** depth with forwarding **off** — do not assume `essentials`.

**Eyeball the SHIPPED BUNDLE, not the dev server** — `npm run build` + `npx vite preview --port N
--strictPort`, which is what steps 1–3 actually did. Measured again 2026-07-17 (M5 step 3): the dev
server served our HTML (title correct, `/src/main.tsx` 200, `[vite] connected`) and `#root` stayed
**empty with no exception, no failed request, and nothing in `Log.entryAdded`** — the cross-talk
symptom above, and it reads exactly like a product defect. The bundle rendered first try. Also: Chrome's
**command-line URL is not reliable** here — it attached to `about:blank` with the app URL in the target
list; `Page.enable` + `Page.navigate` (spawn on `about:blank`, pick `type === 'page'`, navigate
explicitly) is the robust shape.

**A dev pass and a preview pass are not the same evidence** (2026-07-27, M11 step 8). The dev server
resolves workspace packages through the **vite alias to SOURCE**; preview serves what `vite build`
emitted. So **only a preview pass excludes the stale/absent-`dist` build failure**. Confirm you are
actually on the built page: its `<script src>` is `/assets/index-*.js`, where dev's is
`/src/main.tsx`. Checking the title alone does not distinguish them. (The way a _production_ build can
make a rig vacuous is in [[browser-rig-vacuity-traps]].)

**The DEV server's first paint here is ~18 seconds cold** (2026-07-27) — it transforms the whole
module graph on demand, where a `vite preview` bundle is one file and paints in under a second. A
40-second readiness poll timed out on the coldest run and looked exactly like "the app did not
render". Give the dev-server poll a **minute or more**. Related, and worth knowing before suspecting
a stale build: the workspace aliases resolve to **source** (the served `models.ts` imports
`/@fs/.../src/index.ts`) and an edit to an engine reaches the app **on reload**, but there is **no
HMR without a reload** — engine packages sit outside the vite root, so the watcher never fires.
Measured identically on `engine/pipeline`, which is what makes it pre-existing behaviour rather than
a finding about whatever package you just added. Prove that kind of thing by running the same
experiment on an OLD package.

Chrome can take **>60s** to first target here: give the poll a real budget and run it in the
background rather than concluding it hung — one "hang" was a slow start that had already succeeded.

**Reusable rig inventory — `M:/claud_projects/temp/` IS SWEEPABLE, so treat these as conveniences,
not as the record.** `M:/claud_projects/temp/m11-browser/` (2026-07-27, the newest) —
`step8-preview.mjs` (the milestone-closing pass over the SHIPPED `vite preview` bundle: the
anti-vacuity §0, picker, the cross-model cycle/walk comparison, map hues, coefficients, tooltip
prose, the datapath dump comparison, follow+scrub, the cache, a model sweep and a console-error
capture — 76 checks), `s8-lesson.mjs` (the LESSON path: cross-model `startLesson`, a pinned
recording length, the cross-route identity on exit, and a scoped data-memory read at two cursors)
and `s8-crop.mjs` (control-label clearance swept over every label, plus a high-zoom crop of one),
`datapath-eyeball.mjs` (the step-7 pass: dump-vs-live wire-for-wire comparison, hue-by-family,
tier gating, follow ring, structural config axes) and `dp-zoom.mjs` (a scaled close-up of one SVG —
see [[browser-rig-screenshot-limits]] for its `clip` caveat), plus `cache-eyeball.mjs`
(the step-6 pass: control appears, tooltips read live, `+M` cycle counts, map paging, model sweep;
built by concatenating `eyeball.mjs`'s preamble with `step6-checks.js`, which is the cheap way to
reuse the plumbing), `eyeball.mjs`
(model picker, map cells + hues + legend read off the live grid, config toggles, cycle counts,
tooltip text), `follow-scrub.mjs` (click-to-follow + scrub + panel agreement), `hmr-check.mjs`
(source-liveness, run against two packages for the comparison). `M:/claud_projects/temp/m5-step2/` —
`eyeball.mjs` (pick a lesson, walk its rail, all three tiers, both themes), `regcheck.mjs` (read real
register rows), `memcheck.mjs` (data-memory panel + datapath wire texts).
`M:/claud_projects/temp/m5-step4/` — `eyeball.mjs` (read a `<select>`'s optgroups, drive it via the
native value setter), `mountcheck.mjs` (fresh-load default state). An earlier reference-panel rig is
at `M:/claud_projects/temp/isa-ref-eyeball.mjs`.

A headless **trace probe** without a browser lives there too: `probe.test.ts` + `probe.config.ts`,
run via `npx vitest run --config <path>` — needs a `node_modules` junction beside it
(`cmd //c mklink //J ... `) because a config outside the repo cannot resolve `vitest`.
