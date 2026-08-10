# register-reuse.s — two instructions write a register an older instruction is still using.
#
# Exists for M15 step 6: the scoreboard's whole subject is the pair of hazards register renaming
# deletes, and NEITHER was reachable on the corpus that shipped before it.
#
#   WAR — measured over all twelve programs, `'war'` stalls fire ZERO times. Not merely untaught:
#         the one hazard the milestone exists for is invisible on the whole corpus.
#   WAW — `'waw'` stalls do fire, on 6 of 12 programs, but every one of them is a `la rd, label`
#         expansion (`lui rd` / `addi rd, rd`). Its younger writer READS rd, so it waits on the
#         producer regardless: those pairs move TIMING and can never corrupt ARCHITECTURE. Stub the
#         scoreboard's WAW check and all twelve INV-8 cells stay green — the differential is a
#         false net for the mechanism.
#
# So this program carries a younger writer of each kind that does NOT read the register it
# overwrites, which is what makes both hazards architecturally visible:
#
#   `addi t2, x0, 5` overwrites t2 while the older `add a0, t3, t2` is parked at Read Operands
#   waiting on the load — t2 already READY but not yet READ. That is WAR, and the scoreboard holds
#   the younger write at Write-Result, the only stall in the product that fires at the END of an
#   instruction's life. Without the hold, a0 reads the future and lands on 26 instead of 24.
#
#   `addi t1, x0, 7` overwrites t1 while the older `lw t1, 4(t0)` is still in the memory unit. That
#   is WAW, and the scoreboard holds the younger write at Issue. Without the hold the `addi` lands
#   7 first and the load drops 9 on top of it, so t1 ends 9 instead of 7.
#
# The two hazards need two SEPARATE slow producers, which is why there are two loads. A WAR pair
# occupies both integer units for the entire window in which its load's register claim is live, so
# a WAW writer aimed at that same load can never reach Issue in time — measured, not assumed.
#
# It also keeps the benign flavour for contrast: the `la` on line 3 is itself a WAW pair, and its
# stall is real while its corruption is impossible.
#
# Straight-line on purpose — no branch, no loop. Every model's pinned timing table gains a row that
# is hand-derived, and a recurrence multiplies that cost for nothing this program is here to show.

    .data
first:  .word 21
second: .word 9

    .text
    .globl _start
_start:
    li   t2, 3           # t2 = 3
    la   t0, first       # t0 = &first  (lui/addi: a WAW pair whose younger writer READS t0)
    lw   t3, 0(t0)       # t3 = 21 — slow producer A
    add  a0, t3, t2      # a0 = 21 + 3 = 24; parks at Read Operands on t3, holding t2 READY UNREAD
    addi t2, x0, 5       # WAR on t2 — held at Write-Result until the `add` above has read
    lw   t1, 4(t0)       # t1 = 9 — slow producer B
    add  a1, t1, t2      # a1 = 9 + 5 = 14 — reads the loaded t1, so B's value is not dead
    addi t1, x0, 7       # WAW on t1 — held at Issue until the load above has written

    li   a7, 10          # exit syscall (RARS a7=10 convention)
    ecall
