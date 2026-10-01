#!/usr/bin/env bash
# Regenerates base.sha256: every tracked + untracked-not-ignored file of the
# post-CD1..3 tree outside CD4 territory, SPEC.md and the run dirs.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"; TREE="$(cd "$HERE/../../.." && pwd)"
cd "$TREE"
git ls-files --cached --others --exclude-standard | LC_ALL=C sort -u | while IFS= read -r p; do
  case "$p" in swarm/gate.sh|dashboard/lib/parse.mjs|dashboard/test/parse.test.mjs|smoketest/gate/*|smoketest/doc_test.sh|CLAUDE.md|TIERS.md|README.md|SPEC.md|.swarm/*|.swarm-*) continue ;; esac
  sha256sum -- "$p"
done > "$HERE/base.sha256"
wc -l < "$HERE/base.sha256"
