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

/**
 * The most cycles drawn at once. Beyond this the map pages, and says so.
 *
 * **This exists for the same reason `TEACHING_MAX_CYCLES` does, one layer down.** The engine cap
 * stops a runaway sandbox program from freezing the tab while RECORDING; without a cap here the map
 * would freeze it while DRAWING a recording the engine cap already judged fine. The grid declares
 * explicit tracks, so its layout cost is cycles × rows whether or not the cells are sparse: a
 * `li t0, 500` countdown — a trivial thing for a user to type — is already 3007 cycles × 2001 rows
 * ≈ **6 million grid areas and 2.2 MB of markup**, and the engine cap permits 16× more than that.
 *
 * 400 is chosen to be far above the whole corpus (`sum-loop`, the longest, is 78 cycles) so every
 * program we ship draws WHOLE and nothing about the teaching path changes — the paging is strictly
 * a sandbox affordance. And it pages rather than truncates: a silent cap would read as "this is the
 * run" while showing a fraction of it, so the header states the window and the total.
 */
const MAX_MAP_CYCLES = 400;

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

  // The drawn window (see {@link MAX_MAP_CYCLES}). Quantized to PAGES rather than centred on the
  // cursor: a window that recentred on every scrub would slide the whole grid under the reader on
  // every step, and a page boundary is a thing you can point at ("cycles 800–1199"). It is a pure
  // function of the cursor — no state to keep in sync, and the fold stays whole and oblivious
  // (INV-2, the same split as the datapath: `activate` lights everything, the view decides what to
  // draw). Below the threshold `lo`/`hi` degenerate to the whole run, so the corpus is untouched.
  const view = useMemo(() => {
    const paged = map.cycles > MAX_MAP_CYCLES;
    const lo = paged ? Math.floor(Math.max(cursor, 0) / MAX_MAP_CYCLES) * MAX_MAP_CYCLES : 0;
    const hi = paged ? Math.min(lo + MAX_MAP_CYCLES, map.cycles) : map.cycles;
    // A row belongs to the page if any of its life overlaps it — its cells are contiguous, so that
    // is just an interval overlap against its first and last.
    const rows = paged
      ? map.rows.filter(
          (r) =>
            r.cells.length > 0 &&
            r.cells[0]!.cycle < hi &&
            r.cells[r.cells.length - 1]!.cycle >= lo,
        )
      : map.rows;
    return { paged, lo, hi, cols: hi - lo, rows };
  }, [map, cursor]);

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

    const x = keepInView(
      LABEL_W + (cursor - view.lo) * CELL_W,
      el.scrollLeft,
      el.clientWidth,
      LABEL_W,
    );
    if (x !== null) el.scrollLeft = x;

    // Rows are in fetch order and an instruction's cells are contiguous, so the band in flight at
    // any cycle is contiguous too: centring its oldest row keeps the whole pipe on screen, with the
    // instructions it is about to reach visible below it. Indexed against the DRAWN rows, which on a
    // paged run are only the page's.
    const row = firstRowAt({ ...map, rows: view.rows }, cursor);
    if (row < 0) return;
    const y = keepInView(HEAD_H + row * ROW_H, el.scrollTop, el.clientHeight, HEAD_H);
    if (y !== null) el.scrollTop = y;
  }, [cursor, map, view]);

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
        {/* Never a silent cap: a truncated map would read as "this is the run" while showing a
            slice of it. Say which slice, and say what the whole is. */}
        {view.paged ? (
          <span
            style={{ fontSize: '0.75rem', color: T.ink2, fontFamily: MONO }}
            title={`This run is too long to draw at once (${map.cycles} cycles, ${map.rows.length} instructions). Showing one page; scrub the timeline to move it.`}
          >
            cycles {view.lo}–{view.hi - 1} of {map.cycles} · scrub to page
          </span>
        ) : null}
        {/* The follow readout, ALWAYS rendered and merely hidden when nothing is followed — the one
            way this map changes its own size, and it took a browser probe to find because no test
            can see a height.

            `✕ clear` is a button, and a button is ~12px taller than the text line beside it. Drawn
            conditionally, the header was 17px until you clicked a cell and 29px after, so the act of
            following an instruction grew the WHOLE MAP 315→327px and shoved the datapath and the
            panels down the page — at the exact moment the reader's eye is on the row they just
            picked. Reserving the space costs a strip of empty header; the alternative charges a jump
            for using the feature.

            Same mechanism as the narration stack in App: `visibility: hidden` holds the layout open
            and takes the control out of the tab order and the a11y tree on the way, so there is no
            unreachable button to tab into. Kept in flow rather than height-pinned with a magic number
            so the reserve stays derived — if the button's padding ever changes, the header follows.
            The label needs a placeholder for the hidden state; it is never read, only measured, and
            the BUTTON is what sets the height either way. */}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.78rem',
            visibility: followedRow ? 'visible' : 'hidden',
          }}
        >
          <span style={{ color: T.ink2 }}>
            Following{' '}
            <code style={{ fontFamily: MONO, color: T.ink }}>
              {followedRow ? formatInstruction(followedRow.decoded) : '—'}
            </code>
          </span>
          <button className="btn" style={{ fontSize: '0.75rem' }} onClick={() => onFollow(null)}>
            ✕ clear
          </button>
        </div>
      </div>

      <div className="pmap-scroll" ref={scrollRef}>
        <div
          className="pmap-grid"
          role="grid"
          aria-label="Pipeline map: instructions by cycle"
          style={{
            gridTemplateColumns: `${LABEL_W}px repeat(${view.cols}, ${CELL_W}px)`,
            gridTemplateRows: `${HEAD_H}px repeat(${view.rows.length}, ${ROW_H}px)`,
          }}
        >
          <div className="pmap-corner" style={{ gridColumn: 1, gridRow: 1 }} />

          {/* The cycle ruler — also the coarse scrub: clicking a column number seeks to it. Numbers
              are absolute cycles; only the COLUMN is page-relative. */}
          {Array.from({ length: view.cols }, (_, i) => view.lo + i).map((c) => (
            <button
              key={`h${c}`}
              className={c === cursor ? 'pmap-head pmap-head--now' : 'pmap-head'}
              style={{ gridColumn: c - view.lo + 2, gridRow: 1 }}
              onClick={() => onSeek(c)}
              title={`Scrub to cycle ${c}`}
            >
              {c}
            </button>
          ))}

          {view.rows.map((row, i) => {
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

                {/* Only the page's cells reach the DOM — a row that straddles a page boundary is
                    drawn for the part of its life on this page, which is what bounds the node count
                    as well as the track count. */}
                {row.cells.map((cell) => {
                  if (cell.cycle < view.lo || cell.cycle >= view.hi) return null;
                  const hue = PHASE_COLORS[cell.family] ?? T.accent;
                  const cls = [
                    'pmap-cell',
                    row.killedBy ? 'pmap-cell--killed' : '',
                    isFollowed ? 'follow-ring' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  // The two speculative ACTIONS, on the row of the instruction that took them —
                  // the same pair the datapath draws as its two redirects (step 5). The map was
                  // victim-centric before this: it could only draw prediction's COST, so a penalty
                  // that killed nobody was invisible (`call-return`'s `ret` — see {@link MapCell}).
                  //
                  // Both are drawn when both are set, rather than one taking precedence. In this
                  // pipeline they cannot collide (the bet is placed in ID and the answer arrives in
                  // EX, a cycle apart), but a precedence rule would be a silent choice about a case
                  // its author could not reach — and dropping a mark is exactly the blindness this
                  // step exists to fix.
                  const marks = [
                    cell.bet
                      ? ({
                          key: 'bet',
                          glyph: '?',
                          title:
                            'Bet — the predictor redirected fetch to a guessed target, before the answer existed',
                        } as const)
                      : null,
                    cell.mispredicted
                      ? ({
                          key: 'wrong',
                          glyph: '!',
                          title:
                            'Mispredicted — it resolved the other way, so EX redirected fetch. Every instruction on the wrong path is thrown away.',
                        } as const)
                      : null,
                  ].filter((m) => m !== null);
                  return (
                    <button
                      key={cell.cycle}
                      className={cls}
                      // The hue is the stage FAMILY's — see the module docs. Set as a custom
                      // property so the cell's border/fill/underline all derive from one value.
                      style={
                        {
                          gridColumn: cell.cycle - view.lo + 2,
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
                      title={[
                        `${formatInstruction(row.decoded)} — ${cell.location} at cycle ${cell.cycle}`,
                        ...marks.map((m) => m.title),
                      ].join('\n')}
                    >
                      {cell.location}
                      {marks.map((m) => (
                        <span key={m.key} className={`pmap-mark pmap-mark--${m.key}`} aria-hidden>
                          {m.glyph}
                        </span>
                      ))}
                    </button>
                  );
                })}

                {/* The kill marker, in the column AFTER the last cell it reached: the instruction is
                    not there any more, and that absence is the point. Omitted if it died on the
                    final recorded cycle (there is no next column to put it in). */}
                {row.killedBy && last && last.cycle + 1 < view.hi ? (
                  <span
                    className="pmap-kill"
                    style={{ gridColumn: last.cycle - view.lo + 3, gridRow: i + 2 }}
                    title={`Flushed (${row.killedBy}) — the pipeline fetched it, then threw it away`}
                  >
                    ✕
                  </span>
                ) : null}
              </Fragment>
            );
          })}

          {cursor >= view.lo && cursor < view.hi ? (
            <div
              className="pmap-cursor"
              style={{ gridColumn: cursor - view.lo + 2, gridRow: '1 / -1' }}
            />
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
        {/* The relief rule reaches the marks: a glyph with no key is a puzzle.

            The keys are STATIC while the hue swatches above are DERIVED, and that is a chosen
            tradeoff rather than an oversight — the two halves answer different questions. A swatch
            says "this recording contains this stage"; a key says "this is what the symbol means".
            Note the precedent does not settle it: `✕ = flushed` is keyed on a run with no flushes,
            but that is DIDN'T-happen, whereas `? = bet` under predict-not-taken is CAN'T-happen —
            the scheme performs no action at ID, ever. Deriving the glyph keys would fix that and
            cost more than it buys: the legend's width would change on every toggle of a control
            sitting right beside it, so the surface would twitch each time the reader flips the
            thing they are trying to compare. A key to a symbol you have not met yet is a reference;
            a legend that moves under you is a distraction. */}
        <span style={{ marginLeft: 'auto', color: T.ink3 }}>
          repeated cell = stall · <span className="pmap-mark pmap-mark--bet">?</span> = bet ·{' '}
          <span className="pmap-mark pmap-mark--wrong">!</span> = mispredicted ·{' '}
          <span style={{ color: T.danger }}>✕</span> = flushed
        </span>
      </div>
    </section>
  );
}
