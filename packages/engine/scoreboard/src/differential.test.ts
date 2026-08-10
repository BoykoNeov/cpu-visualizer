import { runConformance } from '@cpu-viz/engine-conformance';
import { type ProcessorConfig } from '@cpu-viz/trace';
import { ScoreboardProcessor } from './index';

/**
 * INV-8 for the scoreboard (M15 step 2): final architectural state ≡ the golden reference on every
 * example program.
 *
 * ## ⚠ This is a WEAK net, and the weakness is MEASURED rather than suspected
 *
 * The two hazards this whole milestone exists to show — WAW at Issue, WAR at Write-Result — are
 * **invisible to this suite on today's corpus**, and not by the usual "timing is architecturally
 * invisible" argument. Stubbing either check genuinely corrupts state, but only *given a program
 * that contains such a pair*, and a scan of all twelve corpus programs at step 1 measured **zero
 * reachable WAW or WAR hazards** (`M:\claud_projects\temp\m15-corpus-scan\scan.mjs`; the two static
 * WAW candidates in `branch-flavors.s` are a dead branch path and a pair that shares one integer
 * unit under in-order issue, and the three `lw`/`addi` WAR candidates all read before the younger
 * write can land). So a scoreboard with both checks deleted passes every cell below.
 *
 * That is not a permanent property. **Step 3 proves it by execution** (both stubs run, both leave
 * this suite green while `timing.test.ts` reddens) and **step 6 flips it** — once the WAW/WAR
 * demonstration program joins `content/programs/`, this suite becomes a genuine net on the
 * mechanism and both mutations are re-run against it. Until then, do not read a green run here as
 * coverage of the scoreboard's subject.
 *
 * ## What it DOES catch, which is not nothing
 *
 * **The ISA transcription.** `processor.ts` mirrors the golden reference's arithmetic verbatim and
 * deliberately does not import it — `eslint.config.js` denies the edge by name, because INV-8's
 * whole design is that the differential proves the copy faithful. A dropped `>>> 0`, a `>>` where
 * the reference has `>>>`, a missing `imm & 0x1f`, a sign-extension lost in transcription: caught
 * here and nowhere else. Structural, so it needs no mutation to state — the same claim
 * `deep-pipeline` and `out-of-order` make about their own copies.
 *
 * **The three things this machine does that no earlier model had to.** All three are architecturally
 * visible, so this is the right suite for them: the drain-to-halt (halting when the machine is
 * EMPTY, not when fetch stops — `add.s` ends with instructions still in their units), the `pc`
 * prefix rule, and the control hold at an unresolved transfer.
 *
 * The `pc` rule is stated structurally, not measured, and the reason is worth writing down: at halt
 * the retire queue is drained by construction, so "the completed program-order prefix" and "whoever
 * wrote last" **coincide on the final `pc`** — which is exactly why `processor.ts`'s header says the
 * backward movement is invisible here and checkable only in the recorded snapshots (step 4).
 *
 * ## The control hold: MEASURED here, because it is this suite's one real claim
 *
 * `processor.ts`'s header says holding Issue at an unresolved transfer is "**forced by INV-8, not
 * chosen**". That is a claim about *this file*, so it is run rather than argued: comment out
 * `issueBlocker`'s `'control'` test and **2 of the 12 cells redden — `nested-loop.s` and
 * `array-sum-twice.s`**, the other ten staying green. Step 1 ran the same stub early against an
 * ad-hoc corpus harness and got the same two programs (`docs/plans/m15-tasks.md`, "the mutation
 * check, run early"); re-running it against THIS suite is what makes the number this file's own.
 *
 * Two details behind that count are new, and neither was predicted:
 *
 * - **Both fail on the harness's `MAX_STEPS` cap, not on a state comparison.** The wrong-path
 *   instruction that survives is a *loop counter's decrement*, so the corrupted machine never
 *   finishes at all rather than finishing with wrong values. Probed on `nested-loop.s`: `addi t2,
 *   t2, -1` (the OUTER pass counter, at pc 28) retires after every taken iteration of the INNER
 *   branch at pc 24 — `t2` reaches −16 and keeps falling, so `bne t2, x0, outer` never terminates.
 *   A reader who expects "INV-8 red" to mean "registers differ" will misread this failure.
 * - **Ten green cells are a WINDOW measurement, not an absence of wrong-path writes.** With the hold
 *   removed, the wrong-path window is **one or two instructions deep across the whole corpus**, and
 *   the bound comes from the stage walk rather than from anything about the programs: a branch that
 *   issues at N reads at N+1 and resolves in `EX` at N+2, and `stageExecute` runs BEFORE
 *   `stageIssue`, so the redirect empties `IF` before Issue is asked. Only what issued in between
 *   gets through. Probed on `sum-loop.s`: the branch issues at c9, `li a7, 10` (pc 20) issues at
 *   c10, and the flush at c11 kills the `ecall` still sitting in `IF` — one survivor, and a harmless
 *   one, since it writes the value the program was going to write anyway. Had the `ecall` issued
 *   instead, the machine would have halted a whole loop early.
 *
 *   The second instruction appears only when the branch itself stalls a cycle at `RO`. **Measured
 *   over all twelve programs: exactly four contain a branch that stalls there at all**
 *   (`nested-loop` 4 stall cycles, `array-sum-twice` 2, `array-sum` 1, `strided-sum` 1) **and no
 *   branch anywhere stalls for more than ONE cycle.** That is the corpus fact doing the work here:
 *   the header's own witness (`lw` / `beq` on the loaded value / `addi`) opens a much wider window
 *   by parking the branch at `RO` behind a four-cycle load, and no corpus branch waits on a load.
 *
 *   So the ten green cells say "one or two wrong-path instructions, and they did not matter" — not
 *   "no wrong-path instruction". Which two programs redden is decided by WHAT the survivor writes
 *   (a live loop counter), not by whether one exists: `array-sum` and `strided-sum` stall a branch
 *   at `RO` too, and stay green.
 *
 * ## Why this matrix is ONE config, and not the house 6 / 18 / 36
 *
 * Two independent reasons, stated separately because they fail differently and a future reader
 * restoring an axis would hit one or the other:
 *
 * - **Inertness.** `forwarding`, every `branchPrediction` scheme, and the whole out-of-order cluster
 *   are inert on this machine — nothing in `processor.ts` reads them. That is not asserted here; it
 *   is pinned in `processor.test.ts` ("every knob is inert") as a **byte-identical trace** at every
 *   position. An extra column would therefore be green by proof, which is the precise shape of the
 *   false coverage `m7-superscalar-engine` and the `deep-pipeline`/`out-of-order` differentials warn
 *   about: cells that look like evidence and are arithmetic identity.
 * - **Refusal.** `cache` and an `issueWidth` above 1 are REFUSED — `reset()` throws (plan decision 5,
 *   pinned in `processor.test.ts`'s "the refused knobs fail fast"). Adding those axes would produce
 *   thrown Errors rather than red assertions: a failure that reads as a broken suite instead of as
 *   the deliberate scope lever it is. Unlike `deep-pipeline`'s cache refusal, no later step lifts
 *   these — the single blocking memory unit IS this model's memory timing, and Issue is one
 *   instruction per cycle by definition of the machine.
 *
 * And a third, narrower trap: do NOT add an explicit `issueWidth: 1` beside the absent one to make
 * the axis "visible". The harness's `configLabel` defaults both sides before comparing, so the two
 * fold to the same machine, no label is emitted, and the matrix gains twelve duplicate `it()`
 * titles. `processor.test.ts` already pins that equivalence directly.
 */

/**
 * `cache: null` is written EXPLICITLY rather than inherited from `defaultConfig()` — the
 * `deep-pipeline` practice, for its pre-step-6 reason, which here is permanent. The field is
 * load-bearing: this model THROWS on a non-null cache, so a future change to `defaultConfig()`'s
 * default would turn twelve green cases into twelve thrown Errors. Naming it makes the matrix say
 * what it means independently of that default. The other two fields are spelled out for the same
 * reason in weaker form — they are inert, so a default change would be silent rather than loud, and
 * silent is worse.
 */
const CONFIGS: ProcessorConfig[] = [{ forwarding: false, branchPrediction: 'none', cache: null }];

runConformance('scoreboard', () => new ScoreboardProcessor(), CONFIGS);
