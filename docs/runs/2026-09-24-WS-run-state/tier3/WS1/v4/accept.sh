#!/usr/bin/env bash
# WS1 oracle — untouched inputs never rewrite or block the saved plan.
# usage: accept.sh <budget2-worktree>
# Real Chromium against an isolated server built from the worktree, on an
# off-grid fixture (never :8080, never real data). Final line is exactly
# "ORACLE PASS" only when every check holds.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT="${1:?usage: accept.sh <worktree>}"
MIN_FORMS=18   # stored-value forms/selects on the v3 fixture at 643fa54 (3 healthcare persons, glide path on; inventory 2026-09-23)
source "$HERE/../lib/common.sh"
python3 "$HERE/make_fixture.py" "$WS_TMP/fx" || { echo "FIXTURE FAILED"; echo "ORACLE FAIL"; exit 1; }
echo "== build $WT"; ws_build "$WT"
ws_serve "$WS_TMP/fx"
node "$HERE/probe.js" "$WS_BASE" "$WS_DATA/settings/whatif.json" > "$WS_TMP/probe.json"
python3 "$HERE/check.py" "$MIN_FORMS" < "$WS_TMP/probe.json"; rc=$?
if grep -q "panic" "$WS_LOG"; then echo "FAIL server log contains a panic"; rc=1; fi
ws_stop
if [[ $rc -eq 0 ]]; then echo "ORACLE PASS"; else echo "ORACLE FAIL"; exit 1; fi
