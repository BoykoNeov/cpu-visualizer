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

import type { DecodedInstruction } from '@cpu-viz/isa';
import type { CacheState } from '@cpu-viz/engine-common';
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
 * it; the `MicroTablePanel` gates on {@link rob} being an array instead. `cache` mirrors the other
 * cached models so the existing cache grid appears for the OoO money shot (cache-on) for free (INV-3).
 */
export interface OutOfOrderMicro {
  /** The configured ROB capacity — how many entries the window can hold, for the occupancy read. */
  readonly robCapacity: number;
  /** Every in-flight entry, OLDEST FIRST (index 0 is the head, next to retire). */
  readonly rob: readonly RobEntryView[];
  /** The rename map indexed by architectural register (length 32); most read `committed`. */
  readonly rename: readonly RenameSlotView[];
  /** The D-cache lines, or null when no cache is configured — feeds the shared cache grid. */
  readonly cache: CacheState | null;
}
