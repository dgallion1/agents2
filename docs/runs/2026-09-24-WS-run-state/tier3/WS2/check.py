"""WS2 checker. usage: check.py <scenario-label> <expect: shift|same>  < probe-json
shift: saved offsets == rollover rule applied with delta = months(before.start -> after.start),
       every non-clamped item renders the same calendar month, a one-time/big-ticket item that
       falls before the new start renders its old month + " (past)".
same:  start date and every saved offset unchanged.
Prints PASS/FAIL lines; exit 1 on any FAIL."""
import json, sys
label, expect = sys.argv[1], sys.argv[2]
o = json.load(sys.stdin)
fails = 0
def check(ok, msg):
    global fails
    print(("PASS " if ok else "FAIL ") + f"[{label}] {msg}")
    fails += (not ok)

if "error" in o:
    check(False, f"probe error: {o['error']}")
    sys.exit(1)
check(o.get("form_valid_before") is True, f"harness precondition: Rate Assumptions form valid before the action (got {o.get('form_valid_before')})")
check(o.get("post_status") == 200, f"POST /whatif/settings status 200 (got {o.get('post_status')}; body {o.get('post_body_head','')[:120]!r})")
b, a = o["before"], o["after"]
def months(s):
    y, m = map(int, s.split("-")); return y * 12 + m - 1
delta = months(a["saved"]["start_date"]) - months(b["saved"]["start_date"])

if expect == "same":
    check(delta == 0, f"start date unchanged ({b['saved']['start_date']} -> {a['saved']['start_date']})")
    for k in ("income", "expense", "removed_expense", "removed_income", "onetime", "bigticket"):
        check(a["saved"][k] == b["saved"][k], f"saved {k} offsets unchanged")
else:
    check(delta != 0, f"start date moved ({b['saved']['start_date']} -> {a['saved']['start_date']}, delta {delta})")
    def shift_range(r):
        s, e = r
        return [max(0, s - delta), None if e is None else max(0, e - delta)]
    for k in ("income", "expense", "removed_expense", "removed_income"):
        exp = {i: shift_range(r) for i, r in b["saved"][k].items()}
        check(a["saved"][k] == exp, f"saved {k} offsets follow the rollover rule: expected {exp} got {a['saved'][k]}")
    for k in ("onetime", "bigticket"):
        exp = {i: m - delta for i, m in b["saved"][k].items()}
        check(a["saved"][k] == exp, f"saved {k} months shifted by -{delta}: expected {exp} got {a['saved'][k]}")
    br, ar = b["rendered"], a["rendered"]
    # Rendered calendar months: every income/expense bound that was not
    # clamped by the rollover rule must render exactly the same month.
    for key, savedkey, idx in (("income_start", "income", 0), ("income_end", "income", 1),
                               ("expense_start", "expense", 0), ("expense_end", "expense", 1)):
        for i, r in b["saved"][savedkey].items():
            v = r[idx]
            if v is None:
                check(ar[key].get(i) == br[key].get(i), f"{key} {i}: blank stays blank ({br[key].get(i)!r} -> {ar[key].get(i)!r})")
            elif v - delta >= (1 if idx == 1 else 0):
                check(ar[key].get(i) == br[key].get(i), f"{key} {i}: same calendar month ({br[key].get(i)} -> {ar[key].get(i)})")
    # One-time / big-ticket: same calendar month always; " (past)" exactly
    # when the item now falls before the plan start.
    for kind in ("onetime", "bigticket"):
        for i, m in b["saved"][kind].items():
            name = b["saved"][kind + "_names"][i]
            bl, al = br[kind].get(name), ar[kind].get(name)
            base = lambda x: (x or "").replace(" (past)", "")
            check(bl is not None and base(al) == base(bl), f"{kind} {name!r}: same calendar month ({bl} -> {al})")
            want_past = (m - delta) < 0
            check((al or "").endswith(" (past)") == want_past, f"{kind} {name!r}: '(past)' shown iff before the new start (month {m - delta}, label {al!r})")
print(f"== [{label}] {'all checks passed' if not fails else str(fails) + ' check(s) failed'}")
sys.exit(1 if fails else 0)
