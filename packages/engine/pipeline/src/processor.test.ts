import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import {
  defaultConfig,
  type CycleTrace,
  type ProcessorConfig,
  type TraceEvent,
} from '@cpu-viz/trace';
import { toProgramImage } from '@cpu-viz/engine-common';
import { PipelineProcessor, PIPELINE_CAPABILITIES, type PipelineMicro, type Stage } from './index';

/**
 * Pipeline engine tests — the REAL verification of this model. The INV-8 differential net
 * (`differential.test.ts`) proves only final architectural state, which is model-invariant and,
 * crucially, **blind to timing**: a pipeline that ignored `forwarding: true` and interlocked on
 * every RAW would pass it silently. So conformance says nothing about this model's soul — the
 * hazard unit, each forwarding path, the priority rule, the load-use bubble, the flush, and
 * halt-with-drain. Those are pinned HERE.
 *
 * Every expectation is hand-derived from first principles, not pasted from the engine's own
 * output (a number copied from a failing run is not a pin — it is a snapshot of a bug). Programs
 * are built with the real assembler, and use explicit instructions rather than `li`/`mv`
 * pseudo-ops wherever the instruction COUNT is load-bearing.
 *
 * The ISA arithmetic is deliberately NOT re-tested here: it is mirrored verbatim from the golden
 * reference and conformance is what proves the copy faithful.
 */

function asm(source: string): AssembledProgram {
  const { program, errors } = assemble(source);
  if (!program) {
    throw new Error(
      'assembly failed:\n' + errors.map((e) => `  ${e.line}:${e.column} ${e.message}`).join('\n'),
    );
  }
  return program;
}

const OFF: ProcessorConfig = { ...defaultConfig(), forwarding: false };
const ON: ProcessorConfig = { ...defaultConfig(), forwarding: true };

function makeProc(source: string, config: ProcessorConfig): PipelineProcessor {
  const p = new PipelineProcessor();
  p.reset(toProgramImage(asm(source)), config);
  return p;
}

/** Drive to halt, collecting every CycleTrace. */
function run(source: string, config: ProcessorConfig, maxCycles = 2000): CycleTrace[] {
  const p = makeProc(source, config);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    if (traces.length >= maxCycles) throw new Error('exceeded maxCycles — runaway loop?');
    traces.push(p.step());
  }
  return traces;
}

const last = (ts: CycleTrace[]): CycleTrace => ts[ts.length - 1]!;
const reg = (t: CycleTrace, i: number): number => t.state.registers[i]!;
const micro = (t: CycleTrace): PipelineMicro => t.state.micro as PipelineMicro;

/** Every event of one type across the whole run, in cycle order. */
function eventsOf<T extends TraceEvent['type']>(
  ts: CycleTrace[],
  type: T,
): Extract<TraceEvent, { type: T }>[] {
  return ts.flatMap((t) =>
    t.events.filter((e): e is Extract<TraceEvent, { type: T }> => e.type === type),
  );
}

/** The id of the instruction at `pc` (the nth instruction, 0-based), from its fetch event. */
function idOfNth(ts: CycleTrace[], n: number): string {
  const fetches = eventsOf(ts, 'instr-fetch');
  const f = fetches[n];
  if (!f) throw new Error(`no ${n}th instr-fetch in this run`);
  return f.instr;
}

/** The stage walk of one instruction id: its `location` at every cycle it is in flight. */
function walk(ts: CycleTrace[], id: string): Stage[] {
  return ts.flatMap((t) =>
    t.instructions.filter((i) => i.id === id).map((i) => i.location as Stage),
  );
}

// A tiny program with three independent instructions and a distance-1 + distance-2 RAW chain on
// the last one. This is `add.s` (the corpus's smallest program) in explicit form: it has NO ecall
// and halts by running off the end of text — the second halt path, and the one that proves the
// pipe drains rather than truncating.
const ADD_S = ['.text', 'addi x1, x0, 5', 'addi x2, x0, 37', 'add x5, x1, x2'].join('\n');

/**
 * A data address comfortably past the end of any program here — memory is ONE flat space with
 * text based at 0, so a "spare" address has to be chosen, not assumed: `lw x2, 0(x0)` reads the
 * program's own first instruction word, not an empty cell.
 */
const SCRATCH = 256;

/**
 * The textbook load-use pair, with a real value in memory to load. The two fillers separate the
 * `sw` from the `lw` so the only hazard left at the `add` is the load-use one.
 */
const LOAD_USE = [
  '.text',
  `addi x1, x0, ${SCRATCH}`,
  'addi x4, x0, 42',
  'sw x4, 0(x1)',
  'addi x9, x0, 0',
  'addi x9, x0, 0',
  'lw x2, 0(x1)',
  'add x3, x2, x2', // load-use: reads x2 the instruction right before it loaded
  'ecall',
].join('\n');

describe('capabilities', () => {
  it('is the first model that is pipelined, hazard-bearing, and config-honoring', () => {
    expect(PIPELINE_CAPABILITIES.pipelined).toBe(true);
    expect(PIPELINE_CAPABILITIES.hasHazards).toBe(true);
    // The flagship: the trace genuinely depends on this knob. Every earlier model said false.
    expect(PIPELINE_CAPABILITIES.configurableForwarding).toBe(true);
    // M4: the second honored knob. Was `false` through all of M3, with a comment naming this
    // milestone — the seam was cut before the pipeline existed and is finally filled.
    expect(PIPELINE_CAPABILITIES.configurableBranchPrediction).toBe(true);
    // Still deferred: caches are the other half of §12.3 and their own milestone (they need
    // array-walking programs before a hit or a miss means anything).
    expect(PIPELINE_CAPABILITIES.configurableCache).toBe(false);
  });
});

describe('five stages, four latches', () => {
  // The explicit contrast with M2's variable `phasesFor` (3–5 phases, opcode-dependent): here a
  // `sw` idles through WB and a `lui` idles through MEM rather than skipping them. That
  // uniformity is what makes the latch chain a chain.
  it.each([
    ['addi x1, x0, 1', 'addi'],
    ['sw x0, 0(x0)', 'sw'],
    ['lui x1, 1', 'lui'],
    ['beq x0, x0, done', 'beq'],
    ['lw x1, 0(x0)', 'lw'],
  ])('every instruction traverses all five stages: %s', (instruction) => {
    const ts = run(['.text', instruction, 'done:', 'ecall'].join('\n'), ON);
    expect(walk(ts, idOfNth(ts, 0))).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);
  });

  it('keeps one stable id from fetch to retire (INV-4)', () => {
    const ts = run(ADD_S, ON);
    const id = idOfNth(ts, 0);
    // The id appears in exactly five cycles, always as the same instruction, and the retire event
    // names that same id — never a per-stage or per-cycle identity.
    expect(walk(ts, id)).toHaveLength(5);
    expect(eventsOf(ts, 'instr-retire').map((e) => e.instr)).toContain(id);
    const fetched = eventsOf(ts, 'instr-fetch').filter((e) => e.instr === id);
    expect(fetched).toHaveLength(1); // fetched once, not re-fetched under a new id
  });

  it('holds five different instructions in five different stages in one cycle', () => {
    // Six independent instructions (each reads only x0), so nothing stalls and the pipe fills.
    const ts = run(
      [
        '.text',
        'addi x1, x0, 1',
        'addi x2, x0, 2',
        'addi x3, x0, 3',
        'addi x4, x0, 4',
        'addi x5, x0, 5',
        'addi x6, x0, 6',
        'ecall',
      ].join('\n'),
      ON,
    );
    // Hand-derived: instruction 0 is fetched at cycle 0 and reaches WB at cycle 4; by then
    // instructions 1..4 fill MEM/EX/ID/IF behind it. This is the first tier where this is
    // possible at all — M1/M2 always had exactly one.
    const full = ts[4]!;
    expect(full.instructions).toHaveLength(5);
    expect(full.instructions.map((i) => i.location)).toEqual(['WB', 'MEM', 'EX', 'ID', 'IF']);
    expect(new Set(full.instructions.map((i) => i.id)).size).toBe(5);
  });

  it('reports the four latches as `micro`, with null for a bubble', () => {
    const ts = run(ADD_S, ON);
    // Cycle 0: only IF has run, so only the IF/ID latch is loaded.
    expect(micro(ts[0]!)).toEqual({
      ifId: expect.objectContaining({ instr: idOfNth(ts, 0) }),
      idEx: null,
      exMem: null,
      memWb: null,
    });
    // Cycle 3 is the fullest this program gets (3 instructions): IF/ID empty (fetch has left
    // text), the other three loaded.
    const m = micro(ts[3]!);
    expect(m.ifId).toBeNull();
    expect(m.idEx?.instr).toBe(idOfNth(ts, 2));
    expect(m.exMem?.instr).toBe(idOfNth(ts, 1));
    expect(m.memWb?.instr).toBe(idOfNth(ts, 0));
  });

  it('gives every cycle its own latch snapshot — never a live alias', () => {
    // The recorder keeps every cycle, so a latch aliased across cycles would replay as
    // latest-values-everywhere. Conformance reads only the FINAL state and is structurally blind
    // to this; time-travel (step 4) is where it would surface. Pin it here instead.
    const ts = run(ADD_S, ON);
    const seen = new Map<number, string | undefined>();
    for (const t of ts) seen.set(t.cycle, micro(t).idEx?.instr);
    // Three different instructions occupy ID/EX over the run; if the latch were aliased, every
    // recorded cycle would report whichever one was there last.
    expect(new Set([...seen.values()].filter((v) => v !== undefined)).size).toBe(3);
    expect(micro(ts[1]!).idEx?.instr).toBe(idOfNth(ts, 0));
    expect(micro(ts[2]!).idEx?.instr).toBe(idOfNth(ts, 1));
  });
});

describe('the reverse stage walk (WB→MEM→EX→ID→IF)', () => {
  it('writes back before it reads, in the same cycle — and ID sees the new value', () => {
    // The pinned same-cycle WB→ID rule ("write in the first half, read in the second"), and the
    // pinned intra-cycle EVENT order, which is a trace-contract surface (INV-3/INV-6) and not an
    // implementation detail. M1/M2 never faced it: one instruction, one stage per cycle.
    //
    // Hand-derived, forwarding OFF: `add x5, x1, x2` interlocks in ID until its producers write
    // back. At cycle 5 the second `addi` is in WB writing x2=37 while `add` is in ID reading it.
    const ts = run(ADD_S, OFF);
    const c5 = ts[5]!;
    const types = c5.events.map((e) => e.type);
    expect(types).toEqual(['reg-write', 'instr-retire', 'reg-read', 'reg-read']);

    // Order alone could be a coincidence; the VALUE is what proves the read saw the write.
    const write = c5.events[0] as Extract<TraceEvent, { type: 'reg-write' }>;
    expect(write).toMatchObject({ reg: 2, value: 37, instr: idOfNth(ts, 1) });
    const reads = c5.events.filter((e) => e.type === 'reg-read');
    expect(reads).toEqual([
      { type: 'reg-read', reg: 1, value: 5, instr: idOfNth(ts, 2) },
      { type: 'reg-read', reg: 2, value: 37, instr: idOfNth(ts, 2) }, // 37, not the stale 0
    ]);
  });

  it('needs no forward for a distance-3 RAW — the register file is already current', () => {
    // The direct consequence of the rule above, and the reason the forwarding network only needs
    // two paths: by the time a producer is in WB, a consumer three behind is in ID and reads the
    // real thing.
    const source = [
      '.text',
      'addi x1, x0, 7', // producer
      'addi x9, x0, 0', // filler
      'addi x8, x0, 0', // filler
      'add x2, x1, x0', // consumer, distance 3
      'ecall',
    ].join('\n');
    for (const config of [OFF, ON]) {
      const ts = run(source, config);
      const consumer = idOfNth(ts, 3);
      expect(eventsOf(ts, 'forward').filter((e) => e.instr === consumer)).toEqual([]);
      expect(eventsOf(ts, 'stall')).toEqual([]); // and nothing stalls, in either config
      // The read itself is already correct — hand-derived: WB ran first this cycle.
      expect(eventsOf(ts, 'reg-read').filter((e) => e.instr === consumer && e.reg === 1)).toEqual([
        { type: 'reg-read', reg: 1, value: 7, instr: consumer },
      ]);
      expect(reg(last(ts), 2)).toBe(7);
    }
  });
});

describe('the forwarding network', () => {
  it('forwards EX/MEM→EX for a distance-1 RAW', () => {
    // Hand-derived: `add` is in EX the cycle `addi` is in MEM, so `addi`'s result lives in the
    // EX/MEM latch — the younger of the two forwarding-mux inputs.
    const ts = run(['.text', 'addi x1, x0, 9', 'add x2, x1, x0', 'ecall'].join('\n'), ON);
    const consumer = idOfNth(ts, 1);
    expect(eventsOf(ts, 'forward').filter((e) => e.instr === consumer)).toEqual([
      { type: 'forward', from: 'EX/MEM', to: 'EX.rs1', value: 9, instr: consumer },
    ]);
    expect(eventsOf(ts, 'stall')).toEqual([]); // forwarding is what makes this free
    expect(reg(last(ts), 2)).toBe(9);
  });

  it('forwards MEM/WB→EX for a distance-2 RAW', () => {
    // One filler instruction later, the producer has moved on to WB; the value now comes from the
    // MEM/WB latch instead. Same hazard, different path — the pair is why there are two.
    const ts = run(
      ['.text', 'addi x1, x0, 9', 'addi x8, x0, 0', 'add x2, x1, x0', 'ecall'].join('\n'),
      ON,
    );
    const consumer = idOfNth(ts, 2);
    expect(eventsOf(ts, 'forward').filter((e) => e.instr === consumer)).toEqual([
      { type: 'forward', from: 'MEM/WB', to: 'EX.rs1', value: 9, instr: consumer },
    ]);
    expect(reg(last(ts), 2)).toBe(9);
  });

  it('lets EX/MEM win a double match — the younger producer is the right one', () => {
    // Both latches hold a value for x1 at the same instant: the first `addi` (11) is in WB and
    // the second (22) is in MEM. The answer is 22. Inverting the priority still produces a
    // plausible run — it just quietly computes with a stale value.
    const ts = run(
      ['.text', 'addi x1, x0, 11', 'addi x1, x0, 22', 'add x2, x1, x0', 'ecall'].join('\n'),
      ON,
    );
    const consumer = idOfNth(ts, 2);
    expect(eventsOf(ts, 'forward').filter((e) => e.instr === consumer)).toEqual([
      { type: 'forward', from: 'EX/MEM', to: 'EX.rs1', value: 22, instr: consumer },
    ]);
    expect(reg(last(ts), 2)).toBe(22);
  });

  it('forwards each source port independently', () => {
    // `add x5, x1, x2` takes rs1 from the MEM/WB latch and rs2 from EX/MEM in the SAME cycle —
    // the two paths are per-operand muxes, not one shared decision.
    const ts = run(ADD_S, ON);
    const consumer = idOfNth(ts, 2);
    expect(eventsOf(ts, 'forward').filter((e) => e.instr === consumer)).toEqual([
      { type: 'forward', from: 'MEM/WB', to: 'EX.rs1', value: 5, instr: consumer },
      { type: 'forward', from: 'EX/MEM', to: 'EX.rs2', value: 37, instr: consumer },
    ]);
    expect(reg(last(ts), 5)).toBe(42);
  });

  it('never forwards from or to x0', () => {
    // x0 is hardwired zero, not a value anyone produces. `addi x0, x0, 99` looks exactly like a
    // producer of x0 — its write is simply discarded — so a naive rd-match would forward 99 into
    // the next instruction and compute 198.
    for (const config of [OFF, ON]) {
      const ts = run(['.text', 'addi x0, x0, 99', 'add x1, x0, x0', 'ecall'].join('\n'), config);
      expect(eventsOf(ts, 'forward')).toEqual([]);
      expect(eventsOf(ts, 'stall')).toEqual([]); // nor is x0 ever a phantom dependency
      expect(reg(last(ts), 1)).toBe(0);
      expect(reg(last(ts), 0)).toBe(0); // still hardwired
    }
  });

  it('has no forwarding network at all when the toggle is off', () => {
    const ts = run(ADD_S, OFF);
    expect(eventsOf(ts, 'forward')).toEqual([]);
  });
});

describe('the hazard unit', () => {
  it('interlocks in ID for two cycles on a distance-1 RAW with forwarding off', () => {
    // Hand-derived: the consumer waits in ID while the producer is in EX, then in MEM, and
    // proceeds the cycle the producer reaches WB (whose write it sees, per the reverse walk).
    // Two stalls, not three — that is the same-cycle WB→ID rule paying for itself.
    const ts = run(['.text', 'addi x1, x0, 9', 'add x2, x1, x0', 'ecall'].join('\n'), OFF);
    const consumer = idOfNth(ts, 1);
    const stalls = eventsOf(ts, 'stall').filter((e) => e.instr === consumer);
    expect(stalls).toEqual([
      { type: 'stall', reason: 'raw', stage: 'ID', instr: consumer },
      { type: 'stall', reason: 'raw', stage: 'ID', instr: consumer },
    ]);
    // A stall is a REPEATED CELL, not a vanished one: the consumer sits in ID for three cycles
    // (two stalled + the one it proceeds on) and still traverses all five stages exactly once
    // each afterwards.
    expect(walk(ts, consumer)).toEqual(['IF', 'ID', 'ID', 'ID', 'EX', 'MEM', 'WB']);
  });

  it('stalls the load-use hazard one cycle even with forwarding ON', () => {
    // The bubble that cannot be forwarded away, and the pedagogical centerpiece. A load in EX has
    // only its ADDRESS in the EX/MEM latch — the datum does not exist until MEM has run — so
    // there is nothing to forward. One bubble slides the consumer's EX alongside the load's WB,
    // where MEM/WB→EX can finally reach it.
    const ts = run(LOAD_USE, ON);
    const consumer = idOfNth(ts, 6);

    expect(eventsOf(ts, 'stall')).toEqual([
      { type: 'stall', reason: 'load-use', stage: 'ID', instr: consumer },
    ]);
    expect(walk(ts, consumer)).toEqual(['IF', 'ID', 'ID', 'EX', 'MEM', 'WB']);

    // ...and the stall is what MAKES the forward possible: after exactly one bubble, the load is
    // in WB and both operands come from MEM/WB. If EX/MEM→EX had (wrongly) fired for the load it
    // would have forwarded SCRATCH (the address), not 42 — which is why the value matters here.
    expect(eventsOf(ts, 'forward').filter((e) => e.instr === consumer)).toEqual([
      { type: 'forward', from: 'MEM/WB', to: 'EX.rs1', value: 42, instr: consumer },
      { type: 'forward', from: 'MEM/WB', to: 'EX.rs2', value: 42, instr: consumer },
    ]);
    expect(reg(last(ts), 3)).toBe(84);
  });

  it('stalls a load-use pair in BOTH configs — forwarding never makes it vanish', () => {
    for (const config of [OFF, ON]) {
      const ts = run(LOAD_USE, config);
      const consumer = idOfNth(ts, 6);
      expect(eventsOf(ts, 'stall').filter((e) => e.instr === consumer).length).toBeGreaterThan(0);
      expect(reg(last(ts), 3)).toBe(84); // ...and the answer is the same either way
    }
  });

  it('does not stall a load whose result nobody nearby reads', () => {
    // The load-use rule keys off the source-register predicate, not off "a load is in EX".
    const ts = run(
      ['.text', `addi x1, x0, ${SCRATCH}`, 'lw x2, 0(x1)', 'addi x3, x0, 1', 'ecall'].join('\n'),
      ON,
    );
    expect(eventsOf(ts, 'stall')).toEqual([]);
  });
});

describe('the forwarding toggle — the milestone in one test', () => {
  it('runs the same program to the same answer in strictly fewer cycles with forwarding on', () => {
    // The spec's flagship interaction (§12), and the one thing conformance structurally CANNOT
    // prove: it compares only final state, so an over-stalling pipeline passes it silently.
    // Hand-derived: `add.s` is 7 cycles forwarding-on (a full pipe, no bubbles) and 9 forwarding-
    // off (the `add` interlocks two cycles waiting for x2's write-back).
    const on = run(ADD_S, ON);
    const off = run(ADD_S, OFF);

    expect(on).toHaveLength(7);
    expect(off).toHaveLength(9);
    expect(on.length).toBeLessThan(off.length);

    // Identical architectural outcome, different timing — microarchitecture changes movement,
    // never the result of a correct program.
    expect(reg(last(on), 5)).toBe(42);
    expect(reg(last(off), 5)).toBe(42);
    expect([...last(on).state.registers]).toEqual([...last(off).state.registers]);
    expect(last(on).state.pc).toBe(last(off).state.pc);
  });
});

describe('control hazards', () => {
  // A taken branch, with two instructions behind it that must never run.
  const TAKEN = [
    '.text',
    'addi x1, x0, 0',
    'beq x1, x0, target', // taken: x1 == x0
    'addi x2, x0, 111', // shadow — must never execute
    'addi x3, x0, 222', // shadow — must never execute
    'target:',
    'addi x4, x0, 333',
    'ecall',
  ].join('\n');

  it('resolves in EX, emits branch-resolved + flush, and kills exactly two younger instructions', () => {
    const ts = run(TAKEN, ON);
    const branch = idOfNth(ts, 1);

    // Resolution happens in EX — hand-derived cycle 3 — and the flush fires in the same cycle.
    const resolveCycle = ts.findIndex((t) =>
      t.events.some((e) => e.type === 'branch-resolved' && e.instr === branch),
    );
    expect(ts[resolveCycle]!.instructions.find((i) => i.id === branch)?.location).toBe('EX');

    expect(eventsOf(ts, 'branch-resolved')).toEqual([
      {
        type: 'branch-resolved',
        instr: branch,
        predicted: false,
        actual: true,
        target: expect.any(Number),
      },
    ]);
    expect(ts[resolveCycle]!.events.filter((e) => e.type === 'flush')).toEqual([
      { type: 'flush', reason: 'branch-taken', stages: ['ID', 'IF'] },
    ]);

    // Exactly two younger instructions were in flight, and both die here — one in ID, one in IF.
    // They are REAL: both were fetched, so the map has two rows to cut. Neither reaches EX, so
    // neither can commit anything or pollute the trace with a phantom forward.
    const shadows = ts[resolveCycle]!.instructions.filter((i) => ['ID', 'IF'].includes(i.location));
    expect(shadows).toHaveLength(2);
    expect(shadows.map((s) => s.id)).toEqual([idOfNth(ts, 2), idOfNth(ts, 3)]);
    // The one caught in ID got one stage further than the one caught in IF; both stop dead there.
    expect(walk(ts, idOfNth(ts, 2))).toEqual(['IF', 'ID']);
    expect(walk(ts, idOfNth(ts, 3))).toEqual(['IF']);

    // The proof they never ran: their register writes never happened.
    expect(reg(last(ts), 2)).toBe(0);
    expect(reg(last(ts), 3)).toBe(0);
    expect(reg(last(ts), 4)).toBe(333); // ...and the target did
  });

  it('reports the resolved target on branch-resolved', () => {
    // The schema delta this milestone pinned: the datapath needs the redirect's VALUE to label
    // the wire it draws from this event (INV-3 — extend the schema, don't open a back door).
    const ts = run(TAKEN, ON);
    const resolved = eventsOf(ts, 'branch-resolved')[0]!;
    const branchPc = ts.flatMap((t) => t.instructions).find((i) => i.id === resolved.instr)!.pc;
    const targetPc = ts.flatMap((t) => t.instructions).find((i) => i.id === idOfNth(ts, 4))!.pc;
    expect(resolved.target).toBe(targetPc);
    expect(resolved.target).not.toBe(branchPc + 4); // it really redirected
  });

  it('resolves a NOT-taken branch too, with no flush and the fall-through as its target', () => {
    // Firing on every conditional branch (not only taken ones) is what gives a lesson and the
    // timing tests a resolution event to anchor to, and is honest about what the branch unit did.
    const ts = run(
      ['.text', 'addi x1, x0, 1', 'beq x1, x0, target', 'target:', 'ecall'].join('\n'),
      ON,
    );
    const branch = idOfNth(ts, 1);
    const branchPc = ts.flatMap((t) => t.instructions).find((i) => i.id === branch)!.pc;
    expect(eventsOf(ts, 'branch-resolved')).toEqual([
      {
        type: 'branch-resolved',
        instr: branch,
        predicted: false,
        actual: false,
        target: branchPc + 4,
      },
    ]);
    expect(eventsOf(ts, 'flush').filter((e) => e.reason === 'branch-taken')).toEqual([]);
  });

  it('treats jal and jalr as EX-resolved transfers too — no ID comparator, no special case', () => {
    // `jalr`'s distinguishing feature is that a REGISTER supplies its target address (a RAW on
    // control flow itself), which the same EX-targeted forwarding covers: here `jalr` reads the
    // `ra` that `jal` wrote two instructions earlier.
    const ts = run(
      ['.text', 'jal x1, fn', 'addi x2, x0, 111', 'ecall', 'fn:', 'jalr x0, 0(x1)'].join('\n'),
      ON,
    );
    const jal = idOfNth(ts, 0);

    const resolved = eventsOf(ts, 'branch-resolved');
    expect(resolved.map((e) => e.actual)).toEqual([true, true]); // both unconditional
    for (const e of resolved) {
      const cycle = ts.find((t) => t.events.includes(e))!;
      expect(cycle.instructions.find((i) => i.id === e.instr)?.location).toBe('EX');
    }
    expect(resolved[0]!.instr).toBe(jal);

    // `jal` writes ra; the `jalr` returning through it lands back on `addi x2` — which the jal's
    // own flush had killed the first time around. That round trip is the whole test.
    expect(reg(last(ts), 2)).toBe(111);
  });
});

/**
 * M4 step 1 — branch prediction, pinned by hand-derived cases.
 *
 * Placed beside "the forwarding toggle — the milestone in one test" on purpose: this is M3's
 * pattern's second instance, and a toggle's soul lives in this file by precedent.
 *
 * Conformance is blind to all of it — a correct predictor cannot move final architectural state,
 * which is the *point* of speculation — and so, mostly, is the corpus (`predict.test.ts` already
 * found a property the corpus structurally cannot see). So the schemes are pinned on minimal
 * programs whose every cycle is derived from the closed form rather than read off a run:
 *
 * > **cycles = N + 4 + S + P** — M3 step 3's `cycles = N + 4 + S + 2·T`, with `2·T` revealed as
 * > what it always was: the *static-not-taken instance* of a scheme-dependent penalty `P`.
 *
 * Each program isolates `P`: `x0` supplies both operands wherever a comparison is needed, so no
 * RAW exists, `S = 0`, and every scheme runs identically in both forwarding positions. That
 * orthogonality is itself a claim, and it is asserted rather than assumed.
 */
const TAKEN: ProcessorConfig = { ...defaultConfig(), branchPrediction: 'static-taken' };
const NOT_TAKEN: ProcessorConfig = { ...defaultConfig(), branchPrediction: 'static-not-taken' };

/** Always taken (`0 == 0`), reads no produced register ⇒ isolates P with S = 0. */
const ALWAYS = 'beq x0, x0, tgt\naddi x2, x0, 99\ntgt:\naddi x3, x0, 7\necall\n';
/** Never taken (`0 != 0` is false) — the branch that punishes a taken-bet. */
const NEVER = 'bne x0, x0, tgt\naddi x2, x0, 5\ntgt:\naddi x3, x0, 7\necall\n';

describe('branch prediction — the second toggle', () => {
  /**
   * `'none'` and `'static-not-taken'` are ONE MACHINE — the milestone's first real finding, not an
   * implementation shortcut. A processor with no predictor does not stop and wait for EX; it just
   * keeps fetching the next address, and **the fall-through IS the not-taken path**. "No
   * prediction" and "predict not taken" are one policy under two names.
   *
   * Asserted on whole traces rather than cycle counts: two machines that merely agreed on timing
   * could still differ in their events. `toEqual` over every cycle is the strongest statement
   * available.
   *
   * This is also why the entire pre-M4 suite stayed green when `branchPrediction` became honored —
   * `defaultConfig()` is `'none'`, so had these come apart, every pinned number in `timing.test.ts`
   * would have moved. The alternative reading (`'none'` = stall until EX resolves) is a defensible
   * machine, but it is not what "no predictor" means, and adopting it would have silently
   * redefined the default pipeline M3 pinned.
   */
  it("'none' and 'static-not-taken' are the same machine — the fall-through IS the not-taken path", () => {
    for (const forwarding of [false, true]) {
      const none = run(ALWAYS, { ...defaultConfig(), forwarding, branchPrediction: 'none' });
      const snt = run(ALWAYS, {
        ...defaultConfig(),
        forwarding,
        branchPrediction: 'static-not-taken',
      });
      expect(snt, `forwarding=${forwarding}`).toEqual(none);
    }
  });

  /**
   * THE payoff, and why `static-taken` is the MVP rather than deferrable fidelity: a correctly
   * predicted taken branch costs **1**, not 2. Derived, not measured — `N = 3` (the `addi x2`
   * fall-through dies), `S = 0`, so only `P` can differ:
   *
   * - `static-not-taken`: fetch carries on; EX corrects and kills ID+IF. `P = 2` ⇒ `3+4+0+2 = 9`.
   * - `static-taken`: ID steers fetch to `tgt` a cycle earlier; only the one already-fetched
   *   fall-through dies, and EX confirms with nothing to correct. `P = 1` ⇒ `3+4+0+1 = 8`.
   *
   * **Not 0**, and that is honest rather than a bug: the bet is placed in ID, by which time IF has
   * already fetched the fall-through. Predicting from the pc alone at IF — a BTB — is what buys a
   * free correct prediction, and it is a deferred tier (INV-5: lawful omission, never contradiction).
   */
  it('a correctly predicted taken branch costs 1 cycle, not 2', () => {
    expect(run(ALWAYS, NOT_TAKEN), 'N=3, S=0, P=2').toHaveLength(9);
    expect(run(ALWAYS, TAKEN), 'N=3, S=0, P=1 — the bet saves exactly one cycle').toHaveLength(8);

    // The saving is real work skipped, not an accounting trick: same program, same answer...
    expect(reg(last(run(ALWAYS, TAKEN)), 3)).toBe(7);
    expect(reg(last(run(ALWAYS, NOT_TAKEN)), 3)).toBe(7);
    // ...and the fall-through never commits under either scheme (INV-8's whole basis).
    expect(reg(last(run(ALWAYS, TAKEN)), 2)).toBe(0);
    expect(reg(last(run(ALWAYS, NOT_TAKEN)), 2)).toBe(0);
  });

  /**
   * The mirror, and the milestone's thesis in miniature: **a predictor is a bet, and a bet can
   * lose.** `bne x0, x0, tgt` never goes, so predict-not-taken is RIGHT and pays nothing while
   * predict-taken is WRONG and pays 2. `N = 4` — nothing dies architecturally, because the
   * fall-through the bet discarded is simply re-fetched after the correction.
   *
   * - `static-not-taken`: `P = 0` ⇒ `4+4+0+0 = 8`. A free branch.
   * - `static-taken`: `P = 2` ⇒ `4+4+0+2 = 10`. Two cycles that bought nothing.
   *
   * This is `call-return.s`'s regression, isolated: no scheme dominates.
   */
  it('a mispredicted branch costs 2 — the bet that loses', () => {
    expect(run(NEVER, NOT_TAKEN), 'P=0 — predicting not-taken is RIGHT here').toHaveLength(8);
    expect(run(NEVER, TAKEN), 'P=2 — the bet lost').toHaveLength(10);

    // The wrongly-discarded fall-through is re-fetched and runs: a misprediction costs TIME, never
    // correctness. A 0 here would mean speculation leaking into architectural state.
    expect(reg(last(run(NEVER, TAKEN)), 2)).toBe(5);
    expect(reg(last(run(NEVER, NOT_TAKEN)), 2)).toBe(5);
  });

  /**
   * `jalr` is unpredictable BY CONSTRUCTION (its target is `rs1 + imm`, a register ID has not
   * read), so it mispredicts under every scheme and always pays full price. Nothing
   * special-cases it: `speculativeTarget` returns null, `predictedTaken` is false, the transfer is
   * taken, and `predicted !== taken` falls out.
   *
   * The other half of `call-return.s`'s regression — its `jal` improves while its `ret` cannot —
   * so the null is load-bearing for the thesis rather than a gap to close later.
   */
  it('jalr pays full price under every scheme — its target is a register, not a decode', () => {
    const src = 'la x5, done\njalr x0, 0(x5)\naddi x4, x0, 99\ndone:\naddi x3, x0, 7\necall\n';
    const taken = run(src, TAKEN);
    expect(taken, 'no scheme can predict a jalr').toHaveLength(run(src, NOT_TAKEN).length);
    for (const ts of [taken, run(src, NOT_TAKEN)]) {
      const jalr = eventsOf(ts, 'branch-resolved').filter((e) => e.actual && !e.predicted);
      expect(jalr.length, 'the jalr resolved unpredicted').toBeGreaterThan(0);
      expect(reg(last(ts), 4), 'the shadow never commits').toBe(0);
      expect(reg(last(ts), 3)).toBe(7);
    }
  });

  /**
   * **The collision: a bet and a correction want the fetch pointer in the same cycle.** The one
   * real bug this step could have shipped. The reverse stage walk prevents it — but structure is
   * not proof, so it is pinned as behavior.
   *
   * The setup is the only shape that reaches it. An UNPREDICTABLE transfer (`jalr`) places no bet,
   * so it does NOT empty ID; the wrong-path instruction behind it is still sitting in ID during the
   * correction cycle — and here that instruction is itself a branch, which under `static-taken`
   * would love to bet. It must not: it was fetched after a transfer already proven to go elsewhere,
   * so it is wrong-path and about to die. A bet placed from ID would overwrite `ctx.redirect` — the
   * correction — and send the machine to `bad`.
   *
   * `stageId` returns early on `ctx.squash !== null`, and EX runs BEFORE ID in the walk, so the
   * correction is already visible when the bet would be placed. Move the bet above that early
   * return and this fails with `x4 = 99`: the machine executing code a resolved branch had ruled out.
   *
   * Note the failure is architecturally VISIBLE, so conformance would catch it — but only on a
   * program shaped like this, and the corpus has no branch behind a `jalr`. The net that would
   * catch it does not contain the case that triggers it.
   */
  it('an EX correction beats a younger ID bet — a wrong-path branch never steers fetch', () => {
    const src = [
      'la x5, done', // x5 = &done (la expands to auipc+addi; instruction count is not load-bearing)
      'jalr x0, 0(x5)', // unpredictable ⇒ mispredicts ⇒ corrects at EX, leaving ID occupied
      'beq x0, x0, bad', // WRONG-PATH branch, alive in ID during the correction. Would bet taken.
      'bad:',
      'addi x4, x0, 99', // must NEVER execute
      'done:',
      'addi x3, x0, 7',
      'ecall',
    ].join('\n');

    for (const config of [TAKEN, NOT_TAKEN]) {
      const ts = run(src, config);
      expect(reg(last(ts), 4), 'the wrong-path branch must not redirect the machine').toBe(0);
      expect(reg(last(ts), 3), 'the jalr target runs').toBe(7);
    }
  });

  /**
   * Prediction changes `P`; forwarding changes `S`. The closed form only splits into independent
   * terms if the two are genuinely orthogonal — different stages, different questions (where to
   * fetch vs. when operands are ready) — so a scheme's cycle count must not depend on the
   * forwarding position in a program with no RAW to stall on. Step 3 relies on this corpus-wide,
   * and a formula whose terms interact is not a derivation, just an equation that happens to balance.
   */
  it('prediction and forwarding are orthogonal — P is not S', () => {
    for (const scheme of [TAKEN, NOT_TAKEN]) {
      const off = run(ALWAYS, { ...scheme, forwarding: false });
      const on = run(ALWAYS, { ...scheme, forwarding: true });
      expect(on, `${scheme.branchPrediction}: S=0, so the toggle changes nothing`).toEqual(off);
    }
  });

  /**
   * A CORRECT prediction still kills something, and the event must fire. The bet discards the
   * fall-through IF had already fetched — that discarded instruction IS the "1" in "a correct
   * prediction costs 1" — so emitting a flush only on misprediction would make the cost invisible
   * to every consumer that counts casualties, and the pipeline map would draw a free prediction the
   * machine never made.
   */
  it('a correct prediction emits its own flush — one casualty, and the branch survives it', () => {
    const ts = run(ALWAYS, TAKEN);
    const flushes = eventsOf(ts, 'flush').filter((e) => e.reason !== 'halt');
    expect(flushes).toEqual([{ type: 'flush', reason: 'branch-predicted-taken', stages: ['IF'] }]);

    // The branch that placed the bet is NOT among the casualties — a bet kills one, a squash kills
    // two, and that difference is the entire saving.
    const resolved = eventsOf(ts, 'branch-resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.predicted, 'the bet').toBe(true);
    expect(resolved[0]!.actual, 'and it was right').toBe(true);
  });

  /**
   * The mirror reason. `flush.reason` is a shared surface — the pipeline map prints it as the cause
   * of death — and M3's single `'branch-taken'` is no longer sufficient: a bet on a branch that then
   * declines corrects with `actual === false`, and calling that `'branch-taken'` would state the
   * opposite of what happened.
   */
  it("a lost bet flushes as 'branch-not-taken' — the reason states what happened", () => {
    const ts = run(NEVER, TAKEN);
    const reasons = eventsOf(ts, 'flush')
      .filter((e) => e.reason !== 'halt')
      .map((e) => e.reason);
    // The bet's own casualty, then the correction's — two flushes, two cycles, one bad guess.
    expect(reasons).toEqual(['branch-predicted-taken', 'branch-not-taken']);

    const resolved = eventsOf(ts, 'branch-resolved');
    expect(resolved[0]!.predicted, 'we bet taken').toBe(true);
    expect(resolved[0]!.actual, 'it declined').toBe(false);
  });

  /**
   * **The bet is an ACTION; the flush is its COST. They are different facts, and they come apart.**
   *
   * The milestone seeded the opposite — "the bet already surfaces as a `flush` with
   * `reason: 'branch-predicted-taken'`, in the cycle it happens", which is why it thought the
   * pressure was off for a bet event. That claim is false, and this is the program that shows it:
   * with the `bne` the LAST word in `.text`, the fall-through fetch pointer is out of text on every
   * pass, so IF has nothing to lose. The flush contract forbids reporting a kill that did not
   * happen, so no flush is emitted — while the bet still redirects the pc, every single iteration.
   *
   * That makes it structural rather than a corner: a consumer reading the flush as the bet draws
   * the cost and calls it the action, and is blind exactly where the loop lives. It is also the
   * same mistake, one layer up, that `if (resolved.actual)` was in the datapath — right for the
   * wrong reason, until a config moved and the coincidence broke.
   *
   * Mutation: drop the `ctx.events.push` in `stageId` and this fails while the whole rest of the
   * suite stays green — which is exactly how the gap survived until step 5 measured it.
   */
  it('a bet with nothing in IF emits its event and NO flush — the flush is not the bet', () => {
    // No trailing `ecall`: the pipe drains off the end of `.text`, which is what empties IF.
    const src = 'addi x1, x0, 3\nloop:\naddi x1, x1, -1\nbnez x1, loop\n';
    const ts = run(src, TAKEN);

    const bets = eventsOf(ts, 'branch-predicted');
    expect(bets, 'the `bnez` bets on every pass it survives to decode').toHaveLength(3);
    // Every bet names the loop head — the engine's own number, never re-derived by a consumer.
    for (const b of bets) expect(b.target).toBe(4);

    // ...and not one of them killed anybody, so not one raised a flush. The bet is unobservable
    // here through any other surface: `branch-resolved` is a different stage, a cycle later.
    expect(eventsOf(ts, 'flush').filter((e) => e.reason === 'branch-predicted-taken')).toEqual([]);

    // The bets and the resolutions are the same three transfers seen twice — at ID, then at EX.
    const resolved = eventsOf(ts, 'branch-resolved').filter((e) => e.predicted);
    expect(resolved.map((e) => e.instr)).toEqual(bets.map((b) => b.instr));
  });

  /**
   * The bet's target is the address fetch actually goes to — step 0's safety property, now asserted
   * on the EVENT a view will label rather than on the internal function. It reads like a tautology
   * (both spell `pc + imm`) and is not: two units computing one address from different inputs at
   * different times is the shape of the classic BTB bug. Checked against the engine's own
   * `branch-resolved`, never against a re-derivation here, which would agree with a broken
   * predictor for the reason it was broken.
   */
  it("a winning bet's target IS the resolved next pc — ID and EX agree on the address", () => {
    const ts = run(ALWAYS, TAKEN);
    const bet = eventsOf(ts, 'branch-predicted');
    const resolved = eventsOf(ts, 'branch-resolved');
    expect(bet).toHaveLength(1);
    expect(bet[0]!.instr, 'the bettor is the branch itself, not its casualty').toBe(
      resolved[0]!.instr,
    );
    expect(resolved[0]!.actual, 'the bet won').toBe(true);
    expect(bet[0]!.target, "ID's guess = EX's answer").toBe(resolved[0]!.target);
  });

  /**
   * **There is no not-taken bet**, and that is the schema's half of step 1's finding. A machine
   * predicting not-taken performs no action — it keeps fetching, and the fall-through IS the
   * not-taken path — so an event there would assert something the machine did not do. The report
   * at resolution (`branch-resolved.predicted: false`) is a different thing, and it still fires.
   */
  it('never fires under a scheme that does not bet — not-taken is the absence of an action', () => {
    for (const scheme of ['none', 'static-not-taken'] as const) {
      for (const src of [ALWAYS, NEVER]) {
        const ts = run(src, { ...defaultConfig(), branchPrediction: scheme });
        expect(eventsOf(ts, 'branch-predicted'), `${scheme}`).toEqual([]);
        // ...while the RESOLUTION still reports the standing prediction. Absence of the action,
        // not absence of the answer.
        expect(
          eventsOf(ts, 'branch-resolved').every((e) => !e.predicted),
          `${scheme}`,
        ).toBe(true);
      }
    }
  });

  /**
   * A wrong-path branch never bets (`stageId` returns early on `ctx.squash`), so it must not emit
   * the event either — the sibling of the pinned "an EX correction beats a younger ID bet". The
   * event and the redirect are the same fact, so a bet event with no redirect behind it would be a
   * consumer-visible lie about where fetch went.
   */
  it('a squashed wrong-path branch emits no bet — the event and the redirect are one fact', () => {
    const src = [
      'la x5, done',
      'jalr x0, 0(x5)', // unpredictable ⇒ corrects at EX, leaving ID occupied
      'beq x0, x0, bad', // wrong-path, and would love to bet
      'bad:',
      'addi x4, x0, 99',
      'done:',
      'addi x3, x0, 7',
      'ecall',
    ].join('\n');
    const ts = run(src, TAKEN);
    expect(reg(last(ts), 4), 'the wrong-path code must never run').toBe(0);
    // The `beq` sits in ID during the correction. It emits no bet, because it placed none.
    const bettors = new Set(eventsOf(ts, 'branch-predicted').map((e) => e.instr));
    const wrongPath = eventsOf(ts, 'instr-fetch').filter((e) => e.pc === 12); // the `beq`
    // Non-vacuity FIRST: a `for` over an empty array asserts nothing, and "the wrong-path branch
    // was never fetched at all" would pass the loop below while testing none of this.
    expect(
      wrongPath.length,
      'the wrong-path `beq` was never fetched — the test tests nothing',
    ).toBeGreaterThan(0);
    for (const f of wrongPath) expect(bettors.has(f.instr), 'wrong-path branch bet').toBe(false);

    // The other half of non-vacuity, and the first draft got it wrong in a way worth keeping: the
    // guard to write is NOT "some bet fired in this run" — nothing in this program CAN bet (the
    // `jalr` is unpredictable and the `beq` is condemned), so that guard fails on a correct engine.
    // The claim that makes the silence meaningful is that this very instruction WOULD bet if it
    // were real. A `beq x0, x0` on the live path does; so the wrong-path one is declining, not
    // unable, and its silence is a decision rather than the scheme being off.
    expect(
      eventsOf(run(ALWAYS, TAKEN), 'branch-predicted'),
      'a live `beq` does not bet either — the scheme is not under test here',
    ).not.toEqual([]);
  });
});

describe('halt with drain', () => {
  it('squashes the one live instruction behind an ecall', () => {
    // Not hypothetical: `call-return.s` puts the real `max:` function directly behind its `ecall`.
    // Under the retire-pc rule a shadow's redirect is harmless (it only moves the
    // microarchitectural fetch pointer), but a shadow STORE would sit in MEM the same cycle the
    // halt sits in WB — making architectural memory depend on intra-cycle stage order. Squash
    // instead of resting architectural state on that accident.
    const ts = run(
      ['.text', 'addi x1, x0, 1', 'ecall', 'addi x2, x0, 99', `sw x1, ${SCRATCH}(x0)`].join('\n'),
      ON,
    );
    const ecall = idOfNth(ts, 1);

    const decodeCycle = ts.findIndex((t) =>
      t.instructions.some((i) => i.id === ecall && i.location === 'ID'),
    );
    expect(ts[decodeCycle]!.events.filter((e) => e.type === 'flush')).toEqual([
      { type: 'flush', reason: 'halt', stages: ['IF'] },
    ]);
    // ...and it names a real casualty: the instruction the trace says died in IF is the shadow.
    expect(ts[decodeCycle]!.instructions.some((i) => i.location === 'IF')).toBe(true);

    // The shadow was fetched (it is real code) and died in IF; the store behind it was never
    // fetched at all, because fetching stops here.
    const shadow = ts[decodeCycle]!.instructions.find((i) => i.location === 'IF')!;
    expect(walk(ts, shadow.id)).toEqual(['IF']);
    expect(eventsOf(ts, 'instr-fetch')).toHaveLength(3); // addi, ecall, shadow — never the sw

    expect(reg(last(ts), 2)).toBe(0); // the shadow never committed
    expect(last(ts).state.memory.readWord(SCRATCH)).toBe(0); // nor did anything behind it
  });

  it('emits no flush for an ecall that kills nothing', () => {
    // The contract `flush` makes is "an instruction DIED", not "a wire went high" — so a flush
    // signal that finds the stages empty is not an event. This is the common case, not a corner:
    // three of the five corpus programs end with `ecall` as their last instruction, so there is
    // nothing behind it to squash. The curriculum can trigger on a bare `{ event: 'flush' }`, and
    // it must never announce a bubble that did not happen.
    const ts = run(['.text', 'addi x1, x0, 1', 'ecall'].join('\n'), ON);
    expect(eventsOf(ts, 'flush')).toEqual([]);
  });

  it('halts at the ecall with pc on the ecall itself, not on the fetch pointer', () => {
    const ts = run(['.text', 'addi x1, x0, 1', 'ecall'].join('\n'), ON);
    const ecall = idOfNth(ts, 1);
    const ecallPc = ts.flatMap((t) => t.instructions).find((i) => i.id === ecall)!.pc;
    // The fetch pointer ran ahead of this long ago; it must never surface in MachineState.
    expect(last(ts).state.pc).toBe(ecallPc);
    expect(last(ts).state.halted).toBe(true);
  });

  it('drains the pipe when the fetch pointer leaves text, instead of truncating the run', () => {
    // `add.s` has NO ecall — it runs off the end of `.text`. The fetch pointer leaves text while
    // three instructions are still in flight, so "fetch left text" must STOP FETCHING, not halt:
    // halting there would lose every in-flight result. This is the second halt path, and the one
    // the original plan's seed missed entirely.
    const ts = run(ADD_S, ON);

    // Fetch stops early (cycle 3 fetches nothing) but the machine runs on for three more cycles.
    expect(eventsOf(ts, 'instr-fetch')).toHaveLength(3);
    expect(ts).toHaveLength(7);

    // All three retire, in program order, and the LAST one is what halts the machine.
    expect(eventsOf(ts, 'instr-retire').map((e) => e.instr)).toEqual([
      idOfNth(ts, 0),
      idOfNth(ts, 1),
      idOfNth(ts, 2),
    ]);
    expect(reg(last(ts), 5)).toBe(42); // the in-flight result survived the drain
    expect(last(ts).state.halted).toBe(true);
    // Architectural pc is the last retiree's nextPc: one word past the end of text.
    expect(last(ts).state.pc).toBe(last(ts).instructions[0]!.pc + 4);
  });

  it('is halted from the start on a program with no text', () => {
    const p = new PipelineProcessor();
    p.reset(toProgramImage(asm('.text')), ON);
    expect(p.isHalted()).toBe(true);
    expect(() => p.step()).toThrow(/halted/);
  });
});
