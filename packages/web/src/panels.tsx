/**
 * The three read-only display panels of the step-7 shell (handoff §11): source↔machine-code,
 * registers, and memory. Each is a pure function of the architectural state at the cursor —
 * they receive already-read `MachineState` / trace slices from {@link useSimulator} and never
 * touch the engine or recorder themselves (INV-3).
 */

import { DATA_BASE, TEXT_BASE, type AssembledProgram } from '@cpu-viz/assembler';
import type { MachineState } from '@cpu-viz/trace';
import { ABI_REGISTER_NAMES, hex32 } from './format';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } as const;

const panelStyle: React.CSSProperties = {
  border: '1px solid #d0d0d8',
  borderRadius: 8,
  padding: '0.75rem 1rem',
  background: '#fff',
};

const headingStyle: React.CSSProperties = {
  margin: '0 0 0.5rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#555',
};

const highlight = '#fff4d6'; // pale amber for "touched this cycle"

/**
 * Source ↔ machine-code panel. Renders the assembly the user wrote, and beside each line the
 * 32-bit word(s) it assembled to (a pseudo-instruction like `li` maps two words to one line).
 * The line currently in-flight is highlighted.
 */
export function SourcePanel(props: {
  program: AssembledProgram;
  source: string;
  activeLine: number | null;
}): React.JSX.Element {
  const { program, source, activeLine } = props;

  // Invert the address→line source map into line→[{ addr, word }] for side-by-side display.
  const wordsByLine = new Map<number, { addr: number; word: number }[]>();
  program.words.forEach((word, i) => {
    const addr = (TEXT_BASE + i * 4) >>> 0;
    const line = program.sourceMap.get(addr);
    if (line === undefined) return;
    const list = wordsByLine.get(line) ?? [];
    list.push({ addr, word });
    wordsByLine.set(line, list);
  });

  const lines = source.replace(/\n$/, '').split('\n');

  return (
    <section style={panelStyle}>
      <h2 style={headingStyle}>Source ↔ machine code</h2>
      <table style={{ ...mono, borderCollapse: 'collapse', fontSize: '0.85rem', width: '100%' }}>
        <tbody>
          {lines.map((text, i) => {
            const lineNo = i + 1;
            const words = wordsByLine.get(lineNo) ?? [];
            const isActive = activeLine === lineNo;
            return (
              <tr key={lineNo} style={isActive ? { background: highlight } : undefined}>
                <td
                  style={{ color: '#aaa', textAlign: 'right', paddingRight: 8, userSelect: 'none' }}
                >
                  {lineNo}
                </td>
                <td style={{ color: '#0a7', whiteSpace: 'pre', paddingRight: 12 }}>
                  {words.map((w) => hex32(w.word)).join(' ')}
                </td>
                <td style={{ whiteSpace: 'pre' }}>{text || ' '}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Register file panel: `pc` plus all 32 GPRs (ABI name + `xN` + hex + signed decimal).
 * Registers written during the current cycle are highlighted so the effect of the step is
 * visible at a glance.
 */
export function RegisterPanel(props: {
  state: MachineState;
  writtenRegs: ReadonlySet<number>;
}): React.JSX.Element {
  const { state, writtenRegs } = props;
  return (
    <section style={panelStyle}>
      <h2 style={headingStyle}>Registers</h2>
      <div style={{ ...mono, fontSize: '0.8rem', marginBottom: 6, color: '#333' }}>
        <strong>pc</strong> {hex32(state.pc)}
      </div>
      <table style={{ ...mono, borderCollapse: 'collapse', fontSize: '0.78rem', width: '100%' }}>
        <tbody>
          {Array.from({ length: 32 }, (_, r) => {
            const value = state.registers[r]!;
            return (
              <tr key={r} style={writtenRegs.has(r) ? { background: highlight } : undefined}>
                <td style={{ color: '#333', paddingRight: 6 }}>{ABI_REGISTER_NAMES[r]}</td>
                <td style={{ color: '#aaa', paddingRight: 10 }}>x{r}</td>
                <td style={{ textAlign: 'right', paddingRight: 10 }}>{hex32(value)}</td>
                <td style={{ textAlign: 'right', color: '#666' }}>{value}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Data-memory panel. The flat memory model stores instruction words at `TEXT_BASE` too, so
 * `definedAddresses()` includes text (decisions log: "definedAddresses() legitimately
 * includes text") — windowing that out is the view's job (INV-2/INV-3). We show only the
 * data region (`addr >= DATA_BASE`); the instruction words already appear in the source panel.
 */
export function MemoryPanel(props: { state: MachineState }): React.JSX.Element {
  // `definedAddresses()` already returns a sorted array and `.filter` copies it, so the data
  // window is sorted without a further `.slice().sort()`.
  const addrs = props.state.memory.definedAddresses().filter((a) => a >= DATA_BASE);
  return (
    <section style={panelStyle}>
      <h2 style={headingStyle}>Data memory</h2>
      {addrs.length === 0 ? (
        <p style={{ ...mono, fontSize: '0.8rem', color: '#999', margin: 0 }}>
          no data memory written
        </p>
      ) : (
        <table style={{ ...mono, borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
          <tbody>
            {addrs.map((addr) => {
              const word = props.state.memory.readWord(addr);
              return (
                <tr key={addr}>
                  <td style={{ color: '#a60', paddingRight: 12 }}>{hex32(addr)}</td>
                  <td style={{ textAlign: 'right', paddingRight: 12 }}>{hex32(word)}</td>
                  <td style={{ textAlign: 'right', color: '#666' }}>{word | 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
