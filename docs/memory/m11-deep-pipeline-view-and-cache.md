---
name: m11-deep-pipeline-view-and-cache
description: 'M11 steps 6-8, the half that ships to the screen. Step 6 was a DETOUR that found a correctness bug in the already-shipped pipeline + superscalar (a cache miss-freeze ate a forward) before the deep cache could land. Step 7 drew the bespoke 7-stage datapath - the bubble as GEOMETRY - and its silently-failing trap for any future datapath fork. Step 8 drove the SHIPPED `vite preview` bundle: 76 checks, no app defect, six rig failures that were all the rig.'
metadata:
  node_type: memory
  type: project
  originSessionId: c09ed410-3ad2-44be-9942-c29fb034a441
  modified: 2026-07-28T07:53:21.305Z
---

## M11 — the 7-stage deep pipeline, steps 6–8 (cache, datapath, closing pass)

Split out of [[m11-deep-pipeline-planned]] 2026-07-28, which holds the plan, every pinned
decision, steps 0–5 and the `M11 IS COMPLETE` status. Written newest-step-first (8, then 7,
then 6), as it was in the original log.

**STEP 8 (2026-07-27) — THE CLOSING PASS OVER THE SHIPPED BUNDLE. 76 checks, ALL PASS, NO DEFECT**
(`M:\claud_projects\temp\m11-browser\step8-preview.mjs`; label geometry via `s8-crop.mjs`).

**What only a `vite preview` pass can see, and why it is not a formality.** Every earlier pass drove
the DEV server, where the engine resolves through the vite alias to SOURCE. Preview serves what
`vite build` emitted — so this is the only pass that excludes **the build resolving the workspace
symlink to a stale or absent `dist`** (step 5 excluded that for dev ONLY, and said so). Confirm you
are on the built page by its `/assets/index-*.js` script tag, not a `/src/main.tsx` module graph.

**AND IT IS WHERE A RIG GOES VACUOUS MOST QUIETLY.** These rigs find controls by an uppercase caption
through `getComputedStyle` and wires by `.dp-wire--on`. **If the built CSS 404s or a class is hashed
by a production transform, every `__seg()` returns `null` and every ABSENCE check passes** — reading
as "the control is missing", not "the rig is broken". So a preview rig's §0 must assert: built bundle
not dev graph, CSS actually loaded (count sheets AND rules), a **known-present** control found, and
the class-keyed selectors resolving — before any negative anywhere below it is trusted.

**Two rig "failures" against a correct app, both generalizing:**

- The transport reads `cycle 73 / 73  — halted`; the check wanted the bare prefix. The marker is the
  app telling the truth — assert the prefix AND the marker, so it becomes a claim rather than noise
  stripped to make a rig pass.
- **A polyline's `getBoundingClientRect()` is the box of its whole ROUTE.** Comparing a label's bbox
  against wire bboxes reported three collisions on a diagram visibly clean at 5×: an L-shaped wire's
  bbox covers everything between its ends. Walk the polyline SEGMENT by SEGMENT in SVG user units.
- **...and then the segment check needs one more correction: Chrome's `getBBox()` on `<text>` is the
  ADVANCE box, not the ink box.** The trailing side bearing on an italic label runs most of a unit
  past the last visible pixel, so the hazard label measured **−0.09** clearance while a 22× crop shows
  clear air. **Report a signed CLEARANCE, not a boolean; 0 to ≈−1.5 means "abuts, ink clear" and must
  be settled by pixels.** (The other four labels: 8.1–27.3 units.)

**The expired-rig hazard fired TWICE in one milestone.** `eyeball.mjs` §6 pinned step 5's scope lever
("no cache control on the deep pipeline / clamped away / 74") and step 6 inverted all of it. A closing
pass should expect to PORT checks into one consolidated rig, not re-run the old files.

**Regenerate any geometry dump from the current engine BEFORE the browser runs** (step 7's activation
fix landed after the original). Here it came back byte-identical. The parked generator's
copy-in/run/**delete** recipe is load-bearing: the web build runs `tsc --noEmit`, so a stray
`zz-dump.test.ts` in `packages/web/src` fails build, test, lint and format:check at once.

**THE PATH 76 CHECKS LEFT UNTOUCHED, and it took a review to notice: `startLesson`.** Step 5
rewrote `useSimulator` to hold the whole `ModelChoice` in ONE ref precisely because two refs × three
assignment sites (init / `setModel` / `startLesson`) "is how the LESSON path stays broken while the
picker path looks fixed" — and then steps 5/6/7/8 all drove the picker and left `Lesson: — none —`
alone. **Ask of any closing pass: which code path did the refactor exist to fix, and did anything
click it?** Driven at last in `s8-lesson.mjs` (17 checks, all pass): from `deep-pipeline`, starting
an out-of-order lesson drags model + program + config and **records at M10's pinned 59** (in-order
on the same program is 71, so a dropped config cannot pass by looking plausible). Leaving it is
asserted as a **cross-route identity** — the same 116 whether the state was reached by finishing the
lesson or by clicking the picker — rather than as a guessed constant.

**Four rig "failures" this step, all four the RIG, zero app defects.** Beyond the two above: a
guessed cycle threshold ("74 or 88", actual 116 — read numbers, never guess them), and a
data-memory read that was **not scoped to its panel**: searching the page for a leaf whose text is
an ADDRESS finds the REGISTERS panel first, where a register holds that address as a VALUE. It
returned 268435476 (= 0x10000014) and called it memory. **Scope every panel read to its own
`<section>`** — the same lesson as the three `.dp-legend` blocks now on one page.

**STEP 7 (2026-07-27) — THE BESPOKE DATAPATH. Sheddable in the plan, never shed in practice (the
M9 precedent held). Repo 4310 → 4359 tests.**

`packages/web/src/datapath-deep-pipeline.ts` + `DeepPipelineDatapathView.tsx`, forked from the
5-stage. **The geometry IS the argument, in one sentence: the forwarding muxes sit in EX1 and
their output lands on the EX1/EX2 LATCH, never on the ALU.** Read the sinks and the bubble is
structural — a forward physically cannot reach the instruction that needs it this cycle. That is
why `'pipeline'` could not be reused (five columns, ALU immediately behind the muxes ⇒ the one
thing this tier teaches is the one thing that diagram cannot draw, INV-5).

**THE TRAP THAT FAILS SILENTLY, and the one thing to carry into any future datapath fork: the
5-stage gates its entire forwarding block on `if (aluOp)`.** Here `alu-op` fires in EX2, a cycle
AFTER the muxes work — so a copied gate lights **nothing** in EX1, and **the coherence litmus
still passes**, because nothing lit cannot dangle into a dim box. Gate EX1 on OCCUPANCY plus a
mirrored `sourcePorts`, and pin it with a test asserting a real forward drawn in a cycle whose
EX1 occupant emits no `alu-op`. Read the engine's event literals before copying any of them
(`to: 'EX1.rs1'`, `from: 'EX2/MEM'` / `'MEM/WB'`) — a copied string that never matches produces
exactly this failure with no error.

**AND THE REPLACEMENT GATE IS OVER-BROAD BY ITSELF — found by review AFTER the first commit, so
expect the pair.** Swapping an EVENT gate for an OCCUPANCY gate swaps one error for its mirror: **a
SQUASHED occupant is still REPORTED at its stage** (the flush-occupancy sweep asserts exactly that)
while the engine returned early without doing the work. Result: the forwarding network drawn for an
instruction about to die, **on every mispredicted branch**. Gate on occupancy MINUS the stages a
`flush` names — scoped to the ONE stage whose gate you replaced (the parent lights ID/IF1 for
squashed occupants too; that is house behaviour, not yours), and keyed on the STAGE rather than "a
flush happened" (a BET kills only IF2/IF1). Note `array-sum` looked CLEAN while the bug was live —
its squashed EX1 occupant is a `lui`, which reads no registers. **The general lesson: when a fork
replaces a gate, check BOTH directions — what the new gate now misses, and what it now over-claims.**

**A CACHE FREEZE is the mirror question, and there the asymmetry is CORRECT:** EX1 stays lit, EX2
goes dark. EX1's operands were resolved on the DETECTION cycle and really are standing on the latch
(step 6a's fix) — the "a held stage keeps presenting its inputs" convention IF1 already uses — while
the ALU really is producing nothing. A squashed occupant's operands were never resolved and never
will exist. When pinning this, detect the freeze as "MEM holds the same occupant on BOTH sides":
requiring the next cycle too is what excludes the RELEASE cycle, where the machine legitimately runs.

Other step-7 findings worth keeping:

- **A `controlLabel` is a single centred `<text>` 4px above its box — no wrapping, no
  de-collision against wires.** This model's hazard label names THREE held things, so the hold
  stubs leaving the top edge ran under it. Rerouted all three holds out of the LEFT edge (also
  the truer picture: a hold travels backwards to the front end) and pinned the general rule —
  **no wire may anchor on the top edge of a node carrying a control label.** A browser finding.
- **Seven stages take five hues by stage FAMILY** (`stageFamily`, the map's own rule). Indexing
  `PHASE_COLORS` by the raw stage returns `undefined` for four of seven and silently falls back
  to the default stroke. Legend keys the HUES (five entries), not the stages.
- **THE SECOND FALSIFIABLE "UNCHANGED" CRITERION PAID OUT: the trace schema.** The temptation was
  reached exactly where the plan predicted — a non-forwarded operand crossing into the EX1/EX2
  latch has no event this cycle (read at ID, cycles ago) — and DECLINED: the wire lights BARE.
- **A browser rig can "fail" against a correct app, and both ways happened here.** (a) Comparing
  the raw tier-OBLIVIOUS `activate()` set (INV-2 lights every contraction alongside its
  through-mux wire) against the tier-FILTERED canvas — dump the view-filtered set, and make the
  inverse a check. (b) Guessed thresholds: ">40 wires" failed at 34, which was exactly right for
  the state the shell opens in. **Read every expected number from the dump, never guess one.**
  44 checks, all pass; ground truth = `array-sum` cycle 8 at forwarding ON (fullest pipe that
  also forwards into EX1 and stalls in ID), matched wire-for-wire by `points` geometry, since a
  wire carries no id in the DOM.

**STEP 6 (2026-07-27) DID NOT GO AS PLANNED, AND THE DETOUR WAS THE VALUABLE PART.**

The step's question was "implement the cache on the 7-stage, or DROP IT WITH PROOF". Probing it
found a **correctness bug in SHIPPED code** — `engine/pipeline` (M6) and `engine/superscalar`
(M7): **a cache miss froze the execute stage BEFORE it captured its forwarded operands**, the
producer retired out of MEM/WB during the freeze, and on release the occupant executed on its
stale pre-forwarding register read. A cache — documented repo-wide as a timing shadow that "holds
tags, never values" — **changed the answer**. Observed: a wrong register value, a wrong load
address with the wrong line evicted, and a non-terminating program. Unreachable by the 11-program
corpus; trivially reachable from the app's sandbox. Full write-up:
`docs/reviews/m11-miss-freeze-forward-loss.md`. The method that caught it is its own memory:
[[cycles-cannot-see-a-lost-forward]].

- **Step 6a (user-scoped "fix the family first")** — the freeze now holds the **ADVANCE, not the
  WORK**: EX resolves its operands and latches them back onto `a`/`b`, so the release cycle's own
  `resolveOperand` finds no producer and returns them. **No new latch field**, so nothing in the
  trace or recorder shape moves. `ctx.memStallStarted` (capture on the DETECTION cycle ONLY) is
  SEMANTIC, not an optimization — a later frozen cycle reads a draining source set, and on the
  superscalar an unconditional capture re-emits a `forward` every frozen cycle off the pair-mate
  deliberately frozen in EX/MEM. **Zero churn on 4265 existing tests**; regression nets in all
  three cache-honoring packages, each verified to fail without its fix. `out-of-order` was never
  affected — a ROB entry HOLDS its operand values, so there is no forwarding window to close — and
  now pins that as a property.
- **Then step 6 SHIPPED the cache** (user chose ship-with-proportionate-tests over the plan's own
  "mechanical ⇒ drop" criterion, because dropping would leave `deep-pipeline` as the only PIPELINED
  model without a cache and keep `engineConfigFor`'s clamp alive forever for one model).
  **BOTH halves of the seam the plan feared turned out FORCED**: which stages freeze is
  back-pressure (MEM owns `next.ex2Mem`, so EX2 cannot advance and the block propagates up), and
  whether an in-flight EX2 completes has **no consequence either way** (its operands are already on
  the `Ex1Ex2` latch and nothing forwards INTO it). The one that was NOT free is **EX1**, which the
  plan never named.
- **The model's own headline, and the boundary of its thesis: DEPTH TAXES FETCH AND EXECUTE, NOT
  MEMORY.** A miss costs `missPenalty` here exactly as on the 5-stage — the freeze stops the whole
  machine however long it is — and the miss SEQUENCE is identical to the 5-stage's, because no
  wrong-path instruction ever reaches MEM on either. That is why `cache.test.ts` is ~200 cells
  smaller than the house shape: a third axis through the differential (68→204) and the timing matrix
  would add cells that **cannot fail independently** of ones already asserted.
- **A real user-visible consequence, accepted and pinned rather than fixed:** the pipeline map pages
  at 400 cycles, and `PipelineMapView.test.tsx` claimed "the teaching path never sees paging" while
  measuring only the 5-stage (290). `array-sum-twice` on the deep machine is **392** (8 cycles of
  headroom, before step 6) and **442/422** with a cache. So that claim is true through M7 and FALSE
  for `deep-pipeline` + cache. The test now measures per MODEL.
- **KNOWN LIMITATION, not a step-6 bug:** the cache grid's `filling` countdown reads
  `micro.exMem.missCyclesRemaining`, a 5-stage-only field NAME — the superscalar's `exMem` is a
  slotted array — so that path has **only ever fired for `engine/pipeline`**. Verdicts still render
  (they come from the `cache-access` EVENT). Fixing it means making the grid model-agnostic, which
  would fix superscalar and OoO too.
- **Browser pass: 24 checks, ALL PASS, no defect.** Live: 392 → 442 → 422 on the deep machine and
  340 on `pipeline` (= `cache.ts`'s own 290 + 5×10 headroom note, read from the running app). Step 8
  still owes the SHIPPED-bundle sweep.
