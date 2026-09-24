#!/usr/bin/env bash
# WS4 oracle — request errors are visible, never wipe input, never leak into the layout.
# usage: accept.sh <budget2-worktree>
# Real Chromium against isolated servers built from the worktree (fresh server per
# scenario; never :8080, never real data). Final line is exactly "ORACLE PASS" only
# when every check in both scenarios passes.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT="${1:?usage: accept.sh <worktree>}"
source "$HERE/../lib/common.sh"
python3 "$HERE/make_fixture.py" "$WS_TMP/fx" || { echo "FIXTURE FAILED"; echo "ORACLE FAIL"; exit 1; }
echo "== build $WT"; ws_build "$WT"
fails=0
for sc in background forms; do
  ws_serve "$WS_TMP/fx"
  node "$HERE/probe.js" "$WS_BASE" "$WS_DATA/settings/whatif.json" "$sc" || fails=$((fails+1))
  if grep -q "panic" "$WS_LOG"; then echo "FAIL [$sc] server log contains a panic"; fails=$((fails+1)); fi
done
ws_stop
if [[ $fails -eq 0 ]]; then echo "== both scenarios passed"; echo "ORACLE PASS"; else echo "== $fails scenario(s) failed"; echo "ORACLE FAIL"; exit 1; fi
