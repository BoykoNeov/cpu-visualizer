# branch-flavors.s — the same two registers compared as signed and as unsigned.
#
# t0 holds 0xFFFFFFFF, which is -1 read as signed and 4294967295 read as unsigned.
# The program computes min(t0, t1) twice over those identical bits — once with blt
# (signed), once with bltu (unsigned) — and the two answers disagree: a0 = -1,
# a1 = 1. The signed branch is taken and the unsigned one is not, which is the
# classic comparison trap: signedness lives in the instruction, never in the bits.
#
# It is also the corpus's only program whose branches are anything but bne/bge,
# and its only branch whose signed and unsigned readings differ at all.

    .text
    .globl _start
_start:
    li   t0, -1          # 0xFFFFFFFF: -1 signed, 4294967295 unsigned
    li   t1, 1

    mv   a0, t0          # guess: t0 is the smaller one
    blt  t0, t1, signed_done    # signed: -1 < 1, so the guess stands
    mv   a0, t1          # skipped — the taken branch jumped over it
signed_done:

    mv   a1, t0          # the same guess, about to face the same question
    bltu t0, t1, unsigned_done  # unsigned: 4294967295 < 1 is false, so NOT taken
    mv   a1, t1          # ...so we fall through and correct it: a1 = 1
unsigned_done:

    li   a7, 10          # exit syscall (RARS a7=10 convention)
    ecall
