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
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CacheGrid } from './CacheGridView';
import { MicroTablePanel } from './MicroTablePanel';
import { PairingReadout } from './PairingReadoutView';
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
      <MicroTablePanel trace={trace} recording={recorded} followed={null} onFollow={noop} />,
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
