/**
 * The prediction control's SHAPE (M4 step 4) — the milestone's headline view decision, pinned.
 *
 * The decision: the config type offers three scheme names and this control renders **two**
 * positions, because the pipeline gives those names two behaviors (`'none'` and
 * `'static-not-taken'` are one machine — a processor with no predictor does not stop and wait, it
 * keeps fetching, and the fall-through IS the not-taken path). A three-position control would
 * assert three machines exist. That is not extra detail for an expert tier to reveal, it is a
 * contradiction of the machine underneath (INV-5), and it breaks the rule the forwarding toggle
 * already lives by: *a control that cannot move anything is worse than no control.*
 *
 * That two positions are ENOUGH is a claim about the engine and is measured in `simulator.test.ts`
 * (the three schemes record exactly two distinct traces). What is pinned HERE is that the control
 * actually is the shape that claim licenses — the two halves are useless apart, since a complete
 * account of a two-behavior machine still lies if the widget grows a third button.
 *
 * ## What this suite structurally cannot see, and it is worth stating rather than implying
 *
 * `renderToStaticMarkup` renders; it does not click. So the CONTROL is pinned and the WIRING —
 * `useSimulator.loadInto` handing the chosen scheme to the engine — is not. Measured, not assumed:
 * deleting `branchPrediction` from `loadInto`'s config leaves all 229 web tests green, which is to
 * say the toggle could be pure decoration and this file would not notice. That is the same gap M3
 * step 5 shipped the forwarding toggle with, and the reason the browser eyeball is this step's real
 * net rather than a formality — it has caught a genuine defect in five consecutive view steps.
 */

import { MAX_ISSUE_WIDTH } from '@cpu-viz/engine-common';
import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { defaultConfig } from '@cpu-viz/trace';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IssueOrderToggle, PredictionToggle, RobSizeControl, WidthToggle } from './App';
import { PipelineDatapath } from './PipelineDatapathView';
import { EXAMPLE_PROGRAMS } from './programs';
import {
  hasTakenBetPath,
  schemeForPosition,
  PREDICTION_POSITIONS,
  type BranchPrediction,
  type PredictionPosition,
} from './session';
import { loadSource } from './simulator';

const noop = (): void => {};

const render = (scheme: BranchPrediction): string =>
  renderToStaticMarkup(<PredictionToggle scheme={scheme} setScheme={noop} />);

/** The label of the position rendered as pressed, or null if none/many are. */
const litPosition = (html: string): string | null => {
  const lit = [...html.matchAll(/aria-pressed="true"[^>]*>([^<]*)</g)].map((m) => m[1]);
  return lit.length === 1 ? lit[0]! : null;
};

describe('the prediction control has one position per MACHINE, not per scheme name', () => {
  it('renders exactly four buttons — one per machine, for five scheme names', () => {
    // The whole decision in one number. `'none'` is deliberately unreachable from the UI: it is
    // only ever the opening value, straight out of `defaultConfig()`, and nothing is lost by
    // omitting it because it is not a machine of its own — it is `'static-not-taken'` under a
    // second name.
    //
    // **It was two until the dynamic-branch-prediction plan's step 3**, and the number moved for a
    // reason worth keeping next to it: the two dynamic schemes were in the union from step 1, but
    // the engine ignored them, so drawing them as "not taken" was TRUE of the shipped machine.
    // Step 3 wired the pipeline's counter table and made it false in the same commit. Four is
    // therefore not "five names minus the unreachable one" — it is the count of machines, which is
    // what `simulator.test.ts` measures against the engine (five schemes, four pairwise-distinct
    // recordings). If a sixth scheme is ever added, THAT test is what says whether this number
    // becomes five.
    expect((render('none').match(/<button/g) ?? []).length).toBe(4);
  });

  it('lights exactly one position, and it names a machine rather than a scheme', () => {
    expect(litPosition(render('static-taken'))).toBe('taken');
    expect(litPosition(render('static-not-taken'))).toBe('not taken');
    expect(litPosition(render('dynamic-1bit'))).toBe('1-bit');
    expect(litPosition(render('dynamic-2bit'))).toBe('2-bit');
  });

  it("lights 'not taken' for 'none' — the coincidence the whole shape rests on", () => {
    // If this is ever wrong the control is not merely mislabeled, it is unusable: `'none'` is what
    // `defaultConfig()` opens on, so a shell that lit neither position (or both) would greet every
    // user with a toggle showing no state at all, on the pipeline's very first load.
    expect(litPosition(render('none'))).toBe('not taken');
  });

  /**
   * Every position the control renders must be REACHABLE — clicking it must write a scheme that
   * lights that same position back.
   *
   * `session.test.ts` pins the round trip through the two mapping literals; this pins it through the
   * RENDER, which is a different claim and the one this repo has been burned by. `m13-width-planned`
   * records a test keyed off a pure fold rather than the render as this codebase's signature defect
   * — it recurred eight times, twice inside the fix written to stop it. A `PREDICTION_POSITIONS`
   * that had drifted from what the buttons draw would satisfy the fold test and fail here.
   */
  it('every rendered button lights itself back', () => {
    // The labels the control ACTUALLY draws, scraped from the markup rather than re-derived from
    // `PREDICTION_POSITIONS` — a sweep over the constant would agree with itself no matter what the
    // buttons said.
    const labels = [...render('none').matchAll(/<button[^>]*>([^<]*)</g)].map((m) => m[1]!);
    expect(labels).toEqual(['not taken', 'taken', '1-bit', '2-bit']);

    // `renderToStaticMarkup` cannot click (see this file's header), so the click is driven through
    // the same mapping the button's `onClick` closes over, and the round trip is closed against the
    // RENDER: re-render under the scheme that click would write, and the same button must light.
    for (const label of labels) {
      const scheme = schemeForPosition(label as PredictionPosition);
      expect(litPosition(render(scheme)), `${label} must light itself back`).toBe(label);
    }
  });

  /**
   * Every button carries a non-empty `title`, and no two share one.
   *
   * `PREDICTION_TITLES` is a `Record<PredictionPosition, string>`, so a MISSING key is a compile
   * error — but an empty string is not, and neither is the same string on two positions, which is
   * what a copy-paste of the two dynamic entries produces. The titles are where this control's whole
   * honesty budget lives (they are the only place the reader is told that a correct bet is not free,
   * and the only place the 1-bit/2-bit difference is stated in words), so "present and distinct" is
   * the least this file can hold them to.
   */
  it('every button carries its own non-empty title', () => {
    const titles = [...render('none').matchAll(/title="([^"]*)"/g)].map((m) => m[1]!);
    expect(titles).toHaveLength(PREDICTION_POSITIONS.length);
    for (const t of titles) expect(t.length).toBeGreaterThan(40);
    expect(new Set(titles).size, 'two positions share a title').toBe(titles.length);
  });
});

/**
 * **The shell → datapath seam for prediction, keyed off the RENDER** (dynamic-branch-prediction
 * step 3).
 *
 * ⚠ **This exists because the break harness measured that nothing else covers it.** `App.tsx` builds
 * the diagram's config as `predictTaken: hasTakenBetPath(sim.branchPrediction)`, and
 * `datapath-pipeline.test.ts` sweeps `DatapathConfig` LITERALS — `{forwarding, predictTaken}` pairs —
 * so it never traverses that function at all. Collapsing `hasTakenBetPath` back to
 * `scheme === 'static-taken'` reddened exactly ONE test, and it was a pure-fold assertion in
 * `session.test.ts`. Without the case below, the branch-target adder and its three wires would blank
 * on the pipeline datapath under BOTH dynamic schemes — on the very config this feature exists to
 * demonstrate — with nothing to say so.
 *
 * That is `cache-grid.ts`'s own recorded defect (a panel that went idle on a shipped, user-reachable
 * config for a whole milestone) and `m13-width-planned.md`'s signature one (a test keyed off a pure
 * fold rather than the render, which recurred eight times and twice inside the fix written to stop
 * it). So this asserts against the MARKUP, and it starts from a SCHEME rather than from a
 * `DatapathConfig`, because the scheme is what the user actually picks.
 *
 * `Branch` appears in exactly one node label in `datapath-pipeline.ts` (`btarget`'s
 * `'Branch\ntarget'`), so its presence in the markup is an unambiguous marker for the adder. The
 * wires are not re-asserted here — `datapath-pipeline.test.ts` already pins that they are visible
 * exactly when their `btarget` endpoint is.
 */
describe('the prediction scheme reaches the datapath, not just the control', () => {
  const trace = (): ReturnType<typeof loadSource> =>
    loadSource(
      EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop')!.source,
      () => new PipelineProcessor(),
      defaultConfig(),
    );

  const markup = (scheme: BranchPrediction): string => {
    const result = trace();
    if (!result.ok) throw new Error('unreachable: sum-loop should assemble');
    result.loaded.recorder.runToEnd();
    return renderToStaticMarkup(
      <PipelineDatapath
        trace={result.loaded.recorder.recorded[0]!}
        cycleKey={0}
        tier="expert"
        // Built exactly as `App.tsx` builds it — the point of this test is the expression, not the
        // diagram. A literal `predictTaken` here would re-test what `datapath-pipeline.ts` already
        // covers and leave the seam uncovered all over again.
        config={{ forwarding: false, predictTaken: hasTakenBetPath(scheme) }}
        followed={null}
      />,
    );
  };

  it('draws the branch-target adder under every scheme that can bet taken', () => {
    // Non-vacuity first: something was rendered at all, and the marker really does discriminate.
    expect(markup('static-not-taken').length, 'nothing rendered').toBeGreaterThan(500);
    expect(markup('static-taken')).toMatch(/Branch/);
    expect(markup('static-not-taken')).not.toMatch(/Branch/);

    // ...and the two schemes this step made real. A dynamic machine HAS the adder — it bets taken
    // the moment a counter warms — so drawing it absent would contradict the machine on screen
    // (INV-5), which is the same rule that forbids drawing a third machine as a second.
    expect(markup('dynamic-1bit'), 'the 1-bit machine has a branch-target adder').toMatch(/Branch/);
    expect(markup('dynamic-2bit'), 'the 2-bit machine has a branch-target adder').toMatch(/Branch/);

    // `'none'` is `'static-not-taken'` under another name, here as everywhere else.
    expect(markup('none')).not.toMatch(/Branch/);
  });
});

/**
 * The issue-width control's SHAPE (M7 step 6) — the fourth config toggle, pinned in the same place
 * and for the same reason as prediction's above.
 *
 * The decision this pins is the DEFAULT POSITION, which is the one thing about this control that is
 * a real choice rather than a consequence. The width opens at **1**: the superscalar's own
 * degenerate case, so a reader arriving from the pipeline sees the machine they just learned, and
 * the flip to 2 is the reveal rather than the starting state. A control that opened 2-wide would
 * still be correct and would silently throw away the milestone's whole A/B.
 *
 * ## The wiring gap, MEASURED for this knob rather than inherited from the note above
 *
 * The header's account of what this suite cannot see holds here, and it was re-provoked rather than
 * assumed: deleting `issueWidth` from `loadInto`'s config left **all 581 web tests green**. So this
 * toggle, too, could be pure decoration and nothing headless would notice.
 *
 * It is worse for width than for the three knobs before it, and worth stating plainly:
 * `ProcessorConfig.issueWidth` is OPTIONAL, so dropping it is not a type error and does not throw —
 * the engine's own `?? 1` quietly runs BOTH positions at width 1. The other three are required
 * fields, and deleting one at least reddens `tsc`. Which makes the browser eyeball not merely this
 * step's real net but the ONLY thing standing between a working toggle and a decorative one.
 */
describe('the width control opens on the degenerate case (M7 step 6)', () => {
  const renderWidth = (width: number): string =>
    renderToStaticMarkup(<WidthToggle width={width} setWidth={noop} />);

  it('renders one position per width the engine admits', () => {
    // M13 step 6 widened this from a literal `2`. **Derived from `MAX_ISSUE_WIDTH`, never typed
    // `4`** — a literal here is the one thing a derived position list does not protect: raising the
    // engine's bound would leave the widest machine unreachable in the product while this test
    // stayed green, which is the exact decay mode steps 1/3/4/6 each installed a guard against.
    expect((renderWidth(1).match(/<button/g) ?? []).length).toBe(MAX_ISSUE_WIDTH);
  });

  it('lights exactly the selected width, at every position', () => {
    // `useSimulator` seeds `issueWidth` to 1, so the FIRST of these is what every reader sees on
    // selecting the superscalar — the decision this block exists to pin, and M13 did not move it:
    // the control still opens on the degenerate case so a reader arriving from the pipeline sees
    // the machine they just learned, and every widening is the reveal. If it lit neither (or both),
    // the model's first impression would be a toggle showing no state — the failure the prediction
    // control's `'none'` case guards against.
    //
    // Swept over all positions rather than checked at 1 and 2, because the label used to be a
    // TERNARY (`position === 2 ? '2-wide' : '1-wide'`) and the widened control's real hazard is a
    // position that renders under another position's name. At two positions that is unimaginable;
    // at four it is one stale ternary away, and nothing else in the repo reads these labels.
    for (const w of Array.from({ length: MAX_ISSUE_WIDTH }, (_, i) => i + 1)) {
      expect(litPosition(renderWidth(w)), `width ${w}`).toBe(`${w}-wide`);
    }
  });

  /**
   * The tooltips, pinned because **nothing else can see them and they are where this control's
   * honesty lives** (M13 step 6).
   *
   * The two-position version keyed its `title` off `position === 2`, so every position that was not
   * 2 got width 1's copy — "the same machine, never finding a partner". Widening the control
   * without widening that ternary would have told a reader at width 3 or 4 that they were running
   * the degenerate machine, in a string no test read and no type checker could reach. That is the
   * `Lesson.depthDefault` class of defect (a declarative field nothing consumes) inverted: a field
   * the READER consumes and no test does.
   *
   * Asserting the distinctness rather than the wording, so copy edits stay free.
   */
  it('gives every position its own tooltip — no position wears another’s copy', () => {
    const titles = [...renderWidth(1).matchAll(/title="([^"]*)"/g)].map((m) => m[1]);
    expect(titles).toHaveLength(MAX_ISSUE_WIDTH);
    expect(new Set(titles).size, 'distinct tooltips').toBe(MAX_ISSUE_WIDTH);
    // The degenerate position is the one whose copy makes a claim about a DIFFERENT model ("the
    // 5-stage pipeline you already know"); no wider position may repeat it.
    expect(titles.filter((t) => t?.includes('5-stage pipeline'))).toHaveLength(1);
  });
});

/**
 * The issue-order control's SHAPE (M9 step 5) — the out-of-order tier's flagship toggle, pinned in
 * the same place and for the same reason as prediction's and width's above.
 *
 * The decision this pins is the DEFAULT POSITION, the one thing about this control that is a real
 * choice rather than a consequence. It opens **in-order** — the out-of-order engine's own degenerate
 * case (issue strictly oldest-first, reproducing the pipeline/superscalar cycle for cycle), so a
 * reader arriving from those models sees the machine they just learned, and the flip to out-of-order
 * is the reveal rather than the starting state. A control that opened out-of-order would still be
 * correct and would silently throw away the milestone's whole A/B.
 *
 * The header's account of what this suite cannot see holds here too: `renderToStaticMarkup` renders,
 * it does not click, so the CONTROL is pinned and the WIRING (`useSimulator.loadInto` handing
 * `outOfOrderIssue` to the engine) is not — and it is worse for this knob than for the three required
 * fields, exactly as for width: `ProcessorConfig.outOfOrderIssue` is OPTIONAL, so dropping it from
 * the config is not a type error and the engine's own `?? false` quietly runs BOTH positions in
 * order. The browser eyeball is the real net.
 */
describe('the issue-order control opens on the degenerate case (M9 step 5)', () => {
  const renderOrder = (on: boolean): string =>
    renderToStaticMarkup(<IssueOrderToggle on={on} setOn={noop} />);

  it('renders exactly two positions — two issue policies, two real machines', () => {
    expect((renderOrder(false).match(/<button/g) ?? []).length).toBe(2);
  });

  it('lights in-order at the position the shell opens on, and out-of-order after the flip', () => {
    // `useSimulator` seeds `outOfOrderIssue` to false, so the first of these is what every reader
    // sees on selecting the out-of-order model. If it lit neither (or both), the model's first
    // impression would be a toggle showing no state.
    expect(litPosition(renderOrder(false))).toBe('in-order');
    expect(litPosition(renderOrder(true))).toBe('out-of-order');
  });
});

/**
 * The ROB-size control's SHAPE (M9 step 5) — the out-of-order tier's secondary, structural lever.
 * Two positions (small / full), not a gradient, because it is the secondary lever and its middle
 * values are no-ops on every non-flagship program. It opens on **full** (the engine's default 16),
 * so the money shot is visible the moment out-of-order issue is flipped on; the small position (4)
 * is the follow-up experiment that chokes the benefit back toward in-order.
 *
 * Like {@link WidthToggle}, the wiring this cannot see is worse than a required field's:
 * `ProcessorConfig.robSize` is OPTIONAL, so a dropped field runs both positions at the engine's `??
 * 16` default. Browser eyeball is the net.
 */
describe('the ROB-size control opens on the full window (M9 step 5)', () => {
  const renderRob = (size: number): string =>
    renderToStaticMarkup(<RobSizeControl size={size} setSize={noop} />);

  it('renders exactly two positions — small and full', () => {
    expect((renderRob(16).match(/<button/g) ?? []).length).toBe(2);
  });

  it('lights full at the size the shell opens on, and small after the shrink', () => {
    expect(litPosition(renderRob(16))).toBe('full');
    expect(litPosition(renderRob(4))).toBe('small');
  });
});
