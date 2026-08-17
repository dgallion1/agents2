#!/usr/bin/env bash
# tier3-setup.sh <task> — create two blind, isolated worktrees for N-version.
#
# Worktrees live OUTSIDE the repository. They used to be created at
# .swarm/tier3/<task>/wt-<fam>, i.e. nested inside the repo, and that broke
# isolation in practice (2026-08-16, budget2 A1): a headless worker whose cwd
# was the nested worktree had its Edit/Write tool calls land in the PARENT
# repo while its Bash commands wrote to the worktree, leaving a third
# divergent copy and corrupting the blind comparison. Keeping the worktrees
# outside the repo removes the ambiguity — there is no parent repo to escape
# to.
#
# Override the location with SWARM_WT_ROOT if you need to.
set -eu
task="${1:?usage: tier3-setup.sh <task>}"
SWARM_DIR="${SWARM_DIR:-.swarm}"

repo_root=$(git rev-parse --show-toplevel)
repo_slug=$(basename "$repo_root")
WT_ROOT="${SWARM_WT_ROOT:-${TMPDIR:-/tmp}/swarm-worktrees/$repo_slug}"

# The metadata directory (oracle, report) stays in the repo — it is tracked.
base="$SWARM_DIR/tier3/$task"; mkdir -p "$base"
mkdir -p "$WT_ROOT/$task"

head=$(git rev-parse HEAD)
for fam in glm local; do
  wt="$WT_ROOT/$task/wt-$fam"; branch="tier3/$task/$fam"
  git worktree remove --force "$wt" 2>/dev/null || true
  # Clean up any worktree left at the old in-repo location too.
  git worktree remove --force "$base/wt-$fam" 2>/dev/null || true
  git branch -D "$branch" 2>/dev/null || true
  git worktree add -q -b "$branch" "$wt" "$head"
  echo "worktree: $wt ($branch)"
done
echo "note: worktrees are outside the repo; tier3-compare.sh resolves them the same way."
