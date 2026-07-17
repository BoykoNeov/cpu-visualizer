/**
 * Register name resolution. Accepts both the numeric form (`x0`..`x31`) and the
 * standard RISC-V ABI names (`zero`, `ra`, `sp`, `a0`..`a7`, `t0`..`t6`, `s0`..`s11`,
 * with `fp` aliasing `s0`). Pseudo-instructions lean on the ABI names (`ret` → `ra`,
 * branches → `zero`), and the example corpus uses the numeric form — both are common
 * enough that a teaching assembler should read either.
 */

import { fail } from './diagnostics';
import type { Token } from './tokenizer';

/**
 * The ABI name → register number map the assembler accepts. Exported because it is the only
 * correct answer to "which names may I type", which the ISA reference panel asks: `resolveRegister`
 * reads this table, so a name listed here is a name that assembles, by construction.
 *
 * Not a bijection — `fp` and `s0` are both x8 — so a number → name display list (as the register
 * panel wants) is a lossy projection of it and stays the view's own choice.
 */
export const ABI_REGISTERS: Readonly<Record<string, number>> = {
  zero: 0,
  ra: 1,
  sp: 2,
  gp: 3,
  tp: 4,
  t0: 5,
  t1: 6,
  t2: 7,
  s0: 8,
  fp: 8,
  s1: 9,
  a0: 10,
  a1: 11,
  a2: 12,
  a3: 13,
  a4: 14,
  a5: 15,
  a6: 16,
  a7: 17,
  s2: 18,
  s3: 19,
  s4: 20,
  s5: 21,
  s6: 22,
  s7: 23,
  s8: 24,
  s9: 25,
  s10: 26,
  s11: 27,
  t3: 28,
  t4: 29,
  t5: 30,
  t6: 31,
};

/** Resolve a register-name token to its number 0..31, or fail with its location. */
export function resolveRegister(tok: Token): number {
  if (tok.type !== 'ident') fail(`expected a register, found ${describe(tok)}`, tok.line, tok.col);
  const name = tok.text;

  const xMatch = /^x(\d+)$/.exec(name);
  if (xMatch) {
    const num = Number(xMatch[1]);
    if (num > 31) fail(`no such register ${name} (registers are x0..x31)`, tok.line, tok.col);
    return num;
  }

  const abi = ABI_REGISTERS[name];
  if (abi !== undefined) return abi;

  fail(`unknown register ${JSON.stringify(name)}`, tok.line, tok.col);
}

function describe(tok: Token): string {
  return tok.type === 'number' || tok.type === 'string' ? tok.text : `'${tok.text}'`;
}
