"""WS2 fixtures: a plan with every schedule kind, fixed-date and current-month variants.
usage: make_fixture.py <out-dir> <fixed|fixed-past|current>"""
import sys, os, datetime
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
from base_plan import base_plan, write_fixture

out, variant = sys.argv[1], sys.argv[2]
p = base_plan()
p["use_current_month"] = variant == "current"
p["start_date"] = {"fixed": "2026-09", "fixed-past": "2026-05",
                   "current": datetime.date.today().strftime("%Y-%m")}[variant]
p["taxable_cost_basis"] = 276000  # on the step=1000 grid: keep WS1's form blocker out of WS2's oracle
p["income_sources"] += [
    {"id": "ws2-i1", "name": "Pension A", "amount": 2000, "income_type": "fixed",
     "start_month": 9, "end_month": 108, "cola_rate": 0, "inflation_adjusted": False},
    {"id": "ws2-i2", "name": "Part-time", "amount": 800, "income_type": "fixed",
     "start_month": 0, "end_month": 2, "cola_rate": 0, "inflation_adjusted": False},
]
p["expense_sources"] = [
    {"id": "ws2-e1", "name": "Car loan", "amount": 900, "start_month": 0, "end_month": 36,
     "inflation": False, "discretionary": False},
    {"id": "ws2-e2", "name": "Travel", "amount": 500, "start_month": 7, "end_month": None,
     "inflation": True, "discretionary": True},
]
p["removed_expense_sources"] = (p.get("removed_expense_sources") or []) + [
    {"id": "ws2-r1", "name": "Old gym", "amount": 60, "start_month": 5, "end_month": 20,
     "inflation": False, "discretionary": False},
]
p["one_time_expenses"] = [
    {"id": "ws2-o1", "description": "Roof", "month": 31, "amount": 20000},
    {"id": "ws2-o2", "description": "Deck", "month": 2, "amount": 5000},
]
p["big_ticket_items"] = [
    {"id": "ws2-b1", "name": "Home sale", "amount": 150000, "month": 45, "type": "income",
     "tax_treatment": "none", "notes": ""},
]
write_fixture(p, out)
