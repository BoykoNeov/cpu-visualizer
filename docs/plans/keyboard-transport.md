# Keyboard clock control — driving the transport from the keys

**Status: steps 0 and 1 COMPLETE, step 2 (browser pass) PENDING, 2026-07-30. Scope is a feature,
not a milestone: no engine, trace, curriculum or content change, and no new trace field (INV-3
untouched — the keyboard adds no action, only a new trigger for the four `useSimulator` callbacks
the buttons already call). PROVEN headlessly: the keymap and guard (48 tests, each guard sweep
paired with its control cell, all 8 mutations of the module caught) and the discoverability half
(13 render assertions on `TransportButtons`). Repo 7132 → 7200 tests; five gates green.
NOT yet proven, and unprovable here: that the listener is attached at all, that `preventDefault`
fires, and that a real event's `target` is the focused element — step 2 is the only net for those.
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

- [ ] **2. Browser pass — the only net for the dispatch.** Per
      `browser-rig-cdp-recipe` / `browser-rig-chrome-cleanup`: run `rig-sweep.ps1` first, target by
      served `<title>`, never by port. Drive the **shipped bundle**. Checks: each key moves the
      cycle readout; `→` at the halted end and `←` at start are no-ops (parity with the disabled
      buttons); Home/End do not scroll the page; typing `addi a0, a0, 1` in the editor leaves the
      cycle where it was; **focus the scrub slider and press `→` once — the cursor must advance by
      exactly one**, not two; a focused `<select>` still changes model on arrows.
      Acceptance: every check named above run and recorded, with its observed value — a check
      whose evidence is "looked right" is not a check.

## Acceptance criteria

- [ ] With a program loaded and focus nowhere in particular, `→` `←` `Home` `End` step forward,
      step back, reset to pre-run, and run to completion — identical to clicking the four buttons.
- [ ] No key drives the cursor outside `[-1, lastCycle]` (it cannot: the recorder already bounds
      `stepForward`/`stepBack`, and keys route through the same `sim.*` callbacks).
- [ ] Every guarded surface is inert: caret keys work in the editor and the ISA filter, arrows
      change a `<select>`, and **arrows on the focused slider scrub once, not scrub-and-step**.
- [ ] The bound keys are discoverable without documentation (button titles + transport legend).
- [ ] Nothing under `packages/engine`, `packages/trace`, `packages/curriculum`, `packages/isa`,
      `packages/assembler` or `content/` changes. Checked as a git range, not from memory.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` green.

## Decisions to pin (seeded with recommended answers)

| Decision                                                   | Recommendation (seed)                                                                                                                                                                                                                                                                                                                                                                          | Pinned answer |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **Is Space bound to step?**                                | **NO.** Space is the most discoverable "advance" key and binding it would require `preventDefault`, which kills page scrolling — in an app whose every interesting surface _sits below the fold_, by the same comment that motivates this feature. Not binding it also deletes a whole defect class rather than guarding it: with Space and Enter unbound, a focused button cannot double-fire | _(open)_      |
| **Which keys**                                             | `→`/`←` step (mirroring the slider's own direction), `Home` reset, `End` run to end. No letter aliases (`l`/`h`, `n`/`p`): a bare letter is one keystroke away from a future type-to-search and buys nothing a reader will look for                                                                                                                                                            | _(open)_      |
| **Shift/Ctrl/Meta/Alt held**                               | Inert — return null. `Ctrl+←` is browser-back, `Cmd+→` is OS-level. Shift stays reserved for the deferred lesson-step keys below                                                                                                                                                                                                                                                               | _(open)_      |
| **Lesson step prev/next keys**                             | **Available, not taken.** The narration panel's own Prev/Next buttons scrub to a step — that is seeking, not clock control, and it is live only in lesson mode. Named follow-up rather than silent omission                                                                                                                                                                                    | _(open)_      |
| **Within-cycle phase stepper keys**                        | **Not taken, on an architectural reason, not burden.** The phase cursor is view-local state in `DatapathView` (`useState<Phase>`), deliberately so — the recorder has no sub-cycle index. A document handler would have to lift it. Revisit only if the phase stepper is lifted for another reason                                                                                             | _(open)_      |
| **Arrows while a step-rail dot (`role="tab"`) is focused** | **Fire the transport.** The ARIA tablist pattern expects arrows to move between tabs, but this app implements no roving tabindex, so nothing is overridden — and a dead zone exactly where a lesson reader's focus lands after clicking a dot is worse. Pin it with a TEST, not a comment: if the rail ever gets real tablist keyboard behaviour, that test must be the thing that objects     | _(open)_      |
| **URL permalinks / play / persistence**                    | Deferred, not rejected — the other three confirmed gaps. Permalinks are the next best pick and its real work is a decision, not code: a link carrying `forwarding=false&model=out-of-order` must be honored as **inert** the way `ProcessorCapabilities` does, neither rejected nor silently applied                                                                                           | _(open)_      |

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
