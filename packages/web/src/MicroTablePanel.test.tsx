/**
 * The micro-structure tables' RENDER seam and the follow-highlight acceptance (M9 step 6).
 *
 * The panel is a pure fold over `state.micro`, so most of what it claims is really a claim about the
 * engine's snapshot (proven headless in `out-of-order/src/recorder.test.ts`). What is checked HERE is
 * what a fold cannot see: that the ROB/RS/rename projections reach the DOM as three tables, that the
 * ready/waiting operand distinction is drawn, and — the step's acceptance — that the follow-highlight
 * lights the same instruction across all three tables at once. Layout and the cross-surface
 * composition WITH the map and datapath remain a browser eyeball, as every view step has needed.
 */

import { CACHE_LARGE, coldPredictorState } from '@cpu-viz/engine-common';
import { OutOfOrderProcessor, type OutOfOrderMicro } from '@cpu-viz/engine-out-of-order';
import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import {
  defaultConfig,
  type CycleTrace,
  type Processor,
  type ProcessorConfig,
} from '@cpu-viz/trace';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { hasMicroTables, MicroTablePanel, preRunMicro } from './MicroTablePanel';
import { EXAMPLE_PROGRAMS } from './programs';
import { loadSource } from './simulator';

const noop = (): void => {};

/** The scheme these renders declare. It matches {@link OOO}'s, which is what makes the pre-run
 *  micro's `predictor: null` the right answer here — a static scheme has no counter table (the
 *  cold-table case is `predictor-table.test.ts`'s, driven from a dynamic recording). */
const SCHEME = 'static-taken' as const;

/** The flagship out-of-order config — the money shot (a miss with independent work behind it). */
const OOO: ProcessorConfig = {
  ...defaultConfig(),
  issueWidth: 2,
  outOfOrderIssue: true,
  branchPrediction: 'static-taken',
  cache: CACHE_LARGE,
  robSize: 16,
};

function record(
  name: string,
  config: ProcessorConfig,
  factory: () => Processor = () => new OutOfOrderProcessor(),
) {
  const source = EXAMPLE_PROGRAMS.find((p) => p.name === name)!.source;
  const result = loadSource(source, factory, config);
  if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
  result.loaded.recorder.runToEnd();
  return result.loaded.recorder.recorded;
}

function render(trace: CycleTrace | null, followed: string | null = null): string {
  return renderToStaticMarkup(
    <MicroTablePanel
      trace={trace}
      recording={trace ? [trace] : []}
      followed={followed}
      onFollow={noop}
      scheme={SCHEME}
    />,
  );
}

const micro = (t: CycleTrace): OutOfOrderMicro => t.state.micro as OutOfOrderMicro;

describe('MicroTablePanel — the gate is a TRACE fact', () => {
  it('appears for an out-of-order recording and for nothing else', () => {
    expect(hasMicroTables(record('array-sum', OOO))).toBe(true);
    // The pipeline carries a `micro` too (its latches / cache), but no `rob` array — so the OoO
    // panel must NOT claim it, the gate-collision the shape was designed to avoid.
    expect(
      hasMicroTables(record('array-sum', defaultConfig(), () => new PipelineProcessor())),
    ).toBe(false);
  });

  it('renders nothing for a non-OoO trace, or with no recording at all', () => {
    const pipeline = record('array-sum', defaultConfig(), () => new PipelineProcessor());
    expect(render(pipeline[3]!)).toBe('');
    // No trace AND no recording: there is nothing anywhere saying this is an out-of-order run.
    expect(render(null)).toBe('');
    // A pipeline RECORDING at the pre-run cursor is the same answer for the same reason — the gate
    // is a trace fact, and the reserve below must not smuggle the panel into another model's shell.
    expect(
      renderToStaticMarkup(
        <MicroTablePanel
          trace={null}
          recording={pipeline}
          followed={null}
          onFollow={noop}
          scheme={SCHEME}
        />,
      ),
    ).toBe('');
  });

  it('DOES render at the pre-run cursor of an out-of-order recording — empty, not absent', () => {
    // The panel is a property of the RECORDING; only its rows are a property of the cursor. It used
    // to fold to `''` here (no trace ⇒ no micro), which took a 526px panel out of the flow and moved
    // the datapath and all three bottom panels up the page the instant you stepped off the start —
    // measured in the shipped bundle, 2026-07-30. See `preRunMicro`.
    const recorded = record('array-sum', OOO);
    const html = renderToStaticMarkup(
      <MicroTablePanel
        trace={null}
        recording={recorded}
        followed={null}
        onFollow={noop}
        scheme={SCHEME}
      />,
    );
    expect(html).not.toBe('');
    // All three tables are present and reserved, and each says its own empty state rather than
    // showing rows from a cycle that has not happened.
    expect(html).toContain('Reorder buffer');
    expect(html).toContain('Reservation stations');
    expect(html).toContain('Rename map');
    expect(html).toContain('empty — nothing in flight');
    expect(html).not.toContain('ROB#');
  });

  /**
   * ⚠ **The fabricated pre-run micro's `predictor` is the COLD table, and this test exists because
   * the value has no other net.** None of the three tables above draws it — the field is there
   * because a fabricated `OutOfOrderMicro` must be a whole one — so reverting it to the step-1
   * `predictor: null` placeholder reddened **zero of 9489 tests** when the step-6 break harness
   * tried it. A wrong fabricated value guarded only by prose is `m13-review-resolved`'s "a pinned
   * decision with no net is a comment", so `preRunMicro` is exported and the claim is asserted.
   *
   * The claim itself: `robCapacity` is a CONFIG fact and copies; `rob`, `rename` and `predictor` are
   * RUN facts and each empties to its own zero — which for a counter table is a SEED, not an
   * absence. `null` would say "this machine has no predictor" about a machine that has one and has
   * merely learnt nothing, and `m.predictor` carried forward would show a fully-TRAINED table before
   * a single instruction had run.
   */
  it('fabricates the pre-run micro with a COLD predictor under a dynamic scheme', () => {
    const recorded = record('array-sum', { ...OOO, branchPrediction: 'dynamic-2bit' });
    const fabricated = preRunMicro(recorded, 'dynamic-2bit');
    expect(fabricated).not.toBeNull();
    // Every RUN fact emptied...
    expect(fabricated!.rob).toEqual([]);
    expect(fabricated!.rename).toEqual([]);
    // ...the counter table to its SEED, from the engine's own definition rather than a literal here.
    expect(fabricated!.predictor).toEqual(coldPredictorState('dynamic-2bit'));
    // ...and the CONFIG fact copied, which is what keeps the ROB spine's reserve at full height.
    expect(fabricated!.robCapacity).toBe(OOO.robSize);

    // The seed is scheme-dependent, so the two schemes must not be interchangeable here.
    expect(preRunMicro(recorded, 'dynamic-1bit')!.predictor).toEqual(
      coldPredictorState('dynamic-1bit'),
    );
    expect(coldPredictorState('dynamic-1bit')).not.toEqual(coldPredictorState('dynamic-2bit'));

    // A static scheme has no table at all, and `null` is then the honest value rather than a
    // placeholder — which is what the recording itself carries on every cycle.
    expect(preRunMicro(recorded, 'static-taken')!.predictor).toBeNull();
  });
});

describe('MicroTablePanel — the three tables reach the DOM', () => {
  const recorded = record('array-sum', OOO);

  /** The first cycle with a waiting RS entry AND a renamed register — all three tables non-empty. */
  const rich = recorded.find((t) => {
    const m = micro(t);
    return m.rob.some((e) => e.state === 'waiting') && m.rename.some((s) => s.kind === 'pending');
  })!;

  it('draws the reorder buffer with a HEAD marker and per-entry state', () => {
    const html = render(rich);
    expect(html).toContain('Reorder buffer');
    expect(html).toContain('ROB#'); // at least one entry
    expect(html).toContain('▶'); // the head marker — the "commits in order" anchor
    // The state column collapses the engine's four-state machine to the reader's three.
    const states = ['waiting', 'executing', 'completed'];
    expect(states.some((s) => html.includes(`>${s}`))).toBe(true);
  });

  it('draws the reservation stations, with an operand waiting on a tag', () => {
    const html = render(rich);
    expect(html).toContain('Reservation stations');
    // Some `'waiting'` entry is parked on an operand it has not received — the wakeup/select picture.
    // (`⤺ ROB#` is the "waiting on this tag" marker the Operand cell draws.)
    const anyWaitingOnTag = recorded.some((t) =>
      micro(t).rob.some(
        (e) => e.state === 'waiting' && [e.srcA, e.srcB].some((o) => o !== null && !o.ready),
      ),
    );
    expect(anyWaitingOnTag).toBe(true);
    // On the flagship program at least one such cycle draws the marker.
    const withMarker = recorded.map((t) => render(t)).find((h) => h.includes('ROB#'));
    expect(withMarker).toBeDefined();
    expect(recorded.map((t) => render(t)).some((h) => h.includes('⤺ ROB#'))).toBe(true);
  });

  it('draws the rename map pointing an architectural register at an in-flight tag', () => {
    const html = render(rich);
    expect(html).toContain('Rename map');
    expect(html).toContain('→ ROB#'); // arch reg → tag
    // A renamed reg's ABI name is present (WAR/WAW-gone story) — read which from the fold itself.
    const pendingReg = micro(rich).rename.findIndex((s) => s.kind === 'pending');
    expect(pendingReg).toBeGreaterThanOrEqual(0);
  });
});

/**
 * THE ACCEPTANCE for step 6's headless half: the follow-highlight selects one id across all three
 * tables at once. Asserted on one cycle, because the claim is that the tables AGREE about which
 * instruction is meant — a followed id whose ROB entry owns a renamed register lights its ROB row,
 * its RS row (if still waiting), and its rename-map row together.
 */
describe('MicroTablePanel — follow-highlight across the three tables', () => {
  const recorded = record('array-sum', OOO);

  it('rings the followed instruction, and drops the ring when nothing is followed', () => {
    // Pick a cycle + id where the followed entry is BOTH still waiting (RS row) and owns a renamed
    // register (rename row) — so the highlight must compose across all three tables, not just the ROB.
    let picked: { trace: CycleTrace; id: string } | null = null;
    for (const t of recorded) {
      const m = micro(t);
      const waiting = m.rob.find(
        (e) =>
          e.state === 'waiting' && m.rename.some((s) => s.kind === 'pending' && s.tag === e.tag),
      );
      if (waiting) {
        picked = { trace: t, id: waiting.id };
        break;
      }
    }
    expect(picked).not.toBeNull();

    const followed = render(picked!.trace, picked!.id);
    // Three rows wear the follow token — the ROB row, the RS row, and the rename-map row. Exactly
    // three: more would mean the highlight is leaking; fewer would mean a table dropped it.
    expect((followed.match(/dp--follow/g) ?? []).length).toBe(3);
    expect(followed).toContain('background:var(--highlight)');

    // Non-vacuity: with nothing followed, no row is ringed.
    expect(render(picked!.trace)).not.toContain('dp--follow');
  });

  it('lights nothing when the followed id is not in flight this cycle', () => {
    const t = recorded.find((c) => micro(c).rob.length > 0)!;
    expect(render(t, 'no-such-id')).not.toContain('dp--follow');
  });
});
