import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble } from '@cpu-viz/assembler';
import { decode } from '@cpu-viz/isa';
import {
  BranchPredictor,
  PREDICTOR_ENTRIES,
  isConditionalBranch,
  isPredictable,
  toProgramImage,
  type DynamicScheme,
} from '@cpu-viz/engine-common';
import {
  defaultConfig,
  type CycleTrace,
  type ProcessorConfig,
  type TraceEvent,
} from '@cpu-viz/trace';
import { DeepPipelineProcessor, type DeepPipelineMicro } from './index';

/**
 * **The net for the dynamic schemes on the DEEP pipeline** — dynamic-branch-prediction plan, step 5,
 * model 1 of 3. Same three claims as `pipeline/src/dynamic-predict.test.ts` (which carries the long
 * form of why each one is here); this header records only what is DIFFERENT about a seven-stage
 * machine, because everything identical is stated once over there and a second copy could only
 * drift.
 *
 * ## What depth changes, and it is the reason this model is worth wiring at all
 *
 * The 5-stage prices a resolved transfer at **2 if mispredicted, 1 if correctly predicted taken, 0
 * if correctly predicted not-taken**. This machine doubles the first two — a transfer resolves at
 * the end of EX2 with four younger stages behind it, and an ID bet on a two-deep front end kills
 * two — so it is **4 / 2 / 0**. A counter that learns is therefore worth twice as much here, and
 * the corpus totals below say so: `dynamic-2bit` beats `static-taken` by **14** cycles on this model
 * against the 5-stage's 7, and `dynamic-1bit` — which merely TIED `static-taken` over the original
 * eleven programs on the 5-stage — wins outright here.
 *
 * ⚠ **This model's columns were DERIVED before it was wired, exactly as step 0 derived the 5-stage's,
 * and they needed no correction.** The derivation is `cycles(scheme) = cycles(not-taken) −
 * P(not-taken) + P(scheme)` with `P` summed per INSTANCE from the pinned outcome/bet strings — and
 * the rule was validated first by reproducing the MEASURED `static-taken` column on all twelve
 * programs × both forwarding positions before any dynamic cell was believed. The plan's step-5 entry
 * says the pipeline's table must not be inherited here, and it was not: only the two things that
 * genuinely are program properties were reused, the outcome string and the bet strings.
 *
 * ## The two things that are NOT re-derived, because they are properties of the PROGRAM
 *
 * The outcome sequence (`actual`) and the bet sequences (`oneBit`/`twoBit`) are identical to the
 * 5-stage's, and that is a claim rather than an assumption: prediction changes when things happen,
 * never what happens, and both models share one bet policy (`isConditionalBranch`, the `jal` bypass,
 * `predictorIndex`) by importing it rather than restating it. **The first assertion below re-derives
 * `actual` from this engine under all four schemes**, so a copy-paste that changed a policy here
 * fails against these strings instead of quietly agreeing with a replay that changed with it.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

/** Cycles per scheme, forwarding off then on: not-taken, static-taken, 1-bit, 2-bit. */
interface Row {
  readonly off: readonly [nt: number, st: number, oneBit: number, twoBit: number];
  readonly on: readonly [nt: number, st: number, oneBit: number, twoBit: number];
  /** The ordered outcome string — a property of the PROGRAM, asserted below rather than assumed. */
  readonly actual: string;
  readonly oneBit: string;
  readonly twoBit: string;
}

/**
 * ⚠ **Read `call-return.s` and `nested-loop.s` against their 5-stage rows and the depth thesis is
 * right there in the arithmetic.** `call-return.s` costs the dynamic schemes 21 against
 * `static-taken`'s 25 — a 4-cycle win where the 5-stage measured 2 — because the two bets
 * `static-taken` loses on a `jal`-and-`ret` program are twice as expensive on a deeper front end.
 * And `nested-loop.s` goes 262 / 252 / 246 / 240: still strictly ordered with 2-bit fastest, still
 * no ties, but the margin over `static-taken` is 12 rather than 6.
 */
const TABLE: Record<string, Row> = {
  'add.s': { off: [12, 12, 12, 12], on: [10, 10, 10, 10], actual: '', oneBit: '', twoBit: '' },

  'array-sum-twice.s': {
    off: [392, 358, 364, 362],
    on: [308, 274, 280, 278],
    actual: 'TTTTTTTTTTTNTTTTTTTTTTTTNN',
    oneBit: 'NTTTTTTTTTTTNNTTTTTTTTTTTT',
    twoBit: 'NTTTTTTTTTTTNTTTTTTTTTTTTT',
  },

  'array-sum.s': {
    off: [96, 92, 94, 94],
    on: [74, 70, 72, 72],
    actual: 'TTTTN',
    oneBit: 'NTTTT',
    twoBit: 'NTTTT',
  },

  'branch-flavors.s': {
    off: [21, 23, 21, 21],
    on: [19, 21, 19, 19],
    actual: 'TN',
    oneBit: 'NN',
    twoBit: 'NN',
  },

  'byte-loads.s': {
    off: [18, 18, 18, 18],
    on: [14, 14, 14, 14],
    actual: '',
    oneBit: '',
    twoBit: '',
  },

  // The `jal` policy's witness, twice as loud here as on the 5-stage: `TNN` against an actual `TNT`,
  // and the two disagreements cost 4 each rather than 2. Position 1 is the `jal`, bet taken on first
  // sight without consulting a cold counter; position 3 is the `ret`, a `jalr`, unpredictable under
  // every scheme.
  'call-return.s': {
    off: [23, 25, 21, 21],
    on: [23, 25, 21, 21],
    actual: 'TNT',
    oneBit: 'TNN',
    twoBit: 'TNN',
  },

  'nested-loop.s': {
    off: [262, 252, 246, 240],
    on: [198, 188, 182, 176],
    actual: 'NTTTTTNTNTTTTTNTNTTTTTNTNTTTTTNN',
    oneBit: 'NNTTTTTNNNTTTTTTNNTTTTTTNNTTTTTT',
    twoBit: 'NNTTTTTNNTTTTTTTNTTTTTTTNTTTTTTT',
  },

  'paired-branches.s': {
    off: [11, 19, 11, 11],
    on: [11, 19, 11, 11],
    actual: 'NN',
    oneBit: 'NN',
    twoBit: 'NN',
  },

  // No transfer, so all four schemes agree — 29 and 23 are `TIMING`'s N + 6 + S with P = 0.
  'register-reuse.s': {
    off: [29, 29, 29, 29],
    on: [23, 23, 23, 23],
    actual: '',
    oneBit: '',
    twoBit: '',
  },

  'slow-op-loop.s': {
    off: [95, 89, 91, 91],
    on: [69, 63, 65, 65],
    actual: 'TTTTTN',
    oneBit: 'NTTTTT',
    twoBit: 'NTTTTT',
  },

  'store-forward.s': {
    off: [19, 19, 19, 19],
    on: [15, 15, 15, 15],
    actual: '',
    oneBit: '',
    twoBit: '',
  },

  'strided-sum.s': {
    off: [96, 92, 94, 94],
    on: [74, 70, 72, 72],
    actual: 'TTTTN',
    oneBit: 'NTTTT',
    twoBit: 'NTTTT',
  },

  'sum-loop.s': {
    off: [109, 95, 97, 97],
    on: [87, 73, 75, 75],
    actual: 'TTTTTTTTTN',
    oneBit: 'NTTTTTTTTT',
    twoBit: 'NTTTTTTTTT',
  },
};

const SCHEMES = ['static-not-taken', 'static-taken', 'dynamic-1bit', 'dynamic-2bit'] as const;

function run(file: string, config: ProcessorConfig): CycleTrace[] {
  const { program, errors } = assemble(readFileSync(PROGRAMS_DIR + file, 'utf8'));
  if (!program) {
    throw new Error(
      `${file}: ${errors.map((e) => `${e.line}:${e.column} ${e.message}`).join(', ')}`,
    );
  }
  const p = new DeepPipelineProcessor();
  p.reset(toProgramImage(program), config);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    if (traces.length >= 600) throw new Error(`${file}: exceeded 600 cycles — runaway loop?`);
    traces.push(p.step());
  }
  return traces;
}

function eventsOf<T extends TraceEvent['type']>(
  ts: CycleTrace[],
  type: T,
): Extract<TraceEvent, { type: T }>[] {
  return ts.flatMap((t) =>
    t.events.filter((e): e is Extract<TraceEvent, { type: T }> => e.type === type),
  );
}

const config = (
  branchPrediction: ProcessorConfig['branchPrediction'],
  forwarding: boolean,
): ProcessorConfig => ({ ...defaultConfig(), forwarding, branchPrediction });

const predictedString = (ts: CycleTrace[]): string =>
  eventsOf(ts, 'branch-resolved')
    .map((e) => (e.predicted ? 'T' : 'N'))
    .join('');

const actualString = (ts: CycleTrace[]): string =>
  eventsOf(ts, 'branch-resolved')
    .map((e) => (e.actual ? 'T' : 'N'))
    .join('');

/**
 * What an offline predictor WOULD have bet, given the same branches in the same order — the pc from
 * `instr-fetch` and the mnemonic from its `encoding`, so this reaches the branch's own address by a
 * completely different route than the engine did.
 *
 * The three-way policy split is spelled out rather than delegated, so this stays an INDEPENDENT
 * model of the policy: a conditional branch consults the table, `jal` bypasses it and is bet taken,
 * `jalr` is unpredictable. Delegating to the engine's own `betTarget` would make it agree by
 * construction and pin nothing.
 */
function replay(ts: CycleTrace[], scheme: DynamicScheme): string {
  const fetches = eventsOf(ts, 'instr-fetch');
  const pcOf = new Map(fetches.map((e) => [e.instr, e.pc]));
  const encodingOf = new Map(fetches.map((e) => [e.instr, e.encoding]));
  const predictor = new BranchPredictor(scheme);
  let out = '';
  for (const e of eventsOf(ts, 'branch-resolved')) {
    const pc = pcOf.get(e.instr);
    const encoding = encodingOf.get(e.instr);
    if (pc === undefined || encoding === undefined) {
      throw new Error(`branch-resolved names ${e.instr}, which was never fetched`);
    }
    const d = decode(encoding);
    if (isConditionalBranch(d)) {
      out += predictor.predict(pc) ? 'T' : 'N';
      predictor.update(pc, e.actual); // trained on what it DID, after the bet was read
    } else {
      out += isPredictable(d) ? 'T' : 'N';
    }
  }
  return out;
}

const FILES = Object.keys(TABLE);
const DYNAMIC = ['dynamic-1bit', 'dynamic-2bit'] as const;
const CASES = FILES.flatMap((file) => DYNAMIC.map((scheme) => ({ file, scheme })));

describe('the dynamic schemes on the deep pipeline', () => {
  it('covers every program in the corpus', () => {
    // The same guard `timing.test.ts` carries: the corpus is enumerated from disk, so a program
    // added later joins INV-8 automatically and would join this file not at all.
    const corpus = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.s'));
    expect(corpus.length).toBeGreaterThan(0);
    expect([...corpus].sort()).toEqual([...FILES].sort());
  });

  it('is not sweeping a corpus of empty strings', () => {
    // Non-vacuity for every string assertion below. Three corpus programs have no control transfer
    // at all, so their rows are `''` and every claim about them holds trivially.
    const withTransfers = FILES.filter((f) => TABLE[f]!.actual.length > 0);
    expect(withTransfers).toHaveLength(9);
    expect(TABLE['nested-loop.s']!.actual).toHaveLength(32);
  });

  /**
   * The invariance the whole derivation rested on, re-checked on THIS engine rather than inherited:
   * a program's outcome sequence is the same under every scheme. The sequence, not the count —
   * `cycles-cannot-see-a-lost-forward` is this repo's record of a count agreeing while the sequence
   * underneath it did not.
   */
  it.each(FILES)('%s resolves the same branches, the same way, under every scheme', (file) => {
    for (const scheme of SCHEMES) {
      for (const forwarding of [false, true]) {
        expect(
          actualString(run(file, config(scheme, forwarding))),
          `${scheme} fwd=${forwarding}`,
        ).toBe(TABLE[file]!.actual);
      }
    }
  });

  /** Claim 1 — the engine's bets are an offline `BranchPredictor`'s bets, event for event. */
  it.each(CASES)('$file under $scheme replays exactly', ({ file, scheme }) => {
    for (const forwarding of [false, true]) {
      const ts = run(file, config(scheme, forwarding));
      expect(predictedString(ts), `fwd=${forwarding}`).toBe(replay(ts, scheme));
    }
  });

  /**
   * Claim 2 — written out rather than replayed, so this pins the POLICY the engine and the replay
   * share: the seed, the taken threshold, the `jal` bypass and `jalr`'s permanent unpredictability.
   * ⚠ **This is the claim the plan says a step-5 copy-paste cannot satisfy by "fixing" the replay**:
   * a model that answered one of the `jal` decisions differently agrees with a replay changed to
   * match it, and still fails these literals.
   */
  it.each(CASES)('$file under $scheme bets the pinned string', ({ file, scheme }) => {
    const row = TABLE[file]!;
    const expected = scheme === 'dynamic-1bit' ? row.oneBit : row.twoBit;
    for (const forwarding of [false, true]) {
      expect(predictedString(run(file, config(scheme, forwarding))), `fwd=${forwarding}`).toBe(
        expected,
      );
    }
  });

  /**
   * Claim 3 — the derived columns, measured. These were computed from the not-taken baseline and the
   * per-instance price rule (4 / 2 / 0) before this model could run a dynamic scheme at all, and
   * every cell came out of a real run unchanged.
   */
  it.each(FILES)('%s takes the pinned cycles under all four schemes', (file) => {
    const row = TABLE[file]!;
    for (const position of ['off', 'on'] as const) {
      SCHEMES.forEach((scheme, i) => {
        expect(
          run(file, config(scheme, position === 'on')),
          `${scheme} fwd ${position}`,
        ).toHaveLength(row[position][i]!);
      });
    }
  });

  /**
   * The corpus totals, and the finding that makes this model's row worth stating separately from the
   * 5-stage's.
   *
   * **On the 5-stage the aggregate case for this feature is thin** — over the eleven programs that
   * predate `nested-loop.s`, `dynamic-2bit` beat `static-taken` by ONE cycle and `dynamic-1bit` tied
   * it. **Depth changes that, and by more than the doubled coefficient alone would suggest.** Here
   * both dynamic schemes beat `static-taken` over those same eleven, and corpus-wide the 2-bit
   * margin is 14 cycles. The mechanism is the one the model exists to teach: every wrong bet costs
   * 4 instead of 2, so the schemes that make fewer of them separate twice as fast.
   *
   * Pinned because it is the number a future scheme, table size or seed would move first.
   */
  it('the corpus totals — depth doubles what a counter is worth', () => {
    const totals = (files: readonly string[], position: 'off' | 'on'): number[] =>
      SCHEMES.map((_, i) => files.reduce((sum, f) => sum + TABLE[f]![position][i]!, 0));

    // HISTORICAL cohort — "the programs that predate `nested-loop.s`" — so anything added later is
    // excluded by the sentence's meaning. `register-reuse.s` (M15 step 6) is the inert kind of
    // addition: no transfer, so it contributes 29/23 to all four columns and cannot move a margin.
    const LATER = ['nested-loop.s', 'register-reuse.s'];
    const original = FILES.filter((f) => !LATER.includes(f));
    expect(original).toHaveLength(11);
    expect(totals(original, 'off'), 'the ELEVEN, forwarding off').toEqual([892, 842, 842, 840]);
    expect(totals(original, 'on'), 'the ELEVEN, forwarding on').toEqual([704, 654, 654, 652]);

    expect(totals(FILES, 'off'), 'the THIRTEEN, forwarding off').toEqual([1183, 1123, 1117, 1109]);
    expect(totals(FILES, 'on'), 'the THIRTEEN, forwarding on').toEqual([925, 865, 859, 851]);

    const [, staticTaken, oneBit, twoBit] = totals(FILES, 'off');
    expect(staticTaken! - twoBit!, 'the 2-bit margin over static-taken, corpus-wide').toBe(14);
    // ...and the 1-bit's margin is the half of it that is NOT hysteresis: on the 5-stage this
    // difference was 0 over the original eleven, which is why that model's header calls the
    // aggregate case thin and this one does not.
    expect(staticTaken! - oneBit!, 'the 1-bit margin, which the 5-stage does not have').toBe(6);
  });
});

/** The counters recorded at each cycle — `micro.predictor`, or `null` for a machine with no table. */
const tablesOf = (ts: CycleTrace[]): (number[] | null)[] =>
  ts.map((t) => (t.state.micro as DeepPipelineMicro).predictor?.counters ?? null);

/**
 * What the table WOULD hold at the end of each cycle, replayed offline from the same branches — the
 * per-cycle sibling of {@link replay}. What it adds is WHEN: the recorded table at cycle `i` must
 * already carry cycle `i`'s own training, because `micro` is a post-cycle snapshot.
 *
 * ⚠ **The `.slice()` is not incidental** — `snapshot()` hands back the LIVE table by design, so
 * without it this helper would return one aliased array per cycle and reproduce, inside the test,
 * exactly the defect the test exists to catch.
 */
function expectedTables(ts: CycleTrace[], scheme: DynamicScheme): number[][] {
  const fetches = eventsOf(ts, 'instr-fetch');
  const pcOf = new Map(fetches.map((e) => [e.instr, e.pc]));
  const encodingOf = new Map(fetches.map((e) => [e.instr, e.encoding]));
  const predictor = new BranchPredictor(scheme);
  return ts.map((t) => {
    for (const e of t.events) {
      if (e.type !== 'branch-resolved') continue;
      const pc = pcOf.get(e.instr);
      const encoding = encodingOf.get(e.instr);
      if (pc === undefined || encoding === undefined) {
        throw new Error(`branch-resolved names ${e.instr}, which was never fetched`);
      }
      if (isConditionalBranch(decode(encoding))) predictor.update(pc, e.actual);
    }
    return predictor.snapshot().counters.slice();
  });
}

/** A cold 2-bit table: sixteen counters, each **weakly not-taken** — written out, not asked for. */
const COLD_2BIT = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

/**
 * `nested-loop.s`'s table after the last branch retires under `'dynamic-2bit'` — the SAME literal
 * the 5-stage pins, and identical for a reason worth stating: the final table is a function of the
 * branch outcomes and the training policy, both of which are model-invariant. Three rows moved:
 *
 *   - **index 2** — the guard at pc 8 (`bne x0, x0, done`), never taken, driven to the floor.
 *   - **index 6** — the inner branch at pc 24, `TTTTTN` per pass, ending at 2 rather than 0, which
 *     IS the feature: it re-enters still betting taken.
 *   - **index 8** — the outer branch at pc 32, `TTTN`, weakly taken for the same reason.
 *
 * ⚠ **Written out rather than compared against a replay, and that buys a defect class nothing else
 * here can see.** The replay routes through `predictorIndex` exactly as the engine does, so a
 * CONSISTENT shift of the index agrees with itself perfectly — measured at step 3 as invisible to
 * the engine, the trace and the replay alike. A literal naming rows 2, 6 and 8 does not agree.
 */
const TRAINED_2BIT_NESTED = [1, 1, 0, 1, 1, 1, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1];

/**
 * **The recorded table, and the deep copy that is the whole of it.**
 *
 * `BranchPredictor` is single-buffered and mutated in place, exactly like `CacheState` — so the
 * RECORDER owns the copy. Handed straight through, one array aliases every recorded cycle and a
 * scrub back to cycle 0 shows a machine that has already learned everything; spreading the wrapper
 * (`{ ...snapshot() }`) looks like a fix, passes an identity check on the OBJECT, and aliases the
 * same array — measured on the 5-stage at step 4 as reddening the identical 20 tests as no copy at
 * all. That is why the identity assertion below is on `.counters` and never on the wrapper.
 *
 * ⚠ **This block is written WITH the recording rather than with step 6's reader, and that is the
 * whole lesson of step 4**: landing the 5-stage's recording reddened ZERO of 7830 tests, because
 * nothing in the repo reads `micro.predictor` yet. Code with no consumer is code no test is shaped
 * to cover, so the net ships with the field or it does not ship.
 *
 * **What each claim would miss alone.** *Cycle 0 is COLD* is the net — the assertion a shallow copy
 * fails. *The last cycle is TRAINED* is not coverage for that class at all (a shallow copy shows the
 * trained table everywhere, so it passes under the defect); it is the non-vacuity control, and it is
 * also the only thing here that would see a rotated index. *Cold ≠ trained* is what stops both from
 * being trivial. ⚠ And the control has to be `'dynamic-2bit'`: under `'dynamic-1bit'`,
 * `nested-loop.s` finishes holding exactly the COLD table, because each of its three branches' last
 * outcome is not-taken and a 1-bit counter keeps no memory of anything earlier.
 */
describe('the recorded table on the deep pipeline', () => {
  const TRAINS = 'nested-loop.s'; // three branch sites, 32 resolutions, and rows that move

  it('records a COLD table at cycle 0 — the assertion a shallow copy fails', () => {
    const tables = tablesOf(run(TRAINS, config('dynamic-2bit', false)));
    expect(tables[0]).toEqual(COLD_2BIT);
    expect(tables[0]).toHaveLength(PREDICTOR_ENTRIES);
  });

  it('...and a TRAINED one at the end — the control, which the shallow copy also passes', () => {
    const tables = tablesOf(run(TRAINS, config('dynamic-2bit', false)));
    expect(tables.at(-1)).toEqual(TRAINED_2BIT_NESTED);
    // Non-vacuity for the assertions on either side: both are claims about a table CHANGING.
    expect(TRAINED_2BIT_NESTED).not.toEqual(COLD_2BIT);
  });

  it('...and the 1-bit table ends cold, which is why the control above is not 1-bit', () => {
    const tables = tablesOf(run(TRAINS, config('dynamic-1bit', false)));
    const cold = new Array<number>(PREDICTOR_ENTRIES).fill(0);
    expect(tables[0]).toEqual(cold);
    expect(tables.at(-1)).toEqual(cold);
    // ...while the run in between is emphatically not constant.
    expect(new Set(tables.map((t) => t!.join(','))).size).toBeGreaterThan(1);
  });

  it('gives every cycle its OWN array — a spread of the wrapper is not a copy', () => {
    const ts = run(TRAINS, config('dynamic-2bit', false));
    const counters = ts.map((t) => (t.state.micro as DeepPipelineMicro).predictor!.counters);
    expect(new Set(counters).size, 'one array per cycle, shared with nothing').toBe(ts.length);
  });

  /**
   * The strongest claim here, and the only one that pins WHEN the snapshot is taken: the table
   * recorded at cycle `i` is what an offline predictor holds after every branch resolved THROUGH
   * cycle `i`. Both forwarding positions, because forwarding moves stalls and so moves which cycle
   * each branch resolves in — on this machine by more than on the 5-stage, since a stall in ID holds
   * a branch four stages away from its own resolution.
   */
  it.each(CASES)(
    '$file under $scheme records the table trained through each cycle',
    ({ file, scheme }) => {
      for (const forwarding of [false, true]) {
        const ts = run(file, config(scheme, forwarding));
        expect(tablesOf(ts), `fwd=${forwarding}`).toEqual(expectedTables(ts, scheme));
      }
    },
  );

  it('is not sweeping tables that never move', () => {
    // Non-vacuity for the per-cycle sweep, in this file's own "not sweeping empty strings" idiom.
    // Eight of the 24 cases hold the cold table on every cycle and are trivially true: the three
    // branchless programs (six cases), plus `call-return.s` and `paired-branches.s` under
    // `'dynamic-1bit'`, whose only conditional branches are never taken and so leave a 1-bit counter
    // parked at its floor. The number is MEASURED (the 5-stage's break rows 1, 2 and 5 each reddened
    // exactly the other sixteen) rather than reasoned to.
    const moving = CASES.filter(({ file, scheme }) => {
      const tables = tablesOf(run(file, config(scheme, false)));
      return new Set(tables.map((t) => t!.join(','))).size > 1;
    });
    expect(moving).toHaveLength(16);
  });

  /**
   * The inertness half: a machine with no counter table records `null`, not an empty or a cold one.
   * `'none'` is included because it is what `defaultConfig()` selects and therefore the value every
   * other suite in this package reads.
   */
  it.each(['none', 'static-not-taken', 'static-taken'] as const)(
    'records `null` under %s — no table, nothing to report',
    (scheme) => {
      for (const forwarding of [false, true]) {
        const tables = tablesOf(run(TRAINS, config(scheme, forwarding)));
        expect(tables.length, `${scheme} fwd=${forwarding}`).toBeGreaterThan(0);
        expect(
          tables.every((t) => t === null),
          `${scheme} fwd=${forwarding}`,
        ).toBe(true);
      }
    },
  );
});
