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
out=$(gate_out "$sd" done); rc=$?
assert_rc "no-change (see-SPEC) -> done ok" 0 $rc
echo "$out" | grep -qF "no-change: R9 (no-defect-found-root-cause-was-lead-shared-tree-see-SPEC)" \
  && echo "ok   - no-change (see-SPEC) line is visible in done output" \
  || { echo "FAIL - no-change (see-SPEC) line is visible in done output"; FAILN=$((FAILN+1)); }

# D8: no-change row with reason containing ruling-YYYY-MM-DD[letter] -> done rc 0, visible line
sd=$(newswarm)
mkledger "$sd" 'R9\t1\tcontent\tno-change\t0\tworker-coder\tno-defect-found-root-cause-was-lead-shared-tree-ruling-2026-08-20d\n'
out=$(gate_out "$sd" done); rc=$?
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

# ---------------------------------------------------------------------------
# 2026-09-18 gate hardening
# ---------------------------------------------------------------------------

# HD1: done does NOT re-hash the tree — an accepted row whose files were
# edited by a LATER task still closes (multi-run ledgers), while check on
# the same row would now reject.
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\taccepted\t0\tworker-coder\t-\n'
mkmanifest "$sd" a 0 web/page.html
mkverdict "$sd" a 0 checker-content PASS anthropic
echo later > "$sd/tree/web/page.html"
run_gate "$sd" check a; assert_rc "check rejects drifted tree" 1 $?
run_gate "$sd" done;    assert_rc "done tolerates later edits to an accepted row's files" 0 $?

# HD2: done DOES require the evidence set to be internally consistent — a
# PASS whose MANIFEST_SHA256 disagrees with the sidecar fails done.
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\taccepted\t0\tworker-coder\t-\n'
mkverdict "$sd" a 0 checker-content PASS anthropic
printf 'extra  more/paths\n' >> "$sd/manifests/a.0.sha256"   # sidecar edited after the verdict
run_gate "$sd" done; assert_rc "done rejects verdict/sidecar fingerprint mismatch" 1 $?

# HD3: done rejects an accepted row with no fingerprint sidecar.
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\taccepted\t0\tworker-coder\t-\n'
mkverdict "$sd" a 0 checker-content PASS anthropic
rm -f "$sd/manifests/a.0.sha256"
run_gate "$sd" done; assert_rc "done rejects accepted row without fingerprint" 1 $?

# HD4: done rejects an accepted critical-glob row that was never flagged.
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\taccepted\t0\tworker-coder\t-\n'
printf 'src/payments/**\n' > "$sd/critical.globs"
mkmanifest "$sd" a 0 src/payments/x.js
mkverdict "$sd" a 0 checker-content PASS anthropic
run_gate "$sd" done; assert_rc "done rejects unflagged critical-glob row" 1 $?

# --- CD2: lane accounting — `done` walks the same validator as `check`, so a
# row whose current attempt holds a mis-paired VERDICT/CHECKER is not complete.

# HD5: an accepted tier-2 row with a genuine checker PASS plus a judge-cast
# PASS -> done rejects, naming the pairing.
sd=$(newswarm)
mkledger "$sd" 'a\t2\tcontent\taccepted\t0\tworker-coder\t-\n'
mkverdict "$sd" a 0 checker-content PASS anthropic
mkverdict "$sd" a 0 judge-x PASS adversarial
out=$(gate_out "$sd" done); rc=$?
assert_rc "done rejects a row with a judge-cast PASS" 1 $rc
assert_grep "done names the pairing" "$out" "VERDICT PASS not allowed from CHECKER 'judge-x'"

# HD6: the reproduced hole (GH-29f) — a tier-3 row whose second lane comes from
# a judge-named file is not complete either.
sd=$(newswarm)
mkledger "$sd" 'a\t3\ttests\taccepted\t1\tworker-coder\t-\n'
mkdir -p "$sd/tier3/a"
printf '#!/usr/bin/env bash\necho "ORACLE PASS"\n' > "$sd/tier3/a/accept.sh"; chmod +x "$sd/tier3/a/accept.sh"
printf 'ORACLE PASS\n' > "$sd/tier3/a/oracle.1.log"
mkverdict "$sd" a 1 checker-tests PASS anthropic
mkverdict_nofp "$sd" a 1 judge-x PASS adversarial
run_gate "$sd" done; assert_rc "done rejects a tier-3 row with a judge-supplied second lane" 1 $?

# HD7: control — the same tier-3 row with two genuine checker lanes is done.
sd=$(newswarm)
mkledger "$sd" 'a\t3\ttests,second\taccepted\t1\tworker-coder\t-\n'
mkdir -p "$sd/tier3/a"
printf '#!/usr/bin/env bash\necho "ORACLE PASS"\n' > "$sd/tier3/a/accept.sh"; chmod +x "$sd/tier3/a/accept.sh"
printf 'ORACLE PASS\n' > "$sd/tier3/a/oracle.1.log"
mkverdict "$sd" a 1 checker-tests  PASS anthropic
mkverdict "$sd" a 1 checker-second PASS adversarial
run_gate "$sd" done; assert_rc "done accepts a tier-3 row with two genuine checker lanes (control)" 0 $?

# --- CD3: `done` walks the same escalation recomputation as `check`, so an
# accepted row whose critical-glob evaluation is UNREADABLE (fail closed) is
# not complete: it needs the flag and the higher tier, exactly like a row with
# a critical-glob hit and no flag (HD4).

# HD8: an accepted tier-2 row, critical.globs a directory -> done rejects and
# names critical-glob-unreadable.
sd=$(newswarm)
mkledger "$sd" 'a\t2\ttests\taccepted\t1\tworker-coder\t-\n'
mkdir "$sd/critical.globs"
mkmanifest "$sd" a 1 src/x.js
mkverdict "$sd" a 1 checker-tests PASS anthropic
out=$(gate_out "$sd" done); rc=$?
assert_rc "done rejects an accepted row whose critical.globs is unreadable (a directory)" 1 $rc
assert_grep "done names critical-glob-unreadable" "$out" "critical-glob-unreadable"

# HD9: same for a test.globs that is not valid UTF-8, on a tier-1 row.
sd=$(newswarm)
mkledger "$sd" 'a\t1\ttests\taccepted\t1\tworker-coder\t-\n'
printf 'src/payments/**\n' > "$sd/critical.globs"; printf '\xff\xfe\n' > "$sd/test.globs"
mkmanifest "$sd" a 1 src/x.js
mkverdict "$sd" a 1 checker-tests PASS anthropic
out=$(gate_out "$sd" done); rc=$?
assert_rc "done rejects an accepted row whose test.globs is unreadable (not valid UTF-8)" 1 $rc
assert_grep "done names critical-glob-unreadable for test.globs" "$out" "critical-glob-unreadable"

# HD10: an unreadable (mode 000) critical.globs (non-root only).
if is_root; then echo "ok   - skip: mode-000 unreadable case needs a non-root user"; else
sd=$(newswarm)
mkledger "$sd" 'a\t2\ttests\taccepted\t1\tworker-coder\t-\n'
printf 'src/payments/**\n' > "$sd/critical.globs"; chmod 000 "$sd/critical.globs"
mkmanifest "$sd" a 1 src/x.js
mkverdict "$sd" a 1 checker-tests PASS anthropic
out=$(gate_out "$sd" done); rc=$?; chmod 644 "$sd/critical.globs"
assert_rc "done rejects an accepted row whose critical.globs is unreadable (mode 000)" 1 $rc
assert_grep "done names critical-glob-unreadable for mode 000" "$out" "critical-glob-unreadable"
fi

# HD11: control — the same unreadable input on a tier-3 row cannot escalate
# further, so done is not blocked by it.
sd=$(newswarm)
mkledger "$sd" 'a\t3\ttests,second\taccepted\t1\tworker-coder\t-\n'
mkdir "$sd/critical.globs"
mkdir -p "$sd/tier3/a"
printf '#!/usr/bin/env bash\necho "ORACLE PASS"\n' > "$sd/tier3/a/accept.sh"; chmod +x "$sd/tier3/a/accept.sh"
printf 'ORACLE PASS\n' > "$sd/tier3/a/oracle.1.log"
mkverdict "$sd" a 1 checker-tests  PASS anthropic
mkverdict "$sd" a 1 checker-second PASS adversarial
run_gate "$sd" done; assert_rc "done accepts a tier-3 row despite unreadable globs (control: tier 3 is never blocked inline)" 0 $?

# --- CD4: `done` refuses exactly what `check` refuses on the Codex lane (run CD):
# it walks the same check_task, so a row naming codex needs ONE valid outcome.

# HD12: an accepted row naming codex with no Codex outcome -> done rejects and
# names the missing evidence.
sd=$(newswarm)
mkledger "$sd" 'a\t2\ttests,codex\taccepted\t1\tworker-coder\t-\n'
mkverdict "$sd" a 1 checker-tests PASS anthropic
out=$(gate_out "$sd" done); rc=$?
assert_rc "codex: done rejects a row naming codex with no Codex outcome" 1 $rc
assert_grep "codex: done names the missing Codex evidence" "$out" "missing checker-codex evidence (attempt 1)"

# HD13: the same row with a valid skip record (an outage never blocks) -> done ok.
mkskip "$sd" a 1 quota
run_gate "$sd" done; assert_rc "codex: done accepts a row whose Codex outcome is a valid skip record" 0 $?

# HD14: a Codex verdict AND a skip record at the same attempt -> done rejects.
mkcodex "$sd" a 1 PASS
run_gate "$sd" done; assert_rc "codex: done rejects a verdict plus a skip record at one attempt" 1 $?

# HD15: a Codex FAIL is a FAIL at tier 2, so an accepted row carrying one (no
# panel) is not complete; a Codex PASS is only evidence of presence.
sd=$(newswarm)
mkledger "$sd" 'a\t2\ttests,codex\taccepted\t1\tworker-coder\t-\n'
mkverdict "$sd" a 1 checker-tests PASS anthropic
mkcodex "$sd" a 1 FAIL
run_gate "$sd" done; assert_rc "codex: done rejects an accepted row with a Codex FAIL and no panel" 1 $?
mkcodex "$sd" a 1 PASS
run_gate "$sd" done; assert_rc "codex: done accepts the same row with a Codex PASS (control)" 0 $?

# HD16: a Codex PASS supplies no lane — the tier-3 row with only one real lane is not complete.
sd=$(newswarm)
mkledger "$sd" 'a\t3\ttests,codex\taccepted\t1\tworker-coder\t-\n'
mkdir -p "$sd/tier3/a"
printf '#!/usr/bin/env bash\necho "ORACLE PASS"\n' > "$sd/tier3/a/accept.sh"; chmod +x "$sd/tier3/a/accept.sh"
printf 'ORACLE PASS\n' > "$sd/tier3/a/oracle.1.log"
mkverdict "$sd" a 1 checker-tests PASS anthropic
mkcodex "$sd" a 1 PASS
run_gate "$sd" done; assert_rc "codex: done rejects a tier-3 row whose only second lane is a Codex PASS" 1 $?

finish
