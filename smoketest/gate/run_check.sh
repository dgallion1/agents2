#!/usr/bin/env bash
set -u
. "$(dirname "$0")/_lib.sh"

# T1: Tier 1 with all required checkers PASS -> accept (rc 0)
sd=$(newswarm)
mkledger "$sd" 't1\t1\tcontent,a11y\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" t1 0 checker-content PASS anthropic
mkverdict "$sd" t1 0 checker-a11y    PASS anthropic
run_gate "$sd" check t1; assert_rc "tier1 all-pass accepts" 0 $?

# T2: lean Tier 2 (2026-08-31) — a PASS from the single named checker accepts
sd=$(newswarm)
mkledger "$sd" 't2\t2\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" t2 0 checker-content PASS anthropic
run_gate "$sd" check t2; assert_rc "tier2 lean single-checker PASS accepts" 0 $?

# T2b: Tier 2 with an EMPTY checks column -> reject (rc 1). The tier-1
# blank-column-accepts footgun must not exist at tier 2.
sd=$(newswarm)
mkledger "$sd" 't2b\t2\t-\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" t2b 0 checker-content PASS anthropic
run_gate "$sd" check t2b; assert_rc "tier2 empty checks column rejects" 1 $?

# T2c: checks name content,second but only content PASSed -> reject
sd=$(newswarm)
mkledger "$sd" 't2c\t2\tcontent,second\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" t2c 0 checker-content PASS anthropic
run_gate "$sd" check t2c; assert_rc "tier2 missing named second checker rejects" 1 $?

# T2d: checks name content,second, both PASS in two lanes -> accept
sd=$(newswarm)
mkledger "$sd" 't2d\t2\tcontent,second\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" t2d 0 checker-content PASS anthropic
mkverdict "$sd" t2d 0 checker-second  PASS adversarial
run_gate "$sd" check t2d; assert_rc "tier2 dual-checker two-lane accepts" 0 $?

# T2e: checks name content,second, both PASS but in the SAME lane -> reject.
# Requesting the adversarial lane means the PASSes must actually span 2 lanes.
sd=$(newswarm)
mkledger "$sd" 't2e\t2\tcontent,second\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" t2e 0 checker-content PASS anthropic
mkverdict "$sd" t2e 0 checker-second  PASS anthropic
run_gate "$sd" check t2e; assert_rc "tier2 second requested but single-lane rejects" 1 $?

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
out=$(gate_out "$sd" check R9); rc=$?
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

# Tier-3 oracle-contract coverage. mktier3 builds a passing oracle + log at
# attempt N so each test can vary just the verdicts.
mktier3() { # sd task attempt
  mkdir -p "$1/tier3/$2"
  printf '#!/usr/bin/env bash\necho "ORACLE PASS"\n' > "$1/tier3/$2/accept.sh"
  chmod +x "$1/tier3/$2/accept.sh"
  printf 'check-1 ok\nORACLE PASS\n' > "$1/tier3/$2/oracle.$3.log"
}

# T22: tier 3 with oracle + ORACLE PASS log + two-lane PASS -> accept
sd=$(newswarm)
mkledger "$sd" 't22\t3\ttests\tverifying\t1\tworker-coder\t-\n'
mktier3 "$sd" t22 1
mkverdict "$sd" t22 1 checker-tests  PASS anthropic
mkverdict "$sd" t22 1 checker-second PASS adversarial
run_gate "$sd" check t22; assert_rc "tier3 oracle + dual-lane accepts" 0 $?

# T23: tier 3 keeps the UNCONDITIONAL dual-lane rule — a single-lane PASS
# rejects even though the checks column names only one checker (the lean
# tier-2 contract must not leak into tier 3).
sd=$(newswarm)
mkledger "$sd" 't23\t3\ttests\tverifying\t1\tworker-coder\t-\n'
mktier3 "$sd" t23 1
mkverdict "$sd" t23 1 checker-tests PASS anthropic
run_gate "$sd" check t23; assert_rc "tier3 single-lane PASS still rejects" 1 $?

# T24: tier 3 with a log that does not end in ORACLE PASS -> reject, even
# with a full dual-lane PASS quorum.
sd=$(newswarm)
mkledger "$sd" 't24\t3\ttests\tverifying\t1\tworker-coder\t-\n'
mktier3 "$sd" t24 1
printf 'check-1 ok\ncheck-2 FAILED\n' > "$sd/tier3/t24/oracle.1.log"
mkverdict "$sd" t24 1 checker-tests  PASS anthropic
mkverdict "$sd" t24 1 checker-second PASS adversarial
run_gate "$sd" check t24; assert_rc "tier3 failed oracle log rejects" 1 $?

# S1: gate.sh stats — first-attempt outcomes. t2 failed attempt 0 then passed
# at 1; tA was clean at attempt 0. stats must call t2 failed and tA clean.
sd=$(newswarm)
mkledger "$sd" 'tA\t2\tcontent\taccepted\t0\tworker-coder\t-\ntB\t2\tcontent\taccepted\t1\tworker-coder\t-\n'
mkverdict "$sd" tA 0 checker-content PASS anthropic
mkverdict "$sd" tB 0 checker-content FAIL anthropic
mkverdict "$sd" tB 1 checker-content PASS anthropic
out=$(gate_out "$sd" stats); rc=$?
assert_rc "stats exits 0" 0 $rc
echo "$out" | grep -q "stats: tA tier=2 first-attempt=0 clean" \
  && echo "ok   - stats reports tA clean" \
  || { echo "FAIL - stats reports tA clean"; FAILN=$((FAILN+1)); }
echo "$out" | grep -q "stats: tB tier=2 first-attempt=0 failed" \
  && echo "ok   - stats reports tB first-attempt failed" \
  || { echo "FAIL - stats reports tB first-attempt failed"; FAILN=$((FAILN+1)); }
echo "$out" | grep -q "first-attempt clean: 1/2" \
  && echo "ok   - stats summary line correct" \
  || { echo "FAIL - stats summary line correct"; FAILN=$((FAILN+1)); }

# ---------------------------------------------------------------------------
# 2026-09-18 gate hardening (docs/superpowers/specs/2026-09-18-gate-hardening-design.md)
# ---------------------------------------------------------------------------

# H3a: Tier 1 with a BLANK checks column must reject — the "accepts with zero
# verdicts" footgun is closed at tier 1 the same way it was at tier 2.
sd=$(newswarm)
mkledger "$sd" 'h3a\t1\t-\tverifying\t0\tworker-coder\t-\n'
mkmanifest "$sd" h3a 0
run_gate "$sd" check h3a; assert_rc "tier1 blank checks column rejects" 1 $?

# H1a: Tier 3 must require EVERY named checker, not just two lanes. checks
# names tests,a11y,second; tests+second PASS in two lanes; a11y never ran.
sd=$(newswarm)
mkledger "$sd" 'h1a\t3\ttests,a11y,second\tverifying\t1\tworker-coder\t-\n'
mktier3 "$sd" h1a 1
mkverdict "$sd" h1a 1 checker-tests  PASS anthropic
mkverdict "$sd" h1a 1 checker-second PASS adversarial
run_gate "$sd" check h1a; assert_rc "tier3 missing a named checker rejects despite two lanes" 1 $?
mkverdict "$sd" h1a 1 checker-a11y PASS anthropic
run_gate "$sd" check h1a; assert_rc "tier3 all named checkers + two lanes accepts" 0 $?

# H1b: Tier 3 with an EMPTY checks column rejects (same rule as tier 2).
sd=$(newswarm)
mkledger "$sd" 'h1b\t3\t-\tverifying\t1\tworker-coder\t-\n'
mktier3 "$sd" h1b 1
mkverdict "$sd" h1b 1 checker-tests  PASS anthropic
mkverdict "$sd" h1b 1 checker-second PASS adversarial
run_gate "$sd" check h1b; assert_rc "tier3 empty checks column rejects" 1 $?

# H4a: a stray legacy report.md in the tier-3 dir is a hard FAIL even with a
# valid oracle + log + dual-lane PASS — it can no longer flip the contract.
sd=$(newswarm)
mkledger "$sd" 'h4a\t3\ttests,second\tverifying\t1\tworker-coder\t-\n'
mktier3 "$sd" h4a 1
printf '# old blind-arm report\nRESOLUTION: merged\n' > "$sd/tier3/h4a/report.md"
mkverdict "$sd" h4a 1 checker-tests  PASS anthropic
mkverdict "$sd" h4a 1 checker-second PASS adversarial
out=$(gate_out "$sd" check h4a); rc=$?
assert_rc "tier3 stray report.md rejects" 1 $rc
assert_grep "tier3 stray report.md names the file" "$out" "report.md"

# H4b: report.md with a RESOLUTION line and NO oracle rejects (legacy
# contract gone).
sd=$(newswarm)
mkledger "$sd" 'h4b\t3\ttests,second\tverifying\t1\tworker-coder\t-\n'
mkdir -p "$sd/tier3/h4b"; printf 'RESOLUTION: merged\n' > "$sd/tier3/h4b/report.md"
mkverdict "$sd" h4b 1 checker-tests  PASS anthropic
mkverdict "$sd" h4b 1 checker-second PASS adversarial
run_gate "$sd" check h4b; assert_rc "tier3 legacy report without oracle rejects" 1 $?

# H2a: critical-glob manifest with a PASS but NO flag (lead never ran
# escalate-scan) must reject at check, and the message must say so.
sd=$(newswarm)
mkledger "$sd" 'h2a\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
printf 'src/payments/**\n' > "$sd/critical.globs"
mkmanifest "$sd" h2a 0 src/payments/checkout.js
mkverdict "$sd" h2a 0 checker-content PASS anthropic
out=$(gate_out "$sd" check h2a); rc=$?
assert_rc "critical-glob manifest without flag rejects at check" 1 $rc
assert_grep "critical-glob rejection tells the lead to run escalate-scan" "$out" "escalate-scan"
# After the scan writes the flag and the lead bumps the tier, check accepts.
run_gate "$sd" escalate-scan
assert_file "escalate-scan wrote the flag" "$sd/flags/h2a.flag"
mkledger "$sd" 'h2a\t2\tcontent\tverifying\t0\tworker-coder\t-\n'
run_gate "$sd" check h2a; assert_rc "critical-glob row accepts once flagged and bumped" 0 $?

# H2b: a boss OVERRULE with no flag rejects at check the same way.
sd=$(newswarm)
mkledger "$sd" 'h2b\t1\tcontent\tverifying\t1\tworker-coder\t-\n'
mkverdict "$sd" h2b 1 checker-content PASS anthropic
mkverdict "$sd" h2b 0 boss OVERRULE anthropic
run_gate "$sd" check h2b; assert_rc "boss overrule without flag rejects at check" 1 $?

# H2c: a tier-3 row cannot escalate further, so a critical-glob hit with no
# flag does not block it (mirrors escalate-scan, which writes no flag at 3).
sd=$(newswarm)
mkledger "$sd" 'h2c\t3\ttests,second\tverifying\t1\tworker-coder\t-\n'
printf 'src/payments/**\n' > "$sd/critical.globs"
mktier3 "$sd" h2c 1
mkmanifest "$sd" h2c 1 src/payments/checkout.js
mkverdict "$sd" h2c 1 checker-tests  PASS anthropic
mkverdict "$sd" h2c 1 checker-second PASS adversarial
run_gate "$sd" check h2c; assert_rc "critical-glob at tier 3 needs no flag" 0 $?

# H5a: no manifest at (task, attempt) -> reject. The worker contract requires
# it; the gate now does too.
sd=$(newswarm)
mkledger "$sd" 'h5a\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" h5a 0 checker-content PASS anthropic
rm -f "$sd/manifests/h5a.0.files"
run_gate "$sd" check h5a; assert_rc "missing manifest rejects" 1 $?

# H5b: manifest present but no .sha256 fingerprint sidecar -> reject.
sd=$(newswarm)
mkledger "$sd" 'h5b\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" h5b 0 checker-content PASS anthropic
rm -f "$sd/manifests/h5b.0.sha256"
out=$(gate_out "$sd" check h5b); rc=$?
assert_rc "missing fingerprint sidecar rejects" 1 $rc
assert_grep "missing-sidecar message names the sidecar" "$out" "sha256"

# H5c: a manifest path edited AFTER the fingerprint was taken -> reject at
# check (tree drift: the TC incident, mechanically).
sd=$(newswarm)
mkledger "$sd" 'h5c\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
mkmanifest "$sd" h5c 0 web/page.html web/app.js
mkverdict "$sd" h5c 0 checker-content PASS anthropic
run_gate "$sd" check h5c; assert_rc "fingerprinted tree accepts" 0 $?
echo "clobbered" > "$sd/tree/web/app.js"
out=$(gate_out "$sd" check h5c); rc=$?
assert_rc "manifest path changed since fingerprint rejects" 1 $rc
assert_grep "drift message names the drifted path" "$out" "web/app.js"

# H5d: a checker PASS without a MANIFEST_SHA256 header -> reject.
sd=$(newswarm)
mkledger "$sd" 'h5d\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
mkmanifest "$sd" h5d 0
mkverdict_nofp "$sd" h5d 0 checker-content PASS anthropic
out=$(gate_out "$sd" check h5d); rc=$?
assert_rc "PASS verdict without MANIFEST_SHA256 rejects" 1 $rc
assert_grep "missing-header message names MANIFEST_SHA256" "$out" "MANIFEST_SHA256"

# H5e: a checker PASS whose MANIFEST_SHA256 does not match the sidecar ->
# reject (the checker verified a different tree).
sd=$(newswarm)
mkledger "$sd" 'h5e\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
mkmanifest "$sd" h5e 0
printf 'VERDICT: PASS\nCHECKER: checker-content\nFAMILY: anthropic\nTASK: h5e\nATTEMPT: 0\nMANIFEST_SHA256: %s\n---\nevidence\n' \
  "$(printf 'x%.0s' {1..64})" > "$sd/verdicts/h5e.0.checker-content.verdict"
run_gate "$sd" check h5e; assert_rc "PASS verdict with wrong MANIFEST_SHA256 rejects" 1 $?

# H5f: a `deleted  <path>` fingerprint entry: accepted while the path is
# absent, rejected once it reappears.
sd=$(newswarm)
mkledger "$sd" 'h5f\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
mkmanifest "$sd" h5f 0 src/keep.go
printf 'src/gone.go\n' >> "$sd/manifests/h5f.0.files"
printf 'deleted  src/gone.go\n' >> "$sd/manifests/h5f.0.sha256"
mkverdict "$sd" h5f 0 checker-content PASS anthropic
run_gate "$sd" check h5f; assert_rc "deleted fingerprint entry with path absent accepts" 0 $?
echo back > "$sd/tree/src/gone.go"
run_gate "$sd" check h5f; assert_rc "deleted fingerprint entry with path present rejects" 1 $?

# H5g: a manifest path with NO fingerprint line -> reject.
sd=$(newswarm)
mkledger "$sd" 'h5g\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
mkmanifest "$sd" h5g 0 src/a.go src/b.go
sed -i '/src\/b.go/d' "$sd/manifests/h5g.0.sha256"
mkverdict "$sd" h5g 0 checker-content PASS anthropic
run_gate "$sd" check h5g; assert_rc "manifest path without fingerprint line rejects" 1 $?

# H5h: an EMPTY manifest -> reject (a task that changed nothing is no-change).
sd=$(newswarm)
mkledger "$sd" 'h5h\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
mkmanifest "$sd" h5h 0
: > "$sd/manifests/h5h.0.files"; : > "$sd/manifests/h5h.0.sha256"
mkverdict "$sd" h5h 0 checker-content PASS anthropic
run_gate "$sd" check h5h; assert_rc "empty manifest rejects" 1 $?

# H5i: judges are exempt from the header — a dispute overruled by three
# header-less judge verdicts still accepts.
sd=$(newswarm)
mkledger "$sd" 'h5i\t2\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" h5i 0 checker-content PASS anthropic
mkverdict "$sd" h5i 0 checker-second  FAIL adversarial
mkverdict_nofp "$sd" h5i 0 judge-claude    OVERRULE anthropic
mkverdict_nofp "$sd" h5i 0 judge-standards OVERRULE adversarial
mkverdict_nofp "$sd" h5i 0 judge-impact    OVERRULE impact
run_gate "$sd" check h5i; assert_rc "judge verdicts need no MANIFEST_SHA256" 0 $?

# H5j: a FAIL verdict without the header does not add a second failure mode
# (the FAIL itself is the finding). Uphold path -> rc 1 for the FAIL, which
# is the existing behaviour; just make sure the gate does not die (rc 2).
sd=$(newswarm)
mkledger "$sd" 'h5j\t2\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" h5j 0 checker-content PASS anthropic
mkverdict_nofp "$sd" h5j 0 checker-second FAIL adversarial
run_gate "$sd" check h5j; assert_rc "header-less FAIL is still an ordinary FAIL" 1 $?

# H7a: stats — a first-attempt FAIL the judge panel OVERRULED counts as clean
# (labelled fail-overruled), so a false alarm does not score against the
# worker.
sd=$(newswarm)
mkledger "$sd" 'sA\t2\tcontent,second\taccepted\t0\tworker-coder\t-\nsB\t2\tcontent\taccepted\t1\tworker-coder\t-\n'
mkverdict "$sd" sA 0 checker-content PASS anthropic
mkverdict "$sd" sA 0 checker-second  FAIL adversarial
mkverdict "$sd" sA 0 judge-claude    OVERRULE anthropic
mkverdict "$sd" sA 0 judge-standards OVERRULE adversarial
mkverdict "$sd" sA 0 judge-impact    UPHOLD   impact
mkverdict "$sd" sB 0 checker-content FAIL anthropic
mkverdict "$sd" sB 1 checker-content PASS anthropic
printf 'TARGET_TIER: 2\nREASON: two-consecutive-fails\n' > "$sd/flags/sB.flag"
out=$(gate_out "$sd" stats); rc=$?
assert_rc "stats exits 0 (hardening)" 0 $rc
assert_grep "stats calls an overruled first-attempt FAIL clean" "$out" "stats: sA tier=2 first-attempt=0 clean (fail-overruled)"
assert_grep "stats still calls an upheld FAIL failed" "$out" "stats: sB tier=2 first-attempt=0 failed"
assert_grep "stats summary counts the overruled row as clean" "$out" "first-attempt clean: 1/2"
assert_grep "stats reports escalations" "$out" "escalated: 1/2"
assert_grep "stats reports per-task elapsed" "$out" "stats: sA .*elapsed="
assert_grep "stats reports total elapsed" "$out" "elapsed total:"

finish
