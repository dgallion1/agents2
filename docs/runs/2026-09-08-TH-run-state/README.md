# Run TH — Trends chart keeps height and theme across theme toggles (2026-09-08)

Evidence snapshot of `.swarm/` (gitignored) for the one-task run described in
SPEC.md "Run TH". Target repo: budget2, branch `feat/trends-theme-height`
(commit 4cc55a1 off master 258f058), merged as 5fae968 (PR #103) and deployed
to :8080 the same evening.

- `ledger.tsv` — the shared six-run ledger: TH1 (Tier 2, tests + a11y,
  accepted at attempt 1).
- `manifests/` — TH1.1 (with the worker's mutation proof and 40-row browser table).
- `verdicts/` — checker-tests and checker-a11y, both PASS at attempt 1.
- `snapshots/TH1.1/` — the two manifest files as handed to the checkers
  (both checkers `cmp`-verified them against the worktree first).
- `gate.sh done` → OK; `gate.sh stats` → first-attempt clean 16/21 across
  LT+RF+BL+BK+TC+TH. Rulings a–b (observations) and the close-out in SPEC.md.
