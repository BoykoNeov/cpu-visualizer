# Milestone 8 — The superscalar lesson track

**Status: NOT STARTED, 2026-07-20. Nothing built. The design is grounded in a real width-1/width-2
trace dump of the whole corpus (see "The dump" below), not in memory — the anchors and every quoted
number will come from that dump per (program × config), following the pinned repo rule. No engine or
trace change is expected: the superscalar engine (M7) and the lesson machinery (M5) both already
exist; this milestone is CONTENT plus one new corpus program.**

Source of truth for scope: `cpu-visualizer-spec.md` §12 (roadmap) and §13 (the curriculum system).
The load-bearing constraints are INV-6 (lessons anchor to trace EVENTS, not cycle numbers), INV-7
(one ISA, one example-program library), INV-5 (lawful simplification — each step authors all three
depth tiers), and INV-8 (a new corpus program is differentially tested on every model).

## Why this milestone, and why now

M7 shipped the superscalar **engine and its whole visual layer** — the widened datapath, the pairing
readout, the IPC tile — but **no lessons**. `content/lessons/index.json` has three tracks (_The
language_, _The machine_, _The cache_) and nothing on superscalar. M6 closed its tier with a matching
lesson track (its step 7); M7 did not. So the width toggle is _observable_ but not _teachable_.

This is also the spec's stated precondition for the next tier. §12 calls out-of-order "the north
star and the genuine cliff" and says outright: **do not approach it until the in-order experience is
completely nailed.** A superscalar the learner can watch but not be _taught_ is not nailed. This
milestone is the cheap move that discharges that precondition before tier 5.

What is genuinely new here: **`session.ts:198` says it in the code — this is the FIRST lesson ever to
run on `model: superscalar`.** The lesson machinery is proven (M5), but never with this model, and
never at `issueWidth: 2`. The M7-step-6 sweep added the `issueWidth` axis to `positionsFor`
(`lessons.test.ts`) precisely so the first superscalar lesson would be swept at full coverage — that
scaffolding is in place and unused, waiting for exactly this.

## The dump (the design's factual ground)

Ran the superscalar engine over the whole corpus at width 1 and width 2 (a throwaway
`zz-m8-dump.test.ts`, since deleted; outputs in `M:\claud_projects\temp\m8\`). The load-bearing
facts, at **forwarding ON, cache OFF, predict not-taken** unless noted:

| program           | w1 cycles | w2 cycles | IPC w1 → w2   | w2 refusals                            |
| ----------------- | --------- | --------- | ------------- | -------------------------------------- |
| `sum-loop`        | 56        | 44        | 0.607 → 0.773 | **none** — pairs cleanly               |
| `array-sum`       | 51        | 42        | 0.667 → 0.810 | `intra-pair-raw` ×11                   |
| `array-sum-twice` | 208       | 178       | 0.644 → 0.753 | `intra-pair-raw` ×50                   |
| `byte-loads`      | 10        | 9         | 0.600 → 0.667 | `intra-pair-raw` ×2, **`mem-port` ×1** |

Two findings that shape the plan:

1. **`branch-slot` has no witness in the corpus.** Across all 7 programs × 8 config positions
   (forwarding × prediction × the two widths), the `branch-slot` refusal reason fires **zero times**.
   The rule is "no two control transfers issue together" (`processor.ts:1420`), and no shipped
   program ever places two adjacent — `branch-flavors.s` separates every branch with an `mv`. The
   engine can refuse for it, the datapath draws it, the readout names it, and _nothing can reach it_.
   **Decision (user, 2026-07-20): add a 4th corpus program to provoke it** rather than teach around
   it — so the lesson set covers all three refusal reasons the machine has. **The provocation is
   already CONFIRMED against a dump** (not assumed): a candidate with two adjacent `bne x0,x0` as
   instructions 0 and 1 emits `{"reason":"branch-slot","stage":"ID","instr":"i1"}` at cycle 1, both
   branches not-taken so NO flush coexists — the clean, flush-free witness. 7 cycles, `a0 = 42`. The
   fetch-group alignment that this rests on (the two transfers must land in one issue group) is
   guaranteed by making them the first two instructions; setup ahead of them would shift it.

2. **Memory's remembered cycle numbers are for the wrong config.** The pinned note recalls
   "`array-sum` cycle 10 = `intra-pair-raw`"; in _this_ lesson's config (cache off, forwarding on) the
   first `intra-pair-raw` is at **cycle 1**. That is the M7-step-8 trap — "an observed cycle is only
   valid for the config it was observed in" — waiting to fire again. **Every anchor comes from the
   dump, re-dumped under each lesson's exact declared config; no `nth`/`where` is typed from memory.**

## Headline decision — anchor on the refusal `stall`; do NOT revive the `issue` event

The teachable superscalar moments split by how they anchor, and that split IS the design:

- **A refusal anchors cleanly.** `{ event: 'stall', where: { reason: 'intra-pair-raw' } }` (or
  `mem-port` / `branch-slot`). The engine emits these as ordinary `stall` events with a pairing
  reason string (`processor.ts:1300`) — confirmed present in the dump. This is the meat of the track.
- **A SUCCESSFUL pair has no event of its own.** The `issue` event was DECLINED WITH PROOF in M7
  (step 8's headline: M4 spent 1 schema field of 5, M6 and M7 spent 0). We do **not** revive it. A
  "pairing works" lesson anchors by _counting ordinary events on the paired cycle_ — e.g.
  `instr-fetch nth:2` lands on the cycle a pair is fetched together, `alu-op nth:k` on the cycle
  they are both in EX. The exact counts come from the dump, per the pinned "dump the real stream
  before pinning `nth`" rule (M6 step 7).

**If a beat genuinely cannot be anchored on an existing event, STOP and surface it** — that is a real
signal, not a licence to invent an event. The house record is against new events, and the readout was
the last chance to prove one undrawable; it did not.

Scope lever the reviewer signs off on: **a FOUR-lesson track** (_The wide machine_, working title),
one per teachable beat — pairing works, the dependent pair, the one memory port, the one branch unit
— plus the one new corpus program that makes the fourth reachable. All content + one `.s` file; no
engine, no trace, no view code.

## Build order (each step testable before the next)

- [x] **0. The `branch-slot` corpus program.** DONE 2026-07-20 (2275 tests). `paired-branches.s`
      shipped: two adjacent `bne x0,x0,done` (instructions 0 and 1), both never-taken so no flush,
      `a0 = 42`, `ecall` last word. Confirmed against a fresh dump per config (`M:\...\temp\m8\`),
      not eyeballed. Hand-derived cells added: conformance `RESULT_ORACLES {10:42}`; pipeline `TIMING`
      (w1: retires 5, no stalls, P not-taken 0 / taken 4 → 9 / 13 cycles); superscalar `TIMING` (same
      w1 **plus** w2: G 3 / Q 2 / L 0 / doomed 0, `branch-slot` the free slot-1 refusal → **7 cycles**,
      vs 9 at w1). **A FOURTH table needed the row** beyond the three the plan named: `pairing.test.ts`'s
      `EXPECTED` w1/w2 headline A/B (`{w1:9, w2:7}`) — its own hard-coded-corpus guard failed loudly,
      exactly as designed. **The one non-obvious cell was `betting` (static-taken w2), dumped not
      guessed:** both branches bet taken and both mispredict, and each bet's `killedRest` squashes its
      would-be mate BEFORE the `branch-slot` rule can refuse it — so under betting NO branch pairs and
      NO branch is refused; each issues solo, G 3→4, Q 2→1 (`betting {groups:+1, pairs:−1}` both
      positions), and crucially **L stays 0 in every scheme** (betting removed the only refusal), so
      `W2_MATRIX`'s scheme-blind `L = blocked[pos]` still balances (4+0+4+0+4 = 12). `npm test` +
      `lint` + `tsc -b` + `build` all green; INV-8 passes for the new program on every model.
      Author a small `.s` (working name
      `paired-branches.s`) whose two control transfers are ADJACENT so they land in one issue group
      at width 2 and the older refuses the younger for `branch-slot`. Design it against a fresh dump,
      not by eyeball: the cleanest witness is **two adjacent not-taken branches** (both proceed, no
      flush muddying the trace) — e.g. `beq`/`bne` against `x0` that fall through — followed by a
      deterministic tail and an `ecall`. Keep it tiny and give it an unmistakable architectural
      result. **This program widens the shared corpus (INV-7), so it is swept by every model**, which
      forces three hand-derived additions, each a KNOWN loud failure if omitted: - `packages/engine/conformance/src/conformance.ts` — a `RESULT_ORACLES` headline (model-
      independent, hand-computed; the equality check runs regardless but the oracle is the root of
      trust). - `packages/engine/pipeline/src/timing.test.ts` — a `TIMING` entry (w1 shape). The "covers
      every program in the corpus" guard fails loudly until it exists; derive every cell from the
      closed form `cycles = N + 4 + S + P`, never from observed output. - `packages/engine/superscalar/src/timing.test.ts` — a `TIMING` entry (w1 **and** w2 shape:
      `groups`/`pairs`/`blocked`/`doomed`/`betting`). Same guard, same discipline; the w2 entry is
      where `branch-slot` finally appears in a derivation (two transfers ⇒ the younger is refused,
      classified by CLASS not outcome — a not-taken branch still occupied the unit).
      Acceptance: `npm test` green (conformance across all models at every config, both timing guards
      satisfied), `npm run lint`, `tsc -b` green. INV-8 passes for the new program on every model.

- [x] **1. Lesson — "Two at once" (pairing works).** DONE 2026-07-20 (2331 tests). `two-at-once.json`
      shipped: `program: sum-loop`, `model: superscalar`,
      `config: { forwarding: true, branchPrediction: 'static-not-taken', cache: null, issueWidth: 2 }`.
      Three anchors, all re-dumped under THIS exact config (throwaway `zz-m8-dump.test.ts`, since
      deleted; `temp\m8\sum-loop-w2.txt`): the opening pair fetched together (`instr-fetch nth:2` →
      cycle 0, both `li` in one cycle), a mid-loop paired EX (`alu-op where:{op:add, result:19}` →
      cycle 7, `add a0`+`addi t0` in two lanes), and the closing retire (`reg-write where:{reg:10,
value:55}` → cycle 41). Anchors chosen arithmetic-fixed (`result:19`, `value:55`) so they fire
      in all 24 sweep positions. Narration frames the counterfactual as the flip, not the reader's run.
      **Two forced deviations from the plan's literal 1-vs-5 split, both routine (advisor-confirmed):**
      **(1)** `LESSONS` is GLOBBED, so the lesson file cannot exist un-wired — the instant it lands,
      the glob-vs-hardcoded guards fire (`LESSONS.length`, the `LESSON_ORDER` toEqual, `lessonSections()`
      track lists at two sites, `LESSON_TRACKS` order). This is step 0's ripple one layer up (a `.json`
      is the same shape as a `.s`). So the **"The wide machine"** track (working title, pinned in step 5)
      was added to `index.json` NOW with just `two-at-once`; steps 2–4 append. Grepped every track/count
      guard across the web tests before editing, not just the ones the eye caught. **(2)** The generic
      sweep bypasses `lessonOpening`, so it CANNOT see whether the lesson opens at width 2 — the
      milestone's headline failure mode (the engine's `issueWidth ?? 1` reads 56/56 with every anchoring
      test green). Extended `session.test.ts`'s shipped-lesson opening loop to assert `issueWidth`,
      failable because arrival width stays 1 while this lesson declares 2. **The by-name oracle proves
      the two things the sweep is blind to:** the PAIR (exactly two `instr-fetch` on cycle 0, two
      `alu-op` on the mid-loop cycle — the no-shared-cycle guard checks steps don't collide, never that
      a cycle holds two lanes), and the COUNTERFACTUAL numbers derived from the engine at width 1 and 2
      (56/44 cycles, IPC computed from 34 retires → 0.61/0.77, then asserted present in the closing
      prose). `npm test` + `lint` + `tsc -b` + `build` all green. Browser pass deferred to step 6.

- [x] **2. Lesson — "The pair that can't" (`intra-pair-raw`).** DONE 2026-07-20 (2388 tests).
      `pair-that-cant.json` shipped: `program: array-sum`, same config as step 1 (superscalar,
      forwarding on, static-not-taken, cache null, `issueWidth: 2` → w2 = 42 cycles, w1 = 51). Two
      steps: the refusal (`{ event: 'stall', where: { reason: 'intra-pair-raw' }, nth: 2 }` → cycle 6,
      `bnez t1, loop` at pc 32, refused for the `t1` that `addi t1, t1, -1` at pc 28 beside it is still
      computing) and the closing "same answer" (`mem-write value:120` → cycle 39). All re-dumped under
      THIS config (throwaway `zz-m8-dump.test.ts`, since deleted; `temp\m8\array-sum-w2.txt`).
      **PLAN ERROR CORRECTED (advisor-confirmed): the plan said "anchor the FIRST `intra-pair-raw`,
      cycle 1" — but cycle 1 is the `addi` half of the `la t0, arr` pseudo-op (reading the `t0` the
      `lui` beside it just wrote), an instruction the reader never typed and the EXACT trap
      `forwarding-bubble`'s oracle was written to catch.** The plan author corrected the config-drift
      ("not cycle 10") but did not notice cycle 1 IS the `la` internal. `nth: 2` skips it to the first
      SOURCE-LINE dependent pair. **The steady-state accumulate (`add a0,a0,t2`) was the tempting
      alternative and is worse — it is refused TWICE on adjacent cycles (`intra-pair-raw` then
      `load-use`, because its partner is a load), so a reader scrubbing sees the reason flip;
      `bnez`/`addi` is a single clean refusal, partner a plain ALU op, firing every iteration.** The
      branch-ness is incidental: the refusal here is DATA (needs `t1`), reserved the one-branch-unit
      structural hazard (`branch-slot`) for step 4. Oracle pins `reason: 'intra-pair-raw'` + pc 32 +
      `cycle > 1` (skips the la trap) + width-EXCLUSIVE (dead at width 1: no pair, no refusal) + the
      closing 120/34-retires at both widths. No cycle counts quoted in prose (the payoff is the
      dependency, not speed), so — unlike step 1 — nothing more to pin. `npm test` + `lint` + `tsc -b` + `build` all green. Browser pass deferred to step 6.

- [x] **3. Lesson — "One door for memory" (`mem-port`).** DONE 2026-07-20 (2445 tests).
      `one-door.json` shipped: `program: byte-loads`, same config as steps 1/2 (superscalar,
      forwarding on, static-not-taken, cache null, `issueWidth: 2` → w2 = 9 cycles, w1 = 10). Two
      steps: the refusal (`{ event: 'stall', where: { reason: 'mem-port' } }`, UNIQUE so no `nth` →
      cycle 3, `lbu t2, 0(t0)` at pc 12 refused because `lb t1, 0(t0)` at pc 8 beside it holds the one
      data-memory port) and the closing "same answer" (`reg-write reg:7 value:128` → cycle 7, the
      REFUSED `lbu`'s own result lands). All re-dumped under THIS config (throwaway `zz-m8-dump.test.ts`,
      since deleted; `temp\m8\byte-loads-w2.txt`). **The design's spine is the CONTRAST with step 2:
      `intra-pair-raw` refuses a pair for what the younger NEEDS (data); `mem-port` refuses it for what
      the younger IS (a memory op) — decided at issue by CLASS, before any address forms.** These two
      loads are MAXIMALLY INDEPENDENT (same address, different destination regs, no shared result), yet
      still refused — the pure structural hazard, held for structure not data. **Advisor-confirmed
      finding: pinning `reason === 'mem-port'` IS the proof of independence** — `byte-loads` at w2
      emits THREE stalls (two `intra-pair-raw` from the `la` pseudo-op + the reader's first load reading
      `la`'s `t0`, then the one `mem-port`), and a data refusal would have fired first if the two loads
      weren't independent; so the reason string alone rules out the slip AND certifies "structural."
      The oracle adds the structural SIGNATURE the reason can't carry: both the refused younger and its
      ID.0 partner (read from `instructions[]` on the refusal cycle — no `at()` helper in
      `lessons.test.ts`) drive a `mem-read`, proving the contended unit is the PORT. Width-exclusive
      (dead at w1: one load per cycle, no contention). No cycle counts in prose (like step 2 — 10→9
      undersells a dependency-bound program; the payoff is the structural rule, not speed); the closing
      pins both byte results (-128/+128) at both widths, the concrete "width is not a correctness knob."
      **Wiring was the APPEND case (step 5's note): `one-door` added 3rd in the "The wide machine"
      track's `lessons` array; the only glob-vs-hardcoded guard that fired was `LESSONS.length`
      (13→14) — the `LESSON_ORDER` toEqual auto-derives from `index.json`, and no track-NAME guard
      fired since no track was added.** `session.test.ts`'s all-lessons opening loop covered the new
      lesson automatically (asserts `issueWidth === 2`). `npm test` + `lint` + `tsc -b` + `build` all
      green. Browser pass deferred to step 6.

- [x] **4. Lesson — "One branch unit" (`branch-slot`).** DONE 2026-07-20 (2503 tests).
      `one-branch-unit.json` shipped: `program: paired-branches` (step 0), same config as steps 1–3
      (superscalar, forwarding on, static-not-taken, cache null, `issueWidth: 2` → w2 = 7 cycles,
      w1 = 9). Two steps: the refusal (`{ event: 'stall', where: { reason: 'branch-slot' } }`, UNIQUE
      so no `nth` → cycle 1, the younger `bne x0,x0,done` at pc 4 refused because the elder `bne` at
      pc 0 beside it holds the one branch unit) and the closing "same answer" (`reg-write reg:10
  value:42` → cycle 5, `a0 = 42` by falling through). All re-dumped under THIS config (throwaway
      `zz-m8-dump.test.ts`, since deleted; `temp\m8\paired-branches-w.txt`). **The design completes
      the trilogy of refusals and is the SECOND structural one — the contrast is the spine:
      `intra-pair-raw` refuses for what the younger NEEDS (data); `mem-port` and `branch-slot` refuse
      for what it IS — a memory access, a control transfer — decided by CLASS at issue.** What makes
      `branch-slot` the SHARPEST of the three (its unique teaching point, absent from step 3): the
      pair is refused BEFORE either branch resolves — both branches are not-taken and NEITHER flushes,
      yet the refusal fires a full cycle before either `branch-resolved` lands (c2 elder, c3 younger).
      The machine cannot know the outcomes yet and does not need to; the refusal is about class, not
      outcome. **Two clean-anchor facts (both simpler than steps 2/3): (1) the trace emits EXACTLY ONE
      stall** — no `la` pseudo-op internal (the program has no `la`), no data hazard, nothing else to
      slip onto — so no `nth`, and the oracle PINS that uniqueness (a corpus edit reintroducing a
      second stall reddens rather than silently shifting the anchor); **(2) the closing CANNOT copy
      one-door's shape** (which anchored the refused load's OWN writeback) — a branch has no result of
      its own, so the payoff anchors on the architectural `a0 = 42` the fall-through computes,
      advisor-flagged. Oracle mirrors one-door's structural signature with `branch-resolved` in place
      of `mem-read`: both the refused younger (pc 4) and its ID.0 partner (pc 0) drive a
      `branch-resolved`, proving the contended unit is the single BRANCH UNIT; plus a dedicated
      "refused before either resolves" oracle (the sign-and-zero shape — the thesis lives in narration,
      pinned against the recording). Width-exclusive (dead at w1: one branch per cycle, no contention).
      No cycle counts in prose (like steps 2/3). **Wiring was the pure APPEND case (step 5's note):
      `one-branch-unit` added 4th in the "The wide machine" track; only `LESSONS.length` (14→15) fired
      — `LESSON_ORDER` toEqual auto-derives from `index.json`, and no track-NAME guard fired.** Also
      updated the shipped-lessons docblock prose ("first three superscalar lessons (steps 1–3), its
      first structural refusal" → four / 1–4 / two structural refusals). `session.test.ts`'s all-lessons
      opening loop covered the new lesson automatically (asserts `issueWidth === 2`). `npm test` +
      `lint` + `tsc -b` + `build` all green. Browser pass deferred to step 6 — **flagged there
      (advisor): the dump shows branches resolving in the EX LANES, not a distinct branch box, so the
      "one branch unit" framing (inherited from `paired-branches.s`'s header and one-door's expert
      tier) must be checked against what the datapath actually draws.**

- [x] **5. Wire the track.** DONE 2026-07-20 (2503 tests). The track was already wired incrementally by
      steps 1–4 (step 1 had to add the `'The wide machine'` heading and the `LESSON_TRACKS` /
      `lessonSections()` order updates because `LESSONS` is globbed — a lesson file cannot exist
      un-wired — and steps 2–4 APPENDED their id). So of step 5's three genuine remainders: (a) the
      track name `'The wide machine'` is PINNED (used at `lessons.test.ts:508` and `:601`); (c) teaching
      order is covered transitively by the flattened-order assertion at `:601-607` and by `index.json`.
      **What actually remained and was done: (b) the by-name track-membership assertion.** Added to the
      "files each lesson under the track its SUBJECT belongs to — asserted by name" test (next to the
      `machine`/`cache` blocks): `LESSON_TRACKS.find(t => t.track === 'The wide machine')`, lessons
      sorted, `toEqual(['one-branch-unit','one-door','pair-that-cant','two-at-once'])`. This is the one
      net a mis-file could slip past — `lessonSections()` totality (`:600`) stays green even if a lesson
      were filed under the wrong track, because `LESSON_ORDER` derives from the same `index.json`, so
      only naming the set here catches it. `npm test` (2503), `npm run lint`, `npm run typecheck` all
      green.
      Original scope, for the record: add the four lesson ids to `content/lessons/index.json` under a new
      track heading, in teaching order (pairing → the three refusals; refusals ordered easy-to-hard:
      data dependency, then the two structural). Update `lessons.test.ts`'s hardcoded track-name
      expectations. Acceptance: `lessonSections` returns the new track with all four lessons resolved and
      none under `UNTRACKED_HEADING`; full suites green.

- [ ] **6. Browser pass — the only net that sees this.** Per the repo's own record (9 of 10 view
      steps shipped a browser-only defect; "the browser is the only net"), and because THIS is the
      first lesson ever on `model: superscalar` (session.ts:198), the headless suite cannot see the
      picker, the model load, or narration appearing. Drive the real dev server (identify the tab by
      served `<title>`, never by port — this repo runs several Vite projects): confirm the new track
      shows in the picker; selecting each lesson loads the superscalar model **at width 2** (not a
      silent fall to width 1); narration appears at the anchored cycles; the readout/IPC tile agree
      with the prose. Acceptance: a clean browser pass with the specific defect class ruled out
      (model actually superscalar, width actually 2, no null-trace panel vanish at pre-run).

## Acceptance criteria (mirror the spec §11 shape)

- [ ] The picker shows a fourth track; each of its four lessons loads the superscalar model at
      width 2 and plays through with narration on the correct events (INV-6).
- [ ] The track teaches all THREE refusal reasons the machine can emit — `intra-pair-raw`,
      `mem-port`, `branch-slot` — the last reachable only via the new corpus program.
- [ ] Every cycle count / IPC in narration matches the engine under that lesson's declared config,
      pinned by a narration oracle (not just an anchoring sweep — M4 step 4 proved anchoring is blind
      to wrong words).
- [ ] The new corpus program passes INV-8 on every model, and both timing guards (pipeline w1,
      superscalar w1+w2) cover it with hand-derived cells.
- [ ] All suites green; `npm run lint`, `tsc -b`, `npm run build` green. Browser pass clean.

## How this milestone can lie to itself

- **INV-8 is a false safety net here (inherited from M7).** In-order superscalar retires in order, so
  conformance passes even if pairing is wrong. It secures the new program's ARCHITECTURAL result; it
  says nothing about whether the lesson's TIMING claims are true. The timing tables and the narration
  oracles are the real nets — the sweep alone is not.
- **The anchoring sweep is blind to pedagogy.** A step that fires at the wrong beat, or prose quoting
  the wrong width's number, passes the sweep. That is why each lesson carries a positive narration
  oracle by name (the M4-step-4 lesson: "51 cycles" shipped green over a transport reading 49).
- **A remembered cycle is a config-specific fact.** Re-dump under each lesson's exact config before
  pinning any `nth`/`where`; never carry a number across a config boundary (M7 step 8).

## Decisions to pin (seeded with recommended answers)

- **Track heading.** Working title _The wide machine_. (Alternatives: _Two at a time_, _The
  superscalar_.) — pin during step 5.
- **Lesson order within the track.** Pairing first (the payoff), then the three refusals easy-to-hard:
  `intra-pair-raw` (data), `mem-port` (structural, memory), `branch-slot` (structural, control).
  Ordering is content, declared in `index.json` (M5 step 0's rule).
- **The `branch-slot` program's shape.** Two adjacent not-taken branches, tiny, unmistakable result.
  Finalize against a fresh dump in step 0; keep it the corpus's clearest "two transfers, no flush".
- **Do NOT add an `issue` event.** Re-affirmed; pairing anchors by counting existing events.
