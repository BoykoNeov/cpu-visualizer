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
 * This file is the package scaffold (`docs/plans/m15-tasks.md` step 0). `ScoreboardProcessor` — the
 * stage walk, the three classic status tables in `micro`, and the four stall reasons — lands in
 * step 1, and the timing matrix plus the two-part mutation check that prove the machine is real
 * (rather than a 5-stage wearing scoreboard labels) are step 3. Nothing here is wired into the
 * model picker until step 5.
 */

/** Stable id of this model within the model family (handoff §2). */
export const SCOREBOARD_MODEL_ID = 'scoreboard';
