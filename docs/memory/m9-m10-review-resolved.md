---
name: m9-m10-review-resolved
description: The M9+M10 code review is fully fixed — plus the bug-class guardrails to not repeat those bugs when expanding the OoO corpus, models, or knobs
metadata:
  node_type: memory
  type: project
---

The `/code-review high` over M9+M10 (10 verified findings) is **fully RESOLVED
(2026-07-24)** — all 10 fixed, each its own commit + regression test, repo 4036
→ 4051 tests, typecheck/lint/build green. The two view findings (FU/LSU box
occupancy; double-retire commit-wire follow) were **browser-verified** in the
shipped bundle. Full per-finding write-up stays at
`docs/reviews/m9-m10-review-findings.md` (marked RESOLVED at its head).

**Bug-class guardrails — apply when EXPANDING the out-of-order tier** (this is
why the findings are worth remembering, not the instances):

- **Sub-word memory aliasing is byte-range OVERLAP, not base-address `===`.**
  OoO `disambiguationClear` now compares `[addr, addr+width)` intervals via
  `accessWidth` (finding 1). Any future corpus program mixing sub-word stores
  and loads at overlapping-but-unequal addresses is already covered — but if you
  ever touch that gate, keep the interval check; a base-address compare reads
  stale memory only under a parked ROB head, invisible to the INV-8 differential
  (which is timing-blind). The net here is NOT the browser
  ([[browser-is-the-only-net]]) — it is `disambiguation-subword.test.ts`, a
  base-address-only mutation subclass that reads the stale byte.

- **A new engine MODEL must land in the eslint `MODELS` constant.** The DAG deny
  lists in `eslint.config.js` now derive from one `MODELS` array (`...MODELS`
  for lower layers, `MODELS.filter` for cross-model self-exclusion). Adding a
  model = add ONE line there; the old enumerate-per-block shape is exactly how
  `engine-out-of-order` got omitted from four lists (finding 7). Verify a temp
  import of the new package errors from a trace/curriculum file.

- **A new UNCONTROLLED OoO knob must reset on config-less lessons AND free-play
  loads.** `slowOpLatency` and `numMshrs` have no shell control, so a ref value
  can only leak from a prior lesson. `lessonOpening`'s config-less branch resets
  them to default while the CONTROLLED knobs persist (findings 3, 5); `select`/
  `loadEdited` reset them too. Thread any third such knob the same way, and pin
  it two-sided in `session.test.ts` (reset AND controlled-knobs-persist).

- **F9 is a documented CHOICE, not a correctness fix:** an in-flight slow FU op
  FREEZES during an in-order blocking cache miss (M3/M7 "occupant holds in EX").
  No external ground truth (the pipeline family has no multi-cycle FU) — the
  `fuFreezesDuringMemStall()` seam + parity test pin the choice.

See [[project-overview]] for the milestone log, and
`docs/reviews/m9-m10-review-findings.md` for the ranked findings.
