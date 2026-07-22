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
 * D-cache configuration (roadmap §12.3, M6). A **direct-mapped, single-level, write-through /
 * no-write-allocate** cache — the MVP fidelity the milestone pins. Deferred by design and NOT
 * fields here: set-associativity + a replacement policy (the only future user of {@link
 * ProcessorConfig.seed}), a second level (the trace's `cache-access.level` anticipates it), an
 * I-cache, and write-back. See `docs/plans/m6-tasks.md`.
 *
 * The cache is a **timing shadow**: it holds tags + valid bits only, never values, so it changes
 * *latency* and nothing else. Memory stays the sole source of truth, which is what makes INV-8
 * green by construction (a value-less cache cannot corrupt architectural state). All three fields
 * are geometry/latency; there is no value storage to describe.
 */
export interface CacheConfig {
  /** Bytes per line (block). The shipped corpus geometry uses 16 (= 4 words). Power of two. */
  readonly lineSize: number;
  /**
   * Number of lines. Direct-mapped, so this is also the number of sets: each address maps to
   * exactly one line (`(addr / lineSize) mod numLines`), and there is no replacement choice to
   * make — which is precisely why {@link ProcessorConfig.seed} stays unused at this tier. Power
   * of two. The flagship experiment flips this 2 ↔ 4 over a fixed 16-byte line.
   */
  readonly numLines: number;
  /**
   * Extra cycles a MISS adds to the MEM stage — a fixed count, not a modeled memory hierarchy
   * (that is the L2 tier's business; a flat penalty is a true fact about *this* machine, INV-5).
   * A hit costs the ordinary single MEM cycle; a miss costs `1 + missPenalty`.
   */
  readonly missPenalty: number;
}

/** Feature toggles handed to {@link Processor.reset} (handoff §6). */
export interface ProcessorConfig {
  /** Pipeline tier+; irrelevant to single-cycle. */
  forwarding: boolean;
  branchPrediction: 'none' | 'static-taken' | 'static-not-taken';
  cache: CacheConfig | null;
  /**
   * How many instructions may **issue per cycle** (roadmap §12.4, M7). Absent or `1` is every
   * machine built before M7 — one instruction enters a stage at a time — so the field is optional
   * rather than required: it follows {@link seed}'s precedent ("only if a model needs it") instead
   * of {@link cache}'s (a required field with a `null` default), which would have forced a value
   * into every config literal in the repo to say something none of them do.
   *
   * **Only the superscalar and out-of-order models honor it**; every earlier model ignores it and
   * its trace is byte-identical at any width — the M4-step-0 inertness contract, two milestones
   * on. Gate the UI on {@link ProcessorCapabilities.configurableIssueWidth}, never on this field's
   * presence.
   *
   * The 1-wide position of a superscalar machine is **not** the M3 pipeline wearing a different
   * name: it runs the same issue logic and simply never finds a pair. That is what makes the
   * toggle a fair same-program A/B rather than a model switch in disguise. The out-of-order model
   * (M9) defaults to width **2** when this field is absent — unlike the superscalar's own default
   * of 1 — per the pinned "build the machine once, superscalar OoO" decision.
   */
  issueWidth?: number;
  /**
   * Out-of-order ISSUE (roadmap §12.5, M9) — the flagship same-program A/B. Absent or `false` is
   * every machine built before M9, and also the M9 model's own degenerate position: dispatch and
   * issue stay in program order (the in-order-issue base, step 1a). `true` turns on the scheduler
   * — a ready instruction issues to a free FU ahead of an older one still waiting on an operand,
   * while the ROB still commits in program order.
   *
   * Optional, following {@link issueWidth}'s precedent, not {@link cache}'s: adding it must not
   * force a value into every config literal in the repo to say something none of them mean. **Only
   * the out-of-order model honors it**; every earlier model ignores it and its trace is
   * byte-identical whether it is set or not (the M4/M7 step-0 inertness contract). Gate the UI on
   * {@link ProcessorCapabilities.configurableOutOfOrder}, never on this field's presence.
   */
  outOfOrderIssue?: boolean;
  /**
   * Reorder-buffer capacity (M9 secondary lever). A small ROB fills and stalls dispatch — a
   * visible structural limit on how far the machine can look ahead for independent work. Absent
   * lets the model choose its own default; only the out-of-order model reads it. Optional for the
   * same reason as {@link outOfOrderIssue}.
   */
  robSize?: number;
  /**
   * Functional-unit latency for the designated slow operation (M9, the "Option B" knob). A config
   * field, NOT an ISA change — programs run byte-for-byte unchanged (INV-7 intact) and the latency
   * is part of the config so determinism holds (INV-1). RV32I has no multi-cycle arithmetic, so
   * without this the only latency source is a cache miss; this makes the namesake Tomasulo story
   * ("a reservation station waits N cycles on a slow op while independent work issues around it")
   * vivid on any program. Absent means every FU is single-cycle (the honest RV32I floor). WHICH
   * operation it lengthens is pinned when the scheduler is built (step 1b); only the out-of-order
   * model reads it. Optional, same precedent as {@link outOfOrderIssue}.
   */
  slowOpLatency?: number;
  /**
   * Outstanding-miss handling unit (MSHR) count for the non-blocking load/store unit (M9 step 1b).
   * How many concurrent cache misses the out-of-order model may have in flight before a further
   * miss must queue for a free slot — the structural cap on "miss-under-miss" memory-level
   * parallelism. Deliberately deferred past step 0 (its only consumer, the non-blocking LSU, did
   * not exist yet); absent defaults to 2, confirmed against the corpus (`array-sum.s`'s two
   * consecutive independent loads are the miss-under-miss pair a default of 2 unlocks). Optional,
   * same precedent as {@link outOfOrderIssue}; only the out-of-order model reads it.
   */
  numMshrs?: number;
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
  /**
   * Does it honor {@link ProcessorConfig.issueWidth} — can more than one instruction occupy a
   * stage? Deliberately REQUIRED rather than optional, so adding it is a compile error in every
   * model's capabilities constant: a model that silently defaulted to `false` would be indis-
   * tinguishable from one that had simply not been considered.
   */
  readonly configurableIssueWidth: boolean;
  /**
   * Does it honor the out-of-order config cluster — {@link ProcessorConfig.outOfOrderIssue},
   * {@link ProcessorConfig.robSize}, and {@link ProcessorConfig.slowOpLatency}? One flag gates the
   * whole cluster because those knobs are all-or-nothing: they mean something only on a model with
   * a ROB and reservation stations, and nothing on any in-order model. REQUIRED rather than
   * optional, for the reason {@link configurableIssueWidth} is: adding it is then a compile error
   * in every model's capabilities constant, so a model must state a stance rather than inherit a
   * `false` nobody chose (the omission that caught two stub fixtures at M7 step 1).
   */
  readonly configurableOutOfOrder: boolean;
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
  /**
   * The current full architectural state, as an INDEPENDENT snapshot — the same contract
   * {@link CycleTrace.state} makes. The driver/recorder captures this at reset as the pre-run
   * (cursor -1) state and trusts it not to mutate as the engine steps on, so it must not
   * alias the live register file or memory.
   */
  getState(): MachineState;
  /** Has the machine halted (architectural halt, or pc ran off the end of text)? */
  isHalted(): boolean;
  readonly capabilities: ProcessorCapabilities;
}
