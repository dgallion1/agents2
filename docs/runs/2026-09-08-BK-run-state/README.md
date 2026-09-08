# Run BK — remaining accessibility backlog (2026-09-08)

Evidence snapshot of `.swarm/` (gitignored) for the three-task run described
in SPEC.md "Run BK". Target repo: budget2, branch `feat/backlog-a11y-2`
(commit 141e6ea off master 176383f).

- `ledger.tsv` — the shared LT+RF+BL+BK ledger: BK1 (Tier 1, lead-direct,
  attempt 1), BK2 (Tier 2, attempt 1), BK3 (Tier 1, lead-direct: attempts
  1–3 FAIL on real primary-checker catches, contract rewritten to a two-tone
  ring, user reopened, attempt 4 re-verification PASS).
- `manifests/` — one file list per attempt (BK3 has four).
- `verdicts/` — seven verdicts including BK3's three FAILs.
- `gate.sh done` → OK; `gate.sh stats` → first-attempt clean 15/19 across
  the four runs. Rulings a–g and the close-out note in SPEC.md.
