#!/usr/bin/env bash
# tier3-compare.sh <task> — run the oracle in both worktrees, emit divergence
# report. Does NOT resolve anything; the boss appends the RESOLUTION line.
set -u
task="${1:?usage: tier3-compare.sh <task>}"
SWARM_DIR="${SWARM_DIR:-.swarm}"
base="$SWARM_DIR/tier3/$task"
oracle="$base/accept.sh"; report="$base/report.md"
[[ -x "$oracle" || -f "$oracle" ]] || { echo "no oracle at $oracle" >&2; exit 2; }

# Worktrees live outside the repo (see tier3-setup.sh for why). Fall back to
# the legacy in-repo location so runs started before that change still compare.
repo_slug=$(basename "$(git rev-parse --show-toplevel)")
WT_ROOT="${SWARM_WT_ROOT:-${TMPDIR:-/tmp}/swarm-worktrees/$repo_slug}"
wt_for() {                                        # wt_for <fam>
  if [[ -d "$WT_ROOT/$task/wt-$1" ]]; then echo "$WT_ROOT/$task/wt-$1"
  else echo "$base/wt-$1"; fi
}
wt_glm=$(wt_for glm); wt_local=$(wt_for local)
for d in "$wt_glm" "$wt_local"; do
  [[ -d "$d" ]] || { echo "no worktree at $d — run tier3-setup.sh $task first" >&2; exit 2; }
done

# The oracle is referenced by a path relative to the repo, so resolve it to an
# absolute path before cd'ing into a worktree that may live elsewhere.
oracle_abs=$(cd "$(dirname "$oracle")" && pwd)/$(basename "$oracle")
run_in() { ( cd "$1" && bash "$oracle_abs" ) 2>&1; }
og=$(run_in "$wt_glm");   rg=$?
ol=$(run_in "$wt_local"); rl=$?

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
