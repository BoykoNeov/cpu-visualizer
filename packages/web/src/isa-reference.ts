/**
 * The ISA reference: what a learner editing a program is allowed to type.
 *
 * The editor lets anyone rewrite the program, but nothing in the shell ever said which
 * instructions exist — so this is the vocabulary surface for the editor, split strictly by
 * **what already has an authority**:
 *
 * - **Which** instructions exist is DERIVED — `INSTRUCTIONS` (isa), `PSEUDO_MNEMONICS` and
 *   `DIRECTIVES` (the assembler's own dispatch tables), `ABI_REGISTERS` (the names
 *   `resolveRegister` accepts). Nothing here re-lists them; `isa-reference.test.ts` fails if
 *   the notes below and those sources disagree in either direction.
 * - **What the grammar is** is DERIVED for real instructions, via `syntaxClassOf` +
 *   `SYNTAX_FORMS` — the same class `handlerFor` dispatches on, so this cannot describe a
 *   form the assembler would reject. Pseudos and directives have no class layer (one bespoke
 *   handler each), so their forms are declared here and pinned by the example test.
 * - **What an instruction MEANS** is the one genuinely new artifact: no source in this repo
 *   carries learner prose, so it is declared below. It lives in `web` and not in `isa`
 *   because `isa` exists to encode and decode — teaching prose in the encoder is the
 *   view-in-the-engine mistake INV-2/INV-3 exist to forbid. (`web` is also the only package
 *   that can see both `isa` and `assembler` under the dependency DAG, so the choice is
 *   forced as well as principled.)
 *
 * Every `example` is real assembly that is **actually assembled by the test suite** (and, for
 * real instructions, decoded back to check it is an example *of* the instruction it sits on).
 * That is what makes this a reference rather than a promise: a panel that lies about the
 * grammar is worse than no panel, and prose is the one thing here a type cannot check.
 *
 * The summaries describe **this simulator**, not the RISC-V spec, wherever the two differ —
 * `fence` is a no-op here and `ecall` halts unconditionally, and a learner needs the former.
 */

import {
  ABI_REGISTERS,
  DIRECTIVES,
  PSEUDO_MNEMONICS,
  SYNTAX_FORMS,
  syntaxClassOf,
} from '@cpu-viz/assembler';
import { INSTRUCTIONS } from '@cpu-viz/isa';

/** One row of the reference: a thing you can type, what it does, and a line that works. */
export interface RefEntry {
  name: string;
  /**
   * Full syntax lines (`add rd, rs1, rs2`). More than one only where the assembler genuinely
   * accepts more than one — `jalr` resolves four forms by lookahead, and the shorthands are
   * exactly what a learner reaches for.
   */
  forms: readonly string[];
  summary: string;
  /** Real assembly; pinned by `isa-reference.test.ts`. */
  example: string;
}

/** Display grouping for the instruction list — a pedagogical axis, not an encoding one. */
export type InstrGroup =
  | 'Arithmetic'
  | 'Logic'
  | 'Shifts'
  | 'Compare'
  | 'Loads'
  | 'Stores'
  | 'Branches'
  | 'Jumps'
  | 'Upper immediates'
  | 'System';

/** The order groups are shown in: roughly the order a course introduces them. */
export const INSTR_GROUPS: readonly InstrGroup[] = [
  'Arithmetic',
  'Logic',
  'Shifts',
  'Compare',
  'Loads',
  'Stores',
  'Branches',
  'Jumps',
  'Upper immediates',
  'System',
];

interface Note {
  group: InstrGroup;
  summary: string;
  example: string;
}

/**
 * The declared half: meaning + a worked example per real instruction. Keyed by mnemonic and
 * checked against `INSTRUCTIONS` for exhaustiveness (both directions) by the test — adding an
 * instruction to the ISA without describing it here fails the suite.
 */
export const INSTRUCTION_NOTES: Readonly<Record<string, Note>> = {
  // --- Arithmetic ---
  add: {
    group: 'Arithmetic',
    summary: 'Adds two registers: rd = rs1 + rs2. Wraps on overflow — there is no trap.',
    example: 'add t0, t1, t2',
  },
  sub: {
    group: 'Arithmetic',
    summary: 'Subtracts: rd = rs1 - rs2. Wraps on overflow.',
    example: 'sub t0, t1, t2',
  },
  addi: {
    group: 'Arithmetic',
    summary: 'Adds a constant: rd = rs1 + imm. The immediate is signed and must fit -2048..2047.',
    example: 'addi t0, t1, 42',
  },

  // --- Logic ---
  and: { group: 'Logic', summary: 'Bitwise AND: rd = rs1 & rs2.', example: 'and t0, t1, t2' },
  or: { group: 'Logic', summary: 'Bitwise OR: rd = rs1 | rs2.', example: 'or t0, t1, t2' },
  xor: { group: 'Logic', summary: 'Bitwise XOR: rd = rs1 ^ rs2.', example: 'xor t0, t1, t2' },
  andi: {
    group: 'Logic',
    summary: 'Bitwise AND with a constant — the usual way to mask bits off.',
    example: 'andi t0, t1, 255',
  },
  ori: {
    group: 'Logic',
    summary: 'Bitwise OR with a constant — the usual way to set bits.',
    example: 'ori t0, t1, 255',
  },
  xori: {
    group: 'Logic',
    summary: 'Bitwise XOR with a constant. With -1 it flips every bit.',
    example: 'xori t0, t1, -1',
  },

  // --- Shifts ---
  sll: {
    group: 'Shifts',
    summary: 'Shift left logical: rd = rs1 << rs2. Only the low 5 bits of rs2 are used.',
    example: 'sll t0, t1, t2',
  },
  srl: {
    group: 'Shifts',
    summary: 'Shift right logical: rd = rs1 >> rs2, filling with zeros.',
    example: 'srl t0, t1, t2',
  },
  sra: {
    group: 'Shifts',
    summary: 'Shift right arithmetic: rd = rs1 >> rs2, filling with the sign bit.',
    example: 'sra t0, t1, t2',
  },
  slli: {
    group: 'Shifts',
    summary: 'Shift left by a constant. Shifting left by n multiplies by 2^n. shamt is 0..31.',
    example: 'slli t0, t1, 2',
  },
  srli: {
    group: 'Shifts',
    summary: 'Shift right by a constant, filling with zeros. shamt is 0..31.',
    example: 'srli t0, t1, 2',
  },
  srai: {
    group: 'Shifts',
    summary:
      'Shift right by a constant, filling with the sign bit — divides a signed value by 2^n.',
    example: 'srai t0, t1, 2',
  },

  // --- Compare ---
  slt: {
    group: 'Compare',
    summary: 'Set if less than, signed: rd = 1 when rs1 < rs2, otherwise 0.',
    example: 'slt t0, t1, t2',
  },
  sltu: {
    group: 'Compare',
    summary: 'Set if less than, unsigned: rd = 1 when rs1 < rs2 comparing as unsigned.',
    example: 'sltu t0, t1, t2',
  },
  slti: {
    group: 'Compare',
    summary: 'Set if less than a constant, signed.',
    example: 'slti t0, t1, 10',
  },
  sltiu: {
    group: 'Compare',
    summary: 'Set if less than a constant, comparing as unsigned.',
    example: 'sltiu t0, t1, 10',
  },

  // --- Loads ---
  lw: {
    group: 'Loads',
    summary: 'Loads a 32-bit word from memory at rs1 + offset.',
    example: 'lw t0, 0(t1)',
  },
  lh: {
    group: 'Loads',
    summary: 'Loads 2 bytes and sign-extends them to 32 bits.',
    example: 'lh t0, 0(t1)',
  },
  lb: {
    group: 'Loads',
    summary: 'Loads 1 byte and sign-extends it to 32 bits.',
    example: 'lb t0, 0(t1)',
  },
  lhu: {
    group: 'Loads',
    summary: 'Loads 2 bytes and zero-extends them — use this for unsigned data.',
    example: 'lhu t0, 0(t1)',
  },
  lbu: {
    group: 'Loads',
    summary: 'Loads 1 byte and zero-extends it — use this for unsigned data.',
    example: 'lbu t0, 0(t1)',
  },

  // --- Stores ---
  sw: {
    group: 'Stores',
    summary: 'Stores all 32 bits of rs2 to memory at rs1 + offset.',
    example: 'sw t0, 0(t1)',
  },
  sh: { group: 'Stores', summary: 'Stores the low 2 bytes of rs2.', example: 'sh t0, 0(t1)' },
  sb: { group: 'Stores', summary: 'Stores the low byte of rs2.', example: 'sb t0, 0(t1)' },

  // --- Branches ---
  beq: {
    group: 'Branches',
    summary: 'Branches to the label when rs1 == rs2.',
    example: 'beq t0, t1, target',
  },
  bne: {
    group: 'Branches',
    summary: 'Branches to the label when rs1 != rs2.',
    example: 'bne t0, t1, target',
  },
  blt: {
    group: 'Branches',
    summary: 'Branches when rs1 < rs2, compared as signed.',
    example: 'blt t0, t1, target',
  },
  bge: {
    group: 'Branches',
    summary: 'Branches when rs1 >= rs2, compared as signed.',
    example: 'bge t0, t1, target',
  },
  bltu: {
    group: 'Branches',
    summary: 'Branches when rs1 < rs2, compared as unsigned.',
    example: 'bltu t0, t1, target',
  },
  bgeu: {
    group: 'Branches',
    summary: 'Branches when rs1 >= rs2, compared as unsigned.',
    example: 'bgeu t0, t1, target',
  },

  // --- Jumps ---
  jal: {
    group: 'Jumps',
    summary:
      'Jumps to the label and saves the return address (pc + 4) in rd. This is how you call.',
    example: 'jal ra, target',
  },
  jalr: {
    group: 'Jumps',
    summary:
      'Jumps to rs1 + imm and saves pc + 4 in rd. The target comes from a register, which is what makes returning possible.',
    example: 'jalr ra, t1, 0',
  },

  // --- Upper immediates ---
  lui: {
    group: 'Upper immediates',
    summary:
      'Loads a 20-bit constant into the top of rd: rd = imm << 12, low 12 bits zero. Pairs with addi to build any 32-bit value — which is what li does for you.',
    example: 'lui t0, 0x12345',
  },
  auipc: {
    group: 'Upper immediates',
    summary: 'rd = pc + (imm << 12). The PC-relative half of reaching far addresses.',
    example: 'auipc t0, 0x1',
  },

  // --- System ---
  ecall: {
    group: 'System',
    summary:
      'Environment call. This simulator halts the program on any ecall, whatever a7 holds — it is how a program ends.',
    example: 'ecall',
  },
  ebreak: {
    group: 'System',
    summary: 'Breakpoint. This simulator halts the program, same as ecall.',
    example: 'ebreak',
  },
  fence: {
    group: 'System',
    summary:
      'Orders memory operations. This simulator does one thing at a time, so it does nothing at all here.',
    example: 'fence',
  },
};

/**
 * The declared half for pseudo-instructions: these are not real machine instructions — the
 * assembler expands each into one or more real ones, which the source panel shows you.
 * Forms are declared (unlike real instructions, each pseudo is a bespoke handler with no
 * shared class to derive from) and pinned by assembling the example.
 */
export const PSEUDO_NOTES: Readonly<
  Record<string, { form: string; summary: string; example: string }>
> = {
  li: {
    form: 'rd, imm',
    summary:
      'Loads any 32-bit constant into rd. Becomes one addi, or lui + addi when the value is too big for 12 bits.',
    example: 'li t0, 1000',
  },
  mv: {
    form: 'rd, rs',
    summary: 'Copies a register: rd = rs. Becomes addi rd, rs, 0.',
    example: 'mv t0, t1',
  },
  nop: {
    form: '',
    summary: 'Does nothing for one instruction. Becomes addi x0, x0, 0.',
    example: 'nop',
  },
  la: {
    form: 'rd, symbol',
    summary: 'Loads the address of a label into rd. Always two instructions (lui + addi).',
    example: 'la t0, arr',
  },
  j: {
    form: 'label',
    summary: 'Jumps to a label without saving a return address. Becomes jal x0, label.',
    example: 'j target',
  },
  jr: {
    form: 'rs',
    summary: 'Jumps to the address held in a register. Becomes jalr x0, rs, 0.',
    example: 'jr t0',
  },
  ret: {
    form: '',
    summary: 'Returns from a function — jumps to the address in ra. Becomes jalr x0, ra, 0.',
    example: 'ret',
  },
  beqz: {
    form: 'rs, label',
    summary: 'Branches when rs == 0. Becomes beq rs, x0, label.',
    example: 'beqz t0, target',
  },
  bnez: {
    form: 'rs, label',
    summary: 'Branches when rs != 0. Becomes bne rs, x0, label.',
    example: 'bnez t0, target',
  },
};

/** The declared half for directives. Keyed by the assembler's own dispatch keys, aliases included. */
export const DIRECTIVE_NOTES: Readonly<
  Record<string, { form: string; summary: string; example: string }>
> = {
  '.text': {
    form: '.text',
    summary: 'Starts the code section. Instructions must live here.',
    example: '.text',
  },
  '.data': {
    form: '.data',
    summary: 'Starts the data section. Constants and arrays live here.',
    example: '.data',
  },
  '.word': {
    form: '.word v, ...',
    summary: 'Places 32-bit values in .data. Label the first one and you have an array.',
    example: '.word 1, 2, 3',
  },
  '.byte': {
    form: '.byte v, ...',
    summary: 'Places single bytes in .data.',
    example: '.byte 1, 2, 3',
  },
  '.asciz': {
    form: '.asciz "text"',
    summary: 'Places a NUL-terminated string in .data.',
    example: '.asciz "hi"',
  },
  '.asciiz': {
    form: '.asciiz "text"',
    summary: 'Another spelling of .asciz.',
    example: '.asciiz "hi"',
  },
  '.string': {
    form: '.string "text"',
    summary: 'Another spelling of .asciz.',
    example: '.string "hi"',
  },
  '.globl': {
    form: '.globl symbol',
    summary:
      'Marks a symbol as global. Accepted for compatibility; it has no effect in this simulator.',
    example: '.globl _start',
  },
  '.global': {
    form: '.global symbol',
    summary: 'Another spelling of .globl.',
    example: '.global _start',
  },
};

/** The syntax lines for a real mnemonic, derived from the class the assembler parses it with. */
export function formsFor(mnemonic: string): readonly string[] {
  const cls = syntaxClassOf(mnemonic);
  if (!cls) return [mnemonic];
  return SYNTAX_FORMS[cls].map((form) => (form ? `${mnemonic} ${form}` : mnemonic));
}

/**
 * The instruction rows, grouped for display.
 *
 * **Membership is derived, ORDER is editorial, and the split is the point.** Iterating
 * `INSTRUCTIONS` (as this first did) inherits the ISA table's order, which is by *opcode* —
 * so "Arithmetic" opened with `addi` ahead of `add`, because 0x13 sorts before 0x33. That is
 * a true fact about the encoding and a meaningless one to a learner reading a group this file
 * invented. There is no source for pedagogical order, so the notes' own key order IS it.
 *
 * Membership stays underivable-from-drift anyway: a note for a mnemonic the ISA does not define
 * is skipped here (never rendered) and fails the exhaustiveness test there.
 */
export function instructionSections(): { group: InstrGroup; entries: RefEntry[] }[] {
  const real = new Set(INSTRUCTIONS.map((d) => d.mnemonic));
  const byGroup = new Map<InstrGroup, RefEntry[]>(INSTR_GROUPS.map((g) => [g, []]));
  for (const [mnemonic, note] of Object.entries(INSTRUCTION_NOTES)) {
    if (!real.has(mnemonic)) continue;
    byGroup.get(note.group)?.push({
      name: mnemonic,
      forms: formsFor(mnemonic),
      summary: note.summary,
      example: note.example,
    });
  }
  return INSTR_GROUPS.map((group) => ({ group, entries: byGroup.get(group) ?? [] })).filter(
    (s) => s.entries.length > 0,
  );
}

/** The pseudo-instruction rows. Membership comes from the assembler's own pseudo table. */
export function pseudoEntries(): RefEntry[] {
  return PSEUDO_MNEMONICS.flatMap((name) => {
    const note = PSEUDO_NOTES[name];
    if (!note) return [];
    return [
      {
        name,
        forms: [note.form ? `${name} ${note.form}` : name],
        summary: note.summary,
        example: note.example,
      },
    ];
  });
}

/** The directive rows. Membership comes from the assembler's own directive dispatch table. */
export function directiveEntries(): RefEntry[] {
  return DIRECTIVES.flatMap((name) => {
    const note = DIRECTIVE_NOTES[name];
    if (!note) return [];
    return [{ name, forms: [note.form], summary: note.summary, example: note.example }];
  });
}

/** One register row: every name `resolveRegister` accepts, with what it is conventionally for. */
export interface RegisterEntry {
  name: string;
  number: number;
  role: string;
}

/**
 * What a register is *for*. Only x0's rule is architectural — the rest is calling convention,
 * which this simulator does not enforce: nothing stops you using s0 as a scratch register. It
 * is here because the corpus and every pseudo (`ret` → ra) follow it, so a learner reading the
 * example programs needs it to make sense of them.
 */
function roleOf(name: string, num: number): string {
  if (name === 'fp') return 'Frame pointer — another name for s0.';
  if (num === 0) return 'Always reads as zero. Writes to it are discarded.';
  if (num === 1) return 'Return address. jal writes it; ret jumps to it.';
  if (num === 2) return 'Stack pointer.';
  if (num === 3) return 'Global pointer.';
  if (num === 4) return 'Thread pointer.';
  if (num >= 10 && num <= 17) return 'Argument / return value.';
  if ((num >= 8 && num <= 9) || (num >= 18 && num <= 27))
    return 'Saved — a function is expected to leave it as it found it.';
  return 'Temporary — free to clobber.';
}

/**
 * Every register name the assembler accepts, ordered by number.
 *
 * Ties (x8 is both `s0` and `fp`) are broken by the assembler's own declaration order, which
 * lists the canonical name first — hence a stable sort on the number ALONE. Sorting names
 * alphabetically within a tie put `fp` above `s0`, so the alias came first and its role text
 * ("another name for s0") pointed at a row underneath it. The fix is to delete the tiebreak,
 * not to write one: `registers.ts` already knows which name is the real one.
 */
export function registerEntries(): RegisterEntry[] {
  return Object.entries(ABI_REGISTERS)
    .map(([name, number]) => ({ name, number, role: roleOf(name, number) }))
    .sort((a, b) => a.number - b.number);
}

/** How many registers there are (32) — distinct from how many NAMES resolve to one (33, with `fp`). */
export function registerCount(): number {
  return new Set(registerEntries().map((r) => r.number)).size;
}

/**
 * A starter program for the empty editor: the smallest thing that computes something and
 * stops. Assembled by the test like every other example.
 */
export const STARTER_PROGRAM = `    .text
_start:
    li   t0, 5          # t0 = 5
    li   t1, 37         # t1 = 37
    add  a0, t0, t1     # a0 = 42
    ecall               # stop here
`;
