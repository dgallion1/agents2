"""WS1 checker. usage: check.py <min-forms> [variant] < probe-json"""
import json, sys
min_forms = int(sys.argv[1])
variant = sys.argv[2] if len(sys.argv) > 2 else "main"
print(f"== variant {variant}")
o = json.load(sys.stdin)
fails = 0
def check(ok, msg):
    global fails
    print(("PASS " if ok else "FAIL ") + msg)
    fails += (not ok)
if "error" in o:
    check(False, "probe error: " + o["error"][:800])
forms = o.get("forms", [])
check(len(forms) >= min_forms, f"coverage: {len(forms)} stored-value forms exercised (need >= {min_forms}, the 643fa54 inventory)")
for f in forms:
    tag = f"{f['tag']} {f['verb']} {f['url']} #{f['nth']}"
    if f.get("missing"):
        check(False, f"{tag}: vanished before it could be submitted"); continue
    if f["tag"] == "FORM":
        check(f.get("valid") is True, f"{tag}: form valid on the off-grid plan (criterion 2) — invalid: {f.get('invalid')}")
    check(f.get("sent") is True and f.get("status") == 200, f"{tag}: untouched submission sent and accepted (sent {f.get('sent')}, status {f.get('status')})")

def diff(a, b, path=""):
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out.append(f"{path}.{k}: {'added' if k not in a else 'removed'} ({b.get(k) if k in b else a.get(k)!r})")
            else:
                out += diff(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(f"{path}: length {len(a)} -> {len(b)}")
        for i, (x, y) in enumerate(zip(a, b)):
            out += diff(x, y, f"{path}[{i}]")
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool):
        if a != b:  # exact: an untouched save must not move a stored float by even 1 ulp (WS1.3)
            out.append(f"{path}: {a!r} -> {b!r}")
    elif a != b:
        out.append(f"{path}: {a!r} -> {b!r}")
    return out
if "s0" in o and "s1" in o:
    d = diff(o["s0"], o["s1"])
    check(not d, f"criterion 1: saved plan identical after every untouched submission ({len(d)} change(s))")
    for line in d[:60]:
        print("      changed " + line)
t = o.get("touched", {})
check(t.get("hc_status") == 200 and t.get("hc_saved") == 1800, f"criterion 3: dragging the healthcare cost slider to 1800 saves 1800 (status {t.get('hc_status')}, saved {t.get('hc_saved')})")
check(t.get("pf_status") == 200 and t.get("pf_saved") == 2500000, f"criterion 3: dragging the portfolio slider to 2,500,000 saves it (status {t.get('pf_status')}, saved {t.get('pf_saved')})")
check(t.get("qa_status") == 200 and t.get("qa_saved") == 1900, f"criterion 3: the Quick Adjust healthcare mirror to 1900 saves 1900 (status {t.get('qa_status')}, saved {t.get('qa_saved')})")
dsp = t.get("display") or {}
disp = dsp.get("display") or ""
try:
    shown = float(disp.replace("$", "").replace(",", ""))
except ValueError:
    shown = None
check(shown is not None and abs(shown - 1655.30) < 0.5 + 1e-9, f"criterion 4: the healthcare cost display shows the saved $1,655.30 (display {disp!r})")
check(bool(dsp.get("aria_valuetext")) and dsp.get("aria_valuetext") == disp, f"criterion 4: the slider's aria-valuetext carries the displayed exact figure (aria-valuetext {dsp.get('aria_valuetext')!r}, display {disp!r})")
e7 = o.get("e7") or {}
sv, lv = e7.get("served") or [], e7.get("live") or []
check(len(sv) > 0 and len(sv) == len(lv), f"E7: served and live Quick Adjust displays found ({len(sv)} vs {len(lv)})")
for (k1, t1), (k2, t2) in zip(sv, lv):
    check(k1 == k2 and t1 == t2, f"E7 (served == live): display {k1} {t1!r} -> {t2!r} after load")
e6 = o.get("e6")
if variant == "main":
    check(bool(e6) and len(e6) >= 5, f"E6: .50-tie fixture values probed ({len(e6 or [])})")
for t in (e6 or []):
    check(t["rawEven"] and t["liveEven"] and not t["rawUp"] and not t["liveUp"],
          f"E6 (one rounding rule): {t['v']} renders as {t['even']} everywhere, never {t['up']} (served: even {t['rawEven']} up {t['rawUp']}; live: even {t['liveEven']} up {t['liveUp']})")
ext = o.get("ext")
check(ext is not None, "extended checks ran (E1-E5)")
if ext:
    e1 = ext.get("e1") or []
    check(len(e1) > 0, f"E1: converted sliders found ({len(e1)})")
    for r in e1:
        ok = bool(r.get("aria")) and (r.get("display") is None or r["aria"] == r["display"])
        check(ok, f"E1 (C4): {r['id'] or r['key']} aria-valuetext equals its display (aria {r.get('aria')!r}, display {r.get('display')!r})")
    check(not ext.get("e2"), f"E2 (D4): no float artifacts shown or announced ({ext.get('e2')[:6]})")
    e3 = ext.get("e3") or []
    for i, g in enumerate(e3):
        check(g.get("qa") == g.get("main"), f"E3 (C5 R1) step {i}: Quick Adjust portfolio slider range follows the select (main {g.get('main')}, qa {g.get('qa')}, select {g.get('sel')})")
    e4 = ext.get("e4") or {}
    check("3.0" in (e4.get("after") or "") and e4.get("after") != e4.get("before"), f"E4 (C5 R2): Quick Adjust investment-return drag updates the display live ({e4.get('before')!r} -> {e4.get('after')!r})")
    e5 = ext.get("e5") or {}
    check(e5.get("after") != e5.get("before") and all(e5.get("after") or []), f"E5 (C5 R3): Quick Adjust portfolio drag updates the per-account amounts live ({e5.get('before')} -> {e5.get('after')} at {e5.get('set')})")
print(f"== {'all checks passed' if not fails else str(fails) + ' check(s) failed'}")
sys.exit(1 if fails else 0)
