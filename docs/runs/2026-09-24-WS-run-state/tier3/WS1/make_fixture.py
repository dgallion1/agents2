"""WS1 fixture: every stored numeric field that /whatif renders as an input is
off its input's step grid, fractional where the template rounds, or above the
old slider max. usage: make_fixture.py <out-dir>"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
from base_plan import base_plan, write_fixture

p = base_plan()
p["use_current_month"] = False
p["start_date"] = "2026-09"
p.update({
    "portfolio_value": 2437512.50,          # range step 100000; exact .50 tie (half-even 2437512 vs half-up 2437513)
    "monthly_living_expenses": 10736.50,    # hidden-input pattern since W2; .50 tie (half-even 10736 vs half-up 10737)
    "monthly_property_tax": 666.67,         # number step 1, %.0f
    "property_tax_inflation": 2.25,         # %.1f
    "tax_deferred_percent": 83.037,         # %.0f step 1
    "roth_percent": 0.5,
    "tax_deferred_stock_percent": 70.5, "tax_deferred_cash_percent": 2.25,
    "roth_stock_percent": 60.5, "roth_cash_percent": 1.5,
    "taxable_stock_percent": 99.5, "taxable_cash_percent": 0.5,
    "taxable_dividend_yield": 0.45, "taxable_qualified_dividend_percent": 95.5,
    "taxable_cap_gains_distribution_rate": 1.25,
    "taxable_cost_basis": 232777.48988888797,  # off the step-1000 grid (blocks the form on base) AND
                                            # needs 17 significant digits: 'g',15 re-rounds it (WS1.3 R-EXACT)
    "inflation_rate": 3.85, "spending_decline_rate": 0.3, "investment_return": 6.25,
})
p["tax_config"]["state_income_tax_rate"] = 5.525   # step 0.05
p["aca"]["annual_premium_tax_credit"] = 10850       # step 100
p["guardrails"].update({"floor_drop_pct": 5.5, "floor_cut_pct": 10.25, "ceiling_rise_pct": 10.5,
                        "ceiling_raise_pct": 2.5, "min_spending_pct": 0.5, "max_spending_pct": 120.5,
                        "min_monthly_spending_real": 6000.55})
p["roth_conversion"]["annual_amount"] = 388354.59  # math.Round(v*1e10)/1e10 -> 388354.5900000001 (WS1.2 C7)
# cola_rate_set: F-026 bookkeeping the SS form sets on any explicit submit;
# a plan whose user already set COLA carries it, so identity is meaningful.
p["social_security"].update({"fra_benefit": 4114.9, "spouse_fra_benefit": 1905.55, "cola_rate": 0.0145,  # 1.45 %: off the old %.1f grid AND x100 = 1.4500000000000002 (float-artifact probe)
                            
                             "cola_rate_set": True})
p["spending_phase_config"]["phases"][0]["multiplier"] = 1.015  # no whole-valued float fields left
p["spending_phase_config"]["phases"][1]["multiplier"] = 0.93   # range step 0.05
p["spending_phase_config"]["phases"][2]["multiplier"] = 0.815
p["glide_path"] = {"enabled": True, "start_stock_pct": 70.5, "end_stock_pct": 40.25, "transition_years": 10}
p["income_sources"][0]["amount"] = 1400.55
p["expense_sources"] = [{"id": "ws1-e1", "name": "Utilities", "amount": 612.34, "start_month": 0,
                         "end_month": None, "inflation": True, "discretionary": False}]
hp0, hp1 = p["healthcare_persons"]
assert hp0["current_coverage"] == "medicare" and hp1["current_coverage"] == "aca"
hp0.update({"current_monthly_cost": 612.50, "post_medicare_inflation": 4.35, "medicare_monthly_cost": 550.25,
            "care_start_age": 85, "care_monthly_cost": 4321})
hp1.update({"current_monthly_cost": 1655.30, "pre_medicare_inflation": 7.25,
            "medicare_monthly_cost": 2150.50, "post_medicare_inflation": 4.15})  # > old max 2000 AND a .50 tie
# Employer-coverage branch (aca_cost_after_employer, employer_coverage_years sliders),
# never rendered by the v1/v2 fixture (WS1.1 checker-second).
p["healthcare_persons"].append({
    "id": "ws1-hp-employer", "name": "Pat Employer", "current_age": 60,  # no person_id: manual entry (omitempty)
    "current_coverage": "employer", "current_monthly_cost": 433.33, "pre_medicare_inflation": 6.75,
    "medicare_monthly_cost": 700.25, "post_medicare_inflation": 4.15, "medicare_eligible_age": 65,
    "birth_month": "1966-03", "employer_coverage_years": 3, "aca_cost_after_employer": 3450.50})
# Variant "exact" (oracle v5, WS1.3 checker-tests): values that expose
# re-rounding and exponent output. Same forms as "main"; no .50 ties needed.
if len(sys.argv) > 2 and sys.argv[2] == "exact":
    p.update({
        "monthly_living_expenses": 10736.504,          # hidden input rendered %.2f loses $0.004
        "tax_deferred_percent": 83.03712345678912,     # 16-17 significant digits
        "taxable_dividend_yield": 0.00005,             # 'g' formatting -> "5e-05"
        "investment_return": 0,                        # allocation branch: "(~X% expected)" must not be recomputed at load
        # zero allocation fields (as on the live plan): the client-side
        # calculateExpectedReturnFromAllocation treated 0 as missing via
        # `|| 10` / `|| 60` fallbacks -> "(~6.1% expected)" vs the server's
        # figure on a drag back to 0 (WS1.4 primary O1; oracle v6 E8)
        "roth_percent": 0, "roth_stock_percent": 0, "roth_cash_percent": 0, "taxable_cash_percent": 0,
    })
    p["guardrails"]["min_monthly_spending_real"] = 6000.555   # step 0.01 -> blocks the guardrails form
    p["social_security"]["cola_rate"] = 0.0145               # scaled: must round-trip exactly
write_fixture(p, sys.argv[1])
