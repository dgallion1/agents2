#!/usr/bin/env bash
# tier3-setup.sh <task> — create two blind, isolated worktrees for N-version.
set -eu
task="${1:?usage: tier3-setup.sh <task>}"
SWARM_DIR="${SWARM_DIR:-.swarm}"
base="$SWARM_DIR/tier3/$task"; mkdir -p "$base"
head=$(git rev-parse HEAD)
for fam in glm local; do
  wt="$base/wt-$fam"; branch="tier3/$task/$fam"
  git worktree remove --force "$wt" 2>/dev/null || true
  git branch -D "$branch" 2>/dev/null || true
  git worktree add -q -b "$branch" "$wt" "$head"
  echo "worktree: $wt ($branch)"
done
