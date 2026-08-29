#!/usr/bin/env bash
# Structural check: base kit + scaffolding present.
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
for f in README.md CLAUDE.md TIERS.md swarm/gate.sh \
         .claude/agents/worker-coder.md .claude/agents/worker-local.md \
         .claude/agents/checker-content.md .claude/agents/checker-a11y.md \
         .gitignore; do
  if [[ -f "$root/$f" ]]; then echo "ok   - $f"; else echo "FAIL - $f missing"; fail=1; fi
done
grep -q '^\.swarm/' "$root/.gitignore" 2>/dev/null && echo "ok   - .gitignore ignores .swarm/" || { echo "FAIL - .gitignore"; fail=1; }
grep -q '^\.env$' "$root/.gitignore" 2>/dev/null && echo "ok   - .gitignore ignores .env" || { echo "FAIL - .gitignore missing .env"; fail=1; }
[[ -f "$root/.env.example" ]] && echo "ok   - .env.example present" || { echo "FAIL - missing .env.example"; fail=1; }
for d in swarm smoketest .claude/agents; do
  [[ -d "$root/$d" ]] && echo "ok   - dir $d" || { echo "FAIL - dir $d"; fail=1; }
done
exit $fail
