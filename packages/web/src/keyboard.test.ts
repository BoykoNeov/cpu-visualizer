import { describe, expect, it } from 'vitest';
import {
  ACTION_WORDS,
  consumesItsOwnKeys,
  KEY_HINTS,
  transportActionFor,
  transportLegend,
  TRANSPORT_KEYS,
  type TransportAction,
  type TransportKeyEvent,
} from './keyboard';

/**
 * The exhaustive net for keyboard clock control (`docs/plans/keyboard-transport.md`, step 0).
 *
 * This is the whole headless net the feature can have: no jsdom, so no test here can dispatch a
 * keypress or observe a listener. What it CAN do is sweep every cell of the decision — key ×
 * focused element × modifier — because `transportActionFor` is a pure function of the event's
 * values. Two things follow, and both are honored below:
 *
 *  - **Every sweep needs its control cell.** A sweep asserting `null` everywhere passes just as
 *    happily if the key names are misspelled and nothing was ever bound. So each guard sweep is
 *    paired with the same key firing when the guard is absent.
 *  - **Green here does not mean the handler is attached.** Step 2's browser pass is the only
 *    evidence of that, and of the one fact these synthetic targets assume: that a real event's
 *    `target` is the element the reader is focused on.
 */

/** A keystroke with everything clear: no modifiers, nothing handled it, focus on no element. */
function press(key: string, over: Partial<TransportKeyEvent> = {}): TransportKeyEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: null,
    ...over,
  };
}

/** A stand-in for the focused element. The cast is the one place this suite leaves the type
 *  system: a DOM `EventTarget` cannot be constructed headlessly, and the two properties the guard
 *  reads (`tagName`, uppercase on a real element; `isContentEditable`) are real ones. */
function focused(tagName: string, extra: Record<string, unknown> = {}): EventTarget {
  return { tagName, ...extra } as unknown as EventTarget;
}

/**
 * The bound pairs, read FROM the map — so every sweep below is about the guard, never about which
 * key means what. Measured, not assumed: swapping `Home` and `End` in the source fails exactly one
 * test in this file, the literal `toEqual` right below. That equality is the whole net on the
 * binding itself; these `it.each(BOUND)` sweeps would happily re-derive a remap and stay green,
 * which is this repo's oldest defect shape — a test keyed off a fold instead of the artifact.
 */
const BOUND = Object.entries(TRANSPORT_KEYS) as [string, TransportAction][];

describe('the keymap itself', () => {
  it('binds exactly the four clock verbs, to exactly these keys', () => {
    // Pinned as an equality, not a containment: this is the list the button titles and the
    // transport legend must agree with (step 1), so adding a fifth key has to come here first.
    expect(TRANSPORT_KEYS).toEqual({
      ArrowRight: 'stepForward',
      ArrowLeft: 'stepBack',
      Home: 'reset',
      End: 'runToEnd',
    });
    // Four distinct verbs, so no key shadows another's action.
    expect(new Set(Object.values(TRANSPORT_KEYS)).size).toBe(4);
  });

  it.each(BOUND)('%s presses %s when nothing is in the way', (key, action) => {
    expect(transportActionFor(press(key))).toBe(action);
  });

  /** The keys a reader might reasonably expect, each unbound ON PURPOSE. Space heads the list:
   *  binding it would need `preventDefault()` and cost the page its scrolling, and leaving it —
   *  with Enter — unbound is what makes a focused transport button unable to double-fire. */
  it.each([
    ' ',
    'Spacebar',
    'Enter',
    'ArrowUp',
    'ArrowDown',
    'PageUp',
    'PageDown',
    'Escape',
    'Tab',
    'Backspace',
    'k',
    'j',
    'h',
    'l',
    'n',
    'p',
    'r',
    '.',
    ',',
    '0',
  ])('%p stays unbound', (key) => {
    expect(transportActionFor(press(key))).toBeNull();
  });

  it('is case-sensitive on the DOM key names, so no lowercase near-miss binds', () => {
    // `KeyboardEvent.key` is 'ArrowRight'/'Home' exactly; a handler keyed on 'arrowright' would
    // never fire. Asserting the miss keeps the lookup honest about which spelling it reads.
    expect(transportActionFor(press('arrowright'))).toBeNull();
    expect(transportActionFor(press('HOME'))).toBeNull();
    expect(transportActionFor(press('ArrowRight'))).toBe('stepForward');
  });
});

describe('modifiers hand the key back to the browser', () => {
  it.each(BOUND)('%s is inert under ctrl / meta / alt / shift', (key, action) => {
    // Control cell FIRST: without it, a typo in `key` would make all four assertions below pass
    // for the wrong reason.
    expect(transportActionFor(press(key))).toBe(action);
    expect(transportActionFor(press(key, { ctrlKey: true }))).toBeNull();
    expect(transportActionFor(press(key, { metaKey: true }))).toBeNull();
    expect(transportActionFor(press(key, { altKey: true }))).toBeNull();
    expect(transportActionFor(press(key, { shiftKey: true }))).toBeNull();
  });

  it('leaves the browser its own navigation', () => {
    // Ctrl+ArrowLeft is word-back in a text field and history-back on some platforms; Cmd+Arrow is
    // OS-level. A teaching tool does not outrank either.
    expect(transportActionFor(press('ArrowLeft', { ctrlKey: true }))).toBeNull();
    expect(transportActionFor(press('ArrowRight', { metaKey: true }))).toBeNull();
  });

  it('declines a keystroke something nearer the key already handled', () => {
    expect(transportActionFor(press('ArrowRight', { defaultPrevented: true }))).toBeNull();
    expect(transportActionFor(press('End', { defaultPrevented: true }))).toBeNull();
  });
});

describe('elements that type their own keys keep them', () => {
  /** Every focusable surface in the shell that the browser already gives these keys to. */
  const CONSUMERS = ['INPUT', 'TEXTAREA', 'SELECT'];

  it.each(CONSUMERS)('%s swallows every bound key', (tagName) => {
    for (const [key, action] of BOUND) {
      expect(transportActionFor(press(key))).toBe(action); // control: the key IS bound
      expect(transportActionFor(press(key, { target: focused(tagName) }))).toBeNull();
    }
  });

  it('the scrub slider advances the cursor by ONE, not two', () => {
    // The trap this guard exists for. `<input type="range">` moves natively on arrows, so an
    // unguarded ArrowRight while the slider holds focus would scrub one cycle AND step one more —
    // the reader presses once and the clock jumps two. The guard is by tag, so it covers the
    // slider and the ISA filter box with the same rung.
    const slider = focused('INPUT', { type: 'range', ariaLabel: 'Scrub timeline' });
    expect(transportActionFor(press('ArrowRight', { target: slider }))).toBeNull();
    expect(transportActionFor(press('ArrowLeft', { target: slider }))).toBeNull();
  });

  it('a learner typing in the program editor never moves the clock', () => {
    const editor = focused('TEXTAREA', { ariaLabel: 'Program source' });
    for (const [key] of BOUND) {
      expect(transportActionFor(press(key, { target: editor }))).toBeNull();
    }
  });

  it('a contenteditable host keeps its caret whatever it is tagged', () => {
    expect(
      transportActionFor(
        press('ArrowRight', { target: focused('DIV', { isContentEditable: true }) }),
      ),
    ).toBeNull();
    // …and the flag being present-but-false is not a reason to bail.
    expect(
      transportActionFor(
        press('ArrowRight', { target: focused('DIV', { isContentEditable: false }) }),
      ),
    ).toBe('stepForward');
  });

  it.each(['BUTTON', 'DIV', 'BODY', 'A', 'SVG'])('%s does NOT swallow the key', (tagName) => {
    expect(transportActionFor(press('ArrowRight', { target: focused(tagName) }))).toBe(
      'stepForward',
    );
  });

  it('keeps stepping while a transport button holds focus — the flow this feature is for', () => {
    // Click `step ▶` once, then arrow: focus is on the button, and the key must still work. It
    // does because Space/Enter — the keys a focused button consumes — are unbound (see the keymap
    // suite), so this needs no guard at all.
    const stepButton = focused('BUTTON', { title: 'Step forward one cycle' });
    expect(transportActionFor(press('ArrowRight', { target: stepButton }))).toBe('stepForward');
    expect(transportActionFor(press('ArrowLeft', { target: stepButton }))).toBe('stepBack');
  });

  it('PINNED: arrows on a lesson step-rail dot drive the clock, not the tablist', () => {
    // The rail's dots carry role="tab", and the ARIA pattern says arrows move between tabs — but
    // this app implements no roving tabindex, so nothing is overridden, and a dead zone exactly
    // where a lesson reader's focus lands after clicking a dot would be worse. If the rail ever
    // gains real tablist keyboard behaviour, THIS is the assertion that must object first.
    const dot = focused('BUTTON', { role: 'tab', ariaSelected: 'true' });
    expect(transportActionFor(press('ArrowRight', { target: dot }))).toBe('stepForward');
  });
});

describe('what the reader is told the keys are', () => {
  /** Every binding, paired with how it is written for a reader. Literal data on BOTH sides,
   *  because "`→` is what `ArrowRight` looks like" is the one correspondence in this feature that
   *  no type and no fold can check — derive it and the pin becomes the map agreeing with itself. */
  const SPELLING: readonly [string, string][] = [
    ['ArrowRight', '→'],
    ['ArrowLeft', '←'],
    ['Home', 'Home'],
    ['End', 'End'],
  ];

  it.each(SPELLING)('%s is shown to the reader as %p', (key, hint) => {
    const action = TRANSPORT_KEYS[key];
    expect(action, `${key} should be bound`).toBeDefined();
    expect(KEY_HINTS[action!]).toBe(hint);
  });

  it('spells every bound key and invents none', () => {
    expect(Object.keys(KEY_HINTS)).toHaveLength(Object.keys(TRANSPORT_KEYS).length);
    // …and the table above covers the whole map, so the `it.each` above is not a sample.
    expect(SPELLING).toHaveLength(Object.keys(TRANSPORT_KEYS).length);
  });

  it('gives every verb a word of its own', () => {
    expect(ACTION_WORDS).toEqual({
      stepForward: 'step',
      stepBack: 'back',
      reset: 'reset',
      runToEnd: 'run',
    });
    // Two verbs sharing a word would make the legend ambiguous about which button it points at.
    expect(new Set(Object.values(ACTION_WORDS)).size).toBe(4);
  });

  it('folds the legend to one entry per binding', () => {
    expect(transportLegend()).toBe('→ step · ← back · Home reset · End run');
  });
});

describe('consumesItsOwnKeys', () => {
  it('is false for no target at all, and for a non-element target', () => {
    expect(consumesItsOwnKeys(null)).toBe(false);
    // `document` / `window` are legitimate event targets with neither property.
    expect(consumesItsOwnKeys({} as unknown as EventTarget)).toBe(false);
  });

  it('matches the tag case-insensitively', () => {
    // Real elements report an uppercase `tagName`; accepting lowercase costs nothing and means a
    // non-HTML (XML/SVG-ish) target cannot slip a text field past the guard.
    expect(consumesItsOwnKeys(focused('input'))).toBe(true);
    expect(consumesItsOwnKeys(focused('Select'))).toBe(true);
    expect(consumesItsOwnKeys(focused('TEXTAREA'))).toBe(true);
  });

  it('does not treat a non-string tagName as a tag', () => {
    expect(consumesItsOwnKeys({ tagName: 3 } as unknown as EventTarget)).toBe(false);
  });
});
