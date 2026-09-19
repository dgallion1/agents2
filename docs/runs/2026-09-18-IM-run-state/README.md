# Run IM — Superseded pending rows drop at load; imports assign their account (2026-09-18)

Target: simpleBudget branch `feat/import-superseded` (worktree
`.worktrees/import-superseded`) over master 86d3a7c. Four tasks, all
accepted at attempt 1: IM1 dca7dfd (Tier 3, worker-coder), IM1T 2b3bafd
(Tier 1, lead-authored test-only follow-up), IM2 e5a92dd (Tier 2
tests,a11y,second, worker-coder), IM2F 4865cdf (Tier 2 tests,
lead-authored follow-up chosen from the user's menu). `gate.sh done`: OK.
`gate.sh stats`: `first-attempt clean: 4/4 (no-evidence rows: 0)`.
PR #119 MERGED 643fa54 + DEPLOYED :8080 2026-09-18 21:11 EDT (health
`v1.4.0-1170-g643fa54`, release built in the in-repo detached worktree
`.worktrees/release-IM`, old binary `budget2.old-2111`); worktrees and
branch removed. Post-deploy live check matched the oracle; the posted
BJ's Membership row was pinned. See SPEC.md §0.

Origin: the user's 2026-09-18 re-upload of six USAA exports under browser
names orphaned decisions and pins (hand-fixed first, then this run made the
two root causes go away: stale pending rows from overlapping exports, and
account assignment by filename). User questions: "Maybe we should ignore
pending?" → superseded-only rule; "is there some way to avoid my having to
rename the files?" → content-based account detection on import.

Catches (by mechanism):
- **Both-ends oracle validation (IM1, lead):** two hand-derived expectations
  were wrong — restored posted twins can carry a different major-expense
  label than the pending rows they replace (Five Guys via Grubhub →
  restaurants; posted Membership 64.50 → unmatched). Fixed before dispatch.
- **Primary checker (IM1, F2):** SPEC AC8 said the stage runs "after
  dedup", contradicting §2.1; the worker followed §2.1; mutation proved
  §2.1 right. Lead artifact.
- **Primary checker (IM1, F1):** AC5 half-tested → IM1T. Lead's first IM1T
  draft relied on a mutation that killed nothing; rewritten to the
  cross-account case, which is the only package test killing the
  same-account mutation.
- **Primary checker (IM2, F1/F2/F4/F5):** rows-vs-distinct-keys deviation
  (IM2F offered), two probe promotions, and a lead §4.2 error (six not
  seven identical files).
- **Second lane:** no catch at IM1 or IM2; its wrong-account attack on the
  real transfer legs did not land. **a11y lane:** nothing in the diff.

Artifacts here: SPEC.md, ledger.tsv, critical.globs, manifests/, verdicts/,
IM1 oracle (accept.sh, probe.py, expected.json, oracle.1.log — the frozen
personal-data fixture is deliberately NOT archived), IM2 real-data check
(check.py, serve.sh, both logs).
