---
name: browser-rig-chrome-cleanup
description: "Killing a CPU Visualizer browser rig safely, and the sweep script that does it: `taskkill //IM chrome.exe` closed the USER'S own Chrome twice, `chrome.kill()` does not kill the browser (21 then 66 leftovers), and a teardown that lives only in a `finally` leaked 13 previews + 91 Chromes + 7GB of profiles. Match by COMMAND LINE, kill each PID, then RE-RUN THE SAME PREDICATE AND COUNT - a cleanup you did not re-count is a claim, not a result. Sweep at the START of a pass. Run M:\\claud_projects\\temp\\rig-sweep.ps1."
metadata:
  node_type: memory
  type: project
  originSessionId: 573123f6-87e0-4ded-b6e3-f2357201c7ae
  modified: 2026-08-09T17:35:37.430Z
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

## The missing half: RE-RUN THE PREDICATE AND COUNT (2026-07-30)

Everything above was right and still leaked **13 preview trees, 91 Chrome processes, 2.6 GB of
AppData profiles and ~4.6 GB of profiles inside the temp tree** — found only because the user asked
"you sure these are yours?". The rule this memory was missing is the verification, not the kill:

**A CLEANUP YOU DID NOT RE-COUNT IS A CLAIM, NOT A RESULT.** The session that leaked all of the
above reported "49 rig Chromes swept, 0 remained" — a number never measured. State the count only
after re-running the **same predicate** that selected the kills. Four counts close it: rig chrome,
preview processes, listening 4xxx ports, and profile dirs on disk. Print the user's total
`chrome.exe` too and require it **> 0** — it is the guard that the sweep did not hit their browser.

⚠ **ONE SWEEP PASS IS NOT ENOUGH, AND THE VERIFY BLOCK IS WHAT TELLS YOU** (2026-08-09, the
predictor's step-7 pass — 6 rig runs in one session). Pass 1: 7 previews and 49 Chromes matched,
and the verify re-count still reported **22 rig Chromes and 7 profile dirs remaining**. Pass 2 took
it to 0 Chromes / 4 dirs. Pass 3 reported clean. Nothing was wrong with the predicate — a Chrome
tree kill races the children still spawning, and a profile directory cannot be deleted while any
process still holds it, so the dirs trail the processes by one pass. **The script's INCOMPLETE
verdict is an instruction to run it again, not a failure to debug: re-run until it prints `clean`,
and quote the run that did.** This is the same rule as the file's headline one level up — a cleanup you did not
re-count is a claim, and a re-count you did not act on is worse, because you have the number and
filed it anyway.

**Use `M:\claud_projects\temp\rig-sweep.ps1`** (self-tested by seeding a deliberate leak, then
confirming 1→0 / 10→0 / ports 1→0 while the user's 40 Chromes survived; the `-DryRun` pass proves
it finds them and changes nothing). Its own first self-test caught a bug worth naming: **the verify
block re-ran a NARROWER predicate than the sweep** and printed `0` over a directory it never looked
at. One predicate, one function, both callers.

**Sweep at the START of a pass, not only at the end.** End-of-pass teardown is exactly what fails
when the rig dies badly, which is the failure mode. A start-of-pass sweep is self-healing: today's
13 orphans would have died at 11:03 instead of surviving four hours.

**Put rig profiles under `M:\claud_projects\temp\rig-chrome\`, not `os.tmpdir()`.** This is the
standing global temp rule, and it also makes the predicate **unfalsifiable rather than heuristic** —
"any `chrome.exe` whose `--user-data-dir` is under the temp root" cannot match the user's real
Chromes under any future naming — and it turns an invisible AppData leak into a visible one in the
directory the user already inspects. `mkdtempSync(join(tmpdir(), ...))` is the line to change.

**Why the leak happened, both causes Windows-specific:**

- **A teardown that lives only in a `finally` does not run.** The rig had
  `finally { chrome.kill(); preview.proc.kill(); }` and leaked anyway — the preview and its profile
  share a creation timestamp to the second, thirteen times over, so the block never fired. It cannot
  survive an external kill of the node script, and `attach()` can **throw after spawning Chrome but
  before returning a handle**, at which point no `finally` anywhere can reach the process. Process
  handlers (`exit`/`SIGINT`/`uncaughtException`) narrow this but do not close it. **The sweep script
  is the fix; teardown is the optimization.**
- **`child.kill()` does not kill a tree on Windows.** `spawn('npm', …, { shell: true })` yields a
  chain `npm → cmd.exe → node vite.js`; the signal reaches one link and the rest hold the port.

**Do NOT generalise this to "always `taskkill /T`."** A tree kill walks **live** parent links, so it
is least reliable in exactly the orphan case being fixed — here the ancestry walk landed on
**recycled PIDs**, which is itself the proof the real parents were gone. What worked: match every
link of the chain **on its command line** (`run preview --workspace`, `cmd.exe … vite preview`,
`vite.js preview`), kill each matched PID individually, re-count.

**The preview predicate is the weaker one, knowingly.** A random 4300–4600 port with `--strictPort`
is how every rig here launches and a hand-run preview is 4173 — a convention, not a guarantee. So
the script **prints pid / port / age / served `<title>` before killing** and stays eyeballable;
`<title>` is the identification rule from [[never-kill-dev-servers-by-port]]. Pass `-KeepPort N` to
spare the pass in flight.

⚠ **Keep `rig-sweep.ps1` pure ASCII.** Windows PowerShell 5.1 reads a BOM-less `.ps1` as ANSI, so an
em-dash becomes `Missing closing '}'`. Same hazard as the `Set-Content` mojibake in
[[m13-width-planned]].
