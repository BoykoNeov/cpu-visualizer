# Example programs

RV32I assembly programs that serve **three roles at once** (spec §9, §12, §13):

1. **Correctness test fixtures** — every model's final architectural state must equal the
   golden reference's on each program (INV-8).
2. **The free-play library** — loadable into any model at any depth outside a guided lesson.
3. **Lesson fixtures** — a lesson references a program + a model + a config + steps.

> The assembler and the halt/print convention are still being built
> (see `docs/plans/m1-tasks.md`). Programs here are seeds and may need small edits once
> those are finalized.
