# Run PS — a refused person removal keeps the spending-phase basis (2026-09-27)

Target: simpleBudget branch `fix/phase-select-restore`, commit 2907838 over
master 888999a (worktree `.worktrees/phase-select-restore`). One task, Tier 2
with `tests`, lead-authored under the lean exception. PR #123 MERGED 6bf3839
+ DEPLOYED :8080 2026-09-27 (health v1.4.0-1180-g6bf3839; old binary
budget2.old-1013). Release built in the in-repo detached worktree
`.worktrees/release-PS` (vcs.modified=false), then removed; feature branch
deleted locally and on origin.

Source: an external review of 2026-09-20..27 (five commits, 48 files), one
finding, P2 at `whatif-rate-assumptions.js:54-59`: with "Spouse Age Only"
selected, removing a healthcare-linked spouse is refused and the row comes
back, but "Older Person" stays selected and the next unrelated save persists
it. The lead verified the claim in code (the refused request writes nothing;
the stale value is the client-side coercion in `togglePhaseReferenceDropdown`)
and reproduced it with a probe on the existing node harness before the fix.

Fix: `removePersonRow` captures `#phase-age-reference-select`'s value before
removing the row and restores it on refusal, before the dropdown toggle. The
successful path is unchanged.

## Outcome (gate.sh, verbatim)

```
OK: PS1 accepted at tier 2 (attempt 1)
OK: all tasks accepted, evidence verified, no unresolved flags
stats: PS1 tier=2 first-attempt=1 clean (now: status=accepted attempt=1)
first-attempt clean: 1/1 (no-evidence rows: 0)
```

## Catches, by mechanism

- **External review** found the defect; **lead probe** reproduced it
  (`'older' !== 'spouse'`) before any fix. Nothing was caught inside the
  run: checker-tests PASSed attempt 1 on (a)–(f).
- **Primary checker** ran the new test against base 888999a independently
  (fails for the right reason) and killed mutations m1/m3/m4; m2 (restore
  after the toggle) survives but is equivalent in every reachable state
  (ruling 2026-09-27b).
- **Final a11y sweep** (sandbox builds of PS and base on copies of real
  data, never :8080): axe results identical to base on 9 pages × 2 themes;
  end-to-end with the real healthcare-linked spouse, base persists "Older
  Person" after a refused removal plus an unrelated same-form save and
  reload, PS keeps "Spouse Age Only". Personal names in that report are
  redacted to `<primary>`/`<spouse>` in this public copy.

## Backlog (recorded, not fixed)

- Role change Spouse → Other coerces the select to "older"; switching back
  does not restore it (user-initiated and visible; out of scope).
- A person added and a new phase picked inside the refused request's
  ~500 ms + round-trip window would be overwritten by the restore.
- The refusal alert lands at the top of the form, not beside Remove
  (WS4 design); ACCESSIBILITY.md point 10 names `aria-live="polite"` but
  the shipped mechanism is `role="alert"` sitewide.
- Node tests still have no make target (WS F3); the fake-DOM harness has no
  real `<select>` option validation or htmx.
