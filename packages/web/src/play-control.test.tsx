/**
 * The DISCOVERABLE half of continuous play (`docs/plans/continuous-play.md`, step 2).
 *
 * `playback.test.ts` sweeps what the speeds mean and where the run stops. This file asserts the only
 * part of the feature that reaches a reader through `renderToStaticMarkup`: that the toggle shows
 * the right face, that it is dead exactly where play cannot go, and that every offered speed has an
 * option to pick.
 *
 * ⚠ What it structurally cannot see, stated rather than implied: **no assertion here would notice if
 * `usePlayback` were never called.** There is no jsdom, so nothing clicks and no timer fires; the
 * whole of `usePlayback` — arming, the period, the stop-at-end, the stop-on-re-record — is invisible
 * to this suite by construction. The keyboard feature priced that exact hole at 68 of 68 green with
 * its listener deleted. Step 3's browser pass is the evidence play exists; this is the evidence it
 * can be found.
 */

import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayControl, TransportButtons } from './App';
import { PLAY_SPEEDS, SPEED_LABELS, type PlaySpeed } from './playback';

const noop = (): void => {};

const render = (playing: boolean, canStart: boolean, speed: PlaySpeed = 4): string =>
  renderToStaticMarkup(
    <PlayControl
      playing={playing}
      speed={speed}
      canStart={canStart}
      onToggle={noop}
      onSpeed={noop}
    />,
  );

/** The face of the toggle, and whether it rendered `disabled` (React writes the boolean as
 *  `disabled=""`). One extractor for both, so a test cannot accidentally read the speed `<select>`
 *  and report it as the button. */
const toggle = (html: string): { face: string; dead: boolean } => {
  const m = /<button([^>]*)>([\s\S]*?)<\/button>/.exec(html);
  expect(m, 'PlayControl should render a button').not.toBeNull();
  // The face is read with the INNER MARKUP STRIPPED, because the glyph and the word are separate
  // spans — the stylesheet drops the word below 899px, where the width sweep measured it as the
  // last thing costing the sticky bar a second row. A `([^<]*)` capture would stop at the span and
  // report the face as `▶`, quietly turning every face assertion into a glyph assertion.
  return { face: m![2]!.replace(/<[^>]*>/g, '').trim(), dead: m![1]!.includes(' disabled') };
};

describe('the toggle shows which verb the next click performs', () => {
  it('reads ▶ play when stopped', () => {
    expect(toggle(render(false, true)).face).toBe('▶ play');
  });

  it('reads ⏸ pause when playing', () => {
    expect(toggle(render(true, true)).face).toBe('⏸ pause');
  });

  it('renders exactly ONE button — a toggle, not a play/pause pair', () => {
    // The pinned shape, and it is structural rather than aesthetic: `TRANSPORT_BUTTONS`'s
    // `deadAt: 'start' | 'end'` has no way to express "pause is dead unless playing", so a second
    // button would need a disabled rule the row's own vocabulary cannot state.
    for (const html of [render(false, true), render(true, true), render(false, false)]) {
      expect([...html.matchAll(/<button/g)]).toHaveLength(1);
    }
  });
});

describe('the toggle is dead exactly where play cannot go', () => {
  it('is dead when play could not move from here and is not running', () => {
    // `canStart` is `canPlay(cursor, lastCycle)` — the same predicate the tick stops on. That
    // identity is what makes "a live button whose first tick halts it" impossible.
    expect(toggle(render(false, false)).dead).toBe(true);
  });

  it('is LIVE while playing even where play could not restart', () => {
    // The case a naive `disabled={!canStart}` gets wrong. At the last cycle `canPlay` is already
    // false, so a button disabled on that alone would strand a running clock with no way to pause it
    // — and the reader's only escape would be to wait for the end.
    expect(toggle(render(true, false)).dead).toBe(false);
  });

  it('is live when stopped and there is somewhere to go', () => {
    expect(toggle(render(false, true)).dead).toBe(false);
  });
});

describe('the speed control offers every position', () => {
  it('renders one option per offered speed, with its label', () => {
    const html = render(false, true);
    for (const s of PLAY_SPEEDS) {
      expect(html).toContain(`value="${s}"`);
      expect(html).toContain(SPEED_LABELS[s]);
    }
  });

  it('renders EXACTLY the offered speeds — no orphan option, none missing', () => {
    // `toContain` per speed cannot see a sixth option; this can. The count is read off the render
    // rather than off `PLAY_SPEEDS.length` on both sides, so the artifact is what is being measured.
    const values = [...render(false, true).matchAll(/<option[^>]*value="(\d+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(values).toEqual([...PLAY_SPEEDS]);
  });

  /**
   * Which option carries `selected`. Written as an extractor rather than a `toContain`, and the
   * reason is a caught defect rather than style: this test first asserted `toContain('value="60"')`
   * and **passed vacuously** — `value="60"` is on the `<option>`, which every render emits at every
   * speed. `renderToStaticMarkup` puts the selection on the OPTION as `selected=""`, never on the
   * `<select>` as a `value` attribute, so the only honest question is which option has it.
   */
  const selected = (html: string): number[] =>
    [...html.matchAll(/<option value="(\d+)"([^>]*)>/g)]
      .filter((m) => m[2]!.includes('selected'))
      .map((m) => Number(m[1]));

  it('lights the selected position, and a DIFFERENT one when the speed differs', () => {
    // Two cells with different answers, so a control stuck on one value fails one of them.
    expect(selected(render(false, true, 4))).toEqual([4]);
    expect(selected(render(false, true, 60))).toEqual([60]);
  });

  it('lights exactly one position at every offered speed', () => {
    for (const s of PLAY_SPEEDS) {
      expect(selected(render(false, true, s))).toEqual([s]);
    }
  });

  /**
   * EVERY max-width block in the sheet, as `{ width, rules }` with comments stripped — not
   * `regex.exec(css)`, which returns only the FIRST.
   *
   * That distinction is a defect this file shipped: both CSS assertions below used `exec`, so they
   * only ever saw the 1199 block, and the entire `@media (max-width: 899px)` block that hides the
   * play button's word could be **deleted with all 7248 tests green** — while the narrow-width
   * crossover silently moved 880 → 900px. A measured threshold with no assertion is this repo's
   * "a pinned decision with no net is a comment", one layer down in the stylesheet.
   */
  const mediaBlocks = (): { width: number; rules: string }[] => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    return [...css.matchAll(/@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/g)].map((m) => ({
      width: Number(m[1]),
      // Comments stripped: a check that reads prose as a rule reports the documentation as the
      // defect, and would equally miss a real rule buried in `/* … */`.
      rules: m[2]!.replace(/\/\*[\s\S]*?\*\//g, ''),
    }));
  };

  /** The one block that names `selector`, or undefined — so a test names the rule it means rather
   *  than an index into the file, which any later block would shift. */
  const blockNaming = (selector: string): { width: number; rules: string } | undefined =>
    mediaBlocks().find((b) => b.rules.includes(selector));

  it('hides the play button’s WORD below the width that was measured, keeping its glyph', () => {
    // The second measured threshold, and it had no net at all until this test existed. 899 is where
    // the 1500→620px sweep put the crossover once both captions were already gone: the row holds one
    // line to 880px with play against 760px without it.
    expect(render(false, true)).toContain('class="play-word"');
    const block = blockNaming('.play-word');
    expect(block, 'styles.css should carry a block hiding .play-word').toBeDefined();
    expect(block!.width).toBe(899);
    expect(block!.rules).toContain('display: none');
    // And it is a SECOND block, not the legend's — the two thresholds are different measurements and
    // folding them together would move one of them by editing the other.
    expect(block!.width).not.toBe(blockNaming('.transport-keys')!.width);
  });

  it('the glyph is NOT inside the span the stylesheet hides', () => {
    // Otherwise the narrow-width fix deletes the whole face and the toggle renders empty — the
    // failure that turns "tidy the label" into "remove the control", which no width sweep would
    // report as anything but a narrower row.
    const inside = /<span class="play-word">([^<]*)<\/span>/.exec(render(false, true));
    expect(inside, 'the word should render in its own span').not.toBeNull();
    expect(inside![1]).toBe(' play');
    expect(inside![1]).not.toContain('▶');
    expect(/<span class="play-word">([^<]*)<\/span>/.exec(render(true, true))![1]).toBe(' pause');
  });

  it('carries the class the stylesheet hides its caption by — and the sheet names it', () => {
    // The `transport-keys` treatment, applied because the same trap applies: neither half of a
    // media-query fix is visible to `renderToStaticMarkup`, which renders no stylesheet. A class on
    // an element with no rule anywhere is a HALF-FINISHED decision that looks finished, and this
    // control shipped exactly that for one commit.
    //
    // Note the asymmetry this pins: the word is hidden, the control is not. A `<select>` cannot
    // `display: none` at narrow widths the way the legend does — the reader would lose the ability
    // to choose a speed, not just the label for it.
    expect(render(false, true)).toContain('class="play-speed-label"');
    const block = blockNaming('.play-speed-label');
    expect(block, 'styles.css should carry a block hiding .play-speed-label').toBeDefined();
    expect(block!.width).toBe(1199);
    // The SAME block as the legend's, asserted rather than described: two nearby captions vanishing
    // at two different widths would make the bar's narrow-width behaviour a staircase.
    expect(block!.width).toBe(blockNaming('.transport-keys')!.width);
    expect(block!.rules).toContain('display: none');
  });

  it('keeps the control itself reachable at every width — only the caption is hidden', () => {
    // The rule that must NOT exist. A media rule hiding `.btn` or the `<select>` would take the
    // feature away from narrow viewports rather than tidying it, and the wrap pressure this bar is
    // under makes that a tempting fix at 2am.
    //
    // Comments are STRIPPED before asking, and that is not incidental: this assertion failed on
    // first run against prose in the block explaining why a `<select>` is exactly what must not be
    // hidden. A check that reads a comment as if it were a rule reports the documentation as the
    // defect — and would equally miss a real rule hidden inside `/* … */`.
    // EVERY block, not just the first: a rule taking the control away could be added in any of
    // them, and `exec` would only ever have looked at the 1199 one.
    const blocks = mediaBlocks();
    expect(blocks.length).toBeGreaterThanOrEqual(2); // else the loop below proves nothing
    for (const b of blocks) {
      expect(b.rules, `@media (max-width: ${b.width}px) must not hide a control`).not.toContain(
        'select',
      );
      expect(b.rules).not.toContain('.btn');
    }
    // ...and the comment strip did not eat the rules themselves, which would make the loop vacuous.
    expect(blocks.some((b) => b.rules.includes('display: none'))).toBe(true);
  });

  it('names the speeds in the reader’s own unit', () => {
    // The label vocabulary is pinned in playback.test.ts; this asserts it reaches the DOM, which is
    // the half a constant agreeing with itself cannot prove.
    const html = render(false, true);
    expect(html).toContain('4×/s');
    expect(html).toContain('max');
  });
});

describe('play sits with the clock buttons, before their key legend', () => {
  it('renders between the four buttons and the legend', () => {
    // The order is a decision (see `TransportButtons`'s `children` docblock): the legend is a caption
    // for the KEYED verbs, and play has no key binding. Rendering it after the caption would put it
    // among the things the caption names.
    const html = renderToStaticMarkup(
      <TransportButtons onAction={noop} atStart={false} atEnd={false}>
        <PlayControl playing={false} speed={4} canStart={true} onToggle={noop} onSpeed={noop} />
      </TransportButtons>,
    );
    const runAt = html.indexOf('run ⏭');
    // NOT `indexOf('▶')`: the step button's face is `step ▶`, so the bare glyph finds the WRONG
    // button and reported play as rendering 62 characters before `run ⏭`. Anchor on the play
    // button's own markup — the glyph immediately followed by its word span.
    const playAt = html.indexOf('play-word');
    const legendAt = html.indexOf('→ step');
    expect(runAt).toBeGreaterThan(-1);
    expect(playAt).toBeGreaterThan(runAt);
    expect(legendAt).toBeGreaterThan(playAt);
  });

  it('the four keyed buttons render unchanged when no slot is passed', () => {
    // The regression net for the slot itself: `TransportButtons` grew a `children` prop, and every
    // existing caller and test renders without one. An accidental `children ?? <something>` default
    // would show up here.
    const bare = renderToStaticMarkup(
      <TransportButtons onAction={noop} atStart={false} atEnd={false} />,
    );
    expect(bare).not.toContain('play');
    expect([...bare.matchAll(/<button/g)]).toHaveLength(4);
  });
});

describe('the toggle tells the reader how it differs from `run ⏭`', () => {
  it('its title points at the instant jump as the other tool', () => {
    // The two verbs are genuinely different questions — `run ⏭` teleports, play animates and can be
    // paused mid-flight — and a reader who wants the end of a 50,000-cycle program should not be
    // waiting out `max`. That distinction lives in one place a reader will actually meet it.
    const html = render(false, true);
    expect(html).toContain('run ⏭');
    expect(html).toContain('instantly');
  });

  it('names the selected speed in the title, so the button says what it will do', () => {
    expect(render(false, true, 1)).toContain('1×/s');
    expect(render(false, true, 60)).toContain('max');
  });

  it('says something different when it is a pause', () => {
    expect(render(true, true)).toContain('Pause');
    expect(render(true, true)).not.toContain('instantly');
  });
});
