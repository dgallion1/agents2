# SPEC.md — budget2 what-if: make the monthly expense total legible

Run prefix: **EX** (expense clarity). Target repo: `/home/darrell/bin/ai/budget2`,
worktree `/home/darrell/bin/ai/budget2/.claude/worktrees/expense-clarity`,
branch `feat/expense-breakdown-clarity` (cut from master `75862ec`). All
manifest paths and globs in this run are budget2-repo-relative. The
previous run's spec (CC, per-person care costs) is preserved in git history.

## 1. Motivation

The user asked (2026-09-03): "The monthly living expenses and the full
expenses as in 10.7K now confuse me. Are we sure the health ins isn't part
of the 7,792?" It is not — the plan total is three separately-entered
figures added together:

| Piece | Monthly | Source in the plan |
|---|---|---|
| Living expenses (Go-Go multiplier 1.0 at age 67) | 7,792.85 | `monthly_living_expenses` (set by Sync from Dashboard, which EXCLUDES "Health Insurance"-category rows — `internal/handlers/whatif/sync.go:202`) |
| Christine, ACA premium | 1,655.30 | `healthcare_persons[1].current_monthly_cost` |
| Darrell, Medicare | 600.00 | `healthcare_persons[0].current_monthly_cost` |
| Property tax | 666.00 | `monthly_property_tax` |
| **Total** | **10,714.15** | `BudgetFit.MonthlyExpenses` |

The arithmetic is right; the page hides it. Three findings (lead, verified
in the browser 2026-09-03):

1. The Living / Healthcare / Property Tax breakdown exists only in "Monthly
   Budget Analysis" on the **Cash Flow tab**. The page opens on Overview,
   which shows the verdict strip and chart but never itemizes the total.
2. The "Monthly Living Expenses" slider helper text reads only "In today's
   dollars. Inflation is applied during projection." It never says
   healthcare and property tax are added on top from the fields below.
3. The Healthcare row is one lump (2,255.30). Nothing says it is two
   people's premiums from the Healthcare card rather than ledger spending.

(The Sync preview already says premiums are excluded —
`sync-preview.html:28` — but that text is visible only during a sync.)

## 2. Design

Two independent tasks. Neither changes any computed figure; both are
presentation. Every dollar shown goes through an existing formatter
(`formatMoney` for cents in the panel, `formatDollars` for whole dollars
beside the slider); no new formatting code, no JS arithmetic over
rendered strings.

### 2a. EX1 — per-person Healthcare sub-rows (`internal/services/retirement/analysis/budget_fit.go`)

In `calculateBudgetFit` (the `healthcareCost > 0` branch, ~line 133), when
`len(s.HealthcarePersons) > 0`, populate the Healthcare row's `SubItems`
with one entry per person, in `HealthcarePersons` order:

- `Name`: `<person.Name> (<coverage label>)`, where the coverage label is
  the person's coverage at month 0 (`CoverageAt(0, s.StartDate)`) rendered
  as `Medicare` / `ACA` / `Employer` (title-case for display). If
  `models.CoverageType` already has a display-label helper, use it; if
  not, add ONE method `func (c CoverageType) Label() string` in
  `internal/models/healthcare.go` and use it here — never a second
  mapping. An empty `person.Name` renders as `Person N` (1-based).
- `Amount`: the person's month-0 contribution, exactly the two terms
  `GetTotalHealthcareCost` sums: `GetMonthlyCostAt(0, s.StartDate) +
  CareCostAt(0, s.StartDate)`. A person whose month-0 cost is 0 (employer
  covered, coverage not started) still gets a row at 0 — provenance is the
  point.
- **Rendered-string identity (ruling 2026-08-29b, same construction as the
  Living Expenses sub-rows directly above):** every sub-row amount is
  derived via `centsFromDecimalString`, and the LAST sub-row absorbs the
  integer-cent residual against `centsFromDecimalString(healthcareCost)`,
  so the rendered sub-rows sum to the rendered Healthcare row by
  construction. The Healthcare row's own `Amount` stays `healthcareCost`
  (unchanged rendering). Fractional cents are real here: the MCP
  `healthcare_monthly_cost` override distributes a total proportionally
  across persons.
- `SignedAmount` stays false (these are components, not adjustments).
- Legacy single-scalar healthcare (no persons) and the `$0 / employer
  covered` branch: unchanged, no sub-rows.

The existing template (`budget-analysis.html`, the `{{range .SubItems}}`
block) renders these with no template change. Consumers of
`ExpenseBreakdown` other than that template: the checker enumerates
(`grep -rn ExpenseBreakdown`, including the MCP plan view and any JSON
surface) and confirms none breaks on a populated `SubItems` under
Healthcare.

### 2b. EX2 — slider note + Overview expense card (templates + one JS hook)

**(i) Slider helper text** — `web/templates/components/whatif/portfolio-settings.html:78`.
Replace the paragraph text with, verbatim:

> In today's dollars; inflation is applied during projection. Excludes
> healthcare premiums and property tax — those are entered below and added
> on top. Plan total today: {{formatDollars .Analysis.BudgetFit.MonthlyExpenses}}/mo.

Rules: keep the existing `<p>` element, classes, and position (the phase
note paragraph stays directly after it). The final sentence renders ONLY
when `.Analysis` and `.Analysis.BudgetFit` are present — the template is
also rendered in tests and partials without them
(`living_expenses_phase_note_test.go`, `monthly_living_expenses_rounding_test.go`
render `whatif-portfolio-settings` with a bare map). The figure is
server-rendered and refreshes with the card's existing oob swap
(`pages/whatif.html:240`); it is NOT updated live during slider drag — do
not add JS arithmetic for it. `formatDollars` is deliberate: it matches the
slider's own display span beside it; the panel keeps cents.

**(ii) One partial for the expense rows.** Extract the Expenses section of
`budget-analysis.html` — the "EXPENSES" header row through the end of the
`{{range .Analysis.BudgetFit.ExpenseBreakdown}}` block (sub-rows
included) — into `{{define "whatif-expense-rows"}}` in the same file, and
have `whatif-budget-analysis` include it where the markup was. Byte-for-
byte identical output for the Cash Flow panel is the acceptance test
(render before/after with the existing fixtures and diff).

**(iii) Overview card.** New `{{define "whatif-expense-summary"}}` in a
new file `web/templates/components/whatif/expense-summary.html`, included
in `pages/whatif.html` in the Overview panel between the projection chart
and the failure-points card:

- Card chrome identical to the budget-analysis card
  (`bg-white dark:bg-gray-800 rounded-lg shadow p-4`).
- `<h2>` "Monthly Expenses Today" (same heading classes as the panel's).
- One `<p class="text-xs …">` under it, verbatim: "Living expenses come
  from the slider; healthcare from the Healthcare card; property tax from
  its field. Income, taxes, and the monthly gap are under Cash Flow."
- `{{template "whatif-expense-rows" .}}`.
- A footer link `<a href="#" data-wf-goto="cashflow" class="text-xs …">`
  with text "Full cash flow →". It must be a real link/button with a
  visible focus ring and ≥24×24 px target, not a bare span.
- Guard: render the card only when `.Analysis.BudgetFit` is present and
  `len .Analysis.BudgetFit.ExpenseBreakdown > 0`; otherwise render nothing
  (no empty card).

**(iv) JS hook** — `web/static/js/whatif-tabs.js`, inside the existing
container click listener in `wire()`: after the `[data-wf-tab]` branch,
add a `[data-wf-goto]` branch that `preventDefault()`s and calls
`activateTab(value, true)`. Do NOT reuse `data-wf-tab` on the link — the
tab code toggles `aria-selected`/`wf-tab-active` on every `[data-wf-tab]`
and the link is not a `role="tab"`. No inline `onclick`.

**Tests (Go, `internal/templates/`):** (1) the Cash Flow panel render is
byte-identical before/after the extraction for the existing sub-item
fixtures; (2) the Overview card renders the same row strings as the panel
for one fixture with Living/Healthcare(+2 sub-rows)/Property Tax, and
renders nothing for an empty breakdown; (3) the slider note contains
"Plan total today: $10,714/mo." for `MonthlyExpenses: 10714.15` and omits
the sentence when `Analysis` is absent.

### 2c. Accessibility (budget2 `ACCESSIBILITY.md` governs; agents2's is the dashboard's)

New text uses the sibling helper-text token pair already on the card
(`text-gray-500 dark:text-gray-400` on `dark:bg-gray-800` passed the CC2
audit; on `dark:bg-gray-700` it did NOT — CC-2026-08-31c — so match the
element's actual background). Heading order on Overview stays h2 under the
page h1. The link is keyboard-operable and announced as a link.

## 3. Out of scope (this run)

- Making the slider's plan-total figure live during drag.
- Reconciling the slider's whole-dollar display (`$7,793`) with the
  panel's cents (`$7,792.85`) — pre-existing, both from one float.
- Moving the whole Monthly Budget Analysis card to Overview.
- Any change to `sync.go`, the sync preview, or the dashboard.
- The `check #996570` question (possible property-tax double count) —
  a data question for the user, not a code change.

## 4. Worker constraints (paste into every dispatch)

- Work ONLY in `/home/darrell/bin/ai/budget2/.claude/worktrees/expense-clarity`
  (branch `feat/expense-breakdown-clarity`). Do not touch
  `/home/darrell/bin/ai/budget2` itself. Workers commit nothing — the lead
  commits.
- **Never run the built budget2 binary directly** — it kills the live
  :8080 instance. `go build ./...` and `go test ./...` only. If you need a
  browser check, use `scripts/whatif-verify.sh start 8099` from the
  worktree (isolated data copy) and `stop` when done. Never :8080.
- One formatter per value, one rounding path per figure, no JS arithmetic
  over rendered strings, no new formatting helpers.
- Write your manifest to
  `/home/darrell/work/agents2/.claude/worktrees/expenses-health-insurance-clarify-0e9d34/.swarm/manifests/<task>.<attempt>.files`
  (budget2-repo-relative paths, one per line).

## 5. Task breakdown

| ID  | Task | Tier | Checks | Acceptance criteria |
|-----|------|------|--------|---------------------|
| EX1 | Per-person Healthcare sub-rows in `budget_fit.go` (+ `CoverageType.Label()` if absent) + tests | 2 | tests,second | (a) `go build ./...` and `go test ./...` pass. (b) New test in `internal/services/retirement/analysis/`: two persons (Medicare 600, ACA 1655.30) → Healthcare row 2255.30 with two sub-rows named `<name> (Medicare)` / `<name> (ACA)` at those amounts, in person order. (c) Fractional-cent fixture whose naive rendered sum differs from the rendered total — 600.006 and 1655.306 (renders 600.01 + 1655.31 vs total 2255.31; NOT 600.005/1655.305, whose residual is zero — ruling EX-2026-09-03a): rendered sub-row strings (formatMoney) sum exactly to the rendered Healthcare row string, and the last row shows the absorbed cent. (d) A person with month-0 cost 0 still gets a row at 0; legacy scalar healthcare gets no sub-rows; the `$0 / employer covered` branch is unchanged. (e) Care cost at month 0 (CareStartAge ≤ current age) is included in that person's sub-row — fixture must put the care person in a NON-last position, since the last row is re-derived from the total (ruling EX-2026-09-03a). (f) Exactly one coverage-label mapping exists (checker greps for a second). (g) Checker enumerates every consumer of `ExpenseBreakdown`/`SubItems` and confirms none regresses. |
| EX2 | Slider note, `whatif-expense-rows` partial, Overview "Monthly Expenses Today" card, `data-wf-goto` hook, template tests | 2 | a11y,second | (a) `go build ./...` and `go test ./...` pass; the three tests in §2b exist and pass. (b) Cash Flow panel render byte-identical before/after extraction (checker diffs). (c) Overview card shows the same row strings as the panel for the same fixture; hidden when breakdown empty. (d) Slider note text verbatim per §2b(i), figure via `formatDollars`, sentence absent without `.Analysis`. (e) "Full cash flow →" activates the Cash Flow tab by keyboard and mouse on the :8099 verify instance; no inline handlers; no `data-wf-tab` on the link. (f) Contrast of every new text node ≥4.5:1 in light and dark on its actual background (real axe/contrast run, not eyeballed). (g) No new formatting call sites (checker greps the diff for `printf "%.`/`toLocaleString`/`Math.round`). |

| EX3 | Follow-up (backlog F2 from EX-2026-09-03a): the healthcare person card's coverage timeline labels its first segment with a template-local `{{if eq .CurrentCoverage "employer"}}Employer{{else}}ACA{{end}}` — a second coverage→label mapping that labels COBRA (and any future type) "ACA". Replace with `{{.CurrentCoverage.Label}}`; add a render test. Lead-direct. | 2 | a11y,second | (a) `go build ./...`, `go test -count=1 ./...`, `make check` pass. (b) Exactly one coverage→display-label mapping remains in Go and templates (`<option>` lists are input choices, not labels — allowed; the colour classes on lines 16–17 are styling, out of scope). (c) Render test: ACA→"ACA $1,234", Employer→"Employer $1,234", COBRA→"COBRA $1,234" and never "ACA"; Medicare renders no pre-Medicare timeline. (d) Rendered timeline for ACA and Employer persons is byte-identical to master (only COBRA's output changes). (e) No contrast/structure change (same element, text-only). |

Independent — dispatch in parallel. EX2's Overview card renders EX1's
sub-rows automatically once both merge; neither needs the other to pass.
EX3 was added after EX1/EX2 merged (simpleBudget PR #91) and ships on
its own branch `fix/coverage-label-single-source`.

Tier rationale (TIERS.md): both reversible pre-merge and oracle-strong;
blast radius is user-visible dollars on the plan's main page → Tier 2.
Money on screen and rendered-string arithmetic (EX1 sub-row identity,
EX2 duplicated rows across two surfaces) → `second` on both. Primary
verifier: `tests` for the Go change, `a11y` for the markup change.

## 6. Lean-experiment bookkeeping

Record every catch in §7 with the mechanism that caught it (primary
checker / second / judge / gate). At run end: `swarm/gate.sh stats` and
report the first-attempt clean rate to the user verbatim.

## 7. Rulings

- **EX-2026-09-03a** (catch — mechanism: PRIMARY CHECKER checker-tests,
  EX1 attempt 1, FAIL CONCEDED; checker-second PASSed the same attempt):
  the implementation was correct on every criterion, but two of the
  worker's tests were vacuous under mutation. (c) used the spec's own
  example pair 600.005/1655.305, whose residual is zero, so deleting the
  residual-absorption branch left the whole suite green — a spec-level
  defect (the lead wrote the fixture). (e) used a single person, who is
  by construction the last row and therefore re-derived from the total,
  so dropping `CareCostAt` from the per-person sum still passed; the
  checker's two-person probe showed $3,000 of care billed to the wrong
  person. Fix applied lead-direct (attempt 2, worker=lead): discriminating
  pair 600.006/1655.306 with per-row assertions, and a two-person care
  fixture with care on the first person. Both checkers re-run.
  Backlog from the same verdict: (F1) EX2 must run `make css` —
  `tailwind.css is stale` fails `make check` on the EX2 templates;
  (F2, pre-existing on master) `healthcare-person.html:260` labels any
  non-employer coverage "ACA", a second coverage→label mapping that
  `CoverageType.Label()` should replace.
- **EX-2026-09-03b** (catch — mechanism: PRIMARY CHECKER checker-a11y,
  EX2 attempt 1, FAIL CONCEDED; first surfaced as an observation by
  checker-tests on EX1 attempt 1; checker-second PASSed EX2 attempt 1
  without noticing): the worker never ran `make css`, so the committed
  `web/static/css/tailwind.css` lacked the three new utility classes
  (`min-h-[24px]`, `min-w-[24px]`, `-mx-2`) that give the "Full cash
  flow →" link its 24×24 px target — the safeguard was dead code as
  shipped, and `make check` (css-verify) fails on the diff. The link
  cleared 24 px only by coincidence of line-height and padding. Fix
  applied lead-direct (attempt 2, worker=lead): `make css`,
  `tailwind.css` added to the EX2 manifest. Both checkers re-run.
  Process note: the spec's worker constraints did not mention `make css`
  or `make check`; a build-artifact check belongs in the worker
  constraints for any task that adds Tailwind classes.
- **EX-2026-09-03c** (EX3, lead-direct, first attempt clean — both lanes
  PASS, gate OK): the F2 follow-up. Correction to the F2 premise: the
  inline branch sat inside a block already guarded by
  `ne .CurrentCoverage "medicare"`, so a Medicare person was never
  labelled "ACA"; the real victim was COBRA (and any future type), which
  is unreachable from the UI's `<option>` list but valid JSON. One
  finding from checker-second, backlog: with `CurrentCoverage == ""`
  (legacy JSON) `Label()`'s default branch returns `""`, so the timeline
  segment renders `" $1,234"` where master rendered `"ACA $1,234"`;
  unreachable through any live handler (AddPerson defaults the field,
  the migration sets ACA/Medicare, updates never blank it). If it is
  ever reachable, `Label()` should map `""` to "ACA" — that is the
  engine's own default coverage.
