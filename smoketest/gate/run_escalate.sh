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

# --- CD2: lane accounting reaches the escalation helpers. Only a checker-* may
# cast a FAIL, and only judge-*/boss may cast the UPHOLD/OVERRULE that sets one
# aside; load_verdict rejects every other pairing, so has_fail_at and
# judges_overruled_at never see those files.

# E14: a FAIL cast by a judge is not a FAIL — attempt 0's judge-cast FAIL plus
# attempt 1's genuine FAIL is NOT two consecutive fails.
sd=$(newswarm)
mkledger "$sd" 'e14\t1\tcontent\tfailed\t1\tworker-coder\t-\n'
mkverdict "$sd" e14 0 judge-x FAIL adversarial
mkverdict "$sd" e14 1 checker-content FAIL anthropic
run_gate "$sd" escalate-scan
assert_nofile "a judge-cast FAIL does not count toward two-consecutive-fails" "$sd/flags/e14.flag"

# E15: same for a boss-cast FAIL.
sd=$(newswarm)
mkledger "$sd" 'e15\t1\tcontent\tfailed\t1\tworker-coder\t-\n'
mkverdict "$sd" e15 0 boss FAIL anthropic
mkverdict "$sd" e15 1 checker-content FAIL anthropic
run_gate "$sd" escalate-scan
assert_nofile "a boss-cast FAIL does not count toward two-consecutive-fails" "$sd/flags/e15.flag"

# E16: attempt 0's genuine FAIL "set aside" by a panel that includes a
# checker-cast OVERRULE — only two valid votes remain (no quorum), so attempt 0
# stays unresolved and two consecutive FAILs flag.
sd=$(newswarm)
mkledger "$sd" 'e16\t1\tcontent\tfailed\t1\tworker-coder\t-\n'
mkverdict "$sd" e16 0 checker-content FAIL anthropic
mkverdict "$sd" e16 0 judge-claude    OVERRULE anthropic
mkverdict "$sd" e16 0 judge-standards OVERRULE adversarial
mkverdict "$sd" e16 0 checker-rogue   OVERRULE impact
mkverdict "$sd" e16 1 checker-content FAIL anthropic
run_gate "$sd" escalate-scan
assert_file "a checker-cast OVERRULE cannot complete the panel that sets a FAIL aside" "$sd/flags/e16.flag"

# E17: control — a panel of two judge OVERRULEs and a boss UPHOLD is three
# valid votes with an OVERRULE majority: attempt 0 is resolved, so no flag.
sd=$(newswarm)
mkledger "$sd" 'e17\t1\tcontent\tfailed\t1\tworker-coder\t-\n'
mkverdict "$sd" e17 0 checker-content FAIL anthropic
mkverdict "$sd" e17 0 judge-standards OVERRULE adversarial
mkverdict "$sd" e17 0 judge-impact    OVERRULE impact
mkverdict "$sd" e17 0 boss            UPHOLD   anthropic
mkverdict "$sd" e17 1 checker-content FAIL anthropic
run_gate "$sd" escalate-scan
assert_nofile "a panel with a boss UPHOLD still sets the FAIL aside (control)" "$sd/flags/e17.flag"

# E18: only the exact identity `boss` triggers checker-overruled — boss-2 and
# Boss cast nothing, so no flag.
sd=$(newswarm)
mkledger "$sd" 'e18\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" e18 0 boss-2 OVERRULE anthropic
mkverdict "$sd" e18 0 Boss   OVERRULE anthropic
run_gate "$sd" escalate-scan
assert_nofile "boss-2 / Boss OVERRULE is invalid and does not escalate" "$sd/flags/e18.flag"

# --- CD3: critical-glob evaluation fails CLOSED. Any critical.globs, test.globs
# or <task>.*.files manifest that is PRESENT but not a readable regular file of
# valid UTF-8 makes the evaluation UNREADABLE: escalate-scan writes the flag
# with REASON: critical-glob-unreadable (instead of silently dropping the
# trigger) and prints one stderr line naming the offending path.

# u_case LABEL TASK SETUP NEEDLE [CLEANUP] — a tier-2 row with one clean manifest and
# critical.globs = swarm/** (which the manifest does NOT match), then SETUP
# (eval'd with $sd) breaks one input. Expect the flag, its REASON, and ONE
# diagnostic line naming NEEDLE. CLEANUP (eval'd with $sd) removes a fixture
# that chmod -R cannot restore, i.e. a FIFO.
u_case() {
  local label="$1" t="$2" setup="$3" needle="$4" cleanup="${5:-}" sd err
  sd=$(newswarm)
  mkledger "$sd" "$t\t2\ttests\tchecking\t1\tw\t-\n"
  mkmanifest "$sd" "$t" 1 src/a.txt
  printf 'swarm/**\n' > "$sd/critical.globs"
  eval "$setup"
  err=$(gate_stderr "$sd" escalate-scan)
  chmod -R u+rwX "$sd" 2>/dev/null                    # restore anything a case made mode 000
  [[ -z "$cleanup" ]] || eval "$cleanup"
  assert_reason "$label -> flag REASON critical-glob-unreadable" "$sd" "$t" critical-glob-unreadable
  assert_one_line "$label -> one unreadable diagnostic line naming $needle" "$err" "$needle"
}
if is_root; then echo "ok   - skip: mode-000 unreadable cases need a non-root user"; else
u_case "unreadable critical.globs (mode 000)"  u1 'chmod 000 "$sd/critical.globs"' critical.globs
u_case "unreadable test.globs (mode 000)"      u4 'echo x > "$sd/test.globs"; chmod 000 "$sd/test.globs"' test.globs
u_case "unreadable current manifest (mode 000)" u7 'chmod 000 "$sd/manifests/u7.1.files"' u7.1.files
u_case "unreadable manifests directory (mode 000)" u12 'chmod 000 "$sd/manifests"' manifests
fi
u_case "unreadable critical.globs (a directory)"        u2 'rm "$sd/critical.globs"; mkdir "$sd/critical.globs"' critical.globs
u_case "unreadable critical.globs (a dangling symlink)" u3 'rm "$sd/critical.globs"; ln -s nowhere "$sd/critical.globs"' critical.globs
u_case "unreadable critical.globs (a symlink loop)"     u3l 'rm "$sd/critical.globs"; ln -s critical.globs "$sd/critical.globs"' critical.globs
u_case "unreadable critical.globs (not valid UTF-8)"    u2b 'printf "swarm/**\n\xff\xfe\n" > "$sd/critical.globs"' critical.globs
u_case "unreadable test.globs (a directory: not the defaults)" u5 'mkdir "$sd/test.globs"' test.globs
u_case "unreadable test.globs (not valid UTF-8)"        u6 'printf "\xff\xfe\n" > "$sd/test.globs"' test.globs
u_case "unreadable test.globs (a FIFO is never opened)" u8 'mkfifo "$sd/test.globs"' test.globs 'rm -f "$sd/test.globs"'
u_case "unreadable current manifest (not valid UTF-8)"  u9 'printf "\xff\xfe\n" > "$sd/manifests/u9.1.files"' u9.1.files
u_case "unreadable OLDER attempt manifest (not valid UTF-8)" u10 'printf "\xff\xfe\n" > "$sd/manifests/u10.0.files"' u10.0.files
u_case "unreadable manifest entry (a directory matching <task>.*.files)" u11 'mkdir "$sd/manifests/u11.0.files"' u11.0.files

# Unreadable beats a hit: the current manifest matches swarm/**, an older one is
# invalid UTF-8 — the reason is the fail-closed one, not critical-glob.
sd=$(newswarm)
mkledger "$sd" 'u13\t2\ttests\tchecking\t2\tw\t-\n'
mkmanifest "$sd" u13 2 swarm/x.sh
printf 'swarm/**\n' > "$sd/critical.globs"
printf '\xff\xfe\n' > "$sd/manifests/u13.1.files"
run_gate "$sd" escalate-scan
assert_reason "unreadable input beats a real critical-glob hit" "$sd" u13 critical-glob-unreadable

# The evaluator itself failing is unreadable, never "no hit": a python3 that is
# killed, and one that exits 1 (what a python traceback exits, and what the old
# gate read as "no hit").
shim=$(mktemp -d)
for mode in 'kill -9 $$' 'exit 1' 'exit 127'; do
  sd=$(newswarm)
  mkledger "$sd" 'u14\t2\ttests\tchecking\t1\tw\t-\n'
  mkmanifest "$sd" u14 1 src/a.txt
  printf 'swarm/**\n' > "$sd/critical.globs"
  printf '#!/bin/sh\n%s\n' "$mode" > "$shim/python3"; chmod +x "$shim/python3"
  err=$(PATH="$shim:$PATH" gate_stderr "$sd" escalate-scan)
  assert_reason "python3 evaluator failure ($mode) is unreadable, fail closed" "$sd" u14 critical-glob-unreadable
  assert_one_line "python3 evaluator failure ($mode) prints one unreadable line" "$err" "evaluator"
done
rm -f "$shim/python3"; rmdir "$shim"

# Controls: what must NOT become unreadable.
# a row that has not started (no manifests) is never flagged, even with an
# unreadable critical.globs; a missing critical.globs never flags.
sd=$(newswarm)
mkledger "$sd" 'u15\t2\ttests\tchecking\t1\tw\t-\n'
printf 'swarm/**\n' > "$sd/critical.globs"; is_root || chmod 000 "$sd/critical.globs"
err=$(gate_stderr "$sd" escalate-scan); chmod 644 "$sd/critical.globs"
assert_nofile "no manifests: an unreadable critical.globs flags nothing (unstarted row)" "$sd/flags/u15.flag"
assert_eq "no manifests: no unreadable diagnostic for an unstarted row" "$err" ""
sd=$(newswarm)
mkledger "$sd" 'u16\t2\ttests\tchecking\t1\tw\t-\n'
mkmanifest "$sd" u16 1 src/a.txt
err=$(gate_stderr "$sd" escalate-scan)
assert_nofile "absent critical.globs flags nothing (never unreadable)" "$sd/flags/u16.flag"
assert_eq "absent critical.globs: no diagnostic" "$err" ""
# clean readable inputs, no match: no flag, and nothing on stderr. The manifest
# holds valid non-ASCII UTF-8; it must read the same under LC_ALL=C.
sd=$(newswarm)
mkledger "$sd" 'u17\t2\ttests\tchecking\t1\tw\t-\n'
mkmanifest "$sd" u17 1 src/a.txt
printf 'docs/caf\xc3\xa9.md\n' > "$sd/manifests/u17.1.files"
printf 'swarm/**\n' > "$sd/critical.globs"
err=$(LC_ALL=C LANG=C PYTHONUTF8=0 gate_stderr "$sd" escalate-scan)
assert_nofile "readable non-ASCII UTF-8 manifest under LC_ALL=C is no hit, not unreadable" "$sd/flags/u17.flag"
assert_eq "readable inputs: nothing on stderr" "$err" ""
# a symlink to a readable critical.globs is fine (regular after following it).
sd=$(newswarm)
mkledger "$sd" 'u18\t2\ttests\tchecking\t1\tw\t-\n'
mkmanifest "$sd" u18 1 src/a.txt
printf 'swarm/**\n' > "$sd/real.globs"; ln -s real.globs "$sd/critical.globs"
err=$(gate_stderr "$sd" escalate-scan)
assert_nofile "a symlink to a readable critical.globs is not unreadable" "$sd/flags/u18.flag"
assert_eq "symlinked readable critical.globs: nothing on stderr" "$err" ""
# a real hit on readable inputs keeps the plain critical-glob reason.
sd=$(newswarm)
mkledger "$sd" 'u19\t2\ttests\tchecking\t1\tw\t-\n'
mkmanifest "$sd" u19 1 swarm/x.sh
printf 'swarm/**\n' > "$sd/critical.globs"
run_gate "$sd" escalate-scan
assert_reason "a readable critical-glob hit keeps the plain critical-glob reason" "$sd" u19 critical-glob
# tier 3 cannot escalate further: unreadable writes no flag there either.
sd=$(newswarm)
mkledger "$sd" 'u20\t3\ttests,second\tchecking\t1\tw\t-\n'
mkmanifest "$sd" u20 1 src/a.txt
printf 'swarm/**\n' > "$sd/critical.globs"; printf '\xff\xfe\n' > "$sd/test.globs"
run_gate "$sd" escalate-scan
assert_nofile "tier 3 is never flagged, even for unreadable globs" "$sd/flags/u20.flag"
# --- CD4: a Codex FAIL is a FAIL for escalation (run CD). Two consecutive
# Codex FAILs flag the row whether or not the checks column names codex; a
# Codex PASS never does, and a skip record is no FAIL at all.
for checks in tests,second,codex tests; do
  sd=$(newswarm)
  mkledger "$sd" "ex1\t2\t$checks\tchecking\t2\tw\t-\n"
  mkcodex "$sd" ex1 1 FAIL
  mkcodex "$sd" ex1 2 FAIL
  run_gate "$sd" escalate-scan
  assert_reason "codex: two consecutive Codex FAILs (checks=$checks) flag two-consecutive-fails" "$sd" ex1 two-consecutive-fails
done
sd=$(newswarm)
mkledger "$sd" 'ex2\t2\ttests,second,codex\tchecking\t2\tw\t-\n'
mkcodex "$sd" ex2 1 FAIL
mkcodex "$sd" ex2 2 PASS
run_gate "$sd" escalate-scan
assert_nofile "codex: a Codex FAIL then a Codex PASS is not two consecutive fails" "$sd/flags/ex2.flag"
sd=$(newswarm)
mkledger "$sd" 'ex3\t2\ttests,second,codex\tchecking\t2\tw\t-\n'
mkcodex "$sd" ex3 1 FAIL
mkskip "$sd" ex3 2 quota
run_gate "$sd" escalate-scan
assert_nofile "codex: a Codex FAIL then a skip record is not two consecutive fails" "$sd/flags/ex3.flag"
sd=$(newswarm)
mkledger "$sd" 'ex4\t2\ttests,codex\tchecking\t2\tw\t-\n'
mkcodex "$sd" ex4 1 FAIL
mkverdict "$sd" ex4 2 checker-tests FAIL anthropic
run_gate "$sd" escalate-scan
assert_reason "codex: a Codex FAIL then a checker FAIL flags two-consecutive-fails" "$sd" ex4 two-consecutive-fails

finish
