import { describe, expect, it } from 'vitest';
import {
  BranchPredictor,
  PREDICTOR_ENTRIES,
  predictorIndex,
  type DynamicScheme,
} from './predictor';

/**
 * `predictorIndex` is arithmetic that **three hand-derived timing tables already depend on**, and at
 * step 1 it had no test at all — the only pure function in `engine-common` without one.
 *
 * That gap is worse than it looks, because nothing can currently observe the function being wrong:
 * `micro.predictor` is `null` on every recorded cycle and there is no reader until step 6. So a
 * defect here would surface at **step 3** as "the plan's step-0 derived table disagrees with the
 * engine" — sending a future session off to re-derive a table that was right all along.
 *
 * `predict.ts` documents exactly this failure mode against itself: its `>>> 0` is invisible to the
 * whole corpus (every address is small enough that the signed and unsigned readings agree), so it is
 * pinned by a DIRECT case rather than by a sweep — *measured by mutation, not assumed*. Same
 * treatment here, and each assertion below was verified against a deliberately broken
 * `predictorIndex` before being trusted.
 *
 * **The pcs are absolute, and that happens to be free.** `TEXT_BASE` is `0x0000_0000`
 * (`assembler/src/program.ts`), so an absolute pc equals its offset from the start of text and the
 * plan's row numbers ("guard at pc 8 → index 2") are true of the shipped table verbatim. Worth
 * stating because it need not have been: a non-zero base would rotate every row by
 * `(TEXT_BASE >>> 2) % PREDICTOR_ENTRIES`. Collisions survive a constant rotation, so timing would
 * be unaffected either way — but step 6 is checked against those stated row numbers, so a future
 * `TEXT_BASE` change moves the picture without moving a single cycle count.
 */
describe('predictorIndex — the arithmetic three timing tables rest on', () => {
  /**
   * The pinned size. Asserted as a literal so a "harmless" retune reddens HERE rather than silently
   * invalidating the plan's step-0 and step-0b tables, every one of which was derived at
   * `(pc>>>2)&15`.
   */
  it('holds 16 counters, the size every derived cycle count was computed at', () => {
    expect(PREDICTOR_ENTRIES).toBe(16);
  });

  /**
   * `nested-loop.s`'s two branches, which the plan names by index. These are the flagship program's
   * own witnesses, so they are the two rows the demo's legibility rests on.
   */
  it('places `nested-loop.s`’s guard and inner branch on the plan’s stated rows', () => {
    expect(predictorIndex(8)).toBe(2); // the never-taken `bne x0, x0` guard
    expect(predictorIndex(24)).toBe(6); // the inner loop's backward branch
  });

  /**
   * **What `>>> 2` buys, and the mutation that makes it matter.** RV32I instructions are 4-byte
   * aligned, so the two low bits of every pc are zero. Dropping the shift leaves `pc % 16`, under
   * which only indices 0/4/8/12 are ever reachable — **12 of the 16 rows would be dead**, a table
   * three quarters empty in a panel whose whole job is to be read.
   *
   * And it is not merely cosmetic: under `pc % 16` the two branches above land on 8 and 8. They
   * COLLIDE at the pinned size, which is precisely the aliasing the plan measured as reachable only
   * at 4 entries — so `dynamic-2bit` on `nested-loop.s` would stop being 171 and the flagship
   * ordering would break. Pinned as consecutive-pc-consecutive-row, which is the property, plus the
   * non-collision the numbers above already imply.
   */
  it('gives consecutive INSTRUCTIONS consecutive rows — not every fourth one', () => {
    expect([0, 4, 8, 12, 16].map(predictorIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  /**
   * The corpus's first and only aliasing witness, as an assertion rather than a paragraph. It is
   * what finally gave the table-size decision a reason beyond drawability: at 4 entries the guard
   * and the inner branch share a counter and interfere, costing `dynamic-2bit` 181 cycles against
   * 171. At the pinned 16 they do not.
   *
   * Written against the general `% n` form because {@link PREDICTOR_ENTRIES} is 16 and a 4-entry
   * table is not reachable through the shipped function — the claim is about the INDEXING SCHEME,
   * which is what a future session weighing a smaller table would want to know.
   */
  it('separates that pair at 16 entries and collides them at 4 — the plan’s witness', () => {
    expect(predictorIndex(8)).not.toBe(predictorIndex(24));
    const at4 = (pc: number) => (pc >>> 2) % 4;
    expect(at4(8)).toBe(at4(24));
  });

  /**
   * Total over the whole address space: an index is always a valid row. A `%` on a `>>> 0`-normalized
   * value cannot go negative or fractional, but the claim a consumer relies on is "this can index
   * `counters` safely", so it is asserted rather than inferred — including at the 32-bit boundary,
   * where a signed `>>` instead of `>>>` would produce a negative row.
   */
  it('always lands inside the table, including at the top of the address space', () => {
    for (const pc of [0, 4, 60, 64, 0x7fff_fffc, 0xffff_fffc]) {
      const i = predictorIndex(pc);
      expect(Number.isInteger(i), `pc ${pc} should give an integer row`).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(PREDICTOR_ENTRIES);
    }
  });
});

/**
 * `BranchPredictor` — the state machine itself (step 2), tested **before any processor sees it**,
 * which is the whole acceptance criterion for this step and the same inertness pattern
 * `predict.ts` (M4 step 0) and `cache.ts` (M6 step 1) each landed under.
 *
 * **Every assertion below was verified against a deliberately broken predictor before being
 * trusted**, and the mutations partition — the break table lives in the plan's step-2 section. That
 * discipline is not ceremony here: nothing constructs a `BranchPredictor` until step 3, so a defect
 * in this file's subject has no other net, and step 1 already shipped one untested export
 * (`predictorIndex`) for exactly the reason "there is no consumer yet".
 *
 * ⚠ **One mutation is invisible and is recorded rather than tested.** Replacing {@link
 * BranchPredictor.index}'s delegation with an inline `(pc >>> 2) & 15` is value-identical at the
 * pinned {@link PREDICTOR_ENTRIES}, so no assertion here can see it. What the tests DO pin is the
 * coupling that matters — that `predict` and `update` touch the row `predictorIndex` names — so a
 * table that trained the wrong row would redden even though a re-spelled index would not.
 */
describe('BranchPredictor — the saturating counter table', () => {
  /**
   * Drive one pc through a sequence of actual outcomes, collecting **what the predictor said before
   * each one**. The prediction STRING is the assertion target throughout, not a mispredict count:
   * the count is a lossy fold that a wrong seed and a wrong threshold can both leave unchanged,
   * while the string pins where in the sequence the machine was wrong.
   */
  function predictions(scheme: DynamicScheme, pc: number, actuals: readonly boolean[]): string {
    const p = new BranchPredictor(scheme);
    return actuals
      .map((actual) => {
        const bet = p.predict(pc) ? 'T' : 'N';
        p.update(pc, actual);
        return bet;
      })
      .join('');
  }

  /** `'TTTTNTTTT'` and friends as outcome arrays — the textbook sequence, read the obvious way. */
  const outcomes = (s: string): boolean[] => [...s].map((c) => c === 'T');

  /**
   * The cold table, which is more than a constructor detail: **step 6's `preRunMicro` has to show
   * exactly this at cursor −1.** `MicroTablePanel.tsx` FABRICATES a micro for the pre-run frame, and
   * the honest pre-run value of a counter table is the cold table — not `null`, and not the trained
   * one carried forward. Pinning the shape here gives that step something to copy.
   */
  it('starts cold — a full-width table, weakly not-taken in both schemes', () => {
    const oneBit = new BranchPredictor('dynamic-1bit').snapshot();
    const twoBit = new BranchPredictor('dynamic-2bit').snapshot();

    expect(oneBit.counters).toHaveLength(PREDICTOR_ENTRIES);
    expect(twoBit.counters).toHaveLength(PREDICTOR_ENTRIES);
    // 1-bit's only not-taken state is 0; 2-bit's weakly-not-taken is 1, NOT 0 — see the seed's
    // docblock for the four single-entry loops where seeding at 0 makes the 2-bit predictor lose.
    expect(oneBit.counters).toEqual(new Array<number>(PREDICTOR_ENTRIES).fill(0));
    expect(twoBit.counters).toEqual(new Array<number>(PREDICTOR_ENTRIES).fill(1));
  });

  /** Cold ⇒ the first bet on any branch is not-taken, which is the cold mispredict every loop pays. */
  it('bets not-taken on a branch it has never seen', () => {
    for (const scheme of ['dynamic-1bit', 'dynamic-2bit'] as const) {
      expect(new BranchPredictor(scheme).predict(8), scheme).toBe(false);
    }
  });

  /**
   * **The flagship comparison, and the numbers are the MEASURED ones rather than the textbook's.**
   * The plan first wrote "a 2-bit costs one mispredict here and a 1-bit two" — those are the
   * WARM-START figures. Both counters reset not-taken, so the leading `T` is a cold mispredict every
   * scheme pays, and the honest answer is two and three.
   *
   * The delta is carried entirely by the single `N`: the 1-bit table flips on it and then
   * mispredicts the very next `T`; the 2-bit only steps 3 → 2, stays in the taken half, and is
   * immediately right again. That is the hysteresis this whole feature exists to show, and it is
   * why `nested-loop.s` — a loop RE-ENTERED, so its exit `N` is followed by more `T` — is the only
   * corpus program whose four schemes come out strictly ordered.
   */
  it('separates 1-bit from 2-bit on `TTTTNTTTT` — three mispredicts against two', () => {
    const actuals = outcomes('TTTTNTTTT');

    expect(predictions('dynamic-1bit', 8, actuals)).toBe('NTTTTNTTT');
    expect(predictions('dynamic-2bit', 8, actuals)).toBe('NTTTTTTTT');
  });

  /**
   * The CEILING, stated as saturation rather than as the sequence above's side effect. A 2-bit
   * counter parked at 3 must absorb one `N` without leaving the taken half — take the clamp away and
   * a long-running loop's counter climbs past 3, at which point a single `N` no longer flips it back
   * within one step and the predictor stops being a 2-bit one.
   */
  it('saturates at the top — a long taken run then one N still bets taken (2-bit)', () => {
    const p = new BranchPredictor('dynamic-2bit');
    for (let i = 0; i < 20; i += 1) p.update(8, true);

    expect(p.snapshot().counters[predictorIndex(8)]).toBe(3);
    p.update(8, false);
    expect(p.predict(8)).toBe(true); // weakened to 2, still the taken half — the hysteresis
  });

  /**
   * The FLOOR, which the flagship sequence never touches — a counter is only ever pushed down once
   * there. Unclamped it goes negative and keeps going, so a branch that falls through for a while
   * would need as many takens to climb back as it had not-takens: the table would remember far more
   * than its width, and would stop being readable as "0..3" in step 6's panel.
   */
  it('saturates at the bottom — a long not-taken run leaves the counter at 0, not below', () => {
    for (const [scheme, afterOneTaken] of [
      ['dynamic-1bit', true],
      ['dynamic-2bit', false],
    ] as const) {
      const p = new BranchPredictor(scheme);
      for (let i = 0; i < 20; i += 1) p.update(8, false);

      expect(p.snapshot().counters[predictorIndex(8)], scheme).toBe(0);
      p.update(8, true);
      // And the climb back out is one step for a 1-bit table, two for a 2-bit one — the same
      // hysteresis as the ceiling, seen from the other end.
      expect(p.predict(8), scheme).toBe(afterOneTaken);
    }
  });

  /**
   * **Aliasing is shared state, and it is the property `nested-loop.s`'s witness rests on.** Two pcs
   * 64 bytes apart share a row at 16 entries, so training one trains the other — the interference
   * the module header calls a true fact about a machine indexed by pc alone (INV-5), and the effect
   * that costs `dynamic-2bit` 181 cycles against 171 at a 4-entry table.
   *
   * This is also the assertion that pins {@link BranchPredictor.update} to the exported index: a
   * predictor keyed off anything else — the raw pc, or a re-derived row — would leave these two
   * independent and the test would redden.
   */
  it('shares one counter between aliasing pcs — training 8 is visible at 72', () => {
    expect(predictorIndex(8)).toBe(predictorIndex(72)); // the precondition, stated not assumed

    const p = new BranchPredictor('dynamic-1bit');
    p.update(8, true);

    expect(p.predict(72)).toBe(true);
  });

  /** …and the complement: branches on DIFFERENT rows do not see each other's history. */
  it('keeps non-aliasing branches independent — training 8 leaves 24 cold', () => {
    const p = new BranchPredictor('dynamic-2bit');
    for (let i = 0; i < 5; i += 1) p.update(8, true);

    expect(p.predict(8)).toBe(true);
    expect(p.predict(24)).toBe(false); // `nested-loop.s`'s guard and inner branch, the pinned pair
  });

  /**
   * The class's index is the exported one. Weak on its own — the two agree by delegation and an
   * inlined copy would agree too (see this describe's header) — but it is the assertion a future
   * reader checks when step 6's panel highlights a row that does not match the counter that moved.
   */
  it('indexes through the same function the view highlights with', () => {
    const p = new BranchPredictor('dynamic-1bit');

    for (const pc of [0, 8, 24, 64, 72, 0xffff_fffc]) {
      expect(p.index(pc), `pc ${pc}`).toBe(predictorIndex(pc));
    }
  });

  /**
   * ⚠ **`snapshot()` hands out the LIVE table, and this test exists to keep it that way** — it is
   * the premise the plan's step 4 breaks on purpose. Every model's `snapshotState()` must DEEP-COPY
   * `micro.predictor`, exactly as it already deep-copies `micro.cache`; if this getter ever starts
   * copying defensively, four `micro.predictor` docblocks become false and step 4's break harness
   * quietly measures nothing.
   *
   * So the aliasing asserted below is not a wart being pinned — it is the contract being kept where
   * the implementer reads it. The visible symptom of getting step 4 wrong is that scrubbing to cycle
   * 0 shows the fully-TRAINED table.
   */
  it('hands out the live table, so the RECORDER owns the deep copy (step 4)', () => {
    const p = new BranchPredictor('dynamic-2bit');
    const taken = p.snapshot();

    p.update(8, true);
    p.update(8, true);

    expect(taken.counters[predictorIndex(8)]).toBe(3); // the earlier snapshot moved with the table
    expect(p.snapshot()).toBe(taken); // …because it is the same object
  });
});
