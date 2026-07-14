/**
 * Headless render smoke tests for the shared {@link DatapathDiagram} renderer through BOTH model
 * wrappers. The activation logic already has its own suites (`datapath.test.ts` /
 * `datapath-multi.test.ts`); what's checked here is the seam those can't see — that the wrappers
 * hand the renderer coherent view-models and the renderer emits the expected SVG: active classes
 * when a real trace lights the path, value labels gated by the depth tier, control labels at
 * `expert` only, and multi-cycle's structural mux-hiding at `essentials`. Layout aesthetics remain
 * an `npm run dev` eyeball, as ever.
 */

import { MultiCycleProcessor } from '@cpu-viz/engine-multi-cycle';
import type { CycleTrace } from '@cpu-viz/trace';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Datapath } from './DatapathView';
import { MultiCycleDatapath } from './MultiCycleDatapathView';
import { loadSource } from './simulator';

/** Assemble `source`, step `cycles` on the chosen engine, and return the trace at the cursor. */
function cycleAt(source: string, cycles: number, multi = false): CycleTrace {
  const result = loadSource(
    `${source}\n  li a7, 10\n  ecall\n`,
    multi ? () => new MultiCycleProcessor() : undefined,
  );
  if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
  const { recorder } = result.loaded;
  for (let i = 0; i < cycles; i++) recorder.stepForward();
  const trace = recorder.current();
  if (!trace) throw new Error(`no trace at cycle ${cycles - 1}`);
  return trace;
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe('single-cycle wrapper × shared renderer', () => {
  const trace = cycleAt('lw x5, 0(x0)', 1);

  it('lights the active path and animates flow on it', () => {
    const html = renderToStaticMarkup(<Datapath trace={trace} cycleKey={0} tier="detailed" />);
    expect(html).toContain('Single-cycle datapath');
    expect(html).toContain('dp-wire--on');
    expect(html).toContain('dp-node-shape--on');
    expect(html).toContain('dp-flow');
    expect(html).toContain('dp-legend'); // the phase color key + idle
    expect(html).toContain('idle');
  });

  it('tiers representation: values at detailed+, control labels at expert only', () => {
    const essentials = renderToStaticMarkup(
      <Datapath trace={trace} cycleKey={0} tier="essentials" />,
    );
    const detailed = renderToStaticMarkup(<Datapath trace={trace} cycleKey={0} tier="detailed" />);
    const expert = renderToStaticMarkup(<Datapath trace={trace} cycleKey={0} tier="expert" />);
    expect(essentials).not.toContain('dp-vlabel-text');
    expect(detailed).toContain('dp-vlabel-text');
    // `lw` drives the ALUSrc mux; its control annotation is expert-only.
    expect(detailed).not.toContain('ALUSrc');
    expect(expert).toContain('ALUSrc');
  });

  it('renders the idle diagram (no active classes) pre-run', () => {
    const html = renderToStaticMarkup(<Datapath trace={null} cycleKey={-1} tier="detailed" />);
    expect(html).toContain('dp-wire');
    expect(html).not.toContain('dp-wire--on');
    expect(html).not.toContain('dp-flow');
  });
});

describe('multi-cycle wrapper × shared renderer', () => {
  const fetch = cycleAt('lw x5, 0(x0)', 1, true);

  it('lights only the fetch slice on cycle 0 and shows the phase chip row', () => {
    const html = renderToStaticMarkup(
      <MultiCycleDatapath trace={fetch} cycleKey={0} tier="detailed" />,
    );
    expect(html).toContain('Multi-cycle datapath');
    expect(html).toContain('dp-wire--on');
    expect(html).toContain('Fetch');
    expect(html).toContain('Writeback');
  });

  it('hides the three muxes structurally at essentials (contraction wires stand in)', () => {
    const essentials = renderToStaticMarkup(
      <MultiCycleDatapath trace={fetch} cycleKey={0} tier="essentials" />,
    );
    const detailed = renderToStaticMarkup(
      <MultiCycleDatapath trace={fetch} cycleKey={0} tier="detailed" />,
    );
    // Polygons = 2 adder silhouettes (pcarith, alu) at essentials; +3 mux trapezoids at detailed.
    expect(count(essentials, '<polygon')).toBe(2);
    expect(count(detailed, '<polygon')).toBe(5);
    // Fetch goes through the IorD mux at detailed; via the contraction the path stays lit at
    // essentials too — both tiers must show an active wire into Memory (INV-5, no contradiction).
    expect(essentials).toContain('dp-wire--on');
    expect(detailed).toContain('dp-wire--on');
  });

  it('shows mux control labels at expert only', () => {
    const detailed = renderToStaticMarkup(
      <MultiCycleDatapath trace={fetch} cycleKey={0} tier="detailed" />,
    );
    const expert = renderToStaticMarkup(
      <MultiCycleDatapath trace={fetch} cycleKey={0} tier="expert" />,
    );
    expect(detailed).not.toContain('IorD');
    expect(expert).toContain('IorD');
  });
});
