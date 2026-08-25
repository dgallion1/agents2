#!/usr/bin/env bash
set -u
. "$(dirname "$0")/_lib.sh"

# D1: all accepted WITH valid evidence -> done rc 0
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\taccepted\t0\tworker-coder\t-\nb\t2\tcontent\taccepted\t0\tworker-coder\t-\n'
mkverdict "$sd" a 0 checker-content PASS anthropic
mkverdict "$sd" b 0 checker-content PASS anthropic
mkverdict "$sd" b 0 checker-second  PASS glm
run_gate "$sd" done; assert_rc "all accepted + evidence -> done ok" 0 $?

# D2: one task still pending -> done rc 1
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\taccepted\t0\tworker-coder\t-\nb\t2\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" a 0 checker-content PASS anthropic
run_gate "$sd" done; assert_rc "pending task -> done fails" 1 $?

# D3: accepted but an UNRESOLVED flag (tier<target) -> done rc 1
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\taccepted\t0\tworker-coder\t-\n'
mkverdict "$sd" a 0 checker-content PASS anthropic
printf 'TARGET_TIER: 2\nREASON: critical-glob\n' > "$sd/flags/a.flag"
run_gate "$sd" done; assert_rc "unresolved flag -> done fails" 1 $?

# D4: accepted with a RESOLVED flag (tier>=target) + evidence -> done rc 0
sd=$(newswarm)
mkledger "$sd" 'a\t2\tcontent\taccepted\t0\tworker-coder\t-\n'
mkverdict "$sd" a 0 checker-content PASS anthropic
mkverdict "$sd" a 0 checker-second  PASS glm
printf 'TARGET_TIER: 2\nREASON: critical-glob\n' > "$sd/flags/a.flag"
run_gate "$sd" done; assert_rc "resolved flag + evidence -> done ok" 0 $?

# D5: ledger says accepted but zero verdict files -> done rc 1
sd=$(newswarm)
mkledger "$sd" 'a\t2\tcontent\taccepted\t1\tworker-coder\t-\n'
run_gate "$sd" done; assert_rc "accepted without evidence -> done fails" 1 $?

# D6: accepted with incomplete/malformed verdicts -> done rc 1
sd=$(newswarm)
mkledger "$sd" 'a\t2\tcontent\taccepted\t1\tworker-coder\t-\n'
printf 'VERDICT: PASS\nFAMILY: anthropic\n' > "$sd/verdicts/a.1.x.verdict"
printf 'VERDICT: PASS\nFAMILY: glm\n' > "$sd/verdicts/a.1.y.verdict"
run_gate "$sd" done; assert_rc "accepted with malformed verdicts -> done fails" 1 $?

# D7: no-change row with reason containing see-SPEC -> done rc 0, visible line
sd=$(newswarm)
mkledger "$sd" 'R9\t1\tcontent\tno-change\t0\tworker-coder\tno-defect-found-root-cause-was-lead-shared-tree-see-SPEC\n'
out=$(SWARM_DIR="$sd" bash "$GATE" done 2>&1); rc=$?
assert_rc "no-change (see-SPEC) -> done ok" 0 $rc
echo "$out" | grep -qF "no-change: R9 (no-defect-found-root-cause-was-lead-shared-tree-see-SPEC)" \
  && echo "ok   - no-change (see-SPEC) line is visible in done output" \
  || { echo "FAIL - no-change (see-SPEC) line is visible in done output"; FAILN=$((FAILN+1)); }

# D8: no-change row with reason containing ruling-YYYY-MM-DD[letter] -> done rc 0, visible line
sd=$(newswarm)
mkledger "$sd" 'R9\t1\tcontent\tno-change\t0\tworker-coder\tno-defect-found-root-cause-was-lead-shared-tree-ruling-2026-08-20d\n'
out=$(SWARM_DIR="$sd" bash "$GATE" done 2>&1); rc=$?
assert_rc "no-change (ruling-2026-08-20d) -> done ok" 0 $rc
echo "$out" | grep -qF "no-change: R9 (no-defect-found-root-cause-was-lead-shared-tree-ruling-2026-08-20d)" \
  && echo "ok   - no-change (ruling) line is visible in done output" \
  || { echo "FAIL - no-change (ruling) line is visible in done output"; FAILN=$((FAILN+1)); }


# D8b: bare ruling date (no trailing letter). Grafted from the alt arm.
sd=$(newswarm)
mkledger "$sd" 'R9\t1\tcontent\tno-change\t0\tworker-coder\tno-defect-found-root-cause-was-lead-shared-tree-ruling-2026-08-20\n'
run_gate "$sd" done; assert_rc "no-change (ruling-2026-08-20, no letter) -> done ok" 0 $?

# D9: no-change row whose reason has neither token -> done rc 1
sd=$(newswarm)
mkledger "$sd" 'R9\t1\tcontent\tno-change\t0\tworker-coder\tno-defect-found-root-cause-was-lead-shared-tree\n'
run_gate "$sd" done; assert_rc "no-change without justification -> done fails" 1 $?

# D10: no-change row whose attempt has a verdict file on disk -> done rc 1
sd=$(newswarm)
mkledger "$sd" 'R9\t1\tcontent\tno-change\t0\tworker-coder\tno-defect-found-root-cause-was-lead-shared-tree-see-SPEC\n'
mkverdict "$sd" R9 0 checker-content FAIL anthropic
run_gate "$sd" done; assert_rc "no-change with verdict file present -> done fails" 1 $?

# D11: accepted row alongside a terminal no-change row -> both validated, done rc 0
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\taccepted\t0\tworker-coder\t-\nR9\t1\tcontent\tno-change\t0\tworker-coder\tno-defect-found-root-cause-was-lead-shared-tree-see-SPEC\n'
mkverdict "$sd" a 0 checker-content PASS anthropic
run_gate "$sd" done; assert_rc "accepted + no-change together -> done ok" 0 $?

# D12: accepted row alongside a no-change row that lacks justification -> done rc 1
# (the accepted row must still be fully validated even though the other row fails)
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\taccepted\t0\tworker-coder\t-\nR9\t1\tcontent\tno-change\t0\tworker-coder\tno-defect-found\n'
mkverdict "$sd" a 0 checker-content PASS anthropic
run_gate "$sd" done; assert_rc "accepted + unjustified no-change -> done fails" 1 $?

# D13: no-change row with an unresolved escalation flag -> done rc 1. Closing
# the row must not let `done` print "no unresolved flags" while a flag file
# still sits on disk.
sd=$(newswarm)
mkledger "$sd" 'T1\t1\ttests\tno-change\t1\tw\tno-defect-see-SPEC\n'
printf 'TARGET_TIER: 3\nREASON: two-consecutive-fails\n' > "$sd/flags/T1.flag"
run_gate "$sd" done; assert_rc "no-change with unresolved flag -> done fails" 1 $?

# D14: no-change row whose reason has NO verdict at its own (current) attempt
# but DOES have a FAIL verdict at an older attempt -> done rc 1. Bumping the
# ledger's attempt column must not walk away from a recorded FAIL.
sd=$(newswarm)
mkledger "$sd" 'T2\t1\ttests\tno-change\t2\tw\tno-defect-see-SPEC\n'
mkverdict "$sd" T2 1 checker-tests FAIL anthropic
run_gate "$sd" done; assert_rc "no-change with FAIL verdict at other attempt -> done fails" 1 $?

# D15: "see-SPEC" must match as a hyphen-delimited token, not a bare substring.
sd=$(newswarm)
mkledger "$sd" 'T3\t1\ttests\tno-change\t1\tw\tunsee-SPECIAL-handling\n'
run_gate "$sd" done; assert_rc "no-change reason substring-not-token -> done fails" 1 $?

# D16: a ruling reference must be a possible calendar date (month 01-12, day
# 01-31). ruling-9999-99-99 names no ruling.
sd=$(newswarm)
mkledger "$sd" 'T4\t1\ttests\tno-change\t1\tw\tclosed-per-ruling-9999-99-99z-not-real\n'
run_gate "$sd" done; assert_rc "no-change reason impossible-date -> done fails" 1 $?

# D17: a verdict must belong to the task it blocks — dotted sibling. Task "A"
# (no-change) closes clean even though "A.1"'s own verdict file (A.1.2.
# checker-tests.verdict) matches the naive glob "A.*".
sd=$(newswarm)
mkledger "$sd" 'A\t1\ttests\tno-change\t1\tw\tno-defect-see-SPEC\nA.1\t1\ttests\taccepted\t2\tw\tok\n'
mkverdict "$sd" A.1 2 checker-tests PASS anthropic
run_gate "$sd" done; assert_rc "dotted-sibling verdict does not block no-change (done)" 0 $?

# D18: and the reverse. Task "A.1" (no-change) closes clean even though "A"'s
# own verdict file (A.1.checker-tests.verdict) matches the naive glob "A.1.*".
sd=$(newswarm)
mkledger "$sd" 'A.1\t1\ttests\tno-change\t1\tw\tno-defect-see-SPEC\nA\t1\ttests\taccepted\t1\tw\tok\n'
mkverdict "$sd" A 1 checker-tests PASS anthropic
run_gate "$sd" done; assert_rc "dotted-parent verdict does not block no-change (done)" 0 $?

finish
