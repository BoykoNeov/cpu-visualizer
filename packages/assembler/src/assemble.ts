/**
 * The two-pass assembler driver.
 *
 * Pass 1 (layout): tokenize each line, bind labels, expand pseudo-instructions, and
 * assign every emitted word an address — sizes are known without resolving labels
 * (`li` is sized by its literal, `la` is always 2 words), so the symbol table comes
 * out complete and forward references just work.
 *
 * Pass 2 (encode): resolve each label-dependent immediate ({@link Reloc}) now that
 * all addresses are known, then hand concrete fields to the shared `isa` encoder.
 *
 * Errors are located (line:column) and collected rather than thrown to the caller:
 * a single bad statement is recorded and skipped so one run can report several
 * problems. Pass-2 (symbol-resolution) errors are only surfaced once pass 1 is clean,
 * so addresses are trustworthy when offsets are range-checked.
 */

import { encode } from '@cpu-viz/isa';
import { AssemblyError, checkSigned, fail, type AssemblerError } from './diagnostics';
import { handlerFor } from './operands';
import { OperandReader } from './operands';
import { expandPseudo, hiLo, isPseudo } from './pseudo';
import { DATA_BASE, TEXT_BASE, type AssembledProgram } from './program';
import { tokenizeLine, type Token } from './tokenizer';
import type { InstructionFields } from '@cpu-viz/isa';
import type { InstrUnit, Reloc } from './units';

/** The result of assembling: either a program, or a non-empty list of errors. */
export interface AssembleResult {
  program: AssembledProgram | null;
  errors: AssemblerError[];
}

type Section = 'text' | 'data';

interface Placeholder {
  unit: InstrUnit;
  pc: number;
}

/** Assemble RV32I source text into an {@link AssembledProgram} (or located errors). */
export function assemble(source: string): AssembleResult {
  const errors: AssemblerError[] = [];
  const symbols = new Map<string, number>();
  const placeholders: Placeholder[] = [];
  const dataBytes: number[] = [];

  let section: Section = 'text';
  let textCursor = TEXT_BASE;

  const dataAddr = () => DATA_BASE + dataBytes.length;

  const record = (e: unknown): void => {
    if (e instanceof AssemblyError) errors.push(e.diagnostic);
    else throw e;
  };

  // --- Pass 1: layout + symbol table ---------------------------------------
  const lines = source.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const line = n + 1; // 1-based
    let tokens: Token[];
    try {
      tokens = tokenizeLine(lines[n] ?? '', line);
    } catch (e) {
      record(e);
      continue;
    }

    let idx = 0;
    // Leading labels (`name:`), possibly several.
    while (tokens[idx]?.type === 'ident' && tokens[idx + 1]?.type === 'colon') {
      const labelTok = tokens[idx]!;
      try {
        if (symbols.has(labelTok.text))
          fail(`duplicate label '${labelTok.text}'`, labelTok.line, labelTok.col);
        symbols.set(labelTok.text, section === 'text' ? textCursor : dataAddr());
      } catch (e) {
        record(e);
      }
      idx += 2;
    }

    const head = tokens[idx];
    if (!head) continue; // blank / comment / label-only line
    const rest = tokens.slice(idx + 1);

    try {
      if (head.type !== 'ident') {
        fail(
          `expected an instruction, directive, or label but found '${head.text}'`,
          head.line,
          head.col,
        );
      }
      if (head.text.startsWith('.')) {
        section = handleDirective(head, rest, section, dataBytes);
      } else {
        textCursor = handleInstruction(head, rest, section, textCursor, placeholders);
      }
    } catch (e) {
      record(e);
    }
  }

  if (errors.length > 0) return { program: null, errors };

  // --- Pass 2: resolve relocations + encode --------------------------------
  const words = new Uint32Array(placeholders.length);
  const sourceMap = new Map<number, number>();
  for (let i = 0; i < placeholders.length; i++) {
    const { unit, pc } = placeholders[i]!;
    try {
      const fields = unit.reloc ? resolveReloc(unit.reloc, unit.fields, pc, symbols) : unit.fields;
      words[i] = encode(unit.mnemonic, fields) >>> 0;
      sourceMap.set(pc, unit.line);
    } catch (e) {
      record(e);
    }
  }

  if (errors.length > 0) return { program: null, errors };

  const data = dataBytes.length > 0 ? [{ addr: DATA_BASE, bytes: Uint8Array.from(dataBytes) }] : [];
  return { program: { words, sourceMap, symbols, data }, errors: [] };
}

/** Lower one instruction statement to placeholder(s); returns the advanced text cursor. */
function handleInstruction(
  head: Token,
  rest: Token[],
  section: Section,
  textCursor: number,
  out: Placeholder[],
): number {
  if (section !== 'text') {
    fail(`instruction '${head.text}' must be in the .text section`, head.line, head.col);
  }
  const mnemonic = head.text;
  const reader = new OperandReader(rest, head);

  let units: InstrUnit[];
  if (isPseudo(mnemonic)) {
    units = expandPseudo(mnemonic, reader, head.line);
  } else {
    const handler = handlerFor(mnemonic);
    if (!handler) fail(`unknown instruction '${mnemonic}'`, head.line, head.col);
    units = [handler(reader, head.line)];
  }

  let pc = textCursor;
  for (const unit of units) {
    out.push({ unit, pc });
    pc += 4;
  }
  return pc;
}

/** Apply a directive; returns the (possibly switched) current section. */
function handleDirective(
  head: Token,
  rest: Token[],
  section: Section,
  dataBytes: number[],
): Section {
  const name = head.text;
  switch (name) {
    case '.text':
      expectNoOperands(head, rest);
      return 'text';
    case '.data':
      expectNoOperands(head, rest);
      return 'data';
    case '.globl':
    case '.global': {
      // Recorded for completeness; our flat model has a single namespace so it has
      // no effect on output beyond requiring a symbol operand.
      const sym = rest[0];
      if (!sym || sym.type !== 'ident') fail(`${name} expects a symbol name`, head.line, head.col);
      if (rest.length > 1)
        fail(`unexpected operand after ${name} ${sym.text}`, rest[1]!.line, rest[1]!.col);
      return section;
    }
    case '.word':
      requireData(head, section);
      for (const v of readNumberList(head, rest, (val, t) => check32(val, t)))
        pushWord(dataBytes, v);
      return section;
    case '.byte':
      requireData(head, section);
      for (const v of readNumberList(head, rest, (val, t) => checkByte(val, t)))
        dataBytes.push(v & 0xff);
      return section;
    case '.asciz':
    case '.asciiz':
    case '.string': {
      requireData(head, section);
      const str = rest[0];
      if (!str || str.type !== 'string')
        fail(`${name} expects a quoted string`, head.line, head.col);
      if (rest.length > 1) fail(`unexpected operand after ${name}`, rest[1]!.line, rest[1]!.col);
      pushAsciz(dataBytes, str);
      return section;
    }
    default:
      fail(`unknown directive '${name}'`, head.line, head.col);
  }
}

function resolveReloc(
  reloc: Reloc,
  fields: InstructionFields,
  pc: number,
  symbols: Map<string, number>,
): InstructionFields {
  const addr = symbols.get(reloc.symbol);
  if (addr === undefined) fail(`undefined symbol '${reloc.symbol}'`, reloc.line, reloc.col);
  switch (reloc.kind) {
    case 'branch': {
      const off = addr - pc;
      checkSigned(off, 13, `branch to '${reloc.symbol}'`, reloc.line, reloc.col, true);
      return { ...fields, imm: off };
    }
    case 'jump': {
      const off = addr - pc;
      checkSigned(off, 21, `jump to '${reloc.symbol}'`, reloc.line, reloc.col, true);
      return { ...fields, imm: off };
    }
    case 'hi':
      return { ...fields, imm: hiLo(addr).hi << 12 };
    case 'lo':
      return { ...fields, imm: hiLo(addr).lo };
  }
}

// --- directive helpers -----------------------------------------------------

function expectNoOperands(head: Token, rest: Token[]): void {
  if (rest.length > 0) fail(`unexpected operand after ${head.text}`, rest[0]!.line, rest[0]!.col);
}

function requireData(head: Token, section: Section): void {
  if (section !== 'data') fail(`${head.text} must be in the .data section`, head.line, head.col);
}

/** Read `v (, v)*` from a directive's operand tokens, checking each value. */
function readNumberList(
  head: Token,
  rest: Token[],
  check: (v: number, t: Token) => number,
): number[] {
  if (rest.length === 0) fail(`${head.text} expects at least one value`, head.line, head.col);
  const values: number[] = [];
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]!;
    if (i % 2 === 0) {
      if (tok.type !== 'number')
        fail(`expected a number but found '${tok.text}'`, tok.line, tok.col);
      values.push(check(tok.value as number, tok));
    } else if (tok.type !== 'comma') {
      fail(`expected ',' but found '${tok.text}'`, tok.line, tok.col);
    }
  }
  if (rest[rest.length - 1]!.type === 'comma') {
    const last = rest[rest.length - 1]!;
    fail(`trailing ',' in ${head.text}`, last.line, last.col);
  }
  return values;
}

function pushWord(dataBytes: number[], v: number): void {
  const u = v >>> 0;
  dataBytes.push(u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff, (u >>> 24) & 0xff); // little-endian
}

function pushAsciz(dataBytes: number[], str: Token): void {
  const s = str.value as string;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code > 0xff) fail('non-byte character in string', str.line, str.col);
    dataBytes.push(code);
  }
  dataBytes.push(0); // null terminator
}

function check32(v: number, t: Token): number {
  if (v < -(2 ** 31) || v > 2 ** 32 - 1)
    fail(`.word value ${v} does not fit in 32 bits`, t.line, t.col);
  return v;
}

function checkByte(v: number, t: Token): number {
  if (v < -128 || v > 255) fail(`.byte value ${v} does not fit in a byte`, t.line, t.col);
  return v;
}
