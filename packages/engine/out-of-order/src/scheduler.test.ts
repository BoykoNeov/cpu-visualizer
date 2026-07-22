import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage, CACHE_LARGE, CACHE_SMALL } from '@cpu-viz/engine-common';
import {
  defaultConfig,
  type CycleTrace,
  type ProcessorConfig,
  type TraceEvent,
} from '@cpu-viz/trace';
import { OutOfOrderProcessor } from './index';

/**
 * Step 1b's own pins — one test per NEW mechanism the out-of-order scheduler adds over 1a's
 * faithful-but-in-order base: true wakeup/select, the non-blocking LSU (MSHR-gated miss-under-
 * miss), memory disambiguation, CDB arbitration under contention, and ROB flush-recovery when the
 * casualty already completed out of order. Every claim that names a specific cycle was WATCHED in
 * a dump first (`docs/plans/m9-tasks.md`'s standing discipline — "a slot is not a stable lane"),
 * never reasoned about in advance; see the step 1b log for the derivations.
 *
 * `timing.test.ts` and `differential.test.ts` stay scoped to the `outOfOrderIssue: false` (1a)
 * baseline they already prove faithful to M3/M7 — this file is the `true` side's net.
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

function run(program: AssembledProgram, config: ProcessorConfig, maxCycles = 500): CycleTrace[] {
  const p = new OutOfOrderProcessor();
  p.reset(toProgramImage(program), config);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    if (traces.length >= maxCycles) throw new Error('exceeded maxCycles — runaway loop?');
    traces.push(p.step());
  }
  return traces;
}

/** The cycle a `type`-matching event first fires for a given `instr` id, or undefined. */
function cycleOfEvent(
  ts: CycleTrace[],
  type: TraceEvent['type'],
  instr: string,
): number | undefined {
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

const OOO: ProcessorConfig = {
  ...defaultConfig(),
  issueWidth: 2,
  outOfOrderIssue: true,
  robSize: 32,
};

describe('the money shot: strictly fewer cycles than 1a, byte-identical architectural results', () => {
  it('array-sum.s under a cache races independent loop iterations ahead of the reduction', () => {
    const program = readCorpus('array-sum.s');
    const config: ProcessorConfig = {
      ...OOO,
      branchPrediction: 'static-taken',
      cache: CACHE_LARGE,
    };
    const outOfOrder = run(program, config);
    const inOrder = run(program, { ...config, outOfOrderIssue: false });

    expect(outOfOrder.length).toBeLessThan(inOrder.length);
    expect(outOfOrder[outOfOrder.length - 1]!.state.registers).toEqual(
      inOrder[inOrder.length - 1]!.state.registers,
    );
    expect(outOfOrder[outOfOrder.length - 1]!.state.memory).toEqual(
      inOrder[inOrder.length - 1]!.state.memory,
    );
  });
});

describe('wakeup/select — a ready younger instruction issues around an older one still waiting', () => {
  it('an independent instruction is not blocked behind a load-dependent consumer', () => {
    // `add t2, t0, x0` depends on the load and cannot issue until the miss resolves; `addi t3`
    // shares no register with anything and is ready the moment it dispatches. In-order issue
    // (1a's policy) stops the whole walk at the first not-ready entry, so `addi t3` waits behind
    // `add t2` regardless of its own readiness; out-of-order issue must not.
    const program = asm(
      [
        '.data',
        'x: .word 7',
        '.text',
        '_start:',
        'la   t0, x',
        'lw   t1, 0(t0)',
        'add  t2, t1, x0',
        'addi t3, x0, 99',
        'li   a7, 10',
        'ecall',
      ].join('\n'),
    );
    const config: ProcessorConfig = { ...OOO, cache: CACHE_SMALL };
    const outOfOrder = run(program, config);
    const inOrder = run(program, { ...config, outOfOrderIssue: false });

    // Expanded stream: 0 lui,1 addi(la),2 lw,3 add t2,4 addi t3 — addi t3 is fetch index 4.
    const addiId = fetchedId(outOfOrder, 4);
    const addId = fetchedId(outOfOrder, 3);

    const addiCycleOoO = cycleOfEvent(outOfOrder, 'alu-op', addiId);
    const addCycleOoO = cycleOfEvent(outOfOrder, 'alu-op', addId);
    expect(addiCycleOoO).toBeDefined();
    expect(addCycleOoO).toBeDefined();
    // The independent addi issues strictly BEFORE the load-dependent add, under out-of-order issue.
    expect(addiCycleOoO!).toBeLessThan(addCycleOoO!);

    const addiCycleInOrder = cycleOfEvent(inOrder, 'alu-op', addiId);
    const addCycleInOrder = cycleOfEvent(inOrder, 'alu-op', addId);
    // Under strict in-order issue, the independent addi cannot pass the still-waiting add: they
    // issue in the SAME cycle the add finally does (both cleared by the same broadcast, exactly
    // 1a's resource-contest walk — co-issuing once unblocked, never ahead of it).
    expect(addiCycleInOrder).toBe(addCycleInOrder);
  });
});

describe('the non-blocking load/store unit — MSHR-gated miss-under-miss', () => {
  it('two independent misses overlap when 2 MSHRs are available, and serialize with only 1', () => {
    const program = asm(
      [
        '.data',
        'a: .word 111',
        '   .word 0, 0, 0, 0', // pad so `b` falls in a DIFFERENT cache line than `a`
        'b: .word 222',
        '.text',
        '_start:',
        'la   t0, a',
        'la   t1, b',
        'lw   t2, 0(t0)',
        'lw   t3, 0(t1)',
        'add  t4, t2, t3',
        'li   a7, 10',
        'ecall',
      ].join('\n'),
    );
    const cache = CACHE_SMALL; // 2 lines — `a` and `b`'s distinct blocks map to distinct lines
    const twoMshrs = run(program, { ...OOO, cache, numMshrs: 2 });
    const oneMshr = run(program, { ...OOO, cache, numMshrs: 1 });

    // Same architectural result either way — MSHR count is a pure timing knob (INV-1/INV-8).
    expect(twoMshrs[twoMshrs.length - 1]!.state.registers).toEqual(
      oneMshr[oneMshr.length - 1]!.state.registers,
    );
    // With only 1 MSHR the second miss cannot even START until the first releases — the misses
    // serialize instead of overlapping, so the run costs strictly more cycles.
    expect(twoMshrs.length).toBeLessThan(oneMshr.length);
  });
});

describe('memory disambiguation', () => {
  it('store-forward.s: a load never bypasses the still-in-flight older store to the same address', () => {
    const program = readCorpus('store-forward.s');
    const ts = run(program, { ...OOO, cache: CACHE_SMALL });
    const last = ts[ts.length - 1]!;
    // Without disambiguation, the load would read `this.memory` before the store's deferred write
    // at commit ever happens, and see the stale 0 the `.data` segment starts with — see
    // `conformance.ts`'s `store-forward.s` oracle for the same claim checked against the reference.
    expect(last.state.registers[10]).toBe(99); // a0
    expect(last.state.halted).toBe(true);
  });
});

describe('CDB arbitration — a contested broadcast, oldest wins, the loser carries over one cycle', () => {
  it('two loads complete the same cycle; the older wins immediately, the younger one cycle later', () => {
    // `missPenalty: 1` and `issueWidth: 1` (a single CDB port) make the collision deterministic
    // and small: the warm-up read (`t2`) primes `b`'s line; `t3` (reads `a`, a compulsory miss)
    // and `t4` (re-reads `b`, now a hit) resolve on the SAME cycle purely from the mem-port
    // issue-order arithmetic — watched in a dump, not reasoned about in advance. `t3` is older
    // (dispatched first) and wins; `t4` loses and must wait one extra cycle to wake its consumer.
    const program = asm(
      [
        '.data',
        'a: .word 111',
        '   .word 0, 0, 0, 0',
        'b: .word 222',
        '.text',
        '_start:',
        'la   t0, a',
        'la   t1, b',
        'lw   t2, 0(t1)',
        'lw   t3, 0(t0)',
        'lw   t4, 0(t1)',
        'add  a0, t3, x0',
        'add  a1, t4, x0',
        'li   a7, 10',
        'ecall',
      ].join('\n'),
    );
    const config: ProcessorConfig = {
      ...defaultConfig(),
      issueWidth: 1,
      outOfOrderIssue: true,
      robSize: 32,
      numMshrs: 2,
      cache: { lineSize: 16, numLines: 4, missPenalty: 1 },
    };
    const ts = run(program, config);

    const t3Id = fetchedId(ts, 5); // 0 lui,1 addi,2 lui,3 addi,4 lw(t2),5 lw(t3)
    const t4Id = fetchedId(ts, 6);
    const consumerOfT3 = fetchedId(ts, 7); // add a0, t3, x0
    const consumerOfT4 = fetchedId(ts, 8); // add a1, t4, x0

    const t3Complete = cycleOfEvent(ts, 'mem-read', t3Id);
    const t4Complete = cycleOfEvent(ts, 'mem-read', t4Id);
    expect(t3Complete).toBeDefined();
    expect(t4Complete).toBeDefined();
    // Both loads' data becomes known in the SAME cycle — the contention this test exists to force.
    expect(t3Complete).toBe(t4Complete);

    const t3ConsumerCycle = cycleOfEvent(ts, 'alu-op', consumerOfT3);
    const t4ConsumerCycle = cycleOfEvent(ts, 'alu-op', consumerOfT4);
    expect(t3ConsumerCycle).toBeDefined();
    expect(t4ConsumerCycle).toBeDefined();
    // The winner's consumer wakes on the very next cycle (the ordinary one-cycle CDB turnaround).
    expect(t3ConsumerCycle!).toBe(t3Complete! + 1);
    // The loser's consumer wakes ONE CYCLE LATER than the winner's — the arbitration's whole
    // observable effect, since the producer's own commit schedule is untouched either way.
    expect(t4ConsumerCycle!).toBe(t3ConsumerCycle! + 1);
  });
});

describe('ROB flush-recovery when the casualty already completed out of order', () => {
  it('a wrong-path instruction that finished BEFORE its branch resolves is still squashed', () => {
    // No branch prediction configured: the front end fetches the fall-through unconditionally.
    // `bnez t1, skip` depends on the slow load and sits `waiting` for a long time; the wrong-path
    // `addi a0, x0, 999` right after it is fully independent and — under out-of-order issue —
    // issues and broadcasts its value LONG before the branch even resolves. When the branch finally
    // resolves taken (t1 = 1, so the load's own miss-latency IS the branch's latency), that
    // already-completed instruction must still be flushed before it can commit.
    const program = asm(
      [
        '.data',
        'x: .word 1',
        '.text',
        '_start:',
        'la   t0, x',
        'lw   t1, 0(t0)',
        'bnez t1, skip',
        'addi a0, x0, 999',
        'skip:',
        'addi a0, x0, 42',
        'li   a7, 10',
        'ecall',
      ].join('\n'),
    );
    const ts = run(program, { ...OOO, cache: CACHE_SMALL });

    const wrongPathId = fetchedId(ts, 4); // 0 lui,1 addi(la),2 lw,3 bnez,4 addi a0,999
    const branchId = fetchedId(ts, 3);

    const wrongPathAluCycle = cycleOfEvent(ts, 'alu-op', wrongPathId);
    const branchResolvedCycle = cycleOfEvent(ts, 'branch-resolved', branchId);
    expect(wrongPathAluCycle).toBeDefined();
    expect(branchResolvedCycle).toBeDefined();
    // The wrong-path instruction genuinely completed OUT OF ORDER, ahead of the branch that
    // condemns it — the scenario this test exists to force, not merely assert.
    expect(wrongPathAluCycle!).toBeLessThan(branchResolvedCycle!);

    // It must never be visible in ANY reg-write event (reg-write fires only at commit, and a
    // flushed entry never reaches the ROB head) — the strong form of "it never happened".
    const a0Writes = ts
      .flatMap((t) => t.events)
      .filter((e) => e.type === 'reg-write' && e.reg === 10);
    for (const w of a0Writes) {
      if (w.type === 'reg-write') expect(w.value).not.toBe(999);
    }
    const last = ts[ts.length - 1]!;
    expect(last.state.registers[10]).toBe(42); // a0: only the correct-path write survives
  });
});

describe('renaming under out-of-order completion — WAW resolves by program order, not by speed', () => {
  it('a fast younger write to the same register wins over a slow older one, in final state', () => {
    // `lw a0` (older, slow — a miss) and `addi a0` (younger, fast, independent) both target a0.
    // The younger instruction's value is known and broadcast long before the load's; only in-order
    // COMMIT — not completion order — decides which write is architecturally visible.
    const program = asm(
      [
        '.data',
        'x: .word 7',
        '.text',
        '_start:',
        'la   t0, x',
        'lw   a0, 0(t0)',
        'addi a0, x0, 55',
        'li   a7, 10',
        'ecall',
      ].join('\n'),
    );
    const ts = run(program, { ...OOO, cache: CACHE_SMALL });

    const loadId = fetchedId(ts, 2);
    const addiId = fetchedId(ts, 3);
    const loadCycle = cycleOfEvent(ts, 'alu-op', loadId); // the address computation, not the data
    const addiCycle = cycleOfEvent(ts, 'alu-op', addiId);
    expect(addiCycle).toBeDefined();
    expect(loadCycle).toBeDefined();
    // The younger instruction genuinely executes first — the race this test needs to be real.
    expect(addiCycle!).toBeLessThan(loadCycle!);

    const last = ts[ts.length - 1]!;
    expect(last.state.registers[10]).toBe(55); // a0: the younger (later-in-program-order) write wins
  });
});

/**
 * INV-8's transitive corollary for step 1b, over the WHOLE corpus rather than the one program the
 * money shot names — the check the plan's own acceptance list doesn't ask for by name but that
 * closes the biggest blind spot left standing: every other correctness assertion above targets ONE
 * hand-built scenario. Out-of-order issue changes TIMING, never the architectural answer (INV-1/
 * INV-8), so `outOfOrderIssue: true` and `false` must compute byte-identical final state on every
 * program — and since `false` (1a) is already proven equal to the golden reference by
 * `differential.test.ts`, this gives `true == reference` transitively across the corpus without
 * waiting for step 2's full config-matrix differential net. One fixed config (static-taken,
 * `CACHE_LARGE`, width 2) is enough: this is a REGRESSION net for a scheduler bug corrupting
 * results, not a search for one — `differential.test.ts` step 2 owns the exhaustive matrix.
 */
describe('out-of-order issue never changes the architectural answer, over the whole corpus', () => {
  const PROGRAMS = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.s'));

  it('the corpus is non-empty (guards the guard below)', () => {
    expect(PROGRAMS.length).toBeGreaterThan(0);
  });

  it.each(PROGRAMS)('%s: true and false compute the same final registers and memory', (file) => {
    const program = readCorpus(file);
    const config: ProcessorConfig = {
      ...defaultConfig(),
      issueWidth: 2,
      branchPrediction: 'static-taken',
      cache: CACHE_LARGE,
      robSize: 32,
    };
    const outOfOrder = run(program, { ...config, outOfOrderIssue: true });
    const inOrder = run(program, { ...config, outOfOrderIssue: false });

    expect(outOfOrder[outOfOrder.length - 1]!.state.registers).toEqual(
      inOrder[inOrder.length - 1]!.state.registers,
    );
    expect(outOfOrder[outOfOrder.length - 1]!.state.memory).toEqual(
      inOrder[inOrder.length - 1]!.state.memory,
    );
  });
});
