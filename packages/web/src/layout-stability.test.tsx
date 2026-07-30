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

  it('an empty decode still draws the list — the message does not replace it', () => {
    const idle = all.findIndex((t) => t !== null && live(t) === 0);
    expect(idle).toBeGreaterThan(0); // the run really does have an empty-decode cycle
    expect(htmls[idle]).toContain('Decode is empty this cycle');
    // The early return used to swap the whole `<ul>` for this one-line `<p>`, which is the same
    // collapse as the panel vanishing, one level down.
    expect(htmls[idle]).toContain('<ul');
    expect(count(htmls[idle]!, '<li')).toBeGreaterThan(0);
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
// The cache grid — 1.2px, from two font sizes on one caption.
// ---------------------------------------------------------------------------------------------

describe('cache grid: the access caption is set at one size in both states', () => {
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
  /** Every inline font-size in the panel, sorted — the multiset that decides its line heights. */
  const sizes = (html: string): string[] =>
    [...html.matchAll(/font-size:([0-9.]+rem)/g)].map((m) => m[1]!).sort();

  it('the inline font sizes are identical at every cursor', () => {
    // The caption read 0.75rem with no access and 0.78rem with one, and the header is a
    // baseline-aligned flex row: the taller item sets the row, so the panel was 143.2px on a cycle
    // with no memory access and 144.4px on a cycle with one.
    expect(sizes(htmls[0]!).length).toBeGreaterThan(0); // the floor: there ARE inline sizes to compare
    expect(distinct(htmls.map(sizes)).size).toBe(1);
  });

  it('both caption states are actually reached in this run', () => {
    // Non-vacuity: without a cycle of each kind the sweep above compares a state against itself.
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
  result.loaded.recorder.runToEnd();
  const recorded = result.loaded.recorder.recorded;
  const reserve = peakDataMemoryRows(recorded);
  const htmls = recorded.map((trace) =>
    renderToStaticMarkup(<MemoryPanel state={trace.state} reserveRows={reserve} />),
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
