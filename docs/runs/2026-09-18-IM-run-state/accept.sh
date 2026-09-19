#!/usr/bin/env bash
# IM1 oracle. usage: accept.sh <worktree-path>
# Builds the worktree's server, runs probe.py on a copy of the frozen fixture,
# compares every observation with expected.json. Prints ORACLE PASS as the
# final line only when every check holds.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT="${1:?usage: accept.sh <worktree-path>}"
BIN="$(mktemp -t im1-bin.XXXXXX)"
trap 'rm -f "$BIN"' EXIT
echo "== build $WT"
( cd "$WT" && go build -o "$BIN" ./cmd/server ) || { echo "BUILD FAILED"; echo "ORACLE FAIL"; exit 1; }
echo "== probe"
OBS="$(python3 "$HERE/probe.py" "$BIN" "$WT" "$HERE/fixture")" || { echo "PROBE FAILED"; echo "ORACLE FAIL"; exit 1; }
python3 - "$HERE/expected.json" <<PY
import json,sys
exp=json.load(open(sys.argv[1])); obs=json.loads('''$OBS''')
def norm(v):
    if isinstance(v,float): return round(v,2)
    if isinstance(v,list): return [norm(x) if not isinstance(x,list) else [norm(y) for y in x] for x in v]
    if isinstance(v,dict): return {k:norm(x) for k,x in v.items()}
    return v
fails=0
for k in sorted(exp):
    e=norm(exp[k]); o=norm(obs.get(k,"<missing>"))
    ok = (e==o)
    print(f"{'PASS' if ok else 'FAIL'} {k}: expected {e!r} observed {o!r}")
    fails += (not ok)
print(f"== {len(exp)-fails}/{len(exp)} checks passed")
sys.exit(1 if fails else 0)
PY
rc=$?
if [[ $rc -eq 0 ]]; then echo "ORACLE PASS"; else echo "ORACLE FAIL"; fi
exit $rc
