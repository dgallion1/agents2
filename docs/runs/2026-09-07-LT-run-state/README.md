# Run LT — Dashboard and Insights layout tightening (2026-09-07)

Evidence snapshot of `.swarm/` (gitignored) for the four-task run described
in SPEC.md "Run LT". Target repo: budget2, branch `feat/layout-tightening`
(commit 5334385 off master c0b8476), shipped as simpleBudget PR #97, merged
as master 344cb30 and deployed to :8080 on 2026-09-07.

- `ledger.tsv` — LT1, LT2, LT5, LT6, all Tier 2, all accepted at attempt 1.
- `critical.globs` — storage/dataloader/engine/transfers/accounts/confirm/backup
  paths; no manifest matched (escalate-scan wrote no flag).
- `manifests/` — one file list per task at attempt 1.
- `verdicts/` — LT1 tests+a11y; LT2 a11y+second; LT5 tests+a11y+second;
  LT6 tests+a11y; LTfinal site-wide a11y. Every PASS cites its commands.
- `gate.sh done` → OK; `gate.sh stats` → first-attempt clean 4/4. Rulings
  a–e plus the close-out note in SPEC.md.
