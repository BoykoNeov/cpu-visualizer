import { MultiCycleProcessor } from '@cpu-viz/engine-multi-cycle';
import { CACHE_LARGE, CACHE_SMALL, PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { SingleCycleProcessor } from '@cpu-viz/engine-single-cycle';
import {
  defaultConfig,
  type CycleTrace,
  type Processor,
  type ProcessorConfig,
} from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_PROGRAMS } from './programs';
import { predictsTaken, type BranchPrediction } from './session';
import { loadSource } from './simulator';

/**
 * The web shell's only non-React logic: assemble → load → drive. The transport itself is
 * exhaustively tested in `trace`; here we only pin the wiring — a real corpus program
 * assembles, runs to a halt through the recorder, and lands on its hand-known headline
 * result (`sum-loop` computes 10+9+…+1 = 55 into a0/x10). This is also a smoke test that
 * the corpus glob actually resolves the `.s` files at build time.
 */
describe('loadSource', () => {
  it('assembles and runs a corpus program to its known result', () => {
    const sumLoop = EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop');
    expect(sumLoop, 'sum-loop.s should be in the corpus glob').toBeDefined();

    const result = loadSource(sumLoop!.source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { recorder } = result.loaded;
    expect(recorder.cursor).toBe(-1); // pre-run: loaded, nothing executed
    recorder.runToEnd();

    const a0 = recorder.currentState().registers[10];
    expect(a0).toBe(55);
  });

  it('reports located errors instead of throwing on bad source', () => {
    const result = loadSource('addi x1, x0'); // missing operand
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatchObject({
      line: expect.any(Number),
      column: expect.any(Number),
      message: expect.any(String),
    });
  });

  it('discovers the whole differential corpus (no vacuous glob)', () => {
    const names = EXAMPLE_PROGRAMS.map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining(['add', 'array-sum', 'byte-loads', 'call-return', 'sum-loop']),
    );
  });
});

/**
 * The web model picker (M2 step 5a) swaps the engine by handing `loadSource` a different
 * factory — the recorder is model-agnostic (INV-3), so that one substitution is the whole
 * mechanism. This proves the substitution is NON-VACUOUS: the two models genuinely drive the
 * same program differently (multi-cycle spends several cycles per instruction, so it records
 * strictly more of them) yet land on the SAME architectural result (INV-8). If the factory were
 * ignored — or both branches secretly ran single-cycle — the cycle counts would match and this
 * would fail.
 */
describe('loadSource model swap (INV-3 / INV-8)', () => {
  const sumLoop = () => {
    const p = EXAMPLE_PROGRAMS.find((x) => x.name === 'sum-loop')!;
    return p.source;
  };

  const runWith = (make: () => Processor) => {
    const result = loadSource(sumLoop(), make);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable: sum-loop should assemble');
    const { recorder } = result.loaded;
    recorder.runToEnd();
    return recorder;
  };

  it('multi-cycle records strictly more cycles than single-cycle for the same program', () => {
    const single = runWith(() => new SingleCycleProcessor());
    const multi = runWith(() => new MultiCycleProcessor());
    expect(multi.recordedCycles).toBeGreaterThan(single.recordedCycles);
  });

  it('but both reach the identical final architectural result (a0 = 55)', () => {
    const single = runWith(() => new SingleCycleProcessor());
    const multi = runWith(() => new MultiCycleProcessor());
    expect(single.currentState().registers[10]).toBe(55);
    expect(multi.currentState().registers[10]).toBe(55);
    expect([...multi.currentState().registers]).toEqual([...single.currentState().registers]);
  });

  it('defaults to single-cycle when no factory is passed (existing one-arg callers unchanged)', () => {
    const result = loadSource(sumLoop());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const single = runWith(() => new SingleCycleProcessor());
    result.loaded.recorder.runToEnd();
    expect(result.loaded.recorder.recordedCycles).toBe(single.recordedCycles);
  });
});

/**
 * The forwarding toggle (M3 step 5) — the spec's flagship interaction (§12), now on the LIVE
 * timeline the browser scrubs rather than only in the engine's own timing suite (step 3).
 *
 * The pipeline is the first model whose TRACE depends on its CONFIG, so this is also the first
 * test of the config seam itself: `loadSource` grew a `config` parameter that reaches
 * `recorder.load`. If that parameter were dropped on the floor, both positions would silently run
 * the recorder's neutral default (`forwarding: false`) — identical recordings, and a toggle that
 * moved nothing while looking like it worked. The cycle-count assertion is what makes that
 * impossible to ship.
 *
 * The ABSOLUTE cycle counts belong to the engine's `timing.test.ts`, which derives them in closed
 * form (`cycles = N + 4 + S + 2·T`); duplicating the numbers here would be a second source of
 * truth that drifts. What this suite owns is the RELATIONSHIP — strictly fewer cycles, identical
 * final state — through the web's own load path.
 */
describe('loadSource forwarding config — the crown jewel on the live timeline (M3 step 5)', () => {
  const config = (forwarding: boolean): ProcessorConfig => ({ ...defaultConfig(), forwarding });

  /** The most instructions ever in flight in one cycle of a completed run. */
  const maxInFlight = (source: string, make: () => Processor, forwarding: boolean): number => {
    const result = loadSource(source, make, config(forwarding));
    if (!result.ok) throw new Error('unreachable: a corpus program should assemble');
    result.loaded.recorder.runToEnd();
    return Math.max(...result.loaded.recorder.recorded.map((c) => c.instructions.length));
  };

  /** Record a corpus program to a halt on the pipeline under a chosen forwarding position. */
  const runPipeline = (name: string, forwarding: boolean) => {
    const program = EXAMPLE_PROGRAMS.find((p) => p.name === name)!;
    const result = loadSource(program.source, () => new PipelineProcessor(), config(forwarding));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`unreachable: ${name} should assemble`);
    result.loaded.recorder.runToEnd();
    return result.loaded.recorder;
  };

  it('the same program records strictly FEWER cycles with forwarding on', () => {
    const off = runPipeline('sum-loop', false);
    const on = runPipeline('sum-loop', true);
    expect(on.recordedCycles).toBeLessThan(off.recordedCycles);
  });

  it('...and lands on the IDENTICAL final architectural state (INV-8)', () => {
    const off = runPipeline('sum-loop', false).currentState();
    const on = runPipeline('sum-loop', true).currentState();

    expect(on.registers[10]).toBe(55); // the program's headline result, either way
    expect([...on.registers]).toEqual([...off.registers]);
    expect(on.pc).toBe(off.pc);
    expect(on.halted).toBe(off.halted);
    // Memory too: the toggle must not disturb a single byte the program committed.
    expect(on.memory.definedAddresses()).toEqual(off.memory.definedAddresses());
    for (const addr of off.memory.definedAddresses()) {
      expect(on.memory.readWord(addr)).toBe(off.memory.readWord(addr));
    }
  });

  it('omitting the config is the neutral default — the same as forwarding off', () => {
    // Pins the default parameter as a real equivalence, not a hopeful comment: every pre-step-5
    // caller (and the `_snap` harness) passes no config and must keep the behaviour it had when
    // `recorder.load` defaulted it internally.
    const program = EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop')!;
    const implicit = loadSource(program.source, () => new PipelineProcessor());
    expect(implicit.ok).toBe(true);
    if (!implicit.ok) return;
    implicit.loaded.recorder.runToEnd();

    expect(implicit.loaded.recorder.recordedCycles).toBe(
      runPipeline('sum-loop', false).recordedCycles,
    );
  });

  /**
   * What the shell shows for a five-in-flight cycle, pinned because App LEANS on it: the transport
   * chip and the source-panel highlight both read `instructions[0]`, which the trace contract
   * orders oldest-first. On single-cycle and multi-cycle that is the only instruction in flight; on
   * the pipeline it is the one retiring in WB, with up to four younger ones behind it.
   *
   * This is lawful simplification, not a contradiction (INV-5) — the highlighted line IS in flight,
   * it just isn't the whole story, and showing all five is the step-7 map's job. But "the shell
   * happens to show the oldest" is a real user-visible choice, so it is pinned rather than left to
   * be rediscovered by whoever wonders why the highlight lags the fetch by four lines.
   */
  it('shows the RETIRING instruction when five are in flight (App reads instructions[0])', () => {
    const recorder = runPipeline('sum-loop', true);
    const fiveInFlight = recorder.recorded.find((c) => c.instructions.length === 5);
    expect(fiveInFlight, 'the pipeline should reach five in flight on sum-loop').toBeDefined();

    const shown = fiveInFlight!.instructions[0]!;
    // Oldest-first: what App shows is the WB occupant, and every other in-flight instruction is
    // strictly younger (a later fetch ⇒ a strictly greater sequence in the recorded order).
    expect(shown.location).toBe('WB');
    expect(fiveInFlight!.instructions.map((i) => i.location)).toEqual([
      'WB',
      'MEM',
      'EX',
      'ID',
      'IF',
    ]);
    // ...and it names a real source line, so the highlight lands somewhere honest.
    expect(shown.sourceLine).not.toBeNull();
  });

  /**
   * The premise the transport's in-flight qualifier rests on. App appends "in WB · 5 in flight"
   * exactly when `instructions.length > 1` — a rule with no model knowledge in it, derived purely
   * from the trace (INV-3). That rule is only HONEST if the count really does separate the models
   * the way the rule assumes: the qualifier must never appear for a one-at-a-time model (there is
   * nothing to qualify) and must appear for the pipeline (where the shown instruction is one of
   * five). Both halves are pinned here, because the rule silently degrades if either fails — a
   * qualifier on single-cycle would be noise, and its absence on the pipeline would leave the
   * shell showing one instruction while the header promises five.
   */
  it('the in-flight count separates the models exactly as the transport assumes', () => {
    const program = EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop')!;

    // One at a time, by construction — M1 and M2's defining simplification. Never qualified.
    expect(maxInFlight(program.source, () => new SingleCycleProcessor(), false)).toBe(1);
    expect(maxInFlight(program.source, () => new MultiCycleProcessor(), false)).toBe(1);
    // The pipeline breaks it in BOTH positions, which is the whole point of the tier — and the
    // qualifier must appear regardless of how the user has the toggle set.
    expect(maxInFlight(program.source, () => new PipelineProcessor(), false)).toBeGreaterThan(1);
    expect(maxInFlight(program.source, () => new PipelineProcessor(), true)).toBeGreaterThan(1);
  });

  /**
   * A second observable of the toggle, found by measuring rather than assuming (the first draft of
   * the test above asserted a flat "the pipeline reaches five" and was wrong): forwarding does not
   * only make the pipe FASTER, it is what FILLS it. A bubble is a `null` latch and deliberately
   * never appears in `instructions[]`, so an interlocked pipe carries strictly fewer LIVE
   * instructions — `sum-loop` never gets past four of the five stages holding real work with
   * forwarding off, and reaches all five with it on. It is visible in the transport chip's count.
   *
   * Scoped to `sum-loop`, NOT claimed of the corpus — the same discipline step 3 applied to the
   * crown jewel, and for the same reason: `array-sum` and `call-return` reach five in BOTH
   * positions, so a blanket claim would be false about programs we ship.
   */
  it('forwarding also FILLS the pipe: sum-loop carries 4 live instructions off, 5 on', () => {
    const sumLoop = EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop')!.source;
    expect(maxInFlight(sumLoop, () => new PipelineProcessor(), false)).toBe(4);
    expect(maxInFlight(sumLoop, () => new PipelineProcessor(), true)).toBe(5);
  });

  /**
   * The other reason a stage can sit empty, and why the test above pins a PROGRAM rather than a
   * constant: `add.s` holds only three instructions, so it can never fill five stages no matter how
   * the toggle is set. Program-bound, not stall-bound — two different causes for the same symptom,
   * separated here so neither is mistaken for the other.
   */
  it('...but a 3-instruction program can never fill five stages, in either position', () => {
    const add = EXAMPLE_PROGRAMS.find((p) => p.name === 'add')!.source;
    expect(maxInFlight(add, () => new PipelineProcessor(), false)).toBe(3);
    expect(maxInFlight(add, () => new PipelineProcessor(), true)).toBe(3);
  });

  it('is inert for a model that does not honor it (single-cycle ignores the toggle)', () => {
    // Why the shell can hold `forwarding` as one session-level value and pass it to EVERY model
    // rather than tracking it per-model: a config-blind engine is unmoved by it. This is also what
    // makes gating the CONTROL on `capabilities.configurableForwarding` a pure view concern —
    // the engine needs no defending.
    const program = EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop')!;
    const cycles = (forwarding: boolean): number => {
      const result = loadSource(
        program.source,
        () => new SingleCycleProcessor(),
        config(forwarding),
      );
      if (!result.ok) throw new Error('unreachable: sum-loop should assemble');
      result.loaded.recorder.runToEnd();
      return result.loaded.recorder.recordedCycles;
    };
    expect(cycles(true)).toBe(cycles(false));
  });
});

/**
 * The claim the prediction control's SHAPE rests on (M4 step 4). The config type offers three
 * scheme names; the shell renders a two-position control, so it owes an account of the third.
 *
 * That account is `'none'` and `'static-not-taken'` are the same machine — M4 step 1's finding,
 * pinned in the engine's own suite. What is pinned HERE is the consequence the view depends on and
 * the engine has no opinion about: **two positions are COMPLETE.** Every scheme the union can hold
 * records as one of the two the control can reach, so nothing is hidden by omitting `'none'` from
 * the UI — there is no third machine to hide (INV-5: a view may omit detail, never contradict).
 *
 * The reverse claim is the one that makes it worth testing: a three-position control would assert
 * three machines exist, which is false, and would break the rule the forwarding toggle already
 * lives by — *a control that cannot move anything is worse than no control.*
 */
describe('the prediction control has two positions because the machine has two behaviors', () => {
  /**
   * Every scheme name in the union, mapped to the control position that claims it. A
   * `Record` over the union rather than an array, so a scheme added to `ProcessorConfig` (a
   * dynamic 2-bit predictor is the named candidate — M4 defers it) is a COMPILE error right here
   * and must be classified deliberately. An array would typecheck while leaving the newcomer
   * unswept, which is the M3 step-0 vacuity shape: a case list that cannot reach the collision.
   */
  const SCHEME_POSITION: Record<BranchPrediction, 'taken' | 'not taken'> = {
    none: 'not taken',
    'static-not-taken': 'not taken',
    'static-taken': 'taken',
  };

  /** `sum-loop` on the pipeline under one scheme — the whole recording, not its length. */
  const record = (scheme: BranchPrediction): readonly CycleTrace[] => {
    const program = EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop')!;
    const result = loadSource(program.source, () => new PipelineProcessor(), {
      ...defaultConfig(),
      branchPrediction: scheme,
    });
    if (!result.ok) throw new Error('unreachable: sum-loop should assemble');
    result.loaded.recorder.runToEnd();
    return result.loaded.recorder.recorded;
  };

  it('every scheme the config can hold records as one of the two reachable positions', () => {
    const taken = record('static-taken');
    const notTaken = record('static-not-taken');

    // Non-vacuity FIRST: the two positions are genuinely different machines. Without this the
    // whole test passes trivially on an engine that ignores the knob — which is exactly the
    // blind spot M4 step 3 measured (a pipeline ignoring `branchPrediction` leaves conformance
    // 32/32 green), reappearing in the view's own suite.
    expect(taken).not.toEqual(notTaken);

    // ...and every name in the union IS one of them. Whole traces, never cycle counts: two
    // machines agreeing on timing could still differ in events (M4 step 1's rule, and it is why
    // `'none' ≡ 'static-not-taken'` was pinned by `toEqual` rather than by a number).
    for (const scheme of Object.keys(SCHEME_POSITION) as BranchPrediction[]) {
      expect(record(scheme), `${scheme} should record as its control position`).toEqual(
        predictsTaken(scheme) ? taken : notTaken,
      );
    }
  });

  it('is inert for a model that does not honor it (single-cycle ignores the scheme)', () => {
    // The same argument the forwarding toggle rests on, and the reason prediction could ride M3's
    // config seam without widening it: the scheme is held at SESSION level and handed to every
    // model, so it survives a trip through single-cycle and is still set when the user comes back.
    // A config-blind engine is simply unmoved by it, so gating the CONTROL on
    // `capabilities.configurableBranchPrediction` is a pure view concern — the engine needs no
    // defending.
    const program = EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop')!;
    const cycles = (scheme: BranchPrediction): number => {
      const result = loadSource(program.source, () => new SingleCycleProcessor(), {
        ...defaultConfig(),
        branchPrediction: scheme,
      });
      if (!result.ok) throw new Error('unreachable: sum-loop should assemble');
      result.loaded.recorder.runToEnd();
      return result.loaded.recorder.recordedCycles;
    };
    expect(cycles('static-taken')).toBe(cycles('static-not-taken'));
  });

  /**
   * The step-3 pinned figures, reachable through the SHELL's own load path rather than the
   * engine's — the headless half of this step's acceptance ("cycle counts that move on the live
   * scrub bar and match step 3's pinned figures"). `recordedCycles` is literally what the scrub
   * bar's upper bound is read from, so this is the number the user will see.
   *
   * Both directions, because **no scheme dominates** and that is the milestone's thesis rather
   * than a caveat: `sum-loop` is a backward branch taken 9 times of 10 and gets FASTER; while
   * `call-return`'s `bge` is never taken, so betting on it makes the program **slower**. A
   * milestone that only measured the program its toggle helps would be repeating the rhetoric M3
   * step 3 had to correct. Asserted as signed per-program deltas, never an average — the average
   * is exactly the claim that would let the loss hide.
   */
  it('the scrub bar’s own numbers move, and NOT all in the same direction', () => {
    const cyclesOf = (name: string, scheme: BranchPrediction): number => {
      const program = EXAMPLE_PROGRAMS.find((p) => p.name === name)!;
      const result = loadSource(program.source, () => new PipelineProcessor(), {
        ...defaultConfig(),
        branchPrediction: scheme,
      });
      if (!result.ok) throw new Error(`unreachable: ${name} should assemble`);
      result.loaded.recorder.runToEnd();
      return result.loaded.recorder.recordedCycles;
    };

    // The crowd-pleaser: 9 taken backward branches, each paying 2 instead of 1.
    expect(cyclesOf('sum-loop', 'static-not-taken')).toBe(78);
    expect(cyclesOf('sum-loop', 'static-taken')).toBe(71);

    // The proof. `call-return` holds one transfer of each kind, which makes it the corpus's whole
    // argument in one program: `jal` improves (2→1), the never-taken `bge` regresses (0→2), and
    // `ret` (a `jalr`) cannot be predicted by anyone and stays at 2. Net: +1, and a user can see it.
    expect(cyclesOf('call-return', 'static-not-taken')).toBe(17);
    expect(cyclesOf('call-return', 'static-taken')).toBe(18);
  });
});

/**
 * The cache toggle (M6 step 5) — the milestone's flagship interaction on the LIVE timeline the
 * browser scrubs, the third knob to ride M3's config seam. This is the headless half of the step's
 * acceptance ("the same program's cycle count changes on the live scrub bar when the size flips");
 * the small↔large flip being visible on screen is the browser eyeball's job, since it is the only
 * net that sees a config the engine ignores.
 *
 * The seam test is the same one forwarding and prediction already made: `loadSource`'s `config`
 * reaches `recorder.load`, so if the `cache` field were dropped on the floor every position would
 * silently run the neutral `cache: null` — identical recordings, a toggle that moves nothing while
 * looking like it works. `recordedCycles` is literally the scrub bar's upper bound, so pinning it is
 * pinning the number the user sees.
 *
 * The ABSOLUTE figures belong to the engine's `timing.test.ts`, which derives them in closed form
 * (`cycles = N + 4 + S + P + M`, `M = misses × missPenalty`) — but this step's acceptance names the
 * scrub bar specifically, so, exactly like the prediction figures above, they are pinned here as
 * "what the user reads off the bar" through the shell's own load path, cross-referenced to step 4
 * rather than re-derived. Forwarding OFF throughout, matching step 4's `array-sum-twice.s` row.
 */
describe('loadSource cache config — the size flip on the live scrub bar (M6 step 5)', () => {
  const config = (cache: typeof CACHE_SMALL | null): ProcessorConfig => ({
    ...defaultConfig(),
    cache,
  });

  const cyclesOf = (name: string, cache: typeof CACHE_SMALL | null): number => {
    const program = EXAMPLE_PROGRAMS.find((p) => p.name === name)!;
    const result = loadSource(program.source, () => new PipelineProcessor(), config(cache));
    if (!result.ok) throw new Error(`unreachable: ${name} should assemble`);
    result.loaded.recorder.runToEnd();
    return result.loaded.recorder.recordedCycles;
  };

  const stateOf = (name: string, cache: typeof CACHE_SMALL | null) => {
    const program = EXAMPLE_PROGRAMS.find((p) => p.name === name)!;
    const result = loadSource(program.source, () => new PipelineProcessor(), config(cache));
    if (!result.ok) throw new Error(`unreachable: ${name} should assemble`);
    result.loaded.recorder.runToEnd();
    return result.loaded.recorder.currentState();
  };

  it('the SAME program runs a different cycle count under two cache sizes — the straddler', () => {
    // `array-sum-twice.s`, the size-straddler: 12 words × 2 passes, working set spanning 3 lines.
    // Off pays no penalty (290). Small (2 lines) overflows and re-misses the repeat pass — 5 misses
    // × 10 = 50 more (340). Large (4 lines) fits and the repeat pass all-hits — 3 misses × 10 = 30
    // more (320). The 20-cycle gap between small and large IS the flip, pinned as a signed delta in
    // step 4's `timing.test.ts`; here it is the number the scrub bar shows.
    expect(cyclesOf('array-sum-twice', null)).toBe(290);
    expect(cyclesOf('array-sum-twice', CACHE_SMALL)).toBe(340);
    expect(cyclesOf('array-sum-twice', CACHE_LARGE)).toBe(320);
    // The flagship, as the relationship the acceptance names: flipping the size alone, on one
    // unchanged source, moves the scrub bar — and the smaller cache is the slower machine.
    expect(cyclesOf('array-sum-twice', CACHE_SMALL)).toBeGreaterThan(
      cyclesOf('array-sum-twice', CACHE_LARGE),
    );
  });

  it('...but NOT every program — a single-pass walk buys nothing from a bigger cache', () => {
    // `array-sum.s` is the same block structure minus the repeat, so every block is compulsory-
    // missed exactly once at ANY size: 2 misses small AND large. The flip is a claim about REUSE,
    // not a law — a program with none shows the size control moving the count NOWHERE. This is what
    // keeps the toggle honest: "bigger is better" is false here, and the shell must be able to say so.
    expect(cyclesOf('array-sum', CACHE_SMALL)).toBe(cyclesOf('array-sum', CACHE_LARGE));
    // ...and turning the cache ON at all still costs those 2 compulsory misses vs. off.
    expect(cyclesOf('array-sum', CACHE_SMALL)).toBeGreaterThan(cyclesOf('array-sum', null));
  });

  it('lands on the IDENTICAL final architectural state under every cache (INV-8 by construction)', () => {
    // The timing shadow holds no values, so the cache cannot move a register or a byte — off, small,
    // and large must agree on the whole result. `array-sum-twice` sums 2·(1+…+12) = 156 into a0.
    const off = stateOf('array-sum-twice', null);
    const small = stateOf('array-sum-twice', CACHE_SMALL);
    const large = stateOf('array-sum-twice', CACHE_LARGE);
    expect(off.registers[10]).toBe(156);
    expect([...small.registers]).toEqual([...off.registers]);
    expect([...large.registers]).toEqual([...off.registers]);
    expect(small.memory.definedAddresses()).toEqual(off.memory.definedAddresses());
    for (const addr of off.memory.definedAddresses()) {
      expect(small.memory.readWord(addr)).toBe(off.memory.readWord(addr));
      expect(large.memory.readWord(addr)).toBe(off.memory.readWord(addr));
    }
  });

  it('is inert for a model that does not honor it (single-cycle ignores the cache)', () => {
    // The same argument forwarding and prediction rest on, and the reason the cache could ride the
    // seam without widening it: it is held at SESSION level and handed to every model, so a config-
    // blind engine is simply unmoved by it. That is what makes gating the CONTROL on
    // `capabilities.configurableCache` a pure view concern — the engine needs no defending.
    const program = EXAMPLE_PROGRAMS.find((p) => p.name === 'array-sum-twice')!;
    const cyclesSingleCycle = (cache: typeof CACHE_SMALL | null): number => {
      const result = loadSource(program.source, () => new SingleCycleProcessor(), config(cache));
      if (!result.ok) throw new Error('unreachable: array-sum-twice should assemble');
      result.loaded.recorder.runToEnd();
      return result.loaded.recorder.recordedCycles;
    };
    expect(cyclesSingleCycle(CACHE_SMALL)).toBe(cyclesSingleCycle(null));
    expect(cyclesSingleCycle(CACHE_LARGE)).toBe(cyclesSingleCycle(null));
  });
});
