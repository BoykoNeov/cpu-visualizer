/**
 * Keyboard control of the clock — the keymap and, more importantly, its GUARD, as a pure function
 * over an event shape. Plan: `docs/plans/keyboard-transport.md`.
 *
 * Why a module instead of four lines inside the `useEffect` that will call it: headless tests here
 * are `renderToStaticMarkup` with no jsdom, so **no test in this repo can see a keypress**. The
 * whole defect surface of a document-level key handler is "which key, pressed from which focused
 * element, with which modifier" — and that is a decision about values, which a pure predicate can
 * be swept exhaustively on. What is left for the browser to prove is only that the listener is
 * attached and that a real event's `target` is the element the reader is focused on.
 *
 * {@link TransportKeyEvent} is deliberately the structural subset of the DOM `KeyboardEvent` that
 * this decision reads, and NOTHING is remapped at the call site: `transportActionFor(e)` takes the
 * event itself. A caller that instead built `{ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
 * … }` would have four same-typed booleans written twice each — a transposition `tsc` cannot see
 * and these tests cannot see either, which is this repo's own M13/M14 finding. There is no field
 * name here to transpose.
 */

/** The four clock verbs. Each is exactly one of `useSimulator`'s existing callbacks — the keyboard
 *  introduces no action of its own, only a second way to trigger the buttons' (INV-3 untouched). */
export type TransportAction = 'stepForward' | 'stepBack' | 'reset' | 'runToEnd';

/** The subset of a DOM `KeyboardEvent` this decision reads. A real `KeyboardEvent` satisfies it. */
export interface TransportKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly defaultPrevented: boolean;
  readonly target: EventTarget | null;
}

/**
 * The bound keys, and the only ones.
 *
 * `→`/`←` step because they are the direction the scrub slider below the buttons already moves in;
 * `Home`/`End` are the ends of that same line. Deliberately absent, and each absence is a decision
 * (see the plan's pinned table):
 *
 *  - **Space** — the obvious "advance" key, and binding it means `preventDefault()`, which kills
 *    page scrolling in an app where the datapath, map, cache grid and machine-code panel all sit
 *    below the fold. That is the very complaint the sticky transport bar exists to answer, so
 *    stealing scroll to fix it would be a wash. Leaving Space and Enter unbound also DELETES the
 *    double-fire class rather than guarding it: those are the keys that activate a focused
 *    `<button>`, and the transport's own buttons are the most likely thing to hold focus.
 *  - **letter aliases** (`l`/`h`, `n`/`p`) — a bare letter is one keystroke from any future
 *    type-to-search, and no reader hunts for it.
 */
export const TRANSPORT_KEYS: Readonly<Record<string, TransportAction>> = {
  ArrowRight: 'stepForward',
  ArrowLeft: 'stepBack',
  Home: 'reset',
  End: 'runToEnd',
};

/** Elements whose own keyboard behaviour must win. `INPUT` covers BOTH the ISA reference's filter
 *  box (caret keys) and the scrub slider — `<input type="range">` moves on arrows natively, so an
 *  unguarded ArrowRight while it holds focus would scrub AND step, advancing the cursor by two on
 *  one press. `SELECT` changes option on arrows; the model and program pickers are selects. */
const KEY_CONSUMING_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Does this element already do something with the keys, so the transport must not?
 *
 * Reads `tagName`/`isContentEditable` off the event target defensively rather than by
 * `instanceof HTMLElement`: keeping the narrowing here (instead of at the call site) is what lets
 * the caller hand over the raw event, and an event target that is not an element — `document`,
 * `window` — simply has neither property and correctly reports false.
 */
export function consumesItsOwnKeys(target: EventTarget | null): boolean {
  if (target === null) return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  return typeof el.tagName === 'string' && KEY_CONSUMING_TAGS.has(el.tagName.toUpperCase());
}

/**
 * The clock verb this keystroke asks for, or `null` if the transport must keep its hands off.
 *
 * Guard order is cheapest-and-most-decisive first; every rung returns `null`:
 *
 *  1. **already handled** — `defaultPrevented` means something nearer the key claimed it.
 *  2. **ctrl / meta / alt** — `Ctrl+←` is browser-back and `Cmd+→` is OS-level. A teaching tool
 *     does not get to outrank the browser's own navigation.
 *  3. **shift** — held for the deferred lesson-step keys, and `Shift+Home` selects text.
 *  4. **the focused element types** — see {@link consumesItsOwnKeys}.
 *
 * Note what is NOT guarded: a focused `<button>`, including the step-rail dots that carry
 * `role="tab"`. The ARIA tablist pattern expects arrows to move between tabs, but this app
 * implements no roving tabindex, so nothing is being overridden — and a dead zone exactly where a
 * lesson reader's focus lands after clicking a step dot would be worse than the theoretical clash.
 * That position is asserted in the tests, so a future real tablist has something to trip over.
 */
export function transportActionFor(e: TransportKeyEvent): TransportAction | null {
  if (e.defaultPrevented) return null;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  if (consumesItsOwnKeys(e.target)) return null;
  return TRANSPORT_KEYS[e.key] ?? null;
}

/**
 * How each verb's key is written for a reader — the arrows as glyphs, the named keys as their
 * names. A shortcut nobody can find is not a fix, so this is not decoration: it is the half of the
 * feature a headless test can actually see, since `title` text and the legend both survive
 * `renderToStaticMarkup` while a keypress does not.
 *
 * Typed total over {@link TransportAction}, so a fifth verb cannot reach the buttons without a
 * spelling. That the spellings match {@link TRANSPORT_KEYS} — that `→` really is what `ArrowRight`
 * looks like — is the one correspondence no type can check, and it is pinned as literal data in
 * the tests instead.
 */
export const KEY_HINTS: Readonly<Record<TransportAction, string>> = {
  stepForward: '→',
  stepBack: '←',
  reset: 'Home',
  runToEnd: 'End',
};

/** The one word each verb goes by. Used for BOTH the button faces and the legend below them, so
 *  the hint always names the button it points at — a legend saying "step" beside a button reading
 *  "advance" would be a second vocabulary for the reader to reconcile. */
export const ACTION_WORDS: Readonly<Record<TransportAction, string>> = {
  stepForward: 'step',
  stepBack: 'back',
  reset: 'reset',
  runToEnd: 'run',
};

/**
 * The one-line key legend under the transport buttons, e.g. `→ step · ← back · …`.
 *
 * Folded over {@link TRANSPORT_KEYS} rather than written out, so a binding cannot ship invisible:
 * a new key appears here the moment it exists. Constant for the life of the app — it names keys,
 * not state — so it adds no per-step height change to a bar that five panels' jitter class already
 * taught this repo to watch.
 */
export function transportLegend(): string {
  return Object.values(TRANSPORT_KEYS)
    .map((action) => `${KEY_HINTS[action]} ${ACTION_WORDS[action]}`)
    .join(' · ');
}
