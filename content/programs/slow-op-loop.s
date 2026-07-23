# slow-op-loop.s — a loop whose head is a long-latency ALU op.
#
# Each iteration shifts a loop-invariant value (3 << 2 = 12), adds it into a
# running total, and counts down. Six iterations leave 6 * 12 = 72 in a0.
#
# The shape is [slow -> dependent -> independent]: the `sll` produces t3, the
# `add` depends on it (and is loop-carried through a0), and the `addi`/`bnez`
# counter needs neither. On the out-of-order model with `slowOpLatency` set, the
# shift occupies its functional unit for several cycles; out-of-order issue runs
# the independent counter work during that wait and overlaps each iteration's
# shift with the next, so the loop finishes sooner (the reservation-station
# lesson). Under every other model — and on the out-of-order model at the
# default latency of 1 — the `sll` is a single-cycle op and this is an ordinary
# register-only counting loop, architecturally identical everywhere (INV-7/INV-8).

    .text
    .globl _start
_start:
    li   t1, 6           # t1 = i, counting down from 6
    li   a0, 0           # a0 = running total
    li   t5, 3           # slow-op input  (loop-invariant)
    li   t6, 2           # slow-op shift  (loop-invariant)
loop:
    sll  t3, t5, t6      # t3 = 3 << 2 = 12   (the long-latency op)
    add  a0, a0, t3      # total += 12        (depends on the shift; loop-carried)
    addi t1, t1, -1      # i--                (independent of the shift)
    bnez t1, loop        # repeat while i != 0

    li   a7, 10          # exit syscall (RARS a7=10 convention)
    ecall
