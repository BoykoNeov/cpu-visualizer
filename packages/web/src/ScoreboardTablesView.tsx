/**
 * The scoreboard's three status tables (M15 step 7) — the DRAWING half. Every decision about what
 * the tables contain lives in `scoreboard-tables.ts`, which is pure and headlessly tested; this
 * file owns geometry, hue and the click affordance and nothing else.
 *
 * Rendered as HTML tables in the `panels.tsx` idiom rather than SVG, following `MicroTablePanel`:
 * HTML wins for tabular data, and rows carry the follow-highlight naturally. This model's `datapath`
 * stays `'none'` (plan decision 9 — no wire diagram this milestone) precisely because THIS is its
 * canonical picture.
 *
 * ## Why this panel needs no measured height reserve, unlike every other tabular surface here
 *
 * `MicroTablePanel`'s three tables each scan the whole recording for a peak row count, because the
 * ROB fills and drains as the cursor moves. All three tables here are **fixed by construction**
 * instead:
 *
 *  - instruction status draws at most `INSTRUCTION_WINDOW` rows, a cap rather than a measurement;
 *  - functional-unit status is always the three units, idle rows included — the table is the
 *    MACHINE, not the program;
 *  - register-result is always all thirty-two registers, which is the textbook's own geometry and
 *    is also why it is not drawn as the claimed-only list the rename map one model over uses.
 *
 * ⚠ **That is a claim about the ROWS, and a panel is not only its rows.** The predictor table
 * shipped "its height is constant by construction" and a later browser pass measured it false OF
 * THE PANEL — the one cursor-dependent string lived in the header and WRAPPED at some widths, 33px
 * of jitter between 900px and 1180px. The two cursor-dependent strings here are therefore each
 * pinned to a single line box that cannot wrap ({@link NOWRAP}): the caption below the instruction
 * table, and the window's `showing the last N of M` count. `layout-stability.test.tsx` guards both.
 */

import { useMemo } from 'react';
import type { CycleTrace } from '@cpu-viz/trace';
import {
  INSTRUCTION_WINDOW,
  buildScoreboardTables,
  primaryStall,
  type ScoreboardInstructionRow,
  type ScoreboardRegisterClaim,
  type ScoreboardTablesView,
  type ScoreboardUnitRow,
} from './scoreboard-tables';
import { MONO, T } from './theme';

const mono = { fontFamily: MONO } as const;

/** Row and header heights, pinned so the instruction table's reserve is px-exact rather than a
 *  font-metric estimate that would drift a pixel and reintroduce a small jitter. */
const ROW_H = 20;
const HEAD_H = 18;

/**
 * The one-line box both cursor-dependent strings live in. `nowrap` is the load-bearing part: a
 * string that cannot wrap cannot change the panel's height, whatever the viewport does to its
 * width. The ellipsis is what makes that honest at a narrow viewport instead of clipping mid-word.
 */
const NOWRAP: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  height: ROW_H,
  lineHeight: `${ROW_H}px`,
};

const th: React.CSSProperties = {
  textAlign: 'left',
  color: T.ink3,
  fontWeight: 600,
  fontSize: '0.68rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  paddingRight: 10,
  paddingBottom: 3,
};

const td: React.CSSProperties = { paddingRight: 10, paddingTop: 1, paddingBottom: 1 };
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

const subheadStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: T.ink,
  margin: '0 0 0.35rem',
  fontWeight: 700,
};

const captionStyle: React.CSSProperties = {
  ...mono,
  fontSize: '0.72rem',
  color: T.ink3,
  margin: 0,
};

const tableStyle: React.CSSProperties = {
  ...mono,
  borderCollapse: 'collapse',
  fontSize: '0.76rem',
  width: '100%',
};

/** An empty cycle column reads as a dash, never as a blank — a blank cell and a zero look alike. */
function cell(value: number | null): string {
  return value === null ? '—' : String(value);
}

/**
 * A stall reason's hue. The two HAZARDS are amber because they are the milestone's subject and the
 * rare event on the surface; everything else is the muted ink the rest of the shell uses for
 * secondary text. Hue is never the sole carrier — every one of these cells prints its reason word.
 * No new token: both are already in `theme.ts`.
 */
function reasonHue(hazard: boolean): string {
  return hazard ? T.monoAmber : T.ink3;
}

export function ScoreboardTables(props: {
  /** The trace at the cursor. `null` at the pre-run cursor, where the fold still returns the
   *  complete EMPTY view so the panel keeps its height (see the fold's header, point 4). */
  trace: CycleTrace | null;
  /** The WHOLE recording — read for the accumulated cycle columns, the id → assembly join, and the
   *  panel's existence before the first cycle. Trace data, not an engine back door (INV-3). */
  recording: readonly CycleTrace[];
  /** The followed instruction id, so a followed row reads the same here as on every other surface. */
  followed: string | null;
  /** Toggle-follow when a row is clicked — the same affordance as the map's cells. */
  onFollow: (id: string | null) => void;
}): React.JSX.Element | null {
  const { trace, recording, followed, onFollow } = props;
  const view = useMemo(() => buildScoreboardTables(trace, recording), [trace, recording]);
  if (view === null) return null;

  const toggle = (id: string): void => onFollow(followed === id ? null : id);

  return (
    <section className="panel" aria-label="Scoreboard status tables">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h2 className="panel-heading" style={{ margin: 0 }}>
          Scoreboard status tables
        </h2>
        {/* Static by design: the header is the one place a cursor-dependent string must not go. */}
        <span style={{ fontSize: '0.75rem', color: T.ink3 }}>
          issue is in order into three units; completion is not — click a row to follow an
          instruction
        </span>
      </div>

      <InstructionStatus view={view} followed={followed} onToggle={toggle} />
      <StallCaption view={view} />
      <UnitStatus view={view} followed={followed} onToggle={toggle} />
      <RegisterResult view={view} followed={followed} onToggle={toggle} />
    </section>
  );
}

/**
 * The instruction status table — the textbook's four cycle columns, accumulated over the run and
 * capped at a trailing window. The write-result column reading out of order down the page is the
 * whole point of the surface; see the fold's header for why the live `micro` window cannot show it.
 */
function InstructionStatus(props: {
  view: ScoreboardTablesView;
  followed: string | null;
  onToggle: (id: string) => void;
}): React.JSX.Element {
  const { view, followed, onToggle } = props;
  return (
    <div style={{ marginTop: '0.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
        <h3 style={{ ...subheadStyle, margin: 0 }}>Instruction status</h3>
        {/* Cursor-dependent, so it gets its own unwrappable line box — see NOWRAP. The class is a
            marker `layout-stability.test.tsx` slices on; it carries no CSS. */}
        <span
          className="sb-window-note"
          style={{ ...captionStyle, ...NOWRAP, flex: '1 1 0', minWidth: 0 }}
        >
          {view.hidden > 0
            ? `the last ${view.instructions.length} of ${view.hidden + view.instructions.length} fetched`
            : `${view.instructions.length} fetched so far`}
        </span>
      </div>
      {/* Capped at INSTRUCTION_WINDOW rows, so this reserve is a constant rather than a scan of the
          recording — the table can never exceed it. */}
      <div style={{ minHeight: HEAD_H + INSTRUCTION_WINDOW * ROW_H }}>
        <table style={tableStyle}>
          <thead>
            <tr style={{ height: HEAD_H }}>
              <th style={th}>pc</th>
              <th style={th}>instruction</th>
              <th style={th}>unit</th>
              <th style={{ ...th, textAlign: 'right' }}>issue</th>
              <th style={{ ...th, textAlign: 'right' }}>read op</th>
              <th style={{ ...th, textAlign: 'right' }}>exec done</th>
              <th style={{ ...th, textAlign: 'right' }}>write</th>
              <th style={th}>stalled by</th>
            </tr>
          </thead>
          <tbody>
            {view.instructions.map((r) => (
              <InstructionRow key={r.id} row={r} followed={followed === r.id} onToggle={onToggle} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InstructionRow(props: {
  row: ScoreboardInstructionRow;
  followed: boolean;
  onToggle: (id: string) => void;
}): React.JSX.Element {
  const { row, followed, onToggle } = props;
  // A retired row stays on the table as history; only what is in the machine NOW reads at full
  // strength, so the reader can tell the window from the log at a glance.
  const ink = row.inFlight ? T.ink : T.ink3;
  return (
    <tr
      className={followed ? 'dp--follow' : undefined}
      style={{ height: ROW_H, cursor: 'pointer', background: followed ? T.highlight : undefined }}
      onClick={() => onToggle(row.id)}
      title={`${row.text} · click to follow`}
    >
      <td style={{ ...td, color: T.ink3 }}>{row.pc}</td>
      <td style={{ ...td, color: ink, whiteSpace: 'nowrap' }}>
        {row.text}
        {row.flushed ? <span style={{ color: T.ink3 }}> · flushed</span> : null}
      </td>
      <td style={{ ...td, color: T.ink3 }}>{row.unit ?? '—'}</td>
      <td style={{ ...num, color: ink }}>{cell(row.issue)}</td>
      <td style={{ ...num, color: ink }}>{cell(row.readOperands)}</td>
      <td style={{ ...num, color: ink }}>{cell(row.executeComplete)}</td>
      <td style={{ ...num, color: ink }}>{cell(row.writeResult)}</td>
      {/* The reason and the stage the ENGINE names. The stage is printed, never used as a position:
          an Issue stall says `ID` while the instruction is still sitting in `IF`. */}
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        {row.stalls.map((s, i) => (
          <span key={`${s.reason}-${i}`} style={{ color: reasonHue(s.hazard) }}>
            {i > 0 ? ' ' : ''}
            {s.reason} @{s.stage}
          </span>
        ))}
      </td>
    </tr>
  );
}

/**
 * The one caption that moves with the clock, in its own unwrappable line box. It explains ONE
 * stall — a hazard when there is one, see `primaryStall` — while every stall stays visible in its
 * own row's column. Always present, even on a quiet cycle: an element that disappears reserves
 * nothing, which is the same hole that dropped `MicroTablePanel` 526px.
 */
function StallCaption(props: { view: ScoreboardTablesView }): React.JSX.Element {
  const stall = primaryStall(props.view);
  return (
    <p className="sb-stall-caption" style={{ ...captionStyle, ...NOWRAP, marginTop: '0.3rem' }}>
      {stall === null ? (
        'no stall this cycle — everything that could advance did.'
      ) : (
        <>
          <span style={{ color: reasonHue(stall.hazard) }}>{stall.reason}</span>
          {` at ${stall.stage} — ${stall.explain}`}
        </>
      )}
    </p>
  );
}

/**
 * The functional-unit status table, in the textbook's own field names. Always three rows, idle ones
 * included: the table is the machine's inventory, and an idle `INT1` beside a `structural-int`
 * stall would be a contradiction worth seeing rather than hiding (it cannot happen — that is the
 * point of drawing it).
 */
function UnitStatus(props: {
  view: ScoreboardTablesView;
  followed: string | null;
  onToggle: (id: string) => void;
}): React.JSX.Element {
  const { view, followed, onToggle } = props;
  return (
    <div style={{ marginTop: '0.8rem' }}>
      <h3 style={subheadStyle}>
        Functional-unit status{' '}
        {/* Static: both numbers are derived from the engine's own latency constants, so this
            sentence cannot go stale against a re-derived timing table. Step 3 measured this
            turnaround as the DOMINANT cost on this machine — larger than either hazard — and the
            view is required to say so, or a wall of `structural-int` reads as a verdict on the
            reader's program rather than as the size of the machine. */}
        <span style={{ color: T.ink3, fontWeight: 400 }}>
          a unit is held from Issue to Write-Result — an integer unit turns around in{' '}
          {view.turnaround.int} cycles, the memory unit in {view.turnaround.mem}
        </span>
      </h3>
      <table style={tableStyle}>
        <thead>
          <tr style={{ height: HEAD_H }}>
            <th style={th}>unit</th>
            <th style={th}>busy</th>
            <th style={th}>op</th>
            <th style={th}>Fi</th>
            <th style={th}>Fj</th>
            <th style={th}>Fk</th>
            <th style={th}>Qj</th>
            <th style={th}>Qk</th>
            <th style={th}>Rj</th>
            <th style={th}>Rk</th>
            <th style={{ ...th, textAlign: 'right' }}>left</th>
          </tr>
        </thead>
        <tbody>
          {view.units.map((u) => (
            <UnitRow
              key={u.name}
              unit={u}
              followed={u.instr !== null && followed === u.instr}
              onToggle={onToggle}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A register operand cell: its ABI-free `x`-name, or a dash where the instruction has no such
 *  source. `x0` is a real answer here, not an absence, so it prints. */
function regCell(reg: number | null): string {
  return reg === null ? '—' : `x${reg}`;
}

/**
 * `Rj`/`Rk` — ready AND not yet read, the pair that carries the whole WAR check.
 *
 * ⚠ It can read `yes` in the very cycle a stall event says the operand could not be read, because
 * `micro` is snapshotted after the clock edge. Both are true, one cycle apart, and neither is a bug.
 */
function readyCell(busy: boolean, ready: boolean): React.JSX.Element {
  if (!busy) return <span style={{ color: T.ink3 }}>—</span>;
  return <span style={{ color: ready ? T.monoGreen : T.ink3 }}>{ready ? 'yes' : 'no'}</span>;
}

function UnitRow(props: {
  unit: ScoreboardUnitRow;
  followed: boolean;
  onToggle: (id: string) => void;
}): React.JSX.Element {
  const { unit, followed, onToggle } = props;
  const clickable = unit.instr !== null;
  return (
    <tr
      // `sb-unit-row` is a marker `layout-stability.test.tsx` counts on; it carries no CSS. The
      // unit NAMES cannot be counted instead — they also appear in the instruction table's unit
      // column and in every claimed register cell.
      className={followed ? 'sb-unit-row dp--follow' : 'sb-unit-row'}
      style={{
        height: ROW_H,
        cursor: clickable ? 'pointer' : 'default',
        background: followed ? T.highlight : undefined,
      }}
      onClick={() => (unit.instr !== null ? onToggle(unit.instr) : undefined)}
      title={unit.text === null ? `${unit.name} — idle` : `${unit.text} · click to follow`}
    >
      <td style={{ ...td, color: T.ink2 }}>{unit.name}</td>
      <td style={{ ...td, color: unit.busy ? T.ink : T.ink3 }}>{unit.busy ? 'yes' : 'no'}</td>
      <td style={{ ...td, color: unit.busy ? T.ink : T.ink3, whiteSpace: 'nowrap' }}>
        {unit.op ?? '—'}
        {unit.stalls.length > 0 ? (
          <span style={{ color: reasonHue(unit.stalls.some((s) => s.hazard)) }}>
            {' · '}
            {unit.stalls[0]!.reason}
          </span>
        ) : null}
      </td>
      <td style={{ ...td, color: T.ink }}>{regCell(unit.fi)}</td>
      <td style={{ ...td, color: T.ink2 }}>{regCell(unit.fj)}</td>
      <td style={{ ...td, color: T.ink2 }}>{regCell(unit.fk)}</td>
      <td style={{ ...td, color: T.ink3 }}>{unit.qj ?? '—'}</td>
      <td style={{ ...td, color: T.ink3 }}>{unit.qk ?? '—'}</td>
      <td style={td}>{readyCell(unit.busy, unit.rj)}</td>
      <td style={td}>{readyCell(unit.busy, unit.rk)}</td>
      <td style={{ ...num, color: T.ink3 }}>{cell(unit.remaining)}</td>
    </tr>
  );
}

/**
 * The register-result table: which unit, if any, has claimed the right to write each register.
 *
 * All thirty-two, in a fixed grid, deliberately — the textbook's third table IS the register file
 * with a unit written under the claimed entries, and drawing only the claimed subset (the rename
 * map's shape, one model over) would make the table's height move with the cursor for a peak of
 * three rows. The complete file is also what shows a reader that a claim is RARE, which is half of
 * why the two hazards are rare.
 */
function RegisterResult(props: {
  view: ScoreboardTablesView;
  followed: string | null;
  onToggle: (id: string) => void;
}): React.JSX.Element {
  const { view, followed, onToggle } = props;
  return (
    <div style={{ marginTop: '0.8rem' }}>
      <h3 style={subheadStyle}>
        Register result{' '}
        <span style={{ color: T.ink3, fontWeight: 400 }}>
          which unit will write each register — a claim is what the two hazards are about
        </span>
      </h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
          gap: '2px 8px',
          ...mono,
          fontSize: '0.72rem',
        }}
      >
        {view.registerResult.map((r) => (
          <RegisterCell
            key={r.reg}
            claim={r}
            followed={r.instr !== null && followed === r.instr}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

function RegisterCell(props: {
  claim: ScoreboardRegisterClaim;
  followed: boolean;
  onToggle: (id: string) => void;
}): React.JSX.Element {
  const { claim, followed, onToggle } = props;
  const claimed = claim.unit !== null;
  return (
    <div
      // `sb-reg-cell` is a marker the layout guard counts on (all thirty-two, at every cursor); it
      // carries no CSS.
      className={followed ? 'sb-reg-cell dp--follow' : 'sb-reg-cell'}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 4,
        height: ROW_H,
        lineHeight: `${ROW_H}px`,
        padding: '0 4px',
        borderRadius: 3,
        whiteSpace: 'nowrap',
        cursor: claim.instr === null ? 'default' : 'pointer',
        background: followed ? T.highlight : undefined,
      }}
      onClick={() => (claim.instr !== null ? onToggle(claim.instr) : undefined)}
      title={
        claimed
          ? `${claim.name} will be written by ${claim.unit}`
          : `${claim.name} — unclaimed, reads its committed value`
      }
    >
      <span style={{ color: claimed ? T.ink : T.ink3 }}>{claim.name}</span>
      <span style={{ color: claimed ? T.accent : T.ink3 }}>{claim.unit ?? '·'}</span>
    </div>
  );
}
