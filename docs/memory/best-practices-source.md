---
name: best-practices-source
description: 'The Claude Code best-practices guide the user asked to apply, and what was adopted'
metadata:
  node_type: memory
  type: reference
  originSessionId: f81e28e0-c1c6-4068-b1d6-cca99954b079
---

The user asked to apply reasonable best practices from
**https://rosmur.github.io/claudecode-best-practices/** to this project.

**Adopted at scaffold time:** monorepo; concise CLAUDE.md (what-Claude-gets-wrong +
invariants + DAG, not a manual); Conventional Commits; CI gating lint/format/typecheck/
test/build; mechanical dependency-boundary enforcement; a single living plan doc
(`docs/plans/m1-tasks.md`) instead of the three-file plan/context/tasks ceremony.

**Deliberately skipped/deferred** (judged not reasonable for an early-stage repo): auto-
format hooks (the guide itself warns these burn tokens), heavy pre-commit hooks, and the
pnpm/Corepack setup — the user chose **npm workspaces** to avoid Corepack friction on
Windows.

**Conflict resolved:** the guide says avoid "AI-generated" in commit messages, but the
harness mandates the `Co-Authored-By: Claude` footer — follow the harness. See
[[project-overview]].
