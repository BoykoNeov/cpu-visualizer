---
name: browser-rig-vacuity-traps
description: "The ways a CPU Visualizer browser check passes while measuring nothing — assert the negative state first or a broken selector passes the positive check for free; too-broad and too-narrow selectors both bite; a production CSS hash makes every ABSENCE assertion pass; a rig pinning a temporary scope decision reports a regression against a deliberately improved machine; and a HEIGHT RESERVE grows new elements that answer to an old rig's selectors. In two M11 runs and again in M14 step 5, ALL failures were the rig, not the app."
metadata:
  node_type: memory
  type: project
  originSessionId: 573123f6-87e0-4ded-b6e3-f2357201c7ae
  modified: 2026-08-09T17:32:33.099Z
---

Once you can drive the app ([[browser-rig-cdp-recipe]]), the remaining failure mode is a check that
is green and about nothing. The house record: in **M11 step 5, five of five failures were the rig**,
and in **M11 step 7 all of them were** — including one that failed against a _correct_ app.

**ASSERT THE NEGATIVE STATE FIRST, or a broken selector passes the positive check for free**
(2026-07-27, M11 step 5 — `follow-scrub.mjs`). Reading a computed style through
`code.closest('div').parentElement` climbed one level past the element carrying `visibility` and
landed on the always-visible header row. The "readout is VISIBLE after the click" check passed —
**vacuously, since that selector could never return anything else** — and only the "readout is
HIDDEN before the click" check exposed it. A visibility/enabled/pressed assertion is worth nothing
unless the same selector has been seen returning the other value. In that run **five of five
failures were the rig, not the app**: the same class of thing as the too-broad/too-narrow selectors
below, plus a register-row regex that read `78120` out of `a0 | x10 | 0x00000078 | 120` because
`textContent` runs the cells together (anchor on the eight-hex-digit word), a transport equality
that ignored the trailing `— halted` on the last cycle, and a "seven cells, one per stage"
expectation on a row that STALLS — eight cells over seven stages. **Assert the DISTINCT stages,
never a cell count: a count is a claim that no stall happened.**

**Vacuity cuts BOTH ways — a check can be too BROAD as easily as too narrow.** Too narrow/wrong-target
(all measured): regexes for `-128`/`0x80` over `document.body.innerText` match the SOURCE panel's own
comments — **and this recurs: M5 step 5's `/\bs0\b/` over `<tr>`s matched `# (42) is saved in s0`,
source line 4, because the Source panel is a table too**; **"the longest paragraph on screen" grabs
the TOOLBAR**, because essentials narration is short; `/^LESSON/` matches the toolbar **chip**, not
the narration panel; "the smallest element containing the step counter" is the **header row**;
**"buttons with a `title`" counted the rail's prev/next scrub controls as lesson steps** (6 "steps"
in a 4-step lesson), so "click the last dot" clicked **Next** and the script then read step 1's
narration while reporting success — the rail declares `[role="tab"]` inside
`[role="tablist"][aria-label="Lesson steps"]`, so **use the ARIA the component already exposes rather
than a shape that merely correlates**. Too broad: M5 step 3's first datapath check compared
**whole** wire lists and reported "not identical" — a **false alarm**, since the pc/encoding/target wires
must differ between two different instructions. Isolate the thing the claim is actually about (e.g. the
ALU operands = numeric wire texts only, `/^-?\d+$/`), read the specific panel's table rows
(`section.panel` whose `h2` names it → `tr` → cells), and when the selector fights back, **stop scraping
and look at the image** ([[browser-rig-screenshot-limits]]).

**A RIG SELECTOR EXPIRES WHEN THE APP GROWS A NEW ELEMENT OF THE SAME SHAPE — and a HEIGHT RESERVE is
a factory for them** (2026-07-30, M14 step 5). M12's `__narration()` read "the visible `<p>` stacked at
`gridArea: '1 / 1'`" over the WHOLE document, which was unique when written. Three days before this
run the panel-jitter fix ([[panel-jitter-and-height-reserves]]) gave the Data memory panel a reserve
whose "no data memory written" placeholder is exactly that shape — and it is VISIBLE on every program
that writes no data, which is every program in the width track. Result: `MULTIPLE:2` on all thirteen
lesson walks, and it was the rig every time. This is the "a rig that pins a scope lever expires when
the lever moves" rule below, in its other direction: there the APP's contract moved, here
the app grew a NEIGHBOUR. Before re-running an old rig after any layout work, ask what new elements
answer to its selectors. The fix is the scoping rule below, stated on the component's own ARIA
(`section[aria-label="Lesson narration"]`).

**⚠ A PRE-BROWSER DUMP IS ONLY AN ORACLE FOR THE CONFIG THE APP IS ACTUALLY IN — and "the default
config" can be two different things** (2026-08-09, the predictor's step 7). The dump ran each model
on `defaultConfig()`; `ProcessorConfig` leaves `issueWidth` / `outOfOrderIssue` / `robSize`
**optional**, so the engine got `undefined` and fell back to its OWN defaults, while the shell opens
on `session.ts`'s `OPENING_KNOBS` (1 / false / 16). The out-of-order column came out 104 against the
app's 130 and read exactly like a broken model picker. The dump rule this file already states
("read every expected NUMBER from the dump") has a precondition: **the dump must be handed the
knobs the shell opens on, not the ones the type makes convenient.** Check optional config fields
first — they are where the two defaults diverge silently.

**⚠ NEVER RESTORE A COUNTERFACTUAL BY CLEARING A STYLE THE FRAMEWORK OWNS, AND RE-NAVIGATE AFTER
ONE** (same pass). A rig hid an element with `style.display = 'none'` and restored with
`style.display = ''`. React had set `display: flex` from a style prop that did not change, so it
never re-set it — the row silently became `display: block` for the REST OF THE RUN, and the next
section reported "the header wraps at 1400px", which was that damage rather than a finding. Two
rules: use `visibility: hidden` + `position: absolute` (which also removes the ghost from the a11y
tree), and **re-navigate between sections that mutate the DOM** — a rig's later sections inherit its
earlier sections' damage, which is the leftover-state trap below aimed at your own script instead of
at the app. Also: target the counterfactual precisely — `span[1].parentElement` was the CONTAINER,
so the "hide one caption" probe hid the whole header and its number meant nothing.

**⚠ A CHECK THAT REQUIRES AN APP-WIDE CONSTANT TO BE A VARIABLE REPORTS A DEFECT AGAINST A DECISION**
(same pass). "The panel's ink must differ between palettes" failed on the unowned row — because
`T.ink3` is `--ink-3` = `#898781` in **all three** CSS blocks by design, 8 call sites. Assert the
surface's OWN new ink, and pin the invariance as its own check so the next reader is not told twice.
General form: before asserting that a value moves with a mode, grep whether it is defined per-mode
at all.

**Scope every panel read to its own `<section>`.** An unscoped search for a leaf whose text is a
data-memory ADDRESS finds the REGISTERS panel first, where a register holds that same address as a
VALUE — the rig read `268435476` (= `0x10000014`) and called it memory. Same class as the three
`.dp-legend` blocks (map, datapath, cache grid) that now share one page.

**A check can also measure its own LEFTOVER STATE** (M5 step 4). "What does the app open on?" was
answered by reading the Program picker _after_ the script had driven a lesson — it reported
`call-return`, the lesson's own program, not the mount default. Green, precise, and about nothing.
**Any claim about initial/default state needs a fresh `Page.navigate`, not the tab you have been
clicking.** (The answer, once measured properly: `sum-loop`, chosen explicitly in `useSimulator.ts`
— which disproved a claim a previous step's log had asserted as fact.)

**A production CSS/class transform can make an entire rig VACUOUS in one direction only** (M11 step
8). These rigs find controls by an uppercase caption via `getComputedStyle(...).textTransform` and
wires by `.dp-wire--on`. If the built CSS 404s or a class is hashed, every lookup returns `null` and
**every ABSENCE assertion passes** — which reads as "the control is missing", not "the rig is
broken". A preview rig's first section must assert: built bundle, CSS loaded (sheets AND rule count),
a **known-present** control found, class selectors resolving. Only then does a `null` mean anything.
And §0's "known-present control" check must select a model that HAS the control first — checking it
on `single-cycle` (which honors no knobs) reports the rig broken when its own premise was wrong.

**A RIG THAT PINS A SCOPE LEVER EXPIRES WHEN THE LEVER MOVES — rewrite it, do not re-run it**
(2026-07-27, M11 step 6). Step 5's `eyeball.mjs` verified "pipeline(cache small) → Deep pipeline
shows NO cache control and the value is clamped away, so returning restores it". One step later the
model HONORED the cache, so the correct behaviour became the exact opposite (the value carries over
and changes the count) — and the old rig would have reported a regression against a machine that
had been deliberately improved. **Before re-running an old rig, ask which of its assertions were
pinning a temporary scope decision rather than a lasting contract.** Keep the machinery (helpers,
CDP plumbing, `__map`/`__seg`/`__cycles`); re-derive the expectations. In M11 this fired twice —
step 5 pinned "the deep pipeline has no cache control and the value is clamped away", and step 6
shipped the knob, inverting all of it. **Expect to port checks, not re-run files.**

**VERIFY A DIAGRAM AGAINST A DUMP TAKEN BEFORE THE BROWSER RAN — and dump what the VIEW draws, not
what the pure function LIGHTS** (2026-07-27, M11 step 7). The datapath activation modules are
tier-OBLIVIOUS by design (INV-2): `activate()` lights every contraction wire alongside the
through-mux wire it stands in for, and the VIEW filters by tier×config. Comparing the raw
activation set against the live canvas reported two "missing" wires — both contractions correctly
hidden at expert, i.e. **the rig failed against a correct app**. Emit the `wireVisibleAt`-filtered
set, and turn the inverse into a check (those wires are ABSENT from the canvas, not merely dim).
Two more things from that pass:

- **Match wires by their `points` geometry.** A wire carries no id in the DOM — only a React `key`,
  which is not rendered. The geometry is the honest key anyway: it is what the reader sees.
- **Read every expected NUMBER from the dump; never guess a threshold.** A guessed ">40 wires"
  failed at 34 — which was exactly right for the state the shell opens in (dump a
  tier×config→count table and index it with the state you read live). Of the failures in that
  run, **all** were the rig, continuing the M11 step-5 pattern.

**HEADLESS CHROME REPORTS `prefers-color-scheme: dark`, so the shell's `auto` theme OPENS DARK
here** (2026-07-29, M13 step 9). A theme section that reads the tints at `auto`, then clicks to
explicit `dark` and compares, is **comparing dark against dark** — it reports "the tints did not
change with the theme", which reads exactly like a missing dark block, and the LIGHT block never
gets measured at all. `auto` is not a third palette; it is whichever of the two the host prefers.
Drive to each **explicit** position and read the label back before reading any color.

**A CONTROL WHOSE CORRECT BEHAVIOUR IS "THE SAME NUMBER" NEEDS A SECOND MEASUREMENT TO DISTINGUISH
CORRECT FROM DEAD** (same pass). The out-of-order model forced to in-order issue returned cycle
counts **identical to the superscalar at all four widths** — which is either the bisection control
working exactly as designed or the model picker silently not taking, and nothing in the section
could tell them apart. The fix is to flip the model's OWN knob and require the numbers to move
(`array-sum` 51/42/36/36 in order vs 51/33/30/26 out). Generalises past themes and models: **any
check whose passing value equals the value a broken app would also produce is not a check.**

**A LABEL-COLLISION METRIC MUST MEASURE THE PROMISE THE CODE MAKES** (same pass). Comparing every
`<text>` against every wire SEGMENT reported the datapath's value labels as overlapping — but
`layoutLabels` anchors each label at the midpoint of its OWN wire and nudges it off, so proximity to
_a_ wire is the design. What it actually promises is **no label on another label and no label on a
component box**; only the second reddened, and it was the real defect. And the signed number was a
**pointer, not a verdict**: −7 was legible (the box overhangs a bar by half a character) and −31 was
not, so **the metric ranked the widths and a 4× crop decided which was broken.**

**Ask which path the last refactor existed to fix, and whether anything ever clicked it.** M11's
`useSimulator` change was made because "two refs assigned at three sites is how the LESSON path
stays broken while the picker path looks fixed" — and four consecutive browser passes then drove
the picker and left `Lesson: — none —` alone. When a lesson/config path IS driven, assert a
**pinned recording length** for its own config (the wrong model records a different, also-plausible
number), and assert leaving it as a **cross-route identity** rather than a guessed constant.

**A browser pass must READ THE RENDERED WORDS, not just prove the rail exists** (2026-07-28, M12
step 5, the lesson track): at rest the visible narration is the "Press Next step" prompt, so a track
can ship with every anchor correct and no prose ever reaching the screen. Walking it that way found
`Lesson.depthDefault` dead since M1 (all 22 lessons opened at EXPERT prose). The general form:
**which fields of a declarative content format does the app actually read?** A field nothing
consumes fails silently forever, and headless tests here cannot see it — they assert narration
RESOLVES at a tier (a question about the lesson), never which tier the SHELL picks. See
[[m12-deep-pipeline-lessons]].
