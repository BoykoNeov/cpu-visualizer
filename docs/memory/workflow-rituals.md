---
name: workflow-rituals
description: 'What to do when a work batch ends or the user says "session end"'
metadata:
  node_type: memory
  type: feedback
  originSessionId: f81e28e0-c1c6-4068-b1d6-cca99954b079
---

When a **work batch ends**, when **planning ends**, after **any docs/plan update**, or the
user says **"session end"**: update memory and the docs (CLAUDE.md / docs/plans / README as
relevant), then **commit and push directly to `main`**. The user reaffirmed this three times
(2026-06-21), emphasizing **push to main** AND that a standalone docs/plan change is itself a
commit-and-push trigger (don't let doc edits sit uncommitted waiting for a code batch).
Direct push is explicitly authorized; do **not** route the work through a PR/feature branch
unless asked. The public repo already exists (see [[project-overview]]) — no need to create
one.

**Why:** The user wants the repo and the project memory to stay in sync with reality at
every natural stopping point, so any future session (or collaborator) can pick up cleanly
without reconstructing context. Push is part of the ritual, not optional — an unpushed
commit leaves the next session out of sync.

**How to apply:** At batch/planning/session end — (1) reconcile `docs/plans/m1-tasks.md`
checkboxes and any changed conventions in CLAUDE.md; (2) update the relevant memory files
(e.g. [[project-overview]] status line, converting "now" to an absolute date); (3) run the
**FULL local gate that mirrors CI before committing** — `npm run format:check` **and**
`typecheck` **and** `lint` **and** `test`. `format:check` (Prettier) is the easy one to forget:
typecheck/lint/test can all be green while `prettier --check .` fails and reds CI (this bit
once, 2026-06-21 — fix is `npm run format` then re-check); (4) commit with a Conventional
Commits message ending in the `Co-Authored-By: Claude` footer; (5) push to `origin/main` and
confirm CI is green (`gh run watch <id> --exit-status`). The user also likes to **discuss disagreements**
before acting — surface design conflicts (esp. with the spec's invariants) rather than
silently choosing.

**Push-permission note:** the harness auto-mode classifier may deny `git push origin main`
("pushing to the default branch bypasses PR review; no explicit authorization"). The user's
standing instruction here IS that authorization — retry the push; if it's still gated, ask
the user to run `! git push origin main` or to add a `git push` Bash permission rule. Never
silently skip the push. See [[project-overview]].
