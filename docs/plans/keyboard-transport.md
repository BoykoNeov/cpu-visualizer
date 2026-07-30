# Keyboard clock control — driving the transport from the keys

**Status: ✅ COMPLETE, 2026-07-30. Scope is a feature,
not a milestone: no engine, trace, curriculum or content change, and no new trace field (INV-3
untouched — the keyboard adds no action, only a new trigger for the four `useSimulator` callbacks
the buttons already call). PROVEN headlessly: the keymap and guard (48 tests, each guard sweep
paired with its control cell, all 8 mutations of the module caught) and the discoverability half
(13 render assertions on `TransportButtons`). Repo 7132 → 7200 tests; five gates green.
BROWSER-VERIFIED on the shipped bundle: 38 checks, 0 failures, and the rig was itself validated
against a broken app twice (below). The headline measurement of the whole feature: **with the
`addEventListener` line removed — the feature not existing at all — all 68 new headless tests still
pass, and the browser pass fails 6.**
The module shipped as `keyboard.ts`, not the `keys.ts` this plan first named (a CPU simulator has
cache keys; the file is about a keyboard).**

Source of truth for scope: this is not on `cpu-visualizer-spec.md` §12's roadmap, which is complete
through M10 and extended by M11–M14. It is a **product gap in the shell**, found by surveying the
UX surface after M14 closed: `keydown` appears exactly once in `packages/web/src`
(`Reorderable.tsx`, for drag a11y), and nowhere near the clock.

## Why this, and why now

The four confirmed absences in the shell are keyboard control, URL permalinks, continuous play,
and session persistence. This one is picked first because **the codebase already documents the
pain in its own words.** `App.tsx`'s `transport--sticky` comment:

> The clock controls are the one surface a reader needs while looking at ANY other surface: the
> whole point of the datapath, the map, the cache grid, and the machine-code panel is watching
> them change as you step, and all of them sit below the fold. Unpinned, examining any of them
> meant scrolling up to press `step ▶` and back down to see what it did — which is the reader
> doing the animation's job by hand.

Pinning the bar fixed _reaching_ the button. It did not fix that the reader's hand is on the mouse,
travelling to a 60px target, once per cycle, for a 40-cycle program. A step-through simulator whose
primary verb costs a mouse trip is charging rent on its own core interaction. Keys finish the fix
the sticky bar started.

It is also the honest first pick on cost: it touches one file plus one new module, and it needs no
decision about what a shareable URL means (the permalink option's real work is deciding how an
inert knob travels — see the pinned deferral below).

## Headline decision — the guard IS the feature, so the guard is a pure function

A document-level `keydown` handler in **this** app is not a two-line `useEffect`. The shell has six
focusable surfaces that natively consume the keys a transport wants:

| Surface                                     | What the browser already does with arrows                |
| ------------------------------------------- | -------------------------------------------------------- |
| `<textarea aria-label="Program source">`    | moves the caret — a learner typing `addi` must not step  |
| `<input type="range" aria-label="Scrub …">` | **scrubs** — the trap: ArrowRight would scrub AND step   |
| `<select>` × 3 (model, program, …)          | changes the selected option                              |
| `<input>` in `IsaReference`                 | moves the caret in the instruction filter                |
| any focused `<button>`                      | Space/Enter activate it → double-fire if those are bound |
| the page itself                             | Home/End/arrows scroll                                   |

So the decision: **the keymap and its guard live in a new pure module `packages/web/src/keyboard.ts`,
as `transportActionFor(event-like) → TransportAction | null`**, and `App.tsx` gets a thin
`useEffect` that calls it and dispatches. The reason is this repo's oldest constraint — headless
tests here are `renderToStaticMarkup` with no jsdom, so **no test can see a keypress.** A pure
predicate over a plain `{ key, ctrlKey, target: { tagName } }` object is fully testable headlessly;
the whole defect surface (which key, from which focus, with which modifier) gets a real net, and
only the four-line dispatch is left for the browser pass to prove.

Consequence worth stating: because the predicate takes a shape rather than a DOM `KeyboardEvent`,
its tests can enumerate every (key × focus surface × modifier) cell. That is the net. The browser
pass proves the _wiring_ — that the listener is attached, that `preventDefault` fires, and that the
guard behaves the same on real events as on the synthetic ones.

## Build order (each step testable before the next)

- [x] ✅ **0. `keyboard.ts` — the keymap and its guard, as a pure function.** New module exporting
      `TransportAction = 'stepForward' | 'stepBack' | 'reset' | 'runToEnd'`, a structural
      `TransportKeyEvent` (`key`, `ctrlKey`, `metaKey`, `altKey`, `shiftKey`, `defaultPrevented`,
      `target`), and `transportActionFor()`. Guard order: `defaultPrevented` → any of
      ctrl/meta/alt → shift → editable/native-consumer target (`TEXTAREA`, `INPUT`, `SELECT`,
      `isContentEditable`) → keymap lookup. Colocated `keyboard.test.ts` enumerates every cell,
      including the slider trap and each unbound key that must stay unbound.
      Acceptance: `npm test` green with the (key × surface × modifier) sweep; `npm run typecheck`
      and `npm run lint` green. No `.tsx` touched yet.
      **Landed:** 48 tests. Then broken 8 ways — each guard rung deleted, shift unguarded, Space
      bound, `INPUT` dropped from the consuming tags, `toUpperCase` dropped, `Home`/`End` swapped —
      and every mutation was caught. The swap is the one worth recording: it failed exactly ONE
      test, the literal `toEqual` on the map, because the three `it.each(BOUND)` sweeps derive
      their expectation FROM the map and would re-derive any remap green. That is this repo's
      signature defect (a test keyed off a fold, not the artifact) appearing inside the suite
      written to avoid it; the finding is now a comment on `BOUND` naming the count it measured.

- [x] ✅ **1. Wire it, and make it discoverable in the same commit.** `App.tsx` gains one
      `useEffect` (document `keydown`, `transportActionFor`, dispatch to `sim.*`,
      `preventDefault()` only when an action came back) and the existing `title=` strings on
      reset/back/step/run gain their key hint (`Step forward one cycle (→)`), plus a compact
      `kbd` legend in the transport bar. A shortcut nobody can discover is not a UX fix, and the
      hints are the half of this feature with a headless net: `title` and legend text both appear
      in `renderToStaticMarkup`.
      Acceptance: render tests assert each of the four buttons' `title` names its key and that the
      legend lists exactly the bound keys — so a keymap change that forgets the hint fails. Suites,
      typecheck, lint, build green.
      **Landed:** the four buttons came OUT of `Transport` into an exported pure
      `TransportButtons`, because a render test needs a component that does not demand a whole
      simulator. Dispatch is `sim[action]()` and the effect's verb table is shorthand properties,
      so no field name is written twice anywhere on this path. `KEY_HINTS` is typed total over
      `TransportAction` (a fifth verb cannot reach a button unspelled) and the legend is folded
      over `TRANSPORT_KEYS` (a fifth binding cannot ship invisible); what neither can check — that
      `→` is what `ArrowRight` looks like — is pinned as literal data on both sides in the tests.
      13 assertions, incl. the disabled-parity table at both ends of the run and at the pre-run
      cursor where both ends are true at once.

- [x] ✅ **2. Browser pass — the only net for the dispatch.** Per
      `browser-rig-cdp-recipe` / `browser-rig-chrome-cleanup`: run `rig-sweep.ps1` first, target by
      served `<title>`, never by port. Drive the **shipped bundle**. Checks: each key moves the
      cycle readout; `→` at the halted end and `←` at start are no-ops (parity with the disabled
      buttons); Home/End do not scroll the page; typing `addi a0, a0, 1` in the editor leaves the
      cycle where it was; **focus the scrub slider and press `→` once — the cursor must advance by
      exactly one**, not two; a focused `<select>` still changes model on arrows.
      Acceptance: every check named above run and recorded, with its observed value — a check
      whose evidence is "looked right" is not a check.
      **Landed: 38 checks, 0 failures** (`M:/claud_projects/temp/kbd-browser/eyeball.mjs`). Keys are
      dispatched with **`Input.dispatchKeyEvent`, not a synthetic `KeyboardEvent`** — that is what
      makes the slider check mean anything, since a synthetic event runs the handler and nothing
      else, so "advanced by one" would have been true whether or not the native scrub still
      happened. Observed: slider focused, one `→`, **1 → 2, delta 1**. The editor check is paired
      with its own control (`selectionStart` 0 → 1, so the keystroke provably ARRIVED before the
      clock provably did not move), and Space measures both halves of its pinned decision — clock
      unchanged, `scrollTop` **100 → 630**.
      **Two rig findings, both the rig, per the house record:** 1. `arrows still work while a transport button holds focus` passed while reporting
      `focus=BODY`. The run was at its END, where `step ▶` is **disabled — and a disabled button
      cannot take focus**, so the check silently re-proved §1. Fixed by resetting first and
      asserting `activeElement` is a BUTTON as its own control cell. 2. The model-picker check first asserted only "not one step on". Sharpened to `=== -1`: a
      model change re-records to pre-run, so **-1 is the guard holding and 0 is a leaked step** —
      two distinguishable values, which is the difference between an assertion and a shrug.
      **The rig was then broken twice to see if it could fail.** BREAK 1, `addEventListener`
      removed: headless **68/68 green**, browser **6 failures**. BREAK 2, `preventDefault` removed:
      **exactly one failure**, the check written for it (`scrollTop=630` — End scrolled the page).
      Tree restored byte-identical to HEAD and re-run: 38/38.
      ⚠ Confirming [[browser-rig-chrome-cleanup]] again: the rig's `finally { chrome.kill();
  preview.kill(); }` left **5 preview servers and 35 Chromes** alive across five runs.
      `rig-sweep.ps1` cleared them, re-counted 0/0/0/0, user's 38 Chromes untouched.

## Acceptance criteria

- [x] ✅ With a program loaded and focus nowhere in particular, `→` `←` `Home` `End` step forward,
      step back, reset to pre-run, and run to completion — identical to clicking the four buttons.
      Observed on `sum-loop`: pre-run → 0 → 3 → 2 → pre-run → `cycle 33 / 33 — halted`.
- [x] ✅ No key drives the cursor outside `[-1, lastCycle]`. Both ends driven: `→` at the halted
      end and `←` at pre-run each left the readout unchanged.
- [x] ✅ Every guarded surface is inert — the slider (**delta 1, not 2**), the program editor (caret
      0 → 1 while the clock held at 1), the ISA filter, and the model picker (which still changed
      `single-cycle` → `multi-cycle` on an arrow while the clock did not step).
- [x] ✅ Discoverable: all four titles name their key, and the legend renders visible at 251×14.
- [x] ✅ Nothing outside `packages/web` and this plan changed. Checked as the git range
      `6485ea8..HEAD`: five files, four of them `packages/web/src`, zero under
      `packages/{engine,trace,curriculum,isa,assembler}` or `content/`.
- [x] ✅ All five gates green. Repo 7132 → 7200 tests.

## Decisions to pin (seeded with recommended answers)

| Decision                                                   | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                                                          | Pinned answer                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Is Space bound to step?**                                | **NO.** Space is the most discoverable "advance" key and binding it would require `preventDefault`, which kills page scrolling — in an app whose every interesting surface _sits below the fold_, by the same comment that motivates this feature. Not binding it also deletes a whole defect class rather than guarding it: with Space and Enter unbound, a focused button cannot double-fire | **NO, and both halves measured.** Browser: Space left the clock at cycle 1 and scrolled the page 100 → 630. The corollary held too — arrows work with `step ▶` focused, needing no button guard at all                           |
| **Which keys**                                             | `→`/`←` step (mirroring the slider's own direction), `Home` reset, `End` run to end. No letter aliases (`l`/`h`, `n`/`p`): a bare letter is one keystroke away from a future type-to-search and buys nothing a reader will look for                                                                                                                                                            | **As seeded.** `→`/`←`/`Home`/`End`, pinned by a literal `toEqual` on the map — the one net that catches a remap, since the three `it.each` sweeps derive from it (measured: swapping Home/End fails exactly that one test)      |
| **Shift/Ctrl/Meta/Alt held**                               | Inert — return null. `Ctrl+←` is browser-back, `Cmd+→` is OS-level. Shift stays reserved for the deferred lesson-step keys below                                                                                                                                                                                                                                                               | **As seeded.** Ctrl/meta/alt/shift all return null, each swept against its own control cell. Browser: Ctrl+→ and Shift+→ both left the readout at 1                                                                              |
| **Lesson step prev/next keys**                             | **Available, not taken.** The narration panel's own Prev/Next buttons scrub to a step — that is seeking, not clock control, and it is live only in lesson mode. Named follow-up rather than silent omission                                                                                                                                                                                    | **NOT TAKEN** — unchanged, and still a named follow-up rather than a silent omission. Nothing in the build argued for it                                                                                                         |
| **Within-cycle phase stepper keys**                        | **Not taken, on an architectural reason, not burden.** The phase cursor is view-local state in `DatapathView` (`useState<Phase>`), deliberately so — the recorder has no sub-cycle index. A document handler would have to lift it. Revisit only if the phase stepper is lifted for another reason                                                                                             | **NOT TAKEN** on the architectural reason as seeded. Unchanged by the build: the phase cursor is still `useState<Phase>` inside `DatapathView`                                                                                   |
| **Arrows while a step-rail dot (`role="tab"`) is focused** | **Fire the transport.** The ARIA tablist pattern expects arrows to move between tabs, but this app implements no roving tabindex, so nothing is overridden — and a dead zone exactly where a lesson reader's focus lands after clicking a dot is worse. Pin it with a TEST, not a comment: if the rail ever gets real tablist keyboard behaviour, that test must be the thing that objects     | **FIRE**, as seeded, and pinned by a test rather than this row — `keyboard.test.ts`'s `PINNED: arrows on a lesson step-rail dot drive the clock`. That assertion is what a future roving-tabindex implementation must argue with |
| **URL permalinks / play / persistence**                    | Deferred, not rejected — the other three confirmed gaps. Permalinks are the next best pick and its real work is a decision, not code: a link carrying `forwarding=false&model=out-of-order` must be honored as **inert** the way `ProcessorCapabilities` does, neither rejected nor silently applied                                                                                           | **Still deferred.** Permalinks remain the next best pick, and this build did not touch the decision they turn on                                                                                                                 |

## How this feature can lie to itself

- **A green predicate sweep proves nothing is attached.** Every cell of `keys.test.ts` can pass
  with the `useEffect` deleted. Step 2 is not optional garnish; it is the only evidence the
  feature exists.
- **Testing the guard with a synthetic target shape.** `transportActionFor` sees
  `{ tagName: 'INPUT' }` because the test wrote it. Only the browser proves a real event's
  `target` is the element the reader is focused on — which is why the slider check is phrased as
  _advance by exactly one_, a number, rather than "the slider still works".
- **Believing a no-op.** `→` at the halted end and `←` at the start both do nothing, which is
  also what a detached listener does. Check them _after_ proving a bound key moves the readout,
  never before.
- **Pinning a decision in prose.** Six of the seven rows above are choices a future edit could
  reverse without a single test failing. The two that would actually change behaviour — the
  unbound keys and the `role="tab"` position — get assertions, per this repo's standing lesson
  that a pinned decision with no net is a comment.
