#!/usr/bin/env bash
# tier3-compare.sh <task> — run the oracle in both worktrees, emit divergence
# report. Does NOT resolve anything; the boss appends the RESOLUTION line.
set -u
task="${1:?usage: tier3-compare.sh <task>}"
SWARM_DIR="${SWARM_DIR:-.swarm}"
base="$SWARM_DIR/tier3/$task"
oracle="$base/accept.sh"; report="$base/report.md"
[[ -x "$oracle" || -f "$oracle" ]] || { echo "no oracle at $oracle" >&2; exit 2; }

run_in() { ( cd "$1" && bash "$oracle" ) 2>&1; }
og=$(run_in "$base/wt-glm");   rg=$?
ol=$(run_in "$base/wt-local"); rl=$?

{
  echo "# Tier 3 divergence report — $task"
  echo
  echo "| worktree | oracle exit |"
  echo "|----------|-------------|"
  echo "| wt-glm   | $rg |"
  echo "| wt-local | $rl |"
  echo
  if [[ "$og" == "$ol" && "$rg" == "$rl" ]]; then
    echo "## No behavioral divergence"
    echo '```'; echo "$og"; echo '```'
  else
    echo "## Divergence"
    echo "### wt-glm output"; echo '```'; echo "$og"; echo '```'
    echo "### wt-local output"; echo '```'; echo "$ol"; echo '```'
    echo "### diff (glm vs local)"
    echo '```diff'; diff <(printf '%s\n' "$og") <(printf '%s\n' "$ol"); echo '```'
  fi
  echo
  echo "<!-- Boss: after adjudicating, append a line starting 'RESOLUTION:' -->"
} > "$report"
echo "report: $report"
