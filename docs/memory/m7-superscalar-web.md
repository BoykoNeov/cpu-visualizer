---
name: m7-superscalar-web
description: 'M7 steps 6-8 (web half): the superscalar selectable with an ISSUE width control, the widened datapath, the pairing readout + IPC tile - and two traps that both push the same direction, so the honest number looks WRONG at a glance.'
metadata:
  node_type: memory
  type: project
---

## M7 — in-order superscalar (roadmap tier 4). ✅ COMPLETE: steps 0–8 DONE 2026-07-20 (2142 tests)

**M7 IS COMPLETE. Every step and every acceptance box is ticked, and the decisions table has NO
open rows left.**

**Load-bearing M7-step-8 findings (the pairing readout + IPC tile):**

- **THE OBVIOUS RULE IS A LIE, AND ONLY A DUMP COULD SHOW IT.** "A `stall` event names the refused
  instruction, so no stall ⇒ they paired" survives every hand-reasoned case, then fails on the
  flagship cache program: `array-sum.s` at width 2 / small cache holds `ID.0=i5, ID.1=i6` frozen
  cycles 6–14 with **NO `stall` event on any of them** (a miss-freeze emits none — the M6 finding).
  The naive readout announces "paired, issuing together" for nine straight cycles while nothing
  moves. Note the M7 plan's own seed proposed exactly this rule — the event was declined for a
  BETTER reason than the one offered.
- **THE GENERAL LESSON, worth more than the bug: reading the RESULT beats enumerating the REASONS.**
  The naive rule needs a COMPLETE list of every way an issue can be blocked (pairing refusal,
  ordinary hazard, flush, miss-freeze) and there is no way to know the list is finished — the freeze
  hole is exactly a missing enumeration case. `micro.idEx` IS who issued, so blocked-ness cannot be
  under-counted and the panel never has to know WHY in order to avoid claiming they went. Reach for
  this shape whenever a view must decide "did X happen" from event absence.
- **The licensing identity, verified not reasoned: `micro.idEx@N` === the `EX.<slot>` occupants at
  N+1** — 3 hand-written refusal programs + the whole corpus at 2 widths × cache on/off (28 configs,
  ~1600 cycles), zero mismatches. GUARDED in the suite because breaking it fails **silently**. This
  is NOT the datapath's one-cycle-ahead `micro` trap: that trap is reading `micro` for CURRENT
  occupancy; here being a cycle ahead is the entire point.
- **The browser caught the defect again (10th of 11 view steps): THE PANEL VANISHED AT PRE-RUN.**
  Keying it on the cursor's trace meant `trace === null` at cycle -1 hid the whole section —
  including the IPC tile, a whole-recording figure that is meaningful before the first step. Load a
  program, flip the width toggle, never press step ⇒ see nothing. **No test here can scrub a
  cursor** (`renderToStaticMarkup`, no jsdom). Fixed by `readPairingPreRun`.
- **AN OBSERVED CYCLE NUMBER IS ONLY VALID FOR THE CONFIG IT WAS OBSERVED IN.** The flush test first
  cited cycle 18 read off the cache-ON dump and asserted it against a cache-OFF recording, where 18
  is an ordinary `load-use` stall. It failed loudly; the same slip onto a cycle that happened to
  agree would have passed while demonstrating nothing. Sharpest form yet of observe-then-assert.
- **`refused` ≠ `blocked`, deliberately.** Refused = the older issued and a younger did not (the
  machine kept progressing); blocked = nobody moved. One "stalled" chip would erase the tier's own
  lesson. The split falls out of the `micro.idEx` reading for free.
- **The readout does NOT agree with the datapath at the same cursor and must not be read as if it
  did** — its subject is the pair in ID; the dark `ALU 1` is one cycle later. The surface that agrees
  AT THE CURSOR is the **pipeline map** (a refusal = a visible stagger + the slot slide). The panel
  states this on itself rather than letting a reader find it as an apparent bug.
- Browser-verified: `sum-loop.s` forwarding ON, `1-wide → 2-wide` without reloading ⇒ IPC
  **0.61 (34 ÷ 56) → 0.77 (34 ÷ 44)**; `array-sum.s` c10 reads `REFUSED · intra-pair-raw`, slot 0
  `lw` issued / slot 1 `add` held. The tile shows the honest cycle COUNT (56), not the 0-indexed
  cursor (55). `array-sum.s` and `sum-loop.s` both retiring **34** is a real coincidence, not a
  stale constant (others read 134/9/6/9) — checked, because a frozen numerator is what a broken
  view-derived counter looks like.
- **The `issue` trace event is DECLINED WITH PROOF** — pair from `location`, reason from the existing
  `stall`, who-issued from `micro.idEx`, freeze from `missCyclesRemaining`. Zero schema change.
  House record holds: M4 +1 field of 5, M6 +0, M7 +0.

**STEP 7 (the widened datapath) IS DONE AND BROWSER-VERIFIED, no defect found.** `datapath-superscalar.ts` + `SuperscalarDatapathView.tsx`:
27 nodes / 89 wires, a shared front-end (pcmux, PC, `+4n`, imem, the issue and hazard units, ONE
register file) feeding **two replicated execute lanes**, re-converging on ONE data memory and a
shared writeback bus. +48 tests.

**Load-bearing M7-step-7 findings:**

- **THE HUE CHANNEL: `superscalar-visuals.md` was OVERRIDDEN, with the user asked first.** That doc
  (2026-07-14) gives the lane hue the WIRE STROKE — but it predates M3 step 6 shipping, and the
  stroke now means STAGE, in the same `PHASE_COLORS` set **the pipeline map directly above the
  diagram** uses. Obeying it would have said blue = IF on one surface and blue = lane 0 on the
  other, and made `EX.0`/`EX.1` DIFFERENT colors — destroying the "two instructions in EX" reading
  the whole tier exists for. **PINNED BY USER: three channels — wire stroke = STAGE, node tint =
  LANE, follow ring = IDENTITY.** Only REPLICATED boxes are tinted; shared boxes stay hue-neutral
  for M3's pinned reason (the regfile is read by ID and written by WB in one cycle, so it belongs
  to no single anything), while `ALU 1` does slot 1's work and nothing else. Cost: one
  `NodeVM.hue` field = delta 1 of the visuals doc. **Generalisable: a forward-design doc written
  before the surface it shares a screen with can be silently stale — check what channel is already
  spent before spending it again.** The doc now carries a SUPERSEDED note; its other five seeded
  decisions all shipped as written.
- **Three units, three different replication answers, NONE guessable — all settled by dumping a
  real width-2 trace.** (1) `pcarith` REPLICATES: two `lui`s pair happily (not memory ops, not
  transfers, not RAW-dependent) and U/J producers emit **no `alu-op` at all**, so a cycle really
  holds `EX.0=lui` + `EX.1=lui`, both needing the dedicated adder. (2) The MEM→WB bypass
  REPLICATES: two non-memory instructions bypass together, and one shared wire could name only one
  of them — **the follow-ring would have pointed at the wrong instruction**. (3) `dmem` does NOT
  replicate (mem-port rule), pinned corpus-wide as a converse guard.
- **`forward.from` names the LATCH, not the slot — a real trace-contract limit.** It is `'EX/MEM'`
  / `'MEM/WB'` (event fields stay BARE, pinned 2b), so **the SOURCE lane of a forward is a fact the
  trace does not carry**. Every forward wire starts at a latch BAR; drawing a source slot would be
  a coin-flip rendered as hardware. Sink lane IS known (the consumer's slot). A test pins that no
  forward wire ever sources a slot, so a later "improvement" cannot invent it.
- **"One lane dark" is a claim about the EXECUTE BAND ONLY — its own test caught the over-claim.**
  The first draft asserted no lane-1 wire ANYWHERE was lit on a refused cycle and FAILED: a machine
  that refused a pair in ID is still fetching two into `IF.0`/`IF.1` behind it. That is the machine
  working — the refusal narrows the ISSUE point, the front-end keeps running wide. Browser-confirmed
  in one frame: `ALU 1` fully grey while `Sign Extend 1` is lit magenta beside it.
- **The refusal BADGE and the dark lane are ONE CYCLE APART — step 8 must not assume they coincide.**
  The refusal fires in ID (deciding the next group) while EX still holds the previous pair. Observed
  on `array-sum-twice.s`: badge at cycle 2, solo `ALU 0` at cycle 5.
- **`issueWidth` is a THIRD structural axis, and hiding is TESTED not argued.** At width 1 lane 1
  AND the issue unit are ABSENT (not dimmed). Lawfulness asserted over the whole corpus × 3 configs:
  no width-1 cycle emits a `.1` location, no width-1 stall carries a pairing reason. If one ever
  did, the honest fix is to draw an IDLE lane, not to keep hiding it. (The issue unit is the
  arguable one: a width-1 superscalar DOES run issue logic, but this box draws the PAIRING verdict
  and with one candidate there is no such question. The ordinary hazard check is the separate,
  width-independent `hazard` unit.)
- **The fetch adder is `+4n`, not `+8`** — the machine advances 4 bytes PER INSTRUCTION FETCHED, and
  that count is 1 or 2 depending on free slots, so a hard `+8` is wrong on exactly the cycles a
  refusal makes interesting. A test pins the `+4` case.
- **12 diagonal-wire failures on the first geometry run, all the same mistake, fixed
  STRUCTURALLY.** Every one was a hand-typed endpoint `y` not matching the node edge it claimed.
  Fix: **every coordinate is DERIVED from the node via `at()`/`aUp()`/`aLo()`**, so a node that
  moves drags its wires instead of silently detaching. The lane-pitch local became unused as a
  result — that is the good sign.
- **Label/box overlap was MEASURED in the browser, not eyeballed.** `expert` tier looked crowded
  around the stacked issue/hazard units; rather than guess, every rendered `.dp-ctrl-label` /
  `.dp-vlabel-text` bbox was intersected against every node bbox in SVG space → **zero overlaps**
  (it was legal 4px clearance, the renderer's standard). **Reusable technique — "it looks tight" is
  exactly the judgement an eyeball is worst at.**
- **Browser numbers cashed:** `sum-loop.s` 56 → 44 live, `array-sum-twice.s` **208 → 178** live
  (four pinned matrix cells). At the paired cycle `ALU 0` = `10` and `ALU 1` = `9`, **byte-identical
  to the dumped trace**. Nodes 26 → 18 across the width flip, no lane-1 text anywhere. Legend:
  `Fetch·Decode·Execute·Memory·Writeback·Lane 0·Lane 1·idle`. Console clean. **The 0-indexed
  transport trap bit again** (`cycle 5 / 177` = 178 cycles) and was handled by the step-6 note.
- **Browser-tooling gotcha (new):** the claude-in-chrome `zoom` action PINS the screenshot capture
  size for the rest of the session, and `resize_window` silently fails to restore it (`window
.resizeTo` worked once then stopped). Screenshot timeouts on this page persist — pause ~8s and
  re-shoot, never re-click. Driving React `<select>`/toggles via `element.click()` and the native
  value-setter + `dispatchEvent(new Event('change',{bubbles:true}))` is far more reliable here than
  clicking coordinates.

**Step 6 (web enablement) — also browser-verified.** The superscalar is selectable, the ISSUE
`1-wide`/`2-wide` toggle is live, and the milestone finally has a picture.

**Step 6's acceptance, cashed live: `sum-loop.s`, forwarding ON, flipping `1-wide → 2-wide`
WITHOUT reloading moves `56 → 44`** — the exact step-4 derived counts — and the map then draws
`IF.0`/`IF.1` in one column, `ID.0`/`ID.1` in the next, `EX.0`/`EX.1` in the next: **M3 step 7's
lane claim cashed against a REAL engine** instead of a hand-built trace. This eyeball was
load-bearing rather than ceremonial: the seam test was already provoked and found weak — deleting
`issueWidth` from `loadInto`'s config leaves all 581 web tests green, because the field is OPTIONAL
and the engine's `?? 1` just runs both toggle positions at width 1. **A dead toggle reads 56/56;
only the number moving tells them apart.** Gating verified in BOTH directions (ISSUE present on the
superscalar, ABSENT on the pipeline). Console clean — in particular no module-resolution failure,
the risk `fix(web): resolve engine-pipeline to source` had already made real once and the one thing
Vitest cannot rehearse (the dev server resolves differently).

**Step 6 is the SECOND view step in project history to survive a browser pass with NO defect
found** (M5 step 5 was the first), against the 9-of-10 house prior in [[browser-is-the-only-net]].

**Two traps that both push the SAME direction — the honest number looks WRONG at a glance. Read
these before any future browser check of a cycle count:**

- **The transport is 0-INDEXED.** `lastCycle = recordedCycles - 1` (`App.tsx:125`), so a 56-cycle
  run reads **`cycle 55 / 55`** and a 44-cycle run reads **`43 / 43`**. Every pinned count in M7 is
  a trace LENGTH. **Read `X / Y` as `Y + 1` cycles.** A verifier who compares the on-screen number
  to the pinned one sees an off-by-one and has two bad moves available: report a phantom defect, or
  "correct" the pinned number and silently destroy the step-4 matrix.
- **The app opens at forwarding OFF, but 56/44 are forwarding-ON numbers** (`W1`/`W2` in
  `pairing.test.ts` both set `forwarding: true`). Flipping only the width from a cold load compares
  the wrong pair of cells. The default reads **78** cycles — itself the derived forwarding-OFF
  width-1 cell (`34 + 4 + 22 + 18 + 0`), so the browser confirmed a second matrix cell in passing.

**Scrub was exercised over a paired recording** (back to cycle 3: the first pair tracked together in
`MEM.0`/`MEM.1`, the pair behind it in `EX.0`/`EX.1`, readout **`7 in flight`** vs width 1's max of
5, and `ecall` alone in `IF.0`/`ID.0` — the refusal picture step 8 will name). Step 5 had proven
scrub headlessly, so this confirms rather than discovers — but "the map RENDERS a paired trace" and
"you can scrub back INTO one" are different claims. Also: **the config survives a model round-trip**
(superscalar → pipeline → superscalar kept forwarding ON and width 2).

Also from step 6: `datapath: 'none'` renders "Superscalar datapath — coming soon" **by design**
(step 7 is the deliverable) — a missing diagram is exactly the shape an eyeball wants to log as a
bug. And the `.0` encoding is visible in the shipped UI while the M3 pipeline map beside it still
draws bare `IF`/`EX` — both spellings seen in one session rather than argued about.

**Driving this app in the browser:** `npm run dev` climbed to **port 5182** (5173–5181 all taken by
other projects — see [[never-kill-dev-servers-by-port]]); identify by the served title
"CPU Visualizer". CDP `Page.captureScreenshot` and `Input.dispatchMouseEvent` **time out
frequently** on this page (the pipeline map is a large DOM) — the action usually LANDS anyway, so
re-screenshot after a ~6s pause rather than re-clicking, and prefer the lighter `find` /
`read_page` over screenshots to read a value. GIF recording makes the timeouts much worse.
