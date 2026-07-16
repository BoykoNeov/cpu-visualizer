/**
 * The pipeline map (M3 step 7) — the stage×cycle grid, designed in `docs/plans/superscalar-visuals.md`
 * §2: **rows are instructions, columns are cycles, each cell is the stage that instruction occupied
 * that cycle.** This is the surface where "instructions overlap in time" stops being a claim about
 * the trace and becomes the picture everyone recognizes from a textbook.
 *
 * This module is the PURE half (the two-halves shape every datapath already uses): a fold from a
 * recording to a grid view-model, with no React and no color. {@link PipelineMapView} owns the
 * drawing and the hues. Being pure is what makes the acceptance — "the grid is derived purely from
 * the trace (INV-3)" — checkable headlessly.
 *
 * **It is the one M3 deliverable a future model reuses AS-IS, so it carries no model knowledge at
 * all.** Everything else in M3 is per-model by construction — each microarchitecture is its own
 * package with its own `micro` type and its own bespoke geometry — which is why this is the only
 * place the generality is worth buying. Concretely, three things are DERIVED rather than declared:
 *
 *   - **The stage set** comes from the recording (`distinct location`s in first-seen order), never
 *     from a hard-coded 5-element list. A 7- or 12-stage pipeline just yields more entries.
 *   - **The hue key is the stage FAMILY** ({@link stageFamily}), not the stage. That is the rule
 *     `superscalar-visuals.md` pins for going deeper than the five validated phase hues: `IF1`/`IF2`
 *     wear the fetch hue and stay individually readable via their cell TEXT (the relief rule).
 *   - **Rows come from `instructions[]` order**, which is pinned as program order, oldest first —
 *     a stable RULE rather than a positional one, so it still means something when two lanes share
 *     a stage and "stage order" no longer defines anything.
 *
 * Both future axes therefore land with no change here: **lanes** (`"EX.0"`/`"EX.1"` — two rows share
 * a column) and **stage count** (more columns per row). Neither is speculative machinery: they are
 * the two encodings M3 already pinned for `location`, and `pipeline-map.test.ts` drives both through
 * a hand-built trace, since no engine we ship emits either yet.
 *
 * Everything the map needs is already in the trace (INV-3) — `instructions[].location` per cycle
 * plus stable ids (INV-4). It never touches an engine, a recorder, or `state.micro`.
 */

import type { DecodedInstruction } from '@cpu-viz/isa';
import type { CycleTrace } from '@cpu-viz/trace';

/** One instruction's occupancy of one cycle — a single cell of the grid. */
export interface MapCell {
  /** The recorded cycle (also the cursor index) — the cell's COLUMN. */
  readonly cycle: number;
  /** The raw trace `location`, verbatim — the cell's TEXT (`"IF"`, `"EX.0"`, `"IF2"`, …). */
  readonly location: string;
  /** {@link stageFamily} of `location` — the cell's HUE key. At five stages family IS stage. */
  readonly family: string;
}

/** One instruction's whole life — a single ROW of the grid. */
export interface MapRow {
  /** The stable id (INV-4) this row is keyed on: what follow selects and the datapath matches. */
  readonly id: string;
  readonly pc: number;
  readonly sourceLine: number | null;
  readonly decoded: DecodedInstruction;
  /**
   * One cell per cycle the instruction was in flight, ascending and contiguous. A STALL needs no
   * representation of its own: the instruction simply occupies the same stage two cycles running,
   * so it falls out as the repeated cell of every textbook diagram (`IF IF ID`).
   */
  readonly cells: readonly MapCell[];
  /**
   * The `flush.reason` that KILLED this instruction, or `null` if nothing did. This is what cuts a
   * row short: a flushed instruction has no further cells, because it stops appearing in
   * `instructions[]`. Cross-referenced from the flush's `stages` against who occupied them —
   * exactly as `schema.ts` instructs, since `flush` reports stages and not ids.
   */
  readonly killedBy: string | null;
  /** True once an `instr-retire` names this id — the row ran to completion. */
  readonly retired: boolean;
}

/** The whole grid: a pure fold over the recording. */
export interface PipelineMap {
  /** One row per in-flight instruction, in program order (= fetch order). */
  readonly rows: readonly MapRow[];
  /** Recorded cycle count — the column count. */
  readonly cycles: number;
  /** Every distinct `location` seen, in first-seen order — DERIVED, never a hard-coded list. */
  readonly stages: readonly string[];
  /** Every distinct {@link stageFamily}, in first-seen order — the legend's hue entries. */
  readonly families: readonly string[];
  /** The largest `instructions.length` in any cycle — how many ever overlapped. */
  readonly maxInFlight: number;
}

/**
 * The HUE key for a `location`: its stage FAMILY. Collapses exactly the two axes M3 pinned the
 * plain-string `location` to absorb, and nothing else:
 *
 *   - a **lane** slot — `"EX.0"` → `"EX"` (the pinned `"<stage>.<slot>"` encoding); and
 *   - a **depth** index — `"IF2"` → `"IF"` (the pinned deeper-stage-set encoding).
 *
 * `superscalar-visuals.md` pins the reason: a 7- or 12-stage model has more stages than the five
 * validated phase hues, and the answer is never to invent a hue — it is to color by family and let
 * the cell's TEXT carry the exact stage (the relief rule, which already mandates a label beside
 * every hue). At M3's five stages family IS stage, so this changes nothing today; it is the seam
 * that keeps a later model from having to rewrite the map.
 *
 * A family with no hue of its own (an OoO `"ROB#3"`, say) is not this plan's problem and is left to
 * render neutral rather than guessed at — the view falls back, it does not crash.
 */
export function stageFamily(location: string): string {
  const withoutLane = location.split('.')[0] ?? location;
  const withoutDepth = withoutLane.replace(/\d+$/, '');
  // A location that is ALL digits would collapse to nothing; keep it verbatim rather than empty.
  return withoutDepth === '' ? withoutLane : withoutDepth;
}

/** Mutable row under construction — {@link MapRow} minus the readonly cells array. */
interface RowBuilder {
  id: string;
  pc: number;
  sourceLine: number | null;
  decoded: DecodedInstruction;
  cells: MapCell[];
  killedBy: string | null;
  retired: boolean;
}

/**
 * Fold a recording into the grid. Pure: same recording ⇒ same map, no engine access (INV-3).
 *
 * Row ORDER is the fold's one subtle point, and it is derived rather than assumed: cycles ascend,
 * and within a cycle `instructions[]` is pinned to be program order (oldest first), so appending
 * each id the first time it is seen yields fetch order — which is program order, including the
 * doomed instructions a taken branch fetched and killed. A loop's body therefore appears once per
 * ITERATION (each fetch mints a fresh id, INV-4), which is the point: the map shows the dynamic
 * run, not the static listing.
 *
 * Pass the recorder's full `recorded` array. Callers that want the whole run must have driven it to
 * the end first (`runToEnd`) — the recorder records lazily at the high-water mark, exactly as
 * `anchorLesson` requires.
 */
export function buildPipelineMap(recorded: readonly CycleTrace[]): PipelineMap {
  const byId = new Map<string, RowBuilder>();
  const stages: string[] = [];
  const families: string[] = [];
  const seenStage = new Set<string>();
  const seenFamily = new Set<string>();
  let maxInFlight = 0;

  for (const trace of recorded) {
    maxInFlight = Math.max(maxInFlight, trace.instructions.length);

    for (const inst of trace.instructions) {
      if (!seenStage.has(inst.location)) {
        seenStage.add(inst.location);
        stages.push(inst.location);
      }
      const family = stageFamily(inst.location);
      if (!seenFamily.has(family)) {
        seenFamily.add(family);
        families.push(family);
      }
      let row = byId.get(inst.id);
      if (!row) {
        // First sighting: this is the fetch, so the append order IS program order.
        row = {
          id: inst.id,
          pc: inst.pc,
          sourceLine: inst.sourceLine,
          decoded: inst.decoded,
          cells: [],
          killedBy: null,
          retired: false,
        };
        byId.set(inst.id, row);
      }
      row.cells.push({ cycle: trace.cycle, location: inst.location, family });
    }

    // Who died, and who finished. Both are read from this cycle's events — `flush` names STAGES
    // (it reports real casualties, and a flush that kills nobody emits no event at all), so the
    // victims are resolved by cross-referencing `instructions[]`, which is what `schema.ts` tells
    // consumers to do. Matching on the full `location` rather than a family keeps it lane-correct:
    // a superscalar flush naming `"EX.1"` must kill lane 1's occupant and not lane 0's.
    for (const event of trace.events) {
      if (event.type === 'flush') {
        for (const stage of event.stages) {
          const victim = trace.instructions.find((i) => i.location === stage);
          const row = victim ? byId.get(victim.id) : undefined;
          if (row) row.killedBy = event.reason;
        }
      } else if (event.type === 'instr-retire') {
        const row = byId.get(event.instr);
        if (row) row.retired = true;
      }
    }
  }

  return {
    rows: Array.from(byId.values(), (r) => ({ ...r, cells: r.cells })),
    cycles: recorded.length,
    stages,
    families,
    maxInFlight,
  };
}

/**
 * Whether a recording ever holds more than one instruction at once — i.e. whether the map has
 * anything to say. This is the map's GATE, and it deliberately contains no model knowledge: the map
 * exists to show instructions overlapping in time, so it appears exactly when they do (INV-3).
 * Single-cycle and multi-cycle carry exactly one instruction in every cycle by construction, so it
 * never appears for them without anyone having to name them; the pipeline qualifies itself, and so
 * does any future model. The same shape as the transport chip's pinned `instructions.length > 1`
 * rule from step 5.
 */
export function hasOverlap(recorded: readonly CycleTrace[]): boolean {
  return recorded.some((t) => t.instructions.length > 1);
}

/** The row index whose instruction is in flight at `cycle`, or -1. Rows are in fetch order and an
 *  instruction's cells are contiguous, so the rows in flight at any cycle are a contiguous band;
 *  this returns the FIRST (oldest), which is what the view scrolls to keep the action in view. */
export function firstRowAt(map: PipelineMap, cycle: number): number {
  return map.rows.findIndex(
    (r) =>
      r.cells.length > 0 &&
      r.cells[0]!.cycle <= cycle &&
      r.cells[r.cells.length - 1]!.cycle >= cycle,
  );
}
