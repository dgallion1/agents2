package whatif

// GV1 acceptance oracle (lead-authored, immutable during the run).
// Injected into package whatif via go test -overlay; never committed to
// the app repo. Claim under test: the optimizer SEARCH handler simulates
// with the same engine hooks as the rest of the page, so its "Current
// guardrails" baseline row reproduces a direct Monte Carlo run with
// retirement.DefaultHooks() exactly, per-run seed for per-run seed.

import (
	"math"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"budget2/internal/models"
	"budget2/internal/services/retirement"
	"budget2/internal/services/retirement/analysis"
	"budget2/internal/services/retirement/engine"
)

// gv1Fixture is a plan where Social Security is the difference between
// surviving and depleting: a small portfolio, living expenses that the
// portfolio alone cannot carry for the horizon, and an SS-optimizer
// benefit already being claimed.
func gv1Fixture(t *testing.T, rm *retirement.SettingsManager) *models.WhatIfSettings {
	t.Helper()
	s, err := rm.Load()
	if err != nil {
		t.Fatal(err)
	}
	s.PortfolioValue = 60000
	s.MonthlyLivingExpenses = 4000
	s.MonthlyHealthcare = 0
	s.MonthlyPropertyTax = 0
	s.ProjectionYears = 4
	s.SpendingPhaseConfig = &models.SpendingPhaseConfig{Enabled: false}
	s.Guardrails = &models.GuardrailConfig{Enabled: true, FloorDropPct: 20, FloorCutPct: 10, CeilingRisePct: 20, CeilingRaisePct: 10, MinSpendingPct: 75, MaxSpendingPct: 120}
	s.SocialSecurity = &models.SocialSecurityConfig{FRABenefit: 3500, FRA: 67, ClaimAge: 65}
	if err := rm.Save(s); err != nil {
		t.Fatal(err)
	}
	loaded, err := rm.Load()
	if err != nil {
		t.Fatal(err)
	}
	if !retirement.SocialSecurityProjectionActive(loaded) {
		t.Fatal("fixture defect: SS projection is not active")
	}
	return loaded
}

func gv1DepletionCount(t *testing.T, s *models.WhatIfSettings, hooks engine.Hooks, runs int, seed int64) int {
	t.Helper()
	in, _, err := buildEngineInput(s)
	if err != nil {
		t.Fatal(err)
	}
	in.Hooks = hooks
	_, rows := analysis.MonteCarloWithResults(getEngine(), in, runs, seed)
	n := 0
	for _, r := range rows.Runs {
		if !r.Survives {
			n++
		}
	}
	return n
}

func TestGV1OracleSearchUsesPlanHooks(t *testing.T) {
	rm, cleanup := setupTestEnv(t)
	defer cleanup()
	s := gv1Fixture(t, rm)

	const id = "gv1-oracle-request"
	form := url.Values{"floor_monthly_real": {"3000"}, "target_success_pct": {"50"}, "request_id": {id}}
	req := httptest.NewRequest("POST", "/whatif/guardrails/optimize", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	handleGuardrailOptimizer(w, req)
	if w.Code != 200 {
		t.Fatalf("optimizer status %d: %s", w.Code, w.Body.String())
	}

	guardrailPreviews.Lock()
	p := guardrailPreviews.entries[id]
	guardrailPreviews.Unlock()
	if p == nil {
		t.Fatal("no retained preview for the request")
	}
	var current *models.GuardrailOptimizerCandidate
	for _, c := range p.graphs {
		if c.ID == "current" {
			cc := c
			current = &cc
		}
	}
	if current == nil {
		t.Fatal("no 'current' baseline candidate retained")
	}
	if current.Metrics.Runs != p.validationRuns {
		t.Fatalf("baseline metrics runs %d != validation runs %d", current.Metrics.Runs, p.validationRuns)
	}

	withHooks := gv1DepletionCount(t, s, retirement.DefaultHooks(), p.validationRuns, p.validationSeed)
	noHooks := gv1DepletionCount(t, s, engine.Hooks{}, p.validationRuns, p.validationSeed)
	t.Logf("validation runs=%d seed=%d; optimizer current-row depletion=%d; direct MC with hooks=%d; without hooks=%d",
		p.validationRuns, p.validationSeed, current.Metrics.DepletionPaths, withHooks, noHooks)
	if withHooks == noHooks {
		t.Fatal("fixture defect: hooks make no difference on this plan, the oracle cannot discriminate")
	}
	if withHooks >= p.validationRuns/2 {
		t.Fatalf("fixture defect: even with Social Security %d/%d runs deplete", withHooks, p.validationRuns)
	}
	if current.Metrics.DepletionPaths != withHooks {
		t.Fatalf("CRITERION 2 FAIL: optimizer 'Current guardrails' depletion paths = %d, direct Monte Carlo with the plan's hooks = %d (without hooks = %d). The search is not simulating with the plan's engine hooks.",
			current.Metrics.DepletionPaths, withHooks, noHooks)
	}
	if math.Abs(current.Metrics.DepletionRiskPct-float64(withHooks)/float64(p.validationRuns)*100) > 1e-9 {
		t.Fatalf("CRITERION 2 FAIL: DepletionRiskPct %.4f is not %d/%d*100", current.Metrics.DepletionRiskPct, withHooks, p.validationRuns)
	}
}

// Criterion 3: every retained candidate — grid alternatives and both
// baselines — was simulated with the plan's hooks. For each candidate,
// clone the plan with exactly that candidate's guardrail config (the same
// clone rule the graph endpoint uses) and reproduce its depletion count
// with a direct hooked Monte Carlo on the validation seed.
func TestGV1OracleEveryCandidateUsesPlanHooks(t *testing.T) {
	rm, cleanup := setupTestEnv(t)
	defer cleanup()
	s := gv1Fixture(t, rm)

	const id = "gv1-oracle-candidates"
	form := url.Values{"floor_monthly_real": {"3000"}, "target_success_pct": {"50"}, "request_id": {id}}
	req := httptest.NewRequest("POST", "/whatif/guardrails/optimize", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	handleGuardrailOptimizer(w, req)
	if w.Code != 200 {
		t.Fatalf("optimizer status %d: %s", w.Code, w.Body.String())
	}
	guardrailPreviews.Lock()
	p := guardrailPreviews.entries[id]
	guardrailPreviews.Unlock()
	if p == nil {
		t.Fatal("no retained preview")
	}
	seen := map[string]bool{}
	for _, c := range p.graphs {
		clone := *s
		clone.Guardrails = nil
		if c.Guardrails != nil {
			cfg := *c.Guardrails
			clone.Guardrails = &cfg
		}
		withHooks := gv1DepletionCount(t, &clone, retirement.DefaultHooks(), p.validationRuns, p.validationSeed)
		t.Logf("candidate %s baseline=%v: optimizer depletion=%d hooked direct=%d", c.ID, c.Baseline, c.Metrics.DepletionPaths, withHooks)
		if c.Metrics.DepletionPaths != withHooks {
			t.Fatalf("CRITERION 3 FAIL: candidate %s depletion %d != hooked direct run %d", c.ID, c.Metrics.DepletionPaths, withHooks)
		}
		seen[c.ID] = true
	}
	if !seen["current"] || !seen["no-guardrails"] {
		t.Fatalf("both baselines must be retained, saw %v", seen)
	}
}
