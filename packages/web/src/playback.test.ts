import { describe, expect, it } from 'vitest';
import {
  canPlay,
  DEFAULT_PLAY_SPEED,
  intervalFor,
  nextCursor,
  PLAY_SPEEDS,
  SPEED_LABELS,
  type PlaySpeed,
} from './playback';

/**
 * The pure half of continuous play. Plan: `docs/plans/continuous-play.md`.
 *
 * ⚠ **Everything in this file passes with no timer in the app at all** — that is a measured property
 * of this repo, not a worry to be argued away (the keyboard feature's 68 headless tests were all
 * green with its `addEventListener` line deleted). The browser pass is the only evidence play
 * exists. What this suite CAN own is the arithmetic and the tables, and it owns them exhaustively so
 * that the browser pass is left proving one thing rather than triaging four.
 */
describe('PLAY_SPEEDS — the positions themselves', () => {
  /**
   * ⚠ The literal pin, and the reason it is written out rather than folded.
   *
   * Every other assertion in this file derives its expectation FROM `PLAY_SPEEDS`, so all of them
   * re-derive a changed table and stay green. This one is the only assertion that would object to
   * a rung being dropped, added, renumbered, or reordered — the repo's signature defect (a test
   * keyed off a fold rather than the artifact) has already bitten inside the suite written to avoid
   * it, when `it.each(BOUND)` could not see a `Home`/`End` remap.
   */
  it('PINNED as literal data: the five positions, in ascending order', () => {
    expect(PLAY_SPEEDS).toEqual([1, 4, 10, 20, 60]);
  });

  it('is ascending, so the control reads slow → fast in source order', () => {
    const sorted = [...PLAY_SPEEDS].sort((a, b) => a - b);
    expect([...PLAY_SPEEDS]).toEqual(sorted);
  });

  it('has no duplicate positions', () => {
    expect(new Set(PLAY_SPEEDS).size).toBe(PLAY_SPEEDS.length);
  });

  it('opens at a position the control actually offers', () => {
    // The failure this deletes: a default that is not on the table leaves the control with NO lit
    // position at startup — the shell holds a position, and "none of them" is not one.
    expect(PLAY_SPEEDS).toContain(DEFAULT_PLAY_SPEED);
  });

  it('PINNED: opens at 4 cycles per second', () => {
    expect(DEFAULT_PLAY_SPEED).toBe(4);
  });
});

describe('intervalFor', () => {
  /** The literal pin on the derivation. `intervalFor` computes rather than looks up, which is what
   *  makes an interval unable to disagree with its label — but a derivation is only as right as its
   *  formula, so the four results a reader would recognize are written out. */
  it('PINNED as literal data: each position in milliseconds', () => {
    expect(intervalFor(1)).toBe(1000);
    expect(intervalFor(4)).toBe(250);
    expect(intervalFor(10)).toBe(100);
    expect(intervalFor(20)).toBe(50);
    // Not rounded: setInterval takes a fractional delay and clamps to the frame it can serve.
    expect(intervalFor(60)).toBe(1000 / 60);
  });

  it.each(PLAY_SPEEDS)('%i cycles/s yields a positive, finite period', (speed) => {
    const ms = intervalFor(speed);
    expect(ms).toBeGreaterThan(0);
    expect(Number.isFinite(ms)).toBe(true);
  });

  it('is strictly decreasing in speed — a faster position is never a longer wait', () => {
    // The transposition net: two rungs whose intervals were swapped would show up here even though
    // both are still present, positive, and finite.
    const periods = PLAY_SPEEDS.map(intervalFor);
    for (let i = 1; i < periods.length; i += 1) {
      expect(periods[i]).toBeLessThan(periods[i - 1] as number);
    }
  });

  it('the max rung is one animation frame at 60Hz', () => {
    const fastest = PLAY_SPEEDS[PLAY_SPEEDS.length - 1] as PlaySpeed;
    expect(intervalFor(fastest)).toBeCloseTo(16.67, 1);
  });
});

describe('SPEED_LABELS', () => {
  it('labels every offered position, with nothing blank', () => {
    for (const speed of PLAY_SPEEDS) {
      expect(SPEED_LABELS[speed]).toBeTruthy();
    }
  });

  it('labels ONLY the offered positions — no orphan spellings', () => {
    expect(
      Object.keys(SPEED_LABELS)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([...PLAY_SPEEDS]);
  });

  it('gives every position a distinct label', () => {
    expect(new Set(Object.values(SPEED_LABELS)).size).toBe(PLAY_SPEEDS.length);
  });

  /** The correspondence no type can check — that `4×/s` is what the number 4 looks like — pinned as
   *  literal data on both sides, the `KEY_HINTS` treatment. */
  it('PINNED as literal data: the spellings', () => {
    expect(SPEED_LABELS).toEqual({ 1: '1×/s', 4: '4×/s', 10: '10×/s', 20: '20×/s', 60: 'max' });
  });

  it('the fastest position is spelled as a limit, not a rate', () => {
    // `max` means "as fast as the screen can show a cycle". A reader picking it is picking a
    // ceiling; spelling it `60×/s` would invite a future edit to offer 120.
    expect(SPEED_LABELS[60]).toBe('max');
  });
});

describe('nextCursor — the end rule', () => {
  it('steps pre-run into the first recorded cycle', () => {
    // −1 is a real position (the pre-run state), not "before the start": play from a fresh load must
    // behave exactly as the step button does there.
    expect(nextCursor(-1, 9)).toBe(0);
  });

  it('advances by exactly one mid-run', () => {
    expect(nextCursor(0, 9)).toBe(1);
    expect(nextCursor(4, 9)).toBe(5);
    expect(nextCursor(8, 9)).toBe(9);
  });

  it('STOPS at the last cycle rather than looping', () => {
    // The pinned decision. A loop would restart a halted program from pre-run with no user action,
    // which reads as the machine doing something rather than the animation wrapping.
    expect(nextCursor(9, 9)).toBe('stop');
  });

  it('stops one tick EARLIER than "the cursor left the range"', () => {
    // At `lastCycle` the run is already shown in full. Advancing first and stopping after would
    // require the cursor to visit a position that does not exist.
    expect(nextCursor(8, 9)).toBe(9);
    expect(nextCursor(9, 9)).toBe('stop');
  });

  it('stops from a cursor already past the end, rather than walking further', () => {
    expect(nextCursor(10, 9)).toBe('stop');
    expect(nextCursor(1_000, 9)).toBe('stop');
  });

  it('refuses to start on an empty recording', () => {
    // `lastCycle` is `recordedCycles - 1`, so nothing loaded reports −1 — which is ALSO the pre-run
    // cursor. Without this rung, "play from the start" and "play with no program" are the same call.
    expect(nextCursor(-1, -1)).toBe('stop');
  });

  it('a single-cycle recording plays its one cycle and then stops', () => {
    expect(nextCursor(-1, 0)).toBe(0);
    expect(nextCursor(0, 0)).toBe('stop');
  });

  it('walks a whole short recording exactly once, in order, and terminates', () => {
    // The sweep the per-cell assertions cannot make: that the rule composes into a finite walk
    // hitting every cycle once. A rule that stalled (returning its input) or skipped would pass
    // every single-step assertion above and fail here.
    const lastCycle = 5;
    const visited: number[] = [];
    let cursor = -1;
    for (let guard = 0; guard < 100; guard += 1) {
      const next = nextCursor(cursor, lastCycle);
      if (next === 'stop') break;
      visited.push(next);
      cursor = next;
    }
    expect(visited).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('canPlay', () => {
  it('is exactly "nextCursor would move"', () => {
    // The identity is the point: the button's disabled state and the tick's stop condition are ONE
    // predicate, so a `▶ play` that arms a timer and immediately stops it cannot exist.
    for (const lastCycle of [-1, 0, 1, 5]) {
      for (let cursor = -2; cursor <= 7; cursor += 1) {
        expect(canPlay(cursor, lastCycle)).toBe(nextCursor(cursor, lastCycle) !== 'stop');
      }
    }
  });

  it('is false with nothing loaded, and at the halted end', () => {
    expect(canPlay(-1, -1)).toBe(false);
    expect(canPlay(9, 9)).toBe(false);
  });

  it('is true at pre-run and mid-run of a real recording', () => {
    expect(canPlay(-1, 9)).toBe(true);
    expect(canPlay(0, 9)).toBe(true);
    expect(canPlay(8, 9)).toBe(true);
  });
});
