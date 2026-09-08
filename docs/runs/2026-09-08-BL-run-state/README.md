# Run BL — deferred accessibility backlog (2026-09-08)

Evidence snapshot of `.swarm/` (gitignored) for the five-task run described
in SPEC.md "Run BL" (the items deferred by runs LT and RF). Target repo:
budget2, branch `feat/backlog-a11y` (commit 23a949c off master 43ce76e).

- `ledger.tsv` — the shared LT+RF+BL ledger: BL1/BL2 (Tier 2, attempt 1),
  BL3/BL4 (Tier 1, lead-direct, accepted at attempt 2 after conceded
  primary-checker FAILs), BL5 (Tier 1, test-only, attempt 2 after an
  under-pinning observation).
- `manifests/` — one file list per attempt.
- `verdicts/` — nine verdicts including the two attempt-1 FAILs (invisible
  dark-mode focus ring; Roth "$" over the input fill at 4.07:1).
- `gate.sh done` → OK; `gate.sh stats` → first-attempt clean 13/16 across
  LT+RF+BL. Rulings a–g and the close-out note in SPEC.md.
