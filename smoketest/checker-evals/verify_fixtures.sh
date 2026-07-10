#!/usr/bin/env bash
set -u
d="$(dirname "$0")"; FAILN=0
f(){ if [[ -e "$d/$1" ]]; then echo "ok   - $1"; else echo "FAIL - $1"; FAILN=$((FAILN+1)); fi; }
f faults/paraphrased-quote/source.txt
f faults/paraphrased-quote/page.html
f faults/hidden-opacity/page.html
f faults/dark-mode-invisible/page.html
f clean/paraphrased-quote/page.html
f clean/hidden-opacity/page.html
f clean/dark-mode-invisible/page.html
f expected.tsv
f RUNBOOK.md
# expected.tsv well-formed: 3 columns, verdict in PASS|FAIL
awk -F'\t' 'NF!=3 || ($3!="PASS" && $3!="FAIL"){bad=1} END{exit bad+0}' "$d/expected.tsv" \
  && echo "ok   - expected.tsv well-formed" || { echo "FAIL - expected.tsv"; FAILN=$((FAILN+1)); }
(( FAILN==0 )) && { echo "ALL PASS"; exit 0; } || { echo "$FAILN FAILED"; exit 1; }
