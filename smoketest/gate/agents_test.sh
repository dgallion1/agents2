#!/usr/bin/env bash
# Structural checks that agent prompts carry the evidence-writing contracts.
set -u
root="$(cd "$(dirname "$0")/../.." && pwd)/.claude/agents"; FAILN=0
has() { if grep -q "$2" "$root/$1"; then echo "ok   - $1: $3"; else echo "FAIL - $1: $3"; FAILN=$((FAILN+1)); fi; }

has worker-coder.md '.swarm/manifests/' "writes manifest"
has worker-local.md '.swarm/manifests/' "writes manifest"

has checker-content.md '.swarm/verdicts/' "writes verdict"
has checker-a11y.md    '.swarm/verdicts/' "writes verdict"
has checker-second.md  'FAMILY: glm'      "declares glm family"
grep -q 'checker-glm' "$(cd "$(dirname "$0")/../.." && pwd)/litellm-config.yaml" \
  && echo "ok   - litellm: checker-glm alias" || { echo "FAIL - litellm checker-glm"; FAILN=$((FAILN+1)); }

(( FAILN==0 )) && { echo "ALL PASS"; exit 0; } || { echo "$FAILN FAILED"; exit 1; }
