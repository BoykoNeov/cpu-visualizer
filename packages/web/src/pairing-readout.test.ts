/**
 * **M7 step 8 — the pairing readout and the IPC tile.**
 *
 * Every expectation below was OBSERVED FIRST: the trace dumped, the cycle read, and only then
 * written down. That is house policy earned four times over in this milestone, and it is what
 * produced this file's central test — {@link "the freeze"} — because the naive readout rule passed
 * every hand-reasoned case and then lied for eleven consecutive cycles on the flagship cache
 * program. Reasoning would not have found it; dumping did.
 *
 * The suite is organised around the one thing that can go wrong: **claiming two instructions issued
 * together when they did not.** A false `paired` is the defect this panel exists to avoid, so the
 * four shapes that can produce one (refusal, ordinary hazard, flush, miss-freeze) each get a test
 * pinned to a real cycle, and the identity the whole design rests on gets its own guard.
 */

import { SuperscalarProcessor } from '@cpu-viz/engine-superscalar';
import { CACHE_SMALL } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import { readIpc, readPairing, REASON_TEXT, type IssueReason } from './pairing-readout';
import { EXAMPLE_PROGRAMS } from './programs';
import { loadSource } from './simulator';

const W2: ProcessorConfig = { ...defaultConfig(), forwarding: true, issueWidth: 2 };

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
   */
  it('holds across the corpus at both widths, cache on and off', () => {
    for (const p of EXAMPLE_PROGRAMS) {
      for (const issueWidth of [1, 2]) {
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
