# strided-sum.s — sum one field from each record of an array of structs.
#
# `recs` is an array of five 16-byte records; the loop reads the FIRST word of
# each (the others stand in for fields we don't touch) and accumulates them:
# 7 + 20 + (-3) + 50 + 6 = 80, left in a0 and stored to `total`.
#
# The point is the ACCESS PATTERN. The pointer advances by 16 bytes — exactly one
# cache line (LINE_SIZE_BYTES) — every iteration, so no two loads ever share a
# line: each `lw` touches a brand-new block and MISSES (a compulsory miss every
# iteration, at every cache size, since nothing is ever re-read). Contrast
# `array-sum.s`, whose unit-stride walk misses once per line and hits the other
# three words — spatial locality this program deliberately has none of.
#
# That miss-every-iteration stream is what the out-of-order model turns into a
# money shot. The loop-carried `add a0, a0, t2` is stuck on the missing load, but
# the pointer bump `addi t0, t0, 16` is independent of it: out-of-order issue runs
# the bump ahead while the current load is still outstanding, so the NEXT
# iteration's load address is ready and its miss begins UNDER the current one
# (miss-under-miss, gated by the MSHR count). In-order issue freezes the whole
# front end on the first miss, so the second load cannot even start until the
# first resolves — the misses never overlap, and the loop runs far slower ("Racing
# ahead of the miss"). Architecturally the answer is 80 on every model at every
# config (INV-7/INV-8); only the cycle count moves.

    .data
recs:   .word 7,  0, 0, 0      # record 0, field summed = 7
        .word 20, 0, 0, 0      # record 1, field summed = 20
        .word -3, 0, 0, 0      # record 2, field summed = -3
        .word 50, 0, 0, 0      # record 3, field summed = 50
        .word 6,  0, 0, 0      # record 4, field summed = 6
total:  .word 0

    .text
    .globl _start
_start:
    la   t0, recs        # t0 = &recs[0]
    li   t1, 5           # t1 = record count
    li   a0, 0           # a0 = sum
loop:
    lw   t2, 0(t0)       # t2 = recs[i].field   (a fresh line every iteration ⇒ a miss)
    add  a0, a0, t2      # sum += field         (loop-carried; stuck on the missing load)
    addi t0, t0, 16      # advance one record = one cache line (independent of the load)
    addi t1, t1, -1      # count--
    bnez t1, loop        # repeat while count != 0

    la   t3, total
    sw   a0, 0(t3)       # total = sum

    li   a7, 10          # exit syscall (RARS a7=10 convention)
    ecall
