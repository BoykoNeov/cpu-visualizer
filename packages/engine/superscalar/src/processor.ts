/**
 * The in-order SUPERSCALAR (roadmap §12, tier 4) behind the {@link Processor} interface (§6): the
 * FOURTH microarchitecture, and the first one that breaks the property every earlier model leaned
 * on — **stage position is identity**. From single-cycle through the cached 5-stage pipeline,
 * "the instruction in EX" named exactly one instruction. Here a stage has `issueWidth` SLOTS, and
 * naming an occupant takes a stage *and* a slot.
 *
 * ## What this file is, at M7 step 2a
 *
 * A faithful port of `@cpu-viz/engine-pipeline`'s `PipelineProcessor`, restructured so every latch
 * is SLOT-SHAPED, but running at **width 1 only** — there is no pairing logic yet (step 2b). That
 * is deliberate, and it is the milestone's bisection anchor: a width-1 superscalar never pairs, so
 * it must reproduce M3's closed form `cycles = N + 4 + S + P + M` over the whole corpus. Proving
 * THAT before pairing exists de-risks "did I re-implement the pipeline faithfully" while the answer
 * is still a single number per (program × config) rather than a pairing verdict per cycle.
 * `reset()` therefore THROWS on any `issueWidth` other than 1: an honest "not yet" beats a model
 * that silently runs narrow while the toggle says otherwise.
 *
 * The ISA semantics — the arithmetic, the `s`/`u` signed/unsigned views, `imm & 0x1f`, the `>>> 0`
 * at the memory boundary — are mirrored VERBATIM from the golden reference, exactly as every other
 * model mirrors them. We do NOT import the reference at runtime (eslint forbids it, and INV-8's
 * whole design is that the differential PROVES the copy faithful rather than the import assuming
 * it). We likewise do not import the pipeline: models import no sibling model, only `engine-common`.
 *
 * ## Slots, and why the latches are arrays
 *
 * `PipelineProcessor.Latches` is four nullable SINGLETONS. Here each is an array of `width` slots,
 * and **index 0 is the OLDEST in program order**. `ifSlot` — the IF stage's occupants, which have
 * no latch to live in (five stages, four latches) — is an array for the same reason. At width 1
 * every array has length 1 and the behaviour is byte-for-byte M3's.
 *
 * The stage walk iterates slots rather than indexing `[0]`, so step 2b's job is to make the issue
 * logic FILL slot 1 — not to rewrite the walk. Nothing here is written as if slot 0 were the only
 * one, even where at width 1 it is.
 *
 * ## Per-slot vs broadcast — the split that IS the milestone
 *
 * The three pinned pairing rules (no two memory ops pair, no two branches pair, no intra-pair RAW)
 * confine the widening: what genuinely doubles is fetch, the register-read ports, the ALU, the WB
 * write ports and the forwarding source set. Control and memory stay 1-wide BY THE RULES. So:
 *
 *  - **`memStall` is BROADCAST.** A miss freezes both slots of every younger stage — memory is
 *    single-ported, so a stall there is a property of the machine, not of a lane.
 *  - **`squash` is LANE-AWARE**: it carries the resolving slot alongside the reason, because a
 *    slot-0 branch kills its slot-1 mate while a slot-1 branch spares the older slot-0. At width 1
 *    the resolving slot is always 0 and everything in a younger stage dies, which is M3 exactly.
 *  - **`stalled`** (load-use) keeps a SINGLE-LANE producer but freezes a whole pair: the interlock
 *    is decided by one instruction's sources and applied to the stage.
 *  - **`bet`** stays the single-casualty boolean it is in M3 — branches never pair, so a bet is
 *    placed by at most one instruction per cycle.
 *
 * ## Everything else is M3, unchanged
 *
 * The latches are double-buffered (read `prev`, fill `next`); stages are walked in REVERSE
 * (WB→MEM→EX→ID→IF) so the same-cycle WB→ID read works, `reg-write` precedes `reg-read` in
 * `events[]`, and each control signal's consumer runs after its producer. `pc` moves only at
 * retire and `halted` rises only when the pipe is empty (halt with drain). Flushes are emitted at
 * the clock edge and name REAL casualties. The one deliberate difference from M3 is the
 * `location` encoding — see {@link SuperscalarProcessor.step}.
 *
 * Determinism (INV-1) and obliviousness to rendering/depth tiers (INV-2) hold as always. See
 * `docs/plans/m7-tasks.md`.
 */

import { decode, defForMnemonic, type DecodedInstruction } from '@cpu-viz/isa';
import { speculativeTarget, access, newCache, type CacheState } from '@cpu-viz/engine-common';
import {
  defaultConfig,
  makeRegisters,
  SparseMemory,
  type CacheConfig,
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
 * The five pipeline stages. Unlike M3's, this is NOT `InstructionInstance.location` verbatim: a
 * location here is `"<stage>.<slot>"` (see {@link SuperscalarProcessor.step}).
 */
export type Stage = 'IF' | 'ID' | 'EX' | 'MEM' | 'WB';

/** IF/ID — a fetched word on its way to be decoded, and the base every later latch extends. */
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
   * "writes nothing" deliberately coincide: a write to x0 is discarded, so one value says both.
   * This is NOT `decoded.rd` — for an S/B-format word those bits are part of the immediate.
   */
  readonly rd: number;
  /** `Reg[rs1]` as read from the register file at ID, PRE-forwarding; null if rs1 is no source. */
  readonly a: number | null;
  /** `Reg[rs2]` as read at ID, PRE-forwarding; null if rs2 is no source. */
  readonly b: number | null;
  /**
   * The BET ID placed on this instruction: did ID steer fetch to its target? Always `false` under
   * `'none'`/`'static-not-taken'`, where fetch simply carries on. A boolean rather than the
   * predicted target, because `speculativeTarget` provably equals EX's `nextPc` for every taken
   * PC-relative transfer (M4 step 0) — carrying the address would carry a value whose only use is
   * a comparison that cannot fail.
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
   * exist until MEM has run. That null is not an omission: it is the load-use hazard itself.
   */
  readonly writeValue: number | null;
  /** `Reg[rs2]` after forwarding — the datum a store writes. Null unless this is a store. */
  readonly storeData: number | null;
  /** Where pc goes when this instruction retires (already branch-resolved). */
  readonly nextPc: number;
  /** An architectural halt (`ecall`/`ebreak`/unknown): pc does not advance past it. */
  readonly halt: boolean;
  /**
   * Penalty cycles this instruction still owes in MEM before it may advance to WB. `0` on a hit,
   * with no cache configured, and at the moment EX first hands the instruction to MEM. MEM sets it
   * to `missPenalty` on the cycle it detects a miss and decrements it each subsequent cycle; while
   * it is non-zero the front of the pipe is frozen and WB bubbles.
   */
  readonly missCyclesRemaining: number;
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
 * The superscalar's `MachineState.micro` (the §5 per-model extension point): the four inter-stage
 * latches, each an ARRAY OF SLOTS — which is the one structural difference from `PipelineMicro`
 * and the whole reason this is a sibling package rather than a config of M3's. `null` in a slot is
 * a BUBBLE (a stall inserts one, a flush leaves one behind, and at width 2 an unpaired issue leaves
 * one in slot 1). Index 0 is the OLDEST occupant in program order.
 *
 * Every latch object is IMMUTABLE and rebuilt from scratch each cycle, and the slot ARRAYS are
 * copied into each snapshot, never aliased. That is what satisfies the same independent-per-cycle
 * requirement `registers`/`memory` have: the recorder keeps every cycle, so an aliased array would
 * replay as latest-values-everywhere. Final-state conformance cannot see that bug — only
 * time-travel can.
 */
export interface SuperscalarMicro {
  /** Issue width in force for this run — 1 or 2. Every array below has exactly this length. */
  readonly width: number;
  readonly ifId: readonly (IfIdLatch | null)[];
  readonly idEx: readonly (IdExLatch | null)[];
  readonly exMem: readonly (ExMemLatch | null)[];
  readonly memWb: readonly (MemWbLatch | null)[];
  /**
   * The D-cache's tag/valid state, or `null` when no cache is configured. DEEP-COPIED into every
   * snapshot because — unlike the latches, which are immutable and rebuilt each cycle — the cache
   * is single-buffered and mutated in place; a shallow copy would alias one final cache across
   * every recorded cycle and replay as warm-from-the-start.
   */
  readonly cache: CacheState | null;
}

/**
 * The superscalar honors EVERY config knob in the family — it is the first model to do so, and the
 * fourth flag is what it exists for. `configurableIssueWidth: true` is the claim that flipping
 * 1 ↔ 2 changes the machine; at step 2a only the width-1 position is implemented, and `reset()`
 * refuses the other loudly rather than pretending.
 *
 * The other three are honored exactly as the pipeline honors them, because this model is that
 * pipeline with slot-shaped latches: `'none'` and `'static-not-taken'` remain one machine (a
 * processor with no predictor does not stop and wait — it keeps fetching, and the fall-through IS
 * the not-taken path), and the cache remains a timing shadow that holds tags and never values.
 */
export const SUPERSCALAR_CAPABILITIES: ProcessorCapabilities = {
  model: 'superscalar',
  pipelined: true,
  hasHazards: true,
  configurableForwarding: true,
  configurableBranchPrediction: true,
  configurableCache: true,
  configurableIssueWidth: true,
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
 * is what makes it safe for the hazard unit to key off. Every stall, every forward, and every x0
 * exclusion is decided from this, so a class listed here that the reference does not actually read
 * from would stall on a dependency that does not exist (invisible to INV-8, which only sees final
 * state), and one missing would forward nothing where a forward was needed. At width 2 it will
 * additionally decide intra-pair RAW, so its fidelity gets MORE load-bearing, not less.
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

/**
 * The four latches, double-buffered per cycle — each one an array of `width` SLOTS rather than the
 * pipeline's single nullable occupant. Index 0 is the oldest in program order.
 */
interface Latches {
  ifId: (IfIdLatch | null)[];
  idEx: (IdExLatch | null)[];
  exMem: (ExMemLatch | null)[];
  memWb: (MemWbLatch | null)[];
}

/** A fresh, wholly-empty latch set of `width` slots. Never shared between cycles. */
const emptyLatches = (width: number): Latches => ({
  ifId: emptySlots<IfIdLatch>(width),
  idEx: emptySlots<IdExLatch>(width),
  exMem: emptySlots<ExMemLatch>(width),
  memWb: emptySlots<MemWbLatch>(width),
});

const emptySlots = <T>(width: number): (T | null)[] => new Array<T | null>(width).fill(null);

/** Is any slot of this stage occupied? */
const anyOccupied = (slots: readonly (unknown | null)[]): boolean => slots.some((s) => s !== null);

/**
 * An instruction sitting in the IF stage — fetched, but not yet latched into IF/ID. It is a
 * distinct thing from the IF/ID latch: five stages, four latches, so the IF stage's occupants have
 * nowhere to live but here. A stall is exactly the case where the two differ for a whole cycle.
 */
interface Fetched {
  readonly id: string;
  readonly pc: number;
  readonly word: number;
  readonly decoded: DecodedInstruction;
}

/** An IF-stage occupant, as it will be presented on the IF/ID latch at the clock edge. */
function toLatch(f: Fetched): IfIdLatch {
  return { instr: f.id, pc: f.pc, ir: f.word, decoded: f.decoded };
}

/**
 * Why everything younger than the deciding stage is being killed this cycle — and, unlike M3's bare
 * reason string, WHICH SLOT decided. That field is the lane-awareness the plan pins: a slot-0
 * branch kills its slot-1 mate as well as everything behind, while a slot-1 branch spares the older
 * slot-0 beside it. At width 1 `slot` is always 0 and every younger-stage occupant dies, which is
 * M3's rule exactly; step 2b is where the field starts discriminating.
 */
interface Squash {
  readonly reason: 'branch' | 'halt';
  /** The slot of the instruction that raised it, in the stage that raised it. */
  readonly slot: number;
}

/**
 * The `flush.reason` for an EX correction, named for what the machine LEARNED. `'branch-taken'`
 * keeps its M3/M4 meaning: predict-not-taken can only ever be wrong about a branch that WAS taken,
 * while a `static-taken` bet on a branch that then declines corrects with `actual === false` and
 * must not claim the opposite of what happened. Each reason states the fact that killed you.
 */
function squashReason(resolver: IdExLatch | null): string {
  // `resolver` is the instruction that resolved this cycle: EX is the only stage that raises
  // 'branch', and — branches never pair — exactly one slot of it can have done so.
  return resolver !== null && resolver.predictedTaken ? 'branch-not-taken' : 'branch-taken';
}

/** The mutable working set for one cycle: read `prev`, fill `next`, collect events and signals. */
interface CycleCtx {
  readonly prev: Latches;
  readonly next: Latches;
  readonly events: TraceEvent[];
  /**
   * Raised by ID; read by IF, which then holds its instructions instead of handing them over. A
   * SINGLE-LANE producer that freezes a whole pair: the interlock is decided by one instruction's
   * sources, but a stage cannot half-advance, so both slots hold.
   */
  stalled: boolean;
  /**
   * Raised by MEM on a cache miss, read by the three stages younger than it in the reverse walk
   * (EX, ID, IF), which then FREEZE their occupants in place — while MEM re-presents the waiting
   * instruction and WB bubbles. **BROADCAST, deliberately**: memory is single-ported (no two memory
   * ops ever pair), so a miss is a property of the machine and freezes BOTH slots of every younger
   * stage. Highest priority: while it is set, EX/ID/IF do their freeze and none of them raise
   * `stalled`/`squash`/`bet`, so it never coexists with those.
   */
  memStall: boolean;
  /** Raised by EX (taken transfer) or ID (architectural halt); read by the stages younger than it. */
  squash: Squash | null;
  /**
   * A taken transfer's target, staged by EX and applied at the END of the cycle. The fetch pointer
   * is a clocked register just like the latches, so the redirect must NOT land mid-walk: IF runs
   * after EX and has to fetch the FALL-THROUGH instruction (which it then squashes), not the
   * target. Applying it early would fetch the target one cycle too early and erase one of the rows
   * the flush is supposed to cut.
   */
  redirect: number | null;
  /**
   * Staged by ID, applied at the end of the cycle, for exactly the same reason: IF must still fetch
   * the shadow instruction behind an `ecall` so the squash has something to kill — `call-return.s`
   * puts live code (`max:`) directly behind its `ecall`.
   */
  stopFetch: boolean;
  /**
   * The ID BET: ID predicted a transfer taken and steered fetch to its target via `redirect`. Read
   * by IF, whose fall-through fetch is now off the predicted path and dies.
   *
   * **Deliberately NOT folded into `squash`, because it kills a different set.** A squash means
   * "everything younger than the deciding stage is wrong" — ID *and* IF. A bet means only "what IF
   * just fetched is not what we now think comes next": the branch in ID is the thing doing the
   * predicting and sails on to EX. That difference IS the reason a correct prediction costs 1
   * instead of 2. It stays a plain boolean at every width, because branches never pair — at most
   * one instruction per cycle can place a bet.
   */
  bet: boolean;
}

export class SuperscalarProcessor implements Processor {
  readonly capabilities = SUPERSCALAR_CAPABILITIES;

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
  /**
   * Slots per stage, from `ProcessorConfig.issueWidth`. **Step 2a implements width 1 only** — the
   * whole point of this step is a faithful single-issue base whose timing reproduces M3's, so the
   * pairing logic that would make any other value meaningful does not exist yet. Every array in
   * this class has exactly this length.
   */
  private width = 1;
  private forwarding = false;
  /**
   * `true` only for `'static-taken'`: `'none'` and `'static-not-taken'` both mean "keep fetching
   * the fall-through", which is one machine under two names. Collapsing the three-valued config to
   * a boolean is the honest encoding of that, rather than a `switch` with two identical arms.
   */
  private predictTaken = false;
  /** The D-cache config, or `null` for the cache-less machine `defaultConfig()` selects. */
  private cacheConfig: CacheConfig | null = null;
  /** The single-buffered tag/valid state, mutated in place by {@link access}; null iff no cache. */
  private cache: CacheState | null = null;
  private latches: Latches = emptyLatches(1);
  /** The IF stage's occupants: fetched this cycle, or held over across a stall. One per slot. */
  private ifSlot: (Fetched | null)[] = emptySlots<Fetched>(1);
  /** Sticky once an architectural halt is decoded: fetch never restarts, the pipe just drains. */
  private haltFetch = false;

  reset(image: ProgramImage, config: ProcessorConfig = defaultConfig()): void {
    // `issueWidth` is OPTIONAL in `ProcessorConfig` (it follows `seed`'s precedent, not `cache`'s),
    // so an absent value means "this caller has no opinion" and gets the machine's own degenerate
    // width — the same default the web toggle will start on.
    const width = config.issueWidth ?? 1;
    if (width !== 1) {
      throw new Error(
        `superscalar: issueWidth ${width} is not implemented yet — M7 step 2a ships the width-1 ` +
          `base (slot-shaped latches, no pairing logic); step 2b adds the issue logic that makes ` +
          `width 2 a real machine. Refusing rather than silently running 1-wide.`,
      );
    }
    this.width = width;
    this.forwarding = config.forwarding;
    this.predictTaken = config.branchPrediction === 'static-taken';
    this.cacheConfig = config.cache;
    this.cache = config.cache === null ? null : newCache(config.cache);
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
    this.latches = emptyLatches(this.width);
    this.ifSlot = emptySlots<Fetched>(this.width);
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
      next: emptyLatches(this.width),
      events: [],
      stalled: false,
      memStall: false,
      squash: null,
      redirect: null,
      stopFetch: false,
      bet: false,
    };

    // Who is where, captured before the walk. `prev` is the start-of-cycle latch state, so the
    // instructions "in ID" are the ones IF/ID presents, "in EX" what ID/EX presents, and so on.
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
    // the last two here (rather than letting EX/ID poke them mid-walk) is what lets IF still do its
    // work this cycle and be squashed after the fact — which is what makes a flush cut the rows it
    // claims to.
    this.latches = ctx.next;
    if (ctx.redirect !== null) this.fetchPc = ctx.redirect;
    if (ctx.stopFetch) this.haltFetch = true;

    // The `flush` event belongs here, at the edge: it is when the kill actually lands, and IF —
    // which runs last — is the only stage that knows whether it had anything to lose.
    //
    // `stages` therefore names REAL CASUALTIES, and a flush that kills nobody emits no event at
    // all. That is a contract choice with three readers (the datapath, the pipeline map's cut rows,
    // and the curriculum, which triggers on a bare `{ event: 'flush' }`): every consumer wants
    // "something died", none wants "a wire went high".
    //
    // The strings stay BARE stage names (`'ID'`, `'IF'`), not slotted — only
    // `InstructionInstance.location` carries a slot. At width 1 a stage has at most one casualty, so
    // there is nothing a slot could disambiguate here; whether `stages` should name slots once a
    // pair can die together is a step-2b question, to be decided against an OBSERVED multi-slot
    // flush rather than guessed at now.
    if (ctx.squash !== null) {
      // Program order, oldest first — the same rule `instructions[]` uses.
      const stages: string[] = [];
      if (ctx.squash.reason === 'branch' && anyOccupied(inId)) stages.push('ID');
      if (anyOccupied(inIf)) stages.push('IF');
      if (stages.length > 0) {
        ctx.events.push({
          type: 'flush',
          reason:
            ctx.squash.reason === 'branch' ? squashReason(inEx[ctx.squash.slot] ?? null) : 'halt',
          stages,
        });
      }
    } else if (ctx.bet && anyOccupied(inIf)) {
      // The BET's casualty. A CORRECT prediction still kills something — the fall-through IF had
      // already fetched — and that discarded instruction is precisely the "1" in "a correctly
      // predicted taken branch costs 1, not 0". Emitting it only on misprediction would make the
      // cost invisible to every consumer that counts casualties.
      //
      // One stage, never two, and no ID check: a bet does not kill ID (that instruction IS the
      // branch). The single-casualty shape is not new — a halt flush has always cut only IF.
      ctx.events.push({ type: 'flush', reason: 'branch-predicted-taken', stages: ['IF'] });
    }

    // Halt-with-drain, asserted rather than assumed. `halted` may only be raised once the pipe is
    // empty; raising it early would strand in-flight instructions and silently truncate the run.
    if (this.halted && (anyOccupied(this.ifSlot) || this.occupied(this.latches))) {
      throw new Error(
        `superscalar: halted at cycle ${this.cycle} with instructions still in flight — the pipe did not drain`,
      );
    }

    // In-flight instructions in PROGRAM ORDER, oldest (nearest retirement) first — stage by stage
    // from WB back to IF, and within a stage slot 0 (the older occupant) first. A stable ordering
    // rule beats a positional one, and it is what makes "oldest first" still well defined once two
    // lanes share a stage.
    //
    // **`location` is `"<stage>.<slot>"`, always — never a bare `"IF"`, even at width 1.** This is
    // the one deliberate trace difference from M3, pinned in the plan, and it costs no schema
    // change: `location` is a plain string and the pipeline map's `stageFamily` already folds
    // `"EX.0"` back to `EX`. Emitting bare names at width 1 and slotted ones at width 2 would make
    // the encoding depend on a config the view cannot see, so every consumer would need both
    // spellings; one spelling everywhere is the honest contract.
    const instructions: InstructionInstance[] = [];
    const place = (slots: readonly (IfIdLatch | null)[], stage: Stage): void => {
      for (let s = 0; s < slots.length; s++) {
        const occupant = slots[s] ?? null;
        if (occupant === null) continue;
        instructions.push({
          id: occupant.instr,
          pc: occupant.pc,
          encoding: occupant.ir,
          sourceLine: this.sourceMap.get(occupant.pc) ?? null,
          decoded: occupant.decoded,
          location: `${stage}.${s}`,
        });
      }
    };
    place(inWb, 'WB');
    place(inMem, 'MEM');
    place(inEx, 'EX');
    place(inId, 'ID');
    place(
      inIf.map((f) => (f === null ? null : toLatch(f))),
      'IF',
    );

    return {
      cycle: this.cycle,
      state: this.snapshotState(this.latches),
      events: ctx.events,
      instructions,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // The stages, in the order they are walked. Each iterates its slots OLDEST FIRST, so intra-cycle
  // event order within a stage is program order — the surface step 2b pins for intra-pair WB.
  // ---------------------------------------------------------------------------------------------

  /**
   * WB — write the results back and RETIRE. This is the only place architectural `pc` moves and the
   * only place `halted` is raised, which is what makes halt-with-drain fall out of one rule instead
   * of two special cases. Slots are applied OLDEST FIRST, so if two slots ever wrote the same
   * register the younger would win architecturally by being applied last (step 2b pins that).
   */
  private stageWb(ctx: CycleCtx): void {
    for (let s = 0; s < this.width; s++) {
      const mw = ctx.prev.memWb[s] ?? null;
      if (mw === null) continue;

      if (mw.rd !== 0) {
        if (mw.writeValue === null) {
          throw new Error(
            `superscalar: ${mw.decoded.mnemonic} writes x${mw.rd} but MEM/WB carries no value`,
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
  }

  /**
   * MEM — the one data-memory access, and where a load's datum finally exists. **This stage stays
   * SINGLE-PORTED at every width** (no two memory ops pair), so at most one slot per cycle can
   * touch the cache; the loop below is over slots because a non-memory instruction may sit beside a
   * memory one, not because two accesses could race.
   *
   * With a cache configured this is the first VARIABLE-LATENCY stage: a hit costs one cycle, a miss
   * holds the instruction here for `missPenalty` extra cycles, freezing the front of the pipe. The
   * cycle splits three ways:
   *
   *   - **Mid-stall** (`missCyclesRemaining > 0`): a miss detected earlier is still being served.
   *     Decrement and keep holding; the memory access does NOT happen until release, so no
   *     `mem-read`/`mem-write` re-fires and — decisively — {@link access} is NOT re-consulted (it
   *     mutated the cache on detection; a second call would now spuriously hit).
   *   - **Fresh arrival with a miss**: consult the cache once (installing the tag and emitting the
   *     lone `cache-access`), then hold. The data access is deferred to the release cycle.
   *   - **Fresh arrival with a hit, no cache, or the release cycle**: do the memory access and build
   *     MEM/WB, exactly as the cache-less machine always has.
   */
  private stageMem(ctx: CycleCtx): void {
    for (let s = 0; s < this.width; s++) {
      const em = ctx.prev.exMem[s] ?? null;
      if (em === null) continue;

      // Mid-stall: a penalty already in progress. Decrement; hold until the release cycle.
      if (em.missCyclesRemaining > 0) {
        const remaining = em.missCyclesRemaining - 1;
        if (remaining > 0) {
          this.holdInMem(ctx, em, s, remaining);
          continue;
        }
        // remaining === 0 ⇒ the release cycle: fall through to the real access + MEM/WB build.
      } else {
        // Fresh arrival. Consult the cache (a no-op when none is configured); a miss starts the hold.
        const penalty = this.consultCache(ctx, em);
        if (penalty > 0) {
          this.holdInMem(ctx, em, s, penalty);
          continue;
        }
      }

      this.completeMem(ctx, em, s);
    }
  }

  /**
   * Hold the miss's instruction in its MEM slot for one more cycle and freeze the pipe.
   * Re-presenting `em` in `next.exMem[slot]` (rather than letting EX overwrite it) is what makes
   * the structural stall work: EX/ID/IF read {@link CycleCtx.memStall} later in the reverse walk and
   * hold their own occupants, and WB gets a bubble (`next.memWb[slot]` stays null) because nothing
   * can retire out of MEM until the datum arrives.
   */
  private holdInMem(ctx: CycleCtx, em: ExMemLatch, slot: number, remaining: number): void {
    ctx.memStall = true; // broadcast: a single-ported miss freezes every younger slot, both lanes
    ctx.next.exMem[slot] = { ...em, missCyclesRemaining: remaining };
    // `next.memWb[slot]` deliberately left null — the WB bubble.
  }

  /**
   * Consult the D-cache for a memory instruction's line, MUTATING the cache and emitting the single
   * `cache-access`. Returns the miss penalty to serve (`0` for a hit, a non-memory instruction, or
   * no configured cache). Loads allocate on a miss; stores do not (no-write-allocate) — the policy
   * name lives here, at the call site, over `engine-common`'s pure `allocate` mechanism.
   *
   * **Store misses stall too**, matching `CacheConfig`'s "a miss costs 1 + missPenalty": with no
   * write buffer modeled, the uniform rule is "every miss pays the penalty".
   */
  private consultCache(ctx: CycleCtx, em: ExMemLatch): number {
    if (this.cacheConfig === null || this.cache === null) return 0;
    const mnemonic = em.decoded.mnemonic;
    const load = isLoad(em.decoded);
    if (!load && !STORES.has(mnemonic)) return 0; // not a memory access: the cache is untouched
    if (em.aluOut === null) {
      throw new Error(
        `superscalar: ${mnemonic} reaches the cache with no effective address latched`,
      );
    }
    const addr = em.aluOut >>> 0;
    const result = access(this.cache, this.cacheConfig, addr, load);
    ctx.events.push({
      type: 'cache-access',
      level: 1,
      addr,
      hit: result.hit,
      ...(result.evicted === undefined ? {} : { evicted: result.evicted }),
    });
    return result.hit ? 0 : this.cacheConfig.missPenalty;
  }

  /**
   * The actual data-memory access and MEM/WB build — the cache-less machine's whole MEM stage,
   * reached either directly (hit / no cache) or on a miss's release cycle. The cache verdict was
   * already taken in {@link consultCache}; this touches only architectural memory.
   */
  private completeMem(ctx: CycleCtx, em: ExMemLatch, slot: number): void {
    const mnemonic = em.decoded.mnemonic;
    let mdr: number | null = null;
    let writeValue = em.writeValue;

    if (isLoad(em.decoded) || STORES.has(mnemonic)) {
      if (em.aluOut === null) {
        throw new Error(`superscalar: ${mnemonic} reaches MEM with no effective address latched`);
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
          throw new Error(`superscalar: ${mnemonic} reaches MEM with no store datum latched`);
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

    ctx.next.memWb[slot] = {
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
   * EX — forward, compute, and resolve control flow, one slot at a time. Every branch AND jump
   * resolves here: the machine has no ID comparator, so `jal` and `jalr` are not special cases, and
   * `jalr` differs only in that a REGISTER supplies its target address (a RAW on control flow
   * itself) — which the same EX-targeted forwarding covers.
   *
   * **Control resolution stays SINGLE-LANE at every width** (no two branches pair), so at most one
   * slot per cycle can raise `squash`/`redirect`; the slot it came from is recorded in the signal.
   */
  private stageEx(ctx: CycleCtx): void {
    for (let s = 0; s < this.width; s++) {
      this.executeSlot(ctx, s);
    }
  }

  private executeSlot(ctx: CycleCtx, slot: number): void {
    const ie = ctx.prev.idEx[slot] ?? null;
    if (ie === null) return; // a bubble: nothing to execute

    // A MEM miss freezes EX: the occupant does NOT execute or advance — it holds in EX (so it
    // executes exactly once, on release) while MEM re-presents its own waiting instruction. MEM ran
    // earlier in the reverse walk and already owns `next.exMem`, so here we only re-present `ie` in
    // EX and return before touching the ALU, the forwarding network, or control resolution.
    if (ctx.memStall) {
      ctx.next.idEx[slot] = ie;
      return;
    }

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
      if (fwdA === null) throw new Error(`superscalar: ${mnemonic} reads rs1 but ID latched no A`);
      return fwdA;
    };
    const opB = (): number => {
      if (fwdB === null) throw new Error(`superscalar: ${mnemonic} reads rs2 but ID latched no B`);
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
      //     reference's event set). ---
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

    // Every control transfer resolves HERE, and the rule is **squash if the prediction was WRONG**.
    // Under `'none'`/`'static-not-taken'` nothing is ever predicted taken, so `predicted !== taken`
    // reduces to `taken`. Under `static-taken` the two come apart, in both directions.
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
        // wrong: the schema defines it as "the resolved next pc, whichever way it went".
        ctx.squash = { reason: 'branch', slot }; // the `flush` event is emitted at the edge
        ctx.redirect = nextPc; // applied at the clock edge, AFTER IF has fetched the wrong path
      }
      // A CORRECT taken prediction needs no redirect: ID already steered fetch to this exact
      // address (M4 step 0's pinned safety property, `speculativeTarget` ≡ EX's `nextPc`). The
      // bet's own casualty — the fall-through IF discarded — was already flushed back at the bet.
    }

    ctx.next.exMem[slot] = {
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
      missCyclesRemaining: 0, // at rest: MEM sets the penalty on the cycle it detects a miss
    };
  }

  /**
   * The forwarding network: EX/MEM→EX and MEM/WB→EX, with EX/MEM winning a double match because the
   * younger producer holds the value that is actually current. The SOURCE SET is what widening
   * grows — it is now every SLOT of both latches — so the scan runs from the highest slot down,
   * i.e. **youngest source first**, which is the same priority rule one stage up expressed within a
   * stage. At width 1 there is one slot per latch and this is M3's rule byte for byte.
   *
   * Intra-pair forwarding (a source in the consumer's OWN stage) does not exist and never will: the
   * pinned rule is that an intra-pair RAW never pairs, precisely because forwarding cannot fix a
   * same-cycle dependency.
   *
   * With the toggle OFF no forward paths exist at all: the register file is the only route, and the
   * ID interlock has already held the consumer until the value is there.
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

    // `rd === 0` covers both "writes nothing" and "writes x0", so this test never forwards FROM x0
    // either — the two exclusions the pinned decision asks for come from one comparison.
    for (let s = this.width - 1; s >= 0; s--) {
      const ex = ctx.prev.exMem[s] ?? null;
      if (ex !== null && ex.rd === reg) {
        if (ex.writeValue === null) {
          // Unreachable: the only producer with no value at EX/MEM is a LOAD, and a load in MEM
          // with its consumer in EX is exactly what the load-use stall exists to make impossible.
          // If this fires, the hazard unit and the forwarding network have drifted apart.
          throw new Error(
            `superscalar: ${ex.decoded.mnemonic} in MEM has no forwardable value for x${reg} — the load-use stall did not fire`,
          );
        }
        return take('EX/MEM', ex.writeValue);
      }
    }

    for (let s = this.width - 1; s >= 0; s--) {
      const mw = ctx.prev.memWb[s] ?? null;
      if (mw !== null && mw.rd === reg && mw.writeValue !== null) {
        return take('MEM/WB', mw.writeValue);
      }
    }

    return latched;
  }

  /**
   * ID — decode, detect hazards, read the register file, and place the bet. WB has already run this
   * cycle, so the read below sees a value written back in this very cycle (the pinned same-cycle
   * WB→ID rule).
   *
   * **Step 2a has no ISSUE LOGIC**: each ID slot simply hands its own occupant to the ID/EX slot of
   * the same index. Step 2b is where a verdict decides whether the two fetched instructions may go
   * together, and a refused younger one becomes the older of the next group.
   */
  private stageId(ctx: CycleCtx): void {
    // A MEM miss freezes ID: hold every occupant here (EX ran earlier and is holding its own, so it
    // did not consume ours) and do nothing else — no reads, no hazard detection, no bet. Highest
    // priority, above the squash check: while a miss is being served nothing younger moves.
    if (ctx.memStall) {
      for (let s = 0; s < this.width; s++) ctx.next.ifId[s] = ctx.prev.ifId[s] ?? null;
      return;
    }
    // An older taken transfer killed everything younger. EX ran before us, so we simply never
    // execute: no reads, no hazard detection, no chance of a squashed shadow polluting the trace
    // with a phantom stall or a `forward` that the timing assertions would read.
    //
    // The squash's slot is not consulted here, and at width 1 it cannot matter: the resolver is in
    // EX, so EVERY occupant of ID is younger than it whatever slot it sat in. Lane-awareness bites
    // WITHIN the resolving stage (a slot-1 branch sparing its slot-0 mate), which is step 2b's
    // business — there is no second slot to spare yet.
    if (ctx.squash !== null) return;

    for (let s = 0; s < this.width; s++) {
      const fd = ctx.prev.ifId[s] ?? null;
      if (fd === null) continue; // nothing in this ID slot

      const d = fd.decoded;
      const src = sourceRegs(d);

      const reason = this.detectHazard(ctx, src);
      if (reason !== null) {
        // `stage` is the BARE stage name, as every model in the family emits it — only
        // `InstructionInstance.location` carries a slot.
        ctx.events.push({ type: 'stall', reason, stage: 'ID', instr: fd.instr });
        ctx.stalled = true; // a single-lane producer that freezes the whole stage
        ctx.next.idEx[s] = null; // a bubble goes down the pipe...
        ctx.next.ifId[s] = fd; // ...and this instruction stays right here in ID
        continue;
      }

      const a = src.rs1 === null ? null : this.readReg(ctx, fd.instr, src.rs1);
      const b = src.rs2 === null ? null : this.readReg(ctx, fd.instr, src.rs2);

      // An architectural halt stops fetching HERE, at decode, and squashes everything younger
      // behind it (everything older is already ahead and retires normally). The shadow is not
      // hypothetical: in `call-return.s` the `ecall` is followed by the real `max:` function — live
      // code. And the hazard the squash removes is a committed SIDE EFFECT, not a pc redirect:
      // under the retire-pc rule a shadow's redirect only moves the fetch pointer, but a shadow
      // STORE one slot behind would sit in MEM the same cycle the halt sits in WB, making
      // architectural memory depend on intra-cycle stage order. Squash instead.
      if (isArchHalt(d)) {
        ctx.stopFetch = true; // applied at the clock edge, so IF still fetches the shadow to kill
        ctx.squash = { reason: 'halt', slot: s }; // the `flush` event is emitted at the edge
      }

      // The BET. Everything above this line has already established that this instruction is real:
      // it survived the `ctx.squash` early-return at the top (so it is not in an older transfer's
      // shadow) and it did not stall. Both matter, and the first is load-bearing enough to state —
      // a bet placed before that return would let a WRONG-PATH instruction steer the fetch pointer,
      // overwriting the very redirect that condemned it. The reverse stage walk (EX before ID) is
      // precisely what makes "the correction always beats the bet" structural.
      //
      // `predictTaken` gates it, so under 'none'/'static-not-taken' this is dead. A halt is not a
      // transfer, so the `isArchHalt` squash above cannot coincide with a bet.
      const target = this.predictTaken ? speculativeTarget(d, fd.pc) : null;
      if (target !== null) {
        ctx.bet = true;
        ctx.redirect = target; // applied at the clock edge, AFTER IF has fetched the fall-through
        // The bet's own event, emitted HERE rather than left to be inferred from the `flush` it
        // usually causes. The two are different facts and they come apart: a branch at the end of
        // `.text` bets — redirecting the pc — while IF has nothing to kill, and emits no flush.
        ctx.events.push({ type: 'branch-predicted', instr: fd.instr, target });
      }

      ctx.next.idEx[s] = {
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
  }

  /**
   * The hazard-detection unit — the one place the forwarding toggle changes the machine's SHAPE
   * rather than its timing. It scans every SLOT of the two older stages, which is the source set
   * the forwarding network can reach; at width 1 that is M3's pair of singleton tests.
   */
  private detectHazard(ctx: CycleCtx, src: SourceRegs): string | null {
    // `rd !== 0` excludes both "writes nothing" and x0 (hardwired zero: never a dependency).
    const reads = (rd: number): boolean => rd !== 0 && (rd === src.rs1 || rd === src.rs2);

    if (this.forwarding) {
      // Anything a forward can cover, a forward covers — with exactly one exception. A LOAD still
      // in EX has no datum yet (it arrives at MEM), so there is nothing to forward to a consumer
      // reaching EX next cycle. One bubble slides the consumer's EX alongside the load's WB, where
      // MEM/WB→EX can reach it. THE bubble that cannot be forwarded away.
      for (let s = 0; s < this.width; s++) {
        const inEx = ctx.prev.idEx[s] ?? null;
        if (inEx !== null && isLoad(inEx.decoded) && reads(inEx.rd)) return 'load-use';
      }
      return null;
    }

    // No forwarding network: the register file is the only path, so the consumer waits in ID until
    // the producer's WB. A producer in WB *this* cycle is NOT a hazard — WB ran first in the walk,
    // so the read that follows already sees its value. That is what makes a distance-1 RAW a
    // 2-cycle stall rather than a 3-cycle one.
    for (let s = 0; s < this.width; s++) {
      const inEx = ctx.prev.idEx[s] ?? null;
      if (inEx !== null && reads(inEx.rd)) return 'raw';
    }
    for (let s = 0; s < this.width; s++) {
      const inMem = ctx.prev.exMem[s] ?? null;
      if (inMem !== null && reads(inMem.rd)) return 'raw';
    }
    return null;
  }

  private readReg(ctx: CycleCtx, instr: string, reg: number): number {
    const value = this.registers[reg]!;
    ctx.events.push({ type: 'reg-read', reg, value, instr });
    return value;
  }

  /**
   * IF — fetch, or hold. Returns the instructions occupying the IF stage this cycle, one per slot,
   * which is what a stall makes visible: the younger instruction sits in IF for a second cycle (the
   * repeated cell in every textbook pipeline diagram) rather than being re-fetched under a new id,
   * which would break the stable-id invariant (INV-4) and emit `instr-fetch` twice.
   */
  private stageIf(ctx: CycleCtx): (Fetched | null)[] {
    // Fetch FIRST, squash afterwards. IF does its work every cycle; a flush kills the result at the
    // clock edge rather than preventing the work — which is exactly why a taken branch cuts TWO
    // rows (the instruction in ID and the one IF was fetching behind it) and why an `ecall`'s one
    // shadow is a real instruction that shows up and dies rather than never existing. Both
    // `fetchPc` and `haltFetch` are read here at their PRE-edge values (EX's redirect and ID's stop
    // are staged in `ctx`), so this fetch is the fall-through one the machine really made.
    //
    // Reuse the instructions held over from a stall, else fetch new ones — slot by slot, oldest
    // first, so a held-over occupant keeps its position and fetch fills only what is empty.
    // Fetching stops for exactly two reasons — an architectural halt decoded in ID, or the fetch
    // pointer leaving `.text` — and neither is a halt: the pipe drains and halts at the last
    // retire. The out-of-text test is not a sticky flag, so a taken branch that redirects back into
    // text resumes fetching for free.
    const slots = this.ifSlot.slice();
    for (let s = 0; s < this.width; s++) {
      if ((slots[s] ?? null) === null && !this.haltFetch && this.inText(this.fetchPc)) {
        slots[s] = this.fetchOne(ctx);
      }
    }

    if (ctx.squash !== null) {
      // Whatever IF holds dies, and nothing enters ID.
      this.ifSlot = emptySlots<Fetched>(this.width);
      for (let s = 0; s < this.width; s++) ctx.next.ifId[s] = null;
      return slots; // they were here this cycle, and they die here
    }

    if (ctx.bet) {
      // The ID bet steered fetch to a predicted target, so the fall-through this stage just fetched
      // is off the predicted path and dies — exactly like a squash from IF's point of view. The
      // difference is invisible here and decisive one stage up: ID's own instruction (the branch
      // doing the predicting) is NOT killed, so `ctx.next.idEx` — already set by stageId — stands.
      // One casualty instead of two is the entire saving a correct prediction buys.
      this.ifSlot = emptySlots<Fetched>(this.width);
      for (let s = 0; s < this.width; s++) ctx.next.ifId[s] = null;
      return slots;
    }

    if (ctx.stalled || ctx.memStall) {
      // Hold them in IF. `ctx.stalled` is the load-use case (ID could not accept them); `memStall`
      // is the miss (the whole front of the pipe is frozen). In both, `ctx.next.ifId` was already
      // set by ID — to the held or fetched instruction on a load-use stall, to ID's own frozen
      // occupants on a miss — so IF must not touch it, only keep its own occupants for next cycle.
      this.ifSlot = slots;
    } else {
      this.ifSlot = emptySlots<Fetched>(this.width);
      for (let s = 0; s < this.width; s++) {
        const f = slots[s] ?? null;
        ctx.next.ifId[s] = f === null ? null : toLatch(f);
      }
    }
    return slots;
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
      anyOccupied(l.ifId) || anyOccupied(l.idEx) || anyOccupied(l.exMem) || anyOccupied(l.memWb)
    );
  }

  /**
   * An independent full-state snapshot — what each CycleTrace carries (handoff §6). The latch
   * objects are immutable and rebuilt each cycle, but the slot ARRAYS are the container the walk
   * writes into, so each is COPIED here; sharing one would replay every recorded cycle as the final
   * one. The cache is the other exception: it is single-buffered and mutated in place by
   * {@link access}, so it must be DEEP-COPIED — the same reason `memory` is snapshotted.
   */
  private snapshotState(latches: Latches): MachineState {
    const micro: SuperscalarMicro = {
      width: this.width,
      ifId: latches.ifId.slice(),
      idEx: latches.idEx.slice(),
      exMem: latches.exMem.slice(),
      memWb: latches.memWb.slice(),
      cache: this.cache === null ? null : { lines: this.cache.lines.map((l) => ({ ...l })) },
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
