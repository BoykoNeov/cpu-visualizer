import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble } from '@cpu-viz/assembler';
import { toProgramImage, CACHE_LARGE, CACHE_SMALL } from '@cpu-viz/engine-common';
import {
  defaultConfig,
  type CacheConfig,
  type CycleTrace,
  type ProcessorConfig,
} from '@cpu-viz/trace';
import { OutOfOrderProcessor } from './index';

/**
 * **THE net for M9 step 1a — the closed form, transplanted from M3/M7, cycle-counts only.**
 *
 * `differential.test.ts` proves this model computes the right ANSWERS. It cannot prove it
 * computes them at the right SPEED — in-order commit means final state is deterministic even with
 * the scheduler completely wrong. Timing is the entire point of this step, and there is no golden
 * reference for cycle counts.
 *
 * The net: **an in-order-issue machine at `issueWidth: 1` must be M3's pipeline, and at
 * `issueWidth: 2` must be M7's superscalar** — cycle for cycle, over the whole corpus. Every
 * number below is COPIED from `packages/engine/pipeline/src/timing.test.ts` and
 * `packages/engine/superscalar/src/timing.test.ts` — their own pinned tables, not re-derived —
 * exactly as M7 step 2a transplanted M3's numbers. **If a cell here disagrees, this port is
 * wrong; the number is not.** (Neither sibling package may be imported — INV-2/cross-model
 * isolation — so the tables are DATA, copied by hand, not a shared import.)
 *
 * **Scope, pinned with the user (2026-07-22): cycle-counts only, not an event-for-event port.**
 * This model has no `forwarding` off-position (the CDB broadcast IS the forward path — see
 * `processor.ts`'s file header), so every cell below is matched against M3/M7's `forwarding: true`
 * column only. And this model emits no `stall`/`forward` events (a CDB broadcast is one-to-many,
 * not a latch-shaped `stall.stage` or one-`from`/one-`to` `forward`) — so instead of asserting
 * those fields, each term of the closed form is measured a DIFFERENT way and cross-checked:
 *
 *  - **N** (retires) — counted directly from `instr-retire` events.
 *  - **P** (speculation penalty) — priced from this engine's OWN `branch-resolved` events
 *    (mispredict costs 2, a correct taken bet costs 1, a correct not-taken "prediction" costs 0),
 *    exactly the `penaltyFromEvents` technique M3/M7 use.
 *  - **M** (miss penalty) — counted from this engine's OWN `cache-access` events.
 *  - **S/G/L** (the width-specific stall/group/blocked terms) are NOT independently measured (no
 *    event exists to read them from) — but since N, P, M, and the TOTAL are all independently
 *    pinned, there is no compensating-error freedom left for a stall/dispatch bug to hide in: it
 *    would have to move the total while leaving N, P, and M all correct, which a genuine faithful
 *    port cannot do by accident.
 *
 * width 1's closed form (M3): `cycles = N + 4 + S_on + P + M`.
 * width 2's closed form (M7): `cycles = G_on + L_on + P + M + 4`, where `G_on` gets the
 * `static-taken` betting delta M7's own table applies (a correctly-predicted-taken branch kills
 * its own group's mate, shrinking `G` under that scheme only) and `L_on` does not (M7 asserts
 * blocked is "untouched by prediction and the cache").
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

function run(file: string, config: ProcessorConfig, maxCycles = 500): CycleTrace[] {
  const { program, errors } = assemble(readFileSync(PROGRAMS_DIR + file, 'utf8'));
  if (!program) throw new Error('assembly failed: ' + errors.map((e) => e.message).join('; '));
  const p = new OutOfOrderProcessor();
  p.reset(toProgramImage(program), config);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    if (traces.length >= maxCycles) throw new Error(`${file}: exceeded ${maxCycles} cycles`);
    traces.push(p.step());
  }
  return traces;
}

type Scheme = 'none' | 'static-not-taken' | 'static-taken';
const SCHEMES: readonly Scheme[] = ['none', 'static-not-taken', 'static-taken'];
/** `'none'` and `'static-not-taken'` are one machine — this maps both to the pricing behaviour. */
const behaviourOf = (s: Scheme): 'static-taken' | 'static-not-taken' =>
  s === 'static-taken' ? 'static-taken' : 'static-not-taken';

type CacheSize = 'off' | 'small' | 'large';
const CACHE: Record<CacheSize, CacheConfig | null> = {
  off: null,
  small: CACHE_SMALL,
  large: CACHE_LARGE,
};
const MISS_PENALTY = 10;

interface Transfers {
  readonly takenPredictable: number;
  readonly notTaken: number;
  readonly takenUnpredictable: number;
}

/** M3's `penaltyOf`, copied verbatim — a property of (program, scheme), not of any engine. */
function penaltyOf(t: Transfers, behaviour: 'static-taken' | 'static-not-taken'): number {
  if (behaviour === 'static-taken') {
    return 1 * t.takenPredictable + 2 * t.notTaken + 2 * t.takenUnpredictable;
  }
  return 2 * (t.takenPredictable + t.takenUnpredictable);
}

interface Pinned {
  readonly retires: number;
  readonly sOn: number; // M3's `stalls.on` total (width 1, forwarding on)
  readonly transfers: Transfers;
  readonly misses: { readonly small: number; readonly large: number };
  readonly groupsOn: number; // M7's `w2.groups.on`
  readonly blockedOn: number; // M7's `w2.blocked.on`
  readonly bettingGroupsOn: number; // M7's `w2.betting.on.groups` — applies under static-taken only
}

/**
 * Copied from `packages/engine/pipeline/src/timing.test.ts`'s `TIMING` (retires, stalls.on,
 * transfers, misses) and `packages/engine/superscalar/src/timing.test.ts`'s `TIMING` (w2.groups.on,
 * w2.blocked.on, w2.betting.on.groups) — see those files for the hand-derivation of each number.
 */
const PINNED: Readonly<Record<string, Pinned>> = {
  'add.s': {
    retires: 3,
    sOn: 0,
    transfers: { takenPredictable: 0, notTaken: 0, takenUnpredictable: 0 },
    misses: { small: 0, large: 0 },
    groupsOn: 2,
    blockedOn: 0,
    bettingGroupsOn: 0,
  },
  'array-sum.s': {
    retires: 34,
    sOn: 5,
    transfers: { takenPredictable: 4, notTaken: 1, takenUnpredictable: 0 },
    misses: { small: 2, large: 2 },
    groupsOn: 25,
    blockedOn: 5,
    bettingGroupsOn: 1,
  },
  'array-sum-twice.s': {
    retires: 134,
    sOn: 24,
    transfers: { takenPredictable: 23, notTaken: 3, takenUnpredictable: 0 },
    misses: { small: 5, large: 3 },
    groupsOn: 104,
    blockedOn: 24,
    bettingGroupsOn: 2,
  },
  'branch-flavors.s': {
    retires: 9,
    sOn: 0,
    transfers: { takenPredictable: 1, notTaken: 1, takenUnpredictable: 0 },
    misses: { small: 0, large: 0 },
    groupsOn: 5,
    blockedOn: 0,
    bettingGroupsOn: 0,
  },
  'byte-loads.s': {
    retires: 6,
    sOn: 0,
    transfers: { takenPredictable: 0, notTaken: 0, takenUnpredictable: 0 },
    misses: { small: 1, large: 1 },
    groupsOn: 5,
    blockedOn: 0,
    bettingGroupsOn: 0,
  },
  'call-return.s': {
    retires: 9,
    sOn: 0,
    transfers: { takenPredictable: 1, notTaken: 1, takenUnpredictable: 1 },
    misses: { small: 0, large: 0 },
    groupsOn: 6,
    blockedOn: 0,
    // M7's `betting.on` is `{ groups: 0, pairs: -1 }` — the bet-kills-its-mate rule only ever
    // moves PAIRS here (the doomed `addi a0@28` re-pairs with `jalr@32` instead of vanishing), and
    // pairs never enter the cycle-total formula. `-1` here (copied from `pairs` by mistake) was a
    // transcription bug that cost this program one extra cycle in every static-taken width-2 run.
    bettingGroupsOn: 0,
  },
  'paired-branches.s': {
    retires: 5,
    sOn: 0,
    transfers: { takenPredictable: 0, notTaken: 2, takenUnpredictable: 0 },
    misses: { small: 0, large: 0 },
    groupsOn: 3,
    blockedOn: 0,
    bettingGroupsOn: 1,
  },
  'sum-loop.s': {
    retires: 34,
    sOn: 0,
    transfers: { takenPredictable: 9, notTaken: 1, takenUnpredictable: 0 },
    misses: { small: 0, large: 0 },
    groupsOn: 22,
    blockedOn: 0,
    bettingGroupsOn: 0,
  },
  // M10 step 3 — the slow-op witness. Copied from `pipeline`'s TIMING (retires, transfers, misses)
  // and `superscalar`'s w2 (groupsOn, blockedOn, bettingGroupsOn). sOn = 0: register-only, no loads,
  // nothing forwarding-on stalls. Under this in-order-issue net the `sll` is a single-cycle op
  // (`slowOpLatency` defaults to 1); the toggle payoff lives in `slow-op.test.ts`, not here.
  'slow-op-loop.s': {
    retires: 30,
    sOn: 0,
    transfers: { takenPredictable: 5, notTaken: 1, takenUnpredictable: 0 },
    misses: { small: 0, large: 0 },
    groupsOn: 21,
    blockedOn: 0,
    bettingGroupsOn: 0,
  },
  // M10 step 4 — the miss-stream witness. `array-sum`'s TWIN: every field except `misses` is copied
  // from that entry above (same instruction stream, same hazards, cache-blind). The stride-per-line
  // access misses on all five loads AND the store ⇒ 6 at both sizes. Under THIS in-order-issue net
  // the misses serialize (the parity check); the out-of-order overlap is the lesson's oracle, not here.
  'strided-sum.s': {
    retires: 34,
    sOn: 5,
    transfers: { takenPredictable: 4, notTaken: 1, takenUnpredictable: 0 },
    misses: { small: 6, large: 6 },
    groupsOn: 25,
    blockedOn: 5,
    bettingGroupsOn: 1,
  },
};

const missesAt = (pinned: Pinned, cache: CacheSize): number =>
  cache === 'off' ? 0 : cache === 'small' ? pinned.misses.small : pinned.misses.large;

function width1Total(
  pinned: Pinned,
  behaviour: 'static-taken' | 'static-not-taken',
  cache: CacheSize,
): number {
  return (
    pinned.retires +
    4 +
    pinned.sOn +
    penaltyOf(pinned.transfers, behaviour) +
    missesAt(pinned, cache) * MISS_PENALTY
  );
}

function width2Total(
  pinned: Pinned,
  behaviour: 'static-taken' | 'static-not-taken',
  cache: CacheSize,
): number {
  const G = pinned.groupsOn + (behaviour === 'static-taken' ? pinned.bettingGroupsOn : 0);
  return (
    G +
    4 +
    pinned.blockedOn +
    penaltyOf(pinned.transfers, behaviour) +
    missesAt(pinned, cache) * MISS_PENALTY
  );
}

function eventsOf<T extends CycleTrace['events'][number]['type']>(
  ts: CycleTrace[],
  type: T,
): Extract<CycleTrace['events'][number], { type: T }>[] {
  return ts.flatMap((t) =>
    t.events.filter((e): e is Extract<typeof e, { type: T }> => e.type === type),
  );
}

/** Priced from THIS engine's own outcomes — `penaltyFromEvents`, the M3/M7 technique. */
function measuredPenalty(ts: CycleTrace[]): number {
  return eventsOf(ts, 'branch-resolved').reduce((sum, e) => {
    if (e.predicted !== e.actual) return sum + 2;
    return sum + (e.actual ? 1 : 0);
  }, 0);
}

function measuredMissCycles(ts: CycleTrace[]): number {
  return eventsOf(ts, 'cache-access').filter((e) => !e.hit).length * MISS_PENALTY;
}

const FILES = Object.keys(PINNED);
const MATRIX = FILES.flatMap((file) =>
  SCHEMES.flatMap((scheme) =>
    (['off', 'small', 'large'] as const).map((cache) => ({ file, scheme, cache })),
  ),
);

describe('width 1 ≡ M3’s pipeline closed form (cycles = N + 4 + S + P + M)', () => {
  it.each(MATRIX)('$file [predict $scheme, cache $cache]', ({ file, scheme, cache }) => {
    const pinned = PINNED[file]!;
    const behaviour = behaviourOf(scheme);
    const config: ProcessorConfig = {
      ...defaultConfig(),
      branchPrediction: scheme,
      cache: CACHE[cache],
      issueWidth: 1,
    };
    const ts = run(file, config);

    expect(eventsOf(ts, 'instr-retire'), 'N').toHaveLength(pinned.retires);
    expect(measuredPenalty(ts), 'P').toBe(penaltyOf(pinned.transfers, behaviour));
    expect(measuredMissCycles(ts), 'M').toBe(missesAt(pinned, cache) * MISS_PENALTY);
    expect(ts, 'cycles = N + 4 + S + P + M').toHaveLength(width1Total(pinned, behaviour, cache));
  });
});

describe('width 2 ≡ M7’s superscalar closed form (cycles = G + L + P + M + 4)', () => {
  it.each(MATRIX)('$file [predict $scheme, cache $cache]', ({ file, scheme, cache }) => {
    const pinned = PINNED[file]!;
    const behaviour = behaviourOf(scheme);
    const config: ProcessorConfig = {
      ...defaultConfig(),
      branchPrediction: scheme,
      cache: CACHE[cache],
      issueWidth: 2,
    };
    const ts = run(file, config);

    expect(eventsOf(ts, 'instr-retire'), 'N').toHaveLength(pinned.retires);
    expect(measuredPenalty(ts), 'P').toBe(penaltyOf(pinned.transfers, behaviour));
    expect(measuredMissCycles(ts), 'M').toBe(missesAt(pinned, cache) * MISS_PENALTY);
    expect(ts, 'cycles = G + L + P + M + 4').toHaveLength(width2Total(pinned, behaviour, cache));
  });
});

describe('the degenerate width-1 position is not a stub', () => {
  it('finds a genuinely narrower machine at width 1 than width 2 on a program with independent work', () => {
    // array-sum.s's load-independent-of-the-reduction is the money shot the whole milestone hangs
    // off (m9-tasks.md's headline) — at 1a (in-order issue) it merely proves width does something,
    // not that OoO does; step 1b is where the SAME toggle, with real out-of-order issue, produces
    // the milestone's flagship interaction.
    const w1 = run('array-sum.s', {
      ...defaultConfig(),
      branchPrediction: 'static-taken',
      cache: null,
      issueWidth: 1,
    });
    const w2 = run('array-sum.s', {
      ...defaultConfig(),
      branchPrediction: 'static-taken',
      cache: null,
      issueWidth: 2,
    });
    expect(w2.length).toBeLessThan(w1.length);
  });
});
