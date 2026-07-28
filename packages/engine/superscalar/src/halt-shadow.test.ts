import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assemble } from '@cpu-viz/assembler';
import { toProgramImage, CACHE_SMALL, CACHE_LARGE } from '@cpu-viz/engine-common';
import {
  defaultConfig,
  type CacheConfig,
  type CycleTrace,
  type ProcessorConfig,
} from '@cpu-viz/trace';
import { SuperscalarProcessor, MAX_ISSUE_WIDTH } from './index';

/**
 * **A HALT IN A BRANCH'S SHADOW MUST NOT STOP FETCH FOREVER — the wedge, and the net that sees it.**
 *
 * `haltFetch` is sticky by design ("fetch never restarts, the pipe just drains"), and that is right
 * for a halt on the real path. But `isArchHalt` raises it in ID, at ISSUE, which is cycles before an
 * older branch sitting in EX has resolved. When that branch turns out to be TAKEN, the halt was
 * wrong-path all along: the squash kills it, the redirect moves `fetchPc` back to the loop — and the
 * sticky flag it already set means nothing is ever fetched from there. The pipe drains, `halted` is
 * never raised (the halt died; only a RETIRING halt raises it), and `step()` returns empty cycles
 * for ever.
 *
 * **`isHalted()` never goes true, so a bare `while (!p.isHalted())` never returns.** Stated
 * precisely, because the two layers above this one differ: `Recorder.runToEnd` (`recorder.ts:158`)
 * loops on `isHalted()` but is guarded by `maxCycles = 1_000_000`, so it THROWS
 * "non-terminating program?" rather than hanging for ever — after accumulating a million cycle
 * traces, each carrying a full state snapshot. That is not a survivable amount of memory: this
 * investigation's own first dump run exhausted a 4 GB Node heap doing exactly this, which is why
 * the harness that found the bug had to cap itself before it could report anything.
 *
 * **This is width ≥ 2 only, and it is NOT a milestone-13 finding — it is live in shipped code.**
 * At width 1 the halt reaches ID a whole cycle after the branch reaches EX, so `stageId`'s
 * `ctx.squash` early-return always beats it. From width 2 a halt can issue in the SAME GROUP as an
 * unresolved branch, and nothing refuses that pairing: `ecall` has no source registers (no
 * intra-pair RAW), uses no memory port, and is not in `TRANSFERS`.
 *
 * **The corpus was safe by accident of one idiom, which is why 4498 tests were green.** Every
 * program in `content/programs/` exits with `li a7, 10` sitting between the branch and the `ecall`,
 * and that spacer is the only reason the halt never co-issues. Move `li a7, 10` above the loop —
 * an ordinary thing to write, and the shorter program — and the 2-wide machine hangs. The
 * termination sweep at the bottom of this file exists because "empty pipe, no fetch, not halted"
 * was a reachable state that no suite in the repo could see: every runner loops `while
 * (!p.isHalted())`, so the failure mode is a hang rather than a red test.
 *
 * The fix is at the clock edge and is deliberately the narrowest of the three candidates: a
 * branch squash CLEARS `haltFetch`. It cannot move a single pinned cycle count, because it only
 * ever fires on a run that previously did not terminate at all — and `timing`/`pairing`/
 * `conformance` were re-run to confirm zero numbers moved. The two broader candidates (ending the
 * issue group at any unresolved transfer; deferring `stopFetch` to retirement) both change WHEN
 * fetch stops on runs that already work, and would have invalidated M7 step 4's matrix.
 *
 * Why clearing is safe in general, not just here: once a halt issues it squashes everything younger
 * (`killedRest` breaks the group), so no instruction younger than a halt is ever in flight behind
 * it. A branch resolving in EX is therefore never younger than a live halt — so any `haltFetch`
 * standing when a branch squash lands belongs to a wrong-path halt, always.
 */

const PROGRAMS_DIR = fileURLToPath(new URL('../../../../content/programs/', import.meta.url));

/**
 * The bug's own program. `a7` is set BEFORE the loop, so `bnez` and `ecall` are adjacent and can
 * land in one issue group — the exact shape the corpus's `li a7, 10` spacer hides.
 */
const NO_SPACER = `    .text
    .globl _start
_start:
    li   a7, 10
    li   t0, 3
loop:
    addi t0, t0, -1
    bnez t0, loop
    ecall
`;

/**
 * The CONVERSE program, and the one that keeps the fix honest. Same adjacency — `bnez` then `ecall`
 * with no spacer — but with **live code after the `ecall`**, so "did fetch stop?" is an observable
 * question rather than a vacuous one. On the last trip the branch falls THROUGH, so the `ecall`
 * co-issues with it and is on the REAL path: its `haltFetch` must survive, and nothing beyond it may
 * ever be fetched.
 *
 * Without the trailing instructions this test cannot fail. The `ecall` would be the last word in
 * `.text`, so fetch would stop on the `inText` bound whether or not the flag was wrongly cleared —
 * a green check measuring nothing, which is the house's own named trap.
 */
const REAL_PATH_HALT = `    .text
    .globl _start
_start:
    li   a7, 10
    li   t0, 3
loop:
    addi t0, t0, -1
    bnez t0, loop
    ecall
    addi t1, x0, 111
    addi t2, x0, 222
    addi t3, x0, 333
`;

/** The corpus exit idiom, for contrast: the spacer keeps the halt out of the branch's group. */
const SPACER = `    .text
    .globl _start
_start:
    li   t0, 3
loop:
    addi t0, t0, -1
    bnez t0, loop
    li   a7, 10
    ecall
`;

/**
 * Runs to completion, or throws once past `cap`. **The cap IS the assertion** — the failure this
 * file exists for is a non-terminating run, and an uncapped `while (!p.isHalted())` expresses that
 * as a hung suite rather than a failure.
 */
function run(source: string, config: ProcessorConfig, cap = 500): CycleTrace[] {
  const { program, errors } = assemble(source);
  if (!program) throw new Error('assembly failed: ' + errors.map((e) => e.message).join('; '));
  const p = new SuperscalarProcessor();
  p.reset(toProgramImage(program), config);
  const ts: CycleTrace[] = [];
  while (!p.isHalted()) {
    ts.push(p.step());
    if (ts.length > cap) {
      throw new Error(
        `did not terminate within ${cap} cycles — the pipe drained but isHalted() stayed false`,
      );
    }
  }
  return ts;
}

const cfg = (over: Partial<ProcessorConfig>): ProcessorConfig => ({
  ...defaultConfig(),
  forwarding: true,
  ...over,
});

const SCHEMES: ProcessorConfig['branchPrediction'][] = ['none', 'static-not-taken', 'static-taken'];

/**
 * **Every width the guard admits, read from the guard.** This list was `[1, 2]` until M13 step 1,
 * for the good reason that 3 and 4 threw. Widening the guard in that step made them reachable —
 * and this file is the ONLY net in the repo that turns a width-3/4 non-termination into a red test
 * rather than a hung suite, because every other runner loops `while (!p.isHalted())` with no bound.
 * So it is widened in the same commit as the guard, not left to step 2: the alternative is a window
 * in which the model accepts a width nothing checks for liveness.
 *
 * Derived from `MAX_ISSUE_WIDTH` rather than typed as `[1, 2, 3, 4]` so that raising the bound
 * cannot quietly leave this sweep behind — the failure mode that would leave the widest machine
 * the least tested.
 */
const WIDTHS = Array.from({ length: MAX_ISSUE_WIDTH }, (_, i) => i + 1);

describe('a halt in a taken branch’s shadow', () => {
  it('does not wedge the machine — every width × prediction scheme terminates', () => {
    for (const issueWidth of WIDTHS) {
      for (const branchPrediction of SCHEMES) {
        expect(() => run(NO_SPACER, cfg({ issueWidth, branchPrediction }))).not.toThrow();
      }
    }
  });

  /**
   * The provocation, pinned as its own case. Before the fix this was the ONLY position of the six
   * above that hung — `static-taken` escapes because the branch BETS, which ends the issue group
   * and keeps the `ecall` out of it, and width 1 escapes structurally. A future change that
   * re-broke the general case while leaving this one working would be a strange bug; a change that
   * re-broke exactly this cell is the bug this file is about.
   */
  it('is a width-2, no-bet phenomenon — the exact cell that used to hang', () => {
    const ts = run(NO_SPACER, cfg({ issueWidth: 2, branchPrediction: 'none' }));
    expect(ts.length).toBeGreaterThan(0);
    // The wedge signature: a taken-branch flush, then cycles that fetch nothing and never halt.
    const flushes = ts.flatMap((t) => t.events.filter((e) => e.type === 'flush'));
    expect(flushes.length).toBeGreaterThan(0);
    // Fetching RESUMED after the last flush — the thing the sticky flag used to prevent.
    let lastFlush = -1;
    for (let c = 0; c < ts.length; c++) {
      if (ts[c]!.events.some((e) => e.type === 'flush')) lastFlush = c;
    }
    const fetchedAfter = ts
      .slice(lastFlush + 1)
      .some((t) => t.events.some((e) => e.type === 'instr-fetch'));
    expect(fetchedAfter).toBe(true);
  });

  /**
   * **The converse, and the half a "does it terminate?" test cannot reach.** The fix clears
   * `haltFetch` on a branch squash; this pins that it clears it on NO other occasion. On the last
   * trip the branch falls through and the `ecall` co-issues with it on the REAL path — so its flag
   * must stand, and the three instructions after it must never be fetched even though they sit in
   * `.text` and the fetch pointer is aimed straight at them.
   *
   * Why the argument alone was not enough to skip this: "a branch resolving in EX is never younger
   * than a live halt" is a claim about SLOT ORDERING, and this repo's rule is that any claim naming
   * a slot must be watched rather than reasoned — M7 shipped a slot-1 test that passed while
   * demonstrating its opposite. The reasoning happens to hold (a halt ends its group via
   * `killedRest`, so nothing younger than it is ever in flight), but this is what checks it.
   */
  it('leaves a REAL-path halt’s flag alone — nothing past the ecall is ever fetched', () => {
    for (const issueWidth of WIDTHS) {
      for (const branchPrediction of SCHEMES) {
        const ts = run(REAL_PATH_HALT, cfg({ issueWidth, branchPrediction }));
        const fetched = ts.flatMap((t) =>
          t.events.filter((e) => e.type === 'instr-fetch').map((e) => e.pc),
        );
        // **Instructions after the halt ARE fetched, and that is correct** — `stopFetch` applies at
        // the clock edge, so IF still fetches the halt's shadow before the squash kills it, exactly
        // as `stageId` documents. The bound is ONE FETCH GROUP, because that is how much IF can
        // take in the cycle the halt issues: measured `maxPc` is 20 at width 1, 24 at width 2 under
        // `none`/`static-not-taken`, and 28 at width 2 under `static-taken` — i.e. never past
        // `halt + 4 × width`. So the assertion is width-derived rather than a constant.
        //
        // Two earlier drafts of this line failed against a CORRECT engine, which is the point of
        // measuring instead of reasoning: `[]` past the halt ignored the shadow, and `[]` past the
        // shadow ignored that a 2-wide machine fetches the shadow two at a time.
        const bound = 20 + 4 * issueWidth;
        const past = fetched.filter((pc) => pc > bound);
        expect(
          past,
          `fetched past the halt’s shadow group (>${bound}) at w${issueWidth}/${branchPrediction}`,
        ).toEqual([]);
        // ...and whatever WAS fetched never committed: t1/t2/t3 are still zero. This is the
        // config-independent half — it holds at every width and scheme regardless of how far the
        // shadow reached, and it is what a wrongly-cleared flag could not survive, since fetch would
        // run on through all three and retire them.
        const regs = ts[ts.length - 1]!.state.registers;
        expect([regs[6], regs[7], regs[28]], `dead code committed at w${issueWidth}`).toEqual([
          0, 0, 0,
        ]);
      }
    }
  });

  /**
   * The architectural check. Terminating is not enough — the loop must have run its full trip count
   * and the halt must be the one on the REAL path. Both spellings of the same program agree with
   * each other and across widths, which is what says the wrong-path halt was properly discarded
   * rather than merely survived.
   */
  it('reaches the same architectural state as the spacer spelling, at both widths', () => {
    const finals = new Set<string>();
    for (const source of [NO_SPACER, SPACER]) {
      for (const issueWidth of WIDTHS) {
        for (const branchPrediction of SCHEMES) {
          const ts = run(source, cfg({ issueWidth, branchPrediction }));
          const last = ts[ts.length - 1]!;
          finals.add(JSON.stringify(Array.from(last.state.registers)));
        }
      }
    }
    expect(finals.size).toBe(1);
  });

  /**
   * **The general net — and it is honest about what it did NOT do.** This sweep was written
   * alongside the fix and run against the BROKEN engine, where it passed: every corpus program uses
   * the `li a7, 10` spacer, so none of them could reach the wedge. It would not have found this bug.
   * What it is for is the next one — a corpus program written without the spacer, or any future
   * change that makes "empty pipe, no fetch, not halted" reachable again. That state was previously
   * unobservable anywhere in the repo, because every runner loops on `isHalted()`, so the failure
   * mode is a hung suite rather than a red test. The bound is what converts a hang into a failure.
   *
   * The bound is generous on purpose — it is a LIVENESS net, not a timing one. `timing.test.ts`
   * owns the exact counts, and a bound tight enough to double as a timing assertion would have to
   * be re-derived every time the matrix moves.
   */
  it('every corpus program terminates, at every width × forwarding × prediction × cache', () => {
    const files = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.s'));
    expect(files.length).toBeGreaterThan(0);
    const caches: (CacheConfig | null)[] = [null, CACHE_SMALL, CACHE_LARGE];
    for (const file of files) {
      const source = readFileSync(PROGRAMS_DIR + file, 'utf8');
      for (const issueWidth of WIDTHS) {
        for (const forwarding of [false, true]) {
          for (const branchPrediction of SCHEMES) {
            for (const cache of caches) {
              expect(
                () =>
                  run(source, {
                    ...defaultConfig(),
                    forwarding,
                    branchPrediction,
                    cache,
                    issueWidth,
                  }),
                `${file} @ w${issueWidth}/${forwarding ? 'fwd' : 'nofwd'}/${branchPrediction}/${
                  cache === null ? 'nocache' : `cache${cache.numLines}`
                }`,
              ).not.toThrow();
            }
          }
        }
      }
    }
  });
});
