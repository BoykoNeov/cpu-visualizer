/**
 * `MachineState.micro` for the out-of-order core — the per-model §5 extension point, and the data
 * source the step-6 `MicroTablePanel` folds over (INV-3). Deferred at M9 step 0 as an explicit
 * YAGNI call ("forcing a `micro` shape now would be designing for a view that does not exist"); the
 * view now exists, so the trigger fires and this is its minimum shape.
 *
 * ## Everything here is a VIEW PROJECTION, not the engine's own structures
 *
 * Two deliberate choices, both so the boundary stays clean:
 *
 *  - **Plain, self-contained value objects — no opaque {@link Tag}, no live `RobEntry`.** A `Tag` is
 *    opaque on purpose (PRF-forward-compat seam #1); rather than leak it and force the view to import
 *    `tagNumber`/`tagsEqual`, the snapshot reads every tag back to a plain `number` HERE (the one
 *    sanctioned readback, done in the engine) so the view only ever compares numbers. Same for
 *    operands and rename slots: the engine's `OperandSource`/`RenameSlot` become `OperandView`/
 *    `RenameSlotView` with the tag already a number.
 *  - **Independent per cycle (the repo's signature discipline).** A `RobEntry`'s `state`/`value` are
 *    reassigned ON THE SAME OBJECT each cycle and `Rob.entries` is `shift()`ed on commit, so a shared
 *    reference would replay every recorded cycle as FINAL state — invisible to final-state
 *    conformance, visible only in time-travel (the exact bug `SuperscalarMicro` and `rob.ts` both warn
 *    of). {@link OutOfOrderProcessor.snapshotState} builds a fresh `RobEntryView` per entry, copying
 *    the mutated scalars by value; `decoded` is immutable (set once at allocate) so it rides along by
 *    reference.
 *
 * ## There is no separate reservation-station structure
 *
 * Classic speculative Tomasulo holds operand values in the ROB itself, so a `'waiting'` ROB entry IS
 * the reservation-station-equivalent (see `rob.ts`'s `RobState` doc). The panel's RS table is
 * therefore a PROJECTION of the not-yet-issued (`state === 'waiting'`) subset of {@link rob},
 * reading each entry's {@link RobEntryView.srcA}/`srcB` readiness — there is no RS array to look for.
 */

import type { PredictorState } from '@cpu-viz/engine-common';
import type { DecodedInstruction } from '@cpu-viz/isa';
import type { RobState } from './rob';

/** A source operand as the view reads it: a captured value, or the tag it is still waiting on. */
export type OperandView =
  | { readonly ready: true; readonly value: number }
  | { readonly ready: false; readonly tag: number };

/** What an architectural register currently means, tag already read back to a plain number. */
export type RenameSlotView =
  | { readonly kind: 'committed' }
  | { readonly kind: 'pending'; readonly tag: number };

/** One in-flight ROB entry, projected for display (see the file header on independence per cycle). */
export interface RobEntryView {
  /** The result handle, as a plain number — displayed as `ROB#tag` and matched against the rename map. */
  readonly tag: number;
  /** Monotonic allocation order (age); index 0 of {@link OutOfOrderMicro.rob} is the oldest/head. */
  readonly seq: number;
  /** The stable instruction id (INV-4) — what the follow-highlight keys on across every surface. */
  readonly id: string;
  readonly decoded: DecodedInstruction;
  /** Architectural destination register, or 0 for "writes nothing". */
  readonly rd: number;
  readonly state: RobState;
  /** The captured result once known, else null (stores, and anything still executing). */
  readonly value: number | null;
  /** The two source operands' readiness — the RS-table projection reads these. Null = no such source. */
  readonly srcA: OperandView | null;
  readonly srcB: OperandView | null;
}

/**
 * The out-of-order core's `micro` shape. Distinct from `SuperscalarMicro` BY CONSTRUCTION — it has
 * no `width` field, so `PairingReadout`'s gate (`typeof micro.width === 'number'`) never fires for
 * it; the `MicroTablePanel` gates on {@link rob} being an array instead.
 *
 * **No `cache` field, deliberately (step 6).** The shared cache grid (`web/src/cache-grid.ts`) was
 * built for the PIPELINE `micro` shape: it derives its `filling` freeze countdown from
 * `micro.exMem.missCyclesRemaining`, which this model does not have. Exposing `cache` here would
 * light that grid for OoO but leave it unable to draw the fill — a line would read RESIDENT for the
 * whole miss penalty while the ROB table right above shows the load still `executing`, a cross-
 * surface contradiction on the exact surface (the miss) that is the tier's drama. So the cache is
 * NOT re-exported into `micro`; drawing a faithful OoO cache grid (fill derived from the MSHR/miss
 * state) is its own piece of work, not a step-6 side effect. The miss is already visible in the ROB
 * table (the load sits `executing` for its penalty) and the pipeline map.
 */
export interface OutOfOrderMicro {
  /** The configured ROB capacity — how many entries the window can hold, for the occupancy read. */
  readonly robCapacity: number;
  /** Every in-flight entry, OLDEST FIRST (index 0 is the head, next to retire). */
  readonly rob: readonly RobEntryView[];
  /** The rename map indexed by architectural register (length 32); most read `committed`. */
  readonly rename: readonly RenameSlotView[];
  /**
   * The branch history table's counters, or `null` when the configured scheme has no memory. **Null
   * on every recorded cycle as of the dynamic-branch-prediction plan's step 1** — nothing constructs
   * a predictor until step 3 wires the pipeline and step 5 reaches this model.
   *
   * **This field IS exposed, and `cache` above deliberately is NOT — the difference is not
   * inconsistency, it is the same test applied twice.** The cache is withheld because the shared
   * grid derives its fill countdown from `micro.exMem.missCyclesRemaining`, a pipeline-shaped field
   * this machine does not have, so lighting that panel here would draw a line as RESIDENT while the
   * ROB above it still shows the load `executing` — a cross-surface contradiction (INV-5) on the
   * exact surface that is this tier's drama. A predictor table has no such model-shaped dependency:
   * its rows are counters indexed by pc, which means the same thing on every machine that bets. So
   * the panel can be truthful here, and the field goes in.
   *
   * **One table for the whole machine**, shared across lanes and across everything in flight — a
   * per-lane predictor would be a different machine.
   *
   * ⚠ **Spelled `predictor` here and in `PipelineMicro`, `DeepPipelineMicro` and `SuperscalarMicro`
   * alike** — a step-6 panel reads `micro.predictor` across all four, and `cache-grid.ts`'s header
   * records what a per-model name costs (a hard-coded `micro.exMem` left that panel idle on the deep
   * pipeline, whose latch is `ex2Mem`, for a whole milestone on a shipped config).
   *
   * ⚠ **DEEP-COPY it into every snapshot**, for this module header's own reason: the predictor is
   * single-buffered and mutated in place, so a `.slice()` of the array would replay a fully-trained
   * table at cycle 0. This model is also where the plan's one open behavioral fork bites — a branch
   * here can resolve and then be KILLED by an older mispredict, so update-on-resolve and
   * update-on-commit are genuinely different machines, and INV-8 cannot see the difference. Pin that
   * before step 5, not during it.
   */
  readonly predictor: PredictorState | null;
}
