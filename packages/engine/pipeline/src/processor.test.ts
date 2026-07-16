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
    // Deferred to M4 — feature toggles ON this pipeline (§12.3), not part of M3.
    expect(PIPELINE_CAPABILITIES.configurableBranchPrediction).toBe(false);
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
      { type: 'flush', reason: 'branch-taken', stages: ['IF', 'ID'] },
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

    // The shadow was fetched (it is real code) and died in IF; the store behind it was never
    // fetched at all, because fetching stops here.
    const shadow = ts[decodeCycle]!.instructions.find((i) => i.location === 'IF')!;
    expect(walk(ts, shadow.id)).toEqual(['IF']);
    expect(eventsOf(ts, 'instr-fetch')).toHaveLength(3); // addi, ecall, shadow — never the sw

    expect(reg(last(ts), 2)).toBe(0); // the shadow never committed
    expect(last(ts).state.memory.readWord(SCRATCH)).toBe(0); // nor did anything behind it
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
