#!/usr/bin/env bash
set -u
. "$(dirname "$0")/_lib.sh"

# E1: two consecutive FAILs (attempts 0 and 1) -> flag written
sd=$(newswarm)
mkledger "$sd" 'e1\t1\tcontent\tfailed\t1\tworker-coder\t-\n'
mkverdict "$sd" e1 0 checker-content FAIL anthropic
mkverdict "$sd" e1 1 checker-content FAIL anthropic
run_gate "$sd" escalate-scan; assert_rc "escalate-scan exits 0" 0 $?
assert_file "two consecutive fails -> flag" "$sd/flags/e1.flag"
grep -q '^TARGET_TIER: 2' "$sd/flags/e1.flag" && echo "ok   - e1 target tier 2" || { echo "FAIL - e1 target"; FAILN=$((FAILN+1)); }

# E2: manifest path matches critical.globs -> flag written
sd=$(newswarm)
mkledger "$sd" 'e2\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
printf 'src/payments/**\n' > "$sd/critical.globs"
printf 'src/payments/checkout.js\nsrc/ui/nav.js\n' > "$sd/manifests/e2.0.files"
run_gate "$sd" escalate-scan
assert_file "critical-glob match -> flag" "$sd/flags/e2.flag"

# E3: recorded OVERRULE verdict -> flag written
sd=$(newswarm)
mkledger "$sd" 'e3\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" e3 0 boss OVERRULE anthropic
run_gate "$sd" escalate-scan
assert_file "overrule -> flag" "$sd/flags/e3.flag"

# E4: no trigger -> no flag
sd=$(newswarm)
mkledger "$sd" 'e4\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" e4 0 checker-content PASS anthropic
run_gate "$sd" escalate-scan
assert_nofile "clean task -> no flag" "$sd/flags/e4.flag"

# E5: unresolved flag blocks check at old tier
sd=$(newswarm)
mkledger "$sd" 'e5\t1\tcontent\tverifying\t1\tworker-coder\t-\n'
mkverdict "$sd" e5 0 checker-content FAIL anthropic
mkverdict "$sd" e5 1 checker-content FAIL anthropic
run_gate "$sd" escalate-scan
mkverdict "$sd" e5 1 checker-content PASS anthropic   # even a pass can't accept while flagged
run_gate "$sd" check e5; assert_rc "unresolved flag blocks check" 1 $?

# E6: multi-task ledger with critical.globs must not drop later rows
# (regression: nullglob leak + overrule_exists reading the ledger via stdin)
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\tverifying\t0\tw\t-\nb\t1\tcontent\tverifying\t0\tw\t-\nc\t1\tcontent\tfailed\t1\tw\t-\n'
printf 'src/payments/**\n' > "$sd/critical.globs"
printf 'src/payments/x.js\n' > "$sd/manifests/a.0.files"
mkverdict "$sd" c 0 checker-content FAIL anthropic
mkverdict "$sd" c 1 checker-content FAIL anthropic
run_gate "$sd" escalate-scan
assert_file "multi-task scan flags glob task a" "$sd/flags/a.flag"
assert_file "multi-task scan still flags later task c (no stdin/nullglob drop)" "$sd/flags/c.flag"

finish
