import { MultiCycleProcessor } from '@cpu-viz/engine-multi-cycle';
import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { SingleCycleProcessor } from '@cpu-viz/engine-single-cycle';
import { defaultConfig, type Processor, type ProcessorConfig } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_PROGRAMS } from './programs';
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
