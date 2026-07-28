/**
 * **The pairing readout's RENDER seam** — the half `pairing-readout.test.ts` structurally cannot
 * reach, because that file tests the pure module and every string a reader actually sees lives in
 * the TSX.
 *
 * It exists because of a measured negative. M13 step 7 fixed two arity-2 defects in this panel —
 * a lane-hue lookup cast to `0 | 1` (which resolved to `undefined` at slot 2 or 3 and emitted
 * `color: undefined`) and a caption reading a literal "up to 2 instructions", wrong on screen from
 * the moment step 6 opened the control to width 4. Restoring the caption's literal `2` reddened
 * **zero of 1535 tests**. A fix nothing can watch is the shape this milestone keeps finding, so the
 * two claims that are pure ARITHMETIC are pinned here.
 *
 * Deliberately NOT pinned: the wording. `refused`/`blocked`, "the pair in ID" and
 * `REFUSAL_TEXT`'s glosses are pair-shaped prose and belong to step 8's vocabulary pass — pinning
 * them now would make that pass a test edit rather than a copy edit, which is the trap step 6
 * avoided by asserting a tooltip's DISTINCTNESS instead of its words.
 */

import { MAX_ISSUE_WIDTH, SuperscalarProcessor } from '@cpu-viz/engine-superscalar';
import { defaultConfig, type CycleTrace } from '@cpu-viz/trace';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PairingReadout } from './PairingReadoutView';
import { loadSource } from './simulator';

/** Enough independent work that the widest machine really does fill every slot. */
const WIDE = Array.from({ length: 8 }, (_, i) => `  addi x${i + 1}, x0, ${i + 1}`).join('\n');

function recordAt(width: number): readonly CycleTrace[] {
  const r = loadSource(`${WIDE}\n  li a7, 10\n  ecall\n`, () => new SuperscalarProcessor(), {
    ...defaultConfig(),
    forwarding: true,
    issueWidth: width,
  });
  if (!r.ok) throw new Error('assembly failed: ' + r.errors.map((e) => e.message).join('; '));
  const { recorder } = r.loaded;
  recorder.runToEnd();
  return recorder.recorded;
}

describe('the pairing readout at N lanes (M13 step 7)', () => {
  it('the caption names the width the MACHINE ran at, at every offered position', () => {
    // A derived number rather than a typed one. Width 1 keeps its own sentence, because "up to 1
    // instruction may issue together" is not English and the degenerate case deserves the honest
    // line it already had.
    for (let w = 1; w <= MAX_ISSUE_WIDTH; w++) {
      const rec = recordAt(w);
      const html = renderToStaticMarkup(
        <PairingReadout trace={rec[3] ?? null} recording={rec} followed={null} />,
      );
      if (w === 1) {
        expect(html, 'width 1 caption').toContain('issues 1 instruction per cycle');
      } else {
        expect(html, `width ${w} caption`).toContain(`up to ${w} instructions may issue together`);
      }
      // ...and the IPC tile's ceiling is that same width, in the one place it is a number.
      expect(html, `width ${w} ipc ceiling`).toContain(`The ceiling is the issue width, ${w}.`);
    }
  });

  it('a slot badge is tinted for every slot the machine can fill — never `undefined`', () => {
    // The arity-2 lookup this panel shipped with (`LANE_COLORS[c.slot as 0 | 1]`) produced
    // `color: undefined`, which React drops silently: the badge rendered with NO colour at all and
    // nothing failed. Counting distinct lane tints is what a presence check would have missed.
    const rec = recordAt(MAX_ISSUE_WIDTH);
    const tints = new Set<string>();
    for (const trace of rec) {
      const html = renderToStaticMarkup(
        <PairingReadout trace={trace} recording={rec} followed={null} />,
      );
      expect(html, 'a badge rendered with no colour').not.toContain('undefined');
      for (const m of html.matchAll(/var\(--lane-(\d)\)/g)) tints.add(m[1]!);
    }
    expect([...tints].sort()).toEqual(Array.from({ length: MAX_ISSUE_WIDTH }, (_, i) => String(i)));
  });
});
