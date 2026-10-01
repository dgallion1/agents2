#!/usr/bin/env bash
# CD2 oracle — verdict/identity pairing rule in gate.sh and parse.mjs
# (SPEC.md §3b, .swarm/briefs/CD2.1.md). Usage: accept.sh [TREE]
# Prints "ORACLE PASS" as its last line only when every check passes.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TREE="$(cd "${1:-$HERE/../../..}" && pwd)"
BASE=12f6413
WORK="$(mktemp -d "${TMPDIR:-/tmp}/cd2-oracle.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
NFAIL=0
ok()  { echo "ok   - $*"; }
bad() { echo "FAIL - $*"; NFAIL=$((NFAIL+1)); }
echo "# CD2 oracle: TREE=$TREE"

# --- S: territory -------------------------------------------------------------
if [[ "$(sha256sum "$TREE/dashboard/lib/render.mjs" | cut -d' ' -f1)" == "$(cat "$HERE/base-render.sha256")" ]]; then
  ok "S render.mjs byte-identical to base"
else bad "S render.mjs changed"; fi
if git -C "$TREE" rev-parse -q --verify "$BASE" >/dev/null 2>&1; then
  out=$( { git -C "$TREE" diff --no-renames --name-only "$BASE"; git -C "$TREE" ls-files --others --exclude-standard; } | sort -u \
    | grep -vxE 'SPEC\.md|swarm/codex-check\.sh|swarm/codex/.*|smoketest/codex/.*' \
    | grep -vxE 'swarm/gate\.sh|dashboard/lib/parse\.mjs|dashboard/test/parse\.test\.mjs|smoketest/gate/.*' || true)
  if [[ -z "$out" ]]; then ok "S only CD2-territory files changed (CD1 territory and SPEC.md ignored)"
  else bad "S files outside CD2 territory changed: $(tr '\n' ' ' <<<"$out")"; fi
else echo "#   (no git base in TREE — territory-by-git check skipped; prototype run)"; fi

# --- D: independent differential battery --------------------------------------
if node "$HERE/differential.mjs" "$TREE" > "$WORK/diff.log" 2>&1; then ok "D $(tail -1 "$WORK/diff.log")"
else grep -E '^(FAIL|differential)' "$WORK/diff.log" | sed 's/^/    /'; bad "D differential battery: $(tail -1 "$WORK/diff.log")"; fi

# --- E: escalate-scan / stats / done see the rule too (census CD2.1 gaps 1-3)
fx() { local d="$WORK/$1"; mkdir -p "$d/verdicts" "$d/manifests" "$d/flags" "$d/tree/src"; echo "$d"; }
vf() { printf 'VERDICT: %s\nCHECKER: %s\nFAMILY: %s\nTASK: %s\nATTEMPT: %s\n---\ne\n' "$5" "$4" "$6" "$2" "$3" > "$1/verdicts/$2.$3.$4.verdict"; }  # d task att checker verdict family
G="$TREE/swarm/gate.sh"
# E1: attempt-1 FAIL "set aside" by a panel that includes a checker OVERRULE —
# under the rule only two valid votes remain, so attempt 1 stays unresolved
# and two consecutive FAILs trigger.
d=$(fx e1); printf '# h\ne1\t2\ttests\tchecking\t2\tw\tr\n' > "$d/ledger.tsv"
vf "$d" e1 1 checker-tests FAIL anthropic; vf "$d" e1 1 checker-rogue OVERRULE impact
vf "$d" e1 1 judge-claude OVERRULE anthropic; vf "$d" e1 1 judge-standards OVERRULE adversarial
vf "$d" e1 2 checker-tests FAIL anthropic
(cd "$d" && SWARM_DIR=. bash "$G" escalate-scan) > "$WORK/e1.log" 2>&1
if [[ -f "$d/flags/e1.flag" ]] && grep -q two-consecutive-fails "$d/flags/e1.flag"; then ok "E1 a checker-cast OVERRULE no longer sets a FAIL aside (escalate-scan flags two-consecutive-fails)"
else bad "E1 escalate-scan did not flag e1: $(cat "$WORK/e1.log")"; fi
# E2: a FAIL cast by a judge is not a FAIL — no two-consecutive trigger
d=$(fx e2); printf '# h\ne2\t2\ttests\tchecking\t2\tw\tr\n' > "$d/ledger.tsv"
vf "$d" e2 1 judge-x FAIL adversarial; vf "$d" e2 2 checker-tests FAIL anthropic
(cd "$d" && SWARM_DIR=. bash "$G" escalate-scan) > "$WORK/e2.log" 2>&1
if [[ ! -f "$d/flags/e2.flag" ]]; then ok "E2 a judge-cast FAIL does not count toward two-consecutive-fails"
else bad "E2 escalate-scan flagged e2 from a judge-cast FAIL: $(cat "$d/flags/e2.flag")"; fi
# E3: stats does not count a judge-cast FAIL as a failed first attempt
d=$(fx e3); printf '# h\ne3\t2\ttests\tchecking\t1\tw\tr\n' > "$d/ledger.tsv"
vf "$d" e3 1 judge-x FAIL adversarial
out=$(cd "$d" && SWARM_DIR=. bash "$G" stats 2>&1)
if ! grep -qE '^stats: e3 .*failed' <<<"$out"; then ok "E3 stats ignores a judge-cast FAIL"
else bad "E3 stats counted a judge-cast FAIL: $(grep '^stats: e3' <<<"$out")"; fi
# E4: done refuses a row whose current attempt holds a mis-paired verdict
d=$(fx e4); printf '# h\ne4\t2\ttests\taccepted\t1\tw\tr\n' > "$d/ledger.tsv"
echo x > "$d/tree/src/a.txt"; echo src/a.txt > "$d/manifests/e4.1.files"
(cd "$d/tree" && sha256sum src/a.txt) > "$d/manifests/e4.1.sha256"; ms=$(sha256sum < "$d/manifests/e4.1.sha256" | cut -d' ' -f1)
printf 'VERDICT: PASS\nCHECKER: checker-tests\nFAMILY: anthropic\nTASK: e4\nATTEMPT: 1\nMANIFEST_SHA256: %s\n---\ne\n' "$ms" > "$d/verdicts/e4.1.checker-tests.verdict"
printf 'VERDICT: PASS\nCHECKER: judge-x\nFAMILY: adversarial\nTASK: e4\nATTEMPT: 1\nMANIFEST_SHA256: %s\n---\ne\n' "$ms" > "$d/verdicts/e4.1.judge-x.verdict"
if (cd "$d" && SWARM_DIR=. SWARM_TREE=tree bash "$G" done) > "$WORK/e4.log" 2>&1; then bad "E4 done accepted a row with a judge-cast PASS"
else grep -qi "not allowed" "$WORK/e4.log" && ok "E4 done refuses a mis-paired verdict, naming the rule" || bad "E4 done refused, but not for the pairing: $(tail -2 "$WORK/e4.log" | tr '\n' ' ')"; fi

# --- C: consumers ---------------------------------------------------------------
if (cd "$TREE" && bash smoketest/gate/run_tests.sh) > "$WORK/rt.log" 2>&1 && ! grep -qE '^(FAIL|not ok)' "$WORK/rt.log"; then
  ok "C1 smoketest/gate/run_tests.sh passes"
else bad "C1 run_tests.sh: $(grep -E '^(FAIL|[0-9]+ FAILED)' "$WORK/rt.log" | head -5 | tr '\n' ' ')"; fi
if (cd "$TREE" && node --test dashboard/test/*.test.mjs) > "$WORK/node.log" 2>&1 && grep -qE '^ℹ fail 0$' "$WORK/node.log"; then
  ok "C2 dashboard tests pass ($(grep -E '^ℹ tests' "$WORK/node.log"))"
else bad "C2 dashboard tests: $(grep -E '^ℹ (tests|fail)' "$WORK/node.log" | tr '\n' ' ')"; fi
# the demo fixture: the new parser reports no error the base parser did not
node -e "
const [a,b,dir]=process.argv.slice(1);
Promise.all([import('file://'+a),import('file://'+b)]).then(([n,o])=>{
  const e=(m)=>m.parse(dir).errors.map(x=>x.file+': '+x.message).sort();
  const extra=e(n).filter(x=>!e(o).includes(x));
  console.log(extra.length?'EXTRA '+extra.join(' | '):'SAME');});" \
  "$TREE/dashboard/lib/parse.mjs" "$HERE/base-parse.mjs" "$TREE/dashboard/fixtures/swarm-demo" > "$WORK/demo.log" 2>&1
if grep -qx SAME "$WORK/demo.log"; then ok "C3 demo fixture parses with no new errors"
else bad "C3 demo fixture: $(cat "$WORK/demo.log")"; fi

# --- M: the shipped tests catch the old behaviour (V3 — outlives this oracle) -
mk() { local d="$WORK/$1"; mkdir -p "$d"; rsync -a --exclude .git --exclude .swarm --exclude '.swarm-*' "$TREE/" "$d/"; echo "$d"; }
m1=$(mk m1); cp "$HERE/base-gate.sh" "$m1/swarm/gate.sh"
if (cd "$m1" && bash smoketest/gate/run_tests.sh) > "$WORK/m1.log" 2>&1; then
  bad "M1 smoketest suite still passes against the base gate.sh (does not pin the rule)"
else ok "M1 smoketest suite fails against the base gate.sh ($(grep -cE '^FAIL' "$WORK/m1.log") FAIL lines)"; fi
m2=$(mk m2); cp "$HERE/base-parse.mjs" "$m2/dashboard/lib/parse.mjs"
(cd "$m2" && node --test dashboard/test/*.test.mjs) > "$WORK/m2.log" 2>&1
mf=$(grep -oE '^ℹ fail [0-9]+' "$WORK/m2.log" | grep -oE '[0-9]+$')
if [[ -n "$mf" && "$mf" -gt 0 ]]; then ok "M2 dashboard suite fails against the base parse.mjs ($mf failing)"
else bad "M2 dashboard suite does not catch the base parse.mjs (fail=${mf:-?})"; fi

if (( NFAIL == 0 )); then echo "ORACLE PASS"; exit 0; fi
echo "ORACLE FAIL: $NFAIL check(s) failed"; exit 1
