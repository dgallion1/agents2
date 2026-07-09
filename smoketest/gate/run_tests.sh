#!/usr/bin/env bash
# Runs every deterministic gate test (validation layer 1). No LLM calls.
set -u
d="$(dirname "$0")"; rc=0
for t in run_check.sh run_escalate.sh run_done.sh; do
  echo "== $t =="; bash "$d/$t" || rc=1
done
exit $rc
