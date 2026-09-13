# Run TX — tax-year-2026 federal tables (2026-09-13)

Target: simpleBudget PR #112 `feat/tax-tables-2026` (f21ab9d over master
ff4ff34). One task, Tier 2 with `tests,second`.

Outcome: accepted at attempt 2. `gate.sh stats`:
`first-attempt clean: 0/1 (no-evidence rows: 0)`.

Catches, by mechanism (see SPEC.md "Rulings"):
- primary checker (checker-tests): manifest listed files but no commands
  (AC9). Documentary; conceded.
- second checker (checker-second): the optimizer's year-10 test derived
  its expectation through the code under test; proven by a 5% mis-scale
  mutation the test did not catch. The lead's own contract wording
  ("the SAME value the engine reports") invited it — a lead error caught
  by the adversarial lane. Conceded; fixed against the literal.
- lead (pre-dispatch): the optimizer's private, hand-inflated 2024
  bracket-top table (split-classification class) would have overstated a
  2026 MFJ 22% fill by ≈$1.9k once a 2026 record existed. Folded into
  the task; checker-tests' mutation kill confirmed the number.

Process breach: a checker ran `git stash` in the live worktree during
attempt 1 (reflog: two `reset: moving to HEAD`; taxyears.go left staged).
Content survived; attempt-2 briefs forbid every git state command in
capitals and the lead snapshots by sha256, not rtk-filtered diff.

Tooling: under the rtk hook, `git diff` dropped a whole hunk on a second
run and plain `diff` returned exit 0 on a 623-vs-709-line pair. Compare
with sha256sum or python difflib.

Backlog observations (not defects): no shipped test for the
`federalTaxYears` ascending invariant; two fixture bands loosened
(failure_bounds probes one rounding step past the threshold,
calculator_expense band 0.5→0.1) — both traced to the 2026 record; the
`-2.1` render golden traces only via the fixture-input change; manifest
item 6 ran without `-count=1`.

Deliberately out of scope: a 2025 record; the OBBBA senior deduction.
