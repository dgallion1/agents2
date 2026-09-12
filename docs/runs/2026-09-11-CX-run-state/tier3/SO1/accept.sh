#!/usr/bin/env bash
# SO1 oracle: spending-first optimizer branch. Usage: accept.sh [repo-root]
set -u
ROOT="${1:-$(pwd)}"; cd "$ROOT" || exit 1
fails=0
echo "== 1 build/vet"; go build ./... && go vet ./internal/services/retirement/... ./internal/handlers/whatif/... || fails=$((fails+1))
echo "== 2 named financial/lifecycle tests"
out="$(go test ./internal/services/retirement/analysis ./internal/handlers/whatif ./internal/services/retirement ./internal/services/retirement/engine -run 'Spending|LivingSpendingBoost' -count=1 -v 2>&1)"
for tn in TestSpendingIntegrationIncomeOnlyAccounting TestSpendingIntegrationOneCentFinalMonth TestSpendingIntegrationScheduleAndCuttableBoost TestSpendingIntegrationStochasticObserverParity TestSpendingIntegrationFundedNearTermAdvantage TestSpendingIntegrationPreviewGraphApplyReload TestSpendingOptimizerFrontierStagesAndBaseline TestSpendingApplyRejections TestSpendingRunnerWorkerBoundAtOneAndEight TestLivingSpendingBoostProjectionLoopParity; do
  grep -q -- "--- PASS: $tn" <<<"$out" && echo "  PASS $tn" || { echo "  MISSING/FAIL $tn"; fails=$((fails+1)); }
done
grep -q 'FAIL' <<<"$out" && { echo "  some Spending test FAILED"; fails=$((fails+1)); }
echo "== 3 seed replay reproduces published counts"
grep -q 'master=20260910 selection=-6884282663016313855 final=-1800455987195215627 paths=1000 cut/floor/unpaid=0/0/0' <<<"$out" && echo "  reproduced" || { echo "  seed replay line absent"; fails=$((fails+1)); }
echo "== 4 qualification rule has one source"
n=$(grep -rl 'func spendingCandidateQualifies' internal/ | wc -l); [[ "$n" == 1 ]] && echo "  one definition" || { echo "  $n definitions"; fails=$((fails+1)); }
echo "== 5 forbidden wording absent on new surfaces"
grep -Ei 'guaranteed|risk-free|global maximum' web/templates/components/whatif/spending_optimizer*.html web/static/js/whatif-spending-optimizer.js 2>/dev/null && fails=$((fails+1)) || echo "  clean"
echo "== 6 gofmt on manifest Go files"
bad="$(git diff --name-only master...HEAD 2>/dev/null | grep '\.go$' | xargs -r gofmt -l)"; [[ -z "$bad" ]] && echo "  clean" || { echo "  $bad"; fails=$((fails+1)); }
if [[ $fails -eq 0 ]]; then echo "ORACLE PASS"; else echo "ORACLE FAIL ($fails step(s))"; exit 1; fi
