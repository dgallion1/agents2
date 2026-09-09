# Run GV — Guardrails: make the feature legible (2026-09-09)

Evidence snapshot of `.swarm/` (gitignored) for the four-task run described
in SPEC.md (copied here as it stood at close-out). Target repo: budget2,
branch `feat/guardrail-visualization` (commit 35fac92 off master 5fae968),
merged as 895d509 (PR dgallion1/simpleBudget#104, on top of another
session's HTMX 2.0.10 upgrade 79c3c3a) and deployed to :8080 the same
afternoon (health `v1.4.0-1122-g895d509`, pid 1343561).

User request: "This feature is confusing to use. The graphs could be
better, maybe show when guardrails kick in. But see what you can do."

- `SPEC.md` — constitution with §1 findings (the optimizer simulated with
  no engine hooks, dropping Social Security), §4 task contracts, and §7
  rulings a–n recording every catch by mechanism.
- `ledger.tsv` — GV1 (Tier 3, accepted attempt 1), GV2 (Tier 3, accepted
  attempt 3 after a conceded a11y+tests FAIL and a conceded adversarial
  FAIL that triggered the Tier-3 hard stop; the user authorized attempt 3
  under a rewritten contract), GV3 and GV4 (Tier 2, accepted attempt 2
  after conceded tests-lane FAILs on structure-only tests).
- `manifests/` — every attempt's file list.
- `verdicts/` — 21 verdicts across the four tasks and their attempts.
- `tier3/GV1`, `tier3/GV2` — the executable oracles (`accept.sh` +
  overlay-injected `oracle_test.go`), both-ends calibration logs, and the
  lead's `oracle.<attempt>.log` for every attempt that reached the gate.
- `final-a11y-report.md` — site-wide axe audit, both themes, every page:
  RESULT: CLEAN.
- `snapshots/` — before/after screenshots: the original chart with its
  lone marker, the optimizer results and its "median hits $0" preview
  (no Social Security), and the finished light/dark chart and card.
- `gate.sh done` → OK; `gate.sh stats` → `first-attempt clean: 1/4
  (no-evidence rows: 0)`.

Lessons carried forward (also in memory): name the mutations a task's
permanent tests must kill; enumerate every renderer of shared chart data,
not just its data consumers; give each checker its own copy of a
snapshot; force the browser theme explicitly in headless audits.
