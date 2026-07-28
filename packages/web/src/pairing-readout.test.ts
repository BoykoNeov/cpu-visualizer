/**
 * **M7 step 8 — the pairing readout and the IPC tile.**
 *
 * Every expectation below was OBSERVED FIRST: the trace dumped, the cycle read, and only then
 * written down. That is house policy earned four times over in this milestone, and it is what
 * produced this file's central test — {@link "the freeze"} — because the naive readout rule passed
 * every hand-reasoned case and then lied for eleven consecutive cycles on the flagship cache
 * program. Reasoning would not have found it; dumping did.
 *
 * The suite is organised around the one thing that can go wrong: **claiming instructions issued
 * together when they did not.** A false `paired` is the defect this panel exists to avoid, so the
 * four shapes that can produce one (refusal, ordinary hazard, flush, miss-freeze) each get a test
 * pinned to a real cycle, and the identity the whole design rests on gets its own guard.
 *
 * **M13 step 8 widened it from the two-wide machine to all four positions**, and the sections below
 * split accordingly: the M7 cases stay pinned to their observed width-2 cycles (an observed cycle
 * number is only valid for the config it was observed in — this file learned that the hard way, see
 * the flush case), while the group shapes, the reason lookup and the IPC tile grew width-derived
 * sweeps. The two shapes width 2 cannot build at all are a co-issue of more than two and a refusal
 * that holds more than one instruction back; both are what the view's prose now has to describe.
 */

import { MAX_ISSUE_WIDTH, SuperscalarProcessor } from '@cpu-viz/engine-superscalar';
import { CACHE_SMALL } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import {
  readIpc,
  readPairing,
  readPairingPreRun,
  REASON_TEXT,
  type IssueReason,
} from './pairing-readout';
import { EXAMPLE_PROGRAMS } from './programs';
import { loadSource } from './simulator';

const W2: ProcessorConfig = { ...defaultConfig(), forwarding: true, issueWidth: 2 };

/** Every width the guard admits, DERIVED — the same rule `halt-shadow.test.ts` and the conformance
 *  matrix follow, so raising `MAX_ISSUE_WIDTH` cannot leave the widest machine the least tested. */
const WIDTHS = Array.from({ length: MAX_ISSUE_WIDTH }, (_, i) => i + 1);

/** Record a whole run and hand back every cycle. */
function record(source: string, config: ProcessorConfig = W2): readonly CycleTrace[] {
  const r = loadSource(source, () => new SuperscalarProcessor(), config);
  if (!r.ok) throw new Error('assembly failed: ' + r.errors.map((e) => e.message).join('; '));
  const { recorder } = r.loaded;
  recorder.runToEnd();
  return recorder.recorded;
}

function program(name: string): string {
  const p = EXAMPLE_PROGRAMS.find((x) => x.name === name);
  if (!p) throw new Error(`no such example program: ${name}`);
  return p.source;
}

// =================================================================================================
// The four ways an issue can fail to be a pairing — each pinned to an observed cycle
// =================================================================================================

describe('the issue verdict, read off real cycles', () => {
  it('paired — both ID occupants issue, and the readout says so', () => {
    // The clean case. `addi`/`addi` with no shared register: neither uses the memory port, neither
    // is a transfer, and the younger reads nothing the older writes.
    const ts = record(`.text
addi x1, x0, 1
addi x2, x0, 2
ecall
`);
    // Cycle 1 is where the first pair sits in ID (cycle 0 is their fetch) — observed, not assumed.
    const r = readPairing(ts[1]!)!;
    expect(r.verdict).toBe('paired');
    expect(r.reason).toBeNull();
    expect(r.candidates.map((c) => c.id)).toEqual(['i0', 'i1']);
    expect(r.candidates.every((c) => c.issued)).toBe(true);
  });

  it('refused (mem-port) — the older goes, the younger does not, and progress continues', () => {
    const ts = record(`.text
addi x1, x0, 256
addi x4, x0, 4
sw x1, 0(x1)
sw x1, 4(x1)
ecall
`);
    const r = readPairing(ts[2]!)!;
    expect(r.verdict).toBe('refused');
    expect(r.reason).toBe('mem-port');
    // The load-bearing half of "refused": the machine did NOT stop. i2 issued, i3 did not.
    expect(r.candidates.map((c) => [c.id, c.issued])).toEqual([
      ['i2', true],
      ['i3', false],
    ]);
  });

  it('refused (intra-pair-raw) — at BOTH forwarding settings, because no network can fix it', () => {
    const src = `.text
addi x1, x0, 1
addi x2, x1, 2
ecall
`;
    for (const forwarding of [true, false]) {
      const r = readPairing(record(src, { ...W2, forwarding })[1]!)!;
      expect(r.verdict).toBe('refused');
      expect(r.reason).toBe('intra-pair-raw');
    }
  });

  it('refused (branch-slot) — two control transfers, one branch unit', () => {
    const ts = record(`.text
addi x1, x0, 1
addi x2, x0, 2
bne x1, x1, done
jal x0, done
done:
addi x3, x0, 3
ecall
`);
    const r = readPairing(ts[2]!)!;
    expect(r.verdict).toBe('refused');
    expect(r.reason).toBe('branch-slot');
    // Slot 0 is never refused for a PAIRING reason — that is what makes forward progress safe.
    expect(r.candidates[0]!.issued).toBe(true);
  });

  it('blocked (load-use) — the stall names the OLDER, so nobody issues at all', () => {
    // The distinction the `refused`/`blocked` split exists for: here the stall lands on the ID.0
    // occupant, so the whole group is held, not merely un-paired. Observed on array-sum cycle 4.
    const ts = record(program('array-sum'));
    const r = readPairing(ts[4]!)!;
    expect(r.verdict).toBe('blocked');
    expect(r.reason).toBe('load-use');
    expect(r.candidates.every((c) => !c.issued)).toBe(true);
  });

  it('blocked (flush) — a squashed pair emits no stall event, so the reason is derived', () => {
    // Cycle 8 of the NO-CACHE run, dumped and read. Worth recording how this expectation was first
    // written wrong: it originally cited cycle 18, observed in the CACHE-ON dump, and asserted
    // against a cache-off recording — where 18 is an ordinary `load-use` stall. It failed loudly,
    // but the same slip on a cycle that happened to agree would have passed while demonstrating
    // nothing. An observed cycle number is only valid for the CONFIG it was observed in.
    const ts = record(program('array-sum'));
    const r = readPairing(ts[8]!)!;
    expect(r.candidates.map((c) => c.id)).toEqual(['i10', 'i11']);
    expect(r.verdict).toBe('blocked');
    expect(r.reason).toBe('flush');
    // ...and the derivation was necessary: no stall event named either of them.
    expect(ts[8]!.events.some((e) => e.type === 'stall')).toBe(false);
  });
});

// =================================================================================================
// THE FREEZE — the case that disproved the naive rule, and the reason this panel reads `micro.idEx`
// =================================================================================================

describe('the freeze — where "no stall event ⇒ they paired" lies', () => {
  /**
   * `array-sum.s` at width 2 with the small cache: cycles 6–14 hold `ID.0=i5, ID.1=i6` frozen by a
   * d-cache miss. A miss-freeze emits NO `stall` event (the M6 finding), so a readout keyed on event
   * absence announces "paired, issuing together" for all nine — while nothing in the machine moves.
   */
  const frozen = () => record(program('array-sum'), { ...W2, cache: CACHE_SMALL });

  it('reports blocked, never paired, for every cycle of the freeze', () => {
    const ts = frozen();
    for (let c = 6; c <= 14; c++) {
      const r = readPairing(ts[c]!)!;
      expect(r.verdict, `cycle ${c}`).toBe('blocked');
      expect(r.reason, `cycle ${c}`).toBe('memory-stall');
      // The pair really is standing there — this is not "ID happened to be empty".
      expect(
        r.candidates.map((x) => x.id),
        `cycle ${c}`,
      ).toEqual(['i5', 'i6']);
    }
  });

  it('and none of those cycles carries a stall event — the naive rule had nothing to go on', () => {
    // Provoking the hole in the OTHER direction: this is what makes the test above a real guard
    // rather than a restatement. If a future change made the freeze emit a stall, this fails and
    // the comment above stops being true.
    const ts = frozen();
    for (let c = 6; c <= 14; c++) {
      expect(
        ts[c]!.events.some((e) => e.type === 'stall'),
        `cycle ${c}`,
      ).toBe(false);
    }
  });
});

// =================================================================================================
// The identity the design rests on — guarded, not assumed
// =================================================================================================

describe('micro.idEx@N is exactly the EX occupants at N+1', () => {
  /**
   * This is the licence for reading `micro` in a per-cycle panel at all, and it was established by
   * exhaustive dump before a line of the fold was written. It is guarded here because it is a
   * property of the ENGINE that this VIEW depends on: if a future stage-walk change broke it,
   * `readPairing` would start reporting issues that never happened, and nothing else in the suite
   * would notice — the failure is silent by construction.
   *
   * **M13 step 8 widened it from `[1, 2]` to every width the guard admits, and that is the single
   * most load-bearing line the step changed.** Step 6 opened the control to four positions in the
   * web app; this identity — the one assumption the panel cannot detect the failure of — had still
   * never been evaluated above width 2. A design whose licence is verified only on the narrow
   * machine is exactly the shape M13 keeps finding (step 5's fixture that peaked at 11, step 6's
   * half-dead `loadInto` toggle): not a wrong answer, an unasked question.
   */
  it('holds across the corpus at every width the guard admits, cache on and off', () => {
    for (const p of EXAMPLE_PROGRAMS) {
      for (const issueWidth of WIDTHS) {
        for (const withCache of [false, true]) {
          const base: ProcessorConfig = { ...W2, issueWidth };
          const ts = record(p.source, withCache ? { ...base, cache: CACHE_SMALL } : base);
          for (let n = 0; n < ts.length - 1; n++) {
            const micro = ts[n]!.state.micro as { idEx: readonly ({ instr: string } | null)[] };
            const issued = micro.idEx.map((l) => l?.instr ?? null);
            const inEx = issued.map(
              (_, s) => ts[n + 1]!.instructions.find((i) => i.location === `EX.${s}`)?.id ?? null,
            );
            expect(issued, `${p.name} w${issueWidth} cache=${withCache} cycle ${n}`).toEqual(inEx);
          }
        }
      }
    }
  });
});

// =================================================================================================
// M13 step 8 — the GROUP shapes width 2 cannot build, and the reason lookup that stops being
// structural above it
// =================================================================================================

describe('the group at N lanes', () => {
  /**
   * The measurement that made step 8 a code change rather than a copy edit. The view's verdict
   * glosses used to read "both issued together this cycle" and "the older issued; the younger waits
   * a cycle" — sentences about exactly two instructions. This pins that the machine produces groups
   * those sentences cannot describe, so a future edit that re-hardcodes "both" has something
   * standing against it beyond a comment.
   *
   * Asserted as SHAPES rather than exact counts: the histogram (26 paired cycles at width 4, of
   * which 22 hold three and 4 hold four) is a fact about today's corpus and would move if a program
   * were added, whereas "width 4 co-issues more than two, and never exactly two" is the claim the
   * prose actually depends on.
   */
  it('at width 4 a co-issue is NEVER a pair — measured, not assumed', () => {
    const sizes = new Set<number>();
    for (const p of EXAMPLE_PROGRAMS) {
      for (const t of record(p.source, { ...W2, issueWidth: 4 })) {
        const r = readPairing(t)!;
        if (r.verdict === 'paired') sizes.add(r.candidates.length);
      }
    }
    // Non-vacuity first: the corpus really does co-issue at width 4.
    expect(sizes.size, 'no paired cycle at width 4 at all').toBeGreaterThan(0);
    expect([...sizes].sort()).toEqual([3, 4]);
  });

  it('and a refusal holds MORE THAN ONE instruction back, which width 2 cannot do', () => {
    // Width 2's group has exactly one possible refusee, so `held === 1` is a structural certainty
    // there and the old singular sentence could never be wrong. From width 3 it is contingent —
    // and at width 4 the corpus holds three back on 51 cycles against one back on 41, so the
    // singular was wrong on the MAJORITY of the cycles it described.
    const heldAt = (w: number): Set<number> => {
      const s = new Set<number>();
      for (const p of EXAMPLE_PROGRAMS) {
        for (const t of record(p.source, { ...W2, issueWidth: w })) {
          const r = readPairing(t)!;
          if (r.verdict === 'refused') s.add(r.candidates.filter((c) => !c.issued).length);
        }
      }
      return s;
    };
    expect([...heldAt(2)]).toEqual([1]); // the world the old prose was written in
    expect([...heldAt(4)].sort()).toEqual([1, 2, 3]); // the world it now has to describe
  });

  /**
   * `reasonFor` takes the FIRST `stall` event naming a group member. At width 2 that cannot be
   * ambiguous — one refusee, so at most one reason to attribute. From width 3 the group has several
   * younger members, and "the panel silently picks one of two rules" becomes a reachable defect
   * rather than an impossible one. It does not happen, because the engine emits at most one stall
   * per cycle (`stageId` breaks out of the group on a refusal, pinned in
   * `datapath-superscalar.test.ts`); this is the READOUT's own version of the claim, scoped to the
   * ID group the panel actually filters on, and swept at every width.
   *
   * Recorded so nobody re-chases it: the measurement came back ZERO over the corpus plus the three
   * refusal fixtures × 4 widths × forwarding × cache, which is why step 8 left the single-reason
   * shape alone instead of attributing a reason per candidate.
   */
  it('never has two distinct stall reasons to choose between — so "the first" is total', () => {
    for (const p of EXAMPLE_PROGRAMS) {
      for (const issueWidth of WIDTHS) {
        for (const forwarding of [true, false]) {
          const base: ProcessorConfig = { ...W2, issueWidth, forwarding };
          for (const cfg of [base, { ...base, cache: CACHE_SMALL }]) {
            for (const t of record(p.source, cfg)) {
              const r = readPairing(t)!;
              const here = new Set(r.candidates.map((c) => c.id));
              const reasons = new Set<string>();
              for (const e of t.events) if (e.type === 'stall' && here.has(e.instr)) reasons.add(e.reason); // prettier-ignore
              expect(reasons.size, `${p.name} w${issueWidth} fwd=${forwarding} cycle ${t.cycle}`).toBeLessThanOrEqual(1); // prettier-ignore
            }
          }
        }
      }
    }
  });
});

// =================================================================================================
// Width 1 — an honest machine, not a blank panel
// =================================================================================================

describe('width 1', () => {
  it('shows the readout, and its verdict is solo — pairing failure at its limit', () => {
    const ts = record(program('array-sum'), { ...W2, issueWidth: 1 });
    const r = readPairing(ts[1]!)!;
    expect(r.width).toBe(1);
    expect(r.candidates).toHaveLength(1);
    expect(r.verdict).toBe('solo');
  });

  it('never reports paired anywhere in any corpus program — a 1-wide machine cannot pair', () => {
    // The width axis proven lawful rather than argued, the same shape `datapath-superscalar.test.ts`
    // uses for hiding lane 1.
    for (const p of EXAMPLE_PROGRAMS) {
      for (const t of record(p.source, { ...W2, issueWidth: 1 })) {
        expect(readPairing(t)!.verdict, `${p.name} cycle ${t.cycle}`).not.toBe('paired');
      }
    }
  });

  it('and width 2 DOES pair on the same programs — so the toggle is a real machine change', () => {
    // The counterpart that stops the test above from passing vacuously.
    const paired = record(program('sum-loop')).filter((t) => readPairing(t)!.verdict === 'paired');
    expect(paired.length).toBeGreaterThan(0);
  });
});

// =================================================================================================
// IPC — view-derived (INV-2), whole-recording, hand-checked
// =================================================================================================

describe('the IPC tile', () => {
  it('sum-loop: 34 retires over 56 cycles at width 1, over 44 at width 2', () => {
    // Hand-checkable and hand-checked: the retire count is the program's dynamic instruction count
    // and is width-INVARIANT (in-order retirement), so the whole move comes from the denominator.
    // The cycle counts are step 4's pinned figures at forwarding ON.
    const w1 = readIpc(record(program('sum-loop'), { ...W2, issueWidth: 1 }));
    const w2 = readIpc(record(program('sum-loop'), { ...W2, issueWidth: 2 }));

    expect(w1).toMatchObject({ retired: 34, cycles: 56 });
    expect(w2).toMatchObject({ retired: 34, cycles: 44 });
    expect(w1.ipc).toBeCloseTo(34 / 56, 6);
    expect(w2.ipc).toBeCloseTo(34 / 44, 6);
    // The acceptance line: IPC rises between the two widths.
    expect(w2.ipc).toBeGreaterThan(w1.ipc);
  });

  it('IPC rises with width on every corpus program, and never exceeds the width', () => {
    for (const p of EXAMPLE_PROGRAMS) {
      const w1 = readIpc(record(p.source, { ...W2, issueWidth: 1 }));
      const w2 = readIpc(record(p.source, { ...W2, issueWidth: 2 }));
      expect(w2.retired, p.name).toBe(w1.retired); // in-order retirement — the numerator cannot move
      expect(w2.ipc, p.name).toBeGreaterThan(w1.ipc);
      expect(w2.ipc, p.name).toBeLessThanOrEqual(2);
      expect(w1.ipc, p.name).toBeLessThanOrEqual(1);
    }
  });

  /**
   * **The tile at four positions, and the claim had to be NARROWED rather than swept wider** (M13
   * step 8). The test above asserts a STRICT rise 1 → 2 on every program; the obvious extension —
   * strict rise at every position — is simply false. Measured across the corpus: nine of eleven
   * programs are IPC-identical at widths 3 and 4, and `add`/`paired-branches` are already flat from
   * 2 to 3. Relaxing the strict `>` to `>=` corpus-wide would not rescue it either, and this
   * milestone has paid for that once already (step 6: `<=` between widths 3 and 4 is satisfied by an
   * engine that ignores the toggle entirely).
   *
   * So the claim is split into the two halves that are separately true and separately falsifiable:
   * a UNIVERSAL ceiling-and-monotonicity claim over every program and width, and a STRICT rise
   * pinned to the one program that moves at every position, BY NAME. `slow-op-loop` is that program
   * — 0.682 → 0.857 → 0.882 → 0.909 — and it is the same name step 6 had to adopt for the seam
   * fixture, for the same reason: `sum-loop` and `array-sum` are structurally blind to the 3 → 4
   * flip and would have made a width-4 test into a width-3 measurement.
   */
  it('never exceeds the width and never falls as the width rises — at all four positions', () => {
    for (const p of EXAMPLE_PROGRAMS) {
      const byWidth = WIDTHS.map((w) => readIpc(record(p.source, { ...W2, issueWidth: w })));
      for (const [i, v] of byWidth.entries()) {
        const w = WIDTHS[i]!;
        expect(v.ipc, `${p.name} w${w} exceeds its own width`).toBeLessThanOrEqual(w);
        // In-order retirement: width changes how LONG a program takes, never how much it runs.
        expect(v.retired, `${p.name} w${w} retire count moved`).toBe(byWidth[0]!.retired);
        if (i > 0) expect(v.ipc, `${p.name} w${w} fell below w${WIDTHS[i - 1]}`).toBeGreaterThanOrEqual(byWidth[i - 1]!.ipc); // prettier-ignore
      }
    }
  });

  it('slow-op-loop is the one program whose IPC rises at EVERY position — and it is named', () => {
    const ipcs = WIDTHS.map((w) =>
      readIpc(record(program('slow-op-loop'), { ...W2, issueWidth: w })),
    );
    expect(ipcs.map((v) => v.cycles)).toEqual([44, 35, 34, 33]);
    for (let i = 1; i < ipcs.length; i++) {
      expect(ipcs[i]!.ipc, `w${WIDTHS[i]} did not beat w${WIDTHS[i - 1]}`).toBeGreaterThan(ipcs[i - 1]!.ipc); // prettier-ignore
    }
  });

  it('...and the OTHER programs are enumerated as flat, so no width-4 cell implies otherwise', () => {
    // Step 3's rule, applied to the tile: state which of your green columns is blind. A program in
    // this list has the SAME IPC at widths 3 and 4, so any assertion about it at width 4 is a
    // width-3 measurement wearing a width-4 name. Enumerated rather than characterised — step 6's
    // 33 survivors were characterised from memory of the table and the characterisation was wrong.
    const flat: string[] = [];
    for (const p of EXAMPLE_PROGRAMS) {
      const w3 = readIpc(record(p.source, { ...W2, issueWidth: 3 })).ipc;
      const w4 = readIpc(record(p.source, { ...W2, issueWidth: 4 })).ipc;
      if (w3 === w4) flat.push(p.name);
    }
    expect(flat.sort()).toEqual([
      'add',
      'array-sum',
      'array-sum-twice',
      'branch-flavors',
      'byte-loads',
      'call-return',
      'store-forward',
      'strided-sum',
      'sum-loop',
    ]);
    // The complement, said explicitly: exactly two programs pay for the fourth slot.
    expect(EXAMPLE_PROGRAMS.length - flat.length).toBe(2);
  });

  it('divides by the recording LENGTH, not the last cycle number', () => {
    // The 0-indexed transport trap: a 56-cycle run's final cursor reads 55, and dividing by that
    // inflates IPC by a whole cycle's worth. Pinned because the wrong figure looks plausible.
    const ts = record(program('sum-loop'));
    expect(readIpc(ts).cycles).toBe(ts.length);
    expect(ts[ts.length - 1]!.cycle).toBe(ts.length - 1);
  });
});

// =================================================================================================
// Gating and the relief rule
// =================================================================================================

describe('gating', () => {
  it('returns null for a non-superscalar recording — gated on a TRACE fact, not a model id', () => {
    const r = loadSource(program('add'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r.loaded.recorder.runToEnd();
    expect(readPairing(r.loaded.recorder.recorded[0]!)).toBeNull();
  });

  it('every reason the fold can return has a gloss — no raw engine string can reach the screen', () => {
    // The relief-rule analogue for text: a reason with no entry here would render as a bare
    // `mem-port`-style token. Enumerated from the type so a new reason cannot be added silently.
    const all: IssueReason[] = [
      'mem-port',
      'branch-slot',
      'intra-pair-raw',
      'load-use',
      'raw',
      'flush',
      'memory-stall',
    ];
    for (const k of all) expect(REASON_TEXT[k] ?? '').not.toBe('');
  });
});

// =================================================================================================
// The pre-run cursor — a defect only the browser could catch
// =================================================================================================

describe('pre-run (cursor -1, no trace)', () => {
  /**
   * Caught in the browser, and catchable NOWHERE ELSE in this repo: the headless tests are
   * `renderToStaticMarkup` with no jsdom, so no test can scrub a cursor to -1. Keying the panel on
   * the cursor'''s trace made it vanish at pre-run, taking the IPC tile with it — and IPC is a
   * whole-recording figure that is meaningful before the first step. A reader who loads a program,
   * flips the width toggle and never presses step saw nothing at all.
   */
  it('still yields a readout, carrying the width, so the IPC tile survives cycle -1', () => {
    const ts = record(program('sum-loop'));
    const pre = readPairingPreRun(ts)!;
    expect(pre.verdict).toBe('idle');
    expect(pre.width).toBe(2);
    expect(pre.candidates).toEqual([]);
    // ...and the figure it exists to keep on screen is unaffected by having no cursor.
    expect(readIpc(ts)).toMatchObject({ retired: 34, cycles: 44 });
  });

  it('reports the width the RECORDING was made at, not a default', () => {
    // Provoked in both directions: a width-1 recording must say 1. A hardcoded 2 would pass the
    // test above and mislabel every 1-wide run.
    expect(readPairingPreRun(record(program('sum-loop'), { ...W2, issueWidth: 1 }))!.width).toBe(1);
  });

  it('and stays null for a non-superscalar recording — the gate is unchanged', () => {
    const r = loadSource(program('add'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r.loaded.recorder.runToEnd();
    expect(readPairingPreRun(r.loaded.recorder.recorded)).toBeNull();
  });
});
