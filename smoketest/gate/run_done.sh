#!/usr/bin/env bash
set -u
. "$(dirname "$0")/_lib.sh"

# D1: all accepted, no flags -> done rc 0
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\taccepted\t0\tworker-coder\t-\nb\t2\tcontent\taccepted\t0\tworker-coder\t-\n'
run_gate "$sd" done; assert_rc "all accepted -> done ok" 0 $?

# D2: one task still pending -> done rc 1
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\taccepted\t0\tworker-coder\t-\nb\t2\tcontent\tverifying\t0\tworker-coder\t-\n'
run_gate "$sd" done; assert_rc "pending task -> done fails" 1 $?

# D3: accepted but an UNRESOLVED flag (tier<target) -> done rc 1
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\taccepted\t0\tworker-coder\t-\n'
printf 'TARGET_TIER: 2\nREASON: critical-glob\n' > "$sd/flags/a.flag"
run_gate "$sd" done; assert_rc "unresolved flag -> done fails" 1 $?

# D4: accepted with a RESOLVED flag (tier>=target) -> done rc 0
sd=$(newswarm)
mkledger "$sd" 'a\t2\tcontent\taccepted\t0\tworker-coder\t-\n'
printf 'TARGET_TIER: 2\nREASON: critical-glob\n' > "$sd/flags/a.flag"
run_gate "$sd" done; assert_rc "resolved flag -> done ok" 0 $?

finish
