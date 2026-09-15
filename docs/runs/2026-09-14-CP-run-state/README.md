# Run CP — current plan card applyable (2026-09-14)

Target: simpleBudget PR #114 `feat/current-plan-apply` (fc8d16b over master
d6c554f). MERGED bcb6226 + DEPLOYED :8080 2026-09-14 (health
v1.4.0-1151-gbcb6226). One task, Tier 2 with `tests,second,a11y`,
lead-authored under the lean exception.

User question: "why is the lower spend rate not selectable?" — the Current
plan card on the "How much can I spend?" results had no Apply button
because the apply gate excluded baseline candidates. User then asked to
make it selectable; design signed off as "only when it qualifies" (same
rule as every other card).

Outcome: accepted at attempt 1. `gate.sh stats`:
`first-attempt clean: 1/1 (no-evidence rows: 0)`.

Catches: none. All three lanes PASSed first time; both required mutations
(old gate body restored; unconditional rule dereference restored) were
killed by the shipped tests; the adversarial lane probed every applied-
evidence consumer with a nil-rules current candidate end to end.

Process: checker briefs named every git state command and the binary as
forbidden; all three confirmed sha256 identity before and after. No breach.

Deploy lesson: build worktree outside the repo stamped a foreign
`vcs.revision` from the `/home/darrell/bin` git repo (Go walks up past a
linked worktree's `.git` file). Rebuilt in `.worktrees/release-CP` inside
the repo; stamp verified before swap. See SPEC.md Rulings for backlog
observations.
