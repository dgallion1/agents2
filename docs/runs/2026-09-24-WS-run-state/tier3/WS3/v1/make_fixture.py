"""WS3 fixtures. usage: make_fixture.py <out-dir> <a-to-b|b-to-a|missing>
a-to-b : active plan has guardrails, chains at age 80 into whatif_b.json (no guardrails)
b-to-a : active plan has no guardrails, chains at age 70 into whatif_a.json (guardrails on)
missing: active plan chains at age 75 into whatif_missing.json, which does not exist"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
from base_plan import base_plan, write_fixture

out, variant = sys.argv[1], sys.argv[2]
with_g = base_plan()
with_g["use_current_month"] = False
with_g["start_date"] = "2026-09"
with_g["taxable_cost_basis"] = 276000
without_g = dict(with_g)
without_g.pop("guardrails", None)
assert with_g.get("guardrails", {}).get("enabled"), "base plan must have guardrails enabled"

if variant == "a-to-b":
    active = dict(with_g, scenario_chain=[{"scenario_filename": "whatif_b.json", "transition_age": 80}])
    write_fixture(active, out, {"whatif_b.json": without_g})
elif variant == "b-to-a":
    active = dict(without_g, scenario_chain=[{"scenario_filename": "whatif_a.json", "transition_age": 70}])
    write_fixture(active, out, {"whatif_a.json": with_g})
elif variant == "missing":
    active = dict(with_g, scenario_chain=[{"scenario_filename": "whatif_missing.json", "transition_age": 75}])
    write_fixture(active, out)
else:
    sys.exit("unknown variant " + variant)
