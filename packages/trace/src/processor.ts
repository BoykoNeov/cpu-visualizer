/**
 * The engine interface (handoff §6). Every microarchitecture implements {@link Processor}
 * so the UI and the step-6 driver/recorder are model-agnostic. These types live in `trace`
 * — alongside the {@link CycleTrace} schema they produce — so the driver can wrap any
 * `Processor` without `trace` depending on an engine (which would invert the DAG).
 *
 * This closes the deferred "where do Processor + driver live?" decision in favor of
 * leaning (c) (`docs/plans/m1-tasks.md`): the engine consumes a pure {@link ProgramImage}
 * — NOT `AssembledProgram` — so `trace` stays pure (it depends only on `isa`). A tiny
 * `toProgramImage(AssembledProgram)` adapter lives in the engine layer, which may depend
 * on the assembler.
 */

import type { CycleTrace, MachineState } from './schema';

/**
 * A pure, engine-ready program: machine words + initialized data + entry pc, plus the
 * address→source-line map so the engine can fill `InstructionInstance.sourceLine` itself
 * (the map is pure input data, not a back-door into the engine — INV-3 holds). This is the
 * `AssembledProgram` minus the assembler-only symbol table, with an explicit entry point;
 * keeping it free of any `assembler` type is what lets it live here in pure `trace`.
 */
export interface ProgramImage {
  /** Machine code, one 32-bit word per instruction, loaded little-endian from {@link entry}. */
  words: Uint32Array;
  /** Initialized data segments, placed verbatim at their absolute addresses. */
  data: { addr: number; bytes: Uint8Array }[];
  /** Where execution begins (the §"memory map" `TEXT_BASE`). */
  entry: number;
  /** Instruction address → source line, for `InstructionInstance.sourceLine`. */
  sourceMap: ReadonlyMap<number, number>;
}

/**
 * Cache configuration — a placeholder until the caches & branch-prediction tier (roadmap
 * §12.3). Shaped now only so {@link ProcessorConfig} matches handoff §6; fields land when
 * a model actually models a cache.
 */
export interface CacheConfig {
  /** No fields yet — modeled at the cache tier (roadmap §12.3). */
  readonly placeholder?: never;
}

/** Feature toggles handed to {@link Processor.reset} (handoff §6). */
export interface ProcessorConfig {
  /** Pipeline tier+; irrelevant to single-cycle. */
  forwarding: boolean;
  branchPrediction: 'none' | 'static-taken' | 'static-not-taken';
  cache: CacheConfig | null;
  /** Only if a model needs deterministic randomness (INV-1: the seed is part of config). */
  seed?: number;
}

/** A neutral config: no forwarding, no prediction, no cache. Single-cycle ignores all of it. */
export function defaultConfig(): ProcessorConfig {
  return { forwarding: false, branchPrediction: 'none', cache: null };
}

/**
 * Which views/features a model supports (handoff §6) — lets the UI light up only the
 * relevant panels. Single-cycle has none of the pipeline machinery, so every flag is
 * `false`. (Designed minimal: no view consumes this yet, so expect refinement — §5.)
 */
export interface ProcessorCapabilities {
  /** Stable model-family id (handoff §2). */
  readonly model: string;
  /** Does the model expose pipeline stages / latches (so stage-by-stage views apply)? */
  readonly pipelined: boolean;
  /** Can stalls / forwards / flushes occur (are those events meaningful)? */
  readonly hasHazards: boolean;
  /** Does it honor {@link ProcessorConfig.forwarding}? */
  readonly configurableForwarding: boolean;
  /** Does it honor {@link ProcessorConfig.branchPrediction}? */
  readonly configurableBranchPrediction: boolean;
  /** Does it honor {@link ProcessorConfig.cache}? */
  readonly configurableCache: boolean;
}

/**
 * One microarchitecture. Implementations are pure and deterministic (INV-1): same image +
 * config ⇒ identical trace. Stepping BACKWARD is deliberately NOT here — the driver gets
 * time-travel for free by recording each `step()`'s full-state snapshot (handoff §6).
 */
export interface Processor {
  /** Load `image`, apply `config`, and return to the entry pc (cycle counter reset). */
  reset(image: ProgramImage, config: ProcessorConfig): void;
  /** Advance exactly one cycle and return what happened. Throws if already halted. */
  step(): CycleTrace;
  /** The current full architectural state. */
  getState(): MachineState;
  /** Has the machine halted (architectural halt, or pc ran off the end of text)? */
  isHalted(): boolean;
  readonly capabilities: ProcessorCapabilities;
}
