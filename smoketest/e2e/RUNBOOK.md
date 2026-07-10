# End-to-end runbook (validation layer 3)

Requires the gateway up and API keys set. From a copy of this directory as the
project root, launch the lead through the gateway (README "Setup") and prompt:

> Read CLAUDE.md and TIERS.md. Phase 0: draft SPEC.md tiers (already tabled
> here), ACCESSIBILITY.md, and .swarm/critical.globs, show me for sign-off,
> then run the build rounds.

Confirm, in order:
1. Phase 0 produces a ledger with a Tier column and the four tasks.
2. `t-content` accepts at Tier 1 (one checker PASS).
3. `t-nav` runs two different-family checkers; both PASS before accept.
4. `t-footer` (Tier 1) touches `deploy.config.json`; `gate.sh escalate-scan`
   writes a flag and the task re-verifies at Tier 2. **This is the key
   assertion — glob escalation fired.**
5. `t-preorder` creates two worktrees, produces a divergence report, gets a
   RESOLUTION line, and the merge passes Tier 2 checks.
6. `swarm/gate.sh done` exits 0 only after all four are accepted.
