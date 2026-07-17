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
import { PipelineProcessor } from '@cpu-viz/engine-pipeline';
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
import { LESSON_ORDER, LESSONS, orderLessons } from './lessons';
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

  it('gives the pipeline the CROSS PRODUCT of both knobs it honors, not one knob', () => {
    // The claim in one line: two honored knobs ⇒ four machines. This is what went stale when step 1
    // flipped `configurableBranchPrediction` to true and this function still read one capability —
    // the sweep would have kept passing at half coverage.
    expect(positionsFor('pipeline').map((p) => p.label)).toEqual([
      'forwarding off, predict not-taken',
      'forwarding off, predict taken',
      'forwarding on, predict not-taken',
      'forwarding on, predict taken',
    ]);
  });

  it('the positions are DISTINCT configs, not four labels on one machine', () => {
    // The non-vacuity, and the thing a label can lie about: four names over four identical configs
    // would run the sweep four times and prove one position. Compared as configs rather than
    // labels, because the labels are what would agree while the configs collapsed.
    const configs = positionsFor('pipeline').map((p) => JSON.stringify(p.config));
    expect(new Set(configs).size).toBe(4);
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

  it('teaches the LANGUAGE before the MACHINE', () => {
    // The track's shape as an ordering claim rather than as a comment: every single-cycle lesson
    // (the language track — a loop, an array, a call) precedes both pipeline flagships (whose
    // subject is a µarch, and which presuppose the language). This is the claim M5 step 4 extends
    // when `first-program` and `sign-and-zero` land, and it is why the authored order is not
    // alphabetical in either direction — `array-in-memory` sorts first, `sum-loop-tour` sorts last.
    const models = LESSONS.map((l) => l.model);
    expect(models.lastIndexOf('single-cycle')).toBeLessThan(models.indexOf('pipeline'));
  });
});

describe('authored lessons (INV-6)', () => {
  it('ships one lesson per shipped microarchitecture that has something to teach', () => {
    // Four single-cycle tours (M1's "2–3 lessons" target, plus M5 step 1's front door) and the two
    // pipeline flagships — one
    // per toggle the pipeline honors, which is the shape the library has converged on rather than a
    // coincidence: a config knob nobody can see the point of is a knob that should not ship.
    // Multi-cycle deliberately has none: its story is "one instruction, phases spread over
    // cycles", which the single-cycle lessons already narrate correctly when the model is swapped
    // under them (pinned by the cross-model suite below). The pipeline is the first model whose
    // lesson could NOT be borrowed that way — nothing else stalls, and nothing else speculates.
    expect(LESSONS.length).toBe(6);
    // Sorted, because the claim in this test's own sentence is MEMBERSHIP — "one lesson per
    // microarchitecture" — and `LESSONS` is no longer in a sorted order for it to borrow. Written
    // as a bare `toEqual` it passed only because the picker was alphabetical, so M5 step 0 reddened
    // it by putting `forwarding-bubble` (M3) ahead of `branch-bet` (M4): a real change in the
    // product, and nothing this test means to be about. Order is pinned exhaustively, once, against
    // `index.json` above; a second copy here would just be a decision spread across two files —
    // the shape decision 2 of the M5 plan declines — and would redden twice at step 4's reorder.
    expect(
      LESSONS.filter((l) => l.model === 'pipeline')
        .map((l) => l.id)
        .sort(),
    ).toEqual(['branch-bet', 'forwarding-bubble']);
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
