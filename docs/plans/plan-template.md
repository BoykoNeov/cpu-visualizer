# Milestone N — <model / feature name> (PLAN TEMPLATE)

<!--
This is the distilled skeleton of m1-tasks.md / m2-tasks.md — copy it to mN-tasks.md and fill it
in. The section set and their ORDER are the house style; keep them. Conventions that made the
first two plans work:

  * The status banner is maintained, not written once — update it as steps land, and say
    explicitly what is PROVEN (headless tests / build green) vs still PENDING (browser eyeball).
  * Every step embeds its own acceptance line — "each step testable before the next" is the
    contract, not a slogan.
  * Deliberate simplifications are SURFACED as pinned decisions (INV-5 permits lawful omission,
    never contradiction) and, where real, carved out as named follow-up steps (e.g. M2's 5c).
  * Checkboxes get ✅ + a past-tense summary when done, so the plan doubles as the milestone log.
-->

**Status: <NOT STARTED | step K in progress | COMPLETE>, <date>. <What is proven headlessly;
what is browser-verified; what is deliberately deferred (name the follow-up step).>**

Source of truth for scope: `cpu-visualizer-spec.md` §12 (roadmap). The load-bearing constraints
are the architectural invariants (§3) and the trace schema (§5).

## Why this milestone, and why now

<!-- Sequencing rationale: what did the previous milestone NOT exercise that this one does?
     Why this tier before the alternatives (what hard thing does it isolate / de-risk)?
     What is cheap because it is shared (ISA semantics mirrored from the golden reference)?
     What genuinely new machinery does it introduce (name it precisely)? -->

## Headline decision — <the one choice everything hangs off>

<!-- The model's soul. State it as layered options (MVP vs deferred fidelity), note that INV-8
     checks only final architectural state (so fidelity choices are about pedagogy + the datapath
     view, not correctness), and end with a bolded recommendation and the scope lever the
     reviewer signs off on. -->

## Build order (each step testable before the next)

<!-- Numbered checkbox steps. Front-load any "second model lands"-style refactors the previous
     decisions log deferred. Model core before view; view behind an explicit scope decision.
     Every step ends with "Acceptance: …" naming the observable proof (tests / typecheck / lint /
     a specific behavior). The typical shape for a new-model milestone — see
     docs/templates/new-model-datapath.md for the detailed per-step playbook:

  - [ ] 0..k. Deferred refactors that this milestone finally justifies.
  - [ ] k+1.  engine/<model> package — the model MVP (Processor, phases, micro, INV-4 ids).
  - [ ] k+2.  Differential net: runConformance(() => new XProcessor()) (INV-8).
  - [ ] k+3.  Recorder / time-travel proof over the new model (follow(), scrub).
  - [ ] k+4.  Web enablement (models.ts entry — panels/transport work via INV-3 for free).
  - [ ] k+5.  Bespoke datapath: geometry+activation module (pure, tested) + DatapathDiagram
              wrapper view + render smoke test + browser eyeball.
-->

- [ ] **0. <step name>.** <What and why, with file-level specifics.> Acceptance: <observable proof>.

## Acceptance criteria (mirror the spec §11 shape)

<!-- The end-to-end demo script a reviewer can follow, phrased as checkboxes: load program X on
     the new model, step/scrub, watch the specific new thing (varying cycle counts, hazards, …),
     plus "all suites green" and "INV-8 differential passes on the full corpus". -->

- [ ] <criterion>

## Decisions to pin (fill in as steps land — seeded with the recommended answers)

<!-- A table or list of open choices, each seeded with a recommendation so review is a diff, not
     a brainstorm. When a decision closes, record WHAT was chosen, WHY, and what follow-up step
     (if any) it spawns. This section is what future milestones' "deferred to when X lands"
     references point back to. -->

| Decision | Recommendation (seed) | Pinned answer |
| -------- | --------------------- | ------------- |
| <choice> | <recommended default> | _(open)_      |
