// CPU Visualizer — find an already-running dev server for THIS project.
//
// Prints that server's URL on stdout, or prints nothing at all. "Start CPU Visualizer.bat"
// reuses the URL if it gets one and starts a fresh server if it doesn't.
//
// Why this exists: vite treats 5173 as its PREFERRED port, not a reserved one. When the port
// is busy it does not fail — it quietly climbs to 5174, 5175, ... So without this, every
// double-click of the launcher left another server running forever; sixteen stacked across
// 5173–5190 is an observed outcome, not a hypothetical, each one holding a live render loop
// open in any tab still pointed at it.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: a port number never tells you *whose* server it is.
// Checking "is something listening on 5173?" is the same bug in a different costume — several
// vite projects climb past each other, so 5173 is very often a DIFFERENT app, and reusing it
// would open the wrong project. The only sound question is what a server is SERVING. So: ask
// it for its page and match the <title>. Reuse only on a match.
//
// Dependency-free BY CONTRACT — the launcher runs this before its `node_modules` check, so it
// must work on a machine where nothing is installed. Node builtins and `fetch` only; nothing
// from node_modules, ever.

import { pathToFileURL } from 'node:url';

/**
 * The string that identifies this app's dev server.
 *
 * LOAD-BEARING, AND THE COUPLING IS INVISIBLE TO THE COMPILER: this must stay in sync with
 * <title> in packages/web/index.html, which carries a matching comment pointing back here.
 * If the two ever drift apart, this detector finds nothing, the launcher silently returns to
 * starting a new server on every double-click, and nothing reports an error — the failure
 * looks exactly like "no server was running."
 */
const APP_TITLE = 'CPU Visualizer';

/**
 * Vite's preferred port, plus the ports it climbs to when earlier ones are taken. The
 * observed stack reached 5190, so scan that far — a detector that stopped short would miss
 * our own server at the top of the range and stack yet another one behind it.
 */
const PORT_MIN = 5173;
const PORT_MAX = 5190;

/**
 * Must be `localhost` — NOT `127.0.0.1`.
 *
 * VERIFIED here on Windows, against a real `npm run dev`: vite with no `server.host` binds
 * ONLY `::1` (IPv6). Fetching `127.0.0.1` on that server is ECONNREFUSED, so an
 * IPv4-hardcoded detector would find nothing, print nothing, and stack a second server
 * silently — precisely the failure this script exists to prevent, and it would look like
 * working code. Node resolves `localhost` to both families and tries each, so it matches a
 * server bound to either. It is also the exact host vite prints, so the URL handed back is
 * the one the user would have opened anyway.
 */
const HOST = 'localhost';

/** Generous for a loopback request, short enough that a full scan stays imperceptible. */
const TIMEOUT_MS = 1500;

/**
 * @param {number} port
 * @returns {Promise<string | null>} the URL if THIS app is served there, otherwise null
 */
async function probe(port) {
  const url = `http://${HOST}:${port}/`;

  // Own the timer instead of using AbortSignal.timeout(). On Windows/libuv, a fleet of armed
  // timers that outlive the answer makes the process die on exit with
  //   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c
  // and exit code 127 rather than exiting. clearTimeout() in `finally` disarms every one, so
  // the event loop drains and node exits on its own — which is also why nothing here calls
  // process.exit().
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const title = (await res.text()).match(/<title>([^<]*)<\/title>/i);
    return title && title[1].trim() === APP_TITLE ? url : null;
  } catch {
    // Nothing listening, not speaking HTTP, or too slow to answer. Every one of those means
    // "not a server of ours", which is all this function promises to decide.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** @returns {Promise<string | null>} URL of the lowest-numbered port serving this app. */
export async function findRunningDevServer() {
  const ports = Array.from({ length: PORT_MAX - PORT_MIN + 1 }, (_, i) => PORT_MIN + i);
  const results = await Promise.all(ports.map(probe));
  return results.find((url) => url !== null) ?? null;
}

// Identify the CLI case explicitly. `import.meta.main` would be the obvious way and is WRONG
// here: it only exists on node 24.2+, and on anything older it is silently `undefined` — so
// this block would never run, the launcher would read an empty string, and it would go right
// back to stacking with no sign anything had broken. This comparison works on every node the
// project supports (package.json engines: >=20).
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  try {
    const url = await findRunningDevServer();
    // stdout discipline: the .bat reads stdout straight into a variable, so the URL and
    // NOTHING else may go here. No server found is a normal outcome, not an error — print
    // nothing and exit 0; the launcher reads that as "start a fresh one".
    if (url) process.stdout.write(`${url}\n`);
  } catch (err) {
    // A detector failure must never block the launcher: printing nothing makes it start a
    // server, which is the safe default. Report on stderr and let the run continue.
    process.stderr.write(`find-dev-server: ${err instanceof Error ? err.message : err}\n`);
    process.exitCode = 1;
  }
}
