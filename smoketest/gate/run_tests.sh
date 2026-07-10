#!/usr/bin/env bash
# Runs every deterministic smoketest (no LLM calls, no gateway): gate unit tests,
# agent-contract greps, tier3 worktree scripts, doc greps, and fixture structure.
set -u
d="$(dirname "$0")"; root="$d/.."; rc=0
run(){ echo "== $1 =="; bash "$2" || rc=1; }
run run_check.sh     "$d/run_check.sh"
run run_escalate.sh  "$d/run_escalate.sh"
run run_done.sh      "$d/run_done.sh"
run agents_test.sh   "$d/agents_test.sh"
run tier3_test.sh    "$d/tier3_test.sh"
run doc_test.sh      "$root/doc_test.sh"
run verify_layout.sh "$root/verify_layout.sh"
run checker-evals    "$root/checker-evals/verify_fixtures.sh"
run e2e              "$root/e2e/verify_fixture.sh"
exit $rc
