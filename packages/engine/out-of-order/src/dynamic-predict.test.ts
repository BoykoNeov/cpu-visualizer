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
import { OutOfOrderProcessor } from './index';
import type { OutOfOrderMicro } from './micro';

/**
 * **The net for the dynamic schemes on the OUT-OF-ORDER core** — dynamic-branch-prediction plan,
 * step 5, model 3 of 3, and the only model that poses the plan's last open question. The long form
 * of the three shared claims is in `pipeline/src/dynamic-predict.test.ts`; this header records what
 * is true HERE and nowhere else.
 *
 * ## The fork the plan held open, and the answer is measured
 *
 * In the three latch models a squashed branch is flushed before it can reach the resolve point, so
 * **a branch that resolves always retires** and update-on-resolve vs update-on-commit is not a
 * question those machines can even state. This core can resolve a branch and then kill it with an
 * older mispredict — so the plan pinned the fork for exactly this line, seeded update-on-resolve.
 *
 * ⚠ **It is pinned at RESOLVE, and on this corpus the two policies are INDISTINGUISHABLE.** Measured
 * across every program × every width × in-order and out-of-order issue × both forwarding positions ×
 * all four schemes — 1536 runs — **no branch ever resolves and is then killed.** Not because the
 * machine forbids it (two transfers are in the ROB together on five corpus programs), but because
 * dispatch freezes behind an un-bet transfer, so a younger branch cannot get far enough ahead to
 * resolve before an older one does. The `no wrong-path branch ever trains the table` test below pins
 * that, and it is an ARRIVAL tripwire: a corpus program that made the two policies differ turns it
 * red, and at that moment this decision acquires a net it does not have today.
 *
 * **That is also why the bet STRINGS transfer.** Every literal below is the same string the other
 * three models pin, because no wrong-path history ever enters the table. Had a squashed branch
 * trained it, these would be OoO-specific and nothing about this model could be inherited.
 *
 * ## What this model does NOT inherit, and it cost the first inexact acceptance of the feature
 *
 * ⚠ **The superscalar's "a program that never bets records identically to `static-not-taken`" is a
 * THEOREM there and is FALSE here.** `paired-branches.s` bets `NN` under both dynamic schemes — it
 * never redirects fetch — and still runs **8 cycles against the not-taken machine's 7** at widths 2
 * and 4, in both issue modes.
 *
 * The cause is a real property of this core rather than a defect. Dispatch freezes while a
 * predictable transfer sits un-bet (`hasUnresolvedBet`), and that freeze is a CORRECTNESS
 * requirement for any machine that might bet taken: without it, fall-through instructions dispatch
 * behind a branch that is later bet taken, and if the bet happens to match the outcome no squash
 * ever fires to remove them. The core does not consult the counter until the branch is about to
 * issue, so at dispatch time it genuinely does not know it is going to decline. A
 * `'static-not-taken'` machine has no taken path at all, so for it the fall-through is not a guess
 * and the freeze never applies. **A dynamic scheme therefore pays for HAVING a bet path even on the
 * branches where it declines to use one**, and that is this model's own sentence.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

const SCHEMES = ['static-not-taken', 'static-taken', 'dynamic-1bit', 'dynamic-2bit'] as const;
const DYNAMIC = ['dynamic-1bit', 'dynamic-2bit'] as const;
const WIDTHS = Array.from({ length: MAX_ISSUE_WIDTH }, (_, i) => i + 1);
const ORDERS = [false, true] as const;

/**
 * Cycles at WIDTH 1: not-taken, static-taken, 1-bit, 2-bit. **DERIVED** from the not-taken baseline
 * plus the per-instance price (2 mispredicted, 1 correct-taken, 0 correct-not-taken), with the rule
 * validated first against the MEASURED `static-taken` column — and reproduced with no correction.
 *
 * One row per program and no position axis, because on this core the forwarding toggle and the
 * issue-order toggle both move NOTHING at width 1: results reach consumers over the CDB whatever
 * `forwarding` says, and a one-wide window cannot reorder. Both are asserted below rather than
 * assumed.
 */
const W1: Record<string, readonly [number, number, number, number]> = {
  'add.s': [7, 7, 7, 7],
  'array-sum-twice.s': [208, 191, 194, 193],
  'array-sum.s': [51, 49, 50, 50],
  'branch-flavors.s': [15, 16, 15, 15],
  'byte-loads.s': [10, 10, 10, 10],
  'call-return.s': [17, 18, 16, 16],
  'nested-loop.s': [142, 137, 134, 131],
  'paired-branches.s': [9, 13, 9, 9],
  'slow-op-loop.s': [44, 41, 42, 42],
  'store-forward.s': [11, 11, 11, 11],
  'strided-sum.s': [51, 49, 50, 50],
  'sum-loop.s': [56, 49, 50, 50],
};

/**
 * Cycles at WIDTH 2 — **MEASURED**, per issue mode. No derivation reaches these: a bet ends its
 * dispatch group and the freeze moves with the scheme, so the width-1 price rule is simply false
 * here (the same wall the superscalar's row hit, plus this model's freeze on top of it).
 */
const W2_INORDER: Record<string, readonly [number, number, number, number]> = {
  'add.s': [6, 6, 6, 6],
  'array-sum-twice.s': [178, 163, 166, 165],
  'array-sum.s': [42, 41, 42, 42],
  'branch-flavors.s': [11, 12, 11, 11],
  'byte-loads.s': [9, 9, 9, 9],
  'call-return.s': [14, 15, 13, 13],
  'nested-loop.s': [108, 111, 108, 105],
  'paired-branches.s': [7, 12, 8, 8],
  'slow-op-loop.s': [35, 32, 33, 33],
  'store-forward.s': [9, 9, 9, 9],
  'strided-sum.s': [42, 41, 42, 42],
  'sum-loop.s': [44, 37, 38, 38],
};

const W2_OOO: Record<string, readonly [number, number, number, number]> = {
  'add.s': [6, 6, 6, 6],
  'array-sum-twice.s': [132, 115, 118, 117],
  'array-sum.s': [33, 31, 32, 32],
  'branch-flavors.s': [11, 12, 11, 11],
  'byte-loads.s': [9, 9, 9, 9],
  'call-return.s': [14, 15, 13, 13],
  'nested-loop.s': [108, 111, 108, 105],
  'paired-branches.s': [7, 12, 8, 8],
  'slow-op-loop.s': [35, 32, 33, 33],
  'store-forward.s': [9, 9, 9, 9],
  'strided-sum.s': [33, 31, 32, 32],
  'sum-loop.s': [44, 37, 38, 38],
};

/** The ordered outcomes and bets — the SAME strings the other three models pin. */
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
  'slow-op-loop.s': { actual: 'TTTTTN', oneBit: 'NTTTTT', twoBit: 'NTTTTT' },
  'store-forward.s': { actual: '', oneBit: '', twoBit: '' },
  'strided-sum.s': { actual: 'TTTTN', oneBit: 'NTTTT', twoBit: 'NTTTT' },
  'sum-loop.s': { actual: 'TTTTTTTTTN', oneBit: 'NTTTTTTTTT', twoBit: 'NTTTTTTTTT' },
};

const FILES = Object.keys(W1);
const CASES = FILES.flatMap((file) => DYNAMIC.map((scheme) => ({ file, scheme })));

/** Runs are memoized — the sweeps here re-visit cells, and the engine is pure (INV-1). */
const RUNS = new Map<string, CycleTrace[]>();

const config = (
  branchPrediction: ProcessorConfig['branchPrediction'],
  { width = 1, outOfOrder = false, forwarding = false } = {},
): ProcessorConfig =>
  ({
    ...defaultConfig(),
    branchPrediction,
    forwarding,
    issueWidth: width,
    outOfOrderIssue: outOfOrder,
    // Written EXPLICITLY: an inherited default would silently add misses to every cell below.
    cache: null,
  }) as ProcessorConfig;

function run(file: string, cfg: ProcessorConfig): CycleTrace[] {
  const key = `${file}|${cfg.branchPrediction}|${cfg.forwarding}|${cfg.issueWidth}|${String(
    (cfg as { outOfOrderIssue?: boolean }).outOfOrderIssue,
  )}`;
  const hit = RUNS.get(key);
  if (hit !== undefined) return hit;
  const { program, errors } = assemble(readFileSync(PROGRAMS_DIR + file, 'utf8'));
  if (!program) {
    throw new Error(
      `${file}: ${errors.map((e) => `${e.line}:${e.column} ${e.message}`).join(', ')}`,
    );
  }
  const p = new OutOfOrderProcessor();
  p.reset(toProgramImage(program), cfg);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    if (traces.length >= 600) throw new Error(`${file}: exceeded 600 cycles — runaway loop?`);
    traces.push(p.step());
  }
  RUNS.set(key, traces);
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

/** What an offline predictor WOULD have bet — reached by a different route than the engine's. */
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

describe('the dynamic schemes on the out-of-order core', () => {
  it('covers every program in the corpus', () => {
    const corpus = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.s'));
    expect(corpus.length).toBeGreaterThan(0);
    expect([...corpus].sort()).toEqual([...FILES].sort());
    for (const table of [W2_INORDER, W2_OOO, STRINGS]) {
      expect(Object.keys(table).sort()).toEqual([...FILES].sort());
    }
    expect(WIDTHS).toEqual([1, 2, 3, 4]);
  });

  it('is not sweeping a corpus of empty strings', () => {
    expect(FILES.filter((f) => STRINGS[f]!.actual.length > 0)).toHaveLength(9);
    expect(STRINGS['nested-loop.s']!.actual).toHaveLength(32);
  });

  /**
   * ⚠ **THE measurement this model exists to make: no branch ever resolves and is then KILLED.**
   * That, and only that, is what makes update-on-resolve and update-on-commit the same machine on
   * this corpus — and it is why every bet string below is the one the other three models pin, rather
   * than an OoO-specific string carrying wrong-path history.
   *
   * Swept over every scheme × width × issue mode × forwarding position, because a wrong-path
   * resolution is exactly the kind of thing that appears only in one corner of a matrix.
   *
   * **This is an ARRIVAL tripwire, not a contract.** The machine does not forbid the situation — the
   * companion assertion below shows two transfers really do sit in the ROB together — so a future
   * corpus program can make it reachable. On that day this test goes red, the fork becomes a real
   * behavioral choice, and `processor.ts`'s training call needs the decision it currently records.
   */
  it('no branch resolves and is then killed — so the resolve/commit fork is unreachable here', () => {
    let cells = 0;
    for (const file of FILES) {
      for (const scheme of SCHEMES) {
        for (const width of WIDTHS) {
          for (const outOfOrder of ORDERS) {
            for (const forwarding of [false, true]) {
              const ts = run(file, config(scheme, { width, outOfOrder, forwarding }));
              const resolved = new Set(eventsOf(ts, 'branch-resolved').map((e) => e.instr));
              const retired = new Set(eventsOf(ts, 'instr-retire').map((e) => e.instr));
              const killed = [...resolved].filter((i) => !retired.has(i));
              expect(killed, `${file} ${scheme} w${width} ooo=${outOfOrder}`).toEqual([]);
              cells++;
            }
          }
        }
      }
    }
    // The sweep is real, not an empty product — the count is the whole matrix.
    expect(cells).toBe(FILES.length * SCHEMES.length * WIDTHS.length * 2 * 2);
  });

  it('...and it is unreachable rather than impossible — two transfers DO overlap in the ROB', () => {
    // Non-vacuity for the tripwire above. If no two transfers were ever in flight together, the
    // fork would be closed by construction and the tripwire could never fire — which would make it
    // decoration rather than a tripwire. `call-return.s` puts a `jal`, a `bge` and a `ret` in one
    // short program; the window holds two of them at once.
    const ts = run('call-return.s', config('dynamic-2bit', { width: 2, outOfOrder: true }));
    const TRANSFERS = ['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'jal', 'jalr'];
    const most = Math.max(
      ...ts.map(
        (t) =>
          (t.state.micro as OutOfOrderMicro).rob.filter((e) =>
            TRANSFERS.includes(e.decoded.mnemonic),
          ).length,
      ),
    );
    expect(most, 'transfers in flight together').toBeGreaterThanOrEqual(2);
  });

  /** The invariance every derivation rested on, re-checked on THIS engine across all four axes. */
  it.each(FILES)(
    '%s resolves the same branches under every scheme, width and issue mode',
    (file) => {
      for (const scheme of SCHEMES) {
        for (const width of WIDTHS) {
          for (const outOfOrder of ORDERS) {
            expect(
              actualString(run(file, config(scheme, { width, outOfOrder }))),
              `${scheme} w${width} ooo=${outOfOrder}`,
            ).toBe(STRINGS[file]!.actual);
          }
        }
      }
    },
  );

  /** Claim 1 — the engine's bets are an offline `BranchPredictor`'s bets, event for event. */
  it.each(CASES)('$file under $scheme replays exactly', ({ file, scheme }) => {
    for (const outOfOrder of ORDERS) {
      const ts = run(file, config(scheme, { width: 2, outOfOrder }));
      expect(predictedString(ts), `ooo=${outOfOrder}`).toBe(replay(ts, scheme));
    }
  });

  /**
   * Claim 2 — the literal strings, at every width AND both issue modes. ⚠ **These are the same
   * strings the other three models pin, and that is a consequence of the tripwire above rather than
   * a coincidence**: no wrong-path branch trains the table, so the history a counter sees here is
   * the history it sees on a 5-stage. Out-of-order ISSUE does not reorder branch RESOLUTION, because
   * the freeze keeps at most one transfer un-bet at a time.
   */
  it.each(CASES)(
    '$file under $scheme bets the pinned string, every width and issue mode',
    ({ file, scheme }) => {
      const expected = scheme === 'dynamic-1bit' ? STRINGS[file]!.oneBit : STRINGS[file]!.twoBit;
      for (const width of WIDTHS) {
        for (const outOfOrder of ORDERS) {
          expect(
            predictedString(run(file, config(scheme, { width, outOfOrder }))),
            `w${width} ooo=${outOfOrder}`,
          ).toBe(expected);
        }
      }
    },
  );

  /** Claim 3a — the width-1 columns, DERIVED and reproduced unchanged. */
  it.each(FILES)('%s takes the pinned width-1 cycles under all four schemes', (file) => {
    SCHEMES.forEach((scheme, i) => {
      for (const outOfOrder of ORDERS) {
        for (const forwarding of [false, true]) {
          expect(
            run(file, config(scheme, { width: 1, outOfOrder, forwarding })),
            `${scheme} ooo=${outOfOrder} fwd=${forwarding}`,
          ).toHaveLength(W1[file]![i]!);
        }
      }
    });
  });

  /**
   * The DERIVATION itself, as an assertion rather than as a set of literals: at width 1 a dynamic
   * scheme's cycle count is the not-taken machine's, minus the penalty the not-taken machine paid,
   * plus the penalty this one paid — with both penalties priced per INSTANCE from each run's own
   * outcomes. That is the rule the {@link W1} table was computed from months of build-order before
   * this model could run a dynamic scheme, and stating it here means the table is not just twelve
   * numbers that happen to match but a consequence that still follows.
   *
   * ⚠ **It holds at width 1 and NOT at width ≥ 2, which is the honest boundary of the method.** A
   * bet ends its dispatch group and the freeze moves with the scheme, so cycles and penalty stop
   * being the only two things that differ. The wide columns are measured for that reason, and the
   * assertion below deliberately does not claim them.
   */
  it.each(FILES)('%s: at width 1 the derivation still follows, per instance', (file) => {
    for (const outOfOrder of ORDERS) {
      const notTaken = run(file, config('static-not-taken', { width: 1, outOfOrder }));
      const base = notTaken.length - penaltyFromEvents(notTaken);
      for (const scheme of DYNAMIC) {
        const ts = run(file, config(scheme, { width: 1, outOfOrder }));
        expect(ts, `${scheme} ooo=${outOfOrder}`).toHaveLength(base + penaltyFromEvents(ts));
      }
      // Non-vacuity: `base` must be a real decomposition, not the whole cycle count with a zero
      // penalty bolted on. ⚠ The condition is a TAKEN transfer, not a transfer — a not-taken machine
      // pays **0** for a branch that falls through, so `paired-branches.s` (`actual` is `NN`: two
      // branches, no penalty) is excluded here, and it is the witness of the freeze finding below.
      // Conflating the two made the first draft of this guard fail on exactly that program.
      if (STRINGS[file]!.actual.includes('T')) {
        expect(penaltyFromEvents(notTaken), `${file} pays a penalty to subtract`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  /** Claim 3b — the width-2 columns, MEASURED, per issue mode. */
  it.each(FILES)('%s takes the pinned width-2 cycles under all four schemes', (file) => {
    SCHEMES.forEach((scheme, i) => {
      expect(
        run(file, config(scheme, { width: 2, outOfOrder: false })),
        `${scheme} in-order`,
      ).toHaveLength(W2_INORDER[file]![i]!);
      expect(
        run(file, config(scheme, { width: 2, outOfOrder: true })),
        `${scheme} out-of-order`,
      ).toHaveLength(W2_OOO[file]![i]!);
    });
  });

  /**
   * ⚠ **The superscalar's never-bets THEOREM is FALSE on this core, and here is the witness.**
   * `paired-branches.s` bets `NN` under both dynamic schemes — it never redirects fetch — and still
   * costs one cycle more than the not-taken machine at widths 2 and 4, in both issue modes. See the
   * header: dispatch freezes behind an un-bet transfer because a machine that MIGHT bet taken must,
   * and the core does not consult the counter until the branch is about to issue. **A dynamic scheme
   * pays for having a bet path even where it declines to use one.**
   *
   * Pinned as the exact witness and the exact cost rather than as a general inequality, so that a
   * change which made the freeze cheaper (or spread it wider) has to come through this test.
   */
  it('a declining dynamic scheme still pays the dispatch freeze — the +1 on paired-branches', () => {
    const cycles = (scheme: (typeof SCHEMES)[number], width: number, outOfOrder: boolean): number =>
      run('paired-branches.s', config(scheme, { width, outOfOrder })).length;

    // It genuinely never bets: nothing to redirect, under either scheme.
    expect(STRINGS['paired-branches.s']!.oneBit).toBe('NN');
    expect(STRINGS['paired-branches.s']!.twoBit).toBe('NN');
    expect(
      eventsOf(run('paired-branches.s', config('dynamic-2bit', { width: 2 })), 'branch-predicted'),
      'a declining scheme emits no bet',
    ).toHaveLength(0);

    // At width 1 the freeze costs nothing and the identity holds.
    for (const outOfOrder of ORDERS) {
      expect(cycles('dynamic-2bit', 1, outOfOrder), 'width 1: identical').toBe(
        cycles('static-not-taken', 1, outOfOrder),
      );
    }
    // At widths 2 and 4 it costs exactly one cycle, in both issue modes.
    for (const width of [2, 4]) {
      for (const outOfOrder of ORDERS) {
        expect(
          cycles('dynamic-2bit', width, outOfOrder) - cycles('static-not-taken', width, outOfOrder),
          `w${width} ooo=${outOfOrder}: the freeze`,
        ).toBe(1);
      }
    }
    // ...and the absolute numbers, so "one cycle" cannot drift into being one cycle of something
    // else entirely.
    expect([cycles('static-not-taken', 2, true), cycles('dynamic-2bit', 2, true)]).toEqual([7, 8]);
  });

  /**
   * The remaining programs where a declining scheme is free — the other half of the finding, and
   * what keeps the test above from reading as "dynamic schemes are slower here in general". Four of
   * the five never-bets programs pay nothing, at every width and in both issue modes.
   */
  it('...and every OTHER never-bets program is free', () => {
    const NEVER_BETS = FILES.filter(
      (f) => !STRINGS[f]!.oneBit.includes('T') && !STRINGS[f]!.twoBit.includes('T'),
    );
    expect(NEVER_BETS).toHaveLength(5);
    for (const file of NEVER_BETS.filter((f) => f !== 'paired-branches.s')) {
      for (const width of WIDTHS) {
        for (const outOfOrder of ORDERS) {
          for (const scheme of DYNAMIC) {
            expect(
              run(file, config(scheme, { width, outOfOrder })).length,
              `${file} ${scheme} w${width} ooo=${outOfOrder}`,
            ).toBe(run(file, config('static-not-taken', { width, outOfOrder })).length);
          }
        }
      }
    }
  });
});

/** The counters recorded at each cycle — `micro.predictor`, or `null` for a machine with no table. */
const tablesOf = (ts: CycleTrace[]): (readonly number[] | null)[] =>
  ts.map((t) => (t.state.micro as OutOfOrderMicro).predictor?.counters ?? null);

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
    return predictor.snapshot().counters.slice();
  });
}

/** A cold 2-bit table: sixteen counters, each **weakly not-taken**. */
const COLD_2BIT = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

/**
 * `nested-loop.s`'s table after the last branch retires under `'dynamic-2bit'` — the same literal
 * all four models pin, which is itself the point: the final table is a function of the branch
 * outcomes and the training policy, and on this corpus no wrong-path branch trains. Rows 2 (the
 * guard, driven to the floor), 6 (the inner branch, re-entering still betting taken) and 8.
 *
 * ⚠ Written out rather than replayed, which buys the one defect class the replay cannot see: it
 * routes through `predictorIndex` exactly as the engine does, so a CONSISTENT shift of the index
 * agrees with itself perfectly. A literal naming rows 2, 6 and 8 does not.
 */
const TRAINED_2BIT_NESTED = [1, 1, 0, 1, 1, 1, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1];

/**
 * **The recorded table.** `micro.predictor` is exposed on this model where `cache` deliberately is
 * not (see `OutOfOrderMicro`'s docblock: a counter table has no model-shaped dependency, its rows
 * mean the same thing on every machine that bets). The copy is `.slice()` — the ROB projection above
 * it in `snapshotMicro` follows the same discipline, and for the same reason.
 *
 * ⚠ Written WITH the recording rather than with step 6's reader: landing the 5-stage's recording at
 * step 4 reddened ZERO of 7830 tests, because nothing in the repo reads this field yet.
 *
 * *Cycle 0 is COLD* is the net a shallow copy fails; *the last cycle is TRAINED* passes under that
 * defect and is the non-vacuity control; *cold ≠ trained* stops both from being trivial. The control
 * must be `'dynamic-2bit'` — under `'dynamic-1bit'` `nested-loop.s` ends holding exactly the cold
 * table.
 */
describe('the recorded table on the out-of-order core', () => {
  const TRAINS = 'nested-loop.s';
  const OOO = { width: 2, outOfOrder: true } as const;

  it('records a COLD table at cycle 0 — the assertion a shallow copy fails', () => {
    const tables = tablesOf(run(TRAINS, config('dynamic-2bit', OOO)));
    expect(tables[0]).toEqual(COLD_2BIT);
    expect(tables[0]).toHaveLength(PREDICTOR_ENTRIES);
  });

  it('...and a TRAINED one at the end — the control, which the shallow copy also passes', () => {
    const tables = tablesOf(run(TRAINS, config('dynamic-2bit', OOO)));
    expect(tables.at(-1)).toEqual(TRAINED_2BIT_NESTED);
    expect(TRAINED_2BIT_NESTED).not.toEqual(COLD_2BIT);
  });

  it('...and the 1-bit table ends cold, which is why the control above is not 1-bit', () => {
    const tables = tablesOf(run(TRAINS, config('dynamic-1bit', OOO)));
    const cold = new Array<number>(PREDICTOR_ENTRIES).fill(0);
    expect(tables[0]).toEqual(cold);
    expect(tables.at(-1)).toEqual(cold);
    expect(new Set(tables.map((t) => t!.join(','))).size).toBeGreaterThan(1);
  });

  it('gives every cycle its OWN array — a spread of the wrapper is not a copy', () => {
    const ts = run(TRAINS, config('dynamic-2bit', OOO));
    const counters = ts.map((t) => (t.state.micro as OutOfOrderMicro).predictor!.counters);
    expect(new Set(counters).size, 'one array per cycle, shared with nothing').toBe(ts.length);
  });

  /**
   * The strongest claim, and on this model it carries an extra one: the table recorded at cycle `i`
   * is what an offline predictor holds after every branch resolved THROUGH cycle `i` — **including
   * under out-of-order issue**, where a reordering of resolutions would show up here as a table that
   * is right at the end and wrong in the middle.
   */
  it.each(CASES)(
    '$file under $scheme records the table trained through each cycle',
    ({ file, scheme }) => {
      for (const outOfOrder of ORDERS) {
        const ts = run(file, config(scheme, { width: 2, outOfOrder }));
        expect(tablesOf(ts), `ooo=${outOfOrder}`).toEqual(expectedTables(ts, scheme));
      }
    },
  );

  it('is not sweeping tables that never move', () => {
    // Non-vacuity, in this file's own "not sweeping empty strings" idiom: the three branchless
    // programs plus `call-return.s` and `paired-branches.s` under `'dynamic-1bit'` hold the cold
    // table on every cycle, so eight of the 24 cases are trivially true.
    const moving = CASES.filter(({ file, scheme }) => {
      const tables = tablesOf(run(file, config(scheme, OOO)));
      return new Set(tables.map((t) => t!.join(','))).size > 1;
    });
    expect(moving).toHaveLength(16);
  });

  it.each(['none', 'static-not-taken', 'static-taken'] as const)(
    'records `null` under %s — no table, nothing to report',
    (scheme) => {
      for (const outOfOrder of ORDERS) {
        const tables = tablesOf(run(TRAINS, config(scheme, { width: 2, outOfOrder })));
        expect(tables.length).toBeGreaterThan(0);
        expect(
          tables.every((t) => t === null),
          `${scheme} ooo=${outOfOrder}`,
        ).toBe(true);
      }
    },
  );
});
