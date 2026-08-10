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
  ScoreboardProcessor,
  SCOREBOARD_CAPABILITIES,
  SCOREBOARD_MODEL_DESCRIPTION,
  SCOREBOARD_MODEL_ID,
} from '@cpu-viz/engine-scoreboard';
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
import {
  defaultConfig,
  type Processor,
  type ProcessorCapabilities,
  type ProcessorConfig,
} from '@cpu-viz/trace';
import type { SessionKnobs } from './session';

/**
 * Which bespoke SVG datapath view (if any) renders a model's trace. Each model has its OWN
 * hand-authored geometry — lighting single-cycle's one-tick datapath with a multi-cycle trace
 * (whose phases spread across cycles) would draw a CONTRADICTORY picture, an INV-5 violation — so
 * the web shell dispatches on this discriminator rather than a plain has/has-not flag.
 *
 * The two non-diagram values say DIFFERENT things, and keeping them apart is what makes
 * {@link showsDatapathSlot} honest:
 *
 *  - **`'none'`** — a diagram belongs here and is not built yet. The slot appears and falls back to
 *    the "coming soon" placeholder, which is the truthful thing to say.
 *  - **`'panel'`** — this model's canonical picture is deliberately NOT a wire diagram; it is a
 *    panel elsewhere on the page. No slot, and no promise of a diagram that is not coming.
 *
 * ⚠ **`'panel'` exists because the step-8 browser pass measured the alternative.** The gate used to
 * key on a trace fact alone, so with an empty program the scoreboard fell back to `'none'` and the
 * shell promised a wire diagram M15 had deliberately declined (decision 9) — measured as the ONLY
 * state in the whole product that reaches the placeholder at all, since every other model has a
 * real diagram. A model's own picture is a property the MODEL knows, not something to re-derive
 * from whether a program happens to be loaded.
 */
export type DatapathKind =
  | 'single-cycle'
  | 'multi-cycle'
  | 'pipeline'
  | 'deep-pipeline'
  | 'superscalar'
  | 'out-of-order'
  | 'panel'
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
    // Its OWN hand-authored geometry (M11 step 7): seven stage bands divided by six latch bars,
    // with the forwarding muxes in EX1 handing their operands to the EX1/EX2 LATCH — so the diagram
    // shows, structurally, that nothing forwards into EX2 and a dependent instruction must wait.
    // This value sat at `'none'` through step 6 on purpose (the superscalar/out-of-order precedent):
    // a `DatapathKind` means "a diagram of this kind EXISTS", so flipping it early would have made
    // the datapath table in `models.test.ts` assert a diagram nothing drew. It flips now, together
    // with the union member and App's dispatch arm. Deliberately NOT reusing `'pipeline'`: that
    // diagram has five columns and puts the ALU behind the same latch as the muxes, so a seven-stage
    // trace would light it into a picture that contradicts the machine (INV-5) — and the bubble this
    // tier exists to teach would be exactly the thing it could not draw.
    datapath: 'deep-pipeline',
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
  {
    id: SCOREBOARD_MODEL_ID,
    label: 'Scoreboard',
    // The engine's OWN one-liner, like the three rows above. See its docblock for the two things it
    // deliberately refuses to say — chiefly that issue here is IN ORDER and blocking, so this row
    // and the out-of-order row directly above it do not read as the same claim.
    description: SCOREBOARD_MODEL_DESCRIPTION,
    make: () => new ScoreboardProcessor(),
    // LAST in the picker (M15 decision 8), and the position is an argument rather than an append.
    // Historically and pedagogically the scoreboard comes BEFORE Tomasulo, which would put it above
    // `out-of-order` — the deep pipeline took exactly that insertion at M11 rather than dodging the
    // churn. It goes last anyway because the shipped family is what a reader has already met: the
    // milestone's thesis is that M9 built Tomasulo with renaming already in it, so the product shows
    // what renaming DOES without ever showing the machine that lacks it. This row is that machine,
    // and it only reads as "the predecessor, minus renaming" if the successor is already behind you.
    // The description carries that framing, which is why decision 8 pinned the two together.
    //
    // `'none'` through step 6, on the superscalar / out-of-order / deep-pipeline precedent: a
    // `DatapathKind` means "a diagram of this kind EXISTS", so declaring one early makes the table
    // in `models.test.ts` assert a diagram nothing draws while App silently falls through to the
    // placeholder. Step 7 shipped this model's canonical picture, and it is NOT a wire-and-box
    // datapath at all (decision 9) — it is the scoreboard's three status tables evolving cycle by
    // cycle.
    //
    // ⚠ **`'panel'` since step 8, and the browser is what moved it.** At `'none'` the slot's
    // suppression rested entirely on a trace fact, so an EMPTY editor put the "Scoreboard datapath
    // — coming soon" placeholder back on screen — measured live as the only state anywhere in the
    // product that reaches it, every other model having a real diagram. Saying `'panel'` states
    // what is actually true of this model in every state, and leaves `'none'` meaning what it
    // always meant, so a future model with neither picture still gets the placeholder.
    datapath: 'panel',
    capabilities: SCOREBOARD_CAPABILITIES,
  },
];

/**
 * Should the shell give this model a datapath SLOT at all — or is its canonical picture something
 * other than a wire-and-box diagram?
 *
 * A model with a drawable `DatapathKind` always gets the slot. **M15 made a second case reachable
 * for the first time: a model whose canonical picture is a PANEL rather than a diagram.** The
 * scoreboard's is its three status tables (decision 9 pinned that no wire diagram ships this
 * milestone, and it is a follow-up only if the tables read as a spreadsheet), so beside that panel
 * the placeholder promises a diagram the plan deliberately declined and tells the reader to go and
 * watch the register panel instead — while the picture they want is directly above it.
 *
 * So the slot is suppressed for exactly that case, and the placeholder stays REACHABLE for the case
 * it was written for: a model at `'none'` — a diagram that belongs here and is not built yet.
 *
 * ## The two conditions, and why BOTH are here
 *
 * `datapath: 'panel'` is a property the MODEL declares about itself, and it holds in every state,
 * including before a single cycle is recorded. `bespokePicture` is a TRACE fact the caller has
 * already computed (`hasScoreboardTables`, `hasMicroTables`) and covers a model that grows a
 * bespoke picture without declaring one.
 *
 * ⚠ **The trace fact ALONE was the shipped version, and step 8 measured what it costs.** With an
 * empty or unassembled program both flags are false, so the scoreboard's slot came back and the
 * shell promised "Scoreboard datapath — coming soon" — the exact sentence step 7 removed, in the
 * one state a reader reaches by clearing the editor. Measured live: that was the ONLY route to the
 * placeholder anywhere in the product, because all six other models draw a real diagram. Neither
 * condition names a model, which is the property to preserve — the same reason
 * {@link engineConfigFor} gates on a capability flag rather than an id.
 */
export function showsDatapathSlot(model: ModelChoice, bespokePicture: boolean): boolean {
  if (model.datapath === 'panel') return false;
  return model.datapath !== 'none' || !bespokePicture;
}

/** The model selected on first load. Single-cycle is the simplest first teaching model. */
export const DEFAULT_MODEL_ID = SINGLE_CYCLE_MODEL_ID;

/** Resolve a model id to its choice, falling back to the default for an unknown id. */
export function modelById(id: string): ModelChoice {
  return MODELS.find((m) => m.id === id) ?? MODELS[0]!;
}

/**
 * The shell's session config, narrowed to the knobs `model` actually claims (M11 step 5). It clamps
 * two fields: **`cache`, for a model whose `configurableCache` is false, and `issueWidth`, for a
 * model whose `configurableIssueWidth` is false.**
 *
 * The shell holds forwarding, prediction, the cache geometry, issue width and the out-of-order
 * cluster at SESSION level and hands the whole config to whichever engine is driving — which is
 * safe because a knob an engine does not honor is simply a knob it IGNORES (`simulator.test.ts`
 * pins that inertness per model).
 *
 * **Read the history, because it changes what this function is FOR — twice.** It was added at M11
 * step 5 because `deep-pipeline` was then the one shipped engine that **REFUSED** a cache —
 * `reset()` threw rather than run silently cache-less, while step 6 held the miss-freeze seam open —
 * so "hand every model everything" had stopped being safe: pipeline with the cache on, switch to
 * Deep pipeline, and the load threw out of an event handler. M11 step 6 implemented that cache, so
 * from then until M15 no shipped engine refused anything and the cache clamp was NORMALIZATION
 * rather than protection: it kept a model's recording free of a geometry it never consulted.
 *
 * **M15 made it protection again**, which is why it was kept rather than deleted. The scoreboard
 * refuses `issueWidth` other than 1 (its Issue stage is one instruction per cycle, in order, by
 * definition of the machine) and throws by name from `reset()`. So the M11 crash is live on a new
 * knob: set the superscalar to 4-wide, pick Scoreboard, and without the clamp below the load throws
 * out of a click handler. **The argument that forced CLAMPING over an error message is unchanged
 * and is what makes this the right shape:** a knob's CONTROL is gated on the same capability flag
 * (`App.tsx` renders the width toggle only where `configurableIssueWidth` is true), so a refused
 * knob is precisely one the reader has no control left to unset, and an error would strand them
 * with a dead app and no way back.
 *
 * ## Why the predicate is the CAPABILITY FLAG and not the model id
 *
 * `ProcessorCapabilities` has no "refuses" bit as distinct from an "ignores" bit, and this function
 * cannot invent one: the whole family gates on flags (a control's visibility, a panel's appearance,
 * this narrowing), and a shell that special-cased `model.id === 'scoreboard'` would be the one place
 * that knows a model by name. So the rule is uniform with the cache above it — **a model that does
 * not claim a knob is handed that knob's neutral value** — and it therefore also applies to the four
 * width-BLIND models, which merely ignore the field.
 *
 * ⚠ **That extension is safe only because those four cannot see the value, and it was re-measured
 * at M15 step 5 rather than inherited from M13.** `pipeline`, `deep-pipeline`, `single-cycle` and
 * `multi-cycle` do not mention `issueWidth` **anywhere in their `processor.ts`** — they do not read
 * it, do not default it, and cannot throw on it (M7 step 1 pinned that inertness as whole-trace
 * identity rather than assuming it). **A green suite is not the warrant here**: the timing suites
 * drive engines directly and never cross this seam, so they would stay green either way. The grep is
 * the warrant, and it expires the moment a fifth model reads the field.
 *
 * The clamp is to **`1`, not `undefined`** — the shell holds a POSITION rather than an opinion-free
 * absence (`session.ts` opens at 1, `useSimulator` always passes a number), and 1 is the value the
 * engines' own `?? 1` already agrees with. Handing back `undefined` would make the by-name knob
 * sweep in `engine-config.test.ts` assert the absence of a field the shell never omits.
 *
 * **Still only these two, deliberately.** The remaining knobs — `forwarding`, `branchPrediction`,
 * `outOfOrderIssue`, `robSize`, `slowOpLatency`, `numMshrs` — are IGNORED by the models that do not
 * claim them, and the tests pinning that inertness are what make ignoring safe. Clamping one anyway
 * would be a judgement call able to move an existing model's recording, and every model's cycle
 * counts are pinned in a timing suite. **The next knob some model REFUSES belongs here, beside these
 * two, with its own argument written out** — and, as M15 showed, with its inertness for the models
 * that merely ignore it re-measured rather than assumed.
 *
 * Note what is NOT clamped: the session's own value. The caller keeps its cache geometry and its
 * width while visiting a model that can take neither, so switching back restores both — the clamp is
 * on the value PASSED to the engine, not on the shell's state.
 */
export function engineConfigFor(model: ModelChoice, config: ProcessorConfig): ProcessorConfig {
  const caps = model.capabilities;
  if (caps.configurableCache && caps.configurableIssueWidth) return config;
  return {
    ...config,
    ...(caps.configurableCache ? {} : { cache: null }),
    ...(caps.configurableIssueWidth ? {} : { issueWidth: 1 }),
  };
}

/**
 * **The whole shell→engine seam, as a pure function** (M13 review, finding 5): the
 * {@link ProcessorConfig} a model is actually handed for a given set of {@link SessionKnobs}.
 *
 * This is `useSimulator.loadInto`'s config expression, moved out of the `useCallback` it used to
 * live inside. That position was the defect, not any line in it: a hook cannot be invoked without
 * jsdom, which this repo deliberately does not have, so **the seam was unreachable from every
 * headless test by construction**. Three milestones each measured the same consequence and each
 * answered it with a browser pass — deleting `branchPrediction` from the literal left all 229 web
 * tests green (M11 step 5), deleting `issueWidth` left all 581 (M7 step 6), and clamping
 * `issueWidth` to 2 left all 1518 (M13 step 6), which is a control that is right at widths 1 and 2
 * and silently wrong at 3 and 4.
 *
 * **Five of the eight knobs are OPTIONAL on `ProcessorConfig`**, so dropping one is not even a type
 * error — only `forwarding`, `branchPrediction` and `cache` redden `tsc`. That asymmetry is why the
 * hole was worse for exactly the knobs the last three milestones added.
 *
 * The two steps are kept in this order and both belong here. The spread over `defaultConfig()`
 * supplies the fields no shell control owns (`seed`, and anything a future model adds); the
 * {@link engineConfigFor} narrowing then removes what THIS model refuses. Reversing them would
 * clamp a cache and then hand `defaultConfig()`'s back.
 */
export function engineConfigOf(model: ModelChoice, knobs: SessionKnobs): ProcessorConfig {
  return engineConfigFor(model, { ...defaultConfig(), ...knobs });
}
