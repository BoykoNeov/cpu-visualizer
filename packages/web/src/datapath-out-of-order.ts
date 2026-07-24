/**
 * The OUT-OF-ORDER datapath (M9 step 7) — the fifth bespoke geometry, in the same two-halves shape
 * as `datapath.ts` (M1), `datapath-multi.ts` (M2), `datapath-pipeline.ts` (M3) and
 * `datapath-superscalar.ts` (M7):
 *
 *  1. GEOMETRY — fixed {@link DatapathNode}s / {@link DatapathWire}s with hand-placed SVG
 *     coordinates: a shared front-end (PC → instruction memory → decode/rename) dispatching into the
 *     reorder buffer and the reservation stations, which issue to a pool of functional units and a
 *     load/store unit, whose results ride the COMMON DATA BUS back to the waiting stations and the
 *     ROB, and whose ROB head commits in order to the architectural register file.
 *  2. ACTIVATION — {@link activate}, a pure `CycleTrace → DatapathActivation`.
 *
 * ## This is the tier's SHEDDABLE half, and it is drawn as a STRUCTURE, not a pipe
 *
 * The plan inverts M7's scope lever: the ROB/RS/rename TABLES (`MicroTablePanel`, step 6) are the
 * star surface and are non-negotiable; this datapath is the honest cut. So it is deliberately a
 * STRUCTURAL schematic — the ROB, the reservation stations and the functional units are drawn as
 * single POOLS (one box each), exactly as the tables treat them, not replicated per issue slot the
 * way the superscalar's execute lanes are. A superscalar-OoO at `issueWidth: 2` runs two ALUs, but
 * a schematic that drew two boxes could not honestly attribute a shared `alu-op` event to one of
 * them (the trace never says which physical unit), so the pool is the truthful drawing and issue
 * width does not restructure this diagram (it restructures the CADENCE, which the tables and the map
 * show). This is the same reason the RS table is a projection, not a parallel array (see `micro.ts`).
 *
 * ## Activation reads `state.micro` AND `events` — the one datapath that does, and why it is safe
 *
 * Every prior datapath sources occupancy from `instructions[].location` and NEVER touches `micro`
 * (the latch models' `micro` is END-of-cycle state, a cycle ahead of the stages it would draw). This
 * one cannot: an out-of-order `location` is uniformly `"ROB#tag"` for every in-flight instruction —
 * it carries no structural stage, because there ISN'T a stage, there is a ROB entry whose STATE
 * (`waiting → executing → completed`) is its position. So the box occupancy (ROB, RS) is folded from
 * `state.micro` — the SAME snapshot the step-6 tables read at this cursor (verified there, and the
 * OoO `micro` is the cursor's own state, not a cycle ahead like a latch) — while the FLOW wires are
 * lit from THIS cycle's `events`. The occupancy fold covers ALL five box states: `rob` (any entry),
 * `rs` (`waiting`), `alu` (`executing`), `lsu` (`awaitingMem`). It must, because a box's occupancy
 * and the flow event that touches it do NOT always coincide: a slow op sits `executing` for
 * `slowOpLatency` cycles while its `alu-op` fires only once, at FU completion, so folding the ALU box
 * from occupancy (not the event) is what keeps it lit through the multi-cycle op (M9+M10 review
 * finding 2). Combining occupancy with flow is still coherent by construction: an `alu-op(id)` this
 * cycle IS an entry that was `executing`; a `mem-read(id)` is a load that was `awaitingMem`; a
 * `retire(id)` is the head that has just LEFT the ROB (so its box is already gone — the commit wire
 * draws the departing instruction, coherent as "it has retired," not a contradiction). This pairing
 * was dumped and read on `array-sum` around the first miss before a line of geometry was written.
 *
 * ## The Common Data Bus is TWO-PHASE, and drawn at the produce cycle
 *
 * Per `rob.ts` `wake()`, a producer writes its ROB entry the cycle it completes (cycle i) but a
 * waiter captures the value off the bus the NEXT cycle (i+1) — there is no zero-latency same-cycle
 * forward anywhere in this family. This diagram draws the whole broadcast at the PRODUCE cycle: the
 * FU→CDB→ROB write and the CDB→RS wakeup fan all light at i, attributed to the PRODUCER's id (the
 * follow-ring on the CDB reads "this instruction's result on the bus," the plan's phrasing). The fan
 * is not asserting that a specific waiter wakes at i — the reader sees the woken entry's box flip to
 * `executing` the next cycle by scrubbing. A schematic simplification, chosen deliberately over the
 * alternative (a prev-cycle operand-readiness diff) because the datapath asserts no cycle-precise
 * wakeup — that is the lifecycle table's job (step 3).
 *
 * ## The three encoding channels — inherited verbatim from M7 step 7
 *
 *   - **wire stroke = REGION** (`PHASE_COLORS`, reusing the five phase hues for fetch/decode/execute/
 *     memory/broadcast, plus a redirect accent), so the diagram reads left-to-right in the same
 *     validated palette the pipeline map above it uses. This grammar stands on its own; it is NOT
 *     justified by matching the map's cell hues (the map rows by `location`, not phase columns).
 *   - **box = UNIT.** Every box here is a shared POOL (the ROB holds every in-flight instruction; the
 *     RS holds every waiting one; the FU pool serves all of them), so no box carries a hue — exactly
 *     M3's pinned reason (a shared box belongs to no single instruction) and the superscalar's reason
 *     for tinting only its replicated lane units, which this model has none of.
 *   - **follow ring = IDENTITY** (a hue-free dashed halo on the WIRES the followed instruction lights
 *     this cycle), composing with the ROB/RS/rename table rows the same click lights (step 6).
 *
 * ## ONE visibility axis of substance: representation tiers
 *
 * The OoO structure is all essential — the ROB, the RS, the CDB and rename ARE the tier — so nothing
 * is structurally hidden (no `minTier` on any unit, no contraction wires, and so the contraction-
 * lawfulness litmus is N/A here). The depth dial tiers only the REPRESENTATION: `essentials` draws
 * the bare lit structure, `detailed` adds value labels. The one config gate is the branch predictor's
 * bet redirect (`rename → PC`), absent when the machine does not bet (INV-5: a not-taken machine
 * takes no bet action to draw), exactly as the pipeline hides its bet adder.
 */

import { DEPTH_TIERS, type DepthTier } from '@cpu-viz/curriculum';
import type { CycleTrace } from '@cpu-viz/trace';
import type { OutOfOrderMicro } from '@cpu-viz/engine-out-of-order';

// --- Regions (the wire-hue channel) ---------------------------------------------------------

/** A wire's region — what picks its hue. The first five map to `PHASE_COLORS`; `redirect` is the
 *  fetch-steering correction/bet, drawn in the accent rather than a phase hue. */
export type Region = 'fetch' | 'decode' | 'execute' | 'memory' | 'broadcast' | 'redirect';

/** The regions that ride a phase hue, and which phase each borrows (the pipeline map's palette). */
export const REGION_PHASE: Record<
  Exclude<Region, 'redirect'>,
  'IF' | 'ID' | 'EX' | 'MEM' | 'WB'
> = {
  fetch: 'IF',
  decode: 'ID',
  execute: 'EX',
  memory: 'MEM',
  broadcast: 'WB',
};

// --- Geometry -----------------------------------------------------------------------------

export const CANVAS = { width: 1180, height: 620 } as const;

export interface DatapathNode {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly shape?: 'box' | 'mux' | 'adder';
  /** Drawn ONLY when the machine bets taken. No unit sets this today (the predictor's action here is
   *  a redirect WIRE, not a box), but the gate is kept for parity with the sibling views and so a
   *  future predictor box hides lawfully — and so a wire into such a box never dangles. */
  readonly predictTakenOnly?: boolean;
}

// LAYOUT CONTRACT (checked by the geometry tests): a left-to-right spine — PC, instruction memory,
// decode/rename — fans into the ROB (top) and the reservation stations (middle). The RS issues right
// into the functional-unit pool (execute) and the load/store unit (memory, with its own data
// memory). Every result drops onto the COMMON DATA BUS along the bottom, which runs back up to the RS
// (wakeup) and the ROB (result write). The ROB commits rightward into the architectural registers.
// The two redirects ride the clear TOP rails back to the PC.
const NODE_LIST: readonly DatapathNode[] = [
  // --- Front-end spine (all centred on y = 312) ---
  { id: 'pc', label: 'PC', x: 36, y: 288, w: 46, h: 48 },
  { id: 'imem', label: 'Instr\nMem', x: 126, y: 280, w: 84, h: 64 },
  { id: 'rename', label: 'Decode\n& Rename', x: 258, y: 278, w: 110, h: 68 },
  // --- The out-of-order core ---
  { id: 'rob', label: 'Reorder\nBuffer', x: 452, y: 92, w: 156, h: 96 },
  { id: 'regfile', label: 'Registers\n(committed)', x: 744, y: 92, w: 132, h: 96 },
  { id: 'rs', label: 'Reservation\nStations', x: 452, y: 300, w: 156, h: 96 },
  { id: 'alu', label: 'Functional\nunits (ALU)', x: 744, y: 258, w: 104, h: 92 },
  { id: 'lsu', label: 'Load /\nStore unit', x: 744, y: 404, w: 112, h: 60 },
  { id: 'dmem', label: 'Data\nMem', x: 908, y: 398, w: 96, h: 72 },
  // --- The common data bus: one wide bar along the bottom, many listeners ---
  { id: 'cdb', label: 'Common data bus (CDB)', x: 200, y: 548, w: 804, h: 20 },
] as const;

export const NODES: ReadonlyMap<string, DatapathNode> = new Map(NODE_LIST.map((n) => [n.id, n]));

type Pt = readonly [number, number];

/** Anchor a point on a node's edge midpoint (+ `off` along that edge). */
function at(id: string, side: 'l' | 'r' | 't' | 'b', off = 0): Pt {
  const n = NODES.get(id)!;
  switch (side) {
    case 'l':
      return [n.x, n.y + n.h / 2 + off];
    case 'r':
      return [n.x + n.w, n.y + n.h / 2 + off];
    case 't':
      return [n.x + n.w / 2 + off, n.y];
    case 'b':
      return [n.x + n.w / 2 + off, n.y + n.h];
  }
}
/** A point on a node's edge at an absolute coordinate along it (for the wide/tall boxes). */
function edgeX(id: string, side: 'l' | 'r', y: number): Pt {
  const n = NODES.get(id)!;
  return [side === 'l' ? n.x : n.x + n.w, y];
}
function edgeY(id: string, side: 't' | 'b', x: number): Pt {
  const n = NODES.get(id)!;
  return [x, side === 't' ? n.y : n.y + n.h];
}

export interface DatapathWire {
  readonly id: string;
  /** The two node ids this wire physically connects (edge-to-edge). Drives visibility: a wire is
   *  drawn only if both ends are, so hiding a unit never dangles a wire. */
  readonly ends: readonly [string, string];
  readonly points: readonly Pt[];
  readonly region: Region;
  /** Drawn ONLY when the machine bets taken — the predictor's fetch redirect (as the pipeline). */
  readonly predictTakenOnly?: boolean;
  /** True for a DISPATCH connector — drawn as static skeleton, never lit as active flow. Dispatch
   *  (rename → ROB / → RS) has no single-cycle trace signal that is not entangled with the ROB-full
   *  stall (an IF-driven flow would light dispatch exactly when a full ROB is meant to show it
   *  CHOKING), so it is drawn as structure only; the boxes it joins light from their own occupancy. */
  readonly skeleton?: boolean;
}

const WIRE_LIST: readonly DatapathWire[] = [
  // --- Front-end: fetch address → instruction memory → decode/rename ---
  { id: 'pc-imem', ends: ['pc', 'imem'], points: [at('pc', 'r'), at('imem', 'l')], region: 'fetch' }, // prettier-ignore
  { id: 'imem-rename', ends: ['imem', 'rename'], points: [at('imem', 'r'), at('rename', 'l')], region: 'decode' }, // prettier-ignore
  // --- Dispatch (SKELETON — see DatapathWire.skeleton): decode/rename allocates into ROB + RS ---
  { id: 'rename-rob', ends: ['rename', 'rob'], points: [at('rename', 'r', -12), [410, 300], [410, 120], edgeX('rob', 'l', 120)], region: 'decode', skeleton: true }, // prettier-ignore
  { id: 'rename-rs', ends: ['rename', 'rs'], points: [at('rename', 'r', 12), [430, 324], [430, 348], at('rs', 'l')], region: 'decode', skeleton: true }, // prettier-ignore
  // --- Issue: a ready station issues to the functional-unit pool, or to the load/store unit ---
  { id: 'rs-alu', ends: ['rs', 'alu'], points: [at('rs', 'r', -8), [690, 340], [690, 304], at('alu', 'l')], region: 'execute' }, // prettier-ignore
  { id: 'rs-lsu', ends: ['rs', 'lsu'], points: [at('rs', 'r', 12), [690, 360], [690, 434], at('lsu', 'l')], region: 'execute' }, // prettier-ignore
  // --- Memory: the LSU addresses the data memory; a load's datum returns ---
  { id: 'lsu-dmem', ends: ['lsu', 'dmem'], points: [edgeX('lsu', 'r', 428), edgeX('dmem', 'l', 428)], region: 'memory' }, // prettier-ignore
  { id: 'dmem-lsu', ends: ['dmem', 'lsu'], points: [edgeX('dmem', 'l', 440), edgeX('lsu', 'r', 440)], region: 'memory' }, // prettier-ignore
  // --- The Common Data Bus: results drop onto the bus, which fans back to RS (wakeup) and ROB ---
  { id: 'alu-cdb', ends: ['alu', 'cdb'], points: [at('alu', 'r', 26), [884, 330], edgeY('cdb', 't', 884)], region: 'broadcast' }, // prettier-ignore
  { id: 'lsu-cdb', ends: ['lsu', 'cdb'], points: [at('lsu', 'b'), edgeY('cdb', 't', at('lsu', 'b')[0])], region: 'broadcast' }, // prettier-ignore
  { id: 'cdb-rs', ends: ['cdb', 'rs'], points: [edgeY('cdb', 't', 530), edgeY('rs', 'b', 530)], region: 'broadcast' }, // prettier-ignore
  // The ROB return rides its own vertical (x=424) OUTBOARD of the RS block and clear of the two
  // x=410/430 dispatch runs, so no two verticals sit collinear on the left rail.
  { id: 'cdb-rob', ends: ['cdb', 'rob'], points: [edgeY('cdb', 't', 424), [424, 160], edgeX('rob', 'l', 160)], region: 'broadcast' }, // prettier-ignore
  // --- Commit: the ROB head retires in order into the architectural register file ---
  { id: 'rob-regfile', ends: ['rob', 'regfile'], points: [at('rob', 'r'), at('regfile', 'l')], region: 'broadcast' }, // prettier-ignore
  // --- Redirects along the top rails: ROB-based recovery (always) and the predictor's bet ---
  { id: 'rob-pc', ends: ['rob', 'pc'], points: [at('rob', 't'), [530, 40], [59, 40], at('pc', 't')], region: 'redirect' }, // prettier-ignore
  { id: 'rename-pc', ends: ['rename', 'pc'], points: [at('rename', 't'), [313, 60], [36, 60], at('pc', 'l', -6)], region: 'redirect', predictTakenOnly: true }, // prettier-ignore
] as const;

export const WIRES: readonly DatapathWire[] = WIRE_LIST;

const WIRE_BY_ID: ReadonlyMap<string, DatapathWire> = new Map(WIRE_LIST.map((w) => [w.id, w]));

// --- Depth tiers × config -------------------------------------------------------------------

/** The engine behaviours the diagram's structure depends on. Only the predictor bites here —
 *  renaming makes forwarding meaningless (the engine reports it false) and issue width does not
 *  restructure a pool-based diagram, so neither is an axis. `branchPrediction` has three names and
 *  two machines, so the shell collapses it to the one behaviour that decides geometry: does it bet? */
export interface DatapathConfig {
  readonly predictTaken: boolean;
}

/** Whether a node is drawn. Every unit is present at every tier (no structural tiering); the only
 *  gate is the predictor axis, which no box uses today but the shape keeps (see the node field). */
export function nodeVisibleAt(node: DatapathNode, tier: DepthTier, cfg: DatapathConfig): boolean {
  if (node.predictTakenOnly && !cfg.predictTaken) return false;
  return true;
}

/** Whether a wire is drawn: on the right side of the one config gate, with both endpoints drawn. */
export function wireVisibleAt(wire: DatapathWire, tier: DepthTier, cfg: DatapathConfig): boolean {
  if (wire.predictTakenOnly && !cfg.predictTaken) return false;
  return wire.ends.every((id) => nodeVisibleAt(NODES.get(id)!, tier, cfg));
}

/** Whether active wires carry their value labels at `tier` (everything except `essentials`). */
export function showValueLabels(tier: DepthTier): boolean {
  return DEPTH_TIERS.indexOf(tier) >= DEPTH_TIERS.indexOf('detailed');
}

// --- Activation -------------------------------------------------------------------------------

/** How a value should be rendered on a wire label. */
export type Fmt = 'hex' | 'dec';

/** A lit wire — who lit it, from which region (the hue), and the value flowing when this cycle's
 *  events know it (absent is honest: a value on a skeleton/latch wire is not in this trace). */
export interface WireActivation {
  readonly instr: string;
  readonly region: Region;
  readonly value?: number;
  readonly fmt: Fmt;
}

export interface DatapathActivation {
  /** Ids of component boxes on an active path this cycle. A box can be busy for several instructions
   *  at once (the ROB holds many, the FU pool serves several) — the WIRES carry the attribution. */
  readonly components: ReadonlySet<string>;
  /** Active wire id → who lit it, from which region, with what value. */
  readonly wires: ReadonlyMap<string, WireActivation>;
}

const EMPTY: DatapathActivation = { components: new Set(), wires: new Map() };

// The ISA classes, mirroring the superscalar's sets — a load/store's `alu-op` computes an ADDRESS
// (issue to the LSU), a branch's `alu-op` is a COMPARISON (no register result to broadcast), and
// everything else's `alu-op` is a RESULT that drives the CDB.
const LOADS = new Set(['lb', 'lh', 'lw', 'lbu', 'lhu']);
const STORES = new Set(['sb', 'sh', 'sw']);
const BRANCHES = new Set(['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu']);

/** The out-of-order `micro` at this cursor, or null for any other model's trace (the gate). */
function oooMicro(trace: CycleTrace): OutOfOrderMicro | null {
  const m = trace.state.micro as Partial<OutOfOrderMicro> | undefined;
  return Array.isArray(m?.rob) ? (m as OutOfOrderMicro) : null;
}

/**
 * Derive which datapath components/wires are active THIS cycle. Box occupancy (ROB, RS, FU, LSU)
 * folds from `state.micro`; the flow wires light from this cycle's `events` (see the file docs on why
 * combining the two is coherent). Tier- and config-oblivious (INV-2): it always lights the full
 * structure and every value it knows; the view filters. Returns an empty activation for the pre-run /
 * non-OoO state.
 *
 * `followed` is the followed instruction's id (INV-4), or `null`. It affects exactly one wire: the
 * ROB commits up to `issueWidth` instructions per cycle (`instr-retire` fires once per shifted head),
 * but the single `rob-regfile` commit wire can carry only ONE instruction's attribution — so on a
 * DOUBLE retire it draws the FOLLOWED instruction when it is one of this cycle's retires, and the
 * oldest otherwise. Without this, following the younger sibling rings its table row but not the
 * commit wire on the cycle it retires, and the wire's value label shows the OTHER instruction's
 * reg-write — the diagram contradicting the table for the followed instruction (M9+M10 review
 * finding 4).
 */
export function activate(
  trace: CycleTrace | null,
  followed: string | null = null,
): DatapathActivation {
  if (!trace) return EMPTY;
  const micro = oooMicro(trace);
  if (micro === null) return EMPTY;

  const components = new Set<string>();
  const wires = new Map<string, WireActivation>();

  /** Light a wire for `inst`'s work, and (as every model here does) light both its endpoints — which
   *  is what makes the coherence litmus hold by construction. A skeleton wire is never lit. */
  const light = (id: string, instr: string, value: number | undefined, fmt: Fmt): void => {
    const wire = WIRE_BY_ID.get(id);
    if (!wire) throw new Error(`activate: unknown wire id "${id}"`);
    if (wire.skeleton) throw new Error(`activate: skeleton wire "${id}" must not be lit`);
    wires.set(id, { instr, region: wire.region, value, fmt });
    for (const end of wire.ends) components.add(end);
  };

  // --- Box occupancy from micro: the ROB holds every in-flight instruction; the RS is the waiting
  // subset; the FU pool holds every `executing` (slow-op) entry and the LSU every `awaitingMem`
  // (load/store mid-access) one. These are STATE, drawn whenever occupied even if no wire touches
  // them this cycle — which is exactly why the FU/LSU boxes must fold from OCCUPANCY, not from the
  // `alu-op`/`mem-read` events: a slow op sits `executing` for `slowOpLatency` cycles but its
  // `alu-op` fires only at FU completion, so an event-only ALU box would go dark for the multi-cycle
  // op the `reservation-station-holds` lesson invites scrubbing to (M9+M10 review finding 2). ---
  if (micro.rob.length > 0) components.add('rob');
  if (micro.rob.some((e) => e.state === 'waiting')) components.add('rs');
  if (micro.rob.some((e) => e.state === 'executing')) components.add('alu');
  if (micro.rob.some((e) => e.state === 'awaitingMem')) components.add('lsu');

  // --- Front-end: instruction fetch (the oldest fetch supplies the pc address label) ---
  const fetches = trace.events.filter((e) => e.type === 'instr-fetch');
  const firstFetch = fetches[0];
  if (firstFetch?.type === 'instr-fetch') {
    light('pc-imem', firstFetch.instr, firstFetch.pc, 'hex');
    light('imem-rename', firstFetch.instr, firstFetch.encoding, 'hex');
  }

  // --- Execute: each `alu-op` issues its instruction to the ALU pool (result → CDB) or the LSU
  // (address). A branch's compare executes in the ALU but broadcasts nothing. ---
  for (const e of trace.events) {
    if (e.type !== 'alu-op') continue;
    const m = e.op; // the engine mirrors the reference's op name; class it by the instruction.
    const mn = mnemonicOf(trace, e.instr) ?? m;
    if (LOADS.has(mn) || STORES.has(mn)) {
      light('rs-lsu', e.instr, e.result, 'hex'); // the effective address
    } else if (BRANCHES.has(mn)) {
      light('rs-alu', e.instr, e.result, 'dec'); // the comparison — no CDB result
    } else {
      light('rs-alu', e.instr, e.result, 'dec');
      light('alu-cdb', e.instr, e.result, 'dec'); // an R/I result rides the bus
    }
  }

  // --- Memory: a load reads the data memory and its datum returns; a store writes it (at commit) ---
  for (const e of trace.events) {
    if (e.type === 'mem-read') {
      light('lsu-dmem', e.instr, e.addr, 'hex');
      light('dmem-lsu', e.instr, e.value, 'dec');
      light('lsu-cdb', e.instr, e.value, 'dec'); // the loaded value rides the bus
    } else if (e.type === 'mem-write') {
      light('lsu-dmem', e.instr, e.addr, 'hex');
    }
  }

  // --- The CDB fan: any result on the bus this cycle wakes the RS and writes the ROB. Attributed to
  // the PRODUCER whose result is on the bus (the followed ring reads "this instruction's result"). ---
  const producer = cdbProducer(trace);
  if (producer !== null) {
    light('cdb-rs', producer, undefined, 'dec');
    light('cdb-rob', producer, undefined, 'dec');
  }

  // --- Commit: the ROB head retires in order into the register file (its box has just left the ROB;
  // the wire draws the departing instruction, coherent as "it has retired"). ---
  // Up to `issueWidth` heads retire per cycle, but the pool's single commit wire attributes to one:
  // the FOLLOWED retire when the followed instruction is retiring this cycle, else the oldest (first)
  // — so following the younger of a double retire rings the wire and labels it with ITS reg-write.
  const retires = trace.events.filter((e) => e.type === 'instr-retire');
  const followedRetire =
    followed === null
      ? undefined
      : retires.find((e) => e.type === 'instr-retire' && e.instr === followed);
  const retire = followedRetire ?? retires[0];
  if (retire?.type === 'instr-retire') {
    const rw = trace.events.find((e) => e.type === 'reg-write' && e.instr === retire.instr);
    const value = rw?.type === 'reg-write' ? rw.value : undefined;
    light('rob-regfile', retire.instr, value, 'dec');
  }

  // --- Redirects: ROB-based recovery on a misprediction/flush, and the predictor's bet ---
  const mispredict = trace.events.find(
    (e) => e.type === 'branch-resolved' && e.predicted !== e.actual,
  );
  const flush = trace.events.find((e) => e.type === 'flush');
  if (mispredict?.type === 'branch-resolved') {
    light('rob-pc', mispredict.instr, mispredict.target, 'hex');
  } else if (flush) {
    // A flush with no matching resolved-branch this cycle (e.g. a stale wrong-path squash) still
    // redirects fetch; draw the recovery without a target label it cannot name.
    light('rob-pc', '', undefined, 'hex');
  }
  const bet = trace.events.find((e) => e.type === 'branch-predicted');
  if (bet?.type === 'branch-predicted') {
    light('rename-pc', bet.instr, bet.target, 'hex');
  }

  return { components, wires };
}

/** The mnemonic of an in-flight (ROB) instruction by id, for classing its `alu-op`. */
function mnemonicOf(trace: CycleTrace, id: string): string | undefined {
  const micro = oooMicro(trace);
  return micro?.rob.find((e) => e.id === id)?.decoded.mnemonic;
}

/**
 * The id whose RESULT is on the CDB this cycle, or null. A result is an R/I-type `alu-op` (not a
 * load/store address, not a branch compare) or a load's `mem-read`. Oldest such producer wins the
 * attribution — the bus is one wire, and oldest-first is this model's own arbitration order.
 */
function cdbProducer(trace: CycleTrace): string | null {
  for (const e of trace.events) {
    if (e.type === 'mem-read') return e.instr;
    if (e.type === 'alu-op') {
      const mn = mnemonicOf(trace, e.instr) ?? e.op;
      if (!LOADS.has(mn) && !STORES.has(mn) && !BRANCHES.has(mn)) return e.instr;
    }
  }
  return null;
}
