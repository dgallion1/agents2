# Swarm dashboard

A local, read-only web UI for a running boss/worker/checker swarm. It reads
`.swarm/` (or any directory in the same shape) and renders the current state.
It never accepts, rejects, or edits a task — status only ever flows through
verdict files and `swarm/gate.sh`, exactly as `CLAUDE.md` requires.

**This server is read-only.** It opens `SWARM_DIR` only for reading (and for
watching, via `fs.watch`), never for writing. There is no endpoint that
writes into `SWARM_DIR`, and no "accept" button anywhere.

## Run it

```sh
node dashboard/server.mjs [SWARM_DIR]
```

`SWARM_DIR` resolution order:

1. First CLI argument (`process.argv[2]`)
2. `SWARM_DIR` environment variable
3. `.swarm` (default, relative to the current working directory)

Other environment variables:

- `PORT` — port to listen on (default `8787`)

The server binds to `127.0.0.1` only. Example:

```sh
PORT=8799 node dashboard/server.mjs dashboard/fixtures/swarm-demo
# -> http://127.0.0.1:8799/
```

Zero dependencies: only Node's built-in `node:http`, `node:fs`, `node:path`,
and `node:url` modules are used. No `npm install` required.

## Endpoints

- `GET /` and `GET /?task=<id>` — parses `SWARM_DIR` (`lib/parse.mjs`),
  renders the full dashboard HTML (`lib/render.mjs`), and returns it. The
  `task` query parameter opens that task's detail drawer. The page is
  server-rendered and complete on first load (works with JavaScript
  disabled); a single same-origin `<script src="/client.js">` tag is
  injected before `</body>` to enable live-reload. If parsing or rendering
  fails, the server responds `500` with a short, plain-text message — never
  a stack trace rendered into the page.
- `GET /client.js` — a small same-origin script (`text/javascript`) that
  opens an `EventSource` against `/events`. On a `reload` event it re-fetches
  the current URL, parses the returned HTML, and replaces only the `<main>`
  element's contents with the fresh version, then updates the `#live-status`
  live region. It never calls `location.reload()`, so scroll position and
  keyboard focus are preserved across an update (see `ACCESSIBILITY.md`
  A-10, A-11).
- `GET /events` — a Server-Sent Events stream (`text/event-stream`). The
  server watches `SWARM_DIR` recursively with `fs.watch`, debounces changes
  by ~150ms, and broadcasts `event: reload` to every connected client. A
  comment heartbeat is sent roughly every 25s to keep the connection alive
  through proxies.

Any other path returns `404`. There is no static file serving of arbitrary
paths, so path traversal is not possible — the only files the server can
ever serve are the rendered dashboard page and the fixed `client.js` script.

Gate-action endpoints (e.g. `/run/check`, `/run/escalate-scan`) are out of
scope for this build — see `SPEC.md` §6.
