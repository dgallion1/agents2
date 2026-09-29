#!/usr/bin/env bash
# GH1 oracle — land the 2026-09-18 gate hardening (SPEC.md §4).
#
# Usage: accept.sh [TREE]      TREE = candidate agents2 tree (default: the
#                              repo this .swarm belongs to)
#        BASE=<ref> accept.sh  git ref the change set is measured against
#                              (default cae89ff)
#
# Gate probes build throwaway .swarm fixtures and run TREE's swarm/gate.sh.
# Every negative case (a bypass) must exit 1 naming its defect; every positive
# control must exit 0, so a failure is the defect and not the harness. Prints
# "ORACLE PASS" as its last line only when every check passes.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TREE="$(cd "${1:-$HERE/../../..}" && pwd)"
BASE="${BASE:-cae89ff}"
GATE="$TREE/swarm/gate.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/gh1-oracle.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
NFAIL=0
ok()  { echo "ok   - $*"; }
bad() { echo "FAIL - $*"; NFAIL=$((NFAIL+1)); }
echo "# GH1 oracle: TREE=$TREE BASE=$BASE"

# --- fixture helpers ----------------------------------------------------------
fx() {                                    # name -> fixture dir (tree + .swarm)
  local d="$WORK/$1"
  mkdir -p "$d/src" "$d/.swarm/verdicts" "$d/.swarm/manifests" "$d/.swarm/flags" "$d/.swarm/tier3"
  echo alpha > "$d/src/a.txt"
  printf '# task_id\ttier\tchecks\tstatus\tattempt\tworker\treason\n' > "$d/.swarm/ledger.tsv"
  echo "$d"
}
row() { printf '%s\t%s\t%s\tchecking\t1\tworker-coder\tprobe\n' "$2" "$3" "$4" >> "$1/.swarm/ledger.tsv"; }  # dir task tier checks
fp() {                                    # dir task [paths...] — manifest + sha256 sidecar, attempt 1
  local d="$1" t="$2"; shift 2
  local -a paths=("$@"); (( ${#paths[@]} )) || paths=(src/a.txt)
  printf '%s\n' "${paths[@]}" > "$d/.swarm/manifests/$t.1.files"
  ( cd "$d" && for p in "${paths[@]}"; do
      if [[ -e "$p" ]]; then sha256sum "$p"; else echo "deleted  $p"; fi
    done ) > "$d/.swarm/manifests/$t.1.sha256"
}
ms() { sha256sum "$1/.swarm/manifests/$2.1.sha256" | cut -d' ' -f1; }        # dir task
vd() {                                    # dir task checker family verdict [manifest_sha]
  local d="$1" t="$2" c="$3" fam="$4" v="$5" m="${6:-}"
  { echo "VERDICT: $v"; echo "CHECKER: $c"; echo "FAMILY: $fam"
    echo "TASK: $t"; echo "ATTEMPT: 1"
    [[ -n "$m" ]] && echo "MANIFEST_SHA256: $m"
    echo "---"; echo "probe evidence"; } > "$d/.swarm/verdicts/$t.1.$c.verdict"
}
oracle3() {                               # dir task — executable oracle + passing log
  mkdir -p "$1/.swarm/tier3/$2"
  printf '#!/bin/sh\necho ORACLE PASS\n' > "$1/.swarm/tier3/$2/accept.sh"
  chmod +x "$1/.swarm/tier3/$2/accept.sh"
  printf 'probe\nORACLE PASS\n' > "$1/.swarm/tier3/$2/oracle.1.log"
}
run_gate() { OUT=$(cd "$1" && SWARM_DIR=.swarm SWARM_TREE=. bash "$GATE" "${@:2}" 2>&1); RC=$?; }
expect_ok() {                             # label dir task
  run_gate "$2" check "$3"
  if (( RC == 0 )); then ok "$1"; else bad "$1 (want exit 0, got $RC: $OUT)"; fi
}
expect_fail() {                           # label dir task fragment
  run_gate "$2" check "$3"
  if (( RC == 1 )) && grep -qiF -- "$4" <<<"$OUT"; then ok "$1"
  else bad "$1 (want exit 1 naming '$4', got $RC: $OUT)"; fi
}

# --- P0: the source snapshot is the one signed off ----------------------------
if (cd "$HERE" && sha256sum -c --quiet source.sha256 >/dev/null 2>&1); then
  ok "P0 source snapshot matches source.sha256"
else
  bad "P0 source snapshot changed since sign-off (source.sha256 mismatch)"
fi
[[ -f "$GATE" ]] || { bad "no gate at $GATE"; echo "ORACLE FAIL: $NFAIL check(s) failed"; exit 1; }

# --- P1: tier 3 honours the named checkers (gap 1) ----------------------------
d=$(fx p1); row "$d" T3 3 tests,second,a11y; fp "$d" T3; oracle3 "$d" T3; m=$(ms "$d" T3)
vd "$d" T3 checker-tests anthropic PASS "$m"; vd "$d" T3 checker-second adversarial PASS "$m"
expect_fail "P1 tier-3 row whose named checker-a11y never ran is refused" "$d" T3 "checker-a11y"
vd "$d" T3 checker-a11y anthropic PASS "$m"
expect_ok "P1 control: every named tier-3 checker PASS across two lanes accepts" "$d" T3

# --- P2: critical-glob trigger is enforced inline (gap 2) ---------------------
d=$(fx p2); mkdir -p "$d/swarm"; echo x > "$d/swarm/x.sh"
row "$d" T2 2 tests; fp "$d" T2 swarm/x.sh; m=$(ms "$d" T2)
vd "$d" T2 checker-tests anthropic PASS "$m"
echo 'swarm/**' > "$d/.swarm/critical.globs"
expect_fail "P2 critical-glob manifest with no flag is refused until escalate-scan" "$d" T2 "escalate-scan"
echo 'nomatch/**' > "$d/.swarm/critical.globs"
expect_ok "P2 control: same row without a critical-glob hit accepts" "$d" T2

# --- P3: tier 1 blank checks column (gap 3) -----------------------------------
d=$(fx p3); row "$d" T1 1 -; fp "$d" T1
expect_fail "P3 tier-1 row with a blank checks column is refused" "$d" T1 "requires named checkers"
d=$(fx p3c); row "$d" T1 1 tests; fp "$d" T1; vd "$d" T1 checker-tests anthropic PASS "$(ms "$d" T1)"
expect_ok "P3 control: tier-1 row with a named checker PASS accepts" "$d" T1

# --- P4: legacy blind-arm contract removed (gap 4) ----------------------------
d=$(fx p4); row "$d" T4 3 tests,second; fp "$d" T4; m=$(ms "$d" T4)
vd "$d" T4 checker-tests anthropic PASS "$m"; vd "$d" T4 checker-second adversarial PASS "$m"
mkdir -p "$d/.swarm/tier3/T4"; printf 'RESOLUTION: arms agree\n' > "$d/.swarm/tier3/T4/report.md"
expect_fail "P4 stale blind-arm report.md cannot stand in for the oracle" "$d" T4 "report.md"
rm -f "$d/.swarm/tier3/T4/report.md"; oracle3 "$d" T4
expect_ok "P4 control: the oracle contract accepts" "$d" T4
for f in swarm/tier3-setup.sh swarm/tier3-compare.sh smoketest/gate/tier3_test.sh; do
  if [[ ! -e "$TREE/$f" ]]; then ok "P4 $f deleted"; else bad "P4 $f still ships"; fi
done
refs=$(cd "$TREE" && grep -rlE 'tier3-setup\.sh|tier3-compare\.sh|tier3_test\.sh' . \
        --exclude-dir=.git --exclude-dir=.swarm --exclude-dir=node_modules 2>/dev/null \
      | sed 's#^\./##' | grep -vE '^(docs/runs/|docs/superpowers/|SPEC\.md$)' || true)
if [[ -z "$refs" ]]; then ok "P4 nothing outside docs/runs and docs/superpowers (history) references the blind-arm scripts"
else bad "P4 blind-arm scripts still referenced: $(tr '\n' ' ' <<<"$refs")"; fi

# --- P5: source fingerprints (gap 5) ------------------------------------------
d=$(fx p5a); row "$d" T5 2 tests; fp "$d" T5; vd "$d" T5 checker-tests anthropic PASS "$(ms "$d" T5)"
expect_ok "P5 control: fingerprinted, verified, untouched tree accepts" "$d" T5
echo tampered >> "$d/src/a.txt"
expect_fail "P5a tree drift after fingerprinting is refused" "$d" T5 "drift"

d=$(fx p5b); row "$d" T5 2 tests; fp "$d" T5
vd "$d" T5 checker-tests anthropic PASS "$(printf '0%.0s' {1..64})"
expect_fail "P5b PASS whose MANIFEST_SHA256 names another fingerprint set is refused" "$d" T5 "sidecar hashes"

d=$(fx p5c); row "$d" T5 2 tests; fp "$d" T5; vd "$d" T5 checker-tests anthropic PASS "$(ms "$d" T5)"
rm -f "$d/.swarm/manifests/T5.1.sha256"
expect_fail "P5c missing fingerprint sidecar is refused" "$d" T5 "sidecar"

d=$(fx p5d); row "$d" T5 2 tests; fp "$d" T5 src/a.txt src/gone.txt
vd "$d" T5 checker-tests anthropic PASS "$(ms "$d" T5)"
expect_ok "P5d control: a path fingerprinted as deleted and absent accepts" "$d" T5
echo back > "$d/src/gone.txt"
expect_fail "P5d a path fingerprinted as deleted but present is refused" "$d" T5 "deleted"

d=$(fx p5e); row "$d" T5 2 tests; fp "$d" T5; vd "$d" T5 checker-tests anthropic PASS
expect_fail "P5e checker PASS without MANIFEST_SHA256 is refused" "$d" T5 "MANIFEST_SHA256"

d=$(fx p5f); row "$d" T5 2 tests; vd "$d" T5 checker-tests anthropic PASS "$(printf '0%.0s' {1..64})"
expect_fail "P5f row with no manifest is refused" "$d" T5 "manifest"

# --- P7: stats (gap 7) --------------------------------------------------------
d=$(fx p7); row "$d" T7 2 tests; row "$d" T8 2 tests; fp "$d" T7; fp "$d" T8
vd "$d" T7 checker-tests anthropic FAIL
vd "$d" T7 judge-claude anthropic OVERRULE; vd "$d" T7 judge-standards adversarial OVERRULE
vd "$d" T7 judge-impact impact UPHOLD
vd "$d" T8 checker-tests anthropic FAIL
vd "$d" T8 judge-claude anthropic UPHOLD; vd "$d" T8 judge-standards adversarial UPHOLD
vd "$d" T8 judge-impact impact OVERRULE
run_gate "$d" stats
if (( RC == 0 )); then ok "P7 stats exits 0"; else bad "P7 stats exit $RC: $OUT"; fi
if grep -E '^stats: T7 ' <<<"$OUT" | grep -q 'fail-overruled'; then ok "P7 overruled first-attempt FAIL is labelled fail-overruled"
else bad "P7 T7 line lacks fail-overruled: $(grep -E '^stats: T7 ' <<<"$OUT")"; fi
if grep -E '^stats: T8 ' <<<"$OUT" | grep -q ' failed' && ! grep -E '^stats: T8 ' <<<"$OUT" | grep -q 'fail-overruled'
then ok "P7 control: an upheld first-attempt FAIL stays failed"
else bad "P7 T8 line should be failed: $(grep -E '^stats: T8 ' <<<"$OUT")"; fi
if grep -qx 'first-attempt clean: 1/2 (no-evidence rows: 0)' <<<"$OUT"; then ok "P7 summary counts the overruled FAIL as clean (1/2)"
else bad "P7 summary: $(grep 'first-attempt clean' <<<"$OUT")"; fi
if grep -qE '^escalated: [0-9]+/[0-9]+$' <<<"$OUT"; then ok "P7 stats reports escalated: n/m"
else bad "P7 no 'escalated: n/m' line"; fi

# --- C: every consumer of the contract ----------------------------------------
if (cd "$TREE" && bash smoketest/gate/run_tests.sh) > "$WORK/run_tests.log" 2>&1 \
   && ! grep -qE '^(FAIL|not ok)' "$WORK/run_tests.log"; then
  ok "C1 smoketest/gate/run_tests.sh passes"
else bad "C1 run_tests.sh: $(grep -E '^(FAIL|not ok|[0-9]+ FAILED)' "$WORK/run_tests.log" | head -5 | tr '\n' ' ')"; fi

if (cd "$TREE" && node --test dashboard/test/*.test.mjs) > "$WORK/node.log" 2>&1 \
   && grep -qE '^ℹ fail 0$' "$WORK/node.log"; then
  ok "C2 dashboard tests pass ($(grep -E '^ℹ tests' "$WORK/node.log"))"
else bad "C2 dashboard tests: $(grep -E '^ℹ (tests|fail)' "$WORK/node.log" | tr '\n' ' ')"; fi

for a in worker-coder worker-local; do
  if grep -qF '.sha256' "$TREE/.claude/agents/$a.md"; then ok "C3 $a brief tells the worker to write the .sha256 sidecar"
  else bad "C3 $a brief never mentions the .sha256 sidecar"; fi
done
for a in checker-a11y checker-content checker-second checker-tests; do
  if grep -qF 'MANIFEST_SHA256' "$TREE/.claude/agents/$a.md"; then ok "C3 $a brief requires MANIFEST_SHA256"
  else bad "C3 $a brief never mentions MANIFEST_SHA256"; fi
done

python3 - "$HERE/master-CLAUDE.md" "$TREE/CLAUDE.md" "$HERE/source.patch" <<'PY' > "$WORK/claude.log"
import sys, re
master, new, patch = (open(p).read() for p in sys.argv[1:4])
def section(text, heading):
    i = text.index(heading); j = text.find('\n## ', i + 1)
    return text[i:] if j < 0 else text[i:j + 1]
def bullet(text, start):
    i = text.index(start); j = text.find('\n- ', i + 1)
    return text[i:j + 1]
checks = [
  ("E1 master's Superpowers section kept verbatim", section(master, '## Superpowers skills — front half only') in new),
  ("E2 master's Resume, don't re-dispatch paragraph kept verbatim", bullet(master, "- **Resume, don't re-dispatch") in new),
]
m = re.search(r'^diff --git a/CLAUDE\.md b/CLAUDE\.md\n(.*?)(?=^diff --git |\Z)', patch, re.S | re.M)
hunks = m.group(1)
added   = [l[1:] for l in hunks.splitlines() if l.startswith('+') and not l.startswith('+++')]
removed = [l[1:] for l in hunks.splitlines() if l.startswith('-') and not l.startswith('---')]
newlines = set(new.splitlines())
miss = [l for l in added if l.strip() and l not in newlines]
checks.append((f"E3 every source-added CLAUDE.md line present ({len(added)} lines)", not miss))
stale = [l for l in removed if len(l.strip()) > 30 and l not in added and l in newlines]
checks.append((f"E4 no source-removed CLAUDE.md line survives ({len(removed)} lines)", not stale))
for label, good in checks:
    print(("ok   - " if good else "FAIL - ") + label)
for l in miss[:5]:  print("       missing: " + l)
for l in stale[:5]: print("       stale:   " + l)
PY
cat "$WORK/claude.log"; NFAIL=$(( NFAIL + $(grep -c '^FAIL' "$WORK/claude.log") ))

# --- F: the changed-file set equals the source's (criterion f) ----------------
if git -C "$TREE" rev-parse --verify -q "$BASE^{commit}" >/dev/null; then
  want=$( { grep -E '^diff --git a/' "$HERE/source.patch" | sed -E 's#^diff --git a/(.*) b/.*#\1#'
            cat "$HERE/source-untracked.txt"; } | sort -u )
  have=$( { git -C "$TREE" diff --no-renames --name-only "$BASE"
            git -C "$TREE" ls-files --others --exclude-standard; } | grep -vx 'SPEC.md' | sort -u )
  if [[ "$want" == "$have" ]]; then ok "F changed-file set equals the source's ($(wc -l <<<"$want") files; SPEC.md is the lead's)"
  else bad "F changed-file set differs: $(diff <(echo "$want") <(echo "$have") | grep -E '^[<>]' | tr '\n' ' ')"; fi
else
  bad "F base $BASE not found in $TREE"
fi

if (( NFAIL == 0 )); then echo "ORACLE PASS"; exit 0; fi
echo "ORACLE FAIL: $NFAIL check(s) failed"; exit 1
