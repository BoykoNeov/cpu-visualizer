/**
 * DEV-ONLY screenshot harness (not shipped, not a test). Renders the REAL datapath components to
 * static SVG for chosen instruction × tier, wraps them in one HTML page with the live styles.css
 * inlined, and writes it to M:\claud_projects\temp so a headless Chrome pass can rasterize it for a
 * visual eyeball of layout/routing/color. Run with:  npx vitest run src/_snap.render.ts  (it is a
 * plain module executed for its side effects; kept out of the *.test.ts glob-critical paths only by
 * name — vitest picks it up because we invoke it explicitly).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MultiCycleProcessor } from '@cpu-viz/engine-multi-cycle';
import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { defaultConfig, type CycleTrace } from '@cpu-viz/trace';
import { renderToStaticMarkup } from 'react-dom/server';
import { it } from 'vitest';

// Opt-in only: `SNAP=1 vitest run src/_snap.render.test.ts`. A bare `npm test` skips the file I/O.
const RUN = process.env.SNAP ? it : it.skip;
import { Datapath } from './DatapathView';
import { MultiCycleDatapath } from './MultiCycleDatapathView';
import { PipelineDatapath } from './PipelineDatapathView';
import { PipelineMap } from './PipelineMapView';
import { loadSource } from './simulator';
import type { DepthTier } from '@cpu-viz/curriculum';

const here = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(here, 'styles.css'), 'utf8');
const OUT = 'M:/claud_projects/temp/datapath-snap';

function traceAt(source: string, cycles: number, multi: boolean): CycleTrace {
  const result = loadSource(
    `${source}\n  li a7, 10\n  ecall\n`,
    multi ? () => new MultiCycleProcessor() : undefined,
  );
  if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
  const { recorder } = result.loaded;
  for (let i = 0; i < cycles; i++) recorder.stepForward();
  const trace = recorder.current();
  if (!trace) throw new Error(`no trace at cycle ${cycles}`);
  return trace;
}

/** The pipeline's counterpart — the only model whose trace depends on the CONFIG, which is the
 *  whole reason its snapshots come in pairs. */
function pipelineAt(source: string, cycles: number, forwarding: boolean): CycleTrace {
  const result = loadSource(`${source}\n  li a7, 10\n  ecall\n`, () => new PipelineProcessor(), {
    ...defaultConfig(),
    forwarding,
  });
  if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
  const { recorder } = result.loaded;
  for (let i = 0; i < cycles; i++) recorder.stepForward();
  const trace = recorder.current();
  if (!trace) throw new Error(`no trace at cycle ${cycles}`);
  return trace;
}

/** The pipeline map's counterpart to {@link pipelineAt}: the map folds the WHOLE recording, not a
 *  cycle, so this hands back every trace rather than the one at the cursor. */
function pipelineRun(source: string, forwarding: boolean): CycleTrace[] {
  const result = loadSource(`${source}\n  li a7, 10\n  ecall\n`, () => new PipelineProcessor(), {
    ...defaultConfig(),
    forwarding,
  });
  if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
  const { recorder } = result.loaded;
  recorder.runToEnd();
  return [...recorder.recorded];
}

/** One labelled SVG block. */
function block(title: string, svg: string): string {
  return `<figure><figcaption>${title}</figcaption>${svg}</figure>`;
}

function page(theme: 'light' | 'dark', body: string): string {
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf8"><style>${CSS}
    body{background:var(--page);margin:0;padding:16px;font-family:system-ui}
    figure{margin:0 0 20px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px}
    figcaption{font:600 13px system-ui;color:var(--ink);margin-bottom:4px}
    .panel{background:transparent!important;border:0!important}
  </style></head><body>${body}</body></html>`;
}

function emit(name: string, blocks: string): void {
  for (const theme of ['light', 'dark'] as const) {
    writeFileSync(`${OUT}-${name}-${theme}.html`, page(theme, blocks), 'utf8');
  }
}

RUN('emit datapath snapshots', () => {
  const tiers: DepthTier[] = ['essentials', 'detailed', 'expert'];

  // Single-cycle: whole path lit for one instruction, across tiers. `lw` is the fullest path.
  {
    const t = traceAt('lw x5, 8(x0)', 1, false);
    const blocks = tiers
      .map(
        (tier) =>
        block(`single-cycle · lw · ${tier}`, renderToStaticMarkup(<Datapath trace={t} cycleKey={0} tier={tier} />)), // prettier-ignore
      )
      .join('');
    emit('sc-lw', blocks);

    // Store & branch stress the WB fan-in / PC-select paths differently.
    const store = traceAt('sw x6, 12(x5)', 1, false);
    const branch = traceAt('beq x5, x6, tgt\n nop\ntgt:', 1, false);
    emit(
      'sc-mix',
      block('single-cycle · sw · expert', renderToStaticMarkup(<Datapath trace={store} cycleKey={0} tier="expert" />)) + // prettier-ignore
        block('single-cycle · beq · expert', renderToStaticMarkup(<Datapath trace={branch} cycleKey={0} tier="expert" />)), // prettier-ignore
    );
  }

  // Focused single-figure pages (one diagram each) for legible screenshots of the label-dense views.
  {
    const lw = traceAt('lw x5, 8(x0)', 1, false);
    const sw = traceAt('sw x6, 12(x5)', 1, false);
    const add = traceAt('add x7, x5, x6', 1, false);
    const jal = traceAt('jal x1, tgt\n nop\ntgt:', 1, false);
    emit('sc-focus-lw', block('single-cycle · lw · expert', renderToStaticMarkup(<Datapath trace={lw} cycleKey={0} tier="expert" />))); // prettier-ignore
    emit('sc-focus-sw', block('single-cycle · sw · expert', renderToStaticMarkup(<Datapath trace={sw} cycleKey={0} tier="expert" />))); // prettier-ignore
    emit('sc-focus-add', block('single-cycle · add · expert', renderToStaticMarkup(<Datapath trace={add} cycleKey={0} tier="expert" />))); // prettier-ignore
    emit('sc-focus-jal', block('single-cycle · jal · expert', renderToStaticMarkup(<Datapath trace={jal} cycleKey={0} tier="expert" />))); // prettier-ignore
  }

  // Multi-cycle: each phase is one cycle — snapshot the busiest phases of a load across tiers.
  {
    const t = traceAt('lw x5, 8(x0)', 3, true); // cycle 3 ≈ EX phase
    const blocks = tiers
      .map(
        (tier, i) =>
        block(`multi-cycle · lw@EX · ${tier}`, renderToStaticMarkup(<MultiCycleDatapath trace={t} cycleKey={i} tier={tier} />)), // prettier-ignore
      )
      .join('');
    emit('mc-lw', blocks);

    // One focused expert page per phase of a load (IF/ID/EX/MEM/WB = cycles 1..5) for legibility.
    for (let phase = 1; phase <= 5; phase++) {
      const tr = traceAt('lw x5, 8(x0)', phase, true);
      const loc = tr.instructions[0]?.location ?? `c${phase}`;
      emit(`mc-focus-${loc}`, block(`multi-cycle · lw@${loc} · expert`, renderToStaticMarkup(<MultiCycleDatapath trace={tr} cycleKey={phase} tier="expert" />))); // prettier-ignore
    }
    // A jal WB exercises the pcarith → wbmux writeback path.
    const jw = traceAt('jal x1, tgt\n nop\ntgt:', 3, true);
    emit('mc-focus-jalWB', block('multi-cycle · jal@WB · expert', renderToStaticMarkup(<MultiCycleDatapath trace={jw} cycleKey={3} tier="expert" />))); // prettier-ignore
  }

  // Pipeline: the eyeball has TWO axes here, and the config one is the reason this block exists —
  // the forwarding network must be visibly ABSENT with the toggle off, not drawn-and-idle. Every
  // page is a FULL PIPE (five instructions, five stages, five hues at once), because a diagram that
  // looked right with one instruction in it would say nothing about the model this tier is for.
  {
    // Six independent addis fill the pipe by cycle 4 — no hazards, so all five stages are occupied.
    const FILL = ' addi x1, x0, 1\n addi x2, x0, 2\n addi x3, x0, 3\n addi x4, x0, 4\n addi x5, x0, 5\n addi x6, x0, 6'; // prettier-ignore
    const full = pipelineAt(FILL, 5, true);
    const blocks = tiers
      .map(
        (tier) =>
        block(`pipeline · full pipe · ${tier} · fwd on`, renderToStaticMarkup(<PipelineDatapath trace={full} cycleKey={4} tier={tier} forwarding />)), // prettier-ignore
      )
      .join('');
    emit('pl-fill', blocks);

    // The flagship comparison, side by side and same tier: the ONLY difference must be the
    // forwarding network's existence. A RAW chain, at the cycle its consumer executes.
    const raw = ' addi x1, x0, 7\n add x2, x1, x1\n sub x3, x2, x1';
    emit(
      'pl-toggle',
      block('pipeline · RAW · expert · fwd ON (network present)', renderToStaticMarkup(<PipelineDatapath trace={pipelineAt(raw, 4, true)} cycleKey={3} tier="expert" forwarding />)) + // prettier-ignore
        block('pipeline · RAW · expert · fwd OFF (network absent)', renderToStaticMarkup(<PipelineDatapath trace={pipelineAt(raw, 4, false)} cycleKey={3} tier="expert" forwarding={false} />)), // prettier-ignore
    );

    // Focused expert pages: the load-use bubble (the stall that survives forwarding, lighting the
    // hazard unit) and a taken branch (the redirect M2's datapath could not honestly draw).
    emit('pl-focus-loaduse', block('pipeline · load-use stall · expert · fwd on', renderToStaticMarkup(<PipelineDatapath trace={pipelineAt(' lw x1, 64(x0)\n add x2, x1, x1', 4, true)} cycleKey={3} tier="expert" forwarding />))); // prettier-ignore
    emit('pl-focus-branch', block('pipeline · taken branch redirect · expert · fwd on', renderToStaticMarkup(<PipelineDatapath trace={pipelineAt(' addi x1, x0, 1\n beq x0, x0, tgt\n addi x9, x0, 9\ntgt:\n addi x2, x0, 2', 4, true)} cycleKey={3} tier="expert" forwarding />))); // prettier-ignore
  }

  // The pipeline map (step 7). Unlike every block above, these render the WHOLE RECORDING rather
  // than one cycle — the map is a grid of instructions × cycles, so a single trace would say
  // nothing about it. The programs are deliberately SHORT: the point of these pages is whether the
  // grid lands its cells in the right columns and whether the hues, the kill marker and the follow
  // ring read at all, and a 78-cycle corpus program would simply scroll out of a screenshot. The
  // scroll/sticky behaviour needs the live app, not a static page.
  {
    const mapPage = (title: string, recorded: CycleTrace[], cursor: number, followed: string | null = null) =>
      block(title, renderToStaticMarkup(<PipelineMap recorded={recorded} cursor={cursor} followed={followed} onFollow={() => {}} onSeek={() => {}} />)); // prettier-ignore

    // The staircase: six independent instructions overlapping in time. THE picture this surface
    // exists for, and the one no other surface in the app can draw.
    const SIX = ' addi x1, x0, 1\n addi x2, x0, 2\n addi x3, x0, 3\n addi x4, x0, 4\n addi x5, x0, 5\n addi x6, x0, 6'; // prettier-ignore
    const fill = pipelineRun(SIX, true);
    emit(
      'map-fill',
      mapPage('pipeline map · six independent instructions · the staircase', fill, 4),
    );

    // The flagship toggle as a SHAPE rather than a cycle count: same program, same page, and the
    // only difference is how ragged the staircase is. If the two look alike, the surface is failing
    // at its headline job.
    const raw = ' addi x1, x0, 7\n add x2, x1, x1\n sub x3, x2, x1\n xor x4, x3, x2';
    emit(
      'map-toggle',
      mapPage('pipeline map · RAW chain · fwd ON (tight staircase)', pipelineRun(raw, true), 5) +
        mapPage(
          'pipeline map · RAW chain · fwd OFF (repeated cells = stalls)',
          pipelineRun(raw, false),
          5,
        ),
    );

    // Cut rows: a taken branch kills the two younger instructions, which must read as thrown-away
    // work (struck, dashed, ✕) rather than as a row that merely stopped.
    emit('map-flush', mapPage('pipeline map · taken branch · two cut rows', pipelineRun(' addi x1, x0, 1\n beq x0, x0, tgt\n addi x9, x0, 9\n addi x8, x0, 8\ntgt:\n addi x2, x0, 2', true), 4)); // prettier-ignore

    // The load-use bubble that survives forwarding — the one stall the toggle cannot remove, as a
    // repeated cell.
    emit('map-loaduse', mapPage('pipeline map · load-use · the bubble forwarding cannot remove', pipelineRun(' lw x1, 64(x0)\n add x2, x1, x1\n addi x3, x0, 3', true), 4)); // prettier-ignore

    // The follow ring, which must be legible ON TOP of a stage hue (it is hue-free for exactly this
    // reason) and must pick out ONE row from the tangle.
    const followed = fill.find((c) => c.instructions.length === 5)?.instructions.find((i) => i.location === 'EX')?.id ?? null; // prettier-ignore
    emit(
      'map-follow',
      mapPage('pipeline map · following one instruction (dashed --ink ring)', fill, 4, followed),
    );
  }
});
