#!/usr/bin/env bash
# GH2 oracle — the dashboard mirrors gate.sh's inline escalation triggers
# (SPEC.md §4, GH2). Usage: accept.sh [TREE]   (default: this .swarm's repo)
# Prints "ORACLE PASS" as its last line only when every check passes.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TREE="$(cd "${1:-$HERE/../../..}" && pwd)"
GH1SIDE="$HERE/../../manifests/GH1.1.sha256"          # GH1's accepted fingerprints
WORK="$(mktemp -d "${TMPDIR:-/tmp}/gh2-oracle.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
NFAIL=0
ok()  { echo "ok   - $*"; }
bad() { echo "FAIL - $*"; NFAIL=$((NFAIL+1)); }
echo "# GH2 oracle: TREE=$TREE"

# --- scope: GH2 may change only parse.mjs and parse.test.mjs ------------------
ALLOWED='dashboard/lib/parse.mjs
dashboard/test/parse.test.mjs'
changed=""
while read -r h p; do
  p="${p# }"
  if [[ "$h" == deleted ]]; then [[ -e "$TREE/$p" ]] && changed+="$p"$'\n'
  else [[ -f "$TREE/$p" && "$(sha256sum "$TREE/$p" | cut -d' ' -f1)" == "$h" ]] || changed+="$p"$'\n'; fi
done < "$GH1SIDE"
extra=$(grep -vxF -f <(printf '%s\n' "$ALLOWED") <<<"${changed%$'\n'}" | grep -v '^$' || true)
if [[ -z "$extra" ]]; then ok "S0 of GH1's 39 files only parse.mjs / parse.test.mjs changed (gate.sh and render.mjs untouched)"
else bad "S0 GH2 changed GH1 files outside its scope: $(tr '\n' ' ' <<<"$extra")"; fi
if git -C "$TREE" rev-parse -q --verify cae89ff >/dev/null 2>&1; then
  newpaths=$( { git -C "$TREE" diff --no-renames --name-only cae89ff; git -C "$TREE" ls-files --others --exclude-standard; } \
    | grep -vx 'SPEC.md' | grep -vxF -f <(sed -E 's/^[0-9a-f]{64}  |^deleted  //' "$GH1SIDE") | sort -u || true)
  if [[ -z "$newpaths" ]]; then ok "S0 no file outside GH1's set changed"
  else bad "S0 files changed outside GH1's set: $(tr '\n' ' ' <<<"$newpaths")"; fi
else
  echo "#   (no git base in TREE — outside-set check skipped; prototype run)"
fi

# --- D: independent differential battery (gate vs dashboard) -----------------
if node "$HERE/differential.mjs" "$TREE" > "$WORK/diff.log" 2>&1; then
  ok "D $(tail -1 "$WORK/diff.log")"
else
  sed 's/^/    /' "$WORK/diff.log" | grep -E '^    (FAIL|differential)'
  bad "D differential battery: $(tail -1 "$WORK/diff.log")"
fi

# --- C: consumers ------------------------------------------------------------
if (cd "$TREE" && bash smoketest/gate/run_tests.sh) > "$WORK/rt.log" 2>&1 && ! grep -qE '^(FAIL|not ok)' "$WORK/rt.log"; then
  ok "C1 smoketest/gate/run_tests.sh passes"
else bad "C1 run_tests.sh: $(grep -E '^(FAIL|[0-9]+ FAILED)' "$WORK/rt.log" | head -5 | tr '\n' ' ')"; fi
if (cd "$TREE" && node --test dashboard/test/*.test.mjs) > "$WORK/node.log" 2>&1 && grep -qE '^ℹ fail 0$' "$WORK/node.log"; then
  ok "C2 dashboard tests pass ($(grep -E '^ℹ tests' "$WORK/node.log"))"
else bad "C2 dashboard tests: $(grep -E '^ℹ (tests|fail)' "$WORK/node.log" | tr '\n' ' ')"; fi
# The shipped battery must itself catch the missing mirror (V3 pattern — the
# property must outlive this oracle): run the TREE's dashboard tests against
# GH1's parse.mjs (no trigger mirroring). They must FAIL there.
mut="$WORK/mutant"; mkdir -p "$mut"
rsync -a --exclude .git --exclude .swarm "$TREE/" "$mut/"
cp "$HERE/gh1-parse.mjs" "$mut/dashboard/lib/parse.mjs"
(cd "$mut" && node --test dashboard/test/*.test.mjs) > "$WORK/mut.log" 2>&1
mf=$(grep -oE '^ℹ fail [0-9]+' "$WORK/mut.log" | grep -oE '[0-9]+$')
if [[ -n "$mf" && "$mf" -gt 0 ]] && grep -qiE 'differential|escalat|trigger' "$WORK/mut.log"; then
  ok "C3 the shipped dashboard tests fail against GH1's un-mirrored parse.mjs ($mf failing)"
else bad "C3 the shipped dashboard tests do not catch a parse.mjs without trigger mirroring (fail=${mf:-?})"; fi

if (( NFAIL == 0 )); then echo "ORACLE PASS"; exit 0; fi
echo "ORACLE FAIL: $NFAIL check(s) failed"; exit 1
