# A cache miss can eat a forward — a correctness bug in the shipped miss-freeze

**Found 2026-07-27**, while probing M11 step 6 (does M6's miss-freeze on the 7-stage need
implementing, or can it be dropped with proof?). **Severity: a wrong architectural answer from a
knob documented as a pure timing shadow — an INV-8 violation, reachable from the app's sandbox.**
Status: **not fixed; scope decision pending.**

## The bug, in one sentence

**A cache miss freezes the execute stage before it captures its forwarded operands, and the value
it needed drains out of MEM/WB during the freeze — so on release the instruction computes on its
stale, pre-forwarding register read.**

`cache.ts` and `pipeline/src/processor.ts:199` both state the contract this breaks: the cache
"holds tags, never values, so it changes MEM _latency_ and never the answer."

## Minimal repro

```asm
    .text
    .globl _start
_start:
    li   x9, 64
    li   x10, 3          # P — writes x10
    lw   x5, 0(x9)       # Q — cold MISS
    addi x10, x10, -1    # C — needs x10 forwarded from MEM/WB
    li   a7, 10
    ecall
```

`forwarding: true`, `branchPrediction: 'none'`, `cache: CACHE_SMALL`. Correct `x10 = 2`;
`engine/pipeline` yields **−1**.

The geometry is what matters, not this program: **a producer P, then a memory op Q that misses,
then a consumer C of P**, positioned so C is in execute — needing the `MEM/WB → EX` forward — on
exactly the cycle Q detects its miss.

## Blast radius (swept: model × forwarding × 6 filler counts, each against that model's own

cache-off answer, which is the INV-8-verified truth)

| model                          | forwarding ON        | forwarding OFF |
| ------------------------------ | -------------------- | -------------- |
| `pipeline` (5-stage)           | **WRONG** (k=0)      | clean          |
| `superscalar`, `issueWidth: 1` | **WRONG** (k=0)      | clean          |
| `superscalar`, `issueWidth: 2` | **WRONG** (k=1, k=2) | clean          |
| `out-of-order`, in-order       | clean                | clean          |
| `out-of-order`, out-of-order   | clean                | clean          |
| `deep-pipeline` (step-6 probe) | **WRONG**            | clean          |

- **Sliding the filler count is load-bearing.** At k=0 the superscalar at width 2 looks clean; it
  is only dodging the geometry, and k=1 breaks it. Do not read a single green program as immunity.
- **The clean rows are not vacuous:** every cell above, including all four out-of-order ones, is
  `+10` cycles versus its cache-off run, so the miss really did freeze the machine in each one.
- **Forwarding OFF is safe by construction**, not by luck: the ID interlock holds C until P has
  written back, so C needs no forward and reads a register file that is correct by then.
- The out-of-order model is immune because a ROB entry holds its operand values; there is no
  transient forward window to lose.

## Mechanism, from the 5-stage's own cycle walk (shipped engine, cache on)

```
c 4 IF=i4@16 ID=i3@12 EX=i2@8 MEM=i1@4 WB=i0@0   ev=…,forward,alu-op,reg-read,…
        ^ C is in ID and reads x10 = 0 — STALE, because P is still in MEM
c 5 IF=i5@20 ID=i4@16 EX=i3@12 MEM=i2@8 WB=i1@4  ev=reg-write,instr-retire,cache-access
        ^ C reaches EX and the MEM/WB forward from P is RIGHT THERE (WB=i1@4)…
        ^ …but the access MISSES, memStall fires, and stageEx returns before the forwarding
          network runs. WB retires P and leaves `next.memWb` null.
c 6…c14  frozen; WB empty. P's value is now gone from the machine entirely.
c15  release                                     ev=mem-read,alu-op,reg-read
        ^ EX finally runs. prev.exMem = the load (writeValue null, no match on x10);
          prev.memWb = null. No forward fires. It executes on the stale 0 ⇒ x10 = −1.
```

`pipeline/src/processor.ts:797` is the exact line:

```ts
if (ctx.memStall) {
  ctx.next.idEx = ie;
  return;
}
```

The comment above it says the occupant "executes exactly once, on release". That is right about
the ALU and wrong about the forwarding capture — **the forward source is alive only on the cycle
the freeze skips.**

## Three distinct user-visible symptoms, all observed

1. **A wrong register value** — `x10 = −1` instead of `2` (above).
2. **A wrong load address, and a wrong cache line evicted.** With a stale `x9 = 0`,
   `lw x6, 4(x9)` accesses address 4 instead of 68: the verdict stream is `M M!40` where the truth
   is `M H`. It reads the wrong memory _and_ perturbs the cache state.
3. **A non-terminating program.** A loop counter whose decrement consumed the stale value never
   reaches zero. Six probe cells ran away past 3000 cycles.

## Why nothing caught it

The differential suites are green because the coincidence does not occur in the 11-program corpus
— it needs those three instructions adjacent, with the miss landing on that one cycle. It is
trivially reachable from the app's **sandbox**, where users write their own programs against
`pipeline` or `superscalar` with the cache on.

## The candidate fix, and its measured cost

Hold the **advance**, not the **work**: capture the forwarded operands on the freeze cycle and
latch them back onto the held latch, so the release cycle's own `resolveOperand` finds no producer
and returns them unchanged. One capture, one `forward` event, no new latch field:

```ts
if (ctx.memStall) {
  ctx.next.idEx = {
    ...ie,
    a: this.resolveOperand(ctx, ie, 'rs1', ie.decoded.rs1, ie.a),
    b: this.resolveOperand(ctx, ie, 'rs2', ie.decoded.rs2, ie.b),
  };
  return;
}
```

**Spiked on `engine/pipeline` and measured, then reverted:** it fixes every broken `pipeline` cell,
the freeze still costs its full `missPenalty`, and **the entire existing suite stays green — 4265
tests, zero churn.** No instruction's advance moves, so `cycles = N + 4 + S + P + M` still holds
and every pinned `TIMING` table, lesson anchor and recorder assertion survives untouched. The fix
is inert on the corpus for the same reason the bug hid there.

**One wrinkle on the deep pipeline:** EX1 cannot write captured operands into `ex1Ex2`, because
EX2's own frozen occupant is holding that latch. The storage goes on the held `idEx1` instead —
same shape as above, different latch.

## What this does to M11 step 6

The plan framed step 6's seam as a taste call with "no external ground truth" — _which of
IF1/IF2/EX1/EX2 freeze, and does an in-flight EX2 complete?_ — by analogy to M9 finding F9.
**The analogy fails. Freezing a stage that has not yet captured its forwarded operands is not a
choice, it is incorrect**, and the golden reference is exactly the external ground truth the plan
said did not exist.

**Step 6 is therefore blocked, in both directions:** it cannot be dropped with proof (the proof
would rest on a baseline whose freeze semantics are wrong) and it cannot be shipped (it would ship
the same hole). Any dump taken before the fix measures a broken machine.

## Method note — why the obvious check would have missed this

The probe swept the corpus × forwarding × prediction × {small, large} = 132 cells and found
**cycles, event multiset, architectural state and the cache-token sequence all matching exactly.**
The bug surfaced only once five hand-built ADVERSARIAL programs aimed a miss at a live front end.

And on one of those, `adv-flush-under-miss`, **the cycle count matched exactly while two
`forward:MEM/WB->EX1` events vanished (`1→0`)**. The identity
`cycles_cache = cycles_nocache + misses × missPenalty` held in _every_ cell, including the broken
ones. **Checking cycles alone — the obvious check — would have declared the cache mechanical and
been wrong.** The event multiset is what saw it, and the adversarial programs are what produced
it. Any post-fix re-verification should keep that shape.

## Artifacts

`M:\claud_projects\temp\m11-cache-probe\` — `step6-probe.test.ts` (the 192-cell sweep: cycles /
event multiset / architectural state / cache-token equality against the 5-stage, plus the five
adversarial programs and a vacuity guard), `step6-debug.test.ts` (the cross-model table and the
cycle walk above), `dump.txt`. They are vitest files: drop them into
`packages/engine/deep-pipeline/src/` to re-run. Only the deep-engine rows need the step-6 cache
graft (reverted with `git checkout`); **the 5-stage and superscalar rows run against shipped,
unmodified code.**
