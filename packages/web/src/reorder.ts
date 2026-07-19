/**
 * Panel reordering — the pure half of "drag a panel onto another and they change places".
 *
 * A view concern in the strictest sense: nothing here touches the engine, the trace, or the
 * recording (INV-2/INV-3). It is a permutation of the shell's own layout slots and nothing more.
 *
 * **Slots, not free-floating windows.** The reorder is a permutation of a fixed set of positions —
 * the vertical stack's rows, and the bottom row's grid columns — so two panels can never occupy the
 * same space. Overlap is prevented BY CONSTRUCTION rather than detected and rejected after the
 * fact, which is why there is no collision test in this file: there is no state in which two panels
 * overlap for one to find. That also keeps the layout responsive (the grid still owns the widths)
 * and keeps the sticky transport bar's stacking context simple.
 */

/**
 * Move `from` to `to`'s position, sliding everything between them along. The drop semantics of the
 * group: dragging the source panel onto the memory panel puts source WHERE memory was.
 *
 * Returns the order unchanged when either key is absent or they are the same — a drop on yourself,
 * or a drag whose payload names a panel that is no longer rendered, is a no-op rather than an
 * error. (Both are reachable: a drop on the dragged panel itself is the commonest mis-drop, and the
 * conditionally-rendered panels can vanish mid-drag when the model or config changes.)
 */
export function movePanel<T>(order: readonly T[], from: T, to: T): T[] {
  const fromIndex = order.indexOf(from);
  const toIndex = order.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return [...order];
  const next = [...order];
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, from);
  return next;
}

/**
 * The order to actually render: the user's permutation, filtered to the panels present right now,
 * with any present panel the permutation has never heard of appended in its declared order.
 *
 * Both halves are load-bearing, because the shell's panels come and go — the pipeline map appears
 * only when instructions overlap, the cache grid only when the recording has a cache, and the
 * datapath changes identity with the model. Filtering keeps a stored order from resurrecting a
 * panel that is not rendered this cycle; appending the unknowns means a panel that appears LATER
 * (turn the cache on) shows up in its authored position instead of silently disappearing because it
 * was not in the permutation the user last dragged.
 */
export function visibleOrder<T>(order: readonly T[], present: readonly T[]): T[] {
  const set = new Set(present);
  const kept = order.filter((k) => set.has(k));
  const known = new Set(kept);
  return [...kept, ...present.filter((k) => !known.has(k))];
}
