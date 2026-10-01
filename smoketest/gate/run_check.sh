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

# --- CD2: lane accounting — only the right identities may cast each verdict.
# PASS/FAIL are valid only from checker-*; UPHOLD/OVERRULE only from judge-* or
# exactly `boss`. Any other VERDICT/CHECKER pairing makes the file INVALID
# (ruling GH-29f: a judge-named PASS used to supply the second lane, and the
# fingerprint check skipped it because it only inspected checker-* PASSes).

# P1: the reproduced hole. Tier 3, checks=tests: a checker-tests PASS
# (anthropic, fingerprinted) plus judge-x.verdict saying PASS / adversarial
# with NO MANIFEST_SHA256 must NOT be accepted — the judge-named file may not
# supply the second lane.
sd=$(newswarm)
mkledger "$sd" 'p1\t3\ttests\tverifying\t1\tworker-coder\t-\n'
mktier3 "$sd" p1 1
mkverdict "$sd" p1 1 checker-tests PASS anthropic
mkverdict_nofp "$sd" p1 1 judge-x PASS adversarial
out=$(gate_out "$sd" check p1); rc=$?
assert_rc "tier3 judge-named PASS cannot supply the second lane (GH-29f)" 1 $rc
assert_grep "tier3 judge-named PASS rejects as an invalid verdict" "$out" "invalid verdict p1.1.judge-x.verdict"
assert_grep "tier3 judge-named PASS names VERDICT and CHECKER" "$out" "VERDICT PASS not allowed from CHECKER 'judge-x' (PASS/FAIL come from checker-\*; UPHOLD/OVERRULE from judge-\* or boss)"
# ...and stamping the judge file with the right fingerprint changes nothing.
mkverdict "$sd" p1 1 judge-x PASS adversarial
run_gate "$sd" check p1; assert_rc "tier3 fingerprinted judge-named PASS still rejects" 1 $?

# P2: the same hole at tier 2 with `second` named — checker-tests and
# checker-second share a lane, a judge-named PASS must not add the second.
sd=$(newswarm)
mkledger "$sd" 'p2\t2\ttests,second\tverifying\t1\tworker-coder\t-\n'
mkverdict "$sd" p2 1 checker-tests  PASS anthropic
mkverdict "$sd" p2 1 checker-second PASS anthropic
mkverdict "$sd" p2 1 judge-x        PASS adversarial
run_gate "$sd" check p2; assert_rc "tier2 second: a judge-named PASS cannot supply the second lane" 1 $?

# P3: every mis-paired VERDICT/CHECKER — an allow-list with exact identity
# boundaries. Each row sits beside a genuine checker-tests PASS at tier 2, so
# the only defect is the pairing. `checker`/`judge` without the dash, `boss-2`,
# `Boss`, `checkerx-y`, worker-coder and lead may cast nothing.
pair_case() { # who verdict family
  local who="$1" verdict="$2" fam="$3" sd out rc
  sd=$(newswarm)
  mkledger "$sd" 'p3\t2\ttests\tverifying\t1\tworker-coder\t-\n'
  mkverdict "$sd" p3 1 checker-tests PASS anthropic
  mkverdict "$sd" p3 1 "$who" "$verdict" "$fam"
  out=$(gate_out "$sd" check p3); rc=$?
  assert_rc "tier2 $verdict from '$who' is invalid" 1 $rc
  assert_grep "tier2 $verdict from '$who' names both in the message" "$out" "VERDICT $verdict not allowed from CHECKER '$who'"
}
pair_case judge-x       PASS     adversarial
pair_case judge-x       FAIL     adversarial
pair_case boss          PASS     anthropic
pair_case boss          FAIL     anthropic
pair_case worker-coder  PASS     impact
pair_case lead          UPHOLD   impact
pair_case checker       PASS     impact
pair_case checkerx-y    PASS     impact
pair_case judge         OVERRULE impact
pair_case boss-2        OVERRULE impact
pair_case Boss          OVERRULE impact
pair_case checker-rogue UPHOLD   impact
pair_case checker-rogue OVERRULE impact
pair_case worker-coder  OVERRULE impact

# P4: tier 1 loads only the named checkers' files. A named file that carries
# a judge's verdict is invalid; an UNNAMED mis-paired stray is never read.
sd=$(newswarm)
mkledger "$sd" 'p4a\t1\ttests\tverifying\t1\tworker-coder\t-\n'
mkverdict "$sd" p4a 1 checker-tests OVERRULE anthropic
out=$(gate_out "$sd" check p4a); rc=$?
assert_rc "tier1 named checker file casting OVERRULE rejects" 1 $rc
assert_grep "tier1 named checker file casting OVERRULE names the pairing" "$out" "VERDICT OVERRULE not allowed from CHECKER 'checker-tests'"
sd=$(newswarm)
mkledger "$sd" 'p4b\t1\ttests\tverifying\t1\tworker-coder\t-\n'
mkverdict "$sd" p4b 1 checker-tests PASS anthropic
mkverdict "$sd" p4b 1 judge-x PASS adversarial
run_gate "$sd" check p4b; assert_rc "tier1 ignores an unnamed mis-paired stray" 0 $?

# P5: tier 3 — a checker-cast UPHOLD beside two genuine lanes is invalid.
sd=$(newswarm)
mkledger "$sd" 'p5\t3\ttests,second\tverifying\t1\tworker-coder\t-\n'
mktier3 "$sd" p5 1
mkverdict "$sd" p5 1 checker-tests  PASS anthropic
mkverdict "$sd" p5 1 checker-second PASS adversarial
run_gate "$sd" check p5; assert_rc "tier3 control: two genuine lanes accept" 0 $?
mkverdict "$sd" p5 1 checker-a11y UPHOLD impact
run_gate "$sd" check p5; assert_rc "tier3 a checker-cast UPHOLD rejects" 1 $?

# P6: the panel that sets a FAIL aside must be judge-*/boss votes. Two
# judge OVERRULEs plus a checker-cast OVERRULE are only two valid votes — and
# the invalid file hard-fails the row anyway.
sd=$(newswarm)
mkledger "$sd" 'p6\t2\ttests\tverifying\t1\tworker-coder\t-\n'
mkverdict "$sd" p6 1 checker-tests FAIL anthropic
mkverdict "$sd" p6 1 judge-claude    OVERRULE anthropic
mkverdict "$sd" p6 1 judge-standards OVERRULE adversarial
mkverdict "$sd" p6 1 checker-rogue   OVERRULE impact
run_gate "$sd" check p6; assert_rc "a checker-cast OVERRULE cannot make the third panel vote" 1 $?

# P7: control — the valid boss side. A disputed FAIL resolved by two judge
# OVERRULEs and a boss UPHOLD (three valid votes, OVERRULE majority) accepts.
sd=$(newswarm)
mkledger "$sd" 'p7\t2\ttests\tverifying\t1\tworker-coder\t-\n'
mkverdict "$sd" p7 1 checker-tests FAIL anthropic
mkverdict "$sd" p7 1 judge-standards OVERRULE adversarial
mkverdict "$sd" p7 1 judge-impact    OVERRULE impact
mkverdict "$sd" p7 1 boss            UPHOLD   anthropic
run_gate "$sd" check p7; assert_rc "boss UPHOLD is a valid panel vote (control)" 0 $?

# P8: control — a mis-paired file at an OLD attempt does not block the
# current attempt's acceptance (the current-attempt walk never reads it).
sd=$(newswarm)
mkledger "$sd" 'p8\t2\ttests\tverifying\t2\tworker-coder\t-\n'
mkverdict "$sd" p8 1 judge-x PASS adversarial
mkverdict "$sd" p8 2 checker-tests PASS anthropic
run_gate "$sd" check p8; assert_rc "mis-paired file at an old attempt does not block" 0 $?

# P9: stats — a judge-cast FAIL is not a failed first attempt (the file is
# invalid and is skipped), so a genuine PASS beside it stays clean.
sd=$(newswarm)
mkledger "$sd" 'p9\t2\ttests\taccepted\t1\tworker-coder\t-\n'
mkverdict "$sd" p9 1 checker-tests PASS anthropic
mkverdict "$sd" p9 1 judge-x FAIL adversarial
out=$(gate_out "$sd" stats); rc=$?
assert_rc "stats exits 0 beside a mis-paired FAIL" 0 $rc
assert_grep "stats ignores a judge-cast FAIL" "$out" "stats: p9 tier=2 first-attempt=1 clean"

# --- CD3: critical-glob evaluation fails CLOSED at `check`. A critical.globs,
# test.globs or <task>.*.files manifest that is present but not a readable
# regular file of valid UTF-8 is an UNREADABLE evaluation — it counts as a hit
# with the reason critical-glob-unreadable, so a tier-1/2 row with no flag is
# refused inline exactly as for critical-glob (escalate-scan was never run).

# c_case LABEL TASK TIER SETUP NEEDLE — a row whose evidence would otherwise
# accept (PASS + fingerprint, one manifest that matches nothing critical), then
# SETUP (eval'd with $sd) breaks one input.
c_case() {
  local label="$1" t="$2" tier="$3" setup="$4" needle="$5" sd rc out err
  sd=$(newswarm)
  mkledger "$sd" "$t\t$tier\ttests\tverifying\t1\tw\t-\n"
  mkverdict "$sd" "$t" 1 checker-tests PASS anthropic
  printf 'swarm/**\n' > "$sd/critical.globs"
  eval "$setup"
  run_gate "$sd" check "$t"; rc=$?
  out=$(gate_stdout "$sd" check "$t"); err=$(gate_stderr "$sd" check "$t")
  chmod -R u+rwX "$sd" 2>/dev/null
  assert_rc "$label: tier $tier row is refused inline (unreadable input, fail closed)" 1 $rc
  assert_grep "$label: the FAIL line carries critical-glob-unreadable" "$out" "critical-glob-unreadable"
  assert_one_line "$label: one unreadable diagnostic line naming $needle" "$err" "$needle"
}
for tier in 1 2; do
  if ! is_root; then
    c_case "unreadable critical.globs (mode 000)" "c1t$tier" $tier 'chmod 000 "$sd/critical.globs"' critical.globs
    c_case "unreadable test.globs (mode 000)"     "c4t$tier" $tier 'echo x > "$sd/test.globs"; chmod 000 "$sd/test.globs"' test.globs
    c_case "unreadable current manifest (mode 000)" "c7t$tier" $tier 'chmod 000 "$sd/manifests/c7t'$tier'.1.files"' "c7t$tier.1.files"
  fi
  c_case "unreadable critical.globs (a directory)"     "c2t$tier" $tier 'rm "$sd/critical.globs"; mkdir "$sd/critical.globs"' critical.globs
  c_case "unreadable critical.globs (not valid UTF-8)" "c3t$tier" $tier 'printf "swarm/**\n\xff\n" > "$sd/critical.globs"' critical.globs
  c_case "unreadable test.globs (not valid UTF-8)"     "c5t$tier" $tier 'printf "\xff\xfe\n" > "$sd/test.globs"' test.globs
  c_case "unreadable test.globs (a directory: not the defaults)" "c6t$tier" $tier 'mkdir "$sd/test.globs"' test.globs
  c_case "unreadable OLDER attempt manifest (not valid UTF-8)" "c8t$tier" $tier 'printf "\xff\xfe\n" > "$sd/manifests/c8t'$tier'.0.files"' "c8t$tier.0.files"
  c_case "unreadable manifest entry (a directory matching <task>.*.files)" "c9t$tier" $tier 'mkdir "$sd/manifests/c9t'$tier'.0.files"' "c9t$tier.0.files"
done

# Tier 3 cannot escalate further, so unreadable globs never block it inline
# (the same cap as critical-glob; mirrors escalate-scan, which writes no flag).
sd=$(newswarm)
mkledger "$sd" 'c10\t3\ttests,second\tverifying\t1\tworker-coder\t-\n'
printf 'swarm/**\n' > "$sd/critical.globs"; printf '\xff\xfe\n' > "$sd/test.globs"
mktier3 "$sd" c10 1
mkverdict "$sd" c10 1 checker-tests  PASS anthropic
mkverdict "$sd" c10 1 checker-second PASS adversarial
run_gate "$sd" check c10; assert_rc "unreadable globs at tier 3 need no flag (control)" 0 $?

# The full path: unreadable -> escalate-scan flags it -> check refuses at the
# old tier ("escalation pending") -> accepts once the row is re-verified at the
# target tier.
sd=$(newswarm)
mkledger "$sd" 'c11\t2\ttests\tverifying\t1\tworker-coder\t-\n'
mkverdict "$sd" c11 1 checker-tests PASS anthropic
printf 'swarm/**\n' > "$sd/critical.globs"; printf '\xff\xfe\n' > "$sd/test.globs"
run_gate "$sd" escalate-scan
assert_reason "escalate-scan flags the unreadable evaluation" "$sd" c11 critical-glob-unreadable
out=$(gate_out "$sd" check c11); rc=$?
assert_rc "flagged unreadable row still refused at the old tier" 1 $rc
assert_grep "the refusal is the flag's escalation-pending message" "$out" "escalation pending"
mkledger "$sd" 'c11\t3\ttests,second\tverifying\t1\tworker-coder\t-\n'
mktier3 "$sd" c11 1
mkverdict "$sd" c11 1 checker-second PASS adversarial
run_gate "$sd" check c11; assert_rc "unreadable-flagged row accepts once re-verified at the target tier" 0 $?

# Controls: valid inputs behave exactly as before — no diagnostic, accepted.
sd=$(newswarm)
mkledger "$sd" 'c12\t2\ttests\tverifying\t1\tworker-coder\t-\n'
mkverdict "$sd" c12 1 checker-tests PASS anthropic
printf 'swarm/**\n' > "$sd/critical.globs"; printf 'nomatch\n' > "$sd/test.globs"
err=$(gate_stderr "$sd" check c12)
run_gate "$sd" check c12; assert_rc "readable critical.globs and test.globs, no match: accepts" 0 $?
assert_eq "readable inputs: no unreadable diagnostic" "$err" ""
sd=$(newswarm)
mkledger "$sd" 'c13\t2\ttests\tverifying\t1\tworker-coder\t-\n'
mkverdict "$sd" c13 1 checker-tests PASS anthropic
run_gate "$sd" check c13; assert_rc "no critical.globs at all: accepts (absent is not unreadable)" 0 $?
sd=$(newswarm)
mkledger "$sd" 'c14\t2\ttests\tverifying\t1\tworker-coder\t-\n'
mkmanifest "$sd" c14 1 "docs/caf$(printf '\xc3\xa9').md"   # valid UTF-8, non-ASCII path
mkverdict "$sd" c14 1 checker-tests PASS anthropic
printf 'swarm/**\n' > "$sd/critical.globs"
LC_ALL=C LANG=C PYTHONUTF8=0 run_gate "$sd" check c14
assert_rc "valid non-ASCII UTF-8 manifest under LC_ALL=C is read, not unreadable: accepts" 0 $?

# --- CD4: the Codex lane (run CD). swarm/codex-check.sh writes one outcome per
# (task, attempt): a checker-codex verdict (FAMILY crossvendor) or a
# checker-codex.skip record. Trial rule (D2): a Codex FAIL counts, a Codex PASS
# never does, an outage never blocks. `codex` in the checks column is never a
# named checker; naming it demands ONE valid outcome at the CURRENT attempt.

# cx_case LABEL WANT_RC TIER CHECKS SETUP [NEEDLE] — a row `cx` at attempt 1
# with a checker-tests PASS (and a checker-second PASS when `second` is named,
# and a passing oracle at tier 3), then SETUP (eval'd with $sd) adds the Codex
# evidence under test. NEEDLE, when given, must appear in the gate's FAIL line.
cx_case() {
  local label="$1" want="$2" tier="$3" checks="$4" setup="$5" needle="${6:-}" sd out rc
  sd=$(newswarm)
  mkledger "$sd" "cx\t$tier\t$checks\tverifying\t1\tworker-coder\t-\n"
  mkverdict "$sd" cx 1 checker-tests PASS anthropic
  [[ "$checks" == *second* ]] && mkverdict "$sd" cx 1 checker-second PASS adversarial
  (( tier == 3 )) && mktier3 "$sd" cx 1
  eval "$setup"
  # `timeout` turns a hang (a FIFO skip record opened by mistake) into a failed assertion
  out=$(env ${CX_LOC:+LC_ALL=$CX_LOC} SWARM_DIR="$sd" SWARM_TREE="$sd/tree" timeout 30 bash "$GATE" check cx 2>&1); rc=$?
  assert_rc "codex: $label" "$want" "$rc"
  [[ -z "$needle" ]] || assert_grep "codex: $label (the refusal names '$needle')" "$out" "$needle"
}
cx_panel() {  # sd — a judge panel that overrules (2 of 3), for the dispute path
  mkverdict "$1" cx 1 judge-claude    OVERRULE anthropic
  mkverdict "$1" cx 1 judge-standards OVERRULE adversarial
  mkverdict "$1" cx 1 judge-impact    UPHOLD   impact
}
CXE='missing checker-codex evidence (attempt 1)'

# identity: crossvendor <=> checker-codex, in both directions
cx_case "crossvendor is a valid FAMILY for checker-codex (named, PASS beside a real PASS)" 0 2 tests,codex 'mkcodex "$sd" cx 1 PASS'
cx_case "checker-codex with FAMILY adversarial is an invalid verdict" 1 2 tests 'mkverdict "$sd" cx 1 checker-codex PASS adversarial' invalid
cx_case "checker-codex with FAMILY anthropic, tier 1 named, is an invalid verdict" 1 1 tests,codex 'mkverdict "$sd" cx 1 checker-codex PASS anthropic' invalid
cx_case "checker-tests with FAMILY crossvendor is an invalid verdict" 1 2 tests 'mkverdict "$sd" cx 1 checker-tests PASS crossvendor' invalid
cx_case "a judge-cast OVERRULE with FAMILY crossvendor is an invalid verdict" 1 2 tests 'mkverdict "$sd" cx 1 judge-x OVERRULE crossvendor' invalid

# evidence: a named codex needs ONE valid outcome at the current attempt, at every tier
for tier in 1 2 3; do
  cx_case "tier $tier names codex, no outcome at all: refused" 1 $tier tests,second,codex ':' "$CXE"
  cx_case "tier $tier names codex, a valid skip record: accepted (an outage never blocks)" 0 $tier tests,second,codex 'mkskip "$sd" cx 1 quota'
  cx_case "tier $tier names codex, a Codex PASS: accepted" 0 $tier tests,second,codex 'mkcodex "$sd" cx 1 PASS'
  cx_case "tier $tier names codex, BOTH a verdict and a skip record: refused (tampering fails closed)" 1 $tier tests,second,codex 'mkcodex "$sd" cx 1 PASS; mkskip "$sd" cx 1 quota' checker-codex
  cx_case "tier $tier: checks = codex only is refused like a blank column" 1 $tier codex 'mkcodex "$sd" cx 1 PASS' 'requires named checkers'
done
for r in no-exclude-policy no-criteria no-evidence no-codex docker-unavailable unsafe-tree fingerprint-mismatch container-error auth quota timeout schema-invalid evidence-free-pass secret-leak codex-error; do
  cx_case "skip reason '$r' is evidence" 0 2 tests,codex "mkskip \"\$sd\" cx 1 $r"
done
cx_case "an unknown skip REASON is not evidence" 1 2 tests,codex 'mkskip "$sd" cx 1 bogus-reason' "$CXE"
cx_case "a REASON made of two adjacent valid ones ('auth quota') is not evidence" 1 2 tests,codex 'mkskip "$sd" cx 1 "auth quota"' "$CXE"
cx_case "a skip whose TASK disagrees with its filename is not evidence" 1 2 tests,codex 'mkskip "$sd" other 1 quota; mv "$sd/verdicts/other.1.checker-codex.skip" "$sd/verdicts/cx.1.checker-codex.skip"' "$CXE"
cx_case "a skip whose ATTEMPT disagrees with its filename is not evidence" 1 2 tests,codex 'mkskip "$sd" cx 2 quota; mv "$sd/verdicts/cx.2.checker-codex.skip" "$sd/verdicts/cx.1.checker-codex.skip"' "$CXE"
cx_case "a skip with an empty DETAIL is not evidence" 1 2 tests,codex 'mkskip "$sd" cx 1 quota ""' "$CXE"
cx_case "a skip with no DETAIL line is not evidence" 1 2 tests,codex 'printf "REASON: quota\nTASK: cx\nATTEMPT: 1\n" > "$sd/verdicts/cx.1.checker-codex.skip"' "$CXE"
cx_case "a skip record that is a directory is never opened: not evidence" 1 2 tests,codex 'mkdir "$sd/verdicts/cx.1.checker-codex.skip"' "$CXE"
cx_case "a skip record that is a FIFO is never opened (no hang): not evidence" 1 2 tests,codex 'mkfifo "$sd/verdicts/cx.1.checker-codex.skip"' "$CXE"
cx_case "a skip record with a NUL byte is not evidence" 1 2 tests,codex 'printf "REASON: qu\0ota\nDETAIL: d\nTASK: cx\nATTEMPT: 1\n" > "$sd/verdicts/cx.1.checker-codex.skip"' "$CXE"
if ! is_root; then
  cx_case "a mode-000 skip record is unreadable: not evidence" 1 2 tests,codex 'mkskip "$sd" cx 1 quota; chmod 000 "$sd/verdicts/cx.1.checker-codex.skip"' "$CXE"
fi
cx_case "first-match headers: a valid REASON first, a bogus one later: evidence" 0 2 tests,codex 'printf "REASON: quota\nDETAIL: d\nTASK: cx\nATTEMPT: 1\nREASON: bogus\n" > "$sd/verdicts/cx.1.checker-codex.skip"'
cx_case "first-match headers: a bogus REASON first, a valid one later: not evidence" 1 2 tests,codex 'printf "REASON: bogus\nDETAIL: d\nTASK: cx\nATTEMPT: 1\nREASON: quota\n" > "$sd/verdicts/cx.1.checker-codex.skip"' "$CXE"
# evidence at an older attempt never counts
sd=$(newswarm)
mkledger "$sd" 'cx\t2\ttests,codex\tverifying\t2\tworker-coder\t-\n'
mkcodex "$sd" cx 1 PASS; mkskip "$sd" cx 1 quota
mkverdict "$sd" cx 2 checker-tests PASS anthropic
out=$(gate_out "$sd" check cx); rc=$?
assert_rc "codex: outcomes only at an OLDER attempt do not count" 1 $rc
assert_grep "codex: the stale-attempt refusal names the current attempt" "$out" 'missing checker-codex evidence (attempt 2)'
# codex NOT named: skip records are ignored; Codex verdicts still load
cx_case "codex not named: a skip record is ignored" 0 2 tests 'mkskip "$sd" cx 1 quota'
cx_case "codex not named: a bogus skip record is ignored" 0 2 tests 'mkskip "$sd" cx 1 bogus'
cx_case "codex not named: a Codex PASS is loaded, not invalid" 0 2 tests 'mkcodex "$sd" cx 1 PASS'

# a Codex PASS never counts: no named-checker requirement, no lane
cx_case "tier 3: a Codex PASS does not supply the second lane" 1 3 tests,codex 'mkcodex "$sd" cx 1 PASS' famil
cx_case "tier 3, codex not named: an unnamed Codex PASS is no lane either" 1 3 tests 'mkcodex "$sd" cx 1 PASS' famil
cx_case "tier 2: a Codex PASS does not stand in for a missing checker-second" 1 2 tests,second,codex 'rm "$sd/verdicts/cx.1.checker-second.verdict"; mkcodex "$sd" cx 1 PASS' checker-second
cx_case "tier 2: a Codex PASS does not widen a same-lane second" 1 2 tests,second,codex 'mkverdict "$sd" cx 1 checker-second PASS anthropic; mkcodex "$sd" cx 1 PASS' lane
cx_case "tier 3: tests + second + codex, all PASS: accepted" 0 3 tests,second,codex 'mkcodex "$sd" cx 1 PASS'
cx_case "a Codex PASS without MANIFEST_SHA256 is refused like any checker PASS" 1 2 tests,codex 'mkcodex "$sd" cx 1 PASS; sed -i "/^MANIFEST_SHA256/d" "$sd/verdicts/cx.1.checker-codex.verdict"' MANIFEST_SHA256

# a Codex FAIL is a FAIL wherever it is loaded
cx_case "tier 1, codex named: a Codex FAIL is refused" 1 1 tests,codex 'mkcodex "$sd" cx 1 FAIL' 'checker-codex returned FAIL'
cx_case "tier 1, codex not named: a Codex FAIL is ignored" 0 1 tests 'mkcodex "$sd" cx 1 FAIL'
for tier in 2 3; do
  cx_case "tier $tier, codex named: a Codex FAIL opens a dispute" 1 $tier tests,second,codex 'mkcodex "$sd" cx 1 FAIL' dispute
  cx_case "tier $tier, codex NOT named: a Codex FAIL still opens a dispute" 1 $tier tests,second 'mkcodex "$sd" cx 1 FAIL' dispute
  cx_case "tier $tier: a Codex FAIL set aside by a judge panel: accepted" 0 $tier tests,second,codex 'mkcodex "$sd" cx 1 FAIL; cx_panel "$sd"'
  cx_case "tier $tier: a Codex FAIL upheld by the panel: refused" 1 $tier tests,second,codex 'mkcodex "$sd" cx 1 FAIL; mkverdict "$sd" cx 1 judge-claude UPHOLD anthropic; mkverdict "$sd" cx 1 judge-standards UPHOLD adversarial; mkverdict "$sd" cx 1 judge-impact OVERRULE impact' upheld
done
cx_case "a named FAIL set aside by a panel still needs Codex evidence" 1 2 tests,codex 'mkverdict "$sd" cx 1 checker-tests FAIL anthropic; cx_panel "$sd"' "$CXE"

# stats: per-task codex=/second= fields on the CURRENT attempt, and the summary line
sd=$(newswarm)
mkledger "$sd" 's1\t2\ttests,second,codex\tchecking\t2\tw\tr\ns2\t2\ttests,second,codex\tchecking\t1\tw\tr\ns3\t2\ttests,second\tchecking\t1\tw\tr\ns5\t2\ttests,second,codex\tchecking\t1\tw\tr\ns6\t2\ttests,codex\tchecking\t1\tw\tr\ns7\t2\ttests,second,codex\tchecking\t1\tw\tr\ns8\t2\ttests,codex\tchecking\t1\tw\tr\ns9\t2\ttests,second,codex\tno-change\t1\tw\tr\n'
mkcodex "$sd" s1 1 FAIL; mkverdict "$sd" s1 1 checker-second PASS adversarial
mkcodex "$sd" s1 2 PASS; mkverdict "$sd" s1 2 checker-second PASS adversarial
mkskip "$sd" s2 1 quota; mkverdict "$sd" s2 1 checker-second FAIL adversarial
mkverdict "$sd" s3 1 checker-second PASS adversarial
mkcodex "$sd" s5 1 FAIL; mkverdict "$sd" s5 1 checker-second FAIL adversarial
mkcodex "$sd" s6 1 FAIL; mkverdict "$sd" s6 1 checker-tests PASS anthropic
mkskip "$sd" s7 1 bogus-reason; mkverdict "$sd" s7 1 checker-second PASS adversarial
mkcodex "$sd" s8 1 PASS; mkskip "$sd" s8 1 quota
mkcodex "$sd" s9 1 FAIL
out=$(gate_out "$sd" stats); rc=$?
assert_rc "codex: stats exits 0" 0 $rc
assert_grep "codex: stats line ends 'codex=PASS second=PASS' at the current attempt" "$out" 'stats: s1 .*first-attempt=1 failed.* elapsed=[^ ]* codex=PASS second=PASS$'
assert_grep "codex: stats reports a skip as codex=skip:<reason>" "$out" 'stats: s2 .* codex=skip:quota second=FAIL$'
assert_grep "codex: stats reports none/none-like rows" "$out" 'stats: s3 .* codex=none second=PASS$'
assert_grep "codex: stats reports FAIL/FAIL" "$out" 'stats: s5 .* codex=FAIL second=FAIL$'
assert_grep "codex: stats reports no checker-second as second=none" "$out" 'stats: s6 .* codex=FAIL second=none$'
assert_grep "codex: stats reads an invalid skip record as none" "$out" 'stats: s7 .* codex=none second=PASS$'
assert_grep "codex: stats lets a valid verdict win over a skip record" "$out" 'stats: s8 .* codex=PASS second=none$'
assert_grep "codex: a no-change stats line is unchanged" "$out" '^stats: s9 tier=2 no-change (excluded)$'
assert_grep "codex: the summary line counts every (row, attempt) pair" "$out" '^codex: ran 5/6, FAIL 3, same-verdict-as-second 2, codex-only FAIL 2$'
assert_eq "codex: the summary line follows the existing summary lines" "$(grep -A1 '^elapsed total:' <<<"$out" | tail -1 | cut -c1-7)" 'codex: '
sd=$(newswarm)
mkledger "$sd" 'z\t2\ttests\tchecking\t1\tw\tr\n'
out=$(gate_out "$sd" stats)
assert_grep "codex: stats with no Codex evidence reads 0/0" "$out" '^codex: ran 0/0, FAIL 0, same-verdict-as-second 0, codex-only FAIL 0$'
assert_grep "codex: a no-evidence stats line is unchanged" "$out" '^stats: z tier=2 no evidence yet (status=checking)$'
# a dot-prefix sibling's outcomes are never the row's own
sd=$(newswarm)
mkledger "$sd" 'k\t2\ttests\tchecking\t1\tw\tr\nk.1\t2\ttests\tchecking\t1\tw\tr\n'
mkcodex "$sd" k.1 1 FAIL
out=$(gate_out "$sd" stats)
assert_grep "codex: a dotted sibling's Codex FAIL counts once, for the sibling only" "$out" '^codex: ran 1/1, FAIL 1, same-verdict-as-second 0, codex-only FAIL 1$'
assert_grep "codex: the sibling's outcome does not leak into task k" "$out" 'stats: k tier=2 no evidence yet'

# --- CD4 attempt 2: skip-record headers are locale-proof; a non-regular or
# unreadable verdict entry is an INVALID verdict; NUL anywhere invalidates a skip.

# Item 1: only LEADING ASCII whitespace is stripped from a header value, and the
# answer never depends on the caller's locale. CX_LOC makes cx_case run the gate
# under that locale (LC_ALL); the tests SET a UTF-8 locale themselves, so a
# `sed` that runs in the caller's locale (under UTF-8 glibc [[:space:]] strips
# U+2003) fails here on any host that has one, whatever locale this suite runs in.
CXU=$(locale -a 2>/dev/null | grep -ixE 'c\.utf-?8' | head -1)
[[ -n "$CXU" ]] || CXU=$(locale -a 2>/dev/null | grep -ixE 'en_US\.utf-?8' | head -1)
CXLOCS="C"; [[ -z "$CXU" ]] || CXLOCS="C $CXU"
[[ -n "$CXU" ]] || echo "note - codex: no UTF-8 locale on this host; the locale tests run under C only"
cxskip() { printf "$1" > "$sd/verdicts/cx.1.checker-codex.skip"; }   # printf-format text, eval'd via a setup string
for loc in $CXLOCS; do
  CX_LOC=$loc
  cx_case "[$loc] DETAIL:<U+2003> is a non-empty DETAIL (valid skip)" 0 2 tests,codex 'cxskip "REASON: quota\nDETAIL:\xe2\x80\x83\nTASK: cx\nATTEMPT: 1\n"'
  cx_case "[$loc] DETAIL: <NBSP> is a non-empty DETAIL (valid skip)" 0 2 tests,codex 'cxskip "REASON: quota\nDETAIL: \xc2\xa0\nTASK: cx\nATTEMPT: 1\n"'
  cx_case "[$loc] DETAIL:<VT> strips to empty (invalid skip)" 1 2 tests,codex 'cxskip "REASON: quota\nDETAIL:\v\nTASK: cx\nATTEMPT: 1\n"' "$CXE"
  cx_case "[$loc] REASON:<U+2003>quota is no known reason" 1 2 tests,codex 'cxskip "REASON:\xe2\x80\x83quota\nDETAIL: d\nTASK: cx\nATTEMPT: 1\n"' "$CXE"
  cx_case "[$loc] REASON:<U+3000>auth is no known reason" 1 1 tests,codex 'cxskip "REASON:\xe3\x80\x80auth\nDETAIL: d\nTASK: cx\nATTEMPT: 1\n"' "$CXE"
  cx_case "[$loc] TASK:<U+2003>cx does not match the filename" 1 2 tests,codex 'cxskip "REASON: quota\nDETAIL: d\nTASK:\xe2\x80\x83cx\nATTEMPT: 1\n"' "$CXE"
  cx_case "[$loc] ATTEMPT:<U+2003>1 does not match the filename" 1 2 tests,codex 'cxskip "REASON: quota\nDETAIL: d\nTASK: cx\nATTEMPT:\xe2\x80\x831\n"' "$CXE"
  cx_case "[$loc] REASON: quota<U+2003> (trailing whitespace is never stripped) is no known reason" 1 2 tests,codex 'cxskip "REASON: quota\xe2\x80\x83\nDETAIL: d\nTASK: cx\nATTEMPT: 1\n"' "$CXE"
  cx_case "[$loc] leading TAB and several spaces are stripped (valid skip)" 0 2 tests,codex 'cxskip "REASON:\t  quota\nDETAIL:\t d\nTASK:   cx\nATTEMPT: \t1\n"'
done
unset CX_LOC
# the stats view of the same records is identical in every locale
sd=$(newswarm)
mkledger "$sd" 'l1\t2\ttests,codex\tchecking\t1\tw\tr\nl2\t2\ttests,codex\tchecking\t1\tw\tr\n'
mkverdict "$sd" l1 1 checker-tests PASS anthropic; mkverdict "$sd" l2 1 checker-tests PASS anthropic
printf 'REASON: quota\nDETAIL:\xe2\x80\x83\nTASK: l1\nATTEMPT: 1\n' > "$sd/verdicts/l1.1.checker-codex.skip"
printf 'REASON:\xe2\x80\x83quota\nDETAIL: d\nTASK: l2\nATTEMPT: 1\n' > "$sd/verdicts/l2.1.checker-codex.skip"
ref=""
for loc in $CXLOCS; do
  out=$(env LC_ALL=$loc SWARM_DIR="$sd" SWARM_TREE="$sd/tree" bash "$GATE" stats 2>&1)
  assert_grep "codex: [$loc] stats reads a DETAIL of U+2003 as a valid skip" "$out" 'stats: l1 .* codex=skip:quota second=none$'
  assert_grep "codex: [$loc] stats reads REASON:<U+2003>quota as no outcome" "$out" 'stats: l2 .* codex=none second=none$'
  [[ -n "$ref" ]] && assert_eq "codex: stats output under $loc equals the first locale's" "$out" "$ref"
  [[ -n "$ref" ]] || ref="$out"
done

# Item 2(a): tier 1, codex named — ANY directory entry named <t>.<a>.checker-codex.verdict
# that is not a valid verdict refuses the row, even beside a valid skip record.
CXI='invalid verdict checker-codex'
CXV='"$sd/verdicts/cx.1.checker-codex.verdict"'
cx_case "tier 1, codex named: a DANGLING-symlink verdict entry beside a valid skip is refused" 1 1 tests,codex 'mkskip "$sd" cx 1 quota; ln -s nowhere "$sd/verdicts/cx.1.checker-codex.verdict"' "$CXI"
cx_case "tier 1, codex named: a dangling-symlink verdict entry and no skip is refused as invalid" 1 1 tests,codex 'ln -s nowhere "$sd/verdicts/cx.1.checker-codex.verdict"' "$CXI"
cx_case "tier 1, codex named: a symlink-LOOP verdict entry beside a valid skip is refused" 1 1 tests,codex 'mkskip "$sd" cx 1 quota; ln -s cx.1.checker-codex.verdict "$sd/verdicts/cx.1.checker-codex.verdict"' "$CXI"
cx_case "tier 1, codex named: a DIRECTORY named as the verdict beside a valid skip is refused" 1 1 tests,codex 'mkskip "$sd" cx 1 quota; mkdir "$sd/verdicts/cx.1.checker-codex.verdict"' "$CXI"
cx_case "tier 1, codex named: a FIFO named as the verdict (never opened, no hang) beside a valid skip is refused" 1 1 tests,codex 'mkskip "$sd" cx 1 quota; mkfifo "$sd/verdicts/cx.1.checker-codex.verdict"' "$CXI"
cx_case "tier 1, codex named: an INVALID verdict (no ---) beside a valid skip is refused, not accepted" 1 1 tests,codex 'mkskip "$sd" cx 1 quota; printf "VERDICT: PASS\nCHECKER: checker-codex\nFAMILY: crossvendor\nTASK: cx\nATTEMPT: 1\n" > "$sd/verdicts/cx.1.checker-codex.verdict"' "$CXI"
cx_case "tier 1, codex named: a verdict with a bad FAMILY beside a valid skip is refused" 1 1 tests,codex 'mkskip "$sd" cx 1 quota; mkverdict "$sd" cx 1 checker-codex PASS adversarial' "$CXI"
if ! is_root; then
  cx_case "tier 1, codex named: a MODE-000 verdict beside a valid skip is refused" 1 1 tests,codex 'mkskip "$sd" cx 1 quota; mkcodex "$sd" cx 1 PASS; chmod 000 "$sd/verdicts/cx.1.checker-codex.verdict"' "$CXI"
fi
cx_case "tier 1, codex NOT named: a dangling-symlink Codex verdict entry is ignored" 0 1 tests 'ln -s nowhere "$sd/verdicts/cx.1.checker-codex.verdict"'
cx_case "tier 1, codex NOT named: a directory named as the Codex verdict is ignored" 0 1 tests 'mkdir "$sd/verdicts/cx.1.checker-codex.verdict"'
cx_case "tier 2, codex named: a directory named as the verdict is refused as invalid" 1 2 tests,second,codex 'mkdir "$sd/verdicts/cx.1.checker-codex.verdict"' 'invalid verdict'
cx_case "tier 3, codex named: a FIFO named as the verdict (no hang) is refused as invalid" 1 3 tests,second,codex 'mkskip "$sd" cx 1 quota; mkfifo "$sd/verdicts/cx.1.checker-codex.verdict"' 'invalid verdict'
cx_case "tier 2: a directory named as another checker's verdict is refused as invalid" 1 2 tests 'mkdir "$sd/verdicts/cx.1.checker-other.verdict"' 'invalid verdict'
cx_case "tier 2: a FIFO named as another checker's verdict (no hang) is refused as invalid" 1 2 tests 'mkfifo "$sd/verdicts/cx.1.checker-other.verdict"' 'invalid verdict'

# A NUL byte ANYWHERE in a skip record makes it invalid (the attempt-1 rule, pinned).
cx_case "a NUL inside DETAIL makes the skip record invalid" 1 2 tests,codex 'cxskip "REASON: quota\nDETAIL: pro\0be\nTASK: cx\nATTEMPT: 1\n"' "$CXE"
cx_case "a NUL on a line that is no header makes the skip record invalid" 1 2 tests,codex 'cxskip "REASON: quota\nDETAIL: d\nTASK: cx\nATTEMPT: 1\nnote: a\0b\n"' "$CXE"
cx_case "a trailing NUL makes the skip record invalid" 1 2 tests,codex 'cxskip "REASON: quota\nDETAIL: d\nTASK: cx\nATTEMPT: 1\n\0"' "$CXE"

# stats pairs run from attempt 0 (M-a), and only a VALID checker-second counts (M-c).
sd=$(newswarm)
mkledger "$sd" 'a0\t2\ttests,second,codex\tchecking\t1\tw\tr\n'
mkcodex "$sd" a0 0 FAIL; mkverdict "$sd" a0 0 checker-second PASS adversarial       # a Codex outcome at attempt 0
mkskip "$sd" a0 1 quota
out=$(gate_out "$sd" stats)
assert_grep "codex: stats counts (row, attempt) pairs from attempt 0" "$out" '^codex: ran 1/2, FAIL 1, same-verdict-as-second 0, codex-only FAIL 1$'
assert_grep "codex: stats reports the CURRENT attempt's skip record" "$out" 'stats: a0 .* codex=skip:quota second=none$'
sd=$(newswarm)
mkledger "$sd" 'b0\t2\ttests,second,codex\tchecking\t1\tw\tr\nb1\t2\ttests,second,codex\tchecking\t1\tw\tr\n'
mkcodex "$sd" b0 1 FAIL; mkcodex "$sd" b1 1 PASS
printf 'VERDICT: FAIL\nCHECKER: checker-second\nFAMILY: adversarial\nTASK: b0\nATTEMPT: 1\n' > "$sd/verdicts/b0.1.checker-second.verdict"     # INVALID: no ---
printf 'VERDICT: PASS\nCHECKER: checker-second\nFAMILY: adversarial\nTASK: b1\nATTEMPT: 1\n---\ne\n' > "$sd/verdicts/b1.1.checker-second.verdict"; chmod 000 "$sd/verdicts/b1.1.checker-second.verdict"
out=$(gate_out "$sd" stats)
assert_grep "codex: stats reads an INVALID checker-second beside a Codex FAIL as second=none" "$out" 'stats: b0 .* codex=FAIL second=none$'
if ! is_root; then
  assert_grep "codex: stats reads an UNREADABLE checker-second as second=none" "$out" 'stats: b1 .* codex=PASS second=none$'
  assert_grep "codex: an invalid checker-second is no same-verdict and no second FAIL" "$out" '^codex: ran 2/2, FAIL 1, same-verdict-as-second 0, codex-only FAIL 1$'
fi

# item 3: an UNNAMED Tier-1 Codex FAIL is ignored by acceptance only — it still counts
# toward two consecutive fails and in stats.
sd=$(newswarm)
mkledger "$sd" 'u1\t1\ttests\tverifying\t2\tw\t-\n'
mkverdict "$sd" u1 1 checker-tests PASS anthropic; mkcodex "$sd" u1 1 FAIL
mkverdict "$sd" u1 2 checker-tests PASS anthropic; mkcodex "$sd" u1 2 FAIL
out=$(gate_out "$sd" check u1); rc=$?
assert_rc "codex: tier 1, codex NOT named: two consecutive Codex FAILs still refuse the row (escalation)" 1 $rc
assert_grep "codex: the refusal names the two-consecutive-fails trigger" "$out" 'two-consecutive-fails'
out=$(gate_out "$sd" stats)
assert_grep "codex: stats counts an unnamed Tier-1 Codex FAIL as a failed first attempt" "$out" 'stats: u1 tier=1 first-attempt=1 failed .* codex=FAIL second=none$'

finish
