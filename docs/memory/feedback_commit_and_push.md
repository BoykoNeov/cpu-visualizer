---
name: feedback_commit_and_push
description: User expects every change to be committed and pushed to main without being asked
metadata:
  node_type: memory
  type: feedback
  originSessionId: 0f83b3d4-b46d-4c9a-8af0-d64c13180e1a
---

Always commit and push after making changes — do not stop and ask.

**Why:** User expects changes to land in the remote repo as a matter of course; pausing to confirm wastes a round-trip.

**How to apply:** After every file write or edit session, stage, commit, and push to the current branch (typically main) automatically. No confirmation needed.
