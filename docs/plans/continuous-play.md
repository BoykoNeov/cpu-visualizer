# Continuous play — running the clock at a speed instead of a keystroke per cycle

**Status: PLANNED, 2026-07-30.** Scope is a **feature, not a milestone**: no engine, no trace, no
curriculum, no content. INV-3 is untouched in the strictest sense — play adds no data to the trace
and reads nothing new from it; it only calls `scrubTo` on a recording that is already complete.

Source of truth for scope: not on `cpu-visualizer-spec.md` §12's roadmap (complete through M10,
extended by M11–M14). It is the third of the **four product gaps in the shell** found by surveying
the UX surface after M14 closed, and the second to be built (`keyboard-transport.md` was the first).
Confirmed absent by grep over `packages/web/src`: `setTimeout|setInterval|requestAnimationFrame`
returns **one hit**, an `rAF` for a caret, and nothing near the clock.

## Why this, and why now

`run ⏭` jumps straight from where you are to the halted end. There is no picture in between — which
is the one thing this app exists to show. Today the reader's only way to _watch_ a program run is to
press `→` once per cycle, forty times, at whatever tempo their finger manages; the keyboard feature
made that cheap per press but it is still the reader hand-cranking the animation. The two verbs the
transport offers are "one cycle" and "all of them at once", and the whole pedagogical payload — a
bubble appearing, a forward arriving, a miss stalling the ROB — lives at a tempo between them.

It is also the honest pick on **what it teaches about this codebase**: it is the first shell feature
with a wall-clock in it, in a repo whose first invariant is determinism. Getting the seam right once
(the timer drives the _cursor_, never the _engine_) is worth more than the button.

### The invariant question, answered before it is asked

INV-1 says the engine is pure and deterministic — no wall-clock. Play has a wall-clock. These do not
collide, and the reason is structural rather than negotiated:

> `loadInto` calls `recorder.runToEnd(TEACHING_MAX_CYCLES)` and then `recorder.scrubTo(-1, …)`
> before `loaded.current` is ever set. **By the time anything can play, the whole recording already
> exists.** Play animates a cursor over recorded cycles; it never asks the engine for one.

So the timer lives in the view, alongside `tier` / `followed` / `stackOrder`, and drives exactly the
callbacks the buttons already drive. Same program + same config still yields a byte-identical trace
whether the reader played it, stepped it, or scrubbed it.

**Corollary, and it is a real trap:** the play speed must NOT join `SessionKnobs` / `OPENING_KNOBS`.
That ref's own docblock calls it "the session's whole opinion about the machine", and
`engineConfigOf` narrows it into a `ProcessorConfig` — a wall-clock value reaching that object is an
INV-2 violation wearing a plausible name. Speed is view state, full stop.

## Headline decision — the timer is three lines, the DECISIONS are a pure module

Same shape as `keyboard.ts`, for the same reason and with the same evidence behind it: headless
tests here are `renderToStaticMarkup` with no jsdom, so **no test in this repo can see a timer fire**
any more than it can see a keypress. The keyboard feature measured exactly what that costs —
deleting its one `addEventListener` line left **all 68 of its own headless tests green** while the
browser pass failed 6. A timer has the identical shape of hole.

So: everything that is a decision about **values** goes in `packages/web/src/playback.ts`, a pure
module with no `setInterval` anywhere in it —

- `PLAY_SPEEDS` — the stable positions (a small set, house pattern: like `CACHE_SMALL`/`CACHE_LARGE`
  and the four issue widths, the shell holds a _position_, never a freely-built number).
- `intervalFor(speed)` — position → milliseconds.
- `nextCursor(cursor, lastCycle)` → the next cycle, or `'stop'`. **This is where "what happens at the
  end" lives**, and it stops rather than loops.

— and what is left in `App.tsx` is attach / tick / dispatch, kept as small as it can be, exactly as
the keyboard effect is.

⚠ **Pin `PLAY_SPEEDS` as literal data in at least one assertion**, not only as a fold over the
constant. `it.each(PLAY_SPEEDS)` re-derives the thing it checks — this repo's signature defect, which
already bit _inside_ the keyboard suite (`it.each(BOUND)` could not see a `Home`/`End` remap; the
swap failed exactly one test, the literal `toEqual`).

## Build order (each step testable before the next)

- [x] ✅ **0. `playback.ts` — the speed table and the end rule, as pure functions.** New module:
      `PlaySpeed`, `PLAY_SPEEDS`, `intervalFor`, `nextCursor`, plus whatever spelling the control
      needs (`SPEED_LABELS`, typed total over `PlaySpeed`, so a fifth speed cannot ship unlabelled —
      the `KEY_HINTS` pattern). Colocated `playback.test.ts`: every speed's interval, both literal
      and swept; `nextCursor` at pre-run (−1 → 0), mid-run, at `lastCycle` → `'stop'`, past the end,
      and on an empty recording (`lastCycle = -1`) — the case where play must refuse to start at all.
      Acceptance: `npm test` / `typecheck` / `lint` green, no `.tsx` touched. Then **break it**:
      make `nextCursor` loop instead of stop, drop a speed, transpose two intervals — and record
      which mutations the suite catches. A mutation nothing catches is a missing assertion.
      **Landed: 29 tests, five gates green, no `.tsx` touched.** The table grew a fifth rung on the
      user's call mid-build — **`max` (60/s, one animation frame)** — because capping play at 20/s
      leaves a long program crawling. It is a real speed, not a synonym for `run ⏭`: `run ⏭` is
      instant and stays untouched, `max` is the fastest a display can SHOW a cycle and can be paused
      mid-flight. They answer different questions and neither is the other one slowed down.
      **Broken 8 ways; 7 caught, and the one that survived was the finding.** Deleting the
      `if (lastCycle < 0) return 'stop'` guard failed **0 of 29** — not a missing assertion but
      **dead code**: `recordedCycles - 1` is −1 with nothing loaded and the pre-run cursor is also
      −1, so `cursor >= lastCycle` already stops, and no reachable cursor sits below −1. The guard is
      a comment on `nextCursor` now, per the standing lesson that a decision with no net is a
      comment; the empty-recording test stays and documents that one rung answers both questions.
      The other seven, with what caught them: loop-instead-of-stop **6**, a dropped rung **3** (all
      three are the literal pins — every folded assertion re-derived it green), `>=`→`>` **5**, a
      transposed interval pair **2**, `canPlay` decoupled from `nextCursor` **2**, the opening speed
      moved to another REAL position **1** (the literal pin, alone — the "is it on the table" check
      cannot see it), and `max` respelled as a rate **2**. Harness:
      `M:\claud_projects\temp\play-break\break.py`.

- [x] ✅ **1. `usePlayback` — the timer, owned in one place.** A hook in `packages/web/src` taking the
      transport slice it needs (`cursor`, `lastCycle`, `scrubTo`, and the recording identity), and
      returning `{ playing, speed, toggle, setSpeed }`. Three things it must get right, none of them
      discoverable later.
      **(a) The interval effect depends on `playing` and `speed` and nothing that changes per tick.**
      A `cursor` dependency tears down and re-arms the timer every cycle, which makes the period
      silently irregular — and there is no headless net for a period. Read the cursor through a ref
      inside the tick.
      **(b) Stop on re-record.** Every knob (`setModel`, `setForwarding`, `setCache`,
      `setIssueWidth`, `setOutOfOrderIssue`, `setRobSize`, `select`, `startLesson`, `loadEdited`)
      routes to `loadInto`, which builds a **fresh recorder parked at −1**. A live timer would
      silently resume play on a different machine, from the start, with no user action. Ride the
      idiom `App.tsx:147` already uses for `followed`: an effect keyed on `sim.recorded`, whose
      identity changes per load.
      **(c) Stop at the end**, from inside the tick. `recorder.stepForward()` returns `null` at a
      halted end and does not advance (`recorder.test.ts:162`), so nothing throws — which is
      precisely the danger: without an explicit stop the timer ticks forever doing nothing and the
      button never returns to `▶`.
      Acceptance: suites/typecheck/lint green. The hook is jsdom-less like everything else here, so
      its net is thin **by admission, not by accident** — which is what step 3 is for.
      **Landed** as `usePlayback.ts`, all three musts as planned. Two things the build added: the
      run's LENGTH is read through a ref as well as the cursor (`lastCycleRef`) — it changes on every
      load, so leaving it in the closure reintroduces (a) through the other argument — and `scrubTo`
      is too, not because it moves today (it is a `useCallback` on `rerender` alone) but because a
      future edit making it cursor-dependent would convert this into the re-arming bug **silently and
      at a distance**. `toggle` refuses to start from a position play cannot move from, using
      `canPlay` on the same refs, so the button and the tick cannot disagree about where the run ends.

- [x] ✅ **2. The control, and the discoverability half.** One button in `TRANSPORT_BUTTONS`'s row that
      toggles face (`▶ play` / `⏸ pause`), plus a speed control beside it. One button, not two:
      `TRANSPORT_BUTTONS`'s `deadAt: 'start' | 'end'` cannot express "pause is dead when not
      playing", and a toggle keeps that binary intact.
      Acceptance: render assertions on the button's two faces and its disabled parity at the halted
      end; the speed control renders every `PLAY_SPEEDS` position with its label. Suites, typecheck,
      lint, build green.
      ⚠ **This is the third thing added to the `flexWrap` row inside `position: sticky`** that a
      251px legend already wrapped at 900px last week. The wrap check is an acceptance criterion of
      this step, not a browser-pass discovery — see below.
      **Landed: 16 render assertions, five gates green, repo 7200 → 7246 tests.** `PlayControl` is a
      separate exported component rather than a fifth `TRANSPORT_BUTTONS` entry, and it renders in a
      new `children` SLOT between the buttons and the legend — the legend is a caption for the KEYED
      verbs and play has no binding, so putting it after would list play among the things the caption
      names. Every existing `TransportButtons` test renders with no slot and is untouched.
      **One assertion was VACUOUS on first write and is the finding of this step.** "lights the
      selected position" was `toContain('value="60"')` — which passes at **every** speed, because
      `renderToStaticMarkup` puts the selection on the `<option>` as `selected=""` and never on the
      `<select>` as a `value` attribute, while `value="60"` is on that option always. Caught by
      dumping the actual markup rather than trusting the green. It is an extractor now, asking which
      option carries `selected`, plus a sweep asserting exactly one is lit at every position.
      **Broken 6 ways, 6 caught**: the select stuck on one value **2**, `disabled` ignoring `playing`
      **1** (the case that strands a running clock with no way to pause it), `disabled` dropped **1**,
      the two faces swapped **3**, the slot moved after the legend **1**, and the title no longer
      naming `run ⏭` **1**. Harness: `M:\claud_projects\temp\play-break\break2.py`. ⚠ Its console
      printing crashed on `▶` under cp1252 — the `finally` had already restored the tree, confirmed
      by `git status`, but encode findings ASCII-safe when re-running it.

- [ ] **3. Browser pass — the only net for the whole feature.** Per `browser-rig-cdp-recipe` /
      `browser-rig-chrome-cleanup`: run `M:\claud_projects\temp\rig-sweep.ps1` FIRST, target by
      served `<title>` never by port, drive the **shipped bundle**, and re-count Chromes after.
      Checks, each recorded with its observed value: - Press play: the cycle readout advances **unaided**, and the observed count over a stated
      wall-clock window matches `intervalFor(speed)` within a stated tolerance. (A readout that
      merely _changed_ is also what one leaked `stepForward` looks like.) - Pause mid-run leaves the cursor where it was and it **stays** there for a stated interval. - Play to the end: the button returns to `▶` **with no user action**, and the cursor is at
      `lastCycle`. This is the auto-stop, and it is browser-observable only. - Change speed while playing: the observed period changes and the cursor does not jump. - **Flip a config knob while playing** (forwarding is the flagship): play stops, the cursor is
      at −1, and it does **not** resume. The re-record trap, measured. - Scrub while playing: play continues **from the new position** (the pinned behaviour below). - The tick's cost at the fastest speed, measured on the **most expensive configuration**
      (out-of-order, cache on, map + pairing readout visible, datapath at `expert`). If the frame
      cost exceeds the interval the max speed is wrong — and that measurement is what pins it. - **The wrap check, with its counterfactual**: at stated viewports (1400 / 1024 / 900 / 800),
      on the model with the MOST chips in that row, **mid-run** — then hide the new controls and
      re-measure. _A wrap is only yours if the counterfactual says so_ (the 700px pre-existing wrap
      is the standing example of what that discriminator saves you from). The honest metric is
      **row box taller than its tallest child**, never comparing children's `rect.top`. - Both palettes for any new ink: headless Chrome opens **dark**, so a first screenshot is
      dark-only.
      Then **break the app and re-run**: remove the one line that arms the timer and record how many
      of this feature's headless tests still pass. For keyboard that number was 68 of 68. Writing
      the observed number into this plan is what states, in a number, what the browser pass is for.
      ⚠ **The transport bar's `innerText` changes again.** It currently reads
      `…run ⏭ | → step · ← back · Home reset · End run | cycle N / M`. Any rig under `temp/` doing an
      equality on that bar or picking its spans positionally expires — a fresh instance of the
      "a rig selector expires when the app grows a neighbour" trap. A `/cycle (\d+) \/ (\d+)/` regex
      is safe and is what this pass should use.

## Acceptance criteria

- [ ] With a program loaded, one click on `▶ play` walks the cursor forward one cycle at a time at
      the selected speed, with no further input, and every panel animates as it does when stepping.
- [ ] Play **stops by itself** at the halted end, and the button shows `▶` again.
- [ ] Play never drives the cursor outside `[-1, lastCycle]`, and refuses to start on a recording
      with no cycles.
- [ ] Changing any config knob, model, program, or lesson while playing **stops** play, at the
      pre-run cursor the re-record parks at.
- [ ] The engine is untouched: no wall-clock, no timer, and no new field reaches `ProcessorConfig`
      or `SessionKnobs`. Checked as a diff, not asserted in prose.
- [ ] The sticky transport bar is still ONE line at 1024px and above, measured with the
      counterfactual on the most crowded model mid-run.
- [ ] Nothing outside `packages/web` and this plan changes, checked as a git range.
- [ ] All five gates green, with the repo's test count before → after recorded.

## Decisions to pin (seeded with recommended answers)

| Decision                                    | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Pinned answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Does play get a keyboard binding?**       | **NO in v1**, and this is the decision everything else hangs off. Play's natural key is Space — which `keyboard.ts` leaves unbound on a **measured** reason: binding it needs `preventDefault()` and costs the page its scrolling (observed `scrollTop` 100 → 630), in an app whose every interesting surface is below the fold; and leaving Space/Enter unbound _deletes_ the focused-button double-fire class instead of guarding it. A button-only play is a complete feature; the key is an additive follow-up that would have to argue with that evidence | **NO in v1**, as seeded, with the counter-evidence reviewed rather than waived (user, 2026-07-30). The whole ownership shape below follows from this one answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Does play join `TransportAction`?**       | **NO — a separate `usePlayback` hook and its own button.** Falls straight out of the row above. `TransportAction`'s docblock says "the keyboard introduces no action of its own, only a second way to trigger the buttons'" — play carries STATE, so folding it in would make that claim false, force `Simulator` to expose `play`/`pause`, and force spellings into `KEY_HINTS`/`ACTION_WORDS` for a verb no key reaches. If play ever gets a key, that is when this cost is earned                                                                           | **NO** — falls out of the row above. `usePlayback` + its own button; `TransportAction` stays four verbs and its docblock stays true                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Does play walk cycles or phases?**        | **Cycles**, on an architectural reason rather than preference. The phase cursor is `useState<Phase>` **view-local to `DatapathView`** (`:51`) and re-fires `setPhase('WB')` per `cycleKey` (`:52`) — phase-walking needs that state lifted out of six `*DatapathView.tsx` files first. Same reason the keyboard plan declined phase keys, unchanged. Bonus: the per-cycle reset means the datapath shows its full lit path each tick, so the chips do not strobe                                                                                               | **CYCLES**, on the architectural reason as seeded. Phase-walking stays a named follow-up behind lifting `useState<Phase>` out of six datapath views                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **What happens at the end — stop or loop?** | **Stop.** A loop restarts an already-halted program from pre-run with no user action, which reads as the machine doing something rather than the animation wrapping. Loop mode is a named follow-up, not a silent omission                                                                                                                                                                                                                                                                                                                                     | **STOP**, as seeded. Loop mode is a named follow-up                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Scrub or step while playing**             | **Play continues from the new position.** It is the plain behaviour and needs no extra state. Pinned here _because_ the alternative (any manual transport touch stops play) is equally defensible — silence means this gets decided by accident in whichever effect is written first                                                                                                                                                                                                                                                                           | **PLAY CONTINUES from the new position** (user, 2026-07-30). Needs assertion, not prose — the alternative is equally defensible, so this is a row that changes behaviour if reversed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **The speed positions**                     | A small set of stable positions with a documented opening default, not a free-form ms number — the house pattern for every knob in this shell. The **max** is not chosen by taste: step 3 measures per-tick render cost on the most expensive configuration and that pins it                                                                                                                                                                                                                                                                                   | **FIVE: 1 / 4 / 10 / 20 / 60 cycles per second** (1000 / 250 / 100 / 50 / 16.7 ms), opening at **4** — fast enough to read as motion, slow enough to watch a bubble appear (user, 2026-07-30). Named in cycles per second, not multipliers: the app's unit is the cycle and the reader is counting them. The fifth rung, **`max` (60/s = one animation frame)**, was added mid-build on the user's call: capping play at 20/s leaves a long program crawling. It is NOT a synonym for `run ⏭` — that button is instant and stays — it is the fastest a display can SHOW a cycle, and unlike `run ⏭` it can be paused mid-flight. ⚠ The top of the table is PROVISIONAL until step 3 measures per-tick render cost on the most expensive configuration |
| **Where the speed lives**                   | **View state beside `tier` / `followed`, never `SessionKnobs`.** `engineConfigOf` narrows that ref into a `ProcessorConfig`; a wall-clock value reaching it is INV-2 with a plausible name on it                                                                                                                                                                                                                                                                                                                                                               | **VIEW STATE** beside `tier`/`followed`, as seeded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **URL permalinks / session persistence**    | Still deferred, still the remaining two gaps. Permalinks stay the next best pick and their real work is a decision, not code: a link carrying `forwarding=false&model=out-of-order` must be honored as **inert** the way `ProcessorCapabilities` does. Worth noting play speed would be a natural permalink field _if_ this ships first                                                                                                                                                                                                                        | **Still deferred**, unchanged by this build                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## How this feature can lie to itself

- **A green `playback.test.ts` proves no timer exists.** Every cell of it passes with the arming
  line deleted. This is not a worry; it is a measured property of this repo, and step 3's break-run
  is what turns it into a number.
- **"The readout advanced" is the weakest possible evidence.** It is equally true of one leaked
  `stepForward`, of a timer at the wrong period, and of a timer that fires once and dies. Every play
  check must be phrased as **a count over a stated window**, which is a value a broken app cannot
  also produce.
- **A no-op that looks like a pause.** Pause leaving the cursor still is also what a dead timer, an
  already-ended run, and a detached handler all look like. Check pause only _after_ proving play
  moves the readout, and assert the cursor is unchanged **after an interval**, not immediately.
- **An irregular period is invisible.** A `cursor` dependency in the interval effect re-arms the
  timer every tick; nothing headless can see it, and by eye it looks like play working. The net is
  the dependency array being right by construction plus step 3's counted window.
- **The re-record trap passes silently.** If play does not stop on a knob flip, what the reader sees
  is a program playing from the start — which looks like a feature. Only a check that asserts the
  cursor is at **−1 and staying there** distinguishes it.
- **A wrap measured without its counterfactual is not this feature's wrap.** The bar wraps at 700px
  with everything hidden; last week that fact nearly got billed to the keyboard legend.
- **A pinned decision with no net is a comment.** Of the eight rows above, the ones that would
  change behaviour if reversed — stop-not-loop, scrub-continues, cycles-not-phases — get assertions.
  The rest are prose and are marked as such.
