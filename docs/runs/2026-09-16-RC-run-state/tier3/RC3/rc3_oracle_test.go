package whatif

// RC3 oracle (lead-authored, planted by accept.sh into a COPY of the tree).
// Handler-level: real requests, real templates, assertions on response bodies.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"budget2/internal/models"
	"budget2/internal/services/retirement"
)

// Plan start 2026-10: offset 11 = 2027-09, offset 23 = 2028-09, offset 24 = 2028-10.
func rc3Fixture(t *testing.T, rm *retirement.SettingsManager) *models.WhatIfSettings {
	t.Helper()
	s, err := rm.Load()
	if err != nil {
		t.Fatal(err)
	}
	s.UseCurrentMonth = false
	s.StartDate = "2026-10"
	s.ProjectionYears = 12
	s.Persons[0].BirthMonth = models.BirthMonthForAge(s.StartDate, 65)
	end := 24
	s.IncomeSources = []models.IncomeSource{{ID: "inc-1", Name: "Pension", Amount: 1000, Type: models.IncomeFixed, StartMonth: 11, EndMonth: &end}}
	end2 := 24
	s.ExpenseSources = []models.ExpenseSource{{ID: "exp-1", Name: "Boat", Amount: 500, StartMonth: 11, EndMonth: &end2}}
	s.OneTimeExpenses = []models.OneTimeExpense{{ID: "ote-1", Description: "Roof", Month: 11, Amount: 12000}, {ID: "ote-past", Description: "OldRoof", Month: -1, Amount: 5}}
	s.BigTicketItems = []models.BigTicketItem{{ID: "bt-1", Name: "Car", Amount: 5000, Month: 11, Type: models.BigTicketExpense, TaxTreatment: models.TaxTreatment("none")}}
	if err := rm.Save(s); err != nil {
		t.Fatal(err)
	}
	rm.InvalidateCache()
	return s
}

func rc3Page(t *testing.T) string {
	t.Helper()
	w := httptest.NewRecorder()
	handleWhatIf(w, httptest.NewRequest("GET", "/whatif", nil))
	if w.Code != 200 {
		t.Fatalf("GET /whatif %d", w.Code)
	}
	return w.Body.String()
}

func rc3Post(t *testing.T, h http.HandlerFunc, path string, id string, form url.Values) *httptest.ResponseRecorder {
	t.Helper()
	params := map[string]string{}
	if id != "" {
		params["id"] = id
	}
	w := httptest.NewRecorder()
	h(w, chiRequest("POST", path, formBody(form), params))
	return w
}

// O2a — the page shows calendar months, month inputs with min=plan start, and no year offsets.
func TestRC3OraclePageShowsCalendarMonths(t *testing.T) {
	rm, cleanup := setupTestEnvWithRenderer(t)
	defer cleanup()
	rc3Fixture(t, rm)
	body := rc3Page(t)
	for _, want := range []string{
		`type="month"`, `min="2026-10"`,
		`value="2027-09"`, // edit forms carry the exact start month
		`value="2028-09"`, // "Through" = last month included (EndMonth 24 → offset 23)
		"Sep 2027", "Sep 2028", "Sep 2026",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("page missing %q", want)
		}
	}
	// The income and expense inline edit forms each carry the exact start
	// month (one-time and big-ticket entries have no edit form: they are
	// add/delete only, so their round trip is the add path in O2c).
	if strings.Count(body, `value="2027-09"`) < 2 {
		t.Errorf("expected the income and expense inline edit forms to carry 2027-09; got %d", strings.Count(body, `value="2027-09"`))
	}
	if !strings.Contains(body, "(past)") {
		t.Error("past one-time entry not marked (past)")
	}
	for _, bad := range []string{"(yr 0)", "(yr 1)", "Year 0", "Year 1 (", "Starts yr", "Ends yr", `name="year"`, "add-income-start-year", "add-expense-start-year", "add-bigticket-year", "onetime-year"} {
		if strings.Contains(body, bad) {
			t.Errorf("page still renders year offset %q", bad)
		}
	}
	// The Roth conversion card (out of scope) keeps its start_year/end_year
	// inputs; no OTHER start_year/end_year input may remain on the page.
	if got := strings.Count(body, `name="start_year"`); got != 1 {
		t.Errorf("name=\"start_year\" inputs = %d, want exactly 1 (the Roth card only)", got)
	}
	if got := strings.Count(body, `name="end_year"`); got != 1 {
		t.Errorf("name=\"end_year\" inputs = %d, want exactly 1 (the Roth card only)", got)
	}
}

// O2b — an untouched edit-form re-save never moves a date (exact month round trip).
func TestRC3OracleEditRoundTrip(t *testing.T) {
	rm, cleanup := setupTestEnvWithRenderer(t)
	defer cleanup()
	rc3Fixture(t, rm)
	if w := rc3Post(t, handleWhatIfUpdateIncome, "/whatif/income/inc-1", "inc-1", url.Values{"start_month": {"2027-09"}, "end_month": {"2028-09"}}); w.Code != 200 {
		t.Fatalf("update income %d %s", w.Code, w.Body.String())
	}
	if w := rc3Post(t, handleWhatIfUpdateExpense, "/whatif/expense/exp-1", "exp-1", url.Values{"start_month": {"2027-09"}, "end_month": {"2028-09"}, "inflation": {"on"}}); w.Code != 200 {
		t.Fatalf("update expense %d %s", w.Code, w.Body.String())
	}
	rm.InvalidateCache()
	s, err := rm.Load()
	if err != nil {
		t.Fatal(err)
	}
	if s.IncomeSources[0].StartMonth != 11 || s.IncomeSources[0].EndMonth == nil || *s.IncomeSources[0].EndMonth != 24 {
		t.Fatalf("income moved: %d/%v", s.IncomeSources[0].StartMonth, s.IncomeSources[0].EndMonth)
	}
	if s.ExpenseSources[0].StartMonth != 11 || s.ExpenseSources[0].EndMonth == nil || *s.ExpenseSources[0].EndMonth != 24 || !s.ExpenseSources[0].Inflation {
		t.Fatalf("expense moved: %+v", s.ExpenseSources[0])
	}
	// Blank end month = perpetual.
	if w := rc3Post(t, handleWhatIfUpdateIncome, "/whatif/income/inc-1", "inc-1", url.Values{"start_month": {"2027-09"}, "end_month": {""}}); w.Code != 200 {
		t.Fatalf("update income perpetual %d", w.Code)
	}
	rm.InvalidateCache()
	s, _ = rm.Load()
	if s.IncomeSources[0].EndMonth != nil {
		t.Fatal("blank end month did not clear the end")
	}
}

// O2c — adds accept calendar months and reject dates before the plan start or inverted ranges.
func TestRC3OracleAddAndValidation(t *testing.T) {
	rm, cleanup := setupTestEnvWithRenderer(t)
	defer cleanup()
	rc3Fixture(t, rm)
	if w := rc3Post(t, handleWhatIfAddIncome, "/whatif/income", "", url.Values{"name": {"Annuity"}, "amount": {"250"}, "start_month": {"2028-01"}, "end_month": {"2029-12"}}); w.Code != 200 {
		t.Fatalf("add income %d %s", w.Code, w.Body.String())
	}
	if w := rc3Post(t, handleWhatIfAddExpense, "/whatif/expense", "", url.Values{"name": {"Lease"}, "amount": {"300"}, "start_month": {"2027-01"}}); w.Code != 200 {
		t.Fatalf("add expense %d %s", w.Code, w.Body.String())
	}
	if w := rc3Post(t, handleWhatIfAddOneTime, "/whatif/onetime", "", url.Values{"description": {"Wedding"}, "amount": {"8000"}, "month": {"2027-09"}}); w.Code != 200 {
		t.Fatalf("add one-time %d %s", w.Code, w.Body.String())
	}
	if w := rc3Post(t, handleWhatIfAddBigTicket, "/whatif/bigticket", "", url.Values{"name": {"Sale"}, "amount": {"9000"}, "month": {"2027-09"}, "type": {"income"}, "tax_treatment": {"none"}}); w.Code != 200 {
		t.Fatalf("add big-ticket %d %s", w.Code, w.Body.String())
	}
	rm.InvalidateCache()
	s, err := rm.Load()
	if err != nil {
		t.Fatal(err)
	}
	var annuity *models.IncomeSource
	for i := range s.IncomeSources {
		if s.IncomeSources[i].Name == "Annuity" {
			annuity = &s.IncomeSources[i]
		}
	}
	if annuity == nil || annuity.StartMonth != 15 || annuity.EndMonth == nil || *annuity.EndMonth != 39 {
		t.Fatalf("annuity offsets: %+v", annuity)
	}
	var lease *models.ExpenseSource
	for i := range s.ExpenseSources {
		if s.ExpenseSources[i].Name == "Lease" {
			lease = &s.ExpenseSources[i]
		}
	}
	if lease == nil || lease.StartMonth != 3 || lease.EndMonth != nil {
		t.Fatalf("lease offsets: %+v", lease)
	}
	foundOTE, foundBT := false, false
	for _, e := range s.OneTimeExpenses {
		if e.Description == "Wedding" && e.Month == 11 {
			foundOTE = true
		}
	}
	for _, b := range s.BigTicketItems {
		if b.Name == "Sale" && b.Month == 11 {
			foundBT = true
		}
	}
	if !foundOTE || !foundBT {
		t.Fatalf("one-time %v big-ticket %v stored at month 11", foundOTE, foundBT)
	}
	// Rejections: before plan start, inverted range, unparseable.
	for _, tc := range []struct {
		name string
		h    http.HandlerFunc
		path string
		form url.Values
		want string
	}{
		{"income before start", handleWhatIfAddIncome, "/whatif/income", url.Values{"name": {"X"}, "amount": {"1"}, "start_month": {"2026-09"}}, "Oct 2026"},
		{"expense inverted", handleWhatIfAddExpense, "/whatif/expense", url.Values{"name": {"X"}, "amount": {"1"}, "start_month": {"2028-01"}, "end_month": {"2027-06"}}, ""},
		{"one-time garbage", handleWhatIfAddOneTime, "/whatif/onetime", url.Values{"description": {"X"}, "amount": {"1"}, "month": {"soon"}}, ""},
		{"big-ticket before start", handleWhatIfAddBigTicket, "/whatif/bigticket", url.Values{"name": {"X"}, "amount": {"1"}, "month": {"2020-01"}, "type": {"expense"}, "tax_treatment": {"none"}}, "Oct 2026"},
	} {
		w := rc3Post(t, tc.h, tc.path, "", tc.form)
		if w.Code != 400 {
			t.Errorf("%s: got %d want 400 (%s)", tc.name, w.Code, w.Body.String())
		}
		if tc.want != "" && !strings.Contains(w.Body.String(), tc.want) {
			t.Errorf("%s: error should name the plan start month (%q): %s", tc.name, tc.want, w.Body.String())
		}
	}
	// Edit before plan start is rejected too.
	if w := rc3Post(t, handleWhatIfUpdateExpense, "/whatif/expense/exp-1", "exp-1", url.Values{"start_month": {"2026-01"}}); w.Code != 400 {
		t.Errorf("edit before plan start accepted: %d", w.Code)
	}
}

// O2d — rollover on the UI path: the shifted offset and the displayed month agree.
func TestRC3OracleRolloverDisplay(t *testing.T) {
	rm, cleanup := setupTestEnvWithRenderer(t)
	defer cleanup()
	s, err := rm.Load()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	s.UseCurrentMonth = true
	s.StartDate = first.AddDate(0, -3, 0).Format("2006-01")
	s.Persons[0].BirthMonth = models.BirthMonthForAge(s.StartDate, 65)
	s.IncomeSources = []models.IncomeSource{{ID: "inc-r", Name: "Rollover Pension", Amount: 1000, Type: models.IncomeFixed, StartMonth: 12}}
	// Write the file directly so the save path cannot pre-shift it.
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rm.SettingsDir(), "whatif.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	rm.InvalidateCache()
	body := rc3Page(t)
	wantValue := first.AddDate(0, 9, 0).Format("2006-01")
	wantLabel := first.AddDate(0, 9, 0).Format("Jan 2006")
	if !strings.Contains(body, `value="`+wantValue+`"`) || !strings.Contains(body, wantLabel) {
		t.Fatalf("rolled-over income should display %s / %s", wantValue, wantLabel)
	}
}

// O2e — rollover-clamped rows (added after ruling 2026-09-16e). A plan whose
// start_date is 20 months old with (a) an expense that ended 17 months ago
// and (b) an income that started 8 months ago and runs on: after the real
// rollover shift, (a) is StartMonth 0 / EndMonth 0 and (b) is StartMonth 0 /
// EndMonth 22. The ended row is display-only and honest about the lost
// month; the clamped-start row's own rendered values re-save unchanged.
func TestRC3OracleClampedRowsRoundTrip(t *testing.T) {
	rm, cleanup := setupTestEnvWithRenderer(t)
	defer cleanup()
	s, err := rm.Load()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	s.UseCurrentMonth = true
	s.StartDate = first.AddDate(0, -20, 0).Format("2006-01")
	s.Persons[0].BirthMonth = models.BirthMonthForAge(s.StartDate, 65)
	endedEnd := 3
	s.ExpenseSources = []models.ExpenseSource{{ID: "exp-ended", Name: "OldLease", Amount: 400, StartMonth: 0, EndMonth: &endedEnd}}
	incEnd := 42
	s.IncomeSources = []models.IncomeSource{{ID: "inc-running", Name: "RunningPension", Amount: 900, Type: models.IncomeFixed, StartMonth: 12, EndMonth: &incEnd}}
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rm.SettingsDir(), "whatif.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	rm.InvalidateCache()
	loaded, err := rm.Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ExpenseSources[0].StartMonth != 0 || loaded.ExpenseSources[0].EndMonth == nil || *loaded.ExpenseSources[0].EndMonth != 0 {
		t.Fatalf("fixture: expense not clamped to 0/0: %+v", loaded.ExpenseSources[0])
	}
	if loaded.IncomeSources[0].StartMonth != 0 || loaded.IncomeSources[0].EndMonth == nil || *loaded.IncomeSources[0].EndMonth != 22 {
		t.Fatalf("fixture: income not 0/22: %+v", loaded.IncomeSources[0])
	}
	planStart := first.Format("2006-01")
	planLabel := first.Format("Jan 2006")
	body := rc3Page(t)
	// (a) ended row: honest wording, no schedule/amount inputs, no invented Through.
	if !strings.Contains(body, "Ended before the plan start") || !strings.Contains(body, "OldLease") {
		t.Error("ended expense row does not say it ended before the plan start")
	}
	if strings.Contains(body, `value="`+first.AddDate(0, -1, 0).Format("2006-01")+`"`) {
		t.Error("ended row invents a Through month before the plan start")
	}
	if strings.Contains(body, `id="expense-end-month-exp-ended"`) || strings.Contains(body, `expense-start-month-exp-ended"`) || strings.Contains(body, `hx-put="/whatif/expense/exp-ended"`) {
		t.Error("ended expense row still renders schedule inputs or an update form")
	}
	// (b) clamped-start row: "Since plan start", inputs carry the plan start and Through (offset 21).
	if !strings.Contains(body, "Since plan start ("+planLabel+")") {
		t.Errorf("clamped-start income row should read Since plan start (%s)", planLabel)
	}
	throughValue := first.AddDate(0, 21, 0).Format("2006-01")
	if !strings.Contains(body, `value="`+planStart+`"`) || !strings.Contains(body, `value="`+throughValue+`"`) {
		t.Fatalf("clamped-start income row inputs should carry %s and %s", planStart, throughValue)
	}
	// Attempt 3 (ruling h): no OTHER surface may invent a month for the
	// ended entry or announce a "start" for the clamped-start one.
	invented := first.AddDate(0, -1, 0).Format("Jan 2006")
	if strings.Contains(body, "(through "+invented+")") || strings.Contains(body, "OldLease (through") {
		t.Error("Budget Fit still names an invented month for the ended expense")
	}
	if strings.Contains(body, "Pension starts") {
		t.Error("timeline announces a start for a pension that is already running (clamped start)")
	}
	// Re-post the row's own values (plus an unrelated toggle): 200, nothing moves.
	w := rc3Post(t, handleWhatIfUpdateIncome, "/whatif/income/inc-running", "inc-running", url.Values{"start_month": {planStart}, "end_month": {throughValue}, "cola": {"on"}})
	if w.Code != 200 {
		t.Fatalf("untouched re-save of a clamped-start row rejected: %d %s", w.Code, w.Body.String())
	}
	rm.InvalidateCache()
	after, err := rm.Load()
	if err != nil {
		t.Fatal(err)
	}
	if after.IncomeSources[0].StartMonth != 0 || after.IncomeSources[0].EndMonth == nil || *after.IncomeSources[0].EndMonth != 22 {
		t.Fatalf("re-save moved the clamped-start row: %d/%v", after.IncomeSources[0].StartMonth, after.IncomeSources[0].EndMonth)
	}
}
