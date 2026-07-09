# TIERS.md — verification risk rubric

The lead assigns every task a tier in Phase 0. Answer three questions per task.

1. **Oracle** — is there an executable check that decides pass/fail
   objectively (a test, a diff, an axe run, a command with an expected
   output)? Or does judging the result require taste?
2. **Reversible** — if a bad result merges, is it trivially undone before any
   harm (revert a commit on a static page) — or does it touch money, auth,
   data, deploys, or anything published to real users?
3. **Blast radius** — one page/section, or a shared component / config /
   critical path that many things depend on?

## Mapping

| Oracle | Reversible | Blast radius | Tier |
|--------|-----------|--------------|------|
| strong | yes       | small        | 1 |
| weak   | yes       | small        | 2 |
| any    | yes       | shared/large | 2 |
| any    | **no** (payments, auth, deploys, migrations, external publishing) | any | 3 |

**Tie-break: round up.** If a task sits between two tiers, choose the higher.

## Critical paths

The lead also drafts `.swarm/critical.globs` — one glob per line naming files
whose modification forces escalation regardless of the assigned tier
(payment, auth, deploy, and migration paths for this project). Example:

```
src/payments/**
src/auth/**
**/deploy.config.*
db/migrations/**
```

## Phase 0 output

In SPEC.md's task table, add a **Tier** column with a one-line justification
per task (which of the three answers drove it). Draft `critical.globs`. Both
are covered by the existing user sign-off gate — the user approves or
overrides tiers there. Mid-run, tiers may only move **up** (escalation),
never down.
