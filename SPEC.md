# SPEC.md — budget2 "Retirement Smile": per-person late-life care costs

Run prefix: **CC** (care cost). Target repo: `/home/darrell/bin/ai/budget2`
(all manifest paths and globs in this run are budget2-repo-relative).
Previous run's spec (Swarm Mission Control dashboard) is preserved in git
history on master; its `.swarm` is archived as `.swarm-archive-dash`.

## 1. Motivation

The what-if projection models the falling half of the retirement spending
curve (Go-Go → No-Go phase multipliers on living + discretionary expenses)
and healthcare *premium* inflation, but not the late-life **utilization
jump** — assisted living / home care, typically $6–9k/mo in today's dollars,
starting in the mid-80s. A flat 65% No-Go multiplier with no care event makes
the projection optimistic in exactly the years portfolio depletion matters
most. Research basis: Blanchett's "retirement smile" — total real spending is
U-shaped, with the late rise driven by care, not premiums.

Design decision (user-approved 2026-08-31): model care as a **per-person
healthcare cost**, not a spending phase and not an ExpenseSource. Care is
per-person (one spouse in assisted living while the other lives at home),
must NOT be scaled down by spending-phase multipliers, and should inflate at
healthcare rates, not CPI.

## 2. Architecture

### 2a. Model (`internal/models/healthcare.go`)

`HealthcarePerson` gains two optional fields:

```go
CareStartAge    int     `json:"care_start_age,omitempty"`    // 0 = care not modeled
CareMonthlyCost float64 `json:"care_monthly_cost,omitempty"` // today's dollars
```

New method `CareCostAt(month int, startDate string) float64`:

- Returns 0 when `CareStartAge == 0` or `CareMonthlyCost <= 0`.
- Care starts at the projection month the person reaches `CareStartAge`,
  computed with the same month-precision rules as Medicare eligibility:
  BirthMonth+startDate → month-precise (mirror `monthsUntilMedicareEligible`,
  generalized to an arbitrary age); otherwise the year-based fallback
  `(CareStartAge − CurrentAge) * 12`, clamped at 0.
- From care start onward:
  `CareMonthlyCost * (1 + PostMedicareInflation/100) ^ (month/12)`.
  Inflation compounds from **month 0** (the amount is entered in today's
  dollars), using the person's `PostMedicareInflation` — no new inflation
  knob. This is the ONE formula; no other file may re-derive it.
- Care runs to the end of the projection. No duration, no mortality — the
  engine does not model mortality, and running to the horizon is the
  conservative choice. Say so in the docs task (CC3), not silently.

### 2b. Engine integration (`internal/models/whatif.go`)

`GetTotalHealthcareCost(month)` adds `CareCostAt(month, startDate)` for each
`HealthcarePerson`, in the multi-person branch only. The legacy single-person
branch (`MonthlyHealthcare`) is unchanged — care requires `HealthcarePersons`.

Everything downstream inherits automatically **and must be verified, not
assumed** — this is a split-classification surface. Known consumers of
`GetTotalHealthcareCost` (enumerated 2026-08-31; the checker re-enumerates):

1. `engine/expense.go` `TotalExpenses` + `CalculateExpenseBreakdown`
   (care lands in *essential*; never scaled by the phase multiplier).
2. `engine/stepper.go:310` — `GetTotalHealthcareCost(m) * p.HealthcareMultiplier`
   (Monte Carlo variation multiplies care too; accepted).
3. `engine/expense.go` `TotalExpenses`/`CalculateExpenseBreakdown` is the
   second dollar-accumulation path, consumed independently of the stepper by
   `analysis/budget_fit.go` and `analysis/monte_carlo.go`. **Both paths must
   include care identically** — this pair is the defect risk in this task.
   (Corrected 2026-08-31: the spec originally named `loop_helpers.go:85`,
   whose only healthcare logic is `MedicareEligibleAdultCountAtMonth` — an
   IRMAA head-count, not dollars. See Rulings CC-2026-08-31a.)
4. `analysis/budget_fit.go:132` and `metrics/metrics.go:48` — both call
   `GetTotalHealthcareCost(0)` as the *current premium budget*. With
   `CareStartAge` in the 80s and a younger current age, month 0 is
   unaffected. Known consequence, accepted: if a user sets
   `CareStartAge <= current age`, active care correctly counts as current
   healthcare spending on the dashboard target.
5. `whatif` results / spending-trajectory rows (`HealthcareExpense`,
   Spend column) — care must appear in the trajectory table.
6. MCP `get_balance_projection` / `run_scenario` — flow through the same
   engine; verify a scenario with care shows higher expenses / earlier
   depletion. Explicit per-field scenario *overrides* for care are OUT OF
   SCOPE (configure via saved settings).
7. `engine/healthcare.go` `HealthcarePV` → `analysis/present_value.go`
   `PVExpenses` → orchestrator `fastAnalysis` (the Total-Needs /
   coverage-ratio panel). **Computes per-person healthcare directly, not via
   `GetTotalHealthcareCost`** — must add care via `CareCostAt` (no formula
   re-derivation). Missed by the original enumeration; found by
   checker-second (Rulings CC-2026-08-31b). Fix contract (attempt 2):
   `HealthcarePV` keeps its `(person, discountRate, totalMonths)` signature
   and adds the discounted care stream using `person.CareCostAt(m, "")` —
   year-fallback start precision is accepted for this estimate panel and
   must be stated in CC3's docs, not left silent. Discounting follows the
   file's existing convention.
8. `analysis/sensitivity.go` "Higher Healthcare" scenario — scales
   `CurrentMonthlyCost`/`MedicareMonthlyCost`/`ACACostAfterEmployer` by 1.5×;
   must scale `CareMonthlyCost` identically or the stress test silently
   excludes care (checker-second observation, promoted into CC1 scope).

Persistence: the two fields ride the existing `WhatIfSettings` JSON
round-trip (save → load → identical values). Verify, don't assume.

IRMAA: care is an expense, not a premium — it must NOT enter any IRMAA or
premium-tax-credit logic. `CoverageAt` is untouched.

### 2c. UI (`web/templates/components/whatif/`)

In the healthcare card, one "Late-life care" row per healthcare person:

- Number input for start age (blank/0 = off; sensible min 60, max 100) and a
  dollar input for monthly cost in today's dollars, wired through the
  existing healthcare settings hx-post path (extend the handler to parse the
  new fields).
- A short helper line: "Assisted living / home care, in today's dollars.
  Inflates at this person's post-Medicare healthcare rate and runs to the
  end of the projection."
- All displayed dollar values go through the existing single formatting path
  (`formatDollars` server-side / `formatWholeDollars` client-side as the
  card already uses) — no new formatter (dual-formatter defect class, W2).
- Spending-phases card blurb gains one sentence: healthcare and late-life
  care are modeled separately and are not reduced by these multipliers.
- Quick Adjust panel: OUT OF SCOPE this run.

### 2d. Docs / assumptions honesty

- `whatif://assumptions` MCP resource: replace whatever it currently implies
  about late-life costs with the true state: late-life care is modeled only
  when configured per person; mortality is still not modeled; care runs to
  the projection horizon.
- Same statement wherever the app's help/docs describe spending phases.

## 3. Out of scope (this run)

- Quick Adjust sliders for care; MCP `run_scenario` per-field care
  overrides; care duration / mortality modeling; survivor spending
  adjustment; essentials-floor-from-ledger; smooth phase interpolation;
  trajectory sparkline. Candidates for later runs.

## 4. Worker constraints (paste into every dispatch)

- Repo: `/home/darrell/bin/ai/budget2`, branch `feat/care-cost` (lead
  creates it before dispatch; workers commit nothing — the lead commits).
- **Never run the built budget2 binary** — any invocation, even
  `--help`, starts a server and kills the live :8080 instance. `go test`
  and `go build` only. Browser verification happens against the demo
  instance on :8081 (`run-demo.sh`) if needed, never :8080.
- Today's-dollars inputs, one formula per figure, one formatter per value.
- Write your manifest to
  `<agents2 worktree>/.swarm/manifests/<task>.<attempt>.files`
  (budget2-repo-relative paths, one per line).

## 5. Task breakdown

| ID  | Task | Tier | Checks | Acceptance criteria |
|-----|------|------|--------|---------------------|
| CC1 | Model + engine: `CareStartAge`/`CareMonthlyCost` on `HealthcarePerson`, `CareCostAt`, `GetTotalHealthcareCost` integration, tests | 2 | tests,second | (a) `go build ./...` and `go test ./...` pass. (b) New unit tests: zero-config returns 0; year-fallback start month; BirthMonth month-precise start; inflation formula exact at care start and +N years; legacy single-person branch unchanged. (c) A projection-level test proves care raises `TotalExpenses` after care age and not before, is absent from discretionary in `CalculateExpenseBreakdown`, and is NOT scaled by an enabled `SpendingPhaseConfig`. (d) A test proves stepper and loop_helpers paths agree on healthcare including care for the same month (the §2b.3 pair). (e) Settings JSON round-trip preserves both fields. (f) Checker enumerates §2b consumers and confirms each sees care or is knowingly month-0-exempt. |
| CC2 | UI: per-person care inputs in healthcare card + handler parsing + phases-card blurb sentence | 2 | a11y,second | (a) Inputs render per healthcare person, labeled, keyboard-operable, pass ACCESSIBILITY.md checks on the changed card. (b) Posting the form persists values (visible after reload); blank/0 disables care. (c) Dollar displays use the existing formatter path only — checker greps for any new formatting call sites. (d) Phases blurb sentence present exactly once. (e) Trajectory table (Show → rows) reflects care in years ≥ care age when configured on the demo instance (:8081). |
| CC3 | Assumptions honesty: `whatif://assumptions` resource + any help text | 1 | content | (a) Resource text states: care modeled only when configured, per person, to horizon; mortality not modeled. (b) No remaining text claims spending only declines with age. (c) Wording matches §2d substance (checker verifies against this spec section). |

Dependency: CC2 and CC3 depend on CC1's fields existing; CC1 dispatches
first, CC2/CC3 in parallel after CC1 is accepted.

Tier rationale (TIERS.md): all tasks reversible pre-merge and oracle-strong;
CC1/CC2 blast radius is shared (every projection consumer / user-visible
dollars) → Tier 2. Money on screen → `second` on both (defect-history
surfaces: dual formatters, split classification, rendered figures). CC3 is
small, reversible, strong oracle → Tier 1.

## 6. Lean-experiment bookkeeping

Record every catch in §7 with the mechanism that caught it (primary checker /
second / judge / gate). At run end: `swarm/gate.sh stats` and report the
first-attempt clean rate to the user verbatim.

## 7. Rulings

- **CC-2026-08-31a** (catch — mechanism: WORKER report, CC1 attempt 1): the
  spec's §2b.3 named `engine/loop_helpers.go:85` as the second healthcare
  dollar-accumulation path. It is not — its only healthcare logic is
  `MedicareEligibleAdultCountAtMonth` (IRMAA head-count). The real pair is
  `stepper.go` vs `expense.go` (consumed by `analysis/budget_fit.go` and
  `analysis/monte_carlo.go`). Spec corrected; the worker had already written
  the agreement test against the correct pair. A brief-level error — exactly
  the class no model strength in verification would have fixed; caught
  before any checker ran.
- **CC-2026-08-31b** (catch — mechanism: SECOND CHECKER, CC1 attempt 1,
  FAIL CONCEDED): `engine/healthcare.go` `HealthcarePV` (→ `PVExpenses` →
  Total-Needs/coverage-ratio panel) computes per-person healthcare dollars
  without `GetTotalHealthcareCost`, so a $5,000/mo active care cost left
  `PVExpenses` bit-identical while month-by-month expenses billed it — a
  split-classification defect AND a second spec-enumeration miss (§2b
  originally listed six consumers; this was the seventh). Lead conceded
  without a panel. Escalation: gate flagged CC1 → Tier 3 (critical-glob);
  attempt 2 runs under the full Tier-3 oracle contract. Secondary
  observation promoted into scope: `sensitivity.go` "Higher Healthcare"
  must scale `CareMonthlyCost` 1.5× like its sibling fields. The
  checker's throwaway PV probe is promoted to a permanent regression test
  (V3 pattern).
