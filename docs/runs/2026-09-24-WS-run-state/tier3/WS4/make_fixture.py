"""WS4 fixture: the base plan, fixed start 2026-09, on-grid cost basis (keeps
WS1's form blocker out of WS4's oracle). usage: make_fixture.py <out-dir>"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
from base_plan import base_plan, write_fixture
p = base_plan()
p["use_current_month"] = False
p["start_date"] = "2026-09"
p["taxable_cost_basis"] = 276000
p["tax_config"]["state_income_tax_rate"] = 5.5
write_fixture(p, sys.argv[1])
