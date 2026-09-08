# Run SV — "Review these transactions" sorted by value (2026-09-08)

Evidence snapshot of `.swarm/` (gitignored) for the one-task run described
in SPEC.md "Run SV". Target repo: budget2, branch `feat/findings-sort-by-value`
(commit a849ab8 off master 5a75ca1), not yet pushed.

- `ledger.tsv` — SV1 (Tier 2, checks: tests, lead-direct), accepted attempt 1.
- `critical.globs` — copied from run RF; no manifest matched; no flag.
- `manifests/SV1.1.files` — the two production files plus the new test.
- `verdicts/SV1.1.checker-tests.verdict` — PASS, command per criterion, three
  mutation probes.
- `gate.sh done` → OK; `gate.sh stats` → first-attempt clean 1/1.
