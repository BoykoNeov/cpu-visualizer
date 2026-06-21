/**
 * The single-cycle datapath (handoff §11) behind the {@link Processor} interface (§6):
 * each `step()` fetches, decodes, executes, and retires exactly one instruction, so there
 * are no hazards by construction. It is the first real microarchitecture and the one that
 * exercises the whole plumbing chain (ISA → engine → trace → driver → view → curriculum).
 *
 * The arithmetic / sign handling is mirrored VERBATIM from the golden reference's `run.ts`
 * (the `s`/`u` views, `imm & 0x1f`, `>>> 0` at the memory interface): those are ISA
 * semantics, identical in every model, and re-deriving them is how the classic traps
 * (`sltiu`, `srl`-vs-`sra`, `bltu`-vs-`bgeu`) creep back. What is genuinely independent —
 * and what the step-6 differential test (INV-8) therefore validates — is the per-cycle
 * plumbing: fetch/dispatch, pc update, the memory path, and the trace events emitted here.
 *
 * Determinism (INV-1): same image ⇒ identical trace. Obliviousness (INV-2): it emits full,
 * expert-complete state and events and knows nothing of depth tiers or rendering.
 */

import { decode, defForMnemonic, type DecodedInstruction } from '@cpu-viz/isa';
import { TEXT_BASE, type AssembledProgram } from '@cpu-viz/assembler';
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

/** Single-cycle supports no pipeline machinery, so every capability flag is `false`. */
export const SINGLE_CYCLE_CAPABILITIES: ProcessorCapabilities = {
  model: 'single-cycle',
  pipelined: false,
  hasHazards: false,
  configurableForwarding: false,
  configurableBranchPrediction: false,
  configurableCache: false,
};

/**
 * Adapt an {@link AssembledProgram} into the pure {@link ProgramImage} the engine consumes.
 * Execution begins at {@link TEXT_BASE} (the §"memory map" entry). This adapter lives in the
 * engine layer because it touches both `assembler` and `trace`; `trace` itself stays pure.
 * Kept a standalone free function so the reference's differential-test path never has to
 * import this engine.
 */
export function toProgramImage(program: AssembledProgram): ProgramImage {
  return {
    words: program.words,
    data: program.data,
    entry: TEXT_BASE,
    sourceMap: program.sourceMap,
  };
}

export class SingleCycleProcessor implements Processor {
  readonly capabilities = SINGLE_CYCLE_CAPABILITIES;

  private registers = makeRegisters();
  private memory = new SparseMemory();
  private pc = 0;
  private entry = 0;
  private textEnd = 0;
  private halted = true; // nothing loaded yet
  private cycle = -1; // first step() produces cycle 0
  private seq = 0; // dynamic-instruction counter → stable ids (INV-4)
  private sourceMap: ReadonlyMap<number, number> = new Map();

  reset(image: ProgramImage, config: ProcessorConfig = defaultConfig()): void {
    void config; // single-cycle honors no config knobs — its capabilities advertise this
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
    this.textEnd = (image.entry + image.words.length * 4) >>> 0;
    this.cycle = -1;
    this.seq = 0;
    // An empty image (or one whose entry is already past text) is halted from the start.
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

    const pc = this.pc;
    const word = this.memory.readWord(pc) >>> 0;
    const d = decode(word);
    const id = `i${this.seq++}`;
    const events: TraceEvent[] = [{ type: 'instr-fetch', instr: id, pc, encoding: word }];

    this.execute(d, pc, id, events);

    // Single-cycle: one instruction enters and completes per cycle — it retires this tick.
    events.push({ type: 'instr-retire', instr: id });

    const instruction: InstructionInstance = {
      id,
      pc,
      encoding: word,
      sourceLine: this.sourceMap.get(pc) ?? null,
      decoded: d,
      location: 'single-cycle',
    };

    // The state MUST be an independent snapshot: the driver keeps every CycleTrace, so if
    // these aliased the live register array / memory, time-travel would show the latest
    // values at every cycle (handoff §6).
    return {
      cycle: this.cycle,
      state: this.snapshotState(),
      events,
      instructions: [instruction],
    };
  }

  /** Decode → execute one instruction, mutating registers/memory/pc and emitting events. */
  private execute(d: DecodedInstruction, pc: number, id: string, events: TraceEvent[]): void {
    const { rd, rs1, rs2, imm, format, mnemonic } = d;
    const shamt = imm & 0x1f; // shift amount: low 5 bits, for both reg- and imm-shifts
    let nextPc = (pc + 4) >>> 0;

    // --- decode / register-read phase: the source-register reads the datapath performs.
    //     `kind` discriminates the operand-less I-encoded ops (ecall/ebreak/fence), whose
    //     rs1/rs2 bits are not register selectors and must not surface as reg-reads. ---
    const kind = defForMnemonic(mnemonic)?.kind;
    if (kind !== 'system' && kind !== 'fence') {
      if (format === 'R' || format === 'S' || format === 'B') {
        events.push({ type: 'reg-read', reg: rs1, value: this.registers[rs1]!, instr: id });
        events.push({ type: 'reg-read', reg: rs2, value: this.registers[rs2]!, instr: id });
      } else if (format === 'I') {
        events.push({ type: 'reg-read', reg: rs1, value: this.registers[rs1]!, instr: id });
      }
      // U (lui/auipc) and J (jal) read no source registers.
    }

    // x0 is hardwired to 0: writes to it are discarded (and emit no reg-write event). GPRs
    // are signed int32; read `u()` for the unsigned-sensitive ops, `s()` otherwise.
    const s = (r: number): number => this.registers[r]!;
    const u = (r: number): number => this.registers[r]! >>> 0;
    const write = (r: number, value: number): void => {
      if (r !== 0) {
        const v = value | 0;
        this.registers[r] = v;
        events.push({ type: 'reg-write', reg: r, value: v, instr: id });
      }
    };
    const alu = (op: string, a: number, b: number, result: number): void => {
      events.push({ type: 'alu-op', op, a: a | 0, b: b | 0, result: result | 0, instr: id });
    };
    const load = (addr: number, raw: number, extended: number): void => {
      events.push({ type: 'mem-read', addr, value: raw, instr: id });
      write(rd, extended);
    };
    const store = (addr: number, value: number): void => {
      events.push({ type: 'mem-write', addr, value, instr: id });
    };

    switch (mnemonic) {
      // --- U-type: imm already holds imm[31:12] in place (no extra shift) ---
      case 'lui':
        write(rd, imm);
        break;
      case 'auipc':
        write(rd, (pc + imm) | 0);
        break;

      // --- Jumps: imm is a sign-extended, byte-scaled offset ---
      case 'jal':
        write(rd, (pc + 4) | 0);
        nextPc = (pc + imm) >>> 0;
        break;
      case 'jalr': {
        const sum = (s(rs1) + imm) | 0; // ALU computes rs1 + imm, then bit 0 is cleared
        alu('add', s(rs1), imm, sum);
        const target = (sum & ~1) >>> 0; // compute before writing rd (rd may == rs1)
        write(rd, (pc + 4) | 0);
        nextPc = target;
        break;
      }

      // --- Branches: signed vs unsigned compares; imm is the byte-scaled offset. The ALU
      //     evaluates the condition (result = taken?1:0); the branch unit selects the pc. ---
      case 'beq': {
        const taken = s(rs1) === s(rs2);
        alu('beq', s(rs1), s(rs2), taken ? 1 : 0);
        if (taken) nextPc = (pc + imm) >>> 0;
        break;
      }
      case 'bne': {
        const taken = s(rs1) !== s(rs2);
        alu('bne', s(rs1), s(rs2), taken ? 1 : 0);
        if (taken) nextPc = (pc + imm) >>> 0;
        break;
      }
      case 'blt': {
        const taken = s(rs1) < s(rs2);
        alu('blt', s(rs1), s(rs2), taken ? 1 : 0);
        if (taken) nextPc = (pc + imm) >>> 0;
        break;
      }
      case 'bge': {
        const taken = s(rs1) >= s(rs2);
        alu('bge', s(rs1), s(rs2), taken ? 1 : 0);
        if (taken) nextPc = (pc + imm) >>> 0;
        break;
      }
      case 'bltu': {
        const taken = u(rs1) < u(rs2);
        alu('bltu', u(rs1), u(rs2), taken ? 1 : 0);
        if (taken) nextPc = (pc + imm) >>> 0;
        break;
      }
      case 'bgeu': {
        const taken = u(rs1) >= u(rs2);
        alu('bgeu', u(rs1), u(rs2), taken ? 1 : 0);
        if (taken) nextPc = (pc + imm) >>> 0;
        break;
      }

      // --- Loads: effective addr = rs1 + imm; lb/lh sign-extend, lbu/lhu zero-extend.
      //     `value` on mem-read is the raw access-width datum; the register gets `extended`. ---
      case 'lb': {
        const addr = (s(rs1) + imm) >>> 0;
        alu('add', s(rs1), imm, addr);
        const raw = this.memory.readByte(addr);
        load(addr, raw, (raw << 24) >> 24);
        break;
      }
      case 'lh': {
        const addr = (s(rs1) + imm) >>> 0;
        alu('add', s(rs1), imm, addr);
        const raw = this.memory.readHalf(addr);
        load(addr, raw, (raw << 16) >> 16);
        break;
      }
      case 'lw': {
        const addr = (s(rs1) + imm) >>> 0;
        alu('add', s(rs1), imm, addr);
        const raw = this.memory.readWord(addr);
        load(addr, raw, raw);
        break;
      }
      case 'lbu': {
        const addr = (s(rs1) + imm) >>> 0;
        alu('add', s(rs1), imm, addr);
        const raw = this.memory.readByte(addr);
        load(addr, raw, raw);
        break;
      }
      case 'lhu': {
        const addr = (s(rs1) + imm) >>> 0;
        alu('add', s(rs1), imm, addr);
        const raw = this.memory.readHalf(addr);
        load(addr, raw, raw);
        break;
      }

      // --- Stores: low byte/half/word of rs2 to rs1 + imm ---
      case 'sb': {
        const addr = (s(rs1) + imm) >>> 0;
        alu('add', s(rs1), imm, addr);
        const value = s(rs2) & 0xff;
        this.memory.writeByte(addr, value);
        store(addr, value);
        break;
      }
      case 'sh': {
        const addr = (s(rs1) + imm) >>> 0;
        alu('add', s(rs1), imm, addr);
        const value = s(rs2) & 0xffff;
        this.memory.writeHalf(addr, value);
        store(addr, value);
        break;
      }
      case 'sw': {
        const addr = (s(rs1) + imm) >>> 0;
        alu('add', s(rs1), imm, addr);
        const value = s(rs2);
        this.memory.writeWord(addr, value);
        store(addr, value);
        break;
      }

      // --- I-type ALU ---
      case 'addi':
        alu('add', s(rs1), imm, (s(rs1) + imm) | 0);
        write(rd, s(rs1) + imm);
        break;
      case 'slti':
        alu('slt', s(rs1), imm, s(rs1) < imm ? 1 : 0);
        write(rd, s(rs1) < imm ? 1 : 0);
        break;
      case 'sltiu':
        alu('sltu', u(rs1), imm >>> 0, u(rs1) < imm >>> 0 ? 1 : 0); // imm sign-extended, unsigned compare
        write(rd, u(rs1) < imm >>> 0 ? 1 : 0);
        break;
      case 'xori':
        alu('xor', s(rs1), imm, s(rs1) ^ imm);
        write(rd, s(rs1) ^ imm);
        break;
      case 'ori':
        alu('or', s(rs1), imm, s(rs1) | imm);
        write(rd, s(rs1) | imm);
        break;
      case 'andi':
        alu('and', s(rs1), imm, s(rs1) & imm);
        write(rd, s(rs1) & imm);
        break;
      case 'slli':
        alu('sll', s(rs1), shamt, s(rs1) << shamt);
        write(rd, s(rs1) << shamt);
        break;
      case 'srli':
        alu('srl', u(rs1), shamt, u(rs1) >>> shamt);
        write(rd, u(rs1) >>> shamt);
        break;
      case 'srai':
        alu('sra', s(rs1), shamt, s(rs1) >> shamt);
        write(rd, s(rs1) >> shamt);
        break;

      // --- R-type ALU (shift amount = low 5 bits of rs2) ---
      case 'add':
        alu('add', s(rs1), s(rs2), (s(rs1) + s(rs2)) | 0);
        write(rd, s(rs1) + s(rs2));
        break;
      case 'sub':
        alu('sub', s(rs1), s(rs2), (s(rs1) - s(rs2)) | 0);
        write(rd, s(rs1) - s(rs2));
        break;
      case 'sll':
        alu('sll', s(rs1), s(rs2) & 0x1f, s(rs1) << (s(rs2) & 0x1f));
        write(rd, s(rs1) << (s(rs2) & 0x1f));
        break;
      case 'slt':
        alu('slt', s(rs1), s(rs2), s(rs1) < s(rs2) ? 1 : 0);
        write(rd, s(rs1) < s(rs2) ? 1 : 0);
        break;
      case 'sltu':
        alu('sltu', u(rs1), u(rs2), u(rs1) < u(rs2) ? 1 : 0);
        write(rd, u(rs1) < u(rs2) ? 1 : 0);
        break;
      case 'xor':
        alu('xor', s(rs1), s(rs2), s(rs1) ^ s(rs2));
        write(rd, s(rs1) ^ s(rs2));
        break;
      case 'srl':
        alu('srl', u(rs1), s(rs2) & 0x1f, u(rs1) >>> (s(rs2) & 0x1f));
        write(rd, u(rs1) >>> (s(rs2) & 0x1f));
        break;
      case 'sra':
        alu('sra', s(rs1), s(rs2) & 0x1f, s(rs1) >> (s(rs2) & 0x1f));
        write(rd, s(rs1) >> (s(rs2) & 0x1f));
        break;
      case 'or':
        alu('or', s(rs1), s(rs2), s(rs1) | s(rs2));
        write(rd, s(rs1) | s(rs2));
        break;
      case 'and':
        alu('and', s(rs1), s(rs2), s(rs1) & s(rs2));
        write(rd, s(rs1) & s(rs2));
        break;

      // --- System / ordering ---
      case 'fence':
        // No memory ordering to model (single-threaded, in-order): a no-op.
        break;
      case 'ecall':
        // M1: exit is the only syscall (RARS `a7=10`) and print is deferred, so any ecall
        // halts. When other syscalls land, dispatch on a7 (x17) here.
        this.halted = true;
        break;
      case 'ebreak':
        this.halted = true;
        break;

      default:
        // `decode` never throws — unrecognized words come back as 'unknown'. Halt loudly
        // rather than silently advancing, so a corrupt/unsupported word can't look clean.
        this.halted = true;
        break;
    }

    if (this.halted) {
      // Architectural halt or trap: pc does NOT advance, so final pc = the halting
      // instruction's pc — matching the golden reference's final state (INV-8).
      return;
    }
    this.pc = nextPc;
    if (!this.inText(this.pc)) {
      // Ran off the end of text: halt with pc = the out-of-range value (matches reference).
      this.halted = true;
    }
  }

  /** Is `p` a fetchable text address (the loaded program range)? */
  private inText(p: number): boolean {
    return p >= this.entry && p < this.textEnd;
  }

  /** An independent full-state snapshot — what each CycleTrace carries (handoff §6). */
  private snapshotState(): MachineState {
    return {
      pc: this.pc,
      registers: this.registers.slice(),
      memory: this.memory.snapshot(),
      halted: this.halted,
    };
  }
}
