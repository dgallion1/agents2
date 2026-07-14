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

finish
