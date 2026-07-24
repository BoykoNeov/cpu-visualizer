/**
 * The micro-structure tables (M9 step 6) — the OUT-OF-ORDER tier's star surface, and the deliverable
 * `superscalar-visuals.md` §3 designed and deferred to this milestone. Three HTML tables, each a pure
 * fold over `state.micro` at the cursor (INV-3), rendered in the `panels.tsx` idiom (`.panel`, mono
 * font, the `--highlight` wash on a followed row) rather than SVG — HTML wins for tabular data and
 * rows carry the follow-highlight naturally.
 *
 * ## The three tables, and why the RS one is a PROJECTION
 *
 *  1. **Reorder buffer** — the in-flight window as an in-order queue, HEAD (next to retire) marked,
 *     each entry's state (waiting → executing → completed). This is the spine: watch it commit in
 *     program order while entries below it complete out of order.
 *  2. **Reservation stations** — there is NO separate RS structure in the engine. Classic speculative
 *     Tomasulo holds operand values in the ROB itself, so a `'waiting'` ROB entry IS the
 *     reservation-station-equivalent (`rob.ts`). This table is therefore the not-yet-issued subset of
 *     the ROB, showing each source operand as a captured VALUE or the `ROB#tag` it is still waiting
 *     on — the wakeup/select picture. Do not hunt for an RS file; there isn't one, by design.
 *  3. **Rename map** — the architectural registers currently pointing at an in-flight tag (WAR/WAW
 *     gone by construction). Only the renamed regs are listed; everything else reads its committed
 *     value straight from the register panel.
 *
 * ## Follow-highlight composes across all three (and the map, and the datapath)
 *
 * The same token every other surface uses — `dp--follow` + the `--highlight` wash — lights the
 * followed instruction's ROB row, its RS row, AND the rename-map row(s) whose tag it owns. That
 * cross-surface composition is the click-only defect class the browser eyeball verifies (no headless
 * test here can see a click — `renderToStaticMarkup`, no jsdom). Rows are themselves follow targets,
 * exactly like the map's cells, so a reader can pick an instruction on whichever surface they are
 * looking at.
 *
 * ## Not gated on the depth dial — a conscious non-choice
 *
 * This panel renders identically at every depth tier, matching the register/memory STATE-panel
 * precedent (those don't gate on tier either): the tables ARE the tier's picture, so hiding them at a
 * lower tier would leave the out-of-order model with nothing. `superscalar-visuals.md` §3 once mused
 * about expert-tier scoreboard contents, but the M9 plan is authoritative and does not ask for
 * tier-gating here. (The DATAPATH, step 7, is the surface that will obey the dial.)
 */

import type { CycleTrace } from '@cpu-viz/trace';
import type { OperandView, OutOfOrderMicro, RobEntryView } from '@cpu-viz/engine-out-of-order';
import { useMemo } from 'react';
import { ABI_REGISTER_NAMES, formatInstruction, hex32 } from './format';
import { MONO, T } from './theme';

const mono = { fontFamily: MONO } as const;

// --- Stable-height reservation (kills the per-step twitch) -----------------------------------
//
// Each of the three tables grows and shrinks as the cursor moves — the ROB fills and drains, the
// waiting subset comes and goes, registers rename and commit. Left alone, the whole panel changes
// HEIGHT every cycle and shoves the datapath below it up and down as the reader steps, which reads as
// twitching. So each table RESERVES the tallest it ever gets over the whole recording (`runToEnd`
// records it all up front, so this max is fixed for the run) and holds that height regardless of the
// cursor's count. No headless test can see a height (`renderToStaticMarkup`, no jsdom), so this is a
// browser-verified fix, like the map's follow-readout reserve.
//
// The ROB spine is reserved to its full `robCapacity`, not the peak occupancy actually seen: the
// user wants the out-of-order structures panel to read as ALWAYS EXPANDED — a fully-present
// structure at every cursor — rather than shrinking to a couple of rows for a program that never
// fills the buffer. (This deliberately reverses the earlier "reserve max-seen so a small program
// leaves no tall empty panel" call.) The waiting/rename tables stay peak-seen — their empty rows
// would be pure whitespace, and the ROB's full height already gives the panel its expanded shape.

/** A data row's pinned height, and a header row's — pinned so the reserve below is px-exact rather
 *  than a font-metric estimate that would drift a pixel and re-introduce a small jitter. */
const MICRO_ROW_H = 20;
const MICRO_HEAD_H = 18;

/** Reserve for a table WITH a header row (ROB, reservation stations): its header plus `rows` data
 *  rows. Zero rows means the table never appears — reserve a single line for the empty message. */
function headedReserve(rows: number): number {
  return rows > 0 ? MICRO_HEAD_H + rows * MICRO_ROW_H : MICRO_ROW_H;
}

/** Reserve for the header-LESS rename table (a bare `<tbody>`): just its `rows`, or a line for empty. */
function bareReserve(rows: number): number {
  return rows > 0 ? rows * MICRO_ROW_H : MICRO_ROW_H;
}

/** The heights to reserve: the ROB at its full capacity (always-expanded), the waiting/rename
 *  tables at their peak occupancy across the WHOLE recording. */
function microReserves(recording: readonly CycleTrace[]): {
  rob: number;
  waiting: number;
  rename: number;
} {
  let rob = 0;
  let waiting = 0;
  let rename = 0;
  for (const trace of recording) {
    const m = oooMicro(trace);
    if (m === null) continue;
    // Full capacity, not `m.rob.length` — the ROB table holds its whole depth so the panel stays
    // expanded even when only a few entries are in flight.
    rob = Math.max(rob, m.robCapacity);
    waiting = Math.max(waiting, m.rob.filter((e) => e.state === 'waiting').length);
    rename = Math.max(rename, m.rename.filter((s) => s.kind === 'pending').length);
  }
  return { rob, waiting, rename };
}

/** The out-of-order micro shape, or null for any other model's trace — the gate is a TRACE fact. */
function oooMicro(trace: CycleTrace | null): OutOfOrderMicro | null {
  const m = trace?.state.micro as Partial<OutOfOrderMicro> | undefined;
  return Array.isArray(m?.rob) ? (m as OutOfOrderMicro) : null;
}

/** Does this recording ever carry an out-of-order `micro`? The App-level gate for the whole panel. */
export function hasMicroTables(recording: readonly CycleTrace[]): boolean {
  return recording.some((t) =>
    Array.isArray((t.state.micro as { rob?: unknown } | undefined)?.rob),
  );
}

/**
 * The user-facing state word for a ROB entry, collapsing the engine's five-state machine to the
 * three the reader needs. `'awaitingMem'` is a load/store executing in the memory unit and
 * `'executing'` is a slow (`slowOpLatency`) op still in its functional unit — both read as
 * "executing"; `'executed'`/`'completed'` both mean the value exists (the one-cycle pass-through
 * difference between them is a timing artifact, not a distinction worth a separate word).
 */
function stateView(state: RobEntryView['state']): { label: string; hue: string } {
  switch (state) {
    case 'waiting':
      return { label: 'waiting', hue: T.ink3 };
    case 'awaitingMem':
    case 'executing':
      return { label: 'executing', hue: T.accent };
    case 'executed':
    case 'completed':
      return { label: 'completed', hue: T.monoGreen };
  }
}

export function MicroTablePanel(props: {
  /** The trace at the cursor. Non-OoO recordings (and pre-run) fold to null — the panel vanishes. */
  trace: CycleTrace | null;
  /** The WHOLE recording — read only to reserve each table's peak height so the panel does not resize
   *  as the cursor moves (see {@link microReserves}). Trace data, not an engine back door (INV-3),
   *  exactly as the pipeline map already takes it. */
  recording: readonly CycleTrace[];
  /** The followed instruction id, so a followed row reads the same here as on every other surface. */
  followed: string | null;
  /** Toggle-follow when a row is clicked (same affordance as the map's cells). */
  onFollow: (id: string | null) => void;
}): React.JSX.Element | null {
  const { trace, recording, followed, onFollow } = props;
  const reserves = useMemo(() => microReserves(recording), [recording]);
  const micro = oooMicro(trace);
  if (micro === null) return null;

  // The tag the followed instruction currently owns — for lighting its rename-map row(s). A
  // followed id not in flight this cycle owns no tag, so nothing lights, which is correct.
  const followedTag = micro.rob.find((e) => e.id === followed)?.tag ?? null;

  const toggle = (id: string): void => onFollow(followed === id ? null : id);

  return (
    <section className="panel" aria-label="Out-of-order structures">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h2 className="panel-heading" style={{ margin: 0 }}>
          Out-of-order structures
        </h2>
        <span style={{ fontSize: '0.75rem', color: T.ink3 }}>
          the reorder buffer commits in program order while execution completes out of order — click
          a row to follow an instruction
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2.4fr) minmax(0, 1fr)',
          gap: '1rem',
          marginTop: '0.6rem',
          alignItems: 'start',
        }}
      >
        {/* The ROB spans a wider column (it carries the instruction text); the rename map is narrow. */}
        <RobTable micro={micro} reserve={reserves.rob} followed={followed} onToggle={toggle} />
        <RenameTableView
          micro={micro}
          reserve={reserves.rename}
          followedTag={followedTag}
          followed={followed}
          onToggle={toggle}
        />
      </div>

      <ReservationStations
        micro={micro}
        reserve={reserves.waiting}
        followed={followed}
        onToggle={toggle}
      />
    </section>
  );
}

/** Shared row props for the follow-highlight + click-to-follow behaviour. */
function rowStyle(isFollowed: boolean): React.CSSProperties {
  return {
    cursor: 'pointer',
    background: isFollowed ? T.highlight : undefined,
  };
}

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

function RobTable(props: {
  micro: OutOfOrderMicro;
  reserve: number;
  followed: string | null;
  onToggle: (id: string) => void;
}): React.JSX.Element {
  const { micro, reserve, followed, onToggle } = props;
  const headTag = micro.rob[0]?.tag ?? null;
  return (
    <div>
      <h3 style={subheadStyle}>
        Reorder buffer{' '}
        <span style={{ color: T.ink3, fontWeight: 400 }}>
          {micro.rob.length}/{micro.robCapacity} in flight
        </span>
      </h3>
      <div style={{ minHeight: headedReserve(reserve) }}>
        {micro.rob.length === 0 ? (
          <p style={emptyStyle}>empty — nothing in flight</p>
        ) : (
          <table
            style={{ ...mono, borderCollapse: 'collapse', fontSize: '0.76rem', width: '100%' }}
          >
            <thead>
              <tr style={{ height: MICRO_HEAD_H }}>
                <th style={th}></th>
                <th style={th}>tag</th>
                <th style={th}>instruction</th>
                <th style={th}>dest</th>
                <th style={th}>state</th>
                <th style={{ ...th, textAlign: 'right' }}>value</th>
              </tr>
            </thead>
            <tbody>
              {micro.rob.map((e) => {
                const sv = stateView(e.state);
                const isHead = e.tag === headTag;
                const committing = isHead && (e.state === 'completed' || e.state === 'executed');
                return (
                  <tr
                    key={e.tag}
                    className={followed === e.id ? 'dp--follow' : undefined}
                    style={{ ...rowStyle(followed === e.id), height: MICRO_ROW_H }}
                    onClick={() => onToggle(e.id)}
                    title={`ROB#${e.tag} — ${formatInstruction(e.decoded)} · click to follow`}
                  >
                    {/* HEAD marker: the entry next to retire, so "commits in order" has an anchor. */}
                    <td style={{ ...td, color: T.accent, fontSize: '0.66rem' }}>
                      {isHead ? '▶' : ''}
                    </td>
                    <td style={{ ...td, color: T.ink2 }}>ROB#{e.tag}</td>
                    <td style={{ ...td, color: T.ink, whiteSpace: 'nowrap' }}>
                      {formatInstruction(e.decoded)}
                    </td>
                    <td style={{ ...td, color: T.ink3 }}>
                      {e.rd === 0 ? '—' : ABI_REGISTER_NAMES[e.rd]}
                    </td>
                    <td style={{ ...td, color: sv.hue }}>
                      {sv.label}
                      {committing ? <span style={{ color: T.accent }}> · commits</span> : null}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: T.ink2 }}>
                      {e.value === null ? '—' : hex32(e.value)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * The reservation stations — the `'waiting'` (dispatched-but-not-issued) subset of the ROB, showing
 * why each is parked: an operand it is still waiting on (`ROB#tag`), or both ready and merely queued
 * for a free functional unit.
 */
function ReservationStations(props: {
  micro: OutOfOrderMicro;
  reserve: number;
  followed: string | null;
  onToggle: (id: string) => void;
}): React.JSX.Element {
  const { micro, reserve, followed, onToggle } = props;
  const waiting = micro.rob.filter((e) => e.state === 'waiting');
  return (
    <div style={{ marginTop: '0.8rem' }}>
      <h3 style={subheadStyle}>
        Reservation stations{' '}
        <span style={{ color: T.ink3, fontWeight: 400 }}>
          dispatched, waiting to issue ({waiting.length})
        </span>
      </h3>
      <div style={{ minHeight: headedReserve(reserve) }}>
        {waiting.length === 0 ? (
          <p style={emptyStyle}>none — every in-flight instruction has already issued</p>
        ) : (
          <table
            style={{ ...mono, borderCollapse: 'collapse', fontSize: '0.76rem', width: '100%' }}
          >
            <thead>
              <tr style={{ height: MICRO_HEAD_H }}>
                <th style={th}>tag</th>
                <th style={th}>instruction</th>
                <th style={th}>operand A</th>
                <th style={th}>operand B</th>
                <th style={th}>ready?</th>
              </tr>
            </thead>
            <tbody>
              {waiting.map((e) => {
                const ready = operandReady(e.srcA) && operandReady(e.srcB);
                return (
                  <tr
                    key={e.tag}
                    className={followed === e.id ? 'dp--follow' : undefined}
                    style={{ ...rowStyle(followed === e.id), height: MICRO_ROW_H }}
                    onClick={() => onToggle(e.id)}
                    title={`ROB#${e.tag} — click to follow`}
                  >
                    <td style={{ ...td, color: T.ink2 }}>ROB#{e.tag}</td>
                    <td style={{ ...td, color: T.ink, whiteSpace: 'nowrap' }}>
                      {formatInstruction(e.decoded)}
                    </td>
                    <td style={td}>
                      <Operand op={e.srcA} />
                    </td>
                    <td style={td}>
                      <Operand op={e.srcB} />
                    </td>
                    <td style={{ ...td, color: ready ? T.monoGreen : T.monoAmber }}>
                      {ready ? 'ready →' : 'waiting'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** An operand with no source register (a `null` slot) counts as ready — it is not being waited on. */
function operandReady(op: OperandView | null): boolean {
  return op === null || op.ready;
}

/** One operand cell: a captured value (green) or the `ROB#tag` it is waiting on (amber). */
function Operand({ op }: { op: OperandView | null }): React.JSX.Element {
  if (op === null) return <span style={{ color: T.ink3 }}>—</span>;
  if (op.ready) return <span style={{ color: T.monoGreen }}>{hex32(op.value)}</span>;
  return <span style={{ color: T.monoAmber }}>⤺ ROB#{op.tag}</span>;
}

/**
 * The rename map: the architectural registers whose current value is an IN-FLIGHT tag rather than
 * the committed one. Listing only the renamed regs is the point — a full 32-row table would bury the
 * handful that are actually renamed, which is exactly the WAR/WAW-gone story this table tells.
 */
function RenameTableView(props: {
  micro: OutOfOrderMicro;
  reserve: number;
  followedTag: number | null;
  followed: string | null;
  onToggle: (id: string) => void;
}): React.JSX.Element {
  const { micro, reserve, followedTag, followed, onToggle } = props;
  // (reg index, tag) for every architectural register currently pointing at an in-flight tag.
  const pending = micro.rename
    .map((slot, reg) => ({ reg, slot }))
    .filter(
      (r): r is { reg: number; slot: { kind: 'pending'; tag: number } } =>
        r.slot.kind === 'pending',
    );

  // The id that produces a given tag (its ROB entry) — so clicking a rename row follows that
  // instruction, and so the row can join the follow-highlight the ROB/RS rows already carry.
  const idForTag = (tag: number): string | null => micro.rob.find((e) => e.tag === tag)?.id ?? null;

  return (
    <div>
      <h3 style={subheadStyle}>
        Rename map <span style={{ color: T.ink3, fontWeight: 400 }}>arch reg → in-flight tag</span>
      </h3>
      <div style={{ minHeight: bareReserve(reserve) }}>
        {pending.length === 0 ? (
          <p style={emptyStyle}>no register renamed — all committed</p>
        ) : (
          <table
            style={{ ...mono, borderCollapse: 'collapse', fontSize: '0.76rem', width: '100%' }}
          >
            <tbody>
              {pending.map(({ reg, slot }) => {
                const id = idForTag(slot.tag);
                const isFollowed = followedTag === slot.tag || (id !== null && followed === id);
                return (
                  <tr
                    key={reg}
                    className={isFollowed ? 'dp--follow' : undefined}
                    style={{ ...rowStyle(isFollowed), height: MICRO_ROW_H }}
                    onClick={() => (id !== null ? onToggle(id) : undefined)}
                    title={id !== null ? 'click to follow the producing instruction' : undefined}
                  >
                    <td style={{ ...td, color: T.ink }}>{ABI_REGISTER_NAMES[reg]}</td>
                    <td style={{ ...td, color: T.ink3 }}>x{reg}</td>
                    <td style={{ ...td, color: T.accent }}>→ ROB#{slot.tag}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p style={{ ...emptyStyle, marginTop: '0.4rem' }}>
        every other register reads its committed value (the register panel).
      </p>
    </div>
  );
}

const subheadStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: T.ink,
  margin: '0 0 0.35rem',
  fontWeight: 700,
};

const emptyStyle: React.CSSProperties = {
  ...mono,
  fontSize: '0.75rem',
  color: T.ink3,
  margin: 0,
};
