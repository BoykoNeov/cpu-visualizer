import type { AssemblerError } from '@cpu-viz/assembler';
import { DEPTH_TIERS, type DepthTier } from '@cpu-viz/curriculum';
import type { InstructionInstance } from '@cpu-viz/trace';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Datapath } from './DatapathView';
import { formatInstruction } from './format';
import { IsaReference } from './IsaReference';
import { LESSONS } from './lessons';
import { MODELS, modelById } from './models';
import { MultiCycleDatapath } from './MultiCycleDatapathView';
import { PipelineDatapath } from './PipelineDatapathView';
import { narrationView, type NarrationView } from './narration';
import { MemoryPanel, RegisterPanel, SourcePanel } from './panels';
import { hasOverlap } from './pipeline-map';
import { PipelineMap } from './PipelineMapView';
import { EXAMPLE_PROGRAMS } from './programs';
import { predictsTaken, type BranchPrediction } from './session';
import { getThemeChoice, MONO, setThemeChoice, T, type ThemeChoice } from './theme';
import { useSimulator } from './useSimulator';

/** Sentinel `<select>` value for the sandbox state — no corpus program is selected. */
const SANDBOX_OPTION = '__sandbox__';

/**
 * Which single in-flight instruction the transport chip names and the source panel highlights — the
 * shell's answer to "which one am I looking at" when the machine is running five at once.
 *
 * Two rules, and the second is what makes follow mean anything outside the map:
 *
 *   - **By default, `instructions[0]`** — pinned as program order, oldest first, so this is the one
 *     nearest RETIREMENT. On single-cycle and multi-cycle it is the only instruction in flight; on
 *     the pipeline it is the WB occupant, with up to four younger ones behind it. Lawful
 *     simplification, not contradiction (INV-5): the line shown IS in flight, it just isn't the
 *     whole story — which is what the map and the `N in flight` qualifier are for.
 *   - **Following retargets it.** Pick an instruction on the map and these surfaces track IT
 *     through the pipe instead of whichever one happens to be retiring. When the followed
 *     instruction is not in flight this cycle there is nothing to retarget to, so it falls back
 *     rather than highlighting a line that is not running.
 *
 * A pure function, and extracted rather than left inline, because "the shell happens to show the
 * oldest" is a real user-visible choice that deserves a pin instead of being rediscovered by
 * whoever wonders why the highlight lags the fetch by four lines.
 */
export function shownInstruction(
  instructions: readonly InstructionInstance[],
  followed: string | null,
): InstructionInstance | null {
  const target = followed === null ? undefined : instructions.find((i) => i.id === followed);
  return target ?? instructions[0] ?? null;
}

/**
 * The web shell: load an example program, drive the SELECTED microarchitecture (single-cycle or
 * multi-cycle, chosen in the Model picker — M2 step 5a) through the {@link useSimulator} recorder,
 * and show the source↔machine-code, register, and memory panels. Everything shown is read from the
 * recorded trace at the current cursor, so stepping forward, stepping back, and scrubbing always
 * display the exact recorded state (acceptance §11) — and because the panels read only the trace
 * (INV-3), they animate against whichever model is selected unchanged. Each model has its OWN
 * hand-authored SVG datapath (single-cycle: M1 step 8; multi-cycle: M2 step 5b), dispatched on
 * {@link ModelChoice.datapath}; a model with no bespoke view falls back to a placeholder. The
 * depth-tier dial (step 9, axis B / handoff §4) is a pure view concern — the engine and trace are
 * oblivious to it (INV-2).
 */
export function App(): React.JSX.Element {
  const sim = useSimulator();
  // Explanation depth (axis B, handoff §4) — a view/curriculum concern only; the engine is
  // oblivious (INV-2). On single-cycle the tier changes the datapath's representational detail:
  // `essentials` shows the bare lit path, `detailed` (default) adds the value on each active wire,
  // `expert` adds the mux control-line labels.
  const [tier, setTier] = useState<DepthTier>('detailed');

  // The microarchitecture currently driving the recording (INV-3: the panels read only the trace,
  // so they animate against whichever model is selected). Its `datapath` kind selects which bespoke
  // SVG datapath renders below — each model has its own geometry (lighting one model's datapath with
  // another's trace would paint a contradictory picture, an INV-5 violation).
  const activeModel = modelById(sim.model);

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

  // "Follow this instruction" (INV-4, M3 step 7): the stable id the map, the datapath, and the
  // source panel all key on, or `null`. View state — the engine and trace know nothing of it
  // (INV-2). Cleared whenever a new recording replaces the old one: ids are minted per FETCH, so
  // a re-record under a different config genuinely mints different ones (the two forwarding
  // positions do not even fetch the same number of doomed shadows), and a stale id would leave the
  // shell claiming to follow something that no longer exists. Keyed on the recording's identity —
  // a fresh load builds a fresh recorder, and so a fresh array.
  const [followed, setFollowed] = useState<string | null>(null);
  useEffect(() => setFollowed(null), [sim.recorded]);

  // The instruction the transport chip names and the source panel highlights (see
  // {@link shownInstruction} for the rule and why it is one).
  const inFlight = shownInstruction(sim.cycleTrace?.instructions ?? [], followed);
  const followingNow = inFlight !== null && inFlight.id === followed;
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
        maxWidth: 1200,
        margin: '1.5rem auto',
        padding: '0 1rem',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', margin: 0 }}>CPU Visualizer</h1>
        <span style={{ color: T.ink3 }}>{activeModel.description}</span>
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
            Model:{' '}
            <select value={sim.model} onChange={(e) => sim.setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Program:{' '}
            <select
              value={sim.sandbox ? SANDBOX_OPTION : (sim.programName ?? '')}
              onChange={(e) => sim.select(e.target.value)}
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
            >
              <option value="">— none —</option>
              {LESSONS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
          <ThemeToggle />
        </div>
      </header>

      {/* The session chip and the machine's config knobs share one row — and the knobs live HERE
          rather than in the header beside the Model picker because the header cannot hold them.

          Measured, in a real browser at the 1200px content width, because this is exactly the kind
          of claim that reads as taste: the five universal controls plus these two want ~1450px of a
          1200px row, so picking the pipeline made `flex-wrap` do the only thing it can — `Lesson`
          and the theme toggle were thrown onto a second line, `Lesson` moving 712px left and 50px
          down, and every surface below the header falling 51px. A reader picking a new model expects
          the PICTURE to change; they do not expect the control they just used to leave the place
          they left it. The seven do not fit and no arrangement of them does, so the honest fix is
          for the model-dependent pair to stop competing for that row at all.

          This row is the right home because it already exists on every model — the chip is never
          absent (free play, lesson, and sandbox all render one) — so the knobs appear in space that
          was already there and reserved for nothing: no new row, and nothing below moves. Which is
          the whole ask. It reads as a bar, too: what session you are in, and what machine you are in
          it with.

          Right-anchored (`marginLeft: auto`) so the CHIP's width cannot jitter them either — it
          genuinely varies, the sandbox chip being a full sentence where free-play is two words. The
          same trick the header already uses on its own control group, and the reason the header
          survives the model description changing width underneath it. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
          marginTop: '0.75rem',
        }}
      >
        <ModeChip sim={sim} />
        {/* Only for a model that actually honors the config — absent, not disabled, elsewhere:
            a control that cannot move anything is worse than no control. */}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: '1.25rem',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          {activeModel.capabilities.configurableForwarding ? (
            <ForwardingToggle on={sim.forwarding} setOn={sim.setForwarding} />
          ) : null}
          {activeModel.capabilities.configurableBranchPrediction ? (
            <PredictionToggle scheme={sim.branchPrediction} setScheme={sim.setBranchPrediction} />
          ) : null}
        </div>
      </div>

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
          <Transport
            sim={sim}
            atStart={atStart}
            lastCycle={lastCycle}
            inFlight={inFlight}
            following={followingNow}
          />

          {sim.activeLesson && narration ? (
            <NarrationPanel
              title={sim.activeLesson.title}
              view={narration}
              tier={tier}
              onSeek={sim.scrubTo}
            />
          ) : null}

          {/* The pipeline map (M3 step 7), directly under the transport and ABOVE the datapath —
              placement found by the browser eyeball, not by a test. The map is a TIMELINE surface:
              its playhead IS the scrub cursor, so its natural neighbour is the scrub bar. Below the
              datapath it sat ~880px down a 900px viewport, which put the one picture this tier
              exists for (five instructions overlapping) off-screen behind the 490px diagram, and
              broke the link between the slider you drag and the playhead that answers it. Costs the
              other models nothing — they never render it.

              Gated on the TRACE, not the model: the map shows instructions overlapping in time, so
              it appears exactly when they do. Single-cycle and multi-cycle carry one instruction per
              cycle by construction, so it never appears for them — without this file naming either
              of them (INV-3), and a future model gets it for free. The same shape as the transport's
              `N in flight` qualifier. */}
          {hasOverlap(sim.recorded) ? (
            <PipelineMap
              recorded={sim.recorded}
              cursor={sim.cursor}
              followed={followed}
              onFollow={setFollowed}
              onSeek={sim.scrubTo}
            />
          ) : null}

          {activeModel.datapath === 'single-cycle' ? (
            <Datapath trace={sim.cycleTrace} cycleKey={sim.cursor} tier={tier} />
          ) : activeModel.datapath === 'multi-cycle' ? (
            <MultiCycleDatapath trace={sim.cycleTrace} cycleKey={sim.cursor} tier={tier} />
          ) : activeModel.datapath === 'pipeline' ? (
            // The only datapath that takes the engine CONFIG as well as the tier: with forwarding
            // off the forwarding network is absent, not idle (INV-5 — the trace has no `forward`
            // events to draw), and with prediction on the bet's adder and redirect appear. The view
            // already holds both positions; the user set them.
            //
            // `predictsTaken` collapses the knob HERE, at the shell's edge, exactly once: three
            // scheme names, two machines, and a diagram can only draw a machine.
            <PipelineDatapath
              trace={sim.cycleTrace}
              cycleKey={sim.cursor}
              tier={tier}
              config={{
                forwarding: sim.forwarding,
                predictTaken: predictsTaken(sim.branchPrediction),
              }}
              followed={followed}
            />
          ) : (
            <DatapathPlaceholder modelLabel={activeModel.label} />
          )}

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
            <p style={{ color: T.ink3 }}>Loading…</p>
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
 *
 * Owns no vertical margin: it is a flex item in the status row (see the call site), which sits the
 * machine's config knobs beside it and so owns the spacing for the pair.
 */
function ModeChip(props: { sim: ReturnType<typeof useSimulator> }): React.JSX.Element | null {
  const { sim } = props;
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: '0.82rem',
    padding: '0.2rem 0.6rem',
    borderRadius: 999,
    border: '1px solid',
  };
  if (sim.sandbox) {
    return (
      <div style={{ ...base, borderColor: T.warnBorder, background: T.warnBg, color: T.warnInk }}>
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
      <div style={{ ...base, borderColor: T.accentLine, background: T.accentSoft, color: T.ink }}>
        <strong style={{ color: T.accent }}>Lesson</strong>
        <span>{sim.activeLesson.title}</span>
      </div>
    );
  }
  return (
    <div style={{ ...base, borderColor: T.line2, background: T.surface2, color: T.ink2 }}>
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
          fontFamily: MONO,
          background: T.codeBg,
          color: T.codeInk,
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

  // Every state the narration paragraph below can be in, as a list: the pre-start prompt, then one
  // entry per playable step. All of them are rendered and only `shown` is visible — see the stack's
  // comment for why. Built here rather than inline so the list is one thing: the reserved height is
  // the max over THIS array, so anything that can appear in that paragraph has to be in it, and a
  // state that got its text from somewhere else would be the one that jumps.
  const slots: { key: string; body: React.ReactNode }[] = [
    {
      key: 'prompt',
      body: (
        <span style={{ color: T.ink2 }}>
          Press <strong>Next step ▶</strong> or scrub the timeline to walk through the lesson.
        </span>
      ),
    },
    ...view.steps.map((s) => ({
      key: `step${s.index}`,
      body:
        s.narration !== undefined ? (
          renderNarration(s.narration)
        ) : (
          <span style={{ color: T.ink2 }}>
            This step has no narration at the current depth — raise the depth dial for more.
          </span>
        ),
    })),
  ];
  const shown = current + 1; // the prompt occupies slot 0, so `current === -1` lands on it

  const btn: React.CSSProperties = {
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: 6,
    border: `1px solid ${T.accentLine}`,
    background: T.surface,
    color: T.accent,
    cursor: 'pointer',
  };
  return (
    <section
      aria-label="Lesson narration"
      style={{
        marginTop: '1rem',
        border: `1px solid ${T.accentLine}`,
        background: T.accentSoft,
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
            color: T.accent,
            fontWeight: 700,
          }}
        >
          Lesson
        </span>
        <strong style={{ color: T.ink, fontSize: '1rem' }}>{title}</strong>
        <span style={{ marginLeft: 'auto', color: T.ink2, fontSize: '0.85rem' }}>
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
                border: `2px solid ${state === 'future' ? T.accentLine : T.accent}`,
                background:
                  state === 'active' ? T.accent : state === 'past' ? T.accentSoft : T.surface,
                color: state === 'active' ? T.accentInk : T.accent,
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

      {/* The active step's narration, or a prompt when the lesson hasn't started / has no text at
          this depth — and EVERY OTHER STEP'S, stacked invisibly behind it in the same grid cell.

          The stack is the whole point, and it is the fix for the one defect the browser found here:
          the steps are prose, so they are one to five lines long, and rendering only the active one
          made this paragraph 128px on step 1 and 228px on step 5. Everything below it — the pipeline
          map, the datapath, the register and memory panels — is laid out after it in normal flow, so
          each Next-step JUMPED the page by up to 100px. Measured, because this is exactly the kind of
          claim that reads as taste: the map's own height is CONSTANT across a lesson (its grid is a
          pure function of the recording), and it still moved 469→570px down the page. It was a
          passenger, not a cause. A reader walking a lesson is comparing pictures between steps, and a
          surface that relocates under them each time is the surface failing at the one thing this
          milestone shipped it for.

          Grid, not a `min-height`: the reserved height is then DERIVED — the tallest step at the
          current tier, at the current window width, with the current fonts — rather than a magic
          number that some future lesson's longer prose silently outgrows. Nothing here counts lines
          or knows what a line is. The cost is honest and bounded: a short step sits above the
          whitespace its lesson's longest one needs, and the panel resizes when you switch lesson or
          move the depth dial, which are deliberate acts rather than jitter.

          `visibility: hidden` and not `display: none`: hidden is what makes it occupy the cell (the
          reserve IS the mechanism), and it takes the ghosts out of the accessibility tree on the way,
          so a screen reader still reads exactly one narration. */}
      <div style={{ display: 'grid', margin: '0.75rem 0 0' }}>
        {slots.map((slot, i) => (
          <p
            key={slot.key}
            style={{
              gridArea: '1 / 1',
              margin: 0,
              lineHeight: 1.55,
              color: T.ink,
              visibility: i === shown ? 'visible' : 'hidden',
            }}
          >
            {slot.body}
          </p>
        ))}
      </div>
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
  const textarea = useRef<HTMLTextAreaElement>(null);

  /**
   * Drop a reference example into the program where the caret is. Insert-at-caret rather than
   * append, because the line a learner wants is almost never wanted at the end of the file — and
   * a reference that only tells you things is still a blank page if you cannot act on it.
   *
   * Falls back to appending when the textarea has never been focused (no caret to insert at).
   */
  const insertAtCursor = (text: string): void => {
    const el = textarea.current;
    if (!el) {
      setDraft(`${draft}\n${text}`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const line = `    ${text}\n`;
    setDraft(draft.slice(0, start) + line + draft.slice(end));
    // Restore focus and park the caret after the inserted line, so several clicks in a row
    // stack up into a program instead of each overwriting the last one's position.
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + line.length;
    });
  };

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <button
        className="btn"
        style={{ fontSize: '0.85rem', background: open ? T.accentSoft : undefined }}
        onClick={onToggle}
      >
        ✎ Edit program {open ? '▲' : '▼'}
      </button>
      {open ? (
        <div className="panel" style={{ marginTop: '0.5rem' }}>
          <p style={{ fontSize: '0.8rem', color: T.ink2, margin: '0 0 0.5rem' }}>
            Running an edit forks into a <strong>sandbox</strong>: the edited program animates like
            any other, and any active lesson detaches.
          </p>
          <textarea
            ref={textarea}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            aria-label="Program source"
            style={{
              width: '100%',
              minHeight: '11rem',
              resize: 'vertical',
              fontFamily: MONO,
              fontSize: '0.85rem',
              lineHeight: 1.5,
              padding: '0.5rem',
            }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className="btn btn--primary"
              style={{ fontSize: '0.85rem' }}
              onClick={onRun}
              title="Assemble and run the edited program (forks to a sandbox)"
            >
              ▶ Run edit
            </button>
            <button
              className="btn"
              style={{ fontSize: '0.85rem' }}
              onClick={onRevert}
              disabled={!canRevert}
              title={originName ? `Discard edits and reload ${originName}` : 'Nothing to revert'}
            >
              ↩ Revert{originName ? ` to ${originName}` : ''}
            </button>
          </div>
          <IsaReference onInsert={insertAtCursor} />
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
          color: T.ink3,
        }}
      >
        Depth
      </span>
      <div className="seg">
        {DEPTH_TIERS.map((t) => (
          <button
            key={t}
            className={t === tier ? 'seg-btn seg-btn--on' : 'seg-btn'}
            onClick={() => setTier(t)}
            title={`${t} depth`}
            style={{ textTransform: 'capitalize' }}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The forwarding toggle (M3 step 5) — the spec's flagship experiment (§12.2): "watch a RAW hazard
 * stall without forwarding; turn forwarding on and watch the bubble vanish." Unlike the depth dial
 * next to it, this is NOT a view concern: it changes `ProcessorConfig.forwarding`, so the engine
 * re-records the program and the trace genuinely differs (the first model whose trace depends on
 * its config). That is why flipping it parks the cursor back at pre-run — there is a new timeline
 * to walk, not a redrawn picture of the old one.
 *
 * Rendered only where `capabilities.configurableForwarding` is true, so it does not exist for
 * single-cycle or multi-cycle.
 */
function ForwardingToggle(props: { on: boolean; setOn: (on: boolean) => void }): React.JSX.Element {
  const { on, setOn } = props;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          fontSize: '0.72rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: T.ink3,
        }}
      >
        Forwarding
      </span>
      <div className="seg">
        {([false, true] as const).map((position) => (
          <button
            key={String(position)}
            className={position === on ? 'seg-btn seg-btn--on' : 'seg-btn'}
            onClick={() => setOn(position)}
            aria-pressed={position === on}
            title={
              position
                ? 'Forwarding ON — results are routed straight to the next instruction; most RAW stalls vanish (the load-use bubble does not)'
                : 'Forwarding OFF — a RAW hazard interlocks in ID until the producer writes back'
            }
          >
            {position ? 'on' : 'off'}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The branch-prediction toggle (M4 step 4) — the milestone's flagship experiment (§12.3), and the
 * second control to change the MACHINE rather than the picture. Same shape as the forwarding toggle
 * beside it, and that is the finding: prediction rides M3's config seam without widening it.
 *
 * **Two positions for three scheme names, and the arithmetic is the honest part.** The config type
 * offers `'none' | 'static-not-taken' | 'static-taken'`; the pipeline gives them TWO behaviors,
 * because a machine with no predictor does not stop and wait — it keeps fetching, and the
 * fall-through IS the not-taken path (M4 step 1). A three-position control would assert three
 * machines exist. That is not extra detail, it is a contradiction of the tier below it (INV-5), and
 * it fails the rule the forwarding toggle already lives by: *a control that cannot move anything is
 * worse than no control* — two of the three positions could not move anything. So the positions are
 * the BEHAVIORS. `'none'` is unreachable from here (it is only ever the opening value, straight out
 * of `defaultConfig()`), and nothing is lost, because there is no third machine to reach.
 *
 * The completeness of that claim is pinned in `simulator.test.ts` against the engine — the three
 * schemes record exactly TWO distinct traces — so a dynamic scheme joining the union fails a test
 * rather than being silently drawn as "not taken".
 *
 * The `title`s carry M4's two findings, which is where the honesty budget goes: that "no predictor"
 * and "predict not-taken" are one machine, and that a correct bet costs 1 rather than 0 (getting to
 * 0 needs a BTB, deliberately a fancier tier — a true fact about THIS machine, not a bug).
 */
export function PredictionToggle(props: {
  scheme: BranchPrediction;
  setScheme: (scheme: BranchPrediction) => void;
}): React.JSX.Element {
  const { scheme, setScheme } = props;
  const taken = predictsTaken(scheme);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          fontSize: '0.72rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: T.ink3,
        }}
      >
        Predict
      </span>
      <div className="seg">
        {([false, true] as const).map((position) => (
          <button
            key={String(position)}
            className={position === taken ? 'seg-btn seg-btn--on' : 'seg-btn'}
            onClick={() => setScheme(position ? 'static-taken' : 'static-not-taken')}
            aria-pressed={position === taken}
            title={
              position
                ? 'Predict TAKEN — the machine bets in ID and redirects fetch to the branch target. A correct bet costs 1 cycle (not 0 — that needs a branch-target buffer); a wrong one costs 2. jalr can never be predicted: its target is in a register.'
                : 'Predict NOT TAKEN — the machine keeps fetching the next instruction and pays 2 cycles whenever a branch turns out to be taken. This is also what a machine with NO predictor does: the fall-through IS the not-taken path.'
            }
          >
            {position ? 'taken' : 'not taken'}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Light/dark toggle. Cycles auto (follow the OS) → light → dark; the choice is stamped on <html>
 * and persisted by {@link setThemeChoice}. Every color in the app is a token from styles.css, so
 * the whole shell — SVG datapaths included — follows the stamp.
 */
function ThemeToggle(): React.JSX.Element {
  const [choice, setChoice] = useState<ThemeChoice>(() => getThemeChoice());
  const next: Record<ThemeChoice, ThemeChoice> = { auto: 'light', light: 'dark', dark: 'auto' };
  const icon = { auto: '◐', light: '☀', dark: '☾' }[choice];
  return (
    <button
      className="btn"
      style={{ fontSize: '0.85rem' }}
      onClick={() => {
        const c = next[choice];
        setThemeChoice(c);
        setChoice(c);
      }}
      title={`Theme: ${choice} — click to switch to ${next[choice]}`}
      aria-label={`Theme: ${choice}`}
    >
      {icon} {choice}
    </button>
  );
}

/** Transport controls: step/back/run/reset buttons, a status line, and the scrub slider. */
function Transport(props: {
  sim: ReturnType<typeof useSimulator>;
  atStart: boolean;
  lastCycle: number;
  inFlight: InstructionInstance | null;
  /** True when {@link inFlight} is the FOLLOWED instruction rather than the default retiring one —
   *  the qualifier below must not call it "nearest retirement" when the user picked it. */
  following: boolean;
}): React.JSX.Element {
  const { sim, atStart, lastCycle, inFlight, following } = props;
  const inFlightCount = sim.cycleTrace?.instructions.length ?? 0;
  return (
    <div style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn" onClick={sim.reset} disabled={atStart} title="Back to start">
          ⏮ reset
        </button>
        <button
          className="btn"
          onClick={sim.stepBack}
          disabled={atStart}
          title="Step back one cycle"
        >
          ◀ back
        </button>
        <button
          className="btn"
          onClick={sim.stepForward}
          disabled={sim.atEnd}
          title="Step forward one cycle"
        >
          step ▶
        </button>
        <button
          className="btn"
          onClick={sim.runToEnd}
          disabled={sim.atEnd}
          title="Run to completion"
        >
          run ⏭
        </button>
        <span style={{ marginLeft: '0.5rem', fontFamily: MONO, color: T.ink2 }}>
          {atStart ? 'start (pre-run)' : `cycle ${sim.cursor} / ${lastCycle}`}
          {sim.atEnd ? '  — halted' : ''}
        </span>
        {inFlight ? (
          <span style={{ color: T.ink2, fontFamily: MONO, fontSize: '0.85rem' }}>
            {formatInstruction(inFlight.decoded)}
          </span>
        ) : null}
        {/* Qualify the instruction above exactly when it is NOT the whole story — i.e. when more
            than one is in flight. Derived purely from the trace (INV-3) with no model knowledge:
            single-cycle and multi-cycle always have exactly one occupant, so this never appears
            for them; the pipeline qualifies itself. Without it the shell shows one instruction
            while the header promises five, and the reader has no way to tell that the line
            highlighted is the one RETIRING rather than the only one running — which reads as "a
            pipeline is just a slow single-cycle", the exact misconception this tier exists to
            break. The map below now shows all of them; this stays because the map answers "what is
            the whole run" and this answers "which one am I looking at". */}
        {inFlightCount > 1 ? (
          <span
            style={{ color: following ? T.ink2 : T.ink3, fontFamily: MONO, fontSize: '0.8rem' }}
            title={
              following
                ? `${inFlightCount} instructions are in flight this cycle. You are FOLLOWING the one named above, now in ${inFlight?.location} — the map and datapath ring it too. Clear it on the map to go back to the retiring instruction.`
                : `${inFlightCount} instructions are in flight this cycle; the one named above is in ${inFlight?.location} (nearest retirement). The map below shows all of them — click a cell to follow one.`
            }
          >
            {following ? 'following' : 'in'} {inFlight?.location} · {inFlightCount} in flight
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

/**
 * Stand-in shown in place of the SVG datapath for a model whose `datapath` kind is `'none'` — a
 * microarchitecture with no bespoke geometry authored yet (single-cycle and multi-cycle both have
 * one; a future tier that doesn't would land here). Deliberately NOT another model's datapath: that
 * geometry lit by this model's trace would contradict it (INV-5). The transport, register, and
 * memory panels still animate the run cycle-by-cycle.
 */
function DatapathPlaceholder(props: { modelLabel: string }): React.JSX.Element {
  return (
    <div
      style={{
        marginTop: '1rem',
        border: `1px dashed ${T.line2}`,
        background: T.surface,
        borderRadius: 10,
        padding: '1.25rem 1.25rem',
        color: T.ink2,
        textAlign: 'center',
      }}
    >
      <div style={{ fontWeight: 700, color: T.ink, marginBottom: '0.35rem' }}>
        {props.modelLabel} datapath — coming soon
      </div>
      <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5 }}>
        This model’s datapath diagram is on the way. Meanwhile, step or scrub the timeline below and
        watch the register and memory panels.
      </p>
    </div>
  );
}

/** A single-message notice (e.g. a runtime "ran too long" report), styled like {@link ErrorBox}. */
function NoticeBox(props: { title: string; message: string }): React.JSX.Element {
  return (
    <div
      style={{
        marginTop: '1rem',
        border: `1px solid ${T.danger}`,
        background: T.dangerBg,
        borderRadius: 8,
        padding: '0.75rem 1rem',
      }}
    >
      <strong style={{ color: T.danger }}>{props.title}</strong>
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
        border: `1px solid ${T.danger}`,
        background: T.dangerBg,
        borderRadius: 8,
        padding: '0.75rem 1rem',
      }}
    >
      <strong style={{ color: T.danger }}>Assembler errors</strong>
      <ul style={{ fontFamily: MONO, fontSize: '0.85rem', margin: '0.5rem 0 0' }}>
        {props.errors.map((err, i) => (
          <li key={i}>
            {err.line}:{err.column} — {err.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
