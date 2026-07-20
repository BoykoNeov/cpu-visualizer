import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble } from '@cpu-viz/assembler';
import { toProgramImage, isPredictable, speculativeTarget } from '@cpu-viz/engine-common';
import { decode } from '@cpu-viz/isa';
import { defaultConfig, type CycleTrace, type InstructionInstance } from '@cpu-viz/trace';
import { PipelineProcessor } from './index';

/**
 * M4 step 0 — the ID-stage target, pinned before anything rests on it.
 *
 * Step 0 wires NOTHING: `speculativeTarget` is pure and unreferenced by the machine, which still
 * predicts not-taken. So this file is the step's entire deliverable, and its job is narrow and
 * specific: prove that the address ID would compute from a decode is the SAME address EX computes
 * from the real execution.
 *
 * **Why that needs proving rather than reading.** Both routes spell `pc + imm`, so the agreement
 * looks like a tautology. It is not. They are two units computing one address from different
 * inputs at different times — which is exactly the shape of the classic BTB bug, where a predictor
 * and a branch unit disagree and the machine silently runs the wrong path. The `>>> 0` is the
 * concrete trap: a predictor that agreed with EX only for small addresses would be a wrap-around
 * bug wearing a passing test. So the comparison is against the ENGINE's answer (`branch-resolved`
 * events from a real corpus run), never against a re-derivation of the same arithmetic here — a
 * test that recomputed `pc + imm` itself would agree with a broken predictor for the same reason
 * the predictor was broken.
 *
 * **Why the vacuity guards.** M3 step 0's lesson, applied: three claims, none implying the others.
 * "Every taken PC-relative transfer agrees" is trivially true of a corpus with none, and would
 * stay green if `PC_RELATIVE_TRANSFERS` were emptied to `new Set()` — so the count is asserted
 * too, and the `jalr` and not-taken cases are pinned separately because the headline claim is
 * blind to both.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

function run(file: string): CycleTrace[] {
  const { program, errors } = assemble(readFileSync(PROGRAMS_DIR + file, 'utf8'));
  if (!program) throw new Error(`${file}: assembly failed: ${errors.map((e) => e.message).join()}`);
  const p = new PipelineProcessor();
  p.reset(toProgramImage(program), defaultConfig());
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) {
    if (traces.length >= 500) throw new Error(`${file}: exceeded 500 cycles — runaway loop?`);
    traces.push(p.step());
  }
  return traces;
}

/** Every corpus program that contains a control transfer at all. `add.s` deliberately has none. */
const PROGRAMS = ['sum-loop.s', 'array-sum.s', 'call-return.s', 'byte-loads.s'] as const;

/**
 * One resolved transfer, joined back to WHO resolved it. `branch-resolved` carries only the
 * instruction id, and the prediction question needs the instruction's `pc` and `decoded` — so the
 * id is looked up in `instructions[]`, which is the trace's own way of saying who is in flight
 * (INV-3: the view/test reads the trace, never the engine's internals).
 */
interface Resolved {
  readonly file: string;
  readonly instr: InstructionInstance;
  readonly actual: boolean;
  /** EX's answer: where pc actually goes — the target if taken, the fall-through if not. */
  readonly target: number;
}

function resolvedTransfers(file: string): Resolved[] {
  const traces = run(file);
  // An instruction appears in `instructions[]` in every cycle it is in flight; any occurrence
  // carries the same pc/decoded (INV-4: the id is stable for its whole lifetime), so first wins.
  const byId = new Map<string, InstructionInstance>();
  for (const t of traces) {
    for (const i of t.instructions) if (!byId.has(i.id)) byId.set(i.id, i);
  }
  const out: Resolved[] = [];
  for (const t of traces) {
    for (const e of t.events) {
      if (e.type !== 'branch-resolved') continue;
      const instr = byId.get(e.instr);
      if (!instr) throw new Error(`${file}: branch-resolved names unknown instr ${e.instr}`);
      out.push({ file, instr, actual: e.actual, target: e.target });
    }
  }
  return out;
}

const ALL: Resolved[] = PROGRAMS.flatMap(resolvedTransfers);

describe('speculativeTarget — the ID-stage bet, before it is wired', () => {
  /**
   * THE safety property: for a transfer that actually went, the address ID would have bet on is
   * the address EX went to. This is what makes an ID redirect legitimate rather than a guess at a
   * guess — and step 1's `static-taken` is unsound without it.
   */
  it('agrees with EX for every taken PC-relative transfer', () => {
    const taken = ALL.filter((r) => r.actual && isPredictable(r.instr.decoded));
    for (const r of taken) {
      expect(
        speculativeTarget(r.instr.decoded, r.instr.pc),
        `${r.file}: ${r.instr.decoded.mnemonic} @ pc=0x${r.instr.pc.toString(16)}`,
      ).toBe(r.target);
    }
  });

  /**
   * Non-vacuity for the claim above — it is a `for` over a filtered list, and an empty list passes
   * it silently. Emptying `PC_RELATIVE_TRANSFERS` would leave the headline claim green and this
   * one failing, which is the whole point of asserting counts rather than trusting the sweep.
   *
   * Asserted PER PROGRAM, from each loop's trip count in its own source — not as one total. A
   * total is a magic number that a compensating pair of errors slides through, and it says nothing
   * about which program drifted; M3 step 3 pinned that rule for the closed form, and the reason
   * holds here. Each count below is read off the assembly:
   *
   * - `sum-loop.s`: `t0` counts 10→0, `bnez t0` closes the loop ⇒ taken for t0 = 9…1, **9**.
   * - `array-sum.s`: `t1` counts 5→0, same shape ⇒ **4**.
   * - `call-return.s`: one `jal` (unconditional ⇒ always taken). Its `bge` never goes and its
   *   `ret` is a `jalr`, so neither is counted here — that is the whole asymmetry of the corpus.
   * - `byte-loads.s`: straight-line ⇒ **0**, and its presence in `PROGRAMS` is deliberate: a
   *   program with no transfers must not confuse the join in `resolvedTransfers`.
   *
   * These are also step 3's `T` term, arrived at independently — 13 taken conditional-or-`jal`
   * transfers plus `call-return`'s unpredictable `ret`.
   */
  it('is not vacuous — the corpus really does contain taken PC-relative transfers', () => {
    const perProgram = (file: string): number =>
      ALL.filter((r) => r.file === file && r.actual && isPredictable(r.instr.decoded)).length;

    expect(perProgram('sum-loop.s'), 'bnez taken for t0 = 9…1').toBe(9);
    expect(perProgram('array-sum.s'), 'bnez taken for t1 = 4…1').toBe(4);
    expect(perProgram('call-return.s'), 'the jal; bge declines and ret is a jalr').toBe(1);
    expect(perProgram('byte-loads.s'), 'straight-line: no transfers at all').toBe(0);
  });

  /**
   * The deliberate omission, pinned as behavior rather than left to the comment in `predict.ts`.
   * `jalr` IS a control transfer and IS always taken — so a rule of "predict every transfer" would
   * happily include it — but its target comes from a register, which ID has not read. Returning a
   * target here would be inventing an address.
   *
   * This is why `call-return.s` is expected to REGRESS under static-taken (its `ret` keeps paying
   * full price), so the null is load-bearing for M4's thesis, not a gap.
   */
  it('refuses to predict jalr — a taken transfer whose target ID cannot know', () => {
    const jalrs = ALL.filter((r) => r.instr.decoded.mnemonic === 'jalr');
    expect(jalrs.length, 'call-return.s ret is a jalr').toBeGreaterThan(0);
    for (const r of jalrs) {
      expect(r.actual, 'jalr is unconditional — always taken').toBe(true);
      expect(isPredictable(r.instr.decoded)).toBe(false);
      expect(speculativeTarget(r.instr.decoded, r.instr.pc)).toBeNull();
    }
  });

  /**
   * The bet and the outcome are different facts — the one thing that makes this prediction at all.
   * For a NOT-taken branch, EX's `target` is the fall-through (`pc + 4`, per the schema's own
   * wording) while the speculative target is where it declined to go. They must DIFFER, or
   * "predicted taken" and "was taken" would be the same question and no scheme could ever be wrong.
   *
   * `call-return.s`'s `bge a0, a1, done` is the corpus's only never-taken branch (17 >= 42 is
   * false) — i.e. the exact instruction that will MISPREDICT under static-taken, and the reason
   * that program is expected to get slower. Pinning it here means step 3's thesis rests on a
   * measured property of the corpus rather than on reading the assembly.
   */
  it('a not-taken branch would have gone somewhere else — the bet is not the outcome', () => {
    const notTaken = ALL.filter((r) => !r.actual);
    expect(notTaken.length, 'the corpus must contain a branch that declines').toBeGreaterThan(0);
    for (const r of notTaken) {
      expect(isPredictable(r.instr.decoded), 'only conditionals can decline').toBe(true);
      const fallThrough = (r.instr.pc + 4) >>> 0;
      expect(r.target, "EX reports a not-taken branch's fall-through").toBe(fallThrough);
      expect(speculativeTarget(r.instr.decoded, r.instr.pc)).not.toBe(fallThrough);
    }
  });

  /**
   * The `>>> 0` is real, and **no corpus sweep can prove it** — which is why this test is direct.
   *
   * Found by mutation, not by inspection: deleting the `>>> 0` left all five other tests in this
   * file GREEN. Every corpus address is small and every backward branch lands well above zero, so
   * `pc + imm` never leaves the range where signed and unsigned agree, and the whole corpus is
   * structurally blind to the normalization. The agreement test above cannot see it either — EX
   * normalizes too, so both routes would be wrong together and still match.
   *
   * So the contract is asserted on its own terms instead: `speculativeTarget` returns an UNSIGNED
   * 32-bit address. A backward transfer evaluated near zero is the domain point that separates the
   * two readings — `pc + imm` is negative there, and a raw JS number would carry the sign into a
   * fetch address. The pc is supplied rather than observed: this is a pure function, and pinning
   * it needs a case the corpus does not contain.
   */
  it('returns an unsigned address when the target wraps below zero', () => {
    // `beq x0, x0, back` sits at pc=4 with imm = -4 — the only backward branch shape available
    // without inventing an encoding.
    const { program } = assemble('back:\n  add x0, x0, x0\n  beq x0, x0, back\n');
    const beq = decode(program!.words[1]!);
    expect(beq.mnemonic, 'the fixture must really be the branch').toBe('beq');
    expect(beq.imm, 'a backward branch carries a negative immediate').toBe(-4);

    // At its real pc (4) the sum is 0 and the two readings agree — the corpus's whole world.
    expect(speculativeTarget(beq, 4)).toBe(0);
    // Evaluated at pc=0 the sum is -4, and only the unsigned reading is a fetchable address.
    expect(speculativeTarget(beq, 0)).toBe(0xfffffffc);
  });

  /** The corpus is not a spec. Non-transfers answer null by classification, not by accident. */
  it('says null for instructions that are not control transfers', () => {
    for (const src of ['addi x1, x0, 5', 'add x1, x2, x3', 'lw x1, 0(x2)', 'lui x1, 7']) {
      const { program } = assemble(src);
      const word = program!.words[0]!;
      expect(speculativeTarget(decode(word), 0), src).toBeNull();
    }
  });
});
