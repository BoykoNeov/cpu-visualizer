import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble } from '@cpu-viz/assembler';
import { toProgramImage } from '@cpu-viz/engine-common';
import { defaultConfig, type CycleTrace, type ProcessorConfig } from '@cpu-viz/trace';
import { SuperscalarProcessor, SUPERSCALAR_CAPABILITIES, MAX_ISSUE_WIDTH } from './index';

/**
 * The three surfaces M7 step 2a introduces that neither `differential.test.ts` (final state) nor
 * `timing.test.ts` (M3's cycle counts, transplanted) can see:
 *
 *  1. the `"<stage>.<slot>"` `location` encoding — a deliberate difference from M3, pinned here;
 *  2. `reset()`'s width guard — which through M7–M12 refused anything but 1 or 2, and as of M13
 *     step 1 admits every whole number in `1..MAX_ISSUE_WIDTH`. What it must never do is accept a
 *     width and then silently run narrower than the config asked for;
 *  3. the capabilities constant, enumerated exhaustively so a new knob cannot be added without this
 *     model stating its stance (the shape M7 step 1 pinned across the family).
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

function runFile(file: string, config: ProcessorConfig = defaultConfig()): CycleTrace[] {
  const { program, errors } = assemble(readFileSync(PROGRAMS_DIR + file, 'utf8'));
  if (!program) throw new Error('assembly failed: ' + errors.map((e) => e.message).join('; '));
  const p = new SuperscalarProcessor();
  p.reset(toProgramImage(program), config);
  const traces: CycleTrace[] = [];
  while (!p.isHalted()) traces.push(p.step());
  return traces;
}

describe('the "<stage>.<slot>" location encoding', () => {
  const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'];

  it('is slotted at width 1 — never a bare stage name', () => {
    // The whole content of the pin. Emitting bare names at width 1 and slotted ones at width 2
    // would make the encoding depend on a config the view cannot see, so every consumer would need
    // both spellings. One spelling everywhere is the honest contract, and `stageFamily` (M3 step 7)
    // already folds `"EX.0"` back to `EX`, so no consumer pays for it.
    const seen = new Set<string>();
    for (const t of runFile('array-sum.s')) {
      for (const i of t.instructions) seen.add(i.location);
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const location of seen) {
      expect(STAGES.map((s) => `${s}.0`)).toContain(location);
    }
    // ...and all five stages really are exercised, so this is not vacuously true of a run that
    // never filled the pipe.
    expect([...seen].sort()).toEqual(STAGES.map((s) => `${s}.0`).sort());
  });

  it('walks one instruction IF.0 → ID.0 → EX.0 → MEM.0 → WB.0, in that order', () => {
    // INV-4's stable id is what makes this readable at all: the same id appears in five successive
    // stages. At width 1 the slot never changes — a slot is a per-cycle ISSUE POSITION, not a
    // stable lane, so once pairing exists an instruction may well change slots. Pinning the
    // width-1 walk now is what will make that change visible when it happens.
    const ts = runFile('add.s');
    const first = ts[0]!.instructions[0]!.id;
    const walk = ts
      .map((t) => t.instructions.find((i) => i.id === first)?.location)
      .filter((l): l is string => l !== undefined);
    expect(walk).toEqual(['IF.0', 'ID.0', 'EX.0', 'MEM.0', 'WB.0']);
  });

  it('leaves the EVENT vocabulary byte-identical to the pipeline — only `location` is slotted', () => {
    // The boundary, stated as an assertion rather than left to prose. `stall.stage` and
    // `flush.stages` are cross-model surfaces three consumers already read (the datapath, the map's
    // cut rows, the curriculum); slotting them would be a schema change wearing a string's clothes,
    // and at width 1 there is nothing a slot could disambiguate anyway. Whether they should carry
    // slots once a PAIR can die together is step 2b's question, to be decided against an observed
    // multi-slot flush.
    const ts = runFile('array-sum.s', { ...defaultConfig(), forwarding: true });
    for (const t of ts) {
      for (const e of t.events) {
        if (e.type === 'stall') expect(e.stage).toBe('ID');
        if (e.type === 'flush') expect(e.stages.every((s) => !s.includes('.'))).toBe(true);
        if (e.type === 'forward') expect(['EX.rs1', 'EX.rs2']).toContain(e.to);
      }
    }
  });
});

/**
 * M13 step 5 — the same encoding, at every width the guard admits. `WIDTHS` is DERIVED from
 * {@link MAX_ISSUE_WIDTH} (steps 1/3/4's precedent), so raising the bound cannot leave the widest
 * machine's locations unpinned in silence.
 *
 * The two claims below are deliberately split, because **they do not have the same scope**:
 *
 *   - **SUBSET is universal.** No program at any width may emit a location outside
 *     `STAGES × [0..w-1]`. This is the generalization of the width-1 pin above, and it holds on
 *     every program in the corpus. It is also the WEAKER half, and the break record says exactly
 *     how weak: clamping the emitted slot to `min(s, 1)` produces only LEGAL locations, so the
 *     subset loop never fires — it was the **non-vacuity clause riding with it** that reddened, and
 *     nothing else in this test could have. Subset alone cannot see a machine running narrow while
 *     claiming wide, which is why the two tests after it exist and why that clause is not decoration.
 *   - **SURJECTIVITY is program-specific, and must be MEASURED per width.** "Every slot index
 *     appears" is false for `add.s` at width 3 and false for eight of twelve programs at width 4 —
 *     which is not a defect, it is the width axis's own lesson (`docs/plans/m13-tasks.md` finding 3:
 *     width 4 is where widening stops paying). Asserting it corpus-wide would have been the plan's
 *     named lie — "a test that passes at width 4 because nothing ever filled four slots" — inverted.
 *
 * Every set below was DUMPED and read before it was asserted (`M:\claud_projects\temp\m13-step5\`),
 * never reasoned from the pairing rules.
 */
describe('the "<stage>.<slot>" location encoding at every admitted width', () => {
  const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
  const WIDTHS = Array.from({ length: MAX_ISSUE_WIDTH }, (_, n) => n + 1);
  const CORPUS = readdirSync(PROGRAMS_DIR)
    .filter((f) => f.endsWith('.s'))
    .sort();

  /**
   * Forwarding ON / no prediction / no cache — the SAME cell `timing.test.ts`'s `fillsFour` uses,
   * so the two measurements are comparable rather than merely similar. Both surjectivity results
   * below are scoped to this config and claim nothing about the others.
   */
  const at = (w: number): ProcessorConfig => ({
    ...defaultConfig(),
    forwarding: true,
    issueWidth: w,
  });

  const locationsOf = (file: string, w: number): Set<string> => {
    const seen = new Set<string>();
    for (const t of runFile(file, at(w))) for (const i of t.instructions) seen.add(i.location);
    return seen;
  };

  const crossProduct = (w: number): string[] =>
    STAGES.flatMap((s) => Array.from({ length: w }, (_, n) => `${s}.${n}`));

  it.each(WIDTHS)(
    'emits nothing outside STAGES × [0..w-1], over the whole corpus [width %i]',
    (w) => {
      const legal = new Set(crossProduct(w));
      let total = 0;
      for (const file of CORPUS) {
        for (const location of locationsOf(file, w)) {
          expect(legal.has(location), `${file} @ w${w} emitted ${location}`).toBe(true);
          total += 1;
        }
      }
      // Non-vacuity: the sweep really did read locations, and at least one program really did use
      // the widest slot the config offers — otherwise "nothing illegal" is a claim about an empty
      // set. (Which program does it is the NEXT test's business, and it is not all of them.)
      expect(total).toBeGreaterThan(0);
      expect(CORPUS.some((f) => locationsOf(f, w).has(`ID.${w - 1}`))).toBe(true);
    },
  );

  it('names exactly which programs reach EVERY slot of every stage, per width', () => {
    // MEASURED, then compared to the names — never read off a table, which would re-bless whatever
    // the table says (`fillsFour`'s rule, applied one layer down).
    const surjective = (w: number): string[] => {
      const want = crossProduct(w).sort();
      return CORPUS.filter((f) => [...locationsOf(f, w)].sort().join() === want.join());
    };

    // Widths 1 and 2: every program in the corpus fills the picture. This is the shipped machine,
    // and it is why nobody had to think about the question before M13.
    expect(surjective(1)).toEqual(CORPUS);
    expect(surjective(2)).toEqual(CORPUS);

    // Width 3: all but `add.s`, which is five instructions long and never gets three into EX.
    expect(surjective(3)).toEqual(CORPUS.filter((f) => f !== 'add.s'));

    // Width 4: FIVE programs — the same five `timing.test.ts` measures as the only ones that ever
    // dispatch a group of four. Two independent measurements (a location set here, an issue-size
    // histogram there) landing on the same names is the cross-check worth having. `nested-loop.s`
    // is the one that joined at step 0b, and the only one whose four is a HEAD group rather than a
    // drain: its prologue holds four independent instructions ending in the pass guard.
    // `register-reuse.s` (M15 step 6) is the drain kind — its tail is four independent instructions
    // because the WAW pair it was written for needs no dependence between them.
    expect(surjective(4)).toEqual([
      'branch-flavors.s',
      'nested-loop.s',
      'paired-branches.s',
      'register-reuse.s',
      'slow-op-loop.s',
    ]);
  });

  it('the LAST slot is fetched into far more often than it is issued from — 12 programs vs 5', () => {
    // Why surjectivity fails on eight of thirteen programs at width 4, stated as the asymmetry that
    // causes it rather than left as a bare set difference. FETCH is not gated by the pairing rules:
    // `stageIf` fills every seat it can reach, so `IF.3` is ordinary. ISSUE is gated — one memory
    // port, one branch unit, no intra-group RAW — so `EX.3` requires a group of four to survive all
    // three rules. The gap between these two numbers IS the "fourth slot is mostly empty, and here
    // is which rule keeps it empty" lesson, measured at the trace layer.
    const w = MAX_ISSUE_WIDTH;
    const emits = (stage: string): string[] =>
      CORPUS.filter((f) => locationsOf(f, w).has(`${stage}.${w - 1}`));

    expect(emits('IF')).toEqual(CORPUS.filter((f) => f !== 'add.s'));
    expect(emits('IF')).toHaveLength(12);
    expect(emits('EX')).toEqual([
      'branch-flavors.s',
      'nested-loop.s',
      'paired-branches.s',
      'register-reuse.s',
      'slow-op-loop.s',
    ]);

    // ...and the containment is the honest form of the claim: everything that ISSUES from the last
    // slot must first have been FETCHED into it. A break that inverted these would show up here.
    for (const f of emits('EX')) expect(emits('IF')).toContain(f);
  });
});

describe('issueWidth', () => {
  const image = () => {
    const { program } = assemble('.text\naddi x1, x0, 1\necall\n');
    return toProgramImage(program!);
  };

  /**
   * The slot arrays are always FULL LENGTH and null-padded — that is what makes a bubble
   * distinguishable from the end of the stage, and what `SuperscalarMicro.width`'s docblock
   * promises ("every array below has exactly this length"). Asserting the stored `width` alone
   * would only check that `reset()` remembered its argument.
   */
  const shapeOf = (p: SuperscalarProcessor) => {
    const micro = p.getState().micro as {
      width: number;
      ifId: unknown[];
      idEx: unknown[];
      exMem: unknown[];
      memWb: unknown[];
    };
    return [
      micro.width,
      micro.ifId.length,
      micro.idEx.length,
      micro.exMem.length,
      micro.memWb.length,
    ];
  };

  it('defaults to 1 when the config omits it', () => {
    // `issueWidth` is OPTIONAL in `ProcessorConfig` (it follows `seed`'s precedent, not `cache`'s),
    // so an absent value means "no opinion" and must not throw — every existing config literal in
    // the repo omits it, including `defaultConfig()`.
    //
    // The DEFAULT is asserted, not just the absence of a throw. `not.toThrow()` alone would pass
    // just as happily on a `?? 2` slip — and the out-of-order model, built from this one's config
    // precedent, really does default to 2, so the two numbers are one edit apart. This is also the
    // one config shape M13 step 1's byte-identity goldens never exercised: that harness always
    // passed `issueWidth` explicitly, so the absent-field path had no net at all.
    const p = new SuperscalarProcessor();
    expect(() => p.reset(image(), defaultConfig())).not.toThrow();
    expect(p.isHalted()).toBe(false);
    expect(shapeOf(p)).toEqual([1, 1, 1, 1, 1]);
  });

  it('accepts an explicit 1', () => {
    const p = new SuperscalarProcessor();
    expect(() => p.reset(image(), { ...defaultConfig(), issueWidth: 1 })).not.toThrow();
  });

  it('accepts an explicit 2 — step 2b made the other toggle position a real machine', () => {
    // Step 2a's refusal lived here, and lifting it is the headline of step 2b. It was an honest
    // "not yet": a model that had accepted width 2 while quietly issuing one instruction per cycle
    // would have been indistinguishable from a working dual-issue machine to every consumer except
    // a cycle count — and the width toggle's entire observable effect IS a cycle count.
    const p = new SuperscalarProcessor();
    expect(() => p.reset(image(), { ...defaultConfig(), issueWidth: 2 })).not.toThrow();
    expect(p.isHalted()).toBe(false);
  });

  it('accepts every width up to MAX_ISSUE_WIDTH — M13 step 1 widened the guard, and only the guard', () => {
    // The refusal at 3 lived here through M7–M12 and said a wider machine "would need pairing rules
    // it does not have". **That was false about this code**, and M13's step-0 dump is what
    // established it rather than an argument: `issueVerdict` asks each rule against the whole
    // GROUP, `stageId`/`detectHazard`/`stageIf` all loop `this.width`, and widths 3 and 4 ran the
    // entire corpus to correct architectural state with the guard as the only thing changed. The
    // old message was a description of itself.
    for (let w = 1; w <= MAX_ISSUE_WIDTH; w++) {
      const p = new SuperscalarProcessor();
      expect(() => p.reset(image(), { ...defaultConfig(), issueWidth: w })).not.toThrow();
      expect(p.isHalted()).toBe(false);
      // The MACHINE's shape, not just the verdict: all four latches must be `w` slots wide.
      expect(shapeOf(p), `width ${w}`).toEqual([w, w, w, w, w]);
    }
  });

  it('rejects a width that is not a whole count in 1..MAX_ISSUE_WIDTH', () => {
    // The bound is real surface, not a formality: past MAX_ISSUE_WIDTH there is no derived timing
    // cell and no adversarial net, so admitting 5 would ship a machine nothing checks.
    //
    // `0` and `MAX + 1` are the ends. `1.5` and `NaN` are here because `w < 1` — the obvious
    // spelling, and the one this guard used to be a cousin of — is FALSE for both: the M9+M10
    // review's own capacity fix shipped with exactly that hole. A fractional width would floor to
    // a machine nobody asked for; a NaN width makes every `s < this.width` loop body unreachable,
    // which is a processor that fetches nothing and never halts.
    const p = new SuperscalarProcessor();
    for (const bad of [0, -1, MAX_ISSUE_WIDTH + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => p.reset(image(), { ...defaultConfig(), issueWidth: bad })).toThrow(
        /is not a width this machine has/,
      );
    }
  });
});

describe('capabilities', () => {
  it('is the first model in the family that honors every knob', () => {
    // Enumerated EXHAUSTIVELY on purpose, in the shape M7 step 1 pinned across the family: a new
    // config knob must be a compile error here, so that adding one forces this model to state a
    // stance rather than inheriting a default nobody chose.
    expect(SUPERSCALAR_CAPABILITIES).toEqual({
      model: 'superscalar',
      pipelined: true,
      hasHazards: true,
      configurableForwarding: true,
      configurableBranchPrediction: true,
      configurableCache: true,
      configurableIssueWidth: true,
      configurableOutOfOrder: false,
    });
  });

  it('is exposed on the instance', () => {
    expect(new SuperscalarProcessor().capabilities).toBe(SUPERSCALAR_CAPABILITIES);
  });

  /**
   * M9 step 0 — the out-of-order config cluster (`outOfOrderIssue`, `robSize`, `slowOpLatency`) is
   * inert here, whole-trace. Superscalar is the last and widest in-order model, so it is the one an
   * OoO knob is most tempting to imagine "already half-supports" — it does not: width and
   * out-of-order are orthogonal axes, and this pins that the wide in-order machine ignores the OoO
   * cluster completely. Width is held FIXED (the default single-issue position) so the comparison
   * isolates the OoO fields; `array-sum.s` carries a branch, loads and a store — the shape any such
   * knob would reach. The knobs are aggressive non-defaults so a leak has something loud to move.
   */
  it('ignores the out-of-order config cluster — whole trace identical with the knobs on', () => {
    const withOoo = runFile('array-sum.s', {
      ...defaultConfig(),
      outOfOrderIssue: true,
      robSize: 4,
      slowOpLatency: 20,
    });
    expect(withOoo).toEqual(runFile('array-sum.s'));
  });
});

describe('micro is slot-shaped, and each snapshot is its own', () => {
  it('every latch is an array of `width` slots', () => {
    const state = runFile('add.s')[0]!.state;
    const micro = state.micro as {
      width: number;
      ifId: unknown[];
      idEx: unknown[];
      exMem: unknown[];
      memWb: unknown[];
    };
    expect(micro.width).toBe(1);
    for (const slots of [micro.ifId, micro.idEx, micro.exMem, micro.memWb]) {
      expect(Array.isArray(slots)).toBe(true);
      expect(slots).toHaveLength(1);
    }
  });

  /**
   * **IF is the enforcer of the post-bet kill, and `stageId`'s `killedRest` is a duplicate.**
   *
   * Found in M7 step 4 by provoking, not by reading: deleting `killedRest` outright left all 680
   * suites green, because `stageIf` runs after `stageId` in the reverse walk and clears every seat
   * of `next.ifId` on a bet or a squash regardless. The redundancy is kept deliberately — ID should
   * not silently depend on a sibling stage undoing its work — but "deliberate" only holds if the
   * enforcer is pinned. This is that pin: if IF ever stops clearing, `killedRest` quietly becomes
   * load-bearing and nothing else in the package would notice.
   *
   * The observable consequence: after a bet, ID is empty the next cycle. That empty cycle is the
   * whole of the `+1` a correct prediction costs, and `timing.test.ts` prices it as such.
   *
   * IF, by contrast, is **not** empty — and the first draft of this test wrongly asserted it was.
   * `ifSlot` is cleared at the edge and then immediately refills from the REDIRECTED pc, so IF
   * already holds the target while ID is still empty. That is precisely why a correct bet costs one
   * cycle instead of the mispredict's two, so the right thing to pin is the target's presence, not
   * an emptiness that never happens. Watched in the trace, not reasoned about.
   */
  it('a bet empties ID next cycle, and IF already holds the target', () => {
    const config: ProcessorConfig = {
      ...defaultConfig(),
      issueWidth: 1,
      branchPrediction: 'static-taken',
    };
    const ts = runFile('sum-loop.s', config);
    const pcs = new Map(
      ts.flatMap((t) =>
        t.events.filter((e) => e.type === 'instr-fetch').map((e) => [e.instr, e.pc]),
      ),
    );
    const bets = ts.flatMap((t, c) =>
      t.events.flatMap((e) =>
        e.type === 'branch-predicted' ? [{ cycle: c, target: e.target }] : [],
      ),
    );
    expect(bets.length, 'sum-loop bets on every one of its ten branches').toBe(10);

    for (const { cycle, target } of bets) {
      const after = ts[cycle + 1];
      if (!after) continue; // the last bet can fall inside the drain
      // ID is empty: the fall-through that was sitting there died at the clock edge.
      expect(
        after.instructions.some((i) => i.location.startsWith('ID.')),
        `cycle ${cycle + 1}: ID must be empty after a bet`,
      ).toBe(false);
      // ...but IF is already fetching the TARGET, which is what makes a bet cheaper than a
      // mispredict. If this ever reads the fall-through instead, the redirect stopped landing.
      const inIf = after.instructions.find((i) => i.location.startsWith('IF.'));
      expect(inIf, `cycle ${cycle + 1}: IF refilled`).toBeDefined();
      expect(pcs.get(inIf!.id), `cycle ${cycle + 1}: IF holds the bet's target`).toBe(target);
    }
  });

  it('does not alias slot arrays across cycles — the time-travel bug conformance cannot see', () => {
    // The recorder keeps every cycle, so a shared array would replay as latest-values-everywhere.
    // Final-state conformance is structurally blind to it; only a cross-cycle comparison sees it.
    const ts = runFile('add.s');
    const arrays = ts.map((t) => (t.state.micro as { idEx: unknown[] }).idEx);
    expect(new Set(arrays).size).toBe(arrays.length);
    // ...and the contents really do differ over time, so the check above is not vacuous.
    const occupants = ts.map(
      (t) => ((t.state.micro as { idEx: ({ instr: string } | null)[] }).idEx[0] ?? null)?.instr,
    );
    expect(new Set(occupants).size).toBeGreaterThan(1);
  });
});
