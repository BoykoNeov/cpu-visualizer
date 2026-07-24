# M9 + M10 code review — findings to fix

Source: `/code-review high` over the M9+M10 range (`b9dabf8..HEAD`, 71 files,
~11.8k insertions), run 2026-07-24. 8 finder angles ran concurrently, ~30 raw
candidates deduped to 12, adversarially verified: **9 CONFIRMED, 1 PLAUSIBLE**
survived. Findings are ranked most-severe first. None are fixed yet — this file
is the worklist for a follow-up session.

Line numbers are as of `b391dc1` (the reviewed HEAD) and may drift.

---

## 1. OoO memory disambiguation ignores sub-word address overlap

- **File:** `packages/engine/out-of-order/src/processor.ts:697`
- **Category:** correctness (INV-8 class) · **Verdict:** CONFIRMED — empirically reproduced

Memory disambiguation uses exact address equality only, so a younger sub-word
load overlapping (but not equal to) an older uncommitted store's address reads
stale memory — wrong architectural result.

**Failure scenario:** `outOfOrderIssue` on, park the ROB head (slow `sll` or a
cache miss), then `sw t1, 0(t0)` followed by `lb t2, 1(t0)`.
`disambiguationClear`'s gate is `if (s.aluOut >>> 0 === addr) return false;`
with no width/overlap handling, and OoO stores write memory only at commit, so
the `lb` is declared clear and reads memory before the `sw` lands: in-order
yields `t2=0x33`, out-of-order yields `t2=0x0`. Reachable from user-typed
sandbox assembly; the corpus and `disambiguation-mutation.test.ts` exercise
only exact-alias word/word, so no shipped test catches it.

**Fix direction:** overlap check on byte ranges (address + access width for
both store and load), not `===` on the base address. Add a regression program
/ mutation test with an overlapping sub-word pair, and consider a corpus
program so INV-8 covers it.

## 2. FU/LSU boxes dark while MicroTablePanel shows "executing"

- **File:** `packages/web/src/datapath-out-of-order.ts:305`
- **Category:** view coherence · **Verdict:** CONFIRMED

The occupancy fold never lights the FU/LSU boxes for entries in the M10-added
`executing` (or `awaitingMem`) state, so during a multi-cycle op the
MicroTablePanel says "executing" while the datapath's ALU box and wires are
dark — a cross-surface contradiction in the shipped
`reservation-station-holds` lesson.

**Failure scenario:** The fold's complete list is rob-nonempty → `'rob'` and
`state === 'waiting'` → `'rs'`; the ALU lights only via `alu-op` events, which
for a slow op fire only at FU completion (`stageFuAdvance`). With
`slowOpLatency: 8`, the `sll` spends ~7 cycles shown "executing" in the table
with nothing instruction-attributed lit in the diagram — the lesson invites
scrubbing to exactly those cycles. The datapath shipped in M9 (`d7f8ea2`) and
was never updated when M10 (`72c63f3`) added the state; the file's own
coherence doc ("an alu-op(id) this cycle is exactly the entry that reads
executing this cycle") is now false whenever `slowOpLatency >= 2`.

**Fix direction:** extend the occupancy fold to map `executing` →
FU pool box and `awaitingMem` → LSU box; update the coherence doc comment;
browser-verify at a scrubbed executing cycle of `reservation-station-holds`.

## 3. slowOpLatency leaks lesson-to-lesson through config-less lessons

- **File:** `packages/web/src/useSimulator.ts:470` (with `packages/web/src/session.ts:217`)
- **Category:** correctness · **Verdict:** CONFIRMED

A config-less lesson inherits the previous lesson's `slowOpLatency` via
`lessonOpening`'s `{...current}` spread and writes it back to the ref, so the
invisible latency knob leaks lesson-to-lesson with no control or indicator.

**Failure scenario:** Reachable today: open `reservation-station-holds`
(`slowOpLatency` 8), then any of the six config-less lessons (`first-program`,
`sum-loop-tour`, …) — `session.ts:217` returns `{...current}` and
`useSimulator.ts:470` writes `slowOpLatency` 8 back to `slowOpLatencyRef`. The
model picker stays live, so flipping to Out-of-order re-records at latency 8
with nothing on screen showing it; any program containing `sll` then reports
cycle counts disagreeing with every documented number. Only
`select`/`loadEdited` reset the ref to 1; the lesson→lesson path does not.

**Fix direction:** config-less lessons should reset the undeclared knobs to
defaults (or `lessonOpening` should return a fully-defaulted config rather
than spreading `current`). Pin with a session test: RS lesson → config-less
lesson → assert latency ref is 1.

## 4. Commit wire lights only the first of a double retire

- **File:** `packages/web/src/datapath-out-of-order.ts:353`
- **Category:** view coherence · **Verdict:** CONFIRMED

The commit wire uses `events.find(type === 'instr-retire')`, taking only the
first retire, but the model commits up to `issueWidth` (default 2) per cycle —
the second co-retiring instruction never lights or follow-rings the
rob→regfile wire on its own retire cycle.

**Failure scenario:** `stageCommit` calls `rob.commitReady(width)` and emits
one `instr-retire` per shifted head, so double retires are routine at width 2.
`activate()` attributes the single rob-regfile `WireActivation` to the older
sibling only: following the younger instruction rings its table row but not
the commit wire on the cycle it retires, and the wire's value label shows the
other instruction's reg-write — the diagram contradicts the table for the
followed instruction. The datapath test only checks a retire cycle lights the
wire with _some_ reg-write value, never a double-retire cycle.

**Fix direction:** attribute the commit wire to all retires that cycle (or to
the followed one when a follow is active). Pin with a double-retire cycle in
the datapath test.

## 5. numMshrs cannot be set anywhere in the web shell

- **File:** `packages/web/src/session.ts:240` (and `loadInto`)
- **Category:** config plumbing · **Verdict:** CONFIRMED (latent)

`ProcessorConfig` gained `numMshrs` but `LessonOpening`/`lessonOpening`/
`loadInto` never thread it, so a lesson declaring `"numMshrs"` typechecks and
silently records at the engine default of 2 — breaking the file's own
"declared config is honored WHOLE" contract.

**Failure scenario:** `lessonOpening`'s declared-config branch copies
knob-by-knob (forwarding/branchPrediction/cache/issueWidth/outOfOrderIssue/
robSize/slowOpLatency) and drops `numMshrs`; `loadInto` builds the engine
config from `defaultConfig()` plus seven refs, none of which is `numMshrs`. A
single-MSHR lesson variant of `racing-ahead-of-the-miss` (whose prose already
depends on `numMshrs=2` as an undeclarable experimental control) would load
with no error and record at 2, making its prose silently false. Latent — no
shipped lesson declares it yet — but there is no path in the web shell that
can set `numMshrs` at all.

**Fix direction:** thread `numMshrs` through `LessonOpening`, `lessonOpening`,
the ref set, and `loadInto`, same shape as `slowOpLatency`. Pin with the same
test style that pins the other knobs.

## 6. robSize/numMshrs of 0 livelock instead of failing fast

- **File:** `packages/engine/out-of-order/src/processor.ts:289`
- **Category:** validation · **Verdict:** CONFIRMED — empirically reproduced

`reset()` validates `issueWidth` (throws on `<1`) but not `robSize` or
`numMshrs` — `robSize: 0` or `numMshrs: 0` silently livelocks the machine
instead of failing fast.

**Failure scenario:** `robSize: 0` makes `Rob.hasRoom` permanently false so
dispatch never proceeds and the machine never halts; `numMshrs: 0` with a
cache makes the MSHR gate (`missInFlight.size >= numMshrs`) permanently true
so the first miss never completes. Both spin until the recorder's
1,000,000-cycle cap throws a misleading "non-terminating program?" error. The
`issueWidth` guard at lines 257–260 set the fail-fast precedent; these two
knobs — public API, bare optional numbers in the trace config — silently hang.

**Fix direction:** throw in `reset()` for `robSize < 1` and `numMshrs < 1`,
mirroring the `issueWidth` guard; pin both with tests.

## 7. eslint DAG deny lists omit engine-out-of-order in four lower layers

- **File:** `eslint.config.js:63` (isa ~55–66, trace ~72–85, assembler ~90–102, curriculum ~256–277)
- **Category:** DAG enforcement · **Verdict:** CONFIRMED

The isa, trace, assembler, and curriculum dependency-boundary deny lists
enumerate every engine model through `engine-superscalar` but omit the new
`engine-out-of-order`, weakening the mechanically-enforced DAG the root
CLAUDE.md promises.

**Failure scenario:** M9 added `engine-out-of-order` to all engine-family deny
lists but skipped the four lower-layer blocks. A future curriculum or trace
module importing `@cpu-viz/engine-out-of-order` lints clean — while the
identical import of `engine-superscalar` errors with the INV-3 message — and
vitest's global workspace aliases resolve it, so tests run green; the
trace-is-the-only-contract invariant breaks silently with only tsc project
references as a partial backstop.

**Fix direction:** add `engine-out-of-order` to the four missing deny lists.
Consider deriving the engine-package list once instead of enumerating it in
each block, so the next model can't repeat this.

## 8. configLabel omits robSize — conformance test-title collision

- **File:** `packages/engine/conformance/src/conformance.ts:241`
- **Category:** test coverage · **Verdict:** CONFIRMED

`configLabel` has no `robSize` clause, so the OoO differential's
`ROB_SIZE_PROBE` (`robSize: 1`) produces `it()` titles byte-identical to the
robSize-16 member of `CONFIGS` for all 12 corpus programs — the exact
"invisible collision" the function's own doc comment warns about.

**Failure scenario:** `ROB_SIZE_PROBE` {forwarding: true, 'none', CACHE_SMALL,
width 2, out-of-order, robSize: 1} matches a `CONFIGS` cross-product member on
every axis `configLabel` prints, differing only in `robSize`. A regression in
the small-ROB path the probe exists to reach (disambiguation with an
already-committed aliasing store) reports under a title indistinguishable from
the default-ROB run, and the pinned distinct-titles guard in
`conformance.test.ts` never varies robSize so it cannot catch the collision.

**Fix direction:** add a `robSize` clause to `configLabel` (print when
non-default), and extend the distinct-titles guard to include a
robSize-varying pair.

## 9. FU advances during the in-order cache-miss freeze

- **File:** `packages/engine/out-of-order/src/processor.ts:813`
- **Category:** correctness (timing-only) · **Verdict:** PLAUSIBLE

`stageFuAdvance` (and the in-order wake loop) run ungated by `ctx.memStall`,
so in the in-order branch (`outOfOrderIssue: false`) with a cache and
`slowOpLatency >= 2`, an in-flight FU op counts down, completes, and
broadcasts during a blocking cache-miss freeze — diverging from the M3
pipeline's "occupant holds in EX" stall semantics the branch claims to mirror.

**Failure scenario:** `step()` calls `stageFuAdvance` unconditionally after
`stageMemAccessInOrder` sets `ctx.memStall`; only `stageIssueExecute` is
gated. At `issueWidth >= 2` a younger `sll` issued the same cycle as a missing
load advances during the freeze, against the stage doc's own "freezing
everything younger". Unpinned combination — the parity net runs `cache: null`
and the cache matrix runs latency 1 — so the divergence is silent;
timing-only, public-API-reachable. Marked PLAUSIBLE because a
defensible-design reading exists for the width-1 older-op case.

**Fix direction:** decide the intended semantics first (does an in-flight FU
op freeze during a blocking miss in the in-order branch?), document it in the
stage doc, then either gate `stageFuAdvance` on `ctx.memStall` or amend the
doc — and pin the chosen behavior with a cache×slow-op parity test.

## 10. Load/store memory logic duplicated between the two mem paths

- **File:** `packages/engine/out-of-order/src/processor.ts:765` (and 729–753, 541–551)
- **Category:** duplication / drift risk · **Verdict:** CONFIRMED

`completeMemAccessOutOfOrder` duplicates `completeMemAccess`'s load
read/sign-extend block verbatim, and the sb/sh/sw mask+write idiom appears in
both `completeMemAccess` and `writeStoreToMemory` — two copies of
correctness-critical memory logic inside one model.

**Failure scenario:** The lb/lh sign-extend + readByte/readHalf/readWord block
exists at lines 729–739 and 776–785; the store masking +
writeByte/writeHalf/writeWord block at 744–753 and 541–551. A fix to a
sign-extension or masking bug in one branch leaves the other (exercised only
at the other `outOfOrderIssue` setting) silently divergent — the drift the
shared `walkIssuable` was built to prevent for issue. Flagged independently by
two review angles.

**Fix direction:** extract private `performLoad`/`performStore` helpers
(`writeStoreToMemory` could BE the shared store helper). Natural to do
alongside finding 1, which touches the same neighborhood.

---

## Below the cap (cleanup candidates, not verified)

Deduped candidates that fell below the 10-finding cap because correctness
outranks cleanup — worth a look while in the files above: dead `head()`,
unread `ctx.bet` payload, `missInFlight` set, `RobEntryView.seq`, unmemoized
`hasMicroTables`, test-helper triplication.

## Notably clean

Lesson anchors (INV-6), INV-8 wiring for both new corpus programs
(`slow-op-loop.s`, `strided-sum.s`), engine purity, the snapshot-aliasing fix,
and all sign-extension/bit-mask arithmetic in the new engine.
