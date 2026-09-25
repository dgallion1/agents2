#!/usr/bin/env bash
# WS3 oracle (attempt-3 contract, D3': the viewed scenario's guardrail setting
# governs the whole chain) — a chain never crashes; guardrails follow the viewed
# scenario on every surface (Year-by-Year, chart triggers, summary text); a failed
# analysis never bricks the page (D4).
# usage: accept.sh <budget2-worktree>
# Isolated server per variant built from the worktree (never :8080, never real
# data). Final line is exactly "ORACLE PASS" only when every check passes.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT="${1:?usage: accept.sh <worktree>}"
source "$HERE/../lib/common.sh"
echo "== build $WT"; ws_build "$WT"
panics=0
for v in a-alone a-to-b a-to-y b-to-a missing a2-alone a2-to-y; do
  python3 "$HERE/make_fixture.py" "$WS_TMP/fx-$v" "$v" || { echo "FIXTURE FAILED"; echo "ORACLE FAIL"; exit 1; }
  ws_serve "$WS_TMP/fx-$v"
  python3 "$HERE/probe.py" "$WS_BASE" "$v" > "$WS_TMP/obs-$v.json" || { echo "PROBE FAILED ($v)"; echo "ORACLE FAIL"; exit 1; }
  if grep -q "panic" "$WS_LOG"; then echo "FAIL [$v] server log contains a panic"; grep -m2 panic "$WS_LOG"; panics=$((panics+1)); fi
done
ws_stop
python3 "$HERE/check.py" "$WS_TMP"; rc=$?
if [[ $rc -eq 0 && $panics -eq 0 ]]; then echo "ORACLE PASS"; else echo "ORACLE FAIL"; exit 1; fi
