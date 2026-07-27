/**
 * The deep 7-stage in-order pipeline (M11) behind the {@link Processor} interface (§6): the SIXTH
 * microarchitecture, and the first with more stage columns than there are phase hues —
 * `IF1 IF2 ID EX1 EX2 MEM WB`, seven stages and six latches.
 *
 * It is a deliberate FORK of `engine/pipeline`'s stage walk (the M7 precedent: models share
 * `engine-common`, never a sibling model). The ISA semantics — the arithmetic, the `s`/`u`
 * signed/unsigned views, `imm & 0x1f`, the `>>> 0` at the memory boundary — are mirrored VERBATIM
 * from the golden reference exactly as every model mirrors them, and the INV-8 differential proves
 * the copy faithful. What is genuinely new is the SEQUENCING, and specifically the two extra
 * stages.
 *
 * ## The thesis: depth is a cost
 *
 * M3 taught that forwarding makes the bubble vanish. This model teaches the other half — that the
 * same forwarding, on a deeper machine, **stops being enough**. One sentence carries the whole
 * model:
 *
 * > **Operands are consumed at the START of EX1; nothing is finished until the END of EX2.**
 *
 * Everything follows from it, with no second rule:
 *
 *  - **ALU→ALU with forwarding ON costs 1 bubble**, where the 5-stage costs 0. A producer in EX1
 *    is still in EX2 when its consumer would want to enter EX1, and EX2 is where the result is
 *    made, not where it is available. The consumer waits one cycle and then takes the
 *    `EX2/MEM → EX1` forward. This is the milestone's flagship observation: the same program, the
 *    same `forwarding: true`, one model over — and M3's vanished bubble comes back.
 *  - **Load-use costs 2 bubbles**, not 1: the datum exists at the end of MEM, so the consumer must
 *    reach EX1 the cycle the load reaches WB.
 *  - **A RAW with forwarding OFF costs 3 stall cycles**, not 2: the consumer waits in ID for the
 *    producer's WB, and there is one more stage between them.
 *  - **A misprediction costs 4**, not 2: every control transfer resolves at the end of EX2, so
 *    EX1, ID, IF2 and IF1 all die.
 *  - **A correctly predicted taken branch costs 2**, not 1. The bet is still placed in ID, and in a
 *    7-stage an ID bet kills IF2 *and* IF1. Depth taxes you even when the prediction is right.
 *    (Making it cheap again means a predictor in IF1 — a BTB / next-line fetch — which is new
 *    mechanism and deliberately not in this model.)
 *
 * ### The bubble is enforced by a latch SHAPE, not by a rule
 *
 * {@link Ex1Ex2Latch} carries **forwarded operands, never a result**. EX1 resolves the two source
 * operands against the forwarding network and latches them; EX2 runs the ALU, resolves control
 * flow, and is the first stage that has an answer to hand anybody. So "you cannot forward out of
 * EX2" is not a rule someone could forget to write — there is nothing in that latch to forward.
 * That is the thesis made structural.
 *
 * ## The stage split, and what each stage genuinely does
 *
 *  - **IF1** — address generation and the instruction-memory read. Allocates the stable id (INV-4)
 *    and emits `instr-fetch`.
 *  - **IF2** — the second half of the fetch path (instruction buffer / predecode). It performs no
 *    NEW architectural work, and that is stated rather than hidden: **its content is DEPTH
 *    itself**. A two-deep front end is what makes an ID bet cost two and a misprediction cost four,
 *    and those are timing facts a stage that "does nothing" produces. The alternative — issuing the
 *    address in IF1 and receiving the word in IF2 — was rejected because an IF1 occupant would then
 *    have no `encoding`, and `InstructionInstance.encoding` is not nullable: that is a trace-schema
 *    change, which M11's falsifiable criteria make a STOP.
 *  - **ID** — decode, the hazard interlock, the register-file read, and the branch BET.
 *  - **EX1** — the forwarding network. Consumes operands, produces nothing.
 *  - **EX2** — the ALU, `alu-op`, control resolution, and the correction. The `alu-op` event fires
 *    HERE, in the cycle the result is finished, not in EX1 where the operands arrived.
 *  - **MEM** — the one data-memory access.
 *  - **WB** — write back and retire.
 *
 * **The two-cycle execute is UNIFORM across every op** (pinned 2026-07-27). `lui`/`auipc`/`jal`
 * compute with no ALU at all and still take both cycles; a non-uniform execute is a
 * variable-latency machine, a much bigger animal that collides with M9's `slowOpLatency`. The whole
 * timing matrix rests on uniformity, so it is written here rather than assumed — which is also why
 * the ALU→ALU stall reason is `'ex-latency'` and not `'alu-use'`: `lui` stalls a consumer while
 * emitting no `alu-op`.
 *
 * ## How one cycle runs
 *
 * The six latches are DOUBLE-BUFFERED, exactly as in the 5-stage: every stage reads `prev` — the
 * latch contents as of the start of the cycle — and writes into a fresh `next`, committed at the
 * end. **EX1 therefore reads `prev.ex2Mem` / `prev.memWb` and never `next`**, even though EX2 runs
 * earlier in the walk and has already written `next.ex2Mem`. Splitting a stage in two is precisely
 * where that discipline slips, so it is called out: reading `next.ex2Mem` would forward a result
 * from an instruction that has not yet reached MEM.
 *
 * Stages are walked in REVERSE (WB→MEM→EX2→EX1→ID→IF2→IF1). As in the 5-stage that order is not
 * what makes the latch chain correct, but it buys three things: the same-cycle WB→ID register read,
 * the intra-cycle `events[]` order (a trace-contract surface, INV-3/INV-6), and single-pass control
 * propagation — EX2 raises a squash and the four stages younger than it, all later in the walk,
 * kill their own occupants; ID raises a stall and IF2/IF1 hold.
 *
 * **Each stage kills or holds its OWN occupant.** A stage that stalls re-presents its occupant into
 * the latch it arrived on (ID writes `next.if2Id`, IF2 writes `next.if1If2`, IF1 keeps `ifSlot`);
 * a stage that is squashed simply writes nothing, and the fresh `next` is already null there.
 *
 * ## Config
 *
 * `forwarding` and `branchPrediction` are honored. **A non-null `cache` is REFUSED BY NAME**
 * (M11 step 6 owns it): M6's miss-freeze holds IF/ID/EX, and which of IF1/IF2/EX1/EX2 freeze —
 * and whether an in-flight EX2 completes — is a choice with no external ground truth. Refusing
 * rather than silently ignoring is the house rule that keeps an unhonored knob from shipping inert
 * (the superscalar's `issueWidth > 2` throw is the shape copied here).
 *
 * ## The mutation check step 3 will run — spelled out here so it is not re-derived
 *
 * The characteristic failure of this milestone is "a 5-stage wearing seven labels", and INV-8
 * cannot see it (an in-order machine retires in order however deep it is). The discriminator is the
 * timing matrix, and its mutation check is: **stub IF2 and EX2 to pass-throughs, and confirm INV-8
 * stays green while the timing matrix reddens.** Concretely, in this file:
 *
 *  - **Stubbing IF2** = collapse the IF1/IF2 latch, so {@link stageIf1} hands its slot straight
 *    into `next.if2Id` and the front end is one deep again. (There is no line to delete inside
 *    {@link stageIf2}: IF2's whole content is the cycle it occupies.)
 *  - **Stubbing EX2** = move the {@link stageEx2} switch back into {@link stageEx1}, let `ex1Ex2`
 *    carry the finished `Ex2MemLatch`, and drop EX2 to a pass-through. That restores forwarding out
 *    of the first execute cycle and collapses the ALU→ALU bubble.
 *
 * Determinism (INV-1), obliviousness to rendering/depth tiers (INV-2), the trace as the only
 * contract (INV-3), and stable ids (INV-4) hold exactly as in the earlier models. See
 * `docs/plans/m11-tasks.md`.
 */

import { decode, defForMnemonic, type DecodedInstruction } from '@cpu-viz/isa';
import { speculativeTarget } from '@cpu-viz/engine-common';
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
 * The seven pipeline stages. `InstructionInstance.location` is one of these, VERBATIM — bare stage
 * strings with a trailing digit and nothing else.
 *
 * The encoding is load-bearing beyond this package. `pipeline-map.ts`'s `stageFamily` strips a
 * trailing `\d+` to get the hue key, so `IF1`/`IF2` fold to the fetch family and `EX1`/`EX2` to the
 * execute family: seven stages, five hues, no invented colours. Spellings like `IF-2` would not
 * fold at all, and `IF.2` would mean something else entirely — `.` is the LANE axis (`EX.0`/`EX.1`,
 * M7). This model has one lane, so it never emits a dot.
 */
export type Stage = 'IF1' | 'IF2' | 'ID' | 'EX1' | 'EX2' | 'MEM' | 'WB';

/** Program order for the four stages a control transfer can kill, oldest first. */
const SQUASHABLE: readonly Stage[] = ['EX1', 'ID', 'IF2', 'IF1'];

/**
 * A word on its way down the front end, and the base every later latch extends: `pc` and `ir` ride
 * the whole way down the pipe exactly as they do in hardware, each stage adding what it computed.
 * `decoded` is a pure function of `ir`, so carrying it is memoization rather than extra state.
 *
 * **Both front-end latches carry exactly this and nothing more** — IF1/IF2 and IF2/ID are the same
 * shape, because IF2 adds nothing (see the file header: its content is the cycle it occupies). One
 * type rather than two identical ones says that honestly.
 */
export interface FetchLatch {
  /** The stable id (INV-4) of the instruction this latch holds — the same id from fetch to retire. */
  readonly instr: string;
  readonly pc: number;
  /** Instruction register: the fetched word. */
  readonly ir: number;
  readonly decoded: DecodedInstruction;
}

/** ID/EX1 — decoded, with its register-file reads latched (PRE-forwarding). */
export interface IdEx1Latch extends FetchLatch {
  /**
   * The architectural destination register, or `0` when the instruction writes none. x0 and
   * "writes nothing" deliberately coincide: a write to x0 is discarded, so one value says both, and
   * every hazard/forward test keying off `rd !== 0` gets "never forward from x0" for free. This is
   * NOT `decoded.rd` — for an S/B-format word those bits are part of the immediate.
   */
  readonly rd: number;
  /** `Reg[rs1]` as read from the register file at ID, PRE-forwarding; null if rs1 is no source. */
  readonly a: number | null;
  /** `Reg[rs2]` as read at ID, PRE-forwarding; null if rs2 is no source. */
  readonly b: number | null;
  /**
   * The BET ID placed on this instruction: did ID steer fetch to its target? Always `false` under
   * `'none'`/`'static-not-taken'`, where fetch simply carries on — which is why those two config
   * values are one machine. A boolean rather than the predicted target, for the reason M4 step 0
   * PROVED: `speculativeTarget` equals the resolved `nextPc` for every taken PC-relative transfer,
   * so "we both say taken" already implies "we both mean the same address".
   */
  readonly predictedTaken: boolean;
}

/**
 * EX1/EX2 — **the forwarded OPERANDS, on their way into the second execute cycle.** The one latch
 * in this machine that carries no result, and the reason the ALU→ALU bubble cannot be forgotten:
 * there is nothing here for the forwarding network to take. Compare `engine-pipeline`'s EX/MEM,
 * which holds `writeValue` and is forwardable the very next cycle.
 */
export interface Ex1Ex2Latch extends FetchLatch {
  readonly rd: number;
  /** `rs1`'s value AFTER forwarding — what the ALU will actually use. Null if rs1 is no source. */
  readonly opA: number | null;
  /** `rs2`'s value AFTER forwarding. Null if rs2 is no source. */
  readonly opB: number | null;
  readonly predictedTaken: boolean;
}

/** EX2/MEM — the ALU's answer on its way to memory. The FIRST forwardable latch. */
export interface Ex2MemLatch extends FetchLatch {
  readonly rd: number;
  /** ALU result / effective address. Null for the classes that use no ALU (`lui`/`jal`/`auipc`). */
  readonly aluOut: number | null;
  /**
   * The value bound for `rd`, IF EX2 already knows it — and null for a LOAD, whose datum does not
   * exist until MEM has run. That null is not an omission: it is the load-use hazard itself.
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
export interface MemWbLatch extends FetchLatch {
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
 * This model's `MachineState.micro` (the §5 per-model extension point): the six inter-stage
 * latches, which is what "7 stages, 6 latches" means concretely. `null` is a BUBBLE — a stage with
 * no instruction in it, which is what a stall inserts and a flush leaves behind.
 *
 * Every latch object is IMMUTABLE and rebuilt from scratch each cycle, never mutated in place. That
 * is what satisfies the same independent-per-cycle-snapshot requirement `registers`/`memory` have:
 * the recorder keeps every cycle, so a latch aliased across cycles would replay as
 * latest-values-everywhere. Final-state conformance cannot see that bug — only time-travel can.
 *
 * Deliberately six CONCRETE latches, not an N-latch abstraction, for the same reason
 * `engine-pipeline` keeps four: `future-microarchitectures.md` pins that a deeper pipeline is a
 * sibling package with its own `micro` type, not a retrofit of the 5-stage's.
 *
 * **There is deliberately no `cache` field.** This machine refuses a cache config by name (M11 step
 * 6 owns it), and a field that could only ever be `null` is the inert-shipping shape M10 step 0
 * found and this milestone is written to avoid.
 */
export interface DeepPipelineMicro {
  readonly if1If2: FetchLatch | null;
  readonly if2Id: FetchLatch | null;
  readonly idEx1: IdEx1Latch | null;
  readonly ex1Ex2: Ex1Ex2Latch | null;
  readonly ex2Mem: Ex2MemLatch | null;
  readonly memWb: MemWbLatch | null;
}

/**
 * **`configurableCache: false` is a claim about this MVP, not about the machine's future.** The knob
 * is refused rather than ignored (see {@link DeepPipelineProcessor.reset}), so the capability and
 * the behaviour cannot drift apart.
 *
 * `configurableBranchPrediction: true` is a claim about two schemes, not three, exactly as in the
 * 5-stage: `'none'` and `'static-not-taken'` are the SAME MACHINE here. A processor with no
 * predictor does not stop and wait — it keeps fetching the next address, and the fall-through IS
 * the not-taken path.
 */
export const DEEP_PIPELINE_CAPABILITIES: ProcessorCapabilities = {
  model: 'deep-pipeline',
  pipelined: true,
  hasHazards: true,
  configurableForwarding: true,
  configurableBranchPrediction: true,
  // M11 step 6: the miss-freeze meeting two execute stages is a pinned CHOICE, not a mechanical
  // ripple. Until it is made, `reset()` throws on a non-null cache rather than running unfrozen.
  configurableCache: false,
  // One instruction per stage is this model's definition, not a setting (M7's axis is width).
  configurableIssueWidth: false,
  // In-order issue and completion are this model's definition (M9's axis is the ROB/RS cluster).
  configurableOutOfOrder: false,
};

const LOADS = new Set(['lb', 'lh', 'lw', 'lbu', 'lhu']);
const STORES = new Set(['sb', 'sh', 'sw']);

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

/** The architectural destination, or 0 for "writes nothing" (see {@link IdEx1Latch.rd}). */
function destReg(d: DecodedInstruction): number {
  return WRITES_RD.has(d.mnemonic) ? d.rd : 0;
}

/** Which registers an instruction READS, or null per port when it reads none there. */
interface SourceRegs {
  readonly rs1: number | null;
  readonly rs2: number | null;
}

/**
 * The source-register predicate — mirrors EXACTLY the reads the golden reference performs, which is
 * what makes it safe for the hazard unit to key off. Every stall, every forward and every x0
 * exclusion is decided from this, so a class listed here that the reference does not actually read
 * from would stall on a dependency that does not exist (invisible to INV-8, which only sees final
 * state), and one missing would forward nothing where a forward was needed.
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

/** Loads are the one producer whose value is not ready even at the end of EX2. */
function isLoad(d: DecodedInstruction): boolean {
  return LOADS.has(d.mnemonic);
}

/**
 * Is this an architectural halt? `ecall`/`ebreak`, plus any word the decoder did not recognize —
 * `decode` never throws, so an unknown word arrives as `mnemonic: 'unknown'` and must halt loudly
 * rather than silently advance (mirrors the reference's `default:` arm). ONE predicate, used by both
 * ID (to stop fetching) and EX2 (to latch `halt`), so the two can never disagree.
 */
function isArchHalt(d: DecodedInstruction): boolean {
  return (
    d.mnemonic === 'ecall' || d.mnemonic === 'ebreak' || defForMnemonic(d.mnemonic) === undefined
  );
}

/** The six latches, double-buffered per cycle. */
interface Latches {
  if1If2: FetchLatch | null;
  if2Id: FetchLatch | null;
  idEx1: IdEx1Latch | null;
  ex1Ex2: Ex1Ex2Latch | null;
  ex2Mem: Ex2MemLatch | null;
  memWb: MemWbLatch | null;
}

const EMPTY_LATCHES = (): Latches => ({
  if1If2: null,
  if2Id: null,
  idEx1: null,
  ex1Ex2: null,
  ex2Mem: null,
  memWb: null,
});

/**
 * An instruction sitting in the IF1 stage — fetched, but not yet latched into IF1/IF2. It is a
 * distinct thing from the IF1/IF2 latch: seven stages, six latches, so the oldest stage's occupant
 * has nowhere to live but here. A stall is exactly the case where the two differ for a whole cycle.
 */
interface Fetched {
  readonly id: string;
  readonly pc: number;
  readonly word: number;
  readonly decoded: DecodedInstruction;
}

/** The IF1 stage's occupant, as it will be presented on the IF1/IF2 latch at the clock edge. */
function toLatch(f: Fetched): FetchLatch {
  return { instr: f.id, pc: f.pc, ir: f.word, decoded: f.decoded };
}

/** Why everything younger than the deciding stage is being killed this cycle. */
type Squash = 'branch' | 'halt';

/**
 * The `flush.reason` for an EX2 correction, named for what the machine LEARNED. Inherited verbatim
 * from the 5-stage's vocabulary (M4), because the reason a flush happened is a property of
 * prediction, not of depth: a bet that declines corrects with `actual === false` and must not be
 * reported as `'branch-taken'`.
 */
function squashReason(inEx2: Ex1Ex2Latch | null): string {
  // `inEx2` is the instruction that resolved this cycle: EX2 is the only stage that raises 'branch'.
  return inEx2 !== null && inEx2.predictedTaken ? 'branch-not-taken' : 'branch-taken';
}

/** The mutable working set for one cycle: read `prev`, fill `next`, collect events and signals. */
interface CycleCtx {
  readonly prev: Latches;
  readonly next: Latches;
  readonly events: TraceEvent[];
  /** Raised by ID; read by IF2 and IF1, which then hold their occupants instead of handing them on. */
  stalled: boolean;
  /** Raised by EX2 (mispredicted transfer) or ID (architectural halt); read by the younger stages. */
  squash: Squash | null;
  /**
   * A correction's target, staged by EX2 (or a bet's target, staged by ID) and applied at the END of
   * the cycle. The fetch pointer is a clocked register just like the latches, so the redirect must
   * NOT land mid-walk: IF1 runs last and has to fetch the FALL-THROUGH instruction (which it then
   * squashes), not the target. Applying it early would fetch the target one cycle too early and
   * erase one of the rows the flush is supposed to cut.
   */
  redirect: number | null;
  /**
   * Staged by ID, applied at the end of the cycle, for exactly the same reason: IF1 must still fetch
   * the shadow instruction behind an `ecall` so the squash has something to kill — `call-return.s`
   * puts live code (`max:`) directly behind its `ecall`.
   */
  stopFetch: boolean;
  /**
   * The ID BET: ID predicted a transfer taken and steered fetch to its target via `redirect`. Read
   * by IF2 and IF1, whose occupants are now off the predicted path and die.
   *
   * **Deliberately NOT folded into `squash`, because it kills a different set.** A squash means
   * "everything younger than the deciding stage is wrong". A bet means only "what the front end has
   * already fetched is not what we now think comes next": the branch in ID is the thing doing the
   * predicting and sails on to EX1. TWO casualties here rather than the 5-stage's one — the front
   * end is two deep — but still not the branch itself, and that difference is what keeps a correct
   * prediction at 2 instead of 4.
   */
  bet: boolean;
}

export class DeepPipelineProcessor implements Processor {
  readonly capabilities = DEEP_PIPELINE_CAPABILITIES;

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
  private forwarding = false;
  /**
   * `true` only for `'static-taken'`: `'none'` and `'static-not-taken'` both mean "keep fetching the
   * fall-through", which is one machine under two names — see {@link DEEP_PIPELINE_CAPABILITIES}.
   */
  private predictTaken = false;
  private latches: Latches = EMPTY_LATCHES();
  /** The instruction in the IF1 stage: fetched this cycle, or held over across a stall. */
  private ifSlot: Fetched | null = null;
  /** Sticky once an architectural halt is decoded: fetch never restarts, the pipe just drains. */
  private haltFetch = false;

  reset(image: ProgramImage, config: ProcessorConfig = defaultConfig()): void {
    // REFUSE a cache rather than ignore one. M6's miss-freeze holds IF/ID/EX for `missPenalty`
    // cycles; on this machine "IF" and "EX" are each two stages, and whether an in-flight EX2
    // completes under the freeze is a choice with no external ground truth (the M9 finding-F9
    // shape). M11 step 6 pins it with a named seam. Until then, running with the knob silently
    // unhonored is exactly how M10 step 0 found `slowOpLatency` shipped INERT.
    if (config.cache !== null) {
      throw new Error(
        'deep-pipeline: a cache is not a knob this machine has yet — M6’s miss-freeze meeting ' +
          'two execute stages is an unpinned choice (M11 step 6), so which of IF1/IF2/EX1/EX2 ' +
          'freeze has no answer here. Refusing rather than silently running cache-less.',
      );
    }
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
    // instruction "in ID" is the one IF2/ID presents, "in EX1" is the one ID/EX1 presents, and so on.
    const inWb = prev.memWb;
    const inMem = prev.ex2Mem;
    const inEx2 = prev.ex1Ex2;
    const inEx1 = prev.idEx1;
    const inId = prev.if2Id;
    const inIf2 = prev.if1If2;

    // Reverse stage order — see the file header for the three invariants this buys.
    this.stageWb(ctx);
    this.stageMem(ctx);
    this.stageEx2(ctx);
    this.stageEx1(ctx);
    this.stageId(ctx);
    this.stageIf2(ctx);
    const inIf1 = this.stageIf1(ctx);

    // The clock edge: latches, the fetch pointer, and the fetch-stop all update together. Staging
    // the last two here (rather than letting EX2/ID poke them mid-walk) is what lets IF1 still do
    // its work this cycle and be squashed after the fact — which is what makes a flush cut the rows
    // it claims to.
    this.latches = ctx.next;
    if (ctx.redirect !== null) this.fetchPc = ctx.redirect;
    if (ctx.stopFetch) this.haltFetch = true;

    // The `flush` event belongs here, at the edge: it is when the kill actually lands, and IF1,
    // which runs last, is the only stage that knows whether it had anything to lose.
    //
    // `stages` names REAL CASUALTIES, and a flush that kills nobody emits no event at all — the
    // schema pins that, and this machine needs the guard on BOTH paths, not just the squash. A
    // branch at the end of `.text` bets with the fetch pointer already out of text and can kill
    // nothing; and under prediction=ON the correction's own EX1/ID slots are routinely bubbles left
    // by that earlier bet, which is why the four checks below are the common path rather than
    // paranoia. Over-reporting here would not be a cosmetic bug: `buildPipelineMap` resolves a
    // victim with a singular `find` on `location`, so a named-but-empty stage silently records no
    // victim at all.
    const occupant: Readonly<Record<Stage, FetchLatch | Fetched | null>> = {
      EX1: inEx1,
      ID: inId,
      IF2: inIf2,
      IF1: inIf1,
      // Never squashed; present only so the record is total over Stage.
      EX2: inEx2,
      MEM: inMem,
      WB: inWb,
    };
    if (ctx.squash !== null) {
      // Program order, oldest first — the same rule `instructions[]` uses. A halt is decoded in ID,
      // so it kills only what is younger than ID; a branch resolves in EX2 and kills all four.
      const from = ctx.squash === 'branch' ? SQUASHABLE : (['IF2', 'IF1'] as const);
      const stages = from.filter((s) => occupant[s] !== null);
      if (stages.length > 0) {
        ctx.events.push({
          type: 'flush',
          reason: ctx.squash === 'branch' ? squashReason(inEx2) : 'halt',
          stages: [...stages],
        });
      }
    } else if (ctx.bet) {
      // The BET's casualties. A CORRECT prediction still kills something — the front end had
      // already fetched two fall-through instructions — and those are precisely the "2" in "a
      // correctly predicted taken branch costs 2, not 0" on a machine this deep. Emitting only on
      // misprediction would be the easy mistake: the cost would be invisible to every consumer that
      // counts casualties, and the map would draw a free prediction the machine never made.
      //
      // Never ID: that instruction IS the branch.
      const stages = (['IF2', 'IF1'] as const).filter((s) => occupant[s] !== null);
      if (stages.length > 0) {
        ctx.events.push({ type: 'flush', reason: 'branch-predicted-taken', stages: [...stages] });
      }
    }

    // Halt-with-drain, asserted rather than assumed. `halted` may only be raised once the pipe is
    // empty; raising it early would strand in-flight instructions and silently truncate the run.
    if (this.halted && (this.ifSlot !== null || this.occupied(this.latches))) {
      throw new Error(
        `deep-pipeline: halted at cycle ${this.cycle} with instructions still in flight — the pipe did not drain`,
      );
    }

    // In-flight instructions in PROGRAM ORDER, oldest (nearest retirement) first.
    const instructions: InstructionInstance[] = [];
    const place = (holder: FetchLatch | null, location: Stage): void => {
      if (holder === null) return;
      instructions.push({
        id: holder.instr,
        pc: holder.pc,
        encoding: holder.ir,
        sourceLine: this.sourceMap.get(holder.pc) ?? null,
        decoded: holder.decoded,
        location,
      });
    };
    place(inWb, 'WB');
    place(inMem, 'MEM');
    place(inEx2, 'EX2');
    place(inEx1, 'EX1');
    place(inId, 'ID');
    place(inIf2, 'IF2');
    place(inIf1 === null ? null : toLatch(inIf1), 'IF1');

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
   * WB — write the result back and RETIRE. This is the only place architectural state's `pc` moves
   * and the only place `halted` is raised, which is what makes halt-with-drain fall out of one rule
   * instead of two special cases.
   */
  private stageWb(ctx: CycleCtx): void {
    const mw = ctx.prev.memWb;
    if (mw === null) return;

    if (mw.rd !== 0) {
      if (mw.writeValue === null) {
        throw new Error(
          `deep-pipeline: ${mw.decoded.mnemonic} writes x${mw.rd} but MEM/WB carries no value`,
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

  /**
   * MEM — the one data-memory access, and where a load's datum finally exists. Exactly one cycle,
   * always: this machine has no cache (see {@link reset}), which is the scope lever that keeps M6's
   * variable-latency freeze out of the MVP's path entirely.
   */
  private stageMem(ctx: CycleCtx): void {
    const em = ctx.prev.ex2Mem;
    if (em === null) return;

    const mnemonic = em.decoded.mnemonic;
    let mdr: number | null = null;
    let writeValue = em.writeValue;

    if (isLoad(em.decoded) || STORES.has(mnemonic)) {
      if (em.aluOut === null) {
        throw new Error(`deep-pipeline: ${mnemonic} reaches MEM with no effective address latched`);
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
          throw new Error(`deep-pipeline: ${mnemonic} reaches MEM with no store datum latched`);
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
   * EX2 — compute, and resolve control flow. The SECOND execute cycle, and the first moment this
   * machine has an answer: the ALU runs here, `alu-op` fires here, and every branch AND jump
   * resolves here (pinned 2026-07-27). There is no ID comparator, so `jal` and `jalr` are not
   * special cases, and `jalr` differs only in that a REGISTER supplies its target — which the
   * EX1-targeted forwarding already covered a cycle ago.
   *
   * Nothing forwards INTO this stage: its operands were fixed at the start of EX1 and ride the
   * {@link Ex1Ex2Latch}. That is what makes "the end of EX2" the single answer to when a result
   * exists, and it is why the ALU→ALU consumer had to wait.
   *
   * EX2 is never squashed — it is the oldest stage that can raise a squash.
   */
  private stageEx2(ctx: CycleCtx): void {
    const ee = ctx.prev.ex1Ex2;
    if (ee === null) return; // a bubble: nothing to execute

    const d = ee.decoded;
    const { imm, mnemonic } = d;
    const shamt = imm & 0x1f; // shift amount: low 5 bits, for both reg- and imm-shifts

    // A null operand where the execute logic wants one means `sourceRegs()` and this switch
    // disagree — the hazard unit's worst bug class, since every stall and forward keys off the
    // former while the VALUE comes from the latter. Fail loudly at author time.
    const opA = (): number => {
      if (ee.opA === null)
        throw new Error(`deep-pipeline: ${mnemonic} reads rs1 but EX1 latched no A`);
      return ee.opA;
    };
    const opB = (): number => {
      if (ee.opB === null)
        throw new Error(`deep-pipeline: ${mnemonic} reads rs2 but EX1 latched no B`);
      return ee.opB;
    };
    // The reference's `s()`/`u()` register views, over the operands EX1 resolved.
    const sa = (): number => opA();
    const ua = (): number => opA() >>> 0;
    const sb = (): number => opB();
    const ub = (): number => opB() >>> 0;

    let aluOut: number | null = null;
    let writeValue: number | null = null;
    let storeData: number | null = null;
    let nextPc = (ee.pc + 4) >>> 0;
    /** Set for every control transfer; a wrong prediction drives the flush. Null for everything else. */
    let taken: boolean | null = null;

    const alu = (op: string, a: number, b: number, result: number): number => {
      ctx.events.push({
        type: 'alu-op',
        op,
        a: a | 0,
        b: b | 0,
        result: result | 0,
        instr: ee.instr,
      });
      aluOut = result | 0;
      return aluOut;
    };
    const produce = (value: number): void => {
      writeValue = value | 0;
    };

    switch (mnemonic) {
      // --- U-type: imm already holds imm[31:12] in place (no extra shift). No ALU work: the value
      //     is a pass-through / dedicated adder, so no `alu-op` fires (mirrors the reference's
      //     event set). The two-cycle execute is still UNIFORM — these take EX1 and EX2 like
      //     everything else, which is why a `lui` stalls its consumer while emitting no `alu-op`. ---
      case 'lui':
        produce(imm);
        break;
      case 'auipc':
        produce((ee.pc + imm) | 0);
        break;

      // --- Jumps: imm is a sign-extended, byte-scaled offset ---
      case 'jal':
        produce((ee.pc + 4) | 0);
        nextPc = (ee.pc + imm) >>> 0;
        taken = true;
        break;
      case 'jalr': {
        const sum = alu('add', sa(), imm, (sa() + imm) | 0); // ALU computes rs1 + imm...
        nextPc = (sum & ~1) >>> 0; // ...then bit 0 is cleared
        produce((ee.pc + 4) | 0);
        taken = true;
        break;
      }

      // --- Branches: signed vs unsigned compares; imm is the byte-scaled offset. The ALU
      //     evaluates the condition (result = taken?1:0); the branch unit selects the pc. ---
      case 'beq':
        taken = sa() === sb();
        alu('beq', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (ee.pc + imm) >>> 0;
        break;
      case 'bne':
        taken = sa() !== sb();
        alu('bne', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (ee.pc + imm) >>> 0;
        break;
      case 'blt':
        taken = sa() < sb();
        alu('blt', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (ee.pc + imm) >>> 0;
        break;
      case 'bge':
        taken = sa() >= sb();
        alu('bge', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (ee.pc + imm) >>> 0;
        break;
      case 'bltu':
        taken = ua() < ub();
        alu('bltu', ua(), ub(), taken ? 1 : 0);
        if (taken) nextPc = (ee.pc + imm) >>> 0;
        break;
      case 'bgeu':
        taken = ua() >= ub();
        alu('bgeu', ua(), ub(), taken ? 1 : 0);
        if (taken) nextPc = (ee.pc + imm) >>> 0;
        break;

      // --- Loads: effective addr = rs1 + imm. `writeValue` stays NULL — the datum arrives at MEM,
      //     and that null is what makes the load unforwardable from EX2/MEM. ---
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

    // Every control transfer resolves HERE, at the END of EX2 — the pinned single resolve point. The
    // rule is **squash if the prediction was WRONG**, not "squash if taken": under
    // `'none'`/`'static-not-taken'` nothing is ever predicted taken, so `predicted !== taken`
    // reduces to `taken`; under `static-taken` the two come apart, in both directions.
    if (taken !== null) {
      const predicted = ee.predictedTaken;
      ctx.events.push({
        type: 'branch-resolved',
        instr: ee.instr,
        predicted,
        actual: taken,
        target: nextPc,
      });
      if (predicted !== taken) {
        // `nextPc` is the correction for BOTH directions with no branching on which way we were
        // wrong: the schema defines it as "the resolved next pc, whichever way it went".
        ctx.squash = 'branch'; // the `flush` event itself is emitted at the edge — see step()
        ctx.redirect = nextPc; // applied at the clock edge, AFTER IF1 has fetched the wrong path
      }
      // A CORRECT taken prediction needs no redirect: ID already steered fetch to this exact
      // address (M4 step 0's pinned safety property). The bet's own casualties — the two
      // fall-through slots the front end had already filled — were flushed back at the bet.
    }

    ctx.next.ex2Mem = {
      instr: ee.instr,
      pc: ee.pc,
      ir: ee.ir,
      decoded: d,
      rd: ee.rd,
      aluOut,
      writeValue,
      storeData,
      nextPc,
      halt: isArchHalt(d),
    };
  }

  /**
   * EX1 — the forwarding network, and NOTHING ELSE. It consumes the two source operands at the
   * START of the cycle and latches them for EX2; it computes no result, so there is nothing for it
   * to hand to a younger instruction. That asymmetry — operands in at EX1, results out at EX2 — is
   * the entire ALU→ALU bubble.
   *
   * A mispredicted transfer in EX2 (which ran earlier in the reverse walk) kills this occupant: it
   * is the oldest of the four casualties.
   */
  private stageEx1(ctx: CycleCtx): void {
    const ie = ctx.prev.idEx1;
    if (ie === null) return; // a bubble: nothing to execute
    // An older mispredicted transfer killed everything younger. EX2 ran before us, so we simply
    // never execute — and `next.ex1Ex2` stays null, the bubble the flush leaves behind.
    if (ctx.squash !== null) return;

    const opA = this.resolveOperand(ctx, ie, 'rs1', ie.decoded.rs1, ie.a);
    const opB = this.resolveOperand(ctx, ie, 'rs2', ie.decoded.rs2, ie.b);

    ctx.next.ex1Ex2 = {
      instr: ie.instr,
      pc: ie.pc,
      ir: ie.ir,
      decoded: ie.decoded,
      rd: ie.rd,
      opA,
      opB,
      predictedTaken: ie.predictedTaken,
    };
  }

  /**
   * The forwarding network: **`EX2/MEM → EX1` and `MEM/WB → EX1`**, with EX2/MEM winning a double
   * match because the younger producer holds the value that is actually current. Two paths, exactly
   * as in the 5-stage — but one stage further from the consumer, because a result does not exist
   * until an instruction has LEFT EX2. There is deliberately no `EX1/EX2 → EX1` path: that latch
   * carries operands, not a result (see {@link Ex1Ex2Latch}).
   *
   * ENUMERATED, not generalized. A rule like "any later latch → EX1" is what
   * `future-microarchitectures.md` pins against, and it would silently invent the very path this
   * model exists to show you cannot have.
   *
   * **Reads `ctx.prev`, never `ctx.next`.** EX2 runs earlier in the reverse walk and has already
   * written `next.ex2Mem` — forwarding from it would take a value out of an instruction that is
   * still in EX2 this cycle and erase the bubble.
   *
   * With the toggle OFF no forward paths exist at all: the register file is the only route, and the
   * ID interlock has already held the consumer until the value is there.
   */
  private resolveOperand(
    ctx: CycleCtx,
    ie: IdEx1Latch,
    port: 'rs1' | 'rs2',
    reg: number,
    latched: number | null,
  ): number | null {
    if (latched === null) return null; // this instruction reads nothing on this port
    if (!this.forwarding) return latched;
    // Never forward TO x0: it is hardwired zero, not a value that anyone produces.
    if (reg === 0) return latched;

    const take = (from: string, value: number): number => {
      ctx.events.push({ type: 'forward', from, to: `EX1.${port}`, value, instr: ie.instr });
      return value;
    };

    // `rd === 0` covers both "writes nothing" and "writes x0", so this test never forwards FROM x0
    // either — the two exclusions the pinned decision asks for come from one comparison.
    const mem = ctx.prev.ex2Mem;
    if (mem !== null && mem.rd === reg) {
      if (mem.writeValue === null) {
        // Unreachable: the only producer with no value at EX2/MEM is a LOAD, and a load in MEM with
        // its consumer in EX1 is exactly what the two-stage load-use interlock makes impossible.
        // If this fires, the hazard unit and the forwarding network have drifted apart.
        throw new Error(
          `deep-pipeline: ${mem.decoded.mnemonic} in MEM has no forwardable value for x${reg} — the load-use stall did not fire`,
        );
      }
      return take('EX2/MEM', mem.writeValue);
    }

    const mw = ctx.prev.memWb;
    if (mw !== null && mw.rd === reg && mw.writeValue !== null) {
      return take('MEM/WB', mw.writeValue);
    }

    return latched;
  }

  /**
   * ID — decode, detect hazards, read the register file, place the bet. WB has already run this
   * cycle, so the read below sees a value written back in this very cycle (the pinned same-cycle
   * WB→ID rule), which is what keeps the forwarding-OFF penalty at 3 rather than 4.
   */
  private stageId(ctx: CycleCtx): void {
    const fd = ctx.prev.if2Id;
    if (fd === null) return; // nothing in ID
    // An older mispredicted transfer killed everything younger. EX2 ran before us, so we simply
    // never execute: no reads, no hazard detection, no chance of a squashed shadow polluting the
    // trace with a phantom stall or a `forward` the timing suite would read.
    if (ctx.squash !== null) return;

    const d = fd.decoded;
    const src = sourceRegs(d);

    const reason = this.detectHazard(ctx, src);
    if (reason !== null) {
      ctx.events.push({ type: 'stall', reason, stage: 'ID', instr: fd.instr });
      ctx.stalled = true;
      ctx.next.idEx1 = null; // a bubble goes down the pipe...
      ctx.next.if2Id = fd; // ...and this instruction stays right here in ID
      return;
    }

    const a = src.rs1 === null ? null : this.readReg(ctx, fd.instr, src.rs1);
    const b = src.rs2 === null ? null : this.readReg(ctx, fd.instr, src.rs2);

    // An architectural halt stops fetching HERE, at decode, and squashes everything younger — which
    // on this machine is TWO shadows (IF2 and IF1), not the 5-stage's one. Killing only one would
    // let the survivor advance into ID and execute, and the hazard that removes is a committed SIDE
    // EFFECT: a shadow STORE would sit in MEM the same cycle the halt sits in WB, making
    // architectural memory depend on intra-cycle stage order. The shadows are not hypothetical —
    // `call-return.s` puts the real `max:` function directly behind its `ecall`.
    if (isArchHalt(d)) {
      ctx.stopFetch = true; // applied at the clock edge, so IF1 still fetches the shadow to kill
      ctx.squash = 'halt'; // the `flush` event itself is emitted at the edge — see step()
    }

    // The BET. Everything above this line has already established that this instruction is real: it
    // survived the `ctx.squash` early-return at the top (so it is not in an older transfer's shadow)
    // and it did not stall. A bet placed before that return would let a WRONG-PATH instruction steer
    // the fetch pointer, overwriting the very redirect that condemned it. The reverse walk (EX2
    // before ID) is what makes "the correction always beats the bet" structural rather than a rule.
    //
    // `predictTaken` gates it, so under 'none'/'static-not-taken' this is dead. A halt is not a
    // transfer, so the `isArchHalt` squash above cannot coincide with a bet.
    const target = this.predictTaken ? speculativeTarget(d, fd.pc) : null;
    if (target !== null) {
      ctx.bet = true;
      ctx.redirect = target; // applied at the clock edge, AFTER IF1 has fetched the fall-through
      // The bet's own event, emitted HERE rather than left to be inferred from the `flush` it
      // usually causes. The two are different facts and they come apart: a branch at the end of
      // `.text` bets — redirecting the pc — while the front end has nothing to kill, and emits no
      // flush. Without this event the bet would be unobservable in the cycle it happens.
      ctx.events.push({ type: 'branch-predicted', instr: fd.instr, target });
    }

    ctx.next.idEx1 = {
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
   * The hazard-detection unit — and the place where depth changes the machine's SHAPE rather than
   * its timing. It watches THREE older stages where the 5-stage watched two, and the extra one is
   * not bookkeeping: it is the direct consequence of "nothing is finished until the end of EX2".
   *
   * **Forwarding ON** — the consumer will be in EX1 next cycle, and takes its operands at the start
   * of that cycle. So ask: where will the producer be then, and is its value in a forwardable latch?
   *
   *  - Producer in **EX1** now ⇒ in EX2 next cycle, holding operands, not a result. STALL. This is
   *    the ALU→ALU bubble the 5-stage does not have, and it is `'ex-latency'` rather than `'raw'`
   *    (which is pinned repo-wide to mean "forwarding is off") or `'alu-use'` (which would lie
   *    about `lui`/`auipc`/`jal`, who stall a consumer while running no ALU).
   *  - Producer is a **load in EX1 or EX2** now ⇒ in EX2 or MEM next cycle, and its datum does not
   *    exist until the end of MEM. STALL — twice, which is the load-use penalty of 2.
   *  - Producer in **MEM** now ⇒ in WB next cycle, value in MEM/WB. Forward, no stall.
   *  - Producer in **EX2** now (non-load) ⇒ in MEM next cycle, value in EX2/MEM. Forward, no stall.
   *
   * **Forwarding OFF** — the register file is the only path, so the consumer waits in ID until the
   * producer's WB. A producer in WB *this* cycle is NOT a hazard (WB ran first in the walk, so the
   * read that follows already sees its value), which is what makes a distance-1 RAW a 3-cycle stall
   * rather than a 4-cycle one.
   */
  private detectHazard(ctx: CycleCtx, src: SourceRegs): string | null {
    // `rd !== 0` excludes both "writes nothing" and x0 (hardwired zero: never a dependency).
    const reads = (rd: number): boolean => rd !== 0 && (rd === src.rs1 || rd === src.rs2);
    const inEx1 = ctx.prev.idEx1;
    const inEx2 = ctx.prev.ex1Ex2;
    const inMem = ctx.prev.ex2Mem;

    if (this.forwarding) {
      // Two explicit checks, one per execute stage — NOT a loop over "any execute stage", which is
      // precisely the generalization `future-microarchitectures.md` pins against.
      if (inEx1 !== null && isLoad(inEx1.decoded) && reads(inEx1.rd)) return 'load-use';
      if (inEx2 !== null && isLoad(inEx2.decoded) && reads(inEx2.rd)) return 'load-use';
      // Every other producer still in its FIRST execute cycle. Uniformly two cycles, so this is
      // every class that writes a register, ALU or not.
      if (inEx1 !== null && reads(inEx1.rd)) return 'ex-latency';
      return null;
    }

    if (inEx1 !== null && reads(inEx1.rd)) return 'raw';
    if (inEx2 !== null && reads(inEx2.rd)) return 'raw';
    if (inMem !== null && reads(inMem.rd)) return 'raw';
    return null;
  }

  private readReg(ctx: CycleCtx, instr: string, reg: number): number {
    const value = this.registers[reg]!;
    ctx.events.push({ type: 'reg-read', reg, value, instr });
    return value;
  }

  /**
   * IF2 — the second half of the fetch path. It performs no new work: it hands its occupant to ID,
   * holds it when ID cannot accept it, or dies. **The cycle it occupies IS its content** — a
   * two-deep front end is what makes an ID bet cost 2 and a misprediction cost 4, and those are the
   * numbers the timing matrix pins. See the file header for what "stub IF2" means as a mutation.
   *
   * Under a stall it re-presents its occupant into the latch it arrived on (`next.if1If2`), which is
   * the same rule ID follows — each stage holds its OWN occupant, and IF1 (later in the walk) keeps
   * its slot rather than handing it over.
   */
  private stageIf2(ctx: CycleCtx): void {
    const held = ctx.prev.if1If2;
    if (held === null) return; // a bubble

    if (ctx.squash !== null || ctx.bet) {
      // Whatever IF2 holds dies, and nothing enters ID. A squash is an older instruction's
      // correction; a bet is ID's own steer, which does not kill ID but does kill everything the
      // front end has already fetched.
      return; // `next.if2Id` stays null
    }

    if (ctx.stalled) {
      ctx.next.if1If2 = held; // hold it right here in IF2; ID already re-presented its own occupant
      return;
    }

    ctx.next.if2Id = held;
  }

  /**
   * IF1 — address generation, the instruction-memory read, and the stable id. Returns the
   * instruction occupying IF1 this cycle, which is what a stall makes visible: the younger
   * instruction sits in IF1 for a second cycle (the repeated cell in every textbook pipeline
   * diagram) rather than being re-fetched under a new id, which would break INV-4 and emit
   * `instr-fetch` twice.
   */
  private stageIf1(ctx: CycleCtx): Fetched | null {
    // Fetch FIRST, squash afterwards. IF1 does its work every cycle; a flush kills the result at the
    // clock edge rather than preventing the work — which is exactly why a mispredicted transfer cuts
    // FOUR rows and why an `ecall`'s shadows are real instructions that show up and die rather than
    // never existing. Both `fetchPc` and `haltFetch` are read here at their PRE-edge values (EX2's
    // redirect and ID's stop are staged in `ctx`), so this fetch is the fall-through one the machine
    // really made.
    //
    // Reuse the instruction held over from a stall, else fetch a new one. Fetching stops for exactly
    // two reasons — an architectural halt decoded in ID, or the fetch pointer leaving `.text` — and
    // neither is a halt: the pipe drains and halts at the last retire. The out-of-text test is not a
    // sticky flag, so a transfer that redirects back into text resumes fetching for free.
    let slot = this.ifSlot;
    if (slot === null && !this.haltFetch && this.inText(this.fetchPc)) {
      slot = this.fetchOne(ctx);
    }

    if (ctx.squash !== null || ctx.bet) {
      // Whatever IF1 holds dies. Under a bet the fall-through it just fetched is off the predicted
      // path; the difference from a squash is invisible here and decisive two stages up, where ID's
      // own instruction — the branch doing the predicting — is NOT killed.
      this.ifSlot = null;
      return slot; // it was here this cycle, and it dies here
    }

    if (ctx.stalled) {
      // Hold it in IF1. IF2 (earlier in the walk) already re-presented its own occupant into
      // `next.if1If2`, so IF1 must not touch that latch — only keep its own occupant for next cycle.
      this.ifSlot = slot;
    } else {
      this.ifSlot = null;
      ctx.next.if1If2 = slot === null ? null : toLatch(slot);
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
    return (
      l.if1If2 !== null ||
      l.if2Id !== null ||
      l.idEx1 !== null ||
      l.ex1Ex2 !== null ||
      l.ex2Mem !== null ||
      l.memWb !== null
    );
  }

  /**
   * An independent full-state snapshot — what each CycleTrace carries (handoff §6). The latch
   * objects are immutable and rebuilt each cycle, so copying the container is enough to keep every
   * recorded cycle's `micro` genuinely its own. (The 5-stage's one exception — the single-buffered
   * cache — does not exist here: this machine has no cache.)
   */
  private snapshotState(latches: Latches): MachineState {
    const micro: DeepPipelineMicro = {
      if1If2: latches.if1If2,
      if2Id: latches.if2Id,
      idEx1: latches.idEx1,
      ex1Ex2: latches.ex1Ex2,
      ex2Mem: latches.ex2Mem,
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
