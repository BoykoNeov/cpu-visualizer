import { describe, expect, it } from 'vitest';
import { assemble, emptyProgram, type AssembledProgram } from '@cpu-viz/assembler';
import { defaultConfig, type CycleTrace, type TraceEvent } from '@cpu-viz/trace';
import { SingleCycleProcessor, SINGLE_CYCLE_CAPABILITIES, toProgramImage } from './index';

/**
 * Single-cycle engine tests. The full differential check against the golden reference
 * (INV-8) is build step 6; here the oracles are hand-computed (like the reference's own
 * tests) so this engine stays decoupled from the reference. What these pin that the
 * reference can't: the per-cycle TRACE — event streams, stable ids, halt timing, and
 * crucially that each cycle's `state` is an INDEPENDENT snapshot (the step-5 time-travel
 * contract, handoff §6). Programs are built with the real assembler.
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

function makeProc(source: string): SingleCycleProcessor {
  const p = new SingleCycleProcessor();
  p.reset(toProgramImage(asm(source)));
  return p;
}

/** Drive to halt, collecting every CycleTrace — a stand-in for the step-5 driver/recorder. */
function runAll(p: SingleCycleProcessor, maxCycles = 1000): CycleTrace[] {
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

/**
 * Did `<mnemonic> x1, x2, taken` jump? Loads `a`/`b` into x1/x2, then records which path ran
 * (taken → x10=200, fall-through → x10=100). Mirrors the reference's `branchTaken` so the two
 * suites pin the same signed/unsigned branch oracle independently.
 */
function branchTaken(mnemonic: string, a: number, b: number): boolean {
  const ts = run(
    [
      '.text',
      `addi x1, x0, ${a}`,
      `addi x2, x0, ${b}`,
      `${mnemonic} x1, x2, taken`,
      'addi x10, x0, 100', // fall-through path
      'j done',
      'taken:',
      'addi x10, x0, 200', // taken path
      'done:',
      'ecall',
    ].join('\n'),
  );
  return sreg(last(ts), 10) === 200;
}

describe('single-cycle: model identity', () => {
  it('advertises no pipeline capabilities', () => {
    expect(SINGLE_CYCLE_CAPABILITIES).toEqual({
      model: 'single-cycle',
      pipelined: false,
      hasHazards: false,
      configurableForwarding: false,
      configurableBranchPrediction: false,
      configurableCache: false,
    });
  });
});

describe('single-cycle: control & halting', () => {
  it('runs add (5 + 37 = 42 in x5) and halts on ecall without advancing pc', () => {
    const ts = run(
      ['.text', 'addi x1, x0, 5', 'addi x2, x0, 37', 'add x5, x1, x2', 'ecall'].join('\n'),
    );
    expect(ts).toHaveLength(4); // one cycle per instruction, including the ecall
    expect(sreg(last(ts), 5)).toBe(42);
    expect(last(ts).state.halted).toBe(true);
    expect(last(ts).state.pc).toBe(12); // ecall's own pc (3rd word) — not advanced
    expect(last(ts).cycle).toBe(3); // cycle counter is 0-based
  });

  it('halts off the end of text (no ecall): final pc = the out-of-range value', () => {
    const ts = run(['.text', 'addi x1, x0, 5', 'addi x2, x0, 37', 'add x5, x1, x2'].join('\n'));
    expect(ts).toHaveLength(3);
    expect(sreg(last(ts), 5)).toBe(42);
    expect(last(ts).state.halted).toBe(true);
    expect(last(ts).state.pc).toBe(12); // textEnd = 3*4, pc ran one word past the last instr
  });

  it('treats ebreak as a halt and fence as a no-op', () => {
    const brk = run(['.text', 'addi x1, x0, 1', 'ebreak'].join('\n'));
    expect(last(brk).state.halted).toBe(true);
    expect(sreg(last(brk), 1)).toBe(1);

    const fen = run(['.text', 'fence', 'addi x1, x0, 5', 'ecall'].join('\n'));
    expect(sreg(last(fen), 1)).toBe(5);
    expect(fen).toHaveLength(3);
  });

  it('halts loudly on an unknown instruction word', () => {
    const p = new SingleCycleProcessor();
    p.reset(
      toProgramImage({
        words: new Uint32Array([0xffffffff]),
        sourceMap: new Map(),
        symbols: new Map(),
        data: [],
      }),
    );
    const ts = runAll(p);
    expect(ts).toHaveLength(1);
    expect(last(ts).state.halted).toBe(true);
    expect(last(ts).instructions[0]!.decoded.mnemonic).toBe('unknown');
  });

  it('is halted from reset on the empty program, and step() then throws', () => {
    const p = new SingleCycleProcessor();
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

  it('reset() ignores config (single-cycle honors none) — same result with forwarding on', () => {
    const src = ['.text', 'addi x1, x0, 5', 'addi x2, x0, 37', 'add x5, x1, x2', 'ecall'].join(
      '\n',
    );
    const image = toProgramImage(asm(src));

    const a = new SingleCycleProcessor();
    a.reset(image, defaultConfig());
    const b = new SingleCycleProcessor();
    b.reset(image, { forwarding: true, branchPrediction: 'static-taken', cache: null, seed: 7 });

    expect(sreg(last(runAll(a)), 5)).toBe(42);
    expect(sreg(last(runAll(b)), 5)).toBe(42);
  });

  it('getState() reflects the live state before and after a run', () => {
    const p = makeProc(['.text', 'addi x1, x0, 5', 'ecall'].join('\n'));
    const before = p.getState();
    expect(before.pc).toBe(0);
    expect(before.halted).toBe(false);
    expect(before.registers[1]).toBe(0);
    runAll(p);
    const after = p.getState();
    expect(after.halted).toBe(true);
    expect(after.registers[1]).toBe(5);
  });
});

describe('single-cycle: per-cycle state is an independent snapshot (handoff §6)', () => {
  it('a register overwritten each cycle keeps its per-cycle value in each recorded trace', () => {
    const ts = run(
      ['.text', 'addi x1, x0, 1', 'addi x1, x0, 2', 'addi x1, x0, 3', 'ecall'].join('\n'),
    );
    // If snapshots aliased the live register file, every trace would show the FINAL 3.
    expect(sreg(ts[0]!, 1)).toBe(1);
    expect(sreg(ts[1]!, 1)).toBe(2);
    expect(sreg(ts[2]!, 1)).toBe(3);
    expect(sreg(ts[3]!, 1)).toBe(3); // ecall does not change x1
  });

  it('memory written across cycles keeps its per-cycle value in each recorded trace', () => {
    const addr = 0x1000_0000; // DATA_BASE: where `slot` lands
    const ts = run(
      [
        '.data',
        'slot: .word 0',
        '.text',
        'la   x1, slot',
        'addi x2, x0, 0x111', // fits a signed-12 immediate (single addi)
        'sw   x2, 0(x1)', // memory := 0x111
        'addi x2, x0, 0x222',
        'sw   x2, 0(x1)', // memory := 0x222
        'ecall',
      ].join('\n'),
    );
    const first = ts.find((t) =>
      t.events.some((e) => e.type === 'mem-write' && e.value === 0x111),
    )!;
    const second = ts.find((t) =>
      t.events.some((e) => e.type === 'mem-write' && e.value === 0x222),
    )!;
    expect(first.state.memory.readWord(addr)).toBe(0x111); // frozen at the first store
    expect(second.state.memory.readWord(addr)).toBe(0x222);
    expect(last(ts).state.memory.readWord(addr)).toBe(0x222);
  });
});

describe('single-cycle: trace events & instruction identity', () => {
  it('emits the full datapath event stream for an R-type add', () => {
    const ts = run(
      ['.text', 'addi x1, x0, 5', 'addi x2, x0, 37', 'add x5, x1, x2', 'ecall'].join('\n'),
    );

    // The first addi reads x0 (the datapath still drives the port) and writes x1.
    const addi = ts[0]!;
    expect(addi.events).toEqual([
      { type: 'instr-fetch', instr: 'i0', pc: 0, encoding: addi.instructions[0]!.encoding },
      { type: 'reg-read', reg: 0, value: 0, instr: 'i0' },
      { type: 'alu-op', op: 'add', a: 0, b: 5, result: 5, instr: 'i0' },
      { type: 'reg-write', reg: 1, value: 5, instr: 'i0' },
      { type: 'instr-retire', instr: 'i0' },
    ]);

    // The add reads x1 and x2, computes in the ALU, writes x5.
    const add = ts[2]!;
    expect(add.events).toEqual([
      { type: 'instr-fetch', instr: 'i2', pc: 8, encoding: add.instructions[0]!.encoding },
      { type: 'reg-read', reg: 1, value: 5, instr: 'i2' },
      { type: 'reg-read', reg: 2, value: 37, instr: 'i2' },
      { type: 'alu-op', op: 'add', a: 5, b: 37, result: 42, instr: 'i2' },
      { type: 'reg-write', reg: 5, value: 42, instr: 'i2' },
      { type: 'instr-retire', instr: 'i2' },
    ]);

    // One in-flight instruction per cycle, located in the single-cycle datapath, with the
    // source line threaded through; every event references that instruction's id.
    const inst = add.instructions[0]!;
    expect(add.instructions).toHaveLength(1);
    expect(inst.id).toBe('i2');
    expect(inst.location).toBe('single-cycle');
    expect(inst.pc).toBe(8);
    expect(inst.sourceLine).toBe(4); // line 4 of the source: `add x5, x1, x2`
    expect(add.events.every((e) => 'instr' in e && e.instr === inst.id)).toBe(true);
  });

  it('does not emit a reg-write for a discarded x0 destination', () => {
    const ts = run(['.text', 'addi x0, x0, 5', 'ecall'].join('\n'));
    expect(sreg(last(ts), 0)).toBe(0);
    expect(types(ts[0]!)).not.toContain('reg-write');
  });

  it('emits mem-read with the raw datum and reg-write with the loaded value', () => {
    const ts = run(
      ['.data', 'val: .word 0x12345678', '.text', 'la x1, val', 'lw x2, 0(x1)', 'ecall'].join('\n'),
    );
    const lw = ts.find((t) => t.instructions[0]!.decoded.mnemonic === 'lw')!;
    expect(types(lw)).toEqual([
      'instr-fetch',
      'reg-read',
      'alu-op',
      'mem-read',
      'reg-write',
      'instr-retire',
    ]);
    const memRead = lw.events.find((e) => e.type === 'mem-read')!;
    expect(memRead.addr).toBe(0x1000_0000);
    expect(memRead.value >>> 0).toBe(0x12345678);
    expect(ureg(last(ts), 2)).toBe(0x12345678);
  });

  it('gives each dynamic execution of a looping instruction a fresh stable id (INV-4)', () => {
    // Sum 5..1 with a backward branch: the loop body executes five times.
    const ts = run(
      [
        '.text',
        'addi x1, x0, 0', // sum
        'addi x2, x0, 5', // i
        'loop:',
        'add  x1, x1, x2', // sum += i  (same pc, re-fetched each iteration)
        'addi x2, x2, -1', // i--
        'bne  x2, x0, loop',
        'ecall',
      ].join('\n'),
    );
    expect(sreg(last(ts), 1)).toBe(15); // 5+4+3+2+1

    const addPc = 8; // the `add x1, x1, x2` instruction's address
    const ids = ts.filter((t) => t.instructions[0]!.pc === addPc).map((t) => t.instructions[0]!.id);
    expect(ids).toHaveLength(5); // executed five times
    expect(new Set(ids).size).toBe(5); // each dynamic instance has a distinct id
  });
});

describe('single-cycle: ISA sign-handling parity (the classic traps)', () => {
  it('sltiu sign-extends the immediate then compares unsigned', () => {
    const ts = run(['.text', 'sltiu x1, x0, -1', 'slti x2, x0, -1', 'ecall'].join('\n'));
    expect(sreg(last(ts), 1)).toBe(1); // 0 < 0xffffffff (unsigned)
    expect(sreg(last(ts), 2)).toBe(0); // 0 < -1 (signed) is false
  });

  it('srli is logical, srai is arithmetic on a high-bit value', () => {
    const ts = run(
      ['.text', 'lui x1, 0x80000', 'srli x2, x1, 4', 'srai x3, x1, 4', 'ecall'].join('\n'),
    );
    expect(ureg(last(ts), 2)).toBe(0x08000000); // zero-filled
    expect(ureg(last(ts), 3)).toBe(0xf8000000); // sign-filled
  });

  it('takes beq/bne on equality', () => {
    expect(branchTaken('beq', 5, 5)).toBe(true);
    expect(branchTaken('beq', -1, 1)).toBe(false);
    expect(branchTaken('bne', -1, 1)).toBe(true);
    expect(branchTaken('bne', 5, 5)).toBe(false);
  });

  it('distinguishes signed (blt/bge) from unsigned (bltu/bgeu) on -1 vs 1', () => {
    expect(branchTaken('blt', -1, 1)).toBe(true); // signed: -1 < 1
    expect(branchTaken('bltu', -1, 1)).toBe(false); // unsigned: 0xffffffff < 1 is false
    expect(branchTaken('bge', -1, 1)).toBe(false); // signed: -1 >= 1 is false
    expect(branchTaken('bgeu', -1, 1)).toBe(true); // unsigned: 0xffffffff >= 1
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

describe('single-cycle: full ALU coverage (oracles mirrored from the golden reference)', () => {
  it('subtracts into a negative result', () => {
    const ts = run(
      ['.text', 'addi x1, x0, 5', 'addi x2, x0, 8', 'sub x3, x1, x2', 'ecall'].join('\n'),
    );
    expect(sreg(last(ts), 3)).toBe(-3);
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

  it('computes the bitwise ops (register and immediate forms) and register-form sll', () => {
    const ts = run(
      [
        '.text',
        'addi x1, x0, 0x5a',
        'addi x2, x0, 0x3c',
        'xor  x3, x1, x2', // 0x66
        'or   x4, x1, x2', // 0x7e
        'and  x5, x1, x2', // 0x18
        'xori x6, x1, 0xf', // 0x55
        'ori  x7, x1, 0xf', // 0x5f
        'andi x8, x1, 0xf', // 0x0a
        'sll  x9, x1, x2', // shift amount = 0x3c & 31 = 28
        'ecall',
      ].join('\n'),
    );
    expect(sreg(last(ts), 3)).toBe(0x66);
    expect(sreg(last(ts), 4)).toBe(0x7e);
    expect(sreg(last(ts), 5)).toBe(0x18);
    expect(sreg(last(ts), 6)).toBe(0x55);
    expect(sreg(last(ts), 7)).toBe(0x5f);
    expect(sreg(last(ts), 8)).toBe(0x0a);
    expect(ureg(last(ts), 9)).toBe(0xa0000000); // 0x5a << 28, low 5 bits of the shift count
  });

  it('srl is logical, sra is arithmetic on a high-bit value (register forms)', () => {
    const ts = run(
      [
        '.text',
        'lui x1, 0x80000',
        'addi x4, x0, 4',
        'srl x2, x1, x4',
        'sra x3, x1, x4',
        'ecall',
      ].join('\n'),
    );
    expect(ureg(last(ts), 2)).toBe(0x08000000); // zero-filled
    expect(ureg(last(ts), 3)).toBe(0xf8000000); // sign-filled
  });

  it('slli shifts left; lui and auipc place the upper immediate', () => {
    const ts = run(
      ['.text', 'auipc x1, 1', 'lui x2, 0x12345', 'addi x3, x0, 1', 'slli x4, x3, 4', 'ecall'].join(
        '\n',
      ),
    );
    expect(ureg(last(ts), 1)).toBe(0x1000); // pc(0) + (1 << 12) — exercises auipc's own path
    expect(ureg(last(ts), 2)).toBe(0x12345000);
    expect(sreg(last(ts), 4)).toBe(16);
  });
});

describe('single-cycle: store widths round-trip', () => {
  it('round-trips a byte store (sb/lbu) and a word store (sw/lw)', () => {
    const ts = run(
      [
        '.data',
        'slot: .word 0',
        '.text',
        'la   x1, slot',
        'addi x2, x0, 99',
        'sw   x2, 0(x1)',
        'lw   x3, 0(x1)', // -> 99
        'addi x4, x0, 7',
        'sb   x4, 4(x1)',
        'lbu  x5, 4(x1)', // -> 7
        'ecall',
      ].join('\n'),
    );
    expect(sreg(last(ts), 3)).toBe(99);
    expect(sreg(last(ts), 5)).toBe(7);
  });

  it('stores and reloads a halfword (sh/lhu), truncating to 16 bits', () => {
    const ts = run(
      [
        '.data',
        'slot: .word 0',
        '.text',
        'la   x1, slot',
        'lui  x2, 0x10000', // x2 = 0x10000000
        'addi x2, x2, 0x7ff', // x2 = 0x100007ff
        'sh   x3, 0(x1)', // x3 = 0 -> store 0
        'sh   x2, 0(x1)', // store low half 0x07ff
        'lhu  x4, 0(x1)', // -> 0x07ff
        'ecall',
      ].join('\n'),
    );
    expect(ureg(last(ts), 4)).toBe(0x07ff); // only the low 16 bits of x2 are stored
  });
});

describe('single-cycle: jumps round-trip', () => {
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
});
