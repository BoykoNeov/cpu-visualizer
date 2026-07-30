---
name: keyboard-clock-control
description: "The CPU Visualizer's keyboard clock control (arrows/Home/End, shipped 2026-07-30) and the four UX gaps found by surveying the shell after M14 — keyboard, URL permalinks, continuous play, session persistence, three still open. Its headline measurement: removing the addEventListener line leaves ALL 68 of the feature's own headless tests green while the browser pass fails 6. Also: a synthetic KeyboardEvent makes an input-guard check vacuous, and a disabled button cannot take focus (a check passed while reporting focus=BODY)."
metadata:
  node_type: memory
  type: project
  originSessionId: 7a08f63d-9b74-4a38-9f4c-0f590e4ba634
  modified: 2026-07-30T13:22:44.007Z
---

**Shipped 2026-07-30**, plan `docs/plans/keyboard-transport.md` (COMPLETE). `→`/`←` step, `Home`
resets, `End` runs to completion. Repo 7132 → 7200 tests; 38 browser checks. Not a milestone — a
feature, and the first work here after M1–M14 all closed.

## The four UX gaps in the shell, measured not guessed (2026-07-30)

Confirmed absent by grep over `packages/web/src` — and the naive greps had holes, so use these:
`keydown|onkeydown` (only `Reorderable.tsx`, drag a11y); `location\.(hash|search)|replaceState|
pushState|URLSearchParams` (**zero hits**); `setTimeout|setInterval|requestAnimationFrame` (one
`rAF`, for a caret); `localStorage` (theme only).

- **Keyboard control** — DONE (this memory).
- **URL permalinks** — open, and the next best pick.
- **Continuous play at a speed** — open. `run ⏭` jumps straight to the end; timer-driven, so
  browser-net only, and it interacts with the phase stepper (does play walk phases or cycles?).
- **Session persistence** — open, and nearly free once permalinks exist.

Two things NOT gaps, checked before proposing them: the §11 sandbox-fork criterion is shipped and
tested end-to-end (`sandbox.test.ts`, `forkToSandbox`), and the within-cycle phase stepper exists
(`phaseVisibleAt`, view-local `useState<Phase>` in `DatapathView`).

**The sorting constraint for the remaining three:** does the headless suite net it, or only a
browser pass? Keyboard and play are ~100% interaction surface; permalinks and persistence are pure
encode/decode — this repo's sweet spot — plus one thin wiring check. For permalinks the real work
is a decision, not code: a link carrying `forwarding=false&model=out-of-order` must be honored as
**inert** the way `ProcessorCapabilities` does, neither rejected nor silently applied.

## The measurement worth carrying to any interaction feature

**Removing the one `document.addEventListener` line — the feature not existing at all — left ALL 68
of its own new headless tests green. The browser pass failed 6.** That is [[browser-is-the-only-net]]
stated as a number, on a feature designed from the start to be maximally headless-testable. Removing
only `e.preventDefault()` failed exactly one check, the one written for it.

So: **put the whole decision in a pure predicate and keep the wiring to three lines.** The keymap +
guard is `transportActionFor(e)`, swept over every (key × focused element × modifier) cell; what is
left unwatched is attach / look up / dispatch.

## Traps specific to driving a keyboard over CDP

- **Use `Input.dispatchKeyEvent`, never a synthetic `KeyboardEvent` from `Runtime.evaluate`.** A
  synthetic event runs _your handler and nothing else_, so the check that matters here — the focused
  `<input type="range">` must advance the cursor by **exactly one**, not scrub-and-step — would be
  true whether or not the native scrub still happened. Real input goes through the browser's
  pipeline. Observed 1 → 2 on one press. Codes: ArrowLeft 37, ArrowRight 39, Home 36, End 35;
  `rawKeyDown` + `keyUp` for non-text keys; modifiers alt 1 / ctrl 2 / meta 4 / shift 8.
- **A DISABLED BUTTON CANNOT TAKE FOCUS**, so `.focus()` silently leaves `activeElement` on BODY and
  the check re-proves the previous section. Measured: "arrows still work while a transport button
  holds focus" PASSED reporting `focus=BODY`, because the run was at its end where `step ▶` is
  disabled. Every focus-conditional check needs `activeElement` asserted as its own control cell.
- **Pair every "the clock did not move" with proof the keystroke ARRIVED.** The editor check asserts
  `selectionStart` 0 → 1 first; without it, a dead listener passes it.
- **Prefer a value a broken app could not also produce.** The model-picker check first asserted "not
  one step on"; sharpened to `=== -1`, because a model change re-records to pre-run, so **-1 is the
  guard holding and 0 is a leaked step**.
- **A row is wrapped when its BOX is taller than its tallest child — never by comparing children's
  `rect.top`.** `alignItems: 'center'` centers children of different heights, so a plainly-single
  line reports four distinct tops. That metric produced 4 false failures before the real one.
- The rig's `finally { chrome.kill(); preview.kill(); }` left **5 previews + 35 Chromes** across five
  runs — [[browser-rig-chrome-cleanup]] confirmed again. Sweep, then re-count.
- ⚠ **The transport bar gained a span.** `.transport--sticky`'s `innerText` now reads
  `…run ⏭ | → step · ← back · Home reset · End run | cycle N / M`. Any older rig under `temp/` doing
  an equality on that bar's text, or picking its spans positionally, is now wrong — the
  "a rig selector expires when the app grows a neighbour" trap in [[browser-rig-vacuity-traps]],
  fresh instance. A `/cycle (\d+) \/ (\d+)/` regex is safe.

## The defect the first browser pass missed, and how it was caught

A **251px caption added to a `flexWrap` row inside a `position: sticky` bar** — measured only at
1400px, on the two models with the FEWEST chips in that row. On out-of-order mid-run it wrapped the
bar onto a second line at **900px and 800px**: 81px of permanently-eaten viewport became 104px, on
every scroll, in an app whose whole point is the surfaces below the bar. Fixed by
`@media (max-width: 1023px)` on a `transport-keys` class.

Two transferable rules from it:

- **Measure a new element at a STATED narrow viewport, in the app's most CROWDED state** — the model
  with the most chips, mid-run, not the default one at the widest window.
- **A wrap is only YOUR wrap if the counterfactual says so.** Hiding the element and re-measuring is
  what separated "the legend causes it" (900/800px, 104 → 81px) from "wraps either way, pre-existing"
  (700px). Without it the 700px result would have been reported as this feature's defect.
- Headless Chrome opens **dark**, so a first screenshot is dark-only — the light palette needs an
  explicit theme drive. Measured on the legend: **3.41:1 light**, 5.41:1 dark (over 3:1, under AA's
  4.5:1 for 12px; it is `T.ink3`, the same ink as the sibling `N in flight` chip, so raising it is a
  house-palette call rather than one feature's).

## Design notes that survive the feature

- **Space is unbound on purpose**, and both halves are measured: it would need `preventDefault` and
  cost the page its scrolling (observed `scrollTop` 100 → 630 on Space), in an app whose every
  interesting surface sits below the fold — the very complaint `transport--sticky` exists to answer.
  Leaving Space and Enter unbound also **deletes** the focused-button double-fire class instead of
  guarding it.
- **Guard by tag** (`INPUT`/`TEXTAREA`/`SELECT` + `isContentEditable`): one rung covers the scrub
  slider, the ISA filter, the program editor and all three pickers.
- `transportActionFor` takes the `KeyboardEvent` **itself**, not a rebuilt object — mapping
  `key`/`ctrlKey`/`metaKey`/`altKey`/`shiftKey` by hand writes four same-typed booleans twice each,
  the transposition class from [[m14-review-resolved]]. Same reason the dispatch is `sim[action]()`
  and the verb table is shorthand properties.
- ⚠ **`it.each(BOUND)` where `BOUND = Object.entries(THE_MAP)` cannot see a remap** — it re-derives
  it. Swapping `Home`/`End` failed exactly ONE test, the literal `toEqual`. The repo's signature
  defect (a test keyed off a fold, not the artifact) appearing inside the suite written to avoid it.
