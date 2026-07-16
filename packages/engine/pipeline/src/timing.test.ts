import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import {
  defaultConfig,
  type CycleTrace,
  type ProcessorConfig,
  type TraceEvent,
} from '@cpu-viz/trace';
import { PipelineProcessor } from './index';

/**
 * The pinned timing table — the net for INV-8's blind spot (M3 step 3).
 *
 * `differential.test.ts` proves this model computes the right ANSWERS, on the whole corpus, in
 * both forwarding positions. It cannot prove it computes them at the right SPEED: it compares
 * only final architectural state, so a pipeline that ignored `forwarding: true` and interlocked
 * on every RAW would produce byte-identical results and pass silently. That is not a hypothetical
 * — it was measured during step 1: mutating the hazard unit that way left conformance 12/12 green
 * and failed 10 unit tests. The forwarding toggle's ENTIRE observable effect lives in that blind
 * spot, so the toggle needs a net of its own. This is it.
 *
 * `processor.test.ts` pins the model's soul on minimal hand-built programs (each forwarding path's
 * from/to/value, the priority rule, the load-use bubble, the flush, halt-with-drain). It is
 * deliberately not repeated here. What is new at this scale is TIMING ON THE REAL CORPUS: how many
 * cycles each program takes in each position, and exactly where every stall lands.
 *
 * ## How the numbers were derived (and why they are pins, not snapshots)
 *
 * A cycle count copied from a passing run is not a pin — it is a snapshot of whatever the engine
 * did, bug and all, and it will happily re-bless a regression as the new truth. So every entry
 * below is derived from the PINNED RULES, in `docs/plans/m3-tasks.md`, without reference to the
 * engine's output.
 *
 * Let `d_i` be the cycle instruction `i` leaves ID. It is then in EX at `d_i+1`, MEM at `d_i+2`,
 * WB at `d_i+3`; the machine halts at the last retire, so `cycles = d_last + 4`. The pinned rules
 * give the recurrence directly:
 *
 * - baseline (the pipe advances): `d_i >= d_(i-1) + 1`
 * - forwarding OFF (interlock in ID until the producer's WB): `d_i >= d_p + 3` for each producer
 *   `p` of a source register. It is +3 rather than +4 because of the same-cycle WB→ID rule — the
 *   consumer may leave ID in the very cycle the producer writes back.
 * - forwarding ON: only a LOAD producer stalls its consumer (`d_i >= d_L + 2`) — the load-use
 *   bubble. Every other RAW is covered by a forward.
 * - a taken transfer `b`: the redirect is clocked at the end of b's EX (`d_b+1`), so the target is
 *   fetched at `d_b+2` and leaves ID at `d_b+3` — a +2 penalty over the `d_b+1` baseline.
 *
 * Summing the recurrence over a whole run collapses to one closed form:
 *
 * > **cycles = N + 4 + S + 2·T**
 * >
 * > N = instructions that RETIRE, S = total stall cycles, T = taken control transfers.
 *
 * That is what makes this a table of derivations rather than a table of magic numbers, and it is
 * why each term is asserted SEPARATELY below: a single opaque total lets a compensating pair of
 * errors (over-count S, under-count T) pass, and tells you nothing about where it broke.
 *
 * **The thesis, stated in the formula:** N and T belong to the PROGRAM and S to the
 * MICROARCHITECTURE. Forwarding cannot change which instructions run or which branches are taken,
 * so `cycles_off - cycles_on = S_off - S_on`, exactly. The crown jewel is that subtraction being
 * positive — and it is asserted on its own below, not resting on the formula being right.
 *
 * **Careful — the +2 is per taken TRANSFER, not per `flush` EVENT.** They come apart in the
 * corpus: `call-return.s`'s `ret` is the last word of `.text`, so nothing is behind it to kill. It
 * emits no `flush` at all (the pinned "a flush reports real casualties" rule) and still costs its
 * two cycles: the target cannot be fetched until the redirect lands either way. A penalty is not a
 * casualty.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

const OFF: ProcessorConfig = { ...defaultConfig(), forwarding: false };
const ON: ProcessorConfig = { ...defaultConfig(), forwarding: true };

/** The two positions, as the table keys them. */
type Position = 'off' | 'on';
const CONFIG: Record<Position, ProcessorConfig> = { off: OFF, on: ON };

/**
 * Where stalls land: the pc of the stalling instruction → how many cycles it spent stalled,
 * summed across the whole run. A histogram rather than a bare count, because a model that stalls
 * the right NUMBER of times in the wrong PLACES is wrong, and because it keeps count and
 * placement from drifting apart — S is derived by summing this, never stated twice.
 *
 * Keyed by pc (not by cycle) deliberately: a loop's stalls recur at the same static pc every
 * iteration, so `{ [PC]: 20 }` says "this instruction, twice per iteration, ten iterations" —
 * legible and hand-checkable in a way that twenty cycle numbers are not.
 */
type StallSites = Readonly<Record<number, number>>;

interface Timing {
  /** Instructions that RETIRE — a property of the program. Config-invariant. */
  readonly retires: number;
  /** Taken control transfers — a property of the program. Config-invariant. */
  readonly takenTransfers: number;
  /** `flush` events that name real casualties. NOT the same as `takenTransfers` — see the header. */
  readonly flushes: { readonly branchTaken: number; readonly halt: number };
  /** The ONLY term the toggle moves. */
  readonly stalls: Readonly<Record<Position, StallSites>>;
}

/**
 * The table. Every number is hand-derived from the recurrence above, against the EXPANDED
 * instruction stream — which is where the traps are, since pseudo-ops hide real instructions and
 * real hazards from the `.s` source:
 *
 * - `la rd, sym` is ALWAYS two words, `lui rd, hi` + `addi rd, rd, lo` — the addi reads what the
 *   lui just wrote, so every `la` is a distance-1 RAW that stalls two cycles with forwarding off.
 *   Invisible in the source; `array-sum.s` has two of them and `byte-loads.s` one.
 * - `li` is sized by its literal; every `li` in this corpus is small, so each is a single
 *   `addi rd, x0, v` with no internal hazard.
 * - `mv` → `addi rd, rs, 0`; `ret` → `jalr x0, x1, 0`; `bnez rs, t` → `bne rs, x0, t`.
 * - TEXT_BASE is 0, so the pcs below are just `4 × index into the expanded stream`.
 */
const TIMING: Readonly<Record<string, Timing>> = {
  /**
   * `addi x1,x0,5 ; addi x2,x0,37 ; add x5,x1,x2` — no ecall: it halts by running off the end of
   * `.text` with three instructions still in flight. The one program whose tail is a pure DRAIN,
   * which is what makes it the place to confirm the formula's +4.
   *
   * OFF: d = 1, 2, 5 — the `add` waits for x2's write-back (producer at d=2 → WB at 5), so 2
   *      stalls. cycles = 5 + 4 = 9.
   * ON:  d = 1, 2, 3 — both operands forwarded, nothing stalls. cycles = 3 + 4 = 7.
   */
  'add.s': {
    retires: 3,
    takenTransfers: 0,
    flushes: { branchTaken: 0, halt: 0 },
    stalls: { off: { 8: 2 }, on: {} },
  },

  /**
   * 4 prologue + 5 per iteration × 5 + 5 epilogue = 34 retires. `bnez` is taken 4 times (the 5th
   * finds t1 == 0 and falls through). The corpus's richest timing program: it has the textbook
   * load-use pair AND two `la`s.
   *
   * Expanded, with pcs:
   *    0 lui t0        4 addi t0,t0     8 addi t1,x0,5    12 addi a0,x0,0
   *   16 lw t2,0(t0)  20 add a0,a0,t2  24 addi t0,t0,4    28 addi t1,t1,-1   32 bne t1,x0,loop
   *   36 lui t3       40 addi t3,t3,20 44 sw a0,0(t3)     48 addi a7,x0,10   52 ecall
   *
   * OFF: the `la` addi at 4 stalls 2. Per iteration: `add` at 20 waits on the `lw` (2), `bne` at
   *      32 waits on the `addi t1` right before it (2) — the `lw` at 16 and both `addi`s never
   *      stall, their producers are long retired. 4/iteration × 5 = 20. Epilogue: the second `la`
   *      addi at 40 stalls 2, and `sw` at 44 waits on it (2). S = 2 + 20 + 4 = 26.
   *      Steady-state period = 11 = N_iter(5) + S_iter(4) + 2·T(1).
   * ON:  only the load-use survives: `add` at 20, one cycle, once per iteration. S = 5.
   *      Period = 8 = 5 + 1 + 2.
   */
  'array-sum.s': {
    retires: 34,
    takenTransfers: 4,
    flushes: { branchTaken: 4, halt: 0 },
    stalls: { off: { 4: 2, 20: 10, 32: 10, 40: 2, 44: 2 }, on: { 20: 5 } },
  },

  /**
   * 6 retires, no branches at all.
   *    0 lui t0    4 addi t0,t0    8 lb t1,0(t0)    12 lbu t2,0(t0)    16 addi a7,x0,10   20 ecall
   *
   * OFF: the `la` addi at 4 stalls 2; `lb` at 8 reads t0 one behind it (2). S = 4.
   * ON:  ZERO — and the interesting part is why. This program has two loads and no load-use
   *      hazard: `lbu` reads t0, the pointer, NOT the t1 that `lb` just loaded. The load-use rule
   *      keys off the source registers, not off "a load is nearby".
   */
  'byte-loads.s': {
    retires: 6,
    takenTransfers: 0,
    flushes: { branchTaken: 0, halt: 0 },
    stalls: { off: { 4: 2, 8: 2 }, on: {} },
  },

  /**
   * 9 dynamic instructions: `jal` and `ret` are taken; `bge a0,a1,done` is NOT (17 >= 42 is false)
   * so `mv a0, a1` really executes.
   *    0 addi a0,x0,17   4 addi a1,x0,42   8 jal ra,max   12 addi s0,a0,0   16 addi a7,x0,10
   *   20 ecall          24 bge a0,a1,done 28 addi a0,a1,0 32 jalr x0,x1,0
   *
   * **The honest counterexample: S = 0 in BOTH positions, so forwarding buys nothing here.**
   * Every RAW in this program is already separated by a flush gap — `bge` reads the two `addi`s
   * from before the `jal`, and `mv s0, a0` reads across the `ret`. Both jumps hand their consumer
   * the +2 the interlock would have charged anyway:
   *    d = 1, 2, 3(jal) | 6(bge) 7(mv a0) 8(ret) | 11(mv s0) 12 13(ecall) → cycles = 17, both.
   * This is why the crown jewel is claimed for programs with real RAW chains, not for every
   * program: a milestone that quietly asserted "on is always faster" would be overclaiming.
   *
   * It is also the only corpus program with live code behind its `ecall` (the real `max:`
   * function), hence the one halt flush in the corpus — and the only one whose `ret` sits at the
   * last word of text, hence a taken transfer that flushes nobody.
   */
  'call-return.s': {
    retires: 9,
    takenTransfers: 2,
    flushes: { branchTaken: 1, halt: 1 }, // jal flushes; ret has nothing behind it to kill
    stalls: { off: {}, on: {} },
  },

  /**
   * 2 prologue + 3 per iteration × 10 + 2 epilogue = 34 retires. `bnez` is taken 9 times.
   *    0 addi a0,x0,0   4 addi t0,x0,10
   *    8 add a0,a0,t0  12 addi t0,t0,-1  16 bne t0,x0,loop
   *   20 addi a7,x0,10 24 ecall
   *
   * OFF: iteration 1's `add` at 8 stalls 2 (waiting on the `li t0` immediately before it), but no
   *      LATER iteration's does — the taken branch's 2-cycle gap has already retired its
   *      producers by the time it reaches ID. That asymmetry is exactly why a per-iteration cost
   *      must be traced, not assumed uniform. The `bne` at 16 stalls 2 EVERY iteration: it reads
   *      the `addi t0` one instruction ahead of it. This is the distance-1 branch-operand RAW, ten
   *      times over, in the hottest loop the corpus ships.
   *      S = 2 (the first `add`) + 2 × 10 (every `bne`) = 22.
   *      Steady-state period = 7 = N_iter(3) + S_iter(2) + 2·T(1).
   * ON:  no loads anywhere ⇒ S = 0. Period = 5 = 3 + 2·1.
   */
  'sum-loop.s': {
    retires: 34,
    takenTransfers: 9,
    flushes: { branchTaken: 9, halt: 0 },
    stalls: { off: { 8: 2, 16: 20 }, on: {} },
  },
};

function asm(source: string): AssembledProgram {
  const { program, errors } = assemble(source);
  if (!program) {
    throw new Error(
      'assembly failed:\n' + errors.map((e) => `  ${e.line}:${e.column} ${e.message}`).join('\n'),
    );
  }
  return program;
}

/** Drive one corpus program to halt under `config`, collecting every cycle. */
function run(file: string, config: ProcessorConfig): CycleTrace[] {
  const p = new PipelineProcessor();
  p.reset(toProgramImage(asm(readFileSync(PROGRAMS_DIR + file, 'utf8'))), config);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    // Every entry in the table is under 80 cycles; this only ever fires on a runaway bug.
    if (traces.length >= 500) throw new Error(`${file}: exceeded 500 cycles — runaway loop?`);
    traces.push(p.step());
  }
  return traces;
}

function eventsOf<T extends TraceEvent['type']>(
  ts: CycleTrace[],
  type: T,
): Extract<TraceEvent, { type: T }>[] {
  return ts.flatMap((t) =>
    t.events.filter((e): e is Extract<TraceEvent, { type: T }> => e.type === type),
  );
}

/** id → pc, from the fetch events — the only place an id and its address are stated together. */
function pcById(ts: CycleTrace[]): Map<string, number> {
  return new Map(eventsOf(ts, 'instr-fetch').map((e) => [e.instr, e.pc]));
}

/** The run's actual stall histogram, in the same shape the table states. */
function stallSites(ts: CycleTrace[]): Record<number, number> {
  const pcs = pcById(ts);
  const sites: Record<number, number> = {};
  for (const stall of eventsOf(ts, 'stall')) {
    const pc = pcs.get(stall.instr);
    if (pc === undefined) throw new Error(`stall names an instruction that was never fetched`);
    sites[pc] = (sites[pc] ?? 0) + 1;
  }
  return sites;
}

const total = (sites: StallSites): number => Object.values(sites).reduce((sum, n) => sum + n, 0);

const takenTransfers = (ts: CycleTrace[]): number =>
  eventsOf(ts, 'branch-resolved').filter((e) => e.actual).length;

/** Every (program, position) pair the table pins. */
const CASES = Object.keys(TIMING).flatMap((file) =>
  (['off', 'on'] as const).map((position) => ({ file, position })),
);

describe('the pinned cycle-count table', () => {
  it('covers every program in the corpus', () => {
    // The corpus is enumerated from disk by the conformance harness, so a program added later is
    // differentially tested automatically — but it would NOT get a timing entry automatically, and
    // a table that silently stopped covering the corpus is exactly the kind of decay this suite
    // exists to prevent. Fail loudly instead, and make the author derive the new entry by hand.
    const corpus = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.s'));
    expect(corpus.length).toBeGreaterThan(0); // ...and guard the guard against an empty read
    expect([...corpus].sort()).toEqual(Object.keys(TIMING).sort());
  });

  it.each(CASES)('$file [forwarding $position]', ({ file, position }) => {
    const pinned = TIMING[file]!;
    const ts = run(file, CONFIG[position]);
    const sites = pinned.stalls[position];

    // Each term of `cycles = N + 4 + S + 2·T` is asserted on its own, against the events that
    // define it. Checking only the total would let a compensating pair of errors through, and
    // would say nothing about WHICH term drifted when it failed.
    expect(eventsOf(ts, 'instr-retire'), 'N — retired instructions').toHaveLength(pinned.retires);
    expect(takenTransfers(ts), 'T — taken control transfers').toBe(pinned.takenTransfers);
    // S, and every stall's PLACE at once: a model that stalls the right number of times at the
    // wrong instructions is wrong, and this catches it without naming a single cycle number.
    expect(stallSites(ts), 'S — where the stalls land').toEqual(sites);

    // ...and only then the closed form itself.
    expect(ts).toHaveLength(pinned.retires + 4 + total(sites) + 2 * pinned.takenTransfers);
  });
});

describe("the formula's constant terms, isolated", () => {
  it('+4: the fill and drain, on the one program that ends in a pure drain', () => {
    // `add.s` has no `ecall` — it runs off the end of `.text` with three instructions still in
    // flight, so its tail is the drain and nothing else. With N=3, S=0, T=0 the whole count IS the
    // constant: 3 + 4. If halting truncated the run instead of draining, this is where it shows.
    const ts = run('add.s', ON);
    expect(eventsOf(ts, 'stall')).toEqual([]);
    expect(takenTransfers(ts)).toBe(0);
    expect(ts).toHaveLength(3 + 4);
    // The drain is real: fetching stops three cycles before the machine does.
    expect(eventsOf(ts, 'instr-fetch')).toHaveLength(3);
    expect(eventsOf(ts, 'instr-retire')).toHaveLength(3);
  });

  it('+2 per taken transfer, isolated from every stall', () => {
    // A program with exactly one taken branch and no RAW anywhere, so the penalty is the only
    // thing separating it from N+4 — in BOTH configs, since with nothing to forward the toggle
    // cannot move it. Four instructions retire: the two `addi`s, the branch, and the ecall; the
    // two shadows are flushed and never retire.
    const source = [
      '.text',
      'addi x1, x0, 0',
      'beq x0, x0, target', // always taken, and reads only x0 — never a dependency
      'addi x2, x0, 111', // shadow
      'addi x3, x0, 222', // shadow
      'target:',
      'ecall',
    ].join('\n');
    for (const config of [OFF, ON]) {
      const p = new PipelineProcessor();
      p.reset(toProgramImage(asm(source)), config);
      const ts: CycleTrace[] = [];
      while (!p.isHalted()) ts.push(p.step());

      expect(eventsOf(ts, 'stall')).toEqual([]);
      expect(eventsOf(ts, 'instr-retire')).toHaveLength(3);
      expect(takenTransfers(ts)).toBe(1);
      expect(ts).toHaveLength(3 + 4 + 0 + 2 * 1);
    }
  });

  it('charges the +2 even when the flush kills nobody — a penalty is not a casualty', () => {
    // `call-return.s`'s `ret` is the last word of `.text`, so nothing was fetched behind it: it
    // emits NO flush event (the pinned "a flush reports real casualties" rule) and still costs two
    // cycles, because the target cannot be fetched until the redirect lands at the clock edge.
    // This is why the formula's T counts taken TRANSFERS and not `flush` events — on this program
    // there are 2 of the former and 1 of the latter, and using flushes would under-count by 2.
    const ts = run('call-return.s', ON);
    expect(takenTransfers(ts)).toBe(2);
    expect(eventsOf(ts, 'flush').filter((e) => e.reason === 'branch-taken')).toHaveLength(1);
    // The count only balances with T=2. Were the penalty charged per flush, this would be 15.
    expect(ts).toHaveLength(9 + 4 + 0 + 2 * 2);
  });
});

describe('N and T are the program; S is the microarchitecture', () => {
  // The thesis, stated as an invariant rather than an anecdote. Forwarding is a claim about HOW
  // operands reach the ALU — it cannot change which instructions run or which branches are taken.
  // If either of these ever differs across configs, the toggle has broken something architectural
  // and the timing numbers are the least of it.
  it.each(Object.keys(TIMING))(
    '%s retires the same instructions and takes the same branches',
    (file) => {
      const off = run(file, OFF);
      const on = run(file, ON);

      expect(eventsOf(on, 'instr-retire')).toHaveLength(eventsOf(off, 'instr-retire').length);
      expect(takenTransfers(on)).toBe(takenTransfers(off));
      // Stronger than the counts: the same instructions retire in the same ORDER, at the same pcs.
      const retiredPcs = (ts: CycleTrace[]): number[] => {
        const pcs = pcById(ts);
        return eventsOf(ts, 'instr-retire').map((e) => pcs.get(e.instr)!);
      };
      expect(retiredPcs(on)).toEqual(retiredPcs(off));
    },
  );

  it.each(Object.keys(TIMING))(
    '%s: the whole cycle difference is stall cycles, exactly',
    (file) => {
      // `cycles = N + 4 + S + 2·T` with N and T config-invariant collapses to this subtraction. It
      // is the sharpest statement of what the toggle does: it buys back stall cycles and nothing
      // else. Note this holds for `call-return.s` too, where both sides are 0.
      const pinned = TIMING[file]!;
      const off = run(file, OFF);
      const on = run(file, ON);
      expect(off.length - on.length).toBe(total(pinned.stalls.off) - total(pinned.stalls.on));
    },
  );
});

describe('the crown jewel — the same program, the same answer, fewer cycles', () => {
  // The spec's flagship interaction (§12), on the real corpus rather than a hand-built fixture,
  // and asserted WITHOUT reference to the formula above: even if every derived constant were
  // wrong, this comparison would still be the milestone's claim. It is also precisely the claim
  // INV-8 structurally cannot make, since it compares only the left-hand side of "same answer".
  const RAW_CHAINED = ['add.s', 'array-sum.s', 'byte-loads.s', 'sum-loop.s'];

  it.each(RAW_CHAINED)(
    '%s: strictly fewer cycles with forwarding on, identical final state',
    (file) => {
      const off = run(file, OFF);
      const on = run(file, ON);
      const finalOff = off[off.length - 1]!.state;
      const finalOn = on[on.length - 1]!.state;

      expect(on.length).toBeLessThan(off.length);
      expect([...finalOn.registers]).toEqual([...finalOff.registers]);
      expect(finalOn.pc).toBe(finalOff.pc);
      expect(finalOn.halted).toBe(finalOff.halted);
      // The UNION of both runs' touched addresses, not just one side's: a word that only ONE
      // position wrote is precisely the asymmetry worth catching, and iterating a single side's
      // addresses would look right while missing it entirely. Conformance checks both against the
      // reference, but this test is the crown jewel and is meant to stand on its own.
      for (const addr of new Set([
        ...finalOff.memory.definedAddresses(),
        ...finalOn.memory.definedAddresses(),
      ])) {
        expect(finalOn.memory.readWord(addr), `memory word at 0x${addr.toString(16)}`).toBe(
          finalOff.memory.readWord(addr),
        );
      }
    },
  );

  it('does NOT claim forwarding is free money — call-return.s is identical in both', () => {
    // The honest counterexample, and the reason the list above is a list rather than the corpus.
    // Every RAW in `call-return.s` is already separated by a flush gap, so the interlock never has
    // anything to charge for: forwarding on saves exactly zero cycles. A suite that asserted "on
    // is faster" across the whole corpus would be overclaiming, and would have to be weakened to
    // `<=` — which would then pass for a pipeline where forwarding did nothing at all.
    expect(run('call-return.s', ON)).toHaveLength(run('call-return.s', OFF).length);
  });
});

describe('stall and flush placement across the corpus', () => {
  it('every stall interlocks in ID, and names a real in-flight instruction', () => {
    for (const { file, position } of CASES) {
      const ts = run(file, CONFIG[position]);
      const pcs = pcById(ts);
      for (const stall of eventsOf(ts, 'stall')) {
        expect(stall.stage, `${file} [${position}]`).toBe('ID');
        expect(pcs.has(stall.instr)).toBe(true);
        // ...and it really is in ID that cycle, not merely labelled so.
        const cycle = ts.find((t) => t.events.includes(stall))!;
        expect(cycle.instructions.find((i) => i.id === stall.instr)?.location).toBe('ID');
      }
    }
  });

  it("reports 'load-use' only with forwarding on — with it off, the interlock says 'raw'", () => {
    // The pinned reason encoding. With forwarding off the general interlock subsumes the load-use
    // case and honestly reports what it did: it interlocked on a RAW, like it does for every other
    // hazard. Claiming 'load-use' there would tell a lesson the bubble was the un-forwardable one
    // when it was really just the interlock doing its ordinary job.
    for (const file of Object.keys(TIMING)) {
      expect(new Set(eventsOf(run(file, OFF), 'stall').map((e) => e.reason))).toEqual(
        total(TIMING[file]!.stalls.off) > 0 ? new Set(['raw']) : new Set(),
      );
      expect(new Set(eventsOf(run(file, ON), 'stall').map((e) => e.reason))).toEqual(
        total(TIMING[file]!.stalls.on) > 0 ? new Set(['load-use']) : new Set(),
      );
    }
  });

  it.each(CASES)(
    '$file [forwarding $position]: flushes name exactly their casualties',
    ({ file, position }) => {
      const pinned = TIMING[file]!;
      const ts = run(file, CONFIG[position]);
      const flushes = eventsOf(ts, 'flush');

      // Flushes are architectural: the same branches are taken and the same shadow sits behind the
      // same `ecall` whatever the forwarding config, so this table has no per-position column.
      expect(flushes.filter((e) => e.reason === 'branch-taken')).toHaveLength(
        pinned.flushes.branchTaken,
      );
      expect(flushes.filter((e) => e.reason === 'halt')).toHaveLength(pinned.flushes.halt);

      for (const flush of flushes) {
        // A taken branch resolves in EX and kills the two younger instructions behind it — one in
        // ID, one in IF. An architectural halt is detected a stage earlier, in ID, so it has exactly
        // one younger instruction to kill.
        expect(flush.stages).toEqual(flush.reason === 'branch-taken' ? ['ID', 'IF'] : ['IF']);

        // ...and the casualties are REAL, which is the whole content of the pinned rule: the trace
        // says an instruction died in each named stage, so the map has that many rows to cut and a
        // lesson triggering on a bare `{ event: 'flush' }` never announces a bubble that didn't
        // happen. Three of the five corpus programs end with `ecall` as their last word and emit no
        // halt flush at all for exactly this reason.
        const cycle = ts.find((t) => t.events.includes(flush))!;
        for (const stage of flush.stages) {
          expect(cycle.instructions.some((i) => i.location === stage)).toBe(true);
        }
      }
    },
  );
});
