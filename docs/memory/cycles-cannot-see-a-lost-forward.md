---
name: cycles-cannot-see-a-lost-forward
description: 'The M11 step-6 method finding: a cycles-only identity held in every cell INCLUDING the broken ones, while a forward silently vanished. Verify engine changes on the EVENT MULTISET under adversarial programs, not on cycle counts.'
metadata:
  node_type: memory
  type: feedback
  originSessionId: 59aeef69-e62d-47ac-b3ef-06d496f12ca9
  modified: 2026-07-28T07:39:39.729Z
---

**When deciding whether an engine change is behaviour-preserving in CPU Visualizer, compare the
EVENT MULTISET (modulo time-displacement), never cycle counts alone — and drive it with
hand-built ADVERSARIAL programs, not the corpus.**

**Why:** measured on 2026-07-27 (M11 step 6). The question was whether M6's cache miss-freeze on the
7-stage was a mechanical ripple. The obvious check —
`cycles_cache === cycles_cacheless + misses × missPenalty` — **held in all 132 corpus cells and in
every adversarial cell too, including the ones where the machine was computing the wrong answer.**
On `adv-flush-under-miss` the cycle count matched exactly while two `forward:MEM/WB->EX1` events
went `1→0`. Checking cycles alone would have declared the cache mechanical and shipped a
correctness bug (write-up at `docs/reviews/m11-miss-freeze-forward-loss.md` — it was already shipped,
in `engine/pipeline` and `engine/superscalar`). The repo has a precedent for this in the other direction too: M11 step 3
found a stall on the deep machine that **costs zero cycles**, so "the count did not move" has been
proven twice not to mean "nothing moved".

**How to apply:**

- Tokenize every event with everything EXCEPT its cycle (stalls by `reason`+pc, flushes by
  `reason`+`stages`, forwards by path, retires by pc), count them into a multiset, and diff. The
  drop/no-change proof is invariance _modulo displacement_.
- **The corpus is not a net for this class.** All 11 programs were clean while three shipped engine
  configurations were broken; the bug needed three specific instructions adjacent. Hand-build
  programs that aim the mechanism at a live front end, and add a **vacuity guard** proving each one
  actually reached the state it targets (e.g. "N cycles frozen with ID occupied" > 0).
- **Slide the geometry.** The broken alignment is machine-dependent: `pipeline` and `superscalar`
  w=1 broke at filler distance k=0, while `superscalar` w=2 was CLEAN at k=0 and broke at k=1/k=2. A
  single-alignment test passes against a fully broken machine.
- Compare a model against its OWN cache-off run (INV-8-verified) rather than against another model —
  `eslint.config.js` denies model→model imports, so cross-model claims go in PROSE plus literals
  duplicated in both suites ([[m11-deep-pipeline-planned]]'s notes — the milestone log in
  [[project-overview]] stops at M10 and has no M11 content).
