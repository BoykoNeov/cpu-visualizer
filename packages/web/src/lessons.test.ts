import { describe, expect, it } from 'vitest';
import {
  activeStepAt,
  anchorLesson,
  anchorOrderViolations,
  narrationFor,
  resolveNarration,
  type AnchoredStep,
  type Lesson,
  type LessonStep,
} from '@cpu-viz/curriculum';
import { MultiCycleProcessor } from '@cpu-viz/engine-multi-cycle';
import { CACHE_LARGE, CACHE_SMALL, PipelineProcessor } from '@cpu-viz/engine-pipeline';
import {
  defaultConfig,
  type CycleTrace,
  type Processor,
  type ProcessorCapabilities,
  type ProcessorConfig,
  type TraceEvent,
} from '@cpu-viz/trace';
import { MODELS, modelById } from './models';
import { EXAMPLE_PROGRAMS } from './programs';
import {
  LESSON_ORDER,
  LESSON_TRACKS,
  LESSONS,
  UNTRACKED_HEADING,
  lessonSections,
  orderLessons,
} from './lessons';
import { predictsTaken } from './session';
import { loadSource } from './simulator';

/**
 * The step-11 acceptance for lessons (INV-6): "the lessons play through; annotations fire on the
 * correct events." Because authored lessons are UNTRUSTED JSON (`lessons.ts`), this suite doubles
 * as their validator — it drives the REAL engines (the runner's own tests use hand-built fixtures;
 * the DAG forbids importing an engine into `curriculum`) and proves every step anchors, in order,
 * with resolvable narration. It then pins the headline event PAYLOAD of each lesson against a
 * hand-computed oracle, so a silently-wrong anchor (right event type, wrong occurrence) is caught,
 * not just a dead one.
 *
 * ## What M3 step 8 changed here, and why the old shape could not hold
 *
 * Until step 8 every lesson targeted single-cycle, so this file could hardcode that engine and
 * assert the strongest possible rule: NO step is ever dead. `forwarding-bubble` breaks both
 * assumptions at once, and not by accident — a lesson whose subject is *a stall that disappears
 * when you flip a toggle* is a lesson some of whose steps MUST be dead in one position. The
 * pinned event vocabulary says so outright: `stall.reason: 'raw'` fires only with forwarding OFF
 * (with it on, the interlock is gone), while `'load-use'` and `forward` fire only with it ON.
 * There is no honest authoring of the flagship experiment in which every step fires in both.
 *
 * So the rule is scoped rather than weakened, and DERIVED rather than declared — no new lesson-
 * format field (cf. step 6, which derived contraction visibility instead of declaring it):
 *
 *   Drive each lesson under the model it DECLARES, across every config position that model
 *   HONORS (the cross product over its capability flags — see `positionsFor`). Every step must
 *   anchor in AT LEAST ONE position; within each position, the survivors anchor in order, with
 *   resolvable narration, and no two share a cycle.
 *
 * That one rule degenerates correctly at both ends, which is why it needs no per-lesson special
 * case. A single-cycle lesson honors no config, so its position list has length 1 and "at least
 * one" IS "every step anchors" — the old strict rule, unchanged in force. The pipeline lesson gets
 * four (M4 step 4 added prediction), so a config-exclusive step is lawful — while a MISTYPED one
 * (an unsatisfiable `where`, a bad event name) is still caught, because it is dead in ALL. Order and
 * the shared-cycle guard are checked per RECORDING, never on a merged anchoring: a step that is null
 * in one position must be skipped there, which the runner already does correctly per-recording.
 *
 * What that generic rule deliberately CANNOT see is the pedagogy — a step that fires in both
 * positions when it was meant to fire in one would pass it. That claim is the lesson's whole
 * point, so it is asserted positively and by name, in `forwarding-bubble`'s own oracle below:
 * the interlock is alive-off and dead-on ("the bubble vanishes") and the load-use stall is alive
 * in both... on different terms. Those are the assertions, not this sweep.
 *
 * **M4 step 4 measured how blind that blindness is, and it is worth the warning.** The sweep went
 * from two positions to four, green throughout — while the shell was simultaneously shipping
 * `forwarding-bubble`'s closing prose ("51 cycles") over a transport reading 49, because the lesson
 * had stopped declaring the prediction scheme its numbers depend on. Anchoring survived the config
 * change; the WORDS did not. Every step fired, in order, at its own cycle, in all four positions,
 * and the lesson was lying. A narration oracle is the only thing that can see that — hence the
 * `72 → 51` test below, and hence its scheme being DERIVED from the lesson rather than assumed.
 */

/** Assemble a corpus program and record it to completion — the runner's precondition. */
function recordProgram(
  programName: string,
  make?: () => Processor,
  config?: ProcessorConfig,
): readonly CycleTrace[] {
  const program = EXAMPLE_PROGRAMS.find((p) => p.name === programName);
  expect(program, `lesson program "${programName}" is not in the corpus`).toBeDefined();
  const result = loadSource(program!.source, make, config);
  expect(result.ok, `"${programName}" should assemble`).toBe(true);
  if (!result.ok) throw new Error('unreachable: assembly failed');
  result.loaded.recorder.runToEnd(); // anchor against a COMPLETE recording
  return result.loaded.recorder.recorded;
}

/** A named config position to drive a lesson's declared model under. */
interface Position {
  label: string;
  config: ProcessorConfig;
}

/**
 * One config knob a model may honor: the capability that gates it, and the positions it can be in.
 * Data rather than an `if`, because {@link positionsFor} takes the CROSS PRODUCT over the honored
 * ones — adding a knob is a row here, not a rewrite.
 */
interface ConfigAxis {
  honored: (caps: ProcessorCapabilities) => boolean;
  positions: readonly { label: string; set: (c: ProcessorConfig) => ProcessorConfig }[];
}

/**
 * Every knob a model can honor, each with its behaviors. Note `branchPrediction` contributes TWO
 * positions for THREE names: `'none'` and `'static-not-taken'` are the same machine (M4 step 1 —
 * a processor with no predictor does not wait, it keeps fetching, and the fall-through IS the
 * not-taken path), so sweeping `'none'` as a third position would re-run an identical recording
 * and call the duplicate coverage. The positions are the BEHAVIORS, not the names.
 */
const CONFIG_AXES: readonly ConfigAxis[] = [
  {
    honored: (caps) => caps.configurableForwarding,
    positions: [
      { label: 'forwarding off', set: (c) => ({ ...c, forwarding: false }) },
      { label: 'forwarding on', set: (c) => ({ ...c, forwarding: true }) },
    ],
  },
  {
    honored: (caps) => caps.configurableBranchPrediction,
    positions: [
      { label: 'predict not-taken', set: (c) => ({ ...c, branchPrediction: 'static-not-taken' }) },
      { label: 'predict taken', set: (c) => ({ ...c, branchPrediction: 'static-taken' }) },
    ],
  },
  {
    // The cache contributes THREE positions, not two, and the asymmetry with prediction is the point
    // (M6 step 5). Prediction's `'none'` collapsed into `'static-not-taken'` because they are one
    // machine; the cache's three are three machines — off records no `cache-access`, and small/large
    // diverge on a straddling working set. All three are reachable from the shell's control, so all
    // three must be swept. These are the SAME constants the shell's toggle and the timing suite use,
    // imported rather than re-declared, so the sweep and the UI cannot disagree about the geometry.
    honored: (caps) => caps.configurableCache,
    positions: [
      { label: 'cache off', set: (c) => ({ ...c, cache: null }) },
      { label: 'cache small', set: (c) => ({ ...c, cache: CACHE_SMALL }) },
      { label: 'cache large', set: (c) => ({ ...c, cache: CACHE_LARGE }) },
    ],
  },
  {
    // The fourth axis (M7 step 6), added the step that makes it REACHABLE rather than the step that
    // will first use it — which is the ownership rule this helper's docblock states, and the rule
    // that was broken twice before (the sweep read `configurableForwarding` alone while claiming to
    // derive from capabilities, and stayed silently at a fraction of coverage). No shipped lesson
    // targets the superscalar today, so `honored` is false for every lesson's model and this axis
    // contributes nothing yet. That is exactly why it goes in NOW: the first superscalar lesson
    // would otherwise be swept at half coverage, and nothing would say so.
    honored: (caps) => caps.configurableIssueWidth,
    positions: [
      { label: '1-wide', set: (c) => ({ ...c, issueWidth: 1 }) },
      { label: '2-wide', set: (c) => ({ ...c, issueWidth: 2 }) },
    ],
  },
  {
    // The fifth axis (M10 step 0) — out-of-order ISSUE, the M9 flagship A/B — added the step that
    // makes it REACHABLE rather than the step that first uses it, exactly as M7 step 6 added the width
    // axis before any superscalar lesson existed. The out-of-order model sets `configurableForwarding`
    // FALSE (the CDB broadcast IS the forward — there is no honest off-position), so an OoO lesson is
    // swept over prediction × cache × width × THIS cluster, not over a forwarding axis. No shipped
    // lesson targets `out-of-order` today, so this contributes nothing yet — which is exactly why it
    // goes in NOW: the first OoO lesson would otherwise be swept at a fraction of coverage and nothing
    // would say so.
    honored: (caps) => caps.configurableOutOfOrder,
    positions: [
      { label: 'in-order issue', set: (c) => ({ ...c, outOfOrderIssue: false }) },
      { label: 'out-of-order issue', set: (c) => ({ ...c, outOfOrderIssue: true }) },
    ],
  },
  {
    // The sixth axis (M10 step 0) — ROB SIZE, the cluster's structural lever — gated on the SAME
    // capability as issue-order (`configurableOutOfOrder` gates the whole OoO config cluster), but a
    // SEPARATE axis because the cross product is the point: issue-order and ROB size are independently
    // reachable. The shell renders BOTH the issue-order toggle and the ROB-size control under that one
    // flag (App.tsx), and useSimulator holds a position for each (`setOutOfOrderIssue` / `setRobSize`),
    // so each is a state a user can land in — and an unswept reachable state is the defect this project
    // keeps finding. The two positions are the shell's own: 16 (the engine default, `config.robSize ??
    // 16`, so it aliases "absent") and 4 (the small window that fills and stalls dispatch), default
    // first.
    //
    // `slowOpLatency` is the cluster's THIRD config field and is deliberately NOT an axis: the reach-
    // ability rule cuts the other way for it. The shell exposes no control and useSimulator threads no
    // position for it (verified M10 step 0), so it is not a state a user can reach — the plan's
    // "reachable shell controls per M9" parenthetical was optimistic; `slowOpLatency` shipped config-
    // only and its engine consumer landed at M10 step 1. A lesson that needs a slow op holds it fixed
    // in its own config, the way the program itself is fixed, and the timing it drives is the narration
    // oracle's job — not the sweep's (the headline: the event multiset is toggle-invariant anyway).
    honored: (caps) => caps.configurableOutOfOrder,
    positions: [
      { label: 'rob 16', set: (c) => ({ ...c, robSize: 16 }) },
      { label: 'rob 4', set: (c) => ({ ...c, robSize: 4 }) },
    ],
  },
];

/**
 * The config positions a model actually HONORS — derived from its own capabilities, never from a
 * list of model ids here. A config-blind model has exactly one neutral position, so the sweep over
 * it is the pre-step-8 single-position check; the pipeline honors two knobs and is swept over all
 * four combinations. These are the same capability gates the shell uses to decide which controls to
 * render (M3 step 5, M4 step 4), so the suite and the UI can never disagree about which positions a
 * lesson has to be right in.
 *
 * **Why the cross product, and why it grew (M4 step 4).** This read `configurableForwarding` alone
 * while its docblock claimed to derive from capabilities — true while forwarding was the only
 * honored knob, and quietly false the moment step 1 flipped `configurableBranchPrediction` to
 * `true`. That is step 2's `configLabel` defect one layer down: *a guard whose case list cannot
 * reach the collision is not a guard.* The rule that decides ownership is reachability — step 4 is
 * what puts the prediction control in the browser, so step 4 is what makes a lesson-under-
 * `static-taken` a state a user can reach, and an unswept reachable state is the defect this
 * project keeps finding.
 */
function positionsFor(modelId: string): Position[] {
  const caps = modelById(modelId).capabilities;
  let positions: Position[] = [{ label: '', config: defaultConfig() }];
  for (const axis of CONFIG_AXES) {
    if (!axis.honored(caps)) continue;
    positions = positions.flatMap((p) =>
      axis.positions.map((v) => ({
        label: p.label === '' ? v.label : `${p.label}, ${v.label}`,
        config: v.set(p.config),
      })),
    );
  }
  // A model honoring nothing never entered the loop and keeps the seed's empty label.
  return positions.map((p) => (p.label === '' ? { ...p, label: 'neutral config' } : p));
}

/** Record a lesson's program under the model the LESSON declares, in one config position. */
function recordLesson(lesson: Lesson, config: ProcessorConfig): readonly CycleTrace[] {
  return recordProgram(lesson.program, modelById(lesson.model).make, config);
}

/** As {@link recordProgram}, but driven by the multi-cycle engine (M2 step 5a). */
function recordProgramMultiCycle(programName: string): readonly CycleTrace[] {
  const program = EXAMPLE_PROGRAMS.find((p) => p.name === programName);
  expect(program, `lesson program "${programName}" is not in the corpus`).toBeDefined();
  const result = loadSource(program!.source, () => new MultiCycleProcessor());
  expect(result.ok, `"${programName}" should assemble`).toBe(true);
  if (!result.ok) throw new Error('unreachable: assembly failed');
  result.loaded.recorder.runToEnd();
  return result.loaded.recorder.recorded;
}

/**
 * As {@link recordProgram}, but driven by the 5-stage pipeline under a chosen `forwarding`
 * position (M3 step 5) — the first model whose TRACE depends on its CONFIG, and so the first
 * time a lesson has to survive a config swap rather than only a model swap.
 */
function recordProgramPipeline(programName: string, forwarding: boolean): readonly CycleTrace[] {
  const program = EXAMPLE_PROGRAMS.find((p) => p.name === programName);
  expect(program, `lesson program "${programName}" is not in the corpus`).toBeDefined();
  const result = loadSource(program!.source, () => new PipelineProcessor(), {
    ...defaultConfig(),
    forwarding,
  });
  expect(result.ok, `"${programName}" should assemble`).toBe(true);
  if (!result.ok) throw new Error('unreachable: assembly failed');
  result.loaded.recorder.runToEnd();
  return result.loaded.recorder.recorded;
}

/** The trace event a step anchored to (cycle numbers are contiguous from 0). */
function anchoredEvent(trace: readonly CycleTrace[], anchored: AnchoredStep): TraceEvent {
  expect(anchored.cycle, `step ${anchored.index} never fired`).not.toBeNull();
  const cycle = trace.find((c) => c.cycle === anchored.cycle);
  expect(cycle, `no recorded cycle ${anchored.cycle}`).toBeDefined();
  return cycle!.events[anchored.eventIndex!]!;
}

/**
 * Map instruction id → the pc it was fetched from, for THIS recording. Ids are minted per fetch, so
 * they are meaningless across two recordings; the pc is what identifies an event as "that source
 * line", and it is the difference between pinning a lesson's SUBJECT and pinning its arithmetic.
 */
function pcById(trace: readonly CycleTrace[]): Map<string, number> {
  const pcs = new Map<string, number>();
  for (const cycle of trace) {
    for (const event of cycle.events) {
      if (event.type === 'instr-fetch') pcs.set(event.instr, event.pc);
    }
  }
  return pcs;
}

/** The pc of the instruction a step's anchored event names, or `null` if the step is dead. */
function anchoredPc(trace: readonly CycleTrace[], anchored: AnchoredStep): number | null {
  if (anchored.cycle === null) return null;
  const event = anchoredEvent(trace, anchored) as TraceEvent & { instr?: string };
  expect(event.instr, `${event.type} carries no instr id`).toBeDefined();
  const pc = pcById(trace).get(event.instr!);
  expect(pc, `no instr-fetch for ${event.instr}`).toBeDefined();
  return pc!;
}

const byId = (id: string): Lesson => {
  const lesson = LESSONS.find((l) => l.id === id);
  if (!lesson) throw new Error(`lesson "${id}" not found — the value oracle is stale`);
  return lesson;
};

const stepLabel = (step: LessonStep): string =>
  `${step.trigger.event}${step.trigger.nth ? ` #${step.trigger.nth}` : ''}`;

/**
 * Narration is authored as PLAIN TEXT with one markup construct: a backtick-delimited code span,
 * which `renderNarration` (App.tsx) splits out and renders as `<code>`. That is the whole
 * vocabulary. It is not Markdown, and nothing about a JSON string says so — the format is defined
 * entirely by what the renderer happens to split on.
 *
 * Which is how `forwarding-bubble` shipped `**not**` to the browser as four literal asterisks, and
 * why this guard exists (M3 step 8, found by the browser eyeball — every headless test was green).
 * The gap is structural rather than careless: every other check in this file asserts narration
 * RESOLVES — that `resolveNarration` returns a string at the tier. None asserted it RENDERS. A
 * defined string and a readable one are different claims, and only the first was ever tested, so an
 * author reaching for ordinary Markdown reflexes got no signal at all until someone looked.
 *
 * The check is deliberately narrow: strip the one construct that IS supported, then assert no `*`
 * survives. Asterisks are the hard failure — bold, italic and bullets all render as punctuation on
 * screen. Newlines are NOT flagged: HTML collapses them to a space, so a `\n\n` reads as dense
 * prose rather than as corruption, and forbidding them would be a style rule wearing a test's
 * clothes. Pin what breaks, not what one author would have done differently.
 */
describe('authored narration stays inside the vocabulary the renderer can show', () => {
  /** `renderNarration` splits on backticks; everything between a pair becomes a `<code>` span. */
  const withoutCodeSpans = (text: string): string =>
    text
      .split('`')
      .filter((_, i) => i % 2 === 0)
      .join('');

  for (const lesson of LESSONS) {
    it(`${lesson.id}: no step leans on markup the renderer does not implement`, () => {
      for (const [index, step] of lesson.steps.entries()) {
        for (const [tier, text] of Object.entries(step.narration)) {
          expect(
            withoutCodeSpans(text),
            `${lesson.id} step ${index} [${tier}] uses "*" — the renderer has no bold/italic, so ` +
              `it reaches the reader as a literal asterisk. Carry the emphasis in the sentence.`,
          ).not.toMatch(/\*/);
        }
      }
    });
  }

  it('the guard reads the real renderer’s rule: backtick spans are the one exemption', () => {
    // Non-vacuity, and the reason the strip step exists at all: a lesson may legitimately mention
    // an asterisk INSIDE a code span (`mul a0, a0, a1` is fine; so would be `a * b`), and the guard
    // must not fire on it. Without the strip this would be indistinguishable from bold.
    expect(withoutCodeSpans('the ALU computes `a * b` here')).toBe('the ALU computes  here');
    expect(withoutCodeSpans('an **emphasis** attempt')).toBe('an **emphasis** attempt');
  });
});

/**
 * The sweep's own guard (M4 step 4). `positionsFor` decides how many machines every lesson below is
 * checked against, so a mistake in it does not fail — it silently shrinks the coverage and leaves
 * every test green. That is precisely the defect step 2 found one layer up (`configLabel` collapsed
 * six configs to two labels while the harness's distinctness guard, parameterized by a two-config
 * list, could not see it), so the helper gets a case list that can reach its own collisions.
 */
describe('positionsFor — the sweep covers every machine a lesson can be opened on', () => {
  it('gives a config-blind model exactly one position', () => {
    expect(positionsFor('single-cycle').map((p) => p.label)).toEqual(['neutral config']);
    expect(positionsFor('multi-cycle').map((p) => p.label)).toEqual(['neutral config']);
  });

  it('gives the pipeline the CROSS PRODUCT of ALL THREE knobs it honors, not two', () => {
    // The claim in one line: three honored knobs ⇒ 2 × 2 × 3 = twelve machines. This is what went
    // stale when step 1 flipped `configurableBranchPrediction` (four, not two) and again when M6
    // flipped `configurableCache` (twelve, not four) — each time the sweep would have kept passing
    // at a fraction of coverage while `positionsFor` still enumerated the old knobs. The cache axis
    // is THREE positions because off/small/large are three machines, so it triples rather than
    // doubles the count.
    expect(positionsFor('pipeline').map((p) => p.label)).toEqual([
      'forwarding off, predict not-taken, cache off',
      'forwarding off, predict not-taken, cache small',
      'forwarding off, predict not-taken, cache large',
      'forwarding off, predict taken, cache off',
      'forwarding off, predict taken, cache small',
      'forwarding off, predict taken, cache large',
      'forwarding on, predict not-taken, cache off',
      'forwarding on, predict not-taken, cache small',
      'forwarding on, predict not-taken, cache large',
      'forwarding on, predict taken, cache off',
      'forwarding on, predict taken, cache small',
      'forwarding on, predict taken, cache large',
    ]);
  });

  /**
   * The superscalar's own count (M7 step 6) — and the case that gives this guard something to fail
   * on, because it is the ONLY model that reaches the width axis. Without it the axis could be
   * dropped, mis-gated, or given one position and every test here would stay green: `positionsFor`
   * is only ever called with a lesson's declared model, and no shipped lesson declares this one.
   * That is the precise shape of the two staleness bugs recorded above, so the case list is
   * extended to reach the collision rather than left to the first superscalar lesson to discover.
   *
   * Four honored knobs ⇒ 2 × 2 × 3 × 2 = twenty-four machines. Asserted as a COUNT plus the axis
   * order and the endpoints, not twenty-four spelled-out labels: at this size a literal list stops
   * being read and starts being pasted, and what is worth pinning is that all four axes are in the
   * product and the width is the innermost one.
   */
  it('gives the superscalar all FOUR knobs it honors — the width axis included', () => {
    const labels = positionsFor('superscalar').map((p) => p.label);
    expect(labels).toHaveLength(24);
    expect(labels[0]).toBe('forwarding off, predict not-taken, cache off, 1-wide');
    expect(labels[1]).toBe('forwarding off, predict not-taken, cache off, 2-wide');
    expect(labels[23]).toBe('forwarding on, predict taken, cache large, 2-wide');
    // Non-vacuity: the width genuinely varies across the sweep rather than every position carrying
    // the same value under two different labels — the failure a length check alone cannot see.
    const widths = new Set(positionsFor('superscalar').map((p) => p.config.issueWidth));
    expect(widths).toEqual(new Set([1, 2]));
  });

  /**
   * The out-of-order model's count (M10 step 0) — the case that gives the two new OoO axes something
   * to fail on, for the same reason the superscalar case does the width axis: `positionsFor` is only
   * ever called with a lesson's declared model, and no shipped lesson declares `out-of-order` yet, so
   * without this case the issue-order and ROB-size axes could be dropped, mis-gated, or given one
   * position and every test here would stay green — the exact staleness shape the two cases above
   * record.
   *
   * FIVE honored knobs, but `configurableForwarding` is FALSE on this model (the CDB broadcast IS the
   * forward — no off-position), so the product is prediction(2) × cache(3) × width(2) ×
   * outOfOrderIssue(2) × robSize(2) = 48, NOT the superscalar's 24 with a forwarding axis on top.
   * Asserted as a COUNT plus the axis order and the endpoints, like the superscalar case: at this size
   * a literal list stops being read and starts being pasted, and what is worth pinning is that BOTH
   * new axes are in the product (the flagship toggle and the ROB-size lever), innermost, that
   * `slowOpLatency` is NOT (no shell control — held per-lesson), and that forwarding is absent.
   */
  it('gives the out-of-order model prediction × cache × width × the OoO cluster — 48 machines', () => {
    const labels = positionsFor('out-of-order').map((p) => p.label);
    expect(labels).toHaveLength(48);
    expect(labels[0]).toBe('predict not-taken, cache off, 1-wide, in-order issue, rob 16');
    expect(labels[47]).toBe('predict taken, cache large, 2-wide, out-of-order issue, rob 4');
    // Non-vacuity: BOTH new knobs genuinely vary across the sweep rather than every position carrying
    // one value under two labels — the failure a length check alone cannot see (the width case's move,
    // twice). Read off the configs, which is what would agree while the labels lied.
    const issue = new Set(positionsFor('out-of-order').map((p) => p.config.outOfOrderIssue));
    expect(issue).toEqual(new Set([false, true]));
    const robs = new Set(positionsFor('out-of-order').map((p) => p.config.robSize));
    expect(robs).toEqual(new Set([4, 16]));
    // Forwarding is absent — the OoO model does not honor it (the CDB is the forward), so unlike the
    // superscalar there is no `forwarding on/off` axis and no such label. The thing that halves 96→48.
    expect(labels.every((l) => !l.includes('forwarding'))).toBe(true);
    // `slowOpLatency` never appears: it is held per-lesson, not swept, so no config carries it here.
    expect(positionsFor('out-of-order').every((p) => p.config.slowOpLatency === undefined)).toBe(
      true,
    );
  });

  it('the positions are DISTINCT configs, not twelve labels on one machine', () => {
    // The non-vacuity, and the thing a label can lie about: twelve names over identical configs
    // would run the sweep twelve times and prove one position. Compared as configs rather than
    // labels, because the labels are what would agree while the configs collapsed. `CACHE_SMALL`
    // and `CACHE_LARGE` are distinct objects with distinct geometry, so the cache axis genuinely
    // triples the distinct-config count rather than aliasing.
    const configs = positionsFor('pipeline').map((p) => JSON.stringify(p.config));
    expect(new Set(configs).size).toBe(12);
  });
});

/**
 * The order spine (M5 step 0) — the picker teaches in the AUTHORED order.
 *
 * The defect this replaces was live in the shipped product and is worth stating as more than a
 * changelog line, because it is the second instance of one class in a week: `lessons.ts` sorted by
 * `id.localeCompare`, so a beginner opening the picker was offered `array-in-memory` — a memory
 * lesson — ahead of `sum-loop-tour`. The ISA reference panel had just fixed the same shape one
 * surface down (groups inheriting the ISA table's *opcode* order, putting `addi` above `add`).
 * Both are a view inventing a pedagogical order from a key whose job is something else entirely.
 *
 * So the order moved into content, and what is tested here is the reading of it, in two blocks
 * that fail for different reasons: the sort itself against synthetic input (which is where a
 * mistake would otherwise go *quiet* rather than red), and the shipped index against the shipped
 * lessons (which is where an authoring omission goes red).
 */
describe('orderLessons — the sort a mistake in would not fail, only re-invent an order', () => {
  const ids = (lessons: { id: string }[]): string[] => lessons.map((l) => l.id);
  const of = (...names: string[]): { id: string }[] => names.map((id) => ({ id }));

  it('sorts into the index’s order, not the glob’s', () => {
    // The input is deliberately alphabetical — that is what the glob hands over, and what this
    // module used to ship as the answer.
    expect(ids(orderLessons(of('a', 'b', 'c'), ['c', 'a', 'b']))).toEqual(['c', 'a', 'b']);
  });

  it('KEEPS an unlisted lesson — last, and deterministically', () => {
    // The claim the picker's totality rests on: the index controls order, never membership. A
    // lesson missing from the index is misplaced; a lesson dropped by the view is unreachable, and
    // only the second is invisible to the person looking at the product.
    //
    // Two unlisted lessons rather than one, on purpose: it is what pins the comparator's rank for
    // "unlisted" as a finite number. With `Infinity` the pair compares `Infinity - Infinity = NaN`
    // and their order becomes unspecified — a test with one unlisted lesson cannot see that.
    expect(ids(orderLessons(of('zz', 'b', 'aa'), ['b']))).toEqual(['b', 'aa', 'zz']);
  });

  it('ignores an id with no lesson behind it rather than fabricating one', () => {
    expect(ids(orderLessons(of('a'), ['ghost', 'a']))).toEqual(['a']);
  });
});

describe('the lesson picker teaches in the authored order (M5 step 0)', () => {
  it('LESSONS is exactly the index, in the index’s order — exhaustive in BOTH directions', () => {
    // One assertion, three claims, because an array `toEqual` checks membership and order at once:
    // a globbed-but-unlisted lesson sorts past the end and lengthens the left, a listed-but-missing
    // id lengthens the right, and a lesson in the wrong place differs in place. This is the test the
    // step's mutation check aims at — drop an id from `index.json` and this is what reddens, alone.
    //
    // It is not tautological, which is the thing to check about a test comparing a list to its own
    // source: `LESSONS` is derived from the GLOB and merely *sorted* by the index, so the index
    // cannot conjure or suppress a member. Membership disagreeing is exactly what shows up here.
    expect(LESSONS.map((l) => l.id)).toEqual(LESSON_ORDER);
  });

  it('opens on the natural first lesson, not on whatever sorts first', () => {
    // The defect, pinned by name rather than by the general rule above — this is the pair a reader
    // can check against the picker in one glance, and the one that was wrong in the product.
    //
    // M5 step 1 moved the front door: `first-program` (5 + 37 = 42) is the smallest program that
    // computes anything, so it precedes the loop that step 0 promoted. Both claims are kept rather
    // than the first being retargeted — "a loop before an array" is a separate opinion from "an add
    // before a loop", and it is still the one that was live-wrong in the product.
    expect(LESSONS[0]!.id).toBe('first-program');
    expect(LESSON_ORDER.indexOf('first-program')).toBeLessThan(
      LESSON_ORDER.indexOf('sum-loop-tour'),
    );
    expect(LESSON_ORDER.indexOf('sum-loop-tour')).toBeLessThan(
      LESSON_ORDER.indexOf('array-in-memory'),
    );
  });

  it('teaches the RULE before the EXCEPTION — a load before the load trap', () => {
    // **The sequencing pass's actual find (M5 step 4), and it was live in the product.** Steps 2
    // and 3 each parked their lesson at the slot the plan guessed and wrote "step 4 is still the
    // real sequencing pass" in their logs. Read as a sequence for the first time, the track taught
    // `lb`/`lbu` at position 3 and `lw` at position 5: the exception before the rule.
    //
    // It is not a matter of taste, which is what makes it assertable. `array-in-memory`'s first
    // step INTRODUCES the concept ("`lw t2, 0(t0)` reads a word from data memory into a register");
    // `sign-and-zero`'s first step already spends addresses, loads and the data-memory panel
    // ("Before you can load a byte you need its address"). One lesson defines what the other
    // assumes, so their order is forced by their own prose.
    expect(LESSON_ORDER.indexOf('array-in-memory')).toBeLessThan(
      LESSON_ORDER.indexOf('sign-and-zero'),
    );
  });

  it('keeps the mirrored pair adjacent, and in the order their narration cross-references', () => {
    // `which-is-smaller`'s expert tier says "the same law `lb` and `lbu` show on loads, one surface
    // over" — so it reads as a callback only if `sign-and-zero` has already run. The direction is
    // pinned by that sentence, not by preference, and the pair is step 3's "looks different, is
    // same" / "looks same, is different" mirror: adjacency is the point of it.
    const a = LESSON_ORDER.indexOf('sign-and-zero');
    const b = LESSON_ORDER.indexOf('which-is-smaller');
    expect(b - a).toBe(1);
  });

  it('teaches the LANGUAGE before the MACHINE', () => {
    // The track's shape as an ordering claim rather than as a comment: the language track is
    // taught first, and the µarch flagships — whose subject is a machine, and which presuppose the
    // language — come after.
    //
    // **This test used to read the claim off `model`** (`lastIndexOf('single-cycle') <
    // indexOf('pipeline')`) and M5 step 4 retired that, which is the step's finding. The proxy is
    // true today — all six language lessons are single-cycle, both µarch ones are pipeline — but
    // true by COINCIDENCE. `model` says which microarchitecture a lesson runs on; a track says what
    // the lesson is ABOUT. A language lesson authored on the pipeline is lawful, and the proxy
    // would file it under the machine and stay green: a case list that cannot reach the defect,
    // for the third milestone running. So the track is declared in `index.json` and read here.
    expect(LESSON_TRACKS.map((t) => t.track)).toEqual([
      'The language',
      'The machine',
      'The cache',
      'The wide machine',
      'The out-of-order machine',
    ]);
  });

  it('teaches the MACHINE before the CACHE', () => {
    // The cache track is the third — its subject presupposes the pipeline the machine track
    // introduces. A cache lesson opens forwarding-on and speaks of the pipeline freezing on a miss;
    // a reader who has not met stalls and forwarding (the machine track) has no frame for it. Same
    // shape as language-before-machine above: declared in `index.json`, read here rather than derived
    // from `model` (all three cache lessons are `pipeline`, exactly like the machine track — which is
    // why `model` cannot tell the two µarch tracks apart, and the track is content).
    expect(LESSON_TRACKS.map((t) => t.track).indexOf('The machine')).toBeLessThan(
      LESSON_TRACKS.map((t) => t.track).indexOf('The cache'),
    );
  });

  it('teaches the cache track in its authored SEQUENCE: spatial → temporal → conflict', () => {
    // The plan fixed this order BEFORE any lesson was written and asked for it to be reviewed as a
    // SEQUENCE — M5 step 4's finding (a track shipped in the wrong order because authoring a lesson
    // never reads the other five, and incremental insertion cannot see a sequence) applied up front.
    // Only a by-name test can see order-pedagogy; the generic sweep cannot.
    //
    // The order is forced by the prose, not by taste, which is what makes it assertable. `cache-spatial`
    // INTRODUCES the line-fill ("it fetches a whole line, four words wide"); `cache-temporal` ASSUMES
    // it ("the first pass fills the cache line by line, exactly as the last lesson showed") and adds
    // reuse; `cache-conflict` ASSUMES that reuse ("the reuse the last lesson made free") and takes it
    // away by shrinking the cache. Each lesson defines what the next spends.
    expect(LESSON_ORDER.indexOf('cache-spatial')).toBeLessThan(
      LESSON_ORDER.indexOf('cache-temporal'),
    );
    expect(LESSON_ORDER.indexOf('cache-temporal')).toBeLessThan(
      LESSON_ORDER.indexOf('cache-conflict'),
    );
  });

  it('files each lesson under the track its SUBJECT belongs to — asserted by name', () => {
    // What the grouped index buys in structure it must pay for here, and the payment is the same
    // coin the project keeps spending: **track membership is pedagogy, so it is not derivable.**
    // Nothing in the trace, the lesson, or the engine can prove `branch-bet` is about a machine
    // rather than about the language — an author could file it under "The language" and every
    // structural check would stay green, exactly as an alphabetical index stays green (step 0) and
    // as a step dead in the wrong position stays green (M4 step 7).
    //
    // Deliberately NOT cross-checked against `model`. That would re-impose the coincidence above as
    // a law and redden the day someone lawfully teaches `lw` on the pipeline. This test names the
    // two lessons whose subject is a µarch; if that stops being true, a human should be the one to
    // say so.
    const machine = LESSON_TRACKS.find((t) => t.track === 'The machine');
    expect([...(machine?.lessons ?? [])].sort()).toEqual(['branch-bet', 'forwarding-bubble']);

    // The cache track's membership, by name for the same reason: "is this lesson about the memory
    // hierarchy" is pedagogy, not derivable. All three are `pipeline` (like the machine track), so
    // `model` cannot distinguish them; the track says so, and this pins which lessons it claims.
    const cache = LESSON_TRACKS.find((t) => t.track === 'The cache');
    expect([...(cache?.lessons ?? [])].sort()).toEqual([
      'cache-conflict',
      'cache-spatial',
      'cache-temporal',
    ]);

    // The wide machine's membership (M8), by name for the same reason: "is this lesson about
    // superscalar width" is pedagogy, not derivable — all four run on `superscalar` at `issueWidth: 2`,
    // but so could a lesson that is really about, say, forwarding observed on a wide machine. The
    // track claims exactly these four: the pairing payoff plus the three refusals. `lessonSections`
    // totality (line 600) would stay green even if one were misfiled, because `LESSON_ORDER` derives
    // from the same `index.json`; only naming the set here catches a mis-file.
    const wide = LESSON_TRACKS.find((t) => t.track === 'The wide machine');
    expect([...(wide?.lessons ?? [])].sort()).toEqual([
      'one-branch-unit',
      'one-door',
      'pair-that-cant',
      'two-at-once',
    ]);

    // The out-of-order machine's membership (M10), by name for the same reason: "is this lesson about
    // out-of-order issue" is pedagogy, not derivable — it runs on `out-of-order` at `outOfOrderIssue:
    // true`, but so could a lesson really about, say, the cache observed on an OoO machine. The track
    // claims the flagship "work slides ahead" (step 2) and the reservation-station slow-op lesson
    // (step 3); later OoO beats append here.
    const ooo = LESSON_TRACKS.find((t) => t.track === 'The out-of-order machine');
    expect([...(ooo?.lessons ?? [])].sort()).toEqual([
      'reservation-station-holds',
      'work-slides-ahead',
    ]);
  });

  it('shows every lesson in the picker, even one the index forgot', () => {
    // Step 0's totality rule, re-earned for the grouped picker rather than inherited from it: the
    // flat list could not drop an unlisted lesson (it sorted last), a group-only render can, and
    // "content that exists and nobody can reach" is what the index exists to end. The trailing
    // heading is the second net — the suite fails first — but it is the one visible in the product.
    const lessons = [
      { id: 'a', title: 'A' },
      { id: 'ghost', title: 'Ghost' },
    ] as unknown as Lesson[];
    const sections = lessonSections(lessons, [{ track: 'The language', lessons: ['a'] }]);
    expect(sections.map((s) => s.track)).toEqual(['The language', UNTRACKED_HEADING]);
    expect(sections[1]!.lessons.map((l) => l.id)).toEqual(['ghost']);
  });

  it('drops an empty track rather than showing a heading with nothing under it', () => {
    const lessons = [{ id: 'a', title: 'A' }] as unknown as Lesson[];
    const sections = lessonSections(lessons, [
      { track: 'The language', lessons: ['a'] },
      { track: 'The machine', lessons: [] },
    ]);
    expect(sections.map((s) => s.track)).toEqual(['The language']);
  });

  it('the shipped picker groups every lesson and invents no heading', () => {
    // The shipped counterpart to the synthetic checks above: with the real index, `UNTRACKED_HEADING`
    // must NOT appear, and the sections flattened must be exactly the picker's order — the property
    // that makes grouping and order one declaration rather than two that can drift.
    const sections = lessonSections();
    expect(sections.map((s) => s.track)).toEqual([
      'The language',
      'The machine',
      'The cache',
      'The wide machine',
      'The out-of-order machine',
    ]);
    expect(sections.flatMap((s) => s.lessons.map((l) => l.id))).toEqual(LESSONS.map((l) => l.id));
  });
});

describe('authored lessons (INV-6)', () => {
  it('ships the language tours, the two µarch flagships, the cache track, the wide machine, and the OoO flagship', () => {
    // Six single-cycle tours (M1's "2–3 lessons" target, plus M5's front door, its sign-extension
    // lesson, and the comparison lesson that is the same law one surface over); the two pipeline
    // flagships — one per SINGLE-STATE toggle the pipeline honors (forwarding, prediction); the
    // three-lesson cache track (M6 step 7); and the four superscalar lessons (M8 steps 1–4), the
    // wide machine's pairing payoff, its first (data) refusal, and its two structural refusals (the
    // memory port and the branch unit). Multi-cycle deliberately has none: its story is "one instruction,
    // phases spread over cycles", which the single-cycle lessons already narrate correctly when the
    // model is swapped under them (pinned by the cross-model suite below).
    //
    // **The cache is where "one lesson per toggle" stops being the shape, and that is honest.** The
    // cache toggle is three positions, not two, and it is not one behavior to demonstrate but three
    // teachable phenomena — spatial locality (the line), temporal locality (reuse across a pass), and
    // capacity/conflict (the size flip) — no one of which subsumes the others. So it earns a track,
    // like the language, rather than a single flagship like forwarding and prediction. A config knob
    // nobody can see the point of should not ship; a knob with three distinct points earns three.
    // The wide machine (M8) is a track for the same reason: width is one toggle but three refusal
    // reasons plus the pairing payoff, four teachable beats no one of which subsumes the others.
    // The out-of-order machine (M10) opens with the flagship "work slides ahead", the crown jewel
    // where a younger independent instruction executes past an older one stalled on a cache miss, and
    // adds "the reservation station holds" (step 3) — the Tomasulo namesake, a slow op held across
    // several execute cycles while independent work issues around it; later OoO beats (in-order commit,
    // renaming) append to that track.
    expect(LESSONS.length).toBe(17);
    // Sorted, because the claim in this test's own sentence is MEMBERSHIP. `LESSONS` is not in a
    // sorted order for it to borrow (order is pinned exhaustively, once, against `index.json` above).
    // Five pipeline lessons now: the two flagships plus the cache track — all of the machine and
    // cache tracks, which is the set whose narration could NOT be borrowed onto another model
    // (nothing else stalls, speculates, or caches).
    expect(
      LESSONS.filter((l) => l.model === 'pipeline')
        .map((l) => l.id)
        .sort(),
    ).toEqual([
      'branch-bet',
      'cache-conflict',
      'cache-spatial',
      'cache-temporal',
      'forwarding-bubble',
    ]);
  });

  it('canonicalizes every declared cache to a shipped constant (M6 step 7 reconcile)', () => {
    // The reconcile's own guard. `lessons.ts` maps a lesson's JSON-declared `config.cache` back to
    // one of the shipped `CACHE_SMALL` / `CACHE_LARGE` constants at load, so the shell's cache toggle
    // and `setCache` can keep lighting/guarding by plain IDENTITY. This asserts the mapping actually
    // fired: every shipped lesson that declares a non-null cache carries a value that is `===` a
    // shipped constant — not merely field-equal. A future author who writes a geometry matching
    // neither constant (a typo, or a size the toggle has no position for) reddens here rather than
    // shipping a lesson that silently lights no toggle position.
    const declared = LESSONS.flatMap((l) =>
      l.config && l.config.cache !== null ? [{ id: l.id, cache: l.config.cache }] : [],
    );
    // Non-vacuity: the cache track means there ARE such lessons, so this is not asserting over [].
    // The OoO flagship (M10) is the fourth cache-declaring lesson — it opens at CACHE_LARGE, the one
    // config family where out-of-order issue does anything (the miss is what independent work slides
    // past), so its declared geometry must canonicalize to the shipped constant like the cache track's.
    expect(declared.map((d) => d.id).sort()).toEqual([
      'cache-conflict',
      'cache-spatial',
      'cache-temporal',
      'work-slides-ahead',
    ]);
    for (const { id, cache } of declared) {
      expect(
        cache === CACHE_SMALL || cache === CACHE_LARGE,
        `${id} declares a cache that is not a shipped constant by identity`,
      ).toBe(true);
    }
  });

  // The validator: every lesson, every step, against the real engine it declares.
  for (const lesson of LESSONS) {
    describe(`${lesson.id} — "${lesson.title}"`, () => {
      it('references a program that exists in the corpus', () => {
        expect(EXAMPLE_PROGRAMS.map((p) => p.name)).toContain(lesson.program);
      });

      it('targets a model the shell can actually select', () => {
        // Was "single-cycle is the only model targeted in M1" — true then, and a check that would
        // now have to be deleted rather than generalized. The durable claim is the one the shell
        // depends on: `startLesson` resolves `lesson.model` through `modelById`, which falls back
        // to the DEFAULT model for an unknown id. So a typo'd model would silently open the lesson
        // on single-cycle rather than fail — for `forwarding-bubble` that means a lesson about
        // stalls, on a machine that has none.
        expect(MODELS.map((m) => m.id)).toContain(lesson.model);
      });

      it('a declared config only names knobs the declared model honors', () => {
        // A lesson that opened in a position its model ignores would be quietly inert: the shell
        // applies the config, the engine shrugs, and the narration describes a machine the user is
        // not looking at.
        //
        // Rewritten in M4 step 4, and the old shape was vacuous in a way worth naming. It read
        // `if (lesson.config.forwarding) expect(...configurableForwarding).toBe(true)` — a guard on
        // the knob's VALUE being truthy rather than on the knob being SET AWAY FROM NEUTRAL. The one
        // lesson that declares a config declares `forwarding: false`, so the check never ran on the
        // shipped corpus at all.
        //
        // A declared config is total, so "names a knob" cannot mean "mentions it" — every config
        // mentions every knob. It means LEANS on it: holds it somewhere the default does not, which
        // is the only way a config can be inert-but-load-bearing. Compared against `defaultConfig()`
        // rather than a list here, so the neutral position has one definition.
        if (lesson.config === undefined) return;
        const caps = modelById(lesson.model).capabilities;
        const neutral = defaultConfig();
        if (lesson.config.forwarding !== neutral.forwarding) {
          expect(caps.configurableForwarding, `${lesson.model} honors forwarding`).toBe(true);
        }
        // `'none'` and `'static-not-taken'` are the same machine, so leaning on prediction means
        // asking for a DIFFERENT one — naming not-taken by its explicit name is not a lean.
        if (
          predictsTaken(lesson.config.branchPrediction) !== predictsTaken(neutral.branchPrediction)
        ) {
          expect(caps.configurableBranchPrediction, `${lesson.model} honors prediction`).toBe(true);
        }
        if (lesson.config.cache != null) {
          expect(caps.configurableCache, `${lesson.model} honors caches`).toBe(true);
        }
      });

      // The sweep: the lesson's own model, in every position that model honors. For a config-blind
      // model this is one position and the rule is the old strict "no dead steps"; for the pipeline
      // it is two, and a config-exclusive step is lawful while a typo (dead in BOTH) still fails.
      const positions = positionsFor(lesson.model);
      for (const { label, config } of positions) {
        it(`[${label}] the steps that fire anchor in order, with narration at the default tier`, () => {
          const trace = recordLesson(lesson, config);
          const anchored = anchorLesson(lesson, trace);

          // (1) Steps anchor in non-decreasing trace order (an authoring check, INV-6). Run on
          //     THIS recording: `anchorOrderViolations` skips null anchors, so a step that is
          //     lawfully absent in this position is correctly ignored rather than counted as a
          //     jump backwards.
          expect(anchorOrderViolations(anchored)).toEqual([]);
          // (2) No two steps anchor to the SAME cycle. The play-through's Prev/Next and step-rail
          //     navigate by cursor, and the cursor addresses a whole cycle — it cannot select
          //     between two events within one cycle. So two steps sharing a cycle are not
          //     independently reachable: clicking the earlier one's dot lands on the later
          //     (max-eventIndex) step, and that earlier step's narration can never be shown.
          //     Per-position, for the same reason as (1) — and it genuinely differs per position:
          //     two steps that anchor to distinct cycles with forwarding off can collide with it
          //     on, since removing the interlocks pulls the whole trace tighter.
          const byCycle = new Map<number, number[]>();
          for (const step of anchored) {
            if (step.cycle === null) continue;
            byCycle.set(step.cycle, [...(byCycle.get(step.cycle) ?? []), step.index]);
          }
          const sameCycle = [...byCycle.entries()].filter(([, idxs]) => idxs.length > 1);
          expect(
            sameCycle,
            `steps share a cycle and can't be reached independently by the cursor: ${JSON.stringify(sameCycle)}`,
          ).toEqual([]);
          // (3) Each step has narration resolvable at the lesson's default tier — catches a
          //     mistyped tier key that would otherwise render blank narration. Asserted for EVERY
          //     step, live or not: narration is authored text, not a property of this recording,
          //     so a step that is dead here must still read correctly where it does fire.
          for (const { step } of anchored) {
            expect(
              resolveNarration(step.narration, lesson.depthDefault),
              `"${stepLabel(step)}" has no narration at "${lesson.depthDefault}"`,
            ).toBeDefined();
          }
        });
      }

      it('every step fires in at least one of its model’s config positions', () => {
        // The net for the thing a typo'd trigger and a lawfully-config-exclusive step have in
        // common — both anchor null — and the only place they can be told apart: an unsatisfiable
        // `where` or a misspelled event name is dead EVERYWHERE, while "the bubble vanished" is
        // dead in exactly one position. Single-cycle lessons have one position, so this IS the
        // strict pre-step-8 rule for them.
        const live = new Set<number>();
        for (const { config } of positions) {
          for (const step of anchorLesson(lesson, recordLesson(lesson, config))) {
            if (step.cycle !== null) live.add(step.index);
          }
        }
        const dead = lesson.steps
          .map((step, index) => ({ step, index }))
          .filter(({ index }) => !live.has(index))
          .map(({ step }) => stepLabel(step));
        expect(dead, `never fired in ANY config position: ${dead.join(', ')}`).toEqual([]);
      });

      for (const { label, config } of positions) {
        it(`[${label}] the play-through query surfaces the right narration as the cursor moves`, () => {
          // Close the loop between "steps anchor" and "the runner shows them": exercise
          // activeStepAt / narrationFor (the glue the UI will call) on the real recording.
          const trace = recordLesson(lesson, config);
          const anchored = anchorLesson(lesson, trace);

          // Pre-run (cursor -1): nothing has fired, so no step is active.
          expect(activeStepAt(anchored, -1)).toBeNull();
          expect(narrationFor(anchored, -1, lesson.depthDefault)).toBeUndefined();

          // At the LAST LIVE step's cycle (the greatest anchor — it owns its cycle), the runner
          // surfaces that step's narration. Not `anchored.at(-1)`, which the pre-step-8 version
          // could assume was live: a lesson's final authored step may be dead in this position.
          const last = anchored.filter((a) => a.cycle !== null).at(-1);
          expect(last, `no step fires at all under [${label}]`).toBeDefined();
          expect(activeStepAt(anchored, last!.cycle!)?.index).toBe(last!.index);
          expect(narrationFor(anchored, last!.cycle!, lesson.depthDefault)).toBe(
            resolveNarration(last!.step.narration, lesson.depthDefault),
          );
        });
      }
    });
  }

  // Payload oracles: pin the hand-computed values so a right-type/wrong-occurrence anchor
  // (which still anchors non-null) can't pass. Keyed to the specific authored lessons.
  /**
   * `first-program`'s oracle (M5 step 1) — the track's front door.
   *
   * The three values are the ordinary half. The last two lines are the interesting one: this lesson's
   * closing beat is "there is no `ecall`, so it stops right here", and that claim lives in narration,
   * where nothing guards it. `add.s` is the corpus's only program without an `ecall` — which is
   * exactly why it can carry this beat and why it must not be "fixed" (INV-7: changing it changes it
   * for every model and every differential test).
   *
   * So the halt is pinned as STATE, because it is not an event: the `TraceEvent` union has no `halt`
   * arm, and `pc-out-of-range` is not an instruction the machine executes — it is where the PC ends
   * up. That is why this beat could not be its own step and had to ride on the payoff's narration.
   * `pc: 12` rather than merely `halted: true` is the load-bearing half: it pins that the machine ran
   * OFF THE END of `.text` (3 instructions × 4 bytes), which an `ecall` halt would not do — it leaves
   * the PC on the `ecall` itself. Without the pc, a corpus edit that gave `add.s` an exit would keep
   * this test green while deleting the lesson's subject.
   */
  it('first-program: 5 and 37 arrive, 42 lands in x5 — and it halts on that very cycle', () => {
    const lesson = byId('first-program');
    const trace = recordProgram(lesson.program);
    const anchored = anchorLesson(lesson, trace);

    expect(anchoredEvent(trace, anchored[0]!)).toMatchObject({
      type: 'reg-write',
      reg: 1,
      value: 5,
    });
    expect(anchoredEvent(trace, anchored[1]!)).toMatchObject({
      type: 'reg-write',
      reg: 2,
      value: 37,
    });
    const sum = anchored[2]!;
    expect(anchoredEvent(trace, sum)).toMatchObject({ type: 'reg-write', reg: 5, value: 42 });

    // The halt lands on the SAME cycle as the payoff — which is what makes "the processor stops
    // right here" something the reader WATCHES rather than something the narration asserts.
    expect(trace.find((c) => c.cycle === sum.cycle)!.state).toMatchObject({ halted: true, pc: 12 });
    expect(trace.at(-1)!.cycle, 'the payoff is not the last cycle').toBe(sum.cycle);
  });

  it('sum-loop-tour: loops on bne and a0 ends at 55', () => {
    const lesson = byId('sum-loop-tour');
    const trace = recordProgram(lesson.program);
    const anchored = anchorLesson(lesson, trace);

    const firstAccumulate = anchoredEvent(trace, anchored[2]!);
    expect(firstAccumulate).toMatchObject({ type: 'reg-write', reg: 10, value: 10 });

    const branch = anchoredEvent(trace, anchored[3]!);
    expect(branch).toMatchObject({ type: 'alu-op', op: 'bne', result: 1 });

    const total = anchoredEvent(trace, anchored[4]!);
    expect(total).toMatchObject({ type: 'reg-write', reg: 10, value: 55 });
  });

  /**
   * `sign-and-zero`'s oracle (M5 step 2) — the corpus's orphaned teaching program, finally taught
   * with, and the one place the ISA is genuinely counter-intuitive rather than merely unfamiliar.
   *
   * The three anchored values are the step's acceptance line: −128 and +128 pinned by an oracle
   * rather than by "the step fires". The block under them is the lesson's actual THESIS, and the
   * interesting thing about it is that it could not be a step.
   *
   * **The plan's own anchor sketch was unbuildable, and the reason is this step's finding.** It
   * asked for "`mem-read` ×2 + the two `reg-write`s that differ" — four steps contrasting the raw
   * byte against the extended value. But on single-cycle a load's `mem-read` and its `reg-write`
   * land in the SAME cycle, and the validator forbids two steps sharing one (the cursor addresses a
   * cycle, so they are not independently reachable). Note this is NOT M5 step 1's pigeonhole: that
   * was a COUNT ceiling (four steps over a three-instruction program), and this program has six
   * instructions, so counting was never the binding constraint. It is the narrower rule — the read
   * and the extension are one beat on this machine — and it bites an authoring the count permits.
   *
   * The collapse is a gift rather than a loss. The contrast axis moves from read-vs-write to
   * lb-vs-lbu, which is the lesson the program's own header always claimed to teach, and the reader
   * loses nothing: the cursor sits on a whole cycle, so the step showing −128 shows the `0x80` that
   * came out of memory right beside it.
   *
   * So the thesis — the difference is NOT in memory — lives in narration, where nothing guards it,
   * and is asserted here against the recording instead. This is `forwarding-bubble`'s oracle shape
   * (pin the pcs to prove the lesson points at the right hazard) aimed at the one claim this lesson
   * exists to make.
   */
  it('sign-and-zero: the same byte lands as −128 through lb and +128 through lbu', () => {
    const lesson = byId('sign-and-zero');
    const trace = recordProgram(lesson.program);
    const anchored = anchorLesson(lesson, trace);

    // The address, from `la`'s first half. `la` lowers to `lui` + `addi` (hi/lo relocs on the
    // symbol — `pseudo.ts`), hence `nth: 1`, and hence the two writes to t0 that the lesson's first
    // step has to explain. Note `la` emits the pair even when the low 12 bits are zero, unlike `li`
    // (`materialize32` collapses to a bare `lui` when `lo === 0`) — so the second write genuinely
    // adds nothing, and the value below is already final after the FIRST one.
    //
    // The mnemonic is load-bearing and was wrong in the first draft: the lesson's expert tier said
    // `auipc` (PC-relative), and the transport disassembles this instruction as `lui x5, 0x10000`.
    // Every test here was green either way — the anchor is a `reg-write` and does not care which
    // instruction wrote it — so only the browser could see it. `.data` is based at 0x10000000 and
    // `b` sits at its start, which is why the low half is zero.
    expect(anchoredEvent(trace, anchored[0]!)).toMatchObject({
      type: 'reg-write',
      reg: 5,
      value: 0x10000000,
    });
    // ...and the mnemonic the expert tier NAMES, pinned. Nothing above can see it: the anchor is a
    // `reg-write`, which is agnostic about who wrote it, so the draft's `auipc` claim sat green over
    // a transport reading `lui x5, 0x10000` until someone looked at the screen. Resolved through the
    // recording's own in-flight list rather than by decoding an opcode by hand.
    const mnemonicAt = (cycle: number, pc: number): string | undefined =>
      trace.find((c) => c.cycle === cycle)?.instructions.find((i) => i.pc === pc)?.decoded.mnemonic;
    expect(mnemonicAt(anchored[0]!.cycle!, 0), '`la` lowers to lui + addi, not auipc + addi').toBe(
      'lui',
    );

    // The payoff, and the whole program: 0x80 sign-extends to 0xFFFFFF80 = −128 through `lb`, and
    // zero-extends to 0x00000080 = 128 through `lbu`. Same address, same byte, two answers.
    expect(anchoredEvent(trace, anchored[1]!)).toMatchObject({
      type: 'reg-write',
      reg: 6,
      value: -128,
    });
    expect(anchoredEvent(trace, anchored[2]!)).toMatchObject({
      type: 'reg-write',
      reg: 7,
      value: 128,
    });

    // THE THESIS, and the assertion the acceptance line did not ask for: the two loads issue the
    // IDENTICAL memory read. Same address, same value, and the value is the raw unextended byte —
    // so the −128 above is manufactured on the way to the register file, not fetched. Compared as a
    // whole list rather than pairwise: that also pins there are exactly TWO reads, so a corpus edit
    // adding a third load reddens here instead of quietly sliding a `where`-less trigger.
    //
    // **This is a claim about the TRACE, and the browser showed it is not a claim about the VIEW.**
    // `datapath.ts` drives the Data-Memory output wire from `regWrite.value`, not `memRead.value`
    // (`if (isLoad) w('dmem-wb', regWrite.value, 'dec')`), so on screen that block emits −128 for
    // `lb` and 128 for `lbu` — the two reads look DIFFERENT on the centerpiece view while being
    // identical here. That is lawful rather than a bug: the diagram has no extender box, so the
    // Data-Memory block is the load unit (the Patterson & Hennessy convention) and its output is
    // the instruction's answer. Sourcing the wire from `memRead.value` instead would show 128 into
    // the write-back mux and −128 out of it — a selector that appears to TRANSFORM its input, which
    // is a worse lie, and an always-on one. So the renderer is left alone (the step's "zero renderer
    // changes" bar holds) and the narration reconciles the two surfaces instead: it grounds "same
    // byte, same address" in the two things that ARE visibly constant — the data-memory panel
    // (`0x00000080`, unchanged across all three steps) and the address arriving at Data Memory
    // (`0x10000000` on both loads) — and then names the extension-inside-the-block as the reason the
    // outputs differ. `byte-loads.s` is the only corpus program where `mem-read.value` and
    // `reg-write.value` disagree at all (every other load is an `lw`), which is why nothing has ever
    // had to decide this, and why only a lesson ON THIS PROGRAM could surface it.
    const reads = trace
      .flatMap((c) => c.events)
      .flatMap((e) => (e.type === 'mem-read' ? [{ addr: e.addr, value: e.value }] : []));
    expect(reads).toEqual([
      { addr: 0x10000000, value: 128 },
      { addr: 0x10000000, value: 128 },
    ]);
  });

  /**
   * `which-is-smaller`'s oracle (M5 step 3) — the mirror of `sign-and-zero`, and the reason step 3
   * needed a new corpus program at all.
   *
   * **Why `call-return` could not carry this.** The plan recommended trying it first. Its `bge a0,
   * a1, done` is already anchored AND narrated by `function-call`'s third step ("17 is not >= 42, so
   * the branch is not taken"), and taken-vs-not-taken is already narrated by `sum-loop-tour`'s steps
   * 4 and 5. So the only non-duplicative content left in "branches as a decision" is the signed/
   * unsigned trap — and that is not tellable on the old corpus for a reason stronger than preference:
   * its three conditional branches are `bnez` twice (against zero) and one `bge` on 17 vs 42, so for
   * every operand the corpus ever compared, `blt` and `bltu` return the SAME answer. The trap was
   * definitionally invisible. `branch-flavors.s` is the corpus's first branch whose two readings
   * disagree, and its first use of any branch but `bne`/`bge`.
   *
   * **The thesis, and the mirror.** `sign-and-zero` is "looks different, is same": the datapath shows
   * the Data-Memory block emitting −128 then 128 while the trace's two `mem-read`s are byte-identical.
   * This lesson is the opposite shape — "looks same, is different". The two branch events below carry
   * IDENTICAL operands and opposite results, so the reader sees one comparison answered two ways with
   * nothing on screen to explain it. That is not a defect anywhere: trace, wires and panel all agree.
   * -1 and 4294967295 are the same 32 bits, and the engines record operands in their signed int32
   * spelling throughout (`alu` does `a: a | 0` in all three tracing models) — so nothing is lost, and
   * `>>> 0` recovers the unsigned reading at any time.
   *
   * **There is simply no wire to show it on.** The unsigned reading is applied inside the comparator,
   * exactly as sign-extension is applied inside the load unit, and the datapath draws neither as a
   * box. The only wire that could carry 4294967295 is `regfile-rs1`, which is sourced from `reg-read`
   * — the register file's own output — and a register file that re-spelled its contents by the
   * signedness of whoever was reading would appear to TRANSFORM its output. That is the identical
   * argument step 2 used to leave `dmem-wb` alone, arrived at from the opposite direction, and it is
   * why this step ships zero engine and zero renderer changes. The narration reconciles instead: it
   * grounds the claim in the `0xffffffff` the register panel visibly shows and names the mnemonic as
   * the only thing on screen that differs. (Note `u(rs1)` in the engines' `bltu`/`bgeu` arms does not
   * survive `| 0` into the recorded operand — so `alu('bltu', u(..), ..)` and `alu('bltu', s(..), ..)`
   * emit the same event. Harmless, since the bits are the bits, but it is why the "obvious" fix of
   * dropping the `| 0` looks available and is not: it would put a reading on a wire.)
   *
   * The pin below is deliberately a tripwire. If anyone ever drops that `| 0`, the operands stop
   * matching and this reddens — dragging them back to this lesson, which is exactly the conversation
   * that should happen before the datapath starts spelling registers differently per reader.
   */
  it('which-is-smaller: the SAME operands, compared two ways, decide opposite', () => {
    const lesson = byId('which-is-smaller');
    const trace = recordProgram(lesson.program);
    const anchored = anchorLesson(lesson, trace);

    // The bits, arriving. The panel prints `0xffffffff` and `-1` on this row; the lesson's first
    // step is about that pair, so pin the value the panel is spelling.
    expect(anchoredEvent(trace, anchored[0]!)).toMatchObject({
      type: 'reg-write',
      reg: 5,
      value: -1,
    });

    // THE THESIS, as an assertion: two branch compares, identical operands, opposite verdicts.
    // `result` is the taken flag (cf. sum-loop-tour's `bne` oracle), so this pins the control flow
    // too: the signed branch goes, the unsigned one does not.
    const signed = anchoredEvent(trace, anchored[1]!);
    const unsigned = anchoredEvent(trace, anchored[2]!);
    expect(signed).toMatchObject({ type: 'alu-op', op: 'blt', a: -1, b: 1, result: 1 });
    expect(unsigned).toMatchObject({ type: 'alu-op', op: 'bltu', a: -1, b: 1, result: 0 });
    // Narrowed rather than asserted-through: `anchoredEvent` returns the union, and the operand
    // arithmetic below is the point of this test, so it should be typed rather than cast.
    if (signed.type !== 'alu-op' || unsigned.type !== 'alu-op') {
      throw new Error('both branch steps must anchor to an alu-op');
    }

    // ...and said as the one claim the narration actually makes: the operands are indistinguishable,
    // and ONLY the mnemonic and the verdict differ. Written as a whole-object compare rather than
    // field-by-field so a new operand field could not quietly slip between the two.
    expect({ a: signed.a, b: signed.b }).toEqual({ a: unsigned.a, b: unsigned.b });
    expect(signed.result).not.toBe(unsigned.result);

    // The unsigned reading the narration supplies, and the reason the verdict is lawful: the same
    // bits the panel spells `-1` are 4294967295 unsigned, which is NOT less than 1. Recovered with
    // `>>> 0` — the trace is lossless here, which is the half of the finding that says the engines
    // need no change.
    expect(unsigned.a >>> 0).toBe(4294967295);
    expect(unsigned.a >>> 0 < unsigned.b >>> 0, 'unsigned: 4294967295 < 1 is false').toBe(false);
    expect(signed.a < signed.b, 'signed: -1 < 1 is true').toBe(true);

    // The payoff: the fall-through corrects the guess, so the two answers end up side by side in the
    // register panel. Both are min(t0, t1) — under different readings of the same bits.
    expect(anchoredEvent(trace, anchored[3]!)).toMatchObject({
      type: 'reg-write',
      reg: 11,
      value: 1,
    });
    const final = trace.at(-1)!.state;
    expect([final.registers[10], final.registers[11]], 'signed min, then unsigned min').toEqual([
      -1, 1,
    ]);
  });

  it('array-in-memory: loads a negative element and stores the total 120', () => {
    const lesson = byId('array-in-memory');
    const trace = recordProgram(lesson.program);
    const anchored = anchorLesson(lesson, trace);

    expect(anchoredEvent(trace, anchored[0]!)).toMatchObject({ type: 'mem-read', value: 5 });
    expect(anchoredEvent(trace, anchored[1]!)).toMatchObject({ type: 'mem-read', value: -4 });
    expect(anchoredEvent(trace, anchored[2]!)).toMatchObject({
      type: 'reg-write',
      reg: 10,
      value: 120,
    });
    expect(anchoredEvent(trace, anchored[3]!)).toMatchObject({ type: 'mem-write', value: 120 });
  });

  it('function-call: jal saves ra, bge picks the arg, s0 = 42', () => {
    const lesson = byId('function-call');
    const trace = recordProgram(lesson.program);
    const anchored = anchorLesson(lesson, trace);

    expect(anchoredEvent(trace, anchored[0]!)).toMatchObject({
      type: 'reg-write',
      reg: 10,
      value: 17,
    });
    // ra = PC(jal) + 4. jal is the 3rd instruction word, at 0x8 → ra = 0xC.
    expect(anchoredEvent(trace, anchored[1]!)).toMatchObject({
      type: 'reg-write',
      reg: 1,
      value: 12,
    });
    expect(anchoredEvent(trace, anchored[2]!)).toMatchObject({
      type: 'alu-op',
      op: 'bge',
      result: 0,
    });
    expect(anchoredEvent(trace, anchored[3]!)).toMatchObject({
      type: 'reg-write',
      reg: 8,
      value: 42,
    });
  });

  /**
   * The hand-off's promise, replayed (M5 step 5) — the language track's closing beat sends the
   * reader to the editor with a CONCRETE claim: make the 17 bigger than 42 and `max` returns your
   * number instead of 42, because the `bge` the reader just watched fall through is taken instead
   * and `mv a0, a1` never runs.
   *
   * **Nothing else in this file can see that claim, and the reason is the README's rule.** An
   * anchor pins a TRANSACTION, never the sentence wrapped around it: the step above anchors the
   * `reg-write` of 42 — the UN-edited run — and is agnostic about a program that does not exist.
   * Every other oracle here drives `EXAMPLE_PROGRAMS`, and this claim is a COUNTERFACTUAL, the
   * first narration in the corpus to promise something about a run the reader has to make. So it
   * is unguarded by construction and gets a line here only because someone thought to write one —
   * exactly the case `sign-and-zero`'s mnemonic oracle was the pattern for.
   *
   * Driven the way the READER will drive it: `loadSource` over edited text is the same path
   * `loadEdited` takes on the fork (`useSimulator`), so this is the reader's edit, not a
   * simulation of it.
   *
   * Asserted on the three clauses the narration actually makes, and NOT on the pcs. 99 keeps
   * `li` a single word (it fits the 12-bit immediate), so the layout happens to survive — but a
   * reader is invited to type ANY number above 42, and a big one expands `li` to `lui`+`addi` and
   * shifts every pc by 4. The narration promises nothing about addresses, so neither does this.
   */
  it('function-call hand-off: a number above 42 comes back instead of 42', () => {
    const program = EXAMPLE_PROGRAMS.find((p) => p.name === 'call-return');
    expect(program, 'call-return is in the corpus').toBeDefined();
    // The reader's edit, on the one line the narration names.
    const edited = program!.source.replace('li   a0, 17', 'li   a0, 99');
    expect(edited, 'the narrated line still exists to edit').not.toBe(program!.source);

    const result = loadSource(edited);
    expect(result.ok, 'the edited program should assemble').toBe(true);
    if (!result.ok) throw new Error('unreachable: assembly failed');
    result.loaded.recorder.runToEnd();
    const events = result.loaded.recorder.recorded.flatMap((c) => c.events);

    // "max returns your number": s0 (x8) is the reader's 99, not the shipped 42.
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'reg-write', reg: 8, value: 99 }),
    );
    // "the bge you just watched fall through is taken instead": result flips 0 -> 1.
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'alu-op', op: 'bge', result: 1 }),
    );
    // "and the mv a0, a1 never runs": that line, and only that line, writes 42 into a0 (x10).
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: 'reg-write', reg: 10, value: 42 }),
    );
  });
});

/**
 * The lessons whose steps anchor to purely ARCHITECTURAL events (`instr-fetch`, `reg-write`,
 * `mem-read`, `alu-op`) — i.e. things every model in the family does. Those, and only those, can be
 * carried across microarchitectures unchanged, which is what the two cross-model suites below
 * assert. Keyed off the declared model rather than a hand-kept id list: a single-cycle lesson
 * CANNOT anchor to a hazard event, because single-cycle emits none, so "authored against
 * single-cycle" and "anchors only to architectural events" are the same set by construction.
 *
 * `forwarding-bubble` is deliberately outside it. It is not that the suites below would be nice to
 * have for it and are merely skipped — they are false about it: its subject is `stall`/`forward`,
 * which single-cycle and multi-cycle never emit, so "every step still anchors" is precisely the
 * claim that does not hold, and should not. That is what makes it a PIPELINE lesson rather than a
 * lesson that happens to be read on the pipeline.
 */
const PORTABLE_LESSONS = LESSONS.filter((l) => l.model === 'single-cycle');

/**
 * INV-6 across models (M2 step 5a): "lessons anchor to trace EVENTS, not cycle numbers." The
 * portable lessons target single-cycle, but the whole point of anchoring to events is that the
 * SAME lesson plays against a different microarchitecture unchanged — the multi-cycle engine
 * emits the same events, merely spread across more cycles (a load's `mem-read` and its
 * `reg-write` now land in different phase-cycles instead of one). So switching the model in the
 * picker must NOT strand a lesson: every step still anchors, in order, with resolvable narration,
 * and the play-through query still surfaces it. This is the graceful-degradation guarantee the
 * picker leans on — proven here directly rather than assumed.
 *
 * Note what this does and does not buy, which M3 step 8 had to get precise about: it proves the
 * ANCHORS survive a model swap, not that the NARRATION stays true. `sum-loop-tour` tells the user
 * its add is "written back to a0 in the same cycle" — true on single-cycle, false on both other
 * models, and no anchoring test can see that. Anchoring is not truth. That is why `startLesson`
 * opens a lesson on the model it was authored against (M3 step 8) rather than leaving it wherever
 * the picker happened to be.
 */
describe('authored lessons play against multi-cycle too (INV-6 cross-model)', () => {
  for (const lesson of PORTABLE_LESSONS) {
    it(`${lesson.id}: every step still anchors under multi-cycle, in order, with narration`, () => {
      const trace = recordProgramMultiCycle(lesson.program);
      const anchored = anchorLesson(lesson, trace);

      // No step is stranded by the model swap (the crux: events, not cycles).
      for (const step of anchored) {
        expect(
          step.cycle,
          `"${stepLabel(step.step)}" never fired under multi-cycle`,
        ).not.toBeNull();
      }
      // Program-order anchoring survives the phase-spread (events still occur in the same order).
      expect(anchorOrderViolations(anchored)).toEqual([]);
      // Narration still resolves at the default tier.
      for (const { step } of anchored) {
        expect(resolveNarration(step.narration, lesson.depthDefault)).toBeDefined();
      }

      // The play-through query the UI calls still lands on the final step.
      const last = anchored[anchored.length - 1]!;
      expect(activeStepAt(anchored, last.cycle!)?.index).toBe(last.index);
      expect(narrationFor(anchored, last.cycle!, lesson.depthDefault)).toBe(
        resolveNarration(last.step.narration, lesson.depthDefault),
      );
    });
  }
});

/**
 * INV-6 across CONFIGS (M3 step 5) — the acceptance line "lessons still anchor in order across a
 * config swap". The multi-cycle suite above proved a lesson survives a MODEL swap; the pipeline is
 * the first model whose trace depends on its CONFIG, so the forwarding toggle is the first thing
 * that can move a lesson's anchors WITHOUT changing the model. That is the exact scenario INV-6
 * exists for — anchor to events, not cycle numbers — and the toggle is a control the user can flip
 * mid-lesson, so a stranded step here would be a shipped bug, not a hypothetical.
 *
 * Note the pipeline emits event types nothing before it did (`forward`/`stall`/`flush`/
 * `branch-resolved`) and fetches instructions that are later squashed. Neither perturbs these
 * lessons' `nth` counts: the anchored events are architectural (`reg-write`/`mem-*` fire only from
 * a non-squashed WB/MEM, and a flush kills its casualties before EX, so no squashed instruction
 * ever emits an `alu-op`), and the one `instr-fetch` anchor is `nth: 1` — instruction #0, which is
 * fetched before anything can flush it.
 */
describe('authored lessons play against the pipeline, in BOTH forwarding positions (INV-6)', () => {
  const POSITIONS = [
    { label: 'forwarding off', forwarding: false },
    { label: 'forwarding on', forwarding: true },
  ] as const;

  for (const lesson of PORTABLE_LESSONS) {
    for (const { label, forwarding } of POSITIONS) {
      it(`${lesson.id}: every step anchors under the pipeline [${label}], in order, with narration`, () => {
        const trace = recordProgramPipeline(lesson.program, forwarding);
        const anchored = anchorLesson(lesson, trace);

        for (const step of anchored) {
          expect(
            step.cycle,
            `"${stepLabel(step.step)}" never fired under the pipeline [${label}]`,
          ).not.toBeNull();
        }
        expect(anchorOrderViolations(anchored)).toEqual([]);
        for (const { step } of anchored) {
          expect(resolveNarration(step.narration, lesson.depthDefault)).toBeDefined();
        }

        const last = anchored[anchored.length - 1]!;
        expect(activeStepAt(anchored, last.cycle!)?.index).toBe(last.index);
        expect(narrationFor(anchored, last.cycle!, lesson.depthDefault)).toBe(
          resolveNarration(last.step.narration, lesson.depthDefault),
        );
      });
    }

    /**
     * The invariant stated precisely: flipping the toggle changes WHEN a step fires, never WHAT it
     * fires on. Compares the anchored event payload itself rather than merely "it anchored" — a
     * step that silently slid onto a different occurrence of the same event type (right type, wrong
     * event) still anchors non-null and would pass the tests above.
     *
     * `instr` is stripped: ids are minted per fetch, and the two positions fetch a different number
     * of doomed shadow instructions, so the ids legitimately differ. The id is the one field of an
     * event that is about the RUN rather than about what the machine did.
     */
    it(`${lesson.id}: the toggle changes when a step fires, never what it fires on`, () => {
      const off = recordProgramPipeline(lesson.program, false);
      const on = recordProgramPipeline(lesson.program, true);
      // Not a destructure: `instr` is not on every arm of the union (a `flush` names its casualties
      // in `stages` and carries no single instruction), so it is deleted where present instead.
      const withoutId = (e: TraceEvent): Record<string, unknown> => {
        const rest: Record<string, unknown> = { ...e };
        delete rest['instr'];
        return rest;
      };

      const payloads = (trace: readonly CycleTrace[]): Record<string, unknown>[] =>
        anchorLesson(lesson, trace).map((a) => withoutId(anchoredEvent(trace, a)));

      expect(payloads(on)).toEqual(payloads(off));
    });
  }

  /**
   * Non-vacuity, and the crown jewel at the lesson layer. Everything above would pass trivially if
   * the config were ignored and both positions recorded the identical trace — so pin that the
   * anchors genuinely MOVE: `sum-loop-tour`'s final step (a0 = 55) lands on a strictly earlier
   * cycle with forwarding on, because the interlocks it waited on are gone. Same lesson, same
   * event, different cycle: INV-6's whole reason to exist, and the reason a lesson can be authored
   * once and survive a control the user flips underneath it.
   *
   * Deliberately asserted on `sum-loop` and NOT across the corpus: step 3 measured that
   * `call-return` (which backs the `function-call` lesson) takes 17 cycles in BOTH positions —
   * every RAW in it already sits behind a flush gap — so its anchors do not move at all, and a
   * blanket "every lesson shifts" claim would be false about the corpus we ship.
   */
  it('a lesson step anchors to an EARLIER cycle with forwarding on (and the same event)', () => {
    const lesson = byId('sum-loop-tour');
    const off = recordProgramPipeline(lesson.program, false);
    const on = recordProgramPipeline(lesson.program, true);

    const lastOff = anchorLesson(lesson, off).at(-1)!;
    const lastOn = anchorLesson(lesson, on).at(-1)!;

    expect(lastOn.cycle).toBeLessThan(lastOff.cycle!);
    // ...and it is still the same event: a0 reaching the total, 55.
    for (const [trace, anchored] of [
      [off, lastOff],
      [on, lastOn],
    ] as const) {
      expect(anchoredEvent(trace, anchored)).toMatchObject({
        type: 'reg-write',
        reg: 10,
        value: 55,
      });
    }
  });
});

/**
 * `forwarding-bubble`'s own oracle — the M3 flagship (step 8), and the assertions the generic sweep
 * above structurally cannot make.
 *
 * That sweep proves each step fires SOMEWHERE and that the survivors read in order. It cannot prove
 * the lesson points at the RIGHT hazard, because every trigger below is satisfiable by more than one
 * of them — `array-sum` stalls at three distinct pcs. So the pedagogy is asserted positively, by
 * name, and in both directions: what fires here, and what must NOT.
 *
 * The gap is not hypothetical; it was measured by mutation, and the specific one is worth recording
 * because it is the trigger a reasonable author would reach for FIRST. Weaken the load-use step from
 * `nth: 3` to `nth: 1` and it slides off `add a0, a0, t2` onto the `la` pseudo-op's hidden internal
 * RAW two stalls earlier. Every generic check stays green — it is a real `raw` stall, alive off,
 * dead on, in order, narrated — and the lesson now tells the user that `lw`/`add` is the hazard
 * while pointing the cursor at an `la`. Exactly one assertion fails, here, with `expected 4 to be
 * 20`: the pc. (A too-LOOSE trigger, by contrast, is caught twice over — dropping a `where` slides
 * a step onto the other config's stalls, which land out of order and trip the sweep as well.)
 *
 * The claims, which are the spec's flagship experiment (§12.2) restated as tests:
 *
 *  1. The bubble VANISHES. `bnez t1, loop` interlocks with forwarding off and does not with it on —
 *     the same source line, its stall replaced by a forward.
 *  2. The bubble that CANNOT vanish. `add a0, a0, t2` stalls in BOTH positions — but on different
 *     terms: two cycles as a plain interlock, one as a `load-use`. This is the beat most courses
 *     fumble, and the reason `array-sum` is the only corpus program that can carry this lesson.
 *  3. Same answer, fewer cycles — the crown jewel, at the lesson layer.
 *
 * Both hazards are pinned by the PC they stall at, resolved through the recording's own
 * `instr-fetch` events. A stall names its instruction by id and ids are minted per fetch, so they
 * are meaningless across two recordings; the pc is what identifies a hazard as "that source line",
 * and it is the difference between pinning the lesson's subject and pinning its arithmetic. This
 * is what makes the `nth` counts reviewable: `nth: 3` is a claim about which hazard, not a number
 * read off a run — and if the `la` pseudo-op ahead of them ever stops emitting the first two
 * stalls, these fail loudly instead of sliding onto a different instruction.
 */
describe('forwarding-bubble — the flagship experiment (M3 step 8)', () => {
  const LOAD_USE_PC = 20; // `add a0, a0, t2` — reads the t2 that `lw t2, 0(t0)` is still fetching
  const BRANCH_RAW_PC = 32; // `bnez t1, loop` — reads the t1 that `addi t1, t1, -1` just wrote

  const lesson = (): Lesson => byId('forwarding-bubble');

  /**
   * The lesson's OWN declared machine, with the single knob it is about varied — program, model and
   * every other knob DERIVED from the declaration rather than restated here (M4 step 4).
   *
   * This read `recordProgramPipeline('array-sum', forwarding)`, which quietly meant
   * `{...defaultConfig(), forwarding}` — i.e. it pinned the narration's cycle counts under an
   * IMPLICIT predict-not-taken. True, and true by luck: nothing tied it to what the lesson declares,
   * so the moment the lesson's machine changed, the numbers this file swears the narration states
   * "as fact" would have gone on passing while the shipped prose went false. That is the `2·T` trap
   * exactly — specific, in a place that reads as general — one layer up from where step 3 found it.
   */
  const record = (forwarding: boolean): readonly CycleTrace[] => {
    const declared = lesson().config;
    if (!declared)
      throw new Error('forwarding-bubble must declare the machine its prose describes');
    return recordLesson(lesson(), { ...declared, forwarding });
  };

  it('opens on the pipeline, with forwarding OFF — stall first, then flip', () => {
    // The lesson's declared opening position, which `startLesson` applies (M3 step 8). Off is not
    // an arbitrary default: the experiment only reads as an experiment if the user sees the machine
    // wait BEFORE they are shown the fix (§12.2), and the lesson's first two beats are the stalls.
    expect(lesson().model).toBe('pipeline');
    expect(lesson().config?.forwarding).toBe(false);
  });

  it('pins its CONTROL knob too, because its closing narration quotes cycle counts', () => {
    // The declaration M4 step 4 removed and put back, and the reason is the whole finding: this
    // lesson's last step says "72 cycles with forwarding off, 51 with it on" as FACT. Those numbers
    // are properties of the WHOLE machine — under `static-taken` the same program runs 70 and 49 —
    // so a lesson quoting them must pin prediction even though prediction is not its subject.
    // Without this the shell parks the user on whatever scheme they last chose, and the prose lies.
    expect(predictsTaken(lesson().config!.branchPrediction)).toBe(false);
  });

  it('THE BUBBLE VANISHES: the branch interlocks with forwarding off, and forwards with it on', () => {
    const [off, on] = [record(false), record(true)];
    const [anchoredOff, anchoredOn] = [anchorLesson(lesson(), off), anchorLesson(lesson(), on)];

    // Step 2 is the branch interlock. Alive with forwarding off, and on the branch — not on the
    // `la` two stalls earlier, which is what a slipped `nth` would silently give us.
    const interlock = anchoredOff[2]!;
    expect(anchoredEvent(off, interlock)).toMatchObject({ type: 'stall', reason: 'raw' });
    expect(anchoredPc(off, interlock)).toBe(BRANCH_RAW_PC);

    // ...and DEAD with forwarding on. This is the vanishing, asserted: there is no `raw` interlock
    // left in the entire recording for the lesson's trigger to find.
    expect(anchoredOn[2]!.cycle, 'the branch still interlocks with forwarding on').toBeNull();

    // What replaced it, on the same source line: step 4, the forward. Dead off (no forwarding
    // network exists), alive on, and naming the branch.
    expect(anchoredOff[4]!.cycle, 'a forward fired with forwarding OFF').toBeNull();
    const forwarded = anchoredOn[4]!;
    expect(anchoredEvent(on, forwarded)).toMatchObject({ type: 'forward', to: 'EX.rs1' });
    expect(anchoredPc(on, forwarded)).toBe(BRANCH_RAW_PC);
  });

  it('THE BUBBLE THAT CANNOT: the load-use add stalls in BOTH positions, on different terms', () => {
    const [off, on] = [record(false), record(true)];
    const [anchoredOff, anchoredOn] = [anchorLesson(lesson(), off), anchorLesson(lesson(), on)];

    // Off: step 1 finds it as a plain interlock — indistinguishable, at this point, from the
    // branch's. That is the lesson's setup: both look like the same bubble.
    const interlocked = anchoredOff[1]!;
    expect(anchoredEvent(off, interlocked)).toMatchObject({ type: 'stall', reason: 'raw' });
    expect(anchoredPc(off, interlocked)).toBe(LOAD_USE_PC);

    // On: step 3 finds the SAME source line still stalling, now named for its real cause. The two
    // steps are different triggers precisely because the event is different — which is the pinned
    // vocabulary (`'load-use'` fires only with forwarding on; with it off the general interlock
    // subsumes it and honestly reports `'raw'`), and is why one step could not serve both.
    const survivor = anchoredOn[3]!;
    expect(anchoredEvent(on, survivor)).toMatchObject({ type: 'stall', reason: 'load-use' });
    expect(anchoredPc(on, survivor)).toBe(LOAD_USE_PC);

    // The payoff, and the reason this beat exists: the bubble did not vanish, it SHRANK. Counting
    // the stall events on that pc per loop iteration: two cycles of interlock become one.
    const stallsAt = (trace: readonly CycleTrace[], pc: number): number => {
      const pcs = pcById(trace);
      return trace
        .flatMap((c) => c.events)
        .filter((e) => e.type === 'stall' && pcs.get(e.instr) === pc).length;
    };
    // 5 array elements: 2 cycles each off (10), 1 each on (5).
    expect(stallsAt(off, LOAD_USE_PC)).toBe(10);
    expect(stallsAt(on, LOAD_USE_PC)).toBe(5);
    // The branch, beside it, goes to zero — the contrast the lesson is built on, in one comparison.
    expect(stallsAt(off, BRANCH_RAW_PC)).toBe(10);
    expect(stallsAt(on, BRANCH_RAW_PC)).toBe(0);
  });

  it('same answer, fewer cycles: the total is 120 either way (72 → 51)', () => {
    const [off, on] = [record(false), record(true)];
    // The lesson's last step, alive in both — it is what the program computed, not how it ran.
    for (const trace of [off, on]) {
      const last = anchorLesson(lesson(), trace).at(-1)!;
      expect(anchoredEvent(trace, last)).toMatchObject({ type: 'mem-write', value: 120 });
    }
    // ...and step 3's pinned corpus timing, which the lesson's closing narration quotes. Asserted
    // here rather than trusted: the narration states these numbers to the user as fact.
    //
    // They are facts about the lesson's DECLARED machine, not about the program (M4 step 4): under
    // `static-taken` this same pair is 70 and 49. `record` now derives the scheme from the lesson,
    // so these two numbers and the shipped prose cannot drift apart without this line going red.
    expect(off.length).toBe(72);
    expect(on.length).toBe(51);
  });
});

/**
 * `branch-bet`'s own oracle — the M4 flagship (step 7), and the milestone's thesis made guided.
 *
 * The lesson is `forwarding-bubble`'s structure one knob over: its steps are CONFIG-EXCLUSIVE, and
 * that is the lesson. `branch-predicted` fires only under `static-taken` (a not-taken machine places
 * no bet — the fall-through IS the not-taken path, so there is no action to report), so a lesson
 * about a bet MUST have steps dead in one position. Nothing here needed a new lesson-format field,
 * an engine change, or a renderer change; the generic sweep above covered the new prediction axis
 * with **no special case**, which was step 7's acceptance line and which held on the first run.
 *
 * ## Why `call-return`, and why it is forced
 *
 * The same test M3 applied to `array-sum`: it is the only corpus program that carries the whole
 * story on source-visible lines. `transfers: { takenPredictable: 1, notTaken: 1, takenUnpredictable:
 * 1 }` — one of each kind the machine can face, three lines, nine instructions:
 *
 *   - `jal ra, max` (pc 8) — PC-relative and always taken. The bet WINS: 2 cycles → 1.
 *   - `bge a0, a1, done` (pc 24) — `17 >= 42` is false, so it never goes. The bet LOSES: 0 → 2.
 *   - `ret` (pc 32) — a `jalr`, target in a register ID has not read. NO scheme can bet: 2 → 2.
 *
 * Signed, that is −1 + 2 + 0 = **+1**, and it is step 3's pinned `call-return` regression (17 → 18)
 * decomposed onto the three lines that produce it. The lesson is the only surface where the thesis
 * "no scheme dominates" is a claim about instructions rather than about a total.
 *
 * ## What this oracle sees that the sweep cannot — measured, and not what was predicted
 *
 * The natural trigger SLIDES, exactly as M3's `nth: 3 → 1` did: `where: { predicted: false, actual:
 * true }` lands on the `jal` under not-taken and on the `ret` under `static-taken` — alive in both,
 * narrated, about a different instruction in each. `predicted` is a property of the SCHEME, so any
 * trigger keyed on it means something different in each position. So each step is keyed on `target`
 * instead — the branch unit's own answer, which is architectural and therefore scheme-independent.
 *
 * **But the claim that the sweep is blind to that slide was FALSE, and it was worth measuring rather
 * than asserting.** Run as a mutation, it fails three tests: the oracle below, and the sweep's ORDER
 * check in both taken positions (`expected [2, 4, 5] to deeply equal []`). The reason is a property
 * of this lesson rather than of the validator — its config-exclusive steps INTERLEAVE in trace order
 * (the not-taken beat about a branch sits between the taken beats about the same branch), so a slid
 * step overshoots its neighbours and trips the order guard. `forwarding-bubble`'s slide stayed in
 * order and was invisible. Structure, not vigilance, caught this one.
 *
 * **The mutation the sweep genuinely cannot see is a different one, and it is the sharper finding.**
 * Weaken the `ret` step (index 6) from `{ target: 12 }` to `nth: 2, { predicted: false, actual: true
 * }`. Under not-taken that is exactly right — the `jal` mispredicts first, the `ret` second. Under
 * `static-taken` the `jal` is predicted correctly, so the `ret` becomes the FIRST such event, `nth:
 * 2` matches nothing, and the step silently DIES — deleting "no scheme can bet on a `ret`" from the
 * rail in precisely the position where it is the punchline. The whole sweep stays green: the step is
 * alive under not-taken, which is all "fires in at least one position" asks. Exactly one test fails,
 * the one below, with `step 6 never fired`.
 *
 * That is the price of the config-exclusive licence, stated plainly: once "a step may lawfully be
 * dead in a position" is legal (M3 step 8, and this lesson needs it more than that one did), DEAD
 * and LAWFULLY DEAD stop being distinguishable to a generic rule. Nothing derivable can close that
 * gap — which position a step is *meant* to be dead in is pedagogy, and pedagogy is not in the
 * trace. It has to be asserted by name, per scheme, which is what this block is.
 *
 * Each step is therefore keyed on `target` — architectural and
 * therefore scheme-independent, unlike `predicted`. **And the two targets on one branch are not
 * interchangeable, which is the trap worth recording:** `bge` BETS on `0x20` (`done`, its taken
 * target) and RESOLVES to `0x1C` (its fall-through). One instruction, two events, two different
 * targets — a step keyed on the wrong one is dead, and a `where` naming both is unsatisfiable. Each
 * step is filtered on the target belonging to the event it anchors to.
 */
describe('branch-bet — the milestone’s thesis, guided (M4 step 7)', () => {
  const JAL_PC = 8; // `jal ra, max` — always taken, and PC-relative, so ID can bet on it
  const BGE_PC = 24; // `bge a0, a1, done` — 17 >= 42 is false, so it never goes
  const RET_PC = 32; // `ret` = `jalr x0, 0(ra)` — target in a register; unpredictable by construction

  const lesson = (): Lesson => byId('branch-bet');

  /**
   * The lesson's own declared machine with the one knob it is ABOUT varied — program, model and the
   * other knobs derived from the declaration rather than restated (M4 step 4's finding: a lesson's
   * numbers are properties of a whole machine, so a helper that quietly substitutes `defaultConfig()`
   * pins the prose under a machine nothing ties to the lesson).
   */
  const record = (scheme: 'static-not-taken' | 'static-taken'): readonly CycleTrace[] => {
    const declared = lesson().config;
    if (!declared) throw new Error('branch-bet must declare the machine its prose describes');
    return recordLesson(lesson(), { ...declared, branchPrediction: scheme });
  };

  it('opens on the pipeline predicting NOT-taken — the baseline, before the bet', () => {
    // The experiment only reads as an experiment if the user sees the machine WITHOUT the idea
    // first (M3 step 8's reasoning for opening forwarding-off). Not-taken is also `defaultConfig()`
    // and the machine M3 shipped, so the lesson starts from what the user already has.
    expect(lesson().model).toBe('pipeline');
    expect(predictsTaken(lesson().config!.branchPrediction)).toBe(false);
  });

  it('THE BET WINS: jal mispredicts under not-taken, and is bet on correctly under taken', () => {
    const [nt, taken] = [record('static-not-taken'), record('static-taken')];
    const [aNt, aTaken] = [anchorLesson(lesson(), nt), anchorLesson(lesson(), taken)];

    // Step 1 — the fall-through guess, wrong on a jump that always goes. Alive not-taken, and on
    // the JAL: `{ predicted: false, actual: true }` alone would slide onto the `ret` under the
    // other scheme, which is why the trigger keys on the target instead.
    expect(anchoredEvent(nt, aNt[1]!)).toMatchObject({
      type: 'branch-resolved',
      predicted: false,
      actual: true,
    });
    expect(anchoredPc(nt, aNt[1]!)).toBe(JAL_PC);
    expect(aTaken[1]!.cycle, 'the jal still mispredicts under static-taken').toBeNull();

    // Step 2 — the BET, and it is an ACTION in ID, not a field on the resolution. Dead under
    // not-taken because no bet is placed there at all: the fall-through IS the not-taken path.
    expect(aNt[2]!.cycle, 'a bet was placed by a machine that predicts not-taken').toBeNull();
    expect(anchoredEvent(taken, aTaken[2]!)).toMatchObject({
      type: 'branch-predicted',
      target: 24, // `max:` — pc + imm, computed in ID
    });
    expect(anchoredPc(taken, aTaken[2]!)).toBe(JAL_PC);

    // The payoff the narration claims: the bet is placed BEFORE the answer exists, so it costs one
    // cycle where the same jump cost two. Asserted as the gap between the two events, not as a
    // number read off a run: EX resolves the jal in the same cycle under both schemes.
    const resolveCycle = (trace: readonly CycleTrace[]): number =>
      trace.find((c) => c.events.some((e) => e.type === 'branch-resolved' && e.target === 24))!
        .cycle;
    expect(aTaken[2]!.cycle, 'the bet lands one cycle before EX resolves it').toBe(
      resolveCycle(taken) - 1,
    );
    expect(resolveCycle(nt)).toBe(resolveCycle(taken));
  });

  it('THE BET LOSES: bge is free under not-taken and costs two cycles under taken', () => {
    const [nt, taken] = [record('static-not-taken'), record('static-taken')];
    const [aNt, aTaken] = [anchorLesson(lesson(), nt), anchorLesson(lesson(), taken)];

    // Step 3 — being right is FREE, and it is the beat that makes the regression legible: this is
    // the branch the taken machine is about to lose two cycles on. `predicted: false, actual: false`
    // is the only case in the machine with no redirect and no flush.
    const free = aNt[3]!;
    expect(anchoredEvent(nt, free)).toMatchObject({
      type: 'branch-resolved',
      predicted: false,
      actual: false,
    });
    expect(anchoredPc(nt, free)).toBe(BGE_PC);
    expect(
      nt.find((c) => c.cycle === free.cycle)!.events.some((e) => e.type === 'flush'),
      'a correct not-taken prediction cost something',
    ).toBe(false);
    expect(aTaken[3]!.cycle, 'the taken machine also guessed bge would fall through').toBeNull();

    // Steps 4 and 5 — the bet, then the correction. Both dead under not-taken.
    for (const index of [4, 5]) {
      expect(aNt[index]!.cycle, `step ${index} fired on a machine that places no bets`).toBeNull();
    }

    // Step 4 bets on the TARGET — `done` at 0x20. A static scheme has no history: `bge` and `jal`
    // are the same thing to it, a PC-relative transfer with a computable target.
    const bet = aTaken[4]!;
    expect(anchoredEvent(taken, bet)).toMatchObject({ type: 'branch-predicted', target: 32 });
    expect(anchoredPc(taken, bet)).toBe(BGE_PC);

    // Step 5 RESOLVES to a different address than step 4 bet on — the trap this oracle exists to
    // pin. The bet's target is `done` (0x20); the resolution's is the fall-through (0x1C). Same
    // instruction, same lesson, two events, two targets: a step keyed on the wrong one is dead.
    const wrong = aTaken[5]!;
    expect(anchoredEvent(taken, wrong)).toMatchObject({
      type: 'branch-resolved',
      predicted: true,
      actual: false,
      target: 28,
    });
    expect(anchoredPc(taken, wrong)).toBe(BGE_PC);

    // ...and the redirect fires because `predicted !== actual`, NOT because the branch was taken —
    // this branch is NOT taken and corrects anyway. The two conditions coincide exactly while
    // nothing predicts taken, which is why they read as interchangeable and are not (M4 step 5).
    expect(
      taken.find((c) => c.cycle === wrong.cycle)!.events.some((e) => e.type === 'flush'),
      'a lost bet killed nothing',
    ).toBe(true);
  });

  it('THE BET THAT CANNOT BE PLACED: ret mispredicts under BOTH schemes, and kills nobody', () => {
    // Step 6 is the lesson's load-bearing half — the reason no scheme dominates is not that taken is
    // a bad guess, it is that one transfer admits no guess at all. Alive in both positions, and it
    // must be: `jalr` is absent from the predictable set, so `predicted: false` under every scheme.
    for (const scheme of ['static-not-taken', 'static-taken'] as const) {
      const trace = record(scheme);
      const anchored = anchorLesson(lesson(), trace);
      const ret = anchored[6]!;
      expect(anchoredEvent(trace, ret), `[${scheme}]`).toMatchObject({
        type: 'branch-resolved',
        predicted: false,
        actual: true,
        target: 12, // back to `mv s0, a0`, the instruction after the `jal`
      });
      expect(anchoredPc(trace, ret), `[${scheme}]`).toBe(RET_PC);

      // The narration's "it cost two cycles and killed nobody", asserted — and it is the reason the
      // map marks the BRANCH rather than colouring its victims (step 6). `ret` is the last word of
      // `.text`, so the wrong path it fetched was never anything: a penalty with no casualty, which
      // a flush structurally cannot report.
      expect(
        trace.find((c) => c.cycle === ret.cycle)!.events.some((e) => e.type === 'flush'),
        `[${scheme}] the ret's misprediction flushed someone`,
      ).toBe(false);
    }
  });

  it('same answer, MORE cycles: s0 = 42 either way, 17 under not-taken and 18 under taken', () => {
    const [nt, taken] = [record('static-not-taken'), record('static-taken')];

    // The closing step, alive in both — it is what the program computed, not how it ran. This is
    // INV-8 at the lesson layer: speculation never commits, so every wrong-path instruction above
    // died before WB and the answer is untouched by the guessing.
    for (const trace of [nt, taken]) {
      const last = anchorLesson(lesson(), trace).at(-1)!;
      expect(anchoredEvent(trace, last)).toMatchObject({ type: 'reg-write', reg: 8, value: 42 });
    }

    // ...and step 3's pinned regression, which the closing narration quotes to the reader as fact.
    // Asserted here rather than trusted — M4 step 4 shipped prose reading "51 cycles" over a
    // transport reading 49, and a narration oracle is the only thing that can see that.
    expect(nt.length).toBe(17);
    expect(taken.length).toBe(18);
  });

  /**
   * The lesson's numbers are true in BOTH forwarding positions, and that is a fact about this
   * program rather than a licence to leave the knob undeclared. `call-return` is the corpus's
   * S = 0 program — every RAW in it already sits behind a flush gap — so forwarding buys it nothing
   * and the closing prose holds either way.
   *
   * Which is the sharpest available answer to the `Partial` question M4 step 4 declined (the 4th
   * declined field). Here is a knob a lesson provably has "no opinion" about — the exact category
   * `Partial` was invented to express — and declaring it is STILL right, because the only way to
   * know it does not matter is to measure it, and the measurement is this test rather than the
   * type. A lesson is a controlled experiment: `forwarding` is a control here, and a control you
   * have verified is inert is still a control you pinned. Drop the declaration and the shell parks
   * the user wherever they last were; nothing goes red until the program changes, and then the
   * prose is wrong with no test watching.
   */
  it('pins forwarding as a CONTROL, and this program proves the control inert', () => {
    const declared = lesson().config!;
    const under = (forwarding: boolean, scheme: 'static-not-taken' | 'static-taken'): number =>
      recordLesson(lesson(), { ...declared, forwarding, branchPrediction: scheme }).length;

    for (const scheme of ['static-not-taken', 'static-taken'] as const) {
      expect(under(false, scheme), `[${scheme}] forwarding changed call-return`).toBe(
        under(true, scheme),
      );
    }
    // The declaration is present regardless — the point of the test above, not a contradiction of it.
    expect(declared.forwarding).toBe(true);
  });
});

/**
 * `two-at-once`'s oracle (M8 step 1) — the FIRST lesson ever on `model: superscalar`, and the first
 * at `issueWidth: 2`. The generic sweep proves each step fires and reads in order; it is blind to the
 * two things this lesson exists to say, so both are pinned here by name.
 *
 * **(1) The pair, not merely an event.** The sweep's no-shared-cycle guard checks two steps never
 * anchor to ONE cycle; it never checks that one cycle holds TWO lanes. "Two at once" is entirely the
 * oracle's to prove, and anchoring `result: 19` only proves one add exists. So the paired cycles are
 * asserted to carry exactly two of the event that marks the pairing — two `instr-fetch` on cycle 0
 * (the opening pair pulled together) and two `alu-op` on the mid-loop cycle (both loop-body ops in
 * EX). This is `forwarding-bubble`'s `stallsAt` counting turned on the pairing itself.
 *
 * **(2) The counterfactual numbers, derived not trusted.** The closing narration quotes "44 vs 56"
 * and "IPC 0.77 vs 0.61" AS FACT — and those are properties of the width knob, exactly the M4-step-4
 * trap (`forwarding-bubble` shipped "51 cycles" over a transport reading 49 once its numbers drifted
 * from its declared machine). So the two cycle counts are recorded from the engine at width 1 and 2
 * under the lesson's own declared config, the IPCs are COMPUTED from retire counts, and the closing
 * prose is asserted to contain those exact tokens. A corpus edit that moves either number reddens
 * here instead of letting the prose silently lie.
 */
describe('two-at-once — pairing works, the wide machine’s opening beat (M8 step 1)', () => {
  const lesson = (): Lesson => byId('two-at-once');

  /** The lesson's own declared machine with only the width varied — everything else from the JSON. */
  const record = (issueWidth: number): readonly CycleTrace[] => {
    const declared = lesson().config;
    if (!declared) throw new Error('two-at-once must declare the machine its prose describes');
    return recordLesson(lesson(), { ...declared, issueWidth });
  };

  it('opens on the superscalar at width 2 — the axis the whole lesson rests on', () => {
    // The declared opening. `lessonOpening` honoring this is what `session.test.ts` guards on the
    // load path; here it is the precondition for every number below being about a 2-wide machine.
    expect(lesson().model).toBe('superscalar');
    expect(lesson().config?.issueWidth).toBe(2);
  });

  it('THE PAIR: two instructions fetched together, two ALU ops in one EX cycle', () => {
    const trace = record(2);
    const anchored = anchorLesson(lesson(), trace);

    // Step 0 — the opening pair. It anchors the SECOND fetch, and that second fetch is in the SAME
    // cycle as the first: two `instr-fetch` events, one cycle. On the 1-wide machine the second
    // fetch is a cycle later, which is the whole contrast the lesson opens on.
    const open = anchored[0]!;
    expect(anchoredEvent(trace, open)).toMatchObject({ type: 'instr-fetch' });
    const fetchesOnOpen = trace
      .find((c) => c.cycle === open.cycle)!
      .events.filter((e) => e.type === 'instr-fetch');
    expect(fetchesOnOpen, 'the opening pair is fetched in one cycle').toHaveLength(2);
    // The pair is the first two instructions in program order — `li a0, 0` (pc 0) and `li t0, 10`
    // (pc 4) — not two copies of one fetch. Pinned by pc so a slid anchor can't fake it.
    expect(
      fetchesOnOpen.map((e) => (e as TraceEvent & { pc: number }).pc).sort((a, b) => a - b),
    ).toEqual([0, 4]);

    // Step 1 — the mid-loop paired EX. `add a0` reaching 19 (the second iteration's accumulate) is
    // arithmetic-fixed, so it anchors in every position; here it lands on a cycle that also holds
    // the `addi t0` in the other lane — two `alu-op` events, the signature of a paired EX.
    const ex = anchored[1]!;
    expect(anchoredEvent(trace, ex)).toMatchObject({ type: 'alu-op', op: 'add', result: 19 });
    const alusOnEx = trace
      .find((c) => c.cycle === ex.cycle)!
      .events.filter((e) => e.type === 'alu-op');
    expect(alusOnEx, 'the loop body issues its two arithmetic ops together').toHaveLength(2);
    // The partner is the counter decrement: `add` pushes a0 to 19, `addi` drops t0 to 8, same cycle.
    expect(
      alusOnEx.map((e) => (e as TraceEvent & { result: number }).result).sort((a, b) => a - b),
    ).toEqual([8, 19]);
  });

  it('same answer, fewer cycles: a0 = 55 at 44 cycles vs 56 (IPC 0.77 vs 0.61)', () => {
    const [w1, w2] = [record(1), record(2)];

    // The closing payoff, alive at both widths — it is what the program computed, not how it ran.
    for (const trace of [w1, w2]) {
      const last = anchorLesson(lesson(), trace).at(-1)!;
      expect(anchoredEvent(trace, last)).toMatchObject({ type: 'reg-write', reg: 10, value: 55 });
    }

    // The two totals the closing narration quotes as fact — derived from the declared machine, not
    // trusted. Under any other prediction scheme these would move; `record` fixes the whole config
    // and varies only width, so prose and engine cannot drift apart without this line going red.
    expect(w1.length).toBe(56);
    expect(w2.length).toBe(44);

    // The IPCs, COMPUTED from the retire counts rather than typed, then matched against the prose.
    const retired = (trace: readonly CycleTrace[]): number =>
      trace.flatMap((c) => c.events).filter((e) => e.type === 'instr-retire').length;
    expect(retired(w1)).toBe(34); // width is not a correctness knob — the same 34 retire either way
    expect(retired(w2)).toBe(34);
    const ipcW1 = (retired(w1) / w1.length).toFixed(2); // 34 / 56 = 0.61
    const ipcW2 = (retired(w2) / w2.length).toFixed(2); // 34 / 44 = 0.77
    expect([ipcW1, ipcW2]).toEqual(['0.61', '0.77']);

    // The prose states all four numbers. Asserted against the DEFAULT tier (what the reader sees),
    // so a silently-wrong count — the M4-step-4 defect, green under every anchoring test — reddens.
    const closing = resolveNarration(lesson().steps.at(-1)!.narration, lesson().depthDefault)!;
    for (const token of ['44', '56', ipcW1, ipcW2]) {
      expect(closing, `closing narration must quote ${token}`).toContain(token);
    }
  });
});

/**
 * `pair-that-cant`'s oracle (M8 step 2) — the wide machine's second beat, and the track's first
 * REFUSAL. Where `two-at-once` proved a pair FORMS, this proves one is REFUSED, and by name.
 *
 * The generic sweep is doubly blind here. It proves a `stall` fires and reads in order; it cannot
 * see (1) that the anchor lands on the RIGHT stall, nor (2) that it names the RIGHT hazard — and
 * `array-sum` at width 2 emits three stall flavors (`intra-pair-raw`, `load-use`, and the `la`
 * pseudo-op's own internal `intra-pair-raw`), so a slipped anchor stays green while pointing the
 * cursor at the wrong instruction. Both are pinned below, exactly as `forwarding-bubble` pins its
 * hazards by pc.
 *
 * **The `nth: 2` is load-bearing, and it is the reason this oracle exists.** The FIRST
 * `intra-pair-raw` in this recording is at cycle 1 — the `addi` half of `la t0, arr` reading the
 * `t0` the `lui` beside it just wrote. That is a real refusal, but it is INSIDE a pseudo-op: an
 * instruction the reader never typed, and the exact trap `forwarding-bubble`'s oracle above was
 * written to catch ("a slipped `nth` slides onto the `la` pseudo-op's hidden internal RAW"). The
 * plan said "anchor the first, cycle 1"; that was a plan error — the author corrected the config
 * drift ("not cycle 10") but did not notice cycle 1 IS the `la` internal. `nth: 2` skips it to the
 * first SOURCE-LINE dependent pair: `bnez t1, loop` (pc 32) refused for the `t1` that
 * `addi t1, t1, -1` (pc 28) beside it is still computing. Pinned by pc, so a re-slip fails loud.
 *
 * The steady-state accumulate was the tempting alternative and is worse: in the dump `add a0,a0,t2`
 * is refused TWICE on adjacent cycles — `intra-pair-raw` then `load-use` — because its partner is a
 * load, so a reader scrubbing one cycle sees the reason flip. `bnez`/`addi` is a single, clean
 * refusal that fires every iteration, whose partner is a plain ALU op. It is the branch-ness that is
 * incidental: the refusal here is DATA (it needs `t1`), not structure — the one-branch-unit hazard
 * is `branch-slot`, reserved for step 4 and a different program.
 */
describe('pair-that-cant — the dependent pair is refused (M8 step 2)', () => {
  const BRANCH_PC = 32; // `bnez t1, loop` — reads the t1 that `addi t1, t1, -1` (pc 28) is computing
  const lesson = (): Lesson => byId('pair-that-cant');

  /** The lesson's own declared machine with only the width varied — everything else from the JSON. */
  const record = (issueWidth: number): readonly CycleTrace[] => {
    const declared = lesson().config;
    if (!declared) throw new Error('pair-that-cant must declare the machine its prose describes');
    return recordLesson(lesson(), { ...declared, issueWidth });
  };

  it('opens on the superscalar at width 2 — a refusal only a two-wide machine can make', () => {
    expect(lesson().model).toBe('superscalar');
    expect(lesson().config?.issueWidth).toBe(2);
  });

  it('THE REFUSAL: intra-pair-raw on the branch, NOT the la internal, NOT a load-use', () => {
    const trace = record(2);
    const anchored = anchorLesson(lesson(), trace);

    // Step 0 is the refusal. The event is a stall naming the data hazard by its pairing reason...
    const refusal = anchored[0]!;
    expect(anchoredEvent(trace, refusal)).toMatchObject({
      type: 'stall',
      reason: 'intra-pair-raw',
    });
    // ...and it is the SOURCE-LINE branch (pc 32), not the `la` pseudo-op's internal addi (pc 4)
    // that `nth: 1` would have found one cycle earlier. This is the whole point of the `nth`.
    expect(anchoredPc(trace, refusal)).toBe(BRANCH_PC);
    // Guard the trap explicitly: the la internal really is a distinct, earlier intra-pair-raw, so a
    // reader-facing anchor must skip past it — proven by the cycle strictly advancing off cycle 1.
    expect(refusal.cycle).toBeGreaterThan(1);
  });

  it('the refusal is width-exclusive: no pair means no intra-pair-raw to refuse', () => {
    // Lawfully dead at width 1 (like forwarding-bubble's config-exclusive steps): a one-wide machine
    // issues one instruction per cycle, so there is no candidate pair and no intra-pair hazard. The
    // step must therefore be dead at width 1 and alive at width 2 — the axis the lesson rests on.
    const w1 = anchorLesson(lesson(), record(1));
    expect(
      w1[0]!.cycle,
      'width 1 forms no pair, so nothing is refused for intra-pair-raw',
    ).toBeNull();
  });

  it('same answer, held pair or not: 120 is stored, and the same 34 retire at both widths', () => {
    const [w1, w2] = [record(1), record(2)];

    // The closing beat is alive at both widths — it is what the program computed, not how it ran.
    for (const trace of [w1, w2]) {
      const last = anchorLesson(lesson(), trace).at(-1)!;
      expect(anchoredEvent(trace, last)).toMatchObject({ type: 'mem-write', value: 120 });
    }

    // The expert tier states "34 instructions retire ... either way" as fact — a claim about the
    // width knob (M4 step 4), so derived from the engine at both widths, not trusted. Width is a
    // throughput knob, not a correctness one: the same instructions retire whether or not pairs fold.
    const retired = (trace: readonly CycleTrace[]): number =>
      trace.flatMap((c) => c.events).filter((e) => e.type === 'instr-retire').length;
    expect(retired(w1)).toBe(34);
    expect(retired(w2)).toBe(34);

    // The prose quotes 34; asserted against the DEFAULT tier's expert companion so a silently-wrong
    // count reddens. (No cycle counts are quoted — step 2's payoff is the dependency, not speed — so
    // unlike two-at-once there is nothing more to pin here.)
    const expert = resolveNarration(lesson().steps.at(-1)!.narration, 'expert')!;
    expect(expert, 'the expert tier must quote the retire count it claims').toContain('34');
  });
});

/**
 * `one-door`'s oracle (M8 step 3) — the wide machine's THIRD beat, and its first STRUCTURAL refusal.
 * Where `pair-that-cant` refused a pair for what the younger NEEDED (a data hazard), this refuses one
 * for what the younger IS — a memory access — because the datapath has a single data-memory port.
 *
 * The sweep is blind in the same two ways as step 2, plus one sharper. `byte-loads` at width 2 emits
 * THREE stalls — `intra-pair-raw` (the `la` pseudo-op's internal), `intra-pair-raw` (the first load
 * reading the `la`'s `t0`), then the single `mem-port` — so a right-type/wrong-occurrence anchor
 * lands on a DATA hazard and the lesson silently teaches the wrong thing. Pinning `reason === 'mem-
 * port'` is the whole proof: the engine refused this pair for STRUCTURE, not data, which is exactly
 * the claim the narration makes. It also proves the two loads are maximally independent — a data
 * refusal would have fired instead if they were not.
 *
 * The refused instruction is the younger load `lbu t2, 0(t0)` (pc 12); its older partner `lb t1,
 * 0(t0)` (pc 8) issues. Both are genuine memory ops — asserted by reading who sits in ID beside the
 * refusal and confirming each drives a `mem-read` — so the contended resource is the PORT, the one
 * unit width did not replicate, not anything the two instructions compute.
 */
describe('one-door — two loads, one memory port (M8 step 3)', () => {
  const LBU_PC = 12; // `lbu t2, 0(t0)` — the younger load, refused for the port
  const LB_PC = 8; // `lb t1, 0(t0)` — the older load, which issues
  const lesson = (): Lesson => byId('one-door');

  /** The lesson's own declared machine with only the width varied — everything else from the JSON. */
  const record = (issueWidth: number): readonly CycleTrace[] => {
    const declared = lesson().config;
    if (!declared) throw new Error('one-door must declare the machine its prose describes');
    return recordLesson(lesson(), { ...declared, issueWidth });
  };

  it('opens on the superscalar at width 2 — a refusal only a two-wide machine can make', () => {
    expect(lesson().model).toBe('superscalar');
    expect(lesson().config?.issueWidth).toBe(2);
  });

  it('THE REFUSAL: mem-port on the younger load, between two genuine memory ops', () => {
    const trace = record(2);
    const anchored = anchorLesson(lesson(), trace);

    // Step 0 is the STRUCTURAL refusal. The reason being `mem-port` and NOT `intra-pair-raw` is the
    // entire proof: the engine held the pair for the port, not for a value — so the two loads are
    // maximally independent, and the two earlier intra-pair-raw stalls (which a slipped anchor would
    // land on) are exactly what this pin rules out.
    const refusal = anchored[0]!;
    const refusalEvent = anchoredEvent(trace, refusal) as TraceEvent & { instr: string };
    expect(refusalEvent).toMatchObject({ type: 'stall', reason: 'mem-port' });
    // ...and it names the YOUNGER load (pc 12), the one held; slot 0 is never refused for pairing.
    expect(anchoredPc(trace, refusal)).toBe(LBU_PC);

    // The structural signature: the refusal is between two genuine MEMORY ops. The refused younger is
    // the `lbu`; its older partner is whoever sits in ID.0 the same cycle — the `lb` (pc 8). Both
    // drive a `mem-read`, which is what makes the single PORT the resource they contend for.
    const cycle = trace.find((c) => c.cycle === refusal.cycle)!;
    const older = cycle.instructions.find((i) => i.location === 'ID.0')!.id;
    expect(pcById(trace).get(older)).toBe(LB_PC);
    const memReaders = new Set(
      trace
        .flatMap((c) => c.events)
        .filter((e) => e.type === 'mem-read')
        .map((e) => e.instr),
    );
    expect(memReaders.has(older), 'the older partner is a memory op').toBe(true);
    expect(memReaders.has(refusalEvent.instr), 'the refused younger is a memory op').toBe(true);
  });

  it('the refusal is width-exclusive: no pair means no port contention', () => {
    // Lawfully dead at width 1 (like pair-that-cant's data refusal): one load issues per cycle, so the
    // single port is never contended and there is no candidate pair. Dead at width 1, alive at width
    // 2 — the axis the lesson rests on.
    const w1 = anchorLesson(lesson(), record(1));
    expect(w1[0]!.cycle, 'width 1 forms no pair, so nothing contends for the port').toBeNull();
  });

  it('same answer, held or not: the two bytes land identically at both widths', () => {
    const [w1, w2] = [record(1), record(2)];

    // The closing anchors on the refused `lbu`'s OWN result — +128 into t2 (reg 7) — alive at both
    // widths. It is what the program computed, not how it ran: the held instruction still delivers.
    for (const trace of [w1, w2]) {
      const last = anchorLesson(lesson(), trace).at(-1)!;
      expect(anchoredEvent(trace, last)).toMatchObject({ type: 'reg-write', reg: 7, value: 128 });
    }

    // Both byte results the closing narration quotes — -128 in t1, +128 in t2 — derived from the
    // engine at both widths, not trusted. The single port serialized the reads; it changed neither
    // answer, which is the whole "width is not a correctness knob" claim made concrete.
    const wrote = (trace: readonly CycleTrace[], reg: number, value: number): boolean =>
      trace
        .flatMap((c) => c.events)
        .some((e) => e.type === 'reg-write' && e.reg === reg && e.value === value);
    for (const trace of [w1, w2]) {
      expect(wrote(trace, 6, -128), 'lb → t1 = -128').toBe(true);
      expect(wrote(trace, 7, 128), 'lbu → t2 = +128').toBe(true);
    }
    // The expert tier states both bytes as fact; asserted so a silently-wrong value reddens.
    const expert = resolveNarration(lesson().steps.at(-1)!.narration, 'expert')!;
    expect(expert, 'the closing must quote both byte results').toContain('-128');
    expect(expert).toContain('+128');
  });
});

/**
 * `one-branch-unit`'s oracle (M8 step 4) — the wide machine's FOURTH beat, its SECOND structural
 * refusal, and the one the rest of the corpus cannot reach. `branch-slot` fires ZERO times across
 * all seven other programs (no shipped program places two control transfers adjacent — M8 step 0's
 * finding), so `paired-branches` exists precisely to provoke it; without step 0 this lesson would be
 * unauthorable.
 *
 * Where `one-door` refused a pair for the memory port, this refuses one for the single branch unit —
 * and it is the SHARPEST of the three refusals, because the machine holds the pair before it knows
 * either branch's outcome. In this recording both branches are not-taken and NEITHER flushes, yet
 * the refusal fires a full cycle before either resolves (`branch-resolved` lands at cycle 2 for the
 * elder, cycle 3 for the younger). So the anchor is doubly clean: the trigger names `branch-slot`
 * and is the ONLY stall in the whole trace — no `la` internal, no data hazard, nothing else to slip
 * onto, which is exactly why (unlike step 2) it carries no `nth`, and that uniqueness is itself
 * pinned so a future corpus edit cannot silently reintroduce a second stall for it to land on.
 *
 * The refused instruction is the younger branch (pc 4); its older partner (pc 0) issues. Both are
 * control transfers — asserted by reading who sits in ID beside the refusal and confirming each
 * drives a `branch-resolved` — so the contended resource is the single BRANCH UNIT, the analog of
 * one-door's single memory port, not anything the two instructions compute. The closing cannot copy
 * one-door's shape (which anchored the refused load's OWN writeback): a branch has no result of its
 * own, so the payoff anchors on the architectural `a0 = 42` that the fall-through path computes.
 */
describe('one-branch-unit — two branches, one branch unit (M8 step 4)', () => {
  const YOUNGER_PC = 4; // the younger `bne`, refused for the branch unit
  const ELDER_PC = 0; // the older `bne`, which issues
  const lesson = (): Lesson => byId('one-branch-unit');

  /** The lesson's own declared machine with only the width varied — everything else from the JSON. */
  const record = (issueWidth: number): readonly CycleTrace[] => {
    const declared = lesson().config;
    if (!declared) throw new Error('one-branch-unit must declare the machine its prose describes');
    return recordLesson(lesson(), { ...declared, issueWidth });
  };

  it('opens on the superscalar at width 2 — a refusal only a two-wide machine can make', () => {
    expect(lesson().model).toBe('superscalar');
    expect(lesson().config?.issueWidth).toBe(2);
  });

  it('THE REFUSAL: branch-slot on the younger branch, the ONLY stall in the trace', () => {
    const trace = record(2);
    const anchored = anchorLesson(lesson(), trace);

    // Unlike step 2's `array-sum`, this program emits exactly ONE stall — no `la` pseudo-op internal,
    // no data hazard — so the trigger needs no `nth`, and that uniqueness is pinned: a corpus edit
    // introducing a second stall reddens here rather than silently shifting which one anchors.
    const stalls = trace.flatMap((c) => c.events).filter((e) => e.type === 'stall');
    expect(
      stalls,
      'paired-branches emits exactly one stall — the branch-slot refusal',
    ).toHaveLength(1);

    // Step 0 is the STRUCTURAL refusal. The reason being `branch-slot` is the whole proof: the engine
    // held the pair for the single branch unit, not for a value — the two branches are maximally
    // independent (they compare the same register to itself), refused for what they ARE.
    const refusal = anchored[0]!;
    const refusalEvent = anchoredEvent(trace, refusal) as TraceEvent & { instr: string };
    expect(refusalEvent).toMatchObject({ type: 'stall', reason: 'branch-slot' });
    // ...and it names the YOUNGER branch (pc 4), the one held; slot 0 is never refused for pairing.
    expect(anchoredPc(trace, refusal)).toBe(YOUNGER_PC);

    // The structural signature: the refusal is between two genuine CONTROL TRANSFERS. The refused
    // younger is the second `bne`; its older partner is whoever sits in ID.0 the same cycle — the
    // first `bne` (pc 0). Both drive a `branch-resolved`, which is what makes the single BRANCH UNIT
    // the resource they contend for — the analog of one-door's single memory port.
    const cycle = trace.find((c) => c.cycle === refusal.cycle)!;
    const older = cycle.instructions.find((i) => i.location === 'ID.0')!.id;
    expect(pcById(trace).get(older)).toBe(ELDER_PC);
    const branchers = new Set(
      trace
        .flatMap((c) => c.events)
        .filter((e) => e.type === 'branch-resolved')
        .map((e) => e.instr),
    );
    expect(branchers.has(older), 'the older partner is a control transfer').toBe(true);
    expect(branchers.has(refusalEvent.instr), 'the refused younger is a control transfer').toBe(
      true,
    );
  });

  it('is refused BEFORE either branch resolves — held by class, not by outcome', () => {
    // The lesson's sharpest claim, and what separates branch-slot from the other two structural
    // stories: the pair is refused a full cycle before the machine knows either outcome. This lives
    // in narration ("before either has been resolved ... it does not need to know"), where nothing
    // guards it — so it is asserted against the recording, the sign-and-zero shape. Both
    // `branch-resolved` land STRICTLY AFTER the refusal cycle, and both are not-taken: the refusal
    // could not have been about a taken branch or a flush, only about CLASS at issue.
    const trace = record(2);
    const refusal = anchorLesson(lesson(), trace)[0]!;
    const resolves = trace.flatMap((c) =>
      c.events
        .filter((e): e is TraceEvent & { actual: boolean } => e.type === 'branch-resolved')
        .map((e) => ({ cycle: c.cycle, e })),
    );
    expect(resolves, 'both branches resolve').toHaveLength(2);
    for (const { cycle, e } of resolves) {
      expect(cycle, 'the branch resolves AFTER it was refused, not before').toBeGreaterThan(
        refusal.cycle!,
      );
      expect(e.actual, 'neither branch is taken — no flush muddies the witness').toBe(false);
    }
  });

  it('the refusal is width-exclusive: no pair means no branch-unit contention', () => {
    // Lawfully dead at width 1 (like the other two refusals): one branch issues per cycle, so the
    // single unit is never contended and there is no candidate pair. Dead at width 1, alive at
    // width 2 — the axis the lesson rests on.
    const w1 = anchorLesson(lesson(), record(1));
    expect(
      w1[0]!.cycle,
      'width 1 forms no pair, so nothing contends for the branch unit',
    ).toBeNull();
  });

  it('same answer, held or not: a0 = 42 by falling through, at both widths', () => {
    const [w1, w2] = [record(1), record(2)];

    // The closing anchors on the architectural result — a0 = 42 (reg 10) — alive at both widths.
    // Unlike one-door, the refused instruction is a BRANCH with no writeback of its own to land on;
    // the payoff is the value the fall-through path computes, invariant to how it issued.
    for (const trace of [w1, w2]) {
      const last = anchorLesson(lesson(), trace).at(-1)!;
      expect(anchoredEvent(trace, last)).toMatchObject({ type: 'reg-write', reg: 10, value: 42 });
    }

    // The closing prose quotes 42; asserted against the default tier so a silently-wrong value
    // reddens. (No cycle counts are quoted — like steps 2 and 3, the payoff is the structural rule,
    // not speed.)
    const closing = resolveNarration(lesson().steps.at(-1)!.narration, lesson().depthDefault)!;
    expect(closing, 'the closing must quote the answer it claims').toContain('42');
  });
});

/**
 * The cache track's oracles (M6 step 7) — the assertions the generic sweep cannot make, in the
 * shape the two flagships established. The sweep proves each step fires SOMEWHERE and reads in
 * order; it cannot prove a step points at the RIGHT access, and for the cache that matters twice
 * over: the anchors key on `addr`/`hit`/`evicted` (a `cache-access` event carries NO `instr`, so
 * there is no pc to pin the way the hazard oracles do), and the crux of two of the three lessons is
 * a step that is SIZE-EXCLUSIVE — alive under the declared geometry, dead under the other. That is
 * `branch-bet`'s config-exclusive structure one knob over, and it is pinned the same way: by name,
 * per size.
 *
 * Every `addr`/`evicted` is a magic decimal in the lesson JSON (`where` has no comment channel);
 * here, in TS, they are written as `DATA_BASE + offset` so the number is documented where it can be.
 * They are grounded in `cache.test.ts`'s hand-derived streams: `array-sum` is `M,H,H,H,M` over its
 * loads (plus a store hit); `array-sum-twice` re-reads its 12 addresses, all-hits on pass two at
 * four lines and re-missing arr[0]/arr[8] at two.
 */
const DATA_BASE = 0x10000000; // .data base — arr[0]; blocks are 16 bytes, so arr[4] = +16, arr[8] = +32

describe('cache-spatial — a line brings its neighbors (M6 step 7)', () => {
  const lesson = (): Lesson => byId('cache-spatial');
  const record = (): readonly CycleTrace[] => recordLesson(lesson(), lesson().config!);

  it('opens on the pipeline with a cache on — the subject needs one to exist', () => {
    expect(lesson().model).toBe('pipeline');
    expect(lesson().config?.cache).not.toBeNull();
  });

  it('the line-fill miss, then the neighbor hit, then the next-line miss', () => {
    const trace = record();
    const anchored = anchorLesson(lesson(), trace);
    // Step 1 — the first load misses at arr[0]: a compulsory miss on a cold line.
    expect(anchoredEvent(trace, anchored[1]!)).toMatchObject({
      type: 'cache-access',
      hit: false,
      addr: DATA_BASE,
    });
    // Step 2 — the next load HITS at arr[1], one word into the line the miss just filled. This is
    // spatial locality, and pinning the addr is what proves the step points at the neighbor rather
    // than at some later hit: `{hit:true}` alone would satisfy on any of them.
    expect(anchoredEvent(trace, anchored[2]!)).toMatchObject({
      type: 'cache-access',
      hit: true,
      addr: DATA_BASE + 4,
    });
    // Step 3 — arr[4] misses: the fifth word falls in the NEXT line (block boundary at +16).
    expect(anchoredEvent(trace, anchored[3]!)).toMatchObject({
      type: 'cache-access',
      hit: false,
      addr: DATA_BASE + 16,
    });
  });

  it('two misses over five loads — the number the payoff quotes, counted right', () => {
    // The closing narration says "five loads, of which only two missed". Pinned from the event
    // stream so prose and machine cannot drift — and counted as LOADS, which is the trap the dump
    // caught: the `sw a0, 0(total)` ALSO emits a `cache-access` (a hit, `total` sharing arr[4]'s
    // line), so there are SIX accesses, not five. Miss count is 2 either way.
    const trace = record();
    const accesses = trace
      .flatMap((c) => c.events)
      .filter((e): e is Extract<TraceEvent, { type: 'cache-access' }> => e.type === 'cache-access');
    expect(accesses.length).toBe(6); // 5 loads + the store to `total`
    expect(accesses.filter((e) => !e.hit).length).toBe(2); // one per line the 5-word array spans
    // The payoff is architectural and cache-invisible: a0 = 120 with or without a cache.
    const last = anchorLesson(lesson(), trace).at(-1)!;
    expect(anchoredEvent(trace, last)).toMatchObject({ type: 'reg-write', reg: 10, value: 120 });
  });
});

describe('cache-temporal — reuse across a pass (M6 step 7)', () => {
  const lesson = (): Lesson => byId('cache-temporal');
  const record = (): readonly CycleTrace[] => recordLesson(lesson(), lesson().config!);

  it('opens on the pipeline with the LARGE cache — the one that fits the working set', () => {
    expect(lesson().model).toBe('pipeline');
    expect(lesson().config?.cache).toMatchObject({ numLines: 4 });
  });

  it('pass one compulsory-misses each line; pass two revisits arr[0] and HITS', () => {
    const trace = record();
    const a = anchorLesson(lesson(), trace);
    // Step 1 — pass-1 first miss, at arr[0].
    expect(anchoredEvent(trace, a[1]!)).toMatchObject({
      type: 'cache-access',
      hit: false,
      addr: DATA_BASE,
    });
    // Step 2 — pass-1's THIRD (last) miss: the third line, at arr[8] = base + two blocks.
    expect(anchoredEvent(trace, a[2]!)).toMatchObject({
      type: 'cache-access',
      hit: false,
      addr: DATA_BASE + 32,
    });
    // Step 3 — pass TWO returns to arr[0] (the same address as step 1) and now HITS. The crux, and
    // it is size-exclusive: on the small cache arr[0] was evicted, so this exact trigger
    // (`{addr: arr[0], hit: true}`) is dead there — pinned below.
    expect(anchoredEvent(trace, a[3]!)).toMatchObject({
      type: 'cache-access',
      hit: true,
      addr: DATA_BASE,
    });
  });

  it('the whole second pass hits — three misses for the program, and a0 = 156', () => {
    const trace = record();
    const accesses = trace
      .flatMap((c) => c.events)
      .filter((e): e is Extract<TraceEvent, { type: 'cache-access' }> => e.type === 'cache-access');
    expect(accesses.length).toBe(24); // 12 loads × 2 passes; array-sum-twice has no store
    expect(accesses.filter((e) => !e.hit).length).toBe(3); // all compulsory, all in pass one
    // Pass two — the second twelve accesses — is entirely hits: temporal reuse, total.
    expect(accesses.slice(12).every((e) => e.hit)).toBe(true);
    const last = anchorLesson(lesson(), trace).at(-1)!;
    expect(anchoredEvent(trace, last)).toMatchObject({ type: 'reg-write', reg: 10, value: 156 });
  });

  it('the revisit hit is DEAD on the small cache — reuse needs capacity, not just a line', () => {
    // The lesson's crux, size-proofed. Record the SAME lesson under the small geometry: pass-2 arr[0]
    // is a MISS there (it was evicted mid-pass-one), so the `{addr: arr[0], hit: true}` trigger
    // anchors nothing. This is what separates this lesson from cache-spatial — the line brought
    // neighbors, but only CAPACITY keeps arr[0] alive across a pass, which is what a bigger cache buys.
    const small = recordLesson(lesson(), { ...lesson().config!, cache: CACHE_SMALL });
    expect(
      anchorLesson(lesson(), small)[3]!.cycle,
      'the revisit hit fired on a cache too small to keep arr[0]',
    ).toBeNull();
  });
});

describe('cache-conflict — the size flip, guided (M6 step 7)', () => {
  const lesson = (): Lesson => byId('cache-conflict');
  const record = (): readonly CycleTrace[] => recordLesson(lesson(), lesson().config!);
  const missCount = (cache: ProcessorConfig['cache']): number =>
    recordLesson(lesson(), { ...lesson().config!, cache })
      .flatMap((c) => c.events)
      .filter((e) => e.type === 'cache-access' && !e.hit).length;

  it('opens on the pipeline with the SMALL cache — the one too small for the working set', () => {
    expect(lesson().model).toBe('pipeline');
    expect(lesson().config?.cache).toMatchObject({ numLines: 2 });
  });

  it('a conflict eviction in pass one, then arr[0] re-misses in pass two', () => {
    const trace = record();
    const a = anchorLesson(lesson(), trace);
    // Step 1 — block 2 (arr[8]) arrives and EVICTS block 0 (arr[0], base DATA_BASE): they collide on
    // line 0 (2 mod 2 = 0). The evicted block's BASE names it. `evicted: DATA_BASE` occurs twice
    // under the small cache (pass-1 conflict and pass-2), so the lesson's `nth: 1` takes the first —
    // the pass-one eviction. Under the large cache there is no eviction at all (pinned dead below).
    expect(anchoredEvent(trace, a[1]!)).toMatchObject({
      type: 'cache-access',
      hit: false,
      addr: DATA_BASE + 32,
      evicted: DATA_BASE,
    });
    // Step 2 — pass two returns to arr[0] and MISSES: it was the block just evicted. The same address
    // that HIT in cache-temporal, a miss here because this cache could not keep it. `{addr: arr[0],
    // hit: false}` with `nth: 2` — the first such is pass one's compulsory miss, the second is this
    // re-miss.
    expect(anchoredEvent(trace, a[2]!)).toMatchObject({
      type: 'cache-access',
      hit: false,
      addr: DATA_BASE,
    });
  });

  it('five misses on small against three on large — the flip, and the same 156 either way', () => {
    expect(missCount(CACHE_SMALL)).toBe(5); // the declared machine: two extra re-misses (arr[0], arr[8])
    expect(missCount(CACHE_LARGE)).toBe(3); // bigger cache captures the reuse — two fewer misses
    // Same answer on both, because the cache holds no values (INV-8): the flip moves cycles, never
    // the result. The payoff step is alive on both sizes.
    for (const cache of [CACHE_SMALL, CACHE_LARGE]) {
      const trace = recordLesson(lesson(), { ...lesson().config!, cache });
      const last = anchorLesson(lesson(), trace).at(-1)!;
      expect(anchoredEvent(trace, last)).toMatchObject({ type: 'reg-write', reg: 10, value: 156 });
    }
  });

  it('the eviction and re-miss are DEAD on the large cache — the flip made concrete', () => {
    // The flagship "flip the size and watch the same program change", pinned at the lesson layer: the
    // two steps that ARE the conflict vanish on a cache with room to spare. No eviction, no re-miss,
    // so both anchor nothing — the exact inverse of the small run above.
    const large = recordLesson(lesson(), { ...lesson().config!, cache: CACHE_LARGE });
    const a = anchorLesson(lesson(), large);
    expect(a[1]!.cycle, 'an eviction fired on a cache with room to spare').toBeNull();
    expect(a[2]!.cycle, 'arr[0] re-missed on a cache large enough to keep it').toBeNull();
  });
});

/**
 * `work-slides-ahead`'s oracle (M10 step 2) — the FIRST lesson ever on `model: out-of-order`, the
 * crown jewel of the OoO track, and the milestone's whole thesis made guided. The generic sweep
 * proves each step fires and reads in order; it is BLINDER here than anywhere before it, and both
 * things this lesson exists to say have to be pinned by name.
 *
 * **Why the sweep is blind — the M10 headline.** The event MULTISET is invariant under the
 * `outOfOrderIssue` toggle: the same `alu-op`s, `mem-read`s and `mem-write` fire in BOTH positions,
 * and ONLY the cycle each lands on differs (the OoO engine emits no `stall`/`forward` event — the
 * CDB broadcast IS the forward). So "the anchor fired" proves nothing about WHICH machine ran, and
 * INV-8 is doubly useless (it retires in program order either way, so final state is identical). The
 * lesson's entire claim — a younger instruction executed while an older one waited, and the program
 * finished sooner — lives in the CYCLE each event landed on, which only an oracle reads.
 *
 * **(1) The reorder, by name.** The counter's decrement (`addi t1, t1, -1`, 5 -> 4 — a
 * program-unique `alu-op` value, so it tracks the SAME instruction across the toggle, never an `nth`
 * that would drift) slides from cycle 20 in order to cycle 9 out of order, UNDER the head load's
 * miss, whose `mem-read` lands at cycle 17 either way. In order it waits the miss out (cycle 20 >
 * 17); out of order it runs while the miss is outstanding (cycle 9 < 17). The same event, moved.
 *
 * **(2) The counterfactual numbers, derived not trusted.** The closing narration quotes "59 vs 71"
 * and "IPC 0.58 vs 0.48" AS FACT — the exact M4-step-4 trap (`forwarding-bubble` once shipped "51
 * cycles" over a transport reading 49). So both totals are recorded from the engine at each toggle
 * position under the lesson's own declared config, the IPCs are COMPUTED from retire counts, and the
 * closing prose is asserted to contain those exact tokens.
 */
describe('work-slides-ahead — the out-of-order flagship, work slides past the miss (M10 step 2)', () => {
  const lesson = (): Lesson => byId('work-slides-ahead');

  /** The lesson's own declared machine with only the issue-order toggle varied — the rest from JSON. */
  const record = (outOfOrderIssue: boolean): readonly CycleTrace[] => {
    const declared = lesson().config;
    if (!declared)
      throw new Error('work-slides-ahead must declare the machine its prose describes');
    return recordLesson(lesson(), { ...declared, outOfOrderIssue });
  };

  it('opens on the out-of-order machine at width 1, cache large, issuing OUT of order', () => {
    // The declared opening. `lessonOpening` honoring this is what `session.test.ts` guards on the
    // load path; here it is the precondition for every cycle number below being about the machine the
    // prose describes. The cache is CACHE_LARGE by IDENTITY — `canonicalize` mapped the JSON geometry
    // to the shipped constant at load, which is also what lets the shell's cache toggle light.
    expect(lesson().model).toBe('out-of-order');
    expect(lesson().config?.outOfOrderIssue).toBe(true);
    expect(lesson().config?.issueWidth).toBe(1);
    expect(lesson().config?.cache).toBe(CACHE_LARGE);
  });

  /** The cycle of the sole `alu-op` with this `op`/`result` — asserts uniqueness, which is the anchor's. */
  const aluCycle = (trace: readonly CycleTrace[], op: string, result: number): number => {
    const hits = trace.flatMap((c) =>
      c.events.flatMap((e) =>
        e.type === 'alu-op' && e.op === op && e.result === result ? [c.cycle] : [],
      ),
    );
    expect(hits, `alu-op ${op} result:${result} is program-unique`).toHaveLength(1);
    return hits[0]!;
  };

  /** The cycle of the head load's `mem-read` (element value 5, program-unique). */
  const memReadCycle = (trace: readonly CycleTrace[]): number => {
    const hits = trace.flatMap((c) =>
      c.events.flatMap((e) => (e.type === 'mem-read' && e.value === 5 ? [c.cycle] : [])),
    );
    expect(hits, 'the first element load (value 5) is program-unique').toHaveLength(1);
    return hits[0]!;
  };

  it('THE REORDER: the counter slides under the miss — cycle 9 out of order vs 20 in order', () => {
    const [inOrder, ooo] = [record(false), record(true)];

    // The head load misses and its `mem-read` lands at cycle 17 REGARDLESS of issue order — it is the
    // head of the program, so nothing reorders ahead of it. This is the fixed point the reorder is
    // measured against: independent work slides UNDER this, it does not move it.
    expect(memReadCycle(inOrder)).toBe(17);
    expect(memReadCycle(ooo)).toBe(17);

    // In order: the counter's decrement (5 -> 4) is pinned to cycle 20 — behind the waiting `add`,
    // AFTER the load it never depended on finally resolved. The stall it inherited is pure policy.
    expect(aluCycle(inOrder, 'add', 4)).toBe(20);
    expect(aluCycle(inOrder, 'add', 4)).toBeGreaterThan(memReadCycle(inOrder));

    // Out of order: the SAME decrement slides to cycle 9 — BEFORE the load's `mem-read` at 17, while
    // the miss is still outstanding. This is the lesson's whole subject, and the sweep cannot see it:
    // the `alu-op result:4` fires in both positions, only its cycle moved.
    expect(aluCycle(ooo, 'add', 4)).toBe(9);
    expect(aluCycle(ooo, 'add', 4)).toBeLessThan(memReadCycle(ooo));
    expect(aluCycle(ooo, 'add', 4)).toBeLessThan(aluCycle(inOrder, 'add', 4));

    // The reorder step's prose states these three cycles as fact ("cycle 9", "cycle 17", "cycle
    // 20"). Token-checked at the default tier, the M4-step-4 net: a silently-wrong cycle in the
    // narration is invisible to the anchoring sweep (the event fires either way) and only reddens
    // here. Checked as the phrase "cycle N", not the bare number, so "9" cannot match inside "59".
    const reorder = resolveNarration(lesson().steps[0]!.narration, lesson().depthDefault)!;
    for (const token of ['cycle 9', 'cycle 17', 'cycle 20']) {
      expect(reorder, `the reorder narration must quote "${token}"`).toContain(token);
    }
  });

  it('THE CRITICAL PATH: the reduction is fed sooner — its head start IS the whole win', () => {
    const [inOrder, ooo] = [record(false), record(true)];

    // The beat's real claim, and the one the first draft got BACKWARDS (advisor, M10 step 2): the
    // reduction does NOT "gain nothing" out of order. Its fourth partial (5 + 17 - 4 + 100 = 118,
    // program-unique) is reached at cycle 30 out of order versus 42 in order — twelve cycles sooner,
    // because the loads that feed the chain are decoupled from it and stream in early, even though
    // the chain's own links can never run in parallel. That is why the speedup is partial (the chain
    // is a floor) AND real (the floor is reached sooner).
    const reductionOoo = aluCycle(ooo, 'add', 118);
    const reductionInOrder = aluCycle(inOrder, 'add', 118);
    expect(reductionOoo).toBe(30);
    expect(reductionInOrder).toBe(42);
    // THE claim, pinned: the reduction's head start EQUALS the program's whole cycle-count win —
    // nothing after the last load reorders, so the shift the chain gets is the shift the program
    // gets. This is what the prose asserts ("a twelve-cycle head start ... the program's entire
    // twelve-cycle win"), and the sweep cannot see it; the first draft's oracle pinned only that 118
    // was "ahead", which stayed green over prose claiming it was NOT.
    expect(reductionInOrder - reductionOoo).toBe(inOrder.length - ooo.length); // 12 === 71 - 59
    // ...and it lands strictly AFTER the reordered counter in both positions (the counter is iteration
    // 1's, this is iteration 4's), which is what makes the two steps independently reachable.
    expect(reductionOoo).toBeGreaterThan(aluCycle(ooo, 'add', 4));
    expect(reductionInOrder).toBeGreaterThan(aluCycle(inOrder, 'add', 4));

    // The beat's prose states the two cycles and the partial; token-checked at the default tier so it
    // cannot drift from the engine (the whole reason this beat needed a rewrite, not a word tweak).
    const middle = resolveNarration(lesson().steps[1]!.narration, lesson().depthDefault)!;
    for (const token of ['118', 'cycle 30', 'cycle 42']) {
      expect(middle, `the critical-path narration must quote "${token}"`).toContain(token);
    }
  });

  it('same answer, fewer cycles: 120 stored either way, 59 vs 71 (IPC 0.58 vs 0.48)', () => {
    const [inOrder, ooo] = [record(false), record(true)];

    // The closing payoff, alive in both — it is what the program computed, not how it ran. The store
    // of 120 is the lesson's last anchored step (`mem-write where value:120`, program-unique).
    for (const trace of [inOrder, ooo]) {
      const last = anchorLesson(lesson(), trace).at(-1)!;
      expect(anchoredEvent(trace, last)).toMatchObject({ type: 'mem-write', value: 120 });
    }

    // The two totals the closing narration quotes as fact — derived from the declared machine, not
    // trusted. Under any other cache these would move (out of order === in order with the cache off,
    // the whole reason M10 lives at cache-on); `record` fixes the config and varies only the toggle,
    // so prose and engine cannot drift apart without this line going red.
    expect(inOrder.length).toBe(71);
    expect(ooo.length).toBe(59);

    // The IPCs, COMPUTED from the retire counts rather than typed, then matched against the prose.
    const retired = (trace: readonly CycleTrace[]): number =>
      trace.flatMap((c) => c.events).filter((e) => e.type === 'instr-retire').length;
    expect(retired(inOrder)).toBe(34); // issue order is not a correctness knob — 34 retire either way
    expect(retired(ooo)).toBe(34);
    const ipcInOrder = (retired(inOrder) / inOrder.length).toFixed(2); // 34 / 71 = 0.48
    const ipcOoo = (retired(ooo) / ooo.length).toFixed(2); // 34 / 59 = 0.58
    expect([ipcInOrder, ipcOoo]).toEqual(['0.48', '0.58']);

    // The prose states all four numbers. Asserted against the DEFAULT tier (what the reader sees), so
    // a silently-wrong count — the M4-step-4 defect, green under every anchoring test — reddens here.
    const closing = resolveNarration(lesson().steps.at(-1)!.narration, lesson().depthDefault)!;
    for (const token of ['71', '59', ipcInOrder, ipcOoo]) {
      expect(closing, `closing narration must quote ${token}`).toContain(token);
    }
  });
});

/**
 * `reservation-station-holds`'s oracle (M10 step 3) — the Tomasulo namesake, and the first lesson
 * to ride the `slowOpLatency` knob step 1 wired. Same headline as the flagship's: the event multiset
 * is invariant under the `outOfOrderIssue` toggle (the OoO engine emits no `stall`/`forward`), so the
 * sweep is blind to WHICH machine ran and every claim lives in the cycle each event landed on.
 *
 * **One net exists here that the flagship did not need.** `slowOpLatency` is NOT a sweep axis (step
 * 0b — honored by the engine but neither swept nor user-controllable), so `positionsFor` records
 * this lesson with the shift SINGLE-CYCLE (latency 1) in all 48 positions. The reorder the lesson is
 * about only happens at the declared latency 8, which no swept position visits — so this oracle is
 * the ONLY place the latency-8 recording's anchor order, cycle counts, and prose are checked at all.
 *
 * **(1) The hold.** The head `sll` occupies its functional unit for eight cycles; its result does not
 * broadcast until cycle 13, in BOTH toggle positions (it is loop-invariant, nothing reorders ahead of
 * it). Out of order the independent counter (`addi t1`, 6 -> 5) runs at cycle 8 — DURING that hold,
 * five cycles before the shift finishes — while in order the same decrement waits until cycle 15,
 * after the shift and the add it never depended on.
 *
 * **(2) The wakeup.** The dependent `add` cannot beat the shift; it waits in its reservation station
 * and wakes the cycle the common data bus broadcasts. Iteration two's shift broadcasts at cycle 19
 * and the add runs at cycle 20 (out of order) — versus cycle 27 in order, where the iterations cannot
 * overlap.
 *
 * **(3) The counterfactual, derived not trusted.** 72 either way; 53 cycles out of order against 86
 * in order; IPC 0.57 vs 0.35, computed from the 30 retires. The M4-step-4 net (`forwarding-bubble`
 * once shipped "51 cycles" over a transport reading 49): both totals are recorded from the declared
 * machine and the prose is token-checked against them.
 */
describe('reservation-station-holds — the slow op held while independent work issues (M10 step 3)', () => {
  const lesson = (): Lesson => byId('reservation-station-holds');

  /** The lesson's own declared machine with only the issue-order toggle varied — the rest from JSON. */
  const record = (outOfOrderIssue: boolean): readonly CycleTrace[] => {
    const declared = lesson().config;
    if (!declared)
      throw new Error('reservation-station-holds must declare the machine its prose describes');
    return recordLesson(lesson(), { ...declared, outOfOrderIssue });
  };

  /** The cycle of the sole `alu-op` with this op/result — asserts uniqueness, the anchor's contract. */
  const aluCycle = (trace: readonly CycleTrace[], op: string, result: number): number => {
    const hits = trace.flatMap((c) =>
      c.events.flatMap((e) =>
        e.type === 'alu-op' && e.op === op && e.result === result ? [c.cycle] : [],
      ),
    );
    expect(hits, `alu-op ${op} result:${result} is program-unique`).toHaveLength(1);
    return hits[0]!;
  };

  /** Every cycle an `alu-op` with this op/result fires — the shift repeats (result 12) each iteration. */
  const aluCycles = (trace: readonly CycleTrace[], op: string, result: number): number[] =>
    trace.flatMap((c) =>
      c.events.flatMap((e) =>
        e.type === 'alu-op' && e.op === op && e.result === result ? [c.cycle] : [],
      ),
    );

  it('opens on the out-of-order machine at width 1, no cache, with a slow op declared', () => {
    expect(lesson().model).toBe('out-of-order');
    expect(lesson().config?.outOfOrderIssue).toBe(true);
    expect(lesson().config?.issueWidth).toBe(1);
    expect(lesson().config?.cache).toBeNull();
    // The knob this lesson exists for — and the one with no shell control, so `session.test.ts`'s
    // opening loop is the net that it actually reaches the recording (here it is a declared fact).
    expect(lesson().config?.slowOpLatency).toBe(8);
  });

  it('THE HOLD: the counter runs during the shift’s eight-cycle occupancy — cycle 8 out of order vs 15 in order', () => {
    const [inOrder, ooo] = [record(false), record(true)];

    // The first shift completes at cycle 13 REGARDLESS of issue order — it is the loop head and
    // loop-invariant, so nothing reorders ahead of it. The fixed point the reorder is measured
    // against: independent work slides UNDER this, it does not move it.
    expect(aluCycles(inOrder, 'sll', 12)[0]).toBe(13);
    expect(aluCycles(ooo, 'sll', 12)[0]).toBe(13);

    // In order: the counter's decrement (6 -> 5) is pinned to cycle 15 — behind the shift and the
    // add it never depended on, AFTER the shift finally broadcast. The wait it inherited is policy.
    expect(aluCycle(inOrder, 'add', 5)).toBe(15);
    expect(aluCycle(inOrder, 'add', 5)).toBeGreaterThan(aluCycles(inOrder, 'sll', 12)[0]!);

    // Out of order: the SAME decrement runs at cycle 8 — five cycles BEFORE the shift finishes, while
    // the reservation station still holds the dependent add. The lesson's whole subject, and the
    // sweep cannot see it (the `alu-op result:5` fires in both positions, only its cycle moved).
    expect(aluCycle(ooo, 'add', 5)).toBe(8);
    expect(aluCycle(ooo, 'add', 5)).toBeLessThan(aluCycles(ooo, 'sll', 12)[0]!);

    const hold = resolveNarration(lesson().steps[0]!.narration, lesson().depthDefault)!;
    for (const token of ['cycle 8', 'cycle 13', 'cycle 15', 'eight']) {
      expect(hold, `the hold narration must quote "${token}"`).toContain(token);
    }
  });

  it('THE WAKEUP: the dependent add wakes the cycle after the shift broadcasts — cycle 20 out of order vs 27 in order', () => {
    const [inOrder, ooo] = [record(false), record(true)];

    // The second iteration's shift broadcasts at cycle 19; the add waiting on it wakes at cycle 20 —
    // the reservation station releasing its instruction the moment the common data bus carries t3.
    expect(aluCycles(ooo, 'sll', 12)[1]).toBe(19);
    expect(aluCycle(ooo, 'add', 24)).toBe(20);
    expect(aluCycle(ooo, 'add', 24), 'woken by the broadcast the next cycle').toBe(
      aluCycles(ooo, 'sll', 12)[1]! + 1,
    );

    // In order the same partial sum does not land until cycle 27 — later, because every iteration's
    // independent work is stacked in front of it instead of overlapping the wait.
    expect(aluCycle(inOrder, 'add', 24)).toBe(27);
    expect(aluCycle(ooo, 'add', 24)).toBeLessThan(aluCycle(inOrder, 'add', 24));
    // ...and strictly after the reordered counter in both positions (iteration 1's counter, this is
    // iteration 2's sum), which is what makes the two steps independently reachable by the cursor.
    expect(aluCycle(ooo, 'add', 24)).toBeGreaterThan(aluCycle(ooo, 'add', 5));
    expect(aluCycle(inOrder, 'add', 24)).toBeGreaterThan(aluCycle(inOrder, 'add', 5));

    const wake = resolveNarration(lesson().steps[1]!.narration, lesson().depthDefault)!;
    for (const token of ['cycle 19', 'cycle 20', 'cycle 27']) {
      expect(wake, `the wakeup narration must quote "${token}"`).toContain(token);
    }
  });

  it('same answer, fewer cycles: 72 either way, 53 vs 86 (IPC 0.57 vs 0.35)', () => {
    const [inOrder, ooo] = [record(false), record(true)];

    // The final partial (6 × 12 = 72, program-unique) is the lesson's last anchored step.
    for (const trace of [inOrder, ooo]) {
      const last = anchorLesson(lesson(), trace).at(-1)!;
      expect(anchoredEvent(trace, last)).toMatchObject({ type: 'alu-op', op: 'add', result: 72 });
    }

    // The two totals the closing narration quotes as fact — derived from the declared machine at each
    // toggle position (both at the SAME slow-op latency 8), not trusted. At latency 1 these collapse
    // to 44/44 (the parity `slow-op.test.ts` pins), which is the whole reason the sweep is blind.
    expect(inOrder.length).toBe(86);
    expect(ooo.length).toBe(53);

    // IPC COMPUTED from the retire counts rather than typed, then matched against the prose.
    const retired = (trace: readonly CycleTrace[]): number =>
      trace.flatMap((c) => c.events).filter((e) => e.type === 'instr-retire').length;
    expect(retired(inOrder)).toBe(30); // issue order is not a correctness knob — 30 retire either way
    expect(retired(ooo)).toBe(30);
    const ipcInOrder = (retired(inOrder) / inOrder.length).toFixed(2); // 30 / 86 = 0.35
    const ipcOoo = (retired(ooo) / ooo.length).toFixed(2); // 30 / 53 = 0.57
    expect([ipcInOrder, ipcOoo]).toEqual(['0.35', '0.57']);

    const closing = resolveNarration(lesson().steps.at(-1)!.narration, lesson().depthDefault)!;
    for (const token of ['53', '86', ipcInOrder, ipcOoo]) {
      expect(closing, `closing narration must quote ${token}`).toContain(token);
    }
  });

  it('the step anchors stay monotonic and distinct at the declared slow-op latency', () => {
    // The one net unique to this lesson. `positionsFor` records at latency 1 (slowOpLatency is not an
    // axis), so NOTHING else checks anchor order at the latency-8 recording the browser actually plays
    // — where the reorder happens and two anchors could in principle collide or invert. Pinned in both
    // toggle positions: the runner navigates by cursor, so steps must anchor in non-decreasing order
    // and to distinct cycles or an earlier step becomes unreachable.
    for (const trace of [record(false), record(true)]) {
      const anchored = anchorLesson(lesson(), trace);
      expect(anchorOrderViolations(anchored)).toEqual([]);
      const cycles = anchored.flatMap((a) => (a.cycle === null ? [] : [a.cycle]));
      expect(new Set(cycles).size, 'each step anchors to a distinct cycle').toBe(cycles.length);
    }
  });
});
