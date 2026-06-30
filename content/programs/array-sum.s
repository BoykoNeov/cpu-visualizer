# array-sum.s — walk an array of words in .data, sum them, store the result.
#
# Sums { 5, 17, -4, 100, 2 } = 120. Demonstrates .data, la, a pointer-walking
# loop (lw + pointer bump), a negative element (lw sign-extends it), and sw to
# write the total back to memory.

    .data
arr:    .word 5, 17, -4, 100, 2
total:  .word 0

    .text
    .globl _start
_start:
    la   t0, arr         # t0 = &arr[0]
    li   t1, 5           # t1 = element count
    li   a0, 0           # a0 = sum
loop:
    lw   t2, 0(t0)       # t2 = arr[i]
    add  a0, a0, t2      # sum += arr[i]
    addi t0, t0, 4       # advance to the next word
    addi t1, t1, -1      # count--
    bnez t1, loop        # repeat while count != 0

    la   t3, total
    sw   a0, 0(t3)       # total = sum

    li   a7, 10          # exit syscall (RARS a7=10 convention)
    ecall
