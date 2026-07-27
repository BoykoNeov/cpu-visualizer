/**
 * The web shell's model family (handoff §2) — the one place that knows which microarchitectures
 * exist and how to instantiate them. The picker in {@link App} lists these; {@link useSimulator}
 * swaps the {@link Processor} the recorder wraps when the choice changes. Everything downstream
 * reads only the trace (INV-3), so adding a model here is all it takes to make it drivable in the
 * browser — the transport, register/memory/source panels, scrub, lessons and the sandbox fork all
 * work against any model unchanged.
 */

import {
  DeepPipelineProcessor,
  DEEP_PIPELINE_CAPABILITIES,
  DEEP_PIPELINE_MODEL_DESCRIPTION,
  DEEP_PIPELINE_MODEL_ID,
} from '@cpu-viz/engine-deep-pipeline';
import {
  MultiCycleProcessor,
  MULTI_CYCLE_CAPABILITIES,
  MULTI_CYCLE_MODEL_ID,
} from '@cpu-viz/engine-multi-cycle';
import {
  OutOfOrderProcessor,
  OUT_OF_ORDER_CAPABILITIES,
  OUT_OF_ORDER_MODEL_DESCRIPTION,
  OUT_OF_ORDER_MODEL_ID,
} from '@cpu-viz/engine-out-of-order';
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
import {
  SuperscalarProcessor,
  SUPERSCALAR_CAPABILITIES,
  SUPERSCALAR_MODEL_DESCRIPTION,
  SUPERSCALAR_MODEL_ID,
} from '@cpu-viz/engine-superscalar';
import type { Processor, ProcessorCapabilities, ProcessorConfig } from '@cpu-viz/trace';

/**
 * Which bespoke SVG datapath view (if any) renders a model's trace. Each model has its OWN
 * hand-authored geometry — lighting single-cycle's one-tick datapath with a multi-cycle trace
 * (whose phases spread across cycles) would draw a CONTRADICTORY picture, an INV-5 violation — so
 * the web shell dispatches on this discriminator rather than a plain has/has-not flag. `'none'`
 * falls back to a placeholder for models whose datapath isn't built yet.
 */
export type DatapathKind =
  | 'single-cycle'
  | 'multi-cycle'
  | 'pipeline'
  | 'superscalar'
  | 'out-of-order'
  | 'none';

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
  {
    id: DEEP_PIPELINE_MODEL_ID,
    label: 'Deep pipeline',
    // The engine's OWN one-liner, like the two rows below — see its docblock for why it spells the
    // stage set out: this label and "Pipeline" sit adjacent in the picker.
    description: DEEP_PIPELINE_MODEL_DESCRIPTION,
    make: () => new DeepPipelineProcessor(),
    // `'none'` is the deliberate superscalar/out-of-order pattern, not an oversight: a
    // `DatapathKind` means "a diagram of this kind EXISTS", so declaring one before M11 step 7
    // draws it would make the table test below assert a diagram nothing rendered, while App
    // silently fell through to the placeholder. The PIPELINE MAP, meanwhile, already draws this
    // model's seven columns for free (INV-3) — step 4 pinned that `pipeline-map.ts` folds a real
    // seven-stage recording untouched — so the tier is fully teachable at `'none'`.
    datapath: 'none',
    capabilities: DEEP_PIPELINE_CAPABILITIES,
  },
  {
    id: SUPERSCALAR_MODEL_ID,
    label: 'Superscalar',
    // The engine's OWN one-liner rather than a sentence written here, unlike the three rows above.
    // Those predate the constant; this model exports one, and a description re-typed in the shell is
    // a second place for the same claim to go stale.
    description: SUPERSCALAR_MODEL_DESCRIPTION,
    make: () => new SuperscalarProcessor(),
    // Its OWN hand-authored geometry (M7 step 7): a shared front-end feeding two replicated execute
    // lanes. Deliberately NOT reusing the pipeline's diagram — that one draws one instruction per
    // stage, so a superscalar trace would light it into a picture that contradicts the machine
    // (INV-5), which is the same reason M3 did not reuse M2's. This value stayed `'none'` through
    // step 6 on purpose: a `DatapathKind` means "a diagram of this kind exists", so declaring it a
    // step early would have made the discriminator (and the table test that pins it) assert a
    // bespoke diagram that nothing drew, while App silently fell through to the placeholder.
    datapath: 'superscalar',
    capabilities: SUPERSCALAR_CAPABILITIES,
  },
  {
    id: OUT_OF_ORDER_MODEL_ID,
    label: 'Out-of-order',
    // The engine's OWN one-liner, like the superscalar above — a description re-typed in the shell is
    // a second place for the same claim to go stale.
    description: OUT_OF_ORDER_MODEL_DESCRIPTION,
    make: () => new OutOfOrderProcessor(),
    // Its OWN hand-authored geometry (M9 step 7): a shared front-end dispatching into the reorder
    // buffer and reservation stations, which issue to a functional-unit pool and a load/store unit
    // whose results ride the common data bus back to the RS and ROB, with the ROB committing in order
    // into the register file. This value sat at `'none'` through step 6 on purpose (the superscalar
    // precedent) — a `DatapathKind` means "a diagram of this kind EXISTS", so flipping it early would
    // have made the datapath table in `models.test.ts` assert a diagram nothing drew. It flips now,
    // together with the union member and App's dispatch arm. Deliberately NOT reusing any sibling's
    // diagram: an out-of-order trace lights structures (ROB, RS, CDB) no in-order diagram has, so any
    // reuse would draw a contradictory picture (INV-5), the same reason no prior model reused another.
    //
    // This is the SHEDDABLE half of the tier (the plan's inverted scope lever) — the ROB/RS/rename
    // tables (step 6) are the star surface; the pipeline MAP already renders the out-of-order
    // recording for free (INV-3). The datapath is the last piece, not the load-bearing one.
    datapath: 'out-of-order',
    capabilities: OUT_OF_ORDER_CAPABILITIES,
  },
];

/** The model selected on first load. Single-cycle is the simplest first teaching model. */
export const DEFAULT_MODEL_ID = SINGLE_CYCLE_MODEL_ID;

/** Resolve a model id to its choice, falling back to the default for an unknown id. */
export function modelById(id: string): ModelChoice {
  return MODELS.find((m) => m.id === id) ?? MODELS[0]!;
}

/**
 * The shell's session config, narrowed to the knobs `model` actually claims (M11 step 5). Today it
 * clamps exactly one field: **`cache`, for a model whose `configurableCache` is false.**
 *
 * The shell holds forwarding, prediction, the cache geometry, issue width and the out-of-order
 * cluster at SESSION level and hands the whole config to whichever engine is driving — which is
 * safe because a knob an engine does not honor is simply a knob it IGNORES (`simulator.test.ts`
 * pins that inertness per model).
 *
 * **Read the history, because it changes what this function is FOR.** It was added at M11 step 5
 * because `deep-pipeline` was then the one shipped engine that **REFUSED** a cache — `reset()` threw
 * rather than run silently cache-less, while step 6 held the miss-freeze seam open — so "hand every
 * model everything" had stopped being safe: pipeline with the cache on, switch to Deep pipeline,
 * and the load threw out of an event handler. **M11 step 6 implemented that cache, so no shipped
 * engine refuses anything today** and this is no longer protection; it is NORMALIZATION, keeping a
 * model's recording free of a geometry it never consulted.
 *
 * It is kept rather than deleted because the invariant it states — *send a model only the knobs it
 * claims* — is the one that made the step-5 crash impossible rather than merely unlikely, and the
 * next engine to refuse a knob will want it already here. **If it ever protects again, the argument
 * that forced CLAMPING over an error message is still the right one:** a knob's CONTROL is gated on
 * the same capability flag (`App.tsx`), so a refused knob is one the user has no control to unset,
 * and an error would strand them.
 *
 * **Only `cache`, deliberately.** Extending this to the other four knobs would be four more
 * judgement calls, each able to change an existing model's recording — and every model's cycle
 * counts are pinned in a timing suite. The other knobs are ignored, and the tests that pin that
 * inertness are what make ignoring safe. A knob some future model REFUSES belongs here, beside this
 * one, with the same argument written out.
 *
 * Note what is NOT clamped: the session's own value. The caller keeps its cache geometry while
 * visiting a model that cannot take one, so switching back restores it — the clamp is on the value
 * PASSED to the engine, not on the shell's state.
 */
export function engineConfigFor(model: ModelChoice, config: ProcessorConfig): ProcessorConfig {
  if (model.capabilities.configurableCache) return config;
  return { ...config, cache: null };
}
