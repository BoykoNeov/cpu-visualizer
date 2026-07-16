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
every lesson against the real engine **it declares** and asserts no step is dead.

### `model` and `config` are honored, not decorative

Starting a lesson switches the shell to the lesson's `model` and, when the lesson declares one,
its `config` (see `lessonOpening` in `packages/web/src/session.ts`). A lesson's _anchors_ survive
a model swap (INV-6), but its _narration_ is prose written about one machine — `sum-loop-tour`
says its add is "written back to a0 in the same cycle", which is only true on single-cycle. So a
lesson opens on the model it was written for. `config` is applied **only when present**: the
forwarding position is session-level and persists, so omitting it means "no opinion", not "reset
to the default".

### Narration is plain text plus ONE construct

Backtick-delimited `code spans` are the entire markup vocabulary — `renderNarration` (App.tsx)
splits on backticks and nothing else. **This is not Markdown.** `**bold**`, `*italic*` and bullet
`*`s reach the reader as literal asterisks; a `\n` collapses to a space, as in any HTML. Carry
emphasis in the sentence instead of in punctuation. A guard in `lessons.test.ts` fails any lesson
whose narration contains a `*` outside a code span — it exists because the flagship lesson shipped
`**not**` to the browser, and every test was green, since they all assert narration _resolves_
rather than _renders_.

### A step may be lawfully dead in a config

A lesson's steps need not all fire. `forwarding-bubble` is _about_ a stall that disappears when a
toggle flips, and the trace vocabulary is config-exclusive (`stall.reason: 'raw'` only with
forwarding off; `'load-use'` and `forward` only with it on), so some of its steps must be absent in
each position — that is the lesson, not a bug. The runner skips null anchors and the panel drops
never-fired steps, so the rail simply re-forms when the user flips the toggle. The validator's rule
is therefore "every step fires in **at least one** position the declared model honors" — which for a
config-blind model is exactly "every step fires".

## Authored lessons

- **`sum-loop-tour`** — anatomy of a counting loop (`sum-loop`): fetch → loop body → backward
  branch → the final total (55).
- **`array-in-memory`** — walking an array in `.data` (`array-sum`): the first `lw`, a negative
  element, the summed total (120), and the `sw` that writes it back.
- **`function-call`** — call/return linkage (`call-return`): argument setup, `jal` saving the
  return address, the in-function compare, and the result saved after `ret`.

The three above target **single-cycle** (M1) and anchor only to architectural events, so they play
against any model unchanged (INV-6).

- **`forwarding-bubble`** — the flagship experiment (M3, spec §12.2), on the **pipeline**, opening
  with **forwarding off**. `array-sum` is the only corpus program that can carry it: it holds both
  halves of the story on source-visible lines. `add a0, a0, t2` and `bnez t1, loop` both stall
  without forwarding; turn it on and the branch's bubble **vanishes** while the add's **survives**
  (one cycle instead of two, renamed `load-use`) — because a load's value is not ready any earlier,
  which is the point most courses fumble. Flip the toggle mid-lesson and the rail's middle two steps
  swap.
