---
name: browser-is-the-only-net
description: 'In CPU Visualizer no headless test can see a click (no jsdom, renderToStaticMarkup only) — 9 of 10 view steps shipped a defect only the browser caught. The hub for browser verification: the claim and the proof, then pointers to the CDP recipe, Chrome cleanup, vacuity traps, and screenshot limits.'
metadata:
  node_type: memory
  type: project
  originSessionId: bef9e8cf-545a-4753-ae64-b5170311505a
  modified: 2026-07-28T07:21:48.520Z
---

**Any view change in CPU Visualizer must be looked at in a real browser before it is called done.**
The headless suite structurally cannot see it: `vitest.config.ts` sets `environment: 'node'`, there
is **no jsdom and no driver installed**, and every web test is `renderToStaticMarkup`. It renders;
it does not click. `App.test.tsx`'s own docblock names this gap, and the record is that **9 of the
last 10 view steps shipped a defect no green suite could see** — the ISA panel made it 9/10 with
**four defects while 80 tests passed**.

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
  (21, then 66, leftovers survived and the next run inherited the previous page's state); kill the
  tree by PID and sweep by `--user-data-dir` path.
- [[browser-rig-vacuity-traps]] — how a green check measures nothing. Assert the negative state
  first, use the ARIA the component exposes, scope every read to its own `<section>`, read every
  number from a dump, and expect a rig that pinned a scope lever to expire. **In two M11 runs, every
  failure was the rig and not the app.**
- [[browser-rig-screenshot-limits]] — what the image settles and what it cannot. A native `<select>`
  popup is not in the render tree; HTML5 drag-and-drop is not drivable by a synthesized mouse; a
  polyline's bbox is its whole route; `getBBox()` on `<text>` is the advance box.

One layer down on identifying servers and ports: [[never-kill-dev-servers-by-port]].
