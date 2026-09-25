"""WS3 probe. usage: probe.py <base-url> <variant>  -> JSON observations on stdout.
HTTP only (the same GETs/DELETE the page issues)."""
import json, re, sys, urllib.request, urllib.error, html

base, variant = sys.argv[1], sys.argv[2]

def req(method, path):
    r = urllib.request.Request(base + path, method=method, headers={"HX-Request": "true"} if method != "GET" else {})
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")

def results_body(page):
    m = re.search(r'hx-get="(/whatif/results-full\?hash=[^"]+)"', page)
    if not m:
        return None, page
    st, body = req("GET", html.unescape(m.group(1)))
    return st, body

def guardrail_rows(body):
    rows = {}
    for m in re.finditer(r'<tr title="([^"]*)"[^>]*>\s*<td[^>]*>\s*(\d+)\s*</td>', body):
        rows[int(m.group(2))] = m.group(1)
    return rows

def year_multipliers(body):
    # Per Year-by-Year row: the "×0.90" guardrail multiplier text, or None.
    out = {}
    parts = re.split(r'(?=<tr title=")', body)
    for p in parts:
        m = re.match(r'<tr title="[^"]*"[^>]*>\s*<td[^>]*>\s*(\d+)\s*</td>', p)
        if not m:
            continue
        mm = re.search(r'×(\d+\.\d+)', p.split('</tr>')[0])
        out[int(m.group(1))] = mm.group(1) if mm else None
    return out

def chart_triggers(path="/whatif/chart/projection"):
    st, body = req("GET", path)
    try:
        d = json.loads(body)
    except ValueError:
        return {"status": st, "error": "not json"}
    found = {}
    def walk(o):
        if isinstance(o, dict):
            if o.get("name") in ("Cut trigger", "Raise trigger") and isinstance(o.get("y"), list):
                found[o["name"]] = o["y"]
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(d)
    return {"status": st, "cut": found.get("Cut trigger"), "raise": found.get("Raise trigger")}

obs = {"variant": variant}
st, page = req("GET", "/whatif")
obs["page_status"] = st
obs["page_has_rate_assumptions"] = "Rate Assumptions" in page
obs["page_has_chain_form"] = 'id="chain-form"' in page
obs["page_has_results_container"] = 'id="whatif-results"' in page
text = html.unescape(re.sub(r"<[^>]+>", " ", page))
obs["page_error_text"] = [s for s in ("Analysis failed", "failed to load chained scenario", "analysis computation failed") if s in text]
rst, rbody = results_body(page)
obs["results_full_status"] = rst
rows = guardrail_rows(rbody)
obs["year_rows"] = len(rows)
obs["cut_years"] = sorted(y for y, t in rows.items() if "cut" in t)
obs["raise_years"] = sorted(y for y, t in rows.items() if "raise" in t)
obs["multipliers"] = {str(k): v for k, v in sorted(year_multipliers(rbody).items())}
obs["chart"] = chart_triggers() if variant != "missing" else None
full_text = html.unescape(re.sub(r"<[^>]+>", " ", rbody or ""))
obs["zero_trigger_text"] = bool(re.search(r"(falls below|rises above|≤|≥) \$0\.00", full_text))
if variant == "missing":
    m = re.search(r'hx-delete="(/whatif/chain/\d+)"', page)
    obs["delete_control"] = m.group(1) if m else None
    if m:
        dst, _ = req("DELETE", m.group(1))
        obs["delete_status"] = dst
        st2, page2 = req("GET", "/whatif")
        obs["after_delete_page_status"] = st2
        r2st, r2 = results_body(page2)
        obs["after_delete_year_rows"] = len(guardrail_rows(r2))
        obs["after_delete_chain_links"] = len(re.findall(r'hx-delete="/whatif/chain/\d+"', page2))
print(json.dumps(obs))
