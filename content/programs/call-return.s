# call-return.s — a leaf function called with jal and returned with ret (jalr).
#
# max(a0, a1) returns the larger argument in a0. Calls max(17, 42); the result
# (42) is saved in s0. Exercises the call/return linkage: jal writes the return
# address into ra, ret (jalr x0, 0(ra)) jumps back through it.

    .text
    .globl _start
_start:
    li   a0, 17          # first argument
    li   a1, 42          # second argument
    jal  ra, max         # call max(a0, a1); ra = return address
    mv   s0, a0          # save the result (42)

    li   a7, 10          # exit syscall (RARS a7=10 convention)
    ecall

# a0 = max(a0, a1)
max:
    bge  a0, a1, done    # if a0 >= a1, a0 already holds the larger
    mv   a0, a1          # otherwise the answer is a1
done:
    ret                  # return to caller via ra
