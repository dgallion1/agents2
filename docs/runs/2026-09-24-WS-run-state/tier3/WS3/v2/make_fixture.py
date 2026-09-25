"""WS3 fixtures (attempt-3 contract, D3': the VIEWED scenario's guardrail
setting governs the whole chain; chained steps' own guardrail settings are
ignored). usage: make_fixture.py <out-dir> <variant>
a-alone : guardrails on, no chain (control)
a-to-b  : guardrails on, chains at 80 into whatif_b.json (no guardrails)
a-to-y  : guardrails on, chains at 80 into whatif_y.json (guardrails on, very different config)
b-to-a  : no guardrails, chains at 70 into whatif_a.json (guardrails on)
missing : chains at 75 into whatif_missing.json, which does not exist"""
import sys, os, copy
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
from base_plan import base_plan, write_fixture

out, variant = sys.argv[1], sys.argv[2]
with_g = base_plan()
with_g["use_current_month"] = False
with_g["start_date"] = "2026-09"
with_g["taxable_cost_basis"] = 276000
assert with_g.get("guardrails", {}).get("enabled"), "base plan must have guardrails enabled"
without_g = copy.deepcopy(with_g); without_g.pop("guardrails", None)
other_g = copy.deepcopy(with_g)
other_g["guardrails"].update({"floor_drop_pct": 2, "floor_cut_pct": 30, "ceiling_rise_pct": 50,
                              "ceiling_raise_pct": 1, "min_monthly_spending_real": 3000})

if variant == "a-alone":
    write_fixture(with_g, out)
elif variant == "a-to-b":
    write_fixture(dict(with_g, scenario_chain=[{"scenario_filename": "whatif_b.json", "transition_age": 80}]), out, {"whatif_b.json": without_g})
elif variant == "a-to-y":
    write_fixture(dict(with_g, scenario_chain=[{"scenario_filename": "whatif_y.json", "transition_age": 80}]), out, {"whatif_y.json": other_g})
elif variant == "b-to-a":
    write_fixture(dict(without_g, scenario_chain=[{"scenario_filename": "whatif_a.json", "transition_age": 70}]), out, {"whatif_a.json": with_g})
elif variant == "missing":
    write_fixture(dict(with_g, scenario_chain=[{"scenario_filename": "whatif_missing.json", "transition_age": 75}]), out)
else:
    sys.exit("unknown variant " + variant)
