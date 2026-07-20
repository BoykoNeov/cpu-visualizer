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
 * The readout's subject is the pair in **ID**, being decided *this* cycle. The datapath's dark
 * `ALU 1` is that decision's *consequence*, and it shows up **one cycle later**, when the refused
 * instruction is not in EX beside its partner. So at a refusal cursor the readout says "refused"
 * while the datapath below still shows two busy lanes — that is correct, not a disagreement, and
 * the caption says so rather than leaving a reader to discover it as an apparent bug.
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
import { LANE_COLORS } from './SuperscalarDatapathView';
import { MONO, T } from './theme';

/**
 * The badge for each verdict. `refused` and `blocked` are deliberately given DIFFERENT words and
 * different hues: refused is a pairing failure the machine walked away from (progress continued),
 * blocked is nobody moving. Collapsing them into one "stalled" chip would erase the distinction the
 * tier exists to teach. Amber for refused (a warn, not a fault — the machine is working as designed)
 * and the danger hue for blocked, matching how the rest of the app grades severity.
 */
const VERDICT_STYLE: Readonly<Record<IssueVerdict, { label: string; hue: string; gloss: string }>> =
  {
    paired: { label: 'PAIRED', hue: T.monoGreen, gloss: 'both issued together this cycle' },
    solo: { label: 'SOLO', hue: T.accent, gloss: 'one instruction was up, and it issued' },
    refused: {
      label: 'REFUSED',
      hue: T.monoAmber,
      gloss: 'the older issued; the younger waits a cycle',
    },
    blocked: { label: 'BLOCKED', hue: T.danger, gloss: 'nothing issued this cycle' },
    idle: { label: 'IDLE', hue: T.ink3, gloss: 'nothing is waiting to issue' },
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
          {readout.width === 1
            ? 'this machine issues 1 instruction per cycle — nothing can pair'
            : 'up to 2 instructions may issue together, if no rule forbids it'}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <IpcTile retired={ipc.retired} cycles={ipc.cycles} ipc={ipc.ipc} width={readout.width} />
        </span>
      </div>

      <Verdict readout={readout} />
      <Candidates readout={readout} followed={followed ?? null} />
    </section>
  );
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
        {v.gloss}
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
            {/* Lane-tinted, and carrying its slot number as TEXT — the relief rule, structurally. */}
            <span
              style={{
                color: LANE_COLORS[c.slot as 0 | 1],
                border: `1px solid ${LANE_COLORS[c.slot as 0 | 1]}`,
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
      {/* The offset warning, stated on the surface rather than left to be discovered as a bug. */}
      {readout.verdict === 'refused' ? (
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.72rem', color: T.ink3 }}>
          The held instruction leads the next issue group — watch it move to slot 0. The execute
          lane it would have used goes dark on the <em>next</em> cycle, not this one.
        </p>
      ) : null}
    </>
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
