/**
 * The web shell's model family (handoff §2) — the one place that knows which microarchitectures
 * exist and how to instantiate them. The picker in {@link App} lists these; {@link useSimulator}
 * swaps the {@link Processor} the recorder wraps when the choice changes. Everything downstream
 * reads only the trace (INV-3), so adding a model here is all it takes to make it drivable in the
 * browser — the transport, register/memory/source panels, scrub, lessons and the sandbox fork all
 * work against any model unchanged.
 */

import { MultiCycleProcessor, MULTI_CYCLE_MODEL_ID } from '@cpu-viz/engine-multi-cycle';
import { SingleCycleProcessor, SINGLE_CYCLE_MODEL_ID } from '@cpu-viz/engine-single-cycle';
import type { Processor } from '@cpu-viz/trace';

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
  /**
   * Whether a bespoke SVG datapath view exists for this model. Only single-cycle has one today
   * (M1 step 8); the multi-cycle datapath is a deferred follow-up (M2 step 5b). Lighting the
   * single-cycle geometry with a multi-cycle trace would draw a CONTRADICTORY picture — a
   * one-cycle datapath under a run whose phases are spread across cycles — which is an INV-5
   * violation, not merely empty space. So the view is gated hard off until 5b lands.
   */
  hasDatapath: boolean;
}

export const MODELS: readonly ModelChoice[] = [
  {
    id: SINGLE_CYCLE_MODEL_ID,
    label: 'Single-cycle',
    description: 'single-cycle RV32I — one instruction enters and completes per cycle',
    make: () => new SingleCycleProcessor(),
    hasDatapath: true,
  },
  {
    id: MULTI_CYCLE_MODEL_ID,
    label: 'Multi-cycle',
    description: 'multi-cycle RV32I — one instruction in flight, its phases spread across cycles',
    make: () => new MultiCycleProcessor(),
    hasDatapath: false,
  },
];

/** The model selected on first load. Single-cycle is the simplest first teaching model. */
export const DEFAULT_MODEL_ID = SINGLE_CYCLE_MODEL_ID;

/** Resolve a model id to its choice, falling back to the default for an unknown id. */
export function modelById(id: string): ModelChoice {
  return MODELS.find((m) => m.id === id) ?? MODELS[0]!;
}
