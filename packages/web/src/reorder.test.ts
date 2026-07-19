import { describe, expect, it } from 'vitest';
import { movePanel, visibleOrder } from './reorder';

describe('movePanel', () => {
  const order = ['source', 'registers', 'memory'] as const;

  it('puts the dragged panel where the drop target was', () => {
    expect(movePanel(order, 'source', 'memory')).toEqual(['registers', 'memory', 'source']);
    expect(movePanel(order, 'memory', 'source')).toEqual(['memory', 'source', 'registers']);
  });

  it('swaps neighbours', () => {
    expect(movePanel(order, 'source', 'registers')).toEqual(['registers', 'source', 'memory']);
  });

  it('is a no-op on a drop onto itself', () => {
    expect(movePanel(order, 'registers', 'registers')).toEqual([...order]);
  });

  it('is a no-op when a key is absent — a panel can vanish mid-drag', () => {
    expect(movePanel(order, 'cache', 'memory')).toEqual([...order]);
    expect(movePanel(order, 'memory', 'cache')).toEqual([...order]);
  });

  it('never drops or duplicates a panel', () => {
    for (const from of order) {
      for (const to of order) {
        expect([...movePanel(order, from, to)].sort()).toEqual([...order].sort());
      }
    }
  });
});

describe('visibleOrder', () => {
  it('keeps the user permutation for the panels present', () => {
    expect(
      visibleOrder(['memory', 'source', 'registers'], ['source', 'registers', 'memory']),
    ).toEqual(['memory', 'source', 'registers']);
  });

  it('drops a panel that is not rendered this cycle', () => {
    // The cache grid is gated on the recording having a cache; turning it off must not leave a hole.
    expect(visibleOrder(['cache', 'datapath'], ['datapath'])).toEqual(['datapath']);
  });

  it('appends a newly-present panel rather than dropping it', () => {
    // The user reordered before turning the cache on; the grid must appear, not vanish.
    expect(visibleOrder(['datapath', 'map'], ['map', 'datapath', 'cache'])).toEqual([
      'datapath',
      'map',
      'cache',
    ]);
  });

  // A newcomer goes to the END, not back to the slot it is authored in — the previous case cannot
  // tell the two apart, because `cache` is authored last and they coincide there. `map` is authored
  // FIRST, so this one separates them, and it is the honest statement of what this function does:
  // it preserves a permutation and admits strangers, it does not re-derive the authored order.
  //
  // That is only sound because a stored order can never be missing a panel the user still has — the
  // drop handler refuses to store an order the drop did not change, so a one-panel stack never
  // persists `[datapath]` and this case is unreachable from the UI. Pinned rather than fixed here:
  // the invariant lives at the call site, and a test that asserted the pretty answer would hide the
  // day it stops holding.
  it('appends at the END, even for a panel authored first', () => {
    expect(visibleOrder(['datapath'], ['map', 'datapath', 'cache'])).toEqual([
      'datapath',
      'map',
      'cache',
    ]);
  });

  it('is the authored order when nothing has been dragged', () => {
    expect(visibleOrder([], ['map', 'datapath', 'cache'])).toEqual(['map', 'datapath', 'cache']);
  });
});
