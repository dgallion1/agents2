package whatif

// GV2 acceptance oracle (lead-authored, immutable during the run).
// Injected into package whatif via go test -overlay; never committed.
//
// Claim under test: the engine emits, on every ProjectionYearSummary while
// guardrails are enabled, the exact thresholds its next yearly check tests
// the portfolio against (GuardrailPeak, GuardrailBaseline,
// GuardrailCutTrigger, GuardrailRaiseTrigger); buildProjectionChartData
// renders them as "Cut trigger" / "Raise trigger" step traces in both
// dollar modes using the check-month CPI divisor, adds a "Monthly living
// budget" panel (Planned / After guardrails) on yaxis2, and keeps one
// guardrail marker per event on that panel with unchanged hover text.

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"budget2/internal/models"
	"budget2/internal/services/retirement"
)

func gv2Settings(living, income float64, years int, guardrails *models.GuardrailConfig) *models.WhatIfSettings {
	s := models.DefaultWhatIfSettings()
	s.PortfolioValue = 500000
	s.MonthlyLivingExpenses = living
	s.MonthlyHealthcare = 0
	s.MonthlyPropertyTax = 0
	s.InflationRate = 2.5
	s.SpendingDeclineRate = 0
	s.InvestmentReturn = 1.0
	s.ProjectionYears = years
	s.SpendingPhaseConfig = &models.SpendingPhaseConfig{Enabled: false}
	s.Guardrails = guardrails
	if income > 0 {
		s.IncomeSources = []models.IncomeSource{{ID: "gv2-pension", Name: "Pension", Amount: income, Type: models.IncomeDelayed, StartMonth: 36}}
	}
	return s
}

func gv2Run(t *testing.T, s *models.WhatIfSettings) *models.ProjectionResult {
	t.Helper()
	in, _, err := buildEngineInput(s)
	if err != nil {
		t.Fatal(err)
	}
	in.Hooks = retirement.DefaultHooks()
	return getEngine().Run(in)
}

func gv2Close(a, b float64) bool {
	if a == b {
		return true
	}
	return math.Abs(a-b) <= 1e-6*math.Max(1, math.Max(math.Abs(a), math.Abs(b)))
}

func gv2Trace(t *testing.T, chart map[string]interface{}, name string) map[string]interface{} {
	t.Helper()
	traces, _ := chart["data"].([]map[string]interface{})
	for _, tr := range traces {
		if n, _ := tr["name"].(string); n == name {
			return tr
		}
	}
	return nil
}

func gv2Floats(t *testing.T, tr map[string]interface{}, key string) []float64 {
	t.Helper()
	v, ok := tr[key].([]float64)
	if !ok {
		t.Fatalf("trace %v key %s is %T, want []float64", tr["name"], key, tr[key])
	}
	return v
}

// The event fixture: three consecutive cuts while a large living budget
// drains the portfolio, then a pension from month 36 lifts the balance
// past the raise trigger.
func gv2EventFixture() *models.WhatIfSettings {
	return gv2Settings(12000, 30000, 8, &models.GuardrailConfig{Enabled: true, FloorDropPct: 20, FloorCutPct: 10, CeilingRisePct: 20, CeilingRaisePct: 10, MinSpendingPct: 50, MaxSpendingPct: 150})
}

func TestGV2OracleEngineThresholdsAreExact(t *testing.T) {
	s := gv2EventFixture()
	p := gv2Run(t, s)
	cuts, raises := 0, 0
	for _, e := range p.GuardrailEvents {
		if e.Type == "cut" {
			cuts++
		} else {
			raises++
		}
	}
	if cuts == 0 || raises == 0 {
		t.Fatalf("fixture defect: need >=1 cut and >=1 raise, got cuts=%d raises=%d events=%+v", cuts, raises, p.GuardrailEvents)
	}
	if len(p.YearlySummaries) != s.ProjectionYears {
		t.Fatalf("yearly summaries %d != years %d", len(p.YearlySummaries), s.ProjectionYears)
	}
	g := s.Guardrails
	for y, ys := range p.YearlySummaries {
		if ys.GuardrailPeak <= 0 || ys.GuardrailBaseline <= 0 || ys.GuardrailCutTrigger <= 0 || ys.GuardrailRaiseTrigger <= 0 {
			t.Fatalf("CRITERION 2 FAIL: year %d guardrail threshold fields missing or zero: %+v", y, ys)
		}
		if !gv2Close(ys.GuardrailCutTrigger, ys.GuardrailPeak*(1-g.FloorDropPct/100)) {
			t.Fatalf("CRITERION 2 FAIL: year %d cut trigger %.6f != peak %.6f x (1-%.0f%%)", y, ys.GuardrailCutTrigger, ys.GuardrailPeak, g.FloorDropPct)
		}
		if !gv2Close(ys.GuardrailRaiseTrigger, ys.GuardrailBaseline*(1+g.CeilingRisePct/100)) {
			t.Fatalf("CRITERION 2 FAIL: year %d raise trigger %.6f != baseline %.6f x (1+%.0f%%)", y, ys.GuardrailRaiseTrigger, ys.GuardrailBaseline, g.CeilingRisePct)
		}
	}
	// Year 0 thresholds are the starting portfolio's.
	if !gv2Close(p.YearlySummaries[0].GuardrailPeak, s.PortfolioValue) || !gv2Close(p.YearlySummaries[0].GuardrailBaseline, s.PortfolioValue) {
		t.Fatalf("CRITERION 2 FAIL: year 0 peak/baseline %.2f/%.2f != starting portfolio %.2f", p.YearlySummaries[0].GuardrailPeak, p.YearlySummaries[0].GuardrailBaseline, s.PortfolioValue)
	}
	events := map[int]models.GuardrailEvent{}
	for _, e := range p.GuardrailEvents {
		events[e.Year] = e
	}
	for n := 1; n < s.ProjectionYears; n++ {
		prev := p.YearlySummaries[n-1]
		check := p.Months[n*12-1].PortfolioBalance // balance the year-n check evaluates
		if e, ok := events[n]; ok {
			if !gv2Close(e.Portfolio, check) {
				t.Fatalf("CRITERION 2 FAIL: year %d event portfolio %.2f != check-month balance %.2f", n, e.Portfolio, check)
			}
			switch e.Type {
			case "cut":
				if e.Portfolio > prev.GuardrailCutTrigger {
					t.Fatalf("CRITERION 2 FAIL: cut at year %d with portfolio %.2f ABOVE cut trigger %.2f", n, e.Portfolio, prev.GuardrailCutTrigger)
				}
				if !gv2Close(p.YearlySummaries[n].GuardrailPeak, e.Portfolio) {
					t.Fatalf("CRITERION 2 FAIL: after the year %d cut, peak %.2f should reset to %.2f", n, p.YearlySummaries[n].GuardrailPeak, e.Portfolio)
				}
			case "raise":
				if e.Portfolio < prev.GuardrailRaiseTrigger {
					t.Fatalf("CRITERION 2 FAIL: raise at year %d with portfolio %.2f BELOW raise trigger %.2f", n, e.Portfolio, prev.GuardrailRaiseTrigger)
				}
				if !gv2Close(p.YearlySummaries[n].GuardrailBaseline, e.Portfolio) {
					t.Fatalf("CRITERION 2 FAIL: after the year %d raise, baseline %.2f should reset to %.2f", n, p.YearlySummaries[n].GuardrailBaseline, e.Portfolio)
				}
			}
			continue
		}
		// No event: the balance stayed strictly between the lines unless the
		// multiplier is pinned at a bound (a clamped evaluation emits no event).
		mult := p.YearlySummaries[n].GuardrailMultiplier
		pinned := gv2Close(mult, g.MinSpendingPct/100) || gv2Close(mult, g.MaxSpendingPct/100)
		if !pinned && (check <= prev.GuardrailCutTrigger || check >= prev.GuardrailRaiseTrigger) {
			t.Fatalf("CRITERION 2 FAIL: year %d had no event but balance %.2f is outside (%.2f, %.2f)", n, check, prev.GuardrailCutTrigger, prev.GuardrailRaiseTrigger)
		}
	}
}

func TestGV2OracleChartTracesBothModes(t *testing.T) {
	s := gv2EventFixture()
	p := gv2Run(t, s)
	if len(p.GuardrailEvents) == 0 {
		t.Fatal("fixture defect: no events")
	}
	for _, mode := range []string{"nominal", "real"} {
		chart := buildProjectionChartData(s, p, mode)
		cut := gv2Trace(t, chart, "Cut trigger")
		raise := gv2Trace(t, chart, "Raise trigger")
		if cut == nil || raise == nil {
			t.Fatalf("CRITERION 3 FAIL (%s): missing Cut trigger / Raise trigger traces", mode)
		}
		for _, tr := range []map[string]interface{}{cut, raise} {
			line, _ := tr["line"].(map[string]interface{})
			if line == nil || line["shape"] != "hv" || line["dash"] == nil {
				t.Fatalf("CRITERION 3 FAIL (%s): %v must be a dashed hv step line, got %v", mode, tr["name"], tr["line"])
			}
			x := gv2Floats(t, tr, "x")
			y := gv2Floats(t, tr, "y")
			if len(x) != len(y) || len(x) < s.ProjectionYears {
				t.Fatalf("CRITERION 3 FAIL (%s): %v has %d x / %d y points, want >= %d", mode, tr["name"], len(x), len(y), s.ProjectionYears)
			}
			for i := 0; i < s.ProjectionYears; i++ {
				if x[i] != float64(i) {
					t.Fatalf("CRITERION 3 FAIL (%s): %v x[%d]=%v, want %d", mode, tr["name"], i, x[i], i)
				}
				want := p.YearlySummaries[i].GuardrailCutTrigger
				if tr["name"] == "Raise trigger" {
					want = p.YearlySummaries[i].GuardrailRaiseTrigger
				}
				if mode == "real" {
					idx := (i+1)*12 - 1
					if idx > len(p.Months)-1 {
						idx = len(p.Months) - 1
					}
					want /= p.Months[idx].CumulativeInflation
				}
				if !gv2Close(y[i], want) {
					t.Fatalf("CRITERION 3 FAIL (%s): %v y[%d]=%.6f, want %.6f", mode, tr["name"], i, y[i], want)
				}
			}
		}
		// Crossing property in the rendered numbers: a cut at year n means the
		// check-month balance point on the chart is at or below the cut line.
		for _, e := range p.GuardrailEvents {
			idx := e.Year*12 - 1
			bal := p.Months[idx].PortfolioBalance
			if mode == "real" {
				bal = p.Months[idx].PortfolioBalanceReal
			}
			cy := gv2Floats(t, cut, "y")[e.Year-1]
			ry := gv2Floats(t, raise, "y")[e.Year-1]
			if e.Type == "cut" && bal > cy*(1+1e-9) {
				t.Fatalf("CRITERION 3 FAIL (%s): cut at year %d but chart balance %.2f above cut line %.2f", mode, e.Year, bal, cy)
			}
			if e.Type == "raise" && bal < ry*(1-1e-9) {
				t.Fatalf("CRITERION 3 FAIL (%s): raise at year %d but chart balance %.2f below raise line %.2f", mode, e.Year, bal, ry)
			}
		}
		// Budget panel: Planned / After guardrails on yaxis2, one point per month.
		planned := gv2Trace(t, chart, "Planned")
		after := gv2Trace(t, chart, "After guardrails")
		if planned == nil || after == nil {
			t.Fatalf("CRITERION 3 FAIL (%s): missing Planned / After guardrails budget traces", mode)
		}
		for _, tr := range []map[string]interface{}{planned, after} {
			if tr["yaxis"] != "y2" {
				t.Fatalf("CRITERION 3 FAIL (%s): %v must be on yaxis y2, got %v", mode, tr["name"], tr["yaxis"])
			}
			y := gv2Floats(t, tr, "y")
			x := gv2Floats(t, tr, "x")
			if len(y) != len(p.Months) || len(x) != len(p.Months) {
				t.Fatalf("CRITERION 3 FAIL (%s): %v has %d points, want %d months", mode, tr["name"], len(y), len(p.Months))
			}
			for i, m := range p.Months {
				want := m.PlannedLivingExpenses
				if tr["name"] == "After guardrails" {
					want = m.AdjustedLivingExpenses
				}
				if mode == "real" {
					want /= m.CumulativeInflation
				}
				if !gv2Close(y[i], want) || x[i] != m.Year {
					t.Fatalf("CRITERION 3 FAIL (%s): %v point %d = (%v, %.6f), want (%v, %.6f)", mode, tr["name"], i, x[i], y[i], m.Year, want)
				}
			}
		}
		// Markers: one per event, on the budget panel, hover text unchanged,
		// y equal to the After-guardrails value at the event month.
		markers := gv2Trace(t, chart, "Guardrail cuts / raises")
		if markers == nil {
			t.Fatalf("CRITERION 3 FAIL (%s): missing guardrail markers trace", mode)
		}
		if markers["yaxis"] != "y2" {
			t.Fatalf("CRITERION 3 FAIL (%s): markers must sit on the budget panel (yaxis y2), got %v", mode, markers["yaxis"])
		}
		mx := gv2Floats(t, markers, "x")
		my := gv2Floats(t, markers, "y")
		text, _ := markers["text"].([]string)
		if len(mx) != len(p.GuardrailEvents) || len(my) != len(mx) || len(text) != len(mx) {
			t.Fatalf("CRITERION 3 FAIL (%s): markers %d/%d/%d, events %d", mode, len(mx), len(my), len(text), len(p.GuardrailEvents))
		}
		afterY := gv2Floats(t, after, "y")
		for i, e := range p.GuardrailEvents {
			if mx[i] != float64(e.Year) {
				t.Fatalf("CRITERION 3 FAIL (%s): marker %d at x=%v, event year %d", mode, i, mx[i], e.Year)
			}
			if text[i] != guardrailEventHoverText(e) {
				t.Fatalf("CRITERION 3 FAIL (%s): marker %d hover %q != events-list text %q", mode, i, text[i], guardrailEventHoverText(e))
			}
			if !gv2Close(my[i], afterY[e.Year*12]) {
				t.Fatalf("CRITERION 3 FAIL (%s): marker %d y=%.6f != After-guardrails value at month %d (%.6f)", mode, i, my[i], e.Year*12, afterY[e.Year*12])
			}
		}
		layout, _ := chart["layout"].(map[string]interface{})
		if layout == nil || layout["yaxis2"] == nil {
			t.Fatalf("CRITERION 3 FAIL (%s): layout has no yaxis2 for the budget panel", mode)
		}
	}
}

func TestGV2OracleNoEventsStillShowsTriggers(t *testing.T) {
	s := gv2Settings(1000, 0, 6, &models.GuardrailConfig{Enabled: true, FloorDropPct: 20, FloorCutPct: 10, CeilingRisePct: 20, CeilingRaisePct: 10, MinSpendingPct: 75, MaxSpendingPct: 120})
	p := gv2Run(t, s)
	if len(p.GuardrailEvents) != 0 {
		t.Fatalf("fixture defect: expected no events, got %+v", p.GuardrailEvents)
	}
	chart := buildProjectionChartData(s, p, "nominal")
	if gv2Trace(t, chart, "Cut trigger") == nil || gv2Trace(t, chart, "Raise trigger") == nil {
		t.Fatal("CRITERION 3 FAIL: trigger traces must render whenever guardrails are enabled, even with no events")
	}
	if gv2Trace(t, chart, "After guardrails") == nil {
		t.Fatal("CRITERION 3 FAIL: budget panel must render whenever guardrails are enabled")
	}
	for y, ys := range p.YearlySummaries {
		if ys.GuardrailCutTrigger <= 0 || ys.GuardrailRaiseTrigger <= 0 {
			t.Fatalf("CRITERION 2 FAIL: year %d thresholds missing with no events", y)
		}
	}
}

func TestGV2OracleDisabledGuardrailsEmitNothing(t *testing.T) {
	s := gv2Settings(12000, 30000, 4, nil)
	p := gv2Run(t, s)
	for y, ys := range p.YearlySummaries {
		if ys.GuardrailPeak != 0 || ys.GuardrailBaseline != 0 || ys.GuardrailCutTrigger != 0 || ys.GuardrailRaiseTrigger != 0 {
			t.Fatalf("CRITERION 2 FAIL: guardrails disabled but year %d carries thresholds: %+v", y, ys)
		}
		raw, err := json.Marshal(ys)
		if err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{"guardrail_peak", "guardrail_baseline", "guardrail_cut_trigger", "guardrail_raise_trigger"} {
			if strings.Contains(string(raw), `"`+key+`"`) {
				t.Fatalf("CRITERION 2 FAIL: %s must be omitempty when guardrails are disabled (existing consumers see unchanged JSON)", key)
			}
		}
	}
	chart := buildProjectionChartData(s, p, "nominal")
	for _, name := range []string{"Cut trigger", "Raise trigger", "Planned", "After guardrails", "Guardrail cuts / raises"} {
		if gv2Trace(t, chart, name) != nil {
			t.Fatalf("CRITERION 3 FAIL: guardrails disabled but chart has trace %q", name)
		}
	}
	layout, _ := chart["layout"].(map[string]interface{})
	if layout != nil && layout["yaxis2"] != nil {
		t.Fatal("CRITERION 3 FAIL: guardrails disabled but layout has a budget panel axis")
	}
	// JSON keys pinned for the enabled case too (MCP and template consumers).
	s2 := gv2EventFixture()
	p2 := gv2Run(t, s2)
	raw, _ := json.Marshal(p2.YearlySummaries[0])
	for _, key := range []string{"guardrail_peak", "guardrail_baseline", "guardrail_cut_trigger", "guardrail_raise_trigger"} {
		if !strings.Contains(string(raw), `"`+key+`"`) {
			t.Fatalf("CRITERION 2 FAIL: enabled guardrails must serialise %s", key)
		}
	}
}
