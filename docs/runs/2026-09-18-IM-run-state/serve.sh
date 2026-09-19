#!/usr/bin/env bash
# Throwaway budget2 instance for IM2 checks.
# usage: serve.sh <worktree> [port] [full|preupload]   (foreground; Ctrl-C / kill to stop)
# data variant: full (default) = ../IM1/fixture; preupload = ./data-preupload (the three 2026-09-18 exports absent)
# - builds the worktree's server into a temp file
# - data dir  = fresh copy of ../IM1/fixture (frozen 2026-09-18 live data)
# - import dir = fresh copy of ./import (the seven browser-named exports)
# - backups    = temp dir; listens on 127.0.0.1:<port> (default: free port)
# Never touches the live :8080 server or the real data directory.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT="${1:?usage: serve.sh <worktree-path> [port]}"
PORT="${2:-}"
VARIANT="${3:-full}"
TMP="$(mktemp -d -t im2-serve.XXXXXX)"
BIN="$TMP/budget2"
( cd "$WT" && go build -o "$BIN" ./cmd/server ) || { echo "BUILD FAILED"; exit 1; }
if [[ "$VARIANT" == preupload ]]; then cp -a "$HERE/data-preupload" "$TMP/data"; else cp -a "$HERE/../IM1/fixture" "$TMP/data"; fi
cp -a "$HERE/import" "$TMP/import"
mkdir -p "$TMP/backups"
if [[ -z "$PORT" ]]; then PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')"; fi
echo "IM2 throwaway instance: http://127.0.0.1:$PORT  (data=$TMP/data import=$TMP/import)"
echo "file manager: http://127.0.0.1:$PORT/filemanager   accounts: http://127.0.0.1:$PORT/accounts"
trap 'rm -rf "$TMP"' EXIT
cd "$WT" && BUDGET_LISTEN_ADDR="127.0.0.1:$PORT" BUDGET_DATA_DIR="$TMP/data" BUDGET2_BACKUP_DIR="$TMP/backups" BUDGET2_IMPORT_DIR="$TMP/import" exec "$BIN"
