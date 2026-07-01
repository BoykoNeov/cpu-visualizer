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
