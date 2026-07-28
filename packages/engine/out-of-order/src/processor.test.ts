import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage, MAX_ISSUE_WIDTH } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import { OutOfOrderProcessor, OUT_OF_ORDER_CAPABILITIES } from './index';

/**
 * Step 1a's own pins — the mechanisms `differential.test.ts` (final state only) and
 * `timing.test.ts` (cycle counts only) can't see: the rename map actually renaming, the ROB
 * actually holding values and committing in order, operand capture via the CDB-equivalent
 * (broadcast-then-consume, not stale register reads), strict in-order issue serialization, the
 * mem-port/branch-unit resource contests, halt-with-drain, and the forwarding-inertness contract.
 *
 * Every expectation is hand-derived (see the corresponding case in
 * `M:\claud_projects\temp\m9\step1a-timing-derivation.md`), never copied from a passing run.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

function asm(source: string): AssembledProgram {
  const { program, errors } = assemble(source);
  if (!program) {
    throw new Error(
      'assembly failed:\n' + errors.map((e) => `  ${e.line}:${e.column} ${e.message}`).join('\n'),
    );
  }
  return program;
}

function readCorpus(file: string): AssembledProgram {
  return asm(readFileSync(PROGRAMS_DIR + file, 'utf8'));
}

function run(program: AssembledProgram, config: ProcessorConfig, maxCycles = 2000): CycleTrace[] {
  const p = new OutOfOrderProcessor();
  p.reset(toProgramImage(program), config);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    if (traces.length >= maxCycles) throw new Error('exceeded maxCycles — runaway loop?');
    traces.push(p.step());
  }
  return traces;
}

const DEFAULT: ProcessorConfig = { ...defaultConfig(), issueWidth: 2 };

/** The cycle a `type`-matching event first fires for a given `instr` id, or undefined. */
function cycleOfEvent(ts: CycleTrace[], type: string, instr: string): number | undefined {
  for (const t of ts) {
    for (const e of t.events) {
      if (e.type === type && 'instr' in e && e.instr === instr) return t.cycle;
    }
  }
  return undefined;
}

/** The `instr` id of the Nth `instr-fetch` event across the run (0-indexed, program order). */
function fetchedId(ts: CycleTrace[], n: number): string {
  const ids: string[] = [];
  for (const t of ts) {
    for (const e of t.events) {
      if (e.type === 'instr-fetch') ids.push(e.instr);
    }
  }
  const id = ids[n];
  if (id === undefined) throw new Error(`fewer than ${n + 1} instructions fetched`);
  return id;
}

describe('capabilities', () => {
  it('declares the pinned stance on every knob', () => {
    expect(OUT_OF_ORDER_CAPABILITIES).toEqual({
      model: 'out-of-order',
      pipelined: true,
      hasHazards: true,
      configurableForwarding: false,
      configurableBranchPrediction: true,
      configurableCache: true,
      configurableIssueWidth: true,
      configurableOutOfOrder: true,
    });
  });
});

describe('rename + ROB commit — basic correctness', () => {
  it('runs a straight-line program to completion with the right final register values', () => {
    const ts = run(
      asm(['.text', 'addi x1, x0, 5', 'addi x2, x0, 7', 'add x3, x1, x2', 'ecall'].join('\n')),
      DEFAULT,
    );
    const last = ts[ts.length - 1]!;
    expect(last.state.registers[1]).toBe(5);
    expect(last.state.registers[2]).toBe(7);
    expect(last.state.registers[3]).toBe(12);
    expect(last.state.halted).toBe(true);
  });

  it('commits strictly in program order even though nothing here completes out of order', () => {
    const ts = run(
      asm(['.text', 'addi x1, x0, 1', 'addi x2, x0, 2', 'addi x3, x0, 3', 'ecall'].join('\n')),
      DEFAULT,
    );
    const retireOrder: string[] = [];
    for (const t of ts) {
      for (const e of t.events) if (e.type === 'instr-retire') retireOrder.push(e.instr);
    }
    // Fetch order IS program order (INV-4 ids are assigned at fetch), so retire order must match it.
    const fetchOrder: string[] = [];
    for (const t of ts) {
      for (const e of t.events) if (e.type === 'instr-fetch') fetchOrder.push(e.instr);
    }
    expect(retireOrder).toEqual(fetchOrder);
  });
});

describe('operand capture via the CDB-equivalent (case 2 of the derivation worksheet)', () => {
  it('a dependent ALU pair executes exactly one cycle apart — the RAW resolves without a rule', () => {
    // Both operands of the producer are x0 (always ready), so it never itself stalls; the
    // consumer's rs1 is the producer's own destination.
    const program = asm(['.text', 'add x1, x0, x0', 'add x2, x1, x0', 'ecall'].join('\n'));
    const ts = run(program, DEFAULT);
    const producer = fetchedId(ts, 0);
    const consumer = fetchedId(ts, 1);
    const producerCycle = cycleOfEvent(ts, 'alu-op', producer);
    const consumerCycle = cycleOfEvent(ts, 'alu-op', consumer);
    expect(producerCycle).toBeDefined();
    expect(consumerCycle).toBeDefined();
    expect(consumerCycle! - producerCycle!).toBe(1);
  });

  it('an independent ALU pair co-issues in the same cycle (case 1)', () => {
    const program = asm(['.text', 'add x1, x0, x0', 'add x2, x0, x0', 'ecall'].join('\n'));
    const ts = run(program, DEFAULT);
    const a = fetchedId(ts, 0);
    const b = fetchedId(ts, 1);
    expect(cycleOfEvent(ts, 'alu-op', a)).toBe(cycleOfEvent(ts, 'alu-op', b));
  });
});

describe('issue-time resource contests (case 3 of the derivation worksheet)', () => {
  it('two adjacent branches serialize on the single branch unit — paired-branches.s', () => {
    const ts = run(readCorpus('paired-branches.s'), DEFAULT);
    const first = fetchedId(ts, 0);
    const second = fetchedId(ts, 1);
    const firstCycle = cycleOfEvent(ts, 'branch-resolved', first);
    const secondCycle = cycleOfEvent(ts, 'branch-resolved', second);
    expect(firstCycle).toBeDefined();
    expect(secondCycle).toBeDefined();
    expect(secondCycle! - firstCycle!).toBe(1);
    // Neither branch is taken, so nothing is flushed and a0 falls through to 42 (the program's
    // own witness value).
    const last = ts[ts.length - 1]!;
    expect(last.state.registers[10]).toBe(42); // a0 = x10
  });
});

describe('strict in-order issue (case 5 of the derivation worksheet)', () => {
  it('an independent trailing instruction rides along once the stall it waited behind clears', () => {
    // A: producer. B: depends on A (stalls). C: independent of both.
    const program = asm(
      ['.text', 'add x1, x0, x0', 'add x2, x1, x0', 'add x3, x0, x0', 'ecall'].join('\n'),
    );
    const ts = run(program, DEFAULT);
    const b = fetchedId(ts, 1);
    const c = fetchedId(ts, 2);
    expect(cycleOfEvent(ts, 'alu-op', b)).toBe(cycleOfEvent(ts, 'alu-op', c));
  });
});

describe('halt-with-drain', () => {
  it('drains cleanly on a program whose ecall is followed by live code (call-return.s)', () => {
    expect(() => run(readCorpus('call-return.s'), DEFAULT)).not.toThrow();
  });

  it('is halted from the start on a program with no text', () => {
    const p = new OutOfOrderProcessor();
    p.reset(toProgramImage(asm('.text')), DEFAULT);
    expect(p.isHalted()).toBe(true);
    expect(() => p.step()).toThrow(/halted/);
  });
});

/**
 * The CDB broadcast IS the forward path (file header) — there is no principled off-position, so
 * the flag must be provably inert: byte-identical whole-trace regardless of its value, the same
 * discipline `issueWidth`/the OoO cluster get pinned with on every OTHER model
 * (`packages/engine/pipeline/src/processor.test.ts`'s `issueWidth (M7 step 1)` block).
 */
describe('forwarding (M9 step 1a): no off-position', () => {
  it('is inert — the whole trace is identical whether forwarding is true or false', () => {
    const program = readCorpus('array-sum.s');
    const at = (forwarding: boolean): CycleTrace[] => run(program, { ...DEFAULT, forwarding });
    expect(at(true)).toEqual(at(false));
  });

  it('declares it does not honor the knob', () => {
    expect(OUT_OF_ORDER_CAPABILITIES.configurableForwarding).toBe(false);
  });
});

/**
 * The two structural-capacity knobs must fail fast, not livelock (M9+M10 review finding 6). Both
 * are public API bare optional numbers, and 0 (or negative) hangs silently: `robSize: 0` makes
 * `Rob.hasRoom` permanently false so dispatch never proceeds; `numMshrs: 0` (with a cache) makes the
 * MSHR gate permanently full so the first miss never completes — each spins to the recorder's cycle
 * cap and throws a misleading "non-terminating program?". `reset()` guards them the same way it
 * already guarded `issueWidth`; this pins all three (the `issueWidth` guard shipped untested).
 */
describe('config validation: fail fast rather than livelock', () => {
  const program = asm('li a7, 10\necall');
  const reset = (config: ProcessorConfig): void => {
    new OutOfOrderProcessor().reset(toProgramImage(program), config);
  };

  it('rejects issueWidth < 1', () => {
    // M13 step 6 moved width to its OWN guard (`boundedIssueWidth`), so its message no longer
    // reads "is not a positive whole capacity" like the two knobs below — the range is now part
    // of what it says. Matched on the knob name and the value, which is the part that must not
    // drift; the sibling assertions keep the old wording because THEIR guard is unchanged, and
    // that difference is the point (width acquired an upper bound, robSize/numMshrs must not).
    expect(() => reset({ ...DEFAULT, issueWidth: 0 })).toThrow(/issueWidth 0 is not a whole/);
  });

  it('rejects robSize < 1 (would livelock: dispatch never proceeds)', () => {
    expect(() => reset({ ...DEFAULT, robSize: 0 })).toThrow(/robSize 0 is not a positive/);
  });

  it('rejects numMshrs < 1 (would livelock: the first miss never completes)', () => {
    expect(() => reset({ ...DEFAULT, numMshrs: 0 })).toThrow(/numMshrs 0 is not a positive/);
  });

  it('accepts the minimal positive values (robSize 1, numMshrs 1, issueWidth 1)', () => {
    expect(() => reset({ ...DEFAULT, robSize: 1, numMshrs: 1, issueWidth: 1 })).not.toThrow();
  });

  /**
   * The three tests above pinned the guard against the value someone thought of, and the guard was
   * spelled `x < 1` — which lets through the two shapes that reach the SAME livelock by another
   * road. `NaN < 1` is false, and `NaN` then makes `length < NaN` false forever, so dispatch never
   * proceeds; `1.5 < 1` is false, and a fractional capacity is not a capacity. Found by the M11+M12
   * review as finding 3: a fix from the previous review, landed with a test, still wrong.
   */
  it.each([
    ['NaN', Number.NaN],
    ['a fraction', 1.5],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s in every structural-capacity knob', (_label, value) => {
    expect(() => reset({ ...DEFAULT, issueWidth: value })).toThrow(/issueWidth .* is not a whole/);
    expect(() => reset({ ...DEFAULT, robSize: value })).toThrow(/robSize .* is not a positive/);
    expect(() => reset({ ...DEFAULT, numMshrs: value })).toThrow(/numMshrs .* is not a positive/);
  });

  /**
   * **The UPPER bound (M13 step 6), and the two things it has to get right.**
   *
   * The bound is `MAX_ISSUE_WIDTH`, imported from `@cpu-viz/engine-common` — the same constant the
   * superscalar enforces, moved down there in this step precisely so this model could share it
   * (eslint forbids importing the superscalar's copy). Pinned with the user: the shell's ISSUE
   * control is SHARED between the two models, and gating its positions per model would not have
   * closed the hazard — `useSimulator` hands its width to whatever engine is driving, so a reader
   * at superscalar width 4 switching to this model would hand it an unbounded width whatever the
   * widget offered.
   *
   * **Derived, never typed `4`.** A literal here would let someone raise the constant and leave
   * this model's bound behind — silently, since a wider width still runs. The `+ 1` cell is what
   * separates "the guard is enforced" from "the constant is exported": step 1's precedent on the
   * superscalar, where the one edit that can tell them apart is a guard reading
   * `MAX_ISSUE_WIDTH - 1` while the constant stays 4.
   *
   * **What makes 3 and 4 acceptable is not this test.** It is step 6's dump (792 cells: corpus ×
   * widths 1..4 × both issue orders × 3 schemes × 3 cache geometries, every one terminating and
   * architecturally equal to the reference) plus the widened transplant in `timing.test.ts` and the
   * widened matrix in `differential.test.ts`, all in this commit. A guard that admits a width
   * nothing measures is the untested surface the bound exists to prevent.
   */
  it('accepts every width up to MAX_ISSUE_WIDTH and rejects the one past it', () => {
    for (let w = 1; w <= MAX_ISSUE_WIDTH; w++) {
      expect(() => reset({ ...DEFAULT, issueWidth: w }), `width ${w}`).not.toThrow();
    }
    expect(() => reset({ ...DEFAULT, issueWidth: MAX_ISSUE_WIDTH + 1 })).toThrow(
      /issueWidth .* is not a whole/,
    );
  });

  /**
   * And `slowOpLatency` is deliberately NOT guarded, asserted rather than left to be rediscovered
   * as an omission: every use of it sits behind a `>= 2` test, so a zero or a fraction makes the
   * machine defer nothing. Inert, not stuck — the opposite of the three above.
   */
  it('leaves slowOpLatency unguarded, because a bad value there is inert', () => {
    for (const slowOpLatency of [0, 1.5, Number.NaN]) {
      expect(() => reset({ ...DEFAULT, slowOpLatency })).not.toThrow();
    }
  });
});
