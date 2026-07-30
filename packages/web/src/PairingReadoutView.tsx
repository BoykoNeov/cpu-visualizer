/**
 * The pairing readout and the IPC tile (M7 step 8) — the drawing half of `pairing-readout.ts`, in
 * the same two-halves shape as the cache grid and the pipeline map. HTML, not SVG, for the reason
 * the visuals doc pinned for micro-structure tables: this is tabular data with a highlight per row,
 * and there is no geometry here to hand-roll.
 *
 * **This surface answers the tier's actual question in words:** the datapath shows that a lane went
 * dark and the map shows the resulting stagger, but neither can say *why*. "Both use the one
 * data-memory port" is a sentence, and it needs a place to be said.
 *
 * ## Reading it beside the other two surfaces — the one-cycle offset
 *
 * The readout's subject is the GROUP in **ID**, being decided *this* cycle. A dark execute lane in
 * the datapath is that decision's *consequence*, and it shows up **one cycle later**, when the
 * refused instruction is not in EX beside its group-mates. So at a refusal cursor the readout says
 * "refused" while the datapath below still shows the previous group's lanes busy — that is correct,
 * not a disagreement, and the caption says so rather than leaving a reader to discover it as an
 * apparent bug.
 *
 * The surface that agrees with this one *at the same cursor* is the **pipeline map**, where a
 * refusal is a visible stagger: the older instruction's `EX` cell sits one column left of the
 * younger's. That is the cross-check to trust.
 *
 * ## Encoding, unchanged from step 7's pinned scheme
 *
 * Three channels, three meanings — wire = stage, **box tint = lane**, ring = identity. Here only the
 * slot badge is lane-tinted, and it carries its slot NUMBER as text, so the relief rule is satisfied
 * structurally rather than by care (light `--lane-1` is 2.62:1 against the surface — a hue may never
 * be the sole carrier). {@link LANE_COLORS} is imported rather than restated so the datapath stays
 * the single place the lane hues are named.
 */

import { useMemo } from 'react';
import type { CycleTrace } from '@cpu-viz/trace';
import {
  readIpc,
  readPairing,
  readPairingPreRun,
  REASON_TEXT,
  type IssueVerdict,
  type PairingReadoutView as Readout,
} from './pairing-readout';
import type { Lane } from './datapath-superscalar';
import { LANE_COLORS } from './SuperscalarDatapathView';
import { MONO, T } from './theme';

/** This slot's lane hue, TOTAL over the slot range the trace can emit. A slot the lane set does not
 *  reach falls back to the neutral ink rather than to `undefined`, which is what a CSS property
 *  swallows in silence — and silence is exactly how the arity-2 version of this lookup survived. */
function laneColor(slot: number): string {
  return LANE_COLORS[slot as Lane] ?? T.ink2;
}

/**
 * The badge for each verdict. `refused` and `blocked` are deliberately given DIFFERENT words and
 * different hues: refused is a pairing failure the machine walked away from (progress continued),
 * blocked is nobody moving. Collapsing them into one "stalled" chip would erase the distinction the
 * tier exists to teach. Amber for refused (a warn, not a fault — the machine is working as designed)
 * and the danger hue for blocked, matching how the rest of the app grades severity.
 *
 * **The two glosses that used to state a COUNT are now derived from one** (M13 step 8). `paired` read
 * "both issued together" and `refused` read "the older issued; the younger waits a cycle" — a
 * two-instruction sentence under a control that has offered four positions since step 6. Neither was
 * merely imprecise: measured over the corpus at width 4, **every one of the 26 `paired` cycles holds
 * three or four instructions and none holds two**, and `refused` holds THREE back more often than one
 * (51 cycles vs 41). So the old wording was wrong on the majority of the cycles it described.
 *
 * Deriving them from `candidates` rather than rewording them to something vague ("several issued") is
 * the same call the caption made: a count is ARITHMETIC, so a test can watch it, where a hand-picked
 * adjective is prose that ships green whatever it says. The `paired` LABEL moves too — `CO-ISSUED` is
 * true of three and of four, where `PAIRED` is a claim about two — but the verdict IDENTIFIER stays
 * `'paired'`, because it is asserted by name across two test files and renaming it would be step 1's
 * `intra-pair-raw` mistake one layer up.
 */
const VERDICT_STYLE: Readonly<
  Record<IssueVerdict, { label: string; hue: string; gloss: (r: Readout) => string }>
> = {
  paired: {
    label: 'CO-ISSUED',
    hue: T.monoGreen,
    gloss: (r) => `${r.candidates.length} instructions issued together this cycle`,
  },
  solo: { label: 'SOLO', hue: T.accent, gloss: () => 'one instruction was up, and it issued' },
  refused: {
    label: 'REFUSED',
    hue: T.monoAmber,
    gloss: (r) => {
      const went = r.candidates.filter((c) => c.issued).length;
      const held = r.candidates.length - went;
      return `${went} of ${r.candidates.length} issued; ${held} held for the next group`;
    },
  },
  blocked: { label: 'BLOCKED', hue: T.danger, gloss: () => 'nothing issued this cycle' },
  idle: { label: 'IDLE', hue: T.ink3, gloss: () => 'nothing is waiting to issue' },
};

export function PairingReadout(props: {
  /** The trace at the cursor. `null` pre-run, and non-superscalar recordings fold to `null` too —
   *  the panel is gated on a TRACE fact (slotted latches), never on the shell's model id. */
  trace: CycleTrace | null;
  /** The whole recording, for the IPC tile — a deliberately cursor-INDEPENDENT figure. */
  recording: readonly CycleTrace[];
  /** The id the follow-ring is on, so a followed instruction reads the same here as everywhere. */
  followed?: string | null;
}): React.JSX.Element | null {
  const { trace, recording, followed } = props;
  // At the pre-run cursor there is no trace, but there IS a recording — and the IPC tile is a
  // whole-recording figure, so the panel stays (see `readPairingPreRun`). Keying the panel on the
  // cursor alone made it vanish at cycle -1, taking the width A/B's one number with it.
  const readout = useMemo(
    () => (trace === null ? readPairingPreRun(recording) : readPairing(trace)),
    [trace, recording],
  );
  const ipc = useMemo(() => readIpc(recording), [recording]);
  if (readout === null) return null;

  return (
    <section className="panel" style={{ marginTop: '1rem' }} aria-label="Issue and pairing">
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
          Issue
        </h2>
        <span style={{ fontSize: '0.75rem', color: T.ink3 }}>
          {/* The NUMBER is derived, not typed. It read a literal "up to 2" until M13 step 7, which
              has been wrong on screen at widths 3 and 4 since step 6 opened the control — the same
              class as step 6's model description and its `=== 2` tooltip ternary, and invisible for
              the same reason: nothing in this repo asserts on a caption's wording. The VOCABULARY
              is still pair-shaped and belongs to step 8; only the arithmetic is fixed here. */}
          {readout.width === 1
            ? 'this machine issues 1 instruction per cycle — nothing can pair'
            : `up to ${readout.width} instructions may issue together, if no rule forbids it`}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <IpcTile retired={ipc.retired} cycles={ipc.cycles} ipc={ipc.ipc} width={readout.width} />
        </span>
      </div>

      <ReservedBody readout={readout} recording={recording} followed={followed ?? null} />
    </section>
  );
}

/**
 * The cursor-dependent half of the panel — the verdict line, the candidate rows and the refusal note
 * — held at a CONSTANT height by stacking every shape the recording can produce in one grid cell and
 * showing only the live one.
 *
 * **Why it needs holding.** All three parts change size as you step: the candidate list is 0 to
 * `width` rows, the empty-decode message replaced the whole list, and the refusal note exists only on
 * a refusal cycle. Measured in the shipped bundle (2026-07-30), this panel swung **98.8→198.3px** at
 * width 4 on `array-sum` and 98.8→148.8px at width 2 on `paired-branches`, and everything below it —
 * the source, register and memory panels — moved by the same ~100px on the steps where it changed.
 * A reader stepping the clock is comparing one cycle's picture against the last one's, and a surface
 * that relocates under them on the step is the surface failing at the job it was added for.
 *
 * **Grid, not a `min-height`.** The reserve is then DERIVED — the tallest shape this recording
 * actually reaches, at the current window width, with the current fonts — rather than a magic number
 * that a longer instruction, a fourth issue slot or a narrower window silently outgrows. That matters
 * here and is not theory: at a 980px window the same recording's swing measured 124.9px rather than
 * 99.5px, because the verdict line wraps at one width and not the other. Nothing here counts lines or
 * knows what a line is. This is the narration panel's mechanism (`NarrationPanel` in `App.tsx`),
 * applied to the other surface that puts a variable-length sentence above the fold.
 *
 * `visibility: hidden`, not `display: none`: hidden is what makes a ghost occupy the cell — the
 * reserve IS the mechanism — and it takes the ghosts out of the accessibility tree on the way, so a
 * screen reader reads exactly one verdict and one candidate list.
 *
 * **The ghosts are deduped into SHAPE CLASSES, and the bound is the point.** The first draft keyed on
 * everything that can affect a ghost's height — verdict, reason, and every candidate's slot, text and
 * issued flag — which is exact and grows one class per distinct instruction tuple. Measured: fine on
 * the corpus (35 rows, 24KB at worst) and **802 rows / 455KB for one panel** on a straight-line
 * 800-instruction program, re-rendered on every step. That is the failure `MAX_MAP_CYCLES` exists for
 * one file over, and the same trigger: something a sandbox user can type in a minute.
 *
 * So the key is `(verdict, reason, candidate count, issued count)` — everything that decides how many
 * LINES a shape has — and within a class the kept member is the one whose widest single candidate is
 * widest, since that is what decides whether a row WRAPS. The class count is bounded by the verdicts
 * times the reasons times the width squared, so ghosts stop scaling with the run.
 *
 * That is a proxy rather than a proof, and the honest statement of the trade: two shapes in one class
 * could wrap differently if the kept one's rows are individually shorter while another's total is
 * longer. It is the right trade because the alternative is not "exact" but "exact until a long enough
 * program makes the panel unusable", and the numbers above say how long that program has to be.
 *
 * The LIVE readout is drawn on top of the ghosts rather than selected from among them: at the pre-run
 * cursor it comes from `readPairingPreRun` and so is not one of the recorded shapes at all.
 */
function ReservedBody(props: {
  readout: Readout;
  recording: readonly CycleTrace[];
  followed: string | null;
}): React.JSX.Element {
  const { readout, recording, followed } = props;
  const ghosts = useMemo(() => {
    const byClass = new Map<string, Readout>();
    for (const trace of recording) {
      const r = readPairing(trace);
      if (r === null) continue;
      const issued = r.candidates.filter((c) => c.issued).length;
      const key = `${r.verdict}|${r.reason}|${r.candidates.length}|${issued}`;
      const kept = byClass.get(key);
      if (kept === undefined || widestRow(r) > widestRow(kept)) byClass.set(key, r);
    }
    return [...byClass.values()];
  }, [recording]);

  return (
    <div style={{ display: 'grid' }}>
      {ghosts.map((ghost, i) => (
        <div key={`ghost-${i}`} style={{ gridArea: '1 / 1', visibility: 'hidden' }}>
          <Verdict readout={ghost} />
          <Candidates readout={ghost} followed={null} />
        </div>
      ))}
      <div style={{ gridArea: '1 / 1' }}>
        <Verdict readout={readout} />
        <Candidates readout={readout} followed={followed} />
      </div>
    </div>
  );
}

/** The longest single candidate row in a shape — a row wraps on its OWN length, not on the shape's
 *  total, so this is what picks the tallest member of a shape class. */
function widestRow(readout: Readout): number {
  return readout.candidates.reduce((widest, c) => Math.max(widest, c.text.length), 0);
}

function Verdict({ readout }: { readout: Readout }): React.JSX.Element {
  const v = VERDICT_STYLE[readout.verdict];
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
      <span
        style={{
          fontFamily: MONO,
          fontSize: '0.75rem',
          color: v.hue,
          border: `1px solid ${v.hue}`,
          borderRadius: '3px',
          padding: '0.05rem 0.35rem',
        }}
      >
        {v.label}
      </span>
      <span style={{ fontSize: '0.8rem', color: T.ink2 }}>
        {v.gloss(readout)}
        {readout.reason !== null ? ' — ' : ''}
        {readout.reason !== null ? (
          <strong style={{ color: T.ink }}>{REASON_TEXT[readout.reason]}</strong>
        ) : null}
      </span>
    </div>
  );
}

function Candidates({
  readout,
  followed,
}: {
  readout: Readout;
  followed: string | null;
}): React.JSX.Element {
  if (readout.candidates.length === 0) {
    return (
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: T.ink3 }}>
        Decode is empty this cycle.
      </p>
    );
  }
  return (
    <>
      <ul
        style={{
          listStyle: 'none',
          margin: '0.5rem 0 0',
          padding: 0,
          display: 'grid',
          gap: '0.25rem',
        }}
      >
        {readout.candidates.map((c) => (
          <li
            key={c.id}
            className={followed === c.id ? 'dp--follow' : undefined}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.6rem',
              fontFamily: MONO,
              fontSize: '0.8rem',
              padding: '0.15rem 0.3rem',
              borderRadius: '3px',
              background: followed === c.id ? T.highlight : undefined,
            }}
          >
            {/* Lane-tinted, and carrying its slot number as TEXT — the relief rule, structurally.
                The lookup is TOTAL over the lane set rather than cast to it: this read
                `c.slot as 0 | 1` until M13 step 7, which at slot 2 or 3 silently resolved to
                `undefined` and emitted `color: undefined` — a second consumer of the arity-2 lane
                set, live from the moment step 6 opened the control and invisible to every test. */}
            <span
              style={{
                color: laneColor(c.slot),
                border: `1px solid ${laneColor(c.slot)}`,
                borderRadius: '3px',
                padding: '0 0.3rem',
                fontSize: '0.7rem',
              }}
            >
              slot {c.slot}
            </span>
            <span style={{ color: T.ink }}>{c.text}</span>
            <span style={{ marginLeft: 'auto', color: c.issued ? T.monoGreen : T.ink3 }}>
              {c.issued ? 'issued →' : 'held'}
            </span>
          </li>
        ))}
      </ul>
      {/* The offset warning, stated on the surface rather than left to be discovered as a bug. The
          singular/plural is DERIVED: at width 4 a refusal holds three instructions back more often
          than one, so a fixed "the held instruction" is wrong on the majority of refusal cycles. */}
      {readout.verdict === 'refused' ? <RefusalNote readout={readout} /> : null}
    </>
  );
}

/**
 * What a refusal means for the NEXT cycle — the one-cycle offset, said on the surface rather than
 * left to be discovered as an apparent bug.
 *
 * Split out of {@link Candidates} at M13 step 8 only because its number moved: how many instructions
 * are held is a property of the group, so the sentence has to be built rather than written. The
 * lanes going dark are likewise plural at width ≥ 3 — a `mem-port` refusal in a group of four can
 * leave three lanes idle next cycle, which is precisely the picture the datapath draws and this
 * sentence is here to predict.
 */
function RefusalNote({ readout }: { readout: Readout }): React.JSX.Element {
  const held = readout.candidates.filter((c) => !c.issued).length;
  return (
    <p style={{ margin: '0.4rem 0 0', fontSize: '0.72rem', color: T.ink3 }}>
      {held === 1
        ? 'The held instruction leads the next issue group — watch it move to slot 0.'
        : `The ${held} held instructions lead the next issue group — watch the oldest move to slot 0.`}{' '}
      The execute {held === 1 ? 'lane it would have used goes' : 'lanes they would have used go'}{' '}
      dark on the <em>next</em> cycle, not this one.
    </p>
  );
}

/**
 * Instructions per cycle — **derived here, in the view, from retire events** (INV-2: the engine has
 * no such counter and must not grow one). Whole-recording rather than running-to-cursor, so that
 * flipping the width toggle moves exactly one number and stepping the transport moves none: the
 * tile exists to make the width A/B legible, and a figure that changed on every step would bury it.
 *
 * The retire count is shown beside the quotient because it is the half that does NOT move — in-order
 * retirement means width cannot change how many instructions run, only how long they take. Seeing
 * `34 ÷ 56` become `34 ÷ 44` is the whole lesson; seeing `0.61 → 0.77` alone is a number changing.
 */
function IpcTile({
  retired,
  cycles,
  ipc,
  width,
}: {
  retired: number;
  cycles: number;
  ipc: number;
  width: number;
}): React.JSX.Element {
  return (
    <span
      title={`${retired} instructions retired ÷ ${cycles} cycles (whole run). The ceiling is the issue width, ${width}.`}
      style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.4rem', fontFamily: MONO }}
    >
      <span style={{ fontSize: '0.7rem', color: T.ink3 }}>IPC</span>
      <strong style={{ fontSize: '1rem', color: T.ink }}>{ipc.toFixed(2)}</strong>
      <span style={{ fontSize: '0.7rem', color: T.ink3 }}>
        {retired} ÷ {cycles}
      </span>
    </span>
  );
}
