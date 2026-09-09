#!/usr/bin/env bash
# GV2 oracle — engine emits exact guardrail thresholds; chart renders them.
# Usage: accept.sh <budget2-worktree-root>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=${1:?budget2 worktree root required}
cd "$root"
GO=$(command -v go || true)
[[ -n "$GO" ]] || { echo 'ORACLE FAIL: go not on PATH'; exit 1; }
if ! grep -q 'GuardrailCutTrigger' internal/models/whatif.go; then
  echo 'ORACLE FAIL: guardrail threshold fields absent from models.ProjectionYearSummary (capability missing)'
  exit 1
fi
overlay=$(mktemp)
trap 'rm -f "$overlay"' EXIT
python3 - "$root" "$here" "$overlay" <<'PY'
import json,sys
root,here,out=sys.argv[1:]
json.dump({'Replace':{root+'/internal/handlers/whatif/gv2_acceptance_external_test.go':here+'/oracle_test.go'}},open(out,'w'))
PY
echo '== criterion 1: build, vet, every consumer package green'
"$GO" build ./...
"$GO" vet ./internal/models/ ./internal/services/retirement/... ./internal/services/mcpsvc/... ./internal/handlers/whatif/
"$GO" test -count=1 -timeout=900s ./internal/models/ ./internal/services/... ./internal/handlers/...
echo '== criteria 2+3: oracle tests (overlay-injected)'
"$GO" test -count=1 -timeout=600s -overlay "$overlay" ./internal/handlers/whatif/ -run '^TestGV2Oracle' -v
echo '== GM-run marker contract still holds'
"$GO" test -count=1 -timeout=600s ./internal/handlers/whatif/ -run 'Guardrail|Projection'
echo 'ORACLE PASS'
