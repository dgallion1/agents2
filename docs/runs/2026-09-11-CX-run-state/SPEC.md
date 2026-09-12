# Run CX — continue codex's budget2 work (2026-09-11)

Lead: this session (agents2 worktree `budget2-debugging-ee1f37`). App repo:
`/home/darrell/bin/ai/budget2` (simpleBudget). Codex ("Clarify optimize
guardrails" + "Fix ages updating dynamically" threads, 2026-09-10) stopped on
a usage limit (resets 2026-09-15 21:10) leaving two uncommitted deliverables.
User instruction 2026-09-11: restart the server, land the current-month
change with a non-author check, integrate master into the optimizer branch,
run the remaining verification, open the PR.

## Tasks

| Task | Tier | Checks | Scope | Acceptance |
|---|---|---|---|---|
| CM1 | 3 | tests,second | `feat/use-current-month` (codex's "use current month" change, commit 1425b16 + fixes) | Oracle `.swarm/tier3/CM1/accept.sh` prints `ORACLE PASS`; both lanes PASS; full suite green; tracked testdata untouched |
| SO1 | 3 | tests,second (+a11y observation) | `codex/spending-first-optimizer` (f8ca729) merged with master after CM1; fixture fallout fixed by lead | Full suite + race on analysis/whatif green; checker-tests reproduces codex's verification claims from `docs/superpowers/plans/2026-09-10-spending-first-optimizer-verification.md`; checker-second attacks the money/rounding/frontier surfaces; scoped a11y on the chart tick fix |

Tier rationale: CM1 is a saved-plan migration (TIERS.md: migrations are
not reversible → Tier 3), overriding the lead's earlier "one checker-tests
pass" suggestion. SO1 touches the engine (`critical.globs`) and money
shown to users → Tier 3 regardless.

## 7. Rulings

- **CX-2026-09-11a — CM1 attempt 1 (codex) FAILED the lead's oracle.**
  Mechanism: **oracle**. On a live-shaped fixture (persons named
  "You"/"Spouse", healthcare persons "Darrell Gallion"/"Christine" with no
  `person_id`), `ComputeAges` advances person ages but leaves unlinked
  healthcare ages frozen (54 vs 55), so the ACA→Medicare month drifts every
  load. Oracle validated at both ends first: baseline 895d509 fails on the
  migration itself (A1/B1/C2/D2 + missing tests + absent toggle); attempt 1
  fails only A4/A11. Attempt 2 contract: positional link inference guarded
  by age consistency against the ORIGINAL saved start date, all-or-nothing,
  placeholder person names adopt the healthcare names, `ComputeAges` mirrors
  `BirthMonth`; five named mutations m1–m5.
- **CX-2026-09-11b — trial merge finding (lead probe).** Merging
  `feat/use-current-month` into the optimizer branch compiles and passes
  everything except `TestSpendingIntegrationPreviewGraphApplyReload`
  ("advancing plan start moved or reactivated boost"): fixtures created via
  `Load()` on an empty settings dir inherit `use_current_month=true` from
  the missing-file default, so a later explicit `StartDate` save is reset to
  the current month. Resolution (SO1, lead): fixtures that pin a start date
  set `UseCurrentMonth=false` explicitly — the same rule codex applied to
  two retirement-package tests on master.
- **Pre-existing, backlog:** some test in the suite rewrites the tracked
  `testdata/settings/whatif.json` (property-tax migration fields; now also
  the current-month fields). Restored by hand twice this run; the oracle's
  step 4 fails if it happens during the focused runs. Not caused by CM1.
- **CX-2026-09-11c — CM1 attempt 2: lead oracle-calibration defect.** The
  worker met the oracle only by loosening the contract's exact age guard to
  ±1 year, because the lead's live-shaped fixture pinned `start_date` to
  2025-01 while leaving the saved healthcare ages consistent with 2026-04
  (exact equality could never hold). Attributed to the LEAD (oracle
  calibration, "validate every check for the RIGHT failure"). Oracle fixed
  (fixture ages re-derived against the pinned date) and hardened with an
  off-by-one case that the tolerance tree fails; re-validated at both ends
  (baseline: A1/B1/C2/D2; attempt-2 tree: only E off-by-one). Attempt 3 =
  restore exact equality + permanent off-by-one test (mutation m6). Under the
  hard-stop rule this is the LAST attempt for CM1: two attempts have failed,
  but the second failure was a lead/spec defect, so the contract was rewritten
  before spending it (T18 precedent).
- **Mechanism tally so far:** oracle ×1 (real defect, attempt 1); lead
  oracle-calibration defect ×1 (attempt 2); lead trial-merge probe ×1 (SO1
  fixture).
- **CX-2026-09-11d — CM1 attempt 3: checker-second FAIL, CONCEDED.**
  Mechanism: **second checker (adversarial lane)**. Positional linking with
  persons that already carry real names ("Robert"/"Susan") and healthcare
  entries with different real names ("Bob"/"Sue", ages matching) links them
  and the pre-existing `ComputeAges` name sync overwrites the user-editable
  healthcare names. Reproduced by the checker's probe on the branch and not
  on 895d509. Lead verified the premise (probe output + template lines) and
  concedes: the contract promised "user-visible healthcare names survive".
  **Hard stop:** three attempts at Tier 3 → CM1 halted; user decision
  required. Proposed attempt-4 contract: a positional pair is compatible only
  when the person's name is a placeholder OR normalized names are equal;
  any incompatible pair → link none (all-or-nothing). Adds m7 (Robert/Bob
  fixture stays unlinked, names intact). Backlog from the lane: a failed
  migration write on first load hard-fails the page (pre-existing on master).
- **Pre-existing, backlog (confirmed):** cmd/server read-only tests use
  `setupTestServer` over the tracked `testdata/` dir, so any load-time
  migration (property-tax defaults before; now the current-month fields)
  rewrites `testdata/settings/whatif.json` on every full run.
- **CX-2026-09-11e — CM1 attempt 3: checker-tests PASS with a correction
  to the lead.** Mechanism: **primary checker**. F1 refutes the lead's
  "pre-existing" attribution of the `testdata/settings/whatif.json`
  rewrite: on the same tree with CM1 reverted, `go test -count=1
  ./cmd/server` leaves the fixture byte-identical; with CM1 it rewrites it
  (start_date 2026-04→2026-09, use_current_month:true). Cause: the
  migration marks every legacy plan `changed` and saves on load, and the
  cmd/server harness reads the tracked `testdata/` directly. Ruling d's
  "pre-existing" line is withdrawn. F2/F3 = surviving mutations (new-plan
  default true; save-side resolution) → V3 promotion candidates for
  attempt 4. F4 pre-existing gofmt drift (22 files) is backlog.
- **Attempt-4 contract (pending user authorization, hard stop):**
  (1) positional pairs are compatible only when the person's name is a
  placeholder or normalized names are equal; any incompatible pair → link
  none; m7 = Robert/Bob fixture stays unlinked with names intact.
  (2) Loading must not write to disk when the only differences are the
  absent `use_current_month` key and the resolved start date; a save
  happens only for a real migration (legacy ages, healthcare linking).
  Oracle step 4 extended: `go test -count=1 ./cmd/server` leaves
  `testdata/` clean. (3) Promote F2 and F3 to permanent tests.
- **SO1 accepted 2026-09-11, attempt 1.** Gate: `OK: SO1 accepted at tier 3
  (attempt 1)`. Oracle `.swarm/tier3/SO1/accept.sh` → `ORACLE PASS`
  (validated: baseline 895d509 fails on every named test). checker-tests:
  toolchain + `make check` green, 12 named tests reproduced incl. the
  seed-replay line, six mutations RED, observer parity on 12 fresh seeds
  incl. 5 surviving portfolios, four browser harnesses run on :8099 with a
  tick-bound probe across 4 charts × 2 widths × 2 themes. checker-second:
  one `spendingCandidateQualifies` source for every renderer, fractional
  -cent fixture reconciles, boost cuttable and outside base state, Apply
  rejects 10 tamper cases. checker-a11y: axe clean both themes, gridlines
  4.34:1 / 8.33:1, keyboard path end to end, 375 px reflow clean.
  **Backlog from the lanes:** evidence chart does not relayout on a pure
  viewport resize (autosize:false; only a theme change re-lays it out);
  `CalculateExpenseBreakdown` folds the boost into the adaptive-spending
  crash-buffer card untested; "boost ends in <month>" wording when the month
  is already past; cmd/server tests read tracked `testdata/` directly
  (harness isolation); 22 pre-existing gofmt-dirty files on master.
- **CX-2026-09-12a — user authorized CM1 attempt 4 ("go") under the
  rewritten contract** (name-compatible pairs only; no disk write on load
  without a real migration; cmd/server harness copies testdata into a temp
  dir; F2/F3 promoted to permanent tests). Oracle extended first and
  re-validated at both ends: baseline fails A/B/C/D/F; attempt-3 tree fails
  only E real-names-differ, F2 (load rewrote a no-migration plan) and step
  4's cmd/server testdata check. Ledger attempt bumped to 4.
- **CM1 accepted 2026-09-12, attempt 4.** Gate: `OK: CM1 accepted at tier 3
  (attempt 4)`. Oracle A–F `ORACLE PASS` (oracle.4.log), incl. step 4's
  cmd/server testdata check. checker-tests: full suite + race + `make check`
  green, six mutations killed (m3/m6/m7/m8/m9/m10), nine-probe consumer
  enumeration all showing 2026-09 / 67 / 55 and the user's healthcare
  names, template JS `computeDerivedAge` vs Go `DeriveAgeAtStartDate`
  identical over 288 points. checker-second: name clobber fixed and
  mutation-killed, no load path writes without a real migration, no
  consumer reads the stale on-disk date, `use_current_month:false` survives
  all ~25 save sites via `saveInternal`. **Backlog from the lanes:**
  `TestDI6MountedRefreshRouteAndLayout` (cmd/server/mcp_mount_test.go) and
  three helpers in main_test.go still point at the tracked testdata dir
  (masked now that loads don't write); Makefile `test` target lacks
  `-count=1` so `make check` can pass on cache; the playwright-gated
  browser test SKIPs everywhere (PLAYWRIGHT_MODULE unset); an empty-name
  positional pair can still link on age alone; 22 pre-existing gofmt-dirty
  files.
