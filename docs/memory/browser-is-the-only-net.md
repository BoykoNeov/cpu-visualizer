---
name: browser-is-the-only-net
description: 'In CPU Visualizer no headless test can see a click (no jsdom, renderToStaticMarkup only) — 9 of 10 view steps shipped a defect only the browser caught. How to actually drive the app, and the two traps that cost an hour.'
metadata:
  node_type: memory
  type: project
  originSessionId: bef9e8cf-545a-4753-ae64-b5170311505a
  modified: 2026-07-19T19:59:07.073Z
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

**How to apply — the recipe that works** (script kept at
`M:/claud_projects/temp/isa-ref-eyeball.mjs`, adapt it rather than rebuilding):

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
- **NEVER `taskkill //F //IM chrome.exe //T`.** This memory used to recommend it. It force-kills
  the USER'S OWN browser and every tab they had open — measured on 2026-07-17, when it closed their
  real Chrome twice mid-session. The driver spawns its own headless Chrome, so kill only that.
- **`chrome.kill()` DOES NOT KILL THE BROWSER — this memory used to say it was enough, and that is
  measured wrong** (M5 step 5, 2026-07-17). It kills the launcher process; Chrome's children survive,
  hold the debug port, and keep the page alive. Count after a few runs: **21 live chrome.exe**. The
  next run then attached to the PREVIOUS run's page and inherited its state — the editor was already
  open, so the script's "click to open" TOGGLED IT CLOSED and reported `no textarea`, which reads
  exactly like a product defect. Kill the **tree, by PID**: `taskkill /PID <chrome.pid> /T /F`. To
  sweep leftovers safely, filter on your own profile path and never on the image name:
  `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where CommandLine -like '*<your-tmp-prefix>*'`.
  Corollary: **make every driver step idempotent** (open, don't toggle) so inherited state cannot
  invert an action.
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

**Eyeball the SHIPPED BUNDLE, not the dev server** — `npm run build` + `npx vite preview --port N
--strictPort`, which is what steps 1–3 actually did. Measured again 2026-07-17 (M5 step 3): the dev
server served our HTML (title correct, `/src/main.tsx` 200, `[vite] connected`) and `#root` stayed
**empty with no exception, no failed request, and nothing in `Log.entryAdded`** — the cross-talk
symptom above, and it reads exactly like a product defect. The bundle rendered first try. Also: Chrome's
**command-line URL is not reliable** here — it attached to `about:blank` with the app URL in the target
list; `Page.enable` + `Page.navigate` (spawn on `about:blank`, pick `type === 'page'`, navigate
explicitly) is the robust shape.

**Read the SCREENSHOT, not just the DOM.** M5 step 2's sharpest defect — narration naming `auipc`
over a transport reading `lui x5, 0x10000` — was invisible to every string check that ran, and was
caught by looking at the image. M5 step 3 repeated it: the expert tier named a lesson by its **id**
(`sign-and-zero`) while the picker shows **titles** ("One byte, two answers"), so a reader would search
the picker and find nothing. Only the rendered panel showed it.

**A check can also measure its own LEFTOVER STATE** (M5 step 4). "What does the app open on?" was
answered by reading the Program picker _after_ the script had driven a lesson — it reported
`call-return`, the lesson's own program, not the mount default. Green, precise, and about nothing.
**Any claim about initial/default state needs a fresh `Page.navigate`, not the tab you have been
clicking.** (The answer, once measured properly: `sum-loop`, chosen explicitly in `useSimulator.ts`
— which disproved a claim a previous step's log had asserted as fact.)

**Vacuity cuts BOTH ways — a check can be too BROAD as easily as too narrow.** Too narrow/wrong-target
(all measured): regexes for `-128`/`0x80` over `document.body.innerText` match the SOURCE panel's own
comments — **and this recurs: M5 step 5's `/\bs0\b/` over `<tr>`s matched `# (42) is saved in s0`,
source line 4, because the Source panel is a table too**; **"the longest paragraph on screen" grabs
the TOOLBAR**, because essentials narration is short; `/^LESSON/` matches the toolbar **chip**, not
the narration panel; "the smallest element containing the step counter" is the **header row**;
**"buttons with a `title`" counted the rail's prev/next scrub controls as lesson steps** (6 "steps"
in a 4-step lesson), so "click the last dot" clicked **Next** and the script then read step 1's
narration while reporting success — the rail declares `[role="tab"]` inside
`[role="tablist"][aria-label="Lesson steps"]`, so **use the ARIA the component already exposes rather
than a shape that merely correlates**. Too broad: M5 step 3's first datapath check compared
**whole** wire lists and reported "not identical" — a **false alarm**, since the pc/encoding/target wires
must differ between two different instructions. Isolate the thing the claim is actually about (e.g. the
ALU operands = numeric wire texts only, `/^-?\d+$/`), read the specific panel's table rows
(`section.panel` whose `h2` names it → `tr` → cells), and when the selector fights back, **stop scraping
and look at the image**.

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

**Reusable rig:** `M:/claud_projects/temp/m5-step2/` — `eyeball.mjs` (pick a lesson, walk its rail,
all three tiers, both themes), `regcheck.mjs` (read real register rows), `memcheck.mjs` (data-memory
panel + datapath wire texts). `M:/claud_projects/temp/m5-step4/` — `eyeball.mjs` (read a `<select>`'s
optgroups, drive it via the native value setter), `mountcheck.mjs` (fresh-load default state).
Chrome can take **>60s** to first target here: give the poll a real budget and run it in the
background rather than concluding it hung — one "hang" was a slow start that had already succeeded. Adapt these rather than rebuilding. A headless **trace probe** without a
browser lives there too: `probe.test.ts` + `probe.config.ts`, run via `npx vitest run --config
<path>` — needs a `node_modules` junction beside it (`cmd //c mklink //J ... `) because a config
outside the repo cannot resolve `vitest`.
