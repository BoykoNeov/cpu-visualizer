---
name: browser-rig-chrome-cleanup
description: "Killing a CPU Visualizer browser rig safely: `taskkill //IM chrome.exe` closed the USER'S own Chrome twice, `chrome.kill()` does not kill the browser (21 then 66 leftovers survived and the next run inherited the previous page's state), so kill the tree by PID and sweep by --user-data-dir path, never by image name or port."
metadata:
  node_type: memory
  type: project
  originSessionId: 573123f6-87e0-4ded-b6e3-f2357201c7ae
  modified: 2026-07-28T07:19:39.508Z
---

Teardown rules for the CDP browser rigs described in [[browser-is-the-only-net]] and
[[browser-rig-cdp-recipe]]. These are safety-critical: two of them are recorded here **because this
memory used to recommend the opposite**, and the wrong version damaged the user's session.

- **NEVER `taskkill //F //IM chrome.exe //T`.** This memory used to recommend it. It force-kills
  the USER'S OWN browser and every tab they had open — measured on 2026-07-17, when it closed their
  real Chrome twice mid-session. The driver spawns its own headless Chrome, so kill only that.
- **`chrome.kill()` DOES NOT KILL THE BROWSER — this memory used to say it was enough, and that is
  measured wrong** (M5 step 5, 2026-07-17). It kills the launcher process; Chrome's children survive,
  hold the debug port, and keep the page alive. Count after a few runs: **21 live chrome.exe**. The
  next run then attached to the PREVIOUS run's page and inherited its state — the editor was already
  open, so the script's "click to open" TOGGLED IT CLOSED and reported `no textarea`, which reads
  exactly like a product defect. Kill the **tree, by PID**: `taskkill /PID <chrome.pid> /T /F`. To
  sweep leftovers safely, filter on your own profile path and never on the image name:
  `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where CommandLine -like '*<your-tmp-prefix>*'`.
  Corollary: **make every driver step idempotent** (open, don't toggle) so inherited state cannot
  invert an action.

**Sweeping leftover Chromes, the exact recipe** (2026-07-27 — the "21 leftovers" note above happened
again at **66**, so this is not a one-off): after a session of rig runs,
`Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like
'*<your-profile-prefix>*' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F }`. Match on the
**profile path you passed to `--user-data-dir`**, never on the image name. The same shape kills a
dev server you started — filter `node.exe` on a `CommandLine` containing both the project path and
`vite`, which distinguishes it from the user's other vite projects where a port never could.

Kill the preview server **by PID read from its command line**, never by port
([[never-kill-dev-servers-by-port]]), and pass `--port N --strictPort` so it cannot silently climb
onto someone else's number.
