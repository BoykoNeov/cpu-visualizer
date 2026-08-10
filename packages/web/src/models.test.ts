import { describe, expect, it } from 'vitest';
import { defaultConfig, type ProcessorCapabilities } from '@cpu-viz/trace';
import { CACHE_SMALL } from '@cpu-viz/engine-pipeline';
import {
  MODELS,
  modelById,
  engineConfigFor,
  showsDatapathSlot,
  DEFAULT_MODEL_ID,
  type ModelChoice,
} from './models';
import { type BranchPrediction } from './session';
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
  it('lists the seven microarchitectures built so far, in teaching order, with unique ids', () => {
    // ORDER is the claim, not just membership — this array is the picker's order, which is
    // user-visible forever. `deep-pipeline` sits directly after `pipeline` (M11 step 5) because
    // depth is the next thing after the 5-stage: it is the same machine with two stages added, and
    // reading it before the superscalar/out-of-order tiers is what makes "forwarding stops being
    // enough" land. Appending at the end would have dodged this test's churn (and the two capability
    // lists below) at the price of putting a 7-stage in-order pipe after out-of-order.
    //
    // `scoreboard` IS appended (M15 decision 8), and the two cases are not in tension. The deep
    // pipeline had to be inserted because it is a step ALONG the road the reader is walking; the
    // scoreboard is the road's own predecessor, met after its successor. Its whole framing — the
    // description says "the out-of-order machine before register renaming" — depends on the reader
    // having already met the machine directly above it, so last is where it reads as a predecessor
    // rather than as a seventh unrelated model. See `models.ts` for the argument in full.
    expect(MODELS.map((m) => m.id)).toEqual([
      'single-cycle',
      'multi-cycle',
      'pipeline',
      'deep-pipeline',
      'superscalar',
      'out-of-order',
      'scoreboard',
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
    // The deep pipeline JOINED this list at M11 step 6, and the history is worth a line because it
    // is the only knob any shipped engine has ever REFUSED rather than ignored. While the miss-
    // freeze's meeting with two execute stages was unpinned, that engine threw on a non-null cache —
    // which is why the shell has `engineConfigFor` (see its own tests below). Step 6 pinned it (the
    // freeze is back-pressure: MEM owns the EX2/MEM latch, so all five younger stages hold), the
    // throw went away, and every pipelined model now honors a cache. `engineConfigFor` was kept as
    // NORMALIZATION rather than protection. (This comment said the opposite until M11 step 7 — a
    // stale claim sitting directly above the assertion that contradicts it.)
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
    // ⚠ **The seventh model joins NONE of the five lists above, and that absence is a claim rather
    // than an oversight** (M15 step 5). Stated positively here because the sets above cannot say it:
    // each of them reddens on a model that gains a flag, and none of them reddens on a model that
    // was simply never considered — which is indistinguishable from one that considered every knob
    // and honors nothing. The scoreboard is the second kind. It REFUSES `cache` and any
    // `issueWidth` other than 1 (its `reset()` throws by name, which is what `engineConfigFor`'s
    // second clamp exists to keep unreachable) and IGNORES the rest: it has no bypass network at
    // all, so `forwarding` is inert; it has no predictor (decision 3), so `branchPrediction` is;
    // and `configurableOutOfOrder` gates a cluster (`outOfOrderIssue`, `robSize`, `slowOpLatency`)
    // that means nothing on a machine with neither a reorder buffer nor reservation stations. Each
    // of those inertness claims is asserted as a byte-identical trace in the engine's own suite.
    const scoreboard = modelById('scoreboard').capabilities;
    expect([
      scoreboard.configurableForwarding,
      scoreboard.configurableBranchPrediction,
      scoreboard.configurableCache,
      scoreboard.configurableIssueWidth,
      scoreboard.configurableOutOfOrder,
    ]).toEqual([false, false, false, false, false]);
  });

  /**
   * **`micro.predictor` is spelled the same on every model that bets — checked, not assumed.**
   *
   * The dynamic-branch-prediction plan's step 6 rests on exactly this agreement, and its reason is a
   * shipped defect: `cache-grid.ts` reads the MEM-stage latch, whose name is per-model (`exMem` on
   * the 5-stage, `ex2Mem` on the deep pipeline), and the hard-coded `micro.exMem` left that panel
   * silently idle on the deep pipeline for a whole milestone on a user-reachable config. The plan's
   * defense was that a NEW field can simply agree everywhere "by construction" instead of needing an
   * accessor to reconcile it.
   *
   * ⚠ **"By construction" was enforced by NOTHING, and this test exists because that was measured
   * rather than suspected.** Renaming the field to `bht` on `DeepPipelineMicro` alone — interface
   * and construction site together, exactly what a step-5 copy-paste would produce — left
   * `npm run typecheck` clean and all 7591 tests green. The pipeline happens to be covered, by a
   * whole-`micro` `toEqual` in its own suite; the other three models had no such assertion, so three
   * of the four spellings were free to drift. Nothing reads `micro.predictor` yet, which is
   * precisely why the gap is invisible: the first reader is step 6's panel, and by then the drift
   * would already be shipped.
   *
   * Asserted on the RECORDED trace rather than on the type, because the type is what a divergent
   * rename changes in lockstep. A key present on every cycle is the claim a panel actually depends
   * on.
   */
  it('every model that bets spells its predictor field `predictor` — on every recorded cycle', () => {
    const sumLoop = EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop')!;
    const betting = MODELS.filter((m) => m.capabilities.configurableBranchPrediction);
    // Non-vacuity: the sweep below says nothing if the filter selects nobody, and this is also the
    // count that must grow if a fifth model ever honors prediction.
    expect(betting.map((m) => m.id)).toEqual([
      'pipeline',
      'deep-pipeline',
      'superscalar',
      'out-of-order',
    ]);

    for (const model of betting) {
      const result = loadSource(sumLoop.source, model.make, defaultConfig());
      expect(result.ok, `${model.id} should load sum-loop`).toBe(true);
      if (!result.ok) continue;
      result.loaded.recorder.runToEnd();
      const recorded = result.loaded.recorder.recorded;
      expect(recorded.length, `${model.id} should record cycles to check`).toBeGreaterThan(0);
      for (const trace of recorded) {
        const micro = trace.state.micro as Record<string, unknown> | undefined;
        expect(
          micro !== undefined && 'predictor' in micro,
          `${model.id} cycle ${trace.cycle}: micro must carry a \`predictor\` key`,
        ).toBe(true);
      }
    }
  });

  /**
   * **All four betting models make the SAME bets, and this is the only place that can say so**
   * (dynamic-branch-prediction step 5's close-out). Each model's own `dynamic-predict.test.ts` pins
   * its bet string as a literal, and those four literals happen to be equal — but four files each
   * agreeing with itself is not the same claim as the four agreeing with each other, and it is
   * exactly the shape step 1 measured as unenforced when a divergent `predictor` spelling passed
   * typecheck and all 7591 tests.
   *
   * **The failure this catches, specifically:** step 5's own break harness recorded that a
   * copy-paste which changes a model's policy and then "fixes" that model's table to match keeps its
   * package green. Nothing inside that package can see it, because the literal and the engine moved
   * together. Here they cannot: one string is compared across four engines.
   *
   * ⚠ **That the strings agree at all is a CONSEQUENCE, not a law** — it holds because prediction
   * changes when things happen rather than what happens, because all four models share one bet
   * policy by importing `isConditionalBranch`/`predictorIndex` rather than restating it, and —
   * on the out-of-order core alone — because no wrong-path branch ever trains the table on this
   * corpus. If a future corpus program made a squashed branch train, THIS test is where the family
   * stops being one family, and the OoO's own suite says so at the same moment.
   */
  it('every betting model makes the SAME bets — one string, four engines', () => {
    const betting = MODELS.filter((m) => m.capabilities.configurableBranchPrediction);
    expect(betting.map((m) => m.id)).toHaveLength(4);

    const betsOf = (
      program: string,
      model: (typeof MODELS)[number],
      scheme: BranchPrediction,
    ): string => {
      const source = EXAMPLE_PROGRAMS.find((p) => p.name === program)!.source;
      const result = loadSource(source, model.make, {
        ...defaultConfig(),
        branchPrediction: scheme,
      });
      if (!result.ok) throw new Error(`unreachable: ${program} should assemble`);
      result.loaded.recorder.runToEnd();
      return result.loaded.recorder.recorded
        .flatMap((t) => t.events)
        .filter((e) => e.type === 'branch-resolved')
        .map((e) => (e.predicted ? 'T' : 'N'))
        .join('');
    };

    // ⚠ **TWO programs, and the second one is the whole point of this test.** The first draft swept
    // `nested-loop.s` alone — the program authored to make this feature legible — and it caught
    // NOTHING: a real policy divergence (the deep pipeline made to let `jal` CONSULT the table, with
    // its own package's literals "fixed" to match) left all 32 tests here green, because
    // `nested-loop.s` contains no `jal` and no `jalr`. `call-return.s` is the corpus's only witness
    // for both, and M4 pinned it as such long before this feature existed.
    //
    // That is this plan's own recurring finding — **the canonical demonstration of a mechanism is
    // usually not the test of it** — arriving inside the test written to close the gap it names.
    // Verified the other way too: with `call-return.s` swept, that same mutation reddens this test.
    const PINNED: Record<string, Record<'dynamic-1bit' | 'dynamic-2bit', string>> = {
      // Separates 1-bit from 2-bit: the only program whose four schemes are strictly ordered.
      'nested-loop': {
        'dynamic-1bit': 'NNTTTTTNNNTTTTTTNNTTTTTTNNTTTTTT',
        'dynamic-2bit': 'NNTTTTTNNTTTTTTTNTTTTTTTNTTTTTTT',
      },
      // Pins the two `jal` decisions and `jalr`'s permanent unpredictability. `TNN` against an
      // actual `TNT`: position 1 is the `jal`, bet taken WITHOUT consulting a cold counter (which
      // would read `N`); position 3 is the `ret`, unpredictable under every scheme.
      'call-return': { 'dynamic-1bit': 'TNN', 'dynamic-2bit': 'TNN' },
    };

    for (const [program, byScheme] of Object.entries(PINNED)) {
      for (const [scheme, expected] of Object.entries(byScheme)) {
        for (const model of betting) {
          expect(
            betsOf(program, model, scheme as BranchPrediction),
            `${model.id} on ${program} under ${scheme}`,
          ).toBe(expected);
        }
      }
    }

    // Non-vacuity, in this test's own terms rather than by pointing elsewhere: the helper must be
    // capable of telling schemes apart at all, and the two dynamic strings must genuinely differ on
    // the program chosen to separate them — otherwise "all four agree" would be satisfied by a
    // helper that had quietly stopped applying the knob.
    const one = betting[0]!;
    expect(betsOf('nested-loop', one, 'dynamic-1bit')).not.toBe(
      betsOf('nested-loop', one, 'dynamic-2bit'),
    );
    expect(betsOf('nested-loop', one, 'static-taken')).not.toBe(
      betsOf('nested-loop', one, 'dynamic-2bit'),
    );
    // ...and `call-return` really does carry the jump the other program lacks, which is the whole
    // reason it is here: a `static-taken` machine bets its `jal` AND its `bge`, a dynamic one bets
    // only the `jal`.
    expect(betsOf('call-return', one, 'static-taken')).toBe('TTN');
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
      // Flipped from `'none'` at M11 step 7, together with the union member and App's dispatch arm —
      // this table reddening was the reminder to do all three, exactly as it was for the two rows
      // below. `datapath-deep-pipeline.ts` now exists: seven stage bands, six latch bars, and the
      // forwarding muxes sitting in EX1 whose output lands on the EX1/EX2 latch rather than on the
      // ALU. Reusing `'pipeline'` here would be precisely the failure this test hunts — that diagram
      // draws five columns with the ALU immediately after the muxes, so the ONE thing this tier
      // teaches (the operands wait a cycle) is the one thing it cannot show.
      ['deep-pipeline', 'deep-pipeline'],
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
      // `'panel'` since M15 step 8 — the one value here that is not the name of a diagram, and it
      // is a POSITIVE statement rather than a pending one. This model's canonical picture is not a
      // wire-and-box datapath at all: it is the three status tables, which shipped at step 7 as a
      // panel, and decision 9 pinned that no wire diagram ships this milestone.
      //
      // ⚠ It read `'none'` from step 0 through step 7, with the slot suppressed one layer up by a
      // TRACE fact (`showsDatapathSlot`). The step-8 browser pass measured what that cost: with an
      // empty or unassembled program the trace fact is false, so the "coming soon" placeholder came
      // back — promising the very diagram the plan declined, in the only state anywhere in the
      // product that still reaches it. `'panel'` is true of this model whether or not a program is
      // loaded. Reusing any neighbour's geometry here would still be the failure this test hunts —
      // none of them draw a functional-unit status table or a register-result table, and every one
      // of them draws a machine that reads its operands in program order, so a scoreboard trace
      // would light a picture the machine contradicts (INV-5).
      ['scoreboard', 'panel'],
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
 * `showsDatapathSlot` — whether the shell gives a model a datapath SLOT (M15 step 7).
 *
 * ⚠ **This exists as a pure function precisely because the thing it decides is unreachable from a
 * headless test otherwise.** The decision lives in `App`'s slot array, and `App` cannot be rendered
 * here — no jsdom, by design — which is the same hole `engineConfigOf` was extracted to close at
 * the M13 review. Three milestones each shipped a shell-seam defect that all their web tests were
 * blind to. Lifting the predicate out is what gives this one a net at all.
 */
describe('the datapath slot', () => {
  it('is shown for every model that HAS a diagram, bespoke panel or not', () => {
    let checked = 0;
    for (const model of MODELS) {
      if (model.datapath === 'none' || model.datapath === 'panel') continue;
      // Regardless of whether it also has a bespoke panel — a diagram is never suppressed.
      expect([model.id, showsDatapathSlot(model, true)]).toEqual([model.id, true]);
      expect([model.id, showsDatapathSlot(model, false)]).toEqual([model.id, true]);
      checked++;
    }
    // Non-vacuity: the two `continue`s above are the whole shape of this test, and a third value
    // added to the union would silently empty it.
    expect(checked).toBe(6);
  });

  /**
   * The out-of-order model is the case that proves the predicate is not just "has a bespoke
   * panel": it HAS one (`MicroTablePanel`) and it also has a diagram, so it keeps both.
   */
  it('the out-of-order model keeps its diagram beside its tables', () => {
    expect(showsDatapathSlot(modelById('out-of-order'), true)).toBe(true);
  });

  /**
   * The scoreboard: no diagram, and a panel that IS its picture — so no placeholder.
   *
   * ⚠ **Asserted at BOTH values of the trace flag, and the `false` half is the step-8 finding.**
   * Through step 7 the suppression rested on the flag alone, so `false` — an empty editor, or a
   * program that does not assemble — put "Scoreboard datapath — coming soon" back on screen. The
   * browser pass measured that as the only route to the placeholder left in the product. A model
   * declaring `'panel'` is telling the truth about itself in every state, recording or no
   * recording, which is what this second expectation pins.
   */
  it('is suppressed for a model whose canonical picture is a panel — recording or not', () => {
    expect(showsDatapathSlot(modelById('scoreboard'), true)).toBe(false);
    expect(showsDatapathSlot(modelById('scoreboard'), false)).toBe(false);
  });

  /**
   * …and the placeholder stays REACHABLE for the case it was written for. This is the half a
   * blanket "never show a placeholder" change would delete: a model with neither a diagram nor a
   * bespoke panel still needs to say so, rather than silently drawing nothing.
   *
   * ⚠ **The subject is a CONSTRUCTED model, and that is the honest form rather than a convenience.**
   * No shipped model sits at `'none'` any more — the step-8 sweep measured all seven and found the
   * placeholder unreachable on every one of them — so pointing this at a real row would have made
   * it a claim about the scoreboard again, which is precisely what changed. Written this way it
   * keeps testing the branch a future model will land on.
   */
  it('is still shown for a model with neither a diagram nor a bespoke picture', () => {
    const future: ModelChoice = {
      ...modelById('scoreboard'),
      id: 'future-model',
      datapath: 'none',
    };
    expect(showsDatapathSlot(future, false)).toBe(true);
    // And it is the placeholder's own case that is preserved, not a blanket "always show": the
    // same model WITH a bespoke panel is suppressed.
    expect(showsDatapathSlot(future, true)).toBe(false);
    // The premise above, measured rather than asserted in prose.
    expect(MODELS.filter((m) => m.datapath === 'none').map((m) => m.id)).toEqual([]);
  });
});

/**
 * `engineConfigFor` — the shell's session config narrowed to the knobs a model claims (M11 step 5).
 *
 * **Why this exists at all, in one sentence: the cache is held at SESSION level and handed to every
 * engine, and `deep-pipeline` was the first engine that REFUSED a knob instead of ignoring it** (it
 * honors the cache since M11 step 6, so nothing refuses anything today — see `models.ts`). So
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
  // The exemplar of a model that honors BOTH clamped knobs — see the identity test below for why
  // the pipeline stopped being able to play that role at M15 step 5.
  const superscalar = modelById('superscalar');
  // The model that REFUSES a width (M15). Unlike `clamped`, which merely ignores one, this engine's
  // `reset()` throws by name — so for this row the clamp is protection, not normalization.
  const scoreboard = modelById('scoreboard');

  it('hands a model that honors BOTH clamped knobs the session config untouched', () => {
    // Identity, not equality: nothing is rebuilt for a model that takes both knobs as given.
    //
    // ⚠ The subject moved at M15 step 5 and the reason is the point. This asked the PIPELINE until
    // the width clamp landed, and a pipeline honors the cache but not `issueWidth` — so it is now
    // rebuilt, and asking it for identity would have pinned the OLD scope of the function under a
    // title that still read true. The models that honor both are exactly the two width-parametric
    // ones; `superscalar` is the stable choice (`out-of-order` is the one whose flags have moved).
    expect(superscalar.capabilities.configurableCache).toBe(true);
    expect(superscalar.capabilities.configurableIssueWidth).toBe(true);
    expect(engineConfigFor(superscalar, withCache)).toBe(withCache);
  });

  it('clamps the cache to null for a model that declares it does not honor one', () => {
    expect(clamped.capabilities.configurableCache).toBe(false);
    expect(engineConfigFor(clamped, withCache).cache).toBeNull();
  });

  it('clamps ONLY the cache and the width — every other knob reaches the engine as set', () => {
    // The scope of the narrowing, pinned: forwarding, prediction and the out-of-order cluster are
    // IGNORED by engines that do not honor them (each pinned as whole-trace inertness in that
    // engine's own suite), so clamping them would be three more judgement calls able to move a
    // recording — and every model's cycle counts are pinned in a timing suite.
    //
    // `issueWidth` JOINED the clamp at M15 step 5, and the model asked here is why the change is
    // visible at all: single-cycle merely IGNORES a width, so on this row the new clamp is pure
    // normalization — it is the scoreboard, below, that would throw without it.
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
    expect(engineConfigFor(clamped, busy)).toEqual({ ...busy, cache: null, issueWidth: 1 });
  });

  /**
   * **The M15 crash, as a test — this is the row that makes the second clamp protection rather than
   * decoration.** `deep-pipeline` played this part at M11 step 5 and stopped when step 6 gave it a
   * cache; from then until M15 no shipped engine refused anything, and `models.ts` recorded the
   * function as normalization only. The scoreboard refuses a width by name.
   *
   * The reachable path is a click sequence, not a contrived config: the width toggle is rendered
   * only where `configurableIssueWidth` is true, so a reader can set the superscalar to 4-wide, pick
   * Scoreboard, and arrive at a model whose control for that knob is **not on screen to unset**.
   * That is the exact strand the clamp exists to prevent, and an error message instead of a clamp
   * would leave them with a dead app and no way back.
   *
   * Asserted as a real LOAD, not just the config shape: the shape assertion would keep passing
   * against an engine that had quietly moved its guard, and the throw is what the reader would meet.
   */
  it('a model that REFUSES a width loads at every width the control offers', () => {
    expect(scoreboard.capabilities.configurableIssueWidth).toBe(false);
    const sumLoop = EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop')!;
    for (const issueWidth of [1, 2, 3, 4]) {
      const session = { ...defaultConfig(), issueWidth };
      expect(engineConfigFor(scoreboard, session).issueWidth, `width ${issueWidth}`).toBe(1);
      const result = loadSource(sumLoop.source, scoreboard.make, engineConfigFor(scoreboard, session)); // prettier-ignore
      expect(result.ok, `scoreboard should load at session width ${issueWidth}`).toBe(true);
      if (!result.ok) continue;
      result.loaded.recorder.runToEnd();
      expect(result.loaded.recorder.currentState().registers[10]).toBe(55);
    }
  });

  it('...and really would throw unclamped — the clamp is protection here, not normalization', () => {
    // The negative case, which is the load-bearing one (the same argument the cache's own negative
    // case carried until M11 step 6 removed the throw). Without it, the clamp assertion above would
    // keep passing against an engine that had gone back to ignoring the knob, and this row would
    // read as ceremony. `loadSource` has an error CHANNEL for a program that fails to assemble, but
    // an engine's `reset()` throw propagates straight through it — which is exactly why the shell
    // path meets this as a throw out of a click handler rather than as a rendered message.
    const sumLoop = EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop')!;
    const unclamped = { ...defaultConfig(), issueWidth: 4 };
    expect(() => loadSource(sumLoop.source, scoreboard.make, unclamped)).toThrow(/issueWidth 4/);
  });

  it('does not clamp the SESSION value — leaving the model restores BOTH knobs', () => {
    // The clamp is on the value passed to the engine, never on the shell's state, so
    // pipeline(cache small) → deep pipeline → pipeline finds its cache still small.
    const session = { ...defaultConfig(), cache: CACHE_SMALL };
    engineConfigFor(clamped, session);
    expect(session.cache).toBe(CACHE_SMALL);
    expect(engineConfigFor(pipeline, session).cache).toBe(CACHE_SMALL);

    // ⚠ **The width half, added with the clamp rather than after it.** `models.ts` claims the
    // return leg for both knobs in prose; without this the width half was a sentence with nothing
    // behind it, which is this repo's "a pinned decision with no net is a comment". It is the leg
    // the browser pass does NOT walk — that rig goes superscalar-at-4-wide → Scoreboard and stops,
    // so the trip BACK is only checked here. Correct by construction (the clamp spreads into a new
    // object rather than mutating), and construction is exactly what a refactor changes.
    const wide = { ...defaultConfig(), issueWidth: 4 };
    expect(engineConfigFor(scoreboard, wide).issueWidth).toBe(1);
    expect(wide.issueWidth, 'the session kept its own width').toBe(4);
    expect(engineConfigFor(superscalar, wide).issueWidth, 'and switching back restores it').toBe(4);
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

/**
 * **M15 step 6's acceptance criterion, and the discovery that its plain form is VACUOUS.**
 *
 * The plan's line reads: *"The same program on `Out-of-order` shows **no** WAW or WAR stall, and on
 * `Scoreboard` shows both — the same program, two machines, the renaming lesson visible without a
 * word of prose."* Asserted literally, the first half passes for entirely the wrong reason: the
 * out-of-order core **emits no `stall` event of any kind, on any program** — grep its `processor.ts`
 * and there is no `type: 'stall'` anywhere. So "shows no WAW stall" there is true of a machine with
 * renaming, of a machine without it, and of a machine that does not run at all.
 *
 * This is the web layer because it is the only one allowed to hold the claim: `eslint.config.js`
 * denies model→model imports, so no engine package can compare itself to a sibling, and the picker
 * is the one place all seven exist side by side.
 *
 * What is asserted instead is the pair of claims that ARE falsifiable — every model agrees on the
 * answer (INV-7/INV-8 across the picker), and exactly one model's trace can NAME either hazard —
 * plus the vacuity guard itself: each model's TOTAL stall count, so a reader can see which
 * absences are evidence and which are silence.
 */
describe('register-reuse.s across the picker — the renaming lesson, and what a trace cannot say', () => {
  const program = EXAMPLE_PROGRAMS.find((p) => p.name === 'register-reuse')!;

  /** Every `stall` reason a model emits on this program, with its count. */
  function stallsByReason(make: (typeof MODELS)[number]['make']): Record<string, number> {
    const result = loadSource(program.source, make, defaultConfig());
    expect(result.ok).toBe(true);
    if (!result.ok) return {};
    result.loaded.recorder.runToEnd();
    const counts: Record<string, number> = {};
    for (const trace of result.loaded.recorder.recorded) {
      for (const event of trace.events) {
        if (event.type === 'stall') counts[event.reason] = (counts[event.reason] ?? 0) + 1;
      }
    }
    return counts;
  }

  it('all seven models compute the same answer — the half of the claim that is real', () => {
    // INV-7/INV-8 at the picker layer: one corpus, seven machines, one set of answers. a0 = 24 is
    // the WAR answer (the older `add` read the t2 it was given, not the 5 written while it waited)
    // and t1 = 7 is the WAW answer (the younger write is architecturally last).
    for (const model of MODELS) {
      const result = loadSource(program.source, model.make, defaultConfig());
      expect(result.ok, `${model.id} should load register-reuse`).toBe(true);
      if (!result.ok) continue;
      result.loaded.recorder.runToEnd();
      const regs = result.loaded.recorder.currentState().registers;
      expect(regs[10], `${model.id}: a0 — the WAR answer`).toBe(24);
      expect(regs[6], `${model.id}: t1 — the WAW answer`).toBe(7);
      expect(regs[11], `${model.id}: a1 reads the NEW t2`).toBe(14);
      expect(regs[7], `${model.id}: t2`).toBe(5);
    }
  });

  it('only the scoreboard can NAME either hazard — and two models name nothing at all', () => {
    // The scoreboard is the one machine whose trace says `waw` and `war` out loud, and it says both
    // on this program. That is the claim the milestone is built on.
    const scoreboard = stallsByReason(modelById('scoreboard').make);
    expect(scoreboard.waw, 'WAW: the `la` pair plus the corrupting pair').toBe(5);
    expect(scoreboard.war, 'WAR: the only WAR stall in the whole corpus').toBe(4);

    // ...and nobody else does. But the ABSENCE is worth nothing without the next assertion, because
    // two of the six cannot emit a stall event at all.
    for (const model of MODELS) {
      if (model.id === 'scoreboard') continue;
      const counts = stallsByReason(model.make);
      expect(counts.waw, `${model.id} names no WAW`).toBeUndefined();
      expect(counts.war, `${model.id} names no WAR`).toBeUndefined();
    }
  });

  it('THE VACUITY GUARD: the out-of-order core emits no stall event at all, so its silence is not evidence', () => {
    // Total stall events per model, measured. The two zeros are the point: on `out-of-order` the
    // sentence "shows no WAW or WAR stall" is not a fact about renaming, it is a fact about that
    // model's trace vocabulary — it would read identically on a machine that had every hazard in
    // the book. `single-cycle` is the honest zero (nothing can stall a machine with one stage).
    //
    // ⚠ If the out-of-order core ever starts emitting stalls, THIS test goes red and the previous
    // one becomes a real cross-model claim for the first time. That is the intended failure: the
    // guard exists to be falsified by the fix, not to be maintained forever.
    const totals = Object.fromEntries(
      MODELS.map((m) => [
        m.id,
        Object.values(stallsByReason(m.make)).reduce((sum, n) => sum + n, 0),
      ]),
    );
    expect(totals).toEqual({
      'single-cycle': 0,
      'multi-cycle': 0,
      pipeline: 8,
      'deep-pipeline': 12,
      superscalar: 8,
      'out-of-order': 0,
      scoreboard: 33,
    });
  });
});
