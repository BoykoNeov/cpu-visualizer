/**
 * The branch-predictor table (dynamic-branch-prediction step 6) — the pure half of the predictor
 * view, in the same two-halves shape as the cache grid and the pipeline map: this module folds
 * `(trace-at-cursor, recording, scheme)` into a per-entry view-model with no React and no color, and
 * {@link PredictorTable} owns the drawing. Being pure is what makes the acceptance — "the fold is
 * derived purely from the trace (INV-3)" — checkable headlessly, on all four models rather than one.
 *
 * **This is a STATE view, exactly like the cache grid**, and it reads `micro.predictor` for the same
 * reason that one reads `micro.cache`: the counters ARE the state, and `micro` at cycle `i` is the
 * post-cycle picture, which is what a state panel shows. It is not the datapath's one-cycle-ahead
 * `micro` trap (the datapath draws transient dataflow and sources occupancy from
 * `instructions[].location` instead).
 *
 * ## The four decisions in here, each of which was measured rather than assumed
 *
 * **1. The highlight comes from the `branch-resolved` EVENT, never from a counter diff.** The
 * tempting derivation — "the row whose counter changed is the row that trained" — is wrong, and not
 * rarely: a saturating counter trained in the direction it is already parked at does not move.
 * Measured over 12 programs × 4 models × both schemes, **464 trains leave the counter unmoved**
 * (e.g. `array-sum-twice.s` row 9 trained `taken` at a 1-bit counter already holding 1, on ten
 * separate cycles). A diff-keyed panel would go dark for exactly the branches that have been learnt
 * — the ones the lesson is about — while looking perfectly alive on the cold ones.
 *
 * **2. The CONSULT is deliberately not drawn, and this is the sharpest call in the file.** A row is
 * read at the bet and written at the resolve, and only the write is drawable. `branch-predicted`
 * fires ONLY when the bet is taken — the schema says so explicitly, because a not-taken bet performs
 * no action and `{ taken: false }` would assert something the machine did not do. So a panel that
 * lit "consulted" rows would light roughly half of them and silently teach that the predictor is
 * consulted only when it says taken: a lower-fidelity surface CONTRADICTING a higher one, which is
 * the INV-5 failure, not a lawful simplification of it. One honest state (`trained`) beats two where
 * one is a half-truth. What the reader loses is recoverable from the same event a cycle later —
 * `branch-resolved.predicted` reports the bet in both directions, and this fold carries it.
 *
 * **3. `trains` is a LIST although the corpus never produces two.** Measured over 672 runs and
 * 31,140 cycles (every model × width × issue mode × forwarding × dynamic scheme × program): the
 * maximum number of `branch-resolved` events in one cycle is **1**, and on the superscalar that is
 * structural — `issueVerdict`'s `branch-slot` rule is one branch unit, so two transfers never issue
 * together. It is NOT structural on the out-of-order core in the same way; there it follows from the
 * dispatch freeze (`stageDispatch` refuses to advance past an un-bet transfer), which is a
 * correctness mechanism that a future model or knob could satisfy differently. A `train | null`
 * shaped like the cache grid's `CacheAccessView` would then silently DROP the second train — the same
 * shape as the `memOccupant` defect that left the cache grid idle on a shipped config for a
 * milestone. A list costs one word and removes the assumption instead of documenting it.
 *
 * **4. A row's before/after is read from the PREVIOUS recorded cycle, never by inverting the
 * update.** `micro` is post-cycle, so cycle `i`'s counters are already trained; the honest "from" is
 * cycle `i-1`'s snapshot (and the COLD table at cycle 0, which is why the seed is shared rather than
 * re-spelled here). Inverting — "it went up, so it was `to - 1`" — re-implements saturation in the
 * view and is simply wrong at the ceiling, which is the 464-cycle case above. It is also why the
 * before/after lives on the ENTRY rather than on the train: with two trains on one row (see 3) no
 * per-train intermediate value exists in the trace at all, but the row's own start and end always do.
 *
 * ## Why the ROWS need no height reserve — and ⚠ why that sentence was not the whole panel
 *
 * Every other tabular panel in this shell reserves a height because its row count moves with the
 * cursor (`MicroTablePanel`'s three tables, the map's follow readout). **This one draws all
 * {@link PREDICTOR_ENTRIES} rows on every cycle, so the ROWS' height is constant by construction** —
 * the table is a fixed piece of hardware and drawing only the occupied rows would be a picture of
 * the program rather than of the machine. Stated here so the next author does not add a reserve for
 * a jitter the rows cannot have. (The row CONTENTS still change width — see the view's chip
 * reserve, which is the horizontal half of the same discipline.)
 *
 * ⚠ **This paragraph shipped as "its height is constant by construction", and step 7's browser pass
 * measured that as false OF THE PANEL.** The rows were never the risk; the HEADER was, because it
 * held the one cursor-dependent string in the surface and wrapped on resolve cycles only — 33px,
 * between 900px and 1180px. The transferable half: **a "by construction" height claim is scoped to
 * the thing it was reasoned about, and a panel is not only its rows.** Same shape as the sticky
 * transport bar, which the panel-jitter sweep also missed because a bar is not a panel. The fix and
 * its measurements live in `PredictorTableView.tsx`'s `TrainCaption`; the guard is in
 * `layout-stability.test.tsx`.
 */

import {
  type PredictorState,
  PREDICTOR_ENTRIES,
  coldPredictorState,
  counterGeometry,
  isConditionalBranch,
  isDynamicScheme,
  predictorIndex,
} from '@cpu-viz/engine-common';
import type { CycleTrace, InstructionInstance } from '@cpu-viz/trace';
import { formatInstruction } from './format';
import type { BranchPrediction } from './session';

/**
 * A branch that indexes to a given row — the "who owns this counter" half of a row.
 *
 * Two owners on one row is ALIASING, the deliberate consequence of a table that holds counters and
 * no tags (`predictor.ts`'s header). ⚠ **The corpus cannot produce it at the pinned 16 entries** —
 * measured at step 6, every occupied row across all twelve programs has exactly ONE owner; the one
 * witness (`nested-loop.s`'s guard at pc 8 against its inner branch at pc 24) collides only at a
 * 4-entry table. So the multi-owner render path is drawn but UNREACHED from the shipped corpus,
 * labelled here the way `cache-grid.test.ts` labels its unreachable store-miss `LineState` rather
 * than left to read as covered.
 */
export interface PredictorOwner {
  /** The branch's own pc — the address that indexes the table. */
  readonly pc: number;
  /** Its assembly, for the row's label (`formatInstruction`, the shell's one spelling). */
  readonly text: string;
}

/** One counter, as the panel draws it — a row. */
export interface PredictorEntryView {
  /** The entry index, `0..PREDICTOR_ENTRIES-1`; `predictorIndex(pc)` is what lands here. */
  readonly index: number;
  /** The counter AFTER this cycle (`micro` is post-cycle), or its seed at the pre-run cursor. */
  readonly counter: number;
  /** The counter as it stood BEFORE this cycle — the previous snapshot, or the seed at cycle 0.
   *  Equal to {@link counter} on every row nothing trained, and equal to it on a SATURATED train
   *  too, which is why {@link trained} is a separate fact rather than a diff. */
  readonly previous: number;
  /** What this row would bet right now: `counter >= takenFrom`. */
  readonly bets: boolean;
  /** How firmly — `'strong'` at either end of the range, `'weak'` in between. `null` for a 1-bit
   *  table, which has no strength axis at all: both its values are extremes, and reporting them as
   *  "strong" would invent a distinction the machine does not have. */
  readonly strength: 'strong' | 'weak' | null;
  /** The branches that index here, by pc. Empty on a row no branch in the program reaches. */
  readonly owners: readonly PredictorOwner[];
  /** Did a conditional branch train this row THIS cycle? From the event, not from a diff. */
  readonly trained: boolean;
}

/** One branch training the table this cycle — the caption's subject. */
export interface PredictorTrainView {
  /** The row it trained. */
  readonly index: number;
  /** The branch's pc. */
  readonly pc: number;
  /** Its stable instruction id (INV-4) — so the panel can join the follow-highlight. */
  readonly id: string;
  /** Its assembly. */
  readonly text: string;
  /** What the machine had BET (reported in both directions, unlike `branch-predicted`). */
  readonly predicted: boolean;
  /** What the branch actually did. `predicted !== actual` is the misprediction. */
  readonly actual: boolean;
}

/** The whole table: a pure fold over the cursor's trace, the recording, and the scheme. */
export interface PredictorTableView {
  /** Counter width — 1 or 2. The scheme, as the panel needs it. */
  readonly bits: number;
  /** The counter ceiling (`1` or `3`) — the meter's full scale. */
  readonly max: number;
  /** The lowest counter value that bets taken. */
  readonly takenFrom: number;
  /** All {@link PREDICTOR_ENTRIES} rows, always, in index order. */
  readonly entries: readonly PredictorEntryView[];
  /** The branches that trained a counter this cycle — empty on most cycles, one on a resolve. */
  readonly trains: readonly PredictorTrainView[];
}

/**
 * Does this RECORDING have a predictor table — the App-level gate for the whole panel.
 *
 * **A trace fact, not a config one, and the difference is reachable rather than theoretical.** The
 * shell's `branchPrediction` knob persists across a model switch, so a user who selects `2-bit` on
 * the pipeline and then switches to the single-cycle model still holds a dynamic scheme in hand
 * while looking at a machine that has no predictor at all. Gating on the scheme would draw a
 * counter table for a machine that does not have one; gating on the recording cannot, and a future
 * model that honors the knob gets the panel for free without this file naming it (INV-3). Same
 * shape as the cache grid's `showCache` and the map's `hasOverlap`.
 */
export function hasPredictorTable(recording: readonly CycleTrace[]): boolean {
  return recording.some((t) => predictorOf(t) !== null);
}

/** The recorded counters for a cycle, or `null` for a model/scheme with no table. */
function predictorOf(trace: CycleTrace | null): PredictorState | null {
  const micro = trace?.state.micro as { predictor?: PredictorState | null } | undefined;
  return micro?.predictor ?? null;
}

/**
 * Fold the cursor's trace + the whole recording + the scheme into the table view-model. Pure: same
 * inputs ⇒ same view (INV-3). Returns `null` when the scheme owns no table (nothing to draw).
 *
 * `scheme` supplies the geometry the counters do not carry — {@link PredictorState} holds values
 * and not their range — which is the same split `buildCacheGrid` makes between `CacheState` (the
 * lines) and `CacheConfig` (the geometry), and it is what lets this draw a COLD table before the
 * first cycle exists (`trace === null`) rather than only appearing once a snapshot does.
 *
 * `recording` is read for two things the cursor's own trace cannot supply: the OWNER index (which
 * branches the program even has), and the PREVIOUS cycle's counters. Trace data, not an engine back
 * door — the same argument `MicroTablePanel` and the pipeline map already make for taking it.
 */
export function buildPredictorTable(
  trace: CycleTrace | null,
  recording: readonly CycleTrace[],
  scheme: BranchPrediction,
): PredictorTableView | null {
  // `isDynamicScheme` is the ENGINE's predicate, keyed off the same `Record` that decides a
  // counter's width — so the panel appears for exactly the schemes that have a table, and a third
  // dynamic scheme reaches this fold already classified rather than needing a list edited here.
  if (!isDynamicScheme(scheme)) return null;
  const { bits, max, takenFrom, seed } = counterGeometry(scheme);

  // Contents from the snapshot when there is one, else the COLD table — the shared seed, so the
  // pre-run picture and the engine's own reset state cannot drift (`coldPredictorState`'s note).
  const cold = coldPredictorState(scheme).counters;
  const now = predictorOf(trace)?.counters ?? cold;
  const before = previousCounters(trace, recording) ?? cold;

  const owners = ownerIndex(recording);
  const trains = trainsThisCycle(trace, recording);
  const trainedRows = new Set(trains.map((t) => t.index));

  const entries = Array.from({ length: PREDICTOR_ENTRIES }, (_, index): PredictorEntryView => {
    // `?? seed` rather than a non-null assertion: a recording whose counter array is a different
    // length than the configured scheme is not reachable today, but reading past the end would
    // produce `undefined` in a number field rather than anything a reader could notice.
    const counter = now[index] ?? seed;
    const previous = before[index] ?? seed;
    return {
      index,
      counter,
      previous,
      bets: counter >= takenFrom,
      strength: bits === 1 ? null : counter === max || counter === 0 ? 'strong' : 'weak',
      owners: owners.get(index) ?? [],
      trained: trainedRows.has(index),
    };
  });

  return { bits, max, takenFrom, entries, trains };
}

/**
 * The counters as they stood before this cycle — the previous recorded snapshot.
 *
 * Looked up by CYCLE NUMBER rather than by array position. `recorded[c].cycle === c` happens to
 * hold for a full recording, but the fold is handed whatever it is handed, and a lookup that is
 * right by construction costs one `find` over a few hundred entries inside a `useMemo`.
 *
 * Returns `null` at cycle 0 and pre-run — both mean "the cold table", which the caller supplies so
 * that the seed has exactly one source.
 */
function previousCounters(
  trace: CycleTrace | null,
  recording: readonly CycleTrace[],
): readonly number[] | null {
  if (trace === null || trace.cycle === 0) return null;
  const prev = recording.find((t) => t.cycle === trace.cycle - 1);
  return predictorOf(prev ?? null)?.counters ?? null;
}

/**
 * Which branches index to which row — built over the WHOLE recording, so a row's label is a
 * property of the program rather than of where the cursor happens to be.
 *
 * Keyed off the engine's own {@link isConditionalBranch} and {@link predictorIndex}, imported rather
 * than restated. That is not tidiness: `isConditionalBranch` is the pinned answer to "does `jal`
 * train the table?" (it does not), and a view that re-spelled it as `mnemonic.startsWith('b')` would
 * label `call-return.s`'s `jal` as an owner of a row it never touches. `predictorIndex` is the same
 * story one level up — `m11`'s cache-grid blanking and step 3's own measurement both say a
 * re-implemented index moves the PICTURE while every cycle count stays right.
 */
function ownerIndex(recording: readonly CycleTrace[]): Map<number, PredictorOwner[]> {
  const byPc = new Map<number, InstructionInstance>();
  for (const trace of recording) {
    for (const instr of trace.instructions) {
      if (!byPc.has(instr.pc) && isConditionalBranch(instr.decoded)) byPc.set(instr.pc, instr);
    }
  }
  const rows = new Map<number, PredictorOwner[]>();
  for (const pc of [...byPc.keys()].sort((a, b) => a - b)) {
    const index = predictorIndex(pc);
    const owner: PredictorOwner = { pc, text: formatInstruction(byPc.get(pc)!.decoded) };
    const existing = rows.get(index);
    if (existing) existing.push(owner);
    else rows.set(index, [owner]);
  }
  return rows;
}

/**
 * The branches that trained the table this cycle.
 *
 * ⚠ **The `instr` → pc join goes through the WHOLE recording, never through this cycle's own
 * `instructions[]`.** Whether a resolving instruction is still listed on its resolve cycle is a
 * per-model fact — it holds on all four today (measured: zero resolvers absent from their own cycle
 * across 672 runs), but depending on it would put a four-model assumption in a helper whose whole
 * job is to be handed a trace, which is exactly how `cache-grid.ts`'s hard-coded latch name came to
 * blank one model. An id is stable for an instruction's whole lifetime (INV-4), so the wider join
 * cannot miss on any model, present or future.
 *
 * `jal`/`jalr` resolve too and are filtered out here, because they do not train — the same
 * `isConditionalBranch` the four engines' training sites call. `call-return.s` is the corpus's
 * witness for both, and without this filter its `jal` would light a row the machine never wrote.
 */
function trainsThisCycle(
  trace: CycleTrace | null,
  recording: readonly CycleTrace[],
): readonly PredictorTrainView[] {
  if (trace === null) return [];
  const byId = new Map<string, InstructionInstance>();
  for (const t of recording) {
    for (const instr of t.instructions) if (!byId.has(instr.id)) byId.set(instr.id, instr);
  }

  const trains: PredictorTrainView[] = [];
  for (const event of trace.events) {
    if (event.type !== 'branch-resolved') continue;
    const instr = byId.get(event.instr);
    if (instr === undefined || !isConditionalBranch(instr.decoded)) continue;
    trains.push({
      index: predictorIndex(instr.pc),
      pc: instr.pc,
      id: instr.id,
      text: formatInstruction(instr.decoded),
      predicted: event.predicted,
      actual: event.actual,
    });
  }
  return trains;
}
