/**
 * The golden-reference interpreter (handoff §9): pure fetch / decode / execute, no
 * microarchitecture, no pipeline, no per-cycle trace. Its only job is to be OBVIOUSLY
 * correct — every fancy model is differentially tested against its final architectural
 * state (INV-8). Because nothing tests the reference *against* anything, its own tests
 * are hand-computed oracles (`run.test.ts`), not comparisons.
 *
 * Determinism (INV-1): same program ⇒ same result; no wall-clock, no randomness.
 *
 * Time-travel, `Processor`, and `CycleTrace` deliberately live one layer up, with the
 * actual microarchitecture models and the driver (handoff §6, build steps 4–5). The
 * reference does not implement them; it just runs a program to completion.
 */

import { decode } from '@cpu-viz/isa';
import { TEXT_BASE, type AssembledProgram } from '@cpu-viz/assembler';
import { makeRegisters, SparseMemory, type MachineState } from '@cpu-viz/trace';

/** Why {@link run} stopped. Only `ecall`/`ebreak` are architectural halts. */
export type HaltReason =
  | 'ecall'
  | 'ebreak'
  | 'pc-out-of-range'
  | 'unknown-instruction'
  | 'max-steps';

export interface RunOptions {
  /** Safety cap on executed instructions, to bound runaway loops. */
  maxSteps?: number;
}

export interface ReferenceResult {
  /** Final architectural state (pc, registers, memory, halted) — the INV-8 comparison surface. */
  state: MachineState;
  /** Instructions executed (including the halting `ecall`/`ebreak`). */
  steps: number;
  haltReason: HaltReason;
}

const DEFAULT_MAX_STEPS = 1_000_000;

/**
 * Run an assembled program to completion. Text words and `.data` are loaded into one
 * flat memory (handoff "memory map": text at {@link TEXT_BASE}, data at its emitted
 * address); execution begins at {@link TEXT_BASE}.
 */
export function run(program: AssembledProgram, options: RunOptions = {}): ReferenceResult {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const registers = makeRegisters();
  const memory = new SparseMemory();

  // Load text as little-endian words, then initialized data. One flat space (§9).
  for (let i = 0; i < program.words.length; i++) {
    memory.writeWord((TEXT_BASE + i * 4) >>> 0, program.words[i]!);
  }
  for (const segment of program.data) {
    memory.loadBytes(segment.addr, segment.bytes);
  }

  const textEnd = (TEXT_BASE + program.words.length * 4) >>> 0;

  // x0 is hardwired to 0: writes to it are discarded. GPRs are signed int32 (Int32Array);
  // read `u()` for the unsigned-sensitive ops, `s()` otherwise.
  const writeReg = (rd: number, value: number): void => {
    if (rd !== 0) registers[rd] = value | 0;
  };
  const s = (r: number): number => registers[r]!;
  const u = (r: number): number => registers[r]! >>> 0;

  let pc = TEXT_BASE >>> 0;
  let halted = false;
  let haltReason: HaltReason = 'max-steps';
  let steps = 0;

  while (true) {
    if (steps >= maxSteps) {
      haltReason = 'max-steps';
      break;
    }
    if (pc < TEXT_BASE || pc >= textEnd) {
      haltReason = 'pc-out-of-range';
      halted = true;
      break;
    }

    const word = memory.readWord(pc) >>> 0;
    const d = decode(word);
    const { rd, rs1, rs2, imm } = d;
    const shamt = imm & 0x1f; // shift amount: low 5 bits, for both reg- and imm-shifts
    let nextPc = (pc + 4) >>> 0;
    steps++;

    switch (d.mnemonic) {
      // --- U-type: imm already holds imm[31:12] in place (no extra shift) ---
      case 'lui':
        writeReg(rd, imm);
        break;
      case 'auipc':
        writeReg(rd, (pc + imm) | 0);
        break;

      // --- Jumps: imm is a sign-extended, byte-scaled offset ---
      case 'jal':
        writeReg(rd, (pc + 4) | 0);
        nextPc = (pc + imm) >>> 0;
        break;
      case 'jalr': {
        const target = ((s(rs1) + imm) & ~1) >>> 0; // compute before writing rd (rd may == rs1)
        writeReg(rd, (pc + 4) | 0);
        nextPc = target;
        break;
      }

      // --- Branches: signed vs unsigned compares; imm is the byte-scaled offset ---
      case 'beq':
        if (s(rs1) === s(rs2)) nextPc = (pc + imm) >>> 0;
        break;
      case 'bne':
        if (s(rs1) !== s(rs2)) nextPc = (pc + imm) >>> 0;
        break;
      case 'blt':
        if (s(rs1) < s(rs2)) nextPc = (pc + imm) >>> 0;
        break;
      case 'bge':
        if (s(rs1) >= s(rs2)) nextPc = (pc + imm) >>> 0;
        break;
      case 'bltu':
        if (u(rs1) < u(rs2)) nextPc = (pc + imm) >>> 0;
        break;
      case 'bgeu':
        if (u(rs1) >= u(rs2)) nextPc = (pc + imm) >>> 0;
        break;

      // --- Loads: effective addr = rs1 + imm; lb/lh sign-extend, lbu/lhu zero-extend ---
      case 'lb':
        writeReg(rd, (memory.readByte((s(rs1) + imm) >>> 0) << 24) >> 24);
        break;
      case 'lh':
        writeReg(rd, (memory.readHalf((s(rs1) + imm) >>> 0) << 16) >> 16);
        break;
      case 'lw':
        writeReg(rd, memory.readWord((s(rs1) + imm) >>> 0));
        break;
      case 'lbu':
        writeReg(rd, memory.readByte((s(rs1) + imm) >>> 0));
        break;
      case 'lhu':
        writeReg(rd, memory.readHalf((s(rs1) + imm) >>> 0));
        break;

      // --- Stores: low byte/half/word of rs2 to rs1 + imm ---
      case 'sb':
        memory.writeByte((s(rs1) + imm) >>> 0, s(rs2) & 0xff);
        break;
      case 'sh':
        memory.writeHalf((s(rs1) + imm) >>> 0, s(rs2) & 0xffff);
        break;
      case 'sw':
        memory.writeWord((s(rs1) + imm) >>> 0, s(rs2));
        break;

      // --- I-type ALU ---
      case 'addi':
        writeReg(rd, s(rs1) + imm);
        break;
      case 'slti':
        writeReg(rd, s(rs1) < imm ? 1 : 0);
        break;
      case 'sltiu':
        writeReg(rd, u(rs1) < imm >>> 0 ? 1 : 0); // imm sign-extended, then unsigned compare
        break;
      case 'xori':
        writeReg(rd, s(rs1) ^ imm);
        break;
      case 'ori':
        writeReg(rd, s(rs1) | imm);
        break;
      case 'andi':
        writeReg(rd, s(rs1) & imm);
        break;
      case 'slli':
        writeReg(rd, s(rs1) << shamt);
        break;
      case 'srli':
        writeReg(rd, u(rs1) >>> shamt);
        break;
      case 'srai':
        writeReg(rd, s(rs1) >> shamt);
        break;

      // --- R-type ALU (shift amount = low 5 bits of rs2) ---
      case 'add':
        writeReg(rd, s(rs1) + s(rs2));
        break;
      case 'sub':
        writeReg(rd, s(rs1) - s(rs2));
        break;
      case 'sll':
        writeReg(rd, s(rs1) << (s(rs2) & 0x1f));
        break;
      case 'slt':
        writeReg(rd, s(rs1) < s(rs2) ? 1 : 0);
        break;
      case 'sltu':
        writeReg(rd, u(rs1) < u(rs2) ? 1 : 0);
        break;
      case 'xor':
        writeReg(rd, s(rs1) ^ s(rs2));
        break;
      case 'srl':
        writeReg(rd, u(rs1) >>> (s(rs2) & 0x1f));
        break;
      case 'sra':
        writeReg(rd, s(rs1) >> (s(rs2) & 0x1f));
        break;
      case 'or':
        writeReg(rd, s(rs1) | s(rs2));
        break;
      case 'and':
        writeReg(rd, s(rs1) & s(rs2));
        break;

      // --- System / ordering ---
      case 'fence':
        // No memory ordering to model (single-threaded, in-order): a no-op.
        break;
      case 'ecall':
        // M1: exit is the only syscall (RARS `a7=10` convention) and print is deferred,
        // so any ecall halts. When print/other syscalls land, dispatch on a7 (x17) here.
        haltReason = 'ecall';
        halted = true;
        break;
      case 'ebreak':
        haltReason = 'ebreak';
        halted = true;
        break;

      default:
        // `decode` never throws — unrecognized words come back as 'unknown'. Halt loudly
        // rather than silently advancing, so a corrupt/unsupported word can't look clean.
        haltReason = 'unknown-instruction';
        halted = true;
        break;
    }

    if (halted) break;
    pc = nextPc;
  }

  const state: MachineState = { pc, registers, memory, halted };
  return { state, steps, haltReason };
}
