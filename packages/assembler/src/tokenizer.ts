/**
 * Line tokenizer. Each source line is lexed independently into a flat token stream
 * carrying 1-based columns, so the parser and operand readers can attach precise
 * `line:column` locations to every diagnostic (handoff §8).
 *
 * Lexical scope is deliberately small (handoff §16 keeps the assembler tight):
 * `#` starts a comment to end-of-line; numbers are decimal / `0x` / `0b` with an
 * optional leading sign; strings are double-quoted with C-style escapes; the only
 * punctuation is `, ( ) :`. Char literals, label arithmetic, and `;` comments are
 * intentionally out of scope.
 */

import { fail } from './diagnostics';

export type TokenType = 'ident' | 'number' | 'string' | 'comma' | 'lparen' | 'rparen' | 'colon';

export interface Token {
  readonly type: TokenType;
  /** Source text of the token (for messages); for strings, the raw inner text. */
  readonly text: string;
  /** Decoded value: a number for `number`, the unescaped contents for `string`. */
  readonly value: number | string | null;
  /** 1-based line. */
  readonly line: number;
  /** 1-based column of the token's first character. */
  readonly col: number;
}

const IDENT_START = /[A-Za-z_.]/;
const IDENT_REST = /[A-Za-z0-9_.$]/;
const DIGIT = /[0-9]/;

/** Tokenize one source line. `line` is the 1-based line number for diagnostics. */
export function tokenizeLine(text: string, line: number): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = text.length;
  const col = () => i + 1; // 1-based

  while (i < n) {
    const c = text[i]!;

    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '#') break; // comment to end of line

    if (c === ',') {
      tokens.push({ type: 'comma', text: ',', value: null, line, col: col() });
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ type: 'lparen', text: '(', value: null, line, col: col() });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'rparen', text: ')', value: null, line, col: col() });
      i++;
      continue;
    }
    if (c === ':') {
      tokens.push({ type: 'colon', text: ':', value: null, line, col: col() });
      i++;
      continue;
    }

    if (c === '"') {
      const start = col();
      const { value, raw, next } = lexString(text, i, line, start);
      tokens.push({ type: 'string', text: raw, value, line, col: start });
      i = next;
      continue;
    }

    // A number: optional sign immediately followed by a digit.
    if (DIGIT.test(c) || ((c === '-' || c === '+') && i + 1 < n && DIGIT.test(text[i + 1]!))) {
      const start = col();
      const startIdx = i;
      if (c === '-' || c === '+') i++;
      i = scanNumberDigits(text, i);
      const raw = text.slice(startIdx, i);
      tokens.push({
        type: 'number',
        text: raw,
        value: parseNumber(raw, line, start),
        line,
        col: start,
      });
      continue;
    }

    if (IDENT_START.test(c)) {
      const start = col();
      const startIdx = i;
      i++;
      while (i < n && IDENT_REST.test(text[i]!)) i++;
      const raw = text.slice(startIdx, i);
      tokens.push({ type: 'ident', text: raw, value: null, line, col: start });
      continue;
    }

    fail(`unexpected character ${JSON.stringify(c)}`, line, col());
  }

  return tokens;
}

/** Advance past the digit body of a number (after any sign). */
function scanNumberDigits(text: string, i: number): number {
  const n = text.length;
  if (text[i] === '0' && i + 1 < n && (text[i + 1] === 'x' || text[i + 1] === 'X')) {
    i += 2;
    while (i < n && /[0-9a-fA-F]/.test(text[i]!)) i++;
    return i;
  }
  if (text[i] === '0' && i + 1 < n && (text[i + 1] === 'b' || text[i + 1] === 'B')) {
    i += 2;
    while (i < n && /[01]/.test(text[i]!)) i++;
    return i;
  }
  while (i < n && DIGIT.test(text[i]!)) i++;
  return i;
}

/** Parse a numeric literal (decimal / `0x` / `0b`, optional sign) to a JS number. */
function parseNumber(raw: string, line: number, col: number): number {
  let s = raw;
  let sign = 1;
  if (s[0] === '+') s = s.slice(1);
  else if (s[0] === '-') {
    sign = -1;
    s = s.slice(1);
  }

  let value: number;
  if (/^0[xX][0-9a-fA-F]+$/.test(s)) value = parseInt(s.slice(2), 16);
  else if (/^0[bB][01]+$/.test(s)) value = parseInt(s.slice(2), 2);
  else if (/^[0-9]+$/.test(s)) value = parseInt(s, 10);
  else fail(`malformed number ${JSON.stringify(raw)}`, line, col);

  if (!Number.isFinite(value)) fail(`malformed number ${JSON.stringify(raw)}`, line, col);
  return sign * value;
}

/** Lex a double-quoted string starting at `start` (index of the opening quote). */
function lexString(
  text: string,
  start: number,
  line: number,
  col: number,
): { value: string; raw: string; next: number } {
  const n = text.length;
  let i = start + 1;
  let out = '';
  while (i < n) {
    const c = text[i]!;
    if (c === '"') {
      return { value: out, raw: text.slice(start, i + 1), next: i + 1 };
    }
    if (c === '\\') {
      const e = text[i + 1];
      switch (e) {
        case 'n':
          out += '\n';
          break;
        case 't':
          out += '\t';
          break;
        case 'r':
          out += '\r';
          break;
        case '0':
          out += '\0';
          break;
        case '\\':
          out += '\\';
          break;
        case '"':
          out += '"';
          break;
        case "'":
          out += "'";
          break;
        default:
          fail(`unknown string escape ${JSON.stringify('\\' + (e ?? ''))}`, line, i + 1);
      }
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  fail('unterminated string literal', line, col);
}
