/**
 * The pipeline map view (M3 step 7) — the drawing half of {@link buildPipelineMap}, in the same
 * two-halves shape as every datapath: `pipeline-map.ts` owns the pure fold and this file owns the
 * HTML and the hues. It is the textbook stage×cycle diagram, live: **rows are instructions, columns
 * are cycles, each cell is the stage that instruction occupied that cycle.**
 *
 * HTML, not SVG (pinned) — the surface is tabular, needs to scroll, and every cell is a click
 * target; a CSS grid of chips gets all three from the platform, where an SVG would hand-roll them.
 *
 * **What the reader is meant to SEE, in order of why the surface exists:**
 *   - **The staircase** — five rows overlapping in one column. Every prior surface could only show
 *     one instruction (the datapath lights a cycle; the transport names the retiring one). This is
 *     the only place the pipe is visible as a whole, which is the misconception this tier exists to
 *     break: a pipeline is not a slow single-cycle.
 *   - **A stall as a repeated cell** (`IF ID ID EX`) and **a flush as a cut row** — both fall out of
 *     the fold with no special case, because a stall IS an instruction sitting in one stage twice
 *     and a bubble is a null latch that never enters `instructions[]`.
 *   - **The toggle, as a shape.** Forwarding off makes the bubbles longer and the staircase more
 *     ragged. Step 3 measured that as cycle counts; here it is a picture.
 *
 * Like the fold, this carries NO model knowledge: hues come from each cell's stage FAMILY, so a
 * deeper pipeline or a superscalar lands with no change here (`IF1`/`IF2` both wear the fetch hue
 * and stay legible by their cell text). A family this palette has no hue for renders in the neutral
 * accent rather than being guessed at.
 */

import type { CycleTrace } from '@cpu-viz/trace';
import { Fragment, useEffect, useMemo, useRef } from 'react';
import { formatInstruction } from './format';
import { buildPipelineMap, firstRowAt } from './pipeline-map';
import { MONO, PHASE_COLORS, T } from './theme';

/** Column width. Sized for the widest stage text we draw (`MEM`) at the grid's font size — the
 *  relief rule means a cell must always fit its label, so the text sets the width, not the hue. */
const CELL_W = 30;
const ROW_H = 19;
const HEAD_H = 18;
const LABEL_W = 190;
/** How close the playhead may drift to an edge before the view re-centres on it — the "comfortable
 *  window". Big enough that a step never lands on the boundary, small enough that stepping through a
 *  run does not re-centre on every cycle. */
const MARGIN = 90;

export function PipelineMap(props: {
  /** The WHOLE recording — the map is the first surface that folds the entire timeline rather than
   *  being a pure function of the cursor's cycle. */
  recorded: readonly CycleTrace[];
  /** Timeline position (-1 = pre-run), drawn as the playhead. */
  cursor: number;
  /** The followed instruction's stable id (INV-4), or `null`. */
  followed: string | null;
  onFollow: (id: string | null) => void;
  onSeek: (cycle: number) => void;
}): React.JSX.Element {
  const { recorded, cursor, followed, onFollow, onSeek } = props;
  const map = useMemo(() => buildPipelineMap(recorded), [recorded]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const followedRow = followed === null ? null : (map.rows.find((r) => r.id === followed) ?? null);

  // Keep the playhead and the action in view while scrubbing. Two decisions here, both found by the
  // browser eyeball rather than by any test:
  //
  //   - Set `scrollLeft`/`scrollTop` directly rather than call `scrollIntoView`, which also scrolls
  //     the PAGE to reach the element — the map must never yank the window out from under the user.
  //   - When the playhead leaves the comfortable window, RE-CENTRE it rather than scroll the
  //     minimum distance. A minimum scroll is what "keep it visible" naively means, and it pins the
  //     playhead flush against the trailing edge: technically in view, but with the next cycles —
  //     the ones you are scrubbing TOWARDS — permanently off-screen, which is most of what you want
  //     to see. The margin is what stops a re-centre firing on every single-cycle step.
  const keepInView = (
    pos: number,
    start: number,
    viewport: number,
    lead: number,
  ): number | null => {
    const lo = start + lead;
    const hi = start + viewport;
    if (pos >= lo + MARGIN && pos + CELL_W <= hi - MARGIN) return null; // comfortably inside
    return Math.max(0, pos - lead - (viewport - lead) / 2);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || cursor < 0) return;

    const x = keepInView(LABEL_W + cursor * CELL_W, el.scrollLeft, el.clientWidth, LABEL_W);
    if (x !== null) el.scrollLeft = x;

    // Rows are in fetch order and an instruction's cells are contiguous, so the band in flight at
    // any cycle is contiguous too: centring its oldest row keeps the whole pipe on screen, with the
    // instructions it is about to reach visible below it.
    const row = firstRowAt(map, cursor);
    if (row < 0) return;
    const y = keepInView(HEAD_H + row * ROW_H, el.scrollTop, el.clientHeight, HEAD_H);
    if (y !== null) el.scrollTop = y;
  }, [cursor, map]);

  return (
    <section className="panel" style={{ marginTop: '1rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '1rem',
          flexWrap: 'wrap',
          marginBottom: '0.4rem',
        }}
      >
        <h2 className="panel-heading" style={{ margin: 0 }}>
          Pipeline map
        </h2>
        <span style={{ fontSize: '0.75rem', color: T.ink3 }}>
          rows are instructions · columns are cycles · click a cell to follow one
        </span>
        {followedRow ? (
          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.78rem',
            }}
          >
            <span style={{ color: T.ink2 }}>
              Following{' '}
              <code style={{ fontFamily: MONO, color: T.ink }}>
                {formatInstruction(followedRow.decoded)}
              </code>
            </span>
            <button className="btn" style={{ fontSize: '0.75rem' }} onClick={() => onFollow(null)}>
              ✕ clear
            </button>
          </div>
        ) : null}
      </div>

      <div className="pmap-scroll" ref={scrollRef}>
        <div
          className="pmap-grid"
          role="grid"
          aria-label="Pipeline map: instructions by cycle"
          style={{
            gridTemplateColumns: `${LABEL_W}px repeat(${map.cycles}, ${CELL_W}px)`,
            gridTemplateRows: `${HEAD_H}px repeat(${map.rows.length}, ${ROW_H}px)`,
          }}
        >
          <div className="pmap-corner" style={{ gridColumn: 1, gridRow: 1 }} />

          {/* The cycle ruler — also the coarse scrub: clicking a column number seeks to it. */}
          {Array.from({ length: map.cycles }, (_, c) => (
            <button
              key={`h${c}`}
              className={c === cursor ? 'pmap-head pmap-head--now' : 'pmap-head'}
              style={{ gridColumn: c + 2, gridRow: 1 }}
              onClick={() => onSeek(c)}
              title={`Scrub to cycle ${c}`}
            >
              {c}
            </button>
          ))}

          {map.rows.map((row, i) => {
            const isFollowed = row.id === followed;
            const last = row.cells[row.cells.length - 1];
            return (
              <Fragment key={row.id}>
                <div
                  className={isFollowed ? 'pmap-label pmap-label--follow' : 'pmap-label'}
                  style={{ gridColumn: 1, gridRow: i + 2 }}
                  title={`pc ${row.pc}${row.sourceLine === null ? '' : ` · line ${row.sourceLine}`}`}
                >
                  <span style={{ color: T.ink3 }}>{row.pc}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {formatInstruction(row.decoded)}
                  </span>
                </div>

                {row.cells.map((cell) => {
                  const hue = PHASE_COLORS[cell.family] ?? T.accent;
                  const cls = [
                    'pmap-cell',
                    row.killedBy ? 'pmap-cell--killed' : '',
                    isFollowed ? 'follow-ring' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <button
                      key={cell.cycle}
                      className={cls}
                      // The hue is the stage FAMILY's — see the module docs. Set as a custom
                      // property so the cell's border/fill/underline all derive from one value.
                      style={
                        {
                          gridColumn: cell.cycle + 2,
                          gridRow: i + 2,
                          '--cell-hue': hue,
                        } as React.CSSProperties
                      }
                      // Click = follow this instruction AND go to this cycle. The cell names both,
                      // so honoring only one of them would throw away half of what was clicked;
                      // clicking the instruction you are already following clears it.
                      onClick={() => {
                        onFollow(isFollowed ? null : row.id);
                        onSeek(cell.cycle);
                      }}
                      aria-pressed={isFollowed}
                      title={`${formatInstruction(row.decoded)} — ${cell.location} at cycle ${cell.cycle}`}
                    >
                      {cell.location}
                    </button>
                  );
                })}

                {/* The kill marker, in the column AFTER the last cell it reached: the instruction is
                    not there any more, and that absence is the point. Omitted if it died on the
                    final recorded cycle (there is no next column to put it in). */}
                {row.killedBy && last && last.cycle + 1 < map.cycles ? (
                  <span
                    className="pmap-kill"
                    style={{ gridColumn: last.cycle + 3, gridRow: i + 2 }}
                    title={`Flushed (${row.killedBy}) — the pipeline fetched it, then threw it away`}
                  >
                    ✕
                  </span>
                ) : null}
              </Fragment>
            );
          })}

          {cursor >= 0 ? (
            <div className="pmap-cursor" style={{ gridColumn: cursor + 2, gridRow: '1 / -1' }} />
          ) : null}
        </div>
      </div>

      {/* The legend is DERIVED: one swatch per stage family the recording actually contains, in
          first-seen order. Never a hard-coded five — a deeper or wider model gets its own key. */}
      <div className="dp-legend">
        {map.families.map((f) => (
          <span key={f}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: 2,
                verticalAlign: 'middle',
                marginRight: 5,
                background: PHASE_COLORS[f] ?? T.accent,
              }}
            />
            {f}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', color: T.ink3 }}>
          repeated cell = stall · <span style={{ color: T.danger }}>✕</span> = flushed
        </span>
      </div>
    </section>
  );
}
