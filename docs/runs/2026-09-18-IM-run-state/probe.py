#!/usr/bin/env python3
"""IM1 oracle probe: start a throwaway budget2 instance on a copy of the frozen
fixture and dump the observations the oracle asserts on, as JSON to stdout.
usage: probe.py <binary> <workdir-with-web/templates> <fixture-dir>"""
import json, os, shutil, signal, socket, subprocess, sys, tempfile, time, urllib.request

binary, workdir, fixture = sys.argv[1:4]
tmp = tempfile.mkdtemp(prefix="im1-oracle-")
data = os.path.join(tmp, "data"); shutil.copytree(fixture, data)
bak = os.path.join(tmp, "backups"); os.makedirs(bak)
imp = os.path.join(tmp, "import"); os.makedirs(imp)
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
addr = f"127.0.0.1:{port}"
env = dict(os.environ, BUDGET_LISTEN_ADDR=addr, BUDGET_DATA_DIR=data,
           BUDGET2_BACKUP_DIR=bak, BUDGET2_IMPORT_DIR=imp)
log = open(os.path.join(tmp, "server.log"), "w")
proc = subprocess.Popen([binary], cwd=workdir, env=env, stdout=log, stderr=subprocess.STDOUT)
base = f"http://{addr}"

def stop():
    if proc.poll() is None:
        proc.send_signal(signal.SIGTERM)
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired: proc.kill(); proc.wait()

try:
    for _ in range(100):
        try:
            urllib.request.urlopen(base + "/api/health", timeout=1).read(); break
        except Exception:
            if proc.poll() is not None:
                sys.stderr.write(open(os.path.join(tmp, "server.log")).read()); sys.exit(2)
            time.sleep(0.3)
    else:
        sys.stderr.write("server never became healthy\n"); sys.exit(2)

    session = {}
    def rpc(method, params=None, rid=None, expect_body=True):
        body = {"jsonrpc": "2.0", "method": method}
        if rid is not None: body["id"] = rid
        if params is not None: body["params"] = params
        hdr = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
               "MCP-Protocol-Version": "2025-06-18"}
        if session.get("id"): hdr["Mcp-Session-Id"] = session["id"]
        req = urllib.request.Request(base + "/mcp", data=json.dumps(body).encode(), headers=hdr, method="POST")
        with urllib.request.urlopen(req, timeout=60) as r:
            sid = r.headers.get("Mcp-Session-Id")
            if sid: session["id"] = sid
            raw = r.read().decode()
            ctype = r.headers.get("Content-Type", "")
        if not expect_body: return None
        if "text/event-stream" in ctype:
            msgs = [json.loads(l[5:].strip()) for l in raw.splitlines() if l.startswith("data:")]
            for m in msgs:
                if m.get("id") == rid: return m
            return msgs[-1] if msgs else None
        return json.loads(raw)

    rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                       "clientInfo": {"name": "im1-oracle", "version": "0"}}, rid=1)
    rpc("notifications/initialized", {}, expect_body=False)
    n = [1]
    def call(tool, **args):
        n[0] += 1
        m = rpc("tools/call", {"name": tool, "arguments": args}, rid=n[0])
        res = m["result"]
        if res.get("isError"): raise SystemExit(f"tool {tool} error: {res}")
        if "structuredContent" in res: return res["structuredContent"]
        return json.loads(res["content"][0]["text"])

    def rows(r): return sorted((t["date"], round(t["amount"], 2)) for t in r["transactions"])
    obs = {}
    a = call("search_transactions", start_date="2026-08-01", end_date="2026-08-31", type="outflow", per_page=200)
    obs["aug_outflow_sum"] = round(a["sum_amount"], 2); obs["aug_outflow_total"] = a["total"]
    ar = rows(a)
    for k, v in {"chick_pending_36_86": ("2026-08-12", -36.86), "chick_posted_41_98": ("2026-08-12", -41.98),
                 "roam_pending_89_08": ("2026-08-10", -89.08), "roam_posted_104_08": ("2026-08-11", -104.08)}.items():
        obs[k] = v in ar
    s6 = call("search_transactions", start_date="2026-09-16", end_date="2026-09-18", per_page=200)
    live = {("2026-09-18", -218.72), ("2026-09-17", -7.0), ("2026-09-17", -56.44), ("2026-09-17", -26.99),
            ("2026-09-17", -133.0), ("2026-09-16", -44.63)}
    obs["sep_live_present"] = sorted(live & set(rows(s6))); obs["sep_live_count"] = len(live & set(rows(s6)))
    obs["nov16_54_98"] = ("2025-11-16", -54.98) in rows(call("search_transactions", start_date="2025-11-16", end_date="2025-11-16", per_page=200))
    obs["dec29_38_73"] = ("2025-12-29", -38.73) in rows(call("search_transactions", start_date="2025-12-29", end_date="2025-12-29", per_page=200))
    m = call("search_transactions", start_date="2026-03-15", end_date="2026-03-18", per_page=200)
    obs["mar_sum"] = round(m["sum_amount"], 2); mr = rows(m)
    obs["mar_22_17_neg"] = ("2026-03-18", 22.17) in mr or ("2026-03-18", -22.17) in mr
    obs["mar_22_17_pos"] = ("2026-03-15", -22.17) in mr or ("2026-03-15", 22.17) in mr
    obs["mar_total"] = m["total"]
    d = call("list_duplicates"); obs["dup_unresolved"] = d["unresolved_count"]; obs["dup_resolved"] = d["resolved_count"]
    t = call("get_transfers", start_date="2026-09-01", end_date="2026-09-18")
    legs = [x for x in t["transfers"] if abs(abs(x["amount"]) - 8448.62) < 0.005]
    obs["transfer_8448_legs"] = sorted((x["account_id"], x["class"], x.get("pair_key", "")) for x in legs)
    acc = call("get_accounts"); obs["balances"] = {x["id"]: round(x["balance"], 2) for x in acc["accounts"]}
    me = call("list_major_expenses"); byname = {e["name"]: e for e in me["expenses"]}
    for nm, key in [("Christine", "christine"), ("Eating out — restaurants & fast food", "eating_out"),
                    ("Amazon", "amazon"), ("Groceries", "groceries"), ("Ignore", "ignore")]:
        obs[key + "_total"] = round(byname[nm]["total"], 2); obs[key + "_count"] = byname[nm]["count"]
    obs["unmatched_count"] = me["unmatched_count"]
    f = call("list_data_files"); obs["files_count"] = f["count"]; obs["files_raw_rows"] = sum(x["transactions"] for x in f["files"])
    allr = call("search_transactions", per_page=1); obs["all_total"] = allr["total"]
    j = call("get_transfers", start_date="2026-07-13", end_date="2026-07-13")
    obs["jul13_1495_legs"] = len([x for x in j["transfers"] if abs(abs(x["amount"]) - 14.95) < 0.005])
    cy = rows(call("search_transactions", start_date="2025-12-30", end_date="2025-12-30", per_page=200))
    obs["cybernet_1230_count"] = cy.count(("2025-12-30", -28.42))
    ch = rows(call("search_transactions", start_date="2026-04-29", end_date="2026-04-29", per_page=200))
    obs["chateau_0429_count"] = ch.count(("2026-04-29", -35.63))
    fg = call("search_transactions", search="Five Guys via Grubhub", per_page=200)
    obs["fiveguys_grubhub_rows"] = sorted((t["date"], round(t["amount"], 2), t["description"]) for t in fg["transactions"])
    obs["delivery_count"] = byname["Eating out — delivery (Grubhub)"]["count"]
    obs["delivery_total"] = round(byname["Eating out — delivery (Grubhub)"]["total"], 2)
    ex = call("list_exceptions", bucket="unmatched", limit=200)
    obs["unmatched_rows"] = sorted((t["date"], round(t["amount"], 2), t["description"]) for t in ex["unmatched"]["rows"])
    print(json.dumps(obs, indent=1, sort_keys=True))
finally:
    stop(); log.close()
    shutil.rmtree(tmp, ignore_errors=True)
