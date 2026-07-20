import { describe, expect, it } from 'vitest';
import type { AssembledProgram } from '@cpu-viz/assembler';
import { run } from '@cpu-viz/engine-reference';
import {
  defaultConfig,
  type CacheConfig,
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
    configurableIssueWidth: false,
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

  /**
   * M4 — the guard above was real but its CASE LIST was stale, and that is the bug this file
   * exists to prevent one level up.
   *
   * Every claim here was parameterized by `[FORWARDING_OFF, FORWARDING_ON]`, a list that varies one
   * knob. So when the pipeline's matrix grew a second axis, the labels collapsed — three prediction
   * schemes all reporting `[forwarding off]` — and *every test in this describe stayed green*,
   * because none of them was ever handed a list that could collide. The distinctness guard could
   * not see the collision it was written to catch.
   *
   * This is exactly the vacuity shape the file's own header warns about ("a matrix that iterated
   * configs but only ever ran configs[0] would pass every one of them"), reappearing in the guard
   * rather than in the thing guarded. So the multi-axis list is now a case in its own right.
   */
  const MULTI_AXIS: ProcessorConfig[] = [false, true].flatMap((forwarding) =>
    (['none', 'static-not-taken', 'static-taken'] as const).map((branchPrediction) => ({
      ...defaultConfig(),
      forwarding,
      branchPrediction,
    })),
  );

  it('keeps every case distinct when the matrix varies TWO knobs, not just one', () => {
    const cases = conformanceCases(MULTI_AXIS);
    expect(cases).toHaveLength(6 * corpusSize);
    // The claim that fails if `configLabel` names only `forwarding`: 6 configs, 6 labels.
    expect(new Set(cases.map((c) => c.title)).size).toBe(cases.length);
  });

  it('names both varying knobs, so a failure says which SCHEME broke and not just which position', () => {
    for (const c of conformanceCases(MULTI_AXIS)) {
      expect(c.title).toContain(c.config.forwarding ? 'forwarding on' : 'forwarding off');
      expect(c.title).toContain(`predict ${c.config.branchPrediction}`);
    }
  });

  /**
   * The other half of "name what varies": a knob CONSTANT across the matrix is not named. A label
   * that never changes distinguishes nothing and would be pure noise — and, concretely, this is
   * what keeps M3's two-position titles byte-identical now that a second axis exists at all.
   */
  it('stays silent about a knob that does not vary, so M3-shaped suites read as they always did', () => {
    for (const c of conformanceCases([FORWARDING_OFF, FORWARDING_ON])) {
      expect(c.title).not.toContain('predict');
      expect(c.title).toContain(c.config.forwarding ? 'forwarding on' : 'forwarding off');
    }
  });

  /**
   * M6 step 3 — the cache axis. `cache` is the first OBJECT-valued knob, so `configLabel` decides
   * "does it vary" with a deep compare (`cacheEquals`) and renders the value as a canonical string
   * (`cacheLabel`) rather than a scalar. Two things need proving that the guards above cannot reach:
   *
   *  1. a cache-on and a cache-off config get DISTINCT labels, so a red cache cell names which
   *     config broke — the whole reason the reserved clause needed a deep compare rather than a
   *     silent skip;
   *  2. a THREE-axis list (forwarding × predict × cache) keeps every title distinct — the same
   *     lesson MULTI_AXIS pins one axis down: a distinctness guard parameterized by a list that
   *     never varies the cache could not see a `cacheLabel` that collapsed distinct caches to one
   *     string. So the case list must vary it, exactly as M4's had to vary prediction.
   *
   * The caches are built inline as plain trace objects, NOT imported from the pipeline's `./cache`:
   * conformance sits BELOW the pipeline in the DAG, so importing its constants would invert it. The
   * geometry mirrors the shipped `CACHE_SMALL` (2 lines) / `CACHE_LARGE` (4 lines) over a 16-byte
   * line — but the harness test only cares that they are DISTINCT configs, not that they are those.
   */
  const CACHE_OFF: CacheConfig | null = null;
  const CACHE_2: CacheConfig = { lineSize: 16, numLines: 2, missPenalty: 10 };
  const CACHE_4: CacheConfig = { lineSize: 16, numLines: 4, missPenalty: 10 };

  const THREE_AXIS: ProcessorConfig[] = [false, true].flatMap((forwarding) =>
    (['none', 'static-not-taken', 'static-taken'] as const).flatMap((branchPrediction) =>
      [CACHE_OFF, CACHE_2, CACHE_4].map((cache) => ({
        ...defaultConfig(),
        forwarding,
        branchPrediction,
        cache,
      })),
    ),
  );

  it('gives a cache-on and a cache-off config distinct labels, so a red cache cell names which broke', () => {
    // Identical corpus, identical forwarding/predict — the cache label is the ONLY thing that can
    // tell these two apart, so a deep compare that missed the difference would collide the titles.
    const cases = conformanceCases([
      { ...defaultConfig(), cache: CACHE_OFF },
      { ...defaultConfig(), cache: CACHE_2 },
    ]);
    expect(cases).toHaveLength(2 * corpusSize);
    expect(new Set(cases.map((c) => c.title)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.title).toContain(c.config.cache === null ? 'cache off' : 'cache 2×16B');
    }
  });

  it('keeps every case distinct when the matrix varies THREE knobs, cache included', () => {
    const cases = conformanceCases(THREE_AXIS);
    // 2 forwarding × 3 predict × 3 cache = 18 configs.
    expect(cases).toHaveLength(18 * corpusSize);
    expect(new Set(cases.map((c) => c.title)).size).toBe(cases.length);
  });

  it('names the varying cache in every title, so a failure says which cache broke', () => {
    for (const c of conformanceCases(THREE_AXIS)) {
      expect(c.title).toContain(
        c.config.cache === null ? 'cache off' : `cache ${c.config.cache.numLines}×`,
      );
    }
  });

  /**
   * The cache's half of "name only what varies", and the load-bearing one: a matrix where every
   * config leaves the cache OFF must not mention it. This is what keeps the single/multi-cycle
   * differential suites and the M3/M4 guards above byte-identical — they all pass `cache: null`, so
   * a stray cache clause here would rename every one of their titles. MULTI_AXIS is all-`null`
   * (it spreads `defaultConfig`), so it is exactly that constant-cache list.
   */
  it('stays silent about the cache when every config leaves it off, so cache-blind suites read unchanged', () => {
    for (const c of conformanceCases(MULTI_AXIS)) {
      expect(c.title).not.toContain('cache');
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
