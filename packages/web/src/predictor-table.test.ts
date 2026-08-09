/**
 * The predictor-table fold (dynamic-branch-prediction step 6) — the pure half, pinned against REAL
 * recordings from **all four betting models**, not one.
 *
 * That "not one" is the step's stated acceptance and it is not ceremony: `cache-grid.ts`'s own header
 * records a panel that read a per-model latch name, worked on the model it was written against, and
 * sat silently idle on another **shipped, user-reachable** config for a whole milestone. A fold
 * tested on one trace proves nothing about the other three. Every claim below that could be
 * model-shaped is therefore swept across the four.
 *
 * The specific cycles and counter values were derived from full trace dumps before this file was
 * written (the M6 method — derive, don't snapshot).
 *
 * **What this file cannot see, stated up front:** it renders nothing. Layout, the chip reserves, the
 * meter, and whether the panel is legible at a narrow viewport are step 7's, and this repo's record
 * is that 9 of 10 view steps shipped a defect only the browser caught. `PredictorTableView.test.tsx`
 * covers the RENDER seam — that the fold's facts reach the DOM — which is a different and weaker
 * claim than "it looks right".
 */

import { assemble } from '@cpu-viz/assembler';
import {
  PREDICTOR_ENTRIES,
  coldPredictorState,
  counterGeometry,
  predictorIndex,
  toProgramImage,
  type PredictorState,
} from '@cpu-viz/engine-common';
import { DeepPipelineProcessor } from '@cpu-viz/engine-deep-pipeline';
import { OutOfOrderProcessor } from '@cpu-viz/engine-out-of-order';
import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { SuperscalarProcessor } from '@cpu-viz/engine-superscalar';
import {
  defaultConfig,
  type CycleTrace,
  type Processor,
  type ProcessorConfig,
} from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import { buildPredictorTable, hasPredictorTable } from './predictor-table';
import { EXAMPLE_PROGRAMS } from './programs';

/** The four models that honor the knob, by the same list `models.test.ts` pins. */
const MODELS: ReadonlyArray<{ id: string; make: () => Processor }> = [
  { id: 'pipeline', make: () => new PipelineProcessor() },
  { id: 'deep-pipeline', make: () => new DeepPipelineProcessor() },
  { id: 'superscalar', make: () => new SuperscalarProcessor() },
  { id: 'out-of-order', make: () => new OutOfOrderProcessor() },
];

const DYNAMIC = ['dynamic-1bit', 'dynamic-2bit'] as const;

function record(
  program: string,
  make: () => Processor,
  config: Partial<ProcessorConfig> = {},
): readonly CycleTrace[] {
  const source = EXAMPLE_PROGRAMS.find((p) => p.name === program)?.source;
  if (source === undefined) throw new Error(`corpus program ${program} not found`);
  const { program: assembled, errors } = assemble(source);
  if (!assembled) throw new Error(`assembly failed: ${errors.map((e) => e.message).join()}`);
  const p = make();
  p.reset(toProgramImage(assembled), { ...defaultConfig(), cache: null, ...config });
  const traces: CycleTrace[] = [];
  let guard = 0;
  while (!p.isHalted()) {
    if (guard++ >= 3000) throw new Error(`runaway on ${program}`);
    traces.push(p.step());
  }
  return traces;
}

/** `nested-loop.s` is the program authored to make this feature legible — 4 outer passes over a
 *  6-iteration inner loop, plus a never-taken guard. Its three branches sit at pcs 8, 24 and 32,
 *  which index to rows 2, 6 and 8 (`predictorIndex` = `(pc >>> 2) % 16`, and `TEXT_BASE` is 0). */
const GUARD_PC = 8;
const GUARD_ROW = 2;

describe('the gate is a TRACE fact, not the scheme', () => {
  it('is true exactly for a recording that carries a counter table', () => {
    for (const model of MODELS) {
      expect(
        hasPredictorTable(record('nested-loop', model.make, { branchPrediction: 'dynamic-2bit' })),
        model.id,
      ).toBe(true);
      // A static scheme records `predictor: null` on every cycle — no table, so no panel.
      expect(
        hasPredictorTable(record('nested-loop', model.make, { branchPrediction: 'static-taken' })),
        model.id,
      ).toBe(false);
    }
    // The reachable mismatch the gate exists for: the shell's knob persists across a model switch,
    // so a dynamic scheme can be held in hand while the recording is from a machine with no
    // predictor at all. Gating on the scheme would draw a table for the single-cycle model.
    const singleCycle = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'static-not-taken',
    });
    expect(hasPredictorTable(singleCycle)).toBe(false);
    expect(buildPredictorTable(singleCycle[3] ?? null, singleCycle, 'dynamic-2bit')).not.toBeNull();
    // ...which is why the App gates on `hasPredictorTable(recording)` and not on `isDynamicScheme`:
    // the fold happily draws a cold table from the scheme alone (that is its pre-run path), so it is
    // the GATE that has to know the machine.
  });

  it('folds to null under every scheme with no table', () => {
    const recorded = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    for (const scheme of ['none', 'static-not-taken', 'static-taken'] as const) {
      expect(buildPredictorTable(recorded[5] ?? null, recorded, scheme), scheme).toBeNull();
    }
  });

  /**
   * ⚠ **The tripwire for the fold's `?? cold` fallback, which is otherwise a comment.**
   *
   * `buildPredictorTable` reads `predictorOf(trace)?.counters ?? cold`, so a cycle whose
   * `micro.predictor` came back null would draw a COLD table for a frame that has none — on every
   * cycle, with no error and nothing on screen to say the counters are fiction. The test above
   * deliberately exercises that fallback from the SCHEME side (a table folded out of a recording
   * that has none), which is the pre-run path and is correct; what nothing measured is whether it
   * can fire from the TRACE side on a real run.
   *
   * Swept at step 6 (336 runs / 14,108 cycles, every model × width × issue mode × both schemes ×
   * all twelve programs): **it cannot — zero null cycles, zero missing keys, zero counter arrays of
   * the wrong length.** So the fallback is unreachable here, and this is the test that says so
   * rather than a docblock claiming it. A future model that records the table lazily (null until
   * its first bet, say) turns this red instead of silently drawing a cold table for its whole run.
   *
   * ⚠ Its non-vacuity is the static half: under a scheme with no predictor the field IS null on
   * every cycle (7,142 measured), so "non-null" is a property of the SCHEME rather than of a field
   * that happens to always be populated. Without that control this sweep would pass unchanged
   * against an engine that populated the table under every scheme.
   */
  it('never records a NULL table on a cycle of a dynamic run — the fallback is unreachable', () => {
    for (const model of MODELS) {
      for (const scheme of DYNAMIC) {
        for (const program of EXAMPLE_PROGRAMS) {
          const recorded = record(program.name, model.make, { branchPrediction: scheme });
          const where = `${model.id}/${scheme}/${program.name}`;
          expect(recorded.length, `${where}: nothing recorded`).toBeGreaterThan(0);
          for (const trace of recorded) {
            const micro = trace.state.micro as { predictor?: PredictorState | null } | undefined;
            expect(micro?.predictor ?? null, `${where} cycle ${trace.cycle}`).not.toBeNull();
            expect(micro!.predictor!.counters, `${where} cycle ${trace.cycle}`).toHaveLength(
              PREDICTOR_ENTRIES,
            );
          }
        }
      }
    }

    // The control, and it is what makes the sweep above mean anything: the same field under a
    // scheme with no table is null on every cycle of every model.
    for (const model of MODELS) {
      const recorded = record('nested-loop', model.make, { branchPrediction: 'static-taken' });
      for (const trace of recorded) {
        const micro = trace.state.micro as { predictor?: PredictorState | null } | undefined;
        expect(micro?.predictor ?? null, `${model.id} cycle ${trace.cycle}`).toBeNull();
      }
    }
  });
});

describe('the pre-run cursor draws the COLD table, and that is continuous with cycle 0', () => {
  /**
   * ⚠ **This is the net for the shared seed, and its non-vacuity is a CORPUS fact.**
   *
   * The pre-run table and the engine's reset state both come from `coldPredictorState`, so they
   * cannot drift — that half is by construction. What this measures is the claim that makes the
   * pre-run picture honest rather than merely self-consistent: **no corpus program on any of the
   * four models trains a counter during its first cycle**, so stepping off the start moves no
   * counter and the reader never sees the table jump. Swept at step 6 over all twelve programs; if a
   * future program ever resolves a branch in cycle 0, this is where it says so, and the panel's
   * pre-run frame stops being continuous with its first.
   */
  it('pre-run counters equal the recorded cycle-0 counters, on every model and both schemes', () => {
    for (const model of MODELS) {
      for (const scheme of DYNAMIC) {
        for (const program of EXAMPLE_PROGRAMS) {
          const recorded = record(program.name, model.make, { branchPrediction: scheme });
          const preRun = buildPredictorTable(null, recorded, scheme);
          const cycle0 = buildPredictorTable(recorded[0] ?? null, recorded, scheme);
          expect(preRun, `${model.id}/${scheme}/${program.name}`).not.toBeNull();
          expect(
            cycle0!.entries.map((e) => e.counter),
            `${model.id}/${scheme}/${program.name}: cycle 0 must still be cold`,
          ).toEqual(preRun!.entries.map((e) => e.counter));
        }
      }
    }
  });

  it('the cold table is the scheme SEED, and the two schemes differ', () => {
    const recorded = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    // 1-bit seeds at 0 (its only not-taken state); 2-bit at 1 (weakly not-taken). If these were
    // equal the sweep above would still pass while saying much less, so they are pinned apart.
    expect(coldPredictorState('dynamic-1bit').counters[0]).toBe(0);
    expect(coldPredictorState('dynamic-2bit').counters[0]).toBe(1);

    const oneBit = buildPredictorTable(null, recorded, 'dynamic-1bit')!;
    const twoBit = buildPredictorTable(null, recorded, 'dynamic-2bit')!;
    expect(oneBit.entries.every((e) => e.counter === 0 && !e.bets)).toBe(true);
    expect(twoBit.entries.every((e) => e.counter === 1 && !e.bets)).toBe(true);
    // Both cold tables bet NOT TAKEN everywhere — the seed's whole point, and the reason a loop's
    // first pass visibly learns rather than starting right.
  });
});

describe('geometry comes from the scheme, since the counters do not carry their range', () => {
  it('reports the width, ceiling and threshold the engine uses', () => {
    const recorded = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    for (const scheme of DYNAMIC) {
      const table = buildPredictorTable(recorded[0] ?? null, recorded, scheme)!;
      const geometry = counterGeometry(scheme);
      // Read off the ENGINE's own derivation, not a literal: the point of `counterGeometry` is that
      // there is one threshold in the repo, and a view that computed its own could draw a row
      // betting taken while the engine bets not-taken without moving a single cycle count.
      expect({ bits: table.bits, max: table.max, takenFrom: table.takenFrom }).toEqual({
        bits: geometry.bits,
        max: geometry.max,
        takenFrom: geometry.takenFrom,
      });
    }
  });

  it('draws all 16 rows on every cycle, so the panel has no height to jitter', () => {
    const recorded = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    for (const trace of recorded) {
      expect(buildPredictorTable(trace, recorded, 'dynamic-2bit')!.entries).toHaveLength(
        PREDICTOR_ENTRIES,
      );
    }
    expect(buildPredictorTable(null, recorded, 'dynamic-2bit')!.entries).toHaveLength(
      PREDICTOR_ENTRIES,
    );
  });
});

describe('owners — which branch owns which row', () => {
  it('labels exactly the rows the program’s conditional branches index to', () => {
    for (const model of MODELS) {
      const recorded = record('nested-loop', model.make, { branchPrediction: 'dynamic-2bit' });
      const table = buildPredictorTable(recorded[0] ?? null, recorded, 'dynamic-2bit')!;
      const owned = table.entries.filter((e) => e.owners.length > 0).map((e) => e.index);
      // `nested-loop.s`'s three branches: the guard at pc 8, the inner branch and the outer one.
      expect(owned, `${model.id} should find nested-loop's three branch rows`).toEqual([2, 6, 8]);
      const guard = table.entries[GUARD_ROW]!;
      expect(guard.owners).toHaveLength(1);
      expect(guard.owners[0]!.pc).toBe(GUARD_PC);
      expect(guard.owners[0]!.text).toContain('bne');
    }
  });

  /**
   * ⚠ **`jal` and `jalr` must NOT own a row, and `call-return.s` is the corpus's only witness.**
   *
   * They resolve — `branch-resolved` fires for them, with `actual: true` — but they do not train,
   * which is the plan's pinned decision spelled by the shared `isConditionalBranch`. A view that
   * re-spelled the predicate (`mnemonic.startsWith('b')`, say) would label a row `jal` never wrote,
   * and the counter would sit at its seed underneath the label forever.
   *
   * This is the fourth time in this feature that the canonical demonstration turned out not to be
   * the test of the mechanism: `nested-loop.s` — the program authored to make the feature legible —
   * contains no `jal` and no `jalr`, so it cannot state this claim at all.
   */
  it('does not credit `jal`/`jalr` with a row, on any model', () => {
    for (const model of MODELS) {
      const recorded = record('call-return', model.make, { branchPrediction: 'dynamic-2bit' });
      const table = buildPredictorTable(recorded[0] ?? null, recorded, 'dynamic-2bit')!;
      const owned = table.entries.filter((e) => e.owners.length > 0);
      // Exactly one owned row — the `bge`. The `jal` and the `ret` own nothing.
      expect(
        owned.map((e) => e.index),
        model.id,
      ).toEqual([6]);
      expect(owned[0]!.owners[0]!.text).toContain('bge');
      // Non-vacuity: those two instructions really are in this program and really do resolve, so
      // the assertion above is a filter doing work rather than a program with nothing to filter.
      const mnemonics = new Set(
        recorded.flatMap((t) => t.instructions.map((i) => i.decoded.mnemonic)),
      );
      expect(mnemonics.has('jal'), `${model.id}: call-return must contain a jal`).toBe(true);
      expect(mnemonics.has('jalr'), `${model.id}: call-return must contain a jalr`).toBe(true);
    }
  });

  /**
   * ⚠ **The same filter guards TRAINING, and that half had NO net until the break harness said so —
   * which makes this the fifth instance of the finding, arriving inside the file that names it.**
   *
   * `trainsThisCycle` and `ownerIndex` each call `isConditionalBranch`, and the test above covers
   * only the second. Dropping it from the first reddened **zero of 9489 tests**: every training
   * assertion in this file runs on `nested-loop.s`, which contains no `jal` and no `jalr`, so a view
   * that lit a row for an unconditional jump — a row the machine never wrote, whose counter would
   * then sit at its seed under a moving highlight — would have shipped in silence.
   *
   * Two call sites of one predicate need two tests, on the one program that can tell them apart.
   */
  it('does not TRAIN a row for `jal`/`jalr` either — the other half of the same filter', () => {
    for (const model of MODELS) {
      const recorded = record('call-return', model.make, { branchPrediction: 'dynamic-2bit' });
      const trains = recorded.flatMap(
        (t) => buildPredictorTable(t, recorded, 'dynamic-2bit')!.trains,
      );
      // `call-return.s` resolves three transfers — the `jal`, the `bge` and the `ret` — and exactly
      // ONE of them trains. Both counts are asserted: the first is the non-vacuity (there really are
      // two unconditional transfers here to be filtered out), the second is the claim.
      const resolves = recorded.flatMap((t) =>
        t.events.filter((e) => e.type === 'branch-resolved'),
      );
      expect(resolves, `${model.id}: call-return resolves three transfers`).toHaveLength(3);
      expect(trains, `${model.id}: only the conditional branch trains`).toHaveLength(1);
      expect(trains[0]!.text).toContain('bge');
      expect(trains[0]!.index).toBe(6);
    }
  });

  /**
   * ⚠ **The id → pc join goes through the WHOLE recording, and the corpus cannot tell that apart
   * from the narrow join — measured: rewriting it to read only the cursor's own `instructions[]`
   * reddens ZERO of 9489 tests.** That is not because the choice is idle; it is because all four
   * models happen to keep a resolving instruction listed on its resolve cycle (measured at step 6:
   * zero resolvers absent from their own cycle across 672 runs). Depending on it would put a
   * four-model assumption inside a helper whose whole job is to be handed a trace — the shape that
   * left `cache-grid.ts` blank on one model for a milestone.
   *
   * A real recording therefore cannot state this claim, so it is pinned on a SYNTHETIC trace: the
   * only construction that separates the two joins is one where the resolver is genuinely absent
   * from its own cycle's `instructions[]`. Labelled synthetic because this file's whole discipline
   * is otherwise "derive from a real run, never a fixture" — this is the documented exception, not
   * a lapse.
   */
  it('joins a resolver that has already left `instructions[]` — synthetic, the only reachable case', () => {
    const real = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    // A real cycle that trains, and the real instruction that trained it.
    const cycle = real.find(
      (t) => (buildPredictorTable(t, real, 'dynamic-2bit')?.trains.length ?? 0) > 0,
    )!;
    const resolved = cycle.events.find((e) => e.type === 'branch-resolved')!;
    const branch = real.flatMap((t) => t.instructions).find((i) => i.id === resolved.instr)!;

    // The same cycle with the resolver REMOVED from its own instruction list — a model that retires
    // an instruction in the cycle it resolves would record exactly this.
    const stripped: CycleTrace = {
      ...cycle,
      instructions: cycle.instructions.filter((i) => i.id !== branch.id),
    };
    const recording = real.map((t) => (t.cycle === cycle.cycle ? stripped : t));

    const table = buildPredictorTable(stripped, recording, 'dynamic-2bit')!;
    expect(table.trains, 'the wide join still finds the branch').toHaveLength(1);
    expect(table.trains[0]!.pc).toBe(branch.pc);
    expect(table.trains[0]!.index).toBe(predictorIndex(branch.pc));

    // Non-vacuity: the cycle really was stripped, so a narrow join would have found nothing here.
    expect(stripped.instructions.some((i) => i.id === branch.id)).toBe(false);
    expect(cycle.instructions.some((i) => i.id === branch.id)).toBe(true);
  });

  it('leaves every row unowned for a program with no branches', () => {
    // Three corpus programs are branchless (`add`, `byte-loads`, `store-forward`). The table is
    // still drawn in full — it is the machine, not the program — and every row says so.
    const recorded = record('add', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    const table = buildPredictorTable(recorded[0] ?? null, recorded, 'dynamic-2bit')!;
    expect(table.entries).toHaveLength(PREDICTOR_ENTRIES);
    expect(table.entries.every((e) => e.owners.length === 0)).toBe(true);
    expect(table.trains).toEqual([]);
  });

  /**
   * ⚠ **UNREACHED from the shipped corpus, and labelled rather than left to look covered.** Two
   * owners on one row is aliasing — the deliberate consequence of a tagless table — but measured at
   * step 6, every occupied row across all twelve programs has exactly ONE owner at the pinned 16
   * entries. The corpus's only collision (`nested-loop.s`'s guard at pc 8 against its inner branch
   * at pc 24) appears at a 4-entry table, which is not a size the shell can select. So the
   * multi-owner render path exists and is not exercised by any recording; this test states the
   * arithmetic that would produce it, which is the honest half that CAN be pinned.
   */
  it('two branches 64 bytes apart would share a row — the aliasing arithmetic, unreached today', () => {
    expect(predictorIndex(GUARD_PC)).toBe(predictorIndex(GUARD_PC + 4 * PREDICTOR_ENTRIES));
    const recorded = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    const table = buildPredictorTable(recorded[0] ?? null, recorded, 'dynamic-2bit')!;
    expect(
      table.entries.every((e) => e.owners.length <= 1),
      'if this fails the corpus grew an aliasing witness — the multi-owner path is now reachable',
    ).toBe(true);
  });
});

describe('training — the highlight comes from the EVENT, never from a counter diff', () => {
  /**
   * The load-bearing one. A saturating counter trained in the direction it is already parked at does
   * not move, so a diff-keyed panel goes dark for exactly the branches that have been LEARNT — the
   * ones the lesson is about. Measured at step 6: **464 such trains** across the corpus.
   */
  it('marks a row trained even when its counter does not move', () => {
    for (const model of MODELS) {
      const recorded = record('nested-loop', model.make, { branchPrediction: 'dynamic-2bit' });
      const saturated = recorded
        .map((trace) => buildPredictorTable(trace, recorded, 'dynamic-2bit')!)
        .filter((table) =>
          table.trains.some((t) => {
            const row = table.entries[t.index]!;
            return row.previous === row.counter;
          }),
        );
      expect(
        saturated.length,
        `${model.id}: nested-loop must train a saturated counter at least once`,
      ).toBeGreaterThan(0);
      // And on such a cycle the row IS marked trained — which a diff could not have known.
      const example = saturated[0]!;
      const row = example.entries[example.trains[0]!.index]!;
      expect(row.trained, `${model.id}: a saturated train is still a train`).toBe(true);
      expect(row.previous).toBe(row.counter);
    }
  });

  it('trains exactly the resolving branch’s row, with the bet and the outcome', () => {
    for (const model of MODELS) {
      const recorded = record('nested-loop', model.make, { branchPrediction: 'dynamic-2bit' });
      const cycles = recorded
        .map((trace) => buildPredictorTable(trace, recorded, 'dynamic-2bit')!)
        .filter((t) => t.trains.length > 0);

      // `nested-loop.s` resolves 32 conditional branches — the same count its pinned bet string has
      // in `models.test.ts`, which is what ties this fold to the engine's own record of the run.
      expect(cycles.length, `${model.id} train cycles`).toBe(32);
      for (const table of cycles) {
        for (const train of table.trains) {
          expect(train.index).toBe(predictorIndex(train.pc));
          expect(table.entries[train.index]!.trained).toBe(true);
        }
        // Only the trained rows are marked — the rest of the table is untouched this cycle.
        const marked = table.entries.filter((e) => e.trained).map((e) => e.index);
        expect(marked).toEqual(table.trains.map((t) => t.index));
      }

      // The guard (`bne x0, x0` at pc 8) is never taken, so its counter is pinned to the floor for
      // the whole run however often it trains — the corpus's one lane-alternating branch is also the
      // one whose counter never moves (step 5's finding, visible here as a row that never lights up
      // green).
      const guardTrains = cycles.flatMap((t) => t.trains.filter((x) => x.pc === GUARD_PC));
      expect(guardTrains.length, `${model.id}: the guard resolves once per outer pass`).toBe(4);
      expect(guardTrains.every((t) => !t.actual)).toBe(true);
      for (const table of cycles) {
        expect(table.entries[GUARD_ROW]!.counter).toBe(0);
        expect(table.entries[GUARD_ROW]!.bets).toBe(false);
      }
    }
  });

  /**
   * The counter's before/after is read from the PREVIOUS recorded cycle, never by inverting the
   * update. This states the invariant that makes that reading right: on every cycle, a row that was
   * not trained has `previous === counter`, and the previous value really is the prior snapshot.
   */
  it('a row’s `previous` is the prior cycle’s snapshot, and untrained rows do not move', () => {
    for (const model of MODELS) {
      for (const scheme of DYNAMIC) {
        const recorded = record('nested-loop', model.make, { branchPrediction: scheme });
        for (let i = 0; i < recorded.length; i++) {
          const table = buildPredictorTable(recorded[i]!, recorded, scheme)!;
          const prior =
            i === 0
              ? buildPredictorTable(null, recorded, scheme)!
              : buildPredictorTable(recorded[i - 1]!, recorded, scheme)!;
          expect(
            table.entries.map((e) => e.previous),
            `${model.id}/${scheme} cycle ${i}`,
          ).toEqual(prior.entries.map((e) => e.counter));
          for (const entry of table.entries) {
            if (!entry.trained) expect(entry.previous).toBe(entry.counter);
          }
        }
      }
    }
  });

  /**
   * ⚠ **This is what a 2-bit counter's second bit BUYS, read straight off the fold** — and it is the
   * panel's whole pedagogical claim. On `nested-loop.s`'s inner branch (row 6), the inner loop's exit
   * knocks a 1-bit counter clean over to "not taken", while the 2-bit one merely weakens from
   * strongly to weakly taken and still bets taken on the next entry.
   */
  it('hysteresis: the same exit weakens a 2-bit counter and flips a 1-bit one', () => {
    const INNER_ROW = 6;
    const after = (scheme: (typeof DYNAMIC)[number]): { counter: number; bets: boolean } => {
      const recorded = record('nested-loop', () => new PipelineProcessor(), {
        branchPrediction: scheme,
      });
      // The first cycle on which the inner branch resolves NOT TAKEN — the loop exit.
      const exit = recorded
        .map((t) => buildPredictorTable(t, recorded, scheme)!)
        .find((t) => t.trains.some((x) => x.index === INNER_ROW && !x.actual));
      if (exit === undefined) throw new Error(`${scheme}: no inner-loop exit found`);
      const row = exit.entries[INNER_ROW]!;
      return { counter: row.counter, bets: row.bets };
    };

    // 1-bit: 1 → 0. One exit is enough to lose the whole memory, and it mispredicts the next entry.
    expect(after('dynamic-1bit')).toEqual({ counter: 0, bets: false });
    // 2-bit: 3 → 2. Still in the taken half — strongly taken becomes weakly taken, and the next
    // entry is still bet right. This single row IS the feature.
    expect(after('dynamic-2bit')).toEqual({ counter: 2, bets: true });
  });

  it('reports the bet in BOTH directions, unlike the `branch-predicted` event', () => {
    const recorded = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    const trains = recorded.flatMap(
      (t) => buildPredictorTable(t, recorded, 'dynamic-2bit')!.trains,
    );
    // The bet string, read off the fold, must equal the one `models.test.ts` pins across all four
    // engines — which is what says this panel reports the machine's bets rather than its own guess
    // at them. Both values appear, which `branch-predicted` alone could never have told us: it fires
    // only on a TAKEN bet, and that asymmetry is why this panel does not draw the consult.
    expect(trains.map((t) => (t.predicted ? 'T' : 'N')).join('')).toBe(
      'NNTTTTTNNTTTTTTTNTTTTTTTNTTTTTTT',
    );
    expect(new Set(trains.map((t) => t.predicted))).toEqual(new Set([true, false]));
  });
});

describe('strength — and the 1-bit table honestly has none', () => {
  it('is null at 1 bit and strong/weak at 2', () => {
    const recorded = record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    });
    const oneBit = buildPredictorTable(recorded[0] ?? null, recorded, 'dynamic-1bit')!;
    expect(oneBit.entries.every((e) => e.strength === null)).toBe(true);

    // At 2 bits: 0 and 3 are the extremes, 1 and 2 the middle. Read off a real run rather than a
    // constructed table, so the mapping is pinned against values the engine actually produces.
    const seen = new Map<number, 'strong' | 'weak' | null>();
    for (const trace of record('nested-loop', () => new PipelineProcessor(), {
      branchPrediction: 'dynamic-2bit',
    })) {
      for (const e of buildPredictorTable(trace, recorded, 'dynamic-2bit')!.entries) {
        seen.set(e.counter, e.strength);
      }
    }
    expect([...seen.keys()].sort()).toEqual([0, 1, 2, 3]);
    expect(seen.get(0)).toBe('strong');
    expect(seen.get(1)).toBe('weak');
    expect(seen.get(2)).toBe('weak');
    expect(seen.get(3)).toBe('strong');
  });
});
