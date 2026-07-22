import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage, CACHE_LARGE } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import { OutOfOrderProcessor } from './index';

/**
 * **M9 step 3 — the per-instruction lifecycle net.** There is no closed form for the out-of-order
 * scheduler (unlike M3's `N+4+S` or M7's `G+L+P+M+4`), so the buildable net is a hand-derived
 * per-instruction lifecycle table: for each instruction, the cycle it dispatches → issues → drives
 * the CDB (or, for a store, commits) → commits, every cell derived from the pinned rules BEFORE
 * being checked against one real run. The full derivation — including why each cell is what it is,
 * the two-miss overlap question, and the mutation check proving this net has teeth — lives in
 * `M:\claud_projects\temp\m9\step3-lifecycle-derivation.md`; this file asserts only what the trace
 * schema actually exposes (see that worksheet's "Observability" section): `lui`/`auipc`/`jal` and
 * `ecall`/`ebreak` issue silently (no `alu-op`) and are NOT asserted at issue — every other cell
 * below is a real event or a `location` transition, not "whatever the engine printed."
 *
 * `timing.test.ts` already pins the `outOfOrderIssue: false` degenerate position against M3/M7's
 * closed forms; this file is scoped to the `true` side only, where no closed form exists.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

function readCorpus(file: string): AssembledProgram {
  const { program, errors } = assemble(readFileSync(PROGRAMS_DIR + file, 'utf8'));
  if (!program) throw new Error('assembly failed: ' + errors.map((e) => e.message).join('; '));
  return program;
}

function run(program: AssembledProgram, config: ProcessorConfig, maxCycles = 200): CycleTrace[] {
  const p = new OutOfOrderProcessor();
  p.reset(toProgramImage(program), config);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    if (traces.length >= maxCycles) throw new Error('exceeded maxCycles — runaway loop?');
    traces.push(p.step());
  }
  return traces;
}

/** The `instr` id of the Nth `instr-fetch` event across the run (0-indexed, fetch order). */
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

/**
 * The id of the instruction that ever occupies ROB tag `tag` — robust against wrong-path
 * speculative fetches (which consume dynamic ids but never dispatch, so a raw fetch-order index
 * would misalign once a program has branches). Dispatch is ALWAYS in program order regardless of
 * `outOfOrderIssue`, so ROB tag number is exactly "how many real (right-path) instructions
 * dispatched before this one" — a stable, index-like handle into the lifecycle table.
 */
function idAtRobTag(ts: CycleTrace[], tag: number): string {
  const want = `ROB#${tag}`;
  for (const t of ts) {
    for (const inst of t.instructions) {
      if (inst.location === want) return inst.id;
    }
  }
  throw new Error(`no instruction ever occupied ${want}`);
}

/** The cycle a `type`-matching event first fires for a given `instr` id, or undefined. */
function cycleOfEvent(
  ts: CycleTrace[],
  type: CycleTrace['events'][number]['type'],
  instr: string,
): number | undefined {
  for (const t of ts) {
    for (const e of t.events) {
      if (e.type === type && 'instr' in e && e.instr === instr) return t.cycle;
    }
  }
  return undefined;
}

/** The first cycle `instr` shows a `ROB#…` location (the dispatch cycle) — see the file header. */
function dispatchCycle(ts: CycleTrace[], instr: string): number | undefined {
  for (const t of ts) {
    for (const inst of t.instructions) {
      if (inst.id === instr && inst.location.startsWith('ROB#')) return t.cycle;
    }
  }
  return undefined;
}

/**
 * The effective address `instr` (a load/store) computed at issue — read off its own `alu-op`
 * event's `result` field (every load/store's address computation goes through `alu('add', …)`).
 */
function addressOf(ts: CycleTrace[], instr: string): number {
  for (const t of ts) {
    for (const e of t.events) {
      if (e.type === 'alu-op' && e.instr === instr) return e.result;
    }
  }
  throw new Error(`no alu-op (address computation) found for ${instr}`);
}

/**
 * The FIRST `cache-access` event at the given address, with its cycle — `cache-access` carries no
 * `instr` field (it's not per-instruction in the schema), so this is keyed by address instead. The
 * first-ever access to a fresh address is necessarily the compulsory miss/hit that address's own
 * load or store causes, which is exactly what the derivation needs here.
 */
function firstCacheAccessAt(
  ts: CycleTrace[],
  addr: number,
): { cycle: number; hit: boolean } | undefined {
  for (const t of ts) {
    for (const e of t.events) {
      if (e.type === 'cache-access' && e.addr === addr) return { cycle: t.cycle, hit: e.hit };
    }
  }
  return undefined;
}

describe('store-forward.s — full lifecycle, width 1, out-of-order, no cache', () => {
  // Worksheet Part 1. 7 dynamic instructions, no branches, so raw fetch order == dispatch order.
  const CONFIG: ProcessorConfig = {
    ...defaultConfig(),
    issueWidth: 1,
    outOfOrderIssue: true,
    cache: null,
    robSize: 16,
  };
  const ts = run(readCorpus('store-forward.s'), CONFIG);
  const id = (n: number): string => fetchedId(ts, n);

  it('runs in exactly 11 cycles (0..10) — the pinned total', () => {
    expect(ts).toHaveLength(11);
  });

  it.each([
    ['i0 (lui t0,hi)', 0, 1, 4],
    ['i1 (addi t0,+lo)', 1, 2, 5],
    ['i2 (addi t1,99)', 2, 3, 6],
    ['i3 (sw t1,0(t0))', 3, 4, 7],
    ['i4 (lw a0,0(t0))', 4, 5, 8],
    ['i5 (addi a7,10)', 5, 6, 9],
    ['i6 (ecall)', 6, 7, 10],
  ])('%s: dispatch@%i, commit@%i', (_label, idx, dispatch, commit) => {
    expect(dispatchCycle(ts, id(idx as number)), 'dispatch').toBe(dispatch);
    expect(cycleOfEvent(ts, 'instr-retire', id(idx as number)), 'commit').toBe(commit);
  });

  it('i1/i2/i3/i4/i5 issue (alu-op) at the derived cycle — i0/i6 issue silently (lui/ecall)', () => {
    expect(cycleOfEvent(ts, 'alu-op', id(1)), 'i1 issue').toBe(3);
    expect(cycleOfEvent(ts, 'alu-op', id(2)), 'i2 issue').toBe(4);
    expect(cycleOfEvent(ts, 'alu-op', id(3)), 'i3 issue (address)').toBe(5);
    expect(cycleOfEvent(ts, 'alu-op', id(4)), 'i4 issue (address)').toBe(6);
    expect(cycleOfEvent(ts, 'alu-op', id(5)), 'i5 issue').toBe(7);
    // i0 (lui) and i6 (ecall) never call alu() in executeEntry — no alu-op exists to assert.
    expect(cycleOfEvent(ts, 'alu-op', id(0))).toBeUndefined();
    expect(cycleOfEvent(ts, 'alu-op', id(6))).toBeUndefined();
  });

  it('the store writes memory at commit (deferred), the same cycle the load reads it', () => {
    // i3 (sw) commits and writes memory the SAME cycle i4 (lw) clears disambiguation and reads it —
    // stageCommit runs before stageMemAccess, so the store's write is already visible.
    expect(cycleOfEvent(ts, 'mem-write', id(3))).toBe(7);
    expect(cycleOfEvent(ts, 'mem-read', id(4))).toBe(7);
    const last = ts[ts.length - 1]!;
    expect(last.state.registers[10]).toBe(99); // a0: disambiguation never let the stale 0 through
  });
});

describe('array-sum.s — the money shot, full lifecycle at the flagship config', () => {
  // Worksheet Part 2. width 2, out-of-order, static-taken, CACHE_LARGE, robSize 32. ROB tag order
  // == dispatch order == program order (dispatch is always in-order), so `idAtRobTag` gives a
  // stable handle per dynamic instruction regardless of the wrong-path fetches every predicted-
  // taken loop iteration provokes and discards.
  const CONFIG: ProcessorConfig = {
    ...defaultConfig(),
    issueWidth: 2,
    outOfOrderIssue: true,
    branchPrediction: 'static-taken',
    cache: CACHE_LARGE,
    robSize: 32,
  };
  const ts = run(readCorpus('array-sum.s'), CONFIG);

  // Setup (tags 0-3) + iteration 0 (tags 4-8: lw, add, addi(+4), addi(-1), bne).
  const iter0Load = idAtRobTag(ts, 4);
  const iter0Sum = idAtRobTag(ts, 5);
  const iter0PtrBump = idAtRobTag(ts, 6);
  const iter0Counter = idAtRobTag(ts, 7);
  const iter0Branch = idAtRobTag(ts, 8);

  it('runs in exactly 41 cycles (0..40) — matches the step-1b log’s pinned 61→41', () => {
    expect(ts).toHaveLength(41);
  });

  it('the first miss: detected@5, releases (mem-read)@15, 10 cycles per CACHE_LARGE.missPenalty', () => {
    const detected = firstCacheAccessAt(ts, addressOf(ts, iter0Load));
    expect(detected).toMatchObject({ cycle: 5, hit: false });
    expect(cycleOfEvent(ts, 'mem-read', iter0Load)).toBe(15);
  });

  it('wakeup/select: the independent pointer/counter/branch race issue, 11 cycles ahead of the stuck reduction', () => {
    // walkIssuable's out-of-order mode SKIPS the not-ready reduction (iter0Sum, blocked on the
    // miss) and keeps scanning oldest-first, landing on the independent chain instead — in-order
    // mode would have STOPPED at the reduction and frozen these three behind it for the whole miss.
    expect(cycleOfEvent(ts, 'alu-op', iter0PtrBump)).toBe(5);
    expect(cycleOfEvent(ts, 'alu-op', iter0Counter)).toBe(5);
    expect(cycleOfEvent(ts, 'branch-predicted', iter0Branch), 'bet placed@5 too').toBe(5);

    const reductionIssue = cycleOfEvent(ts, 'alu-op', iter0Sum);
    expect(reductionIssue, 'the reduction stays blocked until the miss releases').toBe(16);
    expect(cycleOfEvent(ts, 'alu-op', iter0PtrBump)!).toBeLessThan(reductionIssue!);
  });

  it('iteration 0’s branch is correctly predicted taken — zero misprediction penalty', () => {
    const resolved = ts
      .flatMap((t) => t.events)
      .find((e) => e.type === 'branch-resolved' && e.instr === iter0Branch);
    expect(resolved).toMatchObject({ predicted: true, actual: true });
    expect(cycleOfEvent(ts, 'branch-resolved', iter0Branch)).toBe(6);
  });

  it('oldest-first CDB/issue-budget arbitration stretches the fast chain’s cadence once the reduction wakes', () => {
    // Once the first miss releases, the reduction chain (i5→i12→i19→…, one older-in-program-order
    // add per iteration) competes for the SAME width-2 issue budget as the fast chain. Being OLDER,
    // it wins a slot whenever both are ready the same cycle — this is what stretches the fast
    // chain's otherwise-4-cycle bet period to 6 around iteration 2→3, not a scheduler bug.
    const iter1Sum = idAtRobTag(ts, 10); // iteration 1's add — dispatches right after the miss window
    const iter3Counter = idAtRobTag(ts, 22); // iteration 3's counter decrement — ready, but younger
    expect(cycleOfEvent(ts, 'alu-op', iter1Sum), 'iter1 reduction wins the shared slot').toBe(17);
    expect(
      cycleOfEvent(ts, 'alu-op', iter3Counter),
      'iter3 counter loses it, delayed one cycle',
    ).toBe(18);
  });

  it('the second miss does NOT overlap the first — checked, not assumed', () => {
    const iter4Load = idAtRobTag(ts, 24); // iteration 4: tags 24-28
    const secondMiss = firstCacheAccessAt(ts, addressOf(ts, iter4Load));
    const firstMissReleased = cycleOfEvent(ts, 'mem-read', iter0Load)!;
    expect(secondMiss).toMatchObject({ hit: false });
    // array-sum.s's money shot is "independent work races around ONE outstanding miss," not
    // miss-under-miss — that scenario is scheduler.test.ts's dedicated 2-miss program instead.
    expect(secondMiss!.cycle).toBeGreaterThan(firstMissReleased);
  });

  it('the final iteration mispredicts (loop actually ends) — flush touches only IF, nothing in the ROB', () => {
    const iter4Branch = idAtRobTag(ts, 28);
    const resolved = ts.find((t) =>
      t.events.some((e) => e.type === 'branch-resolved' && e.instr === iter4Branch),
    );
    expect(resolved?.events).toContainEqual(
      expect.objectContaining({ type: 'branch-resolved', predicted: true, actual: false }),
    );
    const flush = resolved?.events.find((e) => e.type === 'flush');
    expect(flush).toMatchObject({ reason: 'branch-not-taken', stages: ['IF'] });
  });

  it('the tail store to `total` hits the cache (rides iteration 4’s already-loaded line) and defers its write to commit', () => {
    const sw = idAtRobTag(ts, 31); // tail: tags 29-33 = lui/addi(total), sw, addi(a7), ecall
    expect(cycleOfEvent(ts, 'alu-op', sw), 'sw issues (address)').toBe(35);
    const totalAddr = addressOf(ts, sw);
    // Only misses.large: 2 total (both compulsory) — total rides arr[4]'s already-resident line,
    // so THIS is a hit, not a third miss.
    const cacheCheck = firstCacheAccessAt(ts, totalAddr);
    expect(
      cacheCheck,
      'the cache check one cycle after the store computes its address',
    ).toMatchObject({ cycle: 36, hit: true });
    expect(cycleOfEvent(ts, 'mem-write', sw), 'store write deferred to commit').toBe(
      cycleOfEvent(ts, 'instr-retire', sw),
    );
    expect(cycleOfEvent(ts, 'mem-write', sw)).toBe(39);
  });

  it('final architectural state: a0 = 120 (sum of {5,17,-4,100,2} twice-summed reductions), halted', () => {
    const last = ts[ts.length - 1]!;
    expect(last.state.registers[10]).toBe(120);
    expect(last.state.halted).toBe(true);
  });
});
