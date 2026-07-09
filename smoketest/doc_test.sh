#!/usr/bin/env bash
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"; FAILN=0
has() { if grep -qi "$3" "$root/$1"; then echo "ok   - $1: $2"; else echo "FAIL - $1: $2"; FAILN=$((FAILN+1)); fi; }

has TIERS.md "oracle question"      "oracle"
has TIERS.md "reversible question"  "reversible"
has TIERS.md "blast radius question" "blast radius"
has TIERS.md "round-up tie-break"   "round up"
has TIERS.md "critical.globs"       "critical.globs"

(( FAILN==0 )) && { echo "ALL PASS"; exit 0; } || { echo "$FAILN FAILED"; exit 1; }
