# M9 Step 1a — `engine/out-of-order` at in-order issue (the faithful base)

## Context

M9 (`docs/plans/m9-tasks.md`) builds the out-of-order tier: Tomasulo-style renaming, the ROB,
reservation stations, and a non-blocking LSU. Step 0 landed 2026-07-21 as config-only (zero trace
events, zero schema changes) — `ProcessorConfig` gained `outOfOrderIssue?`/`robSize?`/
`slowOpLatency?`, `ProcessorCapabilities` gained required `configurableOutOfOrder`, and the eslint
deny lists were seeded with `engine-out-of-order`. Nothing built yet.

Step 1a is the "faithful base": the real front-end, register renaming, the ROB, and in-order
commit — but issue stays in program order (no wakeup/select, no reordering). Its job is to prove
the new ROB/RS/rename machinery is correct and TIMING-NEUTRAL before step 1b adds real
out-of-order scheduling on top: a machine this constrained must be cycle-for-cycle identical to
M7's superscalar at `issueWidth: 2` and M3's pipeline at `issueWidth: 1`, exactly as M7 step 2a
proved its width-1 position was M3's closed form before pairing landed. If 1a's timing doesn't
match, either the port has a bug, or 1b's later "OoO wins by N cycles" claim is unverifiable
against a broken baseline.

**Two scope calls, already made with the user (2026-07-22), not to be revisited without cause:**

1. **`configurableOutOfOrder`'s forwarding stance:** the CDB broadcasts a result the instant it's
   computed — that IS the forwarding path. There is no principled "forwarding off" position for a
   Tomasulo machine (unlike the latch-based models, which can genuinely interlock instead of
   forwarding). So `configurableForwarding: false` — the flag is honored as INERT (byte-identical
   trace regardless of `ProcessorConfig.forwarding`'s value, proven the same way as step 0's
   whole-trace inertness checks) — and the 1a timing baseline is matched against M3/M7's
   `forwarding: true` position only.
2. **1a's timing-suite scope:** cycle-COUNTS only, not an event-for-event port. Assert total
   cycles and the closed form's terms (N/S/P/M) separately per corpus program × config, exactly
   as M3/M7 already do — but do NOT force the OoO model to emit `stall`/`forward` events shaped
   like the latch models'. A CDB broadcast is one-to-many (wakes every waiter on a tag), not the
   one-`from`/one-`to` shape `forward` has, and a Tomasulo instruction waiting on a tag isn't a
   latch-shaped `stall.stage`. Retrofitting those fields would be a fiction, and the project's own
   step-0 log already deferred exactly this call ("force an event only if a view cannot be drawn
   without it" — there is no view yet). 1a's event set is a SUBSET of the existing vocabulary
   (`instr-fetch`, `alu-op`, `mem-read`/`mem-write`, `reg-write`, `cache-access`,
   `branch-predicted`/`branch-resolved`, `instr-retire` reused as commit) — no new event types.

## Architecture

### The key structural correction (from advisor review) — where do M7's pairing rules live?

M7's three group-formation rules (no two memory ops pair, no two branches pair, no intra-pair RAW)
are NOT dispatch-time rules in a Tomasulo machine — putting them there would force removing them
again at step 1b (1b is scoped to change ONLY the issue/select policy, per the plan's own
bisection). Instead:

- **Dispatch is bounded only by ROB/RS capacity and `width`** — no instruction-mix restriction.
  Every cycle, up to `width` fetched instructions enter dispatch, get a rename-map update (their
  destination register now maps to a fresh tag) and a ROB entry, in program order, unconditionally
  (capacity permitting).
- **Resource limits live at ISSUE**: `width` general (ALU-capable) issue slots, but at most ONE of
  them may be a memory op this cycle (the single-ported D-cache) and at most ONE may be a branch
  op this cycle (the single branch/control unit) — regardless of width. An instruction that is
  ready but loses the resource contest (or whose OLDER neighbor in program order isn't ready yet —
  1a's whole constraint) simply waits and retries next cycle.
- **Intra-pair RAW needs no rule at all**: the dependent instruction gets a tag for its source (not
  a stale value), and — because 1a issues strictly oldest-first with no reordering — it can't
  advance ahead of its own unresolved dependency anyway. The serialization that RAW needs falls out
  of the in-order-issue constraint for free.

Hand-traced through several representative sequences (independent ALU pair, dependent ALU pair,
two adjacent branches — `paired-branches.s` is the corpus's existing witness for exactly this,
load-use, and a 3-instruction chain mixing a stall with a trailing independent op) this reproduces
M3/M7's per-instruction EX-arrival cycles exactly, because the RESOURCE-CONTEST accounting (oldest
contender wins a shared unit, the loser retries exactly one cycle later) is the same policy either
way — only WHICH cycle an instruction physically occupies a bookkeeping slot differs, and that
never leaks into the closed form (which is defined purely on EX/retire cycles, not on intermediate
occupancy). **This must still be verified empirically against the corpus before any processor code
is written** — see Step 1a.0 below. A genuine divergence, if the derivation finds one, is a fork to
bring back to the user (via `AskUserQuestion`), not to quietly paper over.

This generalizes for free to arbitrary `width` (not just 1/2, unlike the superscalar's hardcoded
check) — a bonus of the redesign, not a requirement; only widths 1 and 2 are validated against
M3/M7.

### The three PRF-forward-compatible seams (pinned in `m9-tasks.md`, built now)

1. **`Tag` is an opaque type** (`type Tag = number & { readonly __tag: unique symbol }` or similar)
   — never assume `tag === ROB index` outside the one place that allocates them, even though at 1a
   it happens to be true. Comparisons/lookups go through named helpers.
2. **The ROB splits ordering from payload.** An `Rob` class owns only the in-order queue mechanics
   (head/tail/count, `allocate()`, `commitReady()`, iteration oldest-to-youngest) and knows nothing
   about values. A separate payload store (keyed by the same tag/index) holds what classic Tomasulo
   actually needs: destination register, the captured value once known, `nextPc`/`halt` bookkeeping.
   Swapping to a PRF backend later touches only the payload store.
3. **One operand-read choke point, one commit choke point.** `resolveOperand(reg)` is the ONLY
   function that consults the rename map — returns `{ ready: true, value }` (committed, or the tag
   already broadcast) or `{ ready: false, tag }`. `commitEntry(tag)` is the ONLY function that
   writes the ARF and clears the rename map (only if the map still points at this exact tag — an
   intervening WAW may have already remapped the register to a younger tag).

### Stage shape — mirrors the superscalar's proven skeleton, reinterpreted

Same double-buffered, reverse-walked, width-slotted structure as `SuperscalarProcessor` (reuse
that file's shape almost verbatim), with these substitutions:

- **IF** — unchanged (fetch, `fetchPc`, `haltFetch`), reused conceptually from `engine-common`'s
  patterns.
- **ID → "Dispatch+Issue"** (one combined stage, exactly where ID sits today). On an instruction's
  FIRST cycle in this stage: allocate its ROB entry and RS-equivalent bookkeeping, update the
  rename map for its destination register. EVERY cycle it sits here (including that first one): a
  slot advances to EX only if (a) its operands are ready per `resolveOperand`, oldest-first with
  strict no-reordering, and (b) the FU-type resource check passes (width-capped ALU slots, 1 mem,
  1 branch). This unifies "reservation station" and "stalled-in-ID" into the same slot array —
  there is no separately-sized RS pool at 1a (no config field for one was added at step 0; adding
  one now would be an un-pinned new knob). A slot that can't advance holds, and — per strict
  in-order issue — nothing younger may advance past it either.
- **EX** — unchanged shape: compute the ALU result / effective address. Loads/stores carry to MEM
  exactly as today (2-cycle memory latency, matching the load-use bubble).
- **MEM → "Mem access + CDB broadcast"** — the actual memory access (reusing `engine-common`'s
  `access`/cache exactly like the superscalar: BLOCKING on a miss, freezing the front end. Non-
  blocking is explicitly 1b's problem, not 1a's). The moment a result is known (ALU result at EX,
  load datum at MEM), it is written into the ROB payload for that tag — this IS the CDB broadcast;
  no dedicated event fires for it (per the scope call above).
- **WB → "Commit"** — walks the ROB from the head, committing (writing the ARF via the one commit
  choke point, retiring) up to `width` READY (already-completed) entries per cycle, stopping at
  the first not-yet-completed entry. At 1a this rarely has interesting cases (completion is already
  in-order), but the loop must be genuinely width-wide and genuinely "stop at first incomplete" —
  1b's harder queued-up-behind-a-blocker case reuses this same loop unchanged.

### Config / capabilities

- `issueWidth` defaults to **2** when absent for this model specifically (not 1, unlike the
  superscalar's own default) — per the pinned "superscalar OoO, default 2" decision. Update
  `ProcessorConfig.issueWidth`'s doc comment (currently "Only the superscalar model honors it") to
  name the OoO model too.
- `robSize` defaults to a value comfortably larger than any single-iteration window in the shipped
  corpus (e.g. 16) SPECIFICALLY so the 1a timing-baseline tests never hit a capacity stall — a
  small ROB visibly stalling dispatch is real but is the step-1b/step-3 "secondary lever" story,
  deliberately not part of the M3/M7-equivalence claim.
- `outOfOrderIssue` is read but, at 1a, issue is unconditionally in-order regardless of its value —
  the flag's real effect (enabling wakeup/select) is 1b's. State this plainly rather than silently
  ignoring the field.
- `slowOpLatency` is not consumed yet (1b's knob) — reading it now would be dead code.
- `ProcessorCapabilities`: `pipelined: true`, `hasHazards: true` (issue-time stalls + blocking cache
  miss still occur), `configurableForwarding: false`, `configurableBranchPrediction: true`,
  `configurableCache: true`, `configurableIssueWidth: true`, `configurableOutOfOrder: true`.
- `location` stays `"ROB#<index>"` for an instruction's whole post-dispatch lifetime (the spec's
  own §5 example — no schema change). **`MachineState.micro` stays unset at 1a** — the ROB/RS/
  rename map are real private engine state, structurally ready for 1b and eventually the step-6
  view, but exposing them through the trace now would be surfacing state no view consumes yet
  (an explicit YAGNI call, not an oversight).

## Build order

1. **1a.0 — Hand-derivation worksheet BEFORE any processor code**
   (`M:\claud_projects\temp\m9\step1a-timing-derivation.md`, mirroring the project's own
   "worksheet before test file" discipline). Derive, cycle by cycle, against the pinned
   `cycles = N + 4 + S + P + M` closed form: an independent ALU pair, a dependent ALU pair, two
   adjacent branches (`paired-branches.s`), a load-use pair, and a 3-instruction chain combining a
   stall with a trailing independent instruction, at width 2. If every derivation matches M3/M7's
   numbers, proceed. **If a genuine divergence surfaces, stop and bring it back via
   `AskUserQuestion`** — do not silently adjust the architecture to paper over it.
2. **Scaffold the package** — `packages/engine/out-of-order/{package.json,tsconfig.json}` mirroring
   `packages/engine/superscalar/`'s shape exactly (deps: `isa`, `trace`, `engine-common`; test-only
   refs: `assembler`, `conformance`). Wire into `tsconfig.json` (root references), `vitest.config.*`
   (alias), and `eslint.config.js`: add a new deny block for `packages/engine/out-of-order/**/*.ts`
   mirroring the superscalar's own block (deny `curriculum`, `web`, `engine-single-cycle`,
   `engine-multi-cycle`, `engine-pipeline`, `engine-superscalar` — NOT `engine-reference`, same
   reasoning as every existing model), AND add `'engine-out-of-order'` to the four existing
   per-model deny lists (`single-cycle`, `multi-cycle`, `pipeline`, `superscalar`) for reciprocal
   cross-model isolation.
3. **`types.ts` / `rob.ts` / `rename.ts`** — the opaque `Tag`, the ordering/payload-split ROB, the
   rename map with its single `resolveOperand` choke point, per the seams above.
4. **`processor.ts`** — `OutOfOrderProcessor implements Processor`, built from the superscalar's
   skeleton per the stage-shape section above. ISA semantics (the switch over mnemonics, the `s()`/
   `u()` views, `imm & 0x1f`) are mirrored verbatim from the golden reference, exactly as every
   other model does — copy the superscalar's `executeSlot`-equivalent logic rather than
   re-deriving it.
5. **`processor.test.ts`** — unit pins: rename-map update on dispatch, ROB allocate/commit, operand
   capture via tag/broadcast (both same-cycle-forward-equivalent and load-use-bubble-equivalent
   timing), in-order issue serialization (oldest blocks youngest), the mem-port/branch-unit
   resource contests (mirrors `paired-branches.s`), halt-with-drain, and the forwarding-inertness
   check (byte-identical `CycleTrace[]` under `forwarding: true` vs `false`, mirroring step 0's
   whole-trace inertness pattern for the other config fields).
6. **`timing.test.ts`** — per the pinned scope call: assert total cycles AND the N/S/P/M terms
   separately, per corpus program × branch-prediction × cache config, at `issueWidth` 1 and 2,
   against M3's and M7's own pinned numbers (read them from those packages' `timing.test.ts`
   files — do not re-derive from scratch when a number is already pinned there).
7. **`differential.test.ts`** — `runConformance(() => new OutOfOrderProcessor())` across the corpus
   (the INV-8 floor the plan calls "weak, but a floor" at 1a — full teeth arrive at step 2 once the
   LSU exists to disambiguate).
8. **`recorder.test.ts`** — mirror the existing per-model recorder suite (time-travel snapshot
   independence: registers/memory/ROB-payload snapshots must not alias across cycles).

## Verification

- `npm test` — new suite green, no regressions elsewhere.
- `npm run typecheck` — `tsc -b` picks up the new project reference.
- `npm run lint` — the new deny block fires if provoked (spot-check one violation, then revert, as
  step 0 did for the three superset lists).
- `npm run build` — library build succeeds.
- Read `docs/plans/m9-tasks.md` step 1a's checkbox and acceptance line once green, and update the
  plan doc + `MEMORY.md`/project-overview memory the same way step 0's landing was logged.
