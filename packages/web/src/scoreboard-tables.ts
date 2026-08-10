/**
 * The scoreboard's three status tables (M15 step 7) — the pure half, in the two-halves shape the
 * cache grid, the pipeline map and the predictor table already use: this module folds
 * `(trace-at-cursor, recording)` into a view-model with no React and no color, and
 * {@link ScoreboardTables} owns the drawing. Being pure is what makes step 7's acceptance — "the
 * pure fold has its own tests" — checkable headlessly, which matters more here than usual: no test
 * in this repo can see a click, a height, or a color (`docs/memory/browser-is-the-only-net.md`), so
 * everything that CAN be checked without a browser has to be on this side of the split.
 *
 * This model's canonical picture is not a wire-and-box datapath (plan decision 9): it is the three
 * tables every textbook prints — **instruction status**, **functional-unit status**, and
 * **register-result status** — evolving cycle by cycle. That is why `models.ts` leaves this model's
 * `datapath` at `'none'` and this panel is the picture instead.
 *
 * ## The five things step 4 and step 5 pinned for this step, each of which is a way to draw it wrong
 *
 * **1. The instruction table is fed by `micro.instructions`, NEVER by `trace.instructions`, and the
 * two DISAGREE on a flush cycle by design.** `executeSlot` moves the casualty into `ctx.flushed`
 * and `stageFetch` — walked after Execute — refills the emptied slot from the branch target in the
 * SAME cycle, so `trace.instructions` sights two ids at `location: 'IF'` while `snapshotMicro` rows
 * only the one occupant. The casualty is a casualty, not an occupant of the machine. Reconciling
 * the two tables in either direction would be "fixing" a deliberate distinction.
 *
 * **2. A stall's `stage` is NOT where the instruction is, so nothing here highlights a stage cell
 * from it.** Issue is a *transition* on this machine rather than a latch: an instruction held at
 * Issue never leaves `ifSlot`, so its `location` stays `'IF'` while its stall event says
 * `stage: 'ID'`. A view that lit `stall.stage` would light a cell the instruction is not in. The
 * stage is still REPORTED (it is the textbook's own "WAW stalls at Issue, WAR stalls at
 * Write-Result"), just never used as a position.
 *
 * **3. `micro` is snapshotted AFTER the clock edge**, like `state.registers`. So a unit can show
 * `Rj`/`Rk` set in the very cycle its stall event says it could not read its operand — both true,
 * one cycle apart. Do not "fix" that either; see {@link ScoreboardUnitRow.rj}.
 *
 * **4. The three tables exist from the FIRST frame.** The pre-run cursor (−1) has no trace at all,
 * and a panel that vanishes reserves nothing: the same hole in `MicroTablePanel` dropped every
 * surface below it by **526px** when the reader stepped off the start. So the fold returns a
 * complete, empty view-model at cursor −1 rather than `null` — three idle units, no instruction
 * rows, thirty-two unclaimed registers, which is exactly the engine's own `emptyMicro()`.
 *
 * **5. No new color token.** The plan's third falsifiable UNCHANGED criterion was still open at
 * step 7 precisely because this is the step that draws something new. Nothing in this module names
 * a color at all, and the view uses only existing `T.*` tokens.
 *
 * ## ⚠ The instruction table ACCUMULATES, and that is a departure the engine cannot make
 *
 * `micro.instructions` is deliberately bounded to what is in flight plus whatever wrote its result
 * this cycle — keeping every dynamic instruction would make `micro` O(n) per cycle and the recorder
 * O(n²) on a loop program, which is a cost the ENGINE must not pay. **That bound is about the
 * recorder, not about the picture**, and a view folding the already-recorded trace pays it once
 * per cursor move instead.
 *
 * It matters, because the live window is nearly blind to this model's whole distinguishing feature.
 * Measured over all thirteen corpus programs: the window peaks at **four rows**, and the number of
 * cycles on which a younger row shows a `writeResult` while an older issued row is still blank is
 * **zero on seven of the thirteen programs** and **one** on `register-reuse.s`, the program the
 * milestone promoted to demonstrate exactly that. Out-of-order completion would flash for a single
 * cycle and be gone. Accumulated, it is a standing artifact of the table — at cursor 25 on
 * `register-reuse.s` the write-result column reads `4 5 9 15 18 17 22 25`, with `i4`'s 18 sitting
 * ABOVE `i5`'s 17, which is the textbook's picture and the reason the textbook prints it that way.
 *
 * The accumulation is bounded by {@link INSTRUCTION_WINDOW} trailing rows, so the table's height is
 * constant BY CONSTRUCTION rather than by a measured reserve — the accumulated row count reaches
 * **157** on `array-sum-twice.s`, so an unbounded table would be a scrolling log rather than a
 * picture.
 *
 * A row's four cycle numbers are accumulated as "the last non-null value seen at or before the
 * cursor". That is sound because each is written once and never retracted; it is not a guess about
 * a cell the engine left blank.
 */

import {
  FU_NAMES,
  INT_LATENCY,
  MEM_LATENCY,
  type FuName,
  type ScoreboardMicro,
} from '@cpu-viz/engine-scoreboard';
import { RV32I_REGISTER_COUNT, type CycleTrace } from '@cpu-viz/trace';
import type { DecodedInstruction } from '@cpu-viz/isa';
import { ABI_REGISTER_NAMES, formatInstruction } from './format';

/**
 * How many trailing instruction rows the status table draws.
 *
 * Ten holds the whole in-flight window (peak four, measured across the corpus) plus enough retired
 * history for the out-of-order write-result column to READ as out of order rather than flash for a
 * cycle. It is a cap and not a measurement, which is the point: the table's height is then constant
 * by construction, so this panel needs no peak-scan reserve of the kind `MicroTablePanel`'s three
 * tables each carry.
 */
export const INSTRUCTION_WINDOW = 10;

/**
 * How many cycles a functional unit is held, from the cycle it is issued into to the cycle it
 * writes, inclusive — so the next occupant issues one cycle later still.
 *
 * **DERIVED from the engine's own latency constants rather than written down**, because step 3
 * measured this as the dominant cost on this machine and the view is required to say it out loud:
 * two integer units with a four-cycle turnaround is a hard **0.5 IPC ceiling on integer code with
 * no hazard of any kind present**, and it is a larger term than either of the two hazards the
 * milestone exists to show. A reader who is not told that reads the wall of `structural-int` as the
 * scoreboard's verdict on their program rather than as the size of the machine. Importing the
 * constants means the sentence cannot go stale against a re-derived timing table.
 *
 * The three is the fixed part of the walk: Issue, Read Operands, and Write Result.
 */
export const TURNAROUND = { int: 3 + INT_LATENCY, mem: 3 + MEM_LATENCY } as const;

/** One stall the machine reported this cycle, with the words that explain it. */
export interface ScoreboardStallView {
  /** The stalled instruction's stable id (INV-4). */
  readonly id: string;
  /** The engine's reason string — `'waw'`, `'war'`, `'operand'`, `'structural-int'`,
   *  `'structural-mem'`, `'control'`. Left as the raw string: it is a trace-contract surface a
   *  lesson may anchor to (INV-6), and re-spelling it here would be a second place to go stale. */
  readonly reason: string;
  /**
   * The stage the ENGINE says stalled — `'ID'` for an Issue stall, `'WB'` for a WAR one.
   *
   * ⚠ **This is not a position.** On an Issue stall the instruction is still sitting in `IF`, so
   * `location` and this legitimately disagree (step 4's finding). Report it, never highlight from
   * it.
   */
  readonly stage: string;
  /** Whether this is one of the two hazards the model exists to show. */
  readonly hazard: boolean;
  /** The reason in words, with the turnaround numbers derived from the engine's constants. */
  readonly explain: string;
}

/** One row of the instruction status table — the textbook's four cycle columns. */
export interface ScoreboardInstructionRow {
  /** Stable id (INV-4) — the follow-highlight's join key, and the React list key. */
  readonly id: string;
  readonly pc: number;
  /** The assembly, from the recording-wide id join. Falls back to the bare mnemonic — see
   *  {@link decodedById} for why the join goes through the whole recording. */
  readonly text: string;
  /** Which functional unit holds it, or `null` while it is still in `IF` (or already gone). */
  readonly unit: FuName | null;
  readonly issue: number | null;
  readonly readOperands: number | null;
  /** The cycle EXECUTION COMPLETED, not the cycle it began — the textbook's column. */
  readonly executeComplete: number | null;
  readonly writeResult: number | null;
  /** Is it rowed by `micro` AT the cursor (in the machine now), or accumulated history? */
  readonly inFlight: boolean;
  /**
   * Fetched, never issued, and no longer rowed — a flush casualty.
   *
   * Derived rather than joined from the `flush` event, because an instruction leaves `IF` in
   * exactly two ways: it issues (and then carries an `issue` cycle forever after), or it is killed.
   * Cross-checked against the event on all thirteen corpus programs — the derived set and the ids
   * that `trace.instructions` sights at `IF` but `micro` does not row on a flush cycle agree
   * exactly, 0/4/23/1/0/1/23/0/0/5/0/4/9.
   */
  readonly flushed: boolean;
  /** The stalls this instruction reported THIS cycle (cadence is one per stalled cycle). */
  readonly stalls: readonly ScoreboardStallView[];
}

/** One row of the functional-unit status table, in the textbook's own field names. */
export interface ScoreboardUnitRow {
  readonly name: FuName;
  readonly busy: boolean;
  /** The occupying instruction's mnemonic, or `null` when idle. */
  readonly op: string | null;
  /** The occupant's stable id, or `null` — the follow-highlight's join key for this row. */
  readonly instr: string | null;
  /** The occupant's assembly, or `null` when idle. */
  readonly text: string | null;
  /** Destination register index, or `null` when it writes none (stores, branches, `x0`). */
  readonly fi: number | null;
  readonly fj: number | null;
  readonly fk: number | null;
  /** The unit that will produce `Fj`/`Fk`, or `null` when the value is already in the regfile. */
  readonly qj: FuName | null;
  readonly qk: FuName | null;
  /**
   * `Rj` — the source is READY AND NOT YET READ. This pair carries the whole WAR check, and it is
   * what makes the machine deadlock-free: an operand still waiting on a producer has `R = false`,
   * so a unit can never block the very write it is itself waiting for.
   *
   * ⚠ **It can read `true` in the same cycle a stall event says the operand could not be read**,
   * because `micro` is snapshotted after the clock edge. Both are true, one cycle apart.
   */
  readonly rj: boolean;
  readonly rk: boolean;
  /** Execution cycles remaining, or `null` unless the unit is executing. */
  readonly remaining: number | null;
  /** The occupant's stalls this cycle — so the unit row can say WHY it is not moving. */
  readonly stalls: readonly ScoreboardStallView[];
}

/** One register of the register-result table: which unit, if any, has claimed the right to write it. */
export interface ScoreboardRegisterClaim {
  readonly reg: number;
  /** The ABI name (`a0`, `t1`, …) — the spelling every other panel in the shell uses. */
  readonly name: string;
  /** The unit that will write this register, or `null` when nothing has claimed it. */
  readonly unit: FuName | null;
  /** The claiming unit's occupant, for the follow-highlight join. `null` when unclaimed. */
  readonly instr: string | null;
}

/** The whole surface: a pure fold over the cursor's trace and the recording. */
export interface ScoreboardTablesView {
  /** The trailing {@link INSTRUCTION_WINDOW} rows, oldest first, in FETCH (program) order. */
  readonly instructions: readonly ScoreboardInstructionRow[];
  /** How many older rows the window is not showing — 0 until the program outruns the window. */
  readonly hidden: number;
  /** Always the three units, in {@link FU_NAMES} order, busy or not. */
  readonly units: readonly ScoreboardUnitRow[];
  /** Always all thirty-two registers, in index order — the textbook's own geometry, and the
   *  reason this table needs no height reserve. */
  readonly registerResult: readonly ScoreboardRegisterClaim[];
  /** Every stall this cycle, in event order — the caption's subject. Empty on most cycles. */
  readonly stalls: readonly ScoreboardStallView[];
  /** The derived unit turnaround, so the view states the dominant cost without hard-coding it. */
  readonly turnaround: { readonly int: number; readonly mem: number };
}

/**
 * Which of this cycle's stalls the panel's one caption line explains.
 *
 * **A hazard wins over anything else**, and that is the whole rule: `waw` and `war` are what this
 * model exists to show, and they are also the RARE ones — step 3 measured `structural-int` as the
 * largest term in every corpus row, so a caption that simply took the first event would spend most
 * of its cycles explaining the turnaround ceiling and would fall silent on the two cycles a reader
 * came for. Up to three stalls land in one corpus cycle, and every one of them is still visible in
 * its own instruction row's stall column — the caption chooses what to put in WORDS, and hides
 * nothing.
 */
export function primaryStall(view: ScoreboardTablesView): ScoreboardStallView | null {
  return view.stalls.find((s) => s.hazard) ?? view.stalls[0] ?? null;
}

/**
 * Does this RECORDING carry the scoreboard's status tables — the App-level gate for the panel.
 *
 * **A trace fact, not a model name** (INV-3), the same shape as the map's `hasOverlap`, the cache
 * grid's `showCache` and `hasMicroTables`: the shell never says `model.id === 'scoreboard'`, and a
 * future model that emits the same `micro` would get the panel for free. `registerResult` is the
 * discriminator because it is unique to this model's `micro` across all seven — no other engine's
 * snapshot has the field (verified by grep, not assumed) — and `units` is checked with it so a
 * bare same-named field could not switch the panel on alone.
 */
export function hasScoreboardTables(recording: readonly CycleTrace[]): boolean {
  return recording.some((t) => scoreboardMicro(t) !== null);
}

/** The scoreboard `micro` for a cycle, or `null` for any other model's trace (and for pre-run). */
function scoreboardMicro(trace: CycleTrace | null): ScoreboardMicro | null {
  const m = trace?.state.micro as Partial<ScoreboardMicro> | undefined;
  return Array.isArray(m?.registerResult) && Array.isArray(m?.units)
    ? (m as ScoreboardMicro)
    : null;
}

/**
 * The reason, in words. The two hazards get the sentence that names what renaming would do to
 * them; the structural pair gets the turnaround number this machine is actually paying.
 */
function explainStall(reason: string): { hazard: boolean; explain: string } {
  switch (reason) {
    case 'waw':
      return {
        hazard: true,
        explain:
          'WAW — an older instruction has already claimed this destination, so Issue holds until ' +
          'it writes. Register renaming is what deletes this hazard.',
      };
    case 'war':
      return {
        hazard: true,
        explain:
          'WAR — an older instruction has not yet READ the register this one writes, so ' +
          'Write-Result holds. The only stall in the product that fires at the END of an ' +
          "instruction's life, and renaming deletes it too.",
      };
    case 'operand':
      return {
        hazard: false,
        explain:
          'waiting on a source register. There is no forwarding here at all — results reach ' +
          'consumers through the register file only.',
      };
    case 'structural-int':
      return {
        hazard: false,
        explain:
          `both integer units are still held. A unit is held from Issue to Write-Result, so an ` +
          `integer unit turns around in ${TURNAROUND.int} cycles — with two of them that is a ` +
          `ceiling of 0.5 instructions per cycle on integer code with no hazard present, and it ` +
          `is the largest cost on this machine.`,
      };
    case 'structural-mem':
      return {
        hazard: false,
        explain:
          `the memory unit is still held. It turns around in ${TURNAROUND.mem} cycles — one ` +
          `memory port, no non-blocking loads.`,
      };
    case 'control':
      return {
        hazard: false,
        explain:
          'Issue stops at an unresolved branch. With no reorder buffer this machine can undo ' +
          'nothing, so it must not let a younger instruction write before the branch resolves.',
      };
    default:
      return { hazard: false, explain: reason };
  }
}

/**
 * The decoded instruction behind each id, over the WHOLE recording.
 *
 * ⚠ **The join is recording-wide on purpose, never through the cursor's own
 * `trace.instructions`.** Every id `micro` rows today does appear in that same cycle's
 * `trace.instructions` — measured across all thirteen corpus programs, zero misses — but that is a
 * per-MODEL fact about how `snapshotMicro` and the instance list are built from one `reported`
 * array, and depending on it would bury a one-model assumption in a helper whose whole job is to
 * be handed a trace. That is exactly how `cache-grid.ts`'s hard-coded latch name came to blank a
 * shipped model. An id is stable for its whole lifetime (INV-4), so the wide join cannot miss.
 *
 * `micro` carries only the mnemonic, not the decoded instruction, so without this the table could
 * not print operands at all.
 */
function decodedById(recording: readonly CycleTrace[]): Map<string, DecodedInstruction> {
  const byId = new Map<string, DecodedInstruction>();
  for (const t of recording) {
    for (const i of t.instructions) if (!byId.has(i.id)) byId.set(i.id, i.decoded);
  }
  return byId;
}

/** The four cycle columns, accumulated. A cell is written once and never retracted. */
interface Accumulated {
  pc: number;
  mnemonic: string;
  unit: FuName | null;
  issue: number | null;
  readOperands: number | null;
  executeComplete: number | null;
  writeResult: number | null;
}

/**
 * Fold the cursor's trace + the whole recording into the three tables. Pure: same inputs ⇒ same
 * view (INV-3). Returns `null` only when the RECORDING has no scoreboard `micro` at all — i.e. for
 * another model, where the panel does not belong.
 *
 * At the pre-run cursor (`trace === null`) it returns the complete EMPTY view rather than `null`,
 * so the panel is present from the first frame and reserves its own height. See the header, point 4.
 *
 * `recording` is read for three things the cursor's own trace cannot supply: the accumulated cycle
 * columns, the id → decoded join, and the panel's existence at cursor −1. Trace data, not an engine
 * back door — the same argument the pipeline map, `MicroTablePanel` and the predictor table each
 * already make for taking it.
 */
export function buildScoreboardTables(
  trace: CycleTrace | null,
  recording: readonly CycleTrace[],
): ScoreboardTablesView | null {
  if (!hasScoreboardTables(recording)) return null;

  const now = scoreboardMicro(trace);
  const decoded = decodedById(recording);
  const textOf = (id: string, mnemonic: string): string => {
    const d = decoded.get(id);
    return d === undefined ? mnemonic : formatInstruction(d);
  };

  // This cycle's stalls, by id. One event per stalled instruction per stalled cycle (the engine's
  // pinned cadence), and at most three in any corpus cycle.
  const stalls: ScoreboardStallView[] = [];
  for (const event of trace?.events ?? []) {
    if (event.type !== 'stall') continue;
    const { hazard, explain } = explainStall(event.reason);
    stalls.push({ id: event.instr, reason: event.reason, stage: event.stage, hazard, explain });
  }
  const stallsById = new Map<string, ScoreboardStallView[]>();
  for (const s of stalls) {
    const list = stallsById.get(s.id);
    if (list) list.push(s);
    else stallsById.set(s.id, [s]);
  }

  // --- The instruction status table, accumulated up to the cursor ------------------------------
  //
  // Insertion order IS fetch order, because an instruction is first rowed in the cycle it enters
  // `IF` and a `Map` preserves insertion order. That is the program order the textbook prints, and
  // it is what makes an out-of-order write-result column legible as out of order.
  const rows = new Map<string, Accumulated>();
  const cursor = trace?.cycle ?? -1;
  for (const t of recording) {
    if (t.cycle > cursor) break;
    const m = scoreboardMicro(t);
    if (m === null) continue;
    for (const r of m.instructions) {
      const prev = rows.get(r.instr);
      rows.set(r.instr, {
        pc: r.pc,
        mnemonic: r.mnemonic,
        unit: r.unit ?? prev?.unit ?? null,
        issue: r.issue ?? prev?.issue ?? null,
        readOperands: r.readOperands ?? prev?.readOperands ?? null,
        executeComplete: r.executeComplete ?? prev?.executeComplete ?? null,
        writeResult: r.writeResult ?? prev?.writeResult ?? null,
      });
    }
  }

  const rowedNow = new Set((now?.instructions ?? []).map((r) => r.instr));
  const all = [...rows.entries()].map(([id, a]): ScoreboardInstructionRow => {
    const inFlight = rowedNow.has(id);
    return {
      id,
      pc: a.pc,
      text: textOf(id, a.mnemonic),
      unit: a.unit,
      issue: a.issue,
      readOperands: a.readOperands,
      executeComplete: a.executeComplete,
      writeResult: a.writeResult,
      inFlight,
      // Fetched, never issued, and gone from the machine — see the field's docblock for why this
      // derivation is exact rather than a heuristic.
      flushed: a.issue === null && !inFlight,
      stalls: stallsById.get(id) ?? [],
    };
  });
  const hidden = Math.max(0, all.length - INSTRUCTION_WINDOW);
  const instructions = all.slice(hidden);

  // --- The functional-unit status table — always three rows, busy or not -----------------------
  //
  // Sourced from `FU_NAMES` rather than from the snapshot's own array, so the table is the MACHINE
  // (three units, some idle) rather than a picture of the program. It is also what makes the panel
  // the same shape at the pre-run cursor, where there is no snapshot to read.
  const byName = new Map((now?.units ?? []).map((u) => [u.name, u]));
  const units: ScoreboardUnitRow[] = FU_NAMES.map((name) => {
    const u = byName.get(name);
    if (u === undefined || !u.busy) {
      return {
        name,
        busy: false,
        op: null,
        instr: null,
        text: null,
        fi: null,
        fj: null,
        fk: null,
        qj: null,
        qk: null,
        rj: false,
        rk: false,
        remaining: null,
        stalls: [],
      };
    }
    return {
      name,
      busy: true,
      op: u.op,
      instr: u.instr,
      text: u.instr === null ? null : textOf(u.instr, u.op ?? ''),
      fi: u.fi,
      fj: u.fj,
      fk: u.fk,
      qj: u.qj,
      qk: u.qk,
      rj: u.rj,
      rk: u.rk,
      remaining: u.remaining,
      stalls: u.instr === null ? [] : (stallsById.get(u.instr) ?? []),
    };
  });

  // --- The register-result table — all thirty-two, always ---------------------------------------
  //
  // The whole register file rather than the claimed subset (which is the rename map's shape one
  // model over), for two reasons that point the same way. It is the textbook's own geometry — the
  // scoreboard's third table is the register file with a unit written under the claimed ones — and
  // it makes the table's height CONSTANT, where a claimed-only list would move with the cursor
  // (measured peak: three claims) and would need a reserve to stop the panel twitching.
  const occupantOf = new Map(units.filter((u) => u.instr !== null).map((u) => [u.name, u.instr!]));
  const claims = now?.registerResult ?? [];
  const registerResult: ScoreboardRegisterClaim[] = Array.from(
    { length: RV32I_REGISTER_COUNT },
    (_, reg): ScoreboardRegisterClaim => {
      const unit = claims[reg] ?? null;
      return {
        reg,
        name: ABI_REGISTER_NAMES[reg] ?? `x${reg}`,
        unit,
        instr: unit === null ? null : (occupantOf.get(unit) ?? null),
      };
    },
  );

  return { instructions, hidden, units, registerResult, stalls, turnaround: TURNAROUND };
}
