/**
 * Pseudo-instruction expansion (handoff §8: pseudos are pedagogically valuable —
 * the UI shows how they lower to real instructions). The set is corpus-driven and
 * deliberately minimal (M1 plan): `li`, `mv`, `nop`, `j`, `jr`, `ret`, `la`,
 * `beqz`, `bnez`.
 *
 * `li` and `la` share the 32-bit materialization split ({@link hiLo}): a value (or
 * symbol address) is loaded with `lui` (upper 20 bits) + `addi` (signed low 12).
 * The classic gotcha — when the low 12 bits are negative, `addi` sign-extends and
 * subtracts, so the upper part must be +1 to compensate — falls out for free from
 * the arithmetic-shift split below, and is pinned by a round-trip test.
 */

import { checkRange, fail } from './diagnostics';
import type { OperandReader } from './operands';
import type { InstrUnit } from './units';

/**
 * Split a 32-bit value into the `lui` upper-20 (`hi`) and signed low-12 (`lo`) such
 * that `(hi << 12) + lo === v` as a 32-bit value. The `(x - lo)` term carries the
 * +1 into `hi` whenever `lo` is negative.
 */
export function hiLo(v: number): { hi: number; lo: number } {
  const x = v | 0; // reinterpret as signed 32-bit
  const lo = (x << 20) >> 20; // sign-extend the low 12 bits
  const hi = (x - lo) >> 12; // upper 20 bits (arithmetic; only the low 20 are kept)
  return { hi: hi & 0xfffff, lo };
}

/** Lower a fully-known 32-bit constant into `addi` / `lui` / `lui`+`addi`. */
function materialize32(rd: number, value: number, line: number): InstrUnit[] {
  const { hi, lo } = hiLo(value);
  if (hi === 0) return [{ mnemonic: 'addi', fields: { rd, rs1: 0, imm: lo }, line }];
  if (lo === 0) return [{ mnemonic: 'lui', fields: { rd, imm: hi << 12 }, line }];
  return [
    { mnemonic: 'lui', fields: { rd, imm: hi << 12 }, line },
    { mnemonic: 'addi', fields: { rd, rs1: rd, imm: lo }, line },
  ];
}

type PseudoHandler = (r: OperandReader, line: number) => InstrUnit[];

const PSEUDOS: Readonly<Record<string, PseudoHandler>> = {
  nop: (r, line) => {
    r.done();
    return [{ mnemonic: 'addi', fields: { rd: 0, rs1: 0, imm: 0 }, line }];
  },

  mv: (r, line) => {
    const rd = r.register();
    r.comma();
    const rs = r.register();
    r.done();
    return [{ mnemonic: 'addi', fields: { rd, rs1: rs, imm: 0 }, line }];
  },

  li: (r, line) => {
    const rd = r.register();
    r.comma();
    const value = r.immediate((v, t) =>
      checkRange(v, -(2 ** 31), 2 ** 32 - 1, 'li value', t.line, t.col),
    );
    r.done();
    return materialize32(rd, value, line);
  },

  la: (r, line) => {
    const rd = r.register();
    r.comma();
    const sym = r.peek();
    if (!sym || sym.type !== 'ident') fail('la expects a symbol', line, sym?.col ?? 1);
    r.target(); // consume the symbol token
    r.done();
    return [
      {
        mnemonic: 'lui',
        fields: { rd },
        reloc: { kind: 'hi', symbol: sym.text, line: sym.line, col: sym.col },
        line,
      },
      {
        mnemonic: 'addi',
        fields: { rd, rs1: rd },
        reloc: { kind: 'lo', symbol: sym.text, line: sym.line, col: sym.col },
        line,
      },
    ];
  },

  j: (r, line) => {
    const t = r.target();
    r.done();
    if (t.kind === 'sym') {
      return [
        {
          mnemonic: 'jal',
          fields: { rd: 0 },
          reloc: { kind: 'jump', symbol: t.name, line: t.tok.line, col: t.tok.col },
          line,
        },
      ];
    }
    return [{ mnemonic: 'jal', fields: { rd: 0, imm: t.value }, line }];
  },

  jr: (r, line) => {
    const rs = r.register();
    r.done();
    return [{ mnemonic: 'jalr', fields: { rd: 0, rs1: rs, imm: 0 }, line }];
  },

  ret: (r, line) => {
    r.done();
    return [{ mnemonic: 'jalr', fields: { rd: 0, rs1: 1, imm: 0 }, line }]; // jalr x0, ra, 0
  },

  beqz: (r, line) => branchZero('beq', r, line),
  bnez: (r, line) => branchZero('bne', r, line),
};

/** `beqz`/`bnez rs, target` → `beq`/`bne rs, x0, target`. */
function branchZero(real: string, r: OperandReader, line: number): InstrUnit[] {
  const rs = r.register();
  r.comma();
  const t = r.target();
  r.done();
  if (t.kind === 'sym') {
    return [
      {
        mnemonic: real,
        fields: { rs1: rs, rs2: 0 },
        reloc: { kind: 'branch', symbol: t.name, line: t.tok.line, col: t.tok.col },
        line,
      },
    ];
  }
  return [{ mnemonic: real, fields: { rs1: rs, rs2: 0, imm: t.value }, line }];
}

/**
 * Every pseudo-instruction the assembler expands, derived from the handler table itself so
 * a new pseudo appears in the ISA reference by being implemented, not by being remembered.
 *
 * Unlike the real mnemonics there is no syntax-class layer here: each pseudo's grammar is
 * one bespoke handler above, so the reference declares each form and pins it by assembling
 * the example (`isa-reference.test.ts`).
 */
export const PSEUDO_MNEMONICS: readonly string[] = Object.keys(PSEUDOS);

export function isPseudo(mnemonic: string): boolean {
  return mnemonic in PSEUDOS;
}

/** Expand a pseudo-instruction into its real machine-word units. */
export function expandPseudo(mnemonic: string, r: OperandReader, line: number): InstrUnit[] {
  const handler = PSEUDOS[mnemonic];
  if (!handler) throw new Error(`not a pseudo-instruction: ${mnemonic}`);
  return handler(r, line);
}
