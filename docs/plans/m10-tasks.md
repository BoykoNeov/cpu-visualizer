# Milestone 10 — The out-of-order lesson track

**Status: PLANNED, 2026-07-23. Not started. Mirrors M8 (the superscalar lesson track after M7): the
OoO engine (M9) and its whole visual layer — the bespoke out-of-order datapath, the `MicroTablePanel`
(ROB/RS/rename tables), the flagship in-order↔out-of-order toggle + ROB-size control — all already
exist. M10 is CONTENT plus test-only sweep wiring: a lesson track on `model: out-of-order`, plus the
`configurableOutOfOrder` axis the sweep needs to cover the first OoO lesson at full config coverage.
NO engine or trace change is in scope. Whether a new corpus program is needed is decided from the
step-0 dump, not assumed (unlike M8, whose `branch-slot` witness was known-missing up front).**

Source of truth for scope: `cpu-visualizer-spec.md` §12 (roadmap — OoO is "the north star and the
genuine cliff") and §13 (the curriculum system). The load-bearing constraints are INV-6 (lessons
anchor to trace EVENTS, not cycle numbers), INV-7 (one ISA, one example-program library), INV-5
(lawful simplification — each step authors all three depth tiers), and INV-8 (any new corpus program
is differentially tested on every model). The M9 plan (`docs/plans/m9-tasks.md`) is the model's ground
truth; its line 11 names this milestone explicitly ("the OoO lesson track is a future milestone (M10),
exactly as M8 was the superscalar lesson track after M7").

## Why this milestone, and why now

M9 shipped the out-of-order **engine and its whole visual layer** — renaming, the ROB, reservation
stations, the CDB, wakeup/select issue, the non-blocking load/store unit, the bespoke OoO datapath,
the `MicroTablePanel`, and the flagship in-order↔OoO toggle — but **no lessons**.
`content/lessons/index.json` has four tracks (_The language_, _The machine_, _The cache_, _The wide
machine_) and nothing on out-of-order. Every prior tier that closed with a matching lesson track did
so as its own milestone (M8 closed the superscalar tier this way). So the OoO machine is _observable_
but not _teachable_ — the same gap M8 filled for superscalar.

What is genuinely new here: **this is the FIRST lesson track ever to run on `model: out-of-order`**,
and the first to open a lesson under the OoO config cluster (`outOfOrderIssue` / `robSize` /
`slowOpLatency`). The lesson machinery is proven (M5) and was already swept across models at M8, but
never with this model, and the sweep does not yet have an axis for the OoO knobs (step 0 adds it, the
M7 precedent — see step 0).

## Headline decision — the event multiset is INVARIANT under the toggle; oracles are primary, not the anchors

This is the M10 analogue of M8's "anchor on the refusal `stall`" headline, and it is **inverted**. M8's
teachable superscalar moments each had a dedicated `stall` event with a `reason` string
(`intra-pair-raw` / `mem-port` / `branch-slot`) — three clean, nameable anchors, and the only beat with
_no_ event of its own ("pairing works") was the exception. **For M10, having no event of its own is the
RULE:**

- **The OoO engine emits no `stall` and no `forward` events.** The ROB-full dispatch stall is a bare
  `break` (`out-of-order/src/processor.ts:1112`, no event); the CDB broadcast _is_ the forward, so
  there is no `forward` event (the model's own header: "The CDB broadcasts a result the instant it
  exists — that IS the forwarding path"). Verified by grep across the whole OoO `src`: zero `stall`,
  zero `forward`.
- **The event MULTISET is invariant under `outOfOrderIssue`.** Same program ⇒ the same `alu-op`s, the
  same `mem-read`s, the same `cache-access`es, the same `instr-retire`s fire in _both_ toggle positions.
  Only the **cycle** each lands on, and the **intra-cycle order**, differ. (This is exactly why M9's own
  differential harness is blind to the toggle — INV-8 checks final architectural state, and the toggle
  changes only _when_, not _what_.)

Two consequences that shape every lesson in the track:

1. **No anchor can discriminate the toggle position by itself.** Every pedagogical claim — "the younger
   instruction executed first," "IPC rose," "commit stayed in program order" — must be carried by a
   **by-name narration oracle** that pins the relative event cycles / counterfactual counts, computed
   from the engine at BOTH toggle positions. The anchoring sweep is even blinder here than in M8; plan
   the oracles as the PRIMARY net, not belt-and-suspenders. (M4 step 4's lesson — "51 cycles" shipped
   green over a transport reading 49 — is the standing proof that anchoring is blind to wrong words.)

2. **Anchor by `where` on a program-unique value, never by `nth`.** Under out-of-order issue the "3rd
   `alu-op`" is a _different instruction_ than under in-order issue, so an `nth` anchor drifts across
   toggle positions and across the sweep. Anchor on a value unique to the target instruction (M8's
   `result:19` / `value:55` rule) so the SAME instruction is tracked in both positions, and let the
   oracle assert that its cycle / order _moved_.

**Do NOT revive or add any event** (`issue`, `stall`-for-ROB-full, `rename`, `commit`, …). The house
record is against new events, and the OoO tier is precisely where "the whole story is invisible in the
event stream" will tempt one. M8 step 8 declined the `issue` event _with proof_ (M4 spent 1 schema
field of 5; M6, M7, M8 spent 0). If a beat genuinely cannot be anchored on an existing event, **STOP
and surface it** — that is a real signal, not a licence to invent an event. See "The un-anchorable
beat" below, which is the one place this bites in advance.

## The un-anchorable beat — renaming

Two of the four candidate beats anchor cleanly on existing events + an oracle: out-of-order execution
(a younger op's `alu-op`/`mem-read` lands before an older producer's) and in-order commit
(`instr-retire` in program order while `alu-op` fired out of order). **Renaming has no event and may
not cleanly anchor** — the arch-register → tag mapping lives only in `MachineState.micro` (the rename
table the `MicroTablePanel` draws), and nothing in the event stream names a WAR/WAW that renaming
dissolved. Per the headline's own rule, this is surfaced NOW rather than discovered mid-authoring:

- **Resolution (seeded, confirm against the dump in the renaming step):** anchor the renaming step on
  the SECOND writer's `alu-op` (a program-unique `where`, e.g. the second write to the same arch
  register) — an event that genuinely exists — and let the narration + the rename table in the
  `MicroTablePanel` carry the "same name, two tags, no false wait" point. The oracle pins that the two
  writers both `alu-op` and that the younger did not wait on the older (their cycles under OoO).
- **If even that will not anchor cleanly** (e.g. no corpus program has a clean WAR/WAW independent
  enough to show the payoff), **drop the beat to a 3-lesson track** and say so — do not stretch an
  anchor or add a `rename` event to save it.

## The dump (the design's factual ground) — TO BE FILLED BY STEP 0

Not yet run. Every flagship program / config / cycle-count / IPC number below is a **placeholder** until
step 0's dump fills it. **The "`array-sum` 60→41 live" number in prior session memory is for ONE config
and is a trap** — it is the M8 "cycle 10 was the wrong config" hazard, and M7 step 8's rule ("an
observed cycle is only valid for the config it was observed in") applies with full force. No `nth` /
`where` / counterfactual number is typed from memory; each comes from a fresh dump under the exact
declared config, re-dumped per lesson.

**The matrix step 0 runs** (throwaway `zz-m10-dump.test.ts`, deleted after; outputs under
`M:\claud_projects\temp\m10\`), width fixed at 1 (see the pinned decision — the textbook-Tomasulo
position, isolating the OoO axis from width):

```
{ outOfOrderIssue: false, true }  ×  { cache: off, small, large }  ×  { slowOpLatency: off, on }
```

over the whole corpus. From it, pick — per beat — the program+config where the OoO win is **largest AND
cleanest to anchor**:

- The M9 plan's money shot is "independent loads race ahead of the trickling reduction" (a cache-on
  array-walk — `array-sum` / `array-sum-twice`). Confirm which program actually shows it and whether it
  anchors cleanly at width 1.
- Option B's `slowOpLatency` (verified shipped — `ProcessorConfig.slowOpLatency`) makes the "an RS
  waits N cycles on a slow op while independent work issues around it" story vivid on _any_ program,
  independent of the cache. It is the natural home for the flagship toggle A/B and de-risks the whole
  milestone's dependence on the cache path. The dump decides whether the flagship rides the cache miss
  or the slow op.
- **Whether a new corpus program is needed is a dump OUTPUT, not an assumption.** M8 knew up front its
  `branch-slot` witness was missing; M10 does not. If a shipped program shows a clean, large OoO win,
  no new `.s` is added (and step 0's INV-8 ripples — `RESULT_ORACLES`, the two timing tables — never
  fire). If none is clean, a small purpose-built program is in scope (M8 step 0 precedent), with the
  full INV-8 ripple that entails.

## Build order (each step testable before the next)

- [ ] **0. The dump + the sweep's OoO axis (infrastructure).** Two deliverables, plus a conditional
      third.
      **(a)** Run the matrix dump above; pin the flagship program+config and each beat's program+config
      in this file (fill "The dump" section). No lesson content yet.
      **(b) Add the `configurableOutOfOrder` axis to `CONFIG_AXES`** in
      `packages/web/src/lessons.test.ts` — gated on `caps.configurableOutOfOrder`, positions
      `{ 'in-order issue' → outOfOrderIssue:false, 'out-of-order issue' → outOfOrderIssue:true }`. This
      is the M7 precedent exactly (M7 step 6 added the `issueWidth` axis the step that made it
      REACHABLE, not the step that first used it): no shipped lesson targets `out-of-order` today, so
      the axis contributes nothing until step 1, and that is precisely why it goes in now — the first
      OoO lesson would otherwise be swept at half coverage and nothing would say so. Decide during this
      step whether `robSize` / `slowOpLatency` are ALSO swept axes (they are reachable shell controls
      per M9) or held fixed per-lesson — the rule is REACHABILITY (an unswept reachable config is the
      defect this project keeps finding); if the shell exposes a ROB-size control, that is a reachable
      position and the axis must include it. Update the `positionsFor` guard test's hardcoded
      expected-label list to add the `out-of-order` case (it currently has none — the model ships with
      no lessons). Acceptance: `positionsFor('out-of-order')` enumerates the OoO cross-product; the
      guard test pins the labels; full suites green. NO behavior change to any other model's sweep.
      **(c) CONDITIONAL — a new corpus program**, only if step 0(a)'s dump shows no shipped program with
      a clean+large OoO win. If added, it widens the shared corpus (INV-7) ⇒ swept by every model ⇒ the
      three M8-step-0 hand-derived additions fire as known loud failures: `conformance.ts`
      `RESULT_ORACLES` (model-independent, hand-computed), `pipeline/src/timing.test.ts` `TIMING` (w1
      shape, from the closed form), `superscalar/src/timing.test.ts` `TIMING` (w1+w2 shape). Plus the
      OoO model has its OWN `timing.test.ts` (`out-of-order/src/timing.test.ts`) — check whether its
      corpus guard fires too. Acceptance for (c): `npm test` green across all models at every config,
      all timing guards satisfied, INV-8 passes for the new program on every model.

- [ ] **1. Lesson — the flagship toggle ("Work slides ahead").** `model: out-of-order`, the flagship
      program+config from the dump, `issueWidth: 1`, `outOfOrderIssue: true`. THE crown-jewel lesson,
      the OoO analogue of M3's forwarding toggle and M7's width toggle: out-of-order issue lets a
      younger independent instruction execute while an older one waits (on a slow op or a cache miss),
      so independent work slides ahead and IPC rises. Counterfactual: in-order issue stalls everything
      behind the waiting op. Anchor on a program-unique `where` (the younger op's `alu-op`/`mem-read`
      value); the narration oracle pins BOTH positions' cycle counts / IPC (computed from the engine at
      `outOfOrderIssue` false and true) and the relative order of the younger vs the older event.
      **Because the event multiset is toggle-invariant, extend `session.test.ts`'s shipped-lesson
      opening loop to assert the lesson OPENS at `outOfOrderIssue: true`** (the M8-step-1 move: the
      generic sweep bypasses `lessonOpening` and cannot see the opening config — here the failure mode
      is the engine reading `outOfOrderIssue ?? false` and silently recording the in-order trace with
      every anchoring test green, the exact `issueWidth ?? 1` trap M8 guarded). Wire the track NOW with
      just this lesson (LESSONS is globbed — a lesson file cannot exist un-wired; the moment it lands the
      `LESSONS.length` / `LESSON_ORDER` / `lessonSections()` / track-name guards fire), so add the new
      track heading to `index.json` with this one id; steps 2–4 append. Grep every track/count guard
      across the web tests before editing.

- [ ] **2. Lesson — renaming ("A new name for a register").** The un-anchorable beat (see above) —
      confirm the seeded resolution against the dump before authoring: anchor on the second writer's
      `alu-op`, narration + the rename table carry the WAR/WAW-dissolved point. If it will not anchor
      cleanly, drop this step and ship a 3-lesson track (say so here). Width 1. Oracle pins the two
      writers' `alu-op`s and that the younger did not serialize behind the older.

- [ ] **3. Lesson — in-order commit ("Finish early, commit in order").** The ROB's precise-state job:
      instructions COMPLETE out of order (their `alu-op`/`mem-read` land in a non-program order) but
      RETIRE in program order (`instr-retire` events are monotone in program order). Anchor on an
      `instr-retire` `where` (program-unique) at the head; the oracle pins that some `alu-op` fired
      out-of-order-of-retirement earlier — the completion/commit order divergence IS the lesson. Width 1.

- [ ] **4. Lesson (CONDITIONAL) — the reservation station / slow op ("The reservation station holds").**
      The Tomasulo namesake, needs `slowOpLatency` on (verify the dump shows a clean witness): an RS
      holds an instruction across N execute cycles; when the CDB broadcasts the result, its dependents
      wake and issue. Anchor on the slow op's `alu-op` (the result lands N cycles after issue) and a
      dependent's `alu-op` waking after it. Ship only if the dump gives a clean witness; otherwise the
      track is steps 1–3. Width 1.

- [ ] **5. Wire the track.** Mostly done incrementally by steps 1–4 (the glob forces it). What remains:
      the by-name track-membership assertion in `lessons.test.ts`'s "files each lesson under the track
      its SUBJECT belongs to — asserted by name" test (the one net a mis-file slips past — `lessonSections()`
      totality stays green even under a wrong-track filing, because `LESSON_ORDER` derives from the same
      `index.json`), and pinning the track name + teaching order. Acceptance: `lessonSections` returns
      the new track with all its lessons resolved and none under `UNTRACKED_HEADING`; full suites green.

- [ ] **6. Browser pass — the only net that sees this.** Drive the SHIPPED BUNDLE (`vite preview`,
      `--strictPort`, identified by served `<title>`, CDP on a random high debug port, target by URL
      with a throw and no fallback — the [[browser-is-the-only-net]] recipe; do NOT kill Chrome by port,
      identify by title). Rig under `M:\claud_projects\temp\m10-browser\`. Verify: the picker shows the
      new track with its lessons in teaching order; each loads `model=out-of-order` with the
      **out-of-order** toggle pressed (read off the toggle's `aria-pressed`, scoped to the OoO control —
      NOT the first pressed `.seg-btn`, the M8 trap); narration fires at every anchored cycle at the
      current depth tier; the `MicroTablePanel` (ROB/RS/rename tables) renders coherently at each
      anchored step; and the flagship's IPC/cycle numbers read off the live transport MATCH the oracle
      (the toggle discriminator — flip to in-order and watch the same answer with a higher cycle count).
      Fix any prose-vs-picture INV-5 tension IN SCOPE by rewording (content only), as M8 step 6 did with
      "one branch unit" — a datapath/table _drawing_ decision is M9 view code, out of M10's scope.

## Acceptance criteria (mirror the spec §11 shape)

- [ ] The picker shows a new OoO track; each of its lessons loads `model: out-of-order` at
      `issueWidth: 1` with `outOfOrderIssue: true`, and plays through with narration on the correct
      events (INV-6). Confirmed in the browser (step 6).
- [ ] The flagship lesson's cycle-count / IPC counterfactual (in-order vs out-of-order) matches the
      engine at BOTH toggle positions, pinned by a by-name narration oracle — NOT the anchoring sweep,
      which is toggle-blind by construction (the headline).
- [ ] Every anchor uses a program-unique `where`, not `nth` (so it tracks the same instruction across
      the toggle and the sweep).
- [ ] The sweep covers the OoO config cluster: `positionsFor('out-of-order')` enumerates the honored
      OoO positions and every lesson is swept over all of them, anchoring in order with resolvable
      narration in each (INV-6 across configs).
- [ ] The renaming beat either anchors cleanly on an existing event (+ table/narration) or is dropped
      with the reason recorded — no `rename`/`issue`/`commit` event added.
- [ ] If a new corpus program was added: it passes INV-8 on every model, and every timing guard that
      enumerates the corpus (pipeline, superscalar, out-of-order) covers it with hand-derived cells.
- [ ] All suites green; `npm run lint`, `tsc -b`, `npm run build` green. Browser pass clean (any
      prose-vs-picture finding fixed in-scope by rewording).

## How this milestone can lie to itself

- **INV-8 is a false safety net here, twice over.** The OoO engine retires in order, so conformance
  passes even if the whole scheduler is wrong; and it is blind to the toggle entirely (same final
  state either way). It secures a new program's ARCHITECTURAL result; it says nothing about whether the
  lesson's TIMING/ordering claims are true. The narration oracles are the only real net for those.
- **The anchoring sweep is blind to the toggle AND to pedagogy.** A step that fires at the wrong beat,
  or prose quoting the wrong toggle-position's number, passes the sweep — worse than M8, because here
  the SAME events fire in both positions, so even "the anchor fired" proves nothing about which machine
  ran. Every lesson carries a positive narration oracle by name.
- **A remembered cycle is a config-specific fact** — and the "60→41" in prior memory is exactly such a
  carried number. Re-dump under each lesson's exact config before pinning any `nth`/`where`/counterfactual;
  never carry a number across a config boundary (M7 step 8, M8's "how this milestone can lie").
- **Renaming has no witness in the event stream.** The temptation to add a `rename` or `issue` event to
  "make it teachable" is the milestone's characteristic failure. The rule is the same as M8's readout:
  the last chance to prove a new event necessary was the view layer, and it did not.

## Decisions to pin (seeded with recommended answers)

- **Issue width.** `issueWidth: 1` for the whole track — the M9-plan-§120–122 textbook-Tomasulo
  position, isolating the OoO axis from width (width×OoO is explicitly deferred to a later track, no
  rebuild needed). Verify the OoO win stays vivid at width 1 in the dump.
- **Track heading.** Working title _The out-of-order machine_. (Alternatives: _Out of order_, _The
  Tomasulo machine_, _Finishing early_.) Pin during step 5.
- **Lesson order within the track.** Flagship toggle first (the payoff — "work slides ahead"), then
  renaming (why the reorder is legal), then in-order commit (why it is safe / precise), then the RS
  slow-op namesake (the mechanism), if it survives the dump. Ordering is content, declared in
  `index.json`.
- **Flagship program + config.** From the step-0 dump — the largest, cleanest OoO win at width 1.
  Cache-on array-walk (M9 money shot) vs `slowOpLatency`-on any program; the dump decides.
- **New corpus program?** A dump output, not an assumption. Add only if no shipped program shows a
  clean+large OoO win; then pay the full INV-8 corpus-widening ripple.
- **Do NOT add an `issue` / `stall` / `rename` / `commit` event.** Re-affirmed. Every beat anchors on an
  existing event + a narration oracle, or is dropped.
- **Sweep axis scope.** `configurableOutOfOrder` gates the `outOfOrderIssue` axis (2 positions). Whether
  `robSize` / `slowOpLatency` are swept axes or held per-lesson is decided in step 0 by reachability
  (what the shell exposes as a control).
