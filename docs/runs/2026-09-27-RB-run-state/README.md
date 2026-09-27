# Run RB — flipping a person back to Spouse restores the spending-phase basis (2026-09-27)

Target: simpleBudget branch `fix/role-change-phase-basis`, commit 275d0d8
over master 6bf3839 (worktree `.worktrees/role-basis`). One task, Tier 2
with `tests`, lead-authored under the lean exception. PR #124 MERGED e58598c
+ DEPLOYED :8080 2026-09-27 (health v1.4.0-1182-ge58598c; old binary
budget2.old-1143). Release built in the in-repo detached worktree
`.worktrees/release-RB` (vcs.modified=false), then removed; feature branch
deleted locally and on origin.

Source: run PS backlog (`docs/runs/2026-09-27-PS-run-state/`). With
"Spending Phase Based On" = "Spouse Age Only", changing the only spouse's
Role to "Other" coerces the basis to "Older Person" (correct, and saved);
flipping the same person back to "Spouse" left "Older Person", so the round
trip silently changed the saved plan. User: "fix the role change backlog
item too".

Fix: `updatePersonRole` records the coerced value per person ID in a
page-level map (`window.whatifPhaseBasisBeforeRoleChange`) and restores it
when that person becomes a spouse again, unless the basis changed
meanwhile.

## Outcome (gate.sh, verbatim)

```
OK: RB1 accepted at tier 2 (attempt 2)
OK: all tasks accepted, evidence verified, no unresolved flags
stats: RB1 tier=2 first-attempt=1 failed (now: status=accepted attempt=2)
first-attempt clean: 0/1 (no-evidence rows: 0)
```

## Catches, by mechanism

- **Primary checker, attempt 1 (FAIL, conceded — ruling 2026-09-27c):**
  every unit criterion passed, but the lead's design kept the record as
  attributes on the person row, and every successful save re-renders the
  whole Rate Assumptions card out-of-band (`whatif.html:286`). The checker
  proved it by replaying the real page — vendored htmx 2.0.10 plus
  Go-rendered save responses in jsdom: flip back at 100/450 ms → `spouse`,
  at 700/1500 ms → `older`. Lead/spec defect: the SPEC's facts even said
  "each flip is saved", but no fixture ran a save between the flips.
- **Primary checker, attempt 2 (PASS):** m1–m8 killed; the same replay ends
  `spouse` at all four delays (base `older`); the map survives the swap.
  Corrected a second lead premise (F2): the script is loaded once per page
  from `pages/whatif.html:164`, not re-executed on a swap.
- **Final a11y sweep:** axe identical to base on 9 pages × 2 themes × 2
  builds; end to end by keyboard and mouse, the fix keeps "Spouse Age Only"
  across Other → save → Spouse → save → reload, base persists "Older
  Person". Focus returns to the new Role select after the card swap
  (htmx same-ID focus restore), same as base.

## Lessons

1. **Enumerate what a save response replaces before storing state in the
   DOM.** `hx-swap-oob` on a whole card makes every element in it
   short-lived; a unit fixture that never swaps cannot see it. The swap is
   now simulated in the fixture (a2), and a self-check proves the
   row-attribute design fails there.
2. **A replay harness beats the fake DOM for htmx timing.** The attempt-1
   checker's jsdom + vendored htmx replay caught what 25 fake-DOM tests
   could not; it was reused unchanged as criterion (h).
3. **Probe method note (a11y sweep):** Playwright `selectOption()` alone
   does not leave real DOM focus where a mouse click does; precede it with
   `click()` or a focus probe falsely reports focus loss.

## Backlog (recorded, not fixed)

- **F1:** a Role flip made while the previous save is still in flight is
  erased by that save's card swap (the role change itself is lost), the
  same on base — the whole-card swap race.
- **F2:** the new code comment says the map is created lazily because
  "this file can be re-executed when its component is swapped"; it is
  not (loaded once per page). Harmless; not worth the hard-stop attempt.
- `/explorer` has no `<footer>` landmark (pre-existing, ACCESSIBILITY.md
  point 1).
- Known limit: if another spouse appeared meanwhile and the user
  deliberately chose "Older Person", the flip back still restores.
