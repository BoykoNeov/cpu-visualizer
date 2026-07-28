import { describe, expect, it } from 'vitest';
import { assemble } from '@cpu-viz/assembler';
import { toProgramImage, CACHE_SMALL } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import { SuperscalarProcessor } from './index';

/**
 * **M13 step 2 — the adversarial nets: the things a group of three or four can do that a pair
 * cannot, and that no corpus program provokes.**
 *
 * Step 1 established that the issue logic was already width-generic and opened the guard to
 * {@link MAX_ISSUE_WIDTH}. That is a statement about the code READING generically; it is not a
 * statement about anything having been watched at arity > 2. The corpus cannot supply the
 * difference — `pairing.test.ts` sweeps it at width 2, the timing matrix counts cycles, and INV-8
 * is a FALSE net on this axis (an in-order machine retires in order, so final state is
 * width-invariant BY CONSTRUCTION). Everything below is hand-built for one geometry each, and
 * **every expectation here was DUMPED AND READ before it was written down** — the house rule, and
 * doubly load-bearing here because the slide makes packing non-obvious. The first draft of the
 * freeze program below put its load in slot 2 of the first group, where it was refused for an
 * intra-group RAW and slid to lead the next one: the right geometry, arrived at by accident of the
 * slide rather than by construction, which is exactly how a test ends up measuring width 3 while
 * claiming width 4.
 *
 * Four provocations, and **each was watched failing against a deliberately broken engine before
 * being kept** (the M11+M12 review's method lesson: one property sweep passed 8/8 on the bug it was
 * written for). Six breaks were run in all; what each was, and what ELSE it reddened, is recorded
 * per section — because a break that reddens `pairing.test.ts` proves the new test is correct
 * without proving it covers new ground.
 *
 * **What that record turned up is worth more than the tests themselves.** Exactly one of the six
 * breaks — §(a)'s two-slot-capped forwarding scan — is invisible to every other test in the repo
 * (4519 green, this file alone red). The other three arity-specific breaks are caught by exactly
 * ONE existing file, `halt-shadow.test.ts`, and only because step 1 derived its `WIDTHS` from
 * `MAX_ISSUE_WIDTH` rather than typing `[1, 2]`. **Every time, it reports the defect as a hang or
 * an internal-invariant crash** — "did not terminate within 500 cycles", "halted with instructions
 * still in flight" — never as the thing that went wrong. So the repo's width-3/4 coverage after
 * step 1 was a liveness net that converts arity bugs into crashes without naming them, and three
 * of the four sections below exist to give those crashes a diagnosis. The width-1/2 suites
 * (`pairing`, `timing`, `differential`, `miss-freeze-forward`) stayed green under all four, which
 * is the measurement that says this file covers ground they cannot reach.
 *
 * Widths are chosen PER GEOMETRY rather than swept over `1..MAX_ISSUE_WIDTH`: a group-of-four shape
 * passes vacuously at width 3, where it can never form. Each test therefore asserts the group it
 * claims to exercise BEFORE asserting anything about the behaviour — the plan's own named trap ("a
 * width-4 assertion that does not first check the group size it claims to exercise is measuring
 * width 3").
 */

/**
 * Runs to completion, or throws. **The cap is not decoration.** These tests are run against
 * deliberately broken engines, and a broken issue path can easily stop terminating — every other
 * runner in this package loops `while (!p.isHalted())` unbounded, which turns that into a hung
 * suite rather than a red test (`halt-shadow.test.ts` is the file that records why).
 */
function run(src: string, config: ProcessorConfig, cap = 300): CycleTrace[] {
  const { program, errors } = assemble(src);
  if (!program) throw new Error('assembly failed: ' + errors.map((e) => e.message).join('; '));
  const p = new SuperscalarProcessor();
  p.reset(toProgramImage(program), config);
  const ts: CycleTrace[] = [];
  while (!p.isHalted()) {
    ts.push(p.step());
    if (ts.length > cap) throw new Error(`did not terminate within ${cap} cycles`);
  }
  return ts;
}

const cfg = (issueWidth: number, over: Partial<ProcessorConfig> = {}): ProcessorConfig => ({
  ...defaultConfig(),
  forwarding: true,
  branchPrediction: 'none',
  issueWidth,
  ...over,
});

/** Every event of a type, flattened across the run, in cycle then intra-cycle order. */
function eventsOf<T extends CycleTrace['events'][number]['type']>(
  ts: CycleTrace[],
  type: T,
): Extract<CycleTrace['events'][number], { type: T }>[] {
  return ts.flatMap((t) => t.events.filter((e): e is never => e.type === type));
}

/** Who occupies `location` on this cycle, by instruction id — null if the slot is a bubble. */
const at = (t: CycleTrace, location: string): string | null =>
  t.instructions.find((i) => i.location === location)?.id ?? null;

/** What is in `location` — the mnemonic rather than the id, for asserting a slot's ROLE. */
const what = (t: CycleTrace, location: string): string | null =>
  t.instructions.find((i) => i.location === location)?.decoded.mnemonic ?? null;

/** Every occupant of a stage this cycle, oldest slot first, as mnemonics. */
const stageOf = (t: CycleTrace, stage: string, width: number): (string | null)[] =>
  Array.from({ length: width }, (_, s) => what(t, `${stage}.${s}`));

/** The dynamic sequence number behind a stable id (`i7` → 7). Fetch order, hence program order. */
const seqOf = (id: string): number => Number(id.slice(1));

/** Retirement is in program order — the premise the whole tier rests on, as a whole-run property. */
function expectMonotoneRetirement(ts: CycleTrace[], where: string): void {
  const seqs = eventsOf(ts, 'instr-retire').map((e) => seqOf(e.instr));
  expect(seqs.length, `${where}: nothing retired`).toBeGreaterThan(0);
  expect(seqs, where).toEqual([...seqs].sort((a, b) => a - b));
  expect(new Set(seqs).size, `${where}: something retired twice`).toBe(seqs.length);
}

const MEM_OPS = new Set(['lb', 'lh', 'lw', 'lbu', 'lhu', 'sb', 'sh', 'sw']);
const TRANSFERS = new Set(['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'jal', 'jalr']);

// =================================================================================================
// (a) SAME-`rd` CO-ISSUE — three writers of one register in one group
// =================================================================================================

/**
 * Three instructions writing x1, then a consumer. **Nothing refuses this pairing**: `intra-pair-raw`
 * asks whether an older member's `rd` is a younger member's SOURCE, and these three read nothing
 * from each other. So all three co-issue and all three sit in EX/MEM together when the consumer
 * resolves its operands — a source set with three candidates for one register, which width 2 can
 * hold two of and width 1 cannot hold at all.
 *
 * `resolveOperand` scans EX/MEM from the highest slot DOWN, so the youngest producer wins. That is
 * the correct rule and it is what the code says; a scan that took the first match ascending would
 * hand back 11, and one written for two slots would hand back 22.
 */
const SAME_RD = `.text
addi x1, x0, 11
addi x1, x0, 22
addi x1, x0, 33
addi x7, x1, 0
li a7, 10
ecall
`;

describe('(a) three writers of one register, co-issued', () => {
  // Widths 3 and 4 both form the group of three (at width 4 the consumer is refused from slot 3
  // for its intra-group RAW and slides to lead the next group — the packing is identical).
  for (const width of [3, 4]) {
    it(`width ${width}: the consumer forwards from the YOUNGEST writer of the three`, () => {
      const ts = run(SAME_RD, cfg(width));

      // THE GROUP THIS TEST CLAIMS TO EXERCISE, asserted before anything is concluded from it. If
      // the front end ever packs these differently the test must fail here, loudly, rather than
      // quietly become a width-2 test that passes.
      expect([at(ts[2]!, 'EX.0'), at(ts[2]!, 'EX.1'), at(ts[2]!, 'EX.2')]).toEqual([
        'i0',
        'i1',
        'i2',
      ]);
      // ...and one cycle on, all three are in EX/MEM beneath the consumer. THREE candidate sources
      // for one register: this is the thing width 2 cannot build.
      expect(at(ts[3]!, 'EX.0')).toBe('i3');
      expect([at(ts[3]!, 'MEM.0'), at(ts[3]!, 'MEM.1'), at(ts[3]!, 'MEM.2')]).toEqual([
        'i0',
        'i1',
        'i2',
      ]);

      // The EVENT MULTISET, not the cycle count — `cycles-cannot-see-a-lost-forward`. A wrong scan
      // direction costs no cycle and changes no timing; it changes one number in one event, and
      // then the architectural answer.
      expect(eventsOf(ts, 'forward').filter((e) => e.instr === 'i3')).toEqual([
        { type: 'forward', from: 'EX/MEM', to: 'EX.rs1', value: 33, instr: 'i3' },
      ]);
      expect(ts[ts.length - 1]!.state.registers[7]).toBe(33);

      // All three writes are emitted and applied in order — the older two are not suppressed, they
      // are overwritten. (`pairing.test.ts` pins this for two; the third slot is new.)
      expect(
        eventsOf(ts, 'reg-write')
          .filter((e) => e.reg === 1)
          .map((e) => e.value),
      ).toEqual([11, 22, 33]);
      expect(ts[ts.length - 1]!.state.registers[1]).toBe(33);
    });
  }

  /**
   * **Watched failing, twice.** (1) `resolveOperand`'s EX/MEM scan reversed to ascending: the
   * consumer forwards 11 and x7 ends 11 — but this also reddens `pairing.test.ts`'s two-writer
   * priority test, so it confirms the assertion without showing new ground. (2) The same scan
   * capped at two slots (`s = Math.min(this.width - 1, 1)`) — the shape an arity-2 source set would
   * actually have had: it forwards 22, x7 ends 22, and it is a NO-OP at widths 1 and 2.
   *
   * **That second break is the only one of the six run for this file that NOTHING else in the repo
   * sees**: 4519 tests green, these two red. Not even the liveness sweep notices, because a wrong
   * forward costs no cycle and hangs nothing — it just returns the wrong number, which is the
   * `cycles-cannot-see-a-lost-forward` family exactly. The forwarding source set's arity was read
   * at step 1 and never watched; this is where it gets watched.
   */
  it('is not a claim about the corpus — no corpus program builds this group', () => {
    // Kept as an explicit note rather than a comment: the three-writer group is hand-built here
    // precisely because nothing in `content/programs/` writes one register three times in a row.
    expect(SAME_RD.match(/addi x1,/g)?.length).toBe(3);
  });
});

// =================================================================================================
// (b) THE MEM FREEZE WITH MORE THAN ONE FOLLOWER
// =================================================================================================

/**
 * A missing load leading a FULL group, with nothing but independent non-memory instructions behind
 * it. `stageMem`'s `frozen` walk holds every younger occupant where it stands; its own docblock
 * admits the rule has "never met more than one follower", and M7's one real bug lived exactly here
 * — a miss in slot 0 froze only its own slot, and the mate behind it retired AHEAD of the load.
 *
 * At width 2 that walk meets exactly one follower, always. Here it meets two (width 3) or three
 * (width 4). The `addi x3` spacer is load-bearing and was found by dumping: without it the `lw`
 * lands in slot 2 of the FIRST group, is refused for its RAW on x1, and slides — reaching the same
 * geometry by luck rather than by construction.
 */
const FREEZE = `.text
addi x1, x0, 256
addi x3, x0, 3
lw   x2, 0(x1)
addi x5, x0, 5
addi x6, x0, 6
addi x7, x0, 7
li   a7, 10
ecall
`;

describe('(b) a cache miss with more than one follower in MEM', () => {
  /** The cycle the miss is detected, i.e. the one carrying the missing `cache-access`. */
  const missCycle = (ts: CycleTrace[]): number =>
    ts.findIndex((t) => t.events.some((e) => e.type === 'cache-access' && !e.hit));

  for (const width of [3, 4]) {
    it(`width ${width}: the freeze holds ${width - 1} followers, and nobody overtakes the load`, () => {
      const ts = run(FREEZE, cfg(width, { cache: CACHE_SMALL }));
      const miss = missCycle(ts);
      expect(miss).toBeGreaterThan(0);

      // THE GEOMETRY, before any conclusion is drawn from it: the load leads, and every remaining
      // slot of MEM is occupied by a follower. `toBeGreaterThan(1)` is the arity claim itself —
      // this is the case the rule has never met, and at width 2 it would be exactly 1.
      const held = stageOf(ts[miss]!, 'MEM', width);
      expect(held[0], 'the load must LEAD the group').toBe('lw');
      const followers = held.slice(1).filter((m) => m !== null);
      expect(followers.length, `w${width}: followers in MEM behind the miss`).toBe(width - 1);
      expect(followers.length).toBeGreaterThan(1);
      expect(followers.every((m) => !MEM_OPS.has(m!))).toBe(true); // one memory port, per the rules

      // They are STILL THERE for the whole penalty — every one of them, not just the first.
      const ids = Array.from({ length: width }, (_, s) => at(ts[miss]!, `MEM.${s}`));
      for (let c = miss; c <= miss + CACHE_SMALL.missPenalty; c++) {
        expect(
          Array.from({ length: width }, (_, s) => at(ts[c]!, `MEM.${s}`)),
          `w${width}: MEM moved during the freeze, at cycle ${c}`,
        ).toEqual(ids);
      }
      // ...and WB bubbles for the whole freeze: nothing retires out from under the stuck load.
      //
      // The window opens at `miss + 1`, and the cycle it excludes is not an off-by-one — it is the
      // freeze rule seen from its other side. The instructions retiring in WB on the DETECTION
      // cycle are OLDER than the miss; they are already past MEM and owe it nothing, which is the
      // same "propagate downward in age only" rule that lets an older slot beside a younger miss
      // keep going. Widening this window to include the detection cycle would assert the freeze
      // reaches upward in age, which it must not.
      for (let c = miss + 1; c <= miss + CACHE_SMALL.missPenalty; c++) {
        expect(
          ts[c]!.events.filter((e) => e.type === 'instr-retire'),
          `w${width}: something retired during the freeze, at cycle ${c}`,
        ).toEqual([]);
      }

      // The assertion the plan names for this provocation. A follower that sailed on would retire
      // before the load, which final-state conformance can never see — both retire in the end.
      expectMonotoneRetirement(ts, `w${width}`);
    });

    it(`width ${width}: the cache stays a pure timing shadow across the multi-follower freeze`, () => {
      // The other half of the same claim, and the one a structural test cannot make: holding three
      // instructions in place must cost cycles and change no answer.
      const off = run(FREEZE, cfg(width, { cache: null }));
      const on = run(FREEZE, cfg(width, { cache: CACHE_SMALL }));
      expect(on.length - off.length).toBe(CACHE_SMALL.missPenalty);
      const a = off[off.length - 1]!.state;
      const b = on[on.length - 1]!.state;
      expect(b.registers).toEqual(a.registers);
      expect(b.memory).toEqual(a.memory);
      expect(b.pc).toBe(a.pc);
    });
  }

  /**
   * **Why this section needs width ≥ 3 at all, asserted rather than argued.** The same program at
   * width 2 puts exactly one follower behind the miss — so `pairing.test.ts`'s freeze test, and
   * every other net in the repo, exercises the `frozen` walk at arity 1 only. This is the pin that
   * says the sections above are not a second copy of it.
   *
   * **Watched failing.** In `stageMem`, hold only the FIRST follower and let the rest fall through
   * to `completeMem`. At width 2 that is a no-op by construction — there is never a second follower
   * — so every width-1/2 suite in the repo stays green, while at widths 3 and 4 `MEM.2`/`MEM.3`
   * sail into WB and retire ahead of the stuck load, reddening the monotonicity assertion above.
   * That is a genuinely arity-specific hole in a rule whose own docblock says it has never met more
   * than one follower.
   *
   * **And the break proved the hole is CORPUS-REACHABLE, which the plan did not expect.** It also
   * reddens `halt-shadow.test.ts`: `store-forward.s @ w3/nofwd/none/cache2` throws *"halted at
   * cycle 21 with instructions still in flight — the pipe did not drain"*. So a shipped program
   * does build this geometry at width 3, and one existing net does notice — but it notices as an
   * internal invariant crashing inside a LIVENESS sweep, with nothing anywhere saying "a follower
   * overtook the load". That is the difference this section buys: not first detection, but a
   * diagnosis instead of a stack trace.
   */
  it('width 2 has exactly ONE follower — which is why this geometry needs width ≥ 3', () => {
    const ts = run(FREEZE, cfg(2, { cache: CACHE_SMALL }));
    const miss = missCycle(ts);
    expect(miss).toBeGreaterThan(0);
    const held = stageOf(ts[miss]!, 'MEM', 2);
    expect(held[0]).toBe('lw');
    expect(held.slice(1).filter((m) => m !== null).length).toBe(1);
    expectMonotoneRetirement(ts, 'w2');
  });
});

// =================================================================================================
// (c) A TRANSFER IN A NON-ZERO SLOT OF A FULL GROUP
// =================================================================================================

/**
 * The bet/squash slot arithmetic has only ever been exercised at slot ≤ 1. Two shapes matter and
 * they are not equally informative:
 *
 *  - **The MIDDLE slot is the discriminating one.** A transfer in slot 2 of a group of four has
 *    BOTH older survivors and younger casualties in its own stage — a state width 2 cannot build,
 *    where a transfer has one or the other and never both.
 *  - **The LAST slot is the pinned ask and is width-2-equivalent.** A transfer in slot 3 has
 *    nothing younger beside it, so `younger(inEx, slot)` is false exactly as it is for a width-2
 *    slot-1 transfer. It is kept because the plan names it, and because "structurally identical" is
 *    an argument about a predicate — the same class of claim this repo has twice found to be wrong.
 */
const XFER_MID = `.text
addi x5, x0, 5
addi x6, x0, 6
beq  x0, x0, t
addi x9, x0, 9
t:
addi x3, x0, 3
li   a7, 10
ecall
`;

const XFER_LAST = `.text
addi x5, x0, 5
addi x6, x0, 6
addi x7, x0, 7
beq  x0, x0, t
addi x9, x0, 9
t:
addi x3, x0, 3
li   a7, 10
ecall
`;

/**
 * The third shape, and the one that is arity-specific in the way the other two are not: a taken
 * transfer LEADING a full group has THREE younger mates to kill, where width 2 has exactly one.
 * "Everything above me in this stage dies" and "the slot above me dies" are the same sentence at
 * width 2 and different sentences here.
 */
const XFER_FIRST = `.text
beq  x0, x0, t
addi x9, x0, 9
addi x8, x0, 8
addi x7, x0, 7
t:
addi x3, x0, 3
li   a7, 10
ecall
`;

describe('(c) a transfer in a non-zero slot of a full group', () => {
  it('taken, LEADING a full group: all three younger mates die, not just the next one', () => {
    const ts = run(XFER_FIRST, cfg(4));
    const c = ts[2]!;
    expect([at(c, 'EX.0'), at(c, 'EX.1'), at(c, 'EX.2'), at(c, 'EX.3')]).toEqual([
      'i0',
      'i1',
      'i2',
      'i3',
    ]);
    expect(what(c, 'EX.0')).toBe('beq');
    expect(c.events).toContainEqual({
      type: 'flush',
      reason: 'branch-taken',
      stages: ['EX', 'ID'],
    });

    // The branch is the ONLY survivor of its own group — it alone reaches MEM.
    expect(stageOf(ts[3]!, 'MEM', 4)).toEqual(['beq', null, null, null]);
    const retired = eventsOf(ts, 'instr-retire').map((e) => e.instr);
    expect(retired).toContain('i0');
    expect(['i1', 'i2', 'i3'].some((id) => retired.includes(id))).toBe(false);
    // ...and none of the three wrong-path writes committed. `x7` and `x8` are the assertion a
    // "kill the slot immediately above me" rule could not survive; `x9` alone would not see it.
    const regs = ts[ts.length - 1]!.state.registers;
    expect([regs[7], regs[8], regs[9]]).toEqual([0, 0, 0]);
    expectMonotoneRetirement(ts, 'xfer-first');
  });

  it('taken, in the MIDDLE: kills the younger seats beside it and spares the older ones', () => {
    const ts = run(XFER_MID, cfg(4));
    const c = ts[2]!;
    // The group, first: four occupants, the transfer third.
    expect([at(c, 'EX.0'), at(c, 'EX.1'), at(c, 'EX.2'), at(c, 'EX.3')]).toEqual([
      'i0',
      'i1',
      'i2',
      'i3',
    ]);
    expect(what(c, 'EX.2')).toBe('beq');

    // `stages` names EX — a casualty in the resolving stage itself — and the list is EXACT: IF held
    // nothing this cycle, and a flush names REAL casualties rather than wires that went high.
    expect(c.events).toContainEqual({
      type: 'flush',
      reason: 'branch-taken',
      stages: ['EX', 'ID'],
    });

    // The two OLDER mates survive and retire; the one YOUNGER mate does not. Both halves in one
    // stage at one cycle is the state width 2 cannot produce.
    const retired = eventsOf(ts, 'instr-retire').map((e) => e.instr);
    expect(retired).toContain('i0');
    expect(retired).toContain('i1');
    expect(retired).toContain('i2');
    expect(retired).not.toContain('i3');
    const regs = ts[ts.length - 1]!.state.registers;
    expect([regs[5], regs[6]]).toEqual([5, 6]); // the survivors committed
    expect(regs[9]).toBe(0); // ...and the wrong-path mate never did
    expectMonotoneRetirement(ts, 'xfer-mid');
  });

  it('taken, in the LAST slot: names no EX casualty, and the whole group retires', () => {
    const ts = run(XFER_LAST, cfg(4));
    const c = ts[2]!;
    expect([at(c, 'EX.0'), at(c, 'EX.1'), at(c, 'EX.2'), at(c, 'EX.3')]).toEqual([
      'i0',
      'i1',
      'i2',
      'i3',
    ]);
    expect(what(c, 'EX.3')).toBe('beq');
    // The OMISSION is the assertion: nothing in EX was younger than slot 3, so EX is not named.
    expect(c.events).toContainEqual({ type: 'flush', reason: 'branch-taken', stages: ['ID'] });

    const retired = eventsOf(ts, 'instr-retire').map((e) => e.instr);
    expect(['i0', 'i1', 'i2', 'i3'].every((id) => retired.includes(id))).toBe(true);
    const regs = ts[ts.length - 1]!.state.registers;
    expect([regs[5], regs[6], regs[7]]).toEqual([5, 6, 7]);
    expect(regs[9]).toBe(0);
    expectMonotoneRetirement(ts, 'xfer-last');
  });

  it('a BET from the MIDDLE of a full group kills only the ID seats behind it', () => {
    // The bet's casualty set is "up to `width - 1` ID seats" — the count that M13 step 1 found
    // misdocumented as one, and that never reaches the trace because `flush.stages` names stage
    // families. Here it is one seat of three, chosen so the survivors are visible: the branch bets
    // from ID.2, ID.3 dies, ID.0 and ID.1 issue beside it.
    const ts = run(XFER_MID, cfg(4, { branchPrediction: 'static-taken' }));
    const c = ts[1]!;
    expect([at(c, 'ID.0'), at(c, 'ID.1'), at(c, 'ID.2'), at(c, 'ID.3')]).toEqual([
      'i0',
      'i1',
      'i2',
      'i3',
    ]);
    expect(what(c, 'ID.2')).toBe('beq');
    expect(c.events).toContainEqual({
      type: 'flush',
      reason: 'branch-predicted-taken',
      stages: ['ID', 'IF'],
    });
    // The branch SURVIVES its own bet — the whole difference between a bet and a squash — and so
    // does everything older than it. Only the seat behind it dies.
    expect(at(ts[2]!, 'EX.2')).toBe('i2');
    const retired = eventsOf(ts, 'instr-retire').map((e) => e.instr);
    expect(['i0', 'i1', 'i2'].every((id) => retired.includes(id))).toBe(true);
    expect(retired).not.toContain('i3');
    expect(ts[ts.length - 1]!.state.registers[9]).toBe(0);
  });

  it('a BET from the LAST slot kills nothing in ID at all — only IF', () => {
    // The degenerate end of the same rule, and the sharpest single-fact case: with no seat behind
    // it, the bet's ID casualty set is EMPTY and `stages` is `['IF']` alone. A bet that killed its
    // whole group regardless of slot would be invisible in the middle case above (where one seat
    // does die) and shows up only here.
    const ts = run(XFER_LAST, cfg(4, { branchPrediction: 'static-taken' }));
    const c = ts[1]!;
    expect([at(c, 'ID.0'), at(c, 'ID.1'), at(c, 'ID.2'), at(c, 'ID.3')]).toEqual([
      'i0',
      'i1',
      'i2',
      'i3',
    ]);
    expect(what(c, 'ID.3')).toBe('beq');
    expect(c.events).toContainEqual({
      type: 'flush',
      reason: 'branch-predicted-taken',
      stages: ['IF'],
    });
    const retired = eventsOf(ts, 'instr-retire').map((e) => e.instr);
    expect(['i0', 'i1', 'i2', 'i3'].every((id) => retired.includes(id))).toBe(true);
  });

  /**
   * **Watched failing, twice, and only one of the two extends anything.**
   *
   * (1) `younger(inEx, ctx.squash.slot)` replaced by `anyOccupied(inEx)` at the clock edge: the
   * last-slot case then claims an EX casualty it does not have. It reddens that case — and 17
   * existing tests with it (`pairing.test.ts`'s "a transfer in EX.1 SPARES the older EX.0", plus
   * `timing.test.ts`'s whole "flushes name exactly their casualties" sweep). Pure confirmation, and
   * exactly what the last-slot case being width-2-equivalent predicts.
   *
   * (2) `executeSlot`'s `ctx.squash.slot < slot` narrowed to `ctx.squash.slot + 1 === slot` — "the
   * squash kills the slot immediately above me", which is the same sentence as the real rule at
   * width 2 and a different one at width 4. Only the LEADING case above reddens; every width-1/2
   * suite stays green. (`halt-shadow.test.ts` reddens too, at widths 3/4, reporting it as a
   * corpus program reaching a different final architectural state — a wrong-path instruction
   * committing, named as neither.)
   *
   * A third candidate was rejected as no break at all: `ctx.squash.slot !== slot` looks like it
   * would kill a middle-slot transfer's OLDER mates, but EX is walked oldest-first, so those slots
   * have already executed by the time the squash exists. Worth recording — it is the kind of edit
   * that reads like a bug and is provably inert.
   */
  it('width 2 cannot build the middle case — one side of the branch is always empty', () => {
    // Asserted rather than argued, because it is the reason the middle case is in this file. At
    // width 2 the same program resolves the branch in EX.0 with a single younger mate: casualties
    // but no survivors beside it.
    const ts = run(XFER_MID, cfg(2));
    const c = ts.find((t) => t.events.some((e) => e.type === 'branch-resolved'))!;
    expect(what(c, 'EX.0')).toBe('beq');
    expect(at(c, 'EX.1')).not.toBeNull(); // a younger casualty...
    expect(at(c, 'EX.0')).toBe('i2'); // ...and no older survivor beside it: the branch leads
  });
});

// =================================================================================================
// (d) THE PAIRING RULES ARE ASKED OF THE WHOLE GROUP, NOT ITS LEADER
// =================================================================================================

/**
 * **The provocation step 1's audit could not supply.** `issueVerdict` is `for (const older of
 * group)` — every rule asked against every member already issued this cycle. At width 2 that loop
 * has at most ONE iteration when it matters: when slot 1 is being judged, the group holds exactly
 * the leader. So `group[0]` and `for (const older of group)` are the same function at width 2, and
 * every existing test in this package is blind to the difference.
 *
 * From width 3 they come apart: a conflict may exist with a member that is neither the leader nor
 * the immediately older instruction. Each program below is packed — by dumping, not by reasoning —
 * so that the CONFLICTING older member sits at ID slot 1 or 2 while the leader is innocent of the
 * rule in question.
 *
 * **Watched failing:** `issueVerdict`'s loop replaced by a single check against `group[0]`. All
 * three cases below redden, and every width-1/2 suite in the repo stays green — the break is a
 * no-op at width 2 by construction, not by luck: when slot 1 is judged, `group` holds exactly the
 * leader, so `group[0]` and "every older member" are the same set. The only other file that
 * notices is `halt-shadow.test.ts`, whose width-3/4 cells stop terminating (*"did not terminate
 * within 500 cycles"*) — a hang where the actual fault is a load and a store sharing the one
 * memory port.
 */

/** The `sw` sits at group index 2; the leader is an ordinary `addi` that touches no memory port. */
const MEM_PORT_NONLEAD = `.text
addi x1, x0, 256
addi x2, x1, 0
addi x3, x0, 3
sw   x1, 0(x1)
lw   x4, 4(x1)
li   a7, 10
ecall
`;

/** The `beq` sits at group index 2; the leader is not a transfer. */
const BRANCH_SLOT_NONLEAD = `.text
addi x1, x0, 256
addi x2, x1, 0
addi x3, x0, 3
beq  x0, x0, t
jal  x0, t
t:
addi x8, x0, 8
li   a7, 10
ecall
`;

/** The producer of x9 sits at group index 1; the leader writes x2, which nobody reads. */
const RAW_NONLEAD = `.text
addi x1, x0, 256
addi x2, x1, 0
addi x9, x0, 9
addi x8, x9, 1
li   a7, 10
ecall
`;

describe('(d) the pairing rules are asked of the whole group, not its leader', () => {
  /**
   * The stall carrying `reason` on a NAMED cycle — not the first one in the run.
   *
   * The cycle is named because all three programs open with a SETUP refusal: the second
   * instruction takes a RAW on the first, is refused, and slides down to lead the next group. That
   * slide is precisely what moves the conflicting member off the leader position, and it means
   * "the first `intra-pair-raw` in the run" is the setup, not the case under test. Asking for a
   * particular cycle keeps the two apart and keeps the packing an assertion rather than a search
   * that would find whatever it needed.
   */
  const stallAt = (ts: CycleTrace[], cycle: number, reason: string): string => {
    const s = ts[cycle]!.events.find((e) => e.type === 'stall' && e.reason === reason);
    if (s === undefined || s.type !== 'stall') {
      throw new Error(`no '${reason}' stall at cycle ${cycle} — the packing has moved`);
    }
    return s.instr;
  };

  /** Every program here is set up by a refusal at cycle 1; it is what causes the slide. */
  const expectSetupSlide = (ts: CycleTrace[]): void => {
    expect(ts[1]!.events.filter((e) => e.type === 'stall')).toMatchObject([
      { reason: 'intra-pair-raw', stage: 'ID', instr: 'i1' },
    ]);
  };

  it('mem-port refuses against an older member in slot 2, not the leader', () => {
    const ts = run(MEM_PORT_NONLEAD, cfg(4));
    expectSetupSlide(ts);
    const t = ts[2]!;
    const instr = stallAt(ts, 2, 'mem-port');
    // The packing this test claims: leader innocent, conflicting `sw` at slot 2, refused `lw` at 3.
    expect(stageOf(t, 'ID', 4)).toEqual(['addi', 'addi', 'sw', 'lw']);
    expect(MEM_OPS.has(what(t, 'ID.0')!)).toBe(false); // a leader-only check would find nothing
    expect(instr).toBe(at(t, 'ID.3'));

    // ...and the RESULT, not just the refusal: one data-memory port means at most one memory
    // instruction ever occupies MEM in a cycle. This is what a leader-only rule actually breaks.
    for (const c of ts) {
      const inMem = stageOf(c, 'MEM', 4).filter((m) => m !== null && MEM_OPS.has(m));
      expect(inMem.length, `two memory ops in MEM at cycle ${c.cycle}`).toBeLessThanOrEqual(1);
    }
    expectMonotoneRetirement(ts, 'mem-port');
  });

  it('branch-slot refuses against an older member in slot 2, not the leader', () => {
    const ts = run(BRANCH_SLOT_NONLEAD, cfg(4));
    expectSetupSlide(ts);
    const t = ts[2]!;
    const instr = stallAt(ts, 2, 'branch-slot');
    expect(stageOf(t, 'ID', 4)).toEqual(['addi', 'addi', 'beq', 'jal']);
    expect(TRANSFERS.has(what(t, 'ID.0')!)).toBe(false); // the leader is no transfer
    expect(instr).toBe(at(t, 'ID.3'));

    // One branch unit: at most one transfer in EX per cycle, for the whole run.
    for (const c of ts) {
      const inEx = stageOf(c, 'EX', 4).filter((m) => m !== null && TRANSFERS.has(m));
      expect(inEx.length, `two transfers in EX at cycle ${c.cycle}`).toBeLessThanOrEqual(1);
    }
    expectMonotoneRetirement(ts, 'branch-slot');
  });

  it('intra-pair-raw refuses against an older member in slot 1, not the leader', () => {
    const ts = run(RAW_NONLEAD, cfg(4));
    expectSetupSlide(ts);
    const t = ts[2]!;
    const instr = stallAt(ts, 2, 'intra-pair-raw');
    // Leader writes x2; the producer of x9 is beside it at slot 1; the reader is at slot 2.
    expect(stageOf(t, 'ID', 4)).toEqual(['addi', 'addi', 'addi', 'addi']);
    expect(instr).toBe(at(t, 'ID.2'));

    // **The architectural assertion, and the reason this case is the sharpest of the three.** The
    // other two rules are structural — breaking them costs a port, not an answer. Breaking this one
    // is a WRONG ANSWER: co-issued, the reader takes x9 from the register file as it stood (0) and
    // ends with 1 instead of 10, because there is no later stage than "beside me, this cycle" and
    // no forward can reach back into it.
    expect(ts[ts.length - 1]!.state.registers[8]).toBe(10);
    expect(ts[ts.length - 1]!.state.registers[9]).toBe(9);
    expectMonotoneRetirement(ts, 'intra-pair-raw');
  });
});
