import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import { SuperscalarProcessor, SUPERSCALAR_CAPABILITIES } from './index';

/**
 * The three surfaces M7 step 2a introduces that neither `differential.test.ts` (final state) nor
 * `timing.test.ts` (M3's cycle counts, transplanted) can see:
 *
 *  1. the `"<stage>.<slot>"` `location` encoding — a deliberate difference from M3, pinned here;
 *  2. `reset()`'s refusal of any width but 1 — the honest "not yet" that keeps the toggle from
 *     silently lying while the pairing logic is still unwritten;
 *  3. the capabilities constant, enumerated exhaustively so a new knob cannot be added without this
 *     model stating its stance (the shape M7 step 1 pinned across the family).
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

function runFile(file: string, config: ProcessorConfig = defaultConfig()): CycleTrace[] {
  const { program, errors } = assemble(readFileSync(PROGRAMS_DIR + file, 'utf8'));
  if (!program) throw new Error('assembly failed: ' + errors.map((e) => e.message).join('; '));
  const p = new SuperscalarProcessor();
  p.reset(toProgramImage(program), config);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) traces.push(p.step());
  return traces;
}

describe('the "<stage>.<slot>" location encoding', () => {
  const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'];

  it('is slotted at width 1 — never a bare stage name', () => {
    // The whole content of the pin. Emitting bare names at width 1 and slotted ones at width 2
    // would make the encoding depend on a config the view cannot see, so every consumer would need
    // both spellings. One spelling everywhere is the honest contract, and `stageFamily` (M3 step 7)
    // already folds `"EX.0"` back to `EX`, so no consumer pays for it.
    const seen = new Set<string>();
    for (const t of runFile('array-sum.s')) {
      for (const i of t.instructions) seen.add(i.location);
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const location of seen) {
      expect(STAGES.map((s) => `${s}.0`)).toContain(location);
    }
    // ...and all five stages really are exercised, so this is not vacuously true of a run that
    // never filled the pipe.
    expect([...seen].sort()).toEqual(STAGES.map((s) => `${s}.0`).sort());
  });

  it('walks one instruction IF.0 → ID.0 → EX.0 → MEM.0 → WB.0, in that order', () => {
    // INV-4's stable id is what makes this readable at all: the same id appears in five successive
    // stages. At width 1 the slot never changes — a slot is a per-cycle ISSUE POSITION, not a
    // stable lane, so once pairing exists an instruction may well change slots. Pinning the
    // width-1 walk now is what will make that change visible when it happens.
    const ts = runFile('add.s');
    const first = ts[0]!.instructions[0]!.id;
    const walk = ts
      .map((t) => t.instructions.find((i) => i.id === first)?.location)
      .filter((l): l is string => l !== undefined);
    expect(walk).toEqual(['IF.0', 'ID.0', 'EX.0', 'MEM.0', 'WB.0']);
  });

  it('leaves the EVENT vocabulary byte-identical to the pipeline — only `location` is slotted', () => {
    // The boundary, stated as an assertion rather than left to prose. `stall.stage` and
    // `flush.stages` are cross-model surfaces three consumers already read (the datapath, the map's
    // cut rows, the curriculum); slotting them would be a schema change wearing a string's clothes,
    // and at width 1 there is nothing a slot could disambiguate anyway. Whether they should carry
    // slots once a PAIR can die together is step 2b's question, to be decided against an observed
    // multi-slot flush.
    const ts = runFile('array-sum.s', { ...defaultConfig(), forwarding: true });
    for (const t of ts) {
      for (const e of t.events) {
        if (e.type === 'stall') expect(e.stage).toBe('ID');
        if (e.type === 'flush') expect(e.stages.every((s) => !s.includes('.'))).toBe(true);
        if (e.type === 'forward') expect(['EX.rs1', 'EX.rs2']).toContain(e.to);
      }
    }
  });
});

describe('issueWidth', () => {
  const image = () => {
    const { program } = assemble('.text\naddi x1, x0, 1\necall\n');
    return toProgramImage(program!);
  };

  it('defaults to 1 when the config omits it', () => {
    // `issueWidth` is OPTIONAL in `ProcessorConfig` (it follows `seed`'s precedent, not `cache`'s),
    // so an absent value means "no opinion" and must not throw — every existing config literal in
    // the repo omits it, including `defaultConfig()`.
    const p = new SuperscalarProcessor();
    expect(() => p.reset(image(), defaultConfig())).not.toThrow();
    expect(p.isHalted()).toBe(false);
  });

  it('accepts an explicit 1', () => {
    const p = new SuperscalarProcessor();
    expect(() => p.reset(image(), { ...defaultConfig(), issueWidth: 1 })).not.toThrow();
  });

  it('accepts an explicit 2 — step 2b made the other toggle position a real machine', () => {
    // Step 2a's refusal lived here, and lifting it is the headline of step 2b. It was an honest
    // "not yet": a model that had accepted width 2 while quietly issuing one instruction per cycle
    // would have been indistinguishable from a working dual-issue machine to every consumer except
    // a cycle count — and the width toggle's entire observable effect IS a cycle count.
    const p = new SuperscalarProcessor();
    expect(() => p.reset(image(), { ...defaultConfig(), issueWidth: 2 })).not.toThrow();
    expect(p.isHalted()).toBe(false);
  });

  it('still rejects widths the machine does not have', () => {
    // 1 and 2 are the toggle; anything else would need pairing rules this model has not got, and
    // running narrow while the config says otherwise is the one failure mode worth throwing over.
    const p = new SuperscalarProcessor();
    expect(() => p.reset(image(), { ...defaultConfig(), issueWidth: 0 })).toThrow();
    expect(() => p.reset(image(), { ...defaultConfig(), issueWidth: 3 })).toThrow();
  });
});

describe('capabilities', () => {
  it('is the first model in the family that honors every knob', () => {
    // Enumerated EXHAUSTIVELY on purpose, in the shape M7 step 1 pinned across the family: a new
    // config knob must be a compile error here, so that adding one forces this model to state a
    // stance rather than inheriting a default nobody chose.
    expect(SUPERSCALAR_CAPABILITIES).toEqual({
      model: 'superscalar',
      pipelined: true,
      hasHazards: true,
      configurableForwarding: true,
      configurableBranchPrediction: true,
      configurableCache: true,
      configurableIssueWidth: true,
    });
  });

  it('is exposed on the instance', () => {
    expect(new SuperscalarProcessor().capabilities).toBe(SUPERSCALAR_CAPABILITIES);
  });
});

describe('micro is slot-shaped, and each snapshot is its own', () => {
  it('every latch is an array of `width` slots', () => {
    const state = runFile('add.s')[0]!.state;
    const micro = state.micro as {
      width: number;
      ifId: unknown[];
      idEx: unknown[];
      exMem: unknown[];
      memWb: unknown[];
    };
    expect(micro.width).toBe(1);
    for (const slots of [micro.ifId, micro.idEx, micro.exMem, micro.memWb]) {
      expect(Array.isArray(slots)).toBe(true);
      expect(slots).toHaveLength(1);
    }
  });

  it('does not alias slot arrays across cycles — the time-travel bug conformance cannot see', () => {
    // The recorder keeps every cycle, so a shared array would replay as latest-values-everywhere.
    // Final-state conformance is structurally blind to it; only a cross-cycle comparison sees it.
    const ts = runFile('add.s');
    const arrays = ts.map((t) => (t.state.micro as { idEx: unknown[] }).idEx);
    expect(new Set(arrays).size).toBe(arrays.length);
    // ...and the contents really do differ over time, so the check above is not vacuous.
    const occupants = ts.map(
      (t) => ((t.state.micro as { idEx: ({ instr: string } | null)[] }).idEx[0] ?? null)?.instr,
    );
    expect(new Set(occupants).size).toBeGreaterThan(1);
  });
});
