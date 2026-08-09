/**
 * The predictor panel's RENDER seam (dynamic-branch-prediction step 6).
 *
 * ⚠ **Why this file exists at all, when `predictor-table.test.ts` already pins the fold.** The plan
 * asks for "a render smoke test", and this repo's own history says a smoke test is the wrong target:
 * `m13-width-planned.md` records a test keyed off a pure FOLD rather than the render as its
 * signature defect — it recurred eight times, twice inside the fix written to stop it — and step 3 of
 * this very feature shipped a hole that only a case starting from a SCHEME and grepping the markup
 * could close (the branch-target adder would have blanked under both dynamic schemes with exactly
 * one test to say so, and it was a fold assertion). So every case below starts from a scheme or a
 * recording and reads the rendered HTML. The specific thing they must be able to see is **the wrong
 * row lit** — which is also the only net in `web` for a re-implemented `predictorIndex`, since a
 * consistent rotation is invisible to the engine, the trace and every cycle count (step 3's
 * measurement; `predictor.test.ts` is the other net).
 *
 * **What it still cannot see, stated rather than implied.** `renderToStaticMarkup` renders; it does
 * not click, it does not lay out, and there is no jsdom here. The chip reserves, the meter's width,
 * whether sixteen rows wrap at a narrow viewport, and the follow-highlight composing with the map
 * and datapath are all step 7's. Nothing in this file should be read as covering them.
 */

import { assemble } from '@cpu-viz/assembler';
import { predictorIndex, toProgramImage } from '@cpu-viz/engine-common';
import { DeepPipelineProcessor } from '@cpu-viz/engine-deep-pipeline';
import { OutOfOrderProcessor } from '@cpu-viz/engine-out-of-order';
import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { SuperscalarProcessor } from '@cpu-viz/engine-superscalar';
import {
  defaultConfig,
  type CycleTrace,
  type Processor,
  type ProcessorConfig,
} from '@cpu-viz/trace';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildPredictorTable } from './predictor-table';
import { PredictorTable } from './PredictorTableView';
import { EXAMPLE_PROGRAMS } from './programs';
import type { BranchPrediction } from './session';

const MODELS: ReadonlyArray<{ id: string; make: () => Processor }> = [
  { id: 'pipeline', make: () => new PipelineProcessor() },
  { id: 'deep-pipeline', make: () => new DeepPipelineProcessor() },
  { id: 'superscalar', make: () => new SuperscalarProcessor() },
  { id: 'out-of-order', make: () => new OutOfOrderProcessor() },
];

function record(
  program: string,
  make: () => Processor,
  config: Partial<ProcessorConfig> = {},
): readonly CycleTrace[] {
  const source = EXAMPLE_PROGRAMS.find((p) => p.name === program)!.source;
  const { program: assembled } = assemble(source);
  const p = make();
  p.reset(toProgramImage(assembled!), { ...defaultConfig(), cache: null, ...config });
  const traces: CycleTrace[] = [];
  let guard = 0;
  while (!p.isHalted()) {
    if (guard++ >= 3000) throw new Error('runaway');
    traces.push(p.step());
  }
  return traces;
}

function markup(
  trace: CycleTrace | null,
  recording: readonly CycleTrace[],
  scheme: BranchPrediction,
  followed: string | null = null,
): string {
  return renderToStaticMarkup(
    <PredictorTable trace={trace} recording={recording} scheme={scheme} followed={followed} />,
  );
}

/** Which row indices the rendered markup marks as trained. The panel's ONE structural claim, read
 *  back out of the HTML — this is what makes "the wrong row lit" a visible failure rather than an
 *  invisible one. */
function litRows(html: string): number[] {
  const rows = html.match(/predictor-row predictor-row--\w+/g) ?? [];
  return rows.flatMap((cls, index) => (cls.endsWith('--trained') ? [index] : []));
}

describe('the panel appears for exactly the schemes with a table', () => {
  it('renders nothing under every static scheme, and something under both dynamic ones', () => {
    const recorded = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    for (const scheme of ['none', 'static-not-taken', 'static-taken'] as const) {
      expect(markup(recorded[5]!, recorded, scheme), scheme).toBe('');
    }
    for (const scheme of ['dynamic-1bit', 'dynamic-2bit'] as const) {
      expect(markup(recorded[5]!, recorded, scheme), scheme).toContain('Branch predictor');
    }
  });
});

describe('the wrong row lit is a VISIBLE failure', () => {
  /**
   * The case the file exists for. On every model, find a cycle that trains `nested-loop.s`'s inner
   * branch and assert the markup lights **that row and only that row** — by position in the rendered
   * row list, so a fold that returned the right index while the view drew a different row, or a
   * `predictorIndex` rotated by one entry, both fail here.
   */
  it('lights exactly the trained row, and its index is the branch’s own', () => {
    for (const model of MODELS) {
      const recorded = record('nested-loop', model.make, { branchPrediction: 'dynamic-2bit' });
      const trained = recorded.find(
        (t) => (buildPredictorTable(t, recorded, 'dynamic-2bit')?.trains.length ?? 0) > 0,
      );
      expect(trained, `${model.id}: nested-loop must train something`).toBeDefined();
      const table = buildPredictorTable(trained!, recorded, 'dynamic-2bit')!;
      const expected = table.trains.map((t) => t.index);
      // Derived from the branch's pc through the ENGINE's index, not copied from the fold — so the
      // two would have to be wrong together to pass.
      expect(expected).toEqual(table.trains.map((t) => predictorIndex(t.pc)));
      expect(litRows(markup(trained!, recorded, 'dynamic-2bit')), model.id).toEqual(expected);
    }
  });

  it('lights no row on a cycle with no resolve, and none at all pre-run', () => {
    const recorded = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    const quiet = recorded.find(
      (t) => buildPredictorTable(t, recorded, 'dynamic-2bit')!.trains.length === 0,
    )!;
    expect(litRows(markup(quiet, recorded, 'dynamic-2bit'))).toEqual([]);
    expect(markup(quiet, recorded, 'dynamic-2bit')).toContain('no branch resolved this cycle');

    // Pre-run: the panel is present (it is a property of the recording), cold, and lights nothing.
    const preRun = markup(null, recorded, 'dynamic-2bit');
    expect(preRun).not.toBe('');
    expect(litRows(preRun)).toEqual([]);
  });

  it('draws all sixteen rows on every cursor — the constant height, from the markup', () => {
    const recorded = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    const counts = new Set(
      [null, ...recorded].map(
        (t) => (markup(t, recorded, 'dynamic-2bit').match(/class="predictor-row /g) ?? []).length,
      ),
    );
    expect(counts).toEqual(new Set([16]));
  });
});

describe('what the rows SAY reaches the DOM', () => {
  it('renders the counter word, the owner and the counter’s move', () => {
    const recorded = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    // A cycle on which the inner branch trains and its counter actually moves.
    const moving = recorded.find((t) => {
      const table = buildPredictorTable(t, recorded, 'dynamic-2bit');
      return table?.trains.some(
        (x) => table.entries[x.index]!.previous !== table.entries[x.index]!.counter,
      );
    })!;
    const html = markup(moving, recorded, 'dynamic-2bit');
    const table = buildPredictorTable(moving, recorded, 'dynamic-2bit')!;
    const train = table.trains[0]!;
    const row = table.entries[train.index]!;

    expect(html).toContain(`${row.previous} → ${row.counter}`);
    // The owner label — the branch that owns the row, at its address.
    expect(html).toContain(row.owners[0]!.text);
    // The verdict word, and the relief rule: the hue never travels without it.
    expect(html).toMatch(/CORRECT|MISPREDICT/);
    expect(html).toContain('no branch here');
  });

  /**
   * ⚠ **The 1-bit table has no strength axis, and saying "strongly" for it would overstate the
   * machine.** Keyed off the render because the word is composed in the VIEW from the fold's two
   * facts — a fold assertion would traverse neither branch of that composition.
   *
   * ⚠ **The cycle is DERIVED, and the obvious choice was wrong.** This first read the LAST cycle of
   * `nested-loop.s` and found no strongly-taken counter at all: both loops exit at the end of the
   * run, and each exit weakens its counter from 3 back to 2, so the final frame of the program
   * authored to demonstrate this feature holds `weakly taken` in every taken row. That is step 2's
   * and step 4's finding for the third time — **the canonical demonstration of a mechanism is
   * usually not the test of it** — so the cycle is found by asking for one rather than assumed.
   */
  it('says strongly/weakly only at 2 bits', () => {
    const recorded = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    const saturated = recorded.find((t) => {
      const table = buildPredictorTable(t, recorded, 'dynamic-2bit')!;
      return table.entries.some((e) => e.counter === table.max);
    });
    expect(saturated, 'nested-loop must park a counter at the ceiling somewhere').toBeDefined();
    const twoBit = markup(saturated!, recorded, 'dynamic-2bit');
    expect(twoBit).toContain('strongly taken');
    // Both ends of the range are reachable in one frame: the never-taken guard sits at the floor.
    expect(twoBit).toContain('strongly not taken');
    expect(twoBit).toContain('weakly');
    expect(twoBit).toContain('16 counters × 2 bits');

    const oneBitRun = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-1bit',
    });
    const oneBit = markup(oneBitRun.at(-1)!, oneBitRun, 'dynamic-1bit');
    expect(oneBit).not.toContain('strongly');
    expect(oneBit).not.toContain('weakly');
    expect(oneBit).toContain('16 counters × 1 bit');
  });

  /**
   * The untrained chip carries a non-breaking space rather than being empty — the horizontal AND
   * vertical reserve the cache grid measured at 1.2px per row. Asserted on the MARKUP for the reason
   * `CacheGridView`'s own note gives: put it in a CSS `::after` and it works identically on screen
   * while being invisible to every net that runs on a commit.
   */
  it('reserves the untrained chip in the markup, not in CSS', () => {
    const recorded = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    const html = markup(recorded[0]!, recorded, 'dynamic-2bit');
    expect(html).toContain('predictor-row-chip--idle');
    expect(html).toContain(' ');
  });
});

describe('the follow-highlight joins a training branch', () => {
  it('marks the trained row followed when its branch is the followed instruction', () => {
    const recorded = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    const trained = recorded.find(
      (t) => (buildPredictorTable(t, recorded, 'dynamic-2bit')?.trains.length ?? 0) > 0,
    )!;
    const train = buildPredictorTable(trained, recorded, 'dynamic-2bit')!.trains[0]!;

    expect(markup(trained, recorded, 'dynamic-2bit', train.id)).toContain('dp--follow');
    // Non-vacuity: without the follow it is absent, so the assertion above is not matching a token
    // the panel emits unconditionally.
    expect(markup(trained, recorded, 'dynamic-2bit', null)).not.toContain('dp--follow');
    expect(markup(trained, recorded, 'dynamic-2bit', 'no-such-id')).not.toContain('dp--follow');
  });
});
