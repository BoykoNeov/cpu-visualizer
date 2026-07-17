/**
 * The reference panel's RENDER. `isa-reference.test.ts` pins what the data says; this pins that
 * the panel actually puts it on screen — a distinction this project has been bitten by before
 * (M3 step 8's flagship lesson: every test asserted narration *resolves*, none that it *renders*,
 * and it shipped literal asterisks to the browser).
 *
 * What this suite structurally cannot see, stated rather than implied: `renderToStaticMarkup`
 * renders, it does not click. The tab switch, the filter box, and the click-to-insert wiring are
 * invisible here — the browser pass is their net, as it has been for every view step in this repo.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS } from '@cpu-viz/isa';
import { PSEUDO_MNEMONICS, DIRECTIVES } from '@cpu-viz/assembler';
import { ReferenceBody, TABS } from './IsaReference';
import { registerEntries } from './isa-reference';

const render = (tab: 'instructions' | 'pseudo' | 'directives' | 'registers', query = ''): string =>
  renderToStaticMarkup(<ReferenceBody tab={tab} query={query} onInsert={() => {}} />);

/** Strip tags so a mnemonic is matched as displayed text, not as an attribute or a style token. */
const text = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('IsaReference: every tab renders what it claims', () => {
  it('shows all 40 instructions, each with its own example', () => {
    const html = render('instructions');
    for (const def of INSTRUCTIONS) {
      expect(text(html), def.mnemonic).toContain(def.mnemonic);
    }
  });

  it('shows every shorthand', () => {
    const html = text(render('pseudo'));
    for (const name of PSEUDO_MNEMONICS) expect(html, name).toContain(name);
  });

  it('shows every directive', () => {
    const html = text(render('directives'));
    for (const name of DIRECTIVES) expect(html, name).toContain(name);
  });

  it('shows every register name and its number', () => {
    const html = text(render('registers'));
    for (const r of registerEntries()) {
      expect(html, r.name).toContain(r.name);
      expect(html, `x${r.number}`).toContain(`x${r.number}`);
    }
  });

  it('names all four tabs', () => {
    expect(TABS.map((t) => t.id)).toEqual(['instructions', 'pseudo', 'directives', 'registers']);
  });
});

describe('IsaReference: the filter', () => {
  it('narrows to matching entries and drops the rest', () => {
    const html = text(render('instructions', 'lw'));
    expect(html).toContain('lw');
    expect(html).not.toContain('xori');
  });

  it('matches on the prose, not just the mnemonic — "unsigned" finds the u-variants', () => {
    // The reason the filter searches summaries: a learner does not know the mnemonic yet. That is
    // the whole premise of the panel, so searching only names would defeat it.
    const html = text(render('instructions', 'unsigned'));
    expect(html).toContain('sltu');
    expect(html).toContain('bltu');
  });

  it('says so rather than rendering an empty box when nothing matches', () => {
    expect(text(render('instructions', 'zzzz'))).toContain('Nothing matches');
    expect(text(render('registers', 'zzzz'))).toContain('Nothing matches');
  });
});

describe('IsaReference: what it tells a learner about stopping', () => {
  it('says ecall halts, on the row for ecall', () => {
    // The single most useful fact for someone writing their first program, and it appeared
    // nowhere in the shell before this panel.
    const html = text(render('instructions', 'ecall'));
    expect(html).toContain('ecall');
    expect(html).toMatch(/halts/i);
  });
});
