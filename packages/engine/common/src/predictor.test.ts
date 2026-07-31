import { describe, expect, it } from 'vitest';
import { PREDICTOR_ENTRIES, predictorIndex } from './predictor';

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
