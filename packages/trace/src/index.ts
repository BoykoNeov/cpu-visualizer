/**
 * `@cpu-viz/trace` — the contract between the engine and everything else (INV-3). It holds
 * the {@link CycleTrace} schema (§5), the {@link Processor} interface and {@link ProgramImage}
 * the engines implement/consume (§6), and {@link SparseMemory}, the concrete `MemoryView`
 * the engines and the driver/recorder share. It depends only on `isa`.
 */

export {
  RV32I_REGISTER_COUNT,
  makeRegisters,
  type MemoryView,
  type MachineState,
  type InstructionInstance,
  type TraceEvent,
  type CycleTrace,
} from './schema';
export { SparseMemory } from './memory';
export {
  defaultConfig,
  type ProgramImage,
  type CacheConfig,
  type ProcessorConfig,
  type ProcessorCapabilities,
  type Processor,
} from './processor';
