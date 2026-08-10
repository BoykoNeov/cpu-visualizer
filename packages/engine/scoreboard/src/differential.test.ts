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
