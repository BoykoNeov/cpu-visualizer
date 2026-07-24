/**
 * The out-of-order RV32I core (roadmap §12.5, M9) behind the {@link Processor} interface — the
 * FIFTH microarchitecture, and the first with a reorder buffer, register renaming, and a common
 * data bus. `docs/plans/m9-tasks.md` step 1a built the FAITHFUL BASE (renaming, the ROB, in-order
 * commit, but issue strictly in program order). Step 1b adds the scheduler itself: true
 * wakeup/select issue, a non-blocking load/store unit (MSHR-gated miss-under-miss), memory
 * disambiguation, CDB arbitration under contention, and store writes deferred to commit — all
 * gated TOGETHER behind {@link ProcessorConfig.outOfOrderIssue} (see `this.outOfOrder`'s own doc):
 * `false` still runs every line below exactly as 1a shipped it, byte for byte, which is both the
 * regression net (`timing.test.ts` never sets the flag) and the mechanism the money shot rides on
 * — the in-order branch still blocks on a miss, so flipping the flag is what makes independent
 * work visibly race ahead. `true` is this file's new machinery; see `scheduler.test.ts` for one
 * test per mechanism, each derived from a watched dump, never reasoned about in advance.
 *
 * ## Why the in-order branch must stay timing-identical to M3/M7
 *
 * A machine built from wholly different parts (ROB + reservation stations + a CDB, instead of
 * latches) has to prove it is not merely CORRECT but TIMING-NEUTRAL in its degenerate position
 * before an "OoO wins by N cycles" claim means anything: held to strict in-order issue, it must
 * reproduce M3's closed form at `issueWidth: 1` and M7's at `issueWidth: 2`, cycle for cycle. See
 * `M:\claud_projects\temp\m9\step1a-timing-derivation.md` for the hand-derivation that checked
 * this before the file existed (now stale relative to the final 1a design — treat as a historical
 * pre-check, not a spec) and `timing.test.ts` for the net itself.
 *
 * ## Where M7's pairing rules went
 *
 * M7's three group-formation rules (no two memory ops pair, no two branches pair, no intra-pair
 * RAW) are NOT dispatch rules here — dispatch stays uniform across both `outOfOrderIssue`
 * positions. Instead:
 *
 *  - Dispatch is bounded only by ROB capacity and `width` — no instruction-mix rule.
 *  - The single memory port and single branch unit are ISSUE-time resource contests (oldest
 *    ready contender wins; the loser retries next cycle) — shared between both issue policies via
 *    {@link walkIssuable}, which differs only in "stop" (in-order) vs. "skip" (out-of-order) at
 *    the first non-selectable entry.
 *  - Intra-pair RAW needs no rule: the dependent instruction gets a TAG, not a stale value, and
 *    either issue policy already stops it from passing its own unresolved producer (in-order:
 *    structurally; out-of-order: because nothing has broadcast the tag yet).
 *
 * ## Forwarding has no off-position here
 *
 * The CDB broadcasts a result the instant it exists — that IS the forwarding path. There is no
 * principled "forwarding off" position for a Tomasulo machine (pinned with the user,
 * 2026-07-22): `configurableForwarding: false`, and the timing baseline above is matched against
 * M3/M7's `forwarding: true` position only.
 *
 * ## `MachineState.micro` — populated at step 6 (was deferred at steps 1a/1b)
 *
 * The ROB, the reservation-station-equivalent state, and the rename map are real private engine
 * state, mutated in place across cycles (like the superscalar's single-buffered cache). Through
 * steps 1a–5 nothing read them through the trace, so `micro` stayed unset (an explicit YAGNI call:
 * forcing a shape before a view existed would be designing for nothing). Step 6 builds the
 * `MicroTablePanel` that folds over them, so the trigger fires: {@link snapshotMicro} now projects
 * them into {@link OutOfOrderMicro} every cycle. Because the recorder keeps every cycle, that
 * snapshot is INDEPENDENT per cycle — a fresh {@link RobEntryView} per ROB entry, not a `.slice()`
 * of the mutated array (see `micro.ts` for the reasoning behind each copy).
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
import { tagNumber, type OperandSource, type RenameSlot, type Tag } from './types';
import type { OperandView, OutOfOrderMicro, RenameSlotView, RobEntryView } from './micro';

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

/**
 * The byte width a load/store touches — 1 for `lb`/`lbu`/`sb`, 2 for `lh`/`lhu`/`sh`, 4 for
 * `lw`/`sw`. Used by memory disambiguation to compare BYTE RANGES rather than base addresses: a
 * younger sub-word load overlapping (not equalling) an older uncommitted store's range still
 * aliases it and must wait, so `disambiguationClear` compares `[addr, addr+width)` intervals, not
 * `addr === addr`. Callers only ever pass a known load/store mnemonic, so the `lw`/`sw` default
 * (4) is never actually reached for a non-word op.
 */
function accessWidth(mnemonic: string): number {
  if (mnemonic === 'lb' || mnemonic === 'lbu' || mnemonic === 'sb') return 1;
  if (mnemonic === 'lh' || mnemonic === 'lhu' || mnemonic === 'sh') return 2;
  return 4; // lw / sw
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

  /**
   * Step 1b's whole gate. `false` (absent) runs EVERY line below unchanged from step 1a — issue
   * stays strictly in-order, memory stays blocking, stores write at MEM like every latch model.
   * `true` switches on the out-of-order scheduler, the non-blocking LSU + disambiguation, deferred
   * store writes, and CDB arbitration, ALL TOGETHER (`docs/plans/m9-tasks.md` step 1b, pinned with
   * the user 2026-07-22): `timing.test.ts` is the only regression net for 1a's faithfulness, and it
   * asserts `outOfOrderIssue` absent/false reproduces M3/M7 cycle for cycle — so the in-order branch
   * of every stage below must stay byte-for-byte what 1a shipped. It is also *why the money shot
   * works*: the in-order branch still blocks on a miss, so flipping this flag is what makes
   * independent work visibly race ahead.
   */
  private outOfOrder = false;
  /** Step 1b: outstanding-miss slots for the non-blocking LSU. Inert (never consulted) at 1a. */
  private numMshrs = 2;
  /**
   * M10 ("Option B"): total functional-unit latency for the designated slow op (`sll`) — 1 means
   * single-cycle (the default, byte-for-byte M9). `>= 2` is what makes the `[slow -> dep -> indep]`
   * shape diverge under the issue toggle: the slow op holds its FU, its DEPENDENT is the not-ready
   * `'waiting'` wall in-order mode can't pass, and out-of-order mode slides independent work past it.
   */
  private slowOpLatency = 1;
  /** Step 1b: which entries (by tag number) currently hold a granted MSHR slot. Always empty at 1a. */
  private missInFlight = new Set<number>();

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
  private pendingBroadcasts: { tag: Tag; seq: number; value: number }[] = [];
  /**
   * Step 1b, out-of-order mode only: broadcasts that lost CDB arbitration last cycle (more
   * completions than `width` CDB ports) and carry over to compete again — see the broadcast-apply
   * step in {@link step}. Always empty in blocking (1a) mode, where every completion is applied
   * immediately with no port limit (see that method's doc for why the limit must stay OoO-only).
   */
  private deferredBroadcasts: { tag: Tag; seq: number; value: number }[] = [];

  reset(image: ProgramImage, config: ProcessorConfig = defaultConfig()): void {
    const width = config.issueWidth ?? 2;
    if (width < 1) {
      throw new Error(`out-of-order: issueWidth ${width} is not a positive width`);
    }
    this.width = width;
    this.predictTaken = config.branchPrediction === 'static-taken';
    this.cacheConfig = config.cache;
    this.cache = config.cache === null ? null : newCache(config.cache);
    this.outOfOrder = config.outOfOrderIssue ?? false;
    // Fail fast on the two structural-capacity knobs, mirroring the `issueWidth` guard above: 0 (or
    // negative) silently LIVELOCKS otherwise. `robSize: 0` makes `Rob.hasRoom` permanently false so
    // dispatch never proceeds; `numMshrs: 0` (with a cache) makes the MSHR gate permanently full so
    // the first miss never completes — both spin until the recorder's cycle cap throws a misleading
    // "non-terminating program?" error. Public API, bare optional numbers in the trace config, so a
    // clear message here beats a runaway (M9+M10 review finding 6).
    const robSize = config.robSize ?? 16;
    if (robSize < 1) {
      throw new Error(`out-of-order: robSize ${robSize} is not a positive capacity`);
    }
    this.numMshrs = config.numMshrs ?? 2;
    if (this.numMshrs < 1) {
      throw new Error(`out-of-order: numMshrs ${this.numMshrs} is not a positive count`);
    }
    this.slowOpLatency = config.slowOpLatency ?? 1;
    this.missInFlight = new Set();
    this.deferredBroadcasts = [];
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
    this.rob = new Rob(robSize);
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
    this.stageFuAdvance(ctx);
    this.stageIssueExecute(ctx);
    // The broadcast: apply everything this cycle completed, waking waiters for NEXT cycle's issue
    // decision — never this one (see `pendingBroadcasts`'s doc).
    //
    // In-order (1a) mode: apply ALL of them, unlimited — exactly 1a's behaviour, no port count.
    // This must stay true even though more than `width` completions CAN occur in one 1a cycle
    // (e.g. two ALU pass-throughs plus one unrelated load's miss-release, at width 2) — M3/M7's
    // latch datapaths have no CDB port limit either, so imposing one here would desync the
    // in-order branch from the timing baseline it must match.
    //
    // Out-of-order (1b) mode: the CDB has exactly `width` ports (mirrors the issue width — as
    // many broadcast lanes as issue lanes, the simplest defensible geometry) and the count CAN be
    // exceeded once misses stop blocking the machine, so a real, deterministic arbitration exists:
    // oldest-`seq`-first wins a port; anyone who loses carries over to compete again next cycle,
    // still ranked by their original age. Losing a slot delays only when WAITERS see the value
    // (via `rob.wake`) — the producer's own commit schedule is untouched, since commit reads
    // `RobEntry.value` directly, never via broadcast.
    if (!this.outOfOrder) {
      for (const { tag, value } of this.pendingBroadcasts) this.rob.wake(tag, value);
    } else {
      const candidates = [...this.deferredBroadcasts, ...this.pendingBroadcasts].sort(
        (a, b) => a.seq - b.seq,
      );
      const winners = candidates.slice(0, this.width);
      this.deferredBroadcasts = candidates.slice(this.width);
      for (const { tag, value } of winners) this.rob.wake(tag, value);
    }
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
      // Step 1b: a flushed entry may be mid-miss holding an MSHR slot, or sitting in
      // `deferredBroadcasts` having already completed but lost CDB arbitration — both must be
      // released/purged, or a wrong-path entry would permanently squat a scarce MSHR slot, or a
      // stale broadcast could still fire (harmless to `rob.wake`, since no live waiter remains, but
      // not something a flush should leave lying around). Both are no-ops in blocking (1a) mode:
      // `mshrGranted` is never set true there, and `deferredBroadcasts` is always empty.
      for (const e of flushed) {
        if (e.mshrGranted) this.missInFlight.delete(tagNumber(e.tag));
      }
      this.deferredBroadcasts = this.deferredBroadcasts.filter((b) => b.seq <= squashSeq);
      if (flushed.length > 0) flushStages.push('dispatch');
      // Step 1b: out-of-order issue breaks 1a's implicit guarantee behind `haltFetch` — that an
      // architectural halt is only ever confirmed once every OLDER entry has already issued, so a
      // halting `ecall` is never itself wrong-path. `ecall` reads no registers (`sourceRegs`
      // returns nulls), so it is ALWAYS ready and can issue immediately once dispatched — including
      // on a fetch-fall-through path behind an older, still-unresolved branch. If that branch later
      // mispredicts, `flushAfter` above correctly removes the wrong-path `ecall` from the ROB, but
      // the STICKY `haltFetch` flag it had already set has no other trigger to un-stick it — fetch
      // would stay frozen forever even after the redirect to the correct path. Re-derive it from
      // the ROB's own post-flush contents: a real (right-path) halt is never itself removed by this
      // flush (it IS the squash source, seq === squashSeq, so `flushAfter`'s seq > squashSeq test
      // spares it), so this can only ever CLEAR a stale, wrong-path halt — never a genuine one. A
      // no-op in blocking (1a) mode, where strict in-order issue makes a wrong-path halt impossible.
      if (this.haltFetch && !this.rob.all().some((e) => e.halt)) {
        this.haltFetch = false;
      }
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
      // Step 1b, out-of-order mode only: a store's write to memory happens HERE, at commit — not
      // at MEM access like every in-order model (including this one's own 1a/blocking branch).
      // With out-of-order issue, a store's address+data can be computed speculatively past a
      // still-unresolved older branch; if the write happened at MEM access, a later-discovered
      // misprediction could never take it back (memory has no undo). Deferring to commit — which
      // by construction only ever processes right-path entries, since a wrong-path one is removed
      // by `flushAfter` long before it could reach the ROB head — is what makes speculation safe.
      // See `writeStoreToMemory` for the write itself and `stageMemAccessOutOfOrder` for why the
      // cache-timing PROBE still happens early (that mutates no architectural value, so it may
      // safely stay speculative — see that method's doc).
      if (this.outOfOrder && STORES.has(e.decoded.mnemonic)) {
        this.writeStoreToMemory(e, events);
      }
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

  /**
   * The store's memory write — the sb/sh/sw mask + writeByte/writeHalf/writeWord idiom, in ONE
   * place. It is the deferred commit-time write in out-of-order mode (see `stageCommit`'s call
   * site: `aluOut`/`storeData` were latched at issue and have sat untouched since — commit is the
   * first moment it is safe to act on them), AND the immediate MEM-stage write in the in-order
   * branch ({@link completeMemAccess}). Sharing it is what stops the two mem paths' masking logic
   * from drifting (M9+M10 review finding 10).
   */
  private writeStoreToMemory(e: RobEntry, events: TraceEvent[]): void {
    const mnemonic = e.decoded.mnemonic;
    if (e.aluOut === null) {
      throw new Error(`out-of-order: ${mnemonic} stores with no effective address latched`);
    }
    if (e.storeData === null) {
      throw new Error(`out-of-order: ${mnemonic} stores with no store datum latched`);
    }
    const addr = e.aluOut >>> 0;
    const value =
      mnemonic === 'sb'
        ? e.storeData & 0xff
        : mnemonic === 'sh'
          ? e.storeData & 0xffff
          : e.storeData;
    events.push({ type: 'mem-write', addr, value, instr: e.instr });
    if (mnemonic === 'sb') this.memory.writeByte(addr, value);
    else if (mnemonic === 'sh') this.memory.writeHalf(addr, value);
    else this.memory.writeWord(addr, value);
  }

  /**
   * The load's memory read — the lb/lh/lw read + sign-extend idiom plus the CDB broadcast, the
   * counterpart to {@link writeStoreToMemory} and equally shared by both mem paths ({@link
   * completeMemAccess} in-order, {@link completeMemAccessOutOfOrder} out-of-order) so a
   * sign-extension fix in one can never leave the other divergent (M9+M10 review finding 10). Reads
   * `this.memory` (a store's write already landed either at MEM in-order or at the older store's
   * commit out-of-order — the disambiguation gate guarantees no aliasing store is still pending),
   * latches `e.value`, and queues the broadcast when the load writes a register.
   */
  private performLoad(e: RobEntry, events: TraceEvent[]): void {
    const mnemonic = e.decoded.mnemonic;
    if (e.aluOut === null) {
      throw new Error(`out-of-order: ${mnemonic} loads with no effective address latched`);
    }
    const addr = e.aluOut >>> 0;
    const raw =
      mnemonic === 'lb' || mnemonic === 'lbu'
        ? this.memory.readByte(addr)
        : mnemonic === 'lh' || mnemonic === 'lhu'
          ? this.memory.readHalf(addr)
          : this.memory.readWord(addr);
    events.push({ type: 'mem-read', addr, value: raw, instr: e.instr });
    e.value = mnemonic === 'lb' ? (raw << 24) >> 24 : mnemonic === 'lh' ? (raw << 16) >> 16 : raw;
    if (e.rd !== 0) this.pendingBroadcasts.push({ tag: e.tag, seq: e.seq, value: e.value });
  }

  // -----------------------------------------------------------------------------------------
  // MEM ACCESS + CDB BROADCAST. Two whole policies, switched by `this.outOfOrder` (see that
  // field's doc) — never mixed:
  //
  //  - In-order (1a, unchanged): the single data-memory port is BLOCKING on a miss, freezing
  //    everything younger (`ctx.memStall`). A store writes memory right here.
  //  - Out-of-order (1b): a non-blocking LSU. Each entry's miss is tracked independently
  //    (`missCyclesRemaining` + an MSHR grant, `this.missInFlight`) instead of one shared
  //    `ctx.memStall` — an unrelated ready entry is never frozen by someone else's miss. A load
  //    additionally passes a memory-disambiguation gate before it may access memory at all
  //    (`disambiguationClear`). A store's write is NOT here — see `stageCommit`/
  //    `writeStoreToMemory` for why it is deferred — this stage only prices the store's cache
  //    timing (a real MSHR-bearing miss can happen on a store too) and marks it `'completed'`.
  // -----------------------------------------------------------------------------------------

  private stageMemAccess(ctx: CycleCtx): void {
    if (this.outOfOrder) this.stageMemAccessOutOfOrder(ctx);
    else this.stageMemAccessInOrder(ctx);
  }

  private stageMemAccessInOrder(ctx: CycleCtx): void {
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

  /**
   * Step 1b's non-blocking LSU. Same per-entry cache-timing shape as the in-order branch, but
   * gated per-entry instead of machine-wide: a miss NEVER sets `ctx.memStall`, so an independent
   * entry keeps completing on schedule while another sits mid-miss — the tier's whole benefit.
   *
   * MSHR handling: a newly DETECTED miss either GRANTS a slot immediately (if `this.missInFlight`
   * has room) or QUEUES (`missCyclesRemaining` set, `mshrGranted` false) until one frees — checked
   * fresh every cycle. Granting costs its own cycle with no decrement yet, deliberately mirroring
   * the in-order branch's own "detect cycle" (no decrement the cycle a miss is first found) so a
   * single miss with an MSHR free immediately takes exactly `missPenalty` cycles, same as 1a — the
   * only observable difference for that one entry is that NOTHING ELSE freezes around it.
   */
  private stageMemAccessOutOfOrder(ctx: CycleCtx): void {
    for (const e of this.pendingCommitEvents) ctx.events.push(e);
    this.pendingCommitEvents = [];

    for (const e of this.rob.all()) {
      if (e.state === 'executed') {
        e.state = 'completed';
        continue;
      }
      if (e.state !== 'awaitingMem') continue;

      const load = isLoad(e.decoded);
      const store = STORES.has(e.decoded.mnemonic);

      // A load may not even ATTEMPT its memory access while an older, still-in-flight store's
      // address is unknown or aliases it — see `disambiguationClear`. Retried fresh every cycle;
      // no state is touched while blocked, so there is nothing to undo if this load is later
      // flushed.
      if (load && !this.disambiguationClear(e)) continue;

      if (e.missCyclesRemaining > 0) {
        if (!e.mshrGranted) {
          if (this.missInFlight.size >= this.numMshrs) continue; // every MSHR busy — stay queued
          this.missInFlight.add(tagNumber(e.tag));
          e.mshrGranted = true;
          continue; // the grant cycle itself, no decrement yet (mirrors the detect cycle below)
        }
        const remaining = e.missCyclesRemaining - 1;
        if (remaining > 0) {
          e.missCyclesRemaining = remaining;
          continue;
        }
        e.missCyclesRemaining = 0;
        this.missInFlight.delete(tagNumber(e.tag));
        e.mshrGranted = false;
        // the release cycle: fall through to the real access this same cycle, as the in-order
        // branch does.
      } else {
        const penalty = this.consultCache(ctx, e);
        if (penalty > 0) {
          e.missCyclesRemaining = penalty;
          // Grant NOW if a slot is free, so a lone miss costs exactly `missPenalty` cycles total
          // (detect+grant sharing this one cycle) — otherwise it queues for a later cycle's retry.
          if (this.missInFlight.size < this.numMshrs) {
            this.missInFlight.add(tagNumber(e.tag));
            e.mshrGranted = true;
          }
          continue;
        }
      }
      this.completeMemAccessOutOfOrder(ctx, e, load, store);
    }
  }

  /**
   * Memory disambiguation (step 1b): may `load` (already known to be a load in `'awaitingMem'`,
   * so `load.aluOut` is already latched) go to memory yet? It may not bypass any OLDER store
   * still sitting in the ROB (uncommitted): if that store's own address is not yet known, the
   * load cannot rule out aliasing and must wait; if it IS known and matches, the load must wait
   * for that exact store to retire (at which point `this.memory` already holds its value, so an
   * ordinary read afterward is correct with no forwarding path needed — the simplest design that
   * satisfies "does not bypass an aliasing older store").
   *
   * Aliasing is a BYTE-RANGE OVERLAP, not base-address equality: the load touches
   * `[addr, addr + loadWidth)` and the store `[storeAddr, storeAddr + storeWidth)` (widths from
   * {@link accessWidth}), and any overlap aliases. A base-address `===` (the original gate) let a
   * younger sub-word load slip past an older word store at an adjacent-but-unequal address —
   * `sw t1, 0(t0)` then `lb t2, 1(t0)` — reading stale memory before the store committed, an INV-8
   * class corruption reachable from user-typed sandbox assembly.
   */
  protected disambiguationClear(load: RobEntry): boolean {
    if (load.aluOut === null) {
      throw new Error(`out-of-order: ${load.decoded.mnemonic} disambiguates with no address yet`);
    }
    const addr = load.aluOut >>> 0;
    const loadWidth = accessWidth(load.decoded.mnemonic);
    for (const s of this.rob.all()) {
      if (s.seq >= load.seq) continue; // only OLDER entries can alias
      if (!STORES.has(s.decoded.mnemonic)) continue;
      if (s.aluOut === null) return false; // an older store's address isn't known yet — wait
      const storeAddr = s.aluOut >>> 0;
      const storeWidth = accessWidth(s.decoded.mnemonic);
      // Half-open interval overlap: [addr, addr+loadWidth) ∩ [storeAddr, storeAddr+storeWidth) ≠ ∅.
      if (addr < storeAddr + storeWidth && storeAddr < addr + loadWidth) {
        return false; // overlaps an older, still-uncommitted store — wait for it to retire
      }
    }
    return true;
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
    // In-order: the load reads and the store writes right here at MEM — both through the shared
    // primitives, so the read/sign-extend and mask/write idioms live in exactly one place each.
    if (isLoad(e.decoded)) this.performLoad(e, ctx.events);
    else if (STORES.has(e.decoded.mnemonic)) this.writeStoreToMemory(e, ctx.events);
    e.state = 'completed';
  }

  /**
   * Step 1b's counterpart to {@link completeMemAccess}: a load reads memory and broadcasts (through
   * the shared {@link performLoad}, exactly as the in-order branch does). A store does NOT write
   * here — {@link stageCommit} / {@link writeStoreToMemory} do, once the store is known to be
   * right-path. That deferral is the one place the two branches' behaviour genuinely diverges
   * beyond "blocking vs non-blocking timing."
   */
  private completeMemAccessOutOfOrder(
    ctx: CycleCtx,
    e: RobEntry,
    load: boolean,
    store: boolean,
  ): void {
    if (load) this.performLoad(e, ctx.events);
    else if (!store) {
      throw new Error(`out-of-order: ${e.decoded.mnemonic} reached MEM as neither load nor store`);
    }
    e.state = 'completed';
  }

  /**
   * Is this the designated slow op, AND is the slow-op knob engaged? `sll` (register shift) is the
   * RV32I stand-in for a multi-cycle functional unit — `mul`/`div` would need the M extension, which
   * INV-7 forbids. Deliberately mnemonic-specific (not the shared ALU op string, which `slli` also
   * uses): the slow one is a single, teachable INSTRUCTION. Only ever true for a pure value-producer,
   * which is load-bearing — see the deferral note in {@link stageIssueExecute}. False whenever
   * `slowOpLatency < 2`, so the default machine never defers anything (the parity guard).
   */
  private isSlowOp(d: DecodedInstruction): boolean {
    return this.slowOpLatency >= 2 && d.mnemonic === 'sll';
  }

  /**
   * Does an in-flight slow FU op FREEZE during a blocking cache miss in the in-order branch? YES —
   * the M3/M7 "occupant holds in EX during a MEM stall" semantics this branch mirrors (M9+M10 review
   * finding 9). The pipeline family has no multi-cycle FU, so there is no external ground truth; this
   * is the deliberate, documented choice. A `protected` seam ONLY so the parity test can restore the
   * pre-fix "FU advances through the freeze" behaviour and show it diverges in timing; production
   * never overrides it, and it is irrelevant to out-of-order mode (which never sets `ctx.memStall`).
   */
  protected fuFreezesDuringMemStall(): boolean {
    return true;
  }

  // -----------------------------------------------------------------------------------------
  // FU ADVANCE (M10). The ALU analogue of `stageMemAccess`'s miss service: count down every
  // `'executing'` slow op's remaining FU cycles, and when one reaches 0 run its `executeEntry`
  // (which fires the `alu-op`, latches the value, and queues the CDB broadcast). Runs BEFORE
  // `stageIssueExecute` — exactly like `stageMemAccess` — so a slow op set `'executing'` THIS cycle
  // is not counted down until NEXT cycle, giving it `slowOpLatency` full FU cycles. A no-op (nothing
  // is ever `'executing'`) unless `slowOpLatency >= 2`.
  //
  // Gated by `ctx.memStall`, exactly like `stageIssueExecute` (M9+M10 review finding 9). In the
  // IN-ORDER branch a blocking cache miss freezes the whole front end (`ctx.memStall`), and the
  // in-flight FU op freezes WITH it — the M3/M7 "occupant holds in EX during a MEM stall" semantics
  // this branch mirrors, so a slow op does not secretly finish mid-freeze. This is a deliberate
  // pedagogical CHOICE (the pipeline family has no multi-cycle FU, so there is no external ground
  // truth), pinned by `cache × slow-op` parity below. It is a NO-OP for out-of-order mode, whose
  // non-blocking LSU never sets `ctx.memStall`, so the FU keeps advancing around an independent
  // miss exactly as the tier requires.
  // -----------------------------------------------------------------------------------------

  private stageFuAdvance(ctx: CycleCtx): void {
    if (ctx.memStall && this.fuFreezesDuringMemStall()) return; // in-order only (memStall never set when this.outOfOrder)
    for (const e of this.rob.all()) {
      if (e.state !== 'executing') continue;
      e.fuCyclesRemaining -= 1;
      if (e.fuCyclesRemaining <= 0) {
        this.executeEntry(
          ctx,
          e,
          e.srcA !== null && e.srcA.ready ? e.srcA.value : 0,
          e.srcB !== null && e.srcB.ready ? e.srcB.value : 0,
        );
      }
    }
  }

  // -----------------------------------------------------------------------------------------
  // ISSUE + EXECUTE. In-order (1a): strict program order, oldest-first, no reordering — a blocked
  // entry stops the walk, nothing younger may pass it. Out-of-order (1b): true wakeup/select — a
  // blocked entry is merely SKIPPED, so a ready younger entry may issue around it. Both share one
  // walk (`walkIssuable`, below) so the two policies can never drift apart — see its doc.
  // -----------------------------------------------------------------------------------------

  private stageIssueExecute(ctx: CycleCtx): void {
    if (ctx.memStall) return; // in-order only: the whole front end freezes on a miss (never set when this.outOfOrder)

    for (const e of this.walkIssuable(ctx)) {
      // M10: a slow op ISSUES here (it consumed this cycle's issue slot in `walkIssuable`) but does
      // NOT execute yet — it enters the FU for `slowOpLatency - 1` more cycles, freeing the issue
      // port. `stageFuAdvance` runs `executeEntry` when the FU completes, which is where its `alu-op`
      // fires and its value broadcasts. Deferring is only ever done for a pure value-producer (`sll`,
      // guarded by `isSlowOp`) — deferring a transfer/halt would defer `ctx.squash` and corrupt
      // speculation.
      if (this.isSlowOp(e.decoded)) {
        e.state = 'executing';
        e.fuCyclesRemaining = this.slowOpLatency - 1;
        continue;
      }
      this.executeEntry(
        ctx,
        e,
        e.srcA !== null && e.srcA.ready ? e.srcA.value : 0,
        e.srcB !== null && e.srcB.ready ? e.srcB.value : 0,
      );
      // `executeEntry` may just have set `ctx.squash` (a mispredict or a halt). `walkIssuable`
      // reads `ctx` fresh every time this generator is resumed (JS generators re-run their body
      // from the paused point, not from a snapshot), so the NEXT entry it offers already reflects
      // that — in-order mode stops dead, out-of-order mode skips only entries younger than the
      // squashing one (guaranteed by the oldest-first walk order: nothing not-yet-visited can be
      // older than the entry that just squashed).
    }
  }

  /**
   * The shared resource-contest + readiness walk behind both real issue (above) and `stageBet`'s
   * one-cycle-ahead prediction. Yields entries in the order they may issue THIS cycle, oldest
   * ready-and-eligible one first (deterministic tie-break, INV-1 — no seed needed): a linear
   * oldest-to-youngest scan that hands out `width` slots and the single mem-port/branch-unit
   * resources on a first-come basis naturally IS oldest-first priority, not just a tie-break.
   *
   * `this.outOfOrder` is the only branch point, and it is exactly "stop vs. skip": in-order mode
   * treats the first non-selectable entry as a wall (nothing younger may pass it, 1a's whole
   * constraint); out-of-order mode treats it as merely occupied — this cycle — and keeps scanning
   * for a ready younger entry (the wakeup/select this step adds). Everything else (readiness,
   * resource accounting, squash-awareness) is identical, which is the point: `stageBet` predicting
   * a DIFFERENT policy than `stageIssueExecute` actually runs was 1a's bug #6.
   *
   * A caller that only inspects the yielded entries (never calls `executeEntry`) — `stageBet` — is
   * safe to fully drain in one pass: nothing in this generator mutates ROB/rename state, so no
   * yielded entry's eligibility can retroactively change mid-walk from that caller's own actions.
   */
  private *walkIssuable(ctx: CycleCtx): Generator<RobEntry> {
    let issueBudget = this.width;
    let memUsed = false;
    let branchUsed = false;

    for (const e of this.rob.all()) {
      if (e.state !== 'waiting') continue; // already issued/completed — not this walk's concern
      if (issueBudget <= 0) break; // no width left for anyone, in-order or out-of-order

      if (ctx.squash !== null) {
        if (this.outOfOrder) continue;
        break;
      }

      const isMem = usesMemPort(e.decoded);
      const isBranch = TRANSFERS.has(e.decoded.mnemonic);
      const resourceBlocked = (isMem && memUsed) || (isBranch && branchUsed);

      // Readiness reads the operand sources CAPTURED AT DISPATCH (see `RobEntry.srcA`/`srcB`'s
      // doc) — never re-derived here. Re-deriving live would let a younger same-cycle dispatch's
      // rename claim corrupt this (older) instruction's already-decided source.
      const ready = (e.srcA === null || e.srcA.ready) && (e.srcB === null || e.srcB.ready);

      if (!ready || resourceBlocked) {
        if (this.outOfOrder) continue;
        break;
      }

      issueBudget -= 1;
      if (isMem) memUsed = true;
      if (isBranch) branchUsed = true;
      yield e;
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
        this.pendingBroadcasts.push({ tag: e.tag, seq: e.seq, value: e.value });
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
  // at the moment of the check. So this walks `walkIssuable` — the SAME generator
  // `stageIssueExecute` runs, in-order or out-of-order alike — to find whichever entries WOULD
  // issue next cycle, and bets on the (at most one, the single branch unit) transfer among them.
  // Sharing the walk (not re-deriving it, as 1a's own version of this method did) is what keeps
  // this prediction from drifting out of sync with what issue actually does once issue goes
  // out-of-order at step 1b — exactly the failure mode 1a's bug #6 was.
  // -----------------------------------------------------------------------------------------

  private stageBet(ctx: CycleCtx): void {
    if (!this.predictTaken) return;
    if (ctx.squash !== null || ctx.bet !== null) return;

    for (const e of this.walkIssuable(ctx)) {
      if (!TRANSFERS.has(e.decoded.mnemonic) || e.predictedTaken) continue;
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
      micro: this.snapshotMicro(),
    };
  }

  /**
   * The per-cycle `micro` snapshot the step-6 `MicroTablePanel` folds over (INV-3). INDEPENDENT of
   * every other cycle — see `micro.ts`'s header for why the ROB needs a fresh object per entry and
   * not a `.slice()` of the array (the repo's signature time-travel bug: `state`/`value` are mutated
   * in place and the array is `shift()`ed on commit). The cache is deliberately NOT exposed here —
   * see {@link OutOfOrderMicro}'s doc for why (the shared cache grid depends on pipeline-shaped
   * `exMem` state this model lacks).
   */
  private snapshotMicro(): OutOfOrderMicro {
    return {
      robCapacity: this.rob.maxSize,
      rob: this.rob.all().map((e) => copyRobEntry(e)),
      rename: this.rename.snapshot().map(renameSlotView),
    };
  }
}

/** Project one live {@link RobEntry} into an independent, view-friendly {@link RobEntryView}. */
function copyRobEntry(e: RobEntry): RobEntryView {
  return {
    tag: tagNumber(e.tag),
    seq: e.seq,
    id: e.instr,
    decoded: e.decoded,
    rd: e.rd,
    state: e.state,
    value: e.value,
    srcA: operandView(e.srcA),
    srcB: operandView(e.srcB),
  };
}

/** Read an {@link OperandSource} back with its tag as a plain number (the sanctioned tag readback). */
function operandView(src: OperandSource | null): OperandView | null {
  if (src === null) return null;
  return src.ready ? { ready: true, value: src.value } : { ready: false, tag: tagNumber(src.tag) };
}

function renameSlotView(slot: RenameSlot): RenameSlotView {
  return slot.kind === 'committed'
    ? { kind: 'committed' }
    : { kind: 'pending', tag: tagNumber(slot.tag) };
}
