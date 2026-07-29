/**
 * **Value labels that land on component boxes — M13 review, finding 2.**
 *
 * `layoutLabels` (in `DatapathDiagram.tsx`) de-collides a value label by searching in **y only**:
 * ±160 units in 4-unit steps. When no clear y exists it **places the label anyway**, on whatever it
 * collided with, and says nothing. There is no horizontal escape.
 *
 * `m13-tasks.md` handed that forward with the claim that _"step 9's corridor fix removes the only
 * case in this repo that reaches the fallback"_. Measured by instrumenting the fallback branch, that
 * is false: **one to three distinct labels reach it at every width**, on the superscalar AND on the
 * five-stage pipeline datapath, which M13 never opened. It is a long-standing property of the shared
 * renderer, not a residue of step 9's corridor.
 *
 * **Most of those are harmless and one is not, and the split is what this file pins.** Nearly all
 * are corner clips of a few units — `exmem-dmem-addr` clips `exmem` by 4 of 70, `regfile-idex-a-l1`
 * clips `idex` by 5 of 64 — which is why finding 2 is graded on the note rather than the pixels.
 * Exactly one label is genuinely BURIED, at width 4 only; see {@link KNOWN_BURIED}.
 *
 * So the net is not "no label ever touches a box" — that is red today and would have to be
 * suppressed, which is how a check becomes decoration. It is an ENUMERATION of the buried ones: a
 * new collision reddens because it is not in the set, and the known one getting worse reddens
 * because its measurement is part of its identity string.
 *
 * **It is also, incidentally, the first real net under step 9's own corridor fix.** Reverting
 * `IFID_CORRIDOR` to its pre-step-9 value reddens this with **452 buried labels** — every fetched
 * encoding straddling the IF/ID bar and the instruction memory, which is exactly the picture step 9
 * was sent to look for. The milestone recorded that breaking that fix reddened "exactly 2 of 1551",
 * and neither of those two named the defect.
 *
 * ## Why this reads the RENDERED SVG rather than calling `layoutLabels`
 *
 * Because `layoutLabels` is not what ships — its OUTPUT is, after the component turns placements
 * into `<rect>`s. This repo has now twice written a pure-data test of a view and found it green on a
 * broken render (step 7's closing pass, and step 8's own non-vacuity clause one width later). The
 * geometry a reader complains about is the geometry in the markup, so that is what is measured: label
 * boxes are `rect.dp-vlabel-box`, component boxes are `rect.dp-node-shape`.
 *
 * Mux and adder nodes render as `<polygon>` and are therefore out of scope here. That is a real
 * limit, stated rather than hidden — but the measured offenders are all plain boxes, so the check
 * covers what the finding is about.
 */

import { SuperscalarProcessor } from '@cpu-viz/engine-superscalar';
import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { DEPTH_TIERS } from '@cpu-viz/curriculum';
import { defaultConfig, type Processor, type ProcessorConfig } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { showValueLabels } from './datapath-superscalar';
import { SuperscalarDatapath } from './SuperscalarDatapathView';
import { PipelineDatapath } from './PipelineDatapathView';
import { EXAMPLE_PROGRAMS } from './programs';
import { loadSource } from './simulator';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The text drawn in this box's `<g>` — what makes a failure message name the offender. */
  text: string;
}

/**
 * Every `<rect>` carrying `cls`, as boxes, paired with the text in its own `<g>`.
 *
 * Split on `<g` rather than parsed properly because the markup is React's own and the shapes here
 * are one rect + its texts per group. The regex reads each attribute by NAME, so React reordering
 * its output cannot silently return zero matches — which would make every assertion below vacuously
 * true, and is why the callers assert a nonzero parse before anything else.
 */
function parseBoxes(html: string): { labels: Box[]; boxes: Box[] } {
  const labels: Box[] = [];
  const boxes: Box[] = [];
  for (const g of html.split('<g')) {
    const tag = /<rect[^>]*>/.exec(g);
    if (!tag) continue;
    const s = tag[0];
    const isLabel = s.includes('dp-vlabel-box');
    if (!isLabel && !s.includes('dp-node-shape')) continue;
    const num = (name: string): number | null => {
      const m = new RegExp(`\\b${name}="(-?[\\d.]+)"`).exec(s);
      return m?.[1] === undefined ? null : Number(m[1]);
    };
    const [x, y, w, h] = [num('x'), num('y'), num('width'), num('height')];
    if (x === null || y === null || w === null || h === null) continue;
    const text = [...g.matchAll(/>([^<>]+)<\/text>/g)].map((m) => m[1]).join('/');
    (isLabel ? labels : boxes).push({ x, y, w, h, text });
  }
  return { labels, boxes };
}

/** How deep `a` sits inside `b`, along whichever axis it penetrates LEAST — 0 when they are apart.
 *  The min is what "buried" means: a label clipping a corner overlaps a lot in one axis and barely
 *  in the other, while a label sitting ON a box overlaps deeply in both. */
function penetration(a: Box, b: Box): number {
  const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return dx <= 0 || dy <= 0 ? 0 : Math.min(dx, dy);
}

/** Every (label, box) pair in one render where the label is BURIED, as an identity string carrying
 *  its own measurement — so a set comparison reports both "a new one appeared" and "this one got
 *  worse" without a second assertion. */
function buriedIn(labels: Box[], boxes: Box[], tag: string): string[] {
  const out: string[] = [];
  for (const l of labels) {
    for (const b of boxes) {
      if (penetration(l, b) < BURIED) continue;
      const dx = Math.min(l.x + l.w, b.x + b.w) - Math.max(l.x, b.x);
      out.push(`${tag}: "${l.text}" ${dx.toFixed(0)}/${l.w.toFixed(0)} into ${b.text}`);
    }
  }
  return out;
}

/**
 * Every pair of value labels in one render that OVERLAP EACH OTHER at all.
 *
 * `layoutLabels`' contract has always been "a label never obscures another label **or** sits on top
 * of a box", and until the M13 review this file measured only the second half. That gap became
 * load-bearing the moment the horizontal escape landed: placement is ORDER-DEPENDENT (`clear()`
 * tests against labels already placed), so a label that escapes sideways occupies space a later one
 * would have used, and the later one can be pushed somewhere it previously fit. **A fix for
 * label-on-box that traded it for label-on-label would have been invisible here.**
 *
 * The threshold is ZERO rather than {@link BURIED}: two labels are both text, so any overlap makes
 * one of them wrong, where a label clipping the corner of a box is merely untidy.
 */
function labelPairs(labels: Box[], tag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]!;
      const b = labels[j]!;
      const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (dx <= 0 || dy <= 0) continue;
      out.push(`${tag}: "${a.text}" ∩ "${b.text}" ${dx.toFixed(0)}x${dy.toFixed(0)}`);
    }
  }
  return out;
}

function record(
  make: () => Processor,
  config: ProcessorConfig,
  source: string,
): readonly unknown[] {
  const r = loadSource(source, make, config);
  if (!r.ok) throw new Error('assembly failed');
  r.loaded.recorder.runToEnd();
  return r.loaded.recorder.recorded;
}

/**
 * What counts as BURIED rather than merely touching. A label box is 14 units tall, so a penetration
 * of 14 means the label is vertically inside the box outright and (since penetration is the smaller
 * axis) at least 14 units into it horizontally too. 12 sits just under that, so a corner clip does
 * not trip it and a label sitting IN a box does.
 *
 * The measured encroachments this review found are far below it — `exmem-dmem-addr` clips `exmem` by
 * 4 units of a 70-unit label, `regfile-idex-a-l1` clips `idex` by 5 of 64 — which is why finding 2
 * is graded on the note rather than the pixels.
 */
const BURIED = 12;

/**
 * The tiers that draw value labels at all — DERIVED from `showValueLabels`, not listed.
 *
 * `essentials` renders none, so sweeping it was a third of the runtime spent rendering nothing this
 * file can see, and it also inflated the render count while contributing zero to the `labels > 0`
 * clause that keeps the sweep honest. Derived rather than written as `['detailed', 'expert']`
 * because a future tier that starts showing values must join the sweep automatically — the same rule
 * every width-derived list in this milestone follows.
 */
const LABELLED_TIERS = DEPTH_TIERS.filter(showValueLabels);

/**
 * **The buried set is EMPTY, and it took an image to learn that it should be.**
 *
 * The review first graded this case LOW from its number: 16 units of a 70-unit label box, which
 * reads exactly like a corner clip. The 5x crop of the shipped bundle showed something else — the
 * EX/MEM latch bar crossing the MIDDLE of a branch target, rendering `0x0000000c` as `0x0000###c`,
 * a hex value a reader cannot recover. **A signed overlap is a pointer, not a verdict**, and this
 * one pointed the wrong way.
 *
 * The case was `call-return` at cycle 6, width 4, on the `alu-pcmux` lane-0 wire — and the rig took
 * three wrong guesses at the program before that was DUMPED rather than reasoned. It is fixed by
 * `layoutLabels`' horizontal escape (see its docblock), which runs only on the path that had already
 * given up in y, so no label that finds a clear y can move.
 *
 * The list stays here, empty, rather than the assertion becoming `toEqual([])` inline: an empty
 * named constant says "this was measured to be empty", where a bare literal says nothing about
 * whether anyone looked.
 */
const KNOWN_BURIED: string[] = [];

describe('no value label is buried in a component box (M13 review finding 2)', () => {
  const sweep = (
    make: () => Processor,
    render: (trace: unknown, tier: string, forwarding: boolean, width: number) => string,
    widths: number[],
  ): { buried: Set<string>; overlaps: Set<string>; renders: number; labels: number } => {
    const buried = new Set<string>();
    const overlaps = new Set<string>();
    let renders = 0;
    let labels = 0;
    for (const p of EXAMPLE_PROGRAMS) {
      for (const width of widths) {
        // One cache setting, deliberately: the cache moves WHEN a value label appears, never where
        // `layoutLabels` can put it — placement is a pure function of the geometry and the label's
        // own text width. Sweeping it doubled the runtime and added no reachable placement, which
        // was measured rather than assumed (the offender set is identical with and without it).
        for (const [forwarding, cache] of [[true, null]] as const) {
          const cfg: ProcessorConfig = { ...defaultConfig(), forwarding, cache, issueWidth: width };
          for (const trace of record(make, cfg, p.source)) {
            for (const tier of LABELLED_TIERS) {
              const parsed = parseBoxes(render(trace, tier, forwarding, width));
              renders++;
              labels += parsed.labels.length;
              for (const b of buriedIn(parsed.labels, parsed.boxes, `w${width} ${tier}`)) buried.add(b); // prettier-ignore
              for (const o of labelPairs(parsed.labels, `w${width} ${tier}`)) overlaps.add(o);
            }
          }
        }
      }
    }
    return { buried, overlaps, renders, labels };
  };

  it('the superscalar datapath, at every width the control offers', () => {
    const { buried, overlaps, renders, labels } = sweep(
      () => new SuperscalarProcessor(),
      (trace, tier, forwarding, width) =>
        renderToStaticMarkup(
          <SuperscalarDatapath
            trace={trace as never}
            cycleKey={0}
            tier={tier as never}
            config={{ forwarding, predictTaken: false, issueWidth: width }}
            followed={null}
          />,
        ),
      [1, 2, 3, 4],
    );
    // Non-vacuity, both halves and BEFORE the claim. Zero renders or a selector typo yielding zero
    // labels would leave `buried` empty and pass — which is exactly how this file becomes decoration.
    expect(renders, 'nothing rendered').toBeGreaterThan(0);
    expect(labels, 'no value labels were parsed — check the selectors').toBeGreaterThan(0);
    expect([...buried].sort(), 'the set of buried labels moved').toEqual([...KNOWN_BURIED].sort());
    // The other half of layoutLabels' contract, and the one the horizontal escape could have
    // traded FOR the first: placement is order-dependent, so a label that steps sideways takes
    // room a later one would have used. Measured at zero both before and after the escape landed.
    expect([...overlaps].slice(0, 5), 'two value labels overlap each other').toEqual([]);
  });

  it('...and the five-stage pipeline, which shares the renderer and predates the width axis', () => {
    // Swept because the finding is about the SHARED renderer, not about M13: this datapath reaches
    // the same silent fallback on a label the width axis never touched. Its clips are all corner
    // clips, so its buried set is EMPTY — which is the honest form of "M3's are the small ones".
    const { buried, overlaps, renders, labels } = sweep(
      () => new PipelineProcessor(),
      (trace, tier, forwarding) =>
        renderToStaticMarkup(
          <PipelineDatapath
            trace={trace as never}
            cycleKey={0}
            tier={tier as never}
            config={{ forwarding, predictTaken: false }}
            followed={null}
          />,
        ),
      [1],
    );
    expect(renders, 'nothing rendered').toBeGreaterThan(0);
    expect(labels, 'no value labels were parsed — check the selectors').toBeGreaterThan(0);
    expect([...buried].sort(), 'the five-stage grew a buried label').toEqual([]);
    expect([...overlaps].slice(0, 5), 'two value labels overlap each other').toEqual([]);
  });
});
