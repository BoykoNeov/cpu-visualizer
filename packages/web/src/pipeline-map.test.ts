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
import { buildPipelineMap, firstRowAt, hasOverlap, stageFamily, type PipelineMap } from './pipeline-map'; // prettier-ignore
import { EXAMPLE_PROGRAMS } from './programs';
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

/** A corpus program's map under a chosen prediction scheme — M4 step 6's input. Forwarding is left
 *  at its default: the marks are a claim about SPECULATION, and pinning them under one forwarding
 *  position would be step 3's `2·T` trap (specific, in a place that reads as general) if the claim
 *  were forwarding-dependent. `bothSchemes` below proves it is not, by sweeping the cross product. */
function mapOf(name: string, predictTaken: boolean, forwarding = true): PipelineMap {
  const program = EXAMPLE_PROGRAMS.find((p) => p.name === name);
  if (!program) throw new Error(`no corpus program ${name}`);
  const result = loadSource(program.source, () => new PipelineProcessor(), {
    ...defaultConfig(),
    forwarding,
    branchPrediction: predictTaken ? 'static-taken' : 'static-not-taken',
  });
  if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
  result.loaded.recorder.runToEnd();
  return buildPipelineMap(result.loaded.recorder.recorded);
}

/** Every speculative ACTION the map marks, as `mnemonic@cycle:location` — stated as the branch that
 *  took it, which is the whole point of the step: an action belongs to the instruction that took it,
 *  not to its victims. */
function actions(map: PipelineMap): { bets: string[]; wrong: string[] } {
  const bets: string[] = [];
  const wrong: string[] = [];
  for (const row of map.rows) {
    for (const cell of row.cells) {
      const at = `${row.decoded.mnemonic}@${cell.cycle}:${cell.location}`;
      if (cell.bet) bets.push(at);
      if (cell.mispredicted) wrong.push(at);
    }
  }
  return { bets, wrong };
}

/** The rows a flush cut in `cycle` — a victim is in `instructions[]` for the cycle it dies in, so
 *  its life ends on that cycle's cell (which is why the view draws the ✕ in the NEXT column). */
function victimsAt(map: PipelineMap, cycle: number): string[] {
  return map.rows
    .filter((r) => r.killedBy !== null && r.cells[r.cells.length - 1]?.cycle === cycle)
    .map((r) => r.decoded.mnemonic);
}

/**
 * M4 STEP 6 — the map marks the two speculative ACTIONS, on the row of the branch that took them.
 *
 * **Why this is not "colour the ✕ by `flush.reason`", which is what the step looked like.** Two
 * independent reasons, and either one alone decides it:
 *
 *   1. **A misprediction can kill NOBODY.** Measured, in the shipped corpus: `call-return`'s `ret`
 *      is a `jalr` at the end of `.text`, so it mispredicts, pays its two cycles, and the fetch
 *      pointer is already out of text — no casualty exists to colour. A victim-centric map is
 *      structurally blind to it, and it is the load-bearing half of the milestone's thesis (*jalr
 *      can never be predicted*). This is step 5's finding one surface up: **the flush is the COST,
 *      the event is the ACTION.**
 *   2. **A `branch-predicted-taken` casualty is not a misprediction** — it is the toll of a BET,
 *      paid even when the bet is RIGHT (9 of `sum-loop`'s 10 are). Colouring victims by reason
 *      would teach "red = wrong" while the map's own numbers say otherwise, and would put an
 *      engine's reason vocabulary in the module that carries no model knowledge.
 */
describe('the speculation marks — the ACTION, on the branch that took it', () => {
  // Derived before it was run, from the pinned per-transfer rule (step 3): the scheme's only job is
  // to decide `predicted`, and a mark is an ACTION. `sum-loop` executes its `bnez` ten times — taken
  // nine, declining once to exit.
  it('sum-loop: not-taken never bets and is wrong 9 times; taken bets 10 times and is wrong once', () => {
    // Predict-not-taken performs no action at ID — it keeps fetching, and the fall-through IS the
    // not-taken path (step 1). So: no bets, and every one of the nine TAKEN passes mispredicts.
    const off = actions(mapOf('sum-loop', false));
    expect(off.bets).toEqual([]);
    expect(off.wrong).toHaveLength(9);
    // The exit pass declines, which predict-not-taken gets RIGHT — and a correct resolution is not
    // an action either, so it is unmarked. Nine wrong out of ten resolutions, and all nine are the
    // one branch. (`bne`, not `bnez`: the row carries the DECODED instruction, so the map names
    // what the machine ran and not what the source spelled — the same reason `ret` reads `jalr`.)
    expect(new Set(off.wrong.map((w) => w.split('@')[0]))).toEqual(new Set(['bne']));

    // Static-taken bets on every pass, including the one it loses.
    const on = actions(mapOf('sum-loop', true));
    expect(on.bets).toHaveLength(10);
    expect(on.wrong).toHaveLength(1);

    // The marks land on the stage that TAKES the action — the bet in ID (the earliest a PC-relative
    // target is computable, step 0) and the correction in EX. These are the same two redirects the
    // datapath draws (step 5), which is what keeps the two surfaces on one vocabulary.
    expect(new Set(on.bets.map((b) => b.split(':')[1]))).toEqual(new Set(['ID']));
    expect(new Set(on.wrong.map((w) => w.split(':')[1]))).toEqual(new Set(['EX']));
  });

  // THE FINDING, and the reason the marks exist at all. Asserted under BOTH schemes because it is
  // not a fact about the knob: `jalr` is unpredictable by anyone, so nobody can ever get it right.
  it.each([false, true])(
    'call-return: the `ret` mispredicts and kills NOBODY — a penalty the ✕ cannot show [taken=%s]',
    (predictTaken) => {
      const map = mapOf('call-return', predictTaken);
      const { wrong } = actions(map);

      // `ret` is a `jalr`: never predictable ⇒ predicted false ⇒ always taken ⇒ always mispredicts.
      const ret = wrong.find((w) => w.startsWith('jalr@'));
      expect(ret).toBeDefined();

      // ...and its correction cuts nothing, because it is the last word in `.text` and the fetch
      // pointer has already run off the end. It pays 2 cycles for 0 casualties. Before this step
      // the map drew NOTHING here — no ✕, no mark, nothing — while the timing suite charged it two.
      const cycle = Number(ret!.split('@')[1]!.split(':')[0]);
      expect(victimsAt(map, cycle)).toEqual([]);

      // The mark is therefore the ONLY thing on the map that shows it. Stated as the contrast that
      // makes it a finding rather than a curiosity: the `jal` in the same program mispredicts too
      // (under not-taken) and DOES cut rows, so "misprediction ⇒ casualties" is exactly the false
      // rule a victim-centric map would have taught.
      const drawn = map.rows.filter((r) => r.cells.some((c) => c.mispredicted || c.bet));
      expect(drawn.map((r) => r.decoded.mnemonic)).toContain('jalr');
    },
  );

  // The regression, made READABLE rather than merely present. "Casualties visibly rise" is the
  // acceptance line, and it is thin: 3 → 4, one extra ✕ among thirteen rows, one of the four an
  // unrelated `halt`. The picture that actually teaches "no scheme dominates" is the LOST BET —
  // `call-return`'s `bge` is the corpus's only branch that bets and is wrong, and it is legible as
  // exactly that: a `?` on its ID, a `!` on its EX, and two rows cut beneath it.
  it('call-return: static-taken makes the LOST BET legible — the picture of the +1 regression', () => {
    const off = actions(mapOf('call-return', false));
    // Under not-taken the `bge` declines and is predicted right: it costs nothing and does nothing.
    expect(off.bets).toEqual([]);
    expect(off.wrong.filter((w) => w.startsWith('bge@'))).toEqual([]);

    const on = actions(mapOf('call-return', true));
    // Under static-taken it bets — and loses. Both marks, on one instruction: the only shape in the
    // corpus that says "the machine guessed, and the guess was wrong".
    expect(on.bets.filter((b) => b.startsWith('bge@'))).toHaveLength(1);
    expect(on.wrong.filter((w) => w.startsWith('bge@'))).toHaveLength(1);

    // And that bet is what turns the program's `jal` from a mispredict into a correct guess — the
    // trade that nets +1. Signed per instruction, never averaged (step 3's rule, for step 3's
    // reason): `jal` improves, `bge` regresses, `jalr` is unmovable.
    expect(off.wrong.filter((w) => w.startsWith('jal@'))).toHaveLength(1);
    expect(on.wrong.filter((w) => w.startsWith('jal@'))).toEqual([]);
    expect(on.bets.filter((b) => b.startsWith('jal@'))).toHaveLength(1);
  });

  // The marks are a claim about SPECULATION, so they must not move when the OTHER knob does. This
  // is the cross product step 2 had to add to conformance for the same reason.
  it.each([false, true])(
    'the marks are independent of forwarding [forwarding=%s]',
    (forwarding) => {
      const on = actions(mapOf('sum-loop', true, forwarding));
      expect(on.bets).toHaveLength(10);
      expect(on.wrong).toHaveLength(1);
    },
  );

  // Non-vacuity, the M3-step-0 rule: every claim above is a count, and a fold that marked NOTHING
  // would satisfy `toEqual([])` in half of them. Something must actually be marked.
  it('marks something in every corpus program that speculates', () => {
    const speculating = ['sum-loop', 'array-sum', 'call-return'];
    for (const name of speculating) {
      const on = actions(mapOf(name, true));
      expect(on.bets.length, `${name} should bet under static-taken`).toBeGreaterThan(0);
      const off = actions(mapOf(name, false));
      expect(off.wrong.length, `${name} should mispredict under not-taken`).toBeGreaterThan(0);
      expect(off.bets, `${name} must never bet under not-taken`).toEqual([]);
    }
  });
});

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

  /**
   * THE ZERO-VICTIM BET — the case the shipped corpus cannot produce, and the sharpest statement of
   * why the marks are not `flush.reason` in a costume.
   *
   * `schema.ts` pins it in prose: *"a branch sitting at the end of `.text` bets on every pass with
   * the fetch pointer already out of text, so it kills nobody and emits no flush while still
   * redirecting the pc"* — step 5 measured exactly that (3 bets, 0 flushes) on a probe program. Our
   * corpus happens to give every BET a victim (`call-return`'s `ret` is the zero-victim
   * MISPREDICTION; a zero-victim bet needs a predictable branch last in `.text`, which no example
   * program has). So a hand-built trace is the only thing that can drive it — the M3 step-7
   * technique, and the same reason lanes and depth are driven this way.
   *
   * A consumer reading the flush as the bet is drawing the COST and calling it the ACTION: right
   * for the wrong reason, and blind exactly here.
   */
  it('marks a bet that killed nobody — the action is not its casualties', () => {
    const map = buildPipelineMap([
      // The branch bets in ID. No `flush` accompanies it: IF had nothing to lose, so per the flush
      // contract no event is emitted at all — and there is no younger row for a ✕ to sit under.
      cycle(0, [inst('br', 'ID')], [{ type: 'branch-predicted', instr: 'br', target: 0x40 }]),
      cycle(1, [inst('br', 'EX')]),
    ]);

    expect(map.rows).toHaveLength(1);
    const br = map.rows[0]!;
    // The action is drawn...
    expect(br.cells.map((c) => c.bet)).toEqual([true, false]);
    // ...while the cost is genuinely absent. Nobody died, and the map says so.
    expect(br.killedBy).toBeNull();
    expect(map.rows.every((r) => r.killedBy === null)).toBe(true);
  });

  /**
   * The mirror: a MISPREDICTION that killed nobody. `call-return`'s `ret` is this for real, but it
   * is worth stating without an engine too, because the fold must not infer the mark from a flush
   * that is not there.
   *
   * And the `predicted !== actual` rule gets its own case here rather than being trusted: `actual`
   * alone is NOT a stand-in, and the two coincide exactly while nothing predicts taken — the
   * coincidence that broke the datapath's redirect in step 5 and that no not-taken-only corpus can
   * tell apart. Below, a CORRECT bet on a TAKEN branch (`predicted: true, actual: true`) must be
   * unmarked; a LOST bet (`predicted: true, actual: false`) must be marked. A fold keying on
   * `actual` gets both backwards.
   */
  it('marks a misprediction by `predicted !== actual`, never by `actual`', () => {
    const resolve = (instr: string, predicted: boolean, actual: boolean): TraceEvent => ({
      type: 'branch-resolved',
      instr,
      predicted,
      actual,
      target: 0x40,
    });
    const map = buildPipelineMap([
      cycle(
        0,
        [inst('correct-taken', 'EX'), inst('lost-bet', 'ID')],
        // A correct bet on a taken branch: `actual` is TRUE and it is NOT a misprediction.
        [resolve('correct-taken', true, true)],
      ),
      cycle(
        1,
        [inst('lost-bet', 'EX'), inst('correct-nt', 'ID')],
        // A lost bet: `actual` is FALSE and it IS a misprediction.
        [resolve('lost-bet', true, false)],
      ),
      cycle(
        2,
        [inst('correct-nt', 'EX')],
        // Predict-not-taken getting a declining branch right: neither predicted nor taken, and no
        // action of any kind.
        [resolve('correct-nt', false, false)],
      ),
    ]);

    const marked = (id: string): boolean =>
      map.rows.find((r) => r.id === id)!.cells.some((c) => c.mispredicted);
    expect(marked('correct-taken')).toBe(false); // keys on `actual` ⇒ true. It is not.
    expect(marked('lost-bet')).toBe(true); // keys on `actual` ⇒ false. It is.
    expect(marked('correct-nt')).toBe(false);
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
