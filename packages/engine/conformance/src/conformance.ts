import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { run, type ReferenceResult } from '@cpu-viz/engine-reference';
import { toProgramImage } from '@cpu-viz/engine-common';
import { defaultConfig, type MachineState, type Processor } from '@cpu-viz/trace';

/**
 * The INV-8 differential net, extracted from `engine/single-cycle` when the second model landed
 * (m2 step 1). For EVERY example program, a model's final architectural state (registers +
 * memory + pc/halted) must equal the golden reference's. Microarchitecture changes timing and
 * internal movement, never the final result of a correct program (spec §9), so any divergence
 * here is a real bug in the model under test.
 *
 * The harness is **parameterized over a `() => Processor` factory** and imports NO
 * engine-under-test — the exact reason the reference's own diff path stays model-agnostic. Each
 * model's `differential.test.ts` shrinks to a single {@link runConformance} call. Everything in
 * this file is a **model-independent corpus fact** (the corpus, the equality contract, the
 * hand-computed headline oracles), which is why it lives here rather than in any one model's test.
 *
 * The example corpus IS the fixture set (spec §9: "one corpus, three jobs"): every `.s` under
 * `content/programs/` is enumerated from disk, so a program added later is covered automatically.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

/** Safety cap so an authoring bug that loops forever fails the test instead of hanging it. */
const MAX_STEPS = 100_000;

function asm(source: string): AssembledProgram {
  const { program, errors } = assemble(source);
  if (!program) {
    throw new Error(
      'assembly failed:\n' + errors.map((e) => `  ${e.line}:${e.column} ${e.message}`).join('\n'),
    );
  }
  return program;
}

/**
 * Drive a freshly-built processor to a halt, capped so a runaway program throws (not hangs).
 * Config-agnostic on purpose: passes {@link defaultConfig} so any {@link Processor} — whatever
 * knobs it honors — runs in its neutral mode.
 */
function runToHalt(makeProcessor: () => Processor, program: AssembledProgram): MachineState {
  const cpu = makeProcessor();
  cpu.reset(toProgramImage(program), defaultConfig());
  let steps = 0;
  while (!cpu.isHalted()) {
    if (steps >= MAX_STEPS) {
      throw new Error(`model ran past ${MAX_STEPS} steps without halting`);
    }
    cpu.step();
    steps++;
  }
  return cpu.getState();
}

/** Assert a model's final state equals the reference's — the INV-8 contract. */
function expectEquivalent(reference: MachineState, model: MachineState): void {
  // All 32 architectural registers.
  expect([...model.registers]).toEqual([...reference.registers]);

  // Memory: compare every word either engine ever touched (union of both, since a bug could
  // leave one engine writing an address the other never did). Text is loaded into both and is
  // identical, so it compares clean — no need to window it out (INV-2/INV-3).
  const addrs = new Set<number>([
    ...reference.memory.definedAddresses(),
    ...model.memory.definedAddresses(),
  ]);
  for (const addr of addrs) {
    expect(model.memory.readWord(addr), `memory word at 0x${addr.toString(16)}`).toBe(
      reference.memory.readWord(addr),
    );
  }

  // Strengthening beyond the INV-8 minimum: pin that halt timing mirrors the reference's final
  // state. `add.s` (halts via pc-out-of-range, not ecall) is where a mismatch surfaces first.
  expect(model.pc).toBe(reference.pc);
  expect(model.halted).toBe(reference.halted);
}

/**
 * Hand-computed headline results, asserted against the reference — the root of trust. Keyed by
 * filename; a program with no entry still gets the full equality check above, just no result
 * oracle. `regs` maps an architectural register index to its expected signed value; `mem` maps a
 * data label (resolved through the program's symbol table) to its expected final word. These are
 * **model-independent** corpus facts (e.g. sum-loop → 55), so they belong to the corpus, not to
 * any one model. Mirrors the reference's own hand-oracle methodology.
 */
const RESULT_ORACLES: Record<
  string,
  { regs?: Record<number, number>; mem?: Record<string, number> }
> = {
  // 5 + 37 = 42 in x5 (this seed program halts by running off the end of text).
  'add.s': { regs: { 5: 42 } },
  // 10+9+...+1 = 55 in a0 (x10); the counter t0 (x5) lands on 0.
  'sum-loop.s': { regs: { 10: 55, 5: 0 } },
  // 5+17-4+100+2 = 120 in a0 (x10) and stored back to `total`.
  'array-sum.s': { regs: { 10: 120 }, mem: { total: 120 } },
  // max(17, 42) = 42 in a0 (x10), saved to s0 (x8).
  'call-return.s': { regs: { 10: 42, 8: 42 } },
  // byte 0x80: lb → -128 in t1 (x6), lbu → +128 in t2 (x7).
  'byte-loads.s': { regs: { 6: -128, 7: 128 } },
};

const PROGRAMS = readdirSync(PROGRAMS_DIR)
  .filter((f) => f.endsWith('.s'))
  .sort();

/**
 * Register the full INV-8 conformance suite for one model. `modelName` labels the `describe`
 * block; `makeProcessor` builds a fresh instance per program. Call this at the top level of a
 * model's `differential.test.ts` — that file then carries no corpus, oracle, or equality logic.
 */
export function runConformance(modelName: string, makeProcessor: () => Processor): void {
  describe(`INV-8: ${modelName} ≡ golden reference on every example program`, () => {
    // Guard against a silently empty fixture set (e.g. a path regression) passing vacuously.
    it('discovers the example corpus on disk', () => {
      expect(PROGRAMS.length).toBeGreaterThan(0);
    });

    for (const file of PROGRAMS) {
      it(`${file}: final reg + mem state matches the reference`, () => {
        const program = asm(readFileSync(PROGRAMS_DIR + file, 'utf8'));

        const reference: ReferenceResult = run(program, { maxSteps: MAX_STEPS });
        const model = runToHalt(makeProcessor, program);

        // Both must genuinely halt — a max-steps stop would compare two truncated runs.
        expect(reference.haltReason, `reference halt reason for ${file}`).not.toBe('max-steps');
        expect(model.halted).toBe(true);

        expectEquivalent(reference.state, model);

        // Headline-result oracle (correctness, not just agreement) against the reference.
        const oracle = RESULT_ORACLES[file];
        if (oracle) {
          for (const [reg, value] of Object.entries(oracle.regs ?? {})) {
            expect(reference.state.registers[Number(reg)], `x${reg} in ${file}`).toBe(value);
          }
          for (const [label, value] of Object.entries(oracle.mem ?? {})) {
            const addr = program.symbols.get(label);
            expect(addr, `label '${label}' in ${file}`).toBeDefined();
            expect(reference.state.memory.readWord(addr!), `${label} in ${file}`).toBe(value);
          }
        }
      });
    }
  });
}
