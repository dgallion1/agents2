# SPEC.md — "How much can I spend?": make the Current plan card applyable (CP run)

Run prefix: **CP**. Target repo: `/home/darrell/bin/ai/budget2`
(github.com/dgallion1/simpleBudget). Base commit **d6c554f** (master,
2026-09-13, PR #113). Implementation worktree `.worktrees/current-plan-apply`
on branch `feat/current-plan-apply`. This run's `.swarm/` lives in the agents2
worktree `.claude/worktrees/budget2-whatif-spend-rate-cfd18a` (gitignored).

## 0. Status — signed off by user 2026-09-14 ("Only when it qualifies"); CP1 accepted attempt 1; simpleBudget PR #114 MERGED bcb6226 + DEPLOYED :8080 2026-09-14 (health v1.4.0-1151-gbcb6226)

User asked (2026-09-14): "why is the lower spend rate not selectable?" then
"make the current plan card selectable too". The Current plan card in the
spending-optimizer results has no "Apply this option" button because
`spendingCandidateCanApply` excludes `Baseline`/`Kind=="current"`.

## 1. Facts (verified in code at d6c554f)

- Gate: `internal/handlers/whatif/handlers_spending_optimizer.go:346`
  `spendingCandidateCanApply` = `Qualifies && !Baseline && Kind != "current"
  && Guardrails != nil && Guardrails.Enabled`. Used twice: when minting
  apply tokens in `buildSpendingOptimizerView` (line 388) and re-checked in
  `handleApplySpendingOptimizerWithHook` (line 596). Both sites share it, so
  the template (`{{if $row.Token}}`) needs no gate change of its own.
- The current candidate (`analysis/spending_candidate.go:47-61`) is built
  with `Baseline: true`, `Kind: "current"`, `BaseMonthlyLivingExpenses =
  s.MonthlyLivingExpenses`, boost cloned, `Guardrails =
  guardrailOptimizerCloneConfig(s.Guardrails)` — which returns **nil** when
  the saved plan has no guardrail config. The apply handler dereferences
  `*c.Guardrails` unconditionally (line 610); today the gate's nil check
  prevents the panic.
- What Apply writes (lines 608-640): MonthlyLivingExpenses, boost,
  Guardrails (whole config), `SpendingSearch` (raw form prefs), and
  `AppliedSpendingEvidence` (candidate + request + seeds + hash; SP2), then
  `SaveWithRevisionIfScenario` and `HX-Redirect` to
  `/whatif?spending_applied=<rev>#spending-optimizer`.
  For the current candidate the first three are identical to the saved
  values; the user-visible effect of applying it is that the search
  preferences are remembered and the current plan's evidence chart persists
  across reloads exactly like an applied option.
- `spendingCandidateQualifies` (analysis/spending_optimizer.go:355) is
  applied to every candidate including current, so `Qualifies` is already
  meaningful on the current card (screenshot: 7.5% below-minimum ≤ 20%).
- Graph label (`handlers_spending_graph.go:48`) and option name template
  already handle `Kind=="current"` → "Current plan"; the persisted-evidence
  route therefore renders a current-plan chart with no change.
- Copy to change: results template line 87 "Failed and current-plan rows
  remain available for graph inspection only." The current row is never in
  the frontier tables (it is `view.Current`, not Planned/FlexibleRows), so
  the sentence becomes "Failed rows remain available for graph inspection
  only."
- Tests that encode the old rule: `spending_optimizer_test.go:324-331`
  (tokens iff `spendingCandidateCanApply` — self-consistent, but its fixture
  comment says baseline must not be authorized) and
  `spending_optimizer_render_test.go:231` ("every qualifying nonbaseline
  frontier row needs Apply").
- `spendingAppliedAnnouncement` (line 747) states the saved base living
  expenses and rules; it remains truthful for a current-plan apply.
- Repo gotchas: never run the binary from a worktree (data/ symlinks LIVE
  data); `cmd/server` tests may rewrite `testdata/settings/whatif.json`;
  rtk hook falsifies `git diff` — compare with sha256sum/python difflib.

## 2. Design (the one decision for sign-off)

**Recommended:** the Current plan card shows "Apply this option" under the
SAME qualification rule as every other card (button present iff the
current plan qualifies at the entered minimum/shortfall allowance). A
non-qualifying current plan stays inspect-only, consistent with the
frontier. The `Guardrails.Enabled` requirement is dropped for the current
kind only: a current plan measured with disabled or absent rules is applied
as-is (rules untouched). Button label and styling identical to the other
cards.

Alternative (not recommended): always show Apply on the current card
regardless of qualification. Rejected because the card text already
labels the qualification rule and an "apply" of a plan the page just said
fails the user's own minimum is a mixed message.

## 3. Task table

| Task | Tier | Checks | Owner | Acceptance criteria |
|---|---|---|---|---|
| CP1 — current-plan apply | 2 | tests, second, a11y | lead (lean exception; small, Tier 2) | see below |

Tier rationale (TIERS.md): strong oracle (Go tests + rendered template),
reversible (one commit), blast radius one handler + one template, but it
writes the saved plan (money-adjacent) → Tier 2 with `second`; markup
appears in a new place → `a11y`. No `critical.globs` path is touched.

### CP1 acceptance criteria
1. `spendingCandidateCanApply` returns true for a candidate with
   `Kind=="current"`/`Baseline` when `Qualifies` is true, regardless of
   `Guardrails` nil/disabled; other kinds keep the existing rule verbatim
   (Qualifies && Guardrails != nil && Enabled). Non-qualifying current
   candidate → false. One helper, both call sites unchanged.
2. Rendered results for a fixture whose current plan qualifies contain
   `data-spending-apply="<current id>"` inside the Current card; a fixture
   whose current plan does not qualify contains no such attribute for it.
3. Applying the current-plan token succeeds (HX-Redirect with the new
   revision) and the saved settings differ from the pre-apply settings ONLY
   in `SpendingSearch` and `AppliedSpendingEvidence`
   (`AppliedSpendingEvidence.Candidate.Kind == "current"`, hash fresh per
   `appliedSpendingEvidenceFresh`). MonthlyLivingExpenses, boost and
   Guardrails are byte-identical to before — asserted by JSON comparison of
   the settings with those two fields nil-ed.
4. Applying a current-plan candidate whose `Guardrails` is nil does not
   panic and leaves `Guardrails` nil after save.
5. Results copy no longer says current-plan rows are inspect-only; no
   other copy or layout change. Announcement after redirect unchanged.
6. Existing tests updated to the new rule (not deleted); `go build ./... &&
   go vet ./... && go test ./internal/handlers/whatif/...
   ./internal/services/retirement/analysis/...` green.
7. Accessibility: the new button instance meets ACCESSIBILITY.md exactly
   as the existing instances do (same markup); keyboard-reachable, visible
   focus, both themes — verified against the rendered template, not the diff.

## 4. Rulings
None — no FAIL this run. `gate.sh stats`: `first-attempt clean: 1/1
(no-evidence rows: 0)`. Catches: none (tests, second and a11y all PASS
first attempt; both required mutations killed by the shipped tests).

Lead-side lesson (deploy, not verification): a detached build worktree
placed OUTSIDE the repo (`~/bin/ai/budget2-release-…`) stamped
`vcs.revision` from `/home/darrell/bin`, which is itself a git repo — Go's
VCS stamping walks up past a linked worktree's `.git` FILE to the nearest
`.git` DIRECTORY. Build release binaries in `.worktrees/<name>` inside the
repo and check `go version -m` shows the merge commit before swapping.

Backlog observations from checkers (pre-existing, out of scope):
- Two visible buttons can share the accessible name "Apply this option"
  (already true across two headline cards on master).
- Dark-mode axe contrast hits on h5/strong/p in the results partial lacking
  `dark:text-*` (may be an artefact of the checker's wrapper shell — verify
  in the real page before acting).
- `json.Marshal` identity compares skip three `json:"-"` fields
  (CurrentAge, SpouseAge, BracketFillFeedback).
