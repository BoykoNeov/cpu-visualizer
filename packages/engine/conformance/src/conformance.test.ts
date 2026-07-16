import { describe, expect, it } from 'vitest';
import type { AssembledProgram } from '@cpu-viz/assembler';
import { run } from '@cpu-viz/engine-reference';
import {
  defaultConfig,
  type CycleTrace,
  type MachineState,
  type Processor,
  type ProcessorCapabilities,
  type ProcessorConfig,
  type ProgramImage,
} from '@cpu-viz/trace';
import { checkProgram, conformanceCases, runConformance } from './conformance';

/**
 * The harness's own test: proves the config matrix (m3 step 0) is **not vacuous** — that a config
 * a caller passes genuinely reaches the model under test, and that a model correct in one config
 * position and broken in the other is caught rather than averaged away.
 *
 * This matters because the thing step 0 replaced could not do it. The pre-matrix harness ran every
 * model under exactly one config, {@link defaultConfig} — which has `forwarding: false`. So a stub
 * correct with forwarding OFF and wrong with forwarding ON is precisely the bug the old harness was
 * structurally blind to: it would have gone **green**. Under the matrix it fails, and the `it()`
 * title says which position broke.
 *
 * Three things need proving, and they need different means:
 *  1. the **check** is config-sensitive — the `checkProgram` pair below;
 *  2. `runConformance` genuinely **hands each config in its list to the model** — the inverted-stub
 *     suite at the bottom, which goes through the public entry point rather than around it;
 *  3. a **multi-config** list really does run the corpus once per config, distinctly labelled — the
 *     `conformanceCases` block. Claims 1 and 2 both run against a single config, so neither would
 *     notice a matrix that only ever ran `configs[0]`.
 *
 * Note this proves a *fidelity* net, not a timing one: INV-8 compares final architectural state
 * only, so a pipeline that merely over-stalls still passes both positions silently. That blind
 * spot is m3 step 3's problem (pinned cycle-count tests), not this file's.
 */

/** The register the broken position corrupts. Any register works — `+1` is always a mismatch. */
const PERTURBED_REG = 5;

/** The one corpus program the `checkProgram` pair uses: 5 + 37 = 42 in x5 (see RESULT_ORACLES). */
const PROGRAM = 'add.s';

/**
 * A stub {@link Processor} that delegates to the golden reference for its answer, then **breaks
 * itself in one `forwarding` position** — the one named by `brokenWhenForwarding`. Delegation is
 * the point: in its good position it is exactly right by construction, so the `not.toThrow()` half
 * of the pair below is a real statement about the stub, which in turn makes the `toThrow()` half
 * attributable to the perturbation alone rather than to some incidental error.
 *
 * It is program-agnostic — it rebuilds its input from the {@link ProgramImage} it is handed — so
 * `runConformance` can drive it over the whole corpus. It halts at reset and never steps:
 * `runToHalt`'s loop is `while (!isHalted())`, so `step()` is unreachable. A one-shot stub has no
 * microarchitecture to model and needs none; this file tests the harness, not a CPU.
 */
class ReferenceBackedStub implements Processor {
  readonly capabilities: ProcessorCapabilities = {
    model: 'conformance-self-test-stub',
    pipelined: false,
    hasHazards: false,
    // The one knob it "honors" — dishonestly, which is the whole point.
    configurableForwarding: true,
    configurableBranchPrediction: false,
    configurableCache: false,
  };

  private state: MachineState | null = null;

  /** @param brokenWhenForwarding the `forwarding` position in which this stub corrupts its answer. */
  constructor(private readonly brokenWhenForwarding: boolean) {}

  reset(image: ProgramImage, config: ProcessorConfig): void {
    // `run` reads only `words` and `data` — it resolves nothing by label — so the image is a
    // complete input for it and the empty symbol table is never consulted.
    const program: AssembledProgram = {
      words: image.words,
      data: image.data,
      sourceMap: new Map(image.sourceMap),
      symbols: new Map(),
    };

    const { state } = run(program);
    if (config.forwarding === this.brokenWhenForwarding) {
      state.registers[PERTURBED_REG] = state.registers[PERTURBED_REG]! + 1;
    }
    this.state = state;
  }

  step(): CycleTrace {
    throw new Error('unreachable: the stub is halted at reset, so runToHalt never steps it');
  }

  getState(): MachineState {
    if (!this.state) throw new Error('getState() before reset()');
    return this.state;
  }

  isHalted(): boolean {
    return true;
  }
}

const FORWARDING_OFF: ProcessorConfig = { ...defaultConfig(), forwarding: false };
const FORWARDING_ON: ProcessorConfig = { ...defaultConfig(), forwarding: true };

/** Correct with forwarding OFF, broken with forwarding ON. */
const makeStub = (): Processor => new ReferenceBackedStub(true);

describe('the conformance config matrix is not vacuous', () => {
  it('passes a stub that is correct under forwarding off', () => {
    expect(() => checkProgram(makeStub, FORWARDING_OFF, PROGRAM)).not.toThrow();
  });

  it('fails the same stub under forwarding on, where it is deliberately broken', () => {
    let thrown: unknown;
    try {
      checkProgram(makeStub, FORWARDING_ON, PROGRAM);
    } catch (error) {
      thrown = error;
    }

    // An assertion failure specifically — not a missing fixture or a stub crash, which would
    // satisfy a bare `.toThrow()` while proving nothing about the config reaching the model.
    expect(thrown, 'the broken config must fail the check').toBeDefined();
    expect((thrown as Error).name).toBe('AssertionError');
  });

  it('is the position the pre-matrix harness ran, so the broken stub would have gone green', () => {
    // Pins the claim in this file's header rather than narrating it: the single config the old
    // harness hardcoded is exactly the one the stub is correct in.
    expect(defaultConfig().forwarding).toBe(false);
  });
});

/**
 * Claim 3: a multi-config list runs the whole corpus once per config, each case distinctly named.
 *
 * The two stub-driven claims each run under exactly ONE config, so neither can see the matrix's
 * defining behavior. A `runConformance` that iterated `configs` but only ever ran `configs[0]`
 * would pass both of them and pass the two model suites (whose lists are length 1 by default) —
 * and then step 2's `[forwardingOff, forwardingOn]` call would prove the pipeline in one position
 * while reading as if it proved both. Asserting on the case list catches that; it is why the
 * enumeration is pure data rather than a loop inlined into `describe`.
 */
describe('the matrix enumerates the corpus once per config', () => {
  const corpusSize = conformanceCases([FORWARDING_OFF]).length;

  it('has a corpus to enumerate at all', () => {
    expect(corpusSize).toBeGreaterThan(0);
  });

  it('runs every program under every config', () => {
    const cases = conformanceCases([FORWARDING_OFF, FORWARDING_ON]);

    expect(cases).toHaveLength(2 * corpusSize);
    expect(cases.filter((c) => !c.config.forwarding)).toHaveLength(corpusSize);
    expect(cases.filter((c) => c.config.forwarding)).toHaveLength(corpusSize);
  });

  it('names the config in every title, so a failure says which position broke', () => {
    for (const c of conformanceCases([FORWARDING_OFF, FORWARDING_ON])) {
      expect(c.title).toContain(c.config.forwarding ? 'forwarding on' : 'forwarding off');
    }
  });

  it('gives every case a distinct title, so the two positions do not collide in the report', () => {
    const cases = conformanceCases([FORWARDING_OFF, FORWARDING_ON]);
    expect(new Set(cases.map((c) => c.title)).size).toBe(cases.length);
  });

  it('leaves a lone config unlabelled, so a config-blind suite reads as it always did', () => {
    for (const c of conformanceCases([defaultConfig()])) {
      expect(c.title).not.toContain('forwarding');
    }
  });
});

/**
 * Claim 2: `runConformance` hands each config in its list to the model.
 *
 * The tests above exercise `checkProgram` directly, so they would not notice `runConformance`
 * looping over configs while passing `defaultConfig()` to every check — a matrix that runs the
 * corpus N times in the same position. That is precisely the vacuity step 0 exists to remove, and
 * step 2's two-position pipeline suite would pass it silently.
 *
 * This stub is the earlier one **inverted**: correct only with forwarding ON. So this suite is
 * green if and only if `FORWARDING_ON` reached the model. Hardcode `defaultConfig()` back into the
 * loop — i.e. reintroduce the pre-step-0 behavior — and every program here fails.
 */
runConformance(
  'self-test stub, correct only under forwarding on',
  () => new ReferenceBackedStub(false),
  [FORWARDING_ON],
);
