# Run GM — guardrail markers on the What-If projection chart (2026-09-06)

Evidence snapshot of `.swarm/` (gitignored) for the one-task run described in
SPEC.md "Run GM". Target repo: budget2, branch `feat/guardrail-chart-markers`
(commit 1838676 off master 4543368).

- `ledger.tsv` — GM1, Tier 3 (escalated from 2 by the critical-glob scan),
  accepted at attempt 2.
- `manifests/` — GM1.1 (attempt 1, superseded) and GM1.2 file lists.
- `verdicts/` — checker-tests (anthropic) and checker-second (adversarial)
  PASS at attempt 2, each with commands cited.
- `tier3/GM1/accept.sh` + `oracle.2.log` — post-hoc oracle; validated at both
  ends (master fails on "trace missing" in both display modes). The script was
  hardened after the run (2026-09-07 review: mktemp scratch dir, `go vet ./...`,
  list rows without a money line, explicit trace-order check); `oracle.2.log`
  is the original version's output at 3a971b5. The hardened script re-passed
  against budget2 master on 2026-09-07 (3 cuts at y28/y32/y34 — the live plan
  had changed again, which is why criterion 5 no longer names events).
- `gate.sh done` → OK; `gate.sh stats` → first-attempt clean 1/1 as the gate
  counts it (attempt 1 produced no verdicts: the worker stopped on a brief
  defect). Rulings a–f in SPEC.md.
