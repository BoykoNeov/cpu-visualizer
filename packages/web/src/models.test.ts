import { describe, expect, it } from 'vitest';
import { defaultConfig, type ProcessorCapabilities } from '@cpu-viz/trace';
import { MODELS, modelById, DEFAULT_MODEL_ID } from './models';
import { EXAMPLE_PROGRAMS } from './programs';
import { loadSource } from './simulator';

/**
 * The model family table (handoff §2) — the one place that knows which microarchitectures exist.
 * It is plain data, so nothing here type-checks the pairing of a row's fields: a copy-pasted row
 * could hand one model's `capabilities` to another model's `make`, and the only symptom would be a
 * config control silently appearing on (or vanishing from) the wrong model. These are the guards
 * that make the table's claims checkable rather than merely asserted.
 */
describe('the model table', () => {
  it('lists the five microarchitectures built so far, with unique ids', () => {
    expect(MODELS.map((m) => m.id)).toEqual([
      'single-cycle',
      'multi-cycle',
      'pipeline',
      'superscalar',
      'out-of-order',
    ]);
  });

  it('defaults to single-cycle — the simplest first teaching model', () => {
    expect(modelById(DEFAULT_MODEL_ID).id).toBe('single-cycle');
  });

  it('falls back to the default for an unknown id rather than throwing', () => {
    expect(modelById('no-such-model').id).toBe(DEFAULT_MODEL_ID);
  });

  for (const model of MODELS) {
    describe(`${model.id}`, () => {
      /**
       * The row's `capabilities` must be the engine's own — the exact object its instances
       * return. Held on the row so the shell can gate config controls without instantiating an
       * engine; that shortcut is only sound if the two can never disagree, which is this test.
       * `toBe` (identity, not equality) is deliberate: the engines export a single frozen
       * constant each, so a row that reached for the right FLAGS from the wrong model would
       * still be caught.
       */
      it('carries the capabilities its own engine reports', () => {
        expect(model.make().capabilities).toBe(model.capabilities);
      });

      /** The id is the trace-level identity (`capabilities.model`), not just a picker key. */
      it('has an id matching its engine capabilities.model', () => {
        expect(model.capabilities.model).toBe(model.id);
      });

      /** `make` is a FACTORY: a shared instance would leak one program's run into the next. */
      it('makes a fresh engine on every call', () => {
        expect(model.make()).not.toBe(model.make());
      });
    });
  }

  /**
   * Each config toggle is gated on its capability flag, so these flags are what decide whether a
   * control is shown at all. Pinned as exact SETS rather than per-model asserts: the claim worth
   * failing on is which models honor a knob, so a new model quietly arriving with a flag true (or
   * an existing one losing it) reddens here.
   *
   * **All three lists said "exactly one — the pipeline" until M7 step 6, and the superscalar is why
   * they now name two.** That is the seam working rather than eroding: the superscalar honors
   * forwarding, prediction and the cache for real (it has hazards, it bets, it caches), so a shell
   * that showed it fewer controls than the pipeline would be lying about the machine. Written as a
   * per-knob sweep so the sets cannot drift apart silently — the failure mode being one model
   * gaining a knob in three places and a fourth being forgotten.
   */
  it('names exactly which models honor each config knob', () => {
    const honoring = (flag: (c: ProcessorCapabilities) => boolean) =>
      MODELS.filter((m) => flag(m.capabilities)).map((m) => m.id);
    // The out-of-order core joins prediction, cache and issue-width — it has hazards it bets on, it
    // caches, and it is width-parametric (`issueWidth`, default 2). It DELIBERATELY does NOT join
    // forwarding: register renaming makes a forwarding knob meaningless, so its engine reports
    // `configurableForwarding: false` (the reflex "it has hazards so it forwards" is the trap this
    // list catches).
    expect(honoring((c) => c.configurableForwarding)).toEqual(['pipeline', 'superscalar']);
    expect(honoring((c) => c.configurableBranchPrediction)).toEqual([
      'pipeline',
      'superscalar',
      'out-of-order',
    ]);
    expect(honoring((c) => c.configurableCache)).toEqual([
      'pipeline',
      'superscalar',
      'out-of-order',
    ]);
    // Issue width was the one knob that was NOT shared through M7 (M7 step 6); the out-of-order core
    // is the SECOND model to honor it — superscalar OoO, built once, width-parametric (M9). The three
    // pre-M7 engines do not merely leave `issueWidth` unmoved — they ignore it (whole-trace inertness,
    // pinned in each of their suites). A model arriving with this true without that proof is what
    // should fail here.
    expect(honoring((c) => c.configurableIssueWidth)).toEqual(['superscalar', 'out-of-order']);
    // The out-of-order config cluster — `outOfOrderIssue`, `robSize`, `slowOpLatency` — gated by one
    // flag (M9 step 0). Only the OoO model honors it; every other engine's constant sets it false, so
    // the issue-order toggle and the ROB-size control appear on exactly this model and nowhere else.
    expect(honoring((c) => c.configurableOutOfOrder)).toEqual(['out-of-order']);
  });

  /**
   * The datapath discriminator, which App dispatches on. Every model has its OWN hand-authored
   * geometry and none reuses a neighbour's: lit by the wrong model's trace, a diagram draws a
   * contradictory picture (INV-5) — multi-cycle's single shared memory and one-in-flight layout
   * would simply be a lie about a pipeline. Asserted as a table rather than "each is not none",
   * since the failure worth catching is a row pointing at the WRONG diagram, not a missing one.
   */
  it('dispatches each model to its own bespoke datapath — never a neighbour’s', () => {
    expect(MODELS.map((m) => [m.id, m.datapath])).toEqual([
      ['single-cycle', 'single-cycle'],
      ['multi-cycle', 'multi-cycle'],
      ['pipeline', 'pipeline'],
      // Flipped from `'none'` at M7 step 7, together with the union member and App's dispatch arm —
      // and this table FAILING was the reminder to do all three, which is what an exhaustive table
      // is for. `datapath-superscalar.ts` now exists: a shared front-end feeding two replicated
      // execute lanes, with issue width as a third structural axis. Reusing `'pipeline'` here would
      // be the exact failure this test hunts — that diagram draws one instruction per stage, so a
      // superscalar trace would light it into a picture the machine contradicts (INV-5).
      ['superscalar', 'superscalar'],
      // `'none'` on purpose at step 5, exactly as the superscalar was `'none'` here through M7 step 6.
      // A `DatapathKind` value asserts a diagram of that kind EXISTS; the bespoke OoO datapath is M9
      // step 7, where the union member, App's dispatch arm, and this value flip together (and this
      // table reddening is the reminder to do all three). Until then App falls through to the
      // placeholder, and the tier's picture comes from the pipeline map + the step-6 tables.
      ['out-of-order', 'none'],
    ]);
  });

  /**
   * The table's whole promise (INV-3): a model listed here is drivable, full stop. Every panel
   * reads the trace, so nothing downstream needs to know which engine produced it — but "the row
   * is wired to an engine that actually runs" is a claim about the TABLE, and this is where it
   * gets checked. Runs the corpus's headline program on each and demands the known answer, so a
   * row pointing at a broken or half-wired engine cannot reach the picker.
   */
  it('every listed model drives a real corpus program to the known result (a0 = 55)', () => {
    const sumLoop = EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop')!;
    for (const model of MODELS) {
      const result = loadSource(sumLoop.source, model.make, defaultConfig());
      expect(result.ok, `${model.id} should load sum-loop`).toBe(true);
      if (!result.ok) continue;
      result.loaded.recorder.runToEnd();
      expect(result.loaded.recorder.currentState().registers[10], `${model.id} computes 55`).toBe(
        55,
      );
    }
  });
});
