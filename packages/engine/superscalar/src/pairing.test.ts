import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble } from '@cpu-viz/assembler';
import { toProgramImage, CACHE_SMALL } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import { SuperscalarProcessor } from './index';

/**
 * **M7 step 2b — the pairing suite. This is where the model stops being M3 with wider latches.**
 *
 * `timing.test.ts` proves the width-1 position reproduces M3's closed form, and `differential.test.ts`
 * proves the answers are right. Neither can see any of this: pairing changes only WHEN things
 * happen, and an in-order superscalar retires in order, so final architectural state is identical at
 * both widths **by construction**. That is not a comforting fact, it is the milestone's central
 * trap — conformance here would pass with the issue logic completely wrong. Everything below is
 * therefore about intra-cycle structure and cycle counts, the only places a pairing bug can show.
 *
 * Every expectation in this file was OBSERVED FIRST — the whole trace dumped, read, and checked
 * against the rule it was supposed to demonstrate — and only then written down. That order is
 * deliberate house policy (M2 step 5e's only real defect was a header comment asserting behaviour
 * for a case nobody had ever run), and with `width × forwarding × prediction × cache` this model has
 * more unobserved case-combinations than any before it. Two expectations below moved as a direct
 * result: the "branch in slot 1" program needed a spacer instruction, because without it the branch
 * was refused for an intra-pair RAW and SLID INTO SLOT 0 — so the test that claimed to exercise a
 * slot-1 transfer was quietly exercising a slot-0 one and passing for the wrong reason.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

const W1: ProcessorConfig = { ...defaultConfig(), forwarding: true, issueWidth: 1 };
const W2: ProcessorConfig = { ...defaultConfig(), forwarding: true, issueWidth: 2 };

function run(src: string, config: ProcessorConfig = W2): CycleTrace[] {
  const { program, errors } = assemble(src);
  if (!program) throw new Error('assembly failed: ' + errors.map((e) => e.message).join('; '));
  const p = new SuperscalarProcessor();
  p.reset(toProgramImage(program), config);
  const ts: CycleTrace[] = [];
  while (!p.isHalted()) ts.push(p.step());
  return ts;
}

function runFile(file: string, config: ProcessorConfig = W2): CycleTrace[] {
  return run(readFileSync(PROGRAMS_DIR + file, 'utf8'), config);
}

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

/** The dynamic sequence number behind a stable id (`i7` → 7). Fetch order, hence program order. */
const seqOf = (id: string): number => Number(id.slice(1));

// =================================================================================================
// The refusal verdicts — one test per reason, each provoked by a hand-written program
// =================================================================================================

describe('the issue verdict — a refusal reason per pairing rule', () => {
  /** The reason attached to the FIRST stall of a run, with the instruction it refused. */
  const firstStall = (ts: CycleTrace[]): { reason: string; instr: string } => {
    const s = eventsOf(ts, 'stall')[0];
    if (s === undefined) throw new Error('no stall event — the program did not provoke a refusal');
    return { reason: s.reason, instr: s.instr };
  };

  it('mem-port — two memory ops never pair, because there is one data-memory port', () => {
    // Two stores back to back. This is the structural-hazard lesson the tier gets for free, and it
    // is the rule that keeps MEM single-lane, which in turn keeps the cache and its miss-freeze
    // single-lane. `sw`/`sw` here; the rule is over the PORT, so a load beside a store refuses too.
    const ts = run(`.text
addi x1, x0, 256
addi x4, x0, 4
sw x1, 0(x1)
sw x1, 4(x1)
ecall
`);
    expect(firstStall(ts).reason).toBe('mem-port');
  });

  it('branch-slot — two control transfers never pair, because there is one branch unit', () => {
    // A NOT-TAKEN branch followed by a jump. Not taken on purpose: the rule is structural and is
    // decided at ISSUE, cycles before EX knows any outcome, so it must refuse a pair of transfers
    // whatever they later resolve to — a branch that falls through still occupied the unit. `jal`
    // is in the same class for the same reason, which is what this program pins.
    const ts = run(`.text
addi x1, x0, 1
addi x2, x0, 2
bne x1, x1, done
jal x0, done
done:
addi x3, x0, 3
ecall
`);
    const { reason, instr } = firstStall(ts);
    expect(reason).toBe('branch-slot');
    // ...and it is the JUMP that was refused, not the branch: slot 0 is never refused for a
    // pairing reason, which is what makes forward progress impossible to lose.
    expect(instr).toBe('i3');
  });

  it('intra-pair-raw — the younger cannot read what the older writes, at ANY forwarding setting', () => {
    // The teachable fact, and the reason this rule is not a forwarding-dependent one: forwarding
    // moves a value from a LATER stage back to EX, and there is no later stage than "beside me,
    // this very cycle". The producer's result does not exist yet, so no network can fix it.
    const src = `.text
addi x1, x0, 1
addi x2, x1, 2
ecall
`;
    for (const forwarding of [true, false]) {
      const ts = run(src, { ...W2, forwarding });
      expect(firstStall(ts).reason).toBe('intra-pair-raw');
    }
  });

  it('load-use and raw still refuse — the older stages did not stop mattering', () => {
    // The ordinary hazards are unchanged at width 2: they are questions about instructions already
    // in EX/MEM, and the group forming in ID has no bearing on them. What IS new is that they can
    // now refuse the YOUNGER member of a pair while the older issues.
    const loadUse = run(`.text
addi x1, x0, 256
lw x2, 0(x1)
addi x3, x2, 1
ecall
`);
    expect(eventsOf(loadUse, 'stall').map((s) => s.reason)).toContain('load-use');

    const raw = run(
      `.text
addi x1, x0, 1
addi x2, x0, 2
add x3, x1, x2
ecall
`,
      { ...W2, forwarding: false },
    );
    expect(eventsOf(raw, 'stall').map((s) => s.reason)).toContain('raw');
  });
});

// =================================================================================================
// Sliding / greedy grouping — the pinned alternative to aligned packets
// =================================================================================================

describe('sliding / greedy issue grouping', () => {
  it('a refused instruction leads the NEXT group — pairing recovers', () => {
    // The whole point of paying for sliding rather than taking cheap aligned packets. Under aligned
    // packets a refused instruction would be a bubble and pairing would depend on ADDRESS PARITY —
    // whether two instructions can go together would turn on where they happen to sit.
    //
    // Observed: i1 is refused at c1 for an intra-pair RAW on x1, and at c2 it is not merely retried
    // — it leads the group and pairs with i2, which was fetched behind it. Recovery, in one cycle.
    const ts = run(`.text
addi x1, x0, 1
addi x2, x1, 2
addi x3, x0, 3
ecall
`);
    expect(eventsOf(ts, 'stall')[0]).toMatchObject({ reason: 'intra-pair-raw', instr: 'i1' });

    // c1: i0 issues alone (i1 refused, and stays in ID as the survivor).
    expect(at(ts[1]!, 'ID.0')).toBe('i0');
    expect(at(ts[1]!, 'ID.1')).toBe('i1');
    // c2: i1 has SLID to slot 0 — it leads — and i2 has moved up beside it.
    expect(at(ts[2]!, 'ID.0')).toBe('i1');
    expect(at(ts[2]!, 'ID.1')).toBe('i2');
    // c3: they execute together. The refusal cost one cycle, not the rest of the run.
    expect(at(ts[3]!, 'EX.0')).toBe('i1');
    expect(at(ts[3]!, 'EX.1')).toBe('i2');
  });

  it('a slot is a per-cycle ISSUE POSITION, not a stable lane', () => {
    // The consequence the rest of the milestone has to respect — the visuals especially, where
    // "lane" must mean the per-cycle slot and IDENTITY must come from the id/follow-ring (INV-4),
    // never from the column an instruction happens to be in. Here i1 is in slot 1 at c1 and slot 0
    // at c2: the same instruction, two lanes, one id.
    const ts = run(`.text
addi x1, x0, 1
addi x2, x1, 2
addi x3, x0, 3
ecall
`);
    const walk = ts
      .map((t) => t.instructions.find((i) => i.id === 'i1')?.location)
      .filter((l): l is string => l !== undefined);
    expect(walk).toEqual(['IF.1', 'ID.1', 'ID.0', 'EX.0', 'MEM.0', 'WB.0']);
  });

  it('never livelocks — the oldest undispatched instruction is never refused for pairing', () => {
    // Forward progress, asserted rather than reasoned about. Slot 0 faces an empty group, so no
    // pairing rule can reach it; only the ordinary older-stage hazards can, and those drain. Over
    // the whole corpus, every run terminates and every stall names an instruction that later
    // retires — no instruction is ever refused forever.
    for (const file of readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.s'))) {
      const ts = runFile(file);
      const retired = new Set(eventsOf(ts, 'instr-retire').map((e) => e.instr));
      for (const s of eventsOf(ts, 'stall')) {
        // A stalled instruction may still be squashed later (wrong-path), so the honest claim is
        // "it retired OR it was killed" — what must never happen is that it just sat there.
        const stillInFlight = ts[ts.length - 1]!.instructions.some((i) => i.id === s.instr);
        expect(retired.has(s.instr) || !stillInFlight).toBe(true);
      }
    }
  });
});

// =================================================================================================
// The three trace-contract surfaces the plan pins for this step
// =================================================================================================

describe('surface (i) — intra-pair WB order is older-before-younger', () => {
  it('the younger slot wins architecturally, by being applied LAST', () => {
    // The same class of surface as M3's pinned "reg-write precedes reg-read": an intra-cycle
    // ordering that only becomes observable once two things happen in one cycle. Two slots writing
    // the SAME register is the sharpest case — program order says the younger wins, and the only
    // thing that makes it win is that WB walks its slots oldest first.
    const ts = run(`.text
addi x1, x0, 11
addi x1, x0, 22
ecall
`);
    const writes = eventsOf(ts, 'reg-write').filter((e) => e.reg === 1);
    // BOTH writes are emitted — the older is not suppressed. It happened; it was simply overwritten.
    expect(writes.map((w) => [w.instr, w.value])).toEqual([
      ['i0', 11],
      ['i1', 22],
    ]);
    // ...and the architectural result is the younger's.
    expect(ts[ts.length - 1]!.state.registers[1]).toBe(22);
  });

  it('retirement is in program order across the whole corpus, at both widths', () => {
    // In-order retirement is the premise the entire tier rests on, and it is exactly what final
    // state cannot check: both instructions do retire in the end, so a swapped pair is invisible to
    // conformance. Ids are handed out at FETCH, so a strictly increasing retire sequence IS
    // "retired in program order".
    //
    // This caught a real bug in MEM. A cache miss in slot 0 froze only its own slot, so a
    // non-memory instruction paired BEHIND it sailed on into WB and retired AHEAD of it.
    for (const file of readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.s'))) {
      for (const config of [W1, W2, { ...W2, cache: CACHE_SMALL }]) {
        const seqs = eventsOf(runFile(file, config), 'instr-retire').map((e) => seqOf(e.instr));
        const sorted = [...seqs].sort((a, b) => a - b);
        expect(seqs, `${file} @ width ${config.issueWidth}`).toEqual(sorted);
        expect(new Set(seqs).size).toBe(seqs.length); // ...and nothing retires twice
      }
    }
  });
});

describe('surface (ii) — INV-4 id determinism within a fetched pair', () => {
  it('the OLDER instruction of a fetched pair gets the lower seq', () => {
    // Load-bearing for follow-an-instruction: the id is the only handle identity has once a slot
    // stops being a stable lane. IF fills its slots oldest first, so this falls out of the fetch
    // loop — but it falls out of it silently, and a reordering there would be invisible to every
    // other test in the package.
    const ts = runFile('sum-loop.s');
    let pairsSeen = 0;
    for (const t of ts) {
      const a = at(t, 'IF.0');
      const b = at(t, 'IF.1');
      if (a === null || b === null) continue;
      expect(seqOf(a)).toBeLessThan(seqOf(b));
      pairsSeen += 1;
    }
    expect(pairsSeen).toBeGreaterThan(0); // not vacuously true of a run that never fetched a pair
  });

  it('`instructions[]` stays oldest-first once two lanes share a stage', () => {
    // The ordering rule `instructions[]` promises — stage by stage from WB back to IF, and slot 0
    // before slot 1 within a stage — is what makes "oldest first" still well defined at width 2.
    // Within any ONE stage the two slots are always in program order.
    for (const t of runFile('array-sum.s')) {
      for (const stage of ['IF', 'ID', 'EX', 'MEM', 'WB']) {
        const a = at(t, `${stage}.0`);
        const b = at(t, `${stage}.1`);
        if (a !== null && b !== null) expect(seqOf(a)).toBeLessThan(seqOf(b));
      }
    }
  });
});

describe('surface (iii) — intra-pair forwarding priority', () => {
  it('the YOUNGEST source still older than the consumer wins', () => {
    // The source set is what widening grows: it is now every SLOT of EX/MEM and MEM/WB. Both slots
    // of EX/MEM can hold a producer of the same register, and the younger one holds the value that
    // is actually current — so the scan runs from the highest slot down. Every slot of EX/MEM is a
    // whole stage older than every slot of EX, so "youngest source" needs no age comparison beyond
    // the slot index.
    //
    // Observed: i0 and i1 both write x1 (11 then 22) and pair; i2 reads x1 the next cycle with both
    // sitting in EX/MEM. It must see 22.
    const ts = run(`.text
addi x1, x0, 11
addi x1, x0, 22
addi x7, x1, 0
ecall
`);
    const forwards = eventsOf(ts, 'forward').filter((e) => e.instr === 'i2');
    expect(forwards).toHaveLength(1);
    expect(forwards[0]).toMatchObject({ from: 'EX/MEM', to: 'EX.rs1', value: 22 });
    expect(ts[ts.length - 1]!.state.registers[7]).toBe(22);
  });
});

// =================================================================================================
// Lane-aware squash — the signal that only starts discriminating at width 2
// =================================================================================================

describe('lane-aware squash', () => {
  it('a transfer in EX.0 kills its EX.1 mate', () => {
    // A branch may pair with a non-branch (only two TRANSFERS are refused), so a taken branch in
    // slot 0 has a younger mate beside it in EX — fetched sequentially behind it, therefore
    // wrong-path, therefore dead. This is the observed multi-slot flush the plan asked for before
    // deciding anything about `stages`.
    const ts = run(`.text
addi x1, x0, 0
beq x1, x0, t
addi x9, x0, 9
addi x8, x0, 8
t:
addi x3, x0, 3
ecall
`);
    const c3 = ts[3]!;
    expect(at(c3, 'EX.0')).toBe('i1'); // the branch
    expect(at(c3, 'EX.1')).toBe('i2'); // its mate
    expect(c3.events).toContainEqual({
      type: 'flush',
      reason: 'branch-taken',
      stages: ['EX', 'ID', 'IF'],
    });
    // The mate died in EX: it never reaches MEM, and it never retires.
    expect(ts[4]!.instructions.some((i) => i.id === 'i2')).toBe(false);
    expect(eventsOf(ts, 'instr-retire').map((e) => e.instr)).not.toContain('i2');
  });

  it('a transfer in EX.1 SPARES the older EX.0 beside it', () => {
    // The other half, and the reason `Squash` carries a slot at all. The spacer (`addi x7`) is
    // load-bearing: without it the branch is refused for an intra-pair RAW and slides into slot 0,
    // and this test silently becomes a second copy of the one above. That is exactly the trap the
    // observe-then-assert rule exists for — it happened while writing this file.
    const ts = run(`.text
addi x1, x0, 0
addi x2, x0, 0
addi x7, x0, 7
beq x1, x2, t
addi x9, x0, 9
t:
addi x3, x0, 3
ecall
`);
    const c3 = ts[3]!;
    expect(at(c3, 'EX.0')).toBe('i2'); // the older mate
    expect(at(c3, 'EX.1')).toBe('i3'); // the branch
    // `stages` does NOT name EX: nothing in EX died. Only what is behind the branch does.
    expect(c3.events).toContainEqual({
      type: 'flush',
      reason: 'branch-taken',
      stages: ['ID', 'IF'],
    });
    // ...and the spared older instruction goes on to retire normally.
    expect(eventsOf(ts, 'instr-retire').map((e) => e.instr)).toContain('i2');
    expect(ts[ts.length - 1]!.state.registers[7]).toBe(7);
  });

  it('a BET kills the ID slot behind the branch, and nothing older', () => {
    // A bet condemns the sequential path, so the ID slot behind the branch holds a fall-through and
    // dies with IF's. What separates this from a squash is that the branch itself and everything
    // older in its group live on — which is the whole reason a correct prediction costs 1, not 2.
    const ts = run(
      `.text
addi x1, x0, 0
addi x2, x0, 0
beq x1, x2, t
addi x9, x0, 9
t:
addi x3, x0, 3
ecall
`,
      { ...W2, branchPrediction: 'static-taken' },
    );
    const c2 = ts[2]!;
    expect(at(c2, 'ID.0')).toBe('i2'); // the betting branch
    expect(at(c2, 'ID.1')).toBe('i3'); // its mate — the fall-through
    expect(c2.events).toContainEqual({
      type: 'flush',
      reason: 'branch-predicted-taken',
      stages: ['ID', 'IF'],
    });
    // The branch survives its own bet and issues; the mate does not.
    expect(at(ts[3]!, 'EX.0')).toBe('i2');
    expect(eventsOf(ts, 'instr-retire').map((e) => e.instr)).not.toContain('i3');
  });

  it('a HALT kills the ID slot behind it — a flush that names ID for the first time', () => {
    // At width 1 a halt's flush could only ever cut IF, because the halting instruction WAS the one
    // occupant of ID. At width 2 it can have a live mate behind it, and `call-return.s` proves the
    // shadow is not hypothetical — real code sits directly behind an `ecall`.
    const ts = run(`.text
addi x7, x0, 7
addi x8, x0, 8
ecall
addi x9, x0, 9
`);
    const c2 = ts[2]!;
    expect(at(c2, 'ID.0')).toBe('i2'); // the ecall
    expect(at(c2, 'ID.1')).toBe('i3'); // its mate, in the shadow
    // `['ID']` ALONE, and the omission is the assertion. The shadow is the last word in `.text`, so
    // IF ran out of program and had nothing to lose — and `stages` names REAL casualties, not wires
    // that went high. That isolates the genuinely new fact: a halt flush naming ID.
    expect(c2.events).toContainEqual({ type: 'flush', reason: 'halt', stages: ['ID'] });
    expect(at(c2, 'IF.0')).toBe(null);
    expect(eventsOf(ts, 'instr-retire').map((e) => e.instr)).not.toContain('i3');
    expect(ts[ts.length - 1]!.state.registers[9]).toBe(0); // the shadow never wrote
  });

  it('`stages` stays BARE stage names — the slot encoding does not leak into events', () => {
    // The step-2a boundary, re-decided against the observed multi-slot flush rather than inherited.
    // The answer is still no: `stages` answers "which stages lost someone", the map and datapath
    // key off stage families, and a slotted spelling would fork three event types the schema shares
    // with the map, the datapath and the curriculum — for a distinction all three would fold back
    // out. A consumer that needs the identity of the dead has `instructions[]`.
    for (const file of readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.s'))) {
      const ts = runFile(file, { ...W2, branchPrediction: 'static-taken' });
      for (const t of ts) {
        for (const e of t.events) {
          if (e.type === 'flush') {
            expect(e.stages.every((s) => ['IF', 'ID', 'EX'].includes(s))).toBe(true);
          }
          if (e.type === 'stall') expect(e.stage).toBe('ID');
          if (e.type === 'forward') expect(['EX.rs1', 'EX.rs2']).toContain(e.to);
        }
      }
    }
  });
});

// =================================================================================================
// The acceptance line: width 2 is a real machine, and a strictly faster one
// =================================================================================================

describe('width 2 is a real machine', () => {
  it('sum-loop.s completes at both widths, with width 2 strictly faster', () => {
    // The plan's acceptance criterion for this step, and the flagship same-program A/B the whole
    // toggle exists for: same program, same answers, fewer cycles.
    const w1 = runFile('sum-loop.s', W1);
    const w2 = runFile('sum-loop.s', W2);
    expect(w1).toHaveLength(56);
    expect(w2).toHaveLength(44);
    expect(w2.length).toBeLessThan(w1.length);
    expect(w2[w2.length - 1]!.state.registers).toEqual(w1[w1.length - 1]!.state.registers);
  });

  it('is strictly faster on every program in the corpus, with identical final state', () => {
    // Pinned as EXACT counts, not as an inequality. `cycles = N + 4 + S + P + M` is step 4's
    // deliverable and these numbers are its raw material; an inequality would let the pairing logic
    // drift by a cycle in either direction and still pass, which for a timing-only tier is no net
    // at all. Observed and read back against the traces, one program at a time.
    const EXPECTED: Record<string, { w1: number; w2: number }> = {
      'add.s': { w1: 7, w2: 6 },
      'array-sum-twice.s': { w1: 208, w2: 178 },
      'array-sum.s': { w1: 51, w2: 42 },
      'branch-flavors.s': { w1: 15, w2: 11 },
      'byte-loads.s': { w1: 10, w2: 9 },
      'call-return.s': { w1: 17, w2: 14 },
      'sum-loop.s': { w1: 56, w2: 44 },
    };
    const files = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.s'));
    // The corpus is INV-7's, shared by every model — a new program must show up here rather than
    // be silently skipped by a hard-coded list.
    expect(files.sort()).toEqual(Object.keys(EXPECTED).sort());

    for (const file of files) {
      const w1 = runFile(file, W1);
      const w2 = runFile(file, W2);
      const pinned = EXPECTED[file]!;
      expect(w1.length, `${file} @ width 1`).toBe(pinned.w1);
      expect(w2.length, `${file} @ width 2`).toBe(pinned.w2);
      expect(w2.length).toBeLessThan(w1.length);

      // INV-8's shape, applied across the WIDTH axis: same program, same answers. This is the check
      // that is true for free and proves almost nothing on its own — kept because the one thing it
      // does catch is a pairing bug that corrupts the machine outright.
      const a = w1[w1.length - 1]!.state;
      const b = w2[w2.length - 1]!.state;
      expect(b.registers, file).toEqual(a.registers);
      expect(b.pc, file).toBe(a.pc);
      expect(b.memory, file).toEqual(a.memory);
    }
  });

  it('really does issue two per cycle — the micro is slot-shaped and both slots fill', () => {
    // Guards the degenerate pass: a width-2 machine that never actually paired would satisfy every
    // structural test above and simply be slow. It would NOT satisfy this one.
    const ts = runFile('sum-loop.s');
    const micro = ts[0]!.state.micro as { width: number };
    expect(micro.width).toBe(2);

    const paired = ts.filter((t) => at(t, 'EX.0') !== null && at(t, 'EX.1') !== null);
    expect(paired.length).toBeGreaterThan(3);

    // ...and two instructions really do retire in one cycle.
    const doubleRetires = ts.filter(
      (t) => t.events.filter((e) => e.type === 'instr-retire').length === 2,
    );
    expect(doubleRetires.length).toBeGreaterThan(3);

    // Both slot spellings appear in `location`, which is what step 5 and the map will read.
    const seen = new Set(ts.flatMap((t) => t.instructions.map((i) => i.location)));
    expect([...seen].sort()).toEqual(
      ['IF', 'ID', 'EX', 'MEM', 'WB'].flatMap((s) => [`${s}.0`, `${s}.1`]).sort(),
    );
  });

  it('holds a paired non-memory instruction in MEM behind a missing load', () => {
    // The freeze propagates DOWNWARD in age only. A miss in MEM.0 holds its younger mate in MEM.1
    // (otherwise that mate retires first — see the in-order retirement test, which this bug broke);
    // a miss in MEM.1 does NOT hold the older MEM.0, which is already ahead and owes it nothing.
    const ts = run(
      `.text
addi x1, x0, 256
addi x4, x0, 4
lw x2, 0(x1)
addi x5, x0, 5
ecall
`,
      { ...W2, cache: CACHE_SMALL },
    );
    const miss = ts.findIndex((t) => t.events.some((e) => e.type === 'cache-access' && !e.hit));
    expect(miss).toBeGreaterThan(0);
    // The mate is still sitting in MEM.1 a cycle later, going nowhere.
    expect(at(ts[miss]!, 'MEM.0')).toBe('i2');
    expect(at(ts[miss]!, 'MEM.1')).toBe('i3');
    expect(at(ts[miss + 1]!, 'MEM.1')).toBe('i3');
    // ...and when they finally move, they retire together and in order.
    const retires = eventsOf(ts, 'instr-retire').map((e) => e.instr);
    expect(retires.indexOf('i2')).toBeLessThan(retires.indexOf('i3'));
  });
});
