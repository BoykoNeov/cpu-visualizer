---
name: never-kill-dev-servers-by-port
description: The user runs several vite projects that stack on 5173+; never kill node-by-port — identify a server by its served <title> first.
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9cbba965-141a-4163-92a2-8f7e527ea664
---

The user runs **several vite projects at once**, and vite climbs ports when 5173 is
busy, so **a port number never tells you whose server it is**. Observed live on
2026-07-17 while fixing the launcher: `5173 → 'Black Hole Lab'`, `5174 → 'CPU
Visualizer'`, `5175 → 'Storm Diorama'` — a _foreign_ project held the lower port while
ours sat above it.

Never kill, reuse, or open a dev server selected by port alone. Identify it first by
what it **serves**: `fetch` the port and read `<title>` from the HTML.

**Why:** A previous session killed **19 servers** filtering only on "is it node on that
port" and destroyed live work in the user's other projects. The user's rule: "A port in
that range is far more likely another project of mine that I am actively using than a
stray of yours." The same mistake in a gentler costume — _opening_ 5173 assuming it's
ours — silently launches the wrong app.

**How to apply:** Before touching anything on 5173–5190, fetch it and check the title.
When cleanup seems warranted, **do not decide** — show the user the list (pid, port, and
which project each serves) and let them choose. Only ever kill a server you started
yourself in this session, and verify by command line (`CommandLine -like '*<project>*'`)
before doing it. Note `TaskStop` on an `npm run dev` task kills the npm wrapper but
**orphans the vite process**, which keeps holding the port — kill the vite pid directly.

Two Windows facts found the same day, both of which fail _silently_: vite here binds
**only `::1`**, so probing `127.0.0.1` is ECONNREFUSED; and `.bat` files must be **CRLF**
(cmd.exe mis-parses `for /f` and `if (...)` blocks under LF). Details live in
`tools/find-dev-server.mjs` and `.gitattributes`.

See [[browser-is-the-only-net]] for how to drive the real app here.
