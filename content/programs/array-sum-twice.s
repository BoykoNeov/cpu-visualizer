# array-sum-twice.s — walk the same array twice, summing every element both passes.
#
# Sums { 1, 2, ..., 12 } = 78, twice, leaving 2 * 78 = 156 in a0. The outer loop
# resets the pointer to arr[0] each pass, so the second pass re-reads the exact
# same 12 addresses the first pass did. That re-read is the point: it is temporal
# reuse — the same data touched again — which is what a cache is for. array-sum.s
# is the single-pass sibling; this one exists to say what a single pass never can,
# that revisiting data can be cheaper the second time.
#
# Why 12 words: the working set is chosen to STRADDLE a small vs a large
# direct-mapped cache, so the SAME source runs a different cycle count when you
# flip the cache size — the flagship cache experiment. Against a 16-byte line
# (4 words), 12 words is 3 lines: it fits a 4-line cache, so the repeat pass finds
# every line still resident and hits; it overflows a 2-line one, so the earliest
# line has been evicted by the time the repeat pass asks for it again and it
# re-misses. (Cache-geometry note for M6 step 1's CacheConfig defaults: this array
# is sized against a 16-byte line, flipping 2 lines vs 4 lines. It is deliberately
# modest so it stays under the pipeline timing suite's per-run cycle cap. Exact
# per-pass hit/miss counts are hand-derived in step 4, not stated here.)

    .data
arr:    .word 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12

    .text
    .globl _start
_start:
    li   a0, 0           # a0 = running sum across both passes
    li   t3, 2           # t3 = passes remaining
outer:
    la   t0, arr         # reset pointer to &arr[0] at the start of each pass
    li   t1, 12          # t1 = element count for this pass
inner:
    lw   t2, 0(t0)       # t2 = arr[i]
    add  a0, a0, t2      # sum += arr[i]
    addi t0, t0, 4       # advance to the next word
    addi t1, t1, -1      # count--
    bnez t1, inner       # repeat inner while count != 0
    addi t3, t3, -1      # one pass done
    bnez t3, outer       # repeat outer while passes remain

    li   a7, 10          # exit syscall (RARS a7=10 convention)
    ecall
