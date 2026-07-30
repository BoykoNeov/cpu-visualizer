---
name: continuous-play
description: "CPU Visualizer's continuous play (▶/⏸ + a 5-position speed picker, shipped 2026-07-30, repo 7248 tests) — the second of the four post-M14 shell UX gaps. Its headline: broken 4 ways, the headless suite stayed 47/47 green EVERY time including with the timer never armed, and the 4th break (a cursor dependency in the interval effect) is invisible to the browser rig TOO — probed, not assumed. Also: a toggle's click is not idempotent, which lied to three separate rig sections; and play cost the sticky bar 169px, wrapping it across the whole 1040–1180px band."
metadata:
  node_type: memory
  type: project
  modified: 2026-07-30T14:30:48.582Z
  originSessionId: 823f17b5-0e3b-4e2a-b23c-453d671e0d71
---

**Shipped 2026-07-30**, plan `docs/plans/continuous-play.md` (COMPLETE). One `▶ play` / `⏸ pause`
toggle plus a speed picker at **1 / 4 / 10 / 20 / 60 cyc/s**, opening at 4. Repo 7200 → **7248
tests**; 40 browser checks, 0 failures. The second post-M14 UX gap built, after
[[keyboard-clock-control]], which holds the survey of all four gaps. **Still open: URL permalinks
(the next best pick) and session persistence.**

## The reframe that sized the whole feature

`loadInto` calls `recorder.runToEnd(...)` and parks at −1 **before `loaded.current` is ever set**, so
by the time anything can play the recording is already complete. **Play animates a cursor; it never
asks the engine for a cycle.** INV-1 is untouched structurally rather than by care, and the speed is
view state beside `tier`/`followed` — it must NOT reach `SessionKnobs`, whose docblock calls it "the
session's whole opinion about the machine" and which `engineConfigOf` narrows into a
`ProcessorConfig`. A wall-clock value in there is INV-2 wearing a plausible name.

Play walks **cycles, not phases**, on a structural reason: the phase cursor is `useState<Phase>`
view-local to `DatapathView` and re-fires `setPhase('WB')` per `cycleKey`, so phase-walking needs
that state lifted out of six `*DatapathView.tsx` files first. `max` (60/s) is **not** a synonym for
`run ⏭` — that button is instant and untouched; `max` is the fastest a display can SHOW a cycle and
can be paused mid-flight.

## The headline: four breaks, and the one nothing can see

| mutation                              | headless        | browser        |
| ------------------------------------- | --------------- | -------------- |
| the timer never arms (feature absent) | **47/47 green** | **5 failures** |
| the auto-stop removed                 | **47/47 green** | 4 failures     |
| stop-on-re-record removed             | **47/47 green** | 3 failures     |
| interval effect depends on `cursor`   | **47/47 green** | **0 failures** |

Row 1 restates [[browser-is-the-only-net]] on a second feature (keyboard's number was 68 of 68).
**Row 4 is the new lesson: the one failure mode the design was built around is invisible to every net
available here.** Probed rather than assumed — baseline vs broken on the same heavy config, rung 20
read **19.93/s vs 17.92/s** (~10%, one sample) and `max` read **18.78 vs 19.14 with the signal
INVERTED**. Re-arming per tick makes the period `interval + render`, which is lost inside a 1000ms
wait at slow rungs and inside the render cost that already dominates at fast ones. So there is no
check to write: the cursor lives in a **ref by construction**, and that is the only thing between
this code and a silently irregular clock. When a defect is genuinely unobservable, say so and make
the code shape carry it — do not ship a test that only looks like a net.

## A rig inherits state from the section before it — two ways, both measured

Four of the five runs failed on the rig rather than the app, and the failures cluster into two
mechanisms. Both are about a section trusting a machine the previous section left behind.

**1. A toggle's click is a FLIP, so "click to stop" is only right if you know the state.** Probed
directly rather than reasoned about (`probe-toggle.mjs`):

| where             | face      | `disabled` | a `.click()` does |
| ----------------- | --------- | ---------- | ----------------- |
| mid-run, playing  | `⏸ pause` | false      | stops it          |
| mid-run, stopped  | `▶ play`  | false      | **starts it**     |
| at the halted end | `▶ play`  | **true**   | **nothing**       |

So the rig's blind `clickPlay()` could either invert the state or silently do nothing, and neither
reports anything. Observed: §5's real bug (a selector that matched no button) left play running, so
§6's opening click **paused** instead of starting — 2 of its reported failures were really §5's.
Fixed with an `ensureStopped(where)` that reads the face first and logs when it acted.

⚠ Note the third row, because it corrects a plausible story this memory first recorded: at the
halted end the toggle is **disabled**, so a stray click there cannot restart play. Any explanation
that needs it to is wrong — which is how the real cause of §9 below got found.

**2. Focus survives a section, and the app's own guard then eats every keystroke.** §7 leaves focus
on the speed `<select>` **on purpose** (that is its subject), so §9's `Home` and eight arrows were
correctly GUARDED and moved the clock **zero times** — leaving whatever cursor §8 had ended on. §9
then measured the sticky-bar wrap on the row reading `cycle 55 / 55 — halted | ecall`, **the
lightest row in the app, under a comment claiming the heaviest**, and every width check passed.
Caught only by PRINTING the row; the crowding is now asserted as its own **control cell** before any
width is measured, and the rig `blur()`s before driving keys. **The guard working is exactly what
made the rig wrong** — a passing app feature is a rig precondition.

A third, smaller: a **shell heredoc ate a backslash level** in a probe script, turning
`/cycle (\d+)/` into `/cycle (d+)/` and surfacing only as "page threw". Index arithmetic needs no
escapes and cannot be mangled that way.

## Chrome throttles setInterval — prove it isn't biting BEFORE trusting any period

A CDP-driven headless tab counts as a backgrounded renderer and Chrome clamps `setInterval` to ~1/s.
Launch with `--disable-background-timer-throttling --disable-renderer-backgrounding
--disable-backgrounding-occluded-windows`, and **prove it took by measuring the SLOW rung first and
requiring the fast one to differ**: observed 1.00/s and 3.98/s. Without that control, `max` reading
~1/s would have been filed as a render-cost ceiling instead of a browser policy.

Measured with the same machinery, no profiler: **`max` reaches 24.3 cycles/s against a theoretical
60** on out-of-order with 910 DOM nodes — the render, not the timer, bounds the top rung.

## The sticky bar again — a third occupant, and a threshold that MOVED

Play is worth **169px** in that row (content 896 → 1065px). It wrapped the bar across the whole
**1040–1180px band** — ordinary laptop territory, ~24px of permanently-eaten viewport per scroll.
Measured by sweeping **1500 → 620px in 20px steps** on out-of-order at cycle 7.

- **The legend's 1023px threshold became 1199px**, and `transport-keys.test.tsx`'s pinned number
  moved with it. **A measured threshold is not a constant — it moves when the row's occupants do**,
  which is the argument for asserting it rather than commenting it.
- Below 899px the play button drops its **word**, keeping the glyph that says which state it is in.
- ⚠ **A caption can vanish; a control cannot.** The residual — below 880px play may still cost a row
  — is left OPEN and stated, because closing it needs ~100px and only the speed `<select>` is that
  big. A test asserts no rule hides it. Also: the crossover is **content-dependent** (760px crowded,
  700px lighter), so the honest claim is a bound, not a closed window — a tighter-sounding band was
  falsified by the very next state.
- `.play-speed-label` shipped for one commit as **a class with no rule in the stylesheet** — a
  half-finished decision that looks finished. The `transport-keys` idiom (assert the class on the
  element AND a rule in the sheet naming it) is what catches it.

## Two smaller finds

- **A vacuous render assertion**: `toContain('value="60"')` passes at EVERY speed, because
  `renderToStaticMarkup` marks the selection with `selected=""` **on the `<option>`** and never as a
  `value` attribute on the `<select>` — and `value="60"` is on that option always. Ask which option
  carries `selected`. Likewise `indexOf('▶')` finds the **step** button (`step ▶`), not play.
- A CSS assertion must **strip comments** before asking whether a block names a selector: the check
  "no rule hides the `<select>`" failed against the prose explaining why a `<select>` must not be
  hidden. A check that reads a comment as a rule reports the documentation as the defect — and would
  equally miss a real rule buried in `/* … */`.
- `nextCursor` shipped an `if (lastCycle < 0)` guard that the break harness measured as **dead code
  (0 of 29 failed)**: `recordedCycles - 1` is −1 with nothing loaded and the pre-run cursor is −1
  too, so `cursor >= lastCycle` already stops it.
