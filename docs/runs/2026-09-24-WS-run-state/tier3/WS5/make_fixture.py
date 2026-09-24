"""WS5 fixture: live-shaped plan — leftover disabled glide path {0,0,1}, the
spouse linked from a healthcare entry, plus an UNLINKED third person.
usage: make_fixture.py <out-dir>"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
from base_plan import base_plan, write_fixture
p = base_plan()
p["use_current_month"] = False
p["start_date"] = "2026-09"
p["taxable_cost_basis"] = 276000
p["glide_path"] = {"enabled": False, "start_stock_pct": 0, "end_stock_pct": 0, "transition_years": 1}
assert any(h.get("person_id") == p["persons"][1]["id"] for h in p["healthcare_persons"]), "spouse must be linked"
p["persons"].append({"id": "ws5-unlinked", "name": "Pat Unlinked", "birth_month": "1990-05", "role": "other"})
write_fixture(p, sys.argv[1])
