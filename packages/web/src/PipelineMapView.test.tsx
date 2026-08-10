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

import { DeepPipelineProcessor } from '@cpu-viz/engine-deep-pipeline';
import { CACHE_LARGE, CACHE_SMALL } from '@cpu-viz/engine-common';
import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { ScoreboardProcessor } from '@cpu-viz/engine-scoreboard';
import {
  defaultConfig,
  type CycleTrace,
  type Processor,
  type ProcessorConfig,
} from '@cpu-viz/trace';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { shownInstruction } from './App';
import { SourcePanel } from './panels';
import { PipelineDatapath } from './PipelineDatapathView';
import { buildPipelineMap } from './pipeline-map';
import { PipelineMap } from './PipelineMapView';
import { EXAMPLE_PROGRAMS } from './programs';
import { loadSource } from './simulator';
import { PHASE_COLORS, T } from './theme';

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

/**
 * M4 STEP 6 — the speculation marks reach the DOM, and the legend keys them.
 *
 * The fold owns every claim about WHICH cells are marked; this owns only what it cannot see. The
 * legend case is here for a reason with a name: step 5 shipped a lesson whose narration rendered
 * `**not**` as literal asterisks because *every test asserted narration RESOLVES, none that it
 * RENDERS*. A glyph the fold sets and the view drops would fail nothing over there.
 */
describe('the speculation marks (M4 step 6)', () => {
  /** `bge` bets and LOSES under static-taken — both marks on one instruction, the corpus's only
   *  "the machine guessed, and the guess was wrong". */
  function callReturn(predictTaken: boolean): readonly CycleTrace[] {
    const program = EXAMPLE_PROGRAMS.find((p) => p.name === 'call-return')!;
    const result = loadSource(program.source, () => new PipelineProcessor(), {
      ...defaultConfig(),
      branchPrediction: predictTaken ? 'static-taken' : 'static-not-taken',
    });
    if (!result.ok) throw new Error('assembly failed');
    result.loaded.recorder.runToEnd();
    return result.loaded.recorder.recorded;
  }

  const count = (html: string, needle: string): number => html.split(needle).length - 1;

  it('draws a bet and a misprediction, and no bet under a scheme that makes none', () => {
    // The legend states each key with the mark's own class, so ONE of each is the key itself and
    // anything beyond it is a real cell. Counting rather than `toContain` is what makes the
    // not-taken case below say something: a bare `toContain('pmap-mark--bet')` is satisfied by the
    // legend alone and would pass against a view that never marked a cell at all.
    const on = renderMap(callReturn(true));
    expect(count(on, 'pmap-mark--bet')).toBeGreaterThan(1);
    expect(count(on, 'pmap-mark--wrong')).toBeGreaterThan(1);

    // Predict-not-taken performs no action at ID, so no cell carries a bet — the key, and only the
    // key. But there ARE mispredictions (more of them, in fact: every taken transfer mispredicts
    // there). The marks are not config-gated and the map has no config; it draws what the trace
    // contains, which is why the same view serves both schemes.
    const off = renderMap(callReturn(false));
    expect(count(off, 'pmap-mark--bet')).toBe(1);
    expect(count(off, 'pmap-mark--wrong')).toBeGreaterThan(1);
  });

  // The relief rule: a glyph with no key is a puzzle. Both marks are keyed, with the same glyph the
  // grid draws — which is exactly why the legend reuses the mark's own class rather than restating
  // its colour, so a key and its cells cannot drift apart.
  it('keys both marks in the legend, with the glyphs it draws', () => {
    const html = renderMap(callReturn(true));
    expect(html).toContain('= bet');
    expect(html).toContain('= mispredicted');
    expect(html).toContain('= flushed'); // the shipped key, unmoved: ✕ still means its victims
  });

  // A mark is an annotation ABOUT a cell, so it must not be read as part of the cell's stage text.
  // The cell's TEXT is pinned to be the raw `location` verbatim (the relief rule) — appending a
  // glyph to it would break that contract, so the mark is a separate element the accessible name
  // excludes and the title carries instead.
  it('keeps the mark out of the cell’s stage text, and in its title', () => {
    const html = renderMap(callReturn(true));
    expect(html).not.toContain('>ID?<');
    expect(html).not.toContain('>EX!<');
    expect(html).toContain('Bet — the predictor redirected fetch');
    expect(html).toContain('Mispredicted — it resolved the other way');
  });
});

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
 * with the engine cap permitting 16× more again. Nothing in the corpus can reach this: the longest
 * program we ship, `array-sum-twice`, is 290 cycles — deliberately under the page cap. So it is the
 * SANDBOX path that needs the net, and only a program written here can test it.
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

    // The claim that makes the threshold safe rather than lucky: the longest program we SHIP is
    // under it. **Measured per MODEL, because it is not a property of the corpus alone** — a longer
    // machine runs the same program for more cycles, and this test asserted the 5-stage's number
    // while describing every model. M11 step 6 is where that stopped being harmless.
    const longestOn = (make: () => Processor, config: ProcessorConfig): number =>
      Math.max(
        ...EXAMPLE_PROGRAMS.map((p) => {
          const r = loadSource(p.source, make, config);
          if (!r.ok) throw new Error(`corpus program ${p.name} should assemble`);
          r.loaded.recorder.runToEnd();
          return r.loaded.recorder.recordedCycles;
        }),
      );
    const OFF: ProcessorConfig = { ...defaultConfig(), forwarding: false };

    // `array-sum-twice`, forwarding off — its double walk of a 12-element array makes it the longest
    // program the corpus ships (290 = timing.test.ts's derived N+4+S+P for it), displacing
    // sum-loop's 78. It is sized to STAY under this page cap on purpose (the same reason it is 12
    // words and not 24).
    expect(longestOn(() => new PipelineProcessor(), OFF)).toBe(290);

    // **The DEEP pipeline has almost no headroom, and with a cache it has none — recorded as a FACT
    // rather than left as a surprise.** The same program is 392 cycles here (two more stages of
    // drain, an ALU→ALU bubble the 5-stage forwards away, and a doubled load-use penalty), which is
    // 8 cycles under the cap; adding the M11 step-6 cache pushes it to 422 at four lines and 442 at
    // two, because each of the 3–5 misses costs a flat 10.
    //
    // So "paging is a sandbox-only affordance" is TRUE of every model through M7 and FALSE of
    // `deep-pipeline` with a cache on. That is accepted rather than fixed: paging is a designed,
    // tested affordance (the next test bounds the DOM it draws), and the alternatives are worse —
    // re-cutting `DEFAULT_MISS_PENALTY` would move every model's pinned cache numbers, and raising
    // the cap would loosen the DOM bound for every model to spare one. What is NOT acceptable is a
    // comment claiming the teaching path never pages while it does; this repo has already been bitten
    // by a comment asserting a case unreachable being how the case stopped being checked.
    expect(longestOn(() => new DeepPipelineProcessor(), OFF)).toBe(392);
    expect(longestOn(() => new DeepPipelineProcessor(), { ...OFF, cache: CACHE_LARGE })).toBe(422);
    expect(longestOn(() => new DeepPipelineProcessor(), { ...OFF, cache: CACHE_SMALL })).toBe(442);
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

/**
 * **M15 step 5 — the seventh model renders on the SHARED map, and this is where the milestone's
 * falsifiable UNCHANGED criterion ("`pipeline-map.ts` needs no edit") is paid out or not.**
 *
 * The criterion could not close before this step for a reason worth keeping: step 1 proved the
 * ENGINE emits only `IF ID RO EX MEM WB` as a `location` (its own suite enumerates the set), which
 * bought half of it — no functional-unit name can leak into {@link stageFamily} and mint an `INT`
 * family. But **nothing rendered this model until the picker row landed**, so the other half — that
 * the shared fold and the shared view actually draw it — was untestable by position, exactly the
 * shape `docs/memory/m13-review-resolved.md` names.
 *
 * What makes it non-trivial is the hue. `PHASE_COLORS` holds exactly the five validated phases, and
 * this machine has six stages, so `RO` has no hue of its own. That is the whole reason decision 2
 * named the stages `ID`/`WB` rather than the textbook `IS`/`WR` and had the memory unit report
 * `MEM`: honest names that also leave five of six families carrying a validated hue instead of
 * minting four new ones. The sixth takes the documented neutral fallback and stays readable by its
 * cell TEXT (the relief rule) — a view that falls back rather than crashing, per the fold's docs.
 */
describe('the scoreboard on the shared map (M15 step 5)', () => {
  function scoreboard(name: string) {
    const program = EXAMPLE_PROGRAMS.find((p) => p.name === name)!;
    const result = loadSource(program.source, () => new ScoreboardProcessor(), defaultConfig());
    if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
    result.loaded.recorder.runToEnd();
    return result.loaded.recorder.recorded;
  }

  it('derives the stage set from the RECORDING — two programs, one model, different sets', () => {
    // First-seen order, which is what the legend renders in. `MEM` arrives last on `array-sum`
    // because the first load issues after the address arithmetic ahead of it has already walked.
    expect(buildPipelineMap(scoreboard('array-sum')).families).toEqual([
      'IF',
      'ID',
      'RO',
      'EX',
      'WB',
      'MEM',
    ]);
    // ⚠ The non-vacuity, and it is the claim that a hard-coded six-element list would fail:
    // `sum-loop` touches no memory, so the SAME model yields five stages rather than six. A fold
    // that named the set instead of deriving it would draw this machine an empty MEM column.
    expect(buildPipelineMap(scoreboard('sum-loop')).families).toEqual([
      'IF',
      'ID',
      'RO',
      'EX',
      'WB',
    ]);
  });

  it('leaves exactly ONE family without a validated phase hue, and it is RO', () => {
    // Asserted as a set difference rather than as "RO is missing", because the claim decision 2
    // rests on is the COUNT: five of six carry a validated hue. A stage rename that quietly cost a
    // second family its hue would satisfy the weaker form.
    const families = buildPipelineMap(scoreboard('array-sum')).families;
    expect(families.filter((f) => PHASE_COLORS[f] === undefined)).toEqual(['RO']);
  });

  it('renders every family, with RO alone taking the documented neutral fallback', () => {
    const html = renderMap(scoreboard('array-sum'), { cursor: 20 });
    // Every validated hue reaches the DOM — the map is drawing this model, not falling through to
    // an empty grid. `--cell-hue` is the custom property the cell's background reads.
    for (const family of ['IF', 'ID', 'EX', 'MEM', 'WB']) {
      expect(html, `${family} cells should carry their phase hue`).toContain(
        `--cell-hue:${PHASE_COLORS[family]}`,
      );
    }
    // And the sixth takes the accent, which is the fallback the fold's docblock promises rather
    // than a guessed-at sixth hue (no new color token — the milestone's third UNCHANGED criterion).
    expect(html).toContain(`--cell-hue:${T.accent}`);
    // Non-vacuity: the accent could arrive from anywhere in the markup, so the RO cells must
    // actually be there to have produced it, and their TEXT is what keeps them legible without one.
    expect(html).toContain('>RO<');
  });
});
