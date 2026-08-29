#!/usr/bin/env bash
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"; FAILN=0
has() { if grep -qi "$3" "$root/$1"; then echo "ok   - $1: $2"; else echo "FAIL - $1: $2"; FAILN=$((FAILN+1)); fi; }

has TIERS.md "oracle question"      "oracle"
has TIERS.md "reversible question"  "reversible"
has TIERS.md "blast radius question" "blast radius"
has TIERS.md "round-up tie-break"   "round up"
has TIERS.md "critical.globs"       "critical.globs"
has TIERS.md "test-code exemption glob" "test.globs"

has CLAUDE.md "gate.sh check hard rule"  "gate.sh check"
has CLAUDE.md "gate.sh done hard rule"   "gate.sh done"
has CLAUDE.md "escalate-scan loop"       "escalate-scan"
has CLAUDE.md "judge panel on disputes"  "judge-claude"
has CLAUDE.md "tier 3 oracle contract"   "accept.sh"
has CLAUDE.md "tier 3 oracle pass marker" "ORACLE PASS"
has CLAUDE.md "points at the smoketest suite" "smoketest/gate/run_tests.sh"

has README.md "documents tiers"          "Verification tiers"
has README.md "points at gate tests"     "run_tests.sh"

(( FAILN==0 )) && { echo "ALL PASS"; exit 0; } || { echo "$FAILN FAILED"; exit 1; }
