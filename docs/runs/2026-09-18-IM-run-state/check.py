#!/usr/bin/env python3
"""Lead's real-data check for IM2 (SPEC.md 4.2). usage: check.py <worktree> [full|preupload]
Starts serve.sh on a free port, reads the import scan, imports the four
non-identical files with their detected accounts, and prints observations.
Assertions are printed as PASS/FAIL lines; exit 1 on any FAIL."""
import json, os, re, subprocess, sys, time, urllib.request, urllib.parse, socket, html
here = os.path.dirname(os.path.abspath(__file__))
wt = sys.argv[1]; variant = sys.argv[2] if len(sys.argv) > 2 else "preupload"
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
proc = subprocess.Popen([os.path.join(here, "serve.sh"), wt, str(port), variant], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
base = f"http://127.0.0.1:{port}"
fails = 0
def check(name, cond, detail=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + (f": {detail}" if detail else ""))
    fails += (not cond)
def get(path, hx=True):
    req = urllib.request.Request(base + path, headers={"HX-Request": "true"} if hx else {})
    return urllib.request.urlopen(req, timeout=60).read().decode()
def post(path, fields):
    data = urllib.parse.urlencode(fields, doseq=True).encode()
    req = urllib.request.Request(base + path, data=data, headers={"HX-Request": "true", "Content-Type": "application/x-www-form-urlencoded"})
    return urllib.request.urlopen(req, timeout=120).read().decode()
try:
    for _ in range(120):
        try: urllib.request.urlopen(base + "/api/health", timeout=1).read(); break
        except Exception: time.sleep(0.5)
    else: print("server never healthy"); sys.exit(2)
    scan = get("/explorer/import/scan")
    # per-entry blocks: split on <li
    entries = re.findall(r"<li\b.*?</li>", scan, flags=re.S)
    print(f"scan entries: {len(entries)}")
    obs = {}
    for e in entries:
        m = re.search(r'value="([^"]+\.csv)"', e); name = html.unescape(m.group(1)) if m else "?"
        sel = re.search(r'<select[^>]*name="account:[^"]*"[^>]*>(.*?)</select>', e, flags=re.S)
        selected = None
        if sel:
            sm = re.search(r'<option[^>]*value="([^"]*)"[^>]*\bselected\b', sel.group(1)) or re.search(r'<option[^>]*\bselected\b[^>]*value="([^"]*)"', sel.group(1))
            selected = sm.group(1) if sm else "(none)"
        text = html.unescape(re.sub(r"<[^>]+>", " ", e)); text = re.sub(r"\s+", " ", text)
        ident = re.search(r"identical to ([^,)]+\.csv)", text)
        obs[name] = {"selected": selected, "identical_to": ident.group(1).strip() if ident else "", "disabled": bool(re.search(r"<input[^>]*\sdisabled(?=[\s>/])", e)), "text": text[:220]}
        print(f"  {name}: select={selected} identical_to={obs[name]['identical_to']!r} disabled={obs[name]['disabled']}")
    exp_ident = {"bk_download.csv": "usaa-credit_2026-05-01_to_2026-08-12.csv", "bk_download (1).csv": "usaa-checking_2026-05-05_to_2026-08-12.csv", "bk_download (2).csv": "usaa-health_2026-06-11_to_2026-08-11.csv"}
    exp_detect = {"bk_download (3).csv": "usaa-credit-card", "bk_download (4).csv": "usaa-credit-card", "bk_download (5).csv": "usaa-checking", "creditCard24-25.csv": "usaa-credit-card"}
    if variant == "full":
        exp_ident.update({"bk_download (4).csv": "usaa-credit_2026-07-01_to_2026-09-18.csv", "bk_download (5).csv": "usaa-checking_2026-07-06_to_2026-09-14.csv", "creditCard24-25.csv": "usaa-credit_2024-08-02_to_2025-11-18.csv"})
    for n, t in exp_ident.items():
        check(f"scan identical {n}", obs.get(n, {}).get("identical_to") == t and obs.get(n, {}).get("disabled"), str(obs.get(n)))
    for n, a in exp_detect.items():
        if n in exp_ident: continue
        check(f"scan detects {n} -> {a}", obs.get(n, {}).get("selected") == a, str(obs.get(n, {}).get('selected')))
    if variant == "preupload":
        fields = [("name", "bk_download (3).csv"), ("name", "bk_download (4).csv"), ("name", "bk_download (5).csv"), ("name", "creditCard24-25.csv"),
                  ("account:bk_download (3).csv", "usaa-credit-card"), ("account:bk_download (4).csv", "usaa-credit-card"),
                  ("account:bk_download (5).csv", "usaa-checking"), ("account:creditCard24-25.csv", "usaa-credit-card"), ("delete_source", "true")]
        res = post("/explorer/import", fields)
        rtext = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", res)))
        print("import result:", rtext[:900])
        for want in ["usaa-credit-card_2026-07-01_to_2026-08-27.csv", "usaa-credit-card_2026-07-01_to_2026-09-18.csv", "usaa-checking_2026-07-06_to_2026-09-14.csv", "usaa-credit-card_2024-08-02_to_2025-11-18.csv"]:
            check(f"imported as {want}", want in rtext)
        acc = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", get("/accounts", hx=False))))
        m = re.search(r"Unassigned files(.{0,200})", acc)
        check("accounts page: no unassigned files", bool(m) and ".csv" not in m.group(1), (m.group(1)[:120] if m else "section not found"))
        # list_data_files via MCP
        def rpc(method, params, rid, sid=None):
            hdr = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18"}
            if sid: hdr["Mcp-Session-Id"] = sid
            body = {"jsonrpc": "2.0", "method": method, "params": params}
            if rid is not None: body["id"] = rid
            req = urllib.request.Request(base + "/mcp", data=json.dumps(body).encode(), headers=hdr, method="POST")
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode(); sid2 = r.headers.get("Mcp-Session-Id") or sid; ct = r.headers.get("Content-Type", "")
            if not raw.strip(): return None, sid2
            if "event-stream" in ct:
                msgs = [json.loads(l[5:]) for l in raw.splitlines() if l.startswith("data:")]
                return (next((x for x in msgs if x.get("id") == rid), msgs[-1] if msgs else None)), sid2
            return json.loads(raw), sid2
        _, sid = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "im2-check", "version": "0"}}, 1)
        rpc("notifications/initialized", {}, None, sid)
        m2, _ = rpc("tools/call", {"name": "list_data_files", "arguments": {}}, 2, sid)
        r = m2["result"]; files = (r.get("structuredContent") or json.loads(r["content"][0]["text"]))
        names = sorted(f["name"] for f in files["files"])
        print("data files:", names)
        check("list_data_files count 17 (13 + 4 imported)", files["count"] == 17, str(files["count"]))
        check("no browser-named file in data dir", not any(n.startswith("bk_download") or n.startswith("creditCard") for n in names))
    print(f"== {'ALL PASS' if not fails else str(fails) + ' FAIL'}")
finally:
    proc.terminate()
    try: proc.wait(timeout=5)
    except subprocess.TimeoutExpired: proc.kill()
sys.exit(1 if fails else 0)
