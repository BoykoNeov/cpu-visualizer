import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble } from '@cpu-viz/assembler';
import { decode } from '@cpu-viz/isa';
import {
  BranchPredictor,
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
import { PipelineProcessor } from './index';

/**
 * **The net for the dynamic schemes — step 3's acceptance, and the reason it is three claims rather
 * than a cycle count** (dynamic-branch-prediction plan, step 3).
 *
 * `differential.test.ts` now runs all five schemes and cannot see any of this: it compares final
 * architectural state, and speculation is architecturally invisible by construction, so a pipeline
 * that IGNORED `'dynamic-1bit'` entirely is green in all fifty cells. `m7-superscalar-engine` records
 * INV-8 as a FALSE NET outright and `cycles-cannot-see-a-lost-forward` records a cycles-only
 * identity holding in every cell while two `forward` events silently vanished. So this file asserts
 * what those cannot.
 *
 * ## The three claims, in order of what each one alone would miss
 *
 * **1. The prediction STRING, replayed event-for-event.** For every program and both dynamic
 * schemes, the ordered sequence of `branch-resolved.predicted` must equal what an offline
 * `BranchPredictor`, driven by the same branches in the same order, would have said. This is the
 * claim the other two cannot make, and the concrete defect it exists for is **`update` handed the
 * wrong pc**: train the table at the target address, or at the next instruction's address, and on
 * this corpus almost every cycle count stays exactly right — the counters still learn, just in
 * different rows, and rows only interact where two branches alias. `nested-loop.s` is the corpus's
 * only aliasing witness and it aliases at 4 entries, not the pinned 16. A wrong-pc predictor is
 * therefore INVISIBLE to claim 3 and visible here.
 *
 * **2. The literal strings, pinned.** The replay above proves the engine agrees with the class; it
 * does not pin the POLICY the two of them share. Written out, `call-return.s`'s `TNN` says three
 * things a passing replay would not: that `jal` bypassed the table (position 1 is a bet, not a cold
 * counter's `N`), that `jalr` is unpredictable under every scheme (position 3 is `N` while the
 * branch is taken), and that the counters seed weakly-NOT-taken (position 2 is `N` on first sight).
 * ⚠ **Assert the string, never the mispredict COUNT** — the plan measured that a wrong seed and a
 * wrong threshold can both leave the count unchanged, and that the flagship `TTTTNTTTT` sequence
 * everyone reaches for does not pin the taken threshold at all.
 *
 * **3. The cycle table, reproduced.** The plan's step-0 columns for the dynamic schemes were
 * DERIVED, months before an engine could run one: a program's per-branch outcome sequence is
 * scheme-invariant, and `timing.test.ts:205` prices a resolved transfer per INSTANCE (2 if
 * mispredicted, 1 if correctly predicted taken, 0 if correctly predicted not-taken), so four schemes
 * were priced from one run each. Every number below is that derivation, and this is where it stops
 * being a derivation. ⚠ It also discharges the one thing step 0 left as an ARGUMENT rather than a
 * pin: that `S` — where the stalls land and how long they last — is invariant across schemes, so a
 * dynamic scheme's non-uniform squash shadow could not move it. The derived columns rest on that
 * entirely, and a closed form cannot check its own assumption. These are measured cycle counts.
 *
 * ## What is deliberately NOT here
 *
 * **Acceptance (c) — "the three existing schemes' per-program cycle counts unchanged corpus-wide".**
 * That is `timing.test.ts`, which pins `cycles = N + 4 + S + P` per program per forwarding position
 * for `'static-not-taken'` and `'static-taken'` and was not touched by this step. Its staying green
 * IS the claim; restating those columns here would be a second copy that can only drift. The two
 * static columns appear in the table below only because the table is the plan's step-0 artifact and
 * is meant to be readable as one, and because two independent routes to one number is this suite's
 * own idiom — if they ever disagree, one of the two files fails and names which.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

/** Cycles per scheme, forwarding off then on — the plan's step-0 and step-0b tables, verbatim. */
interface Row {
  readonly off: readonly [nt: number, st: number, oneBit: number, twoBit: number];
  readonly on: readonly [nt: number, st: number, oneBit: number, twoBit: number];
  /**
   * The ordered outcome string — `T` per taken transfer, `N` per declined one, in resolution order.
   * **A property of the PROGRAM, not of any scheme**, which is the invariance the whole derivation
   * rested on and is asserted below rather than assumed.
   */
  readonly actual: string;
  /** What each dynamic scheme BET, in the same order. `''` for a program with no transfers. */
  readonly oneBit: string;
  readonly twoBit: string;
}

/**
 * ⚠ **`nested-loop.s` is the only row where all four columns differ, and it was authored for that.**
 * Everywhere else at least two schemes tie: the original eleven programs enter every loop exactly
 * once, so a warm `static-taken` is already right on every iteration and a counter only ever pays
 * its cold start. Over those eleven, `dynamic-2bit` beats `static-taken` by ONE cycle (636 v 637)
 * and `dynamic-1bit` ties it — the finding the plan calls load-bearing, and the reason the feature's
 * per-program case is what to teach from rather than its aggregate one.
 */
const TABLE: Record<string, Row> = {
  // No control transfers at all: every scheme is the same machine on it, which is what makes it the
  // inertness witness of this table rather than dead weight.
  'add.s': { off: [9, 9, 9, 9], on: [7, 7, 7, 7], actual: '', oneBit: '', twoBit: '' },

  // The corpus's only RE-ENTERED loop before step 0b, and so the only program that distinguished
  // 1-bit from 2-bit at all — by exactly one cycle in 276. The strings show why: the inner `bne`
  // runs `TTTTTTTTTTTN` twice, and on the second pass's re-entry the 1-bit table has been talked out
  // of its habit by the single exit (`...TNNTTT...`) while the 2-bit was only weakened (`...TNTTT...`).
  // That is the ENTIRE 1-bit/2-bit delta on the original corpus, in one character.
  'array-sum-twice.s': {
    off: [290, 273, 276, 275],
    on: [208, 191, 194, 193],
    actual: 'TTTTTTTTTTTNTTTTTTTTTTTTNN',
    oneBit: 'NTTTTTTTTTTTNNTTTTTTTTTTTT',
    twoBit: 'NTTTTTTTTTTTNTTTTTTTTTTTTT',
  },

  // A loop entered once: both counters cost exactly one cold mispredict and then agree forever, so
  // the two dynamic columns tie. Four of these in the corpus (with `strided-sum`, `sum-loop`,
  // `slow-op-loop`) and they are why seeding the 2-bit at strongly-not-taken was rejected — at `00`
  // it would take TWO cycles to warm and lose to the 1-bit on every one of them.
  'array-sum.s': {
    off: [72, 70, 71, 71],
    on: [51, 49, 50, 50],
    actual: 'TTTTN',
    oneBit: 'NTTTT',
    twoBit: 'NTTTT',
  },

  // Both dynamic schemes bet `NN` and the outcomes are `TN`: a cold table is RIGHT about the branch
  // that falls through, which is `static-not-taken`'s territory rather than a counter's thesis. It
  // is one of the three programs where a dynamic scheme beats `static-taken` for that reason alone.
  'branch-flavors.s': {
    off: [16, 17, 16, 16],
    on: [15, 16, 15, 15],
    actual: 'TN',
    oneBit: 'NN',
    twoBit: 'NN',
  },

  'byte-loads.s': {
    off: [14, 14, 14, 14],
    on: [10, 10, 10, 10],
    actual: '',
    oneBit: '',
    twoBit: '',
  },

  // ⚠ **The `jal` policy's witness, and the reason this row is worth reading character by character.**
  // `TNN` against an actual `TNT`: position 1 is the `jal`, bet TAKEN on first sight — a cold counter
  // would have said `N` there and cost a cycle (16 becomes 17), which is exactly the fork the plan
  // priced and closed. Position 3 is the `ret`, a `jalr`, predicted not-taken under EVERY scheme
  // because its target lives in a register — the one mispredict a dynamic scheme cannot train away.
  'call-return.s': {
    off: [17, 18, 16, 16],
    on: [17, 18, 16, 16],
    actual: 'TNT',
    oneBit: 'TNN',
    twoBit: 'TNN',
  },

  // Step 0b's program, authored to make the feature legible: 4 outer passes over a 6-iteration inner
  // loop, plus a never-taken `bne x0,x0` guard at the head of each pass. The only row that is
  // strictly ordered with 2-bit fastest and no ties. Read the strings against `actual` and the whole
  // mechanism is visible: the 1-bit table pays TWO mispredicts per re-entry (`NN` at each pass
  // boundary) where the 2-bit pays one (`N`), four passes over, which is the 3-cycle delta.
  'nested-loop.s': {
    off: [182, 177, 174, 171],
    on: [142, 137, 134, 131],
    actual: 'NTTTTTNTNTTTTTNTNTTTTTNTNTTTTTNN',
    oneBit: 'NNTTTTTNNNTTTTTTNNTTTTTTNNTTTTTT',
    twoBit: 'NNTTTTTNNTTTTTTTNTTTTTTTNTTTTTTT',
  },

  // Both branches fall through, so a cold table is right about both and the dynamic schemes pay
  // NOTHING — the corpus's largest dynamic win over `static-taken` (+4) and, again, not a win a
  // counter's memory earned.
  'paired-branches.s': {
    off: [9, 13, 9, 9],
    on: [9, 13, 9, 9],
    actual: 'NN',
    oneBit: 'NN',
    twoBit: 'NN',
  },

  'slow-op-loop.s': {
    off: [70, 67, 68, 68],
    on: [44, 41, 42, 42],
    actual: 'TTTTTN',
    oneBit: 'NTTTTT',
    twoBit: 'NTTTTT',
  },

  'store-forward.s': {
    off: [15, 15, 15, 15],
    on: [11, 11, 11, 11],
    actual: '',
    oneBit: '',
    twoBit: '',
  },

  'strided-sum.s': {
    off: [72, 70, 71, 71],
    on: [51, 49, 50, 50],
    actual: 'TTTTN',
    oneBit: 'NTTTT',
    twoBit: 'NTTTT',
  },

  // The hottest loop in the corpus and the one M4 pinned at `-7`. Ten transfers, entered once: the
  // dynamic schemes pay their cold start and then match a taken-bet exactly, so 72 against 71 —
  // one cycle worse than `static-taken` and six better than not-taken.
  'sum-loop.s': {
    off: [78, 71, 72, 72],
    on: [56, 49, 50, 50],
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
  const p = new PipelineProcessor();
  p.reset(toProgramImage(program), config);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    if (traces.length >= 500) throw new Error(`${file}: exceeded 500 cycles — runaway loop?`);
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
  branchPrediction: (typeof SCHEMES)[number],
  forwarding: boolean,
): ProcessorConfig => ({
  ...defaultConfig(),
  forwarding,
  branchPrediction,
});

/** The ordered bets, one character per resolved transfer. */
const predictedString = (ts: CycleTrace[]): string =>
  eventsOf(ts, 'branch-resolved')
    .map((e) => (e.predicted ? 'T' : 'N'))
    .join('');

/** The ordered outcomes, same order — the program's own property. */
const actualString = (ts: CycleTrace[]): string =>
  eventsOf(ts, 'branch-resolved')
    .map((e) => (e.actual ? 'T' : 'N'))
    .join('');

/**
 * What an offline predictor WOULD have bet, given the same branches in the same order.
 *
 * **The `pc` comes from `instr-fetch` and the mnemonic from its `encoding`** — `branch-resolved`
 * carries neither, and that is the point: this replay reaches the branch's own address by a
 * completely different route than the engine did, so a `predict`/`update` handed the wrong pc
 * disagrees here even where it costs no cycles.
 *
 * The three-way policy split is spelled out rather than delegated so this stays an INDEPENDENT
 * model: a conditional branch consults the table, `jal` bypasses it and is bet taken, and `jalr` is
 * unpredictable. If the engine's policy is ever changed, this disagrees — which is the point of a
 * replay pinning a policy rather than importing it.
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
      out += isPredictable(d) ? 'T' : 'N'; // `jal` bypasses the table; `jalr` cannot be predicted
    }
  }
  return out;
}

const FILES = Object.keys(TABLE);
const DYNAMIC = ['dynamic-1bit', 'dynamic-2bit'] as const;
const CASES = FILES.flatMap((file) => DYNAMIC.map((scheme) => ({ file, scheme })));

describe('the dynamic schemes, pinned three ways', () => {
  it('covers every program in the corpus', () => {
    // The same guard `timing.test.ts` carries, and for the same reason: the corpus is enumerated
    // from disk by the conformance harness, so a program added later joins INV-8 automatically and
    // would join this file not at all. A table that silently stopped covering the corpus is exactly
    // the decay this suite exists to prevent — fail loudly and make the author derive the row.
    const corpus = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.s'));
    expect(corpus.length).toBeGreaterThan(0); // ...and guard the guard against an empty read
    expect([...corpus].sort()).toEqual([...FILES].sort());
  });

  it('is not sweeping a corpus of empty strings', () => {
    // Non-vacuity for every string assertion below in one line. Three corpus programs have no
    // control transfer at all, so their rows are `''` and every claim about them holds trivially;
    // if a refactor ever made `predictedString` return `''` everywhere — a mistyped event name is
    // enough — the two string tests would go green across the board and say nothing. Nine of the
    // twelve must have a bet to talk about.
    const withTransfers = FILES.filter((f) => TABLE[f]!.actual.length > 0);
    expect(withTransfers).toHaveLength(9);
    expect(TABLE['nested-loop.s']!.actual).toHaveLength(32);
  });

  /**
   * The invariance the entire derivation rested on, now that there is something to check it
   * against: **a program's outcome sequence is the same under every scheme.** Prediction changes
   * WHEN things happen, never WHAT happens — so one run per program yielded the raw material for
   * pricing four schemes, months before two of them existed.
   *
   * The sequence, not the count. `cycles-cannot-see-a-lost-forward` is this repo's record of a count
   * agreeing while the sequence underneath it did not.
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

  /**
   * Claim 1 — the engine's bets are an offline `BranchPredictor`'s bets, event for event.
   *
   * Both forwarding positions, because forwarding moves stalls and therefore moves WHEN each branch
   * reaches EX. If training were ever done anywhere but at resolution — at the bet, say — the two
   * positions would interleave the branches differently and one of them would disagree.
   */
  it.each(CASES)('$file under $scheme replays exactly', ({ file, scheme }) => {
    for (const forwarding of [false, true]) {
      const ts = run(file, config(scheme, forwarding));
      expect(predictedString(ts), `fwd=${forwarding}`).toBe(replay(ts, scheme));
    }
  });

  /**
   * Claim 2 — and the strings are written out rather than replayed, so this pins the POLICY the
   * engine and the replay share: the seed (weakly not-taken), the taken threshold, the `jal` bypass,
   * and `jalr`'s permanent unpredictability. A replay that agreed with an engine which had adopted
   * the opposite seed would be perfectly green.
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
   * Claim 3 — the step-0 table's derived columns, measured. This is also where step 0's S-invariance
   * stops being an argument: these numbers were computed as `N + 4 + S + P` with `S` ASSUMED
   * scheme-invariant, and a closed form cannot check its own assumption. Every cell below came out
   * of a real run.
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
   * The corpus totals, and the finding they carry — which is the honest headline of this feature and
   * is not what a reader expects.
   *
   * **Over the eleven programs that predate step 0b, `dynamic-2bit` beats `static-taken` by ONE
   * cycle and `dynamic-1bit` ties it exactly.** Every loop there is entered once, so a warm
   * taken-bet is already right on every iteration and a counter only ever pays its cold start; the
   * dynamic schemes win only where a branch habitually falls through, which is `static-not-taken`'s
   * territory. `nested-loop.s` is the whole of the current margin — it alone contributes +6.
   *
   * Pinned because it is the number a future scheme, table size or seed would move first, and
   * because a plan that quietly stopped being able to say this would be a plan whose flagship demo
   * had drifted.
   */
  it('the corpus totals, including the finding that the aggregate case is thin', () => {
    const totals = (files: readonly string[], position: 'off' | 'on'): number[] =>
      SCHEMES.map((_, i) => files.reduce((sum, f) => sum + TABLE[f]![position][i]!, 0));

    const original = FILES.filter((f) => f !== 'nested-loop.s');
    expect(original).toHaveLength(11);
    expect(totals(original, 'off'), 'the ELEVEN, forwarding off').toEqual([662, 637, 637, 636]);
    expect(totals(original, 'on'), 'the ELEVEN, forwarding on').toEqual([479, 454, 454, 453]);

    // ...and with step 0b's program, which is where the margin actually comes from: +6 on one
    // program takes the whole corpus from 1 cycle to 7.
    expect(totals(FILES, 'off'), 'the TWELVE, forwarding off').toEqual([844, 814, 811, 807]);
    const [, staticTaken, , twoBit] = totals(FILES, 'off');
    expect(staticTaken! - twoBit!, 'the 2-bit margin over static-taken, corpus-wide').toBe(7);
  });
});
