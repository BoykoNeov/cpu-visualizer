/**
 * The branch-predictor table view (dynamic-branch-prediction step 6) — the drawing half of
 * {@link buildPredictorTable}, in the same two-halves shape as the cache grid: `predictor-table.ts`
 * owns the pure fold and this file owns the HTML and the hues. It is **the predictor's memory made
 * visible: one row per counter, showing what that counter would bet right now, which branch owns
 * it, and the row a branch just trained.**
 *
 * HTML, not SVG, for the cache grid's pinned reasons: the surface is a small table and every row is
 * a highlight target. There is no datapath geometry here to hand-roll.
 *
 * **What the reader is meant to SEE, in order of why the surface exists:**
 *   - **A counter learning.** Step onto a loop's backward branch and its row moves one step toward
 *     taken; step again and again and it parks at the ceiling. The first pass of a loop visibly
 *     *learns* — which is what the weakly-not-taken seed was chosen to buy.
 *   - **Hysteresis, which is the whole point of the second bit.** Switch the control between `1-bit`
 *     and `2-bit` on `nested-loop.s`: the inner loop's exit knocks a 1-bit counter straight over to
 *     "not taken" and it mispredicts the next entry, while the 2-bit one merely weakens from
 *     *strongly* to *weakly* taken and is still right. Two adjacent words in one row are the whole
 *     idea.
 *   - **A table that is mostly empty.** Twelve entries of sixteen are unowned on every corpus
 *     program, and three programs own none at all. That is the honest picture of a small direct-
 *     indexed structure, and it is what makes the ALIASING story legible when two branches ever do
 *     land on one row.
 *
 * Like the fold, this is a STATE view (see the fold's header): it draws the table AT the cursor, the
 * way the register, memory and cache panels do, so `micro.predictor`'s post-cycle counters are
 * exactly right.
 *
 * ⚠ **Nothing headless can see this panel's LAYOUT, and step 7 is its only net.** Every claim below
 * about width, wrapping and the meter is a claim about pixels, and this repo's own record is that 9
 * of 10 view steps shipped a defect only the browser caught. The reserves here are written from the
 * `panel-jitter` idiom rather than from measurement; the browser pass is where they become facts.
 */

import type { CycleTrace } from '@cpu-viz/trace';
import { useMemo } from 'react';
import { hex32 } from './format';
import { buildPredictorTable, type PredictorEntryView } from './predictor-table';
import type { BranchPrediction } from './session';
import { MONO, T } from './theme';

/**
 * What an untrained row's state chip contains: one non-breaking space.
 *
 * The same fix, for the same reason, as `CacheGridView`'s `IDLE_TAG_RESERVE` — read that docblock
 * before touching this. In short: an EMPTY chip has no line box at all, so the trained row would be
 * a pixel or two taller than its neighbours and the whole panel would change height as the cursor
 * moves. The chip is therefore ONE element in both states rather than a ternary between two, so the
 * line box is decided by the same tag, the same font and the same size either way; only the hue and
 * the word change.
 *
 * Duplicated rather than imported from the cache's panel deliberately: it is a one-character
 * constant standing in for a shared DISCIPLINE, and an import between two unrelated panels would
 * suggest they share a layout instead. The discipline is what must not diverge, and it is written
 * down in both places.
 */
const IDLE_CHIP_RESERVE = '\u00A0';

/** The counter's word, from the fold's two facts. A 1-bit table has no strength axis (`strength`
 *  is `null` there), so it reads plain `taken` / `not taken` — the machine really has nothing more
 *  to say, and inventing "strongly" for it would overstate a one-bit counter. */
function counterWord(entry: PredictorEntryView): string {
  const direction = entry.bets ? 'taken' : 'not taken';
  return entry.strength === null ? direction : `${entry.strength}ly ${direction}`;
}

/** Taken is green, not-taken amber — the same two hues the cache grid gives hit and miss, and never
 *  the sole carrier of the meaning: every row says its word too (the relief rule). */
function betHue(bets: boolean): string {
  return bets ? T.monoGreen : T.monoAmber;
}

export function PredictorTable(props: {
  /** The trace at the current cursor (`null` pre-run — the table then shows its cold seed). */
  trace: CycleTrace | null;
  /** The whole recording — read for the owner index and the previous cycle's counters (INV-3;
   *  see the fold). */
  recording: readonly CycleTrace[];
  /** The configured scheme. Supplies the geometry the counters do not carry; a scheme with no
   *  table renders nothing. */
  scheme: BranchPrediction;
  /** The followed instruction id, so a branch training its row reads the same here as everywhere. */
  followed: string | null;
}): React.JSX.Element | null {
  const { trace, recording, scheme, followed } = props;
  const table = useMemo(
    () => buildPredictorTable(trace, recording, scheme),
    [trace, recording, scheme],
  );
  if (table === null) return null;

  return (
    <section
      className="panel predictor-panel"
      style={{ marginTop: '1rem' }}
      aria-label="Branch predictor"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '1rem',
          flexWrap: 'wrap',
          marginBottom: '0.5rem',
        }}
      >
        <h2 className="panel-heading" style={{ margin: 0 }}>
          Branch predictor
        </h2>
        <span style={{ fontSize: '0.75rem', color: T.ink3 }}>
          {table.entries.length} counters × {table.bits} bit{table.bits === 1 ? '' : 's'} · a branch
          picks its row by address · counters saturate, they do not wrap
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <TrainCaption table={table} />
        </span>
      </div>

      <div className="predictor-rows">
        {table.entries.map((entry) => (
          <PredictorRow
            key={entry.index}
            entry={entry}
            max={table.max}
            trainedBy={table.trains.find((t) => t.index === entry.index) ?? null}
            followed={followed}
          />
        ))}
      </div>

      <div className="dp-legend predictor-legend">
        <span>
          <Swatch hue={T.monoGreen} /> bets taken
        </span>
        <span>
          <Swatch hue={T.monoAmber} /> bets not taken
        </span>
        <span>
          <Swatch hue={T.accent} /> trained this cycle
        </span>
        <span style={{ marginLeft: 'auto', color: T.ink3 }}>
          an empty row is an address no branch in this program reaches
        </span>
      </div>
    </section>
  );
}

function Swatch({ hue }: { hue: string }): React.JSX.Element {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: 2,
        verticalAlign: 'middle',
        marginRight: 5,
        background: hue,
      }}
    />
  );
}

/**
 * One counter. The four columns are the row's whole story left to right: WHICH row, WHAT it holds,
 * WHAT it would bet, and WHO owns it — with the trained chip last, in the same position the cache
 * grid puts its state chip.
 *
 * An UNOWNED row is dimmed rather than hidden. Hiding it would draw the program instead of the
 * machine, and the machine is a fixed sixteen-entry table whose emptiness is the fact that makes
 * aliasing worth teaching (see the fold's note on why all rows are always drawn).
 */
function PredictorRow(props: {
  entry: PredictorEntryView;
  max: number;
  trainedBy: { predicted: boolean; actual: boolean; id: string } | null;
  followed: string | null;
}): React.JSX.Element {
  const { entry, max, trainedBy, followed } = props;
  const owned = entry.owners.length > 0;
  const hue = betHue(entry.bets);
  const isFollowed = trainedBy !== null && trainedBy.id === followed;

  return (
    <div
      className={`predictor-row predictor-row--${entry.trained ? 'trained' : 'idle'}${
        isFollowed ? ' dp--follow' : ''
      }`}
      style={
        {
          '--row-hue': hue,
          ...(entry.trained ? { background: T.highlight } : {}),
        } as React.CSSProperties
      }
    >
      <span className="predictor-row-idx" style={{ color: T.ink3, fontFamily: MONO }}>
        {entry.index}
      </span>

      {/* The counter as a number AND as a meter. The number is the expert readout; the meter is
          what makes "it moved one step" legible at a glance while stepping. */}
      <span className="predictor-row-counter" style={{ fontFamily: MONO, color: T.ink2 }}>
        {entry.counter}
        <span style={{ color: T.ink3 }}>/{max}</span>
      </span>
      <span className="predictor-row-meter" aria-hidden>
        {Array.from({ length: max + 1 }, (_, step) => (
          <span
            key={step}
            className="predictor-pip"
            style={{ background: step <= entry.counter ? hue : 'transparent', borderColor: hue }}
          />
        ))}
      </span>

      <span
        className="predictor-row-word"
        style={{ color: owned ? hue : T.ink3, fontFamily: MONO }}
      >
        {counterWord(entry)}
      </span>

      <span className="predictor-row-owner" style={{ fontFamily: MONO, color: T.ink3 }}>
        {owned
          ? entry.owners.map((o) => `${o.text} @ ${hex32(o.pc)}`).join(' · ')
          : 'no branch here'}
      </span>

      {/* ONE element for both states — see {@link IDLE_CHIP_RESERVE}. */}
      <span
        className={`predictor-row-chip${entry.trained ? '' : ' predictor-row-chip--idle'}`}
        style={{
          fontFamily: MONO,
          color: entry.trained ? T.accent : undefined,
          borderColor: entry.trained ? T.accent : undefined,
        }}
        aria-hidden={entry.trained ? undefined : true}
      >
        {entry.trained && trainedBy !== null
          ? `${entry.previous} → ${entry.counter}`
          : IDLE_CHIP_RESERVE}
      </span>
    </div>
  );
}

/**
 * The one-line status of THIS cycle's training — the caption that names what just happened, reading
 * the same fold the rows do so the two never disagree about which row moved.
 *
 * ⚠ **`from → to` is the ROW's before and after, not the train's**, and on a saturated counter they
 * are equal — "3 → 3, already sure". That is not a bug to paper over with an arrow that always
 * moves: a counter that has stopped moving is precisely what saturation MEANS, and it is the
 * observation the 2-bit lesson is built on. The fold measured 464 such trains on this corpus.
 *
 * It handles more than one train because the fold hands it a list (see the fold's decision 3). The
 * corpus cannot currently produce two, so that branch is UNREACHED rather than untested-by
 * oversight — said here so the next reader does not take the plural as evidence it has been seen.
 */
function TrainCaption(props: {
  table: NonNullable<ReturnType<typeof buildPredictorTable>>;
}): React.JSX.Element {
  const { entries, trains } = props.table;
  if (trains.length === 0) {
    return (
      <span style={{ fontSize: '0.75rem', color: T.ink3 }}>no branch resolved this cycle</span>
    );
  }
  return (
    <span style={{ fontSize: '0.78rem', color: T.ink2, fontFamily: MONO }}>
      {trains.map((train) => {
        const row = entries[train.index];
        const right = train.predicted === train.actual;
        return (
          <span key={train.id} style={{ marginLeft: '0.6rem' }}>
            <span style={{ color: right ? T.monoGreen : T.danger, fontWeight: 700 }}>
              {right ? 'CORRECT' : 'MISPREDICT'}
            </span>{' '}
            {train.text} @ {hex32(train.pc)} → {train.actual ? 'taken' : 'not taken'} · row{' '}
            {train.index}
            {row === undefined ? '' : `: ${row.previous} → ${row.counter}`}
          </span>
        );
      })}
    </span>
  );
}
