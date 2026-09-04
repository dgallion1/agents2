# U-run state (recovered 2026-09-04)

The U run's lead worktree (`agents2/.claude/worktrees/budget2-ui-phase-0-31e20c`)
was removed on 2026-09-04 during a worktree cleanup while its SPEC.md was
uncommitted and its gitignored `.swarm/` held the run's ledger and Tier-3
oracles. Everything here was reconstructed by replaying the session
transcript's write commands, then checked against the memory record
(U1–U5 accepted, U6 halted attempt 3, U7–U15 pending, rulings a–i).

- `../../SPEC.md` — the U-run constitution (this repo's current run).
- `ledger.tsv` — gate ledger at the moment of the U6 hard stop.
- `tier3/U5`, `tier3/U6`, `tier3/U14` — lead-authored oracles.

To resume: create a worktree, copy `ledger.tsv` and `tier3/` into its
`.swarm/`, and continue from ruling i (U6 attempt-4 scope decision). The
worker output for U6 is the 65-file uncommitted diff in budget2's
`.claude/worktrees/ui-audit` (backed up at origin `backup/ui-audit-wip-20260904`).
Verdict and manifest files were NOT recoverable (written by checker
subagents); their conclusions are summarized in SPEC.md §10.
