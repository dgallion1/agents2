"""Base synthetic what-if plan for WS oracles.

Structure copied from the live plan (2026-09-23) so every card renders, with
names anonymised and bulky optimizer evidence dropped. Oracles import
base_plan() and customise it, then write_fixture() it into a data dir that
contains ONLY settings/ (no transactions are needed by /whatif).
"""
import copy, json, os

LIVE = "/home/darrell/bin/ai/budget2/data/settings/whatif.json"
_cache = None

def base_plan():
    global _cache
    if _cache is None:
        d = json.load(open(LIVE))
        for k in ("applied_spending_evidence",):
            d.pop(k, None)
        names = {"Darrell Gallion": "Alex Primary", "Christine": "Sam Spouse"}
        def scrub(o):
            if isinstance(o, dict):
                return {k: scrub(v) for k, v in o.items()}
            if isinstance(o, list):
                return [scrub(v) for v in o]
            if isinstance(o, str):
                for a, b in names.items():
                    o = o.replace(a, b)
                return o
            return o
        _cache = scrub(d)
    return copy.deepcopy(_cache)

def write_fixture(plan, data_dir, extra_scenarios=None):
    os.makedirs(os.path.join(data_dir, "settings"), exist_ok=True)
    with open(os.path.join(data_dir, "settings", "whatif.json"), "w") as f:
        json.dump(plan, f, indent=2)
    for name, p in (extra_scenarios or {}).items():
        with open(os.path.join(data_dir, "settings", name), "w") as f:
            json.dump(p, f, indent=2)
