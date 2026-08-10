/**
 * **Layout stability — no panel may change HEIGHT as the cursor moves.**
 *
 * The shell is a vertical stack, so a panel that resizes on a step shoves every surface below it up
 * or down the page. A reader stepping the clock is comparing one cycle's picture against the last
 * one's, and a picture that relocates under them on the step is the surface failing at the one thing
 * it was added for. Config changes are a different matter and are explicitly NOT covered here: the
 * width toggle, the depth dial and picking a lesson are deliberate acts, and a panel is allowed to
 * resize on them (the same line the narration panel's own note draws).
 *
 * ## What these tests can and cannot see, and why they are shaped like this
 *
 * Headless tests here are `renderToStaticMarkup` with no jsdom, so **no test in this repo can see a
 * height**. That is not a gap to apologise for, it is the constraint that dictates the design: each
 * guard asserts a STRUCTURAL PROXY that determines the height, measured on the rendered markup, at
 * every cursor of a real recording including the pre-run one. The heights themselves were measured in
 * the shipped `vite preview` bundle at 1400px and 980px on 2026-07-30, and the numbers each fix is
 * worth are recorded on the fix.
 *
 * Two failure modes are designed against, both of which this repo has shipped before:
 *
 *  - **Count on the RENDER, never on the fold.** A guard that asks `microReserves(...)` what it
 *    reserved, or `readPairing(...)` how many candidates there were, agrees with itself while the
 *    component renders something else entirely. Where a fold appears below it is only ever the
 *    EXPECTED value; the actual always comes out of the markup string.
 *  - **Assert the floor, not only the equality.** "The same at every cursor" is what a panel that
 *    renders nothing at all satisfies most easily — zero is very stable. Every guard therefore pins a
 *    non-zero reserve as well as its constancy, and pins that the run really does exercise the thing
 *    (a recording with no refusal in it proves nothing about reserving space for one).
 */

import { toProgramImage } from '@cpu-viz/engine-common';
import { assemble } from '@cpu-viz/assembler';
import { CACHE_LARGE, CACHE_SMALL, PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { OutOfOrderProcessor } from '@cpu-viz/engine-out-of-order';
import { ScoreboardProcessor } from '@cpu-viz/engine-scoreboard';
import { SuperscalarProcessor } from '@cpu-viz/engine-superscalar';
import { SingleCycleProcessor } from '@cpu-viz/engine-single-cycle';
import {
  defaultConfig,
  TraceRecorder,
  type CacheConfig,
  type CycleTrace,
  type Processor,
  type ProcessorConfig,
} from '@cpu-viz/trace';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { shownInstruction, TransportReadout } from './App';
import { readoutReserve } from './transport-readout';
import { CacheGrid } from './CacheGridView';
import { MicroTablePanel } from './MicroTablePanel';
import { PairingReadout } from './PairingReadoutView';
import { PredictorTable } from './PredictorTableView';
import { ScoreboardTables } from './ScoreboardTablesView';
import { SuperscalarDatapath } from './SuperscalarDatapathView';
import { MemoryPanel, peakDataMemoryRows } from './panels';
import { readPairing } from './pairing-readout';
import { EXAMPLE_PROGRAMS } from './programs';
import { loadSource } from './simulator';

const noop = (): void => {};

/** How many times `needle` occurs in `haystack` — a count taken off the RENDER, never off a fold. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function record(
  name: string,
  config: ProcessorConfig,
  factory: () => Processor,
): readonly CycleTrace[] {
  const source = EXAMPLE_PROGRAMS.find((p) => p.name === name)!.source;
  const result = loadSource(source, factory, config);
  if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
  result.loaded.recorder.runToEnd();
  return result.loaded.recorder.recorded;
}

/** Every cursor the transport can be at, in order: the pre-run one, then one per recorded cycle. */
function cursors(recording: readonly CycleTrace[]): (CycleTrace | null)[] {
  return [null, ...recording];
}

/** The distinct values of `f` over every cursor — size 1 means "did not change as you stepped". */
function distinct<T>(values: readonly T[]): Set<string> {
  return new Set(values.map((v) => JSON.stringify(v)));
}

// ---------------------------------------------------------------------------------------------
// The out-of-order structures panel — the largest jump in the shell (526.6px, measured).
// ---------------------------------------------------------------------------------------------

describe('out-of-order structures: present at every cursor, reserved identically', () => {
  const OOO: ProcessorConfig = {
    ...defaultConfig(),
    issueWidth: 2,
    outOfOrderIssue: true,
    branchPrediction: 'static-taken',
    cache: CACHE_LARGE,
    robSize: 16,
  };
  const recorded = record('array-sum', OOO, () => new OutOfOrderProcessor());
  const htmls = cursors(recorded).map((trace) =>
    renderToStaticMarkup(
      <MicroTablePanel
        trace={trace}
        recording={recorded}
        followed={null}
        onFollow={noop}
        scheme={OOO.branchPrediction}
      />,
    ),
  );

  it('the panel is never absent — including at the pre-run cursor', () => {
    // The floor. `''` at any cursor is the defect: a panel that leaves the flow reserves nothing, and
    // this one is over half a screen tall. Note the first entry IS the pre-run cursor.
    expect(htmls).not.toHaveLength(0);
    for (const html of htmls) expect(html).toContain('Reorder buffer');
    expect(htmls[0]).toContain('Reorder buffer');
  });

  it('the three table reserves are the same at every cursor', () => {
    // The reserves reach the DOM as `min-height` declarations; three of them, one per table.
    const reserves = htmls.map((html) =>
      [...html.matchAll(/min-height:(\d+(?:\.\d+)?)px/g)].map((m) => m[1]),
    );
    // Non-vacuity first: there really are three reserves and none is zero. Without this, a build that
    // stopped reserving entirely would satisfy the constancy check below with three absences.
    expect(reserves[0]).toHaveLength(3);
    for (const value of reserves[0]!) expect(Number(value)).toBeGreaterThan(0);
    expect(distinct(reserves).size).toBe(1);
  });

  it('the pre-run cursor states the real ROB CAPACITY, not a zero it has not measured', () => {
    // `preRunMicro` copies `robCapacity` off the recording precisely so this line is true at cursor
    // −1, and nothing pinned it: returning `robCapacity: 0` left the whole web suite green, and the
    // panel then read "0/0 in flight" for a sixteen-entry buffer (M14 review, finding 4). No height
    // moves — the three `min-height`s come from `microReserves(recording)`, which does not depend on
    // the cursor's micro at all — so this is a wrong FACT rather than a returning jump, and the only
    // guard against it is to read the caption.
    expect(
      htmls[0],
      'the pre-run header must state the capacity the run was recorded at',
    ).toContain(`0/${OOO.robSize!} in flight`);
    // Non-vacuity: the number has to be one this recording could not have produced by accident, so
    // assert the config really asked for something other than the engine's own default of 16... it
    // does not, and saying so is the honest form — what makes this non-vacuous instead is that a
    // capacity of 0 is what the mutation produces, and `0/0` differs from `0/16`.
    expect(OOO.robSize, 'the fixture must declare a capacity for the caption to be about').toBe(16);
  });

  it('...while the CONTENT it holds genuinely varies, so the reserve is doing work', () => {
    // The other half of the non-vacuity: a panel whose rows never changed would hold its height for
    // free. The ROB fills and drains across this run.
    const rows = htmls.map((html) => count(html, 'ROB#'));
    expect(Math.max(...rows)).toBeGreaterThan(Math.min(...rows));
    expect(Math.min(...rows)).toBe(0); // the pre-run cursor, and the drained tail
  });
});

// ---------------------------------------------------------------------------------------------
// The issue readout — 98.8px → 198.3px at width 4 (measured), the second-largest jump.
// ---------------------------------------------------------------------------------------------

describe('issue readout: the reserve covers every shape the recording reaches', () => {
  const WIDE: ProcessorConfig = { ...defaultConfig(), forwarding: true, issueWidth: 4 };
  const recorded = record('array-sum', WIDE, () => new SuperscalarProcessor());
  const all = cursors(recorded);
  const htmls = all.map((trace) =>
    renderToStaticMarkup(<PairingReadout trace={trace} recording={recorded} followed={null} />),
  );
  /** The live candidate count at a cursor — the EXPECTED value, so the actual can come off the markup. */
  const live = (trace: CycleTrace | null): number =>
    trace === null ? 0 : (readPairing(trace)?.candidates.length ?? 0);

  it('the ghost rows are the same at every cursor, and there are some', () => {
    // Every candidate row is an `<li>`, ghosts included, so the ghost count is what is left when the
    // live ones are taken off the total. It must not depend on where the cursor is.
    const ghosts = all.map((trace, i) => count(htmls[i]!, '<li') - live(trace));
    expect(distinct(ghosts).size).toBe(1);
    // The floor: a reserve of zero is what the unfixed panel had, and it is perfectly constant.
    expect(ghosts[0]).toBeGreaterThan(0);
    // ...and it is big enough to cover the tallest cycle, which is the property that makes it a
    // reserve rather than merely some extra rows.
    expect(ghosts[0]).toBeGreaterThanOrEqual(Math.max(...all.map(live)));
  });

  it('the candidate count really does vary across the run', () => {
    // Non-vacuity: on a recording where every cycle held the same number of candidates there would be
    // nothing to reserve against, and the guard above would pass for free.
    const counts = all.map(live);
    expect(new Set(counts).size).toBeGreaterThan(1);
    expect(Math.max(...counts)).toBeGreaterThan(1);
  });

  it("an empty decode still reserves the list's height, message and all", () => {
    const idle = all.findIndex((t) => t !== null && live(t) === 0);
    expect(idle).toBeGreaterThan(0); // the run really does have an empty-decode cycle
    expect(htmls[idle]).toContain('Decode is empty this cycle');
    // `Candidates` still swaps its own `<ul>` for that one-line `<p>` when there is nothing to list,
    // and it is allowed to: the swap happens INSIDE the reserved cell, where the ghosts are already
    // holding the height. This is what pins that — an empty-decode cursor still renders a list, from
    // the reserve. Unfixed, the whole cell was one line of text here.
    expect(htmls[idle]).toContain('<ul');
    expect(count(htmls[idle]!, '<li')).toBeGreaterThan(0);
  });

  it('the reserve does not GROW with the run — ghosts are shape classes, not cycles', () => {
    // A reserve is only free if it is bounded. Keyed on every distinct instruction tuple, the ghost
    // stack grew one class per candidate row: measured at 802 rows and 455KB of markup for this one
    // panel on a straight-line 800-instruction program, re-rendered on every step — the failure
    // `MAX_MAP_CYCLES` exists for, from the same trigger (something a sandbox user can type).
    const straight = (n: number): string =>
      `${Array.from({ length: n }, (_, i) => `  addi x${(i % 30) + 1}, x0, ${i}`).join('\n')}
  li a7, 10
  ecall
`;
    const rows = [200, 800].map((n) => {
      const r = loadSource(straight(n), () => new SuperscalarProcessor(), WIDE);
      if (!r.ok) throw new Error('fixture failed to assemble');
      r.loaded.recorder.runToEnd();
      const rec = r.loaded.recorder.recorded;
      return {
        cycles: rec.length,
        li: count(
          renderToStaticMarkup(
            <PairingReadout trace={rec[rec.length - 1]!} recording={rec} followed={null} />,
          ),
          '<li',
        ),
      };
    });
    // The runs really are different lengths — otherwise "the reserve did not grow" is trivially true.
    expect(rows[1]!.cycles).toBeGreaterThan(rows[0]!.cycles * 2);
    expect(rows[1]!.li).toBe(rows[0]!.li);
    // ...and small in absolute terms, not merely equal: the class count is bounded by the verdicts
    // times the reasons times the width squared, which is a constant, not a function of the program.
    expect(rows[1]!.li).toBeLessThan(60);
  });

  it('each reserved shape is the WIDEST member of its class — the rule the bound rests on', () => {
    // The bound above (a handful of classes, not one per cycle) is only safe because the ghost kept
    // for a class is its TALLEST member: a row wraps on its own length, so the widest candidate is
    // what decides whether a shape needs two lines. Deleting that rule — keeping whichever member
    // came first — left the whole web suite green (M14 review, finding 3).
    //
    // Measured off the RENDER on both sides of the comparison's actual value: each hidden ghost block
    // is parsed for the candidate rows it draws, and its widest one is what the reserve is worth. The
    // per-class maximum from the recording is the EXPECTED value, which is the only place a fold is
    // allowed here.
    const GHOST = '<div style="grid-area:1 / 1;visibility:hidden">';
    const LIVE = '<div style="grid-area:1 / 1">';
    /** The widest candidate row drawn inside each hidden ghost, off the markup. The text is the span
     *  that FOLLOWS the slot chip, which is a structural relationship rather than a color match. */
    const drawnWidths = (html: string): number[] =>
      html
        .split(GHOST)
        .slice(1)
        .map((chunk) => {
          const own = chunk.includes(LIVE) ? chunk.slice(0, chunk.indexOf(LIVE)) : chunk;
          const texts = [...own.matchAll(/slot \d+<\/span><span[^>]*>([^<]*)<\/span>/g)].map(
            (m) => m[1]!,
          );
          return texts.reduce((widest, t) => Math.max(widest, t.length), 0);
        });

    /** Every shape class in the recording, and the widest row each of its members reaches. */
    const classes = new Map<string, number[]>();
    for (const trace of recorded) {
      const r = readPairing(trace);
      if (r === null) continue;
      const issued = r.candidates.filter((c) => c.issued).length;
      const key = `${r.verdict}|${r.reason}|${r.candidates.length}|${issued}`;
      const widest = r.candidates.reduce((w, c) => Math.max(w, c.text.length), 0);
      classes.set(key, [...(classes.get(key) ?? []), widest]);
    }

    // Non-vacuity, and it is the whole question: if every class had one member, or all its members
    // were equally wide, then "the widest member is kept" is satisfied by keeping ANY of them and
    // this test could not see the rule at all. On this recording 3 classes have members that differ.
    const contested = [...classes.values()].filter((ws) => new Set(ws).size > 1);
    expect(
      contested.length,
      'no shape class has members of differing width — the rule is unmeasured here',
    ).toBeGreaterThan(0);

    const expected = [...classes.values()].map((ws) => Math.max(...ws)).sort((a, b) => a - b);
    expect(drawnWidths(htmls[0]!).sort((a, b) => a - b)).toEqual(expected);
    // ...and at a mid-run cursor too, since the ghosts are a property of the RECORDING and must not
    // depend on where the reader is standing.
    expect(drawnWidths(htmls[htmls.length - 1]!).sort((a, b) => a - b)).toEqual(expected);
  });

  it("a cycle that refused nobody still reserves the refusal note's height", () => {
    const refusedAt = all.findIndex((t) => t !== null && readPairing(t)?.verdict === 'refused');
    const pairedAt = all.findIndex((t) => t !== null && readPairing(t)?.verdict === 'paired');
    // Non-vacuity: this recording must contain both, or "the note is reserved" is a claim about
    // nothing. Both indices are also proof the note is reachable at all.
    expect(refusedAt).toBeGreaterThan(0);
    expect(pairedAt).toBeGreaterThan(0);
    const NOTE = 'lead the next issue group';
    expect(htmls[refusedAt]).toContain(NOTE);
    expect(htmls[pairedAt]).toContain(NOTE);
    // ...and the note is only SAID once — the ghosts are hidden, so the panel does not read out a
    // refusal that did not happen.
    expect(count(htmls[pairedAt]!, 'visibility:hidden')).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The superscalar datapath's verdict chip — 4.2px, on top of the readout's jump directly below it.
// ---------------------------------------------------------------------------------------------

describe('superscalar datapath: the verdict chip is always in the header', () => {
  const WIDE: ProcessorConfig = { ...defaultConfig(), forwarding: true, issueWidth: 4 };
  const recorded = record('array-sum', WIDE, () => new SuperscalarProcessor());
  const htmls = cursors(recorded).map((trace) =>
    renderToStaticMarkup(
      <SuperscalarDatapath
        trace={trace}
        cycleKey={0}
        tier="detailed"
        config={{ forwarding: true, predictTaken: false, issueWidth: 4 }}
        followed={null}
      />,
    ),
  );

  it('exactly one chip at every cursor, refusal or not', () => {
    for (const html of htmls) expect(count(html, 'dp-verdict')).toBe(1);
  });

  it('it is hidden on the cycles that refused nobody, and visible on the ones that did', () => {
    const visible = htmls.filter(
      (h) => !h.includes('class="dp-verdict" style="visibility:hidden"'),
    );
    const hidden = htmls.length - visible.length;
    // Both states are reached — otherwise "always present, sometimes hidden" is untested in one
    // direction and an always-visible chip would pass the count above.
    expect(visible.length).toBeGreaterThan(0);
    expect(hidden).toBeGreaterThan(0);
    // A visible chip says what happened; a hidden one holds the widest sentence the chip can say.
    for (const html of visible) expect(html).toContain('refused: ');
  });
});

// ---------------------------------------------------------------------------------------------
// The cache grid — 1.2px, from the state chip on the touched LINE having no line box when idle.
//
// This one is here twice over. The first fix was aimed at the caption's two font sizes, it passed a
// guard written for it, and the browser then measured the panel still swinging 143.2→144.4px: the
// header is 21px in both states and always was. A structural proxy can be perfectly stable and be a
// proxy for the wrong thing, which is the failure mode no amount of headless care removes — only the
// browser closed it. What is pinned below is the mechanism the probe actually found.
// ---------------------------------------------------------------------------------------------

describe('cache grid: an idle state chip reserves the same line box as a lit one', () => {
  function recordCache(cache: CacheConfig): readonly CycleTrace[] {
    const source = EXAMPLE_PROGRAMS.find((p) => p.name === 'array-sum-twice')!.source;
    const { program } = assemble(source);
    const recorder = new TraceRecorder(new PipelineProcessor());
    recorder.load(toProgramImage(program!), { ...defaultConfig(), forwarding: true, cache });
    recorder.runToEnd();
    return recorder.recorded;
  }
  const recorded = recordCache(CACHE_SMALL);
  const htmls = cursors(recorded).map((trace) =>
    renderToStaticMarkup(<CacheGrid trace={trace} cache={CACHE_SMALL} />),
  );
  /** Every state chip in the panel, lit or idle, as (attributes, text). */
  const chips = (html: string): { attrs: string; text: string }[] =>
    [...html.matchAll(/<span class="cache-line-tag([^"]*)"([^>]*)>(.*?)<\/span>/g)].map((m) => ({
      attrs: m[2]!,
      text: m[3]!,
    }));

  it('every chip has content at every cursor — an empty one has no line box', () => {
    // `.cache-line` is a grid with `align-items: center`, so the row is as tall as its tallest cell.
    // An idle chip rendered as `<span … />` measured 5.19px (padding and border only) against a lit
    // chip's 18.19px, growing the touched row 30.19→31.38px on every load and store.
    for (const html of htmls) {
      const found = chips(html);
      expect(found.length).toBe(2); // CACHE_SMALL is two lines — the floor, and it never varies
      for (const chip of found) expect(chip.text.length).toBeGreaterThan(0);
    }
  });

  it('...and every chip is set in the same font', () => {
    // The other half, and the one that bit: content alone left the idle chip in the body's sans face
    // against the lit chip's mono, which measured 20.19px against 18.19px — a BIGGER swing than the
    // defect being fixed, in the opposite direction. A line box needs content and font and size to
    // agree, so this pins the font as well as the presence of text.
    const fonts = new Set<string>();
    for (const html of htmls) {
      for (const chip of chips(html)) {
        const font = /font-family:([^;"]+)/.exec(chip.attrs)?.[1];
        expect(font).toBeDefined();
        fonts.add(font!);
      }
    }
    expect(fonts.size).toBe(1);
  });

  it('the number of LIT chips genuinely varies, so the reserve is doing work', () => {
    // Non-vacuity, both halves: the run must touch a line on some cycles and not on others, or a
    // panel with no reserve at all would hold its height for free.
    const lit = htmls.map((html) =>
      chips(html).filter((chip) => /HIT|MISS|EVICT|FILLING/.test(chip.text)),
    );
    expect(Math.max(...lit.map((l) => l.length))).toBeGreaterThan(0);
    expect(Math.min(...lit.map((l) => l.length))).toBe(0);
  });

  it('both caption states are actually reached in this run', () => {
    const idle = htmls.filter((h) => h.includes('no memory access this cycle')).length;
    const busy = htmls.filter((h) => /HIT|MISS|EVICT|FILLING/.test(h)).length;
    expect(idle).toBeGreaterThan(0);
    expect(busy).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The branch-predictor panel — 33px, measured in the browser at step 7 of
// `docs/plans/dynamic-branch-prediction.md`, and the only offender in this file that was NOT found
// by the jitter sweep: that sweep predates the panel, and the panel's own header argued it was
// exempt ("the height is constant by construction"). True of the sixteen ROWS. The header row was
// a `flexWrap: wrap` flex holding the one cursor-dependent string in the panel, so between 900px
// and 1180px it was ONE line on a quiet cycle and TWO on a resolve.
// ---------------------------------------------------------------------------------------------

describe('branch predictor: the heading row holds nothing that moves with the clock', () => {
  const SCHEME = 'dynamic-2bit' as const;
  const recorded = record(
    'nested-loop',
    { ...defaultConfig(), branchPrediction: SCHEME },
    () => new PipelineProcessor(),
  );
  const htmls = cursors(recorded).map((trace) =>
    renderToStaticMarkup(
      <PredictorTable trace={trace} recording={recorded} scheme={SCHEME} followed={null} />,
    ),
  );
  const MARK = '<div class="predictor-train-line">';
  /** Everything the panel draws ABOVE the train caption — the heading row and nothing else. */
  const headingRow = (html: string): string => html.slice(0, html.indexOf(MARK));
  /** The train caption's own row, opening `<span>` included, so its style is readable. */
  const trainRow = (html: string): string =>
    html.slice(html.indexOf(MARK), html.indexOf('<div class="predictor-rows">'));

  it('the caption has a row of its OWN — the floor, and what the fix consists of', () => {
    // Without this, `headingRow` below slices at −1 and compares near-identical whole panels, which
    // is the shape that passes for free. Asserted at every cursor, pre-run included.
    for (const html of htmls) expect(html).toContain(MARK);
    expect(htmls[0]).toContain(MARK);
  });

  it('the heading row is byte-identical at every cursor', () => {
    // THE guard. Counted on the render, never on the fold: this is a substring of the markup the
    // component produced. Put `TrainCaption` back beside the `<h2>` and this set becomes as large as
    // the number of distinct captions in the run.
    expect(distinct(htmls.map(headingRow)).size).toBe(1);
    // ...and the row really is the heading, not an empty slice.
    expect(headingRow(htmls[0]!)).toContain('Branch predictor');
    expect(headingRow(htmls[0]!)).toContain('counters');
  });

  it('...while the caption itself genuinely varies across the run', () => {
    // Non-vacuity. "The heading row never changes" is what a panel drawing no caption at all
    // satisfies most easily, so the run has to actually reach both states.
    const captions = htmls.map(trainRow);
    expect(distinct(captions).size).toBeGreaterThan(1);
    expect(captions.filter((c) => c.includes('no branch resolved this cycle')).length).toBeGreaterThan(0); // prettier-ignore
    expect(captions.filter((c) => c.includes('MISPREDICT')).length).toBeGreaterThan(0);
    expect(captions.filter((c) => c.includes('CORRECT')).length).toBeGreaterThan(0);
  });

  it('both caption states are set in the same font at the same size', () => {
    // The other half, and the half the cache grid already paid for: now that this caption owns a
    // row, ITS line box IS the row's height, and a line box needs content and font and size to
    // agree. The two states used to be two different spans — 0.75rem sans and 0.78rem mono.
    const shapes = new Set<string>();
    for (const html of htmls) {
      const span = /<div class="predictor-train-line"><span style="([^"]*)"/.exec(html);
      expect(span, 'the caption is one span carrying its own style').not.toBeNull();
      // Colour is allowed to differ — it is the only thing that may.
      shapes.add(span![1]!.replace(/color:[^;]*;?/g, ''));
    }
    expect(shapes.size).toBe(1);
    expect([...shapes][0]).toContain('font-size:0.78rem');
  });
});

// ---------------------------------------------------------------------------------------------
// The scoreboard status tables (M15 step 7) — three tables whose heights are constant BY
// CONSTRUCTION, which is a stronger claim than a measured reserve and therefore an easier one to
// break by accident. The predictor panel above is the cautionary tale: it shipped exactly this
// claim, correctly, ABOUT ITS ROWS — and a browser pass then measured it false of the PANEL,
// because the one cursor-dependent string lived in the heading row and wrapped. This panel has TWO
// such strings, so both are pinned here.
// ---------------------------------------------------------------------------------------------

describe('scoreboard tables: three tables that cannot change height as the cursor moves', () => {
  // `register-reuse.s` is the right fixture rather than a long program: it is the one that reaches
  // every stall shape (both hazards included), so the caption really does move through its states.
  const recorded = record('register-reuse', defaultConfig(), () => new ScoreboardProcessor());
  const htmls = cursors(recorded).map((trace) =>
    renderToStaticMarkup(
      <ScoreboardTables
        trace={trace}
        recording={recorded}
        followed={null}
        onFollow={() => undefined}
      />,
    ),
  );
  const HEAD_END = '<div style="margin-top:0.6rem">';
  const headingRow = (html: string): string => html.slice(0, html.indexOf(HEAD_END));

  it('the panel is never absent — including at the pre-run cursor', () => {
    // The floor. A panel that vanishes reserves nothing, and every guard below is satisfied for
    // free by a panel that renders nothing at all.
    for (const html of htmls) expect(html).toContain('Scoreboard status tables');
    expect(htmls[0]).toContain('Scoreboard status tables');
    expect(htmls[0]).toContain('Register result');
  });

  it('the heading row is byte-identical at every cursor', () => {
    // Counted on the render. Move either cursor-dependent string up beside the `<h2>` and this
    // becomes as large as the number of distinct values it takes across the run.
    expect(distinct(htmls.map(headingRow)).size).toBe(1);
    expect(headingRow(htmls[0]!)).toContain('Scoreboard status tables');
    expect(headingRow(htmls[0]!)).toContain('completion is not');
  });

  it('both cursor-dependent strings exist, and each is pinned to a FIXED-HEIGHT box', () => {
    // The predictor panel's lesson, applied to both — but the two boxes are different SHAPES, and
    // the difference is the step-8 finding. What matters for the panel's height is that each box
    // has a fixed `height` (never a `min-height`) with its overflow hidden: a box that cannot grow
    // cannot move the panel, whatever the viewport does to its width.
    //
    // ⚠ The window count is one unwrappable line, because its longest corpus form fits. The
    // CAPTION is three lines, because pinning it to one made two of the six reasons — including
    // `structural-int`, the sentence this view is required to state — unreadable at EVERY
    // viewport, the caption's box topping out at 1120px against a sentence needing 1868px.
    // Asserting `nowrap` on the caption is what this test used to do, and it was green while the
    // words were being thrown away.
    for (const html of htmls) {
      const styleOf = (marker: string): string => {
        const style = new RegExp(`class="${marker}"[^>]*style="([^"]*)"`).exec(html);
        expect([marker, style === null]).toEqual([marker, false]);
        return style![1]!;
      };

      const note = styleOf('sb-window-note');
      expect(['note nowrap', note.includes('white-space:nowrap')]).toEqual(['note nowrap', true]);
      expect(['note height', note.includes('height:20px')]).toEqual(['note height', true]);

      const caption = styleOf('sb-stall-caption');
      // Three lines of the same 20px row, hidden past that — a constant, not a scan.
      expect(['caption height', caption.includes('height:60px')]).toEqual(['caption height', true]);
      expect(['caption clamp', caption.includes('-webkit-line-clamp:3')]).toEqual(['caption clamp', true]); // prettier-ignore
      expect(['caption hidden', caption.includes('overflow:hidden')]).toEqual(['caption hidden', true]); // prettier-ignore
      // `min-height` would satisfy every check above and still let a fourth line grow the panel.
      expect(['caption not min-height', /min-height/.test(caption)]).toEqual(['caption not min-height', false]); // prettier-ignore
    }
  });

  it('...while both genuinely vary across the run, so the pinning is doing work', () => {
    // Non-vacuity, twice. A caption stuck on one string satisfies every guard above. ⚠ The text is
    // extracted rather than sliced at a fixed offset: the style attribute on each marker is longer
    // than the string it precedes, so a slice short enough to look reasonable reads only CSS and
    // reports every cursor identical — a guard that passes by measuring the wrong bytes.
    const textAfter = (html: string, marker: string): string =>
      new RegExp(`class="${marker}"[^>]*>(.*?)</`).exec(html)?.[1] ?? '';

    const captions = htmls.map((h) => textAfter(h, 'sb-stall-caption'));
    expect(distinct(captions).size).toBeGreaterThan(1);
    expect(htmls.filter((h) => h.includes('no stall this cycle')).length).toBeGreaterThan(0);
    expect(htmls.filter((h) => h.includes('war @WB')).length).toBeGreaterThan(0);

    const notes = htmls.map((h) => textAfter(h, 'sb-window-note'));
    expect(distinct(notes).size).toBeGreaterThan(1);
    expect(notes.filter((n) => n.length > 0).length).toBe(htmls.length);
  });

  it('the two fixed tables draw the same number of rows and cells at every cursor', () => {
    // The functional-unit table is the MACHINE (three units, idle ones included) and the
    // register-result table is the whole register file — so neither can move with the cursor.
    // Drawing only the BUSY units, or only the CLAIMED registers, is the obvious "tidier" change
    // and it is what this reddens on.
    //
    // ⚠ Counted on the marker classes, not on the unit NAMES: `INT0` also appears in the
    // instruction table's unit column and in every register cell that unit has claimed, so a
    // name count reads three where the table has one row (measured — this assertion was written
    // the wrong way first).
    const unitRows = htmls.map((h) => count(h, 'sb-unit-row'));
    const regCells = htmls.map((h) => count(h, 'sb-reg-cell'));
    expect(distinct(unitRows).size).toBe(1);
    expect(unitRows[0]).toBe(3);
    expect(distinct(regCells).size).toBe(1);
    expect(regCells[0]).toBe(32);
  });

  it('the instruction table reserves its full window at every cursor, empty or not', () => {
    // The one table whose row COUNT moves. Its height does not, because the reserve is the cap —
    // a constant, not a scan of the recording. Dropping the reserve leaves the panel growing a row
    // at a time for the first ten cycles of every program, pre-run included.
    const reserve = `min-height:${18 + 10 * 20}px`;
    for (const html of htmls) expect(html).toContain(reserve);
    expect(distinct(htmls.map((h) => count(h, reserve))).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// The data-memory panel — clean on every shipped program (they declare their data), reachable from
// the program editor, which is what this fixture is.
// ---------------------------------------------------------------------------------------------

describe('data memory: the row count is the run PEAK at every cursor', () => {
  // A store to an address no `.data` directive mentions — so the row appears mid-run, which is what
  // no shipped example does and any hand-typed program can.
  const SANDBOX = [
    '  li t0, 0x10000000',
    '  li t1, 42',
    '  sw t1, 0(t0)',
    '  sw t1, 4(t0)',
    '  sw t1, 8(t0)',
    '  li a7, 10',
    '  ecall',
    '',
  ].join('\n');
  const result = loadSource(SANDBOX, () => new SingleCycleProcessor());
  if (!result.ok) throw new Error('fixture failed to assemble');
  // The pre-run state, taken BEFORE `runToEnd` moves the cursor off −1. This block used to sweep
  // `recorded` alone while the file's own docblock claimed every guard measures "at every cursor of a
  // real recording including the pre-run one" (M14 review, finding 6) — and the pre-run cursor is the
  // one the panel is rendered at first, so a reserve that only held from cycle 0 on would move the
  // page on the reader's very first step. It is the cursor `preRunMicro` and `readPairingPreRun` both
  // exist for, two panels up.
  const preRunState = result.loaded.recorder.currentState();
  result.loaded.recorder.runToEnd();
  const recorded = result.loaded.recorder.recorded;
  const reserve = peakDataMemoryRows(recorded);
  const states = [preRunState, ...recorded.map((trace) => trace.state)];
  const htmls = states.map((state) =>
    renderToStaticMarkup(<MemoryPanel state={state} reserveRows={reserve} />),
  );

  it('the fixture really does grow its memory as it runs', () => {
    // Non-vacuity, and it is the whole reason this fixture is hand-written rather than taken from the
    // corpus: every shipped program declares its data up front, so its row count never moves and this
    // guard would pass against a panel with no reserve at all.
    const realRows = htmls.map((html) => count(html, '<tr>'));
    expect(Math.min(...realRows)).toBe(0);
    expect(Math.max(...realRows)).toBe(3);
    expect(reserve).toBe(3);
  });

  it('...yet every render draws the same number of rows in total', () => {
    const total = htmls.map((html) => count(html, '<tr'));
    expect(distinct(total).size).toBe(1);
    expect(total[0]).toBe(reserve);
  });

  it('the reserve is hidden rather than blank-but-readable', () => {
    // `visibility: hidden` is what makes a ghost occupy space AND leave the accessibility tree, so a
    // screen reader is never read three rows of zeroes that are not in memory.
    const first = htmls[0]!;
    expect(count(first, '<tr style="visibility:hidden"')).toBe(3);
    expect(first).toContain('no data memory written');
  });
});

// ---------------------------------------------------------------------------------------------
// The transport bar — 23px (81.4 → 104.4px), and the only offender here that is not a panel.
//
// It is also the one that moved EVERY surface at once: the bar is `position: sticky`, so a second
// row eats 23px of viewport on every scroll and shoves the whole stack down the page. The cause was
// three cursor-dependent texts in a `flexWrap` row whose available width is a constant 1168px: the
// row wanted 888 … 1218px over one run (measured in the shipped bundle at 1500/1400/1300/1240/1200/
// 920/900/880/840px, all of which showed BOTH heights). The fix moved them to the scrub row, which
// never wraps, and holds each of them at this recording's peak text so the SLIDER beside them does
// not resize either.
//
// What that leaves for a headless guard is the reserve, and the rule this file opened with applies
// hardest here: the reserve numbers are read back out of the RENDER, and the fold is only ever the
// expected value.
//
// ⚠ AND WHAT IT DOES NOT LEAVE, stated rather than implied: nothing below can see WHERE the readout
// is rendered. Move `<TransportReadout>` back into the bar's `flexWrap` control row and every test
// in this block still passes — it renders the same markup wherever it is mounted. The six mutations
// that were verified to redden it (`temp/jitter2/break.mjs`) are all about the reserve and the
// stylesheet; placement is the browser's to catch, and the sweep that catches it is
// `temp/jitter2/transport-sweep.mjs`, which walks every cursor at fourteen viewport widths.
// ---------------------------------------------------------------------------------------------

describe('transport readout: identical geometry at every cursor', () => {
  const WIDE: ProcessorConfig = { ...defaultConfig(), issueWidth: 2, forwarding: true };
  const recorded = record('paired-branches', WIDE, () => new SuperscalarProcessor());
  const lastCycle = recorded.length - 1;
  const reserve = readoutReserve(recorded);
  /** The readout as the shell draws it, at the pre-run cursor and then at every recorded cycle. */
  const htmls = cursors(recorded).map((trace, i) => {
    const cursor = i - 1;
    return renderToStaticMarkup(
      <TransportReadout
        cursor={cursor}
        lastCycle={lastCycle}
        atEnd={cursor === lastCycle}
        inFlight={shownInstruction(trace?.instructions ?? [], null)}
        inFlightCount={trace?.instructions.length ?? 0}
        following={false}
        reserve={reserve}
      />,
    );
  });

  /** Every reserved span of one render, as (characters reserved, text actually drawn). */
  const spans = (html: string): { ch: number; text: string }[] =>
    [...html.matchAll(/<span[^>]*min-width:(\d+)ch[^>]*>(.*?)<\/span>/g)].map((m) => ({
      ch: Number(m[1]),
      text: m[2]!,
    }));

  it('the fixture really does exercise all three moving texts', () => {
    // Non-vacuity, and every clause is one a run could fail to reach: a recording that never halts,
    // never fills two lanes, or is one cycle long would make the guards below agree with almost any
    // implementation. Note the FIRST entry is the pre-run cursor.
    const texts = htmls.map((html) => spans(html).map((s) => s.text));
    expect(texts[0]![0], 'the pre-run cursor').toBe('start (pre-run)');
    expect(texts[0]![1], 'nothing is in flight before the run').toBe('');
    expect(texts.at(-1)![0], 'the halted cursor').toContain('— halted');
    expect(texts.filter((t) => t[2] !== '').length, 'cursors with >1 in flight').toBeGreaterThan(0);
    expect(
      texts.filter((t) => t[2] === '').length,
      'cursors with 1 or 0 in flight',
    ).toBeGreaterThan(0);
  });

  it('every cursor draws the same three spans with the same reserves', () => {
    // The floor first: three spans, none of them zero-width. "The same at every cursor" is what a
    // readout that draws nothing satisfies most easily.
    for (const html of htmls) {
      const drawn = spans(html);
      expect(drawn).toHaveLength(3);
      for (const s of drawn) expect(s.ch).toBeGreaterThan(0);
    }
    const shapes = htmls.map((html) => spans(html).map((s) => s.ch));
    expect(distinct(shapes).size, 'the reserved geometry must not move with the cursor').toBe(1);
    // The fold appears here only as the expected value of what the markup already proved constant.
    expect(shapes[0]).toEqual([reserve.counter, reserve.instruction, reserve.chip]);
  });

  it('no cursor overflows its reserve', () => {
    // A `min-width` a text outgrows is not a reserve — the span grows, the readout grows, and the
    // slider beside it shrinks by exactly that much on that one step. Both numbers come out of the
    // markup: the reserve from the style attribute, the text from between the tags.
    for (const html of htmls) {
      for (const s of spans(html)) {
        expect(s.text.length, `"${s.text}" must fit ${s.ch}ch`).toBeLessThanOrEqual(s.ch);
      }
    }
    // ...and each reserve is actually REACHED, per span, or an over-large constant would satisfy the
    // loop above. Read per position rather than as one maximum: a single `Math.max` over all three
    // is answered by whichever span happens to be widest and says nothing about the other two.
    const widest = (i: number): number =>
      Math.max(...htmls.map((html) => spans(html)[i]!.text.length));
    expect(widest(0), 'the counter reserve').toBe(reserve.counter);
    expect(widest(1), 'the instruction reserve').toBe(reserve.instruction);
    // The chip is the deliberate exception, and the gap is exactly the verb: the reserve holds
    // `following` (9) so that clicking a map cell cannot resize the box, while this run — which
    // follows nothing — only ever draws `in` (2). If those words change, this number must.
    expect(widest(2), 'the chip reserve, minus the verb it holds for the follow case').toBe(
      reserve.chip - ('following'.length - 'in'.length),
    );
  });

  it('a run that never has two in flight omits the chip at every cursor, not at some', () => {
    // The chip's existence is a property of the RECORDING (its reserve is zero), so it appears and
    // disappears when the model or program changes — a deliberate act — and never on a step. This is
    // the same gate shape as the map's, and the reason it is not `inFlightCount > 1` any more.
    const solo = record('sum-loop', defaultConfig(), () => new SingleCycleProcessor());
    const soloReserve = readoutReserve(solo);
    expect(soloReserve.chip).toBe(0);
    const soloHtmls = cursors(solo).map((trace, i) =>
      renderToStaticMarkup(
        <TransportReadout
          cursor={i - 1}
          lastCycle={solo.length - 1}
          atEnd={i - 1 === solo.length - 1}
          inFlight={shownInstruction(trace?.instructions ?? [], null)}
          inFlightCount={trace?.instructions.length ?? 0}
          following={false}
          reserve={soloReserve}
        />,
      ),
    );
    for (const html of soloHtmls) expect(spans(html)).toHaveLength(2);
    expect(distinct(soloHtmls.map((html) => spans(html).map((s) => s.ch))).size).toBe(1);
  });

  it('FOLLOWING an instruction does not move the geometry as you step past it', () => {
    // The state every sweep above misses, and the one that reopens the class: `following` is not a
    // mode the reader switches on, it is `shownInstruction(...)?.id === followed` — TRUE only at the
    // cursors where the followed instruction is actually in flight, so with a map cell clicked it
    // flips on its own as the clock steps. The chip's verb is "following" (9 chars) at those cursors
    // and "in" (2) at the others, which is ~49px of readout box appearing and disappearing mid-run,
    // taken out of the slider beside it. So the reserve cannot depend on it — it holds the wider
    // verb always — and this drives the flip rather than passing a fixed flag for a whole run.
    const followed = recorded[2]!.instructions[0]!.id;
    const rendered = cursors(recorded).map((trace, i) => {
      const instructions = trace?.instructions ?? [];
      const inFlight = shownInstruction(instructions, followed);
      return {
        following: inFlight !== null && inFlight.id === followed,
        html: renderToStaticMarkup(
          <TransportReadout
            cursor={i - 1}
            lastCycle={lastCycle}
            atEnd={i - 1 === lastCycle}
            inFlight={inFlight}
            inFlightCount={instructions.length}
            following={inFlight !== null && inFlight.id === followed}
            reserve={reserve}
          />,
        ),
      };
    });
    // Non-vacuity: the flip has to actually happen in this run, or the constancy below is about
    // nothing. Both values must appear.
    expect(new Set(rendered.map((r) => r.following)).size, 'the run must both follow and not').toBe(
      2,
    );
    const shapes = rendered.map((r) => spans(r.html).map((s) => s.ch));
    expect(distinct(shapes).size, 'the reserved geometry must survive the follow flip').toBe(1);
    for (const r of rendered) {
      for (const s of spans(r.html)) {
        expect(s.text.length, `"${s.text}" must fit ${s.ch}ch`).toBeLessThanOrEqual(s.ch);
      }
    }
  });

  it('an empty chip says nothing — no tooltip about "undefined"', () => {
    // The span is drawn at every cursor so it holds its width; its TITLE is a sentence about a
    // specific cycle, and at a cursor with nothing in flight that sentence would read "0
    // instructions are in flight this cycle; the one named beside it is in undefined". A reserve is
    // allowed to be silent — it is not allowed to say something false.
    const empty = htmls.filter((html) => spans(html).some((s) => s.text === ''));
    expect(empty.length, 'the run must reach a cursor with no chip').toBeGreaterThan(0);
    for (const html of empty) {
      const chip = /<span([^>]*)>(?:)<\/span>/.exec(html);
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('0 instructions are in flight');
      if (chip) expect(chip[1]).not.toContain('title=');
    }
  });

  it('the scrub row cannot become two rows', () => {
    // The reserves above keep the readout's BOX still; this is what keeps the bar's HEIGHT still,
    // and no render can show it — `.transport-scrub-row` must not wrap, or the readout is back to
    // being able to push the slider onto a line of its own. Asserted on the stylesheet with comments
    // stripped, because a rule quoted inside prose is documentation and not a rule (the trap
    // `play-control.test.tsx` records).
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const row = /\.transport-scrub-row \{([^}]*)\}/.exec(css);
    expect(row, 'styles.css should carry a .transport-scrub-row rule').not.toBeNull();
    expect(row![1]).toContain('display: flex');
    expect(row![1]).not.toContain('flex-wrap');
    // And the slider is the element that absorbs the leftover, so the readout never needs the space
    // a wrap would give it.
    const scrub = /\.transport-scrub \{([^}]*)\}/.exec(css);
    expect(scrub![1]).toContain('flex: 1 1 0');
  });
});
