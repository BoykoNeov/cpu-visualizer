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
import { PredictionToggle } from './App';
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
