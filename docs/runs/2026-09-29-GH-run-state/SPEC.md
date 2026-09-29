# SPEC.md — Land the 2026-09-18 gate hardening (GH run)

Run prefix: **GH**. Target repo: **agents2 itself** — this worktree
(`.claude/worktrees/unifi-camera-streaming-7be695`), branch
`claude/gate-hardening`, base master **cae89ff**. This run's `.swarm/` lives
here (gitignored). Fresh ledger.

Source of the change: the uncommitted work in worktree
`.claude/worktrees/agents2-review-verification-de0532` (base 5ec528a, built
lead-direct 2026-09-18, never committed, never checked by a non-author).
Snapshotted 2026-09-29 so the source cannot move under the run:
`.swarm/tier3/GH1/source.patch` (29 tracked files: 24 modified, 5 deleted) +
`.swarm/tier3/GH1/source-untracked/` (10 fixture files), fingerprinted in
`.swarm/tier3/GH1/source.sha256`.

Why now: the next run adds Codex as an alongside checker (run CD). It
changes the same files (`swarm/gate.sh`, `dashboard/lib/parse.mjs`,
`CLAUDE.md`, the checker briefs), so the gate it is designed against must be
settled first (user decision 2026-09-29: "Land hardening first").

## 0. Status — RUN COMPLETE: GH1 + GH2 ACCEPTED at attempt 1 (both gates); not yet committed

Signed off 2026-09-29 (GH1; GH2 added and signed off the same day after
ruling 2026-09-29e). Both oracles validated at both ends before dispatch.

```
OK: GH1 accepted at tier 3 (attempt 1)          (ported gate and frozen master gate)
OK: GH2 accepted at tier 3 (attempt 1)          (ported gate and frozen master gate)
OK: all tasks accepted, evidence verified, no unresolved flags   (done, both gates)
stats: GH1 tier=3 first-attempt=1 clean (now: status=accepted attempt=1) elapsed=0h12m
stats: GH2 tier=3 first-attempt=1 clean (now: status=accepted attempt=1) elapsed=0h27m
first-attempt clean: 2/2 (no-evidence rows: 0)
escalated: 0/2
elapsed total: 0h40m (sum of per-task evidence spans)
```

Final pass: lead integration run `bash smoketest/gate/run_tests.sh` → every
suite ALL PASS (rc 0); `node --test dashboard/test/*.test.mjs` → 66/66.
checker-a11y's GH1 sweep covers the final markup (GH2 left `render.mjs`
byte-identical). Lead self-review of SPEC.md fixed stale oracle-plan text.

## 1. Problem — the eight gaps (2026-09-18 review; all five gate probes reproduced)

| # | Gap | Where |
|---|-----|-------|
| 1 | Tier 3 ignores the ledger `checks` column — two lanes of PASS accept even when a named checker never ran | `check_tier3` |
| 2 | A critical-glob manifest is accepted by `check`/`done` unless the lead remembered `escalate-scan` | `check_task` |
| 3 | Tier 1 with a blank `checks` column accepts with zero verdicts | `check_tier1` |
| 4 | A `report.md` in a tier-3 dir bypasses the oracle (legacy blind-arm contract); blind-arm scripts still shipped | `check_tier3`, `swarm/tier3-*.sh` |
| 5 | No fingerprint ties a verdict to the tree it verified (TC incident: a checker's `git checkout` wiped worker output) | manifests, verdicts, `check` |
| 6 | `checker-second` is told a run of PASSes is evidence of bad performance — invites manufactured disagreement | `.claude/agents/checker-second.md` |
| 7 | `stats` counts an overruled FAIL as a failed first attempt; no escalation count; no elapsed time | `cmd_stats` |
| 8 | Phase 0 / final-pass text describes a website build, not what the runs do | `CLAUDE.md` |

## 2. Design (as built 2026-09-18; carried here — the design note is not ported)

1. **Tier 3 named checkers.** `check_tier3` receives `checks`; empty column
   hard-fails; every named checker must PASS at the current attempt AND the
   PASSes span two lanes. Dispute path unchanged.
2. **Inline escalation triggers.** One trigger function shared by
   `escalate-scan` and `check_task`; `check`/`done` refuse a row with a live
   trigger, below target tier, and no flag file ("run gate.sh
   escalate-scan"). The scan stays the only flag writer.
3. **Tier 1 blank checks hard-fails.**
4. **Legacy contract removed.** A `report.md` in a tier-3 dir is a hard FAIL
   ("stale blind-arm report.md"). `swarm/tier3-setup.sh`,
   `swarm/tier3-compare.sh`, `smoketest/gate/tier3_test.sh` deleted. The
   dashboard mirror follows: oracle contract always; the divergence-matrix
   panel becomes an oracle-status panel.
5. **Source fingerprints.** Worker writes `<task>.<attempt>.sha256`
   (`sha256sum` format; a deleted path is `deleted  <path>`) beside the
   `.files` manifest. Every `checker-*` PASS carries `MANIFEST_SHA256: <sha256
   of the .sha256 file>`. `check` requires manifest + sidecar covering every
   path, re-hashes every path against `SWARM_TREE` (default `.`), and matches
   every checker PASS's header to the sidecar hash; judges exempt. `done`
   checks evidence consistency but not the tree re-hash. Ledgers holding rows
   accepted before this change will not pass `done` — fresh ledger per run.
6. **checker-second contract.** Scored on evidence per criterion (attack
   tried, command, result), not on disagreement. Default-to-FAIL on
   ambiguity stays.
7. **stats.** An overruled first-attempt FAIL counts `clean (fail-overruled)`;
   adds `escalated: n/m` and mtime-based `elapsed=` per task plus a total.
8. **CLAUDE.md.** Phase 0 scales with tier and UI: SPEC.md always;
   ACCESSIBILITY.md / SOURCES.md only when UI / migrated content is in scope.
   Final pass: `checker-a11y` sweep only when a manifest touched UI;
   self-review and `run_tests.sh` always.

## 2b. GH2 design — the dashboard mirrors the inline escalation triggers (ruling 2026-09-29e)

`dashboard/lib/parse.mjs` reproduces `gate.sh escalation_reasons` and the
`check_task` precedence, so `gate.sh check` exits 0 exactly when
`derived.state === 'accepted'` (the dashboard's stated anti-lie property):

1. **two-consecutive-fails** — an unresolved FAIL at the ledger attempt N and
   at N−1. Unresolved = a valid FAIL verdict at that attempt and NOT (≥3
   UPHOLD/OVERRULE verdicts there with OVERRULE strictly more), counted with
   no identity de-duplication, as `judges_overruled_at` does.
2. **checker-overruled** — any valid verdict owned by the task, at any
   attempt, with `VERDICT: OVERRULE` and `CHECKER: boss`.
3. **critical-glob** — every `manifests/<task>.*.files` the gate's glob
   matches (a superset prefix, dot-prefix siblings included — mirrored, not
   fixed; see backlog), each path tested against `critical.globs` with
   Python `fnmatch` semantics plus the gate's candidates (`**/X` also tries
   `X`; `/**` also tries `/*`), exempt when it matches `test.globs` — or, when
   that file is absent, the gate's default test-glob list.
4. **Precedence (gate order).** A flag FILE on disk (open or closed) keeps
   today's logic and suppresses the inline check. With no flag file, a
   non-empty trigger set on a row below `min(tier+1, 3)` makes an `accepted`
   row `flagged`, before any quorum test, with a ledger mismatch naming the
   reasons and `escalate-scan`.

Oracle `.swarm/tier3/GH2/accept.sh` (+ `differential.mjs`): 14 independent
gate-vs-dashboard scenarios with pinned outcomes and mismatch text; a scope
check against GH1's fingerprints; the consumer suites; and a mutation kill
(the shipped tests must fail against GH1's frozen `parse.mjs`,
`gh1-parse.mjs`). Validated both ends before dispatch: the current tree →
`ORACLE FAIL: 2` (7/14 scenarios disagree; shipped tests catch nothing);
a throwaway prototype → `ORACLE PASS`; discarded. After GH2 lands,
`gate.sh check GH1` reports drift on the two dashboard files by design (a
later task edited them); `done` is the run-level check and does not re-hash.

## 3. Port scope

- Apply every change in `source.patch` and add every file in
  `source-untracked/`. Nothing else.
- **Excluded:** `AGENTS.md` and `.codex/` (the stale Codex port — run CD
  decides their fate), and `docs/superpowers/specs/2026-09-18-gate-hardening-design.md`
  (CLAUDE.md: SPEC.md is the design artifact; §1–2 above carry it).
- **The one conflict is `CLAUDE.md`** (trial apply onto cae89ff, 2026-09-29:
  every other file applies cleanly). Master gained the "Superpowers skills —
  front half only" section (#32) after the source was built. The merge keeps
  every master section verbatim AND applies every source hunk.
- Never write to the de0532 worktree; the snapshot is the source.

## 4. Task table

| Task | Tier | Checks | Owner | Acceptance criteria |
|------|------|--------|-------|---------------------|
| GH1 | 3 | tests,second,a11y | worker-coder | (a) `.swarm/tier3/GH1/accept.sh` run on the result ends `ORACLE PASS`. (b) `bash smoketest/gate/run_tests.sh` → ALL PASS. (c) `node --test dashboard/test/*.test.mjs` (from the repo root) → 0 fail (ruling 2026-09-29b). (d) Each of the eight §2 items holds as specified — checkers verify point by point, with a command per point (items 6 and 8 are text: cite the lines). (e) `CLAUDE.md` keeps master's "Superpowers skills — front half only" section and "Resume, don't re-dispatch" paragraph verbatim (no source hunk touches either), and carries every source hunk — including the hunks inside "ACTIVE EXPERIMENT" and "Phase 0" (ruling 2026-09-29a). (f) The changed-file set equals the source's (29 tracked + 10 untracked, §3 exclusions honoured); nothing under `docs/runs/` touched; no remaining reference to `tier3-setup.sh`, `tier3-compare.sh` or `tier3_test.sh` outside the history folders `docs/runs/` and `docs/superpowers/` (ruling 2026-09-29c). (g) The dashboard's changed tier-3 panel meets ACCESSIBILITY.md in both themes. |
| GH2 | 3 | tests,second | worker-coder | (a) `.swarm/tier3/GH2/accept.sh` ends `ORACLE PASS`. (b) `bash smoketest/gate/run_tests.sh` → ALL PASS. (c) `node --test dashboard/test/*.test.mjs` → 0 fail. (d) Only `dashboard/lib/parse.mjs` and `dashboard/test/parse.test.mjs` change; `swarm/gate.sh` and `dashboard/lib/render.mjs` stay byte-identical to GH1's fingerprints. (e) `parse.mjs` mirrors each trigger exactly as §2b states, and the precedence: checkers prove each with their own gate-vs-dashboard fixtures. (f) The shipped `DIFFERENTIAL_SCENARIOS` gains trigger scenarios that FAIL against GH1's `parse.mjs` (the property outlives the oracle). |

**Tier 3:** GH1 — the gate decides acceptance for every later run; a wrong
gate is a silent bypass (critical-glob: `swarm/**`). GH2 — the dashboard is
the gate's read-only mirror; a wrong mirror shows `accepted` for refused rows
(critical-glob: `dashboard/lib/**`). GH2's oracle is described in §2b.

### GH1 oracle plan (`accept.sh`, written and validated at both ends BEFORE dispatch)

- **Gate probes, one per mechanical gap (1–5, 7).** Each builds a throwaway
  `.swarm` fixture and runs the candidate `swarm/gate.sh`. Every probe has a
  **negative case** (the bypass) that must exit 1 with a defect-specific
  message fragment, and a **positive control** that must exit 0 — so a
  failure is proven to be the defect, not the harness. Fixtures carry valid
  fingerprints so a negative case fails for its own reason only.
  Probe 5 covers: tree drift after fingerprinting, a PASS whose
  `MANIFEST_SHA256` mismatches, a missing sidecar, and a `deleted` path
  (absent → ok, present → fail).
- **Every consumer of the contract.** `run_tests.sh` ALL PASS; dashboard
  `node --test dashboard/test/*.test.mjs` 0 fail (its parity battery runs the gate per fixture);
  `worker-coder.md` and `worker-local.md` instruct writing `.sha256`; every
  `checker-*.md` names `MANIFEST_SHA256`; `CLAUDE.md` keeps master's
  Superpowers section and Resume paragraph verbatim and carries every
  source-added line, with no source-removed line surviving (ruling
  2026-09-29a; the plan first said "three master sections").
- **Formats pinned only where the design pins them:** the
  `fail-overruled` label and an `escalated: n/m` line.
- **Fail end:** master's tree (cae89ff) — every negative probe exits 0 there,
  so the oracle must FAIL, for the probes' reasons. **Pass end:** a throwaway
  trial port in scratch → `ORACLE PASS`; then discarded.

### Acceptance mechanics

- Gate of record: **both** master's gate, frozen at `.swarm/gate-master.sh`
  (sha256 `e15a7f88…622c`, the currently trusted gate), **and** the ported
  `swarm/gate.sh` (dogfood — it requires fingerprints, so the worker writes
  the `.sha256` sidecar and every checker PASS carries `MANIFEST_SHA256`).
  Both must exit 0.
- Checkers get the §4 criteria and the foreign-territory note: the de0532
  worktree is the source, read-only; the main checkout's untracked
  `AGENTS.md` / `.codex/` are not this run's.
- Hard stop: two failed attempts (Tier 3). Two failures of the same class →
  contract rewrite before the last attempt.

## 5. Critical globs (`.swarm/critical.globs`)

```
swarm/**
dashboard/lib/**
.claude/agents/**
CLAUDE.md
TIERS.md
```

## 6. Final pass

`checker-a11y` sweep of the dashboard (GH1's manifest touches UI; GH2 leaves
`render.mjs` byte-identical, so GH1's a11y verdict covers the final markup); lead
self-review of SPEC.md, the oracle and every file the lead authored;
`bash smoketest/gate/run_tests.sh` ALL PASS; `gate.sh stats` reported
verbatim; `gate.sh done` exit 0 under both gates.

After merge: the de0532 worktree is removed only on the user's say-so.

## 7. Rulings

- **2026-09-29a — criterion (e) contradicted the source (mechanism: oracle
  authoring, lead, pre-dispatch).** The signed-off (e) required master's
  "ACTIVE EXPERIMENT" text verbatim AND every source hunk, but the source's
  first CLAUDE.md hunk edits ACTIVE EXPERIMENT's Measurement bullet (the
  stats `fail-overruled` note) and its second rewrites Phase 0. Found while
  mapping hunks to sections for the oracle's CLAUDE.md check. Corrected:
  verbatim retention applies to the two master-only texts no hunk touches
  (Superpowers section, Resume paragraph); every source hunk applies,
  ACTIVE EXPERIMENT included. A lead brief error — the same class as
  GM-2026-09-06a/b.
- **2026-09-29b — criterion (c)'s command did not run the suite (mechanism:
  oracle calibration against master, lead, pre-dispatch).** On Node 24
  `node --test dashboard/test/` treats the directory argument as one test
  file and reports a single synthetic failure — a harness error that would
  have failed a perfect port. Calibrated on cae89ff: the explicit
  `dashboard/test/*.test.mjs` form runs 49 tests, 49 pass. Criterion (c) and
  the oracle use that form.
- **2026-09-29c — criterion (f)'s reference sweep flagged history (mechanism:
  oracle pass-end validation, lead, pre-dispatch).** The throwaway trial
  port failed exactly one check: two July design documents
  (`docs/superpowers/plans/2026-07-09-tiered-verification.md`,
  `docs/superpowers/specs/2026-07-09-tiered-verification-design.md`) name the
  blind-arm scripts. CLAUDE.md classes `docs/superpowers/` as history to
  read, the source never touches it, and rewriting history is out of scope —
  same standing as `docs/runs/`. Criterion (f) and the oracle now exclude
  both history folders; the oracle re-validated at both ends.
- **2026-09-29d — GH1 attempt 1 accepted; no FAIL at any lane.** checker-tests
  PASS: 7 single-line gate mutants each caught by its own oracle probe, 28
  own probes, byte-identity of all 34 present paths to cae89ff+source.
  checker-second PASS: independent reconstruction (own merge-file of
  CLAUDE.md identical to TREE's; 33 other present paths byte-identical,
  modes match), 14 oracle mutants of which 13 caught. checker-a11y PASS:
  0 axe violations both themes, tag contrast 6.79–9.18:1, panel has no
  focus stops. Dogfood: every checker wrote `MANIFEST_SHA256` from the new
  briefs-by-dispatch, and both gates accept.
- **2026-09-29e — the port creates a dashboard/gate disagreement
  (mechanism: primary checker O1, independently second checker obs. 2;
  lead-reproduced).** With the ported gate, an `accepted` tier-2 row whose
  manifest hits a critical glob and has no flag is refused by `gate.sh check`
  (exit 1, "escalation trigger (critical-glob) but no flag") while
  `parse.mjs` derives `state: accepted`. Same for boss-overrule and
  two-consecutive-fails triggers. Pre-existing in the 2026-09-18 source (the
  port is byte-faithful), so not a GH1 FAIL (scope precedent 2026-08-29c/d);
  but on master the two AGREE (neither refuses), so merging GH1 alone
  introduces the lie the dashboard's differential battery exists to
  prevent. Lead oracle gap: C2 asserted the dashboard suite passes, not
  that the suite covers the new refusal. User decision pending.
- **2026-09-29f — a judge-named PASS supplies a lane (mechanism: second
  checker obs. 1; lead-reproduced).** Tier-3 row `checks=tests` with
  `checker-tests` PASS + a `judge-x.verdict` saying `VERDICT: PASS`,
  `FAMILY: adversarial`, no `MANIFEST_SHA256` → `OK: accepted at tier 3`
  under BOTH gates. Pre-existing on master. Belongs with run CD, which
  redefines which verdicts count toward a lane.
- **Backlog observations (second checker, not reproduced by the lead):**
  oracle has no probe for "manifest path without fingerprint line" (one of
  14 mutants survived); `.files` itself is not fingerprinted, so trimming a
  path after fingerprinting evades the critical-glob trigger; a `report.md`
  that is a directory or dangling symlink passes the `-f` test; CLAUDE.md's
  "next scan clears a flag once the tier is raised" is false while the
  trigger is still live; stale text at `dashboard/test/parse.test.mjs:693`
  and `smoketest/e2e/RUNBOOK.md:17-18`; `sha256sum -c` warns on `deleted`
  lines; dashboard tests leave `dash-parse-test-*` dirs in TMPDIR.
  Process (primary checker O3): concurrent checkers share the session
  scratchpad — one deleted another's `mut/` dir mid-run. Future checker
  briefs name a unique scratch subdirectory.
- **2026-09-29g — GH2 attempt 1 accepted; no FAIL at any lane.** Oracle
  `ORACLE PASS` (D 14/14, C3: shipped tests fail 9 against GH1's
  parse.mjs). checker-tests PASS: 13 one-edit parse.mjs mutants — the
  oracle's D scenarios caught 10, the shipped suite (C2) caught judge
  de-dup, non-strict majority and JS `trim()` (lead oracle gap: D alone
  misses those three), one equivalent survivor (`/**`→`/*` is redundant in
  fnmatch, 380k fuzz cases); own fixtures 84/85 agree, the one miss being a
  pre-existing filename-parse ambiguity. checker-second PASS: ~2.3M fnmatch
  pairs and 9,000 fuzzed glob/manifest files vs the gate's embedded python,
  0 mismatches; ~3,000 fuzzed fixtures against the real gate, 0
  trigger-caused disagreements; `parse()` proven read-only on 300 fixtures.
- **Backlog from GH2 (checkers + worker; pre-existing, identical under GH1):**
  - **B1 — gate fails OPEN on bad critical-glob inputs (second checker,
    gate defect, highest priority).** An unreadable or non-UTF-8
    `critical.globs`, `test.globs` or any manifest of the task makes the
    embedded python in `manifest_hits_glob` die; the gate then reports no
    critical-glob hit and accepts (chmod-000 probes exit 0 with a traceback).
    The dashboard mirrors it, so parity holds — both are wrong.
  - Verdict header parsing: the gate's `field_of` takes the FIRST `^KEY:`
    line anywhere; `parse.mjs` takes the LAST header before `---` and trims
    keys/values — duplicate VERDICT headers, trailing/leading whitespace,
    `VERDICT:` only in evidence all split the two (worker, both checkers).
  - Verdict filename ambiguity (`r.1.2.x.verdict`, `CHECKER: 2.x`) and
    leading-zero attempts split the two.
  - Flag `TARGET_TIER` parsing differs on `x`, `3abc`, `0x3`, CRLF, duplicate
    lines (gate dies "unbound variable" on `x`); `parse()` throws EISDIR when
    `flags/<id>.flag` is a directory (never-throw contract).
  - Boss OVERRULE + a judge sharing a FAMILY with no FAIL: gate refuses
    ("duplicate judge family"), dashboard accepts.
  - Test gaps (V3 candidates): one path per remaining default test glob
    (`tests/**`, `smoketest/**`, `**/test_*.py`) and a mixed
    test+production manifest.
  - Lead oracle nit: `differential.mjs` uses `TMPDIR ?? os.tmpdir()`; an
    EMPTY `TMPDIR` would put scratch in the cwd (`||` is the fix). Unset
    here, so no effect this run.
