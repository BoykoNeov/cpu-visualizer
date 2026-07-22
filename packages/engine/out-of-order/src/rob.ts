import type { DecodedInstruction } from '@cpu-viz/isa';
import { makeTag, tagsEqual, type OperandSource, type RenameSlot, type Tag } from './types';

/**
 * The ROB's per-entry state machine. `'waiting'` is dispatched-but-not-issued (the reservation-
 * station-equivalent at this step — see the file header). `'awaitingMem'` is a load/store whose
 * address is known but whose data access hasn't happened (or is mid-miss). `'executed'` is a
 * NON-memory instruction whose value is already known and already broadcast (a waiting consumer
 * may already have captured it) but which is not yet eligible to COMMIT — the pass-through cycle
 * every latch model's MEM stage gives every instruction for free, memory or not (M3/M7's EX/MEM
 * latch holds a value one cycle before MEM/WB does; without this state an ALU instruction would
 * retire one cycle sooner than the closed form pins, which the timing suite catches immediately).
 * `'completed'` means the value (if any), `nextPc`, and `halt` are all final AND the entry is
 * eligible to commit.
 */
export type RobState = 'waiting' | 'awaitingMem' | 'executed' | 'completed';

/**
 * The ROB's payload for one in-flight instruction (PRF-forward-compat seam #2: this is the part
 * a future PRF backend would replace — the ORDERING mechanics below never look inside it except
 * to read `state`/`seq`).
 */
export interface RobEntry {
  readonly tag: Tag;
  /** Monotonic allocation order — the age used for "younger than" comparisons and flush. */
  readonly seq: number;
  readonly instr: string;
  readonly pc: number;
  readonly ir: number;
  readonly decoded: DecodedInstruction;
  /** Architectural destination, or 0 for "writes nothing" (mirrors every model's `destReg`). */
  readonly rd: number;
  /** What `rd` mapped to before this entry claimed it — replayed on flush, see `RenameTable.restore`. */
  readonly prevMapping: RenameSlot;
  /**
   * Was this a control transfer predicted taken? (mirrors the latch models' `predictedTaken`.)
   * Starts `false` at allocation and is set — at most once, by `OutOfOrderProcessor.stageBet` —
   * the cycle before this entry would issue, never at dispatch: dispatch and issue are decoupled
   * here, so a transfer can sit `'waiting'` on its own operand for several cycles after dispatch,
   * and betting immediately at dispatch fires too early whenever that happens (bug #6 in the
   * step-1a build log). Mutable for exactly that reason — it is NOT a dispatch-time snapshot.
   */
  predictedTaken: boolean;
  /**
   * The two source operands, captured ONCE at dispatch (real reservation-station semantics) and
   * thereafter mutated ONLY by the broadcast/wakeup after a producer completes — NEVER re-derived
   * from a live rename-table lookup. This is the fix for a real bug: the rename map mutates as
   * sibling instructions dispatch in the same cycle, so re-deriving an operand's source later
   * would let a YOUNGER same-cycle dispatch corrupt an OLDER instruction's already-decided source
   * (e.g. `bge a0,a1,done` followed immediately by `addi a0,a1,0` — the `bge` must keep reading
   * whatever `a0` meant at ITS OWN dispatch moment, not whatever it means after `addi` claims it a
   * moment later in the same dispatch group).
   */
  srcA: OperandSource | null;
  srcB: OperandSource | null;
  state: RobState;
  /** The captured result for `rd`, once known. Null for stores and while pending. */
  value: number | null;
  /** Resolved next pc. Null until execute. */
  nextPc: number | null;
  halt: boolean;
  /** Effective address (load/store) or null. Latched at issue, consumed at the mem-access step. */
  aluOut: number | null;
  /** The value a store writes, or null. */
  storeData: number | null;
  /** >0 while a load/store miss is being served; decremented each mem-access cycle. */
  missCyclesRemaining: number;
}

/** The fields the allocator needs from a caller; everything else starts at its pending default. */
export type RobAllocation = Pick<
  RobEntry,
  'instr' | 'pc' | 'ir' | 'decoded' | 'rd' | 'prevMapping' | 'srcA' | 'srcB'
>;

/**
 * The reorder buffer's ORDERING half (PRF-forward-compat seam #2): an in-order queue that knows
 * `state`/`seq` and nothing about what a value means. A plain array is enough at this scale
 * (`robSize` is small — a handful to a few dozen — so O(n) scans cost nothing observable), kept
 * oldest-first by construction: `allocate` only ever appends, `commitReady` only ever shifts.
 *
 * Mutated in place across cycles, like the superscalar's single-buffered cache state — NOT part
 * of any recorded snapshot (`MachineState.micro` stays unset at this step), so no double-buffering
 * discipline is needed here the way the latch models need for what they DO expose.
 */
export class Rob {
  private entries: RobEntry[] = [];
  private nextSeq = 0;
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  reset(capacity: number): void {
    this.entries = [];
    this.nextSeq = 0;
    this.capacity = capacity;
  }

  get size(): number {
    return this.entries.length;
  }

  hasRoom(count: number): boolean {
    return this.entries.length + count <= this.capacity;
  }

  allocate(fields: RobAllocation): RobEntry {
    const entry: RobEntry = {
      ...fields,
      tag: makeTag(this.nextSeq),
      seq: this.nextSeq,
      state: 'waiting',
      predictedTaken: false,
      value: null,
      nextPc: null,
      halt: false,
      aluOut: null,
      storeData: null,
      missCyclesRemaining: 0,
    };
    this.nextSeq += 1;
    this.entries.push(entry);
    return entry;
  }

  entryFor(tag: Tag): RobEntry | undefined {
    return this.entries.find((e) => tagsEqual(e.tag, tag));
  }

  /** Every in-flight entry, oldest first — the walk order every stage below uses. */
  all(): readonly RobEntry[] {
    return this.entries;
  }

  head(): RobEntry | undefined {
    return this.entries[0];
  }

  /** Commit up to `width` ready entries from the head, removing them. Stops at the first pending one. */
  commitReady(width: number): RobEntry[] {
    const out: RobEntry[] = [];
    while (out.length < width) {
      const head = this.entries[0];
      if (head === undefined || head.state !== 'completed') break;
      out.push(head);
      this.entries.shift();
    }
    return out;
  }

  /**
   * The CDB broadcast: every entry still waiting on `tag` (in either operand) captures `value`.
   * Called once per completion, AFTER this cycle's own issue decisions are already locked in — see
   * the processor's cycle order — so a producer completing THIS cycle wakes waiters starting NEXT
   * cycle, never within the same one (no zero-latency same-cycle forward exists anywhere else in
   * this family, and this model does not invent one).
   */
  wake(tag: Tag, value: number): void {
    for (const e of this.entries) {
      if (e.srcA !== null && !e.srcA.ready && tagsEqual(e.srcA.tag, tag)) {
        e.srcA = { ready: true, value };
      }
      if (e.srcB !== null && !e.srcB.ready && tagsEqual(e.srcB.tag, tag)) {
        e.srcB = { ready: true, value };
      }
    }
  }

  /**
   * Flush recovery: remove every entry younger than `afterSeq` (the mispredicting/halting
   * instruction's own age), returning them YOUNGEST-FIRST — the order `RenameTable.restore` must
   * be replayed in, so a register two wrong-path instructions both claimed unwinds correctly.
   */
  flushAfter(afterSeq: number): RobEntry[] {
    const keep: RobEntry[] = [];
    const flushed: RobEntry[] = [];
    for (const e of this.entries) {
      if (e.seq > afterSeq) flushed.push(e);
      else keep.push(e);
    }
    this.entries = keep;
    flushed.reverse();
    return flushed;
  }
}
