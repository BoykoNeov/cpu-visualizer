/**
 * The DISCOVERABLE half of keyboard clock control (`docs/plans/keyboard-transport.md`, step 1).
 *
 * `keyboard.test.ts` sweeps what each keystroke means. This file asserts the only part of the
 * feature that reaches a reader through `renderToStaticMarkup`: that each clock button says which
 * key does its job, and that a legend lists every binding. The split is not cosmetic — a shortcut
 * nobody can find has the same value as one that was never wired, and of those two failures this
 * suite can only see the second one.
 *
 * What it structurally cannot see, stated rather than implied: `onAction` is never called here,
 * because static rendering does not click and there is no jsdom to dispatch into. So this proves
 * the buttons ADVERTISE the keys; that pressing one moves the clock is step 2's browser pass.
 */

import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TransportButtons } from './App';
import { ACTION_WORDS, KEY_HINTS, TRANSPORT_KEYS, transportLegend } from './keyboard';

const noop = (): void => {};

/** The bar as it renders mid-run, when every verb is live. */
const midRun = (): string =>
  renderToStaticMarkup(<TransportButtons onAction={noop} atStart={false} atEnd={false} />);

const render = (atStart: boolean, atEnd: boolean): string =>
  renderToStaticMarkup(<TransportButtons onAction={noop} atStart={atStart} atEnd={atEnd} />);

/** The buttons in reading order, each paired with the title it must carry — written out as
 *  LITERAL copy, so a key that gets remapped without its hint being updated fails here. */
const TITLES: readonly [string, string][] = [
  ['⏮ reset', 'Back to start (Home)'],
  ['◀ back', 'Step back one cycle (←)'],
  ['step ▶', 'Step forward one cycle (→)'],
  ['run ⏭', 'Run to completion (End)'],
];

describe('each clock button names the key that does its job', () => {
  it.each(TITLES)('%s is titled %p', (face, title) => {
    const html = midRun();
    expect(html).toContain(`title="${title}"`);
    expect(html).toContain(face);
  });

  it('renders exactly four buttons, in reading order', () => {
    const faces = [...midRun().matchAll(/<button[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(faces).toEqual(TITLES.map(([face]) => face));
  });

  it('spells every button face with the same word its key hint uses', () => {
    // The legend's job is to point at a button. It cannot do that if the button says "advance"
    // and the hint says "step", so both draw the word from one place — asserted on the render,
    // not on the map, because the map agreeing with itself proves nothing.
    const html = midRun();
    for (const word of Object.values(ACTION_WORDS)) {
      expect(html).toContain(word);
    }
  });
});

describe('the legend lists every binding', () => {
  it('renders the legend, spelled as the reader will press it', () => {
    expect(midRun()).toContain('→ step · ← back · Home reset · End run');
  });

  it('shows a hint for every bound key — a binding cannot ship invisible', () => {
    // The net that matters when a fifth shortcut is added: the legend is folded over
    // TRANSPORT_KEYS, so the new key's hint has to appear in the rendered markup.
    const html = midRun();
    for (const action of Object.values(TRANSPORT_KEYS)) {
      expect(html).toContain(KEY_HINTS[action]);
    }
    expect(transportLegend().split(' · ')).toHaveLength(Object.keys(TRANSPORT_KEYS).length);
  });

  it('carries the class the stylesheet hides it by, at the width that was measured', () => {
    // The legend is 251px in a wrapping flex row inside a `position: sticky` bar. Measured in the
    // browser on out-of-order mid-run: one line at 1024px, two at 900px, and removing the legend
    // at 900px puts it back to one — so it is the cause. A second line is 23px of permanently
    // eaten viewport on every scroll.
    //
    // Neither half of that fix is visible to `renderToStaticMarkup` — it renders no stylesheet —
    // so this asserts the two halves still refer to each other: the class is on the element, and a
    // max-width rule in the sheet names it. Delete either and this fails; the browser rig is what
    // proves the rule actually stops the wrap.
    expect(midRun()).toContain('class="transport-keys"');
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const block = /@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/.exec(css);
    expect(block, 'styles.css should carry a max-width media block').not.toBeNull();
    expect(Number(block![1])).toBe(1023); // the measured threshold, not a round guess
    expect(block![2]).toContain('.transport-keys');
    expect(block![2]).toContain('display: none');
  });

  it('says the same thing at every point in the run — no per-step reflow', () => {
    // The legend names keys, not state. Pinned because this bar is sticky at the top of the
    // viewport: a caption that changed width or wrapped as the cursor moved would shove the
    // buttons under the reader's mouse, which is the jitter class this repo has already paid for
    // once across five panels.
    const legend = '→ step · ← back · Home reset · End run';
    for (const html of [render(true, false), render(false, false), render(false, true)]) {
      expect(html).toContain(legend);
    }
  });
});

describe('a button is dead exactly where its verb is', () => {
  /** The faces of the buttons rendered `disabled` (React writes the boolean as `disabled=""`). */
  const dead = (html: string): string[] =>
    [...html.matchAll(/<button([^>]*)>([^<]*)</g)]
      .filter((m) => m[1]!.includes(' disabled'))
      .map((m) => m[2]!);

  it('pre-run, only the two backward verbs are dead', () => {
    expect(dead(render(true, false))).toEqual(['⏮ reset', '◀ back']);
  });

  it('halted, only the two forward verbs are dead', () => {
    expect(dead(render(false, true))).toEqual(['step ▶', 'run ⏭']);
  });

  it('mid-run, all four are live', () => {
    expect(dead(render(false, false))).toEqual([]);
  });

  it('at a one-cycle-long run, both ends can be true at once and everything is dead', () => {
    // Not hypothetical: the pre-run cursor of an empty/one-cycle recording is both the start and
    // the end. The keys route through the same recorder, which returns null/false at both bounds.
    expect(dead(render(true, true))).toEqual(['⏮ reset', '◀ back', 'step ▶', 'run ⏭']);
  });
});
