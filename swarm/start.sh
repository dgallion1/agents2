#!/usr/bin/env bash
# Start the swarm gateway and launch a lead Claude Code session through it.
#
# Usage:
#   swarm/start.sh [-C project-dir] [claude args...]
#
#   -C project-dir   directory to launch claude in (default: current dir).
#                    It should contain the .claude/agents/ + CLAUDE.md kit.
#   claude args      passed through to claude verbatim. If no --model is
#                    given, defaults to --model claude-fable-5.
#
# Examples:
#   swarm/start.sh -C ~/work/mysite
#   swarm/start.sh -C ~/work/mysite --model claude-opus-4-8
#   swarm/start.sh --gateway-only        # just bring up + health-check

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$PWD"
GATEWAY_ONLY=0
CLAUDE_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -C) PROJECT_DIR="$2"; shift 2 ;;
    --gateway-only) GATEWAY_ONLY=1; shift ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) CLAUDE_ARGS+=("$1"); shift ;;
  esac
done

# Master key: .env wins, else the compose default.
MASTER_KEY="sk-swarm-local"
if [[ -f "$REPO_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  MASTER_KEY="$(grep -E '^LITELLM_MASTER_KEY=' "$REPO_DIR/.env" | cut -d= -f2- || true)"
  MASTER_KEY="${MASTER_KEY:-sk-swarm-local}"
fi

echo "==> Starting gateway (docker compose)"
docker compose --project-directory "$REPO_DIR" up -d

echo -n "==> Waiting for http://localhost:4000/health "
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null -H "Authorization: Bearer $MASTER_KEY" \
      http://localhost:4000/health; then
    echo "— up."
    HEALTHY=1
    break
  fi
  echo -n "."
  sleep 1
done
if [[ "${HEALTHY:-0}" != 1 ]]; then
  echo
  echo "ERROR: gateway did not become healthy after 30s." >&2
  echo "Check: docker compose --project-directory $REPO_DIR logs litellm" >&2
  exit 1
fi

if [[ "$GATEWAY_ONLY" == 1 ]]; then
  echo "==> Gateway ready. (--gateway-only: not launching claude)"
  exit 0
fi

# Default model unless the caller passed one.
has_model=0
for a in "${CLAUDE_ARGS[@]:-}"; do
  [[ "$a" == "--model" || "$a" == --model=* ]] && has_model=1
done
[[ "$has_model" == 0 ]] && CLAUDE_ARGS+=(--model claude-fable-5)

echo "==> Launching claude in $PROJECT_DIR (${CLAUDE_ARGS[*]})"
cd "$PROJECT_DIR"
ANTHROPIC_BASE_URL="http://localhost:4000" \
ANTHROPIC_AUTH_TOKEN="$MASTER_KEY" \
exec claude "${CLAUDE_ARGS[@]}"
