CENSUS: CD3
ATTEMPT: 1
---
(Read-only census of the draft brief .swarm/briefs/CD3.1.md and draft oracle
.swarm/tier3/CD3/{accept.sh,differential.mjs}. Nothing was run except generic
python3 one-liners in the scratchpad to confirm interpreter behaviour.)

## Consumers
### gate (swarm/gate.sh) — in-scope
swarm/gate.sh:366-409 — manifest_hits_glob: `-f` gates on critical.globs (:371), manifests glob (:373), test.globs (:376); embedded python `open(path)` (:386,:391); rc passthrough (:406-408) — found by read — in-scope
swarm/gate.sh:379-381 — tmp defaults file via mktemp when test.globs absent; mktemp failure -> python opens "" -> exit 1 -> no hit — found by read — in-scope (not in brief)
swarm/gate.sh:20-29 — DEFAULT_TEST_GLOBS (used only when test.globs is absent) — found by read — in-scope
swarm/gate.sh:416-424 — escalation_reasons: `manifest_hits_glob "$task" && reasons+="critical-glob "`; only caller of manifest_hits_glob; any non-zero rc (0/1 and also 127/137) = no hit — found by read — in-scope
swarm/gate.sh:566-569 — check_task inline recompute (reasons=$(escalation_reasons); stderr passes through the $(...)); refuses when tier < escalation_target; runs for every status incl. no-change (:558-576 precedes check_no_change) — found by read — in-scope
swarm/gate.sh:582 / 444-483 — check_fingerprint reads the CURRENT attempt's <task>.<attempt>.files and .sha256 AFTER the escalation check (an unreadable current manifest is rejected there as "empty" today; escalation message now comes first) — found by read — in-scope (not in brief)
swarm/gate.sh:598-604 — cmd_escalate_scan writes `TARGET_TIER/REASON: <reasons>` only if no flag exists and tier < target; loops EVERY ledger row (any status) so a diagnostic prints once per row evaluated — found by read — in-scope
swarm/gate.sh:605-608 — scan clears a flag when reasons are empty and tier >= TARGET_TIER — found by read — in-scope (unchanged)
swarm/gate.sh:705 — cmd_done re-runs check_task with 2>&1 (stderr diagnostic merges into the printed output only on rc!=0) — found by read — in-scope
swarm/gate.sh:680 — cmd_stats counts a flag file as "escalated"; does not call escalation_reasons; reads no REASON — found by read — out-of-scope by nature (unchanged)
swarm/gate.sh:627-644 — task_elapsed globs $MANIFESTS/$task.*.files by mtime only, and (unlike manifest_hits_glob) skips dot-prefix siblings via a basename regex — found by read — out-of-scope (unaffected)
swarm/gate.sh:50 — field_of reads only TARGET_TIER from flags; REASON is never parsed by the gate — found by read — n/a
### dashboard mirror (dashboard/lib/parse.mjs) — in-scope
parse.mjs:470-480 — DEFAULT_TEST_GLOBS — found by read — in-scope
parse.mjs:482-508 — pyStrip, readPyLines (TextDecoder fatal, ignoreBOM, returns null on ANY read error) — found by read — in-scope
parse.mjs:512-514 — loadGlobs ('#' tested on RAW line) — found by read — in-scope
parse.mjs:642-650 — globMatcher (`**/` and `/**` candidates) — found by read — in-scope (unchanged)
parse.mjs:655-693 — manifestHitsGlob: isFile(critical) early return (:658), prefix+suffix manifest filter with isFile (:666-672), `manifestFiles.length===0` early return (:673), testFile isFile ? read : defaults (:677), null -> false (:678,:682), catch-all -> false (:690-692); comments at :486-488 and :691 say "no hit" — found by read — in-scope
parse.mjs:697-709 — escalationReasons pushes 'critical-glob' (:707); comment at :696 lists the three tokens — found by read — in-scope
parse.mjs:939-984 — computeDerived: mismatch text `escalation trigger (${escalation}) and no flag — run gate.sh escalate-scan` (:983) is where "names the reason" comes from — found by read — in-scope (unchanged unless text changes)
parse.mjs:1086-1095 — parse(): escalation computed only when status==='accepted' && no flag FILE && tier < escalationTarget(tier); no-change rows are never evaluated (gate does evaluate them) — found by read — in-scope
parse.mjs:395-419 — parseFlag reads REASON verbatim (first ':' split) — found by read — pass-through, unchanged
parse.mjs:32-39, 122-129, 141-158, 1062-1066 — readFileIfExists rethrows everything except ENOENT; parseManifest/parseFingerprint call it UNCONDITIONALLY for every row's CURRENT attempt, so a current-attempt manifest or sidecar that is mode 000 or a directory makes parse() THROW (EACCES/EISDIR) before manifestHitsGlob runs — found by read — in-scope? (not in brief)
parse.mjs:41-48, 666 — listDirIfExists rethrows non-ENOENT (EACCES/ENOTDIR on manifests/) -> caught by manifestHitsGlob catch-all -> false (fail open); bash glob on the same dir yields no match -> return 1 (also fail open) — found by read — not in brief
### dashboard rendering (unchanged; oracle S pins them unchanged) — out-of-scope
dashboard/lib/render.mjs:168-173, :296 — flag REASON displayed verbatim via esc(); no token classification, no CSS keyed on the reason — found by read+grep — out-of-scope (brief territory excludes it; needs no change)
dashboard/lib/render.mjs:148-159, :900 — errors strip renders state.errors[].message (this is where the mismatch text shows) — found by read — out-of-scope
dashboard/server.mjs:269 — handleIndex: single parse() call site; a throw becomes an HTTP 500 — found by read — out-of-scope
dashboard/server.mjs:222-245 — fs.watch on SWARM_DIR (observes only) — found by read — out-of-scope
dashboard/fixtures/swarm-demo/{critical.globs,flags/tier-2-dispute.flag (REASON: critical-glob),manifests/*} — regular readable files; no test references swarm-demo — found by grep — out-of-scope
### tests — in-scope (shipped tests are the worker's job; existing ones must stay green)
dashboard/test/parse.test.mjs:1070-1180 — inline escalation tests, exact mismatch strings incl. `(two-consecutive-fails checker-overruled critical-glob)` at :1106 — found by read — in-scope (must still pass)
dashboard/test/parse.test.mjs:1258-1371 — glob battery + test.globs replace/absent + "reads EVERY manifest incl. older attempts" — found by read — in-scope (must still pass)
dashboard/test/parse.test.mjs:1552-1562, 1567+ — gate<->dashboard differential (`gate.sh check` exit 0 <=> derived.state==='accepted'); e18 (dot-prefix sibling manifest), e19 (critical.globs not valid UTF-8, agreement only, no pinned outcome), e20 (BOM), e21 (CRLF/lone CR) at :1869-1907 — found by read — in-scope (e19 stays valid: it asserts agreement, not "no hit")
smoketest/gate/run_escalate.sh:14-20 (E2), 45-55 (E6: row b has critical.globs present and NO manifests but no assertion on b), 57-105 (E7,E9-E11) — found by read — in-scope
smoketest/gate/run_check.sh:309-341 (H2a/H2b/H2c: unflagged critical-glob rejects, flagged+bumped accepts, tier 3 not blocked) — found by read — in-scope
smoketest/gate/run_done.sh:23,31 (flag REASON: critical-glob fixtures), 166-172 (HD4 done rejects unflagged critical-glob row) — found by read — in-scope
smoketest/gate/_lib.sh — newswarm/mkmanifest/run_gate/gate_out helpers (run_gate discards stderr; gate_out merges) — found by read — in-scope
No existing shipped test pins the fail-open behaviour (grep for chmod/0xff/unreadable in smoketest/gate and dashboard/test: only e19 above).
smoketest/doc_test.sh:10-11,16,24 — greps TIERS.md/CLAUDE.md for the strings "critical.globs","test.globs","escalate-scan","recompute the triggers inline" — found by read — out-of-scope
smoketest/e2e/verify_fixture.sh + smoketest/e2e/critical.globs + smoketest/e2e/RUNBOOK.md:14-16 (manual glob-escalation assertion) — found by read — out-of-scope
smoketest/gate/agents_test.sh, verify_layout.sh, checker-evals/ — no reference to globs/escalation reasons — found by read+grep — out-of-scope
### docs / agent briefs — out-of-scope (not in CD3 territory; oracle S asserts they are unchanged)
TIERS.md:46-70 — describes critical.globs / test.globs; says test.globs "absent" -> defaults (still true); never states unreadable => no escalation and does not document the new rule — found by read — out-of-scope
CLAUDE.md:122,145 — Phase 0 draft of critical.globs; inline-trigger list "(critical-glob manifest, boss overrule, two consecutive fails)"; README.md:85 same three triggers — found by read — out-of-scope (CD4's §3d doc list covers Codex only, not this rule)
.claude/agents/checker-tests.md:38 (critical.globs touched check), worker-coder.md:48-49, worker-local.md:34-35 ("An omitted file can let a change skip escalation") — found by read — out-of-scope; none says an unreadable/missing globs file means no escalation
SPEC.md:25,113-118,142,173-185 — D5, §3c, task row, critical globs list — lead's — foreign (lead)
docs/runs/2026-09-29-GH-run-state/SPEC.md:271-290 — ruling 29g + backlog B1 — history
### foreign (CD1, concurrent) — foreign
swarm/codex-check.sh:128-132, swarm/codex/tools.py:255 — read manifests/<t>.<a>.files (+ .sha256); do not read critical.globs/test.globs or escalation reasons — found by grep — foreign
### live run
.swarm/critical.globs (regular, readable), no .swarm/test.globs, .swarm/manifests/CD2.1.files only; ledger has pending CD3/CD4 rows with NO manifests (matters for the "no manifests -> no hit" early return) — found by read

## Brief claims
"manifest_hits_glob runs an embedded python that reads critical.globs, test.globs and every manifests/<task>.*.files" — CONFIRMED — gate.sh:383-405 (test.globs via tmp defaults file when absent, :379-381)
"if any cannot be opened or decoded, python dies, its exit status 1 is read as no hit" — CONFIRMED — python uncaught exception exits 1 (verified with python3 -c 'open("/nonexistent")' and open("<dir>") -> 1); gate.sh:406-408 returns it, :422 `&&` treats every non-zero as no hit. (Broader than the brief: 127/137 also read as no hit.)
"the dashboard mirror copies that on purpose (its comment says so)" — CONFIRMED — parse.mjs:486-488 and :691
"a directory at critical.globs counts as no globs" — CONFIRMED — gate.sh:371 `-f`; parse.mjs:658 isFile
"a directory at test.globs as use the defaults" — CONFIRMED — gate.sh:376; parse.mjs:677
"a non-regular entry matching <task>.*.files is skipped" — CONFIRMED — gate.sh:373; parse.mjs:671
"the now-wrong comments ('unreadable input ... reports no hit')" — CONFIRMED — parse.mjs:486-488, :691 (also incomplete-not-wrong token lists at gate.sh:412, parse.mjs:696)
"CD2 changed load_verdict / validateVerdictRecord" — CONFIRMED — gate.sh:70-78,161-171; parse.mjs:270-282; ledger CD2 accepted; base-gate.sh and base-parse.mjs are byte-identical to the current gate.sh/parse.mjs (cmp)
"SPEC.md section 3c; GH backlog B1 (docs/runs/2026-09-29-GH-run-state/SPEC.md, ruling 29g)" — CONFIRMED — SPEC.md:113-118; GH SPEC.md:271 (29g), :283 (B1)
"escalate-scan writes a flag with that REASON" — CONFIRMED (mechanism) — gate.sh:602 `REASON: %s` of escalation_reasons; only when no flag yet and tier < target
"check / done refuse such a row with no flag exactly as they do for critical-glob" — CONFIRMED (mechanism) — gate.sh:566-569, :705; message embeds the reasons string
"tier 3 is never blocked inline" — CONFIRMED — gate.sh:567 (escalation_target(3)=3); parse.mjs:1091
"the **/ and /** candidates, the test-glob exemption, CRLF/BOM as GH2 mirrored it" — CONFIRMED — gate.sh:392-405; parse.mjs:499-513,642-650; tests e20/e21
"parse.mjs mirrors it exactly ... the same inputs are unreadable" — PARTLY UNVERIFIABLE/AT RISK — for the CURRENT attempt's manifest, parse.mjs:122-129 + :32-39 throw on EACCES/EISDIR before manifestHitsGlob is reached (parse.mjs:1062); for non-UTF-8 the current manifest is read lenient (not fatal). So "every entry matching <task>.*.files" cannot be mirrored inside manifestHitsGlob alone for that entry.
"not valid UTF-8" as a rule — UNVERIFIABLE as stated: the gate's python `open(path)` (gate.sh:386,:391) has no encoding=; verified here that default encoding is locale-dependent (`LC_ALL=C PYTHONUTF8=0` makes a VALID UTF-8 "docs/café.md" manifest die; a Latin-1 locale would accept bytes that are invalid UTF-8). The parse.mjs comment "open(): strict UTF-8" (:485-486) is true only under a UTF-8 locale. The oracle inherits the caller's locale.
"Only CD3-territory files change" (f) — CONFIRMED-as-checked — accept.sh S block hashes 2046 tracked files (base.sha256) excluding SPEC.md, swarm/codex*, smoketest/codex (untracked/foreign) and the four territory paths; untracked-file check pinned to 12f6413
"ledger/worktree/branch/foreign paths" — CONFIRMED — git status: branch claude/codex-checker-lane; swarm/codex/ untracked (CD1); smoketest/codex absent so far

## Ambiguities the brief leaves open (enumerated under each reading)
A1 order of the early returns. Today: critical.globs absent -> no hit (gate.sh:371) BEFORE manifests are listed; no manifests -> no hit (:374) BEFORE test.globs is examined. Reading R1 (unreadable check first over every PRESENT input): unreadable critical.globs/test.globs with a task that has NO manifests flags every ledger row incl. not-yet-started ones (live ledger: CD4 pending); an unreadable manifest/test.globs with critical.globs ABSENT becomes a hit. Reading R2 (keep current order, unreadable only inside the python step): those cases stay no-hit. SPEC §3c ("the embedded python ... cannot read") supports R2; brief rule bullet 1 ("ABSENT -> no hit (unchanged)") is compatible with both.
A2 token precedence when a real hit and an unreadable input coexist: brief says any unreadable input -> UNREADABLE (dominates); no scenario pins it; python today dies before evaluating so unreadable dominating is the natural mirror.
A3 "PRESENT": bash `-f` (follows symlinks) treats a dangling symlink / symlink loop / non-regular file as absent; a FIFO or socket entry would BLOCK forever if opened (gate python open(); dashboard readFileSync) so the regular-file test must precede the open.
A4 "one diagnostic line": escalate-scan evaluates once per ledger row, so one unreadable critical.globs prints one line per row.
A5 reasons string: escalation_reasons space-joins tokens; `critical-glob-unreadable` contains `critical-glob` as a prefix, so any substring grep for `critical-glob` matches both.

## Oracle gaps (Tier 3)
Consumers/behaviours the draft accept.sh + differential.mjs do not assert on:
G1 current-attempt manifest: unreadable, non-UTF-8, or a directory at <task>.<attempt>.files (brief (d) "manifests of any attempt"; oracle has only OLDER attempt U7/U8 and directory `u9.0.files` U9). In parse.mjs that case throws in parseManifest (:122-129) so a D scenario for it would surface as "harness error", not a fail-closed result; the realistic case (a non-UTF-8 path inside a worker-written current manifest) is untested on both sides.
G2 tier 1 rows (brief (d) "tiers 1 and 2"): D (row2) and E1 use tier 2 only; no tier-1 row (target 2, check_tier1 path); no no-change-status row (gate evaluates it, dashboard does not).
G3 `done` is not asserted by accept.sh (only `check` in D and `escalate-scan` in E); covered only through the worker's shipped tests (C1) which the oracle cannot see.
G4 `escalate-scan` flag REASON is asserted only for a mode-000 critical.globs (E1); test.globs / manifest / directory / bad-UTF-8 kinds are checked only via the `check` reason token. E1 greps the token anywhere in the flag, not the exact `REASON:` line.
G5 the unchanged-behaviour controls are thin: no scenario with critical.globs PRESENT and NO manifests for the task ("No manifests -> no hit"); none with critical.globs absent plus an unreadable test.globs/manifest (A1); none with a real hit plus an unreadable input (A2); no empty-file control; no symlink-to-readable-file control. (Existing shipped tests do not cover "present + no manifests" either: run_escalate E6 row b is unasserted.)
G6 non-regular kinds beyond a directory: dangling symlink, symlink loop, FIFO/socket/device (hang risk), symlink-to-file (must stay readable).
G7 diagnostic contract: E2 checks only that stderr contains "unreadable" and "critical.globs" for the critical.globs case; not "one line", not naming test.globs or a manifest path, not silence on clean/absent inputs. D merges stdout+stderr (gate() returns stdout+stderr), so the reason-token assertion can be satisfied by the stderr diagnostic even if the `FAIL: ... escalation trigger (...)` line still says `critical-glob`.
G8 the dashboard's own mismatch text is asserted only as "contains the token" (D `msgs`), and only for tasks ledgered accepted; no assertion on a flag file with REASON critical-glob-unreadable being parsed/displayed (parseFlag/render are pass-through, unchanged).
G9 stale comments (parse.mjs:486-488, :691; reason lists gate.sh:412, parse.mjs:696) — no assertion; the brief asks for the update.
G10 locale independence: nothing runs the gate under `LC_ALL=C PYTHONUTF8=0` or asserts an explicit UTF-8 decode in the embedded python.
G11 residual fail-open paths outside the brief's wording and untested: python3 absent or killed (rc 127/137 read as no hit, gate.sh:406-408), mktemp failure (gate.sh:379-380), unreadable/non-directory manifests/ (bash glob empty; parse.mjs:41-48 + catch-all :690).
G12 dot-prefix sibling task's unreadable manifest (glob `<task>.*.files` includes it; brief says every matching entry) — not asserted.
G13 calibration: M1/M2 assert only that the shipped suites fail against the post-CD2 files (M1: rc != 0 of the whole run_tests.sh; M2: fail count > 0), not that the failures are the new unreadable tests; a harness-caused failure in the rsync copy would satisfy them. E1/U1/U4/U7 rely on chmod 000, which does not fail closed if the oracle is run as root (uid here is 1000).
G14 the `S` territory check pins docs/agents unchanged, so the new rule cannot be documented by CD3; nothing in the oracle or any task in the SPEC table (CD4 §3d lists Codex-lane docs only) covers documenting critical-glob-unreadable in TIERS.md/CLAUDE.md.
