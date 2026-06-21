import { decode } from '@cpu-viz/isa';
import { useMemo, useState } from 'react';
import { formatInstruction } from './format';

/**
 * Scaffold preview: type a 32-bit RV32I instruction word in hex and watch it decode.
 * This proves the web -> isa wiring end-to-end. The real datapath view, panels, and
 * depth-tier renderer are M1 build-order steps 7-9 (handoff §11).
 */
export function App() {
  const [hex, setHex] = useState('00500093'); // addi x1, x0, 5

  const decoded = useMemo(() => {
    const word = Number.parseInt(hex, 16);
    return Number.isNaN(word) ? null : decode(word >>> 0);
  }, [hex]);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '2rem auto' }}>
      <h1>CPU Visualizer</h1>
      <p>Scaffold preview — enter a 32-bit RV32I instruction word (hex):</p>
      <input
        value={hex}
        onChange={(e) => setHex(e.target.value)}
        spellCheck={false}
        style={{ fontFamily: 'monospace', fontSize: '1rem', padding: '0.4rem', width: '12rem' }}
      />
      <pre style={{ fontSize: '1.1rem' }}>
        {decoded ? formatInstruction(decoded) : 'invalid hex'}
      </pre>
    </main>
  );
}
