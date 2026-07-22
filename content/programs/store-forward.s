# store-forward.s — a store immediately followed by a load DEPENDENT on it (same address).
#
# Exists for M9 step 1b: the corpus had no store followed by a load aliasing the SAME address
# (`array-sum.s`'s `sw total` aliases nothing any load reads), so memory disambiguation — the one
# OoO bug INV-8 can actually catch — had nothing to catch. An out-of-order, non-blocking LSU must
# not let `lw` read `cell` before the older `sw` to `cell` has taken effect, even though the two
# may compute their addresses (and, under this model, complete their cache timing) out of order.

    .data
cell:   .word 0

    .text
    .globl _start
_start:
    la   t0, cell        # t0 = &cell
    li   t1, 99          # value to store
    sw   t1, 0(t0)       # cell = 99
    lw   a0, 0(t0)       # a0 = cell — must see 99, never the stale 0

    li   a7, 10          # exit syscall (RARS a7=10 convention)
    ecall
