#!/usr/bin/env node
// dashboard/server.mjs — zero-dependency, read-only HTTP + SSE glue.
//
// Reads SWARM_DIR (never writes to it), builds a state object via
// `parse.mjs`, renders it via `render.mjs`, and pushes a live-reload signal
// over Server-Sent Events whenever a file under SWARM_DIR changes. See
// SPEC.md §1 (architecture), §5 (dash-server acceptance) and §6 (out of
// scope — no gate-action endpoints, no write path).
//
// Dependencies: node:http, node:fs, node:path, node:url only. No npm
// installs (cost discipline, CLAUDE.md).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { parse } from './lib/parse.mjs';
import { render } from './lib/render.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

const swarmDirArg = process.argv[2] || process.env.SWARM_DIR || '.swarm';
const SWARM_DIR = path.resolve(process.cwd(), swarmDirArg);

const PORT = Number.parseInt(process.env.PORT, 10) || 8787;
const HOST = '127.0.0.1';

// ---------------------------------------------------------------------------
// client.js — the single same-origin script the served page loads
// ---------------------------------------------------------------------------

const CLIENT_JS = `// dashboard client — reconnects an SSE stream and swaps in fresh <main>
// content on reload events. No location.reload(); preserves scroll position
// and focus by stable task/control identity (ACCESSIBILITY.md A-4, A-10, A-11).
(function () {
  'use strict';

  function setLiveStatus(text) {
    var el = document.getElementById('live-status');
    if (el) el.textContent = text;
  }

  // Build a stable selector for the focused control so we can restore it after
  // main.innerHTML replacement. Prefer id, then task-link href, then
  // role+aria-label (evidence regions / table scrollers).
  function focusKey(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    if (el.id) return { type: 'id', value: el.id };
    if (el.classList && el.classList.contains('task-link') && el.getAttribute('href')) {
      return { type: 'task-href', value: el.getAttribute('href') };
    }
    if (el.getAttribute && el.getAttribute('href') && el.tagName === 'A') {
      return { type: 'href', value: el.getAttribute('href') };
    }
    var role = el.getAttribute && el.getAttribute('role');
    var label = el.getAttribute && el.getAttribute('aria-label');
    if (role && label) return { type: 'role-label', role: role, label: label };
    if (el.name) return { type: 'name', value: el.name };
    return null;
  }

  function findByFocusKey(key) {
    if (!key) return null;
    if (key.type === 'id') return document.getElementById(key.value);
    var nodes, i, el;
    if (key.type === 'task-href') {
      nodes = document.querySelectorAll('a.task-link');
      for (i = 0; i < nodes.length; i++) {
        if (nodes[i].getAttribute('href') === key.value) return nodes[i];
      }
      return null;
    }
    if (key.type === 'href') {
      nodes = document.querySelectorAll('a[href]');
      for (i = 0; i < nodes.length; i++) {
        if (nodes[i].getAttribute('href') === key.value) return nodes[i];
      }
      return null;
    }
    if (key.type === 'role-label') {
      nodes = document.querySelectorAll('[role][aria-label]');
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        if (el.getAttribute('role') === key.role && el.getAttribute('aria-label') === key.label) {
          return el;
        }
      }
      return null;
    }
    if (key.type === 'name') {
      nodes = document.getElementsByName(key.value);
      return nodes.length ? nodes[0] : null;
    }
    return null;
  }

  function snapshotScrollRegions(root) {
    var regions = [];
    if (!root) return regions;
    var nodes = root.querySelectorAll('[role="region"][tabindex], .table-scroll');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el.scrollLeft && !el.scrollTop) continue;
      regions.push({
        key: focusKey(el),
        left: el.scrollLeft,
        top: el.scrollTop,
      });
    }
    return regions;
  }

  function restoreScrollRegions(regions) {
    for (var i = 0; i < regions.length; i++) {
      var r = regions[i];
      var el = findByFocusKey(r.key);
      if (el) {
        el.scrollLeft = r.left;
        el.scrollTop = r.top;
      }
    }
  }

  function applyUpdate(html) {
    try {
      var parser = new DOMParser();
      var doc = parser.parseFromString(html, 'text/html');
      var newMain = doc.querySelector('main');
      var curMain = document.querySelector('main');
      if (newMain && curMain) {
        var active = document.activeElement;
        var key = curMain.contains(active) ? focusKey(active) : null;
        var pageScrollY = window.scrollY || window.pageYOffset || 0;
        var pageScrollX = window.scrollX || window.pageXOffset || 0;
        var regionScrolls = snapshotScrollRegions(curMain);

        curMain.innerHTML = newMain.innerHTML;

        window.scrollTo(pageScrollX, pageScrollY);
        restoreScrollRegions(regionScrolls);

        if (key) {
          var next = findByFocusKey(key);
          if (next && typeof next.focus === 'function') {
            try {
              next.focus({ preventScroll: true });
            } catch (focusErr) {
              next.focus();
            }
          }
        }
      }
      setLiveStatus('updated');
    } catch (err) {
      setLiveStatus('update failed');
    }
  }

  function refresh() {
    fetch(location.href, { credentials: 'same-origin' })
      .then(function (res) { return res.text(); })
      .then(applyUpdate)
      .catch(function () { setLiveStatus('update failed'); });
  }

  function connect() {
    var source = new EventSource('/events');
    source.addEventListener('reload', function () {
      refresh();
    });
    source.onerror = function () {
      // EventSource retries automatically; nothing to do here.
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect);
  } else {
    connect();
  }
})();
`;

// ---------------------------------------------------------------------------
// SSE client registry
// ---------------------------------------------------------------------------

const sseClients = new Set();
const HEARTBEAT_MS = 25000;

function sendSSE(res, eventName, data) {
  if (eventName) res.write(`event: ${eventName}\n`);
  res.write(`data: ${data}\n\n`);
}

function broadcastReload() {
  for (const res of sseClients) {
    try {
      sendSSE(res, 'reload', '{}');
    } catch {
      // client presumably gone; the close handler will clean it up.
    }
  }
}

const heartbeatTimer = setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      // ignore; close handler cleans up
    }
  }
}, HEARTBEAT_MS);
heartbeatTimer.unref?.();

// ---------------------------------------------------------------------------
// file watching (read-only: we only observe, never write into SWARM_DIR)
// ---------------------------------------------------------------------------

let debounceTimer = null;
function scheduleReloadBroadcast() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    broadcastReload();
  }, 150);
}

function startWatching() {
  try {
    const watcher = fs.watch(SWARM_DIR, { recursive: true }, () => {
      scheduleReloadBroadcast();
    });
    watcher.on('error', (err) => {
      // Non-fatal: log and keep serving; the dashboard still works, just
      // without live-reload until the directory is watchable again.
      console.error(`[dashboard] fs.watch error on ${SWARM_DIR}:`, err.message);
    });
  } catch (err) {
    console.error(`[dashboard] could not watch ${SWARM_DIR}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// tiny text-escaping helper for the plain-text 500 body (never HTML, so no
// need for HTML entity escaping — but we do strip the response to a single
// safe line, never a raw stack trace).
// ---------------------------------------------------------------------------

function safeErrorMessage(err) {
  const message = err && err.message ? String(err.message) : String(err);
  // Collapse to a single line; drop anything past the first newline (that's
  // where stack traces live) so we never leak internals into the response.
  return message.split('\n')[0];
}

// ---------------------------------------------------------------------------
// route handlers
// ---------------------------------------------------------------------------

function handleIndex(req, res, query) {
  let html;
  try {
    const state = parse(SWARM_DIR);
    state.runName = path.basename(SWARM_DIR);
    state.openTask = query.get('task') || null;
    html = render(state);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Internal error rendering dashboard: ${safeErrorMessage(err)}\n`);
    return;
  }

  const injected = html.includes('</body>')
    ? html.replace(/<\/body>(?![\s\S]*<\/body>)/, '<script src="/client.js"></script></body>')
    : html;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(injected);
}

function handleClientJs(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
  res.end(CLIENT_JS);
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  sseClients.add(res);

  const cleanup = () => {
    sseClients.delete(res);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

function handleNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found\n');
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    res.end('method not allowed\n');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (url.pathname === '/') {
    handleIndex(req, res, url.searchParams);
    return;
  }
  if (url.pathname === '/client.js') {
    handleClientJs(req, res);
    return;
  }
  if (url.pathname === '/events') {
    handleEvents(req, res);
    return;
  }
  handleNotFound(res);
});

server.listen(PORT, HOST, () => {
  console.log(`[dashboard] serving ${SWARM_DIR} (read-only) at http://${HOST}:${PORT}/`);
  startWatching();
});

function shutdown() {
  clearInterval(heartbeatTimer);
  for (const res of sseClients) {
    try {
      res.end();
    } catch {
      // ignore
    }
  }
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
