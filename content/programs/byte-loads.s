# byte-loads.s — lb sign-extends, lbu zero-extends the same stored byte.
#
# The byte 0x80 reads back as -128 with lb (sign-extended to 0xFFFFFF80) and as
# +128 with lbu (zero-extended to 0x00000080) — the classic load-extension trap.

    .data
b:      .byte 0x80

    .text
    .globl _start
_start:
    la   t0, b
    lb   t1, 0(t0)       # t1 = -128  (sign-extended)
    lbu  t2, 0(t0)       # t2 =  128  (zero-extended)

    li   a7, 10          # exit syscall (RARS a7=10 convention)
    ecall
