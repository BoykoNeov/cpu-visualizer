import type { AssemblerError } from '@cpu-viz/assembler';
import { DEPTH_TIERS, type DepthTier } from '@cpu-viz/curriculum';
import type { InstructionInstance } from '@cpu-viz/trace';
import { useEffect, useMemo, useState } from 'react';
import { Datapath } from './DatapathView';
import { formatInstruction } from './format';
import { LESSONS } from './lessons';
import { narrationView, type NarrationView } from './narration';
import { MemoryPanel, RegisterPanel, SourcePanel } from './panels';
import { EXAMPLE_PROGRAMS } from './programs';
import { useSimulator } from './useSimulator';

/** Sentinel `<select>` value for the sandbox state — no corpus program is selected. */
const SANDBOX_OPTION = '__sandbox__';

/**
 * The M1 step-7 web shell: load an example program, drive the single-cycle engine through the
 * {@link useSimulator} recorder, and show the source↔machine-code, register, and memory panels.
 * Everything shown is read from the recorded trace at the current cursor, so stepping forward,
 * stepping back, and scrubbing always display the exact recorded state (acceptance §11). The
 * SVG datapath view (step 8) and its depth-tier dial (step 9, axis B / handoff §4) sit on top;
 * the depth dial is a pure view concern — the engine and trace are oblivious to it (INV-2).
 */
export function App(): React.JSX.Element {
  const sim = useSimulator();
  // Explanation depth (axis B, handoff §4) — a view/curriculum concern only; the engine is
  // oblivious (INV-2). On single-cycle the tier changes the datapath's representational detail:
  // `essentials` shows the bare lit path, `detailed` (default) adds the value on each active wire,
  // `expert` adds the mux control-line labels.
  const [tier, setTier] = useState<DepthTier>('detailed');

  // The pristine corpus source backing the current session — the editor's "revert" baseline and
  // the seed for the edit draft. In a sandbox this is what the edit forked FROM (not the running
  // code); the running source is `sim.loadedSource`, shown by the source panel below.
  const origin = useMemo(
    () => EXAMPLE_PROGRAMS.find((p) => p.name === sim.programName)?.source ?? '',
    [sim.programName],
  );

  // The edit buffer. Seeded from `origin` and re-seeded whenever a fresh corpus program is
  // loaded — keyed on `sim.loadGen` (not just `origin`) so re-selecting the SAME program from
  // the picker (leaving a sandbox) reseeds the draft to pristine too. A sandbox fork does not
  // bump `loadGen`, so applying an edit never clobbers what the user is typing.
  const [draft, setDraft] = useState(origin);
  useEffect(() => setDraft(origin), [origin, sim.loadGen]);
  const [editorOpen, setEditorOpen] = useState(false);
  // Keep the editor reachable when an edit fails to assemble, so the user can fix and re-run
  // (unlike the corpus programs, edited source can be syntactically broken).
  const showEditor = editorOpen || sim.errors !== null;

  // The single in-flight instruction this cycle (single-cycle: exactly one, or none pre-run).
  const inFlight = sim.cycleTrace?.instructions[0] ?? null;
  const activeLine = inFlight?.sourceLine ?? null;
  const writtenRegs = useMemo(() => {
    const set = new Set<number>();
    for (const e of sim.cycleTrace?.events ?? []) {
      // x0 is hardwired to 0; a reg-write targeting it is a no-op, so don't highlight it.
      if (e.type === 'reg-write' && e.reg !== 0) set.add(e.reg);
    }
    return set;
  }, [sim.cycleTrace]);

  const atStart = sim.cursor < 0;
  const lastCycle = sim.recordedCycles - 1;

  // The lesson play-through view-model (INV-6): which anchored step is active at the cursor and
  // what narration to show at the current depth tier. Re-resolves on scrub or tier change (the
  // anchoring itself is memoized upstream in `useSimulator`). `null` in free-play / sandbox.
  const narration = useMemo(
    () => (sim.anchoredSteps ? narrationView(sim.anchoredSteps, sim.cursor, tier) : null),
    [sim.anchoredSteps, sim.cursor, tier],
  );

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 1200,
        margin: '1.5rem auto',
        padding: '0 1rem',
        color: '#222',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', margin: 0 }}>CPU Visualizer</h1>
        <span style={{ color: '#888' }}>single-cycle RV32I</span>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: '1.25rem',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <DepthDial tier={tier} setTier={setTier} />
          <label>
            Program:{' '}
            <select
              value={sim.sandbox ? SANDBOX_OPTION : (sim.programName ?? '')}
              onChange={(e) => sim.select(e.target.value)}
              style={{ fontSize: '0.95rem', padding: '0.2rem' }}
            >
              {sim.sandbox ? (
                <option value={SANDBOX_OPTION} disabled>
                  — sandbox —
                </option>
              ) : null}
              {EXAMPLE_PROGRAMS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Lesson:{' '}
            <select
              value={sim.activeLesson?.id ?? ''}
              onChange={(e) => {
                const lesson = LESSONS.find((l) => l.id === e.target.value);
                // "— none —" drops back to free-play on the same program.
                if (lesson) sim.startLesson(lesson);
                else if (sim.programName) sim.select(sim.programName);
              }}
              style={{ fontSize: '0.95rem', padding: '0.2rem' }}
            >
              <option value="">— none —</option>
              {LESSONS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <ModeChip sim={sim} />

      <ProgramEditor
        open={showEditor}
        onToggle={() => setEditorOpen((o) => !o)}
        draft={draft}
        setDraft={setDraft}
        onRun={() => sim.loadEdited(draft)}
        onRevert={() => {
          setDraft(origin);
          if (sim.programName) sim.select(sim.programName);
        }}
        canRevert={sim.sandbox && sim.programName !== null}
        originName={sim.programName}
      />

      {sim.errors ? (
        <ErrorBox errors={sim.errors} />
      ) : sim.runtimeError ? (
        <NoticeBox title="Program did not finish" message={sim.runtimeError} />
      ) : (
        <>
          <Transport sim={sim} atStart={atStart} lastCycle={lastCycle} inFlight={inFlight} />

          {sim.activeLesson && narration ? (
            <NarrationPanel
              title={sim.activeLesson.title}
              view={narration}
              tier={tier}
              onSeek={sim.scrubTo}
            />
          ) : null}

          <Datapath trace={sim.cycleTrace} cycleKey={sim.cursor} tier={tier} />

          {sim.state && sim.program ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)',
                gap: '1rem',
                marginTop: '1rem',
                alignItems: 'start',
              }}
            >
              <SourcePanel
                program={sim.program}
                source={sim.loadedSource ?? ''}
                activeLine={activeLine}
              />
              <RegisterPanel state={sim.state} writtenRegs={writtenRegs} />
              <MemoryPanel state={sim.state} />
            </div>
          ) : (
            <p style={{ color: '#999' }}>Loading…</p>
          )}
        </>
      )}
    </main>
  );
}

/**
 * A one-line badge naming the current session mode (spec §13): free-play on a corpus program,
 * following a lesson (its annotations attached), or a sandbox (a user-edited program with the
 * lesson detached). This is the minimal visible surface that makes the mid-lesson → edit →
 * fork transition legible; full step-by-step narration playback is a later piece.
 */
function ModeChip(props: { sim: ReturnType<typeof useSimulator> }): React.JSX.Element | null {
  const { sim } = props;
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    marginTop: '0.75rem',
    fontSize: '0.82rem',
    padding: '0.2rem 0.6rem',
    borderRadius: 999,
    border: '1px solid',
  };
  if (sim.sandbox) {
    return (
      <div style={{ ...base, borderColor: '#d9a441', background: '#fff8e8', color: '#8a5a00' }}>
        <strong>Sandbox</strong>
        <span>
          editing {sim.programName ? `“${sim.programName}”` : 'a program'} — lesson annotations
          detached. Pick the lesson again to resume it on the original program.
        </span>
      </div>
    );
  }
  if (sim.activeLesson) {
    return (
      <div style={{ ...base, borderColor: '#7aa7e0', background: '#eef5ff', color: '#1e4d8a' }}>
        <strong>Lesson</strong>
        <span>{sim.activeLesson.title}</span>
      </div>
    );
  }
  return (
    <div style={{ ...base, borderColor: '#cfcfd6', background: '#f6f6f8', color: '#555' }}>
      <strong>Free play</strong>
      <span>{sim.programName ?? '—'}</span>
    </div>
  );
}

/**
 * Render authored narration text: the lessons write register/instruction names in `backticks`
 * (e.g. "`add a0, a0, t0`"), so split on paired backticks and set the odd segments as inline
 * code. Keeps the narration readable without pulling in a markdown dependency.
 */
function renderNarration(text: string): React.ReactNode {
  return text.split('`').map((seg, i) =>
    i % 2 === 1 ? (
      <code
        key={i}
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          background: '#eef2ff',
          color: '#1e3a8a',
          padding: '0.05rem 0.3rem',
          borderRadius: 4,
          fontSize: '0.9em',
        }}
      >
        {seg}
      </code>
    ) : (
      <span key={i}>{seg}</span>
    ),
  );
}

/**
 * The lesson narration panel — the visible "play-through" (spec §11 acceptance). It shows the
 * step active at the current cursor (INV-6) with its narration resolved at the depth tier
 * (INV-5), a clickable step rail, and Prev/Next-step controls that scrub the timeline. As the
 * user scrubs (or the datapath animates), the active step follows the cursor; changing the
 * depth dial re-resolves the narration in place. Rendered only while a lesson is attached.
 */
function NarrationPanel(props: {
  title: string;
  view: NarrationView;
  tier: DepthTier;
  onSeek: (cycle: number) => void;
}): React.JSX.Element {
  const { title, view, onSeek } = props;
  const total = view.steps.length;
  const current = view.activeIndex; // -1 before the first step fires
  const btn: React.CSSProperties = {
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: 6,
    border: '1px solid #7aa7e0',
    background: '#fff',
    color: '#1e4d8a',
    cursor: 'pointer',
  };
  return (
    <section
      aria-label="Lesson narration"
      style={{
        marginTop: '1rem',
        border: '1px solid #7aa7e0',
        background: '#f3f8ff',
        borderRadius: 10,
        padding: '0.9rem 1.1rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
          marginBottom: '0.6rem',
        }}
      >
        <span
          style={{
            fontSize: '0.7rem',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#5a7bb0',
            fontWeight: 700,
          }}
        >
          Lesson
        </span>
        <strong style={{ color: '#1e4d8a', fontSize: '1rem' }}>{title}</strong>
        <span style={{ marginLeft: 'auto', color: '#5a7bb0', fontSize: '0.85rem' }}>
          {current >= 0 ? `Step ${current + 1} of ${total}` : `Not started · ${total} steps`}
        </span>
      </div>

      {/* Step rail: one clickable dot per anchored step; click scrubs to its cycle. */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}
        role="tablist"
        aria-label="Lesson steps"
      >
        {view.steps.map((s, i) => {
          const state = i === current ? 'active' : i < current ? 'past' : 'future';
          return (
            <button
              key={s.index}
              role="tab"
              aria-selected={state === 'active'}
              onClick={() => onSeek(s.cycle)}
              title={s.narration ?? `Step ${i + 1}`}
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
                border: `2px solid ${state === 'future' ? '#b8c9e6' : '#1e6fe0'}`,
                background:
                  state === 'active' ? '#1e6fe0' : state === 'past' ? '#cfe0fb' : '#fff',
                color: state === 'active' ? '#fff' : '#1e4d8a',
              }}
            >
              {i + 1}
            </button>
          );
        })}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
          <button
            style={{ ...btn, opacity: view.prevCycle === null ? 0.45 : 1 }}
            disabled={view.prevCycle === null}
            onClick={() => view.prevCycle !== null && onSeek(view.prevCycle)}
            title="Scrub to the previous lesson step"
          >
            ◀ Prev step
          </button>
          <button
            style={{ ...btn, opacity: view.nextCycle === null ? 0.45 : 1 }}
            disabled={view.nextCycle === null}
            onClick={() => view.nextCycle !== null && onSeek(view.nextCycle)}
            title="Scrub to the next lesson step"
          >
            Next step ▶
          </button>
        </div>
      </div>

      {/* The active step's narration, or a prompt when the lesson hasn't started / has no text
          at this depth. */}
      <p style={{ margin: '0.75rem 0 0', lineHeight: 1.55, color: '#243b53' }}>
        {current < 0 ? (
          <span style={{ color: '#5a7bb0' }}>
            Press <strong>Next step ▶</strong> or scrub the timeline to walk through the lesson.
          </span>
        ) : view.narration !== undefined ? (
          renderNarration(view.narration)
        ) : (
          <span style={{ color: '#5a7bb0' }}>
            This step has no narration at the current depth — raise the depth dial for more.
          </span>
        )}
      </p>
    </section>
  );
}

/**
 * The program editor. Editing and running forks into a sandbox (§13) — the same driver path
 * as the corpus programs, so the edited run animates identically. Collapsed by default behind
 * a toggle to keep the shell uncluttered; forced open by the parent when an edit fails to
 * assemble so the user can fix it. `onRun` is an explicit action (not on-keystroke) so a
 * half-typed loop is never assembled and never trips the runaway guard mid-edit.
 */
function ProgramEditor(props: {
  open: boolean;
  onToggle: () => void;
  draft: string;
  setDraft: (s: string) => void;
  onRun: () => void;
  onRevert: () => void;
  canRevert: boolean;
  originName: string | null;
}): React.JSX.Element {
  const { open, onToggle, draft, setDraft, onRun, onRevert, canRevert, originName } = props;
  const btn: React.CSSProperties = {
    fontSize: '0.85rem',
    padding: '0.35rem 0.7rem',
    borderRadius: 6,
    border: '1px solid #bbb',
    background: '#f7f7f9',
    cursor: 'pointer',
  };
  return (
    <div style={{ marginTop: '0.75rem' }}>
      <button style={{ ...btn, background: open ? '#eef' : '#f7f7f9' }} onClick={onToggle}>
        ✎ Edit program {open ? '▲' : '▼'}
      </button>
      {open ? (
        <div
          style={{
            marginTop: '0.5rem',
            border: '1px solid #d0d0d8',
            borderRadius: 8,
            padding: '0.75rem 1rem',
            background: '#fff',
          }}
        >
          <p style={{ fontSize: '0.8rem', color: '#666', margin: '0 0 0.5rem' }}>
            Running an edit forks into a <strong>sandbox</strong>: the edited program animates
            like any other, and any active lesson detaches.
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            aria-label="Program source"
            style={{
              width: '100%',
              minHeight: '11rem',
              resize: 'vertical',
              boxSizing: 'border-box',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '0.85rem',
              lineHeight: 1.5,
              padding: '0.5rem',
              border: '1px solid #ccc',
              borderRadius: 6,
            }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            <button
              style={{ ...btn, borderColor: '#1e6fe0', background: '#1e6fe0', color: '#fff' }}
              onClick={onRun}
              title="Assemble and run the edited program (forks to a sandbox)"
            >
              ▶ Run edit
            </button>
            <button
              style={{ ...btn, opacity: canRevert ? 1 : 0.5 }}
              onClick={onRevert}
              disabled={!canRevert}
              title={originName ? `Discard edits and reload ${originName}` : 'Nothing to revert'}
            >
              ↩ Revert{originName ? ` to ${originName}` : ''}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The explanation-depth dial (axis B, handoff §4): essentials → detailed → expert. Changes how
 *  much datapath detail is drawn; the engine and trace are unaffected (INV-2). */
function DepthDial(props: { tier: DepthTier; setTier: (t: DepthTier) => void }): React.JSX.Element {
  const { tier, setTier } = props;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          fontSize: '0.72rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: '#888',
        }}
      >
        Depth
      </span>
      <div style={{ display: 'flex', gap: 3 }}>
        {DEPTH_TIERS.map((t) => {
          const on = t === tier;
          return (
            <button
              key={t}
              onClick={() => setTier(t)}
              title={`${t} depth`}
              style={{
                fontSize: '0.72rem',
                padding: '0.15rem 0.5rem',
                borderRadius: 5,
                textTransform: 'capitalize',
                border: `1px solid ${on ? '#1e6fe0' : '#ccc'}`,
                background: on ? '#1e6fe0' : '#f7f7f9',
                color: on ? '#fff' : '#555',
                cursor: 'pointer',
              }}
            >
              {t}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Transport controls: step/back/run/reset buttons, a status line, and the scrub slider. */
function Transport(props: {
  sim: ReturnType<typeof useSimulator>;
  atStart: boolean;
  lastCycle: number;
  inFlight: InstructionInstance | null;
}): React.JSX.Element {
  const { sim, atStart, lastCycle, inFlight } = props;
  const btn: React.CSSProperties = {
    fontSize: '0.9rem',
    padding: '0.35rem 0.7rem',
    borderRadius: 6,
    border: '1px solid #bbb',
    background: '#f7f7f9',
    cursor: 'pointer',
  };
  return (
    <div style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={btn} onClick={sim.reset} disabled={atStart} title="Back to start">
          ⏮ reset
        </button>
        <button style={btn} onClick={sim.stepBack} disabled={atStart} title="Step back one cycle">
          ◀ back
        </button>
        <button
          style={btn}
          onClick={sim.stepForward}
          disabled={sim.atEnd}
          title="Step forward one cycle"
        >
          step ▶
        </button>
        <button style={btn} onClick={sim.runToEnd} disabled={sim.atEnd} title="Run to completion">
          run ⏭
        </button>
        <span
          style={{ marginLeft: '0.5rem', fontFamily: 'ui-monospace, monospace', color: '#444' }}
        >
          {atStart ? 'start (pre-run)' : `cycle ${sim.cursor} / ${lastCycle}`}
          {sim.atEnd ? '  — halted' : ''}
        </span>
        {inFlight ? (
          <span
            style={{ color: '#666', fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}
          >
            {formatInstruction(inFlight.decoded)}
          </span>
        ) : null}
      </div>
      <input
        type="range"
        min={-1}
        max={Math.max(lastCycle, -1)}
        value={sim.cursor}
        onChange={(e) => sim.scrubTo(Number(e.target.value))}
        style={{ width: '100%', marginTop: '0.6rem' }}
        aria-label="Scrub timeline"
      />
    </div>
  );
}

/** A single-message notice (e.g. a runtime "ran too long" report), styled like {@link ErrorBox}. */
function NoticeBox(props: { title: string; message: string }): React.JSX.Element {
  return (
    <div
      style={{
        marginTop: '1rem',
        border: '1px solid #e0b4b4',
        background: '#fff6f6',
        borderRadius: 8,
        padding: '0.75rem 1rem',
      }}
    >
      <strong style={{ color: '#a33' }}>{props.title}</strong>
      <p style={{ fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{props.message}</p>
    </div>
  );
}

/** Located assembler diagnostics, shown when a program fails to assemble. */
function ErrorBox(props: { errors: AssemblerError[] }): React.JSX.Element {
  return (
    <div
      style={{
        marginTop: '1rem',
        border: '1px solid #e0b4b4',
        background: '#fff6f6',
        borderRadius: 8,
        padding: '0.75rem 1rem',
      }}
    >
      <strong style={{ color: '#a33' }}>Assembler errors</strong>
      <ul
        style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem', margin: '0.5rem 0 0' }}
      >
        {props.errors.map((err, i) => (
          <li key={i}>
            {err.line}:{err.column} — {err.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
