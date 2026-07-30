/**
 * The timer half of continuous play — the one place in this app with a wall-clock in it. Plan:
 * `docs/plans/continuous-play.md`; the decisions it dispatches on are in `playback.ts`.
 *
 * **Why this is a hook and not four lines in `App.tsx`:** the same reason `keyboard.ts` is a module.
 * Headless tests here are `renderToStaticMarkup` with no jsdom, so nothing in this repo can see a
 * timer fire — and a `useEffect` body is unreachable from a headless test even in principle, which is
 * the M13-review finding that a `useCallback` body is code no test can invoke. So the surface is kept
 * as small as it can be made and every VALUE decision is delegated to the pure module. What is left
 * here is arming, clearing, and one dispatch, and the browser pass is what proves it.
 *
 * INV-1 is untouched, and structurally rather than by care: `loadInto` runs the program to the end
 * before `loaded.current` is ever set, so this walks a cursor over a recording that is already
 * complete. The engine never sees this timer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { canPlay, DEFAULT_PLAY_SPEED, intervalFor, nextCursor, type PlaySpeed } from './playback';

/** What the transport bar needs to render and drive play. */
export interface Playback {
  /** True while the timer is armed. The button's face reads from this. */
  playing: boolean;
  /** The selected position. Always one of `PLAY_SPEEDS` — never a free-form millisecond value. */
  speed: PlaySpeed;
  /** True when play could actually move from here — the button's `disabled` reads from this, and it
   *  is the SAME predicate the tick stops on, so a click that arms and immediately halts cannot
   *  exist. */
  canStart: boolean;
  /** Start if stopped, stop if playing. One verb, because the control is one button. */
  toggle: () => void;
  /** Stop, idempotently. Called by the tick at the end of the run and by the re-record effect. */
  stop: () => void;
  setSpeed: (speed: PlaySpeed) => void;
}

/**
 * Drive `scrubTo` on a wall-clock while `playing`.
 *
 * Deliberately takes the four things it needs rather than the whole `Simulator`: the hook is then
 * honest about its reach (it cannot start a program, change a knob, or touch the engine), and the
 * `recording` parameter is there for exactly one job — see the re-record effect below.
 *
 * @param cursor      the current cycle, or −1 at pre-run
 * @param lastCycle   `recordedCycles - 1`; −1 when nothing is loaded
 * @param scrubTo     the simulator's own cursor mover — play introduces no new way to move it
 * @param recording   the recording's IDENTITY, which changes on every fresh load
 */
export function usePlayback(
  cursor: number,
  lastCycle: number,
  scrubTo: (cycle: number) => void,
  recording: readonly unknown[],
): Playback {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaySpeed>(DEFAULT_PLAY_SPEED);

  // The tick reads the cursor and the run's length through refs, NOT through its closure, and this
  // is the load-bearing line of the file. If the interval effect below depended on `cursor`, it
  // would tear down and re-arm the timer on every single tick — which silently makes the period
  // irregular (each cycle's wait restarts from whenever React committed, not from the last tick) and
  // there is no headless net anywhere in this repo for a PERIOD. A ref updated during render is what
  // lets the effect depend on `playing` and `speed` alone.
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const lastCycleRef = useRef(lastCycle);
  lastCycleRef.current = lastCycle;
  // `scrubTo` is stable in practice (a `useCallback` on `rerender` alone), but it is read through a
  // ref for the same reason: a future edit that made it depend on the cursor would otherwise convert
  // this into the re-arming bug above, silently and at a distance.
  const scrubRef = useRef(scrubTo);
  scrubRef.current = scrubTo;

  const stop = useCallback(() => setPlaying(false), []);

  const canStart = canPlay(cursor, lastCycle);

  // Start only from a position play can actually move from — otherwise a click at the halted end
  // arms a timer whose first tick stops it, which looks like a broken clock rather than a dead
  // button. Stopping is unconditional.
  const toggle = useCallback(() => {
    setPlaying((on) => (on ? false : canPlay(cursorRef.current, lastCycleRef.current)));
  }, []);

  // The timer. Depends on `playing` and `speed` and NOTHING that changes per tick (see the refs
  // above). Cleared on every change of either, and on unmount.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const next = nextCursor(cursorRef.current, lastCycleRef.current);
      if (next === 'stop') {
        // Stop from INSIDE the tick. `recorder.stepForward()` returns null at a halted end and does
        // not advance, so nothing throws — which is exactly the danger: without this the timer would
        // tick forever doing nothing and the button would never return to its `▶` face.
        setPlaying(false);
        return;
      }
      scrubRef.current(next);
    }, intervalFor(speed));
    return () => clearInterval(id);
  }, [playing, speed]);

  // **Stop on re-record.** Every knob in the shell (`setModel`, `setForwarding`, `setCache`,
  // `setIssueWidth`, `setOutOfOrderIssue`, `setRobSize`) and every load (`select`, `startLesson`,
  // `loadEdited`) routes through `loadInto`, which builds a FRESH recorder parked at −1. A timer left
  // armed across that would silently resume play on a different machine, from the start, with no user
  // action — and what the reader would see is a program playing, which reads as a feature rather than
  // as a bug. Keyed on the recording's identity, the same signal `App.tsx` uses to clear `followed`:
  // a fresh load builds a fresh recorder and so a fresh array.
  useEffect(() => stop(), [recording, stop]);

  return { playing, speed, canStart, toggle, stop, setSpeed };
}
