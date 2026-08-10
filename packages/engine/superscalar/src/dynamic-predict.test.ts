import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble } from '@cpu-viz/assembler';
import { decode } from '@cpu-viz/isa';
import {
  BranchPredictor,
  MAX_ISSUE_WIDTH,
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
import { SuperscalarProcessor, type SuperscalarMicro } from './index';

/**
 * **The net for the dynamic schemes on the SUPERSCALAR** — dynamic-branch-prediction plan, step 5,
 * model 2 of 3. The long form of why each claim exists is in
 * `pipeline/src/dynamic-predict.test.ts`; this header records what WIDTH changes, which is the only
 * thing that makes this model's row different from the 5-stage's.
 *
 * ## At width 1 this machine IS the 5-stage, and the table says so
 *
 * Every cell of {@link W1} is identical to the pipeline's — same cycles, same bets, same outcomes —
 * because a width-1 superscalar has the 5-stage's shape and the same per-instance price (2
 * mispredicted, 1 correct-taken, 0 correct-not-taken). Those columns were DERIVED before this model
 * could run a dynamic scheme, from the not-taken baseline plus that price rule, and the rule was
 * validated first against the MEASURED `static-taken` column on all twelve programs × both
 * positions. They needed no correction. Restating them here rather than importing them is
 * deliberate: the two packages are siblings in the DAG, and two independent routes to one number is
 * this suite's own idiom.
 *
 * ## At width ≥ 2 the derivation STOPS WORKING, and that is the interesting part
 *
 * A bet ENDS its issue group — the fall-through beside it is killed — so a bet does not merely cost
 * a penalty, it **re-partitions the schedule**. `G` and `Q` move with the scheme, which means
 * `cycles(scheme) = cycles(not-taken) − P(not-taken) + P(scheme)` is false at width 2 and the
 * plan's warning is exact: **step 0's table is pipeline-shaped and must not be inherited here.**
 * So the wide cells below are MEASURED and labelled as such, and three independent things carry
 * them instead of a derivation:
 *
 *  1. **The closed form `cycles = G + L + P + 4` balances** under both dynamic schemes at every
 *     width — the same identity this package already pins for the static schemes, with `P` priced
 *     per INSTANCE from the engine's own outcomes. It cannot predict `G`, but it catches an
 *     accounting that has stopped adding up.
 *  2. **The bet STRING is width-invariant** — asserted, not assumed. The counter is consulted from
 *     the pc and trained at resolution, and this machine resolves in program order at every width,
 *     so widening must not change a single character. This is what pins the POLICY at width ≥ 2,
 *     where the cycle counts alone cannot.
 *  3. **A program that never bets records IDENTICALLY to `static-not-taken`** at every width —
 *     the partition net. Five of the twelve qualify, and a dynamic scheme that placed one extra bet
 *     would re-partition their schedules and fail this even where the cycle count happened to land.
 *
 * ## The finding, and it is this model's own
 *
 * ⚠ **At width 2 `static-taken` LOSES on `nested-loop.s` — 175 against not-taken's 172 — and the
 * dynamic schemes are the only ones that win.** M13 recorded the first half (`static-taken`'s sign
 * flips with width, because every bet ends its issue group); the second half is new here. A counter
 * that DECLINES the bets it would lose keeps the pairs a blanket bet destroys: at width 2 the guard
 * and the loop exits leave `Q` at 35 / 32 under the dynamic schemes against `static-taken`'s 26,
 * while still collecting most of the correct-bet savings. 1-bit runs 168 and 2-bit 165 against 172
 * and 175.
 *
 * **So width and depth argue for a counter for OPPOSITE reasons**, which is the pair of sentences
 * this feature's lesson (step 8) can be built on: depth makes a wrong bet cost more, width makes
 * every bet cost something. The 5-stage, which has neither, is where the aggregate case looks thin.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

const SCHEMES = ['static-not-taken', 'static-taken', 'dynamic-1bit', 'dynamic-2bit'] as const;
const DYNAMIC = ['dynamic-1bit', 'dynamic-2bit'] as const;
const WIDTHS = Array.from({ length: MAX_ISSUE_WIDTH }, (_, i) => i + 1);

/** Cycles at WIDTH 1, forwarding off then on: not-taken, static-taken, 1-bit, 2-bit. DERIVED. */
const W1: Record<string, { off: readonly number[]; on: readonly number[] }> = {
  'add.s': { off: [9, 9, 9, 9], on: [7, 7, 7, 7] },
  'array-sum-twice.s': { off: [290, 273, 276, 275], on: [208, 191, 194, 193] },
  'array-sum.s': { off: [72, 70, 71, 71], on: [51, 49, 50, 50] },
  'branch-flavors.s': { off: [16, 17, 16, 16], on: [15, 16, 15, 15] },
  'byte-loads.s': { off: [14, 14, 14, 14], on: [10, 10, 10, 10] },
  'call-return.s': { off: [17, 18, 16, 16], on: [17, 18, 16, 16] },
  'nested-loop.s': { off: [182, 177, 174, 171], on: [142, 137, 134, 131] },
  'paired-branches.s': { off: [9, 13, 9, 9], on: [9, 13, 9, 9] },
  // No transfer ⇒ every scheme is one machine: `TIMING`'s N + 4 + S at width 1.
  'register-reuse.s': { off: [23, 23, 23, 23], on: [17, 17, 17, 17] },
  'slow-op-loop.s': { off: [70, 67, 68, 68], on: [44, 41, 42, 42] },
  'store-forward.s': { off: [15, 15, 15, 15], on: [11, 11, 11, 11] },
  'strided-sum.s': { off: [72, 70, 71, 71], on: [51, 49, 50, 50] },
  'sum-loop.s': { off: [78, 71, 72, 72], on: [56, 49, 50, 50] },
};

/**
 * Cycles at WIDTH 2 — **MEASURED, not derived**, for the reason in the header: a bet re-partitions
 * the schedule, so no per-instance price rule reaches these. Read `nested-loop.s` and
 * `paired-branches.s`: on both, `static-taken` is the SLOWEST column, and on both the dynamic
 * schemes match or beat the not-taken machine that beats it.
 */
const W2: Record<string, { off: readonly number[]; on: readonly number[] }> = {
  'add.s': { off: [8, 8, 8, 8], on: [6, 6, 6, 6] },
  'array-sum-twice.s': { off: [262, 247, 250, 249], on: [178, 163, 166, 165] },
  'array-sum.s': { off: [65, 64, 65, 65], on: [42, 41, 42, 42] },
  'branch-flavors.s': { off: [13, 14, 13, 13], on: [11, 12, 11, 11] },
  'byte-loads.s': { off: [13, 13, 13, 13], on: [9, 9, 9, 9] },
  'call-return.s': { off: [14, 15, 13, 13], on: [14, 15, 13, 13] },
  'nested-loop.s': { off: [172, 175, 168, 165], on: [108, 111, 104, 101] },
  'paired-branches.s': { off: [7, 12, 7, 7], on: [7, 12, 7, 7] },
  // `TIMING`'s width-2 G + L + 4: 7 + 8 + 4 off, 7 + 2 + 4 on. Flat, for the same reason.
  'register-reuse.s': { off: [19, 19, 19, 19], on: [13, 13, 13, 13] },
  'slow-op-loop.s': { off: [61, 58, 59, 59], on: [35, 32, 33, 33] },
  'store-forward.s': { off: [13, 13, 13, 13], on: [9, 9, 9, 9] },
  'strided-sum.s': { off: [65, 64, 65, 65], on: [42, 41, 42, 42] },
  'sum-loop.s': { off: [66, 59, 60, 60], on: [44, 37, 38, 38] },
};

/**
 * `G` (issue-group cycles) and `Q` (cycles that issued TWO) at width 2 under each DYNAMIC scheme,
 * forwarding off — **the plan's "the superscalar's `betting` counts are RE-DERIVED per scheme, never
 * carried over", discharged.** They are measured, and they are the whole content of the finding:
 * a dynamic scheme's `Q` sits BETWEEN the two static schemes' because it bets less often than
 * `static-taken` and more often than not at all.
 */
const W2_SCHEDULE: Record<
  string,
  { oneBit: readonly [number, number]; twoBit: readonly [number, number] }
> = {
  'add.s': { oneBit: [2, 1], twoBit: [2, 1] },
  'array-sum-twice.s': { oneBit: [106, 31], twoBit: [106, 30] },
  'array-sum.s': { oneBit: [27, 8], twoBit: [27, 8] },
  'branch-flavors.s': { oneBit: [5, 4], twoBit: [5, 4] },
  'byte-loads.s': { oneBit: [5, 1], twoBit: [5, 1] },
  'call-return.s': { oneBit: [6, 3], twoBit: [6, 3] },
  'nested-loop.s': { oneBit: [62, 35], twoBit: [62, 32] },
  'paired-branches.s': { oneBit: [3, 2], twoBit: [3, 2] },
  // G = 7, Q = 4 — `TIMING`'s width-2 partition, and it cannot move with the scheme: there is no
  // bet to end a group, so this row is the degenerate case the finding above is measured against.
  'register-reuse.s': { oneBit: [7, 4], twoBit: [7, 4] },
  'slow-op-loop.s': { oneBit: [21, 10], twoBit: [21, 10] },
  'store-forward.s': { oneBit: [5, 2], twoBit: [5, 2] },
  'strided-sum.s': { oneBit: [27, 8], twoBit: [27, 8] },
  'sum-loop.s': { oneBit: [22, 13], twoBit: [22, 13] },
};

/** The ordered outcomes and bets — properties of the PROGRAM, asserted below rather than assumed. */
const STRINGS: Record<string, { actual: string; oneBit: string; twoBit: string }> = {
  'add.s': { actual: '', oneBit: '', twoBit: '' },
  'array-sum-twice.s': {
    actual: 'TTTTTTTTTTTNTTTTTTTTTTTTNN',
    oneBit: 'NTTTTTTTTTTTNNTTTTTTTTTTTT',
    twoBit: 'NTTTTTTTTTTTNTTTTTTTTTTTTT',
  },
  'array-sum.s': { actual: 'TTTTN', oneBit: 'NTTTT', twoBit: 'NTTTT' },
  'branch-flavors.s': { actual: 'TN', oneBit: 'NN', twoBit: 'NN' },
  'byte-loads.s': { actual: '', oneBit: '', twoBit: '' },
  'call-return.s': { actual: 'TNT', oneBit: 'TNN', twoBit: 'TNN' },
  'nested-loop.s': {
    actual: 'NTTTTTNTNTTTTTNTNTTTTTNTNTTTTTNN',
    oneBit: 'NNTTTTTNNNTTTTTTNNTTTTTTNNTTTTTT',
    twoBit: 'NNTTTTTNNTTTTTTTNTTTTTTTNTTTTTTT',
  },
  'paired-branches.s': { actual: 'NN', oneBit: 'NN', twoBit: 'NN' },
  'register-reuse.s': { actual: '', oneBit: '', twoBit: '' },
  'slow-op-loop.s': { actual: 'TTTTTN', oneBit: 'NTTTTT', twoBit: 'NTTTTT' },
  'store-forward.s': { actual: '', oneBit: '', twoBit: '' },
  'strided-sum.s': { actual: 'TTTTN', oneBit: 'NTTTT', twoBit: 'NTTTT' },
  'sum-loop.s': { actual: 'TTTTTTTTTN', oneBit: 'NTTTTTTTTT', twoBit: 'NTTTTTTTTT' },
};

/**
 * The programs whose dynamic bet string is all `N` — they never place a bet under either scheme, so
 * their whole recording must be `static-not-taken`'s. **Derived from {@link STRINGS} rather than
 * hand-listed**, so a program whose bets change cannot stay on this list by accident.
 */
const NEVER_BETS = Object.keys(STRINGS).filter(
  (f) => !STRINGS[f]!.oneBit.includes('T') && !STRINGS[f]!.twoBit.includes('T'),
);

const FILES = Object.keys(W1);
const CASES = FILES.flatMap((file) => DYNAMIC.map((scheme) => ({ file, scheme })));

/**
 * Runs are MEMOIZED, and that is a performance fix rather than a style one: this file sweeps
 * 12 programs × 4 widths × 2 positions × 4 schemes and several claims re-visit the same cell, so
 * without the cache the same `array-sum-twice.s` run is re-executed dozens of times and the suite
 * takes over a minute. The engine is pure and deterministic (INV-1), so a cached run is the run.
 * The returned traces are never mutated by anything here — the one place that could,
 * {@link expectedTables}, `.slice()`s what it reads.
 */
const RUNS = new Map<string, CycleTrace[]>();

function run(file: string, config: ProcessorConfig): CycleTrace[] {
  const key = `${file}|${config.branchPrediction}|${config.forwarding}|${config.issueWidth}`;
  const hit = RUNS.get(key);
  if (hit !== undefined) return hit;
  const traces = runUncached(file, config);
  RUNS.set(key, traces);
  return traces;
}

function runUncached(file: string, config: ProcessorConfig): CycleTrace[] {
  const { program, errors } = assemble(readFileSync(PROGRAMS_DIR + file, 'utf8'));
  if (!program) {
    throw new Error(
      `${file}: ${errors.map((e) => `${e.line}:${e.column} ${e.message}`).join(', ')}`,
    );
  }
  const p = new SuperscalarProcessor();
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
  issueWidth = 1,
): ProcessorConfig => ({
  ...defaultConfig(),
  forwarding,
  branchPrediction,
  issueWidth,
  // Written EXPLICITLY, following `timing.test.ts`: an inherited default would silently add
  // `misses × missPenalty` to every cell below.
  cache: null,
});

const predictedString = (ts: CycleTrace[]): string =>
  eventsOf(ts, 'branch-resolved')
    .map((e) => (e.predicted ? 'T' : 'N'))
    .join('');

const actualString = (ts: CycleTrace[]): string =>
  eventsOf(ts, 'branch-resolved')
    .map((e) => (e.actual ? 'T' : 'N'))
    .join('');

/** `P` — every resolved transfer priced by what the engine actually predicted. */
const penaltyFromEvents = (ts: CycleTrace[]): number =>
  eventsOf(ts, 'branch-resolved').reduce(
    (sum, e) => sum + (e.predicted !== e.actual ? 2 : e.actual ? 1 : 0),
    0,
  );

/**
 * How many instructions ID handed to EX each cycle — `timing.test.ts`'s `issuedPerCycle`, restated
 * rather than imported because it is a *test* helper and not part of this package's surface. The two
 * agreeing is checked by the assertions below reproducing that file's `G`/`Q` under the static
 * schemes; if the two ever drift, both files fail and name which.
 */
function issuedPerCycle(ts: CycleTrace[], width: number): number[] {
  // One pass building a per-cycle id→location index, rather than `find`/`some` inside the slot loop:
  // the sweeps here are wide enough that the quadratic spelling dominated the whole file's runtime.
  const inExAt = ts.map(
    (t) => new Set(t.instructions.filter((i) => i.location.startsWith('EX.')).map((i) => i.id)),
  );
  const counts: number[] = [];
  for (let c = 0; c < ts.length - 1; c++) {
    let n = 0;
    for (let s = 0; s < width; s++) {
      const inId = ts[c]!.instructions.find((i) => i.location === `ID.${s}`);
      if (inId && inExAt[c + 1]!.has(inId.id)) n++;
    }
    counts.push(n);
  }
  return counts;
}

/** `G`, `Q` and `L` for one run. `L` is a BLOCKING stall: a stall fired and nothing issued. */
function schedule(ts: CycleTrace[], width: number): { G: number; Q: number; L: number } {
  let G = 0;
  let Q = 0;
  let L = 0;
  issuedPerCycle(ts, width).forEach((n, c) => {
    const stalled = ts[c]!.events.some((e) => e.type === 'stall');
    if (n > 0) G++;
    if (n === 2) Q++;
    if (stalled && n === 0) L++;
  });
  return { G, Q, L };
}

/**
 * What an offline predictor WOULD have bet — the pc from `instr-fetch`, the mnemonic from its
 * `encoding`, so this reaches the branch's address by a different route than the engine did. The
 * three-way policy split is spelled out rather than delegated, so it stays an INDEPENDENT model of
 * the policy rather than agreeing with the engine by construction.
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
      predictor.update(pc, e.actual);
    } else {
      out += isPredictable(d) ? 'T' : 'N';
    }
  }
  return out;
}

describe('the dynamic schemes on the superscalar', () => {
  it('covers every program in the corpus', () => {
    const corpus = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.s'));
    expect(corpus.length).toBeGreaterThan(0);
    expect([...corpus].sort()).toEqual([...FILES].sort());
    // Every table keys the same twelve — a row added to one and not the others would otherwise
    // silently narrow a sweep rather than fail it.
    expect(Object.keys(W2).sort()).toEqual([...FILES].sort());
    expect(Object.keys(STRINGS).sort()).toEqual([...FILES].sort());
    expect(Object.keys(W2_SCHEDULE).sort()).toEqual([...FILES].sort());
    // ...and the widths sweep every width the machine has, derived rather than hand-listed.
    expect(WIDTHS).toEqual([1, 2, 3, 4]);
  });

  it('is not sweeping a corpus of empty strings', () => {
    const withTransfers = FILES.filter((f) => STRINGS[f]!.actual.length > 0);
    expect(withTransfers).toHaveLength(9);
    expect(STRINGS['nested-loop.s']!.actual).toHaveLength(32);
    // ...and the never-bets list is a real subset: not empty (it carries the partition net below)
    // and not everything (which would make that net vacuous). 6 of 13 since M15 step 6 —
    // `register-reuse.s` has no transfer at all, so it joins by the widest possible margin.
    expect(NEVER_BETS).toHaveLength(6);
    expect(NEVER_BETS).toContain('paired-branches.s');
  });

  /** The invariance the width-1 derivation rested on, re-checked on THIS engine at every width. */
  it.each(FILES)('%s resolves the same branches under every scheme and width', (file) => {
    for (const scheme of SCHEMES) {
      for (const width of WIDTHS) {
        for (const forwarding of [false, true]) {
          expect(
            actualString(run(file, config(scheme, forwarding, width))),
            `${scheme} w${width} fwd=${forwarding}`,
          ).toBe(STRINGS[file]!.actual);
        }
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
   * Claim 2 — the strings written out, which pins the POLICY the engine and the replay share, **and
   * at every width**. Width is the axis that matters here: the counter is consulted from the pc and
   * trained at resolution, and this machine resolves in program order however wide it is, so a
   * single character moving means widening has reached the predictor. That is the assertion carrying
   * the wide cells, since no derivation does.
   */
  it.each(CASES)(
    '$file under $scheme bets the pinned string, at every width',
    ({ file, scheme }) => {
      const expected = scheme === 'dynamic-1bit' ? STRINGS[file]!.oneBit : STRINGS[file]!.twoBit;
      for (const width of WIDTHS) {
        for (const forwarding of [false, true]) {
          expect(
            predictedString(run(file, config(scheme, forwarding, width))),
            `w${width} fwd=${forwarding}`,
          ).toBe(expected);
        }
      }
    },
  );

  /**
   * Claim 3a — the width-1 columns, DERIVED from the not-taken baseline and the per-instance price
   * before this model could run a dynamic scheme, and reproduced unchanged. Identical to the
   * 5-stage's table, because at width 1 this is that machine.
   */
  it.each(FILES)('%s takes the pinned width-1 cycles under all four schemes', (file) => {
    for (const position of ['off', 'on'] as const) {
      SCHEMES.forEach((scheme, i) => {
        expect(
          run(file, config(scheme, position === 'on')),
          `${scheme} fwd ${position}`,
        ).toHaveLength(W1[file]![position][i]!);
      });
    }
  });

  /** Claim 3b — the width-2 columns, MEASURED. See the header for why they cannot be derived. */
  it.each(FILES)('%s takes the pinned width-2 cycles under all four schemes', (file) => {
    for (const position of ['off', 'on'] as const) {
      SCHEMES.forEach((scheme, i) => {
        expect(
          run(file, config(scheme, position === 'on', 2)),
          `${scheme} fwd ${position}`,
        ).toHaveLength(W2[file]![position][i]!);
      });
    }
  });

  /**
   * Claim 3c — the width-2 SCHEDULE per dynamic scheme, which is what the cycle count alone cannot
   * say. `G` and `Q` are the terms a bet moves, and pinning them separately is why a failure names
   * whether the machine issued in different cycles or merely paid a different penalty.
   */
  it.each(FILES)('%s issues the pinned width-2 schedule under both dynamic schemes', (file) => {
    for (const scheme of DYNAMIC) {
      const { G, Q } = schedule(run(file, config(scheme, false, 2)), 2);
      const [g, q] =
        scheme === 'dynamic-1bit' ? W2_SCHEDULE[file]!.oneBit : W2_SCHEDULE[file]!.twoBit;
      expect(G, `${scheme} G`).toBe(g);
      expect(Q, `${scheme} Q`).toBe(q);
    }
  });

  /**
   * The accounting, at every width — `cycles = G + L + P + 4`, the identity this package already
   * pins for the static schemes. It cannot predict `G`, so it is not a derivation; what it catches
   * is a machine whose cycles and whose schedule have stopped agreeing, which is exactly what a
   * mis-timed bet produces.
   */
  it.each(CASES)(
    '$file under $scheme balances G + L + P + 4 at every width',
    ({ file, scheme }) => {
      for (const width of WIDTHS) {
        for (const forwarding of [false, true]) {
          const ts = run(file, config(scheme, forwarding, width));
          const { G, L } = schedule(ts, width);
          expect(ts, `w${width} fwd=${forwarding}`).toHaveLength(G + L + penaltyFromEvents(ts) + 4);
        }
      }
    },
  );

  /**
   * **The partition net.** A program whose bet string is all `N` never redirects fetch, so it must
   * record exactly what the not-taken machine records — at every width, where "exactly" includes the
   * issue partition that a single extra bet would change. This is the claim that would catch a
   * dynamic scheme betting one cycle early or in the wrong slot even where the cycle count happened
   * to land right.
   *
   * ⚠ **Everything EXCEPT `micro.predictor`**, and the exception is INV-2 rather than a weakening:
   * a machine that HAS a counter table honestly reports a cold one where a machine without reports
   * `null`. Stripping exactly that one field keeps the rest of the comparison total.
   */
  it.each(NEVER_BETS)('%s never bets, so it records what the not-taken machine records', (file) => {
    const strip = (ts: CycleTrace[]): unknown[] =>
      ts.map((t) => ({
        ...t,
        state: { ...t.state, micro: { ...(t.state.micro as object), predictor: null } },
      }));
    for (const width of WIDTHS) {
      for (const forwarding of [false, true]) {
        const notTaken = strip(run(file, config('static-not-taken', forwarding, width)));
        for (const scheme of DYNAMIC) {
          expect(
            strip(run(file, config(scheme, forwarding, width))),
            `${scheme} w${width}`,
          ).toEqual(notTaken);
        }
      }
    }
  });

  /**
   * ⚠ **The "ONE table, not one per lane" decision has NO NET on this corpus, and this test is what
   * makes that statement precise instead of leaving it a comment.** Measured: building a real
   * per-lane predictor — one `BranchPredictor` per slot, each bet from and trained by its own lane —
   * reddens **ZERO of 8754 tests**. `m13-review-resolved` records the class ("a pinned decision with
   * no net is a comment"), and the honest response is to say exactly why it is unreachable rather
   * than to write a test that pretends to cover it.
   *
   * **Why it is unreachable, exactly.** Per-lane tables can only differ from one shared table for a
   * branch that issues from more than one SLOT — otherwise each lane's table sees precisely the
   * branches it bets on and holds the identical history. Across the whole corpus × every width ×
   * both dynamic schemes there is exactly **one** such branch: `nested-loop.s`'s guard at pc 8,
   * which lands in `EX.2` and `EX.0` on different passes at widths 3 and 4. And that branch is
   * `bne x0, x0` — **never taken**, so its counter sits at the floor in every table that could hold
   * it and both machines bet `N` on it forever.
   *
   * So the corpus has a lane-alternating branch and it is the one branch whose counter never moves.
   * This test pins both halves, which makes it an ARRIVAL tripwire: a future corpus program with a
   * TAKEN branch that alternates lanes turns it red, and at that moment the decision acquires a net
   * and this comment stops being the only thing holding it. (The schema is a partial net in the
   * meantime: `SuperscalarMicro.predictor` is a bare `PredictorState`, so a per-lane machine that
   * RECORDED its lanes would not typecheck. What it cannot catch is one that keeps two tables
   * internally and records only one — which is precisely the mutation measured above.)
   */
  it('the only lane-alternating branch is the one whose counter never moves', () => {
    // ⚠ **Alternation is a property of ONE RUN, not of the corpus.** Aggregating a branch's slots
    // across widths finds "alternation" everywhere — the same branch is `EX.0` at width 1 and `EX.1`
    // at width 2 — which says nothing about whether one machine's lanes could disagree. The first
    // draft of this test did exactly that and reported three branches instead of one.
    const multiLane = new Set<number>();
    for (const width of WIDTHS) {
      for (const scheme of DYNAMIC) {
        for (const file of FILES) {
          const ts = run(file, config(scheme, false, width));
          const pcOf = new Map(eventsOf(ts, 'instr-fetch').map((e) => [e.instr, e.pc]));
          const perRun = new Map<number, Set<string>>();
          for (const t of ts) {
            for (const e of t.events) {
              if (e.type !== 'branch-resolved') continue;
              const where = t.instructions.find((i) => i.id === e.instr);
              const pc = pcOf.get(e.instr);
              if (where === undefined || pc === undefined) continue;
              const seen = perRun.get(pc) ?? new Set<string>();
              seen.add(where.location);
              perRun.set(pc, seen);
            }
          }
          for (const [pc, slots] of perRun) if (slots.size > 1) multiLane.add(pc);
        }
      }
    }

    // Exactly one, and it is the guard at pc 8. Stated as the pc rather than a count alone, so a
    // DIFFERENT branch starting to alternate fails here rather than silently taking its place.
    expect([...multiLane], 'the lane-alternating branches').toEqual([8]);

    // ...and its counter never leaves the floor, which is the half that makes the mutation
    // invisible. `nested-loop.s`'s guard is index 2 (pc 8 ⇒ `(8 >>> 2) & 15`), and under
    // `'dynamic-2bit'` it is driven DOWN from the weakly-not-taken seed and parks at 0.
    const tables = tablesOf(run('nested-loop.s', config('dynamic-2bit', false, 4)));
    const guardCounter = new Set(tables.map((t) => t![2]!));
    expect([...guardCounter].sort(), 'the guard never bets taken').toEqual([0, 1]);
    expect(tables.at(-1)![2], 'and it ends at the floor').toBe(0);
  });

  /**
   * The finding this model contributes, pinned as numbers so it cannot decay into a claim.
   *
   * **At width 2 `static-taken` is the SLOWEST scheme on `nested-loop.s`** — 175 against not-taken's
   * 172 — because every bet ends its issue group and this program bets on every pass. M13 pinned
   * that sign flip. What is new: **the dynamic schemes are the only ones that beat the not-taken
   * machine there**, 168 and 165, because they decline the bets they would lose and keep the pairs.
   * The schedule says the same thing in one number — `Q` is 26 under `static-taken`, 35 and 32 under
   * the dynamic schemes, 57 under not-taken.
   *
   * **Depth and width argue for a counter for OPPOSITE reasons**: the deep pipeline's row wins
   * because a wrong bet costs double, this one because every bet costs a pair.
   */
  it('at width 2 the dynamic schemes win where static-taken LOSES', () => {
    const cycles = (scheme: (typeof SCHEMES)[number], width: number): number =>
      run('nested-loop.s', config(scheme, false, width)).length;

    // Width 1: static-taken beats not-taken, and the dynamic schemes beat it.
    expect([cycles('static-not-taken', 1), cycles('static-taken', 1)], 'w1: betting WINS').toEqual([
      182, 177,
    ]);
    // Width 2: the sign has flipped — and only the counters are still ahead.
    expect(cycles('static-taken', 2), 'w2: betting LOSES').toBeGreaterThan(
      cycles('static-not-taken', 2),
    );
    expect(cycles('dynamic-1bit', 2)).toBeLessThan(cycles('static-not-taken', 2));
    expect(cycles('dynamic-2bit', 2)).toBeLessThan(cycles('dynamic-1bit', 2));
    expect([cycles('static-not-taken', 2), cycles('static-taken', 2)]).toEqual([172, 175]);
    expect([cycles('dynamic-1bit', 2), cycles('dynamic-2bit', 2)]).toEqual([168, 165]);

    // And `Q` is the mechanism, not the consequence: a bet costs a pair, so betting less often
    // where it would lose keeps more of them.
    const Q = (scheme: (typeof SCHEMES)[number]): number =>
      schedule(run('nested-loop.s', config(scheme, false, 2)), 2).Q;
    expect([
      Q('static-not-taken'),
      Q('static-taken'),
      Q('dynamic-1bit'),
      Q('dynamic-2bit'),
    ]).toEqual([57, 26, 35, 32]);
  });
});

/** The counters recorded at each cycle — `micro.predictor`, or `null` for a machine with no table. */
const tablesOf = (ts: CycleTrace[]): (number[] | null)[] =>
  ts.map((t) => (t.state.micro as SuperscalarMicro).predictor?.counters ?? null);

/** What the table WOULD hold at the end of each cycle, replayed offline from the same branches. */
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
    // `.slice()` is not incidental: `snapshot()` hands back the LIVE table by design, so without it
    // this helper would return one aliased array per cycle and reproduce, inside the test, exactly
    // the defect the test exists to catch.
    return predictor.snapshot().counters.slice();
  });
}

/** A cold 2-bit table: sixteen counters, each **weakly not-taken** — written out, not asked for. */
const COLD_2BIT = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

/**
 * `nested-loop.s`'s table after the last branch retires under `'dynamic-2bit'` — the same literal
 * the 5-stage and the deep pipeline pin, because the final table is a function of the branch
 * outcomes and the training policy, and neither depends on the machine. Rows 2 (the guard, driven to
 * the floor), 6 (the inner branch, re-entering still betting taken) and 8 (the outer branch).
 *
 * ⚠ Written out rather than compared against a replay, which buys a defect class nothing else here
 * can see: the replay routes through `predictorIndex` exactly as the engine does, so a CONSISTENT
 * shift of the index agrees with itself perfectly. A literal naming rows 2, 6 and 8 does not.
 */
const TRAINED_2BIT_NESTED = [1, 1, 0, 1, 1, 1, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1];

/**
 * **The recorded table, and the deep copy that is the whole of it.**
 *
 * This model's own `snapshotState` docblock records that aliasing the CACHE left all 694 package
 * tests green while corrupting every recording; the counter table is single-buffered and mutated in
 * place for the identical reason and fails the identical way. `.slice()` the counters — a spread of
 * the `PredictorState` wrapper builds a fresh object around the SAME array, which reads as a fix and
 * passes an identity check on the object. So the identity assertion below is on `.counters`.
 *
 * ⚠ **Written WITH the recording rather than with step 6's reader**: landing the 5-stage's recording
 * at step 4 reddened ZERO of 7830 tests, because nothing in the repo reads `micro.predictor` yet.
 *
 * **What each claim would miss alone.** *Cycle 0 is COLD* is the net a shallow copy fails. *The last
 * cycle is TRAINED* passes under that defect — it is the non-vacuity control, and separately the
 * only thing here that would see a rotated index. *Cold ≠ trained* stops both from being trivial.
 * ⚠ And the control has to be `'dynamic-2bit'`: under `'dynamic-1bit'` `nested-loop.s` finishes
 * holding exactly the COLD table, since each of its three branches' last outcome is not-taken.
 *
 * ⚠ **And these run at WIDTH 2, not width 1** — deliberately, because a width-1 run would exercise
 * the 5-stage's shape and prove nothing this model does not already share. One table serves both
 * lanes, so the per-cycle sweep at width 2 is also the assertion that widening did not give the
 * machine two tables or let a lane train out of turn.
 */
describe('the recorded table on the superscalar', () => {
  const TRAINS = 'nested-loop.s';
  const W = 2;

  it('records a COLD table at cycle 0 — the assertion a shallow copy fails', () => {
    const tables = tablesOf(run(TRAINS, config('dynamic-2bit', false, W)));
    expect(tables[0]).toEqual(COLD_2BIT);
    expect(tables[0]).toHaveLength(PREDICTOR_ENTRIES);
  });

  it('...and a TRAINED one at the end — the control, which the shallow copy also passes', () => {
    const tables = tablesOf(run(TRAINS, config('dynamic-2bit', false, W)));
    expect(tables.at(-1)).toEqual(TRAINED_2BIT_NESTED);
    expect(TRAINED_2BIT_NESTED).not.toEqual(COLD_2BIT);
  });

  it('...and the 1-bit table ends cold, which is why the control above is not 1-bit', () => {
    const tables = tablesOf(run(TRAINS, config('dynamic-1bit', false, W)));
    const cold = new Array<number>(PREDICTOR_ENTRIES).fill(0);
    expect(tables[0]).toEqual(cold);
    expect(tables.at(-1)).toEqual(cold);
    expect(new Set(tables.map((t) => t!.join(','))).size).toBeGreaterThan(1);
  });

  it('gives every cycle its OWN array — a spread of the wrapper is not a copy', () => {
    const ts = run(TRAINS, config('dynamic-2bit', false, W));
    const counters = ts.map((t) => (t.state.micro as SuperscalarMicro).predictor!.counters);
    expect(new Set(counters).size, 'one array per cycle, shared with nothing').toBe(ts.length);
  });

  /**
   * The strongest claim: the table recorded at cycle `i` is what an offline predictor holds after
   * every branch resolved THROUGH cycle `i`. Swept at **every width**, which is this model's own
   * version of the claim — the pipeline sweeps both forwarding positions, and here widening is the
   * axis that could re-order resolutions and did not.
   */
  it.each(CASES)(
    '$file under $scheme records the table trained through each cycle',
    ({ file, scheme }) => {
      for (const width of WIDTHS) {
        const ts = run(file, config(scheme, false, width));
        expect(tablesOf(ts), `w${width}`).toEqual(expectedTables(ts, scheme));
      }
    },
  );

  it('is not sweeping tables that never move', () => {
    // Non-vacuity for the sweep above, in this file's own "not sweeping empty strings" idiom, and
    // the count is measured rather than reasoned to. The three branchless programs plus
    // `call-return.s` and `paired-branches.s` under `'dynamic-1bit'` hold the cold table on every
    // cycle — their counters never leave the floor — so eight of the 24 cases are trivially true.
    const moving = CASES.filter(({ file, scheme }) => {
      const tables = tablesOf(run(file, config(scheme, false, W)));
      return new Set(tables.map((t) => t!.join(','))).size > 1;
    });
    expect(moving).toHaveLength(16);
  });

  it.each(['none', 'static-not-taken', 'static-taken'] as const)(
    'records `null` under %s — no table, nothing to report',
    (scheme) => {
      for (const width of WIDTHS) {
        const tables = tablesOf(run(TRAINS, config(scheme, false, width)));
        expect(tables.length, `${scheme} w${width}`).toBeGreaterThan(0);
        expect(
          tables.every((t) => t === null),
          `${scheme} w${width}`,
        ).toBe(true);
      }
    },
  );
});
