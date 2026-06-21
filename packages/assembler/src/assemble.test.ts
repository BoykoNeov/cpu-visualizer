import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decode, INSTRUCTIONS } from '@cpu-viz/isa';
import { assemble } from './assemble';
import { DATA_BASE, TEXT_BASE, type AssembledProgram } from './program';

/** Assemble, asserting success and surfacing located errors on failure. */
function asm(src: string): AssembledProgram {
  const { program, errors } = assemble(src);
  if (!program) {
    throw new Error(
      'expected assembly to succeed but got errors:\n' +
        errors.map((e) => `  ${e.line}:${e.column} ${e.message}`).join('\n'),
    );
  }
  return program;
}

/** Assemble one instruction line and return its single encoded word. */
function one(line: string): number {
  const p = asm(`.text\n${line}\n`);
  expect(p.words).toHaveLength(1);
  return p.words[0]! >>> 0;
}

describe('real instructions encode to the hand-verified oracle words (isa/codec.test.ts)', () => {
  // These hexes are computed against the RISC-V spec, not our own encoder, so they
  // catch an operand-syntax -> fields mistake even if encode/decode agree internally.
  const ORACLES: [string, number][] = [
    ['addi x1, x0, 5', 0x00500093],
    ['addi x1, x0, -1', 0xfff00093],
    ['add x3, x1, x2', 0x002081b3],
    ['sub x3, x1, x2', 0x402081b3],
    ['lw x5, 8(x6)', 0x00832283],
    ['sw x5, 12(x6)', 0x00532623],
    ['beq x1, x2, 8', 0x00208463],
    ['beq x1, x2, -4', 0xfe208ee3],
    ['lui x1, 0x12345', 0x123450b7],
    ['jal x0, 8', 0x0080006f],
    ['jal x1, -4', 0xffdff0ef],
    ['slli x5, x6, 3', 0x00331293],
    ['srai x5, x6, 3', 0x40335293],
    ['ecall', 0x00000073],
    ['ebreak', 0x00100073],
  ];
  for (const [line, hex] of ORACLES) {
    it(`assembles ${line}`, () => {
      expect(one(line)).toBe(hex >>> 0);
    });
  }
});

describe('operand syntax classes', () => {
  it('accepts ABI register names', () => {
    expect(one('addi a0, zero, 5')).toBe(one('addi x10, x0, 5'));
    expect(one('add sp, ra, gp')).toBe(one('add x2, x1, x3'));
  });

  it('parses the jalr forms equivalently', () => {
    const explicit = one('jalr x0, x1, 0');
    expect(one('jalr x0, 0(x1)')).toBe(explicit);
    expect(one('jalr x0, x1')).toBe(explicit);
    expect(one('jalr x1')).toBe(one('jalr x1, x1, 0')); // 1-operand links into ra
  });
});

describe('labels and PC-relative resolution', () => {
  it('resolves a backward branch to a negative byte offset', () => {
    const p = asm(`
      .text
        addi x1, x0, 0
      loop:
        addi x1, x1, 1
        bne x1, x2, loop
    `);
    const branch = decode(p.words[2]!); // bne at pc = 8, loop at pc = 4 -> offset -4
    expect(branch.mnemonic).toBe('bne');
    expect(branch.imm).toBe(-4);
  });

  it('resolves a forward jump to a positive byte offset', () => {
    const p = asm(`
      .text
        jal x0, done
        addi x1, x0, 1
      done:
        addi x2, x0, 2
    `);
    const j = decode(p.words[0]!); // jal at pc 0, done at pc 8
    expect(j.mnemonic).toBe('jal');
    expect(j.imm).toBe(8);
  });

  it('records labels in the symbol table at their absolute address', () => {
    const p = asm(`
      .text
      _start:
        addi x1, x0, 1
      second:
        addi x2, x0, 2
    `);
    expect(p.symbols.get('_start')).toBe(TEXT_BASE);
    expect(p.symbols.get('second')).toBe(TEXT_BASE + 4);
  });
});

describe('pseudo-instructions', () => {
  it('nop / mv / ret / jr expand to their canonical real instructions', () => {
    expect(one('nop')).toBe(one('addi x0, x0, 0'));
    expect(one('mv x5, x6')).toBe(one('addi x5, x6, 0'));
    expect(one('ret')).toBe(one('jalr x0, x1, 0'));
    expect(one('jr x7')).toBe(one('jalr x0, x7, 0'));
  });

  it('j label expands to jal x0, label', () => {
    const p = asm(`
      .text
        j target
        nop
      target:
        nop
    `);
    const j = decode(p.words[0]!);
    expect(j.mnemonic).toBe('jal');
    expect(j.rd).toBe(0);
    expect(j.imm).toBe(8);
  });

  it('beqz / bnez expand to beq / bne against x0', () => {
    const p = asm(`
      .text
      top:
        beqz x5, top
        bnez x6, top
    `);
    const beqz = decode(p.words[0]!);
    expect(beqz.mnemonic).toBe('beq');
    expect(beqz.rs2).toBe(0);
    const bnez = decode(p.words[1]!);
    expect(bnez.mnemonic).toBe('bne');
    expect(bnez.rs2).toBe(0);
    expect(bnez.imm).toBe(-4); // bnez at pc 4 -> top at pc 0
  });

  // The headline gotcha: when the low 12 bits are negative, addi sign-extends, so
  // lui must carry +1. Reconstruct the loaded value from the emitted words.
  describe('li materializes any 32-bit value (lui+addi sign correction)', () => {
    const VALUES = [
      0, 5, -1, 2047, -2048, 2048, -2049, 0x7ff, 0x800, 0xfff, 0x1000, 0x12345000, 0x12345678,
      0x12345800, 0xdeadbeef, 0x7fffffff, -0x80000000, 0xffffffff, 0xfffff800,
    ];
    for (const v of VALUES) {
      it(`li x5, ${v}`, () => {
        const p = asm(`.text\nli x5, ${v}\n`);
        expect(p.words.length).toBeGreaterThanOrEqual(1);
        expect(p.words.length).toBeLessThanOrEqual(2);
        let acc = 0;
        for (const w of p.words) {
          const d = decode(w);
          expect(d.rd).toBe(5);
          if (d.mnemonic === 'lui')
            acc = d.imm; // upper, already in place
          else if (d.mnemonic === 'addi')
            acc = acc + d.imm; // signed low 12
          else throw new Error(`unexpected li expansion: ${d.mnemonic}`);
        }
        expect(acc >>> 0).toBe(v >>> 0);
      });
    }

    it('uses a single addi when the value fits in a signed 12-bit immediate', () => {
      expect(asm('.text\nli x5, 100\n').words).toHaveLength(1);
      expect(asm('.text\nli x5, -2048\n').words).toHaveLength(1);
    });

    it('uses two instructions for a value that needs the upper bits', () => {
      expect(asm('.text\nli x5, 0x12345678\n').words).toHaveLength(2);
    });
  });

  it('la materializes a data symbol address with lui+addi', () => {
    const p = asm(`
      .data
      buf:
        .word 0
      .text
        la x5, buf
    `);
    expect(p.symbols.get('buf')).toBe(DATA_BASE);
    expect(p.words).toHaveLength(2);
    const lui = decode(p.words[0]!);
    const addi = decode(p.words[1]!);
    expect(lui.mnemonic).toBe('lui');
    expect(addi.mnemonic).toBe('addi');
    expect((lui.imm + addi.imm) >>> 0).toBe(DATA_BASE >>> 0);
  });
});

describe('source map', () => {
  it('maps every emitted word back to its source line', () => {
    const p = asm(['.text', 'addi x1, x0, 1', 'addi x2, x0, 2'].join('\n'));
    expect(p.sourceMap.get(0)).toBe(2);
    expect(p.sourceMap.get(4)).toBe(3);
  });

  it('points both halves of a 2-word li at the same source line', () => {
    // Line 1 is `.text`; line 2 is the li that expands to lui+addi.
    const p = asm('.text\nli x5, 0x12345678\n');
    expect(p.words).toHaveLength(2);
    expect(p.sourceMap.get(0)).toBe(2);
    expect(p.sourceMap.get(4)).toBe(2);
  });
});

describe('directives and data', () => {
  it('.word emits little-endian 32-bit values into the data segment', () => {
    const p = asm(`
      .data
      nums:
        .word 1, 0x02030405
    `);
    expect(p.data).toHaveLength(1);
    expect(p.data[0]!.addr).toBe(DATA_BASE);
    expect(Array.from(p.data[0]!.bytes)).toEqual([1, 0, 0, 0, 0x05, 0x04, 0x03, 0x02]);
    expect(p.symbols.get('nums')).toBe(DATA_BASE);
  });

  it('.byte emits contiguous bytes (no auto-alignment)', () => {
    const p = asm(`
      .data
        .byte 1, 2, 3
      after:
        .word 0
    `);
    // 3 bytes, then the word starts at offset 3 (unaligned — contiguous by design).
    expect(p.symbols.get('after')).toBe(DATA_BASE + 3);
    expect(Array.from(p.data[0]!.bytes)).toEqual([1, 2, 3, 0, 0, 0, 0]);
  });

  it('.asciz emits the string bytes plus a null terminator', () => {
    const p = asm(`
      .data
      msg:
        .asciz "Hi\\n"
    `);
    expect(Array.from(p.data[0]!.bytes)).toEqual([0x48, 0x69, 0x0a, 0x00]);
  });

  it('.data and .text can interleave; cursors are independent', () => {
    const p = asm(`
      .data
      a:
        .word 0xaa
      .text
        addi x1, x0, 1
      .data
      b:
        .word 0xbb
    `);
    expect(p.symbols.get('a')).toBe(DATA_BASE);
    expect(p.symbols.get('b')).toBe(DATA_BASE + 4);
    expect(p.words).toHaveLength(1);
  });
});

describe('located errors (line:column)', () => {
  function firstError(src: string) {
    const { program, errors } = assemble(src);
    expect(program).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
    return errors[0]!;
  }

  it('reports an unknown register with its location', () => {
    const e = firstError('.text\naddi x1, x99, 5\n');
    expect(e.message).toMatch(/register/);
    expect(e.line).toBe(2);
    expect(e.column).toBe(10); // the `x99` token: "addi x1, " is 9 chars
  });

  it('reports an unknown instruction', () => {
    const e = firstError('.text\nfoo x1, x2\n');
    expect(e.message).toMatch(/unknown instruction/);
  });

  it('reports a duplicate label', () => {
    const e = firstError('.text\nl:\n  nop\nl:\n  nop\n');
    expect(e.message).toMatch(/duplicate label/);
    expect(e.line).toBe(4);
  });

  it('reports an undefined symbol', () => {
    const e = firstError('.text\n  jal x0, nowhere\n');
    expect(e.message).toMatch(/undefined symbol/);
  });

  it('reports a branch that is out of range', () => {
    const e = firstError('.text\n  beq x1, x2, 0x2000\n');
    expect(e.message).toMatch(/out of range/);
  });

  it('rejects an immediate that does not fit', () => {
    const e = firstError('.text\n  addi x1, x0, 5000\n');
    expect(e.message).toMatch(/out of range/);
  });

  it('rejects a data directive in the .text section', () => {
    const e = firstError('.text\n  .word 1\n');
    expect(e.message).toMatch(/\.data section/);
  });

  it('rejects an instruction in the .data section', () => {
    const e = firstError('.data\n  addi x1, x0, 1\n');
    expect(e.message).toMatch(/\.text section/);
  });

  it('collects multiple independent errors', () => {
    const { errors } = assemble('.text\n  addi x1, x99, 5\n  unknownop\n');
    expect(errors.length).toBe(2);
  });
});

describe('every base mnemonic routes through the operand layer', () => {
  // One syntactically-valid line per mnemonic, asserting it assembles and decodes
  // back to itself (not 'unknown'). This closes coverage of auipc and the non-exemplar
  // variants whose operand path is otherwise only transitively exercised by a sibling.
  const SAMPLE: Record<string, string> = {
    lui: 'lui x1, 0x1',
    auipc: 'auipc x1, 0x1',
    jal: 'jal x1, 0',
    jalr: 'jalr x1, x2, 0',
    beq: 'beq x1, x2, 0',
    bne: 'bne x1, x2, 0',
    blt: 'blt x1, x2, 0',
    bge: 'bge x1, x2, 0',
    bltu: 'bltu x1, x2, 0',
    bgeu: 'bgeu x1, x2, 0',
    lb: 'lb x1, 0(x2)',
    lh: 'lh x1, 0(x2)',
    lw: 'lw x1, 0(x2)',
    lbu: 'lbu x1, 0(x2)',
    lhu: 'lhu x1, 0(x2)',
    sb: 'sb x1, 0(x2)',
    sh: 'sh x1, 0(x2)',
    sw: 'sw x1, 0(x2)',
    addi: 'addi x1, x2, 1',
    slti: 'slti x1, x2, 1',
    sltiu: 'sltiu x1, x2, 1',
    xori: 'xori x1, x2, 1',
    ori: 'ori x1, x2, 1',
    andi: 'andi x1, x2, 1',
    slli: 'slli x1, x2, 1',
    srli: 'srli x1, x2, 1',
    srai: 'srai x1, x2, 1',
    add: 'add x1, x2, x3',
    sub: 'sub x1, x2, x3',
    sll: 'sll x1, x2, x3',
    slt: 'slt x1, x2, x3',
    sltu: 'sltu x1, x2, x3',
    xor: 'xor x1, x2, x3',
    srl: 'srl x1, x2, x3',
    sra: 'sra x1, x2, x3',
    or: 'or x1, x2, x3',
    and: 'and x1, x2, x3',
    fence: 'fence',
    ecall: 'ecall',
    ebreak: 'ebreak',
  };

  it('covers exactly the isa instruction table', () => {
    const table = INSTRUCTIONS.map((d) => d.mnemonic).sort();
    expect(Object.keys(SAMPLE).sort()).toEqual(table);
  });

  for (const [mnemonic, line] of Object.entries(SAMPLE)) {
    it(`assembles ${mnemonic}`, () => {
      const p = asm(`.text\n${line}\n`);
      expect(p.words).toHaveLength(1);
      expect(decode(p.words[0]!).mnemonic).toBe(mnemonic);
    });
  }
});

describe('the example corpus assembles (programs are the test fixtures, spec §9)', () => {
  it('assembles content/programs/add.s from disk', () => {
    const path = fileURLToPath(new URL('../../../content/programs/add.s', import.meta.url));
    const p = asm(readFileSync(path, 'utf8'));
    expect(p.words).toHaveLength(3);
    expect(p.symbols.get('_start')).toBe(TEXT_BASE);
    expect(decode(p.words[2]!).mnemonic).toBe('add');
  });
});
