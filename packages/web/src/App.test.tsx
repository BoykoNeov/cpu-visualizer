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

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PredictionToggle, WidthToggle } from './App';
import type { BranchPrediction } from './session';

const noop = (): void => {};

const render = (scheme: BranchPrediction): string =>
  renderToStaticMarkup(<PredictionToggle scheme={scheme} setScheme={noop} />);

/** The label of the position rendered as pressed, or null if none/many are. */
const litPosition = (html: string): string | null => {
  const lit = [...html.matchAll(/aria-pressed="true"[^>]*>([^<]*)</g)].map((m) => m[1]);
  return lit.length === 1 ? lit[0]! : null;
};

describe('the prediction control has two positions, not one per scheme name (M4 step 4)', () => {
  it('renders exactly two buttons', () => {
    // The whole decision in one number. `'none'` is deliberately unreachable from the UI: it is
    // only ever the opening value, straight out of `defaultConfig()`, and nothing is lost by
    // omitting it because there is no third machine to reach.
    expect((render('none').match(/<button/g) ?? []).length).toBe(2);
  });

  it('lights exactly one position, and it names a behavior rather than a scheme', () => {
    expect(litPosition(render('static-taken'))).toBe('taken');
    expect(litPosition(render('static-not-taken'))).toBe('not taken');
  });

  it("lights 'not taken' for 'none' — the coincidence the whole shape rests on", () => {
    // If this is ever wrong the control is not merely mislabeled, it is unusable: `'none'` is what
    // `defaultConfig()` opens on, so a shell that lit neither position (or both) would greet every
    // user with a toggle showing no state at all, on the pipeline's very first load.
    expect(litPosition(render('none'))).toBe('not taken');
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

  it('renders exactly two positions — two widths, two real machines', () => {
    expect((renderWidth(1).match(/<button/g) ?? []).length).toBe(2);
  });

  it('lights 1-wide at the width the shell opens on, and 2-wide after the flip', () => {
    // `useSimulator` seeds `issueWidth` to 1, so the first of these is what every reader sees on
    // selecting the superscalar. If it lit neither (or both), the model's first impression would be
    // a toggle showing no state — the failure the prediction control's `'none'` case guards against.
    expect(litPosition(renderWidth(1))).toBe('1-wide');
    expect(litPosition(renderWidth(2))).toBe('2-wide');
  });
});
