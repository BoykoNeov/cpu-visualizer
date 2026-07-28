---
name: m9-out-of-order
description: 'M9 build log: out-of-order execution (Tomasulo / ROB / register renaming) - the ROB+rename skeleton, the scheduler, the INV-8 differential full-cross, the lifecycle table, `follow()` through the ROB, web enablement, the MicroTablePanel and the bespoke OoO datapath.'
metadata:
  node_type: memory
  type: project
---

## M9 — out-of-order execution (Tomasulo/ROB/renaming), relocated from the MEMORY.md index 2026-07-22

The north-star tier (roadmap §12.5); scope = model + view (`docs/plans/m9-tasks.md`, pinned
2026-07-21, `188cfe9`). Per-step detail lives in the plan doc; this is the condensed cross-step log.

**Step 0 (2026-07-21, `ed95e58`, 2511 tests) — CONFIG-ONLY, zero trace events.** YAGNI held: no
view/engine exists yet, so nothing forces `rename`/`dispatch`/`issue`/`cdb-broadcast`/`commit` into
the schema. `ProcessorConfig` gained optional `outOfOrderIssue`/`robSize`/`slowOpLatency`;
`ProcessorCapabilities` gained REQUIRED `configurableOutOfOrder` (compile-errored the 4 model
constants + 2 stub fixtures, the M7-step-1 mechanism). Whole-trace inertness proven per-model
(final-state inertness can't see a config field that reorders events while leaving the answer
correct). Corpus decision (static analysis, `temp/m9/step0-corpus-analysis.md`): money shot =
`array-sum.s` (ROB≥6 reaches the miss-independent next `lw`), MSHR default 2 confirmed, no
`sw`→dependent-`lw` alias in the corpus so `store-forward.s` is warranted but authored at 1b.

**Step 1a (2026-07-22, in-order-issue OoO base, width-parametric) — the ROB/rename/Tomasulo-skeleton
core held to strict in-order issue.** Reproduces M3's pipeline closed form at `issueWidth:1` and
M7's superscalar closed form at `issueWidth:2` cycle-for-cycle over corpus × prediction × cache
(`timing.test.ts`, 145 tests); full repo 2823 tests. 8 bugs fixed en route (full list in the plan
doc); sharpest two: branch-prediction bets fired at DISPATCH one cycle too early whenever the branch
itself had to wait on a broadcast — fixed by a new `stageBet` pass one cycle ahead of issue,
mirroring `stageIssueExecute`'s resource-contest walk; and `ctx.memStall` was set unconditionally on
a miss's RELEASE cycle too, over-freezing the front end by one cycle. **Disclosed deviation:**
dispatch also blocks on an unresolved predictable-transfer bet (`hasUnresolvedBet`), not just ROB
capacity/width — flagged as a 1b touch-point, not re-litigated. Pins going into 1b: benefit source =
Option B on A (non-blocking cache-miss MLP as the floor + a configurable FU-latency knob, deferred);
issue width = build the OoO+superscalar machine ONCE, width-parametric (`issueWidth`, default 2);
renaming = classic speculative Tomasulo, built PRF-forward-compatible via three seams (opaque `Tag`
type, ROB ordering separated from payload, one operand-read + one commit choke point).

**Step 1b (2026-07-22, the scheduler itself — wakeup/select, non-blocking LSU, disambiguation, CDB
arbitration).** The load-bearing structural call (advisor-vetted before writing code): gate the
ENTIRE new machine behind `ProcessorConfig.outOfOrderIssue`, so `false` reproduces 1a byte-for-byte
(`timing.test.ts` is the free regression net) — and it's also why the money shot works, since the
in-order branch still blocks on a miss. Money shot: `array-sum.s`, cache on, static-taken — **61
in-order → 41 out-of-order cycles**, byte-identical final state. Mechanisms: `stageIssueExecute`/
`stageBet` unified into one shared generator `walkIssuable` (in-order STOPS at the first not-ready
entry, out-of-order SKIPS it); the CDB has exactly `width` ports, oldest-`seq`-wins, losers carry
over one cycle; MSHRs (`numMshrs`, default 2) gate concurrent misses per-entry; disambiguation is
stall-until-the-aliasing-store-commits (no forwarding), which requires stores to defer their actual
write to commit (not MEM access) since out-of-order issue lets a store's address+data be computed
speculatively past a still-unresolved older branch. New corpus program `store-forward.s` (a store
immediately followed by a dependent load of the same address) needed hand-derived timing-table
entries in every model's `timing.test.ts`/`pairing.test.ts` (a corpus addition is never free — see
`content/programs/README.md`). **One real correctness bug found, not anticipated:** `haltFetch` was
a STICKY flag, safe in 1a's strict in-order issue but broken once `ecall` (which reads no registers,
so is always ready) could issue wrong-path behind an unresolved branch — fixed by re-deriving
`haltFetch` from the ROB's own post-flush contents. Option B (`slowOpLatency`) deliberately NOT
built — stays inert, deferred pending a corpus-driven pick. Acceptance: money shot + one unit test
per new mechanism (`scheduler.test.ts`, 7 tests) + `store-forward.s`'s disambiguation pin, plus one
check beyond the literal list (advisor): `outOfOrderIssue` true vs false byte-identical over the
WHOLE corpus at one fixed config — `true == reference` transitively, since `false` already is. Full
repo: 2991 tests.

**Step 2 (2026-07-22, the INV-8 differential net) — `differential.test.ts` now full-crosses
`outOfOrderIssue` against width × prediction × cache (36 configs × 9 programs, all green); ROB size
gets one TARGETED small config (`robSize: 1`) rather than a fifth cross-product axis (advisor call
against the plan's literal "× ROB size" phrasing — a timing-blind net gets near-zero marginal teeth
from a knob whose only effect is WHEN dispatch stalls; the one thing a small ROB actually touches is
`disambiguationClear`'s "the aliasing store already committed and left the ROB" branch, verified in
a cycle dump). `configLabel` (the shared `engine-conformance` harness) gained an `outOfOrderIssue`
axis mirroring `issueWidth`'s exact precedent, plus matching guard tests in `conformance.test.ts`.
**Real finding, not just a checkbox: `store-forward.s` (authored at 1b FOR this bug class) does NOT
expose it** — checked empirically, a disambiguation-disabled variant still computes the correct
answer on it at every config tried, because its adjacent store/load share the single memory port and
oldest-first issue plus matched per-request miss costs on the same line keep the store's write ahead
of the load's read regardless of the gate. (What `store-forward.s` actually pins is the OTHER
step-1b mechanism: the deferred-to-commit write.) A program that DOES expose the gate needs the
older store's ADDRESS — not just its write — unresolved: `disambiguation-mutation.test.ts` authors
one (an aliasing load ready immediately, racing an older store whose base register is gated behind a
slow, cache-missing, unrelated load) and confirms `a0` corrupts 99→0 when `disambiguationClear` is
forced to always clear, WITH a cache, and does NOT corrupt with the cache off — pinning that the
corruption genuinely needs the miss-widened window the plan's own "how this can lie to itself"
section names. **Built as a PERMANENT regression test, not provoke-then-revert\*\* (advisor call,
weighed against step 0's ephemeral eslint-guard precedent — disambiguation is the one load-bearing
property of an otherwise-weak net, unlike a static lint rule that can't be committed permanently
broken). Mechanism: `disambiguationClear` changed `private`→`protected` (the one production change
this step needed) for a tiny test-only subclass to override; the test can't import
`@cpu-viz/engine-reference` directly (the DAG boundary `engine-conformance` enforces), so it checks
against a hand-computed oracle the same way `conformance.ts`'s own `RESULT_ORACLES` do. Full repo:
3169 tests, typecheck, lint, build all green.

**Step 3 (2026-07-22, the per-instruction lifecycle table) — scope disclosed (advisor-guided): two
programs traced COMPLETELY at the OoO config rather than the full corpus × configs literally (that's
unbounded by hand) — `store-forward.s` (width 1, disambiguation/store-defer) and `array-sum.s` (width
2, static-taken, `CACHE_LARGE`, the flagship). Discipline actually followed: derived `store-forward.s`'s
full 7-instr/11-cycle table BLIND from the stage-order rules before running anything (including a
subtle same-cycle zero-latency dispatch-forward — an entry's issue-this-cycle is visible to a
younger entry's dispatch-this-cycle, since issue runs before dispatch within one `step()` call) — 100%
match against a real dump, zero corrections. Used that validated confidence on `array-sum.s`: derived
setup+iteration 0 blind (matched through cycle 6), then periodicity + reconciliation for the rest, per
the advisor's explicit "derive structure, reconcile against ONE dump, treat disagreements as findings
— don't single-step to certainty." **Two real findings, not transcription:** (1) the fast
(pointer/counter/branch) chain and the slow (sum-reduction) chain compete for the SAME width-2 issue
budget once the first miss releases — the OLDER reduction wins oldest-first priority when both are
ready the same cycle, stretching the fast chain's 4-cycle bet period to 6 around the miss-recovery
window (predicted from the rules, THEN confirmed in the dump). (2) the two misses do NOT overlap
(first releases@15, second not even detected until@23) — `array-sum.s`'s money shot is "independent
work races around ONE miss," not miss-under-miss (that's `scheduler.test.ts`'s dedicated 2-MSHR
program) — conflating them would overclaim. Total 41 cycles (0..40), matching the step-1b log's
pinned 61→41 exactly. **Mutation check, both ways:\*\* neutered `walkIssuable`'s OoO skip→stop —
`array-sum.s` collapses to EXACTLY 61 cycles (the in-order closed-form baseline); `differential.test.ts`
(348 tests) stays all green; `scheduler.test.ts`'s own timing assertions get 4 expected-shape
failures. Reverted immediately (provoke-then-revert, step-0's precedent — a cycle-count check, not a
toggleable boolean like step 2's `protected` seam). Landed as
`packages/engine/out-of-order/src/lifecycle.test.ts` (19 tests, asserting only what the trace schema
exposes — `lui`/`auipc`/`jal`/`ecall` issue silently and are explicitly NOT asserted at issue rather
than force-fit). Full derivation: `temp/m9/step3-lifecycle-derivation.md`. Full repo: 3188 tests,
typecheck, lint, build, format:check all green.

**Step 4 (2026-07-22, recorder/`follow()` through the ROB, the INV-4 payoff) — DONE, zero
production changes.** The real gap (found before coding, advisor-flagged): every block in
`recorder.test.ts` since step 1a never set `outOfOrderIssue`, so nothing there had ever driven the
scheduler THROUGH THE RECORDER — it was an in-order baseline only. Added: (a) load→run→back→scrub
over a TRUE OoO recording; (b) **completion order ≠ commit order**, read through the shipped
`follow()`/`recorded` API — at the flagship `array-sum.s` config (identical to step 3's: width2/
OoO/static-taken/`CACHE_LARGE`/robSize32), the OLDER stuck reduction add (ROB tag5) completes
(`alu-op`) at cycle16 while the YOUNGER independent counter decrement (tag7) completes at cycle5 —
**out of program order** — yet tag5 retires@18 before tag7@19 — **in program order**, a strict
inequality both directions (tag6 ties tag5 at commit, so tag7 not tag6 is the clean fixture).
**`follow()` proves only IDENTITY** (`location` stays `"ROB#<tag>"` the whole in-flight life, per
1a) — the reordering is invisible to `follow()` alone and lives entirely in the event stream, so
the payoff is follow() + cross-id event comparison together, stated as its own assertion, not
implied. (c) INV-4 under conditions 1a never provoked: the load's pc is fetched **six** times, not
five — 5 real dynamic iterations (several concurrently in-ROB, each a distinct id/tag, no
aliasing) + **1** wrong-path speculative re-fetch (final iteration's wrong static-taken bet)
squashed at `"IF"` before ever getting a ROB tag, never retiring — dumped and read, not assumed.
**Honesty about teeth (advisor's explicit ask):** the timing divergence itself is already caught by
step 3's `walkIssuable` mutation — this step doesn't newly net that and says so; what IS newly
checked is that step 3's exact mutation (provoked again, reverted via `git checkout --`) also fails
THIS suite's two new claims (61-cycle collapse; completion-cycle assertion breaks), proving they
have independent teeth rather than just replaying step 3 under a different API. Landed as additions
to `recorder.test.ts` (18 tests, up from 10; 1a's blocks untouched). Full repo: **3196 tests**,
typecheck, lint, build, format:check all green.

**Step 5 (2026-07-23, web enablement) — DONE, BROWSER-VERIFIED CLEAN on the first pass** (the rare
view step with no defect, like M5 step 5). The OoO model is now the fifth `models.ts` row and
drivable in the browser; the flagship in-order↔out-of-order toggle + the ROB-size control are gated
on `configurableOutOfOrder` and ride M3's config seam as the 5th/6th knobs with **zero widening**
(exact `issueWidth` precedent: optional `ProcessorConfig` fields, `outOfOrderIssue ?? false` /
`robSize ?? 16`, threaded through `useSimulator` state/refs/config/setters + `LessonOpening`/
`lessonOpening`). **Browser proof of the flagship acceptance:** `array-sum`, cache large,
static-taken, width 2 — flipping in-order→out-of-order WITHOUT reloading drops **cycle 60 → 41**
live, and the pipeline map (free via INV-3 — it already keys cells off the free-form `location`, so
`"ROB#3"` resolved for free exactly as `"EX.0"` did at M7 step 5) redraws the picture: `lw ROB#24`
stuck on a miss cycles 22–35 while younger `lui`/`addi`/`sw`/`ecall` dispatch and run 27–41 around
it, each loop-body instance a distinct ROB tag (INV-4). The issue-order + ROB controls are ABSENT on
the superscalar (confirmed in-browser — it keeps forwarding/predict/cache/width), and forwarding is
ABSENT on OoO (`configurableForwarding: false` — renaming makes it meaningless; the reflex "hazards
⇒ forwards" is the trap `models.test.ts`'s per-knob set catches).

**Three disclosed deviations from the step's literal phrasing, each with precedent** (all recorded in
`m9-tasks.md` step 5): (1) **`datapath: 'none'`, NOT `DatapathKind: 'out-of-order'`** — a
`DatapathKind` value asserts a diagram EXISTS; the bespoke OoO datapath is step 7. The union member +
App's dispatch arm + the value flip land TOGETHER at step 7 (superscalar sat at `'none'` through M7
step 6). Step 5's picture is the map + an "Out-of-order datapath — coming soon" placeholder. (2) **NO
FU-latency control** — Option B's `slowOpLatency` is still unread by the engine, so a control would
be "a control that cannot move anything." (3) **forwarding stays `['pipeline','superscalar']`.**

**The one real find — a LATENT step-1a gap, surfaced only because the web package's new `"*"`
dependency forced real npm resolution:** `packages/engine/out-of-order` was added to the tsconfig
references and vitest aliases at step 1a but NEVER to the npm `workspaces` array, so `npm install`
tried to fetch `@cpu-viz/engine-out-of-order` from the registry (E404). Tests/typecheck never noticed
(vitest uses its own aliases; `tsc -b` uses project references — neither hits node resolution). Fixed
by adding it to `workspaces` (DAG order). **Reusable: a new engine package needs FOUR wirings, not
three — tsconfig references, vitest alias, AND the npm `workspaces` array; the first two are exercised
by tests immediately, the third only when something declares a real `"*"` dep on it.**

**Opening defaults pinned against a live width-1/width-2 × OoO-on/off probe (not guessed):**
issue-order opens **in-order** (degenerate = the machine just learned), ROB opens **full (16)** where
the money shot shows, ROB small is **4** (chokes `array-sum` back toward in-order). The flip drops
cycles at BOTH widths (69→57 at w1, 61→42 at w2), so opening at the shared width-1 position still
demonstrates it from cold start — the advisor's one load-bearing pre-write check. **ROB size is a
CONDITIONAL lever like the cache** (flat on `sum-loop`/`store-forward`, moves only `array-sum`), not
universal like width — its titles disclose this. Full repo: **3203 tests** (+7: +4 App shape tests,

- models/session updates), typecheck, lint, build, format:check all green.

**Step 6 (2026-07-23, the `MicroTablePanel` — ROB/RS/rename tables) — DONE, BROWSER-VERIFIED CLEAN on
the first pass** (the SECOND OoO view step in a row with no defect, after step 5). The tier's star
surface, the deliverable `superscalar-visuals.md` §3 designed and deferred to here — three HTML tables
in one `.panel`, each a pure fold over `state.micro` (INV-3), rows carrying the follow-highlight: the
ROB (head marked ▶, states waiting→executing→completed, head's `· commits`), the reservation stations
(operand = captured value vs `⤺ ROB#tag`), the rename map (arch reg → in-flight tag, pending rows
only). **The load-bearing engine change: `MachineState.micro` — deferred UNSET at 1a/1b ("a shape for
a view that does not exist") — is now populated by `snapshotMicro()`, the step-0 YAGNI trigger firing
exactly on schedule.** Files: new `packages/engine/out-of-order/src/micro.ts` (the exported
`OutOfOrderMicro`/`RobEntryView`/`OperandView`/`RenameSlotView`, all plain value objects — no opaque
`Tag` leaks, tags read back to plain numbers via `tagNumber` IN the engine so the view compares only
numbers, PRF seam intact); `snapshotMicro()` in `processor.ts`; `RenameTable.snapshot()` + `Rob.maxSize`
getter; new web `MicroTablePanel.tsx` + `.test.tsx`; App slot gated on `hasMicroTables` (a trace fact,
`micro.rob` is an array), placed high (the OoO datapath is still the step-7 placeholder). **Two
advisor-flagged traps, both handled: (1) TRAP 1, the repo's signature time-travel bug — the ROB
snapshot must copy PER-ENTRY (a fresh `RobEntryView` per entry, scalars by value, immutable `decoded`
by reference), NEVER `.slice()` the array, because `RobEntry.state`/`.value` are mutated in place and
`Rob.entries` is `shift()`ed on commit, so an array-only copy replays every recorded cycle as FINAL
state — invisible to final-state conformance, caught only by reading a snapshot at an EARLIER cursor;
proven HEADLESS in `recorder.test.ts` (the old "micro is genuinely absent" step-1a block, INVERTED: a
tag reads `waiting` early and `completed` later). (2) TRAP 2, silent gate collision — the OoO micro
shape has NO `width` field, so `PairingReadout`'s `typeof micro.width==='number'` gate never fires for
it; the panel gates on `micro.rob` instead.** **The cache is NOT re-exported into `micro` (a reversal,
advisor-caught before the follow-up commit): the first version exposed `micro.cache`, but the shared
`cache-grid.ts` was built for the PIPELINE shape — it derives its `filling` countdown from
`micro.exMem.missCyclesRemaining`, which OoO lacks. Optional chaining → no crash, but the fill never
computes, so a line reads RESIDENT for the whole miss penalty while the ROB table above shows the load
`executing` — a cross-surface contradiction on the exact surface (the miss) that is the tier's drama.
REUSABLE: "appears for free via INV-3" is NOT free when the consumer reads fields of a DIFFERENT
model's `micro` shape — check what the newly-activated surface actually consumes. Conservative fix:
dropped `micro.cache`, restoring step 5's no-OoO-cache-grid behavior (browser-reverified: grid absent,
tables render, 41 cycles hold).** The RS table is a PROJECTION not a new structure —
classic speculative Tomasulo holds operand values in the ROB, so a `'waiting'` ROB entry IS the
RS-equivalent (`rob.ts`); no parallel RS array, no new trace events, no CDB field (step-6 tables fold
over `micro` STATE per the plan; a wakeup is already visible as an operand flipping ready). **Browser
proof at the flagship config (`array-sum`, width 2, out-of-order, static-taken, cache large, ROB full
→ 41 cycles):** at cycle 12 the head `ROB#4 lw` is `executing` (stuck on the miss) and `ROB#5 add`
(reduction) `waits` behind it, while younger `ROB#6/7/8/9` (incl. a later `lw`) have all `completed` —
out-of-order completion, in-order commit spine, side by side; the RS shows the reduction chain
`#5→#10→#15` stalled on load tags while independent `addi`s read `ready →`; and clicking `ROB#16` lit
EXACTLY three rows (its ROB row, RS row, rename-map row `t0 → ROB#16`) PLUS 13 pipeline-map rings PLUS
the transport chip "following ROB#16" — the cross-surface follow composition, the click-only defect
class, clean. Full repo: **3211 tests** (+8: +7 `MicroTablePanel.test.tsx`, +1 net `recorder.test.ts`),
typecheck, lint, build, format:check all green.

**Step 7 (2026-07-23, the bespoke OoO datapath — the sheddable half that never had to be shed) — DONE,
BROWSER-VERIFIED CLEAN on the first pass. M9 IS COMPLETE.** New `datapath-out-of-order.ts` +
`OutOfOrderDatapathView.tsx` + `.test.ts` (17), the fifth hand-authored geometry: PC → instr mem →
decode/rename dispatching into the ROB + reservation stations, which issue to a functional-unit pool
and a load/store unit whose results ride the **Common Data Bus** back to the RS and ROB, with the ROB
head committing in order into the register file. `models.ts` flipped `out-of-order` `'none'` → its own
kind (union member + App dispatch arm + `models.test.ts` datapath-table row, all three together — the
superscalar precedent, the table reddening the reminder). **THE ONE LOAD-BEARING CALL (advisor-vetted
before any geometry): this is the ONLY datapath whose `activate` folds `state.micro` (box occupancy)
AND `events` (flow).** An OoO `location` is uniformly `"ROB#tag"` — no structural stage, so box
occupancy (ROB/RS) reads the SAME `micro` the step-6 tables read at this cursor (the superscalar's
"NEVER `micro`" warning does NOT apply — its `micro` is latch state a cycle ahead; the OoO ROB snapshot
IS the cursor's own state). **Coherence of that micro+events pairing was DUMPED and read on `array-sum`
around the first miss BEFORE writing geometry** (throwaway colocated test): at cycle 16 the events
(`alu add` R/I result, `alu add` on a `lw` = an ADDRESS, `retire`) and the ROB states tell one story.
Three dump-driven code facts: (1) a load's `alu-op` is an ADDRESS → LSU, a branch's is a COMPARE → no
CDB result; only an R/I `alu-op` or a load's `mem-read` is a bus RESULT (the superscalar's
LOADS/STORES/BRANCHES split); (2) `retire(id)` names an entry ALREADY gone from `micro` — the commit
wire draws the departing instruction, coherent as "it has retired"; (3) the **CDB is TWO-PHASE** (`rob.ts`
`wake()`: producer writes its ROB entry at cycle i, waiters capture at i+1) → drawn wholly at the
PRODUCE cycle, attributed to the producer, asserting no cycle-precise wakeup (that's step 3's job).
**Three advisor calls that changed the build:** (a) do NOT build a prev-cycle-diff — events
self-describe issue/commit/flush/fetch; only DISPATCH lacks a single-cycle signal, and an IF-driven
dispatch wire would mislight exactly when a full ROB should show it CHOKING (the ROB-size lever), so
`rename→ROB`/`rename→RS` are static SKELETON (never lit; `activate` throws if asked to light one), the
targeted seq-diff fallback never needed (browser-clean); (b) phase-hue stands on its own grammar, NOT
"matches the map" (the map rows by `location`, not phase columns); (c) coherence litmus only —
contraction-lawfulness is N/A (no structural tiering) and deliberately NOT force-fit. **Structural, not
per-lane: ROB/RS/FU are POOLS** (a shared `alu-op` can't be attributed to one of two physical ALUs), so
issue width restructures the CADENCE (tables/map), not this diagram — ONE visibility axis of substance
(representation tier: values@detailed+), the one config gate the predictor's bet redirect (`rename→PC`,
absent when not betting); the ROB-based recovery redirect (`rob→PC`) is ungated. Channels reuse M7 step
7: **wire = region hue** (fetch/decode/execute/memory/broadcast + a redirect accent), **box = shared
pool (hue-neutral)**, **follow-ring = identity on the lit wires** (WireVM.followed; no NodeVM ring, boxes
are pools). **Browser-verified by reading the LIVE SVG, not just eyeballing** (flagship array-sum,
width 2, OoO, static-taken, cache large → 41 cyc): at cycle 16 EXACTLY 8 wires light with FOUR distinct
region hues (`pc-imem` blue → `imem-rename` green → `rs-alu`/`rs-lsu` amber, an R/I add AND a lw address
together → `alu-cdb`/`cdb-rs`/`cdb-rob`/`rob-regfile` purple), matching the dump cell-for-cell;
following ROB#5 rings its full path across FOUR datapath wires (`rs-alu`→`alu-cdb`→`cdb-rs`+`cdb-rob`)
AND lights its ROB table row — the click-only cross-surface follow composition; essentials tier drops
all value labels (0 vs 6 at detailed); `rob-pc` recovery redirect lights at cycle 5 (the dump's FLUSH);
the bet `rename-pc` wire is drawn under predict-taken, absent otherwise; OoO config controls present,
forwarding control absent (renaming makes it meaningless). Two real geometry bugs caught by the
litmuses while authoring: a duplicate `alu-cdb` endpoint and a `cdb-rob`/`rename-rs` collinear overlap.
Gotcha: the renderer's wire follow-ring class is `dp-follow` (single dash), the TABLES' is `dp--follow`
(double) — don't confuse them when reading the DOM. Full repo: **3228 tests** (+17), typecheck, lint,
build, format:check all green.
