import type { DecodedInstruction } from '@cpu-viz/isa';

/**
 * The trace schema — the linchpin contract (handoff §5). Views and curriculum read the
 * trace; they never reach into engine internals (INV-3). These are illustrative seeds:
 * field names and event payloads will be refined as real views consume them, but the
 * SHAPE is fixed — per-cycle full state + an ordered list of typed events, with stable
 * instruction IDs throughout (INV-4).
 */

/** Number of general-purpose registers in RV32I. `x0` is hardwired to zero. */
export const RV32I_REGISTER_COUNT = 32;

/** A read-only windowed view of memory; the engine never snapshots all of address space. */
export interface MemoryView {
  /** Read a 32-bit little-endian word; returns 0 for never-written addresses. */
  readWord(addr: number): number;
  /** The addresses (word-aligned) that have ever been written, for diffed display. */
  definedAddresses(): readonly number[];
}

/** The architectural state common to every microarchitecture. */
export interface MachineState {
  pc: number;
  /** 32 GPRs for RV32I; index 0 (`x0`) is hardwired to 0. */
  registers: Int32Array;
  memory: MemoryView;
  halted: boolean;
  /** Per-model extension: pipeline latches, ROB, reservation stations, etc. */
  micro?: unknown;
}

/** Each in-flight instruction, tracked by stable id (INV-4) for its whole lifetime. */
export interface InstructionInstance {
  /** Stable across cycles, from fetch to retire. */
  id: string;
  pc: number;
  encoding: number;
  /** Maps back to the assembly the user wrote, or `null` for synthesized instructions. */
  sourceLine: number | null;
  decoded: DecodedInstruction;
  /** Where it is NOW: `"single-cycle"` | `"IF"` | `"ID"` | ... | `"ROB#3"`. */
  location: string;
}

/** Ordered transactions that happened during one cycle. Discriminated on `type`. */
export type TraceEvent =
  | { type: 'reg-read'; reg: number; value: number; instr: string }
  | { type: 'reg-write'; reg: number; value: number; instr: string }
  | { type: 'alu-op'; op: string; a: number; b: number; result: number; instr: string }
  | { type: 'mem-read'; addr: number; value: number; instr: string }
  | { type: 'mem-write'; addr: number; value: number; instr: string }
  | { type: 'instr-fetch'; instr: string; pc: number; encoding: number }
  | { type: 'instr-retire'; instr: string }
  // --- pedagogically important; mostly fire from the pipeline tier onward ---
  | { type: 'forward'; from: string; to: string; value: number; instr: string }
  | { type: 'stall'; reason: string; stage: string; instr: string }
  | { type: 'flush'; reason: string; stages: string[] }
  | { type: 'branch-resolved'; instr: string; predicted: boolean; actual: boolean }
  | { type: 'cache-access'; level: number; addr: number; hit: boolean; evicted?: number };

/** One tick of the machine; the engine returns this from `step()`. */
export interface CycleTrace {
  /** Monotonic, starts at 0. */
  cycle: number;
  /** FULL snapshot AFTER this cycle (enables time-travel via the driver, §6). */
  state: MachineState;
  /** Ordered transactions that happened DURING this cycle. */
  events: TraceEvent[];
  /** Every in-flight instruction this cycle. */
  instructions: InstructionInstance[];
}

/**
 * Allocate a fresh RV32I register file with `x0` pinned to zero. Engines and the golden
 * reference start here.
 */
export function makeRegisters(): Int32Array {
  return new Int32Array(RV32I_REGISTER_COUNT);
}
