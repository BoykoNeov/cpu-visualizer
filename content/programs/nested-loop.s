# nested-loop.s — the same inner loop entered four separate times: the program a
# dynamic branch predictor exists for.
#
# Four outer passes of a six-iteration inner loop, counting 1 twenty-four times
# into a0. No memory is touched at all — this program's whole subject is CONTROL.
#
# Why it had to be written (the step-0 measurement, docs/plans/dynamic-branch-
# prediction.md): every other loop in the corpus is entered ONCE, so a predictor
# that simply always bets taken is already right on every iteration and a dynamic
# one can only pay its cold start and catch up. Over the entire eleven-program
# corpus a 2-bit predictor beat `static-taken` by a single cycle. Re-entry is the
# missing ingredient, and it is the only one:
#
#   `bne t1, x0, inner` sees T T T T T N, four times over. A 1-BIT counter is
#   knocked all the way to not-taken by each pass's exit, so it mispredicts the
#   FIRST iteration of every later pass — three re-entry mispredicts. A 2-BIT
#   counter's exit only drops it from strongly- to weakly-taken, so it re-enters
#   still betting taken and all three vanish. That disappearance is the whole
#   lesson, and it is worth exactly 3 cycles here.
#
# `bne x0, x0, done` is the guard that never fires — a loop-skip test at the top
# of each pass whose condition is always false. It is not padding: it is the
# fall-through witness that makes the ordering come out textbook. A bet on it is
# pure loss for `static-taken` (2 cycles, four times over), while both dynamic
# schemes start weakly-not-taken and are immediately right, for free. The branch
# penalty runs 46 / 41 / 38 / 35 for not-taken / taken / 1-bit / 2-bit on the
# 5-stage: the better predictor is genuinely the faster one, which is the claim
# the old corpus could not make.
#
# ## Two ordering decisions that are load-bearing, and were MEASURED
#
# Both exist to keep every register dependence here at distance 1 from a producer
# in the SAME basic block, because that is the only shape whose stall cost is the
# same under every prediction scheme. A dependence at distance 2, or one reaching
# across a branch, is re-timed by what that branch predicted — the 7-stage pays 4
# cycles for a lost bet, and the 2-wide machine re-partitions its issue groups
# around one — so the same stall appears under one scheme and vanishes under
# another. Three pinned timing tables state ONE stall histogram per forwarding
# position for ALL schemes, and a program that broke that would change their
# shape rather than just add a row.
#
#   * The guard sits AHEAD of `li t1, 6`, so nothing reads across it.
#   * `addi t1, t1, -1` comes BEFORE `addi a0, a0, 1` — the decrement hoisted
#     above the accumulate, the way a scheduler would, so it is adjacent to the
#     `li` that produces t1. The other order was written first and measured: it
#     put the 2-wide machine's blocking stalls at 60 under `static-not-taken` and
#     64 under `static-taken`, which is exactly the invariant described above.
#
# The three branch sites are 8 / 24 / 32, so a pc-indexed table gives them
# distinct entries at 16 and 8. At 4 entries the guard and the inner branch
# COLLIDE (both index 2) — the corpus's first aliasing witness, and a reason to
# pin the table at 8 or 16 rather than a fact to design around.

    .text
    .globl _start
_start:
    li   a0, 0           # a0 = running count across every pass
    li   t2, 4           # t2 = outer passes remaining
outer:
    bne  x0, x0, done    # the guard that never fires — 0 != 0 is false, four times
    li   t1, 6           # t1 = inner iterations for THIS pass — reset every pass
inner:
    addi t1, t1, -1      # one inner iteration done
    addi a0, a0, 1       # count++
    bne  t1, x0, inner   # T T T T T N — the branch the whole program is about
    addi t2, t2, -1      # one pass done
    bne  t2, x0, outer   # re-enter the inner loop, with the predictor already warm
done:
    li   a7, 10          # exit syscall (RARS a7=10 convention)
    ecall
