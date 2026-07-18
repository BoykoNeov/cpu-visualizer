/**
 * React binding for the {@link TraceRecorder}. The recorder is imperative and lives in a
 * ref; a bare tick counter forces re-render after each transport action. Its ONLY job is to
 * re-render — every piece of displayed data is read live from `recorder.currentState()` /
 * `recorder.current()` during render, never shadow-copied into React state. That is what
 * makes "shown state always matches the recorded trace at the cursor" hold by construction
 * (acceptance §11).
 */

import type { AssembledProgram, AssemblerError } from '@cpu-viz/assembler';
import { anchorLesson, type AnchoredStep, type Lesson } from '@cpu-viz/curriculum';
import {
  defaultConfig,
  type CacheConfig,
  type CycleTrace,
  type MachineState,
} from '@cpu-viz/trace';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_MODEL_ID, modelById } from './models';
import { EXAMPLE_PROGRAMS } from './programs';
import {
  activeLessonOf,
  exampleSession,
  forkToSandbox,
  lessonOpening,
  lessonSession,
  originNameOf,
  predictsTaken,
  type BranchPrediction,
  type Session,
} from './session';
import { loadSource, type LoadedProgram } from './simulator';

/**
 * Teaching-scale ceiling on how many cycles we record for one program. Well under the
 * recorder's 1M default: a user-edited program (the step-11 sandbox fork) can loop forever,
 * and a frozen tab is worse than a friendly "ran too long" message. The shipped corpus all
 * halts in well under this.
 *
 * Note (M2 step 5a): the cap counts CYCLES, and multi-cycle spends 3–5× more cycles per
 * instruction than single-cycle. So a *sandbox* program that halts just under the cap on
 * single-cycle could exceed it on multi-cycle and surface the "ran too long" notice. The margin
 * is enormous (the corpus halts in the low hundreds of cycles even multiplied), so this is only a
 * theoretical edge for a hand-crafted sandbox program near the ceiling — acceptable at this step;
 * if it ever bites, make the cap per-instruction rather than per-cycle.
 */
const TEACHING_MAX_CYCLES = 50_000;

/** The "nothing loaded" recording. A module-level constant rather than a fresh `[]` per render:
 *  consumers memoize on the recording's identity, and a new empty array each render would defeat
 *  that (and re-fold the map) for no reason. */
const EMPTY_RECORDING: readonly CycleTrace[] = [];

/** Everything the UI needs to render and drive the simulation. */
export interface Simulator {
  /**
   * The corpus program backing the current session: the selected example/lesson program, or
   * the program a sandbox forked from. `null` before the first load. (In a sandbox this is the
   * fork origin, not what is running — see {@link loadedSource} for the running source.)
   */
  programName: string | null;
  /**
   * The id of the microarchitecture currently driving the recording (e.g. `'single-cycle'`,
   * `'multi-cycle'`). The picker swaps it; every panel reads only the trace (INV-3), so they all
   * animate against the selected model unchanged.
   */
  model: string;
  /**
   * Whether the driving engine is configured to forward (`ProcessorConfig.forwarding`) — the
   * spec's flagship experiment (§12): flip it and watch the same program's bubbles vanish. Held
   * at SESSION level and handed to every model, not just the pipeline: a config-blind engine is
   * simply unmoved by it (pinned in `simulator.test.ts`), so the value survives a trip through
   * single-cycle and is still set when the user comes back. Only models whose
   * `capabilities.configurableForwarding` is true have a control for it (M3 step 5).
   */
  forwarding: boolean;
  /**
   * The branch-prediction scheme the driving engine is configured with
   * (`ProcessorConfig.branchPrediction`) — M4's toggle, riding the very seam M3 step 5 cut for
   * forwarding: session level, handed to every model, gated only as a CONTROL on
   * `capabilities.configurableBranchPrediction`. The seam paid off; it needed no widening.
   *
   * Three names, **two behaviors** — `'none'` and `'static-not-taken'` are one machine (M4 step 1),
   * so read it through {@link predictsTaken} rather than comparing values. It starts at
   * `defaultConfig()`'s `'none'`, which is the one moment that value is live in the shell: the
   * control only ever writes the two behaviors by their explicit names.
   */
  branchPrediction: BranchPrediction;
  /**
   * The D-cache geometry the driving engine is configured with (`ProcessorConfig.cache`), or `null`
   * for no cache — M6's toggle, the third to ride M3's config seam without widening it: session
   * level, handed to every model, gated only as a CONTROL on `capabilities.configurableCache`.
   *
   * Unlike forwarding and prediction (two behaviors each), the cache has THREE distinct machines —
   * off, small, and large all record differently (off emits no `cache-access` at all; small and
   * large diverge only on a working set that straddles them). So the control has three positions,
   * each a real move, and the value is one of the three stable geometries
   * (`null` / `CACHE_SMALL` / `CACHE_LARGE`) rather than a freely-built object. Opens on
   * `defaultConfig()`'s `null` — the pedagogically right first move is to watch the machine with no
   * cache, then add one and watch the misses (and the size flip) appear.
   */
  cache: CacheConfig | null;
  /** The lesson whose steps are attached, or `null` in free-play / after a sandbox fork (§13). */
  activeLesson: Lesson | null;
  /**
   * The active lesson's steps anchored against the current (complete) recording — the input
   * to the narration panel's play-through (INV-6). `null` in free-play / sandbox (no lesson).
   * Anchored once per (lesson, recording) and re-queried by cursor/tier in the view, so a
   * scrub or depth change re-resolves narration without re-anchoring.
   */
  anchoredSteps: AnchoredStep[] | null;
  /** True when the running program is user-edited (the spec §13 sandbox fork). */
  sandbox: boolean;
  /**
   * Increments each time a fresh corpus program is loaded (`select` / `startLesson`) — but NOT
   * on a sandbox edit. The editor uses it to reseed its draft to the pristine source even when
   * the *same* program is re-selected (leaving a sandbox), which a name-only signal misses.
   */
  loadGen: number;
  /** The assembled program (source-map + words back the source panel), or `null`. */
  program: AssembledProgram | null;
  /** The source text that produced the loaded program — the edited text in a sandbox. `null`
   *  before the first successful load. */
  loadedSource: string | null;
  /** Assembler diagnostics from the last load, or `null` if it assembled cleanly. */
  errors: AssemblerError[] | null;
  /**
   * A runtime message when the program was abandoned mid-run (e.g. it exceeded
   * {@link TEACHING_MAX_CYCLES} without halting), or `null`. Mutually exclusive with
   * {@link errors} — a program either fails to assemble or fails to terminate, never both.
   */
  runtimeError: string | null;

  /** Timeline position: -1 = pre-run ("start"), otherwise the recorded cycle index. */
  cursor: number;
  /** Total cycles recorded (the scrub bar's upper bound is `recordedCycles - 1`). */
  recordedCycles: number;
  /** True when parked on the final cycle of a halted run. */
  atEnd: boolean;
  /** Full architectural state at the cursor, or `null` before any program loads. */
  state: MachineState | null;
  /** The trace at the cursor (events + in-flight instructions), or `null` at pre-run. */
  cycleTrace: CycleTrace | null;
  /**
   * The WHOLE recording, every cycle of it — for surfaces that fold the entire timeline rather than
   * reading the cursor's cycle. The pipeline map (M3 step 7) is the first: it is a grid of
   * instructions × cycles, so it needs the run, not the instant.
   *
   * That makes it the second consumer of a complete recording, after `anchorLesson`, and it holds
   * the same precondition for the same reason: `loadInto` runs the program to the end before
   * `loaded.current` is set, so by the time anything can read this it is whole (the recorder records
   * lazily at its high-water mark). Empty before the first load. A fresh load builds a fresh
   * recorder, so the array IDENTITY changes per recording — which is what lets a consumer memoize on
   * it, and what tells the shell a followed instruction's id belongs to a recording that no longer
   * exists.
   */
  recorded: readonly CycleTrace[];

  /**
   * Switch the driving microarchitecture and re-load the current source under it (same program,
   * same session; cursor parks at the pre-run state). A no-op if the model is already selected —
   * so it never needlessly discards the cursor. The recorder has no in-place engine swap, so a
   * fresh load is the mechanism; the new recorder re-anchors any active lesson against the new
   * model's trace (INV-6).
   */
  setModel: (id: string) => void;
  /**
   * Flip `ProcessorConfig.forwarding` and re-record the current source under it (same program,
   * same session, same model; the cursor parks at pre-run). The flagship interaction: the trace
   * genuinely changes, so there is nothing to update in place — a fresh recording IS the
   * mechanism, exactly as {@link setModel} does for the engine. A no-op if already in that
   * position, so it never needlessly discards the cursor.
   */
  setForwarding: (on: boolean) => void;
  /**
   * Set `ProcessorConfig.branchPrediction` and re-record the current source under it — the same
   * shape as {@link setForwarding}, for the same reason: the trace genuinely changes, so a fresh
   * recording IS the mechanism.
   *
   * The no-op guard is on the BEHAVIOR, not the value: `'none'` and `'static-not-taken'` are one
   * machine, so asking for the scheme the machine is already running re-records nothing even when
   * the string differs. Without that, clicking the already-lit "not taken" button at startup (where
   * the config still reads `'none'`) would throw away the cursor to rebuild a byte-identical
   * timeline.
   */
  setBranchPrediction: (scheme: BranchPrediction) => void;
  /**
   * Set `ProcessorConfig.cache` and re-record the current source under it — the same shape as
   * {@link setForwarding}, for the same reason: the trace genuinely changes (a different geometry
   * hits and misses differently, changing the cycle count), so a fresh recording IS the mechanism.
   *
   * The no-op guard is plain identity (`geometry === cacheRef.current`) rather than a deep compare,
   * because the shell only ever sets one of the three stable module constants
   * (`null` / `CACHE_SMALL` / `CACHE_LARGE`) — it never builds a fresh `CacheConfig`, so referential
   * equality already answers "is this the machine we are running". (Deep-comparing geometry is
   * conformance's job, where two configs can be built independently; here they cannot.)
   *
   * **Step-7 caveat.** This identity assumption breaks the moment a lesson DECLARES a non-null cache:
   * `lesson.config.cache` arrives JSON-parsed — a fresh `{lineSize,numLines,missPenalty}` object that
   * is `===`-unequal to both constants — so it would light no toggle position and could misfire this
   * guard. That is the same trap prediction dodged by comparing BEHAVIOR (`predictsTaken`) not the
   * value. Step 7 must reconcile it: either map a declared geometry back to its canonical constant on
   * the way in, or switch this guard and {@link CacheToggle}'s lit-detection to a value/deep compare
   * (`cacheEquals` from the step-3 `configLabel` work already exists). Unreachable until then — both
   * shipped pipeline lessons declare `cache: null`.
   */
  setCache: (geometry: CacheConfig | null) => void;
  /** Load an example program by name (free-play); parks the cursor at the pre-run state. */
  select: (name: string) => void;
  /** Start following an authored lesson: load its program and attach its steps. */
  startLesson: (lesson: Lesson) => void;
  /**
   * Fork into a sandbox on the user's edited source (§13): assemble + record the edited
   * program and DETACH any active lesson. Same driver path as {@link select}, so the sandbox
   * run animates identically.
   */
  loadEdited: (source: string) => void;
  stepForward: () => void;
  stepBack: () => void;
  runToEnd: () => void;
  /** Return to the pre-run state (cursor -1). */
  reset: () => void;
  /** Jump the cursor to an arbitrary cycle (clamped by the recorder). */
  scrubTo: (cycle: number) => void;
}

export function useSimulator(): Simulator {
  const loaded = useRef<LoadedProgram | null>(null);
  const [, setTick] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  // Bumped only on a fresh corpus load, so the editor can reseed its draft even on a same-name
  // re-select (see `loadGen` in the interface). A sandbox edit deliberately does NOT bump it —
  // the user's in-progress text must survive a re-record.
  const [loadGen, setLoadGen] = useState(0);
  const [errors, setErrors] = useState<AssemblerError[] | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  // The selected model id drives rendering (picker value, header, datapath gating); the factory
  // that BUILDS the engine lives in a ref so `loadInto` can read it at call time without taking
  // `model` as a dependency — otherwise `select` (which depends on `loadInto`) would change
  // identity on a model switch and re-fire the mount effect, clobbering the current program.
  const [model, setModelState] = useState<string>(DEFAULT_MODEL_ID);
  const makeProcessor = useRef(modelById(DEFAULT_MODEL_ID).make);
  // The forwarding position, mirroring `model`/`makeProcessor` exactly: the state drives
  // rendering (the toggle's position), the ref is what `loadInto` reads at call time so the load
  // path takes no dependency on it. Starts OFF — the pedagogically right opening move is to watch
  // a RAW hazard stall first, THEN flip it on and watch the bubble vanish (§12.2).
  const [forwarding, setForwardingState] = useState(false);
  const forwardingRef = useRef(forwarding);
  // Prediction, mirroring forwarding exactly (M4 step 4). Opens on `defaultConfig()`'s value rather
  // than a scheme named here: the shell's job is to hold the config, not to re-decide its default.
  // That value is `'none'`, whose behavior is not-taken — the pedagogically right opening move for
  // the same reason forwarding starts off: watch the machine pay for every taken branch FIRST, then
  // bet and watch the penalty fall (and, on `call-return`, RISE).
  const [branchPrediction, setBranchPredictionState] = useState<BranchPrediction>(
    defaultConfig().branchPrediction,
  );
  const branchPredictionRef = useRef(branchPrediction);
  // The cache geometry, mirroring forwarding/prediction exactly (M6 step 5). Opens on
  // `defaultConfig()`'s `null` (no cache) — the pedagogically right first move for the same reason
  // forwarding starts off and prediction starts not-taken: watch the machine with no cache first,
  // then add one and watch the misses appear, then flip the size and watch the straddler slow down.
  const [cache, setCacheState] = useState<CacheConfig | null>(defaultConfig().cache);
  const cacheRef = useRef(cache);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  // Assemble + record `source`, parking the cursor at the pre-run state. Shared by every entry
  // point (`select` / `startLesson` / `loadEdited`) — the mode differs only in the `session`
  // set beforehand; the driver path is identical, which is why "the sandbox run still animates
  // correctly" (§11 acceptance) holds by construction. On assembler failure or a runaway
  // recording it clears `loaded` and surfaces the matching error channel (the two are mutually
  // exclusive: a program either fails to assemble or fails to terminate, never both).
  const loadInto = useCallback(
    (source: string) => {
      const result = loadSource(source, makeProcessor.current, {
        ...defaultConfig(),
        forwarding: forwardingRef.current,
        branchPrediction: branchPredictionRef.current,
        cache: cacheRef.current,
      });
      if (!result.ok) {
        loaded.current = null;
        setErrors(result.errors);
        setRuntimeError(null);
        rerender();
        return;
      }
      // Record every cycle up front so the scrub bar is full-length, then park at the
      // pre-run state so the user starts at the beginning (a fixed-length timeline). A
      // user-edited program (sandbox fork) may never halt, so cap the up-front recording:
      // on overflow, discard the (non-halted) recording — keeping it would re-throw on the
      // next scrub-forward — and surface a friendly message in place of the transport.
      const { recorder } = result.loaded;
      try {
        recorder.runToEnd(TEACHING_MAX_CYCLES);
      } catch {
        loaded.current = null;
        setErrors(null);
        setRuntimeError(
          `This program ran for more than ${TEACHING_MAX_CYCLES.toLocaleString()} cycles ` +
            `without finishing — it may loop forever. Edit it so it halts (e.g. reach ` +
            `“li a7, 10; ecall”) and try again.`,
        );
        rerender();
        return;
      }
      recorder.scrubTo(-1, TEACHING_MAX_CYCLES);
      loaded.current = result.loaded;
      setErrors(null);
      setRuntimeError(null);
      rerender();
    },
    [rerender],
  );

  const select = useCallback(
    (name: string) => {
      const example = EXAMPLE_PROGRAMS.find((p) => p.name === name);
      if (!example) return;
      setSession(exampleSession(name));
      setLoadGen((g) => g + 1);
      loadInto(example.source);
    },
    [loadInto],
  );

  const startLesson = useCallback(
    (lesson: Lesson) => {
      const example = EXAMPLE_PROGRAMS.find((p) => p.name === lesson.program);
      if (!example) return; // a lesson referencing a program not in the corpus — ignore (INV-7)
      // Open the lesson on the model it was AUTHORED against, in the config it declares — see
      // `lessonOpening`, which owns that decision and its reasoning. Both fields were
      // declared-and-ignored until M3 step 8. The refs are what `loadInto` reads at call time, so
      // they must be set BEFORE it runs; the states drive the picker + toggle. Deliberately not
      // routed through `setModel`/`setForwarding`: each of those re-loads on its own, so a lesson
      // that changed both would record the program three times over.
      const opening = lessonOpening(lesson, {
        forwarding: forwardingRef.current,
        branchPrediction: branchPredictionRef.current,
        cache: cacheRef.current,
      });
      const choice = modelById(opening.modelId);
      makeProcessor.current = choice.make;
      setModelState(choice.id);
      forwardingRef.current = opening.forwarding;
      setForwardingState(opening.forwarding);
      branchPredictionRef.current = opening.branchPrediction;
      setBranchPredictionState(opening.branchPrediction);
      cacheRef.current = opening.cache;
      setCacheState(opening.cache);
      setSession(lessonSession(lesson));
      setLoadGen((g) => g + 1);
      loadInto(example.source); // once — the refs above are already the new model/config
    },
    [loadInto],
  );

  const loadEdited = useCallback(
    (source: string) => {
      // The fork (§13): detach any active lesson, then record the edited program. Functional
      // update so the origin is derived from whatever session was current.
      setSession((prev) => forkToSandbox(prev));
      loadInto(source);
    },
    [loadInto],
  );

  const setModel = useCallback(
    (id: string) => {
      const choice = modelById(id);
      if (choice.id === model) return; // already selected — keep the cursor where it is
      makeProcessor.current = choice.make; // read by loadInto below (and every later load)
      setModelState(choice.id);
      // Re-drive whatever is currently loaded under the new engine. `loaded.current.source` is
      // always the exact running source — the corpus program in free-play/lesson mode, or the
      // user's edited text in a sandbox — so re-loading it keeps the session (and any lesson)
      // intact while swapping the microarchitecture. Nothing loaded yet ⇒ the mount effect will
      // load under the new factory anyway.
      const source = loaded.current?.source;
      if (source != null) loadInto(source);
    },
    [model, loadInto],
  );

  const setForwarding = useCallback(
    (on: boolean) => {
      if (on === forwardingRef.current) return; // already there — keep the cursor where it is
      forwardingRef.current = on; // read by loadInto below (and every later load)
      setForwardingState(on);
      // Re-record whatever is loaded under the new config. Same shape as `setModel`: the source
      // is the exact running text (corpus program or sandbox edit), so re-loading keeps the
      // session and any active lesson intact while changing only the microarchitecture's config.
      // The lesson re-anchors against the new recording — its steps anchor to EVENTS, so they
      // survive the cycle numbers moving underneath them (INV-6).
      const source = loaded.current?.source;
      if (source != null) loadInto(source);
    },
    [loadInto],
  );

  const setBranchPrediction = useCallback(
    (scheme: BranchPrediction) => {
      // Guarded on BEHAVIOR, not on the string — see `setBranchPrediction` in the interface. The
      // state still moves to the requested name so the config reads as what the user asked for; it
      // is only the RE-RECORD that is skipped, because there is no different timeline to build.
      const same = predictsTaken(scheme) === predictsTaken(branchPredictionRef.current);
      branchPredictionRef.current = scheme; // read by loadInto below (and every later load)
      setBranchPredictionState(scheme);
      if (same) return; // same machine — keep the cursor where it is
      const source = loaded.current?.source;
      if (source != null) loadInto(source);
    },
    [loadInto],
  );

  const setCache = useCallback(
    (geometry: CacheConfig | null) => {
      if (geometry === cacheRef.current) return; // already there — keep the cursor where it is
      cacheRef.current = geometry; // read by loadInto below (and every later load)
      setCacheState(geometry);
      // Re-record whatever is loaded under the new cache. Same shape as `setForwarding`: the source
      // is the exact running text, so re-loading keeps the session and any active lesson intact
      // while changing only the machine's cache. The lesson re-anchors against the new recording —
      // its steps anchor to EVENTS, so they survive the cycle numbers moving underneath them (INV-6).
      const source = loaded.current?.source;
      if (source != null) loadInto(source);
    },
    [loadInto],
  );

  // Load a program on mount so the shell is never empty. Prefer `sum-loop` — a short
  // counting loop is the clearest first teaching example; `add` (which sorts first) halts
  // by running off text-end, so its final pc is an out-of-range value that reads as odd.
  useEffect(() => {
    const first = EXAMPLE_PROGRAMS.find((p) => p.name === 'sum-loop') ?? EXAMPLE_PROGRAMS[0];
    if (first) select(first.name);
  }, [select]);

  const stepForward = useCallback(() => {
    loaded.current?.recorder.stepForward();
    rerender();
  }, [rerender]);
  const stepBack = useCallback(() => {
    loaded.current?.recorder.stepBack();
    rerender();
  }, [rerender]);
  // These only ever replay already-recorded cycles today (`select` records the whole program
  // up front, so the engine is halted), so their guard loops can't fire — but pass the cap
  // anyway to stay correct if recording ever becomes lazy.
  const runToEnd = useCallback(() => {
    loaded.current?.recorder.runToEnd(TEACHING_MAX_CYCLES);
    rerender();
  }, [rerender]);
  const reset = useCallback(() => {
    loaded.current?.recorder.scrubTo(-1, TEACHING_MAX_CYCLES);
    rerender();
  }, [rerender]);
  const scrubTo = useCallback(
    (cycle: number) => {
      loaded.current?.recorder.scrubTo(cycle, TEACHING_MAX_CYCLES);
      rerender();
    },
    [rerender],
  );

  const recorder = loaded.current?.recorder ?? null;
  const activeLesson = activeLessonOf(session);
  // Anchor the active lesson against the COMPLETE recording (INV-6). `loadInto` runs the
  // program to end (or discards it on overflow) before `loaded.current` is set, so by the time
  // a recorder is in hand its `recorded` trace is whole — the runner's precondition. Keyed on
  // (lesson, recorder): a re-select or sandbox edit makes a fresh recorder, so this recomputes;
  // a scrub or depth change does not, and re-queries the cached anchors in the view instead.
  const anchoredSteps = useMemo(
    () => (activeLesson && recorder ? anchorLesson(activeLesson, recorder.recorded) : null),
    [activeLesson, recorder],
  );
  return {
    model,
    forwarding,
    branchPrediction,
    cache,
    programName: originNameOf(session),
    activeLesson,
    anchoredSteps,
    sandbox: session?.kind === 'sandbox',
    loadGen,
    program: loaded.current?.program ?? null,
    loadedSource: loaded.current?.source ?? null,
    errors,
    runtimeError,
    cursor: recorder?.cursor ?? -1,
    recordedCycles: recorder?.recordedCycles ?? 0,
    atEnd: recorder?.atEnd ?? false,
    state: recorder ? recorder.currentState() : null,
    cycleTrace: recorder ? recorder.current() : null,
    recorded: recorder?.recorded ?? EMPTY_RECORDING,
    setModel,
    setForwarding,
    setBranchPrediction,
    setCache,
    select,
    startLesson,
    loadEdited,
    stepForward,
    stepBack,
    runToEnd,
    reset,
    scrubTo,
  };
}
