# TIERS.md — verification risk rubric

The lead assigns every task a tier in Phase 0. Answer three questions per task.

1. **Oracle** — is there an executable check that decides pass/fail
   objectively (a test, a diff, an axe run, a command with an expected
   output)? Or does judging the result require taste? (At Tier 3 the oracle
   is also a required pre-dispatch ARTIFACT — see CLAUDE.md Tier 3 for the
   `accept.sh` contract.)
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

## Checks column at Tier 2 (lean experiment, 2026-08-31)

Assigning Tier 2 is only half the decision — the ledger `checks` column names
the verifiers, and the gate requires a PASS from every one named (`codex`
is never one). An empty column hard-fails at every tier, and so does one
naming only `codex`. Default to the ONE relevant primary verifier
(`tests`, `a11y`, or `content`). Add `second` — restoring the dual-lane
pre-experiment contract for that task — when the task touches a
defect-history surface: user-visible value formatting/rounding, a
threshold applied to a figure on multiple surfaces, arithmetic over rendered
strings, money, or anything where a wrong figure on screen is a lie. When
unsure, add it. At Tier 3 name every checker that must run (at least the
primary and `second`): the gate requires a PASS from each one named AND
PASSes spanning both lanes (a Codex PASS is no lane).

**Tie-break: round up.** If a task sits between two tiers, choose the higher.
But escalation is not free: a test-only follow-up dragged through Tier 3 once
cost 9.5h against 29min done directly (2026-08-24). Escalate on what the
diff *is*, not on what the task it follows up on was.

## The Codex lane (trial, run CD)

Codex, another vendor's model, runs alongside `checker-second`: name `codex`
in `checks` beside `second` on every Tier-3 task and every Tier-2 task that
names `second`. Trial rule: a Codex FAIL counts (at tiers 2/3 it opens the
dispute path, named or not; at Tier 1 only a named one blocks acceptance, but
at every tier it counts toward two consecutive fails and in `stats`), a Codex
PASS never does (no named-checker requirement, no lane), an outage never
blocks. `codex`
only demands ONE outcome at the current attempt, a valid `checker-codex`
verdict or `.skip` record written by `swarm/codex-check.sh`; a column naming
only `codex` is refused like a blank one. Details: CLAUDE.md, "The Codex
lane".

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

A manifest path only forces escalation when it matches `critical.globs` **and
is not test code** — a change to `src/payments/foo_test.go` alone does not
escalate, but a change to `src/payments/foo.go` alone does, and a manifest
mixing the two still escalates (one production-file match is enough; a test
file cannot buy an exemption for the rest of the manifest). What counts as
test code is `.swarm/test.globs`, in the same one-glob-per-line format. If
that file is absent, gate.sh falls back to a compiled-in default list
(`**/*_test.go`, `**/*_test.py`, `**/test_*.py`, `**/*.test.ts`,
`**/*.spec.ts`, `smoketest/**`, `tests/**`), so an existing `.swarm` directory
keeps working unedited. This exemption is path-based only — it does not
inspect diff content, so a comment-only change to a production file still
escalates. That is deliberate, not a TODO: content-based exemption needs a
base ref plus per-language comment stripping, which has already proven
unsound here in both directions — evadable by spelling a name through a
variable, and false-firing on prose (see commit 31e9954). Do not re-propose
it.

The evaluation fails CLOSED. A `critical.globs`, `test.globs` or task manifest
that is PRESENT but unreadable (not a regular file, not valid UTF-8,
permission denied) makes it unreadable, and an unreadable evaluation
escalates exactly like a hit, with the reason `critical-glob-unreadable` and
one diagnostic line on stderr. Only an ABSENT file keeps its old meaning: no
`critical.globs` means no trigger, no `test.globs` means the default list above.

## Phase 0 output

In SPEC.md's task table, add a **Tier** column with a one-line justification
per task (which of the three answers drove it). Draft `critical.globs`. Both
are covered by the existing user sign-off gate — the user approves or
overrides tiers there. Mid-run, tiers may only move **up** (escalation),
never down.
