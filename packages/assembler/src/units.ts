/**
 * The intermediate representation between parsing and encoding. One source
 * instruction (real or pseudo) lowers to one or more {@link InstrUnit}s — each a
 * single real RV32I machine word — with operand fields filled in. Anything that
 * depends on a label's address is deferred to a {@link Reloc} resolved in pass 2,
 * after the whole symbol table is known.
 */

import type { InstructionFields } from '@cpu-viz/isa';

/**
 * A symbol-dependent immediate, resolved once all labels have addresses (pass 2):
 * - `branch` / `jump` — PC-relative byte offset `target - pc` (B / J immediates).
 * - `hi` / `lo` — the upper-20 / signed-low-12 split of a symbol's absolute address
 *   (the `lui`+`addi` pair behind `la`; same split as `li` for a 32-bit constant).
 */
export interface Reloc {
  readonly kind: 'branch' | 'jump' | 'hi' | 'lo';
  readonly symbol: string;
  /** 1-based location of the symbol reference, for an undefined/out-of-range error. */
  readonly line: number;
  readonly col: number;
}

/** One real RV32I instruction word, pre-encoding. */
export interface InstrUnit {
  readonly mnemonic: string;
  /** Concrete operand fields; `imm` may be filled by {@link reloc} in pass 2. */
  readonly fields: InstructionFields;
  /** Set when `imm` depends on a label address. */
  readonly reloc?: Reloc;
  /** Source line this unit maps back to (handoff §8 source-map; shared across an expansion). */
  readonly line: number;
}
