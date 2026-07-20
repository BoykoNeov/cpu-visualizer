# paired-branches.s — two control transfers, back to back: the single branch unit.
#
# At width 2 the processor tries to issue instructions 0 and 1 in the same cycle,
# but they are BOTH branches, and the machine has only one branch unit. So the
# younger is refused for `branch-slot` and issues the cycle after — the structural
# hazard this program exists to provoke, and the only one the rest of the corpus
# cannot reach (no shipped program places two transfers adjacent).
#
# Both branches compare x0 to x0, so neither is taken (0 != 0 is false): execution
# falls straight through, a0 ends at 42, and — because nothing is taken — NOTHING
# is flushed. That makes it the cleanest possible witness of the refusal, with no
# misprediction muddying the trace.
#
# The two transfers MUST be the first two instructions: any setup ahead of them
# would shift the fetch-group boundary and they would no longer land together.

    .text
    .globl _start
_start:
    bne  x0, x0, done    # never taken — the elder of the two transfers
    bne  x0, x0, done    # never taken — refused for `branch-slot` at width 2
    li   a0, 42          # the answer: a0 = 42 (reached only by falling through)
done:
    li   a7, 10          # exit syscall (RARS a7=10 convention)
    ecall
