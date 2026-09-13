# Run SP — spending plan: restore every form value after a reload (2026-09-13)

Target: budget2 (github.com/dgallion1/simpleBudget), base 94820b7.
Result: SP1 accepted at Tier 2 on attempt 1 (dual lane, lead-authored).
Commit 950e2d9 on `fix/spending-plan-restore` → PR
https://github.com/dgallion1/simpleBudget/pull/111 (opened; merge and
deploy pending the user).

`swarm/gate.sh stats`: `first-attempt clean: 1/1 (no-evidence rows: 0)`.

Contents: SPEC.md (diagnosis, design, task, rulings + backlog findings),
ledger.tsv, critical.globs, manifests/, verdicts/.
