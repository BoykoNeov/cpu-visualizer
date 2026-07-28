/**
 * The PAIRING READOUT and the IPC tile (M7 step 8) — the pure half, in the same two-halves shape as
 * `cache-grid.ts` and `pipeline-map.ts`: this module folds a trace into view-models with no React and
 * no color, and {@link PairingReadout}'s component owns the drawing.
 *
 * ## What this panel answers, and why it needs a source the other panels do not use
 *
 * The tier's whole question is "may these go together, and if not, why not?" — a verdict on the
 * GROUP sitting in ID, decided at ISSUE. Naming the group is easy: it is the `ID.<slot>` occupants
 * for every slot the machine has, straight off `instructions[].location` like every other view.
 * **Deciding whether they actually went is what is hard, and the obvious rule is a lie.**
 *
 * The word "group" rather than "pair" is M13 step 8's whole edit here, and it is not a preference:
 * the control offers widths 1–4 since step 6, so a sentence that says "the pair" or "both" is
 * simply false on screen at width 3 or 4. The MECHANISM keeps its historical name — the engine's
 * rules are the "pairing" rules and `intra-pair-raw` is a `stall.reason` three consumers read, so
 * renaming it would move trace bytes for a spelling (step 1's call, unchanged). What moved is every
 * sentence asserting a COUNT OF TWO.
 *
 * The obvious rule is "a `stall` event names the refused instruction, so no stall ⇒ they all went."
 * That was DUMPED AND DISPROVED before this file was written. On `array-sum.s` at width 2 with the
 * small cache, cycles 6–14 hold `ID.0=i5, ID.1=i6` frozen by a d-cache miss with **no `stall` event
 * on any of them** — a miss-freeze emits none (the M6 finding, still true here). A readout keyed on
 * the absence of an event would have announced "issuing together" for eleven consecutive cycles
 * while nothing moved at all. That is not a corner case; it is the flagship cache program.
 *
 * The deeper problem is that the obvious rule requires ENUMERATING every way an issue can be
 * blocked — pairing refusal, ordinary hazard, flush, miss-freeze — and being complete. The freeze
 * hole is exactly a missing enumeration case, and there is no way to know the list is finished.
 *
 * **So this reads the RESULT instead of the reasons: `micro.idEx`, the ID/EX latch after the cycle,
 * which is precisely who issued.** Blocked-ness then falls out for free and cannot be under-counted,
 * because the panel never has to know WHY to avoid claiming they went. The reason is looked up
 * separately, and is allowed to come back `null` — an honest "held up" beats an invented cause.
 *
 * **This is not the datapath's one-cycle-ahead `micro` trap.** That trap is reading `micro` for
 * CURRENT occupancy, which is why `datapath-superscalar.ts` sources occupancy from `location` and
 * never from `micro`. Here being a cycle ahead is the entire point: `micro.idEx` after cycle N is
 * the RESULT of cycle N's issue decision. The identity that licenses it —
 * **`micro.idEx@N` === the `EX.<slot>` occupants at N+1** — was verified by exhaustive dump, not
 * reasoned: 3 hand-written refusal programs (one per verdict) plus the whole corpus at
 * 2 widths × cache on/off = 28 configs, ~1600 cycles, zero mismatches, including the freeze and
 * flush cycles where the two disagree with every simpler rule. `cache-grid.ts` reads `micro` for the
 * same post-cycle-state reason and is the precedent.
 *
 * **M13 step 8 widened that guard to every width the control offers, and that was the step's most
 * load-bearing test change rather than a formality.** The identity is this module's entire licence
 * for reading `micro` at all, and until step 8 it had never run above width 2 — so the design's one
 * unfalsifiable-if-wrong assumption was verified only on the machine that no longer ships alone.
 * See `pairing-readout.test.ts`.
 *
 * ## The `issue` trace event: DECLINED, with proof
 *
 * `superscalar-visuals.md` proposed a new `{type:'issue', slot, instr}` event plus a
 * pairing-refused event, and the M7 decisions table left it open, naming this step "the last chance
 * to prove an `issue` event is genuinely undrawable without." It is drawable. Every element the
 * readout names comes from what already exists: the PAIR from `location`, the REFUSAL REASON from
 * the existing `stall` event, WHO ISSUED from `micro.idEx`, and the FREEZE from the same
 * `missCyclesRemaining` the cache grid already reads. Zero trace-schema change (INV-3 satisfied by
 * extension being unnecessary, not by a back door). House record holds: M4 accepted 1 field of 5,
 * M6 added zero, M7 adds zero.
 */

import type { CycleTrace, InstructionInstance } from '@cpu-viz/trace';
import type { SuperscalarMicro } from '@cpu-viz/engine-superscalar';
import { formatInstruction } from './format';
import { PAIRING_REASONS } from './datapath-superscalar';

/**
 * The verdict on the group forming in ID this cycle. Five values, and the split that matters is
 * `refused` vs `blocked`: `refused` is a PAIRING failure — some older prefix of the group went, at
 * least one younger member did not, and the machine still made progress — while `blocked` is nobody
 * moving at all. Conflating them would make the tier's own lesson ("pairing failed, but we did not
 * stop") unreadable.
 *
 * The `'paired'` IDENTIFIER is deliberately not renamed at M13 step 8, though its user-facing label
 * is. It is asserted by name across two test files and means "the whole group went" at every width;
 * moving it would be step 1's `intra-pair-raw` mistake in the view layer — churn for a spelling.
 * The BADGE the reader sees is `CO-ISSUED`, which is true of three and of four.
 */
export type IssueVerdict =
  /** ID is empty — nothing is up for issue (start of run, or behind a flush). */
  | 'idle'
  /** Every ID occupant issued, and there was more than one: the money shot. Two of them at width 2,
   *  and — measured on the corpus at M13 step 8 — three or four at width 4, never two. */
  | 'paired'
  /** Exactly one instruction was up and it issued. At width 1 this is every productive cycle. */
  | 'solo'
  /** An older prefix issued, at least one younger member did not — a pairing refusal. `reason` names
   *  which rule. At width 4 the corpus holds THREE back more often than one (51 cycles vs 41), which
   *  is why nothing here or in the view may say "the younger". */
  | 'refused'
  /** Nobody issued. An ordinary hazard, a flush, or a miss-freeze. */
  | 'blocked';

/** One instruction up for issue this cycle — an ID-slot occupant. */
export interface IssueCandidate {
  /** The ID slot it sits in. NOT a stable lane: a refused instruction leads the next group from slot
   *  0 whatever slot it was refused in (the sliding-issue decision), which is why identity rides
   *  `id`, not slot. At width ≥ 3 a slot can move by more than one in a cycle (M13 step 5). */
  readonly slot: number;
  /** The stable id (INV-4) — what the follow-ring, the map row and the datapath all key on. */
  readonly id: string;
  readonly pc: number;
  readonly text: string;
  readonly sourceLine: number | null;
  /** Did it actually issue this cycle? Read from `micro.idEx`, never inferred from event absence. */
  readonly issued: boolean;
}

export interface PairingReadoutView {
  /** Issue width in force for this recording — `1 … MAX_ISSUE_WIDTH`. Straight from the engine's own
   *  micro, never a default: a hardcoded number here mislabels every recording made at another
   *  width, and the caption and the IPC tile's ceiling are both derived from it. */
  readonly width: number;
  /** The ID occupants, oldest first. Length 0 (idle), 1, or `width`. */
  readonly candidates: readonly IssueCandidate[];
  readonly verdict: IssueVerdict;
  /** The machine-readable cause when one is known, else `null`. `null` is a legitimate answer and
   *  is rendered as such — never back-filled with a guess. */
  readonly reason: IssueReason | null;
}

/**
 * The causes this panel can name. The first five are `stall.reason` values straight from the engine;
 * `flush` and `memory-stall` are derived, because neither emits a `stall` event.
 */
export type IssueReason =
  | 'mem-port'
  | 'branch-slot'
  | 'intra-pair-raw'
  | 'load-use'
  | 'raw'
  | 'flush'
  | 'memory-stall';

/**
 * The plain-English gloss. Each says WHAT RULE fired, in the vocabulary the pairing decisions were
 * pinned in — the readout has to agree with the pipeline map's shape, and it can only do that if it
 * names the same rule the engine applied.
 *
 * **Every gloss describes the HELD instruction's relation to an OLDER GROUP-MATE, which is what
 * makes it true at all four widths** (M13 step 8). The three pairing glosses used to say "both"
 * and "the younger" — a two-instruction relation, and false on screen from the moment step 6
 * offered width 3: a `mem-port` refusal in a group of four is one instruction refused because ONE
 * of up to three elders holds the port, not "both". The per-instruction framing is also the
 * lawful-simplification shape (INV-5): it is exactly as true at width 2, so the narrow machine's
 * reading is not contradicted by the wide one's.
 */
export const REASON_TEXT: Readonly<Record<IssueReason, string>> = {
  'mem-port': 'an older instruction in its group already has the one data-memory port',
  'branch-slot': 'an older instruction in its group already has the one branch unit',
  'intra-pair-raw':
    'it reads a register an older instruction in the same group writes — no forwarding can fix this',
  'load-use': 'waiting for a load already in flight',
  raw: 'waiting for a register write (forwarding is off)',
  flush: 'squashed — a taken branch redirected the front end',
  'memory-stall': 'the whole pipe is frozen serving a cache miss',
};

/** The IPC tile — a whole-recording figure, deliberately NOT a running-to-cursor one. */
export interface IpcView {
  readonly retired: number;
  readonly cycles: number;
  readonly ipc: number;
}

/**
 * Instructions per cycle, **derived by the view** from retire events (INV-2 — the engine has no such
 * counter and must not grow one).
 *
 * Whole-recording, not running-to-cursor, and that is a pedagogical choice rather than a convenience:
 * the tile exists so a reader can flip the width toggle and watch one number move, and a figure that
 * also changes on every step-button press teaches nothing about width. It is hand-checkable for the
 * same reason — `sum-loop.s` at forwarding ON is 34 retires over 56 cycles at width 1 and 34 over 44
 * at width 2 (0.607 → 0.773), both counted off a dumped trace.
 *
 * **At four positions the tile teaches something it could not teach at two, and it is the milestone's
 * own headline: the number STOPS MOVING.** `sum-loop` runs 0.607 → 0.773 → 0.791 → 0.791; `array-sum`
 * 0.667 → 0.810 → 0.944 → 0.944. Nine of the eleven corpus programs are IPC-identical at widths 3 and
 * 4 (measured, M13 step 8), so a reader who flips ISSUE from 3 to 4 and watches this figure sit still
 * is reading the diminishing return directly. That is why the width axis stops at 4, and it is the one
 * thing in the app that says so with a number rather than with prose.
 *
 * The denominator is the recording's LENGTH, not the last cycle's number: the transport is 0-indexed,
 * so a 56-cycle run's final cursor reads `55`. Dividing by the displayed number is an off-by-one that
 * makes the honest figure look wrong.
 */
export function readIpc(recording: readonly CycleTrace[]): IpcView {
  let retired = 0;
  for (const t of recording) {
    for (const e of t.events) if (e.type === 'instr-retire') retired++;
  }
  const cycles = recording.length;
  return { retired, cycles, ipc: cycles === 0 ? 0 : retired / cycles };
}

/** The superscalar micro, or `null` when this recording is from another model. The panel is gated on
 *  a TRACE fact (does this recording have slotted latches?), never on the shell's model id. */
function superscalarMicro(trace: CycleTrace): SuperscalarMicro | null {
  const m = trace.state.micro as Partial<SuperscalarMicro> | undefined;
  if (m === undefined || typeof m.width !== 'number' || !Array.isArray(m.idEx)) return null;
  return m as SuperscalarMicro;
}

/** The ID-slot occupants this cycle, oldest first. `location` is `"ID.<slot>"` at EVERY width — the
 *  encoding is uniform 0…width-1, which M13 step 5 proved by sweeping the location set rather than
 *  by reading the recorder. */
function idOccupants(trace: CycleTrace, width: number): (InstructionInstance | undefined)[] {
  const out: (InstructionInstance | undefined)[] = [];
  for (let s = 0; s < width; s++) {
    out.push(trace.instructions.find((i) => i.location === `ID.${s}`));
  }
  return out;
}

/**
 * Fold one cycle into the readout, or `null` if this is not a superscalar recording.
 *
 * Reason precedence, in the order a reader would ask: a `stall` event naming one of THESE
 * instructions is the engine's own verdict and always wins; then a flush, which kills without
 * stalling; then a miss-freeze, which does neither and is the case that disproved the naive rule.
 * If none of the three applies, the reason stays `null` rather than being guessed.
 */
/**
 * The PRE-RUN readout: an idle verdict carrying the recording's width, or `null` if this recording
 * is not superscalar.
 *
 * This exists because of a defect the browser caught and no headless test could: at the pre-run
 * cursor `trace` is `null`, so keying the whole panel on the cursor's trace made it VANISH at
 * cycle -1 — and with it the IPC tile, which is a whole-recording figure that is perfectly
 * meaningful before the first step and is the one number the width A/B is read from. The panel
 * popping in and out as you scrub to the start is the visible half of the bug; the invisible half is
 * that a reader who loads a program, flips the width toggle and never presses step sees nothing at
 * all. The cache grid solved the same problem by drawing a cold cache at `trace === null`; this is
 * that idea in this panel's vocabulary.
 */
export function readPairingPreRun(recording: readonly CycleTrace[]): PairingReadoutView | null {
  for (const t of recording) {
    const micro = superscalarMicro(t);
    if (micro !== null)
      return { width: micro.width, candidates: [], verdict: 'idle', reason: null };
  }
  return null;
}

export function readPairing(trace: CycleTrace): PairingReadoutView | null {
  const micro = superscalarMicro(trace);
  if (micro === null) return null;

  const width = micro.width;
  const issuedIds = new Set(micro.idEx.filter((l) => l !== null).map((l) => l.instr));

  const candidates: IssueCandidate[] = [];
  for (const [slot, inst] of idOccupants(trace, width).entries()) {
    if (inst === undefined) continue;
    candidates.push({
      slot,
      id: inst.id,
      pc: inst.pc,
      text: formatInstruction(inst.decoded),
      sourceLine: inst.sourceLine,
      issued: issuedIds.has(inst.id),
    });
  }

  const wentCount = candidates.filter((c) => c.issued).length;
  const verdict: IssueVerdict =
    candidates.length === 0
      ? 'idle'
      : wentCount === 0
        ? 'blocked'
        : wentCount === candidates.length
          ? candidates.length > 1
            ? 'paired'
            : 'solo'
          : 'refused';

  return { width, candidates, verdict, reason: reasonFor(trace, micro, candidates, verdict) };
}

/**
 * Every `stall.reason` this readout can attribute to the group in ID: the three PAIRING refusals —
 * imported, not re-listed, so `datapath-superscalar.ts` stays the single place that says which
 * reasons belong to the issue unit — plus the two ordinary older-stage hazards. A reason outside
 * this set is deliberately reported as `null` rather than echoed: the panel names rules it can
 * gloss, and an unglossed engine string on screen would be noise.
 */
const STALL_REASONS: ReadonlySet<string> = new Set<string>([...PAIRING_REASONS, 'load-use', 'raw']);

function reasonFor(
  trace: CycleTrace,
  micro: SuperscalarMicro,
  candidates: readonly IssueCandidate[],
  verdict: IssueVerdict,
): IssueReason | null {
  if (verdict === 'idle' || verdict === 'paired' || verdict === 'solo') return null;

  // 1. The engine's own verdict, if it named one of the instructions standing here. Matching on id
  //    rather than just taking the cycle's first stall matters: a stall can name an instruction in
  //    a different stage, and attributing it here would misreport the cause.
  //
  //    **Taking the FIRST match is total, not arbitrary, and at width ≥ 3 that stopped being
  //    structural.** At width 2 a group has one possible refusee, so "the reason" cannot be
  //    ambiguous; from width 3 the group has several younger members and one might imagine two
  //    rules firing at once, with this loop silently picking one. It cannot happen, because the
  //    engine emits AT MOST ONE stall per cycle — `stageId` breaks out of the group on a refusal —
  //    and that is pinned in `datapath-superscalar.test.ts` across every provoker and width, not
  //    assumed here. M13 step 8 measured the readout's own version of it too: over the corpus plus
  //    the three refusal fixtures × 4 widths × forwarding × cache, **zero cycles carry two distinct
  //    stall reasons naming one ID group**, and `pairing-readout.test.ts` holds that as a standing
  //    net. So the panel names one rule because there is only ever one to name.
  const here = new Set(candidates.map((c) => c.id));
  for (const e of trace.events) {
    if (e.type === 'stall' && here.has(e.instr) && STALL_REASONS.has(e.reason)) {
      return e.reason as IssueReason;
    }
  }

  // 2. A flush kills without stalling — no `stall` event is emitted for a squashed instruction.
  if (trace.events.some((e) => e.type === 'flush')) return 'flush';

  // 3. The miss-freeze: no stall event, no flush, nothing moved. This is the case that disproved
  //    "no stall ⇒ they paired", and it is read from the same signal the cache grid uses.
  if (micro.exMem.some((l) => l !== null && l.missCyclesRemaining > 0)) return 'memory-stall';

  return null;
}
