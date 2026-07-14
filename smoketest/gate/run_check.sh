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

finish
