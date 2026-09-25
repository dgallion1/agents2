#!/usr/bin/env bash
# WS5 oracle — glide path (D6) and person rows (D7), real Chromium, isolated
# server (never :8080, never real data). Final line is exactly "ORACLE PASS"
# only when every check passes. Run under nice (see memory throttle rule).
# v3 (2026-09-24h): P3f — failing person identified from the submitted row.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT="${1:?usage: accept.sh <worktree>}"
source "$HERE/../lib/common.sh"
python3 "$HERE/make_fixture.py" "$WS_TMP/fx" || { echo "FIXTURE FAILED"; echo "ORACLE FAIL"; exit 1; }
echo "== build $WT"; ws_build "$WT"
ws_serve "$WS_TMP/fx"
node "$HERE/probe.js" "$WS_BASE" "$WS_DATA/settings/whatif.json"; rc=$?
if grep -q "panic" "$WS_LOG"; then echo "FAIL server log contains a panic"; rc=1; fi
ws_stop
if [[ $rc -eq 0 ]]; then echo "ORACLE PASS"; else echo "ORACLE FAIL"; exit 1; fi
