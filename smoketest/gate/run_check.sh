#!/usr/bin/env bash
set -u
. "$(dirname "$0")/_lib.sh"

# T1: Tier 1 with all required checkers PASS -> accept (rc 0)
sd=$(newswarm)
mkledger "$sd" 't1\t1\tcontent,a11y\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" t1 0 checker-content PASS anthropic
mkverdict "$sd" t1 0 checker-a11y    PASS anthropic
run_gate "$sd" check t1; assert_rc "tier1 all-pass accepts" 0 $?

# T2: Tier 2 with only ONE verdict -> reject (rc 1)
sd=$(newswarm)
mkledger "$sd" 't2\t2\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" t2 0 checker-content PASS anthropic
run_gate "$sd" check t2; assert_rc "tier2 single verdict rejects" 1 $?

# T3: Tier 2 with two DIFFERENT-family PASS -> accept (rc 0)
sd=$(newswarm)
mkledger "$sd" 't3\t2\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" t3 0 checker-content PASS anthropic
mkverdict "$sd" t3 0 checker-second  PASS glm
run_gate "$sd" check t3; assert_rc "tier2 dual-family accepts" 0 $?

# T4: Tier 2 dispute (one FAIL) resolved by 2-of-3 OVERRULE -> accept (rc 0)
sd=$(newswarm)
mkledger "$sd" 't4\t2\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" t4 0 checker-content PASS anthropic
mkverdict "$sd" t4 0 checker-second  FAIL glm
mkverdict "$sd" t4 0 judge-claude OVERRULE anthropic
mkverdict "$sd" t4 0 judge-glm    OVERRULE glm
mkverdict "$sd" t4 0 judge-local  UPHOLD   local
run_gate "$sd" check t4; assert_rc "tier2 dispute overruled accepts" 0 $?

# T5: malformed ledger (6 fields) -> corruption error (rc 2)
sd=$(newswarm)
mkledger "$sd" 'tX\t2\tcontent\tverifying\t0\tworker-coder\n'
run_gate "$sd" check tX; assert_rc "malformed ledger rejected" 2 $?

# T6: incomplete verdict headers (no CHECKER/TASK/ATTEMPT/---) -> reject
sd=$(newswarm)
mkledger "$sd" 't6\t2\tcontent\tverifying\t1\tworker-coder\t-\n'
printf 'VERDICT: PASS\nFAMILY: anthropic\n' > "$sd/verdicts/t6.1.a.verdict"
printf 'VERDICT: PASS\nFAMILY: glm\n' > "$sd/verdicts/t6.1.b.verdict"
run_gate "$sd" check t6; assert_rc "incomplete verdicts rejected" 1 $?

# T7: CHECKER header disagrees with filename -> reject
sd=$(newswarm)
mkledger "$sd" 't7\t2\tcontent\tverifying\t1\tworker-coder\t-\n'
printf 'VERDICT: PASS\nCHECKER: other\nFAMILY: anthropic\nTASK: t7\nATTEMPT: 1\n---\nevidence\n' \
  > "$sd/verdicts/t7.1.checker-content.verdict"
mkverdict "$sd" t7 1 checker-second PASS glm
run_gate "$sd" check t7; assert_rc "CHECKER/filename mismatch rejected" 1 $?

# T8: TASK header disagrees with filename -> reject
sd=$(newswarm)
mkledger "$sd" 't8\t1\tcontent\tverifying\t1\tworker-coder\t-\n'
printf 'VERDICT: PASS\nCHECKER: checker-content\nFAMILY: anthropic\nTASK: wrong\nATTEMPT: 1\n---\nevidence\n' \
  > "$sd/verdicts/t8.1.checker-content.verdict"
run_gate "$sd" check t8; assert_rc "TASK/filename mismatch rejected" 1 $?

# T9: invalid FAMILY enum -> reject
sd=$(newswarm)
mkledger "$sd" 't9\t2\tcontent\tverifying\t1\tworker-coder\t-\n'
mkverdict "$sd" t9 1 checker-content PASS anthropic
printf 'VERDICT: PASS\nCHECKER: checker-second\nFAMILY: forged-family\nTASK: t9\nATTEMPT: 1\n---\nevidence\n' \
  > "$sd/verdicts/t9.1.checker-second.verdict"
run_gate "$sd" check t9; assert_rc "invalid FAMILY rejected" 1 $?

# T10: duplicate judge identity (same CHECKER twice) -> reject
sd=$(newswarm)
mkledger "$sd" 't10\t2\tcontent\tverifying\t1\tworker-coder\t-\n'
mkverdict "$sd" t10 1 checker-content PASS anthropic
mkverdict "$sd" t10 1 checker-second  FAIL glm
mkverdict "$sd" t10 1 judge-claude OVERRULE anthropic
# second file claims a different name in filename but same CHECKER header — mismatch.
# Instead write two files from different filename checkers that collide on family:
mkverdict "$sd" t10 1 judge-glm    OVERRULE glm
# third judge reuses anthropic family (duplicate judge family)
printf 'VERDICT: OVERRULE\nCHECKER: judge-extra\nFAMILY: anthropic\nTASK: t10\nATTEMPT: 1\n---\nevidence\n' \
  > "$sd/verdicts/t10.1.judge-extra.verdict"
run_gate "$sd" check t10; assert_rc "duplicate judge family rejected" 1 $?

# T11: three unique judges OVERRULE majority still accepts
sd=$(newswarm)
mkledger "$sd" 't11\t2\tcontent\tverifying\t1\tworker-coder\t-\n'
mkverdict "$sd" t11 1 checker-content PASS anthropic
mkverdict "$sd" t11 1 checker-second  FAIL glm
mkverdict "$sd" t11 1 judge-claude OVERRULE anthropic
mkverdict "$sd" t11 1 judge-glm    OVERRULE glm
mkverdict "$sd" t11 1 judge-local  OVERRULE local
run_gate "$sd" check t11; assert_rc "unique judges 3x overrule accepts" 0 $?

# T12: no-change row with reason containing see-SPEC -> check accepts (rc 0), never
# runs through check_tier1/2/3 (no verdict files exist and yet it still passes)
sd=$(newswarm)
mkledger "$sd" 'R9\t1\tcontent\tno-change\t0\tworker-coder\tno-defect-found-root-cause-was-lead-shared-tree-see-SPEC\n'
out=$(SWARM_DIR="$sd" bash "$GATE" check R9 2>&1); rc=$?
assert_rc "no-change (see-SPEC) -> check accepts" 0 $rc
echo "$out" | grep -qF "no-change: R9 (no-defect-found-root-cause-was-lead-shared-tree-see-SPEC)" \
  && echo "ok   - check prints explicit no-change line" \
  || { echo "FAIL - check prints explicit no-change line"; FAILN=$((FAILN+1)); }

# T13: no-change row with reason containing ruling-2026-08-20d -> check accepts (rc 0)
sd=$(newswarm)
mkledger "$sd" 'R9\t1\tcontent\tno-change\t0\tworker-coder\tno-defect-found-root-cause-was-lead-shared-tree-ruling-2026-08-20d\n'
run_gate "$sd" check R9; assert_rc "no-change (ruling-2026-08-20d) -> check accepts" 0 $?

# T13b: the trailing letter is optional in ruling-YYYY-MM-DD[a-z]? — a bare
# date must satisfy the reason rule too. Grafted from the alt arm during the
# Tier-3 merge; the primary arm covered only the lettered form, so the
# optional-group branch was untested on both sides of the regex.
sd=$(newswarm)
mkledger "$sd" 'R9\t1\tcontent\tno-change\t0\tworker-coder\tno-defect-found-root-cause-was-lead-shared-tree-ruling-2026-08-20\n'
run_gate "$sd" check R9; assert_rc "no-change (ruling-2026-08-20, no letter) -> check accepts" 0 $?

# T14: no-change row whose reason has neither token -> check rejects (rc 1),
# agreeing with `done` (D9)
sd=$(newswarm)
mkledger "$sd" 'R9\t1\tcontent\tno-change\t0\tworker-coder\tno-defect-found-root-cause-was-lead-shared-tree\n'
run_gate "$sd" check R9; assert_rc "no-change without justification -> check rejects" 1 $?

# T15: no-change row whose attempt has a verdict file on disk -> check rejects (rc 1),
# agreeing with `done` (D10) — the row was checked, no-change is the wrong status
sd=$(newswarm)
mkledger "$sd" 'R9\t1\tcontent\tno-change\t0\tworker-coder\tno-defect-found-root-cause-was-lead-shared-tree-see-SPEC\n'
mkverdict "$sd" R9 0 checker-content FAIL anthropic
run_gate "$sd" check R9; assert_rc "no-change with verdict file present -> check rejects" 1 $?

# T16: no-change row with an unresolved escalation flag -> check rejects (rc 1).
# The flag must outrank no-change even though no-change never runs the tier
# checks — the flag check is not a tier check.
sd=$(newswarm)
mkledger "$sd" 'T1\t1\ttests\tno-change\t1\tw\tno-defect-see-SPEC\n'
printf 'TARGET_TIER: 3\nREASON: two-consecutive-fails\n' > "$sd/flags/T1.flag"
run_gate "$sd" check T1; assert_rc "no-change with unresolved flag -> check rejects" 1 $?

# T17: no-change row whose reason has NO verdict at its own (current) attempt
# but DOES have a FAIL verdict at an older attempt -> check rejects (rc 1).
# A verdict recorded at ANY attempt for the task bars no-change, not just the
# attempt the ledger currently names.
sd=$(newswarm)
mkledger "$sd" 'T2\t1\ttests\tno-change\t2\tw\tno-defect-see-SPEC\n'
mkverdict "$sd" T2 1 checker-tests FAIL anthropic
run_gate "$sd" check T2; assert_rc "no-change with FAIL verdict at other attempt -> check rejects" 1 $?

# T18: "see-SPEC" must match as a hyphen-delimited token, not a bare substring.
# "unsee-SPECIAL-handling" contains the six characters "see-SPEC" but names no
# citation.
sd=$(newswarm)
mkledger "$sd" 'T3\t1\ttests\tno-change\t1\tw\tunsee-SPECIAL-handling\n'
run_gate "$sd" check T3; assert_rc "no-change reason substring-not-token -> check rejects" 1 $?

# T19: a ruling reference must be a possible calendar date (month 01-12, day
# 01-31). ruling-9999-99-99 names no ruling.
sd=$(newswarm)
mkledger "$sd" 'T4\t1\ttests\tno-change\t1\tw\tclosed-per-ruling-9999-99-99z-not-real\n'
run_gate "$sd" check T4; assert_rc "no-change reason impossible-date -> check rejects" 1 $?

# T20: a verdict must belong to the task it blocks — dotted sibling. Task "A"
# (no-change) closes clean even though "A.1"'s own verdict file (A.1.2.
# checker-tests.verdict) matches the naive glob "A.*".
sd=$(newswarm)
mkledger "$sd" 'A\t1\ttests\tno-change\t1\tw\tno-defect-see-SPEC\nA.1\t1\ttests\taccepted\t2\tw\tok\n'
mkverdict "$sd" A.1 2 checker-tests PASS anthropic
run_gate "$sd" check A; assert_rc "dotted-sibling verdict does not block no-change" 0 $?

# T21: and the reverse. Task "A.1" (no-change) closes clean even though "A"'s
# own verdict file (A.1.checker-tests.verdict) matches the naive glob "A.1.*".
sd=$(newswarm)
mkledger "$sd" 'A.1\t1\ttests\tno-change\t1\tw\tno-defect-see-SPEC\nA\t1\ttests\taccepted\t1\tw\tok\n'
mkverdict "$sd" A 1 checker-tests PASS anthropic
run_gate "$sd" check A.1; assert_rc "dotted-parent verdict does not block no-change" 0 $?

finish
