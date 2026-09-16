package whatif

// RC2 oracle, template lane (lead-authored, planted by accept.sh into a COPY).
// Every handler response that renders the schedule surfaces must render
// completely with non-year-aligned entries present: the page (GET /whatif)
// and the every-mutation OOB partial. Added after ruling 2026-09-16b.

import (
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"budget2/internal/models"
)

func TestRC2OracleTemplatesRenderWithScheduledEntries(t *testing.T) {
	rm, cleanup := setupTestEnvWithRenderer(t)
	defer cleanup()
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
	s.OneTimeExpenses = []models.OneTimeExpense{{ID: "ote-1", Description: "Roof", Month: 11, Amount: 12000}}
	s.BigTicketItems = []models.BigTicketItem{{ID: "bt-1", Name: "Car", Amount: 5000, Month: 11, Type: models.BigTicketExpense, TaxTreatment: models.TaxTreatment("none")}}
	s.RemovedBigTicketItems = []models.BigTicketItem{{ID: "bt-old", Name: "OldCar", Amount: 1, Month: 11, Type: models.BigTicketExpense, TaxTreatment: models.TaxTreatment("none")}}
	if err := rm.Save(s); err != nil {
		t.Fatal(err)
	}
	rm.InvalidateCache()

	page := httptest.NewRecorder()
	handleWhatIf(page, httptest.NewRequest("GET", "/whatif", nil))
	// A mutation response: renders whatif-results-with-oob (every mutation path).
	oob := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/whatif/onetime", formBody(url.Values{"description": {"Wedding"}, "amount": {"8000"}, "year": {"2"}}))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	handleWhatIfAddOneTime(oob, req)

	for name, w := range map[string]*httptest.ResponseRecorder{"GET /whatif": page, "POST /whatif/onetime (OOB partial)": oob} {
		body := w.Body.String()
		if w.Code != 200 {
			t.Errorf("%s: status %d", name, w.Code)
		}
		for _, bad := range []string{"Error rendering", "can't evaluate", "executing \"", "incompatible types"} {
			if strings.Contains(body, bad) {
				t.Errorf("%s: template error leaked into the response: %q", name, bad)
			}
		}
		// The big-ticket item ("Car", month 11 → Sep 2027) and the one-time
		// entry ("Roof", month 11) both render their calendar label.
		if !strings.Contains(body, "Car") || !strings.Contains(body, "Roof") {
			t.Errorf("%s: schedule entries missing from the response", name)
		}
		if strings.Count(body, "Sep 2027") < 2 {
			t.Errorf("%s: expected the calendar label for both the big-ticket and one-time entries, got %d", name, strings.Count(body, "Sep 2027"))
		}
		// Input VALUES may still carry the interim float (criterion 7: the
		// inline edit inputs keep div until RC3 and fail loudly on re-save);
		// displayed TEXT must never show a year-offset figure for these entries.
		displayed := regexp.MustCompile(`value="[^"]*"`).ReplaceAllString(body, `value=""`)
		for _, bad := range []string{"0.9166", "Year 0 (", "(yr 0)", "Year 0.9", "(yr 0.9"} {
			if strings.Contains(displayed, bad) {
				t.Errorf("%s: year-offset figure displayed for a non-aligned month: %q", name, bad)
			}
		}
	}
}
