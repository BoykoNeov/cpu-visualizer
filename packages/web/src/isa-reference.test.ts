/**
 * The net under the ISA reference. The panel makes claims to a learner who cannot yet tell
 * whether they are true — so a wrong claim here is worse than a missing one, and these tests
 * are what let the prose be trusted:
 *
 * 1. **Exhaustive, both directions** — every instruction / pseudo / directive the tools accept
 *    is described, and nothing is described that they do not accept. Keyed off the real sources
 *    (`INSTRUCTIONS`, `PSEUDO_MNEMONICS`, `DIRECTIVES`), never a hand-copy, so it cannot go
 *    vacuous the way a guard with its own case list does.
 * 2. **Every example actually assembles**, and every instruction example decodes back to the
 *    mnemonic whose row it sits on — the check that catches an example that assembles as
 *    something *else*.
 * 3. **Every register name listed is a name that resolves.**
 */

import {
  assemble,
  ABI_REGISTERS,
  DIRECTIVES,
  PSEUDO_MNEMONICS,
  syntaxClassOf,
} from '@cpu-viz/assembler';
import { decode, INSTRUCTIONS } from '@cpu-viz/isa';
import { describe, expect, it } from 'vitest';
import { ABI_REGISTER_NAMES } from './format';
import {
  DIRECTIVE_NOTES,
  INSTRUCTION_NOTES,
  PSEUDO_NOTES,
  directiveEntries,
  formsFor,
  instructionSections,
  pseudoEntries,
  registerCount,
  registerEntries,
} from './isa-reference';

/**
 * A minimal program that makes a one-line example assemblable: the labels and data the
 * examples reference (`target` for branches/jumps, `arr` for `la`) exist, and the example
 * sits FIRST in `.text` so `words[0]` is the instruction under test.
 */
const inText = (line: string): string =>
  `.data\narr:    .word 1, 2, 3\n.text\n_start:\n${line}\ntarget:\n    nop\n`;

/** Directives are examples *of* section/data syntax, so they are placed in a data context. */
const inData = (line: string): string => `.data\n${line}\n`;

const assembleOk = (source: string) => {
  const result = assemble(source);
  return result;
};

describe('isa-reference: exhaustive over the real sources', () => {
  it('describes every instruction the ISA defines, and no others', () => {
    const declared = Object.keys(INSTRUCTION_NOTES).sort();
    const real = INSTRUCTIONS.map((d) => d.mnemonic).sort();
    expect(declared).toEqual(real);
  });

  it('describes every pseudo-instruction the assembler expands, and no others', () => {
    expect(Object.keys(PSEUDO_NOTES).sort()).toEqual([...PSEUDO_MNEMONICS].sort());
  });

  it('describes every directive the assembler accepts, and no others', () => {
    expect(Object.keys(DIRECTIVE_NOTES).sort()).toEqual([...DIRECTIVES].sort());
  });

  it('renders every instruction into some group (none silently dropped)', () => {
    const shown = instructionSections().flatMap((s) => s.entries.map((e) => e.name));
    expect(shown.sort()).toEqual(INSTRUCTIONS.map((d) => d.mnemonic).sort());
  });

  it('lists every register name the assembler accepts', () => {
    expect(
      registerEntries()
        .map((r) => r.name)
        .sort(),
    ).toEqual(Object.keys(ABI_REGISTERS).sort());
  });
});

describe('isa-reference: the grammar is the assembler own', () => {
  it('can classify every instruction the ISA defines', () => {
    // Not a reference concern so much as a real invariant the reference happens to need: an
    // instruction the ISA defines but the assembler cannot parse would be unusable and unsayable.
    const unclassified = INSTRUCTIONS.filter((d) => syntaxClassOf(d.mnemonic) === undefined);
    expect(unclassified.map((d) => d.mnemonic)).toEqual([]);
  });

  it('leads every syntax form with the mnemonic it belongs to', () => {
    for (const def of INSTRUCTIONS) {
      for (const form of formsFor(def.mnemonic)) {
        expect(form === def.mnemonic || form.startsWith(`${def.mnemonic} `)).toBe(true);
      }
    }
  });

  it('gives jalr all four forms it really accepts, and each of them assembles', () => {
    // The one instruction with genuine alternates — and the shorthands are what a learner types.
    const forms = formsFor('jalr');
    expect(forms).toHaveLength(4);
    const concrete = ['jalr ra, t1, 0', 'jalr ra, t1', 'jalr ra, 0(t1)', 'jalr t1'];
    for (const line of concrete) {
      expect(assembleOk(inText(line)).errors, line).toEqual([]);
    }
  });
});

describe('isa-reference: every example is real assembly', () => {
  const instructionEntries = instructionSections().flatMap((s) => s.entries);

  it.each(instructionEntries.map((e) => [e.name, e.example] as const))(
    '%s: the example assembles and decodes back to itself',
    (name, example) => {
      const { program, errors } = assembleOk(inText(example));
      expect(errors).toEqual([]);
      expect(program).not.toBeNull();
      expect(decode(program!.words[0]!).mnemonic).toBe(name);
    },
  );

  it.each(pseudoEntries().map((e) => [e.name, e.example] as const))(
    '%s: the pseudo example assembles to at least one real instruction',
    (_name, example) => {
      const { program, errors } = assembleOk(inText(example));
      expect(errors).toEqual([]);
      expect(program!.words.length).toBeGreaterThanOrEqual(1);
    },
  );

  it.each(directiveEntries().map((e) => [e.name, e.example] as const))(
    '%s: the directive example assembles',
    (_name, example) => {
      expect(assembleOk(inData(example)).errors).toEqual([]);
    },
  );

  it('every register name listed can actually be typed as an operand', () => {
    for (const { name } of registerEntries()) {
      expect(assembleOk(`.text\naddi t0, ${name}, 0\n`).errors, name).toEqual([]);
    }
  });
});

describe('isa-reference: display order is editorial, and that is deliberate', () => {
  it('opens Arithmetic with add, not addi', () => {
    // The ISA table is ordered by OPCODE, so iterating it put `addi` (0x13) above `add` (0x33) in
    // a group this file invented for learners. True about the encoding, meaningless to a reader.
    // Caught in the browser with the whole suite green — order was nobody's assertion until now.
    const arithmetic = instructionSections().find((s) => s.group === 'Arithmetic');
    expect(arithmetic?.entries.map((e) => e.name)).toEqual(['add', 'sub', 'addi']);
  });

  it('lists the canonical name before its alias (s0 above fp)', () => {
    // Both are x8. Sorting names alphabetically within the tie put the ALIAS first, so its role
    // ("another name for s0") pointed at a row below it. `registers.ts` declares s0 first; a
    // stable sort on the number alone inherits that, which is why the tiebreak is absent.
    const names = registerEntries().map((r) => r.name);
    expect(names.indexOf('s0')).toBeLessThan(names.indexOf('fp'));
  });

  it('counts registers (32), not register names (33 — fp aliases s0)', () => {
    expect(registerCount()).toBe(32);
    expect(registerEntries()).toHaveLength(33);
  });
});

describe('isa-reference: the register roles it claims', () => {
  it('reports each name at the number the assembler resolves it to', () => {
    for (const { name, number } of registerEntries()) {
      expect(ABI_REGISTERS[name], name).toBe(number);
    }
  });

  it('keeps the display list in format.ts consistent with the names the assembler accepts', () => {
    // `ABI_REGISTER_NAMES` is a number -> name projection the view owns (x8 is `s0`, not `fp`),
    // so it is legitimately a separate list — but it is still the same knowledge, and this pins
    // the two together rather than leaving a second hand-maintained table to drift.
    expect(ABI_REGISTER_NAMES).toHaveLength(32);
    ABI_REGISTER_NAMES.forEach((name, i) => {
      expect(ABI_REGISTERS[name], `${name} should be x${i}`).toBe(i);
    });
  });

  it('marks x0 as the hardwired zero it is', () => {
    const zero = registerEntries().find((r) => r.name === 'zero');
    expect(zero?.number).toBe(0);
    expect(zero?.role).toMatch(/zero/i);
  });
});
