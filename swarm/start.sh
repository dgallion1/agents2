#!/usr/bin/env bash
# Formerly: brought up the LiteLLM gateway (docker compose), health-checked
# it, then launched `claude` against it. The gateway was removed 2026-08-19
# (user decision: all agents run on Claude, no gateway, no second vendor).
#
# This script now just explains that and exits 0, so old muscle memory gets
# an explanation instead of a hang against a service that no longer starts.
#
# Usage:
#   swarm/start.sh [args...]   (args are accepted and ignored)

set -euo pipefail

cat <<'EOF'
swarm/start.sh: the LiteLLM gateway this script used to boot was removed on
2026-08-19 (user decision: all agents run on Claude via the direct Anthropic
API — no gateway, no second vendor). There is nothing left for this script
to start.

To launch the swarm, just run claude in the target project directory:

    cd your-project/   # dir containing .claude/agents/ + CLAUDE.md
    claude

See README.md for the current setup instructions.
EOF

exit 0
