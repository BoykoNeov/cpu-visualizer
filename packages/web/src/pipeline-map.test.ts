/**
 * The pipeline map's pure fold (M3 step 7) — the acceptance for the grid itself: that it is derived
 * purely from the trace (INV-3), that a STALL repeats a cell and a FLUSH cuts a row, and that it is
 * stage-and-lane-parametric from day one.
 *
 * Two halves, and the split is the point:
 *
 *   - **Against the real engine** — every walk below was hand-derived from the pinned rules BEFORE
 *     it was run, exactly as step 3's timing table was. A cell sequence copied off a failing run is
 *     not a pin, it is a snapshot of a bug.
 *   - **Against hand-built traces** — the parametricity half. No engine we ship emits a lane
 *     (`"EX.0"`) or a deep stage set (`"IF1"`), so nothing in the corpus can exercise the two axes
 *     the map is required to absorb without an API change. A synthetic trace is the only thing that
 *     can, and it is also the sharpest available proof of "derived purely from the trace": these
 *     cases construct no engine, no recorder, and no program at all — just trace literals.
 */

import { decode } from '@cpu-viz/isa';
import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import {
  defaultConfig,
  makeRegisters,
  SparseMemory,
  type CycleTrace,
  type InstructionInstance,
  type MachineState,
  type TraceEvent,
} from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import { buildPipelineMap, firstRowAt, hasOverlap, stageFamily } from './pipeline-map';
import { loadSource } from './simulator';

/** Record `source` to completion on the pipeline under a chosen forwarding position, and hand back
 *  the whole recording — the map's actual input. */
function record(source: string, forwarding: boolean): readonly CycleTrace[] {
  const result = loadSource(`${source}\n  li a7, 10\n  ecall\n`, () => new PipelineProcessor(), {
    ...defaultConfig(),
    forwarding,
  });
  if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
  const { recorder } = result.loaded;
  recorder.runToEnd();
  return recorder.recorded;
}

/** The cell sequence of the row for the instruction at `pc` — the row's WALK, which is what every
 *  derivation below is stated as. Loops re-fetch a pc under a fresh id (INV-4), so this takes the
 *  first row at that pc; the programs here are straight-line, so there is exactly one. */
function walkAt(recorded: readonly CycleTrace[], pc: number): string[] {
  const row = buildPipelineMap(recorded).rows.find((r) => r.pc === pc);
  if (!row) throw new Error(`no row at pc ${pc}`);
  return row.cells.map((c) => c.location);
}

describe('stageFamily — the hue key', () => {
  // At five stages family IS stage, which is why this changes nothing about M3 and is still the
  // seam that keeps a later model from rewriting the map.
  it('is the identity on a plain stage name', () => {
    for (const s of ['IF', 'ID', 'EX', 'MEM', 'WB']) expect(stageFamily(s)).toBe(s);
  });

  it('collapses a lane slot — the superscalar axis', () => {
    expect(stageFamily('EX.0')).toBe('EX');
    expect(stageFamily('EX.1')).toBe('EX');
    expect(stageFamily('IF.11')).toBe('IF');
  });

  it('collapses a depth index — the deeper-pipeline axis', () => {
    expect(stageFamily('IF1')).toBe('IF');
    expect(stageFamily('IF2')).toBe('IF');
    expect(stageFamily('EX12')).toBe('EX');
  });

  it('collapses both at once', () => {
    expect(stageFamily('EX2.1')).toBe('EX');
  });

  // A family this plan never designed a hue for renders neutral rather than guessed at. Pinning it
  // so the fallback is a decision and not an accident.
  it('leaves an unknown location recognizable rather than mangling it to nothing', () => {
    expect(stageFamily('single-cycle')).toBe('single-cycle');
    expect(stageFamily('42')).toBe('42');
  });
});

describe('the grid, against the real engine', () => {
  // Derived from the pinned rules before running: three independent addis, no hazards. Each is
  // fetched one cycle after the last and walks all five stages (EVERY instruction traverses all
  // five — a `lui` idles through MEM rather than skipping it, which is what makes the latch chain
  // a chain). So the rows are a clean staircase, one cycle apart.
  it('is a staircase of five-stage walks when nothing interacts', () => {
    const recorded = record(' addi x1, x0, 1\n addi x2, x0, 2\n addi x3, x0, 3', true);
    const map = buildPipelineMap(recorded);

    expect(walkAt(recorded, 0)).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);
    expect(walkAt(recorded, 4)).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);
    expect(walkAt(recorded, 8)).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);

    // The staircase: each row starts exactly one cycle after the one above it. This — not the
    // walks — is "instructions overlap in time", and it is the whole reason the surface exists.
    const starts = map.rows.map((r) => r.cells[0]!.cycle);
    expect(starts.slice(0, 3)).toEqual([0, 1, 2]);
  });

  // Rows are program order = FETCH order, derived from `instructions[]` (pinned oldest-first)
  // rather than from any sort. Asserted on pc, which is the only thing that makes it checkable.
  it('orders rows by program order', () => {
    const recorded = record(' addi x1, x0, 1\n addi x2, x0, 2\n addi x3, x0, 3', true);
    const pcs = buildPipelineMap(recorded).rows.map((r) => r.pc);
    expect(pcs.slice(0, 3)).toEqual([0, 4, 8]);
    // Ascending overall: the tail is `li a7, 10` (two words — `li` is a pseudo-op) then `ecall`.
    expect(pcs).toEqual([...pcs].sort((a, b) => a - b));
  });

  /**
   * THE STALL, hand-derived. `lw x1` then `add x2, x1, x1` is the textbook load-use pair — the one
   * bubble that survives forwarding, because the loaded value is not ready until MEM.
   *
   *   c0 lw:IF
   *   c1 lw:ID   add:IF
   *   c2 lw:EX   add:ID   <- load in EX, add needs x1: INTERLOCK. add holds in ID; IF holds too.
   *   c3 lw:MEM  add:ID   <- the repeated cell. lw has left EX, so the hazard is gone...
   *   c4 lw:WB   add:EX   <- ...and add proceeds, taking x1 by forward from MEM/WB.
   *
   * So `add`'s walk carries ID TWICE. That repeated cell IS the stall's representation — the map
   * needs no bubble concept, because a bubble is a null latch and never appears in
   * `instructions[]` at all (pinned). One extra ID = one stall cycle, as the load-use rule says.
   */
  it('repeats a cell for a stall — the load-use bubble that survives forwarding', () => {
    const recorded = record(' lw x1, 64(x0)\n add x2, x1, x1', true);
    expect(walkAt(recorded, 4)).toEqual(['IF', 'ID', 'ID', 'EX', 'MEM', 'WB']);
  });

  // Non-vacuity for the claim above, and it is load-bearing rather than decoration: without it, a
  // map that repeated EVERY cell would satisfy the stall test. Same shape, same consumer, no load
  // — so the ONLY difference is the hazard, and the repeat disappears.
  it('does NOT repeat a cell when there is no stall to show', () => {
    const recorded = record(' addi x1, x0, 1\n add x2, x1, x1', true);
    expect(walkAt(recorded, 4)).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);
  });

  /**
   * The OTHER half of a stall, and the walk step 4 found was pinned nowhere: the instruction stuck
   * BEHIND the interlock is HELD in IF (`IF IF`) under ONE id — not left un-fetched, and not
   * re-fetched (re-fetching would mint a second id for one instruction, a direct INV-4 breach).
   * The map is where that decision becomes visible, so it is asserted here on the map's own terms.
   */
  it('repeats the IF cell of the instruction held behind an interlock', () => {
    const recorded = record(' lw x1, 64(x0)\n add x2, x1, x1\n addi x3, x0, 3', true);
    expect(walkAt(recorded, 8).slice(0, 2)).toEqual(['IF', 'IF']);
  });

  // With forwarding OFF the same RAW pair interlocks for TWO cycles (the producer must reach WB;
  // the same-cycle WB→ID rule pays for the third). The map shows the deeper bubble as a longer
  // run of repeated cells — the toggle's effect, visible as a SHAPE rather than a cycle count.
  it('shows a deeper bubble with forwarding off — the flagship toggle, as a shape', () => {
    const on = record(' addi x1, x0, 1\n add x2, x1, x1', true);
    const off = record(' addi x1, x0, 1\n add x2, x1, x1', false);
    expect(walkAt(on, 4)).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);
    expect(walkAt(off, 4)).toEqual(['IF', 'ID', 'ID', 'ID', 'EX', 'MEM', 'WB']);
  });

  /**
   * THE FLUSH, hand-derived — and the map half of the milestone's acceptance criterion ("a taken
   * branch emits `branch-resolved` + `flush`, kills exactly two younger instructions, and the map
   * shows the cut rows").
   *
   *   c0 addi:IF
   *   c1 addi:ID  beq:IF
   *   c2 addi:EX  beq:ID   x9:IF
   *   c3 addi:MEM beq:EX   x9:ID   x8:IF   <- beq resolves TAKEN. At the clock edge the flush
   *                                           kills the two younger: x9 (ID) and x8 (IF).
   *
   * Predict-not-taken genuinely DID fetch both, so both have real rows — they are simply cut where
   * they died. The two doomed instructions are deliberately given their own pcs (not the branch
   * target), so the rows cannot be confused with the target's own re-fetch.
   */
  it('cuts the rows of a taken branch’s two casualties', () => {
    const recorded = record(
      ' addi x1, x0, 1\n beq x0, x0, tgt\n addi x9, x0, 9\n addi x8, x0, 8\ntgt:\n addi x2, x0, 2',
      true,
    );
    const map = buildPipelineMap(recorded);
    const killed = map.rows.filter((r) => r.killedBy === 'branch-taken');

    // Exactly two younger instructions die — the acceptance criterion, on the map.
    expect(killed.map((r) => r.pc)).toEqual([8, 12]);
    // And their rows are CUT: neither reaches WB, neither retires. `addi x9` got one stage further
    // than `addi x8` because it was fetched one cycle earlier — the staircase, cut on the diagonal.
    expect(killed.map((r) => r.cells.map((c) => c.location))).toEqual([['IF', 'ID'], ['IF']]);
    expect(killed.every((r) => !r.retired)).toBe(true);

    // Non-vacuity: the survivors around them are untouched and run to completion. A fold that
    // marked everything killed would pass the assertions above.
    const survivor = map.rows.find((r) => r.pc === 0)!;
    expect(survivor.killedBy).toBeNull();
    expect(survivor.retired).toBe(true);
    expect(survivor.cells).toHaveLength(5);
  });

  // A loop's body is fetched afresh each iteration, and each fetch mints a new id (INV-4) — so the
  // map shows the DYNAMIC run, not the static listing. This is what makes the rows "instructions"
  // rather than "lines", and it is why the row key is the id and never the pc.
  it('gives each iteration of a loop its own row', () => {
    const recorded = record(' addi x1, x0, 3\nloop:\n addi x1, x1, -1\n bnez x1, loop', true);
    const map = buildPipelineMap(recorded);
    const bodyRows = map.rows.filter((r) => r.pc === 4);
    expect(bodyRows.length).toBe(3); // three iterations, three rows, three ids
    expect(new Set(bodyRows.map((r) => r.id)).size).toBe(3);
  });

  it('is deterministic — same recording, same grid (INV-1/INV-3)', () => {
    const recorded = record(' addi x1, x0, 1\n add x2, x1, x1', true);
    expect(buildPipelineMap(recorded)).toEqual(buildPipelineMap(recorded));
  });

  it('derives the five-stage set and its families from the recording', () => {
    const map = buildPipelineMap(record(' addi x1, x0, 1', true));
    expect(map.stages).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);
    expect(map.families).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']); // at five stages, family IS stage
  });

  it('folds an empty recording without inventing anything', () => {
    const map = buildPipelineMap([]);
    expect(map.rows).toEqual([]);
    expect(map.stages).toEqual([]);
    expect(map.cycles).toBe(0);
    expect(map.maxInFlight).toBe(0);
  });
});

/**
 * The map's GATE, which carries no model knowledge: the map exists to show instructions overlapping
 * in time, so it appears exactly when they do. Single-cycle and multi-cycle never overlap by
 * construction, so it never appears for them — without this module naming either of them.
 */
describe('hasOverlap — the gate', () => {
  it('is true for the pipeline and false for a one-at-a-time model', () => {
    expect(hasOverlap(record(' addi x1, x0, 1\n addi x2, x0, 2', true))).toBe(true);

    const single = loadSource(' addi x1, x0, 1\n addi x2, x0, 2\n li a7, 10\n ecall\n');
    if (!single.ok) throw new Error('assembly failed');
    single.loaded.recorder.runToEnd();
    expect(hasOverlap(single.loaded.recorder.recorded)).toBe(false);
    // ...and the reason it is false is the thing M2 pinned about itself, worth restating here
    // because it is what the gate rests on.
    expect(single.loaded.recorder.recorded.every((t) => t.instructions.length === 1)).toBe(true);
  });

  it('is false for an empty recording', () => {
    expect(hasOverlap([])).toBe(false);
  });
});

// --- The parametricity half: hand-built traces, no engine ------------------------------------

const NOP = decode(0x00000013); // addi x0, x0, 0 — a real decode; the map never reads its fields

function state(): MachineState {
  return { pc: 0, registers: makeRegisters(), memory: new SparseMemory(), halted: false };
}

/** One in-flight instruction at a location. */
function inst(id: string, location: string, pc = 0): InstructionInstance {
  return { id, pc, encoding: 0x00000013, sourceLine: null, decoded: NOP, location };
}

function cycle(
  n: number,
  instructions: InstructionInstance[],
  events: TraceEvent[] = [],
): CycleTrace {
  return { cycle: n, state: state(), events, instructions };
}

/**
 * The two axes M3 pinned `location` to absorb, driven for real. Nothing we ship emits either yet —
 * that is exactly why these are hand-built: a test that could only run against our own engine would
 * prove the map parametric in precisely the cases where it already is.
 */
describe('parametric from day one — no engine, just traces', () => {
  /**
   * SUPERSCALAR: two lanes, so two instructions share a stage in one cycle and stage position stops
   * identifying an instruction. The row×column model absorbs it with no API change — two rows share
   * a column — which is the claim `superscalar-visuals.md` makes and this is the check of it.
   */
  it('absorbs lanes: two rows share a column, and both wear their stage’s family hue', () => {
    const map = buildPipelineMap([
      cycle(0, [inst('a', 'IF.0', 0), inst('b', 'IF.1', 4)]),
      cycle(1, [
        inst('a', 'ID.0', 0),
        inst('b', 'ID.1', 4),
        inst('c', 'IF.0', 8),
        inst('d', 'IF.1', 12),
      ]),
      cycle(2, [
        inst('a', 'EX.0', 0),
        inst('b', 'EX.1', 4),
        inst('c', 'ID.0', 8),
        inst('d', 'ID.1', 12),
      ]),
    ]);

    // Four rows in fetch order, two per column — the dual-issue picture.
    expect(map.rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(map.maxInFlight).toBe(4);

    // The stage SET is six distinct locations...
    expect(map.stages).toEqual(['IF.0', 'IF.1', 'ID.0', 'ID.1', 'EX.0', 'EX.1']);
    // ...but only THREE hues, because the hue is the family. Lanes are told apart by row, not hue —
    // reusing a phase hue for a lane is exactly the encoding collision the palette plan forbids.
    expect(map.families).toEqual(['IF', 'ID', 'EX']);

    // The cell keeps its exact location as TEXT (the relief rule) while hueing by family.
    const a = map.rows[0]!;
    expect(a.cells.map((c) => c.location)).toEqual(['IF.0', 'ID.0', 'EX.0']);
    expect(a.cells.map((c) => c.family)).toEqual(['IF', 'ID', 'EX']);
  });

  /**
   * DEEPER PIPELINE: more stages than the five validated phase hues. The answer is never to invent
   * a hue — it is to color by family and let the cell text carry the exact stage. Seven stages,
   * five families.
   */
  it('absorbs a deeper stage set: seven stages, still five hues', () => {
    const walk = ['IF1', 'IF2', 'ID', 'EX1', 'EX2', 'MEM', 'WB'];
    const map = buildPipelineMap(walk.map((loc, i) => cycle(i, [inst('a', loc)])));

    expect(map.stages).toEqual(walk);
    expect(map.families).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);
    expect(map.rows[0]!.cells.map((c) => c.family)).toEqual([
      'IF',
      'IF',
      'ID',
      'EX',
      'EX',
      'MEM',
      'WB',
    ]);
  });

  /**
   * A flush names STAGES, not ids, so the map resolves victims by cross-referencing
   * `instructions[]` — and with lanes that cross-reference must match the FULL location. Killing
   * `"EX.1"` must not kill lane 0's occupant. This is the one place the lane encoding could
   * silently do the wrong thing, so it gets its own case.
   */
  it('resolves a lane-qualified flush to the right lane’s occupant', () => {
    const map = buildPipelineMap([
      cycle(
        0,
        [inst('lane0', 'EX.0'), inst('lane1', 'EX.1')],
        [{ type: 'flush', reason: 'branch-taken', stages: ['EX.1'] }],
      ),
    ]);
    expect(map.rows.find((r) => r.id === 'lane0')!.killedBy).toBeNull();
    expect(map.rows.find((r) => r.id === 'lane1')!.killedBy).toBe('branch-taken');
  });

  // `schema.ts` pins that a flush which kills nobody emits NO event — but a consumer that trusted a
  // stage name blindly would still be wrong if one ever named an empty stage. The fold must not
  // invent a victim.
  it('ignores a flush naming a stage nobody occupies', () => {
    const map = buildPipelineMap([
      cycle(
        0,
        [inst('a', 'EX')],
        [{ type: 'flush', reason: 'branch-taken', stages: ['ID', 'IF'] }],
      ),
    ]);
    expect(map.rows[0]!.killedBy).toBeNull();
  });

  it('finds the oldest row in flight at a cycle, and none outside the run', () => {
    const map = buildPipelineMap([
      cycle(0, [inst('a', 'IF')]),
      cycle(1, [inst('a', 'ID'), inst('b', 'IF')]),
      cycle(2, [inst('b', 'ID')]),
    ]);
    expect(firstRowAt(map, 0)).toBe(0); // only `a`
    expect(firstRowAt(map, 1)).toBe(0); // `a` and `b` — the oldest is `a`
    expect(firstRowAt(map, 2)).toBe(1); // `a` has retired; `b` is the oldest left
    expect(firstRowAt(map, 9)).toBe(-1);
  });
});
