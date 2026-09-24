"""WS1 checker. usage: check.py <min-forms> < probe-json"""
import json, sys
min_forms = int(sys.argv[1])
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
        if abs(a - b) > 1e-9:
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
print(f"== {'all checks passed' if not fails else str(fails) + ' check(s) failed'}")
sys.exit(1 if fails else 0)
