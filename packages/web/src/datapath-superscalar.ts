/**
 * The IN-ORDER SUPERSCALAR datapath (M7 step 7) — the fourth bespoke geometry, in the same
 * two-halves shape as `datapath.ts` (M1), `datapath-multi.ts` (M2) and `datapath-pipeline.ts` (M3):
 *
 *  1. GEOMETRY — fixed {@link DatapathNode}s / {@link DatapathWire}s with hand-placed SVG
 *     coordinates: a SHARED front-end (next-pc selector, PC, the instruction memory fetching a
 *     PAIR, the issue/pairing unit, one register file) feeding **two replicated execute lanes**,
 *     which then re-converge on a SINGLE data memory and a shared writeback bus.
 *  2. ACTIVATION — {@link activate}, a pure `CycleTrace → DatapathActivation`.
 *
 * ## What is new here, and what is deliberately NOT
 *
 * M3 broke "one instruction per diagram"; this breaks **"one instruction per stage."** A cycle can
 * light TEN stage slices for ten different instructions — two per stage — so a lit wire has to say
 * which instruction, which stage, AND which issue SLOT lit it.
 *
 * **What actually widens is a short list, and the pinned pairing rules are why.** The three refusal
 * verdicts are a coordinated simplification, not three independent tastes: no two memory ops pair
 * ⇒ MEM does ≤1 access per cycle, so the data memory stays SINGLE; no two transfers pair ⇒ EX
 * resolves ≤1 control transfer per cycle, so the redirect stays SINGLE. What doubles is exactly:
 * fetch, the register-read ports, the sign-extenders, the forwarding network, the ALUs, the
 * dedicated pc/immediate adders, and the writeback write ports. The geometry says so literally —
 * every node carrying a `lane` is one of those, and everything else is drawn once.
 *
 * Two of those replications were settled by DUMPING A REAL WIDTH-2 TRACE, not by reasoning, because
 * both looked shared at first glance and are not:
 *   - **`pcarith` replicates.** Two `lui`s pair happily (they are neither memory ops, nor transfers,
 *     nor RAW-dependent), and U/J-format producers emit no `alu-op` at all — so a cycle really can
 *     hold `EX.0=lui` and `EX.1=lui`, each needing the dedicated pc/immediate adder at once.
 *   - **The MEM→WB bypass replicates.** Two non-memory instructions in `MEM.0`/`MEM.1` both carry
 *     their value straight past the data memory in the same cycle. One shared wire could only name
 *     one of them, and the follow-ring would silently point at the wrong instruction.
 *
 * ## The three encoding channels — and why the wire stroke is NOT the lane
 *
 * `superscalar-visuals.md` (2026-07-14) proposed lane-tinting the wires. That document predates
 * M3 step 6 shipping, and by now the wire stroke is SPOKEN FOR: it means STAGE, in the same
 * validated `PHASE_COLORS` set the pipeline map directly above the diagram uses. Re-pointing it at
 * "lane" would put two color grammars on one screen — the map saying blue = IF while the datapath
 * says blue = lane 0 — and would make `EX.0` and `EX.1` DIFFERENT colors, destroying the one
 * reading this whole tier exists to produce: *two instructions in EX at once.*
 *
 * So the three channels are split by what can honestly carry each (user-pinned, 2026-07-20):
 *   - **wire stroke = STAGE** (`PHASE_COLORS`), exactly as M3.
 *   - **node tint = LANE** (`--lane-0` / `--lane-1`). M3 keeps boxes hue-neutral because a box is
 *     SHARED — the register file is read by ID and written by WB in one cycle — and that reason
 *     still holds for every shared box here, which is why only `lane`-carrying nodes are tinted.
 *     `ALU 1` does slot 1's work and nothing else, so it can wear a lane hue without lying.
 *   - **follow ring = IDENTITY** (a hue-free dashed halo), composing with both.
 * The relief rule is mandatory and satisfied structurally: light magenta is 2.62:1 against the
 * surface, so every lane-tinted node carries its lane in its TEXT label (`ALU 1`, `Sign ext 1`),
 * and the legend swatches sit beside the words "Lane 0" / "Lane 1".
 *
 * ## THREE visibility axes (M3 had two)
 *
 * `tier` and `forwarding`/`predictTaken` behave exactly as in M3. The new one is **`issueWidth`**,
 * and it follows the same law rather than a new one: with `issueWidth: 1` the trace NEVER emits a
 * `.1` location, no pairing refusal can fire, and the machine genuinely has no second lane — so
 * lane 1 and the issue unit are **ABSENT, not dimmed** (drawing an idle second ALU would contradict
 * the trace, INV-5). That is also what makes the width toggle *restructure* the picture, which is
 * the flagship 1↔2 A/B this milestone exists for.
 *
 * The issue unit hiding at width 1 deserves its own line, because it is the one that looks
 * arguable: a 1-wide superscalar is an honest machine that DOES run issue logic (that is the pinned
 * answer to "is width 1 distinct from M3"). But this box draws the PAIRING verdict specifically —
 * "may these two go together" — and with one candidate there is no such question, which is why the
 * three pairing reasons cannot appear at width 1. That claim is not asserted here on reasoning; the
 * test suite proves it over the whole corpus (`no pairing refusal is possible at width 1`). The
 * ORDINARY hazard check that width 1 still runs is drawn by the separate `hazard` unit, which is
 * width-independent — exactly as M3's is.
 *
 * ## Occupancy comes from `instructions[].location`, NEVER from `state.micro`
 *
 * Inherited verbatim from M3, and the trap is unchanged: `micro` at cycle `i` is the END-of-cycle
 * latch state, so a datapath sourced from it draws the pipe ONE CYCLE AHEAD OF ITSELF. Values
 * likewise come only from THIS cycle's `events`. Nothing here reads `micro` at all. The same
 * consequence follows: values riding a latch BETWEEN stages are mostly unlabelled, because they
 * were emitted a cycle earlier and are not in this trace — those wires light bare rather than
 * borrow a number that would be one cycle wrong (INV-5: omit, never contradict).
 *
 * One superscalar-specific sharpening of that rule: `forward.from` names only the LATCH
 * (`'EX/MEM'` / `'MEM/WB'`) and **not which slot of it** the value came from. So every forward is
 * drawn from the latch BAR — the source lane is a fact the trace does not carry, and inventing one
 * would be a coin-flip drawn as hardware. The SINK lane is known (it is the consumer's own slot),
 * which is why the forward wires are lane-tagged at their destination end only.
 */

import { DEPTH_TIERS, type DepthTier } from '@cpu-viz/curriculum';
import type { Stage } from '@cpu-viz/engine-superscalar';
import type { CycleTrace, InstructionInstance } from '@cpu-viz/trace';

export type { Stage };

/** The five stages, oldest-to-youngest left to right — the columns of the diagram. */
export const STAGES: readonly Stage[] = ['IF', 'ID', 'EX', 'MEM', 'WB'];
export const STAGE_LABELS: Record<Stage, string> = {
  IF: 'Fetch',
  ID: 'Decode',
  EX: 'Execute',
  MEM: 'Memory',
  WB: 'Writeback',
};

/** An issue slot — the lane a replicated unit belongs to. Index 0 is the OLDEST in program order. */
export type Lane = 0 | 1;
export const LANES: readonly Lane[] = [0, 1];
/** The widest machine this geometry draws. Width is a config toggle (1 ↔ 2), never a third value. */
export const MAX_WIDTH = 2;

/**
 * Split a superscalar `location` into its stage and issue slot. This model's locations are ALWAYS
 * `"<stage>.<slot>"` — never a bare `"EX"`, even at width 1 (pinned at M7 step 2a, proven over a
 * real recording at step 5), so a bare stage name is not ours to draw and returns `null`.
 */
export function parseLocation(location: string): { stage: Stage; slot: number } | null {
  const dot = location.indexOf('.');
  if (dot < 0) return null;
  const stage = location.slice(0, dot);
  const slot = Number(location.slice(dot + 1));
  if (!(STAGES as readonly string[]).includes(stage)) return null;
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_WIDTH) return null;
  return { stage: stage as Stage, slot };
}

/** The wire/node id for lane `n`'s copy of a replicated element (`'alu'` → `'alu-l1'`). */
export function laneId(base: string, lane: number): string {
  return `${base}-l${lane}`;
}

// --- Geometry -----------------------------------------------------------------------------

// WIDTH IS SET BY THE LABELS, HEIGHT BY THE LANES. The first half is M3's finding, inherited: the
// shared renderer de-collides a value label by nudging it VERTICALLY, which fails beside a latch
// bar (a 588px-tall bar leaves a label no clear y to escape to), so every gap where a 32-bit hex
// label lands beside a bar is sized to hold it. The second half is this model's: two execute lanes
// plus the shared spine BETWEEN them, plus a rail band above and below for each lane's forwarding
// returns, is what sets the height. Lane 0's returns ride the TOP rails and lane 1's the BOTTOM —
// each lane's network on its own outboard side, which is both the picture ("each lane forwards for
// itself") and the thing that keeps eight long return wires from having to share one 22px channel.
export const CANVAS = { width: 1300, height: 830 } as const;

/** Vertical pitch between the two execute lanes — lane 1 is lane 0 translated down by this. */
const LANE_DY = 310;
/** Top of lane 0's execute block. Lane `n`'s block top is `EX_TOP + n * LANE_DY`. */
const EX_TOP = 118;
/** Top / bottom of the four latch bars — the columns that divide the five stage bands. */
const BAR_TOP = 112;
const BAR_H = 588;

export interface DatapathNode {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Draw as a trapezoid (mux) or notched adder rather than a plain box. */
  readonly shape?: 'box' | 'mux' | 'adder';
  /**
   * The execute lane this unit belongs to — set ONLY on genuinely replicated hardware. Two things
   * follow, and they are the reason this one field carries the whole lane story:
   *   - VISIBILITY: lane `n` exists only at `issueWidth > n`, so lane 1 is absent at width 1.
   *   - TINT: the view paints the box in `--lane-<n>`. A shared box (the register file, the data
   *     memory, every latch bar) has no lane and stays hue-neutral — not for tidiness but because
   *     it genuinely belongs to no single instruction, which is M3's pinned reason for hue-neutral
   *     boxes and still holds here.
   */
  readonly lane?: Lane;
  /** Lowest depth tier at which this component is drawn. Absent ⇒ `essentials`. */
  readonly minTier?: DepthTier;
  /** Drawn ONLY when `forwarding` is on — the forwarding units and their muxes (as M3). */
  readonly forwardingOnly?: boolean;
  /** Drawn ONLY when the machine bets taken — the branch-target adder and its redirect (as M3). */
  readonly predictTakenOnly?: boolean;
  /**
   * Lowest `issueWidth` at which this unit is drawn. Absent ⇒ 1 (always). Set to 2 on the ISSUE
   * unit, which is the one width-gated node that is not simply "lane 1's copy": pairing is a
   * question about two candidates, and at width 1 there is never a second one — so the trace cannot
   * carry a pairing refusal there, and a unit that could never light would be drawing a decision
   * the machine never makes. A `lane` implies its own minimum (`lane + 1`) and needs no duplicate.
   */
  readonly minWidth?: number;
  /** The control signal this unit drives — shown only at `expert` tier. */
  readonly controlLabel?: string;
}

/** The narrowest machine that draws `node` — from its explicit `minWidth` and its lane, whichever
 *  is stricter. Lane `n` needs width `n + 1` by definition, so the two never have to agree by hand. */
function requiredWidth(el: { lane?: Lane; minWidth?: number }): number {
  return Math.max(el.minWidth ?? 1, (el.lane ?? 0) + 1);
}

// LAYOUT CONTRACT (checked by the geometry tests): five stage bands divided by four latch BARS,
// exactly as M3 — the bars are SHARED and undoubled, because a latch bar already holds every slot
// (`SuperscalarMicro`'s latches are arrays; the bar is the array, not one element of it). Between
// them the canvas is banded HORIZONTALLY: lane 0's execute block on top, the shared spine
// (PC/instruction memory, register file, data memory) through the middle, lane 1's block below.
// Control units ride the clear top band; each lane's forwarding returns ride its own outboard rail
// band; the writeback bus and the four pc redirects ride the lowest rails, each on its own y.
const SHARED_NODES: readonly DatapathNode[] = [
  // --- IF (shared): the next-pc selector, the PC, the pair-fetch adder, the instruction memory ---
  // Six sources meet at `pcmux`, which is the honest count for this machine: the sequential next
  // pc, the ID bet, and a pc-relative or `jalr` correction from EITHER lane. The last pair is why
  // there are four redirects and not two — the branch-slot rule caps EX at ONE resolved transfer
  // per cycle, but it does NOT say which lane it sits in (observed: a `jal` issuing from slot 1
  // beside an `auipc` in slot 0), so both lanes must be able to steer and at most one ever does.
  { id: 'pcmux', label: '', x: 32, y: 342, w: 18, h: 76, shape: 'mux', controlLabel: 'PCSrc' },
  { id: 'pc', label: 'PC', x: 68, y: 358, w: 40, h: 44 },
  // "+4n", not "+4": this machine advances the fetch pointer by four bytes PER INSTRUCTION FETCHED,
  // and that count is 1 or 2 depending on how many IF slots were free — so a hard "+8" would be
  // wrong on exactly the cycles a stall makes interesting. The wire out of it carries the real
  // number from the trace, which is where a reader gets the actual value.
  { id: 'addn', label: '+4n', x: 150, y: 248, w: 58, h: 48, shape: 'adder' },
  { id: 'imem', label: 'Instr\nMem', x: 150, y: 340, w: 76, h: 80 },
  { id: 'ifid', label: 'IF\n/\nID', x: 284, y: BAR_TOP, w: 16, h: BAR_H },
  // --- ID (shared): issue/pairing, hazard detection, the register file, the bet adder -----------
  // THE MODEL'S SOUL, drawn. It answers "may these two go together?" and its refusal reason is what
  // step 8's readout will name. No `minTier`: like the bet adder and unlike the forwarding unit,
  // this is not an optimization detail the skeleton may omit — it is the machine.
  { id: 'issue', label: 'Issue\n/ pair', x: 330, y: 112, w: 112, h: 44, minWidth: 2, controlLabel: 'IssueSlots' }, // prettier-ignore
  { id: 'hazard', label: 'Hazard\ndetect', x: 330, y: 170, w: 112, h: 44, minTier: 'expert', controlLabel: 'PCWrite / IF-ID-Write' }, // prettier-ignore
  // ONE register file, with twice the ports. The box is shared and hue-neutral (it is read by both
  // lanes' ID and written by both lanes' WB in the same cycle); the PORTS are the wires, and those
  // are lane-tagged. That is the honest split — a superscalar does not grow a second register file.
  { id: 'regfile', label: 'Registers', x: 330, y: 300, w: 112, h: 140 },
  // The BET's adder — single-lane by the branch-slot rule (EX resolves at most one transfer a
  // cycle), but fed from EITHER lane's sign-extender, since the betting branch may sit in either
  // slot. Proportioned near-square so the P&H notch reads as an adder (M4 step 5's browser finding).
  { id: 'btarget', label: 'Branch\ntarget', x: 330, y: 456, w: 80, h: 54, shape: 'adder', predictTakenOnly: true }, // prettier-ignore
  { id: 'idex', label: 'ID\n/\nEX', x: 520, y: BAR_TOP, w: 16, h: BAR_H },
  { id: 'exmem', label: 'EX\n/\nMEM', x: 784, y: BAR_TOP, w: 16, h: BAR_H },
  // --- MEM (shared, and single by RULE): one data memory, one port --------------------------
  // The mem-port refusal is what keeps this box single, and it pays for itself several times over:
  // one memory means one cache, one miss-freeze, and one address stream, so nothing about width can
  // reorder memory. Drawing a second data memory would draw hardware the pairing rules forbid.
  { id: 'dmem', label: 'Data\nMem', x: 862, y: 334, w: 92, h: 92 },
  { id: 'memwb', label: 'MEM\n/\nWB', x: 1040, y: BAR_TOP, w: 16, h: BAR_H },
] as const;

/** Lane `n`'s replicated hardware. Everything in the EX band sits on a fixed pitch (`LANE_DY`);
 *  the two ID-band units do NOT, because the shared register file sits between them — so a lane's
 *  sign-extender is placed against its own band rather than by the formula. */
function laneNodes(lane: Lane): DatapathNode[] {
  const ly = EX_TOP + lane * LANE_DY;
  const n = String(lane);
  // The sign-extenders straddle the register file: lane 0 above it, lane 1 below.
  const sextY = lane === 0 ? 232 : 534;
  return [
    { id: laneId('signext', lane), label: `Sign\nExtend ${n}`, x: 330, y: sextY, w: 100, h: 38, lane }, // prettier-ignore
    { id: laneId('fwdunit', lane), label: `Forwarding\nunit ${n}`, x: 590, y: ly, w: 118, h: 38, lane, minTier: 'expert', forwardingOnly: true }, // prettier-ignore
    { id: laneId('fwdmuxa', lane), label: '', x: 580, y: ly + 58, w: 18, h: 56, shape: 'mux', lane, minTier: 'expert', forwardingOnly: true, controlLabel: `ForwardA${n}` }, // prettier-ignore
    { id: laneId('fwdmuxb', lane), label: '', x: 580, y: ly + 126, w: 18, h: 56, shape: 'mux', lane, minTier: 'expert', forwardingOnly: true, controlLabel: `ForwardB${n}` }, // prettier-ignore
    { id: laneId('alu', lane), label: `ALU ${n}`, x: 624, y: ly + 54, w: 84, h: 132, shape: 'adder', lane }, // prettier-ignore
    // The dedicated pc/immediate adder, REPLICATED — settled by dumping a trace, not by reasoning:
    // two `lui`s pair, and U/J producers emit no `alu-op`, so both lanes can need it in one cycle.
    { id: laneId('pcarith', lane), label: `PC\narith ${n}`, x: 624, y: ly + 212, w: 68, h: 48, shape: 'adder', lane }, // prettier-ignore
    { id: laneId('wbmux', lane), label: '', x: 1150, y: ly + 64, w: 18, h: 100, shape: 'mux', lane, minTier: 'detailed', controlLabel: `MemtoReg${n}` }, // prettier-ignore
  ];
}

const NODE_LIST: readonly DatapathNode[] = [...SHARED_NODES, ...LANES.flatMap(laneNodes)];

export const NODES: ReadonlyMap<string, DatapathNode> = new Map(NODE_LIST.map((n) => [n.id, n]));

type Pt = readonly [number, number];

/** Anchor a point on a node's edge. l/r = side midpoints + `off`; t/b = top/bottom edge + `off`
 *  along it. For adders use {@link aUp}/{@link aLo} (left operand stubs) and `r` (output). */
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
/** A point on a latch BAR's left/right edge at an absolute `y`. The bars are 588px tall, so
 *  centre-relative offsets would be unreadable; the y is the honest coordinate. */
function bar(id: string, side: 'l' | 'r', y: number): Pt {
  const n = NODES.get(id)!;
  return [side === 'l' ? n.x : n.x + n.w, y];
}
/** An adder's upper / lower left operand stub; `off` slides along that stub's vertical edge. */
function aUp(id: string, off = 0): Pt {
  const n = NODES.get(id)!;
  return [n.x, n.y + n.h * 0.16 + off];
}
function aLo(id: string, off = 0): Pt {
  const n = NODES.get(id)!;
  return [n.x, n.y + n.h * 0.84 + off];
}
/** The y of an adder stub, for routing an elbow into it. */
const upY = (id: string, off = 0): number => aUp(id, off)[1];
const loY = (id: string, off = 0): number => aLo(id, off)[1];

export interface DatapathWire {
  readonly id: string;
  /** The two node ids this wire physically connects (edge-to-edge). Drives visibility: a wire is
   *  drawn only if both ends are, so hiding a unit never dangles a wire. The `id` is a display name
   *  and does NOT reliably name the endpoints. */
  readonly ends: readonly [string, string];
  readonly points: readonly Pt[];
  /** The issue slot whose work this wire carries. Set on every replicated wire — including ones
   *  whose ENDPOINTS are both shared (the two `imem → IF/ID` fetch wires, the two `EX/MEM → MEM/WB`
   *  bypasses), which is exactly why this cannot be derived from `ends`. */
  readonly lane?: Lane;
  readonly minTier?: DepthTier;
  readonly forwardingOnly?: boolean;
  readonly predictTakenOnly?: boolean;
  /** Lowest `issueWidth` at which this wire is drawn (absent ⇒ 1; a `lane` implies `lane + 1`). */
  readonly minWidth?: number;
  /** For a CONTRACTION wire: the unit id it collapses. The `S → T` contraction must equal the
   *  expert path `S → unit → T` (same source, same sink) — the INV-5 lawfulness condition, checked
   *  by test. It is drawn exactly when that unit is NOT (see {@link wireVisibleAt}). */
  readonly contracts?: string;
}

// The rail allocation, written down because it is the thing a later edit will silently break.
// TOP rails (lane 0's forwarding returns) and BOTTOM rails (lane 1's) are the outboard bands; the
// lowest rails carry the four pc redirects and the two writeback buses. A contraction wire SHARES
// its through-wire's rail on purpose — the two are never co-visible (one stands in for the other),
// which is what keeps the rail count at fourteen instead of twenty-four.
const RAIL = {
  bet: 18, // ID's bet, home to the selector on the top rail
  seq: 32, // the sequential +4n, likewise
  issuePc: 46, // the issue unit holding the PC
  hazardPc: 60, // the hazard unit holding the PC
  fwd: [
    [74, 82, 90, 98], // lane 0 — above the diagram
    [712, 720, 728, 736], // lane 1 — below it
  ],
  redirect: [744, 752, 760, 768], // pcarith-l0, pcarith-l1, alu-l0, alu-l1
  wb: [786, 798], // the two writeback buses home to the register file
} as const;

/** Vertical channels between the ID/EX bar and the forwarding muxes — reused by BOTH lanes, which
 *  is safe because lane 0 climbs to the top rails and lane 1 drops to the bottom ones, so no two
 *  runs ever overlap in y. */
const FWD_CH = [542, 550, 558, 566] as const;
/** Vertical channels for the forwarding CONTRACTIONS, which bypass the muxes and land straight on
 *  an ALU operand stub. They cross the forwarding unit's box — harmless, because a contraction is
 *  drawn only when that unit is hidden. */
const CON_CH = [600, 606, 612, 618] as const;
/** The channel a forwarding mux's output elbows through on its way to the ALU. */
const MUX_OUT_CH = 610;
/** Vertical channels in the narrow gap between the IF/ID bar and the ID band's boxes, indexed
 *  `[bet-immediate lane 0, bet-immediate lane 1, writeback bus lane 0, writeback bus lane 1]`. The
 *  two short bet runs take the tightest slots and the two long writeback buses the outer ones. */
const ID_CH = [306, 312, 318, 324] as const;

const SHARED_WIRES: readonly DatapathWire[] = [
  // --- IF: the selected pc addresses the instruction memory ---------------------------------
  { id: 'pcmux-pc', ends: ['pcmux', 'pc'], points: [at('pcmux', 'r'), at('pc', 'l')] }, // prettier-ignore
  { id: 'pc-imem', ends: ['pc', 'imem'], points: [at('pc', 'r'), at('imem', 'l')] }, // prettier-ignore
  { id: 'pc-addn', ends: ['pc', 'addn'], points: [at('pc', 't', -10), [78, loY('addn')], aLo('addn')] }, // prettier-ignore
  { id: 'addn-pcmux', ends: ['addn', 'pcmux'], points: [at('addn', 'r'), [232, 272], [232, RAIL.seq], [18, RAIL.seq], [18, 350], at('pcmux', 'l', -30)] }, // prettier-ignore
  // --- ID: the ISSUE unit — the pairing verdict, and the machine's soul ----------------------
  // It reads both candidates out of IF/ID and answers by holding the ones it refused, which is what
  // a refusal LOOKS like: the younger instruction sits in ID for a second cycle and leads the next
  // group. Width-2 only (see the node's `minWidth`).
  { id: 'ifid-issue', ends: ['ifid', 'issue'], points: [bar('ifid', 'r', at('issue', 'l')[1]), at('issue', 'l')], minWidth: 2 }, // prettier-ignore
  { id: 'issue-ifid', ends: ['issue', 'ifid'], points: [at('issue', 'l', 14), bar('ifid', 'r', at('issue', 'l', 14)[1])], minWidth: 2 }, // prettier-ignore
  { id: 'issue-pc', ends: ['issue', 'pc'], points: [at('issue', 't', -20), [at('issue', 't', -20)[0], RAIL.issuePc], [at('pc', 't', 10)[0], RAIL.issuePc], at('pc', 't', 10)], minWidth: 2 }, // prettier-ignore
  // --- ID: the hazard unit — width-INDEPENDENT, because a RAW against an older stage is the same
  // question however many instructions travel abreast. It scans every SLOT of the two older stages,
  // which at width 1 is M3's pair of singleton tests.
  { id: 'ifid-hazard', ends: ['ifid', 'hazard'], points: [bar('ifid', 'r', at('hazard', 'l')[1]), at('hazard', 'l')] }, // prettier-ignore
  { id: 'idex-hazard', ends: ['idex', 'hazard'], points: [bar('idex', 'l', at('hazard', 'r', -16)[1]), at('hazard', 'r', -16)] }, // prettier-ignore
  { id: 'hazard-ifid', ends: ['hazard', 'ifid'], points: [at('hazard', 'l', 14), bar('ifid', 'r', at('hazard', 'l', 14)[1])] }, // prettier-ignore
  { id: 'hazard-pc', ends: ['hazard', 'pc'], points: [at('hazard', 't', 20), [at('hazard', 't', 20)[0], RAIL.hazardPc], [at('pc', 't', 18)[0], RAIL.hazardPc], at('pc', 't', 18)] }, // prettier-ignore
  // --- ID: the BET — single-lane by the branch-slot rule, fed from either lane's sign-extender ---
  { id: 'ifid-btarget', ends: ['ifid', 'btarget'], points: [bar('ifid', 'r', upY('btarget')), aUp('btarget')], predictTakenOnly: true }, // prettier-ignore
  { id: 'btarget-pcmux', ends: ['btarget', 'pcmux'], points: [at('btarget', 'r'), [486, 483], [486, RAIL.bet], [28, RAIL.bet], [28, 362], at('pcmux', 'l', -18)], predictTakenOnly: true }, // prettier-ignore
  // --- MEM: EX/MEM addresses the ONE data memory; a load's datum returns to MEM/WB -------------
  // Shared and unslotted, and that is the mem-port rule paying out: at most one instruction per
  // cycle can be here, so there is nothing to disambiguate. Whichever lane's instruction it is
  // lights these wires, and the follow-ring resolves it by id.
  { id: 'exmem-dmem-addr', ends: ['exmem', 'dmem'], points: [bar('exmem', 'r', 360), at('dmem', 'l', -20)] }, // prettier-ignore
  { id: 'exmem-dmem-data', ends: ['exmem', 'dmem'], points: [bar('exmem', 'r', 400), at('dmem', 'l', 20)] }, // prettier-ignore
  { id: 'dmem-memwb', ends: ['dmem', 'memwb'], points: [at('dmem', 'r'), bar('memwb', 'l', 380)] }, // prettier-ignore
] as const;

/** Lane `n`'s replicated wiring. */
function laneWires(lane: Lane): DatapathWire[] {
  // Every coordinate below is derived from the NODES this lane already placed (via `at`/`aUp`/
  // `aLo`), never from the lane pitch again — so a node that moves drags its wires with it instead
  // of silently detaching, which is the failure the "endpoint sits on its node's drawn edge" litmus
  // exists to catch and the reason the first draft of this file failed it twelve times.
  const L = (base: string): string => laneId(base, lane);
  const rail = RAIL.fwd[lane]!;
  const [r0, r1, r2, r3] = [rail[0]!, rail[1]!, rail[2]!, rail[3]!];
  const [ch0, ch1, ch2, ch3] = FWD_CH;
  const [con0, con1, con2, con3] = CON_CH;
  // Lane 0's returns leave the bars at the TOP edge and climb; lane 1's leave at the BOTTOM and
  // drop. One `side` flips the whole network, which is what makes the two lanes structurally
  // identical rather than two hand-drawn variants that merely look alike.
  const side = lane === 0 ? 't' : 'b';
  const fwdmuxa = L('fwdmuxa');
  const fwdmuxb = L('fwdmuxb');
  const alu = L('alu');
  const pcarith = L('pcarith');
  const wbmux = L('wbmux');
  // Register-file read ports climb (lane 0) or drop (lane 1) out of the shared file into the lane's
  // own band, each on its own channel so four ports never share a vertical run.
  const portCh = lane === 0 ? [452, 460] : [468, 476];
  const portY = lane === 0 ? [208, 228] : [512, 532];
  const regOff = lane === 0 ? [-40, -26] : [26, 40];
  /** Where this lane's writeback bus lands on the register file's write port. */
  const regWriteY = at('regfile', 'l', lane === 0 ? 48 : 62)[1];

  return [
    // --- IF: the pair of fetched words, one per slot -----------------------------------------
    // Two wires out of ONE instruction memory: a superscalar fetches a pair from consecutive
    // addresses in a cycle. Both endpoints are shared nodes, which is precisely why the LANE has to
    // be declared on the wire — `ends` cannot say which of the two words this is.
    { id: L('imem-ifid'), ends: ['imem', 'ifid'], points: [at('imem', 'r', lane === 0 ? -16 : 16), bar('ifid', 'l', lane === 0 ? 364 : 396)], lane }, // prettier-ignore

    // --- ID: this lane's decode — register reads and its own sign-extender --------------------
    { id: L('ifid-regfile'), ends: ['ifid', 'regfile'], points: [bar('ifid', 'r', at('regfile', 'l', lane === 0 ? -40 : 40)[1]), at('regfile', 'l', lane === 0 ? -40 : 40)], lane }, // prettier-ignore
    { id: L('ifid-signext'), ends: ['ifid', L('signext')], points: [bar('ifid', 'r', at(L('signext'), 'l')[1]), at(L('signext'), 'l')], lane }, // prettier-ignore
    { id: L('signext-idex'), ends: [L('signext'), 'idex'], points: [at(L('signext'), 'r'), bar('idex', 'l', at(L('signext'), 'r')[1])], lane }, // prettier-ignore
    { id: L('regfile-idex-a'), ends: ['regfile', 'idex'], points: [at('regfile', 'r', regOff[0]!), [portCh[0]!, at('regfile', 'r', regOff[0]!)[1]], [portCh[0]!, portY[0]!], bar('idex', 'l', portY[0]!)], lane }, // prettier-ignore
    { id: L('regfile-idex-b'), ends: ['regfile', 'idex'], points: [at('regfile', 'r', regOff[1]!), [portCh[1]!, at('regfile', 'r', regOff[1]!)[1]], [portCh[1]!, portY[1]!], bar('idex', 'l', portY[1]!)], lane }, // prettier-ignore
    // Either lane's immediate can feed the single bet adder — the betting branch may sit in either
    // slot (observed, not assumed: `branch-flavors.s` bets from slot 1 throughout). At most one is
    // ever lit, because the branch-slot rule caps the cycle at one transfer.
    { id: L('signext-btarget'), ends: [L('signext'), 'btarget'], points: [at(L('signext'), 'r', -12), [lane === 0 ? 494 : 500, at(L('signext'), 'r', -12)[1]], [lane === 0 ? 494 : 500, lane === 0 ? 528 : 520], [ID_CH[lane], lane === 0 ? 528 : 520], [ID_CH[lane], loY('btarget', lane === 0 ? -5 : 5)], aLo('btarget', lane === 0 ? -5 : 5)], lane, predictTakenOnly: true }, // prettier-ignore

    // --- EX: this lane's forwarding network, ALU and pc/immediate adder -----------------------
    { id: L('idex-fwdmuxa'), ends: ['idex', fwdmuxa], points: [bar('idex', 'r', at(fwdmuxa, 'l')[1]), at(fwdmuxa, 'l')], lane }, // prettier-ignore
    { id: L('idex-fwdmuxb'), ends: ['idex', fwdmuxb], points: [bar('idex', 'r', at(fwdmuxb, 'l')[1]), at(fwdmuxb, 'l')], lane }, // prettier-ignore
    { id: L('exmem-fwdmuxa'), ends: ['exmem', fwdmuxa], points: [at('exmem', side, -4), [at('exmem', side, -4)[0], r0], [ch0, r0], [ch0, at(fwdmuxa, 'l', 22)[1]], at(fwdmuxa, 'l', 22)], lane }, // prettier-ignore
    { id: L('memwb-fwdmuxa'), ends: ['memwb', fwdmuxa], points: [at('memwb', side, -4), [at('memwb', side, -4)[0], r1], [ch1, r1], [ch1, at(fwdmuxa, 'l', -22)[1]], at(fwdmuxa, 'l', -22)], lane }, // prettier-ignore
    { id: L('exmem-fwdmuxb'), ends: ['exmem', fwdmuxb], points: [at('exmem', side, 4), [at('exmem', side, 4)[0], r2], [ch2, r2], [ch2, at(fwdmuxb, 'l', 22)[1]], at(fwdmuxb, 'l', 22)], lane }, // prettier-ignore
    { id: L('memwb-fwdmuxb'), ends: ['memwb', fwdmuxb], points: [at('memwb', side, 4), [at('memwb', side, 4)[0], r3], [ch3, r3], [ch3, at(fwdmuxb, 'l', -22)[1]], at(fwdmuxb, 'l', -22)], lane }, // prettier-ignore
    { id: L('fwdmuxa-alu'), ends: [fwdmuxa, alu], points: [at(fwdmuxa, 'r'), [MUX_OUT_CH, at(fwdmuxa, 'r')[1]], [MUX_OUT_CH, upY(alu)], aUp(alu)], lane }, // prettier-ignore
    { id: L('fwdmuxb-alu'), ends: [fwdmuxb, alu], points: [at(fwdmuxb, 'r'), [MUX_OUT_CH, at(fwdmuxb, 'r')[1]], [MUX_OUT_CH, loY(alu)], aLo(alu)], lane }, // prettier-ignore
    // The forwarding unit compares this lane's sources against EVERY slot of the two latches ahead
    // of it — the source set is what genuinely doubles, and the unit is per-lane because each lane
    // asks the question about its own operands.
    { id: L('idex-fwdunit'), ends: ['idex', L('fwdunit')], points: [bar('idex', 'r', at(L('fwdunit'), 'l')[1]), at(L('fwdunit'), 'l')], lane }, // prettier-ignore
    { id: L('exmem-fwdunit'), ends: ['exmem', L('fwdunit')], points: [bar('exmem', 'l', at(L('fwdunit'), 'r')[1]), at(L('fwdunit'), 'r')], lane }, // prettier-ignore
    { id: L('memwb-fwdunit'), ends: ['memwb', L('fwdunit')], points: [bar('memwb', 'l', at(L('fwdunit'), 'r')[1] - 10), [740, at(L('fwdunit'), 'r')[1] - 10], [740, at(L('fwdunit'), 'r', -10)[1]], at(L('fwdunit'), 'r', -10)], lane }, // prettier-ignore
    // The three CONTRACTIONS per operand port — one per source, sharing their through-wire's rail
    // because the two are never co-visible. Each lands on its own y along the ALU's operand stub.
    { id: L('idex-alu-a'), ends: ['idex', alu], points: [bar('idex', 'r', upY(alu)), aUp(alu)], lane, contracts: fwdmuxa }, // prettier-ignore
    { id: L('exmem-alu-a'), ends: ['exmem', alu], points: [at('exmem', side, -4), [at('exmem', side, -4)[0], r0], [con0, r0], [con0, upY(alu, -12)], aUp(alu, -12)], lane, contracts: fwdmuxa, forwardingOnly: true }, // prettier-ignore
    { id: L('memwb-alu-a'), ends: ['memwb', alu], points: [at('memwb', side, -4), [at('memwb', side, -4)[0], r1], [con1, r1], [con1, upY(alu, 12)], aUp(alu, 12)], lane, contracts: fwdmuxa, forwardingOnly: true }, // prettier-ignore
    { id: L('idex-alu-b'), ends: ['idex', alu], points: [bar('idex', 'r', loY(alu)), aLo(alu)], lane, contracts: fwdmuxb }, // prettier-ignore
    { id: L('exmem-alu-b'), ends: ['exmem', alu], points: [at('exmem', side, 4), [at('exmem', side, 4)[0], r2], [con2, r2], [con2, loY(alu, -12)], aLo(alu, -12)], lane, contracts: fwdmuxb, forwardingOnly: true }, // prettier-ignore
    { id: L('memwb-alu-b'), ends: ['memwb', alu], points: [at('memwb', side, 4), [at('memwb', side, 4)[0], r3], [con3, r3], [con3, loY(alu, 12)], aLo(alu, 12)], lane, contracts: fwdmuxb, forwardingOnly: true }, // prettier-ignore
    { id: L('alu-exmem'), ends: [alu, 'exmem'], points: [at(alu, 'r'), bar('exmem', 'l', at(alu, 'r')[1])], lane }, // prettier-ignore
    { id: L('idex-pcarith-pc'), ends: ['idex', pcarith], points: [bar('idex', 'r', upY(pcarith)), aUp(pcarith)], lane }, // prettier-ignore
    { id: L('idex-pcarith-imm'), ends: ['idex', pcarith], points: [bar('idex', 'r', loY(pcarith)), aLo(pcarith)], lane }, // prettier-ignore
    { id: L('pcarith-exmem'), ends: [pcarith, 'exmem'], points: [at(pcarith, 'r'), bar('exmem', 'l', at(pcarith, 'r')[1])], lane }, // prettier-ignore
    // The two EX corrections, per lane. A pc-relative transfer redirects from this lane's pc adder;
    // `jalr` alone from its ALU, because a REGISTER supplies the target. At most one of the four is
    // ever lit — the branch-slot rule — but which lane it is is not knowable from the geometry.
    { id: L('pcarith-pcmux'), ends: [pcarith, 'pcmux'], points: [at(pcarith, 'r', 8), [716 + lane * 6, at(pcarith, 'r', 8)[1]], [716 + lane * 6, RAIL.redirect[lane]!], [16 + lane * 6, RAIL.redirect[lane]!], [16 + lane * 6, 374 + lane * 12], at('pcmux', 'l', -6 + lane * 12)], lane }, // prettier-ignore
    { id: L('alu-pcmux'), ends: [alu, 'pcmux'], points: [at(alu, 'r', 20), [728 + lane * 6, at(alu, 'r', 20)[1]], [728 + lane * 6, RAIL.redirect[2 + lane]!], [28 - lane * 16, RAIL.redirect[2 + lane]!], [28 - lane * 16, 398 + lane * 12], at('pcmux', 'l', 18 + lane * 12)], lane }, // prettier-ignore

    // --- MEM: everything that is not a load rides PAST the memory, one bypass per slot ---------
    // Replicated after dumping a trace: two non-memory instructions really do sit in `MEM.0`/`MEM.1`
    // and bypass together. Unlabelled by necessity — the value was computed while the instruction
    // was in EX a cycle ago, so no event in THIS trace holds it.
    { id: L('exmem-memwb'), ends: ['exmem', 'memwb'], points: [bar('exmem', 'r', lane === 0 ? 200 : 640), bar('memwb', 'l', lane === 0 ? 200 : 640)], lane }, // prettier-ignore

    // --- WB: this lane's write port, and the bus home to the shared register file --------------
    { id: L('memwb-wbmux-val'), ends: ['memwb', wbmux], points: [bar('memwb', 'r', at(wbmux, 'l', -24)[1]), at(wbmux, 'l', -24)], lane }, // prettier-ignore
    { id: L('memwb-wbmux-mdr'), ends: ['memwb', wbmux], points: [bar('memwb', 'r', at(wbmux, 'l', 24)[1]), at(wbmux, 'l', 24)], lane }, // prettier-ignore
    { id: L('wbmux-regfile'), ends: [wbmux, 'regfile'], points: [at(wbmux, 'r'), [1200 + lane * 12, at(wbmux, 'r')[1]], [1200 + lane * 12, RAIL.wb[lane]!], [ID_CH[2 + lane]!, RAIL.wb[lane]!], [ID_CH[2 + lane]!, regWriteY], at('regfile', 'l', lane === 0 ? 48 : 62)], lane }, // prettier-ignore
    { id: L('memwb-regfile'), ends: ['memwb', 'regfile'], points: [bar('memwb', 'r', at(wbmux, 'l', 24)[1]), [1188 + lane * 12, at(wbmux, 'l', 24)[1]], [1188 + lane * 12, RAIL.wb[lane]!], [ID_CH[2 + lane]!, RAIL.wb[lane]!], [ID_CH[2 + lane]!, regWriteY], at('regfile', 'l', lane === 0 ? 48 : 62)], lane, contracts: wbmux }, // prettier-ignore
  ];
}

const WIRE_LIST: readonly DatapathWire[] = [...SHARED_WIRES, ...LANES.flatMap(laneWires)];

export const WIRES: readonly DatapathWire[] = WIRE_LIST;

const WIRE_BY_ID: ReadonlyMap<string, DatapathWire> = new Map(WIRE_LIST.map((w) => [w.id, w]));

// --- Depth tiers × config -------------------------------------------------------------------

/** True when an element requiring `minTier` (absent ⇒ `essentials`) is drawn at `current`. */
export function tierVisible(minTier: DepthTier | undefined, current: DepthTier): boolean {
  return DEPTH_TIERS.indexOf(minTier ?? 'essentials') <= DEPTH_TIERS.indexOf(current);
}

/**
 * The engine BEHAVIORS the diagram's structure depends on — deliberately not the config's values.
 *
 * `forwarding` and `issueWidth` are already behaviors, so they pass through. `predictTaken` is
 * where the difference bites: `ProcessorConfig.branchPrediction` has three NAMES and the machine has
 * two BEHAVIORS (`'none'` and `'static-not-taken'` are one machine — a processor with no predictor
 * does not wait, it keeps fetching, and the fall-through IS the not-taken path). Geometry cannot be
 * drawn from a name that does not decide anything, so the shell collapses that knob once, at its
 * edge, and hands the diagram the fact: does this machine bet?
 */
export interface DatapathConfig {
  readonly forwarding: boolean;
  readonly predictTaken: boolean;
  /** 1 or 2 — the third structural axis, and the only one that adds hardware rather than removing
   *  detail. `ProcessorConfig.issueWidth` is optional (`?: number`) for every pre-M7 model, so the
   *  shell resolves it to 1 before it reaches here. */
  readonly issueWidth: number;
}

/** Whether a node is drawn, on ALL THREE axes: deep enough a tier, on the right side of whichever
 *  config gate it sets, and inside a machine wide enough to contain it. */
export function nodeVisibleAt(node: DatapathNode, tier: DepthTier, cfg: DatapathConfig): boolean {
  if (!tierVisible(node.minTier, tier)) return false;
  if (node.forwardingOnly && !cfg.forwarding) return false;
  if (node.predictTakenOnly && !cfg.predictTaken) return false;
  if (requiredWidth(node) > cfg.issueWidth) return false;
  return true;
}

/**
 * Whether a wire is drawn at (`tier`, `cfg`): deep enough a tier, on the right side of every config
 * gate, NOT superseded by the unit it contracts, and with both endpoint nodes drawn — so no wire
 * ever dangles into a hidden unit (INV-5).
 *
 * The contraction rule is the load-bearing one and it is DERIVED rather than declared: a
 * contraction stands in for its unit exactly when that unit is not drawn. That now covers THREE
 * axes at once without a second hand-maintained field having to agree with this one.
 */
export function wireVisibleAt(wire: DatapathWire, tier: DepthTier, cfg: DatapathConfig): boolean {
  if (!tierVisible(wire.minTier, tier)) return false;
  if (wire.forwardingOnly && !cfg.forwarding) return false;
  if (wire.predictTakenOnly && !cfg.predictTaken) return false;
  if (requiredWidth(wire) > cfg.issueWidth) return false;
  if (wire.contracts && nodeVisibleAt(NODES.get(wire.contracts)!, tier, cfg)) return false;
  return wire.ends.every((id) => nodeVisibleAt(NODES.get(id)!, tier, cfg));
}

/** Whether active wires carry their value labels at `tier` (everything except `essentials`). */
export function showValueLabels(tier: DepthTier): boolean {
  return tier !== 'essentials';
}

/** Whether units show their control-line label at `tier` (`expert` only). */
export function showControlLabels(tier: DepthTier): boolean {
  return tier === 'expert';
}

// --- Activation -------------------------------------------------------------------------------

/** How a value should be rendered on a wire label. */
export type Fmt = 'hex' | 'dec';

/** A lit wire. A cycle lights wires for up to TEN different instructions, so each one says who lit
 *  it, from which stage (the hue), and in which issue slot (the lane it was drawn for). */
export interface WireActivation {
  /** The stable id (INV-4) of the instruction whose work this wire is doing. */
  readonly instr: string;
  /** The stage that instruction is in — which is what picks the wire's hue. */
  readonly stage: Stage;
  /** The issue slot that instruction occupies this cycle. Equal to the wire's `lane` for every
   *  replicated wire; on a SHARED wire it names whichever slot's instruction happens to be using
   *  the shared unit (the one data memory, the one bet adder). */
  readonly slot: number;
  /** The value flowing, when THIS cycle's events know it. Absent is honest: a value riding a latch
   *  between stages was emitted in an earlier cycle and is not in this trace (see the file docs). */
  readonly value?: number;
  readonly fmt: Fmt;
}

/** The pairing verdict this cycle, when the issue unit refused someone. */
export interface Refusal {
  /** `mem-port` / `branch-slot` / `intra-pair-raw` — the three pairing reasons. */
  readonly reason: string;
  /** The instruction that was refused, and so leads the next issue group. */
  readonly instr: string;
}

export interface DatapathActivation {
  /** Which instruction occupies each `"<stage>.<slot>"` this cycle — from `instructions[].location`,
   *  the only source that describes THIS cycle (see the file docs on `micro`). Up to ten entries. */
  readonly occupancy: ReadonlyMap<string, string>;
  /** Ids of components on an active path this cycle. Deliberately a plain set, with no instruction
   *  attached: a component can be busy for TWO instructions at once — the register file is read by
   *  both lanes' ID and written by both lanes' WB in one cycle, and every latch bar is written by
   *  the stage on its left while the stage on its right reads it. The WIRES carry the attribution. */
  readonly components: ReadonlySet<string>;
  /** Active wire id → who lit it, from where, in which slot, and with what value. */
  readonly wires: ReadonlyMap<string, WireActivation>;
  /** The registers the writeback ports target this cycle — up to one per lane. */
  readonly writtenRegs: readonly number[];
  /** The pairing refusal this cycle, or `null`. Step 8's readout names this; the datapath uses it
   *  to light the issue unit, which is the drawn CAUSE of the "one lane lit, one dark" picture. */
  readonly refusal: Refusal | null;
}

const EMPTY: DatapathActivation = {
  occupancy: new Map(),
  components: new Set(),
  wires: new Map(),
  writtenRegs: [],
  refusal: null,
};

const LOADS = new Set(['lb', 'lh', 'lw', 'lbu', 'lhu']);
const STORES = new Set(['sb', 'sh', 'sw']);
/** The classes whose writeback value comes from the dedicated pc/immediate adder rather than the
 *  ALU — they emit no `alu-op` at all (the engine mirrors the reference's event set). */
const PCARITH_PRODUCERS = new Set(['lui', 'auipc', 'jal', 'jalr']);
/**
 * The three PAIRING refusals, which the issue unit answers — as distinct from `load-use` / `raw`,
 * which are the ordinary older-stage hazards the separate hazard unit answers. Both ride
 * `stall.reason` (the schema types it as a free-form string, so the three cost no schema change),
 * and this set is the only thing that tells the two units apart. It matches `issueVerdict`'s three
 * pairing rules exactly; a reason missing here would silently light the hazard unit instead.
 */
export const PAIRING_REASONS: ReadonlySet<string> = new Set([
  'mem-port',
  'branch-slot',
  'intra-pair-raw',
]);

/**
 * Derive which datapath components/wires are active THIS cycle, for EVERY instruction in flight,
 * and the value on each. Multi-instruction AND multi-lane: each `"<stage>.<slot>"`'s occupant comes
 * from `instructions[].location` and its values from this cycle's `events` filtered by that
 * instruction's id — never from `state.micro`, which is a cycle ahead (see the file docs).
 *
 * Both the expert through-mux wires AND their contraction wires are lit, at every width and in
 * every config (activation is tier-, config- and WIDTH-oblivious, INV-2); the view filters. A
 * width-1 trace simply never has a `.1` occupant, so lane 1 lights nothing of its own accord —
 * which is why the width axis needs no special case here. Returns an empty activation for the
 * pre-run state.
 */
export function activate(trace: CycleTrace | null): DatapathActivation {
  if (!trace) return EMPTY;

  const occupancy = new Map<string, string>();
  /** `stage → slot → occupant`. */
  const byStage = new Map<Stage, (InstructionInstance | undefined)[]>();
  for (const inst of trace.instructions) {
    const loc = parseLocation(inst.location);
    if (!loc) continue;
    const slots = byStage.get(loc.stage) ?? new Array<InstructionInstance | undefined>(MAX_WIDTH);
    // One instruction per (stage, slot); first wins, defensively — the engine guarantees it.
    if (slots[loc.slot] === undefined) {
      slots[loc.slot] = inst;
      occupancy.set(inst.location, inst.id);
    }
    byStage.set(loc.stage, slots);
  }
  if (byStage.size === 0) return EMPTY;

  const components = new Set<string>();
  const wires = new Map<string, WireActivation>();
  const writtenRegs: number[] = [];

  const occupant = (stage: Stage, slot: number): InstructionInstance | undefined =>
    byStage.get(stage)?.[slot];

  const c = (id: string): void => void components.add(id);
  /** Light a wire for `inst`'s work in `stage`/`slot`, and (as every model here does) light both
   *  its endpoints — which is what makes the coherence litmus hold by construction rather than by
   *  vigilance. */
  const w = (
    id: string,
    stage: Stage,
    slot: number,
    inst: InstructionInstance,
    value: number | undefined,
    fmt: Fmt,
  ): void => {
    const wire = WIRE_BY_ID.get(id);
    if (!wire) throw new Error(`activate: unknown wire id "${id}"`);
    wires.set(id, { instr: inst.id, stage, slot, value, fmt });
    for (const end of wire.ends) c(end);
  };
  /** This cycle's events belonging to one instruction. `flush` carries no `instr` and is excluded. */
  const eventsFor = (inst: InstructionInstance): readonly TaggedEvent[] =>
    trace.events.filter((e): e is TaggedEvent => 'instr' in e && e.instr === inst.id);

  // --- IF: one pc addresses the memory; a PAIR of words comes back --------------------------
  // The address is the OLDEST occupant's pc — the pair is fetched from `pc` and `pc + 4`, so there
  // is one address and the second word is implied by it. `inst.pc`/`inst.encoding` rather than the
  // `instr-fetch` event: an instruction HELD in IF by a refusal was fetched in an earlier cycle and
  // emits no event now, but the pc it presents is unchanged — which is what a hold IS.
  const ifSlots = byStage.get('IF') ?? [];
  const ifOldest = ifSlots.find((i) => i !== undefined);
  if (ifOldest) {
    // Only the memory's address wire carries the pc as a LABEL, though all three carry it as a
    // value: labelling each printed the identical 32-bit hex three times in the tightest band of
    // the diagram (M3's browser finding, inherited).
    w('pcmux-pc', 'IF', 0, ifOldest, undefined, 'hex');
    w('pc-imem', 'IF', 0, ifOldest, ifOldest.pc, 'hex');
    w('pc-addn', 'IF', 0, ifOldest, undefined, 'hex');
    // The sequential next pc — `+4` PER INSTRUCTION FETCHED, so it is derived from the YOUNGEST
    // occupant's pc rather than a constant. This is the one place the label would be wrong if the
    // adder were drawn as a fixed `+8`: on a cycle where only one slot was free, the machine really
    // did advance by 4.
    let last = ifOldest.pc;
    for (const inst of ifSlots) if (inst) last = Math.max(last, inst.pc);
    w('addn-pcmux', 'IF', 0, ifOldest, (last + 4) >>> 0, 'hex');
    // One fetch wire per slot — the pair, drawn as a pair.
    for (const lane of LANES) {
      const inst = ifSlots[lane];
      if (inst) w(laneId('imem-ifid', lane), 'IF', lane, inst, inst.encoding, 'hex');
    }
  }

  // --- ID: decode both candidates, read four register ports, issue or refuse ------------------
  // The ISSUE unit and the HAZARD unit are told apart by the stall's REASON, which is the only
  // thing that distinguishes them in the trace — and it is enough, because `issueVerdict` checks
  // the three pairing rules and `detectHazard` the two ordinary ones, with no overlap between the
  // reason sets. At most ONE stall fires per cycle (a refusal ends the issue group), so this is a
  // single verdict rather than a per-lane one; the test suite pins that rather than assuming it.
  const stall = trace.events.find((e) => e.type === 'stall');
  let refusal: Refusal | null = null;
  if (stall?.type === 'stall') {
    const refused = trace.instructions.find((i) => i.id === stall.instr);
    const refusedSlot = refused ? (parseLocation(refused.location)?.slot ?? 0) : 0;
    if (refused) {
      if (PAIRING_REASONS.has(stall.reason)) {
        // The pairing verdict — the drawn CAUSE of a single-issue cycle. Lit only when it actually
        // refused someone: it is combinational and always deciding, but "lit" means "on the active
        // path this cycle" in every model here, and a permanently-lit issue unit would say nothing
        // about WHEN pairing fails, which is the entire pedagogical point of the box.
        refusal = { reason: stall.reason, instr: stall.instr };
        c('issue');
        w('ifid-issue', 'ID', refusedSlot, refused, undefined, 'dec');
        w('issue-ifid', 'ID', refusedSlot, refused, undefined, 'dec');
        w('issue-pc', 'ID', refusedSlot, refused, undefined, 'dec');
      } else {
        // An ordinary older-stage hazard — `load-use` with forwarding on, `raw` with it off. Its
        // answer is to hold the PC and the IF/ID latch: the repeated `IF IF` of the textbook.
        c('hazard');
        w('ifid-hazard', 'ID', refusedSlot, refused, undefined, 'dec');
        w('idex-hazard', 'ID', refusedSlot, refused, undefined, 'dec');
        w('hazard-ifid', 'ID', refusedSlot, refused, undefined, 'dec');
        w('hazard-pc', 'ID', refusedSlot, refused, undefined, 'dec');
      }
    }
  }

  for (const lane of LANES) {
    const idInst = occupant('ID', lane);
    if (!idInst) continue;
    const d = idInst.decoded;
    const events = eventsFor(idInst);
    // The encoding is labelled once, at the fetch that produced it — re-printing it on ID's input
    // wires says nothing new (decoding is what ID DOES to it) and costs 32-bit hex boxes beside the
    // IF/ID bar, where there is no clear y for them to escape to.
    w(laneId('ifid-regfile', lane), 'ID', lane, idInst, undefined, 'hex');
    const usesImm =
      d.format !== 'R' && d.mnemonic !== 'ecall' && d.mnemonic !== 'ebreak' && d.mnemonic !== 'fence'; // prettier-ignore
    if (usesImm) {
      w(laneId('ifid-signext', lane), 'ID', lane, idInst, undefined, 'hex');
      w(laneId('signext-idex', lane), 'ID', lane, idInst, d.imm, 'dec');
    }
    const regReads = events.filter((e) => e.type === 'reg-read');
    if (regReads[0])
      w(laneId('regfile-idex-a', lane), 'ID', lane, idInst, regReads[0].value, 'dec');
    if (regReads[1])
      w(laneId('regfile-idex-b', lane), 'ID', lane, idInst, regReads[1].value, 'dec');
    // The BET — drawn from `branch-predicted`, the event that IS the redirect, and never from the
    // `flush` it usually raises alongside: a branch at the end of `.text` bets on every pass with
    // the fetch pointer already out of text, killing nobody and emitting no flush while still
    // steering the pc. Reading the flush would draw the bet's COST and call it the ACTION.
    const bet = events.find((e) => e.type === 'branch-predicted');
    if (bet?.type === 'branch-predicted') {
      c('btarget');
      w('ifid-btarget', 'ID', lane, idInst, undefined, 'hex');
      w(laneId('signext-btarget', lane), 'ID', lane, idInst, undefined, 'dec');
      // Only the REDIRECT is labelled, and it is the one value the trace can honestly supply: the
      // immediate is already printed on this lane's `signext-idex`, and re-deriving `pc + imm` in a
      // view would put ISA arithmetic in the renderer (INV-3/INV-7).
      w('btarget-pcmux', 'ID', lane, idInst, bet.target, 'hex');
    }
  }

  // --- EX: two lanes forward, compute, and resolve at most ONE control transfer ---------------
  for (const lane of LANES) {
    const exInst = occupant('EX', lane);
    if (!exInst) continue;
    const d = exInst.decoded;
    const events = eventsFor(exInst);
    const aluOp = events.find((e) => e.type === 'alu-op');
    const forwards = events.filter((e) => e.type === 'forward');
    const resolved = events.find((e) => e.type === 'branch-resolved');
    const alu = laneId('alu', lane);
    const pcarith = laneId('pcarith', lane);

    if (aluOp?.type === 'alu-op') {
      c(alu);
      // Each operand's source is picked by its forwarding mux — so exactly ONE input path lights
      // per port. Lighting the register-file path as well when a forward fires would draw the stale
      // value flowing into the ALU beside the fresh one, which is the precise misconception this
      // tier exists to break: forwarding is a change of PATH, not an extra wire.
      //
      // The SOURCE is the latch BAR, never a slot of it: `forward.from` is `'EX/MEM'` / `'MEM/WB'`
      // and the trace does not say which slot the value came out of. Drawing a slot would be a
      // coin-flip rendered as hardware.
      const port = (to: string, side: 'a' | 'b', value: number): void => {
        const muxWire = laneId(`idex-fwdmux${side}`, lane);
        const contraction = laneId(`idex-alu-${side}`, lane);
        const fwd = forwards.find((e) => e.type === 'forward' && e.to === to);
        if (fwd?.type === 'forward') {
          const from = fwd.from === 'EX/MEM' ? 'exmem' : 'memwb';
          w(laneId(`${from}-fwdmux${side}`, lane), 'EX', lane, exInst, fwd.value, 'dec');
          w(laneId(`${from}-alu-${side}`, lane), 'EX', lane, exInst, fwd.value, 'dec');
        } else {
          w(muxWire, 'EX', lane, exInst, value, 'dec');
          w(contraction, 'EX', lane, exInst, value, 'dec');
        }
        w(laneId(`fwdmux${side}-alu`, lane), 'EX', lane, exInst, value, 'dec');
      };
      // `to` is BARE (`'EX.rs1'`, not `'EX.0.rs1'`) — the slot encoding was deliberately confined to
      // `location` (pinned M7 step 2a, re-decided at 2b), so the consumer is identified by `instr`.
      port('EX.rs1', 'a', aluOp.a);
      port('EX.rs2', 'b', aluOp.b);

      const addrLike = LOADS.has(d.mnemonic) || STORES.has(d.mnemonic) || d.mnemonic === 'jalr';
      w(laneId('alu-exmem', lane), 'EX', lane, exInst, aluOp.result, addrLike ? 'hex' : 'dec');
    }
    // The forwarding UNIT is lit by the comparison it made, whether or not it selected a forward —
    // but only when there is something in this lane for it to have compared.
    if (aluOp || forwards.length > 0) {
      c(laneId('fwdunit', lane));
      w(laneId('idex-fwdunit', lane), 'EX', lane, exInst, undefined, 'dec');
      w(laneId('exmem-fwdunit', lane), 'EX', lane, exInst, undefined, 'dec');
      w(laneId('memwb-fwdunit', lane), 'EX', lane, exInst, undefined, 'dec');
    }
    // The dedicated pc/immediate adder: the link value (`jal`/`jalr`), `auipc`'s pc+imm, `lui`'s
    // pass-through, and every pc-relative target. Its INPUTS are labelled from the trace; its
    // output is not — the writeback value is not emitted until WB, cycles later, and inventing it
    // here would mean re-deriving ISA arithmetic in a view (INV-3/INV-7).
    const pcRelTransfer = resolved?.type === 'branch-resolved' && d.mnemonic !== 'jalr';
    if (PCARITH_PRODUCERS.has(d.mnemonic) || pcRelTransfer) {
      c(pcarith);
      w(laneId('idex-pcarith-pc', lane), 'EX', lane, exInst, exInst.pc, 'hex');
      w(laneId('idex-pcarith-imm', lane), 'EX', lane, exInst, d.imm, 'dec');
      if (PCARITH_PRODUCERS.has(d.mnemonic))
        w(laneId('pcarith-exmem', lane), 'EX', lane, exInst, undefined, 'hex');
    }
    // The EX CORRECTION. It fires exactly when the prediction was WRONG, which is NOT the same as
    // "the branch was taken": a correctly predicted taken branch redirects nothing (ID's bet
    // already steered fetch a cycle earlier), and a LOST bet redirects back to the fall-through.
    //
    // `actual` comes back as the LABEL condition, which is a different question — a TAKEN
    // correction carries `pc + imm`, precisely the two operands drawn into this lane's pc adder, so
    // the label is explained by the picture. A lost bet's correction carries `pc + 4`, and
    // labelling THAT as the adder's output would draw an adder fed `0` and `8` emitting `4` on the
    // canvas. So it lights bare there (INV-5: omit, never contradict).
    if (resolved?.type === 'branch-resolved' && resolved.predicted !== resolved.actual) {
      const redirect = d.mnemonic === 'jalr' ? laneId('alu-pcmux', lane) : laneId('pcarith-pcmux', lane); // prettier-ignore
      w(redirect, 'EX', lane, exInst, resolved.actual ? resolved.target : undefined, 'hex');
    }
    c('idex');
    c('exmem');
  }

  // --- MEM: ONE data memory (the mem-port rule), but two bypass paths -------------------------
  for (const lane of LANES) {
    const memInst = occupant('MEM', lane);
    if (!memInst) continue;
    const events = eventsFor(memInst);
    const memRead = events.find((e) => e.type === 'mem-read');
    const memWrite = events.find((e) => e.type === 'mem-write');
    const addr =
      memRead?.type === 'mem-read'
        ? memRead.addr
        : memWrite?.type === 'mem-write'
          ? memWrite.addr
          : undefined;
    if (memRead || memWrite) {
      c('dmem');
      w('exmem-dmem-addr', 'MEM', lane, memInst, addr, 'hex');
    }
    if (memRead?.type === 'mem-read') w('dmem-memwb', 'MEM', lane, memInst, memRead.value, 'hex');
    if (memWrite?.type === 'mem-write')
      w('exmem-dmem-data', 'MEM', lane, memInst, memWrite.value, 'dec');
    // Everything that is not a load carries its value straight past the memory, on its OWN slot's
    // bypass — two of them can be lit at once, which is why this wire is replicated.
    if (!memRead) w(laneId('exmem-memwb', lane), 'MEM', lane, memInst, undefined, 'dec');
    c('exmem');
    c('memwb');
  }

  // --- WB: two write ports into the one register file ----------------------------------------
  for (const lane of LANES) {
    const wbInst = occupant('WB', lane);
    if (!wbInst) continue;
    const events = eventsFor(wbInst);
    const regWrite = events.find((e) => e.type === 'reg-write');
    c('memwb');
    if (regWrite?.type === 'reg-write') {
      writtenRegs.push(regWrite.reg);
      const d = wbInst.decoded;
      const isLoad = LOADS.has(d.mnemonic);
      const ptrLike = isLoad || d.mnemonic === 'jal' || d.mnemonic === 'jalr' || d.mnemonic === 'auipc'; // prettier-ignore
      const fmt: Fmt = ptrLike ? 'hex' : 'dec';
      // Provenance, preserved through the contraction: a load's datum comes off the MDR path and
      // everything else off the computed-value path. The `essentials` stand-in collapses only the
      // mux — same source (MEM/WB), same sink (the register file).
      w(laneId(isLoad ? 'memwb-wbmux-mdr' : 'memwb-wbmux-val', lane), 'WB', lane, wbInst, regWrite.value, fmt); // prettier-ignore
      w(laneId('wbmux-regfile', lane), 'WB', lane, wbInst, regWrite.value, fmt);
      w(laneId('memwb-regfile', lane), 'WB', lane, wbInst, regWrite.value, fmt);
    }
  }

  return { occupancy, components, wires, writtenRegs, refusal };
}

/** The trace events that name an instruction — everything except `flush`, which reports stages. */
type TaggedEvent = Extract<CycleTrace['events'][number], { instr: string }>;
