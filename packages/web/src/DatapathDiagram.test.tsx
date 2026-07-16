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
import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { defaultConfig, type CycleTrace } from '@cpu-viz/trace';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Datapath } from './DatapathView';
import { MultiCycleDatapath } from './MultiCycleDatapathView';
import { PipelineDatapath } from './PipelineDatapathView';
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

/** The pipeline's counterpart: the trace at `cycles`, recorded under a chosen forwarding position
 *  — the only model whose trace (and whose diagram) depends on the config. */
function pipelineAt(source: string, cycles: number, forwarding: boolean): CycleTrace {
  const result = loadSource(`${source}\n  li a7, 10\n  ecall\n`, () => new PipelineProcessor(), {
    ...defaultConfig(),
    forwarding,
  });
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

describe('pipeline wrapper × shared renderer', () => {
  // Six independent `addi`s fill the pipe by cycle 4 — five stages, five instructions.
  const FILL = '  addi x1, x0, 1\n  addi x2, x0, 2\n  addi x3, x0, 3\n  addi x4, x0, 4\n  addi x5, x0, 5\n  addi x6, x0, 6'; // prettier-ignore
  const full = pipelineAt(FILL, 5, true);
  // A distance-1 RAW whose consumer is in EX, forwarding from EX/MEM.
  const forwarded = pipelineAt('  addi x1, x0, 7\n  add x2, x1, x1', 4, true);
  const render = (trace: CycleTrace, tier: 'essentials' | 'detailed' | 'expert', fwd: boolean) =>
    renderToStaticMarkup(
      <PipelineDatapath trace={trace} cycleKey={0} tier={tier} forwarding={fwd} />,
    );

  it('strokes one cycle in MANY stage hues at once — the thing no earlier model could', () => {
    // The render seam of the multi-instruction claim: single-cycle and multi-cycle paint their
    // whole lit slice ONE color, because they have one instruction (and, for M2, one phase) per
    // cycle. Here five stages light for five instructions, so several validated phase hues must
    // appear in the SAME markup. The pure activation suite cannot see this — it ends at the hue.
    expect(full.instructions).toHaveLength(5);
    const html = render(full, 'detailed', true);
    expect(html).toContain('Pipeline datapath');
    expect(html).toContain('dp-wire--on');
    expect(html).toContain('dp-flow');
    const hues = (['if', 'id', 'ex', 'mem', 'wb'] as const).filter((s) =>
      html.includes(`stroke:var(--phase-${s})`),
    );
    expect(hues, 'a cycle with five in flight must stroke five stage hues').toEqual([
      'if',
      'id',
      'ex',
      'mem',
      'wb',
    ]);
    // The legend names the stages rather than leaving hue as the sole carrier.
    expect(html).toContain('Fetch');
    expect(html).toContain('Writeback');
  });

  it('hides the forwarding and hazard structure below expert (contraction wires stand in)', () => {
    // Shaped nodes: pcmux + add4 + alu + pcarith = 4 at essentials; + wbmux at detailed; + the two
    // forwarding muxes at expert. The path stays lit at every tier — omission, never contradiction.
    expect(count(render(forwarded, 'essentials', true), '<polygon')).toBe(4);
    expect(count(render(forwarded, 'detailed', true), '<polygon')).toBe(5);
    expect(count(render(forwarded, 'expert', true), '<polygon')).toBe(7);
    for (const tier of ['essentials', 'detailed', 'expert'] as const) {
      expect(render(forwarded, tier, true)).toContain('dp-wire--on');
    }
  });

  it('the forwarding unit VANISHES when forwarding is off — it does not merely go idle', () => {
    // The milestone's config-driven structure, at the seam that draws it. Asserted as a shape
    // count and a label, not just "the diagram differs": a forwarding network rendered dim would
    // pass any test that only compared the two markups, and it is exactly the wrong picture —
    // the trace has no `forward` events in this position, so drawing the network contradicts it.
    const on = render(forwarded, 'expert', true);
    const off = render(pipelineAt('  addi x1, x0, 7\n  add x2, x1, x1', 4, false), 'expert', false);
    expect(count(on, '<polygon')).toBe(7);
    expect(count(off, '<polygon'), 'the two forwarding muxes must be gone, not dim').toBe(5);
    expect(on).toContain('Forwarding');
    expect(off).not.toContain('Forwarding');
    expect(on).toContain('ForwardA');
    expect(off).not.toContain('ForwardA');
    // ...while the hazard unit survives the flip: the interlock is live in BOTH positions.
    expect(on).toContain('Hazard');
    expect(off).toContain('Hazard');
  });

  it('tiers representation: values at detailed+, control labels at expert only', () => {
    expect(render(full, 'essentials', true)).not.toContain('dp-vlabel-text');
    expect(render(full, 'detailed', true)).toContain('dp-vlabel-text');
    expect(render(full, 'detailed', true)).not.toContain('MemtoReg');
    expect(render(full, 'expert', true)).toContain('MemtoReg');
  });

  it('renders the idle diagram (no active classes) pre-run', () => {
    const html = renderToStaticMarkup(
      <PipelineDatapath trace={null} cycleKey={-1} tier="detailed" forwarding />,
    );
    expect(html).toContain('dp-wire');
    expect(html).not.toContain('dp-wire--on');
    expect(html).not.toContain('dp-flow');
  });
});
