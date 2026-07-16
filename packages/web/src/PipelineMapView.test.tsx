/**
 * The pipeline map's RENDER seam and the follow-highlight acceptance (M3 step 7).
 *
 * The fold already has its own suite (`pipeline-map.test.ts`), and it owns every claim about the
 * grid's shape. What is checked here is what a pure fold structurally cannot see:
 *
 *   - that the view hands each cell the hue of its stage FAMILY, so one cycle really does read as
 *     five instructions in five colors — the thing the surface exists for; and
 *   - **the follow-highlight across all three surfaces** (map, datapath, source panel), which is
 *     the milestone's acceptance line for this step and is not a property of any one of them.
 *
 * Layout aesthetics remain a browser eyeball, as ever — three times now, that is what has caught
 * the real defect while every headless net stayed green.
 */

import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { defaultConfig, type CycleTrace } from '@cpu-viz/trace';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { shownInstruction } from './App';
import { SourcePanel } from './panels';
import { PipelineDatapath } from './PipelineDatapathView';
import { buildPipelineMap } from './pipeline-map';
import { PipelineMap } from './PipelineMapView';
import { EXAMPLE_PROGRAMS } from './programs';
import { loadSource } from './simulator';

const noop = (): void => {};

/** Record a program to completion on the pipeline and hand back the whole recording + program. */
function run(source: string, forwarding = true) {
  const result = loadSource(`${source}\n  li a7, 10\n  ecall\n`, () => new PipelineProcessor(), {
    ...defaultConfig(),
    forwarding,
  });
  if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
  result.loaded.recorder.runToEnd();
  return result.loaded;
}

function renderMap(
  recorded: readonly CycleTrace[],
  opts: { cursor?: number; followed?: string | null } = {},
): string {
  return renderToStaticMarkup(
    <PipelineMap
      recorded={recorded}
      cursor={opts.cursor ?? -1}
      followed={opts.followed ?? null}
      onFollow={noop}
      onSeek={noop}
    />,
  );
}

/** Six independent addis fill the pipe by cycle 4 — no hazards, so all five stages are occupied. */
const FILL =
  ' addi x1, x0, 1\n addi x2, x0, 2\n addi x3, x0, 3\n addi x4, x0, 4\n addi x5, x0, 5\n addi x6, x0, 6';

describe('the map’s render seam', () => {
  /**
   * The surface's whole reason to exist, at the render layer: a cycle where five instructions sit
   * in five stages must paint FIVE DISTINCT HUES. The fold can only say the families differ; that
   * they reach the DOM as five different colors is a claim about this file. (The same shape as step
   * 6's pin on the datapath, and for the same reason — the hue mapping lives in the view.)
   */
  it('strokes five distinct phase hues in one cycle', () => {
    const html = renderMap(run(FILL).recorder.recorded);
    for (const hue of ['--phase-if', '--phase-id', '--phase-ex', '--phase-mem', '--phase-wb']) {
      expect(html).toContain(`var(${hue})`);
    }
  });

  // The relief rule, which the palette's own validation makes mandatory rather than optional: the
  // light-mode phase hues sit below 3:1 on the surface, so a hue may NEVER be the sole carrier. A
  // cell always carries its stage text.
  it('labels every cell with its stage, never hue alone', () => {
    const html = renderMap(run(FILL).recorder.recorded);
    for (const stage of ['IF', 'ID', 'EX', 'MEM', 'WB']) expect(html).toContain(`>${stage}<`);
  });

  it('draws a legend derived from the recording, not a hard-coded five', () => {
    const map = buildPipelineMap(run(FILL).recorder.recorded);
    const html = renderMap(run(FILL).recorder.recorded);
    // Every family the run actually contains gets a swatch — and the fold says which those are.
    expect(map.families).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);
    for (const f of map.families) expect(html).toContain(`>${f}<`);
  });

  /**
   * A flushed row must READ as flushed, not merely stop. The cells keep their stage hue — the pipe
   * genuinely did that work under predict-not-taken — and the dashed/struck treatment plus the ✕
   * marker say it was thrown away. Without a marker a cut row is indistinguishable from "the
   * recording ended here", which is a different fact.
   */
  it('marks a flushed row as killed rather than merely ending it', () => {
    const recorded = run(
      ' addi x1, x0, 1\n beq x0, x0, tgt\n addi x9, x0, 9\n addi x8, x0, 8\ntgt:\n addi x2, x0, 2',
    ).recorder.recorded;
    const html = renderMap(recorded);

    expect(html).toContain('pmap-cell--killed');
    expect(html).toContain('pmap-kill');
    expect(html).toContain('Flushed (branch-taken)');

    // Non-vacuity: a run with no taken branch has neither treatment, so the markers above are
    // caused by the flush and not printed unconditionally.
    const straight = renderMap(run(FILL).recorder.recorded);
    expect(straight).not.toContain('pmap-cell--killed');
    expect(straight).not.toContain('pmap-kill');
  });

  it('marks the cursor’s column as the playhead, and draws none before the run', () => {
    expect(renderMap(run(FILL).recorder.recorded, { cursor: 3 })).toContain('pmap-cursor');
    expect(renderMap(run(FILL).recorder.recorded, { cursor: -1 })).not.toContain('pmap-cursor');
  });
});

/**
 * Paging — the cap that exists for the same reason `TEACHING_MAX_CYCLES` does, one layer down.
 *
 * The engine cap stops a runaway sandbox program from freezing the tab while RECORDING; without a
 * cap here the map would freeze it while DRAWING a recording the engine cap already judged fine.
 * That is not hypothetical: the grid declares explicit tracks, so its layout cost is cycles × rows
 * whether the cells are sparse or not, and a `li t0, 500` countdown — a trivial thing for a user to
 * type into the sandbox — is 3007 cycles × 2001 rows ≈ 6 MILLION grid areas and 2.2 MB of markup,
 * with the engine cap permitting 16× more again. Nothing in the corpus can reach this: `sum-loop`,
 * the longest program we ship, is 78 cycles. So it is the SANDBOX path that needs the net, and only
 * a program written here can test it.
 */
describe('paging — the sandbox net', () => {
  /** A countdown loop: the cheapest way for a user to record far more cycles than can be drawn. */
  const countdown = (n: number) =>
    loadSource(`  li t0, ${n}\nloop:\n  addi t0, t0, -1\n  bnez t0, loop\n  li a7, 10\n  ecall\n`, () => new PipelineProcessor(), { ...defaultConfig(), forwarding: false }); // prettier-ignore

  function longRun(n: number): readonly CycleTrace[] {
    const r = countdown(n);
    if (!r.ok) throw new Error('assembly failed');
    r.loaded.recorder.runToEnd(50_000);
    return r.loaded.recorder.recorded;
  }

  it('draws the whole run when it fits — every corpus program does', () => {
    const html = renderMap(run(FILL).recorder.recorded, { cursor: 4 });
    expect(html).not.toContain('scrub to page');

    // The claim that makes the threshold safe rather than lucky: the longest program we SHIP is far
    // under it, so paging is strictly a sandbox affordance and the teaching path never sees it.
    const longest = Math.max(
      ...EXAMPLE_PROGRAMS.map((p) => {
        const r = loadSource(p.source, () => new PipelineProcessor(), { ...defaultConfig(), forwarding: false }); // prettier-ignore
        if (!r.ok) throw new Error(`corpus program ${p.name} should assemble`);
        r.loaded.recorder.runToEnd();
        return r.loaded.recorder.recordedCycles;
      }),
    );
    expect(longest).toBe(78); // sum-loop, forwarding off — step 3's derived number
    expect(longest).toBeLessThan(400);
  });

  it('bounds the DOM on a run that cannot be drawn at once', () => {
    const recorded = longRun(200);
    expect(recorded.length).toBeGreaterThan(1000); // the recording itself is fine; drawing it is not

    const html = renderMap(recorded, { cursor: 0 });
    const cells = (html.match(/pmap-cell/g) ?? []).length;
    const heads = (html.match(/pmap-head/g) ?? []).length;

    // The whole point: the drawn size is bounded by the PAGE, not by the run.
    expect(heads).toBeLessThanOrEqual(400 + 1);
    expect(cells).toBeLessThan(3000);
    expect(html).toContain(`repeat(400, 30px)`); // explicit tracks are capped too — the real cost

    // Non-vacuity: unpaged, this run would declare a track per cycle. Without the cap the same
    // recording draws >1000 columns, which is the thing being prevented.
    expect(recorded.length).toBeGreaterThan(400);
  });

  it('never truncates silently — it says which window, and of what', () => {
    const html = renderMap(longRun(200), { cursor: 0 });
    // A silent cap would read as "this is the run" while showing a slice. The header must carry
    // both the window and the total, or the map is quietly lying about what it drew.
    expect(html).toContain('cycles 0–399 of');
    expect(html).toContain('scrub to page');
  });

  it('pages to follow the cursor, and the ruler keeps ABSOLUTE cycle numbers', () => {
    const recorded = longRun(200);
    const html = renderMap(recorded, { cursor: 500 });
    expect(html).toContain('cycles 400–799 of');
    // The column is page-relative but the LABEL is not: a ruler that restarted at 0 on every page
    // would make the map disagree with the scrub bar and the transport about what cycle it is.
    expect(html).toContain('>400<');
    expect(html).toContain('Scrub to cycle 500');
    expect(html).not.toContain('Scrub to cycle 399');
  });
});

/**
 * THE ACCEPTANCE: "the follow-highlight selects one id across all three surfaces (map, datapath,
 * source panel)". It is asserted on ONE cycle of ONE recording, with five instructions in flight,
 * because the claim is precisely that the three surfaces agree with each other about which of the
 * five is meant — checking them in three separate fixtures would prove each surface can draw a ring
 * and nothing about whether they ever point at the same instruction.
 */
describe('follow — one id, three surfaces', () => {
  /** The five-in-flight cycle of the fill program, and the instruction sitting in EX in it. */
  function fiveInFlight(): { trace: CycleTrace; loaded: ReturnType<typeof run> } {
    const loaded = run(FILL);
    const trace = loaded.recorder.recorded.find((c) => c.instructions.length === 5);
    if (!trace) throw new Error('the pipeline should reach five in flight on the fill program');
    return { trace, loaded };
  }

  it('rings the followed instruction on the MAP', () => {
    const { trace, loaded } = fiveInFlight();
    const target = trace.instructions.find((i) => i.location === 'EX')!;

    const html = renderMap(loaded.recorder.recorded, { followed: target.id });
    expect(html).toContain('follow-ring');
    // ...and exactly one row wears it: the ring means "this instruction", so a second ringed row
    // would make it mean nothing. One ring per cell of one row = the row's cell count.
    const row = buildPipelineMap(loaded.recorder.recorded).rows.find((r) => r.id === target.id)!;
    expect(html.match(/follow-ring/g)).toHaveLength(row.cells.length);

    expect(renderMap(loaded.recorder.recorded)).not.toContain('follow-ring');
  });

  it('rings the followed instruction’s wires on the DATAPATH', () => {
    const { trace } = fiveInFlight();
    const target = trace.instructions.find((i) => i.location === 'EX')!;

    const html = renderToStaticMarkup(
      <PipelineDatapath
        trace={trace}
        cycleKey={trace.cycle}
        tier="expert"
        config={{ forwarding: true, predictTaken: false }}
        followed={target.id}
      />,
    );
    expect(html).toContain('dp-follow');

    // Non-vacuity, and the sharp half: with five instructions lighting the diagram at once, a view
    // that ringed every ACTIVE wire would look identical at a glance and mean nothing. So the ring
    // must be strictly rarer than the lighting — only the followed instruction's own work.
    const lit = (html.match(/dp-wire--on/g) ?? []).length;
    const rung = (html.match(/dp-follow/g) ?? []).length;
    expect(rung).toBeGreaterThan(0);
    expect(rung).toBeLessThan(lit);

    expect(
      renderToStaticMarkup(
        <PipelineDatapath
          trace={trace}
          cycleKey={trace.cycle}
          tier="expert"
          config={{ forwarding: true, predictTaken: false }}
        />,
      ),
    ).not.toContain('dp-follow');
  });

  it('highlights the followed instruction’s line in the SOURCE panel', () => {
    const { trace, loaded } = fiveInFlight();
    const target = trace.instructions.find((i) => i.location === 'EX')!;

    // The source panel's follow expression is `activeLine`, which App derives via
    // `shownInstruction` — so the surfaces agree only if that retargets to the followed id.
    const shown = shownInstruction(trace.instructions, target.id)!;
    expect(shown.id).toBe(target.id);
    expect(shown.location).toBe('EX');

    const html = renderToStaticMarkup(
      <SourcePanel program={loaded.program} source={loaded.source} activeLine={shown.sourceLine} />,
    );
    expect(html).toContain('background:var(--highlight)');

    // The agreement itself: all three surfaces are pointed at the SAME id, and it is NOT the one
    // the shell would show unfollowed. Without this the three tests above could each be ringing a
    // different instruction and every one of them would still pass.
    const unfollowed = shownInstruction(trace.instructions, null)!;
    expect(unfollowed.location).toBe('WB');
    expect(unfollowed.id).not.toBe(target.id);
  });

  it('falls back to the retiring instruction when the followed one is not in flight', () => {
    const { trace } = fiveInFlight();
    // A live id, but from a cycle this one does not contain — the exact case a scrub produces.
    const shown = shownInstruction(trace.instructions, 'no-such-id');
    expect(shown).not.toBeNull();
    expect(shown!.location).toBe('WB'); // the default, rather than nothing at all
  });

  it('shows nothing rather than inventing something when the pipe is empty', () => {
    expect(shownInstruction([], null)).toBeNull();
    expect(shownInstruction([], 'anything')).toBeNull();
  });
});
