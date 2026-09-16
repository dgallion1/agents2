### RC2 acceptance criteria — month-precise schedule model, rollover shift, engine consumers

Names below are pinned because the oracle's mutation check greps for them.
Do not rename. Tier 3: oracle `.swarm/tier3/RC2/accept.sh` runs first.

1. **Models (internal/models).** `ExpenseSource` replaces `StartYear`/`EndYear`
   with `StartMonth int \`json:"start_month"\`` (0 = immediate) and
   `EndMonth *int \`json:"end_month"\`` (nil = perpetual) — the same shape as
   `IncomeSource`. `OneTimeExpense` replaces `Year` with `Month int
   \`json:"month"\``. `BigTicketItem` replaces `Year` with `Month int
   \`json:"month"\``. The year fields are REMOVED from the structs (no dual
   fields). Each of the three types gets an `UnmarshalJSON` that decodes the
   new keys and, ONLY when the new key is absent, derives it from the
   legacy key: `start_month` ← `start_year*12`; `end_month` ←
   `end_year*12` when `end_year > 0`, else nil; `month` ← `year*12`.
   Marshal emits only the new keys. Legacy-only, new-only and mixed
   documents all decode; a present new key always wins.
2. **Methods.** `ExpenseSource.GetAdjustedAmount` / `IsActive` use
   `StartMonth`/`EndMonth` (end exclusive, as income). Inflation for an
   inflating expense compounds from `StartMonth` exactly as today.
3. **Rollover shift (internal/services/retirement/settings_current_month.go).**
   Add `monthsBetween(from, to string) (int, bool)` (YYYY-MM, signed
   months, ok=false when either fails to parse) and
   `shiftScheduleOffsets(settings *models.WhatIfSettings, elapsed int)`.
   `resolveCurrentMonth` becomes: when `UseCurrentMonth`, compute
   `elapsed` from the settings' current `StartDate` to `now`; if ok, call
   `shiftScheduleOffsets(settings, elapsed)` — EXACTLY ONE call line
   containing the literal text `shiftScheduleOffsets(settings, elapsed)`;
   then set `StartDate = now` and `prepare.ComputeAges` as today. A shift
   of 0 is a no-op. Shift rules, applied to `IncomeSources`,
   `RemovedIncomeSources`, `ExpenseSources`, `RemovedExpenseSources`:
   `StartMonth = max(0, StartMonth-elapsed)`; non-nil `EndMonth =
   max(0, *EndMonth-elapsed)` (an ended entry stays, contributing 0). To
   `OneTimeExpenses`, `BigTicketItems`, `RemovedBigTicketItems`: `Month -=
   elapsed` with NO clamp — a past entry keeps a negative month, is
   retained, and is never charged. Fixed-date plans (`UseCurrentMonth`
   false) are never shifted. Because `saveInternal` runs the same
   function, the persisted `start_date` is the anchor and a load→save→load
   cycle never double-shifts.
4. **Engine (internal/services/retirement/engine).** `OneTimeExpensesForYear`
   becomes `OneTimeExpensesForMonth(s, month int) float64`: sum of entries
   with `e.Month == month`, each inflated by
   `compoundedFactorFromPercent(s.InflationRate, float64(month))`.
   `ApplyBigTicketItemsForYear` becomes `ApplyBigTicketItemsForMonth(s,
   month int, …same trailing params…)` selecting `item.Month == month`.
   The stepper calls BOTH every month (outside the `monthInYear == 0`
   block). Negative months never match because the loop never reaches
   them. Year-aligned entries (month = 12k) produce the SAME figures as
   before the change.
5. **Analysis / chain.** `chain.go`: `rebaseExpenseSources(sources,
   transitionMonth)` and `rebaseBigTicketItems(items, transitionMonth)`
   take months; big-ticket items with `Month-transitionMonth < 0` are
   dropped from the prepared copy exactly as years were, sort by `Month`.
   `present_value.go`: charge month = `e.Month`; skip when `< 0` or `>=
   months`. `budget_fit.go` notes derive the printed year as
   `month/12` (wording revisited in RC3). Every other consumer listed in
   SPEC §1 compiles against the new fields with unchanged semantics.
6. **Validation.** `prepare.ValidateOneTimeExpenses` keeps `Amount >= 0`
   and DROPS the non-negative-year rule (comment: a negative month is a
   past, dormant entry). No validator anywhere rejects a negative
   `Month`.
7. **Settings manager and handlers keep their year-based inputs (RC3
   changes the UI).** `UpdateExpenseSource(id, startYear, endYear, …)`
   keeps its signature and writes `StartMonth = startYear*12`, `EndMonth =
   endYear*12` (nil stays nil). `handlers_income_expense.go` constructs
   expense/one-time/big-ticket entries with `year*12`; its beyond-horizon
   checks are unchanged. Templates that printed the year fields now print
   `div .StartMonth 12`, `div .EndMonth 12` (guarded by `{{if .EndMonth}}`
   as the income list already does), `div .Month 12`, including the
   one-time card's horizon test `ge (div .Item.Month 12)
   .Settings.ProjectionYears`. No other markup change.
8. **Tests.** Existing tests and fixtures move to the month fields (edit,
   never delete). New tests in `internal/services/retirement` cover: the
   shift for all four entry kinds including Removed* slices, forward and
   backward, clamping at 0 for income/expense, negative retention for
   one-time/big-ticket, fixed-date no-op, and the manager load→save→load
   cycle producing identical offsets (temp dir, real clock, file
   `start_date` written as the current month). New engine tests cover
   one-time and big-ticket charges at a NON-year-aligned month (e.g. 11)
   and their absence at 10 and 12. A legacy-decode test covers all three
   types (legacy-only, new-only, mixed).
9. **Green.** `go build ./... && go vet ./... && go test -count=1 ./...`
   green; `make check` green; `testdata/settings/whatif.json` unchanged
   after the suite (`/usr/bin/git status --porcelain -- testdata` empty).
   No `data/` directory is ever created and the binary is never run.
10. **Oracle.** `.swarm/tier3/RC2/accept.sh <tree>` ends with `ORACLE
    PASS` (it plants its own tests in a copy and runs a mutation:
    `shiftScheduleOffsets(settings, elapsed)` → `shiftScheduleOffsets(settings,
    0)` must make the SHIPPED retirement suite fail with `--- FAIL`, not a
    build error).

### RC3 acceptance criteria — calendar-month forms and lists (drafted 2026-09-16; oracle written when RC2 lands)
