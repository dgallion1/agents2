#!/usr/bin/env bash
# RC3 oracle — calendar-month forms and lists (handler-level, real templates).
# Usage: accept.sh <path-to-tree>   (a worktree or a copy; this script never
# writes to it: it works in its own cp -a copy). Emits ORACLE PASS only when
# every check passes.
set -u
ROOT="${1:-.}"
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d /tmp/rc3-oracle.XXXXXX)
cleanup() { rm -rf "$WORK"; }
fail() { echo "ORACLE FAIL: $*"; cleanup; exit 1; }
cp -a "$ROOT"/. "$WORK"/ || fail "copy of $ROOT"
cd "$WORK" || fail cd
export GOFLAGS=-buildvcs=false

echo "== O1 build + vet"
go build ./... || fail "build"
go vet ./internal/... || fail "vet"

echo "== O2 planted oracle tests (package retirement)"
cp "$HERE/rc3_oracle_test.go" internal/handlers/whatif/rc3_oracle_test.go || fail "plant"
go test -count=1 -run 'TestRC3Oracle' -v ./internal/handlers/whatif/ 2>&1 | grep -E '^(=== RUN|--- |\s+--- |ok|FAIL|PASS|panic)|rc3_oracle_test' | tail -60
go test -count=1 -run 'TestRC3Oracle' ./internal/handlers/whatif/ >/dev/null 2>&1 || fail "oracle tests"
rm -f internal/handlers/whatif/rc3_oracle_test.go

echo "== O3 shipped suites + testdata untouched"
go test -count=1 ./internal/models/... ./internal/services/retirement/... ./internal/handlers/whatif/... 2>&1 | tail -12
go test -count=1 ./internal/models/... ./internal/services/retirement/... ./internal/handlers/whatif/... >/dev/null 2>&1 || fail "shipped suites"
dirty=$(/usr/bin/git status --porcelain -- testdata 2>/dev/null)
[[ -z "$dirty" ]] || fail "suite rewrote tracked testdata: $dirty"

echo "== O4 no year words remain on the four schedule surfaces"
if grep -n 'Starts yr\|Ends yr\|(yr {{\|Year {{\.Year}}\|Year {{\.Item' web/templates/components/whatif/income-sources-list.html web/templates/components/whatif/expense-sources-list.html web/templates/components/whatif/onetime-card.html web/templates/components/whatif/bigticket-card.html; then fail "year-offset wording still rendered"; fi
for f in web/templates/components/whatif/income-sources-list.html web/templates/components/whatif/expense-sources-list.html web/templates/components/whatif/onetime-card.html web/templates/components/whatif/bigticket-card.html; do
  grep -q 'type="month"' "$f" || fail "no month input in $f"
done

echo "== O5 no display comparison of StartMonth/EndMonth to 0 outside internal/models (attempt 3)"
hits=$(grep -rn 'scheduleEnded\|eq \.StartMonth 0\|StartMonth == 0\|EndMonth <= 0\|EndMonth == 0' web/templates internal/handlers internal/services internal/templates 2>/dev/null | grep -v '_test\.go' || true)
if [[ -n "$hits" ]]; then echo "$hits"; fail "display comparison outside the model"; fi

cleanup
echo "ORACLE PASS"
