/**
 * The classic 5-stage pipeline (roadmap §12.2) behind the {@link Processor} interface (§6): the
 * THIRD microarchitecture, and the first one with a microarchitecture worth the name. M1
 * (single-cycle) and M2 (multi-cycle) shared the defining simplification that exactly ONE
 * instruction is in flight at a time, so neither had hazards by construction. This model breaks
 * that: up to five instructions occupy IF/ID/EX/MEM/WB at once, they INTERACT, and the whole
 * milestone lives in how those interactions resolve — by forwarding, by stalling, or by flushing.
 *
 * The ISA semantics — the arithmetic, the `s`/`u` signed/unsigned views, `imm & 0x1f`, the
 * `>>> 0` at the memory boundary — are mirrored VERBATIM from the golden reference (they are
 * identical in every model; re-deriving them is how the classic traps creep back). We do NOT
 * import the reference at runtime — we copy the idioms, and the INV-8 differential test proves
 * the copy is faithful. What is genuinely new here, and what the hand-written unit tests pin, is
 * the SEQUENCING: the hazard unit, the forwarding network and its priority rule, the load-use
 * bubble, the control-flow flush, and halt-with-drain.
 *
 * ## How one cycle runs
 *
 * The four latches are DOUBLE-BUFFERED: every stage reads `prev` — the latch contents as of the
 * start of the cycle, i.e. the values a real machine's latches present before the clock edge —
 * and writes into a fresh `next`, which is committed at the end. That is what makes both forward
 * paths correct: EX reads `prev.exMem`/`prev.memWb`, the data held by the instructions currently
 * in MEM and WB, exactly the two inputs of P&H's forwarding mux.
 *
 * Stages are then walked in REVERSE (WB→MEM→EX→ID→IF). Because reads come from `prev`, that
 * order is NOT what makes the latch chain or the forwarding correct — it would hold in any order.
 * It is load-bearing for three other things, each of which would otherwise need a special case:
 *
 *  1. **The same-cycle WB→ID register read.** The register file is the one piece of state that is
 *     NOT double-buffered (it is architectural, not a latch), so WB running first means ID sees a
 *     value written back this very cycle — the pinned "write in the first half, read in the
 *     second" (P&H). A distance-3 RAW therefore needs no forward at all.
 *  2. **The order of `events[]` within a cycle** — WB's `reg-write` precedes ID's `reg-read`. That
 *     is a trace-contract surface (INV-3, and INV-6 anchors lessons to it), not an implementation
 *     detail. M1 and M2 never faced it: one instruction, one stage per cycle, so intra-cycle
 *     ordering did not exist. This is the first model where it does.
 *  3. **Control-signal propagation.** ID raises a stall and IF (later in the walk) holds; EX raises
 *     a flush and ID/IF (later in the walk) squash. Each signal's consumer runs after its producer,
 *     so no signal needs to be deferred a cycle or peeked at out of band.
 *
 * ## Halt with drain
 *
 * > **Architectural `pc` is the retiring instruction's `nextPc` — never the fetch pointer.**
 *
 * The fetch pointer is microarchitectural: it runs ahead of the retiring instruction and never
 * surfaces in `MachineState.pc`. Fetching stops for exactly two reasons — an architectural halt
 * (`ecall`/`ebreak`/unknown) decoded in ID, or the fetch pointer leaving `.text` — and NEITHER
 * halts the machine on the spot. The pipe drains and halts at the last retire, because halting
 * when fetch stops would truncate the run and throw away the results of everything still in
 * flight. `add.s` is the case that proves this is not optional polish: it has no `ecall` at all
 * and ends by running off the end of `.text` with three instructions still in the pipe.
 *
 * Determinism (INV-1) and obliviousness to rendering/depth tiers (INV-2) hold exactly as in the
 * earlier models. See `docs/plans/m3-tasks.md`.
 */

import { decode, defForMnemonic, type DecodedInstruction } from '@cpu-viz/isa';
import { speculativeTarget } from './predict';
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

/** The five pipeline stages. `InstructionInstance.location` is one of these, verbatim. */
export type Stage = 'IF' | 'ID' | 'EX' | 'MEM' | 'WB';

/**
 * IF/ID — a fetched word on its way to be decoded, and the base every later latch extends: `pc`
 * and `ir` ride the whole way down the pipe exactly as they do in hardware (P&H carries the pc
 * for the branch adder), each stage adding what it computed. `decoded` is a pure function of
 * `ir`, so carrying it is memoization rather than extra state — the engine emits full,
 * expert-complete state and lets the view decide what to show (INV-2).
 */
export interface IfIdLatch {
  /** The stable id (INV-4) of the instruction this latch holds — the same id from fetch to retire. */
  readonly instr: string;
  readonly pc: number;
  /** Instruction register: the fetched word. */
  readonly ir: number;
  readonly decoded: DecodedInstruction;
}

/** ID/EX — decoded, with its register-file reads latched. */
export interface IdExLatch extends IfIdLatch {
  /**
   * The architectural destination register, or `0` when the instruction writes none. x0 and
   * "writes nothing" deliberately coincide: a write to x0 is discarded, so one value says both,
   * and every hazard/forward test keying off `rd !== 0` gets "never forward from x0" for free.
   * This is NOT `decoded.rd` — for an S/B-format word those bits are part of the immediate.
   */
  readonly rd: number;
  /** `Reg[rs1]` as read from the register file at ID, PRE-forwarding; null if rs1 is no source. */
  readonly a: number | null;
  /** `Reg[rs2]` as read at ID, PRE-forwarding; null if rs2 is no source. */
  readonly b: number | null;
  /**
   * The BET ID placed on this instruction: did ID steer fetch to its target? (M4.) Always `false`
   * under `'none'`/`'static-not-taken'`, where fetch simply carries on — which is why those two
   * config values are one machine.
   *
   * **A boolean, deliberately, and not the predicted target.** EX never needs the address ID bet
   * on, because M4 step 0 PROVED the two agree: `speculativeTarget` equals EX's `nextPc` for every
   * taken PC-relative transfer, pinned over the corpus. So "we both say taken" already implies "we
   * both mean the same address", and carrying the target would be carrying a value whose only
   * possible use is a comparison that cannot fail. The step-0 safety property is exactly what buys
   * the minimal field — remove that proof and this would have to become a `number | null`.
   *
   * `jalr` needs no special case anywhere downstream: it is never predictable, so this is always
   * `false`, it is always taken, it therefore always mispredicts and always pays full price. The
   * `call-return.s` regression under `static-taken` falls out of that with no code that mentions it.
   */
  readonly predictedTaken: boolean;
}

/** EX/MEM — the ALU's answer on its way to memory. */
export interface ExMemLatch extends IfIdLatch {
  readonly rd: number;
  /** ALU result / effective address. Null for the classes that use no ALU (`lui`/`jal`/`auipc`). */
  readonly aluOut: number | null;
  /**
   * The value bound for `rd`, IF EX already knows it — and null for a LOAD, whose datum does not
   * exist until MEM has run. That null is not an omission: it is the load-use hazard itself. A
   * load sitting in MEM has only its ADDRESS in this latch, so there is nothing here to forward,
   * which is precisely why the load-use bubble survives forwarding.
   */
  readonly writeValue: number | null;
  /** `Reg[rs2]` after forwarding — the datum a store writes. Null unless this is a store. */
  readonly storeData: number | null;
  /** Where pc goes when this instruction retires (already branch-resolved). */
  readonly nextPc: number;
  /** An architectural halt (`ecall`/`ebreak`/unknown): pc does not advance past it. */
  readonly halt: boolean;
}

/** MEM/WB — the final value on its way to the register file. */
export interface MemWbLatch extends IfIdLatch {
  readonly rd: number;
  readonly aluOut: number | null;
  /** Memory data register: the raw, access-width load datum. Null unless this is a load. */
  readonly mdr: number | null;
  /** The value bound for `rd`, fully resolved — a load's datum has arrived by now. */
  readonly writeValue: number | null;
  readonly nextPc: number;
  readonly halt: boolean;
}

/**
 * The pipeline's `MachineState.micro` (the §5 per-model extension point): the four inter-stage
 * latches, which is what "5 stages, 4 latches" means concretely. `null` is a BUBBLE — a stage
 * with no instruction in it, which is what a stall inserts and a flush leaves behind.
 *
 * Every latch object is IMMUTABLE and rebuilt from scratch each cycle, never mutated in place.
 * That is what satisfies the same independent-per-cycle-snapshot requirement `registers`/`memory`
 * have: the recorder keeps every cycle, so a latch aliased across cycles would replay as
 * latest-values-everywhere. Final-state conformance cannot see that bug — only time-travel can.
 *
 * Deliberately four CONCRETE latches, not an N-latch abstraction: a deeper pipeline is a future
 * sibling package with its own `micro` type and its own bespoke geometry.
 */
export interface PipelineMicro {
  readonly ifId: IfIdLatch | null;
  readonly idEx: IdExLatch | null;
  readonly exMem: ExMemLatch | null;
  readonly memWb: MemWbLatch | null;
}

/**
 * The pipeline is the model whose behavior depends on its CONFIG — `forwarding` (M3) and now
 * `branchPrediction` (M4) both genuinely change the machine. Caches remain unmodeled: the other
 * half of §12.3, and a separate milestone, because they need array-walking programs before a
 * hit/miss means anything.
 *
 * **`configurableBranchPrediction: true` is a claim about two schemes, not three.** `'none'` and
 * `'static-not-taken'` are the SAME MACHINE here, and that coincidence is a finding rather than a
 * shortcut: a processor with no predictor does not stop and wait — it just keeps fetching the next
 * address, and **the fall-through IS the not-taken path**. "No prediction" and "predict not taken"
 * are one policy wearing two names. The alternative reading (`'none'` = stall until EX resolves)
 * would be a different, defensible machine — but it is not what "no predictor" means, and since
 * `'none'` is `defaultConfig()`, adopting it would silently redefine the default pipeline that M3
 * pinned. So the honored positions are: keep fetching (`'none'` = `'static-not-taken'`), or bet on
 * the target (`'static-taken'`).
 */
export const PIPELINE_CAPABILITIES: ProcessorCapabilities = {
  model: 'pipeline',
  pipelined: true,
  hasHazards: true,
  configurableForwarding: true,
  configurableBranchPrediction: true,
  configurableCache: false,
};

const LOADS = new Set(['lb', 'lh', 'lw', 'lbu', 'lhu']);
const STORES = new Set(['sb', 'sh', 'sw']);
// There is deliberately no BRANCHES set: "is this a control transfer" is not a separate
// classification here, it is whatever the EX switch resolved a `taken` answer for. That is what
// makes jal/jalr fall out as ordinary transfers rather than special cases.

/**
 * Every class that writes a register. Enumerated rather than derived from the format, because
 * `decoded.rd` is meaningless for S/B words (those bits carry the immediate) — trusting it there
 * would invent a destination out of an offset and hand the hazard unit a phantom dependency.
 */
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

/** The architectural destination, or 0 for "writes nothing" (see {@link IdExLatch.rd}). */
function destReg(d: DecodedInstruction): number {
  return WRITES_RD.has(d.mnemonic) ? d.rd : 0;
}

/** Which registers an instruction READS, or null per port when it reads none there. */
interface SourceRegs {
  readonly rs1: number | null;
  readonly rs2: number | null;
}

/**
 * The source-register predicate — mirrors EXACTLY the reads the golden reference performs, which
 * is what makes it safe for the hazard unit to key off. Every stall, every forward, and every
 * x0 exclusion is decided from this, so a class listed here that the reference does not actually
 * read from would stall on a dependency that does not exist (invisible to INV-8, which only sees
 * final state), and one missing would forward nothing where a forward was needed.
 */
function sourceRegs(d: DecodedInstruction): SourceRegs {
  const kind = defForMnemonic(d.mnemonic)?.kind;
  // The operand-less I-ENCODED ops: ecall/ebreak/fence have no register operands at all.
  if (kind === 'system' || kind === 'fence') return { rs1: null, rs2: null };
  switch (d.format) {
    case 'R':
    case 'S':
    case 'B':
      return { rs1: d.rs1, rs2: d.rs2 };
    case 'I':
      return { rs1: d.rs1, rs2: null };
    default:
      // U (lui/auipc) and J (jal) read no source registers; nor does an unrecognized word.
      return { rs1: null, rs2: null };
  }
}

/** Loads are the one producer whose value is not ready at EX — the source of the load-use bubble. */
function isLoad(d: DecodedInstruction): boolean {
  return LOADS.has(d.mnemonic);
}

/**
 * Is this an architectural halt? `ecall`/`ebreak`, plus any word the decoder did not recognize —
 * `decode` never throws, so an unknown word arrives as `mnemonic: 'unknown'` and must halt loudly
 * rather than silently advance (mirrors the reference's `default:` arm). ONE predicate, used by
 * both ID (to stop fetching) and EX (to latch `halt`), so the two can never disagree.
 */
function isArchHalt(d: DecodedInstruction): boolean {
  return (
    d.mnemonic === 'ecall' || d.mnemonic === 'ebreak' || defForMnemonic(d.mnemonic) === undefined
  );
}

/** The four latches, double-buffered per cycle. */
interface Latches {
  ifId: IfIdLatch | null;
  idEx: IdExLatch | null;
  exMem: ExMemLatch | null;
  memWb: MemWbLatch | null;
}

const EMPTY_LATCHES = (): Latches => ({ ifId: null, idEx: null, exMem: null, memWb: null });

/**
 * An instruction sitting in the IF stage — fetched, but not yet latched into IF/ID. It is a
 * distinct thing from the IF/ID latch: five stages, four latches, so the IF stage's occupant has
 * nowhere to live but here. A stall is exactly the case where the two differ for a whole cycle.
 */
interface Fetched {
  readonly id: string;
  readonly pc: number;
  readonly word: number;
  readonly decoded: DecodedInstruction;
}

/** The IF stage's occupant, as it will be presented on the IF/ID latch at the clock edge. */
function toLatch(f: Fetched): IfIdLatch {
  return { instr: f.id, pc: f.pc, ir: f.word, decoded: f.decoded };
}

/** Why everything younger than the deciding stage is being killed this cycle. */
type Squash = 'branch' | 'halt';

/**
 * The `flush.reason` for an EX correction, named for what the machine LEARNED — which M4 forces to
 * be two answers where M3 only ever had one.
 *
 * M3 wrote `'branch-taken'` unconditionally, and it was true: predict-not-taken can only ever be
 * wrong about a branch that WAS taken, so "the prediction broke" and "the branch was taken" were
 * the same event. `static-taken` separates them — a bet on a branch that then declines corrects
 * with `actual === false`, and reporting `'branch-taken'` there would state the opposite of what
 * happened to a consumer that reads it (the pipeline map prints this string as the cause of death).
 *
 * So the vocabulary grows by exactly one word, and `'branch-taken'` keeps its old meaning rather
 * than being generalized to `'branch-mispredicted'`: every EX correction IS a misprediction, so
 * that name would say nothing a reader could act on, and it would move a string three test suites
 * and the map already pin. Each reason states the fact that killed you, and the direction is the
 * only fact that varies.
 */
function squashReason(inEx: IdExLatch | null): string {
  // `inEx` is the instruction that resolved this cycle: EX is the only stage that raises 'branch'.
  return inEx !== null && inEx.predictedTaken ? 'branch-not-taken' : 'branch-taken';
}

/** The mutable working set for one cycle: read `prev`, fill `next`, collect events and signals. */
interface CycleCtx {
  readonly prev: Latches;
  readonly next: Latches;
  readonly events: TraceEvent[];
  /** Raised by ID; read by IF, which then holds its instruction instead of handing it over. */
  stalled: boolean;
  /** Raised by EX (taken transfer) or ID (architectural halt); read by the stages younger than it. */
  squash: Squash | null;
  /**
   * A taken transfer's target, staged by EX and applied at the END of the cycle. The fetch pointer
   * is a clocked register just like the latches, so the redirect must NOT land mid-walk: IF runs
   * after EX and has to fetch the FALL-THROUGH instruction (which it then squashes), not the
   * target. Applying it early would fetch the target one cycle too early and erase one of the two
   * rows the flush is supposed to cut.
   */
  redirect: number | null;
  /**
   * Staged by ID, applied at the end of the cycle, for exactly the same reason: IF must still
   * fetch the ONE shadow instruction behind an `ecall` so the squash has something to kill —
   * `call-return.s` puts live code (`max:`) directly behind its `ecall`.
   */
  stopFetch: boolean;
  /**
   * The ID BET (M4): ID predicted a transfer taken and steered fetch to its target via `redirect`.
   * Read by IF, whose fall-through fetch is now off the predicted path and dies.
   *
   * **Deliberately NOT folded into `squash`, because it kills a different set.** A squash means
   * "everything younger than the deciding stage is wrong" — ID *and* IF. A bet means only "the
   * instruction IF just fetched is not the one we now think comes next": the branch in ID is the
   * thing doing the predicting and sails on to EX. One casualty, not two — and that difference IS
   * the milestone's payoff, the whole reason a correct prediction costs 1 instead of 2. Overloading
   * `squash` would kill the branch that placed the bet.
   */
  bet: boolean;
}

export class PipelineProcessor implements Processor {
  readonly capabilities = PIPELINE_CAPABILITIES;

  private registers = makeRegisters();
  private memory = new SparseMemory();
  /** Architectural pc — moves ONLY at retire, and only to the retiring instruction's `nextPc`. */
  private pc = 0;
  /** The MICROARCHITECTURAL fetch pointer. Runs ahead of `pc`; never surfaces in `MachineState`. */
  private fetchPc = 0;
  private entry = 0;
  private textEnd = 0;
  private halted = true; // nothing loaded yet
  private cycle = -1; // first step() produces cycle 0
  private seq = 0; // dynamic-instruction counter → stable ids (INV-4)
  private sourceMap: ReadonlyMap<number, number> = new Map();
  /** The honored config knob — the first model whose trace depends on one. */
  private forwarding = false;
  /**
   * The second honored knob (M4). `true` only for `'static-taken'`: `'none'` and
   * `'static-not-taken'` both mean "keep fetching the fall-through", which is one machine under two
   * names — see {@link PIPELINE_CAPABILITIES}. Collapsing the three-valued config to a boolean here
   * is the honest encoding of that, rather than a `switch` with two identical arms.
   */
  private predictTaken = false;
  private latches: Latches = EMPTY_LATCHES();
  /** The instruction in the IF stage: fetched this cycle, or held over across a stall. */
  private ifSlot: Fetched | null = null;
  /** Sticky once an architectural halt is decoded: fetch never restarts, the pipe just drains. */
  private haltFetch = false;

  reset(image: ProgramImage, config: ProcessorConfig = defaultConfig()): void {
    this.forwarding = config.forwarding;
    this.predictTaken = config.branchPrediction === 'static-taken';
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
    this.pc = this.entry;
    this.fetchPc = this.entry;
    this.textEnd = (image.entry + image.words.length * 4) >>> 0;
    this.cycle = -1;
    this.seq = 0;
    this.latches = EMPTY_LATCHES();
    this.ifSlot = null;
    this.haltFetch = false;
    // An empty image (or one whose entry is already past text) is halted from the start.
    this.halted = !this.inText(this.pc);
  }

  isHalted(): boolean {
    return this.halted;
  }

  getState(): MachineState {
    return this.snapshotState(this.latches);
  }

  step(): CycleTrace {
    if (this.halted) {
      throw new Error('step() called on a halted processor — check isHalted() first');
    }
    this.cycle += 1;

    const prev = this.latches;
    const ctx: CycleCtx = {
      prev,
      next: EMPTY_LATCHES(),
      events: [],
      stalled: false,
      squash: null,
      redirect: null,
      stopFetch: false,
      bet: false,
    };

    // Who is where, captured before the walk. `prev` is the start-of-cycle latch state, so the
    // instruction "in ID" is the one IF/ID presents, "in EX" is the one ID/EX presents, and so on.
    const inWb = prev.memWb;
    const inMem = prev.exMem;
    const inEx = prev.idEx;
    const inId = prev.ifId;

    // Reverse stage order — see the file header for the three invariants this buys.
    this.stageWb(ctx);
    this.stageMem(ctx);
    this.stageEx(ctx);
    this.stageId(ctx);
    const inIf = this.stageIf(ctx);

    // The clock edge: latches, the fetch pointer, and the fetch-stop all update together. Staging
    // the last two here (rather than letting EX/ID poke them mid-walk) is what lets IF still do
    // its work this cycle and be squashed after the fact — which is what makes a flush cut the
    // rows it claims to.
    this.latches = ctx.next;
    if (ctx.redirect !== null) this.fetchPc = ctx.redirect;
    if (ctx.stopFetch) this.haltFetch = true;

    // The `flush` event belongs here, at the edge, for two reasons that happen to agree. It is
    // when the kill actually lands (the stages did their work; the flush discards the result);
    // and IF, which runs last, is the only stage that knows whether it had anything to lose.
    //
    // `stages` therefore names REAL CASUALTIES, and a flush that kills nobody emits no event at
    // all. That is a contract choice, not an implementation detail: `flush` is a shared surface
    // with three readers (the datapath, the pipeline map's cut rows, and the curriculum, which
    // triggers on a bare `{ event: 'flush' }`). Under the alternative reading — "stages names the
    // latches the signal is asserted on, occupied or not" — an `ecall` at the end of text would
    // emit a flush that killed nothing, and a lesson anchored to it would announce a bubble that
    // does not exist. Every consumer wants "something died"; none wants "a wire went high".
    if (ctx.squash !== null) {
      // Program order, oldest first — the same rule `instructions[]` uses.
      const stages: string[] = [];
      if (ctx.squash === 'branch' && inId !== null) stages.push('ID');
      if (inIf !== null) stages.push('IF');
      if (stages.length > 0) {
        ctx.events.push({
          type: 'flush',
          reason: ctx.squash === 'branch' ? squashReason(inEx) : 'halt',
          stages,
        });
      }
    } else if (ctx.bet && inIf !== null) {
      // The BET's casualty (M4). A CORRECT prediction still kills something — the fall-through IF
      // had already fetched — and that discarded instruction is precisely the "1" in "a correctly
      // predicted taken branch costs 1, not 0". Emitting it only on misprediction would be the
      // easy mistake: the cost would then be invisible to every consumer that counts casualties,
      // and the map would draw a free prediction the machine never made.
      //
      // One stage, never two, and no `inId` check: a bet does not kill ID (that instruction IS the
      // branch). The single-casualty shape is not new — a halt flush has always cut only IF.
      ctx.events.push({ type: 'flush', reason: 'branch-predicted-taken', stages: ['IF'] });
    }

    // Halt-with-drain, asserted rather than assumed. `halted` may only be raised once the pipe is
    // empty; raising it early would strand in-flight instructions and silently truncate the run.
    if (this.halted && (this.ifSlot !== null || this.occupied(this.latches))) {
      throw new Error(
        `pipeline: halted at cycle ${this.cycle} with instructions still in flight — the pipe did not drain`,
      );
    }

    // In-flight instructions in PROGRAM ORDER, oldest (nearest retirement) first. A stable
    // ordering rule beats a positional one and survives the models that come later: with two
    // lanes in EX, "oldest first" is still well defined where "stage order" is not.
    const instructions: InstructionInstance[] = [];
    const place = (occupant: IfIdLatch | null, location: Stage): void => {
      if (occupant === null) return;
      instructions.push({
        id: occupant.instr,
        pc: occupant.pc,
        encoding: occupant.ir,
        sourceLine: this.sourceMap.get(occupant.pc) ?? null,
        decoded: occupant.decoded,
        location,
      });
    };
    place(inWb, 'WB');
    place(inMem, 'MEM');
    place(inEx, 'EX');
    place(inId, 'ID');
    place(inIf === null ? null : toLatch(inIf), 'IF');

    return {
      cycle: this.cycle,
      state: this.snapshotState(this.latches),
      events: ctx.events,
      instructions,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // The stages, in the order they are walked.
  // ---------------------------------------------------------------------------------------------

  /**
   * WB — write the result back and RETIRE. This is the only place architectural state's `pc`
   * moves and the only place `halted` is raised, which is what makes halt-with-drain fall out of
   * one rule instead of two special cases.
   */
  private stageWb(ctx: CycleCtx): void {
    const mw = ctx.prev.memWb;
    if (mw === null) return;

    if (mw.rd !== 0) {
      if (mw.writeValue === null) {
        throw new Error(
          `pipeline: ${mw.decoded.mnemonic} writes x${mw.rd} but MEM/WB carries no value`,
        );
      }
      this.registers[mw.rd] = mw.writeValue;
      ctx.events.push({ type: 'reg-write', reg: mw.rd, value: mw.writeValue, instr: mw.instr });
    }
    ctx.events.push({ type: 'instr-retire', instr: mw.instr });

    if (mw.halt) {
      // An architectural halt does not advance pc: the final pc is the halting instruction's own.
      this.pc = mw.pc;
      this.halted = true;
    } else {
      this.pc = mw.nextPc;
      // Ran off the end of text: halt with pc = the out-of-range value (matches the reference).
      if (!this.inText(this.pc)) this.halted = true;
    }
  }

  /** MEM — the one data-memory access, and where a load's datum finally exists. */
  private stageMem(ctx: CycleCtx): void {
    const em = ctx.prev.exMem;
    if (em === null) return;

    const mnemonic = em.decoded.mnemonic;
    let mdr: number | null = null;
    let writeValue = em.writeValue;

    if (isLoad(em.decoded) || STORES.has(mnemonic)) {
      if (em.aluOut === null) {
        throw new Error(`pipeline: ${mnemonic} reaches MEM with no effective address latched`);
      }
      const addr = em.aluOut >>> 0;

      if (isLoad(em.decoded)) {
        // `value` on mem-read is the RAW access-width datum; the load-extend unit after memory
        // widens it for the register (lb/lh sign-extend, lbu/lhu zero-extend).
        const raw =
          mnemonic === 'lb' || mnemonic === 'lbu'
            ? this.memory.readByte(addr)
            : mnemonic === 'lh' || mnemonic === 'lhu'
              ? this.memory.readHalf(addr)
              : this.memory.readWord(addr);
        ctx.events.push({ type: 'mem-read', addr, value: raw, instr: em.instr });
        mdr = raw;
        writeValue =
          mnemonic === 'lb' ? (raw << 24) >> 24 : mnemonic === 'lh' ? (raw << 16) >> 16 : raw;
      } else {
        if (em.storeData === null) {
          throw new Error(`pipeline: ${mnemonic} reaches MEM with no store datum latched`);
        }
        const value =
          mnemonic === 'sb'
            ? em.storeData & 0xff
            : mnemonic === 'sh'
              ? em.storeData & 0xffff
              : em.storeData;
        ctx.events.push({ type: 'mem-write', addr, value, instr: em.instr });
        if (mnemonic === 'sb') this.memory.writeByte(addr, value);
        else if (mnemonic === 'sh') this.memory.writeHalf(addr, value);
        else this.memory.writeWord(addr, value);
      }
    }

    ctx.next.memWb = {
      instr: em.instr,
      pc: em.pc,
      ir: em.ir,
      decoded: em.decoded,
      rd: em.rd,
      aluOut: em.aluOut,
      mdr,
      writeValue,
      nextPc: em.nextPc,
      halt: em.halt,
    };
  }

  /**
   * EX — forward, compute, and resolve control flow. Every branch AND jump resolves here: the
   * machine has no ID comparator, so `jal` and `jalr` are not special cases, and `jalr` differs
   * only in that a REGISTER supplies its target address (a RAW on control flow itself) — which
   * the same EX-targeted forwarding covers.
   */
  private stageEx(ctx: CycleCtx): void {
    const ie = ctx.prev.idEx;
    if (ie === null) return; // a bubble: nothing to execute

    const d = ie.decoded;
    const { rs1, rs2, imm, mnemonic } = d;
    const shamt = imm & 0x1f; // shift amount: low 5 bits, for both reg- and imm-shifts

    // Resolve the two source operands against the forwarding network (a no-op when the toggle is
    // off, where the ID interlock has already guaranteed the latched values are current).
    const fwdA = this.resolveOperand(ctx, ie, 'rs1', rs1, ie.a);
    const fwdB = this.resolveOperand(ctx, ie, 'rs2', rs2, ie.b);

    // A null operand where the execute logic wants one means `sourceRegs()` and this switch
    // disagree — the hazard unit's worst bug class, since every stall and forward keys off the
    // former while the VALUE comes from the latter. Fail loudly at author time.
    const opA = (): number => {
      if (fwdA === null) throw new Error(`pipeline: ${mnemonic} reads rs1 but ID latched no A`);
      return fwdA;
    };
    const opB = (): number => {
      if (fwdB === null) throw new Error(`pipeline: ${mnemonic} reads rs2 but ID latched no B`);
      return fwdB;
    };
    // The reference's `s()`/`u()` register views, over the forwarded operands.
    const sa = (): number => opA();
    const ua = (): number => opA() >>> 0;
    const sb = (): number => opB();
    const ub = (): number => opB() >>> 0;

    let aluOut: number | null = null;
    let writeValue: number | null = null;
    let storeData: number | null = null;
    let nextPc = (ie.pc + 4) >>> 0;
    /** Set for every control transfer; `taken` drives the flush. Null for everything else. */
    let taken: boolean | null = null;

    const alu = (op: string, a: number, b: number, result: number): number => {
      ctx.events.push({
        type: 'alu-op',
        op,
        a: a | 0,
        b: b | 0,
        result: result | 0,
        instr: ie.instr,
      });
      aluOut = result | 0;
      return aluOut;
    };
    const produce = (value: number): void => {
      writeValue = value | 0;
    };

    switch (mnemonic) {
      // --- U-type: imm already holds imm[31:12] in place (no extra shift). No ALU work: the
      //     value is a pass-through / dedicated adder, so no `alu-op` fires (mirrors the
      //     reference's event set, the same finding multi-cycle encodes by skipping EX). ---
      case 'lui':
        produce(imm);
        break;
      case 'auipc':
        produce((ie.pc + imm) | 0);
        break;

      // --- Jumps: imm is a sign-extended, byte-scaled offset ---
      case 'jal':
        produce((ie.pc + 4) | 0);
        nextPc = (ie.pc + imm) >>> 0;
        taken = true;
        break;
      case 'jalr': {
        const sum = alu('add', sa(), imm, (sa() + imm) | 0); // ALU computes rs1 + imm...
        nextPc = (sum & ~1) >>> 0; // ...then bit 0 is cleared
        produce((ie.pc + 4) | 0);
        taken = true;
        break;
      }

      // --- Branches: signed vs unsigned compares; imm is the byte-scaled offset. The ALU
      //     evaluates the condition (result = taken?1:0); the branch unit selects the pc. ---
      case 'beq':
        taken = sa() === sb();
        alu('beq', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (ie.pc + imm) >>> 0;
        break;
      case 'bne':
        taken = sa() !== sb();
        alu('bne', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (ie.pc + imm) >>> 0;
        break;
      case 'blt':
        taken = sa() < sb();
        alu('blt', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (ie.pc + imm) >>> 0;
        break;
      case 'bge':
        taken = sa() >= sb();
        alu('bge', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (ie.pc + imm) >>> 0;
        break;
      case 'bltu':
        taken = ua() < ub();
        alu('bltu', ua(), ub(), taken ? 1 : 0);
        if (taken) nextPc = (ie.pc + imm) >>> 0;
        break;
      case 'bgeu':
        taken = ua() >= ub();
        alu('bgeu', ua(), ub(), taken ? 1 : 0);
        if (taken) nextPc = (ie.pc + imm) >>> 0;
        break;

      // --- Loads: effective addr = rs1 + imm. `writeValue` stays NULL — the datum arrives at
      //     MEM, and that null is what makes the load unforwardable from EX/MEM. ---
      case 'lb':
      case 'lh':
      case 'lw':
      case 'lbu':
      case 'lhu':
        alu('add', sa(), imm, (sa() + imm) >>> 0);
        break;

      // --- Stores: the low byte/half/word of rs2 goes to rs1 + imm (masked at MEM) ---
      case 'sb':
      case 'sh':
      case 'sw':
        alu('add', sa(), imm, (sa() + imm) >>> 0);
        storeData = sb();
        break;

      // --- I-type ALU ---
      case 'addi':
        produce(alu('add', sa(), imm, (sa() + imm) | 0));
        break;
      case 'slti':
        produce(alu('slt', sa(), imm, sa() < imm ? 1 : 0));
        break;
      case 'sltiu':
        // imm is sign-extended, then compared unsigned.
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

      // --- System / ordering. `fence` is a no-op (single-threaded, in-order: no ordering to
      //     model); the halting classes compute nothing. `halt` is decided by isArchHalt(), the
      //     same predicate ID used to stop fetching, so the two can never disagree. ---
      default:
        break;
    }

    // Every control transfer resolves HERE — and M4 changes what resolution MEANS. The old rule
    // was "squash if taken", which was only ever the fixed predict-not-taken machine's spelling of
    // the real rule: **squash if the prediction was WRONG**. Under `'none'`/`'static-not-taken'`
    // nothing is ever predicted taken, so `predicted !== taken` reduces to `taken` and the machine
    // behaves exactly as M3 pinned it. Under `static-taken` the two come apart, in both directions.
    if (taken !== null) {
      const predicted = ie.predictedTaken;
      ctx.events.push({
        type: 'branch-resolved',
        instr: ie.instr,
        predicted,
        actual: taken,
        target: nextPc,
      });
      if (predicted !== taken) {
        // `nextPc` is the correction for BOTH directions with no branching on which way we were
        // wrong: the schema defines it as "the resolved next pc, whichever way it went", so a
        // wrongly-predicted-taken branch reports its fall-through and a wrongly-predicted-not-taken
        // one reports its target. Fetch is wherever the bad guess sent it; this is where it belongs.
        ctx.squash = 'branch'; // the `flush` event itself is emitted at the edge — see step()
        ctx.redirect = nextPc; // applied at the clock edge, AFTER IF has fetched the wrong path
      }
      // A CORRECT taken prediction needs no redirect: ID already steered fetch to this exact
      // address, which is not an assumption but M4 step 0's pinned safety property (ID's
      // `speculativeTarget` equals EX's `nextPc` for every taken PC-relative transfer). The bet's
      // own casualty — the fall-through ID discarded — was already flushed back at the bet.
    }

    ctx.next.exMem = {
      instr: ie.instr,
      pc: ie.pc,
      ir: ie.ir,
      decoded: d,
      rd: ie.rd,
      aluOut,
      writeValue,
      storeData,
      nextPc,
      halt: isArchHalt(d),
    };
  }

  /**
   * The forwarding network: EX/MEM→EX and MEM/WB→EX, with EX/MEM winning a double match because
   * the younger producer holds the value that is actually current. Enumerated deliberately — a
   * general "any later latch → EX" rule is a future deeper pipeline's problem, and that is a
   * different package.
   *
   * With the toggle OFF no forward paths exist at all: the register file is the only route, and
   * the ID interlock has already held the consumer until the value is there.
   */
  private resolveOperand(
    ctx: CycleCtx,
    ie: IdExLatch,
    port: 'rs1' | 'rs2',
    reg: number,
    latched: number | null,
  ): number | null {
    if (latched === null) return null; // this instruction reads nothing on this port
    if (!this.forwarding) return latched;
    // Never forward TO x0: it is hardwired zero, not a value that anyone produces.
    if (reg === 0) return latched;

    const take = (from: string, value: number): number => {
      ctx.events.push({ type: 'forward', from, to: `EX.${port}`, value, instr: ie.instr });
      return value;
    };

    // `rd === 0` covers both "writes nothing" and "writes x0", so this test never forwards FROM
    // x0 either — the two exclusions the pinned decision asks for come from one comparison.
    const ex = ctx.prev.exMem;
    if (ex !== null && ex.rd === reg) {
      if (ex.writeValue === null) {
        // Unreachable: the only producer with no value at EX/MEM is a LOAD, and a load in MEM
        // with its consumer in EX is exactly what the load-use stall exists to make impossible.
        // If this fires, the hazard unit and the forwarding network have drifted apart.
        throw new Error(
          `pipeline: ${ex.decoded.mnemonic} in MEM has no forwardable value for x${reg} — the load-use stall did not fire`,
        );
      }
      return take('EX/MEM', ex.writeValue);
    }

    const mw = ctx.prev.memWb;
    if (mw !== null && mw.rd === reg && mw.writeValue !== null) {
      return take('MEM/WB', mw.writeValue);
    }

    return latched;
  }

  /**
   * ID — decode, detect hazards, read the register file. WB has already run this cycle, so the
   * read below sees a value written back in this very cycle (the pinned same-cycle WB→ID rule).
   */
  private stageId(ctx: CycleCtx): void {
    const fd = ctx.prev.ifId;
    if (fd === null) return; // nothing in ID
    // An older taken transfer killed everything younger. EX ran before us, so we simply never
    // execute: no reads, no hazard detection, no chance of a squashed shadow polluting the trace
    // with a phantom stall or a `forward` that step 3's timing assertions would read.
    if (ctx.squash !== null) return;

    const d = fd.decoded;
    const src = sourceRegs(d);

    const reason = this.detectHazard(ctx, src);
    if (reason !== null) {
      ctx.events.push({ type: 'stall', reason, stage: 'ID', instr: fd.instr });
      ctx.stalled = true;
      ctx.next.idEx = null; // a bubble goes down the pipe...
      ctx.next.ifId = fd; // ...and this instruction stays right here in ID
      return;
    }

    const a = src.rs1 === null ? null : this.readReg(ctx, fd.instr, src.rs1);
    const b = src.rs2 === null ? null : this.readReg(ctx, fd.instr, src.rs2);

    // An architectural halt stops fetching HERE, at decode, and squashes the ONE younger
    // instruction behind it (everything else in the pipe is older, and retires normally). The
    // shadow is not hypothetical: in `call-return.s` the `ecall` is followed by the real `max:`
    // function — live code. And the hazard the squash removes is a committed SIDE EFFECT, not a
    // pc redirect: under the retire-pc rule a shadow's redirect only moves the microarchitectural
    // fetch pointer, but a shadow STORE one slot behind would sit in MEM the same cycle the halt
    // sits in WB, making architectural memory depend on intra-cycle stage order. Squash instead.
    if (isArchHalt(d)) {
      ctx.stopFetch = true; // applied at the clock edge, so IF still fetches the shadow to kill
      ctx.squash = 'halt'; // the `flush` event itself is emitted at the edge — see step()
    }

    // The BET (M4). Everything above this line has already established that this instruction is
    // real: it survived the `ctx.squash` early-return at the top (so it is not in an older
    // transfer's shadow) and it did not stall. Both matter, and the first is load-bearing enough
    // to state — a bet placed before that return would let a WRONG-PATH instruction steer the
    // fetch pointer, overwriting the very redirect that condemned it. The stage walk runs in
    // reverse order (EX before ID) precisely so EX's correction is already visible here, which is
    // what makes "the correction always beats the bet" structural rather than a rule to enforce.
    //
    // `predictTaken` gates it, so under 'none'/'static-not-taken' this is dead and the machine is
    // byte-for-byte M3's. A halt is not a transfer, so the `isArchHalt` squash above cannot
    // coincide with a bet.
    const target = this.predictTaken ? speculativeTarget(d, fd.pc) : null;
    if (target !== null) {
      ctx.bet = true;
      ctx.redirect = target; // applied at the clock edge, AFTER IF has fetched the fall-through
      // The bet's own event, emitted HERE rather than left to be inferred from the `flush` it
      // usually causes. The two are different facts and they come apart: the flush reports
      // CASUALTIES, so a branch at the end of `.text` bets — redirecting the pc — while IF has
      // nothing to kill, and emits none. That is not a corner: such a branch bets on every pass.
      // Without this event the bet is unobservable in the cycle it happens, and a consumer would
      // have to read the correction (`branch-resolved`, one stage and at least one cycle later) or
      // re-derive `pc + imm` for itself (INV-3/INV-7).
      ctx.events.push({ type: 'branch-predicted', instr: fd.instr, target });
    }

    ctx.next.idEx = {
      instr: fd.instr,
      pc: fd.pc,
      ir: fd.ir,
      decoded: d,
      rd: destReg(d),
      a,
      b,
      predictedTaken: target !== null,
    };
  }

  /**
   * The hazard-detection unit — the one place the forwarding toggle changes the machine's SHAPE
   * rather than its timing, which is why building for one position and retrofitting the other
   * would mean rewriting the thing this model exists to demonstrate.
   */
  private detectHazard(ctx: CycleCtx, src: SourceRegs): string | null {
    // `rd !== 0` excludes both "writes nothing" and x0 (hardwired zero: never a dependency).
    const reads = (rd: number): boolean => rd !== 0 && (rd === src.rs1 || rd === src.rs2);
    const inEx = ctx.prev.idEx;
    const inMem = ctx.prev.exMem;

    if (this.forwarding) {
      // Anything a forward can cover, a forward covers — with exactly one exception. A LOAD still
      // in EX has no datum yet (it arrives at MEM), so there is nothing to forward to a consumer
      // reaching EX next cycle. One bubble slides the consumer's EX alongside the load's WB,
      // where MEM/WB→EX can reach it. THE bubble that cannot be forwarded away.
      if (inEx !== null && isLoad(inEx.decoded) && reads(inEx.rd)) return 'load-use';
      return null;
    }

    // No forwarding network: the register file is the only path, so the consumer waits in ID
    // until the producer's WB. A producer in WB *this* cycle is NOT a hazard — WB ran first in
    // the walk, so the read that follows already sees its value. That is what makes a distance-1
    // RAW a 2-cycle stall rather than a 3-cycle one.
    if (inEx !== null && reads(inEx.rd)) return 'raw';
    if (inMem !== null && reads(inMem.rd)) return 'raw';
    return null;
  }

  private readReg(ctx: CycleCtx, instr: string, reg: number): number {
    const value = this.registers[reg]!;
    ctx.events.push({ type: 'reg-read', reg, value, instr });
    return value;
  }

  /**
   * IF — fetch, or hold. Returns the instruction occupying the IF stage this cycle, which is
   * what a stall makes visible: the younger instruction sits in IF for a second cycle (the
   * repeated cell in every textbook pipeline diagram) rather than being re-fetched under a new
   * id, which would break the stable-id invariant (INV-4) and emit `instr-fetch` twice.
   */
  private stageIf(ctx: CycleCtx): Fetched | null {
    // Fetch FIRST, squash afterwards. IF does its work every cycle; a flush kills the result at
    // the clock edge rather than preventing the work — which is exactly why a taken branch cuts
    // TWO rows (the instruction in ID and the one IF was fetching behind it) and why an `ecall`'s
    // one shadow is a real instruction that shows up and dies rather than never existing. Both
    // `fetchPc` and `haltFetch` are read here at their PRE-edge values (EX's redirect and ID's
    // stop are staged in `ctx`), so this fetch is the fall-through one the machine really made.
    //
    // Reuse the instruction held over from a stall, else fetch a new one. Fetching stops for
    // exactly two reasons — an architectural halt decoded in ID, or the fetch pointer leaving
    // `.text` — and neither is a halt: the pipe drains and halts at the last retire. Note the
    // out-of-text test is not a sticky flag, so a taken branch that redirects back into text
    // resumes fetching for free.
    let slot = this.ifSlot;
    if (slot === null && !this.haltFetch && this.inText(this.fetchPc)) {
      slot = this.fetchOne(ctx);
    }

    if (ctx.squash !== null) {
      // Whatever IF holds dies, and nothing enters ID.
      this.ifSlot = null;
      ctx.next.ifId = null;
      return slot; // it was here this cycle, and it dies here
    }

    if (ctx.bet) {
      // The ID bet steered fetch to a predicted target, so the fall-through this stage just
      // fetched is off the predicted path and dies — exactly like a squash from IF's point of
      // view. The difference is invisible here and decisive one stage up: ID's own instruction (the
      // branch doing the predicting) is NOT killed, so `ctx.next.idEx` — already set by stageId —
      // stands. One casualty instead of two is the entire saving a correct prediction buys.
      this.ifSlot = null;
      ctx.next.ifId = null;
      return slot;
    }

    if (ctx.stalled) {
      this.ifSlot = slot; // hold it in IF: ID could not accept it
      // `ctx.next.ifId` was already set by the stalling ID stage, which stays put.
    } else {
      this.ifSlot = null;
      ctx.next.ifId = slot === null ? null : toLatch(slot);
    }
    return slot;
  }

  private fetchOne(ctx: CycleCtx): Fetched {
    const pc = this.fetchPc;
    const word = this.memory.readWord(pc) >>> 0;
    const fetched: Fetched = { id: `i${this.seq++}`, pc, word, decoded: decode(word) };
    ctx.events.push({ type: 'instr-fetch', instr: fetched.id, pc, encoding: word });
    this.fetchPc = (pc + 4) >>> 0;
    return fetched;
  }

  // ---------------------------------------------------------------------------------------------

  /** Is `p` a fetchable text address (the loaded program range)? */
  private inText(p: number): boolean {
    return p >= this.entry && p < this.textEnd;
  }

  private occupied(l: Latches): boolean {
    return l.ifId !== null || l.idEx !== null || l.exMem !== null || l.memWb !== null;
  }

  /**
   * An independent full-state snapshot — what each CycleTrace carries (handoff §6). The latch
   * objects are immutable and rebuilt each cycle, so copying the container is enough to keep
   * every recorded cycle's `micro` genuinely its own.
   */
  private snapshotState(latches: Latches): MachineState {
    const micro: PipelineMicro = {
      ifId: latches.ifId,
      idEx: latches.idEx,
      exMem: latches.exMem,
      memWb: latches.memWb,
    };
    return {
      pc: this.pc,
      registers: this.registers.slice(),
      memory: this.memory.snapshot(),
      halted: this.halted,
      micro,
    };
  }
}
