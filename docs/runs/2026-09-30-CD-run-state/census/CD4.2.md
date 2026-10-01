CENSUS: CD4
ATTEMPT: 2
---
Method: read swarm/gate.sh and dashboard/lib/parse.mjs (Codex + verdict-scan parts) whole, the shipped
codex tests (run_check.sh 668-797, parse.test.mjs 2338-2520), the two attempt-1 verdicts, draft accept.sh /
differential.mjs (python-difflib diff vs the a1 copies). Probes ran only in my scratch dir
(.../scratchpad/cen): gate.sh and node against throwaway fixtures, no Docker, no harness, no real Codex.
Measured facts (scratch):
 F1 differential.mjs on the attempt-1 tree (X44 skipped, it hangs): 62/68; FAIL X37 X38 X39 X40b = LOCALE SPLIT
    (right reason), X41 = gate accepts / dashboard blocked (right reason), X42 = parse() THREW EISDIR.
 F2 same differential on a scratch copy with only `LC_ALL=C sed` in skip_field: X37-X40b pass; X41, X42 remain.
 F3 plus `[[ -e || -L ]]` at gate.sh:254: X41 passes; X42 still THROWS and X44 (FIFO) HANGS parse() until killed.
 F4 plus a scratch parseAllVerdicts guard that never opens a non-regular *.verdict: 68/68 (X44 included).
 F5 1000 skip shapes (REASON/DETAIL/TASK/ATTEMPT x 25 leading-whitespace kinds incl. U+2003/3000/00A0/0085/FEFF/
    1680/2028/2029/180E/202F/205F, 0xff, truncated UTF-8 x 5 trailers x value/no-value) x C, C.UTF-8, en_US.UTF-8:
    current gate = 76 locale splits, 0 other gate/dashboard mismatches; with sed under LC_ALL=C = 0 splits, 0
    mismatches. So the pinned rule equals what BOTH sides do in the C locale today.
 F6 mutations M-a..M-d applied one at a time to a scratch copy of the tree, run against run_check.sh,
    run_escalate.sh, run_done.sh and parse.test.mjs: M-a, M-b, M-c, M-d(dashboard) survive all four;
    M-d(gate) is killed only by ONE needle assertion (run_check.sh:701 'names invalid'), not by an
    invalid-verdict-plus-skip scenario. M-e: the tree IS that mutant today (no LC_ALL on sed).
 F7 draft accept.sh T block run standalone on the attempt-1 gate: 16/16 ok, incl. "stats identical under C and
    en_US" - it cannot fail for the item-1 defect (no non-ASCII skip record in the stats fixture).
 F8 host: locale -a has C.utf8 and en_US.utf8 (LANG=en_US.UTF-8 is the session default). A missing locale makes
    bash print "bash: warning: setlocale: LC_ALL: cannot change locale (...)" on stderr and fall back to C.

## Consumers
swarm/gate.sh:215 — skip_field: `LC_ALL=C grep -a -m1 | sed "s/^KEY:[[:space:]]*//"`; sed runs in the CALLER's locale (item 1 defect) — read — in-scope
swarm/gate.sh:220-234 — codex_skip_valid: -f guard :223; NUL test `tr -d '\0' < f | cmp -s - f` :224 (byte-level, locale-independent); case over the 15 reasons :227; [[ == ]] literals :231 — read — in-scope (no locale sensitivity found; F5)
swarm/gate.sh:238-246 — codex_outcome (`[[ -f vf ]] && load_verdict` :243; skip via codex_skip_valid :244); sinks: :257 codex_evidence_or_fail, :859 codex_tally, :910 cmd_stats per-row codex= — read — in-scope
swarm/gate.sh:252-262 — codex_evidence_or_fail: :254 `[[ -f "$vf" ]] && ! load_verdict ... fail` — the item-2 defect; only tier 1 reaches it un-shielded (tiers 2/3 run walk_verdicts first :355/:402) — read — in-scope
swarm/gate.sh:268-285 — check_tier1: codex branch :275-278 (named only); named checkers' own `[[ -f ]] || fail missing verdict` :281 (a non-regular NAMED checker file already refuses) — read — in-scope
swarm/gate.sh:294-333, 355-358, 402-403 — walk_verdicts globs `$t.$a.*.verdict` (lists dangling links, dirs, FIFOs) -> load_verdict `-f` :114 -> "invalid verdict ...: missing file": tiers 2/3 refuse all four kinds without opening (probed: dangling, loop, dir, FIFO at tiers 2 and 3 all rc 1; tier 1 all four rc 0) — read — in-scope (regression pin)
swarm/gate.sh:421 has_fail_at, :437 overrule_exists, :453 judges_overruled_at, :717 any_verdict_exists, :843 task_elapsed, :852 second_at, :887 stats first-attempt loop — `[[ -f ]] ... continue` / load_verdict: a non-regular entry is skipped as invalid, never opened; has_fail_at feeds escalation_reasons :606 and stats first-attempt — read — in-scope (no change needed; consistent with "only a valid FAIL counts")
swarm/gate.sh:856-870, 910-913 — codex_tally / cmd_stats: pair loop `a=0` :858 (M-a), second_at via load_verdict :852 (M-c); current-attempt codex=/second= :910-913; summary :920 — read — in-scope
swarm/gate.sh:923-950 — cmd_done: check_task rehash=0, same path as check — read — in-scope
swarm/gate.sh:52 — field_of: `grep -m1 "^KEY:" | sed "s/^KEY:[[:space:]]*//"`, BOTH in the caller's locale; used by load_verdict :139-143 + :192 for every verdict incl. checker-codex, and for flags :753/:800 — read,grep — UNLISTED (pre-existing, same root as item 1). Probed on a checker-codex verdict: `FAMILY:<U+2003>crossvendor` gate C=reject, C.UTF-8=accept, en_US.UTF-8=accept, dashboard accepts; `CHECKER:<U+2003>checker-codex` same; `FAMILY: <U+00A0>crossvendor` gate rejects in all three, dashboard accepts; `FAMILY: crossvendor ` gate rejects, dashboard accepts (the backlog CD-h split)
swarm/gate.sh:137 — `grep -qx -- '---'` caller locale on a Codex verdict — read — out of item 1 (no split seen)
swarm/gate.sh:128, :159 — `[[ =~ ]]` filename / ATTEMPT regexes, locale-sensitive in principle (filenameless load_verdict callers :844, :888; ATTEMPT header after field_of's strip) — read — out of item 1 (no split seen beyond the field_of one)
dashboard/lib/parse.mjs:460-466 — skipField: `startsWith(KEY:)` + `replace(/^[ \t\n\v\f\r]+/, '')`; already the pinned rule (F5) — read — in-scope, NO code change needed for item 1
dashboard/lib/parse.mjs:475-497 — parseCodexSkip: stat+O_NONBLOCK open+fstat, NUL check :489, `buf.toString('utf8').split('\n')` :490 (invalid bytes become U+FFFD: cannot turn a reason/task/attempt valid) — read — in-scope
dashboard/lib/parse.mjs:225-248 — parseHeaderAndEvidence: `.trim()` on key AND value (Unicode whitespace incl. U+2003, U+00A0, U+FEFF) for every verdict incl. checker-codex — read — UNLISTED (pre-existing split above)
dashboard/lib/parse.mjs:36-43 + 354-413 — parseAllVerdicts opens EVERY `*.verdict` via readFileIfExists = fs.readFileSync: ENOENT -> null (dangling link handled), but EISDIR / ELOOP / EACCES are rethrown -> parse() THROWS, and a FIFO BLOCKS forever (probed: dangling -> blocked; loop THREW ELOOP; dir THREW EISDIR; mode-000 THREW EACCES; FIFO timeout rc 124) — read — UNLISTED, directly on item 2's path
dashboard/lib/parse.mjs:425-436, 504-515, 1266-1267 — blockingVerdictFiles lists dir entries; codexEvidenceProblem (`invalidVerdicts.includes(file)` :507 = M-d dashboard half); both only reached if parseAllVerdicts did not throw — read — in-scope
dashboard/lib/parse.mjs:1122-1123 — comment "tiers 2/3 always; tier 1 only when named" (same imprecision as the CLAUDE.md sentence; code at :1127-1131 is right) — read — UNLISTED (comment only)
dashboard/lib/render.mjs — no codex/skip handling (grep) — read,grep — out-of-scope (CD4.1: render.mjs unchanged)
CLAUDE.md:277-280 — "A `checker-codex` FAIL is a FAIL: at Tiers 2/3 whether or not `codex` is named (at Tier 1 only when named), it opens the dispute path ..., counts toward two consecutive fails, and counts in `stats`." — read — in-scope (item 3)
TIERS.md:49-51 — "Trial rule: a Codex FAIL counts (a FAIL at tiers 2/3 always, at Tier 1 when named; the dispute path is unchanged)" — reads as if an unnamed Tier-1 Codex FAIL does not count; it does count for two-consecutive-fails and stats — read,grep — UNLISTED by sentence (brief says "check TIERS.md/README")
README.md:86-94 — "a Codex FAIL counts (the dispute path)": no tier qualifier — read — OK, no change needed
SPEC.md:564-567 — CD-w quotes the CLAUDE.md phrase (history, not a live claim) — read — out-of-scope (lead's file)
smoketest/doc_test.sh:40-64 — pins; TIERS pin :59 `Codex FAIL counts.*Codex PASS never does` must survive a rewrite of the TIERS sentence; no pin on the CLAUDE.md first bullet — read — in-scope
smoketest/gate/run_check.sh:668-797 — codex gate tests: NUL only inside REASON (:724), no UTF-8 / non-ASCII fixture, stats fixture has no attempt-0 outcome and no invalid checker-second, only `LC_ALL=C` precedent at :665 — read — in-scope (item 4)
smoketest/gate/_lib.sh:66-80 — mkcodex/mkskip (mkskip takes a DETAIL arg); run_gate/gate_out inherit the caller's locale, `LC_ALL=x run_gate ...` precedent at run_check.sh:665 — read — in-scope
smoketest/gate/run_escalate.sh, run_done.sh — codex escalation/done tests; no skip-header or non-regular-verdict case — read — in-scope (no change needed)
dashboard/test/parse.test.mjs:2338-2520 — codex tests: NUL only in REASON (:2474), no invalid-verdict+skip at tier 1, no non-ASCII fixture; gateRun(dir,id,env) :2270 already takes an env override; parseInChild :2125 asserts "neither throw nor block" with a 20 s timeout — read — in-scope (item 4)
.swarm/tier3/CD4/accept.sh, differential.mjs — the draft oracle — read — in-scope
swarm/codex-check.sh:146-160 — the real skip writer: DETAIL is a fixed ASCII sentence, so no real record hits item 1; only hand-written/tampered ones — read — out-of-scope (territory)
swarm/start.sh, swarm/codex-check.sh header text — stale "no second vendor" / "only after CD4" — read — out-of-scope (brief: outside territory; backlog CD-w)

## Brief claims
CD4.2 "skip_field runs grep under LC_ALL=C but its sed [[:space:]] in the caller's locale, which under UTF-8 strips U+2003 etc." — CONFIRMED — gate.sh:215; F1 (C.UTF-8 and en_US.UTF-8 reject X37, C accepts)
CD4.2 pinned rule "= what parse.mjs does" (leading [ \t\n\v\f\r] only, never trailing/non-ASCII) — CONFIRMED — parse.mjs:463; F5 (0 mismatches vs the C-locale gate over 1000 shapes); parse.mjs needs no change for item 1
CD4.2 "DETAIL:<U+2003> valid; REASON:<U+2003>quota and TASK:<U+2003><t> invalid" — CONFIRMED under the pinned rule — F2 (X37-X39 pass once sed is C-locale)
CD4.2 "the gate, under C, C.UTF-8 and en_US.UTF-8, and the dashboard must agree on every skip record" — CONFIRMED as achievable for skip records (F5). The gate's locale dependence is NOT limited to skip records: field_of gate.sh:52 (see Consumers) — UNLISTED
CD4.2 item 2 "(and as the dashboard already does)" refuses a dangling symlink, symlink loop, directory or FIFO entry — CONTRADICTED — parse.mjs:36-43,374: only the dangling symlink is refused (blocked); a loop THROWS ELOOP, a directory THROWS EISDIR, a mode-000 file THROWS EACCES, a FIFO HANGS (probe_nonreg.mjs; F3). Same at tiers 2/3 on the dashboard, and for any task's *.verdict entry
CD4.2 item 2 "exactly as tiers 2/3 already do" (gate side) — CONFIRMED — probed rc 1 for all four kinds at tiers 2 and 3 (walk_verdicts + load_verdict -f :114)
CD4.2 item 2 "Never open a FIFO" — CONFIRMED achievable in the gate (every -f test and load_verdict's first line is a stat) — the dashboard does open it today (parse.mjs:374)
CD4.2 item 2 "Unnamed at tier 1: still ignored (rule 6)" — CONFIRMED — gate only enters the codex branch when named (:275); dashboard codexEvidenceProblem :505 and invalidBlocking tier>=2 :1160; X44b passes on attempt-1 code
CD4.2 item 3 "unnamed Tier-1 Codex FAIL counts toward two consecutive fails and in stats; only acceptance ignores it" — CONFIRMED — probed: tier 1 `tests`, Codex FAIL at attempts 1 and 2 -> `flag: e -> tier 2 (two-consecutive-fails)`, stats `first-attempt=1 failed ... codex=FAIL` (has_fail_at :421 takes any valid FAIL). Nuance: via the flag the row is then refused, so "only acceptance ignores it" holds for a single FAIL
CD4.2 item 3 "first bullet of 'The Codex lane - trial'" — CONFIRMED — CLAUDE.md:277-280
CD4.2 item 3 "Check TIERS.md/README for the same imprecision" — TIERS.md:49-51 has it (weaker form), README does not (see Consumers)
CD4.2 item 4 M-a applicable — CONFIRMED — gate.sh:858 `a=0`; mutant survives the four shipped suites (F6); fixture needs a Codex outcome at attempt 0 (the ledger attempt may be 0 or higher)
CD4.2 item 4 M-b applicable — CONFIRMED — parse.mjs:489; survives (F6); a NUL in DETAIL makes the dashboard accept while the gate refuses; the only shipped NUL test is REASON `qu\0ota` (parse.test.mjs:2474, run_check.sh:724)
CD4.2 item 4 M-c applicable — CONFIRMED — gate.sh:852; survives (F6); an invalid checker-second needs a row that also has a Codex outcome at the same attempt
CD4.2 item 4 M-d applicable "(gate or dashboard)" — CONFIRMED for both halves: dashboard parse.mjs:507 survives (F6); gate :254 is killed today only incidentally by run_check.sh:701's 'invalid' needle (no shipped test has an invalid verdict BESIDE a valid skip)
CD4.2 item 4 M-e "skip_field's sed runs in the caller's locale AGAIN" — CONTRADICTED in tense only: the attempt-1 tree already is that mutant (gate.sh:215); the suites pass because no shipped fixture is non-ASCII. "(a UTF-8 run of the suite must fail ...)" is ambiguous: (1) the test sets the locale itself (precedent run_check.sh:665, parse.test.mjs gateRun env) — kills the mutant on any host; (2) the suite is merely run with a UTF-8 caller env — kills it here (LANG=en_US.UTF-8) but not under C/CI
CD4.2 item 4 "a NUL byte ANYWHERE in a skip record makes it invalid (gate and dashboard)" — CONFIRMED — gate.sh:224, parse.mjs:489
CD4.2 header "543 smoketests, 119 dashboard tests, ~1,000 fuzzed scenarios, 0 mismatches outside the items below" — CONFIRMED — CD4.1.checker-second verdict (543 ok; 800+197+210) and checker-tests (119/119); the two backlog splits are in "Out of scope"
CD4.2 "Out of scope: trailing-comma checks split and `FAMILY: x ` trailing-space split exist in the pre-CD4 gate too" — CONFIRMED — base-gate.sh:52 and HEAD:swarm/gate.sh:50 have the same field_of; probed trailing space (gate rejects / dashboard accepts). The LOCALE-dependent leading-U+2003 variant of the same function is not named there
CD4.2 "fix exactly these items; change nothing else in behaviour" vs item 2 + its oracle — CONTRADICTED by the code: X42 (directory) and X44 (FIFO) in the draft differential cannot pass without a parse.mjs change (non-regular *.verdict entries are never opened / never throw) that changes dashboard behaviour for every task and tier; parse.mjs is in the territory but the amendment does not say so (F3/F4)
CD4.2 "SPEC.md ruling CD-w lists the findings" — CONFIRMED — SPEC.md:557-575
CD4.2 "swarm/codex-check.sh and swarm/start.sh are outside the territory" — CONFIRMED — CD4.1.md Territory
CD4.2 Evidence "manifests/CD4.2.files and .sha256 (every territory file changed in attempts 1-2)" — CONFIRMED consistent with the gate (ledger row CD4 is already attempt 2, .swarm/ledger.tsv) and CD4.1.files (11 paths)
CD4.1 acceptance letters (a)-(h) referenced by "(b)-(h) as in CD4.1" — CONFIRMED — CD4.1.md:122-135

## Oracle gaps (Tier 3 only)
accept.sh/differential.mjs X42 (directory) and X44 (FIFO) — cannot pass on a gate-only fix: parse() throws EISDIR / hangs (F3); on the lead's own pre-CD4 calibration log (calibration-a2-pre-diff.log) the run stops at X43 with no `differential:` summary line, consistent with the X44 hang. A hang costs the full `timeout 900` and the D line reports only the last ok line
accept.sh item 4 — no check applies M-a..M-e to a copy and runs the shipped suites; the M block (M1/M2) only runs them against the pre-CD4 files. The brief's acceptance "each mutation killed by the shipped suites" is asserted by no script. M-e's mutant depends on how the worker writes the fix (the tree is the mutant today)
accept.sh item 3 — no F check pins the corrected CLAUDE.md first bullet (F2 matches :275 "a Codex FAIL counts"); the oracle passes on the old sentence; the brief also asks for no doc_test.sh pin
accept.sh T block — "stats output identical under LC_ALL=C and en_US.UTF-8" cannot fail for item 1 (F7): the fixture has no non-ASCII skip record, so stats' own skip read (codex_outcome :244 -> skip_field) is not exercised under a UTF-8 caller. s10/s11 pass on the attempt-1 code (pins, not fail-end checks)
T block false-split risk — `st=$(... LC_ALL=en_US.UTF-8 ... 2>&1)` vs `stC`: on a host without en_US.UTF-8, bash adds `bash: warning: setlocale: ...` to `st` only -> the identity check fails though the gate is fine (F8). Not reachable on this host
differential.mjs three-locale loop — compares exit status only (stderr warnings do not cause a split), so no false split from warnings; but a locale missing on the host silently degrades to C: no split can ever be reported for that leg (no `locale -a` precondition). On this host all three resolve to distinct answers (F1)
differential.mjs item 1 coverage — X37-X40b cover DETAIL, REASON, TASK, and U+3000 at tier 1; ATTEMPT:<U+2003>1 has no scenario (F5 shows it splits today); no trailing-U+2003 scenario; no leading \v/\f scenario; no checker-codex VERDICT header scenario (field_of, see Consumers) under the three locales
differential.mjs item 2 coverage — symlink loop (named in the brief) has no scenario; no tier 2/3 scenario for a non-regular checker-codex.verdict (brief: "exactly as tiers 2/3 already do"); no dangling link WITHOUT a skip beside it; no mode-000 regular checker-codex.verdict
differential.mjs `gateDone` — runs under the ambient locale, not the three (done == check was not asserted per locale)
X41-X44 fragment 'checker-codex' also matches "missing checker-codex evidence" and "has both a verdict and a skip": a fix that refuses for the wrong reason still passes the fragment check
