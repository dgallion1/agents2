#!/usr/bin/env bash
# CD3 oracle — critical-glob evaluation fails closed (SPEC.md §3c,
# .swarm/briefs/CD3.1.md). Usage: accept.sh [TREE]
# Base = the post-CD2 files frozen at CD2's acceptance (base-gate.sh,
# base-parse.mjs, base.sha256). Prints "ORACLE PASS" last only if all pass.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TREE="$(cd "${1:-$HERE/../../..}" && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/cd3-oracle.XXXXXX")"
trap 'chmod -R u+rwx "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT
NFAIL=0
ok()  { echo "ok   - $*"; }
bad() { echo "FAIL - $*"; NFAIL=$((NFAIL+1)); }
echo "# CD3 oracle: TREE=$TREE"

# --- S: territory — every non-CD3 file is as it was when CD2 was accepted ------
out=""
while read -r h p; do
  p="${p# }"
  case "$p" in swarm/gate.sh|dashboard/lib/parse.mjs|dashboard/test/parse.test.mjs|smoketest/gate/*) continue ;; esac
  [[ -f "$TREE/$p" && "$(sha256sum "$TREE/$p" | cut -d' ' -f1)" == "$h" ]] || out+="$p "
done < "$HERE/base.sha256"
if [[ -z "$out" ]]; then ok "S outside CD3 territory, every tracked file matches its post-CD2 state"
else bad "S files outside CD3 territory changed: $out"; fi
if git -C "$TREE" rev-parse -q --verify 12f6413 >/dev/null 2>&1; then
  new=$(git -C "$TREE" ls-files --others --exclude-standard | grep -vE '^(swarm/codex-check\.sh|swarm/codex/|smoketest/codex/|smoketest/gate/)' || true)
  if [[ -z "$new" ]]; then ok "S no new files outside CD3/CD1 territory"; else bad "S new files outside territory: $(tr '\n' ' ' <<<"$new")"; fi
fi

# --- D: independent differential battery ----------------------------------------
if node "$HERE/differential.mjs" "$TREE" > "$WORK/diff.log" 2>&1; then ok "D $(tail -1 "$WORK/diff.log")"
else grep -E '^(FAIL|differential)' "$WORK/diff.log" | sed 's/^/    /'; bad "D differential battery: $(tail -1 "$WORK/diff.log")"; fi

# --- E: escalate-scan / done / the diagnostic, per input kind (census CD3.1) ---
[[ "$(id -u)" != 0 ]] || bad "E the oracle must not run as root (mode-000 fixtures would be readable)"
G="$TREE/swarm/gate.sh"
efx() {                                   # name -> fixture with row eN (tier 2, checking), one manifest
  local d="$WORK/$1"; mkdir -p "$d/verdicts" "$d/manifests" "$d/flags" "$d/tree/src"
  printf '# h\n%s\t2\ttests\tchecking\t1\tw\tr\n' "$1" > "$d/ledger.tsv"
  echo x > "$d/tree/src/a.txt"; echo src/a.txt > "$d/manifests/$1.1.files"; printf 'swarm/**\n' > "$d/critical.globs"; echo "$d"
}
scan() { (cd "$1" && SWARM_DIR=. bash "$G" escalate-scan) > "$1/scan.out" 2> "$1/scan.err"; }
ekind() {                                 # label name path-in-stderr setup-cmd
  local d; d=$(efx "$2"); eval "$4"; scan "$d"; chmod -R u+rwX "$d" 2>/dev/null
  if [[ -f "$d/flags/$2.flag" ]] && grep -qx "REASON: critical-glob-unreadable" "$d/flags/$2.flag"; then ok "E $1 → flag REASON: critical-glob-unreadable"
  else bad "E $1 → no exact REASON line: $(cat "$d/flags/$2.flag" 2>/dev/null | tr '\n' ' ') $(head -2 "$d/scan.err" | tr '\n' ' ')"; fi
  if [[ $(grep -ci unreadable "$d/scan.err") == 1 ]] && grep -i unreadable "$d/scan.err" | grep -qF "$3"; then ok "E $1 → one stderr line naming $3"
  else bad "E $1 → stderr should be one 'unreadable' line naming $3: $(tr '\n' ' ' < "$d/scan.err")"; fi
}
ekind "critical.globs mode 000"        ea critical.globs 'chmod 000 "$d/critical.globs"'
ekind "critical.globs a directory"     eb critical.globs 'rm "$d/critical.globs"; mkdir "$d/critical.globs"'
ekind "critical.globs dangling link"   ec critical.globs 'rm "$d/critical.globs"; ln -s nowhere "$d/critical.globs"'
ekind "test.globs mode 000"            ed test.globs     'echo x > "$d/test.globs"; chmod 000 "$d/test.globs"'
ekind "test.globs not UTF-8"           ee test.globs     'printf "\xff\xfe\n" > "$d/test.globs"'
ekind "a manifest not UTF-8"           ef ef.1.files     'printf "\xff\xfe\n" > "$d/manifests/ef.1.files"'
# control: a row with no manifests is never flagged, even with unreadable globs
d=$(efx eg); rm "$d/manifests/eg.1.files"; chmod 000 "$d/critical.globs"; scan "$d"; chmod 644 "$d/critical.globs"
if [[ ! -f "$d/flags/eg.flag" ]]; then ok "E control: an unstarted row (no manifests) is not flagged"; else bad "E an unstarted row was flagged: $(cat "$d/flags/eg.flag")"; fi
# control: clean inputs print nothing about unreadability
d=$(efx eh); scan "$d"
if ! grep -qi unreadable "$d/scan.err"; then ok "E control: clean inputs → no unreadable diagnostic"; else bad "E clean inputs printed: $(cat "$d/scan.err")"; fi
# the evaluator itself failing (python3 killed) is unreadable, not "no hit"
d=$(efx ei); mkdir -p "$WORK/shim"; printf '#!/bin/sh\nkill -9 $$\n' > "$WORK/shim/python3"; chmod +x "$WORK/shim/python3"
(cd "$d" && PATH="$WORK/shim:$PATH" SWARM_DIR=. bash "$G" escalate-scan) > "$d/scan.out" 2> "$d/scan.err"
if grep -qx "REASON: critical-glob-unreadable" "$d/flags/ei.flag" 2>/dev/null; then ok "E a killed python3 evaluator → critical-glob-unreadable"
else bad "E a killed python3 was read as no hit: flag=$(cat "$d/flags/ei.flag" 2>/dev/null) err=$(tr '\n' ' ' < "$d/scan.err")"; fi
# done refuses an accepted row whose globs are unreadable (census G3)
d="$WORK/ej"; mkdir -p "$d/verdicts" "$d/manifests" "$d/flags" "$d/tree/src"
printf '# h\nej\t2\ttests\taccepted\t1\tw\tr\n' > "$d/ledger.tsv"; echo x > "$d/tree/src/a.txt"; echo src/a.txt > "$d/manifests/ej.1.files"
(cd "$d/tree" && sha256sum src/a.txt) > "$d/manifests/ej.1.sha256"; ms=$(sha256sum < "$d/manifests/ej.1.sha256" | cut -d' ' -f1)
printf 'VERDICT: PASS\nCHECKER: checker-tests\nFAMILY: anthropic\nTASK: ej\nATTEMPT: 1\nMANIFEST_SHA256: %s\n---\ne\n' "$ms" > "$d/verdicts/ej.1.checker-tests.verdict"
printf 'swarm/**\n' > "$d/critical.globs"; chmod 000 "$d/critical.globs"
(cd "$d" && SWARM_DIR=. SWARM_TREE=tree bash "$G" done) > "$d/done.out" 2>&1; drc=$?; chmod 644 "$d/critical.globs"
if [[ $drc != 0 ]] && grep -q critical-glob-unreadable "$d/done.out"; then ok "E done refuses an accepted row with unreadable globs, naming the reason"
else bad "E done: rc=$drc $(tr '\n' ' ' < "$d/done.out")"; fi
# the stale "unreadable → no hit" comments are gone (census G9)
if ! grep -qiE 'unreadable input.{0,40}no hit|reports NO hit' "$TREE/dashboard/lib/parse.mjs"; then ok "E parse.mjs no longer says unreadable input means no hit"
else bad "E parse.mjs still documents fail-open: $(grep -niE 'unreadable input.{0,40}no hit|reports NO hit' "$TREE/dashboard/lib/parse.mjs" | head -2)"; fi

# --- C: consumers -------------------------------------------------------------------
if (cd "$TREE" && bash smoketest/gate/run_tests.sh) > "$WORK/rt.log" 2>&1 && ! grep -qE '^(FAIL|not ok)' "$WORK/rt.log"; then
  ok "C1 smoketest/gate/run_tests.sh passes"
else bad "C1 run_tests.sh: $(grep -E '^(FAIL|[0-9]+ FAILED)' "$WORK/rt.log" | head -5 | tr '\n' ' ')"; fi
if (cd "$TREE" && node --test dashboard/test/*.test.mjs) > "$WORK/node.log" 2>&1 && grep -qE '^ℹ fail 0$' "$WORK/node.log"; then
  ok "C2 dashboard tests pass ($(grep -E '^ℹ tests' "$WORK/node.log"))"
else bad "C2 dashboard tests: $(grep -E '^ℹ (tests|fail)' "$WORK/node.log" | tr '\n' ' ')"; fi

# --- M: the shipped tests catch the post-CD2 (fail-open) behaviour -----------------
mk() { local d="$WORK/$1"; mkdir -p "$d"; rsync -a --exclude .git --exclude .swarm --exclude '.swarm-*' "$TREE/" "$d/"; echo "$d"; }
m1=$(mk m1); cp "$HERE/base-gate.sh" "$m1/swarm/gate.sh"
if (cd "$m1" && bash smoketest/gate/run_tests.sh) > "$WORK/m1.log" 2>&1; then bad "M1 smoketest suite still passes against the post-CD2 gate.sh"
elif grep -E '^FAIL' "$WORK/m1.log" | grep -qiE 'unreadable|fail.?closed'; then ok "M1 smoketest suite fails against the post-CD2 gate.sh, on the new unreadable tests ($(grep -cE '^FAIL' "$WORK/m1.log") FAIL lines)"
else bad "M1 the suite fails against the post-CD2 gate, but not on an unreadable/fail-closed test: $(grep -E '^FAIL' "$WORK/m1.log" | head -3 | tr '\n' ' ')"; fi
m2=$(mk m2); cp "$HERE/base-parse.mjs" "$m2/dashboard/lib/parse.mjs"
(cd "$m2" && node --test dashboard/test/*.test.mjs) > "$WORK/m2.log" 2>&1
mf=$(grep -oE '^ℹ fail [0-9]+' "$WORK/m2.log" | grep -oE '[0-9]+$')
if [[ -n "$mf" && "$mf" -gt 0 ]] && grep -qiE 'unreadable|fail.?closed' "$WORK/m2.log"; then ok "M2 dashboard suite fails against the post-CD2 parse.mjs, on unreadable tests ($mf failing)"
else bad "M2 dashboard suite does not catch the post-CD2 parse.mjs (fail=${mf:-?})"; fi

if (( NFAIL == 0 )); then echo "ORACLE PASS"; exit 0; fi
echo "ORACLE FAIL: $NFAIL check(s) failed"; exit 1
