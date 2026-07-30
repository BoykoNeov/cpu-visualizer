/**
 * The transport bar's cursor-dependent READOUT — the three texts that change as the clock steps (the
 * cycle counter, the instruction being watched, and the `N in flight` chip) — and the width each one
 * is held open to for the whole recording.
 *
 * ## Why the widths exist at all
 *
 * These three texts used to sit in the bar's `flexWrap` control row. Their combined width moves with
 * the cursor — `start (pre-run)` is 132px and `cycle 58 / 58 — halted` is 193px, the instruction span
 * is absent entirely at the pre-run cursor, and the `in WB.0 · 3 in flight` chip only exists when
 * more than one instruction is in flight — so the row's content width swung 888 → 1218px over one
 * run while the space available to it is a CONSTANT 1168px (`main` is capped at `maxWidth: 1200`).
 * Measured 2026-07-30 in the shipped bundle: the bar took 81.4px at some cursors and 104.4px at
 * others, at 1500/1400/1300/1240/1200/920/900/880/840px, and since it is `position: sticky` every
 * surface on the page moved with it. The stylesheet's captions comment claimed state could not
 * reintroduce the jitter class because every media threshold is a viewport width — true of the
 * thresholds, and silent about the content width that crosses them.
 *
 * The readout now lives on the scrub row instead, where the only other occupant is a slider that can
 * absorb any leftover width. That removes the wrap. It does NOT by itself stop the SLIDER from
 * resizing under the reader as they step — a slider whose length changes is a scrub bar whose
 * playhead lies — which is what these widths are for: each span is held at the widest text it will
 * ever hold over this recording, so the readout's box is one number for the whole run.
 *
 * ## Why a character count is an exact width here
 *
 * All three spans render in `MONO`, and that font's advance is uniform across every glyph these
 * strings use — verified against the browser, not assumed: `cycle 18 / 43` and
 * `cycle 58 / 58 — halted` both measure 8.795px/char, `in MEM · 3 in flight` and
 * `in ROB#12 · 3 in flight` both 7.04px/char, and three different instruction texts all 7.476px/char.
 * So `N` characters is exactly `N` `ch`, including the em dash and the middle dot, and the reserve
 * can be a character count rather than a hidden ghost element. That matters beyond tidiness: a ghost
 * carrying plausible text (`cycle 99 / 99`) inside `.transport--sticky` would answer to the very
 * selectors the browser rigs read that bar with — the decoy class already recorded against the data
 * memory panel's placeholder.
 */

import type { CycleTrace, InstructionInstance } from '@cpu-viz/trace';
import { formatInstruction } from './format';

/** The clock's position: the pre-run cursor, a cycle, or the halted end. */
export function counterText(cursor: number, lastCycle: number, atEnd: boolean): string {
  if (cursor < 0) return 'start (pre-run)';
  return `cycle ${cursor} / ${lastCycle}${atEnd ? ' — halted' : ''}`;
}

/** The instruction the shell is watching, or `''` at a cursor where nothing is in flight. */
export function instructionText(inFlight: InstructionInstance | null): string {
  return inFlight === null ? '' : formatInstruction(inFlight.decoded);
}

/**
 * The qualifier that says which of several in-flight instructions the line above names — and `''`
 * exactly when it would be the whole story anyway (one instruction in flight, or none). Single-cycle
 * and multi-cycle therefore never show it without this module naming either model (INV-3).
 */
export function chipText(
  inFlight: InstructionInstance | null,
  inFlightCount: number,
  following: boolean,
): string {
  if (inFlight === null || inFlightCount <= 1) return '';
  return `${following ? 'following' : 'in'} ${inFlight.location} · ${inFlightCount} in flight`;
}

/** Characters of reserve for each span of the readout. Zero means "this run never shows it". */
export interface ReadoutReserve {
  readonly counter: number;
  readonly instruction: number;
  readonly chip: number;
}

/**
 * The widest each readout span gets over a whole recording, in characters.
 *
 * Bounded by construction, which is the property a derived reserve lives or dies on: it is three
 * numbers, not one class per distinct row, so an 800-instruction program reserves exactly what an
 * 8-instruction one does. The scan is O(cycles × in flight) string formats and is meant to be
 * memoized on the recording.
 *
 * Two deliberate over-reserves, both a few characters and both bought for a reason:
 *
 *  - The counter is measured at the LAST cycle with the halted suffix attached. The suffix is
 *    reachable on every recording the transport is ever rendered for — a program that does not halt
 *    is a `runtimeError` and the shell replaces the whole transport with a notice — and the last
 *    cycle carries the most digits, so this is the peak rather than an assumption about it.
 *  - The instruction and chip are measured over EVERY in-flight instance of every cycle, not over
 *    the one the shell happens to show. That makes the reserve independent of which instruction the
 *    reader is following: clicking a cell on the map retargets the readout, and a reserve derived
 *    from the default choice would be too small the moment they did.
 */
export function readoutReserve(
  recording: readonly CycleTrace[],
  following: boolean,
): ReadoutReserve {
  const lastCycle = recording.length - 1;
  // The pre-run words are always drawable — they are what the shell opens at — and the widest cycle
  // text is the last one with the halted suffix, when there IS a last one. The guard is not
  // decoration: with nothing loaded the shell still renders a bar for one frame, and
  // `counterText(0, -1, true)` would reserve for the sentence `cycle 0 / -1 — halted`, which no
  // cursor can ever show.
  let counter = counterText(-1, lastCycle, false).length;
  if (lastCycle >= 0) {
    counter = Math.max(counter, counterText(lastCycle, lastCycle, true).length);
  }
  let instruction = 0;
  let chip = 0;
  for (const cycle of recording) {
    const count = cycle.instructions.length;
    for (const instr of cycle.instructions) {
      instruction = Math.max(instruction, instructionText(instr).length);
      chip = Math.max(chip, chipText(instr, count, following).length);
    }
  }
  return { counter, instruction, chip };
}
