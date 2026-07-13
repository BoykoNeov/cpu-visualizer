# Lessons

Authored lesson data (spec §13). Lessons are **declarative content** the engine does not
compile against — this is the platform/content split that makes the simulator a platform
with lessons layered on top.

A lesson references a program + a model + a config + an ordered set of steps. Each step is
anchored to a **trace event**, not an absolute cycle number (INV-6), so the lesson survives
small program edits. Narration carries per-depth-tier variants (lawful simplification,
INV-5).

The lesson types are seeded in `packages/curriculum`. The runner and event-anchoring matcher
are Milestone 1 step 10; the first authored lessons are step 11 (`docs/plans/m1-tasks.md`).

## Format

Each lesson is a JSON file matching the `Lesson` type (`@cpu-viz/curriculum`): a `program`
(referenced by its `content/programs/*.s` base name, INV-7), a `model`, a `depthDefault`, and
an ordered list of `steps`. Each step's `trigger` anchors to a trace **event type** with an
optional `nth` occurrence and a declarative `where` payload filter (shallow equality — plain
data, not a predicate, so lessons stay serializable). `narration` carries per-tier variants.

These files are **untrusted at compile time** — a mistyped `event`, `where`, or tier key fails
silently. That type-safety is bought back by `packages/web/src/lessons.test.ts`, which anchors
every lesson against the real single-cycle engine and asserts no step is dead.

## Authored lessons (M1)

- **`sum-loop-tour`** — anatomy of a counting loop (`sum-loop`): fetch → loop body → backward
  branch → the final total (55).
- **`array-in-memory`** — walking an array in `.data` (`array-sum`): the first `lw`, a negative
  element, the summed total (120), and the `sw` that writes it back.
- **`function-call`** — call/return linkage (`call-return`): argument setup, `jal` saving the
  return address, the in-function compare, and the result saved after `ret`.
