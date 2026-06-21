/**
 * Sparse, byte-addressed memory — the concrete {@link MemoryView} every engine and the
 * golden reference use (handoff §5, §9). It lives in `trace` (not in an engine) because
 * it implements a trace type and the step-6 driver/recorder restores per-cycle memory
 * snapshots; both engines and the driver need it.
 *
 * One flat address space holds BOTH the instruction words and `.data` — fetch, load, and
 * store all go through the same path, which is the simplest thing that is obviously
 * correct (§9). Windowing this down to a "text / data / stack" view is the VIEW's job, not
 * the engine's (INV-2, INV-3): the engine emits full state and the renderer decides what
 * to show. So `definedAddresses()` legitimately includes the loaded text — a consumer that
 * only wants data filters by region.
 *
 * Backed by a `Map<byteAddr, 0..255>`; never-written bytes read as 0. All reads are
 * little-endian (RV32I). Loads/stores normalize addresses to unsigned 32-bit.
 */

import type { MemoryView } from './schema';

export class SparseMemory implements MemoryView {
  private readonly bytes: Map<number, number>;

  /** Start empty, or as an independent copy of `bytes` (used by {@link snapshot}). */
  constructor(bytes?: ReadonlyMap<number, number>) {
    this.bytes = bytes ? new Map(bytes) : new Map();
  }

  /** Place raw bytes at `addr` (used to load `.data` segments at reset). */
  loadBytes(addr: number, data: Uint8Array): void {
    for (let i = 0; i < data.length; i++) {
      this.bytes.set((addr + i) >>> 0, data[i]!);
    }
  }

  readByte(addr: number): number {
    return this.bytes.get(addr >>> 0) ?? 0;
  }

  writeByte(addr: number, value: number): void {
    this.bytes.set(addr >>> 0, value & 0xff);
  }

  /** 16-bit little-endian, zero-extended (0..0xffff). Sign-extension is the load's job. */
  readHalf(addr: number): number {
    return this.readByte(addr) | (this.readByte(addr + 1) << 8);
  }

  writeHalf(addr: number, value: number): void {
    this.writeByte(addr, value & 0xff);
    this.writeByte(addr + 1, (value >>> 8) & 0xff);
  }

  /** 32-bit little-endian, returned as a signed int32 (matches the GPR representation). */
  readWord(addr: number): number {
    const w =
      this.readByte(addr) |
      (this.readByte(addr + 1) << 8) |
      (this.readByte(addr + 2) << 16) |
      (this.readByte(addr + 3) << 24);
    return w | 0;
  }

  writeWord(addr: number, value: number): void {
    this.writeByte(addr, value & 0xff);
    this.writeByte(addr + 1, (value >>> 8) & 0xff);
    this.writeByte(addr + 2, (value >>> 16) & 0xff);
    this.writeByte(addr + 3, (value >>> 24) & 0xff);
  }

  /** Word-aligned bases of every address ever written, ascending — for diffed display. */
  definedAddresses(): readonly number[] {
    const words = new Set<number>();
    for (const addr of this.bytes.keys()) {
      words.add((addr & ~0x3) >>> 0);
    }
    return [...words].sort((a, b) => a - b);
  }

  /**
   * An independent deep copy — the per-cycle snapshot the recorder keeps so time-travel
   * shows the memory as it was AT that cycle, not the latest mutation (handoff §6). The
   * clone shares no mutable state with the original.
   */
  snapshot(): SparseMemory {
    return new SparseMemory(this.bytes);
  }
}
