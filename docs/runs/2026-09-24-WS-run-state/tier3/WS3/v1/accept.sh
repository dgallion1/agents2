#!/usr/bin/env bash
# WS3 oracle — a chain step never crashes the projection; a failed analysis never bricks the page.
# usage: accept.sh <budget2-worktree>
# Isolated server per variant built from the worktree (never :8080, never real data).
# Final line is exactly "ORACLE PASS" only when every variant passes.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT="${1:?usage: accept.sh <worktree>}"
source "$HERE/../lib/common.sh"
echo "== build $WT"; ws_build "$WT"
fails=0
for v in a-to-b b-to-a missing; do
  python3 "$HERE/make_fixture.py" "$WS_TMP/fx-$v" "$v" || { echo "FIXTURE FAILED"; echo "ORACLE FAIL"; exit 1; }
  ws_serve "$WS_TMP/fx-$v"
  python3 "$HERE/probe.py" "$WS_BASE" "$v" | python3 "$HERE/check.py" || fails=$((fails+1))
  if grep -q "panic" "$WS_LOG"; then echo "FAIL [$v] server log contains a panic"; grep -m3 panic "$WS_LOG"; fails=$((fails+1)); fi
done
ws_stop
if [[ $fails -eq 0 ]]; then echo "== all 3 variants passed"; echo "ORACLE PASS"; else echo "== $fails failure(s)"; echo "ORACLE FAIL"; exit 1; fi
