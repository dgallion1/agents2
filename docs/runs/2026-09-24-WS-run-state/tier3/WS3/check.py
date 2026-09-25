"""WS3 checker (attempt-3 contract, D3'). usage: check.py <obs-dir>
Reads obs-<variant>.json for a-alone, a-to-b, a-to-y, b-to-a, missing."""
import json, os, sys
d = sys.argv[1]
O = {v: json.load(open(os.path.join(d, f"obs-{v}.json"))) for v in ("a-alone", "a-to-b", "a-to-y", "b-to-a", "missing", "a2-alone", "a2-to-y")}
fails = 0
def check(ok, msg):
    global fails
    print(("PASS " if ok else "FAIL ") + msg)
    fails += (not ok)

ctrl = O["a-alone"]
check(ctrl["page_status"] == 200 and ctrl["year_rows"] >= 30 and ctrl["cut_years"], f"[a-alone] control renders with guardrail cuts (status {ctrl['page_status']}, rows {ctrl['year_rows']}, cuts {ctrl['cut_years'][:5]}…)")
for v in ("a-to-b", "a-to-y"):
    o = O[v]
    check(o["page_status"] == 200 and o["results_full_status"] == 200, f"[{v}] GET /whatif and results-full 200 ({o['page_status']}, {o['results_full_status']}; errors {o['page_error_text']})")
    check(o["multipliers"] == ctrl["multipliers"],
          f"[{v}] D3': the viewed scenario's guardrails govern the whole chain — per-year multipliers equal the unchained control "
          f"(diff at years {[y for y in set(o['multipliers']) | set(ctrl['multipliers']) if o['multipliers'].get(y) != ctrl['multipliers'].get(y)][:8]})")
    ch = o.get("chart") or {}
    ys = (ch.get("cut") or []) + (ch.get("raise") or [])
    check(ch.get("status") == 200 and ch.get("cut") and all(isinstance(y, (int, float)) and y > 0 for y in ys),
          f"[{v}] chart trigger lines present and never $0 after the transition (status {ch.get('status')}, cut points {len(ch.get('cut') or [])}, min {min(ys) if ys else None})")
    check(not o["zero_trigger_text"], f"[{v}] no '$0.00' guardrail trigger text on the results page")
    check(o["events"] == ctrl["events"] and o["caption"] == ctrl["caption"],
          f"[{v}] Guardrail Events list and chart caption identical to the unchained control (events equal {o['events'] == ctrl['events']}, caption equal {o['caption'] == ctrl['caption']})")
c2, o2 = O["a2-alone"], O["a2-to-y"]
check(c2["page_status"] == 200 and c2["cut_years"] and c2["events"], f"[a2-alone] control with a binding primary floor renders with events (cuts {c2['cut_years'][:5]}…)")
check(o2["page_status"] == 200 and o2["multipliers"] == c2["multipliers"], f"[a2-to-y] per-year multipliers equal the binding-floor control (diff years {[y for y in set(o2['multipliers']) | set(c2['multipliers']) if o2['multipliers'].get(y) != c2['multipliers'].get(y)][:8]})")
check(o2["events"] == c2["events"], f"[a2-to-y] every guardrail event after the transition uses the PRIMARY's floor — events list identical to the control")
check(o2["caption"] == c2["caption"], f"[a2-to-y] chart caption identical to the control ({(o2['caption'] or '')[:90]!r} vs {(c2['caption'] or '')[:90]!r})")
b = O["b-to-a"]
check(b["page_status"] == 200 and b["results_full_status"] == 200 and b["year_rows"] >= 10, f"[b-to-a] renders (status {b['page_status']}, rows {b['year_rows']})")
check(not b["cut_years"] and not b["raise_years"] and not any(b["multipliers"].values()),
      f"[b-to-a] D3': the viewed scenario has no guardrails → no multiplier in any year, even after the chained step with guardrails (cuts {b['cut_years'][:6]}, raises {b['raise_years'][:6]})")
chb = b.get("chart") or {}
check(chb.get("status") == 200 and not chb.get("cut") and not chb.get("raise"), f"[b-to-a] chart draws no trigger lines (cut {bool(chb.get('cut'))}, raise {bool(chb.get('raise'))})")
m = O["missing"]
check(m["page_has_rate_assumptions"] and m["page_has_chain_form"] and m["page_has_results_container"], f"[missing] D4: failed analysis still renders the inputs column + chain card + results area (status {m['page_status']})")
check("failed to load chained scenario" in m["page_error_text"], f"[missing] D4: failure reason shown ({m['page_error_text']})")
check(m["year_rows"] == 0, f"[missing] D4: no projection figures for a plan that failed to analyse ({m['year_rows']} rows)")
check(m.get("delete_control") is not None and m.get("delete_status") == 200, f"[missing] the chain step's Remove works from the failed page ({m.get('delete_control')} -> {m.get('delete_status')})")
check(m.get("after_delete_page_status") == 200 and m.get("after_delete_chain_links") == 0 and (m.get("after_delete_year_rows") or 0) >= 30,
      f"[missing] after removing the step the plan analyses normally (status {m.get('after_delete_page_status')}, links {m.get('after_delete_chain_links')}, rows {m.get('after_delete_year_rows')})")
print(f"== {'all checks passed' if not fails else str(fails) + ' check(s) failed'}")
sys.exit(1 if fails else 0)
