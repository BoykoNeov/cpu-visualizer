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
 * **M13 step 8 pinned the wording too, and the way it did so is the point.** Step 7 left it unpinned
 * on purpose, so that the vocabulary pass would be a copy edit rather than a test edit. Pinning the
 * new SENTENCES would have re-created that problem one width later. What is pinned instead is a
 * PROPERTY — no pair-shaped COUNT word reaches the reader at any width — plus the two glosses that
 * became ARITHMETIC. Both survive a rewrite of the copy; neither survives a regression to "both".
 *
 * The property is deliberately narrow. It forbids `both`, `partner`, `the pair`, `the younger`,
 * `the older` — phrases that name a two-instruction relation. It does NOT forbid `pairing`: the
 * engine's rules are the pairing rules, `intra-pair-raw` is a `stall.reason` three consumers read,
 * and step 1 pinned that the MECHANISM keeps its historical name because renaming it moves trace
 * bytes for a spelling. Nor does it forbid the numeral `2`, for a reason the first run had to teach
 * — see {@link PAIR_SHAPED}. A term of art, a derived count and a false count are three different
 * things, and only the last is a defect.
 */

import { MAX_ISSUE_WIDTH, SuperscalarProcessor } from '@cpu-viz/engine-superscalar';
import { CACHE_SMALL } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readPairing, type IssueReason, type IssueVerdict } from './pairing-readout';
import { PairingReadout } from './PairingReadoutView';
import { REFUSAL_TEXT } from './SuperscalarDatapathView';
import { EXAMPLE_PROGRAMS } from './programs';
import { loadSource } from './simulator';

/** Enough independent work that the widest machine really does fill every slot. */
const WIDE = Array.from({ length: 8 }, (_, i) => `  addi x${i + 1}, x0, ${i + 1}`).join('\n');

const WIDTHS = Array.from({ length: MAX_ISSUE_WIDTH }, (_, i) => i + 1);

function record(source: string, config: ProcessorConfig): readonly CycleTrace[] {
  const r = loadSource(source, () => new SuperscalarProcessor(), config);
  if (!r.ok) throw new Error('assembly failed: ' + r.errors.map((e) => e.message).join('; '));
  const { recorder } = r.loaded;
  recorder.runToEnd();
  return recorder.recorded;
}

function recordAt(width: number): readonly CycleTrace[] {
  return record(`${WIDE}\n  li a7, 10\n  ecall\n`, {
    ...defaultConfig(),
    forwarding: true,
    issueWidth: width,
  });
}

/**
 * The three refusal provokers, copied from `datapath-superscalar.test.ts` where step 7 rewrote them.
 * They are DENSE on purpose: a program provokes a refusal only if the conflict lands in one issue
 * group, and group boundaries move with the width — the M7 fixtures were spaced for pairs, so
 * `BRANCH_SLOT` emitted no refusal at all at width 3 while refusing at 2 and at 4. That each one
 * still provokes its own rule at every width ≥ 2 is asserted below, not assumed, because it is
 * exactly the condition under which the vocabulary sweep would otherwise be green and blind.
 */
const FIXTURES = [
  `  addi x1, x0, 256\n  addi x2, x0, 7\n  addi x5, x0, 5\n  addi x6, x0, 6\n  sw x2, 0(x1)\n  sw x2, 4(x1)\n  sw x2, 8(x1)\n  sw x2, 12(x1)`,
  `  addi x1, x0, 5\n  addi x2, x1, 6\n  add x3, x1, x2\n  addi x4, x0, 1`,
  `  beq x0, x0, a\na:\n  beq x0, x0, b\nb:\n  beq x0, x0, c\nc:\n  beq x0, x0, d\nd:\n  addi x3, x0, 3`,
];

/** One rendered cycle per verdict and per reason the machine can reach at `width` — the smallest
 *  set of renders that exercises every string this panel can put on screen. */
function surfacesAt(width: number): {
  html: string[];
  verdicts: Set<IssueVerdict>;
  reasons: Set<IssueReason>;
} {
  const byVerdict = new Map<IssueVerdict, CycleTrace>();
  const byReason = new Map<IssueReason, CycleTrace>();
  const sources = [...EXAMPLE_PROGRAMS.map((p) => p.source), ...FIXTURES];
  const recordings: (readonly CycleTrace[])[] = [];
  for (const src of sources) {
    for (const forwarding of [true, false]) {
      const base: ProcessorConfig = { ...defaultConfig(), forwarding, issueWidth: width };
      for (const cfg of [base, { ...base, cache: CACHE_SMALL }]) {
        const rec = record(src, cfg);
        recordings.push(rec);
        for (const t of rec) {
          const r = readPairing(t);
          if (r === null) continue;
          if (!byVerdict.has(r.verdict)) byVerdict.set(r.verdict, t);
          if (r.reason !== null && !byReason.has(r.reason)) byReason.set(r.reason, t);
        }
      }
    }
  }
  const html: string[] = [];
  for (const t of [...byVerdict.values(), ...byReason.values()]) {
    const rec = recordings.find((r) => r.includes(t))!;
    html.push(renderToStaticMarkup(<PairingReadout trace={t} recording={rec} followed={null} />));
  }
  return { html, verdicts: new Set(byVerdict.keys()), reasons: new Set(byReason.keys()) };
}

/**
 * A claim that the group holds exactly TWO. Not a ban on the word "pairing" — see the header — and
 * **not a ban on the numeral 2 either**, which the first draft got wrong and the run caught: the
 * caption legitimately renders "up to 2 instructions may issue together" at width 2, because that
 * number is DERIVED from the machine. A derived two is a fact about the recording; `both` and
 * `partner` are claims about the mechanism. Only the second kind is a defect at any width, and the
 * derived kind is already pinned at all four positions by the caption test above.
 */
const PAIR_SHAPED = /\bboth\b|\bpartner\b|\bthe pair\b|\ba pair\b|\bthe younger\b|\bthe older\b/i;

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

// =================================================================================================
// M13 step 8 — the vocabulary, pinned as a property
// =================================================================================================

describe('the readout says nothing pair-shaped at any width', () => {
  /**
   * The non-vacuity clause, and it carries its own weight rather than riding along: a sweep for
   * absent words is green on a panel that renders nothing at all. Step 7 measured this exact hole
   * one layer up — restoring the caption's literal `2` reddened ZERO of 1535 — so what makes the
   * test below a net is this one asserting that every gloss it is sweeping actually got rendered.
   *
   * The reachable sets differ by width, and that IS the claim: at width 1 no pairing rule can fire
   * (the trace emits no `.n` location and `stageId`'s squash early-return beats the group logic),
   * so `mem-port` / `branch-slot` / `intra-pair-raw` and the `paired` / `refused` verdicts are
   * absent there and present everywhere else. Enumerating them per width is what stops "the sweep
   * covered every reason" from meaning "the sweep covered every reason it happened to find".
   */
  it('every verdict and every reason the machine can reach is actually rendered', () => {
    const NARROW: IssueReason[] = ['flush', 'load-use', 'memory-stall', 'raw'];
    const PAIRING: IssueReason[] = ['branch-slot', 'intra-pair-raw', 'mem-port'];
    for (const w of WIDTHS) {
      const { html, verdicts, reasons } = surfacesAt(w);
      expect(html.length, `width ${w} rendered nothing`).toBeGreaterThan(0);
      expect([...verdicts].sort(), `width ${w} verdicts`).toEqual(
        w === 1 ? ['blocked', 'idle', 'solo'] : ['blocked', 'idle', 'paired', 'refused', 'solo'],
      );
      expect([...reasons].sort(), `width ${w} reasons`).toEqual(
        w === 1 ? NARROW : [...NARROW, ...PAIRING].sort(),
      );
    }
  });

  it('and none of those renders claims the group holds exactly two', () => {
    // The property, at every position. It holds at width 2 as well as at 3 and 4, and that is
    // deliberate rather than incidental: the reworded glosses describe a held instruction's
    // relation to an OLDER GROUP-MATE, which is exactly as true of a pair as of a group of four.
    // A narrower tier that must not contradict a wider one is INV-5's shape, in prose.
    for (const w of WIDTHS) {
      for (const html of surfacesAt(w).html) {
        const hit = PAIR_SHAPED.exec(html);
        expect(hit?.[0], `width ${w} rendered a pair-shaped claim: ${hit?.[0]}`).toBeUndefined();
      }
    }
  });

  it('the datapath header carries the same rule — no `partner` in a refusal caption', () => {
    // `REFUSAL_TEXT` is the one-line version of the same three verdicts, on the other surface, and
    // it was the item step 7 named in its hand-off. Swept here rather than in the datapath's own
    // suite because the claim is about the VOCABULARY, and vocabulary is one property across both
    // surfaces — asserting it twice in two files is how the two would drift apart.
    for (const [reason, text] of Object.entries(REFUSAL_TEXT)) {
      expect(PAIR_SHAPED.exec(text)?.[0], `${reason}: ${text}`).toBeUndefined();
    }
    expect(Object.keys(REFUSAL_TEXT).sort()).toEqual(['branch-slot', 'intra-pair-raw', 'mem-port']);
  });
});

describe('the glosses that became arithmetic', () => {
  /**
   * Step 7's lesson, applied to the two sentences step 8 rewrote: a count is watchable where an
   * adjective is not. These render a group of four issuing together and a refusal holding three
   * back — neither shape exists at width 2, which is why the old wording ("both", "the younger")
   * was not merely imprecise but wrong on the majority of the cycles it described.
   */
  it('a co-issue names how many went, and a refusal names how many are held', () => {
    // Which PROGRAM produces each shape had to be searched for rather than assumed, and the search
    // is why this reads the corpus instead of the 8-independent-`addi` fixture the tests above use:
    // that fixture co-issues four happily and never refuses anyone, so the refusal half of this
    // assertion ran zero times against it and the test passed its co-issue clause while measuring
    // nothing on the clause it was written for.
    const found = new Map<string, { trace: CycleTrace; rec: readonly CycleTrace[] }>();
    for (const src of [...EXAMPLE_PROGRAMS.map((p) => p.source), ...FIXTURES]) {
      const rec = record(src, { ...defaultConfig(), forwarding: true, issueWidth: 4 });
      for (const trace of rec) {
        const r = readPairing(trace)!;
        const held = r.candidates.filter((c) => !c.issued).length;
        const key =
          r.verdict === 'paired' && r.candidates.length === 4
            ? 'co-issue-4'
            : r.verdict === 'refused' && held === 3
              ? 'held-3'
              : null;
        if (key !== null && !found.has(key)) found.set(key, { trace, rec });
      }
    }
    expect([...found.keys()].sort(), 'a shape this test exists for was never produced').toEqual([
      'co-issue-4',
      'held-3',
    ]);

    const render = (k: string): string =>
      renderToStaticMarkup(
        <PairingReadout
          trace={found.get(k)!.trace}
          recording={found.get(k)!.rec}
          followed={null}
        />,
      );
    expect(render('co-issue-4'), 'co-issue count').toContain(
      '4 instructions issued together this cycle',
    );
    const held = render('held-3');
    expect(held, 'refusal count').toContain('1 of 4 issued; 3 held for the next group');
    expect(held, 'refusal note').toContain('The 3 held instructions lead the next issue group');
  });

  it('and the singular survives at width 2, where exactly one is ever held', () => {
    // The other half of a derived string: a plural that is always plural is not derived. Width 2's
    // refusal holds exactly one instruction back by construction, so this is the branch that proves
    // the sentence is built rather than pluralised once and left.
    const rec = record(`  addi x1, x0, 5\n  addi x2, x1, 6\n  li a7, 10\n  ecall\n`, {
      ...defaultConfig(),
      forwarding: true,
      issueWidth: 2,
    });
    const refused = rec.find((t) => readPairing(t)!.verdict === 'refused');
    expect(refused, 'no refusal provoked at width 2').toBeDefined();
    const html = renderToStaticMarkup(
      <PairingReadout trace={refused!} recording={rec} followed={null} />,
    );
    expect(html).toContain('1 of 2 issued; 1 held for the next group');
    expect(html).toContain('The held instruction leads the next issue group');
  });
});
