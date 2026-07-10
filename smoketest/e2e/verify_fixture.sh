#!/usr/bin/env bash
set -u
d="$(dirname "$0")"; FAILN=0
f(){ if [[ -e "$d/$1" ]]; then echo "ok   - $1"; else echo "FAIL - $1"; FAILN=$((FAILN+1)); fi; }
g(){ if grep -qi "$2" "$d/$1"; then echo "ok   - $1: $3"; else echo "FAIL - $1: $3"; FAILN=$((FAILN+1)); fi; }
f SPEC.md; f ACCESSIBILITY.md; f critical.globs; f RUNBOOK.md
g SPEC.md 'Tier 1' "has a tier 1 task"
g SPEC.md 'Tier 2' "has a tier 2 task"
g SPEC.md 'Tier 3' "has a tier 3 task"
g SPEC.md 'deploy' "tier1 task touches critical glob"
g critical.globs 'deploy' "glob covers deploy path"
(( FAILN==0 )) && { echo "ALL PASS"; exit 0; } || { echo "$FAILN FAILED"; exit 1; }
