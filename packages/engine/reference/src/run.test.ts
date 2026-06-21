import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, emptyProgram, type AssembledProgram } from '@cpu-viz/assembler';
import { run, type ReferenceResult } from './index';

/**
 * The golden reference is the root of trust (handoff §9): everything else is tested
 * AGAINST it, so it cannot be tested against anything. Every expected value below is a
 * hand-computed oracle, not a comparison. Programs are built with the real assembler —
 * the example corpus is also the fixture corpus (§9).
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

function exec(source: string, maxSteps?: number): ReferenceResult {
  return run(asm(source), maxSteps === undefined ? {} : { maxSteps });
}

/** Signed / unsigned views of a GPR in the final state. */
const sreg = (r: ReferenceResult, i: number): number => r.state.registers[i]!;
const ureg = (r: ReferenceResult, i: number): number => r.state.registers[i]! >>> 0;

describe('reference: control & halting', () => {
  it('runs add.s (5 + 37 = 42 in x5)', () => {
    const r = exec(
      ['.text', 'addi x1, x0, 5', 'addi x2, x0, 37', 'add x5, x1, x2', 'ecall'].join('\n'),
    );
    expect(r.haltReason).toBe('ecall');
    expect(r.state.halted).toBe(true);
    expect(sreg(r, 5)).toBe(42);
    expect(r.steps).toBe(4);
  });

  it('runs the on-disk content/programs/add.s fixture', () => {
    const path = fileURLToPath(new URL('../../../../content/programs/add.s', import.meta.url));
    const r = run(asm(readFileSync(path, 'utf8')));
    // add.s has no ecall, so it runs off the end of text after its 3 instructions.
    expect(sreg(r, 5)).toBe(42);
    expect(r.steps).toBe(3);
    expect(r.haltReason).toBe('pc-out-of-range');
    expect(r.state.halted).toBe(true);
  });

  it('discards writes to x0', () => {
    const r = exec(['.text', 'addi x0, x0, 5', 'ecall'].join('\n'));
    expect(sreg(r, 0)).toBe(0);
  });

  it('treats ebreak as a halt', () => {
    const r = exec(['.text', 'addi x1, x0, 1', 'ebreak'].join('\n'));
    expect(r.haltReason).toBe('ebreak');
    expect(r.state.halted).toBe(true);
    expect(sreg(r, 1)).toBe(1);
  });

  it('treats fence as a no-op', () => {
    const r = exec(['.text', 'fence', 'addi x1, x0, 5', 'ecall'].join('\n'));
    expect(sreg(r, 1)).toBe(5);
    expect(r.steps).toBe(3);
  });

  it('halts on an unknown instruction word rather than silently advancing', () => {
    const program: AssembledProgram = {
      words: new Uint32Array([0xffffffff]),
      sourceMap: new Map(),
      symbols: new Map(),
      data: [],
    };
    const r = run(program);
    expect(r.haltReason).toBe('unknown-instruction');
    expect(r.state.halted).toBe(true);
    expect(r.steps).toBe(1);
  });

  it('caps runaway loops at maxSteps (no architectural halt)', () => {
    const r = exec(['.text', 'loop:', 'j loop'].join('\n'), 100);
    expect(r.haltReason).toBe('max-steps');
    expect(r.state.halted).toBe(false);
    expect(r.steps).toBe(100);
  });

  it('handles the empty program', () => {
    const r = run(emptyProgram());
    expect(r.steps).toBe(0);
    expect(r.haltReason).toBe('pc-out-of-range');
  });
});

describe('reference: ALU & sign handling', () => {
  it('subtracts into a negative result', () => {
    const r = exec(
      ['.text', 'addi x1, x0, 5', 'addi x2, x0, 8', 'sub x3, x1, x2', 'ecall'].join('\n'),
    );
    expect(sreg(r, 3)).toBe(-3);
  });

  it('slt is signed, sltu is unsigned (-1 vs 1)', () => {
    const r = exec(
      [
        '.text',
        'addi x1, x0, -1',
        'addi x2, x0, 1',
        'slt x3, x1, x2',
        'sltu x4, x1, x2',
        'ecall',
      ].join('\n'),
    );
    expect(sreg(r, 3)).toBe(1); // signed: -1 < 1
    expect(sreg(r, 4)).toBe(0); // unsigned: 0xffffffff < 1 is false
  });

  it('sltiu sign-extends the immediate then compares unsigned (the classic trap)', () => {
    const r = exec(['.text', 'sltiu x1, x0, -1', 'slti x2, x0, -1', 'ecall'].join('\n'));
    expect(sreg(r, 1)).toBe(1); // 0 < 0xffffffff (unsigned)
    expect(sreg(r, 2)).toBe(0); // 0 < -1 (signed) is false
  });

  it('srli is logical, srai is arithmetic on a high-bit-set value (immediate forms)', () => {
    const r = exec(
      ['.text', 'lui x1, 0x80000', 'srli x2, x1, 4', 'srai x3, x1, 4', 'ecall'].join('\n'),
    );
    expect(ureg(r, 1)).toBe(0x80000000);
    expect(ureg(r, 2)).toBe(0x08000000); // logical: zero-filled
    expect(ureg(r, 3)).toBe(0xf8000000); // arithmetic: sign-filled
  });

  it('srl is logical, sra is arithmetic on a high-bit-set value (register forms)', () => {
    const r = exec(
      [
        '.text',
        'lui x1, 0x80000',
        'addi x4, x0, 4',
        'srl x2, x1, x4',
        'sra x3, x1, x4',
        'ecall',
      ].join('\n'),
    );
    expect(ureg(r, 2)).toBe(0x08000000);
    expect(ureg(r, 3)).toBe(0xf8000000);
  });

  it('slli shifts left; lui and auipc place the upper immediate', () => {
    const r = exec(
      ['.text', 'auipc x1, 1', 'lui x2, 0x12345', 'addi x3, x0, 1', 'slli x4, x3, 4', 'ecall'].join(
        '\n',
      ),
    );
    expect(ureg(r, 1)).toBe(0x1000); // pc(0) + (1 << 12)
    expect(ureg(r, 2)).toBe(0x12345000);
    expect(sreg(r, 4)).toBe(16);
  });
});

describe('reference: branches & jumps', () => {
  it('sums 5..1 via a backward branch with a negative offset', () => {
    const r = exec(
      [
        '.text',
        'addi x1, x0, 0', // sum
        'addi x2, x0, 5', // i
        'loop:',
        'add  x1, x1, x2', // sum += i
        'addi x2, x2, -1', // i--
        'bne  x2, x0, loop', // backward branch while i != 0
        'ecall',
      ].join('\n'),
    );
    expect(sreg(r, 1)).toBe(15); // 5+4+3+2+1
  });

  it('jal links the return address and jalr returns to it', () => {
    const r = exec(
      [
        '.text',
        'addi x1, x0, 0',
        'jal  x5, func', // x5 = return addr (the next instruction)
        'addi x1, x1, 100', // runs after return
        'ecall',
        'func:',
        'addi x1, x1, 7',
        'jalr x0, x5, 0', // return
      ].join('\n'),
    );
    expect(sreg(r, 1)).toBe(107); // 7 (in func) then +100 (after return)
  });
});

describe('reference: memory (loads, stores, endianness, sign-extension)', () => {
  it('reads an assembled .word back little-endian via lw/lh/lb', () => {
    const r = exec(
      [
        '.data',
        'val: .word 0x12345678',
        '.text',
        'la  x1, val',
        'lw  x2, 0(x1)', // whole word
        'lb  x3, 0(x1)', // low byte 0x78, sign bit clear
        'lbu x4, 3(x1)', // top byte 0x12
        'lh  x5, 2(x1)', // top half 0x1234, sign bit clear
        'ecall',
      ].join('\n'),
    );
    expect(ureg(r, 2)).toBe(0x12345678); // pins assembler byte-emit <-> engine word-read
    expect(sreg(r, 3)).toBe(0x78);
    expect(sreg(r, 4)).toBe(0x12);
    expect(sreg(r, 5)).toBe(0x1234);
  });

  it('sign-extends lb/lh of a high-bit-set byte/half; lbu/lhu zero-extend', () => {
    const r = exec(
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
    expect(sreg(r, 2)).toBe(-1);
    expect(sreg(r, 3)).toBe(255);
    expect(sreg(r, 4)).toBe(-32768);
    expect(sreg(r, 5)).toBe(32768);
  });

  it('round-trips a store through memory (sw/lw and sb/lbu)', () => {
    const r = exec(
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
    expect(sreg(r, 3)).toBe(99);
    expect(sreg(r, 5)).toBe(7);
  });
});
