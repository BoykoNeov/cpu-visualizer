/**
 * The CDC 6600-style scoreboard (M15) behind the {@link Processor} interface (§6): the SEVENTH
 * microarchitecture, and the only one that completes **out of program order without a reorder
 * buffer**. `IF ID RO EX|MEM WB`, where `ID` **is** Issue and `WB` **is** Write-Result.
 *
 * The ISA semantics — the arithmetic, the `s`/`u` signed/unsigned views, `imm & 0x1f`, the `>>> 0`
 * at the memory boundary — are mirrored VERBATIM from the golden reference (they are identical in
 * every model; re-deriving them is how the classic traps creep back). We do NOT import the
 * reference at runtime — we copy the idioms, and the INV-8 differential proves the copy faithful
 * (step 2). What is genuinely new here, and what the hand-written unit tests pin, is the SCHEDULING:
 * the three status tables, the two hazards renaming deletes, and a stall that fires at the END of an
 * instruction's life.
 *
 * ## The machine (plan decisions 2, 2b, 4, 7)
 *
 * Three functional units — `INT0`, `INT1` (one cycle each, reporting stage `EX`) and one blocking
 * `MEM` (multi-cycle, reporting stage `MEM`). Two integer units and not one: with a single integer
 * unit a WAR stall is **unreachable**, because the only multi-cycle latency here is memory, so the
 * instruction parked at Read Operands is always waiting on a load that owns the memory port while
 * the waiter owns the only integer unit — leaving no unit for the younger writer that WAR needs
 * (`docs/plans/m15-tasks.md` step 1-PRE).
 *
 * **Read Operands is PER-FU and non-blocking**: an instruction leaves Issue *into its functional
 * unit* and waits there. Only Issue is shared, in order, and blocking. A shared in-order `RO` would
 * make WAR unreachable for the same structural reason and delete half the milestone's subject.
 *
 * **Functional-unit latencies are intrinsic to the model, not a config knob** — the multi-cycle
 * model's precedent that its per-instruction cycle counts are "this model's definition, not a
 * setting". The shell's `slowOpLatency` has no UI control anywhere and is reset to 1 on every
 * free-play load, so a machine whose only latency source was that knob would never reorder at all
 * until a lesson milestone authored one. See {@link MEM_LATENCY} for how the number was chosen.
 *
 * ## How one cycle runs
 *
 * Stages are walked in REVERSE — `WB → EX/MEM → RO → ID(Issue) → IF` — the discipline every prior
 * model uses. Here it is doing something specific: it reproduces the textbook scoreboard's
 * one-step-per-cycle cadence with no explicit "not before cycle N+1" bookkeeping anywhere.
 *
 * | Textbook rule                              | What makes it true here                        |
 * | ------------------------------------------ | ---------------------------------------------- |
 * | Issue in N ⇒ Read Operands in N+1 at best  | RO is walked BEFORE Issue                      |
 * | Read Operands in N ⇒ Execute begins N+1    | EX is walked BEFORE RO                         |
 * | Execute ends in N ⇒ Write Result in N+1    | WB is walked BEFORE EX                         |
 * | Write Result in N ⇒ the FU issues at N+1   | **every WB effect lands at the CLOCK EDGE**    |
 *
 * Only the last row needs help, and it is the one the reverse walk alone would get wrong: WB runs
 * first, so freeing the unit, writing the register, clearing `Result[]` and waking waiters would all
 * be visible to RO and Issue *in the same cycle*. They are collected during WB and applied at the
 * end of `step()` instead — before the snapshot, so this cycle's trace shows the new value, and
 * after every other stage, so nobody consumed it a cycle early. (Hennessy & Patterson's worked
 * example is the oracle: `LD F6` issues 1 / reads 2 / executes 3 / writes 4, and the second `LD` —
 * which wants the same unit — issues at **5**, not 4.)
 *
 * Memory effects are the deliberate exception: a store mutates memory during its final `MEM` cycle
 * rather than at the edge. Nothing can observe it early, because the single blocking memory unit
 * makes every memory access strictly ordered — which is also why this model needs none of M9's
 * disambiguation machinery.
 *
 * ## Control flow: Issue stops dead at an unresolved transfer
 *
 * Decision 3 pins no predictor. That leaves a hole the plan did not price, and closing it is
 * **forced by INV-8, not chosen**: with `RO` non-blocking there is nothing to stop a younger
 * instruction reaching Write-Result while an older branch is still parked waiting for an operand —
 * and with no reorder buffer, a write that has landed cannot be taken back. Witness:
 * `lw x1, 0(x5)` / `beq x1, x0, L` / `addi x4, x0, 7`, where the `addi` writes back four cycles
 * before the branch even knows its own answer.
 *
 * So **Issue does not proceed while an unresolved control transfer is in flight**, which is the
 * historically honest behaviour anyway (the 6600 had no speculation) and is what makes decision 3's
 * "a taken branch simply flushes the front end" literally true: with Issue held, the front end is
 * the `IF` slot and nothing else. The cost is a new stall reason, `'control'` — see
 * {@link ScoreboardStallReason}.
 *
 * ## Architectural `pc` under out-of-order write-back
 *
 * > **`pc` advances across the completed program-order PREFIX — never "whoever wrote last".**
 *
 * Every prior model can define `pc` as the retiring instruction's `nextPc` because retirement is in
 * order. This is the first model where it is not: a younger integer op routinely write-results
 * before an older load, so "whoever wrote last" would make `pc` move BACKWARD mid-run — visible in
 * every recorded snapshot (step 4) and checkable against the reference only at the very end, where
 * it happens to come out right. {@link ScoreboardProcessor.retireQueue} keeps the issue-order list
 * and `pc` advances only while its head has written its result.
 *
 * Determinism (INV-1) and obliviousness to rendering/depth tiers (INV-2) hold exactly as in every
 * earlier model. See `docs/plans/m15-tasks.md`.
 */

import { decode, defForMnemonic, type DecodedInstruction } from '@cpu-viz/isa';
import {
  defaultConfig,
  makeRegisters,
  SparseMemory,
  type CycleTrace,
  type InstructionInstance,
  type MachineState,
  type Processor,
  type ProcessorCapabilities,
  type ProcessorConfig,
  type ProgramImage,
  type TraceEvent,
} from '@cpu-viz/trace';

/**
 * The stage vocabulary an instruction's `location` is drawn from — and **it is the STAGE
 * vocabulary, never the functional-unit one**. `pipeline-map.ts` hues by stage FAMILY, and
 * `PHASE_COLORS` holds exactly `IF ID EX MEM WB`, so five of these six already carry a validated
 * phase hue and only `RO` falls back to the neutral accent. Reporting `INT0`/`INT1` here instead
 * would mint a brand-new `INT` family and quietly break the plan's falsifiable "`pipeline-map.ts`
 * needs no edit" criterion. Unit identity lives in the status tables, where it belongs.
 */
export type Stage = 'IF' | 'ID' | 'RO' | 'EX' | 'MEM' | 'WB';

/** The three functional units (plan decision 4, as amended at step 1-PRE). */
export const FU_NAMES = ['INT0', 'INT1', 'MEM'] as const;
export type FuName = (typeof FU_NAMES)[number];

/** The two integer units, in the fixed order Issue tries them — determinism (INV-1). */
const INT_UNITS = ['INT0', 'INT1'] as const;

/**
 * Integer functional-unit latency, in `EX` cycles. RV32I has no multi-cycle arithmetic, so this is
 * the honest floor and there is nothing to choose.
 */
export const INT_LATENCY = 1;

/**
 * Memory functional-unit latency, in `MEM` cycles — **the one intrinsic number this model chooses,
 * so the derivation is written down rather than left in a test.**
 *
 * With Write-Result at `RO + 1 + latency`, a load and the independent instructions behind it write
 * back at:
 *
 * | instruction (issued back to back) | write-result cycle |
 * | --------------------------------- | ------------------ |
 * | `lw`  (IF 1, ID 2, RO 3)          | `4 + L`            |
 * | 1st independent int op behind it  | 6                  |
 * | 2nd independent int op behind it  | 7                  |
 *
 * `L = 2` puts the load at 6 — a TIE with the first integer op, so nothing is provably reordered.
 * `L = 3` puts it at 7, which beats the first by one cycle and ties the second: a one-cycle photo
 * finish that a skew of two collapses again, on the milestone's own acceptance criterion ("two
 * instructions provably write back out of program order"). **`L = 4` puts the load at 8, clear of
 * both** — margins of 2 and 1 — and two integer units is exactly how many can be in flight beside
 * a load, so it is clear of every reachable skew rather than of the one that was measured.
 *
 * The same choice is what makes the two hazards legible rather than marginal: the WAW witness gets
 * six consecutive `'waw'` stall cycles at Issue, and the WAR witness three `'war'` cycles at
 * Write-Result. Step 3 hand-derives every timing coefficient from this constant.
 */
export const MEM_LATENCY = 4;

/**
 * The scoreboard's stall vocabulary. `'waw'`, `'war'`, `'operand'` and the two `'structural-*'`
 * reasons are plan decision 6; the two departures from the seeded list are recorded here because a
 * reason string is a trace-contract surface (INV-3) that lessons anchor to (INV-6).
 *
 * - **`'structural'` is SPLIT by unit class.** Decision 4's amendment to three units made the
 *   unsplit string actively misleading: a reader would see "structural" while an integer unit sat
 *   visibly free in the unit-status table, because it was the memory port that was busy.
 * - **`'control'` is new** (step 1). Issue must not pass an unresolved transfer on a machine with
 *   no reorder buffer — see the file header. Reusing `'structural'` would claim a unit was
 *   exhausted when none is, and emitting nothing would leave the machine visibly stopped with
 *   nothing in the trace to say why.
 *
 * Never `'raw'`: that string is pinned repo-wide to mean "forwarding is off", and this machine has
 * no forwarding at all. An instruction waiting on a producer stalls with `'operand'`.
 *
 * **Cadence, which is a contract and not an implementation detail** (step 3 asserts a stall-reason
 * MULTISET, so the count is load-bearing): exactly one `stall` event per stalled instruction per
 * cycle it is stalled. An instruction held three cycles at Issue emits three.
 */
export type ScoreboardStallReason =
  | 'waw'
  | 'war'
  | 'operand'
  | 'structural-int'
  | 'structural-mem'
  | 'control';

/**
 * One row of the **instruction status** table — the first of the scoreboard's three classic
 * pictures. Each cell is the cycle that step completed in, or `null` if it has not happened yet.
 *
 * Bounded to what is in flight (plus whatever wrote its result THIS cycle, so a completion is
 * visible in the cycle it happens). Keeping every dynamic instruction would make `micro` O(n) per
 * cycle and the recorder O(n²) on a loop program.
 */
export interface InstructionStatusRow {
  /** The stable id (INV-4) — the same id from fetch to write-result. */
  readonly instr: string;
  readonly pc: number;
  readonly mnemonic: string;
  /** Which functional unit it occupies, or `null` while it is still in `IF`. */
  readonly unit: FuName | null;
  readonly issue: number | null;
  readonly readOperands: number | null;
  /** The cycle EXECUTION COMPLETED (not the cycle it began) — the textbook column. */
  readonly executeComplete: number | null;
  readonly writeResult: number | null;
}

/**
 * One row of the **functional-unit status** table, in the textbook's own field names: `Fi` is the
 * destination, `Fj`/`Fk` the sources, `Qj`/`Qk` the units that will produce them, and `Rj`/`Rk` the
 * flags that say a source is READY AND NOT YET READ.
 *
 * `Rj`/`Rk` carry the whole WAR check, and their exact meaning is what makes this machine
 * deadlock-free: an operand still waiting on a producer has `R = false`, so a unit can never block
 * the very write it is waiting for.
 */
export interface FuStatusRow {
  readonly name: FuName;
  readonly busy: boolean;
  /** The occupying instruction's mnemonic, or `null` when idle. */
  readonly op: string | null;
  /** The occupying instruction's stable id, or `null` when idle. */
  readonly instr: string | null;
  /** Destination register, or `null` when the instruction writes none (stores, branches, x0). */
  readonly fi: number | null;
  readonly fj: number | null;
  readonly fk: number | null;
  readonly qj: FuName | null;
  readonly qk: FuName | null;
  readonly rj: boolean;
  readonly rk: boolean;
  /** Execution cycles remaining, or `null` unless the unit is executing. */
  readonly remaining: number | null;
}

/**
 * The scoreboard's `MachineState.micro` (the §5 per-model extension point): the three classic
 * status tables, which ARE the picture every textbook prints and which step 7's view draws.
 *
 * Every field is a fresh, independent per-cycle snapshot — the same requirement registers and
 * memory make. The recorder keeps every cycle, so a table that aliased the live scoreboard would
 * show latest-values-everywhere at every cursor position, and no step-1 test could see it (they
 * only ever inspect the current cycle).
 */
export interface ScoreboardMicro {
  readonly instructions: readonly InstructionStatusRow[];
  readonly units: readonly FuStatusRow[];
  /** Register-result status: 32 entries, the unit that will write each register or `null`. */
  readonly registerResult: readonly (FuName | null)[];
}

/**
 * The scoreboard is pipelined and hazard-bearing, and honors **none** of the config cluster.
 *
 * `configurableForwarding: false` is not an omission — this machine has no bypass network at all,
 * so the knob is INERT and its trace is byte-identical either way (the M4/M7 inertness contract,
 * asserted in `processor.test.ts`). `configurableOutOfOrder: false` is honest for the same reason
 * decision 5 gives: the flag gates a whole cluster (`outOfOrderIssue`, `robSize`, `slowOpLatency`)
 * that means nothing on a machine with no reorder buffer and no reservation stations.
 */
export const SCOREBOARD_CAPABILITIES: ProcessorCapabilities = {
  model: 'scoreboard',
  pipelined: true,
  hasHazards: true,
  configurableForwarding: false,
  configurableBranchPrediction: false,
  configurableCache: false,
  configurableIssueWidth: false,
  configurableOutOfOrder: false,
};

const LOADS = new Set(['lb', 'lh', 'lw', 'lbu', 'lhu']);
const STORES = new Set(['sb', 'sh', 'sw']);
const TRANSFERS = new Set(['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'jal', 'jalr']);

const WRITES_RD = new Set([
  ...LOADS,
  'lui',
  'auipc',
  'jal',
  'jalr',
  'addi',
  'slti',
  'sltiu',
  'xori',
  'ori',
  'andi',
  'slli',
  'srli',
  'srai',
  'add',
  'sub',
  'sll',
  'slt',
  'sltu',
  'xor',
  'srl',
  'sra',
  'or',
  'and',
]);

/**
 * The architectural destination, or 0 for "writes nothing" — mirrors every model's `destReg`.
 *
 * x0 and "writes nothing" deliberately coincide, and here that identity is load-bearing twice
 * over: an instruction with `fi === 0` claims no `Result[]` entry, so it takes no WAW check and is
 * never the subject of a WAR check. A phantom `Result[0]` claim would manufacture WAW stalls that
 * INV-8 cannot see at all (they are pure timing), so it would pass step 2 clean and surface only as
 * wrong step-3 coefficients.
 */
function destReg(d: DecodedInstruction): number {
  return WRITES_RD.has(d.mnemonic) ? d.rd : 0;
}

interface SourceRegs {
  readonly rs1: number | null;
  readonly rs2: number | null;
}

function sourceRegs(d: DecodedInstruction): SourceRegs {
  const kind = defForMnemonic(d.mnemonic)?.kind;
  if (kind === 'system' || kind === 'fence') return { rs1: null, rs2: null };
  switch (d.format) {
    case 'R':
    case 'S':
    case 'B':
      return { rs1: d.rs1, rs2: d.rs2 };
    case 'I':
      return { rs1: d.rs1, rs2: null };
    default:
      return { rs1: null, rs2: null };
  }
}

/** Does this instruction need the single memory unit? */
function usesMemPort(d: DecodedInstruction): boolean {
  return LOADS.has(d.mnemonic) || STORES.has(d.mnemonic);
}

function isTransfer(d: DecodedInstruction): boolean {
  return TRANSFERS.has(d.mnemonic);
}

function isArchHalt(d: DecodedInstruction): boolean {
  return (
    d.mnemonic === 'ecall' || d.mnemonic === 'ebreak' || defForMnemonic(d.mnemonic) === undefined
  );
}

/** An instruction fetched but not yet issued — the `IF` slot's occupant, at most one. */
interface Fetched {
  readonly id: string;
  readonly pc: number;
  readonly word: number;
  readonly decoded: DecodedInstruction;
}

/**
 * One instruction from Issue to Write-Result: the functional unit's contents plus the scoreboard
 * bookkeeping the tables render. Mutable by design — the per-cycle `micro` snapshot copies it.
 */
interface Slot {
  readonly id: string;
  readonly pc: number;
  readonly word: number;
  readonly decoded: DecodedInstruction;
  readonly fu: FuName;
  /**
   * `waiting` — issued, operands not yet read (this is `RO`, and it is per-unit and non-blocking).
   * `executing` — in `EX`/`MEM`, counting down. `writing` — execution complete, at `WB`, subject to
   * the WAR check. `done` — its result has landed.
   */
  state: 'waiting' | 'executing' | 'writing' | 'done';
  /** Destination register; 0 means "writes nothing" (see {@link destReg}). */
  readonly fi: number;
  readonly fj: number | null;
  readonly fk: number | null;
  qj: FuName | null;
  qk: FuName | null;
  rj: boolean;
  rk: boolean;
  /** Operand values, latched at Read Operands. */
  a: number | null;
  b: number | null;
  remaining: number;
  /** The value destined for `fi`, computed at the end of execution; `null` writes nothing. */
  writeValue: number | null;
  /** Where `pc` goes when this instruction takes the head of the retire queue. */
  nextPc: number;
  /** Architectural halt (`ecall`/`ebreak`/unrecognized): `pc` does not advance. */
  readonly halt: boolean;
  /** Has this control transfer resolved? Always `true` for a non-transfer. */
  resolved: boolean;
  /** Where it is THIS cycle, for `InstructionInstance.location`. */
  location: Stage;
  /** Instruction-status table columns. */
  issueCycle: number | null;
  readCycle: number | null;
  executeCycle: number | null;
  writeCycle: number | null;
  /** The cycle it reached `done`, so it still appears in that cycle's trace and no later one. */
  doneCycle: number | null;
}

/** Everything one cycle's stages share. */
interface CycleCtx {
  events: TraceEvent[];
  /** Whoever the redirect killed in `IF`, so the cycle's trace can still name the casualty. */
  flushed: Fetched | null;
  /** Did anything at all advance? A cycle with no progress is a deadlock, not a stall. */
  progress: boolean;
}

/** A Write-Result effect, held until the clock edge (see the file header's cadence table). */
interface Writeback {
  readonly slot: Slot;
}

export class ScoreboardProcessor implements Processor {
  readonly capabilities = SCOREBOARD_CAPABILITIES;

  private registers = makeRegisters();
  private memory = new SparseMemory();
  /** Architectural pc — the completed program-order PREFIX, never the fetch pointer. */
  private archPc = 0;
  private fetchPc = 0;
  private entry = 0;
  private textEnd = 0;
  private halted = true; // nothing loaded yet
  private cycle = -1; // first step() produces cycle 0
  private seq = 0; // dynamic-instruction counter → stable ids (INV-4)
  private sourceMap: ReadonlyMap<number, number> = new Map();

  private ifSlot: Fetched | null = null;
  private haltFetch = false;

  private units: Record<FuName, Slot | null> = { INT0: null, INT1: null, MEM: null };
  /** Register-result status: which unit will write each architectural register. */
  private result: (FuName | null)[] = new Array<FuName | null>(32).fill(null);
  /**
   * Every issued instruction that has not yet advanced the architectural `pc`, in ISSUE order.
   * Issue is in order, so this list is program order — and it is the only in-order structure in the
   * machine. It is NOT a reorder buffer: it holds no values and can undo nothing (that is the whole
   * distinction from M9). It exists so `pc` can advance across the completed prefix rather than
   * jumping to whoever wrote last. See the file header.
   */
  private retireQueue: Slot[] = [];

  private lastMicro: ScoreboardMicro = emptyMicro();

  reset(image: ProgramImage, config: ProcessorConfig = defaultConfig()): void {
    // REFUSED knobs (plan decision 5), the `deep-pipeline` precedent: a knob this machine cannot
    // honor is louder as a throw than as a silent lie. The shell narrows both in `engineConfigFor`
    // (step 5) so a click can never reach here.
    if (config.cache !== null && config.cache !== undefined) {
      throw new Error(
        'scoreboard: this model has no cache — its single blocking memory unit IS its memory ' +
          'timing (plan decision 7). Clamp `cache` to null in engineConfigFor.',
      );
    }
    if (config.issueWidth !== undefined && config.issueWidth !== 1) {
      throw new Error(
        `scoreboard: issueWidth ${config.issueWidth} is not supported — Issue is one instruction ` +
          'per cycle, in order, by definition of this machine (plan decision 5).',
      );
    }

    this.registers = makeRegisters();
    this.memory = new SparseMemory();
    // Text loaded little-endian from entry; then initialized data. One flat space (§9).
    for (let i = 0; i < image.words.length; i++) {
      this.memory.writeWord((image.entry + i * 4) >>> 0, image.words[i]!);
    }
    for (const segment of image.data) {
      this.memory.loadBytes(segment.addr, segment.bytes);
    }
    this.sourceMap = image.sourceMap;
    this.entry = image.entry >>> 0;
    this.archPc = this.entry;
    this.fetchPc = this.entry;
    this.textEnd = (image.entry + image.words.length * 4) >>> 0;
    this.cycle = -1;
    this.seq = 0;
    this.ifSlot = null;
    this.haltFetch = false;
    this.units = { INT0: null, INT1: null, MEM: null };
    this.result = new Array<FuName | null>(32).fill(null);
    this.retireQueue = [];
    this.lastMicro = emptyMicro();
    // An empty image (or one whose entry is already past text) is halted from the start.
    this.halted = !this.inText(this.fetchPc);
  }

  isHalted(): boolean {
    return this.halted;
  }

  getState(): MachineState {
    return this.snapshotState(this.lastMicro);
  }

  step(): CycleTrace {
    if (this.halted) {
      throw new Error('step() called on a halted processor — check isHalted() first');
    }
    this.cycle += 1;

    const ctx: CycleCtx = { events: [], flushed: null, progress: false };

    // Everything in flight at the START of the cycle, in issue order. Whatever ISSUES during the
    // cycle is picked up afterwards from the tail of the queue.
    const liveAtStart = this.retireQueue.filter((s) => s.doneCycle === null);

    // REVERSE walk. See the file header's cadence table for what each ordering buys.
    const writebacks = this.stageWriteResult(ctx);
    this.stageExecute(ctx);
    this.stageReadOperands(ctx);
    this.stageIssue(ctx);
    this.stageFetch(ctx);

    // ---- the clock edge: every Write-Result effect lands here, and not one stage earlier ----
    for (const { slot } of writebacks) {
      if (slot.fi !== 0 && slot.writeValue !== null) {
        this.registers[slot.fi] = slot.writeValue;
      }
      if (slot.fi !== 0 && this.result[slot.fi] === slot.fu) this.result[slot.fi] = null;
      // Wake every unit waiting on THIS unit. A waiter's `Qj`/`Qk` names the unit, and a unit stays
      // busy until it writes, so the name can never have been recycled underneath the waiter.
      for (const name of FU_NAMES) {
        const u = this.units[name];
        if (u === null || u === slot) continue;
        if (u.qj === slot.fu) {
          u.qj = null;
          u.rj = true;
        }
        if (u.qk === slot.fu) {
          u.qk = null;
          u.rk = true;
        }
      }
      this.units[slot.fu] = null;
    }

    // `pc` advances across the completed program-order prefix — never "whoever wrote last".
    while (this.retireQueue.length > 0 && this.retireQueue[0]!.state === 'done') {
      const head = this.retireQueue.shift()!;
      if (head.halt) {
        // Architectural halt/trap: pc does NOT advance (final pc = the halting instruction's pc),
        // matching the reference. Nothing younger can be in flight — Issue is in order and stopped
        // fetching the moment this instruction issued.
        this.archPc = head.pc;
        this.halted = true;
      } else {
        this.archPc = head.nextPc;
      }
    }

    // Ran off the end of text: halt once the machine has DRAINED, not when fetch stops. `add.s`
    // has no `ecall` at all and ends with instructions still in their units.
    if (
      !this.halted &&
      this.retireQueue.length === 0 &&
      this.ifSlot === null &&
      this.fetchStopped()
    ) {
      this.halted = true;
    }

    if (this.halted && (this.ifSlot !== null || this.retireQueue.length > 0)) {
      throw new Error(
        `scoreboard: halted at cycle ${this.cycle} with instructions still in flight — the machine did not drain`,
      );
    }

    // A cycle that changed nothing would repeat forever: the machine is pure and deterministic
    // (INV-1), so with no input to wait for, "no stage advanced" IS the deadlock. Blocking Issue,
    // WAR holds and three units make this a real bug class, and a loud throw beats conformance's
    // 100k-step cap, which reports only that something took too long.
    if (!ctx.progress && !this.halted) {
      throw new Error(
        `scoreboard: cycle ${this.cycle} advanced nothing — deadlock. Units: ` +
          FU_NAMES.map((n) => `${n}=${this.units[n]?.decoded.mnemonic ?? 'idle'}`).join(' '),
      );
    }

    const reported = this.inFlightThisCycle(liveAtStart);
    const micro = this.snapshotMicro(reported);
    this.lastMicro = micro;

    const instructions: InstructionInstance[] = [];
    for (const s of reported) {
      instructions.push(this.toInstance(s.id, s.pc, s.word, s.decoded, s.location));
    }
    // The IF occupant — held over from last cycle, or freshly fetched — and, if a taken transfer
    // redirected this cycle, the instruction it killed there (the flush contract's casualty).
    for (const f of [ctx.flushed, this.ifSlot]) {
      if (f !== null) instructions.push(this.toInstance(f.id, f.pc, f.word, f.decoded, 'IF'));
    }

    return {
      cycle: this.cycle,
      state: this.snapshotState(micro),
      events: ctx.events,
      instructions,
    };
  }

  // -------------------------------------------------------------------------------------------
  // WRITE RESULT — the WAR check, and the only stall in the product that fires at the END of an
  // instruction's life. Walked FIRST so its effects can be deferred to the clock edge as one
  // batch; see the file header.
  // -------------------------------------------------------------------------------------------

  private stageWriteResult(ctx: CycleCtx): Writeback[] {
    const done: Writeback[] = [];
    for (const name of FU_NAMES) {
      const slot = this.units[name];
      if (slot === null || slot.state !== 'writing') continue;
      slot.location = 'WB';

      if (this.warBlocked(slot)) {
        // Some OLDER instruction still holds an unread copy of the register this one writes. Hold
        // the whole unit — there is nowhere else to put the value.
        ctx.events.push({ type: 'stall', reason: 'war', stage: 'WB', instr: slot.id });
        continue;
      }

      if (slot.fi !== 0 && slot.writeValue !== null) {
        ctx.events.push({
          type: 'reg-write',
          reg: slot.fi,
          value: slot.writeValue,
          instr: slot.id,
        });
      }
      ctx.events.push({ type: 'instr-retire', instr: slot.id });
      slot.state = 'done';
      slot.writeCycle = this.cycle;
      slot.doneCycle = this.cycle;
      done.push({ slot });
      ctx.progress = true;
    }
    return done;
  }

  /**
   * The textbook WAR condition: some OTHER unit names this unit's destination as a source it has
   * READ NOTHING FROM YET (`R` still set). `R` is false for an operand still waiting on a producer,
   * which is exactly what stops a unit blocking the write it is itself waiting for — and is why
   * this machine cannot deadlock.
   *
   * Vacuous for anything that writes no register (stores, branches, `ecall`, and any `x0`
   * destination): `fi === 0` is checked first, so those units simply free themselves.
   */
  private warBlocked(slot: Slot): boolean {
    if (slot.fi === 0) return false;
    for (const name of FU_NAMES) {
      const other = this.units[name];
      if (other === null || other === slot) continue;
      if (other.rj && other.fj === slot.fi) return true;
      if (other.rk && other.fk === slot.fi) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------------------------
  // EXECUTE — `EX` on an integer unit, `MEM` on the memory unit. Out of order, by construction:
  // nothing here consults program order at all.
  // -------------------------------------------------------------------------------------------

  private stageExecute(ctx: CycleCtx): void {
    for (const name of FU_NAMES) {
      const slot = this.units[name];
      if (slot === null || slot.state !== 'executing') continue;
      slot.location = name === 'MEM' ? 'MEM' : 'EX';
      slot.remaining -= 1;
      ctx.progress = true;
      if (slot.remaining > 0) continue;

      this.executeSlot(ctx, slot);
      slot.state = 'writing';
      slot.executeCycle = this.cycle;
    }
  }

  // -------------------------------------------------------------------------------------------
  // READ OPERANDS — PER-UNIT and NON-BLOCKING (plan decision 2b). An instruction that cannot read
  // holds its own unit and nothing else; a younger instruction in another unit sails past it, and
  // that is the whole reason WAR is reachable on this machine.
  // -------------------------------------------------------------------------------------------

  private stageReadOperands(ctx: CycleCtx): void {
    for (const name of FU_NAMES) {
      const slot = this.units[name];
      if (slot === null || slot.state !== 'waiting') continue;
      slot.location = 'RO';

      if (!slot.rj || !slot.rk) {
        ctx.events.push({ type: 'stall', reason: 'operand', stage: 'RO', instr: slot.id });
        continue;
      }

      // Both sources are read in the SAME step — that atomicity is what `Rj`/`Rk` encode, and it is
      // what makes the WAR window ("read nothing yet") a single well-defined interval.
      if (slot.fj !== null) {
        slot.a = this.registers[slot.fj]!;
        ctx.events.push({ type: 'reg-read', reg: slot.fj, value: slot.a, instr: slot.id });
      }
      if (slot.fk !== null) {
        slot.b = this.registers[slot.fk]!;
        ctx.events.push({ type: 'reg-read', reg: slot.fk, value: slot.b, instr: slot.id });
      }
      slot.rj = false;
      slot.rk = false;
      slot.state = 'executing';
      slot.remaining = slot.fu === 'MEM' ? MEM_LATENCY : INT_LATENCY;
      slot.readCycle = this.cycle;
      ctx.progress = true;
    }
  }

  // -------------------------------------------------------------------------------------------
  // ISSUE — in order, one per cycle, BLOCKING. The scoreboard's small window is exactly this: an
  // instruction that cannot issue stops every younger one behind it.
  // -------------------------------------------------------------------------------------------

  private stageIssue(ctx: CycleCtx): void {
    const fetched = this.ifSlot;
    if (fetched === null) return;

    const d = fetched.decoded;
    const reason = this.issueBlocker(d);
    if (reason !== null) {
      ctx.events.push({ type: 'stall', reason, stage: 'ID', instr: fetched.id });
      return;
    }

    const fu = this.freeUnitFor(d)!;
    const fi = destReg(d);
    const { rs1, rs2 } = sourceRegs(d);
    // Read the register-result table ONCE per source. `Qj`/`Rj` are two views of the same lookup —
    // "who will write it" and "is anybody going to" — and they must not be able to disagree, since
    // `Rj` set on a register somebody is still producing would let a unit read a stale value and
    // would also make it a spurious WAR blocker. Nothing mutates `result[]` between the two reads
    // today; hoisting means nothing added to this literal later can.
    const producerJ = this.producerOf(rs1);
    const producerK = this.producerOf(rs2);
    const slot: Slot = {
      id: fetched.id,
      pc: fetched.pc,
      word: fetched.word,
      decoded: d,
      fu,
      state: 'waiting',
      fi,
      fj: rs1,
      fk: rs2,
      qj: producerJ,
      qk: producerK,
      // "Ready and not yet read" — an absent source is ready by definition, and so is one no
      // in-flight instruction has claimed. `x0` is never claimed, so it is always ready.
      rj: producerJ === null,
      rk: producerK === null,
      a: null,
      b: null,
      remaining: 0,
      writeValue: null,
      nextPc: (fetched.pc + 4) >>> 0,
      halt: isArchHalt(d),
      resolved: !isTransfer(d),
      location: 'ID',
      issueCycle: this.cycle,
      readCycle: null,
      executeCycle: null,
      writeCycle: null,
      doneCycle: null,
    };

    this.units[fu] = slot;
    if (fi !== 0) this.result[fi] = fu;
    this.retireQueue.push(slot);
    this.ifSlot = null;
    // An architectural halt stops the front end the moment it issues. Issue is in order and one
    // instruction wide, so nothing younger has entered the machine — and IF is walked after this,
    // so nothing younger enters this cycle either.
    if (slot.halt) this.haltFetch = true;
    ctx.progress = true;
  }

  /**
   * Why this instruction cannot issue, or `null` if it can. The order of the tests is the order
   * they are reported in, outermost constraint first: the front end is held by control before any
   * question about units is even asked, and a unit must exist before its destination is worth
   * checking.
   */
  private issueBlocker(d: DecodedInstruction): ScoreboardStallReason | null {
    // No speculation and no reorder buffer: nothing may issue past a transfer that has not
    // answered. See the file header — this is forced by INV-8, not chosen.
    //
    // The scan covers the WHOLE queue, including entries that have already written their result and
    // are only still here because an older instruction has not yet advanced `pc`. That cannot wedge
    // issue: `resolved` starts `true` for everything except a transfer, and `executeSlot` sets it
    // before a transfer can leave `'executing'` — so nothing reaches `'done'` unresolved.
    if (this.retireQueue.some((s) => !s.resolved)) return 'control';
    if (this.freeUnitFor(d) === null) return usesMemPort(d) ? 'structural-mem' : 'structural-int';
    // WAW: an in-flight instruction already owns this destination. `fi === 0` claims nothing, so
    // stores, branches and `x0` writers never reach this test.
    const fi = destReg(d);
    if (fi !== 0 && this.result[fi] !== null) return 'waw';
    return null;
  }

  /** The in-flight unit that will write `reg`, or `null` — including for an absent source. */
  private producerOf(reg: number | null): FuName | null {
    return reg === null ? null : (this.result[reg] ?? null);
  }

  /** The free unit of the class this instruction needs, or `null` if that class is exhausted. */
  private freeUnitFor(d: DecodedInstruction): FuName | null {
    if (usesMemPort(d)) return this.units.MEM === null ? 'MEM' : null;
    for (const name of INT_UNITS) {
      if (this.units[name] === null) return name;
    }
    return null;
  }

  // -------------------------------------------------------------------------------------------
  // FETCH — one instruction per cycle into a one-deep slot. Walked last, so a redirect raised by a
  // transfer resolving at `EX` this cycle steers this very fetch (the pipeline model's rule).
  // -------------------------------------------------------------------------------------------

  private stageFetch(ctx: CycleCtx): void {
    if (this.ifSlot !== null) return; // Issue did not take the occupant: the slot holds
    if (this.fetchStopped()) return;

    const pc = this.fetchPc;
    const word = this.memory.readWord(pc) >>> 0;
    const id = `i${this.seq++}`;
    this.ifSlot = { id, pc, word, decoded: decode(word) };
    this.fetchPc = (pc + 4) >>> 0;
    ctx.events.push({ type: 'instr-fetch', instr: id, pc, encoding: word });
    ctx.progress = true;
  }

  private fetchStopped(): boolean {
    return this.haltFetch || !this.inText(this.fetchPc);
  }

  // -------------------------------------------------------------------------------------------
  // The ISA, mirrored VERBATIM from the golden reference. Runs once, on the LAST execution cycle,
  // from the operands latched at Read Operands — never from the live register file, which by then
  // may already hold a younger instruction's value.
  // -------------------------------------------------------------------------------------------

  private executeSlot(ctx: CycleCtx, slot: Slot): void {
    const d = slot.decoded;
    const { imm, mnemonic } = d;
    const shamt = imm & 0x1f;
    const aVal = slot.a ?? 0;
    const bVal = slot.b ?? 0;

    const sa = (): number => aVal;
    const ua = (): number => aVal >>> 0;
    const sb = (): number => bVal;
    const ub = (): number => bVal >>> 0;

    let nextPc = (slot.pc + 4) >>> 0;
    let taken: boolean | null = null;

    const alu = (op: string, a: number, b: number, resultValue: number): number => {
      ctx.events.push({
        type: 'alu-op',
        op,
        a: a | 0,
        b: b | 0,
        result: resultValue | 0,
        instr: slot.id,
      });
      return resultValue | 0;
    };
    const produce = (value: number): void => {
      slot.writeValue = value | 0;
    };
    const loadFrom = (addr: number, raw: number, extended: number): void => {
      ctx.events.push({ type: 'mem-read', addr, value: raw, instr: slot.id });
      produce(extended);
    };
    const storeTo = (addr: number, value: number, width: 1 | 2 | 4): void => {
      ctx.events.push({ type: 'mem-write', addr, value, instr: slot.id });
      // Applied here rather than at the clock edge, and safely: the single blocking memory unit
      // makes every memory access strictly ordered, so nothing can observe this early.
      if (width === 1) this.memory.writeByte(addr, value);
      else if (width === 2) this.memory.writeHalf(addr, value);
      else this.memory.writeWord(addr, value);
    };

    switch (mnemonic) {
      // --- U-type: imm already holds imm[31:12] in place (no extra shift) ---
      case 'lui':
        produce(imm);
        break;
      case 'auipc':
        produce(alu('add', slot.pc, imm, (slot.pc + imm) | 0));
        break;

      // --- Jumps: imm is a sign-extended, byte-scaled offset. The link `pc + 4` comes from the
      //     dedicated PC+4 incrementer, never the ALU. ---
      case 'jal':
        alu('add', slot.pc, imm, (slot.pc + imm) | 0);
        produce((slot.pc + 4) | 0);
        nextPc = (slot.pc + imm) >>> 0;
        taken = true;
        break;
      case 'jalr': {
        const sum = alu('add', sa(), imm, (sa() + imm) | 0);
        nextPc = (sum & ~1) >>> 0; // compute before writing rd (rd may == rs1)
        produce((slot.pc + 4) | 0);
        taken = true;
        break;
      }

      // --- Branches: signed vs unsigned compares; imm is the byte-scaled offset ---
      case 'beq':
        taken = sa() === sb();
        alu('beq', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (slot.pc + imm) >>> 0;
        break;
      case 'bne':
        taken = sa() !== sb();
        alu('bne', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (slot.pc + imm) >>> 0;
        break;
      case 'blt':
        taken = sa() < sb();
        alu('blt', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (slot.pc + imm) >>> 0;
        break;
      case 'bge':
        taken = sa() >= sb();
        alu('bge', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (slot.pc + imm) >>> 0;
        break;
      case 'bltu':
        taken = ua() < ub();
        alu('bltu', ua(), ub(), taken ? 1 : 0);
        if (taken) nextPc = (slot.pc + imm) >>> 0;
        break;
      case 'bgeu':
        taken = ua() >= ub();
        alu('bgeu', ua(), ub(), taken ? 1 : 0);
        if (taken) nextPc = (slot.pc + imm) >>> 0;
        break;

      // --- Loads: effective addr = rs1 + imm; lb/lh sign-extend, lbu/lhu zero-extend.
      //     `value` on mem-read is the raw access-width datum; the register gets `extended`. ---
      case 'lb': {
        const addr = alu('add', sa(), imm, (sa() + imm) >>> 0) >>> 0;
        const raw = this.memory.readByte(addr);
        loadFrom(addr, raw, (raw << 24) >> 24);
        break;
      }
      case 'lh': {
        const addr = alu('add', sa(), imm, (sa() + imm) >>> 0) >>> 0;
        const raw = this.memory.readHalf(addr);
        loadFrom(addr, raw, (raw << 16) >> 16);
        break;
      }
      case 'lw': {
        const addr = alu('add', sa(), imm, (sa() + imm) >>> 0) >>> 0;
        const raw = this.memory.readWord(addr);
        loadFrom(addr, raw, raw);
        break;
      }
      case 'lbu': {
        const addr = alu('add', sa(), imm, (sa() + imm) >>> 0) >>> 0;
        const raw = this.memory.readByte(addr);
        loadFrom(addr, raw, raw);
        break;
      }
      case 'lhu': {
        const addr = alu('add', sa(), imm, (sa() + imm) >>> 0) >>> 0;
        const raw = this.memory.readHalf(addr);
        loadFrom(addr, raw, raw);
        break;
      }

      // --- Stores: low byte/half/word of rs2 to rs1 + imm ---
      case 'sb': {
        const addr = alu('add', sa(), imm, (sa() + imm) >>> 0) >>> 0;
        storeTo(addr, sb() & 0xff, 1);
        break;
      }
      case 'sh': {
        const addr = alu('add', sa(), imm, (sa() + imm) >>> 0) >>> 0;
        storeTo(addr, sb() & 0xffff, 2);
        break;
      }
      case 'sw': {
        const addr = alu('add', sa(), imm, (sa() + imm) >>> 0) >>> 0;
        storeTo(addr, sb(), 4);
        break;
      }

      // --- I-type ALU ---
      case 'addi':
        produce(alu('add', sa(), imm, (sa() + imm) | 0));
        break;
      case 'slti':
        produce(alu('slt', sa(), imm, sa() < imm ? 1 : 0));
        break;
      case 'sltiu':
        produce(alu('sltu', ua(), imm >>> 0, ua() < imm >>> 0 ? 1 : 0));
        break;
      case 'xori':
        produce(alu('xor', sa(), imm, sa() ^ imm));
        break;
      case 'ori':
        produce(alu('or', sa(), imm, sa() | imm));
        break;
      case 'andi':
        produce(alu('and', sa(), imm, sa() & imm));
        break;
      case 'slli':
        produce(alu('sll', sa(), shamt, sa() << shamt));
        break;
      case 'srli':
        produce(alu('srl', ua(), shamt, ua() >>> shamt));
        break;
      case 'srai':
        produce(alu('sra', sa(), shamt, sa() >> shamt));
        break;

      // --- R-type ALU (shift amount = low 5 bits of rs2) ---
      case 'add':
        produce(alu('add', sa(), sb(), (sa() + sb()) | 0));
        break;
      case 'sub':
        produce(alu('sub', sa(), sb(), (sa() - sb()) | 0));
        break;
      case 'sll':
        produce(alu('sll', sa(), sb() & 0x1f, sa() << (sb() & 0x1f)));
        break;
      case 'slt':
        produce(alu('slt', sa(), sb(), sa() < sb() ? 1 : 0));
        break;
      case 'sltu':
        produce(alu('sltu', ua(), ub(), ua() < ub() ? 1 : 0));
        break;
      case 'xor':
        produce(alu('xor', sa(), sb(), sa() ^ sb()));
        break;
      case 'srl':
        produce(alu('srl', ua(), sb() & 0x1f, ua() >>> (sb() & 0x1f)));
        break;
      case 'sra':
        produce(alu('sra', sa(), sb() & 0x1f, sa() >> (sb() & 0x1f)));
        break;
      case 'or':
        produce(alu('or', sa(), sb(), sa() | sb()));
        break;
      case 'and':
        produce(alu('and', sa(), sb(), sa() & sb()));
        break;

      // --- System / ordering. `fence` is a no-op (single-threaded, in-order memory); `ecall`,
      //     `ebreak` and any unrecognized word halt, which `slot.halt` already carries. ---
      default:
        break;
    }

    slot.nextPc = nextPc;

    if (taken !== null) {
      // No predictor (plan decision 3), so `predicted` is always false: this machine performs no
      // action at a branch beyond stopping, and the fall-through IS the not-taken path.
      ctx.events.push({
        type: 'branch-resolved',
        instr: slot.id,
        predicted: false,
        actual: taken,
        target: nextPc,
      });
      if (taken) {
        this.fetchPc = nextPc;
        // The front end is the IF slot and nothing else, because Issue has been held since this
        // transfer issued. Report the flush only when it actually killed something (the schema's
        // flush contract) — a transfer at the end of `.text` redirects with an empty slot.
        if (this.ifSlot !== null) {
          ctx.events.push({ type: 'flush', reason: 'branch-taken', stages: ['IF'] });
          ctx.flushed = this.ifSlot;
          this.ifSlot = null;
        }
      }
    }
    // Whatever the answer, the front end may move again from this cycle on — Issue is walked after
    // Execute, so a not-taken branch releases the instruction already sitting in IF immediately.
    slot.resolved = true;
  }

  // -------------------------------------------------------------------------------------------
  // Snapshots. Everything below builds FRESH objects from primitives: the recorder keeps every
  // cycle, so a table aliasing the live scoreboard would read latest-values-everywhere at every
  // cursor position — and no step-1 test could see it, because they only inspect the current cycle.
  // -------------------------------------------------------------------------------------------

  private toInstance(
    id: string,
    pc: number,
    word: number,
    decoded: DecodedInstruction,
    location: Stage,
  ): InstructionInstance {
    return {
      id,
      pc,
      encoding: word,
      sourceLine: this.sourceMap.get(pc) ?? null,
      decoded,
      location,
    };
  }

  /**
   * Everything the cycle should REPORT, in program order: what was in flight when it began, plus
   * whatever issued during it — minus anything that wrote its result in an earlier cycle and is
   * only still queued because an older instruction has not yet advanced `pc`.
   */
  private inFlightThisCycle(liveAtStart: readonly Slot[]): Slot[] {
    const live = liveAtStart.filter((s) => s.doneCycle === null || s.doneCycle === this.cycle);
    const issuedNow = this.retireQueue.filter((s) => s.issueCycle === this.cycle);
    return [...live, ...issuedNow];
  }

  private snapshotMicro(reported: readonly Slot[]): ScoreboardMicro {
    const rows: InstructionStatusRow[] = reported.map((s) => ({
      instr: s.id,
      pc: s.pc,
      mnemonic: s.decoded.mnemonic,
      unit: s.fu,
      issue: s.issueCycle,
      readOperands: s.readCycle,
      executeComplete: s.executeCycle,
      writeResult: s.writeCycle,
    }));
    // ...and the `IF` occupant, which has no unit and no cycles of its own yet.
    const inIf = this.ifSlot;
    if (inIf !== null) {
      rows.push({
        instr: inIf.id,
        pc: inIf.pc,
        mnemonic: inIf.decoded.mnemonic,
        unit: null,
        issue: null,
        readOperands: null,
        executeComplete: null,
        writeResult: null,
      });
    }

    const units: FuStatusRow[] = FU_NAMES.map((name) => {
      const s = this.units[name];
      if (s === null) {
        return {
          name,
          busy: false,
          op: null,
          instr: null,
          fi: null,
          fj: null,
          fk: null,
          qj: null,
          qk: null,
          rj: false,
          rk: false,
          remaining: null,
        };
      }
      return {
        name,
        busy: true,
        op: s.decoded.mnemonic,
        instr: s.id,
        fi: s.fi === 0 ? null : s.fi,
        fj: s.fj,
        fk: s.fk,
        qj: s.qj,
        qk: s.qk,
        rj: s.rj,
        rk: s.rk,
        remaining: s.state === 'executing' ? s.remaining : null,
      };
    });

    return { instructions: rows, units, registerResult: [...this.result] };
  }

  /** Is `p` a fetchable text address (the loaded program range)? */
  private inText(p: number): boolean {
    return p >= this.entry && p < this.textEnd;
  }

  /** An independent full-state snapshot — what each CycleTrace carries (handoff §6). */
  private snapshotState(micro: ScoreboardMicro): MachineState {
    return {
      pc: this.archPc,
      registers: this.registers.slice(),
      memory: this.memory.snapshot(),
      halted: this.halted,
      micro,
    };
  }
}

/** The tables before the first cycle: nothing in flight, no unit busy, no register claimed. */
function emptyMicro(): ScoreboardMicro {
  return {
    instructions: [],
    units: FU_NAMES.map((name) => ({
      name,
      busy: false,
      op: null,
      instr: null,
      fi: null,
      fj: null,
      fk: null,
      qj: null,
      qk: null,
      rj: false,
      rk: false,
      remaining: null,
    })),
    registerResult: new Array<FuName | null>(32).fill(null),
  };
}
