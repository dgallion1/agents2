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
    "portfolio_value": 2437512.34,          # range step 100000
    "monthly_living_expenses": 10737.45,    # control: already on the hidden-input pattern
    "monthly_property_tax": 666.67,         # number step 1, %.0f
    "property_tax_inflation": 2.25,         # %.1f
    "tax_deferred_percent": 83.037,         # %.0f step 1
    "roth_percent": 0.5,
    "tax_deferred_stock_percent": 70.5, "tax_deferred_cash_percent": 2.25,
    "roth_stock_percent": 60.5, "roth_cash_percent": 1.5,
    "taxable_stock_percent": 99.5, "taxable_cash_percent": 0.5,
    "taxable_dividend_yield": 0.45, "taxable_qualified_dividend_percent": 95.5,
    "taxable_cap_gains_distribution_rate": 1.25,
    "taxable_cost_basis": 276146.86,        # LIVE value; step 1000 blocks the form
    "inflation_rate": 3.85, "spending_decline_rate": 0.3, "investment_return": 6.25,
})
p["tax_config"]["state_income_tax_rate"] = 5.525   # step 0.05
p["aca"]["annual_premium_tax_credit"] = 10850       # step 100
p["guardrails"].update({"floor_drop_pct": 5.5, "floor_cut_pct": 10.25, "ceiling_rise_pct": 10.5,
                        "ceiling_raise_pct": 2.5, "min_spending_pct": 0.5, "max_spending_pct": 120.5,
                        "min_monthly_spending_real": 6000.55})
p["roth_conversion"]["annual_amount"] = 50000.5
# cola_rate_set: F-026 bookkeeping the SS form sets on any explicit submit;
# a plan whose user already set COLA carries it, so identity is meaningful.
p["social_security"].update({"fra_benefit": 4114.9, "spouse_fra_benefit": 1905.55, "cola_rate": 0.0145,  # 1.45 %: off the old %.1f grid AND x100 = 1.4500000000000002 (float-artifact probe)
                            
                             "cola_rate_set": True})
p["spending_phase_config"]["phases"][1]["multiplier"] = 0.93   # range step 0.05
p["income_sources"][0]["amount"] = 1400.55
p["expense_sources"] = [{"id": "ws1-e1", "name": "Utilities", "amount": 612.34, "start_month": 0,
                         "end_month": None, "inflation": True, "discretionary": False}]
hp0, hp1 = p["healthcare_persons"]
assert hp0["current_coverage"] == "medicare" and hp1["current_coverage"] == "aca"
hp0.update({"current_monthly_cost": 612.40, "post_medicare_inflation": 4.35,
            "care_start_age": 85, "care_monthly_cost": 4321})
hp1.update({"current_monthly_cost": 1655.30, "pre_medicare_inflation": 7.25,
            "medicare_monthly_cost": 2150, "post_medicare_inflation": 4.15})
write_fixture(p, sys.argv[1])
