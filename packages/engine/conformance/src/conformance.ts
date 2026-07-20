import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { run, type ReferenceResult } from '@cpu-viz/engine-reference';
import { toProgramImage } from '@cpu-viz/engine-common';
import {
  defaultConfig,
  type CacheConfig,
  type MachineState,
  type Processor,
  type ProcessorConfig,
} from '@cpu-viz/trace';

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
 * It is also **parameterized over a list of configs** (m3 step 0), defaulting to the single
 * neutral {@link defaultConfig}. That default was adequate while every model ignored its config;
 * it stops being adequate for the first model whose behavior *depends* on config (the pipeline's
 * forwarding toggle), where running only the neutral config would prove the model correct in one
 * toggle position and say nothing at all about the other.
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
 * Drive a freshly-built processor to a halt under `config`, capped so a runaway program throws
 * (not hangs). Whether a model honors any of `config` is its own business — a config-blind model
 * behaves identically whatever it is handed.
 */
function runToHalt(
  makeProcessor: () => Processor,
  program: AssembledProgram,
  config: ProcessorConfig,
): MachineState {
  const cpu = makeProcessor();
  cpu.reset(toProgramImage(program), config);
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
  // (1+2+...+12) = 78, summed twice: 2*78 = 156 in a0 (x10); the outer pass
  // counter t3 (x28) lands on 0. The repeat pass re-reads the same addresses
  // (temporal reuse) — the cache-relevant fact this program adds, architecturally
  // invisible here, so its net is M6's timing (step 4), not this equality.
  'array-sum-twice.s': { regs: { 10: 156, 28: 0 } },
  // max(17, 42) = 42 in a0 (x10), saved to s0 (x8).
  'call-return.s': { regs: { 10: 42, 8: 42 } },
  // byte 0x80: lb → -128 in t1 (x6), lbu → +128 in t2 (x7).
  'byte-loads.s': { regs: { 6: -128, 7: 128 } },
  // min(0xFFFFFFFF, 1) computed twice over the SAME bits: signed (blt) → -1 in a0 (x10),
  // unsigned (bltu) → 1 in a1 (x11). Both are non-zero, so neither can pass by matching the
  // reset value — the trap this program exists for is that the two answers disagree.
  'branch-flavors.s': { regs: { 10: -1, 11: 1 } },
};

const PROGRAMS = readdirSync(PROGRAMS_DIR)
  .filter((f) => f.endsWith('.s'))
  .sort();

/**
 * The whole INV-8 check for ONE (config, program) pair: assemble, run the reference, run the
 * model under `config`, and assert equivalence. **Throws** (a vitest assertion error) on any
 * mismatch — it makes no `it()` registration of its own.
 *
 * Extracted from the `it()` body so the harness is testable by the same means it tests models
 * with: `conformance.test.ts` calls this directly with a stub and asserts it throws under one
 * config and not the other. Deliberately NOT re-exported from the package `index.ts` — models
 * see only {@link runConformance}.
 */
export function checkProgram(
  makeProcessor: () => Processor,
  config: ProcessorConfig,
  file: string,
): void {
  const program = asm(readFileSync(PROGRAMS_DIR + file, 'utf8'));

  const reference: ReferenceResult = run(program, { maxSteps: MAX_STEPS });
  const model = runToHalt(makeProcessor, program, config);

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
}

/**
 * Name a config for an `it()` title, so a failure says which position broke — naming exactly the
 * knobs that VARY across `among`, and no others.
 *
 * **Derived rather than declared, because the declared version broke the moment M4 used it.** This
 * function used to hardcode `forwarding`, with a comment promising `branchPrediction` would "join
 * when a model honors them (M4)". When it did, the pipeline's six-config matrix collapsed onto two
 * labels: three separate schemes all reported as `[forwarding off]`, so a failure could not say
 * which one broke — and the harness's own distinctness guard never noticed, because it was only
 * ever handed the two-forwarding list. A guard whose case list cannot reach the collision is not a
 * guard.
 *
 * Naming what varies fixes that class rather than that instance. A list that varies only forwarding
 * gets exactly M3's titles back (so no existing suite moves); a list that varies both gets both;
 * and a knob every config shares is silent, since a label constant across the matrix distinguishes
 * nothing and only adds noise. `cache` joins the same way (M6 step 3) — but it is the first
 * OBJECT-valued knob, so "does it vary" is a {@link cacheEquals} deep compare rather than a `!==`,
 * and its rendered value is a {@link cacheLabel} canonical string rather than a scalar.
 *
 * The load-bearing invariant across that pair: **`cacheLabel` renders exactly the fields
 * `cacheEquals` distinguishes**, so `cacheEquals(a, b) === false ⟹ cacheLabel(a) !== cacheLabel(b)`.
 * Two configs that differ ONLY in cache share their forwarding/predict labels, so the cache label is
 * the only thing left to tell their titles apart — if it collapsed distinct caches to one string the
 * report could not name which config broke, the exact defect M4 found one axis down. Rendering all
 * three geometry fields (even the ones constant across the shipped matrix, e.g. `/p10`) is the price
 * of that guarantee; a "name only the sub-fields that vary" cache render would re-open the very gap,
 * since equality would call two configs distinct while the label called them the same.
 */
function cacheEquals(a: CacheConfig | null, b: CacheConfig | null): boolean {
  if (a === null || b === null) return a === b;
  return a.lineSize === b.lineSize && a.numLines === b.numLines && a.missPenalty === b.missPenalty;
}

/**
 * A cache config's canonical title fragment — injective over distinct configs (see {@link
 * configLabel}). `null` (the timing shadow absent) reads `cache off`; a present cache renders all
 * three geometry fields so no two distinct configs collide: `cache 2×16B/p10` is `numLines`,
 * `lineSize`, `missPenalty`. Terse because it is a test title, not prose — injectivity beats prose.
 */
function cacheLabel(cache: CacheConfig | null): string {
  if (cache === null) return 'cache off';
  return `cache ${cache.numLines}×${cache.lineSize}B/p${cache.missPenalty}`;
}

function configLabel(config: ProcessorConfig, among: readonly ProcessorConfig[]): string {
  const first = among[0];
  if (first === undefined) return '';
  const parts: string[] = [];
  if (among.some((c) => c.forwarding !== first.forwarding)) {
    parts.push(`forwarding ${config.forwarding ? 'on' : 'off'}`);
  }
  if (among.some((c) => c.branchPrediction !== first.branchPrediction)) {
    parts.push(`predict ${config.branchPrediction}`);
  }
  if (among.some((c) => !cacheEquals(c.cache, first.cache))) {
    parts.push(cacheLabel(config.cache));
  }
  // `issueWidth` (M7 step 3) joins by the same rule, and is the cheapest axis yet: a plain optional
  // number, so `!==` is the whole comparison — no `cacheEquals` analogue needed. Two things make it
  // worth a line of its own. It is the axis whose two positions are **architecturally
  // indistinguishable by construction** (an in-order superscalar retires in order, so width 1 and
  // width 2 reach identical final state — see the superscalar's `differential.test.ts`), which means
  // a title collision here would be invisible in a way the forwarding and cache collisions were not:
  // both columns pass, so nothing ever forces you to read the names. And because the field is
  // OPTIONAL, every pre-M7 config leaves it `undefined` — `undefined !== undefined` is false, so
  // those suites stay silent for free rather than by a special case. The render still defaults,
  // since an unset width means the single-issue machine.
  if (among.some((c) => c.issueWidth !== first.issueWidth)) {
    parts.push(`width ${config.issueWidth ?? 1}`);
  }
  return parts.join(', ');
}

/** One `it()` the matrix will register: which program, under which config, named how. */
export interface ConformanceCase {
  config: ProcessorConfig;
  file: string;
  /** The `it()` title — the config is named only when there is more than one to tell apart. */
  title: string;
}

/**
 * Enumerate the matrix — the full corpus once per config — as **pure data**, no `it()` in sight.
 *
 * Split out from {@link runConformance} for the same reason {@link checkProgram} was: so the part
 * that could silently go vacuous is directly assertable. A matrix that ran only `configs[0]`, or
 * that labelled every case identically, would pass a suite built from it while proving the model
 * in one position only — so `conformance.test.ts` asserts on this list rather than trusting the
 * loop by eye. Not re-exported from the package `index.ts`; models see only `runConformance`.
 */
export function conformanceCases(configs: readonly ProcessorConfig[]): ConformanceCase[] {
  const cases: ConformanceCase[] = [];
  for (const config of configs) {
    // A label only distinguishes when there is something to distinguish; naming a lone neutral
    // config would suggest a config-blind model cared about it. `configLabel` applies the same
    // rule one level down, per knob — so a lone config and a knob that never varies are the same
    // case, and both stay silent.
    const label = configLabel(config, configs);
    const suffix = label === '' ? '' : ` [${label}]`;
    for (const file of PROGRAMS) {
      cases.push({
        config,
        file,
        title: `${file}${suffix}: final reg + mem state matches the reference`,
      });
    }
  }
  return cases;
}

/**
 * Register the full INV-8 conformance suite for one model, once per config in `configs`.
 * `modelName` labels the `describe` block; `makeProcessor` builds a fresh instance per (config,
 * program) pair. Call this at the top level of a model's `differential.test.ts` — that file then
 * carries no corpus, oracle, or equality logic.
 *
 * `configs` defaults to the single neutral {@link defaultConfig}, which is why the config-blind
 * models' suites behave exactly as they did before the matrix existed. A model whose behavior
 * depends on config passes every position it claims to honor, e.g.
 * `runConformance('pipeline', () => new PipelineProcessor(), [forwardingOff, forwardingOn])`.
 */
export function runConformance(
  modelName: string,
  makeProcessor: () => Processor,
  configs: readonly ProcessorConfig[] = [defaultConfig()],
): void {
  describe(`INV-8: ${modelName} ≡ golden reference on every example program`, () => {
    // Guard against a silently empty fixture set (e.g. a path regression) passing vacuously.
    it('discovers the example corpus on disk', () => {
      expect(PROGRAMS.length).toBeGreaterThan(0);
    });

    // ...and against an empty matrix doing the same, which would skip the corpus entirely.
    it('runs the corpus under at least one config', () => {
      expect(configs.length).toBeGreaterThan(0);
    });

    for (const { config, file, title } of conformanceCases(configs)) {
      it(title, () => {
        checkProgram(makeProcessor, config, file);
      });
    }
  });
}
