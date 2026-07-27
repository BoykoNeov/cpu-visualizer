import { describe, expect, it } from 'vitest';
import { defaultConfig, type ProcessorCapabilities } from '@cpu-viz/trace';
import { CACHE_SMALL } from '@cpu-viz/engine-pipeline';
import { MODELS, modelById, engineConfigFor, DEFAULT_MODEL_ID } from './models';
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
  it('lists the six microarchitectures built so far, in teaching order, with unique ids', () => {
    // ORDER is the claim, not just membership — this array is the picker's order, which is
    // user-visible forever. `deep-pipeline` sits directly after `pipeline` (M11 step 5) because
    // depth is the next thing after the 5-stage: it is the same machine with two stages added, and
    // reading it before the superscalar/out-of-order tiers is what makes "forwarding stops being
    // enough" land. Appending at the end would have dodged this test's churn (and the two capability
    // lists below) at the price of putting a 7-stage in-order pipe after out-of-order.
    expect(MODELS.map((m) => m.id)).toEqual([
      'single-cycle',
      'multi-cycle',
      'pipeline',
      'deep-pipeline',
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
    expect(honoring((c) => c.configurableForwarding)).toEqual([
      'pipeline',
      'deep-pipeline',
      'superscalar',
    ]);
    expect(honoring((c) => c.configurableBranchPrediction)).toEqual([
      'pipeline',
      'deep-pipeline',
      'superscalar',
      'out-of-order',
    ]);
    // The deep pipeline is MISSING from this one on purpose, and it is the only model that honors
    // forwarding and prediction without honoring the cache — so read the gap as the scope lever it
    // is. M6's miss-freeze holds IF/ID/EX for the miss penalty; on a machine where "IF" and "EX" are
    // each two stages, which of IF1/IF2/EX1/EX2 freeze is a CHOICE with no external ground truth,
    // and M11 step 6 is where it gets pinned. Until then that engine REFUSES a non-null cache by
    // name rather than running silently cache-less — the one place a knob is refused instead of
    // ignored, which is why the shell has `engineConfigFor` (see its own tests below).
    expect(honoring((c) => c.configurableCache)).toEqual([
      'pipeline',
      'deep-pipeline',
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
      // `'none'` — the deliberate superscalar/out-of-order pattern at the same point in their own
      // milestones, not a missing diagram. M11 step 7 draws the bespoke seven-stage geometry and
      // flips this row (together with the union member and App's dispatch arm), and this table going
      // red is the reminder to do all three. Until then App renders the placeholder, and the
      // PIPELINE MAP — which needed no change at all to fold a seven-stage recording (step 4) — is
      // what makes the tier teachable meanwhile.
      ['deep-pipeline', 'none'],
      // Flipped from `'none'` at M7 step 7, together with the union member and App's dispatch arm —
      // and this table FAILING was the reminder to do all three, which is what an exhaustive table
      // is for. `datapath-superscalar.ts` now exists: a shared front-end feeding two replicated
      // execute lanes, with issue width as a third structural axis. Reusing `'pipeline'` here would
      // be the exact failure this test hunts — that diagram draws one instruction per stage, so a
      // superscalar trace would light it into a picture the machine contradicts (INV-5).
      ['superscalar', 'superscalar'],
      // Flipped from `'none'` at M9 step 7, together with the union member and App's dispatch arm —
      // this table reddening was the reminder to do all three, exactly as it was for the superscalar.
      // `datapath-out-of-order.ts` now exists: a shared front-end dispatching into the ROB and the
      // reservation stations, which issue to a functional-unit pool and a load/store unit whose
      // results ride the common data bus back to the RS and ROB. Reusing any in-order diagram here
      // would be the failure this test hunts — none of them draw a ROB, an RS or a CDB, so an
      // out-of-order trace would light a picture the machine contradicts (INV-5).
      ['out-of-order', 'out-of-order'],
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

/**
 * `engineConfigFor` — the shell's session config narrowed to the knobs a model claims (M11 step 5).
 *
 * **Why this exists at all, in one sentence: the cache is held at SESSION level and handed to every
 * engine, and `deep-pipeline` is the first engine that REFUSES a knob instead of ignoring it.** So
 * "pipeline with the cache on, then pick Deep pipeline" threw out of a click handler — a live crash
 * with no headless test anywhere able to see it, since this repo renders with
 * `renderToStaticMarkup` and no jsdom. Extracting the narrowing as a pure function is what turns
 * that browser-only guarantee into a pinned one; the tests below are the net.
 *
 * The negative case (`refuses`) is the load-bearing one: without it, the clamp assertions would keep
 * passing against an engine that had quietly gone back to ignoring the knob, and the function would
 * read as decoration.
 */
describe('the config a model is handed', () => {
  const withCache = { ...defaultConfig(), cache: CACHE_SMALL };
  // The exemplar of a model that does NOT honor a cache. It was `deep-pipeline` until M11 step 6
  // implemented one; `single-cycle` has no memory-latency notion at all, so it is the stable choice
  // rather than the next one about to change.
  const clamped = modelById('single-cycle');
  const pipeline = modelById('pipeline');

  it('hands a cache-honoring model the session config untouched', () => {
    // Identity, not equality: nothing is rebuilt for a model that takes the knob as given.
    expect(engineConfigFor(pipeline, withCache)).toBe(withCache);
  });

  it('clamps the cache to null for a model that declares it does not honor one', () => {
    expect(clamped.capabilities.configurableCache).toBe(false);
    expect(engineConfigFor(clamped, withCache).cache).toBeNull();
  });

  it('clamps ONLY the cache — every other knob reaches the engine as the session set it', () => {
    // The scope of the narrowing, pinned: forwarding, prediction, width and the out-of-order
    // cluster are IGNORED by engines that do not honor them (each pinned as whole-trace inertness
    // in that engine's own suite), so clamping them would be four more judgement calls able to
    // move a recording — and every model's cycle counts are pinned in a timing suite.
    const busy = {
      ...withCache,
      forwarding: true,
      branchPrediction: 'static-taken' as const,
      issueWidth: 2,
      outOfOrderIssue: true,
      robSize: 4,
      slowOpLatency: 8,
      numMshrs: 4,
    };
    expect(engineConfigFor(clamped, busy)).toEqual({ ...busy, cache: null });
  });

  it('does not clamp the SESSION value — leaving the model restores the geometry', () => {
    // The clamp is on the value passed to the engine, never on the shell's state, so
    // pipeline(cache small) → deep pipeline → pipeline finds its cache still small.
    const session = { ...defaultConfig(), cache: CACHE_SMALL };
    engineConfigFor(clamped, session);
    expect(session.cache).toBe(CACHE_SMALL);
    expect(engineConfigFor(pipeline, session).cache).toBe(CACHE_SMALL);
  });

  /**
   * **What this test USED to assert, and why it changed, because the difference is the point.**
   * Through M11 step 5 it pinned that the unclamped config really THREW — `deep-pipeline` refused a
   * cache by name while step 6 held the miss-freeze seam open, so the clamp was protection and this
   * was the test that stopped it decaying into decoration. **Step 6 implemented that cache, so no
   * shipped engine refuses anything and there is no throw left to observe.** Asserting one now would
   * be asserting a bug.
   *
   * What survives is the weaker, still-true claim: the clamp is NORMALIZATION — a model that does
   * not honor a cache is handed none, and would have ignored one anyway (`simulator.test.ts` pins
   * that inertness per model). Written out rather than deleted so the next engine to refuse a knob
   * finds both the guard and the reason it exists.
   */
  it('is normalization now, not protection: the clamped model would have ignored one anyway', () => {
    const sumLoop = EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop')!;
    const unclamped = loadSource(sumLoop.source, clamped.make, withCache);
    expect(unclamped.ok, 'no shipped engine refuses a cache any more').toBe(true);
    if (!unclamped.ok) return;
    const unclampedCycles = unclamped.loaded.recorder.runToEnd();

    const applied = loadSource(sumLoop.source, clamped.make, engineConfigFor(clamped, withCache));
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const appliedCycles = applied.loaded.recorder.runToEnd();

    // Same cycle count and same answer either way — which is exactly what "ignored" means.
    expect(appliedCycles).toBe(unclampedCycles);
    expect(applied.loaded.recorder.currentState().registers).toEqual(
      unclamped.loaded.recorder.currentState().registers,
    );
  });

  it('lets EVERY model load with the cache on — the crash the picker could reach', () => {
    // The sweep the shell's own path cannot be tested on (no jsdom, so no test can see the click).
    // A model arriving that refuses some other knob fails here rather than in the browser.
    const sumLoop = EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop')!;
    for (const model of MODELS) {
      const result = loadSource(sumLoop.source, model.make, engineConfigFor(model, withCache));
      expect(result.ok, `${model.id} should load sum-loop with the cache on`).toBe(true);
      if (!result.ok) continue;
      result.loaded.recorder.runToEnd();
      expect(result.loaded.recorder.currentState().registers[10], `${model.id} computes 55`).toBe(
        55,
      );
    }
  });
});
