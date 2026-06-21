# add.s — the smallest interesting program.
# Computes 5 + 37 and leaves the result (42) in x5.
#
# Seed fixture: the assembler and a halt convention are still being built
# (see docs/plans/m1-tasks.md).

    .text
    .globl _start
_start:
    addi x1, x0, 5      # x1 = 5
    addi x2, x0, 37     # x2 = 37
    add  x5, x1, x2     # x5 = x1 + x2 = 42
