"""WS3 checker. usage: check.py < probe-json  (variant read from the JSON)"""
import json, sys
o = json.load(sys.stdin)
v = o["variant"]
fails = 0
def check(ok, msg):
    global fails
    print(("PASS " if ok else "FAIL ") + f"[{v}] {msg}")
    fails += (not ok)

if v == "a-to-b":
    # guardrails on (cuts from year 10 in the unchained control) -> step without guardrails at age 80 (year 13)
    check(o["page_status"] == 200, f"GET /whatif 200 (got {o['page_status']}, errors {o['page_error_text']})")
    check(o["results_full_status"] == 200 and o["year_rows"] >= 14, f"Year-by-Year renders (results-full {o['results_full_status']}, {o['year_rows']} rows)")
    check(any(10 <= y <= 12 for y in o["cut_years"]), f"guardrail cuts still act BEFORE the transition (cut years {o['cut_years']})")
    late = [y for y in o["cut_years"] + o["raise_years"] if y >= 14]
    check(not late, f"no guardrail multiplier after the transition into the guardrail-less step (D3: multiplier 1.0) — offending years {late}")
elif v == "b-to-a":
    # no guardrails -> step with guardrails at age 70 (year 3)
    check(o["page_status"] == 200, f"GET /whatif 200 (got {o['page_status']})")
    check(o["results_full_status"] == 200 and o["year_rows"] >= 10, f"Year-by-Year renders (results-full {o['results_full_status']}, {o['year_rows']} rows)")
    early = [y for y in o["cut_years"] + o["raise_years"] if y <= 3]
    check(not early, f"no guardrail multiplier before/at the transition — offending years {early}")
    check(any(y >= 4 for y in o["cut_years"]), f"guardrails start acting after the transition into the guardrail step (D3) — cut years {o['cut_years']}")
elif v == "missing":
    check(o["page_has_rate_assumptions"] and o["page_has_chain_form"] and o["page_has_results_container"],
          f"D4: failed analysis still renders the inputs column + Scenario Chain card + results area (rate {o['page_has_rate_assumptions']}, chain {o['page_has_chain_form']}, results {o['page_has_results_container']}; status {o['page_status']})")
    check("failed to load chained scenario" in o["page_error_text"], f"D4: the failure reason is shown on the page (found {o['page_error_text']})")
    check(o["year_rows"] == 0, f"D4: no projection figures are shown for a plan that failed to analyse ({o['year_rows']} year rows)")
    check(o.get("delete_control") is not None and o.get("delete_status") == 200, f"the chain step's own Remove control works from the failed page ({o.get('delete_control')} -> {o.get('delete_status')})")
    check(o.get("after_delete_page_status") == 200 and o.get("after_delete_chain_links") == 0 and (o.get("after_delete_year_rows") or 0) >= 30,
          f"after removing the step the plan analyses normally (status {o.get('after_delete_page_status')}, links {o.get('after_delete_chain_links')}, rows {o.get('after_delete_year_rows')})")
else:
    check(False, "unknown variant")
print(f"== [{v}] {'all checks passed' if not fails else str(fails) + ' check(s) failed'}")
sys.exit(1 if fails else 0)
