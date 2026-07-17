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

/**
 * The assembly-SYNTAX classes, as distinct from `InstructionDef.format` (the encoding
 * class) — see this file's header. Two instructions share a class exactly when they read
 * the same operand grammar, so this union is the assembler's own answer to "what may I
 * write after this mnemonic".
 *
 * It is exported because it is the only correct source for that question, and the ISA
 * reference panel asks it. {@link handlerFor} dispatches through {@link syntaxClassOf},
 * so the class that *documents* an instruction and the class that *parses* it are the
 * same value: a panel cannot describe a grammar the assembler does not accept, the way
 * two hand-maintained tables would eventually let it.
 */
export type SyntaxClass =
  | 'r-type'
  | 'i-alu'
  | 'i-shift'
  | 'i-load'
  | 's-store'
  | 'b-branch'
  | 'u-type'
  | 'no-operands'
  | 'jal'
  | 'jalr';

const CLASS_MEMBERS: Readonly<Record<SyntaxClass, readonly string[]>> = {
  'r-type': ['add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and'],
  'i-alu': ['addi', 'slti', 'sltiu', 'xori', 'ori', 'andi'],
  'i-shift': ['slli', 'srli', 'srai'],
  'i-load': ['lb', 'lh', 'lw', 'lbu', 'lhu'],
  's-store': ['sb', 'sh', 'sw'],
  'b-branch': ['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu'],
  'u-type': ['lui', 'auipc'],
  'no-operands': ['fence', 'ecall', 'ebreak'],
  jal: ['jal'],
  jalr: ['jalr'],
};

const CLASS_OF: ReadonlyMap<string, SyntaxClass> = new Map(
  Object.entries(CLASS_MEMBERS).flatMap(([cls, mnemonics]) =>
    mnemonics.map((m) => [m, cls as SyntaxClass] as const),
  ),
);

/**
 * The operand grammar of each class, as a reader sees it — the forms {@link handlerFor}'s
 * handler for that class accepts, written the way you would type them.
 *
 * A list rather than a string because `jalr` genuinely accepts four forms by lookahead, and
 * the shorthands are exactly what a learner reaches for. The `Record` over the closed union
 * makes exhaustiveness the type-checker's job: a new class cannot be added without one.
 *
 * These strings describe the handlers below and are checked against them only indirectly —
 * what pins them is that every reference-panel example assembles (`isa-reference.test.ts`).
 */
export const SYNTAX_FORMS: Readonly<Record<SyntaxClass, readonly string[]>> = {
  'r-type': ['rd, rs1, rs2'],
  'i-alu': ['rd, rs1, imm'],
  'i-shift': ['rd, rs1, shamt'],
  'i-load': ['rd, offset(rs1)'],
  's-store': ['rs2, offset(rs1)'],
  'b-branch': ['rs1, rs2, label'],
  'u-type': ['rd, imm20'],
  'no-operands': [''],
  jal: ['rd, label'],
  jalr: ['rd, rs1, imm', 'rd, rs1', 'rd, offset(rs1)', 'rs1'],
};

/** The syntax class of a real mnemonic, or `undefined` if it is not one. */
export function syntaxClassOf(mnemonic: string): SyntaxClass | undefined {
  return CLASS_OF.get(mnemonic);
}

/** Every real mnemonic the assembler parses, grouped by the grammar it reads. */
export const SYNTAX_CLASS_MEMBERS = CLASS_MEMBERS;

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

/**
 * Resolve the operand-syntax handler for a real mnemonic, or `undefined`.
 *
 * Dispatches through {@link syntaxClassOf} rather than re-testing membership sets, so the
 * class a mnemonic is *documented* under and the handler that *parses* it are chosen by one
 * lookup. The `switch` over the closed union is exhaustive without a `default`.
 */
export function handlerFor(mnemonic: string): Handler | undefined {
  const cls = syntaxClassOf(mnemonic);
  if (!cls) return undefined;
  switch (cls) {
    case 'r-type':
      return rType(mnemonic);
    case 'i-alu':
      return iAlu(mnemonic);
    case 'i-shift':
      return iShift(mnemonic);
    case 'i-load':
      return iLoad(mnemonic);
    case 's-store':
      return sStore(mnemonic);
    case 'b-branch':
      return bBranch(mnemonic);
    case 'u-type':
      return uType(mnemonic);
    case 'no-operands':
      return noOperands(mnemonic);
    case 'jal':
      return jal;
    case 'jalr':
      return jalr;
  }
}
