/**
 * The cache grid's RENDER seam (M6 step 6). The fold owns every claim about the view-model
 * (`cache-grid.test.ts`); this owns only what a pure fold structurally cannot see — that the states
 * reach the DOM as WORDS, not hue alone (the relief rule), that the freeze countdown is drawn, and
 * that the panel is absent when there is no cache. Layout remains a browser eyeball, as ever.
 */

import { toProgramImage } from '@cpu-viz/engine-common';
import { assemble } from '@cpu-viz/assembler';
import { CACHE_SMALL, PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { defaultConfig, type CycleTrace } from '@cpu-viz/trace';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CacheGrid } from './CacheGridView';
import { EXAMPLE_PROGRAMS } from './programs';

function record(): readonly CycleTrace[] {
  const prog = EXAMPLE_PROGRAMS.find((p) => p.name === 'array-sum-twice')!;
  const p = new PipelineProcessor();
  const { program } = assemble(prog.source);
  p.reset(toProgramImage(program!), { ...defaultConfig(), cache: CACHE_SMALL });
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) traces.push(p.step());
  return traces;
}

const traces = record();
const render = (cycle: number | null) =>
  renderToStaticMarkup(
    <CacheGrid trace={cycle === null ? null : (traces[cycle] ?? null)} cache={CACHE_SMALL} />,
  );

describe('the cache grid render seam', () => {
  it('renders nothing when no cache is configured', () => {
    // The panel is a cache view; with nothing to show it must not draw an empty box.
    expect(renderToStaticMarkup(<CacheGrid trace={traces[11] ?? null} cache={null} />)).toBe('');
  });

  it('draws the geometry and a row per line', () => {
    const html = render(0);
    expect(html).toContain('direct-mapped');
    expect(html).toContain('2 lines × 16 B');
    expect((html.match(/cache-line cache-line--/g) ?? []).length).toBe(2); // one row per line
  });

  it('labels each state with its WORD, never hue alone (the relief rule)', () => {
    // The miss cycle, the freeze, the hit, and the eviction each spell their state out.
    expect(render(11)).toContain('MISS');
    expect(render(12)).toContain('FILLING');
    expect(render(32)).toContain('HIT');
    expect(render(119)).toContain('EVICT');
    // And the legend keys all four, so a hue met on a line has a word to resolve it against.
    const legend = render(0);
    for (const word of ['hit', 'miss', 'evict', 'filling']) expect(legend).toContain(word);
  });

  it('draws the freeze countdown, so the panel stays live through a miss penalty', () => {
    // The load-bearing decision: without this the grid would go dark for the ~10 penalty cycles. The
    // caption carries the remaining count, and it decreases as the stall proceeds.
    const early = render(12);
    const late = render(20);
    expect(early).toContain('9 cycles left');
    expect(late).toContain('1 cycle left'); // singular, and a different number — the countdown moves
  });

  it('names the evicted block and the address that maps in', () => {
    const html = render(119);
    expect(html).toContain('0x10000020'); // the accessed block
    expect(html).toContain('evicted 0x10000000'); // the block kicked out
  });

  it('shows the resident block as a byte range, the human form of a tag', () => {
    // A warm line names what it holds as 0x…–0x…, not the raw (huge) tag number.
    expect(render(32)).toContain('0x10000000–0x1000000f');
    expect(render(32)).not.toContain('8388608'); // the raw tag never surfaces
  });

  it('says nothing happened on an idle cycle rather than leaving the caption blank', () => {
    // Cycle 0: cold cache, no access. The caption must state that, not vanish.
    expect(render(0)).toContain('no memory access this cycle');
  });
});
