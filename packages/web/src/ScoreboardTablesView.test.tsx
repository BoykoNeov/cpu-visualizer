/**
 * The scoreboard tables' RENDER seam (M15 step 7).
 *
 * ⚠ **Why this file exists when `scoreboard-tables.test.ts` already pins the fold.** M13's log
 * records "a test that keys off a pure fold rather than the render" as this repo's signature
 * defect — eight recurrences, two of them inside the fix written to stop it. So every case below
 * starts from a RECORDING, renders the real component, and reads the markup. A fold assertion
 * cannot see a table that was folded correctly and then never drawn, or drawn from the wrong field.
 *
 * **What it still cannot see, stated rather than implied.** `renderToStaticMarkup` renders; it does
 * not click, it does not lay out, and there is no jsdom in this repo. So the follow-highlight
 * composing with the pipeline map, whether the caption's line box actually holds at a narrow
 * viewport, whether thirty-two register cells wrap into a fifth row, and whether the tables read as
 * a picture rather than a spreadsheet are all step 8's. Nothing here should be read as covering
 * them — `docs/memory/browser-is-the-only-net.md`.
 */

import { assemble } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
import { ScoreboardProcessor } from '@cpu-viz/engine-scoreboard';
import { defaultConfig, type CycleTrace, type Processor } from '@cpu-viz/trace';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_PROGRAMS } from './programs';
import { ScoreboardTables } from './ScoreboardTablesView';

function record(
  program: string,
  make: () => Processor = () => new ScoreboardProcessor(),
): readonly CycleTrace[] {
  const source = EXAMPLE_PROGRAMS.find((p) => p.name === program)!.source;
  const { program: assembled } = assemble(source);
  const p = make();
  p.reset(toProgramImage(assembled!), defaultConfig());
  const traces: CycleTrace[] = [];
  let guard = 0;
  while (!p.isHalted()) {
    if (guard++ >= 3000) throw new Error('runaway');
    traces.push(p.step());
  }
  return traces;
}

/** Render the real panel at a cursor. `cycle: null` is the pre-run cursor. */
function draw(
  recording: readonly CycleTrace[],
  cycle: number | null,
  followed: string | null = null,
): string {
  const trace = cycle === null ? null : (recording.find((t) => t.cycle === cycle) ?? null);
  return renderToStaticMarkup(
    <ScoreboardTables
      trace={trace}
      recording={recording}
      followed={followed}
      onFollow={() => undefined}
    />,
  );
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe('the panel draws for this model and for no other', () => {
  it('renders for a scoreboard recording', () => {
    expect(draw(record('register-reuse'), 17)).toContain('Scoreboard status tables');
  });

  it('renders NOTHING for another model — the gate reaches the markup', () => {
    const pipeline = record('array-sum', () => new PipelineProcessor());
    expect(draw(pipeline, 10)).toBe('');
  });
});

describe('all three tables reach the markup', () => {
  const html = draw(record('register-reuse'), 17);

  it('names each table', () => {
    expect(html).toContain('Instruction status');
    expect(html).toContain('Functional-unit status');
    expect(html).toContain('Register result');
  });

  it('draws the textbook column headings, and the four cycle columns', () => {
    for (const heading of ['issue', 'read op', 'exec done', 'write']) {
      expect([heading, html.includes(heading)]).toEqual([heading, true]);
    }
    // The FU table's own field names, which are the textbook's.
    for (const field of ['Fi', 'Fj', 'Fk', 'Qj', 'Qk', 'Rj', 'Rk']) {
      expect([field, html.includes(`>${field}<`)]).toEqual([field, true]);
    }
  });

  it('draws all three units, idle ones included — the table is the MACHINE', () => {
    for (const unit of ['INT0', 'INT1', 'MEM']) {
      expect([unit, html.includes(unit)]).toEqual([unit, true]);
    }
  });

  it('draws all thirty-two register cells, not the claimed subset', () => {
    // `zero` and `t6` are the first and last ABI names; a claimed-only table would draw neither.
    expect(html).toContain('zero');
    expect(html).toContain('t6');
  });
});

describe('the picture the surface exists for reaches the markup', () => {
  /**
   * The headline, read out of the RENDER rather than the fold: at cycle 25 of `register-reuse.s`
   * the write-result column runs `… 18, 17 …` down the page — an older row writing after a younger
   * one. A fold test can assert the numbers; only this can say they were drawn, in that order, in
   * that column.
   */
  it('the write-result column is out of order down the page', () => {
    const html = draw(record('register-reuse'), 25);
    // Pull every table row, then the LAST numeric cell of each — the write column.
    const rows = html.split('<tr').slice(1);
    const writes: number[] = [];
    for (const row of rows) {
      const cells = [...row.matchAll(/<td[^>]*>(?:<[^>]+>)*([^<]*)/g)].map((m) => m[1]!.trim());
      if (cells.length < 8) continue; // header, or the FU table's rows
      const w = cells[6]!;
      if (/^\d+$/.test(w)) writes.push(Number(w));
    }
    expect(writes.length).toBeGreaterThan(4);
    expect(writes.some((w, i) => i > 0 && w < writes[i - 1]!)).toBe(true);
  });

  /** The two hazards are printed by NAME in the row that stalled — hue is never the sole carrier. */
  it('names a WAR stall in its row, and a WAW stall in its row', () => {
    expect(draw(record('register-reuse'), 13)).toContain('war @WB');
    expect(draw(record('register-reuse'), 19)).toContain('waw @ID');
  });

  /**
   * ⚠ The step-4 trap, checked at the RENDER. The stage a stall reports is printed as text and is
   * never used as a position: at cycle 19 the WAW-stalled instruction says `@ID` while it is still
   * located in `IF`. Nothing in the markup may claim it is anywhere.
   */
  it('prints a stall stage as text, never as a location', () => {
    const html = draw(record('register-reuse'), 19);
    expect(html).toContain('waw @ID');

    // ⚠ **This assertion is cell-EXACT, and the mutation check is why.** The first draft asked
    // whether the row "contains a dash" and whether it mentions a unit name — and a stub that put
    // `stall.stage` straight into the unit cell passed BOTH: an unissued row already has four
    // dashes in its cycle columns, and `ID` is not a unit name. Zero red in 11 872. The row's
    // positional claim is one specific cell, so that is the cell to read.
    const row = html.split('<tr').find((r) => r.includes('waw @ID'))!;
    const cells = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1]!);
    expect(cells).toHaveLength(8);
    // Columns: pc, instruction, UNIT, issue, read-op, exec-done, write, stalled-by.
    expect(cells[2]).toBe('—');
    // …and the stage string appears in the stall column and nowhere else in the row.
    expect(cells[7]).toContain('ID');
    for (const [i, text] of cells.entries()) {
      if (i !== 7) expect([i, text.includes('ID')]).toEqual([i, false]);
    }
  });
});

describe('the caption', () => {
  it('explains the hazard, in words, with the reason named', () => {
    const html = draw(record('register-reuse'), 19);
    expect(html).toContain('Register renaming is what deletes this hazard');
  });

  /**
   * The dominant cost said out loud, which step 3 required of this view: without it a wall of
   * `structural-int` reads as the scoreboard's verdict on the reader's program rather than as the
   * size of the machine. Both numbers are derived from the engine's latency constants.
   */
  it('states the turnaround ceiling, with the derived numbers', () => {
    const html = draw(record('register-reuse'), 3);
    expect(html).toContain('an integer unit turns around in 4 cycles, the memory unit in 7');
    expect(html).toContain('0.5 instructions per cycle');
  });

  /** It is ALWAYS present — an element that vanishes on quiet cycles reserves no height. */
  it('says something on a cycle with no stall at all', () => {
    const recording = record('register-reuse');
    const quiet = recording.find((t) => !t.events.some((e) => e.type === 'stall'))!;
    expect(draw(recording, quiet.cycle)).toContain('no stall this cycle');
  });
});

describe('the pre-run cursor draws the whole panel', () => {
  /** The 526px lesson: a panel that vanishes at cursor −1 reserves nothing, and stepping off the
   *  start then shoves every surface below it up the page. */
  it('is present, with all three tables, before the first cycle', () => {
    const html = draw(record('register-reuse'), null);
    expect(html).toContain('Scoreboard status tables');
    expect(html).toContain('Instruction status');
    expect(html).toContain('Functional-unit status');
    expect(html).toContain('Register result');
    expect(html).toContain('INT0');
    expect(html).toContain('zero');
  });

  it('draws the same number of register cells as a mid-run cursor', () => {
    const recording = record('register-reuse');
    expect(count(draw(recording, null), 'unclaimed, reads its committed value')).toBe(32);
    expect(
      count(draw(recording, 17), 'unclaimed, reads its committed value') +
        count(draw(recording, 17), 'will be written by'),
    ).toBe(32);
  });
});

describe('the follow-highlight reaches every row type', () => {
  /**
   * Instruction rows join by id, unit rows through their occupant, register cells through the
   * occupant of the claiming unit — so a reader who picked an instruction on the map sees it lit
   * on all three tables. `dp--follow` is the token every other surface uses; only a browser can see
   * the composition, but "the class was emitted at all" is checkable here.
   */
  it('lights the followed instruction on its instruction row, its unit, and its register', () => {
    const recording = record('register-reuse');
    const trace = recording.find((t) => t.cycle === 20)!;
    const micro = trace.state.micro as { units: { instr: string | null; fi: number | null }[] };
    const busy = micro.units.find((u) => u.instr !== null && u.fi !== null)!;

    const plain = draw(recording, 20);
    const lit = draw(recording, 20, busy.instr);
    expect(count(plain, 'dp--follow')).toBe(0);
    // One instruction row + one unit row + at least the register it has claimed.
    expect(count(lit, 'dp--follow')).toBeGreaterThanOrEqual(3);
  });

  it('following an id that is not in flight lights nothing', () => {
    const recording = record('register-reuse');
    expect(count(draw(recording, 20, 'no-such-id'), 'dp--follow')).toBe(0);
  });
});

describe('a flush casualty is marked in the table', () => {
  /** It never issues and never retires, and the table says which — otherwise a row frozen with four
   *  dashes reads as a bug in the machine. */
  it('says `flushed` on a row that was fetched and killed', () => {
    const recording = record('array-sum');
    const html = recording.map((t) => draw(recording, t.cycle)).find((h) => h.includes('flushed'));
    expect(html).toBeDefined();
  });
});

describe('the three tables spell a register two different ways, and the lessons say so', () => {
  /**
   * Two lessons on this model now tell the reader that the instruction and functional-unit tables
   * number their registers while the register grid names them (`x6` against `t1`). That is a claim
   * about the MARKUP — `regCell` lives in this file's component and is not exported, so the fold
   * oracles in `lessons.test.ts` can only reach the numeric FIELD behind it, never the cell it
   * draws. This is the render half, and it is the half that would go silently false if anyone
   * "tidied" one of the three surfaces into the other's vocabulary.
   *
   * Cycle 23 of `register-reuse.s`: the held `addi` has just taken a unit, so all three tables are
   * showing the same register at once — which is exactly the moment the lessons describe.
   */
  const html = draw(record('register-reuse'), 23);

  it('rows the instruction by number, never by ABI name', () => {
    expect(html, 'the instruction status table prints the assembled form').toContain(
      'addi x6, x0, 7',
    );
    expect(html, 'and never the source spelling the prose quotes').not.toContain('addi t1, x0, 7');
  });

  it('prints the unit table operand cells by number', () => {
    expect(html, "`regCell`'s x-name reaches an Fi/Fj/Fk cell").toContain('>x6<');
  });

  it('names the register in the register grid, and only there', () => {
    expect(html, 'the grid cell carries the ABI name').toContain('>t1<');
    // The discriminator: `t1` must not be reachable from the OTHER two tables' spelling of it, or
    // the lessons' "only the register-result grid names them" is false in the markup.
    expect(count(html, '>t1<'), 'exactly one cell spells it that way').toBe(1);
  });
});
