/**
 * The CDC 6600-style scoreboard RV32I core (M15) — the seventh microarchitecture, and the only one
 * that completes out of program order **without** a reorder buffer: `IF ID RO EX/MEM WB`, where
 * `ID` is Issue and `WB` is Write-Result.
 *
 * The thesis is WHY REGISTER RENAMING EXISTS. M9 built Tomasulo with renaming already in it, so the
 * shipped family shows what renaming _does_ without ever showing the machine that lacks it. This is
 * that machine, and its subject is the pair of hazards renaming deletes:
 *
 * - **WAW** — two instructions write the same register and the older one is slow, so the younger
 *   must not land first. The scoreboard stalls it at **Issue**.
 * - **WAR** — a younger instruction wants to overwrite a register an older one has not yet read.
 *   The scoreboard stalls it at **Write-Result**, which is the only stall in the whole product that
 *   fires at the _end_ of an instruction's life rather than the beginning.
 *
 * Neither hazard exists anywhere in the shipped six models: every in-order machine reads its
 * operands in program order, and the out-of-order machine renames both away — so `stall.reason` has
 * never had to say `'waw'` or `'war'`. (It never says `'raw'` here either; that string is pinned
 * repo-wide to mean "forwarding is off", and this machine has no forwarding at all — results reach
 * consumers through the register file only.)
 *
 * Two pinned shapes make it a scoreboard rather than a relabelled pipeline. **Read Operands is
 * per-FU and non-blocking** — an instruction leaves Issue *into its functional unit* and waits
 * there — because a shared in-order `RO` would make WAR unreachable and delete half the subject.
 * And **functional-unit latencies are intrinsic to the model, not a config knob**, following
 * multi-cycle's precedent that its per-instruction cycle counts are this model's definition rather
 * than a setting: the shell's `slowOpLatency` has no UI control anywhere and is reset to 1 on every
 * free-play load, so a machine whose only latency source was that knob would never reorder until a
 * lesson milestone authored one.
 *
 * {@link ScoreboardProcessor} — the stage walk, the three classic status tables in `micro`, and the
 * stall vocabulary — is step 1. The timing matrix plus the two-part mutation check that prove the
 * machine is real (rather than a 5-stage wearing scoreboard labels) are step 3. Step 5 made it
 * drivable in the browser ({@link SCOREBOARD_MODEL_DESCRIPTION} and the picker row); the three
 * status tables as a view are step 7.
 */

/** Stable id of this model within the model family (handoff §2). */
export const SCOREBOARD_MODEL_ID = 'scoreboard';

/**
 * The picker's one-liner, exported from the ENGINE rather than typed into the web shell (the
 * superscalar / out-of-order / deep-pipeline precedent) — a description re-typed in the shell is a
 * second place for the same claim to go stale.
 *
 * **It names the model ABOVE it in the picker**, which decision 8 asks for: this row sits last, and
 * the reader arriving at it has already met Tomasulo. Saying "before register renaming" is what
 * makes the last row legible as a PREDECESSOR rather than as a seventh unrelated machine — the
 * milestone's whole thesis is that the shipped family showed what renaming does without ever
 * showing the machine that lacks it.
 *
 * ⚠ **Two things it deliberately does not say, and both would contradict the engine.**
 *
 * It does **not** say "out-of-order issue". Issue here is in order and BLOCKING — one instruction
 * per cycle, and it stops dead at an unresolved transfer because a machine with no reorder buffer
 * can undo nothing (step 1's `'control'` finding, forced by INV-8). Only COMPLETION reorders. The
 * out-of-order row directly above honors an `outOfOrderIssue` toggle, so the two rows would read as
 * the same claim if this one blurred that line.
 *
 * And it does not promise dramatic reordering. Step 3 measured the dominant term on this machine
 * and it is not a hazard: a unit is held from issue to write, so an integer unit turns around in 4
 * cycles and the memory unit in 7 — a hard 0.5-IPC ceiling on integer code with no hazard present.
 * Most corpus cycles are `structural-int`. The superscalar's "up to" hedge exists for exactly this
 * failure, and a picker that promised a reordering festival would be describing a different machine
 * than the one the reader is about to run.
 */
export const SCOREBOARD_MODEL_DESCRIPTION =
  'Scoreboard (CDC 6600) — the out-of-order machine before register renaming: issue is in order ' +
  'into three functional units, completion is not, and the WAW and WAR hazards renaming deletes ' +
  'stall it here.';

export {
  ScoreboardProcessor,
  SCOREBOARD_CAPABILITIES,
  FU_NAMES,
  INT_LATENCY,
  MEM_LATENCY,
  type Stage,
  type FuName,
  type ScoreboardStallReason,
  type InstructionStatusRow,
  type FuStatusRow,
  type ScoreboardMicro,
} from './processor';
