#!/usr/bin/env bash
# CM1 oracle: use-current-month migration. Usage: accept.sh [repo-root]
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-$(pwd)}"; cd "$ROOT" || exit 1
LIVE=/home/darrell/bin/ai/budget2/data/settings          # read-only source of fixtures
SCR="$(mktemp -d)"
cleanup() { rm -rf "$SCR" "$ROOT/internal/zzoracle_cm1"; }
trap cleanup EXIT
cp "$LIVE/whatif.json" "$SCR/live.json" && cp "$LIVE/whatif_job-loss.json" "$SCR/scenario.json" || exit 1
fails=0
echo "== 1 build"; go build ./... || fails=$((fails+1))
echo "== 2 oracle probes (live-shaped copies; live data untouched)"
mkdir -p internal/zzoracle_cm1 && cp "$HERE/oracle_test.go" internal/zzoracle_cm1/
ORACLE_LIVE="$SCR/live.json" ORACLE_SCEN="$SCR/scenario.json" go test ./internal/zzoracle_cm1 -run TestOracle -count=1 -v 2>&1 | grep -E '^(---|===|\s+oracle_test|ok|FAIL|#|\./)' | grep -v '^=== RUN'
[[ ${PIPESTATUS[0]} == 0 ]] || fails=$((fails+1))
rm -rf internal/zzoracle_cm1
echo "== 3 permanent unit tests present and green"
out="$(go test ./internal/services/retirement ./internal/handlers/whatif -run 'CurrentMonth' -count=1 -v 2>&1)"
for tn in TestCurrentMonthLoadRefreshesCachedAges TestCurrentMonthLegacyPlanMigration TestCurrentMonthBirthdayAndYearRollover TestCurrentMonthExplicitFixedDateSurvivesLoad TestCurrentMonthLegacyBirthMonthPreserved TestCurrentMonthFormToggleAndRender; do
  grep -q -- "--- PASS: $tn" <<<"$out" && echo "  PASS $tn" || { echo "  MISSING/FAIL $tn"; fails=$((fails+1)); }
done
echo "== 4 tracked testdata untouched (focused runs, then cmd/server)"
if [[ -n "$(git status --short testdata/)" ]]; then git status --short testdata/; fails=$((fails+1)); else echo "  clean after focused runs"; fi
go test ./cmd/server -count=1 >/dev/null 2>&1 || { echo "  cmd/server tests FAILED"; fails=$((fails+1)); }
if [[ -n "$(git status --short testdata/)" ]]; then echo "  cmd/server run dirtied:"; git status --short testdata/; git checkout -- testdata/ 2>/dev/null; fails=$((fails+1)); else echo "  clean after cmd/server"; fi
echo "== 5 form exposes the toggle and locks the date input"
grep -q 'name="use_current_month"' web/templates/components/whatif/rate-assumptions.html && grep -q 'UseCurrentMonth}}readonly' web/templates/components/whatif/rate-assumptions.html && echo "  present" || { echo "  absent"; fails=$((fails+1)); }
echo "== 6 gofmt on touched Go files"
bad="$(gofmt -l internal/services/retirement/settings.go internal/services/retirement/settings_current_month.go internal/handlers/whatif/handlers_rates.go internal/models/whatif.go 2>/dev/null)"
[[ -z "$bad" ]] && echo "  clean" || { echo "  $bad"; fails=$((fails+1)); }
if [[ $fails -eq 0 ]]; then echo "ORACLE PASS"; else echo "ORACLE FAIL ($fails step(s))"; exit 1; fi
