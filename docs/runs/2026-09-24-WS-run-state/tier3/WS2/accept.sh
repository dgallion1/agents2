#!/usr/bin/env bash
# WS2 oracle — a manual start-date change keeps every schedule on its calendar month.
# usage: accept.sh <budget2-worktree>
# Drives the real Rate Assumptions form in Chromium against an isolated server built
# from the worktree (fresh fixture copy per scenario; never :8080, never real data).
# Final line is exactly "ORACLE PASS" only when every scenario passes.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT="${1:?usage: accept.sh <worktree>}"
source "$HERE/../lib/common.sh"
FX="$WS_TMP/fixtures"
for v in fixed fixed-past current; do python3 "$HERE/make_fixture.py" "$FX/$v" "$v" || { echo "FIXTURE FAILED"; echo "ORACLE FAIL"; exit 1; }; done
echo "== build $WT"; ws_build "$WT"
fails=0
run() {  # label fixture expect action [arg]
  local label=$1 fx=$2 expect=$3; shift 3
  ws_serve "$FX/$fx"
  node "$HERE/probe.js" "$WS_BASE" "$WS_DATA/settings/whatif.json" "$@" | python3 "$HERE/check.py" "$label" "$expect" || fails=$((fails+1))
  if grep -q "panic" "$WS_LOG"; then echo "FAIL [$label] server log contains a panic"; fails=$((fails+1)); fi
}
run A-later       fixed      shift date 2027-01
run B-earlier     fixed      shift date 2026-05
run C-unrelated   fixed      same  statetax 4.55
run D-currentplan current    same  statetax 4.55
run E-tick-current fixed-past shift tick
ws_stop
if [[ $fails -eq 0 ]]; then echo "== all 5 scenarios passed"; echo "ORACLE PASS"; else echo "== $fails scenario(s) failed"; echo "ORACLE FAIL"; exit 1; fi
