#!/usr/bin/env bash
# Shared oracle harness for the WS run. Source it; never run directly.
#   ws_build <worktree>            -> builds the worktree's server into $WS_TMP/budget2
#   ws_serve <fixture-data-dir>    -> copies the fixture (cp -rL) to $WS_TMP/data-N,
#                                     starts the built server on a free 127.0.0.1 port,
#                                     waits for /api/health, exports WS_BASE and WS_DATA
#   ws_stop                        -> stops the current server
# Never touches :8080 or the real data directory: every server gets its own
# BUDGET_DATA_DIR / BUDGET2_BACKUP_DIR / BUDGET2_IMPORT_DIR under $WS_TMP.
export NODE_PATH="${NODE_PATH:-/home/darrell/.npm/_npx/e41f203b7505f1fb/node_modules}"
WS_TMP="$(mktemp -d -t ws-oracle.XXXXXX)"
WS_PID=""
WS_N=0
trap 'ws_stop; rm -rf "$WS_TMP"' EXIT

ws_build() {
  ( cd "$1" && go build -o "$WS_TMP/budget2" ./cmd/server ) || { echo "BUILD FAILED"; echo "ORACLE FAIL"; exit 1; }
}

ws_serve() {
  ws_stop
  WS_N=$((WS_N+1))
  local d="$WS_TMP/run-$WS_N"
  mkdir -p "$d/backups" "$d/import"
  cp -rL "$1" "$d/data"
  local port
  port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')"
  [[ "$port" != 8080 ]] || { echo "refusing port 8080"; exit 1; }
  BUDGET_DEBUG=false BUDGET_LISTEN_ADDR="127.0.0.1:$port" BUDGET_DATA_DIR="$d/data" \
    BUDGET2_BACKUP_DIR="$d/backups" BUDGET2_IMPORT_DIR="$d/import" \
    "$WS_TMP/budget2" > "$d/server.log" 2>&1 &
  WS_PID=$!
  export WS_BASE="http://127.0.0.1:$port" WS_DATA="$d/data" WS_LOG="$d/server.log"
  for _ in $(seq 1 100); do
    curl -s -m 1 "$WS_BASE/api/health" >/dev/null 2>&1 && return 0
    sleep 0.1
  done
  echo "SERVER DID NOT START"; tail -20 "$d/server.log"; echo "ORACLE FAIL"; exit 1
}

ws_stop() {
  if [[ -n "$WS_PID" ]]; then kill "$WS_PID" 2>/dev/null; wait "$WS_PID" 2>/dev/null; WS_PID=""; fi
}
