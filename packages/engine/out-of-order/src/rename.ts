import { RV32I_REGISTER_COUNT } from '@cpu-viz/trace';
import { COMMITTED, tagsEqual, type RenameSlot, type Tag } from './types';

/**
 * The architectural-register → tag map (classic speculative Tomasulo). One instance per
 * processor; NOT part of any recorded snapshot — `MachineState.micro` stays unset at this step
 * (no view consumes it yet), so this is private engine state mutated in place, same as the
 * superscalar's single-buffered cache (no double-buffering needed for state nothing ever reads
 * back out of a `CycleTrace`).
 *
 * `x0` is never renamed: callers never allocate a tag for register 0 (every model's `destReg`
 * helper already returns `0` for "writes nothing," and `0` is the one register this table's
 * `dispatch` must refuse) — so index 0 is permanently {@link COMMITTED} and reads as the
 * hardwired-zero the register file already holds there.
 */
export class RenameTable {
  private slots: RenameSlot[] = new Array<RenameSlot>(RV32I_REGISTER_COUNT).fill(COMMITTED);

  reset(): void {
    this.slots.fill(COMMITTED);
  }

  /** What `reg` currently means — committed, or an in-flight tag. */
  lookup(reg: number): RenameSlot {
    const slot = this.slots[reg];
    if (slot === undefined) throw new Error(`rename table: register ${reg} out of range`);
    return slot;
  }

  /**
   * A shallow copy of the whole map, for the per-cycle `micro` snapshot (step 6). Shallow is
   * sufficient — a slot is REPLACED (`claim`/`commit`/`restore` all assign `this.slots[reg] = …`),
   * never mutated in place — so the copied array can never alias a future edit, unlike the ROB's
   * entries which ARE mutated and need per-entry copies. `RenameSlot` values are themselves
   * immutable, so they ride along by reference.
   */
  snapshot(): readonly RenameSlot[] {
    return this.slots.slice();
  }

  /** Dispatch claims `reg` for a fresh tag. Refuses `x0` — nothing may rename the hardwired zero. */
  claim(reg: number, tag: Tag): void {
    if (reg === 0) {
      throw new Error('rename table: x0 may never be renamed (destReg must return 0 for it)');
    }
    this.slots[reg] = { kind: 'pending', tag };
  }

  /**
   * Commit reverts `reg` to committed — but ONLY if it still points at `tag`. A younger
   * instruction may have already re-claimed `reg` for its own tag (WAW), in which case that
   * younger mapping must survive this commit untouched.
   */
  commit(reg: number, tag: Tag): void {
    const slot = this.lookup(reg);
    if (slot.kind === 'pending' && tagsEqual(slot.tag, tag)) {
      this.slots[reg] = COMMITTED;
    }
  }

  /**
   * Flush recovery: restore `reg` to whatever it mapped to before the instruction being rolled
   * back claimed it — but again, only if nothing younger has since re-claimed it (that younger
   * entry is itself being flushed too, in the same rollback, and will run its own restore after
   * this one — flush recovery walks youngest-to-oldest for exactly this reason).
   */
  restore(reg: number, tag: Tag, previous: RenameSlot): void {
    const slot = this.lookup(reg);
    if (slot.kind === 'pending' && tagsEqual(slot.tag, tag)) {
      this.slots[reg] = previous;
    }
  }
}
