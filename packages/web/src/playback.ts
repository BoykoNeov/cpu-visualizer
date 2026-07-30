/**
 * Continuous play — the speed table and the end rule, as pure functions over numbers. Plan:
 * `docs/plans/continuous-play.md`.
 *
 * **There is no wall-clock in this file, deliberately.** INV-1 says the engine is pure and
 * deterministic; play has a timer, and the two do not collide because of WHERE the timer sits.
 * `loadInto` runs the program to the end (`recorder.runToEnd`) and parks at −1 before
 * `loaded.current` is ever set, so by the time anything can play, **the whole recording already
 * exists** — play animates a cursor over recorded cycles and never asks the engine for one. The
 * `setInterval` that walks it lives in `usePlayback`; everything that is a decision about VALUES
 * lives here, where a headless test can sweep it.
 *
 * That split is the same one `keyboard.ts` made, for the same measured reason: headless tests here
 * are `renderToStaticMarkup` with no jsdom, so **no test in this repo can see a timer fire** any
 * more than it can see a keypress. The keyboard feature priced that exactly — deleting its one
 * `addEventListener` line left all 68 of its own headless tests green while the browser pass failed
 * 6. A timer has the identical shape of hole, so the answer is the same: make the part that can be
 * watched as large as possible, and keep the part that cannot down to arming and dispatch.
 */

/**
 * The play speeds, in cycles per second, and the only ones.
 *
 * Named in **cycles per second** rather than as multipliers of a base (`1×`, `2×`): this app's unit
 * is the cycle and the reader is counting them, so "4 cycles a second" says what they will see
 * while "2×" says it relative to a base they never chose.
 *
 * A small set of stable positions rather than a free-form millisecond number — the house pattern for
 * every knob in this shell (the cache's three geometries, the four issue widths): the UI holds a
 * POSITION, and "some number the user typed" is not a position a control can be lit in.
 *
 * **60 is the `max` rung, and it is a real speed rather than a synonym for `run ⏭`.** One cycle per
 * animation frame is as fast as a 60Hz display can SHOW a cycle, so it is the ceiling on watching
 * rather than on computing. The reader who wants the end of a 50,000-cycle program and does not want
 * to watch it still presses `run ⏭`, which is instant and untouched by this feature; `max` is for
 * the one who wants to see it fly past and be able to pause mid-flight. Both exist because they
 * answer different questions, and neither is the other one slowed down.
 *
 * ⚠ **The top of this table is provisional.** What actually bounds it is the per-tick render cost of
 * the most expensive configuration (out-of-order, cache on, map + pairing readout visible, datapath
 * at `expert`) — a tick that costs more than its own interval does not run at that speed, it just
 * re-renders continuously and the timer coalesces. The browser pass measures that cost; if a rung's
 * interval is under it, the honest options are to move the rung or to record the observed effective
 * speed. Do not leave a position on the control that the app cannot actually reach.
 */
export const PLAY_SPEEDS = [1, 4, 10, 20, 60] as const;

/** One of the {@link PLAY_SPEEDS} positions, in cycles per second. */
export type PlaySpeed = (typeof PLAY_SPEEDS)[number];

/**
 * The speed play opens at: **4 cycles per second** — fast enough to read as motion rather than a
 * sequence of stills, slow enough to watch a single bubble appear and go. The slowest rung (1/s) is
 * for the reader who is reading each cycle's narration; the fastest is for getting to the interesting
 * part of a long run.
 *
 * Typed as {@link PlaySpeed}, so an opening default that is not one of the offered positions does not
 * compile — the failure mode where a control has no lit position at startup.
 */
export const DEFAULT_PLAY_SPEED: PlaySpeed = 4;

/** Milliseconds in a second — named so the conversion below reads as one, and so the one place a
 *  "speed in per-second units" becomes "a period in ms" is a division rather than a table of magic
 *  numbers that could disagree with the labels. */
const MS_PER_SECOND = 1000;

/**
 * The timer period for a speed, in milliseconds: 1/s → 1000, 4/s → 250, 10/s → 100, 20/s → 50,
 * 60/s → 16.67 (one animation frame).
 *
 * Note the `max` rung's period is **not an integer**, and that is left alone rather than rounded:
 * `setInterval` takes a fractional delay and clamps it to the frame it can actually serve, so
 * rounding here would only move the lie from the browser into this file. The tests pin it as
 * `1000 / 60`, which is what it means.
 *
 * DERIVED from the speed rather than paired with it in a table, which is the one arrangement in
 * which the interval cannot disagree with the label the reader is shown — a `{ speed: 4, ms: 100 }`
 * row is a same-typed pair, and this repo has shipped that transposition twice. The tests still pin
 * all four results as literals, because a derivation is only as right as its formula.
 */
export function intervalFor(speed: PlaySpeed): number {
  return MS_PER_SECOND / speed;
}

/** How each speed is written for the reader. Typed total over {@link PlaySpeed}, so a fifth position
 *  cannot reach the control unlabelled — the `KEY_HINTS` pattern from `keyboard.ts`. */
export const SPEED_LABELS: Readonly<Record<PlaySpeed, string>> = {
  1: '1×/s',
  4: '4×/s',
  10: '10×/s',
  20: '20×/s',
  // Spelled as a WORD, not `60×/s`, because the number is not the point of this position: it means
  // "as fast as the screen can show a cycle", and a reader choosing it is choosing a limit rather
  // than a rate. It is also what stops `max` from reading as one more rung a future edit might
  // double.
  60: 'max',
};

/**
 * Where the cursor goes on the next tick, or `'stop'` — **the whole end-of-run rule, in one pure
 * function.**
 *
 * It STOPS at the end rather than looping. A loop would restart an already-halted program from
 * pre-run with no user action, which reads as the machine doing something rather than as the
 * animation wrapping around. (Loop mode is a named follow-up in the plan, not a silent omission.)
 *
 * Three things it must get right, and each is a test:
 *
 *  - **Pre-run is a real position, not "before the start".** The cursor's domain is `[-1, lastCycle]`
 *    where −1 is the pre-run state, so play from a fresh load steps −1 → 0 like the button does.
 *  - **`lastCycle` stops.** Note this is one tick EARLIER than "the cursor went out of range": at
 *    `lastCycle` the run is already shown in full, so advancing first and stopping after would
 *    require a cursor position that does not exist.
 *  - **An empty recording refuses to start.** `lastCycle` is `recordedCycles - 1`, so a shell with
 *    nothing loaded reports −1 — and −1 is also the pre-run cursor, which is exactly the pair that
 *    would otherwise make "play from the start" and "play with no program" indistinguishable.
 *
 * Deliberately takes `cursor` and `lastCycle` as plain numbers rather than the simulator: it is the
 * arithmetic that has the defects, and a function over two numbers can be swept over every cell of
 * the interesting range.
 */
export function nextCursor(cursor: number, lastCycle: number): number | 'stop' {
  if (lastCycle < 0) return 'stop'; // nothing recorded — there is no cycle to play to
  if (cursor >= lastCycle) return 'stop'; // the run is fully shown; `>=` so an over-range cursor also stops
  return cursor + 1;
}

/**
 * Can play start from here at all? True exactly when {@link nextCursor} would move — so the button's
 * disabled state and the tick's stop condition are **the same predicate**, not two expressions that
 * have to be kept agreeing.
 *
 * That identity is the point: the failure it deletes is a `▶ play` button that is live at the halted
 * end, arms a timer, and immediately stops it — a click that does nothing and looks like a bug in
 * the clock rather than in the button.
 */
export function canPlay(cursor: number, lastCycle: number): boolean {
  return nextCursor(cursor, lastCycle) !== 'stop';
}
