/**
 * The web shell's model family (handoff §2) — the one place that knows which microarchitectures
 * exist and how to instantiate them. The picker in {@link App} lists these; {@link useSimulator}
 * swaps the {@link Processor} the recorder wraps when the choice changes. Everything downstream
 * reads only the trace (INV-3), so adding a model here is all it takes to make it drivable in the
 * browser — the transport, register/memory/source panels, scrub, lessons and the sandbox fork all
 * work against any model unchanged.
 */

import {
  MultiCycleProcessor,
  MULTI_CYCLE_CAPABILITIES,
  MULTI_CYCLE_MODEL_ID,
} from '@cpu-viz/engine-multi-cycle';
import {
  PipelineProcessor,
  PIPELINE_CAPABILITIES,
  PIPELINE_MODEL_ID,
} from '@cpu-viz/engine-pipeline';
import {
  SingleCycleProcessor,
  SINGLE_CYCLE_CAPABILITIES,
  SINGLE_CYCLE_MODEL_ID,
} from '@cpu-viz/engine-single-cycle';
import type { Processor, ProcessorCapabilities } from '@cpu-viz/trace';

/**
 * Which bespoke SVG datapath view (if any) renders a model's trace. Each model has its OWN
 * hand-authored geometry — lighting single-cycle's one-tick datapath with a multi-cycle trace
 * (whose phases spread across cycles) would draw a CONTRADICTORY picture, an INV-5 violation — so
 * the web shell dispatches on this discriminator rather than a plain has/has-not flag. `'none'`
 * falls back to a placeholder for models whose datapath isn't built yet.
 */
export type DatapathKind = 'single-cycle' | 'multi-cycle' | 'pipeline' | 'none';

/** A selectable microarchitecture: its id, a display label, and how to make a fresh engine. */
export interface ModelChoice {
  /** Stable model id (matches the engine's `MODEL_ID` and its `capabilities.model`). */
  id: string;
  /** Short picker label. */
  label: string;
  /** One-line description shown under the header. */
  description: string;
  /** Construct a fresh, unreset engine for the recorder to drive. */
  make: () => Processor;
  /** Which bespoke SVG datapath view renders this model's trace (or `'none'`). */
  datapath: DatapathKind;
  /**
   * What the model honors (handoff §6) — the engine's OWN exported constant, which is the very
   * object its instances return from `.capabilities` (pinned by a test in `models.test.ts`, since
   * a copy-pasted row could otherwise pair one model's flags with another's engine). Held here so
   * the shell can gate config controls WITHOUT instantiating an engine: the forwarding toggle
   * renders only where `configurableForwarding` is true, so it is simply absent for single-cycle
   * and multi-cycle rather than present-and-lying.
   */
  capabilities: ProcessorCapabilities;
}

export const MODELS: readonly ModelChoice[] = [
  {
    id: SINGLE_CYCLE_MODEL_ID,
    label: 'Single-cycle',
    description: 'single-cycle RV32I — one instruction enters and completes per cycle',
    make: () => new SingleCycleProcessor(),
    datapath: 'single-cycle',
    capabilities: SINGLE_CYCLE_CAPABILITIES,
  },
  {
    id: MULTI_CYCLE_MODEL_ID,
    label: 'Multi-cycle',
    description: 'multi-cycle RV32I — one instruction in flight, its phases spread across cycles',
    make: () => new MultiCycleProcessor(),
    datapath: 'multi-cycle',
    capabilities: MULTI_CYCLE_CAPABILITIES,
  },
  {
    id: PIPELINE_MODEL_ID,
    label: 'Pipeline',
    description:
      '5-stage pipeline — five instructions in flight at once, with forwarding, stalls, and flushes',
    make: () => new PipelineProcessor(),
    // Its OWN hand-authored geometry (M3 step 6). Deliberately NOT reusing multi-cycle's diagram:
    // that one draws a single shared memory and one instruction in flight, so a pipeline trace
    // would light it into a contradictory picture (INV-5).
    datapath: 'pipeline',
    capabilities: PIPELINE_CAPABILITIES,
  },
];

/** The model selected on first load. Single-cycle is the simplest first teaching model. */
export const DEFAULT_MODEL_ID = SINGLE_CYCLE_MODEL_ID;

/** Resolve a model id to its choice, falling back to the default for an unknown id. */
export function modelById(id: string): ModelChoice {
  return MODELS.find((m) => m.id === id) ?? MODELS[0]!;
}
