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

# E7: a ROOT-level critical file must escalate under a leading-**/ glob
# (regression: fnmatch requires a literal '/', so '**/deploy.config.*' missed root files)
sd=$(newswarm)
mkledger "$sd" 'e7\t1\tcontent\tverifying\t0\tw\t-\n'
printf '**/deploy.config.*\n' > "$sd/critical.globs"
printf 'deploy.config.json\nindex.html\n' > "$sd/manifests/e7.0.files"
run_gate "$sd" escalate-scan
assert_file "root-level critical file escalates (leading **/ glob)" "$sd/flags/e7.flag"

# E8: a judge-panel OVERRULE (Tier-2 dispute resolution) must NOT escalate — only a boss overrule does
sd=$(newswarm)
mkledger "$sd" 'e8\t2\tcontent\tverifying\t0\tw\t-\n'
mkverdict "$sd" e8 0 checker-content PASS anthropic
mkverdict "$sd" e8 0 checker-second  FAIL glm
mkverdict "$sd" e8 0 judge-claude OVERRULE anthropic
mkverdict "$sd" e8 0 judge-glm    OVERRULE glm
mkverdict "$sd" e8 0 judge-local  UPHOLD   local
run_gate "$sd" escalate-scan
assert_nofile "judge-panel OVERRULE does not escalate (only boss overrule does)" "$sd/flags/e8.flag"

# E9: a manifest of ONLY test files under a critical glob must NOT escalate,
# with an explicit test.globs file present.
sd=$(newswarm)
mkledger "$sd" 'e9\t1\tcontent\tverifying\t0\tw\t-\n'
printf 'internal/services/storage/**\n' > "$sd/critical.globs"
printf '**/*_test.go\n' > "$sd/test.globs"
printf 'internal/services/storage/foo_test.go\ninternal/services/storage/bar_test.go\n' > "$sd/manifests/e9.0.files"
run_gate "$sd" escalate-scan
assert_nofile "test-only manifest under critical glob does not escalate" "$sd/flags/e9.flag"

# E10: a mix of one production file and one test file under the same critical
# glob must STILL escalate -- a test glob only exempts the test path, not the
# whole manifest, so adding a test file cannot buy an exemption.
sd=$(newswarm)
mkledger "$sd" 'e10\t1\tcontent\tverifying\t0\tw\t-\n'
printf 'internal/services/storage/**\n' > "$sd/critical.globs"
printf '**/*_test.go\n' > "$sd/test.globs"
printf 'internal/services/storage/migration.go\ninternal/services/storage/migration_test.go\n' > "$sd/manifests/e10.0.files"
run_gate "$sd" escalate-scan
assert_file "mixed production+test manifest still escalates" "$sd/flags/e10.flag"

# E11: with NO test.globs file present, the compiled-in default list still
# exempts a *_test.go path under a critical glob (fallback behaviour).
sd=$(newswarm)
mkledger "$sd" 'e11\t1\tcontent\tverifying\t0\tw\t-\n'
printf 'internal/services/storage/**\n' > "$sd/critical.globs"
printf 'internal/services/storage/foo_test.go\n' > "$sd/manifests/e11.0.files"
run_gate "$sd" escalate-scan
assert_nofile "default test-glob fallback exempts *_test.go with no test.globs file" "$sd/flags/e11.flag"

# E12: overrule_exists task-prefix collision, direction 1. A boss OVERRULE
# recorded for task "A.1" (filename "A.1.0.boss.verdict") must not make
# overrule_exists("A") match it via the naive glob "A.*" -- only "A"'s own
# overrule should flag "A".
sd=$(newswarm)
mkledger "$sd" 'A\t1\tcontent\tverifying\t0\tw\t-\nA.1\t1\tcontent\tverifying\t0\tw\t-\n'
mkverdict "$sd" A.1 0 boss OVERRULE anthropic
run_gate "$sd" escalate-scan
assert_nofile "dotted-sibling overrule does not flag task A" "$sd/flags/A.flag"
assert_file  "dotted-sibling overrule still flags its own task A.1" "$sd/flags/A.1.flag"

# E13: overrule_exists task-prefix collision, direction 2. A boss OVERRULE
# recorded for task "A" at attempt 1 (filename "A.1.boss.verdict") must not
# make overrule_exists("A.1") match it via the glob "A.1.*" -- only "A"
# should be flagged, not "A.1".
sd=$(newswarm)
mkledger "$sd" 'A\t1\tcontent\tverifying\t1\tw\t-\nA.1\t1\tcontent\tverifying\t0\tw\t-\n'
mkverdict "$sd" A 1 boss OVERRULE anthropic
run_gate "$sd" escalate-scan
assert_file   "task A's own overrule flags A" "$sd/flags/A.flag"
assert_nofile "dotted-sibling attempt-collision does not flag A.1" "$sd/flags/A.1.flag"

finish
