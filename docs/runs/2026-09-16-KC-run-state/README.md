# Run KC — Current plan card: "Apply this option" → "Keep current plan" (2026-09-16)

Target: simpleBudget PR #115 `feat/keep-current-plan` (e8965d9 over master
bcb6226). MERGED d1aca01 + DEPLOYED :8080 2026-09-16 (health
v1.4.0-1153-gd1aca01). One task, Tier 2 with `tests,a11y`, lead-authored
under the lean exception. Not a defect-history surface, so no `second`.

User report: "when I hit apply it clears the view, but doesn't apply the
values." Diagnosed (systematic-debugging, no fix until root cause): the
Apply mechanism works. CP1 (#114) gave the Current plan card — rendered
first, above the two recommendations — an "Apply this option" button
identical to theirs; applying it re-saves the plan as-is and reloads the
page with the results panel gone. Evidence: live journal (two
optimize→apply cycles, both saved+redirected), live `whatif.json`
(`applied_spending_evidence.candidate.id = "current"`, base unchanged at
the non-step value 7639.34), and a throwaway :8082 copy where applying a
recommendation changed the base 7639.34→8100 and applying the current card
reproduced the symptom exactly. User decision: relabel to "Keep current
plan" and deploy.

Outcome: accepted at attempt 1. `gate.sh stats`:
`first-attempt clean: 1/1 (no-evidence rows: 0)`.

Catches: none. Both lanes PASSed first time; the mutation (label reverted)
was killed by the shipped test in the checker's copy; checker-a11y rendered
the partial through the real renderer with a two-headline fixture and
confirmed the name is a visible text node, classes byte-identical to the
sibling buttons, DOM order unchanged, one-line diff vs bcb6226.

Observations for the backlog (both checkers, non-blocking):
- The two recommendation cards still share the name "Apply this option"
  when two headlines render (pre-existing; another session's
  `feat/apply-button-names` worktree addresses accessible names with
  sr-only text — its test must be updated to expect "Keep current plan" on
  the current card before it lands).
- The new test's attribute-order guard is brittle; the load-bearing
  assertion is order-independent.
- Possible follow-up: the post-apply banner after "Keep current plan" still
  says "Saved spending plan: …" with the unchanged figures; a "kept
  unchanged" wording would close the loop. Not requested.

Process: checkers worked in `cp -a` copies in the scratchpad, confirmed
sha256 identity of both files before and after, never ran the binary or
changed git state. No breach. Release built in `.worktrees/release-KC`
inside the repo (vcs.revision stamp verified before swap).
