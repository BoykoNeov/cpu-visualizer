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
import { PipelineProcessor, type PipelineMicro } from './index';

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
 * `BranchPredictor`, driven by the same branches in the same order, would have said. It reaches each
 * branch's pc by a completely different route than the engine did — `branch-resolved` carries
 * neither a pc nor a mnemonic, so the replay joins through `instr-fetch` and re-decodes the
 * encoding.
 *
 * ⚠ **This was written to be the UNIQUE net for an `update` handed the wrong pc, and the break
 * harness measured that it is not — the claim was wrong and the corrected version is more useful.**
 * The prediction was that training the wrong row would leave cycle counts intact, because rows only
 * interact where two branches alias and this corpus's only aliasing witness aliases at 4 entries
 * rather than the pinned 16. Measured, `update(nextPc)` reddens **31** tests including **six cycle
 * counts**: decoupling the row you train from the row you read does not merely relabel the table,
 * it makes every counter answer for a branch that is not the one being predicted, which changes the
 * bets themselves. Claim 3 sees it perfectly well.
 *
 * The wrong-pc mutation that IS invisible to both is the other one — **a CONSISTENT shift**, where
 * predict and update move together (`predictorIndex` rotated by one entry). Nothing in the engine,
 * the trace, or this file can see it, because a rotation is a bijection on rows and collisions
 * survive it exactly; the plan says the same of a non-zero `TEXT_BASE`. The only thing that catches
 * it is `predictor.test.ts`'s unit tests on `predictorIndex` itself — the arithmetic that shipped
 * with NO test at step 1 and was closed retroactively. So the index function's own tests are not
 * redundant with anything here; they are the sole net for their own defect class.
 *
 * **What this replay actually buys, then, is LOCALIZATION rather than coverage** — when a cycle
 * count moves, it names the branch and the bet that moved it — plus one genuine catch of its own: a
 * step-5 copy-paste that changes a policy in a model and "fixes" the replay to match would keep
 * this green and would still fail claim 2, whose strings are literals. Stated as measured, because
 * a test file that claims to be the only net for a defect it does not uniquely catch is worse than
 * one that says what it is.
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
  branchPrediction: ProcessorConfig['branchPrediction'],
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

/** The counters recorded at each cycle — `micro.predictor`, or `null` for a machine with no table. */
const tablesOf = (ts: CycleTrace[]): (number[] | null)[] =>
  ts.map((t) => (t.state.micro as PipelineMicro).predictor?.counters ?? null);

/**
 * What the table WOULD hold at the end of each cycle, replayed offline from the same branches.
 *
 * The per-cycle sibling of {@link replay}, and it reaches each branch's pc by the same independent
 * route (join `branch-resolved` to `instr-fetch`, re-decode the encoding) for the same reason. What
 * it adds is WHEN: the recorded table at cycle `i` must already carry cycle `i`'s own training,
 * because `micro` is a post-cycle snapshot — the rule `cache-grid.ts` states for every state view
 * ("state panels show the post-cycle-`i` result"). A snapshot taken before EX ran would be one
 * cycle stale at every branch and identical everywhere else.
 *
 * ⚠ **The `.slice()` is not incidental** — `snapshot()` hands back the LIVE table by design (step 2),
 * so without it this helper would return one aliased array per cycle and reproduce, inside the test,
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
 * `nested-loop.s`'s table after the last branch retires, under `'dynamic-2bit'`. Three rows moved
 * and thirteen did not, and each of the three is a branch in the source:
 *
 *   - **index 2** — the guard at pc 8 (`bne x0, x0, done`), never taken four times over, so its
 *     counter is driven to the floor and parks at 0.
 *   - **index 6** — the inner branch at pc 24, `TTTTTN` per pass. It ends each pass at 2 rather
 *     than 0, which IS the feature: a 2-bit counter walks back one step on the exit and re-enters
 *     still betting taken, where the 1-bit table (below) is knocked all the way out of its habit.
 *   - **index 8** — the outer branch at pc 32, `TTTN`, ending weakly taken for the same reason.
 *
 * ⚠ **Written out rather than compared against a replay, and that buys a defect class nothing else
 * in this file can see — FIRED, not asserted.** The replay routes through `predictorIndex` exactly
 * as the engine does, so a CONSISTENT shift of the index (the rotation the plan's `TEXT_BASE` note
 * describes) agrees with itself perfectly: step 3 measured it as invisible to the engine, the trace
 * and the replay alike, with `predictor.test.ts`'s unit tests on the index function as its **sole**
 * net. A literal naming rows 2, 6 and 8 does not agree: rotate the index and the three moved
 * counters land on 3, 7 and 9. Re-run against this suite, `((pc >>> 2) + 1) % PREDICTOR_ENTRIES`
 * reddens **3** tests — the two index unit tests, and this one. So the sole net has a second.
 *
 * ⚠ **And the test that catches it is the one labelled a CONTROL below.** "The last cycle is
 * trained" passes under the shallow copy and is therefore not coverage *for that defect* — but it is
 * the only thing in the repo besides `predictor.test.ts` that sees a rotated index. A test can be
 * vacuous for the class it was written for and load-bearing for another, which is why the label says
 * what it does not cover rather than "this test is a control".
 */
const TRAINED_2BIT_NESTED = [1, 1, 0, 1, 1, 1, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1];

/**
 * **Step 4 — the table is RECORDED, and the deep copy is the whole of the step** (plan step 4).
 *
 * Between steps 3 and 4 this model bet from a live counter table and reported `micro.predictor` as
 * `null` on every cycle: a temporary understatement of the machine, and an INV-2 one — the engine is
 * supposed to emit full, expert-complete state and let the VIEW decide what to show. This block is
 * what closes it, and it is the only thing that does. ⚠ **Landing the recording reddened ZERO tests
 * across all 7830** — every suite in the repo was structurally blind to a `null` becoming a table,
 * because nothing reads the field until step 6's panel. Same root as step 1's untested
 * `predictorIndex` and step 3's untested datapath seam: code with no consumer yet is code no test is
 * shaped to cover.
 *
 * ## Why a deep copy, and why the two cheaper spellings are both wrong
 *
 * `BranchPredictor` is single-buffered and mutated in place, exactly like `CacheState` — so the
 * recorder owns the copy (step 2 kept `snapshot()` returning the live table for precisely this
 * reason, rather than hiding the decision in a getter one package down). Handed straight through,
 * one array would alias every recorded cycle and a scrub back to cycle 0 would show a machine that
 * has already learned everything. Spreading the wrapper (`{ ...snapshot() }`) looks like a fix,
 * passes an identity check on the OBJECT, and aliases the same array.
 *
 * That is why the identity assertion below is on `.counters` and never on the wrapper: the wrapper
 * check is green under the mutation a reviewer is most likely to wave through.
 *
 * ## What each claim here would miss alone
 *
 * **Cycle 0 is COLD** is the net — it is the assertion the shallow copy fails. **The last cycle is
 * TRAINED** is not coverage at all: a shallow copy shows the trained table everywhere, so that one
 * passes under the defect. It is the non-vacuity control, and it is stated as one. **Cold ≠ trained**
 * is what makes both mean something: on a program with no conditional branch (`add.s`, three of
 * them in the corpus) every claim here holds trivially in both directions.
 *
 * ⚠ **And the control has to be `'dynamic-2bit'`, which is not arbitrary.** Under `'dynamic-1bit'`
 * `nested-loop.s`'s final table is *identical to the cold one* — every counter it touched ends back
 * at 0, because each of its three branches' last outcome is not-taken and a 1-bit counter keeps no
 * memory of anything earlier. The obvious choice of scheme would have made the non-vacuity control
 * assert nothing, which is this repo's recurring "the canonical demonstration is not the test of the
 * mechanism" (step 2's flagship `TTTTNTTTT`) in a new place.
 */
describe('the recorded table (step 4 — the deep copy)', () => {
  const TRAINS = 'nested-loop.s'; // three branch sites, 32 resolutions, and rows that move

  it('records a COLD table at cycle 0 — the assertion a shallow copy fails', () => {
    const tables = tablesOf(run(TRAINS, config('dynamic-2bit', false)));
    expect(tables[0]).toEqual(COLD_2BIT);
    expect(tables[0]).toHaveLength(PREDICTOR_ENTRIES);
  });

  it('...and a TRAINED one at the end — the control, which the shallow copy also passes', () => {
    const tables = tablesOf(run(TRAINS, config('dynamic-2bit', false)));
    expect(tables.at(-1)).toEqual(TRAINED_2BIT_NESTED);
    // Non-vacuity for the two assertions on either side of this one. Both are claims about a table
    // CHANGING, and both hold trivially on a program whose table never moves.
    expect(TRAINED_2BIT_NESTED).not.toEqual(COLD_2BIT);
  });

  it('...and the 1-bit table ends cold, which is why the control above is not 1-bit', () => {
    // Not a curiosity: it is the reason the scheme above is pinned. Each of the three branches'
    // LAST outcome is not-taken, and a 1-bit counter remembers only that — so `nested-loop.s`, the
    // program authored to make this feature legible, finishes under `'dynamic-1bit'` holding
    // exactly the table it started with. Asserted so that a future edit to the program (or to the
    // seed) which quietly makes 1-bit a valid control has to come through here and say so.
    const tables = tablesOf(run(TRAINS, config('dynamic-1bit', false)));
    const cold = new Array<number>(PREDICTOR_ENTRIES).fill(0);
    expect(tables[0]).toEqual(cold);
    expect(tables.at(-1)).toEqual(cold);
    // ...while the run in between is emphatically not constant, which is what keeps this from
    // reading as "the 1-bit predictor never learned anything".
    expect(new Set(tables.map((t) => t!.join(','))).size).toBeGreaterThan(1);
  });

  it('gives every cycle its OWN array — a spread of the wrapper is not a copy', () => {
    const ts = run(TRAINS, config('dynamic-2bit', false));
    const counters = ts.map((t) => (t.state.micro as PipelineMicro).predictor!.counters);
    // On `.counters`, never on the `PredictorState` wrapper. `{ ...snapshot() }` builds a fresh
    // wrapper around the SAME array — it would pass an identity check on the object and alias every
    // recorded cycle anyway, which is the defect most likely to survive review.
    expect(new Set(counters).size, 'one array per cycle, shared with nothing').toBe(ts.length);
  });

  /**
   * The strongest claim here, and the only one that pins WHEN the snapshot is taken: the table
   * recorded at cycle `i` is the table an offline predictor holds after replaying every branch
   * resolved **through** cycle `i`. Post-cycle, per `micro`'s contract.
   *
   * Both forwarding positions and every program, because forwarding moves stalls and so moves which
   * cycle each branch resolves in — a snapshot taken one stage too early would land differently in
   * the two positions rather than uniformly.
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
    // Non-vacuity for the per-cycle sweep above, in the same idiom as this file's "not sweeping a
    // corpus of empty strings" guard — and the count was MEASURED by the break harness rather than
    // reasoned to. Eight of that sweep's 24 cases hold the cold table on every single cycle, so it
    // is trivially true on them: the three programs with no control transfer at all (six cases),
    // plus `call-return.s` and `paired-branches.s` under `'dynamic-1bit'`, whose only conditional
    // branches are never taken and so leave a 1-bit counter parked at its floor. Break rows 1, 2
    // and 5 each reddened exactly the other sixteen.
    //
    // ⚠ Without this, a refactor that made the recorded table constant would leave that sweep green
    // across the board while agreeing with a replay that had gone constant the same way.
    const moving = CASES.filter(({ file, scheme }) => {
      const tables = tablesOf(run(file, config(scheme, false)));
      return new Set(tables.map((t) => t!.join(','))).size > 1;
    });
    expect(moving).toHaveLength(16);
  });

  /**
   * The inertness half: a machine with no counter table records `null`, not an empty or a cold one.
   * `'none'` is included even though it is the same MACHINE as `'static-not-taken'` — this is a
   * claim about what the config produces, and `'none'` is what `defaultConfig()` selects, so it is
   * the value every other suite in the repo reads.
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
