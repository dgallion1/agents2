#!/usr/bin/env bash
# CD4 oracle — the Codex lane in gate, dashboard and docs (.swarm/briefs/CD4.1.md).
# Usage: accept.sh [TREE]. Base = the tree after CD1–CD3 were accepted
# (base-gate.sh, base-parse.mjs, base.sha256). Uses Docker (integration) under
# the shared lock. Prints "ORACLE PASS" last only if every check passes.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TREE="$(cd "${1:-$HERE/../../..}" && pwd)"
LOCK=/tmp/claude-1000/-home-darrell-work-agents2--claude-worktrees-unifi-camera-streaming-7be695/480338d9-8e6c-42d1-8681-c9e4d1acdcaf/scratchpad/cd1-docker.lock
WORK="$(mktemp -d "${TMPDIR:-/tmp}/cd4-oracle.XXXXXX")"
trap 'chmod -R u+rwX "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT
NFAIL=0
ok()  { echo "ok   - $*"; }
bad() { echo "FAIL - $*"; NFAIL=$((NFAIL+1)); }
chk() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
G="$TREE/swarm/gate.sh"
echo "# CD4 oracle: TREE=$TREE"

# --- S: territory ----------------------------------------------------------------
terr() { case "$1" in swarm/gate.sh|dashboard/lib/parse.mjs|dashboard/test/parse.test.mjs|smoketest/gate/*|smoketest/doc_test.sh|CLAUDE.md|TIERS.md|README.md|SPEC.md|.swarm/*|.swarm-*) return 0 ;; esac; return 1; }
[[ -s "$HERE/base.sha256" ]] || bad "S base.sha256 missing (run mkbase.sh once CD1..3 are accepted)"
out=""
while read -r h p; do
  p="${p# }"; terr "$p" && continue
  [[ -f "$TREE/$p" && "$(sha256sum "$TREE/$p" | cut -d' ' -f1)" == "$h" ]] || out+="$p "
done < "$HERE/base.sha256"
chk "S outside CD4 territory every file matches its post-CD1..3 state" '[[ -z "$out" ]]'
[[ -z "$out" ]] || echo "#     changed: $out"
new=""
while IFS= read -r p; do
  terr "$p" && continue
  grep -qxF "$p" <(cut -c67- "$HERE/base.sha256") || new+="$p "
done < <(git -C "$TREE" ls-files --cached --others --exclude-standard)
chk "S no new file outside CD4 territory" '[[ -z "$new" ]]'
[[ -z "$new" ]] || echo "#     new: $new"

# --- D: differential -----------------------------------------------------------------
if timeout 900 node "$HERE/differential.mjs" "$TREE" > "$WORK/diff.log" 2>&1; then ok "D $(tail -1 "$WORK/diff.log")"
else grep -E '^(FAIL|differential)' "$WORK/diff.log" | sed 's/^/    /'; bad "D differential battery: $(tail -1 "$WORK/diff.log")"; fi

# --- E: a Codex FAIL counts for escalation (two consecutive) -------------------------
d="$WORK/e1"; mkdir -p "$d/verdicts" "$d/manifests" "$d/flags"
printf '# h\ne1\t2\ttests,second,codex\tchecking\t2\tw\tr\n' > "$d/ledger.tsv"
for a in 1 2; do printf 'VERDICT: FAIL\nCHECKER: checker-codex\nFAMILY: crossvendor\nTASK: e1\nATTEMPT: %s\n---\ne\n' $a > "$d/verdicts/e1.$a.checker-codex.verdict"; done
(cd "$d" && SWARM_DIR=. bash "$G" escalate-scan) > /dev/null 2>&1
chk "E two consecutive Codex FAILs trigger two-consecutive-fails" 'grep -q two-consecutive-fails "$d/flags/e1.flag" 2>/dev/null'

# --- T: stats — exact per-task fields and the codex summary line -----------------
d="$WORK/t"; mkdir -p "$d/verdicts" "$d/manifests" "$d/flags"
{ echo '# h'
  printf 's1\t2\ttests,second,codex\tchecking\t2\tw\tr\n'
  printf 's2\t2\ttests,second,codex\tchecking\t1\tw\tr\n'
  printf 's3\t2\ttests,second\tchecking\t1\tw\tr\n'
  printf 's5\t2\ttests,second,codex\tchecking\t1\tw\tr\n'
  printf 's6\t2\ttests,codex\tchecking\t1\tw\tr\n'
  printf 's7\t2\ttests,second,codex\tchecking\t1\tw\tr\n'
  printf 's8\t2\ttests,codex\tchecking\t1\tw\tr\n'
  printf 's9\t2\ttests,second,codex\tno-change\t1\tw\tr\n'; } > "$d/ledger.tsv"
vf() { printf 'VERDICT: %s\nCHECKER: %s\nFAMILY: %s\nTASK: %s\nATTEMPT: %s\n---\ne\n' "$5" "$4" "$6" "$2" "$3" > "$d/verdicts/$2.$3.$4.verdict"; }
sk() { printf 'REASON: %s\nDETAIL: probe\nTASK: %s\nATTEMPT: %s\n' "$3" "$1" "$2" > "$d/verdicts/$1.$2.checker-codex.skip"; }
vf "$d" s1 1 checker-codex FAIL crossvendor; vf "$d" s1 1 checker-second PASS adversarial
vf "$d" s1 2 checker-codex PASS crossvendor; vf "$d" s1 2 checker-second PASS adversarial
sk s2 1 quota; vf "$d" s2 1 checker-second FAIL adversarial
vf "$d" s3 1 checker-second PASS adversarial
vf "$d" s5 1 checker-codex FAIL crossvendor; vf "$d" s5 1 checker-second FAIL adversarial
vf "$d" s6 1 checker-codex FAIL crossvendor; vf "$d" s6 1 checker-tests PASS anthropic
sk s7 1 bogus-reason; vf "$d" s7 1 checker-second PASS adversarial
vf "$d" s8 1 checker-codex PASS crossvendor; sk s8 1 quota
vf "$d" s9 1 checker-codex FAIL crossvendor
st=$(cd "$d" && SWARM_DIR=. bash "$G" stats 2>&1)
tl() { grep -E "^stats: $1 .*first-attempt=.* elapsed=[^ ]+ codex=$2 second=$3\$" <<<"$st" >/dev/null; }
chk "T s1 (attempt 2): line ends 'codex=PASS second=PASS'" 'tl s1 PASS PASS'
chk "T s1 first attempt counts the Codex FAIL (failed)" 'grep -E "^stats: s1 " <<<"$st" | grep -q "first-attempt=1 failed"'
chk "T s2: codex=skip:quota second=FAIL" 'tl s2 skip:quota FAIL'
chk "T s3: codex=none second=PASS" 'tl s3 none PASS'
chk "T s5: codex=FAIL second=FAIL" 'tl s5 FAIL FAIL'
chk "T s6: codex=FAIL second=none" 'tl s6 FAIL none'
chk "T s7: an invalid skip record is none" 'tl s7 none PASS'
chk "T s8: a verdict wins over a skip record" 'tl s8 PASS none'
chk "T s9 no-change line unchanged" 'grep -qx "stats: s9 tier=2 no-change (excluded)" <<<"$st"'
chk "T summary: codex: ran 5/6, FAIL 3, same-verdict-as-second 2, codex-only FAIL 2" 'grep -qx "codex: ran 5/6, FAIL 3, same-verdict-as-second 2, codex-only FAIL 2" <<<"$st"'
chk "T the codex line follows the existing summary lines" 'grep -A1 "^elapsed total:" <<<"$st" | tail -1 | grep -q "^codex: "'
[[ $NFAIL == 0 ]] || { echo "#     stats output:"; sed 's/^/#       /' <<<"$st"; }
d="$WORK/t0"; mkdir -p "$d/verdicts" "$d/manifests"; printf '# h\nz\t2\ttests\tchecking\t1\tw\tr\n' > "$d/ledger.tsv"
st0=$(cd "$d" && SWARM_DIR=. bash "$G" stats 2>&1)
chk "T no Codex evidence: codex: ran 0/0, FAIL 0, same-verdict-as-second 0, codex-only FAIL 0" 'grep -qx "codex: ran 0/0, FAIL 0, same-verdict-as-second 0, codex-only FAIL 0" <<<"$st0"'
chk "T a no-evidence line is unchanged" 'grep -qx "stats: z tier=2 no evidence yet (status=checking)" <<<"$st0"'

# --- I: integration — the real harness (stub Codex) → the gate --------------------
STUB="$HERE/../CD1/stub-codex"
mkdir -p "$WORK/bin"; cp "$STUB" "$WORK/bin/codex"; chmod +x "$WORK/bin/codex"
FA="$WORK/fake-auth.json"; printf '{"tokens":{"access_token":"tok_FAKE_SECRET_0123456789abcdefXYZ"}}\n' > "$FA"
integ() {                                    # scenario -> dir with a gate fixture whose row i1 carries the harness output
  local scen="$1" d="$WORK/i-$1"
  mkdir -p "$d/tree/src" "$d/sw/verdicts" "$d/sw/manifests" "$d/sw/codex" "$d/sw/flags"
  ( cd "$d/tree" && git init -q && git config user.email o@o && git config user.name o && echo app > src/app.txt && git add -A && git commit -qm fx )
  echo src/app.txt > "$d/sw/manifests/i1.1.files"; ( cd "$d/tree" && sha256sum src/app.txt ) > "$d/sw/manifests/i1.1.sha256"
  : > "$d/sw/codex.exclude"; printf 'Criteria.\nSTUB-SCENARIO: %s\nHOSTPROBE-PORT: 1\nHOSTIPS: \n' "$scen" > "$d/sw/codex/i1.1.criteria.md"
  printf '# h\ni1\t2\ttests,second,codex\taccepted\t1\tw\tr\n' > "$d/sw/ledger.tsv"
  ms=$(sha256sum < "$d/sw/manifests/i1.1.sha256" | cut -d' ' -f1)
  printf 'VERDICT: PASS\nCHECKER: checker-tests\nFAMILY: anthropic\nTASK: i1\nATTEMPT: 1\nMANIFEST_SHA256: %s\n---\ne\n' "$ms" > "$d/sw/verdicts/i1.1.checker-tests.verdict"
  printf 'VERDICT: PASS\nCHECKER: checker-second\nFAMILY: adversarial\nTASK: i1\nATTEMPT: 1\nMANIFEST_SHA256: %s\n---\ne\n' "$ms" > "$d/sw/verdicts/i1.1.checker-second.verdict"
  ( cd "$TREE" && SWARM_DIR="$d/sw" SWARM_TREE="$d/tree" CODEX_BIN="$WORK/bin/codex" CODEX_AUTH="$FA" CODEX_TIMEOUT=300 \
      flock "$LOCK" bash swarm/codex-check.sh i1 1 ) > "$d/harness.log" 2>&1
  echo "$d"
}
gchk() { (cd "$1" && SWARM_DIR=sw SWARM_TREE=tree bash "$G" check i1) > "$1/gate.log" 2>&1; }
d=$(integ pass); gchk "$d"; r=$?
chk "I a harness-written Codex PASS verdict is accepted by the gate" '[[ -f $d/sw/verdicts/i1.1.checker-codex.verdict && $r == 0 ]]'
[[ $r == 0 ]] || echo "#     $(tail -2 "$d/gate.log" | tr '\n' ' ') :: $(tail -2 "$d/harness.log" | tr '\n' ' ')"
d=$(integ quota); gchk "$d"; r=$?
chk "I a harness-written skip record satisfies 'codex' (accepted)" '[[ -f $d/sw/verdicts/i1.1.checker-codex.skip && $r == 0 ]]'
d=$(integ fail); gchk "$d"; r=$?
chk "I a harness-written Codex FAIL is refused by the gate" '[[ -f $d/sw/verdicts/i1.1.checker-codex.verdict && $r == 1 ]]'
for id in $(docker images -f dangling=true -q 2>/dev/null); do grep -q tinyproxy <<<"$(docker image inspect "$id" --format '{{json .Config.Cmd}}' 2>/dev/null)" && docker rmi "$id" >/dev/null 2>&1; done

# --- F: docs (whitespace-normalised: statements may wrap) ---------------------------------
norm() { tr '\n\t' '  ' < "$1" | tr -s ' '; }
NC=$(norm "$TREE/CLAUDE.md"); NT=$(norm "$TREE/TIERS.md"); NR=$(norm "$TREE/README.md")
has()  { grep -qiE -- "$2" <<<"$1"; }
# every occurrence of PATTERN, with WIDTH chars either side, mentions codex (or the phrase is gone)
allc() { local w; w=$(grep -oiE -- ".{0,$3}($2).{0,$3}" <<<"$1") || return 0; ! grep -vqi codex <<<"$w"; }
T1=$(sed -n '/^### Tier 1/,/^### Tier 2/p' "$TREE/CLAUDE.md" | tr '\n' ' ')
chk "F1 CLAUDE.md: name codex beside second" 'has "$NC" "\`codex\`" && has "$NC" "(beside|alongside|next to|with) .{0,20}\`?second|\`?second\`? .{0,20}(beside|alongside|and \`?codex)"'
chk "F2 CLAUDE.md: the trial rule (a Codex FAIL counts, a PASS never does)" 'has "$NC" "codex.{0,20}fail.{0,20}counts" && has "$NC" "pass.{0,30}never"'
chk "F3 CLAUDE.md: codex-check.sh and the criteria file" 'has "$NC" "swarm/codex-check\.sh" && has "$NC" "\.criteria\.md"'
chk "F4 CLAUDE.md: the lead never writes a Codex verdict or skip record" 'grep -oiE "never (writes?|transcribes?).{0,120}" <<<"$NC" | grep -i codex | grep -qi skip'
chk "F5 CLAUDE.md: Phase 0 .swarm/codex.exclude; budget2 PLANNING_LOG.md; agents2 docs/runs/ and *.png" 'has "$NC" "\.swarm/codex\.exclude" && has "$NC" "PLANNING_LOG\.md" && has "$NC" "docs/runs/" && has "$NC" "\*\.png"'
chk "F6 CLAUDE.md: codex joins the attribution mechanisms; the codex: stats line is reported" 'grep -oiE "\([^)]*oracle / [^)]*\)" <<<"$NC" | grep -qi codex && has "$NC" "codex:"'
chk "F7 CLAUDE.md: .swarm/codex/** is never archived verbatim" 'grep -oiE ".{0,200}\.swarm/codex/.{0,200}" <<<"$NC" | grep -qiE "verbatim|never archiv"'
chk "F8 CLAUDE.md: the fail-closed critical-glob rule" 'has "$NC" "critical-glob-unreadable"'
chk "F9 CLAUDE.md: valid FAMILY values include crossvendor" 'grep -oiE "valid .?FAMILY.? values.{0,300}" <<<"$NC" | grep -qi crossvendor'
chk "F10 CLAUDE.md: 'PASS from every named checker' carries the codex exception" 'allc "$NC" "every named checker|PASS from EVERY" 150'
chk "F11 CLAUDE.md: the Tier-1 section says codex does not count as a named checker" 'grep -qi codex <<<"$T1"'
chk "F12 CLAUDE.md: the Phase-0 mkdir line creates .swarm/codex" 'grep -qE "^mkdir -p .*\.swarm/codex( |$)" "$TREE/CLAUDE.md"'
chk "F13 CLAUDE.md: no unqualified 'all lanes/agents on Claude'" 'allc "$NC" "all (lanes|agents|roles)( run)? on Claude" 200'
chk "F14 CLAUDE.md: re-run codex-check.sh when it cannot record an outcome" 'has "$NC" "(exit 1|killed).{0,200}re-?run|re-?run.{0,200}(exit 1|killed)"'
chk "F15 TIERS.md: the Codex lane and the trial rule" 'has "$NT" "codex" && has "$NT" "codex.{0,20}fail.{0,20}counts" && has "$NT" "pass.{0,30}never"'
chk "F16 TIERS.md: 'a PASS from every one named' carries the codex exception" 'allc "$NT" "PASS from every one named" 150'
chk "F17 TIERS.md: an unreadable critical.globs fails closed" 'has "$NT" "unreadable"'
chk "F18 README: no 'no second vendor'; the Codex lane is named" '! has "$NR" "no second vendor" && has "$NR" "codex" && has "$NR" "trial"'
chk "F19 README: 'authenticates the same way' is qualified for Codex" 'allc "$NR" "authenticates the same way" 200'
chk "F20 README: 'not a second vendor' is gone or qualified" 'allc "$NR" "not a second vendor" 150'
chk "F21 README: no unqualified 'All lanes run on Claude'" 'allc "$NR" "all (lanes|agents|roles)( run)? on Claude" 200'
chk "F22 README: the inline escalation triggers are no longer listed as unmirrored" '! grep -oiE "not mirrored.{0,200}" <<<"$NR" | grep -qi "escalation trigger"'
chk "F23 doc_test.sh passes on the tree" 'bash "$TREE/smoketest/doc_test.sh" 2>&1 | tail -1 | grep -qx "ALL PASS"'
db="$WORK/docbase"; mkdir -p "$db/smoketest"; cp "$TREE/smoketest/doc_test.sh" "$db/smoketest/"; cp "$HERE/base-docs/CLAUDE.md" "$HERE/base-docs/TIERS.md" "$HERE/base-docs/README.md" "$db/"
bash "$db/smoketest/doc_test.sh" > "$WORK/docbase.log" 2>&1; dbrc=$?
chk "F24 doc_test.sh pins fail against the pre-CD4 docs (>=5 FAIL lines)" '[[ $dbrc != 0 ]] && (( $(grep -c "^FAIL" "$WORK/docbase.log") >= 5 ))'

# --- C: consumers --------------------------------------------------------------------------
chk "C1 smoketest/gate/run_tests.sh passes" '(cd "$TREE" && bash smoketest/gate/run_tests.sh) > "$WORK/rt.log" 2>&1 && ! grep -qE "^(FAIL|not ok)" "$WORK/rt.log"'
if (cd "$TREE" && node --test dashboard/test/*.test.mjs) > "$WORK/node.log" 2>&1 && grep -qE '^ℹ fail 0$' "$WORK/node.log"; then ok "C2 dashboard tests pass ($(grep -E '^ℹ tests' "$WORK/node.log"))"
else bad "C2 dashboard tests: $(grep -E '^ℹ (tests|fail)' "$WORK/node.log" | tr '\n' ' ')"; fi

# --- M: the shipped tests catch the pre-CD4 behaviour -----------------------------------
mk() { local d="$WORK/$1"; mkdir -p "$d"; rsync -a --exclude .git --exclude .swarm --exclude '.swarm-*' "$TREE/" "$d/"; echo "$d"; }
m1=$(mk m1); cp "$HERE/base-gate.sh" "$m1/swarm/gate.sh"
if (cd "$m1" && bash smoketest/gate/run_tests.sh) > "$WORK/m1.log" 2>&1; then bad "M1 smoketest suite still passes against the pre-CD4 gate.sh"
elif grep -E '^FAIL' "$WORK/m1.log" | grep -qi codex; then ok "M1 smoketest suite fails against the pre-CD4 gate.sh, on Codex tests"
else bad "M1 fails against the pre-CD4 gate, but not on a Codex test"; fi
m2=$(mk m2); cp "$HERE/base-parse.mjs" "$m2/dashboard/lib/parse.mjs"
(cd "$m2" && node --test dashboard/test/*.test.mjs) > "$WORK/m2.log" 2>&1
mf=$(grep -oE '^ℹ fail [0-9]+' "$WORK/m2.log" | grep -oE '[0-9]+$')
chk "M2 dashboard suite fails against the pre-CD4 parse.mjs, on Codex tests" '[[ -n "$mf" && "$mf" -gt 0 ]] && grep -qi codex "$WORK/m2.log"'

if (( NFAIL == 0 )); then echo "ORACLE PASS"; exit 0; fi
echo "ORACLE FAIL: $NFAIL check(s) failed"; exit 1
