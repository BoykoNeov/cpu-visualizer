import { MultiCycleProcessor } from '@cpu-viz/engine-multi-cycle';
import { SingleCycleProcessor } from '@cpu-viz/engine-single-cycle';
import type { Processor } from '@cpu-viz/trace';
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
