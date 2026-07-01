import type { CycleTrace } from '@cpu-viz/trace';
import { describe, expect, it } from 'vitest';
import { activate, NODES, phaseVisibleAt, WIRES } from './datapath';
import { loadSource } from './simulator';

/**
 * The datapath activation is the one headlessly-testable seam of the SVG view (the geometry
 * and the rendering itself are checked by eye via `npm run dev`, as in step 7). We drive the
 * REAL single-cycle engine through the recorder and assert that {@link activate} lights the
 * right components/wires for three instructions chosen to expose the gaps an event-only
 * mapping would miss:
 *   - a LOAD   — full fetch→writeback path through data memory,
 *   - a BRANCH — no memory, no writeback, but the PC-select path is live,
 *   - `lui`    — emits NO reg-read and NO alu-op, yet must still show imm → writeback.
 */

/** Assemble `source`, run its first instruction, and return that cycle's trace. */
function firstCycle(source: string): CycleTrace {
  const result = loadSource(`${source}\n  li a7, 10\n  ecall\n`);
  if (!result.ok) throw new Error(`assembly failed: ${result.errors[0]?.message}`);
  const { recorder } = result.loaded;
  recorder.stepForward();
  const trace = recorder.current();
  if (!trace) throw new Error('no trace at cycle 0');
  return trace;
}

describe('datapath geometry', () => {
  it('every wire endpoint prefix names a real node where it is a node id', () => {
    // Each wire id is `a-b`; when a part matches a node id it must resolve (the activation
    // relies on this to light the components a wire touches).
    for (const wire of WIRES) {
      for (const part of wire.id.split('-')) {
        if (NODES.has(part)) expect(NODES.get(part)).toBeDefined();
      }
    }
    // Sanity: the canonical components are all present.
    for (const id of ['pc', 'imem', 'regfile', 'immgen', 'alu', 'dmem', 'wbmux', 'branchadd']) {
      expect(NODES.has(id), `missing node ${id}`).toBe(true);
    }
  });
});

describe('phaseVisibleAt (within-cycle progressive reveal)', () => {
  it('reveals a stage only once the stepper has reached it', () => {
    // Earlier-or-equal phases are visible; later ones are hidden until the stepper advances.
    expect(phaseVisibleAt('IF', 'EX')).toBe(true);
    expect(phaseVisibleAt('EX', 'EX')).toBe(true);
    expect(phaseVisibleAt('WB', 'ID')).toBe(false); // writeback stays hidden at Decode
    expect(phaseVisibleAt('MEM', 'EX')).toBe(false); // memory hidden until we reach it
    expect(phaseVisibleAt('WB', 'WB')).toBe(true); // full path at the final phase
  });
});

describe('activate', () => {
  it('is empty for the pre-run state (no in-flight instruction)', () => {
    const a = activate(null);
    expect(a.components.size).toBe(0);
    expect(a.wires.size).toBe(0);
    expect(a.writtenReg).toBeNull();
  });

  it('lights the full path for a load (IF→WB through data memory)', () => {
    const a = activate(firstCycle('  lw x5, 0(x0)'));
    // Address calc, memory read, and writeback of the loaded value into x5.
    for (const id of ['pc', 'imem', 'regfile', 'immgen', 'alu', 'dmem', 'wbmux']) {
      expect(a.components.has(id), `load should light ${id}`).toBe(true);
    }
    expect(a.wires.has('alu-dmem')).toBe(true); // effective address to memory
    expect(a.wires.has('dmem-wb')).toBe(true); // loaded datum to the writeback mux
    expect(a.wires.has('wb-regfile')).toBe(true);
    expect(a.writtenReg).toBe(5);
  });

  it('lights the PC-select path for a taken branch, with no memory or writeback', () => {
    const a = activate(firstCycle('  beq x0, x0, ahead\n  nop\nahead:'));
    expect(a.components.has('alu')).toBe(true); // the comparison
    expect(a.components.has('branchadd')).toBe(true); // target = pc + imm
    expect(a.components.has('pcsel')).toBe(true);
    expect(a.wires.has('branchadd-pcsel')).toBe(true);
    // A branch neither touches data memory nor writes a register.
    expect(a.components.has('dmem')).toBe(false);
    expect(a.wires.has('wb-regfile')).toBe(false);
    expect(a.writtenReg).toBeNull();
  });

  it('lights the store data path (rs2→memory) with no writeback', () => {
    const a = activate(firstCycle('  sw x0, 4(x0)'));
    expect(a.components.has('alu')).toBe(true); // effective-address calc
    expect(a.components.has('dmem')).toBe(true);
    expect(a.wires.has('alu-dmem')).toBe(true); // address into memory
    expect(a.wires.has('rs2-dmem')).toBe(true); // the datum being stored
    // A store retires without touching the register file.
    expect(a.wires.has('wb-regfile')).toBe(false);
    expect(a.writtenReg).toBeNull();
  });

  it('lights imm→writeback for lui, which emits no reg-read and no alu-op', () => {
    const a = activate(firstCycle('  lui x5, 0x12345'));
    expect(a.components.has('immgen')).toBe(true);
    expect(a.components.has('wbmux')).toBe(true);
    expect(a.wires.has('imm-wb')).toBe(true); // the immediate is the writeback source
    // The ALU and data memory are idle for lui — event-only wiring would leave x5 unfed.
    expect(a.components.has('alu')).toBe(false);
    expect(a.components.has('dmem')).toBe(false);
    expect(a.wires.has('wb-regfile')).toBe(true);
    expect(a.writtenReg).toBe(5);
  });
});
