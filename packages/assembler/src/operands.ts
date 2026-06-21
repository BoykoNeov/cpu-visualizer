/**
 * Operand syntax for the real RV32I instructions. This is the layer the M1 plan
 * calls out explicitly: `InstructionDef.format` is an *encoding* class, not an
 * assembly-*syntax* class, so `lw rd, imm(rs1)`, `sw rs2, imm(rs1)`, the `jalr`
 * forms, and the `lui` shifted-immediate all need syntax handling on top of the
 * shared encoder's {@link InstructionFields} contract.
 *
 * Each handler reads its operand tokens and returns one {@link InstrUnit}. A label
 * target on a branch/jump becomes a {@link Reloc}; a numeric offset is range-checked
 * and stored directly (matching the encoder's byte-offset immediate, e.g. the
 * `beq …, 8` / `jal …, 8` oracles in `isa`'s `codec.test.ts`).
 */

import { checkRange, checkSigned, fail } from './diagnostics';
import { resolveRegister } from './registers';
import type { Token } from './tokenizer';
import type { InstrUnit } from './units';

/** A cursor over an instruction's operand tokens with located-error helpers. */
export class OperandReader {
  private pos = 0;

  constructor(
    private readonly tokens: readonly Token[],
    /** The mnemonic token, used to locate "missing operand" errors. */
    private readonly anchor: Token,
  ) {}

  private get end(): Token {
    // Location just past the last token (or the mnemonic if there were none).
    const last = this.tokens[this.tokens.length - 1] ?? this.anchor;
    return last;
  }

  peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  peekAt(offset: number): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  /** Consume the next token, failing if the operand list is exhausted. */
  private next(what: string): Token {
    const tok = this.tokens[this.pos];
    if (!tok) fail(`expected ${what}`, this.end.line, this.end.col + this.end.text.length);
    this.pos++;
    return tok;
  }

  comma(): void {
    const tok = this.next("','");
    if (tok.type !== 'comma') fail(`expected ',' but found '${tok.text}'`, tok.line, tok.col);
  }

  register(): number {
    return resolveRegister(this.next('a register'));
  }

  /** A bare numeric immediate, optionally range-checked. */
  immediate(check?: (v: number, t: Token) => number): number {
    const tok = this.next('an immediate');
    if (tok.type !== 'number')
      fail(`expected an immediate but found '${tok.text}'`, tok.line, tok.col);
    const v = tok.value as number;
    return check ? check(v, tok) : v;
  }

  /** A `imm(rs1)` memory operand → `{ imm, rs1 }`, with `imm` a signed 12-bit. */
  memory(): { imm: number; rs1: number } {
    const numTok = this.next('an offset');
    if (numTok.type !== 'number')
      fail(`expected an offset but found '${numTok.text}'`, numTok.line, numTok.col);
    const imm = checkSigned(
      numTok.value as number,
      12,
      'load/store offset',
      numTok.line,
      numTok.col,
    );
    const open = this.next("'('");
    if (open.type !== 'lparen') fail(`expected '(' but found '${open.text}'`, open.line, open.col);
    const rs1 = this.register();
    const close = this.next("')'");
    if (close.type !== 'rparen')
      fail(`expected ')' but found '${close.text}'`, close.line, close.col);
    return { imm, rs1 };
  }

  /** A branch/jump target: a numeric byte offset, or a label to relocate in pass 2. */
  target(): { kind: 'imm'; value: number; tok: Token } | { kind: 'sym'; name: string; tok: Token } {
    const tok = this.next('a branch/jump target');
    if (tok.type === 'number') return { kind: 'imm', value: tok.value as number, tok };
    if (tok.type === 'ident') return { kind: 'sym', name: tok.text, tok };
    fail(`expected a label or offset but found '${tok.text}'`, tok.line, tok.col);
  }

  /** Fail unless every operand token has been consumed. */
  done(): void {
    const tok = this.tokens[this.pos];
    if (tok) fail(`unexpected trailing operand '${tok.text}'`, tok.line, tok.col);
  }
}

type Handler = (r: OperandReader, line: number) => InstrUnit;

const REGS3: ReadonlySet<string> = new Set([
  'add',
  'sub',
  'sll',
  'slt',
  'sltu',
  'xor',
  'srl',
  'sra',
  'or',
  'and',
]);
const I_ALU: ReadonlySet<string> = new Set(['addi', 'slti', 'sltiu', 'xori', 'ori', 'andi']);
const I_SHIFT: ReadonlySet<string> = new Set(['slli', 'srli', 'srai']);
const I_LOAD: ReadonlySet<string> = new Set(['lb', 'lh', 'lw', 'lbu', 'lhu']);
const S_STORE: ReadonlySet<string> = new Set(['sb', 'sh', 'sw']);
const B_BRANCH: ReadonlySet<string> = new Set(['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu']);
const U_TYPE: ReadonlySet<string> = new Set(['lui', 'auipc']);
const NO_OPERANDS: ReadonlySet<string> = new Set(['fence', 'ecall', 'ebreak']);

function rType(mnemonic: string): Handler {
  return (r, line) => {
    const rd = r.register();
    r.comma();
    const rs1 = r.register();
    r.comma();
    const rs2 = r.register();
    r.done();
    return { mnemonic, fields: { rd, rs1, rs2 }, line };
  };
}

function iAlu(mnemonic: string): Handler {
  return (r, line) => {
    const rd = r.register();
    r.comma();
    const rs1 = r.register();
    r.comma();
    const imm = r.immediate((v, t) => checkSigned(v, 12, 'immediate', t.line, t.col));
    r.done();
    return { mnemonic, fields: { rd, rs1, imm }, line };
  };
}

function iShift(mnemonic: string): Handler {
  return (r, line) => {
    const rd = r.register();
    r.comma();
    const rs1 = r.register();
    r.comma();
    const imm = r.immediate((v, t) => checkRange(v, 0, 31, 'shift amount', t.line, t.col));
    r.done();
    return { mnemonic, fields: { rd, rs1, imm }, line };
  };
}

function iLoad(mnemonic: string): Handler {
  return (r, line) => {
    const rd = r.register();
    r.comma();
    const { imm, rs1 } = r.memory();
    r.done();
    return { mnemonic, fields: { rd, rs1, imm }, line };
  };
}

function sStore(mnemonic: string): Handler {
  return (r, line) => {
    const rs2 = r.register();
    r.comma();
    const { imm, rs1 } = r.memory();
    r.done();
    return { mnemonic, fields: { rs1, rs2, imm }, line };
  };
}

function bBranch(mnemonic: string): Handler {
  return (r, line) => {
    const rs1 = r.register();
    r.comma();
    const rs2 = r.register();
    r.comma();
    const t = r.target();
    r.done();
    if (t.kind === 'imm') {
      checkSigned(t.value, 13, 'branch offset', t.tok.line, t.tok.col, true);
      return { mnemonic, fields: { rs1, rs2, imm: t.value }, line };
    }
    return {
      mnemonic,
      fields: { rs1, rs2 },
      reloc: { kind: 'branch', symbol: t.name, line: t.tok.line, col: t.tok.col },
      line,
    };
  };
}

function uType(mnemonic: string): Handler {
  return (r, line) => {
    const rd = r.register();
    r.comma();
    // The operand is the 20-bit upper value; the encoder wants it pre-shifted into
    // bits[31:12] (see the `lui x1, 0x12345` → imm 0x12345000 oracle).
    const upper = r.immediate((v, t) =>
      checkRange(v, 0, 0xfffff, `${mnemonic} immediate`, t.line, t.col),
    );
    r.done();
    return { mnemonic, fields: { rd, imm: upper << 12 }, line };
  };
}

function jal(r: OperandReader, line: number): InstrUnit {
  const rd = r.register();
  r.comma();
  const t = r.target();
  r.done();
  if (t.kind === 'imm') {
    checkSigned(t.value, 21, 'jump offset', t.tok.line, t.tok.col, true);
    return { mnemonic: 'jal', fields: { rd, imm: t.value }, line };
  }
  return {
    mnemonic: 'jal',
    fields: { rd },
    reloc: { kind: 'jump', symbol: t.name, line: t.tok.line, col: t.tok.col },
    line,
  };
}

/** `jalr` has several accepted forms; resolve them by lookahead. */
function jalr(r: OperandReader, line: number): InstrUnit {
  const rd = r.register();
  // `jalr rs1` — one operand: jump through rs1, link in ra.
  if (!r.peek()) return { mnemonic: 'jalr', fields: { rd: 1, rs1: rd, imm: 0 }, line };
  r.comma();
  // `jalr rd, imm(rs1)` — memory form.
  const head = r.peek();
  if (head?.type === 'number' && r.peekAt(1)?.type === 'lparen') {
    const { imm, rs1 } = r.memory();
    r.done();
    return { mnemonic: 'jalr', fields: { rd, rs1, imm }, line };
  }
  // Otherwise the next operand is rs1.
  const rs1 = r.register();
  // `jalr rd, rs1` → imm 0; `jalr rd, rs1, imm`.
  if (!r.peek()) {
    r.done();
    return { mnemonic: 'jalr', fields: { rd, rs1, imm: 0 }, line };
  }
  r.comma();
  const imm = r.immediate((v, t) => checkSigned(v, 12, 'immediate', t.line, t.col));
  r.done();
  return { mnemonic: 'jalr', fields: { rd, rs1, imm }, line };
}

function noOperands(mnemonic: string): Handler {
  return (r, line) => {
    r.done();
    return { mnemonic, fields: {}, line };
  };
}

/** Resolve the operand-syntax handler for a real mnemonic, or `undefined`. */
export function handlerFor(mnemonic: string): Handler | undefined {
  if (REGS3.has(mnemonic)) return rType(mnemonic);
  if (I_ALU.has(mnemonic)) return iAlu(mnemonic);
  if (I_SHIFT.has(mnemonic)) return iShift(mnemonic);
  if (I_LOAD.has(mnemonic)) return iLoad(mnemonic);
  if (S_STORE.has(mnemonic)) return sStore(mnemonic);
  if (B_BRANCH.has(mnemonic)) return bBranch(mnemonic);
  if (U_TYPE.has(mnemonic)) return uType(mnemonic);
  if (NO_OPERANDS.has(mnemonic)) return noOperands(mnemonic);
  if (mnemonic === 'jal') return jal;
  if (mnemonic === 'jalr') return jalr;
  return undefined;
}
