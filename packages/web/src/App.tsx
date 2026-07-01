import type { AssemblerError } from '@cpu-viz/assembler';
import type { InstructionInstance } from '@cpu-viz/trace';
import { useMemo } from 'react';
import { Datapath } from './DatapathView';
import { formatInstruction } from './format';
import { MemoryPanel, RegisterPanel, SourcePanel } from './panels';
import { EXAMPLE_PROGRAMS } from './programs';
import { useSimulator } from './useSimulator';

/**
 * The M1 step-7 web shell: load an example program, drive the single-cycle engine through the
 * {@link useSimulator} recorder, and show the source↔machine-code, register, and memory panels.
 * Everything shown is read from the recorded trace at the current cursor, so stepping forward,
 * stepping back, and scrubbing always display the exact recorded state (acceptance §11). The
 * SVG datapath view and depth tiers are later build-order steps (8–9).
 */
export function App(): React.JSX.Element {
  const sim = useSimulator();

  const source = useMemo(
    () => EXAMPLE_PROGRAMS.find((p) => p.name === sim.programName)?.source ?? '',
    [sim.programName],
  );

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
        <label style={{ marginLeft: 'auto' }}>
          Program:{' '}
          <select
            value={sim.programName ?? ''}
            onChange={(e) => sim.select(e.target.value)}
            style={{ fontSize: '0.95rem', padding: '0.2rem' }}
          >
            {EXAMPLE_PROGRAMS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      {sim.errors ? (
        <ErrorBox errors={sim.errors} />
      ) : (
        <>
          <Transport sim={sim} atStart={atStart} lastCycle={lastCycle} inFlight={inFlight} />

          <Datapath trace={sim.cycleTrace} cycleKey={sim.cursor} />

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
              <SourcePanel program={sim.program} source={source} activeLine={activeLine} />
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
