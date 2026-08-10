/**
 * The scoreboard status-tables fold (M15 step 7) — the pure half, pinned against REAL recordings of
 * the whole corpus rather than a fixture.
 *
 * **What this file deliberately does not re-derive.** Every cycle number it reads back was already
 * hand-derived and pinned by the engine: `processor.test.ts` owns the witness walks and
 * `timing.test.ts` owns the corpus schedule. Reproducing them here would give a pinned table two
 * owners (step 4's rule). What IS this file's own is everything the FOLD adds on top of `micro`:
 * the accumulation, the trailing window, the flush-casualty derivation, the stall join, the
 * recording-wide id join, and the derived turnaround.
 *
 * **What it cannot see, stated up front:** it renders nothing. No test in this repo can see a
 * click, a HEIGHT or a COLOR (`docs/memory/browser-is-the-only-net.md`), so whether the panel is
 * legible, whether the caption's line box actually holds, and whether the tables read as a picture
 * rather than a spreadsheet are all step 8's. `ScoreboardTablesView.test.tsx` covers the weaker
 * claim that the fold's facts reach the markup.
 */

import { assemble } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import { DeepPipelineProcessor } from '@cpu-viz/engine-deep-pipeline';
import { OutOfOrderProcessor } from '@cpu-viz/engine-out-of-order';
import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { SingleCycleProcessor } from '@cpu-viz/engine-single-cycle';
import { SuperscalarProcessor } from '@cpu-viz/engine-superscalar';
import { MultiCycleProcessor } from '@cpu-viz/engine-multi-cycle';
import {
  FU_NAMES,
  INT_LATENCY,
  MEM_LATENCY,
  ScoreboardProcessor,
  type ScoreboardMicro,
} from '@cpu-viz/engine-scoreboard';
import { defaultConfig, type CycleTrace, type Processor } from '@cpu-viz/trace';
import type { DecodedInstruction } from '@cpu-viz/isa';
import { describe, expect, it } from 'vitest';
import { formatInstruction } from './format';
import { EXAMPLE_PROGRAMS } from './programs';
import {
  INSTRUCTION_WINDOW,
  TURNAROUND,
  buildScoreboardTables,
  hasScoreboardTables,
  primaryStall,
  type ScoreboardTablesView,
} from './scoreboard-tables';

function record(
  program: string,
  make: () => Processor = () => new ScoreboardProcessor(),
): readonly CycleTrace[] {
  const source = EXAMPLE_PROGRAMS.find((p) => p.name === program)?.source;
  if (source === undefined) throw new Error(`corpus program ${program} not found`);
  const { program: assembled, errors } = assemble(source);
  if (!assembled) throw new Error(`assembly failed: ${errors.map((e) => e.message).join()}`);
  const p = make();
  p.reset(toProgramImage(assembled), defaultConfig());
  const traces: CycleTrace[] = [];
  let guard = 0;
  while (!p.isHalted()) {
    if (guard++ >= 3000) throw new Error(`runaway on ${program}`);
    traces.push(p.step());
  }
  return traces;
}

const ALL = EXAMPLE_PROGRAMS.map((p) => p.name);
const microOf = (t: CycleTrace): ScoreboardMicro => t.state.micro as ScoreboardMicro;

/** The view at a given cycle of a recording — the fold as the panel calls it. */
function at(recording: readonly CycleTrace[], cycle: number): ScoreboardTablesView {
  const trace = recording.find((t) => t.cycle === cycle) ?? null;
  const view = buildScoreboardTables(trace, recording);
  if (view === null) throw new Error(`no view at cycle ${cycle}`);
  return view;
}

// -------------------------------------------------------------------------------------------
// The gate — a TRACE fact, and the claim that `registerResult` is unique to this model
// -------------------------------------------------------------------------------------------

describe('the panel gate is a trace fact, not a model name (INV-3)', () => {
  it('is true for a scoreboard recording', () => {
    expect(hasScoreboardTables(record('add'))).toBe(true);
  });

  /**
   * The gate's whole promise. If any other model's `micro` carried a `registerResult` array the
   * panel would appear on it, drawing this machine's tables over another machine's trace — the
   * INV-5 failure the `DatapathKind` discriminator exists to prevent one surface over.
   */
  it.each([
    ['single-cycle', () => new SingleCycleProcessor()],
    ['multi-cycle', () => new MultiCycleProcessor()],
    ['pipeline', () => new PipelineProcessor()],
    ['deep-pipeline', () => new DeepPipelineProcessor()],
    ['superscalar', () => new SuperscalarProcessor()],
    ['out-of-order', () => new OutOfOrderProcessor()],
  ] as const)('is false for every other model — %s', (_id, make) => {
    const recording = record('array-sum', make);
    expect(hasScoreboardTables(recording)).toBe(false);
    expect(buildScoreboardTables(recording[10] ?? null, recording)).toBeNull();
  });
});

// -------------------------------------------------------------------------------------------
// The pre-run cursor — the panel exists from the first frame
// -------------------------------------------------------------------------------------------

describe('the pre-run cursor gets a complete EMPTY view, never null', () => {
  /**
   * A panel that vanishes reserves nothing. The identical hole in `MicroTablePanel` dropped every
   * surface below it by 526px when the reader stepped off the start, which is the largest single
   * jump the shell has ever had. This is that hole, closed before it can open.
   */
  it('three idle units, thirty-two unclaimed registers, no rows, no stalls', () => {
    const view = buildScoreboardTables(null, record('register-reuse'));
    expect(view).not.toBeNull();
    expect(view!.instructions).toEqual([]);
    expect(view!.hidden).toBe(0);
    expect(view!.stalls).toEqual([]);
    expect(view!.units.map((u) => u.name)).toEqual([...FU_NAMES]);
    expect(view!.units.every((u) => !u.busy && u.instr === null)).toBe(true);
    expect(view!.registerResult).toHaveLength(32);
    expect(view!.registerResult.every((r) => r.unit === null && r.instr === null)).toBe(true);
  });

  /** …and it is the same GEOMETRY the run reaches, which is the whole reason it is not null. */
  it('has the same unit and register geometry as a mid-run cursor', () => {
    const recording = record('register-reuse');
    const pre = buildScoreboardTables(null, recording)!;
    const mid = at(recording, 17);
    expect(pre.units.map((u) => u.name)).toEqual(mid.units.map((u) => u.name));
    expect(pre.registerResult.map((r) => r.name)).toEqual(mid.registerResult.map((r) => r.name));
  });
});

// -------------------------------------------------------------------------------------------
// The accumulation — the fold's largest departure from `micro`, and why it is one
// -------------------------------------------------------------------------------------------

describe('the instruction table accumulates, and that is what makes the reorder visible', () => {
  /**
   * The headline. `register-reuse.s` at cycle 25: `i4` (fetched fifth) writes at 18 while `i5`
   * (fetched sixth) already wrote at 17 — the write-result column reading out of order down the
   * page, which is the textbook's picture and this model's whole distinguishing feature.
   */
  it('the write-result column runs out of order down the page', () => {
    const view = at(record('register-reuse'), 25);
    const writes = view.instructions.map((r) => r.writeResult);
    // Fetch order is the row order, so a DECREASE anywhere in this column is out-of-order
    // completion, sitting on the table rather than flashing for one cycle.
    const filled = writes.filter((w): w is number => w !== null);
    expect(filled.some((w, i) => i > 0 && w < filled[i - 1]!)).toBe(true);

    const add16 = view.instructions.find((r) => r.pc === 16)!;
    const addi20 = view.instructions.find((r) => r.pc === 20)!;
    expect(view.instructions.indexOf(add16)).toBeLessThan(view.instructions.indexOf(addi20));
    expect(add16.writeResult).toBeGreaterThan(addi20.writeResult!);
  });

  /**
   * ⚠ **And the live window cannot show it** — the measurement that decided the design. Drawing
   * `micro.instructions` straight through would put both of those rows on screen together for
   * exactly ONE cycle of the thirty-one, and on seven of the thirteen corpus programs for none at
   * all. This test is what reddens if someone "simplifies" the fold back to the snapshot.
   */
  it('the live micro window has already dropped the older of the two rows', () => {
    const recording = record('register-reuse');
    const live = microOf(recording.find((t) => t.cycle === 25)!);
    const pcs = live.instructions.map((r) => r.pc);
    expect(pcs).not.toContain(20);
    expect(live.instructions.length).toBeLessThanOrEqual(4);
  });

  /** Corpus-wide: the live window never exceeds four rows, so it is never the picture. */
  it('the live window peaks at four rows across the whole corpus', () => {
    const peak = Math.max(
      ...ALL.flatMap((name) => record(name).map((t) => microOf(t).instructions.length)),
    );
    expect(peak).toBe(4);
  });

  /** A cell is written once and never retracted, so accumulating "last non-null" is exact. */
  it('an accumulated cell never regresses to null once the engine has filled it', () => {
    const recording = record('array-sum');
    const seen = new Map<string, number>();
    for (const t of recording) {
      for (const row of at(recording, t.cycle).instructions) {
        const filled = [row.issue, row.readOperands, row.executeComplete, row.writeResult].filter(
          (v) => v !== null,
        ).length;
        expect(filled).toBeGreaterThanOrEqual(seen.get(row.id) ?? 0);
        seen.set(row.id, filled);
      }
    }
  });
});

// -------------------------------------------------------------------------------------------
// The window cap — a constant, which is what makes the panel's height constant
// -------------------------------------------------------------------------------------------

describe('the trailing window is a cap, not a measurement', () => {
  it('never exceeds INSTRUCTION_WINDOW rows at any cursor, on any corpus program', () => {
    for (const name of ALL) {
      const recording = record(name);
      for (const t of recording) {
        expect([name, t.cycle, at(recording, t.cycle).instructions.length]).toEqual([
          name,
          t.cycle,
          expect.any(Number),
        ]);
        expect(at(recording, t.cycle).instructions.length).toBeLessThanOrEqual(INSTRUCTION_WINDOW);
      }
    }
  });

  /** Non-vacuity: the cap must actually BITE somewhere, or it is measuring nothing. The corpus
   *  accumulates 157 rows on `array-sum-twice.s`, so it bites hard. */
  it('...and it genuinely bites — `hidden` accounts for every row it drops', () => {
    const recording = record('array-sum-twice');
    const last = at(recording, recording[recording.length - 1]!.cycle);
    expect(last.instructions).toHaveLength(INSTRUCTION_WINDOW);
    expect(last.hidden).toBeGreaterThan(100);

    // `hidden + shown` is every id ever rowed — nothing is silently lost.
    const ever = new Set<string>();
    for (const t of recording) for (const r of microOf(t).instructions) ever.add(r.instr);
    expect(last.hidden + last.instructions.length).toBe(ever.size);
  });

  it('a short program hides nothing', () => {
    const view = at(record('add'), 8);
    expect(view.hidden).toBe(0);
    expect(view.instructions.length).toBeLessThan(INSTRUCTION_WINDOW);
  });
});

// -------------------------------------------------------------------------------------------
// Row order — fetch order, which is issue order because Issue is in order and blocking
// -------------------------------------------------------------------------------------------

describe('rows are in fetch order, and on this machine that IS issue order', () => {
  /**
   * Issue is in order and BLOCKING here (the property that separates this row from the
   * out-of-order one directly above it in the picker). So a table drawn in fetch order has a
   * non-decreasing `issue` column — and any decrease would mean the fold had reordered the rows,
   * or the machine had stopped being a scoreboard.
   */
  it.each(ALL)('the issue column never decreases down the table — %s', (name) => {
    const recording = record(name);
    for (const t of recording) {
      const issues = at(recording, t.cycle)
        .instructions.map((r) => r.issue)
        .filter((v): v is number => v !== null);
      expect([name, t.cycle, issues]).toEqual([name, t.cycle, [...issues].sort((a, b) => a - b)]);
    }
  });
});

// -------------------------------------------------------------------------------------------
// The flush casualty — a derivation, cross-checked against the event
// -------------------------------------------------------------------------------------------

describe('a flush casualty is derived, and the derivation is exact', () => {
  /**
   * An instruction leaves `IF` in exactly two ways: it issues (and carries an `issue` cycle
   * forever after), or it is killed. So "never issued AND no longer rowed" is not a heuristic.
   *
   * Cross-checked here against the ground truth step 4 pinned — on a flush cycle
   * `trace.instructions` sights TWO ids at `IF` and `micro` rows ONE, and the extra one is the
   * casualty. Over the whole corpus, both sets agree exactly.
   */
  it.each(ALL)('matches the ids the flush contract names — %s', (name) => {
    const recording = record(name);
    const final = recording[recording.length - 1]!;
    const derived = new Set(
      at(recording, final.cycle)
        .instructions.filter((r) => r.flushed)
        .map((r) => r.id),
    );

    const casualties = new Set<string>();
    for (const t of recording) {
      if (!t.events.some((e) => e.type === 'flush')) continue;
      const rowed = new Set(microOf(t).instructions.map((r) => r.instr));
      for (const i of t.instructions)
        if (i.location === 'IF' && !rowed.has(i.id)) casualties.add(i.id);
    }
    // The window may have dropped older casualties, so the derived set is the visible subset.
    for (const id of derived) expect([name, id, casualties.has(id)]).toEqual([name, id, true]);
  });

  /** Non-vacuity: the corpus must actually produce one, or the claim above is about nothing. */
  it('the corpus produces casualties, and they never carry an issue cycle', () => {
    const recording = record('array-sum');
    const flushed = recording.flatMap((t) =>
      at(recording, t.cycle).instructions.filter((r) => r.flushed),
    );
    expect(flushed.length).toBeGreaterThan(0);
    expect(flushed.every((r) => r.issue === null && r.writeResult === null)).toBe(true);
  });

  /** …and the IF occupant of the current cycle is NOT a casualty, which is the confusable case:
   *  it has no issue cycle either, and the only thing telling them apart is that it is still rowed. */
  it('the current IF occupant is not mistaken for one', () => {
    const recording = record('register-reuse');
    for (const t of recording) {
      const inIf = microOf(t).instructions.find((r) => r.issue === null);
      if (inIf === undefined) continue;
      const row = at(recording, t.cycle).instructions.find((r) => r.id === inIf.instr)!;
      expect([t.cycle, row.flushed, row.inFlight]).toEqual([t.cycle, false, true]);
    }
  });
});

// -------------------------------------------------------------------------------------------
// The stall join — and the trap that a stall's STAGE is not a position
// -------------------------------------------------------------------------------------------

describe('stalls join to their instruction, and the stage is reported without being believed', () => {
  /**
   * ⚠ **The step-4 finding this whole surface had to be designed around.** Issue is a TRANSITION
   * on this machine, not a latch: an instruction held at Issue never leaves `ifSlot`, so its
   * `location` reads `IF` while its stall event says `stage: 'ID'`. A view that highlighted
   * `stall.stage` would light a cell the instruction is not in. The fold therefore carries the
   * stage as a REPORT and never as a position — this test pins that the disagreement is real, so
   * nobody later "reconciles" it.
   */
  it('an Issue stall says stage ID while the instruction is still located at IF', () => {
    const recording = record('register-reuse');
    let witnesses = 0;
    for (const t of recording) {
      const view = at(recording, t.cycle);
      for (const s of view.stalls) {
        if (s.stage !== 'ID') continue;
        const located = t.instructions.find((i) => i.id === s.id);
        expect([t.cycle, s.id, located?.location]).toEqual([t.cycle, s.id, 'IF']);
        witnesses++;
      }
    }
    expect(witnesses).toBeGreaterThan(0);
  });

  /**
   * The mirror image, and the other shape with no sibling in the product: a WAR stall fires at the
   * END of an instruction's life. The stalled row has already finished executing and is held at
   * Write-Result — every other stall in the whole shell fires at the beginning.
   */
  it('a WAR stall holds a row that has already completed execution', () => {
    const recording = record('register-reuse');
    let witnesses = 0;
    for (const t of recording) {
      const view = at(recording, t.cycle);
      for (const s of view.stalls) {
        if (s.reason !== 'war') continue;
        expect(s.stage).toBe('WB');
        const row = view.instructions.find((r) => r.id === s.id)!;
        expect(row.executeComplete).not.toBeNull();
        expect(row.writeResult).toBeNull();
        witnesses++;
      }
    }
    expect(witnesses).toBeGreaterThan(0);
  });

  it('every stall event reaches exactly one instruction row, with the cadence preserved', () => {
    for (const name of ALL) {
      const recording = record(name);
      for (const t of recording) {
        const events = t.events.filter((e) => e.type === 'stall');
        const view = at(recording, t.cycle);
        expect([name, t.cycle, view.stalls.length]).toEqual([name, t.cycle, events.length]);
        // Each stall is also attached to its row, unless the window has dropped that row.
        for (const s of view.stalls) {
          const row = view.instructions.find((r) => r.id === s.id);
          if (row !== undefined) expect(row.stalls).toContain(s);
        }
      }
    }
  });

  /** The unit rows carry their occupant's stall, so the FU table says why it is not moving. */
  it('a busy unit carries its occupant’s stall', () => {
    const recording = record('register-reuse');
    const view = at(recording, 13);
    const holding = view.units.find((u) => u.stalls.some((s) => s.reason === 'war'));
    expect(holding).toBeDefined();
    expect(holding!.busy).toBe(true);
  });
});

// -------------------------------------------------------------------------------------------
// `primaryStall` — the caption picks the hazard, which is the rare thing and the subject
// -------------------------------------------------------------------------------------------

describe('the caption explains a hazard when there is one', () => {
  /**
   * The discriminating case, and it is real rather than hypothetical: at cycle 19 of
   * `register-reuse.s` the events are `operand` first and `waw` second. Taking `stalls[0]` would
   * explain the operand wait and fall silent on the hazard the program exists to show.
   */
  it('prefers a hazard over an earlier non-hazard event', () => {
    const recording = record('register-reuse');
    const view = at(recording, 19);
    expect(view.stalls.map((s) => s.reason)).toEqual(['operand', 'waw']);
    expect(primaryStall(view)!.reason).toBe('waw');
  });

  it('falls back to the first event when nothing is a hazard, and to null on a quiet cycle', () => {
    const recording = record('register-reuse');
    const structural = at(recording, 3);
    expect(structural.stalls.every((s) => !s.hazard)).toBe(true);
    expect(primaryStall(structural)!.reason).toBe(structural.stalls[0]!.reason);

    const quiet = recording.find((t) => !t.events.some((e) => e.type === 'stall'))!;
    expect(primaryStall(at(recording, quiet.cycle))).toBeNull();
  });

  it('exactly the two hazards are flagged as hazards, corpus-wide', () => {
    const flagged = new Set<string>();
    const plain = new Set<string>();
    for (const name of ALL) {
      const recording = record(name);
      for (const t of recording) {
        for (const s of at(recording, t.cycle).stalls) (s.hazard ? flagged : plain).add(s.reason);
      }
    }
    expect([...flagged].sort()).toEqual(['war', 'waw']);
    expect([...plain].sort()).toEqual(['control', 'operand', 'structural-int', 'structural-mem']);
  });
});

// -------------------------------------------------------------------------------------------
// The turnaround — derived from the engine's constants, because the view must state it
// -------------------------------------------------------------------------------------------

describe('the unit turnaround is derived, not written down', () => {
  /**
   * Step 3 measured this as the DOMINANT cost on this machine — larger than either hazard the
   * milestone exists to show — and required the view to say it out loud, or the wall of
   * `structural-int` reads as a verdict on the reader's program. Deriving it from the engine's own
   * latency constants is what stops the sentence going stale against a re-derived timing table.
   */
  it('is three fixed stages plus the unit’s own latency', () => {
    expect(TURNAROUND).toEqual({ int: 3 + INT_LATENCY, mem: 3 + MEM_LATENCY });
    expect(TURNAROUND).toEqual({ int: 4, mem: 7 });
  });

  it('and the numbers appear in the explanation the caption prints', () => {
    const recording = record('register-reuse');
    const structural = at(recording, 3).stalls.find((s) => s.reason === 'structural-int')!;
    expect(structural.explain).toContain(`${TURNAROUND.int} cycles`);
    expect(structural.explain).toContain('0.5 instructions per cycle');

    const mem = ALL.flatMap((n) => {
      const r = record(n);
      return r.flatMap((t) => at(r, t.cycle).stalls);
    }).find((s) => s.reason === 'structural-mem')!;
    expect(mem.explain).toContain(`${TURNAROUND.mem} cycles`);
  });

  it('every reason the engine can emit has words, not just its string', () => {
    const seen = new Map<string, string>();
    for (const name of ALL) {
      const recording = record(name);
      for (const t of recording)
        for (const s of at(recording, t.cycle).stalls) seen.set(s.reason, s.explain);
    }
    expect([...seen.keys()].sort()).toEqual([
      'control',
      'operand',
      'structural-int',
      'structural-mem',
      'war',
      'waw',
    ]);
    // A reason with no case falls through to its own string; that would be a silent hole.
    for (const [reason, explain] of seen)
      expect([reason, explain === reason]).toEqual([reason, false]);
  });
});

// -------------------------------------------------------------------------------------------
// The other two tables — fixed geometry, which is why neither needs a reserve
// -------------------------------------------------------------------------------------------

describe('the unit and register tables are fixed by construction', () => {
  it.each(ALL)('three units and thirty-two registers at every cursor — %s', (name) => {
    const recording = record(name);
    for (const t of recording) {
      const view = at(recording, t.cycle);
      expect([name, t.cycle, view.units.map((u) => u.name)]).toEqual([
        name,
        t.cycle,
        [...FU_NAMES],
      ]);
      expect([name, t.cycle, view.registerResult.length]).toEqual([name, t.cycle, 32]);
      expect(view.registerResult.map((r) => r.reg)).toEqual([...Array(32).keys()]);
    }
  });

  /** Non-vacuity for the register table: claims must actually appear, and they must be RARE —
   *  which is half of why the two hazards are rare, and the reason the whole file is drawn. */
  it('claims appear, and peak at three of thirty-two', () => {
    let peak = 0;
    let everClaimed = false;
    for (const name of ALL) {
      const recording = record(name);
      for (const t of recording) {
        const claimed = at(recording, t.cycle).registerResult.filter((r) => r.unit !== null);
        if (claimed.length > 0) everClaimed = true;
        peak = Math.max(peak, claimed.length);
      }
    }
    expect(everClaimed).toBe(true);
    expect(peak).toBe(3);
  });

  /** A claimed register joins to the instruction that will write it, so clicking it can follow. */
  it('a claimed register resolves to the occupant of the claiming unit', () => {
    const recording = record('register-reuse');
    for (const t of recording) {
      const view = at(recording, t.cycle);
      for (const claim of view.registerResult) {
        if (claim.unit === null) {
          expect(claim.instr).toBeNull();
          continue;
        }
        const unit = view.units.find((u) => u.name === claim.unit)!;
        expect([t.cycle, claim.name, claim.instr]).toEqual([t.cycle, claim.name, unit.instr]);
      }
    }
  });
});

// -------------------------------------------------------------------------------------------
// The id join — recording-wide, so it cannot miss
// -------------------------------------------------------------------------------------------

describe('the id → assembly join goes through the whole recording', () => {
  /**
   * `micro` carries only the mnemonic, so without a join the table could not print operands at
   * all. The join is recording-wide rather than through the cursor's own `trace.instructions`
   * because an id is stable for its whole lifetime (INV-4) while "is a row still listed on its own
   * cycle" is a per-model fact — the assumption that blanked `cache-grid.ts` on a shipped model.
   */
  /**
   * ⚠ The obvious assertion — "no row is a bare mnemonic" — is WRONG, and measuring it is what
   * said so: `ecall` has no operands, so its formatted text IS its mnemonic and the app printing
   * it is right. What actually nets a missed join is comparing against `formatInstruction` of the
   * decoding the recording carries, with a non-vacuity clause that most rows do print operands.
   */
  it('every row is the FORMATTED instruction, not the mnemonic the snapshot carries', () => {
    const recording = record('register-reuse');
    const decoded = new Map<string, DecodedInstruction>();
    for (const t of recording)
      for (const i of t.instructions) if (!decoded.has(i.id)) decoded.set(i.id, i.decoded);

    let withOperands = 0;
    for (const t of recording) {
      for (const row of at(recording, t.cycle).instructions) {
        const d = decoded.get(row.id);
        expect([t.cycle, row.id, d === undefined]).toEqual([t.cycle, row.id, false]);
        expect([t.cycle, row.text]).toEqual([t.cycle, formatInstruction(d!)]);
        if (row.text.includes(' ')) withOperands++;
      }
    }
    expect(withOperands).toBeGreaterThan(0);
  });

  it('a busy unit prints its occupant’s assembly too', () => {
    const recording = record('register-reuse');
    const view = at(recording, 13);
    for (const u of view.units) {
      if (!u.busy) expect(u.text).toBeNull();
      else expect(u.text).toEqual(expect.stringContaining(' '));
    }
  });
});

// -------------------------------------------------------------------------------------------
// `inFlight` — the window against the log
// -------------------------------------------------------------------------------------------

describe('inFlight separates what is in the machine from what is history', () => {
  it('matches the live micro snapshot exactly, and both states occur', () => {
    const recording = record('register-reuse');
    let sawFlight = false;
    let sawHistory = false;
    for (const t of recording) {
      const live = new Set(microOf(t).instructions.map((r) => r.instr));
      for (const row of at(recording, t.cycle).instructions) {
        expect([t.cycle, row.id, row.inFlight]).toEqual([t.cycle, row.id, live.has(row.id)]);
        if (row.inFlight) sawFlight = true;
        else sawHistory = true;
      }
    }
    expect([sawFlight, sawHistory]).toEqual([true, true]);
  });
});

// -------------------------------------------------------------------------------------------
// Purity (INV-3)
// -------------------------------------------------------------------------------------------

describe('the fold is pure', () => {
  it('same inputs produce a deep-equal view', () => {
    const recording = record('register-reuse');
    const trace = recording.find((t) => t.cycle === 17)!;
    expect(buildScoreboardTables(trace, recording)).toEqual(
      buildScoreboardTables(trace, recording),
    );
  });
});
