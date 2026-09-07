#!/usr/bin/env bash
# Tier-3 oracle for GM1 — guardrail cut/raise markers on the What-If projection chart.
# Usage: accept.sh <repo-root>   (builds+tests that tree, serves it on :8097 from a throwaway data copy)
# Emits "ORACLE PASS" as the final line ONLY when every check passes.
# Hardened after the run (agents2 review 2026-09-07): scratch logs via mktemp, go vet ./... per
# criterion 1, list rows without a money line parsed, trace-order check made explicit.
# oracle.2.log was produced by the original version (agents2 3a971b5).
set -u
REPO="${1:?repo root}"; PORT=8097; BASE="http://localhost:$PORT"; fails=0
ok(){ echo "ok   - $1"; }; bad(){ echo "FAIL - $1"; fails=$((fails+1)); }
cd "$REPO" || { echo "FAIL - cannot cd $REPO"; echo "ORACLE FAIL"; exit 1; }
command -v go >/dev/null 2>&1 || export PATH="$HOME/go-sdk/go/bin:$PATH"
command -v go >/dev/null 2>&1 || { echo "FAIL - go not found on PATH"; echo "ORACLE FAIL"; exit 1; }
LOG="$(mktemp -d "${TMPDIR:-/tmp}/gm1-oracle.XXXXXX")" || { echo "FAIL - cannot create scratch dir"; echo "ORACLE FAIL"; exit 1; }
export GM1_LOG="$LOG"
go build ./... >"$LOG/build.log" 2>&1 && ok "go build" || bad "go build: $(head -3 "$LOG/build.log")"
go vet ./... >"$LOG/vet.log" 2>&1 && ok "go vet ./..." || bad "go vet: $(head -3 "$LOG/vet.log")"
go test ./internal/handlers/whatif/... ./internal/templates/... >"$LOG/test.log" 2>&1 && ok "go test whatif+templates" || bad "go test: $(grep -m3 -- '--- FAIL' "$LOG/test.log")"
scripts/whatif-verify.sh start $PORT >"$LOG/server.log" 2>&1 || { bad "verify server start"; echo "ORACLE FAIL"; exit 1; }
curl -s "$BASE/whatif/chart/projection?display_dollars=nominal" -o $LOG/nom.json
curl -s "$BASE/whatif/chart/projection?display_dollars=real"    -o $LOG/real.json
curl -s "$BASE/whatif/chart/projection/no-guardrails?display_dollars=nominal" -o $LOG/nog.json
curl -s "$BASE/whatif" -o $LOG/whatif.html
HASH=$(grep -o 'results-full?hash=[0-9a-f]*' $LOG/whatif.html | head -1 | cut -d= -f2)
if [ -n "$HASH" ]; then curl -s --max-time 120 "$BASE/whatif/results-full?hash=$HASH" -o $LOG/page.html; else cp $LOG/whatif.html $LOG/page.html; fi
echo "  results page: hash=${HASH:-none} bytes=$(wc -c <$LOG/page.html)"
scripts/whatif-verify.sh stop $PORT >/dev/null 2>&1
python3 - <<'PY' && ok "rendered-surface checks" || bad "rendered-surface checks (see lines above)"
import json,re,html,sys,os
LOG=os.environ['GM1_LOG']
def load(n): return json.load(open(os.path.join(LOG,n)))
nom,real,nog=load('nom.json'),load('real.json'),load('nog.json')
page=open(os.path.join(LOG,'page.html')).read()
sec=re.search(r'Guardrail Events.*?</div>\s*</div>\s*</div>',page,re.S)
if not sec: print("  no Guardrail Events list on page: oracle would be vacuous"); sys.exit(1)
txt=html.unescape(re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',sec.group(0))))
# money line is optional: the list (and the hover) omit it when either spending figure is <= 0
rows=re.findall(r'Year (\d+): (Cut|Raise)(?: by \d+%)? \((\d+)% of plan\)(?: (\$[\d,]+\.\d\d)/mo → (\$[\d,]+\.\d\d)/mo)?',txt)
if not rows: print("  could not parse any list rows from:",txt[:300]); sys.exit(1)
print(f"  list rows: {rows}")
bad=0
def trace(fig,name): return next((t for t in fig['data'] if t.get('name')==name),None)
def bal_at(fig,x):
    t=trace(fig,'Portfolio Balance'); return next((y for xx,y in zip(t['x'],t['y']) if abs(xx-x)<1e-9),None)
for mode,fig in (('nominal',nom),('real',real)):
    g=trace(fig,'Guardrail cuts / raises')
    if not g: print(f"  {mode}: trace missing"); bad+=1; continue
    names=[t['name'] for t in fig['data']]
    if 'Key events' in names and names.index('Guardrail cuts / raises')<names.index('Key events'): print(f"  {mode}: trace order wrong: {names}"); bad+=1
    if len(g['x'])!=len(rows): print(f"  {mode}: {len(g['x'])} points vs {len(rows)} list rows"); bad+=1
    for i,(yr,typ,plan,before,after) in enumerate(rows):
        if i>=len(g['x']): break
        if g['x'][i]!=float(yr): print(f"  {mode}: x[{i}]={g['x'][i]} != {yr}"); bad+=1
        want_sym='triangle-down' if typ=='Cut' else 'triangle-up'; want_col='#ef4444' if typ=='Cut' else '#22c55e'
        if g['marker']['symbol'][i]!=want_sym or g['marker']['color'][i]!=want_col: print(f"  {mode}: symbol/color mismatch at {i}: {g['marker']['symbol'][i]} {g['marker']['color'][i]}"); bad+=1
        b=bal_at(fig,float(yr))
        if b is None or abs(g['y'][i]-b)>1e-6: print(f"  {mode}: y[{i}]={g['y'][i]} != balance {b}"); bad+=1
        t=g['text'][i]
        want_tail=f"<br>{before}/mo → {after}/mo" if before else ''
        tail_ok=t.endswith(want_tail) if before else '<br>' not in t
        if not (t.startswith(f"Year {yr}: {typ.lower()}") and f"({plan}% of plan)" in t and tail_ok): print(f"  {mode}: hover mismatch: {t!r} vs list {yr}/{typ}/{plan}/{before or '-'}/{after or '-'}"); bad+=1
    if g.get('hoverinfo')!='text' or g['marker'].get('size')!=11 or g['marker'].get('line',{}).get('color')!='#ffffff': print(f"  {mode}: marker styling mismatch"); bad+=1
    rng=fig['layout']['yaxis'].get('range'); mx=max(trace(fig,'Portfolio Balance')['y'])
    if not rng or abs(rng[1]-mx*1.18)>1e-3: print(f"  {mode}: headroom range {rng} vs {mx*1.18}"); bad+=1
if trace(nog,'Guardrail cuts / raises'): print("  no-guardrails endpoint carries the trace"); bad+=1
sys.exit(1 if bad else 0)
PY
if [ "$fails" -eq 0 ]; then echo "ORACLE PASS"; else echo "ORACLE FAIL ($fails)"; exit 1; fi
