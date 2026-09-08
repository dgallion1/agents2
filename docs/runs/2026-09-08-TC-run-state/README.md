# Run TC — Spending trends chart follows the table cap (2026-09-08)

Evidence snapshot of `.swarm/` (gitignored) for the one-task run described in
SPEC.md "Run TC". Target repo: budget2, branch `feat/trends-chart-cap`
(commit 00b866e off master a71e8b9), merged as 258f058 (PR #102) and deployed
to :8080 the same evening.

- `ledger.tsv` — the shared five-run ledger: TC1 (Tier 2, accepted at attempt 2
  after a conceded tests-lane FAIL — stale theme markers on re-render).
- `manifests/` — TC1.1 and TC1.2.
- `verdicts/` — six verdicts (three per attempt).
- `snapshots/` — the manifest files as they stood when each attempt was
  handed to the checkers (new process after ruling TC-a: a checker ran
  `git checkout` in the shared worktree; the reconstruction was proven
  byte-exact by blob hash, and snapshots now make that provable directly).
- `gate.sh done` → OK; `gate.sh stats` → first-attempt clean 15/20 across
  LT+RF+BL+BK+TC. Rulings a–c and the close-out in SPEC.md.
