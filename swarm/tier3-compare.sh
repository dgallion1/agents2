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
wt_primary=$(wt_for primary); wt_alt=$(wt_for alt)
for d in "$wt_primary" "$wt_alt"; do
  [[ -d "$d" ]] || { echo "no worktree at $d — run tier3-setup.sh $task first" >&2; exit 2; }
done

# The oracle is referenced by a path relative to the repo, so resolve it to an
# absolute path before cd'ing into a worktree that may live elsewhere.
oracle_abs=$(cd "$(dirname "$oracle")" && pwd)/$(basename "$oracle")
run_in() { ( cd "$1" && bash "$oracle_abs" ) 2>&1; }
op=$(run_in "$wt_primary"); rp=$?
oa=$(run_in "$wt_alt");     ra=$?

{
  echo "# Tier 3 divergence report — $task"
  echo
  echo "| worktree | oracle exit |"
  echo "|----------|-------------|"
  echo "| wt-primary | $rp |"
  echo "| wt-alt     | $ra |"
  echo
  if [[ "$op" == "$oa" && "$rp" == "$ra" ]]; then
    echo "## No behavioral divergence"
    echo '```'; echo "$op"; echo '```'
  else
    echo "## Divergence"
    echo "### wt-primary output"; echo '```'; echo "$op"; echo '```'
    echo "### wt-alt output"; echo '```'; echo "$oa"; echo '```'
    echo "### diff (primary vs alt)"
    echo '```diff'; diff <(printf '%s\n' "$op") <(printf '%s\n' "$oa"); echo '```'
  fi
  echo
  echo "<!-- Boss: after adjudicating, append a line starting 'RESOLUTION:' -->"
} > "$report"
echo "report: $report"
