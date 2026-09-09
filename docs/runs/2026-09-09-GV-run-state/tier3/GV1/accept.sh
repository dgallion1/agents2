#!/usr/bin/env bash
# GV1 oracle — optimizer search simulates with the plan's engine hooks.
# Usage: accept.sh <budget2-worktree-root>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=${1:?budget2 worktree root required}
cd "$root"
GO=$(command -v go || true)
[[ -n "$GO" ]] || { echo 'ORACLE FAIL: go not on PATH'; exit 1; }
overlay=$(mktemp)
trap 'rm -f "$overlay"' EXIT
python3 - "$root" "$here" "$overlay" <<'PY'
import json,sys
root,here,out=sys.argv[1:]
json.dump({'Replace':{root+'/internal/handlers/whatif/gv1_acceptance_external_test.go':here+'/oracle_test.go'}},open(out,'w'))
PY
echo '== criterion 1: build, vet, package tests'
"$GO" build ./...
"$GO" vet ./internal/handlers/whatif/
"$GO" test -count=1 -timeout=600s ./internal/handlers/whatif/ ./internal/services/retirement/...
echo '== criteria 2+3: oracle tests (overlay-injected)'
"$GO" test -count=1 -timeout=600s -overlay "$overlay" ./internal/handlers/whatif/ -run '^TestGV1Oracle' -v
echo '== criterion 4: GO-run regressions unchanged'
"$GO" test -count=1 -timeout=600s ./internal/handlers/whatif/ -run 'Guardrail' -v | grep -E '^(--- FAIL|FAIL|ok)' || true
"$GO" test -count=1 -timeout=600s ./internal/handlers/whatif/ -run 'Guardrail'
echo 'ORACLE PASS'
