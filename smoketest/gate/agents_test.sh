#!/usr/bin/env bash
# Structural checks that agent prompts carry the evidence-writing contracts.
set -u
root="$(cd "$(dirname "$0")/../.." && pwd)/.claude/agents"; FAILN=0
has()    { if grep -q "$2" "$root/$1"; then echo "ok   - $1: $3"; else echo "FAIL - $1: $3"; FAILN=$((FAILN+1)); fi; }
hasnot() { if grep -q "$2" "$root/$1"; then echo "FAIL - $1: $3"; FAILN=$((FAILN+1)); else echo "ok   - $1: $3"; fi; }

has worker-coder.md '.swarm/manifests/' "writes manifest"
has worker-local.md '.swarm/manifests/' "writes manifest"
hasnot worker-local.md 'blind' "no longer mentions blind arms"

has checker-content.md '.swarm/verdicts/' "writes verdict"
has checker-a11y.md    '.swarm/verdicts/' "writes verdict"
has checker-second.md  'FAMILY: adversarial' "declares adversarial family"
has checker-tests.md   'FAMILY: anthropic'   "checker-tests family"
has checker-a11y.md    'FAMILY: anthropic'   "checker-a11y family"
has checker-content.md 'FAMILY: anthropic'   "checker-content family"

has judge-claude.md    'FAMILY: anthropic'   "judge-claude family"
has judge-standards.md 'FAMILY: adversarial' "judge-standards family"
has judge-impact.md    'FAMILY: impact'      "judge-impact family"
has judge-claude.md    'UPHOLD'              "judge writes verdict"

for f in checker-a11y.md checker-content.md checker-second.md checker-tests.md \
         judge-claude.md judge-impact.md judge-standards.md worker-coder.md worker-local.md; do
  has "$f" '^model:' "frontmatter carries a model: key"
done

(( FAILN==0 )) && { echo "ALL PASS"; exit 0; } || { echo "$FAILN FAILED"; exit 1; }
