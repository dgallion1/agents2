# SPEC.md — Month rollover keeps scheduled cash flows; Apply keeps the comparison minimum (RC run)

Run prefix: **RC**. Target repo: `/home/darrell/bin/ai/budget2`
(github.com/dgallion1/simpleBudget). Base commit **bcb6226** (master,
2026-09-14, PR #114). Implementation worktree `.worktrees/rollover-schedule`
on branch `fix/rollover-schedule` (created at dispatch, INSIDE the repo per
the CP lesson). This run's `.swarm/` lives in the agents2 worktree
`.claude/worktrees/budget2-rollover-comparison-issues-19c20a` (gitignored).

## 0. Status — signed off by user 2026-09-16 ("A"); RC1 ACCEPTED ec42346 (attempt 1); RC2 ACCEPTED ee7af8a (attempt 2, gate `OK: RC2 accepted at tier 3 (attempt 2)`); RC3 ACCEPTED 5d4c10f (attempt 3 under the rewritten contract, user-authorized after the Tier-3 hard stop; gate `OK: RC3 accepted at tier 3 (attempt 3)`); `gate.sh done`: `OK: all tasks accepted, evidence verified, no unresolved flags`; `gate.sh stats`: `first-attempt clean: 1/3 (no-evidence rows: 0)`; simpleBudget PR #116 MERGED 7d0aec0 + DEPLOYED :8080 2026-09-16

Source: the user's review of the 2026-09-09..16 changes reported two
issues. Both are CONFIRMED in code at bcb6226 (section 1). P2 has one
obvious fix. P1 has a design fork (section 2) that needs the user's call.

Foreign territory notice: `/home/darrell/bin/ai/budget2/.worktrees/apply-names`
(branch `feat/apply-button-names`) and three detached `.claude/worktrees/*`
exist in the target repo. This run never touches HEAD, branches, stash or
index of the main checkout; it builds only in its own worktree.

## 1. Facts (verified in code at bcb6226)

### P2 — Applying the current plan loses the comparison minimum (CONFIRMED)
- The optimizer form's "Minimum comfortable monthly living budget"
  (`web/templates/components/whatif/spending_optimizer.html:19`, field
  `floor_monthly_real`) is prefilled from `spendingOptimizerFormData`
  (`handlers_spending_optimizer.go:704-708`): **only** from
  `s.Guardrails.MinMonthlySpendingReal` when > 0, else blank.
- Apply (`handleApplySpendingOptimizerWithHook`, lines 626-638) writes
  `s.Guardrails = clone(c.Guardrails)` and `s.SpendingSearch` = the raw form
  prefs (`MaxShortfallPct, NearTermYears, SearchMin/Max/Step`). The
  minimum itself is NOT in `models.SpendingSearchPreferences`
  (`models/spending_optimizer.go:34-40`).
- Searched candidates carry `Guardrails.MinMonthlySpendingReal = floor`
  (`analysis/spending_optimizer.go:113,395`), so for them the minimum
  round-trips by accident. The current candidate is built with
  `Guardrails = guardrailOptimizerCloneConfig(s.Guardrails)`
  (`analysis/spending_candidate.go:58`) — the ORIGINAL policy — so after
  CP1's current-plan Apply the form reloads the old policy floor ($5,000
  in the review's example, live plan: 6000) or blank when the plan has no
  guardrails. The user's entered $7,000 is lost, although
  `AppliedSpendingEvidence.Request.FloorMonthlyReal` still holds it (that
  field goes stale on any other settings change, so it is not a
  restore source).
- Other readers of the guardrail floor are unaffected by the fix below:
  `engine/spending_floor.go:20`, `handlers_rates.go:486-497` (guardrails
  form), `handlers_guardrail_optimizer.go` (its own form, own floor).

### P1 — Month rollover shifts scheduled cash flows (CONFIRMED, latent on the live plan)
- `resolveCurrentMonth` (`settings_current_month.go:10-15`) sets
  `StartDate = now` and recomputes ages. It runs on every load
  (`settings.go:419`, `cloneForCurrentMonth` at 561-634) and on every save
  (`saveInternal`, line 986). Nothing else in the file changes, so every
  schedule offset silently re-anchors to the new month. The persisted
  `start_date` is the month the offsets were last saved against, but
  `saveInternal` overwrites it without shifting the offsets, so even that
  implicit anchor is lost at the first save in a new month.
- Every schedule in the plan is an offset "from now", and the UI shows
  them as calendar years, so the drift is user-visible:

  | Field | Unit | Form input | List display |
  |---|---|---|---|
  | `IncomeSource.StartMonth/EndMonth` | months (form ×12) | `start_year`/`end_year` ints | "Starts age N (yr K)"; timeline "Pension starts" at yr |
  | `ExpenseSource.StartYear/EndYear` | years | `start_year`/`end_year` | "Starts yr / Ends yr" |
  | `OneTimeExpense.Year` | years | `year` | "Year N (2027)" — calendar year derived from StartDate |
  | `BigTicketItem.Year` | years | `year` | "Year N" / "(yr N)" |
  | `RothConversionConfig.StartYear/EndYear` | years | `start_year`/`end_year` (+ MCP overrides) | sweep table |
  | `HealthcarePerson.EmployerCoverageYears`, `TaxDeferredDelayYears`, legacy `HealthcareStartYears` | years | various | — |

  Social Security is NOT affected: `claimStartMonth(currentAge, claimAge)`
  (`social_security.go:122,168`) re-derives the start month from the
  person's age each run.
- Engine/analysis consumers of the affected offsets (all read projection
  months/years relative to StartDate): `models/income_source.go:29-50`,
  `engine/expense.go:54-67` (`OneTimeExpensesForYear`, fired from
  `stepper.go:269` once per projection year), `engine/month.go:270`,
  `chain.go:106-150` (rebase on scenario transition — the existing
  "shift offsets" pattern), `analysis/present_value.go:75-124`,
  `analysis/budget_fit.go:200-225`, `analysis/spending_funding.go:128-141`,
  `analysis/tax_optimizer_strategies.go:178-181`, `handlers.go:712`
  (timeline events), `handlers_spending_graph.go:235-240`, `sync.go:332`.
- Live plan today (`data/settings/whatif.json`, read-only look): one
  income at start 0, no expense sources, no one-time or big-ticket
  items, Roth `start_year 0 / end_year 5`, boost stop `2030-01`
  (absolute, unaffected). So the only figure drifting on the live plan
  right now is the Roth window's end (it stays "5 years from whatever
  month it is"); the income/expense defect is real but latent.
- Existing tests: `settings_month_rollover_test.go`,
  `settings_current_month_test.go` cover ages only — no test asserts a
  scheduled offset across a rollover.

Repo gotchas (unchanged): never run the binary from a worktree (data/
symlinks LIVE data; any invocation starts a server and kills :8080);
`cmd/server` tests may rewrite `testdata/settings/whatif.json`; rtk hook
falsifies `git diff` — compare with sha256sum / python difflib.

## 2. Design

### P2 (no fork) — persist the comparison minimum with the search prefs
Add `FloorMonthlyReal float64 \`json:"floor_monthly_real,omitempty"\`` to
`models.SpendingSearchPreferences`; Apply writes the raw form's
`p.form.FloorMonthlyReal` into it alongside the other prefs; the form
prefills from `s.SpendingSearch.FloorMonthlyReal` when > 0, else falls back
to `s.Guardrails.MinMonthlySpendingReal` (legacy files and plans whose
guardrails form set a floor before ever running the optimizer), else
blank. `MinimumAboveCurrent` uses the same resolved value. Guardrails are
untouched (the policy floor stays what the applied candidate carried).

### P1 — the fork (user decision)

The root cause is structural: schedules are stored as offsets from a
StartDate that now moves monthly, and all but income are year-granular,
so a one-month rollover cannot even be expressed for them.

**Option A — month-precise schedules (recommended; the full fix).**
1. `ExpenseSource`, `OneTimeExpense`, `BigTicketItem` gain month-granular
   offsets (`start_month`/`end_month`, `month`) with JSON back-compat: when
   the month field is absent on decode, derive it from the year field
   (`×12`); the year fields become derived/read-only for display.
   `IncomeSource` already stores months.
2. `resolveCurrentMonth` shifts every month-granular offset by the months
   elapsed between the settings' StartDate and `now` (income start/end,
   expense start/end, one-time month, big-ticket month), clamping starts
   at 0 and dropping nothing (an entry whose end has passed simply
   contributes zero, exactly as chain.go's rebase treats it — decide:
   keep entries, never delete user data). Because `saveInternal` calls
   the same function, the persisted StartDate remains the anchor and the
   shift is lossless across saves.
3. Engine/analysis consumers read the month fields (`OneTimeExpensesForYear`
   becomes a per-month charge at the exact month; chain.go rebases in
   months).
4. UI: the income/expense/one-time/big-ticket forms take a calendar month
   (`<input type="month">`, min = plan start) and the lists show the
   calendar month ("starts Sep 2027"); handlers convert to offsets against
   the current StartDate. This is REQUIRED, not cosmetic: with month
   offsets, the current "start_year" edit form would truncate 11 months
   to 0 and silently move the date on an untouched re-save.
5. Roth window, employer-coverage years, tax-deferred delay stay
   year-granular and are OUT of scope (backlog note: an anniversary
   rebase against a persisted `schedule_anchor` would bound their drift
   to <12 months; today it is unbounded).
Cost: two Tier-3 tasks (engine + models; then UI/handlers) plus the P2
task. Touches `critical.globs` (engine/**).

**Option B — anniversary rebase (cheap, bounded drift).** Persist a
`schedule_anchor` (YYYY-MM). At every resolve, shift ALL offsets — income
in months, the rest in years — by the whole years elapsed since the
anchor, and advance the anchor by that many years. No engine or UI
change; one Tier-3 task at the settings boundary. Result: a schedule
entered for Sep 2027 reads Oct 2027 … Aug 2028 during the eleven months
after the first rollover, then snaps back to Sep 2027 on the anniversary.
Strictly better than today (drift no longer accumulates) but the
review's exact complaint — "becomes October 2027" — is only fixed on
anniversaries. Rejected as the primary fix because the timeline and the
one-time card print calendar dates, and a wrong date on screen is the
class of defect this project treats as a lie.

## 3. Task table (Option A; RC3/RC4 collapse to one task under Option B)

| Task | Tier | Checks | Owner | Summary |
|---|---|---|---|---|
| RC1 — comparison minimum persisted (P2) | 2 | tests, second | lead (lean exception: small, well-specified) | section 2 P2 |
| RC2 — month-precise schedule model + rollover shift + engine consumers (P1 core) | 3 | tests, second (oracle first) | worker-coder | section 2 A.1-3, A.5 |
| RC3 — calendar-month forms and lists (P1 UI) | 3 | tests, second, a11y (oracle first) | worker-coder | section 2 A.4 |

Tier rationale: RC1 writes the saved plan and controls a money figure the
form shows back → Tier 2 + `second` (CP1 precedent). RC2 changes
persisted user data on load and touches `engine/**` (critical.globs) →
Tier 3. RC3 changes what the user sees for every scheduled date and how
the handlers write offsets → shared/large blast radius on money dates;
round up to Tier 3.

### RC1 acceptance criteria
1. `SpendingSearchPreferences` has `FloorMonthlyReal` (json
   `floor_monthly_real`, omitempty). Apply persists `p.form.FloorMonthlyReal`
   there for EVERY candidate kind, including current.
2. `spendingOptimizerFormData` resolves the prefilled minimum as:
   `SpendingSearch.FloorMonthlyReal` if > 0, else
   `Guardrails.MinMonthlySpendingReal` if > 0, else absent (nil → blank
   input, `MinimumAboveCurrent` absent). One resolution path feeds both
   `FloorMonthlyReal` and `MinimumAboveCurrent`.
3. Handler test (extend `spending_current_apply_test.go`): plan with
   guardrails floor 5000, run with `floor_monthly_real=7000`, apply the
   current-plan token; the rendered form input value is `7000.00`;
   `Guardrails.MinMonthlySpendingReal` is still 5000. Second case: plan
   with NO guardrails, same flow → `7000.00`, `Guardrails` still nil.
   Third: applying a searched candidate at 7000 → `7000.00` (unchanged
   behaviour).
4. Legacy case: settings with `spending_search` lacking the key and
   guardrails floor 6000 → input `6000.00`. Settings with neither → blank.
5. Rendered-string check: the value is formatted by the existing
   `printf "%.2f"` path only; no second formatter.
6. `go build ./... && go vet ./... && go test ./internal/handlers/whatif/...
   ./internal/models/...` green; each of the three new assertions in (3)
   fails when the Apply write in (1) is reverted (mutation check by
   checker).

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
   checks are unchanged. **Display (amended 2026-09-16 after the worker
   proved `div` returns float64 and `ge` rejects float-vs-int):** add to
   `internal/models` the pair `CalendarMonth(startDate string, offset int)
   string` → `"2006-01"` and `CalendarMonthLabel(startDate string, offset
   int) string` → `"Jan 2006"` (an unparseable startDate returns ""),
   register both as template funcs `calendarMonth` / `calendarMonthLabel`,
   and add the int-returning func `yearOf` (`month/12`, Go integer
   division). Every DISPLAY of a scheduled date on the one-time card,
   big-ticket card and lists prints the calendar label
   (`{{calendarMonthLabel .Settings.StartDate .Item.Month}}` → "Sep
   2027") instead of any year figure; the one-time horizon test becomes
   `ge (yearOf .Item.Month) .Settings.ProjectionYears`. The INLINE EDIT
   inputs (`expense-sources-list.html` start/end, and the existing income
   ones) keep `value="{{div .StartMonth 12}}"` for this task: a
   non-year-aligned offset renders a float that `parseFormInt` rejects
   with 400 on re-save, which is the safe interim (loud, never a silent
   date move); RC3 replaces those inputs. `budget_fit.go` notes use
   `models.CalendarMonthLabel(s.StartDate, month)`: "starts Sep 2027" /
   "ends Sep 2028" (end = first month without it, as stored). No other
   markup change.
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
11. **Linked scenarios re-anchor (added attempt 2, ruling 2026-09-16c,
    revised).** Scenario files loaded via `LoadScenarioSettings` come back
    re-anchored to the current month through the shared decode path (no
    new code; the resolve already lives in `normalizeLoadedWhatIfSettings`).
    A fixed-date scenario file is untouched; load never writes. Shipped test: a
    linked scenario file saved with start_date three months ago and a
    one-time at month 12 loads with month 9 and start_date = this month.
10. **Oracle.** `.swarm/tier3/RC2/accept.sh <tree>` (now also plants
    `rc2_oracle_templates_test.go`: GET /whatif and the every-mutation OOB
    partial must render completely with non-aligned entries) ends with `ORACLE
    PASS` (it plants its own tests in a copy and runs a mutation:
    `shiftScheduleOffsets(settings, elapsed)` → `shiftScheduleOffsets(settings,
    0)` must make the SHIPPED retirement suite fail with `--- FAIL`, not a
    build error).

### RC3 acceptance criteria — calendar-month forms and lists (drafted 2026-09-16; oracle written when RC2 lands)

One rule above all: a calendar month shown or accepted anywhere is produced
by the ONE function pair RC2 introduced in `internal/models` —
`CalendarMonth` (`"2006-01"`: form values, `min` attributes) and
`CalendarMonthLabel` (`"Jan 2006"`: display), template funcs
`calendarMonth` / `calendarMonthLabel`, also used by analysis notes. No
second formatter (dual-formatter class, W2); RC3 must not add one.

1. **Inputs.** The income add + inline edit forms, the expense add + inline
   edit forms, the one-time form and the big-ticket form replace their
   year inputs with `<input type="month">`: `start_month` / `end_month`
   (income, expense; `end_month` blank = perpetual, labelled "Through" =
   LAST month included, stored as `EndMonth = offset+1`), `month`
   (one-time, big-ticket). `min` = `CalendarMonth(StartDate, 0)`. Labels
   and help text updated; `aria-describedby` wiring kept; both themes.
2. **Parsing.** One helper (`parseMonthOffset(r, field, startDate)`)
   converts `YYYY-MM` to an offset via `monthsBetween`; a month before the
   plan start → 400 "must be <plan start label> or later" (add AND edit);
   an end month before the start month → 400; unparseable → 400. The
   settings-manager update functions take month offsets (signature change
   from years to months; every caller updated).
3. **Display.** Income row: "Starts <Mon YYYY> (age N)" (already-claiming
   copy unchanged); expense row: "Starts <Mon YYYY>" / "Through <Mon
   YYYY>" or "ongoing". **Clamped entries (amended 2026-09-16, ruling e):**
   the rollover clamps a past start to 0 and a past end to 0, losing the
   original months, so the row must not invent them. `StartMonth == 0`
   reads "Since plan start (<plan start label>)" (true whether the entry
   was scheduled for the plan start or earlier) and its start input
   carries the plan-start month. `EndMonth == 0` (ended — only the clamp
   can produce it, the form never stores an end ≤ start) renders a
   DISPLAY-ONLY row: "Ended before the plan start (<plan start label>)"
   plus the Remove control, with NO schedule/amount inputs and no htmx
   form, so nothing can be re-saved for it; one-time card: "<Mon YYYY>" replacing "Year N
   (YYYY)", horizon test `Month >= ProjectionYears*12`, a negative month
   renders "<Mon YYYY> (past)"; big-ticket list and restore list likewise;
   `budget_fit.go` notes "starts <Mon YYYY>" / "through <Mon YYYY>"
   derived through the same function.
4. **Round trip is exact.** Rendering the inline edit form for an income
   or expense entry at `StartMonth 11` (plan start `2026-10`) yields
   `value="2027-09"`; submitting that form unchanged leaves `StartMonth ==
   11` (and `EndMonth` unchanged, nil or not). One-time and big-ticket
   entries have NO edit form (add/delete only — amended 2026-09-16, ruling
   d): their round trip is the ADD path: posting `month=2027-09` stores
   `Month 11` and the card renders "Sep 2027". Handler tests for all four.
   **Amended (ruling e):** for EVERY income/expense row that still has a
   form — including a clamped-start row (StartMonth 0, EndMonth > 0) —
   posting the form's own rendered values unchanged (plus any unrelated
   toggle) returns 200 and leaves StartMonth/EndMonth exactly as stored;
   never a 400 for a date the user did not touch. Ended rows have no form.
5. **Rollover on the UI path.** A plan file with `start_date` three months
   ago and `start_month 12` renders the row as the calendar month twelve
   months after THAT date (nine months after today), proving the shift
   and the display agree.
6. **Tests.** Handler tests for 1-5; template render tests that the year
   words ("yr", "Year N") no longer appear for these entries; existing
   tests edited, not deleted. `go test -count=1 ./...` and `make check`
   green; `testdata` untouched.
7. **Accessibility.** `checker-a11y` audits the rendered What-If page in
   both themes with the forms open: every month input has a programmatic
   label, visible focus, ≥ 4.5:1 text contrast, error messages associated
   with the field (ACCESSIBILITY.md points as numbered there).
   **Amended (ruling f):** each of the four add forms' error containers
   (`#whatif-add-income-error`, `-expense-`, `-onetime-`, `-bigticket-`)
   is a live region (`role="alert"` on the container the handler retargets
   into, so an htmx swap of the message is announced — WCAG 4.1.3), and
   every new month input's `aria-describedby` lists that container's id in
   addition to its help text. Inline edit rows keep the existing
   `renderError` path (pre-existing, unchanged by RC3).
8. **Oracle** `.swarm/tier3/RC3/accept.sh` (handler-level: real
   `httptest` requests against the real handlers and templates, asserting
   on the response bodies) ends with `ORACLE PASS`.

### RC3 attempt 3 — contract rewrite (user authorized "1" on 2026-09-16 after the hard stop)

Root cause across both failed attempts: the rollover-clamped state
(StartMonth 0 and/or EndMonth 0) is a distinct state of a schedule entry,
and its meaning was decided in one place at a time (a template helper)
instead of once for every surface. Names are PINNED (the oracle greps).

1. **One status source in the model.** `IncomeSource` and `ExpenseSource`
   each gain the methods `ScheduleEnded() bool` (EndMonth != nil &&
   *EndMonth <= 0 — only the rollover clamp produces it) and
   `SinceStart() bool` (StartMonth == 0). The template func
   `scheduleEnded` is REMOVED; templates call `.ScheduleEnded` /
   `.SinceStart` on the source. Outside `internal/models` (and tests), no
   Go or template code may compare `EndMonth` to 0 or `StartMonth` to 0
   for display: the oracle greps for `scheduleEnded`, `eq .StartMonth 0`,
   `StartMonth == 0`, `EndMonth <= 0` and `EndMonth == 0` in
   `web/templates`, `internal/handlers`, `internal/services`,
   `internal/templates` non-test files and requires no hit.
2. **Every surface, one rule** (built through the real 20-month rollover:
   an ended expense, an ended income, a clamped-start running income):
   - source-list rows, page and OOB partial — as attempt 2 (ended =
     display-only, "Since plan start (<label>)" for a clamped start);
   - **Budget Fit** (`analysis/budget_fit.go`): an ended EXPENSE is
     OMITTED from the expense breakdown (it contributes 0; the list already
     explains it); ended incomes are already omitted (amount 0) and a
     clamped-start income already carries no "starts" note — keep both
     facts pinned by tests. No breakdown note may ever name a month before
     the plan start;
   - **timeline events** (`handlers.go` "Pension starts" / "Social Security
     starts"): a `SinceStart()` source produces NO event (it is already
     running; year 0 "starts" was a lie for a clamped entry and noise for
     a scheduled-at-start one);
   - **spending-funding markers** (`analysis/spending_funding.go`
     `spendingFundingConfiguredMarkers`): a `SinceStart()` source produces
     NO "starts" marker (today `StartMonth < 0` is skipped; make it
     `SinceStart()`), ended sources none (already);
   - **removed/restore lists**: a restored ended entry renders as ended.
3. **Tests.** Shipped tests for each surface above with the clamped
   fixture (both income and expense branches — attempt 2 tested only the
   expense list branch), asserting on rendered output / returned markers.
4. **Oracle** `.swarm/tier3/RC3/accept.sh` extended: the clamped test also
   asserts the page shows no "(through <plan start − 1>)" note, no
   "OldLease (through", and no "Pension starts" event for the clamped-start
   pension; plus the display-comparison grep in (1). Validated at both ends
   (a57394c must fail on the Budget Fit note).
5. Everything accepted in attempts 1-2 (month inputs, parsing, labels,
   role="alert" errors, Roth untouched) is unchanged and re-verified by
   all three lanes.

## 4. Rulings
- **2026-09-16a (RC2 attempt 1, caught by the WORKER's pre-implementation
  read, before any code):** the lead's brief pinned `ge (div .Item.Month
  12) .Settings.ProjectionYears`; `div` returns float64 and text/template's
  `ge` errors on float-vs-int, so the pinned expression aborts the
  template, and `{{div .Item.Month 12}}` would print "Year 0.9166…" for
  exactly the non-aligned months RC2 creates. Ruling: criterion 7 amended
  (calendar-month labels + int `yearOf`; inline edit inputs keep the
  loud-failing float until RC3). Attribution: worker (brief defect); not a
  code defect. Attempt count unchanged (no code was produced).
- **2026-09-16b (RC2 attempt 1, caught by checker-second — CONCEDED, no
  panel; checker-tests found the same defect independently):**
  `whatif-bigticket-item` was changed to take `(dict "Settings" … "Item" …)`
  but the second caller in `web/templates/pages/whatif.html:341-343`
  (inside `whatif-results-with-oob`, rendered on EVERY what-if mutation)
  still passed the raw item, so any mutation on a plan holding a big-ticket
  item returned 200 with "Internal Server Error" swapped into
  #bigticket-list and the #onetime-list OOB block dropped. Survived
  build/vet/suite/oracle: no shipped test rendered the OOB partial with a
  big-ticket item and the oracle rendered no templates. Ruling: lead's
  oracle gap; oracle extended with a template lane
  (`rc2_oracle_templates_test.go`, both ends re-validated); task back to
  the worker as attempt 2 with the defect class named (enumerate EVERY
  caller of a template whose contract changes). Fixed in ee7af8a.
- **2026-09-16c (RC2 attempt 1, checker-tests observation promoted to
  scope, then REFUTED by the worker with evidence):** the observation said
  `LoadScenarioSettings` never calls `resolveCurrentMonth`, so linked chain
  scenarios would stay in their file's frame. The worker showed
  `LoadScenarioSettings` → `decodeSettings` → `normalizeLoadedWhatIfSettings`
  → `resolveCurrentMonth` (settings.go:419) and a probe on f479de3 loading a
  three-month-old scenario already shifted (12→9). No code change;
  criterion 11 satisfied by shipped seam tests
  (`settings_scenario_current_month_test.go`) that fail when the resolve is
  removed. Attribution: checker observation refuted by the worker
  (judges-verify-the-premise pattern, 2026-08-29d).
- **2026-09-16d (RC3 attempt 1, caught by the WORKER's pre-implementation
  read, before any code):** two lead oracle defects — the page-wide ban on
  `start_year`/`end_year` caught the out-of-scope Roth card, and the
  `value="2027-09"` ≥ 4 count assumed inline edit forms for one-time and
  big-ticket entries, which do not exist (add/delete only; no update
  route). Ruling: oracle narrowed (Roth inputs allowed exactly once each;
  count ≥ 2; add-form ids banned by name), criterion 4 amended, both ends
  re-validated. Attribution: worker (lead oracle defect); attempt count
  unchanged. Also in scope per criterion 3: the projected-SS row's
  "(yr N)" becomes the calendar label.
- **2026-09-16e (RC3 attempt 1, caught by checker-second — CONCEDED, no
  panel):** a rollover-clamped, already-ended expense (StartMonth 0,
  EndMonth 0) rendered "Starts Sep 2026 · Through Aug 2026", its Through
  input sat below its own `min`, and re-posting the form's own values (as
  htmx does on any unrelated toggle) returned 400 "Through month must be
  Sep 2026 or later" — the untouched row could not be saved at all
  (criteria 3 and 4). The lead's oracle never constructed a post-clamp
  fixture although the dispatch brief named the angle. Ruling: criteria 3
  and 4 amended (ended rows display-only and honest about the lost month;
  clamped start reads "Since plan start"), oracle extended with the
  post-clamp fixture (both ends re-validated), task back to the worker as
  attempt 2.
- **2026-09-16f (RC3 attempt 1, caught by checker-a11y — CONCEDED):** the
  add forms' 400 messages are swapped by `renderRetargetedError` into a
  plain `<div>` (no `role="alert"`/`aria-live`) that none of the ten new
  month inputs reference via `aria-describedby` (WCAG 4.1.3; criterion 7
  "error messages associated with the field"). The container/JS mechanism
  is byte-identical to master, but criterion 7 named the requirement for
  this task's new inputs. Ruling: criterion 7 amended (container becomes a
  live region; inputs reference it); folded into attempt 2. axe: zero
  violations in RC3 markup (all hits pre-existing in spending-phases.html
  and the big-ticket restore/purge buttons); contrast 8.2–12.1:1, focus
  ring 5.2–7.6:1, all label/describedby pairs correct.
- **2026-09-16g (RC3 attempt 2, caught by the WORKER against the extended
  oracle, before returning):** the post-clamp oracle test banned the
  substring `/whatif/expense/exp-ended"` to prove the ended row has no
  update form, but the required Remove button's `hx-delete` shares that
  URL — the clause forbade what criterion 3 requires. Ruling: clause
  narrowed to `hx-put="/whatif/expense/exp-ended"`; both ends re-validated.
  Attribution: worker (lead oracle defect); attempt count unchanged.
- **2026-09-16h (RC3 attempt 2, caught by checker-second — CONCEDED;
  HARD STOP):** the source-list rows were fixed for the clamped/ended
  state, but `analysis/budget_fit.go` (RC3 attempt-1 code, untouched in
  attempt 2) still emits `scheduleNote("through", StartDate, *EndMonth-1)`
  unconditionally, so the Budget Fit card shows "PageLease (through Aug
  2026)" — an invented month — for the same entry the list calls "Ended
  before the plan start". Split-classification class (ruling 2026-08-29a):
  the ended-state rule lived in a template helper (`scheduleEnded`) and
  was not enumerated across the other surface that renders the entry's
  schedule. Both RC3 failures are the same class (clamped state not
  enumerated across surfaces), so per CLAUDE.md this is a lead/spec
  defect: the lead's oracle checked the list card for the post-clamp
  fixture but never the Budget Fit card. Second failed attempt at Tier 3 →
  task HALTED; contract to be rewritten before any third attempt (one
  model-level schedule-status source consumed by every surface; oracle
  asserts every surface for the clamped fixture).
- **2026-09-16i (user decision):** after the Tier-3 hard stop the user
  chose option 1 — attempt 3 under the rewritten contract above (model-level
  status methods; every surface asserted for the clamped fixture). The
  reopen is scoped to that contract; checkers report beyond-scope findings
  as observations (ruling 2026-08-29c/d precedent).

RC1 attempt 1: checker-tests PASS, checker-second PASS, gate `OK: RC1
accepted at tier 2 (attempt 1)`. RC2 attempt 2: both lanes PASS, gate
`OK: RC2 accepted at tier 3 (attempt 2)`.

## 5. Backlog observations (checker-reported, not FAIL)
- RC3.3/checker-tests+second: `handlers_spending_graph.go:235`
  `addProjectedSSFundingMarkers` still gates on `entry.StartMonth < 0` and
  marks an already-claiming PROJECTED SS entry at month 0 (claim-age
  derived, not a clamped IncomeSource — outside the contract; same
  cosmetic class).
- RC3.3/both lanes: the timeline `SinceStart()` skip in handlers.go is
  redundant with the pre-existing `year <= 0` floor (dead code, not a
  defect); only the combined mutation is killed.
- RC3.3/worker: the Budget Fit INCOME "starts" note branch is unreachable
  (sources with StartMonth > 0 have amount 0 at month 0 and are omitted).
- RC3.3/worker: four analysis files remain gofmt-dirty on the branch
  (pre-existing; `make check` does not run gofmt).
- RC3.2/checker-tests: `rc3_oracle_test.go:301` bans two ids no template
  renders (`expense-end-month-exp-ended`, `expense-start-month-exp-ended`);
  only the `hx-put=` clause grades. Fix if the tier3 dir is reused.
- RC3.2/checker-tests: income and expense have twin `scheduleEnded`
  branches but only the expense branch has a shipped test (V3 promote).
- RC3.2/checker-tests: further pre-existing dual formatters of a scheduled
  month: `handlers/whatif/verdict.go:94,102`,
  `handlers_spending_optimizer.go:746-750`; `guardrails.html:122` "Year N"
  is the guardrail ladder, not a schedule surface.
- RC3.2/worker: the OOB clearing divs drop `class="mb-2"/"mb-3"`, so the
  add-form error slots lose their margin after the first mutation of a
  session (cosmetic, on master).
- RC3/checker-second: `analysis/spending_funding.go` has its own local
  `calendarMonthLabel` returning raw ISO "2006-01", rendered by
  `web/static/js/whatif-spending-optimizer.js` in the "Calendar month"
  column — a second formatter of the same StartMonth figure (pre-existing,
  SP2-era; dual-formatter class W2).
- RC2/checker-tests: `settings.go:~2247` (scenario RENAME) decodes with a
  bare `json.Unmarshal`, bypassing `normalizeLoadedWhatIfSettings`, and
  rewrites the file — harmless today (start_date preserved, per-type
  UnmarshalJSON still converts legacy keys) but a decode surface every
  future decode-contract task must enumerate.
- RC2/checker-second: a linked chain scenario saved with
  `use_current_month:false` under a current-month primary is rebased in
  its own (stale) frame at the transition — pre-existing chain-composition
  property (`prepared.StartDate = primary.StartDate` predates RC2), now a
  whole-month rather than whole-year error.
- RC2/checker-tests: `setupTestEnv` installs a JSON stub renderer, so most
  of `internal/handlers/whatif` cannot catch template-contract breaks
  (test-only follow-up candidate; the new OOB render tests use
  `setupTestEnvWithRenderer`).
- RC2/checker-tests: `EndMonth` lacks `omitempty`, so perpetual sources
  persist `"end_month":null` (round-trips correctly).
- RC2: `UpdateExpenseSource` with `end_year=0` now stores EndMonth=&0
  (ends immediately, matching the input's own tooltip) instead of
  perpetual; RC3 replaces the input.
- RC1/checker-tests: `floor_monthly_real` uses `omitempty`, so a stored 0
  is indistinguishable from an absent legacy field (inert: the input is
  required with min 0.01; sibling `max_shortfall_pct` deliberately records
  an explicit zero).
- RC1/checker-tests: `guardrail_optimizer.html:6` hardcodes `value="7500"`
  for ITS OWN `floor_monthly_real` input with no saved-preference prefill
  (separate feature, untouched).
- RC1/checker-tests: the "raw form, not normalized request" contract is
  proven only by a throwaway probe (request 1234 / form 7000); promoting it
  into `TestSpendingApplyKeepsComparisonMinimum` would make it
  mutation-resistant (V3 pattern candidate).
