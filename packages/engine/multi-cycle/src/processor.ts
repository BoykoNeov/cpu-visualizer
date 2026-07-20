/**
 * The multi-cycle datapath (roadmap §12.1) behind the {@link Processor} interface (§6): the
 * SECOND microarchitecture. Where single-cycle does fetch→…→writeback in one `step()`, this
 * model spreads those phases across several `step()` calls — one phase per cycle — so a single
 * instruction has a lifetime that spans cycles, advancing IF→ID→EX→MEM→WB with a stable id
 * (INV-4) and per-cycle `micro` latches. Still exactly ONE instruction in flight at a time, so
 * there are no hazards by construction (exactly as single-cycle had none) — the concurrency of
 * hazards is the pipeline tier's job (§12.2). See `docs/plans/m2-tasks.md`.
 *
 * The ISA semantics — the arithmetic, the `s`/`u` signed/unsigned views, `imm & 0x1f`, the
 * `>>> 0` at the memory boundary — are mirrored VERBATIM from the golden reference / single-cycle
 * (they are identical in every model; re-deriving them is how the classic traps creep back). We
 * do NOT import the reference at runtime — we copy the idioms, and the INV-8 differential test
 * (step 3) proves the copy is faithful. What is genuinely new here, and what the hand-written
 * unit tests pin, is the **per-cycle sequencing**: the phase plan per instruction class, the
 * event→phase mapping, the `micro` latch contents, and the commit timing.
 *
 * Commit timing (so per-cycle snapshots read correctly): the whole effect-plan is computed
 * eagerly at fetch (safe — only one instruction is in flight, so nothing mutates its sources
 * before its own write-back), but effects are COMMITTED at their natural phase: memory writes at
 * MEM, the register write at WB, and `pc`/halt at retire (the last phase). `pc` stays at the
 * executing instruction's own address during its intermediate cycles and moves to `nextPc` only
 * as it retires — matching single-cycle, whose one cycle already shows `pc = nextPc`.
 *
 * Determinism (INV-1) and obliviousness (INV-2) hold exactly as in single-cycle.
 */

import { decode, defForMnemonic, type DecodedInstruction } from '@cpu-viz/isa';
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

/** The datapath phases an instruction walks through, one per cycle. */
export type Phase = 'IF' | 'ID' | 'EX' | 'MEM' | 'WB';

/**
 * Multi-cycle's `MachineState.micro` (the §5 per-model extension point): the classic P&H
 * inter-cycle latches, revealed progressively as the instruction advances. Every field is an
 * independent per-cycle snapshot (same requirement as registers/memory — the recorder keeps
 * every cycle, so a live-aliased latch would show latest-values-everywhere). `null` means "not
 * latched yet this instruction" (e.g. `aluOut` before EX, or forever for an instruction with no
 * EX phase such as `lui`).
 */
export interface MultiCycleMicro {
  /** The phase that just executed this cycle (mirrors the in-flight instruction's `location`). */
  phase: Phase;
  /** Instruction register: the fetched word, held from IF so ID/EX needn't re-fetch. */
  ir: number | null;
  /** Operand A — `Reg[rs1]`, latched at ID (null if the instruction reads no rs1). */
  a: number | null;
  /** Operand B — `Reg[rs2]`, latched at ID (null unless the instruction reads rs2). */
  b: number | null;
  /** ALU result / effective address / branch-condition, latched at EX (null with no EX phase). */
  aluOut: number | null;
  /** Memory data register: the raw load result, latched at MEM (null unless a load). */
  mdr: number | null;
}

/**
 * Multi-cycle exposes datapath phases and latches (via `location` + `micro`) but is NOT a
 * pipeline — one instruction in flight, so no overlap and no hazards. `pipelined`/`hasHazards`
 * describe the hazard-bearing overlap the pipeline tier introduces, so both are `false` here.
 * (No view consumes these yet — expect refinement, §5.)
 */
export const MULTI_CYCLE_CAPABILITIES: ProcessorCapabilities = {
  model: 'multi-cycle',
  pipelined: false,
  hasHazards: false,
  configurableForwarding: false,
  configurableBranchPrediction: false,
  configurableCache: false,
};

/** Per-class phase plan — the source of the model's "varying cycle counts" (§12.1). */
const LOADS = new Set(['lb', 'lh', 'lw', 'lbu', 'lhu']);
const STORES = new Set(['sb', 'sh', 'sw']);
const BRANCHES = new Set(['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu']);
// R-type and I-type ALU ops: identical phase shape (compute in EX, write back in WB, no memory).
const REG_ALU = new Set([
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

/**
 * The phase sequence for an instruction class — a STATIC function of the opcode, never of
 * runtime values (so `addi x0,…` and a not-taken branch keep their class's cycle count). The
 * rule: IF+ID are universal (fetch + decode/register-read); then EX iff the main ALU is used,
 * MEM iff data memory is touched, WB iff a register is written.
 *
 * Step 5c changed not the rule but WHICH instructions use the main ALU: PC arithmetic now
 * routes through it, so `jal` (target `pc+imm`) and `auipc` (`pc+imm`) gained an EX and take 4
 * cycles instead of 3. `lui` keeps 3 and is alone in the IF/ID/WB class — a pure immediate
 * pass-through with no PC arithmetic to route. `pc+4` deliberately does NOT go through the ALU
 * for any instruction (a dedicated incrementer supplies the sequential PC and the jump link),
 * which is what keeps 5c from adding an `alu-op` to every instruction's IF.
 */
function phasesFor(mnemonic: string, kind: string | undefined): Phase[] {
  if (LOADS.has(mnemonic)) return ['IF', 'ID', 'EX', 'MEM', 'WB'];
  if (STORES.has(mnemonic)) return ['IF', 'ID', 'EX', 'MEM'];
  if (BRANCHES.has(mnemonic)) return ['IF', 'ID', 'EX'];
  if (mnemonic === 'jalr' || mnemonic === 'jal' || mnemonic === 'auipc') {
    return ['IF', 'ID', 'EX', 'WB'];
  }
  if (mnemonic === 'lui') return ['IF', 'ID', 'WB'];
  if (REG_ALU.has(mnemonic)) return ['IF', 'ID', 'EX', 'WB'];
  // system (ecall/ebreak), fence, and unrecognized words: decode, then halt/no-op. No compute.
  void kind;
  return ['IF', 'ID'];
}

/** An event and the phase it fires in. */
interface PhasedEvent {
  phase: Phase;
  event: TraceEvent;
}

/** The fully-computed plan for one dynamic instruction; effects are committed per phase. */
interface Plan {
  phases: Phase[];
  /** Events tagged with the phase they belong to (fetch@IF … retire is added at step time). */
  events: PhasedEvent[];
  /** Deferred store — the actual memory mutation happens at MEM (so pre-MEM snapshots read old). */
  memWrite: { addr: number; value: number; width: 1 | 2 | 4 } | null;
  /** Deferred register write — committed at WB (so pre-WB snapshots read the old register). */
  regWrite: { reg: number; value: number } | null;
  /** Where pc goes when this instruction retires (unless {@link halt}). */
  nextPc: number;
  /** Architectural halt / trap (ecall/ebreak/unknown): pc does not advance. */
  halt: boolean;
  // Latch values revealed at their phase into `micro`:
  aLatch: number | null;
  bLatch: number | null;
  aluOutLatch: number | null;
  mdrLatch: number | null;
}

/** One instruction as it walks the phases; carries the plan and the progressively-filled latches. */
interface InFlight {
  id: string;
  pc: number;
  word: number;
  decoded: DecodedInstruction;
  plan: Plan;
  phaseIndex: number;
  ir: number | null;
  a: number | null;
  b: number | null;
  aluOut: number | null;
  mdr: number | null;
}

export class MultiCycleProcessor implements Processor {
  readonly capabilities = MULTI_CYCLE_CAPABILITIES;

  private registers = makeRegisters();
  private memory = new SparseMemory();
  private pc = 0;
  private entry = 0;
  private textEnd = 0;
  private halted = true; // nothing loaded yet
  private cycle = -1; // first step() produces cycle 0
  private seq = 0; // dynamic-instruction counter → stable ids (INV-4)
  private sourceMap: ReadonlyMap<number, number> = new Map();
  /** The instruction currently walking the phases, or null between retirement and next fetch. */
  private cur: InFlight | null = null;
  /** The most recent cycle's `micro` (null before the first step) — what `getState()` reports. */
  private lastMicro: MultiCycleMicro | null = null;

  reset(image: ProgramImage, config: ProcessorConfig = defaultConfig()): void {
    void config; // multi-cycle honors no config knobs — its capabilities advertise this
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
    this.cur = null;
    this.lastMicro = null;
    // An empty image (or one whose entry is already past text) is halted from the start.
    this.halted = !this.inText(this.pc);
  }

  isHalted(): boolean {
    return this.halted;
  }

  getState(): MachineState {
    return this.snapshotState(this.lastMicro);
  }

  step(): CycleTrace {
    if (this.halted) {
      throw new Error('step() called on a halted processor — check isHalted() first');
    }
    this.cycle += 1;

    // Start of a new instruction: fetch + decode + plan. This is the IF cycle's instruction;
    // the instr-fetch event itself fires below when we execute the IF phase.
    if (this.cur === null) {
      const pc = this.pc;
      const word = this.memory.readWord(pc) >>> 0;
      const d = decode(word);
      const id = `i${this.seq++}`;
      this.cur = {
        id,
        pc,
        word,
        decoded: d,
        plan: this.planInstruction(pc, word, d, id),
        phaseIndex: 0,
        ir: null,
        a: null,
        b: null,
        aluOut: null,
        mdr: null,
      };
    }

    const cur = this.cur;
    const phase = cur.plan.phases[cur.phaseIndex]!;
    const events: TraceEvent[] = [];
    for (const pe of cur.plan.events) {
      if (pe.phase === phase) events.push(pe.event);
    }

    // Reveal this phase's latch and commit this phase's architectural effect.
    switch (phase) {
      case 'IF':
        cur.ir = cur.word;
        break;
      case 'ID':
        cur.a = cur.plan.aLatch;
        cur.b = cur.plan.bLatch;
        break;
      case 'EX':
        cur.aluOut = cur.plan.aluOutLatch;
        break;
      case 'MEM':
        cur.mdr = cur.plan.mdrLatch;
        if (cur.plan.memWrite) {
          const { addr, value, width } = cur.plan.memWrite;
          if (width === 1) this.memory.writeByte(addr, value);
          else if (width === 2) this.memory.writeHalf(addr, value);
          else this.memory.writeWord(addr, value);
        }
        break;
      case 'WB':
        if (cur.plan.regWrite) this.registers[cur.plan.regWrite.reg] = cur.plan.regWrite.value;
        break;
    }

    const isLast = cur.phaseIndex === cur.plan.phases.length - 1;
    if (isLast) {
      events.push({ type: 'instr-retire', instr: cur.id });
      if (cur.plan.halt) {
        // Architectural halt/trap: pc does NOT advance (final pc = the halting instruction's pc).
        this.halted = true;
      } else {
        this.pc = cur.plan.nextPc;
        // Ran off the end of text: halt with pc = the out-of-range value (matches the reference).
        if (!this.inText(this.pc)) this.halted = true;
      }
    }

    const micro: MultiCycleMicro = {
      phase,
      ir: cur.ir,
      a: cur.a,
      b: cur.b,
      aluOut: cur.aluOut,
      mdr: cur.mdr,
    };
    this.lastMicro = micro;

    const instruction: InstructionInstance = {
      id: cur.id,
      pc: cur.pc,
      encoding: cur.word,
      sourceLine: this.sourceMap.get(cur.pc) ?? null,
      decoded: cur.decoded,
      location: phase,
    };

    const trace: CycleTrace = {
      cycle: this.cycle,
      state: this.snapshotState(micro),
      events,
      instructions: [instruction],
    };

    cur.phaseIndex += 1;
    if (isLast) this.cur = null; // next step() fetches the following instruction

    return trace;
  }

  /**
   * Decode → compute the full per-phase plan for one instruction, mirroring single-cycle's
   * arithmetic/event idioms VERBATIM (the ISA semantics are model-invariant). Reads source
   * registers now: safe because only one instruction is in flight, so nothing mutates them
   * before this instruction's own write-back. Nothing here mutates architectural state — the
   * step() phase handlers do that at the right cycle.
   */
  private planInstruction(pc: number, word: number, d: DecodedInstruction, id: string): Plan {
    const { rd, rs1, rs2, imm, format, mnemonic } = d;
    const shamt = imm & 0x1f; // shift amount: low 5 bits, for both reg- and imm-shifts
    let nextPc = (pc + 4) >>> 0;
    let halt = false;

    const events: PhasedEvent[] = [];
    let aLatch: number | null = null;
    let bLatch: number | null = null;
    let aluOutLatch: number | null = null;
    let mdrLatch: number | null = null;
    let memWrite: { addr: number; value: number; width: 1 | 2 | 4 } | null = null;
    let regWrite: { reg: number; value: number } | null = null;

    // IF: the fetch event (the only event that always fires, for every class).
    events.push({ phase: 'IF', event: { type: 'instr-fetch', instr: id, pc, encoding: word } });

    // x0 is hardwired to 0; GPRs are signed int32. `u()` for the unsigned-sensitive ops.
    const s = (r: number): number => this.registers[r]!;
    const u = (r: number): number => this.registers[r]! >>> 0;
    const alu = (op: string, a: number, b: number, result: number): void => {
      events.push({
        phase: 'EX',
        event: { type: 'alu-op', op, a: a | 0, b: b | 0, result: result | 0, instr: id },
      });
      aluOutLatch = result | 0;
    };
    const write = (r: number, value: number): void => {
      if (r !== 0) {
        const v = value | 0;
        regWrite = { reg: r, value: v };
        events.push({ phase: 'WB', event: { type: 'reg-write', reg: r, value: v, instr: id } });
      }
    };
    const load = (addr: number, raw: number, extended: number): void => {
      events.push({ phase: 'MEM', event: { type: 'mem-read', addr, value: raw, instr: id } });
      mdrLatch = raw;
      write(rd, extended);
    };
    const store = (addr: number, value: number, width: 1 | 2 | 4): void => {
      events.push({ phase: 'MEM', event: { type: 'mem-write', addr, value, instr: id } });
      memWrite = { addr, value, width };
    };

    // --- ID / register-read: exactly the source reads single-cycle performs. `kind`
    //     discriminates the operand-less I-encoded ops (ecall/ebreak/fence). The read values
    //     also become the A/B latches (Reg[rs1], Reg[rs2]). ---
    const kind = defForMnemonic(mnemonic)?.kind;
    if (kind !== 'system' && kind !== 'fence') {
      const regRead = (reg: number): void => {
        events.push({
          phase: 'ID',
          event: { type: 'reg-read', reg, value: this.registers[reg]!, instr: id },
        });
      };
      if (format === 'R' || format === 'S' || format === 'B') {
        regRead(rs1);
        regRead(rs2);
        aLatch = s(rs1);
        bLatch = s(rs2);
      } else if (format === 'I') {
        regRead(rs1);
        aLatch = s(rs1);
      }
      // U (lui/auipc) and J (jal) read no source registers.
    }

    switch (mnemonic) {
      // --- U-type: imm already holds imm[31:12] in place (no extra shift) ---
      case 'lui':
        write(rd, imm);
        break;
      // 5c: the main ALU computes `pc + imm`, so ALUOut is the drawn source of rd.
      case 'auipc': {
        const sum = (pc + imm) | 0;
        alu('add', pc, imm, sum);
        write(rd, sum);
        break;
      }

      // --- Jumps: imm is a sign-extended, byte-scaled offset ---
      // 5c: the main ALU computes the TARGET `pc + imm` (ALUOut → PC); the link `pc + 4` comes
      // from the dedicated PC+4 incrementer, never the ALU.
      case 'jal': {
        const target = (pc + imm) >>> 0;
        alu('add', pc, imm, target | 0);
        write(rd, (pc + 4) | 0);
        nextPc = target;
        break;
      }
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
        store(addr, s(rs2) & 0xff, 1);
        break;
      }
      case 'sh': {
        const addr = (s(rs1) + imm) >>> 0;
        alu('add', s(rs1), imm, addr);
        store(addr, s(rs2) & 0xffff, 2);
        break;
      }
      case 'sw': {
        const addr = (s(rs1) + imm) >>> 0;
        alu('add', s(rs1), imm, addr);
        store(addr, s(rs2), 4);
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
        // M1: exit is the only syscall (RARS `a7=10`) and print is deferred, so any ecall halts.
        halt = true;
        break;
      case 'ebreak':
        halt = true;
        break;

      default:
        // `decode` never throws — unrecognized words come back as 'unknown'. Halt loudly.
        halt = true;
        break;
    }

    const phases = phasesFor(mnemonic, kind);

    // Defensive invariant: every emitted event must belong to a phase this class actually visits,
    // or step() would silently drop it. Catches a phase/event miscategorization at author time.
    const visited = new Set(phases);
    for (const pe of events) {
      if (!visited.has(pe.phase)) {
        throw new Error(
          `multi-cycle: ${mnemonic} emits a ${pe.event.type} in ${pe.phase}, not in its phases [${phases.join()}]`,
        );
      }
    }

    return {
      phases,
      events,
      memWrite,
      regWrite,
      nextPc,
      halt,
      aLatch,
      bLatch,
      aluOutLatch,
      mdrLatch,
    };
  }

  /** Is `p` a fetchable text address (the loaded program range)? */
  private inText(p: number): boolean {
    return p >= this.entry && p < this.textEnd;
  }

  /** An independent full-state snapshot — what each CycleTrace carries (handoff §6). */
  private snapshotState(micro: MultiCycleMicro | null): MachineState {
    return {
      pc: this.pc,
      registers: this.registers.slice(),
      memory: this.memory.snapshot(),
      halted: this.halted,
      micro,
    };
  }
}
