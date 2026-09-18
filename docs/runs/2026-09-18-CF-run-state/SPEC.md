# SPEC.md — Spending option cards: base setting and starting budget on the card face (CF run)

Run prefix: **CF**. Target repo: `/home/darrell/bin/ai/budget2`
(github.com/dgallion1/simpleBudget). Base commit **7d0aec0** (master,
2026-09-16, PR #116). Implementation worktree `.worktrees/card-face` on
branch `feat/card-face-budget`. This run's `.swarm/` lives in the agents2
worktree `.claude/worktrees/plan-selection-issue-2adac7` (gitignored).

## 0. Status — CF1 ACCEPTED at attempt 2 (gate `OK: CF1 accepted at tier 2 (attempt 2)`; `gate.sh done`: `OK: all tasks accepted, evidence verified, no unresolved flags`; `gate.sh stats`: `first-attempt clean: 0/1 (no-evidence rows: 0)`); simpleBudget branch `feat/card-face-budget`, one commit over 7d0aec0, PR #117 MERGED 0b85199 + DEPLOYED :8080 2026-09-18 (health v1.4.0-1163-g0b85199)

## 1. Problem (2026-09-18)

User asked why the "Current plan" card ($8,701.30/month median funded
living) could not be related to the plan on the left (Monthly Living
Expenses slider $7,639). The saved plan is base $7,639.34 + a $2,000/mo
early-spending boost to 2030-01 (starting budget $9,639.34, the Cash Flow
table's "Living Expenses" line), with phases and guardrails; the card's
headline is a simulated median, not an input. The only place the card
states the base and starting budget is the sentence
`StartingBudgetEvidence` inside the collapsed "Supporting details"
expander, and only when the two differ.

## 2. Facts (verified in code at 7d0aec0)

- Card block `whatif-spending-option` in
  `web/templates/components/whatif/spending_optimizer_results.html`
  (line 26). `<h5>` name (line 29), headline `<p>` with
  `NearTermMonthlyReal` (line 31), comparison (32), cut/timing/minimum
  evidence (33-35), `Unavailable` branch (36-39), buttons (40-43),
  `<details>` "Supporting details" (44-55) which renders
  `{{if $row.StartingBudgetEvidence}}<p>…</p>{{end}}` at line 50.
- The current card and the two headline cards render through this ONE
  block (lines 82-83). Frontier rows (block `whatif-spending-frontier`)
  show only `BaseMonthlyLivingExpenses` and are not cards.
- `populateSpendingRowPlanEvidence`
  (`internal/handlers/whatif/handlers_spending_optimizer.go:524`) sets
  `StartingBudgetEvidence` ONLY when `StartingMonthlyLivingReal` and
  `BaseMonthlyLivingExpenses` differ at cent precision, wording "The
  starting monthly living budget is %s; the base living-expense setting
  is %s because scheduled phases or an active early-spending boost
  apply." Both figures go through `budgettemplates.FormatMoney` — the one
  money formatter (`internal/templates/render.go:478`); the template's
  `formatMoney` is the same function.
- Every candidate kind carries both fields: current from the saved
  settings (`spending_candidate.go:47-63`), searched candidates from the
  start/factor derivation (`spending_candidate.go:66-115`).
- No test asserts the old sentence text. Tests that must keep passing:
  `spending_keep_current_label_test.go` (button count 5, label texts,
  exactly one "Keep current plan"), `spending_optimizer_render_test.go`,
  `spending_current_apply_test.go`.
- The slider's visible label is "Monthly Living Expenses"
  (`portfolio-settings.html:54`).
- **Foreign in-flight work:** `.worktrees/apply-names` (branch
  `feat/apply-button-names`, uncommitted, bcb6226) adds sr-only text to
  the Apply buttons in the same template — lines 42 and 69 only. Not this
  run's territory; no overlap with the lines this run edits.

## 3. Design (user-decided: card face)

Every option card (current + headline recommendations) shows, directly
under its `<h5>` name and before the headline figure, one line built in Go
by `populateSpendingRowPlanEvidence` and rendered unconditionally:

- when the two figures differ (cents):
  `Monthly Living Expenses setting $7,639.34/mo · starting living budget $9,639.34/mo (scheduled phases or an early-spending boost apply at the start).`
- when they are the same:
  `Monthly Living Expenses setting $8,000.00/mo · starting living budget $8,000.00/mo (the same at the start).`

The line replaces the details-expander sentence (line 50 is removed), so
each figure appears once per card. "Monthly Living Expenses" is the
slider's own label so the reader can find the input. Both figures use
`FormatMoney` (one formatter, one rounding path); the differ/same
decision is the existing cent comparison in Go — the template makes no
arithmetic or comparison. Styling: `mt-1 text-gray-600
dark:text-gray-300` (the card's existing secondary-text classes; contrast
already audited). No JS, no button, no attribute changes.

## 4. Task table

| Task | Tier | Checks | Owner | Acceptance criteria |
|------|------|--------|-------|---------------------|
| CF1 | 2 | tests,a11y,second | lead (lean exception) | (a) Rendered results for a fixture with current (base 7639.34, start 9639.34) + planned (8500/8500) + flexible (9000/9500): each of the 3 `<article>` cards contains its budget line BEFORE its `<details>`; the current card's line is exactly the "differ" sentence above; the planned card's line is exactly the "same" sentence; the frontier tables contain no budget line; "Monthly Living Expenses setting" occurs exactly 3 times in the body; the "Supporting details" blocks contain neither "starting monthly living budget" nor "Monthly Living Expenses setting". (b) `go build ./... && go vet ./...` clean; `go test ./internal/handlers/whatif/` green; the new test FAILS when the template line is moved back into details (mutation check). (c) Template diff vs 7d0aec0 confined to block `whatif-spending-option` (one line added under `<h5>`, line 50 removed); Go diff confined to `populateSpendingRowPlanEvidence` and its comment; no JS, attribute, form, or class change to buttons. (d) checker-a11y: the line is plain text in reading order under the card heading; secondary-text classes identical to sibling secondary text; no new interactive element; heading structure unchanged. (e) checker-second: the two figures on the face equal `FormatMoney` of the candidate's fields (no second formatter, no rounding drift vs the frontier's base figure for the same candidate); a fractional-cent fixture (base 7639.342517) renders `$7,639.34` on the face AND in its frontier row; the differ/same branch is decided in Go at cent precision. |

Money shown on screen → defect-history surface → `second` named.

## 5. Rulings

- **2026-09-18a — CF1 attempt 1, checker-second FAIL, CONCEDED (mechanism: second checker).** The new "same" branch in `populateSpendingRowPlanEvidence` decided equality with `math.Round(v*100)` per field (half-away) while the two displayed strings came from `FormatMoney` (`%.2f`, exact-binary), so `base=7639.035, start=7639.04` rendered "$7,639.03/mo · … $7,639.04/mo (the same at the start)". Dual-rounding class (W2). Fix for attempt 2: derive the differ/same decision from the two rendered strings themselves (one rounding path), and add the boundary fixture to the shipped test. Observation (pre-existing, out of scope): the mirror case in the old "differ" sentence and the `$%.2f` in `spendingAppliedAnnouncement`.
