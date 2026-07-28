---
name: splitting-an-oversized-memory
description: 'How to split an oversized memory file without losing content: move bytes verbatim by script, keep the original NAME as the hub, and verify with a blank-line-INCLUSIVE diff against git — two consecutive splits each shipped a defect their own net was blind to.'
metadata:
  node_type: memory
  type: feedback
  originSessionId: c09ed410-3ad2-44be-9942-c29fb034a441
  modified: 2026-07-28T07:55:32.837Z
---

**When splitting an oversized memory file, move bytes VERBATIM by script and verify each shipped
file against its own source ranges INCLUDING blank lines, taken from git — not from a backup, and
not with a check you designed around what you remember writing.**

**Why:** two consecutive splits each shipped a defect its own net could not see.

- The 2026-07-27 split (`d6a23f1`) verified with a 34-marker sweep of markers chosen from memory,
  so it could only find losses already remembered. It dropped a sentence.
- The 2026-07-28 split of `project-overview.md` (242 KB → 15 files) used a line-multiset diff, which
  is immune to that — but it compared **non-blank** lines. `m2-multi-cycle.md` was the one file built
  from two non-contiguous ranges, and the blank line that had separated them belonged to a third
  file. Two paragraphs merged into one. Valid markdown, so `format:check` passed; no line lost, so
  the multiset passed. Only a blank-line-inclusive diff finds it.

**How to apply:**

- **Check for a mirror first.** `docs/memory/` is a **junction** to the live memory dir, and it is
  git-tracked — so the pristine original is always available as `git show <rev>:docs/memory/<f>`, and
  every memory edit is a repo change subject to `format:check`. Prettier re-quotes YAML frontmatter
  (`'…'` → `"…"` when the string holds an apostrophe) but leaves bodies alone.
- **Keep the original filename as the hub.** Inbound `[[links]]` and the MEMORY.md line stay valid
  for free; move the bodies out and leave the intro plus an index. Sweep for inbound links first.
- **Also sweep the MOVED bodies for OUTBOUND links.** Inside a monolith, `[[self]]` meant "elsewhere
  in this file"; in a split file it points at a hub that no longer holds the thing.
- **Fix `description` while you are there — it is the whole point.** `project-overview.md` had
  `name: ''` and NO description, so the field recall matches on was empty: 242 KB reachable only
  through its MEMORY.md line. Use the proven single-quoted one-line form, not YAML folded (`>-`),
  in case whatever parses these is a regex rather than a YAML parser.
- **Give every split file a heading that names its own milestone.** Two files here began mid-log
  because the parent `##` header went to the sibling.
- **Keep MEMORY.md terse — one line per child.** It is loaded every session; the split exists to make
  recall CHEAPER, so four-line entries duplicating each sibling's `description` defeat it. Budget
  ~65 B per new memory ([[workflow-rituals]]).
- Working ceiling ~20–25 KB per memory. Split on milestone boundaries; engine-half / web-half when a
  milestone exceeds it.
