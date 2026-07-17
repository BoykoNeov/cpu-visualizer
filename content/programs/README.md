# Example programs

RV32I assembly programs that serve **three roles at once** (spec §9, §12, §13):

1. **Correctness test fixtures** — every model's final architectural state must equal the
   golden reference's on each program (INV-8).
2. **The free-play library** — loadable into any model at any depth outside a guided lesson.
3. **Lesson fixtures** — a lesson references a program + a model + a config + steps.

> The assembler and the halt/print convention are still being built
> (see `docs/plans/m1-tasks.md`). Programs here are seeds and may need small edits once
> those are finalized.

## Adding a program is cheap; the corpus staying small is the point

`conformance.ts` enumerates `*.s` from disk, so a new program **joins the INV-8 differential net
automatically** — every model, every config, no registration. Give it a `RESULT_ORACLES` entry too:
agreement between models is not correctness, and the hand-computed headline is the root of trust.

Because it is cheap, the bar is editorial rather than mechanical: each program is a permanent citizen
every model must run forever, so one is added only when a lesson **cannot be told without it**. M5
step 3 is the worked example — and the test it had to pass was not "would a new program be nicer"
but "is the claim reachable at all on the corpus we have". It was not:

- **What the corpus could not say.** Before `branch-flavors.s` the corpus held exactly three
  conditional branches — `bnez` twice (against zero) and one `bge` on 17 vs 42 — spelling two
  mnemonics between them. For **every operand the corpus ever compared, `blt` and `bltu` return the
  same answer**, so the signed/unsigned trap was not merely untaught, it was _definitionally
  invisible_. Four of RV32I's six branches (`beq`, `blt`, `bltu`, `bgeu`) executed nowhere in the
  product, while the ISA panel asserted in prose what each one means.
- **What the corpus could already say.** `call-return`'s `bge` was the plan's candidate, and it is
  already anchored _and_ narrated by `function-call`'s third step; taken-vs-not-taken is already
  narrated by `sum-loop-tour`'s steps 4 and 5. Reuse would have shipped a duplicate.

That is the shape of the argument to make before adding one: name what the existing corpus makes
**unreachable**, not what a new program would make **nicer**.
