# sum-loop.s — sum the first N integers with a counting loop.
#
# Computes 10 + 9 + ... + 1 = 55, leaving the total in a0. A backward branch
# (bnez) closes the loop; the loop variable counts down to zero.

    .text
    .globl _start
_start:
    li   a0, 0           # a0 = running total
    li   t0, 10          # t0 = i, counting down from N = 10
loop:
    add  a0, a0, t0      # total += i
    addi t0, t0, -1      # i--
    bnez t0, loop        # repeat while i != 0

    li   a7, 10          # exit syscall (RARS a7=10 convention)
    ecall
