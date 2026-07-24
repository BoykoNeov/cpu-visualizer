import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import { defaultConfig, type MachineState, type ProcessorConfig } from '@cpu-viz/trace';
import { OutOfOrderProcessor, type RobEntry } from './index';

/**
 * Memory disambiguation must compare BYTE RANGES, not base addresses (M9+M10 review finding 1). A
 * younger sub-word load that OVERLAPS an older uncommitted store's range — without equalling its
 * base address — still aliases it and must wait for it to commit. The original gate used
 * `store.addr === load.addr`, so `sw t1, 0(t0)` then `lb a0, 1(t0)` slipped the load past the
 * store and read stale memory: an INV-8 class corruption reachable from user-typed sandbox assembly
 * (the shipped corpus and `disambiguation-mutation.test.ts` exercise only exact word/word aliases,
 * so nothing caught it).
 *
 * This proves the overlap check is load-bearing exactly as `disambiguation-mutation.test.ts` proves
 * the base gate is: the REAL model computes the architecturally correct byte, and a mutation
 * subclass restoring the OLD base-address `===` gate diverges (reads the stale byte). The oracle is
 * hand-computed and architecturally obvious, not derived from any engine (mirroring
 * `conformance.ts`'s `RESULT_ORACLES`).
 *
 * The window: a slow `sll` (`slowOpLatency: 8`) PARKS THE ROB HEAD — in-order commit means the store
 * behind it cannot retire (and so cannot write memory, which OoO defers to commit) for eight cycles.
 * The younger `lb` is address-ready and independent, so it issues out of order and reaches its memory
 * read WELL inside that window. The base-address gate declares it clear (its `cell+1` address `!==`
 * the store's `cell`) and it reads memory before the store has written it; the overlap gate makes it
 * wait. No cache here on purpose: a cache miss on the load's own path would delay ITS read past the
 * store's commit and hide the divergence — the slow op parks commit without touching the load's
 * timing.
 */

/** The pre-review gate: base-address equality only, no width/overlap. */
class BaseAddressOnlyDisambiguationProcessor extends OutOfOrderProcessor {
  protected override disambiguationClear(load: RobEntry): boolean {
    if (load.aluOut === null) {
      throw new Error(`base-address gate: ${load.decoded.mnemonic} disambiguates with no address`);
    }
    const addr = load.aluOut >>> 0;
    // `rob` is private on the base class; this subclass deliberately reimplements one protected
    // method against the same internals, so reach it through a cast rather than widening the field.
    const rob = (this as unknown as { rob: { all(): readonly RobEntry[] } }).rob;
    const STORES = new Set(['sb', 'sh', 'sw']);
    for (const s of rob.all()) {
      if (s.seq >= load.seq) continue;
      if (!STORES.has(s.decoded.mnemonic)) continue;
      if (s.aluOut === null) return false;
      if (s.aluOut >>> 0 === addr) return false; // the OLD bug: exact base address only
    }
    return true;
  }
}

// `cell` holds 0x44332211 little-endian: byte 0 = 0x11, byte 1 = 0x22, byte 2 = 0x33, byte 3 = 0x44.
// `sw t1, 0(t0)` (t1 = 0) zeroes the whole word; `lb a0, 1(t0)` reads byte 1, which the store
// overwrites 0x22 → 0x00. So a0 must be 0 (the store landed first, as program order demands), never
// the stale 0x22 = 34.
const SRC = [
  '.data',
  'cell:   .word 0x44332211',
  '.text',
  '_start:',
  'la   t0, cell', // t0 = &cell
  'li   t1, 0', // the store datum
  'li   t2, 3',
  'sll  t3, t2, t2', // a slow op (register shift) that PARKS THE ROB HEAD for slowOpLatency cycles
  'sw   t1, 0(t0)', // word store to [cell, cell+4): completes fast, but commits only after the sll
  'lb   a0, 1(t0)', // byte load at cell+1 — OVERLAPS the store's word range; must see 0, never 0x22
  'li   a7, 10',
  'ecall',
].join('\n');

function asm(): AssembledProgram {
  const { program, errors } = assemble(SRC);
  if (!program) {
    throw new Error(
      'assembly failed:\n' + errors.map((e) => `  ${e.line}: ${e.message}`).join('\n'),
    );
  }
  return program;
}

const CONFIG: ProcessorConfig = {
  ...defaultConfig(),
  forwarding: true,
  issueWidth: 2,
  outOfOrderIssue: true,
  robSize: 16,
  cache: null,
  slowOpLatency: 8,
};

function runToHalt(processor: OutOfOrderProcessor, program: AssembledProgram): MachineState {
  processor.reset(toProgramImage(program), CONFIG);
  let steps = 0;
  while (!processor.isHalted()) {
    if (steps++ > 1000) throw new Error('runaway: did not halt');
    processor.step();
  }
  return processor.getState();
}

/** Hand-computed, architecturally obvious: the byte the store wrote (0), not the stale 0x22. */
const CORRECT_A0 = 0;
const STALE_A0 = 0x22; // 34 — what byte 1 held before the store, read by a load that bypassed it

describe('memory disambiguation compares byte ranges, not base addresses', () => {
  it('the real model waits for the overlapping older store (a0 = 0, the stored word)', () => {
    const model = runToHalt(new OutOfOrderProcessor(), asm());
    expect(model.registers[10]).toBe(CORRECT_A0);
  });

  it('the base-address-only gate bypasses the store and reads the stale sub-word byte (a0 = 0x22)', () => {
    const broken = runToHalt(new BaseAddressOnlyDisambiguationProcessor(), asm());
    expect(broken.registers[10]).toBe(STALE_A0);
    expect(broken.registers[10]).not.toBe(CORRECT_A0);
  });
});
