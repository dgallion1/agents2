# SPEC.md — Current plan card: relabel Apply to "Keep current plan" (KC run)

Run prefix: **KC**. Target repo: `/home/darrell/bin/ai/budget2`
(github.com/dgallion1/simpleBudget). Base commit **bcb6226** (master,
2026-09-14, PR #114 = CP1). Implementation worktree
`.worktrees/keep-current-plan` on branch `feat/keep-current-plan`. This
run's `.swarm/` lives in the agents2 worktree
`.claude/worktrees/budget2-spending-plan-apply-0c8642` (gitignored).

## 0. Status — user decision 2026-09-16: "relabel it to 'Keep current plan' and deploy"; KC1 accepted attempt 1 (tests+a11y PASS); simpleBudget PR #115 MERGED d1aca01 + DEPLOYED :8080 2026-09-16 (health v1.4.0-1153-gd1aca01)

## 1. Problem (diagnosed 2026-09-16, see agents2 memory `budget2-spending-apply-current-card`)

User report: "when I hit apply it clears the view, but doesn't apply the
values." Root cause is not a defect in the Apply mechanism. CP1 gave the
**Current plan** card — rendered FIRST, above the two recommendations — an
"Apply this option" button identical to the recommendations'. Applying it
re-saves the same base/boost/rules (only `SpendingSearch` and
`AppliedSpendingEvidence` change), redirects to
`/whatif?spending_applied=N#spending-optimizer`, and the results panel is
gone on reload. Evidence: live journal shows two optimize→apply cycles
(11:09, 11:10), both saved+redirected; live `whatif.json` has
`applied_spending_evidence.candidate.id = "current"` and the base stayed at
the non-step value 7639.34 (searched candidates are $100 steps).
Reproduced on a throwaway :8082 copy: applying "Follow planned spending"
changed the base to 8100 on disk and on the page; applying the Current
plan card then reproduced the reported symptom exactly.

## 2. Facts (verified in code at bcb6226)

- Button site: `web/templates/components/whatif/spending_optimizer_results.html`
  block `whatif-spending-option` (line 42) renders the card's submit button
  with visible text `Apply this option` for every row including the
  current card (`.Current` is rendered through the same block, line 82).
  Frontier rows (block `whatif-spending-frontier`, line 69) render `Apply`;
  the current candidate is never a frontier row.
- Name template `whatif-spending-option-name` (line 24) already
  distinguishes `Kind=="current"` → "Current plan".
- No test on master asserts the visible label text. Existing assertions
  count `data-spending-apply="current"` (spending_current_apply_test.go:147,
  spending_optimizer_render_test.go:236) and must keep passing — the
  attribute and form are unchanged.
- The JS (`web/static/js/whatif-spending-optimizer.js:567`) intercepts by
  `[data-spending-apply-form]`, not by label. No JS change.
- Post-apply banner `spendingAppliedAnnouncement` remains truthful for a
  current-plan keep (it states the saved figures). Out of scope.
- **Foreign in-flight work:** `.worktrees/apply-names` (another session,
  branch `feat/apply-button-names`, "CP2", uncommitted) appends sr-only
  text to each Apply button and its new test asserts every card's visible
  label is "Apply this option". That test will need `Keep current plan`
  for the current card if it lands after this run. Declared to the
  checkers verbatim; not this run's territory.

## 3. Design (user-decided)

Current plan card button visible text: `Apply this option` →
`Keep current plan`. Same `<form>`, same hidden inputs, same
`data-spending-apply="current"`, same classes, same submit type. The label
is a visible text node (WCAG 2.5.3 Label in Name; no `aria-label`
override). Recommendation cards keep "Apply this option"; frontier rows
keep "Apply". No copy elsewhere changes.

## 4. Task table

| Task | Tier | Checks | Owner | Acceptance criteria |
|------|------|--------|-------|---------------------|
| KC1 | 2 | tests,a11y | lead (lean exception) | (a) Rendered results for a fixture with a qualifying current card + 2 recommendations: current card's submit button text is exactly `Keep current plan`; recommendation cards `Apply this option`; frontier rows `Apply`; exactly one occurrence of `Keep current plan` in the body. (b) Template diff vs bcb6226 is confined to the label text in block `whatif-spending-option` (a conditional on `.Candidate.Kind`); no attribute, form, class or JS change. (c) `go build ./... && go vet ./...` clean; `go test ./internal/handlers/whatif/` green; the new test FAILS when the label change is reverted (mutation check). (d) checker-a11y: button has a visible text label that is its accessible name; focus ring and target size unchanged from the sibling buttons; no `aria-label` that omits the visible text. |

Not a defect-history surface (no money formatting, thresholds or rendered
arithmetic) → no `second` lane.

## 5. Rulings

No disputes. Checker observations recorded in README.md (recommendation-card name collision pre-existing and owned by `feat/apply-button-names`; brittle attribute-order guard in the new test; post-keep banner wording).
