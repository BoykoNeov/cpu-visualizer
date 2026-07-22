import { describe, expect, it } from 'vitest';
import { assemble, type AssembledProgram } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import { defaultConfig, type MachineState, type ProcessorConfig } from '@cpu-viz/trace';
import { OutOfOrderProcessor } from './index';

/**
 * Step 2's second acceptance line: the INV-8 differential (`differential.test.ts`) is timing-blind
 * — in-order commit means it would pass with the scheduler completely wrong — but the plan calls
 * out ONE bug class it genuinely catches: a load that bypasses an aliasing older store. This proves
 * that claim rather than asserting it: a disambiguation-DISABLED variant of the model is compared
 * against the SAME hand-computed oracle a real INV-8 run would compare against (mirroring
 * `conformance.ts`'s own `RESULT_ORACLES` methodology — a model-independent, architecturally
 * obvious fact: `a0` holds the just-stored 99, computed by hand, not by calling the golden
 * reference), and shown to diverge. It cannot import `@cpu-viz/engine-reference` directly to check
 * against the reference live — the DAG boundary (`engine-conformance`'s own header) is that a
 * concrete model imports no sibling model or the reference at runtime; only the model-agnostic
 * `engine-conformance` harness may do that, and it does not know this model's internals well enough
 * to build a disambiguation-disabled variant of it.
 *
 * **Why not `store-forward.s`** (the corpus program authored at step 1b for exactly this bug
 * class): checked empirically, not assumed — its store and load are immediately adjacent and share
 * the single memory port, so oldest-first issue order plus matched per-request miss costs on the
 * same cache line keep the store's deferred write at least one cycle ahead of the load's read even
 * with `disambiguationClear` fully disabled, at every cache/width/missPenalty combination tried.
 * What `store-forward.s` actually pins is the OTHER step-1b mechanism (the store write deferred to
 * commit, not issued at MEM access) — real and necessary, but not this gate.
 *
 * What DOES expose `disambiguationClear` specifically: an older store whose ADDRESS is not yet
 * known (its base register is gated behind a slow, unrelated load that misses in cache) while an
 * independent, fast-computing ALIASING load is address-ready immediately — exactly the
 * `s.aluOut === null` branch the real gate waits on. `cache: null` does NOT reproduce this (no
 * delay to exploit — both sides are fast enough that the store's chain resolves first regardless),
 * which is itself informative: the corruption is real but requires exactly the miss-widened window
 * the plan's own "how this can lie to itself" section names.
 */
class DisambiguationDisabledProcessor extends OutOfOrderProcessor {
  protected override disambiguationClear(): boolean {
    return true; // never wait for an older, still-unresolved store — the mutation under test
  }
}

const SRC = [
  '.data',
  'warmup: .word 0',
  '        .word 0, 0, 0, 0, 0, 0, 0, 0', // pad clear of `cell`'s own cache line
  'cell:   .word 0',
  '.text',
  '_start:',
  'la   t6, warmup',
  'lw   t5, 0(t6)', // slow: a compulsory cache miss; the value (0) only gates timing
  'la   t0, cell', // t0 = &cell, computed immediately
  'add  t0, t0, t5', // t0 = &cell + 0, but now DEPENDS on the slow t5
  'sub  t0, t0, t5', // t0 = &cell again, still gated behind t5's resolution
  'li   t2, 99',
  'sw   t2, 0(t0)', // address unknown until the chain above resolves
  'la   t3, cell', // independent, fast — address-ready immediately
  'lw   a0, 0(t3)', // aliases sw's eventual address; must see 99, never the stale 0
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

const MISSING_STORE_ADDRESS_CONFIG: ProcessorConfig = {
  ...defaultConfig(),
  forwarding: true,
  issueWidth: 2,
  outOfOrderIssue: true,
  robSize: 16,
  cache: { lineSize: 16, numLines: 4, missPenalty: 8 },
};

function runToHalt(processor: OutOfOrderProcessor, program: AssembledProgram): MachineState {
  processor.reset(toProgramImage(program), MISSING_STORE_ADDRESS_CONFIG);
  let steps = 0;
  while (!processor.isHalted()) {
    if (steps++ > 1000) throw new Error('runaway: did not halt');
    processor.step();
  }
  return processor.getState();
}

/**
 * The hand-computed oracle a real INV-8 run would compare against — architecturally obvious, not
 * derived from any engine: `sw` stores 99 to `cell`, and the very next `lw` from the same address
 * must read it back. `RESULT_ORACLES` in `engine-conformance`'s `conformance.ts` uses the identical
 * methodology for the shared corpus.
 */
const CORRECT_A0 = 99;

describe('memory disambiguation is the one bug class the INV-8 differential genuinely catches', () => {
  it('the real model computes the architecturally correct result (a0 = 99, the just-stored value)', () => {
    const program = asm();
    const model = runToHalt(new OutOfOrderProcessor(), program);

    expect(model.registers[10]).toBe(CORRECT_A0);
  });

  it('disabling disambiguation makes the model diverge from that result — the load reads the stale 0', () => {
    const program = asm();
    const broken = runToHalt(new DisambiguationDisabledProcessor(), program);

    expect(broken.registers[10]).toBe(0); // bypassed the still-unresolved older store
    expect(broken.registers[10]).not.toBe(CORRECT_A0);
  });

  it('the corruption needs the miss-widened window — with the cache off, both sides resolve too fast to diverge', () => {
    const program = asm();
    const processor = new DisambiguationDisabledProcessor();
    processor.reset(toProgramImage(program), { ...MISSING_STORE_ADDRESS_CONFIG, cache: null });
    let steps = 0;
    while (!processor.isHalted()) {
      if (steps++ > 1000) throw new Error('runaway: did not halt');
      processor.step();
    }
    expect(processor.getState().registers[10]).toBe(CORRECT_A0);
  });
});
