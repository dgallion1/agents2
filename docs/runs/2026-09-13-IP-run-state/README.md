# Run IP — Insights page presentation (2026-09-13)

Snapshot of the run's `.swarm/` evidence plus the constitution (SPEC.md) at
close. Target repo simpleBudget; PR #110 merged as 94820b7 and deployed to
:8080 (systemd user unit `budget2.service`, pid 77523, health
v1.4.0-1142-g94820b7) on 2026-09-13.

- `SPEC.md` — constitution, design §3, task table §4, rulings §7 (a: Compact
  flag unwired — lead review + checker-second; b: tile borders < 3:1 —
  checker-a11y; c: final-pass a11y scoping; backlog observations).
- `ledger.tsv` — IP1 Tier 2, checks a11y,second, accepted at attempt 2.
- `verdicts/` — IP1.1 (both FAIL), IP1.2 (both PASS), with commands.
- `manifests/`, `briefs/`, `critical.globs`.

`swarm/gate.sh stats`: `first-attempt clean: 0/1 (no-evidence rows: 0)`.
