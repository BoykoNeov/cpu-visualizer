/**
 * The out-of-order RV32I core (roadmap §12.5, M9) behind the {@link Processor} interface — the
 * FIFTH microarchitecture, and the first with a reorder buffer, register renaming, and a common
 * data bus. `docs/plans/m9-tasks.md` step 1a: the FAITHFUL BASE. Renaming, the ROB, and in-order
 * commit are all real; issue is still strictly in program order (no wakeup/select, no
 * reordering). Step 1b adds the scheduler on top without touching anything here except the issue
 * policy.
 *
 * ## Why this must be timing-identical to M3/M7
 *
 * A machine built from wholly different parts (ROB + reservation stations + a CDB, instead of
 * latches) has to prove it is not merely CORRECT but TIMING-NEUTRAL before step 1b's "OoO wins by
 * N cycles" claim means anything: this model, held to strict in-order issue, must reproduce M3's
 * closed form at `issueWidth: 1` and M7's at `issueWidth: 2`, cycle for cycle. See
 * `M:\claud_projects\temp\m9\step1a-timing-derivation.md` for the hand-derivation that checks
 * this BEFORE this file existed, on the representative patterns that could plausibly diverge.
 *
 * ## Where M7's pairing rules went
 *
 * M7's three group-formation rules (no two memory ops pair, no two branches pair, no intra-pair
 * RAW) are NOT dispatch rules here — putting them there would force *removing* them again at step
 * 1b, which is scoped to change only the issue POLICY. Instead:
 *
 *  - Dispatch is bounded only by ROB capacity and `width` — no instruction-mix rule.
 *  - The single memory port and single branch unit are ISSUE-time resource contests (oldest
 *    ready contender wins; the loser retries next cycle).
 *  - Intra-pair RAW needs no rule: the dependent instruction gets a TAG, not a stale value, and
 *    strict in-order issue already stops it from passing its own unresolved producer.
 *
 * ## Forwarding has no off-position here
 *
 * The CDB broadcasts a result the instant it exists — that IS the forwarding path. There is no
 * principled "forwarding off" position for a Tomasulo machine (pinned with the user,
 * 2026-07-22): `configurableForwarding: false`, and the timing baseline above is matched against
 * M3/M7's `forwarding: true` position only.
 *
 * ## `MachineState.micro` stays unset at this step
 *
 * The ROB, reservation-station-equivalent state, and rename map are real private engine state —
 * structurally ready for step 1b and eventually the step-6 view — but nothing consumes them
 * through the trace yet (an explicit YAGNI call, not an oversight: forcing a `micro` shape now
 * would be designing for a view that does not exist). Because none of it is ever snapshotted, it
 * is mutated in place across cycles (like the superscalar's single-buffered cache), with no
 * double-buffering discipline needed for state nothing reads back out of a `CycleTrace`.
 *
 * The ISA semantics below — the mnemonic switch, the `s()`/`u()` register views, `imm & 0x1f`,
 * the `>>> 0` at the memory boundary — are mirrored VERBATIM from the golden reference and from
 * `engine-superscalar`'s `executeSlot`, exactly as every model mirrors them (INV-8 proves the
 * copy faithful; we do not import a sibling model or the reference at runtime).
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
import { Rob, type RobEntry } from './rob';
import { RenameTable } from './rename';
import { tagNumber, type OperandSource, type Tag } from './types';

export const OUT_OF_ORDER_CAPABILITIES: ProcessorCapabilities = {
  model: 'out-of-order',
  pipelined: true,
  hasHazards: true,
  // No off-position exists for a Tomasulo machine's forwarding (the CDB broadcast IS the forward
  // path) — see the file header. The flag is honored as INERT; `processor.test.ts` proves it.
  configurableForwarding: false,
  configurableBranchPrediction: true,
  configurableCache: true,
  configurableIssueWidth: true,
  configurableOutOfOrder: true,
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

function usesMemPort(d: DecodedInstruction): boolean {
  return LOADS.has(d.mnemonic) || STORES.has(d.mnemonic);
}

/** The architectural destination, or 0 for "writes nothing" — mirrors every model's `destReg`. */
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

function isLoad(d: DecodedInstruction): boolean {
  return LOADS.has(d.mnemonic);
}

function isArchHalt(d: DecodedInstruction): boolean {
  return (
    d.mnemonic === 'ecall' || d.mnemonic === 'ebreak' || defForMnemonic(d.mnemonic) === undefined
  );
}

/** An instruction fetched but not yet dispatched — the IF-stage occupant, one per slot. */
interface Fetched {
  readonly id: string;
  readonly pc: number;
  readonly word: number;
  readonly decoded: DecodedInstruction;
}

/** The per-cycle working set: signals raised by a later-processed (chronologically earlier) stage. */
interface CycleCtx {
  readonly events: TraceEvent[];
  /** Raised by the mem-access step on a cache miss; read by issue/execute and dispatch. */
  memStall: boolean;
  /** The mispredicting/halting entry's own age, and why — everything younger is wrong-path. */
  squash: { seq: number; reason: 'branch' | 'halt' } | null;
  /** Staged, applied at the clock edge (after IF has fetched the fall-through it must lose). */
  redirect: number | null;
  stopFetch: boolean;
  /** A bet on a taken transfer, placed by `stageBet` — steers fetch; kills the fall-through IF fetched. */
  bet: { seq: number; target: number } | null;
}

export class OutOfOrderProcessor implements Processor {
  readonly capabilities = OUT_OF_ORDER_CAPABILITIES;

  private registers = makeRegisters();
  private memory = new SparseMemory();
  private pc = 0;
  private fetchPc = 0;
  private entry = 0;
  private textEnd = 0;
  private halted = true;
  private cycle = -1;
  private seq = 0; // dynamic-instruction counter → stable ids (INV-4)
  private sourceMap: ReadonlyMap<number, number> = new Map();

  private width = 2; // OoO's own default is 2, unlike the superscalar's 1 (pinned decision)
  private predictTaken = false;
  private cacheConfig: CacheConfig | null = null;
  private cache: CacheState | null = null;

  private rob = new Rob(16);
  private rename = new RenameTable();
  /** Fetched-but-not-dispatched occupants, compacted, oldest first — mirrors the superscalar's `ifSlot`. */
  private ifSlot: (Fetched | null)[] = [null, null];
  private haltFetch = false;
  /**
   * Completions queued during `stageMemAccess`/`stageIssueExecute`, broadcast via `rob.wake()`
   * only AFTER both have fully run for this cycle — never inline as each entry completes. That
   * deferral is what gives the CDB the same one-cycle turnaround every latch model gets for free
   * from double-buffering (`ctx.prev.exMem`/`memWb`, never `ctx.next`): a producer that completes
   * THIS cycle wakes waiters starting NEXT cycle, never within the same one. Without it, a
   * same-cycle iteration order accident would let a consumer processed later in the same walk see
   * its producer's result instantly — a zero-latency forward the derivation worksheet rules out.
   */
  private pendingBroadcasts: { tag: Tag; value: number }[] = [];

  reset(image: ProgramImage, config: ProcessorConfig = defaultConfig()): void {
    const width = config.issueWidth ?? 2;
    if (width < 1) {
      throw new Error(`out-of-order: issueWidth ${width} is not a positive width`);
    }
    this.width = width;
    this.predictTaken = config.branchPrediction === 'static-taken';
    this.cacheConfig = config.cache;
    this.cache = config.cache === null ? null : newCache(config.cache);
    this.registers = makeRegisters();
    this.memory = new SparseMemory();
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
    // Comfortably larger than any single-iteration window in the shipped corpus, so the 1a
    // timing baseline never binds on ROB capacity — a small ROB visibly stalling dispatch is a
    // real, deliberately SEPARATE story (the "secondary lever," step 1b/3), not part of this
    // model's claim to match M3/M7 cycle for cycle.
    this.rob = new Rob(config.robSize ?? 16);
    this.rename.reset();
    this.ifSlot = new Array<Fetched | null>(this.width).fill(null);
    this.haltFetch = false;
    this.halted = !this.inText(this.pc);
  }

  isHalted(): boolean {
    return this.halted;
  }

  getState(): MachineState {
    return this.snapshotState();
  }

  step(): CycleTrace {
    if (this.halted) {
      throw new Error('step() called on a halted processor — check isHalted() first');
    }
    this.cycle += 1;

    const ctx: CycleCtx = {
      events: [],
      memStall: false,
      squash: null,
      redirect: null,
      stopFetch: false,
      bet: null,
    };

    // Reverse order — Commit(~WB) → MemAccess(~MEM) → IssueExecute(~EX) → Dispatch(~ID) →
    // Fetch(~IF) — exactly the discipline every prior model uses, for the same reason: a signal
    // raised by an earlier-processed (chronologically LATER) stage must be visible to a
    // later-processed (chronologically EARLIER) one within this same cycle.
    const committed = this.stageCommit();
    this.pendingBroadcasts = [];
    this.stageMemAccess(ctx);
    this.stageIssueExecute(ctx);
    // The broadcast: apply everything this cycle completed, waking waiters for NEXT cycle's issue
    // decision — never this one (see `pendingBroadcasts`'s doc).
    for (const { tag, value } of this.pendingBroadcasts) this.rob.wake(tag, value);
    this.stageDispatch(ctx);
    this.stageBet(ctx);
    const fetchedThisCycle = this.stageFetch(ctx);

    // The clock edge.
    if (ctx.redirect !== null) this.fetchPc = ctx.redirect;
    if (ctx.stopFetch) this.haltFetch = true;

    // Snapshot who was in flight BEFORE the flush below removes the wrong-path entries — a flush
    // is only meaningful cross-referenced against who it killed (`CycleTrace.instructions`).
    const inFlight = this.rob.all().slice();

    const flushStages: string[] = [];
    if (ctx.squash !== null) {
      const squashSeq = ctx.squash.seq;
      const flushed = this.rob.flushAfter(squashSeq);
      // Youngest-first (guaranteed by `flushAfter`): each entry's restore call unwinds one claim,
      // and a chain of same-batch claims on one register correctly unwinds step by step as we work
      // backward through it. The one case that needs help: `prevMapping` was a snapshot taken AT
      // DISPATCH of whatever the register meant then — if that referenced an OLDER producer
      // (outside this flush batch, so seq <= squashSeq) that has SINCE legitimately committed
      // (right path, retired in the normal course while this entry sat waiting), the snapshot is
      // now STALE: restoring it would re-point the register at a ROB entry that no longer exists.
      // The correct substitute is `committed` — the architectural file already holds that value.
      for (const e of flushed) {
        if (e.rd === 0) continue;
        let previous = e.prevMapping;
        if (
          previous.kind === 'pending' &&
          tagNumber(previous.tag) <= squashSeq &&
          this.rob.entryFor(previous.tag) === undefined
        ) {
          previous = { kind: 'committed' };
        }
        this.rename.restore(e.rd, e.tag, previous);
      }
      if (flushed.length > 0) flushStages.push('dispatch');
    }
    if ((ctx.squash !== null || ctx.bet !== null) && fetchedThisCycle.some((f) => f !== null)) {
      flushStages.push('IF');
    }
    if (ctx.squash !== null && flushStages.length > 0) {
      ctx.events.push({
        type: 'flush',
        reason:
          ctx.squash.reason === 'halt'
            ? 'halt'
            : this.lastBranchWasPredictedTaken
              ? 'branch-not-taken'
              : 'branch-taken',
        stages: flushStages,
      });
    } else if (ctx.bet !== null && flushStages.length > 0) {
      ctx.events.push({ type: 'flush', reason: 'branch-predicted-taken', stages: flushStages });
    }

    if (this.halted && (this.anyIfOccupied() || this.rob.size > 0)) {
      throw new Error(
        `out-of-order: halted at cycle ${this.cycle} with instructions still in flight — the machine did not drain`,
      );
    }

    const instructions: InstructionInstance[] = [];
    for (const e of committed) instructions.push(this.toInstance(e));
    for (const e of inFlight) instructions.push(this.toInstance(e));
    for (const f of fetchedThisCycle) {
      if (f === null) continue;
      instructions.push({
        id: f.id,
        pc: f.pc,
        encoding: f.word,
        sourceLine: this.sourceMap.get(f.pc) ?? null,
        decoded: f.decoded,
        location: 'IF',
      });
    }

    return {
      cycle: this.cycle,
      state: this.snapshotState(),
      events: ctx.events,
      instructions,
    };
  }

  /** Tracks whether the last flushed branch had been predicted taken, purely to label `flush.reason`. */
  private lastBranchWasPredictedTaken = false;

  private toInstance(e: RobEntry): InstructionInstance {
    return {
      id: e.instr,
      pc: e.pc,
      encoding: e.ir,
      sourceLine: this.sourceMap.get(e.pc) ?? null,
      decoded: e.decoded,
      location: `ROB#${e.tag}`,
    };
  }

  private anyIfOccupied(): boolean {
    return this.ifSlot.some((f) => f !== null);
  }

  // -----------------------------------------------------------------------------------------
  // COMMIT — the ROB head, in order, up to `width` per cycle. Reuses `instr-retire` (an
  // in-order-issue, in-order-completion machine has no distinct "commit" event to draw yet).
  // -----------------------------------------------------------------------------------------

  private stageCommit(): RobEntry[] {
    const ready = this.rob.commitReady(this.width);
    const events: TraceEvent[] = [];
    for (const e of ready) {
      if (e.rd !== 0) {
        if (e.value === null) {
          throw new Error(`out-of-order: ${e.decoded.mnemonic} commits x${e.rd} with no value`);
        }
        this.registers[e.rd] = e.value;
        events.push({ type: 'reg-write', reg: e.rd, value: e.value, instr: e.instr });
        this.rename.commit(e.rd, e.tag);
      }
      events.push({ type: 'instr-retire', instr: e.instr });
      if (e.halt) {
        this.pc = e.pc;
        this.halted = true;
      } else {
        this.pc = e.nextPc ?? this.pc;
        if (!this.inText(this.pc)) this.halted = true;
      }
    }
    this.pendingCommitEvents = events;
    return ready;
  }

  /** Bridges `stageCommit`'s events into the shared `ctx.events` once `ctx` exists. */
  private pendingCommitEvents: TraceEvent[] = [];

  // -----------------------------------------------------------------------------------------
  // MEM ACCESS + CDB BROADCAST — the single data-memory port, reused verbatim from
  // `engine-common`'s cache: BLOCKING on a miss, freezing everything younger (1a keeps the exact
  // fidelity M3/M7 have; a non-blocking LSU is step 1b's job).
  // -----------------------------------------------------------------------------------------

  private stageMemAccess(ctx: CycleCtx): void {
    for (const e of this.pendingCommitEvents) ctx.events.push(e);
    this.pendingCommitEvents = [];

    for (const e of this.rob.all()) {
      // The pass-through: a non-memory instruction that already executed just needed this one
      // idle cycle (mirrors M3/M7's MEM stage moving an ALU result through unchanged) before it
      // may commit. No resource contention here — unlike the single memory port, every `executed`
      // entry drains every cycle, regardless of width.
      if (e.state === 'executed') {
        e.state = 'completed';
        continue;
      }
      if (e.state !== 'awaitingMem') continue;

      if (e.missCyclesRemaining > 0) {
        const remaining = e.missCyclesRemaining - 1;
        if (remaining > 0) {
          e.missCyclesRemaining = remaining;
          ctx.memStall = true;
          continue;
        }
        e.missCyclesRemaining = 0;
        // remaining === 0 ⇒ the RELEASE cycle: no stall this cycle (mirrors M3's `holdInMem`,
        // which is only ever called for remaining > 0) — fall through to the real access, and
        // let issue/dispatch run normally this same cycle. Setting `ctx.memStall` unconditionally
        // here (as an earlier version of this code did) froze the front end one cycle too long.
      } else {
        const penalty = this.consultCache(ctx, e);
        if (penalty > 0) {
          e.missCyclesRemaining = penalty;
          ctx.memStall = true;
          continue;
        }
      }
      this.completeMemAccess(ctx, e);
    }
  }

  private consultCache(ctx: CycleCtx, e: RobEntry): number {
    if (this.cacheConfig === null || this.cache === null) return 0;
    const mnemonic = e.decoded.mnemonic;
    const load = isLoad(e.decoded);
    if (!load && !STORES.has(mnemonic)) return 0;
    if (e.aluOut === null) {
      throw new Error(`out-of-order: ${mnemonic} reaches the cache with no effective address`);
    }
    const addr = e.aluOut >>> 0;
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

  private completeMemAccess(ctx: CycleCtx, e: RobEntry): void {
    const mnemonic = e.decoded.mnemonic;
    if (isLoad(e.decoded) || STORES.has(mnemonic)) {
      if (e.aluOut === null) {
        throw new Error(`out-of-order: ${mnemonic} reaches MEM with no effective address latched`);
      }
      const addr = e.aluOut >>> 0;
      if (isLoad(e.decoded)) {
        const raw =
          mnemonic === 'lb' || mnemonic === 'lbu'
            ? this.memory.readByte(addr)
            : mnemonic === 'lh' || mnemonic === 'lhu'
              ? this.memory.readHalf(addr)
              : this.memory.readWord(addr);
        ctx.events.push({ type: 'mem-read', addr, value: raw, instr: e.instr });
        e.value =
          mnemonic === 'lb' ? (raw << 24) >> 24 : mnemonic === 'lh' ? (raw << 16) >> 16 : raw;
        if (e.rd !== 0) this.pendingBroadcasts.push({ tag: e.tag, value: e.value });
      } else {
        if (e.storeData === null) {
          throw new Error(`out-of-order: ${mnemonic} reaches MEM with no store datum latched`);
        }
        const value =
          mnemonic === 'sb'
            ? e.storeData & 0xff
            : mnemonic === 'sh'
              ? e.storeData & 0xffff
              : e.storeData;
        ctx.events.push({ type: 'mem-write', addr, value, instr: e.instr });
        if (mnemonic === 'sb') this.memory.writeByte(addr, value);
        else if (mnemonic === 'sh') this.memory.writeHalf(addr, value);
        else this.memory.writeWord(addr, value);
      }
    }
    e.state = 'completed';
  }

  // -----------------------------------------------------------------------------------------
  // ISSUE + EXECUTE — strict in-order, oldest-first, no reordering (1a's whole constraint). The
  // single memory port and single branch unit are resource contests HERE, not dispatch rules —
  // see the file header. A blocked entry stops the walk: nothing younger may pass it.
  // -----------------------------------------------------------------------------------------

  private stageIssueExecute(ctx: CycleCtx): void {
    if (ctx.memStall) return; // the whole front end freezes while a miss is being served

    let issueBudget = this.width;
    let memUsed = false;
    let branchUsed = false;

    for (const e of this.rob.all()) {
      if (e.state !== 'waiting') continue; // already issued/completed — not this loop's concern
      if (ctx.squash !== null) break; // an older entry just mispredicted; nothing younger issues
      if (issueBudget <= 0) break;

      const isMem = usesMemPort(e.decoded);
      const isBranch = TRANSFERS.has(e.decoded.mnemonic);
      if (isMem && memUsed) break;
      if (isBranch && branchUsed) break;

      // Readiness reads the operand sources CAPTURED AT DISPATCH (see `RobEntry.srcA`/`srcB`'s
      // doc) — never re-derived here. Re-deriving live would let a younger same-cycle dispatch's
      // rename claim corrupt this (older) instruction's already-decided source.
      if ((e.srcA !== null && !e.srcA.ready) || (e.srcB !== null && !e.srcB.ready)) break;

      issueBudget -= 1;
      if (isMem) memUsed = true;
      if (isBranch) branchUsed = true;

      this.executeEntry(
        ctx,
        e,
        e.srcA !== null && e.srcA.ready ? e.srcA.value : 0,
        e.srcB !== null && e.srcB.ready ? e.srcB.value : 0,
      );
    }
  }

  /**
   * The ONE operand-read choke point (PRF-forward-compat seam #3) — called exactly once per
   * operand, AT DISPATCH, never again. `x0` is always ready-as-zero; a committed register reads
   * the architectural file; a pending tag is ready only if its producer has ALREADY completed as
   * of this exact moment (an older entry dispatching earlier in the same cycle's group, whose
   * result is already known) — never "will complete later this same cycle," since dispatch
   * processes strictly oldest-to-youngest and nothing younger has executed yet.
   */
  private captureOperandAtDispatch(reg: number): OperandSource {
    if (reg === 0) return { ready: true, value: 0 };
    const slot = this.rename.lookup(reg);
    if (slot.kind === 'committed') return { ready: true, value: this.registers[reg]! };
    const e = this.rob.entryFor(slot.tag);
    if (e === undefined) {
      throw new Error(`out-of-order: rename map points at a tag with no ROB entry`);
    }
    // `executed` counts as ready here too: the value is already known and already broadcast to
    // any WAITING consumer via `rob.wake()` — a freshly dispatching consumer must see the same
    // thing, or it would wait one cycle longer than an already-waiting sibling did for the exact
    // same producer. Only COMMIT-eligibility (`commitReady`) cares about the `executed`/`completed`
    // distinction.
    if ((e.state === 'completed' || e.state === 'executed') && e.value !== null) {
      return { ready: true, value: e.value };
    }
    return { ready: false, tag: slot.tag };
  }

  private executeEntry(ctx: CycleCtx, e: RobEntry, aVal: number, bVal: number): void {
    const d = e.decoded;
    const { imm, mnemonic } = d;
    const shamt = imm & 0x1f;

    const sa = (): number => aVal;
    const ua = (): number => aVal >>> 0;
    const sb = (): number => bVal;
    const ub = (): number => bVal >>> 0;

    let aluOut: number | null = null;
    let writeValue: number | null = null;
    let storeData: number | null = null;
    let nextPc = (e.pc + 4) >>> 0;
    let taken: boolean | null = null;

    const alu = (op: string, a: number, b: number, result: number): number => {
      ctx.events.push({
        type: 'alu-op',
        op,
        a: a | 0,
        b: b | 0,
        result: result | 0,
        instr: e.instr,
      });
      aluOut = result | 0;
      return aluOut;
    };
    const produce = (value: number): void => {
      writeValue = value | 0;
    };

    switch (mnemonic) {
      case 'lui':
        produce(imm);
        break;
      case 'auipc':
        produce((e.pc + imm) | 0);
        break;
      case 'jal':
        produce((e.pc + 4) | 0);
        nextPc = (e.pc + imm) >>> 0;
        taken = true;
        break;
      case 'jalr': {
        const sum = alu('add', sa(), imm, (sa() + imm) | 0);
        nextPc = (sum & ~1) >>> 0;
        produce((e.pc + 4) | 0);
        taken = true;
        break;
      }
      case 'beq':
        taken = sa() === sb();
        alu('beq', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (e.pc + imm) >>> 0;
        break;
      case 'bne':
        taken = sa() !== sb();
        alu('bne', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (e.pc + imm) >>> 0;
        break;
      case 'blt':
        taken = sa() < sb();
        alu('blt', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (e.pc + imm) >>> 0;
        break;
      case 'bge':
        taken = sa() >= sb();
        alu('bge', sa(), sb(), taken ? 1 : 0);
        if (taken) nextPc = (e.pc + imm) >>> 0;
        break;
      case 'bltu':
        taken = ua() < ub();
        alu('bltu', ua(), ub(), taken ? 1 : 0);
        if (taken) nextPc = (e.pc + imm) >>> 0;
        break;
      case 'bgeu':
        taken = ua() >= ub();
        alu('bgeu', ua(), ub(), taken ? 1 : 0);
        if (taken) nextPc = (e.pc + imm) >>> 0;
        break;
      case 'lb':
      case 'lh':
      case 'lw':
      case 'lbu':
      case 'lhu':
        alu('add', sa(), imm, (sa() + imm) >>> 0);
        break;
      case 'sb':
      case 'sh':
      case 'sw':
        alu('add', sa(), imm, (sa() + imm) >>> 0);
        storeData = sb();
        break;
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
      default:
        break;
    }

    if (taken !== null) {
      const predicted = e.predictedTaken;
      ctx.events.push({
        type: 'branch-resolved',
        instr: e.instr,
        predicted,
        actual: taken,
        target: nextPc,
      });
      if (predicted !== taken) {
        this.lastBranchWasPredictedTaken = predicted;
        ctx.squash = { seq: e.seq, reason: 'branch' };
        ctx.redirect = nextPc;
      }
    }

    if (isLoad(d) || STORES.has(mnemonic)) {
      e.aluOut = aluOut;
      e.storeData = storeData;
      e.nextPc = nextPc;
      e.halt = false;
      e.state = 'awaitingMem';
    } else {
      e.value = writeValue;
      e.nextPc = nextPc;
      e.halt = isArchHalt(d);
      // NOT 'completed' yet — see `RobState`'s doc on `'executed'`. The value is known and
      // broadcast now; commit-eligibility waits one more (pass-through) cycle, mirrored in
      // `stageMemAccess`.
      e.state = 'executed';
      if (e.rd !== 0 && e.value !== null) {
        this.pendingBroadcasts.push({ tag: e.tag, value: e.value });
      }
      // The architectural halt is confirmed HERE, at issue — not at dispatch. Dispatch runs
      // decoupled and far ahead of issue in this design (that decoupling is the whole point), so a
      // freshly dispatched `ecall` might still be wrong-path, sitting behind an older unresolved
      // branch that has not yet issued. Strict in-order issue guarantees that by the time THIS
      // entry issues, every older entry already has — so only now is "stop fetching" a fact that
      // will never need to be un-said. (Mirrors exactly where a branch's squash is confirmed.)
      if (e.halt) {
        ctx.stopFetch = true;
        ctx.squash = { seq: e.seq, reason: 'halt' };
      }
    }
  }

  // -----------------------------------------------------------------------------------------
  // DISPATCH — rename + ROB allocation, in program order, bounded only by ROB capacity and
  // `width`. No instruction-mix restriction (see the file header): every fetched instruction
  // dispatches as soon as there is room, regardless of what it is.
  // -----------------------------------------------------------------------------------------

  private stageDispatch(ctx: CycleCtx): void {
    if (ctx.memStall) return; // frozen: dispatch does not advance while a miss is served
    if (ctx.squash !== null) return; // an older instruction this cycle already condemned us
    // An older predictable transfer is still sitting `'waiting'`, un-bet (see `stageBet`'s
    // header): freeze dispatch entirely until it bets, exactly as M3/M7's ID holds IF while a
    // stalled branch has not yet cleared. Without this, decoupled dispatch would keep pulling
    // fall-through instructions into the ROB while the branch's own operand is still pending —
    // instructions that, unlike a normal RAW wait, may turn out to be on the WRONG path, and
    // (unlike a normal wrong-path squash) would never be caught by the mispredict check if the
    // eventual bet happens to match the actual outcome.
    if (this.predictTaken && this.hasUnresolvedBet()) return;

    let dispatched = 0;
    for (let s = 0; s < this.width; s++) {
      const f = this.ifSlot[s] ?? null;
      if (f === null) break; // compacted: nothing further is fetched either
      if (!this.rob.hasRoom(1)) break; // structural: ROB is full, dispatch stalls

      const d = f.decoded;
      const rd = destReg(d);
      const prevMapping = rd === 0 ? ({ kind: 'committed' } as const) : this.rename.lookup(rd);

      // Capture BOTH source operands NOW, before this instruction's own `rd` claim below —
      // that ordering is what lets a self-referencing instruction (`addi x1,x1,1`) read its OWN
      // old value rather than the tag it is about to claim for itself.
      const src = sourceRegs(d);
      const srcA = src.rs1 === null ? null : this.captureOperandAtDispatch(src.rs1);
      const srcB = src.rs2 === null ? null : this.captureOperandAtDispatch(src.rs2);

      const entry = this.rob.allocate({
        instr: f.id,
        pc: f.pc,
        ir: f.word,
        decoded: d,
        rd,
        prevMapping,
        srcA,
        srcB,
      });
      if (rd !== 0) this.rename.claim(rd, entry.tag);
      dispatched = s + 1;

      // NOT checked here: `isArchHalt(d)`. Dispatch runs decoupled and far ahead of issue in
      // this design, so a freshly dispatched `ecall` may still be wrong-path (behind an older,
      // unresolved branch) — the halt is confirmed at ISSUE instead (`executeEntry`), the same
      // place a branch misprediction is confirmed.

      // A predictable transfer is NOT bet on here (see `stageBet`) — but nothing younger may
      // dispatch alongside it in this SAME cycle, or a same-cycle over-dispatch could smuggle
      // more wrong-path instructions into the ROB before the bet (and the redirect it carries)
      // exists at all.
      if (this.predictTaken && speculativeTarget(d, f.pc) !== null) break;
    }

    // Slide: whatever dispatch did not consume moves down to lead next cycle's group.
    const kept = new Array<Fetched | null>(this.width).fill(null);
    let k = 0;
    for (let s = dispatched; s < this.width; s++) {
      const f = this.ifSlot[s] ?? null;
      if (f !== null) kept[k++] = f;
    }
    this.ifSlot = kept;
  }

  /** Is there a predictable transfer still `'waiting'`, un-bet, anywhere in the ROB? */
  private hasUnresolvedBet(): boolean {
    for (const e of this.rob.all()) {
      if (
        e.state === 'waiting' &&
        !e.predictedTaken &&
        speculativeTarget(e.decoded, e.pc) !== null
      ) {
        return true;
      }
    }
    return false;
  }

  // -----------------------------------------------------------------------------------------
  // BET — placed the cycle before a predictable transfer would issue (mirrors M3/M7's ID
  // betting one cycle before EX resolves), NOT at the branch's own dispatch cycle. Dispatch and
  // issue are decoupled here (unlike the latch models, where clearing ID's hazard check and
  // committing the bet are the same event): a transfer can sit `'waiting'` on its own operand
  // for several cycles after dispatch, and betting immediately at dispatch fires one cycle too
  // early whenever that happens — this was bug #6 (`array-sum.s`'s `bne t1,x0,loop` depends on
  // the immediately preceding `addi t1,t1,-1`, so it is never ready at its own dispatch cycle).
  //
  // Runs once per cycle, after dispatch (so a transfer that dispatches already-ready this same
  // cycle — e.g. `branch-flavors.s`'s `blt` — still bets THIS cycle, exactly matching a
  // ready-at-dispatch branch's timing under the old scheme) and before fetch (so a stale
  // fall-through fetch made this cycle is still killable via `stageFetch`'s existing `ctx.bet`
  // handling).
  //
  // NOT just the ROB's head: at width > 1, a transfer can issue in the SAME cycle as an older,
  // ready, non-transfer entry (e.g. `blt` co-issuing with the `mv` dispatched just ahead of it
  // in `branch-flavors.s`) — betting only when the transfer itself is head missed exactly that
  // case, since the older `mv` (not a transfer, so never bet on) was still occupying 'waiting'
  // at the moment of the check. So this mirrors `stageIssueExecute`'s own walk — same budget,
  // same resource contest, same "stop at the first not-ready entry" rule — to find whichever
  // entries WOULD issue next cycle, and bets on the (at most one, the single branch unit)
  // transfer among them.
  // -----------------------------------------------------------------------------------------

  private stageBet(ctx: CycleCtx): void {
    if (!this.predictTaken) return;
    if (ctx.squash !== null || ctx.bet !== null) return;

    let issueBudget = this.width;
    let memUsed = false;
    let branchUsed = false;

    for (const e of this.rob.all()) {
      if (e.state !== 'waiting') continue;
      if (issueBudget <= 0) break;

      const ready = (e.srcA === null || e.srcA.ready) && (e.srcB === null || e.srcB.ready);
      if (!ready) break; // strict in-order: nothing younger issues before this one does either

      const isMem = usesMemPort(e.decoded);
      const isBranch = TRANSFERS.has(e.decoded.mnemonic);
      if (isMem && memUsed) break;
      if (isBranch && branchUsed) break;

      issueBudget -= 1;
      if (isMem) memUsed = true;
      if (isBranch) branchUsed = true;

      if (!isBranch || e.predictedTaken) continue;
      const target = speculativeTarget(e.decoded, e.pc);
      if (target === null) continue; // not predictable (or a `jalr` — see `predict.ts`)

      e.predictedTaken = true;
      ctx.bet = { seq: e.seq, target };
      ctx.redirect = target;
      ctx.events.push({ type: 'branch-predicted', instr: e.instr, target });
      return; // at most one branch resource per cycle — nothing else left to bet on
    }
  }

  // -----------------------------------------------------------------------------------------
  // FETCH — unchanged in spirit from every prior model: fetch (or hold) into the compacted slot
  // array, then let dispatch/squash/bet decide what survives into next cycle.
  // -----------------------------------------------------------------------------------------

  private stageFetch(ctx: CycleCtx): (Fetched | null)[] {
    // `this.ifSlot` is already compacted by dispatch's slide (occupants at 0..k-1, null above), so
    // filling the trailing nulls with fresh fetches keeps it compacted for free — no separate
    // merge step needed, unlike a scheme where fetch and dispatch could disagree on shape.
    const slots = this.ifSlot.slice();
    for (let s = 0; s < this.width; s++) {
      if ((slots[s] ?? null) === null && !this.haltFetch && this.inText(this.fetchPc)) {
        slots[s] = this.fetchOne(ctx);
      }
    }

    if (ctx.squash !== null || ctx.bet !== null) {
      // Whatever this cycle fetched (or held) dies; nothing survives into next cycle's dispatch.
      this.ifSlot = new Array<Fetched | null>(this.width).fill(null);
      return slots;
    }

    this.ifSlot = slots;
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

  // -----------------------------------------------------------------------------------------

  private inText(p: number): boolean {
    return p >= this.entry && p < this.textEnd;
  }

  private snapshotState(): MachineState {
    return {
      pc: this.pc,
      registers: this.registers.slice(),
      memory: this.memory.snapshot(),
      halted: this.halted,
    };
  }
}
