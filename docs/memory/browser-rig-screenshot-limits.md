---
name: browser-rig-screenshot-limits
description: 'What a CPU Visualizer screenshot can and cannot settle: the image caught a narration/transport mismatch every string check missed, but a native <select> popup is drawn by the OS and is not in the render tree, HTML5 drag-and-drop is not drivable by a synthesized mouse, a polyline bbox is its whole L-shaped route, and getBBox() on <text> is the advance box — report a signed clearance, not a boolean.'
metadata:
  node_type: memory
  type: project
  originSessionId: 573123f6-87e0-4ded-b6e3-f2357201c7ae
  modified: 2026-07-28T07:21:28.881Z
---

The pixels-vs-DOM boundary for the rigs in [[browser-rig-cdp-recipe]]. Some defects are only in the
image; some are structurally absent from it and must be proven by behaviour instead.

**Read the SCREENSHOT, not just the DOM.** M5 step 2's sharpest defect — narration naming `auipc`
over a transport reading `lui x5, 0x10000` — was invisible to every string check that ran, and was
caught by looking at the image. M5 step 3 repeated it: the expert tier named a lesson by its **id**
(`sign-and-zero`) while the picker shows **titles** ("One byte, two answers"), so a reader would search
the picker and find nothing. Only the rendered panel showed it.

Verify behaviour, not just pixels: for the reference panel, clicking `add t0, t1, t2` with the caret
at 0 had to insert at 0, move the caret to exactly the inserted length, and leave the rest of the
buffer byte-identical — none of which any test in this repo can express. See [[project-overview]].

**A native `<select>` popup is drawn by the OS and is NOT in the page's render tree** — no screenshot
can show `<optgroup>` headings or option lists (M5 step 4's grouped lesson picker). Read the structure
off the DOM (`[...sel.children]`, `OPTGROUP` → `.label`), and prove the change with **behaviour**
instead: set `.value` via the native setter + dispatch `change`, then assert the app actually moved
(model switched, program loaded). "It looks right" is unavailable here; "it works" is not.

**HTML5 DRAG-AND-DROP IS NOT DRIVABLE BY A SYNTHESIZED MOUSE** (2026-07-19, the panel-reorder work).
`left_click_drag` (and CDP `Input.dispatchMouseEvent` generally) does **not** initiate a native drag
in Chrome — the drop silently does nothing, which reads exactly like a broken feature and is not one.
Dispatch the drag events yourself instead, from `javascript_tool`: **one** `new DataTransfer()` reused
across `dragstart` (on the grip) → `dragover` → `drop` (on the target's wrapper), all
`{bubbles:true, cancelable:true}`, with ~40ms between them. React delegates drag events at the root,
so a bubbling native `DragEvent` reaches `onDragStart`/`onDragOver`/`onDrop`; sharing one `DataTransfer`
also makes a `getData` fallback work before React's state has flushed. Caveat: dispatching `drop`
directly **bypasses the browser's drag gating**, so it will NOT catch a missing
`preventDefault()` on `dragover` — that check has to be read in the code, and a real mouse drag needs a
human. Verify the reorder by reading DOM order back (map the grips' `aria-label`s), not by screenshot.

**A grip/badge parked in a panel corner WILL collide with something** — at top-right it landed square
on the datapath's Writeback phase chip, and the map and cache grid keep their own controls in that same
corner. Top-LEFT with a reserved gutter (`.panel-slot > .panel { padding-left }`) is the one corner
every panel here leaves empty. Caught only by `zoom`ing the corner in a screenshot — the DOM says
nothing about two absolutely-positioned things sharing pixels. Related: a slot wrapper with no border
or padding lets the panel's `margin-top` **collapse through it**, so the wrapper's top edge equals the
panel's — which is why one `top` offset is correct for panels that carry a top margin and panels that
do not.

**Measuring a label/wire collision: two corrections, in order** (M11 step 8). (1) A polyline's
`getBoundingClientRect()` is the box of its whole ROUTE — an L-shaped wire's bbox covers everything
between its ends, so bbox-vs-bbox reports collisions on a diagram that is visibly clean. Walk the
SEGMENTS, in SVG user units. (2) Chrome's `getBBox()` on `<text>` is the **advance** box, not the
ink box: an italic label's trailing side bearing runs most of a unit past its last visible pixel.
**Report a signed clearance rather than a boolean** — 0 to ≈−1.5 means "abuts, ink clear" and is
settled by a 20×+ crop, not by the number.

**Cropping a close-up:** `Page.captureScreenshot`'s `clip` is PAGE-relative under
`captureBeyondViewport`, while `getBoundingClientRect` is viewport-relative; mixing them silently
clips the wrong band.
