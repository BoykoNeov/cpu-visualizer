import { describe, expect, it } from 'vitest';
import { assemble, emptyProgram, type AssembledProgram } from '@cpu-viz/assembler';
import { defaultConfig, type CycleTrace, type TraceEvent } from '@cpu-viz/trace';
import { toProgramImage } from '@cpu-viz/engine-common';
import {
  MultiCycleProcessor,
  MULTI_CYCLE_CAPABILITIES,
  type MultiCycleMicro,
  type Phase,
} from './index';

/**
 * Multi-cycle engine tests — the REAL verification of this model. The INV-8 differential net
 * (differential.test.ts) proves only final architectural state, which is model-invariant; it
 * says nothing about the model's soul: the per-class phase plan, the event→phase mapping, the
 * `micro` latch contents, id-stability-across-cycles, and the varying cycle counts. Those are
 * pinned HERE, with expectations hand-derived from first principles (not pasted from the engine's
 * own output). Programs are built with the real assembler.
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

function makeProc(source: string): MultiCycleProcessor {
  const p = new MultiCycleProcessor();
  p.reset(toProgramImage(asm(source)));
  return p;
}

/** Drive to halt, collecting every CycleTrace. (`TraceRecorder` is exercised separately in
 *  recorder.test.ts; this keeps the semantics suite independent of the driver.) */
function runAll(p: MultiCycleProcessor, maxCycles = 2000): CycleTrace[] {
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    if (traces.length >= maxCycles) throw new Error('exceeded maxCycles — runaway loop?');
    traces.push(p.step());
  }
  return traces;
}

const run = (source: string): CycleTrace[] => runAll(makeProc(source));
const last = (ts: CycleTrace[]): CycleTrace => ts[ts.length - 1]!;
const sreg = (t: CycleTrace, i: number): number => t.state.registers[i]!;
const ureg = (t: CycleTrace, i: number): number => t.state.registers[i]! >>> 0;
const types = (t: CycleTrace): TraceEvent['type'][] => t.events.map((e) => e.type);
const micro = (t: CycleTrace): MultiCycleMicro => t.state.micro as MultiCycleMicro;

/** Every trace in which the (single) in-flight instruction is the given mnemonic. */
const tracesOf = (ts: CycleTrace[], mnemonic: string): CycleTrace[] =>
  ts.filter((t) => t.instructions[0]!.decoded.mnemonic === mnemonic);
/** The phase walk (locations) of a mnemonic that executes exactly once in the program. */
const walk = (ts: CycleTrace[], mnemonic: string): Phase[] =>
  tracesOf(ts, mnemonic).map((t) => t.instructions[0]!.location as Phase);

/**
 * Did `<mnemonic> x1, x2, taken` jump? Loads a/b into x1/x2, records which path ran (taken →
 * x10=200, fall-through → x10=100). Mirrors single-cycle's oracle so both suites pin the same
 * signed/unsigned branch behavior independently.
 */
function branchTaken(mnemonic: string, a: number, b: number): boolean {
  const ts = run(
    [
      '.text',
      `addi x1, x0, ${a}`,
      `addi x2, x0, ${b}`,
      `${mnemonic} x1, x2, taken`,
      'addi x10, x0, 100',
      'j done',
      'taken:',
      'addi x10, x0, 200',
      'done:',
      'ecall',
    ].join('\n'),
  );
  return sreg(last(ts), 10) === 200;
}

describe('multi-cycle: model identity', () => {
  it('advertises stages/latches but no hazards (one instruction in flight)', () => {
    expect(MULTI_CYCLE_CAPABILITIES).toEqual({
      model: 'multi-cycle',
      pipelined: false,
      hasHazards: false,
      configurableForwarding: false,
      configurableBranchPrediction: false,
      configurableCache: false,
      configurableIssueWidth: false,
      configurableOutOfOrder: false,
    });
  });
});

describe('multi-cycle: per-class phase plan & varying cycle counts (§12.1)', () => {
  // The canonical decomposition: IF+ID universal; EX iff the main ALU is used; MEM iff data
  // memory is touched; WB iff a register is written. Hand-derived per class below.

  it('an R-type walks IF→ID→EX→WB (4 cycles, skips MEM)', () => {
    const ts = run(
      ['.text', 'addi x1, x0, 5', 'addi x2, x0, 37', 'add x5, x1, x2', 'ecall'].join('\n'),
    );
    expect(walk(ts, 'add')).toEqual(['IF', 'ID', 'EX', 'WB']);
  });

  it('an I-type ALU op walks IF→ID→EX→WB (4 cycles)', () => {
    const ts = run(['.text', 'addi x1, x0, 5', 'ecall'].join('\n'));
    expect(walk(ts, 'addi')).toEqual(['IF', 'ID', 'EX', 'WB']);
  });

  it('a load walks IF→ID→EX→MEM→WB (5 cycles) — the longest path', () => {
    const ts = run(
      ['.data', 'v: .word 7', '.text', 'la x1, v', 'lw x2, 0(x1)', 'ecall'].join('\n'),
    );
    expect(walk(ts, 'lw')).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);
  });

  it('a store walks IF→ID→EX→MEM (4 cycles, skips WB — no register written)', () => {
    const ts = run(
      [
        '.data',
        'v: .word 0',
        '.text',
        'la   x1, v',
        'addi x2, x0, 9',
        'sw   x2, 0(x1)',
        'ecall',
      ].join('\n'),
    );
    expect(walk(ts, 'sw')).toEqual(['IF', 'ID', 'EX', 'MEM']);
  });

  it('a branch walks IF→ID→EX (3 cycles — resolves in EX, no MEM/WB)', () => {
    const ts = run(['.text', 'addi x1, x0, 1', 'beq x1, x1, tgt', 'tgt:', 'ecall'].join('\n'));
    expect(walk(ts, 'beq')).toEqual(['IF', 'ID', 'EX']);
  });

  // Step 5c: PC arithmetic routes through the main ALU, so `jal` (target pc+imm) and `auipc`
  // (pc+imm) gained an EX. `lui` did not — it is a pure immediate pass-through with no PC
  // arithmetic to route, which leaves it ALONE in the IF/ID/WB class. That split is the point
  // of this test: it pins that 5c moved exactly the two PC-arithmetic classes and no others.
  it('jal / auipc walk IF→ID→EX→WB (4 cycles — 5c routes pc+imm through the ALU)', () => {
    const jalTs = run(['.text', 'jal x1, tgt', 'tgt:', 'ecall'].join('\n'));
    expect(walk(jalTs, 'jal')).toEqual(['IF', 'ID', 'EX', 'WB']);

    const auipcTs = run(['.text', 'auipc x1, 1', 'ecall'].join('\n'));
    expect(walk(auipcTs, 'auipc')).toEqual(['IF', 'ID', 'EX', 'WB']);
  });

  it('lui alone still walks IF→ID→WB (3 cycles — immediate pass-through, no ALU)', () => {
    const luiTs = run(['.text', 'lui x1, 0x12345', 'ecall'].join('\n'));
    expect(walk(luiTs, 'lui')).toEqual(['IF', 'ID', 'WB']);
  });

  it('jalr walks IF→ID→EX→WB (4 cycles — it does use the ALU: rs1 + imm)', () => {
    const ts = run(['.text', 'jal x1, func', 'ecall', 'func:', 'jalr x0, x1, 0'].join('\n'));
    expect(walk(ts, 'jalr')).toEqual(['IF', 'ID', 'EX', 'WB']);
  });

  it('ecall / ebreak / fence walk IF→ID (2 cycles — decode, then halt or no-op)', () => {
    expect(walk(run(['.text', 'ecall'].join('\n')), 'ecall')).toEqual(['IF', 'ID']);
    expect(walk(run(['.text', 'ebreak'].join('\n')), 'ebreak')).toEqual(['IF', 'ID']);
    expect(walk(run(['.text', 'fence', 'ecall'].join('\n')), 'fence')).toEqual(['IF', 'ID']);
  });

  it('the classes take DIFFERENT cycle counts: load(5) > R-type(4) > lui(3) > ecall(2)', () => {
    const cyc = (source: string, mnemonic: string): number =>
      tracesOf(run(source), mnemonic).length;
    expect(cyc('.data\nv: .word 7\n.text\nla x1, v\nlw x2, 0(x1)\necall', 'lw')).toBe(5);
    expect(cyc('.text\naddi x1, x0, 5\necall', 'addi')).toBe(4);
    // `lui` carries the 3-cycle rung since 5c moved `jal` up to 4 (it is now the only class there).
    expect(cyc('.text\nlui x1, 5\necall', 'lui')).toBe(3);
    expect(cyc('.text\njal x1, t\nt:\necall', 'jal')).toBe(4);
    expect(cyc('.text\necall', 'ecall')).toBe(2);
  });
});

describe('multi-cycle: events fire in the phase they belong to', () => {
  it('R-type: fetch@IF, reg-reads@ID, alu-op@EX, reg-write+retire@WB', () => {
    const ts = run(
      ['.text', 'addi x1, x0, 5', 'addi x2, x0, 37', 'add x5, x1, x2', 'ecall'].join('\n'),
    );
    const add = tracesOf(ts, 'add');
    expect(add.map((t) => [t.instructions[0]!.location, types(t)])).toEqual([
      ['IF', ['instr-fetch']],
      ['ID', ['reg-read', 'reg-read']],
      ['EX', ['alu-op']],
      ['WB', ['reg-write', 'instr-retire']],
    ]);
    // The ALU op is emitted at EX with the operands read at ID (x1=5, x2=37 → 42).
    const aluCycle = add.find((t) => t.instructions[0]!.location === 'EX')!;
    expect(aluCycle.events[0]).toEqual({
      type: 'alu-op',
      op: 'add',
      a: 5,
      b: 37,
      result: 42,
      instr: add[0]!.instructions[0]!.id,
    });
  });

  it('load: mem-read@MEM, reg-write@WB — the value flows memory → register a cycle later', () => {
    const ts = run(
      ['.data', 'v: .word 0x12345678', '.text', 'la x1, v', 'lw x2, 0(x1)', 'ecall'].join('\n'),
    );
    const lw = tracesOf(ts, 'lw');
    expect(lw.map((t) => [t.instructions[0]!.location, types(t)])).toEqual([
      ['IF', ['instr-fetch']],
      ['ID', ['reg-read']],
      ['EX', ['alu-op']],
      ['MEM', ['mem-read']],
      ['WB', ['reg-write', 'instr-retire']],
    ]);
    const memCycle = lw.find((t) => t.instructions[0]!.location === 'MEM')!;
    const memRead = memCycle.events[0]!;
    expect(memRead.type === 'mem-read' && memRead.value >>> 0).toBe(0x12345678);
    expect(ureg(last(ts), 2)).toBe(0x12345678);
  });

  it('store: retires at MEM (its last phase); the write is the MEM event', () => {
    const ts = run(
      ['.data', 'v: .word 0', '.text', 'la x1, v', 'addi x2, x0, 9', 'sw x2, 0(x1)', 'ecall'].join(
        '\n',
      ),
    );
    const sw = tracesOf(ts, 'sw');
    expect(sw.map((t) => [t.instructions[0]!.location, types(t)])).toEqual([
      ['IF', ['instr-fetch']],
      ['ID', ['reg-read', 'reg-read']],
      ['EX', ['alu-op']],
      ['MEM', ['mem-write', 'instr-retire']],
    ]);
  });

  it('lui reads no register and uses no ALU: ID is an empty cycle, value lands at WB', () => {
    const ts = run(['.text', 'lui x1, 0x12345', 'ecall'].join('\n'));
    const lui = tracesOf(ts, 'lui');
    expect(lui.map((t) => [t.instructions[0]!.location, types(t)])).toEqual([
      ['IF', ['instr-fetch']],
      ['ID', []],
      ['WB', ['reg-write', 'instr-retire']],
    ]);
    expect(ureg(last(ts), 1)).toBe(0x12345000);
  });

  it('jal / lui / auipc read NO source register — the U/J formats have none', () => {
    for (const src of [
      '.text\njal x1, t\nt:\necall',
      '.text\nlui x1, 5\necall',
      '.text\nauipc x1, 1\necall',
    ]) {
      const evs = run(src)
        .filter((t) => t.instructions[0]!.decoded.mnemonic !== 'ecall')
        .flatMap(types);
      expect(evs).not.toContain('reg-read');
    }
  });

  // Step 5c: `jal`/`auipc` DO emit an alu-op now — but its operands are `pc` and the immediate,
  // never a register (the test above). That is precisely the PC-arithmetic ALU use 5c added, and
  // it is what lets the datapath draw ALUOut→PC without contradicting the trace.
  it('jal / auipc emit an alu-op over (pc, imm) at EX; lui still emits none', () => {
    const aluOps = (source: string): TraceEvent[] =>
      run(source)
        .flatMap((t) => t.events)
        .filter((e) => e.type === 'alu-op');

    const jalAlu = aluOps('.text\njal x1, t\nt:\necall');
    expect(jalAlu).toHaveLength(1);
    // pc=0, imm=4 → target 4. The LINK (pc+4) is NOT this value: it comes from the incrementer.
    expect(jalAlu[0]).toMatchObject({ op: 'add', a: 0, b: 4, result: 4 });

    const auipcAlu = aluOps('.text\nauipc x1, 1\necall');
    expect(auipcAlu).toHaveLength(1);
    expect(auipcAlu[0]).toMatchObject({ op: 'add', a: 0, result: 0x1000 });

    expect(aluOps('.text\nlui x1, 5\necall')).toHaveLength(0);
  });
});

describe('multi-cycle: micro latches fill progressively (independent per-cycle snapshots)', () => {
  it('a load fills IR@IF, A@ID, ALUOut@EX, MDR@MEM — each cycle carries only what is latched', () => {
    const ts = run(
      ['.data', 'v: .word 0x000000ff', '.text', 'la x1, v', 'lw x2, 0(x1)', 'ecall'].join('\n'),
    );
    const lw = tracesOf(ts, 'lw');
    const enc = lw[0]!.instructions[0]!.encoding;
    const addr = 0x1000_0000; // DATA_BASE, where v lands and x1 points

    expect(micro(lw[0]!)).toEqual({
      phase: 'IF',
      ir: enc,
      a: null,
      b: null,
      aluOut: null,
      mdr: null,
    });
    expect(micro(lw[1]!)).toEqual({
      phase: 'ID',
      ir: enc,
      a: addr,
      b: null,
      aluOut: null,
      mdr: null,
    });
    expect(micro(lw[2]!)).toEqual({
      phase: 'EX',
      ir: enc,
      a: addr,
      b: null,
      aluOut: addr,
      mdr: null,
    });
    expect(micro(lw[3]!)).toEqual({
      phase: 'MEM',
      ir: enc,
      a: addr,
      b: null,
      aluOut: addr,
      mdr: 0xff,
    });
    expect(micro(lw[4]!)).toEqual({
      phase: 'WB',
      ir: enc,
      a: addr,
      b: null,
      aluOut: addr,
      mdr: 0xff,
    });
  });

  it('an R-type fills A and B at ID, ALUOut at EX, and never an MDR (no memory)', () => {
    const ts = run(
      ['.text', 'addi x1, x0, 5', 'addi x2, x0, 37', 'add x5, x1, x2', 'ecall'].join('\n'),
    );
    const add = tracesOf(ts, 'add');
    expect(micro(add[1]!)).toMatchObject({ phase: 'ID', a: 5, b: 37, aluOut: null, mdr: null });
    expect(micro(add[2]!)).toMatchObject({ phase: 'EX', a: 5, b: 37, aluOut: 42, mdr: null });
    expect(micro(add[3]!)).toMatchObject({ phase: 'WB', a: 5, b: 37, aluOut: 42, mdr: null });
  });

  it('earlier cycles keep their frozen micro after the run completes (no live aliasing)', () => {
    const ts = run(
      ['.data', 'v: .word 5', '.text', 'la x1, v', 'lw x2, 0(x1)', 'ecall'].join('\n'),
    );
    const lw = tracesOf(ts, 'lw');
    // If micro aliased a live latch object, the IF snapshot would show the MEM value by now.
    expect(micro(lw[0]!).aluOut).toBeNull();
    expect(micro(lw[0]!).mdr).toBeNull();
    expect(micro(lw[2]!).mdr).toBeNull(); // EX snapshot: MDR still unlatched
  });

  it('pre-run getState() carries no micro (nothing is in flight yet)', () => {
    const p = makeProc(['.text', 'addi x1, x0, 5', 'ecall'].join('\n'));
    expect(p.getState().micro).toBeNull();
  });
});

describe('multi-cycle: instruction identity across its multi-cycle lifetime (INV-4)', () => {
  it('one instruction keeps ONE stable id across all of its phase-cycles', () => {
    const ts = run(
      ['.text', 'addi x1, x0, 5', 'addi x2, x0, 37', 'add x5, x1, x2', 'ecall'].join('\n'),
    );
    const add = tracesOf(ts, 'add');
    expect(add).toHaveLength(4); // IF ID EX WB
    expect(new Set(add.map((t) => t.instructions[0]!.id)).size).toBe(1);
  });

  it('each dynamic execution of a looping instruction gets a fresh id, each spanning 4 cycles', () => {
    const ts = run(
      [
        '.text',
        'addi x1, x0, 0', // sum
        'addi x2, x0, 5', // i
        'loop:',
        'add  x1, x1, x2', // sum += i  (same pc, re-fetched each iteration)
        'addi x2, x2, -1',
        'bne  x2, x0, loop',
        'ecall',
      ].join('\n'),
    );
    expect(sreg(last(ts), 1)).toBe(15); // 5+4+3+2+1

    const addPc = 8; // `add x1, x1, x2`
    const addTraces = ts.filter((t) => t.instructions[0]!.pc === addPc);
    expect(addTraces).toHaveLength(20); // 5 executions × 4 cycles each
    const ids = addTraces.map((t) => t.instructions[0]!.id);
    expect(new Set(ids).size).toBe(5); // five distinct dynamic instances

    // Each distinct id spans exactly its 4 phases in order.
    for (const id of new Set(ids)) {
      const walked = addTraces
        .filter((t) => t.instructions[0]!.id === id)
        .map((t) => t.instructions[0]!.location);
      expect(walked).toEqual(['IF', 'ID', 'EX', 'WB']);
    }
  });
});

describe('multi-cycle: control & halting', () => {
  it('runs add (5 + 37 = 42) and halts on ecall without advancing pc', () => {
    const ts = run(
      ['.text', 'addi x1, x0, 5', 'addi x2, x0, 37', 'add x5, x1, x2', 'ecall'].join('\n'),
    );
    // 4 + 4 + 4 (three ALU ops) + 2 (ecall) = 14 cycles.
    expect(ts).toHaveLength(14);
    expect(sreg(last(ts), 5)).toBe(42);
    expect(last(ts).state.halted).toBe(true);
    expect(last(ts).state.pc).toBe(12); // ecall's own pc (4th word) — not advanced
    expect(last(ts).cycle).toBe(13); // 0-based cycle counter
  });

  it('halts off the end of text (no ecall): final pc = the out-of-range value', () => {
    const ts = run(['.text', 'addi x1, x0, 5', 'addi x2, x0, 37', 'add x5, x1, x2'].join('\n'));
    expect(ts).toHaveLength(12); // 3 ALU ops × 4 cycles, no ecall
    expect(sreg(last(ts), 5)).toBe(42);
    expect(last(ts).state.halted).toBe(true);
    expect(last(ts).state.pc).toBe(12); // ran one word past the last instruction
  });

  it('treats ebreak as a halt and fence as a no-op', () => {
    const brk = run(['.text', 'addi x1, x0, 1', 'ebreak'].join('\n'));
    expect(last(brk).state.halted).toBe(true);
    expect(sreg(last(brk), 1)).toBe(1);

    const fen = run(['.text', 'fence', 'addi x1, x0, 5', 'ecall'].join('\n'));
    expect(sreg(last(fen), 1)).toBe(5);
    expect(fen).toHaveLength(2 + 4 + 2); // fence(2) + addi(4) + ecall(2)
  });

  it('halts loudly on an unknown instruction word (IF→ID, 2 cycles)', () => {
    const p = new MultiCycleProcessor();
    p.reset(
      toProgramImage({
        words: new Uint32Array([0xffffffff]),
        sourceMap: new Map(),
        symbols: new Map(),
        data: [],
      }),
    );
    const ts = runAll(p);
    expect(ts).toHaveLength(2);
    expect(last(ts).state.halted).toBe(true);
    expect(last(ts).instructions[0]!.decoded.mnemonic).toBe('unknown');
    expect(ts.map((t) => t.instructions[0]!.location)).toEqual(['IF', 'ID']);
  });

  it('is halted from reset on the empty program, and step() then throws', () => {
    const p = new MultiCycleProcessor();
    p.reset(toProgramImage(emptyProgram()));
    expect(p.isHalted()).toBe(true);
    expect(() => p.step()).toThrow(/halted/);
  });

  it('throws if stepped after an architectural halt', () => {
    const p = makeProc(['.text', 'addi x1, x0, 5', 'ecall'].join('\n'));
    runAll(p);
    expect(p.isHalted()).toBe(true);
    expect(() => p.step()).toThrow(/halted/);
  });

  it('reset() ignores config (multi-cycle honors none)', () => {
    const image = toProgramImage(asm(['.text', 'addi x1, x0, 5', 'ecall'].join('\n')));
    const a = new MultiCycleProcessor();
    a.reset(image, defaultConfig());
    const b = new MultiCycleProcessor();
    b.reset(image, { forwarding: true, branchPrediction: 'static-taken', cache: null, seed: 7 });
    expect(sreg(last(runAll(a)), 1)).toBe(5);
    expect(sreg(last(runAll(b)), 1)).toBe(5);
  });
});

describe('multi-cycle: per-cycle architectural state is an independent snapshot', () => {
  it('a register written at WB shows the OLD value in that instruction’s pre-WB cycles', () => {
    const ts = run(['.text', 'addi x1, x0, 7', 'ecall'].join('\n'));
    const addi = tracesOf(ts, 'addi');
    // Commit is at WB: IF/ID/EX snapshots still read x1 = 0; only WB shows 7.
    expect(sreg(addi[0]!, 1)).toBe(0); // IF
    expect(sreg(addi[1]!, 1)).toBe(0); // ID
    expect(sreg(addi[2]!, 1)).toBe(0); // EX
    expect(sreg(addi[3]!, 1)).toBe(7); // WB
  });

  it('a register overwritten by successive instructions keeps its per-cycle value', () => {
    const ts = run(
      ['.text', 'addi x1, x0, 1', 'addi x1, x0, 2', 'addi x1, x0, 3', 'ecall'].join('\n'),
    );
    // WB of each addi is the 4th cycle of its 4-cycle span: cycles 3, 7, 11.
    expect(sreg(ts[3]!, 1)).toBe(1); // frozen at addi#1's WB
    expect(sreg(ts[7]!, 1)).toBe(2);
    expect(sreg(ts[11]!, 1)).toBe(3);
    // If snapshots aliased the live file, ts[3] would already read the final 3.
    expect(sreg(last(ts), 1)).toBe(3);
  });

  it('a store commits memory at MEM; earlier cycles read the old memory', () => {
    const addr = 0x1000_0000;
    const ts = run(
      [
        '.data',
        'slot: .word 0',
        '.text',
        'la   x1, slot',
        'addi x2, x0, 0x111',
        'sw   x2, 0(x1)', // memory := 0x111
        'addi x2, x0, 0x222',
        'sw   x2, 0(x1)', // memory := 0x222
        'ecall',
      ].join('\n'),
    );
    const firstStore = tracesOf(ts, 'sw')[0]!; // its own 4-cycle span
    // Slice the first sw's cycles: IF ID EX read old (0), MEM commits 0x111.
    const sw1 = ts.filter((t) => t.instructions[0]!.id === firstStore.instructions[0]!.id);
    expect(sw1.map((t) => t.state.memory.readWord(addr))).toEqual([0, 0, 0, 0x111]);
    expect(last(ts).state.memory.readWord(addr)).toBe(0x222);
  });
});

describe('multi-cycle: ISA sign-handling parity (the classic traps, mirrored from the reference)', () => {
  it('sltiu sign-extends the immediate then compares unsigned; slti is signed', () => {
    const ts = run(['.text', 'sltiu x1, x0, -1', 'slti x2, x0, -1', 'ecall'].join('\n'));
    expect(sreg(last(ts), 1)).toBe(1); // 0 < 0xffffffff (unsigned)
    expect(sreg(last(ts), 2)).toBe(0); // 0 < -1 (signed) is false
  });

  it('srli is logical, srai is arithmetic; srl/sra likewise (register forms)', () => {
    const ts = run(
      [
        '.text',
        'lui x1, 0x80000',
        'srli x2, x1, 4',
        'srai x3, x1, 4',
        'addi x4, x0, 4',
        'srl x5, x1, x4',
        'sra x6, x1, x4',
        'ecall',
      ].join('\n'),
    );
    expect(ureg(last(ts), 2)).toBe(0x08000000); // zero-filled
    expect(ureg(last(ts), 3)).toBe(0xf8000000); // sign-filled
    expect(ureg(last(ts), 5)).toBe(0x08000000);
    expect(ureg(last(ts), 6)).toBe(0xf8000000);
  });

  it('slt is signed, sltu is unsigned (-1 vs 1)', () => {
    const ts = run(
      [
        '.text',
        'addi x1, x0, -1',
        'addi x2, x0, 1',
        'slt x3, x1, x2',
        'sltu x4, x1, x2',
        'ecall',
      ].join('\n'),
    );
    expect(sreg(last(ts), 3)).toBe(1); // signed: -1 < 1
    expect(sreg(last(ts), 4)).toBe(0); // unsigned: 0xffffffff < 1 is false
  });

  it('distinguishes signed (blt/bge) from unsigned (bltu/bgeu), and beq/bne', () => {
    expect(branchTaken('beq', 5, 5)).toBe(true);
    expect(branchTaken('bne', 5, 5)).toBe(false);
    expect(branchTaken('blt', -1, 1)).toBe(true);
    expect(branchTaken('bltu', -1, 1)).toBe(false);
    expect(branchTaken('bge', -1, 1)).toBe(false);
    expect(branchTaken('bgeu', -1, 1)).toBe(true);
  });

  it('sign-extends lb/lh; lbu/lhu zero-extend', () => {
    const ts = run(
      [
        '.data',
        'val: .word 0x800000ff', // bytes LE: ff 00 00 80
        '.text',
        'la  x1, val',
        'lb  x2, 0(x1)', // 0xff -> -1
        'lbu x3, 0(x1)', // 0xff -> 255
        'lh  x4, 2(x1)', // 0x8000 -> -32768
        'lhu x5, 2(x1)', // 0x8000 -> 32768
        'ecall',
      ].join('\n'),
    );
    expect(sreg(last(ts), 2)).toBe(-1);
    expect(sreg(last(ts), 3)).toBe(255);
    expect(sreg(last(ts), 4)).toBe(-32768);
    expect(sreg(last(ts), 5)).toBe(32768);
  });
});

describe('multi-cycle: jumps round-trip, including jalr with rd == rs1 (target uses the pre-write value)', () => {
  it('jal links the return address and jalr returns to it', () => {
    const ts = run(
      [
        '.text',
        'addi x1, x0, 0',
        'jal  x5, func',
        'addi x1, x1, 100', // runs after return
        'ecall',
        'func:',
        'addi x1, x1, 7',
        'jalr x0, x5, 0', // return
      ].join('\n'),
    );
    expect(sreg(last(ts), 1)).toBe(107); // 7 in func, then +100 after return
  });

  it('jalr x5, x5, 0 computes the target from the OLD x5, then overwrites x5 with pc+4', () => {
    // rd == rs1: if the target were computed AFTER the write-back, it would jump to (pc+4)
    // (off the end of text here) and x1 would stay 7. Correct behavior returns and reaches 107.
    const ts = run(
      [
        '.text', // pc 0:  addi x1, x0, 0
        'addi x1, x0, 0', // pc 0
        'jal  x5, func', // pc 4:  x5 = 8 (return addr)
        'addi x1, x1, 100', // pc 8:  runs after the return
        'ecall', // pc 12
        'func:', // pc 16
        'addi x1, x1, 7', // pc 16
        'jalr x5, x5, 0', // pc 20: rd == rs1 == x5
      ].join('\n'),
    );
    expect(sreg(last(ts), 1)).toBe(107); // proves it returned to pc 8 using the OLD x5 (=8)
    expect(sreg(last(ts), 5)).toBe(24); // the return link written to x5 = jalr_pc(20) + 4
  });
});

/**
 * M7 step 1 — `issueWidth` is inert here, in the strong form: the ENTIRE trace array is compared,
 * cycle for cycle, not just a final register. For a timing knob that distinction is the whole
 * point — a width that leaked into this model would move cycle counts and phase boundaries while
 * leaving every architectural result untouched, which is precisely what a final-state check cannot
 * see. Multi-cycle is the model where that would show up most visibly, since its cycle count
 * already varies by instruction class.
 *
 * The source carries a backward branch, a store and a load — the three things a width knob would
 * plausibly perturb if it leaked into fetch, memory, or the loop.
 */
const WIDTH_PROBE = [
  '.text',
  'addi x1, x0, 4',
  'addi x2, x0, 0',
  'loop:',
  'addi x2, x2, 3',
  'addi x1, x1, -1',
  'bne x1, x0, loop',
  'sw x2, 256(x0)',
  'lw x3, 256(x0)',
  'ecall',
].join('\n');

describe('issueWidth (M7 step 1)', () => {
  it('is inert — the whole trace is identical at width 1 and width 2', () => {
    const image = toProgramImage(asm(WIDTH_PROBE));
    const at = (issueWidth: number): CycleTrace[] => {
      const p = new MultiCycleProcessor();
      p.reset(image, { ...defaultConfig(), issueWidth });
      return runAll(p);
    };
    expect(at(2)).toEqual(at(1));
  });

  it('declares it does not honor the knob', () => {
    expect(MULTI_CYCLE_CAPABILITIES.configurableIssueWidth).toBe(false);
  });
});

/**
 * M9 step 0 — the out-of-order config cluster (`outOfOrderIssue`, `robSize`, `slowOpLatency`) is
 * inert here, whole-trace. A multi-cycle machine runs one instruction to completion before the
 * next, so out-of-order issue, a ROB, and a slow-op latency have nothing to act on — but only the
 * full trace can prove no field leaked into fetch, memory, or the multi-cycle phase plan. The
 * knobs are set to aggressive non-defaults so a leak has something loud to perturb.
 */
describe('out-of-order config cluster (M9 step 0)', () => {
  it('is inert — the whole trace is identical with the OoO knobs set to aggressive non-defaults', () => {
    const image = toProgramImage(asm(WIDTH_PROBE));
    const trace = (config = defaultConfig()): CycleTrace[] => {
      const p = new MultiCycleProcessor();
      p.reset(image, config);
      return runAll(p);
    };
    expect(
      trace({ ...defaultConfig(), outOfOrderIssue: true, robSize: 4, slowOpLatency: 20 }),
    ).toEqual(trace());
  });

  it('declares it does not honor the knobs', () => {
    expect(MULTI_CYCLE_CAPABILITIES.configurableOutOfOrder).toBe(false);
  });
});
