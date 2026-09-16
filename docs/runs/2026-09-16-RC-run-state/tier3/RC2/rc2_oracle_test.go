package retirement

// RC2 oracle (lead-authored, planted by accept.sh into a COPY of the tree).
// Asserts the observable behaviour of every consumer the task touches.

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"budget2/internal/models"
	"budget2/internal/services/retirement/engine"
	"budget2/internal/services/retirement/prepare"
	"budget2/internal/services/storage"
)

func rc2Near(a, b float64) bool { return math.Abs(a-b) < 0.01 }

func rc2Fixture(t *testing.T, start string) *models.WhatIfSettings {
	t.Helper()
	s := models.DefaultWhatIfSettings()
	s.UseCurrentMonth = false
	s.StartDate = start
	s.ProjectionYears = 3
	s.PortfolioValue = 2000000
	s.InflationRate = 3
	s.Persons[0].BirthMonth = models.BirthMonthForAge(s.StartDate, 65)
	return s
}

// O2a — legacy year keys decode to months; new keys win; marshal emits only new keys.
func TestRC2OracleLegacyDecode(t *testing.T) {
	sm := &SettingsManager{}
	legacy := `{"use_current_month":false,"start_date":"2026-09",
	 "persons":[{"id":"you","name":"You","role":"primary","birth_month":"1961-09"}],
	 "income_sources":[{"id":"i","name":"Pension","amount":1000,"income_type":"fixed","start_month":12,"end_month":24}],
	 "expense_sources":[{"id":"e1","name":"Boat","amount":500,"start_year":1,"end_year":2},
	                    {"id":"e2","name":"Perpetual","amount":100,"start_year":0,"end_year":0},
	                    {"id":"e3","name":"Mixed","amount":100,"start_year":9,"start_month":5,"end_year":9,"end_month":7}],
	 "one_time_expenses":[{"id":"o1","description":"Roof","year":1,"amount":12000},{"id":"o2","description":"New","month":7,"amount":1}],
	 "big_ticket_items":[{"id":"b1","name":"Car","amount":5000,"year":1,"type":"expense"},{"id":"b2","name":"Sale","amount":9,"month":5,"year":9,"type":"income"}]}`
	s, _, err := sm.decodeSettings([]byte(legacy))
	if err != nil {
		t.Fatal(err)
	}
	if s.IncomeSources[0].StartMonth != 12 || s.IncomeSources[0].EndMonth == nil || *s.IncomeSources[0].EndMonth != 24 {
		t.Fatalf("income: %+v", s.IncomeSources[0])
	}
	e := s.ExpenseSources
	if e[0].StartMonth != 12 || e[0].EndMonth == nil || *e[0].EndMonth != 24 {
		t.Fatalf("legacy expense start_year/end_year not converted: %+v", e[0])
	}
	if e[1].StartMonth != 0 || e[1].EndMonth != nil {
		t.Fatalf("legacy perpetual expense: %+v", e[1])
	}
	if e[2].StartMonth != 5 || e[2].EndMonth == nil || *e[2].EndMonth != 7 {
		t.Fatalf("new keys must win over legacy: %+v", e[2])
	}
	if s.OneTimeExpenses[0].Month != 12 || s.OneTimeExpenses[1].Month != 7 {
		t.Fatalf("one-time: %+v", s.OneTimeExpenses)
	}
	if s.BigTicketItems[0].Month != 12 || s.BigTicketItems[1].Month != 5 {
		t.Fatalf("big-ticket: %+v", s.BigTicketItems)
	}
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"start_year"`, `"end_year"`, `"year":`} {
		if strings.Contains(string(raw), key) {
			t.Fatalf("legacy key %s re-emitted", key)
		}
	}
	for _, key := range []string{`"start_month":12`, `"end_month":24`, `"month":12`, `"month":7`, `"month":5`} {
		if !strings.Contains(string(raw), key) {
			t.Fatalf("missing %s in %s", key, raw)
		}
	}
	// Round trip of the new shape is stable.
	again, _, err := sm.decodeSettings(raw)
	if err != nil {
		t.Fatal(err)
	}
	if again.ExpenseSources[0].StartMonth != 12 || again.OneTimeExpenses[0].Month != 12 || again.BigTicketItems[0].Month != 12 {
		t.Fatal("new-shape round trip changed offsets")
	}
}

// O2b — the rollover shifts every scheduled offset by the elapsed months.
func TestRC2OracleShift(t *testing.T) {
	end := 24
	mk := func() *models.WhatIfSettings {
		s := models.DefaultWhatIfSettings()
		s.UseCurrentMonth = true
		s.StartDate = "2026-09"
		s.Persons[0].BirthMonth = "1961-09"
		s.IncomeSources = []models.IncomeSource{{ID: "i", Name: "Pension", Amount: 1000, Type: models.IncomeFixed, StartMonth: 12, EndMonth: &end}}
		s.RemovedIncomeSources = []models.IncomeSource{{ID: "ri", Name: "Old", Amount: 1, Type: models.IncomeFixed, StartMonth: 12}}
		e2 := 24
		s.ExpenseSources = []models.ExpenseSource{{ID: "e", Name: "Boat", Amount: 500, StartMonth: 12, EndMonth: &e2}}
		s.RemovedExpenseSources = []models.ExpenseSource{{ID: "re", Name: "Old", Amount: 1, StartMonth: 12}}
		s.OneTimeExpenses = []models.OneTimeExpense{{ID: "o", Description: "Roof", Month: 12, Amount: 12000}}
		s.BigTicketItems = []models.BigTicketItem{{ID: "b", Name: "Car", Amount: 5000, Month: 12, Type: models.BigTicketExpense}}
		s.RemovedBigTicketItems = []models.BigTicketItem{{ID: "rb", Name: "Old", Amount: 1, Month: 12, Type: models.BigTicketExpense}}
		return s
	}
	at := func(month string) time.Time {
		now, err := time.Parse("2006-01", month)
		if err != nil {
			t.Fatal(err)
		}
		return now
	}
	check := func(s *models.WhatIfSettings, label string, incStart, incEnd, expStart, expEnd, one, big int) {
		t.Helper()
		i, e := s.IncomeSources[0], s.ExpenseSources[0]
		if i.StartMonth != incStart || i.EndMonth == nil || *i.EndMonth != incEnd {
			t.Fatalf("%s income %d/%v want %d/%d", label, i.StartMonth, i.EndMonth, incStart, incEnd)
		}
		if e.StartMonth != expStart || e.EndMonth == nil || *e.EndMonth != expEnd {
			t.Fatalf("%s expense %d/%v want %d/%d", label, e.StartMonth, e.EndMonth, expStart, expEnd)
		}
		if s.OneTimeExpenses[0].Month != one {
			t.Fatalf("%s one-time %d want %d", label, s.OneTimeExpenses[0].Month, one)
		}
		if s.BigTicketItems[0].Month != big {
			t.Fatalf("%s big-ticket %d want %d", label, s.BigTicketItems[0].Month, big)
		}
		if s.RemovedIncomeSources[0].StartMonth != incStart || s.RemovedExpenseSources[0].StartMonth != expStart || s.RemovedBigTicketItems[0].Month != big {
			t.Fatalf("%s removed entries not shifted alike", label)
		}
	}
	s := mk()
	resolveCurrentMonth(s, at("2026-10"))
	if s.StartDate != "2026-10" {
		t.Fatalf("start %s", s.StartDate)
	}
	check(s, "after 1 month", 11, 23, 11, 23, 11, 11)
	resolveCurrentMonth(s, at("2026-10")) // same month again: no-op
	check(s, "same month", 11, 23, 11, 23, 11, 11)
	resolveCurrentMonth(s, at("2027-09"))
	check(s, "on the scheduled month", 0, 12, 0, 12, 0, 0)
	resolveCurrentMonth(s, at("2027-10"))
	check(s, "past: clamp income/expense, retain negatives", 0, 11, 0, 11, -1, -1)
	resolveCurrentMonth(s, at("2029-01"))
	check(s, "ended: end clamps at 0, negatives grow", 0, 0, 0, 0, -16, -16)
	// Backwards (file saved on a machine whose clock was ahead): symmetric.
	b := mk()
	resolveCurrentMonth(b, at("2026-08"))
	check(b, "backwards", 13, 25, 13, 25, 13, 13)
	// Fixed-date plans are never shifted.
	f := mk()
	f.UseCurrentMonth = false
	resolveCurrentMonth(f, at("2030-01"))
	if f.StartDate != "2026-09" {
		t.Fatal("fixed plan start moved")
	}
	check(f, "fixed plan", 12, 24, 12, 24, 12, 12)
	// Zero shift is a no-op (the oracle's mutation relies on it).
	z := mk()
	shiftScheduleOffsets(z, 0)
	check(z, "zero shift", 12, 24, 12, 24, 12, 12)
	if got, ok := monthsBetween("2026-09", "2027-10"); !ok || got != 13 {
		t.Fatalf("monthsBetween %d %v", got, ok)
	}
	if _, ok := monthsBetween("nope", "2027-10"); ok {
		t.Fatal("monthsBetween accepted garbage")
	}
}

// O2c — manager load→save→load with the real clock never double-shifts, and
// the file's start_date becomes the anchor.
func TestRC2OracleManagerRoundTrip(t *testing.T) {
	root := t.TempDir()
	store, err := storage.New(root)
	if err != nil {
		t.Fatal(err)
	}
	sm := NewSettingsManager(root, store)
	now := time.Now()
	thisMonth := now.Format("2006-01")
	saved := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -3, 0).Format("2006-01")
	doc := `{"use_current_month":true,"start_date":"` + saved + `","projection_years":5,
	 "persons":[{"id":"you","name":"You","role":"primary","birth_month":"1961-09"}],
	 "income_sources":[{"id":"i","name":"Pension","amount":1000,"income_type":"fixed","start_month":12}],
	 "expense_sources":[{"id":"e","name":"Boat","amount":500,"start_year":1,"end_year":2}],
	 "one_time_expenses":[{"id":"o","description":"Roof","year":1,"amount":12000}],
	 "big_ticket_items":[{"id":"b","name":"Car","amount":5000,"year":1,"type":"expense"}]}`
	path := filepath.Join(root, defaultWhatIfFilename)
	if err := os.WriteFile(path, []byte(doc), 0o644); err != nil {
		t.Fatal(err)
	}
	first, err := sm.Load()
	if err != nil {
		t.Fatal(err)
	}
	want := func(s *models.WhatIfSettings, label string) {
		t.Helper()
		if s.StartDate != thisMonth || s.IncomeSources[0].StartMonth != 9 || s.ExpenseSources[0].StartMonth != 9 || s.ExpenseSources[0].EndMonth == nil || *s.ExpenseSources[0].EndMonth != 21 || s.OneTimeExpenses[0].Month != 9 || s.BigTicketItems[0].Month != 9 {
			t.Fatalf("%s: start %s income %d expense %d/%v one-time %d big %d", label, s.StartDate, s.IncomeSources[0].StartMonth, s.ExpenseSources[0].StartMonth, s.ExpenseSources[0].EndMonth, s.OneTimeExpenses[0].Month, s.BigTicketItems[0].Month)
		}
	}
	want(first, "first load")
	if err := sm.Save(first); err != nil {
		t.Fatal(err)
	}
	sm.InvalidateCache()
	second, err := sm.Load()
	if err != nil {
		t.Fatal(err)
	}
	want(second, "reload after save")
	third, _, err := sm.LoadContextWithRevision(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want(third, "cached load")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var onDisk map[string]any
	if err := json.Unmarshal(raw, &onDisk); err != nil {
		t.Fatal(err)
	}
	if onDisk["start_date"] != thisMonth {
		t.Fatalf("file anchor %v want %s", onDisk["start_date"], thisMonth)
	}
	if strings.Contains(string(raw), `"start_year"`) || strings.Contains(string(raw), `"year":`) {
		t.Fatal("legacy keys written back")
	}
}

// O2d — engine and projection fire at the exact (non-year-aligned) month.
func TestRC2OracleEngineMonthFiring(t *testing.T) {
	base := prepare.MustFrom(t, rc2Fixture(t, "2026-10")).Settings()
	s := prepare.MustFrom(t, rc2Fixture(t, "2026-10")).Settings()
	end := 23
	s.IncomeSources = []models.IncomeSource{{ID: "i", Name: "Pension", Amount: 1000, Type: models.IncomeFixed, StartMonth: 11}}
	s.ExpenseSources = []models.ExpenseSource{{ID: "e", Name: "Boat", Amount: 500, StartMonth: 11, EndMonth: &end}}
	s.OneTimeExpenses = []models.OneTimeExpense{{ID: "o", Description: "Roof", Month: 11, Amount: 12000}, {ID: "past", Description: "Past", Month: -1, Amount: 999999}}
	roof := 12000 * math.Pow(1.03, 11.0/12)
	for _, tc := range []struct {
		month                    int
		income, expense, oneTime float64
	}{
		{10, 0, 0, 0}, {11, 1000, 500, roof}, {12, 1000, 500, 0}, {22, 1000, 500, 0}, {23, 1000, 0, 0},
	} {
		if di := engine.TotalIncome(s, tc.month) - engine.TotalIncome(base, tc.month); !rc2Near(di, tc.income) {
			t.Fatalf("month %d income delta %.2f want %.2f", tc.month, di, tc.income)
		}
		if de := engine.TotalExpenses(s, tc.month) - engine.TotalExpenses(base, tc.month); !rc2Near(de, tc.expense) {
			t.Fatalf("month %d expense delta %.2f want %.2f", tc.month, de, tc.expense)
		}
		if ot := engine.OneTimeExpensesForMonth(s, tc.month); !rc2Near(ot, tc.oneTime) {
			t.Fatalf("month %d one-time %.2f want %.2f", tc.month, ot, tc.oneTime)
		}
	}
	a := RunFast(engine.New(), engine.Input{Prepared: prepare.MustFrom(t, s), Hooks: DefaultHooks()})
	b := RunFast(engine.New(), engine.Input{Prepared: prepare.MustFrom(t, base), Hooks: DefaultHooks()})
	for _, tc := range []struct {
		month            int
		income, expenses float64
	}{
		{10, 0, 0}, {11, 1000, 500 + roof}, {12, 1000, 500}, {23, 1000, 0},
	} {
		am, bm := a.Projection.Months[tc.month], b.Projection.Months[tc.month]
		if di := am.TotalIncome - bm.TotalIncome; !rc2Near(di, tc.income) {
			t.Fatalf("projection month %d income delta %.2f want %.2f", tc.month, di, tc.income)
		}
		if de := am.TotalExpenses - bm.TotalExpenses; !rc2Near(de, tc.expenses) {
			t.Fatalf("projection month %d expenses delta %.2f want %.2f", tc.month, de, tc.expenses)
		}
	}
	// Year-aligned entries produce the same figures as before the change.
	y := prepare.MustFrom(t, rc2Fixture(t, "2026-10")).Settings()
	y.OneTimeExpenses = []models.OneTimeExpense{{ID: "o", Description: "Roof", Month: 12, Amount: 12000}}
	if ot := engine.OneTimeExpensesForMonth(y, 12); !rc2Near(ot, 12360) {
		t.Fatalf("year-aligned one-time %.2f want 12360.00", ot)
	}
	if ot := engine.OneTimeExpensesForMonth(y, 11); ot != 0 {
		t.Fatalf("year-aligned one-time fired early: %.2f", ot)
	}
}

// O2e — big-ticket items are applied in their exact month.
func TestRC2OracleBigTicketMonth(t *testing.T) {
	s := prepare.MustFrom(t, rc2Fixture(t, "2026-10")).Settings()
	s.BigTicketItems = []models.BigTicketItem{
		{ID: "sale", Name: "Sale", Amount: 5000, Month: 11, Type: models.BigTicketIncome},
		{ID: "past", Name: "Past", Amount: 777, Month: -1, Type: models.BigTicketIncome},
	}
	for _, tc := range []struct {
		month int
		delta float64
	}{{10, 0}, {11, 5000}, {12, 0}} {
		td, roth, basis := 100000.0, 0.0, 0.0
		taxable := engine.TaxableAccountState{MarketValue: 1000, CostBasis: 1000}
		engine.ApplyBigTicketItemsForMonth(s, tc.month, true, 0, &td, &taxable, &roth, &basis)
		if !rc2Near(taxable.MarketValue-1000, tc.delta) {
			t.Fatalf("month %d taxable delta %.2f want %.2f", tc.month, taxable.MarketValue-1000, tc.delta)
		}
	}
}
