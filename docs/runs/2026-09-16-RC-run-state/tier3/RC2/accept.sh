#!/usr/bin/env bash
# RC2 oracle — month-precise schedules survive the month rollover.
# Usage: accept.sh <path-to-tree>   (a worktree or a copy; this script never
# writes to it: it works in its own cp -a copy). Emits ORACLE PASS only when
# every check passes.
set -u
ROOT="${1:-.}"
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d /tmp/rc2-oracle.XXXXXX)
cleanup() { rm -rf "$WORK"; }
fail() { echo "ORACLE FAIL: $*"; cleanup; exit 1; }
cp -a "$ROOT"/. "$WORK"/ || fail "copy of $ROOT"
cd "$WORK" || fail cd
export GOFLAGS=-buildvcs=false

echo "== O1 build + vet"
go build ./... || fail "build"
go vet ./internal/... || fail "vet"

echo "== O2 planted oracle tests (package retirement)"
cp "$HERE/rc2_oracle_test.go" internal/services/retirement/rc2_oracle_test.go || fail "plant"
go test -count=1 -run 'TestRC2Oracle' -v ./internal/services/retirement/ 2>&1 | grep -E '^(=== RUN|--- |\s+--- |ok|FAIL|PASS|panic)|rc2_oracle_test' | tail -60
go test -count=1 -run 'TestRC2Oracle' ./internal/services/retirement/ >/dev/null 2>&1 || fail "oracle tests"
rm -f internal/services/retirement/rc2_oracle_test.go
echo "== O2t planted template-lane oracle test (package whatif; added after ruling 2026-09-16b)"
cp "$HERE/rc2_oracle_templates_test.go" internal/handlers/whatif/rc2_oracle_templates_test.go || fail "plant templates"
go test -count=1 -run 'TestRC2OracleTemplates' -v ./internal/handlers/whatif/ 2>&1 | grep -E '^(=== RUN|--- |\s+--- |ok|FAIL|PASS|panic)|rc2_oracle_templates_test' | tail -30
go test -count=1 -run 'TestRC2OracleTemplates' ./internal/handlers/whatif/ >/dev/null 2>&1 || fail "template-lane oracle test"
rm -f internal/handlers/whatif/rc2_oracle_templates_test.go

echo "== O3 shipped suites + testdata untouched"
go test -count=1 ./internal/models/... ./internal/services/retirement/... ./internal/handlers/whatif/... 2>&1 | tail -12
go test -count=1 ./internal/models/... ./internal/services/retirement/... ./internal/handlers/whatif/... >/dev/null 2>&1 || fail "shipped suites"
dirty=$(/usr/bin/git status --porcelain -- testdata 2>/dev/null)
[[ -z "$dirty" ]] || fail "suite rewrote tracked testdata: $dirty"

echo "== O4 mutation: shift neutralised must be noticed by SHIPPED tests"
f=internal/services/retirement/settings_current_month.go
n=$(grep -c 'shiftScheduleOffsets(settings, elapsed)' "$f" 2>/dev/null || true)
[[ "$n" == "1" ]] || fail "expected exactly one 'shiftScheduleOffsets(settings, elapsed)' call line in $f, found ${n:-0}"
cp "$f" "$f.orig"
sed -i 's/shiftScheduleOffsets(settings, elapsed)/shiftScheduleOffsets(settings, 0)/' "$f"
out=$(go test -count=1 ./internal/services/retirement/ 2>&1)
cp "$f.orig" "$f"; rm -f "$f.orig"
if grep -q '^ok' <<<"$out"; then fail "shipped retirement tests stayed green with the shift neutralised"; fi
grep -q -- '--- FAIL' <<<"$out" || fail "mutation produced no test failure (build error?): $(tail -5 <<<"$out")"
echo "   mutation noticed: $(grep -c -- '--- FAIL' <<<"$out") failing test(s)"

cleanup
echo "ORACLE PASS"
